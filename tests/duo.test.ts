import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { test } from "node:test";
import express from "express";
import { ZodError } from "zod";
import { GridFSBucket, MongoClient } from "mongodb";
import {
  createDuoService,
  type DuoService,
  type DuoConfig,
} from "../server/duo";
import { gradeObjective } from "../server/learning";
import type {
  Database,
  UserRecord,
  AttemptRecord,
  PlacementRecord,
} from "../server/storage";
import type { ContentKind, Feedback, StoredContent } from "../shared/types";
import type {
  DuoRole,
  DuoSnapshot,
  DuoAssessmentView,
  DuoRoomView,
} from "../shared/duo";
import { ApiError } from "../server/errors";

const ROLES: DuoRole[] = ["husband", "wife"];
const SKILLS: ContentKind[] = [
  "reading",
  "listening",
  "writing",
  "speaking",
  "grammar",
];
const blankFeedback = (skill: Feedback["skill"], at: string): Feedback => ({
  id: randomUUID(),
  skill,
  estimatedBand: null,
  rawScore: null,
  total: null,
  summary: "Controlled server-side test receipt",
  criteria: [],
  corrections: [],
  paragraphs: [],
  answers: [],
  source: "rule-based",
  createdAt: at,
});
function content(
  skill: ContentKind,
  format: "lesson" | "full-mock",
  index: number,
): StoredContent {
  const id = `duo-fixture-${skill}-${format}-${index}`;
  const objective = ["reading", "listening", "grammar"].includes(skill);
  return {
    id,
    skill,
    format,
    title: `${skill} ${format} ${index}`,
    description: "Synthetic curriculum fixture; not published IELTS content.",
    topic: "Fixture",
    band: 8,
    cefr: "C1",
    testType: "academic",
    durationMinutes:
      skill === "listening" ? 30 : skill === "speaking" ? 14 : 60,
    questions: objective
      ? Array.from(
          { length: format === "full-mock" ? 40 : 10 },
          (_, number) => ({
            id: `${id}-q${number + 1}`,
            number: number + 1,
            type: "choice" as const,
            prompt: "Fixture question",
            options: ["correct", "wrong"],
            sectionIndex: 0,
            subskill: "fixture",
            answer: "correct",
            evidence: "fixture",
            explanation: "fixture",
          }),
        )
      : [],
    sections: [
      {
        id: `${id}-section`,
        title: "Fixture",
        text: "Server-owned synthetic test section.",
        ...(skill === "writing" ? { task: 2 as const } : {}),
      },
    ],
    vocabularyIds: [],
    tags: ["fixture"],
    source: "authored",
    quality: "authored-unreviewed",
    createdAt: "2026-10-08T00:00:00.000Z",
  };
}
interface Fixture {
  database: Database;
  service: DuoService;
  users: Record<DuoRole, UserRecord>;
  now: () => number;
  advance: (ms: number) => void;
  request: <T>(
    role: DuoRole,
    path: string,
    data?: unknown,
    expected?: number,
  ) => Promise<T>;
  placement: (role: DuoRole, band: number) => Promise<PlacementRecord>;
  submit: (
    role: DuoRole,
    contentId: string,
    percent?: number,
    assessmentId?: string,
    aiBand?: number | null,
  ) => Promise<AttemptRecord>;
  snapshot: (role?: DuoRole) => Promise<DuoSnapshot>;
  close: () => Promise<void>;
}
async function fixture(config: DuoConfig = {}): Promise<Fixture> {
  const name = `ielts_duo_test_${randomUUID().replaceAll("-", "")}`;
  const client = new MongoClient(
    process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017",
  );
  await client.connect();
  const db = client.db(name);
  const database: Database = {
    client,
    db,
    recordings: new GridFSBucket(db, { bucketName: "recordings" }),
    users: db.collection("users"),
    sessions: db.collection("sessions"),
    attempts: db.collection("attempts"),
    cards: db.collection("cards"),
    placements: db.collection("placements"),
    plans: db.collection("plans"),
    audio: db.collection("audio"),
    content: db.collection("content"),
    vocabulary: db.collection("vocabulary"),
    placementItems: db.collection("placementItems"),
  };
  let clock = Date.parse("2026-10-08T01:00:00.000Z");
  const users = Object.fromEntries(
    ROLES.map((role): [DuoRole, UserRecord] => {
      const id = `${name}-${role}`;
      return [
        role,
        {
          _id: id,
          id,
          name: role === "husband" ? "Husband fixture" : "Wife fixture",
          email: `${role}@fixture.invalid`,
          duoRole: role,
          duoId: name,
          demo: false,
          passwordHash: null,
          currentBand: null,
          targetBand: 8,
          testType: "academic",
          examDate: null,
          weeklyMinutes: 300,
          dailyMinutes: 45,
          cefr: null,
          createdAt: new Date(clock).toISOString(),
        } as UserRecord,
      ];
    }),
  ) as Record<DuoRole, UserRecord>;
  await database.users.insertMany(Object.values(users));
  const bank = SKILLS.flatMap((skill) =>
    Array.from({ length: 4 }, (_, index) => content(skill, "lesson", index)),
  ).concat(
    SKILLS.filter((skill) => skill !== "grammar").map((skill) =>
      content(skill, "full-mock", 0),
    ),
  );
  await database.content.insertMany(
    bank.map((item) => ({ ...item, _id: item.id })),
  );
  const service = createDuoService(database, {
    sessionsPerBand: 10,
    now: () => clock,
    ...config,
  });
  await service.initialize();
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    (request as typeof request & { learner?: UserRecord }).learner =
      users[request.headers["x-test-role"] as DuoRole];
    next();
  });
  service.registerRoutes(app);
  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      response
        .status(
          error instanceof ApiError
            ? error.status
            : error instanceof ZodError
              ? 400
              : 500,
        )
        .json({
          error: error instanceof Error ? error.message : String(error),
        });
    },
  );
  const server: Server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  async function request<T>(
    role: DuoRole,
    path: string,
    data?: unknown,
    expected = 200,
  ): Promise<T> {
    const response = await fetch(base + path, {
      method: data === undefined ? "GET" : "POST",
      headers: { "x-test-role": role, "content-type": "application/json" },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    const value = await response.json();
    assert.equal(
      response.status,
      expected,
      `${path}: ${JSON.stringify(value)}`,
    );
    return value as T;
  }
  async function placement(
    role: DuoRole,
    band: number,
  ): Promise<PlacementRecord> {
    const id = randomUUID();
    const at = new Date(clock).toISOString();
    const record: PlacementRecord = {
      _id: id,
      userId: users[role].id,
      mode: "quick",
      total: 1,
      theta: 0,
      standardError: 1,
      estimatedBand: band,
      currentQuestionId: null,
      answers: [{ questionId: "fixture", answer: "correct", correct: true }],
      result: { ...blankFeedback("placement", at), estimatedBand: band },
      startedAt: at,
    };
    await database.placements.insertOne(record);
    await database.users.updateOne(
      { _id: users[role].id },
      { $set: { currentBand: band } },
    );
    await service.placementCompleted(users[role], record);
    return record;
  }
  async function submit(
    role: DuoRole,
    contentId: string,
    percent = 100,
    assessmentId?: string,
    aiBand?: number | null,
  ): Promise<AttemptRecord> {
    const item = await database.content.findOne({ _id: contentId });
    assert.ok(item);
    const permission = await service.beforeAttempt(users[role], {
      contentId,
      mode: assessmentId ? "exam" : "practice",
      ...(assessmentId ? { duoAssessmentId: assessmentId } : {}),
    });
    assert.equal(permission.existingAttemptId, undefined);
    const id = randomUUID();
    const at = new Date(clock).toISOString();
    const responses = Object.fromEntries(
      item.questions.map((question, index) => [
        question.id,
        (index / item.questions.length) * 100 < percent ? "correct" : "wrong",
      ]),
    );
    const productive = item.skill === "writing" || item.skill === "speaking";
    const attempt: AttemptRecord = {
      _id: id,
      id,
      userId: users[role].id,
      contentId,
      title: item.title,
      skill: item.skill,
      mode: assessmentId ? "exam" : "practice",
      status: "in-progress",
      startedAt: at,
      deadlineAt: permission.deadlineAt ?? null,
      submittedAt: null,
      durationSeconds: 10,
      responses,
      essays:
        item.skill === "writing"
          ? Object.fromEntries(
              item.sections
                .filter((section) => section.task === 1 || section.task === 2)
                .map((section) => [
                  section.id,
                  Array.from(
                    { length: section.task === 1 ? 160 : 260 },
                    (_, index) => `word${index}`,
                  ).join(" "),
                ]),
            )
          : {},
      transcript:
        item.skill === "speaking"
          ? "This controlled speaking response describes a memorable activity with friends. We visited an interesting local museum during the weekend and discussed why learning about cultural history helps people understand their community and think more carefully about future decisions."
          : "",
      feedback: null,
      ...(assessmentId ? { duoAssessmentId: assessmentId } : {}),
    };
    await database.attempts.insertOne(attempt);
    await service.bindAttempt(users[role], id, assessmentId);
    const feedback = productive
      ? {
          ...blankFeedback(item.skill, at),
          ...(aiBand !== null && aiBand !== undefined
            ? {
                source: "ai" as const,
                estimatedBand: aiBand,
                ...(item.skill === "writing"
                  ? {
                      taskScores: item.sections
                        .filter(
                          (section) => section.task === 1 || section.task === 2,
                        )
                        .map((section) => ({
                          task: section.task as 1 | 2,
                          estimatedBand: aiBand,
                          criteria: [],
                        })),
                    }
                  : {}),
              }
            : {}),
        }
      : gradeObjective(item, responses);
    const finished = {
      ...attempt,
      status: "submitted" as const,
      submittedAt: at,
      feedback,
    };
    await database.attempts.replaceOne({ _id: id }, finished);
    await service.attemptSubmitted(finished);
    return finished;
  }
  return {
    database,
    service,
    users,
    now: () => clock,
    advance: (ms) => {
      clock += ms;
    },
    request,
    placement,
    submit,
    snapshot: async (role = "husband") =>
      (await request<{ duo: DuoSnapshot }>(role, "/api/duo")).duo,
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      assert.match(name, /^ielts_duo_test_[a-f0-9]+$/);
      await db.dropDatabase();
      await client.close();
    },
  };
}
async function completeThrough(f: Fixture, last: number): Promise<void> {
  const state = await f.snapshot();
  const band = state.bands.find(
    (item) => item.band === state.path!.currentBand,
  )!;
  for (const lesson of band.lessons.filter((item) => item.number <= last))
    for (const role of ROLES)
      if (!lesson.completed[role]) {
        const proof = await f.submit(role, lesson.contentId!);
        await f.request(
          role,
          `/api/duo/lessons/${encodeURIComponent(lesson.id)}/complete`,
          { attemptId: proof.id },
        );
      }
}
async function passGate(
  f: Fixture,
  role: DuoRole,
  gateId: string,
  percent = 100,
): Promise<DuoAssessmentView> {
  const { assessment } = await f.request<{ assessment: DuoAssessmentView }>(
    role,
    `/api/duo/gates/${encodeURIComponent(gateId)}/start`,
    {},
  );
  for (const part of assessment.parts)
    await f.submit(role, part.contentId, percent, assessment.id);
  return (
    await f.request<{ assessment: DuoAssessmentView }>(
      role,
      `/api/duo/assessments/${assessment.id}`,
    )
  ).assessment;
}
async function promotionReady(f: Fixture): Promise<DuoRoomView> {
  let { room } = await f.request<{ room: DuoRoomView }>(
    "husband",
    "/api/duo/rooms",
    {},
    201,
  );
  for (const role of ROLES)
    await f.request(role, `/api/duo/rooms/${room.id}/join`, {});
  await f.request("husband", `/api/duo/rooms/${room.id}/ready`, {
    ready: true,
  });
  ({ room } = await f.request<{ room: DuoRoomView }>(
    "wife",
    `/api/duo/rooms/${room.id}/ready`,
    { ready: true },
  ));
  assert.equal(room.status, "countdown");
  f.advance(room.countdownSeconds * 1000);
  return (
    await f.request<{ room: DuoRoomView }>(
      "husband",
      `/api/duo/rooms/${room.id}`,
    )
  ).room;
}
async function finishPromotion(
  f: Fixture,
  room: DuoRoomView,
  outcomes: Partial<Record<DuoRole, number | null>> = {},
  objectivePercent: Partial<Record<DuoRole, number>> = {},
): Promise<void> {
  const assessments: Partial<Record<DuoRole, DuoAssessmentView>> = {};
  for (const role of ROLES) {
    const result = await f.request<{
      assessment: DuoAssessmentView | null;
      companion: boolean;
    }>(role, `/api/duo/rooms/${room.id}/start`, {});
    if (result.assessment) assessments[role] = result.assessment;
  }
  const sample = Object.values(assessments)[0]!;
  for (let index = 0; index < sample.parts.length; index++) {
    const startsAt = Date.parse(sample.parts[index].startsAt);
    if (f.now() < startsAt) f.advance(startsAt - f.now());
    await Promise.all(
      ROLES.filter((role) => assessments[role]).map((role) =>
        f.submit(
          role,
          assessments[role]!.parts[index].contentId,
          objectivePercent[role] ?? (outcomes[role] === 3 ? 50 : 100),
          assessments[role]!.id,
          outcomes[role] === undefined ? 8 : outcomes[role],
        ),
      ),
    );
  }
}

