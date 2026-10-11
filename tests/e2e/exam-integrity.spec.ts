import { randomUUID } from "node:crypto";
import type { Page, Route } from "@playwright/test";
import type { DuoAssessmentView, DuoRoomView, DuoSnapshot } from "../../shared/duo";
import type { ExamIntegritySession } from "../../shared/exam-integrity";
import type { Attempt, ContentItem, PlacementState } from "../../shared/types";
import { test, expect, duoLogin } from "./duo-fixtures";

// The fixture owns a disposable database and synthetic phone accounts. Its
// explicit strict setting leaves historical timer/resume tests unchanged.
test.use({ integrityEnabled: true });

function apiResponse(page: Page, suffix: string, method = "POST") {
  return page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith(suffix) &&
    response.request().method() === method,
  );
}

async function confirmRules(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Quy định phòng thi", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("tab");
  await dialog.getByRole("button", { name: "Tôi hiểu, bắt đầu bài thi", exact: true }).click();
}

async function startPlacement(page: Page): Promise<PlacementState> {
  await page.getByRole("button", { name: "Bắt đầu kiểm tra nhanh", exact: true }).click();
  const started = apiResponse(page, "/api/placement/start");
  await confirmRules(page);
  const response = await started;
  expect(response.status()).toBe(201);
  const placement: PlacementState = (await response.json()).placement;
  await expect(page.getByTestId("exam-integrity-active")).toBeVisible();
  await expect(page.locator(".placement-question")).toBeVisible();
  return placement;
}

async function selectPlacementDraft(page: Page, placement: PlacementState) {
  const saved = apiResponse(page, `/api/placement/${placement.id}/draft`);
  await page.getByRole("radio").first().check();
  expect((await saved).ok()).toBeTruthy();
  await expect(page.getByRole("button", { name: "Câu tiếp theo", exact: true })).toBeEnabled();
}

async function visibility(page: Page, state: "hidden" | "visible") {
  // Headless Chromium does not reliably hide a page when another page opens.
  // Exercise the browser's visibility listener, not the application's internals.
  await page.evaluate((value) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => value });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
}

async function cancelled(page: Page) {
  await expect(page.getByRole("heading", { name: "Bài thi đã bị hủy", exact: true })).toBeVisible();
  await expect(page.locator(".placement-question, .writing-workspace")).toHaveCount(0);
  await expect(page.locator(".answer-review, .feedback-summary")).toHaveCount(0);
}

