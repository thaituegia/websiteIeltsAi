import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import type { Attempt, StoredContent } from "../../shared/types";
import { test, expect, duoLogin, type DuoBrowserServer } from "./duo-fixtures";

async function createTimedReading(page: Page, server: DuoBrowserServer): Promise<Attempt> {
  await duoLogin(page, server, 0);
  const id = "synthetic-clock-" + randomUUID();
  const content: StoredContent = {
    id, title: "A short timetable check", description: "Synthetic browser clock fixture", topic: "Education",
    skill: "reading", band: 3, cefr: "A2", testType: "both", durationMinutes: 1, format: "lesson",
    sections: [{ id: id + "-source", title: "Reading", text: "A tray protects the floor." }],
    questions: [{ id: id + "-question", number: 1, sectionIndex: 0, type: "text", questionType: "short-answer",
      prompt: "What protects the floor?", wordLimit: 2, subskill: "locating-details", answer: "tray",
      evidence: "A tray protects the floor.", explanation: "The text identifies a tray." }],
    vocabularyIds: [], tags: [], source: "authored", quality: "authored-unreviewed", createdAt: new Date().toISOString(),
  };
  await server.database.content.insertOne({ ...content, _id: id });
  const response = await page.request.post("/api/attempts", { data: { contentId: id, mode: "exam" } });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).attempt;
}

async function installWallClockSkew(page: Page, offset: number) {
  await page.addInitScript(skew => {
    const target = window as typeof window & { syntheticClockSkew: number };
    const original = Date.now.bind(Date);
    target.syntheticClockSkew = skew;
    Date.now = () => original() + target.syntheticClockSkew;
  }, offset);
}

async function remaining(page: Page): Promise<number> {
  const value = await page.locator(".attempt-timer").innerText();
  const match = /(\d+):(\d+)/u.exec(value);
  expect(match, value).not.toBeNull();
  return Number(match![1]) * 60 + Number(match![2]);
}

for (const offset of [6 * 60 * 60_000, -6 * 60 * 60_000]) {
  test(`attempt deadline follows server with device clock ${offset > 0 ? "ahead" : "behind"} and later clock jumps`, async ({ page, duoServer }) => {
    const attempt = await createTimedReading(page, duoServer);
    await installWallClockSkew(page, offset);
    let submissions = 0;
    page.on("request", request => {
      if (new URL(request.url()).pathname === `/api/attempts/${attempt.id}/submit` && request.method() === "POST") submissions++;
    });
    await page.goto(`/learn/${attempt.id}`);
    const answer = page.getByRole("textbox", { name: "Câu 1", exact: true });
    await expect(answer).toBeEnabled();
    const initial = await remaining(page);
    expect(initial).toBeGreaterThan(45); expect(initial).toBeLessThanOrEqual(60);
    await answer.fill("A tray");
    await expect(page.locator(".draft-status")).toHaveText("Đã lưu");
    const beforeJump = await remaining(page);
    await page.evaluate(skew => { (window as typeof window & { syntheticClockSkew: number }).syntheticClockSkew = skew; }, -offset * 2);
    await page.waitForTimeout(1600);
    const afterJump = await remaining(page);
    expect(afterJump).toBeLessThanOrEqual(beforeJump);
    expect(afterJump).toBeGreaterThan(beforeJump - 5);
    await expect(answer).toBeEnabled(); await expect(answer).toHaveValue("A tray");
    expect(submissions).toBe(0);
    expect((await duoServer.database.attempts.findOne({ _id: attempt.id }))?.status).toBe("in-progress");
    expect(new URL(page.url()).pathname).toBe(`/learn/${attempt.id}`);
  });
}

test("an early timeout is refused by the server, keeps editing, and a real deadline later submits only saved answers", async ({ page, duoServer }) => {
  const attempt = await createTimedReading(page, duoServer);
  let badSample = true;
  const automatic: boolean[] = [];
  await page.route(`**/api/attempts/${attempt.id}`, async route => {
    if (route.request().method() !== "GET" || !badSample) return route.continue();
    badSample = false;
    const response = await route.fetch();
    const body = await response.json();
    body.attempt.serverNow = new Date(Date.parse(body.attempt.serverNow) + 6 * 60 * 60_000).toISOString();
    await route.fulfill({ response, json: body });
  });
  await page.route(`**/api/attempts/${attempt.id}/submit`, async route => {
    automatic.push(route.request().postDataJSON()?.timedOut === true);
    await route.continue();
  });
  await page.goto(`/learn/${attempt.id}`);
  const answer = page.getByRole("textbox", { name: "Câu 1", exact: true });
  await expect(answer).toBeEnabled();
  await expect.poll(() => automatic.length).toBe(1);
  expect(automatic).toEqual([true]);
  expect(await remaining(page)).toBeGreaterThan(40);
  expect((await duoServer.database.attempts.findOne({ _id: attempt.id }))?.status).toBe("in-progress");
  await answer.fill("A tray");
  await expect(page.locator(".draft-status")).toHaveText("Đã lưu");
  const stored = await duoServer.database.attempts.findOne({ _id: attempt.id });
  expect(stored?.responses[attempt.content.questions[0].id]).toBe("A tray");
  // This isolated fixture deliberately disables tab integrity. A reload here
  // resamples a shortened server deadline; strict reload policy is tested by
  // the separate integrity suite and is not weakened by this clock test.
  await duoServer.database.attempts.updateOne({ _id: attempt.id }, { $set: { deadlineAt: new Date(Date.now() + 4000).toISOString() } });
  await page.reload();
  await expect(page.locator(".answer-review")).toBeVisible({ timeout: 12_000 });
  expect(automatic).toEqual([true, true]);
  const finished = await duoServer.database.attempts.findOne({ _id: attempt.id });
  expect(finished?.status).toBe("submitted"); expect(finished?.feedback?.rawScore).toBe(1);
  expect(finished?.responses[attempt.content.questions[0].id]).toBe("A tray");
  expect(new URL(page.url()).pathname).toBe(`/learn/${attempt.id}`);
});
