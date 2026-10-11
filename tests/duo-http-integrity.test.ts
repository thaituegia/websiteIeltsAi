import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { test } from "node:test";
import { createApp } from "../server/app";
import { hashPassword } from "../server/auth";
import { parseDuoCredentials, provisionDuoAccounts } from "../server/duo-auth";
import { gradeObjective } from "../server/learning";
import { connectDatabase } from "../server/storage";
import type { DuoAssessmentView, DuoRoomView } from "../shared/duo";
import type { Attempt, StoredContent } from "../shared/types";

const themes = ["orchards", "railways", "museums", "gardens"];
function syntheticReading(index: number): StoredContent {
  const theme = themes[index]!;
  const id = `synthetic-gate-http-${theme}`;
  return {
    id, skill: "reading", format: "lesson", title: `Synthetic ${theme} passage`, description: "Private Gate HTTP fixture", topic: theme,
    band: 6, cefr: "B2", testType: "academic", durationMinutes: 10,
    sections: [{ id: `${id}-source`, title: "Community passage", text: `Local ${theme} support community learning. Families visit these ${theme} to explore useful opportunities together. Organisers explain how the ${theme} provide employment and educational activities throughout the year.` }],
    questions: [{ id: `${id}-q1`, number: 1, sectionIndex: 0, type: "choice", questionType: "multiple-choice",
      prompt: `Which places provide learning opportunities in this ${theme} programme?`, options: [theme, "forests"], answer: theme,
      explanation: `The passage describes educational activities at ${theme}.`, evidence: `Local ${theme} support community learning`, subskill: "details" }],
    vocabularyIds: [], tags: ["synthetic-gate-http"], source: "authored", quality: "authored-unreviewed", createdAt: "2026-10-11T00:00:00.000Z",
  };
}