test(
  "Duo placement: waits for both, minimum not average, concurrent creation, re-placement never resets",
  { timeout: 30_000 },
  async () => {
    const f = await fixture({ sessionsPerBand: 20 });
    try {
      assert.equal((await f.snapshot()).path, null);
      await f.placement("husband", 5.5);
      assert.equal((await f.snapshot()).path, null);
      const result = await f.placement("wife", 4);
      await Promise.all(
        Array.from({ length: 8 }, () =>
          f.service.placementCompleted(f.users.wife, result),
        ),
      );
      const initial = await f.snapshot();
      assert.equal(initial.path!.startingBand, 4);
      assert.equal(initial.path!.currentBand, 4);
      assert.equal(initial.path!.targetBand, 8);
      assert.equal(initial.path!.sessionsPerBand, 20);
      assert.equal(
        initial.bands.find((item) => item.band === 4)!.gates.length,
        3,
      );
      assert.equal(
        await f.database.db.collection("duo_learning_paths").countDocuments(),
        1,
      );
      f.advance(1000);
      await f.placement("wife", 7.5);
      const later = await f.snapshot();
      assert.equal(later.path!.currentBand, 4);
      assert.equal(later.path!.startedAt, initial.path!.startedAt);
      assert.equal(
        later.members.find((member) => member.role === "wife")!.placementBand,
        7.5,
      );
      assert.equal(
        await f.database.db
          .collection("duo_placement_results")
          .countDocuments(),
        3,
      );
      const restarted = createDuoService(f.database);
      assert.equal(
        (await restarted.snapshot(f.users.husband)).path!.currentBand,
        4,
      );
    } finally {
      await f.close();
    }
  },
);

