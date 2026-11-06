import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { test } from "node:test";
import { attemptClockNow, sampleAttemptClock } from "../client/attempt-clock";
import { createApp } from "../server/app";
import { connectDatabase } from "../server/storage";
import type { Attempt, StoredContent } from "../shared/types";

const serverMilliseconds = Date.parse("2026-11-06T14:00:00.000Z");
const iso = (milliseconds: number) => new Date(milliseconds).toISOString();

test("attempt countdown ignores device clocks ahead or behind the server", () => {
  for (const skew of [-86_400_000, 86_400_000]) {
    const clock = sampleAttemptClock(null, "owned", iso(serverMilliseconds), 100, serverMilliseconds + skew);
    assert.equal(attemptClockNow(clock, 1100, serverMilliseconds + skew), serverMilliseconds + 1000);
    assert.equal(attemptClockNow(clock, 2100, serverMilliseconds - skew), serverMilliseconds + 2000);
  }
});

test("wall-clock jumps, delayed samples and old replies cannot add time", () => {
  const first = sampleAttemptClock(null, "owned", iso(serverMilliseconds), 0, serverMilliseconds);
  const delayed = sampleAttemptClock(first, "owned", iso(serverMilliseconds + 1000), 4000, serverMilliseconds + 99_000);
  assert.equal(attemptClockNow(delayed, 4000, 0), serverMilliseconds + 4000);
  assert.equal(attemptClockNow(delayed, 5000, Number.MAX_SAFE_INTEGER), serverMilliseconds + 5000);
  assert.equal(sampleAttemptClock(delayed, "owned", iso(serverMilliseconds), 6000, 0), delayed);
});

test("a server-confirmed premature timeout can correct a fast sample without resetting another attempt", () => {
  const wrong = sampleAttemptClock(null, "one", iso(serverMilliseconds + 60_000), 0, 0);
  const confirmed = sampleAttemptClock(wrong, "one", iso(serverMilliseconds + 1000), 2000, 0, true);
  assert.equal(attemptClockNow(confirmed, 2000, 0), serverMilliseconds + 1000);
  const next = sampleAttemptClock(confirmed, "two", iso(serverMilliseconds), 3000, 0);
  assert.equal(attemptClockNow(next, 3000, 0), serverMilliseconds);
});

test("legacy absent samples stay monotonic, but the first authoritative sample replaces a wrong fallback", () => {
  const legacy = sampleAttemptClock(null, "owned", undefined, 0, serverMilliseconds + 12_000);
  assert.equal(sampleAttemptClock(legacy, "owned", undefined, 1000, 0), legacy);
  const real = sampleAttemptClock(legacy, "owned", iso(serverMilliseconds), 1000, 0);
  assert.equal(attemptClockNow(real, 2000, Number.MAX_SAFE_INTEGER), serverMilliseconds + 1000);
});

test("owned timeout requests wait for the server deadline without changing drafts or grading early", { timeout: 30_000 }, async () => {
  const database = await connectDatabase("mongodb://127.0.0.1:27017", "ielts_attempt_clock_test_" + randomUUID().replaceAll("-", ""));
  let server: Server | undefined;
  let origin = "";
  let now = serverMilliseconds;
  const cookies = ["", ""];
  const content: StoredContent = {
    id: "synthetic-attempt-clock", skill: "reading", title: "A synthetic timetable", description: "Synthetic owned clock fixture",
    topic: "Education", band: 3, cefr: "A2", testType: "both", durationMinutes: 1, format: "lesson",
    sections: [{ id: "source", title: "Timetable", text: "A tray protects the floor." }],
    questions: [{ id: "answer", number: 1, sectionIndex: 0, type: "text", questionType: "short-answer", prompt: "What protects the floor?", wordLimit: 2,
      subskill: "locating-details", answer: "tray", explanation: "The source names a tray.", evidence: "A tray protects the floor." }],
    vocabularyIds: [], tags: [], source: "authored", quality: "authored-unreviewed", createdAt: iso(now),
  };
  async function request(who: number, method: string, path: string, payload?: unknown, expected = 200) {
    const response = await fetch(origin + "/api" + path, {
      method, headers: { Cookie: cookies[who], ...(payload === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    const cookie = response.headers.getSetCookie().at(-1);
    if (cookie) cookies[who] = cookie.split(";")[0]!;
    const body = await response.json();
    assert.equal(response.status, expected, JSON.stringify(body));
    return body as { attempt: Attempt; deadlinePending?: boolean };
  }
  try {
    await database.content.insertOne({ ...content, _id: content.id });
    server = createApp(database, { production: false, serveClient: false, duoEnabled: false, demoEnabled: false,
      examIntegrityEnabled: false, maxLearners: 2, duo: { now: () => now } }).listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address(); assert.ok(address && typeof address !== "string");
    origin = "http://127.0.0.1:" + address.port;
    for (const who of [0, 1]) await request(who, "POST", "/auth/register", {
      name: "Synthetic clock learner " + who, email: `attempt-clock-${who}@example.test`, password: "synthetic-clock-password",
      targetBand: 8, testType: "academic",
    }, 201);
    const active = (await request(0, "POST", "/attempts", { contentId: content.id, mode: "exam" }, 201)).attempt;
    assert.equal(active.serverNow, iso(now));
    assert.equal(Date.parse(active.deadlineAt!), now + 60_000);
    now += 1000;
    const saved = (await request(0, "PATCH", `/attempts/${active.id}`, { responses: { answer: "A tray" } })).attempt;
    assert.equal(saved.serverNow, iso(now));
    const before = await database.attempts.findOne({ _id: active.id });
    await request(1, "POST", `/attempts/${active.id}/submit`, { timedOut: true }, 404);
    for (const milliseconds of [0, 58_999]) {
      now += milliseconds;
      const pending = await request(0, "POST", `/attempts/${active.id}/submit`, { timedOut: true });
      assert.equal(pending.deadlinePending, true);
      assert.equal(pending.attempt.status, "in-progress");
      assert.equal(pending.attempt.feedback, null);
      assert.equal(pending.attempt.serverNow, iso(now));
      assert.deepEqual(pending.attempt.responses, { answer: "A tray" });
      assert.deepEqual(await database.attempts.findOne({ _id: active.id }), before);
    }
    await request(0, "POST", `/attempts/${active.id}/submit`, { timedOut: "true" }, 400);
    now++;
    const expired = (await request(0, "POST", `/attempts/${active.id}/submit`, { timedOut: true })).attempt;
    assert.equal(expired.status, "submitted");
    assert.equal(expired.feedback?.rawScore, 1);
    assert.equal(expired.serverNow, iso(now));
    assert.equal("serverNow" in (await database.attempts.findOne({ _id: active.id }))!, false);
    assert.deepEqual((await request(0, "POST", `/attempts/${active.id}/submit`, { timedOut: true })).attempt.feedback, expired.feedback);
    const manual = (await request(0, "POST", "/attempts", { contentId: content.id, mode: "exam" }, 201)).attempt;
    assert.equal((await request(0, "POST", `/attempts/${manual.id}/submit`, { timedOut: false })).attempt.status, "submitted");
    const practice = (await request(0, "POST", "/attempts", { contentId: content.id, mode: "practice" }, 201)).attempt;
    assert.equal((await request(0, "POST", `/attempts/${practice.id}/submit`, { timedOut: true })).attempt.status, "in-progress");
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    await database.db.dropDatabase();
    await database.client.close();
  }
});
