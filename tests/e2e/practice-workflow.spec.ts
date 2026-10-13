import type { Page } from "@playwright/test";
import type { Db } from "mongodb";
import type { AttemptRecord, PlacementRecord } from "../../server/storage";
import type {
  PlacementItem,
  PlacementState,
  StoredContent,
  StoredQuestion,
} from "../../shared/types";
import {
  test,
  expect,
  loginDemo,
  navigate,
  noHorizontalOverflow,
  lesson,
  createAttempt,
  getAttempt,
  capturePage,
} from "./fixtures";

async function submit(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "Nộp bài & xem phản hồi", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Nộp bài luyện của bạn?", exact: true })
    .getByRole("button", { name: "Nộp bài", exact: true })
    .click();
}

async function answerQuestion(
  page: Page,
  question: StoredQuestion,
  answer: string,
): Promise<void> {
  if (
    question.type === "text" ||
    (!question.options?.length &&
      !["true-false", "yes-no"].includes(question.type))
  ) {
    // Completion-block blanks retain their numbered accessible labels rather
    // than duplicating an individual question legend for every row.
    await page
      .getByRole("textbox", { name: `Câu ${question.number}`, exact: true })
      .fill(answer);
  } else {
    const group = page.locator("fieldset.practice-question").filter({
      has: page.locator("legend").filter({ hasText: question.prompt }),
    });
    await expect(group).toBeVisible();
    await group.getByRole(question.type === "choice-multiple" ? "checkbox" : "radio", { name: radioName(answer) }).check();
  }
}

