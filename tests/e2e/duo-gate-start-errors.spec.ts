import type { Browser, Page } from "@playwright/test";
import type { PlacementState } from "../../shared/types";
import { test, expect, duoLogin, duoSnapshot, objectiveAttempt, noOverflow, type DuoBrowserServer } from "./duo-fixtures";

test.use({ integrityEnabled: true });

// The ordinary placement fixture omits monitoring headers. Keep this setup on
// the real strict routes, using the browser document's own captured identity.
async function finishMonitoredPlacement(page: Page, server: DuoBrowserServer, index: 0 | 1) {
  let tabId = "";
  const capture = (request: import("@playwright/test").Request) => {
    tabId = request.headers()["x-exam-tab"] || tabId;
  };
  page.on("request", capture);
  try {
    await duoLogin(page, server, index);
    expect(tabId).toMatch(/^[A-Za-z0-9_-]{8,80}$/u);
    const headers = { "X-Exam-Tab": tabId };
    let response = await page.request.post("/api/placement/start", { headers, data: { mode: "quick" } });
    expect(response.ok(), await response.text()).toBeTruthy();
    let placement: PlacementState = (await response.json()).placement;
    while (placement.question) {
      const source = await server.database.placementItems.findOne({ _id: placement.question.id });
      expect(source).toBeTruthy();
      const answer = source!.options.find(option => option !== source!.answer)!;
      response = await page.request.post(`/api/placement/${placement.id}/answer`, {
        headers, data: { questionId: placement.question.id, answer },
      });
      expect(response.ok(), await response.text()).toBeTruthy();
      placement = (await response.json()).placement;
    }
    expect(placement.result).toBeTruthy();
  } finally { page.off("request", capture); }
}

async function eligibleGate(page: Page, browser: Browser, server: DuoBrowserServer) {
  const otherContext = await browser.newContext({ baseURL: server.url, viewport: page.viewportSize()! });
  const other = await otherContext.newPage();
  try {
    await finishMonitoredPlacement(page, server, 0);
    await finishMonitoredPlacement(other, server, 1);
    const snapshot = await duoSnapshot(page);
    const band = snapshot.bands.find(entry => entry.band === snapshot.path!.currentBand)!;
    for (const lesson of band.lessons.slice(0, 5)) {
      expect(lesson.contentId).toBeTruthy();
      for (const learner of [page, other]) {
        const attempt = await objectiveAttempt(learner, server, lesson.contentId!);
        const response = await learner.request.post(`/api/duo/lessons/${lesson.id}/complete`, { data: { attemptId: attempt.id } });
        expect(response.ok(), await response.text()).toBeTruthy();
      }
    }
    const ready = await duoSnapshot(page);
    const gate = ready.bands.find(entry => entry.band === band.band)!.gates[0]!;
    expect(gate.eligible).toBe(true);
    await page.goto("/plan");
    await page.getByRole("button", { name: "Làm Duo Gate", exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "Quy định phòng thi", exact: true });
    await expect(dialog).toBeVisible();
    return { gate, band, dialog };
  } finally { await otherContext.close(); }
}

test("an exhausted Gate error stays inside its rules dialog and the next click opens a real guarded sitting", async ({ page, browser, duoServer }) => {
  test.setTimeout(90_000);
  const { gate, band, dialog } = await eligibleGate(page, browser, duoServer);
  const notice = "Đã dùng hết đề riêng chưa làm cho kỹ năng này. Cần bổ sung đề mới trước khi thi lại.";
  let starts = 0;
  await page.route(`**/api/duo/gates/${encodeURIComponent(gate.id)}/start`, async route => {
    if (++starts === 1) await route.fulfill({ status: 409, json: { error: notice, code: "DUO_GATE_PAPERS_EXHAUSTED" } });
    else await route.continue();
  });
  const assessments = duoServer.database.db.collection("duo_assessments");
  const before = await assessments.countDocuments();
  await dialog.getByRole("button", { name: "Tôi hiểu, bắt đầu bài thi", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("alert")).toHaveText(notice);
  await expect(dialog.getByRole("alert")).toBeInViewport();
  const retry = dialog.getByRole("button", { name: "Thử mở lại", exact: true });
  await expect(retry).toBeEnabled();
  await expect(page).toHaveURL(/\/plan$/u);
  expect(await assessments.countDocuments()).toBe(before);
  await noOverflow(page);
  const started = page.waitForResponse(response => new URL(response.url()).pathname === `/api/duo/gates/${encodeURIComponent(gate.id)}/start` && response.request().method() === "POST");
  await retry.click();
  const response = await started;
  expect(response.status()).toBe(200);
  const { assessment } = await response.json();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/duo/assessments/${assessment.id}$`, "u"));
  await expect(page.getByRole("heading", { name: `Duo Gate · Band ${band.band.toFixed(1)}`, exact: true })).toBeVisible();
  await expect(page.getByTestId("exam-integrity-active")).toBeVisible();
  expect(starts).toBe(2);
  expect(await assessments.countDocuments()).toBe(before + 1);
  expect(await duoServer.database.db.collection("exam_integrity_sessions").findOne({ resourceId: assessment.id, status: "active" })).toBeTruthy();
});

test("a partner's active-paper conflict remains visible and retryable without dismissing the Gate dialog", async ({ page, browser, duoServer }) => {
  test.setTimeout(90_000);
  const { gate, dialog } = await eligibleGate(page, browser, duoServer);
  const notice = "Người còn lại đang làm bộ đề này. Hãy đợi người đó nộp bài rồi mới mở lượt thi lại; bài đang làm vẫn được giữ.";
  let starts = 0;
  await page.route(`**/api/duo/gates/${encodeURIComponent(gate.id)}/start`, async route => {
    starts++;
    await route.fulfill({ status: 409, json: { error: notice } });
  });
  const assessments = duoServer.database.db.collection("duo_assessments");
  const before = await assessments.countDocuments();
  await dialog.getByRole("button", { name: "Tôi hiểu, bắt đầu bài thi", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText(notice);
  await expect(dialog.getByRole("alert")).toBeInViewport();
  const retry = dialog.getByRole("button", { name: "Thử mở lại", exact: true });
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("alert")).toHaveText(notice);
  await expect(retry).toBeEnabled();
  expect(starts).toBe(2);
  expect(await assessments.countDocuments()).toBe(before);
  await expect(page).toHaveURL(/\/plan$/u);
  await noOverflow(page);
  await dialog.getByRole("button", { name: "Quay lại", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".main-content")).toBeVisible();
  await expect(page.getByRole("button", { name: "Làm Duo Gate", exact: true }).first()).toBeEnabled();
});