test(
  "Duo gates: server prerequisites, private proofs, isolated practice, pass retained, retakes and no URL bypass",
  { timeout: 30_000 },
  async () => {
    const f = await fixture();
    try {
      await f.placement("husband", 5);
      await f.placement("wife", 4);
      let current = (await f.snapshot()).bands.find((item) => item.band === 4)!;
      const gate = current.gates[0];
      const locked = current.lessons[5];
      await f.request(
        "husband",
        `/api/duo/gates/${encodeURIComponent(gate.id)}/start`,
        {},
        403,
      );
      const ordinary = await f.submit("husband", locked.contentId!);
      assert.equal(ordinary.status, "submitted");
      await f.request(
        "husband",
        `/api/duo/lessons/${encodeURIComponent(locked.id)}/complete`,
        { attemptId: ordinary.id },
        403,
      );
      const wifeProof = await f.submit("wife", current.lessons[0].contentId!);
      await f.request(
        "husband",
        `/api/duo/lessons/${encodeURIComponent(current.lessons[0].id)}/complete`,
        { attemptId: wifeProof.id },
        409,
      );
      await f.request(
        "husband",
        `/api/duo/lessons/${encodeURIComponent(current.lessons[0].id)}/complete`,
        { completed: true },
        400,
      );
      await completeThrough(f, 5);
      const husbandGate = await passGate(f, "husband", gate.id);
      assert.equal(husbandGate.status, "passed");
      current = (await f.snapshot()).bands.find((item) => item.band === 4)!;
      assert.equal(current.gates[0].unlocked, false);
      assert.equal(current.lessons[5].unlocked, false);
      assert.equal((await f.snapshot()).status, "WAITING_FOR_PARTNER");
      await f.request(
        "wife",
        `/api/duo/assessments/${husbandGate.id}`,
        undefined,
        404,
      );
      const wifeFailed = await passGate(f, "wife", gate.id, 50);
      assert.equal(wifeFailed.status, "failed");
      const wifePassed = await passGate(f, "wife", gate.id);
      assert.equal(wifePassed.status, "passed");
      assert.notEqual(wifePassed.id, wifeFailed.id);
      current = (await f.snapshot()).bands.find((item) => item.band === 4)!;
      assert.equal(current.gates[0].unlocked, true);
      assert.equal(current.gates[0].assessmentIds.husband, husbandGate.id);
      assert.equal(current.lessons[5].unlocked, true);
      assert.equal((await f.snapshot()).path!.currentBand, 4);
      await assert.rejects(
        f.service.beforeAttempt(f.users.wife, {
          contentId: locked.contentId!,
          mode: "exam",
          duoAssessmentId: husbandGate.id,
        }),
        (error: unknown) => error instanceof ApiError && error.status === 404,
      );
      await assert.rejects(
        f.service.beforeAttempt(f.users.husband, {
          contentId: locked.contentId!,
          mode: "practice",
          duoAssessmentId: husbandGate.id,
        }),
        (error: unknown) => error instanceof ApiError && error.status === 400,
      );
    } finally {
      await f.close();
    }
  },
);

