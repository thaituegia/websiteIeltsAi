import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateWriting } from "../server/ai";
import { AI_ERROR_CODES, ApiError, type AiErrorCode } from "../server/errors";
import type { StoredContent } from "../shared/types";

const privateText = "SYNTHETIC_PRIVATE_PROVIDER_BODY_NEVER_EXPOSE";
const essay = "Public transport helps students reach school. Frequent buses reduce waiting times.";
const names = ["Task Achievement/Response", "Coherence & Cohesion", "Lexical Resource", "Grammatical Range & Accuracy"];
const content: StoredContent = {
  id: "synthetic-writing-error", title: "A synthetic Writing task", skill: "writing", topic: "Education",
  description: "Controlled provider error fixture", band: 6, cefr: "B2", testType: "academic",
  durationMinutes: 40, format: "lesson", questions: [], vocabularyIds: [], tags: [], source: "authored",
  quality: "authored-unreviewed", createdAt: "2026-10-21T00:00:00.000Z",
  sections: [{ id: "synthetic-task2", title: "Task 2", task: 2, text: "Discuss access to education." }],
};

function envelope(payload: unknown, finishReason = "stop"): Response {
  return Response.json({ choices: [{ message: { content: JSON.stringify(payload) }, finish_reason: finishReason }] });
}
function extraction() {
  return { tasks: [{ task: 2, quotes: names.map(criterion => ({ criterion, quote: "Public transport", observation: "Relevant evidence." })), paragraphs: [], corrections: [] }] };
}
function scoring() {
  return { summary: "Estimated feedback.", tasks: [{ task: 2, summary: "A task-specific result.", criteria: names.map(name => ({ name, band: 6 as number | null, confidence: 0.7, feedback: "Develop the supporting detail.", evidence: ["Public transport"] })) }] };
}
async function configured(mock: typeof fetch, work: () => Promise<void>) {
  const originalFetch = globalThis.fetch;
  const prior = new Map(["OPENAI_API_KEY", "IELTS_OPENAI_API_KEY", "EXTRACTOR_MODEL", "SCORING_MODEL"].map(name => [name, process.env[name]]));
  delete process.env.OPENAI_API_KEY;
  delete process.env.EXTRACTOR_MODEL;
  delete process.env.SCORING_MODEL;
  process.env.IELTS_OPENAI_API_KEY = "synthetic-writing-provider-key-no-paid-calls";
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://api.openai.com/v1/chat/completions");
    return mock(url, init);
  };
  try { await work(); }
  finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of prior) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
}
async function rejected(status: number, code: AiErrorCode) {
  await assert.rejects(evaluateWriting(content, { "synthetic-task2": essay }), error => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    assert.ok(AI_ERROR_CODES.includes(error.code));
    assert.equal(error.message.includes(privateText), false);
    assert.equal(error.message.includes("synthetic-writing-provider-key"), false);
    assert.equal(error.message.includes(essay), false);
    return true;
  });
}

