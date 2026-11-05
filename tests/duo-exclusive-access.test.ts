import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { test } from "node:test";
import { createApp } from "../server/app";
import { hashPassword } from "../server/auth";
import { parseDuoCredentials, provisionDuoAccounts } from "../server/duo-auth";
import { DUO_EXAM_CONTENT_COLLECTION } from "../server/duo-exam-content";
import { SpeechAudioCache } from "../server/speech-audio";
import { inspectSpeechBank, runSpeechBankPrewarm } from "../server/speech-prewarm";
import { parseSpeechPrewarmArguments } from "../server/speech-prewarm-cli";
import { connectDatabase, type AttemptRecord } from "../server/storage";
import type { Attempt, StoredContent } from "../shared/types";

function paper(id: string, skill: "reading" | "listening" = "reading"): StoredContent {
  return {
    id, skill, title: "An exclusive museum study", description: "Synthetic isolated access fixture", topic: "Culture",
    band: 6, cefr: "B2", testType: "both", durationMinutes: 20, format: "lesson", vocabularyIds: [], tags: [],
    source: "authored", quality: "authored-unreviewed", createdAt: "2026-11-05T00:00:00.000Z",
    sections: [{ id: `${id}-s`, title: "The museum archive", text: "A curator stores a sapphire inside the museum archive.",
      ...(skill === "listening" ? { dialogue: [
        { speaker: "Visitor", accent: "british" as const, text: "What does the curator store inside the museum archive?" },
        { speaker: "Guide", accent: "american" as const, text: "The curator stores a sapphire inside the museum archive." },
      ] } : {}),
    }],
    questions: [{ id: `${id}-q`, number: 1, sectionIndex: 0, type: "text", questionType: "short-answer", wordLimit: 1,
      prompt: "What does the curator store? Write ONE WORD ONLY.", answer: "sapphire", evidence: "A curator stores a sapphire",
      explanation: "The source names the object directly.", subskill: "details" }],
  };
}

