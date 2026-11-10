import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { MongoClient, type Document } from "mongodb";
import { duoGateSupplementMain, prepareDuoGateSupplement } from "../server/duo-gate-supplement-cli";
import { NEW_DUO_GATE_LISTENING_IDS, SUPPLEMENT_VERSION, newDuoGatePapers } from "../server/data/duo-gate-supplement";
import { speechSectionFingerprint } from "../server/speech-audio";

const environmentNames = ["IELTS_OPENAI_API_KEY", "OPENAI_API_KEY", "ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_BRITISH",
  "ELEVENLABS_VOICE_AMERICAN", "ELEVENLABS_VOICE_AUSTRALIAN", "ELEVENLABS_MODEL", "APP_ORIGIN", "MONGODB_URI"];
const pcmResponse = () => new Response(Buffer.from([100, 0, 200, 0, 150, 0, 90, 0, 80, 0, 70, 0]),
  { headers: { "content-type": "audio/pcm" } });
interface FixtureRow extends Document { _id: string }

test("targeted three-clip preparation preserves caches and enforces a durable lifetime allowance", { timeout: 45_000 }, async t => {
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
    for (const provider of ["openai", "elevenlabs"] as const) {
      await t.test(`${provider}: only the three new monologues are purchased once and replay is free`, async () => {
        configure(provider);
        await withDatabase(async (db, name) => {
          await db.collection<FixtureRow>("content").insertOne({ _id: "synthetic-public", untouched: true });
          await db.collection<FixtureRow>("speech_audio_jobs").insertOne({ _id: "synthetic-existing", state: "ready", marker: "preserve" });
          const result = await prepareDuoGateSupplement(db, { expectedDatabase: name });
          assert.deepEqual({ ok: result.ok, total: result.total, ready: result.ready, providerRequests: result.providerRequests,
            maxProviderRequests: result.maxProviderRequests, maxInputCharacters: result.maxInputCharacters },
          { ok: true, total: 3, ready: 3, providerRequests: 3, maxProviderRequests: 3, maxInputCharacters: 9000 });
          assert.ok(result.inputCharacters > 0 && result.inputCharacters <= 9000);
          assert.equal(calls.length, 3);
          for (const call of calls) {
            if (provider === "openai") { assert.equal(call.body.model, "gpt-4o-mini-tts"); assert.equal(typeof call.body.input, "string"); }
            else { assert.equal(call.body.model_id, "eleven_v3"); assert.equal((call.body.inputs as unknown[]).length, 1); }
          }
          assert.equal(await db.collection("duo_exam_content").countDocuments(), 9);
          assert.deepEqual((await db.collection("duo_exam_content").find({}, { projection: { id: 1 } }).toArray()).map(row => row.id).sort(),
            newDuoGatePapers().map(paper => paper.id).sort());
          assert.deepEqual(await db.collection<FixtureRow>("content").findOne({ _id: "synthetic-public" }), { _id: "synthetic-public", untouched: true });
          assert.equal((await db.collection<FixtureRow>("speech_audio_jobs").findOne({ _id: "synthetic-existing" }))?.marker, "preserve");
          const ledger = await db.collection<FixtureRow>("duo_gate_audio_supplements").findOne({ _id: SUPPLEMENT_VERSION });
          assert.equal(ledger?.requestsReserved, 3); assert.equal(ledger?.inputCharactersReserved, 9000);
          assert.deepEqual([...ledger!.attemptedIds].sort(), [...NEW_DUO_GATE_LISTENING_IDS].sort());
          const replay = await prepareDuoGateSupplement(db, { expectedDatabase: name });
          assert.equal(replay.ok, true); assert.equal(replay.providerRequests, 0); assert.equal(replay.inputCharacters, 0);
          assert.equal(calls.length, 3);
          assert.equal(JSON.stringify(result).includes("SYNTHETIC"), false);
        });
      });
    }
    await t.test("a failed provider attempt stays spent across repeat invocations", async () => {
      configure(); mode = "failure";
      await withDatabase(async (db, name) => {
        const first = await prepareDuoGateSupplement(db, { expectedDatabase: name });
        assert.equal(first.ok, false); assert.equal(first.providerRequests, 1); assert.equal(calls.length, 1);
        mode = "success";
        for (let retry = 0; retry < 3; retry++) {
          const repeated = await prepareDuoGateSupplement(db, { expectedDatabase: name });
          assert.equal(repeated.ok, false); assert.equal(repeated.providerRequests, 0);
        }
        assert.equal(calls.length, 1);
        assert.equal((await db.collection<FixtureRow>("duo_gate_audio_supplements").findOne({ _id: SUPPLEMENT_VERSION }))?.requestsReserved, 1);
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
        const recovered = await prepareDuoGateSupplement(db, { expectedDatabase: name });
        assert.equal(recovered.ok, true); assert.equal(recovered.providerRequests, 0); assert.equal(calls.length, 3);
      });
    });
    await t.test("concurrent invocations share the durable three-request cap", async () => {
      configure();
      await withDatabase(async (db, name) => {
        const results = await Promise.all([prepareDuoGateSupplement(db, { expectedDatabase: name }), prepareDuoGateSupplement(db, { expectedDatabase: name })]);
        assert.equal(results.every(result => result.ok), true);
        assert.equal(results.reduce((sum, result) => sum + result.providerRequests, 0), 3);
        assert.equal(calls.length, 3);
        assert.equal((await db.collection<FixtureRow>("duo_gate_audio_supplements").findOne({ _id: SUPPLEMENT_VERSION }))?.requestsReserved, 3);
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
      for (const args of [[], ["--watch"], ["--prepare", "--resume"], ["--once"], ["--prepare", "--max-provider-requests", "100"]])
        await assert.rejects(duoGateSupplementMain(args), /explicit bounded prepare/);
      assert.equal(calls.length, 0);
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await client.close();
  }
});
