import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { test } from "node:test";
import express from "express";
import type { Collection, Document } from "mongodb";
import { createDuoService } from "../server/duo";
import { ApiError } from "../server/errors";
import { requireExamTab } from "../server/exam-guard";
import { connectDatabase, type AttemptRecord, type UserRecord } from "../server/storage";
import type { DuoAssessmentView, DuoRole, DuoRoomView } from "../shared/duo";
import type { ContentKind, StoredContent } from "../shared/types";

const roles: DuoRole[] = ["husband", "wife"];
const skills: ContentKind[] = ["reading", "listening", "writing", "speaking"];
const themes = ["orchards", "railways", "museums", "gardens"];
function syntheticContent(namespace: string, skill: ContentKind, format: "lesson" | "full-mock", index: number): StoredContent {
  const id = `${namespace}-${skill}-${format}-${index}`;
  const theme = themes[index]!;
  const segments = ["morning", "evening", "winter", "summer"];
  const count = format === "lesson" ? 1 : skill === "listening" ? 4 : skill === "writing" ? 2 : 3;
  const sections: StoredContent["sections"] = Array.from({ length: count }, (_, position) => {
    const text = `Local ${theme} during ${segments[position]} support the community and provide useful opportunities for families to learn and work together.`;
    const part = format === "lesson" && skill === "speaking" ? 2 : position + 1;
    return { id: `${id}-s${position}`, title: ["listening", "speaking"].includes(skill) ? `Part ${part}` : `Fixture ${segments[position]}`,
      text: skill === "speaking" && part !== 2 ? `1. How do ${theme} affect life during ${segments[position]}?\n2. Why are ${theme} useful during ${segments[position]}?` : text,
      ...(skill === "writing" ? { task: (format === "lesson" ? 2 : position + 1) as 1 | 2 } : {}),
      ...(skill === "listening" ? { dialogue: [{ speaker: "A", text, accent: "british" as const },
        ...([1, 3].includes(part) ? [{ speaker: "B", text: `We should visit these ${theme} during ${segments[position]}.`, accent: "british" as const }] : [])] } : {}),
      ...(skill === "speaking" && part === 2 ? { cuePoints: [`Describe these ${theme}.`, "Explain a useful experience."] } : {}),
    };
  });
  let number = 0;
  return { id, skill, format, title: `${skill} ${theme}`, description: "Isolated synthetic integrity fixture", topic: theme,
    band: 6, cefr: "B2", testType: "academic", durationMinutes: skill === "listening" ? 30 : skill === "speaking" ? 14 : 60, createdAt: new Date(0).toISOString(),
    source: "authored", quality: "authored-unreviewed", vocabularyIds: [], tags: [],
    sections,
    questions: ["reading", "listening"].includes(skill) ? sections.flatMap((_, sectionIndex) => Array.from({
      length: format === "lesson" ? 1 : skill === "listening" ? 10 : sectionIndex === 2 ? 14 : 13,
    }, () => ({ id: `${id}-q${++number}`, number, type: "choice" as const, sectionIndex,
      prompt: `What makes ${theme} valuable during ${segments[sectionIndex]}?`, subskill: "detail", options: [theme, "none"], answer: theme,
      evidence: `Local ${theme} during ${segments[sectionIndex]} support the community`, explanation: `The source describes useful ${theme}.` }))) : [],
  };
}

