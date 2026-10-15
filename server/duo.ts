import { randomUUID } from "node:crypto";
import type { Express, NextFunction, Request, Response } from "express";
import { MongoServerError, type Collection } from "mongodb";
import { z } from "zod";
import type { ContentKind, StoredContent } from "../shared/types";
import type {
  DuoAssessmentPart,
  DuoAssessmentView,
  DuoBandView,
  DuoGateView,
  DuoLessonView,
  DuoRole,
  DuoRoomView,
  DuoSnapshot,
  DuoStatus,
  DuoResultStatus,
} from "../shared/duo";
import { learnerOf } from "./auth";
import { ApiError } from "./errors";
import { EXAM_LEASE_SECONDS, requireExamTab } from "./exam-guard";
import { createExamReplacement, examReplacementSourceIds, ExamReplacementUnavailableError } from "./exam-variants";
import type {
  AttemptRecord,
  Database,
  PlacementRecord,
  UserRecord,
} from "./storage";

const ROLES: DuoRole[] = ["husband", "wife"];
const bandKey = (band: number) => `b${Math.round(band * 2)}`;
const pair = <T>(value: T): Record<DuoRole, T> => ({
  husband: value,
  wife: value,
});
const millis = (iso: string | null | undefined) => (iso ? Date.parse(iso) : 0);
const isDuplicate = (error: unknown) =>
  error instanceof MongoServerError && error.code === 11000;
const validBand = (value: number) =>
  Math.max(3, Math.min(8, Math.round(value * 2) / 2));
interface DuoUser extends UserRecord {
  duoRole?: DuoRole;
  duoId?: string;
}
interface Completion {
  at: string;
  proofIds: string[];
  kind: "attempt" | "vocabulary";
  /** Ordering of the latest confirmed attempt; `at` keeps the first achievement. */
  submittedAt?: string;
  startedAt?: string;
}
interface LessonRecord {
  id: string;
  number: number;
  title: string;
  kind: ContentKind | "vocabulary";
  contentId: string | null;
  vocabularyIds: string[];
  completion: Record<DuoRole, Completion | null>;
}
interface ResultRecord {
  status: DuoResultStatus;
  assessmentId: string;
  at: string;
}
interface GateRecord {
  id: string;
  number: number;
  fromLesson: number;
  afterLesson: number;
  contentIds: string[];
  results: Record<DuoRole, ResultRecord | null>;
}
interface BandRecord {
  band: number;
  unlockedAt: string | null;
  completedAt: string | null;
  lessons: LessonRecord[];
  gates: GateRecord[];
  promotionContentIds: string[];
  promotionResults: Record<DuoRole, ResultRecord | null>;
  lastPromotionRoomId: string | null;
}
interface PathRecord {
  _id: string;
  duoId: string;
  members: Record<DuoRole, string>;
  startingBand: number;
  currentBand: number;
  targetBand: number;
  gateInterval: 5 | 10;
  sessionsPerBand: number;
  passPercent: number;
  strictRetakeMode: boolean;
  revision: number;
  startedAt: string;
  updatedAt: string;
  bands: Record<string, BandRecord>;
  /** Path CAS fences receipts before their separate documents are cancelled. */
  invalidatedAssessmentIds?: string[];
  invalidatedRoomIds?: string[];
  integrityInvalidations?: { assessmentIds: string[]; roomId: string | null; reason: string; at: string }[];
}
interface PlacementResultRecord {
  _id: string;
  duoId: string;
  userId: string;
  role: DuoRole;
  placementAttemptId: string;
  estimatedBand: number;
  assessedAt: string;
  startedAt: string;
}
interface AssessmentRecord {
  _id: string;
  duoId: string;
  userId: string;
  role: DuoRole;
  kind: "gate" | "promotion";
  band: number;
  gateId: string | null;
  roomId: string | null;
  status: DuoResultStatus;
  active: boolean;
  parts: DuoAssessmentPart[];
  passPercent: number;
  requiredBand: number;
  deadlineAt: string;
  createdAt: string;
  completedAt: string | null;
  revision: number;
  invalidatedAt?: string;
  integrityReason?: string;
}
interface RoomPresence {
  userId: string;
  joinedAt: string | null;
  lastSeenAt: string | null;
  readyAt: string | null;
  companion: boolean;
  assessmentId: string | null;
  documentId?: string;
}
interface RoomRecord {
  _id: string;
  duoId: string;
  band: number;
  status: DuoRoomView["status"];
  active: boolean;
  members: Record<DuoRole, RoomPresence>;
  startsAt: string | null;
  deadlineAt: string | null;
  createdAt: string;
  revision: number;
  /** The exam set belongs to one shared sitting, never to the curriculum. */
  contentIds?: string[];
  invalidatedAt?: string;
  integrityReason?: string;
  requiresPresence?: boolean;
}
export interface DuoIntegrityInvalidation {
  assessmentIds: string[];
  attemptIds: string[];
  roomId: string | null;
}
export interface DuoRouteHooks {
  beforeStart(request: Request): void;
  opened(user: UserRecord, assessmentId: string, request: Request): Promise<void>;
  check(user: UserRecord, assessmentId: string): Promise<void>;
}
export interface DuoConfig {
  gateInterval?: 5 | 10;
  sessionsPerBand?: number;
  sessionsByBand?: Record<string, number>;
  passPercent?: number;
  strictRetakeMode?: boolean;
  countdownSeconds?: number;
  presenceTimeoutSeconds?: number;
  readyTimeoutSeconds?: number;
  startGraceSeconds?: number;
  now?: () => number;
  /** Server-owned curriculum only. Request bodies cannot change curriculum or thresholds. */
  lessonKinds?: (ContentKind | "vocabulary")[];
  /** Read-only cache guard before starting any assessment clock or Ready countdown. */
  ensureAudioReady?: (contents: StoredContent[]) => Promise<void>;
}
export interface DuoAttemptInput {
  contentId: string;
  mode: "practice" | "exam";
  duoAssessmentId?: string;
}
export interface DuoAttemptPermission {
  duoAssessmentId?: string;
  deadlineAt?: string;
  existingAttemptId?: string;
}
const asyncRoute =
  (handler: (request: Request, response: Response) => Promise<void>) =>
  (request: Request, response: Response, next: NextFunction) => {
    void handler(request, response).catch(next);
  };
const routeId = (request: Request) =>
  z
    .string()
    .regex(/^[\w:.-]{1,180}$/)
    .parse(request.params.id);

/** All shared-band decisions are compare-and-swap updates of one path document.
 * Separate assessment/room records are receipts; stale receipts cannot advance a band.
 * This also works on a standalone MongoDB without multi-document transactions. */
