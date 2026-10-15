import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { test } from "node:test";
import { createApp } from "../server/app";
import { gradeObjective } from "../server/learning";
import { connectDatabase, type AttemptRecord } from "../server/storage";
import type { ContentProgress, LibraryResult, StoredContent } from "../shared/types";

const timestamp = "2026-10-15T10:00:00.000Z";
const summaryKeys = ["contentId", "durationSeconds", "estimatedBand", "feedbackSource", "id", "mode", "rawScore", "skill", "startedAt", "status", "submittedAt", "title", "total"].sort();

function fixture(id: string, title: string): StoredContent {
  return {
    id, title, skill: "reading", description: "A synthetic progress fixture.", topic: "Education", band: 5,
    cefr: "B1", testType: "academic", durationMinutes: 10, format: "lesson", vocabularyIds: [], tags: [],
    source: "authored", quality: "authored-unreviewed", createdAt: timestamp,
    sections: [{ id: `${id}-section`, title: "Workshop", text: "The community workshop takes place on Thursday." }],
    questions: [{ id: `${id}-q`, number: 1, sectionIndex: 0, type: "text", prompt: "On which day is the workshop?", answer: "Thursday", acceptedAnswers: ["Thu"], explanation: "PRIVATE_PROGRESS_EXPLANATION", evidence: "PRIVATE_PROGRESS_EVIDENCE", subskill: "details" }],
  };
}