test("Writing provider errors expose finite diagnostics without provider payloads or hidden retries", async t => {
  for (const [status, upstream, expectedStatus, code] of [
    [401, { code: "invalid_api_key" }, 502, "AI_PROVIDER_AUTH"],
    [403, { code: "permission_denied" }, 502, "AI_PROVIDER_AUTH"],
    [404, { code: "model_not_found" }, 502, "AI_MODEL_UNAVAILABLE"],
    [429, { code: "insufficient_quota" }, 503, "AI_PROVIDER_QUOTA"],
    [429, { type: "insufficient_quota" }, 503, "AI_PROVIDER_QUOTA"],
    [429, { code: "billing_hard_limit_reached" }, 503, "AI_PROVIDER_QUOTA"],
    [429, { code: "rate_limit_exceeded" }, 503, "AI_PROVIDER_RATE_LIMIT"],
    [500, {}, 502, "AI_PROVIDER_UNAVAILABLE"],
    [502, {}, 502, "AI_PROVIDER_UNAVAILABLE"],
    [503, {}, 502, "AI_PROVIDER_UNAVAILABLE"],
  ] as const) {
    await t.test(`HTTP ${status} / ${"code" in upstream ? upstream.code : "type" in upstream ? upstream.type : "unavailable"}`, async () => {
      let calls = 0;
      await configured(async () => {
        calls++;
        return Response.json({ error: { ...upstream, message: privateText } }, { status });
      }, () => rejected(expectedStatus, code));
      assert.equal(calls, 1, "A provider rejection must not silently issue another paid request");
    });
  }
  await t.test("unparseable 429 body retains a safe rate-limit error", async () => {
    await configured(async () => new Response(privateText, { status: 429 }), () => rejected(503, "AI_PROVIDER_RATE_LIMIT"));
  });
  await t.test("oversized 429 body is cancelled and never echoed", async () => {
    let cancelled = false;
    await configured(async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode(privateText.repeat(1000))); },
      cancel() { cancelled = true; },
    }), { status: 429 }), () => rejected(503, "AI_PROVIDER_RATE_LIMIT"));
    assert.equal(cancelled, true);
  });
  await t.test("a stalled 429 body cannot retain grading while upstream cancellation hangs", { timeout: 3_500 }, async () => {
    let cancellationRequested = false;
    const started = performance.now();
    await configured(async () => new Response(new ReadableStream({
      pull() { return new Promise<void>(() => undefined); },
      cancel() {
        cancellationRequested = true;
        return new Promise<void>(() => undefined);
      },
    }), { status: 429 }), () => rejected(503, "AI_PROVIDER_RATE_LIMIT"));
    assert.equal(cancellationRequested, true);
    assert.ok(performance.now() - started < 3_000, "The error body must not outlive its two-second read budget");
  });
  await t.test("known access errors do not wait for a hanging cancellation", { timeout: 1_000 }, async () => {
    let cancellationRequested = false;
    await configured(async () => new Response(new ReadableStream({
      cancel() {
        cancellationRequested = true;
        return new Promise<void>(() => undefined);
      },
    }), { status: 403 }), () => rejected(502, "AI_PROVIDER_AUTH"));
    assert.equal(cancellationRequested, true);
  });
  await t.test("network errors do not expose transport exception details", async () => {
    await configured(async () => { throw new TypeError(privateText); }, () => rejected(502, "AI_PROVIDER_NETWORK"));
  });
  await t.test("aborted provider requests have a timeout diagnostic", async () => {
    const OriginalAbortController = globalThis.AbortController;
    globalThis.AbortController = class extends OriginalAbortController {
      constructor() { super(); queueMicrotask(() => this.abort()); }
    };
    try {
      await configured(async (_url, init) => {
        const signal = init?.signal;
        return new Promise<Response>((_resolve, reject) => {
          if (signal?.aborted) reject(new DOMException(privateText, "AbortError"));
          else signal?.addEventListener("abort", () => reject(new DOMException(privateText, "AbortError")), { once: true });
        });
      }, () => rejected(504, "AI_PROVIDER_TIMEOUT"));
    } finally { globalThis.AbortController = OriginalAbortController; }
  });
});

test("Writing malformed output and strict evidence failures carry distinct safe diagnostics", async t => {
  for (const [name, response] of [
    ["invalid outer JSON", () => new Response(privateText, { headers: { "Content-Type": "application/json" } })],
    ["invalid inner JSON", () => Response.json({ choices: [{ message: { content: privateText }, finish_reason: "stop" }] })],
    ["truncated output", () => envelope(extraction(), "length")],
    ["missing schema fields", () => envelope({ tasks: [{ task: 2, secret: privateText }] })],
  ] as const) {
    await t.test(name, async () => {
      let calls = 0;
      await configured(async () => { calls++; return response(); }, () => rejected(502, "AI_RESPONSE_INVALID"));
      assert.equal(calls, 1);
    });
  }
  await t.test("invented extractor quotations still block scoring", async () => {
    const payload = extraction();
    payload.tasks[0].quotes[0].quote = privateText;
    let calls = 0;
    await configured(async () => { calls++; return envelope(payload); }, () => rejected(502, "AI_EVIDENCE_INVALID"));
    assert.equal(calls, 1);
  });
  await t.test("renamed scorer criteria are rejected without weakening the rubric", async () => {
    const payload = scoring(); payload.tasks[0].criteria[0].name = "Task Response";
    let calls = 0;
    await configured(async () => envelope(++calls === 1 ? extraction() : payload), () => rejected(502, "AI_RESPONSE_INVALID"));
    assert.equal(calls, 2);
  });
  await t.test("missing criterion scores remain ungraded", async () => {
    const payload = scoring(); payload.tasks[0].criteria[0].band = null;
    let calls = 0;
    await configured(async () => envelope(++calls === 1 ? extraction() : payload), () => rejected(502, "AI_RESPONSE_INVALID"));
  });
  await t.test("invented scorer evidence is rejected", async () => {
    const payload = scoring(); payload.tasks[0].criteria[0].evidence = [privateText];
    let calls = 0;
    await configured(async () => envelope(++calls === 1 ? extraction() : payload), () => rejected(502, "AI_EVIDENCE_INVALID"));
  });
  await t.test("valid evidence still yields the same one-task band", async () => {
    let calls = 0;
    await configured(async () => envelope(++calls === 1 ? extraction() : scoring()), async () => {
      const feedback = await evaluateWriting(content, { "synthetic-task2": essay });
      assert.equal(feedback.source, "ai");
      assert.equal(feedback.estimatedBand, 6);
      assert.equal(feedback.taskScores?.length, 1);
    });
    assert.equal(calls, 2);
  });
});
