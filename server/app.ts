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
import { setAudioRange } from "./audio-range";
import { contentProgress } from "./content-progress";
import { SpeechAudioCache, speechCapabilities, type SpeechAudioResult } from "./speech-audio";
import { readSpeechPrewarmStatus } from "./speech-prewarm";
import { registerWordNotebookRoutes } from "./word-notebook";
import { validIpa, type WordPronunciationOptions } from "./word-pronunciation";
import type { WordTranslationOptions } from "./word-translation";
import { placementDurationSeconds, suggestedPlacementSeconds } from "./placement-timing";
import { ExamGuard, requireExamTab, type ExamTarget, type ExamResetResult } from "./exam-guard";
import { createExamReplacement, examReplacementSourceIds, ExamReplacementUnavailableError } from "./exam-variants";
import { loadDuoCredentials, loginDuo, type DuoCredentialSettings } from "./duo-auth";
import { createDuoService } from "./duo";
import {
  services,
  evaluateWriting,
  evaluateSpeaking,
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
  type AudioRecord,
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
  /** Explicitly disabled only by isolated fixtures for historical workflows. */
  examIntegrityEnabled?: boolean;
  duoCredentials?: DuoCredentialSettings;
  duo?: Parameters<typeof createDuoService>[1];
  /** Isolated tests can inject a controlled dictionary transport. */
  wordTranslation?: WordTranslationOptions;
  /** Free dictionary transport is isolated from paid AI services. */
  wordPronunciation?: WordPronunciationOptions;
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
// Bound browsing and readiness reads instead of waiting for the proxy's long
// timeout when an already connected MongoDB stops answering.
const LIBRARY_READ_TIMEOUT_MS = 5_000;
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
  delete (clean as StoredContent & { replacement?: unknown }).replacement;
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
  const metrics = vocabularyMetrics(card.scheduler);
  return { ...view, ...metrics, ...(card.meaningStatus === "pending" ? { due: false } : {}) };
}
function planOf(plan: PlanRecord): StudyPlan {
  const { _id: _id, userId: _userId, ...view } = plan;
  return view;
}

