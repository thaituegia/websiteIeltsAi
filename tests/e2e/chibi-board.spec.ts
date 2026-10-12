import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Page, TestInfo } from "@playwright/test";
import type { DuoAssessmentView, DuoRole } from "../../shared/duo";
import {
  test,
  expect,
  duoAccounts,
  duoLogin,
  duoSnapshot,
  finishPlacement,
  objectiveAttempt,
  noOverflow,
} from "./duo-fixtures";

// Only synthetic Duo accounts and the fixture's disposable Mongo database are used.
// Progress comes from completed objective attempts; clicking the map is navigation.
async function preview(page: Page, info: TestInfo, state: string) {
  const directory = join(process.cwd(), ".local", "chibi-preview");
  await mkdir(directory, { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: join(directory, `${info.project.name}-plan-${state}.png`),
    fullPage: true,
    animations: "disabled",
  });
  await page.screenshot({
    path: join(directory, `${info.project.name}-plan-${state}-viewport.png`),
    animations: "disabled",
  });
  await page.locator(".duo-campaign-map").screenshot({
    path: join(directory, `${info.project.name}-plan-${state}-board.png`),
    animations: "disabled",
    // Hide fixed chrome only during the clipped board capture, not in the app.
    style: ".mobile-bar { visibility: hidden !important; }",
  });
}

async function position(
  page: Page,
  role: DuoRole,
  lesson: number,
  state: "next-lesson" | "waiting-gate",
) {
  const name = duoAccounts.find((account) => account.role === role)!.name;
  const pawn = page.getByTestId(`duo-pawn-${role}`);
  await expect(pawn).toBeVisible();
  await expect(pawn).toHaveAttribute("data-lesson-number", String(lesson));
  await expect(pawn).toHaveAttribute("data-position-state", state);
  await expect(pawn).toHaveAccessibleName(
    new RegExp(`${name}.*${state === "waiting-gate" ? "Chờ Duo Gate" : "Buổi tiếp theo"}`),
  );
  await expect(pawn).toHaveAccessibleName(new RegExp(`Buổi\\s+0?${lesson}\\b`));
  const summary = page.locator(`.duo-position-summary[data-role="${role}"]`);
  await expect(summary).toBeVisible();
  await expect(summary).toContainText(name);
}

async function sharedCheckpointLabels(page: Page) {
  for (const account of duoAccounts) {
    const chip = page.getByTestId(`duo-pawn-${account.role}`).locator(".duo-pawn-name");
    await expect(chip).toBeVisible();
    await expect(chip).toHaveText(account.name.split(" ").at(-1)!);
  }
  const bounds = await page.evaluate(() => {
    const rectangle = (element: Element) => {
      const { left, right, top, bottom } = element.getBoundingClientRect();
      return { left, right, top, bottom };
    };
    return {
      board: rectangle(document.querySelector(".duo-board")!),
      chips: [...document.querySelectorAll(".duo-board-pawn .duo-pawn-name")].map(rectangle),
    };
  });
  expect(bounds.chips).toHaveLength(2);
  const [husband, wife] = bounds.chips;
  const overlapWidth = Math.min(husband.right, wife.right) - Math.max(husband.left, wife.left);
  const overlapHeight = Math.min(husband.bottom, wife.bottom) - Math.max(husband.top, wife.top);
  expect(
    overlapWidth > 1 && overlapHeight > 1,
    "Both name chips must remain readable when two pawns share the checkpoint",
  ).toBe(false);
  for (const chip of bounds.chips) {
    expect(chip.left, "The board must not clip a pawn's name").toBeGreaterThanOrEqual(bounds.board.left - 2);
    expect(chip.right, "The board must not clip a pawn's name").toBeLessThanOrEqual(bounds.board.right + 2);
    expect(chip.top).toBeGreaterThanOrEqual(bounds.board.top - 2);
    expect(chip.bottom).toBeLessThanOrEqual(bounds.board.bottom + 2);
  }
}

async function vietnameseFont(page: Page) {
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    const faces = await document.fonts.load(
      '700 20px "Be Vietnam Pro"',
      "Hai người đồng hành · Chờ cổng kiến thức · Buổi tiếp theo",
    );
    return {
      loaded: faces.length > 0 && faces.every((face) => face.status === "loaded"),
      body: getComputedStyle(document.body).fontFamily,
      heading: getComputedStyle(document.querySelector("h1")!).fontFamily,
    };
  });
  expect(fonts.loaded, "The self-hosted Vietnamese font must load").toBeTruthy();
  expect(fonts.body).toContain("Be Vietnam Pro");
  expect(fonts.heading).toContain("Be Vietnam Pro");
}