test(
  "Duo promotion: both learners must be ready, expired presence resets, and leaving an active room invalidates synchronized sections",
  { timeout: 30_000 },
  async () => {
    const f = await fixture({ sessionsPerBand: 5 });
    try {
      await f.placement("husband", 4);
      await f.placement("wife", 4);
      await completeThrough(f, 5);
      const { room } = await f.request<{ room: DuoRoomView }>(
        "husband",
        "/api/duo/rooms",
        {},
        201,
      );
      await f.request("husband", `/api/duo/rooms/${room.id}/join`, {});
      await f.request("husband", `/api/duo/rooms/${room.id}/ready`, {
        ready: true,
      });
      await f.request("husband", `/api/duo/rooms/${room.id}/start`, {}, 403);
      await f.request("wife", `/api/duo/rooms/${room.id}/join`, {});
      await f.request("husband", `/api/duo/rooms/${room.id}/start`, {}, 403);
      await f.request("wife", `/api/duo/rooms/${room.id}/ready`, {
        ready: true,
      });
      await f.request("husband", `/api/duo/rooms/${room.id}/start`, {}, 403);
      f.advance(31_000);
      let latest = (
        await f.request<{ room: DuoRoomView }>(
          "husband",
          `/api/duo/rooms/${room.id}`,
        )
      ).room;
      assert.equal(latest.status, "waiting");
      assert.equal(latest.members.husband.ready, false);
      for (const role of ROLES) {
        await f.request(role, `/api/duo/rooms/${room.id}/join`, {});
        await f.request(role, `/api/duo/rooms/${room.id}/ready`, {
          ready: true,
        });
      }
      f.advance(5000);
      const husband = (
        await f.request<{ assessment: DuoAssessmentView }>(
          "husband",
          `/api/duo/rooms/${room.id}/start`,
          {},
        )
      ).assessment;
      latest = (
        await f.request<{ room: DuoRoomView }>(
          "wife",
          `/api/duo/rooms/${room.id}`,
        )
      ).room;
      assert.equal(latest.status, "in-progress");
      assert.ok(latest.members.wife.assessmentId);
      const wife = (
        await f.request<{ assessment: DuoAssessmentView }>(
          "wife",
          `/api/duo/rooms/${room.id}/start`,
          {},
        )
      ).assessment;
      assert.equal(husband.deadlineAt, wife.deadlineAt);
      assert.equal(husband.parts[0].deadlineAt, wife.parts[0].deadlineAt);
      await assert.rejects(
        f.service.beforeAttempt(f.users.husband, {
          contentId: husband.parts[1].contentId,
          mode: "exam",
          duoAssessmentId: husband.id,
        }),
        /chưa đến giờ/,
      );
      const left = (
        await f.request<{ room: DuoRoomView }>("wife", `/api/duo/rooms/${room.id}/leave`, {})
      ).room;
      assert.equal(left.status, "invalidated");
      assert.ok(left.invalidatedAt);
      for (const role of ROLES) {
        await f.request(role, `/api/duo/rooms/${room.id}/join`, {}, 409);
        await f.request(role, `/api/duo/rooms/${room.id}/start`, {}, 409);
        const invalidated = (
          await f.request<{ assessment: DuoAssessmentView }>(role, `/api/duo/assessments/${role === "husband" ? husband.id : wife.id}`)
        ).assessment;
        assert.equal(invalidated.status, "failed");
        assert.ok(invalidated.invalidatedAt);
        assert.equal(invalidated.integrity?.status, "invalidated");
      }
    } finally {
      await f.close();
    }
  },
);

