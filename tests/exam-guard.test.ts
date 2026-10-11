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
