import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { test } from "node:test";
import { createApp } from "../server/app";
import { hashPassword } from "../server/auth";
import { parseDuoCredentials, provisionDuoAccounts } from "../server/duo-auth";
import { SpeechAudioCache } from "../server/speech-audio";
import { connectDatabase, type Database } from "../server/storage";
import type { DuoAssessmentView } from "../shared/duo";
import type { Attempt, StoredContent } from "../shared/types";

const ownedDatabase = /^ielts_review_audio_duo_test_[a-f0-9]{32}$/;
const providerKeys = ["IELTS_OPENAI_API_KEY", "OPENAI_API_KEY", "ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_BRITISH", "ELEVENLABS_VOICE_AMERICAN", "ELEVENLABS_VOICE_AUSTRALIAN", "ELEVENLABS_MODEL"];

test("native Duo intermediate Listening replay keeps the owning document lease and settles expiry before reading audio", { timeout: 60_000 }, async t => {
  const databaseName = `ielts_review_audio_duo_test_${randomUUID().replaceAll("-", "")}`;
  assert.match(databaseName, ownedDatabase);
  const savedEnvironment = new Map(providerKeys.map(key => [key, process.env[key]]));
  providerKeys.forEach(key => delete process.env[key]);
  process.env.IELTS_OPENAI_API_KEY = "sk-synthetic-duo-review-no-paid-provider";
  const originalFetch = globalThis.fetch;
  const originalGetReady = SpeechAudioCache.prototype.getReady;
  let providerCalls = 0, generationAllowed = true, audioReads = 0;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.openai.com/v1/audio/speech");
    assert.equal(generationAllowed, true, "Learner review must never request new provider audio");
    providerCalls++;
    assert.equal(JSON.parse(String(init?.body)).response_format, "pcm");
    const pcm = Buffer.alloc(24);
    for (let index = 0; index < pcm.length; index += 2) pcm.writeInt16LE(400 + index, index);
    return new Response(pcm, { headers: { "Content-Type": "audio/pcm", "Content-Length": String(pcm.length) } });
  };
  let database: Database | undefined, server: Server | undefined, origin = "";
  const cookies = { husband: "", wife: "" };
  let now = Date.parse("2026-10-15T06:00:00.000Z");
  const at = () => new Date(now).toISOString();

  async function request(who: keyof typeof cookies, method: string, route: string, expected: number, payload?: unknown, headers: Record<string, string> = {}) {
    const response = await originalFetch(`${origin}/api${route}`, {
      method,
      headers: { ...(cookies[who] ? { Cookie: cookies[who] } : {}), ...(payload === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    const cookie = response.headers.getSetCookie().at(-1);
    if (cookie) cookies[who] = cookie.split(";")[0];
    const bytes = Buffer.from(await response.arrayBuffer());
    const body = response.headers.get("content-type")?.includes("application/json") ? JSON.parse(bytes.toString()) : null;
    assert.equal(response.status, expected, `${method} ${route}: ${JSON.stringify(body)}`);
    return { response, bytes, body };
  }

  try {
    // Use only a random fixture database on loopback; application data and
    // real credentials never enter this test's transport or cleanup scope.
    const db = database = await connectDatabase("mongodb://127.0.0.1:27017", databaseName);
    const listening: StoredContent = {
      id: "synthetic-duo-review-listening", skill: "listening", title: "Synthetic community workshop", description: "Isolated Duo replay fixture", topic: "Community",
      band: 6, cefr: "B2", testType: "academic", durationMinutes: 10, format: "lesson", vocabularyIds: [], tags: ["synthetic-duo-review"], source: "authored", quality: "authored-unreviewed", createdAt: at(),
      sections: [{ id: "synthetic-duo-review-listening-section", title: "Part 1", text: "Visitors collect their workshop notebooks from reception before the afternoon session begins. The group then meets beside the community garden for a safety briefing and a guided walk.", dialogue: [
        { speaker: "Visitor", accent: "british", text: "Where should visitors collect their workshop notebooks before the afternoon session begins?" },
        { speaker: "Coordinator", accent: "british", text: "Please collect them from reception. The group then meets beside the community garden for a safety briefing and a guided walk. Bring water and wear comfortable shoes for the path." },
      ] }],
      questions: [{ id: "synthetic-duo-review-listening-q", number: 1, sectionIndex: 0, type: "choice", questionType: "multiple-choice", prompt: "Where are notebooks collected?", options: ["reception", "garden"], answer: "reception", explanation: "The coordinator identifies reception.", evidence: "from reception", subskill: "details" }],
    };
    const reading: StoredContent = { ...listening, id: "synthetic-duo-review-reading", skill: "reading", title: "Synthetic next assessment part",
      sections: [{ id: "synthetic-duo-review-reading-section", title: "Community museums", text: "Local museums support educational programmes for families and school groups." }],
      questions: [{ ...listening.questions[0], id: "synthetic-duo-review-reading-q", prompt: "Who benefits from the programmes?", options: ["families", "companies"], answer: "families", evidence: "for families", explanation: "The passage identifies families." }],
    };
    const bank = [listening, reading];
    await database.content.insertMany(bank.map(row => ({ ...row, _id: row.id })));
    const settings = parseDuoCredentials({ duoId: "synthetic-review-audio-duo", accounts: [
      { role: "husband", name: "Synthetic Audio Duo A", phone: "0390000081", passwordHash: await hashPassword("synthetic-audio-duo-password-a") },
      { role: "wife", name: "Synthetic Audio Duo B", phone: "0390000082", passwordHash: await hashPassword("synthetic-audio-duo-password-b") },
    ] });
    const users = await provisionDuoAccounts(database, settings);
    const members = { husband: users.find(user => user.duoRole === "husband")!.id, wife: users.find(user => user.duoRole === "wife")!.id };
    await database.users.updateMany({ duoId: settings.duoId }, { $set: { currentBand: 6, cefr: "B2" } });
    const completion = {
      husband: { at: at(), proofIds: ["synthetic-duo-audio-practice-a"], kind: "attempt" },
      wife: { at: at(), proofIds: ["synthetic-duo-audio-practice-b"], kind: "attempt" },
    };
    const gateId = "synthetic-duo-review:gate";
    const path = {
      _id: settings.duoId, duoId: settings.duoId, members, startingBand: 6, currentBand: 6, targetBand: 8, gateInterval: 5, sessionsPerBand: 5,
      passPercent: 70, strictRetakeMode: false, revision: 0, startedAt: at(), updatedAt: at(),
      bands: { b12: { band: 6, unlockedAt: at(), completedAt: null,
        lessons: Array.from({ length: 5 }, (_, index) => ({ id: `synthetic-duo-review:lesson:${index}`, number: index + 1, title: "Completed synthetic practice", kind: "reading", contentId: reading.id, vocabularyIds: [], completion: structuredClone(completion) })),
        gates: [{ id: gateId, number: 1, fromLesson: 1, afterLesson: 5, contentIds: bank.map(row => row.id), results: { husband: null, wife: null } }],
        promotionContentIds: [], promotionResults: { husband: null, wife: null }, lastPromotionRoomId: null,
      } },
    };
    await database.db.collection<typeof path>("duo_learning_paths").insertOne(path);
    const warmed = await new SpeechAudioCache(database).get(listening.sections);
    assert.ok(providerCalls > 0);
    generationAllowed = false;
    const warmedCalls = providerCalls;
    server = createApp(database, { production: false, serveClient: false, duoEnabled: true, demoEnabled: false, duoCredentials: settings,
      examIntegrityEnabled: true, duo: { sessionsPerBand: 5, gateInterval: 5, lessonKinds: ["reading"], now: () => now },
    }).listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address(); assert.ok(address && typeof address !== "string");
    origin = `http://127.0.0.1:${address.port}`;
    await request("husband", "POST", "/auth/login", 200, { phone: settings.accounts[0].phone, password: "synthetic-audio-duo-password-a" });
    await request("wife", "POST", "/auth/login", 200, { phone: settings.accounts[1].phone, password: "synthetic-audio-duo-password-b" });
    const tab = randomUUID(), tabHeaders = { "X-Exam-Tab": tab };
    const assessment = (await request("husband", "POST", `/duo/gates/${gateId}/start`, 200, {}, tabHeaders)).body.assessment as DuoAssessmentView;
    assert.equal(assessment.parts.length, 2);
    const attempt = (await request("husband", "POST", "/attempts", 201, { contentId: listening.id, mode: "exam", duoAssessmentId: assessment.id }, tabHeaders)).body.attempt as Attempt;
    await request("husband", "PATCH", `/attempts/${attempt.id}`, 200, { responses: { [listening.questions[0].id]: "reception" } }, tabHeaders);
    const submitted = (await request("husband", "POST", `/attempts/${attempt.id}/submit`, 200, {}, tabHeaders)).body.attempt as Attempt;
    assert.equal(submitted.status, "submitted");
    const assessments = database.db.collection<{ _id: string; active: boolean; invalidatedAt?: string; integrityReason?: string; parts: { attemptId: string | null }[] }>("duo_assessments");
    const activeAssessment = await assessments.findOne({ _id: assessment.id });
    assert.equal(activeAssessment?.active, true);
    assert.equal(activeAssessment.parts[0].attemptId, attempt.id);
    assert.equal(activeAssessment.parts[1].attemptId, null);
    const sessions = database.db.collection<{ _id: string; userId: string; resourceId: string; kind: string; status: string; phase: string; leaseUntil: number; resetPending?: boolean }>("exam_integrity_sessions");
    const guard = await sessions.findOne({ userId: members.husband, resourceId: assessment.id });
    assert.ok(guard); assert.equal(guard.kind, "assessment"); assert.equal(guard.status, "active"); assert.equal(guard.phase, "answering");
    const originalAttempt = await database.attempts.findOne({ _id: attempt.id });
    const companion = await database.users.findOne({ _id: members.wife });
    SpeechAudioCache.prototype.getReady = async function (...args) {
      audioReads++;
      return originalGetReady.apply(this, args);
    };
    const route = `/attempts/${attempt.id}/listening-audio?sectionIndex=0`;

    await t.test("a submitted intermediate part requires its owning tab before any prepared audio read", async () => {
      await request("husband", "GET", route, 400);
      await request("wife", "GET", route, 404);
      assert.equal(audioReads, 0);
      assert.deepEqual(await sessions.findOne({ _id: guard._id }), guard);
      assert.deepEqual(await db.attempts.findOne({ _id: attempt.id }), originalAttempt);
    });
    await t.test("the owning tab receives original seekable bytes without consuming a play or changing the active assessment", async () => {
      const full = await request("husband", "GET", route, 200, undefined, tabHeaders);
      assert.deepEqual(full.bytes, warmed.buffer);
      assert.equal(full.response.headers.get("accept-ranges"), "bytes");
      assert.equal(full.response.headers.get("cache-control"), "private, no-store");
      const partial = await request("husband", "GET", route, 206, undefined, { ...tabHeaders, Range: "bytes=0-43" });
      assert.deepEqual(partial.bytes, warmed.buffer.subarray(0, 44));
      assert.equal(partial.response.headers.get("content-range"), `bytes 0-43/${warmed.buffer.length}`);
      assert.equal(audioReads, 2);
      assert.deepEqual(await db.attempts.findOne({ _id: attempt.id }), originalAttempt);
      assert.deepEqual(await assessments.findOne({ _id: assessment.id }), activeAssessment);
      assert.deepEqual(await sessions.findOne({ _id: guard._id }), guard);
      assert.equal(providerCalls, warmedCalls);
    });
    await t.test("expiry invalidates the linked assessment before any cached bytes are read or returned", async () => {
      now = guard.leaseUntil + 1;
      assert.ok(Date.parse(assessment.deadlineAt) > now, "Expire the document lease before the assessment deadline");
      const denied = await request("husband", "GET", route, 409);
      assert.equal(denied.response.headers.get("content-type")?.includes("application/json"), true);
      assert.equal(audioReads, 2);
      assert.equal(providerCalls, warmedCalls);
      const cancelled = await assessments.findOne({ _id: assessment.id });
      assert.equal(cancelled?.active, false); assert.ok(cancelled.invalidatedAt); assert.equal(cancelled.integrityReason, "heartbeat-lost");
      assert.equal((await db.attempts.findOne({ _id: attempt.id }))?.status, "invalidated");
      const expired = await sessions.findOne({ _id: guard._id });
      assert.equal(expired?.status, "invalidated"); assert.equal(expired.resetPending, false);
      assert.deepEqual(await db.users.findOne({ _id: members.wife }), companion);
      assert.deepEqual(await db.content.find({}).sort({ _id: 1 }).toArray(), bank.map(row => ({ ...row, _id: row.id })).sort((a, b) => a._id.localeCompare(b._id)));
    });
  } finally {
    SpeechAudioCache.prototype.getReady = originalGetReady;
    globalThis.fetch = originalFetch;
    savedEnvironment.forEach((value, key) => value === undefined ? delete process.env[key] : process.env[key] = value);
    if (server) { server.closeAllConnections(); await new Promise<void>(done => server!.close(() => done())); }
    if (database) {
      assert.match(database.db.databaseName, ownedDatabase);
      try { await database.db.dropDatabase(); } finally { await database.client.close(); }
    }
  }
});
