import type { PlacementRecord, UserRecord } from "../../server/storage";
import type { PlacementItem, PlacementState } from "../../shared/types";
import {
  test,
  expect,
  loginDemo,
  navigate,
  noHorizontalOverflow,
} from "./fixtures";

function exactOption(answer: string): RegExp {
  const escaped = answer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^(?:[A-Z]\\s+)?${escaped}$`);
}

function expectActiveWithoutKeys(state: PlacementState): void {
  expect(state.question).not.toBeNull();
  expect(state.result).toBeNull();
  expect(state.question).not.toHaveProperty("answer");
  expect(state.question).not.toHaveProperty("explanation");
  expect(state.question).not.toHaveProperty("difficulty");
}

test("placement saves a radio draft across reload and automatically reviews only the served question at expiry", async ({ page, db }) => {
  await loginDemo(page);
  const started = await page.request.post("/api/placement/start", {
    data: { mode: "quick" },
  });
  expect(started.status()).toBe(201);
  const initial: PlacementState = (await started.json()).placement;
  expectActiveWithoutKeys(initial);
  expect(initial.total).toBe(15);
  expect(initial.completed).toBe(0);
  expect(initial.deadlineAt).toBeTruthy();
  expect(initial.serverNow).toBeTruthy();
  // Compare server timestamps, avoiding dependence on the browser clock.
  const allowance = Date.parse(initial.deadlineAt!) - Date.parse(initial.serverNow!);
  expect(allowance).toBeGreaterThan(1_195_000);
  expect(allowance).toBeLessThanOrEqual(1_200_000);

  const placement = db.collection<PlacementRecord>("placements");
  const record = await placement.findOne({ _id: initial.id });
  expect(record).not.toBeNull();
  const profileBefore = await db.collection<UserRecord>("users").findOne({
    _id: record!.userId,
  });
  expect(profileBefore).not.toBeNull();
  const source = await db.collection<PlacementItem>("placementItems").findOne({
    id: initial.question!.id,
  });
  if (!source) throw new Error("Missing placement source in isolated E2E database");

  await navigate(page, "/placement");
  await expect(page.getByText("Câu 1 / 15", { exact: true })).toBeVisible();
  const timer = page.getByRole("timer", {
    name: "Thời gian bài kiểm tra còn lại",
  });
  await expect(timer).toBeVisible();
  await expect(page.locator(".answer-review")).toHaveCount(0);

  const draftSaved = page.waitForResponse((response) =>
    response.url().endsWith(`/api/placement/${initial.id}/draft`) &&
    response.request().method() === "POST",
  );
  const selected = page.getByRole("radio", { name: exactOption(source.answer) });
  await selected.check();
  const draftResponse = await draftSaved;
  expect(draftResponse.ok()).toBeTruthy();
  const draft: PlacementState = (await draftResponse.json()).placement;
  expectActiveWithoutKeys(draft);
  expect(draft.deadlineAt).toBe(initial.deadlineAt);
  expect(draft.draftAnswer).toBe(source.answer);
  await expect(page.getByRole("button", { name: "Câu tiếp theo", exact: true })).toBeEnabled();
  const saved = await placement.findOne({ _id: initial.id });
  expect(saved!.answers).toHaveLength(0);
  expect(saved!.draftAnswer).toEqual({ questionId: source.id, answer: source.answer });

  const reloadedState = page.waitForResponse((response) =>
    response.url().endsWith("/api/placement/active") &&
    response.request().method() === "GET",
  );
  await page.reload();
  const resumed: PlacementState = (await (await reloadedState).json()).placement;
  expectActiveWithoutKeys(resumed);
  expect(resumed.id).toBe(initial.id);
  expect(resumed.deadlineAt).toBe(initial.deadlineAt);
  expect(resumed.draftAnswer).toBe(source.answer);
  await expect(selected).toBeChecked();
  await expect(timer).toBeVisible();
  await expect(page.locator(".answer-review")).toHaveCount(0);
  await noHorizontalOverflow(page);

  // Only this run's private placement is shortened. The browser must poll the
  // server on expiry; the test does not call an API that would settle it first.
  const shortenedDeadline = new Date(Date.now() + 2_500).toISOString();
  expect((await placement.updateOne(
    { _id: initial.id, userId: record!.userId },
    { $set: { deadlineAt: shortenedDeadline } },
  )).modifiedCount).toBe(1);
  const automaticExpiry = page.waitForResponse((response) =>
    response.url().endsWith(`/api/placement/${initial.id}`) &&
    response.request().method() === "GET",
  );
  await page.reload();
  await expect(timer).toBeVisible();
  await expect(selected).toBeChecked();
  const expiryResponse = await automaticExpiry;
  expect(expiryResponse.ok()).toBeTruthy();
  const expired: PlacementState = (await expiryResponse.json()).placement;
  expect(expired.question).toBeNull();
  expect(expired.completionReason).toBe("deadline");
  expect(expired.deadlineAt).toBe(shortenedDeadline);
  expect(expired.completed).toBe(1);
  expect(expired.result?.estimatedBand).toBeNull();
  expect(expired.result?.answers.map((answer) => answer.questionId)).toEqual([source.id]);
  expect(expired.result?.answers[0]).toMatchObject({
    answer: source.answer,
    response: source.answer,
    correct: true,
    questionNumber: 1,
  });

  await expect(timer).toHaveCount(0);
  await expect(page.locator(".placement-question")).toHaveCount(0);
  await expect(page.locator(".feedback-summary")).toContainText(
    "chưa đủ dữ liệu xác định trình độ",
  );
  const review = page.locator(".answer-review");
  await expect(review.locator(":scope > details")).toHaveCount(1);
  await expect(review).toContainText(source.question);
  await expect(review).toContainText(source.explanation);
  await expect(review.locator(".answer-correct-value")).toContainText(source.answer);
  await expect(review.locator(".answer-comparison")).toContainText("Bạn trả lời:");
  await review.getByRole("button", {
    name: "Xem nội dung gốc / transcript",
    exact: true,
  }).click();
  await expect(review.locator(".answer-context > div")).toContainText(source.text);
  await noHorizontalOverflow(page);

  const completed = await placement.findOne({ _id: initial.id });
  expect(completed!.currentQuestionId).toBeNull();
  expect(completed!.completionReason).toBe("deadline");
  expect(completed!.answers).toHaveLength(1);
  expect(completed!.draftAnswer).toBeNull();
  const profileAfter = await db.collection<UserRecord>("users").findOne({
    _id: record!.userId,
  });
  expect(profileAfter!.currentBand).toBe(profileBefore!.currentBand);

  // An owner can reopen the persisted review without fabricating the other
  // fourteen, unserved questions or extending the expired deadline.
  await navigate(page, `/placement?review=${initial.id}`);
  await expect(review.locator(":scope > details")).toHaveCount(1);
  await expect(review).toContainText(source.answer);
  await expect(page.locator(".feedback-summary")).toContainText(
    "chưa đủ dữ liệu xác định trình độ",
  );
  await noHorizontalOverflow(page);
});
