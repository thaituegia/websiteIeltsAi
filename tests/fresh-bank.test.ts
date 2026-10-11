import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { auditFreshBank } from "../scripts/audit-fresh-bank";
import { replacementBank } from "../server/data/index";
import { replacementBank as freshV2 } from "../server/data/fresh-v2-bank";
import { contentBank as previousContent } from "../server/data/previous-bank";
import { connectDatabase, seedDatabase } from "../server/storage";

test("the active bank is wholly new and passes source, key, authentic mock and coverage checks", { timeout: 60_000 }, () => {
  const report = auditFreshBank();
  assert.equal(report.status, "passed", report.issues.join("\n"));
  assert.deepEqual(report.counts, { content: 966, lessons: 810, mocks: 156, vocabulary: 648, placement: 480 });
  assert.equal(report.workload.length, 48);
  assert.ok(report.objectiveQuestionsChecked > 600);
  for (const item of replacementBank.content.filter(x => x.skill === "writing")) {
    assert.ok(item.sections.every(x => !x.text.includes("Practice planning note")), "Exam stimuli must not embed planning hints");
    if (item.format === "lesson") assert.ok(item.objectives?.[2]?.length, "Practice guide remains separate from the task stimulus");
  }
});

test("tripling retains every v2 source, answer, sample and vocabulary link and triples every skill/format", () => {
  for (const key of ["content", "vocabulary", "placementItems"] as const) {
    assert.equal(replacementBank[key].length, freshV2[key].length * 3, key);
    const target = new Map(replacementBank[key].map(row => [row.id, JSON.stringify(row)]));
    for (const previous of freshV2[key]) assert.equal(target.get(previous.id), JSON.stringify(previous), previous.id);
  }
  for (const skill of ["reading", "listening", "writing", "speaking", "grammar"])
    for (const format of ["lesson", "full-mock"])
      assert.equal(replacementBank.content.filter(row => row.skill === skill && row.format === format).length,
        freshV2.content.filter(row => row.skill === skill && row.format === format).length * 3, `${skill}/${format}`);
  for (const skill of ["reading", "listening", "grammar"])
    assert.equal(replacementBank.content.filter(row => row.skill === skill).reduce((sum, row) => sum + row.questions.length, 0),
      freshV2.content.filter(row => row.skill === skill).reduce((sum, row) => sum + row.questions.length, 0) * 3,
      `${skill}: question totals must also triple`);
  const interviewCount = (bank: typeof replacementBank) => bank.content.filter(row => row.skill === "speaking")
    .flatMap(row => row.referenceAnswers || []).reduce((sum, reference) => sum + (reference.responses?.length || 0), 0);
  assert.equal(interviewCount(replacementBank), interviewCount(freshV2) * 3);
});

test("fresh-bank audit rejects reused sources, relabelled visuals and invalid objective keys", { timeout: 60_000 }, () => {
  const bank = structuredClone(replacementBank);
  const reading = bank.content.find(x => x.skill === "reading")!;
  reading.sections[0]!.text = previousContent.find(x => x.skill === "reading")!.sections[0]!.text;
  reading.questions[0]!.answer = "synthetic answer not supported by the source";
  const charts = bank.content.filter(x => x.skill === "writing" && x.sections.some(s => s.visuals?.some(v => v.type === "bar")));
  const original = charts[0]!.sections.find(s => s.visuals?.some(v => v.type === "bar"))!.visuals!.find(v => v.type === "bar")!;
  const target = charts[1]!.sections.find(s => s.visuals?.some(v => v.type === "bar"))!;
  target.visuals = [{ ...structuredClone(original), id: "synthetic-new-visual-name", title: "Changed decorative title" }];
  const report = auditFreshBank(bank);
  assert.equal(report.status, "failed");
  assert.ok(report.issues.some(x => /repeats an existing source|excessive source overlap/.test(x)));
  assert.ok(report.issues.some(x => /repeats existing visual data/.test(x)));
  assert.ok(report.issues.some(x => /key must match|perfect keys fail|answer exceeds/.test(x)));
});

test("fresh startup refuses an older bank before any insertion; fresh seeding is repeatable and retains progress", { timeout: 90_000 }, async () => {
  const name = `ielts_ai_fresh_test_${randomUUID().replaceAll("-", "")}`;
  const db = await connectDatabase(process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017", name);
  try {
    await db.content.insertOne({ ...previousContent[0]!, _id: previousContent[0]!.id });
    await db.attempts.insertOne({ _id: "synthetic-private-attempt", userId: "synthetic-user", status: "submitted" } as never);
    await assert.rejects(seedDatabase(db), /earlier bank/);
    assert.equal(await db.content.countDocuments(), 1); assert.equal(await db.vocabulary.countDocuments(), 0);
    await db.content.deleteMany({});
    await db.content.insertOne({ ...replacementBank.content[0]!, id: "synthetic-old-custom", _id: "synthetic-old-custom" });
    await assert.rejects(seedDatabase(db), /earlier bank/);
    assert.equal(await db.content.countDocuments(), 1);
    await db.content.deleteMany({});
    await seedDatabase(db); await seedDatabase(db);
    assert.deepEqual(await Promise.all([db.content.countDocuments(), db.vocabulary.countDocuments(), db.placementItems.countDocuments(), db.attempts.countDocuments()]), [966, 648, 480, 1]);
    await assert.rejects(seedDatabase({ ...db, db: db.client.db("ielts_ai") }, { content: previousContent, vocabulary: [], placementItems: [] }), /isolated test databases/);
  } finally {
    assert.equal(db.db.databaseName, name);
    await db.db.dropDatabase(); await db.client.close();
  }
});
