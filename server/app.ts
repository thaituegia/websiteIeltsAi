import { bankVersion } from "./data/index";
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import multer from "multer";
import { MongoServerError } from "mongodb";
import { z, ZodError } from "zod";
import { resolve } from "node:path";
import { once } from "node:events";
import { pipeline } from "node:stream/promises";
import { ApiError } from "./errors";
import { loadDuoCredentials, loginDuo, type DuoCredentialSettings } from "./duo-auth";
import { createDuoService } from "./duo";
import {
  services,
  evaluateWriting,
  evaluateSpeaking,
  listeningAudio,
  generateContent,
} from "./ai";
import {
  attachLearner,
  COOKIE_NAME,
  createSession,
  deleteSession,
  hashPassword,
  initialProfile,
  learnerOf,
  requireLearner,
  verifyPassword,
} from "./auth";
import {
  ensureDemo,
  newId,
  profileOf,
  type Database,
  type AttemptRecord,
  type CardRecord,
  type PlacementRecord,
  type PlanRecord,
} from "./storage";
import {
  buildDashboard,
  buildErrorNotebook,
  cefrForBand,
  estimatePlacement,
  generatePlan,
  gradeObjective,
  newScheduler,
  objectiveAnswerContext,
  placementAnswerReview,
  placementFeedback,
  scheduleReview,
  selectPlacementQuestion,
  vocabularyMetrics,
} from "./learning";
import type {
  Attempt,
  AttemptSummary,
  ContentItem,
  ContentKind,
  Feedback,
  PlacementState,
  StoredContent,
  StudyPlan,
  VocabularyCard,
} from "../shared/types";

export interface AppConfig {
  production?: boolean;
  demoEnabled?: boolean;
  maxLearners?: number;
  origin?: string;
  serveClient?: boolean;
  trustProxy?: boolean | number | string;
  duoEnabled?: boolean;
  duoCredentials?: DuoCredentialSettings;
  duo?: Parameters<typeof createDuoService>[1];
}
const skills = [
  "reading",
  "listening",
  "writing",
  "speaking",
  "grammar",
] as const;
const band = z
  .number()
  .min(3)
  .max(8)
  .refine((value) => Number.isInteger(value * 2), "Band phải là bội số 0,5.");
const examDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) =>
      !Number.isNaN(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value,
    "Ngày thi không hợp lệ.",
  )
  .nullable()
  .optional();
const profileSchema = z.object({
  name: z.string().trim().min(2).max(80),
  targetBand: band,
  testType: z.enum(["academic", "general"]),
  examDate,
  weeklyMinutes: z.number().int().min(30).max(3000).optional(),
  dailyMinutes: z.number().int().min(10).max(180).optional(),
  selfAssessment: z
    .object({
      reading: band.nullable(),
      listening: band.nullable(),
      writing: band.nullable(),
      speaking: band.nullable(),
    })
    .optional(),
});
const registerSchema = profileSchema.extend({
  email: z
    .email()
    .max(200)
    .transform((value) => value.toLowerCase()),
  password: z.string().min(10).max(128),
});
const patchSchema = z.object({
  responses: z.record(z.string().max(100), z.string().max(500)).optional(),
  essays: z.record(z.string().max(100), z.string().max(30000)).optional(),
  transcript: z.string().max(40000).optional(),
  durationSeconds: z.number().int().min(0).max(86400).optional(),
});
const asyncRoute =
  (fn: (request: Request, response: Response) => Promise<void>) =>
  (request: Request, response: Response, next: NextFunction) => {
    void fn(request, response).catch(next);
  };
const idOf = (request: Request): string => {
  const id = request.params.id;
  if (typeof id !== "string" || !/^[\w:.-]{1,180}$/.test(id))
    throw new ApiError(400, "Mã bản ghi không hợp lệ.");
  return id;
};
const optionalQuery = (value: unknown): string | undefined =>
  typeof value === "string" ? value.slice(0, 160) : undefined;
const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function sanitizeContent(
  content: StoredContent,
  hideListening = false,
): ContentItem {
  const { questions, referenceAnswers: _referenceAnswers, ...base } = content;
  const clean = { ...base } as StoredContent & { _id?: string };
  delete clean._id;
  if (_referenceAnswers?.length)
    clean.description = clean.description.replace(
      "No model answer is supplied.",
      "Reference responses become available after submission.",
    );
  return {
    ...clean,
    questions: questions.map(
      ({
        answer: _answer,
        acceptedAnswers: _accepted,
        explanation: _explanation,
        evidence: _evidence,
        ...question
      }) => question,
    ),
    sections: content.sections.map((section) =>
      hideListening && content.skill === "listening"
        ? { ...section, text: "", dialogue: undefined }
        : section,
    ),
  };
}
export function summaryOf(attempt: AttemptRecord): AttemptSummary {
  const feedback = attempt.status === "submitted" ? attempt.feedback : null;
  return {
    id: attempt.id,
    contentId: attempt.contentId,
    title: attempt.title,
    skill: attempt.skill,
    mode: attempt.mode,
    status: attempt.status,
    startedAt: attempt.startedAt,
    submittedAt: attempt.submittedAt,
    durationSeconds: attempt.durationSeconds,
    estimatedBand: feedback?.estimatedBand ?? null,
    rawScore: feedback?.rawScore ?? null,
    total: feedback?.total ?? null,
    feedbackSource: feedback?.source ?? null,
  };
}
function cardOf(card: CardRecord): VocabularyCard {
  const {
    _id: _id,
    userId: _userId,
    scheduler: _scheduler,
    reviewLog: _logs,
    ...view
  } = card;
  return { ...view, ...vocabularyMetrics(card.scheduler) };
}
function planOf(plan: PlanRecord): StudyPlan {
  const { _id: _id, userId: _userId, ...view } = plan;
  return view;
}