test(
  "Duo promotion: pending AI cannot pass, one pass is retained, companion retake needs both, atomic band advance",
  { timeout: 30_000 },
  async () => {
    const f = await fixture({ sessionsPerBand: 5 });
    try {
      await f.placement("husband", 4);
      await f.placement("wife", 4);
      await completeThrough(f, 5);
      const room = await promotionReady(f);
      await finishPromotion(f, room, { husband: 8, wife: null });
      let current = await f.snapshot();
      assert.equal(current.path!.currentBand, 4);
      assert.equal(
        current.bands.find((item) => item.band === 4)!.promotionResults.husband,
        "passed",
      );
      const wifeAssessment = (await f.snapshot("wife")).assessments.find(
        (item) => item.roomId === room.id,
      )!;
      assert.equal(wifeAssessment.status, "pending-ai");
      // Controlled server provider receipt: no client-submitted scores enter this path.
      for (const part of wifeAssessment.parts.filter((part) =>
        ["writing", "speaking"].includes(part.skill),
      )) {
        const attempt = await f.database.attempts.findOne({
          _id: part.attemptId!,
        });
        assert.ok(attempt);
        const changed = {
          ...attempt,
          feedback: {
            ...attempt.feedback!,
            source: "ai" as const,
            estimatedBand: 3,
            ...(part.skill === "writing"
              ? {
                  taskScores: [
                    { task: 2 as const, estimatedBand: 3, criteria: [] },
                  ],
                }
              : {}),
          },
        };
        await f.database.attempts.replaceOne({ _id: attempt._id }, changed);
        await f.service.attemptSubmitted(changed);
      }
      current = await f.snapshot();
      assert.equal(current.path!.currentBand, 4);
      assert.equal(current.status, "WAITING_FOR_BAND_PASS");
      const next = (
        await f.request<{ room: DuoRoomView }>(
          "wife",
          "/api/duo/rooms",
          {},
          201,
        )
      ).room;
      assert.equal(next.members.husband.companion, true);
      await f.request("wife", `/api/duo/rooms/${next.id}/join`, {});
      await f.request("wife", `/api/duo/rooms/${next.id}/ready`, {
        ready: true,
      });
      await f.request("wife", `/api/duo/rooms/${next.id}/start`, {}, 403);
      await f.request("husband", `/api/duo/rooms/${next.id}/join`, {});
      await f.request("husband", `/api/duo/rooms/${next.id}/ready`, {
        ready: true,
        companion: true,
      });
      f.advance(5000);
      const nextRoom = (
        await f.request<{ room: DuoRoomView }>(
          "wife",
          `/api/duo/rooms/${next.id}`,
        )
      ).room;
      await finishPromotion(f, nextRoom);
      const passed = await f.snapshot();
      assert.equal(passed.path!.currentBand, 4.5);
      assert.equal(
        passed.bands.find((item) => item.band === 4)!.completed,
        true,
      );
      assert.equal(
        passed.bands.find((item) => item.band === 4.5)!.unlocked,
        true,
      );
      assert.equal(
        passed.bands.find((item) => item.band === 4)!.promotionResults.husband,
        "passed",
      );
      assert.equal(
        await f.database.db.collection("duo_learning_paths").countDocuments(),
        1,
      );
      const receipts = await f.database.attempts
        .find({ userId: f.users.wife.id, duoAssessmentId: `${next.id}:wife` })
        .toArray();
      assert.equal(receipts.length, 4);
      await Promise.all(
        receipts.flatMap((receipt) =>
          Array.from({ length: 3 }, () => f.service.attemptSubmitted(receipt)),
        ),
      );
      assert.equal((await f.snapshot()).path!.currentBand, 4.5);
    } finally {
      await f.close();
    }
  },
);

test(
  "Duo promotion: reference band requirement beats 70-percent shortcut; ceiling 8.0 and concurrent receipts",
  { timeout: 30_000 },
  async () => {
    const f = await fixture({ sessionsPerBand: 5 });
    try {
      await f.placement("husband", 8);
      await f.placement("wife", 8);
      await completeThrough(f, 5);
      const room = await promotionReady(f);
      await finishPromotion(f, room);
      const state = await f.snapshot();
      assert.equal(state.path!.currentBand, 8);
      assert.equal(state.status, "BAND_COMPLETED");
      assert.equal(
        state.bands.some((band) => band.band > 8),
        false,
      );
      const last = await f.database.attempts
        .find({ duoAssessmentId: { $exists: true } })
        .toArray();
      await Promise.all(
        last.flatMap((attempt) =>
          Array.from({ length: 3 }, () => f.service.attemptSubmitted(attempt)),
        ),
      );
      assert.equal((await f.snapshot()).path!.currentBand, 8);
      await f.request("husband", "/api/duo/rooms", {}, 403);
    } finally {
      await f.close();
    }
  },
);

test(
  "Duo strict retake resets retained pass and rejects an older room's receipts",
  { timeout: 30_000 },
  async () => {
    const f = await fixture({ sessionsPerBand: 5, strictRetakeMode: true });
    try {
      await f.placement("husband", 4);
      await f.placement("wife", 4);
      await completeThrough(f, 5);
      const first = await promotionReady(f);
      await finishPromotion(f, first, { husband: 8, wife: 3 });
      assert.equal((await f.snapshot()).path!.currentBand, 4);
      assert.equal(
        (await f.snapshot()).bands.find((band) => band.band === 4)!
          .promotionResults.husband,
        "passed",
      );
      const second = await promotionReady(f);
      assert.equal(second.members.husband.companion, false);
      const starting = await f.snapshot();
      assert.equal(
        starting.bands.find((band) => band.band === 4)!.promotionResults
          .husband,
        "in-progress",
      );
      const oldReceipts = await f.database.attempts
        .find({ duoAssessmentId: `${first.id}:husband` })
        .toArray();
      await Promise.all(
        oldReceipts.map((attempt) => f.service.attemptSubmitted(attempt)),
      );
      assert.equal(
        (await f.snapshot()).bands.find((band) => band.band === 4)!
          .promotionResults.husband,
        "in-progress",
      );
      await finishPromotion(f, second, { husband: 3, wife: 8 });
      const completed = await f.snapshot();
      assert.equal(completed.path!.currentBand, 4);
      assert.equal(
        completed.bands.find((band) => band.band === 4)!.promotionResults
          .husband,
        "failed",
      );
      assert.equal(
        completed.bands.find((band) => band.band === 4)!.promotionResults.wife,
        "passed",
      );
    } finally {
      await f.close();
    }
  },
);

