import type { Page } from "@playwright/test";
import type { Db } from "mongodb";
import type { PlacementItem, PlacementState, StoredContent } from "../../shared/types";
import { test, expect, loginDemo, navigate, noHorizontalOverflow, lesson, createAttempt, getAttempt } from "./fixtures";

async function submitFromBrowser(page: Page) {
  await page.getByRole("button", { name: "Nộp bài & xem phản hồi", exact: true }).click();
  await page.getByRole("dialog", { name: "Nộp bài luyện của bạn?", exact: true })
    .getByRole("button", { name: "Nộp bài", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Phản hồi bài luyện", exact: true })).toBeVisible();
}

async function storeFixture(db: Db, source: StoredContent, suffix: string): Promise<StoredContent> {
  const fixture = { ...source, id: `answer-review-e2e-${suffix}`, _id: `answer-review-e2e-${suffix}` };
  await db.collection<StoredContent & { _id: string }>("content").replaceOne({ _id: fixture.id }, fixture, { upsert: true });
  return fixture;
}

function exactOption(answer: string): RegExp {
  return new RegExp(`^(?:[A-Z]\\s+)?${answer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
}

test("placement keeps keys hidden until completion, then shows all fifteen answers and reopens the owner history", async ({ page, db }) => {
  await loginDemo(page);
  const started = await page.request.post("/api/placement/start", { data: { mode: "quick" } });
  expect(started.ok()).toBeTruthy();
  let state: PlacementState = (await started.json()).placement;
  let firstAnswer = "";
  for (let index = 0; index < 14; index++) {
    expect(state.result).toBeNull();
    expect(state.question).not.toHaveProperty("answer");
    expect(state.question).not.toHaveProperty("explanation");
    const source = await db.collection<PlacementItem>("placementItems").findOne({ id: state.question!.id });
    if (!source) throw new Error("Missing isolated placement source");
    if (index === 0) firstAnswer = source.answer;
    const response = await page.request.post(`/api/placement/${state.id}/answer`, {
      data: { questionId: source.id, answer: index === 0 ? source.options.find((option) => option !== source.answer) : source.answer },
    });
    expect(response.ok()).toBeTruthy();
    state = (await response.json()).placement;
  }
  await navigate(page, "/placement");
  await expect(page.getByText("Câu 15 / 15", { exact: true })).toBeVisible();
  await expect(page.locator(".answer-review")).toHaveCount(0);
  const lastSource = await db.collection<PlacementItem>("placementItems").findOne({ id: state.question!.id });
  if (!lastSource) throw new Error("Missing final placement source");
  await page.getByRole("radio", { name: exactOption(lastSource.answer) }).check();
  await page.getByRole("button", { name: "Câu tiếp theo", exact: true }).click();
  const review = page.locator(".answer-review");
  await expect(review.locator(":scope > details")).toHaveCount(15);
  await expect(review.locator(":scope > details").first()).toContainText(firstAnswer);
  await expect(review.locator(":scope > details").first()).toContainText("Bạn trả lời:");
  await expect(review.locator(":scope > details").first().getByRole("list", { name: "Các phương án trả lời" })).toBeVisible();
  await review.locator(":scope > details").first().getByRole("button", { name: "Xem nội dung gốc / transcript", exact: true }).click();
  await expect(review.locator(".answer-context > div").first()).toBeVisible();
  await noHorizontalOverflow(page);
  await navigate(page, "/history");
  await page.getByRole("link", { name: "Xem lại đáp án từng câu", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/placement\\?review=${state.id}$`));
  await expect(review.locator(":scope > details")).toHaveCount(15);
  await page.reload();
  await expect(review.locator(":scope > details")).toHaveCount(15);
  await noHorizontalOverflow(page);
  await page.getByRole("button", { name: "Làm một bài đánh giá khác", exact: true }).click();
  await page.getByRole("button", { name: "Bắt đầu kiểm tra nhanh", exact: true }).click();
  await expect(page.getByText("Câu 1 / 15", { exact: true })).toBeVisible();
  await expect(review).toHaveCount(0);
  // A second synthetic learner cannot open the completed first learner's key.
  await page.request.post("/api/auth/demo", { data: { learner: 2 } });
  const foreign = await page.request.get(`/api/placement/${state.id}`);
  expect(foreign.status()).toBe(404);
});