test("placement requires consent before creation and ignores a harmless focus change", async ({ page, duoServer }) => {
  await duoLogin(page, duoServer, 0);
  await page.goto("/placement");
  await page.getByRole("button", { name: "Bắt đầu kiểm tra nhanh", exact: true }).click();
  const rules = page.getByRole("dialog", { name: "Quy định phòng thi", exact: true });
  await expect(rules).toBeVisible();
  expect(await duoServer.database.placements.countDocuments({})).toBe(0);
  expect(await duoServer.database.db.collection("exam_integrity_sessions").countDocuments({})).toBe(0);
  await rules.getByRole("button", { name: "Quay lại", exact: true }).click();
  expect(await duoServer.database.placements.countDocuments({})).toBe(0);

  const opened = apiResponse(page, "/api/exam-integrity/open");
  const placement = await startPlacement(page);
  const openResponse = await opened;
  expect(openResponse.ok()).toBeTruthy();
  const body = openResponse.request().postDataJSON();
  expect(body).toMatchObject({ kind: "placement", resourceId: placement.id });
  expect(body.tabId).toMatch(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  expect(openResponse.request().headers()["x-exam-tab"]).toBe(body.tabId);
  const session: ExamIntegritySession = (await openResponse.json()).session;
  const heartbeat = apiResponse(page, `/api/exam-integrity/${session.id}/heartbeat`);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  expect((await heartbeat).ok()).toBeTruthy();
  await expect(page.getByRole("heading", { name: "Bài thi đã bị hủy", exact: true })).toHaveCount(0);
  expect((await duoServer.database.placements.findOne({ _id: placement.id }))?.currentQuestionId).toBe(placement.question!.id);
});

test("hidden placement erases answers, blocks stale writes, and restarts with unseen material", async ({ page, duoServer }) => {
  await duoLogin(page, duoServer, 0);
  await page.goto("/placement");
  const opened = apiResponse(page, "/api/exam-integrity/open");
  const initial = await startPlacement(page);
  const oldTab = (await opened).request().postDataJSON().tabId;
  const record = await duoServer.database.placements.findOne({ _id: initial.id });
  const profileBefore = await duoServer.database.users.findOne({ _id: record!.userId });
  await selectPlacementDraft(page, initial);
  const answered = apiResponse(page, `/api/placement/${initial.id}/answer`);
  await page.getByRole("button", { name: "Câu tiếp theo", exact: true }).click();
  const second: PlacementState = (await (await answered).json()).placement;
  await selectPlacementDraft(page, second);
  const violation = page.waitForResponse((response) => response.url().endsWith("/violation"));
  await visibility(page, "hidden");
  expect((await violation).ok()).toBeTruthy();
  await cancelled(page);
  await expect.poll(async () => (await duoServer.database.placements.findOne({ _id: initial.id }))?.completionReason).toBe("invalidated");
  const invalid = await duoServer.database.placements.findOne({ _id: initial.id });
  expect(invalid).toMatchObject({ answers: [], draftAnswer: null, currentQuestionId: null, result: null, integrityReason: "hidden" });
  expect(invalid?.invalidatedAt).toBeTruthy();
  for (const operation of ["draft", "answer"]) {
    const denied = await page.request.post(`/api/placement/${initial.id}/${operation}`, {
      headers: { "X-Exam-Tab": oldTab },
      data: { questionId: second.question!.id, answer: second.question!.options[0] },
    });
    expect(denied.status()).toBe(409);
  }
  const review = await page.request.get(`/api/placement/${initial.id}`);
  expect((await review.json()).placement).toMatchObject({ completionReason: "invalidated", question: null, result: null });
  const profileAfter = await duoServer.database.users.findOne({ _id: record!.userId });
  expect(profileAfter!.currentBand).toBe(profileBefore!.currentBand);
  await visibility(page, "visible");
  await page.getByRole("button", { name: "Bắt đầu lượt mới", exact: true }).click();
  const fresh = await startPlacement(page);
  expect(fresh.id).not.toBe(initial.id);
  expect([initial.question!.id, second.question!.id]).not.toContain(fresh.question!.id);
  expect(fresh.question!.text).not.toBe(initial.question!.text);
  expect(fresh.completed).toBe(0);
  await expect(page.getByTestId("exam-integrity-active")).toBeVisible();
});

test("an authenticated second app tab cancels placement even on the dashboard", async ({ page, duoServer }) => {
  await duoLogin(page, duoServer, 0);
  await page.goto("/placement");
  const placement = await startPlacement(page);
  // Keep the first page visible so this proves peer detection independently of
  // the visibility rule. Both pages still share the real cookie/storage jar.
  await visibility(page, "visible");
  const second = await page.context().newPage();
  try {
    await second.goto(`${duoServer.url}/dashboard`);
    await expect(second.locator(".main-content")).toBeVisible();
    await cancelled(page);
    await expect.poll(async () => (await duoServer.database.placements.findOne({ _id: placement.id }))?.integrityReason).toBe("duplicate-tab");
  } finally {
    await second.close();
  }
});

for (const departure of ["reload", "close"] as const) {
  test(`document ${departure} cancels placement instead of resuming its draft`, async ({ page, duoServer }) => {
    await duoLogin(page, duoServer, 0);
    await page.goto("/placement");
    const placement = await startPlacement(page);
    await selectPlacementDraft(page, placement);
    if (departure === "reload") await page.reload();
    else await page.close({ runBeforeUnload: true });
    await expect.poll(async () => (await duoServer.database.placements.findOne({ _id: placement.id }))?.completionReason).toBe("invalidated");
    const record = await duoServer.database.placements.findOne({ _id: placement.id });
    expect(record).toMatchObject({ currentQuestionId: null, answers: [], draftAnswer: null, result: null });
    if (departure === "reload") {
      await expect(page.locator(".placement-question")).toHaveCount(0);
      await expect(page.locator(".answer-review")).toHaveCount(0);
    }
  });
}

test("a completed placement remains valid after hiding and reloading the document", async ({ page, duoServer }) => {
  await duoLogin(page, duoServer, 0);
  await page.goto("/placement");
  const placement = await startPlacement(page);
  // Shorten only this fixture's private run; no synthetic clock or public answer
  // key endpoint is needed to reach an actual server-owned final submission.
  await duoServer.database.placements.updateOne({ _id: placement.id }, { $set: { total: 1 } });
  await selectPlacementDraft(page, placement);
  await page.getByRole("button", { name: "Câu tiếp theo", exact: true }).click();
  await expect(page.locator(".placement-complete")).toBeVisible();
  await expect(page.getByTestId("exam-integrity-active")).toHaveCount(0);
  await visibility(page, "hidden");
  await page.reload();
  const finished = await duoServer.database.placements.findOne({ _id: placement.id });
  expect(finished?.completionReason).toBe("answered");
  expect(finished?.answers).toHaveLength(1);
  expect(finished?.invalidatedAt).toBeUndefined();
  expect(finished?.result).not.toBeNull();
  await expect(page.getByRole("heading", { name: "Bài thi đã bị hủy", exact: true })).toHaveCount(0);
});

test("ordinary practice starts without exam rules and preserves its draft through hiding and reload", async ({ page, duoServer }) => {
  await duoLogin(page, duoServer, 0);
  await page.goto("/library?skill=writing");
  const created = apiResponse(page, "/api/attempts");
  await page.locator(".content-card").first().getByRole("button", { name: "Bắt đầu luyện", exact: true }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  const attempt: Attempt = (await response.json()).attempt;
  expect(attempt.mode).toBe("practice");
  await expect(page.locator(".learning-page")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Quy định phòng thi", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("exam-integrity-active")).toHaveCount(0);
  const editor = page.getByRole("textbox", { name: /^Bài viết Task/ }).first();
  const saved = apiResponse(page, `/api/attempts/${attempt.id}`, "PATCH");
  const draft = "This ordinary practice draft should survive a document reload.";
  await editor.fill(draft);
  expect((await saved).ok()).toBeTruthy();
  await visibility(page, "hidden");
  await page.reload();
  await expect(editor).toHaveValue(draft);
  await expect(editor).toBeEnabled();
  await expect(page.getByTestId("exam-integrity-active")).toHaveCount(0);
  const stored = await duoServer.database.attempts.findOne({ _id: attempt.id });
  expect(stored?.status).toBe("in-progress");
  expect(stored?.invalidatedAt).toBeUndefined();
  expect(await duoServer.database.db.collection("exam_integrity_sessions").countDocuments({})).toBe(0);
});

/** UI transport fixture only: no Duo progression, external AI or learner data. */
async function mockDuoExam(page: Page, status: "in-progress" | "passed" | "pending-ai" = "in-progress", holdSubmission = false) {
  const now = new Date().toISOString();
  const deadline = new Date(Date.now() + 60 * 60_000).toISOString();
  const assessmentId = `synthetic-assessment-${randomUUID()}`;
  const attemptId = `synthetic-attempt-${randomUUID()}`;
  const content: ContentItem = {
    id: `synthetic-content-${randomUUID()}`, title: "Synthetic Writing part", skill: "writing",
    description: "Isolated browser integrity fixture", topic: "Transport", band: 5, cefr: "B1", testType: "academic",
    durationMinutes: 60, format: "lesson", questions: [], vocabularyIds: [], tags: [],
    source: "authored", quality: "authored-unreviewed", createdAt: now,
    sections: [{ id: "synthetic-task-2", title: "Writing Task 2", text: "Discuss how cities can improve public transport.", task: 2 }],
  };
  const attempt: Attempt = {
    id: attemptId, duoAssessmentId: assessmentId, contentId: content.id, title: content.title, skill: "writing", mode: "exam",
    status: status === "in-progress" ? "in-progress" : "submitted", startedAt: now, deadlineAt: deadline,
    submittedAt: status === "in-progress" ? null : now, durationSeconds: 0, responses: {}, essays: {}, transcript: "",
    feedback: null, content, audioAvailable: false,
  };
  const assessment: DuoAssessmentView = {
    id: assessmentId, kind: "promotion", band: 5, gateId: null, roomId: null, status,
    parts: [{ contentId: content.id, title: content.title, skill: "writing", attemptId: null, status,
      scorePercent: null, estimatedBand: null, startsAt: now, deadlineAt: deadline }],
    passPercent: 80, requiredBand: 5, deadlineAt: deadline, createdAt: now,
    completedAt: status === "in-progress" ? null : now, serverNow: now,
  };
  const session: ExamIntegritySession = { id: randomUUID(), kind: "assessment", resourceId: assessmentId, status: "active", leaseSeconds: 25 };
  const violations: string[] = [];
  const opens: unknown[] = [];
  let markSubmitting!: () => void, releaseSubmission!: () => void;
  const submitting = new Promise<void>((resolve) => { markSubmitting = resolve; });
  const released = new Promise<void>((resolve) => { releaseSubmission = resolve; });
  const fulfill = (route: Route, body: unknown) => route.fulfill({ json: body });
  await page.route("**/api/exam-integrity/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/open")) {
      const body = route.request().postDataJSON();
      expect(body).toMatchObject({ kind: "assessment", resourceId: assessmentId });
      opens.push(body);
    } else if (path.endsWith("/violation")) {
      const body = route.request().postDataJSON();
      violations.push(body.reason);
      session.status = "invalidated";
      session.reason = body.reason;
    }
    await fulfill(route, { enabled: true, session });
  });
  await page.route(`**/api/duo/assessments/${assessmentId}`, (route) => fulfill(route, { assessment }));
  await page.route("**/api/attempts", async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ contentId: content.id, mode: "exam", duoAssessmentId: assessmentId });
    assessment.parts[0].attemptId = attemptId;
    await fulfill(route, { attempt });
  });
  await page.route(`**/api/attempts/${attemptId}`, async (route) => {
    if (route.request().method() === "PATCH") Object.assign(attempt, route.request().postDataJSON());
    await fulfill(route, { attempt });
  });
  await page.route(`**/api/attempts/${attemptId}/submit`, async (route) => {
    markSubmitting();
    if (holdSubmission) await released;
    attempt.status = "submitted";
    attempt.submittedAt = new Date().toISOString();
    assessment.status = "pending-ai";
    assessment.parts[0].status = "pending-ai";
    assessment.completedAt = attempt.submittedAt;
    session.status = "completed";
    await fulfill(route, { attempt });
  });
  return { assessmentId, attemptId, attempt, assessment, session, violations, opens, submitting, releaseSubmission };
}