test("two chibi pawns follow each learner's real lessons and wait at a shared gate", async ({
  page,
  browser,
  duoServer,
}, info) => {
  test.setTimeout(150_000);
  await duoLogin(page, duoServer, 0);
  await finishPlacement(page, duoServer, false);
  const partnerContext = await browser.newContext({ baseURL: duoServer.url });
  const partner = await partnerContext.newPage();
  try {
    await duoLogin(partner, duoServer, 1);
    await finishPlacement(partner, duoServer, false);
    const initial = await duoSnapshot(page);
    const band = initial.bands.find((item) => item.band === initial.path!.currentBand)!;
    const first = band.lessons[0];
    const gate = band.gates[0];
    const checkpoint = band.lessons.find((lesson) => lesson.number === gate.afterLesson)!;
    const afterGate = band.lessons.find((lesson) => lesson.number === gate.afterLesson + 1)!;
    const complete = async (learner: Page, lesson: typeof first) => {
      const attempt = await objectiveAttempt(learner, duoServer, lesson.contentId!);
      const response = await learner.request.post(`/api/duo/lessons/${lesson.id}/complete`, {
        data: { attemptId: attempt.id },
      });
      expect(response.ok(), await response.text()).toBeTruthy();
    };
    await page.goto(`${duoServer.url}/plan`);
    await expect(page.locator(".duo-member-pawn")).toHaveCount(2);
    await position(page, "husband", first.number, "next-lesson");
    await position(page, "wife", first.number, "next-lesson");
    const husbandBox = (await page.getByTestId("duo-pawn-husband").boundingBox())!;
    const wifeBox = (await page.getByTestId("duo-pawn-wife").boundingBox())!;
    expect(
      Math.abs(husbandBox.x - wifeBox.x) + Math.abs(husbandBox.y - wifeBox.y),
      "Two learners at the same lesson must have separately visible pieces",
    ).toBeGreaterThan(8);
    await vietnameseFont(page);
    await noOverflow(page);
    await preview(page, info, "initial");

    // Selecting a locked map stop focuses its real card without granting progress.
    await page.getByRole("link", { name: new RegExp(`^Buổi ${afterGate.number}:`) }).click();
    await expect(page.getByTestId(`duo-lesson-${afterGate.number}`)).toBeFocused();
    await expect(page.getByTestId(`duo-lesson-${afterGate.number}`).getByRole("button")).toBeDisabled();
    const afterNavigation = await duoSnapshot(page);
    expect(afterNavigation.path).toEqual(initial.path);
    expect(afterNavigation.bands).toEqual(initial.bands);
    await position(page, "husband", first.number, "next-lesson");
    await position(page, "wife", first.number, "next-lesson");

    await complete(page, first);
    const oneFinished = await duoSnapshot(page);
    expect(oneFinished.bands.find((item) => item.band === band.band)!.lessons[0].completed).toEqual({
      husband: true,
      wife: false,
    });
    await page.reload();
    await position(page, "husband", band.lessons[1].number, "next-lesson");
    await position(page, "wife", first.number, "next-lesson");
    await expect(page.locator(".duo-board-stop.partial")).toHaveCount(1);
    await noOverflow(page);
    await preview(page, info, "independent");

    for (const lesson of band.lessons.filter(
      (item) => item.number > first.number && item.number <= checkpoint.number,
    ))
      await complete(page, lesson);
    await page.reload();
    await position(page, "husband", checkpoint.number, "waiting-gate");
    await position(page, "wife", first.number, "next-lesson");
    expect((await duoSnapshot(page)).bands.find((item) => item.band === band.band)!.gates[0].eligible).toBe(false);
    await expect(page.getByTestId(`duo-lesson-${afterGate.number}`).getByRole("button")).toBeDisabled();

    for (const lesson of band.lessons.filter((item) => item.number <= checkpoint.number))
      await complete(partner, lesson);
    const start = await page.request.post(`/api/duo/gates/${gate.id}/start`);
    expect(start.ok(), await start.text()).toBeTruthy();
    const assessment: DuoAssessmentView = (await start.json()).assessment;
    for (const part of assessment.parts)
      await objectiveAttempt(page, duoServer, part.contentId, true, assessment.id);
    const onlyOnePassed = await duoSnapshot(page);
    const currentBand = onlyOnePassed.bands.find((item) => item.band === band.band)!;
    expect(currentBand.gates[0].results).toEqual({ husband: "passed", wife: null });
    expect(currentBand.gates[0].unlocked).toBe(false);
    expect(currentBand.lessons.find((lesson) => lesson.number === afterGate.number)!.unlocked).toBe(false);
    expect(onlyOnePassed.path).toEqual(initial.path);
    await page.reload();
    await position(page, "husband", checkpoint.number, "waiting-gate");
    await position(page, "wife", checkpoint.number, "waiting-gate");
    await expect(page.locator('.duo-position-summary[data-role="husband"]')).toContainText(
      "Đã đạt cổng này; chờ bạn đồng hành đạt",
    );
    await expect(page.locator('.duo-position-summary[data-role="wife"]')).toContainText(
      "Mỗi người làm Duo Gate riêng; cả hai đạt",
    );
    await sharedCheckpointLabels(page);
    await expect(page.getByTestId(`duo-lesson-${afterGate.number}`).getByRole("button")).toBeDisabled();
    await noOverflow(page);
    await preview(page, info, "waiting-gate");
  } finally {
    await partnerContext.close();
  }
});
