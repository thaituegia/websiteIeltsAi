import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { MongoClient, type Document } from "mongodb";
import { duoGateSupplementMain, parseDuoGateSupplementArguments, prepareDuoGateSupplement } from "../server/duo-gate-supplement-cli";
import { NEW_DUO_GATE_LISTENING_IDS, SUPPLEMENT_VERSION, newDuoGatePapers } from "../server/data/duo-gate-supplement";
import { ADDITIONAL_DUO_GATE_LISTENING_IDS, ADDITIONAL_SUPPLEMENT_VERSION, newAdditionalDuoGatePapers } from "../server/data/duo-gate-supplement-2";
import { FIVE_DUO_GATE_LISTENING_IDS, FIVE_SUPPLEMENT_VERSION, newFiveDuoGatePapers } from "../server/data/duo-gate-supplement-3";
import { TEN_DUO_GATE_LISTENING_IDS, TEN_SUPPLEMENT_VERSION, newTenDuoGatePapers } from "../server/data/duo-gate-supplement-4";
import { SpeechAudioCache, speechSectionFingerprint } from "../server/speech-audio";

const environmentNames = ["IELTS_OPENAI_API_KEY", "OPENAI_API_KEY", "ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_BRITISH",
  "ELEVENLABS_VOICE_AMERICAN", "ELEVENLABS_VOICE_AUSTRALIAN", "ELEVENLABS_MODEL", "APP_ORIGIN", "MONGODB_URI"];
const pcmResponse = () => new Response(Buffer.from([100, 0, 200, 0, 150, 0, 90, 0, 80, 0, 70, 0]),
  { headers: { "content-type": "audio/pcm" } });
interface FixtureRow extends Document { _id: string }
const batches = [
  { batch: "initial", version: SUPPLEMENT_VERSION, ids: NEW_DUO_GATE_LISTENING_IDS, papers: newDuoGatePapers, count: 3, characters: 9000, deadline: 180_000 },
  { batch: "additional", version: ADDITIONAL_SUPPLEMENT_VERSION, ids: ADDITIONAL_DUO_GATE_LISTENING_IDS, papers: newAdditionalDuoGatePapers, count: 3, characters: 9000, deadline: 180_000 },
  { batch: "five", version: FIVE_SUPPLEMENT_VERSION, ids: FIVE_DUO_GATE_LISTENING_IDS, papers: newFiveDuoGatePapers, count: 5, characters: 15000, deadline: 300_000 },
  { batch: "ten", version: TEN_SUPPLEMENT_VERSION, ids: TEN_DUO_GATE_LISTENING_IDS, papers: newTenDuoGatePapers, count: 10, characters: 30000, deadline: 600_000 },
] as const;

