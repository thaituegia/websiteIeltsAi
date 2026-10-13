import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { test } from "node:test";
import { Binary, GridFSBucket, MongoClient, MongoOperationTimeoutError, type Collection, type FindOptions } from "mongodb";
import { SpeechAudioCache, SpeechProviderError, speechCapabilities, synthesizeSpeechAudio } from "../server/speech-audio";
import type { Database } from "../server/storage";
import type { ContentSection } from "../shared/types";

const environmentNames = ["IELTS_OPENAI_API_KEY", "OPENAI_API_KEY", "ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_BRITISH", "ELEVENLABS_VOICE_AMERICAN", "ELEVENLABS_VOICE_AUSTRALIAN", "ELEVENLABS_MODEL"];
const syntheticKey = "sk-synthetic-listening-no-live-provider";
const sections: ContentSection[] = [{ id: "synthetic-dialogue", title: "Do not speak this heading", text: "Do not speak this duplicate transcript", dialogue: [
  { speaker: "Teacher", accent: "british", text: "What time does the library open?" },
  { speaker: "Student", accent: "british", text: "At nine, although the study room opens at ten." },
  { speaker: "Teacher", accent: "british", text: "Thank you. I will arrive at nine." },
] }];

function pcm(samples = [300, 600, 900]): Buffer<ArrayBuffer> {
  const buffer = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => buffer.writeInt16LE(sample, index * 2));
  return buffer;
}
function pcmResponse(split = false): Response {
  const buffer = pcm();
  return new Response(split ? new ReadableStream({ start(controller) { controller.enqueue(buffer.subarray(0, 3)); controller.enqueue(buffer.subarray(3)); controller.close(); } }) : buffer,
    { headers: { "content-type": "application/octet-stream", "content-length": String(buffer.length) } });
}
function controlledEnvironment(): () => void {
  const old = new Map(environmentNames.map(name => [name, process.env[name]]));
  environmentNames.forEach(name => delete process.env[name]);
  process.env.IELTS_OPENAI_API_KEY = syntheticKey;
  return () => old.forEach((value, name) => value === undefined ? delete process.env[name] : process.env[name] = value);
}

