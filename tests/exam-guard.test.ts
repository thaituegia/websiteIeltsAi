import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Collection } from "mongodb";
import { initialProfile } from "../server/auth";
import { ApiError } from "../server/errors";
import { ExamGuard } from "../server/exam-guard";
import { connectDatabase, type UserRecord } from "../server/storage";

interface GuardRow {
  _id: string; userId: string; phase: "answering" | "grading";
  status: "active" | "invalidated" | "completed"; leaseUntil: number;
}
function barrier() {
  let enter!: () => void;
  let release!: () => void;
  return {
    entered: new Promise<void>(resolve => { enter = resolve; }),
    released: new Promise<void>(resolve => { release = resolve; }),
    enter: () => enter(), release: () => release(),
  };
}
async function untilEntered(held: ReturnType<typeof barrier>) {
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([held.entered, new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("Controlled native heartbeat update did not start")), 8_000);
    })]);
  } finally { if (timeout) clearTimeout(timeout); }
}

test("native heartbeat phase CAS preserves accepted grading and promptly restores answering expiry", { timeout: 30_000 }, async t => {
  const name = `ielts_exam_guard_test_${randomUUID().replaceAll("-", "")}`;
  assert.match(name, /^ielts_exam_guard_test_[a-f0-9]{32}$/);
  const database = await connectDatabase(process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017", name);
  const base = Date.parse("2026-10-11T12:00:00Z");
  try {
    for (const transition of ["answering-to-grading", "grading-to-answering"] as const) {
      await t.test(transition, async () => {
        let now = base;
        let finished = false;
        let resets = 0;
        const userId = `synthetic-phase-${transition}`;
        const user: UserRecord = {
          ...initialProfile({ name: "Synthetic phase learner", email: `${transition}@example.test`, targetBand: 7, testType: "academic" }, userId),
          _id: userId, passwordHash: null,
        };
        const guard = new ExamGuard(database, () => now,
          async (_user, kind, resourceId) => ({ kind, resourceId, finished }),
          async () => { resets += 1; return {}; });
        const tab = randomUUID();
        const opened = await guard.open(user, "attempt", `synthetic-attempt-${transition}`, tab);
        const sessions = Reflect.get(guard, "sessions") as Collection<GuardRow>;
        if (transition === "grading-to-answering") await guard.grading(user, "attempt", opened.resourceId, true);
        const held = barrier();
        const original = sessions.findOneAndUpdate.bind(sessions);
        let intercept = true;
        sessions.findOneAndUpdate = (async (...args: Parameters<typeof original>) => {
          if (intercept) { intercept = false; held.enter(); await held.released; }
          return original(...args);
        }) as typeof sessions.findOneAndUpdate;
        const pending = guard.heartbeat(user, opened.id, tab);
        let renewed;
        try {
          await untilEntered(held);
          await guard.grading(user, "attempt", opened.resourceId, transition === "answering-to-grading");
          held.release();
          renewed = await pending;
        } finally {
          held.release();
          sessions.findOneAndUpdate = original;
        }
        const row = await sessions.findOne({ _id: opened.id });
        assert.ok(row);
        assert.equal(row.phase, transition === "answering-to-grading" ? "grading" : "answering");
        assert.equal(row.leaseUntil - now, transition === "answering-to-grading" ? 1_200_000 : 25_000);
        assert.equal(renewed.phase, row.phase);
        assert.equal(renewed.leaseSeconds, transition === "answering-to-grading" ? 1200 : 25);
        now += 26_000;
        const later = await guard.current(user, opened.id);
        if (transition === "answering-to-grading") {
          assert.equal(later.status, "active");
          assert.equal(resets, 0);
          // A final result accepted during the protected provider window remains
          // completed even after the old answering lease would have expired.
          finished = true;
          assert.equal((await guard.current(user, opened.id)).status, "completed");
          now += 1_200_000;
          assert.equal((await guard.violation(user, opened.id, tab, "page-exit")).status, "completed");
          assert.equal(resets, 0);
        } else {
          assert.equal(later.status, "invalidated");
          assert.equal(later.reason, "heartbeat-lost");
          assert.equal(resets, 1);
          assert.equal((await guard.current(user, opened.id)).status, "invalidated");
          assert.equal(resets, 1);
        }
      });
    }
    await t.test("an expired answering lease cannot be revived by a delayed grading claim", async () => {
      let now = base;
      let resets = 0;
      const userId = "synthetic-phase-expired-claim";
      const user: UserRecord = {
        ...initialProfile({ name: "Synthetic expired lease learner", email: "expired-claim@example.test", targetBand: 7, testType: "academic" }, userId),
        _id: userId, passwordHash: null,
      };
      const guard = new ExamGuard(database, () => now,
        async (_user, kind, resourceId) => ({ kind, resourceId, finished: false }),
        async () => { resets += 1; return {}; });
      const opened = await guard.open(user, "attempt", "synthetic-expired-claim-attempt", randomUUID());
      now += 25_000;
      await assert.rejects(guard.grading(user, "attempt", opened.resourceId, true),
        error => error instanceof ApiError && error.status === 409);
      const row = await database.db.collection<GuardRow>("exam_integrity_sessions").findOne({ _id: opened.id });
      assert.ok(row);
      assert.equal(row.phase, "answering");
      assert.equal(row.leaseUntil, base + 25_000);
      assert.equal(resets, 0);
      const settled = await guard.current(user, opened.id);
      assert.equal(settled.status, "invalidated");
      assert.equal(settled.reason, "heartbeat-lost");
      assert.equal(resets, 1);
      assert.equal((await guard.current(user, opened.id)).status, "invalidated");
      assert.equal(resets, 1);
    });
  } finally {
    await database.db.dropDatabase();
    await database.client.close();
  }
});

test("same-document reopening renews only a live owned lease", { timeout: 30_000 }, async t => {
  const name = `ielts_exam_guard_test_${randomUUID().replaceAll("-", "")}`;
  assert.match(name, /^ielts_exam_guard_test_[a-f0-9]{32}$/);
  const database = await connectDatabase("mongodb://127.0.0.1:27017", name);
  const base = Date.parse("2026-11-10T12:00:00Z");
  const sessions = database.db.collection<GuardRow>("exam_integrity_sessions");
  function fixture(label: string) {
    let now = base, resets = 0, finished = false;
    const userId = `synthetic-reopen-${label}`;
    const user: UserRecord = {
      ...initialProfile({ name: "Synthetic reopening learner", email: `${label}@example.test`, targetBand: 7, testType: "academic" }, userId),
      _id: userId, passwordHash: null,
    };
    const guard = new ExamGuard(database, () => now,
      async (_user, kind, resourceId) => ({ kind, resourceId, finished }),
      async () => { resets += 1; return {}; });
    return { user, guard, tab: randomUUID(), resourceId: `synthetic-reopen-${label}`,
      at(milliseconds: number) { now = base + milliseconds; },
      finish() { finished = true; },
      get now() { return now; }, get resets() { return resets; } };
  }
  try {
    await t.test("a start response delayed 22 seconds leaves time for the client's first heartbeat", async () => {
      const f = fixture("delayed-start");
      const initial = await f.guard.open(f.user, "assessment", f.resourceId, f.tab);
      f.at(22_000);
      const reopened = await f.guard.open(f.user, "assessment", f.resourceId, f.tab);
      assert.equal(reopened.id, initial.id);
      assert.equal(reopened.status, "active");
      assert.equal((await sessions.findOne({ _id: initial.id }))?.leaseUntil, f.now + 25_000);
      assert.equal(await sessions.countDocuments({ userId: f.user.id }), 1);
      f.at(27_000);
      const acknowledged = await f.guard.heartbeat(f.user, initial.id, f.tab);
      assert.equal(acknowledged.status, "active");
      assert.equal(f.resets, 0);
      assert.equal((await sessions.findOne({ _id: initial.id }))?.leaseUntil, f.now + 25_000);
      f.at(53_000);
      assert.equal((await f.guard.current(f.user, initial.id)).status, "invalidated");
      assert.equal(f.resets, 1);
    });

    await t.test("an expired lease is not revived by reopening the same document", async () => {
      const f = fixture("expired");
      const initial = await f.guard.open(f.user, "assessment", f.resourceId, f.tab);
      f.at(25_000);
      const reopened = await f.guard.open(f.user, "assessment", f.resourceId, f.tab);
      assert.equal(reopened.id, initial.id);
      assert.equal(reopened.status, "invalidated");
      assert.equal(reopened.reason, "heartbeat-lost");
      assert.equal((await sessions.findOne({ _id: initial.id }))?.leaseUntil, base + 25_000);
      f.at(26_000);
      assert.equal((await f.guard.open(f.user, "assessment", f.resourceId, f.tab)).status, "invalidated");
      assert.equal(f.resets, 1);
      assert.equal(await sessions.countDocuments({ userId: f.user.id }), 1);
    });

    await t.test("a previously invalidated document cannot acquire a new lease", async () => {
      const f = fixture("invalidated");
      const initial = await f.guard.open(f.user, "assessment", f.resourceId, f.tab);
      await f.guard.violation(f.user, initial.id, f.tab, "hidden");
      f.at(22_000);
      const reopened = await f.guard.open(f.user, "assessment", f.resourceId, f.tab);
      assert.equal(reopened.id, initial.id);
      assert.equal(reopened.status, "invalidated");
      assert.equal(reopened.reason, "hidden");
      assert.equal((await sessions.findOne({ _id: initial.id }))?.leaseUntil, base + 25_000);
      assert.equal(f.resets, 1);
    });

    await t.test("a different tab invalidates rather than renewing the original lease", async () => {
      const f = fixture("different-tab");
      const initial = await f.guard.open(f.user, "assessment", f.resourceId, f.tab);
      f.at(22_000);
      const other = await f.guard.open(f.user, "assessment", f.resourceId, randomUUID());
      assert.equal(other.id, initial.id);
      assert.equal(other.status, "invalidated");
      assert.equal(other.reason, "duplicate-tab");
      assert.equal((await sessions.findOne({ _id: initial.id }))?.leaseUntil, base + 25_000);
      assert.equal(f.resets, 1);
    });

    await t.test("a different learner cannot renew the owned guard", async () => {
      const f = fixture("owner");
      const stranger = fixture("other-owner");
      const initial = await f.guard.open(f.user, "assessment", f.resourceId, f.tab);
      f.at(22_000);
      await assert.rejects(f.guard.heartbeat(stranger.user, initial.id, f.tab),
        error => error instanceof ApiError && error.status === 404);
      assert.equal((await sessions.findOne({ _id: initial.id }))?.leaseUntil, base + 25_000);
      assert.equal(f.resets, 0);
    });

    await t.test("finished targets stay completed without a fresh guard or reset", async () => {
      const f = fixture("completed");
      const initial = await f.guard.open(f.user, "assessment", f.resourceId, f.tab);
      f.at(22_000); f.finish();
      const completed = await f.guard.open(f.user, "assessment", f.resourceId, f.tab);
      assert.equal(completed.id, initial.id);
      assert.equal(completed.status, "completed");
      assert.equal((await sessions.findOne({ _id: initial.id }))?.leaseUntil, base + 25_000);
      f.at(90_000);
      assert.equal((await f.guard.open(f.user, "assessment", f.resourceId, randomUUID())).status, "completed");
      assert.equal(await sessions.countDocuments({ userId: f.user.id }), 1);
      assert.equal(f.resets, 0);
    });

    await t.test("same-tab reopening preserves the protected grading phase and duration", async () => {
      const f = fixture("grading");
      const initial = await f.guard.open(f.user, "assessment", f.resourceId, f.tab);
      await f.guard.grading(f.user, "assessment", f.resourceId, true);
      f.at(22_000);
      const reopened = await f.guard.open(f.user, "assessment", f.resourceId, f.tab);
      assert.equal(reopened.id, initial.id);
      assert.equal(reopened.status, "active");
      assert.equal(reopened.phase, "grading");
      assert.equal(reopened.leaseSeconds, 1200);
      const row = await sessions.findOne({ _id: initial.id });
      assert.equal(row?.phase, "grading");
      assert.equal(row?.leaseUntil, f.now + 1_200_000);
      f.at(27_000);
      assert.equal((await f.guard.heartbeat(f.user, initial.id, f.tab)).phase, "grading");
      assert.equal(f.resets, 0);
    });
  } finally {
    await database.db.dropDatabase();
    await database.client.close();
  }
});