test("real Duo HTTP protects monitored Gate starts and shared promotion room documents", { timeout: 30_000 }, async t => {
  const name = `ielts_duo_http_integrity_test_${randomUUID().replaceAll("-", "")}`;
  assert.match(name, /^ielts_duo_http_integrity_test_[a-f0-9]{32}$/);
  const database = await connectDatabase(process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017", name);
  let server: Server | undefined;
  let origin = "";
  let now = Date.parse("2026-10-11T12:00:00Z");
  const at = () => new Date(now).toISOString();
  const cookies = { husband: "", wife: "" };
  const gateId = "synthetic-gate-http:gate";
  const bank = themes.map((_, index) => syntheticReading(index));
  const sessions = database.db.collection<{
    _id: string; userId: string; kind: string; resourceId: string; status: string; phase: string; leaseUntil: number; reason?: string; resetPending?: boolean;
  }>("exam_integrity_sessions");
  const assessments = database.db.collection<{
    _id: string; userId: string; active: boolean; status: string; invalidatedAt?: string; integrityReason?: string;
  }>("duo_assessments");
  async function request(who: keyof typeof cookies, method: string, path: string, payload?: unknown, expected = 200, tabId?: string): Promise<any> {
    const response = await fetch(`${origin}/api${path}`, {
      method,
      headers: { ...(cookies[who] ? { Cookie: cookies[who] } : {}), ...(payload === undefined ? {} : { "Content-Type": "application/json" }), ...(tabId ? { "X-Exam-Tab": tabId } : {}) },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    const body = await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(body)}`);
    const created = response.headers.getSetCookie().at(-1);
    if (created) cookies[who] = created.split(";")[0];
    return body;
  }
  try {
    await database.content.insertMany(bank.map(item => ({ ...item, _id: item.id })));
    const settings = parseDuoCredentials({ duoId: "synthetic-gate-http-integrity", accounts: [
      { role: "husband", name: "Synthetic Gate HTTP A", phone: "0390000041", passwordHash: await hashPassword("synthetic-gate-http-password-a") },
      { role: "wife", name: "Synthetic Gate HTTP B", phone: "0390000042", passwordHash: await hashPassword("synthetic-gate-http-password-b") },
    ] });
    const users = await provisionDuoAccounts(database, settings);
    const members = Object.fromEntries(users.map(user => [user.duoRole!, user.id]));
    await database.users.updateMany({ duoId: settings.duoId }, { $set: { currentBand: 6, cefr: "B2" } });
    // Historical synthetic lesson receipts make this Gate eligible; the test exercises native HTTP start/cancel behavior.
    const completion = {
      husband: { at: at(), proofIds: ["synthetic-practice-a"], kind: "attempt" },
      wife: { at: at(), proofIds: ["synthetic-practice-b"], kind: "attempt" },
    };
    const path = {
      _id: settings.duoId, duoId: settings.duoId, members, startingBand: 6, currentBand: 6, targetBand: 8,
      gateInterval: 5, sessionsPerBand: 5, passPercent: 70, strictRetakeMode: false, revision: 0, startedAt: at(), updatedAt: at(),
      bands: { b12: {
        band: 6, unlockedAt: at(), completedAt: null,
        lessons: Array.from({ length: 5 }, (_, index) => ({ id: `synthetic-gate-http:lesson:${index}`, number: index + 1,
          title: "Completed synthetic practice", kind: "reading", contentId: bank[0].id, vocabularyIds: [], completion: structuredClone(completion) })),
        gates: [{ id: gateId, number: 1, fromLesson: 1, afterLesson: 5, contentIds: [bank[0].id], results: { husband: null, wife: null } }],
        promotionContentIds: [], promotionResults: { husband: null, wife: null }, lastPromotionRoomId: null,
      } },
    };
    const paths = database.db.collection<typeof path>("duo_learning_paths");
    await paths.insertOne(path);
    server = createApp(database, { production: false, serveClient: false, duoEnabled: true, duoCredentials: settings, examIntegrityEnabled: true,
      duo: { sessionsPerBand: 5, gateInterval: 5, lessonKinds: ["reading"], countdownSeconds: 1, now: () => now } }).listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    origin = `http://127.0.0.1:${address.port}`;
    await request("husband", "POST", "/auth/login", { phone: settings.accounts[0].phone, password: "synthetic-gate-http-password-a" });
    await request("wife", "POST", "/auth/login", { phone: settings.accounts[1].phone, password: "synthetic-gate-http-password-b" });

    await t.test("missing or malformed Gate tab headers fail before creating any assessment or receipt", async () => {
      const before = await paths.findOne({ _id: settings.duoId });
      await request("husband", "POST", `/duo/gates/${gateId}/start`, {}, 400);
      await request("husband", "POST", `/duo/gates/${gateId}/start`, {}, 400, "bad");
      assert.equal(await assessments.countDocuments(), 0);
      assert.equal(await sessions.countDocuments(), 0);
      assert.deepEqual(await paths.findOne({ _id: settings.duoId }), before);
    });

    const husbandTab = randomUUID();
    const first = (await request("husband", "POST", `/duo/gates/${gateId}/start`, {}, 200, husbandTab)).assessment as DuoAssessmentView;
    const firstSession = await sessions.findOne({ userId: members.husband, resourceId: first.id });
    assert.ok(firstSession, "The Gate response must follow persisted monitoring lease creation");
    assert.equal(firstSession.kind, "assessment");
    assert.equal(firstSession.status, "active");
    assert.equal(firstSession.phase, "answering");
    assert.equal(firstSession.leaseUntil, now + 25_000);
    const wifeTab = randomUUID();
    const peer = (await request("wife", "POST", `/duo/gates/${gateId}/start`, {}, 200, wifeTab)).assessment as DuoAssessmentView;
    const peerBefore = await assessments.findOne({ _id: peer.id });

    await t.test("hidden invalidation cancels the current Gate, preserves its peer and starts a different armed retake", async child => {
      await request("wife", "GET", `/duo/assessments/${first.id}`, undefined, 404);
      const violation = await request("husband", "POST", `/exam-integrity/${firstSession._id}/violation`, { tabId: husbandTab, reason: "hidden" });
      assert.equal(violation.session.status, "invalidated");
      const cancelled = (await request("husband", "GET", `/duo/assessments/${first.id}`)).assessment as DuoAssessmentView;
      assert.equal(cancelled.status, "failed");
      assert.ok(cancelled.invalidatedAt);
      assert.equal(cancelled.integrityReason, "hidden");
      assert.deepEqual(await assessments.findOne({ _id: peer.id }), peerBefore);
      const retakeTab = randomUUID();
      const retake = (await request("husband", "POST", `/duo/gates/${gateId}/start`, {}, 200, retakeTab)).assessment as DuoAssessmentView;
      assert.notEqual(retake.id, first.id);
      assert.notEqual(retake.parts[0].contentId, first.parts[0].contentId);
      const newSession = await sessions.findOne({ userId: members.husband, resourceId: retake.id });
      assert.ok(newSession);
      assert.equal(newSession.status, "active");
      assert.equal(newSession.leaseUntil, now + 25_000);
      const opened = await request("husband", "POST", "/exam-integrity/open", { kind: "assessment", resourceId: retake.id, tabId: retakeTab });
      assert.equal(opened.session.id, newSession._id);
      assert.equal(await sessions.countDocuments({ resourceId: retake.id }), 1);

      await child.test("assessment GET settles an abandoned Gate lease before the exam deadline", async () => {
        assert.ok(Date.parse(retake.deadlineAt) > now + 25_001);
        now += 25_001;
        const expired = (await request("husband", "GET", `/duo/assessments/${retake.id}`)).assessment as DuoAssessmentView;
        assert.equal(expired.status, "failed");
        assert.ok(expired.invalidatedAt);
        assert.equal(expired.integrityReason, "heartbeat-lost");
        assert.equal((await sessions.findOne({ _id: newSession._id }))!.status, "invalidated");
        assert.equal((await assessments.findOne({ _id: retake.id }))!.active, false);
      });
    });

    await t.test("a companion's second document invalidates the shared sitting while preserving her earlier pass", async () => {
      // Fixture history makes promotion available without any provider or deployment account.
      await request("wife", "GET", `/duo/assessments/${peer.id}`);
      const oldAssessmentId = "synthetic-gate-http:prior-wife-promotion";
      const oldAttemptId = "synthetic-gate-http:prior-wife-attempt";
      const oldResponses = { [bank[1].questions[0].id]: bank[1].questions[0].answer };
      const oldFeedback = { ...gradeObjective(bank[1], oldResponses), estimatedBand: 7 };
      await database.attempts.insertOne({
        _id: oldAttemptId, id: oldAttemptId, userId: members.wife, contentId: bank[1].id, title: bank[1].title,
        skill: "reading", mode: "exam", status: "submitted", duoAssessmentId: oldAssessmentId,
        startedAt: at(), deadlineAt: at(), submittedAt: at(), durationSeconds: 10,
        responses: oldResponses, essays: {}, transcript: "", feedback: oldFeedback,
      });
      await database.db.collection<import("mongodb").Document & { _id: string }>("duo_assessments").insertOne({
        _id: oldAssessmentId, duoId: settings.duoId, userId: members.wife, role: "wife", kind: "promotion", band: 6,
        gateId: null, roomId: "synthetic-gate-http:prior-room", status: "passed", active: false, passPercent: 70,
        requiredBand: 6.5, createdAt: at(), completedAt: at(), deadlineAt: at(), revision: 0,
        parts: [{ contentId: bank[1].id, title: bank[1].title, skill: "reading", attemptId: oldAttemptId,
          status: "passed", scorePercent: 100, estimatedBand: 7, startsAt: at(), deadlineAt: at() }],
      });
      const mock: StoredContent = {
        ...bank[2], id: `${bank[2].id}-mock`, format: "full-mock", durationMinutes: 60,
        sections: ["morning", "afternoon", "evening"].map((time, index) => ({
          id: `synthetic-promotion-source-${index}`, title: `Passage ${index + 1}`, text: `${bank[2].sections[0].text} The session takes place during the ${time}.`,
        })),
        questions: Array.from({ length: 40 }, (_, index) => ({ ...bank[2].questions[0], id: `synthetic-promotion-q${index + 1}`,
          number: index + 1, sectionIndex: index < 13 ? 0 : index < 26 ? 1 : 2 })),
      };
      await database.content.insertOne({ ...mock, _id: mock.id });
      await paths.updateOne({ _id: settings.duoId }, { $set: {
        "bands.b12.gates.0.results": {
          husband: { status: "passed", assessmentId: "synthetic-passed-gate-a", at: at() },
          wife: { status: "passed", assessmentId: "synthetic-passed-gate-b", at: at() },
        },
        "bands.b12.promotionContentIds": [mock.id],
        "bands.b12.promotionResults.wife": { status: "passed", assessmentId: oldAssessmentId, at: at() },
      } });
      const oldAssessment = await assessments.findOne({ _id: oldAssessmentId });
      const oldAttempt = await database.attempts.findOne({ _id: oldAttemptId });
      const activeTab = randomUUID();
      const companionTab = randomUUID();
      const room = (await request("husband", "POST", "/duo/rooms", {}, 201, activeTab)).room as DuoRoomView;
      for (const [role, tab] of [["husband", activeTab], ["wife", companionTab]] as const) {
        await request(role, "POST", `/duo/rooms/${room.id}/join`, {}, 200, tab);
        await request(role, "POST", `/duo/rooms/${room.id}/ready`, { ready: true, ...(role === "wife" ? { companion: true } : {}) }, 200, tab);
      }
      const rooms = database.db.collection<{
        _id: string; status: string; active: boolean; requiresPresence?: boolean; members: Record<string, { documentId?: string }>;
      }>("duo_promotion_rooms");
      const ready = await rooms.findOne({ _id: room.id });
      assert.equal(ready!.requiresPresence, true);
      assert.equal(ready!.members.husband.documentId, activeTab);
      assert.equal(ready!.members.wife.documentId, companionTab);
      now += 2_000;
      await request("husband", "POST", `/duo/rooms/${room.id}/start`, {}, 400);
      assert.equal(await assessments.countDocuments({ active: true }), 0);
      const started = (await request("husband", "POST", `/duo/rooms/${room.id}/start`, {}, 200, activeTab)).assessment as DuoAssessmentView;
      const companion = await request("wife", "POST", `/duo/rooms/${room.id}/start`, {}, 200, companionTab);
      assert.equal(companion.companion, true);
      assert.equal(companion.assessment, null);
      const current = (await request("husband", "POST", "/attempts", { contentId: mock.id, mode: "exam", duoAssessmentId: started.id }, 201, activeTab)).attempt as Attempt;
      await request("husband", "PATCH", `/attempts/${current.id}`, { responses: { [mock.questions[0].id]: mock.questions[0].answer } }, 200, activeTab);
      const guard = await sessions.findOne({ userId: members.husband, resourceId: started.id });
      assert.ok(guard);
      assert.equal(guard.status, "active");
      assert.equal(await sessions.countDocuments({ userId: members.wife, status: "active" }), 0);
      await request("wife", "GET", "/dashboard", undefined, 200, randomUUID());
      const cancelled = await rooms.findOne({ _id: room.id });
      assert.equal(cancelled!.status, "invalidated");
      assert.equal(cancelled!.active, false);
      assert.equal((await assessments.findOne({ _id: started.id }))!.active, false);
      const cleared = await database.attempts.findOne({ _id: current.id });
      assert.equal(cleared!.status, "invalidated");
      assert.deepEqual(cleared!.responses, {});
      assert.equal(cleared!.feedback, null);
      const mirrored = await sessions.findOne({ _id: guard._id });
      assert.equal(mirrored!.status, "invalidated");
      assert.equal(mirrored!.reason, "duplicate-tab");
      assert.equal(mirrored!.resetPending, false);
      assert.deepEqual(await assessments.findOne({ _id: oldAssessmentId }), oldAssessment);
      assert.deepEqual(await database.attempts.findOne({ _id: oldAttemptId }), oldAttempt);
      await request("husband", "PATCH", `/attempts/${current.id}`, { responses: {} }, 409, activeTab);
    });
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    assert.match(database.db.databaseName, /^ielts_duo_http_integrity_test_[a-f0-9]{32}$/);
    await database.db.dropDatabase();
    await database.client.close();
  }
});
