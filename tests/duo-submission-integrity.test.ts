import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { test } from "node:test";
import { createApp } from "../server/app";
import { hashPassword } from "../server/auth";
import { parseDuoCredentials, provisionDuoAccounts } from "../server/duo-auth";
import { connectDatabase } from "../server/storage";
import type { Attempt, StoredContent } from "../shared/types";

const writingNames = ["Task Achievement/Response", "Coherence & Cohesion", "Lexical Resource", "Grammatical Range & Accuracy"];
const speakingNames = ["Fluency & Coherence", "Lexical Resource", "Grammatical Range & Accuracy", "Pronunciation"];
const transcript = "Public transport provides convenient access to education and employment. Frequent buses can reduce travel costs for families.";
function gate() {
  let enter!: () => void; let release!: () => void;
  return { entered: new Promise<void>(resolve => { enter = resolve; }),
    released: new Promise<void>(resolve => { release = resolve; }), enter: () => enter(), release: () => release() };
}
async function entered(value: ReturnType<typeof gate>) {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([value.entered, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Controlled operation did not start")), 8_000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
function content(id: string, skill: "writing" | "speaking"): StoredContent {
  return { id, skill, title: `Synthetic ${skill} integrity fixture`, description: "Isolated HTTP integrity check",
    topic: "transport", band: 8, cefr: "C1", testType: "academic", durationMinutes: 60, format: "lesson",
    sections: [{ id: "task-2", title: skill === "writing" ? "Task 2" : "Part 2", text: "Discuss public transport.",
      ...(skill === "writing" ? { task: 2 as const } : { part: 2 }) }],
    questions: [], vocabularyIds: [], tags: [], source: "authored", quality: "authored-unreviewed", createdAt: new Date(0).toISOString() };
}
function wav(fill: number): Buffer {
  const body = Buffer.alloc(3200, fill); const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + body.length, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(body.length, 40); return Buffer.concat([header, body]);
}

test("real Duo HTTP fences grading drafts and audio across app instances without exposing lease tokens", { timeout: 60_000 }, async t => {
  const dbName = `ielts_duo_integrity_test_${randomUUID().replaceAll("-", "")}`;
  const database = await connectDatabase(process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017", dbName);
  const servers: Server[] = [];
  const keys = ["IELTS_OPENAI_API_KEY", "OPENAI_API_KEY", "IELTS_AZURE_SPEECH_KEY", "AZURE_SPEECH_KEY", "IELTS_AZURE_SPEECH_REGION", "AZURE_SPEECH_REGION"];
  const priorKeys = new Map(keys.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  const originalUpload = database.recordings.openUploadStream.bind(database.recordings);
  let gradingGate: ReturnType<typeof gate> | undefined;
  let uploadGate: ReturnType<typeof gate> | undefined;
  let offset = 0;
  try {
    keys.forEach(key => delete process.env[key]);
    process.env.IELTS_OPENAI_API_KEY = "synthetic-integrity-transport-token";
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith("http://127.0.0.1:")) return originalFetch(input, init);
      if (url === "https://api.openai.com/v1/audio/transcriptions") return Response.json({ text: transcript, duration: 0.1 });
      assert.equal(url, "https://api.openai.com/v1/chat/completions", "No real external provider request is allowed");
      const requestBody = JSON.parse(String(init?.body));
      const payload = JSON.parse(requestBody.messages[1].content);
      const currentGate = gradingGate;
      if (currentGate && (!payload.verifiedEvidence)) {
        gradingGate = undefined; currentGate.enter(); await currentGate.released;
      }
      let result: unknown;
      if (payload.tasks && !payload.verifiedEvidence) {
        result = { tasks: payload.tasks.map((task: { task: number; essay: string }) => ({ task: task.task,
          quotes: writingNames.map(criterion => ({ criterion, quote: task.essay.slice(0, 24), observation: "Synthetic exact evidence" })),
          paragraphs: [], corrections: [] })) };
      } else if (payload.verifiedEvidence) {
        result = { summary: "Controlled synthetic assessment", tasks: payload.tasks.map((task: { task: number; essay: string }) => ({
          task: task.task, summary: "Controlled task feedback", criteria: writingNames.map(name => ({ name, band: 8,
            confidence: 0.8, feedback: "Synthetic transport validation", evidence: [task.essay.slice(0, 24)] })) })) };
      } else {
        result = { summary: "Controlled synthetic speech feedback", criteria: speakingNames.map(name => ({ name,
          band: ["Lexical Resource", "Grammatical Range & Accuracy"].includes(name) ? 8 : null,
          confidence: ["Lexical Resource", "Grammatical Range & Accuracy"].includes(name) ? 0.8 : null,
          feedback: "Synthetic text evidence; acoustic scores unavailable", evidence: [payload.transcript.slice(0, 24)] })), corrections: [] };
      }
      return Response.json({ choices: [{ message: { content: JSON.stringify(result) }, finish_reason: "stop" }] });
    };
    await database.content.insertMany([content("writing-source-a", "writing"), content("writing-source-b", "writing"), content("writing-source-c", "writing"), content("speaking-source-a", "speaking"), content("speaking-source-b", "speaking")].map(item => ({ ...item, _id: item.id })));
    const settings = parseDuoCredentials({ duoId: "synthetic-integrity-duo", accounts: [
      { role: "husband", name: "Synthetic Integrity A", phone: "0390000021", passwordHash: await hashPassword("synthetic-integrity-password-a") },
      { role: "wife", name: "Synthetic Integrity B", phone: "0390000022", passwordHash: await hashPassword("synthetic-integrity-password-b") },
    ] });
    await provisionDuoAccounts(database, settings);
    const origins: string[] = [];
    for (let index = 0; index < 2; index++) {
      // Legacy API/resume fixtures omit monitoring; dedicated native/browser integrity suites cover strict policy.
      const server = createApp(database, { duoEnabled: true, duoCredentials: settings, production: false, serveClient: false, examIntegrityEnabled: false,
        duo: { now: () => Date.now() + offset } }).listen(0, "127.0.0.1");
      servers.push(server); await once(server, "listening"); const address = server.address();
      assert.ok(address && typeof address !== "string"); origins.push(`http://127.0.0.1:${address.port}`);
    }
    let cookie = "";
    async function request(instance: number, method: string, path: string, input?: unknown, expected = 200): Promise<any> {
      const response = await fetch(origins[instance] + "/api" + path, { method,
        headers: { ...(cookie ? { Cookie: cookie } : {}), ...(input !== undefined ? { "Content-Type": "application/json" } : {}) },
        ...(input !== undefined ? { body: JSON.stringify(input) } : {}) });
      const body = await response.json(); assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(body)}`);
      const createdCookie = response.headers.getSetCookie().at(-1); if (createdCookie) cookie = createdCookie.split(";")[0];
      return body;
    }
    const user = (await request(0, "POST", "/auth/login", { phone: settings.accounts[0].phone, password: "synthetic-integrity-password-a" })).user;
    async function attempt(contentId: string): Promise<Attempt> {
      return (await request(0, "POST", "/attempts", { contentId, mode: "practice" }, 201)).attempt;
    }
    async function speech(instance: number, id: string, audio: Buffer, expected = 200) {
      const form = new FormData(); form.append("transcript", transcript);
      form.append("audio", new Blob([new Uint8Array(audio)], { type: "audio/wav" }), "synthetic.wav");
      const response = await fetch(origins[instance] + `/api/attempts/${id}/speaking`, { method: "POST", headers: { Cookie: cookie }, body: form });
      const body = await response.json(); assert.equal(response.status, expected, `Speaking: ${JSON.stringify(body)}`); return body;
    }
    async function assertNoLease(id: string) {
      const view = await request(1, "GET", `/attempts/${id}`); const exported = await request(1, "GET", "/account/export");
      assert.ok(!JSON.stringify(view).includes("submissionLease")); assert.ok(!JSON.stringify(exported).includes("submissionLease"));
      const stored = await database.attempts.findOne({ _id: id });
      const token = (stored as typeof stored & { submissionLease?: { token: string } })?.submissionLease?.token;
      assert.ok(token); assert.ok(!JSON.stringify(view).includes(token)); assert.ok(!JSON.stringify(exported).includes(token));
    }
    await t.test("a slow grade rejects edits and duplicate submit from either app instance", async () => {
      const record = await attempt("writing-source-a"); const essay = transcript + " This essay is the original accepted draft.";
      await request(0, "PATCH", `/attempts/${record.id}`, { essays: { "task-2": essay } });
      const held = gate(); gradingGate = held;
      const submission = request(0, "POST", `/attempts/${record.id}/submit`, {});
      try {
        await entered(held);
        await request(0, "PATCH", `/attempts/${record.id}`, { essays: { "task-2": "A local replacement" } }, 409);
        await request(1, "PATCH", `/attempts/${record.id}`, { essays: { "task-2": "A remote replacement" } }, 409);
        await request(1, "POST", `/attempts/${record.id}/submit`, {}, 409);
        await assertNoLease(record.id);
      } finally { held.release(); }
      const result = (await submission).attempt;
      assert.equal(result.status, "submitted"); assert.equal(result.essays["task-2"], essay); assert.equal(result.feedback.estimatedBand, 8);
      assert.equal((await database.attempts.findOne({ _id: record.id }) as any).submissionLease, undefined);
    });
    await t.test("a stale in-flight writer cannot attach feedback to a changed source and can retry", async () => {
      const record = await attempt("writing-source-b"); const original = transcript + " Original draft.";
      const replacement = "Walking to school helps families save money. This is a separate replacement draft.";
      await request(0, "PATCH", `/attempts/${record.id}`, { essays: { "task-2": original } });
      const held = gate(); gradingGate = held;
      const submission = request(0, "POST", `/attempts/${record.id}/submit`, {}, 409);
      try {
        await entered(held);
        // Simulates a request from an older worker that read before our lease.
        await database.attempts.updateOne({ _id: record.id }, { $set: { essays: { "task-2": replacement } } });
      } finally { held.release(); }
      await submission; const stored = await database.attempts.findOne({ _id: record.id });
      assert.equal(stored?.status, "in-progress"); assert.equal(stored?.feedback, null); assert.equal(stored?.essays["task-2"], replacement);
      assert.equal((stored as any).submissionLease, undefined);
      const retry = (await request(1, "POST", `/attempts/${record.id}/submit`, {})).attempt;
      assert.equal(retry.feedback.estimatedBand, 8); assert.equal(retry.essays["task-2"], replacement);
      assert.equal(retry.feedback.criteria[0].evidence[0], replacement.slice(0, 24));
    });
    await t.test("an autosave paused after reading the draft is fenced when grading claims it", async () => {
      const record = await attempt("writing-source-c");
      await request(0, "PATCH", `/attempts/${record.id}`, { essays: { "task-2": transcript } });
      const originalUpdate = database.attempts.findOneAndUpdate.bind(database.attempts);
      const draftHeld = gate(); const gradeHeld = gate(); let pauseDraft = true;
      database.attempts.findOneAndUpdate = (async (...args: Parameters<typeof originalUpdate>) => {
        if (pauseDraft && Array.isArray(args[1])) {
          pauseDraft = false; draftHeld.enter(); await draftHeld.released;
        }
        return originalUpdate(...args);
      }) as typeof database.attempts.findOneAndUpdate;
      const lateSave = request(1, "PATCH", `/attempts/${record.id}`, { essays: { "task-2": "A stale in-flight replacement." } }, 409);
      let submission: Promise<any> | undefined;
      try {
        await entered(draftHeld); gradingGate = gradeHeld;
        submission = request(0, "POST", `/attempts/${record.id}/submit`, {});
        await entered(gradeHeld); draftHeld.release(); await lateSave;
        assert.equal((await database.attempts.findOne({ _id: record.id }))?.essays["task-2"], transcript);
      } finally {
        draftHeld.release(); gradeHeld.release(); database.attempts.findOneAndUpdate = originalUpdate;
      }
      assert.equal((await submission).attempt.essays["task-2"], transcript);
    });
    await t.test("duplicate speech does not replace GridFS audio or transcript during grading", async () => {
      const record = await attempt("speaking-source-a"); const original = wav(1); const replacement = wav(2);
      const held = gate(); gradingGate = held; const submission = speech(0, record.id, original);
      try {
        await entered(held); const pointer = await database.audio.findOne({ attemptId: record.id }); assert.ok(pointer);
        await speech(1, record.id, replacement, 409);
        await request(1, "PATCH", `/attempts/${record.id}`, { transcript: "Replacement transcript" }, 409);
        await assertNoLease(record.id);
        assert.equal((await database.audio.findOne({ attemptId: record.id }))?.fileId.toHexString(), pointer.fileId.toHexString());
        assert.equal(await database.db.collection("recordings.files").countDocuments({ "metadata.attemptId": record.id }), 1);
      } finally { held.release(); }
      const result = (await submission).attempt; assert.equal(result.status, "submitted"); assert.equal(result.transcript, transcript);
      assert.equal(result.feedback.criteria.find((item: { name: string }) => item.name === "Lexical Resource").band, 8);
      const audio = await originalFetch(origins[1] + `/api/attempts/${record.id}/audio`, { headers: { Cookie: cookie } });
      assert.deepEqual(Buffer.from(await audio.arrayBuffer()), original);
      assert.equal((await database.attempts.findOne({ _id: record.id }) as any).submissionLease, undefined);
    });
    await t.test("a reclaimed upload lease cannot overwrite or delete the newer worker's recording", async () => {
      const record = await attempt("speaking-source-b");
      const priorStream = originalUpload("prior-synthetic.wav", { metadata: { userId: user.id, attemptId: record.id }, contentType: "audio/wav" });
      const priorFinished = once(priorStream, "finish"); priorStream.end(wav(3)); await priorFinished;
      await database.audio.insertOne({ _id: randomUUID(), userId: user.id, attemptId: record.id, fileId: priorStream.id, mime: "audio/wav", createdAt: new Date().toISOString() });
      const held = gate(); uploadGate = held;
      database.recordings.openUploadStream = ((filename, options) => {
        const stream = originalUpload(filename, options); const current = uploadGate; uploadGate = undefined;
        if (current) {
          const emit = stream.emit.bind(stream);
          stream.emit = ((event: string | symbol, ...args: unknown[]) => {
            if (event !== "finish") return emit(event, ...args);
            current.enter(); void current.released.then(() => emit(event, ...args)); return true;
          }) as typeof stream.emit;
        }
        return stream;
      }) as typeof database.recordings.openUploadStream;
      const stale = speech(0, record.id, wav(4), 409);
      try {
        await entered(held);
        const leased = await database.attempts.findOne({ _id: record.id }) as any;
        assert.ok(Date.parse(leased.submissionLease.expiresAt) - Date.now() >= 19 * 60_000, "Lease covers the full 17-minute provider budget");
        offset += 21 * 60_000;
        const current = (await speech(1, record.id, wav(5))).attempt; assert.equal(current.status, "submitted");
        const pointer = await database.audio.findOne({ attemptId: record.id }); assert.ok(pointer);
        held.release(); await stale;
        assert.equal((await database.audio.findOne({ attemptId: record.id }))?.fileId.toHexString(), pointer.fileId.toHexString());
        assert.equal(await database.db.collection("recordings.files").countDocuments({ "metadata.attemptId": record.id }), 1);
        const audio = await originalFetch(origins[1] + `/api/attempts/${record.id}/audio`, { headers: { Cookie: cookie } });
        assert.deepEqual(Buffer.from(await audio.arrayBuffer()), wav(5));
        assert.equal((await database.attempts.findOne({ _id: record.id }) as any).submissionLease, undefined);
      } finally { held.release(); await stale.catch(() => {}); database.recordings.openUploadStream = originalUpload; }
    });
  } finally {
    gradingGate?.release(); uploadGate?.release(); globalThis.fetch = originalFetch; database.recordings.openUploadStream = originalUpload;
    keys.forEach(key => { const value = priorKeys.get(key); if (value === undefined) delete process.env[key]; else process.env[key] = value; });
    for (const server of servers) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
    assert.match(database.db.databaseName, /^ielts_duo_integrity_test_[a-f0-9]{32}$/);
    await database.db.dropDatabase(); await database.client.close();
  }
});
