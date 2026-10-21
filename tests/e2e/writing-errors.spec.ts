import { randomUUID } from "node:crypto";
import type { Attempt, StoredContent } from "../../shared/types";
import { test, expect, duoLogin, noOverflow, submitUi } from "./duo-fixtures";

test("Writing keeps the saved essay after an actionable AI failure and can be submitted again", async ({ page, duoServer }) => {
  await duoLogin(page, duoServer, 0);
  const id = `writing-error-browser-${randomUUID()}`;
  const content: StoredContent = {
    id, skill: "writing", title: "Synthetic Writing error recovery", description: "An isolated submission check",
    topic: "Education", band: 5, cefr: "B1", testType: "both", durationMinutes: 40, format: "lesson",
    sections: [{ id: `${id}-task2`, title: "Task 2", task: 2,
      text: "Should public libraries provide more practical classes? Explain your opinion.",
      instructions: "Write at least 250 words." }],
    questions: [], vocabularyIds: [], tags: ["synthetic-writing-error"], source: "authored",
    quality: "authored-unreviewed", createdAt: new Date().toISOString(),
  };
  await duoServer.database.content.insertOne({ ...content, _id: id });
  const started = await page.request.post("/api/attempts", { data: { contentId: id, mode: "practice" } });
  expect(started.status()).toBe(201);
  const attempt: Attempt = (await started.json()).attempt;
  const essay = "Public libraries can make learning accessible to residents who cannot afford private courses. "
    + "Practical workshops give people an opportunity to develop useful skills and meet other learners.\n\n"
    + "However, libraries should protect quiet reading areas and use a separate room for group activities.";
  await page.goto(`/learn/${attempt.id}`);
  const editor = page.getByRole("textbox", { name: "Bài viết Task 2", exact: true });
  await editor.fill(essay);
  let failed = false;
  const message = "AI trả về bằng chứng không có trong bài. Bài nháp vẫn được giữ; hãy thử chấm lại.";
  await page.route(`**/api/attempts/${attempt.id}/submit`, async route => {
    if (!failed) {
      failed = true;
      await route.fulfill({ status: 502, json: { error: message, code: "AI_EVIDENCE_INVALID" } });
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Nộp bài & xem phản hồi", exact: true }).click();
  await page.getByRole("dialog", { name: "Nộp bài luyện của bạn?", exact: true })
    .getByRole("button", { name: "Nộp bài", exact: true }).click();
  await expect(page.getByText(message, { exact: true })).toBeVisible();
  await expect(editor).toHaveValue(essay);
  await expect(editor).toBeEnabled();
  const saved = await duoServer.database.attempts.findOne({ _id: attempt.id });
  expect(saved?.essays).toEqual({ [content.sections[0].id]: essay });
  expect(saved?.status).toBe("in-progress");
  expect(saved?.feedback).toBeNull();
  expect(await duoServer.database.attempts.countDocuments({ contentId: id })).toBe(1);
  await noOverflow(page);
  // The browser fixture has no provider key. The real retry stores its honest
  // checklist with no invented band; native HTTP tests cover AI scoring retry.
  await submitUi(page);
  const completed = await duoServer.database.attempts.findOne({ _id: attempt.id });
  expect(completed?.status).toBe("submitted");
  expect(completed?.essays).toEqual(saved?.essays);
  expect(completed?.feedback?.estimatedBand).toBeNull();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Bài viết Task 2", exact: true })).toHaveValue(essay);
  await expect(page.locator(".attempt-status")).toContainText("Đã nộp");
  await noOverflow(page);
});
