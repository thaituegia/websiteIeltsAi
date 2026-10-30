import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import type { Attempt, StoredContent, WritingStudyGuide } from "../../shared/types";
import { test, expect, duoLogin, noOverflow, submitUi, type DuoBrowserServer } from "./duo-fixtures";

const normalized = (value: string) => value.replace(/\s+/gu, " ").trim();
const savedEssay = (task: number) => `This is an isolated learner response for Writing Task ${task}. `
  + "I identify the main issue, develop a relevant explanation and check that the conclusion follows from the evidence. "
  + "This short synthetic submission tests the learning interface rather than an IELTS band prediction.";

async function writingSource(server: DuoBrowserServer): Promise<StoredContent> {
  const source = await server.database.content.findOne({ _id: "fresh-w-mock-01" });
  if (!source || source.skill !== "writing" || !source.referenceAnswers?.length)
    throw new Error("Missing bank Writing model in isolated fixture");
  return source;
}

async function readAttempt(page: Page, id: string): Promise<Attempt> {
  const response = await page.request.get(`/api/attempts/${id}`);
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).attempt;
}

function guideFor(attempt: Attempt, sectionId: string): WritingStudyGuide {
  const guide = attempt.feedback?.writingGuides?.find(item => item.sectionId === sectionId);
  if (!guide) throw new Error(`Missing submitted guide for ${sectionId}`);
  return guide;
}

test("Writing models and Vietnamese walkthroughs open beneath the submitted task, retain drafts and reopen privately", async ({ page, duoServer }, testInfo) => {
  await duoLogin(page, duoServer, 0);
  const source = await writingSource(duoServer);
  const started = await page.request.post("/api/attempts", { data: { contentId: source.id, mode: "exam" } });
  expect(started.status(), await started.text()).toBe(201);
  const attempt: Attempt = (await started.json()).attempt;
  expect(attempt.feedback).toBeNull();
  expect(attempt.content).not.toHaveProperty("referenceAnswers");
  expect(attempt.content).not.toHaveProperty("writingGuides");
  const essays = Object.fromEntries(source.sections.map(section => [section.id, savedEssay(section.task!)]));
  const draft = await page.request.patch(`/api/attempts/${attempt.id}`, { data: { essays } });
  expect(draft.status(), await draft.text()).toBe(200);
  const before = await duoServer.database.attempts.findOne({ _id: attempt.id });
  await page.goto(`/learn/${attempt.id}`);
  await expect(page.getByText("Bài mẫu và hướng dẫn sẽ mở sau khi nộp bài.", { exact: true })).toBeVisible();
  await expect(page.locator(".writing-study-panel")).toHaveCount(0);
  await expect(page.locator(".reference-answer-card")).toHaveCount(0);
  const tabs = page.getByRole("group", { name: "Phần của bài tập", exact: true }).getByRole("button");
  for (const [index, section] of source.sections.entries()) {
    await tabs.nth(index).click();
    await expect(page.getByRole("textbox", { name: `Bài viết Task ${section.task}`, exact: true })).toHaveValue(essays[section.id]);
    await expect(page.locator(".writing-study-panel")).toHaveCount(0);
    await expect(page.locator(".attempt-timer")).toBeVisible();
    const active = await readAttempt(page, attempt.id);
    expect(active.feedback).toBeNull();
    expect(active.deadlineAt).toBe(attempt.deadlineAt);
    expect(active.essays).toEqual(essays);
    expect(JSON.stringify(active)).not.toContain(source.referenceAnswers![index].sampleAnswer);
  }
  const afterSwitch = await duoServer.database.attempts.findOne({ _id: attempt.id });
  expect(afterSwitch?.deadlineAt).toBe(before?.deadlineAt);
  expect(afterSwitch?.essays).toEqual(before?.essays);

  await submitUi(page);
  const completed = await readAttempt(page, attempt.id);
  expect(completed.feedback?.estimatedBand).toBeNull();
  expect(completed.essays).toEqual(essays);
  expect(completed.feedback?.writingGuides).toHaveLength(source.sections.length);
  expect(completed.feedback?.referenceAnswers).toEqual(source.referenceAnswers);

  for (const [index, section] of source.sections.entries()) {
    await tabs.nth(index).click();
    const panel = page.locator(`.writing-study-panel[data-section-id="${section.id}"]`);
    await expect(panel).toBeVisible();
    await expect(page.locator(".writing-study-panel")).toHaveCount(1);
    await expect(panel.getByRole("heading", { name: "Bài mẫu tham khảo", exact: true })).toBeVisible();
    await expect(panel.getByRole("heading", { name: "Hướng dẫn làm bài bằng tiếng Việt", exact: true })).toBeVisible();
    await expect(panel.locator(".reference-sample")).toContainText(normalized(source.referenceAnswers![index].sampleAnswer));
    const other = source.referenceAnswers![index === 0 ? 1 : 0];
    await expect(panel.locator(".reference-sample")).not.toContainText(normalized(other.sampleAnswer));
    const guide = guideFor(completed, section.id);
    expect(guide.sourceVerified).toBe(true);
    expect(guide.timePlan.minimumWords).toBe(section.task === 1 ? 150 : 250);
    await expect(panel).toContainText(guide.taskTypeLabel);
    for (const point of guide.analysis) await expect(panel).toContainText(point);
    await panel.getByText("Dàn ý theo bài mẫu", { exact: true }).click();
    for (const paragraph of guide.paragraphs) {
      await expect(panel).toContainText(paragraph.role);
      await expect(panel).toContainText(paragraph.guidance);
      await expect(panel).toContainText(normalized(paragraph.excerpt));
    }
    await expect(page.getByRole("textbox", { name: `Bài viết Task ${section.task}`, exact: true })).toBeDisabled();
    await noOverflow(page);
  }
  const chart = source.sections[0].visuals?.find(visual => "rows" in visual);
  expect(chart && "rows" in chart ? chart.rows[0].values : []).toContain(41);
  expect(JSON.stringify(guideFor(completed, source.sections[0].id))).toContain("41");
  await page.screenshot({ path: testInfo.outputPath("writing-guidance-task2.png"), fullPage: true });
  const snapshot = await duoServer.database.attempts.findOne({ _id: attempt.id });
  await page.reload();
  await tabs.first().click();
  await expect(page.locator(".writing-study-panel .reference-sample")).toContainText(normalized(source.referenceAnswers![0].sampleAnswer));
  expect((await readAttempt(page, attempt.id)).feedback?.writingGuides).toEqual(completed.feedback?.writingGuides);
  expect(await duoServer.database.attempts.findOne({ _id: attempt.id })).toEqual(snapshot);
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("writing-guidance-task1.png"), fullPage: true });
  await page.request.post("/api/auth/logout");
  await duoLogin(page, duoServer, 1);
  const foreign = await page.request.get(`/api/attempts/${attempt.id}`);
  expect(foreign.status()).toBe(404);
});