async function mockSharedRoom(page: Page, options: {
  companion?: boolean;
  status?: "waiting" | "countdown" | "in-progress";
  requiresPresence?: boolean;
} = {}) {
  const exam = await mockDuoExam(page);
  const now = new Date().toISOString();
  const roomId = `synthetic-room-${randomUUID()}`;
  const status = options.status ?? "in-progress";
  const companion = options.companion ?? false;
  const room: DuoRoomView & { requiresPresence: boolean } = {
    id: roomId, band: 5, status, serverNow: now,
    startsAt: status === "waiting" ? null : new Date(Date.now() + (status === "countdown" ? 60_000 : -1_000)).toISOString(),
    deadlineAt: status === "waiting" ? null : exam.assessment.deadlineAt,
    countdownSeconds: 60, presenceTimeoutSeconds: 25,
    requiresPresence: options.requiresPresence ?? true,
    members: {
      husband: { joined: true, present: true, ready: true, companion, lastSeenAt: now, assessmentId: companion ? null : exam.assessmentId },
      wife: { joined: true, present: true, ready: status !== "waiting", companion: false, lastSeenAt: now, assessmentId: "synthetic-partner-assessment" },
    },
  };
  exam.assessment.roomId = roomId;
  const duo: DuoSnapshot = {
    role: "husband", duoId: "synthetic-room-duo", status: "BAND_EXAM_IN_PROGRESS",
    path: { id: "synthetic-room-path", startingBand: 5, currentBand: 5, targetBand: 8, gateInterval: 5,
      sessionsPerBand: 10, passPercent: 80, strictRetakeMode: false, startedAt: now },
    members: [
      { id: "synthetic-room-husband", name: "Người học Một", role: "husband", placementBand: 5, personalEstimatedBand: 5 },
      { id: "synthetic-room-wife", name: "Người học Hai", role: "wife", placementBand: 5, personalEstimatedBand: 5 },
    ],
    bands: [{ band: 5, unlocked: true, completed: false, lessons: [], gates: [], promotionEligible: true,
      promotionResults: { husband: companion ? "passed" : null, wife: null } }],
    room, assessments: [exam.assessment],
  };
  const leaves: string[] = [];
  let heartbeats = 0;
  let roomReads = 0;
  await page.route("**/api/duo", (route) => route.fulfill({ json: { duo } }));
  await page.route(`**/api/duo/rooms/${roomId}`, (route) => {
    roomReads++;
    room.serverNow = new Date().toISOString();
    return route.fulfill({ json: { room } });
  });
  await page.route(`**/api/duo/rooms/${roomId}/*`, async (route) => {
    room.serverNow = new Date().toISOString();
    const action = new URL(route.request().url()).pathname.split("/").at(-1);
    if (action === "heartbeat") heartbeats++;
    if (action === "leave") {
      const body = route.request().postDataJSON() as { reason?: string } | null;
      leaves.push(body?.reason ?? "missing-reason");
      room.requiresPresence = false;
      if (room.status === "waiting" || room.status === "countdown") {
        room.status = "waiting";
        room.members.husband.ready = false;
        room.startsAt = null;
      } else {
        room.status = "invalidated";
        room.invalidatedAt = new Date().toISOString();
        room.integrityReason = leaves.at(-1);
        exam.assessment.invalidatedAt = room.invalidatedAt;
        exam.assessment.integrityReason = room.integrityReason;
        exam.session.status = "invalidated";
        exam.session.reason = room.integrityReason;
        exam.attempt.status = "invalidated";
        exam.attempt.essays = {};
      }
    }
    if (action === "start") {
      room.status = "in-progress";
      await route.fulfill({ json: { room, assessment: companion ? null : exam.assessment, companion } });
      return;
    }
    await route.fulfill({ json: { room } });
  });
  return { ...exam, room, roomId, leaves, heartbeatCount: () => heartbeats, roomReadCount: () => roomReads };
}