export function createApp(database: Database, config: AppConfig = {}): Express {
  const production = config.production ?? process.env.NODE_ENV === "production";
  const clockNow = config.duo?.now ?? Date.now;
  const duoEnabled = config.duoEnabled ?? (production || process.env.DUO_ENABLED !== "false");
  const duoCredentials = duoEnabled ? config.duoCredentials ?? loadDuoCredentials() : undefined;
  const authOptions = duoCredentials ? { duo: duoCredentials } : {};
  const duoService = duoEnabled ? createDuoService(database, config.duo) : null;
  const demoEnabled = !duoEnabled &&
    (config.demoEnabled ?? (process.env.DEMO_ENABLED !== "false" && !production));
  const maxLearners =
    config.maxLearners ?? Number(process.env.MAX_LEARNERS || 2);
  if (!Number.isInteger(maxLearners) || maxLearners < 1 || maxLearners > 100)
    throw new Error("MAX_LEARNERS must be between 1 and 100.");
  const app = express();
  app.disable("x-powered-by");
  app.set(
    "trust proxy",
    config.trustProxy ?? (process.env.TRUST_PROXY === "true" ? 1 : false),
  );
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          "default-src": ["'self'"],
          "script-src": ["'self'"],
          "style-src": ["'self'", "'unsafe-inline'"],
          "img-src": ["'self'", "data:"],
          "connect-src": ["'self'"],
          "media-src": ["'self'", "blob:"],
          "font-src": ["'self'", "data:"],
          "upgrade-insecure-requests": production ? [] : null,
        },
      },
    }),
  );
  app.use(express.json({ limit: "256kb" }));
  app.use(cookieParser());
  app.use("/api", (request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      const origin = request.get("origin");
      const configuredOrigin = config.origin || process.env.APP_ORIGIN;
      const expected = configuredOrigin
        ? new URL(configuredOrigin).origin
        : `${request.protocol}://${request.get("host")}`;
      if (origin && origin !== expected) {
        next(new ApiError(403, "Nguồn yêu cầu không được phép."));
        return;
      }
    }
    next();
  });
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Quá nhiều yêu cầu đăng nhập. Vui lòng thử lại sau." },
  });
  app.use("/api/auth", attachLearner(database, authOptions));
  app.get(
    "/api/health",
    asyncRoute(async (_request, response) => {
      await database.db.command({ ping: 1 });
      const [lessons, mocks, vocabulary, placement] = await Promise.all([
        database.content.countDocuments({ format: "lesson" }),
        database.content.countDocuments({ format: "full-mock" }),
        database.vocabulary.countDocuments(),
        database.placementItems.countDocuments(),
      ]);
      response.json({
        status: "ok",
        database: "mongodb",
        demoEnabled,
        duoEnabled,
        authMode: duoEnabled ? "phone" : "email",
        services: services(),
        bank: { lessons, mocks, vocabulary, placement, version: bankVersion },
      });
    }),
  );
  app.get("/api/auth/me", (request, response) => {
    const user = (
      request as Request & { learner?: Parameters<typeof profileOf>[0] }
    ).learner;
    response.json({ user: user ? profileOf(user) : null });
  });
  app.post(
    "/api/auth/demo",
    authLimiter,
    asyncRoute(async (request, response) => {
      if (!demoEnabled)
        throw new ApiError(403, "Tài khoản thử nghiệm chưa được bật.");
      const { learner } = z
        .object({ learner: z.union([z.literal(1), z.literal(2)]) })
        .parse(request.body);
      const user = await ensureDemo(database, learner);
      await deleteSession(database, request, response, production);
      await createSession(database, response, user.id, production);
      response.json({ user: profileOf(user) });
    }),
  );
  app.post(
    "/api/auth/register",
    authLimiter,
    asyncRoute(async (request, response) => {
      if (duoEnabled) throw new ApiError(403, "Website chỉ dùng hai tài khoản số điện thoại đã cấu hình.");
      const input = registerSchema.parse(request.body);
      if (await database.users.findOne({ email: input.email }))
        throw new ApiError(409, "Email này đã có tài khoản.");
      const id = newId();
      const passwordHash = await hashPassword(input.password);
      let created = false;
      const profile = initialProfile(input, id);
      for (let slot = 1; slot <= maxLearners; slot++) {
        try {
          await database.users.insertOne({
            ...profile,
            _id: id,
            passwordHash,
            registrationSlot: slot,
          });
          created = true;
          break;
        } catch (error) {
          if (!(error instanceof MongoServerError) || error.code !== 11000)
            throw error;
          if (await database.users.findOne({ email: input.email }))
            throw new ApiError(409, "Email này đã có tài khoản.");
        }
      }
      if (!created)
        throw new ApiError(
          409,
          `Project đã có ${maxLearners} tài khoản học viên. Dùng tài khoản hiện có để đăng nhập.`,
        );
      await deleteSession(database, request, response, production);
      await createSession(database, response, id, production);
      response.status(201).json({ user: profile });
    }),
  );
  app.post(
    "/api/auth/login",
    authLimiter,
    asyncRoute(async (request, response) => {
      if (duoCredentials) {
        const input = z.object({ phone: z.string().min(1).max(24), password: z.string().min(1).max(128) }).strict().parse(request.body);
        const user = await loginDuo(database, duoCredentials, input);
        await deleteSession(database, request, response, production);
        await createSession(database, response, user.id, production, authOptions);
        response.json({ user: profileOf(user) });
        return;
      }
      const { email, password } = z
        .object({
          email: z.email().max(200),
          password: z.string().min(1).max(128),
        })
        .parse(request.body);
      const user = await database.users.findOne({
        email: email.toLowerCase(),
        demo: false,
      });
      if (
        !user?.passwordHash ||
        !(await verifyPassword(password, user.passwordHash))
      )
        throw new ApiError(401, "Email hoặc mật khẩu không đúng.");
      await deleteSession(database, request, response, production);
      await createSession(database, response, user.id, production);
      response.json({ user: profileOf(user) });
    }),
  );
  app.post(
    "/api/auth/logout",
    asyncRoute(async (request, response) => {
      await deleteSession(database, request, response, production);
      response.json({ ok: true });
    }),
  );
  app.use("/api", attachLearner(database, authOptions), requireLearner);
  duoService?.registerRoutes(app);

  async function contentOf(contentId: string): Promise<StoredContent> {
    const content = await database.content.findOne({ _id: contentId });
    if (!content) throw new ApiError(404, "Không tìm thấy bài luyện.");
    const { _id: _id, ...value } = content;
    return value;
  }
  async function deleteOwnedRecording(
    userId: string,
    attemptId: string,
    fileId: import("mongodb").ObjectId,
  ): Promise<void> {
    const owned = await database.db
      .collection("recordings.files")
      .findOne({
        _id: fileId,
        "metadata.userId": userId,
        "metadata.attemptId": attemptId,
      });
    if (owned) await database.recordings.delete(fileId);
  }
  const submissionLocks = new Set<string>();
  type LeasedAttempt = AttemptRecord & { submissionLease?: { token: string; expiresAt: string } };
  const sourceFilter = (record: AttemptRecord) => ({
    _id: record.id, userId: record.userId, status: "in-progress" as const,
    responses: record.responses, essays: record.essays, transcript: record.transcript,
  });
  const freeLeaseFilter = () => ({ $or: [
    { submissionLease: { $exists: false } },
    { "submissionLease.expiresAt": { $lte: new Date(clockNow()).toISOString() } },
  ] });
  async function claimAttemptLease(record: AttemptRecord): Promise<LeasedAttempt> {
    const token = newId();
    const updated = await database.attempts.findOneAndUpdate(
      { ...sourceFilter(record), ...freeLeaseFilter() },
      // Whisper (120s), Azure (810s) and the rubric scorer (90s) can run in
      // sequence. Keep the lease beyond that complete provider budget.
      { $set: { submissionLease: { token, expiresAt: new Date(clockNow() + 20 * 60_000).toISOString() } } },
      { returnDocument: "after" },
    );
    if (!updated) throw new ApiError(409, "Bài đang được lưu/chấm ở phiên khác hoặc bản nháp đã thay đổi. Hãy đợi rồi tải lại.");
    return updated as LeasedAttempt;
  }
  async function renewAttemptLease(record: AttemptRecord, token: string): Promise<void> {
    const updated = await database.attempts.updateOne(
      { ...sourceFilter(record), "submissionLease.token": token,
        "submissionLease.expiresAt": { $gt: new Date(clockNow()).toISOString() } },
      { $set: { "submissionLease.expiresAt": new Date(clockNow() + 20 * 60_000).toISOString() } },
    );
    if (!updated.matchedCount) throw new ApiError(409, "Phiên lưu bản nói đã hết hạn hoặc bài đã thay đổi. Hãy tải lại.");
  }
  async function releaseAttemptLease(record: AttemptRecord, token: string): Promise<void> {
    await database.attempts.updateOne(
      { _id: record.id, userId: record.userId, "submissionLease.token": token },
      { $unset: { submissionLease: "" } },
    );
  }
  async function submitAttempt(
    record: AttemptRecord,
    transcript?: string,
    audio?: { buffer: Buffer; mimetype: string },
    onProgress?: (event: { stage: string; transcript?: string }) => void,
    heldLeaseToken?: string,
  ): Promise<AttemptRecord> {
    let latest = await database.attempts.findOne({
      _id: record.id,
      userId: record.userId,
    });
    if (!latest) throw new ApiError(404, "Không tìm thấy lượt luyện.");
    if (latest.status === "submitted") {
      await duoService?.attemptSubmitted(latest);
      return latest;
    }
    const lockKey = `${record.userId}:${record.id}`;
    if (submissionLocks.has(lockKey) && !heldLeaseToken)
      throw new ApiError(
        409,
        "Bài này đang được chấm. Vui lòng đợi rồi tải lại kết quả.",
      );
    if (!heldLeaseToken) submissionLocks.add(lockKey);
    let leaseToken: string | undefined = heldLeaseToken;
    let detectedTranscript: string | undefined;
    try {
      if (heldLeaseToken) {
        if ((latest as LeasedAttempt).submissionLease?.token !== heldLeaseToken)
          throw new ApiError(409, "Phiên lưu bài đã thay đổi. Hãy tải lại.");
      } else {
        latest = await claimAttemptLease(latest);
        leaseToken = (latest as LeasedAttempt).submissionLease!.token;
      }
      const content = await contentOf(latest.contentId);
      const expired = Boolean(
        latest.deadlineAt && Date.parse(latest.deadlineAt) <= clockNow(),
      );
      const blankWriting =
        content.skill === "writing" &&
        !Object.values(latest.essays).some((essay) => essay.trim());
      const savedSpeaking = content.skill === "speaking" && !audio
        ? await database.audio.findOne({ userId: latest.userId, attemptId: latest.id }) : null;
      const blankSpeaking =
        content.skill === "speaking" &&
        !(transcript ?? latest.transcript).trim() &&
        !audio &&
        !savedSpeaking;
      const savedSpeechPending = content.skill === "speaking" && !audio && Boolean(savedSpeaking) && !(transcript ?? latest.transcript).trim();
      const emptyFeedback: Feedback = {
        id: newId(),
        skill: content.skill,
        estimatedBand: null,
        rawScore: null,
        total: null,
        summary:
          "Không có đủ bài làm trước hạn. Bài đã được khóa theo thời gian thi; chưa có bằng chứng để chấm band.",
        criteria: [],
        corrections: [],
        paragraphs: [],
        answers: [],
        source: "rule-based",
        createdAt: new Date(clockNow()).toISOString(),
      };
      const evaluated: Feedback =
        savedSpeechPending
          ? { ...emptyFeedback, summary: "Bản ghi âm đã lưu trước hạn; đang chờ dịch vụ nhận dạng và chấm AI. Chưa có đủ kết quả để xét nâng band." }
          : expired && (blankWriting || blankSpeaking)
          ? emptyFeedback
          : content.skill === "writing"
            ? await evaluateWriting(content, latest.essays)
            : content.skill === "speaking"
              ? await evaluateSpeaking(
                  content,
                  transcript ?? latest.transcript,
                  audio,
                  (event) => {
                    if (event.transcript) detectedTranscript = event.transcript;
                    onProgress?.(event);
                  },
                )
              : gradeObjective(content, latest.responses);
      const feedback: Feedback = {
        ...evaluated,
        ...(content.referenceAnswers?.length
          ? { referenceAnswers: content.referenceAnswers }
          : {}),
      };
      const updated = await database.attempts.findOneAndUpdate(
        { ...sourceFilter(latest), "submissionLease.token": leaseToken },
        {
          $set: {
            status: "submitted",
            submittedAt: new Date(clockNow()).toISOString(),
            feedback,
            transcript: feedback.transcript ?? transcript ?? latest.transcript,
            durationSeconds:
              latest.mode === "exam"
                ? Math.min(latest.durationSeconds, content.durationMinutes * 60)
                : latest.durationSeconds,
          },
        },
        { returnDocument: "after" },
      );
      if (!updated)
        throw new ApiError(
          409,
          "Trạng thái bài luyện đã thay đổi. Hãy tải lại.",
        );
      await duoService?.attemptSubmitted(updated);
      return updated;
    } catch (error) {
      if (detectedTranscript)
        await database.attempts.updateOne(
          { ...sourceFilter(latest), "submissionLease.token": leaseToken },
          { $set: { transcript: detectedTranscript } },
        );
      throw error;
    } finally {
      if (!heldLeaseToken) {
        try { if (leaseToken) await releaseAttemptLease(latest, leaseToken); }
        finally { submissionLocks.delete(lockKey); }
      }
    }
  }
  async function attemptOf(
    userId: string,
    id: string,
    expire = true,
  ): Promise<AttemptRecord> {
    const record = await database.attempts.findOne({ _id: id, userId });
    if (!record) throw new ApiError(404, "Không tìm thấy lượt luyện của bạn.");
    if (
      expire &&
      record.status === "in-progress" &&
      record.deadlineAt &&
      Date.parse(record.deadlineAt) <= clockNow()
    ) {
      // Deadline is stored by the server and never reset by a browser reload.
      return submitAttempt(record);
    }
    return record;
  }
  async function attemptView(record: AttemptRecord): Promise<Attempt> {
    const {
      _id: _id,
      userId: _userId,
      listeningPlayed: _listeningPlayed,
      submissionLease: _submissionLease,
      ...view
    } = record as LeasedAttempt;
    const audioAvailable = Boolean(
      await database.audio.findOne(
        { userId: record.userId, attemptId: record.id },
        { projection: { _id: 1 } },
      ),
    );
    const content = await contentOf(record.contentId);
    return {
      ...view,
      feedback: completedAttemptFeedback(record, content),
      content: sanitizeContent(
        content,
        record.mode === "exam" && record.status !== "submitted",
      ),
      audioAvailable,
    };
  }
  function completedAttemptFeedback(
    record: AttemptRecord,
    content: StoredContent,
  ): Feedback | null {
    // Status is the disclosure boundary, even if an old/corrupt draft has feedback.
    if (record.status !== "submitted" || !record.feedback) return null;
    const feedback = record.feedback;
    const objective = ["reading", "listening", "grammar"].includes(content.skill);
    const current = objective ? gradeObjective(content, record.responses) : null;
    return {
      ...feedback,
      answers: objective ? content.questions.map((question, index) => {
        const saved = feedback.answers.find((answer) => answer.questionId === question.id);
        // Prefer the persisted key/result when available. Add context to legacy rows.
        return saved
          ? { ...objectiveAnswerContext(content, question), ...saved }
          : current!.answers[index];
      }) : feedback.answers,
      ...(feedback.referenceAnswers?.length
        ? { referenceAnswers: feedback.referenceAnswers }
        : content.referenceAnswers?.length
          ? { referenceAnswers: content.referenceAnswers }
          : {}),
    };
  }
  async function learnerSnapshot(userId: string) {
    const [records, cardRecords, contents] = await Promise.all([
      database.attempts
        .find({ userId })
        .sort({ startedAt: -1 })
        .limit(2000)
        .toArray(),
      database.cards.find({ userId }).toArray(),
      database.content.find({}).toArray(),
    ]);
    return {
      records,
      attempts: records.map(summaryOf),
      cards: cardRecords.map(cardOf),
      contents: contents.map((content) => sanitizeContent(content, true)),
    };
  }
  async function currentPlan(
    request: Request,
    regenerate = false,
  ): Promise<StudyPlan> {
    const user = learnerOf(request);
    const snapshot = await learnerSnapshot(user.id);
    const generated = generatePlan(
      profileOf(user),
      snapshot.attempts,
      snapshot.cards,
      snapshot.contents,
    );
    const existing = await database.plans.findOne({
      userId: user.id,
      weekStart: generated.weekStart,
    });
    if (existing && !regenerate) return planOf(existing);
    const previousCompleted = new Set(
      existing?.tasks.filter((task) => task.completed).map((task) => task.id) ||
        [],
    );
    const plan: PlanRecord = {
      ...generated,
      _id: existing?._id || generated.id,
      userId: user.id,
      tasks: generated.tasks.map((task) => ({
        ...task,
        completed: previousCompleted.has(task.id),
      })),
    };
    await database.plans.updateOne(
      { userId: user.id, weekStart: generated.weekStart },
      { $set: plan },
      { upsert: true },
    );
    return planOf(plan);
  }

  app.patch(
    "/api/profile",
    asyncRoute(async (request, response) => {
      const input = profileSchema.partial().parse(request.body);
      const user = learnerOf(request);
      if (duoEnabled && ((input.name !== undefined && input.name !== user.name) || (input.targetBand !== undefined && input.targetBand !== 8)))
        throw new ApiError(400, "Tên tài khoản cố định và mục tiêu chung band 8.0 được giữ theo lộ trình Duo.");
      const updated = await database.users.findOneAndUpdate(
        { _id: user.id },
        { $set: input },
        { returnDocument: "after" },
      );
      if (!updated) throw new ApiError(404, "Không tìm thấy hồ sơ.");
      (request as Request & { learner: typeof updated }).learner = updated;
      await currentPlan(request, true);
      response.json({ user: profileOf(updated) });
    }),
  );
  app.get(
    "/api/content",
    asyncRoute(async (request, response) => {
      const filter: Record<string, unknown> = {};
      const skill = optionalQuery(request.query.skill);
      if (skill && skills.includes(skill as ContentKind)) filter.skill = skill;
      const topic = optionalQuery(request.query.topic);
      if (topic) filter.topic = topic;
      const cefr = optionalQuery(request.query.cefr);
      if (cefr && ["A2", "B1", "B2", "C1"].includes(cefr)) filter.cefr = cefr;
      const requestedBand = optionalQuery(request.query.band);
      if (requestedBand && Number.isFinite(Number(requestedBand)))
        filter.band = Number(requestedBand);
      const testType = optionalQuery(request.query.testType);
      if (testType === "academic" || testType === "general")
        filter.testType = { $in: [testType, "both"] };
      const format = optionalQuery(request.query.format);
      if (format === "lesson" || format === "full-mock") filter.format = format;
      const q = optionalQuery(request.query.q);
      if (q)
        filter.$or = [
          { title: { $regex: escapeRegex(q), $options: "i" } },
          { description: { $regex: escapeRegex(q), $options: "i" } },
        ];
      const page = Math.max(
        1,
        Math.min(1000, Math.floor(Number(request.query.page) || 1)),
      );
      const pageSize = Math.max(
        1,
        Math.min(100, Math.floor(Number(request.query.pageSize) || 24)),
      );
      const [items, total, topics] = await Promise.all([
        database.content
          .find(filter)
          .sort({ band: 1, title: 1 })
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .toArray(),
        database.content.countDocuments(filter),
        database.content.distinct("topic"),
      ]);
      response.json({
        items: items.map((content) => sanitizeContent(content, true)),
        total,
        topics: topics.sort(),
      });
    }),
  );
  app.get(
    "/api/content/:id",
    asyncRoute(async (request, response) => {
      const content = await contentOf(idOf(request));
      const activeExam = await database.attempts.findOne({
        userId: learnerOf(request).id,
        contentId: content.id,
        mode: "exam",
        status: "in-progress",
      });
      response.json({ content: sanitizeContent(content, Boolean(activeExam)) });
    }),
  );
  const generationLimiter = rateLimit({
    windowMs: 86400000,
    limit: 5,
    keyGenerator: (request) => learnerOf(request).id,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      error: "Bạn đã tạo đủ 5 bài AI hôm nay. Hãy dùng thư viện hiện có.",
    },
  });
  app.post(
    "/api/content/generate",
    generationLimiter,
    asyncRoute(async (request, response) => {
      const input = z
        .object({
          skill: z.enum(skills),
          band,
          topic: z.string().trim().min(3).max(80),
          testType: z.enum(["academic", "general"]),
        })
        .parse(request.body);
      const generated = await generateContent(input);
      await database.content.insertOne({ ...generated, _id: generated.id });
      response.status(201).json({ content: sanitizeContent(generated) });
    }),
  );
  app.post(
    "/api/content/:id/audio",
    asyncRoute(async (request, response) => {
      const content = await contentOf(idOf(request));
      if (content.skill !== "listening")
        throw new ApiError(400, "Bài này không phải bài nghe.");
      const userId = learnerOf(request).id;
      const exam = await database.attempts.findOne({
        userId,
        contentId: content.id,
        mode: "exam",
        status: "in-progress",
      });
      if (exam?.listeningPlayed)
        throw new ApiError(
          409,
          "Exam chỉ phát bản nghe một lần. Chọn Practice để nghe lại.",
        );
      const result = await listeningAudio(content);
      if (exam) {
        const claimed = await database.attempts.updateOne(
          {
            _id: exam.id,
            userId,
            status: "in-progress",
            listeningPlayed: { $ne: true },
          },
          { $set: { listeningPlayed: true } },
        );
        if (!claimed.modifiedCount)
          throw new ApiError(
            409,
            "Bản nghe đã phát hoặc trạng thái bài đã thay đổi.",
          );
      }
      response.type(result.mimetype).send(result.buffer);
    }),
  );

  app.post(
    "/api/attempts",
    asyncRoute(async (request, response) => {
      const input = z
        .object({
          contentId: z.string().max(120),
          mode: z.enum(["practice", "exam"]).default("practice"),
          duoAssessmentId: z.string().regex(/^[\w:.-]{1,180}$/).optional(),
        })
        .parse(request.body);
      const content = await contentOf(input.contentId);
      const user = learnerOf(request);
      if (input.duoAssessmentId && !duoService) throw new ApiError(403, "Lộ trình Duo chưa được bật.");
      const protectedContext = duoService ? await duoService.beforeAttempt(user, input) : {};
      if (protectedContext.existingAttemptId) {
        const bound = await database.attempts.findOne({ _id: protectedContext.existingAttemptId, userId: user.id, duoAssessmentId: input.duoAssessmentId, contentId: content.id });
        if (!bound) throw new ApiError(409, "Lượt thi Duo đã liên kết chưa sẵn sàng; hãy tải lại phòng thi.");
        response.json({ attempt: await attemptView(await attemptOf(user.id, bound.id)) });
        return;
      }
      const existing = await database.attempts.findOne({
        userId: user.id,
        contentId: content.id,
        mode: input.mode,
        status: "in-progress",
      });
      if (
        existing &&
        (!existing.deadlineAt || Date.parse(existing.deadlineAt) > clockNow())
      ) {
        if (existing.duoAssessmentId !== input.duoAssessmentId)
          throw new ApiError(409, "Bạn đang làm bài này ở lượt khác. Hãy nộp lượt đó trước khi bắt đầu bài đánh giá Duo.");
        await duoService?.bindAttempt(user, existing.id, input.duoAssessmentId);
        response.json({ attempt: await attemptView(existing) });
        return;
      }
      if (existing) await submitAttempt(existing);
      const id = newId();
      const now = new Date(clockNow());
      const record: AttemptRecord = {
        _id: id,
        id,
        userId: user.id,
        contentId: content.id,
        title: content.title,
        skill: content.skill,
        mode: input.mode,
        status: "in-progress",
        startedAt: now.toISOString(),
        deadlineAt:
          protectedContext.deadlineAt ?? (input.mode === "exam"
            ? new Date(
                now.getTime() + content.durationMinutes * 60000,
              ).toISOString()
            : null),
        submittedAt: null,
        durationSeconds: 0,
        responses: {},
        essays: {},
        transcript: "",
        feedback: null,
        ...(protectedContext.duoAssessmentId ? { duoAssessmentId: protectedContext.duoAssessmentId } : {}),
      };
      try {
        await database.attempts.insertOne(record);
      } catch (error) {
        if (!(error instanceof MongoServerError) || error.code !== 11000)
          throw error;
        const concurrent = await database.attempts.findOne({
          userId: user.id,
          contentId: content.id,
          mode: input.mode,
          status: "in-progress",
        });
        if (!concurrent) throw error;
        if (concurrent.duoAssessmentId !== input.duoAssessmentId)
          throw new ApiError(409, "Bài này đang mở ở lượt khác; không thể dùng lượt thường để xác nhận kết quả Duo.");
        await duoService?.bindAttempt(user, concurrent.id, input.duoAssessmentId);
        response.json({ attempt: await attemptView(concurrent) });
        return;
      }
      await duoService?.bindAttempt(user, record.id, input.duoAssessmentId);
      response.status(201).json({ attempt: await attemptView(record) });
    }),
  );
  app.get(
    "/api/attempts",
    asyncRoute(async (request, response) => {
      const filter: Record<string, unknown> = { userId: learnerOf(request).id };
      const skill = optionalQuery(request.query.skill);
      if (skill && skills.includes(skill as ContentKind)) filter.skill = skill;
      const status = optionalQuery(request.query.status);
      if (status === "submitted" || status === "in-progress")
        filter.status = status;
      const records = await database.attempts
        .find(filter)
        .sort({ startedAt: -1 })
        .limit(2000)
        .toArray();
      response.json({ attempts: records.map(summaryOf) });
    }),
  );
  app.get(
    "/api/attempts/:id",
    asyncRoute(async (request, response) => {
      response.json({
        attempt: await attemptView(
          await attemptOf(learnerOf(request).id, idOf(request)),
        ),
      });
    }),
  );
  app.patch(
    "/api/attempts/:id",
    asyncRoute(async (request, response) => {
      const input = patchSchema.parse(request.body);
      const user = learnerOf(request);
      if (submissionLocks.has(`${user.id}:${idOf(request)}`))
        throw new ApiError(409, "Bài đang được lưu/chấm; hãy đợi kết quả trước khi sửa bản nháp.");
      const record = await attemptOf(user.id, idOf(request));
      if (record.status !== "in-progress")
        throw new ApiError(
          409,
          "Bài đã nộp hoặc hết giờ; không thể sửa câu trả lời.",
        );
      const content = await contentOf(record.contentId);
      const allowedQuestions = new Set(
        content.questions.map((question) => question.id),
      );
      const allowedSections = new Set(
        content.sections.map((section) => section.id),
      );
      if (
        input.responses &&
        Object.keys(input.responses).some((id) => !allowedQuestions.has(id))
      )
        throw new ApiError(400, "Câu trả lời không thuộc bài luyện này.");
      if (
        input.essays &&
        Object.keys(input.essays).some(
          (id) => !allowedSections.has(id) && !["task1", "task2"].includes(id),
        )
      )
        throw new ApiError(400, "Bản nháp không thuộc task của bài này.");
      const changes: Record<string, unknown> = {};
      if (input.responses)
        changes.responses = {
          $mergeObjects: ["$responses", { $literal: input.responses }],
        };
      if (input.essays)
        changes.essays = {
          $mergeObjects: ["$essays", { $literal: input.essays }],
        };
      if (input.transcript !== undefined)
        changes.transcript = { $literal: input.transcript };
      if (input.durationSeconds !== undefined)
        changes.durationSeconds = {
          $max: [
            "$durationSeconds",
            Math.min(
              input.durationSeconds,
              Math.floor((clockNow() - Date.parse(record.startedAt)) / 1000),
            ),
          ],
        };
      if (!Object.keys(changes).length) {
        response.json({ attempt: await attemptView(record) });
        return;
      }
      const updated = await database.attempts.findOneAndUpdate(
        // Pipeline merges stay atomic for independent concurrent draft saves;
        // the persisted lease fences a save that began before grading started.
        { _id: record.id, userId: user.id, status: "in-progress", ...freeLeaseFilter(), $and: [
          { $or: [{ deadlineAt: null }, { deadlineAt: { $gt: new Date(clockNow()).toISOString() } }] },
        ] },
        [{ $set: changes }],
        { returnDocument: "after" },
      );
      if (!updated)
        throw new ApiError(409, "Trạng thái bài luyện đã thay đổi.");
      response.json({ attempt: await attemptView(updated) });
    }),
  );
  app.post(
    "/api/attempts/:id/listening-source",
    asyncRoute(async (request, response) => {
      const userId = learnerOf(request).id;
      const record = await attemptOf(userId, idOf(request));
      if (record.skill !== "listening")
        throw new ApiError(400, "Đây không phải bài Listening.");
      if (record.status !== "in-progress")
        throw new ApiError(409, "Bài đã nộp. Mở kết quả để xem transcript.");
      if (record.mode === "exam") {
        const claimed = await database.attempts.updateOne(
          {
            _id: record.id,
            userId,
            status: "in-progress",
            listeningPlayed: { $ne: true },
          },
          { $set: { listeningPlayed: true } },
        );
        if (!claimed.modifiedCount)
          throw new ApiError(
            409,
            "Exam chỉ phát bản nghe một lần. Chọn Practice để nghe lại.",
          );
      }
      const content = await contentOf(record.contentId);
      response.json({
        sections: content.sections,
        source: "browser-tts",
        notice:
          "Giọng đọc của trình duyệt để tự luyện; accent chưa kiểm định. Exam này không phải kỳ thi có giám sát.",
      });
    }),
  );
  app.post(
    "/api/attempts/:id/submit",
    asyncRoute(async (request, response) => {
      const record = await attemptOf(
        learnerOf(request).id,
        idOf(request),
        false,
      );
      response.json({
        attempt: await attemptView(await submitAttempt(record)),
      });
    }),
  );
  app.post(
    "/api/attempts/:id/regrade",
    asyncRoute(async (request, response) => {
      const record = await attemptOf(learnerOf(request).id, idOf(request), false);
      if (!duoService || !record.duoAssessmentId || record.status !== "submitted" || !["writing", "speaking"].includes(record.skill))
        throw new ApiError(400, "Chỉ chấm lại phần Viết/Nói đã nộp trong bài đánh giá Duo.");
      if (record.feedback?.source === "ai" && record.feedback.estimatedBand !== null) {
        await duoService.attemptSubmitted(record);
        response.json({ attempt: await attemptView(record) });
        return;
      }
      if (!services().openai) throw new ApiError(503, "Chấm AI chưa được cấu hình. Bài làm đã lưu và tiếp tục chờ chấm.");
      const lockKey = `${record.userId}:${record.id}`;
      if (submissionLocks.has(lockKey)) throw new ApiError(409, "Bài đang được chấm; hãy đợi kết quả.");
      submissionLocks.add(lockKey);
      try {
        const content = await contentOf(record.contentId);
        let audio: { buffer: Buffer; mimetype: string } | undefined;
        if (record.skill === "speaking") {
          const saved = await database.audio.findOne({ userId: record.userId, attemptId: record.id });
          if (saved) {
            const owned = await database.db.collection("recordings.files").findOne({ _id: saved.fileId, "metadata.userId": record.userId, "metadata.attemptId": record.id });
            if (!owned || typeof owned.length !== "number" || owned.length > 25 * 1024 * 1024) throw new ApiError(400, "Bản ghi âm của bài chưa hợp lệ để chấm lại.");
            const chunks: Buffer[] = []; let bytes = 0;
            for await (const chunk of database.recordings.openDownloadStream(saved.fileId)) {
              bytes += chunk.length;
              if (bytes > 25 * 1024 * 1024) throw new ApiError(400, "Bản ghi âm vượt giới hạn chấm lại.");
              chunks.push(Buffer.from(chunk));
            }
            audio = { buffer: Buffer.concat(chunks), mimetype: saved.mime };
          }
        }
        const evaluated = record.skill === "writing" ? await evaluateWriting(content, record.essays) : await evaluateSpeaking(content, record.transcript, audio);
        const feedback: Feedback = { ...evaluated, ...(content.referenceAnswers?.length ? { referenceAnswers: content.referenceAnswers } : {}) };
        const updated = await database.attempts.findOneAndUpdate(
          { _id: record.id, userId: record.userId, status: "submitted", "feedback.id": record.feedback?.id ?? null },
          { $set: { feedback, transcript: feedback.transcript ?? record.transcript } },
          { returnDocument: "after" },
        );
        if (!updated) throw new ApiError(409, "Kết quả đã thay đổi ở phiên khác; hãy tải lại.");
        await duoService.attemptSubmitted(updated);
        response.json({ attempt: await attemptView(updated) });
      } finally { submissionLocks.delete(lockKey); }
    }),
  );
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 25 * 1024 * 1024,
      files: 1,
      fields: 3,
      fieldSize: 160 * 1024,
    },
    fileFilter: (_request, file, callback) => {
      if (
        !/^(audio\/(wav|x-wav|wave|webm|ogg|mpeg|mp4)|video\/webm)$/.test(
          file.mimetype,
        )
      ) {
        callback(
          new ApiError(400, "Chỉ nhận bản ghi WAV, WebM, OGG hoặc MP3/M4A."),
        );
        return;
      }
      callback(null, true);
    },
  });
  app.post(
    "/api/attempts/:id/speaking",
    upload.single("audio"),
    asyncRoute(async (request, response) => {
      const userId = learnerOf(request).id;
      const attemptId = idOf(request);
      const lockKey = `${userId}:${attemptId}`;
      if (submissionLocks.has(lockKey)) throw new ApiError(409, "Bản nói đang được lưu/chấm; hãy đợi kết quả.");
      submissionLocks.add(lockKey);
      let leaseToken: string | undefined;
      let record: AttemptRecord | undefined;
      try {
        record = await attemptOf(userId, attemptId, false);
        if (record.skill !== "speaking")
          throw new ApiError(400, "Đây không phải bài Speaking.");
        if (record.status === "submitted") {
          const result = { attempt: await attemptView(record) };
          if (request.get("accept")?.includes("text/event-stream")) {
            response
              .type("text/event-stream")
              .send(`event: result\ndata: ${JSON.stringify(result)}\n\n`);
          } else response.json(result);
          return;
        }
        record = await claimAttemptLease(record);
        leaseToken = (record as LeasedAttempt).submissionLease!.token;
        if (record.deadlineAt && Date.parse(record.deadlineAt) <= clockNow()) {
          await submitAttempt(record, undefined, undefined, undefined, leaseToken);
          throw new ApiError(409, "Đã hết giờ thi. Bài đã khóa; chỉ bản nháp và âm thanh đã lưu trước hạn được xét chấm.");
        }
        const acceptedAt = new Date(clockNow()).toISOString();
        const transcript = z
          .string()
          .max(40000)
          .parse(request.body?.transcript ?? record.transcript);
        const file = request.file;
        const previousRecording = await database.audio.findOne({
          userId: record.userId,
          attemptId: record.id,
        });
        const savedRecording = !file ? previousRecording : null;
        if (!transcript.trim() && !file && !savedRecording)
          throw new ApiError(
            400,
            "Hãy ghi âm hoặc nhập transcript để luyện tập.",
          );
        let audioInput = file
          ? { buffer: file.buffer, mimetype: file.mimetype }
          : undefined;
        if (savedRecording) {
          const owned = await database.db
            .collection("recordings.files")
            .findOne({
              _id: savedRecording.fileId,
              "metadata.userId": record.userId,
              "metadata.attemptId": record.id,
            });
          if (!owned) throw new ApiError(404, "Không tìm thấy bản ghi của bạn.");
          const chunks: Buffer[] = [];
          for await (const chunk of database.recordings.openDownloadStream(
            savedRecording.fileId,
          )) {
            if (!(chunk instanceof Uint8Array))
              throw new Error("Invalid recording chunk");
            chunks.push(Buffer.from(chunk));
          }
          audioInput = {
            buffer: Buffer.concat(chunks),
            mimetype: savedRecording.mime,
          };
        }
        if (file) {
          const stream = database.recordings.openUploadStream(
            `recording-${record.id}`,
            {
              contentType: file.mimetype,
              metadata: { userId: record.userId, attemptId: record.id },
            },
          );
          const completed = once(stream, "finish");
          stream.end(file.buffer);
          await completed;
          try {
            // A process may resume after its upload lease was reclaimed. Fence
            // publication before touching the current pointer or deleting audio.
            await renewAttemptLease(record, leaseToken);
            const metadata = { fileId: stream.id, mime: file.mimetype, createdAt: acceptedAt };
            if (previousRecording) {
              const published = await database.audio.updateOne(
                { _id: previousRecording._id, userId: record.userId, attemptId: record.id, fileId: previousRecording.fileId },
                { $set: metadata },
              );
              if (!published.matchedCount) throw new ApiError(409, "Bản ghi âm đã thay đổi ở phiên khác.");
            } else {
              try {
                await database.audio.insertOne({ _id: newId(), userId: record.userId, attemptId: record.id, ...metadata });
              } catch (error) {
                if (error instanceof Error && "code" in error && error.code === 11000)
                  throw new ApiError(409, "Bản ghi âm đã được lưu ở phiên khác.");
                throw error;
              }
            }
          } catch (error) {
            await deleteOwnedRecording(record.userId, record.id, stream.id);
            throw error;
          }
        }
        const saved = await database.attempts.findOneAndUpdate(
          { ...sourceFilter(record), "submissionLease.token": leaseToken },
          { $set: { transcript } },
          { returnDocument: "after" },
        );
        if (!saved) throw new ApiError(409, "Bản nói đã thay đổi ở phiên khác; chưa áp dụng kết quả chấm.");
        record = saved;
        if (file && previousRecording)
          await deleteOwnedRecording(record.userId, record.id, previousRecording.fileId);
        const wantsStream = request.get("accept")?.includes("text/event-stream");
        if (!wantsStream) {
          const result = await submitAttempt(
            { ...record, transcript },
            transcript,
            audioInput,
            undefined,
            leaseToken,
          );
          response.json({ attempt: await attemptView(result) });
          return;
        }
        response.setHeader("Content-Type", "text/event-stream");
        response.setHeader("X-Accel-Buffering", "no");
        response.flushHeaders();
        const send = (name: string, data: unknown) => {
          if (!response.destroyed)
            response.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
        };
        const heartbeat = setInterval(() => {
          if (!response.destroyed) response.write(": keepalive\n\n");
        }, 15000);
        try {
          const result = await submitAttempt(
            { ...record, transcript },
            transcript,
            audioInput,
            (event) => send("progress", event),
            leaseToken,
          );
          send("result", { attempt: await attemptView(result) });
        } catch (error) {
          send("error", {
            error:
              error instanceof Error ? error.message : "Không thể chấm Speaking.",
            status: error instanceof ApiError ? error.status : 500,
          });
        } finally {
          clearInterval(heartbeat);
          response.end();
        }
      } finally {
        try { if (record && leaseToken) await releaseAttemptLease(record, leaseToken); }
        finally { submissionLocks.delete(lockKey); }
      }
    }),
  );
  app.get(
    "/api/attempts/:id/audio",
    asyncRoute(async (request, response) => {
      const userId = learnerOf(request).id;
      await attemptOf(userId, idOf(request), false);
      const audio = await database.audio.findOne({
        userId,
        attemptId: idOf(request),
      });
      if (!audio) throw new ApiError(404, "Lượt luyện chưa có bản ghi âm.");
      const storedFile = await database.db
        .collection("recordings.files")
        .findOne({
          _id: audio.fileId,
          "metadata.userId": userId,
          "metadata.attemptId": idOf(request),
        });
      if (!storedFile) throw new ApiError(404, "Bản ghi âm chưa sẵn sàng.");
      response.type(audio.mime);
      await pipeline(
        database.recordings.openDownloadStream(audio.fileId),
        response,
      );
    }),
  );

  app.get(
    "/api/dashboard",
    asyncRoute(async (request, response) => {
      const snapshot = await learnerSnapshot(learnerOf(request).id);
      const plan = await currentPlan(request, true);
      const dashboard = buildDashboard(
        profileOf(learnerOf(request)),
        snapshot.attempts,
        snapshot.cards,
        snapshot.contents,
        plan,
      );
      dashboard.weaknesses = buildErrorNotebook(
        snapshot.records.map((record) => ({
          ...summaryOf(record),
          feedback: record.feedback,
        })),
        snapshot.contents,
      )
        .items.map(({ tag, skill, count }) => ({ tag, skill, count }))
        .slice(0, 8);
      response.json(dashboard);
    }),
  );
  app.get(
    "/api/plan",
    asyncRoute(async (request, response) => {
      response.json({ plan: await currentPlan(request, true) });
    }),
  );
  app.patch(
    "/api/plan/tasks/:id",
    asyncRoute(async (request, response) => {
      const { completed } = z
        .object({ completed: z.boolean() })
        .parse(request.body);
      const plan = await currentPlan(request);
      if (!plan.tasks.some((task) => task.id === idOf(request)))
        throw new ApiError(404, "Không tìm thấy buổi học của bạn.");
      await database.plans.updateOne(
        {
          userId: learnerOf(request).id,
          weekStart: plan.weekStart,
          "tasks.id": idOf(request),
        },
        { $set: { "tasks.$.completed": completed } },
      );
      response.json({
        plan: {
          ...plan,
          tasks: plan.tasks.map((task) =>
            task.id === idOf(request) ? { ...task, completed } : task,
          ),
        },
      });
    }),
  );
  app.get(
    "/api/errors",
    asyncRoute(async (request, response) => {
      const snapshot = await learnerSnapshot(learnerOf(request).id);
      response.json(
        buildErrorNotebook(
          snapshot.records.map((record) => ({
            ...summaryOf(record),
            feedback: record.feedback,
          })),
          snapshot.contents,
        ),
      );
    }),
  );
  app.get(
    "/api/vocabulary/bank",
    asyncRoute(async (request, response) => {
      const filter: Record<string, unknown> = {};
      const topic = optionalQuery(request.query.topic);
      if (topic) filter.topic = topic;
      const cefr = optionalQuery(request.query.cefr);
      if (cefr) filter.cefr = cefr;
      const q = optionalQuery(request.query.q);
      if (q)
        filter.$or = [
          { word: { $regex: escapeRegex(q), $options: "i" } },
          { meaning: { $regex: escapeRegex(q), $options: "i" } },
          { definition: { $regex: escapeRegex(q), $options: "i" } },
        ];
      const page = Math.max(
        1,
        Math.min(1000, Math.floor(Number(request.query.page) || 1)),
      );
      const pageSize = Math.max(
        1,
        Math.min(100, Math.floor(Number(request.query.pageSize) || 30)),
      );
      const [items, total] = await Promise.all([
        database.vocabulary
          .find(filter)
          .sort({ word: 1 })
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .toArray(),
        database.vocabulary.countDocuments(filter),
      ]);
      response.json({
        items: items.map(({ _id: _id, ...item }) => item),
        total,
      });
    }),
  );
  app.get(
    "/api/vocabulary/cards",
    asyncRoute(async (request, response) => {
      const cards = (
        await database.cards
          .find({ userId: learnerOf(request).id })
          .sort({ dueAt: 1 })
          .toArray()
      ).map(cardOf);
      response.json({
        cards,
        dueCount: cards.filter((card) => card.due).length,
      });
    }),
  );
  app.post(
    "/api/vocabulary/cards",
    asyncRoute(async (request, response) => {
      const input = z
        .object({
          vocabularyId: z.string().max(120).optional(),
          word: z.string().trim().min(1).max(80).optional(),
          meaning: z.string().trim().min(1).max(500).optional(),
          example: z.string().max(1000).optional(),
          cefr: z.enum(["A2", "B1", "B2", "C1"]).optional(),
          topic: z.string().max(80).optional(),
        })
        .parse(request.body);
      const vocabulary = input.vocabularyId
        ? await database.vocabulary.findOne({ _id: input.vocabularyId })
        : null;
      if (input.vocabularyId && !vocabulary)
        throw new ApiError(404, "Không tìm thấy từ trong ngân hàng.");
      const word = (vocabulary?.word || input.word || "").trim().toLowerCase();
      const meaning = vocabulary?.meaning || input.meaning;
      if (!word || !meaning)
        throw new ApiError(400, "Cần từ và nghĩa để tạo flashcard.");
      const userId = learnerOf(request).id;
      const existing = await database.cards.findOne({ userId, word });
      if (existing) {
        response.json({ card: cardOf(existing) });
        return;
      }
      const scheduler = newScheduler();
      const id = newId();
      const card: CardRecord = {
        _id: id,
        id,
        userId,
        vocabularyId: vocabulary?.id || null,
        word,
        meaning,
        example: vocabulary?.examples[0] || input.example || "",
        cefr: vocabulary?.cefr || input.cefr || "B1",
        topic: vocabulary?.topic || input.topic || "Personal",
        savedAt: new Date(clockNow()).toISOString(),
        ...vocabularyMetrics(scheduler),
        scheduler,
        reviewLog: [],
      };
      try {
        await database.cards.insertOne(card);
      } catch (error) {
        if (!(error instanceof MongoServerError) || error.code !== 11000)
          throw error;
        const duplicate = await database.cards.findOne({ userId, word });
        if (!duplicate) throw error;
        response.json({ card: cardOf(duplicate) });
        return;
      }
      response.status(201).json({ card: cardOf(card) });
    }),
  );
  app.post(
    "/api/vocabulary/cards/:id/review",
    asyncRoute(async (request, response) => {
      const { rating } = z
        .object({
          rating: z.union([
            z.literal(1),
            z.literal(2),
            z.literal(3),
            z.literal(4),
          ]),
        })
        .parse(request.body);
      const userId = learnerOf(request).id;
      const card = await database.cards.findOne({ _id: idOf(request), userId });
      if (!card) throw new ApiError(404, "Không tìm thấy flashcard của bạn.");
      const review = scheduleReview(card.scheduler, rating);
      const updated = await database.cards.findOneAndUpdate(
        { _id: card.id, userId, scheduler: card.scheduler },
        {
          $set: {
            scheduler: review.scheduler,
            ...vocabularyMetrics(review.scheduler),
          },
          $push: { reviewLog: review.log },
        },
        { returnDocument: "after" },
      );
      if (!updated)
        throw new ApiError(409, "Thẻ vừa được ôn ở phiên khác. Hãy tải lại.");
      response.json({ card: cardOf(updated) });
    }),
  );

  async function placementView(
    record: PlacementRecord,
  ): Promise<PlacementState> {
    const complete = placementIsComplete(record);
    const item = !complete && record.currentQuestionId
      ? await database.placementItems.findOne({ _id: record.currentQuestionId })
      : null;
    return {
      id: record._id,
      mode: record.mode,
      total: record.total,
      completed: record.answers.length,
      theta: record.theta,
      standardError: record.standardError,
      estimatedBand: record.estimatedBand,
      question: item
        ? (({
            _id: _id,
            answer: _answer,
            explanation: _explanation,
            difficulty: _difficulty,
            ...question
          }) => question)(item)
        : null,
      result: complete ? await completedPlacementFeedback(record) : null,
    };
  }
  function placementIsComplete(record: PlacementRecord): boolean {
    return record.currentQuestionId === null && record.answers.length >= record.total && record.result !== null;
  }
  async function completedPlacementFeedback(record: PlacementRecord): Promise<Feedback | null> {
    if (!placementIsComplete(record) || !record.result) return null;
    const items = await database.placementItems.find({
      _id: { $in: record.answers.map((answer) => answer.questionId) },
    }).toArray();
    const saved = new Map(record.result.answers.map((answer) => [answer.questionId, answer]));
    return {
      ...record.result,
      // Only actually attempted questions, in their adaptive order. An existing
      // snapshot stays usable when a later bank update changes/removes its source.
      answers: record.answers.map((answer, index) => {
        const snapshot = saved.get(answer.questionId) ?? answer.review;
        if (snapshot) return { ...snapshot, response: answer.answer, questionNumber: index + 1 };
        const item = items.find((question) => question.id === answer.questionId);
        if (item) return placementAnswerReview(item, answer.answer, index + 1);
        return {
          questionId: answer.questionId, questionNumber: index + 1,
          response: answer.answer, answer: "", correct: answer.correct,
          explanation: "Câu hỏi cũ không còn trong ngân hàng; không thể khôi phục đáp án chính xác.",
          evidence: "", subskill: "",
        };
      }),
    };
  }
  async function selectQuestion(record: PlacementRecord, theta: number) {
    const bank = await database.placementItems
      .find({
        skill: record.answers.length % 2 === 0 ? "reading" : "listening",
      })
      .toArray();
    return selectPlacementQuestion(
      bank,
      record.answers.map((answer) => answer.questionId),
      theta,
    );
  }
  app.get(
    "/api/placement/active",
    asyncRoute(async (request, response) => {
      const record = await database.placements.findOne(
        { userId: learnerOf(request).id, currentQuestionId: { $ne: null } },
        { sort: { startedAt: -1 } },
      );
      response.json({ placement: record ? await placementView(record) : null });
    }),
  );
  app.post(
    "/api/placement/start",
    asyncRoute(async (request, response) => {
      const { mode } = z
        .object({ mode: z.enum(["quick", "deep"]).default("quick") })
        .parse(request.body);
      const userId = learnerOf(request).id;
      const existing = await database.placements.findOne(
        { userId, mode, currentQuestionId: { $ne: null } },
        { sort: { startedAt: -1 } },
      );
      if (existing) {
        response.json({ placement: await placementView(existing) });
        return;
      }
      const record: PlacementRecord = {
        _id: newId(),
        userId,
        mode,
        total: mode === "quick" ? 15 : 30,
        theta: 0,
        standardError: 1.5,
        estimatedBand: 5,
        currentQuestionId: null,
        answers: [],
        result: null,
        startedAt: new Date(clockNow()).toISOString(),
      };
      record.currentQuestionId = (
        await selectQuestion(record, record.theta)
      ).id;
      await database.placements.insertOne(record);
      response.status(201).json({ placement: await placementView(record) });
    }),
  );
  app.post(
    "/api/placement/:id/answer",
    asyncRoute(async (request, response) => {
      const input = z
        .object({
          questionId: z.string().max(120),
          answer: z.string().max(500),
        })
        .parse(request.body);
      const userId = learnerOf(request).id;
      const record = await database.placements.findOne({
        _id: idOf(request),
        userId,
      });
      if (!record)
        throw new ApiError(404, "Không tìm thấy bài đánh giá của bạn.");
      if (
        !record.currentQuestionId ||
        record.currentQuestionId !== input.questionId
      )
        throw new ApiError(
          409,
          "Câu hỏi đã được trả lời hoặc bài đánh giá đã kết thúc.",
        );
      const item = await database.placementItems.findOne({
        _id: input.questionId,
      });
      if (!item) throw new ApiError(404, "Câu hỏi không có trong ngân hàng.");
      if (!item.options.includes(input.answer))
        throw new ApiError(400, "Hãy chọn một phương án hợp lệ.");
      const answers = [
        ...record.answers,
        {
          questionId: item.id,
          answer: input.answer,
          correct: input.answer === item.answer,
          review: placementAnswerReview(item, input.answer, record.answers.length + 1),
        },
      ];
      const usedItems = await database.placementItems
        .find({ _id: { $in: answers.map((answer) => answer.questionId) } })
        .toArray();
      const estimate = estimatePlacement(
        answers.map((answer) => ({
          correct: answer.correct,
          difficulty:
            usedItems.find((item) => item.id === answer.questionId)
              ?.difficulty ?? 0,
        })),
      );
      const complete = answers.length >= record.total;
      const changed: PlacementRecord = {
        ...record,
        answers,
        ...estimate,
        currentQuestionId: null,
        result: complete
          ? placementFeedback({
              ...estimate,
              correct: answers.filter((answer) => answer.correct).length,
              total: answers.length,
              answers: answers.map((answer, index) => {
                if (answer.review) return { ...answer.review, questionNumber: index + 1 };
                const used = usedItems.find((question) => question.id === answer.questionId);
                if (!used) throw new ApiError(409, "Một câu hỏi đã thay đổi trong khi làm bài. Hãy tải lại trước khi kết thúc.");
                return placementAnswerReview(used, answer.answer, index + 1);
              }),
            })
          : null,
      };
      if (!complete)
        changed.currentQuestionId = (
          await selectQuestion(changed, estimate.theta)
        ).id;
      const updated = await database.placements.findOneAndUpdate(
        { _id: record._id, userId, currentQuestionId: input.questionId },
        { $set: changed },
        { returnDocument: "after" },
      );
      if (!updated)
        throw new ApiError(409, "Câu này vừa được trả lời ở phiên khác.");
      if (complete)
        await database.users.updateOne(
          { _id: userId },
          {
            $set: {
              currentBand: estimate.estimatedBand,
              personalEstimatedBand: estimate.estimatedBand,
              cefr: cefrForBand(estimate.estimatedBand),
            },
          },
        );
      if (complete) await duoService?.placementCompleted(learnerOf(request), updated);
      response.json({ placement: await placementView(updated) });
    }),
  );
  app.get(
    "/api/placement/history",
    asyncRoute(async (request, response) => {
      const records = await database.placements
        .find({ userId: learnerOf(request).id })
        .sort({ startedAt: -1 })
        .limit(100)
        .toArray();
      response.json({
        placements: await Promise.all(records.map(async (record) => ({
          id: record._id,
          mode: record.mode,
          total: record.total,
          completed: record.answers.length,
          estimatedBand: record.estimatedBand,
          standardError: record.standardError,
          startedAt: record.startedAt,
          result: await completedPlacementFeedback(record),
        }))),
      });
    }),
  );
  app.get(
    "/api/placement/:id",
    asyncRoute(async (request, response) => {
      const record = await database.placements.findOne({
        _id: idOf(request),
        userId: learnerOf(request).id,
      });
      if (!record)
        throw new ApiError(404, "Không tìm thấy bài đánh giá của bạn.");
      response.json({ placement: await placementView(record) });
    }),
  );

  app.get(
    "/api/account/export",
    asyncRoute(async (request, response) => {
      const userId = learnerOf(request).id;
      const [attempts, cards, placements, plans, recordings] =
        await Promise.all([
          database.attempts.find({ userId }).toArray(),
          database.cards.find({ userId }).toArray(),
          database.placements.find({ userId }).toArray(),
          database.plans.find({ userId }).toArray(),
          database.audio.find({ userId }).toArray(),
        ]);
      const withoutStorage = (record: { _id: string; userId: string; submissionLease?: unknown }) => {
        const { _id: _id, userId: _userId, submissionLease: _submissionLease, ...view } = record;
        return view;
      };
      response.setHeader(
        "Content-Disposition",
        'attachment; filename="ielts-learning-data.json"',
      );
      response.json({
        exportedAt: new Date(clockNow()).toISOString(),
        profile: profileOf(learnerOf(request)),
        attempts: await Promise.all(attempts.map(async (record) => ({
          ...withoutStorage(record),
          feedback: record.status === "submitted"
            ? completedAttemptFeedback(record, await contentOf(record.contentId))
            : null,
        }))),
        cards: cards.map(cardOf),
        placements: await Promise.all(placements.map(placementView)),
        plans: plans.map(planOf),
        recordings: recordings.map(withoutStorage),
        recordingNote:
          "Bản xuất chứa metadata âm thanh. Tải bản ghi từ lượt luyện Speaking của bạn.",
      });
    }),
  );
  app.delete(
    "/api/account/history",
    asyncRoute(async (request, response) => {
      if (duoEnabled) throw new ApiError(409, "Lịch sử đang làm bằng chứng cho lộ trình chung. Dùng chức năng xuất dữ liệu để lưu lại bài làm.");
      z.object({ confirm: z.literal(true) }).parse(request.body);
      const userId = learnerOf(request).id;
      if ([...submissionLocks].some((key) => key.startsWith(`${userId}:`)))
        throw new ApiError(409, "Đợi bài đang chấm hoàn tất rồi xóa lịch sử.");
      const ownedRecordings = await database.audio.find({ userId }).toArray();
      await Promise.all(
        ownedRecordings.map((recording) =>
          deleteOwnedRecording(userId, recording.attemptId, recording.fileId),
        ),
      );
      await Promise.all([
        database.attempts.deleteMany({ userId }),
        database.cards.deleteMany({ userId }),
        database.placements.deleteMany({ userId }),
        database.plans.deleteMany({ userId }),
        database.audio.deleteMany({ userId }),
      ]);
      await database.users.updateOne(
        { _id: userId },
        { $set: { currentBand: null, cefr: null } },
      );
      response.json({ ok: true });
    }),
  );
  app.use("/api", (_request, _response, next) => {
    next(new ApiError(404, "API không tồn tại."));
  });
  if (config.serveClient ?? production) {
    const dist = resolve("dist");
    app.use(express.static(dist, { maxAge: "1h", index: false }));
    app.get("/{*path}", (_request, response) =>
      response.sendFile(resolve(dist, "index.html")),
    );
  }
  app.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      _next: NextFunction,
    ) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      if (
        error instanceof SyntaxError &&
        "status" in error &&
        error.status === 400
      ) {
        response.status(400).json({ error: "JSON của yêu cầu không hợp lệ." });
        return;
      }
      if (error instanceof ZodError) {
        response
          .status(400)
          .json({ error: error.issues[0]?.message || "Dữ liệu không hợp lệ." });
        return;
      }
      if (error instanceof multer.MulterError) {
        response
          .status(400)
          .json({
            error:
              error.code === "LIMIT_FILE_SIZE"
                ? "Bản ghi âm tối đa 25 MB."
                : "Dữ liệu ghi âm không hợp lệ.",
          });
        return;
      }
      if (error instanceof ApiError) {
        response.status(error.status).json({ error: error.message });
        return;
      }
      if (error instanceof Error && "status" in error && error.status === 413) {
        response.status(413).json({ error: "Nội dung quá lớn." });
        return;
      }
      console.error(
        "API failure:",
        error instanceof Error ? error.message : "Unknown failure",
      );
      response
        .status(503)
        .json({
          error:
            "Dịch vụ hoặc MongoDB tạm thời chưa sẵn sàng. Vui lòng thử lại.",
        });
    },
  );
  return app;
}