test("targeted Gate batch preparation preserves caches and enforces a durable lifetime allowance", { timeout: 45_000 }, async t => {
  const client = new MongoClient("mongodb://127.0.0.1:27017", { serverSelectionTimeoutMS: 5000, maxPoolSize: 3 });
  const saved = new Map(environmentNames.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  let mode: "success" | "failure" = "success";
  const configure = (provider: "openai" | "elevenlabs" | "none" = "openai") => {
    for (const key of environmentNames) delete process.env[key];
    if (provider === "openai") process.env.IELTS_OPENAI_API_KEY = "sk-SYNTHETIC_SUPPLEMENT_NEVER_PRINT";
    if (provider === "elevenlabs") Object.assign(process.env, { ELEVENLABS_API_KEY: "SYNTHETIC_ELEVENLABS_NEVER_PRINT",
      ELEVENLABS_VOICE_BRITISH: "synthetic-british", ELEVENLABS_VOICE_AMERICAN: "synthetic-american", ELEVENLABS_VOICE_AUSTRALIAN: "synthetic-australian" });
    mode = "success"; calls.length = 0;
  };
  globalThis.fetch = async (url, init) => {
    const actual = String(url);
    assert.ok(["https://api.openai.com/v1/audio/speech", "https://api.elevenlabs.io/v1/text-to-dialogue?output_format=pcm_24000"].includes(actual));
    calls.push({ url: actual, body: JSON.parse(String(init?.body)) });
    return mode === "failure" ? Response.json({ error: { message: "SYNTHETIC_PROVIDER_SECRET" } }, { status: 503 }) : pcmResponse();
  };
  const withDatabase = async (work: (db: ReturnType<MongoClient["db"]>, name: string) => Promise<void>) => {
    const name = "ielts_gate_supplement_test_" + randomUUID().replaceAll("-", "");
    assert.match(name, /^ielts_gate_supplement_test_[a-f0-9]{32}$/);
    const db = client.db(name);
    try { await work(db, name); } finally { await db.dropDatabase(); }
  };
  try {
    await client.connect();
    for (const { batch, version, ids: listeningIds, papers: makePapers, count, characters } of batches) for (const provider of ["openai", "elevenlabs"] as const) {
      const authoredPapers = makePapers();
      await t.test(`${batch}/${provider}: only its ${count} new monologues are purchased once and replay is free`, async () => {
        configure(provider);
        await withDatabase(async (db, name) => {
          await db.collection<FixtureRow>("content").insertOne({ _id: "synthetic-public", untouched: true });
          await db.collection<FixtureRow>("speech_audio_jobs").insertOne({ _id: "synthetic-existing", state: "ready", marker: "preserve" });
          const options = { expectedDatabase: name, ...(batch !== "initial" ? { batch } : {}) };
          const result = await prepareDuoGateSupplement(db, options);
          assert.equal(result.version, version);
          assert.deepEqual({ ok: result.ok, total: result.total, ready: result.ready, providerRequests: result.providerRequests,
            maxProviderRequests: result.maxProviderRequests, maxInputCharacters: result.maxInputCharacters },
          { ok: true, total: count, ready: count, providerRequests: count, maxProviderRequests: count, maxInputCharacters: characters });
          assert.ok(result.inputCharacters > 0 && result.inputCharacters <= characters);
          assert.equal(calls.length, count);
          for (const call of calls) {
            if (provider === "openai") { assert.equal(call.body.model, "gpt-4o-mini-tts"); assert.equal(typeof call.body.input, "string"); }
            else { assert.equal(call.body.model_id, "eleven_v3"); assert.equal((call.body.inputs as unknown[]).length, 1); }
          }
          assert.equal(await db.collection("duo_exam_content").countDocuments(), authoredPapers.length);
          assert.deepEqual((await db.collection("duo_exam_content").find({}, { projection: { id: 1 } }).toArray()).map(row => row.id).sort(),
            authoredPapers.map(paper => paper.id).sort());
          assert.deepEqual(await db.collection<FixtureRow>("content").findOne({ _id: "synthetic-public" }), { _id: "synthetic-public", untouched: true });
          assert.equal((await db.collection<FixtureRow>("speech_audio_jobs").findOne({ _id: "synthetic-existing" }))?.marker, "preserve");
          const ledger = await db.collection<FixtureRow>("duo_gate_audio_supplements").findOne({ _id: version });
          assert.equal(ledger?.requestsReserved, count); assert.equal(ledger?.inputCharactersReserved, characters);
          assert.deepEqual([...ledger!.attemptedIds].sort(), [...listeningIds].sort());
          const replay = await prepareDuoGateSupplement(db, options);
          assert.equal(replay.ok, true); assert.equal(replay.providerRequests, 0); assert.equal(replay.inputCharacters, 0);
          assert.equal(calls.length, count);
          assert.equal(JSON.stringify(result).includes("SYNTHETIC"), false);
        });
      });
    }
    for (const { batch, version } of batches) await t.test(`${batch}: a failed provider attempt stays spent across repeat invocations`, async () => {
      configure(); mode = "failure";
      await withDatabase(async (db, name) => {
        const first = await prepareDuoGateSupplement(db, { expectedDatabase: name, batch });
        assert.equal(first.version, version);
        assert.equal(first.ok, false); assert.equal(first.providerRequests, 1); assert.equal(calls.length, 1);
        mode = "success";
        for (let retry = 0; retry < 3; retry++) {
          const repeated = await prepareDuoGateSupplement(db, { expectedDatabase: name, batch });
          assert.equal(repeated.ok, false); assert.equal(repeated.providerRequests, 0);
        }
        assert.equal(calls.length, 1);
        assert.equal((await db.collection<FixtureRow>("duo_gate_audio_supplements").findOne({ _id: version }))?.requestsReserved, 1);
      });
    });
    await t.test("a saved paid turn recovers publication with no new allowance", async () => {
      configure();
      await withDatabase(async (db, name) => {
        assert.equal((await prepareDuoGateSupplement(db, { expectedDatabase: name })).ok, true);
        const paper = newDuoGatePapers().find(paper => paper.id === NEW_DUO_GATE_LISTENING_IDS[0])!;
        const fingerprint = speechSectionFingerprint(paper.sections[0]!);
        await db.collection("speech_audio.files").deleteOne({ "metadata.fingerprint": fingerprint });
        await db.collection<FixtureRow>("speech_audio_jobs").updateOne({ _id: fingerprint }, { $set: { state: "failed" } });
        // Before preparing claims existed, completed ledgers had no such field.
        await db.collection<FixtureRow>("duo_gate_audio_supplements").updateOne({ _id: SUPPLEMENT_VERSION }, { $unset: { preparing: "" } });
        const recovered = await prepareDuoGateSupplement(db, { expectedDatabase: name });
        assert.equal(recovered.ok, true); assert.equal(recovered.providerRequests, 0); assert.equal(calls.length, 3);
      });
    });
    for (const { batch, version, count } of batches) await t.test(`${batch}: concurrent invocations share the durable ${count}-request cap`, async () => {
      configure();
      await withDatabase(async (db, name) => {
        const results = await Promise.all([prepareDuoGateSupplement(db, { expectedDatabase: name, batch }), prepareDuoGateSupplement(db, { expectedDatabase: name, batch })]);
        assert.equal(results.every(result => result.ok), true);
        assert.equal(results.reduce((sum, result) => sum + result.providerRequests, 0), count);
        assert.equal(calls.length, count);
        assert.equal((await db.collection<FixtureRow>("duo_gate_audio_supplements").findOne({ _id: version }))?.requestsReserved, count);
      });
    });
    for (const { batch, count, version, deadline } of batches) await t.test(`${batch}: a follower cannot steal the cache job during the funded owner's reservation gap`, async () => {
      configure();
      await withDatabase(async (db, name) => {
        let reserved!: () => void, release!: () => void, progress!: (value: string) => void;
        const ownerReserved = new Promise<void>(resolve => { reserved = resolve; });
        const ownerReleased = new Promise<void>(resolve => { release = resolve; });
        const followerProgress = new Promise<string>(resolve => { progress = resolve; });
        let paused = false, released = false, followerLostReservation = false;
        const wrappedDb = (role: "owner" | "follower") => new Proxy(db, {
          get(target, key) {
            if (key === "collection") return (name: string) => {
              const collection = target.collection<FixtureRow>(name);
              if (name !== "duo_gate_audio_supplements") return collection;
              return new Proxy(collection, {
                get(collection, method) {
                  if (method === "updateOne") return async (filter: Document, update: Document, options: Document) => {
                    const result = await collection.updateOne(filter, update, options);
                    if (update.$addToSet?.attemptedIds && role === "owner" && result.modifiedCount && !paused) {
                      paused = true; reserved(); await ownerReleased;
                    } else if (update.$addToSet?.attemptedIds && role === "follower" && !result.modifiedCount) followerLostReservation = true;
                    return result;
                  };
                  if (method === "findOne") return async (filter: Document, options: Document) => {
                    const result = await collection.findOne(filter, options);
                    if (role === "follower" && followerLostReservation) progress("waited");
                    return result;
                  };
                  const value = Reflect.get(collection, method, collection);
                  return typeof value === "function" ? value.bind(collection) : value;
                },
              });
            };
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        const originalGet = SpeechAudioCache.prototype.get;
        SpeechAudioCache.prototype.get = async function (this: SpeechAudioCache, ...args: Parameters<typeof originalGet>) {
          if (!released && args[2]?.snapshot().maxProviderRequests === 0) progress("claimed");
          return originalGet.apply(this, args);
        };
        let follower: ReturnType<typeof prepareDuoGateSupplement> | undefined;
        const started = Date.now(), owner = prepareDuoGateSupplement(wrappedDb("owner"), { expectedDatabase: name, batch });
        const timeout = setTimeout(() => progress("timed-out"), 5000);
        timeout.unref();
        try {
          await ownerReserved;
          const ledger = await db.collection<FixtureRow>("duo_gate_audio_supplements").findOne({ _id: version });
          const expiresAt = ledger!.preparing[0].expiresAt.getTime();
          assert.ok(expiresAt >= started + deadline && expiresAt <= Date.now() + deadline);
          follower = prepareDuoGateSupplement(wrappedDb("follower"), { expectedDatabase: name, batch });
          assert.equal(await followerProgress, "waited");
          assert.equal(calls.length, 0);
          assert.equal(await db.collection("speech_audio_jobs").countDocuments(), 0);
          released = true; release();
          const results = await Promise.all([owner, follower]);
          assert.equal(results.every(result => result.ok), true);
          assert.equal(results.reduce((sum, result) => sum + result.providerRequests, 0), count);
          assert.equal(calls.length, count);
        } finally {
          clearTimeout(timeout); released = true; release();
          await Promise.allSettled([owner, ...(follower ? [follower] : [])]);
          SpeechAudioCache.prototype.get = originalGet;
        }
      });
    });
    await t.test("an expired preparing owner permits saved-turn recovery without refunding its allowance", async () => {
      configure();
      await withDatabase(async (db, name) => {
        assert.equal((await prepareDuoGateSupplement(db, { expectedDatabase: name, batch: "additional" })).ok, true);
        const paper = newAdditionalDuoGatePapers().find(paper => paper.id === ADDITIONAL_DUO_GATE_LISTENING_IDS[0])!;
        const fingerprint = speechSectionFingerprint(paper.sections[0]!);
        await db.collection("speech_audio.files").deleteOne({ "metadata.fingerprint": fingerprint });
        await db.collection<FixtureRow>("speech_audio_jobs").updateOne({ _id: fingerprint }, { $set: { state: "failed" } });
        await db.collection<FixtureRow>("duo_gate_audio_supplements").updateOne({ _id: ADDITIONAL_SUPPLEMENT_VERSION },
          { $set: { preparing: [{ id: paper.id, owner: "synthetic-crashed-owner", expiresAt: new Date(Date.now() - 1) }] } });
        const recovered = await prepareDuoGateSupplement(db, { expectedDatabase: name, batch: "additional" });
        assert.equal(recovered.ok, true); assert.equal(recovered.providerRequests, 0); assert.equal(calls.length, 3);
        const ledger = await db.collection<FixtureRow>("duo_gate_audio_supplements").findOne({ _id: ADDITIONAL_SUPPLEMENT_VERSION });
        assert.equal(ledger?.requestsReserved, 3); assert.equal(ledger?.inputCharactersReserved, 9000);
      });
    });
    await t.test("a follower aborts promptly while a live preparing owner retains its spent allowance", async () => {
      configure();
      await withDatabase(async (db, name) => {
        assert.equal((await prepareDuoGateSupplement(db, { expectedDatabase: name, batch: "additional" })).ok, true);
        const paper = newAdditionalDuoGatePapers().find(paper => paper.id === ADDITIONAL_DUO_GATE_LISTENING_IDS[0])!;
        const fingerprint = speechSectionFingerprint(paper.sections[0]!);
        await db.collection("speech_audio.files").deleteOne({ "metadata.fingerprint": fingerprint });
        await db.collection<FixtureRow>("speech_audio_jobs").updateOne({ _id: fingerprint }, { $set: { state: "failed" } });
        await db.collection<FixtureRow>("duo_gate_audio_supplements").updateOne({ _id: ADDITIONAL_SUPPLEMENT_VERSION },
          { $set: { preparing: [{ id: paper.id, owner: "synthetic-live-owner", expiresAt: new Date(Date.now() + 60_000) }] } });
        const controller = new AbortController();
        const started = Date.now(), timer = setTimeout(() => controller.abort(), 50);
        let stopped;
        try { stopped = await prepareDuoGateSupplement(db, { expectedDatabase: name, batch: "additional", signal: controller.signal }); }
        finally { clearTimeout(timer); }
        assert.equal(stopped.ok, false); assert.equal(stopped.providerRequests, 0); assert.equal(calls.length, 3);
        assert.ok(Date.now() - started < 5000);
        const ledger = await db.collection<FixtureRow>("duo_gate_audio_supplements").findOne({ _id: ADDITIONAL_SUPPLEMENT_VERSION });
        assert.equal(ledger?.requestsReserved, 3); assert.equal(ledger?.preparing[0].owner, "synthetic-live-owner");
      });
    });
    await t.test("changed allowance fingerprints cannot purchase replacement audio", async () => {
      configure(); mode = "failure";
      await withDatabase(async (db, name) => {
        await prepareDuoGateSupplement(db, { expectedDatabase: name });
        await db.collection<FixtureRow>("duo_gate_audio_supplements").updateOne({ _id: SUPPLEMENT_VERSION }, { $set: { "targets.0.fingerprint": "0".repeat(64) } });
        mode = "success";
        assert.equal((await prepareDuoGateSupplement(db, { expectedDatabase: name })).ok, false);
        assert.equal(calls.length, 1);
      });
    });
    await t.test("additional preparation retains the first ledger and cache while ignoring an older missing clip", async () => {
      configure();
      await withDatabase(async (db, name) => {
        const initial = await prepareDuoGateSupplement(db, { expectedDatabase: name });
        assert.equal(initial.ok, true); assert.equal(calls.length, 3);
        const ledgerBefore = await db.collection<FixtureRow>("duo_gate_audio_supplements").findOne({ _id: SUPPLEMENT_VERSION });
        const initialPapers = newDuoGatePapers().filter(paper => paper.skill === "listening");
        const fingerprints = initialPapers.map(paper => speechSectionFingerprint(paper.sections[0]!));
        await db.collection("speech_audio.files").deleteOne({ "metadata.fingerprint": fingerprints[0] });
        await db.collection<FixtureRow>("speech_audio_jobs").updateOne({ _id: fingerprints[0] }, { $set: { state: "failed" } });
        const previousFiles = await db.collection("speech_audio.files").find({ "metadata.fingerprint": { $in: fingerprints } }).sort({ _id: 1 }).toArray();
        const additional = await prepareDuoGateSupplement(db, { expectedDatabase: name, batch: "additional" });
        assert.equal(additional.ok, true); assert.equal(additional.version, ADDITIONAL_SUPPLEMENT_VERSION);
        assert.equal(additional.providerRequests, 3); assert.equal(calls.length, 6);
        const additionalTexts = new Set(newAdditionalDuoGatePapers().filter(paper => paper.skill === "listening")
          .map(paper => paper.sections[0]!.dialogue![0]!.text));
        assert.equal(calls.slice(3).every(call => additionalTexts.has(call.body.input as string)), true);
        assert.deepEqual(await db.collection<FixtureRow>("duo_gate_audio_supplements").findOne({ _id: SUPPLEMENT_VERSION }), ledgerBefore);
        assert.equal(await db.collection("duo_gate_audio_supplements").countDocuments(), 2);
        const additionalLedger = await db.collection<FixtureRow>("duo_gate_audio_supplements").findOne({ _id: ADDITIONAL_SUPPLEMENT_VERSION });
        assert.deepEqual(additionalLedger!.targets.map((target: { id: string }) => target.id).sort(), [...ADDITIONAL_DUO_GATE_LISTENING_IDS].sort());
        assert.deepEqual(await db.collection("speech_audio.files").find({ "metadata.fingerprint": { $in: fingerprints } }).sort({ _id: 1 }).toArray(), previousFiles);
        assert.equal((await db.collection<FixtureRow>("speech_audio_jobs").findOne({ _id: fingerprints[0] }))?.state, "failed");
        assert.equal(await db.collection("duo_exam_content").countDocuments(), 18);
        const replay = await prepareDuoGateSupplement(db, { expectedDatabase: name, batch: "additional" });
        assert.equal(replay.ok, true); assert.equal(replay.providerRequests, 0); assert.equal(calls.length, 6);
        assert.deepEqual(await db.collection<FixtureRow>("duo_gate_audio_supplements").findOne({ _id: SUPPLEMENT_VERSION }), ledgerBefore);
      });
    });
    for (const index of [2, 3]) {
      const selected = batches[index]!, previous = batches.slice(0, index);
      const previousCount = previous.reduce((sum, batch) => sum + batch.count, 0);
      await t.test(`the ${selected.batch} batch leaves its ${previous.length} older ledgers and caches untouched, including their missing clips`, async () => {
        configure();
        await withDatabase(async (db, name) => {
          for (const { batch } of previous)
            assert.equal((await prepareDuoGateSupplement(db, { expectedDatabase: name, batch })).ok, true);
          assert.equal(calls.length, previousCount);
          const oldVersions = previous.map(batch => batch.version);
          const oldLedgers = await db.collection<FixtureRow>("duo_gate_audio_supplements").find({ _id: { $in: oldVersions } }).sort({ _id: 1 }).toArray();
          for (const { papers: makePapers } of previous) {
            const paper = makePapers().find(paper => paper.skill === "listening")!;
            const fingerprint = speechSectionFingerprint(paper.sections[0]!);
            await db.collection("speech_audio.files").deleteOne({ "metadata.fingerprint": fingerprint });
            await db.collection<FixtureRow>("speech_audio_jobs").updateOne({ _id: fingerprint }, { $set: { state: "failed" } });
          }
          const oldFiles = await db.collection("speech_audio.files").find().sort({ _id: 1 }).toArray();
          const oldJobs = await db.collection<FixtureRow>("speech_audio_jobs").find().sort({ _id: 1 }).toArray();
          const result = await prepareDuoGateSupplement(db, { expectedDatabase: name, batch: selected.batch });
          assert.equal(result.version, selected.version); assert.equal(result.ok, true);
          assert.equal(result.total, selected.count); assert.equal(result.ready, selected.count); assert.equal(result.providerRequests, selected.count);
          assert.equal(result.maxProviderRequests, selected.count); assert.equal(result.maxInputCharacters, selected.characters);
          assert.equal(calls.length, previousCount + selected.count);
          const selectedTexts = new Set(selected.papers().filter(paper => paper.skill === "listening")
            .map(paper => paper.sections[0]!.dialogue![0]!.text));
          assert.equal(calls.slice(previousCount).every(call => selectedTexts.has(call.body.input as string)), true);
          assert.deepEqual(await db.collection<FixtureRow>("duo_gate_audio_supplements").find({ _id: { $in: oldVersions } }).sort({ _id: 1 }).toArray(), oldLedgers);
          assert.deepEqual(await db.collection("speech_audio.files").find({ _id: { $in: oldFiles.map(file => file._id) } }).sort({ _id: 1 }).toArray(), oldFiles);
          assert.deepEqual(await db.collection<FixtureRow>("speech_audio_jobs").find({ _id: { $in: oldJobs.map(job => job._id) } }).sort({ _id: 1 }).toArray(), oldJobs);
          assert.equal(await db.collection("duo_exam_content").countDocuments(), (previousCount + selected.count) * 3);
          const ledger = await db.collection<FixtureRow>("duo_gate_audio_supplements").findOne({ _id: selected.version });
          assert.equal(ledger?.requestsReserved, selected.count); assert.equal(ledger?.inputCharactersReserved, selected.characters);
          assert.deepEqual(ledger!.targets.map((target: { id: string }) => target.id).sort(), [...selected.ids].sort());
          assert.equal(await db.collection("duo_gate_audio_supplements").countDocuments(), previous.length + 1);
          const replay = await prepareDuoGateSupplement(db, { expectedDatabase: name, batch: selected.batch });
          assert.equal(replay.ok, true); assert.equal(replay.providerRequests, 0); assert.equal(replay.inputCharacters, 0);
          assert.equal(calls.length, previousCount + selected.count);
          assert.deepEqual(await db.collection<FixtureRow>("duo_gate_audio_supplements").find({ _id: { $in: oldVersions } }).sort({ _id: 1 }).toArray(), oldLedgers);
        });
      });
    }
    await t.test("unconfigured or already aborted preparation makes no writes or provider calls", async () => {
      configure("none");
      await withDatabase(async (db, name) => {
        await assert.rejects(prepareDuoGateSupplement(db, { expectedDatabase: name }), /configuration/);
        configure();
        const controller = new AbortController(); controller.abort();
        assert.equal((await prepareDuoGateSupplement(db, { expectedDatabase: name, signal: controller.signal })).ok, false);
        assert.equal((await db.listCollections().toArray()).length, 0); assert.equal(calls.length, 0);
      });
    });
    await t.test("CLI rejects implicit, bulk or unbounded modes before connecting", async () => {
      configure(); process.env.APP_ORIGIN = "https://sutonghanyu.vn"; process.env.MONGODB_URI = "mongodb://mongo:27017/ielts_ai";
      assert.equal(parseDuoGateSupplementArguments(["--prepare"]), "initial");
      assert.equal(parseDuoGateSupplementArguments(["--prepare-additional"]), "additional");
      assert.equal(parseDuoGateSupplementArguments(["--prepare-five"]), "five");
      assert.equal(parseDuoGateSupplementArguments(["--prepare-ten"]), "ten");
      for (const args of [[], ["--watch"], ["--prepare", "--resume"], ["--once"], ["--prepare", "--max-provider-requests", "100"],
        ["--prepare", "--prepare-additional"], ["--prepare-additional", "--resume"], ["--prepare-additional", "--max-provider-requests", "100"],
        ["--prepare-five", "--prepare"], ["--prepare-five", "--prepare-additional"], ["--prepare-five", "--resume"], ["--prepare-five", "--max-provider-requests", "100"],
        ["--prepare-ten", "--prepare"], ["--prepare-ten", "--prepare-additional"], ["--prepare-ten", "--prepare-five"], ["--prepare-ten", "--resume"], ["--prepare-ten", "--max-provider-requests", "100"]])
        await assert.rejects(duoGateSupplementMain(args), /explicit bounded prepare/);
      assert.equal(calls.length, 0);
    });
    await t.test("CLI installation failures report the selected version before provider or Mongo access", () => {
      const script = fileURLToPath(new URL("../server/duo-gate-supplement-cli.ts", import.meta.url));
      for (const [argument, version] of [["--prepare", SUPPLEMENT_VERSION], ["--prepare-additional", ADDITIONAL_SUPPLEMENT_VERSION], ["--prepare-five", FIVE_SUPPLEMENT_VERSION], ["--prepare-ten", TEN_SUPPLEMENT_VERSION]]) {
        const result = spawnSync(process.execPath, ["--import", "tsx", script, argument!], {
          env: { ...process.env, APP_ORIGIN: "https://wrong-installation.invalid" }, encoding: "utf8", timeout: 10_000,
        });
        assert.equal(result.status, 1, result.stdout + result.stderr);
        assert.deepEqual(JSON.parse(result.stdout), { ok: false, version, code: "preparation-unavailable" });
        assert.equal(result.stdout.includes("SYNTHETIC"), false);
      }
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await client.close();
  }
});
