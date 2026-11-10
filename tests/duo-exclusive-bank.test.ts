import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { contentBank, placementBank } from "../server/data/index";
import { validateContentStructure } from "../shared/content-visuals";
import { DUO_EXAM_CONTENT_COLLECTION, duoAssessmentContents, ensureExclusiveDuoBank,
  ensureDuoGateSupplement, exclusiveDuoBank, isExclusiveDuoContentId, selectExclusiveDuoContent } from "../server/duo-exam-content";
import { newDuoGatePapers } from "../server/data/duo-gate-supplement";
import { connectDatabase } from "../server/storage";
import { gradeObjective } from "../server/learning";

const canonical = (text: string) => text.normalize("NFC").toLowerCase().replace(/\s+/gu, " ").trim();

test("exclusive papers are complete, new and absent from every public study source", () => {
  const papers = exclusiveDuoBank();
  assert.equal(papers.length, 493);
  assert.equal(new Set(papers.map(paper => paper.id)).size, papers.length);
  const publicIds = new Set(contentBank.map(content => content.id));
  const publicSources = new Set([
    ...contentBank.flatMap(content => content.sections.map(section => canonical(section.dialogue?.map(line => line.text).join(" ") || section.text))),
    ...placementBank.map(item => canonical(item.text)),
  ]);
  const privateSources = new Set<string>();
  for (const paper of papers) {
    assert.ok(isExclusiveDuoContentId(paper.id));
    assert.equal(publicIds.has(paper.id), false);
    validateContentStructure(paper);
    if (["reading", "listening", "grammar"].includes(paper.skill)) {
      const feedback = gradeObjective(paper, Object.fromEntries(paper.questions.map(question => [question.id, question.answer])));
      assert.ok(feedback.answers.every(answer => answer.correct), paper.id);
    }
    if (["reading", "listening"].includes(paper.skill)) {
      assert.equal(paper.questions.length, paper.format === "full-mock" ? 40 : 8);
      for (const section of paper.sections) {
        const text = canonical(section.dialogue?.map(line => line.text).join(" ") || section.text);
        assert.ok(text.length > 500);
        assert.equal(publicSources.has(text), false, paper.id);
        assert.equal(privateSources.has(text), false, paper.id);
        privateSources.add(text);
      }
    }
  }
  assert.equal(contentBank.some(content => isExclusiveDuoContentId(content.id)), false);
});

test("paper planning is read-only, exact-band and exhausts without reusing a practice paper", async () => {
  const database = { db: new Proxy({}, { get() { throw new Error("Planning must not touch MongoDB."); } }) } as never;
  const used: string[] = [];
  for (let sitting = 0; sitting < 11; sitting++) {
    const ids = await selectExclusiveDuoContent(database, {
      band: 3, testType: "academic", kind: "gate", skills: ["reading", "listening", "grammar"], excludeIds: used,
    });
    assert.equal(ids.length, 3);
    assert.equal(ids.some(id => used.includes(id)), false);
    assert.ok(ids.every(id => exclusiveDuoBank().find(paper => paper.id === id)?.band === 3));
    used.push(...ids);
  }
  await assert.rejects(selectExclusiveDuoContent(database, {
    band: 3, testType: "academic", kind: "gate", skills: ["reading"], excludeIds: used,
  }), /Đã dùng hết đề riêng/u);
  const academic = await selectExclusiveDuoContent(database, { band: 3, testType: "academic", kind: "promotion", skills: ["writing"] });
  const general = await selectExclusiveDuoContent(database, { band: 3, testType: "general", kind: "promotion", skills: ["writing"] });
  assert.notDeepEqual(academic, general);
});

test("private seed is add-only, retryable and cannot overwrite historical content or learner progress", async () => {
  const name = "ielts_private_bank_test_" + randomUUID().replaceAll("-", "");
  const database = await connectDatabase("mongodb://127.0.0.1:27017", name);
  try {
    const original = { _id: "synthetic-preserved-progress", value: { band: 3, done: true } };
    const progress = database.db.collection<typeof original>("synthetic_progress");
    await progress.insertOne(original);
    await ensureExclusiveDuoBank(database);
    await ensureExclusiveDuoBank(database);
    assert.equal(await database.db.collection(DUO_EXAM_CONTENT_COLLECTION).countDocuments(), 493);
    assert.equal(await database.content.countDocuments(), 0);
    assert.deepEqual(await progress.findOne({ _id: original._id }), original);
    const supplementIds = newDuoGatePapers().map(paper => paper.id);
    const privateInventory = database.db.collection(DUO_EXAM_CONTENT_COLLECTION);
    await privateInventory.deleteMany({ id: { $in: supplementIds } });
    const oldInventory = await privateInventory.find({}).sort({ id: 1 }).toArray();
    assert.equal(oldInventory.length, 484);
    await ensureDuoGateSupplement(database);
    await ensureDuoGateSupplement(database);
    assert.equal(await privateInventory.countDocuments(), 493);
    assert.deepEqual(await privateInventory.find({ id: { $nin: supplementIds } }).sort({ id: 1 }).toArray(), oldInventory);
    assert.deepEqual(await progress.findOne({ _id: original._id }), original);
    const first = exclusiveDuoBank()[0]!;
    const [loaded] = await duoAssessmentContents(database, [first.id]);
    assert.equal(loaded.id, first.id);
    assert.equal("duoExam" in loaded, false);
    assert.deepEqual(loaded.questions, first.questions);
    assert.deepEqual(await duoAssessmentContents(database, ["duo-private-missing"]), []);
    const privateCollection = database.db.collection<{ _id: string; title: string }>(DUO_EXAM_CONTENT_COLLECTION);
    await privateCollection.updateOne({ _id: first.id }, { $set: { title: "Synthetic unexpected modification" } });
    const second = await connectDatabase("mongodb://127.0.0.1:27017", name);
    try {
      await assert.rejects(ensureExclusiveDuoBank(second), /chưa được xác minh/u);
      assert.equal((await privateCollection.findOne({ _id: first.id }))?.title, "Synthetic unexpected modification");
    } finally { await second.client.close(); }
  } finally {
    await database.db.dropDatabase();
    await database.client.close();
  }
});