for (const format of ["lesson", "full-mock"] as const) {
  test(`${format} objective review includes correct, wrong and unanswered keys, context and persistent result`, async ({ page, db }) => {
    await loginDemo(page);
    const content = await lesson(db, "reading", format);
    const attempt = await createAttempt(page, content, format === "full-mock" ? "exam" : "practice");
    expect(attempt.feedback).toBeNull();
    expect(attempt.content).not.toHaveProperty("referenceAnswers");
    for (const question of attempt.content.questions) expect(question).not.toHaveProperty("answer");
    const responses = {
      [content.questions[0]!.id]: content.questions[0]!.answer,
      [content.questions[1]!.id]: "deliberately incorrect synthetic response",
    };
    const saved = await page.request.patch(`/api/attempts/${attempt.id}`, { data: { responses, revision: 1 } });
    expect(saved.ok(), await saved.text()).toBeTruthy();
    await navigate(page, `/learn/${attempt.id}`);
    await expect(page.locator(".answer-review")).toHaveCount(0);
    await submitFromBrowser(page);
    const review = page.locator(".answer-review");
    await expect(review.locator(":scope > details")).toHaveCount(content.questions.length);
    for (const question of content.questions) {
      await expect(review.locator(`[data-question-number="${question.number}"] > summary`)).toContainText(question.answer);
    }
    const first = review.locator(":scope > details").first();
    await expect(first).toContainText(content.questions[0]!.prompt);
    await expect(first).toContainText(content.questions[0]!.explanation);
    await expect(first.locator("blockquote")).toContainText(content.questions[0]!.evidence);
    await page.getByRole("group", { name: "Lọc đáp án" }).getByRole("button", { name: "Sai (1)", exact: true }).click();
    await expect(review.locator(":scope > details")).toHaveCount(1);
    await expect(review).toContainText("deliberately incorrect synthetic response");
    await page.getByRole("group", { name: "Lọc đáp án" }).getByRole("button", { name: `Chưa trả lời (${content.questions.length - 2})`, exact: true }).click();
    await expect(review.locator(":scope > details")).toHaveCount(content.questions.length - 2);
    await expect(review.locator(":scope > details").first()).toContainText("Bạn trả lời: Chưa trả lời");
    await page.getByRole("group", { name: "Lọc đáp án" }).getByRole("button", { name: `Tất cả (${content.questions.length})`, exact: true }).click();
    await page.reload();
    await expect(review.locator(":scope > details")).toHaveCount(content.questions.length);
    expect((await getAttempt(page, attempt.id)).feedback?.answers).toHaveLength(content.questions.length);
    await noHorizontalOverflow(page);
  });
}

test("paired selection review displays option texts instead of saved JSON", async ({ page, db }) => {
  await loginDemo(page);
  const source = await db.collection<StoredContent>("content").findOne({ skill: "listening", "questions.selectionGroup": { $exists: true } });
  if (!source) throw new Error("No listening paired selection fixture");
  const groupId = source.questions.find((question) => question.selectionGroup)!.selectionGroup!.id;
  const grouped = source.questions.filter((question) => question.selectionGroup?.id === groupId);
  const selected = grouped.map((question) => question.answer);
  const content = await storeFixture(db, source, "paired-selection");
  const attempt = await createAttempt(page, content);
  const saved = await page.request.patch(`/api/attempts/${attempt.id}`, { data: {
    responses: Object.fromEntries(grouped.map((question) => [question.id, JSON.stringify(selected)])), revision: 1,
  } });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  await navigate(page, `/learn/${attempt.id}`);
  await submitFromBrowser(page);
  const row = page.locator(`.answer-review > details[data-question-number="${grouped[0]!.number}"]`);
  if (!(await row.evaluate((element) => (element as HTMLDetailsElement).open))) await row.locator(":scope > summary").click();
  await expect(row.locator(".answer-comparison")).toContainText(selected.join(" · "));
  await expect(row.locator(".answer-comparison")).not.toContainText(JSON.stringify(selected));
  await noHorizontalOverflow(page);
});