test("Listening synthesis preserves the authored cast and bounds provider transport", async t => {
  const restore = controlledEnvironment(), previousFetch = globalThis.fetch;
  let requests: { url: string; body: any; headers: Headers }[] = [];
  // All provider destinations are intercepted. No test can make a paid call.
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
    return pcmResponse(true);
  };
  try {
    await t.test("configuration prefers the existing IELTS key and assigns two British actors distinct voices", async () => {
      process.env.OPENAI_API_KEY = "sk-synthetic-other-key";
      const capabilities = speechCapabilities();
      assert.equal(capabilities.provider, "openai"); assert.equal(capabilities.configured, true); assert.equal(capabilities.voiceCount, 11);
      const result = await synthesizeSpeechAudio(sections);
      assert.equal(result.provider, "openai"); assert.equal(result.voiceCount, 2); assert.equal(result.mimetype, "audio/wav");
      assert.equal(requests.length, 3);
      assert.ok(requests.every(request => request.url === "https://api.openai.com/v1/audio/speech"));
      assert.ok(requests.every(request => request.headers.get("authorization") === `Bearer ${syntheticKey}`));
      assert.equal(requests[0].body.voice, requests[2].body.voice); assert.notEqual(requests[0].body.voice, requests[1].body.voice);
      assert.deepEqual(requests.map(request => request.body.input), sections[0].dialogue!.map(line => line.text));
      assert.ok(requests.every(request => request.body.model === "gpt-4o-mini-tts" && request.body.response_format === "pcm"));
      assert.ok(requests.every(request => /British English accent/u.test(request.body.instructions) && /verbatim/u.test(request.body.instructions)));
      assert.equal(result.buffer.toString("ascii", 0, 4), "RIFF"); assert.equal(result.buffer.readUInt32LE(24), 16000);
      assert.equal(result.buffer.readUInt32LE(40), 3 * 4 + 2 * 6400);
      assert.equal(result.buffer.readInt16LE(44), 300); assert.equal(result.buffer.readInt16LE(46), 750);
      assert.ok(result.buffer.subarray(48, 48 + 6400).every(value => value === 0));
    });
    await t.test("long turns retain the same voice and exact text across bounded chunks", async () => {
      requests = [];
      const text = "The library has several quiet study rooms. ".repeat(180);
      await synthesizeSpeechAudio([{ ...sections[0], dialogue: [{ speaker: "Alex", accent: "australian", text }] }]);
      assert.ok(requests.length >= 3); assert.equal(requests.map(request => request.body.input).join(""), text);
      assert.ok(requests.every(request => request.body.input.length <= 3000));
      assert.equal(new Set(requests.map(request => request.body.voice)).size, 1);
      assert.ok(requests.every(request => /Australian English accent/u.test(request.body.instructions) && !/Alex|male|female/u.test(request.body.instructions)));
    });
    await t.test("casting is stable and varied across lessons, with neutral role delivery", async () => {
      requests = [];
      for (let index = 0; index < 16; index++)
        await synthesizeSpeechAudio([{ ...sections[0], dialogue: sections[0].dialogue!.map((line, turn) => turn === 0 ? { ...line, text: `${line.text} Lesson ${index}.` } : line) }]);
      const firstVoices = requests.filter((_, index) => index % 3 === 0).map(request => request.body.voice);
      assert.ok(new Set(firstVoices).size > 3);
      assert.ok(requests.filter((_, index) => index % 3 === 0).every(request => /professional and encouraging/u.test(request.body.instructions)));
      assert.ok(requests.filter((_, index) => index % 3 === 1).every(request => /relaxed, curious/u.test(request.body.instructions)));
      assert.ok(requests.every(request => !/\b(male|female|Teacher|Student)\b/u.test(request.body.instructions)));
      const first = requests.slice(0, 3).map(request => request.body.voice);
      requests = [];
      await synthesizeSpeechAudio([{ ...sections[0], dialogue: sections[0].dialogue!.map((line, turn) => turn === 0 ? { ...line, text: `${line.text} Lesson 0.` } : line) }]);
      assert.deepEqual(requests.map(request => request.body.voice), first);
    });
    await t.test("flat Placement roles are omitted from input", async () => {
      requests = [];
      await synthesizeSpeechAudio([{ id: "synthetic-placement", title: "Placement title", text: "Teacher: When do you work? Student: I work at nine. Teacher: Thank you." }]);
      assert.deepEqual(requests.map(request => request.body.input), ["When do you work?", "I work at nine.", "Thank you."]);
      assert.equal(requests[0].body.voice, requests[2].body.voice); assert.notEqual(requests[0].body.voice, requests[1].body.voice);
    });
    await t.test("unconfigured, oversized and excessive-cast scripts make no request", async () => {
      requests = [];
      await assert.rejects(synthesizeSpeechAudio([{ ...sections[0], dialogue: [], text: "x".repeat(40001) }]), /giới hạn/u);
      await assert.rejects(synthesizeSpeechAudio([{ ...sections[0], dialogue: Array.from({ length: speechCapabilities().voiceCount + 1 }, (_, index) => ({ speaker: `Speaker ${index}`, accent: "british", text: "Hello." })) }]), /giọng đọc/u);
      delete process.env.IELTS_OPENAI_API_KEY; delete process.env.OPENAI_API_KEY;
      assert.deepEqual(speechCapabilities(), { configured: false, provider: null, voiceCount: 0 });
      await assert.rejects(synthesizeSpeechAudio(sections), /Chưa cấu hình/u);
      assert.equal(requests.length, 0); process.env.IELTS_OPENAI_API_KEY = syntheticKey;
    });
    await t.test("ElevenLabs fallback uses a distinct configured voice for same-accent actors and preserves its model", async () => {
      delete process.env.IELTS_OPENAI_API_KEY; delete process.env.OPENAI_API_KEY;
      process.env.ELEVENLABS_API_KEY = "synthetic-eleven-key";
      process.env.ELEVENLABS_VOICE_BRITISH = "synthetic-british"; process.env.ELEVENLABS_VOICE_AMERICAN = "synthetic-american"; process.env.ELEVENLABS_VOICE_AUSTRALIAN = "synthetic-australian";
      process.env.ELEVENLABS_MODEL = "synthetic-configured-model"; requests = [];
      const result = await synthesizeSpeechAudio(sections);
      assert.equal(result.provider, "elevenlabs"); assert.equal(requests.length, 1);
      assert.equal(requests[0].url, "https://api.elevenlabs.io/v1/text-to-dialogue?output_format=pcm_24000");
      assert.equal(requests[0].body.model_id, "synthetic-configured-model");
      const inputs = requests[0].body.inputs;
      assert.equal(inputs[0].voice_id, inputs[2].voice_id); assert.notEqual(inputs[0].voice_id, inputs[1].voice_id);
      assert.deepEqual(inputs.map((input: { text: string }) => input.text), sections[0].dialogue!.map(line => line.text));
      const independent = [{ ...sections[0], id: "synthetic-scene-one" }, { ...sections[0], id: "synthetic-scene-two" }];
      const scenes = await synthesizeSpeechAudio(independent);
      assert.equal(scenes.voiceCount, 2);
      const sceneInputs = requests.at(-1)!.body.inputs;
      assert.equal(sceneInputs[0].voice_id, sceneInputs[3].voice_id);
      assert.notEqual(sceneInputs[3].voice_id, sceneInputs[4].voice_id);
      process.env.ELEVENLABS_VOICE_AMERICAN = "synthetic-british"; assert.equal(speechCapabilities().configured, false);
      process.env.IELTS_OPENAI_API_KEY = syntheticKey;
    });
    for (const [label, response] of [
      ["non-audio", () => Response.json({ private: syntheticKey })],
      ["big-endian L16", () => new Response(pcm(), { headers: { "content-type": "audio/L16" } })],
      ["empty PCM", () => new Response(Buffer.alloc(0), { headers: { "content-type": "audio/pcm" } })],
      ["odd-sized PCM", () => new Response(Buffer.from([1, 2, 3]), { headers: { "content-type": "audio/pcm" } })],
      ["oversized advertised stream", () => new Response(pcm(), { headers: { "content-type": "audio/pcm", "content-length": String(200 * 1024 * 1024) } })],
      ["truncated PCM", () => new Response(pcm(), { headers: { "content-type": "audio/pcm", "content-length": "8" } })],
      ["paid-provider error", () => Response.json({ error: { message: `Private body ${syntheticKey}` } }, { status: 429 })],
    ] as const) await t.test(`rejects ${label} without exposing provider bodies`, async () => {
      globalThis.fetch = async () => response();
      await assert.rejects(synthesizeSpeechAudio(sections), error => error instanceof Error && !error.message.includes(syntheticKey) && !error.message.includes("Private body"));
    });
    await t.test("provider failures expose only safe retry categories and bound retry-after", async () => {
      for (const [status, code, expectedKind, retry, expectedDelay] of [
        [401, "private-code", "auth", undefined, undefined],
        [402, "private-code", "quota", undefined, undefined],
        [429, "insufficient_quota", "quota", undefined, undefined],
        [429, "rate_limit_exceeded", "rate-limit", "2", 2000],
        [429, "rate_limit_exceeded", "rate-limit", "999999", 300000],
        [500, "private-code", "unavailable", undefined, undefined],
      ] as const) {
        globalThis.fetch = async () => Response.json({ error: { code, message: `Private body ${syntheticKey}` } }, { status, headers: retry ? { "retry-after": retry } : {} });
        await assert.rejects(synthesizeSpeechAudio(sections), error => error instanceof SpeechProviderError
          && error.kind === expectedKind && error.retryAfterMs === expectedDelay
          && !JSON.stringify(error).includes(syntheticKey) && !error.message.includes("Private body"));
      }
      globalThis.fetch = async () => Response.json({ error: { message: "insufficient_quota" } }, { status: 429 });
      await assert.rejects(synthesizeSpeechAudio(sections), error => error instanceof SpeechProviderError && error.kind === "rate-limit");
    });
    await t.test("a stalled response body is cancelled and reported as a timeout", async () => {
      const previousTimer = globalThis.setTimeout; let cancelled = false;
      globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => previousTimer(callback, (delay ?? 0) >= 120000 ? 1 : delay, ...args)) as typeof setTimeout;
      globalThis.fetch = async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "content-type": "audio/pcm" } });
      try { await assert.rejects(synthesizeSpeechAudio(sections), error => error instanceof Error && "status" in error && error.status === 504); assert.equal(cancelled, true); }
      finally { globalThis.setTimeout = previousTimer; }
    });
    await t.test("one generation slot bounds concurrent jobs and releases after failure", async () => {
      let active = 0, maximum = 0, calls = 0;
      globalThis.fetch = async () => {
        active++; maximum = Math.max(maximum, active); calls++;
        await new Promise(resolve => setTimeout(resolve, 15)); active--;
        return calls === 1 ? Response.json({ error: "synthetic failure" }, { status: 500 }) : pcmResponse();
      };
      const outcomes = await Promise.allSettled([synthesizeSpeechAudio(sections), synthesizeSpeechAudio([{ ...sections[0], id: "synthetic-other-section" }])]);
      assert.equal(maximum, 1); assert.equal(outcomes[0].status, "rejected"); assert.equal(outcomes[1].status, "fulfilled");
    });
  } finally { globalThis.fetch = previousFetch; restore(); }
});

