import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { test } from "node:test";
import type { Server } from "node:http";
import { createApp } from "../server/app";
import { hashPassword, hashToken } from "../server/auth";
import { parseDuoCredentials, provisionDuoAccounts } from "../server/duo-auth";
import { connectDatabase, seedDatabase } from "../server/storage";
import { estimatePlacement } from "../server/learning";
import type { Attempt, PlacementState, Profile } from "../shared/types";
import type { DuoAssessmentView, DuoRoomView, DuoSnapshot } from "../shared/duo";

test("advanced placement can estimate 8.0 while keeping the lower bound and uncertainty", () => {
  const high = estimatePlacement(Array.from({ length: 40 }, () => ({ correct: true, difficulty: 3.8 })));
  assert.equal(high.estimatedBand, 8);
  assert.ok(high.standardError > 0 && Number.isFinite(high.standardError));
  assert.equal(estimatePlacement(Array.from({ length: 40 }, () => ({ correct: false, difficulty: -3 }))).estimatedBand, 3);
});

test("real Duo HTTP: fixed identities, independent practice, owned graded proof and protected promotion", { timeout: 90_000 }, async () => {
  const name = `ielts_duo_api_test_${randomUUID().replaceAll("-", "")}`;
  assert.match(name, /^ielts_duo_api_test_[a-f0-9]{32}$/);
  const database = await connectDatabase(process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017", name);
  let server: Server | undefined;
  const providerKeys = ["IELTS_OPENAI_API_KEY", "OPENAI_API_KEY", "IELTS_AZURE_SPEECH_KEY", "AZURE_SPEECH_KEY"];
  const savedKeys = new Map(providerKeys.map(key => [key, process.env[key]]));
  providerKeys.forEach(key => delete process.env[key]);
  try {
    await seedDatabase(database);
    const settings = parseDuoCredentials({ duoId: "synthetic-http-duo", accounts: [
      { role: "husband", name: "Synthetic Learner A", phone: "0390000011", passwordHash: await hashPassword("test-http-password-a") },
      { role: "wife", name: "Synthetic Learner B", phone: "0390000012", passwordHash: await hashPassword("test-http-password-b") },
    ] });
    await provisionDuoAccounts(database, settings);
    let offset = 0;
    // Legacy API/resume fixtures omit monitoring; dedicated native/browser integrity suites cover strict policy.
    server = createApp(database, { duoEnabled: true, duoCredentials: settings, production: false, serveClient: false, examIntegrityEnabled: false, duo: { sessionsPerBand: 10, gateInterval: 5, lessonKinds: ["grammar"], countdownSeconds: 1, now: () => Date.now() + offset } }).listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    const jars = { a: "", b: "", denied: "" };
    async function request(who: keyof typeof jars, method: string, path: string, input?: unknown, status = 200): Promise<any> {
      const response = await fetch(origin + "/api" + path, { method, headers: { ...(jars[who] ? { Cookie: jars[who] } : {}), ...(input !== undefined ? { "Content-Type": "application/json" } : {}) }, ...(input !== undefined ? { body: JSON.stringify(input) } : {}) });
      const body = await response.json();
      assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(body)}`);
      const cookie = response.headers.getSetCookie().at(-1); if (cookie) jars[who] = cookie.split(";")[0];
      return body;
    }
    const snapshot = async (who: "a" | "b" = "a") => (await request(who, "GET", "/duo")).duo as DuoSnapshot;
    const health = await request("denied", "GET", "/health");
    assert.equal(health.authMode, "phone"); assert.equal(health.duoEnabled, true); assert.equal(health.demoEnabled, false);
    assert.ok(!JSON.stringify(health).includes(settings.accounts[0].phone));
    await request("denied", "POST", "/auth/register", {}, 403);
    await request("denied", "POST", "/auth/demo", { learner: 1 }, 403);
    await request("denied", "POST", "/auth/login", { email: "legacy@example.invalid", password: "test-http-password-a" }, 400);
    await request("denied", "POST", "/auth/login", { phone: "0390000099", password: "test-http-password-a" }, 401);
    await request("denied", "POST", "/auth/login", { phone: settings.accounts[0].phone, password: "incorrect" }, 401);
    const a = (await request("a", "POST", "/auth/login", { phone: settings.accounts[0].phone, password: "test-http-password-a" })).user as Profile;
    const b = (await request("b", "POST", "/auth/login", { phone: "+84390000012", password: "test-http-password-b" })).user as Profile;
    assert.notEqual(a.id, b.id); assert.equal(a.targetBand, 8); assert.equal(a.duoRole, "husband");
    assert.ok(!JSON.stringify(a).includes("passwordHash"));
    await database.sessions.insertOne({ _id: hashToken("unbound-legacy-token"), userId: a.id, expiresAt: new Date(Date.now() + 60_000), createdAt: new Date() });
    jars.denied = "ielts_session=unbound-legacy-token";
    assert.equal((await request("denied", "GET", "/auth/me")).user, null);
    await request("denied", "GET", "/duo", undefined, 401);
    await request("a", "PATCH", "/profile", { name: "Another identity" }, 400);
    await request("a", "PATCH", "/profile", { targetBand: 7.5 }, 400);
    await request("a", "DELETE", "/account/history", { confirm: true }, 409);
    const advanced = await database.content.findOne({ band: 8, skill: "reading", format: "lesson" });
    assert.ok(advanced, "Actual high-band Reading practice exists in the fresh bank");
    const ordinary = (await request("a", "POST", "/attempts", { contentId: advanced.id, mode: "exam" }, 201)).attempt as Attempt;
    assert.equal(ordinary.duoAssessmentId, undefined, "An ordinary exam works with only one logged-in participant");
    const mock = await database.content.findOne({ skill: "reading", format: "full-mock" }); assert.ok(mock);
    const ordinaryMock = (await request("a", "POST", "/attempts", { contentId: mock.id, mode: "exam" }, 201)).attempt as Attempt;
    assert.equal(ordinaryMock.duoAssessmentId, undefined, "Full mocks are also available independently at every path stage");
    assert.equal((await snapshot()).path, null);
    async function placement(who: "a" | "b", correct: boolean): Promise<PlacementState> {
      let value = (await request(who, "POST", "/placement/start", { mode: "quick" }, 201)).placement as PlacementState;
      while (value.question) {
        const item = await database.placementItems.findOne({ _id: value.question.id }); assert.ok(item);
        value = (await request(who, "POST", `/placement/${value.id}/answer`, { questionId: item.id, answer: correct ? item.answer : item.options.find(option => option !== item.answer) })).placement;
      }
      return value;
    }
    const firstPlacement = await placement("a", true);
    assert.equal((await snapshot()).path, null, "One placement never creates the shared path");
    const secondPlacement = await placement("b", false);
    let duo = await snapshot(); assert.ok(duo.path);
    assert.equal(duo.path.currentBand, Math.min(firstPlacement.estimatedBand, secondPlacement.estimatedBand));
    const pathId = duo.path.id; const initialBand = duo.path.currentBand;
    await placement("a", false); duo = await snapshot();
    assert.equal(duo.path?.id, pathId); assert.equal(duo.path?.startingBand, initialBand);
    assert.equal(await database.placements.countDocuments({ userId: a.id, result: { $ne: null } }), 2, "Personal placement history is retained");
    const band = duo.bands.find(entry => entry.band === initialBand)!;
    await request("a", "POST", `/duo/lessons/${band.lessons[5].id}/complete`, {}, 403);
    await request("a", "POST", `/duo/gates/${band.gates[0].id}/start`, {}, 403);
    await request("a", "POST", "/duo/rooms", {}, 403);
    async function objective(who: "a" | "b", contentId: string, correct = true, assessmentId?: string): Promise<Attempt> {
      const content = await database.content.findOne({ _id: contentId }); assert.ok(content);
      const attempt = (await request(who, "POST", "/attempts", { contentId, mode: assessmentId ? "exam" : "practice", ...(assessmentId ? { duoAssessmentId: assessmentId } : {}) }, 201)).attempt as Attempt;
      const responses = Object.fromEntries(content.questions.map(question => [question.id, correct ? question.type === "choice-multiple" ? JSON.stringify(content.questions.filter(other => other.selectionGroup?.id === question.selectionGroup?.id).map(other => other.answer)) : question.answer : "deliberately incorrect test response"]));
      await request(who, "PATCH", `/attempts/${attempt.id}`, { responses, feedback: { source: "ai", estimatedBand: 9 }, passed: true });
      return (await request(who, "POST", `/attempts/${attempt.id}/submit`, { estimatedBand: 9, passed: true })).attempt;
    }
    async function completeLessons(from: number, to: number) {
      for (const lesson of band.lessons.slice(from, to)) {
        const attemptA = await objective("a", lesson.contentId!);
        await request("b", "POST", `/duo/lessons/${lesson.id}/complete`, { attemptId: attemptA.id }, 409);
        await request("a", "POST", `/duo/lessons/${lesson.id}/complete`, { attemptId: attemptA.id });
        const attemptB = await objective("b", lesson.contentId!);
        await request("b", "POST", `/duo/lessons/${lesson.id}/complete`, { attemptId: attemptB.id });
      }
    }
    await completeLessons(0, 5);
    async function gate(who: "a" | "b", gateId: string, correct = true) {
      const assessment = (await request(who, "POST", `/duo/gates/${gateId}/start`, {})).assessment as DuoAssessmentView;
      for (const part of assessment.parts) await objective(who, part.contentId, correct, assessment.id);
      return (await request(who, "GET", `/duo/assessments/${assessment.id}`)).assessment as DuoAssessmentView;
    }
    const pass = await gate("a", band.gates[0].id); assert.equal(pass.status, "passed");
    const failed = await gate("b", band.gates[0].id, false); assert.equal(failed.status, "failed");
    assert.equal((await snapshot()).bands.find(entry => entry.band === initialBand)!.lessons[5].unlocked, false);
    const retry = await gate("b", band.gates[0].id); assert.equal(retry.status, "passed"); assert.notEqual(retry.id, failed.id);
    duo = await snapshot(); const gateState = duo.bands.find(entry => entry.band === initialBand)!.gates[0];
    assert.equal(gateState.assessmentIds.husband, pass.id, "The first user's valid pass is retained");
    assert.equal(duo.bands.find(entry => entry.band === initialBand)!.lessons[5].unlocked, true);
    await completeLessons(5, 10);
    let room = (await request("a", "POST", "/duo/rooms", {}, 201)).room as DuoRoomView;
    await request("a", "POST", `/duo/rooms/${room.id}/join`, {});
    await request("a", "POST", `/duo/rooms/${room.id}/start`, {}, 403);
    await request("a", "POST", `/duo/rooms/${room.id}/ready`, { ready: true });
    assert.equal((await request("a", "GET", `/duo/rooms/${room.id}`)).room.status, "waiting");
    await request("b", "POST", `/duo/rooms/${room.id}/join`, {});
    room = (await request("b", "POST", `/duo/rooms/${room.id}/ready`, { ready: true })).room;
    assert.equal(room.status, "countdown");
    await request("a", "POST", `/duo/rooms/${room.id}/start`, {}, 403);
    offset += 1_100;
    const examA = (await request("a", "POST", `/duo/rooms/${room.id}/start`, {})).assessment as DuoAssessmentView;
    const examB = (await request("b", "POST", `/duo/rooms/${room.id}/start`, {})).assessment as DuoAssessmentView;
    assert.notEqual(examA.id, examB.id); assert.equal(examA.deadlineAt, examB.deadlineAt);
    assert.deepEqual(examA.parts.map(part => part.deadlineAt), examB.parts.map(part => part.deadlineAt));
    await request("a", "GET", `/duo/assessments/${examB.id}`, undefined, 404);
    await request("a", "POST", "/attempts", { contentId: examA.parts[0].contentId, mode: "practice", duoAssessmentId: examA.id }, 400);
    await request("a", "POST", "/attempts", { contentId: examA.parts[0].contentId, mode: "exam", duoAssessmentId: examB.id }, 404);
    await request("a", "POST", "/attempts", { contentId: band.lessons[0].contentId, mode: "exam", duoAssessmentId: examA.id }, 403);
    await request("a", "POST", "/attempts", { contentId: examA.parts[3].contentId, mode: "exam", duoAssessmentId: examA.id }, 403);
    const protectedAttempt = await objective("a", examA.parts[0].contentId, true, examA.id);
    const repeated = (await request("a", "POST", "/attempts", { contentId: protectedAttempt.contentId, mode: "exam", duoAssessmentId: examA.id })).attempt as Attempt;
    assert.equal(repeated.id, protectedAttempt.id, "A completed protected part resumes its receipt instead of creating an orphan attempt");
    assert.equal(await database.attempts.countDocuments({ userId: a.id, contentId: protectedAttempt.contentId, duoAssessmentId: examA.id }), 1);
    await request("b", "GET", `/attempts/${protectedAttempt.id}`, undefined, 404);
    assert.equal((await snapshot()).path?.currentBand, initialBand, "One passed exam part cannot advance either member");
  } finally {
    providerKeys.forEach(key => { const prior = savedKeys.get(key); if (prior === undefined) delete process.env[key]; else process.env[key] = prior; });
    if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
    assert.match(database.db.databaseName, /^ielts_duo_api_test_[a-f0-9]{32}$/);
    await database.db.dropDatabase(); await database.client.close();
  }
});