for (const skill of ["writing", "speaking"] as const) {
  test(`${skill} full mock reveals section-specific reference responses only after submission when AI is offline`, async ({ page, db }) => {
    await loginDemo(page);
    const source = await lesson(db, skill, "full-mock", skill === "writing" ? { testType: "academic" } : {});
    const referenceAnswers = source.sections.map((section, index) => ({
      sectionId: section.id,
      title: `${skill === "writing" ? "Task" : "Part"} ${index + 1}: Reference example`,
      sampleAnswer: `This synthetic reference is specific to ${section.title}. A clear response supports its main point with a concrete example, explains the relevant comparison, and acknowledges the limits of that example.`,
      explanation: "Đối chiếu cách sắp xếp ý và cách dùng bằng chứng trong câu trả lời.",
      keyPoints: ["Trả lời đúng trọng tâm của câu hỏi.", "Dùng ví dụ phù hợp với chủ đề."],
      ...(skill === "speaking" ? { responses: [{
        prompt: `Reference question for Part ${index + 1}`,
        sampleAnswer: `I would approach this question by describing a specific experience in ${section.title}. It helped me form a clearer opinion because I could compare the outcome with what I had expected.`,
        explanation: "Nêu ý chính, một trải nghiệm và lý do liên quan.",
      }] } : {}),
    }));
    const fixture = await storeFixture(db, { ...source, referenceAnswers }, `${skill}-references`);
    const attempt = await createAttempt(page, fixture);
    expect(attempt.content).not.toHaveProperty("referenceAnswers");
    await navigate(page, `/learn/${attempt.id}`);
    await expect(page.locator(".reference-answer-card")).toHaveCount(0);
    if (skill === "writing") {
      for (let index = 0; index < source.sections.length; index++) {
        await page.getByRole("group", { name: "Phần của bài tập", exact: true }).getByRole("button").nth(index).click();
        await page.getByRole("textbox", { name: `Bài viết Task ${index + 1}`, exact: true }).fill("This is my submitted synthetic response. I support the main argument with a specific example and compare the alternatives before reaching a balanced conclusion.");
      }
    } else {
      await page.getByRole("textbox", { name: "Transcript bài nói", exact: true }).fill("I enjoy learning with other people because discussing an idea helps me notice details I might miss on my own. For example, last week I compared two possible solutions with a friend and we agreed on a practical plan.");
    }
    await submitFromBrowser(page);
    await expect(page.getByRole("heading", { name: "Bài mẫu tham khảo", exact: true })).toBeVisible();
    const references = page.locator(".reference-answers > article");
    await expect(references).toHaveCount(source.sections.length);
    await expect(page.locator(".reference-answer-notice")).toContainText("không phải đáp án duy nhất hay cam kết đạt một band cụ thể");
    for (let index = 0; index < referenceAnswers.length; index++) {
      await expect(references.nth(index)).toContainText(referenceAnswers[index]!.sampleAnswer);
      if (skill === "speaking") await expect(references.nth(index)).toContainText(`Reference question for Part ${index + 1}`);
    }
    expect((await getAttempt(page, attempt.id)).feedback?.estimatedBand).toBeNull();
    await page.reload();
    await expect(references).toHaveCount(source.sections.length);
    await noHorizontalOverflow(page);
  });
}
