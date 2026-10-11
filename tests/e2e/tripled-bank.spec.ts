import type { Locator, Page } from "@playwright/test";
import type { Db } from "mongodb";
import type { SpatialVisual, StoredContent, VisualAsset } from "../../shared/types";
import { test, expect, loginDemo, navigate, createAttempt, getAttempt, noHorizontalOverflow, capturePage } from "./fixtures";

// Read the real expanded seed in the isolated E2E database. Do not replace its
// prompts, geometry, labels, keys or model answers with browser-only fixtures.
async function seededLesson(db: Db, id: string): Promise<StoredContent> {
  const source = await db.collection<StoredContent>("content").findOne({ id });
  if (!source) throw new Error(`Missing actual expanded lesson: ${id}`);
  expect(source.format).toBe("lesson");
  return source;
}

async function visibleAsset(figure: Locator, visual: VisualAsset) {
  await expect(figure).toBeVisible();
  await expect(figure).toHaveAttribute("data-visual-type", visual.type);
  await expect(figure.locator("figcaption > strong")).toHaveText(visual.title);
  if (visual.type === "table") {
    await expect(figure.getByRole("table")).toBeVisible();
    await expect(figure.locator("tbody tr")).toHaveCount(visual.rows.length);
    for (const series of visual.series) {
      await expect(figure.getByRole("columnheader", { name: series, exact: true })).toBeVisible();
    }
    return;
  }
  const svg = figure.locator("svg[role=img]");
  await expect(svg).toBeVisible();
  const geometry = await svg.evaluate((element) => {
    const canvas = element as SVGSVGElement;
    const box = canvas.viewBox.baseVal;
    const labels = Array.from(canvas.querySelectorAll("text"), (label) => {
      const rect = label.getBBox();
      // getBBox uses the text element's local coordinates. The compass glyph
      // lives in a translated group, so compare its transformed corners in
      // the root SVG viewBox, as we do for every other visible caption.
      const transform = canvas.getCTM()!.inverse().multiply(label.getCTM()!);
      const corners = [
        [rect.x, rect.y], [rect.x + rect.width, rect.y],
        [rect.x, rect.y + rect.height], [rect.x + rect.width, rect.y + rect.height],
      ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(transform));
      const left = Math.min(...corners.map((point) => point.x));
      const top = Math.min(...corners.map((point) => point.y));
      const right = Math.max(...corners.map((point) => point.x));
      const bottom = Math.max(...corners.map((point) => point.y));
      const lines = Array.from(label.querySelectorAll("tspan"), (span) => span.textContent || "");
      return {
        text: (lines.length ? lines.join(" ") : label.textContent || "").replace(/\s+/gu, " ").trim(),
        x: left, y: top, width: right - left, height: bottom - top,
        font: getComputedStyle(label).fontFamily,
        caption: label.classList.contains("visual-label"),
      };
    });
    return { width: box.width, height: box.height, labels };
  });
  expect(geometry.labels.length, `${visual.title}: visible SVG lettering`).toBeGreaterThan(0);
  for (const label of geometry.labels) {
    expect(label.width, `${visual.title}: ${label.text}`).toBeGreaterThan(0);
    expect(label.height).toBeGreaterThan(0);
    expect(label.font).toContain("Be Vietnam Pro");
    expect(label.x, `${visual.title}: caption left bound`).toBeGreaterThanOrEqual(-1);
    expect(label.y, `${visual.title}: caption top bound`).toBeGreaterThanOrEqual(-1);
    expect(label.x + label.width, `${visual.title}: caption right bound`).toBeLessThanOrEqual(geometry.width + 1);
    expect(label.y + label.height, `${visual.title}: caption bottom bound`).toBeLessThanOrEqual(geometry.height + 1);
  }
  const captions = geometry.labels.filter((label) => label.caption);
  for (let first = 0; first < captions.length; first++) {
    for (let second = first + 1; second < captions.length; second++) {
      const a = captions[first], b = captions[second];
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      expect(overlapX > 1 && overlapY > 1, `${visual.title}: captions overlap (${a.text}; ${b.text})`).toBeFalsy();
    }
  }
  if (["map", "plan", "process", "diagram"].includes(visual.type)) {
    const spatial = visual as SpatialVisual;
    expect(geometry.width).toBe(spatial.width);
    expect(geometry.height).toBe(spatial.height);
    for (const node of spatial.nodes || []) {
      if (!node.text || node.questionNumber != null) continue;
      const caption = captions.find((label) => label.text === node.text);
      expect(caption, `${visual.title}: stage caption ${node.text}`).toBeDefined();
      expect(caption!.x).toBeGreaterThanOrEqual(node.x - 1);
      expect(caption!.y).toBeGreaterThanOrEqual(node.y - 1);
      expect(caption!.x + caption!.width).toBeLessThanOrEqual(node.x + node.width + 1);
      expect(caption!.y + caption!.height).toBeLessThanOrEqual(node.y + node.height + 1);
    }
  }
}

