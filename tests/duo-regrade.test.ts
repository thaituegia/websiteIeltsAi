import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { test } from "node:test";
import { createApp } from "../server/app";
import { hashPassword } from "../server/auth";
import { parseDuoCredentials, provisionDuoAccounts } from "../server/duo-auth";
import { connectDatabase, type Database } from "../server/storage";
import type {
  Attempt,
  ContentKind,
  Feedback,
  StoredContent,
} from "../shared/types";
import type {
  DuoAssessmentView,
  DuoRole,
  DuoSnapshot,
  DuoRoomView,
} from "../shared/duo";
const roles: DuoRole[] = ["husband", "wife"];
const keys = [
  "IELTS_OPENAI_API_KEY",
  "OPENAI_API_KEY",
  "IELTS_AZURE_SPEECH_KEY",
  "AZURE_SPEECH_KEY",
  "IELTS_AZURE_SPEECH_REGION",
  "AZURE_SPEECH_REGION",
];
const writingNames = [
  "Task Achievement/Response",
  "Coherence & Cohesion",
  "Lexical Resource",
  "Grammatical Range & Accuracy",
];
const speakingNames = [
  "Fluency & Coherence",
  "Lexical Resource",
  "Grammatical Range & Accuracy",
  "Pronunciation",
];
const essay =
  "Public transport improves access to education and employment. Reliable services help local residents make better decisions about their daily journeys. ".repeat(
    16,
  );
const transcript =
  "Public transport improves access to education and employment. In my city, the council introduced frequent buses last year, and my friends found it easier to travel to their university. I think this investment improves people's opportunities because it makes essential services accessible to those without cars.";
