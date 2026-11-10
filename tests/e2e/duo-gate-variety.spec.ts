import type { Browser, Page, TestInfo } from "@playwright/test";
import type { DuoAssessmentView } from "../../shared/duo";
import type { Attempt, QuestionBlock, StoredContent, StoredQuestion } from "../../shared/types";
import { newTenDuoGatePapers } from "../../server/data/duo-gate-supplement-4";
import { test, expect, duoLogin, duoSnapshot, finishPlacement, noOverflow, type DuoBrowserServer } from "./duo-fixtures";

test.use({ integrityEnabled: false });

const variants = [
  { sitting: 12, listening: "form", readingMatch: "matching-features" },
  { sitting: 13, listening: "table", readingTfng: true },
  { sitting: 14, listening: "sentence", readingMatch: "matching-information" },
  { sitting: 15, listening: "flow-chart", readingMatch: "matching-headings" },
  { sitting: 16, listening: "note", readingMatch: "matching-features" },
] as const;

async function assignedGate(page: Page, browser: Browser, server: DuoBrowserServer, sitting: number) {
  const otherContext = await browser.newContext({ baseURL: server.url, viewport: page.viewportSize()! });
  const other = await otherContext.newPage();
  try {
    await duoLogin(page, server, 0);
    await duoLogin(other, server, 1);
    await finishPlacement(page, server, false);
    await finishPlacement(other, server, false);
    const snapshot = await duoSnapshot(page);
    expect(snapshot.path?.currentBand).toBe(3);
    const band = snapshot.bands.find(item => item.band === 3)!;
    const gate = band.gates[0]!;
    const sources = newTenDuoGatePapers().filter(paper => paper.id.endsWith(`-${sitting}`));
    expect(sources).toHaveLength(3);
    const contentIds = (["reading", "listening", "grammar"] as const).map(skill => sources.find(paper => paper.skill === skill)!.id);

    // Only this isolated synthetic database receives shortcut lesson receipts.
    // Gate eligibility/proof verification is covered by the native suites; here
    // the real authenticated start, ownership and question widgets are under test.
    expect(server.database.db.databaseName).toMatch(/^ielts_duo_e2e_\d+_[a-f0-9]{32}$/u);
    const changes: Record<string, unknown> = { "bands.b6.gates.0.contentIds": contentIds };
    for (let index = 0; index < 5; index++) {
      for (const role of ["husband", "wife"] as const) {
        changes[`bands.b6.lessons.${index}.completion.${role}`] = {
          at: new Date().toISOString(), kind: "attempt", proofIds: [`synthetic-variety-proof-${index}-${role}`],
        };
      }
    }
    const changed = await server.database.db.collection<{ _id: string }>("duo_learning_paths")
      .updateOne({ _id: snapshot.path!.id }, { $set: changes, $inc: { revision: 1 } });
    expect(changed.modifiedCount).toBe(1);
    const response = await page.request.post(`/api/duo/gates/${encodeURIComponent(gate.id)}/start`);
    expect(response.ok(), await response.text()).toBeTruthy();
    const assessment: DuoAssessmentView = (await response.json()).assessment;
    expect(assessment.parts.map(part => part.contentId)).toEqual(contentIds);
    expect(assessment.parts.every(part => part.attemptId === null)).toBe(true);
    return { assessment, sources, other, close: () => otherContext.close() };
  } catch (error) { await otherContext.close(); throw error; }
}

function questionField(page: Page, number: number) {
  return page.locator("fieldset.practice-question").filter({
    has: page.locator("legend .question-number").filter({ hasText: new RegExp(`^${number}$`, "u") }),
  });
}

function options(question: StoredQuestion): string[] {
  return question.type === "true-false" ? ["TRUE", "FALSE", "NOT GIVEN"]
    : question.type === "yes-no" ? ["YES", "NO", "NOT GIVEN"] : question.options ?? [];
}

