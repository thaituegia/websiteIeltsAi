import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { test } from "node:test";
import { createApp } from "../server/app";
import { connectDatabase, type AttemptRecord, type PlacementRecord } from "../server/storage";
import type { Feedback, PlacementItem, StoredContent, VocabularyEntry } from "../shared/types";

const sourceText = "The resilient curator plants orchids beside a willow.";
const privateMeaning = "PRIVATE_PRONUNCIATION_MEANING";
const privateProvider = "PRIVATE_DICTIONARY_PROVIDER_DETAIL";
const timestamp = "2026-10-21T10:00:00.000Z";

function feedback(skill: Feedback["skill"]): Feedback {
  return {
    id: randomUUID(), skill, estimatedBand: null, rawScore: 1, total: 1,
    summary: "Synthetic pronunciation review", criteria: [], corrections: [], paragraphs: [], answers: [],
    source: "rule-based", createdAt: timestamp,
  };
}

test("native HTTP pronunciation is private, source scoped and preserves scheduling and prior work", { timeout: 60_000 }, async t => {
  const name = `ielts_pronunciation_api_${randomUUID().replaceAll("-", "")}`;
  assert.match(name, /^ielts_pronunciation_api_[a-f0-9]{32}$/);
  const database = await connectDatabase("mongodb://127.0.0.1:27017", name);
  let server: Server | undefined, origin = "";
  const users = { a: "", b: "" }, cookies = { a: "", b: "" };
  let dictionaryCalls = 0;
  let mode: "success" | "missing" | "mismatch" | "failure" | "held" = "success";
  let entered: (() => void) | undefined, release: (() => void) | undefined;
  let hold: Promise<void> | undefined;
  const dictionary: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.dictionaryapi.dev");
    assert.ok(url.pathname.startsWith("/api/v2/entries/en/"));
    assert.ok(init?.method === "GET" || init?.method === undefined);
    assert.equal(init?.body, undefined, "No learner sentence is sent to the dictionary");
    assert.equal(new Headers(init?.headers).has("authorization"), false, "No private provider key is sent to the dictionary");
    const word = decodeURIComponent(url.pathname.split("/").at(-1)!);
    assert.match(word, /^[a-z]+(?:['-][a-z]+)*$/);
    dictionaryCalls++;
    if (mode === "held") { entered?.(); await hold; }
    if (mode === "missing") return Response.json({ message: privateProvider }, { status: 404 });
    if (mode === "failure") return Response.json({ message: privateProvider }, { status: 503 });
    return Response.json([{
      word: mode === "mismatch" ? "anotherword" : word,
      phonetics: [{ text: "/kjʊəˈreɪtə/", audio: "https://private-audio.invalid/untrusted.wav" }],
      meanings: [{ definitions: [{ definition: privateMeaning }] }],
    }]);
  };
  const content: StoredContent = {
    id: "pronunciation-source", title: "Synthetic pronunciation source", skill: "reading",
    description: "A visible source sentence", topic: "Community", band: 5, cefr: "B1", testType: "both",
    format: "lesson", durationMinutes: 10, questions: [], vocabularyIds: [], tags: [], source: "authored",
    quality: "authored-unreviewed", createdAt: timestamp,
    sections: [{ id: "pronunciation-section", title: "Garden", text: sourceText }],
  };
  const bank: VocabularyEntry = {
    id: "pronunciation-bank-orchids", word: "orchids", meaning: privateMeaning, definition: privateMeaning,
    partOfSpeech: "noun", ipa: "/ˈɔːkɪdz/", cefr: "B1", topic: "Community", collocations: [],
    examples: [sourceText], family: [], commonError: "", synonyms: [], register: "neutral",
  };
  const item: PlacementItem = {
    id: "pronunciation-placement-item", skill: "reading", text: sourceText,
    question: "What does the curator plant?", options: ["orchids", "trees"], answer: "orchids",
    explanation: privateMeaning, band: 5, cefr: "B1", difficulty: 0, subskill: "details",
  };

  async function request(who: "a" | "b" | null, method: string, path: string, payload?: unknown, status = 200) {
    const response = await fetch(`${origin}/api${path}`, {
      method,
      headers: { ...(who ? { Cookie: cookies[who] } : {}), ...(payload === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    const body = await response.json();
    assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(body)}`);
    const cookie = response.headers.getSetCookie().at(-1);
    if (who && cookie) cookies[who] = cookie.split(";")[0];
    return { body, headers: response.headers };
  }
  async function card(word: string) {
    return (await request("a", "POST", "/vocabulary/cards", { word, meaning: "A synthetic private personal meaning" }, 201)).body.card;
  }
  async function attempt(status: AttemptRecord["status"]): Promise<AttemptRecord> {
    const id = randomUUID();
    const row: AttemptRecord = {
      _id: id, id, userId: users.a, contentId: content.id, title: content.title, skill: "reading", mode: "practice", status,
      startedAt: timestamp, deadlineAt: null, submittedAt: status === "submitted" ? timestamp : null,
      durationSeconds: 65, responses: {}, essays: {}, transcript: "", feedback: status === "submitted" ? feedback("reading") : null,
      ...(status === "invalidated" ? { invalidatedAt: timestamp } : {}),
    };
    await database.attempts.insertOne(row);
    return row;
  }
  async function placement(complete: boolean): Promise<PlacementRecord> {
    const result = feedback("placement");
    result.answers.push({ questionId: item.id, response: item.answer, answer: item.answer, correct: true,
      explanation: item.explanation, evidence: item.text, subskill: item.subskill, prompt: item.question, context: item.text });
    const row: PlacementRecord = {
      _id: randomUUID(), userId: users.a, mode: "quick", total: 1, theta: 0, standardError: 1, estimatedBand: 5,
      currentQuestionId: complete ? null : item.id, startedAt: timestamp,
      answers: complete ? [{ questionId: item.id, answer: item.answer, correct: true, review: result.answers[0] }] : [],
      result: complete ? result : null,
      ...(complete ? { completedAt: timestamp, completionReason: "answered" as const } : {}),
    };
    await database.placements.insertOne(row);
    return row;
  }
  function phoneticsOnly(value: any, word: string, ipa: string, source: "bank" | "dictionary") {
    assert.deepEqual(value, { pronunciation: { word, ipa, source } });
    for (const secret of [privateMeaning, privateProvider, "private-audio.invalid", users.a, users.b])
      assert.equal(JSON.stringify(value).includes(secret), false);
  }
  async function protectedDocuments() {
    const collections = ["users", "sessions", "attempts", "placements", "audio", "recordings.files", "recordings.chunks", "content", "placementItems", "vocabulary"];
    return Object.fromEntries(await Promise.all(collections.map(async collection => [collection, await database.db.collection(collection).find().sort({ _id: 1 }).toArray()])));
  }

  try {
    await database.content.insertOne({ ...content, _id: content.id });
    await database.vocabulary.insertOne({ ...bank, _id: bank.id });
    await database.placementItems.insertOne({ ...item, _id: item.id });
    server = createApp(database, {
      serveClient: false, production: false, duoEnabled: false, demoEnabled: false, examIntegrityEnabled: false, maxLearners: 2,
      wordPronunciation: { fetch: dictionary, timeoutMs: 2_000 },
    }).listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address(); assert.ok(address && typeof address !== "string");
    origin = `http://127.0.0.1:${address.port}`;
    for (const who of ["a", "b"] as const) {
      const registered = await request(who, "POST", "/auth/register", { name: `Synthetic Pronunciation ${who}`,
        email: `synthetic-pronunciation-${who}@example.test`, password: "synthetic-pronunciation-password", targetBand: 6.5, testType: "academic" }, 201);
      users[who] = registered.body.user.id;
    }
    const active = await attempt("in-progress"), completed = await attempt("submitted"), invalidated = await attempt("invalidated");
    const activePlacement = await placement(false), completedPlacement = await placement(true);

    await t.test("bank pronunciation is saved on new cards and returned without any dictionary request", async () => {
      const saved = (await request("a", "POST", "/vocabulary/cards", { vocabularyId: bank.id }, 201)).body.card;
      assert.equal(saved.ipa, bank.ipa);
      const before = await database.cards.findOne({ _id: saved.id });
      const result = await request("a", "POST", `/vocabulary/cards/${saved.id}/pronunciation`);
      phoneticsOnly(result.body, bank.word, bank.ipa, "bank");
      assert.equal(result.headers.get("cache-control"), "private, no-store");
      assert.equal(dictionaryCalls, 0);
      const after = await database.cards.findOne({ _id: saved.id });
      assert.equal(after?.scheduler, before?.scheduler);
      assert.deepEqual(after?.reviewLog, before?.reviewLog);
    });

    let curatorCardId = "";
    await t.test("saved personal words resolve once and enrich only pronunciation metadata", async () => {
      const saved = await card("curator"); curatorCardId = saved.id;
      const before = await database.cards.findOne({ _id: saved.id }); assert.ok(before);
      const protectedBefore = await protectedDocuments();
      const calls = dictionaryCalls;
      const results = await Promise.all(Array.from({ length: 5 }, () => request("a", "POST", `/vocabulary/cards/${saved.id}/pronunciation`)));
      for (const result of results) phoneticsOnly(result.body, "curator", "/kjʊəˈreɪtə/", "dictionary");
      assert.equal(dictionaryCalls, calls + 1, "Concurrent lookups share one free dictionary request");
      const after = await database.cards.findOne({ _id: saved.id }); assert.ok(after);
      const { ipa: _ipa, ipaSource: _source, pronunciationSource: _pronunciationSource, ...unchanged } = after as typeof after & { ipaSource?: unknown; pronunciationSource?: unknown };
      assert.deepEqual(unchanged, before);
      assert.deepEqual(await protectedDocuments(), protectedBefore);
      await request("a", "POST", `/vocabulary/cards/${saved.id}/pronunciation`);
      assert.equal(dictionaryCalls, calls + 1);
    });

    await t.test("card ownership and authentication are checked before any external lookup", async () => {
      const calls = dictionaryCalls;
      await request(null, "POST", `/vocabulary/cards/${curatorCardId}/pronunciation`, undefined, 401);
      await request("b", "POST", `/vocabulary/cards/${curatorCardId}/pronunciation`, undefined, 404);
      assert.equal(dictionaryCalls, calls);
    });

    await t.test("a missing or mismatched dictionary entry never guesses a lemma or leaks provider text", async () => {
      const unknown = await card("unfindable");
      mode = "missing";
      const missing = await request("a", "POST", `/vocabulary/cards/${unknown.id}/pronunciation`, undefined, 404);
      assert.equal(JSON.stringify(missing.body).includes(privateProvider), false);
      assert.equal((await database.cards.findOne({ _id: unknown.id }))?.ipa, undefined);
      const wrong = await card("habitats");
      mode = "mismatch";
      const mismatch = await request("a", "POST", `/vocabulary/cards/${wrong.id}/pronunciation`, undefined, 404);
      assert.equal(JSON.stringify(mismatch.body).includes("anotherword"), false);
      assert.equal((await database.cards.findOne({ _id: wrong.id }))?.ipa, undefined);
      mode = "success";
    });

    await t.test("source lookups are completed-only, authoritative and owner scoped", async () => {
      const calls = dictionaryCalls;
      const body = { word: "resilient", context: sourceText, sectionIndex: 0 };
      await request("a", "POST", `/attempts/${active.id}/words/pronunciation`, body, 409);
      await request("a", "POST", `/attempts/${invalidated.id}/words/pronunciation`, body, 409);
      await request("b", "POST", `/attempts/${completed.id}/words/pronunciation`, body, 404);
      await request("a", "POST", `/attempts/${completed.id}/words/pronunciation`, { ...body, word: "invented" }, 400);
      await request("a", "POST", `/attempts/${completed.id}/words/pronunciation`, { ...body, word: "../private" }, 400);
      await request("a", "POST", `/placement/${activePlacement._id}/words/pronunciation`, { word: "resilient", questionId: item.id }, 409);
      await request("a", "POST", `/placement/${completedPlacement._id}/words/pronunciation`, { word: "resilient", questionId: "unserved" }, 400);
      assert.equal(dictionaryCalls, calls);
      const protectedBefore = await protectedDocuments();
      const result = await request("a", "POST", `/attempts/${completed.id}/words/pronunciation`, { word: bank.word, context: sourceText, sectionIndex: 0 });
      phoneticsOnly(result.body, bank.word, bank.ipa, "bank");
      const placementResult = await request("a", "POST", `/placement/${completedPlacement._id}/words/pronunciation`, { word: bank.word, questionId: item.id });
      phoneticsOnly(placementResult.body, bank.word, bank.ipa, "bank");
      assert.equal(dictionaryCalls, calls);
      assert.deepEqual(await protectedDocuments(), protectedBefore);
    });

    await t.test("a word captured before submission can receive IPA without revealing its meaning", async () => {
      const saved = (await request("a", "POST", `/attempts/${active.id}/words`, { word: "resilient", context: sourceText, sectionIndex: 0 }, 201)).body.saved;
      const before = await database.cards.findOne({ _id: saved.cardId }); assert.ok(before);
      assert.equal(before.meaningStatus, "pending");
      const result = await request("a", "POST", `/vocabulary/cards/${saved.cardId}/pronunciation`);
      phoneticsOnly(result.body, "resilient", "/kjʊəˈreɪtə/", "dictionary");
      const after = await database.cards.findOne({ _id: saved.cardId }); assert.ok(after);
      assert.equal(after.meaning, ""); assert.equal(after.meaningStatus, "pending");
      assert.equal(after.scheduler, before.scheduler); assert.deepEqual(after.reviewLog, before.reviewLog);
    });

    await t.test("a dictionary outage leaves the existing card untouched and allows a later retry", async () => {
      const saved = await card("botanical");
      const before = await database.cards.findOne({ _id: saved.id });
      mode = "failure";
      const rejected = await request("a", "POST", `/vocabulary/cards/${saved.id}/pronunciation`, undefined, 503);
      assert.equal(JSON.stringify(rejected.body).includes(privateProvider), false);
      assert.equal("pronunciation" in rejected.body, false);
      assert.deepEqual(await database.cards.findOne({ _id: saved.id }), before);
      mode = "success";
      const result = await request("a", "POST", `/vocabulary/cards/${saved.id}/pronunciation`);
      phoneticsOnly(result.body, "botanical", "/kjʊəˈreɪtə/", "dictionary");
      const after = await database.cards.findOne({ _id: saved.id });
      assert.equal(after?.scheduler, before?.scheduler);
      assert.deepEqual(after?.reviewLog, before?.reviewLog);
    });

    await t.test("late source invalidation prevents phonetics from being returned or persisted", async () => {
      const race = await attempt("submitted");
      const saved = (await request("a", "POST", `/attempts/${race.id}/words`, { word: "willow", context: sourceText, sectionIndex: 0 }, 201)).body.saved;
      const before = await database.cards.findOne({ _id: saved.cardId });
      const entry = new Promise<void>(resolve => { entered = resolve; });
      hold = new Promise<void>(resolve => { release = resolve; }); mode = "held";
      const pending = request("a", "POST", `/attempts/${race.id}/words/pronunciation`, { word: "willow", context: sourceText, sectionIndex: 0 }, 409);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([entry, new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("Controlled dictionary request did not begin")), 5_000);
        })]);
      } finally { if (timer) clearTimeout(timer); }
      await database.attempts.updateOne({ _id: race.id }, { $set: { status: "invalidated", invalidatedAt: timestamp } });
      release!();
      const rejected = await pending;
      assert.equal("pronunciation" in rejected.body, false);
      assert.deepEqual(await database.cards.findOne({ _id: saved.cardId }), before);
      mode = "success";
    });
  } finally {
    release?.();
    if (server) {
      await new Promise<void>(resolve => server!.close(() => resolve()));
    }
    assert.match(database.db.databaseName, /^ielts_pronunciation_api_[a-f0-9]{32}$/);
    await database.db.dropDatabase();
    await database.client.close();
  }
});