test(
  "Duo at 7.5 requires each full-mock band 8, not 70 percent or averaging partners",
  { timeout: 30_000 },
  async () => {
    const f = await fixture({ sessionsPerBand: 5 });
    try {
      await f.placement("husband", 7.5);
      await f.placement("wife", 7.5);
      await completeThrough(f, 5);
      const room = await promotionReady(f);
      await finishPromotion(f, room, { husband: 8, wife: 8 }, { wife: 70 });
      const state = await f.snapshot();
      assert.equal(state.path!.currentBand, 7.5);
      const wife = (await f.snapshot("wife")).assessments.find(
        (record) => record.roomId === room.id,
      )!;
      assert.equal(wife.requiredBand, 8);
      assert.equal(wife.parts[0].scorePercent, 70);
      assert.ok(wife.parts[0].estimatedBand! < 8);
      assert.equal(wife.status, "failed");
      assert.equal(
        state.bands.find((band) => band.band === 7.5)!.promotionResults.husband,
        "passed",
      );
    } finally {
      await f.close();
    }
  },
);

test(
  "Duo lesson completion rejects blank, wrong content and pre-unlock receipts; no third member",
  { timeout: 30_000 },
  async () => {
    const f = await fixture({ sessionsPerBand: 5 });
    try {
      const old = await f.submit("husband", "duo-fixture-reading-lesson-0");
      f.advance(1000);
      await f.placement("husband", 4);
      await f.placement("wife", 4);
      const band = (await f.snapshot()).bands.find(
        (record) => record.band === 4,
      )!;
      await f.request(
        "husband",
        `/api/duo/lessons/${encodeURIComponent(band.lessons[0].id)}/complete`,
        { attemptId: old.id },
        409,
      );
      const partial = await f.submit("husband", band.lessons[0].contentId!);
      await f.database.attempts.updateOne(
        { _id: partial._id },
        { $set: { responses: {} } },
      );
      await f.request(
        "husband",
        `/api/duo/lessons/${encodeURIComponent(band.lessons[0].id)}/complete`,
        { attemptId: partial.id },
        409,
      );
      const writing = await f.submit("husband", band.lessons[2].contentId!);
      await f.database.attempts.updateOne(
        { _id: writing._id },
        { $set: { essays: { task2: "too short" } } },
      );
      await f.request(
        "husband",
        `/api/duo/lessons/${encodeURIComponent(band.lessons[2].id)}/complete`,
        { attemptId: writing.id },
        409,
      );
      const speaking = await f.submit("husband", band.lessons[3].contentId!);
      await f.database.attempts.updateOne(
        { _id: speaking._id },
        { $set: { transcript: "hello" } },
      );
      await f.request(
        "husband",
        `/api/duo/lessons/${encodeURIComponent(band.lessons[3].id)}/complete`,
        { attemptId: speaking.id },
        409,
      );
      assert.equal(
        (await f.snapshot()).bands.find((record) => record.band === 4)!
          .lessons[0].completed.husband,
        false,
      );
      const outsider = {
        ...f.users.husband,
        _id: "outsider",
        id: "outsider",
        email: "outside@fixture.invalid",
      };
      await assert.rejects(
        f.service.snapshot(outsider),
        (error: unknown) => error instanceof ApiError && error.status === 403,
      );
    } finally {
      await f.close();
    }
  },
);

test(
  "Duo vocabulary session requires every own card with a real post-unlock review log",
  { timeout: 30_000 },
  async () => {
    const f = await fixture({
      sessionsPerBand: 5,
      lessonKinds: [
        "reading",
        "listening",
        "vocabulary",
        "writing",
        "speaking",
      ],
    });
    try {
      await f.database.db
        .collection<{ _id: string; id: string }>("vocabulary")
        .insertMany(
          Array.from({ length: 5 }, (_, index) => ({
            _id: `word-${index}`,
            id: `word-${index}`,
          })),
        );
      await f.placement("husband", 4);
      await f.placement("wife", 4);
      const lesson = (await f.snapshot()).bands.find((band) => band.band === 4)!
        .lessons[2];
      assert.equal(lesson.kind, "vocabulary");
      assert.equal(lesson.vocabularyIds.length, 5);
      const endpoint = `/api/duo/lessons/${encodeURIComponent(lesson.id)}/complete`;
      const cards = lesson.vocabularyIds.map((vocabularyId) => ({
        _id: randomUUID(),
        userId: f.users.wife.id,
        vocabularyId,
        reps: 1,
        reviewLog: [
          JSON.stringify({
            review: new Date(f.now()).toISOString(),
            rating: 3,
          }),
        ],
      }));
      cards.forEach((card) => Object.assign(card, { id: card._id }));
      await f.database.db
        .collection<(typeof cards)[number] & { id: string }>("cards")
        .insertMany(cards as ((typeof cards)[number] & { id: string })[]);
      await f.request(
        "husband",
        endpoint,
        { cardIds: cards.map((card) => card._id) },
        409,
      );
      const own = cards.map((card) => ({
        ...card,
        _id: randomUUID(),
        userId: f.users.husband.id,
        reviewLog: [
          JSON.stringify({
            review: new Date(f.now() - 1000).toISOString(),
            rating: 3,
          }),
        ],
      }));
      own.forEach((card) => Object.assign(card, { id: card._id }));
      await f.database.db
        .collection<(typeof own)[number] & { id: string }>("cards")
        .insertMany(own as ((typeof own)[number] & { id: string })[]);
      await f.request(
        "husband",
        endpoint,
        { cardIds: own.map((card) => card._id) },
        409,
      );
      await f.database.db.collection("cards").updateMany(
        { userId: f.users.husband.id },
        {
          $set: {
            reviewLog: [
              JSON.stringify({
                review: new Date(f.now()).toISOString(),
                rating: 3,
              }),
            ],
          },
        },
      );
      await f.request(
        "husband",
        endpoint,
        { cardIds: own.slice(1).map((card) => card._id) },
        409,
      );
      const completed = await f.request<{ duo: DuoSnapshot }>(
        "husband",
        endpoint,
        { cardIds: own.map((card) => card._id) },
      );
      assert.equal(
        completed.duo.bands.find((band) => band.band === 4)!.lessons[2]
          .completed.husband,
        true,
      );
      assert.equal(
        completed.duo.bands.find((band) => band.band === 4)!.lessons[2]
          .completed.wife,
        false,
      );
    } finally {
      await f.close();
    }
  },
);

