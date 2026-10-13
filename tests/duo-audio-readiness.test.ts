import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import express from "express";
import type { Document } from "mongodb";
import { contentBank, vocabularyBank } from "../server/data/index";
import { createDuoService } from "../server/duo";
import type { DuoCredentialSettings } from "../server/duo-auth";
import { ApiError } from "../server/errors";
import { SpeechAudioCache, speechSectionFingerprint } from "../server/speech-audio";
import { connectDatabase, type Database, type UserRecord } from "../server/storage";
import type { DuoAssessmentView, DuoRole, DuoRoomView } from "../shared/duo";
import type { StoredContent } from "../shared/types";
// The standalone operator supplies the current server-owned curriculum without applying an assignment.
// @ts-expect-error The offline JavaScript operator does not have a generated declaration.
import { prepareAssignment } from "../deploy/set-duo-band-3.mjs";

const roles: DuoRole[] = ["husband", "wife"];
const ownedDatabase = /^ielts_duo_band_admin_test_[a-f0-9]{32}$/;
const environmentNames = ["IELTS_APP_ROOT", "IELTS_OPENAI_API_KEY", "OPENAI_API_KEY", "ELEVENLABS_API_KEY",
  "ELEVENLABS_VOICE_BRITISH", "ELEVENLABS_VOICE_AMERICAN", "ELEVENLABS_VOICE_AUSTRALIAN", "ELEVENLABS_MODEL"];