export class DuoService {
  private paths: Collection<PathRecord>;
  private placements: Collection<PlacementResultRecord>;
  private assessments: Collection<AssessmentRecord>;
  private rooms: Collection<RoomRecord>;
  private config: Required<DuoConfig>;
  private initialization?: Promise<void>;
  private strictRoomMonitoring = false;
  constructor(
    private database: Database,
    config: DuoConfig = {},
  ) {
    this.config = {
      gateInterval: config.gateInterval ?? 5,
      sessionsPerBand: config.sessionsPerBand ?? 20,
      sessionsByBand: { ...(config.sessionsByBand ?? {}) },
      passPercent: config.passPercent ?? 70,
      strictRetakeMode: config.strictRetakeMode ?? false,
      countdownSeconds: config.countdownSeconds ?? 5,
      presenceTimeoutSeconds: config.presenceTimeoutSeconds ?? 30,
      readyTimeoutSeconds: config.readyTimeoutSeconds ?? 120,
      startGraceSeconds: config.startGraceSeconds ?? 20,
      now: config.now ?? Date.now,
      lessonKinds: config.lessonKinds ?? [
        "reading",
        "listening",
        "writing",
        "speaking",
        "grammar",
      ],
      ensureAudioReady: config.ensureAudioReady ?? (async () => undefined),
    };
    if (
      ![5, 10].includes(this.config.gateInterval) ||
      !Number.isInteger(this.config.sessionsPerBand) ||
      this.config.sessionsPerBand < this.config.gateInterval ||
      this.config.sessionsPerBand > 100 ||
      !Number.isFinite(this.config.passPercent) ||
      this.config.passPercent < 1 ||
      this.config.passPercent > 100 ||
      !this.config.lessonKinds.length ||
      this.config.countdownSeconds < 1 ||
      this.config.presenceTimeoutSeconds < 5 ||
      this.config.readyTimeoutSeconds < 5 ||
      this.config.startGraceSeconds < 1
    )
      throw new Error("Invalid server-owned Duo configuration");
    const configuredBands = new Set<string>();
    for (const [key, sessions] of Object.entries(this.config.sessionsByBand)) {
      const value = Number(key);
      if (
        !/^[3-8](?:\.[05])?$/.test(key) ||
        value < 3 ||
        value > 8 ||
        !Number.isInteger(value * 2) ||
        !Number.isInteger(sessions) ||
        sessions < this.config.gateInterval ||
        sessions > 100 ||
        configuredBands.has(String(value))
      )
        throw new Error("Invalid per-band Duo session configuration");
      configuredBands.add(String(value));
    }
    this.config.sessionsByBand = Object.fromEntries(
      Object.entries(this.config.sessionsByBand).map(([key, value]) => [
        String(Number(key)),
        value,
      ]),
    );
    this.paths = database.db.collection<PathRecord>("duo_learning_paths");
    this.placements = database.db.collection<PlacementResultRecord>(
      "duo_placement_results",
    );
    this.assessments =
      database.db.collection<AssessmentRecord>("duo_assessments");
    this.rooms = database.db.collection<RoomRecord>("duo_promotion_rooms");
  }
  initialize(): Promise<void> {
    this.initialization ??= Promise.all([
      this.placements.createIndex({ duoId: 1, userId: 1, startedAt: -1 }),
      this.assessments.createIndex({ duoId: 1, userId: 1, createdAt: -1 }),
      this.assessments.createIndex(
        { duoId: 1, userId: 1, kind: 1, band: 1, gateId: 1 },
        { unique: true, partialFilterExpression: { active: true } },
      ),
      this.rooms.createIndex(
        { duoId: 1, band: 1 },
        { unique: true, partialFilterExpression: { active: true } },
      ),
    ])
      .then(() => undefined)
      .catch((error: unknown) => {
        this.initialization = undefined;
        throw error;
      });
    return this.initialization;
  }
  private now() {
    return this.config.now();
  }
  private iso() {
    return new Date(this.now()).toISOString();
  }
  private async member(user: UserRecord): Promise<{
    user: DuoUser & { duoRole: DuoRole; duoId: string };
    members: Record<DuoRole, DuoUser>;
  }> {
    await this.initialize();
    const candidate = user as DuoUser;
    if (
      !candidate.duoId ||
      !candidate.duoRole ||
      !ROLES.includes(candidate.duoRole)
    )
      throw new ApiError(403, "Tài khoản chưa được gán vào hành trình Duo.");
    const users = (await this.database.users
      .find({ duoId: candidate.duoId })
      .toArray()) as DuoUser[];
    const husband = users.filter((entry) => entry.duoRole === "husband");
    const wife = users.filter((entry) => entry.duoRole === "wife");
    if (husband.length !== 1 || wife.length !== 1 || users.length !== 2)
      throw new ApiError(
        409,
        "Hành trình Duo cần đúng hai tài khoản đã cấu hình.",
      );
    const members = { husband: husband[0], wife: wife[0] };
    if (members[candidate.duoRole]._id !== candidate._id)
      throw new ApiError(403, "Bạn không thuộc hành trình này.");
    return {
      user: candidate as DuoUser & { duoRole: DuoRole; duoId: string },
      members,
    };
  }
  private async path(user: UserRecord): Promise<PathRecord> {
    const { user: member } = await this.member(user);
    const path = await this.paths.findOne({ _id: member.duoId });
    if (!path)
      throw new ApiError(
        409,
        "Cả hai cần hoàn thành bài kiểm tra đầu vào trước khi mở lộ trình chung.",
      );
    if (path.members[member.duoRole] !== member.id)
      throw new ApiError(403, "Bạn không thuộc lộ trình này.");
    return path;
  }
  private async changePath(
    duoId: string,
    change: (path: PathRecord) => void | boolean,
  ): Promise<PathRecord> {
    for (let retry = 0; retry < 30; retry++) {
      const path = await this.paths.findOne({ _id: duoId });
      if (!path) throw new ApiError(409, "Chưa có lộ trình chung.");
      const modified = structuredClone(path);
      if (change(modified) === false) return path;
      modified.revision++;
      modified.updatedAt = this.iso();
      const result = await this.paths.replaceOne(
        { _id: duoId, revision: path.revision },
        modified,
      );
      if (result.modifiedCount) return modified;
    }
    throw new ApiError(409, "Lộ trình đang được cập nhật. Vui lòng tải lại.");
  }
  private async buildBand(
    band: number,
    duoId: string,
    testType: "academic" | "general",
  ): Promise<BandRecord> {
    const content = await this.database.content
      .find({ testType: { $in: [testType, "both"] } })
      .toArray();
    const nearest = (kind: ContentKind, format: "lesson" | "full-mock") =>
      content
        .filter((row) => row.skill === kind && row.format === format)
        .sort(
          (a, b) =>
            Math.abs(a.band - band) - Math.abs(b.band - band) ||
            a.id.localeCompare(b.id),
        );
    const vocabulary = await this.database.vocabulary
      .find()
      .sort({ _id: 1 })
      .limit(1000)
      .toArray();
    const used = new Map<string, number>();
    const sessionCount =
      this.config.sessionsByBand[String(band)] ?? this.config.sessionsPerBand;
    const lessons: LessonRecord[] = [];
    for (let index = 0; index < sessionCount; index++) {
      const kind =
        this.config.lessonKinds[index % this.config.lessonKinds.length];
      let contentId: string | null = null;
      let title = "Ôn tập từ vựng theo ngữ cảnh";
      let vocabularyIds: string[] = [];
      if (kind === "vocabulary") {
        vocabularyIds = vocabulary
          .slice(
            (Math.round(band * 2) + index) % Math.max(1, vocabulary.length - 5),
            ((Math.round(band * 2) + index) %
              Math.max(1, vocabulary.length - 5)) +
              5,
          )
          .map((row) => row.id);
        if (!vocabularyIds.length)
          throw new ApiError(409, "Chưa có học liệu từ vựng cho lộ trình.");
      } else {
        const candidates = nearest(kind, "lesson");
        const candidate =
          candidates.find((item) => !used.has(item.id)) ?? candidates[0];
        if (!candidate)
          throw new ApiError(
            409,
            `Chưa có học liệu ${kind} cho band ${band.toFixed(1)}.`,
          );
        used.set(candidate.id, 1);
        contentId = candidate.id;
        title = candidate.title;
      }
      lessons.push({
        id: `${duoId}:${bandKey(band)}:lesson:${index + 1}`,
        number: index + 1,
        title,
        kind,
        contentId,
        vocabularyIds,
        completion: pair(null),
      });
    }
    const gates: GateRecord[] = [];
    for (
      let after = this.config.gateInterval;
      after < sessionCount;
      after += this.config.gateInterval
    ) {
      const segment = lessons.slice(after - this.config.gateInterval, after);
      const contentIds = segment
        .filter(
          (lesson) =>
            ["reading", "listening", "grammar"].includes(lesson.kind) &&
            lesson.contentId,
        )
        .map((lesson) => lesson.contentId!);
      if (!contentIds.length)
        contentIds.push(
          ...segment
            .filter((lesson) => lesson.contentId)
            .map((lesson) => lesson.contentId!),
        );
      if (!contentIds.length)
        throw new ApiError(
          409,
          "Duo Gate cần ít nhất một bài kiểm tra có thể chấm.",
        );
      gates.push({
        id: `${duoId}:${bandKey(band)}:gate:${gates.length + 1}`,
        number: gates.length + 1,
        fromLesson: after - this.config.gateInterval + 1,
        afterLesson: after,
        contentIds: [...new Set(contentIds)],
        results: pair(null),
      });
    }
    const promotionContentIds = (
      ["reading", "listening", "writing", "speaking"] as ContentKind[]
    ).map((kind) => {
      const candidate = nearest(kind, "full-mock")[0];
      if (!candidate)
        throw new ApiError(409, `Kỳ thi nâng band cần đề ${kind} đủ cấu trúc.`);
      return candidate.id;
    });
    return {
      band,
      unlockedAt: null,
      completedAt: null,
      lessons,
      gates,
      promotionContentIds,
      promotionResults: pair(null),
      lastPromotionRoomId: null,
    };
  }
  /** Records only a completed placement already graded and owned by this learner. */
  async placementCompleted(
    user: UserRecord,
    placement: PlacementRecord,
  ): Promise<void> {
    const { user: member } = await this.member(user);
    const record = await this.database.placements.findOne({
      _id: placement._id,
      userId: member.id,
    });
    if (
      !record ||
      !record.result ||
      record.currentQuestionId !== null ||
      (record.answers.length < record.total && !(record.completionReason === "deadline" &&
        record.result.estimatedBand !== null && record.answers.filter(answer => answer.answer.trim()).length >= 5 &&
        record.deadlineAt && Date.parse(record.deadlineAt) <= this.now())) ||
      record.total < 1 ||
      !Number.isFinite(record.estimatedBand)
    )
      throw new ApiError(409, "Kết quả đầu vào chưa hoàn tất.");
    await this.placements.updateOne(
      { _id: record._id },
      {
        $setOnInsert: {
          _id: record._id,
          duoId: member.duoId,
          userId: member.id,
          role: member.duoRole,
          placementAttemptId: record._id,
          estimatedBand: record.estimatedBand,
          assessedAt: record.result.createdAt,
          startedAt: record.startedAt,
        },
      },
      { upsert: true },
    );
    await this.ensurePath(user);
  }
  private async syncPlacements(user: UserRecord): Promise<void> {
    const { members } = await this.member(user);
    for (const role of ROLES) {
      const records = await this.database.placements
        .find({
          userId: members[role].id,
          result: { $ne: null },
          currentQuestionId: null,
        })
        .toArray();
      for (const record of records)
        if (
          record.total > 0 &&
          (record.answers.length >= record.total || (record.completionReason === "deadline" &&
            record.result?.estimatedBand !== null && record.answers.filter(answer => answer.answer.trim()).length >= 5 &&
            record.deadlineAt && Date.parse(record.deadlineAt) <= this.now())) &&
          Number.isFinite(record.estimatedBand)
        )
          await this.placements.updateOne(
            { _id: record._id },
            {
              $setOnInsert: {
                _id: record._id,
                duoId: (user as DuoUser).duoId!,
                userId: members[role].id,
                role,
                placementAttemptId: record._id,
                estimatedBand: record.estimatedBand,
                assessedAt: record.result!.createdAt,
                startedAt: record.startedAt,
              },
            },
            { upsert: true },
          );
    }
    await this.ensurePath(user);
  }
  private async ensurePath(user: UserRecord): Promise<void> {
    const { user: member, members } = await this.member(user);
    if (
      await this.paths.findOne(
        { _id: member.duoId },
        { projection: { _id: 1 } },
      )
    )
      return;
    const results = await Promise.all(
      ROLES.map((role) =>
        this.placements.findOne(
          { duoId: member.duoId, userId: members[role].id },
          { sort: { startedAt: -1, assessedAt: -1, _id: 1 } },
        ),
      ),
    );
    if (results.some((result) => !result)) return;
    const startingBand = validBand(
      Math.min(...results.map((result) => result!.estimatedBand)),
    );
    const bands: Record<string, BandRecord> = {};
    for (let band = 3; band <= 8; band += 0.5)
      bands[bandKey(band)] = await this.buildBand(
        band,
        member.duoId,
        members.husband.testType,
      );
    const now = this.iso();
    bands[bandKey(startingBand)].unlockedAt = now;
    const path: PathRecord = {
      _id: member.duoId,
      duoId: member.duoId,
      members: { husband: members.husband.id, wife: members.wife.id },
      startingBand,
      currentBand: startingBand,
      targetBand: 8,
      gateInterval: this.config.gateInterval,
      sessionsPerBand: this.config.sessionsPerBand,
      passPercent: this.config.passPercent,
      strictRetakeMode: this.config.strictRetakeMode,
      revision: 0,
      startedAt: now,
      updatedAt: now,
      bands,
    };
    try {
      await this.paths.updateOne(
        { _id: member.duoId },
        { $setOnInsert: path },
        { upsert: true },
      );
    } catch (error) {
      if (!isDuplicate(error)) throw error;
    }
  }
  private lessonUnlocked(band: BandRecord, number: number): boolean {
    return (
      Boolean(band.unlockedAt) &&
      band.gates
        .filter((gate) => gate.afterLesson < number)
        .every((gate) =>
          ROLES.every((role) => gate.results[role]?.status === "passed"),
        )
    );
  }
  private gateEligible(band: BandRecord, gate: GateRecord): boolean {
    return (
      this.lessonUnlocked(band, gate.afterLesson) &&
      band.lessons
        .filter((lesson) => lesson.number <= gate.afterLesson)
        .every((lesson) =>
          ROLES.every((role) => Boolean(lesson.completion[role])),
        )
    );
  }
  private promotionEligible(band: BandRecord): boolean {
    return (
      Boolean(band.unlockedAt) &&
      band.lessons.every((lesson) =>
        ROLES.every((role) => Boolean(lesson.completion[role])),
      ) &&
      band.gates.every((gate) =>
        ROLES.every((role) => gate.results[role]?.status === "passed"),
      )
    );
  }
  private async completeLesson(
    user: UserRecord,
    lessonId: string,
    input: { attemptId?: string; cardIds?: string[] },
  ): Promise<void> {
    const { user: member } = await this.member(user);
    const path = await this.path(user);
    const current = Object.values(path.bands).find((band) =>
      band.band <= path.currentBand && band.lessons.some((entry) => entry.id === lessonId),
    );
    const lesson = current?.lessons.find((entry) => entry.id === lessonId);
    if (!current || !lesson || !this.lessonUnlocked(current, lesson.number))
      throw new ApiError(
        403,
        "Buổi học chưa mở. Cả hai cần hoàn tất Duo Gate trước.",
      );
    const previous = lesson.completion[member.duoRole];
    if (lesson.kind === "vocabulary" && previous) return;
    // Older records predate ordering metadata. Resolve only their owned proof;
    // subsequent concurrent confirmations always include their own timestamps.
    const previousAttempt = previous?.kind === "attempt" && !previous.submittedAt
      ? await this.database.attempts.findOne({ _id: previous.proofIds[0], userId: member.id, contentId: lesson.contentId!, status: "submitted" })
      : null;
    let completion: Completion;
    if (lesson.kind === "vocabulary") {
      const cards = await this.database.cards
        .find({ _id: { $in: input.cardIds ?? [] }, userId: member.id })
        .toArray();
      if (
        !lesson.vocabularyIds.every((id) =>
          cards.some(
            (card) =>
              card.vocabularyId === id &&
              card.reps > 0 &&
              card.reviewLog.some((entry) => {
                try {
                  const review = JSON.parse(entry) as {
                    review?: string;
                    rating?: number;
                  };
                  return (
                    [1, 2, 3, 4].includes(review.rating ?? 0) &&
                    millis(review.review) >= millis(current.unlockedAt) &&
                    millis(review.review) <= this.now()
                  );
                } catch {
                  return false;
                }
              }),
          ),
        )
      )
        throw new ApiError(
          409,
          "Bạn cần ôn các flashcard của buổi học bằng tài khoản của mình.",
        );
      completion = {
        at: this.iso(),
        proofIds: cards.map((card) => card.id),
        kind: "vocabulary",
      };
    } else {
      const attempt = input.attemptId
        ? await this.database.attempts.findOne({
            _id: input.attemptId,
            userId: member.id,
            contentId: lesson.contentId!,
            status: "submitted",
            mode: "practice",
            duoAssessmentId: { $exists: false },
            invalidatedAt: { $exists: false },
          })
        : null;
      const content = await this.database.content.findOne({
        _id: lesson.contentId!,
      });
      let evidence = false;
      if (attempt && content) {
        const words = (text: string) =>
          text.trim().split(/\s+/).filter(Boolean).length;
        if (attempt.skill === "writing") {
          const tasks = content.sections.filter(
            (section) => section.task === 1 || section.task === 2,
          );
          evidence =
            tasks.length > 0 &&
            tasks.every(
              (section) =>
                words(
                  attempt.essays[section.id] ??
                    attempt.essays[`task${section.task}`] ??
                    attempt.essays[String(section.task)] ??
                    "",
                ) >= (section.task === 1 ? 150 : 250),
            );
        } else if (attempt.skill === "speaking") {
          const transcript = attempt.transcript.trim();
          const distinct = new Set(
            transcript.toLowerCase().split(/\s+/).filter(Boolean),
          );
          evidence =
            (words(transcript) >= 30 && distinct.size >= 12) ||
            Boolean(
              await this.database.audio.findOne({
                userId: member.id,
                attemptId: attempt.id,
              }),
            );
        } else {
          const answered = content.questions.filter((question) =>
            (attempt.responses[question.id] ?? "").trim(),
          ).length;
          evidence =
            content.questions.length > 0 &&
            answered >= Math.ceil(content.questions.length * 0.8) &&
            attempt.feedback?.total === content.questions.length;
        }
      }
      if (
        !attempt ||
        !attempt.feedback ||
        !evidence ||
        millis(attempt.submittedAt) < millis(current.unlockedAt)
      )
        throw new ApiError(
          409,
          "Cần bài làm đủ nội dung đã nộp và chấm của chính bạn: trả lời ít nhất 80% câu hỏi, đủ 150/250 từ cho từng Writing task, hoặc bản nói có nội dung/ghi âm.",
        );
      completion = { at: this.iso(), proofIds: [attempt.id], kind: "attempt", submittedAt: attempt.submittedAt!, startedAt: attempt.startedAt };
    }
    await this.changePath(path.duoId, (latest) => {
      const latestBand = latest.bands[bandKey(current.band)];
      const target = latestBand?.lessons.find((entry) => entry.id === lessonId);
      if (!latestBand || current.band > latest.currentBand || !target || !this.lessonUnlocked(latestBand, target.number))
        throw new ApiError(403, "Buổi học chưa mở.");
      const saved = target.completion[member.duoRole];
      if (saved) {
        if (saved.kind !== "attempt" || completion.kind !== "attempt" || saved.proofIds[0] === completion.proofIds[0]) return false;
        const legacy = saved.proofIds[0] === previousAttempt?.id ? previousAttempt : null;
        const savedSubmittedAt = saved.submittedAt ?? legacy?.submittedAt;
        const savedStartedAt = saved.startedAt ?? legacy?.startedAt;
        if (!savedSubmittedAt || !savedStartedAt) return false;
        const candidateOrder = [completion.submittedAt!, completion.startedAt!, completion.proofIds[0]].join("\u0000");
        const savedOrder = [savedSubmittedAt, savedStartedAt, saved.proofIds[0]].join("\u0000");
        if (candidateOrder <= savedOrder) return false;
      }
      target.completion[member.duoRole] = { ...completion, at: saved?.at ?? completion.at };
    });
  }
  private assessmentView(record: AssessmentRecord): DuoAssessmentView {
    return {
      id: record._id,
      kind: record.kind,
      band: record.band,
      gateId: record.gateId,
      roomId: record.roomId,
      status: record.status,
      parts: record.parts,
      passPercent: record.passPercent,
      requiredBand: record.requiredBand,
      deadlineAt: record.deadlineAt,
      createdAt: record.createdAt,
      completedAt: record.completedAt,
      ...(record.invalidatedAt ? {
        invalidatedAt: record.invalidatedAt, integrityReason: record.integrityReason,
        integrity: { status: "invalidated" as const, reason: record.integrityReason },
      } : {}),
      serverNow: this.iso(),
    };
  }
  private async assessment(
    user: UserRecord,
    assessmentId: string,
  ): Promise<AssessmentRecord> {
    const { user: member } = await this.member(user);
    const record = await this.assessments.findOne({
      _id: assessmentId,
      duoId: member.duoId,
      userId: member.id,
    });
    if (!record)
      throw new ApiError(404, "Không tìm thấy bài đánh giá của bạn.");
    return record;
  }
  private deniedAssessment(path: PathRecord, assessment: AssessmentRecord): boolean {
    return Boolean(
      assessment.invalidatedAt ||
      path.invalidatedAssessmentIds?.includes(assessment._id) ||
      (assessment.roomId && path.invalidatedRoomIds?.includes(assessment.roomId)),
    );
  }
  private invalidationReason(path: PathRecord, assessmentId: string | null, roomId: string | null): string {
    return path.integrityInvalidations?.findLast(entry =>
      Boolean((assessmentId && entry.assessmentIds.includes(assessmentId)) || (roomId && entry.roomId === roomId)),
    )?.reason ?? "exam-invalidated";
  }
  private async cancelAssessments(
    assessmentIds: string[],
    reason: string,
    roomId: string | null,
  ): Promise<DuoIntegrityInvalidation> {
    const records = await this.assessments.find({ _id: { $in: assessmentIds } }).toArray();
    const at = this.iso();
    for (const record of records)
      await this.assessments.updateOne(
        { _id: record._id, invalidatedAt: { $exists: false } },
        { $set: {
          active: false, status: "failed", completedAt: at, invalidatedAt: at, integrityReason: reason,
          parts: record.parts.map(part => ({ ...part, status: "failed" as const, scorePercent: null, estimatedBand: null })),
        }, $inc: { revision: 1 } },
      );
    // Include unbound attempts: an attempt insert can overlap assessment cancellation.
    const attempts = await this.database.attempts.find({ duoAssessmentId: { $in: assessmentIds } }).toArray();
    const attemptIds = [...new Set([
      ...attempts.map(attempt => attempt._id),
      ...records.flatMap(record => record.parts.flatMap(part => part.attemptId ? [part.attemptId] : [])),
    ])];
    if (attemptIds.length)
      await this.database.attempts.updateMany(
        { _id: { $in: attemptIds }, duoAssessmentId: { $in: assessmentIds } },
        [{ $set: {
          status: "invalidated", responses: {}, essays: {}, transcript: "", feedback: null,
          submittedAt: null, durationSeconds: 0,
          invalidatedAt: { $ifNull: ["$invalidatedAt", at] }, integrityReason: { $ifNull: ["$integrityReason", reason] },
          "integrity.status": "invalidated", "integrity.reason": { $ifNull: ["$integrityReason", reason] },
        } }, { $unset: ["submissionLease", "listeningPlayed"] }],
      );
    const audio = await this.database.audio.find({ attemptId: { $in: attemptIds }, userId: { $in: records.map(record => record.userId) } }).toArray();
    for (const recording of audio) {
      const owned = await this.database.db.collection("recordings.files").findOne({
        _id: recording.fileId, "metadata.userId": recording.userId, "metadata.attemptId": recording.attemptId,
      });
      if (owned) {
        await this.database.recordings.delete(recording.fileId).catch(async error => {
          // Another concurrent cancellation may have removed the same file.
          if (await this.database.db.collection("recordings.files").findOne({ _id: recording.fileId })) throw error;
        });
      }
      await this.database.audio.deleteOne({ _id: recording._id, userId: recording.userId, attemptId: recording.attemptId });
    }
    if (records.length && await this.database.db.listCollections({ name: "exam_integrity_sessions" }, { nameOnly: true }).hasNext()) {
      const guardReason = ["hidden", "page-exit", "duplicate-tab", "navigation", "heartbeat-lost"].includes(reason) ? reason : "navigation";
      await this.database.db.collection("exam_integrity_sessions").updateMany({
        kind: "assessment", $or: records.map(record => ({ userId: record.userId, resourceId: record._id })),
      }, { $set: { status: "invalidated", resetPending: false, reason: guardReason, updatedAt: at } });
    }
    return { assessmentIds, attemptIds, roomId };
  }
  /** Fence the path first: a concurrent grader can never reapply a cancelled receipt. */
  async invalidateIntegrity(
    user: UserRecord,
    assessmentId: string,
    reason: string,
  ): Promise<DuoIntegrityInvalidation> {
    const { user: member } = await this.member(user);
    const assessment = await this.assessment(user, assessmentId);
    if (assessment.kind === "promotion") {
      const room = await this.room(user, assessment.roomId!);
      return this.invalidateRoomIntegrity(member, room, reason);
    }
    let accepted = false;
    const currentPath = await this.changePath(member.duoId, path => {
      accepted = false;
      if (path.invalidatedAssessmentIds?.includes(assessment._id)) {
        accepted = true;
        return false;
      }
      const band = path.bands[bandKey(assessment.band)];
      const gate = band?.gates.find(entry => entry.id === assessment.gateId);
      if (
        path.members[member.duoRole] !== member.id || path.currentBand !== assessment.band ||
        !assessment.active || band?.completedAt || !gate ||
        (gate.results[member.duoRole] && gate.results[member.duoRole]!.assessmentId !== assessment._id)
      ) return false;
      accepted = true;
      path.invalidatedAssessmentIds = [...new Set([...(path.invalidatedAssessmentIds ?? []), assessment._id])];
      path.integrityInvalidations = [...(path.integrityInvalidations ?? []), {
        assessmentIds: [assessment._id], roomId: null, reason, at: this.iso(),
      }];
      if (gate.results[member.duoRole]?.assessmentId === assessment._id)
        gate.results[member.duoRole] = null;
    });
    if (!accepted) throw new ApiError(409, "Bài đánh giá đã đóng; kết quả đã hoàn tất được bảo lưu.");
    return this.cancelAssessments([assessment._id], this.invalidationReason(currentPath, assessment._id, null), null);
  }
  private async invalidateRoomIntegrity(
    member: DuoUser & { duoRole: DuoRole; duoId: string },
    room: RoomRecord,
    reason: string,
  ): Promise<DuoIntegrityInvalidation> {
    if (room.members[member.duoRole].userId !== member.id)
      throw new ApiError(403, "Bạn không thuộc phòng thi này.");
    const records = await this.assessments.find({ roomId: room._id, duoId: member.duoId }).toArray();
    const assessmentIds = [...new Set([
      ...records.map(record => record._id),
      ...ROLES.filter(role => !room.members[role].companion).map(role => `${room._id}:${role}`),
    ])];
    // Accepted final submissions belong to the server while provider grading runs.
    if (!room.invalidatedAt && await this.roomFinalSubmissionsAccepted(room))
      return { assessmentIds: [], attemptIds: [], roomId: room._id };
    let accepted = false;
    const currentPath = await this.changePath(member.duoId, path => {
      accepted = false;
      if (path.invalidatedRoomIds?.includes(room._id)) {
        accepted = true;
        return false;
      }
      const band = path.bands[bandKey(room.band)];
      if (
        path.members[member.duoRole] !== member.id || path.currentBand !== room.band ||
        !room.active || room.status !== "in-progress" || !band || band.completedAt ||
        band.lastPromotionRoomId !== room._id
      ) return false;
      accepted = true;
      path.invalidatedRoomIds = [...new Set([...(path.invalidatedRoomIds ?? []), room._id])];
      path.invalidatedAssessmentIds = [...new Set([...(path.invalidatedAssessmentIds ?? []), ...assessmentIds])];
      path.integrityInvalidations = [...(path.integrityInvalidations ?? []), {
        assessmentIds, roomId: room._id, reason, at: this.iso(),
      }];
      for (const role of ROLES)
        if (band.promotionResults[role] && assessmentIds.includes(band.promotionResults[role]!.assessmentId))
          band.promotionResults[role] = null;
    });
    if (!accepted) throw new ApiError(409, "Phòng thi đã đóng; band đã hoàn tất được bảo lưu.");
    return this.cancelRoom(room, assessmentIds, this.invalidationReason(currentPath, null, room._id));
  }
  private async cancelRoom(room: RoomRecord, assessmentIds: string[], reason: string): Promise<DuoIntegrityInvalidation> {
    await this.changeRoom(room._id, latest => {
      if (latest.invalidatedAt) return false;
      latest.active = false;
      latest.status = "invalidated";
      latest.invalidatedAt = this.iso();
      latest.integrityReason = reason;
      for (const role of ROLES) latest.members[role].readyAt = null;
    });
    return this.cancelAssessments(assessmentIds, reason, room._id);
  }
  private async replacementSet(contentIds: string[], excludedContentIds: string[]): Promise<string[]> {
    const contents = await this.database.content.find({ _id: { $in: [...contentIds, ...excludedContentIds] } }).toArray();
    const excluded = [...new Set([...excludedContentIds, ...contents.flatMap(examReplacementSourceIds)])];
    const replacements: string[] = [];
    for (const id of contentIds) {
      const source = contents.find(content => content.id === id);
      if (!source) throw new ApiError(409, "Học liệu của bài đánh giá chưa đầy đủ.");
      const replacement = await createExamReplacement(this.database, source, [...excluded, ...replacements]).catch(error => {
        if (error instanceof ExamReplacementUnavailableError) throw new ApiError(409, error.message);
        throw error;
      });
      await this.database.content.insertOne(replacement);
      replacements.push(replacement.id);
    }
    return replacements;
  }
  private async makeAssessment(
    path: PathRecord,
    user: DuoUser,
    kind: "gate" | "promotion",
    contentIds: string[],
    gateId: string | null,
    room: RoomRecord | null,
  ): Promise<AssessmentRecord> {
    if (room) {
      const currentPath = await this.paths.findOne({ _id: path.duoId });
      const currentRoom = await this.rooms.findOne({ _id: room._id });
      if (!currentPath || !currentRoom || currentRoom.status !== "in-progress" ||
        currentPath.invalidatedRoomIds?.includes(room._id))
        throw new ApiError(409, "Phòng thi đã đóng.");
    }
    const contents = await this.database.content
      .find({ _id: { $in: contentIds } })
      .toArray();
    if (contents.length !== contentIds.length)
      throw new ApiError(409, "Học liệu của bài đánh giá chưa đầy đủ.");
    await this.config.ensureAudioReady(contents);
    let sectionStart = room ? millis(room.startsAt) : this.now();
    const parts = contentIds.map((contentId): DuoAssessmentPart => {
      const content = contents.find((item) => item.id === contentId)!;
      const startsAt = new Date(sectionStart).toISOString();
      const deadlineAt = new Date(
        sectionStart + content.durationMinutes * 60_000,
      ).toISOString();
      if (room) sectionStart = millis(deadlineAt);
      return {
        contentId,
        title: content.title,
        skill: content.skill,
        attemptId: null,
        status: "in-progress",
        scorePercent: null,
        estimatedBand: null,
        startsAt,
        deadlineAt,
      };
    });
    const duration = contents.reduce(
      (sum, content) => sum + content.durationMinutes,
      0,
    );
    const record: AssessmentRecord = {
      _id: room ? `${room._id}:${user.duoRole}` : randomUUID(),
      duoId: path.duoId,
      userId: user.id,
      role: user.duoRole!,
      kind,
      band: path.currentBand,
      gateId,
      roomId: room?._id ?? null,
      status: "in-progress",
      active: true,
      parts,
      passPercent: path.passPercent,
      requiredBand: Math.min(8, path.currentBand + 0.5),
      deadlineAt:
        room?.deadlineAt ??
        new Date(this.now() + Math.max(1, duration) * 60_000).toISOString(),
      createdAt: this.iso(),
      completedAt: null,
      revision: 0,
    };
    let created: AssessmentRecord;
    try {
      await this.assessments.insertOne(record);
      created = record;
    } catch (error) {
      if (!isDuplicate(error)) throw error;
      const concurrent = await this.assessments.findOne(
        room
          ? { _id: record._id }
          : {
              duoId: path.duoId,
              userId: user.id,
              kind,
              band: path.currentBand,
              gateId,
              active: true,
            },
      );
      if (!concurrent) throw error;
      created = concurrent;
    }
    const currentPath = await this.paths.findOne({ _id: path.duoId });
    if (currentPath && this.deniedAssessment(currentPath, created)) {
      await this.cancelAssessments([created._id], this.invalidationReason(currentPath, created._id, created.roomId), created.roomId);
      return (await this.assessments.findOne({ _id: created._id }))!;
    }
    return created;
  }
  private async startGate(
    user: UserRecord,
    gateId: string,
  ): Promise<AssessmentRecord> {
    const { user: member } = await this.member(user);
    const path = await this.path(user);
    const band = path.bands[bandKey(path.currentBand)];
    const gate = band.gates.find((entry) => entry.id === gateId);
    if (!gate || !this.gateEligible(band, gate))
      throw new ApiError(
        403,
        "Cả hai cần hoàn tất các buổi học trước Duo Gate.",
      );
    if (gate.results[member.duoRole]?.status === "passed")
      return this.assessment(user, gate.results[member.duoRole]!.assessmentId);
    const active = await this.assessments.findOne({
      duoId: path.duoId,
      userId: member.id,
      band: path.currentBand,
      kind: "gate",
      gateId,
      active: true,
    });
    if (active) {
      const reconciled = await this.reconcileAssessment(active);
      if (!reconciled.invalidatedAt) return reconciled;
    }
    const invalidated = await this.assessments.find({
      duoId: path.duoId, userId: member.id, band: path.currentBand, kind: "gate", gateId,
      invalidatedAt: { $exists: true },
    }).toArray();
    const contentIds = invalidated.length
      ? await this.replacementSet(gate.contentIds, invalidated.flatMap(record => record.parts.map(part => part.contentId)))
      : gate.contentIds;
    const created = await this.makeAssessment(
      path,
      member,
      "gate",
      contentIds,
      gate.id,
      null,
    );
    await this.changePath(path.duoId, (latest) => {
      if (latest.currentBand !== path.currentBand) return false;
      if (this.deniedAssessment(latest, created)) return false;
      const target = latest.bands[bandKey(path.currentBand)].gates.find(
        (entry) => entry.id === gateId,
      )!;
      if (target.results[member.duoRole]?.status === "passed") return false;
      target.results[member.duoRole] = {
        status: created.status,
        assessmentId: created._id,
        at: this.iso(),
      };
    });
    return created;
  }
  async beforeAttempt(
    user: UserRecord,
    input: DuoAttemptInput,
  ): Promise<DuoAttemptPermission> {
    if (!input.duoAssessmentId) return {};
    if (input.mode !== "exam")
      throw new ApiError(
        400,
        "Duo Gate và kỳ thi nâng band phải dùng chế độ thi.",
      );
    const { user: member } = await this.member(user);
    const path = await this.path(user);
    const assessment = await this.reconcileAssessment(
      await this.assessment(user, input.duoAssessmentId),
    );
    if (
      path.currentBand !== assessment.band ||
      !assessment.active ||
      this.now() >= millis(assessment.deadlineAt)
    )
      throw new ApiError(
        403,
        "Bài đánh giá đã đóng hoặc band chung đã thay đổi.",
      );
    const band = path.bands[bandKey(path.currentBand)];
    if (assessment.kind === "gate") {
      const gate = band.gates.find((entry) => entry.id === assessment.gateId);
      if (!gate || !this.gateEligible(band, gate))
        throw new ApiError(403, "Duo Gate chưa đủ điều kiện.");
    } else {
      const room = await this.reconcileRoom(
        await this.room(user, assessment.roomId!),
      );
      if (
        room.status !== "in-progress" ||
        room.members[member.duoRole].companion ||
        room.members[member.duoRole].assessmentId !== assessment._id ||
        !this.promotionEligible(band)
      )
        throw new ApiError(
          403,
          "Kỳ thi nâng band chưa được bắt đầu cùng nhau.",
        );
    }
    const partIndex = assessment.parts.findIndex(
      (entry) => entry.contentId === input.contentId,
    );
    const part = assessment.parts[partIndex];
    if (!part) throw new ApiError(403, "Bài tập không thuộc bài đánh giá này.");
    if (!part.attemptId && assessment.kind === "promotion") {
      if (
        this.now() < millis(part.startsAt) ||
        this.now() >= millis(part.deadlineAt)
      )
        throw new ApiError(
          403,
          "Phần thi chưa đến giờ hoặc đã hết giờ theo đồng hồ chung của server.",
        );
      const previousIds = assessment.parts
        .slice(0, partIndex)
        .map((entry) => entry.attemptId);
      const completed = await this.database.attempts.countDocuments({
        _id: { $in: previousIds.filter((id): id is string => Boolean(id)) },
        userId: member.id,
        status: "submitted",
      });
      if (completed !== partIndex)
        throw new ApiError(
          403,
          "Bạn cần nộp các phần thi trước trước khi chuyển phần.",
        );
    }
    const content = await this.database.content.findOne({
      _id: input.contentId,
    });
    if (!content) throw new ApiError(404, "Không tìm thấy học liệu.");
    const deadlineAt =
      assessment.kind === "promotion"
        ? part.deadlineAt
        : new Date(
            Math.min(
              millis(assessment.deadlineAt),
              this.now() + content.durationMinutes * 60_000,
            ),
          ).toISOString();
    return {
      duoAssessmentId: assessment._id,
      deadlineAt,
      ...(part.attemptId ? { existingAttemptId: part.attemptId } : {}),
    };
  }
  async bindAttempt(
    user: UserRecord,
    attemptId: string,
    assessmentId?: string,
  ): Promise<void> {
    if (!assessmentId) return;
    const attempt = await this.database.attempts.findOne({
      _id: attemptId,
      userId: user.id,
    });
    if (
      !attempt ||
      attempt.duoAssessmentId !== assessmentId ||
      attempt.mode !== "exam"
    )
      throw new ApiError(403, "Lượt thi không có liên kết Duo hợp lệ.");
    let permission: DuoAttemptPermission;
    try {
      permission = await this.beforeAttempt(user, {
        contentId: attempt.contentId,
        mode: attempt.mode,
        duoAssessmentId: assessmentId,
      });
    } catch (error) {
      const record = await this.assessment(user, assessmentId);
      const path = await this.path(user);
      if (this.deniedAssessment(path, record))
        await this.cancelAssessments([assessmentId], record.integrityReason ?? "exam-invalidated", record.roomId);
      throw error;
    }
    if (
      permission.existingAttemptId &&
      permission.existingAttemptId !== attemptId
    )
      throw new ApiError(409, "Phần thi đã được mở ở phiên khác.");
    const assessment = await this.assessment(user, assessmentId);
    const partIndex = assessment.parts.findIndex(
      (entry) => entry.contentId === attempt.contentId,
    );
    const result = await this.assessments.updateOne(
      {
        _id: assessmentId,
        userId: user.id,
        active: true,
        [`parts.${partIndex}.attemptId`]: null,
      },
      {
        $set: { [`parts.${partIndex}.attemptId`]: attemptId },
        $inc: { revision: 1 },
      },
    );
    if (!result.modifiedCount) {
      const current = await this.assessment(user, assessmentId);
      if (!current.active || current.invalidatedAt || current.parts[partIndex].attemptId !== attemptId)
        throw new ApiError(409, "Phần thi vừa được mở ở phiên khác.");
    }
    const latest = await this.assessment(user, assessmentId);
    if (this.deniedAssessment(await this.path(user), latest)) {
      await this.cancelAssessments([assessmentId], latest.integrityReason ?? "exam-invalidated", latest.roomId);
      throw new ApiError(409, "Bài đánh giá đã bị đặt lại.");
    }
  }
  async attemptSubmitted(attempt: AttemptRecord): Promise<void> {
    const assessmentId = attempt.duoAssessmentId;
    if (!assessmentId) return;
    const assessment = await this.assessments.findOne({
      _id: assessmentId,
      userId: attempt.userId,
      "parts.attemptId": attempt._id,
    });
    if (assessment) await this.reconcileAssessment(assessment);
  }
  private async reconcileAssessment(
    initial: AssessmentRecord,
  ): Promise<AssessmentRecord> {
    for (let retry = 0; retry < 30; retry++) {
      const record =
        retry === 0
          ? initial
          : await this.assessments.findOne({ _id: initial._id });
      if (!record) throw new ApiError(404, "Không tìm thấy bài đánh giá.");
      if (record.invalidatedAt) return record;
      const path = await this.paths.findOne({ _id: record.duoId });
      if (path && this.deniedAssessment(path, record)) {
        await this.cancelAssessments([record._id], this.invalidationReason(path, record._id, record.roomId), record.roomId);
        return (await this.assessments.findOne({ _id: record._id }))!;
      }
      if (record.status === "passed") {
        await this.applyResult(record);
        return record;
      }
      const attempts = await this.database.attempts
        .find({
          _id: {
            $in: record.parts
              .map((part) => part.attemptId)
              .filter((id): id is string => Boolean(id)),
          },
          userId: record.userId,
        })
        .toArray();
      const writingContent = await this.database.content
        .find({
          _id: {
            $in: record.parts
              .filter((part) => part.skill === "writing")
              .map((part) => part.contentId),
          },
        })
        .toArray();
      const savedAudio = await this.database.audio
        .find({
          userId: record.userId,
          attemptId: { $in: attempts.map((attempt) => attempt.id) },
        })
        .toArray();
      const files = await this.database.db
        .collection("recordings.files")
        .find({
          _id: { $in: savedAudio.map((audio) => audio.fileId) },
          "metadata.userId": record.userId,
        })
        .toArray();
      const audioEvidence = new Set(
        savedAudio
          .filter(
            (audio) =>
              files.some(
                (file) =>
                  file._id.equals(audio.fileId) &&
                  file.metadata?.attemptId === audio.attemptId,
              ) &&
              attempts.some(
                (attempt) =>
                  attempt.id === audio.attemptId &&
                  (!attempt.deadlineAt ||
                    millis(audio.createdAt) <= millis(attempt.deadlineAt)),
              ),
          )
          .map((audio) => audio.attemptId),
      );
      const parts = record.parts.map((part): DuoAssessmentPart => {
        const attempt = attempts.find(
          (item) =>
            item._id === part.attemptId &&
            item.contentId === part.contentId &&
            item.duoAssessmentId === record._id,
        );
        if (!attempt || attempt.status !== "submitted" || !attempt.feedback) {
          const lease = (
            attempt as
              | (AttemptRecord & {
                  submissionLease?: { token?: string; expiresAt?: string };
                })
              | undefined
          )?.submissionLease;
          const grading = Boolean(
            attempt?.status === "in-progress" &&
              typeof lease?.token === "string" &&
              lease.token.length > 0 &&
              millis(lease.expiresAt) > this.now(),
          );
          return {
            ...part,
            status:
              !grading &&
              this.now() >=
                millis(
                  record.kind === "promotion"
                    ? part.deadlineAt
                    : record.deadlineAt,
                )
                ? "failed"
                : "in-progress",
          };
        }
        const feedback = attempt.feedback;
        if (part.skill === "writing" || part.skill === "speaking") {
          const requiredTasks = writingContent
            .find((content) => content._id === part.contentId)
            ?.sections.filter(
              (section) => section.task === 1 || section.task === 2,
            );
          const fullWritingEvidence =
            part.skill !== "writing" ||
            record.kind !== "promotion" ||
            Boolean(
              requiredTasks?.length &&
                requiredTasks.every((section) => {
                  const essay =
                    attempt.essays[section.id] ??
                    attempt.essays[`task${section.task}`] ??
                    attempt.essays[String(section.task)] ??
                    "";
                  return (
                    (essay.match(/\S+/gu)?.length ?? 0) >=
                    (section.task === 1 ? 150 : 250)
                  );
                }),
            );
          const evidence =
            part.skill === "writing"
              ? fullWritingEvidence &&
                Object.values(attempt.essays).some((text) => text.trim())
              : Boolean(attempt.transcript.trim()) ||
                audioEvidence.has(attempt.id);
          if (!evidence)
            return {
              ...part,
              status: "failed",
              estimatedBand: null,
              scorePercent: null,
            };
          if (
            feedback.source !== "ai" ||
            feedback.estimatedBand === null ||
            !Number.isFinite(feedback.estimatedBand) ||
            (part.skill === "writing" &&
              record.kind === "promotion" &&
              !requiredTasks?.every((section) =>
                feedback.taskScores?.some(
                  (score) =>
                    score.task === section.task &&
                    score.estimatedBand !== null &&
                    Number.isFinite(score.estimatedBand),
                ),
              ))
          )
            return {
              ...part,
              status: "pending-ai",
              estimatedBand: null,
              scorePercent: null,
            };
          return {
            ...part,
            estimatedBand: feedback.estimatedBand,
            scorePercent: Math.min(
              100,
              (feedback.estimatedBand / record.requiredBand) * 100,
            ),
            status:
              feedback.estimatedBand >= record.requiredBand
                ? "passed"
                : "failed",
          };
        }
        if (
          feedback.total === null ||
          feedback.rawScore === null ||
          feedback.total <= 0 ||
          !Number.isFinite(feedback.rawScore) ||
          !Number.isFinite(feedback.total)
        )
          return {
            ...part,
            status: "failed",
            scorePercent: null,
            estimatedBand: null,
          };
        const percent = (feedback.rawScore / feedback.total) * 100;
        const pass =
          record.kind === "promotion"
            ? feedback.estimatedBand !== null &&
              Number.isFinite(feedback.estimatedBand) &&
              feedback.estimatedBand >= record.requiredBand
            : percent >= record.passPercent;
        return {
          ...part,
          status: pass ? "passed" : "failed",
          scorePercent: percent,
          estimatedBand: feedback.estimatedBand,
        };
      });
      const status: DuoResultStatus = parts.some(
        (part) => part.status === "in-progress",
      )
        ? "in-progress"
        : parts.some((part) => part.status === "pending-ai")
          ? "pending-ai"
          : parts.every((part) => part.status === "passed")
            ? "passed"
            : "failed";
      const active = status === "in-progress" || status === "pending-ai";
      if (
        JSON.stringify(parts) === JSON.stringify(record.parts) &&
        status === record.status &&
        active === record.active
      ) {
        await this.applyResult(record);
        return record;
      }
      const updated = await this.assessments.findOneAndUpdate(
        { _id: record._id, revision: record.revision, invalidatedAt: { $exists: false } },
        {
          $set: {
            parts,
            status,
            active,
            completedAt: active ? null : this.iso(),
          },
          $inc: { revision: 1 },
        },
        { returnDocument: "after" },
      );
      if (updated) {
        await this.applyResult(updated);
        return updated;
      }
    }
    throw new ApiError(409, "Kết quả đang được chấm. Vui lòng tải lại.");
  }
  private async applyResult(assessment: AssessmentRecord): Promise<void> {
    if (assessment.invalidatedAt) return;
    let advanced = false;
    await this.changePath(assessment.duoId, (path) => {
      advanced = false;
      if (
        path.members[assessment.role] !== assessment.userId ||
        path.currentBand !== assessment.band || this.deniedAssessment(path, assessment)
      )
        return false;
      const band = path.bands[bandKey(assessment.band)];
      const result: ResultRecord = {
        status: assessment.status,
        assessmentId: assessment._id,
        at: assessment.completedAt ?? assessment.createdAt,
      };
      if (assessment.kind === "gate") {
        const gate = band.gates.find((entry) => entry.id === assessment.gateId);
        if (
          !gate ||
          !this.gateEligible(band, gate) ||
          gate.results[assessment.role]?.status === "passed"
        )
          return false;
        if (
          gate.results[assessment.role]?.assessmentId &&
          gate.results[assessment.role]!.assessmentId !== assessment._id
        )
          return false;
        if (
          JSON.stringify(gate.results[assessment.role]) ===
          JSON.stringify(result)
        )
          return false;
        gate.results[assessment.role] = result;
        return;
      }
      if (!this.promotionEligible(band) || band.completedAt) return false;
      if (band.promotionResults[assessment.role]?.status === "passed")
        return false;
      if (band.lastPromotionRoomId !== assessment.roomId) return false;
      if (
        JSON.stringify(band.promotionResults[assessment.role]) ===
        JSON.stringify(result)
      )
        return false;
      band.promotionResults[assessment.role] = result;
      if (
        ROLES.every((role) => band.promotionResults[role]?.status === "passed")
      ) {
        band.completedAt = this.iso();
        if (path.currentBand < path.targetBand) {
          path.currentBand = Math.min(path.targetBand, path.currentBand + 0.5);
          path.bands[bandKey(path.currentBand)].unlockedAt = this.iso();
        }
        advanced = true;
      }
    });
    if (assessment.kind === "promotion") {
      const room = await this.rooms.findOne({ _id: assessment.roomId! });
      if (!room) return;
      const participants = await this.assessments
        .find({ roomId: room._id })
        .toArray();
      const requiredParticipants = ROLES.filter(
        (role) => !room.members[role].companion,
      ).length;
      if (
        advanced ||
        (participants.length === requiredParticipants &&
          participants.every((entry) => !entry.active))
      )
        await this.rooms.updateOne(
          { _id: room._id, status: "in-progress" },
          {
            $set: { status: "completed", active: false },
            $inc: { revision: 1 },
          },
        );
    }
  }