test("completed library exercises expose private latest results and preserve them across redo drafts", { timeout: 60_000 }, async t => {
  const name = `ielts_content_progress_test_${randomUUID().replaceAll("-", "")}`;
  assert.match(name, /^ielts_content_progress_test_[a-f0-9]{32}$/);
  const database = await connectDatabase("mongodb://127.0.0.1:27017", name);
  let server: Server | undefined, origin = "", now = Date.parse(timestamp);
  const cookies = { a: "", b: "" }, users = { a: "", b: "" };
  const [history, redo, ties, empty] = [fixture("progress-history", "Amber history"), fixture("progress-redo", "Birch redo"), fixture("progress-ties", "Cedar ties"), fixture("progress-empty", "Dahlia untouched")];

  async function request(who: "a" | "b" | null, method: string, path: string, payload?: unknown, expected = 200) {
    const response = await fetch(`${origin}/api${path}`, {
      method, headers: { ...(who ? { Cookie: cookies[who] } : {}), ...(payload === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    const body = await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(body)}`);
    const cookie = response.headers.getSetCookie().at(-1);
    if (who && cookie) cookies[who] = cookie.split(";")[0];
    return { body, headers: response.headers };
  }
  async function progress(item: StoredContent, who: "a" | "b" = "a", mode = "practice"): Promise<ContentProgress> {
    const result = await request(who, "GET", `/content/${item.id}/progress?mode=${mode}`);
    assert.equal(result.headers.get("cache-control"), "private, no-store");
    return result.body.progress;
  }
  async function completed(item: StoredContent, extra: Partial<AttemptRecord> = {}): Promise<AttemptRecord> {
    const id = randomUUID(), feedback = gradeObjective(item, { [item.questions[0].id]: "Thursday" });
    const row: AttemptRecord = {
      _id: id, id, userId: users.a, contentId: item.id, title: item.title, skill: "reading", mode: "practice", status: "submitted",
      startedAt: "2026-10-10T10:00:00.000Z", submittedAt: "2026-10-10T11:00:00.000Z", deadlineAt: null, durationSeconds: 60,
      responses: { [item.questions[0].id]: "PRIVATE_PROGRESS_RESPONSE" }, essays: { private: "PRIVATE_PROGRESS_ESSAY" },
      transcript: "PRIVATE_PROGRESS_TRANSCRIPT", feedback, ...extra,
    };
    await database.attempts.insertOne(row);
    return row;
  }

  try {
    await database.content.insertMany([history, redo, ties, empty].map(item => ({ ...item, _id: item.id })));
    server = createApp(database, { serveClient: false, duoEnabled: false, demoEnabled: false, maxLearners: 2, examIntegrityEnabled: false, duo: { now: () => now } }).listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address(); assert.ok(address && typeof address !== "string");
    origin = `http://127.0.0.1:${address.port}`;
    for (const who of ["a", "b"] as const) {
      users[who] = (await request(who, "POST", "/auth/register", {
        name: `Synthetic Progress ${who}`, email: `synthetic-progress-${who}@example.test`,
        password: "synthetic-progress-password", targetBand: 6.5, testType: "academic",
      }, 201)).body.user.id;
    }

    await t.test("untouched items have empty progress and read access requires authentication", async () => {
      assert.deepEqual(await progress(empty), { latestAttempt: null, activeAttemptId: null, completedCount: 0 });
      await request(null, "GET", `/content/${empty.id}/progress`, undefined, 401);
      await request(null, "GET", "/content", undefined, 401);
      await request("a", "GET", "/content/nonexistent-progress-content/progress", undefined, 404);
      await request("a", "GET", `/content/${empty.id}/progress?mode=duo`, undefined, 400);
      await request("a", "GET", "/content?mode=duo", undefined, 400);
    });

    let latest: AttemptRecord;
    await t.test("latest means last submitted, scoped to owner, mode and valid standalone completions", async () => {
      await completed(history);
      // This sitting started later but was submitted earlier than `latest`.
      await completed(history, { startedAt: "2026-10-12T09:00:00.000Z", submittedAt: "2026-10-12T10:00:00.000Z" });
      latest = await completed(history, { startedAt: "2026-10-11T09:00:00.000Z", submittedAt: "2026-10-13T10:00:00.000Z", feedback: gradeObjective(history, {}) });
      const other = await completed(history, { userId: users.b, submittedAt: "2026-10-14T10:00:00.000Z" });
      const exam = await completed(history, { mode: "exam", submittedAt: "2026-10-14T10:00:00.000Z" });
      await completed(history, { duoAssessmentId: "synthetic-duo-assessment", submittedAt: "2026-10-15T09:59:00.000Z" });
      await completed(history, { status: "invalidated", invalidatedAt: timestamp, submittedAt: "2026-10-15T09:59:00.000Z" });
      await completed(history, { invalidatedAt: timestamp, submittedAt: "2026-10-15T09:59:00.000Z" });
      await completed(history, { submittedAt: null });
      const before = await database.attempts.find({}).sort({ _id: 1 }).toArray();
      const result = await progress(history);
      assert.equal(result.latestAttempt?.id, latest.id);
      assert.equal(result.latestAttempt?.rawScore, 0, "A lower newest score replaces a previous higher score");
      assert.equal(result.completedCount, 3);
      assert.equal((await progress(history, "b")).latestAttempt?.id, other.id);
      assert.equal((await progress(history, "a", "exam")).latestAttempt?.id, exam.id);
      assert.deepEqual(await database.attempts.find({}).sort({ _id: 1 }).toArray(), before, "Progress GETs never mutate history or grade a draft");
    });

    await t.test("library progress is page limited, private and contains summaries without answer material", async () => {
      const result = await request("a", "GET", "/content?pageSize=1");
      assert.equal(result.headers.get("cache-control"), "private, no-store");
      const library = result.body as LibraryResult;
      assert.deepEqual(library.items.map(item => item.id), [history.id]);
      assert.deepEqual(Object.keys(library.progress!), [history.id]);
      assert.equal(library.progress![history.id].latestAttempt?.id, latest.id);
      assert.deepEqual(Object.keys(library.progress![history.id].latestAttempt!).sort(), summaryKeys);
      const json = JSON.stringify(library);
      assert.equal(json.includes("PRIVATE_PROGRESS_"), false);
      for (const question of library.items[0].questions) {
        for (const key of ["answer", "acceptedAnswers", "explanation", "evidence"]) assert.equal(key in question, false);
      }
      const exam = (await request("a", "GET", "/content?pageSize=1&mode=exam")).body as LibraryResult;
      assert.equal(exam.progress![history.id].latestAttempt?.mode, "exam");
      const blank = (await request("a", "GET", "/content?pageSize=1&page=100")).body as LibraryResult;
      assert.deepEqual(blank.progress, {});
    });

    await t.test("identical submission timestamps use startedAt then ID as deterministic tie breakers", async () => {
      await completed(ties, { _id: "progress-tie-older", id: "progress-tie-older", startedAt: "2026-10-09T10:00:00.000Z" });
      await completed(ties, { _id: "progress-tie-a", id: "progress-tie-a" });
      const winner = await completed(ties, { _id: "progress-tie-z", id: "progress-tie-z" });
      assert.equal((await progress(ties)).latestAttempt?.id, winner.id);
      assert.equal((await progress(ties)).completedCount, 3);
    });

    await t.test("redo starts blank, resumes one active attempt and retains the old result until a new submission", async () => {
      const first = (await request("a", "POST", "/attempts", { contentId: redo.id }, 201)).body.attempt;
      await request("a", "PATCH", `/attempts/${first.id}`, { responses: { [redo.questions[0].id]: "Thursday" } });
      const submitted = (await request("a", "POST", `/attempts/${first.id}/submit`, {})).body.attempt;
      assert.equal(submitted.feedback.rawScore, 1);
      assert.equal((await progress(redo)).latestAttempt?.id, first.id);
      now += 1_000;
      const again = (await request("a", "POST", "/attempts", { contentId: redo.id }, 201)).body.attempt;
      assert.notEqual(again.id, first.id);
      assert.deepEqual(again.responses, {}); assert.deepEqual(again.essays, {});
      assert.equal(again.transcript, ""); assert.equal(again.feedback, null); assert.equal(again.audioAvailable, false);
      assert.equal((await request("a", "POST", "/attempts", { contentId: redo.id })).body.attempt.id, again.id);
      const unfinished = await progress(redo);
      assert.equal(unfinished.latestAttempt?.id, first.id); assert.equal(unfinished.activeAttemptId, again.id); assert.equal(unfinished.completedCount, 1);
      assert.equal((await progress(redo, "b")).latestAttempt, null);
      assert.equal((await progress(redo, "a", "exam")).latestAttempt, null);
      await request("a", "PATCH", `/attempts/${again.id}`, { responses: { [redo.questions[0].id]: "Tuesday" } });
      assert.equal((await progress(redo)).latestAttempt?.id, first.id);
      now += 1_000;
      await request("a", "POST", `/attempts/${again.id}/submit`, {});
      const last = await progress(redo);
      assert.equal(last.latestAttempt?.id, again.id); assert.equal(last.latestAttempt?.rawScore, 0);
      assert.equal(last.activeAttemptId, null); assert.equal(last.completedCount, 2);
      assert.equal((await database.attempts.findOne({ _id: first.id }))?.feedback?.rawScore, 1, "The old score remains intact in history");
      assert.equal((await request("a", "GET", `/attempts/${first.id}`)).body.attempt.feedback.rawScore, 1);
    });

    await t.test("an invalidated redo cannot displace the previous completed result", async () => {
      const last = await progress(redo);
      now += 1_000;
      const pending = (await request("a", "POST", "/attempts", { contentId: redo.id }, 201)).body.attempt;
      await database.attempts.updateOne({ _id: pending.id }, { $set: { status: "invalidated", invalidatedAt: timestamp } });
      assert.deepEqual(await progress(redo), last);
    });

    await t.test("replacement exam sittings update original and actual cards once each without escaping page or ownership scope", async () => {
      const root = fixture("progress-lineage-root", "Replacement lineage original");
      const variant = fixture("progress-lineage-variant", "Replacement lineage variant");
      await database.content.insertMany([root, variant].map(item => ({ ...item, _id: item.id })));
      const original = await completed(root, { mode: "exam", rootContentId: root.id });
      await completed(root, {
        mode: "exam", status: "invalidated", rootContentId: root.id,
        invalidatedAt: timestamp, replacementContentId: variant.id,
      });
      const otherOwner = await completed(variant, { userId: users.b, mode: "exam", rootContentId: root.id, submittedAt: "2026-10-16T10:00:00.000Z" });
      const otherMode = await completed(variant, { mode: "practice", rootContentId: root.id, submittedAt: "2026-10-16T10:00:00.000Z" });
      await completed(variant, { mode: "exam", rootContentId: root.id, duoAssessmentId: "synthetic-lineage-duo", submittedAt: "2026-10-16T10:00:00.000Z" });
      await completed(variant, { mode: "exam", rootContentId: root.id, invalidatedAt: timestamp, submittedAt: "2026-10-16T10:00:00.000Z" });

      now += 1_000;
      const active = (await request("a", "POST", "/attempts", { contentId: root.id, mode: "exam" }, 201)).body.attempt;
      assert.equal(active.contentId, variant.id, "Existing integrity replacement routing still selects the real new paper");
      const pendingRoot = await progress(root, "a", "exam"), pendingVariant = await progress(variant, "a", "exam");
      assert.equal(pendingRoot.latestAttempt?.id, original.id);
      assert.equal(pendingRoot.completedCount, 1, "rootContentId equal to contentId must not count a sitting twice");
      assert.equal(pendingRoot.activeAttemptId, active.id);
      assert.deepEqual(pendingVariant, { latestAttempt: null, activeAttemptId: active.id, completedCount: 0 });
      const rootOnly = (await request("a", "GET", "/content?q=Replacement%20lineage&pageSize=1&mode=exam")).body as LibraryResult;
      assert.deepEqual(Object.keys(rootOnly.progress!), [root.id]);
      assert.equal(rootOnly.progress![root.id].activeAttemptId, active.id);

      await request("a", "PATCH", `/attempts/${active.id}`, { responses: { [variant.questions[0].id]: "Tuesday" } });
      now += 1_000;
      await request("a", "POST", `/attempts/${active.id}/submit`, {});
      const finishedRoot = await progress(root, "a", "exam"), finishedVariant = await progress(variant, "a", "exam");
      assert.equal(finishedRoot.latestAttempt?.id, active.id);
      assert.equal(finishedRoot.latestAttempt?.contentId, variant.id, "Review links must target the actual replacement sitting");
      assert.equal(finishedRoot.latestAttempt?.rawScore, 0);
      assert.equal(finishedRoot.completedCount, 2); assert.equal(finishedRoot.activeAttemptId, null);
      assert.equal(finishedVariant.latestAttempt?.id, active.id); assert.equal(finishedVariant.completedCount, 1);
      assert.equal((await progress(root, "b", "exam")).latestAttempt?.id, otherOwner.id);
      assert.equal((await progress(root, "a", "practice")).latestAttempt?.id, otherMode.id);

      const both = (await request("a", "GET", "/content?q=Replacement%20lineage&pageSize=2&mode=exam")).body as LibraryResult;
      assert.deepEqual(Object.keys(both.progress!).sort(), [root.id, variant.id].sort());
      assert.deepEqual(both.progress![root.id], finishedRoot);
      assert.deepEqual(both.progress![variant.id], finishedVariant);
      for (const view of Object.values(both.progress!)) assert.deepEqual(Object.keys(view.latestAttempt!).sort(), summaryKeys);
      const replacementOnly = (await request("a", "GET", "/content?q=Replacement%20lineage&pageSize=1&page=2&mode=exam")).body as LibraryResult;
      assert.deepEqual(Object.keys(replacementOnly.progress!), [variant.id]);
      assert.deepEqual(replacementOnly.progress![variant.id], finishedVariant);
      const originalOnly = (await request("a", "GET", "/content?q=Replacement%20lineage&pageSize=1&mode=exam")).body as LibraryResult;
      assert.deepEqual(Object.keys(originalOnly.progress!), [root.id]);
      assert.deepEqual(originalOnly.progress![root.id], finishedRoot);
      assert.equal(JSON.stringify(both.progress).includes("PRIVATE_PROGRESS_"), false);
    });
  } finally {
    if (server) { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve())); }
    assert.match(database.db.databaseName, /^ielts_content_progress_test_[a-f0-9]{32}$/);
    await database.db.dropDatabase(); await database.client.close();
  }
});