function radioName(answer: string): RegExp {
  const escaped = answer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^(?:[A-Z]\\s+)?${escaped}$`);
}

async function fillObjective(
  page: Page,
  content: StoredContent,
  wrongFirst = false,
): Promise<void> {
  for (let index = 0; index < content.sections.length; index++) {
    await page
      .getByRole("group", { name: "Phần của bài tập", exact: true })
      .getByRole("button")
      .nth(index)
      .click();
    for (const question of content.questions.filter(
      (item) => item.sectionIndex === index,
    )) {
      const answer =
        wrongFirst && question.id === content.questions[0]?.id
          ? question.options?.find((option) => option !== question.answer) ||
            "incorrect"
          : question.answer;
      await answerQuestion(page, question, answer);
    }
  }
}

async function placementState(page: Page): Promise<PlacementState> {
  const response = await page.request.get("/api/placement/active");
  expect(response.ok()).toBeTruthy();
  const body: { placement: PlacementState | null } = await response.json();
  if (!body.placement)
    throw new Error("The active placement was not persisted.");
  return body.placement;
}

test("quick placement adapts across 15 unique items and resumes the exact saved question", async ({
  page,
  db,
}) => {
  await loginDemo(page);
  await navigate(page, "/placement");
  await page
    .getByRole("button", { name: "Bắt đầu kiểm tra nhanh", exact: true })
    .click();
  const ids = new Set<string>();
  let placementId = "";
  for (let index = 0; index < 15; index++) {
    await expect(
      page.getByText(`Câu ${index + 1} / 15`, { exact: true }),
    ).toBeVisible();
    const state = await placementState(page);
    placementId = state.id;
    expect(state.completed).toBe(index);
    expect(state.question).not.toHaveProperty("answer");
    const question = state.question;
    if (!question) throw new Error("Placement ended early.");
    expect(ids.has(question.id)).toBeFalsy();
    ids.add(question.id);
    const stored = await db
      .collection<PlacementItem>("placementItems")
      .findOne({ id: question.id });
    if (!stored) throw new Error("Missing source placement item.");
    await page.getByRole("radio", { name: radioName(stored.answer) }).check();
    await page
      .getByRole("button", { name: "Câu tiếp theo", exact: true })
      .click();
    if (index === 4) {
      await expect(page.getByText("Câu 6 / 15", { exact: true })).toBeVisible();
      const beforeReload = await placementState(page);
      await page.reload();
      await expect(page.getByText("Câu 6 / 15", { exact: true })).toBeVisible();
      expect((await placementState(page)).question?.id).toBe(
        beforeReload.question?.id,
      );
    }
  }
  await expect(
    page.getByRole("heading", { name: /^Band ước lượng / }),
  ).toBeVisible();
  await expect(page.getByText(/Sai số chuẩn mô hình Rasch/)).toBeVisible();
  const completed = await db
    .collection<PlacementRecord>("placements")
    .findOne({ userId: "demo-1", _id: placementId });
  expect(completed?.answers).toHaveLength(15);
  expect(completed?.result?.estimatedBand).toBeGreaterThanOrEqual(3);
  expect(completed?.result?.estimatedBand).toBeLessThanOrEqual(8);
  expect(completed?.theta).toBeGreaterThan(0);
  expect(
    new Set(completed?.answers.map((answer) => answer.questionId)).size,
  ).toBe(15);
  await noHorizontalOverflow(page);
});

test("library filters lead to a Reading lesson, saved answers, evidence, and an error notebook without a fake band", async ({
  page,
  db,
}) => {
  await loginDemo(page);
  const content = await lesson(db, "reading", "lesson", {
    band: 3.5,
  });
  await navigate(page, "/library");
  await expect(page.locator("article.content-card").first()).toBeVisible();
  await capturePage(page, "library", false);
  await page
    .getByRole("group", { name: "Lọc theo kỹ năng", exact: true })
    .getByRole("button", { name: "Reading", exact: true })
    .click();
  await page.getByLabel("Chủ đề", { exact: true }).selectOption(content.topic);
  await page.getByLabel("Band bài tập", { exact: true }).selectOption("3.5");
  const card = page
    .locator("article.content-card")
    .filter({
      has: page.getByRole("heading", { name: content.title, exact: true }),
    });
  await expect(card).toBeVisible();
  await card
    .getByRole("button", { name: "Bắt đầu luyện", exact: true })
    .click();
  await expect(page).toHaveURL(/\/learn\/[\w-]+$/);
  await expect(
    page.getByRole("heading", { name: content.title, exact: true, level: 1 }),
  ).toBeVisible();
  const attemptId = page.url().split("/").at(-1)!;
  const publicAttempt = await getAttempt(page, attemptId);
  expect(publicAttempt.content.questions[0]).not.toHaveProperty("answer");
  await fillObjective(page, content, true);
  await expect
    .poll(
      async () =>
        Object.keys((await getAttempt(page, attemptId)).responses).length,
    )
    .toBe(content.questions.length);
  await noHorizontalOverflow(page);
  await capturePage(page, "reading");
  await page.reload();
  const saved = await getAttempt(page, attemptId);
  expect(Object.keys(saved.responses)).toHaveLength(content.questions.length);
  await submit(page);
  await expect(
    page.getByRole("heading", { name: "Phản hồi bài luyện", exact: true }),
  ).toBeVisible();
  const result = await getAttempt(page, attemptId);
  expect(result.status).toBe("submitted");
  expect(result.feedback?.rawScore).toBe(content.questions.length - 1);
  expect(result.feedback?.estimatedBand).toBeNull();
  await expect(page.locator(".feedback-score")).toContainText(
    `${content.questions.length - 1}`,
  );
  await expect(
    page.getByRole("heading", { name: "Đáp án và bằng chứng", exact: true }),
  ).toBeVisible();
  await page
    .locator(".answer-review details")
    .first()
    .locator("summary")
    .click();
  await expect(page.locator(".answer-review details").first()).toContainText(
    content.questions[0]!.answer,
  );
  await navigate(page, "/errors");
  await expect(page.locator(".error-tag").first()).toBeVisible();
  await noHorizontalOverflow(page);
  await navigate(page, "/history");
  await expect(
    page.getByRole("heading", { name: content.title, exact: true }),
  ).toBeVisible();
  await expect(page.locator(".attempt-result")).toContainText(
    `${content.questions.length - 1}/${content.questions.length}`,
  );
});

test("a 40-question full Reading mock keeps its deadline, grades a band estimate, and expires on the server", async ({
  page,
  db,
}) => {
  await loginDemo(page);
  const content = await lesson(db, "reading", "full-mock", {
    testType: "academic",
  });
  expect(content.sections).toHaveLength(3);
  expect(content.questions).toHaveLength(40);
  const attempt = await createAttempt(page, content, "exam");
  await navigate(page, `/learn/${attempt.id}`);
  await expect(page.locator(".attempt-timer")).toBeVisible();
  await page.reload();
  expect((await getAttempt(page, attempt.id)).deadlineAt).toBe(
    attempt.deadlineAt,
  );
  await expect(page.locator(".exam-notice")).toContainText(
    "tải lại trang không bắt đầu lại",
  );
  await expect(
    page.getByRole("heading", { name: "Từ vựng trong bài", exact: true }),
  ).toHaveCount(0);
  await fillObjective(page, content);
  await submit(page);
  await expect(
    page.getByRole("heading", { name: "Phản hồi bài luyện", exact: true }),
  ).toBeVisible();
  const result = await getAttempt(page, attempt.id);
  expect(result.feedback?.rawScore).toBe(40);
  expect(result.feedback?.total).toBe(40);
  expect(result.feedback?.estimatedBand).toBeGreaterThanOrEqual(7);
  await expect(page.locator(".feedback-score")).toContainText(
    "band luyện tập ước lượng",
  );

  // Expire only a record in the isolated E2E DB; no 60-minute sleep or timer mock.
  const timed = await createAttempt(page, content, "exam");
  await db
    .collection<AttemptRecord>("attempts")
    .updateOne(
      { _id: timed.id, userId: "demo-1" },
      { $set: { deadlineAt: new Date(Date.now() - 1000).toISOString() } },
    );
  await navigate(page, `/learn/${timed.id}`);
  await expect(
    page.getByRole("heading", { name: "Phản hồi bài luyện", exact: true }),
  ).toBeVisible();
  const expired = await getAttempt(page, timed.id);
  expect(expired.status).toBe("submitted");
  expect(expired.feedback?.rawScore).toBe(0);
  await noHorizontalOverflow(page);
});

test("Writing Task 1 chart and both task drafts survive reload with truthful offline feedback", async ({
  page,
  db,
}) => {
  await loginDemo(page);
  const content = await lesson(db, "writing", "full-mock", {
    testType: "academic",
  });
  expect(content.sections).toHaveLength(2);
  const attempt = await createAttempt(page, content);
  await navigate(page, `/learn/${attempt.id}`);
  await expect(
    page.getByText("Ít nhất 150 từ · khoảng 20 phút", { exact: true }),
  ).toBeVisible();
  const chartTitle = content.sections[0]!.visuals?.[0]?.title || content.sections[0]!.title;
  const chartName = new RegExp(chartTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  await expect(page.locator(".section-visuals").getByRole("img", { name: chartName })).toBeVisible();
  const task1 =
    "The chart compares changes in three categories. Overall the figures increased over time, although the scale of growth differed. The first category showed the largest rise, while the second category remained relatively stable. The final category increased steadily and ended above its initial value.";
  await page
    .getByRole("textbox", { name: "Bài viết Task 1", exact: true })
    .fill(task1);
  await expect
    .poll(
      async () =>
        (await getAttempt(page, attempt.id)).essays[content.sections[0]!.id],
    )
    .toBe(task1);
  await noHorizontalOverflow(page);
  await capturePage(page, "writing");
  await page
    .getByRole("group", { name: "Phần của bài tập", exact: true })
    .getByRole("button")
    .nth(1)
    .click();
  await expect(
    page.getByText("Ít nhất 250 từ · khoảng 40 phút", { exact: true }),
  ).toBeVisible();
  const task2 =
    "Public investment should consider both immediate needs and long-term benefits. I believe a balanced approach is preferable because communities differ in their resources. For example, improved access may benefit people who cannot afford private alternatives. However, policy makers should measure outcomes carefully rather than assuming that every new programme succeeds.";
  await page
    .getByRole("textbox", { name: "Bài viết Task 2", exact: true })
    .fill(task2);
  await expect
    .poll(
      async () =>
        (await getAttempt(page, attempt.id)).essays[content.sections[1]!.id],
    )
    .toBe(task2);
  await capturePage(page, "writing-task2");
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Bài viết Task 1", exact: true }),
  ).toHaveValue(task1);
  await page
    .getByRole("group", { name: "Phần của bài tập", exact: true })
    .getByRole("button")
    .nth(1)
    .click();
  await expect(
    page.getByRole("textbox", { name: "Bài viết Task 2", exact: true }),
  ).toHaveValue(task2);
  await submit(page);
  await expect(
    page.getByRole("heading", { name: "Phản hồi bài luyện", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".feedback-score")).toContainText(
    "Đã lưu bài · chưa có band",
  );
  const result = await getAttempt(page, attempt.id);
  expect(result.feedback?.estimatedBand).toBeNull();
  expect(result.feedback?.source).toBe("rule-based");
  expect(result.feedback?.taskScores).toHaveLength(2);
  for (const task of result.feedback?.taskScores || [])
    expect(task.criteria).toHaveLength(4);
  expect(result.feedback?.wordCount).toBeGreaterThan(0);
  await noHorizontalOverflow(page);
});

test("Speaking records real WAV, retains it after unavailable STT, and streams transcript-only checklist", async ({
  page,
  db,
}) => {
  await loginDemo(page);
  const content = await lesson(db, "speaking");
  const attempt = await createAttempt(page, content);
  await navigate(page, `/learn/${attempt.id}`);
  await page
    .getByRole("button", { name: "Bắt đầu ghi âm", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Đang ghi âm giọng của bạn",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Thời gian 00:02", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Dừng ghi âm", exact: true }).click();
  await expect(page.locator(".recording-playback audio")).toBeVisible();
  await submit(page);
  await expect(page.getByRole("alert")).toContainText(
    /STT|Whisper|OpenAI|phiên âm/,
  );
  expect((await getAttempt(page, attempt.id)).status).toBe("in-progress");
  expect((await getAttempt(page, attempt.id)).audioAvailable).toBeTruthy();
  const audio = await page.request.get(`/api/attempts/${attempt.id}/audio`);
  expect(audio.ok()).toBeTruthy();
  const bytes = await audio.body();
  expect(bytes.length).toBeGreaterThan(44);
  expect(bytes.subarray(0, 4).toString()).toBe("RIFF");
  expect(bytes.readUInt32LE(24)).toBe(16000);
  expect(bytes.readUInt16LE(22)).toBe(1);
  expect(
    await db
      .collection("recordings.files")
      .countDocuments({
        "metadata.userId": "demo-1",
        "metadata.attemptId": attempt.id,
      }),
  ).toBe(1);
  await page.reload();
  await expect(page.locator(".recording-playback audio")).toHaveAttribute(
    "src",
    `/api/attempts/${attempt.id}/audio`,
  );
  const transcript =
    "Um, I enjoy visiting the public library because it offers a quiet place to study. In the past I used to read only short articles, but now I choose longer books and discuss ideas with my friends. This habit has helped me understand unfamiliar topics and develop more confidence.";
  await page
    .getByRole("textbox", { name: "Transcript bài nói", exact: true })
    .fill(transcript);
  await expect
    .poll(async () => (await getAttempt(page, attempt.id)).transcript)
    .toBe(transcript);
  await capturePage(page, "speaking");
  const streamPromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/attempts/${attempt.id}/speaking`) &&
      response.request().method() === "POST",
  );
  await submit(page);
  const stream = await streamPromise;
  expect(stream.headers()["content-type"]).toContain("text/event-stream");
  await expect(
    page.getByRole("heading", { name: "Phản hồi bài luyện", exact: true }),
  ).toBeVisible();
  const result = await getAttempt(page, attempt.id);
  expect(result.feedback?.estimatedBand).toBeNull();
  expect(result.feedback?.pronunciation).toBeNull();
  expect(result.feedback?.transcript).toBe(transcript);
  expect(result.feedback?.fillerCount).toBeGreaterThan(0);
  await expect(
    page.getByRole("heading", { name: "Transcript được xử lý", exact: true }),
  ).toBeVisible();
  await noHorizontalOverflow(page);
});