function bankItem(
  skill: ContentKind,
  format: StoredContent["format"],
  index: number,
): StoredContent {
  const id = `regrade-fixture-${skill}-${format}-${index}`;
  return {
    id,
    skill,
    format,
    band: 8,
    cefr: "C1",
    testType: "academic",
    title: `Controlled ${skill} ${format} ${index}`,
    description: "Private synthetic HTTP fixture, not published material.",
    topic: "Controlled test",
    durationMinutes:
      skill === "listening" ? 30 : skill === "speaking" ? 14 : 60,
    sections:
      skill === "writing"
        ? [
            {
              id: "task1",
              title: "Task 1",
              task: 1,
              text: "Summarise the test data.",
            },
            {
              id: "task2",
              title: "Task 2",
              task: 2,
              text: "Discuss transport investment.",
            },
          ]
        : [
            {
              id: "section",
              title: "Controlled section",
              text: "Fixture response evidence.",
            },
          ],
    questions: ["reading", "listening", "grammar"].includes(skill)
      ? Array.from(
          { length: format === "full-mock" ? 40 : 10 },
          (_, question) => ({
            id: `${id}-q${question + 1}`,
            number: question + 1,
            sectionIndex: 0,
            type: "choice",
            options: ["correct", "wrong"],
            answer: "correct",
            prompt: `Controlled question ${question + 1}`,
            explanation: "Fixture explanation.",
            evidence: "Fixture response evidence.",
            subskill: "fixture",
          }),
        )
      : [],
    vocabularyIds: [],
    tags: ["private-fixture"],
    source: "authored",
    quality: "authored-unreviewed",
    createdAt: new Date(0).toISOString(),
  };
}
function baseFeedback(at: string): Feedback {
  return {
    id: randomUUID(),
    skill: "placement",
    source: "rule-based",
    estimatedBand: 4,
    rawScore: 1,
    total: 1,
    summary: "Controlled placement receipt",
    criteria: [],
    corrections: [],
    paragraphs: [],
    answers: [],
    createdAt: at,
  };
}
interface Setup {
  database: Database;
  server: Server;
  origin: string;
  jars: Record<DuoRole, string>;
  clock: () => number;
  advanceTo: (iso: string, after?: number) => void;
  request: <T>(
    role: DuoRole,
    method: string,
    path: string,
    body?: unknown,
    status?: number,
  ) => Promise<T>;
  attempt: (
    role: DuoRole,
    contentId: string,
    context?: string,
    submit?: boolean,
  ) => Promise<Attempt>;
  prepare: () => Promise<Record<DuoRole, DuoAssessmentView>>;
  cleanup: () => Promise<void>;
}
async function setup(): Promise<Setup> {
  const name = `ielts_duo_regrade_test_${randomUUID().replaceAll("-", "")}`;
  const database = await connectDatabase(
    process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017",
    name,
  );
  const settings = parseDuoCredentials({
    duoId: "synthetic-regrade-duo",
    accounts: [
      {
        role: "husband",
        name: "Controlled Learner A",
        phone: "0390000021",
        passwordHash: await hashPassword("controlled-regrade-pass-a"),
      },
      {
        role: "wife",
        name: "Controlled Learner B",
        phone: "0390000022",
        passwordHash: await hashPassword("controlled-regrade-pass-b"),
      },
    ],
  });
  const users = await provisionDuoAccounts(database, settings);
  const bank = Array.from({ length: 5 }, (_, index) =>
    bankItem("grammar", "lesson", index),
  ).concat(
    (["reading", "listening", "writing", "speaking"] as ContentKind[]).map(
      (skill) => bankItem(skill, "full-mock", 0),
    ),
  );
  await database.content.insertMany(
    bank.map((item) => ({ ...item, _id: item.id })),
  );
  let clock = Date.now();
  for (const user of users) {
    const id = randomUUID();
    await database.placements.insertOne({
      _id: id,
      userId: user.id,
      mode: "quick",
      total: 1,
      theta: 0,
      standardError: 1,
      estimatedBand: 4,
      currentQuestionId: null,
      answers: [{ questionId: "controlled", answer: "correct", correct: true }],
      result: baseFeedback(new Date(clock).toISOString()),
      startedAt: new Date(clock).toISOString(),
    });
  }
  const server = createApp(database, {
    production: false,
    // Legacy API/resume fixtures omit monitoring; dedicated native/browser integrity suites cover strict policy.
    examIntegrityEnabled: false,
    duoEnabled: true,
    duoCredentials: settings,
    serveClient: false,
    duo: {
      sessionsPerBand: 5,
      lessonKinds: ["grammar"],
      countdownSeconds: 1,
      now: () => clock,
    },
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const jars: Record<DuoRole, string> = { husband: "", wife: "" };
  const nativeFetch = globalThis.fetch;
  async function request<T>(
    role: DuoRole,
    method: string,
    path: string,
    input?: unknown,
    status = 200,
  ): Promise<T> {
    const response = await nativeFetch(origin + "/api" + path, {
      method,
      headers: {
        ...(jars[role] ? { Cookie: jars[role] } : {}),
        ...(input !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    });
    const data = await response.json();
    assert.equal(
      response.status,
      status,
      `${method} ${path}: ${JSON.stringify(data)}`,
    );
    const cookie = response.headers.getSetCookie().at(-1);
    if (cookie) jars[role] = cookie.split(";")[0];
    return data as T;
  }
  for (const role of roles)
    await request(role, "POST", "/auth/login", {
      phone: settings.accounts.find((account) => account.role === role)!.phone,
      password: `controlled-regrade-pass-${role === "husband" ? "a" : "b"}`,
    });
  async function attempt(
    role: DuoRole,
    contentId: string,
    context?: string,
    submit = true,
  ): Promise<Attempt> {
    const content = await database.content.findOne({ _id: contentId });
    assert.ok(content);
    const started = (
      await request<{ attempt: Attempt }>(
        role,
        "POST",
        "/attempts",
        {
          contentId,
          mode: context ? "exam" : "practice",
          ...(context ? { duoAssessmentId: context } : {}),
        },
        201,
      )
    ).attempt;
    if (submit) {
      await request(
        role,
        "PATCH",
        `/attempts/${started.id}`,
        content.skill === "writing"
          ? { essays: { task1: essay, task2: essay } }
          : content.skill === "speaking"
            ? { transcript }
            : {
                responses: Object.fromEntries(
                  content.questions.map((question) => [
                    question.id,
                    question.answer,
                  ]),
                ),
              },
      );
      return (
        await request<{ attempt: Attempt }>(
          role,
          "POST",
          `/attempts/${started.id}/submit`,
          { feedback: { estimatedBand: 9 }, passed: true },
        )
      ).attempt;
    }
    return started;
  }
  async function prepare(): Promise<Record<DuoRole, DuoAssessmentView>> {
    const state = (
      await request<{ duo: DuoSnapshot }>("husband", "GET", "/duo")
    ).duo;
    const band = state.bands.find((entry) => entry.band === 4)!;
    for (const lesson of band.lessons)
      for (const role of roles) {
        const proof = await attempt(role, lesson.contentId!);
        await request(role, "POST", `/duo/lessons/${lesson.id}/complete`, {
          attemptId: proof.id,
        });
      }
    const room = (
      await request<{ room: DuoRoomView }>(
        "husband",
        "POST",
        "/duo/rooms",
        {},
        201,
      )
    ).room;
    for (const role of roles) {
      await request(role, "POST", `/duo/rooms/${room.id}/join`, {});
      await request(role, "POST", `/duo/rooms/${room.id}/ready`, {
        ready: true,
      });
    }
    clock += 1000;
    const result = {} as Record<DuoRole, DuoAssessmentView>;
    for (const role of roles)
      result[role] = (
        await request<{ assessment: DuoAssessmentView }>(
          role,
          "POST",
          `/duo/rooms/${room.id}/start`,
          {},
        )
      ).assessment;
    return result;
  }
  return {
    database,
    server,
    origin,
    jars,
    clock: () => clock,
    advanceTo: (iso, after = 0) => {
      clock = Math.max(clock, Date.parse(iso) + after);
    },
    request,
    attempt,
    prepare,
    cleanup: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      assert.match(name, /^ielts_duo_regrade_test_[a-f0-9]{32}$/);
      await database.db.dropDatabase();
      await database.client.close();
    },
  };
}

test(
  "Duo regrade HTTP uses saved own work after deadlines, ignores new scores, and waits for acoustic Speaking evidence",
  { timeout: 45_000 },
  async () => {
    const originalFetch = globalThis.fetch;
    const previous = new Map(keys.map((key) => [key, process.env[key]]));
    keys.forEach((key) => delete process.env[key]);
    const f = await setup();
    try {
      const exams = await f.prepare();
      const saved: Record<DuoRole, Attempt[]> = { husband: [], wife: [] };
      for (let index = 0; index < exams.husband.parts.length; index++) {
        f.advanceTo(exams.husband.parts[index].startsAt);
        for (const role of roles)
          saved[role].push(
            await f.attempt(
              role,
              exams[role].parts[index].contentId,
              exams[role].id,
            ),
          );
      }
      assert.equal(saved.husband[2].feedback?.source, "rule-based");
      assert.equal(saved.husband[3].feedback?.estimatedBand, null);
      let state = (
        await f.request<{ duo: DuoSnapshot }>("husband", "GET", "/duo")
      ).duo;
      assert.equal(state.path!.currentBand, 4);
      assert.equal(state.assessments[0].status, "pending-ai");
      f.advanceTo(exams.husband.deadlineAt, 1000);
      await f.request(
        "wife",
        "POST",
        `/attempts/${saved.husband[2].id}/regrade`,
        { estimatedBand: 9 },
        404,
      );
      await f.request(
        "husband",
        "POST",
        `/attempts/${saved.husband[2].id}/regrade`,
        { estimatedBand: 9, essays: { task1: "malicious replacement" } },
        503,
      );
      await f.request(
        "husband",
        "PATCH",
        `/attempts/${saved.husband[2].id}`,
        { essays: { task1: "malicious replacement" } },
        409,
      );
      assert.deepEqual(
        (await f.database.attempts.findOne({ _id: saved.husband[2].id }))!
          .essays,
        { task1: essay, task2: essay },
      );
      process.env.IELTS_OPENAI_API_KEY = "controlled-transport-test-token";
      const requests: { messages: { role: string; content: string }[] }[] = [];
      globalThis.fetch = async (url, init) => {
        assert.equal(
          String(url),
          "https://api.openai.com/v1/chat/completions",
          "Only a controlled provider transport is allowed",
        );
        const payload = JSON.parse(String(init?.body)) as {
          messages: { role: string; content: string }[];
        };
        requests.push(payload);
        const system = payload.messages[0].content;
        const input = JSON.parse(payload.messages[1].content) as {
          tasks?: { task: 1 | 2; essay: string }[];
          transcript?: string;
        };
        let output: unknown;
        if (input.tasks) {
          assert.ok(
            input.tasks.every((task) => task.essay === essay.trim()),
            "Provider sees only saved essays",
          );
          output = system.includes("evidence extractor")
            ? {
                tasks: input.tasks.map((task) => ({
                  task: task.task,
                  quotes: writingNames.map((criterion) => ({
                    criterion,
                    quote: "Public transport",
                    observation: "Controlled exact evidence",
                  })),
                  paragraphs: [
                    {
                      index: 0,
                      quote: "Public transport",
                      feedback: "Controlled paragraph feedback",
                    },
                  ],
                  corrections: [],
                })),
              }
            : {
                summary: "Controlled scorer receipt",
                tasks: input.tasks.map((task) => ({
                  task: task.task,
                  summary: "Controlled task receipt",
                  criteria: writingNames.map((name) => ({
                    name,
                    band: 8,
                    confidence: 0.7,
                    feedback: "Controlled rubric result",
                    evidence: ["Public transport"],
                  })),
                })),
              };
        } else {
          assert.equal(
            input.transcript,
            transcript,
            "Provider sees only the saved transcript",
          );
          output = {
            summary: "Controlled text score, acoustic evidence unavailable",
            criteria: speakingNames.map((name) => ({
              name,
              band: 8,
              confidence: 0.7,
              feedback: "Controlled text advice",
              evidence: ["Public transport"],
            })),
            corrections: [],
          };
        }
        return Response.json({
          choices: [
            {
              message: { content: JSON.stringify(output) },
              finish_reason: "stop",
            },
          ],
        });
      };
      for (const role of roles) {
        const result = (
          await f.request<{ attempt: Attempt }>(
            role,
            "POST",
            `/attempts/${saved[role][2].id}/regrade`,
            { essays: { task1: "malicious replacement" }, estimatedBand: 9 },
          )
        ).attempt;
        assert.equal(result.feedback?.source, "ai");
        assert.equal(result.feedback?.estimatedBand, 8);
        assert.deepEqual(result.essays, { task1: essay, task2: essay });
      }
      const count = requests.length;
      await f.request(
        "husband",
        "POST",
        `/attempts/${saved.husband[2].id}/regrade`,
        { estimatedBand: 9 },
      );
      assert.equal(
        requests.length,
        count,
        "A valid graded receipt is not rescored on retry",
      );
      const speaking = (
        await f.request<{ attempt: Attempt }>(
          "husband",
          "POST",
          `/attempts/${saved.husband[3].id}/regrade`,
          { transcript: "malicious replacement", passed: true },
        )
      ).attempt;
      assert.equal(speaking.feedback?.source, "ai");
      assert.equal(speaking.feedback?.estimatedBand, null);
      assert.equal(
        speaking.feedback?.criteria.find(
          (criterion) => criterion.name === "Pronunciation",
        )!.band,
        null,
      );
      assert.equal(
        speaking.feedback?.criteria.find(
          (criterion) => criterion.name === "Fluency & Coherence",
        )!.band,
        null,
      );
      state = (await f.request<{ duo: DuoSnapshot }>("husband", "GET", "/duo"))
        .duo;
      assert.equal(state.path!.currentBand, 4);
      assert.equal(state.assessments[0].status, "pending-ai");
      const foreign = f.database.recordings.openUploadStream(
        "private-peer-recording",
        {
          metadata: {
            userId: `${"synthetic-regrade-duo"}-wife`,
            attemptId: saved.wife[3].id,
          },
        },
      );
      foreign.end(Buffer.from("Controlled peer-private fixture"));
      await once(foreign, "finish");
      await f.database.audio.insertOne({
        _id: randomUUID(),
        userId: `${"synthetic-regrade-duo"}-husband`,
        attemptId: saved.husband[3].id,
        fileId: foreign.id,
        mime: "audio/wav",
        createdAt: new Date(f.clock()).toISOString(),
      });
      const beforeForeign = await f.database.db
        .collection("recordings.files")
        .findOne({ _id: foreign.id });
      const beforeRequests = requests.length;
      await f.request(
        "husband",
        "POST",
        `/attempts/${saved.husband[3].id}/regrade`,
        {},
        400,
      );
      assert.equal(
        requests.length,
        beforeRequests,
        "Foreign audio is rejected before calling the provider",
      );
      assert.deepEqual(
        await f.database.db
          .collection("recordings.files")
          .findOne({ _id: foreign.id }),
        beforeForeign,
      );
    } finally {
      globalThis.fetch = originalFetch;
      previous.forEach((value, key) =>
        value === undefined
          ? delete process.env[key]
          : (process.env[key] = value),
      );
      await f.cleanup();
    }
  },
);

test(
  "Duo Speaking HTTP rejects new multipart answers after its common section deadline",
  { timeout: 45_000 },
  async () => {
    const previous = new Map(keys.map((key) => [key, process.env[key]]));
    keys.forEach((key) => delete process.env[key]);
    const f = await setup();
    try {
      const exams = await f.prepare();
      for (let index = 0; index < 3; index++) {
        f.advanceTo(exams.husband.parts[index].startsAt);
        await f.attempt(
          "husband",
          exams.husband.parts[index].contentId,
          exams.husband.id,
        );
      }
      f.advanceTo(exams.husband.parts[3].startsAt);
      const unfinished = await f.attempt(
        "husband",
        exams.husband.parts[3].contentId,
        exams.husband.id,
        false,
      );
      f.advanceTo(unfinished.deadlineAt!, 1000);
      const form = new FormData();
      form.append("transcript", transcript);
      form.append(
        "audio",
        new Blob([Buffer.alloc(100)], { type: "audio/wav" }),
        "late.wav",
      );
      const response = await fetch(
        f.origin + `/api/attempts/${unfinished.id}/speaking`,
        { method: "POST", headers: { Cookie: f.jars.husband }, body: form },
      );
      const body = await response.json();
      assert.equal(response.status, 409, JSON.stringify(body));
      const stored = await f.database.attempts.findOne({ _id: unfinished.id });
      assert.ok(stored);
      assert.equal(stored.status, "submitted");
      assert.equal(stored.transcript, "");
      assert.equal(stored.feedback?.estimatedBand, null);
      assert.equal(
        await f.database.audio.countDocuments({ attemptId: unfinished.id }),
        0,
      );
      assert.equal(
        await f.database.db.collection("recordings.files").countDocuments(),
        0,
      );
      const result = (
        await f.request<{ assessment: DuoAssessmentView }>(
          "husband",
          "GET",
          `/duo/assessments/${exams.husband.id}`,
        )
      ).assessment;
      assert.equal(result.parts[3].status, "failed");
      assert.equal(
        (await f.request<{ duo: DuoSnapshot }>("husband", "GET", "/duo")).duo
          .path!.currentBand,
        4,
      );
    } finally {
      previous.forEach((value, key) =>
        value === undefined
          ? delete process.env[key]
          : (process.env[key] = value),
      );
      await f.cleanup();
    }
  },
);

function controlledWav(): Uint8Array<ArrayBuffer> {
  const pcm = Buffer.alloc(32_000);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16_000, 24);
  header.writeUInt32LE(32_000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return new Uint8Array(Buffer.concat([header, pcm]));
}

test(
  "Duo saved raw Speaking recording survives offline STT and deadline, then only that recording is regraded",
  { timeout: 45_000 },
  async () => {
    const previous = new Map(keys.map((key) => [key, process.env[key]]));
    const originalFetch = globalThis.fetch;
    keys.forEach((key) => delete process.env[key]);
    const f = await setup();
    try {
      const exams = await f.prepare();
      for (let index = 0; index < 3; index++) {
        f.advanceTo(exams.husband.parts[index].startsAt);
        await f.attempt(
          "husband",
          exams.husband.parts[index].contentId,
          exams.husband.id,
        );
      }
      f.advanceTo(exams.husband.parts[3].startsAt);
      const attempt = await f.attempt(
        "husband",
        exams.husband.parts[3].contentId,
        exams.husband.id,
        false,
      );
      const recording = controlledWav();
      const form = new FormData();
      form.append(
        "audio",
        new Blob([recording], { type: "audio/wav" }),
        "saved-before-deadline.wav",
      );
      const uploaded = await originalFetch(
        f.origin + `/api/attempts/${attempt.id}/speaking`,
        { method: "POST", headers: { Cookie: f.jars.husband }, body: form },
      );
      const firstBody = await uploaded.json();
      assert.equal(uploaded.status, 503, JSON.stringify(firstBody));
      const saved = await f.database.audio.findOne({ attemptId: attempt.id });
      assert.ok(saved);
      assert.ok(Date.parse(saved.createdAt) <= Date.parse(attempt.deadlineAt!));
      const before = await f.database.db
        .collection("recordings.files")
        .findOne({ _id: saved.fileId });
      assert.ok(before);
      f.advanceTo(attempt.deadlineAt!, 1000);
      const expired = (
        await f.request<{ attempt: Attempt }>(
          "husband",
          "GET",
          `/attempts/${attempt.id}`,
        )
      ).attempt;
      assert.equal(expired.status, "submitted");
      assert.equal(expired.transcript, "");
      assert.equal(expired.feedback?.estimatedBand, null);
      const pending = (
        await f.request<{ assessment: DuoAssessmentView }>(
          "husband",
          "GET",
          `/duo/assessments/${exams.husband.id}`,
        )
      ).assessment;
      assert.equal(
        pending.parts[3].status,
        "pending-ai",
        "Real saved audio is retained as evidence awaiting STT and acoustic assessment",
      );
      await f.request(
        "husband",
        "POST",
        `/attempts/${attempt.id}/regrade`,
        { transcript: "client replacement" },
        503,
      );
      process.env.IELTS_OPENAI_API_KEY = "controlled-recording-transport-token";
      let transcribed = 0;
      globalThis.fetch = async (url, init) => {
        if (String(url) === "https://api.openai.com/v1/audio/transcriptions") {
          transcribed++;
          assert.ok(init?.body instanceof FormData);
          const file = init.body.get("file");
          assert.ok(file instanceof Blob);
          assert.deepEqual(
            new Uint8Array(await file.arrayBuffer()),
            recording,
            "The provider receives only the original saved bytes",
          );
          return Response.json({ text: transcript, duration: 1 });
        }
        assert.equal(String(url), "https://api.openai.com/v1/chat/completions");
        const payload = JSON.parse(String(init?.body));
        assert.equal(
          JSON.parse(payload.messages[1].content).transcript,
          transcript,
        );
        return Response.json({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  summary: "Controlled transcript-only scorer",
                  criteria: speakingNames.map((name) => ({
                    name,
                    band: 8,
                    confidence: 0.7,
                    feedback: "Acoustic evidence is unavailable",
                    evidence: ["Public transport"],
                  })),
                  corrections: [],
                }),
              },
            },
          ],
        });
      };
      const regraded = (
        await f.request<{ attempt: Attempt }>(
          "husband",
          "POST",
          `/attempts/${attempt.id}/regrade`,
          { transcript: "client replacement" },
        )
      ).attempt;
      assert.equal(transcribed, 1);
      assert.equal(regraded.transcript, transcript);
      assert.equal(
        regraded.feedback?.estimatedBand,
        null,
        "No full Speaking band is invented without acoustic evidence",
      );
      assert.deepEqual(
        await f.database.db
          .collection("recordings.files")
          .findOne({ _id: saved.fileId }),
        before,
      );
      assert.equal(
        await f.database.audio.countDocuments({ attemptId: attempt.id }),
        1,
      );
      assert.equal(
        (await f.request<{ duo: DuoSnapshot }>("husband", "GET", "/duo")).duo
          .path!.currentBand,
        4,
      );
    } finally {
      globalThis.fetch = originalFetch;
      previous.forEach((value, key) =>
        value === undefined
          ? delete process.env[key]
          : (process.env[key] = value),
      );
      await f.cleanup();
    }
  },
);
