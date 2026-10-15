import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { test } from "node:test";
import { createApp } from "../server/app";
import { SpeechAudioCache } from "../server/speech-audio";
import { connectDatabase, type AttemptRecord, type PlacementRecord } from "../server/storage";
import type { Feedback, PlacementItem, StoredContent } from "../shared/types";

type Learner = "a" | "b";
type HttpResult = { status: number; headers: Headers; bytes: Buffer; body: any };
const databasePattern = /^ielts_review_audio_test_[a-f0-9]{32}$/;
const providerKeys = ["IELTS_OPENAI_API_KEY", "OPENAI_API_KEY", "IELTS_AZURE_SPEECH_KEY", "AZURE_SPEECH_KEY", "SPEAKING_AUDIO_MODEL", "ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_BRITISH", "ELEVENLABS_VOICE_AMERICAN", "ELEVENLABS_VOICE_AUSTRALIAN", "ELEVENLABS_MODEL"];
const timestamp = "2026-10-15T04:00:00.000Z";

function listening(id: string): StoredContent {
  return {
    id, skill: "listening", title: "Synthetic review listening", description: "Isolated audio review fixture", topic: "Community", band: 5, cefr: "B1",
    testType: "academic", durationMinutes: 10, format: "lesson", vocabularyIds: [], tags: ["synthetic-review"], source: "authored", quality: "authored-unreviewed", createdAt: timestamp,
    sections: ["Amber", "Birch"].map((name, index) => {
      const dialogue = [
        { speaker: "Visitor", accent: "british" as const, text: `Where can I collect the ${name.toLowerCase()} workshop notebook before the afternoon session?` },
        { speaker: "Coordinator", accent: "british" as const, text: `Please collect your ${name.toLowerCase()} workshop notebook from reception. The ${name} group meets beside the garden after the safety briefing. The coordinator will explain the route and answer questions before the group leaves. Bring a bottle of water for the walk.` },
      ];
      return { id: `${id}-section-${index}`, title: `Part ${index + 1}`, text: dialogue.map(row => row.text).join(" "), dialogue };
    }),
    questions: [{ id: `${id}-question`, number: 1, sectionIndex: 0, type: "text", questionType: "short-answer", prompt: "Where should visitors collect their notebooks?", answer: "reception", explanation: "The coordinator identifies reception.", evidence: "from reception", subskill: "details" }],
  };
}

function completedFeedback(): Feedback {
  return {
    id: randomUUID(), estimatedBand: 5, rawScore: 1, total: 1, criteria: [], strengths: [], improvements: [], answers: [],
    source: "rule-based", createdAt: timestamp,
  } as unknown as Feedback;
}