test("legacy teacher models survive changed prompts and show a cautious Vietnamese guide without new chart claims", async ({ page, duoServer }, testInfo) => {
  await duoLogin(page, duoServer, 0);
  const bank = await writingSource(duoServer);
  const id = `writing-guide-legacy-${randomUUID()}`;
  const source = structuredClone(bank);
  delete (source as StoredContent & { _id?: string })._id;
  source.id = id;
  source.title = "Synthetic teacher Writing review";
  source.sections.forEach((section, index) => { section.id = `${id}-task-${index + 1}`; });
  source.referenceAnswers!.forEach((reference, index) => {
    reference.sectionId = source.sections[index].id;
    reference.sampleAnswer += "\n\nThis preserved teacher illustration belongs to the original lesson, not to later edits.";
  });
  await duoServer.database.content.insertOne({ ...source, _id: id });
  const start = await page.request.post("/api/attempts", { data: { contentId: id, mode: "practice" } });
  expect(start.status(), await start.text()).toBe(201);
  const attempt: Attempt = (await start.json()).attempt;
  const essays = Object.fromEntries(source.sections.map(section => [section.id, savedEssay(section.task!)]));
  const draft = await page.request.patch(`/api/attempts/${attempt.id}`, { data: { essays } });
  expect(draft.status(), await draft.text()).toBe(200);
  const submit = await page.request.post(`/api/attempts/${attempt.id}/submit`);
  expect(submit.status(), await submit.text()).toBe(200);
  // Model a historical result predating guide snapshots. Only this disposable
  // namespace is changed; the read must preserve the saved teacher response.
  await duoServer.database.attempts.updateOne({ _id: attempt.id }, { $unset: { "feedback.writingGuides": "" } });
  const changed = structuredClone(source);
  changed.sections[0].text += " Later editing introduced a different source dataset.";
  const chart = changed.sections[0].visuals?.find(visual => "rows" in visual);
  if (!chart || !("rows" in chart)) throw new Error("Expected a numeric Writing visual");
  chart.rows[0].values[0] = 987654321;
  changed.referenceAnswers![0].sampleAnswer = "A later replacement model must not replace the learner's saved teacher example.";
  await duoServer.database.content.replaceOne({ _id: id }, changed);
  const protectedAttempt = await duoServer.database.attempts.findOne({ _id: attempt.id });
  const review = await readAttempt(page, attempt.id);
  const guide = guideFor(review, source.sections[0].id);
  expect(guide.sourceVerified).toBe(false);
  expect(guide.notice).toBeTruthy();
  expect(JSON.stringify(guide)).not.toContain("987654321");
  expect(review.feedback?.referenceAnswers).toEqual(source.referenceAnswers);
  await page.goto(`/learn/${attempt.id}`);
  const panel = page.locator(`.writing-study-panel[data-section-id="${source.sections[0].id}"]`);
  await expect(panel).toBeVisible();
  await expect(panel.locator(".reference-sample")).toContainText(normalized(source.referenceAnswers![0].sampleAnswer));
  await expect(panel).toContainText(guide.notice!);
  await expect(panel).not.toContainText(changed.referenceAnswers![0].sampleAnswer);
  await expect(panel).not.toContainText("987654321");
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("writing-guidance-legacy.png"), fullPage: true });
  expect(await duoServer.database.attempts.findOne({ _id: attempt.id })).toEqual(protectedAttempt);
  expect(await duoServer.database.content.findOne({ _id: id })).toEqual({ ...changed, _id: id });
});
