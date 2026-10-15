import { randomInt, randomUUID } from "node:crypto";
import { createEmptyCard, fsrs, type CardInput } from "ts-fsrs";
import type {
  AttemptSummary,
  Cefr,
  ContentItem,
  Dashboard,
  ErrorNotebook,
  Feedback,
  PlacementItem,
  Profile,
  Skill,
  StoredContent,
  StoredQuestion,
  StudyPlan,
  VocabularyCard,
} from "../shared/types";
import { ApiError } from "./errors";
import { withinAnswerLimit } from "../shared/content-visuals";
import { matchingTimeAnswer, timeAnswerExamples } from "./time-answers";

export function roundBand(value: number): number {
  return Math.round(value * 2) / 2;
}
export function cefrForBand(band: number): Cefr {
  return band < 4 ? "A2" : band < 5.5 ? "B1" : band < 7 ? "B2" : "C1";
}
export function ieltsOverall(scores: (number | null)[]): number | null {
  if (
    scores.length !== 4 ||
    scores.some(
      (value) =>
        value === null || !Number.isFinite(value) || value < 0 || value > 9,
    )
  )
    return null;
  return roundBand(
    scores.reduce<number>((total, value) => total + (value ?? 0), 0) / 4,
  );
}
function normalized(value: string): string {
  return value.trim().toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ");
}