function wav(sample = 200): Buffer {
  const body = Buffer.alloc(64_000), header = Buffer.alloc(44);
  for (let offset = 0; offset < body.length; offset += 2) body.writeInt16LE(sample, offset);
  header.write("RIFF", 0); header.writeUInt32LE(body.length + 36, 4); header.write("WAVEfmt ", 8); header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(16_000, 24); header.writeUInt32LE(32_000, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(body.length, 40);
  return Buffer.concat([header, body]);
}

test("native HTTP review audio seeks prepared listening and private speaking recordings without changing a sitting", { timeout: 60_000 }, async t => {
  // The application database and any real paid credentials are deliberately ignored.
  const name = `ielts_review_audio_test_${randomUUID().replaceAll("-", "")}`;
  assert.match(name, databasePattern);
  const prior = new Map(providerKeys.map(key => [key, process.env[key]]));
  providerKeys.forEach(key => delete process.env[key]);
  process.env.IELTS_OPENAI_API_KEY = "sk-synthetic-review-audio-no-paid-calls";
  const originalFetch = globalThis.fetch;
  let providerCalls = 0, providerAllowed = true;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.openai.com/v1/audio/speech", "No real or unrelated provider requests are allowed");
    assert.equal(providerAllowed, true, "Review replay must never generate new paid audio");
    providerCalls++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.response_format, "pcm");
    const sample = String(body.input).includes("Birch") || String(body.input).includes("birch") ? 1600 : 800;
    const bytes = Buffer.alloc(24);
    for (let offset = 0; offset < bytes.length; offset += 2) bytes.writeInt16LE(sample + offset, offset);
    return new Response(bytes, { headers: { "Content-Type": "audio/pcm", "Content-Length": String(bytes.length) } });
  };
  let database: Awaited<ReturnType<typeof connectDatabase>> | undefined, server: Server | undefined, origin = "";
  const cookies: Record<Learner, string> = { a: "", b: "" }, users: Record<Learner, string> = { a: "", b: "" };
  const content = listening("synthetic-review-prepared"), cold = listening("synthetic-review-cold");
  // The cold material must have distinct speech fingerprints, not merely new IDs.
  cold.sections.forEach(section => {
    section.text = section.text.replaceAll("workshop", "fieldwork");
    section.dialogue!.forEach(turn => { turn.text = turn.text.replaceAll("workshop", "fieldwork"); });
  });
  const speaking: StoredContent = { ...content, id: "synthetic-review-speaking", skill: "speaking", sections: [{ id: "synthetic-review-speaking-cue", title: "Part 2", text: "Describe a useful community activity and explain why you enjoyed it." }] };
  const listeningItem: PlacementItem = { id: "synthetic-review-placement-listening", skill: "listening", text: "Teacher: Where does the community class meet on Tuesday? Student: It meets in the library beside reception. Teacher: Please bring a notebook and arrive before the afternoon session begins.", question: "Where does the class meet?", options: ["library", "garden", "hall", "cafe"], answer: "library", explanation: "The student identifies the library.", band: 5, cefr: "B1", difficulty: 0, subskill: "details" };
  const readingItem: PlacementItem = { ...listeningItem, id: "synthetic-review-placement-reading", skill: "reading", text: "The community class meets in the library." };
  const unaskedItem: PlacementItem = { ...listeningItem, id: "synthetic-review-placement-unasked", text: listeningItem.text.replaceAll("Tuesday", "Friday") };

  async function request(who: Learner | null, method: string, path: string, expected = 200, payload?: unknown, headers: Record<string, string> = {}): Promise<HttpResult> {
    const response = await originalFetch(`${origin}/api${path}`, {
      method, headers: { ...(who ? { Cookie: cookies[who] } : {}), ...(payload === undefined || payload instanceof FormData ? {} : { "Content-Type": "application/json" }), ...headers },
      ...(payload === undefined ? {} : { body: payload instanceof FormData ? payload : JSON.stringify(payload) }),
    });
    const cookie = response.headers.getSetCookie().at(-1);
    if (who && cookie) cookies[who] = cookie.split(";")[0];
    const bytes = Buffer.from(await response.arrayBuffer());
    const body = response.headers.get("content-type")?.includes("application/json") ? JSON.parse(bytes.toString()) : null;
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(body)}`);
    return { status: response.status, headers: response.headers, bytes, body };
  }
  async function insertAttempt(item: StoredContent, status: AttemptRecord["status"], owner: Learner = "a", extra: Partial<AttemptRecord> = {}): Promise<AttemptRecord> {
    const id = randomUUID();
    const row: AttemptRecord = {
      _id: id, id, userId: users[owner], contentId: item.id, title: item.title, skill: item.skill, mode: "exam", status,
      startedAt: timestamp, deadlineAt: "2026-10-15T06:00:00.000Z", submittedAt: status === "submitted" ? timestamp : null,
      durationSeconds: 120, responses: { [item.questions[0].id]: "reception" }, essays: {}, transcript: "", feedback: status === "submitted" ? completedFeedback() : null,
      ...(status === "invalidated" ? { invalidatedAt: timestamp } : {}), ...extra,
    };
    await database!.attempts.insertOne(row);
    return row;
  }
  async function snapshot() {
    const names = (await database!.db.listCollections({}, { nameOnly: true }).toArray()).map(row => row.name).sort();
    return Object.fromEntries(await Promise.all(names.map(async collection => [collection, await database!.db.collection(collection).find().sort({ _id: 1 }).toArray()])));
  }
  function assertAudio(response: HttpResult, expected: Buffer, status = 200) {
    assert.equal(response.status, status);
    assert.match(response.headers.get("content-type") ?? "", /^audio\/wav\b/u);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("accept-ranges"), "bytes");
    assert.equal(response.headers.get("content-length"), String(expected.length));
    assert.deepEqual(response.bytes, expected);
  }
  async function assertRanges(path: string, expected: Buffer) {
    for (const [range, from, to] of [["bytes=0-43", 0, 43], ["bytes=44-", 44, expected.length - 1], ["bytes=-8", expected.length - 8, expected.length - 1]] as const) {
      const response = await request("a", "GET", path, 206, undefined, { Range: range });
      assertAudio(response, expected.subarray(from, to + 1), 206);
      assert.equal(response.headers.get("content-range"), `bytes ${from}-${to}/${expected.length}`);
    }
    for (const range of [`bytes=${expected.length}-`, "bytes=8-2", "bytes=-0", "bytes=0-1,4-5", "bytes=malformed"]) {
      const response = await request("a", "GET", path, 416, undefined, { Range: range });
      assert.equal(response.headers.get("content-range"), `bytes */${expected.length}`);
    }
  }
  try {
    database = await connectDatabase("mongodb://127.0.0.1:27017", name);
    await database.content.insertMany([content, cold, speaking].map(item => ({ ...item, _id: item.id })));
    await database.placementItems.insertMany([listeningItem, readingItem, unaskedItem].map(item => ({ ...item, _id: item.id })));
    server = createApp(database, { production: false, serveClient: false, duoEnabled: false, demoEnabled: false, maxLearners: 2, examIntegrityEnabled: false, duo: { now: () => Date.parse(timestamp) } }).listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address(); assert.ok(address && typeof address !== "string");
    origin = `http://127.0.0.1:${address.port}`;
    for (const who of ["a", "b"] as const) {
      users[who] = (await request(who, "POST", "/auth/register", 201, { name: `Synthetic Review ${who}`, email: `synthetic-review-${who}@example.test`, password: "synthetic-review-only-password", targetBand: 6.5, testType: "academic" })).body.user.id;
    }
    const cache = new SpeechAudioCache(database);
    const full = await cache.get(content.sections);
    const sections = await Promise.all(content.sections.map(section => cache.getReady([section])));
    const placementAudio = await cache.get([{ id: listeningItem.id, title: "", text: listeningItem.text }]);
    providerAllowed = false;
    const warmedCalls = providerCalls;

    await t.test("submitted Listening replays each prepared section and the full audio with seek ranges, without consuming a play", async () => {
      const done = await insertAttempt(content, "submitted", "a", { listeningPlayed: true });
      const before = await snapshot();
      assertAudio(await request("a", "GET", `/attempts/${done.id}/listening-audio`), full.buffer);
      for (const [index, section] of sections.entries()) {
        const path = `/attempts/${done.id}/listening-audio?sectionIndex=${index}`;
        assertAudio(await request("a", "GET", path), section.buffer);
        await assertRanges(path, section.buffer);
      }
      // The original POST remains the protected in-progress playback contract.
      // Replay belongs exclusively to GET and cannot reclaim an exam play.
      await request("a", "POST", `/attempts/${done.id}/listening-audio`, 409);
      assert.equal(providerCalls, warmedCalls);
      assert.deepEqual(await snapshot(), before, "Review must preserve all answers, timers, transcripts, play claims and prepared speech");
    });

    await t.test("review audio is authenticated, owner scoped, submitted only and rejects invalid section selectors", async () => {
      const done = await insertAttempt(content, "submitted"), active = await insertAttempt(content, "in-progress"), invalid = await insertAttempt(content, "invalidated");
      const otherSkill = await insertAttempt(speaking, "submitted"), missing = await insertAttempt(cold, "submitted");
      const before = await snapshot();
      await request(null, "GET", `/attempts/${done.id}/listening-audio?sectionIndex=0`, 401);
      await request("b", "GET", `/attempts/${done.id}/listening-audio?sectionIndex=0`, 404);
      await request("b", "POST", `/attempts/${done.id}/listening-audio`, 404, { sectionIndex: 0 });
      await request("a", "GET", `/attempts/${active.id}/listening-audio?sectionIndex=0`, 409);
      await request("a", "GET", `/attempts/${invalid.id}/listening-audio?sectionIndex=0`, 409);
      await request("a", "GET", `/attempts/${otherSkill.id}/listening-audio?sectionIndex=0`, 400);
      await request("a", "GET", `/attempts/${missing.id}/listening-audio?sectionIndex=0`, 409);
      for (const selector of ["-1", "2", "bad", "0.5", "0&sectionIndex=1"]) await request("a", "GET", `/attempts/${done.id}/listening-audio?sectionIndex=${selector}`, 400);
      assert.equal(providerCalls, warmedCalls);
      assert.deepEqual(await snapshot(), before);
    });

    await t.test("completed placement replays only an answered Listening question and leaves its result unchanged", async () => {
      const id = randomUUID();
      const row: PlacementRecord = {
        _id: id, userId: users.a, mode: "quick", total: 2, theta: 0, standardError: 0.5, estimatedBand: 5,
        currentQuestionId: null, answers: [{ questionId: listeningItem.id, answer: listeningItem.answer, correct: true }, { questionId: readingItem.id, answer: readingItem.answer, correct: true }],
        result: completedFeedback(), startedAt: timestamp, deadlineAt: "2026-10-15T04:30:00.000Z", completedAt: timestamp, completionReason: "answered",
      };
      const activeId = randomUUID(), invalidId = randomUUID();
      await database!.placements.insertMany([row,
        { ...row, _id: activeId, currentQuestionId: listeningItem.id, result: null, completedAt: undefined, completionReason: undefined },
        { ...row, _id: invalidId, invalidatedAt: timestamp, completionReason: "invalidated" },
      ]);
      const before = await snapshot(), path = `/placement/${id}/audio?questionId=${listeningItem.id}`;
      assertAudio(await request("a", "GET", path), placementAudio.buffer);
      await assertRanges(path, placementAudio.buffer);
      await request(null, "GET", path, 401);
      await request("b", "GET", path, 404);
      await request("a", "GET", `/placement/${activeId}/audio?questionId=${listeningItem.id}`, 409);
      await request("a", "GET", `/placement/${invalidId}/audio?questionId=${listeningItem.id}`, 409);
      await request("a", "GET", `/placement/${id}/audio?questionId=${unaskedItem.id}`, 404);
      await request("a", "GET", `/placement/${id}/audio?questionId=${readingItem.id}`, 400);
      await request("a", "GET", `/placement/${id}/audio`, 400);
      await request("a", "GET", `${path}&questionId=${unaskedItem.id}`, 400);
      assert.equal(providerCalls, warmedCalls);
      assert.deepEqual(await snapshot(), before);
    });

    await t.test("a saved Speaking recording serves seekable original bytes only to its owner", async () => {
      const done = await insertAttempt(speaking, "submitted", "a", { transcript: "The AI-recognized transcript remains saved with this recording." });
      const recording = Buffer.from(Array.from({ length: 128 }, (_, index) => index));
      const upload = database!.recordings.openUploadStream("synthetic-private-review.wav", { metadata: { userId: users.a, attemptId: done.id } });
      const finished = once(upload, "finish"); upload.end(recording); await finished;
      await database!.audio.insertOne({ _id: randomUUID(), userId: users.a, attemptId: done.id, fileId: upload.id, mime: "audio/wav", createdAt: timestamp });
      const invalid = await insertAttempt(speaking, "invalidated");
      await database!.audio.insertOne({ _id: randomUUID(), userId: users.a, attemptId: invalid.id, fileId: upload.id, mime: "audio/wav", createdAt: timestamp });
      const forged = await insertAttempt(speaking, "submitted", "b");
      await database!.audio.insertOne({ _id: randomUUID(), userId: users.b, attemptId: forged.id, fileId: upload.id, mime: "audio/wav", createdAt: timestamp });
      const before = await snapshot(), path = `/attempts/${done.id}/audio`;
      assertAudio(await request("a", "GET", path), recording);
      await assertRanges(path, recording);
      await request(null, "GET", path, 401);
      await request("b", "GET", path, 404);
      await request("a", "GET", `/attempts/${invalid.id}/audio`, 404);
      await request("b", "GET", `/attempts/${forged.id}/audio`, 404);
      assert.equal(providerCalls, warmedCalls);
      assert.deepEqual(await snapshot(), before, "Replay must preserve the original recording, recognized transcript and assessment");
    });

    await t.test("Speaking retains recognition through scoring failure, drops stale text on replacement, and saves a completed review", async () => {
      const attempt = await insertAttempt(speaking, "in-progress");
      const recognized = "I enjoyed the community garden because it helped our neighbours learn practical skills together.";
      const controlledSpeechFetch = globalThis.fetch;
      let sttFails = false, scoreFails = true, sttCalls = 0, scoreCalls = 0;
      globalThis.fetch = async (input, init) => {
        const url = String(input);
        if (url === "https://api.openai.com/v1/audio/transcriptions") {
          sttCalls++;
          assert.ok(init?.body instanceof FormData);
          return sttFails ? Response.json({ error: { message: "Synthetic recognition unavailable" } }, { status: 503 }) : Response.json({ text: recognized, duration: 2 });
        }
        assert.equal(url, "https://api.openai.com/v1/chat/completions", "Speaking tests intercept every provider destination");
        scoreCalls++;
        const recognizedBeforeScoring = await database!.audio.findOne({ userId: users.a, attemptId: attempt.id });
        assert.equal(recognizedBeforeScoring?.recognizedTranscript, recognized, "Persist recognition before requesting the separate scoring service");
        if (scoreFails) return Response.json({ error: { message: "Synthetic scoring unavailable" } }, { status: 503 });
        return Response.json({ choices: [{ message: { content: JSON.stringify({ summary: "Controlled transcript feedback.", criteria: ["Fluency & Coherence", "Lexical Resource", "Grammatical Range & Accuracy", "Pronunciation"].map(name => ({ name, band: name === "Pronunciation" || name === "Fluency & Coherence" ? null : 6, confidence: 0.5, feedback: "Controlled feedback.", evidence: ["community garden"] })), corrections: [] }) } }] });
      };
      async function upload(sample: number, expected: number) {
        const form = new FormData();
        form.append("audio", new Blob([new Uint8Array(wav(sample))], { type: "audio/wav" }), "synthetic-speaking.wav");
        return request("a", "POST", `/attempts/${attempt.id}/speaking`, expected, form);
      }
      try {
        await upload(200, 502);
        const first = await database!.audio.findOne({ userId: users.a, attemptId: attempt.id }); assert.ok(first);
        assert.equal(first.recognizedTranscript, recognized, "Recognition survives a later scoring service failure");
        const draft = (await request("a", "GET", `/attempts/${attempt.id}`)).body.attempt;
        assert.equal(draft.status, "in-progress"); assert.equal(draft.audioAvailable, true); assert.equal(draft.speakingReview, undefined);

        sttFails = true;
        await upload(500, 502);
        const replacement = await database!.audio.findOne({ userId: users.a, attemptId: attempt.id }); assert.ok(replacement);
        assert.notEqual(replacement.fileId.toHexString(), first.fileId.toHexString());
        assert.equal(replacement.recognizedTranscript, undefined, "A new recording cannot inherit words recognized from the old file");

        sttFails = false; scoreFails = false;
        const submitted = (await request("a", "POST", `/attempts/${attempt.id}/speaking`, 200, new FormData())).body.attempt;
        assert.equal(submitted.status, "submitted"); assert.equal(submitted.transcript, recognized);
        assert.equal(submitted.feedback.transcriptSource, "speech-recognition");
        assert.equal(submitted.speakingReview.transcript, recognized);
        assert.equal(submitted.speakingReview.recognizedTranscript, recognized);
        assert.equal(submitted.speakingReview.transcriptSource, "speech-recognition");
        assert.equal(submitted.speakingReview.recordingAvailable, true);
        assert.deepEqual(submitted.speakingReview.prompts.map((prompt: { text: string }) => prompt.text), speaking.sections.map(section => section.text));
        const saved = await database!.audio.findOne({ userId: users.a, attemptId: attempt.id }); assert.ok(saved);
        assert.equal(saved.recognizedTranscript, recognized);
        const originalPrompt = submitted.speakingReview.prompts[0].text;
        await database!.content.updateOne({ _id: speaking.id }, { $set: { "sections.0.text": "A later edited prompt must not replace the saved examination prompt." } });
        const before = await snapshot();
        const reloaded = (await request("a", "GET", `/attempts/${attempt.id}`)).body.attempt;
        assert.equal(reloaded.speakingReview.promptSource, "saved-authored-prompt");
        assert.equal(reloaded.speakingReview.prompts[0].text, originalPrompt);
        assert.equal(reloaded.speakingReview.recognizedTranscript, recognized);
        assertAudio(await request("a", "GET", `/attempts/${attempt.id}/audio`), wav(500));
        await request("b", "GET", `/attempts/${attempt.id}`, 404);
        await request("b", "GET", `/attempts/${attempt.id}/audio`, 404);
        assert.deepEqual(await snapshot(), before);
        assert.equal(sttCalls, 3); assert.equal(scoreCalls, 2);
      } finally { globalThis.fetch = controlledSpeechFetch; }
    });

    await t.test("an invalidated native guard denies review even when a stale resource still says submitted", async () => {
      const done = await insertAttempt(content, "submitted"), spoken = await insertAttempt(speaking, "submitted");
      const placementId = randomUUID();
      await database!.placements.insertOne({
        _id: placementId, userId: users.a, mode: "quick", total: 1, theta: 0, standardError: 0.5, estimatedBand: 5, currentQuestionId: null,
        answers: [{ questionId: listeningItem.id, answer: listeningItem.answer, correct: true }], result: completedFeedback(), startedAt: timestamp, completedAt: timestamp, completionReason: "answered",
      });
      await database!.db.collection<{ _id: string; [key: string]: unknown }>("exam_integrity_sessions").insertMany([
        { kind: "attempt", resourceId: done.id }, { kind: "attempt", resourceId: spoken.id }, { kind: "placement", resourceId: placementId },
      ].map(target => ({ _id: randomUUID(), userId: users.a, ...target, tabId: "synthetic-review-guard-tab", status: "invalidated", phase: "answering", reason: "hidden", resetPending: false, leaseUntil: Date.parse(timestamp), createdAt: timestamp, updatedAt: timestamp })));
      const before = await snapshot(), previousOrigin = origin;
      const guarded = createApp(database!, { production: false, serveClient: false, duoEnabled: false, demoEnabled: false, maxLearners: 2, examIntegrityEnabled: true, duo: { now: () => Date.parse(timestamp) } }).listen(0, "127.0.0.1");
      try {
        await once(guarded, "listening"); const address = guarded.address(); assert.ok(address && typeof address !== "string");
        origin = `http://127.0.0.1:${address.port}`;
        await request("a", "GET", `/attempts/${done.id}/listening-audio?sectionIndex=0`, 409);
        await request("a", "POST", `/attempts/${done.id}/listening-audio`, 409, undefined, { "X-Exam-Tab": "synthetic-review-guard-tab" });
        await request("a", "GET", `/attempts/${spoken.id}/audio`, 409);
        await request("a", "GET", `/placement/${placementId}/audio?questionId=${listeningItem.id}`, 409);
        assert.deepEqual(await snapshot(), before);
        assert.equal(providerCalls, warmedCalls);
      } finally {
        origin = previousOrigin; guarded.closeAllConnections();
        await new Promise<void>(resolve => guarded.close(() => resolve()));
      }
    });
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>(resolve => server!.close(() => resolve()));
    }
    try {
      if (database) {
        assert.match(database.db.databaseName, databasePattern);
        try { await database.db.dropDatabase(); }
        finally { await database.client.close(); }
      }
    } finally {
      globalThis.fetch = originalFetch;
      for (const [key, value] of prior) value === undefined ? delete process.env[key] : process.env[key] = value;
    }
  }
});
