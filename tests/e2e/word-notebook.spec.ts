import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import type { Attempt, PlacementState, StoredContent, VocabularyCard, VocabularyEntry, WordSaveResult, WordTranslationResult } from "../../shared/types";
import { test, expect, duoLogin, noOverflow, submitUi, type DuoBrowserServer } from "./duo-fixtures";

// Real owner-scoped persistence in disposable Duo databases; no AI provider calls.
test.use({ integrityEnabled: true });
const word = "unfaltering";
const meaning = "không nao núng";

async function seedLesson(server: DuoBrowserServer, format: "lesson" | "full-mock") {
  const id = `word-notebook-${randomUUID()}`;
  const content: StoredContent = {
    id, title: "Word notebook browser lesson", description: "Visible source words in a timed lesson",
    skill: "reading", topic: "Education", band: 5, cefr: "B1", testType: "academic", durationMinutes: 60,
    format, source: "authored", quality: "authored-unreviewed", createdAt: new Date().toISOString(),
    vocabularyIds: [], tags: ["word-notebook-e2e"],
    sections: [{ id: "passage", title: "A steady plan", text: `The team showed ${word} commitment to the learning plan. The lesson takes place at home.` }],
    questions: [
      { id: "place", number: 1, type: "text", prompt: "Where does the lesson take place?", sectionIndex: 0, subskill: "detail", answer: "home", explanation: "The lesson takes place at home.", evidence: "The lesson takes place at home." },
      { id: "commitment", number: 2, type: "choice", prompt: "Which phrase describes the team?", options: [`${word} commitment`, "hesitant commitment"], sectionIndex: 0, subskill: "detail", answer: `${word} commitment`, explanation: "The first sentence describes their commitment.", evidence: `The team showed ${word} commitment to the learning plan.` },
    ],
  };
  const vocabulary: VocabularyEntry = {
    id: `word-notebook-vocab-${id}`, word, meaning, definition: "Continuing firmly without hesitation.", partOfSpeech: "adjective",
    ipa: "", cefr: "B2", topic: "Education", collocations: [], examples: [`The team showed ${word} commitment to the learning plan.`],
    family: [], commonError: "", synonyms: [], register: "neutral",
  };
  await server.database.content.insertOne({ ...content, _id: content.id });
  await server.database.vocabulary.insertOne({ ...vocabulary, _id: vocabulary.id });
  // A seeded bank may already include this word; make every match deterministic.
  await server.database.vocabulary.updateMany({ word: { $regex: `^${word}$`, $options: "i" } }, { $set: { meaning, definition: vocabulary.definition, examples: vocabulary.examples } });
  return content;
}

