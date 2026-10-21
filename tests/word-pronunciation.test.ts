import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "../server/errors";
import { vocabularyBank } from "../server/data/index";
import type { Database } from "../server/storage";
import { pronunciationWord, validIpa, WordPronunciationResolver } from "../server/word-pronunciation";

function vocabulary(lookup: (query: unknown) => unknown = () => null): Pick<Database, "vocabulary"> {
  return { vocabulary: { findOne: async (query: unknown) => lookup(query) } as unknown as Database["vocabulary"] };
}
function isStatus(status: number) {
  return (error: unknown) => error instanceof ApiError && error.status === status;
}
function phonetics(word: string, ipa = "/ˈɒkɪd/"): Response {
  return Response.json([{ word, phonetics: [{ text: ipa, audio: "https://private-provider.invalid/secret.mp3" }],
    meanings: [{ definitions: [{ definition: "PRIVATE_PROVIDER_DEFINITION" }] }] }]);
}

test("all current bank pronunciations, including voiceless dental theta, remain valid IPA", () => {
  assert.equal(vocabularyBank.length, 648);
  assert.ok(vocabularyBank.some(entry => entry.ipa.includes("θ")), "Exercise the bank's theta-bearing pronunciations");
  for (const entry of vocabularyBank)
    assert.equal(validIpa(entry.ipa), entry.ipa, `Bank pronunciation rejected for ${entry.word}`);
  assert.equal(validIpa("/αλφα/"), undefined, "Supporting IPA theta does not admit arbitrary Greek text");
});

test("an exact free dictionary entry can return IPA containing theta", async () => {
  const resolver = new WordPronunciationResolver(vocabulary(), { fetch: async () => phonetics("length", "/leŋθ/") });
  assert.deepEqual(await resolver.get("length"), { word: "length", ipa: "/leŋθ/", source: "dictionary" });
});

test("bank pronunciations handle exact phrases without any external lookup", async () => {
  let bankCalls = 0, dictionaryCalls = 0;
  const resolver = new WordPronunciationResolver(vocabulary(query => {
    bankCalls++;
    assert.deepEqual(query, { word: { $regex: "^renewable energy$", $options: "i" } });
    return { ipa: "/rɪˈnjuːəbl ˈenədʒi/" };
  }), { fetch: async () => { dictionaryCalls++; throw new Error("Must not call a paid or external provider"); } });
  const first = await resolver.get("  Renewable   energy ");
  assert.deepEqual(first, { word: "renewable energy", ipa: "/rɪˈnjuːəbl ˈenədʒi/", source: "bank" });
  first.ipa = "/changed/";
  assert.equal((await resolver.get("renewable energy")).ipa, "/rɪˈnjuːəbl ˈenədʒi/");
  assert.equal(bankCalls, 1); assert.equal(dictionaryCalls, 0);
});

test("dictionary lookups share work, expose only phonetics and use an exact public word URL", async () => {
  let calls = 0, entered!: () => void, release!: () => void;
  const entry = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const resolver = new WordPronunciationResolver(vocabulary(), { fetch: async (input, init) => {
    calls++;
    assert.equal(String(input), "https://api.dictionaryapi.dev/api/v2/entries/en/orchid");
    assert.equal(init?.method, "GET"); assert.equal(init?.redirect, "error");
    assert.deepEqual(init?.headers, { Accept: "application/json" });
    assert.equal(init?.body, undefined); assert.ok(init?.signal);
    entered(); await held;
    return phonetics("orchid");
  } });
  const first = resolver.get("Orchid");
  await entry;
  const other = resolver.get("orchid");
  release();
  const results = await Promise.all([first, other]);
  for (const result of results) assert.deepEqual(result, { word: "orchid", ipa: "/ˈɒkɪd/", source: "dictionary" });
  assert.equal(calls, 1);
  assert.deepEqual(await resolver.get("orchid"), results[0]);
  assert.equal(calls, 1);
});