async function submitWriting(page: Page) {
  await page.getByRole("textbox", { name: "Bài viết Task 1", exact: true }).fill(
    "The two plans illustrate changes to the first floor of a library. Overall, the renovated layout offers more varied study facilities while retaining the staff room and computer desks. I would compare the northern study spaces before describing the replacement of the storage room in the south.",
  );
  await page.getByRole("button", { name: "Nộp bài & xem phản hồi", exact: true }).click();
  await page.getByRole("dialog", { name: "Nộp bài luyện của bạn?", exact: true })
    .getByRole("button", { name: "Nộp bài", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Phản hồi bài luyện", exact: true })).toBeVisible();
}

test("actual tripled bank renders before/after plans, process, mixed charts and numbered exam diagrams without exposing active keys", async ({ page, db }) => {
  await loginDemo(page);
  const ids = [
    "fresh-x3-w-lesson-library-floor",
    "fresh-x3-w-lesson-seawater-treatment",
    "fresh-x3-w-lesson-cycling-safety",
    "fresh-x3-l-lesson-013",
    "fresh-x3-r-lesson-13",
  ];
  for (const id of ids) {
    const source = await seededLesson(db, id);
    const attempt = await createAttempt(page, source, source.skill === "writing" ? "practice" : "exam");
    expect(attempt.feedback).toBeNull();
    expect(attempt.content).not.toHaveProperty("referenceAnswers");
    for (const question of attempt.content.questions) {
      expect(question).not.toHaveProperty("answer");
      expect(question).not.toHaveProperty("acceptedAnswers");
      expect(question).not.toHaveProperty("explanation");
      expect(question).not.toHaveProperty("evidence");
    }
    await navigate(page, `/learn/${attempt.id}`);
    await expect(page.locator(".answer-review, .reference-answer-card")).toHaveCount(0);
    await page.evaluate(async () => { await document.fonts.ready; });
    expect(await page.evaluate(() => Array.from(document.fonts).some((face) =>
      face.family.includes("Be Vietnam Pro") && face.status === "loaded")), "Vietnamese font is loaded").toBeTruthy();
    const visuals = source.sections.flatMap((section) => section.visuals || []);
    expect(visuals.length).toBeGreaterThan(0);
    const figures = page.locator(".section-visuals > .visual-frame > .content-visual");
    await expect(figures).toHaveCount(visuals.length);
    for (let index = 0; index < visuals.length; index++) {
      const visual = visuals[index];
      const figure = figures.nth(index);
      await visibleAsset(figure, visual);
      if (source.skill !== "writing") {
        const spatial = visual as SpatialVisual;
        const blanks = [...spatial.labels, ...(spatial.nodes || [])].filter((label) => label.questionNumber != null);
        expect(blanks.length).toBeGreaterThan(0);
        await expect(figure.locator('rect[stroke-dasharray="4 3"]')).toHaveCount(blanks.length);
        const svgText = (await figure.locator("svg").textContent() || "").toLowerCase();
        for (const blank of blanks) {
          expect(svgText).toContain(`blank for question ${blank.questionNumber}`);
          await expect(figure.locator("svg text").filter({ hasText: `${blank.questionNumber} ……` })).toBeVisible();
          const key = source.questions.find((question) => question.number === blank.questionNumber);
          expect(key).toBeDefined();
          expect(svgText, "A numbered visual must not name the hidden component or location").not.toContain(key!.answer.toLowerCase());
          await expect(page.getByRole("textbox", { name: `Câu ${blank.questionNumber}`, exact: true })).toBeVisible();
        }
      }
    }
    if (source.skill === "listening") await expect(page.locator(".reading-passage")).toHaveCount(0);
    await noHorizontalOverflow(page);
    await capturePage(page, `tripled-bank-${id}`);
    if (id === ids[0]) {
      await submitWriting(page);
      const completed = await getAttempt(page, attempt.id);
      expect(completed.status).toBe("submitted");
      expect(completed.feedback?.referenceAnswers).toEqual(source.referenceAnswers);
      await expect(page.locator(".reference-sample")).toHaveText(source.referenceAnswers![0].sampleAnswer);
      await noHorizontalOverflow(page);
    }
  }
});