// Reference tables are approximate practice anchors, never official form cut scores.
function referenceBand(
  raw: number,
  skill: "reading" | "listening",
  testType: "academic" | "general" | "both",
): number {
  const academic = [
    [39, 9],
    [37, 8.5],
    [35, 8],
    [33, 7.5],
    [30, 7],
    [27, 6.5],
    [23, 6],
    [19, 5.5],
    [16, 5],
    [13, 4.5],
    [10, 4],
    [7, 3.5],
    [5, 3],
    [3, 2.5],
    [2, 2],
    [1, 1],
    [0, 0],
  ];
  const general = [
    [40, 9],
    [39, 8.5],
    [37, 8],
    [36, 7.5],
    [34, 7],
    [32, 6.5],
    [30, 6],
    [27, 5.5],
    [23, 5],
    [19, 4.5],
    [15, 4],
    [12, 3.5],
    [8, 3],
    [5, 2.5],
    [3, 2],
    [1, 1],
    [0, 0],
  ];
  const rows =
    skill === "reading" && testType === "general" ? general : academic;
  return rows.find(([threshold]) => raw >= threshold)?.[1] ?? 0;
}
export function gradeObjective(
  content: StoredContent,
  responses: Record<string, string>,
): Feedback {
  if (!["reading", "listening", "grammar"].includes(content.skill))
    throw new ApiError(
      400,
      "Bài này cần phản hồi theo tiêu chí Viết hoặc Nói.",
    );
  // A group is one shared selection with a separate numbered answer slot per key.
  // Reject split responses so callers cannot submit every option across the rows.
  const selections = new Map<string, string[] | null>();
  for (const question of content.questions) {
    if (
      question.type !== "choice-multiple" ||
      !question.selectionGroup ||
      selections.has(question.selectionGroup.id)
    ) continue;
    const group = content.questions.filter((other) =>
      other.type === "choice-multiple" &&
      other.selectionGroup?.id === question.selectionGroup!.id,
    );
    let selected: string[] | null = null;
    try {
      const arrays = group.map((row) =>
        JSON.parse(responses[row.id] ?? "[]") as unknown,
      );
      if (arrays.every((value) =>
        Array.isArray(value) && value.every((option) => typeof option === "string"),
      )) {
        const value = arrays[0] as string[];
        const canon = (items: string[]) =>
          JSON.stringify([...items].map(normalized).sort());
        const distinct = new Set(value.map(normalized));
        if (
          group.length === question.selectionGroup.count &&
          question.selectionGroup.count >= 2 &&
          question.selectionGroup.count <= 3 &&
          new Set(group.map((row) => normalized(row.answer))).size === group.length &&
          group.every((row) =>
            row.selectionGroup?.count === question.selectionGroup!.count &&
            row.sectionIndex === question.sectionIndex &&
            JSON.stringify(row.options) === JSON.stringify(question.options),
          ) &&
          value.length <= question.selectionGroup.count &&
          distinct.size === value.length &&
          value.every((option) => question.options?.includes(option)) &&
          arrays.every((items) => canon(items as string[]) === canon(value))
        )
          selected = value.map(normalized);
      }
    } catch {
      // Invalid JSON receives no group credit.
    }
    selections.set(question.selectionGroup.id, selected);
  }
  const answers = content.questions.map((question) => {
    const response = responses[question.id] ?? "";
    const acceptedKeys = [question.answer, ...(question.acceptedAnswers ?? [])];
    const accepted = acceptedKeys.map(
      normalized,
    );
    const matchedTime = question.type === "text"
      ? matchingTimeAnswer(response, acceptedKeys.filter((key) =>
        withinAnswerLimit(key, question.wordLimit, question.allowNumbers)), question.prompt) : undefined;
    // Written clocks can use more words than their numeric keyed equivalent.
    // Other responses still obey the original IELTS word/number limit.
    const withinLimit = withinAnswerLimit(response, question.wordLimit, question.allowNumbers) ||
      (matchedTime !== undefined && withinAnswerLimit(matchedTime, question.wordLimit, question.allowNumbers));
    const selected = question.selectionGroup ? selections.get(question.selectionGroup.id) : null;
    const validMultiple = question.type === "choice-multiple" && selected !== null && selected !== undefined;
    return {
      ...objectiveAnswerContext(content, question),
      questionId: question.id,
      response,
      answer: question.answer,
      correct: question.type === "choice-multiple"
        ? validMultiple && selected!.includes(normalized(question.answer))
        : withinLimit && (accepted.includes(normalized(response)) || matchedTime !== undefined),
      explanation: question.type === "choice-multiple" && !validMultiple
        ? `Nhóm lựa chọn không hợp lệ: chọn tối đa ${question.selectionGroup?.count ?? 0} phương án khác nhau và dùng cùng lựa chọn cho các số câu trong nhóm. ${question.explanation}`
        : withinLimit
          ? question.explanation
          : `Vượt quá giới hạn ${question.wordLimit} từ${question.allowNumbers ? " và một số" : ""}. ${question.explanation}`,
      evidence: question.evidence,
      subskill: question.subskill,
    };
  });
  const correct = answers.filter((answer) => answer.correct).length;
  const full =
    content.format === "full-mock" &&
    answers.length === 40 &&
    content.skill !== "grammar";
  const band = full
    ? referenceBand(
        correct,
        content.skill as "reading" | "listening",
        content.testType,
      )
    : null;
  return {
    id: randomUUID(),
    skill: content.skill,
    estimatedBand: band,
    rawScore: correct,
    total: answers.length,
    summary: full
      ? `Bạn trả lời đúng ${correct}/40 câu. Band ${band?.toFixed(1)} là ước lượng luyện tập theo bảng tham khảo; ngưỡng điểm thực tế có thể thay đổi theo đề.`
      : `Bạn trả lời đúng ${correct}/${answers.length} câu. Bài luyện ngắn không đủ để quy đổi thành band IELTS; hãy xem dẫn chứng và luyện lại dạng câu còn yếu.`,
    criteria: [],
    corrections: [],
    paragraphs: [],
    answers,
    source: "rule-based",
    createdAt: new Date().toISOString(),
  };
}
/** Metadata is part of the completed review, never a public question payload. */
export function objectiveAnswerContext(
  content: StoredContent,
  question: StoredQuestion,
): Pick<Feedback["answers"][number],
  "prompt" | "questionNumber" | "options" | "context" | "acceptedAnswers" | "sectionTitle" | "questionType"
> {
  const section = content.sections[question.sectionIndex];
  const options = question.options ?? (question.type === "true-false"
    ? ["TRUE", "FALSE", "NOT GIVEN"]
    : question.type === "yes-no" ? ["YES", "NO", "NOT GIVEN"] : undefined);
  return {
    prompt: question.prompt,
    questionNumber: question.number,
    ...(options ? { options: [...options] } : {}),
    context: section?.text ?? "",
    acceptedAnswers: [...new Set([question.answer, ...(question.acceptedAnswers ?? [])].flatMap((answer) =>
      [answer, ...(question.type === "text" ? timeAnswerExamples(answer, question.prompt) : [])],
    ))],
    sectionTitle: section?.title ?? "",
    questionType: question.questionType ?? question.type,
  };
}

