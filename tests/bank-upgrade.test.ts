import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { test } from "node:test";
import { BSON, ObjectId, type Document } from "mongodb";
import { connectDatabase } from "../server/storage";
import { inspectBankUpgrade, upgradeBank, verifyBankUpgrade } from "../server/bank-upgrade";
import { replacementBank as source } from "../server/data/initial-fresh-bank";
import type { ReplacementBank } from "../server/bank-reset";
import type { ReferenceResponse, StoredContent } from "../shared/types";

const canonical = (value: unknown) => BSON.EJSON.stringify(value, { relaxed: false });
function reference(item: StoredContent, label: string): ReferenceResponse[] {
  return item.sections.map(section => ({ sectionId: section.id, title: "Synthetic illustrative answer", sampleAnswer: `Synthetic sample for ${label}; this is not a scored IELTS response.`, explanation: "A synthetic fixture verifies preservation, not educational content quality.", keyPoints: [section.title] }));
}
function fixtureBanks(): { baseline: ReplacementBank; target: ReplacementBank; modelIds: string[]; teacherId: string; changedId: string } {
  const baseline = structuredClone(source);
  baseline.content = baseline.content.map(({ referenceAnswers: _references, ...item }) => item);
  const productive = baseline.content.filter(item => item.skill === "writing").slice(0, 4);
  assert.equal(productive.length, 4);
  const target = structuredClone(baseline); target.version = "fresh-upgrade-tests-v2";
  for (const item of target.content.filter(item => productive.some(old => old.id === item.id))) item.referenceAnswers = reference(item, item.id);
  const mock = baseline.content.find(item => item.format === "full-mock" && item.skill === "reading")!;
  for (const index of [1, 2]) {
    const id = `fresh-synthetic-upgrade-mock-${index}`;
    const item = JSON.parse(JSON.stringify(mock).replaceAll(mock.id, id)) as StoredContent;
    target.content.push(item);
    target.vocabulary.push({ ...structuredClone(baseline.vocabulary[index - 1]!), id: `fresh-synthetic-upgrade-vocabulary-${index}`, word: `synthetic lexeme ${index}` });
    target.placementItems.push({ ...structuredClone(baseline.placementItems[index - 1]!), id: `fresh-synthetic-upgrade-placement-${index}`, text: `Synthetic unique placement fixture ${index}.` });
  }
  return { baseline, target, modelIds: productive.slice(0, 2).map(item => item.id), teacherId: productive[2].id, changedId: productive[3].id };
}

