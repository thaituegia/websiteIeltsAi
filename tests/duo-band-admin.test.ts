import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Server } from "node:http";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { BSON, GridFSBucket, MongoClient } from "mongodb";
import { createApp } from "../server/app";
import { duoCredentialVersion, type DuoCredentialSettings } from "../server/duo-auth";
import { createDuoService } from "../server/duo";
import type { Database, PlacementRecord, UserRecord } from "../server/storage";
// Standalone operator deliberately stays JavaScript for the already-deployed image.
// @ts-expect-error No generated declaration is needed by the offline operator.
import { prepareAssignment, backupAssignment, applyAssignment, verifyAssignment } from "../deploy/set-duo-band-3.mjs";

process.env.IELTS_APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const roles = ["husband", "wife"] as const;
const at = "2026-10-13T08:00:00.000Z";
const passwordHash = `scrypt:${"1".repeat(32)}:${"2".repeat(128)}`;
const clone = <T>(value: T): T => BSON.EJSON.parse(BSON.EJSON.stringify(value, { relaxed: false })) as T;

async function fixture() {
  const suffix = randomUUID().replaceAll("-", "");
  const name = `ielts_duo_band_admin_test_${suffix}`;
  assert.match(name, /^ielts_duo_band_admin_test_[a-f0-9]{32}$/);
  const client = new MongoClient(process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017");
  await client.connect();
  const db = client.db(name);
  const database: Database = { client, db, recordings: new GridFSBucket(db, { bucketName: "recordings" }),
    users: db.collection("users"), sessions: db.collection("sessions"), attempts: db.collection("attempts"),
    cards: db.collection("cards"), placements: db.collection("placements"), plans: db.collection("plans"),
    audio: db.collection("audio"), content: db.collection("content"), vocabulary: db.collection("vocabulary"),
    placementItems: db.collection("placementItems") };
  const duoId = `synthetic-band-${suffix}`;
  const settings: DuoCredentialSettings = { duoId, accounts: roles.map((role, index) => ({ role,
    name: `Synthetic rank ${role}`, phone: index ? "0300000002" : "0300000001", passwordHash })) };
  const users = Object.fromEntries(roles.map((role, index) => {
    const id = `preserved-identity-${suffix}-${role}`;
    return [role, { _id: id, id, name: settings.accounts[index].name, phone: settings.accounts[index].phone,
      passwordHash, email: `${role}@${duoId}.invalid`, duoRole: role, duoId, demo: false,
      currentBand: role === "husband" ? 5 : null, personalEstimatedBand: role === "husband" ? 5 : null,
      targetBand: 8, testType: "academic", examDate: null, weeklyMinutes: 280, dailyMinutes: 40,
      cefr: role === "husband" ? "B1" : null, createdAt: at, selfAssessment: { reading: 4.5 } }];
  })) as Record<(typeof roles)[number], UserRecord>;
  await database.users.insertMany(Object.values(users));
  const kinds = ["reading", "listening", "writing", "speaking", "grammar"] as const;
  const bank = kinds.flatMap(skill => Array.from({ length: 4 }, (_, index) => ({
    _id: `synthetic-${suffix}-${skill}-lesson-${index}`, id: `synthetic-${suffix}-${skill}-lesson-${index}`,
    skill, format: "lesson", title: `Synthetic ${skill} ${index}`, topic: "education", description: "Controlled operator fixture",
    band: 3, cefr: "A2", testType: "academic", durationMinutes: 15, createdAt: at,
    source: "authored", quality: "authored-unreviewed", tags: [], vocabularyIds: [],
    sections: [{ id: `synthetic-${skill}-${index}-section`, title: "Synthetic", text: "A controlled family studies in a local library." }], questions: [],
  }))).concat(kinds.filter(kind => kind !== "grammar").map(skill => ({
    _id: `synthetic-${suffix}-${skill}-full-mock`, id: `synthetic-${suffix}-${skill}-full-mock`,
    skill, format: "full-mock", title: `Synthetic full ${skill}`, topic: "education", description: "Controlled operator fixture",
    band: 3, cefr: "A2", testType: "academic", durationMinutes: 30, createdAt: at,
    source: "authored", quality: "authored-unreviewed", tags: [], vocabularyIds: [],
    sections: [{ id: `synthetic-${skill}-mock-section`, title: "Synthetic", text: "A controlled family studies in a local library." }], questions: [],
  })) as any);
  await database.content.insertMany(bank as any);
  await database.vocabulary.insertOne({ _id: `synthetic-vocab-${suffix}`, id: `synthetic-vocab-${suffix}`, word: "library", meaning: "Synthetic fixture" } as any);
  await database.attempts.insertOne({ _id: `history-${suffix}`, id: `history-${suffix}`, userId: users.husband.id,
    status: "submitted", mode: "practice", responses: { retained: "old response" }, essays: { old: "retained draft" },
    transcript: "retained transcript", feedback: { summary: "retained feedback" } } as any);
  const historicPlacement: PlacementRecord = { _id: `historic-placement-${suffix}`, userId: users.husband.id,
    mode: "quick", total: 1, theta: 0.5, standardError: 1, estimatedBand: 5, currentQuestionId: null,
    answers: [{ questionId: "historical-item", answer: "historical response", correct: true }], result: {
      id: `historic-feedback-${suffix}`, skill: "placement", estimatedBand: 5, summary: "Synthetic historical result",
      rawScore: 1, total: 1, criteria: [], corrections: [], paragraphs: [], answers: [], source: "rule-based", createdAt: at },
    startedAt: at, completedAt: at, completionReason: "answered" };
  await database.placements.insertOne(historicPlacement);
  await db.collection("duo_placement_results").insertOne({ _id: historicPlacement._id as any, duoId,
    userId: users.husband.id, role: "husband", placementAttemptId: historicPlacement._id,
    estimatedBand: 5, assessedAt: at, startedAt: at });
  const service = createDuoService(database, { sessionsPerBand: 10 });
  await service.initialize();
  await db.collection("exam_integrity_sessions").createIndex({ userId: 1 }, { unique: true, partialFilterExpression: { status: "active" } });
  await db.collection("exam_integrity_sessions").createIndex({ userId: 1, kind: 1, resourceId: 1 });
  const directory = await mkdtemp(join(tmpdir(), "ielts-band-admin-test-"));
  let server: Server | undefined;
  const snapshot = async () => {
    const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map(info => info.name).sort();
    return BSON.EJSON.stringify(await Promise.all(names.map(async name => ({ name,
      indexes: await db.collection(name).listIndexes().toArray(),
      rows: await db.collection(name).find({}, { promoteValues: false }).sort({ _id: 1 }).toArray(),
    }))), { relaxed: false });
  };
  const plan = () => prepareAssignment(database, settings, { sessionsPerBand: 10,
    sessionsByBand: { "3": 10, "8": 20 }, now: () => Date.parse(at) });
  const apply = async (prepared: any, name = "backup") => {
    await backupAssignment(database, prepared, join(directory, name));
    return applyAssignment(database, prepared);
  };
  const http = async () => {
    const token = `synthetic-rank-cookie-${suffix}`;
    await database.sessions.insertOne({ _id: createHash("sha256").update(token).digest("hex"), userId: users.wife.id,
      createdAt: new Date(), expiresAt: new Date(Date.now() + 3_600_000),
      duoCredentialVersion: duoCredentialVersion(settings, settings.accounts[1]) });
    server = createApp(database, { production: false, serveClient: false, duoEnabled: true, duoCredentials: settings,
      examIntegrityEnabled: true, duo: { sessionsPerBand: 10 } }).listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address(); assert.ok(address && typeof address !== "string");
    return async (path: string, body?: unknown) => {
      const response = await fetch(`http://127.0.0.1:${address.port}/api${path}`, { method: body === undefined ? "GET" : "POST",
        headers: { Cookie: `ielts_session=${token}`, "X-Exam-Tab": "synthetic-wife-placement-tab",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() };
    };
  };
  return { database, db, settings, users, service, plan, apply, snapshot, directory, suffix, historicPlacement, http,
    close: async () => {
      if (server) { server.closeAllConnections(); await new Promise<void>(done => server!.close(() => done())); }
      assert.match(db.databaseName, /^ielts_duo_band_admin_test_[a-f0-9]{32}$/);
      await db.dropDatabase(); await client.close(); await rm(directory, { recursive: true, force: true });
    } };
}

test("owner rank assignment creates the shared band-3 curriculum without inventing the wife's placement", { timeout: 30_000 }, async () => {
  const f = await fixture();
  try {
    const before = await f.snapshot(); const plan = await f.plan();
    assert.equal(await f.snapshot(), before, "Preparation is completely read-only");
    assert.equal(plan.skippedPlacements, 0); assert.equal(plan.alreadyAssigned, false);
    const result = await f.apply(plan);
    assert.equal(result.verified, true); assert.equal(result.databasePreserved, true);
    assert.equal((await stat(join(f.directory, "backup"))).mode & 0o077, 0);
    assert.equal((await stat(join(f.directory, "backup", "plan.ejson"))).mode & 0o077, 0);
    assert.ok(JSON.parse(await readFile(join(f.directory, "backup", "mutation-started.json"), "utf8")));
    const state = await f.service.snapshot(f.users.wife);
    assert.equal(state.path!.currentBand, 3); assert.equal(state.path!.startingBand, 3); assert.equal(state.path!.targetBand, 8);
    assert.equal(state.bands.length, 11); assert.equal(state.bands[0].lessons.length, 10);
    assert.equal(state.bands[10].lessons.length, 20); assert.equal(state.bands[0].unlocked, true);
    assert.equal(state.members.find(member => member.role === "wife")!.placementBand, null);
    assert.deepEqual(state.members.map(member => member.personalEstimatedBand), [3, 3]);
    assert.equal(await f.database.placements.countDocuments({ userId: f.users.wife.id }), 0);
    assert.deepEqual(await f.database.placements.findOne({ _id: f.historicPlacement._id }), f.historicPlacement);
    await verifyAssignment(f.database, plan);
  } finally { await f.close(); }
});

test("skipping the active wife placement preserves partial evidence and completed guard fences stale HTTP writes", { timeout: 30_000 }, async () => {
  const f = await fixture();
  try {
    const id = `unfinished-${f.suffix}`, guardId = `guard-${f.suffix}`;
    const before: PlacementRecord = { _id: id, userId: f.users.wife.id, mode: "quick", total: 15,
      theta: -0.2, standardError: 0.8, estimatedBand: 4, currentQuestionId: "synthetic-current-item",
      answers: [{ questionId: "old-item", answer: "retained answer", correct: true }],
      draftAnswer: { questionId: "synthetic-current-item", answer: "draft" }, result: null, startedAt: at,
      deadlineAt: new Date(Date.now() + 3_600_000).toISOString() };
    await f.database.placements.insertOne(before);
    await f.db.collection("exam_integrity_sessions").insertOne({ _id: guardId as any, userId: f.users.wife.id,
      kind: "placement", resourceId: id, status: "active", phase: "answering", tabId: "synthetic-wife-placement-tab",
      leaseUntil: Date.now() + 60_000, resetPending: false, createdAt: at, updatedAt: at });
    const request = await f.http(); const plan = await f.plan();
    assert.equal(plan.skippedPlacements, 1); await f.apply(plan);
    const after = await f.database.placements.findOne({ _id: id }); assert.ok(after);
    assert.deepEqual(after.answers, before.answers); assert.equal(after.theta, before.theta); assert.equal(after.estimatedBand, before.estimatedBand);
    assert.equal(after.currentQuestionId, null); assert.equal(after.result, null); assert.equal(after.draftAnswer, null);
    assert.equal(after.completionReason, undefined); assert.equal((after as any).administrativelySkippedAt, at);
    assert.equal((await f.db.collection("exam_integrity_sessions").findOne({ _id: guardId as any }))!.status, "completed");
    const active = await request("/placement/active"); assert.equal(active.status, 200); assert.equal(active.body.placement, null);
    const answer = await request(`/placement/${id}/answer`, { questionId: "synthetic-current-item", answer: "draft" });
    assert.equal(answer.status, 409);
    const draft = await request(`/placement/${id}/draft`, { questionId: "synthetic-current-item", answer: "changed draft" });
    assert.equal(draft.status, 409);
    const audio = await request(`/placement/${id}/audio`, { questionId: "synthetic-current-item" }); assert.equal(audio.status, 409);
    const violation = await request(`/exam-integrity/${guardId}/violation`, { tabId: "synthetic-wife-placement-tab", reason: "hidden" });
    assert.equal(violation.status, 200); assert.equal(violation.body.session.status, "completed");
    assert.deepEqual(await f.database.placements.findOne({ _id: id }), after);
    await verifyAssignment(f.database, plan);
  } finally { await f.close(); }
});

test("lowering an advanced path keeps lessons, gates, other bands and historical active-flag receipts", { timeout: 30_000 }, async () => {
  const f = await fixture();
  try {
    const generated = await f.plan(); const path = clone(generated.expectedPath);
    delete path.administrativeBandAssignment;
    path.startingBand = 5; path.currentBand = 6.5; path.revision = 4;
    path.bands.b6.unlockedAt = "2026-10-01T08:00:00.000Z"; path.bands.b6.completedAt = "2026-10-02T08:00:00.000Z";
    for (const lesson of path.bands.b6.lessons) lesson.completion = { husband: { at, proofIds: ["retained-husband-proof"], kind: "attempt" },
      wife: { at, proofIds: ["retained-wife-proof"], kind: "attempt" } };
    for (const gate of path.bands.b6.gates) gate.results = { husband: { status: "passed", assessmentId: "retained-gate-husband", at },
      wife: { status: "passed", assessmentId: "retained-gate-wife", at } };
    path.bands.b6.promotionResults = { husband: { status: "passed", assessmentId: "old-promotion-husband", at },
      wife: { status: "passed", assessmentId: "old-promotion-wife", at } };
    path.bands.b6.lastPromotionRoomId = "old-completed-room";
    path.bands.b13.unlockedAt = at;
    await f.db.collection("duo_learning_paths").insertOne(path);
    const oldReceipt = { _id: "retained-gate-husband" as any, duoId: f.settings.duoId, userId: f.users.husband.id, role: "husband",
      kind: "gate", band: 3, gateId: path.bands.b6.gates[0].id, roomId: null, status: "passed", active: true,
      parts: [], requiredBand: 3.5, passPercent: 70, createdAt: at, completedAt: at, deadlineAt: at, revision: 0 };
    await f.db.collection("duo_assessments").insertOne(oldReceipt);
    await f.db.collection("duo_assessments").insertOne({ ...oldReceipt, _id: "retained-failed-wife" as any,
      userId: f.users.wife.id, role: "wife", status: "failed" });
    await f.db.collection("duo_assessments").insertOne({ ...oldReceipt, _id: "old-promotion-husband" as any,
      kind: "promotion", gateId: null, roomId: "old-completed-room", active: false });
    const oldRoom = { _id: "old-completed-room" as any, duoId: f.settings.duoId, band: 3, status: "completed", active: true,
      createdAt: at, revision: 0, startsAt: at, deadlineAt: at,
      members: Object.fromEntries(roles.map(role => [role, { userId: f.users[role].id, joinedAt: at, lastSeenAt: at, readyAt: at,
        companion: false, assessmentId: `old-promotion-${role}` }])) };
    await f.db.collection("duo_promotion_rooms").insertOne(oldRoom);
    const plan = await f.plan(); await f.apply(plan);
    const after = await f.db.collection("duo_learning_paths").findOne({ _id: f.settings.duoId as any }); assert.ok(after);
    assert.equal(after.currentBand, 3); assert.equal(after.startingBand, 3); assert.equal(after.revision, 5);
    assert.deepEqual(after.bands.b6.lessons, path.bands.b6.lessons); assert.deepEqual(after.bands.b6.gates, path.bands.b6.gates);
    assert.deepEqual(after.bands.b13, path.bands.b13); assert.equal(after.bands.b6.unlockedAt, path.bands.b6.unlockedAt);
    assert.equal(after.bands.b6.completedAt, null); assert.deepEqual(after.bands.b6.promotionResults, { husband: null, wife: null });
    assert.equal(after.bands.b6.lastPromotionRoomId, null);
    assert.deepEqual(await f.db.collection("duo_assessments").findOne({ _id: oldReceipt._id }), oldReceipt);
    assert.deepEqual(await f.db.collection("duo_promotion_rooms").findOne({ _id: oldRoom._id }), oldRoom);
    assert.equal((await f.service.snapshot(f.users.husband)).path!.currentBand, 3, "Old promotion cannot raise the assigned rank again");
    await verifyAssignment(f.database, plan);
  } finally { await f.close(); }
});

test("identity conflicts and active or pending-AI Duo work abort read-only", { timeout: 30_000 }, async () => {
  const f = await fixture();
  try {
    await f.database.users.updateOne({ _id: f.users.wife.id }, { $set: { phone: "0300000009" } });
    const identityBefore = await f.snapshot(); await assert.rejects(f.plan(), /PRIVATE_ACCOUNT_IDENTITY_MISMATCH/);
    assert.equal(await f.snapshot(), identityBefore);
    await f.database.users.updateOne({ _id: f.users.wife.id }, { $set: { phone: f.settings.accounts[1].phone } });
    await f.db.collection("duo_assessments").insertOne({ _id: "active-fixture" as any, duoId: f.settings.duoId,
      userId: f.users.husband.id, kind: "gate", band: 3, gateId: "synthetic-gate", status: "pending-ai", active: false });
    const pendingBefore = await f.snapshot(); await assert.rejects(f.plan(), /ACTIVE_DUO_ASSESSMENT_OR_PENDING_AI/);
    assert.equal(await f.snapshot(), pendingBefore);
    await f.db.collection("duo_assessments").deleteOne({ _id: "active-fixture" as any });
    await f.db.collection("duo_promotion_rooms").insertOne({ _id: "active-room" as any, duoId: f.settings.duoId, band: 3,
      status: "countdown", active: true });
    const roomBefore = await f.snapshot(); await assert.rejects(f.plan(), /ACTIVE_DUO_ROOM/); assert.equal(await f.snapshot(), roomBefore);
  } finally { await f.close(); }
});

test("verified private backup and offline production boundary precede every mutation", { timeout: 30_000 }, async () => {
  const f = await fixture();
  try {
    const plan = await f.plan(); const before = await f.snapshot();
    await assert.rejects(applyAssignment(f.database, plan), /VERIFIED_PRIVATE_BACKUP_REQUIRED/);
    assert.equal(await f.snapshot(), before);
    const oldOffline = process.env.IELTS_APP_OFFLINE; delete process.env.IELTS_APP_OFFLINE;
    try {
      const fakeProduction = { ...f.database, db: { databaseName: "ielts_ai" } };
      await assert.rejects(applyAssignment(fakeProduction, { ...plan, databaseName: "ielts_ai" }), /APP_MUST_BE_OFFLINE/);
      await assert.rejects(backupAssignment(fakeProduction, { ...plan, databaseName: "ielts_ai" }, join(f.directory, "must-not-create")), /APP_MUST_BE_OFFLINE/);
    } finally { if (oldOffline === undefined) delete process.env.IELTS_APP_OFFLINE; else process.env.IELTS_APP_OFFLINE = oldOffline; }
    assert.equal(await f.snapshot(), before);
  } finally { await f.close(); }
});

test("CAS preflight refuses changed identities before the mutation marker exists", { timeout: 30_000 }, async () => {
  const f = await fixture();
  try {
    const plan = await f.plan(); await backupAssignment(f.database, plan, join(f.directory, "stale-backup"));
    await f.database.users.updateOne({ _id: f.users.husband.id }, { $set: { dailyMinutes: 55 } });
    const changedBefore = await f.snapshot(); await assert.rejects(applyAssignment(f.database, plan), /STALE_ASSIGNMENT_PLAN/);
    assert.equal(await f.snapshot(), changedBefore);
    await assert.rejects(stat(join(f.directory, "stale-backup", "mutation-started.json")), { code: "ENOENT" });
  } finally { await f.close(); }
});

test("repeat assignment is idempotent and retains the original audit timestamps", { timeout: 30_000 }, async () => {
  const f = await fixture();
  try {
    const original = await f.plan(); await f.apply(original);
    const before = await f.snapshot(); const repeated = await f.plan();
    assert.equal(repeated.alreadyAssigned, true); assert.equal(repeated.changes.length, 0);
    assert.equal((await applyAssignment(f.database, repeated)).verified, true);
    assert.equal(await f.snapshot(), before);
    assert.equal((await applyAssignment(f.database, original)).verified, true);
    assert.equal(await f.snapshot(), before);
  } finally { await f.close(); }
});

test("full-database verification detects unrelated document and index changes", { timeout: 30_000 }, async () => {
  const f = await fixture();
  try {
    const plan = await f.plan(); await f.apply(plan);
    await f.database.attempts.updateOne({ _id: `history-${f.suffix}` }, { $set: { transcript: "unexpected edit" } });
    await assert.rejects(verifyAssignment(f.database, plan), /UNRELATED_DOCUMENT_CHANGED/);
    await f.database.attempts.updateOne({ _id: `history-${f.suffix}` }, { $set: { transcript: "retained transcript" } });
    await f.database.attempts.createIndex({ transcript: 1 });
    await assert.rejects(verifyAssignment(f.database, plan), /INDEXES_CHANGED/);
  } finally { await f.close(); }
});
