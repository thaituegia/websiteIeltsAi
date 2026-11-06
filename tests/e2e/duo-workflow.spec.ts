import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  test,
  expect,
  duoAccounts,
  duoLogin,
  duoSnapshot,
  finishPlacement,
  objectiveAttempt,
  fillSimpleObjective,
  submitUi,
  noOverflow,
} from "./duo-fixtures";
import type { DuoAssessmentView, DuoSnapshot } from "../../shared/duo";
import type { Attempt, StoredContent } from "../../shared/types";

// Real Express, MongoDB, bundled React and two separate browser cookie jars.
// Public answers are never fetched: synthetic test fixtures read their isolated DB.
test("phone-only Duo login, independent placement and shared minimum band preserve personal estimates", async ({
  page,
  browser,
  duoServer,
}, testInfo) => {
  await page.goto(`${duoServer.url}/dashboard`);
  await expect(page.getByLabel("Số điện thoại", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Tạo tài khoản", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Học viên 01", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Email", { exact: true })).toHaveCount(0);
  await page.getByLabel("Số điện thoại", { exact: true }).fill("0390000003");
  await page
    .getByLabel("Mật khẩu", { exact: true })
    .fill("invalid-account-password");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await duoLogin(page, duoServer, 0);
  await page.goto(`${duoServer.url}/plan`);
  await expect(
    page.getByRole("heading", {
      name: "Chờ đủ hai kết quả đầu vào",
      exact: true,
    }),
  ).toBeVisible();
  const high = await finishPlacement(page, duoServer, true);
  expect((await duoSnapshot(page)).path).toBeNull();
  const secondContext = await browser.newContext({
    baseURL: duoServer.url,
    viewport: page.viewportSize()!,
  });
  const second = await secondContext.newPage();
  try {
    await duoLogin(second, duoServer, 1);
    const low = await finishPlacement(second, duoServer, false);
    const a = await duoSnapshot(page),
      b = await duoSnapshot(second);
    expect(high.estimatedBand).toBeGreaterThan(low.estimatedBand);
    expect(a.path?.currentBand).toBe(
      Math.min(high.estimatedBand, low.estimatedBand),
    );
    expect(a.path).toEqual(b.path);
    expect(a.path?.targetBand).toBe(8);
    expect(a.members.map((member) => member.placementBand)).toEqual([
      high.estimatedBand,
      low.estimatedBand,
    ]);
    await page.reload();
    await expect(page.locator(".duo-levels")).toContainText(
      a.path!.currentBand.toFixed(1),
    );
    await expect(page.locator(".duo-member").first()).toContainText(
      high.estimatedBand.toFixed(1),
    );
    await noOverflow(page);
    await mkdir(join(process.cwd(), ".local", "screenshots"), {
      recursive: true,
    });
    await page.screenshot({
      path: join(
        process.cwd(),
        ".local",
        "screenshots",
        `duo-${testInfo.project.name}-plan.png`,
      ),
      fullPage: true,
    });
    await page.goto(`${duoServer.url}/settings`);
    await expect(page.getByLabel("Số điện thoại")).toHaveValue(
      duoAccounts[0].phone,
    );
    await expect(page.getByLabel("Mục tiêu band chung")).toHaveValue("8");
    await expect(page.getByLabel("Mục tiêu band chung")).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Xóa lịch sử học", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("combobox", { name: "Reading", exact: true })
      .selectOption("8");
    await page
      .getByRole("button", { name: "Lưu thay đổi", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("Đã cập nhật hồ sơ");
    expect((await duoSnapshot(page)).path).toEqual(a.path);
  } finally {
    await secondContext.close();
  }
});

test("Duo Gate pass is retained, ordinary band8 practice stays open, and promotion starts only with two ready members", async ({
  page,
  browser,
  duoServer,
}) => {
  test.setTimeout(150_000);
  await duoLogin(page, duoServer, 0);
  const secondContext = await browser.newContext({
    baseURL: duoServer.url,
    viewport: page.viewportSize()!,
  });
  const second = await secondContext.newPage();
  try {
    await duoLogin(second, duoServer, 1);
    await finishPlacement(page, duoServer, false);
    await finishPlacement(second, duoServer, false);
    let snapshot = await duoSnapshot(page);
    const band = snapshot.bands.find(
      (item) => item.band === snapshot.path!.currentBand,
    )!;
    await page.goto(`${duoServer.url}/plan`);
    await expect(
      page.getByTestId("duo-lesson-6").getByRole("button"),
    ).toBeDisabled();
    // One complete session through React, including server-owned proof registration.
    const firstLesson = band.lessons[0];
    const source = await duoServer.database.content.findOne({
      _id: firstLesson.contentId!,
    });
    await page
      .getByTestId("duo-lesson-1")
      .getByRole("button", { name: /Bắt đầu buổi học/ })
      .click();
    await fillSimpleObjective(page, source as StoredContent);
    await submitUi(page);
    await page
      .getByRole("button", {
        name: "Ghi nhận hoàn thành buổi học",
        exact: true,
      })
      .click();
    await expect(page.locator(".duo-attempt-context")).toContainText(
      "Đã ghi nhận hoàn thành",
    );
    for (const lesson of band.lessons.slice(0, 5)) {
      for (const learner of [page, second]) {
        if (lesson.id === firstLesson.id && learner === page) continue;
        const attempt = await objectiveAttempt(
          learner,
          duoServer,
          lesson.contentId!,
        );
        const response = await learner.request.post(
          `/api/duo/lessons/${lesson.id}/complete`,
          { data: { attemptId: attempt.id } },
        );
        expect(response.ok(), await response.text()).toBeTruthy();
      }
    }
    const gate = (await duoSnapshot(page)).bands.find(
      (item) => item.band === band.band,
    )!.gates[0];
    await page.goto(`${duoServer.url}/plan`);
    await page
      .getByRole("button", { name: "Làm Duo Gate", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: `Duo Gate · Band ${band.band.toFixed(1)}`,
        exact: true,
      }),
    ).toBeVisible();
    const assessmentId = page.url().split("/").at(-1)!;
    let assessment: DuoAssessmentView = (
      await (
        await page.request.get(`/api/duo/assessments/${assessmentId}`)
      ).json()
    ).assessment;
    await expect(page.locator(".duo-assessment-summary")).toContainText(`Đợt đề ${assessment.paperRevision}`);
    await expect(page.getByText(/Thời lượng phần:/)).toBeVisible();
    await expect(page.getByText(/Lịch phần thi:/)).toHaveCount(0);
    for (const part of assessment.parts)
      await objectiveAttempt(
        page,
        duoServer,
        part.contentId,
        true,
        assessmentId,
      );
    assessment = (
      await (
        await page.request.get(`/api/duo/assessments/${assessmentId}`)
      ).json()
    ).assessment;
    expect(assessment.status).toBe("passed");
    snapshot = await duoSnapshot(page);
    let current = snapshot.bands.find((item) => item.band === band.band)!;
    expect(current.gates[0].results.husband).toBe("passed");
    expect(current.lessons[5].unlocked).toBe(false);
    await page.goto(`${duoServer.url}/plan`);
    await expect(page.locator(".duo-gate")).toContainText(
      "Bạn đã đạt và được bảo lưu",
    );
    const beginWife = await second.request.post(
      `/api/duo/gates/${gate.id}/start`,
    );
    expect(beginWife.ok()).toBeTruthy();
    let wifeAssessment: DuoAssessmentView = (await beginWife.json()).assessment;
    expect(wifeAssessment.parts.map(part => part.contentId)).toEqual(assessment.parts.map(part => part.contentId));
    expect(wifeAssessment.paperRevision).toBe(assessment.paperRevision);
    for (const part of wifeAssessment.parts)
      await objectiveAttempt(
        second,
        duoServer,
        part.contentId,
        false,
        wifeAssessment.id,
      );
    expect(
      (await duoSnapshot(page)).bands.find((item) => item.band === band.band)!
        .gates[0].results,
    ).toEqual({ husband: "passed", wife: "failed" });
    const retry = await second.request.post(`/api/duo/gates/${gate.id}/start`);
    expect(retry.ok()).toBeTruthy();
    wifeAssessment = (await retry.json()).assessment;
    for (const part of wifeAssessment.parts)
      await objectiveAttempt(
        second,
        duoServer,
        part.contentId,
        true,
        wifeAssessment.id,
      );
    current = (await duoSnapshot(page)).bands.find(
      (item) => item.band === band.band,
    )!;
    expect(current.gates[0].unlocked).toBe(true);
    expect(current.lessons[5].unlocked).toBe(true);
    // Ordinary advanced practice is available even before the shared band advances.
    await second.goto(`${duoServer.url}/library`);
    await second.getByLabel("Band bài tập", { exact: true }).selectOption("8");
    await expect(second.locator(".content-card").first()).toBeVisible();
    await second
      .locator(".content-card")
      .first()
      .getByRole("button", { name: /Bắt đầu/ })
      .click();
    await expect(second.locator(".learning-page")).toBeVisible();
    await expect(second.locator("details.practice-band-guide")).toBeVisible();
    await second.locator("details.practice-band-guide summary").click();
    await expect(second.locator("details.practice-band-guide")).toHaveAttribute(
      "open",
      "",
    );
    const advancedAttemptId = second.url().split("/learn/")[1].split("?")[0];
    const advancedAttempt: Attempt = (
      await (
        await second.request.get(`/api/attempts/${advancedAttemptId}`)
      ).json()
    ).attempt;
    const standaloneExam = await second.request.post("/api/attempts", {
      data: { contentId: advancedAttempt.contentId, mode: "exam" },
    });
    expect(standaloneExam.ok(), await standaloneExam.text()).toBeTruthy();
    const standaloneExamAttempt: Attempt = (await standaloneExam.json())
      .attempt;
    await second.goto(`${duoServer.url}/learn/${standaloneExamAttempt.id}`);
    await expect(second.locator(".learning-page")).toBeVisible();
    await expect(second.locator("details.practice-band-guide")).toHaveCount(0);
    expect((await duoSnapshot(second)).path?.currentBand).toBe(band.band);
    for (const lesson of current.lessons.slice(5))
      for (const learner of [page, second]) {
        const attempt = await objectiveAttempt(
          learner,
          duoServer,
          lesson.contentId!,
        );
        const response = await learner.request.post(
          `/api/duo/lessons/${lesson.id}/complete`,
          { data: { attemptId: attempt.id } },
        );
        expect(response.ok(), await response.text()).toBeTruthy();
      }
    await page.goto(`${duoServer.url}/plan`);
    await page
      .getByRole("button", { name: "Mở phòng thi nâng band", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Chờ hai người cùng sẵn sàng",
        exact: true,
      }),
    ).toBeVisible();
    const roomId = page.url().split("/").at(-1)!;
    await page
      .getByRole("button", { name: "Tôi đã sẵn sàng", exact: true })
      .click();
    expect(
      (await page.request.post(`/api/duo/rooms/${roomId}/start`)).status(),
    ).toBe(403);
    const alone = (
      await (await page.request.get(`/api/duo/rooms/${roomId}`)).json()
    ).room;
    expect(alone.status).toBe("waiting");
    expect(alone.startsAt).toBeNull();
    await second.goto(`${duoServer.url}/duo/rooms/${roomId}`);
    await second
      .getByRole("button", { name: "Tôi đã sẵn sàng", exact: true })
      .click();
    await expect(page).toHaveURL(/\/duo\/assessments\//, { timeout: 15_000 });
    await expect(second).toHaveURL(/\/duo\/assessments\//, { timeout: 15_000 });
    const aId = page.url().split("/").at(-1)!,
      bId = second.url().split("/").at(-1)!;
    expect(aId).not.toBe(bId);
    const aBody: DuoAssessmentView = (
      await (await page.request.get(`/api/duo/assessments/${aId}`)).json()
    ).assessment;
    const bBody: DuoAssessmentView = (
      await (await second.request.get(`/api/duo/assessments/${bId}`)).json()
    ).assessment;
    expect(aBody.deadlineAt).toBe(bBody.deadlineAt);
    expect(aBody.parts.length).toBe(4);
    expect(
      (await second.request.get(`/api/duo/assessments/${aId}`)).status(),
    ).toBe(404);
    await page
      .getByRole("button", { name: "Bắt đầu phần này", exact: true })
      .first()
      .click();
    await expect(page.locator(".learning-page")).toBeVisible();
    const ownAttempt = page.url().split("/learn/")[1].split("?")[0];
    const before: Attempt = (
      await (await page.request.get(`/api/attempts/${ownAttempt}`)).json()
    ).attempt;
    await page.reload();
    await expect(page.locator(".learning-page")).toBeVisible();
    const after: Attempt = (
      await (await page.request.get(`/api/attempts/${ownAttempt}`)).json()
    ).attempt;
    expect(after.deadlineAt).toBe(before.deadlineAt);
    expect(
      (await second.request.get(`/api/attempts/${ownAttempt}`)).status(),
    ).toBe(404);
    expect((await duoSnapshot(page)).path?.currentBand).toBe(band.band);
    await noOverflow(page);
    await noOverflow(second);
  } finally {
    await secondContext.close();
  }
});