export function placementAnswerReview(
  item: PlacementItem,
  response: string,
  number: number,
): Feedback["answers"][number] {
  return {
    questionId: item.id,
    skill: item.skill,
    questionNumber: number,
    prompt: item.question,
    context: item.text,
    options: [...item.options],
    response,
    answer: item.answer,
    acceptedAnswers: [item.answer],
    correct: response === item.answer,
    explanation: item.explanation,
    evidence: item.text,
    subskill: item.subskill,
    sectionTitle: item.skill === "reading" ? "Reading" : "Listening",
    questionType: "multiple-choice",
  };
}
const sigmoid = (value: number): number => 1 / (1 + Math.exp(-value));
export function selectPlacementQuestion(
  bank: PlacementItem[],
  seen: string[],
  theta: number,
): PlacementItem {
  const used = new Set(seen);
  const candidates = bank
    .filter((item) => !used.has(item.id))
    .map((item) => ({
      item,
      information:
        sigmoid(theta - item.difficulty) *
        (1 - sigmoid(theta - item.difficulty)),
    }))
    .sort((a, b) => b.information - a.information);
  if (!candidates.length)
    throw new ApiError(
      409,
      "Ngân hàng câu hỏi đã hết. Hãy kết thúc đánh giá hiện tại.",
    );
  const best = candidates[0].information;
  const matches = candidates.filter(
    (candidate) => candidate.information >= best - 0.005,
  );
  return matches[randomInt(matches.length)].item;
}
export function estimatePlacement(
  answers: { correct: boolean; difficulty: number }[],
  priorTheta = 0,
): { theta: number; standardError: number; estimatedBand: number } {
  let theta = priorTheta;
  const priorPrecision = 1 / 1.5 ** 2;
  for (let iteration = 0; iteration < 30; iteration++) {
    let gradient = -(theta - priorTheta) * priorPrecision;
    let information = priorPrecision;
    for (const answer of answers) {
      const probability = sigmoid(theta - answer.difficulty);
      gradient += (answer.correct ? 1 : 0) - probability;
      information += probability * (1 - probability);
    }
    const change = Math.max(-1, Math.min(1, gradient / information));
    theta = Math.max(-4, Math.min(4, theta + change));
    if (Math.abs(change) < 0.00001) break;
  }
  const information =
    priorPrecision +
    answers.reduce((sum, answer) => {
      const p = sigmoid(theta - answer.difficulty);
      return sum + p * (1 - p);
    }, 0);
  return {
    theta,
    standardError: 1 / Math.sqrt(information),
    estimatedBand: Math.max(3, Math.min(8, roundBand(5 + theta / 1.2))),
  };
}
export function placementFeedback(state: {
  estimatedBand: number;
  standardError: number;
  correct: number;
  total: number;
  answers?: Feedback["answers"];
}): Feedback {
  return {
    id: randomUUID(),
    skill: "placement",
    estimatedBand: state.estimatedBand,
    rawScore: state.correct,
    total: state.total,
    summary: `Mức khởi điểm ước lượng ${state.estimatedBand.toFixed(1)} (${cefrForBand(state.estimatedBand)}), ${state.correct}/${state.total} câu đúng. Mô phỏng Rasch thích ứng, sai số năng lực ${state.standardError.toFixed(2)}; độ khó do biên soạn, chưa hiệu chuẩn từ dữ liệu thi. Đây không phải band thi chính thức hoặc điểm riêng của bốn kỹ năng.`,
    criteria: [],
    corrections: [],
    paragraphs: [],
    answers: state.answers ?? [],
    source: "rule-based",
    createdAt: new Date().toISOString(),
  };
}
const scheduler = fsrs({ request_retention: 0.9, enable_fuzz: false });
export function newScheduler(now = new Date()): string {
  return JSON.stringify(createEmptyCard(now));
}
function parsedScheduler(value: string): CardInput {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("due" in parsed) ||
      !("reps" in parsed) ||
      typeof parsed.reps !== "number" ||
      !("stability" in parsed) ||
      typeof parsed.stability !== "number" ||
      !Number.isFinite(new Date(String(parsed.due)).getTime())
    )
      throw new Error("Invalid card");
    return parsed as CardInput;
  } catch {
    throw new ApiError(
      500,
      "Dữ liệu lịch ôn bị lỗi; vui lòng xuất dữ liệu và liên hệ quản trị viên.",
    );
  }
}
export function scheduleReview(
  schedulerJson: string,
  rating: 1 | 2 | 3 | 4,
  now = new Date(),
): { scheduler: string; log: string } {
  const card = parsedScheduler(schedulerJson);
  const previous = card.last_review ? new Date(card.last_review) : null;
  if (previous && previous.getTime() > now.getTime())
    throw new ApiError(
      409,
      "Thời gian ôn trước nằm trong tương lai. Hãy kiểm tra đồng hồ hệ thống.",
    );
  const result = scheduler.repeat(card, now)[rating];
  return {
    scheduler: JSON.stringify(result.card),
    log: JSON.stringify(result.log),
  };
}
export function vocabularyMetrics(
  schedulerJson: string,
  now = new Date(),
): Pick<
  VocabularyCard,
  "difficulty" | "stability" | "retrievability" | "dueAt" | "reps" | "due"
