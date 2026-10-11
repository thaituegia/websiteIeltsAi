import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { createApp } from "../server/app";
import {
  connectDatabase,
  seedDatabase,
  type Database,
} from "../server/storage";
import { hashToken } from "../server/auth";
import type {
  Attempt,
  Dashboard,
  Health,
  PlacementState,
  PlacementSummary,
  Profile,
  StudyPlan,
  VocabularyCard,
} from "../shared/types";

interface Browser {
  cookie: string;
}
interface UserBody {
  user: Profile;
}
interface AttemptBody {
  attempt: Attempt;
}
interface PlacementBody {
  placement: PlacementState;
}
async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
async function body<T>(response: Response, status = 200): Promise<T> {
  const value: unknown = await response.json();
  assert.equal(
    response.status,
    status,
    `Unexpected status; response: ${JSON.stringify(value)}`,
  );
  return value as T;
}
function longWav(size = 17 * 1024 * 1024): Buffer {
  const data = Buffer.alloc(size);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(data.length + 36, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

test(
  "MongoDB API: real accounts, separate owners, persisted learning and private recordings",
  { timeout: 30_000 },
  async (t) => {
    const databaseName = `ielts_ai_test_${randomUUID().replaceAll("-", "")}`;
    assert.match(databaseName, /^ielts_ai_test_[a-f0-9]+$/);
    const uri = process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017";
    let database: Database = await connectDatabase(uri, databaseName);
    let server: Server | undefined;
    let address = "";
    const keys = [
      "IELTS_OPENAI_API_KEY",
      "OPENAI_API_KEY",
      "IELTS_AZURE_SPEECH_KEY",
      "AZURE_SPEECH_KEY",
      "ELEVENLABS_API_KEY",
    ];
    const priorKeys = new Map(keys.map((key) => [key, process.env[key]]));
    keys.forEach((key) => delete process.env[key]);
    async function start(production = false): Promise<void> {
      server = createApp(database, {
        production,
        // Legacy API/resume fixtures omit monitoring; dedicated native/browser integrity suites cover strict policy.
        examIntegrityEnabled: false,
        duoEnabled: false,
        demoEnabled: true,
        maxLearners: 2,
        serveClient: false,
      }).listen(0, "127.0.0.1");
      await once(server, "listening");
      const location = server.address();
      assert.ok(location && typeof location !== "string");
      address = `http://127.0.0.1:${location.port}`;
    }
    async function request(
      browser: Browser | null,
      method: string,
      path: string,
      payload?: unknown,
      headers: Record<string, string> = {},
    ): Promise<Response> {
      const response = await fetch(`${address}/api/${path}`, {
        method,
        headers: {
          ...(browser?.cookie ? { Cookie: browser.cookie } : {}),
          ...(payload === undefined || payload instanceof FormData
            ? {}
            : { "Content-Type": "application/json" }),
          ...headers,
        },
        body:
          payload === undefined
            ? undefined
            : payload instanceof FormData
              ? payload
              : JSON.stringify(payload),
      });
      const cookie = response.headers.getSetCookie().at(-1);
      if (browser && cookie) browser.cookie = cookie.split(";")[0];
      return response;
    }
    async function begin(
      browser: Browser,
      contentId: string,
      mode: "practice" | "exam" = "practice",
    ): Promise<Attempt> {
      const response = await request(browser, "POST", "attempts", {
        contentId,
        mode,
      });
      assert.ok(response.status === 200 || response.status === 201);
      return ((await response.json()) as AttemptBody).attempt;
    }
    const a: Browser = { cookie: "" };
    const b: Browser = { cookie: "" };
    const demo: Browser = { cookie: "" };
    let profileA: Profile;
    let profileB: Profile;
    let readingId = "";
    let savedDraft: Attempt | undefined;
    let savedCard: VocabularyCard | undefined;
    try {
      await seedDatabase(database);
      await start();
      await t.test(
        "health reports actual Mongo counts; private routes need auth; CSRF and invalid JSON rejected",
        async () => {
          const health = await body<Health>(
            await request(null, "GET", "health"),
          );
          assert.equal(health.database, "mongodb");
          assert.equal(
            health.bank.lessons,
            await database.content.countDocuments({ format: "lesson" }),
          );
          assert.equal(
            health.bank.vocabulary,
            await database.vocabulary.countDocuments(),
          );
          assert.ok(health.bank.lessons > 30);
          assert.ok(health.bank.vocabulary > 100);
          await body(await request(null, "GET", "dashboard"), 401);
          await body(
            await request(
              null,
              "POST",
              "auth/demo",
              { learner: 1 },
              { Origin: "https://unrelated.example" },
            ),
            403,
          );
          const malformed = await fetch(`${address}/api/auth/demo`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{",
          });
          await body(malformed, 400);
        },
      );
      await t.test(
        "two concurrent password registrations occupy exactly two real learner slots; demo excluded",
        async () => {
          await body<UserBody>(
            await request(demo, "POST", "auth/demo", { learner: 1 }),
          );
          const candidates = [a, b, { cookie: "" }];
          const registrations = await Promise.all(
            candidates.map((browser, index) =>
              request(browser, "POST", "auth/register", {
                name: `Learner ${index}`,
                email: `learner${index}@example.test`,
                password: "Correct-example-password",
                targetBand: 6.5,
                testType: "academic",
                weeklyMinutes: 60,
                dailyMinutes: 15,
              }),
            ),
          );
          const succeeded = registrations
            .map((response, index) => ({
              response,
              browser: candidates[index],
            }))
            .filter((item) => item.response.status === 201);
          assert.equal(succeeded.length, 2);
          assert.equal(
            registrations.filter((response) => response.status === 409).length,
            1,
          );
          a.cookie = succeeded[0].browser.cookie;
          b.cookie = succeeded[1].browser.cookie;
          profileA = (await body<UserBody>(succeeded[0].response, 201)).user;
          profileB = (await body<UserBody>(succeeded[1].response, 201)).user;
          assert.equal(await database.users.countDocuments({ demo: false }), 2);
          assert.equal(await database.users.countDocuments({ demo: true }), 1);
          assert.notEqual(profileA.id, profileB.id);
          assert.equal("passwordHash" in profileA, false);
          const stored = await database.users.findOne({ _id: profileA.id });
          assert.match(stored?.passwordHash ?? "", /^scrypt:/);
          assert.notEqual(stored?.passwordHash, "Correct-example-password");
          const cookieHeader =
            succeeded[0].response.headers.get("set-cookie") ?? "";
          assert.match(cookieHeader, /HttpOnly/i);
          assert.match(cookieHeader, /SameSite=Lax/i);
          await body(
            await request(null, "POST", "auth/register", {
              name: "Duplicate",
              email: profileA.email,
              password: "Correct-example-password",
              targetBand: 6,
              testType: "academic",
            }),
            409,
          );
          await body(
            await request(null, "POST", "auth/login", {
              email: profileA.email,
              password: "Wrong-example-password",
            }),
            401,
          );
          const empty = await body<Dashboard>(
            await request(a, "GET", "dashboard"),
          );
          assert.equal(empty.completedCount, 0);
          assert.equal(empty.overallBand, null);
          assert.deepEqual(empty.recentAttempts, []);
        },
      );
      await t.test(
        "public content has no answer keys; drafts resume and another owner cannot read or write",
        async () => {
          const lesson = await database.content.findOne({
            skill: "reading",
            format: "lesson",
          });
          assert.ok(lesson);
          readingId = lesson.id;
          const publicContent = await body<{
            content: { questions: Record<string, unknown>[] };
          }>(await request(a, "GET", `content/${readingId}`));
          assert.ok(publicContent.content.questions.length);
          for (const question of publicContent.content.questions)
            for (const field of [
              "answer",
              "acceptedAnswers",
              "evidence",
              "explanation",
            ])
              assert.equal(field in question, false);
          const attempt = await begin(a, readingId);
          const answer = lesson.questions[0].answer;
          const saved = await body<AttemptBody>(
            await request(a, "PATCH", `attempts/${attempt.id}`, {
              responses: { [lesson.questions[0].id]: answer },
              durationSeconds: 800,
              userId: profileB.id,
            }),
          );
          savedDraft = saved.attempt;
          assert.equal(saved.attempt.responses[lesson.questions[0].id], answer);
          assert.ok(saved.attempt.durationSeconds < 800);
          assert.equal((await begin(a, readingId)).id, attempt.id);
          await body(await request(b, "GET", `attempts/${attempt.id}`), 404);
          await body(
            await request(b, "PATCH", `attempts/${attempt.id}`, {
              responses: { [lesson.questions[0].id]: "wrong" },
            }),
            404,
          );
          await body(
            await request(b, "POST", `attempts/${attempt.id}/submit`),
            404,
          );
          await body(
            await request(a, "PATCH", `attempts/${attempt.id}`, {
              responses: { unknownQuestion: "bad" },
            }),
            400,
          );
          assert.ok(lesson.questions.length >= 2);
          const patches = await Promise.all([
            request(a, "PATCH", `attempts/${attempt.id}`, {
              responses: { [lesson.questions[0].id]: answer },
            }),
            request(a, "PATCH", `attempts/${attempt.id}`, {
              responses: {
                [lesson.questions[1].id]: "intentionally incorrect",
              },
            }),
          ]);
          assert.ok(patches.every((response) => response.status === 200));
          const checkpoint = await body<AttemptBody>(
            await request(a, "GET", `attempts/${attempt.id}`),
          );
          assert.equal(
            checkpoint.attempt.responses[lesson.questions[0].id],
            answer,
          );
          assert.equal(
            checkpoint.attempt.responses[lesson.questions[1].id],
            "intentionally incorrect",
          );
          savedDraft = checkpoint.attempt;
          const owned = await database.attempts.findOne({ _id: attempt.id });
          assert.equal(owned?.userId, profileA.id);
        },
      );
      await t.test(
        "FSRS cards save idempotently, review real schedule, and remain private",
        async () => {
          const lesson = await database.content.findOne({ _id: readingId });
          const vocabularyId =
            lesson?.vocabularyIds[0] ??
            (await database.vocabulary.findOne({}))?.id;
          assert.ok(vocabularyId);
          const first = await body<{ card: VocabularyCard }>(
            await request(a, "POST", "vocabulary/cards", { vocabularyId }),
            201,
          );
          savedCard = first.card;
          const duplicate = await body<{ card: VocabularyCard }>(
            await request(a, "POST", "vocabulary/cards", { vocabularyId }),
          );
          assert.equal(first.card.id, duplicate.card.id);
          assert.equal(first.card.reps, 0);
          assert.equal(first.card.due, true);
          await body(
            await request(
              b,
              "POST",
              `vocabulary/cards/${first.card.id}/review`,
              { rating: 4 },
            ),
            404,
          );
          const reviewed = await body<{ card: VocabularyCard }>(
            await request(
              a,
              "POST",
              `vocabulary/cards/${first.card.id}/review`,
              { rating: 4 },
            ),
          );
          savedCard = reviewed.card;
          assert.equal(reviewed.card.reps, 1);
          assert.ok(reviewed.card.stability > 0);
          assert.ok(Date.parse(reviewed.card.dueAt) > Date.now());
          assert.equal(reviewed.card.due, false);
          assert.equal(
            (
              await body<{ cards: VocabularyCard[] }>(
                await request(b, "GET", "vocabulary/cards"),
              )
            ).cards.length,
            0,
          );
        },
      );
      await t.test(
        "reconnecting MongoDB and restarting app preserves drafts, cookies and FSRS",
        async () => {
          assert.ok(server && savedDraft && savedCard);
          await close(server);
          server = undefined;
          await database.client.close();
          database = await connectDatabase(uri, databaseName);
          await start();
          const restored = await body<AttemptBody>(
            await request(a, "GET", `attempts/${savedDraft.id}`),
          );
          assert.deepEqual(restored.attempt.responses, savedDraft.responses);
          assert.equal((await begin(a, readingId)).id, savedDraft.id);
          const cards = await body<{ cards: VocabularyCard[] }>(
            await request(a, "GET", "vocabulary/cards"),
          );
          assert.equal(cards.cards[0].reps, savedCard.reps);
          assert.equal(cards.cards[0].dueAt, savedCard.dueAt);
          const counts = [
            await database.users.countDocuments(),
            await database.attempts.countDocuments(),
            await database.cards.countDocuments(),
            await database.content.countDocuments(),
          ];
          await seedDatabase(database);
          assert.deepEqual(
            [
              await database.users.countDocuments(),
              await database.attempts.countDocuments(),
              await database.cards.countDocuments(),
              await database.content.countDocuments(),
            ],
            counts,
          );
        },
      );
      await t.test(
        "short drill gets raw score but no band; concurrent submission stores only one result",
        async () => {
          assert.ok(savedDraft);
          const responses = await Promise.all(
            Array.from({ length: 6 }, () =>
              request(a, "POST", `attempts/${savedDraft?.id}/submit`),
            ),
          );
          assert.ok(responses.some((response) => response.status === 200));
          assert.ok(
            responses.every((response) => [200, 409].includes(response.status)),
          );
          const attempts = await body<{
            attempts: { id: string; status: string }[];
          }>(await request(a, "GET", "attempts"));
          assert.equal(
            attempts.attempts.filter((attempt) => attempt.id === savedDraft?.id)
              .length,
            1,
          );
          const result = await body<AttemptBody>(
            await request(a, "GET", `attempts/${savedDraft.id}`),
          );
          assert.equal(result.attempt.status, "submitted");
          assert.equal(result.attempt.feedback?.estimatedBand, null);
          assert.equal(result.attempt.feedback?.rawScore, 1);
          assert.equal(
            result.attempt.feedback?.answers.length,
            result.attempt.content.questions.length,
          );
          const repeated = await body<AttemptBody>(
            await request(a, "POST", `attempts/${savedDraft.id}/submit`),
          );
          assert.equal(
            repeated.attempt.feedback?.id,
            result.attempt.feedback?.id,
          );
          await body(
            await request(a, "PATCH", `attempts/${savedDraft.id}`, {
              durationSeconds: 1,
            }),
            409,
          );
        },
      );
      await t.test(
        "40-item Reading and Listening full forms grade server-only answers using reference bands",
        async () => {
          for (const skill of ["reading", "listening"] as const) {
            const mock = await database.content.findOne({
              skill,
              format: "full-mock",
              ...(skill === "reading" ? { testType: "academic" } : {}),
            });
            assert.ok(mock);
            assert.equal(mock.questions.length, 40);
            const attempt = await begin(a, mock.id);
            await body(
              await request(a, "PATCH", `attempts/${attempt.id}`, {
                responses: Object.fromEntries(
                  mock.questions.map((question) => [
                    question.id,
                    question.type === "choice-multiple"
                      ? JSON.stringify(mock.questions.filter(other => other.selectionGroup?.id === question.selectionGroup?.id).map(other => other.answer))
                      : question.answer,
                  ]),
                ),
              }),
            );
            const graded = await body<AttemptBody>(
              await request(a, "POST", `attempts/${attempt.id}/submit`),
            );
            assert.equal(graded.attempt.feedback?.rawScore, 40);
            assert.equal(graded.attempt.feedback?.total, 40);
            assert.equal(graded.attempt.feedback?.estimatedBand, 9);
          }
        },
      );
      await t.test(
        "exam listening source is redacted, one-play state persists, and server deadline cannot be reset",
        async () => {
          const listening = await database.content.findOne({
            skill: "listening",
            format: "full-mock",
          });
          assert.ok(listening);
          const attempt = await begin(a, listening.id, "exam");
          assert.ok(attempt.deadlineAt);
          assert.ok(
            attempt.content.sections.every(
              (section) => !section.text && !section.dialogue,
            ),
          );
          const content = await body<{
            content: { sections: { text: string }[] };
          }>(await request(a, "GET", `content/${listening.id}`));
          assert.ok(content.content.sections.every((section) => !section.text));
          const script = await body<{
            sections: { text: string }[];
            source: string;
          }>(
            await request(a, "POST", `attempts/${attempt.id}/listening-source`),
          );
          assert.equal(script.source, "browser-tts");
          assert.ok(
            script.sections.some((section) => section.text.length > 50),
          );
          await body(
            await request(a, "POST", `attempts/${attempt.id}/listening-source`),
            409,
          );
          assert.equal(
            (await begin(a, listening.id, "exam")).deadlineAt,
            attempt.deadlineAt,
          );
          await body(
            await request(b, "POST", `attempts/${attempt.id}/listening-source`),
            404,
          );
          const unchanged = await body<AttemptBody>(
            await request(a, "PATCH", `attempts/${attempt.id}`, {
              deadlineAt: "2099-01-01T00:00:00Z",
            }),
          );
          assert.equal(unchanged.attempt.deadlineAt, attempt.deadlineAt);
          await database.attempts.updateOne(
            { _id: attempt.id, userId: profileA.id },
            { $set: { deadlineAt: new Date(Date.now() - 1000).toISOString() } },
          );
          const expired = await body<AttemptBody>(
            await request(a, "GET", `attempts/${attempt.id}`),
          );
          assert.equal(expired.attempt.status, "submitted");
          assert.ok(
            expired.attempt.content.sections.some((section) => section.text),
          );
          await body(
            await request(a, "PATCH", `attempts/${attempt.id}`, {
              responses: {},
            }),
            409,
          );
        },
      );
      await t.test(
        "quick and deep CAT expose no answers, adapt, avoid repeats and resume correct question",
        async () => {
          for (const mode of ["quick", "deep"] as const) {
            let placement = (
              await body<PlacementBody>(
                await request(b, "POST", "placement/start", { mode }),
                201,
              )
            ).placement;
            const seen = new Set<string>();
            assert.equal(placement.total, mode === "quick" ? 15 : 30);
            const startTheta = placement.theta;
            await body(
              await request(a, "GET", `placement/${placement.id}`),
              404,
            );
            await body(
              await request(b, "POST", `placement/${placement.id}/answer`, {
                questionId: "unknown",
                answer: "A",
              }),
              409,
            );
            for (let index = 0; index < placement.total; index++) {
              const question = placement.question;
              assert.ok(question);
              assert.equal("answer" in question, false);
              assert.equal("explanation" in question, false);
              assert.equal(seen.has(question.id), false);
              seen.add(question.id);
              if (index === 1) {
                const active = await body<{ placement: PlacementState }>(
                  await request(b, "GET", "placement/active"),
                );
                assert.equal(active.placement.question?.id, question.id);
                const resumed = await body<PlacementBody>(
                  await request(b, "POST", "placement/start", { mode }),
                );
                assert.equal(resumed.placement.id, placement.id);
              }
              const privateItem = await database.placementItems.findOne({
                _id: question.id,
              });
              assert.ok(privateItem);
              const answer =
                mode === "quick"
                  ? privateItem.answer
                  : privateItem.options.find(
                      (option) => option !== privateItem.answer,
                    );
              assert.ok(answer);
              placement = (
                await body<PlacementBody>(
                  await request(b, "POST", `placement/${placement.id}/answer`, {
                    questionId: question.id,
                    answer,
                  }),
                )
              ).placement;
            }
            assert.equal(placement.completed, placement.total);
            assert.equal(placement.question, null);
            assert.ok(placement.result);
            assert.equal(placement.result.total, placement.total);
            assert.ok(
              mode === "quick"
                ? placement.theta > startTheta
                : placement.theta < startTheta,
            );
          }
        },
      );
      await t.test(
        "placement history includes only the owner's diagnostics without private questions or answers",
        async () => {
          await body(await request(null, "GET", "placement/history"), 401);
          const historyA = await body<{ placements: PlacementSummary[] }>(
            await request(a, "GET", "placement/history"),
          );
          const historyB = await body<{ placements: PlacementSummary[] }>(
            await request(b, "GET", "placement/history"),
          );
          assert.equal(historyA.placements.length, 0);
          assert.equal(historyB.placements.length, 2);
          assert.equal(historyB.placements[0].mode, "deep");
          assert.ok(
            historyB.placements.every(
              (item, index, items) =>
                index === 0 ||
                Date.parse(items[index - 1].startedAt) >=
                  Date.parse(item.startedAt),
            ),
          );
          for (const item of historyB.placements) {
            assert.equal(item.completed, item.total);
            assert.ok(item.result);
            assert.equal(item.estimatedBand, item.result.estimatedBand);
            for (const key of [
              "userId",
              "_id",
              "answers",
              "currentQuestionId",
              "question",
            ])
              assert.equal(key in item, false);
          }
        },
      );
      await t.test(
        "offline Writing saves both task drafts and feedback but assigns no fabricated band",
        async () => {
          const writing = await database.content.findOne({
            skill: "writing",
            format: "full-mock",
          });
          assert.ok(writing);
          const attempt = await begin(a, writing.id);
          const essays = Object.fromEntries(
            writing.sections.map((section) => [
              section.id,
              "An original short draft.\n\nA second paragraph explains my view.",
            ]),
          );
          await body(
            await request(a, "PATCH", `attempts/${attempt.id}`, { essays }),
          );
          const graded = await body<AttemptBody>(
            await request(a, "POST", `attempts/${attempt.id}/submit`),
          );
          assert.equal(graded.attempt.feedback?.estimatedBand, null);
          assert.equal(graded.attempt.feedback?.source, "rule-based");
          assert.equal(graded.attempt.feedback?.taskScores?.length, 2);
          assert.deepEqual(graded.attempt.essays, essays);
          assert.ok((graded.attempt.feedback?.wordCount ?? 0) > 0);
        },
      );
      await t.test(
        "typed Speaking supports SSE without inventing pronunciation or overall band",
        async () => {
          const speaking = await database.content.findOne({
            skill: "speaking",
            format: "full-mock",
          });
          assert.ok(speaking);
          const attempt = await begin(a, speaking.id);
          const form = new FormData();
          form.append(
            "transcript",
            "Um, I enjoy reading because it helps me explore different viewpoints. You know, books can connect people.",
          );
          const response = await request(
            a,
            "POST",
            `attempts/${attempt.id}/speaking`,
            form,
            { Accept: "text/event-stream" },
          );
          assert.equal(response.status, 200);
          assert.match(
            response.headers.get("content-type") ?? "",
            /text\/event-stream/,
          );
          const text = await response.text();
          assert.match(text, /event: result/);
          assert.doesNotMatch(text, /event: error/);
          const result = (
            await body<AttemptBody>(
              await request(a, "GET", `attempts/${attempt.id}`),
            )
          ).attempt;
          assert.equal(result.feedback?.estimatedBand, null);
          assert.equal(result.feedback?.pronunciation, null);
          assert.equal(result.feedback?.fillerCount, 2);
          assert.match(result.transcript, /reading/);
        },
      );
      await t.test(
        "unconfigured audio STT keeps private recording and retry can use it with a typed transcript",
        async () => {
          const speaking = await database.content.findOne({
            skill: "speaking",
            format: "full-mock",
          });
          assert.ok(speaking);
          const attempt = await begin(a, speaking.id);
          const form = new FormData();
          const recording = longWav(32_000);
          form.append(
            "audio",
            new Blob([new Uint8Array(recording)], { type: "audio/wav" }),
            "retry-recording.wav",
          );
          await body(
            await request(a, "POST", `attempts/${attempt.id}/speaking`, form),
            503,
          );
          const draft = (
            await body<AttemptBody>(
              await request(a, "GET", `attempts/${attempt.id}`),
            )
          ).attempt;
          assert.equal(draft.status, "in-progress");
          assert.equal(draft.audioAvailable, true);
          assert.equal(draft.feedback, null);
          const retry = new FormData();
          retry.append(
            "transcript",
            "I can use this typed transcript for self-practice while STT is unconfigured.",
          );
          const submitted = (
            await body<AttemptBody>(
              await request(
                a,
                "POST",
                `attempts/${attempt.id}/speaking`,
                retry,
              ),
            )
          ).attempt;
          assert.equal(submitted.status, "submitted");
          assert.equal(submitted.audioAvailable, true);
          assert.equal(submitted.feedback?.estimatedBand, null);
          assert.equal(
            await database.audio.countDocuments({
              attemptId: attempt.id,
              userId: profileA.id,
            }),
            1,
          );
        },
      );
      await t.test(
        "blank timed Writing and Speaking expire with no fabricated score or required provider",
        async () => {
          for (const skill of ["writing", "speaking"] as const) {
            const content = await database.content.findOne({
              skill,
              format: "full-mock",
            });
            assert.ok(content);
            const attempt = await begin(a, content.id, "exam");
            await database.attempts.updateOne(
              { _id: attempt.id, userId: profileA.id },
              {
                $set: { deadlineAt: new Date(Date.now() - 1000).toISOString() },
              },
            );
            const expired = (
              await body<AttemptBody>(
                await request(a, "GET", `attempts/${attempt.id}`),
              )
            ).attempt;
            assert.equal(expired.status, "submitted");
            assert.equal(expired.feedback?.estimatedBand, null);
            assert.equal(expired.feedback?.source, "rule-based");
            await body(
              await request(a, "PATCH", `attempts/${attempt.id}`, {
                transcript: "Late edit",
              }),
              409,
            );
          }
        },
      );
      await t.test(
        "17 MB recording is stored in GridFS and downloaded only by its owner",
        async () => {
          const speaking = await database.content.findOne({
            skill: "speaking",
            format: "full-mock",
          });
          assert.ok(speaking);
          const attempt = await begin(b, speaking.id);
          const recording = longWav();
          const form = new FormData();
          form.append(
            "audio",
            new Blob([new Uint8Array(recording)], { type: "audio/wav" }),
            "private-long-recording.wav",
          );
          form.append(
            "transcript",
            "This typed transcript supports an offline self-practice checklist.",
          );
          const submitted = await body<AttemptBody>(
            await request(b, "POST", `attempts/${attempt.id}/speaking`, form),
          );
          assert.equal(submitted.attempt.audioAvailable, true);
          assert.equal(submitted.attempt.feedback?.estimatedBand, null);
          const metadata = await database.audio.findOne({
            attemptId: attempt.id,
            userId: profileB.id,
          });
          assert.ok(metadata?.fileId);
          assert.equal("buffer" in metadata, false);
          assert.ok(
            (await database.db
              .collection("recordings.chunks")
              .countDocuments({ files_id: metadata.fileId })) > 1,
          );
          await body(
            await request(a, "GET", `attempts/${attempt.id}/audio`),
            404,
          );
          const audio = await request(b, "GET", `attempts/${attempt.id}/audio`);
          assert.equal(audio.status, 200);
          assert.match(audio.headers.get("content-type") ?? "", /audio\/wav/);
          assert.ok(Buffer.from(await audio.arrayBuffer()).equals(recording));
        },
      );
      await t.test(
        "profile creates a budget-aware plan, colon task IDs work, and export excludes auth secrets",
        async () => {
          await body(
            await request(a, "PATCH", "profile", {
              targetBand: 7,
              weeklyMinutes: 90,
              dailyMinutes: 15,
              testType: "general",
              selfAssessment: {
                reading: 5,
                listening: 5,
                writing: 4.5,
                speaking: 4.5,
              },
            }),
          );
          const plan = (
            await body<{ plan: StudyPlan }>(await request(a, "GET", "plan"))
          ).plan;
          assert.ok(plan.tasks.length);
          assert.ok(
            plan.tasks.reduce((sum, task) => sum + task.minutes, 0) <= 90,
          );
          const task = plan.tasks[0];
          const changed = await body<{ plan: StudyPlan }>(
            await request(
              a,
              "PATCH",
              `plan/tasks/${encodeURIComponent(task.id)}`,
              { completed: true },
            ),
          );
          assert.equal(
            changed.plan.tasks.find((item) => item.id === task.id)?.completed,
            true,
          );
          const exported = await body<{
            profile: Profile;
            attempts: { id: string }[];
            recordings: { attemptId: string }[];
          }>(await request(a, "GET", "account/export"));
          const serialized = JSON.stringify(exported);
          assert.equal(exported.profile.id, profileA.id);
          assert.doesNotMatch(
            serialized,
            /passwordHash|ielts_session|Correct-example-password/,
          );
          const ownedIds = new Set(
            (
              await database.attempts.find({ userId: profileA.id }).toArray()
            ).map((attempt) => attempt.id),
          );
          assert.ok(
            exported.attempts.every((attempt) => ownedIds.has(attempt.id)),
          );
          assert.equal(exported.recordings.length, 1);
          assert.ok(
            exported.recordings.every((recording) =>
              ownedIds.has(recording.attemptId),
            ),
          );
        },
      );
      await t.test(
        "clearing one history preserves the other owner's progress and account; logout expires access",
        async () => {
          const countB = await database.attempts.countDocuments({
            userId: profileB.id,
          });
          const placementsB = await database.placements.countDocuments({
            userId: profileB.id,
          });
          assert.ok(countB > 0);
          await body(
            await request(a, "DELETE", "account/history", { confirm: true }),
          );
          assert.equal(
            await database.attempts.countDocuments({ userId: profileA.id }),
            0,
          );
          assert.equal(
            await database.cards.countDocuments({ userId: profileA.id }),
            0,
          );
          assert.equal(
            await database.attempts.countDocuments({ userId: profileB.id }),
            countB,
          );
          assert.equal(
            await database.placements.countDocuments({ userId: profileB.id }),
            placementsB,
          );
          assert.ok(await database.users.findOne({ _id: profileA.id }));
          const priorCookie = a.cookie;
          await body(await request(a, "POST", "auth/logout"));
          await body(
            await request({ cookie: priorCookie }, "GET", "dashboard"),
            401,
          );
          const expiredBrowser: Browser = { cookie: "" };
          await body(
            await request(expiredBrowser, "POST", "auth/login", {
              email: profileA.email,
              password: "Correct-example-password",
            }),
          );
          const token = expiredBrowser.cookie.split("=")[1];
          await database.sessions.updateOne(
            { _id: hashToken(token) },
            { $set: { expiresAt: new Date(Date.now() - 1000) } },
          );
          await body(await request(expiredBrowser, "GET", "dashboard"), 401);
        },
      );
      await t.test(
        "production cookies are Secure and CSP permits private blob audio",
        async () => {
          assert.ok(server);
          await close(server);
          server = undefined;
          await start(true);
          const response = await request(null, "POST", "auth/login", {
            email: profileA.email,
            password: "Correct-example-password",
          });
          assert.equal(response.status, 200);
          assert.match(response.headers.get("set-cookie") ?? "", /Secure/);
          assert.match(
            response.headers.get("content-security-policy") ?? "",
            /media-src 'self' blob:/,
          );
          assert.equal(response.headers.get("cache-control"), "no-store");
        },
      );
    } finally {
      if (server) await close(server);
      if (
        database.db.databaseName === databaseName &&
        /^ielts_ai_test_[a-f0-9]+$/.test(databaseName)
      )
        await database.db.dropDatabase();
      await database.client.close();
      priorKeys.forEach((value, key) => {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      });
    }
  },
);
