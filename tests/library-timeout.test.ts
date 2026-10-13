import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { test } from "node:test";
import { createApp } from "../server/app";
import { hashToken, initialProfile } from "../server/auth";
import { connectDatabase, type Database } from "../server/storage";
import { contentBank, placementBank } from "../server/data/index";

test("stalled native Mongo reads return retryable HTTP errors without starting a Listening exam", { timeout: 30_000 }, async t => {
  const name = `ielts_library_timeout_test_${randomUUID().replaceAll("-", "")}`;
  assert.match(name, /^ielts_library_timeout_test_[a-f0-9]{32}$/);
  const keys = ["IELTS_OPENAI_API_KEY", "OPENAI_API_KEY", "ELEVENLABS_API_KEY"];
  const prior = new Map(keys.map(key => [key, process.env[key]]));
  keys.forEach(key => delete process.env[key]);
  process.env.IELTS_OPENAI_API_KEY = "synthetic-listening-timeout-no-provider";
  let database: Database | undefined, server: Server | undefined;
  const originalFetch = globalThis.fetch;
  let origin = "";
  // Even a regression cannot use this fixture to call a paid provider.
  globalThis.fetch = ((input, init) => {
    assert.ok(origin && String(input).startsWith(`${origin}/api/`));
    return originalFetch(input, init);
  }) as typeof fetch;
  try {
    database = await connectDatabase("mongodb://127.0.0.1:27017", name);
    const listening = contentBank.find(item => item.skill === "listening" && item.format === "lesson")!;
    const placement = placementBank.find(item => item.skill === "listening")!;
    const user = initialProfile({ name: "Synthetic Timeout Learner", email: "timeout@example.test", targetBand: 8, testType: "academic" }, "synthetic-timeout-user");
    await database.users.insertOne({ ...user, _id: user.id, passwordHash: null });
    const token = "synthetic-timeout-session";
    await database.sessions.insertOne({ _id: hashToken(token), userId: user.id, createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000) });
    await database.content.insertOne({ ...listening, _id: listening.id });
    await database.placementItems.insertOne({ ...placement, _id: placement.id });
    await database.db.collection<{ _id: string; [key: string]: unknown }>("attempts").insertOne({ _id: "synthetic-invalidated", id: "synthetic-invalidated", userId: user.id, contentId: listening.id, mode: "practice", status: "invalidated", startedAt: new Date().toISOString() });
    const snapshot = async () => {
      const names = (await database!.db.listCollections().toArray()).map(item => item.name).sort();
      return Promise.all(names.map(async collection => [collection, await database!.db.collection(collection).find().sort({ _id: 1 }).toArray()]));
    };
    const before = await snapshot();
    server = createApp(database, { production: false, demoEnabled: false, duoEnabled: false, examIntegrityEnabled: true, serveClient: false }).listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address(); assert.ok(address && typeof address !== "string");
    origin = `http://127.0.0.1:${address.port}`;
    const get = (path: string) => fetch(`${origin}/api${path}`, { headers: { Cookie: `ielts_session=${token}` } });
    const readinessPath = `/content/${listening.id}/listening-audio/readiness`;
    for (const [label, collection, method, path] of [
      ["session lookup", database.sessions, "findOne", readinessPath],
      ["learner lookup", database.users, "findOne", readinessPath],
      ["Listening library", database.content, "find", "/content?skill=listening"],
      ["Listening content lookup", database.content, "findOne", readinessPath],
      ["retake lookup", database.attempts, "findOne", readinessPath],
      ["placement bank lookup", database.placementItems, "find", "/placement/audio/readiness"],
    ] as const) {
      await t.test(label, async () => {
        // Delay only this fixture's collection query; never enable global
        // Mongo failpoints or affect any other database/learner.
        const target = collection as unknown as Record<"find" | "findOne",
          (filter: Record<string, unknown>, options?: Record<string, unknown>) => unknown>;
        const original = target[method].bind(target);
        let reached = false;
        target[method] = ((filter: Record<string, unknown>, options: Record<string, unknown> = {}) => {
          assert.equal(options.timeoutMS, 5_000);
          reached = true;
          return original({ ...filter, $where: "function() { sleep(1000); return true; }" }, { ...options, timeoutMS: 75 });
        });
        try {
          const started = performance.now();
          const response = await get(path);
          assert.equal(response.status, 503);
          const body = await response.json();
          assert.match(body.error, /tạm thời|thử lại/u);
          assert.ok(performance.now() - started < 2_000, "native timeout must finish without waiting for the stalled read");
          assert.ok(reached);
          assert.equal(JSON.stringify(body).includes("synthetic-timeout"), false);
          assert.equal(JSON.stringify(body).includes("sleep"), false);
        } finally { target[method] = original; }
        assert.deepEqual(await snapshot(), before, "GET failures must preserve learner data and must not create clocks, attempts, caches or jobs");
      });
    }
    assert.equal((await get("/content?skill=listening")).status, 200);
    const pending = await (await get(readinessPath)).json();
    assert.equal(pending.audio.ready, false);
    assert.equal(pending.audio.state, "pending");
    assert.deepEqual(await snapshot(), before, "a retry only reads metadata");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of prior) value === undefined ? delete process.env[key] : process.env[key] = value;
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    if (database) {
      assert.equal(database.db.databaseName, name);
      await database.db.dropDatabase();
      await database.client.close();
    }
  }
});
