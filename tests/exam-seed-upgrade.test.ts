import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { BSON } from "mongodb";
import { contentBank, placementBank, vocabularyBank } from "../server/data/index";
import { replacementBank as initialBank } from "../server/data/initial-fresh-bank";
import { connectDatabase, seedDatabase } from "../server/storage";
import { addMissingReferenceAnswers } from "../server/content-references";
import { auditExamReferences } from "../scripts/audit-exam-references";

test("new complete mocks and section-specific reference answers are independent and keep the existing task keys", { timeout: 60_000 }, () => {
  const report = auditExamReferences();
  assert.equal(report.status, "passed", report.issues.join("\n"));
  assert.deepEqual(report.bySkill, { reading: 12, listening: 20, writing: 36, speaking: 36 });
  assert.equal(report.reviewedContents, 612);
  assert.equal(report.reviewedSections, 774);
  assert.equal(report.interviewResponses, 1656);
});

test("exam upgrade adds new IDs and missing models while preserving scores, accounts, custom tasks and edited teacher models", { timeout: 90_000 }, async () => {
  const name = `ielts_ai_exam_upgrade_test_${randomUUID().replaceAll("-", "")}`;
  const database = await connectDatabase(process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017", name);
  const stringify = (value: unknown) => BSON.EJSON.stringify(value, { relaxed: false });
  try {
    await seedDatabase(database, { content: initialBank.content, vocabulary: initialBank.vocabulary, placementItems: initialBank.placementItems });
    const privateNames = ["users", "sessions", "attempts", "placements", "cards", "plans", "audio", "recordings.files", "recordings.chunks", "duo_learning_paths", "duo_assessments", "duo_promotion_rooms"];
    for (const collection of privateNames) await database.db.collection<{ _id: string; retained: boolean; score: number; recordedAt: Date }>(collection).insertOne({ _id: `synthetic-${collection}`, retained: true, score: 6.5, recordedAt: new Date("2026-10-11T02:00:00Z") });
    const snapshots = await Promise.all(privateNames.map(async collection => stringify(await database.db.collection(collection).find().sort({ _id: 1 }).toArray())));
    const productive = contentBank.filter(item => item.skill === "writing" && initialBank.content.some(initial => initial.id === item.id));
    const modified = productive[0]!, teacher = productive[1]!;
    const modifiedSections = structuredClone(modified.sections);
    modifiedSections[0]!.text += "\nA teacher has edited the task and its figures.";
    await database.content.updateOne({ _id: modified.id }, { $set: { sections: modifiedSections } });
    const teacherReferences = [{ sectionId: teacher.sections[0]!.id, title: "Teacher example", sampleAnswer: "A privately edited, retained teacher example.", explanation: "Do not overwrite it.", keyPoints: ["Custom model", "Retain teacher work"] }];
    await database.content.updateOne({ _id: teacher.id }, { $set: { referenceAnswers: teacherReferences } });
    const custom = { ...initialBank.content[0]!, id: "custom-owned-learning-material", _id: "custom-owned-learning-material", title: "A teacher's own task" };
    await database.content.insertOne(custom);
    const oldPublic = await database.content.find().sort({ _id: 1 }).toArray();

    await seedDatabase(database);
    await seedDatabase(database);
    assert.equal(await database.content.countDocuments(), 967);
    assert.equal(await database.vocabulary.countDocuments(), vocabularyBank.length);
    assert.equal(await database.placementItems.countDocuments(), placementBank.length);
    for (const [index, collection] of privateNames.entries())
      assert.equal(stringify(await database.db.collection(collection).find().sort({ _id: 1 }).toArray()), snapshots[index], collection);
    for (const previous of oldPublic) {
      const current = await database.content.findOne({ _id: previous._id }); assert.ok(current);
      const { referenceAnswers: beforeModel, ...before } = previous;
      const { referenceAnswers: afterModel, ...after } = current;
      assert.equal(stringify(after), stringify(before), `${previous.id}: existing source, key and metadata preserved`);
      if (beforeModel) assert.deepEqual(afterModel, beforeModel);
    }
    assert.equal((await database.content.findOne({ _id: modified.id }))!.referenceAnswers, undefined, "A sample for an unedited source must not be attached to a different task");
    assert.deepEqual((await database.content.findOne({ _id: teacher.id }))!.referenceAnswers, teacherReferences);
    const report = await addMissingReferenceAnswers(database.content, contentBank);
    assert.equal(report.added, 0); assert.equal(report.skippedModifiedContent, 1);
    assert.equal(report.alreadyPresent, 611);
  } finally {
    assert.equal(database.db.databaseName, name);
    await database.db.dropDatabase(); await database.client.close();
  }
});

test("reference audit rejects a missing task, copied model and a model below the IELTS word minimum", () => {
  const bank = structuredClone(contentBank);
  const writing = bank.filter(item => item.skill === "writing");
  writing[0]!.referenceAnswers = [];
  writing[2]!.referenceAnswers![0]!.sampleAnswer = writing[1]!.referenceAnswers![0]!.sampleAnswer;
  writing[3]!.referenceAnswers![0]!.sampleAnswer = "This is not a complete IELTS response.";
  const report = auditExamReferences(bank);
  assert.equal(report.status, "failed");
  assert.ok(report.issues.some(issue => /each task\/Part/.test(issue)));
  assert.ok(report.issues.some(issue => /repeated or empty full sample/.test(issue)));
  assert.ok(report.issues.some(issue => /below authentic Writing minimum/.test(issue)));
});
