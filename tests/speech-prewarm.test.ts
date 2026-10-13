import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { MongoClient, MongoOperationTimeoutError, type Db, type Document, type Filter, type FindOptions } from "mongodb";
import { parseSpeechPrewarmArguments } from "../server/speech-prewarm-cli";
import { inspectSpeechBank, readSpeechPrewarmStatus, runSpeechBankPrewarm } from "../server/speech-prewarm";
import { SpeechAudioCache, speechSectionFingerprint } from "../server/speech-audio";
import type { ContentSection } from "../shared/types";

const ownedDatabasePattern = /^ielts_prewarm_test_\d+_[a-f0-9]{32}$/;
const syntheticKey = "sk-synthetic-prewarm-no-live-provider";
const environmentNames = ["IELTS_OPENAI_API_KEY", "OPENAI_API_KEY", "ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_BRITISH", "ELEVENLABS_VOICE_AMERICAN", "ELEVENLABS_VOICE_AUSTRALIAN", "ELEVENLABS_MODEL"];
function pcmResponse(): Response {
  const buffer = Buffer.alloc(12);
  [400, 800, 1200, 1600, 2000, 2400].forEach((value, index) => buffer.writeInt16LE(value, index * 2));
  return new Response(buffer, { headers: { "content-type": "audio/pcm", "content-length": String(buffer.length) } });
}
function section(id: string, text: string): ContentSection { return { id, title: "Never speak this heading", text }; }
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function assertCalls(actual: string[], expected: string[]): void {
  // Independent provider turns may arrive in either order; successful turns
  // must still be paid for exactly once and only failed turns retried.
  assert.deepEqual([...actual].sort(), [...expected].sort());
}

test("administrative speech CLI defaults to read-only inspection and rejects unbounded arguments", () => {
  assert.deepEqual(parseSpeechPrewarmArguments([]), { mode: "inspect", maxClips: 32, maxRetries: 3, intervalMs: 60_000, resume: false });
  assert.deepEqual(parseSpeechPrewarmArguments(["--watch", "--max-clips", "10", "--max-retries", "2", "--interval-seconds", "90", "--resume"]),
    { mode: "watch", maxClips: 10, maxRetries: 2, intervalMs: 90_000, resume: true });
  for (const args of [["--inspect", "--once"], ["--once", "--max-clips", "0"], ["--once", "--max-clips", "4097"], ["--watch", "--max-retries", "6"], ["--watch", "--interval-seconds", "0"], ["--once", "--max-clips", "Infinity"], ["--inspect", "--resume"], ["--unknown"]])
    assert.throws(() => parseSpeechPrewarmArguments(args));
});

test("speech pregeneration rejects unrelated databases before any collection access", async () => {
  const database = { databaseName: "synthetic-unowned", collection() { throw new Error("Must not touch Mongo before the guard."); } } as unknown as Db;
  await assert.rejects(runSpeechBankPrewarm(database), /exact IELTS database/u);
  await assert.rejects(runSpeechBankPrewarm(database, { expectedDatabase: "synthetic-unowned" }), /exact IELTS database/u);
  await assert.rejects(inspectSpeechBank(database), /exact IELTS database/u);
});