async function leaveForPlan(page: Page) {
  const menu = page.getByRole("button", { name: "Mở menu", exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("navigation", { name: "Điều hướng chính", exact: true })
    .getByRole("link", { name: "Lộ trình của hai người", exact: true }).click();
  await expect(page).toHaveURL(/\/plan$/);
}

test("assessment to part and back preserves one lease; leaving through an app link cancels it", async ({ page, duoServer }) => {
  await duoLogin(page, duoServer, 0);
  const fixture = await mockDuoExam(page);
  await page.goto(`/duo/assessments/${fixture.assessmentId}`);
  await expect(page.getByTestId("exam-integrity-active")).toBeVisible();
  await page.getByRole("button", { name: "Bắt đầu phần này", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Bài viết Task 2", exact: true })).toBeEnabled();
  await page.getByRole("link", { name: "Xem các phần đánh giá", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/duo/assessments/${fixture.assessmentId}$`));
  await expect(page.getByTestId("exam-integrity-active")).toBeVisible();
  expect(fixture.opens).toHaveLength(1);
  expect(fixture.violations).toEqual([]);
  await page.getByRole("link", { name: "Về lộ trình chung", exact: true }).click();
  await expect(page).toHaveURL(/\/plan$/);
  await expect.poll(() => fixture.violations).toEqual(["navigation"]);
});

test("a partner's cancelled session reaches the open part through heartbeat and removes the editor", async ({ page, duoServer }) => {
  await duoLogin(page, duoServer, 0);
  const fixture = await mockDuoExam(page);
  await page.goto(`/duo/assessments/${fixture.assessmentId}`);
  await page.getByRole("button", { name: "Bắt đầu phần này", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Bài viết Task 2", exact: true })).toBeEnabled();
  fixture.session.status = "invalidated";
  fixture.session.reason = "hidden";
  await cancelled(page);
  expect(fixture.violations).toEqual([]);
});

test("a heartbeat request that never returns cannot keep the exam lease alive", async ({ page, duoServer }) => {
  await duoLogin(page, duoServer, 0);
  const fixture = await mockDuoExam(page);
  // Allow the first real five-second heartbeat tick to send its request; the
  // next tick must detect expiry even though that request is still pending.
  fixture.session.leaseSeconds = 8;
  let entered!: () => void, release!: () => void;
  const pending = new Promise<void>((resolve) => { entered = resolve; });
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/exam-integrity/*/heartbeat", async (route) => {
    const staleSession = structuredClone(fixture.session);
    entered();
    await held;
    await route.fulfill({ json: { enabled: true, session: staleSession } });
  });
  await page.goto(`/duo/assessments/${fixture.assessmentId}`);
  await expect(page.getByTestId("exam-integrity-active")).toBeVisible();
  await pending;
  await cancelled(page);
  await expect.poll(() => fixture.violations).toEqual(["heartbeat-lost"]);
  const returned = apiResponse(page, `/api/exam-integrity/${fixture.session.id}/heartbeat`);
  release();
  await returned;
  await cancelled(page);
});

for (const status of ["passed", "pending-ai"] as const) {
  test(`${status} assessment does not open a lease or report visibility and document exit`, async ({ page, duoServer }) => {
    await duoLogin(page, duoServer, 0);
    const fixture = await mockDuoExam(page, status);
    await page.goto(`/duo/assessments/${fixture.assessmentId}`);
    await expect(page.locator(".duo-assessment-summary")).toBeVisible();
    await expect(page.getByTestId("exam-integrity-active")).toHaveCount(0);
    await visibility(page, "hidden");
    await page.reload();
    await expect(page.locator(".duo-assessment-summary")).toBeVisible();
    expect(fixture.opens).toEqual([]);
    expect(fixture.violations).toEqual([]);
    await expect(page.getByRole("heading", { name: "Bài thi đã bị hủy", exact: true })).toHaveCount(0);
  });
}

test("a remounted grading attempt locks its draft and survives hiding and reload until the result arrives", async ({ page, duoServer }) => {
  await duoLogin(page, duoServer, 0);
  const fixture = await mockDuoExam(page);
  fixture.assessment.parts[0].attemptId = fixture.attemptId;
  fixture.session.phase = "grading";
  fixture.session.leaseSeconds = 1;
  fixture.attempt.integrity = { sessionId: fixture.session.id, status: "active", phase: "grading" };
  const draft = "This answer is already accepted by the server and is being graded.";
  fixture.attempt.essays[fixture.attempt.content.sections[0].id] = draft;
  await page.goto(`/learn/${fixture.attemptId}?duoAssessment=${fixture.assessmentId}`);
  const editor = page.getByRole("textbox", { name: "Bài viết Task 2", exact: true });
  await expect(editor).toHaveValue(draft);
  await expect(editor).toBeDisabled();
  await expect(page.getByRole("status").filter({ hasText: "đang chờ máy chủ chấm" })).toBeVisible();
  await expect.poll(() => fixture.opens.length).toBe(1);
  await visibility(page, "hidden");
  await page.reload();
  await expect(editor).toHaveValue(draft);
  await expect(editor).toBeDisabled();
  // An actual heartbeat tick beyond the shortened lease must remain harmless
  // during grading, unlike the stalled answering-phase test above.
  const heartbeat = apiResponse(page, `/api/exam-integrity/${fixture.session.id}/heartbeat`);
  await visibility(page, "hidden");
  expect((await heartbeat).ok()).toBeTruthy();
  fixture.attempt.status = "submitted";
  fixture.attempt.submittedAt = new Date().toISOString();
  fixture.attempt.integrity.status = "completed";
  fixture.session.status = "completed";
  fixture.assessment.status = "pending-ai";
  fixture.assessment.parts[0].status = "pending-ai";
  await expect(page.locator(".attempt-status")).toContainText("Đã nộp");
  expect(fixture.violations).toEqual([]);
  await expect(page.getByRole("heading", { name: "Bài thi đã bị hủy", exact: true })).toHaveCount(0);
});

test("a grading heartbeat that restores answering cancels a still-hidden document", async ({ page, duoServer }) => {
  await duoLogin(page, duoServer, 0);
  const fixture = await mockDuoExam(page);
  fixture.assessment.parts[0].attemptId = fixture.attemptId;
  fixture.session.phase = "grading";
  fixture.attempt.integrity = { sessionId: fixture.session.id, status: "active", phase: "grading" };
  await page.goto(`/learn/${fixture.attemptId}?duoAssessment=${fixture.assessmentId}`);
  await expect(page.getByRole("textbox", { name: "Bài viết Task 2", exact: true })).toBeDisabled();
  await expect.poll(() => fixture.opens.length).toBe(1);
  const gradingHeartbeat = apiResponse(page, `/api/exam-integrity/${fixture.session.id}/heartbeat`);
  await visibility(page, "hidden");
  expect((await gradingHeartbeat).ok()).toBeTruthy();
  expect(fixture.violations).toEqual([]);
  // A provider failure can restore the authoritative lease before the next
  // attempt poll. Keep the attempt snapshot stale to prove the heartbeat itself
  // rechecks the existing hidden state without a second visibility event.
  const restoredHeartbeat = apiResponse(page, `/api/exam-integrity/${fixture.session.id}/heartbeat`);
  fixture.session.phase = "answering";
  expect((await (await restoredHeartbeat).json()).session.phase).toBe("answering");
  await cancelled(page);
  await expect.poll(() => fixture.violations).toEqual(["hidden"]);
});

test("the final submission may wait for AI without a visibility false alarm", async ({ page, duoServer }) => {
  await duoLogin(page, duoServer, 0);
  const fixture = await mockDuoExam(page, "in-progress", true);
  await page.goto(`/duo/assessments/${fixture.assessmentId}`);
  await page.getByRole("button", { name: "Bắt đầu phần này", exact: true }).click();
  await page.getByRole("textbox", { name: "Bài viết Task 2", exact: true }).fill("A synthetic answer saved before final submission.");
  await page.getByRole("button", { name: "Nộp bài & xem phản hồi", exact: true }).click();
  await page.getByRole("dialog", { name: "Nộp bài luyện của bạn?", exact: true }).getByRole("button", { name: "Nộp bài", exact: true }).click();
  await fixture.submitting;
  await visibility(page, "hidden");
  fixture.releaseSubmission();
  await expect(page.locator(".attempt-status")).toContainText("Đã nộp");
  await visibility(page, "visible");
  await page.getByRole("link", { name: "Xem các phần đánh giá", exact: true }).click();
  await expect(page.locator(".duo-assessment-summary")).toContainText("đang chờ chấm AI");
  await expect(page.getByTestId("exam-integrity-active")).toHaveCount(0);
  expect(fixture.violations).toEqual([]);
});

test("a retained companion hiding the shared room cancels it and stops presence heartbeats", async ({ page, duoServer }) => {
  await duoLogin(page, duoServer, 0);
  const fixture = await mockSharedRoom(page, { companion: true });
  const heartbeat = apiResponse(page, `/api/duo/rooms/${fixture.roomId}/heartbeat`);
  await page.goto(`/duo/rooms/${fixture.roomId}`);
  await expect(page.getByRole("heading", { name: "Bạn đang đồng hành", exact: true })).toBeVisible();
  expect((await heartbeat).ok()).toBeTruthy();
  const beatsBeforeHide = fixture.heartbeatCount();
  await visibility(page, "hidden");
  await expect.poll(() => fixture.leaves).toEqual(["hidden"]);
  await cancelled(page);
  // Observe a full real heartbeat period to prove an invisible companion is
  // not kept present by a background request after cancellation.
  await page.waitForTimeout(5_500);
  expect(fixture.heartbeatCount()).toBe(beatsBeforeHide);
  expect(fixture.opens).toEqual([]);
});

for (const status of ["waiting", "countdown"] as const) {
  test(`leaving a ready shared room during ${status} reports navigation before any private assessment starts`, async ({ page, duoServer }) => {
    await duoLogin(page, duoServer, 0);
    const fixture = await mockSharedRoom(page, { status });
    const heartbeat = apiResponse(page, `/api/duo/rooms/${fixture.roomId}/heartbeat`);
    await page.goto(`/duo/rooms/${fixture.roomId}`);
    await expect(page.getByRole("heading", { name: "Phòng thi nâng band 5.0", exact: true })).toBeVisible();
    expect((await heartbeat).ok()).toBeTruthy();
    await leaveForPlan(page);
    await expect.poll(() => fixture.leaves).toEqual(["navigation"]);
    expect(fixture.room).toMatchObject({ status: "waiting", requiresPresence: false, startsAt: null });
    expect(fixture.room.members.husband.ready).toBe(false);
    expect(fixture.assessment.invalidatedAt).toBeUndefined();
    expect(fixture.opens).toEqual([]);
  });
}

test("shared room to assessment to part and back keeps room presence without reporting departure", async ({ page, duoServer }) => {
  await duoLogin(page, duoServer, 0);
  const fixture = await mockSharedRoom(page, { status: "countdown" });
  await page.goto(`/duo/rooms/${fixture.roomId}`);
  await expect(page.getByRole("heading", { name: "Cả hai đã sẵn sàng", exact: true })).toBeVisible();
  fixture.room.startsAt = new Date(Date.now() - 1_000).toISOString();
  await expect(page).toHaveURL(new RegExp(`/duo/assessments/${fixture.assessmentId}$`));
  await page.getByRole("button", { name: "Bắt đầu phần này", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Bài viết Task 2", exact: true })).toBeEnabled();
  const heartbeat = apiResponse(page, `/api/duo/rooms/${fixture.roomId}/heartbeat`);
  await page.getByRole("link", { name: "Xem các phần đánh giá", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/duo/assessments/${fixture.assessmentId}$`));
  expect((await heartbeat).ok()).toBeTruthy();
  expect(fixture.leaves).toEqual([]);
  expect(fixture.violations).toEqual([]);
  expect(fixture.opens).toHaveLength(1);
});

test("an accepted personal final answer still requires room presence while the partner is answering", async ({ page, duoServer }) => {
  await duoLogin(page, duoServer, 0);
  const fixture = await mockSharedRoom(page);
  fixture.session.phase = "grading";
  fixture.attempt.integrity = { sessionId: fixture.session.id, status: "active", phase: "grading" };
  fixture.assessment.parts[0].attemptId = fixture.attemptId;
  await page.goto(`/learn/${fixture.attemptId}?duoAssessment=${fixture.assessmentId}`);
  await expect(page.getByRole("textbox", { name: "Bài viết Task 2", exact: true })).toBeDisabled();
  const heartbeat = apiResponse(page, `/api/duo/rooms/${fixture.roomId}/heartbeat`);
  expect((await heartbeat).ok()).toBeTruthy();
  await visibility(page, "hidden");
  await expect.poll(() => fixture.leaves).toEqual(["hidden"]);
  await cancelled(page);
  expect(fixture.violations).toEqual([]);
});

test("a shared room whose final answers are all accepted releases presence during AI grading", async ({ page, duoServer }) => {
  await duoLogin(page, duoServer, 0);
  const fixture = await mockSharedRoom(page, { requiresPresence: false });
  fixture.session.phase = "grading";
  fixture.session.leaseSeconds = 1;
  fixture.attempt.integrity = { sessionId: fixture.session.id, status: "active", phase: "grading" };
  fixture.assessment.parts[0].attemptId = fixture.attemptId;
  await page.goto(`/learn/${fixture.attemptId}?duoAssessment=${fixture.assessmentId}`);
  await expect(page.getByRole("textbox", { name: "Bài viết Task 2", exact: true })).toBeDisabled();
  await expect.poll(() => fixture.opens.length).toBe(1);
  await expect.poll(() => fixture.roomReadCount()).toBeGreaterThan(0);
  const beatsBeforeHide = fixture.heartbeatCount();
  const heartbeat = apiResponse(page, `/api/exam-integrity/${fixture.session.id}/heartbeat`);
  await visibility(page, "hidden");
  expect((await heartbeat).ok()).toBeTruthy();
  expect(fixture.heartbeatCount()).toBe(beatsBeforeHide);
  expect(fixture.leaves).toEqual([]);
  expect(fixture.violations).toEqual([]);
  await expect(page.getByRole("heading", { name: "Bài thi đã bị hủy", exact: true })).toHaveCount(0);
});

test("a visible grading room restores required presence when an answer needs retrying", async ({ page, duoServer }) => {
  await duoLogin(page, duoServer, 0);
  const fixture = await mockSharedRoom(page, { requiresPresence: false });
  fixture.session.phase = "grading";
  fixture.attempt.integrity = { sessionId: fixture.session.id, status: "active", phase: "grading" };
  fixture.assessment.parts[0].attemptId = fixture.attemptId;
  await page.goto(`/learn/${fixture.attemptId}?duoAssessment=${fixture.assessmentId}`);
  const editor = page.getByRole("textbox", { name: "Bài viết Task 2", exact: true });
  await expect(editor).toBeDisabled();
  await expect.poll(() => fixture.roomReadCount()).toBeGreaterThan(0);
  const gradingHeartbeat = apiResponse(page, `/api/duo/rooms/${fixture.roomId}/heartbeat`);
  expect((await (await gradingHeartbeat).json()).room.requiresPresence).toBe(false);
  expect(fixture.heartbeatCount()).toBeGreaterThan(0);
  await expect(page.getByTestId("exam-integrity-active")).toHaveCount(0);
  expect(fixture.leaves).toEqual([]);
  // All accepted answers release presence, but a later provider failure can
  // reopen one. A visible room heartbeat must discover that change without a
  // remount and restore the exam rules and visibility enforcement.
  const restoredHeartbeat = apiResponse(page, `/api/duo/rooms/${fixture.roomId}/heartbeat`);
  fixture.room.requiresPresence = true;
  fixture.session.phase = "answering";
  fixture.attempt.integrity.phase = "answering";
  expect((await (await restoredHeartbeat).json()).room.requiresPresence).toBe(true);
  await expect(page.getByTestId("exam-integrity-active")).toBeVisible();
  await expect(editor).toBeEnabled();
  expect(fixture.leaves).toEqual([]);
  expect(fixture.violations).toEqual([]);
  const beatsBeforeHide = fixture.heartbeatCount();
  await visibility(page, "hidden");
  await expect.poll(() => fixture.leaves).toEqual(["hidden"]);
  await cancelled(page);
  await page.waitForTimeout(5_500);
  expect(fixture.heartbeatCount()).toBe(beatsBeforeHide);
});
