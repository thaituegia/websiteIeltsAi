import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { MongoClient } from "mongodb";
import type { ContentSection } from "../shared/types";
import type { Database } from "../server/storage";
import { SpeechAudioCache, SpeechProviderError, synthesizeSpeechAudio } from "../server/speech-audio";
import { SpeechBudgetExceededError, SpeechGenerationBudget } from "../server/speech-budget";

test("speech generation starts with no paid allowance and rejects invalid numeric limits", () => {
  const empty = new SpeechGenerationBudget();
  assert.throws(() => empty.consume(1), SpeechBudgetExceededError);
  assert.equal(empty.snapshot().providerRequests, 0);
  assert.equal(empty.snapshot().inputCharacters, 0);
  for (const value of [-1, .5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => new SpeechGenerationBudget({ maxProviderRequests: value, maxInputCharacters: 100 }));
    assert.throws(() => new SpeechGenerationBudget({ maxProviderRequests: 1, maxInputCharacters: value }));
    assert.throws(() => empty.consume(value));
  }
});

test("parallel reservations cannot exceed either request or serialized-input limits", async () => {
  const requests = new SpeechGenerationBudget({ maxProviderRequests: 2, maxInputCharacters: 1000 });
  const outcomes = await Promise.allSettled(Array.from({ length: 20 }, async () => requests.consume(10)));
  assert.equal(outcomes.filter(outcome => outcome.status === "fulfilled").length, 2);
  assert.deepEqual(requests.snapshot(), { maxProviderRequests: 2, maxInputCharacters: 1000,
    providerRequests: 2, inputCharacters: 20, remainingProviderRequests: 0, remainingInputCharacters: 980 });
  const characters = new SpeechGenerationBudget({ maxProviderRequests: 20, maxInputCharacters: 100 });
  const capped = await Promise.allSettled(Array.from({ length: 20 }, async () => characters.consume(50)));
  assert.equal(capped.filter(outcome => outcome.status === "fulfilled").length, 2);
  assert.equal(characters.snapshot().inputCharacters, 100);
  assert.equal(characters.snapshot().providerRequests, 2);
  assert.equal(Object.isFrozen(characters.snapshot()), true);
});

test("speech accounting rejects before mutating counters and cannot overflow safe integers", () => {
  const budget = new SpeechGenerationBudget({ maxProviderRequests: 2, maxInputCharacters: Number.MAX_SAFE_INTEGER });
  budget.consume(Number.MAX_SAFE_INTEGER - 1);
  assert.throws(() => budget.consume(2), error => error instanceof SpeechBudgetExceededError && error.reason === "input-characters");
  assert.equal(budget.snapshot().providerRequests, 1);
  budget.consume(1);
  assert.equal(budget.snapshot().inputCharacters, Number.MAX_SAFE_INTEGER);
  assert.equal(budget.snapshot().remainingInputCharacters, 0);
});

const environmentNames = ["IELTS_OPENAI_API_KEY", "OPENAI_API_KEY", "ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_BRITISH", "ELEVENLABS_VOICE_AMERICAN", "ELEVENLABS_VOICE_AUSTRALIAN", "ELEVENLABS_MODEL"];
const single = (id: string, text: string): ContentSection => ({ id, title: "Never spoken heading", text });
function pcmResponse(): Response {
  const pcm = Buffer.alloc(12);
  [100, 200, 300, 400, 500, 600].forEach((value, index) => pcm.writeInt16LE(value, index * 2));
  return new Response(pcm, { headers: { "content-type": "audio/pcm", "content-length": String(pcm.length) } });
}

