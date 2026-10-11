import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { test } from "node:test";
import { Collection } from "mongodb";
import { createApp } from "../server/app";
import { connectDatabase } from "../server/storage";
import type { ExamIntegrityState } from "../shared/exam-integrity";
import type { Attempt, PlacementItem, PlacementState, StoredContent } from "../shared/types";

type Learner = "a" | "b";
type MonitoredPlacement = Omit<PlacementState, "completionReason"> & {
  integrity?: ExamIntegrityState;
  completionReason?: "answered" | "deadline" | "invalidated";
};

function content(index: number, skill: "reading" | "listening" | "speaking" = "reading"): StoredContent {
  const names = ["Amber", "Birch", "Cedar", "Dahlia", "Elm", "Fir", "Grove", "Hazel", "Iris", "Juniper"];
  const name = names[index]!;
  const id = `synthetic-integrity-${skill}-${name.toLowerCase()}`;
  const text = `${name} coordinates a community workshop about local wildlife. Participants meet beside the ${name} garden each Thursday. The programme offers guided observation and provides ${name.toLowerCase()} notebooks. Visitors register at the reception desk before joining the group. The organiser explains the safety instructions and answers questions before the afternoon walk begins.`;
  return {
    id, skill, title: `Synthetic ${name} ${skill}`, description: "Private integrity fixture", topic: "Community",
    band: 5, cefr: "B1", testType: "academic", durationMinutes: 10, format: "lesson",
    sections: [{ id: `${id}-section`, title: skill === "reading" ? "Workshop passage" : skill === "listening" ? "Part 1" : "Part 2", text,
      ...(skill === "listening" ? { dialogue: [{ speaker: "Visitor", accent: "british" as const, text: `Where does the ${name} group meet?` }, { speaker: "Organiser", accent: "british" as const, text }] } : {}),
      ...(skill === "speaking" ? { cuePoints: [`Describe the ${name} workshop.`, "Explain who attends.", "Describe the activities.", "Explain why you would join."] } : {}) }],
    questions: skill === "speaking" ? [] : [{ id: `${id}-q1`, number: 1, sectionIndex: 0, type: "choice", questionType: "multiple-choice",
      prompt: `Which notebooks does the ${name} organiser provide?`, options: [`${name.toLowerCase()} notebooks`, `${name.toLowerCase()} maps`],
      answer: `${name.toLowerCase()} notebooks`, explanation: `The ${name} organiser provides ${name.toLowerCase()} notebooks.`,
      evidence: `provides ${name.toLowerCase()} notebooks`, subskill: "details" }],
    vocabularyIds: [], tags: ["synthetic-integrity"], source: "authored", quality: "authored-unreviewed", createdAt: "2026-10-11T00:00:00.000Z",
  };
}
function gate() {
  let enter!: () => void;
  let release!: () => void;
  return {
    entered: new Promise<void>(resolve => { enter = resolve; }),
    released: new Promise<void>(resolve => { release = resolve; }),
    enter: () => enter(), release: () => release(),
  };
}
async function entered(value: ReturnType<typeof gate>) {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([value.entered, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Controlled persistence operation did not start")), 8_000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
function activeSession(resource: { integrity?: ExamIntegrityState }): string {
  assert.equal(resource.integrity?.status, "active");
  assert.ok(resource.integrity?.sessionId);
  return resource.integrity.sessionId;
}
function noAnswerKeys(resource: Attempt | MonitoredPlacement): void {
  const questions = "content" in resource ? resource.content.questions : resource.question ? [resource.question] : [];
  for (const question of questions) {
    for (const field of ["answer", "acceptedAnswers", "explanation", "evidence", "difficulty"])
      assert.equal(field in question, false, `Private ${field} in active/invalidated resource`);
  }
}

test("native Mongo enforces exam document ownership, invalidation, retakes and stale-write fences", { timeout: 90_000 }, async t => {
  const name = `ielts_exam_integrity_test_${randomUUID().replaceAll("-", "")}`;
  assert.match(name, /^ielts_exam_integrity_test_[a-f0-9]{32}$/);
  const database = await connectDatabase(process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017", name);
  let server: Server | undefined;
  let origin = "";
  let now = Date.parse("2026-10-11T12:00:00Z");
  const cookies: Record<Learner, string> = { a: "", b: "" };
  const reading = Array.from({ length: 10 }, (_, index) => content(index));
  const listening = [content(0, "listening"), content(1, "listening"), content(2, "listening")];
  const speaking = [content(0, "speaking"), content(1, "speaking"), content(2, "speaking")];
  const placementBank: PlacementItem[] = Array.from({ length: 100 }, (_, index) => ({
    id: `synthetic-integrity-placement-${index}`, skill: index % 2 ? "listening" : "reading",
    text: `The controlled workshop supplies kit ${index}.`, question: `What does workshop ${index} supply?`,
    options: [`kit ${index}`, `map ${index}`, `pen ${index}`, `bag ${index}`], answer: `kit ${index}`,
    explanation: `The controlled source identifies kit ${index}.`, band: 5, cefr: "B1", difficulty: (index % 9 - 4) / 2, subskill: "details",
  }));
  async function request(who: Learner, method: string, path: string, payload?: unknown, expected: number | readonly number[] = 200, tabId?: string): Promise<any> {
    const response = await fetch(`${origin}/api${path}`, {
      method,
      headers: { ...(cookies[who] ? { Cookie: cookies[who] } : {}), ...(payload === undefined ? {} : { "Content-Type": "application/json" }), ...(tabId ? { "X-Exam-Tab": tabId } : {}) },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    const created = response.headers.getSetCookie().at(-1);
    if (created) cookies[who] = created.split(";")[0];
    const body = await response.json();
    const statuses = typeof expected === "number" ? [expected] : expected;
    assert.ok(statuses.includes(response.status), `${method} ${path}: expected ${statuses.join("/")}, received ${response.status}: ${JSON.stringify(body)}`);
    return body;
  }
  const begin = async (who: Learner, item: StoredContent, tabId: string) =>
    (await request(who, "POST", "/attempts", { contentId: item.id, mode: "exam" }, 201, tabId)).attempt as Attempt;
  const placement = async (who: Learner, tabId: string, mode: "quick" | "deep" = "quick") =>
    (await request(who, "POST", "/placement/start", { mode }, 201, tabId)).placement as MonitoredPlacement;
  const violate = (who: Learner, id: string, tabId: string, reason = "hidden", expected: number | readonly number[] = 200) =>
    request(who, "POST", `/exam-integrity/${id}/violation`, { tabId, reason }, expected);
  const answer = (questionId: string) => {
    const item = placementBank.find(row => row.id === questionId);
    assert.ok(item);
    return { questionId, answer: item.answer };
  };
  async function completePlacement(who: Learner, initial: MonitoredPlacement, tabId: string, count = initial.total): Promise<MonitoredPlacement> {
    let current = initial;
    for (let index = 0; index < count; index++) {
      assert.ok(current.question);
      current = (await request(who, "POST", `/placement/${current.id}/answer`, answer(current.question.id), 200, tabId)).placement;
    }
    return current;
  }
  try {
    await database.content.insertMany([...reading, ...listening, ...speaking].map(item => ({ ...item, _id: item.id })));
    await database.placementItems.insertMany(placementBank.map(item => ({ ...item, _id: item.id })));
    // The production default stays enabled; this suite never uses the compatibility opt-out.
    server = createApp(database, { production: false, serveClient: false, duoEnabled: false, maxLearners: 2, duo: { now: () => now } }).listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    origin = `http://127.0.0.1:${address.port}`;
    const users = {} as Record<Learner, { id: string }>;
    for (const who of ["a", "b"] as const) {
      users[who] = (await request(who, "POST", "/auth/register", {
        name: `Synthetic Integrity ${who.toUpperCase()}`, email: `synthetic-integrity-${who}@example.test`,
        password: "synthetic-integrity-only-password", targetBand: 6.5, testType: "academic",
      }, 201)).user;
    }

    await t.test("missing tab headers cannot start, save or grade a monitored resource", async () => {
      await request("a", "POST", "/attempts", { contentId: reading[0].id, mode: "exam" }, 400);
      await request("a", "POST", "/placement/start", { mode: "quick" }, 400);
      await request("a", "POST", "/attempts", { contentId: reading[0].id, mode: "exam" }, 400, "bad");
      assert.equal(await database.attempts.countDocuments({ userId: users.a.id }), 0);
      assert.equal(await database.placements.countDocuments({ userId: users.a.id }), 0);
      const tab = randomUUID();
      const current = await begin("a", reading[0], tab);
      const sessionId = activeSession(current);
      noAnswerKeys(current);
      await request("a", "PATCH", `/attempts/${current.id}`, { responses: { [current.content.questions[0].id]: "a stale answer" } }, 400);
      await request("a", "POST", `/attempts/${current.id}/submit`, {}, 400);
      assert.deepEqual((await database.attempts.findOne({ _id: current.id }))!.responses, {});
      await violate("a", sessionId, tab);
    });

    await t.test("same-tab open is idempotent, ownership is private and a duplicate document forces a new source", async () => {
      const peerTab = randomUUID();
      const peer = await begin("b", reading[1], peerTab);
      await request("b", "PATCH", `/attempts/${peer.id}`, { responses: { [peer.content.questions[0].id]: reading[1].questions[0].answer } }, 200, peerTab);
      const completedPeer = (await request("b", "POST", `/attempts/${peer.id}/submit`, {}, 200, peerTab)).attempt as Attempt;
      assert.equal(completedPeer.status, "submitted");
      const peerBefore = await database.attempts.findOne({ _id: peer.id });
      const sourceBefore = await database.content.findOne({ _id: reading[1].id });
      const tab = randomUUID();
      const current = await begin("a", reading[1], tab);
      const sessionId = activeSession(current);
      const opened = await request("a", "POST", "/exam-integrity/open", { kind: "attempt", resourceId: current.id, tabId: tab });
      assert.equal(opened.enabled, true);
      assert.equal(opened.session.id, sessionId);
      assert.equal(opened.session.status, "active");
      assert.equal(opened.session.leaseSeconds, 25);
      assert.equal((await request("a", "POST", "/exam-integrity/open", { kind: "attempt", resourceId: current.id, tabId: tab })).session.id, sessionId);
      assert.equal(await database.db.collection("exam_integrity_sessions").countDocuments({ resourceId: current.id }), 1);
      await request("b", "GET", `/exam-integrity/${sessionId}`, undefined, 404);
      await request("b", "POST", "/exam-integrity/open", { kind: "attempt", resourceId: current.id, tabId: randomUUID() }, 404);
      await request("b", "POST", `/exam-integrity/${sessionId}/heartbeat`, { tabId: tab }, 404);
      await violate("b", sessionId, tab, "hidden", 404);
      await violate("a", sessionId, randomUUID(), "hidden", 403);
      assert.equal((await request("a", "GET", `/exam-integrity/${sessionId}`)).session.status, "active");
      await request("a", "POST", `/exam-integrity/${sessionId}/heartbeat`, { tabId: tab });
      const duplicate = await request("a", "POST", "/exam-integrity/open", { kind: "attempt", resourceId: current.id, tabId: randomUUID() });
      assert.equal(duplicate.session.status, "invalidated");
      const invalidated = (await request("a", "GET", `/attempts/${current.id}`)).attempt as Attempt;
      assert.equal(invalidated.status, "invalidated");
      assert.equal(invalidated.integrity?.reason, "duplicate-tab");
      assert.equal(invalidated.feedback, null);
      assert.deepEqual(invalidated.responses, {});
      assert.deepEqual(invalidated.essays, {});
      assert.equal(invalidated.transcript, "");
      await request("a", "PATCH", `/attempts/${current.id}`, { responses: {} }, 409, tab);
      await request("a", "POST", `/attempts/${current.id}/submit`, {}, 409, tab);
      const retakeTab = randomUUID();
      const retake = await begin("a", reading[1], retakeTab);
      assert.notEqual(retake.id, current.id);
      assert.notEqual(retake.contentId, current.contentId);
      assert.notEqual(retake.content.sections[0].text, current.content.sections[0].text);
      assert.notEqual(retake.content.questions[0].id, current.content.questions[0].id);
      noAnswerKeys(retake);
      assert.deepEqual(await database.content.findOne({ _id: reading[1].id }), sourceBefore);
      assert.deepEqual(await database.attempts.findOne({ _id: peer.id }), peerBefore);
      await violate("a", activeSession(retake), retakeTab);
      await violate("b", completedPeer.integrity!.sessionId!, peerTab, "page-exit");
      assert.deepEqual((await request("b", "GET", `/attempts/${peer.id}`)).attempt.feedback, completedPeer.feedback);
      assert.equal((await request("b", "GET", `/attempts/${peer.id}`)).attempt.status, "submitted");
    });

    await t.test("invalidated placement resets work, hides keys, excludes served items and preserves completed history", async () => {
      const tab = randomUUID();
      let current = await placement("a", tab);
      const sessionId = activeSession(current);
      noAnswerKeys(current);
      const seen = [current.question!.id];
      await request("b", "GET", `/placement/${current.id}`, undefined, 404);
      await request("a", "POST", `/placement/${current.id}/draft`, answer(current.question!.id), 400);
      await request("a", "POST", `/placement/${current.id}/answer`, answer(current.question!.id), 400);
      assert.deepEqual((await database.placements.findOne({ _id: current.id }))!.answers, []);
      current = (await request("a", "POST", `/placement/${current.id}/answer`, answer(current.question!.id), 200, tab)).placement;
      seen.push(current.question!.id);
      await request("a", "POST", `/placement/${current.id}/draft`, answer(current.question!.id), 200, tab);
      const profileBefore = await database.users.findOne({ _id: users.a.id });
      await violate("a", sessionId, tab);
      const invalidated = (await request("a", "GET", `/placement/${current.id}`)).placement as MonitoredPlacement;
      assert.equal(invalidated.question, null);
      assert.equal(invalidated.result, null);
      assert.equal(invalidated.completed, 0);
      assert.equal(invalidated.draftAnswer, "");
      assert.equal(invalidated.completionReason, "invalidated");
      assert.equal(invalidated.integrity?.status, "invalidated");
      assert.equal("invalidatedQuestionIds" in invalidated, false);
      const stored = await database.placements.findOne({ _id: current.id });
      assert.deepEqual(stored!.answers, []);
      assert.equal(stored!.draftAnswer, null);
      assert.ok(seen.every(id => stored!.invalidatedQuestionIds!.includes(id)));
      assert.equal((await database.users.findOne({ _id: users.a.id }))!.currentBand, profileBefore!.currentBand);
      await request("a", "POST", `/placement/${current.id}/draft`, answer(seen[1]), 409, tab);
      await request("a", "POST", `/placement/${current.id}/answer`, answer(seen[1]), 409, tab);
      const freshTab = randomUUID();
      const fresh = await placement("a", freshTab);
      assert.notEqual(fresh.id, current.id);
      assert.equal(fresh.mode, current.mode);
      assert.equal(fresh.total, current.total);
      assert.equal(seen.includes(fresh.question!.id), false);
      const completed = await completePlacement("a", fresh, freshTab);
      assert.ok(completed.result);
      assert.ok(completed.result.answers.every(row => !seen.includes(row.questionId)));
      assert.equal(completed.completed, completed.total);
      assert.equal(completed.integrity?.status, "completed");
      await violate("a", fresh.integrity!.sessionId!, freshTab, "page-exit");
      assert.deepEqual((await request("a", "GET", `/placement/${fresh.id}`)).placement.result, completed.result);
      const history = (await request("a", "GET", "/placement/history")).placements;
      assert.equal(history.find((row: { id: string }) => row.id === current.id).result, null);
      assert.deepEqual(history.find((row: { id: string }) => row.id === fresh.id).result, completed.result);
    });

    await t.test("idle leases expire before deadlines and cannot produce feedback or a band update", async () => {
      const tab = randomUUID();
      const current = await begin("a", reading[3], tab);
      await request("a", "PATCH", `/attempts/${current.id}`, { responses: { [current.content.questions[0].id]: reading[3].questions[0].answer } }, 200, tab);
      const placementTab = randomUUID();
      const timed = await placement("b", placementTab, "deep");
      await request("b", "POST", `/placement/${timed.id}/draft`, answer(timed.question!.id), 200, placementTab);
      const profileBefore = await database.users.findOne({ _id: users.b.id });
      now += 25_001;
      const expired = (await request("a", "GET", `/attempts/${current.id}`)).attempt as Attempt;
      assert.equal(expired.status, "invalidated");
      assert.equal(expired.integrity?.reason, "heartbeat-lost");
      assert.equal(expired.feedback, null);
      assert.deepEqual(expired.responses, {});
      await request("a", "POST", `/attempts/${current.id}/submit`, {}, 409, tab);
      const expiredPlacement = (await request("b", "GET", `/placement/${timed.id}`)).placement as MonitoredPlacement;
      assert.equal(expiredPlacement.integrity?.reason, "heartbeat-lost");
      assert.equal(expiredPlacement.question, null);
      assert.equal(expiredPlacement.result, null);
      assert.equal((await database.users.findOne({ _id: users.b.id }))!.currentBand, profileBefore!.currentBand);
      await request("b", "POST", `/placement/${timed.id}/answer`, answer(timed.question!.id), 409, placementTab);
    });

    await t.test("listening source requires the document header and invalidation detaches the current recording", async () => {
      const tab = randomUUID();
      const current = await begin("a", listening[0], tab);
      await request("a", "POST", `/attempts/${current.id}/listening-source`, {}, 400);
      assert.notEqual((await database.attempts.findOne({ _id: current.id }))!.listeningPlayed, true);
      const source = await request("a", "POST", `/attempts/${current.id}/listening-source`, {}, 200, tab);
      assert.ok(source.sections.length);
      await violate("a", activeSession(current), tab, "navigation");
      await request("a", "POST", `/attempts/${current.id}/listening-source`, {}, 409, tab);
      const speechTab = randomUUID();
      const speech = await begin("a", speaking[0], speechTab);
      await request("a", "PATCH", `/attempts/${speech.id}`, { transcript: "Controlled private recording draft." }, 200, speechTab);
      const upload = database.recordings.openUploadStream("synthetic-integrity-recording.wav", { metadata: { userId: users.a.id, attemptId: speech.id } });
      upload.end(Buffer.from("Controlled synthetic recording bytes"));
      await once(upload, "finish");
      await database.audio.insertOne({ _id: randomUUID(), userId: users.a.id, attemptId: speech.id, fileId: upload.id, mime: "audio/wav", createdAt: new Date(now).toISOString() });
      assert.equal((await request("a", "GET", `/attempts/${speech.id}`)).attempt.audioAvailable, true);
      await violate("a", activeSession(speech), speechTab, "page-exit");
      const invalidated = (await request("a", "GET", `/attempts/${speech.id}`)).attempt as Attempt;
      assert.equal(invalidated.status, "invalidated");
      assert.equal(invalidated.audioAvailable, false);
      assert.equal(invalidated.transcript, "");
      assert.equal(await database.audio.countDocuments({ attemptId: speech.id }), 0);
      await request("a", "GET", `/attempts/${speech.id}/audio`, undefined, 404);
    });

    await t.test("a draft paused before persistence cannot reappear after invalidation", async () => {
      const tab = randomUUID();
      const current = await begin("a", reading[4], tab);
      const original = database.attempts.findOneAndUpdate.bind(database.attempts);
      const held = gate();
      let intercept = true;
      database.attempts.findOneAndUpdate = (async (...args: Parameters<typeof original>) => {
        if (intercept && Array.isArray(args[1])) { intercept = false; held.enter(); await held.released; }
        return original(...args);
      }) as typeof database.attempts.findOneAndUpdate;
      const pending = request("a", "PATCH", `/attempts/${current.id}`, { responses: { [current.content.questions[0].id]: reading[4].questions[0].answer } }, 409, tab);
      try { await entered(held); await violate("a", activeSession(current), tab); }
      finally { held.release(); database.attempts.findOneAndUpdate = original; }
      await pending;
      const stored = await database.attempts.findOne({ _id: current.id });
      assert.equal(stored!.status, "invalidated");
      assert.deepEqual(stored!.responses, {});
      assert.equal(stored!.feedback, null);
    });

    await t.test("an accepted final submission keeps its grading lease after the answering lease would expire", async () => {
      const tab = randomUUID();
      const current = await begin("a", reading[5], tab);
      const sessionId = activeSession(current);
      await request("a", "PATCH", `/attempts/${current.id}`, { responses: { [current.content.questions[0].id]: reading[5].questions[0].answer } }, 200, tab);
      const original = database.attempts.findOneAndUpdate.bind(database.attempts);
      const held = gate();
      let intercept = true;
      database.attempts.findOneAndUpdate = (async (...args: Parameters<typeof original>) => {
        if (intercept && (args[1] as { $set?: { status?: string } }).$set?.status === "submitted") {
          intercept = false; held.enter(); await held.released;
        }
        return original(...args);
      }) as typeof database.attempts.findOneAndUpdate;
      const pending = request("a", "POST", `/attempts/${current.id}/submit`, {}, 200, tab);
      try {
        await entered(held);
        now += 26_000;
        const grading = (await request("a", "GET", `/exam-integrity/${sessionId}`)).session;
        assert.equal(grading.status, "active");
        assert.equal(grading.phase, "grading");
        assert.equal(grading.leaseSeconds, 1200);
        assert.equal((await violate("a", sessionId, tab, "page-exit")).session.status, "active");
      } finally { held.release(); database.attempts.findOneAndUpdate = original; }
      const submitted = (await pending).attempt as Attempt;
      assert.equal(submitted.status, "submitted");
      assert.ok(submitted.feedback);
      assert.equal((await request("a", "GET", `/exam-integrity/${sessionId}`)).session.status, "completed");
      await violate("a", sessionId, tab, "hidden");
      assert.deepEqual((await request("a", "GET", `/attempts/${current.id}`)).attempt.feedback, submitted.feedback);
    });

    await t.test("a final placement answer paused before claiming completion cannot publish a result after invalidation", async () => {
      const tab = randomUUID();
      const initial = await placement("a", tab);
      const current = await completePlacement("a", initial, tab, initial.total - 1);
      const before = await database.users.findOne({ _id: users.a.id });
      const original = database.placementItems.find.bind(database.placementItems);
      const held = gate();
      let intercept = true;
      database.placementItems.find = ((...args: Parameters<typeof original>) => {
        const cursor = original(...args);
        const ids = (args[0] as { _id?: { $in?: string[] } } | undefined)?._id?.$in;
        if (intercept && ids?.length === initial.total) {
          intercept = false;
          const toArray = cursor.toArray.bind(cursor);
          cursor.toArray = async () => { held.enter(); await held.released; return toArray(); };
        }
        return cursor;
      }) as typeof database.placementItems.find;
      const pending = request("a", "POST", `/placement/${current.id}/answer`, answer(current.question!.id), 409, tab);
      try { await entered(held); await violate("a", activeSession(initial), tab); }
      finally { held.release(); database.placementItems.find = original; }
      await pending;
      const stored = await database.placements.findOne({ _id: current.id });
      assert.equal(stored!.currentQuestionId, null);
      assert.deepEqual(stored!.answers, []);
      assert.equal(stored!.result, null);
      assert.equal((await database.users.findOne({ _id: users.a.id }))!.currentBand, before!.currentBand);
    });

    await t.test("a final placement completion that wins a paused invalidation keeps its result and band update", async () => {
      const tab = randomUUID();
      const initial = await placement("a", tab);
      const sessionId = activeSession(initial);
      const current = await completePlacement("a", initial, tab, initial.total - 1);
      const original = Collection.prototype.findOneAndUpdate;
      const held = gate();
      let intercept = true;
      Collection.prototype.findOneAndUpdate = (async function (this: Collection, ...args: Parameters<typeof original>) {
        const filter = args[0] as { _id?: string };
        const changed = (args[1] as { $set?: { status?: string } }).$set;
        if (intercept && this.namespace === `${name}.exam_integrity_sessions` && filter._id === sessionId && changed?.status === "invalidated") {
          intercept = false; held.enter(); await held.released;
        }
        return Reflect.apply(original, this, args);
      }) as typeof Collection.prototype.findOneAndUpdate;
      const pending = violate("a", sessionId, tab);
      let completed: MonitoredPlacement | undefined;
      let band: number | null | undefined;
      try {
        await entered(held);
        completed = (await request("a", "POST", `/placement/${current.id}/answer`, answer(current.question!.id), 200, tab)).placement;
        assert.ok(completed?.result);
        assert.equal(completed.integrity?.status, "completed");
        band = (await database.users.findOne({ _id: users.a.id }))!.currentBand;
        assert.equal(band, completed.result.estimatedBand);
      } finally { held.release(); Collection.prototype.findOneAndUpdate = original; }
      assert.equal((await pending).session.status, "completed");
      const stored = await database.placements.findOne({ _id: current.id });
      assert.equal(stored!.completionReason, "answered");
      assert.equal(stored!.answers.length, initial.total);
      assert.equal(stored!.invalidatedAt, undefined);
      assert.deepEqual(stored!.result, completed!.result);
      assert.equal((await database.users.findOne({ _id: users.a.id }))!.currentBand, band);
    });

    await t.test("ordinary practice resumes across documents without monitoring headers and preserves saved answers", async () => {
      const item = reading[9];
      const current = (await request("a", "POST", "/attempts", { contentId: item.id, mode: "practice" }, 201)).attempt as Attempt;
      assert.equal(current.mode, "practice");
      assert.equal(current.status, "in-progress");
      assert.equal(current.deadlineAt, null);
      assert.equal(current.integrity, undefined);
      const responses = { [current.content.questions[0].id]: item.questions[0].answer };
      await request("a", "PATCH", `/attempts/${current.id}`, { responses });
      const secondDocument = (await request("a", "POST", "/attempts", { contentId: item.id, mode: "practice" })).attempt as Attempt;
      assert.equal(secondDocument.id, current.id);
      assert.deepEqual(secondDocument.responses, responses);
      const firstTab = randomUUID();
      const secondTab = randomUUID();
      for (const tab of [firstTab, secondTab]) {
        const view = (await request("a", "GET", `/attempts/${current.id}`, undefined, 200, tab)).attempt as Attempt;
        assert.equal(view.status, "in-progress");
        assert.equal(view.integrity, undefined);
        assert.deepEqual(view.responses, responses);
      }
      now += 60_000;
      const resumed = (await request("a", "GET", `/attempts/${current.id}`)).attempt as Attempt;
      assert.equal(resumed.status, "in-progress");
      assert.deepEqual(resumed.responses, responses);
      assert.equal(await database.db.collection("exam_integrity_sessions").countDocuments({ resourceId: current.id }), 0);
      const submitted = (await request("a", "POST", `/attempts/${current.id}/submit`, {})).attempt as Attempt;
      assert.equal(submitted.status, "submitted");
      assert.deepEqual(submitted.responses, responses);
      assert.ok(submitted.feedback);
    });
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>(resolve => server!.close(() => resolve()));
    }
    assert.match(database.db.databaseName, /^ielts_exam_integrity_test_[a-f0-9]{32}$/);
    await database.db.dropDatabase();
    await database.client.close();
  }
});