async function startExam(page: Page, content: StoredContent) {
  await page.goto("/exams?skill=reading");
  await page.getByLabel("Tìm bài tập", { exact: true }).fill(content.title);
  await page.getByLabel("Tìm bài tập", { exact: true }).press("Enter");
  const card = page.locator(".content-card").filter({ has: page.getByRole("heading", { name: content.title, exact: true }) });
  await card.getByRole("button", { name: "Bắt đầu thi thử", exact: true }).click();
  const created = page.waitForResponse(response => new URL(response.url()).pathname === "/api/attempts" && response.request().method() === "POST");
  await page.getByRole("dialog", { name: "Quy định phòng thi", exact: true })
    .getByRole("button", { name: "Tôi hiểu, bắt đầu bài thi", exact: true }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  const attempt: Attempt = (await response.json()).attempt;
  await expect(page.getByTestId("exam-integrity-active")).toBeVisible();
  return attempt;
}

async function cards(page: Page): Promise<VocabularyCard[]> {
  const response = await page.request.get("/api/vocabulary/cards");
  expect(response.ok()).toBeTruthy();
  return (await response.json()).cards;
}

test("exam word saves preserve answers and timer; submitted meanings stay inline and private", async ({ page, browser, duoServer }) => {
  await duoLogin(page, duoServer, 0);
  const content = await seedLesson(duoServer, "full-mock");
  const attempt = await startExam(page, content);
  const openedUrl = page.url();
  let popups = 0;
  let translationCalls = 0;
  page.on("popup", () => ++popups);
  page.on("request", request => { if (new URL(request.url()).pathname.endsWith("/words/translate")) ++translationCalls; });
  await page.getByRole("textbox", { name: "Câu 1", exact: true }).fill("home");
  const option = page.locator('input[type="radio"][value="hesitant commitment"]');
  await option.check();
  await expect.poll(async () => (await duoServer.database.attempts.findOne({ _id: attempt.id }))?.responses.place).toBe("home");
  const timer = await page.locator(".attempt-timer").innerText();
  await page.getByRole("button", { name: "Chọn từ để lưu", exact: true }).click();
  await page.locator(".answer-options").getByRole("button", { name: `Lưu từ ${word}`, exact: true }).click();
  const inline = page.getByRole("dialog", { name: word, exact: true });
  await expect(inline).toContainText("Nghĩa tiếng Việt xuất hiện khi bạn đã nộp bài");
  await expect(inline).not.toContainText(meaning);
  await expect(option).toBeChecked();
  await inline.getByRole("button", { name: "Đóng thẻ từ", exact: true }).click();
  await page.locator(".reading-passage").getByRole("button", { name: `Lưu từ ${word}`, exact: true }).click();
  const savedResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/attempts/${attempt.id}/words`);
  await inline.getByRole("button", { name: "Lưu vào sổ từ của tôi", exact: true }).click();
  const save: WordSaveResult = await (await savedResponse).json();
  expect(Object.keys(save)).toEqual(["saved"]);
  expect(save.saved.word).toBe(word);
  await expect(inline.getByRole("button", { name: "Đã có trong sổ từ", exact: true })).toBeDisabled();
  await expect(option).toBeChecked();
  await expect(page.getByRole("textbox", { name: "Câu 1", exact: true })).toHaveValue("home");
  await expect.poll(() => page.locator(".attempt-timer").innerText()).not.toBe(timer);
  const afterSave = await duoServer.database.attempts.findOne({ _id: attempt.id });
  expect(afterSave?.deadlineAt).toBe(attempt.deadlineAt);
  expect(afterSave?.invalidatedAt).toBeUndefined();
  expect(afterSave?.responses).toMatchObject({ place: "home", commitment: "hesitant commitment" });
  expect(page.url()).toBe(openedUrl);
  expect(popups).toBe(0);
  expect(translationCalls).toBe(0);
  const pending = (await cards(page)).filter(card => card.word === word);
  expect(pending).toHaveLength(1);
  expect(pending[0]).toMatchObject({ meaning: "", meaningStatus: "pending", due: false, origin: { resourceId: attempt.id, sectionIndex: 0 } });
  await inline.getByRole("button", { name: "Đóng thẻ từ", exact: true }).click();
  await page.locator(".reading-passage").getByRole("button", { name: `Lưu từ ${word}`, exact: true }).click();
  await expect(page.getByRole("dialog", { name: word, exact: true }).getByRole("button", { name: "Đã có trong sổ từ", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Đóng thẻ từ", exact: true }).click();
  await page.getByRole("button", { name: "Chọn từ để lưu", exact: true }).click();
  await submitUi(page);
  await page.getByRole("button", { name: "Chọn từ để xem nghĩa", exact: true }).click();
  const translated = page.waitForResponse(response => new URL(response.url()).pathname === `/api/attempts/${attempt.id}/words/translate`);
  await page.locator(".reading-passage").getByRole("button", { name: `Xem nghĩa từ ${word}`, exact: true }).click();
  const translation: WordTranslationResult = await (await translated).json();
  expect(translation.translation).toMatchObject({ word, meaning, source: "bank" });
  await expect(page.getByRole("dialog", { name: word, exact: true }).locator(".word-inline-meaning")).toHaveText(meaning);
  expect(page.url()).toBe(openedUrl);
  expect(popups).toBe(0);
  await noOverflow(page);
  await page.getByRole("button", { name: "Đóng thẻ từ", exact: true }).click();
  await page.goto("/vocabulary");
  await page.getByRole("tab", { name: /^Từ đã lưu/ }).click();
  const persisted = page.locator(".saved-card").filter({ has: page.getByRole("heading", { name: word, exact: true }) });
  await expect(persisted).toContainText(meaning);
  await page.reload();
  await page.getByRole("tab", { name: /^Từ đã lưu/ }).click();
  await expect(persisted).toContainText(meaning);
  expect((await cards(page)).filter(card => card.word === word)).toHaveLength(1);
  const partnerContext = await browser.newContext({ baseURL: duoServer.url });
  const partner = await partnerContext.newPage();
  try {
    await duoLogin(partner, duoServer, 1);
    expect((await cards(partner)).some(card => card.word === word)).toBe(false);
    const forbidden = await partner.request.post(`/api/attempts/${attempt.id}/words/translate`, { data: { word } });
    expect(forbidden.status()).toBe(404);
    await partner.goto("/vocabulary");
    await partner.getByRole("tab", { name: /^Từ đã lưu/ }).click();
    await expect(partner.locator(".saved-card")).toHaveCount(0);
  } finally { await partnerContext.close(); }
});

test("pending notebook words survive reload and translate retry after their practice is submitted", async ({ page, duoServer }) => {
  await duoLogin(page, duoServer, 0);
  const content = await seedLesson(duoServer, "lesson");
  const created = await page.request.post("/api/attempts", { data: { contentId: content.id, mode: "practice" } });
  expect(created.status()).toBe(201);
  const attempt: Attempt = (await created.json()).attempt;
  await page.goto(`/learn/${attempt.id}`);
  await page.getByRole("button", { name: "Chọn từ để lưu", exact: true }).click();
  await page.locator(".answer-options").getByRole("button", { name: `Lưu từ ${word}`, exact: true }).click();
  await page.getByRole("dialog", { name: word, exact: true }).getByRole("button", { name: "Lưu vào sổ từ của tôi", exact: true }).click();
  await expect(page.getByRole("button", { name: "Đã có trong sổ từ", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Đóng thẻ từ", exact: true }).click();
  const source = page.locator(".reading-passage").getByRole("button", { name: `Lưu từ ${word}`, exact: true });
  await source.focus();
  await source.press("Enter");
  const recaptured = page.waitForResponse(response => new URL(response.url()).pathname === `/api/attempts/${attempt.id}/words`);
  await page.getByRole("dialog", { name: word, exact: true }).getByRole("button", { name: "Lưu vào sổ từ của tôi", exact: true }).click();
  expect((await recaptured).status()).toBe(200);
  await expect(page.getByRole("button", { name: "Đã có trong sổ từ", exact: true })).toBeDisabled();
  const captured = (await cards(page)).filter(card => card.word === word);
  expect(captured).toHaveLength(1);
  expect(captured[0].origin?.context).toBe(`The team showed ${word} commitment to the learning plan.`);
  await page.getByRole("button", { name: "Đóng thẻ từ", exact: true }).click();
  await expect(source).toBeFocused();
  await page.goto("/vocabulary");
  await page.getByRole("tab", { name: /^Từ đã lưu/ }).click();
  const pending = page.locator(".saved-card").filter({ has: page.getByRole("heading", { name: word, exact: true }) });
  await expect(pending).toContainText("Chờ nghĩa sau nộp bài");
  await expect(pending).not.toContainText(meaning);
  await page.reload();
  await page.getByRole("tab", { name: /^Từ đã lưu/ }).click();
  await expect(pending).toContainText("Chờ nghĩa sau nộp bài");
  await pending.getByRole("link", { name: "Mở bài nguồn", exact: true }).click();
  await submitUi(page);
  await page.getByRole("button", { name: "Chọn từ để xem nghĩa", exact: true }).click();
  let first = true;
  await page.route(`**/api/attempts/${attempt.id}/words/translate`, async route => {
    if (first) { first = false; await route.fulfill({ status: 503, json: { error: "Thử lại nghĩa sau gián đoạn" } }); }
    else await route.continue();
  });
  await page.locator(".reading-passage").getByRole("button", { name: `Xem nghĩa từ ${word}`, exact: true }).click();
  const inline = page.getByRole("dialog", { name: word, exact: true });
  await expect(inline.getByRole("alert")).toContainText("Thử lại nghĩa sau gián đoạn");
  await inline.getByRole("button", { name: "Thử xem nghĩa lại", exact: true }).click();
  await expect(inline.locator(".word-inline-meaning")).toHaveText(meaning);
  await noOverflow(page);
  await inline.getByRole("button", { name: "Đóng thẻ từ", exact: true }).click();
  // A response for a source removed by a review filter must not reopen its card.
  let release!: () => void;
  let complete!: () => void;
  const completed = new Promise<void>(resolve => { complete = resolve; });
  await page.route(`**/api/attempts/${attempt.id}/words/translate`, async route => {
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ status: 200, json: { translation: {
      word, meaning: "nghĩa phản hồi chậm", source: "bank", context: `${word} commitment`,
    } } });
    complete();
  });
  const review = page.locator('.answer-review details[data-question-number="2"]');
  await review.locator("summary").click();
  await review.locator(".answer-review-options").getByRole("button", { name: `Xem nghĩa từ ${word}`, exact: true }).click();
  await expect(page.getByRole("dialog", { name: word, exact: true })).toContainText("Đang xem nghĩa trong ngữ cảnh");
  await expect.poll(() => typeof release).toBe("function");
  await page.getByRole("button", { name: /^Sai \(/ }).click();
  release();
  await completed;
  await expect(page.locator(".word-inline-card")).toHaveCount(0);
});

test.describe("placement notebook", () => {
  // The strict exam case above covers the native tab policy. This case isolates
  // placement's changing question scope and completed-answer review transport.
  test.use({ integrityEnabled: false });
  test("a placement word belongs to the encountered question and opens its meaning in completed review", async ({ page, duoServer }) => {
    await duoLogin(page, duoServer, 0);
    await seedLesson(duoServer, "lesson");
    const started = await page.request.post("/api/placement/start", { data: { mode: "quick" } });
    expect(started.status()).toBe(201);
    let placement: PlacementState = (await started.json()).placement;
    const questionId = placement.question!.id;
    const sentence = `The team showed ${word} commitment to the learning plan.`;
    await duoServer.database.placementItems.updateOne({ _id: questionId }, { $set: {
      skill: "reading", text: sentence, question: "Which phrase describes the team?",
      options: [`${word} commitment`, "hesitant commitment"], answer: `${word} commitment`,
      explanation: sentence,
    } });
    await page.goto("/placement");
    await expect(page.locator(".placement-passage")).toContainText(sentence);
    await page.getByRole("button", { name: "Chọn từ để lưu", exact: true }).click();
    await page.locator(".placement-passage").getByRole("button", { name: `Lưu từ ${word}`, exact: true }).click();
    const inline = page.getByRole("dialog", { name: word, exact: true });
    await expect(inline).not.toContainText(meaning);
    const saved = page.waitForResponse(response => new URL(response.url()).pathname === `/api/placement/${placement.id}/words`);
    await inline.getByRole("button", { name: "Lưu vào sổ từ của tôi", exact: true }).click();
    const saveResponse = await saved;
    expect(saveResponse.request().postDataJSON()).toMatchObject({ word, questionId, context: sentence });
    await expect(page.getByRole("button", { name: "Đã có trong sổ từ", exact: true })).toBeDisabled();
    const captured = (await cards(page)).find(card => card.word === word)!;
    expect(captured).toMatchObject({ meaning: "", meaningStatus: "pending", origin: { kind: "placement", resourceId: placement.id, questionId } });
    await inline.getByRole("button", { name: "Đóng thẻ từ", exact: true }).click();
    await page.getByRole("button", { name: "Chọn từ để lưu", exact: true }).click();
    await page.getByRole("radio").first().check();
    await expect(page.getByRole("button", { name: "Câu tiếp theo", exact: true })).toBeEnabled();
    const next = page.waitForResponse(response => new URL(response.url()).pathname === `/api/placement/${placement.id}/answer`);
    await page.getByRole("button", { name: "Câu tiếp theo", exact: true }).click();
    placement = (await (await next).json()).placement;
    expect(placement.question?.id).not.toBe(questionId);
    await expect(page.locator(".word-inline-card")).toHaveCount(0);
    while (placement.question) {
      const source = await duoServer.database.placementItems.findOne({ _id: placement.question.id });
      if (!source) throw new Error("Missing isolated placement item");
      const answer = await page.request.post(`/api/placement/${placement.id}/answer`, { data: { questionId: source.id, answer: source.answer } });
      expect(answer.ok()).toBeTruthy();
      placement = (await answer.json()).placement;
    }
    await page.goto(`/placement?review=${encodeURIComponent(placement.id)}`);
    await expect(page.locator(".placement-complete")).toBeVisible();
    await page.getByRole("button", { name: "Chọn từ để xem nghĩa", exact: true }).click();
    const reviewed = page.locator(".answer-review details").filter({ has: page.locator(`button[aria-controls="answer-context-${questionId}"]`) });
    await reviewed.getByRole("button", { name: "Xem nội dung gốc / transcript", exact: true }).click();
    const translated = page.waitForResponse(response => new URL(response.url()).pathname === `/api/placement/${placement.id}/words/translate`);
    await reviewed.locator(`[id="answer-context-${questionId}"]`).getByRole("button", { name: `Xem nghĩa từ ${word}`, exact: true }).click();
    const translateResponse = await translated;
    expect(translateResponse.request().postDataJSON()).toMatchObject({ word, questionId, context: sentence });
    expect((await translateResponse.json()).translation.source).toBe("bank");
    await expect(page.getByRole("dialog", { name: word, exact: true }).locator(".word-inline-meaning")).toHaveText(meaning);
    expect((await cards(page)).find(card => card.word === word)?.meaningStatus).toBe("ready");
    await noOverflow(page);
  });
});