test("Listening has four parts, Practice transcript and pause controls, and one server-persisted Exam play", async ({
  page,
  db,
}) => {
  // Headless Chromium has no installed speech voices. Stub this browser device
  // only; the content, play-claim API, timer, and MongoDB remain real.
  await page.addInitScript(() => {
    // A nonempty English catalog models a playable device. Native utterance
    // voice setters require branded browser voices, so control the utterance
    // as well; keep playback active until the pause/stop controls are used.
    class ControlledUtterance {
      voice: SpeechSynthesisVoice | null = null;
      lang = "";
      rate = 1;
      pitch = 1;
      onend: ((event: SpeechSynthesisEvent) => void) | null = null;
      onerror: ((event: SpeechSynthesisErrorEvent) => void) | null = null;
      constructor(readonly text: string) {}
    }
    window.SpeechSynthesisUtterance = ControlledUtterance as unknown as typeof SpeechSynthesisUtterance;
    const voices = ["Synthetic Zoe", "Synthetic Ada", "Synthetic Ben"].map(name => ({
      name, lang: "en-GB", voiceURI: `synthetic:${name}`, default: false, localService: true,
    }));
    const synthesis = window.speechSynthesis;
    Object.defineProperty(synthesis, "getVoices", { value: () => voices });
    Object.defineProperty(synthesis, "speak", {
      value: (_utterance: SpeechSynthesisUtterance) => undefined,
    });
    Object.defineProperty(synthesis, "cancel", { value: () => undefined });
    Object.defineProperty(synthesis, "pause", { value: () => undefined });
    Object.defineProperty(synthesis, "resume", { value: () => undefined });
  });
  await loginDemo(page);
  const content = await lesson(db, "listening", "full-mock");
  expect(content.sections).toHaveLength(4);
  expect(content.questions).toHaveLength(40);
  const practice = await createAttempt(page, content);
  await navigate(page, `/learn/${practice.id}`);
  await expect(
    page
      .getByRole("group", { name: "Phần của bài tập", exact: true })
      .getByRole("button"),
  ).toHaveCount(4);
  await page
    .getByRole("button", { name: "Hiện transcript", exact: true })
    .click();
  await expect(page.locator(".passage-card .reading-passage")).toBeVisible();
  await expect(page.locator(".passage-card .reading-passage")).not.toBeEmpty();
  await page
    .getByRole("button", { name: "Ẩn transcript", exact: true })
    .click();
  const sourceResponse = page.waitForResponse((response) =>
    response.url().endsWith(`/api/attempts/${practice.id}/listening-source`),
  );
  await page
    .getByRole("button", { name: "Phát bản nghe", exact: true })
    .click();
  const source: { sections: { text: string }[]; source: string } = await (
    await sourceResponse
  ).json();
  expect(source.sections).toHaveLength(4);
  expect(source.sections.some((section) => !!section.text)).toBeTruthy();
  await expect(page.locator(".listening-player")).toContainText("trình duyệt");
  await page.getByRole("button", { name: "Tạm dừng", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Tiếp tục nghe", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Tiếp tục nghe", exact: true })
    .click();
  await page.getByRole("button", { name: "Dừng", exact: true }).click();

  const exam = await createAttempt(page, content, "exam");
  await navigate(page, `/learn/${exam.id}`);
  await expect(
    page.getByRole("button", { name: "Hiện transcript", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".passage-card .reading-passage")).toHaveCount(0);
  await expect(page.locator(".exam-notice")).toContainText("chỉ phát một lần");
  await page
    .getByRole("button", { name: "Phát bản nghe", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Dừng", exact: true }),
  ).toBeVisible();
  expect(
    (await db.collection<AttemptRecord>("attempts").findOne({ _id: exam.id }))
      ?.listeningPlayed,
  ).toBeTruthy();
  await page.getByRole("button", { name: "Dừng", exact: true }).click();
  await page.reload();
  expect((await getAttempt(page, exam.id)).deadlineAt).toBe(exam.deadlineAt);
  await page
    .getByRole("button", { name: "Phát bản nghe", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(/một lần|đã phát/);
  await noHorizontalOverflow(page);
});