// Always use a local, random owned database; never inherit the app Mongo URI.
const ownedDatabasePattern = /^ielts_speech_test_\d+_[a-f0-9]{32}$/;
const mutationCommands = new Set(["insert", "update", "delete", "findAndModify", "create", "createIndexes", "drop", "dropIndexes"]);
function changedSections(label: string): ContentSection[] {
  return [{ ...sections[0], dialogue: sections[0].dialogue!.map(line => ({ ...line, text: `${line.text} ${label}.` })) }];
}
function hasStatus(status: number) {
  return (error: unknown) => error instanceof Error && "status" in error && error.status === status;
}

test("section GridFS cache keeps learner reads free and resumes durable provider work", async t => {
  const restore = controlledEnvironment(), previousFetch = globalThis.fetch;
  const name = `ielts_speech_test_${process.pid}_${randomBytes(16).toString("hex")}`;
  assert.match(name, ownedDatabasePattern);
  const client = new MongoClient("mongodb://127.0.0.1:27017", { serverSelectionTimeoutMS: 5000, maxPoolSize: 3, monitorCommands: true });
  const secondClient = new MongoClient("mongodb://127.0.0.1:27017", { serverSelectionTimeoutMS: 5000, maxPoolSize: 3 });
  const commands: { name: string; collection?: string }[] = [];
  client.on("commandStarted", event => {
    if (event.databaseName === name) commands.push({ name: event.commandName, collection: typeof event.command[event.commandName] === "string" ? event.command[event.commandName] : undefined });
  });
  let calls = 0;
  const requestVoices: string[] = [];
  const providerFetch: typeof fetch = async (url, init) => {
    assert.equal(String(url), "https://api.openai.com/v1/audio/speech");
    requestVoices.push(JSON.parse(String(init?.body)).voice);
    calls++; await new Promise(resolve => setTimeout(resolve, 10)); return pcmResponse();
  };
  globalThis.fetch = providerFetch;
  try {
    await client.connect(); await secondClient.connect();
    const db = client.db(name), secondDb = secondClient.db(name);
    const database = { db } as Database, secondDatabase = { db: secondDb } as Database;
    await db.collection("users").insertOne({ marker: "synthetic-private-user", answers: ["private-answer"] });
    await db.collection("recordings.files").insertOne({ marker: "synthetic-private-recording" });
    const privateBefore = { users: await db.collection("users").find().toArray(), recordings: await db.collection("recordings.files").find().toArray() };
    const cache = new SpeechAudioCache(database), otherCache = new SpeechAudioCache(secondDatabase);
    let canonicalFingerprint = "";
    await t.test("constructing, readiness and missing learner reads create no collections or indexes", async () => {
      commands.length = 0;
      speechCapabilities();
      const pending = await cache.readiness(sections);
      assert.equal(pending.configured, true); assert.equal(pending.ready, false); assert.equal(pending.state, "pending");
      assert.equal(pending.readyCount, 0); assert.equal(pending.totalCount, 1); assert.ok(pending.notice);
      const started = performance.now();
      await assert.rejects(cache.getReady(sections), hasStatus(409));
      assert.ok(performance.now() - started < 1000, "missing learner audio must not wait for a generation lease");
      assert.equal(calls, 0); assert.ok(commands.every(command => !mutationCommands.has(command.name)));
      assert.deepEqual((await db.listCollections().toArray()).map(collection => collection.name).sort(), ["recordings.files", "users"]);
      delete process.env.IELTS_OPENAI_API_KEY;
      commands.length = 0;
      try {
        const disabled = await cache.readiness(sections);
        assert.deepEqual(disabled, { configured: false, ready: true, state: "disabled", notice: "", readyCount: 1, totalCount: 1 });
        assert.equal(commands.length, 0);
      } finally { process.env.IELTS_OPENAI_API_KEY = syntheticKey; }
    });
    await t.test("same-instance requests coalesce and a fresh Mongo connection reuses section and turn files", async () => {
      const [first, second] = await Promise.all([cache.get(sections), cache.get(sections)]);
      assert.equal(first.cached, false); assert.equal(second.cached, true); assert.equal(calls, 3); assert.deepEqual(first.buffer, second.buffer);
      const third = await otherCache.get(sections); assert.equal(third.cached, true); assert.equal(calls, 3); assert.deepEqual(first.buffer, third.buffer);
      assert.equal(await db.collection("speech_audio.files").countDocuments({ "metadata.kind": "section" }), 1);
      assert.equal(await db.collection("speech_audio.files").countDocuments({ "metadata.kind": "turn" }), 3);
      assert.equal(await db.collection("speech_audio_jobs").countDocuments({ state: "ready" }), 1);
      canonicalFingerprint = (await db.collection("speech_audio.files").findOne({ "metadata.kind": "section" }))!.metadata.fingerprint;
      commands.length = 0;
      const ready = await cache.getReady(sections);
      assert.equal(ready.cached, true); assert.deepEqual(ready.buffer, first.buffer); assert.equal(calls, 3);
      assert.ok(commands.every(command => !mutationCommands.has(command.name)));
    });
    await t.test("readiness batches metadata and job lookups without downloading audio", async () => {
      const internals = cache as unknown as { bucket: GridFSBucket };
      const original = internals.bucket.openDownloadStream.bind(internals.bucket);
      internals.bucket.openDownloadStream = (() => { throw new Error("readiness must use metadata only"); }) as typeof internals.bucket.openDownloadStream;
      commands.length = 0;
      try {
        const ready = await cache.readiness([sections[0], { ...sections[0], id: "synthetic-duplicate-source" }]);
        assert.deepEqual(ready, { configured: true, ready: true, state: "ready", notice: "", readyCount: 2, totalCount: 2 });
        const pending = await cache.readiness([sections[0], changedSections("Unprepared section")[0]]);
        assert.equal(pending.state, "pending"); assert.equal(pending.readyCount, 1); assert.equal(pending.totalCount, 2);
        assert.ok(pending.notice); assert.equal(calls, 3);
      } finally { internals.bucket.openDownloadStream = original; }
      assert.equal(commands.filter(command => command.name === "find" && command.collection === "speech_audio.files").length, 2);
      assert.equal(commands.filter(command => command.name === "find" && command.collection === "speech_audio_jobs").length, 2);
      assert.ok(commands.every(command => !mutationCommands.has(command.name) && command.collection !== "speech_audio.chunks"));
    });
    await t.test("native metadata deadlines return safe failures without writes or provider work", async () => {
      assert.match(db.databaseName, ownedDatabasePattern);
      const internals = cache as unknown as { files: Collection; jobs: Collection };
      const snapshot = async () => Object.fromEntries(await Promise.all(
        ["users", "recordings.files", "speech_audio_jobs", "speech_audio.files", "speech_audio.chunks"].map(async name =>
          [name, await db.collection(name).find().sort({ _id: 1 }).toArray()]),
      ));
      const before = await snapshot(), providerCalls = calls;
      for (const collection of [internals.files, internals.jobs]) {
        const original = collection.find.bind(collection);
        let intercepted = 0, timeouts = 0;
        collection.find = ((filter = {}, options: FindOptions = {}) => {
          assert.equal(options.timeoutMS, 5000);
          assert.equal(options.timeoutMode, "cursorLifetime");
          intercepted++;
          // Delay only queries in this owned database; no server-wide failpoint.
          // Keep the native cursor/transport and accelerate the production bound.
          const cursor = original({ ...filter, $where: "function(){sleep(1000);return true;}" }, { ...options, timeoutMS: 150 });
          const toArray = cursor.toArray.bind(cursor);
          cursor.toArray = async () => {
            try { return await toArray(); }
            catch (error) {
              assert.ok(error instanceof MongoOperationTimeoutError);
              timeouts++; throw error;
            }
          };
          return cursor;
        }) as typeof collection.find;
        commands.length = 0;
        const started = performance.now();
        try {
          await assert.rejects(cache.readiness(sections), error => {
            assert.ok(hasStatus(503)(error));
            assert.equal((error as Error).message, "Không thể kiểm tra audio lúc này. Vui lòng thử lại sau.");
            return true;
          });
          await assert.rejects(cache.getReady(sections), error => {
            assert.ok(hasStatus(503)(error));
            assert.equal((error as Error).message, "Không thể tải audio lúc này. Vui lòng thử lại sau.");
            return true;
          });
          assert.equal(intercepted, 2); assert.equal(timeouts, 2);
          assert.ok(performance.now() - started < 2000, "Native CSOT must interrupt stalled metadata queries");
          assert.equal(calls, providerCalls);
          assert.ok(commands.every(command => !mutationCommands.has(command.name) && command.collection !== "speech_audio.chunks"));
        } finally { collection.find = original; }
        assert.deepEqual(await snapshot(), before);
      }
      assert.equal((await cache.readiness(sections)).state, "ready");
      assert.equal((await cache.getReady(sections)).cached, true);
      assert.equal(calls, providerCalls);
    });
    await t.test("native GridFS deadlines stop stalled playback without consuming or repairing audio", async () => {
      assert.match(db.databaseName, ownedDatabasePattern);
      const internals = cache as unknown as { bucket: GridFSBucket };
      const original = internals.bucket.openDownloadStream.bind(internals.bucket), providerCalls = calls;
      const snapshot = async () => Object.fromEntries(await Promise.all(
        ["users", "recordings.files", "speech_audio_jobs", "speech_audio.files", "speech_audio.chunks"].map(async name =>
          [name, await db.collection(name).find().sort({ _id: 1 }).toArray()]),
      ));
      const before = await snapshot();
      let download: ReturnType<GridFSBucket["openDownloadStream"]> | undefined, chunkQueries = 0, timedOut = false;
      let chunks: Collection | undefined, originalFind: Collection["find"] | undefined;
      internals.bucket.openDownloadStream = ((id, options) => {
        assert.equal(options?.timeoutMS, 20000);
        const stream = download = original(id, { ...options, timeoutMS: 150 });
        stream.once("error", error => { timedOut = error instanceof MongoOperationTimeoutError; });
        chunks = (stream as unknown as { s: { chunks: Collection } }).s.chunks;
        const find = originalFind = chunks.find.bind(chunks);
        chunks.find = ((filter = {}, options = {}) => {
          chunkQueries++;
          return find({ ...filter, $where: "function(){sleep(1000);return true;}" }, options);
        }) as typeof chunks.find;
        return stream;
      }) as typeof internals.bucket.openDownloadStream;
      commands.length = 0;
      const started = performance.now();
      try {
        await assert.rejects(cache.getReady(sections), error => {
          assert.ok(hasStatus(503)(error));
          assert.equal((error as Error).message, "Không thể tải audio lúc này. Vui lòng thử lại sau.");
          return true;
        });
        assert.ok(performance.now() - started < 2000, "Native CSOT must interrupt stalled GridFS reads");
        assert.equal(chunkQueries, 1); assert.equal(download?.destroyed, true); assert.equal(timedOut, true);
        assert.equal(calls, providerCalls);
        assert.ok(commands.every(command => !mutationCommands.has(command.name)));
      } finally {
        internals.bucket.openDownloadStream = original;
        if (chunks && originalFind) chunks.find = originalFind;
      }
      assert.deepEqual(await snapshot(), before);
      assert.equal((await cache.getReady(sections)).cached, true);
      assert.equal(calls, providerCalls);
    });
    await t.test("source IDs, titles, duplicate transcript fields and normalized role labels reuse a canonical section", async () => {
      const before = calls;
      const equivalent = [{ ...sections[0], id: "synthetic-new-source", title: "Other heading", text: "Other duplicate transcript", dialogue: sections[0].dialogue!.map(line => ({ ...line, speaker: `  ${line.speaker.toUpperCase()}  `, text: `${line.speaker.toUpperCase()}: ${line.text}` })) }];
      assert.equal((await cache.get(equivalent)).cached, true);
      assert.equal((await otherCache.getReady(equivalent)).cached, true); assert.equal(calls, before);
      assert.equal(await db.collection("speech_audio.files").countDocuments({ "metadata.kind": "section" }), 1);
    });
    await t.test("multiple sections reuse local casting and assemble in requested order with a 200 ms gap", async () => {
      const alternate = changedSections("Second authored scene"), before = calls;
      const first = await cache.getReady(sections), second = await cache.get(alternate);
      assert.equal(calls - before, 3);
      const combined = await otherCache.getReady([alternate[0], sections[0]]);
      assert.equal(combined.cached, true); assert.equal(calls - before, 3);
      assert.equal(combined.voiceCount, new Set([...requestVoices.slice(0, 3), ...requestVoices.slice(before)]).size);
      const payload = Buffer.concat([second.buffer.subarray(44), Buffer.alloc(6400), first.buffer.subarray(44)]);
      assert.deepEqual(combined.buffer.subarray(44), payload); assert.equal(combined.buffer.readUInt32LE(40), payload.length);
      const repeated = await cache.get([sections[0], { ...sections[0], id: "synthetic-global-index-copy" }]);
      assert.equal(repeated.cached, true); assert.equal(repeated.voiceCount, first.voiceCount);
      assert.deepEqual(repeated.buffer.subarray(44), Buffer.concat([first.buffer.subarray(44), Buffer.alloc(6400), first.buffer.subarray(44)]));
    });
    await t.test("separate Mongo clients atomically claim the same uncached section", async () => {
      const changed = changedSections("Cross process scene"), before = calls;
      const [first, second] = await Promise.all([cache.get(changed), otherCache.get(changed)]);
      assert.equal(calls - before, 3); assert.equal([first, second].filter(result => result.cached).length, 1); assert.deepEqual(first.buffer, second.buffer);
    });
    await t.test("publishing between the file and claim lookups never triggers duplicate paid synthesis", async () => {
      const changed = changedSections("Publication race"), before = calls;
      const racingCache = new SpeechAudioCache(secondDatabase);
      const internals = racingCache as unknown as { initialize(): Promise<void>; files: Collection };
      await internals.initialize();
      const original = internals.files.findOne.bind(internals.files); let intercepted = false;
      internals.files.findOne = (async (...args: Parameters<typeof original>) => {
        const observed = await original(...args);
        if (!intercepted) { intercepted = true; assert.equal(observed, null); await cache.get(changed); }
        return observed;
      }) as typeof internals.files.findOne;
      try { assert.equal((await racingCache.get(changed)).cached, true); assert.equal(calls - before, 3); }
      finally { internals.files.findOne = original; }
    });
    await t.test("transient GridFS failures preserve valid audio and never trigger regeneration", async () => {
      const readCache = new SpeechAudioCache(secondDatabase);
      const internals = readCache as unknown as { initialize(): Promise<void>; bucket: GridFSBucket };
      await internals.initialize();
      const original = internals.bucket.openDownloadStream.bind(internals.bucket), before = calls;
      const fileIds = (await db.collection("speech_audio.files").find().toArray()).map(file => file._id);
      internals.bucket.openDownloadStream = (() => Readable.from((async function* () { throw new Error("synthetic storage transport failure"); })())) as unknown as typeof internals.bucket.openDownloadStream;
      try {
        await assert.rejects(readCache.getReady(sections), hasStatus(503));
        await assert.rejects(readCache.get(sections), hasStatus(503));
      } finally { internals.bucket.openDownloadStream = original; }
      assert.equal(calls, before); assert.deepEqual((await db.collection("speech_audio.files").find().toArray()).map(file => file._id), fileIds);
      assert.equal((await readCache.getReady(sections)).cached, true);
    });
    await t.test("text and authored accents invalidate a section; key rotation does not", async () => {
      const before = calls;
      process.env.IELTS_OPENAI_API_KEY = "sk-synthetic-rotated-key";
      assert.equal((await otherCache.getReady(sections)).cached, true); assert.equal(calls, before);
      const changedText = [{ ...sections[0], dialogue: sections[0].dialogue!.map((line, index) => index === 1 ? { ...line, text: "It opens at eight." } : line) }];
      assert.equal((await cache.get(changedText)).cached, false);
      const changedAccent = [{ ...sections[0], dialogue: sections[0].dialogue!.map(line => ({ ...line, accent: "american" as const })) }];
      assert.equal((await cache.get(changedAccent)).cached, false);
      assert.ok(calls > before); assert.equal((await cache.get([{ ...sections[0], id: "synthetic-new-source" }])).cached, true);
    });
    await t.test("learner reads reject pending or mismatched jobs immediately without repairing them", async () => {
      const file = await db.collection("speech_audio.files").findOne({ "metadata.kind": "section", "metadata.fingerprint": canonicalFingerprint }); assert.ok(file);
      const job = await db.collection("speech_audio_jobs").findOne({ _id: file.metadata.fingerprint }); assert.ok(job);
      const before = calls;
      for (const update of [{ state: "generating", owner: "synthetic-current-worker", leaseExpiresAt: new Date(Date.now() + 45000) }, { state: "ready", fileId: null }]) {
        await db.collection("speech_audio_jobs").updateOne({ _id: job._id }, { $set: update });
        const pendingBefore: unknown = await db.collection("speech_audio_jobs").findOne({ _id: job._id });
        commands.length = 0;
        const started = performance.now();
        assert.equal((await cache.readiness(sections)).state, "pending");
        await assert.rejects(cache.getReady(sections), hasStatus(409));
        assert.ok(performance.now() - started < 1000); assert.equal(calls, before);
        assert.ok(commands.every(command => !mutationCommands.has(command.name)));
        assert.deepEqual(await db.collection("speech_audio_jobs").findOne({ _id: job._id }), pendingBefore);
      }
      await db.collection("speech_audio_jobs").replaceOne({ _id: job._id }, job);
      await db.collection("speech_audio_jobs").deleteOne({ _id: job._id });
      assert.equal((await cache.readiness(sections)).state, "pending");
      assert.equal((await cache.get(sections)).cached, true); assert.equal(calls, before);
      assert.equal((await cache.readiness(sections)).state, "ready");
      assert.equal((await cache.getReady(sections)).cached, true);
      await db.collection("speech_audio_jobs").updateOne({ _id: job._id }, { $set: { state: "failed", leaseExpiresAt: new Date(0) }, $unset: { fileId: "" } });
      assert.equal((await cache.get(sections)).cached, true); assert.equal(calls, before);
      assert.equal((await cache.readiness(sections)).state, "ready");
    });
    await t.test("generation repairs expired section claims using persistent turns without new provider calls", async () => {
      const file = await db.collection("speech_audio.files").findOne({ "metadata.kind": "section", "metadata.fingerprint": canonicalFingerprint }); assert.ok(file);
      await new GridFSBucket(db, { bucketName: "speech_audio" }).delete(file._id);
      await db.collection("speech_audio_jobs").updateOne({ _id: file.metadata.fingerprint }, { $set: { state: "generating", owner: "synthetic-dead-worker", leaseExpiresAt: new Date(0) } });
      const before = calls; assert.equal((await cache.get(sections)).cached, false); assert.equal(calls, before);
      assert.equal((await cache.getReady(sections)).cached, true);
    });
    await t.test("invalid metadata and corrupt GridFS content stay untouched on reads and are repaired only by generation", async () => {
      for (const corruption of ["metadata", "bytes", "missing-chunks"] as const) {
        const file = await db.collection("speech_audio.files").findOne({ "metadata.kind": "section", "metadata.fingerprint": canonicalFingerprint });
        assert.ok(file);
        if (corruption === "metadata") await db.collection("speech_audio.files").updateOne({ _id: file._id }, { $set: { "metadata.mimetype": "application/json" } });
        else if (corruption === "bytes") {
          const chunk = await db.collection("speech_audio.chunks").findOne({ files_id: file._id }); assert.ok(chunk);
          const invalid = Buffer.from(chunk.data.buffer); invalid[0] = 0;
          await db.collection("speech_audio.chunks").updateOne({ _id: chunk._id }, { $set: { data: new Binary(invalid) } });
        } else await db.collection("speech_audio.chunks").deleteMany({ files_id: file._id });
        const filesBefore = await db.collection("speech_audio.files").find().toArray(), chunksBefore = await db.collection("speech_audio.chunks").find().toArray();
        const before = calls;
        commands.length = 0;
        const readiness = await cache.readiness(sections);
        assert.equal(readiness.state, corruption === "metadata" ? "pending" : "ready");
        await assert.rejects(cache.getReady(sections), hasStatus(409));
        assert.equal(calls, before); assert.ok(commands.every(command => !mutationCommands.has(command.name)));
        assert.deepEqual(await db.collection("speech_audio.files").find().toArray(), filesBefore);
        assert.deepEqual(await db.collection("speech_audio.chunks").find().toArray(), chunksBefore);
        assert.equal((await cache.get(sections)).cached, false); assert.equal(calls, before);
        assert.equal((await cache.getReady(sections)).cached, true);
        assert.equal(await db.collection("speech_audio.files").countDocuments({ "metadata.fingerprint": file.metadata.fingerprint }), 1);
      }
    });
    await t.test("failed provider audio is never stored and a retry succeeds", async () => {
      const changed = changedSections("Failed provider scene"), filesBefore = await db.collection("speech_audio.files").countDocuments();
      globalThis.fetch = async () => Response.json({ error: { message: syntheticKey } }, { status: 500 });
      await assert.rejects(cache.get(changed), /audio hợp lệ/u);
      assert.equal(await db.collection("speech_audio.files").countDocuments(), filesBefore);
      globalThis.fetch = providerFetch;
      assert.equal((await cache.get(changed)).cached, false);
    });
    for (const failure of ["quota", "network"] as const) await t.test(`persistent completed turns resume after a ${failure} failure in a fresh worker`, async () => {
      const dialogue = Array.from({ length: 5 }, (_, index) => ({ speaker: index % 2 ? "Student" : "Teacher", accent: "british" as const, text: `Synthetic ${failure} resume turn ${index}.` }));
      const changed = [{ ...sections[0], dialogue }];
      const completed = new Set<string>(), firstInputs: string[] = [];
      let active = 0, maximum = 0;
      globalThis.fetch = async (url, init) => {
        assert.equal(String(url), "https://api.openai.com/v1/audio/speech");
        const input = JSON.parse(String(init?.body)).input as string;
        firstInputs.push(input); active++; maximum = Math.max(maximum, active);
        try {
          await new Promise(resolve => setTimeout(resolve, input === dialogue[2].text ? 25 : 5));
          if (input === dialogue[2].text) {
            if (failure === "network") throw new Error(`synthetic private network body ${syntheticKey}`);
            return Response.json({ error: { code: "insufficient_quota", type: "insufficient_quota", message: `synthetic private body ${syntheticKey}` } }, { status: 429 });
          }
          completed.add(input); return pcmResponse();
        } finally { active--; }
      };
      await assert.rejects(cache.get(changed), error => error instanceof Error && !error.message.includes(syntheticKey) && !error.message.includes("private"));
      assert.equal(maximum, 2); assert.equal(active, 0);
      assert.ok(completed.has(dialogue[0].text) && completed.has(dialogue[1].text));
      assert.equal(firstInputs.filter(input => input === dialogue[0].text).length, 1);
      assert.equal((await cache.readiness(changed)).state, "pending");
      const retryInputs: string[] = [];
      globalThis.fetch = async (url, init) => { assert.equal(String(url), "https://api.openai.com/v1/audio/speech"); retryInputs.push(JSON.parse(String(init?.body)).input); return pcmResponse(); };
      assert.equal((await new SpeechAudioCache(secondDatabase).get(changed)).cached, false);
      assert.ok(retryInputs.includes(dialogue[2].text));
      for (const input of completed) assert.ok(!retryInputs.includes(input), "completed PCM must not be purchased again");
      assert.equal((await otherCache.getReady(changed)).cached, true);
      globalThis.fetch = providerFetch;
    });
    await t.test("losing a generation lease cancels provider work without publishing audio", async () => {
      const changed = changedSections("Lost lease scene"), filesBefore = await db.collection("speech_audio.files").countDocuments();
      const previousInterval = globalThis.setInterval, mockFetch = globalThis.fetch;
      globalThis.setInterval = ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => previousInterval(callback, (delay ?? 0) >= 15000 ? 1 : delay, ...args)) as typeof setInterval;
      globalThis.fetch = async (_url, init) => {
        await db.collection("speech_audio_jobs").updateOne({ state: "generating" }, { $set: { owner: "synthetic-replacement-worker" } });
        await new Promise<void>((_resolve, reject) => {
          if (init?.signal?.aborted) reject(new Error("synthetic abort"));
          else init?.signal?.addEventListener("abort", () => reject(new Error("synthetic abort")), { once: true });
        });
        throw new Error("Synthetic provider must abort.");
      };
      try { await assert.rejects(cache.get(changed), hasStatus(503)); }
      finally { globalThis.setInterval = previousInterval; globalThis.fetch = mockFetch; }
      assert.equal(await db.collection("speech_audio.files").countDocuments(), filesBefore);
      assert.equal(await db.collection("speech_audio_jobs").countDocuments({ owner: "synthetic-replacement-worker", state: "generating" }), 1);
    });
    await t.test("ElevenLabs model and configured voice changes invalidate durable sections", async () => {
      delete process.env.IELTS_OPENAI_API_KEY;
      process.env.ELEVENLABS_API_KEY = "synthetic-eleven-key";
      process.env.ELEVENLABS_VOICE_BRITISH = "synthetic-british"; process.env.ELEVENLABS_VOICE_AMERICAN = "synthetic-american"; process.env.ELEVENLABS_VOICE_AUSTRALIAN = "synthetic-australian";
      process.env.ELEVENLABS_MODEL = "synthetic-model-one";
      let elevenCalls = 0;
      const mockFetch = globalThis.fetch;
      globalThis.fetch = async url => { assert.match(String(url), /api\.elevenlabs\.io/u); elevenCalls++; return pcmResponse(); };
      try {
        assert.equal((await cache.get(sections)).cached, false); assert.equal((await otherCache.getReady(sections)).cached, true);
        process.env.ELEVENLABS_MODEL = "synthetic-model-two"; assert.equal((await cache.get(sections)).cached, false);
        process.env.ELEVENLABS_VOICE_BRITISH = "synthetic-british-updated"; assert.equal((await cache.get(sections)).cached, false);
        assert.equal(elevenCalls, 3);
      } finally { process.env.IELTS_OPENAI_API_KEY = syntheticKey; globalThis.fetch = mockFetch; }
    });
    await t.test("metadata excludes keys, raw scripts and learner data, and private collections remain byte-equivalent", async () => {
      const metadata = JSON.stringify((await db.collection("speech_audio.files").find().toArray()).map(file => file.metadata));
      assert.doesNotMatch(metadata, /sk-synthetic|private-answer|synthetic-private-user|What time|Teacher|Student|Synthetic quota|Synthetic network/u);
      assert.deepEqual(await db.collection("users").find().toArray(), privateBefore.users);
      assert.deepEqual(await db.collection("recordings.files").find().toArray(), privateBefore.recordings);
      assert.ok((await db.listCollections().toArray()).every(collection => ["users", "recordings.files", "speech_audio.files", "speech_audio.chunks", "speech_audio_jobs"].includes(collection.name)));
    });
  } finally {
    globalThis.fetch = previousFetch; restore();
    assert.equal(client.db(name).databaseName, name); assert.match(name, ownedDatabasePattern);
    try { await client.db(name).dropDatabase(); } finally { await Promise.all([client.close(), secondClient.close()]); }
  }
});