test("native preserving upgrade keeps every old document/index and recording while adding content, vocabulary, placement and applicable models", { timeout: 90_000 }, async t => {
  const databaseName = `ielts_upgrade_test_${Math.floor(Date.now() / 1000)}_${randomUUID().replaceAll("-", "")}`;
  const database = await connectDatabase(process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017", databaseName);
  const directory = await mkdtemp(join(tmpdir(), "ielts-bank-upgrade-"));
  const { baseline, target, modelIds, teacherId, changedId } = fixtureBanks();
  const options = (name: string) => ({ expectedDatabase: databaseName, testDatabase: true, appOffline: true, backupDirectory: join(directory, name) });
  const verifyOptions = { expectedDatabase: databaseName, testDatabase: true };
  try {
    await database.content.insertMany(baseline.content.map(item => ({ ...item, _id: item.id })), { ignoreUndefined: true });
    await database.vocabulary.insertMany(baseline.vocabulary.map(item => ({ ...item, _id: item.id })), { ignoreUndefined: true });
    await database.placementItems.insertMany(baseline.placementItems.map(item => ({ ...item, _id: item.id })), { ignoreUndefined: true });
    const collection = (name: string) => database.db.collection<Document & { _id: string }>(name);
    const now = new Date("2060-01-01T00:00:00.000Z");
    await collection("users").insertMany([1, 2, 3].map(number => ({ _id: `synthetic-user-${number}`, id: `synthetic-user-${number}`, email: `synthetic-${number}@example.invalid`, name: `Synthetic ${number}`, passwordHash: `synthetic-hash-${number}`, currentBand: 6.5, personalEstimatedBand: 7, targetBand: 8, selfAssessment: { reading: 7 }, createdAt: "2026-10-01T00:00:00.000Z" })));
    await collection("sessions").insertOne({ _id: "synthetic-session", userId: "synthetic-user-1", expiresAt: now, createdAt: now });
    await collection("attempts").insertOne({ _id: "synthetic-draft", userId: "synthetic-user-1", contentId: baseline.content[0].id, mode: "practice", status: "in-progress", transcript: "Own unfinished work", responses: { own: "private response" }, essays: {}, feedback: null });
    await collection("cards").insertOne({ _id: "synthetic-card", userId: "synthetic-user-2", vocabularyId: baseline.vocabulary[0].id, scheduler: "private schedule", reps: 14 });
    await collection("placements").insertOne({ _id: "synthetic-placement", userId: "synthetic-user-1", currentQuestionId: baseline.placementItems[0].id, answers: [{ questionId: baseline.placementItems[1].id, answer: "own answer", correct: false, review: { answer: "stored key" } }] });
    await collection("plans").insertOne({ _id: "synthetic-plan", userId: "synthetic-user-2", tasks: [{ completed: true, contentId: baseline.content[2].id }] });
    await collection("duoPaths").insertOne({ _id: "synthetic-path", band: 6.5, turn: 22, rewards: ["earned"] });
    await collection("customMetadata").insertOne({ _id: "synthetic-special-types", date: now, objectId: new ObjectId(), decimal: BSON.Decimal128.fromString("1.25"), binary: new BSON.Binary(Buffer.from([0, 17, 250])), long: BSON.Long.fromString("1234567890123") });
    const stream = database.recordings.openUploadStream("synthetic-owned-audio", { metadata: { userId: "synthetic-user-1", attemptId: "synthetic-draft" } });
    const finished = once(stream, "finish"); stream.end(Buffer.from("Synthetic private recording bytes")); await finished;
    await collection("audio").insertOne({ _id: "synthetic-audio", userId: "synthetic-user-1", attemptId: "synthetic-draft", fileId: stream.id });
    const teacher = [{ sectionId: "custom-section", title: "Teacher model", sampleAnswer: "A teacher's existing model remains untouched.", explanation: "Existing model.", keyPoints: ["Preserve it"] }];
    await database.content.updateOne({ _id: teacherId }, { $set: { referenceAnswers: teacher } });
    const changed = await database.content.findOne({ _id: changedId }); assert.ok(changed);
    await database.content.updateOne({ _id: changedId }, { $set: { sections: changed.sections.map((section, index) => index ? section : { ...section, text: `${section.text}\nA teacher added a new requirement.` }) } });
    const custom = { ...structuredClone(baseline.content[0]), _id: "fresh-synthetic-custom-item", id: "fresh-synthetic-custom-item", title: "Private team's custom shared material" };
    await database.content.insertOne(custom);

    await t.test("inspection is read-only, accepts customs and refuses any missing fresh baseline", async () => {
      const before = await database.db.listCollections().toArray();
      const inspected = await inspectBankUpgrade(database.db, baseline, target);
      assert.equal(inspected.newContentIds.length, 2); assert.equal(inspected.counts.users, 3);
      assert.equal(inspected.newVocabularyIds.length, 2); assert.equal(inspected.newPlacementIds.length, 2);
      assert.deepEqual(await database.db.listCollections().toArray(), before);
      const missing = await database.content.findOne({ _id: baseline.content[0].id }); assert.ok(missing);
      await database.content.deleteOne({ _id: missing._id });
      await assert.rejects(inspectBankUpgrade(database.db, baseline, target), /fresh bank is absent/);
      await database.content.insertOne(missing);
      const bad = structuredClone(target); bad.content[0].questions[0].prompt += " changed";
      await assert.rejects(inspectBankUpgrade(database.db, baseline, bad), /cannot change/);
      for (const key of ["vocabulary", "placementItems"] as const) {
        const altered = structuredClone(target); altered[key][0]!.id += "-changed";
        await assert.rejects(inspectBankUpgrade(database.db, baseline, altered), /cannot change/);
        const missingRow = await collection(key).findOne({ _id: baseline[key][0]!.id }); assert.ok(missingRow);
        await collection(key).deleteOne({ _id: missingRow._id });
        await assert.rejects(inspectBankUpgrade(database.db, baseline, target), /fresh bank is absent/);
        await collection(key).insertOne(missingRow);
      }
    });
    await t.test("offline/database/backup boundaries reject before any content write", async () => {
      await assert.rejects(upgradeBank(database.db, baseline, target, { ...options("online"), appOffline: false }), /Stop/);
      await assert.rejects(upgradeBank(database.db, baseline, target, { ...options("foreign"), expectedDatabase: "another_project" }), /exact/);
      await assert.rejects(upgradeBank(database.db, baseline, target, { ...options("relative"), backupDirectory: "relative" }), /absolute/);
      assert.equal(await database.content.countDocuments({ _id: { $in: target.content.slice(-2).map(item => item.id) } }), 0);
    });
    await t.test("concurrent document/collection/index changes and corrupted backup abort before insertion", async () => {
      const old = await collection("attempts").findOne({ _id: "synthetic-draft" }); assert.ok(old);
      await assert.rejects(upgradeBank(database.db, baseline, target, { ...options("concurrent"), beforeMutation: async () => { await collection("attempts").updateOne({ _id: old._id }, { $set: { transcript: "Concurrent work" } }); } }), /changed during backup/);
      await collection("attempts").replaceOne({ _id: old._id }, old);
      await assert.rejects(upgradeBank(database.db, baseline, target, { ...options("new-collection"), beforeMutation: async () => { await collection("unexpectedDuringBackup").insertOne({ _id: "synthetic" }); } }), /collections changed/);
      await database.db.collection("unexpectedDuringBackup").drop();
      await assert.rejects(upgradeBank(database.db, baseline, target, { ...options("new-index"), beforeMutation: async () => { await collection("attempts").createIndex({ transcript: 1 }, { name: "synthetic-concurrent-index" }); } }), /indexes changed/);
      await collection("attempts").dropIndex("synthetic-concurrent-index");
      await assert.rejects(upgradeBank(database.db, baseline, target, { ...options("corrupt"), beforeMutation: async () => { await writeFile(join(directory, "corrupt", "collection-0.ejsonl"), "corrupted backup\n", { mode: 0o600 }); } }), /integrity/);
      await assert.rejects(upgradeBank(database.db, baseline, target, { ...options("changed-receipt"), beforeMutation: async () => {
        const path = join(directory, "changed-receipt", "receipt.json");
        const receipt = JSON.parse(await readFile(path, "utf8")); receipt.newVocabularyIds.push(baseline.vocabulary[0]!.id);
        await writeFile(path, JSON.stringify(receipt), { mode: 0o600 });
      } }), /receipt changed/);
      assert.equal(await database.content.countDocuments({ _id: { $in: target.content.slice(-2).map(item => item.id) } }), 0);
      for (const id of modelIds) assert.equal((await database.content.findOne({ _id: id }))?.referenceAnswers, undefined);
    });

    const successful = options("success");
    let report: Awaited<ReturnType<typeof upgradeBank>>;
    await t.test("upgrade adds missing exams/models while keeping all old user/private data and teacher changes", async () => {
      report = await upgradeBank(database.db, baseline, target, successful);
      assert.equal(report.newExamsAdded, 2); assert.equal(report.retainedAccounts, 3); assert.equal(report.allPreviousDocumentsPreserved, true);
      assert.equal(report.newContentAdded, 2); assert.equal(report.newVocabularyAdded, 2); assert.equal(report.newPlacementItemsAdded, 2);
      assert.equal(report.referenceAnswersAdded, 2); assert.equal(report.references.skippedModifiedContent, 1); assert.equal(report.references.alreadyPresent, 1);
      assert.ok(report.preservedDocuments > baseline.content.length + baseline.vocabulary.length + baseline.placementItems.length);
      assert.deepEqual((await database.content.findOne({ _id: teacherId }))?.referenceAnswers, teacher);
      assert.equal((await database.content.findOne({ _id: changedId }))?.referenceAnswers, undefined);
      assert.equal((await database.recordings.find({ _id: stream.id }).toArray()).length, 1);
      const receipt = JSON.parse(await readFile(join(successful.backupDirectory, "receipt.json"), "utf8"));
      assert.equal(receipt.state, "complete"); assert.equal(receipt.database, databaseName);
      assert.equal((await stat(successful.backupDirectory)).mode & 0o777, 0o700);
      for (const entry of Object.values(receipt.backups) as { file: string; metadataFile: string }[]) for (const file of [entry.file, entry.metadataFile]) assert.equal((await stat(join(successful.backupDirectory, file))).mode & 0o777, 0o600);
      assert.equal((await verifyBankUpgrade(database.db, target, successful.backupDirectory, verifyOptions)).allPreviousDocumentsPreserved, true);
    });
    await t.test("a repeated preserving update is idempotent and retains previously added/custom models", async () => {
      const again = await upgradeBank(database.db, baseline, target, options("again"));
      assert.equal(again.newExamsAdded, 0); assert.equal(again.referenceAnswersAdded, 0);
      assert.equal(again.newVocabularyAdded, 0); assert.equal(again.newPlacementItemsAdded, 0);
      assert.equal(again.references.alreadyPresent, 3); assert.equal(again.references.skippedModifiedContent, 1);
      assert.equal(again.retainedAccounts, 3);
    });
    await t.test("verification detects any old progress, teacher model or newly seeded key modification", async () => {
      const old = await collection("duoPaths").findOne({ _id: "synthetic-path" }); assert.ok(old);
      await collection("duoPaths").updateOne({ _id: old._id }, { $set: { turn: 0 } });
      await assert.rejects(verifyBankUpgrade(database.db, target, successful.backupDirectory, verifyOptions), /private/);
      await collection("duoPaths").replaceOne({ _id: old._id }, old);
      for (const name of ["vocabulary", "placementItems"] as const) {
        const previous = await collection(name).findOne({ _id: baseline[name][0]!.id }); assert.ok(previous);
        await collection(name).updateOne({ _id: previous._id }, { $set: { unexpectedChange: true } });
        await assert.rejects(verifyBankUpgrade(database.db, target, successful.backupDirectory, verifyOptions), /vocabulary\/placement/);
        await collection(name).replaceOne({ _id: previous._id }, previous);
        const addition = await collection(name).findOne({ _id: target[name].at(-1)!.id }); assert.ok(addition);
        await collection(name).updateOne({ _id: addition._id }, { $set: { unexpectedChange: true } });
        await assert.rejects(verifyBankUpgrade(database.db, target, successful.backupDirectory, verifyOptions), /study item differs/);
        await collection(name).replaceOne({ _id: addition._id }, addition);
        await collection(name).insertOne({ _id: `synthetic-unexpected-${name}` });
        await assert.rejects(verifyBankUpgrade(database.db, target, successful.backupDirectory, verifyOptions), /Public count/);
        await collection(name).deleteOne({ _id: `synthetic-unexpected-${name}` });
      }
      await database.content.updateOne({ _id: teacherId }, { $set: { referenceAnswers: reference(changed!, "wrong replacement") } });
      await assert.rejects(verifyBankUpgrade(database.db, target, successful.backupDirectory, verifyOptions), /task\/key\/model/);
      await database.content.updateOne({ _id: teacherId }, { $set: { referenceAnswers: teacher } });
      const added = target.content.at(-1)!;
      await database.content.updateOne({ _id: added.id }, { $set: { "questions.0.answer": "tampered key" } });
      await assert.rejects(verifyBankUpgrade(database.db, target, successful.backupDirectory, verifyOptions), /exam or study item differs/);
      const { _id: _discard, ...restore } = { ...added, _id: added.id };
      await database.content.replaceOne({ _id: added.id }, restore);
      assert.equal((await verifyBankUpgrade(database.db, target, successful.backupDirectory, verifyOptions)).status, "verified");
    });
  } finally {
    if (database.db.databaseName === databaseName && /^ielts_upgrade_test_\d+_[a-f0-9]{32}$/.test(databaseName)) await database.db.dropDatabase();
    await database.client.close(); await rm(directory, { recursive: true, force: true });
  }
});
