import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BSON, MongoClient, type Document } from "mongodb";
import { hashPassword, initialProfile } from "../server/auth";
import { parseDuoCredentials } from "../server/duo-auth";
import { assertLegacyResetBank, resetBank } from "../server/bank-reset";
import { contentBank, vocabularyBank, placementBank } from "../server/data/previous-bank";
import { replacementBank as fresh } from "../server/data/initial-fresh-bank";
import type { UserRecord } from "../server/storage";

const banks = { content: contentBank, vocabulary: vocabularyBank, placementItems: placementBank };
const publicNames = ["content", "vocabulary", "placementItems"] as const;
const expected = { content: 628, vocabulary: 744, placementItems: 640 };
const canonical = (value: unknown) => BSON.EJSON.stringify(value, { relaxed: false });

test("native legacy-only reset fence rejects newer banks before inspection/apply and immediately before deletion", { timeout: 90_000 }, async t => {
  const name = `ielts_reset_test_${process.pid}_${randomBytes(16).toString("hex")}`;
  assert.match(name, /^ielts_reset_test_\d+_[a-f0-9]{32}$/);
  const client = new MongoClient(process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017", { maxPoolSize: 2, serverSelectionTimeoutMS: 5000 });
  await client.connect(); const db = client.db(name);
  const directory = await mkdtemp(join(tmpdir(), "ielts-legacy-fence-"));
  const guardOptions = { expectedDatabase: name, testDatabase: true };
  const collection = (name: string) => db.collection<Document & { _id: string }>(name);
  const credentials = parseDuoCredentials({ duoId: "synthetic-legacy-reset-duo", accounts: [
    { role: "husband", name: "Synthetic legacy A", phone: "0390000041", passwordHash: await hashPassword("synthetic-legacy-a-password") },
    { role: "wife", name: "Synthetic legacy B", phone: "0390000042", passwordHash: await hashPassword("synthetic-legacy-b-password") },
  ] });
  async function restoreHistoricalBank() {
    for (const name of publicNames) {
      await collection(name).deleteMany({});
      await collection(name).insertMany(banks[name].map(row => ({ ...row, _id: row.id })), { ignoreUndefined: true });
    }
  }
  async function privateSnapshot() {
    const result: Record<string, string> = {};
    for (const name of ["users", "sessions", "attempts", "duo_learning_paths", "recordings.files", "recordings.chunks"]) result[name] = canonical(await db.collection(name).find().sort({ _id: 1 }).toArray());
    return result;
  }
  try {
    const users: UserRecord[] = credentials.accounts.map(account => ({
      ...initialProfile({ name: account.name, email: `${account.role}@synthetic-legacy.invalid`, targetBand: 7, testType: "general", dailyMinutes: 120, weeklyMinutes: 600 }, `synthetic-legacy-${account.role}`),
      _id: `synthetic-legacy-${account.role}`, phone: account.phone, duoRole: account.role, duoId: credentials.duoId, passwordHash: account.passwordHash,
      currentBand: 6.5, personalEstimatedBand: 7, cefr: "B2", selfAssessment: { reading: 7 },
    }));
    await db.collection<UserRecord>("users").insertMany([...users, { ...initialProfile({ name: "Synthetic extra legacy user", email: "extra@synthetic-legacy.invalid", targetBand: 6, testType: "academic" }, "synthetic-legacy-extra"), _id: "synthetic-legacy-extra", passwordHash: await hashPassword("synthetic-extra-password") }]);
    await collection("sessions").insertOne({ _id: "synthetic-session", userId: users[0].id, expiresAt: new Date("2060-01-01T00:00:00.000Z") });
    await collection("attempts").insertOne({ _id: "synthetic-attempt", userId: users[0].id, responses: { own: "Private unfinished response" } });
    await collection("duo_learning_paths").insertOne({ _id: "synthetic-path", band: 6.5, completed: ["earned-reward"] });
    await collection("recordings.files").insertOne({ _id: "synthetic-recording", metadata: { userId: users[1].id }, length: 3 });
    await collection("recordings.chunks").insertOne({ _id: "synthetic-recording-chunk", files_id: "synthetic-recording", n: 0, data: new BSON.Binary(Buffer.from([1, 2, 3])) });
    await restoreHistoricalBank(); const originalPrivate = await privateSnapshot();

    await t.test("the exact known historical bank passes a read-only guard", async () => {
      const before = canonical(await db.listCollections({}, { nameOnly: false }).toArray());
      const report = await assertLegacyResetBank(db, guardOptions);
      assert.deepEqual(report.counts, expected); assert.equal(report.status, "legacy-verified");
      assert.equal(canonical(await db.listCollections({}, { nameOnly: false }).toArray()), before);
      assert.deepEqual(await privateSnapshot(), originalPrivate);
    });
    await t.test("production and test namespaces remain explicitly scoped", async () => {
      await assert.rejects(assertLegacyResetBank(db), /exact IELTS database/);
      await assert.rejects(assertLegacyResetBank(db, { expectedDatabase: name }), /exact IELTS database/);
      await assert.rejects(assertLegacyResetBank(db, { expectedDatabase: "another_project", testDatabase: true }), /exact IELTS database/);
      assert.deepEqual(await privateSnapshot(), originalPrivate);
    });
    await t.test("same totals with an unknown or inconsistent legacy ID cannot authorize a reset", async () => {
      const old = await collection("content").findOne({ _id: contentBank[0].id }); assert.ok(old);
      await collection("content").deleteOne({ _id: old._id });
      await collection("content").insertOne({ ...old, _id: "unknown-old-content-id", id: "unknown-old-content-id" });
      await assert.rejects(assertLegacyResetBank(db, guardOptions), /historical IDs/);
      await collection("content").deleteOne({ _id: "unknown-old-content-id" }); await collection("content").insertOne(old);
      await collection("content").updateOne({ _id: old._id }, { $set: { id: "different-non-fresh-id" } });
      await assert.rejects(assertLegacyResetBank(db, guardOptions), /historical IDs/);
      await collection("content").replaceOne({ _id: old._id }, old);
      assert.deepEqual(await privateSnapshot(), originalPrivate);
    });
    await t.test("any fresh public ID or id field is refused even when historical totals are unchanged", async () => {
      for (const name of publicNames) {
        const old = await collection(name).findOne({ _id: banks[name][0].id }); assert.ok(old);
        await collection(name).deleteOne({ _id: old._id });
        const id = `fresh-synthetic-race-${name}`;
        await collection(name).insertOne({ ...old, _id: id, id });
        assert.equal(await collection(name).countDocuments(), expected[name]);
        await assert.rejects(assertLegacyResetBank(db, guardOptions), /fresh, mixed/);
        await collection(name).deleteOne({ _id: id }); await collection(name).insertOne(old);
        await collection(name).updateOne({ _id: old._id }, { $set: { id } });
        await assert.rejects(assertLegacyResetBank(db, guardOptions), /fresh, mixed/);
        await collection(name).replaceOne({ _id: old._id }, old);
      }
      assert.deepEqual(await privateSnapshot(), originalPrivate);
    });
    await t.test("a real fresh bank padded to the exact old counts is still refused", async () => {
      for (const name of publicNames) {
        await collection(name).deleteMany({});
        const current = fresh[name];
        await collection(name).insertMany(current.map(row => ({ ...row, _id: row.id })), { ignoreUndefined: true });
        await collection(name).insertMany(Array.from({ length: expected[name] - current.length }, (_, index) => ({ _id: `synthetic-padding-${name}-${index}`, id: `synthetic-padding-${name}-${index}` })));
        assert.equal(await collection(name).countDocuments(), expected[name]);
      }
      await assert.rejects(assertLegacyResetBank(db, guardOptions), /fresh, mixed/);
      assert.deepEqual(await privateSnapshot(), originalPrivate);
      await restoreHistoricalBank();
    });
    await t.test("the post-backup fence aborts before the first reset deletion when another bank appears", async () => {
      await assertLegacyResetBank(db, guardOptions);
      let replacementId = ""; let changedDuringBackup: Document | null = null;
      const backupDirectory = join(directory, "race-backup");
      await assert.rejects(resetBank(db, credentials, fresh, { expectedDatabase: name, backupDirectory, appOffline: true, testDatabase: true,
        beforeMutation: async () => {
          const old = await collection("content").findOne({ _id: contentBank[0].id }); assert.ok(old);
          await collection("content").deleteOne({ _id: old._id });
          replacementId = "fresh-synthetic-new-bank-during-backup";
          changedDuringBackup = { ...old, _id: replacementId, id: replacementId };
          await collection("content").insertOne(changedDuringBackup as Document & { _id: string });
          await assertLegacyResetBank(db, guardOptions);
        },
      }), /fresh, mixed/);
      const receipt = JSON.parse(await readFile(join(backupDirectory, "receipt.json"), "utf8"));
      assert.equal(receipt.state, "backed-up", "The reset never entered its replacing state");
      assert.deepEqual(await privateSnapshot(), originalPrivate, "Profiles, all users, sessions, private work and recordings were not deleted/reset");
      assert.equal(await collection("content").countDocuments(), expected.content);
      assert.equal(canonical(await collection("content").findOne({ _id: replacementId })), canonical(changedDuringBackup));
    });
  } finally {
    if (db.databaseName === name && /^ielts_reset_test_\d+_[a-f0-9]{32}$/.test(name)) await db.dropDatabase();
    await client.close(); await rm(directory, { recursive: true, force: true });
  }
});
