import type { Locator, Page, Route } from "@playwright/test";
import type { Attempt } from "../../shared/types";
import { test, expect, duoLogin, finishPlacement, noOverflow } from "./duo-fixtures";

function waveform(seconds = 24): Buffer {
  const samples = 16_000 * seconds;
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16_000, 24); bytes.writeUInt32LE(32_000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  for (let index = 0; index < samples; index++)
    bytes.writeInt16LE(Math.round(1_000 * Math.sin(index / 16_000 * Math.PI * 600)), 44 + index * 2);
  return bytes;
}

// Native browser decoding/seeking uses controlled WAV bytes. Backend tests
// separately cover authenticated ready-cache reads and real GridFS byte ranges.
async function fulfillWaveform(route: Route, bytes: Buffer) {
  const range = route.request().headers().range;
  const match = range?.match(/^bytes=(\d+)-(\d*)$/);
  const start = match ? Number(match[1]) : 0;
  const end = match?.[2] ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1;
  if (start > end || start >= bytes.length) {
    await route.fulfill({ status: 416, headers: { "Content-Range": `bytes */${bytes.length}` } });
    return;
  }
  await route.fulfill({ status: match ? 206 : 200, body: bytes.subarray(start, end + 1), headers: {
    "Content-Type": "audio/wav", "Accept-Ranges": "bytes", "Cache-Control": "private, no-store",
    "Content-Length": String(end - start + 1), ...(match ? { "Content-Range": `bytes ${start}-${end}/${bytes.length}` } : {}),
  } });
}

async function verifySeeking(player: Locator) {
  const audio = player.locator("audio");
  const slider = player.getByRole("slider");
  await expect(slider).toBeEnabled();
  await expect.poll(() => audio.evaluate(node => (node as HTMLAudioElement).duration)).toBe(24);
  await slider.fill("8");
  await expect.poll(() => audio.evaluate(node => (node as HTMLAudioElement).currentTime)).toBeCloseTo(8, 1);
  await player.getByRole("button", { name: "Tiến 10 giây", exact: true }).click();
  await expect.poll(() => audio.evaluate(node => (node as HTMLAudioElement).currentTime)).toBeCloseTo(18, 1);
  await player.getByRole("button", { name: "Lùi 10 giây", exact: true }).click();
  await expect.poll(() => audio.evaluate(node => (node as HTMLAudioElement).currentTime)).toBeCloseTo(8, 1);
  await player.getByRole("combobox").selectOption("0.75");
  await expect.poll(() => audio.evaluate(node => (node as HTMLAudioElement).playbackRate)).toBe(0.75);
  // Replaying is a browser media operation; it never creates another sitting.
  await audio.evaluate(async node => {
    const media = node as HTMLAudioElement;
    media.currentTime = 0; await media.play(); media.pause();
  });
  await expect(slider).toBeEnabled();
}

async function startAttempt(page: Page, contentId: string, mode: "practice" | "exam"): Promise<Attempt> {
  const response = await page.request.post("/api/attempts", { data: { contentId, mode } });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).attempt;
}