  private present(presence: RoomPresence) {
    return Boolean(
      presence.joinedAt &&
        presence.lastSeenAt &&
        this.now() - millis(presence.lastSeenAt) <=
          this.config.presenceTimeoutSeconds * 1000,
    );
  }
  private async roomFinalSubmissionsAccepted(room: RoomRecord): Promise<boolean> {
    const records = await this.assessments.find({ roomId: room._id, duoId: room.duoId }).toArray();
    const participants = ROLES.filter(role => !room.members[role].companion);
    const attempts = await this.database.attempts.find({ duoAssessmentId: { $in: records.map(record => record._id) } }).toArray();
    for (const role of participants) {
      const record = records.find(assessment => assessment.role === role && assessment.userId === room.members[role].userId);
      if (!record || record.invalidatedAt || !record.parts.length) return false;
      for (const [index, part] of record.parts.entries()) {
        const attempt = attempts.find(row => row._id === part.attemptId && row.userId === record.userId &&
          row.duoAssessmentId === record._id && row.contentId === part.contentId);
        if (!attempt) return false;
        if (attempt.status === "submitted") continue;
        const lease = (attempt as AttemptRecord & { submissionLease?: { token?: string; expiresAt?: string } }).submissionLease;
        if (index !== record.parts.length - 1 || attempt.status !== "in-progress" || !lease?.token || millis(lease.expiresAt) <= this.now())
          return false;
        if (room.requiresPresence) {
          const guard = await this.database.db.collection<{
            _id: string; userId: string; kind: string; resourceId: string; status: string; phase: string; leaseUntil: number; createdAt: string;
          }>("exam_integrity_sessions").findOne({ userId: record.userId, kind: "assessment", resourceId: record._id }, { sort: { createdAt: -1 } });
          if (guard && (guard.status !== "active" || guard.phase !== "grading" || guard.leaseUntil <= this.now())) return false;
        }
      }
    }
    return true;
  }
  /** Also covers companions and a member who finished before their partner. */
  async observeRoomDocument(user: UserRecord, tabId: string): Promise<DuoIntegrityInvalidation | null> {
    const candidate = user as DuoUser;
    if (!candidate.duoId || !candidate.duoRole || !this.strictRoomMonitoring) return null;
    requireExamTab(tabId);
    const { user: member } = await this.member(user);
    const initial = await this.rooms.findOne({ duoId: member.duoId, active: true, requiresPresence: true });
    if (!initial || initial.members[member.duoRole].userId !== member.id) return null;
    const room = await this.reconcileRoom(initial);
    if (room.status === "invalidated") return this.invalidateRoomIntegrity(member, room, room.integrityReason ?? "heartbeat-lost");
    const documentId = room.members[member.duoRole].documentId;
    if (documentId && documentId !== tabId) {
      if (room.status === "in-progress" && !(await this.roomFinalSubmissionsAccepted(room)))
        return this.invalidateRoomIntegrity(member, room, "duplicate-tab");
      if (room.status === "waiting" || room.status === "countdown")
        await this.changeRoom(room._id, latest => {
          latest.members[member.duoRole].readyAt = null;
          if (latest.status === "countdown") { latest.status = "waiting"; latest.startsAt = null; latest.deadlineAt = null; }
        });
    }
    return null;
  }
  private ready(presence: RoomPresence) {
    return (
      this.present(presence) &&
      Boolean(
        presence.readyAt &&
          this.now() - millis(presence.readyAt) <=
            this.config.readyTimeoutSeconds * 1000,
      )
    );
  }
  private async roomView(room: RoomRecord, user?: UserRecord): Promise<DuoRoomView> {
    const role = (user as DuoUser | undefined)?.duoRole;
    return {
      id: room._id,
      band: room.band,
      status: room.status,
      members: {
        husband: {
          joined: Boolean(room.members.husband.joinedAt),
          present: this.present(room.members.husband),
          ready: this.ready(room.members.husband),
          companion: room.members.husband.companion,
          lastSeenAt: room.members.husband.lastSeenAt,
          assessmentId: room.members.husband.assessmentId,
        },
        wife: {
          joined: Boolean(room.members.wife.joinedAt),
          present: this.present(room.members.wife),
          ready: this.ready(room.members.wife),
          companion: room.members.wife.companion,
          lastSeenAt: room.members.wife.lastSeenAt,
          assessmentId: room.members.wife.assessmentId,
        },
      },
      serverNow: this.iso(),
      startsAt: room.startsAt,
      deadlineAt: room.deadlineAt,
      countdownSeconds: this.config.countdownSeconds,
      presenceTimeoutSeconds: room.requiresPresence ? EXAM_LEASE_SECONDS : this.config.presenceTimeoutSeconds,
      requiresPresence: Boolean(room.requiresPresence && (
        (room.status === "in-progress" && !(await this.roomFinalSubmissionsAccepted(room))) ||
        (["waiting", "countdown"].includes(room.status) && (role ? room.members[role].readyAt : ROLES.some(memberRole => room.members[memberRole].readyAt)))
      )),
      ...(room.invalidatedAt ? {
        invalidatedAt: room.invalidatedAt, integrityReason: room.integrityReason,
        integrity: { status: "invalidated" as const, reason: room.integrityReason },
      } : {}),
    };
  }
  private async room(user: UserRecord, roomId: string): Promise<RoomRecord> {
    const { user: member } = await this.member(user);
    const room = await this.rooms.findOne({ _id: roomId, duoId: member.duoId });
    if (!room || room.members[member.duoRole].userId !== member.id)
      throw new ApiError(404, "Không tìm thấy phòng thi của hai bạn.");
    return room;
  }
  private async changeRoom(
    roomId: string,
    change: (room: RoomRecord) => void | boolean,
  ): Promise<RoomRecord> {
    for (let retry = 0; retry < 30; retry++) {
      const room = await this.rooms.findOne({ _id: roomId });
      if (!room) throw new ApiError(404, "Không tìm thấy phòng thi.");
      const modified = structuredClone(room);
      if (change(modified) === false) return room;
      modified.revision++;
      const result = await this.rooms.replaceOne(
        { _id: roomId, revision: room.revision },
        modified,
      );
      if (result.modifiedCount) return modified;
    }
    throw new ApiError(409, "Phòng thi đang thay đổi. Vui lòng tải lại.");
  }
  private async reconcileRoom(initial: RoomRecord): Promise<RoomRecord> {
    initial = (await this.rooms.findOne({ _id: initial._id })) ?? initial;
    const path = await this.paths.findOne({ _id: initial.duoId });
    if (path?.invalidatedRoomIds?.includes(initial._id)) {
      const records = await this.assessments.find({ roomId: initial._id, duoId: initial.duoId }).toArray();
      const assessmentIds = [...new Set([
        ...records.map(record => record._id),
        ...ROLES.filter(role => !initial.members[role].companion).map(role => `${initial._id}:${role}`),
      ])];
      await this.cancelRoom(initial, assessmentIds, this.invalidationReason(path, null, initial._id));
      return (await this.rooms.findOne({ _id: initial._id }))!;
    }
    if (initial.status === "completed" || initial.status === "cancelled" || initial.status === "invalidated")
      return initial;
    if (
      !path ||
      path.currentBand !== initial.band ||
      path.bands[bandKey(initial.band)].completedAt
    )
      return this.changeRoom(initial._id, (room) => {
        room.status = "completed";
        room.active = false;
      });
    if (initial.status === "in-progress") {
      if (initial.requiresPresence && !(await this.roomFinalSubmissionsAccepted(initial)) && ROLES.some(role =>
        !initial.members[role].lastSeenAt || this.now() - millis(initial.members[role].lastSeenAt) >= EXAM_LEASE_SECONDS * 1000,
      )) {
        const owner = await this.database.users.findOne({ _id: initial.members.husband.userId });
        if (owner) {
          const { user: member } = await this.member(owner);
          await this.invalidateRoomIntegrity(member, initial, "heartbeat-lost");
          return (await this.rooms.findOne({ _id: initial._id }))!;
        }
      }
      if (this.now() >= millis(initial.deadlineAt)) {
        const assessments = await this.assessments
          .find({ roomId: initial._id })
          .toArray();
        for (const assessment of assessments)
          await this.reconcileAssessment(assessment);
        return (await this.rooms.findOne({ _id: initial._id }))!;
      }
      return this.ensureRoomAssessments(initial, path);
    }
    const reconciled = await this.changeRoom(initial._id, (room) => {
      if (room.status !== "waiting" && room.status !== "countdown")
        return false;
      let changed = false;
      for (const role of ROLES)
        if (room.members[role].readyAt && !this.ready(room.members[role])) {
          room.members[role].readyAt = null;
          changed = true;
        }
      const bothReady = ROLES.every((role) => this.ready(room.members[role]));
      if (room.status === "countdown") {
        if (
          !bothReady ||
          this.now() >
            millis(room.startsAt) + this.config.startGraceSeconds * 1000
        ) {
          room.status = "waiting";
          room.startsAt = null;
          if (
            !bothReady ||
            this.now() >
              millis(initial.startsAt) + this.config.startGraceSeconds * 1000
          )
            for (const role of ROLES) room.members[role].readyAt = null;
          return;
        }
        if (this.now() >= millis(room.startsAt)) {
          room.status = "in-progress";
          return;
        }
      }
      return changed;
    });
    if (reconciled.status === "in-progress") return this.reconcileRoom(reconciled);
    return reconciled;
  }
  private async ensureRoomAssessments(
    room: RoomRecord,
    path: PathRecord,
  ): Promise<RoomRecord> {
    const currentPath = await this.paths.findOne({ _id: path.duoId });
    const currentRoom = await this.rooms.findOne({ _id: room._id });
    if (!currentPath || !currentRoom || currentRoom.status !== "in-progress" ||
      currentPath.invalidatedRoomIds?.includes(room._id))
      return currentRoom ?? room;
    const members = (await this.database.users
      .find({ _id: { $in: Object.values(path.members) } })
      .toArray()) as DuoUser[];
    const ids: Partial<Record<DuoRole, string>> = {};
    for (const role of ROLES)
      if (!room.members[role].companion) {
        const member = members.find((user) => user.id === path.members[role]);
        if (!member)
          throw new ApiError(409, "Thành viên Duo không còn hợp lệ.");
        const assessment = await this.makeAssessment(
          path,
          member,
          "promotion",
          room.contentIds ?? path.bands[bandKey(room.band)].promotionContentIds,
          null,
          room,
        );
        ids[role] = assessment._id;
      }
    return this.changeRoom(room._id, (latest) => {
      if (latest.status !== "in-progress") return false;
      let changed = false;
      for (const role of ROLES)
        if (ids[role] && latest.members[role].assessmentId !== ids[role]) {
          latest.members[role].assessmentId = ids[role]!;
          changed = true;
        }
      return changed;
    });
  }
  private async createRoom(user: UserRecord): Promise<RoomRecord> {
    const { user: member, members } = await this.member(user);
    const path = await this.path(user);
    const band = path.bands[bandKey(path.currentBand)];
    if (!this.promotionEligible(band) || band.completedAt)
      throw new ApiError(
        403,
        "Cả hai cần hoàn thành mọi buổi học và pass tất cả Duo Gate.",
      );
    const existing = await this.rooms.findOne({
      duoId: path.duoId,
      band: path.currentBand,
      active: true,
    });
    if (existing) return this.reconcileRoom(existing);
    const contents = await this.database.content.find({ _id: { $in: band.promotionContentIds } }).toArray();
    await this.config.ensureAudioReady(contents);
    const presence = (role: DuoRole): RoomPresence => ({
      userId: members[role].id,
      joinedAt: null,
      lastSeenAt: null,
      readyAt: null,
      companion:
        !path.strictRetakeMode &&
        band.promotionResults[role]?.status === "passed",
      assessmentId: null,
    });
    const invalidated = await this.rooms.find({
      duoId: path.duoId, band: path.currentBand, invalidatedAt: { $exists: true },
    }).toArray();
    const previousAssessments = invalidated.length
      ? await this.assessments.find({ roomId: { $in: invalidated.map(entry => entry._id) } }).toArray()
      : [];
    const contentIds = invalidated.length
      ? await this.replacementSet(band.promotionContentIds, [
        ...invalidated.flatMap(entry => entry.contentIds ?? []),
        ...previousAssessments.flatMap(entry => entry.parts.map(part => part.contentId)),
      ]) : band.promotionContentIds;
    const room: RoomRecord = {
      _id: randomUUID(),
      duoId: member.duoId,
      band: path.currentBand,
      status: "waiting",
      active: true,
      members: { husband: presence("husband"), wife: presence("wife") },
      startsAt: null,
      deadlineAt: null,
      createdAt: this.iso(),
      revision: 0,
      contentIds,
      requiresPresence: this.strictRoomMonitoring,
    };
    try {
      await this.rooms.insertOne(room);
    } catch (error) {
      if (!isDuplicate(error)) throw error;
      const concurrent = await this.rooms.findOne({
        duoId: path.duoId,
        band: path.currentBand,
        active: true,
      });
      if (!concurrent) throw error;
      return this.reconcileRoom(concurrent);
    }
    await this.changePath(path.duoId, (latest) => {
      if (latest.currentBand !== room.band) return false;
      latest.bands[bandKey(room.band)].lastPromotionRoomId = room._id;
      if (latest.strictRetakeMode)
        latest.bands[bandKey(room.band)].promotionResults = pair(null);
    });
    return room;
  }
  private async touchRoom(
    user: UserRecord,
    roomId: string,
    action: "join" | "heartbeat" | "ready" | "leave",
    input: { ready?: boolean; companion?: boolean; documentId?: string; reason?: string } = {},
  ): Promise<RoomRecord> {
    const { user: member } = await this.member(user);
    const room = await this.reconcileRoom(await this.room(user, roomId));
    if (room.status === "completed" || room.status === "cancelled" || room.status === "invalidated")
      throw new ApiError(409, "Phòng thi đã đóng.");
    if (action === "leave" && room.status === "in-progress") {
      await this.invalidateRoomIntegrity(member, room, input.reason ?? "left-exam");
      return (await this.rooms.findOne({ _id: room._id }))!;
    }
    const path = await this.path(user);
    const band = path.bands[bandKey(room.band)];
    if (path.currentBand !== room.band || !this.promotionEligible(band))
      throw new ApiError(403, "Kỳ thi nâng band chưa mở.");
    const contents = await this.database.content
      .find({ _id: { $in: room.contentIds ?? band.promotionContentIds } })
      .toArray();
    const duration = contents.reduce(
      (sum, content) => sum + content.durationMinutes,
      0,
    );
    if (action === "ready" && input.ready) await this.config.ensureAudioReady(contents);
    const updated = await this.changeRoom(room._id, (latest) => {
      const presence = latest.members[member.duoRole];
      if (latest.status === "completed" || latest.status === "cancelled" || latest.status === "invalidated")
        throw new ApiError(409, "Phòng thi đã đóng.");
      if (action === "leave") {
        presence.lastSeenAt = null;
        presence.readyAt = null;
        if (latest.status === "countdown") {
          latest.status = "waiting";
          latest.startsAt = null;
          latest.deadlineAt = null;
        }
        return;
      }
      if (action !== "join" && !presence.joinedAt)
        throw new ApiError(403, "Bạn cần tham gia phòng thi trước.");
      if (action === "join") {
        presence.joinedAt ??= this.iso();
        if (!this.present(presence)) presence.readyAt = null;
      }
      presence.lastSeenAt = this.iso();
      if (action === "ready") {
        if (latest.status === "in-progress")
          throw new ApiError(409, "Kỳ thi đã bắt đầu.");
        if (input.companion !== undefined) {
          if (
            input.companion &&
            (path.strictRetakeMode ||
              band.promotionResults[member.duoRole]?.status !== "passed")
          )
            throw new ApiError(
              403,
              "Companion chỉ dành cho người đã pass và được bảo lưu.",
            );
          presence.companion = input.companion;
        }
        presence.readyAt = input.ready ? this.iso() : null;
        if (input.ready && input.documentId) {
          latest.requiresPresence = true;
          presence.documentId = input.documentId;
        }
      }
      if (
        latest.status === "countdown" &&
        !ROLES.every((role) => this.ready(latest.members[role]))
      ) {
        latest.status = "waiting";
        latest.startsAt = null;
        latest.deadlineAt = null;
      }
      if (
        latest.status === "waiting" &&
        ROLES.every((role) => this.ready(latest.members[role]))
      ) {
        latest.status = "countdown";
        latest.startsAt = new Date(
          this.now() + this.config.countdownSeconds * 1000,
        ).toISOString();
        latest.deadlineAt = new Date(
          millis(latest.startsAt) + Math.max(1, duration) * 60_000,
        ).toISOString();
      }
    });
    return updated;
  }
  private async startRoom(
    user: UserRecord,
    roomId: string,
    documentId?: string,
  ): Promise<{
    room: RoomRecord;
    assessment: AssessmentRecord | null;
    companion: boolean;
  }> {
    const { user: member } = await this.member(user);
    let room = await this.reconcileRoom(await this.room(user, roomId));
    if (room.status === "completed" || room.status === "cancelled" || room.status === "invalidated")
      throw new ApiError(409, "Phòng thi đã đóng.");
    if (documentId) {
      const existingDocument = room.members[member.duoRole].documentId;
      if (existingDocument && existingDocument !== documentId && !(await this.roomFinalSubmissionsAccepted(room))) {
        await this.invalidateRoomIntegrity(member, room, "duplicate-tab");
        throw new ApiError(409, "Đã phát hiện cửa sổ khác; phòng thi đã bị hủy.");
      }
      room = await this.changeRoom(room._id, latest => {
        if (latest.status !== "in-progress") throw new ApiError(409, "Phòng thi đã đóng.");
        latest.requiresPresence = true;
        latest.members[member.duoRole].documentId ??= documentId;
        latest.members[member.duoRole].lastSeenAt = this.iso();
      });
    }
    const path = await this.path(user);
    if (
      room.status !== "in-progress" ||
      this.now() >= millis(room.deadlineAt) ||
      path.currentBand !== room.band ||
      !this.promotionEligible(path.bands[bandKey(room.band)])
    )
      throw new ApiError(
        403,
        "Cả hai cần cùng tham gia, Ready và đợi hết đếm ngược của server.",
      );
    if (!room.members[member.duoRole].joinedAt)
      throw new ApiError(403, "Bạn chưa tham gia phiên thi chung.");
    if (room.members[member.duoRole].companion)
      return { room, assessment: null, companion: true };
    const assessment = await this.makeAssessment(
      path,
      member,
      "promotion",
      room.contentIds ?? path.bands[bandKey(room.band)].promotionContentIds,
      null,
      room,
    );
    const updated = await this.changeRoom(room._id, (latest) => {
      if (latest.status !== "in-progress")
        throw new ApiError(409, "Phòng thi đã đóng.");
      if (latest.members[member.duoRole].assessmentId === assessment._id)
        return false;
      latest.members[member.duoRole].assessmentId = assessment._id;
    });
    return { room: updated, assessment, companion: false };
  }
  private bandView(record: BandRecord): DuoBandView {
    const lessons: DuoLessonView[] = record.lessons.map((lesson) => ({
      id: lesson.id,
      number: lesson.number,
      title: lesson.title,
      kind: lesson.kind,
      contentId: lesson.contentId,
      vocabularyIds: lesson.vocabularyIds,
      unlocked: this.lessonUnlocked(record, lesson.number),
      completed: {
        husband: Boolean(lesson.completion.husband),
        wife: Boolean(lesson.completion.wife),
      },
      completedAt: {
        husband: lesson.completion.husband?.at ?? null,
        wife: lesson.completion.wife?.at ?? null,
      },
    }));
    const gates: DuoGateView[] = record.gates.map((gate) => ({
      id: gate.id,
      number: gate.number,
      afterLesson: gate.afterLesson,
      fromLesson: gate.fromLesson,
      contentIds: gate.contentIds,
      eligible: this.gateEligible(record, gate),
      unlocked: ROLES.every((role) => gate.results[role]?.status === "passed"),
      results: {
        husband: gate.results.husband?.status ?? null,
        wife: gate.results.wife?.status ?? null,
      },
      assessmentIds: {
        husband: gate.results.husband?.assessmentId ?? null,
        wife: gate.results.wife?.assessmentId ?? null,
      },
    }));
    return {
      band: record.band,
      unlocked: Boolean(record.unlockedAt),
      completed: Boolean(record.completedAt),
      lessons,
      gates,
      promotionEligible: this.promotionEligible(record),
      promotionResults: {
        husband: record.promotionResults.husband?.status ?? null,
        wife: record.promotionResults.wife?.status ?? null,
      },
    };
  }
  private status(
    path: PathRecord,
    role: DuoRole,
    room: RoomRecord | null,
  ): DuoStatus {
    const band = path.bands[bandKey(path.currentBand)];
    if (band.completedAt && path.currentBand >= path.targetBand)
      return "BAND_COMPLETED";
    if (room?.status === "in-progress" || room?.status === "countdown")
      return "BAND_EXAM_IN_PROGRESS";
    if (
      ROLES.some((member) => band.promotionResults[member]?.status === "passed")
    )
      return "WAITING_FOR_BAND_PASS";
    if (this.promotionEligible(band)) return "BAND_EXAM_AVAILABLE";
    for (const gate of band.gates)
      if (!ROLES.every((member) => gate.results[member]?.status === "passed")) {
        if (gate.results[role]?.status === "passed")
          return "WAITING_FOR_PARTNER";
        if (this.gateEligible(band, gate)) return "GATE_LOCKED";
        if (
          band.lessons
            .filter((lesson) => lesson.number <= gate.afterLesson)
            .every((lesson) => Boolean(lesson.completion[role]))
        )
          return "WAITING_FOR_PARTNER";
        break;
      }
    return "IN_PROGRESS";
  }
  async snapshot(user: UserRecord): Promise<DuoSnapshot> {
    await this.syncPlacements(user);
    const { user: member, members } = await this.member(user);
    let path = await this.paths.findOne({ _id: member.duoId });
    const assessments = await this.assessments
      .find({ duoId: member.duoId, userId: member.id })
      .sort({ createdAt: -1, _id: 1 })
      .limit(100)
      .toArray();
    const reconciled: AssessmentRecord[] = [];
    for (const assessment of assessments)
      reconciled.push(await this.reconcileAssessment(assessment));
    path = await this.paths.findOne({ _id: member.duoId });
    let room = path
      ? await this.rooms.findOne(
          { duoId: member.duoId, band: path.currentBand },
          { sort: { createdAt: -1, _id: 1 } },
        )
      : null;
    if (room) room = await this.reconcileRoom(room);
    const currentPath = await this.paths.findOne({ _id: member.duoId });
    if (currentPath && path && currentPath.currentBand !== path.currentBand) {
      room = await this.rooms.findOne(
        { duoId: member.duoId, band: currentPath.currentBand },
        { sort: { createdAt: -1, _id: 1 } },
      );
      if (room) room = await this.reconcileRoom(room);
    }
    path = currentPath;
    const memberViews = await Promise.all(
      ROLES.map(async (role) => {
        const placement = await this.placements.findOne(
          { duoId: member.duoId, userId: members[role].id },
          { sort: { startedAt: -1, assessedAt: -1, _id: 1 } },
        );
        return {
          id: members[role].id,
          name: members[role].name,
          role,
          placementBand: placement?.estimatedBand ?? null,
          personalEstimatedBand:
            members[role].personalEstimatedBand ??
            members[role].currentBand ??
            placement?.estimatedBand ??
            null,
        };
      }),
    );
    return {
      role: member.duoRole,
      duoId: member.duoId,
      status: path ? this.status(path, member.duoRole, room) : "NOT_STARTED",
      path: path
        ? {
            id: path._id,
            startingBand: path.startingBand,
            currentBand: path.currentBand,
            targetBand: path.targetBand,
            gateInterval: path.gateInterval,
            sessionsPerBand: path.sessionsPerBand,
            passPercent: path.passPercent,
            strictRetakeMode: path.strictRetakeMode,
            startedAt: path.startedAt,
          }
        : null,
      members: memberViews,
      bands: path
        ? Object.values(path.bands)
            .sort((a, b) => a.band - b.band)
            .map((band) => this.bandView(band))
        : [],
      room: room ? await this.roomView(room, user) : null,
      assessments: reconciled.map((record) => this.assessmentView(record)),
    };
  }
  registerRoutes(app: Express, hooks?: DuoRouteHooks): void {
    this.strictRoomMonitoring = Boolean(hooks);
    app.get(
      "/api/duo",
      asyncRoute(async (request, response) => {
        response.json({ duo: await this.snapshot(learnerOf(request)) });
      }),
    );
    app.get(
      "/api/duo/history",
      asyncRoute(async (request, response) => {
        const { user } = await this.member(learnerOf(request));
        const query = z
          .object({
            page: z.coerce.number().int().min(1).max(10000).default(1),
            pageSize: z.coerce.number().int().min(1).max(100).default(30),
          })
          .parse(request.query);
        const filter = { duoId: user.duoId, userId: user.id };
        const [records, total] = await Promise.all([
          this.assessments
            .find(filter)
            .sort({ createdAt: -1, _id: 1 })
            .skip((query.page - 1) * query.pageSize)
            .limit(query.pageSize)
            .toArray(),
          this.assessments.countDocuments(filter),
        ]);
        response.json({
          assessments: records.map((record) => this.assessmentView(record)),
          total,
          ...query,
          serverNow: this.iso(),
        });
      }),
    );
    app.post(
      "/api/duo/lessons/:id/complete",
      asyncRoute(async (request, response) => {
        const user = learnerOf(request);
        const input = z
          .object({
            attemptId: z.string().max(180).optional(),
            cardIds: z.array(z.string().max(180)).max(100).optional(),
          })
          .strict()
          .parse(request.body);
        await this.completeLesson(user, routeId(request), input);
        response.json({ duo: await this.snapshot(user) });
      }),
    );
    app.post(
      "/api/duo/gates/:id/start",
      asyncRoute(async (request, response) => {
        const user = learnerOf(request);
        hooks?.beforeStart(request);
        const assessment = await this.startGate(user, routeId(request));
        if (hooks) await hooks.opened(user, assessment._id, request);
        response.json({
          assessment: this.assessmentView(assessment),
        });
      }),
    );
    app.get(
      "/api/duo/assessments/:id",
      asyncRoute(async (request, response) => {
        const user = learnerOf(request);
        const assessmentId = routeId(request);
        if (hooks) await hooks.check(user, assessmentId);
        response.json({
          assessment: this.assessmentView(
            await this.reconcileAssessment(
              await this.assessment(user, assessmentId),
            ),
          ),
        });
      }),
    );
    app.post(
      "/api/duo/rooms",
      asyncRoute(async (request, response) => {
        response.status(201).json({
          room: await this.roomView(await this.createRoom(learnerOf(request)), learnerOf(request)),
        });
      }),
    );
    app.get(
      "/api/duo/rooms/:id",
      asyncRoute(async (request, response) => {
        response.json({
          room: await this.roomView(
            await this.reconcileRoom(
              await this.room(learnerOf(request), routeId(request)),
            ),
            learnerOf(request),
          ),
        });
      }),
    );
    for (const action of ["join", "heartbeat", "ready", "leave"] as const)
      app.post(
        `/api/duo/rooms/:id/${action}`,
        asyncRoute(async (request, response) => {
          const input =
            action === "ready"
              ? z
                  .object({
                    ready: z.boolean(),
                    companion: z.boolean().optional(),
                  })
                  .strict()
                  .parse(request.body)
              : action === "leave" ? z.object({
                reason: z.enum(["hidden", "page-exit", "navigation", "duplicate-tab", "heartbeat-lost"]).optional(),
                tabId: z.string().optional(),
              }).strict().parse(request.body ?? {}) : {};
          if (action === "leave" && "tabId" in input && input.tabId) requireExamTab(input.tabId);
          if (hooks && action === "ready" && "ready" in input && input.ready) hooks.beforeStart(request);
          const documentId = hooks && action !== "leave" ? requireExamTab(request.get("X-Exam-Tab")) : undefined;
          if (documentId && action !== "ready") await this.observeRoomDocument(learnerOf(request), documentId);
          response.json({
            room: await this.roomView(
              await this.touchRoom(
                learnerOf(request),
                routeId(request),
                action,
                { ...input, ...(documentId ? { documentId } : {}) },
              ),
              learnerOf(request),
            ),
          });
        }),
      );
    app.post(
      "/api/duo/rooms/:id/start",
      asyncRoute(async (request, response) => {
        const user = learnerOf(request);
        hooks?.beforeStart(request);
        const result = await this.startRoom(
          user,
          routeId(request),
          hooks ? requireExamTab(request.get("X-Exam-Tab")) : undefined,
        );
        if (hooks && result.assessment) await hooks.opened(user, result.assessment._id, request);
        response.json({
          room: await this.roomView(result.room, user),
          assessment: result.assessment
            ? this.assessmentView(result.assessment)
            : null,
          companion: result.companion,
        });
      }),
    );
  }
}
export function createDuoService(
  database: Database,
  config: DuoConfig = {},
): DuoService {
  return new DuoService(database, config);
}
