import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Page, Route } from "@playwright/test";
import type { Attempt } from "../../shared/types";
import { test, expect, duoLogin, noOverflow, submitUi, type DuoBrowserServer } from "./duo-fixtures";

const message = "Đánh giá âm thanh chưa đủ cấu trúc. Bản ghi vẫn được giữ; hãy thử lại.";
const recognized = "I enjoy walking through the public garden because the quiet paths help me relax. Last weekend I noticed new flowers beside the entrance.";

async function startSpeaking(page: Page, server: DuoBrowserServer): Promise<Attempt> {
  await duoLogin(page, server, 0);
  const content = await server.database.content.findOne({ skill: "speaking", format: "lesson" });
  if (!content) throw new Error("Missing isolated Speaking lesson");
  const response = await page.request.post("/api/attempts", { data: { contentId: content.id, mode: "practice" } });
  expect(response.status(), await response.text()).toBe(201);
  const attempt: Attempt = (await response.json()).attempt;
  await page.goto(`/learn/${attempt.id}`);
  await expect(page.getByRole("textbox", { name: "Transcript bài nói", exact: true })).toBeVisible();
  return attempt;
}

async function record(page: Page, again = false) {
  await page.getByRole("button", { name: again ? "Ghi âm lại" : "Bắt đầu ghi âm", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Đang ghi âm giọng của bạn", exact: true })).toBeVisible();
  await expect(page.getByText("Thời gian 00:01", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Dừng ghi âm", exact: true }).click();
  await expect(page.locator(".recording-playback audio")).toHaveAttribute("src", /^blob:/);
}

async function submitExpectingError(page: Page) {
  await page.getByRole("button", { name: "Nộp bài & xem phản hồi", exact: true }).click();
  await page.getByRole("dialog", { name: "Nộp bài luyện của bạn?", exact: true })
    .getByRole("button", { name: "Nộp bài", exact: true }).click();
  await expect(page.getByText(message, { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Transcript bài nói", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Nộp bài & xem phản hồi", exact: true })).toBeEnabled();
}

async function upload(route: Route): Promise<Buffer | null> {
  const bytes = route.request().postDataBuffer();
  if (!bytes) throw new Error("Speaking multipart body missing");
  const body = await new Response(new Uint8Array(bytes), {
    headers: { "Content-Type": route.request().headers()["content-type"] },
  }).formData();
  const value = body.get("audio");
  return value && typeof value !== "string" ? Buffer.from(await value.arrayBuffer()) : null;
}

/** Narrow server-progress fixture: real owned GridFS persistence, no AI calls. */
async function storeRecording(server: DuoBrowserServer, attempt: Attempt, bytes: Buffer | null, text = recognized) {
  const owner = await server.database.attempts.findOne({ _id: attempt.id });
  if (!owner) throw new Error("Missing disposable attempt");
  const previous = await server.database.audio.findOne({ userId: owner.userId, attemptId: owner.id });
  if (bytes) {
    expect(bytes.subarray(0, 4).toString()).toBe("RIFF");
    const stream = server.database.recordings.openUploadStream("synthetic-speaking-retry.wav", {
      contentType: "audio/wav", metadata: { userId: owner.userId, attemptId: owner.id },
    });
    const finish = once(stream, "finish"); stream.end(bytes); await finish;
    const metadata = { userId: owner.userId, attemptId: owner.id, fileId: stream.id, mime: "audio/wav",
      createdAt: new Date().toISOString(), recognizedTranscript: text };
    if (previous) {
      await server.database.audio.updateOne({ _id: previous._id }, { $set: metadata });
      await server.database.recordings.delete(previous.fileId);
    } else await server.database.audio.insertOne({ _id: randomUUID(), ...metadata });
  } else {
    expect(previous, "A no-file retry must use an existing owned recording").toBeTruthy();
    await server.database.audio.updateOne({ _id: previous!._id }, { $set: { recognizedTranscript: text } });
  }
  await server.database.attempts.updateOne({ _id: attempt.id }, { $set: { transcript: text } });
  return await server.database.audio.findOne({ userId: owner.userId, attemptId: owner.id });
}

async function failAfterReceipt(route: Route) {
  await route.fulfill({ status: 200, contentType: "text/event-stream", body:
    `event: progress\ndata: ${JSON.stringify({ stage: "transcribing" })}\n\n`
    + `event: error\ndata: ${JSON.stringify({ error: message, status: 502 })}\n\n`,
  });
}

test("Speaking retries an accepted capture and a reloaded saved recording without reuploading or fetching it", async ({ page, duoServer }) => {
  const attempt = await startSpeaking(page, duoServer);
  const sentFiles: boolean[] = [];
  const pointers: string[] = [];
  const fetchedAudio: string[] = [];
  page.on("request", request => {
    if (new URL(request.url()).pathname === `/api/attempts/${attempt.id}/audio`
      && request.method() === "GET" && request.resourceType() === "fetch") fetchedAudio.push(request.url());
  });
  await page.route(`**/api/attempts/${attempt.id}/speaking`, async route => {
    const bytes = await upload(route); sentFiles.push(Boolean(bytes));
    if (sentFiles.length <= 3) {
      const saved = await storeRecording(duoServer, attempt, bytes);
      pointers.push(saved!.fileId.toHexString());
      await failAfterReceipt(route);
    } else await route.continue();
  });
  await record(page);
  await submitExpectingError(page);
  await expect(page.getByRole("textbox", { name: "Transcript bài nói", exact: true })).toHaveValue(recognized);
  // Keep the exact local Blob available for playback after a failed grade.
  await expect(page.locator(".recording-playback audio")).toHaveAttribute("src", /^blob:/);
  expect(sentFiles).toEqual([true]);
  await submitExpectingError(page);
  expect(sentFiles).toEqual([true, false]);
  expect(pointers[1]).toBe(pointers[0]);
  await record(page, true);
  await submitExpectingError(page);
  expect(sentFiles).toEqual([true, false, true]);
  expect(pointers[2]).not.toBe(pointers[1]);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Transcript bài nói", exact: true })).toHaveValue(recognized);
  await expect(page.locator(".recording-playback audio")).toHaveAttribute("src", `/api/attempts/${attempt.id}/audio`);
  await submitUi(page);
  expect(sentFiles).toEqual([true, false, true, false]);
  expect(fetchedAudio).toEqual([]);
  const completed = await duoServer.database.attempts.findOne({ _id: attempt.id });
  expect(completed?.status).toBe("submitted"); expect(completed?.transcript).toBe(recognized);
  expect(completed?.feedback?.estimatedBand).toBeNull();
  const finalRecording = await duoServer.database.audio.findOne({ attemptId: attempt.id });
  expect(finalRecording?.fileId.toHexString()).toBe(pointers[2]);
  expect(await duoServer.database.db.collection("recordings.files").countDocuments()).toBe(1);
  await noOverflow(page);
});

test("an unacknowledged new capture is uploaded again even when an older saved recording exists", async ({ page, duoServer }) => {
  const attempt = await startSpeaking(page, duoServer);
  // The old recording is a genuine WAV captured by the fake microphone, then
  // acknowledged; a later new Blob must not inherit that acknowledgment.
  const sentFiles: boolean[] = [];
  let previousPointer = "";
  await page.route(`**/api/attempts/${attempt.id}/speaking`, async route => {
    const bytes = await upload(route); sentFiles.push(Boolean(bytes));
    if (sentFiles.length === 2) {
      // No progress receipt and no publication of this new upload. The old
      // audioAvailable flag cannot prove this local Blob reached the server.
      await route.fulfill({ status: 502, json: { error: message, code: "AI_RESPONSE_INVALID" } });
      return;
    }
    const saved = await storeRecording(duoServer, attempt, bytes);
    if (sentFiles.length === 1) previousPointer = saved!.fileId.toHexString();
    else expect(saved!.fileId.toHexString()).not.toBe(previousPointer);
    await failAfterReceipt(route);
  });
  await record(page);
  await submitExpectingError(page);
  await record(page, true);
  await submitExpectingError(page);
  expect(sentFiles).toEqual([true, true]);
  const old = await duoServer.database.audio.findOne({ attemptId: attempt.id });
  expect(old?.fileId.toHexString()).toBe(previousPointer);
  await submitExpectingError(page);
  expect(sentFiles).toEqual([true, true, true]);
  await expect(page.getByRole("textbox", { name: "Transcript bài nói", exact: true })).toHaveValue(recognized);
  await noOverflow(page);
});
