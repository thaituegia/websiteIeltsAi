import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { test } from "node:test";
import { createApp } from "../server/app";
import { connectDatabase } from "../server/storage";
import type { Attempt, StoredContent } from "../shared/types";

const names = ["Task Achievement/Response", "Coherence & Cohesion", "Lexical Resource", "Grammatical Range & Accuracy"];
const paragraphText = [
  "Public museums can teach useful skills as well as display old objects. I support short workshops when they help visitors understand the collection. Families’ interests differ, and a practical demonstration may reach a child who ignores a written label. However, the activity should remain connected to the museum's purpose, rather than becoming a general entertainment programme that uses resources without explaining anything about the objects on display.",
  "The organiser don’t always announce changes clearly. One weekly workshop would be easier to explain than a complicated schedule that changes every day. A printed notice should give the time, price and expected age group, while staff should answer questions from people without internet access. Volunteers can help new  visitors find the correct room, although trained employees must remain responsible for safety and for the handling of valuable materials.",
  "A cafe\u0301 meeting point could make registration easier for arriving groups. This does not mean the building should lose its quiet galleries. Managers need to choose spaces where conversation will not interrupt other visitors. They could also ask local schools to reserve a session in advance, making it possible to prepare the correct number of materials and avoid long queues at the entrance during a busy morning.",
  "The leaflet says “ask at reception” because some guests need an alternative to online booking. A visitor should be able to call or speak to a member of staff instead. Overall, workshops can improve a museum visit if they have a clear educational purpose, a realistic timetable and a room that suits the activity. Regular comments from visitors would help managers decide what to continue and what to change next month.",
];
const essay = paragraphText.join("\n");
const originals = ["Families’ interests differ", "new  visitors find the correct room", "A cafe\u0301 meeting point", "The leaflet says “ask at reception”"];
const soft = (value: string) => value.normalize("NFC").replace(/[‘’]/gu, "'").replace(/[“”]/gu, '"').replace(/\s+/gu, " ");
const envNames = ["IELTS_OPENAI_API_KEY", "OPENAI_API_KEY", "EXTRACTOR_MODEL", "SCORING_MODEL", "IELTS_AZURE_SPEECH_KEY", "AZURE_SPEECH_KEY", "ELEVENLABS_API_KEY"];
const providerSecret = "synthetic-writing-layout-provider-not-a-real-key";
const privateProviderText = "SYNTHETIC_PRIVATE_EVIDENCE_NEVER_ECHO";
const sample = "MODEL_PRIVATE_ONLY_AFTER_SUBMISSION: This synthetic model illustrates how an educational workshop can complement a museum collection. It remains separate from the learner's actual response.";

function source(): StoredContent {
  return { id: "synthetic-layout-http", skill: "writing", title: "Museum education", description: "Synthetic evidence recovery fixture",
    topic: "Education", band: 5, cefr: "B1", testType: "both", durationMinutes: 40, format: "lesson", questions: [],
    vocabularyIds: [], tags: [], source: "authored", quality: "authored-unreviewed", createdAt: "2026-11-02T00:00:00.000Z",
    sections: [{ id: "task2", title: "Task 2", task: 2, text: "Should museums provide educational workshops? Give reasons and relevant examples." }],
    referenceAnswers: [{ sectionId: "task2", title: "Task 2 · Synthetic model", sampleAnswer: sample,
      explanation: "Mẫu tổng hợp cho kiểm thử, không phải điểm giám khảo.", keyPoints: ["Trả lời câu hỏi.", "Phát triển ý có liên quan."] }],
  };
}
const envelope = (payload: unknown) => Response.json({ choices: [{ message: { content: JSON.stringify(payload) }, finish_reason: "stop" }] });

