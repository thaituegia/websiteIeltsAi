import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { test } from "node:test";
import { GridFSBucket } from "mongodb";
import { connectDatabase } from "../server/storage";
import { createApp } from "../server/app";
import { SpeechAudioCache } from "../server/speech-audio";
import type { Attempt, PlacementItem, PlacementState, StoredContent } from "../shared/types";

type Learner = "a" | "b";
type HttpResult = { status: number; headers: Headers; bytes: Buffer; body: any };
type ProviderRequest = { url: string; body: any };
const ownedDatabasePattern = /^ielts_speech_api_test_[a-f0-9]{32}$/;
const providerEnvironment = ["IELTS_OPENAI_API_KEY", "OPENAI_API_KEY", "ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_BRITISH", "ELEVENLABS_VOICE_AMERICAN", "ELEVENLABS_VOICE_AUSTRALIAN", "ELEVENLABS_MODEL"];

function listening(name: string): StoredContent {
  const id = `synthetic-speech-${name.toLowerCase()}`;
  const lines = [
    { speaker: "Visitor", accent: "british" as const, text: `Where does the ${name} workshop meet this week?` },
    { speaker: "Coordinator", accent: "british" as const, text: `The ${name} workshop meets beside the ${name.toLowerCase()} garden. Visitors collect ${name.toLowerCase()} notebooks at reception. The coordinator explains the safety instructions before the afternoon walk. Please register at the desk when you arrive.` },
    { speaker: "Visitor", accent: "british" as const, text: `Thank you. I will collect the ${name.toLowerCase()} notebooks before joining the ${name} group.` },
  ];
  return {
    id, skill: "listening", title: `Synthetic ${name} workshop`, description: "Private synthetic speech fixture", topic: "Community",
    band: 5, cefr: "B1", testType: "academic", durationMinutes: 10, format: "lesson",
    sections: [{ id: `${id}-section`, title: "Part 1", text: lines.map(line => line.text).join(" "), dialogue: lines }],
    questions: [{ id: `${id}-question`, number: 1, sectionIndex: 0, type: "choice", questionType: "multiple-choice",
      prompt: `What should a visitor collect for the ${name} workshop?`, options: [`${name.toLowerCase()} notebooks`, `${name.toLowerCase()} maps`],
      answer: `${name.toLowerCase()} notebooks`, explanation: `The coordinator asks visitors to collect ${name.toLowerCase()} notebooks.`,
      evidence: `Visitors collect ${name.toLowerCase()} notebooks at reception.`, subskill: "details" }],
    vocabularyIds: [], tags: ["synthetic-speech"], source: "authored", quality: "authored-unreviewed", createdAt: "2026-10-13T00:00:00.000Z",
  };
}