test(
  "Duo server-owned curriculum varies session counts per band without reopening existing progress",
  { timeout: 30_000 },
  async () => {
    const f = await fixture({
      sessionsPerBand: 20,
      sessionsByBand: { "3.0": 10, "3.5": 20 },
    });
    try {
      await f.placement("husband", 3);
      await f.placement("wife", 3);
      const state = await f.snapshot();
      assert.equal(state.path!.sessionsPerBand, 20);
      assert.equal(
        state.bands.find((band) => band.band === 3)!.lessons.length,
        10,
      );
      assert.equal(
        state.bands.find((band) => band.band === 3)!.gates.length,
        1,
      );
      assert.equal(
        state.bands.find((band) => band.band === 3.5)!.lessons.length,
        20,
      );
      assert.equal(
        state.bands.find((band) => band.band === 3.5)!.gates.length,
        3,
      );
      const reopened = await createDuoService(f.database, {
        sessionsPerBand: 30,
      }).snapshot(f.users.husband);
      assert.equal(
        reopened.bands.find((band) => band.band === 3)!.lessons.length,
        10,
      );
      assert.throws(
        () => createDuoService(f.database, { sessionsByBand: { "8.5": 10 } }),
        /Invalid per-band/,
      );
      assert.throws(
        () => createDuoService(f.database, { sessionsByBand: { "3": 4 } }),
        /Invalid per-band/,
      );
    } finally {
      await f.close();
    }
  },
);

test(
  "Duo submitted blank productive parts fail; genuine saved audio without transcript waits for grading",
  { timeout: 30_000 },
  async () => {
    const f = await fixture({ sessionsPerBand: 5 });
    try {
      await f.placement("husband", 4);
      await f.placement("wife", 4);
      await completeThrough(f, 5);
      const room = await promotionReady(f);
      const assessment = (
        await f.request<{ assessment: DuoAssessmentView }>(
          "husband",
          `/api/duo/rooms/${room.id}/start`,
          {},
        )
      ).assessment;
      for (const part of assessment.parts.slice(0, 2)) {
        const at = Date.parse(part.startsAt);
        if (f.now() < at) f.advance(at - f.now());
        await f.submit("husband", part.contentId, 100, assessment.id);
      }
      const writing = assessment.parts[2];
      f.advance(Date.parse(writing.startsAt) - f.now());
      const writingAttempt = await f.submit(
        "husband",
        writing.contentId,
        100,
        assessment.id,
      );
      const blankWriting = {
        ...writingAttempt,
        essays: {},
        feedback: blankFeedback("writing", new Date(f.now()).toISOString()),
      };
      await f.database.attempts.replaceOne(
        { _id: blankWriting._id },
        blankWriting,
      );
      await f.service.attemptSubmitted(blankWriting);
      const speech = assessment.parts[3];
      f.advance(Date.parse(speech.startsAt) - f.now());
      const speechAttempt = await f.submit(
        "husband",
        speech.contentId,
        100,
        assessment.id,
      );
      const blankSpeech = {
        ...speechAttempt,
        transcript: "",
        feedback: blankFeedback("speaking", new Date(f.now()).toISOString()),
      };
      await f.database.attempts.replaceOne(
        { _id: blankSpeech._id },
        blankSpeech,
      );
      await f.service.attemptSubmitted(blankSpeech);
      let view = (
        await f.request<{ assessment: DuoAssessmentView }>(
          "husband",
          `/api/duo/assessments/${assessment.id}`,
        )
      ).assessment;
      assert.equal(view.parts[2].status, "failed");
      assert.equal(view.parts[3].status, "failed");
      assert.equal(view.status, "failed");
      const upload = f.database.recordings.openUploadStream(
        "duo-native-audio",
        { metadata: { userId: f.users.husband.id, attemptId: blankSpeech.id } },
      );
      upload.end(Buffer.from("Controlled private test audio"));
      await once(upload, "finish");
      await f.database.audio.insertOne({
        _id: randomUUID(),
        userId: f.users.husband.id,
        attemptId: blankSpeech.id,
        fileId: upload.id,
        mime: "audio/wav",
        createdAt: new Date(f.now()).toISOString(),
      });
      await f.service.attemptSubmitted(blankSpeech);
      view = (
        await f.request<{ assessment: DuoAssessmentView }>(
          "husband",
          `/api/duo/assessments/${assessment.id}`,
        )
      ).assessment;
      assert.equal(view.parts[3].status, "pending-ai");
      assert.equal(view.status, "pending-ai");
      assert.equal((await f.snapshot()).path!.currentBand, 4);
    } finally {
      await f.close();
    }
  },
);