test("HTTP Writing preserves a formatted saved essay through evidence rejection and grades its same private sitting on retry", { timeout: 60_000 }, async t => {
  const name = `ielts_writing_evidence_http_${randomUUID().replaceAll("-", "")}`;
  assert.match(name, /^ielts_writing_evidence_http_[a-f0-9]{32}$/u);
  assert.ok(essay.split(/\s+/u).length >= 250);
  const database = await connectDatabase("mongodb://127.0.0.1:27017", name);
  const beforeEnv = new Map(envNames.map(name => [name, process.env[name]]));
  const originalFetch = globalThis.fetch, originalError = console.error;
  let server: Server | undefined, origin = "", mode: "fabricated" | "valid" = "fabricated";
  let calls = 0, step = 0;
  const logs: unknown[][] = [];
  const cookies = { a: "", b: "" };
  const content = source();
  for (const name of envNames) delete process.env[name];
  process.env.IELTS_OPENAI_API_KEY = providerSecret;
  console.error = (...args) => { logs.push(args); };
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://api.openai.com/v1/chat/completions");
    const payload = JSON.parse(String(init?.body));
    const input = JSON.parse(payload.messages[1].content);
    assert.equal(input.tasks[0].essay, essay, "Provider always sees the actual saved essay, not rewritten prose");
    calls++; step++;
    assert.ok(step <= 2, "The app cannot silently issue extra paid requests");
    if (step === 1) {
      assert.deepEqual(input.tasks[0].paragraphs, paragraphText.map((text, index) => ({ index, text })));
      return envelope({ tasks: [{ task: 2,
        quotes: names.map((criterion, index) => ({ criterion, quote: soft(originals[index]), observation: "A controlled source-based observation." })),
        paragraphs: paragraphText.map((_, index) => ({ index, quote: soft(originals[index]), feedback: "Explain this paragraph more fully." })),
        corrections: [{ original: "The organiser don't", suggestion: "The organiser does not", explanation: "Check agreement." }],
      }] });
    }
    assert.deepEqual(input.verifiedEvidence.tasks[0].quotes.map((row: { quote: string }) => row.quote), originals);
    assert.equal(input.verifiedEvidence.tasks[0].corrections[0].original, "The organiser don’t");
    return envelope({ summary: "Synthetic controlled assessment, not an examiner result.", tasks: [{ task: 2, summary: "A grounded practice result.",
      criteria: names.map((name, index) => ({ name, band: 5, confidence: 0.7, feedback: "Develop relevant support.",
        evidence: [mode === "fabricated" && index === 0 ? privateProviderText : soft(originals[index])] })),
    }] });
  };
  async function request(who: "a" | "b", method: string, path: string, body?: unknown, status = 200) {
    const response = await originalFetch(`${origin}/api${path}`, { method,
      headers: { ...(cookies[who] ? { Cookie: cookies[who] } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json();
    assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(result)}`);
    const cookie = response.headers.getSetCookie().at(-1); if (cookie) cookies[who] = cookie.split(";")[0];
    return result;
  }
  try {
    await database.content.insertOne({ ...content, _id: content.id });
    const bankBefore = await database.content.find().toArray();
    server = createApp(database, { serveClient: false, duoEnabled: false, demoEnabled: false, examIntegrityEnabled: false, production: false, maxLearners: 2 }).listen(0, "127.0.0.1");
    await once(server, "listening"); const address = server.address(); assert.ok(address && typeof address !== "string"); origin = `http://127.0.0.1:${address.port}`;
    for (const who of ["a", "b"] as const) await request(who, "POST", "/auth/register", { name: `Synthetic learner ${who}`,
      email: `${who}@writing-evidence.example.test`, password: "synthetic-evidence-only-password", targetBand: 6, testType: "academic" }, 201);
    const started = (await request("a", "POST", "/attempts", { contentId: content.id, mode: "practice" }, 201)).attempt as Attempt;
    await request("a", "PATCH", `/attempts/${started.id}`, { essays: { task2: essay } });
    const saved = await database.attempts.findOne({ _id: started.id }); assert.ok(saved);

    await t.test("a real invalid scorer quotation is rejected, hidden from logs, and leaves the exact draft retryable", async () => {
      const failure = await request("a", "POST", `/attempts/${started.id}/submit`, undefined, 502);
      assert.equal(failure.code, "AI_EVIDENCE_INVALID"); assert.equal(calls, 2);
      for (const privateText of [privateProviderText, providerSecret, essay]) {
        assert.equal(JSON.stringify(failure).includes(privateText), false);
        assert.equal(JSON.stringify(logs).includes(privateText), false);
      }
      const retained = await database.attempts.findOne({ _id: started.id }); assert.ok(retained);
      assert.equal(retained.status, "in-progress"); assert.equal(retained.feedback, null); assert.equal(retained.submittedAt, null);
      assert.deepEqual(retained.essays, saved.essays); assert.equal("submissionLease" in retained, false);
      const review = (await request("a", "GET", `/attempts/${started.id}`)).attempt as Attempt;
      assert.equal(review.feedback, null); assert.equal(JSON.stringify(review).includes(sample), false);
      assert.deepEqual(await database.content.find().toArray(), bankBefore);
    });

    await t.test("another owner cannot inspect, edit or retry the rejected sitting", async () => {
      const before = await database.attempts.findOne({ _id: started.id });
      await request("b", "GET", `/attempts/${started.id}`, undefined, 404);
      await request("b", "PATCH", `/attempts/${started.id}`, { essays: { task2: "another person's edit" } }, 404);
      await request("b", "POST", `/attempts/${started.id}/submit`, undefined, 404);
      assert.equal(calls, 2); assert.deepEqual(await database.attempts.findOne({ _id: started.id }), before);
    });

    await t.test("one valid two-call retry completes the same sitting with exact original evidence, samples and guide", async () => {
      mode = "valid"; step = 0;
      const result = (await request("a", "POST", `/attempts/${started.id}/submit`)).attempt as Attempt;
      assert.equal(calls, 4); assert.equal(result.id, started.id); assert.equal(result.status, "submitted");
      assert.deepEqual(result.essays, saved.essays); assert.equal(result.feedback?.source, "ai"); assert.equal(result.feedback?.estimatedBand, 5);
      assert.deepEqual(result.feedback?.criteria.map(criterion => criterion.evidence[0]), originals);
      assert.equal(result.feedback?.corrections[0].original, "The organiser don’t");
      assert.deepEqual(result.feedback?.referenceAnswers, content.referenceAnswers);
      assert.equal(result.feedback?.writingGuides?.length, 1);
      const completed = await database.attempts.findOne({ _id: started.id });
      assert.deepEqual(completed?.feedback, result.feedback);
      const again = (await request("a", "GET", `/attempts/${started.id}`)).attempt as Attempt;
      assert.deepEqual(again.feedback, result.feedback); assert.deepEqual(again.essays, saved.essays);
      await request("b", "GET", `/attempts/${started.id}`, undefined, 404);
      assert.equal(calls, 4); assert.equal(await database.attempts.countDocuments(), 1);
      assert.deepEqual(await database.content.find().toArray(), bankBefore);
      assert.equal(await database.audio.countDocuments(), 0);
    });
  } finally {
    globalThis.fetch = originalFetch; console.error = originalError;
    for (const [name, value] of beforeEnv) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
    assert.match(database.db.databaseName, /^ielts_writing_evidence_http_[a-f0-9]{32}$/u);
    await database.db.dropDatabase(); await database.client.close();
  }
});