export function createApp(database: Database, config: AppConfig = {}): Express {
  const production = config.production ?? process.env.NODE_ENV === "production";
  const clockNow = config.duo?.now ?? Date.now;
  const examIntegrityEnabled = config.examIntegrityEnabled ?? true;
  const duoEnabled = config.duoEnabled ?? (production || process.env.DUO_ENABLED !== "false");
  const duoCredentials = duoEnabled ? config.duoCredentials ?? loadDuoCredentials() : undefined;
  const authOptions = duoCredentials ? { duo: duoCredentials } : {};
  const speechAudio = new SpeechAudioCache(database);
  async function requireReadyListening(contents: StoredContent[]): Promise<void> {
    if (!speechCapabilities().configured) return;
    const sections = contents.filter(content => content.skill === "listening").flatMap(content => content.sections);
    if (!sections.length) return;
    const readiness = await speechAudio.readiness(sections);
    if (!readiness.ready) throw new ApiError(409, readiness.notice);
  }
  async function placementAudioReadiness() {
    if (!speechCapabilities().configured) return speechAudio.readiness([]);
    const items = await database.placementItems.find({ skill: "listening" }, {
      projection: { id: 1, text: 1 }, timeoutMS: LIBRARY_READ_TIMEOUT_MS, timeoutMode: "cursorLifetime",
    }).toArray();
    return speechAudio.readiness(items.map(item => ({ id: item.id, title: "", text: item.text })));
  }
  const duoService = duoEnabled ? createDuoService(database, { ...config.duo, ensureAudioReady: requireReadyListening }) : null;
  const demoEnabled = !duoEnabled &&
    (config.demoEnabled ?? (process.env.DEMO_ENABLED !== "false" && !production));
  const maxLearners =
    config.maxLearners ?? Number(process.env.MAX_LEARNERS || 2);
  if (!Number.isInteger(maxLearners) || maxLearners < 1 || maxLearners > 100)
    throw new Error("MAX_LEARNERS must be between 1 and 100.");
  const app = express();
  function sendSpeechAudio(response: Response, audio: SpeechAudioResult & { cached: boolean }, rangeHeader?: string): void {
    response.set({
      "Cache-Control": "private, no-store",
      "X-Speech-Provider": audio.provider,
      "X-Speech-Voices": String(audio.voiceCount),
      "X-Speech-Cache": audio.cached ? "hit" : "miss",
    });
    const range = setAudioRange(response, rangeHeader, audio.buffer.length);
    if (range === false) return;
    response.type(audio.mimetype).send(audio.buffer.subarray(range.start, range.end + 1));
  }
  async function inspectAudioSource(request: Request, kind: "attempt" | "placement", id: string): Promise<void> {
    if (!examIntegrityEnabled) return;
    const user = learnerOf(request), session = await guard.inspectResource(user, kind, id);
    // Submitted Duo parts can still be attached to an active guarded sitting.
    if (session?.status === "active")
      await guard.assert(user, kind, id, requireExamTab(request.get("X-Exam-Tab")));
    if (session?.status === "invalidated") throw new ApiError(409, "Lượt đã bị hủy; không thể mở âm thanh.");
  }
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
        examIntegrityEnabled,
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
  const guard = new ExamGuard(database, clockNow, resolveExamTarget, resetExamTarget);
  app.use("/api", (request: Request, _response: Response, next: NextFunction) => {
    // Handlers below perform resource checks as well. Page announcements with a
    // document token catch another authenticated browser/device, beyond BroadcastChannel.
    void (async () => {
      if (examIntegrityEnabled && !request.path.startsWith("/exam-integrity") && request.get("X-Exam-Tab")) {
        const user = learnerOf(request);
        const tabId = requireExamTab(request.get("X-Exam-Tab"));
        await duoService?.observeRoomDocument(user, tabId);
        await guard.observe(user, tabId);
      }
    })().then(() => next(), next);
  });
  duoService?.registerRoutes(app, examIntegrityEnabled ? {
    beforeStart: request => { requireExamTab(request.get("X-Exam-Tab")); },
    opened: (user, assessmentId, request) => armExam(user, "assessment", assessmentId, request.get("X-Exam-Tab")),
    check: async (user, assessmentId) => { await guard.inspectResource(user, "assessment", assessmentId); },
  } : undefined);

  async function resolveExamTarget(user: import("./storage").UserRecord, kind: import("../shared/exam-integrity").ExamIntegrityKind, id: string): Promise<ExamTarget> {
    if (kind === "attempt") {
      const row = await database.attempts.findOne({ _id: id, userId: user.id });
      if (!row) throw new ApiError(404, "Không tìm thấy lượt của bạn.");
      if (row.duoAssessmentId) return resolveExamTarget(user, "assessment", row.duoAssessmentId);
      return { kind, resourceId: id, finished: row.status === "submitted" || row.mode === "practice" };
    }
    if (kind === "placement") {
      const row = await database.placements.findOne({ _id: id, userId: user.id });
      if (!row) throw new ApiError(404, "Không tìm thấy bài đầu vào của bạn.");
      return { kind, resourceId: id, finished: Boolean(row.result && !row.currentQuestionId && row.completionReason !== "invalidated") };
    }
    const row = await database.db.collection<{ _id: string; userId: string; active: boolean; invalidatedAt?: string; parts: { attemptId: string | null }[] }>("duo_assessments").findOne({ _id: id, userId: user.id });
    if (!row) throw new ApiError(404, "Không tìm thấy bài đánh giá của bạn.");
    const attempts = row.parts.map(part => part.attemptId).filter((value): value is string => Boolean(value));
    const allSubmitted = attempts.length === row.parts.length && await database.attempts.countDocuments({ _id: { $in: attempts }, userId: user.id, status: "submitted" }) === attempts.length;
    return { kind, resourceId: id, finished: !row.invalidatedAt && (!row.active || allSubmitted) };
  }
  async function eraseInvalidatedAudio(userId: string, attemptId: string): Promise<void> {
    const audio = await database.audio.findOneAndDelete({ userId, attemptId });
    if (audio) await deleteOwnedRecording(userId, attemptId, audio.fileId);
  }
  async function resetExamTarget(user: import("./storage").UserRecord, target: ExamTarget, reason: import("../shared/exam-integrity").ExamIntegrityReason): Promise<ExamResetResult> {
    const at = new Date(clockNow()).toISOString();
    if (target.kind === "assessment") {
      if (!duoService) throw new ApiError(404, "Lộ trình Duo chưa bật.");
      const result = await duoService.invalidateIntegrity(user, target.resourceId, reason);
      const attempts = await database.attempts.find({ _id: { $in: result.attemptIds }, status: "invalidated" }).toArray();
      for (const attempt of attempts) await eraseInvalidatedAudio(attempt.userId, attempt.id);
      const rows = await database.db.collection<{ _id: string; userId: string }>("duo_assessments").find({ _id: { $in: result.assessmentIds } }).toArray();
      return { affected: rows.map(row => ({ kind: "assessment", resourceId: row._id, userId: row.userId })) };
    }
    if (target.kind === "placement") {
      const row = await database.placements.findOne({ _id: target.resourceId, userId: user.id });
      if (!row) throw new ApiError(404, "Không tìm thấy bài đầu vào của bạn.");
      if (row.completionReason !== "invalidated") await database.placements.updateOne({ _id: row._id, userId: user.id }, { $set: {
        invalidatedAt: at, integrityReason: reason, completionReason: "invalidated", currentQuestionId: null,
        invalidatedQuestionIds: [...new Set([...row.answers.map(answer => answer.questionId), ...(row.currentQuestionId ? [row.currentQuestionId] : [])])],
        answers: [], draftAnswer: null, result: null, theta: 0, standardError: 1.5, estimatedBand: 5,
        integrity: { ...row.integrity, status: "invalidated", reason },
      } });
      return {};
    }
    const previous = await database.attempts.findOne({ _id: target.resourceId, userId: user.id });
    if (!previous) throw new ApiError(404, "Không tìm thấy lượt của bạn.");
    await database.attempts.updateOne({ _id: previous.id, userId: user.id }, { $set: {
      status: "invalidated", invalidatedAt: previous.invalidatedAt ?? at, integrityReason: reason,
      responses: {}, essays: {}, transcript: "", feedback: null, submittedAt: null, durationSeconds: 0,
      integrity: { ...previous.integrity, status: "invalidated", reason },
    }, $unset: { submissionLease: "", listeningPlayed: "" } });
    await eraseInvalidatedAudio(user.id, previous.id);
    if (previous.replacementContentId) return { replacementResourceId: previous.replacementContentId };
    const source = await database.content.findOne({ _id: previous.contentId });
    if (!source) return {};
    const rootId = previous.rootContentId ?? source.id;
    const old = await database.attempts.find({ userId: user.id, $or: [{ rootContentId: rootId }, { contentId: rootId }], status: "invalidated" }).toArray();
    const materials = await database.content.find({ _id: { $in: old.map(row => row.contentId) } }).toArray();
    try {
      const replacement = await createExamReplacement(database, source, materials.flatMap(examReplacementSourceIds));
      await database.content.insertOne(replacement);
      const published = await database.attempts.updateOne({ _id: previous.id, userId: user.id, replacementContentId: { $exists: false } },
        { $set: { replacementContentId: replacement.id, "integrity.replacementResourceId": replacement.id } });
      if (!published.modifiedCount) {
        await database.content.deleteOne({ _id: replacement.id });
        const winner = await database.attempts.findOne({ _id: previous.id, userId: user.id });
        return { replacementResourceId: winner?.replacementContentId };
      }
      return { replacementResourceId: replacement.id };
    } catch (error) {
      // A genuinely exhausted source pool must not silently replay the old set.
      if (error instanceof ExamReplacementUnavailableError) return {};
      throw error;
    }
  }
  const integrityInput = z.object({ kind: z.enum(["attempt", "placement", "assessment"]), resourceId: z.string().min(1).max(180), tabId: z.string().min(8).max(80) });
  app.post("/api/exam-integrity/open", asyncRoute(async (request, response) => {
    const input = integrityInput.parse(request.body);
    let session = examIntegrityEnabled ? await guard.open(learnerOf(request), input.kind, input.resourceId, input.tabId) : null;
    if (session) {
      await duoService?.observeRoomDocument(learnerOf(request), input.tabId);
      if (session.id) session = await guard.current(learnerOf(request), session.id);
    }
    if (session?.status === "active") {
      const integrity = { sessionId: session.id, status: session.status, phase: session.phase };
      if (input.kind === "attempt") await database.attempts.updateOne({ _id: input.resourceId, userId: learnerOf(request).id, status: "in-progress" }, { $set: { integrity } });
      if (input.kind === "placement") await database.placements.updateOne({ _id: input.resourceId, userId: learnerOf(request).id, currentQuestionId: { $ne: null } }, { $set: { integrity } });
    }
    response.json({ enabled: examIntegrityEnabled, session });
  }));
  app.get("/api/exam-integrity/:id", asyncRoute(async (request, response) => {
    response.json({ enabled: examIntegrityEnabled, session: examIntegrityEnabled ? await guard.current(learnerOf(request), idOf(request)) : null });
  }));
  app.post("/api/exam-integrity/:id/heartbeat", asyncRoute(async (request, response) => {
    const input = z.object({ tabId: z.string().min(8).max(80) }).parse(request.body);
    if (examIntegrityEnabled) {
      // Check ownership before a room-level document observation can mutate it.
      await guard.current(learnerOf(request), idOf(request));
      await duoService?.observeRoomDocument(learnerOf(request), requireExamTab(input.tabId));
    }
    response.json({ enabled: examIntegrityEnabled, session: examIntegrityEnabled ? await guard.heartbeat(learnerOf(request), idOf(request), input.tabId) : null });
  }));
  app.post("/api/exam-integrity/:id/violation", asyncRoute(async (request, response) => {
    const input = z.object({ tabId: z.string().min(8).max(80), reason: z.enum(["hidden", "page-exit", "duplicate-tab", "navigation", "heartbeat-lost"]) }).parse(request.body);
    response.json({ enabled: examIntegrityEnabled, session: examIntegrityEnabled ? await guard.violation(learnerOf(request), idOf(request), input.tabId, input.reason) : null });
  }));
  async function assertExamRequest(request: Request, kind: import("../shared/exam-integrity").ExamIntegrityKind, resourceId: string): Promise<void> {
    if (kind === "attempt") {
      const attempt = await database.attempts.findOne({ _id: resourceId, userId: learnerOf(request).id });
      if (!attempt) throw new ApiError(404, "Không tìm thấy lượt của bạn.");
      if (attempt.mode === "practice" && !attempt.duoAssessmentId) return;
    }
    if (examIntegrityEnabled) await guard.assert(learnerOf(request), kind, resourceId, requireExamTab(request.get("X-Exam-Tab")));
  }
  async function armExam(user: import("./storage").UserRecord, kind: import("../shared/exam-integrity").ExamIntegrityKind, resourceId: string, tabId: string | undefined): Promise<void> {
    if (!examIntegrityEnabled) return;
    if (kind === "attempt") {
      const attempt = await database.attempts.findOne({ _id: resourceId, userId: user.id });
      if (attempt?.mode === "practice" && !attempt.duoAssessmentId) return;
    }
    const session = await guard.open(user, kind, resourceId, requireExamTab(tabId));
    if (session.status === "invalidated") throw new ApiError(409, "Đã phát hiện cửa sổ khác; lượt này đã bị hủy.");
    const integrity = { sessionId: session.id, status: session.status, phase: session.phase, ...(session.reason ? { reason: session.reason } : {}) };
    if (kind === "attempt") await database.attempts.updateOne({ _id: resourceId, userId: user.id, status: "in-progress" }, { $set: { integrity } });
    else if (kind === "placement") await database.placements.updateOne({ _id: resourceId, userId: user.id, currentQuestionId: { $ne: null } }, { $set: { integrity } });
  }

  async function contentOf(contentId: string, timeoutMS?: number): Promise<StoredContent> {
    const content = await database.content.findOne({ _id: contentId }, { timeoutMS });
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
    if (latest.status === "invalidated") throw new ApiError(409, "Lượt đã bị hủy; không thể nộp bài.");
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
    // Pin provenance to the exact recording being evaluated. A later upload
    // must never inherit recognition text from an older file.
    let recognitionRecording: AudioRecord | null = null;
    const retainRecognizedTranscript = async () => {
      if (!detectedTranscript || !recognitionRecording) return;
      const current = await database.attempts.findOne({ _id: record.id, userId: record.userId, status: "in-progress", "submissionLease.token": leaseToken,
        "submissionLease.expiresAt": { $gt: new Date(clockNow()).toISOString() } });
      if (!current || current.invalidatedAt) return;
      await database.audio.updateOne({
        _id: recognitionRecording._id, userId: record.userId, attemptId: record.id,
        fileId: recognitionRecording.fileId,
      }, { $set: { recognizedTranscript: detectedTranscript } });
    };
    try {
      recognitionRecording = record.skill === "speaking"
        ? await database.audio.findOne({ userId: record.userId, attemptId: record.id }) : null;
      if (heldLeaseToken) {
        if ((latest as LeasedAttempt).submissionLease?.token !== heldLeaseToken)
          throw new ApiError(409, "Phiên lưu bài đã thay đổi. Hãy tải lại.");
      } else {
        latest = await claimAttemptLease(latest);
        leaseToken = (latest as LeasedAttempt).submissionLease!.token;
      }
      const submittingUser = examIntegrityEnabled && (latest.mode === "exam" || latest.duoAssessmentId) ? await database.users.findOne({ _id: latest.userId }) : null;
      if (submittingUser) {
        const state = await guard.inspectResource(submittingUser, "attempt", latest.id);
        if (!state || state.status === "invalidated") throw new ApiError(409, "Lượt đã bị hủy trước khi nộp.");
        const finalPart = !latest.duoAssessmentId || await finalAssessmentPartAccepted(latest);
        if (finalPart) await guard.grading(submittingUser, "attempt", latest.id, true);
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
                  async (event) => {
                    if (event.transcript) {
                      detectedTranscript = event.transcript;
                      await retainRecognizedTranscript();
                    }
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
      await retainRecognizedTranscript();
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
      if (submittingUser) await guard.inspectResource(submittingUser, "attempt", updated.id);
      return updated;
    } catch (error) {
      await retainRecognizedTranscript();
      if (detectedTranscript)
        await database.attempts.updateOne(
          { ...sourceFilter(latest), "submissionLease.token": leaseToken },
          { $set: { transcript: detectedTranscript } },
        );
      throw error;
    } finally {
      if (examIntegrityEnabled && (record.mode === "exam" || record.duoAssessmentId)) {
        const user = await database.users.findOne({ _id: record.userId });
        const current = await database.attempts.findOne({ _id: record.id, userId: record.userId });
        if (user && current?.status === "in-progress") await guard.grading(user, "attempt", record.id, false);
      }
      if (!heldLeaseToken) {
        try { if (leaseToken) await releaseAttemptLease(latest, leaseToken); }
        finally { submissionLocks.delete(lockKey); }
      }
    }
  }
  async function finalAssessmentPartAccepted(record: AttemptRecord): Promise<boolean> {
    if (!record.duoAssessmentId) return true;
    const row = await database.db.collection<{ _id: string; userId: string; parts: { attemptId: string | null }[] }>("duo_assessments").findOne({ _id: record.duoAssessmentId, userId: record.userId });
    if (!row || row.parts.some(part => !part.attemptId)) return false;
    const others = row.parts.map(part => part.attemptId).filter((id): id is string => Boolean(id) && id !== record.id);
    return await database.attempts.countDocuments({ _id: { $in: others }, userId: record.userId, status: "submitted" }) === others.length;
  }
  async function attemptOf(
    userId: string,
    id: string,
    expire = true,
  ): Promise<AttemptRecord> {
    let record = await database.attempts.findOne({ _id: id, userId });
    if (!record) throw new ApiError(404, "Không tìm thấy lượt luyện của bạn.");
    if (examIntegrityEnabled && (record.mode === "exam" || record.duoAssessmentId) && record.status === "in-progress") {
      const user = await database.users.findOne({ _id: userId });
      if (user) await guard.inspectResource(user, "attempt", id);
      record = await database.attempts.findOne({ _id: id, userId }) ?? record;
    }
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
    const user = examIntegrityEnabled && (record.mode === "exam" || record.duoAssessmentId) ? await database.users.findOne({ _id: record.userId }) : null;
    const session = user ? await guard.inspectResource(user, "attempt", record.id) : null;
    if (session?.status === "invalidated") record = await database.attempts.findOne({ _id: record.id, userId: record.userId }) ?? record;
    const {
      _id: _id,
      userId: _userId,
      listeningPlayed: _listeningPlayed,
      submissionLease: _submissionLease,
      invalidatedAt: _invalidatedAt,
      integrityReason: _integrityReason,
      replacementContentId: _replacementContentId,
      rootContentId: _rootContentId,
      speakingPromptSnapshot: _speakingPromptSnapshot,
      speakingReview: _speakingReview,
      ...view
    } = record as LeasedAttempt;
    const recording = await database.audio.findOne({ userId: record.userId, attemptId: record.id });
    const audioAvailable = Boolean(recording);
    const content = await contentOf(record.contentId);
    return {
      ...view,
      ...(session ? { integrity: { sessionId: session.id, status: session.status, phase: session.phase, ...(session.reason ? { reason: session.reason } : {}), ...(session.replacementResourceId ? { replacementResourceId: session.replacementResourceId } : {}) } } : {}),
      feedback: completedAttemptFeedback(record, content),
      content: sanitizeContent(
        content,
        record.status === "invalidated" || record.mode === "exam" && record.status !== "submitted",
      ),
      audioAvailable,
      ...(record.status === "submitted" && record.skill === "speaking" ? {
        speakingReview: {
          version: 1 as const,
          prompts: record.speakingPromptSnapshot ?? content.sections.map(section => ({
            sectionId: section.id, title: section.title, text: section.text,
            ...(section.cuePoints ? { cuePoints: section.cuePoints } : {}),
            ...(section.instructions ? { instructions: section.instructions } : {}),
          })),
          promptSource: record.speakingPromptSnapshot ? "saved-authored-prompt" as const : "current-authored-prompt" as const,
          transcriptSource: recording?.recognizedTranscript ? "speech-recognition" as const : record.feedback?.transcriptSource ?? "unknown" as const,
          transcript: recording?.recognizedTranscript ?? record.feedback?.transcript ?? record.transcript,
          ...(recording?.recognizedTranscript ? { recognizedTranscript: recording.recognizedTranscript } : {}),
          recordingAvailable: audioAvailable,
        },
      } : {}),
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
      const mode = z.enum(["practice", "exam"]).default("practice").parse(request.query.mode);
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
          .find(filter, { timeoutMS: LIBRARY_READ_TIMEOUT_MS, timeoutMode: "cursorLifetime" })
          .sort({ band: 1, title: 1 })
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .toArray(),
        database.content.countDocuments(filter, { timeoutMS: LIBRARY_READ_TIMEOUT_MS }),
        database.content.distinct("topic", {}, { timeoutMS: LIBRARY_READ_TIMEOUT_MS }),
      ]);
      const progress = await contentProgress(database, learnerOf(request).id, mode, items.map(item => item.id), LIBRARY_READ_TIMEOUT_MS);
      response.set("Cache-Control", "private, no-store").json({
        items: items.map((content) => sanitizeContent(content, true)),
        total,
        topics: topics.sort(),
        progress,
      });
    }),
  );
  app.get(
    "/api/content/:id/progress",
    asyncRoute(async (request, response) => {
      const mode = z.enum(["practice", "exam"]).default("practice").parse(request.query.mode);
      const content = await contentOf(idOf(request), LIBRARY_READ_TIMEOUT_MS);
      const progress = await contentProgress(database, learnerOf(request).id, mode, [content.id], LIBRARY_READ_TIMEOUT_MS);
      response.set("Cache-Control", "private, no-store").json({ progress: progress[content.id] });
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
  app.get(
    "/api/content/:id/listening-audio/readiness",
    asyncRoute(async (request, response) => {
      const mode = z.enum(["practice", "exam"]).parse(request.query.mode || "practice");
      let content = await contentOf(idOf(request), LIBRARY_READ_TIMEOUT_MS);
      const previous = await database.attempts.findOne({
        userId: learnerOf(request).id, mode, status: "invalidated",
        $or: [{ rootContentId: content.id }, { contentId: content.id }],
      }, { sort: { startedAt: -1 }, timeoutMS: LIBRARY_READ_TIMEOUT_MS });
      if (previous?.replacementContentId) content = await contentOf(previous.replacementContentId, LIBRARY_READ_TIMEOUT_MS);
      const audio = await speechAudio.readiness(content.skill === "listening" ? content.sections : []);
      response.set("Cache-Control", "private, no-store").json({ audio });
    }),
  );
  app.get(
    "/api/listening-audio/status",
    asyncRoute(async (request, response) => {
      learnerOf(request);
      response.set("Cache-Control", "private, no-store").json({ audio: await readSpeechPrewarmStatus(database.db) });
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
      if (exam) await assertExamRequest(request, "attempt", exam.id);
      const result = await speechAudio.getReady(content.sections);
      if (response.destroyed || response.writableEnded) return;
      if (exam) {
        await assertExamRequest(request, "attempt", exam.id);
        const claimed = await database.attempts.updateOne(
          {
            _id: exam.id,
            userId,
            status: "in-progress",
            listeningPlayed: { $ne: true },
            $or: [{ deadlineAt: null }, { deadlineAt: { $gt: new Date(clockNow()).toISOString() } }],
          },
          { $set: { listeningPlayed: true } },
        );
        if (!claimed.modifiedCount)
          throw new ApiError(
            409,
            "Bản nghe đã phát hoặc trạng thái bài đã thay đổi.",
          );
        if (response.destroyed) {
          await database.attempts.updateOne({ _id: exam.id, userId, status: "in-progress", listeningPlayed: true }, { $unset: { listeningPlayed: "" } });
          return;
        }
      }
      sendSpeechAudio(response, result);
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
      if (examIntegrityEnabled && (input.mode === "exam" || input.duoAssessmentId)) requireExamTab(request.get("X-Exam-Tab"));
      let content = await contentOf(input.contentId);
      const user = learnerOf(request);
      const requestedId = content.id;
      let rootContentId = requestedId;
      if (!input.duoAssessmentId) {
        const invalidated = await database.attempts.findOne({ userId: user.id, mode: input.mode, status: "invalidated",
          $or: [{ rootContentId: requestedId }, { contentId: requestedId }] }, { sort: { startedAt: -1 } });
        if (invalidated) {
          if (!invalidated.replacementContentId) throw new ApiError(409, "Ngân hàng chưa có bộ đề tương đương chưa dùng. Hãy chọn bài khác; lượt cũ vẫn bị hủy.");
          content = await contentOf(invalidated.replacementContentId);
          rootContentId = invalidated.rootContentId ?? invalidated.contentId;
        } else {
          const predecessor = await database.attempts.findOne({ userId: user.id, replacementContentId: requestedId });
          rootContentId = predecessor?.rootContentId ?? predecessor?.contentId ?? requestedId;
        }
      }
      if (input.duoAssessmentId && !duoService) throw new ApiError(403, "Lộ trình Duo chưa được bật.");
      await requireReadyListening([content]);
      const protectedContext = duoService ? await duoService.beforeAttempt(user, input) : {};
      if (protectedContext.existingAttemptId) {
        const bound = await database.attempts.findOne({ _id: protectedContext.existingAttemptId, userId: user.id, duoAssessmentId: input.duoAssessmentId, contentId: content.id });
        if (!bound) throw new ApiError(409, "Lượt thi Duo đã liên kết chưa sẵn sàng; hãy tải lại phòng thi.");
        await armExam(user, "attempt", bound.id, request.get("X-Exam-Tab"));
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
        await armExam(user, "attempt", existing.id, request.get("X-Exam-Tab"));
        response.json({ attempt: await attemptView(await attemptOf(user.id, existing.id)) });
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
        rootContentId,
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
        ...(content.skill === "speaking" ? { speakingPromptSnapshot: content.sections.map(section => ({
          sectionId: section.id, title: section.title, text: section.text,
          ...(section.cuePoints ? { cuePoints: section.cuePoints } : {}),
          ...(section.instructions ? { instructions: section.instructions } : {}),
        })) } : {}),
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
        await armExam(user, "attempt", concurrent.id, request.get("X-Exam-Tab"));
        response.json({ attempt: await attemptView(await attemptOf(user.id, concurrent.id)) });
        return;
      }
      await duoService?.bindAttempt(user, record.id, input.duoAssessmentId);
      await armExam(user, "attempt", record.id, request.get("X-Exam-Tab"));
      response.status(201).json({ attempt: await attemptView(await attemptOf(user.id, record.id)) });
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
      await assertExamRequest(request, "attempt", idOf(request));
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
      await assertExamRequest(request, "attempt", idOf(request));
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
          "Giọng đọc tiếng Anh trên thiết bị; nhân vật dùng giọng khác nhau khi thiết bị có đủ giọng.",
      });
    }),
  );
  app.post(
    "/api/attempts/:id/listening-audio",
    asyncRoute(async (request, response) => {
      const id = idOf(request), userId = learnerOf(request).id;
      await assertExamRequest(request, "attempt", id);
      let record = await attemptOf(userId, id);
      if (record.skill !== "listening") throw new ApiError(400, "Đây không phải bài Listening.");
      if (record.status !== "in-progress") throw new ApiError(409, "Lượt nghe này không còn đang làm.");
      if (record.mode === "exam" && record.listeningPlayed)
        throw new ApiError(409, "Exam chỉ phát bản nghe một lần. Chọn Practice để nghe lại.");
      const content = await contentOf(record.contentId);
      const audio = await speechAudio.getReady(content.sections);
      if (response.destroyed || response.writableEnded) return;
      // A slow generator may finish after a tab violation, deadline or submit.
      // Cache generic authored audio, but never revive or mutate that sitting.
      await assertExamRequest(request, "attempt", id);
      record = await attemptOf(userId, id);
      if (record.status !== "in-progress") throw new ApiError(409, "Lượt nghe đã kết thúc hoặc bị hủy.");
      if (record.mode === "exam") {
        const claimed = await database.attempts.updateOne({
          _id: id, userId, status: "in-progress", listeningPlayed: { $ne: true },
          $or: [{ deadlineAt: null }, { deadlineAt: { $gt: new Date(clockNow()).toISOString() } }],
        }, { $set: { listeningPlayed: true } });
        if (!claimed.modifiedCount) throw new ApiError(409, "Bản nghe đã phát hoặc lượt thi đã kết thúc.");
        if (response.destroyed) {
          await database.attempts.updateOne({ _id: id, userId, status: "in-progress", listeningPlayed: true }, { $unset: { listeningPlayed: "" } });
          return;
        }
      }
      sendSpeechAudio(response, audio);
    }),
  );
  function reviewSection(request: Request, count: number): number | undefined {
    const supplied = request.method === "GET" ? request.query.sectionIndex : request.body?.sectionIndex;
    if (supplied === undefined) return undefined;
    const value = z.union([
      z.number().int().min(0),
      z.string().regex(/^\d{1,3}$/).transform(Number),
    ]).parse(supplied);
    if (value >= count) throw new ApiError(400, "Không tìm thấy phần nghe này trong bài đã nộp.");
    return value;
  }
  async function sendReviewedListeningAudio(request: Request, response: Response): Promise<void> {
    const id = idOf(request), userId = learnerOf(request).id;
    const record = await database.attempts.findOne({ _id: id, userId });
    if (!record) throw new ApiError(404, "Không tìm thấy lượt luyện của bạn.");
    await inspectAudioSource(request, "attempt", id);
    if (record.status !== "submitted" || record.invalidatedAt) throw new ApiError(409, "Chỉ nghe lại cùng transcript sau khi đã nộp bài hợp lệ.");
    if (record.skill !== "listening") throw new ApiError(400, "Đây không phải bài Listening.");
    const content = await contentOf(record.contentId);
    const sectionIndex = reviewSection(request, content.sections.length);
    // This method only reads published GridFS files. Review never queues TTS,
    // consumes the exam's play allowance, or changes its deadline/session.
    const audio = await speechAudio.getReady(sectionIndex === undefined ? content.sections : [content.sections[sectionIndex]]);
    await inspectAudioSource(request, "attempt", id);
    const latest = await database.attempts.findOne({ _id: id, userId, status: "submitted", invalidatedAt: { $exists: false } });
    if (!latest) throw new ApiError(409, "Bài đã thay đổi; không thể mở âm thanh xem lại.");
    if (!response.destroyed && !response.writableEnded) sendSpeechAudio(response, audio, request.get("range"));
  }
  app.get("/api/attempts/:id/listening-audio", asyncRoute(sendReviewedListeningAudio));
  app.post(
    "/api/attempts/:id/submit",
    asyncRoute(async (request, response) => {
      await assertExamRequest(request, "attempt", idOf(request));
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
      await inspectAudioSource(request, "attempt", record.id);
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
        let audioRecord: AudioRecord | null = null;
        if (record.skill === "speaking") {
          const saved = await database.audio.findOne({ userId: record.userId, attemptId: record.id });
          audioRecord = saved;
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
        const evaluated = record.skill === "writing" ? await evaluateWriting(content, record.essays) : await evaluateSpeaking(content, record.transcript, audio, async event => {
          if (!event.transcript || !audioRecord) return;
          await inspectAudioSource(request, "attempt", record.id);
          const stillValid = await database.attempts.findOne({ _id: record.id, userId: record.userId, status: "submitted", invalidatedAt: { $exists: false }, "feedback.id": record.feedback?.id ?? null });
          if (!stillValid) throw new ApiError(409, "Bài đã thay đổi trong khi nhận dạng; chưa áp dụng transcript.");
          await database.audio.updateOne({ _id: audioRecord._id, userId: record.userId, attemptId: record.id, fileId: audioRecord.fileId }, { $set: { recognizedTranscript: event.transcript } });
        });
        const feedback: Feedback = { ...evaluated, ...(content.referenceAnswers?.length ? { referenceAnswers: content.referenceAnswers } : {}) };
        await inspectAudioSource(request, "attempt", record.id);
        const updated = await database.attempts.findOneAndUpdate(
          { _id: record.id, userId: record.userId, status: "submitted", invalidatedAt: { $exists: false }, "feedback.id": record.feedback?.id ?? null },
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
      await assertExamRequest(request, "attempt", idOf(request));
      const userId = learnerOf(request).id;
      const attemptId = idOf(request);
      const lockKey = `${userId}:${attemptId}`;
      if (submissionLocks.has(lockKey)) throw new ApiError(409, "Bản nói đang được lưu/chấm; hãy đợi kết quả.");
      submissionLocks.add(lockKey);
      let leaseToken: string | undefined;
      let record: AttemptRecord | undefined;
      try {
        record = await attemptOf(userId, attemptId, false);
        if (record.status === "invalidated") throw new ApiError(409, "Lượt đã bị hủy; hãy làm bộ đề mới.");
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
                { $set: metadata, $unset: { recognizedTranscript: "" } },
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
            const stillOwned = await database.attempts.findOne({ _id: record.id, userId: record.userId, status: "in-progress", "submissionLease.token": leaseToken });
            if (!stillOwned) {
              await eraseInvalidatedAudio(record.userId, record.id);
              throw new ApiError(409, "Lượt đã bị hủy trong khi tải bản nói.");
            }
          } catch (error) {
            await deleteOwnedRecording(record.userId, record.id, stream.id);
            throw error;
          }
        }
        const promptContent = record.speakingPromptSnapshot ? null : await contentOf(record.contentId);
        const saved = await database.attempts.findOneAndUpdate(
          { ...sourceFilter(record), "submissionLease.token": leaseToken },
          { $set: { transcript, ...(promptContent ? { speakingPromptSnapshot: promptContent.sections.map(section => ({
            sectionId: section.id, title: section.title, text: section.text,
            ...(section.cuePoints ? { cuePoints: section.cuePoints } : {}),
            ...(section.instructions ? { instructions: section.instructions } : {}),
          })) } : {}) } },
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
      const userId = learnerOf(request).id, attemptId = idOf(request);
      let attempt = await attemptOf(userId, attemptId, false);
      if (attempt.status === "invalidated") throw new ApiError(404, "Bản nói của lượt bị hủy đã được xóa.");
      await inspectAudioSource(request, "attempt", attemptId);
      attempt = await attemptOf(userId, attemptId, false);
      if (attempt.status === "invalidated" || attempt.invalidatedAt) throw new ApiError(404, "Bản nói của lượt bị hủy đã được xóa.");
      const audio = await database.audio.findOne({
        userId,
        attemptId,
      });
      if (!audio) throw new ApiError(404, "Lượt luyện chưa có bản ghi âm.");
      const storedFile = await database.db
        .collection("recordings.files")
        .findOne({
          _id: audio.fileId,
          "metadata.userId": userId,
          "metadata.attemptId": attemptId,
        });
      if (!storedFile || typeof storedFile.length !== "number" || !Number.isSafeInteger(storedFile.length) || storedFile.length < 0 || storedFile.length > 25 * 1024 * 1024)
        throw new ApiError(404, "Bản ghi âm chưa sẵn sàng.");
      await inspectAudioSource(request, "attempt", attemptId);
      const latest = await database.attempts.findOne({ _id: attemptId, userId });
      const currentAudio = await database.audio.findOne({ _id: audio._id, userId, attemptId, fileId: audio.fileId });
      if (!latest || latest.status === "invalidated" || latest.invalidatedAt || !currentAudio)
        throw new ApiError(404, "Bản ghi âm đã thay đổi hoặc không còn sẵn sàng.");
      const range = setAudioRange(response, request.get("range"), storedFile.length);
      if (range === false) return;
      response.type(audio.mime);
      if (request.method === "HEAD") { response.end(); return; }
      await pipeline(
        database.recordings.openDownloadStream(audio.fileId, { start: range.start, end: range.end + 1, timeoutMS: 20_000 }),
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
  registerWordNotebookRoutes(app, database, {
    now: clockNow,
    inspectSource: async (request, kind, id) => {
      if (!examIntegrityEnabled) return;
      const user = learnerOf(request);
      const session = await guard.inspectResource(user, kind, id);
      // A submitted intermediate Duo part can still belong to an active
      // monitored sitting. Completed independent reviews need no tab lease.
      if (session?.status === "active")
        await guard.assert(user, kind, id, requireExamTab(request.get("X-Exam-Tab")));
    },
    assertActiveRequest: (request, kind, id) => assertExamRequest(request, kind, id),
    translation: config.wordTranslation,
    pronunciation: config.wordPronunciation,
  });
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
      const bankIpa = validIpa(vocabulary?.ipa);
      const resolveExisting = async (card: CardRecord): Promise<CardRecord> => {
        // Adding an explicit definition in the notebook can complete a word
        // captured during a paper. Keep its scheduling and review history.
        if (card.meaningStatus !== "pending") return card;
        return await database.cards.findOneAndUpdate(
          { _id: card.id, userId, meaningStatus: "pending" },
          {
            $set: {
              meaning, meaningStatus: "ready",
              ...(bankIpa ? { ipa: bankIpa, ipaSource: "bank" as const } : {}),
              ...(vocabulary ? { vocabularyId: vocabulary.id, cefr: vocabulary.cefr,
                topic: vocabulary.topic, definition: vocabulary.definition,
                partOfSpeech: vocabulary.partOfSpeech } : {}),
            },
            $unset: { translationSource: "", translationContext: "" },
          },
          { returnDocument: "after" },
        ) ?? await database.cards.findOne({ _id: card.id, userId }) ?? card;
      };
      const existing = await database.cards.findOne({ userId, word });
      if (existing) {
        response.json({ card: cardOf(await resolveExisting(existing)) });
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
        ...(bankIpa ? { ipa: bankIpa, ipaSource: "bank" as const } : {}),
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
        response.json({ card: cardOf(await resolveExisting(duplicate)) });
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
      if (card.meaningStatus === "pending")
        throw new ApiError(409, "Từ này chưa có nghĩa. Hãy dịch khi xem lại bài đã nộp trước khi ôn thẻ.");
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
    record = await settlePlacement(record);
    const user = examIntegrityEnabled ? await database.users.findOne({ _id: record.userId }) : null;
    const session = user ? await guard.inspectResource(user, "placement", record._id) : null;
    if (session?.status === "invalidated") record = await database.placements.findOne({ _id: record._id, userId: record.userId }) ?? record;
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
      deadlineAt: record.deadlineAt,
      serverNow: new Date(clockNow()).toISOString(),
      suggestedQuestionSeconds: item ? suggestedPlacementSeconds(item) : undefined,
      draftAnswer: item && record.draftAnswer?.questionId === item.id ? record.draftAnswer.answer : "",
      completionReason: record.completionReason,
      integrity: session ? { sessionId: session.id, status: session.status, phase: session.phase, ...(session.reason ? { reason: session.reason } : {}) } : record.integrity,
    };
  }
  function placementIsComplete(record: PlacementRecord): boolean {
    return record.currentQuestionId === null && record.result !== null &&
      (record.answers.length >= record.total || record.completionReason === "deadline");
  }
  async function withPlacementCompletion<T>(record: PlacementRecord, persist: () => Promise<T>): Promise<T> {
    const user = examIntegrityEnabled ? await database.users.findOne({ _id: record.userId }) : null;
    const session = user ? await guard.inspectResource(user, "placement", record._id) : null;
    // Claim completion before publishing either the result or the learner band.
    // A cancellation that already read the answering phase must lose its CAS;
    // a cancellation that won first prevents this claim and all result writes.
    // Legacy placements without a guard retain their original deadline handling.
    if (user && session) await guard.grading(user, "placement", record._id, true);
    try {
      return await persist();
    } finally {
      if (user && session) {
        const latest = await database.placements.findOne({ _id: record._id, userId: record.userId });
        if (latest?.currentQuestionId) await guard.grading(user, "placement", record._id, false);
        else await guard.inspectResource(user, "placement", record._id);
      }
    }
  }
  async function settlePlacement(record: PlacementRecord): Promise<PlacementRecord> {
    if (examIntegrityEnabled && record.currentQuestionId) {
      const user = await database.users.findOne({ _id: record.userId });
      if (user) await guard.inspectResource(user, "placement", record._id);
      record = await database.placements.findOne({ _id: record._id, userId: record.userId }) ?? record;
    }
    if (!record.currentQuestionId || placementIsComplete(record)) return record;
    if (!record.deadlineAt) {
      // Legacy active tests start a single remaining-time allowance on resume;
      // the updater itself never changes a learner's placement documents.
      const remaining = Math.max(120, Math.ceil(placementDurationSeconds(record.mode) *
        (record.total - record.answers.length) / record.total));
      const timed = await database.placements.findOneAndUpdate({
        _id: record._id, userId: record.userId, deadlineAt: { $exists: false }, currentQuestionId: { $ne: null },
      }, { $set: { deadlineAt: new Date(clockNow() + remaining * 1000).toISOString() } }, { returnDocument: "after" });
      record = timed ?? await database.placements.findOne({ _id: record._id, userId: record.userId }) ?? record;
    }
    if (!record.deadlineAt || Date.parse(record.deadlineAt) > clockNow() || !record.currentQuestionId) return record;
    const item = await database.placementItems.findOne({ _id: record.currentQuestionId });
    const answers = [...record.answers];
    if (item) {
      const draft = record.draftAnswer?.questionId === item.id && item.options.includes(record.draftAnswer.answer)
        ? record.draftAnswer.answer : "";
      answers.push({ questionId: item.id, answer: draft, correct: draft === item.answer,
        review: placementAnswerReview(item, draft, answers.length + 1) });
    }
    const items = await database.placementItems.find({ _id: { $in: answers.map(answer => answer.questionId) } }).toArray();
    const estimate = estimatePlacement(answers.map(answer => ({ correct: answer.correct,
      difficulty: items.find(item => item.id === answer.questionId)?.difficulty ?? 0 })));
    const feedback = placementFeedback({ ...estimate, correct: answers.filter(answer => answer.correct).length,
      total: answers.length, answers: answers.map((answer, index) => {
        if (answer.review) return { ...answer.review, questionNumber: index + 1 };
        const source = items.find(item => item.id === answer.questionId);
        return source ? placementAnswerReview(source, answer.answer, index + 1) : {
          questionId: answer.questionId, response: answer.answer, answer: "", correct: answer.correct,
          explanation: "Câu hỏi cũ không còn trong ngân hàng.", evidence: "", subskill: "",
        };
      }) });
    const enough = answers.filter(answer => answer.answer.trim()).length >= 5;
    feedback.createdAt = new Date(clockNow()).toISOString();
    if (!enough) feedback.estimatedBand = null;
    feedback.summary = enough
      ? `Hết thời gian; bài chỉ gồm ${answers.length}/${record.total} câu đã gặp. ${feedback.summary}`
      : `Hết thời gian; đã lưu các câu đã gặp và đáp án. Bạn trả lời ít hơn 5 câu nên chưa đủ dữ liệu xác định trình độ. Hãy làm một bài mới.`;
    return withPlacementCompletion(record, async () => {
      const updated = await database.placements.findOneAndUpdate({
        _id: record._id, userId: record.userId, currentQuestionId: record.currentQuestionId,
        answers: record.answers, draftAnswer: record.draftAnswer === undefined ? { $exists: false } : record.draftAnswer,
      }, { $set: { ...estimate, answers, currentQuestionId: null, draftAnswer: null, result: feedback,
        completedAt: new Date(clockNow()).toISOString(), completionReason: "deadline" } }, { returnDocument: "after" });
      if (!updated) return settlePlacement(await database.placements.findOne({ _id: record._id, userId: record.userId }) ?? record);
      if (enough) {
        await database.users.updateOne({ _id: record.userId }, { $set: { currentBand: estimate.estimatedBand,
          personalEstimatedBand: estimate.estimatedBand, cefr: cefrForBand(estimate.estimatedBand) } });
        const user = await database.users.findOne({ _id: record.userId });
        if (user) await duoService?.placementCompleted(user, updated);
      }
      return updated;
    });
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
        const item = items.find((question) => question.id === answer.questionId);
        if (snapshot) return { ...snapshot, response: answer.answer, questionNumber: index + 1,
          ...(snapshot.skill ? {} : item ? { skill: item.skill } : snapshot.sectionTitle === "Listening" ? { skill: "listening" as const } : snapshot.sectionTitle === "Reading" ? { skill: "reading" as const } : {}) };
        if (item) return { ...placementAnswerReview(item, answer.answer, index + 1), skill: item.skill };
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
      [...record.answers.map((answer) => answer.questionId), ...(record.excludedQuestionIds ?? [])],
      theta,
    );
  }
  app.get(
    "/api/placement/active",
    asyncRoute(async (request, response) => {
      let record = await database.placements.findOne(
        { userId: learnerOf(request).id, currentQuestionId: { $ne: null } },
        { sort: { startedAt: -1 } },
      );
      if (!record && examIntegrityEnabled) {
        const latest = await database.placements.findOne({ userId: learnerOf(request).id }, { sort: { startedAt: -1 } });
        if (latest?.completionReason === "invalidated") record = latest;
      }
      response.json({ placement: record ? await placementView(record) : null });
    }),
  );
  app.get(
    "/api/placement/audio/readiness",
    asyncRoute(async (request, response) => {
      learnerOf(request);
      response.set("Cache-Control", "private, no-store").json({ audio: await placementAudioReadiness() });
    }),
  );
  app.post(
    "/api/placement/:id/audio",
    asyncRoute(async (request, response) => {
      const id = idOf(request), userId = learnerOf(request).id;
      const { questionId } = z.object({ questionId: z.string().min(1).max(200) }).parse(request.body);
      let record = await database.placements.findOne({ _id: id, userId });
      if (!record) throw new ApiError(404, "Không tìm thấy bài đầu vào của bạn.");
      await assertExamRequest(request, "placement", id);
      record = await settlePlacement(record);
      if (record.currentQuestionId !== questionId || record.completedAt || record.invalidatedAt)
        throw new ApiError(409, "Câu nghe này không còn là câu hiện tại.");
      const item = await database.placementItems.findOne({ _id: questionId });
      if (!item || item.skill !== "listening") throw new ApiError(400, "Câu hiện tại không phải bài nghe.");
      const audio = await speechAudio.getReady([{ id: item.id, title: "", text: item.text }]);
      if (response.destroyed || response.writableEnded) return;
      await assertExamRequest(request, "placement", id);
      const latest = await database.placements.findOne({ _id: id, userId });
      if (!latest) throw new ApiError(404, "Không tìm thấy bài đầu vào của bạn.");
      record = await settlePlacement(latest);
      if (record.currentQuestionId !== questionId || record.completedAt || record.invalidatedAt)
        throw new ApiError(409, "Câu nghe đã đổi hoặc bài đầu vào đã kết thúc.");
      sendSpeechAudio(response, audio);
    }),
  );
  app.get(
    "/api/placement/:id/audio",
    asyncRoute(async (request, response) => {
      const id = idOf(request), userId = learnerOf(request).id;
      const questionId = z.string().min(1).max(200).parse(request.query.questionId);
      let record = await database.placements.findOne({ _id: id, userId });
      if (!record) throw new ApiError(404, "Không tìm thấy bài đầu vào của bạn.");
      await inspectAudioSource(request, "placement", id);
      record = await database.placements.findOne({ _id: id, userId });
      if (!record || !placementIsComplete(record) || record.invalidatedAt || record.completionReason === "invalidated")
        throw new ApiError(409, "Chỉ nghe lại sau khi hoàn thành bài đầu vào hợp lệ.");
      const answer = record.answers.find(item => item.questionId === questionId);
      if (!answer) throw new ApiError(404, "Câu nghe không thuộc bài đầu vào đã làm.");
      const item = await database.placementItems.findOne({ _id: questionId });
      const snapshot = record.result?.answers.find(item => item.questionId === questionId) ?? answer.review;
      const skill = snapshot?.skill ?? (snapshot?.sectionTitle === "Listening" ? "listening" : snapshot?.sectionTitle === "Reading" ? "reading" : item?.skill);
      if (skill !== "listening") throw new ApiError(400, "Đây không phải câu Listening.");
      // Replay the source text captured at answer time, if available. A later
      // bank edit must not silently substitute a different recording.
      const text = snapshot?.context || item?.text;
      if (!text) throw new ApiError(404, "Nguồn nghe cũ không còn để đối chiếu.");
      const audio = await speechAudio.getReady([{ id: questionId, title: "", text }]);
      await inspectAudioSource(request, "placement", id);
      const latest = await database.placements.findOne({ _id: id, userId });
      if (!latest || !placementIsComplete(latest) || latest.invalidatedAt || latest.completionReason === "invalidated" || !latest.answers.some(item => item.questionId === questionId))
        throw new ApiError(409, "Bài đầu vào đã thay đổi; không thể mở âm thanh xem lại.");
      if (!response.destroyed && !response.writableEnded) sendSpeechAudio(response, audio, request.get("range"));
    }),
  );
  app.post(
    "/api/placement/start",
    asyncRoute(async (request, response) => {
      if (examIntegrityEnabled) requireExamTab(request.get("X-Exam-Tab"));
      const { mode } = z
        .object({ mode: z.enum(["quick", "deep"]).default("quick") })
        .parse(request.body);
      const audioReadiness = await placementAudioReadiness();
      if (!audioReadiness.ready) throw new ApiError(409, audioReadiness.notice);
      const userId = learnerOf(request).id;
      const existing = await database.placements.findOne(
        { userId, mode, currentQuestionId: { $ne: null } },
        { sort: { startedAt: -1 } },
      );
      if (existing) {
        await armExam(learnerOf(request), "placement", existing._id, request.get("X-Exam-Tab"));
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
        deadlineAt: new Date(clockNow() + placementDurationSeconds(mode) * 1000).toISOString(),
      };
      const invalidated = await database.placements.find({ userId, completionReason: "invalidated" }, { projection: { invalidatedQuestionIds: 1 } }).toArray();
      record.excludedQuestionIds = [...new Set(invalidated.flatMap(row => row.invalidatedQuestionIds ?? []))];
      const available = await database.placementItems.countDocuments({ _id: { $nin: record.excludedQuestionIds } });
      if (available < record.total) throw new ApiError(409, "Đã dùng hết câu đầu vào chưa gặp. Hãy bổ sung học liệu mới trước khi làm lại.");
      record.currentQuestionId = (
        await selectQuestion(record, record.theta)
      ).id;
      await database.placements.insertOne(record);
      await armExam(learnerOf(request), "placement", record._id, request.get("X-Exam-Tab"));
      response.status(201).json({ placement: await placementView(await database.placements.findOne({ _id: record._id }) ?? record) });
    }),
  );
  app.post(
    "/api/placement/:id/draft",
    asyncRoute(async (request, response) => {
      await assertExamRequest(request, "placement", idOf(request));
      const input = z.object({ questionId: z.string().max(120), answer: z.string().max(500) }).parse(request.body);
      const userId = learnerOf(request).id;
      let record = await database.placements.findOne({ _id: idOf(request), userId });
      if (!record) throw new ApiError(404, "Không tìm thấy bài đánh giá của bạn.");
      record = await settlePlacement(record);
      if (!record.currentQuestionId) { response.json({ placement: await placementView(record) }); return; }
      if (record.currentQuestionId !== input.questionId) throw new ApiError(409, "Câu hỏi đã đổi; hãy tải lại.");
      const item = await database.placementItems.findOne({ _id: input.questionId });
      if (!item || !item.options.includes(input.answer)) throw new ApiError(400, "Hãy chọn một phương án hợp lệ.");
      const updated = await database.placements.findOneAndUpdate({ _id: record._id, userId,
        currentQuestionId: input.questionId, deadlineAt: { $gt: new Date(clockNow()).toISOString() },
      }, { $set: { draftAnswer: input } }, { returnDocument: "after" });
      const latest = updated ?? await database.placements.findOne({ _id: record._id, userId });
      if (!latest) throw new ApiError(404, "Không tìm thấy bài đánh giá của bạn.");
      response.json({ placement: await placementView(latest) });
    }),
  );
  app.post(
    "/api/placement/:id/answer",
    asyncRoute(async (request, response) => {
      await assertExamRequest(request, "placement", idOf(request));
      const input = z
        .object({
          questionId: z.string().max(120),
          answer: z.string().max(500),
        })
        .parse(request.body);
      const userId = learnerOf(request).id;
      let record = await database.placements.findOne({
        _id: idOf(request),
        userId,
      });
      if (!record)
        throw new ApiError(404, "Không tìm thấy bài đánh giá của bạn.");
      record = await settlePlacement(record);
      if (record.completionReason === "deadline") {
        response.json({ placement: await placementView(record) }); return;
      }
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
        draftAnswer: null,
        ...(complete ? { completedAt: new Date(clockNow()).toISOString(), completionReason: "answered" as const } : {}),
      };
      if (!complete)
        changed.currentQuestionId = (
          await selectQuestion(changed, estimate.theta)
        ).id;
      const persistAnswer = async () => {
        const updated = await database.placements.findOneAndUpdate(
          { _id: record._id, userId, currentQuestionId: input.questionId,
            deadlineAt: { $gt: new Date(clockNow()).toISOString() } },
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
        if (complete && examIntegrityEnabled) await guard.inspectResource(learnerOf(request), "placement", updated._id);
        response.json({ placement: await placementView(updated) });
      };
      if (complete) await withPlacementCompletion(record, persistAnswer);
      else await persistAnswer();
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
        placements: await Promise.all(records.map(async (stored) => {
          const record = await settlePlacement(stored);
          return ({
          id: record._id,
          mode: record.mode,
          total: record.total,
          completed: record.answers.length,
          estimatedBand: record.estimatedBand,
          standardError: record.standardError,
          startedAt: record.startedAt,
          result: await completedPlacementFeedback(record),
          });
        })),
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
      await database.db.collection("exam_integrity_sessions").deleteMany({ userId });
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
      request: Request,
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
        if (error.code) {
          // Only fixed categories enter logs: never provider payloads, essays,
          // account IDs, credentials or the original request URL.
          const route = /\/attempts\/[^/]+\/submit$/.test(request.path) ? "attempt-submit"
            : /\/attempts\/[^/]+\/regrade$/.test(request.path) ? "attempt-regrade"
            : /\/attempts\/[^/]+\/speaking$/.test(request.path) ? "speaking-submit"
            : request.path === "/api/content/generate" ? "content-generation" : "ai-request";
          console.error("AI grading failure:", JSON.stringify({ code: error.code, status: error.status, route }));
        }
        response.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
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