function gate() {
  let enter!: () => void, release!: () => void;
  return {
    entered: new Promise<void>(resolve => { enter = resolve; }),
    released: new Promise<void>(resolve => { release = resolve; }),
    enter: () => enter(), release: () => release(),
  };
}
async function entered(value: ReturnType<typeof gate>): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([value.entered, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("The controlled cache read was not reached")), 8_000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
function pcmResponse(): Response {
  const bytes = Buffer.alloc(6);
  [300, 600, 900].forEach((sample, index) => bytes.writeInt16LE(sample, index * 2));
  return new Response(bytes, { headers: { "Content-Type": "audio/pcm", "Content-Length": String(bytes.length) } });
}
function assertAudio(result: HttpResult, provider: "openai" | "elevenlabs", cache?: "hit" | "miss"): void {
  assert.equal(result.status, 200);
  assert.match(result.headers.get("content-type") ?? "", /^audio\/wav\b/u);
  assert.equal(result.headers.get("x-speech-provider"), provider);
  // Both characters share an accent but require distinct voices. This is the
  // actual cast, rather than the number of voices available to the provider.
  assert.equal(result.headers.get("x-speech-voices"), "2");
  if (cache) assert.equal(result.headers.get("x-speech-cache"), cache);
  else assert.ok(["hit", "miss"].includes(result.headers.get("x-speech-cache") ?? ""));
  assert.equal(result.headers.get("cache-control"), "private, no-store");
  assert.equal(result.bytes.toString("ascii", 0, 4), "RIFF");
  assert.equal(result.bytes.toString("ascii", 8, 16), "WAVEfmt ");
  assert.equal(result.bytes.readUInt32LE(4), result.bytes.length - 8);
  assert.equal(result.bytes.readUInt16LE(20), 1);
  assert.equal(result.bytes.readUInt16LE(22), 1);
  assert.equal(result.bytes.readUInt32LE(24), 16_000);
  assert.equal(result.bytes.readUInt16LE(34), 16);
  assert.equal(result.bytes.toString("ascii", 36, 40), "data");
  assert.equal(result.bytes.readUInt32LE(40), result.bytes.length - 44);
  assert.equal(result.bytes.readInt16LE(44), 300);
  assert.ok(result.bytes.length > 44);
}
function sessionId(resource: Attempt | PlacementState): string {
  assert.equal(resource.integrity?.status, "active");
  assert.ok(resource.integrity?.sessionId);
  return resource.integrity.sessionId;
}

test("native HTTP Listening audio reads prepared authored audio and fences learner state", { timeout: 90_000 }, async t => {
  // Never inherit an application Mongo URI or call a configured paid provider.
  const name = `ielts_speech_api_test_${randomUUID().replaceAll("-", "")}`;
  assert.match(name, ownedDatabasePattern);
  const environmentBefore = { ...process.env }, originalFetch = globalThis.fetch;
  const originalDownload = GridFSBucket.prototype.openDownloadStream;
  providerEnvironment.forEach(key => delete process.env[key]);
  process.env.IELTS_OPENAI_API_KEY = "sk-synthetic-speech-api-no-paid-calls";
  const requests: ProviderRequest[] = [], gates: ReturnType<typeof gate>[] = [];
  let providerResponse: (request: ProviderRequest) => Promise<Response> = async () => pcmResponse();
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    assert.ok(url === "https://api.openai.com/v1/audio/speech" || url === "https://api.elevenlabs.io/v1/text-to-dialogue?output_format=pcm_24000", `Unexpected provider destination: ${url}`);
    const request = { url, body: JSON.parse(String(init?.body)) };
    requests.push(request);
    if (url.includes("openai")) assert.equal(request.body.response_format, "pcm");
    return providerResponse(request);
  };
  let database: Awaited<ReturnType<typeof connectDatabase>> | undefined, server: Server | undefined;
  let origin = "", now = Date.parse("2026-10-13T12:00:00Z");
  const cookies: Record<Learner, string> = { a: "", b: "" };
  const primary = listening("Amber"), alternate = listening("Birch"), cold = listening("Juniper");
  const reading: StoredContent = { ...listening("Cedar"), id: "synthetic-speech-reading", skill: "reading", sections: [{ id: "synthetic-speech-reading-section", title: "Workshop passage", text: "The Cedar workshop supplies cedar notebooks at the reception desk." }] };
  const bank: PlacementItem[] = Array.from({ length: 40 }, (_, index) => ({
    id: `synthetic-speech-placement-${index}`, skill: index % 2 ? "listening" : "reading",
    text: index % 2 ? `Teacher: What do we need for workshop ${index}? Student: We need kit ${index}. Teacher: Please collect kit ${index} before class.` : `Workshop ${index} supplies kit ${index}.`,
    question: `What does workshop ${index} supply?`, options: [`kit ${index}`, `map ${index}`, `pen ${index}`, `bag ${index}`],
    answer: `kit ${index}`, explanation: `The controlled source identifies kit ${index}.`, band: 5, cefr: "B1", difficulty: 0, subskill: "details",
  }));
  async function request(who: Learner | null, method: string, path: string, payload?: unknown, expected: number | readonly number[] = 200, tabId?: string): Promise<HttpResult> {
    const response = await originalFetch(`${origin}/api${path}`, {
      method,
      headers: { ...(who && cookies[who] ? { Cookie: cookies[who] } : {}), ...(payload === undefined ? {} : { "Content-Type": "application/json" }), ...(tabId ? { "X-Exam-Tab": tabId } : {}) },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    const created = response.headers.getSetCookie().at(-1);
    if (who && created) cookies[who] = created.split(";")[0];
    const bytes = Buffer.from(await response.arrayBuffer());
    const body = response.headers.get("content-type")?.includes("application/json") ? JSON.parse(bytes.toString()) : null;
    const statuses = typeof expected === "number" ? [expected] : expected;
    assert.ok(statuses.includes(response.status), `${method} ${path}: expected ${statuses.join("/")}, received ${response.status}: ${JSON.stringify(body)}`);
    return { status: response.status, headers: response.headers, bytes, body };
  }
  async function begin(who: Learner, item: StoredContent, mode: "exam" | "practice", tabId?: string): Promise<Attempt> {
    return (await request(who, "POST", "/attempts", { contentId: item.id, mode }, 201, tabId)).body.attempt;
  }
  const attemptAudio = (who: Learner | null, attempt: Attempt, expected: number | readonly number[] = 200, tabId?: string) => request(who, "POST", `/attempts/${attempt.id}/listening-audio`, undefined, expected, tabId);
  const placementAudio = (who: Learner | null, placement: PlacementState, questionId: string, expected = 200, tabId?: string) => request(who, "POST", `/placement/${placement.id}/audio`, { questionId }, expected, tabId);
  async function answer(placement: PlacementState, tabId: string): Promise<PlacementState> {
    assert.ok(placement.question);
    const item = bank.find(row => row.id === placement.question!.id);
    assert.ok(item);
    return (await request("a", "POST", `/placement/${placement.id}/answer`, { questionId: item.id, answer: item.answer }, 200, tabId)).body.placement;
  }
  function pauseNextCacheRead(): ReturnType<typeof gate> {
    const value = gate(); gates.push(value);
    GridFSBucket.prototype.openDownloadStream = function (...args) {
      GridFSBucket.prototype.openDownloadStream = originalDownload;
      const stream = originalDownload.apply(this, args), read = stream._read.bind(stream);
      let paused = false;
      // Hold the real native GridFS download before its first chunk is read.
      stream._read = size => {
        if (paused) { read(size); return; }
        paused = true; value.enter();
        void value.released.then(() => read(size));
      };
      return stream;
    };
    return value;
  }
  function failNextCacheRead() {
    GridFSBucket.prototype.openDownloadStream = function (...args) {
      GridFSBucket.prototype.openDownloadStream = originalDownload;
      const stream = originalDownload.apply(this, args);
      queueMicrotask(() => stream.destroy(new Error("synthetic private GridFS read failure")));
      return stream;
    };
  }
  async function snapshot(includeShared = false) {
    assert.ok(database);
    const names = ["users", "attempts", "placements", "cards", "plans", "audio", "recordings.files", "recordings.chunks", "exam_integrity_sessions",
      ...(includeShared ? ["content", "speech_audio_jobs", "speech_audio.files", "speech_audio.chunks"] : [])];
    return Object.fromEntries(await Promise.all(names.map(async collection => [collection, await database!.db.collection(collection).find().sort({ _id: 1 }).toArray()])));
  }
  async function prewarm(sections: StoredContent["sections"]) {
    assert.ok(database);
    providerResponse = async () => pcmResponse();
    await new SpeechAudioCache(database).get(sections);
  }
  function assertReadiness(body: any, ready: boolean, totalCount: number) {
    assert.deepEqual(Object.keys(body), ["audio"]);
    assert.deepEqual(Object.keys(body.audio).sort(), ["configured", "notice", "ready", "readyCount", "state", "totalCount"]);
    assert.equal(body.audio.configured, true); assert.equal(body.audio.ready, ready);
    assert.equal(body.audio.state, ready ? "ready" : "pending");
    assert.equal(body.audio.totalCount, totalCount);
    assert.equal(body.audio.readyCount, ready ? totalCount : 0);
    assert.equal(typeof body.audio.notice, "string");
    if (!ready) assert.ok(body.audio.notice.length > 0);
    assert.equal(JSON.stringify(body).includes(primary.sections[0].dialogue![0].text), false);
  }
  try {
    database = await connectDatabase("mongodb://127.0.0.1:27017", name);
    await database.content.insertMany([primary, alternate, cold, reading].map(item => ({ ...item, _id: item.id })));
    await database.placementItems.insertMany(bank.map(item => ({ ...item, _id: item.id })));
    server = createApp(database, { production: false, serveClient: false, duoEnabled: false, demoEnabled: false, maxLearners: 2, examIntegrityEnabled: true, duo: { now: () => now } }).listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    origin = `http://127.0.0.1:${address.port}`;

    await t.test("readiness is authenticated metadata; missing audio blocks starts without jobs, timers or plays", async () => {
      const health = (await request(null, "GET", "/health")).body;
      assert.equal(health.status, "ok"); assert.equal(health.demoEnabled, false); assert.equal(health.examIntegrityEnabled, true);
      assert.deepEqual(health.services.speech, { configured: true, provider: "openai", voiceCount: 11 });
      assert.equal(requests.length, 0);
      assert.equal((await database!.db.listCollections().toArray()).some(row => row.name.startsWith("speech_audio")), false);
      for (const who of ["a", "b"] as const) await request(who, "POST", "/auth/register", {
        name: `Synthetic Speech ${who.toUpperCase()}`, email: `synthetic-speech-${who}@example.test`, password: "synthetic-speech-only-password", targetBand: 6.5, testType: "academic",
      }, 201);
      const before = await snapshot(true), collectionsBefore = await database!.db.listCollections({}, { nameOnly: true }).toArray();
      await request(null, "GET", `/content/${primary.id}/listening-audio/readiness?mode=practice`, undefined, 401);
      await request(null, "GET", "/placement/audio/readiness", undefined, 401);
      await request("a", "GET", `/content/${reading.id}/listening-audio/readiness`, undefined, 400);
      for (const mode of ["practice", "exam"] as const) {
        assertReadiness((await request("a", "GET", `/content/${primary.id}/listening-audio/readiness?mode=${mode}`)).body, false, 1);
        await request("a", "POST", "/attempts", { contentId: primary.id, mode }, 409, randomUUID());
      }
      assertReadiness((await request("a", "GET", "/placement/audio/readiness")).body, false, 20);
      for (const mode of ["quick", "deep"]) await request("a", "POST", "/placement/start", { mode }, 409, randomUUID());
      await request("a", "POST", `/content/${cold.id}/audio`, undefined, 409);
      assert.equal(requests.length, 0);
      assert.deepEqual(await snapshot(true), before);
      assert.deepEqual(await database!.db.listCollections({}, { nameOnly: true }).toArray(), collectionsBefore);

      // An older sitting can exist before AI is configured. Missing playback
      // must preserve that learner's state after configuration is enabled.
      delete process.env.IELTS_OPENAI_API_KEY;
      const practice = await begin("a", cold, "practice"), tab = randomUUID(), exam = await begin("b", cold, "exam", tab);
      process.env.IELTS_OPENAI_API_KEY = "sk-synthetic-speech-api-no-paid-calls";
      const beforePlayback = await snapshot(true), started = performance.now();
      await attemptAudio("a", practice, 409); await attemptAudio("b", exam, 409, tab);
      assert.ok(performance.now() - started < 2_000, "Missing prepared audio should reject promptly");
      assert.equal(requests.length, 0);
      assert.deepEqual(await snapshot(true), beforePlayback);
      await request("b", "POST", `/attempts/${exam.id}/submit`, {}, 200, tab);
    });

    await t.test("prewarmed practice audio is private, shared across accounts and cache-only", async () => {
      await prewarm(primary.sections);
      assert.equal(requests.length, 3);
      // Background turns may reach the provider concurrently; every input stays exact.
      assert.deepEqual(requests.map(row => row.body.input).sort(), primary.sections[0].dialogue!.map(row => row.text).sort());
      assert.equal(new Set(requests.map(row => row.body.voice)).size, 2);
      const a = await begin("a", primary, "practice"), b = await begin("b", primary, "practice");
      const otherSkill = await begin("a", reading, "practice");
      await attemptAudio(null, a, 401); await attemptAudio("b", a, 404); await attemptAudio("a", otherSkill, 400);
      const before = await snapshot(true), calls = requests.length;
      providerResponse = async () => { throw new Error("Playback unexpectedly contacted a paid provider"); };
      assertReadiness((await request("a", "GET", `/content/${primary.id}/listening-audio/readiness?mode=practice`)).body, true, 1);
      const first = await attemptAudio("a", a), repeat = await attemptAudio("a", a), peer = await attemptAudio("b", b);
      for (const audio of [first, repeat, peer]) assertAudio(audio, "openai", "hit");
      assert.deepEqual(repeat.bytes, first.bytes); assert.deepEqual(peer.bytes, first.bytes);
      const legacy = await request("a", "POST", `/content/${primary.id}/audio`);
      assertAudio(legacy, "openai", "hit"); assert.deepEqual(legacy.bytes, first.bytes);
      assert.equal(requests.length, calls); assert.deepEqual(await snapshot(true), before);
      const file = await database!.db.collection("speech_audio.files").findOne({}); assert.ok(file);
      assert.equal(file.metadata.provider, "openai"); assert.equal(file.metadata.mimetype, "audio/wav");
      assert.ok(file.metadata.fingerprint); assert.equal(JSON.stringify(file.metadata).includes("synthetic-speech-a@example.test"), false);
    });

    await t.test("a cache read failure preserves an exam play and concurrent cached delivery claims it once", async () => {
      await prewarm(alternate.sections);
      const tab = randomUUID(), exam = await begin("a", alternate, "exam", tab);
      const beforeCalls = requests.length;
      providerResponse = async () => { throw new Error("Prepared playback must work while the provider is down"); };
      await attemptAudio("a", exam, 400); await attemptAudio("a", exam, 400, "bad"); await attemptAudio("b", exam, 404, randomUUID());
      const beforeFailure = await snapshot(true);
      failNextCacheRead();
      const failed = await attemptAudio("a", exam, 503, tab);
      assert.equal(JSON.stringify(failed.body).includes("synthetic private GridFS read failure"), false);
      assert.deepEqual(await snapshot(true), beforeFailure);
      const outcomes = await Promise.all([attemptAudio("a", exam, [200, 409], tab), attemptAudio("a", exam, [200, 409], tab)]);
      assert.deepEqual(outcomes.map(row => row.status).sort(), [200, 409]);
      assertAudio(outcomes.find(row => row.status === 200)!, "openai", "hit");
      assert.equal((await database!.attempts.findOne({ _id: exam.id }))!.listeningPlayed, true);
      await attemptAudio("a", exam, 409, tab);
      const peer = await begin("b", alternate, "practice"), privateBefore = await snapshot(true);
      assertAudio(await attemptAudio("b", peer), "openai", "hit");
      assert.equal(requests.length, beforeCalls); assert.deepEqual(await snapshot(true), privateBefore);
      const submitted = (await request("a", "POST", `/attempts/${exam.id}/submit`, {}, 200, tab)).body.attempt;
      assert.equal(submitted.status, "submitted");
      await attemptAudio("a", submitted, 409, tab);
    });

    await t.test("a native violation during a cache read cancels delivery and a prepared retake has different audio", async subtest => {
      subtest.after(() => gates.forEach(value => value.release()));
      delete process.env.IELTS_OPENAI_API_KEY;
      process.env.ELEVENLABS_API_KEY = "synthetic-elevenlabs-speech-api-key";
      process.env.ELEVENLABS_VOICE_BRITISH = "synthetic-british";
      process.env.ELEVENLABS_VOICE_AMERICAN = "synthetic-american";
      process.env.ELEVENLABS_VOICE_AUSTRALIAN = "synthetic-australian";
      process.env.ELEVENLABS_MODEL = "synthetic-dialogue-model";
      await prewarm(primary.sections);
      const tab = randomUUID(), exam = await begin("a", primary, "exam", tab), paused = pauseNextCacheRead();
      const calls = requests.length, pending = attemptAudio("a", exam, 409, tab);
      await entered(paused);
      await request("a", "PATCH", `/attempts/${exam.id}`, { responses: { [exam.content.questions[0].id]: "synthetic discarded answer" } }, 200, tab);
      const cancelled = (await request("a", "POST", `/exam-integrity/${sessionId(exam)}/violation`, { tabId: tab, reason: "hidden" })).body.session;
      assert.equal(cancelled.status, "invalidated");
      const afterViolation = await database!.attempts.findOne({ _id: exam.id }); assert.ok(afterViolation);
      assert.equal(afterViolation.status, "invalidated"); assert.deepEqual(afterViolation.responses, {});
      assert.notEqual(afterViolation.listeningPlayed, true); assert.ok(afterViolation.replacementContentId);
      paused.release(); await pending;
      assert.deepEqual(await database!.attempts.findOne({ _id: exam.id }), afterViolation);
      assert.equal(requests.length, calls);
      const retakeSource = await database!.content.findOne({ _id: afterViolation.replacementContentId }); assert.ok(retakeSource);
      assert.notEqual(retakeSource.sections[0].text, primary.sections[0].text);
      const beforeReady = await snapshot(true), retakeTab = randomUUID();
      await request("a", "POST", "/attempts", { contentId: primary.id, mode: "exam" }, 409, retakeTab);
      assert.deepEqual(await snapshot(true), beforeReady);
      await prewarm(retakeSource.sections);
      const provider = requests.at(-1)!;
      assert.equal(provider.body.model_id, "synthetic-dialogue-model");
      assert.deepEqual(provider.body.inputs.map((row: { text: string }) => row.text), retakeSource.sections[0].dialogue!.map(row => row.text));
      assert.notDeepEqual(provider.body.inputs.map((row: { text: string }) => row.text), primary.sections[0].dialogue!.map(row => row.text));
      assert.equal(new Set(provider.body.inputs.map((row: { voice_id: string }) => row.voice_id)).size, 2);
      const retake = await begin("a", primary, "exam", retakeTab), afterPrewarm = requests.length;
      assert.notEqual(retake.id, exam.id); assert.notEqual(retake.contentId, exam.contentId);
      assert.notEqual(retake.content.questions[0].id, exam.content.questions[0].id);
      assertAudio(await attemptAudio("a", retake, 200, retakeTab), "elevenlabs", "hit");
      assert.equal(requests.length, afterPrewarm);
      assert.deepEqual(await database!.attempts.findOne({ _id: exam.id }), afterViolation);
      await request("a", "POST", `/attempts/${retake.id}/submit`, {}, 200, retakeTab);
    });

    await t.test("an exam deadline expiring during a cache read rejects delivery without claiming a play", async subtest => {
      subtest.after(() => gates.forEach(value => value.release()));
      await prewarm(alternate.sections);
      const tab = randomUUID(), exam = await begin("b", alternate, "exam", tab);
      // Keep the native integrity lease active while crossing the shorter sitting deadline.
      await database!.attempts.updateOne({ _id: exam.id }, { $set: { deadlineAt: new Date(now + 1_000).toISOString() } });
      const paused = pauseNextCacheRead(), before = requests.length;
      const pending = attemptAudio("b", exam, 409, tab);
      await entered(paused);
      assert.notEqual((await database!.attempts.findOne({ _id: exam.id }))!.listeningPlayed, true);
      now += 2_000;
      paused.release(); await pending;
      const finished = await database!.attempts.findOne({ _id: exam.id }); assert.ok(finished);
      assert.equal(finished.status, "submitted"); assert.notEqual(finished.listeningPlayed, true);
      assert.deepEqual(finished.responses, {}); assert.equal(finished.invalidatedAt, undefined);
      assert.equal(requests.length, before);
      await attemptAudio("b", exam, 409, tab);
      assert.equal(requests.length, before);
    });

    await t.test("aborting a native HTTP cache read preserves the exam play and permits one later delivery", async subtest => {
      subtest.after(() => gates.forEach(value => value.release()));
      await prewarm(primary.sections);
      const tab = randomUUID(), exam = await begin("b", primary, "exam", tab);
      const before = await snapshot(true), beforeCalls = requests.length;
      const paused = pauseNextCacheRead(), controller = new AbortController();
      const observedRequest = once(server!, "request");
      const pending = originalFetch(`${origin}/api/attempts/${exam.id}/listening-audio`, {
        method: "POST", headers: { Cookie: cookies.b, "X-Exam-Tab": tab }, signal: controller.signal,
      });
      const aborted = assert.rejects(pending, error => error instanceof Error && error.name === "AbortError");
      await entered(paused);
      const [incoming, outgoing] = await observedRequest;
      assert.equal(incoming.url, `/api/attempts/${exam.id}/listening-audio`);
      const closed = once(outgoing, "close");
      controller.abort();
      await aborted; await closed;
      assert.equal(outgoing.destroyed, true);
      paused.release();
      assert.deepEqual(await snapshot(true), before);
      const untouched = await database!.attempts.findOne({ _id: exam.id }); assert.ok(untouched);
      assert.equal(untouched.status, "in-progress"); assert.notEqual(untouched.listeningPlayed, true);
      assertAudio(await attemptAudio("b", exam, 200, tab), "elevenlabs", "hit");
      assert.equal(requests.length, beforeCalls);
      assert.equal((await database!.attempts.findOne({ _id: exam.id }))!.listeningPlayed, true);
      await attemptAudio("b", exam, 409, tab);
      await request("b", "POST", `/attempts/${exam.id}/submit`, {}, 200, tab);
    });

    await t.test("placement requires the whole bank prepared and cached reads reject stale or invalidated questions", async subtest => {
      subtest.after(() => gates.forEach(value => value.release()));
      const listeningItems = bank.filter(item => item.skill === "listening");
      await prewarm([{ id: listeningItems[0].id, title: "", text: listeningItems[0].text }]);
      const partial = (await request("a", "GET", "/placement/audio/readiness")).body.audio;
      assert.equal(partial.ready, false); assert.equal(partial.readyCount, 1); assert.equal(partial.totalCount, listeningItems.length);
      const partialBefore = await snapshot(true);
      await request("a", "POST", "/placement/start", { mode: "quick" }, 409, randomUUID());
      assert.deepEqual(await snapshot(true), partialBefore);
      for (const item of listeningItems.slice(1)) await prewarm([{ id: item.id, title: "", text: item.text }]);
      assertReadiness((await request("a", "GET", "/placement/audio/readiness")).body, true, listeningItems.length);
      const tab = randomUUID();
      let placement: PlacementState = (await request("a", "POST", "/placement/start", { mode: "quick" }, 201, tab)).body.placement;
      assert.equal(placement.question!.skill, "reading");
      const initialId = placement.question!.id, before = requests.length;
      await placementAudio("a", placement, initialId, 400);
      await placementAudio(null, placement, initialId, 401, tab);
      await placementAudio("b", placement, initialId, 404, randomUUID());
      await placementAudio("a", placement, initialId, 400, tab);
      await placementAudio("a", placement, listeningItems[0].id, 409, tab);
      assert.equal(requests.length, before);
      placement = await answer(placement, tab);
      assert.equal(placement.question!.skill, "listening");
      const currentId = placement.question!.id, unchanged = await snapshot(true);
      const first = await placementAudio("a", placement, currentId, 200, tab);
      assertAudio(first, "elevenlabs", "hit");
      assertAudio(await placementAudio("a", placement, currentId, 200, tab), "elevenlabs", "hit");
      assert.equal(requests.length, before); assert.deepEqual(await snapshot(true), unchanged);
      placement = await answer(placement, tab);
      await placementAudio("a", placement, currentId, 409, tab);
      placement = await answer(placement, tab);
      assert.equal(placement.question!.skill, "listening");
      const lateId = placement.question!.id, paused = pauseNextCacheRead();
      const pending = placementAudio("a", placement, lateId, 409, tab);
      await entered(paused);
      placement = await answer(placement, tab);
      const afterAnswer = await database!.placements.findOne({ _id: placement.id });
      assert.equal(afterAnswer!.answers.at(-1)!.questionId, lateId);
      paused.release(); await pending;
      assert.deepEqual(await database!.placements.findOne({ _id: placement.id }), afterAnswer);
      placement = await answer(placement, tab);
      assert.equal(placement.question!.skill, "listening");
      const invalidatedId = placement.question!.id, pausedInvalidated = pauseNextCacheRead();
      const cancelledAudio = placementAudio("a", placement, invalidatedId, 409, tab);
      await entered(pausedInvalidated);
      await request("a", "POST", `/exam-integrity/${sessionId(placement)}/violation`, { tabId: tab, reason: "hidden" });
      const afterViolation = await database!.placements.findOne({ _id: placement.id });
      assert.equal(afterViolation!.completionReason, "invalidated"); assert.equal(afterViolation!.currentQuestionId, null);
      assert.deepEqual(afterViolation!.answers, []); assert.equal(afterViolation!.draftAnswer, null);
      pausedInvalidated.release(); await cancelledAudio;
      assert.deepEqual(await database!.placements.findOne({ _id: placement.id }), afterViolation);
      await placementAudio("a", placement, invalidatedId, 409, tab);
      assert.equal(requests.length, before);
    });
  } finally {
    gates.forEach(value => value.release());
    GridFSBucket.prototype.openDownloadStream = originalDownload;
    if (server) {
      server.closeAllConnections();
      await new Promise<void>(resolve => server!.close(() => resolve()));
    }
    try {
      if (database) {
        assert.match(database.db.databaseName, ownedDatabasePattern);
        try { await database.db.dropDatabase(); }
        finally { await database.client.close(); }
      }
    } finally {
      globalThis.fetch = originalFetch;
      for (const key of Object.keys(process.env)) if (!(key in environmentBefore)) delete process.env[key];
      Object.assign(process.env, environmentBefore);
    }
  }
});
