import type { Locator, Page } from "@playwright/test";
import type { Attempt, StoredContent } from "../../shared/types";
import type { DuoBrowserServer } from "./duo-fixtures";
import { test, expect, duoLogin, duoSnapshot, fillSimpleObjective, finishPlacement, noOverflow, objectiveAttempt, submitUi } from "./duo-fixtures";

async function libraryCard(page: Page, content: StoredContent): Promise<Locator> {
  await page.goto("/library");
  await page.getByRole("textbox", { name: "Tìm bài tập", exact: true }).fill(content.title);
  await page.getByRole("button", { name: "Tìm", exact: true }).click();
  const card = page.locator("article.content-card").filter({
    has: page.getByRole("heading", { name: content.title, exact: true }),
  });
  await expect(card).toBeVisible();
  return card;
}

async function completedDialog(page: Page, card: Locator): Promise<Locator> {
  await card.getByRole("button", { name: "Đã hoàn thành · Xem lựa chọn", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Bạn đã hoàn thành bài này", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function getAttempt(page: Page, attemptId: string): Promise<Attempt> {
  const response = await page.request.get(`/api/attempts/${attemptId}`);
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()).attempt;
}

async function lesson(server: DuoBrowserServer): Promise<StoredContent> {
  const content = await server.database.content.findOne({
    skill: "reading", format: "lesson", testType: { $in: ["academic", "both"] },
  });
  if (!content || content.questions.length < 2) throw new Error("Missing isolated objective lesson");
  return content;
}

// Real cookie authentication, Express and an isolated MongoDB database are used;
// the submitted result and draft count are checked independently of React state.
test("a completed exercise offers review or a blank redo and retains the latest submitted score, including zero", async ({ page, duoServer }) => {
  await duoLogin(page, duoServer, 0);
  const content = await lesson(duoServer);
  const first = await objectiveAttempt(page, duoServer, content.id);
  expect(first.feedback?.rawScore).toBe(content.questions.length);
  const original = await duoServer.database.attempts.findOne({ _id: first.id });
  const count = () => duoServer.database.attempts.countDocuments({ contentId: content.id });
  expect(await count()).toBe(1);

  let card = await libraryCard(page, content);
  await expect(card.getByText("Đã hoàn thành", { exact: true })).toBeVisible();
  await expect(card.locator(".completed-exercise-result strong")).toHaveText(`${content.questions.length}/${content.questions.length} câu đúng`);
  await expect(card.locator(".completed-exercise-result")).toContainText("Lần nộp gần nhất:");
  let dialog = await completedDialog(page, card);
  await expect(dialog).toContainText("1 lượt đã hoàn thành");
  await noOverflow(page);
  await dialog.locator(".completed-exercise-actions").getByRole("button", { name: "Đóng", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await count()).toBe(1);

  dialog = await completedDialog(page, card);
  await dialog.getByRole("button", { name: "Xem kết quả gần nhất", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/learn/${first.id}$`));
  await expect(page.locator(".attempt-status")).toContainText("Đã nộp");
  await expect(page.locator(".answer-review-card")).toBeVisible();
  expect(await count()).toBe(1);
  expect(await duoServer.database.attempts.findOne({ _id: first.id })).toEqual(original);

  card = await libraryCard(page, content);
  dialog = await completedDialog(page, card);
  await dialog.getByRole("button", { name: "Làm lại", exact: true }).click();
  await expect(page).toHaveURL(/\/learn\/[\w-]+$/);
  const redoId = page.url().split("/").at(-1)!;
  expect(redoId).not.toBe(first.id);
  const redo = await getAttempt(page, redoId);
  expect(redo.status).toBe("in-progress");
  expect(redo.responses).toEqual({});
  expect(redo.essays).toEqual({});
  expect(redo.transcript).toBe("");
  await expect(page.locator(".answer-review-card")).toHaveCount(0);
  await expect(page.locator(".practice-question input:checked")).toHaveCount(0);
  expect(await count()).toBe(2);
  expect(await duoServer.database.attempts.findOne({ _id: first.id })).toEqual(original);

  // An unfinished redo must not replace the saved result on the library card.
  card = await libraryCard(page, content);
  await expect(card.locator(".completed-exercise-result strong")).toHaveText(`${content.questions.length}/${content.questions.length} câu đúng`);
  await expect(card).toContainText("Có lượt làm lại đang làm");
  dialog = await completedDialog(page, card);
  await dialog.getByRole("button", { name: "Tiếp tục làm lại", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/learn/${redoId}$`));
  expect(await count()).toBe(2);
  await submitUi(page);
  expect((await getAttempt(page, redoId)).feedback?.rawScore).toBe(0);

  card = await libraryCard(page, content);
  await expect(card.locator(".completed-exercise-result strong")).toHaveText(`0/${content.questions.length} câu đúng`);
  dialog = await completedDialog(page, card);
  await expect(dialog).toContainText("2 lượt đã hoàn thành");
  await dialog.getByRole("button", { name: "Xem kết quả gần nhất", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/learn/${redoId}$`));
  await expect(page.locator(".attempt-status")).toContainText("Đã nộp");
  expect(await duoServer.database.attempts.findOne({ _id: first.id })).toEqual(original);
  await noOverflow(page);

  // This is SPA navigation from /learn/:id to another /learn/:id. A fresh
  // attempt must reset the old review/answers even when React reuses the route.
  await page.getByRole("button", { name: "Làm lại", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Bạn đã hoàn thành bài này", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Làm lại", exact: true }).click();
  await expect(page).toHaveURL(/\/learn\/[\w-]+$/);
  await expect.poll(() => page.url().split("/").at(-1)).not.toBe(redoId);
  const finalId = page.url().split("/").at(-1)!;
  const final = await getAttempt(page, finalId);
  expect(final.status).toBe("in-progress");
  expect(final.responses).toEqual({});
  expect(final.feedback).toBeNull();
  await expect(page.locator(".answer-review-card")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Nộp bài & xem phản hồi", exact: true })).toBeVisible();
  expect(await count()).toBe(3);
  await noOverflow(page);
});

test("redo resumes a saved unfinished attempt without copying a previous submission or creating another draft", async ({ page, duoServer }) => {
  await duoLogin(page, duoServer, 0);
  const content = await lesson(duoServer);
  const first = await objectiveAttempt(page, duoServer, content.id);
  const response = await page.request.post("/api/attempts", { data: { contentId: content.id, mode: "practice" } });
  expect(response.status(), await response.text()).toBe(201);
  const active: Attempt = (await response.json()).attempt;
  const draft = { [content.questions[0].id]: content.questions[0].answer };
  const saved = await page.request.patch(`/api/attempts/${active.id}`, { data: { responses: draft } });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  const original = await duoServer.database.attempts.findOne({ _id: first.id });

  const card = await libraryCard(page, content);
  await expect(card.locator(".completed-exercise-result strong")).toHaveText(`${content.questions.length}/${content.questions.length} câu đúng`);
  const dialog = await completedDialog(page, card);
  await expect(dialog).toContainText("Bạn đang có một lượt làm lại chưa nộp");
  await dialog.getByRole("button", { name: "Tiếp tục làm lại", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/learn/${active.id}$`));
  await expect(page.locator(".learning-page")).toBeVisible();
  const resumed = await getAttempt(page, active.id);
  expect(resumed.responses).toEqual(draft);
  expect(resumed.status).toBe("in-progress");
  expect(await duoServer.database.attempts.countDocuments({ contentId: content.id })).toBe(2);
  expect(await duoServer.database.attempts.findOne({ _id: first.id })).toEqual(original);
  await noOverflow(page);
});

test("redo from a completed Duo lesson keeps the lesson context and updates only its latest proof", async ({ page, browser, duoServer }) => {
  test.setTimeout(120_000);
  await duoLogin(page, duoServer, 0);
  const context = await browser.newContext({ baseURL: duoServer.url, viewport: page.viewportSize()! });
  const partner = await context.newPage();
  try {
    await duoLogin(partner, duoServer, 1);
    await finishPlacement(page, duoServer, false);
    await finishPlacement(partner, duoServer, false);
    const initial = await duoSnapshot(page);
    const band = initial.bands.find(item => item.band === initial.path!.currentBand)!;
    const planLesson = band.lessons[0];
    expect(planLesson.kind).toBe("grammar");
    const content = await duoServer.database.content.findOne({ _id: planLesson.contentId! });
    if (!content) throw new Error("Missing isolated Duo path lesson");
    const first = await objectiveAttempt(page, duoServer, content.id);
    const partnerAttempt = await objectiveAttempt(partner, duoServer, content.id);
    for (const [learner, attempt] of [[page, first], [partner, partnerAttempt]] as const) {
      const response = await learner.request.post(`/api/duo/lessons/${planLesson.id}/complete`, {
        data: { attemptId: attempt.id },
      });
      expect(response.ok(), await response.text()).toBeTruthy();
    }
    const before = await duoSnapshot(page);
    const beforeLesson = before.bands.find(item => item.band === band.band)!.lessons[0];
    expect(beforeLesson.completed).toEqual({ husband: true, wife: true });
    type Proof = { at: string; proofIds: string[]; kind: string; submittedAt?: string; startedAt?: string };
    type Path = { bands: Record<string, { lessons: { id: string; completion: { husband: Proof | null; wife: Proof | null } }[] }> };
    async function storedCompletion() {
      const path = await duoServer.database.db.collection<Path>("duo_learning_paths").findOne({ duoId: before.duoId });
      const record = path && Object.values(path.bands).flatMap(item => item.lessons).find(item => item.id === planLesson.id);
      if (!record) throw new Error("Missing isolated Duo completion proof");
      return record.completion;
    }
    const proofBefore = await storedCompletion();
    expect(proofBefore.husband?.proofIds).toEqual([first.id]);
    expect(proofBefore.wife?.proofIds).toEqual([partnerAttempt.id]);

    await page.goto("/plan");
    await page.getByTestId(`duo-lesson-${planLesson.number}`)
      .getByRole("button", { name: "Đã hoàn thành · Xem / làm lại", exact: true }).click();
    let dialog = page.getByRole("dialog", { name: "Bạn đã hoàn thành bài này", exact: true });
    await expect(dialog).toBeVisible();
    await noOverflow(page);
    await dialog.getByRole("button", { name: "Xem kết quả gần nhất", exact: true }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe(`/learn/${first.id}`);
    expect(new URL(page.url()).searchParams.get("duoLesson")).toBe(planLesson.id);
    await expect(page.locator(".duo-attempt-context")).toContainText("Buổi học trong lộ trình chung");

    await page.getByRole("button", { name: "Làm lại", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Bạn đã hoàn thành bài này", exact: true });
    await dialog.getByRole("button", { name: "Làm lại", exact: true }).click();
    await expect.poll(() => new URL(page.url()).pathname).not.toBe(`/learn/${first.id}`);
    const redoId = new URL(page.url()).pathname.split("/").at(-1)!;
    expect(new URL(page.url()).searchParams.get("duoLesson")).toBe(planLesson.id);
    expect((await getAttempt(page, redoId)).responses).toEqual({});
    await expect(page.locator(".duo-attempt-context")).toContainText("Buổi học trong lộ trình chung");
    await fillSimpleObjective(page, content);
    await submitUi(page);
    await page.getByRole("button", { name: "Ghi nhận hoàn thành buổi học", exact: true }).click();
    await expect(page.locator(".duo-attempt-context")).toContainText("Đã ghi nhận hoàn thành buổi học cho riêng bạn");

    const after = await duoSnapshot(page);
    const afterBand = after.bands.find(item => item.band === band.band)!;
    const afterLesson = afterBand.lessons[0];
    expect(afterLesson.completedAt).toEqual(beforeLesson.completedAt);
    expect(afterLesson.completed).toEqual(beforeLesson.completed);
    expect(after.path).toEqual(before.path);
    expect(afterBand.gates).toEqual(before.bands.find(item => item.band === band.band)!.gates);
    const proofAfter = await storedCompletion();
    expect(proofAfter.husband?.proofIds).toEqual([redoId]);
    expect(proofAfter.husband?.at).toBe(proofBefore.husband?.at);
    expect(proofAfter.wife).toEqual(proofBefore.wife);
    expect((await getAttempt(page, first.id)).feedback).toEqual(first.feedback);
    await noOverflow(page);
  } finally {
    await context.close();
  }
});