async function fixture(eligibility: "gate" | "promotion") {
  const savedEnvironment = new Map(environmentNames.map(name => [name, process.env[name]]));
  environmentNames.forEach(name => delete process.env[name]);
  process.env.IELTS_APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  process.env.IELTS_OPENAI_API_KEY = "sk-synthetic-duo-readiness-no-live-provider";
  const previousFetch = globalThis.fetch;
  let origin = "", generationAllowed = false, providerCalls = 0;
  // Only this fixture's loopback HTTP server may reach the real transport.
  globalThis.fetch = async (url, init) => {
    if (origin && new URL(String(url)).origin === origin) return previousFetch(url, init);
    providerCalls++;
    assert.ok(generationAllowed, "Learner actions must never synthesize audio");
    assert.equal(String(url), "https://api.openai.com/v1/audio/speech");
    const pcm = Buffer.alloc(6);
    [300, 600, 900].forEach((sample, index) => pcm.writeInt16LE(sample, index * 2));
    return new Response(pcm, { headers: { "content-type": "application/octet-stream" } });
  };
  const restore = () => {
    globalThis.fetch = previousFetch;
    savedEnvironment.forEach((value, name) => value === undefined ? delete process.env[name] : process.env[name] = value);
  };
  const name = `ielts_duo_band_admin_test_${randomUUID().replaceAll("-", "")}`;
  assert.match(name, ownedDatabase);
  let database: Database | undefined, server: Server | undefined;
  const close = async () => {
    try {
      if (server) {
        server.closeAllConnections();
        await new Promise<void>(done => server!.close(() => done()));
      }
      if (database) {
        assert.match(database.db.databaseName, ownedDatabase);
        try { await database.db.dropDatabase(); } finally { await database.client.close(); }
      }
    } finally { restore(); }
  };
  try {
    // Never inherit the application URI or select its database.
    const db = database = await connectDatabase("mongodb://127.0.0.1:27017", name);
    let clock = Date.parse("2026-10-13T08:00:00.000Z");
    const at = () => new Date(clock).toISOString();
    const duoId = `synthetic-audio-${randomUUID().replaceAll("-", "")}`;
    const passwordHash = `scrypt:${"1".repeat(32)}:${"2".repeat(128)}`;
    const settings: DuoCredentialSettings = { duoId, accounts: roles.map((role, index) => ({ role,
      name: `Synthetic audio ${role}`, phone: index ? "0300000002" : "0300000001", passwordHash })) };
    const users = Object.fromEntries(roles.map((role, index) => {
      const id = `${duoId}-${role}`;
      return [role, { _id: id, id, duoId, duoRole: role, name: settings.accounts[index].name,
        phone: settings.accounts[index].phone, email: `${role}@${duoId}.invalid`, passwordHash, demo: false,
        currentBand: 3, personalEstimatedBand: 3, targetBand: 8, testType: "academic", examDate: null,
        weeklyMinutes: 300, dailyMinutes: 45, cefr: "A2", createdAt: at() }];
    })) as Record<DuoRole, UserRecord>;
    await db.users.insertMany(Object.values(users));
    await db.content.insertMany(contentBank.map(content => ({ ...content, _id: content.id })));
    await db.vocabulary.insertMany(vocabularyBank.map(word => ({ ...word, _id: word.id })));
    const configuration = { sessionsPerBand: 10, gateInterval: 5 as const, countdownSeconds: 5, now: () => clock };
    const prepared = await prepareAssignment(db, settings, configuration);
    const path = prepared.expectedPath;
    const band = path.bands.b6;
    const gate = band.gates[0];
    assert.ok(gate);
    // Synthetic test evidence only: production assignment/backup/apply are never called.
    for (const lesson of band.lessons) {
      if (eligibility === "gate" && lesson.number > gate.afterLesson) continue;
      lesson.completion = Object.fromEntries(roles.map(role => [role, {
        at: at(), proofIds: [`synthetic-proof-${lesson.id}-${role}`], kind: "attempt",
      }]));
    }
    if (eligibility === "promotion") for (const entry of band.gates) {
      entry.results = Object.fromEntries(roles.map(role => [role, {
        status: "passed", assessmentId: `synthetic-passed-${entry.id}-${role}`, at: at(),
      }]));
    }
    const paths = db.db.collection<Document & { _id: string }>("duo_learning_paths");
    const rooms = db.db.collection<Document & { _id: string }>("duo_promotion_rooms");
    const assessments = db.db.collection<Document & { _id: string }>("duo_assessments");
    await paths.insertOne(path);
    const cache = new SpeechAudioCache(db);
    const guardedContentIds: string[][] = [];
    const service = createDuoService(db, { ...configuration, ensureAudioReady: async (contents: StoredContent[]) => {
      guardedContentIds.push(contents.map(content => content.id).sort());
      const sections = contents.filter(content => content.skill === "listening").flatMap(content => content.sections);
      if (!sections.length) return;
      const readiness = await cache.readiness(sections);
      if (!readiness.ready) throw new ApiError(409, readiness.notice);
    } });
    await service.initialize();
    const app = express();
    app.use(express.json());
    app.use((request, _response, next) => {
      (request as typeof request & { learner?: UserRecord }).learner = users[request.get("x-test-role") as DuoRole];
      next();
    });
    service.registerRoutes(app);
    app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
      response.status(error instanceof ApiError ? error.status : 500).json({ error: error instanceof Error ? error.message : String(error) });
    });
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address(); assert.ok(address && typeof address !== "string");
    origin = `http://127.0.0.1:${address.port}`;
    const request = async <T>(role: DuoRole, route: string, body?: unknown, expected = 200): Promise<T> => {
      const response = await fetch(`${origin}${route}`, { method: body === undefined ? "GET" : "POST",
        headers: { "x-test-role": role, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const result = await response.json();
      assert.equal(response.status, expected, `${route}: ${JSON.stringify(result)}`);
      return result as T;
    };
    return { database: db, path, band, gate, users, cache, paths, rooms, assessments, request, guardedContentIds,
      now: () => clock, advance: (ms: number) => { clock += ms; }, providerCalls: () => providerCalls, close,
      prepareAudio: async (contentIds: string[]) => {
        const contents = await db.content.find({ _id: { $in: contentIds }, skill: "listening" }).toArray();
        assert.ok(contents.length);
        generationAllowed = true;
        try { for (const content of contents) await cache.get(content.sections); }
        finally { generationAllowed = false; }
        const readiness = await cache.readiness(contents.flatMap(content => content.sections));
        assert.equal(readiness.ready, true);
      },
    };
  } catch (error) { await close(); throw error; }
}

test("Duo Gate rejects missing Listening audio before any assessment deadline or path receipt", { timeout: 30_000 }, async () => {
  const f = await fixture("gate");
  try {
    const listening = await f.database.content.findOne({ _id: { $in: f.gate.contentIds }, skill: "listening" });
    assert.ok(listening);
    const jobs = f.database.db.collection<Document & { _id: string }>("speech_audio_jobs");
    const heldJob = { _id: speechSectionFingerprint(listening.sections[0]), state: "generating",
      owner: "synthetic-worker", leaseExpiresAt: new Date(Date.now() + 60_000) };
    await jobs.insertOne(heldJob);
    const before = await f.paths.findOne({ _id: f.path._id });
    const started = performance.now();
    await f.request("husband", `/api/duo/gates/${f.gate.id}/start`, {}, 409);
    assert.ok(performance.now() - started < 2_000, "A missing cache must not wait for the worker's generation lease");
    assert.equal(await f.assessments.countDocuments(), 0);
    assert.equal(await f.database.attempts.countDocuments(), 0);
    assert.deepEqual(await f.paths.findOne({ _id: f.path._id }), before);
    assert.deepEqual(await jobs.findOne({ _id: heldJob._id }), heldJob);
    assert.deepEqual(f.guardedContentIds, [[...f.gate.contentIds].sort()]);
    assert.equal(f.providerCalls(), 0);
  } finally { await f.close(); }
});

test("promotion room creation rejects missing Listening audio without changing curriculum proofs", { timeout: 30_000 }, async () => {
  const f = await fixture("promotion");
  try {
    const before = await f.paths.findOne({ _id: f.path._id });
    await f.request("wife", "/api/duo/rooms", {}, 409);
    assert.equal(await f.rooms.countDocuments(), 0);
    assert.equal(await f.assessments.countDocuments(), 0);
    assert.deepEqual(await f.paths.findOne({ _id: f.path._id }), before);
    assert.deepEqual(f.guardedContentIds, [[...f.band.promotionContentIds].sort()]);
    assert.equal(await f.database.db.collection("speech_audio_jobs").countDocuments(), 0);
    assert.equal(f.providerCalls(), 0);
  } finally { await f.close(); }
});

test("an existing waiting room cannot Ready or start its clock until Listening is actually cached", { timeout: 30_000 }, async () => {
  const f = await fixture("promotion");
  try {
    const roomId = `synthetic-waiting-${randomUUID()}`;
    await f.rooms.insertOne({ _id: roomId, duoId: f.path.duoId, band: 3, status: "waiting", active: true,
      startsAt: null, deadlineAt: null, revision: 0, createdAt: new Date(f.now()).toISOString(),
      contentIds: f.band.promotionContentIds,
      members: Object.fromEntries(roles.map(role => [role, { userId: f.users[role].id,
        joinedAt: null, lastSeenAt: null, readyAt: null, companion: false, assessmentId: null }])) });
    for (const role of roles) await f.request(role, `/api/duo/rooms/${roomId}/join`, {});
    const before = await f.rooms.findOne({ _id: roomId });
    const pathBefore = await f.paths.findOne({ _id: f.path._id });
    for (const role of roles) await f.request(role, `/api/duo/rooms/${roomId}/ready`, { ready: true }, 409);
    assert.deepEqual(await f.rooms.findOne({ _id: roomId }), before);
    f.advance(6_000);
    const blocked = await f.request<{ room: DuoRoomView }>("husband", `/api/duo/rooms/${roomId}`);
    assert.equal(blocked.room.status, "waiting");
    assert.equal(blocked.room.startsAt, null); assert.equal(blocked.room.deadlineAt, null);
    assert.ok(roles.every(role => !blocked.room.members[role].ready));
    assert.equal(await f.assessments.countDocuments(), 0); assert.equal(f.providerCalls(), 0);

    // Worker preparation occurs while the room has no countdown or exam deadline.
    await f.prepareAudio(f.band.promotionContentIds);
    const generationCalls = f.providerCalls(); assert.ok(generationCalls > 0);
    const first = await f.request<{ room: DuoRoomView }>("husband", `/api/duo/rooms/${roomId}/ready`, { ready: true });
    assert.equal(first.room.status, "waiting"); assert.equal(first.room.startsAt, null);
    const second = await f.request<{ room: DuoRoomView }>("wife", `/api/duo/rooms/${roomId}/ready`, { ready: true });
    assert.equal(second.room.status, "countdown");
    assert.equal(second.room.startsAt, new Date(f.now() + 5_000).toISOString());
    const contents = await f.database.content.find({ _id: { $in: f.band.promotionContentIds } }).toArray();
    const duration = contents.reduce((sum, content) => sum + content.durationMinutes, 0);
    assert.equal(second.room.deadlineAt, new Date(f.now() + 5_000 + duration * 60_000).toISOString());
    f.advance(5_001);
    const running = await f.request<{ room: DuoRoomView }>("husband", `/api/duo/rooms/${roomId}`);
    assert.equal(running.room.status, "in-progress"); assert.equal(await f.assessments.countDocuments(), 2);
    for (const assessment of await f.assessments.find().toArray()) {
      assert.equal(assessment.deadlineAt, second.room.deadlineAt);
      assert.equal((assessment.parts as DuoAssessmentView["parts"])[0].startsAt, second.room.startsAt);
    }
    assert.equal(f.providerCalls(), generationCalls, "Countdown and timed assessments use only already-prepared audio");
    assert.deepEqual(await f.paths.findOne({ _id: f.path._id }), pathBefore);
  } finally { await f.close(); }
});