test("native Mongo worker budgets count paid attempts after cache lookup and preserve completed paid turns", { timeout: 40_000 }, async t => {
  const name = "ielts_speech_budget_test_" + randomUUID().replaceAll("-", "");
  assert.match(name, /^ielts_speech_budget_test_[a-f0-9]{32}$/);
  const client = new MongoClient("mongodb://127.0.0.1:27017", { serverSelectionTimeoutMS: 5000, maxPoolSize: 3 });
  const saved = new Map(environmentNames.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  const calls: { body: string; text: string }[] = [];
  let mode: "success" | "failure" | "abort" = "success";
  let entered: (() => void) | undefined;
  for (const key of environmentNames) delete process.env[key];
  process.env.IELTS_OPENAI_API_KEY = "sk-synthetic-budget-fixture-no-provider-access";
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://api.openai.com/v1/audio/speech");
    const body = String(init?.body);
    calls.push({ body, text: JSON.parse(body).input });
    if (mode === "failure") return Response.json({ error: { message: "SYNTHETIC_PRIVATE_PROVIDER_DETAIL" } }, { status: 503 });
    if (mode === "abort") {
      entered?.();
      return new Promise<Response>((_resolve, reject) => {
        const stop = () => reject(new DOMException("Synthetic provider abort", "AbortError"));
        if (init?.signal?.aborted) stop(); else init?.signal?.addEventListener("abort", stop, { once: true });
      });
    }
    return pcmResponse();
  };
  try {
    await client.connect();
    const db = client.db(name);
    const cache = () => new SpeechAudioCache({ db } as Database);
    const scene: ContentSection[] = [{ id: "synthetic-budget-dialogue", title: "Ignore", text: "Ignore", dialogue: [
      { speaker: "Teacher", accent: "british", text: "The synthetic library opens at nine." },
      { speaker: "Student", accent: "british", text: "I will visit the reading room later." },
      { speaker: "Teacher", accent: "british", text: "Please bring your synthetic membership card." },
    ] }];

    await t.test("zero request budget prevents every provider request, including concurrent turns", async () => {
      const zero = new SpeechGenerationBudget();
      await assert.rejects(cache().get(scene, undefined, zero), SpeechBudgetExceededError);
      assert.equal(calls.length, 0);
      assert.equal(zero.snapshot().providerRequests, 0);
    });

    await t.test("one allowed request persists one turn even when its concurrent sibling is refused", async () => {
      const one = new SpeechGenerationBudget({ maxProviderRequests: 1, maxInputCharacters: 100_000 });
      await assert.rejects(cache().get(scene, undefined, one), SpeechBudgetExceededError);
      assert.equal(calls.length, 1);
      assert.equal(one.snapshot().providerRequests, 1);
      assert.equal(one.snapshot().inputCharacters, calls[0]!.body.length);
      assert.equal(await db.collection("speech_audio.files").countDocuments({ "metadata.kind": "turn" }), 1);
    });

    await t.test("resume purchases only uncached turns and complete cached clips need zero budget", async () => {
      const paidText = calls[0]!.text;
      const remaining = new SpeechGenerationBudget({ maxProviderRequests: 2, maxInputCharacters: 100_000 });
      const result = await cache().get(scene, undefined, remaining);
      assert.equal(result.cached, false);
      assert.equal(remaining.snapshot().providerRequests, 2);
      assert.equal(calls.length, 3);
      assert.equal(calls.filter(call => call.text === paidText).length, 1);
      const zero = new SpeechGenerationBudget();
      const ready = await cache().get(scene, undefined, zero);
      assert.equal(ready.cached, true);
      assert.equal(calls.length, 3);
      assert.equal(zero.snapshot().providerRequests, 0);
      assert.equal(zero.snapshot().inputCharacters, 0);
    });

    await t.test("one shared allowance covers separate clips without silently resetting", async () => {
      const shared = new SpeechGenerationBudget({ maxProviderRequests: 1, maxInputCharacters: 100_000 });
      const before = calls.length;
      await cache().get([single("separate-one", "A synthetic museum closes at six.")], undefined, shared);
      await assert.rejects(cache().get([single("separate-two", "A synthetic train departs at seven.")], undefined, shared), SpeechBudgetExceededError);
      assert.equal(calls.length - before, 1);
      assert.equal(shared.snapshot().providerRequests, 1);
    });

    await t.test("failed provider attempts remain spent and cannot be retried beyond the cap", async () => {
      const source = [single("failure", "This synthetic request is made to fail once.")];
      const budget = new SpeechGenerationBudget({ maxProviderRequests: 1, maxInputCharacters: 100_000 });
      const before = calls.length;
      mode = "failure";
      await assert.rejects(cache().get(source, undefined, budget), SpeechProviderError);
      assert.equal(budget.snapshot().providerRequests, 1);
      mode = "success";
      await assert.rejects(cache().get(source, undefined, budget), SpeechBudgetExceededError);
      assert.equal(calls.length - before, 1);
      assert.equal(budget.snapshot().providerRequests, 1);
    });

    await t.test("the character cap includes instructions and metadata, not only spoken words", async () => {
      const source = [single("characters", "A synthetic garden closes at eight.")];
      await synthesizeSpeechAudio(source);
      const requestLength = calls.at(-1)!.body.length;
      assert.ok(requestLength > calls.at(-1)!.text.length);
      const before = calls.length;
      const insufficient = new SpeechGenerationBudget({ maxProviderRequests: 1, maxInputCharacters: requestLength - 1 });
      await assert.rejects(cache().get(source, undefined, insufficient), error => error instanceof SpeechBudgetExceededError && error.reason === "input-characters");
      assert.equal(calls.length, before);
      assert.equal(insufficient.snapshot().providerRequests, 0);
      const exact = new SpeechGenerationBudget({ maxProviderRequests: 1, maxInputCharacters: requestLength });
      await cache().get(source, undefined, exact);
      assert.equal(calls.length - before, 1);
      assert.equal(exact.snapshot().remainingInputCharacters, 0);
    });

    await t.test("an aborted request is not refunded and another attempt remains blocked", async () => {
      const source = [single("abort", "This synthetic provider request is interrupted.")];
      const budget = new SpeechGenerationBudget({ maxProviderRequests: 1, maxInputCharacters: 100_000 });
      const controller = new AbortController();
      let announce!: () => void;
      const started = new Promise<void>(resolve => { announce = resolve; });
      entered = announce; mode = "abort";
      const before = calls.length;
      const pending = cache().get(source, controller.signal, budget);
      await started; controller.abort();
      await assert.rejects(pending);
      mode = "success"; entered = undefined;
      await assert.rejects(cache().get(source, undefined, budget), SpeechBudgetExceededError);
      assert.equal(calls.length - before, 1);
      assert.equal(budget.snapshot().providerRequests, 1);
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await client.db(name).dropDatabase();
    await client.close();
  }
});
