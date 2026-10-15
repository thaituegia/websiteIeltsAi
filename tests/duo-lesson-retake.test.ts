import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { test } from "node:test";
import express from "express";
import type { Document } from "mongodb";
import { ApiError } from "../server/errors";
import { createDuoService } from "../server/duo";
import { connectDatabase, type AttemptRecord, type PlacementRecord, type UserRecord } from "../server/storage";
import { gradeObjective } from "../server/learning";
import type { ContentKind, StoredContent } from "../shared/types";
import type { DuoRole, DuoSnapshot } from "../shared/duo";

test("Duo lesson redo updates only its owner's latest valid proof and preserves achieved progression", { timeout: 30_000 }, async (t) => {
  const databaseName = `ielts_duo_retake_test_${randomUUID().replaceAll("-", "")}`;
  assert.match(databaseName, /^ielts_duo_retake_test_[a-f0-9]{32}$/);
  const database = await connectDatabase(process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017", databaseName);
  let server: Server | undefined;
  let clock = Date.parse("2026-10-15T12:00:00.000Z");
  const at = () => new Date(clock).toISOString();
  const roles = ["husband", "wife"] as const;
  const users = Object.fromEntries(roles.map((role) => {
    const id = `retake-${role}`;
    return [role, { _id: id, id, name: `Synthetic ${role}`, email: `${role}@fixture.invalid`, duoId: databaseName, duoRole: role, demo: false, passwordHash: null, currentBand: 4, targetBand: 8, testType: "academic", examDate: null, weeklyMinutes: 300, dailyMinutes: 45, cefr: null, createdAt: at() } as UserRecord];
  })) as Record<DuoRole, UserRecord>;
  const kinds: ContentKind[] = ["reading", "listening", "writing", "speaking", "grammar"];
  const bank: StoredContent[] = kinds.flatMap((skill) => (["lesson", "full-mock"] as const).map((format) => {
    const id = `retake-fixture-${skill}-${format}`;
    return { id, skill, format, title: `${skill} ${format} fixture`, description: "Private synthetic test material.", topic: "Fixture", band: 4, cefr: "B1", testType: "academic", durationMinutes: 10, sections: [{ id: "section", title: "Fixture", text: "Private fixture passage." }], questions: [{ id: `${id}-q1`, number: 1, sectionIndex: 0, type: "choice", prompt: "Fixture question?", options: ["correct", "wrong"], answer: "correct", evidence: "Fixture", explanation: "Fixture", subskill: "fixture" }], vocabularyIds: [], tags: ["fixture"], source: "authored", quality: "authored-unreviewed", createdAt: at() };
  }));
  try {
    await database.users.insertMany(Object.values(users));
    await database.content.insertMany(bank.map((item) => ({ ...item, _id: item.id })));
    const service = createDuoService(database, { now: () => clock, sessionsPerBand: 10, lessonKinds: ["grammar"] });
    await service.initialize();
    for (const role of roles) {
      const id = randomUUID();
      const placement: PlacementRecord = { _id: id, userId: users[role].id, mode: "quick", total: 1, theta: 0, standardError: 1, estimatedBand: 4, currentQuestionId: null, answers: [{ questionId: "fixture", answer: "correct", correct: true }], result: { id: randomUUID(), skill: "placement", estimatedBand: 4, rawScore: 1, total: 1, summary: "Fixture", criteria: [], corrections: [], paragraphs: [], answers: [], source: "rule-based", createdAt: at() }, startedAt: at() };
      await database.placements.insertOne(placement);
      await service.placementCompleted(users[role], placement);
    }
    const app = express();
    app.use(express.json());
    app.use((request, _response, next) => { (request as typeof request & { learner?: UserRecord }).learner = users[request.headers["x-test-role"] as DuoRole]; next(); });
    service.registerRoutes(app);
    app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => response.status(error instanceof ApiError ? error.status : 500).json({ error: error instanceof Error ? error.message : "Unexpected failure" }));
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    const snapshot = () => service.snapshot(users.husband);
    const initial = await snapshot();
    const band = initial.bands.find((item) => item.band === 4)!;
    const lesson = band.lessons[0];
    const material = bank.find((item) => item.id === lesson.contentId)!;
    const pathCollection = database.db.collection<Document & { _id: string }>("duo_learning_paths");
    async function complete(role: DuoRole, attemptId: string, expected = 200) {
      const response = await fetch(`${origin}/api/duo/lessons/${encodeURIComponent(lesson.id)}/complete`, { method: "POST", headers: { "Content-Type": "application/json", "x-test-role": role }, body: JSON.stringify({ attemptId }) });
      const body = await response.json(); assert.equal(response.status, expected, JSON.stringify(body));
      return body as { duo: DuoSnapshot };
    }
    async function submitted(role: DuoRole, correct: boolean, mode: "practice" | "exam" = "practice") {
      clock += 1000;
      const id = randomUUID();
      const responses = { [material.questions[0].id]: correct ? "correct" : "wrong" };
      const attempt: AttemptRecord = { _id: id, id, userId: users[role].id, contentId: material.id, title: material.title, skill: material.skill, mode, status: "submitted", startedAt: at(), submittedAt: at(), deadlineAt: null, durationSeconds: 1, responses, essays: {}, transcript: "", feedback: gradeObjective(material, responses) };
      await database.attempts.insertOne(attempt); return attempt;
    }
    const first = await submitted("husband", true);
    const partner = await submitted("wife", true);
    await complete("husband", first.id);
    await complete("wife", partner.id);
    const original = await pathCollection.findOne({ _id: databaseName }); assert.ok(original);
    const originalCompletion = structuredClone(original.bands.b8.lessons[0].completion.husband);
    const partnerCompletion = structuredClone(original.bands.b8.lessons[0].completion.wife);
    const originalGates = structuredClone(original.bands.b8.gates);
    const second = await submitted("husband", false);
    await t.test("a lower-scoring valid redo replaces the proof without revoking either achievement", async () => {
      await complete("husband", second.id);
      const path = await pathCollection.findOne({ _id: databaseName }); assert.ok(path);
      assert.deepEqual(path.bands.b8.lessons[0].completion.husband.proofIds, [second.id]);
      assert.equal(path.bands.b8.lessons[0].completion.husband.at, originalCompletion.at);
      assert.deepEqual(path.bands.b8.lessons[0].completion.wife, partnerCompletion);
      assert.deepEqual(path.bands.b8.gates, originalGates);
      assert.equal(path.currentBand, 4);
      assert.equal(await database.attempts.countDocuments({ userId: users.husband.id }), 2);
    });
    await t.test("repeat and older confirmations are idempotent and cannot overwrite the latest result", async () => {
      const before = await pathCollection.findOne({ _id: databaseName }); assert.ok(before);
      await complete("husband", first.id);
      await complete("husband", second.id);
      const after = await pathCollection.findOne({ _id: databaseName }); assert.ok(after);
      assert.equal(after.revision, before.revision);
      assert.deepEqual(after.bands.b8.lessons[0].completion.husband, before.bands.b8.lessons[0].completion.husband);
    });
    await t.test("concurrent confirmations keep the newer submission and the partner's progress", async () => {
      const earlier = await submitted("husband", true);
      const later = await submitted("husband", false);
      await Promise.all([complete("husband", later.id), complete("husband", earlier.id)]);
      const path = await pathCollection.findOne({ _id: databaseName }); assert.ok(path);
      assert.deepEqual(path.bands.b8.lessons[0].completion.husband.proofIds, [later.id]);
      assert.equal(path.bands.b8.lessons[0].completion.husband.at, originalCompletion.at);
      assert.deepEqual(path.bands.b8.lessons[0].completion.wife, partnerCompletion);
    });
    await t.test("legacy completion proofs are compared by their persisted submission time", async () => {
      await pathCollection.updateOne({ _id: databaseName }, { $set: { "bands.b8.lessons.0.completion.husband": { ...originalCompletion, proofIds: [second.id] } } });
      await pathCollection.updateOne({ _id: databaseName }, { $unset: { "bands.b8.lessons.0.completion.husband.submittedAt": "", "bands.b8.lessons.0.completion.husband.startedAt": "" } });
      await complete("husband", first.id);
      const path = await pathCollection.findOne({ _id: databaseName }); assert.ok(path);
      assert.deepEqual(path.bands.b8.lessons[0].completion.husband.proofIds, [second.id]);
    });
    await t.test("foreign, exam, invalidated and incomplete attempts cannot alter a completed lesson", async () => {
      await complete("husband", partner.id, 409);
      const exam = await submitted("husband", true, "exam"); await complete("husband", exam.id, 409);
      const invalidated = await submitted("husband", true);
      await database.attempts.updateOne({ _id: invalidated.id }, { $set: { invalidatedAt: at() } });
      await complete("husband", invalidated.id, 409);
      const incomplete = await submitted("husband", true);
      await database.attempts.updateOne({ _id: incomplete.id }, { $set: { responses: {} } });
      await complete("husband", incomplete.id, 409);
    });
    await t.test("retaking an unlocked past-band lesson preserves later band and gate progress", async () => {
      clock += 1000;
      await pathCollection.updateOne({ _id: databaseName }, { $set: { currentBand: 4.5, "bands.b8.completedAt": at(), "bands.b9.unlockedAt": at() } });
      const before = await pathCollection.findOne({ _id: databaseName }); assert.ok(before);
      const newest = await submitted("husband", false);
      await complete("husband", newest.id);
      const path = await pathCollection.findOne({ _id: databaseName }); assert.ok(path);
      assert.equal(path.currentBand, 4.5);
      assert.deepEqual(path.bands.b9, before.bands.b9);
      assert.deepEqual(path.bands.b8.gates, before.bands.b8.gates);
      assert.equal(path.bands.b8.completedAt, before.bands.b8.completedAt);
      assert.equal(path.bands.b8.lessons[0].completion.husband.at, originalCompletion.at);
      assert.deepEqual(path.bands.b8.lessons[0].completion.husband.proofIds, [newest.id]);
      assert.deepEqual(path.bands.b8.lessons[0].completion.wife, partnerCompletion);
    });
  } finally {
    if (server) { server.closeAllConnections(); await new Promise<void>((resolve) => server!.close(() => resolve())); }
    await database.db.dropDatabase();
    await database.client.close();
  }
});