> {
  const card = parsedScheduler(schedulerJson);
  const retrievability =
    card.reps === 0 ? 0 : scheduler.get_retrievability(card, now, false);
  const dueAt = new Date(card.due).toISOString();
  return {
    difficulty: card.difficulty,
    stability: card.stability,
    retrievability,
    dueAt,
    reps: card.reps,
    due: new Date(dueAt).getTime() <= now.getTime() || retrievability < 0.9,
  };
}
const dayKey = (date: Date): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
const weekStartOf = (now: Date): string => {
  const midnight = new Date(`${dayKey(now)}T00:00:00+07:00`);
  const weekday = (midnight.getUTCDay() + 1) % 7;
  midnight.setUTCDate(midnight.getUTCDate() - ((weekday + 6) % 7));
  return dayKey(midnight);
};
function addDays(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00+07:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return dayKey(date);
}
const skills: Skill[] = ["listening", "reading", "writing", "speaking"];
function skillEstimates(attempts: AttemptSummary[]): Dashboard["skills"] {
  return skills.map((skill) => {
    const scored = attempts
      .filter(
        (attempt) =>
          attempt.skill === skill &&
          attempt.status === "submitted" &&
          attempt.estimatedBand !== null,
      )
      .sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""));
    // Repeated work on one form does not create independent skill evidence.
    const latest = scored
      .filter(
        (attempt, index) =>
          scored.findLastIndex(
            (other) => other.contentId === attempt.contentId,
          ) === index,
      )
      .slice(0, 3);
    const estimatedBand = latest.length
      ? roundBand(
          latest.reduce(
            (sum, attempt, index) =>
              sum + (attempt.estimatedBand ?? 0) / (index + 1),
            0,
          ) / latest.reduce((sum, _, index) => sum + 1 / (index + 1), 0),
        )
      : null;
    return {
      skill,
      estimatedBand,
      uncertainty: latest.length
        ? Math.max(0.3, 0.8 / Math.sqrt(latest.length))
        : null,
      attempts: attempts.filter(
        (attempt) => attempt.skill === skill && attempt.status === "submitted",
      ).length,
    };
  });
}
function recommendations(
  profile: Profile,
  attempts: AttemptSummary[],
  contents: ContentItem[],
): ContentItem[] {
  const scored = skillEstimates(attempts);
  const priority = [...scored]
    .sort((a, b) => (a.estimatedBand ?? -1) - (b.estimatedBand ?? -1))
    .map((row) => row.skill);
  const recent = new Set(
    attempts
      .filter((attempt) => attempt.status === "submitted")
      .slice(0, 20)
      .map((attempt) => attempt.contentId),
  );
  return priority
    .flatMap((skill) =>
      contents
        .filter(
          (item) =>
            item.skill === skill &&
            item.format === "lesson" &&
            (item.testType === "both" || item.testType === profile.testType),
        )
        .sort(
          (a, b) =>
            Number(recent.has(a.id)) - Number(recent.has(b.id)) ||
            Math.abs(a.band - (profile.currentBand ?? 4.5)) -
              Math.abs(b.band - (profile.currentBand ?? 4.5)),
        )
        .slice(0, 1),
    )
    .slice(0, 3);
}
export function generatePlan(
  profile: Profile,
  attempts: AttemptSummary[],
  cards: VocabularyCard[],
  contents: ContentItem[],
  now = new Date(),
): StudyPlan {
  const weekStart = weekStartOf(now);
  const estimates = skillEstimates(attempts);
  const priority = [...estimates]
    .sort((a, b) => (a.estimatedBand ?? -1) - (b.estimatedBand ?? -1))
    .map((row) => row.skill);
  const available = contents.filter(
    (item) =>
      item.format === "lesson" &&
      (item.testType === "both" || item.testType === profile.testType),
  );
  const doneIds = new Set(
    attempts
      .filter((attempt) => attempt.status === "submitted")
      .map((attempt) => attempt.contentId),
  );
  const activeDays = Math.min(
    7,
    Math.max(1, Math.floor(profile.weeklyMinutes / 10)),
  );
  const baseBudget = Math.floor(profile.weeklyMinutes / activeDays);
  const tasks: StudyPlan["tasks"] = [];
  for (let day = 0; day < activeDays; day++) {
    const dailyBudget =
      baseBudget + (day < profile.weeklyMinutes % activeDays ? 1 : 0);
    const date = addDays(weekStart, day);
    const selectedSkill = priority[day % 4];
    const options = available
      .filter((item) => item.skill === selectedSkill)
      .sort(
        (a, b) =>
          Number(doneIds.has(a.id)) - Number(doneIds.has(b.id)) ||
          Math.abs(a.band - (profile.currentBand ?? 4.5)) -
            Math.abs(b.band - (profile.currentBand ?? 4.5)) ||
          a.id.localeCompare(b.id),
      );
    const item = options[Math.floor(day / 4) % Math.max(1, options.length)];
    if (item)
      tasks.push({
        id: `${profile.id}:${date}:practice`,
        day: date,
        title: item.title,
        kind: selectedSkill,
        contentId: item.id,
        minutes: Math.max(5, dailyBudget - 5),
        completed: false,
        reason:
          estimates.find((row) => row.skill === selectedSkill)
            ?.estimatedBand === null
            ? "Xây thêm bằng chứng cho kỹ năng này."
            : "Ưu tiên kỹ năng có khoảng cách lớn tới mục tiêu.",
      });
    tasks.push({
      id: `${profile.id}:${date}:vocabulary`,
      day: date,
      title: "Ôn từ vựng đến hạn",
      kind: "vocabulary",
      contentId: null,
      minutes: 5,
      completed: false,
      reason: `Giữ mức nhớ mục tiêu 90%; hiện ${cards.filter((card) => card.due).length} thẻ đến hạn.`,
    });
  }
  return {
    id: `${profile.id}:${weekStart}`,
    weekStart,
    targetBand: profile.targetBand,
    weeklyMinutes: profile.weeklyMinutes,
    tasks,
    explanation: `Kế hoạch từ ngân sách ${profile.weeklyMinutes} phút/tuần; ưu tiên kỹ năng cần thêm bằng chứng và ôn từ đều mỗi ngày. Mức khởi điểm ${profile.currentBand?.toFixed(1) ?? "chưa có"}, mục tiêu ${profile.targetBand.toFixed(1)}${profile.examDate ? `, ngày thi ${profile.examDate}` : ""}. Bạn có thể thay mục tiêu và thời lượng trong Cài đặt.`,
  };
}
export function buildDashboard(
  profile: Profile,
  attempts: AttemptSummary[],
  cards: VocabularyCard[],
  contents: ContentItem[],
  plan: StudyPlan,
  now = new Date(),
): Dashboard {
  const submitted = attempts.filter(
    (attempt) => attempt.status === "submitted",
  );
  const estimates = skillEstimates(attempts);
  const currentWeek = weekStartOf(now);
  const dayMinutes = new Map<string, number>();
  for (const attempt of submitted) {
    const day = dayKey(new Date(attempt.submittedAt ?? attempt.startedAt));
    dayMinutes.set(
      day,
      (dayMinutes.get(day) ?? 0) + Math.round(attempt.durationSeconds / 60),
    );
  }
  let streakDays = 0;
  const today = dayKey(now);
  let streakStart = dayMinutes.has(today) ? today : addDays(today, -1);
  while (dayMinutes.has(streakStart)) {
    streakDays++;
    streakStart = addDays(streakStart, -1);
  }
  const reviewed = cards.filter((card) => card.reps > 0);
  return {
    profile,
    skills: estimates,
    overallBand: ieltsOverall(estimates.map((row) => row.estimatedBand)),
    completedCount: submitted.length,
    weekMinutes: [...dayMinutes]
      .filter(([day]) => day >= currentWeek)
      .reduce((sum, [, minutes]) => sum + minutes, 0),
    streakDays,
    dueCards: cards.filter((card) => card.due).length,
    totalCards: cards.length,
    vocabularyRetention: reviewed.length
      ? reviewed.reduce((sum, card) => sum + card.retrievability, 0) /
        reviewed.length
      : null,
    recentAttempts: [...attempts]
      .sort((a, b) =>
        (b.submittedAt ?? b.startedAt).localeCompare(
          a.submittedAt ?? a.startedAt,
        ),
      )
      .slice(0, 6),
    recommendations: recommendations(profile, attempts, contents),
    weaknesses: [],
    trend: submitted
      .filter(
        (attempt) =>
          skills.includes(attempt.skill as Skill) &&
          attempt.estimatedBand !== null,
      )
      .map((attempt) => ({
        day: dayKey(new Date(attempt.submittedAt ?? attempt.startedAt)),
        skill: attempt.skill as Skill,
        estimatedBand: attempt.estimatedBand ?? 0,
      }))
      .sort((a, b) => a.day.localeCompare(b.day)),
    activity: Array.from({ length: 7 }, (_, index) => {
      const day = addDays(currentWeek, index);
      return { day, minutes: dayMinutes.get(day) ?? 0 };
    }),
    plan,
  };
}
export function buildErrorNotebook(
  attempts: (AttemptSummary & { feedback: Feedback | null })[],
  contents: ContentItem[],
): ErrorNotebook {
  const groups = new Map<string, ErrorNotebook["items"][number]>();
  for (const attempt of attempts) {
    if (attempt.status !== "submitted" || !attempt.feedback) continue;
    const item = contents.find((content) => content.id === attempt.contentId);
    for (const answer of attempt.feedback.answers.filter(
      (row) => !row.correct,
    )) {
      const key = `${attempt.skill}:${answer.subskill}`;
      const group = groups.get(key) ?? {
        tag: answer.subskill,
        skill: attempt.skill,
        count: 0,
        examples: [],
      };
      group.count++;
      if (group.examples.length < 5)
        group.examples.push({
          prompt:
            item?.questions.find(
              (question) => question.id === answer.questionId,
            )?.prompt ?? "Câu hỏi trong bài luyện",
          response: answer.response,
          correction: answer.answer,
          explanation: answer.explanation,
          contentId: attempt.contentId,
        });
      groups.set(key, group);
    }
    for (const correction of attempt.feedback.corrections) {
      const key = `${attempt.skill}:language-accuracy`;
      const group = groups.get(key) ?? {
        tag: "language-accuracy",
        skill: attempt.skill,
        count: 0,
        examples: [],
      };
      group.count++;
      if (group.examples.length < 5)
        group.examples.push({
          prompt: correction.original,
          response: correction.original,
          correction: correction.suggestion,
          explanation: correction.explanation,
          contentId: attempt.contentId,
        });
      groups.set(key, group);
    }
  }
  return { items: [...groups.values()].sort((a, b) => b.count - a.count) };
}