test("submitted Listening keeps replay and a real seek bar beside the selected transcript", async ({ page, duoServer }) => {
  await duoLogin(page, duoServer, 0);
  const content = await duoServer.database.content.findOne({ skill: "listening", format: "full-mock" });
  if (!content) throw new Error("Missing isolated Listening mock");
  const attempt = await startAttempt(page, content.id, "exam");
  await page.goto(`/learn/${attempt.id}`);
  await expect(page.locator(".listening-player")).toBeVisible();
  await expect(page.locator(".review-audio-player")).toHaveCount(0);
  await expect(page.getByRole("slider")).toHaveCount(0);
  const result = await page.request.post(`/api/attempts/${attempt.id}/submit`);
  expect(result.ok(), await result.text()).toBeTruthy();
  const before = await duoServer.database.attempts.findOne({ _id: attempt.id });
  const requests: string[] = [];
  await page.route(/\/api\/attempts\/[^/]+\/listening-audio\?sectionIndex=\d+$/, async route => {
    expect(route.request().method()).toBe("GET");
    requests.push(route.request().url());
    await fulfillWaveform(route, waveform());
  });
  await page.reload();
  const player = page.locator(".listening-review-player .review-audio-player");
  await verifySeeking(player);
  await expect(page.locator(".passage-card .reading-passage")).toBeVisible();
  await expect(page.locator(".answer-review-card")).toBeVisible();
  await page.getByRole("group", { name: "Phần của bài tập", exact: true }).getByRole("button").nth(1).click();
  await expect(player.locator("audio")).toHaveAttribute("src", /sectionIndex=1$/);
  await verifySeeking(player);
  expect(requests.some(url => url.endsWith("sectionIndex=0"))).toBeTruthy();
  expect(requests.some(url => url.endsWith("sectionIndex=1"))).toBeTruthy();
  expect(await duoServer.database.attempts.findOne({ _id: attempt.id })).toEqual(before);
  await noOverflow(page);
});

test("a failed review audio load leaves answers usable and can be retried inline", async ({ page, duoServer }) => {
  await duoLogin(page, duoServer, 0);
  const content = await duoServer.database.content.findOne({ skill: "listening", format: "lesson" });
  if (!content) throw new Error("Missing isolated Listening lesson");
  const attempt = await startAttempt(page, content.id, "practice");
  const response = await page.request.post(`/api/attempts/${attempt.id}/submit`);
  expect(response.ok(), await response.text()).toBeTruthy();
  let ready = false;
  await page.route(/\/api\/attempts\/[^/]+\/listening-audio\?sectionIndex=\d+$/, async route => {
    if (!ready) await route.fulfill({ status: 503, json: { error: "Controlled audio delivery failure" } });
    else await fulfillWaveform(route, waveform());
  });
  await page.goto(`/learn/${attempt.id}`);
  const player = page.locator(".listening-review-player .review-audio-player");
  await expect(player.locator(".notice[role='status']")).toContainText("Chưa tải được âm thanh đã lưu");
  await expect(page.locator(".answer-review-card")).toBeVisible();
  ready = true;
  await player.getByRole("button", { name: "Thử lại âm thanh", exact: true }).click();
  await verifySeeking(player);
  await expect(player.locator(".notice[role='status']")).toHaveCount(0);
  await noOverflow(page);
});

test("an intermediate Duo review uses its document header and keeps the resulting audio seekable", async ({ page, duoServer }) => {
  await duoLogin(page, duoServer, 0);
  const content = await duoServer.database.content.findOne({ skill: "listening", format: "lesson" });
  if (!content) throw new Error("Missing isolated Listening lesson");
  const attempt = await startAttempt(page, content.id, "practice");
  const submitted = await page.request.post(`/api/attempts/${attempt.id}/submit`);
  expect(submitted.ok(), await submitted.text()).toBeTruthy();
  // A narrow transport fixture represents a submitted part while its parent
  // assessment remains active. Native API tests exercise the real Duo guard.
  await page.route(`**/api/attempts/${attempt.id}`, async route => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { attempt: {
      ...body.attempt, duoAssessmentId: "synthetic-review-assessment",
      integrity: { status: "active", phase: "answering" },
    } } });
  });
  await page.route("**/api/duo/assessments/synthetic-review-assessment", route => route.fulfill({ json: { assessment: { roomId: null } } }));
  const headers: string[] = [];
  await page.route(/\/api\/attempts\/[^/]+\/listening-audio\?sectionIndex=\d+$/, async route => {
    headers.push(route.request().headers()["x-exam-tab"] || "");
    await fulfillWaveform(route, waveform());
  });
  await page.goto(`/learn/${attempt.id}`);
  const player = page.locator(".listening-review-player .review-audio-player");
  await verifySeeking(player);
  await expect(player.locator("audio")).toHaveAttribute("src", /^blob:/);
  expect(headers).toHaveLength(1);
  expect(headers[0]).toMatch(/^[a-f0-9-]{36}$/);
  await noOverflow(page);
});