test("native Mongo pregeneration is resumable, bounded, independent of learner state, and pauses hard provider failures", { timeout: 60_000 }, async t => {
  const name = `ielts_prewarm_test_${process.pid}_${randomBytes(16).toString("hex")}`;
  assert.match(name, ownedDatabasePattern);
  // Deliberately never inherit the application's URI or use its seeded database.
  const client = new MongoClient("mongodb://127.0.0.1:27017", { serverSelectionTimeoutMS: 5000, maxPoolSize: 3 });
  const secondClient = new MongoClient("mongodb://127.0.0.1:27017", { serverSelectionTimeoutMS: 5000, maxPoolSize: 2 });
  const old = new Map(environmentNames.map(key => [key, process.env[key]]));
  environmentNames.forEach(key => delete process.env[key]); process.env.IELTS_OPENAI_API_KEY = syntheticKey;
  const previousFetch = globalThis.fetch, previousTimer = globalThis.setTimeout;
  const calls: string[] = [];
  let respond = (_text: string, _signal?: AbortSignal | null): Promise<Response> | Response => pcmResponse();
  // Every paid destination is intercepted, including failure/retry paths.
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://api.openai.com/v1/audio/speech");
    const input = JSON.parse(String(init?.body)).input;
    calls.push(input); return respond(input, init?.signal);
  };
  // Accelerate worker pacing/backoff only, retaining the provider transport timeout.
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, milliseconds?: number, ...args: unknown[]) =>
    previousTimer(callback, milliseconds === 1000 || (milliseconds && milliseconds >= 30_000 && milliseconds < 45_000) ? 1 : milliseconds, ...args)) as typeof setTimeout;
  const expectedDatabase = name;
  try {
    await client.connect(); await secondClient.connect();
    const db = client.db(name), otherDb = secondClient.db(name);
    const dialogue: ContentSection = { id: "synthetic-original-scene", title: "Ignored", text: "Ignored duplicate transcript", dialogue: [
      { speaker: "Teacher", accent: "british", text: "The synthetic library opens at nine." },
      { speaker: "Student", accent: "british", text: "I will arrive at ten." },
    ] };
    await db.collection("content").insertMany([
      { id: "synthetic-source", skill: "listening", format: "full-mock", band: 6, sections: [section("synthetic-second", "This synthetic museum closes at six."), dialogue] },
      { id: "synthetic-remapped-variant", skill: "listening", format: "lesson", band: 3, sections: [{ ...dialogue, id: "synthetic-variant-scene" }] },
      { id: "synthetic-reading", skill: "reading", sections: [section("synthetic-reading-section", "Do not generate this reading source.")] },
    ]);
    await db.collection("placementItems").insertMany([
      { id: "synthetic-placement", skill: "listening", text: "The synthetic boat leaves at eleven.", answer: "Never read this keyed answer." },
      { id: "synthetic-reading-placement", skill: "reading", text: "Do not generate this reading placement." },
    ]);
    const privateNames = ["users", "sessions", "attempts", "placements", "duo_learning_paths", "duo_placement_results", "plans", "cards", "recordings.files", "recordings.chunks"];
    for (const collection of privateNames) await db.collection(collection).insertOne({ marker: `synthetic-private-${collection}`, answers: ["private-answer"] });
    const privateBefore = new Map<string, unknown>();
    for (const collection of [...privateNames, "content", "placementItems"]) privateBefore.set(collection, await db.collection(collection).find().toArray());

    await t.test("inspection discovers real Mongo listening sources, deduplicates ID remaps, and creates nothing", async () => {
      const before = await db.listCollections().toArray();
      const result = await inspectSpeechBank(db, { expectedDatabase });
      assert.deepEqual(result, { configured: true, state: "pending", total: 3, ready: 0, pending: 3, failed: 0 });
      assert.equal((await readSpeechPrewarmStatus(db)).total, 0); assert.equal(calls.length, 0);
      assert.deepEqual(await db.listCollections().toArray(), before);
    });

    await t.test("a bounded pass publishes one unique clip and a new process finishes only missing clips", async () => {
      const progress: number[] = [];
      const first = await runSpeechBankPrewarm(db, { expectedDatabase, maxClips: 1, onProgress: status => progress.push(status.ready) });
      assert.equal(first.state, "pending", JSON.stringify(first)); assert.equal(first.total, 3, JSON.stringify(first)); assert.equal(first.ready, 1, JSON.stringify(first)); assert.equal(first.pending, 2, JSON.stringify(first));
      assertCalls(calls, dialogue.dialogue!.map(line => line.text)); assert.ok(progress.includes(1));
      const second = await runSpeechBankPrewarm(otherDb, { expectedDatabase, maxClips: 2 });
      assert.equal(second.state, "complete"); assert.equal(second.ready, 3); assert.equal(second.failed, 0); assert.equal(calls.length, 4);
      assert.equal(await db.collection("speech_bank_prewarm").countDocuments(), 4);
      const before = calls.length;
      assert.equal((await runSpeechBankPrewarm(db, { expectedDatabase, maxClips: 1 })).ready, 3);
      assert.equal((await inspectSpeechBank(db, { expectedDatabase })).ready, 3); assert.equal(calls.length, before);
    });

    await t.test("a transient 503 retries with safe metadata and reuses successful partial turns", async () => {
      const retry = { id: "synthetic-retry", title: "", text: "", dialogue: [
        { speaker: "Teacher", accent: "british" as const, text: "Synthetic retry first successful turn." },
        { speaker: "Student", accent: "british" as const, text: "Synthetic retry second interrupted turn." },
      ] };
      await db.collection("content").insertOne({ id: "synthetic-retry-source", skill: "listening", sections: [retry] });
      let interrupted = false;
      respond = text => text === retry.dialogue[1].text && !interrupted
        ? (interrupted = true, Response.json({ error: { message: `Private provider body ${syntheticKey}` } }, { status: 503 })) : pcmResponse();
      const before = calls.length, result = await runSpeechBankPrewarm(db, { expectedDatabase, maxClips: 1, maxRetries: 1 });
      assert.equal(result.state, "complete"); assert.equal(result.ready, 4);
      assertCalls(calls.slice(before), [retry.dialogue[0].text, retry.dialogue[1].text, retry.dialogue[1].text]);
      assert.equal(await db.collection("speech_bank_prewarm").countDocuments({ attempts: 2, state: "ready" }), 1);
    });

    await t.test("quota exhaustion pauses the whole bank across restart; explicit resume preserves finished turns", async () => {
      const partial = { id: "synthetic-quota", title: "", text: "", dialogue: [
        { speaker: "Guide", accent: "american" as const, text: "Synthetic quota first successful turn." },
        { speaker: "Visitor", accent: "american" as const, text: "Synthetic quota second interrupted turn." },
      ] };
      await db.collection("content").insertMany([
        { id: "synthetic-quota-source", skill: "listening", sections: [partial] },
        { id: "synthetic-after-quota", skill: "listening", sections: [section("synthetic-after-quota-section", "Do not start until the provider quota is restored.")] },
      ]);
      respond = text => text === partial.dialogue[1].text
        ? Response.json({ error: { code: "insufficient_quota", type: "insufficient_quota", message: `Secret quota detail ${syntheticKey}` } }, { status: 429 }) : pcmResponse();
      const before = calls.length;
      const paused = await runSpeechBankPrewarm(db, { expectedDatabase, maxClips: 5, maxRetries: 3 });
      assert.equal(paused.state, "paused"); assert.equal(paused.lastErrorCode, "quota"); assert.equal(paused.ready, 4); assert.equal(paused.failed, 1); assert.equal(paused.pending, 1);
      assertCalls(calls.slice(before), partial.dialogue.map(line => line.text));
      assert.equal((await runSpeechBankPrewarm(otherDb, { expectedDatabase })).state, "paused"); assert.equal(calls.length - before, 2);
      assert.equal((await readSpeechPrewarmStatus(otherDb)).lastErrorCode, "quota");
      const inspection = await inspectSpeechBank(otherDb, { expectedDatabase });
      assert.equal(inspection.state, "paused"); assert.equal(inspection.failed, 1); assert.equal(inspection.lastErrorCode, "quota");
      respond = () => pcmResponse();
      const complete = await runSpeechBankPrewarm(otherDb, { expectedDatabase, maxClips: 2, resume: true });
      assert.equal(complete.state, "complete"); assert.equal(complete.ready, 6); assert.equal(complete.failed, 0);
      assertCalls(calls.slice(before), [partial.dialogue[0].text, partial.dialogue[1].text, partial.dialogue[1].text, "Do not start until the provider quota is restored."]);
      assert.equal((await readSpeechPrewarmStatus(db)).lastErrorCode, undefined);
    });

    await t.test("the whole-bank lease bounds concurrent worker services to one provider clip", async () => {
      const started = deferred(), released = deferred();
      const text = "A synthetic independently authored scene tests the bank lease.";
      await db.collection("content").insertOne({ id: "synthetic-lease-source", skill: "listening", sections: [section("synthetic-lease", text)] });
      respond = async input => { assert.equal(input, text); started.resolve(); await released.promise; return pcmResponse(); };
      const before = calls.length;
      const first = runSpeechBankPrewarm(db, { expectedDatabase, maxClips: 1 });
      await Promise.race([started.promise, first.then(result => assert.fail(`Worker returned before transport: ${JSON.stringify(result)}`))]);
      try {
        const concurrent = await runSpeechBankPrewarm(otherDb, { expectedDatabase, maxClips: 1 });
        assert.equal(concurrent.state, "running"); assert.equal(calls.length - before, 1);
      } finally { released.resolve(); }
      assert.equal((await first).state, "complete"); assert.equal(calls.length - before, 1);
      const bank = await db.collection("speech_bank_prewarm").findOne({ _id: "bank" as any });
      assert.equal(bank?.owner, undefined); assert.equal(bank?.leaseExpiresAt, undefined);
      respond = () => pcmResponse();
    });

    await t.test("service shutdown cancels active transport and restart preserves completed turns", async () => {
      const controller = new AbortController(), started = deferred();
      const scene = { id: "synthetic-shutdown", title: "", text: "", dialogue: [
        { speaker: "Caller", accent: "british" as const, text: "Synthetic shutdown completed first turn." },
        { speaker: "Agent", accent: "british" as const, text: "Synthetic shutdown interrupted second turn." },
      ] };
      await db.collection("content").insertOne({ id: "synthetic-shutdown-source", skill: "listening", sections: [scene] });
      respond = async (text, signal) => {
        if (text === scene.dialogue[0].text) return pcmResponse();
        assert.equal(text, scene.dialogue[1].text); started.resolve();
        await new Promise<void>((_resolve, reject) => {
          if (signal?.aborted) reject(new Error("Synthetic shutdown"));
          else signal?.addEventListener("abort", () => reject(new Error("Synthetic shutdown")), { once: true });
        });
        throw new Error("The synthetic provider transport must abort.");
      };
      const before = calls.length;
      const partsBefore = await db.collection("speech_audio.files").countDocuments({ "metadata.kind": "turn" });
      const stopping = runSpeechBankPrewarm(db, { expectedDatabase, maxClips: 1, signal: controller.signal });
      try {
        await Promise.race([started.promise, stopping.then(result => assert.fail(`Worker returned before transport: ${JSON.stringify(result)}`))]);
        for (let poll = 0; poll < 100 && await db.collection("speech_audio.files").countDocuments({ "metadata.kind": "turn" }) === partsBefore; poll++)
          await new Promise<void>(resolve => previousTimer(resolve, 10));
        assert.equal(await db.collection("speech_audio.files").countDocuments({ "metadata.kind": "turn" }), partsBefore + 1);
      } finally { controller.abort(); await stopping; }
      const interrupted = await stopping;
      assert.equal(interrupted.state, "pending"); assert.equal(interrupted.lastErrorCode, "interrupted"); assert.equal(interrupted.failed, 0);
      assertCalls(calls.slice(before), scene.dialogue.map(line => line.text));
      respond = () => pcmResponse();
      const restarted = await runSpeechBankPrewarm(otherDb, { expectedDatabase, maxClips: 1 });
      assert.equal(restarted.state, "complete");
      assertCalls(calls.slice(before), [scene.dialogue[0].text, scene.dialogue[1].text, scene.dialogue[1].text]);
    });

    await t.test("invalid newly authored audio is reported without blocking valid content", async () => {
      const validText = "The valid synthetic scene can be prepared despite another invalid source.";
      await db.collection("content").insertMany([
        { id: "synthetic-invalid-custom", skill: "listening", sections: [section("synthetic-invalid-section", "")] },
        { id: "synthetic-valid-custom", skill: "listening", sections: [section("synthetic-valid-section", validText)] },
      ]);
      const before = calls.length;
      const result = await runSpeechBankPrewarm(db, { expectedDatabase, maxClips: 1 });
      assert.equal(result.state, "pending"); assert.equal(result.failed, 1); assert.equal(result.pending, 0);
      assert.equal(result.total, result.ready + 1); assert.deepEqual(calls.slice(before), [validText]);
      const inspected = await inspectSpeechBank(db, { expectedDatabase });
      assert.equal(inspected.failed, 1); assert.equal(inspected.ready, result.ready);
      assert.equal((await runSpeechBankPrewarm(otherDb, { expectedDatabase, maxClips: 1, resume: true })).failed, 1);
      assert.deepEqual(calls.slice(before), [validText]);
    });

    await t.test("a bank publication failure preserves successful audio without retrying or double-counting it", async () => {
      const scene = section("synthetic-publish-fault", "Synthetic audio stays ready when its progress publication fails.");
      const baseline = await readSpeechPrewarmStatus(db), providerCalls = calls.length;
      await db.collection("content").insertOne({ id: scene.id, skill: "listening", sections: [scene] });
      const bank = db.collection<{ _id: string; state?: string; ready?: number; attempts?: number; lastErrorCode?: string }>("speech_bank_prewarm"), originalCollection = db.collection.bind(db);
      const originalUpdate = bank.updateOne.bind(bank);
      let publicationFailures = 0;
      bank.updateOne = (async (filter, update, options) => {
        const changes = Array.isArray(update) ? undefined : update.$set;
        if (filter._id === "bank" && changes?.state === "running" && changes?.ready === baseline.ready + 1 && !publicationFailures) {
          publicationFailures++;
          throw new MongoOperationTimeoutError(`Synthetic private publication response ${syntheticKey}`);
        }
        return originalUpdate(filter, update, options);
      }) as typeof bank.updateOne;
      db.collection = ((collectionName, options) => collectionName === "speech_bank_prewarm" ? bank : originalCollection(collectionName, options)) as typeof db.collection;
      respond = () => pcmResponse();
      try {
        const result = await runSpeechBankPrewarm(db, { expectedDatabase, maxClips: 1, maxRetries: 1 });
        assert.equal(publicationFailures, 1);
        assert.equal(result.ready, baseline.ready + 1); assert.equal(result.failed, baseline.failed);
        assert.equal(result.total, baseline.total + 1); assert.ok(result.ready + result.failed <= result.total);
        assert.equal(result.lastErrorCode, "storage"); assert.equal(result.lastErrorStage, "bank-publish");
        assertCalls(calls.slice(providerCalls), [scene.text]);
        const clip = await bank.findOne({ _id: `clip:${speechSectionFingerprint(scene)}` as any });
        assert.equal(clip?.state, "ready"); assert.equal(clip?.attempts, 1);
        assert.equal(clip?.lastErrorCode, undefined);
        assert.equal((await db.collection("speech_audio_jobs").findOne({ _id: speechSectionFingerprint(scene) as any }))?.state, "ready");
        const saved = await readSpeechPrewarmStatus(db);
        assert.equal(saved.ready, result.ready); assert.equal(saved.failed, baseline.failed); assert.equal(saved.total, result.total);
      } finally { db.collection = originalCollection; bank.updateOne = originalUpdate; }
    });

    await t.test("an interrupted initial scan keeps the last complete bank totals", async () => {
      const baseline = await readSpeechPrewarmStatus(db), providerCalls = calls.length;
      const controller = new AbortController(), originalReadiness = SpeechAudioCache.prototype.readiness;
      let inspected = 0;
      SpeechAudioCache.prototype.readiness = async function (sections) {
        const result = await originalReadiness.call(this, sections);
        if (++inspected === 1) controller.abort();
        return result;
      };
      try {
        const result = await runSpeechBankPrewarm(db, { expectedDatabase, signal: controller.signal });
        assert.equal(inspected, 1); assert.equal(result.state, "pending");
        assert.equal(result.lastErrorCode, "interrupted"); assert.equal(result.lastErrorStage, "bank-scan");
        for (const key of ["total", "ready", "failed", "pending"] as const) assert.equal(result[key], baseline[key]);
        const saved = await readSpeechPrewarmStatus(db);
        for (const key of ["total", "ready", "failed", "pending"] as const) assert.equal(saved[key], baseline[key]);
        assert.equal(calls.length, providerCalls);
      } finally { SpeechAudioCache.prototype.readiness = originalReadiness; }
    });

    await t.test("a provider response timeout is distinct from storage and retains only a safe stage", async () => {
      const scene = section("synthetic-body-timeout", "Synthetic provider PCM response never finishes.");
      await db.collection("content").insertOne({ id: scene.id, skill: "listening", sections: [scene] });
      const pacingTimer = globalThis.setTimeout, providerCalls = calls.length;
      globalThis.setTimeout = ((callback: (...args: unknown[]) => void, milliseconds?: number, ...args: unknown[]) => milliseconds === 120_000
        ? previousTimer(callback, 20, ...args) : pacingTimer(callback, milliseconds, ...args)) as typeof setTimeout;
      respond = () => new Response(new ReadableStream<Uint8Array>(), { headers: { "content-type": "audio/pcm" } });
      try {
        const result = await runSpeechBankPrewarm(db, { expectedDatabase, maxClips: 1, maxRetries: 0 });
        assert.equal(result.lastErrorCode, "provider-timeout"); assert.equal(result.lastErrorStage, "provider-response");
        assertCalls(calls.slice(providerCalls), [scene.text]);
        const clip = await db.collection("speech_bank_prewarm").findOne({ _id: `clip:${speechSectionFingerprint(scene)}` as any });
        assert.equal(clip?.state, "failed"); assert.equal(clip?.lastErrorCode, "provider-timeout");
        assert.equal(clip?.lastErrorStage, "provider-response"); assert.equal(clip?.retryable, true);
      } finally { globalThis.setTimeout = pacingTimer; respond = () => pcmResponse(); }
    });

    await t.test("an internal lease loss stays distinct from caller shutdown and storage", async () => {
      const scene = section("synthetic-internal-lease-loss", "Synthetic lease is replaced before provider PCM can be saved.");
      await db.collection("content").insertOne({ id: scene.id, skill: "listening", sections: [scene] });
      const providerCalls = calls.length;
      respond = async text => {
        assert.equal(text, scene.text);
        await db.collection("speech_audio_jobs").updateOne({ _id: speechSectionFingerprint(scene) as any, state: "generating" }, {
          $set: { owner: "synthetic-replacement-worker" },
        });
        return pcmResponse();
      };
      try {
        const result = await runSpeechBankPrewarm(db, { expectedDatabase, maxClips: 1, maxRetries: 0 });
        assert.equal(result.lastErrorCode, "lease-lost"); assert.equal(result.lastErrorStage, "lease-renew");
        assertCalls(calls.slice(providerCalls), [scene.text]);
        const clip = await db.collection("speech_bank_prewarm").findOne({ _id: `clip:${speechSectionFingerprint(scene)}` as any });
        assert.equal(clip?.state, "failed"); assert.equal(clip?.lastErrorCode, "lease-lost");
        assert.equal(clip?.lastErrorStage, "lease-renew");
        assert.equal(await db.collection("speech_audio.files").countDocuments({ "metadata.fingerprint": speechSectionFingerprint(scene) }), 0);
      } finally { respond = () => pcmResponse(); }
    });

    await t.test("a cache metadata transport failure retains a safe storage origin without provider work", async () => {
      const scene = section("synthetic-storage-origin", "Synthetic metadata failure must never enter a paid provider request.");
      await db.collection("content").insertOne({ id: scene.id, skill: "listening", sections: [scene] });
      const files = db.collection("speech_audio.files"), originalCollection = db.collection.bind(db);
      const originalFind = files.findOne.bind(files), providerCalls = calls.length;
      let intercepted = 0;
      files.findOne = (async (filter: Filter<Document> = {}, options: FindOptions = {}) => {
        if (filter?.["metadata.fingerprint"] === speechSectionFingerprint(scene)) {
          intercepted++;
          throw new MongoOperationTimeoutError(`Synthetic private storage response ${syntheticKey}`);
        }
        return originalFind(filter, options);
      }) as typeof files.findOne;
      db.collection = ((collectionName, options) => collectionName === "speech_audio.files" ? files : originalCollection(collectionName, options)) as typeof db.collection;
      try {
        const result = await runSpeechBankPrewarm(db, { expectedDatabase, maxClips: 1, maxRetries: 0 });
        assert.equal(intercepted, 1); assert.equal(result.lastErrorCode, "storage"); assert.equal(result.lastErrorStage, "cache-metadata");
        assert.equal(calls.length, providerCalls);
        const clip = await db.collection("speech_bank_prewarm").findOne({ _id: `clip:${speechSectionFingerprint(scene)}` as any });
        assert.equal(clip?.state, "failed"); assert.equal(clip?.lastErrorCode, "storage");
        assert.equal(clip?.lastErrorStage, "cache-metadata"); assert.equal(clip?.retryable, true);
        assert.doesNotMatch(JSON.stringify(await db.collection("speech_bank_prewarm").find().toArray()), /sk-synthetic|Synthetic private publication|Synthetic private storage/u);
      } finally { db.collection = originalCollection; files.findOne = originalFind; }
    });

    await t.test("a failed clip stays counted when its transition to running cannot be stored", async () => {
      const scene = section("synthetic-failed-transition", "Synthetic failed clip must stay counted if its retry cannot start.");
      const baseline = await readSpeechPrewarmStatus(db), providerCalls = calls.length;
      const inserted = await db.collection("content").insertOne({ id: scene.id, skill: "listening", sections: [scene] });
      const clipId = `clip:${speechSectionFingerprint(scene)}`;
      const bank = db.collection<{ _id: string; state?: string; attempts?: number; retryable?: boolean; nextAttemptAt?: Date; updatedAt?: Date }>("speech_bank_prewarm");
      await bank.insertOne({ _id: clipId, state: "failed", attempts: 0, retryable: true, nextAttemptAt: new Date(0), updatedAt: new Date() });
      const originalCollection = db.collection.bind(db), originalUpdate = bank.updateOne.bind(bank);
      let transitionFailures = 0;
      bank.updateOne = (async (filter, update, options) => {
        const changes = Array.isArray(update) ? undefined : update.$set;
        if (filter._id === clipId && changes?.state === "running" && !transitionFailures) {
          transitionFailures++;
          throw new MongoOperationTimeoutError(`Synthetic private transition response ${syntheticKey}`);
        }
        return originalUpdate(filter, update, options);
      }) as typeof bank.updateOne;
      db.collection = ((collectionName, options) => collectionName === "speech_bank_prewarm" ? bank : originalCollection(collectionName, options)) as typeof db.collection;
      try {
        const result = await runSpeechBankPrewarm(db, { expectedDatabase, maxClips: 1, maxRetries: 0 });
        assert.equal(transitionFailures, 1); assert.equal(calls.length, providerCalls);
        assert.equal(result.total, baseline.total + 1); assert.equal(result.ready, baseline.ready);
        assert.equal(result.failed, baseline.failed + 1); assert.equal(result.pending, baseline.pending);
        assert.equal(result.lastErrorCode, "storage"); assert.equal(result.lastErrorStage, "bank-metadata");
        const clip = await bank.findOne({ _id: clipId });
        assert.equal(clip?.state, "failed"); assert.equal(clip?.attempts, 0);
        const saved = await readSpeechPrewarmStatus(db);
        assert.equal(saved.failed, result.failed); assert.equal(saved.total, result.total);
      } finally {
        db.collection = originalCollection; bank.updateOne = originalUpdate;
        await db.collection("content").deleteOne({ _id: inserted.insertedId });
        await bank.deleteOne({ _id: clipId });
      }
    });

    await t.test("a bank owner replacement during publication reports the lost lease without retrying successful audio", async () => {
      const scene = section("synthetic-bank-owner-loss", "Synthetic ready audio survives losing its bank publication lease.");
      const baseline = await readSpeechPrewarmStatus(db), providerCalls = calls.length;
      await db.collection("content").insertOne({ id: scene.id, skill: "listening", sections: [scene] });
      const bank = db.collection<{ _id: string; state?: string; ready?: number; owner?: string; attempts?: number }>("speech_bank_prewarm");
      const originalCollection = db.collection.bind(db), originalUpdate = bank.updateOne.bind(bank);
      let replacements = 0;
      bank.updateOne = (async (filter, update, options) => {
        const changes = Array.isArray(update) ? undefined : update.$set;
        if (filter._id === "bank" && changes?.state === "running" && changes?.ready === baseline.ready + 1 && !replacements) {
          replacements++;
          await originalUpdate({ _id: "bank" }, { $set: { owner: "synthetic-bank-replacement" } });
        }
        return originalUpdate(filter, update, options);
      }) as typeof bank.updateOne;
      db.collection = ((collectionName, options) => collectionName === "speech_bank_prewarm" ? bank : originalCollection(collectionName, options)) as typeof db.collection;
      try {
        const result = await runSpeechBankPrewarm(db, { expectedDatabase, maxClips: 1, maxRetries: 1 });
        assert.equal(replacements, 1); assert.equal(result.state, "pending");
        assert.equal(result.lastErrorCode, "lease-lost"); assert.equal(result.lastErrorStage, "bank-publish");
        assert.equal(result.ready, baseline.ready + 1); assertCalls(calls.slice(providerCalls), [scene.text]);
        const clip = await bank.findOne({ _id: `clip:${speechSectionFingerprint(scene)}` });
        assert.equal(clip?.state, "ready"); assert.equal(clip?.attempts, 1);
        assert.equal((await bank.findOne({ _id: "bank" }))?.owner, "synthetic-bank-replacement");
      } finally {
        db.collection = originalCollection; bank.updateOne = originalUpdate;
        await bank.updateOne({ _id: "bank", owner: "synthetic-bank-replacement" }, { $unset: { owner: "", leaseExpiresAt: "" } });
      }
    });

    await t.test("a provider timeout defers its retry so the next authored clip can become ready", async () => {
      const stalled = section("synthetic-deferred-timeout", "Synthetic slow provider scene should be deferred after one timeout.");
      const next = section("synthetic-after-timeout", "Synthetic next scene can become ready without waiting for another timeout.");
      await db.collection("content").insertMany([stalled, next].map(scene => ({ id: scene.id, skill: "listening", sections: [scene] })));
      const pacingTimer = globalThis.setTimeout, providerCalls = calls.length;
      globalThis.setTimeout = ((callback: (...args: unknown[]) => void, milliseconds?: number, ...args: unknown[]) => milliseconds === 120_000
        ? previousTimer(callback, 20, ...args) : pacingTimer(callback, milliseconds, ...args)) as typeof setTimeout;
      respond = text => text === stalled.text
        ? new Response(new ReadableStream<Uint8Array>(), { headers: { "content-type": "audio/pcm" } }) : pcmResponse();
      try {
        await runSpeechBankPrewarm(db, { expectedDatabase, maxClips: 2, maxRetries: 3 });
        assertCalls(calls.slice(providerCalls), [stalled.text, next.text]);
        const stalledClip = await db.collection("speech_bank_prewarm").findOne({ _id: `clip:${speechSectionFingerprint(stalled)}` as any });
        assert.equal(stalledClip?.attempts, 1); assert.equal(stalledClip?.lastErrorCode, "provider-timeout");
        assert.equal(stalledClip?.retryable, true); assert.ok(stalledClip?.nextAttemptAt instanceof Date);
        const nextClip = await db.collection("speech_bank_prewarm").findOne({ _id: `clip:${speechSectionFingerprint(next)}` as any });
        assert.equal(nextClip?.state, "ready"); assert.equal(nextClip?.attempts, 1);
      } finally { globalThis.setTimeout = pacingTimer; respond = () => pcmResponse(); }
    });

    await t.test("generic metadata contains only progress and hashes; every original/private document is preserved", async () => {
      const metadata = JSON.stringify(await db.collection("speech_bank_prewarm").find().toArray());
      assert.doesNotMatch(metadata, /sk-synthetic|Private provider body|Secret quota detail|private-answer|library opens|Teacher|Student|Guide|Visitor/u);
      for (const collection of privateNames) assert.deepEqual(await db.collection(collection).find().toArray(), privateBefore.get(collection));
      assert.deepEqual(await db.collection("placementItems").find().toArray(), privateBefore.get("placementItems"));
      const originals = privateBefore.get("content") as { _id: unknown }[];
      for (const original of originals) assert.deepEqual(await db.collection("content").findOne({ _id: original._id as any }), original);
      const allowed = new Set([...privateNames, "content", "placementItems", "speech_bank_prewarm", "speech_audio_jobs", "speech_audio.files", "speech_audio.chunks", "speech_audio_parts.files", "speech_audio_parts.chunks"]);
      assert.ok((await db.listCollections().toArray()).every(collection => allowed.has(collection.name)));
    });
  } finally {
    globalThis.fetch = previousFetch; globalThis.setTimeout = previousTimer;
    old.forEach((value, key) => value === undefined ? delete process.env[key] : process.env[key] = value);
    assert.equal(client.db(name).databaseName, name); assert.match(name, ownedDatabasePattern);
    try { await client.db(name).dropDatabase(); } finally { await Promise.all([client.close(), secondClient.close()]); }
  }
});