test(
  "Duo promotion Writing requires every declared task and complete real server task-score evidence",
  { timeout: 30_000 },
  async () => {
    const f = await fixture({ sessionsPerBand: 5 });
    try {
      const writingId = "duo-fixture-writing-full-mock-0";
      const tasks = [1, 2].map((task) => ({
        id: `${writingId}-task${task}`,
        title: `Required Task ${task}`,
        text: "Server-owned synthetic task.",
        task: task as 1 | 2,
      }));
      await f.database.content.updateOne(
        { _id: writingId },
        { $set: { sections: tasks } },
      );
      await f.placement("husband", 4);
      await f.placement("wife", 4);
      await completeThrough(f, 5);
      const room = await promotionReady(f);
      const assessment = (
        await f.request<{ assessment: DuoAssessmentView }>(
          "husband",
          `/api/duo/rooms/${room.id}/start`,
          {},
        )
      ).assessment;
      for (const part of assessment.parts.slice(0, 2)) {
        if (f.now() < Date.parse(part.startsAt))
          f.advance(Date.parse(part.startsAt) - f.now());
        await f.submit("husband", part.contentId, 100, assessment.id);
      }
      const writing = assessment.parts[2];
      f.advance(Date.parse(writing.startsAt) - f.now());
      const valid = await f.submit(
        "husband",
        writing.contentId,
        100,
        assessment.id,
        8,
      );
      const result = async (record: AttemptRecord) => {
        await f.database.attempts.replaceOne({ _id: record.id }, record);
        await f.service.attemptSubmitted(record);
        return (
          await f.request<{ assessment: DuoAssessmentView }>(
            "husband",
            `/api/duo/assessments/${assessment.id}`,
          )
        ).assessment.parts[2];
      };
      const taskOneOnly = {
        ...valid,
        essays: { [tasks[0].id]: valid.essays[tasks[0].id] },
        feedback: {
          ...valid.feedback!,
          estimatedBand: 9,
          taskScores: [{ task: 1 as const, estimatedBand: 9, criteria: [] }],
        },
      };
      assert.equal((await result(taskOneOnly)).status, "failed");
      const tooShort = {
        ...valid,
        essays: {
          ...valid.essays,
          [tasks[1].id]: "A short unfinished Task 2.",
        },
      };
      assert.equal((await result(tooShort)).status, "failed");
      const missingTaskScore = {
        ...valid,
        feedback: {
          ...valid.feedback!,
          taskScores: valid.feedback!.taskScores!.slice(0, 1),
        },
      };
      assert.equal((await result(missingTaskScore)).status, "pending-ai");
      const absentScores = {
        ...valid,
        feedback: { ...valid.feedback!, taskScores: undefined },
      };
      assert.equal((await result(absentScores)).status, "pending-ai");
      assert.equal((await result(valid)).status, "passed");
      assert.equal((await f.snapshot()).path!.currentBand, 4);
    } finally {
      await f.close();
    }
  },
);

test(
  "Duo deadline waits for live server grading leases; late accepted results promote and abandoned leases expire",
  { timeout: 45_000 },
  async () => {
    for (const outcome of ["complete", "expire"] as const) {
      const f = await fixture({ sessionsPerBand: 5 });
      try {
        await f.placement("husband", 4);
        await f.placement("wife", 4);
        await completeThrough(f, 5);
        const room = await promotionReady(f);
        await finishPromotion(f, room, { husband: null, wife: null });
        const assessments = Object.fromEntries(
          await Promise.all(
            ROLES.map(async (role) => [
              role,
              (await f.snapshot(role)).assessments.find(
                (item) => item.roomId === room.id,
              )!,
            ]),
          ),
        ) as Record<DuoRole, DuoAssessmentView>;
        // Reading/Listening passed; Writing has a complete genuine server receipt.
        for (const role of ROLES) {
          const part = assessments[role].parts[2];
          const attempt = await f.database.attempts.findOne({
            _id: part.attemptId!,
          });
          assert.ok(attempt);
          const graded = {
            ...attempt,
            feedback: {
              ...attempt.feedback!,
              source: "ai" as const,
              estimatedBand: 8,
              taskScores: [
                { task: 2 as const, estimatedBand: 8, criteria: [] },
              ],
            },
          };
          await f.database.attempts.replaceOne({ _id: graded.id }, graded);
          await f.service.attemptSubmitted(graded);
        }
        const saved: Partial<Record<DuoRole, AttemptRecord>> = {};
        const leaseEndsAt = new Date(f.now() + 20 * 60_000).toISOString();
        for (const role of ROLES) {
          const part = assessments[role].parts[3];
          const attempt = await f.database.attempts.findOne({
            _id: part.attemptId!,
          });
          assert.ok(attempt);
          saved[role] = attempt;
          await f.database.attempts.replaceOne({ _id: attempt.id }, {
            ...attempt,
            status: "in-progress",
            submittedAt: null,
            feedback: null,
            submissionLease: {
              token: `server-only-${role}`,
              expiresAt: leaseEndsAt,
            },
          } as AttemptRecord);
        }
        f.advance(Date.parse(room.deadlineAt!) - f.now() + 1);
        let state = await f.snapshot();
        const assessment = state.assessments.find(
          (item) => item.roomId === room.id,
        )!;
        assert.equal(assessment.parts[3].status, "in-progress");
        assert.equal(assessment.status, "in-progress");
        assert.equal(state.room!.status, "in-progress");
        const unchanged = (
          await f.request<{ room: DuoRoomView }>(
            "husband",
            "/api/duo/rooms",
            {},
            201,
          )
        ).room;
        assert.equal(
          unchanged.id,
          room.id,
          "A retake cannot displace a live accepted grade",
        );
        if (outcome === "complete") {
          for (const role of ROLES) {
            const attempt = saved[role]!;
            const graded = {
              ...attempt,
              submittedAt: new Date(f.now()).toISOString(),
              feedback: {
                ...attempt.feedback!,
                source: "ai" as const,
                estimatedBand: 8,
              },
            };
            await f.database.attempts.replaceOne({ _id: graded.id }, graded);
            await f.service.attemptSubmitted(graded);
          }
          state = await f.snapshot();
          assert.equal(state.path!.currentBand, 4.5);
        } else {
          f.advance(Date.parse(leaseEndsAt) - f.now() + 1);
          state = await f.snapshot();
          assert.equal(state.path!.currentBand, 4);
          assert.equal(
            state.assessments.find((item) => item.roomId === room.id)!.parts[3]
              .status,
            "failed",
          );
          assert.equal(state.room!.status, "completed");
          const retry = (
            await f.request<{ room: DuoRoomView }>(
              "husband",
              "/api/duo/rooms",
              {},
              201,
            )
          ).room;
          assert.notEqual(retry.id, room.id);
        }
      } finally {
        await f.close();
      }
    }
  },
);