async function fixture(kind: "gate" | "promotion", companion = false, strict = false) {
  const name = `ielts_duo_exam_guard_test_${randomUUID().replaceAll("-", "")}`;
  const namespace = `synthetic-${randomUUID().slice(0, 8)}`;
  const database = await connectDatabase(process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017", name);
  let clock = Date.parse("2026-10-11T08:00:00Z");
  const at = () => new Date(clock).toISOString();
  const users = Object.fromEntries(roles.map(role => {
    const id = `${namespace}-${role}`;
    return [role, { _id: id, id, duoId: name, duoRole: role, name: `Synthetic ${role}`, email: `${role}@${name}.invalid`,
      passwordHash: null, demo: false, currentBand: 6, targetBand: 8, testType: "academic", examDate: null,
      weeklyMinutes: 300, dailyMinutes: 45, cefr: "B2", createdAt: at() }];
  })) as Record<DuoRole, UserRecord>;
  await database.users.insertMany(Object.values(users));
  const bank = skills.flatMap(skill => ["lesson", "full-mock"].flatMap(format =>
    themes.map((_, index) => syntheticContent(namespace, skill, format as "lesson" | "full-mock", index))));
  await database.content.insertMany(bank.map(content => ({ ...content, _id: content.id })));
  const seedGate = `${namespace}-reading-lesson-0`;
  const seedPromotion = skills.map(skill => `${namespace}-${skill}-full-mock-0`);
  const gateId = `${namespace}:gate`;
  const roomId = `${namespace}:room`;
  const assessmentIds = kind === "gate" ? { husband: `${namespace}:gate-current`, wife: `${namespace}:gate-prior` }
    : { husband: `${roomId}:husband`, wife: `${roomId}:wife` };
  const lessonCompletion = { husband: { at: at(), proofIds: ["historical-practice-a"], kind: "attempt" },
    wife: { at: at(), proofIds: ["historical-practice-b"], kind: "attempt" } };
  const band = { band: 6, unlockedAt: at(), completedAt: null,
    lessons: Array.from({ length: 6 }, (_, index) => ({ id: `${namespace}:lesson:${index}`, number: index + 1,
      title: "Completed synthetic lesson", kind: "reading", contentId: seedGate, vocabularyIds: [], completion: structuredClone(lessonCompletion) })),
    gates: [{ id: gateId, number: 1, fromLesson: 1, afterLesson: 5, contentIds: [seedGate], results: {
      husband: { status: kind === "gate" ? "in-progress" : "passed", assessmentId: kind === "gate" ? assessmentIds.husband : "prior-gate-husband", at: at() },
      wife: { status: "passed", assessmentId: kind === "gate" ? assessmentIds.wife : "prior-gate-wife", at: at() } } }],
    promotionContentIds: seedPromotion, promotionResults: { husband: null, wife: kind === "promotion" ? {
      status: "passed", assessmentId: companion ? "prior-room-wife" : assessmentIds.wife, at: at() } : null },
    lastPromotionRoomId: kind === "promotion" ? roomId : null };
  const previous = { ...structuredClone(band), band: 5.5, completedAt: at(), promotionResults: {
    husband: { status: "passed", assessmentId: "historical-promotion-husband", at: at() },
    wife: { status: "passed", assessmentId: "historical-promotion-wife", at: at() } } };
  await database.db.collection("duo_learning_paths").insertOne({ _id: name as any, duoId: name,
    members: { husband: users.husband.id, wife: users.wife.id }, startingBand: 5.5, currentBand: 6, targetBand: 8,
    gateInterval: 5, sessionsPerBand: 10, passPercent: 70, strictRetakeMode: false, revision: 0, startedAt: at(), updatedAt: at(),
    bands: { b11: previous, b12: band, b13: { ...structuredClone(band), band: 6.5, unlockedAt: null } } });
  if (kind === "promotion") await database.db.collection("duo_promotion_rooms").insertOne({ _id: roomId as any, duoId: name, band: 6,
    status: "in-progress", active: true, createdAt: at(), startsAt: at(), deadlineAt: new Date(clock + 240 * 60_000).toISOString(), revision: 0,
    members: Object.fromEntries(roles.map(role => [role, { userId: users[role].id, joinedAt: at(), lastSeenAt: at(), readyAt: at(),
      companion: role === "wife" && companion, assessmentId: role === "wife" && companion ? null : assessmentIds[role] }])) });
  const attempts: AttemptRecord[] = [];
  for (const role of roles) {
    if (kind === "promotion" && role === "wife" && companion) continue;
    const contentIds = kind === "gate" ? [seedGate] : seedPromotion;
    const id = `${namespace}:attempt:${role}`;
    const seed = bank.find(content => content.id === contentIds[0])!;
    const attempt: AttemptRecord = { _id: id, id, userId: users[role].id, contentId: seed.id, title: seed.title, skill: seed.skill,
      mode: "exam", status: role === "wife" ? "submitted" : "in-progress", duoAssessmentId: assessmentIds[role],
      startedAt: at(), deadlineAt: new Date(clock + 60 * 60_000).toISOString(), submittedAt: role === "wife" ? at() : null,
      durationSeconds: 10, responses: { [seed.questions[0]!.id]: themes[0]! }, essays: { draft: "A draft to erase" }, transcript: "A transcript to erase",
      feedback: { id: `${id}:feedback`, skill: seed.skill, estimatedBand: 7, rawScore: 1, total: 1, summary: "Synthetic feedback", criteria: [],
        corrections: [], paragraphs: [], answers: [], source: "rule-based", createdAt: at() } };
    await database.attempts.insertOne({ ...attempt, submissionLease: { token: "synthetic-held-lease", expiresAt: new Date(clock + 60_000).toISOString() } } as AttemptRecord);
    attempts.push(attempt);
    await database.db.collection("duo_assessments").insertOne({ _id: assessmentIds[role] as any, duoId: name, userId: users[role].id, role,
      kind, band: 6, gateId: kind === "gate" ? gateId : null, roomId: kind === "promotion" ? roomId : null,
      status: role === "wife" ? "passed" : "in-progress", active: role !== "wife", passPercent: 70, requiredBand: 6.5,
      createdAt: at(), completedAt: role === "wife" ? at() : null, deadlineAt: new Date(clock + 240 * 60_000).toISOString(), revision: 0,
      parts: contentIds.map((contentId, index) => { const content = bank.find(item => item.id === contentId)!;
        return { contentId, title: content.title, skill: content.skill, attemptId: index === 0 ? id : null,
          status: role === "wife" ? "passed" : "in-progress", scorePercent: role === "wife" ? 100 : null,
          estimatedBand: role === "wife" ? 7 : null, startsAt: new Date(clock + index * 60 * 60_000).toISOString(),
          deadlineAt: new Date(clock + (index + 1) * 60 * 60_000).toISOString() }; }) });
  }
  const service = createDuoService(database, { now: () => clock });
  const app = express(); app.use(express.json());
  app.use((request, _response, next) => { (request as typeof request & { learner?: UserRecord }).learner = users[request.headers["x-role"] as DuoRole]; next(); });
  service.registerRoutes(app, strict ? {
    beforeStart: request => { requireExamTab(request.get("X-Exam-Tab")); },
    opened: async () => {}, check: async () => {},
  } : undefined);
  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    response.status(error instanceof ApiError ? error.status : 500).json({ error: String(error) });
  });
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const tabs = { husband: `${namespace}_husband_document`, wife: `${namespace}_wife_document` };
  async function request<T>(role: DuoRole, route: string, body?: unknown, expected?: number, tabId?: string): Promise<T> {
    const response = await fetch(`${origin}${route}`, { method: body === undefined ? "GET" : "POST",
      headers: { "x-role": role, "content-type": "application/json", ...(strict ? { "X-Exam-Tab": tabId ?? tabs[role] } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json();
    if (expected === undefined) assert.ok(response.ok, JSON.stringify(result));
    else assert.equal(response.status, expected, JSON.stringify(result));
    return result as T;
  }
  return { database, service, users, namespace, name, gateId, roomId, assessmentIds, attempts, seedGate, seedPromotion,
    advance: (ms: number) => { clock += ms; }, now: () => clock, request, tabs,
    path: () => database.db.collection("duo_learning_paths").findOne({ _id: name as any }),
    close: async () => { await new Promise<void>(resolve => server.close(() => resolve())); await database.db.dropDatabase(); await database.client.close(); } };
}

async function readyProtectedRoom(f: Awaited<ReturnType<typeof fixture>>) {
  await f.database.db.collection("duo_promotion_rooms").updateOne({ _id: f.roomId as any }, {
    $set: { status: "waiting", startsAt: null, deadlineAt: null, "members.husband.readyAt": null, "members.wife.readyAt": null },
  });
  for (const role of roles) {
    await f.request(role, `/api/duo/rooms/${f.roomId}/join`, {});
    const ready = await f.request<{ room: DuoRoomView }>(role, `/api/duo/rooms/${f.roomId}/ready`, { ready: true });
    assert.equal(ready.room.requiresPresence, true);
  }
  f.advance(5_001);
  return (await f.request<{ room: DuoRoomView }>("husband", `/api/duo/rooms/${f.roomId}`)).room;
}

async function acceptParts(f: Awaited<ReturnType<typeof fixture>>, role: DuoRole, grading = false) {
  const records = f.database.db.collection<Document & { _id: string }>("duo_assessments");
  const assessment = await records.findOne({ _id: f.assessmentIds[role] }); assert.ok(assessment);
  const parts = assessment.parts as DuoAssessmentView["parts"];
  const template = f.attempts.find(attempt => attempt.userId === f.users[role].id)!;
  for (const [index, part] of parts.entries()) {
    const content = await f.database.content.findOne({ _id: part.contentId }); assert.ok(content);
    const id = part.attemptId ?? `${f.namespace}:accepted:${role}:${index}`;
    const lastGrading = grading && index === parts.length - 1;
    const attempt: AttemptRecord = { ...template, _id: id, id, contentId: content.id, skill: content.skill, title: content.title,
      status: lastGrading ? "in-progress" : "submitted", submittedAt: lastGrading ? null : new Date(f.now()).toISOString(),
      feedback: lastGrading ? null : { ...template.feedback!, skill: content.skill } };
    await f.database.attempts.replaceOne({ _id: id }, { ...attempt, ...(lastGrading ? {
      submissionLease: { token: "synthetic-final-provider-lease", expiresAt: new Date(f.now() + 20 * 60_000).toISOString() },
    } : {}) } as AttemptRecord, { upsert: true });
    parts[index] = { ...part, attemptId: id };
  }
  await records.updateOne({ _id: assessment._id }, { $set: { parts } });
  if (grading) await f.database.db.collection("exam_integrity_sessions").insertOne({ _id: `${f.namespace}:guard:${role}` as any,
    userId: f.users[role].id, kind: "assessment", resourceId: assessment._id, status: "active", phase: "grading",
    tabId: f.tabs[role], leaseUntil: f.now() + 20 * 60_000, createdAt: new Date(f.now()).toISOString() });
}

test("Duo gate integrity resets only the active learner receipt, blocks stale grading and rotates its retake", { timeout: 30_000 }, async () => {
  const f = await fixture("gate");
  try {
    const before = await f.path();
    const audioFiles = new Map<DuoRole, import("mongodb").ObjectId>();
    for (const role of roles) {
      const attempt = f.attempts.find(entry => entry.userId === f.users[role].id)!;
      const stream = f.database.recordings.openUploadStream(`synthetic-${role}.wav`, {
        metadata: { userId: attempt.userId, attemptId: attempt.id },
      });
      const finished = once(stream, "finish"); stream.end(Buffer.from("synthetic audio fixture")); await finished;
      audioFiles.set(role, stream.id);
      await f.database.audio.insertOne({ _id: `${attempt.id}:audio`, userId: attempt.userId, attemptId: attempt.id,
        fileId: stream.id, mime: "audio/wav", createdAt: new Date(0).toISOString() });
    }
    await assert.rejects(f.service.invalidateIntegrity(f.users.wife, f.assessmentIds.husband, "hidden"), /Không tìm thấy/);
    const submitted = { ...f.attempts[0]!, status: "submitted" as const };
    await f.database.attempts.updateOne({ _id: submitted.id }, { $set: { status: "submitted" } });
    const receipts = (f.service as unknown as { assessments: Collection<Document & { _id: string }> }).assessments;
    const original = receipts.findOneAndUpdate.bind(receipts);
    let entered!: () => void; let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    receipts.findOneAndUpdate = (async (...args: Parameters<typeof original>) => { entered(); await held; return original(...args); }) as typeof receipts.findOneAndUpdate;
    const grading = f.service.attemptSubmitted(submitted);
    try {
      await started;
      const result = await f.service.invalidateIntegrity(f.users.husband, f.assessmentIds.husband, "hidden");
      assert.deepEqual(result.assessmentIds, [f.assessmentIds.husband]); assert.deepEqual(result.attemptIds, [submitted.id]);
    } finally { release(); receipts.findOneAndUpdate = original as typeof receipts.findOneAndUpdate; }
    await grading;
    const current = await f.path();
    assert.equal(current!.bands.b12.gates[0].results.husband, null);
    assert.deepEqual(current!.bands.b12.gates[0].results.wife, before!.bands.b12.gates[0].results.wife);
    assert.deepEqual(current!.bands.b12.lessons, before!.bands.b12.lessons);
    assert.deepEqual(current!.bands.b11, before!.bands.b11);
    const cancelled = await f.database.attempts.findOne({ _id: submitted.id });
    assert.equal(cancelled!.status, "invalidated"); assert.deepEqual(cancelled!.responses, {}); assert.deepEqual(cancelled!.essays, {});
    assert.equal(cancelled!.transcript, ""); assert.equal(cancelled!.feedback, null); assert.equal((cancelled as any).submissionLease, undefined);
    assert.equal(cancelled!.integrity?.status, "invalidated"); assert.equal(cancelled!.integrity?.reason, "hidden");
    assert.equal(await f.database.audio.countDocuments({ attemptId: submitted.id }), 0);
    assert.equal(await f.database.db.collection("recordings.files").countDocuments({ _id: audioFiles.get("husband") }), 0);
    assert.equal(await f.database.audio.countDocuments({ attemptId: f.attempts[1]!.id }), 1);
    assert.equal(await f.database.db.collection("recordings.files").countDocuments({ _id: audioFiles.get("wife") }), 1);
    const retake = await f.request<{ assessment: DuoAssessmentView }>("husband", `/api/duo/gates/${f.gateId}/start`, {});
    assert.notEqual(retake.assessment.id, f.assessmentIds.husband);
    assert.notEqual(retake.assessment.parts[0]!.contentId, f.seedGate);
    const newContent = await f.database.content.findOne({ _id: retake.assessment.parts[0]!.contentId });
    assert.ok(newContent); assert.notEqual(newContent.sections[0]!.text, (await f.database.content.findOne({ _id: f.seedGate }))!.sections[0]!.text);
    assert.deepEqual((await f.path())!.bands.b12.gates[0].contentIds, [f.seedGate]);
  } finally { await f.close(); }
});

test("shared promotion integrity resets both current-room receipts including the finished partner and starts a different common set", { timeout: 30_000 }, async () => {
  const f = await fixture("promotion");
  try {
    const before = await f.path();
    const results = await Promise.all(roles.map(role => f.service.invalidateIntegrity(f.users[role], f.assessmentIds[role], "duplicate-tab")));
    for (const result of results) assert.deepEqual([...result.assessmentIds].sort(), Object.values(f.assessmentIds).sort());
    await Promise.all(f.attempts.map(attempt => f.service.attemptSubmitted({ ...attempt, status: "submitted" })));
    const current = await f.path();
    assert.equal(current!.currentBand, 6); assert.deepEqual(current!.bands.b12.promotionResults, { husband: null, wife: null });
    assert.deepEqual(current!.bands.b12.lessons, before!.bands.b12.lessons); assert.deepEqual(current!.bands.b12.gates, before!.bands.b12.gates);
    assert.deepEqual(current!.bands.b11, before!.bands.b11);
    const cancelled = await f.database.attempts.find().toArray(); assert.ok(cancelled.every(attempt => attempt.status === "invalidated" && attempt.feedback === null));
    const room = (await f.request<{ room: DuoRoomView }>("wife", `/api/duo/rooms/${f.roomId}`)).room;
    assert.equal(room.status, "invalidated"); assert.equal(room.integrityReason, "duplicate-tab");
    const fresh = (await f.request<{ room: DuoRoomView }>("husband", "/api/duo/rooms", {})).room;
    assert.notEqual(fresh.id, f.roomId);
    for (const role of roles) { await f.request(role, `/api/duo/rooms/${fresh.id}/join`, {}); await f.request(role, `/api/duo/rooms/${fresh.id}/ready`, { ready: true }); }
    f.advance(5_001);
    const views = await Promise.all(roles.map(role => f.request<{ assessment: DuoAssessmentView }>(role, `/api/duo/rooms/${fresh.id}/start`, {})));
    assert.deepEqual(views[0]!.assessment.parts.map(part => part.contentId), views[1]!.assessment.parts.map(part => part.contentId));
    assert.ok(views[0]!.assessment.parts.every(part => !f.seedPromotion.includes(part.contentId)));
    assert.deepEqual((await f.path())!.bands.b12.promotionContentIds, f.seedPromotion);
  } finally { await f.close(); }
});

test("leaving an active companion room cancels the current sitting while preserving an earlier partner pass", { timeout: 30_000 }, async () => {
  const f = await fixture("promotion", true);
  try {
    const prior = (await f.path())!.bands.b12.promotionResults.wife;
    const result = await f.request<{ room: DuoRoomView }>("wife", `/api/duo/rooms/${f.roomId}/leave`, {});
    assert.equal(result.room.status, "invalidated");
    assert.deepEqual((await f.path())!.bands.b12.promotionResults.wife, prior);
    assert.equal((await f.database.attempts.findOne({ _id: f.attempts[0]!.id }))!.status, "invalidated");
    // A completed shared band is historical progress, even if a stale client exits later.
    await f.database.db.collection("duo_learning_paths").updateOne({ _id: f.name as any }, { $set: { currentBand: 6.5, "bands.b12.completedAt": new Date(0).toISOString() } });
    await f.service.invalidateIntegrity(f.users.husband, f.assessmentIds.husband, "page-exit");
    assert.equal((await f.path())!.currentBand, 6.5); assert.ok((await f.path())!.bands.b12.completedAt);
  } finally { await f.close(); }
});

test("a partner assessment inserted after shared cancellation cannot reopen the room", { timeout: 30_000 }, async () => {
  const f = await fixture("promotion");
  try {
    const receipts = (f.service as unknown as { assessments: Collection<Document & { _id: string }> }).assessments;
    await receipts.deleteOne({ _id: f.assessmentIds.wife as any });
    await f.database.db.collection("duo_promotion_rooms").updateOne({ _id: f.roomId as any }, { $set: { "members.wife.assessmentId": null } });
    const original = receipts.insertOne.bind(receipts);
    let entered!: () => void; let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    receipts.insertOne = (async (...args: Parameters<typeof original>) => {
      if (args[0]._id === f.assessmentIds.wife) { entered(); await held; }
      return original(...args);
    }) as typeof receipts.insertOne;
    const poll = f.request<{ room: DuoRoomView }>("wife", `/api/duo/rooms/${f.roomId}`);
    try { await started; await f.service.invalidateIntegrity(f.users.husband, f.assessmentIds.husband, "page-exit"); }
    finally { release(); receipts.insertOne = original as typeof receipts.insertOne; }
    assert.equal((await poll).room.status, "invalidated");
    const late = await receipts.findOne({ _id: f.assessmentIds.wife as any });
    assert.ok(late!.invalidatedAt); assert.equal(late!.status, "failed"); assert.equal(late!.active, false);
    assert.equal(late!.integrityReason, "page-exit");
    assert.equal(await receipts.countDocuments({ active: true }), 0);
  } finally { await f.close(); }
});

test("a late attempt bind is cancelled and a completed historical band cannot be invalidated", { timeout: 30_000 }, async () => {
  const f = await fixture("gate");
  try {
    await f.service.invalidateIntegrity(f.users.husband, f.assessmentIds.husband, "navigation");
    const late = { ...f.attempts[0]!, id: `${f.namespace}:late-attempt`, _id: `${f.namespace}:late-attempt`, status: "in-progress" as const };
    await f.database.attempts.insertOne(late);
    await assert.rejects(f.service.bindAttempt(f.users.husband, late.id, f.assessmentIds.husband), /đã đóng|thay đổi/);
    assert.equal((await f.database.attempts.findOne({ _id: late.id }))!.status, "invalidated");
    await assert.rejects(f.service.invalidateIntegrity(f.users.wife, f.assessmentIds.wife, "hidden"), /đã đóng/);
    assert.equal((await f.database.attempts.findOne({ _id: f.attempts[1]!.id }))!.status, "submitted");
  } finally { await f.close(); }
  const completed = await fixture("promotion");
  try {
    await completed.database.db.collection("duo_learning_paths").updateOne({ _id: completed.name as any }, {
      $set: { currentBand: 6.5, "bands.b12.completedAt": new Date(0).toISOString() },
    });
    const before = await completed.path();
    await assert.rejects(completed.service.invalidateIntegrity(completed.users.husband, completed.assessmentIds.husband, "hidden"), /đã đóng/);
    assert.deepEqual(await completed.path(), before);
    assert.equal((await completed.database.attempts.findOne({ _id: completed.attempts[0]!.id }))!.status, "in-progress");
  } finally { await completed.close(); }
});

test("protected companion exit cancels the current room and its guard while preserving an earlier pass", { timeout: 30_000 }, async () => {
  const f = await fixture("promotion", true, true);
  try {
    const prior = (await f.path())!.bands.b12.promotionResults.wife;
    const room = await readyProtectedRoom(f); assert.equal(room.requiresPresence, true);
    assert.ok(!JSON.stringify(room).includes("documentId")); assert.ok(!JSON.stringify(room).includes(f.tabs.wife));
    const guards = f.database.db.collection("exam_integrity_sessions");
    await guards.insertMany([{ _id: `${f.namespace}:active-guard` as any, kind: "assessment", userId: f.users.husband.id,
      resourceId: f.assessmentIds.husband, status: "active", phase: "answering", resetPending: true },
    { _id: `${f.namespace}:prior-guard` as any, kind: "assessment", userId: f.users.wife.id,
      resourceId: "prior-room-wife", status: "completed", phase: "grading" }]);
    const result = await f.request<{ room: DuoRoomView }>("wife", `/api/duo/rooms/${f.roomId}/leave`, { reason: "hidden", tabId: f.tabs.wife });
    assert.equal(result.room.status, "invalidated"); assert.equal(result.room.integrityReason, "hidden");
    assert.deepEqual((await f.path())!.bands.b12.promotionResults.wife, prior);
    assert.equal((await guards.findOne({ _id: `${f.namespace}:active-guard` as any }))!.status, "invalidated");
    assert.equal((await guards.findOne({ _id: `${f.namespace}:active-guard` as any }))!.resetPending, false);
    assert.equal((await guards.findOne({ _id: `${f.namespace}:prior-guard` as any }))!.status, "completed");
  } finally { await f.close(); }
});

test("a companion document mismatch resets the sitting and an expired ready member cannot enter late", { timeout: 30_000 }, async () => {
  const f = await fixture("promotion", true, true);
  try {
    await readyProtectedRoom(f);
    assert.equal(await f.service.observeRoomDocument(f.users.wife, f.tabs.wife), null);
    const reset = await f.service.observeRoomDocument(f.users.wife, `${f.namespace}_another_document`);
    assert.ok(reset); assert.deepEqual(reset.assessmentIds, [f.assessmentIds.husband]);
    assert.equal((await f.request<{ room: DuoRoomView }>("husband", `/api/duo/rooms/${f.roomId}`)).room.status, "invalidated");
    assert.equal((await f.path())!.bands.b12.promotionResults.wife.assessmentId, "prior-room-wife");
  } finally { await f.close(); }
  const expired = await fixture("promotion", true, true);
  try {
    await readyProtectedRoom(expired); // Neither member has received POST /start; only shared polling started the sitting.
    expired.advance(25_000);
    await expired.request("husband", `/api/duo/rooms/${expired.roomId}/start`, {}, 409);
    const room = (await expired.request<{ room: DuoRoomView }>("wife", `/api/duo/rooms/${expired.roomId}`)).room;
    assert.equal(room.status, "invalidated"); assert.equal(room.integrityReason, "heartbeat-lost");
    assert.equal((await expired.database.attempts.findOne({ _id: expired.attempts[0]!.id }))!.status, "invalidated");
  } finally { await expired.close(); }
});

test("a finished first member still cancels a shared sitting while the other member answers", { timeout: 30_000 }, async () => {
  const f = await fixture("promotion", false, true);
  try {
    await readyProtectedRoom(f); await acceptParts(f, "wife");
    const room = (await f.request<{ room: DuoRoomView }>("wife", `/api/duo/rooms/${f.roomId}`)).room;
    assert.equal(room.requiresPresence, true);
    const result = await f.request<{ room: DuoRoomView }>("wife", `/api/duo/rooms/${f.roomId}/leave`, { reason: "navigation", tabId: f.tabs.wife });
    assert.equal(result.room.status, "invalidated");
    assert.deepEqual((await f.path())!.bands.b12.promotionResults, { husband: null, wife: null });
    assert.ok((await f.database.attempts.find().toArray()).every(attempt => attempt.status === "invalidated"));
  } finally { await f.close(); }
});

test("all accepted final submissions survive departure and presence expiry during provider grading", { timeout: 30_000 }, async () => {
  const f = await fixture("promotion", false, true);
  try {
    await readyProtectedRoom(f); await acceptParts(f, "husband", true); await acceptParts(f, "wife", true);
    const guards = f.database.db.collection("exam_integrity_sessions");
    await guards.updateOne({ userId: f.users.husband.id }, { $set: { phase: "answering" } });
    assert.equal((await f.request<{ room: DuoRoomView }>("husband", `/api/duo/rooms/${f.roomId}`)).room.requiresPresence, true,
      "A final submission lease alone does not bypass the server's grading claim");
    await guards.updateOne({ userId: f.users.husband.id }, { $set: { phase: "grading" } });
    const before = await f.database.attempts.find().sort({ _id: 1 }).toArray();
    assert.equal((await f.request<{ room: DuoRoomView }>("husband", `/api/duo/rooms/${f.roomId}`)).room.requiresPresence, false);
    const left = (await f.request<{ room: DuoRoomView }>("wife", `/api/duo/rooms/${f.roomId}/leave`, { reason: "hidden", tabId: f.tabs.wife })).room;
    assert.equal(left.status, "in-progress"); assert.equal(left.requiresPresence, false);
    f.advance(25_000);
    assert.equal(await f.service.observeRoomDocument(f.users.wife, `${f.namespace}_new_document`), null);
    assert.equal((await f.request<{ room: DuoRoomView }>("husband", `/api/duo/rooms/${f.roomId}`)).room.status, "in-progress");
    assert.deepEqual(await f.database.attempts.find().sort({ _id: 1 }).toArray(), before);
    assert.equal(await guards.countDocuments({ status: "invalidated" }), 0);
  } finally { await f.close(); }
});

test("Ready requires a valid document before mutation and pre-exam departure only removes readiness", { timeout: 30_000 }, async () => {
  const f = await fixture("promotion", true, true);
  try {
    const rooms = f.database.db.collection("duo_promotion_rooms");
    await rooms.updateOne({ _id: f.roomId as any }, { $set: { status: "waiting", startsAt: null, deadlineAt: null,
      "members.husband.readyAt": null, "members.wife.readyAt": null } });
    const before = await rooms.findOne({ _id: f.roomId as any });
    await f.request("wife", `/api/duo/rooms/${f.roomId}/ready`, { ready: true }, 400, "");
    assert.deepEqual(await rooms.findOne({ _id: f.roomId as any }), before);
    await f.request("wife", `/api/duo/rooms/${f.roomId}/ready`, { ready: true });
    const assessments = await f.database.db.collection("duo_assessments").find().sort({ _id: 1 }).toArray();
    const contentCount = await f.database.content.countDocuments();
    const waiting = (await f.request<{ room: DuoRoomView }>("wife", `/api/duo/rooms/${f.roomId}/leave`, { reason: "hidden", tabId: f.tabs.wife })).room;
    assert.equal(waiting.status, "waiting"); assert.equal(waiting.requiresPresence, false); assert.equal(waiting.members.wife.ready, false);
    assert.deepEqual(await f.database.db.collection("duo_assessments").find().sort({ _id: 1 }).toArray(), assessments);
    assert.equal(await f.database.content.countDocuments(), contentCount);
    assert.equal((await f.path())!.bands.b12.promotionResults.wife.assessmentId, "prior-room-wife");
  } finally { await f.close(); }
});