test("exclusive Duo content is accessible only through its owned assessment and review", { timeout: 60_000 }, async t => {
  const databaseName = `ielts_duo_private_access_test_${randomUUID().replaceAll("-", "")}`;
  assert.match(databaseName, /^ielts_duo_private_access_test_[a-f0-9]{32}$/);
  const database = await connectDatabase("mongodb://127.0.0.1:27017", databaseName);
  let server: Server | undefined, origin = "";
  const cookies = { husband: "", wife: "" };
  const originalGetReady = SpeechAudioCache.prototype.getReady;
  const providerNames = ["IELTS_OPENAI_API_KEY", "OPENAI_API_KEY", "ELEVENLABS_API_KEY", "IELTS_AZURE_SPEECH_KEY", "AZURE_SPEECH_KEY"];
  const previousProvider = new Map(providerNames.map(key => [key, process.env[key]]));
  providerNames.forEach(key => delete process.env[key]);
  let audioReads = 0, translations = 0;
  const bytes = Buffer.from("RIFF_SYNTHETIC_PREPARED_EXCLUSIVE_AUDIO_ONLY");
  SpeechAudioCache.prototype.getReady = async function () {
    audioReads++;
    return { buffer: bytes, mimetype: "audio/wav", provider: "openai", voiceCount: 2, cached: true as const };
  };
  const at = "2026-11-05T00:00:00.000Z";
  const reading = paper("duo-private-synthetic-reading-access");
  const other = paper("duo-private-synthetic-unassigned-reading");
  const listening = paper("duo-private-synthetic-listening-access", "listening");
  const publicPaper = paper("synthetic-public-practice-access");
  const assessmentId = "synthetic-exclusive-assessment";
  async function request(who: keyof typeof cookies, method: string, route: string, expected = 200, payload?: unknown) {
    const response = await fetch(`${origin}/api${route}`, { method,
      headers: { ...(cookies[who] ? { Cookie: cookies[who] } : {}), ...(payload === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    const cookie = response.headers.getSetCookie().at(-1);
    if (cookie) cookies[who] = cookie.split(";")[0];
    const raw = Buffer.from(await response.arrayBuffer());
    const body = response.headers.get("Content-Type")?.includes("application/json") ? JSON.parse(raw.toString()) : null;
    assert.equal(response.status, expected, `${method} ${route}: ${JSON.stringify(body)}`);
    return { body, raw, response };
  }
  try {
    await database.content.insertOne({ ...publicPaper, _id: publicPaper.id });
    await database.db.collection<StoredContent & { _id: string }>(DUO_EXAM_CONTENT_COLLECTION)
      .insertMany([reading, other, listening].map(content => ({ ...content, _id: content.id })));
    const settings = parseDuoCredentials({ duoId: "synthetic-exclusive-access-duo", accounts: [
      { role: "husband", name: "Synthetic A", phone: "0390000081", passwordHash: await hashPassword("synthetic-private-password-a") },
      { role: "wife", name: "Synthetic B", phone: "0390000082", passwordHash: await hashPassword("synthetic-private-password-b") },
    ] });
    const users = await provisionDuoAccounts(database, settings);
    const members = { husband: users.find(user => user.duoRole === "husband")!.id, wife: users.find(user => user.duoRole === "wife")!.id };
    const completion = { husband: { at, proofIds: ["synthetic-complete-a"], kind: "attempt" }, wife: { at, proofIds: ["synthetic-complete-b"], kind: "attempt" } };
    await database.db.collection<{ _id: string; [key: string]: unknown }>("duo_learning_paths").insertOne({
      _id: settings.duoId, duoId: settings.duoId, members, startingBand: 6, currentBand: 6, targetBand: 8,
      gateInterval: 5, sessionsPerBand: 5, passPercent: 70, strictRetakeMode: false, revision: 0, startedAt: at, updatedAt: at,
      bands: { b12: { band: 6, unlockedAt: at, completedAt: null,
        lessons: Array.from({ length: 5 }, (_, index) => ({ id: `synthetic-private-lesson-${index}`, number: index + 1, title: "Completed lesson", kind: "reading", contentId: publicPaper.id, vocabularyIds: [], completion })),
        gates: [{ id: "synthetic-exclusive-gate", number: 1, fromLesson: 1, afterLesson: 5, contentIds: [reading.id], results: { husband: { status: "in-progress", assessmentId, at }, wife: null } }],
        promotionContentIds: [], promotionResults: { husband: null, wife: null }, lastPromotionRoomId: null,
      } },
    });
    await database.db.collection<{ _id: string; [key: string]: unknown }>("duo_assessments").insertOne({
      _id: assessmentId, duoId: settings.duoId, userId: members.husband, role: "husband", kind: "gate", band: 6,
      gateId: "synthetic-exclusive-gate", roomId: null, status: "in-progress", active: true,
      parts: [{ contentId: reading.id, title: reading.title, skill: reading.skill, attemptId: null, status: "in-progress", scorePercent: null, estimatedBand: null, startsAt: at, deadlineAt: "2099-11-05T01:00:00.000Z" }],
      passPercent: 70, requiredBand: 6.5, deadlineAt: "2099-11-05T01:00:00.000Z", createdAt: at, completedAt: null, revision: 0,
    });
    server = createApp(database, { production: false, serveClient: false, duoEnabled: true, demoEnabled: false,
      examIntegrityEnabled: false, duoCredentials: settings, wordTranslation: { apiKey: () => "sk-synthetic-private-word-no-paid-calls", fetch: async () => {
        translations++;
        return Response.json({ choices: [{ message: { content: JSON.stringify({ meaning: "đá sapphire", definition: "A blue precious stone.", partOfSpeech: "noun" }) } }] });
      } },
    }).listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address(); assert.ok(address && typeof address !== "string"); origin = `http://127.0.0.1:${address.port}`;
    await request("husband", "POST", "/auth/login", 200, { phone: settings.accounts[0].phone, password: "synthetic-private-password-a" });
    await request("wife", "POST", "/auth/login", 200, { phone: settings.accounts[1].phone, password: "synthetic-private-password-b" });

    await t.test("public lists and every generic content route exclude all private papers", async () => {
      const list = (await request("husband", "GET", "/content?pageSize=100")).body;
      assert.equal(list.total, 1); assert.deepEqual(list.items.map((item: StoredContent) => item.id), [publicPaper.id]);
      for (const id of [reading.id, other.id, listening.id]) {
        for (const suffix of ["", "/progress", "/listening-audio/readiness"]) await request("husband", "GET", `/content/${id}${suffix}`, 404);
        await request("husband", "POST", `/content/${id}/audio`, 404, {});
      }
      assert.equal(audioReads, 0);
    });
    await t.test("ordinary, forged, foreign and out-of-assignment starts are refused", async () => {
      await request("husband", "POST", "/attempts", 403, { contentId: reading.id, mode: "practice" });
      await request("husband", "POST", "/attempts", 403, { contentId: reading.id, mode: "exam" });
      await request("husband", "POST", "/attempts", 400, { contentId: reading.id, mode: "practice", duoAssessmentId: assessmentId });
      await request("wife", "POST", "/attempts", 404, { contentId: reading.id, mode: "exam", duoAssessmentId: assessmentId });
      await request("husband", "POST", "/attempts", 404, { contentId: reading.id, mode: "exam", duoAssessmentId: "synthetic-forged-assessment" });
      await request("husband", "POST", "/attempts", 403, { contentId: other.id, mode: "exam", duoAssessmentId: assessmentId });
      assert.equal(await database.attempts.countDocuments(), 0); assert.equal(audioReads, 0);
    });
    const attempt = (await request("husband", "POST", "/attempts", 201, { contentId: reading.id, mode: "exam", duoAssessmentId: assessmentId })).body.attempt as Attempt;
    await t.test("authorized attempt hides answers before submit and exposes only its own review", async () => {
      assert.equal("answer" in attempt.content.questions[0], false);
      await request("wife", "GET", `/attempts/${attempt.id}`, 404);
      await request("husband", "POST", `/attempts/${attempt.id}/words/translate`, 409, { word: "sapphire", sectionIndex: 0 });
      assert.equal(translations, 0);
      await request("husband", "PATCH", `/attempts/${attempt.id}`, 200, { responses: { [reading.questions[0].id]: "sapphire" } });
      const submitted = (await request("husband", "POST", `/attempts/${attempt.id}/submit`, 200, {})).body.attempt as Attempt;
      assert.equal(submitted.status, "submitted"); assert.equal(submitted.feedback?.answers[0].answer, "sapphire");
      assert.equal(submitted.feedback?.rawScore, 1); assert.equal(submitted.feedback?.total, 1);
      await request("husband", "GET", `/content/${reading.id}`, 404);
      const translation = (await request("husband", "POST", `/attempts/${attempt.id}/words/translate`, 200, { word: "sapphire", sectionIndex: 0 })).body.translation;
      assert.equal(translation.meaning, "đá sapphire"); assert.equal(translations, 1);
      await request("wife", "POST", `/attempts/${attempt.id}/words/translate`, 404, { word: "sapphire", sectionIndex: 0 });
    });
    await t.test("owned completed private Listening replays cached bytes without public audio access", async () => {
      const id = randomUUID();
      const record: AttemptRecord = { _id: id, id, userId: members.husband, contentId: listening.id, title: listening.title, skill: "listening", mode: "exam", status: "submitted", startedAt: at,
        deadlineAt: null, submittedAt: at, durationSeconds: 20, responses: {}, essays: {}, transcript: "", feedback: null, duoAssessmentId: assessmentId };
      await database.attempts.insertOne(record);
      await request("wife", "GET", `/attempts/${id}/listening-audio`, 404);
      const audio = await request("husband", "GET", `/attempts/${id}/listening-audio?sectionIndex=0`);
      assert.deepEqual(audio.raw, bytes); assert.equal(audio.response.headers.get("Accept-Ranges"), "bytes"); assert.equal(audioReads, 1);
      await request("husband", "POST", `/content/${listening.id}/audio`, 404, {}); assert.equal(audioReads, 1);
    });
    assert.deepEqual(await database.content.find().toArray(), [{ ...publicPaper, _id: publicPaper.id }]);
  } finally {
    SpeechAudioCache.prototype.getReady = originalGetReady;
    for (const [name, value] of previousProvider) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    await database.db.dropDatabase(); await database.client.close();
  }
});

test("private-only pregeneration is explicit, bounded and inspection does not seed", async () => {
  assert.deepEqual(parseSpeechPrewarmArguments(["--inspect", "--duo-only"]), { mode: "inspect", maxClips: 32, maxRetries: 3, intervalMs: 60_000, resume: false, scope: "duo" });
  assert.equal(parseSpeechPrewarmArguments(["--once", "--duo-only", "--resume", "--max-clips", "4096"]).scope, "duo");
  assert.throws(() => parseSpeechPrewarmArguments(["--duo-only", "--duo-only"]));
  const databaseName = `ielts_prewarm_test_${Math.floor(Date.now() / 1000)}_${randomUUID().replaceAll("-", "")}`;
  const database = await connectDatabase("mongodb://127.0.0.1:27017", databaseName);
  try {
    const privateListening = paper("duo-private-synthetic-prewarm-only", "listening");
    await database.db.collection<StoredContent & { _id: string }>(DUO_EXAM_CONTENT_COLLECTION).insertOne({ ...privateListening, _id: privateListening.id });
    const publicListening = paper("synthetic-public-prewarm-only", "listening");
    publicListening.sections = [{ id: "synthetic-public-weather-section", title: "Weather records", text: "Field assistants collect weather records before noon.",
      dialogue: [{ speaker: "Researcher", accent: "australian", text: "Field assistants collect weather records before noon." }] }];
    await database.content.insertOne({ ...publicListening, _id: publicListening.id });
    const before = await database.db.listCollections().toArray();
    const status = await inspectSpeechBank(database.db, { expectedDatabase: databaseName, scope: "duo" });
    assert.equal(status.total, 1);
    assert.equal((await inspectSpeechBank(database.db, { expectedDatabase: databaseName })).total, 2);
    assert.equal(await database.db.collection("speech_bank_prewarm").countDocuments(), 0);
    assert.deepEqual((await database.db.listCollections().toArray()).map(row => row.name).sort(), before.map(row => row.name).sort());
    assert.equal(await database.db.collection(DUO_EXAM_CONTENT_COLLECTION).countDocuments(), 1);
    const originalReadiness = SpeechAudioCache.prototype.readiness, originalGet = SpeechAudioCache.prototype.get;
    const previousKey = process.env.IELTS_OPENAI_API_KEY;
    const manifests = database.db.collection<{ _id: string; [key: string]: unknown }>("speech_bank_prewarm");
    const publicManifest = { _id: "bank", configured: true, state: "complete", total: 432, ready: 432, failed: 0, updatedAt: new Date("2026-11-05T00:00:00.000Z") };
    await manifests.insertOne(publicManifest);
    process.env.IELTS_OPENAI_API_KEY = "sk-synthetic-scoped-already-prepared";
    SpeechAudioCache.prototype.readiness = async function (sections) {
      assert.ok(sections.every(section => section.id === privateListening.sections[0].id), "The scoped worker must never read public clips");
      return { configured: true, ready: true, state: "ready", notice: "", readyCount: sections.length, totalCount: sections.length };
    };
    SpeechAudioCache.prototype.get = async function () { throw new Error("Already prepared audio must not be generated again"); };
    try {
      const result = await runSpeechBankPrewarm(database.db, { expectedDatabase: databaseName, scope: "duo", maxClips: 1 });
      assert.equal(result.state, "complete"); assert.equal(result.ready, 1); assert.equal(result.total, 1);
      assert.deepEqual(await manifests.findOne({ _id: "bank" }), publicManifest);
      assert.equal((await manifests.findOne({ _id: "bank:duo" }))?.state, "complete");
      assert.equal(await database.db.collection(DUO_EXAM_CONTENT_COLLECTION).countDocuments(), 1);
    } finally {
      SpeechAudioCache.prototype.readiness = originalReadiness; SpeechAudioCache.prototype.get = originalGet;
      if (previousKey === undefined) delete process.env.IELTS_OPENAI_API_KEY; else process.env.IELTS_OPENAI_API_KEY = previousKey;
    }
  } finally { await database.db.dropDatabase(); await database.client.close(); }
});
