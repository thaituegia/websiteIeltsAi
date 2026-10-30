import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { test } from "node:test";
import { createApp, sanitizeContent } from "../server/app";
import { contentBank } from "../server/data/index";
import { connectDatabase, type AttemptRecord } from "../server/storage";
import type { Attempt, Feedback, StoredContent } from "../shared/types";

test("Writing guides remain private, persist with submission and safely enrich legacy review without changing the bank", { timeout: 60_000 }, async t => {
  const name = `ielts_writing_guides_${randomUUID().replaceAll("-", "")}`;
  assert.match(name, /^ielts_writing_guides_[a-f0-9]{32}$/u);
  const database = await connectDatabase("mongodb://127.0.0.1:27017", name);
  const source = contentBank.find(item => item.id === "fresh-w-mock-01")!;
  assert.ok(source?.referenceAnswers?.length === 2);
  const content = structuredClone(source);
  const keys = ["IELTS_OPENAI_API_KEY", "OPENAI_API_KEY", "IELTS_AZURE_SPEECH_KEY", "AZURE_SPEECH_KEY", "ELEVENLABS_API_KEY"];
  const prior = new Map(keys.map(key => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  let server: Server | undefined, origin = "";
  const cookies = { a: "", b: "" };

  async function request(who: "a" | "b", method: string, path: string, body?: unknown, status = 200): Promise<any> {
    const response = await fetch(`${origin}/api${path}`, { method,
      headers: { ...(cookies[who] ? { Cookie: cookies[who] } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json();
    assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(result)}`);
    const cookie = response.headers.getSetCookie().at(-1);
    if (cookie) cookies[who] = cookie.split(";")[0];
    return result;
  }
  async function storedHistory(base: AttemptRecord, feedback: Feedback, id = randomUUID()) {
    await database.attempts.insertOne({ ...structuredClone(base), id, _id: id, feedback });
    return id;
  }
  let submitted: Attempt | undefined;
  try {
    await database.content.insertOne({ ...content, _id: content.id });
    const bankBefore = await database.content.find().toArray();
    server = createApp(database, { serveClient: false, production: false, duoEnabled: false,
      demoEnabled: false, examIntegrityEnabled: false, maxLearners: 2 }).listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address(); assert.ok(address && typeof address !== "string");
    origin = `http://127.0.0.1:${address.port}`;
    for (const who of ["a", "b"] as const) {
      await request(who, "POST", "/auth/register", { name: `Synthetic Writing ${who}`, email: `${who}@writing-guides.example.test`,
        password: "synthetic-writing-guide-password", targetBand: 7, testType: "academic" }, 201);
    }
    const attempt = (await request("a", "POST", "/attempts", { contentId: content.id, mode: "practice" }, 201)).attempt as Attempt;

    await t.test("public/list/detail and an active attempt contain no samples or study guides", async () => {
      assert.equal("referenceAnswers" in sanitizeContent(content), false);
      assert.ok(sanitizeContent(content).description.includes("Bài mẫu và hướng dẫn mở sau khi nộp bài."));
      for (const view of [
        (await request("a", "GET", `/content/${content.id}`)).content,
        (await request("a", "GET", "/content?skill=writing")).items[0],
        (await request("a", "GET", `/attempts/${attempt.id}`)).attempt,
      ]) {
        const payload = JSON.stringify(view);
        assert.equal(payload.includes(content.referenceAnswers![0].sampleAnswer), false);
        assert.equal(payload.includes("writingGuides"), false);
      }
      await request("b", "GET", `/attempts/${attempt.id}`, undefined, 404);
    });

    await t.test("an offline submission snapshots task-matched Vietnamese guidance and exact existing models", async () => {
      await request("a", "PATCH", `/attempts/${attempt.id}`, { essays: Object.fromEntries(content.sections.map(section => [section.id,
        `This is a synthetic saved essay about ${section.title}. The argument is supported by a relevant example.`])) });
      submitted = (await request("a", "POST", `/attempts/${attempt.id}/submit`)).attempt as Attempt;
      assert.equal(submitted.status, "submitted");
      assert.equal(submitted.feedback?.estimatedBand, null, "Illustrative models do not manufacture an AI band");
      assert.deepEqual(submitted.feedback?.referenceAnswers, content.referenceAnswers);
      const guides = submitted.feedback?.writingGuides;
      assert.equal(guides?.length, 2);
      assert.deepEqual(guides?.map(guide => guide.sectionId), content.sections.map(section => section.id));
      assert.deepEqual(guides?.map(guide => guide.timePlan.minimumWords), [150, 250]);
      for (const guide of guides!) {
        assert.equal(guide.sourceVerified, true);
        assert.ok(guide.analysis.length && guide.steps.length && guide.checklist.length && guide.pitfalls.length);
        const reference = content.referenceAnswers!.find(reference => reference.sectionId === guide.sectionId)!;
        for (const paragraph of guide.paragraphs) assert.ok(reference.sampleAnswer.includes(paragraph.excerpt));
        for (const phrase of guide.usefulLanguage) assert.ok(reference.sampleAnswer.includes(phrase.phrase));
      }
      const saved = await database.attempts.findOne({ _id: attempt.id });
      assert.deepEqual(saved?.feedback?.writingGuides, guides);
      assert.deepEqual(saved?.essays, submitted.essays);
      assert.deepEqual(await database.content.find().toArray(), bankBefore);
    });

    await t.test("legacy bank review adds guides read-only, preserving saved feedback and models", async () => {
      const base = await database.attempts.findOne({ _id: attempt.id }); assert.ok(base?.feedback);
      const feedback = structuredClone(base.feedback); delete feedback.writingGuides;
      const id = await storedHistory(base, feedback);
      const before = await database.attempts.findOne({ _id: id });
      const result = (await request("a", "GET", `/attempts/${id}`)).attempt as Attempt;
      assert.ok(result.feedback?.writingGuides?.every(guide => guide.sourceVerified));
      assert.deepEqual(result.feedback?.referenceAnswers, feedback.referenceAnswers);
      assert.deepEqual(await database.attempts.findOne({ _id: id }), before);
      await request("b", "GET", `/attempts/${id}`, undefined, 404);
    });

    await t.test("invalidated or draft records cannot reveal even previously stored guides", async () => {
      const base = await database.attempts.findOne({ _id: attempt.id }); assert.ok(base?.feedback);
      for (const status of ["in-progress", "invalidated"] as const) {
        const id = randomUUID();
        await database.attempts.insertOne({ ...structuredClone(base), id, _id: id, status,
          ...(status === "invalidated" ? { invalidatedAt: new Date().toISOString() } : {}) });
        const result = (await request("a", "GET", `/attempts/${id}`)).attempt as Attempt;
        assert.equal(result.feedback, null);
        assert.equal(JSON.stringify(result).includes("writingGuides"), false);
        assert.equal(JSON.stringify(result).includes(content.referenceAnswers![0].sampleAnswer), false);
      }
    });

    await t.test("edited legacy sources get a conservative notice while new saved guides remain snapshots", async () => {
      const base = await database.attempts.findOne({ _id: attempt.id }); assert.ok(base?.feedback);
      const legacy = structuredClone(base.feedback); delete legacy.writingGuides;
      const legacyId = await storedHistory(base, legacy);
      const changed = structuredClone(content.sections);
      changed[0].text = "A teacher replaced this prompt with a completely different source.";
      await database.content.updateOne({ _id: content.id }, { $set: { sections: changed } });
      const before = await database.attempts.findOne({ _id: legacyId });
      const old = (await request("a", "GET", `/attempts/${legacyId}`)).attempt as Attempt;
      const first = old.feedback?.writingGuides?.find(guide => guide.sectionId === changed[0].id);
      assert.equal(first?.sourceVerified, false); assert.ok(first?.notice);
      assert.deepEqual(old.feedback?.referenceAnswers, legacy.referenceAnswers);
      assert.deepEqual(await database.attempts.findOne({ _id: legacyId }), before);
      const fresh = (await request("a", "GET", `/attempts/${attempt.id}`)).attempt as Attempt;
      assert.deepEqual(fresh.feedback?.writingGuides, submitted!.feedback?.writingGuides);
      assert.deepEqual(fresh.feedback?.referenceAnswers, submitted!.feedback?.referenceAnswers);
    });
  } finally {
    if (server) {
      await new Promise<void>(resolve => server!.close(() => resolve()));
      server.closeAllConnections();
    }
    await database.db.dropDatabase(); await database.client.close();
    for (const key of keys) {
      const value = prior.get(key);
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