test("Speaking recording survives reload, seeks through native authenticated audio, and labels transcript provenance", async ({ page, duoServer }) => {
  await duoLogin(page, duoServer, 0);
  const content = await duoServer.database.content.findOne({ skill: "speaking", format: "lesson" });
  if (!content) throw new Error("Missing isolated Speaking lesson");
  const attempt = await startAttempt(page, content.id, "practice");
  const text = "I enjoy studying in our community library because the quiet rooms help me concentrate. Last weekend I met a friend there and we planned a new reading club.";
  const submitted = await page.request.post(`/api/attempts/${attempt.id}/speaking`, { multipart: {
    transcript: text, audio: { name: "synthetic-review.wav", mimeType: "audio/wav", buffer: waveform() },
  } });
  expect(submitted.ok(), await submitted.text()).toBeTruthy();
  await page.goto(`/learn/${attempt.id}`);
  const review = page.locator(".speaking-recording-review");
  await verifySeeking(review.locator(".review-audio-player"));
  await expect(review.getByRole("heading", { name: "Transcript bạn đã nhập", exact: true })).toBeVisible();
  await expect(review).toContainText("chưa được xác nhận bằng nhận dạng giọng nói");
  await expect(review.locator(".feedback-transcript").first()).toHaveText(text);
  await review.getByText("Đối chiếu đề và câu hỏi Speaking", { exact: true }).click();
  await expect(review.locator(".speaking-saved-prompts")).toContainText("Câu hỏi gốc được lưu cùng bài nộp");
  await page.reload();
  await verifySeeking(review.locator(".review-audio-player"));
  await expect(review.locator("audio")).toHaveAttribute("src", `/api/attempts/${attempt.id}/audio`);
  // Synthetic persisted recognition data checks its label; no provider is called.
  await duoServer.database.attempts.updateOne({ _id: attempt.id }, { $set: {
    "feedback.transcriptSource": "speech-recognition", "feedback.transcript": "The library helps me concentrate.",
  } });
  await page.reload();
  await expect(review.getByRole("heading", { name: "Transcript AI nghe được", exact: true })).toBeVisible();
  await expect(review).toContainText("Phiên âm có thể nghe nhầm");
  await duoServer.database.attempts.updateOne({ _id: attempt.id }, { $unset: { "feedback.transcriptSource": "" } });
  await page.reload();
  await expect(review.getByRole("heading", { name: "Transcript đã lưu", exact: true })).toBeVisible();
  await expect(review).toContainText("Bài cũ chưa lưu nguồn transcript");
  await noOverflow(page);
});

test("completed placement Listening answers replay with their own transcript without reopening the test", async ({ page, duoServer }) => {
  await duoLogin(page, duoServer, 0);
  const placement = await finishPlacement(page, duoServer);
  const answer = placement.result?.answers.find(item => item.skill === "listening");
  if (!answer) throw new Error("Completed isolated placement did not include Listening");
  await page.route(/\/api\/placement\/[^/]+\/audio\?questionId=[^&]+$/, async route => {
    expect(route.request().method()).toBe("GET");
    await fulfillWaveform(route, waveform());
  });
  await page.goto(`/placement?review=${placement.id}`);
  const details = page.locator(".answer-review details").filter({ has: page.locator("h4").filter({ hasText: answer.prompt! }) });
  await details.evaluate(node => { (node as HTMLDetailsElement).open = true; });
  await details.getByRole("button", { name: "Xem nội dung gốc / transcript", exact: true }).click();
  await verifySeeking(details.locator(".review-audio-player"));
  await expect(details.locator(".answer-context")).toContainText(answer.context!);
  await expect(page.locator(".placement-question")).toHaveCount(0);
  await noOverflow(page);
});
