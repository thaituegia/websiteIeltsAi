import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { test } from "node:test";
import { createApp } from "../server/app";
import { hashPassword } from "../server/auth";
import { parseDuoCredentials, provisionDuoAccounts } from "../server/duo-auth";
import { placementDurationSeconds, suggestedPlacementSeconds } from "../server/placement-timing";
import { connectDatabase } from "../server/storage";
import type { PlacementItem, PlacementState } from "../shared/types";

test("placement time guidance accounts for level, text length and listening playback", () => {
  assert.equal(placementDurationSeconds("quick"), 1200); assert.equal(placementDurationSeconds("deep"), 2400);
  const item = { cefr: "A2", skill: "reading", text: "word ".repeat(100) } as PlacementItem;
  assert.ok(suggestedPlacementSeconds({ ...item, cefr: "C1" }) > suggestedPlacementSeconds(item));
  assert.ok(suggestedPlacementSeconds({ ...item, skill: "listening" }) > suggestedPlacementSeconds(item));
});
test("native Mongo timed placements persist drafts/deadlines, expire safely and reveal only served answers", { timeout: 60000 }, async t => {
  const name = `ielts_placement_timer_test_${randomUUID().replaceAll("-", "")}`;
  const db = await connectDatabase(process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017", name);
  let now = Date.parse("2026-10-11T12:00:00Z");
  const bank: PlacementItem[] = Array.from({ length: 80 }, (_, i) => ({ id: `synthetic-timed-${i}`, skill: i % 2 ? "listening" : "reading", text: `The workshop supplies kit number ${i}.`, question: "What is supplied?", options: [`kit ${i}`, "paper", "pens", "maps"], answer: `kit ${i}`, explanation: `The source names kit ${i}.`, band: 5, cefr: "B1", difficulty: (i % 8 - 4) / 2, subskill: "details" }));
  await db.placementItems.insertMany(bank.map(item => ({ ...item, _id: item.id })));
  const settings = parseDuoCredentials({ duoId: "synthetic-timer-pair", accounts: [
    { role: "husband", name: "Synthetic Timer A", phone: "0390000083", passwordHash: await hashPassword("synthetic-timer-password-a") },
    { role: "wife", name: "Synthetic Timer B", phone: "0390000084", passwordHash: await hashPassword("synthetic-timer-password-b") },
  ] });
  await provisionDuoAccounts(db, settings);
  const server = createApp(db, { production: false, serveClient: false, duoEnabled: true, duoCredentials: settings, duo: { now: () => now } }).listen(0, "127.0.0.1");
  await once(server, "listening"); const address = server.address(); assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`; const cookies = { a: "", b: "" };
  async function request(who: "a" | "b", method: string, path: string, body?: unknown, expected = 200): Promise<any> {
    const response = await fetch(`${origin}/api${path}`, { method, headers: { Cookie: cookies[who], ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const cookie = response.headers.getSetCookie().at(-1); if (cookie) cookies[who] = cookie.split(";")[0];
    const result = await response.json(); assert.equal(response.status, expected, JSON.stringify(result)); return result;
  }
  const start = async (who: "a" | "b", mode = "quick") => (await request(who, "POST", "/placement/start", { mode }, 201)).placement as PlacementState;
  try {
    await request("a", "POST", "/auth/login", { phone: settings.accounts[0].phone, password: "synthetic-timer-password-a" });
    await request("b", "POST", "/auth/login", { phone: settings.accounts[1].phone, password: "synthetic-timer-password-b" });
    await t.test("draft choice reloads without answer material or a new deadline; foreign and invalid choices fail", async () => {
      const p = await start("a"), item = bank.find(item => item.id === p.question!.id)!;
      assert.equal(Date.parse(p.deadlineAt!) - now, 1200000);
      await request("b", "POST", `/placement/${p.id}/draft`, { questionId: item.id, answer: item.answer }, 404);
      await request("a", "POST", `/placement/${p.id}/draft`, { questionId: item.id, answer: "invalid" }, 400);
      await request("a", "POST", `/placement/${p.id}/draft`, { questionId: item.id, answer: item.answer });
      now += 60000;
      const reload = (await request("a", "GET", `/placement/${p.id}`)).placement as PlacementState;
      assert.equal(reload.deadlineAt, p.deadlineAt); assert.equal(reload.draftAnswer, item.answer);
      assert.equal(reload.result, null); assert.equal("answer" in reload.question!, false);
      assert.equal((await request("a", "POST", "/placement/start", { mode: "quick" })).placement.deadlineAt, p.deadlineAt);
      const before = await db.users.findOne({ phone: settings.accounts[0].phone });
      now = Date.parse(p.deadlineAt!);
      const expired = (await request("a", "GET", `/placement/${p.id}`)).placement as PlacementState;
      assert.equal(expired.question, null); assert.equal(expired.completionReason, "deadline");
      assert.equal(expired.result!.estimatedBand, null); assert.equal(expired.result!.answers.length, 1);
      assert.equal(expired.result!.answers[0].answer, item.answer); assert.equal(expired.result!.answers[0].response, item.answer);
      assert.equal((await db.users.findOne({ _id: before!._id }))!.currentBand, before!.currentBand);
      const late = (await request("a", "POST", `/placement/${p.id}/answer`, { questionId: item.id, answer: item.options[1] })).placement;
      assert.deepEqual(late.result, expired.result);
    });
    await t.test("blank current item gets a review but unserved items are never fabricated", async () => {
      const p = await start("b", "deep"); assert.equal(Date.parse(p.deadlineAt!) - now, 2400000);
      now = Date.parse(p.deadlineAt!) + 1;
      const [one, two] = await Promise.all([request("b", "GET", `/placement/${p.id}`), request("b", "GET", `/placement/${p.id}`)]);
      assert.deepEqual(one.placement.result, two.placement.result);
      assert.equal(one.placement.result.answers.length, 1); assert.equal(one.placement.result.answers[0].response, "");
      assert.equal(one.placement.result.estimatedBand, null);
    });
    await t.test("enough completed items plus saved current draft produce a partial estimate at expiry", async () => {
      let p = await start("a");
      for (let i = 0; i < 5; i++) {
        const item = bank.find(item => item.id === p.question!.id)!;
        p = (await request("a", "POST", `/placement/${p.id}/answer`, { questionId: item.id, answer: item.answer })).placement;
      }
      const current = bank.find(item => item.id === p.question!.id)!;
      await request("a", "POST", `/placement/${p.id}/draft`, { questionId: current.id, answer: current.answer });
      now = Date.parse(p.deadlineAt!) + 1;
      const history = (await request("a", "GET", "/placement/history")).placements.find((row: { id: string }) => row.id === p.id);
      assert.equal(history.result.answers.length, 6); assert.ok(history.result.estimatedBand !== null);
      const persisted = await db.placements.findOne({ _id: p.id }); assert.equal(persisted!.answers.length, 6);
      assert.equal(persisted!.completionReason, "deadline");
      assert.equal(await db.db.collection("duo_placement_results").countDocuments({ placementAttemptId: p.id }), 1);
    });
    await t.test("legacy active placement receives one persisted remaining allowance on resume", async () => {
      const p = await start("b"); await db.placements.updateOne({ _id: p.id }, { $unset: { deadlineAt: "" } });
      const first = (await request("b", "GET", `/placement/${p.id}`)).placement;
      now += 30000; const second = (await request("b", "GET", `/placement/${p.id}`)).placement;
      assert.equal(first.deadlineAt, second.deadlineAt); assert.equal(first.result, null);
    });
    await t.test("a draft racing another tab's answer returns the current question instead of stale state", async () => {
      const p = await start("a"), item = bank.find(row => row.id === p.question!.id)!;
      const original = db.placements.findOneAndUpdate.bind(db.placements);
      let raced = false;
      Object.assign(db.placements, { findOneAndUpdate: async (filter: any, update: any, options: any) => {
        if (!raced && update.$set?.draftAnswer?.questionId === item.id) {
          raced = true;
          await request("a", "POST", `/placement/${p.id}/answer`, { questionId: item.id, answer: item.answer });
          return null;
        }
        return original(filter, update, options);
      } });
      try {
        const result = (await request("a", "POST", `/placement/${p.id}/draft`, { questionId: item.id, answer: item.answer })).placement;
        assert.ok(raced); assert.equal(result.completed, 1);
        assert.notEqual(result.question.id, item.id); assert.equal(result.draftAnswer, "");
        assert.equal(result.deadlineAt, p.deadlineAt);
      } finally { db.placements.findOneAndUpdate = original; }
    });
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await db.db.dropDatabase(); await db.client.close(); }
});