async function completionWidget(page: Page, block: QuestionBlock) {
  const widget = page.locator(`.completion-block.completion-${block.type}`).filter({
    has: page.getByRole("heading", { name: block.title, exact: true }),
  });
  await expect(widget).toBeVisible();
  await expect(widget.getByRole("textbox")).toHaveCount(block.questionNumbers.length);
  for (const number of block.questionNumbers) {
    await expect(widget.getByRole("textbox", { name: `Câu ${number}`, exact: true })).toBeVisible();
    await expect(widget.locator(".blank-number").filter({ hasText: new RegExp(`^${number}$`, "u") })).toHaveCount(1);
  }
  if (block.type === "table") {
    await expect(widget.locator("table")).toBeVisible();
    await expect(widget.locator("tbody tr")).toHaveCount(block.rows!.length);
    await expect(widget.locator("td").first()).toBeVisible();
  } else if (block.type === "flow-chart") {
    const rows = widget.locator(".completion-flow .completion-row");
    await expect(rows).toHaveCount(block.rows!.length);
    expect(await rows.first().evaluate(element => getComputedStyle(element, "::after").content)).toContain("↓");
  } else if (block.type === "form" || block.type === "note") {
    const rows = widget.locator(".completion-row");
    await expect(rows).toHaveCount(block.rows!.length);
    if (block.type === "note") await expect(rows.first()).toHaveCSS("display", "list-item");
  } else {
    await expect(widget.locator(".completion-prose")).toBeVisible();
    await expect(widget.locator("table, .completion-flow")).toHaveCount(0);
  }
}

