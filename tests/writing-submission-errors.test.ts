import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { test } from "node:test";
import { createApp } from "../server/app";
import { connectDatabase } from "../server/storage";
import type { Attempt, StoredContent } from "../shared/types";

const names = [
  "Task Achievement/Response", "Coherence & Cohesion", "Lexical Resource", "Grammatical Range & Accuracy",
];
const essay = "Public transport can improve access to education. Better buses reduce travel costs.\n\nSchools should teach critical thinking through practical projects.";
const providerSecret = "synthetic-writing-provider-token-never-a-real-key";
const privateDetail = "SYNTHETIC_PRIVATE_WRITING_UPSTREAM_DETAIL";
const environmentNames = [
  "IELTS_OPENAI_API_KEY", "OPENAI_API_KEY", "EXTRACTOR_MODEL", "SCORING_MODEL",
  "IELTS_AZURE_SPEECH_KEY", "AZURE_SPEECH_KEY", "ELEVENLABS_API_KEY",
] as const;

function writing(): StoredContent {
  return {
    id: "synthetic-writing-submission", title: "Synthetic public transport essay", skill: "writing",
    description: "A controlled Writing submission fixture", topic: "Education", band: 6, cefr: "B2",
    testType: "both", durationMinutes: 40, format: "lesson", vocabularyIds: [], tags: [],
    source: "authored", quality: "authored-unreviewed", createdAt: "2026-10-21T00:00:00.000Z",
    questions: [], sections: [{
      id: "synthetic-writing-task2", title: "Task 2", task: 2,
      text: "Should schools teach practical skills? Give reasons and relevant examples.",
      instructions: "Write at least 250 words.",
    }],
  };
}
const envelope = (payload: unknown) => Response.json({
  choices: [{ message: { content: JSON.stringify(payload) }, finish_reason: "stop" }],
});
function extracted(quote = "Public transport") {
  return { tasks: [{
    task: 2,
    quotes: names.map(criterion => ({ criterion, quote, observation: "A specific observation grounded in the essay." })),
    paragraphs: [{ index: 0, quote: "Public transport", feedback: "Develop the initial claim with a clear example." }],
    corrections: [{ original: "Better buses", suggestion: "More frequent buses", explanation: "Use a more specific description." }],
  }] };
}
function scored() {
  return {
    summary: "Controlled practice feedback grounded in the saved essay.",
    tasks: [{ task: 2, summary: "Task 2 practice result", criteria: names.map(name => ({
      name, band: 6, confidence: 0.7, feedback: "Develop the relevant support more fully.", evidence: ["Public transport"],
    })) }],
  };
}