test("dictionary lemma redirects and fabricated entry shapes are never attached to a selected spelling", async () => {
  let currentTime = 100, calls = 0, correctWord = false;
  const resolver = new WordPronunciationResolver(vocabulary(), { now: () => currentTime, fetch: async () => {
    calls++;
    return phonetics(correctWord ? "orchids" : "orchid");
  } });
  await assert.rejects(resolver.get("orchids"), isStatus(404));
  correctWord = true;
  await assert.rejects(resolver.get("orchids"), isStatus(404));
  assert.equal(calls, 1, "A missing pronunciation is cached briefly without inventing one");
  currentTime += 5 * 60_000 + 1;
  assert.deepEqual(await resolver.get("orchids"), { word: "orchids", ipa: "/ˈɒkɪd/", source: "dictionary" });
  assert.equal(calls, 2);
  const object = new WordPronunciationResolver(vocabulary(), { fetch: async () => Response.json({ phonetic: "/wɜːd/" }) });
  await assert.rejects(object.get("word"), isStatus(404));
  const wrongField = new WordPronunciationResolver(vocabulary(), { fetch: async () => Response.json([{ word: "word", phonetic: "/wɜːd/" }]) });
  await assert.rejects(wrongField.get("word"), isStatus(404), "Only the dictionary's phonetics.text field can supply IPA");
});

test("only bounded IPA text is accepted, and untrusted definitions or audio URLs cannot supply it", async () => {
  assert.equal(validIpa("ˈɔːkɪdz"), "/ˈɔːkɪdz/");
  assert.equal(validIpa("[ˈɔːkɪdz]"), "[ˈɔːkɪdz]");
  for (const invalid of [undefined, {}, "", "/ /", "\n/ˈɔːkɪdz/\n\nother", "https://private.invalid/a.mp3", "<script>alert(1)</script>", "/wɜːd/\u202e", "a".repeat(241)])
    assert.equal(validIpa(invalid), undefined);
  const resolver = new WordPronunciationResolver(vocabulary(), { fetch: async () => Response.json([{
    word: "orchid", phonetics: [{ audio: "https://private.invalid/ˈɒkɪd.mp3", text: "<b>ˈɒkɪd</b>" }],
    meanings: [{ definitions: [{ definition: "/ˈɒkɪd/" }] }],
  }]) });
  await assert.rejects(resolver.get("orchid"), isStatus(404));
});

test("provider failures are private, preserve retry and never poison the pronunciation cache", async () => {
  let calls = 0;
  const resolver = new WordPronunciationResolver(vocabulary(), { fetch: async () => {
    calls++;
    if (calls === 1) throw new Error("PRIVATE_PROVIDER_FAILURE");
    if (calls === 2) return Response.json({ message: "PRIVATE_PROVIDER_FAILURE" }, { status: 429 });
    return phonetics("orchid");
  } });
  for (let i = 0; i < 2; i++) await assert.rejects(resolver.get("orchid"), error => {
    assert.ok(isStatus(503)(error));
    assert.equal(String(error).includes("PRIVATE_PROVIDER_FAILURE"), false);
    return true;
  });
  assert.equal((await resolver.get("orchid")).source, "dictionary");
  assert.equal(calls, 3);
});

test("dictionary response sizes and stalled transports remain bounded without waiting for cleanup", async () => {
  const excessive = new WordPronunciationResolver(vocabulary(), { fetch: async () => new Response(" ".repeat(128 * 1024 + 1)) });
  await assert.rejects(excessive.get("orchid"), isStatus(503));
  let signal: AbortSignal | null | undefined;
  const stalled = new WordPronunciationResolver(vocabulary(), { timeoutMs: 15, fetch: async (_input, init) => {
    signal = init?.signal;
    return await new Promise<Response>(() => undefined);
  } });
  await assert.rejects(stalled.get("orchid"), isStatus(503));
  assert.equal(signal?.aborted, true);
  let cancelled = false;
  const body = new WordPronunciationResolver(vocabulary(), { timeoutMs: 15, fetch: async () => new Response(new ReadableStream({
    pull: () => new Promise<void>(() => undefined),
    cancel: () => { cancelled = true; return new Promise<void>(() => undefined); },
  })) });
  await assert.rejects(body.get("orchid"), isStatus(503));
  assert.equal(cancelled, true, "A timed out body is cancelled without awaiting a hung stream cleanup");
});

test("missing nonbank phrases and invalid selections never become unrelated dictionary requests", async () => {
  let calls = 0;
  const resolver = new WordPronunciationResolver(vocabulary(), { fetch: async () => { calls++; return phonetics("orchid"); } });
  await assert.rejects(resolver.get("not a bank phrase"), isStatus(404));
  for (const word of ["", "../secret", "https://example.test", "a".repeat(81), "word123", "hello\n<script>"])
    await assert.rejects(resolver.get(word), isStatus(400));
  assert.equal(pronunciationWord("DON’T"), "don't");
  assert.equal(calls, 0);
});