async function completeRenderedPaper(page: Page, other: Page, server: DuoBrowserServer,
  assessment: DuoAssessmentView, source: StoredContent, info: TestInfo) {
  const response = await page.request.post("/api/attempts", { data: {
    contentId: source.id, mode: "exam", duoAssessmentId: assessment.id,
  } });
  expect(response.status(), await response.text()).toBe(201);
  const attempt: Attempt = (await response.json()).attempt;
  expect(attempt.duoAssessmentId).toBe(assessment.id);
  expect(attempt.responses).toEqual({});
  expect(attempt.feedback).toBeNull();
  expect(attempt.content.questions).toHaveLength(source.skill === "grammar" ? 10 : 8);
  for (const question of attempt.content.questions) {
    for (const hidden of ["answer", "acceptedAnswers", "explanation", "evidence"])
      expect(Object.hasOwn(question, hidden), `${source.id} leaked ${hidden}`).toBe(false);
  }
  if (source.skill === "listening") {
    expect(attempt.content.sections.every(section => section.text === "" && !section.dialogue)).toBe(true);
  }
  expect((await other.request.get(`/api/attempts/${attempt.id}`)).status()).toBe(404);
  await page.goto(`/learn/${attempt.id}?duoAssessment=${encodeURIComponent(assessment.id)}`);
  await expect(page.locator(".questions-card")).toBeVisible();
  await expect(page.getByText(`${source.questions.length} câu trong phần này`, { exact: true })).toBeVisible();
  await expect(page.locator(".questions-card input:checked")).toHaveCount(0);
  if (source.skill === "listening") await expect(page.locator(".reading-passage")).toHaveCount(0);
  for (const block of source.sections.flatMap(section => section.questionBlocks ?? [])) await completionWidget(page, block);

  const fieldQuestions = source.questions.filter(question => !question.blockId);
  await expect(page.locator("fieldset.practice-question")).toHaveCount(fieldQuestions.length);
  for (const question of source.questions) {
    const answers = options(question);
    if (answers.length) {
      const field = questionField(page, question.number);
      await expect(field).toHaveCount(1);
      await expect(field.getByRole("radio")).toHaveCount(answers.length);
      if (question.groupInstructions) {
        await expect(field.locator("p.question-limit").filter({ hasText: question.groupInstructions })).toBeVisible();
      }
      const correct = answers.indexOf(question.answer);
      expect(correct).toBeGreaterThanOrEqual(0);
      await field.getByRole("radio").nth(correct).check();
    } else {
      const input = page.getByRole("textbox", { name: `Câu ${question.number}`, exact: true });
      await expect(input).toHaveValue("");
      await input.fill(question.answer);
    }
  }
  await expect(page.getByText(`${source.questions.length}/${source.questions.length} câu đã trả lời`, { exact: true })).toBeVisible();
  await expect.poll(async () => {
    const saved = await page.request.get(`/api/attempts/${attempt.id}`);
    return (await saved.json()).attempt.responses;
  }).toEqual(Object.fromEntries(source.questions.map(question => [question.id, question.answer])));
  await noOverflow(page);

  const listeningLayout = source.skill === "listening" ? source.sections[0]!.questionBlocks![0]!.type : null;
  if (listeningLayout === "table" || listeningLayout === "flow-chart") {
    const path = info.outputPath(`listening-${listeningLayout}-${info.project.name}.png`);
    await page.screenshot({ path, fullPage: true });
    await info.attach(`Listening ${listeningLayout}`, { path, contentType: "image/png" });
  }
  await page.getByRole("button", { name: "Nộp bài & xem phản hồi", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Nộp bài luyện của bạn?", exact: true });
  const submitted = page.waitForResponse(value => new URL(value.url()).pathname === `/api/attempts/${attempt.id}/submit` && value.request().method() === "POST");
  await confirm.getByRole("button", { name: "Nộp bài", exact: true }).click();
  const result = await submitted;
  expect(result.status()).toBe(200);
  const marked: Attempt = (await result.json()).attempt;
  expect(marked.status).toBe("submitted");
  expect(marked.feedback?.rawScore).toBe(source.questions.length);
  expect(marked.feedback?.total).toBe(source.questions.length);
  expect(marked.feedback?.answers.every(answer => answer.correct)).toBe(true);
  await expect(page.locator(".attempt-status")).toContainText("Đã nộp");
  await expect(page.locator(".answer-review > details")).toHaveCount(source.questions.length);
  await noOverflow(page);
  expect((await server.database.attempts.findOne({ _id: attempt.id }))?.duoAssessmentId).toBe(assessment.id);
}

for (const variant of variants) {
  test(`private Gate ${variant.sitting} renders ${variant.listening} Listening plus its different Reading controls and grades them`, async ({ page, browser, duoServer }, info) => {
    test.setTimeout(120_000);
    const assigned = await assignedGate(page, browser, duoServer, variant.sitting);
    try {
      const reading = assigned.sources.find(paper => paper.skill === "reading")!;
      const listening = assigned.sources.find(paper => paper.skill === "listening")!;
      expect(listening.sections[0]!.questionBlocks![0]!.type).toBe(variant.listening);
      expect(listening.questions.some(question => question.type === "choice")).toBe(true);
      expect(listening.questions.some(question => question.type === "matching" && !!question.groupInstructions)).toBe(true);
      if ("readingMatch" in variant) expect(reading.questions.some(question => question.questionType === variant.readingMatch)).toBe(true);
      if ("readingTfng" in variant) expect(reading.questions.some(question => question.type === "true-false")).toBe(true);
      await completeRenderedPaper(page, assigned.other, duoServer, assigned.assessment, reading, info);
      await completeRenderedPaper(page, assigned.other, duoServer, assigned.assessment, listening, info);
      if (variant.sitting === 12) {
        const grammar = assigned.sources.find(paper => paper.skill === "grammar")!;
        expect(grammar.sections[0]!.questionBlocks?.some(block => block.type === "sentence")).toBe(true);
        await completeRenderedPaper(page, assigned.other, duoServer, assigned.assessment, grammar, info);
      }
    } finally { await assigned.close(); }
  });
}