test("native HTTP Writing keeps the saved essay through grading failures and permits a valid retry", { timeout: 60_000 }, async t => {
  const databaseName = `ielts_writing_errors_test_${randomUUID().replaceAll("-", "")}`;
  assert.match(databaseName, /^ielts_writing_errors_test_[a-f0-9]{32}$/);
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const prior = new Map(environmentNames.map(name => [name, process.env[name]]));
  const errorLogs: string[] = [];
  let mode: "auth" | "schema" | "evidence" | "success" = "auth";
  let successStep = 0, providerCalls = 0;
  const database = await connectDatabase("mongodb://127.0.0.1:27017", databaseName);
  environmentNames.forEach(name => delete process.env[name]);
  process.env.IELTS_OPENAI_API_KEY = providerSecret;
  process.env.EXTRACTOR_MODEL = "gpt-4o";
  process.env.SCORING_MODEL = "gpt-4o";
  console.error = (...args: unknown[]) => { errorLogs.push(args.map(String).join(" ")); };
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.openai.com/v1/chat/completions", "Only the controlled grading transport can be called");
    const payload = JSON.parse(String(init?.body));
    assert.equal(payload.model, "gpt-4o");
    const gradingInput = JSON.parse(payload.messages[1].content);
    assert.equal(gradingInput.tasks[0].essay, essay, "The scorer must receive the actual saved essay");
    providerCalls++;
    if (mode === "auth") return Response.json({ error: { code: "invalid_api_key", message: `${privateDetail} ${providerSecret}` } }, { status: 401 });
    if (mode === "schema") return envelope({ tasks: [] });
    if (mode === "evidence") return envelope(extracted(privateDetail));
    return envelope(++successStep === 1 ? extracted() : scored());
  };
  let server: Server | undefined, origin = "";
  const cookies = { a: "", b: "" };
  const content = writing();

  async function request(who: "a" | "b", method: string, path: string, payload?: unknown, expected = 200) {
    // Native HTTP requests bypass the provider stub; app-side provider calls do not.
    const response = await originalFetch(`${origin}/api${path}`, {
      method,
      headers: { Cookie: cookies[who], ...(payload === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    const body = await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(body)}`);
    const cookie = response.headers.getSetCookie().at(-1);
    if (cookie) cookies[who] = cookie.split(";")[0];
    return body;
  }
  async function begin() {
    const result = await request("a", "POST", "/attempts", { contentId: content.id, mode: "practice" }, 201);
    await request("a", "PATCH", `/attempts/${result.attempt.id}`, { essays: { [content.sections[0].id]: essay } });
    return result.attempt as Attempt;
  }
  async function assertRetained(id: string) {
    const stored = await database.attempts.findOne({ _id: id });
    assert.ok(stored);
    assert.equal(stored.status, "in-progress");
    assert.equal(stored.essays[content.sections[0].id], essay);
    assert.equal(stored.feedback, null, "A grading failure must not invent a fallback band");
    assert.equal(stored.submittedAt, null);
    assert.equal("submissionLease" in stored, false, "The failed grading lease must be released for retry");
    const result = await request("a", "GET", `/attempts/${id}`);
    assert.deepEqual(result.attempt.essays, stored.essays);
    assert.equal(result.attempt.status, "in-progress");
  }
  function assertNoPrivateDetails(value: unknown) {
    const rendered = JSON.stringify(value);
    assert.equal(rendered.includes(privateDetail), false);
    assert.equal(rendered.includes(providerSecret), false);
    assert.equal(rendered.includes(essay), false);
  }

  try {
    await database.content.insertOne({ ...content, _id: content.id });
    server = createApp(database, {
      serveClient: false, duoEnabled: false, demoEnabled: false, maxLearners: 2, examIntegrityEnabled: false,
    }).listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    origin = `http://127.0.0.1:${address.port}`;
    for (const who of ["a", "b"] as const) await request(who, "POST", "/auth/register", {
      name: `Synthetic Writing ${who}`, email: `writing-errors-${who}@example.test`,
      password: "synthetic-writing-only-password", targetBand: 6.5, testType: "academic",
    }, 201);
    const first = await begin();

    await t.test("a provider access failure exposes a safe reason and retains the draft", async () => {
      const failure = await request("a", "POST", `/attempts/${first.id}/submit`, {}, 502);
      assert.equal(failure.code, "AI_PROVIDER_AUTH");
      assert.equal(typeof failure.error, "string");
      assert.ok(failure.error.length > 0);
      assertNoPrivateDetails(failure);
      assertNoPrivateDetails(errorLogs);
      await assertRetained(first.id);
      assert.equal(providerCalls, 1);
    });

    await t.test("another learner cannot inspect or retry the failed Writing attempt", async () => {
      const before = await database.attempts.findOne({ _id: first.id });
      await request("b", "GET", `/attempts/${first.id}`, undefined, 404);
      await request("b", "PATCH", `/attempts/${first.id}`, { essays: { [content.sections[0].id]: "foreign edit" } }, 404);
      await request("b", "POST", `/attempts/${first.id}/submit`, {}, 404);
      assert.deepEqual(await database.attempts.findOne({ _id: first.id }), before);
      assert.equal(providerCalls, 1);
    });

    await t.test("retry grades the same saved attempt and preserves its response", async () => {
      mode = "success"; successStep = 0;
      const result = await request("a", "POST", `/attempts/${first.id}/submit`, {});
      assert.equal(result.attempt.id, first.id);
      assert.equal(result.attempt.status, "submitted");
      assert.equal(result.attempt.feedback.source, "ai");
      assert.equal(result.attempt.feedback.estimatedBand, 6);
      assert.equal(result.attempt.essays[content.sections[0].id], essay);
      assert.equal(await database.attempts.countDocuments(), 1);
      assert.equal(providerCalls, 3, "Retry should use only the extraction and scoring calls");
    });

    const completed = await database.attempts.findOne({ _id: first.id });
    const again = await begin();
    for (const failureMode of ["schema", "evidence"] as const) await t.test(`${failureMode} failure preserves strict grading and releases the draft for retry`, async () => {
      mode = failureMode;
      const failure = await request("a", "POST", `/attempts/${again.id}/submit`, {}, 502);
      assert.equal(failure.code, failureMode === "schema" ? "AI_RESPONSE_INVALID" : "AI_EVIDENCE_INVALID");
      assertNoPrivateDetails(failure);
      assertNoPrivateDetails(errorLogs);
      await assertRetained(again.id);
      assert.deepEqual(await database.attempts.findOne({ _id: first.id }), completed, "An earlier completed result must not be changed");
    });

    await t.test("a valid retry after rejected evidence completes without deleting history or recordings", async () => {
      const audioBefore = await database.audio.find({}).toArray();
      mode = "success"; successStep = 0;
      const result = await request("a", "POST", `/attempts/${again.id}/submit`, {});
      assert.equal(result.attempt.status, "submitted");
      assert.equal(result.attempt.feedback.estimatedBand, 6);
      assert.equal(result.attempt.essays[content.sections[0].id], essay);
      assert.deepEqual(await database.attempts.findOne({ _id: first.id }), completed);
      assert.deepEqual(await database.audio.find({}).toArray(), audioBefore);
      assert.equal(await database.attempts.countDocuments(), 2);
      assert.equal(providerCalls, 7);
    });
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
    prior.forEach((value, name) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    });
    if (server) { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve())); }
    assert.match(database.db.databaseName, /^ielts_writing_errors_test_[a-f0-9]{32}$/);
    await database.db.dropDatabase();
    await database.client.close();
  }
});
