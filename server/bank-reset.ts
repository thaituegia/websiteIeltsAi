import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, writeFile, chmod, lstat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { BSON, type Db, type Document } from "mongodb";
import { initialProfile } from "./auth";
import { duoAccountForUser, parseDuoCredentials, type DuoCredentialSettings } from "./duo-auth";
import type { StoredContent, VocabularyEntry, PlacementItem } from "../shared/types";
import type { UserRecord } from "./storage";
import { validateContentStructure } from "../shared/content-visuals";

export interface ReplacementBank {
  version: string;
  content: StoredContent[];
  vocabulary: VocabularyEntry[];
  placementItems: PlacementItem[];
}
const PUBLIC = ["content", "vocabulary", "placementItems"] as const;
const canonical = (doc: unknown): string => {
  const value = BSON.EJSON.serialize(doc, { relaxed: false });
  const order = (v: unknown): unknown => Array.isArray(v) ? v.map(order) : v && typeof v === "object"
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, order(x)])) : v;
  return JSON.stringify(order(value));
};
function assertBank(bank: ReplacementBank) {
  if (!/^fresh-[a-z0-9-]+$/.test(bank.version)) throw Error("Replacement bank version is invalid.");
  for (const rows of [bank.content, bank.vocabulary, bank.placementItems]) {
    if (!rows.length || new Set(rows.map(x => x.id)).size !== rows.length || rows.some(x => !/^fresh-[a-z0-9-]+$/.test(x.id)))
      throw Error("Only a complete, unique fresh bank may replace data.");
  }
  for (const item of bank.content) validateContentStructure(item);
  const words = new Set(bank.vocabulary.map(x => x.id));
  if (bank.content.some(x => x.vocabularyIds.some(id => !words.has(id)))) throw Error("Fresh vocabulary references are invalid.");
}
async function identities(db: Db, credentials: DuoCredentialSettings): Promise<UserRecord[]> {
  const settings = parseDuoCredentials(credentials);
  const kept: UserRecord[] = [];
  for (const account of settings.accounts) {
    const rows = await db.collection<UserRecord>("users").find({ phone: account.phone }).limit(3).toArray();
    if (rows.length !== 1 || !duoAccountForUser(settings, rows[0]!) || rows[0]!.name !== account.name || rows[0]!.id !== rows[0]!._id)
      throw Error("Exactly two existing configured Duo identities must be verified before reset.");
    kept.push(rows[0]!);
  }
  if (new Set(kept.map(x => x._id)).size !== 2) throw Error("Duo identities overlap.");
  return kept;
}
async function namesOf(db: Db) {
  const collections = await db.listCollections({}, { nameOnly: false }).toArray();
  if (collections.some(x => x.type !== "collection" || x.name.startsWith("system.")))
    throw Error("Unexpected view/system collection; no reset performed.");
  return collections.map(x => x.name).sort();
}
async function digestCollection(db: Db, name: string) {
  const hash = createHash("sha256"); let count = 0;
  for await (const doc of db.collection(name).find().sort({ _id: 1 })) {
    hash.update(canonical(doc) + "\n"); count++;
  }
  return { count, sha256: hash.digest("hex") };
}
async function collectionMetadata(db: Db, name: string) {
  const [definition] = await db.listCollections({ name }, { nameOnly: false }).toArray();
  return { definition, indexes: await db.collection(name).listIndexes().toArray() };
}
async function fileDigest(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
/** A stale legacy decision must never authorize deletion of a newer fresh bank. */
export async function assertLegacyResetBank(db: Db, options: { expectedDatabase?: string; testDatabase?: boolean } = {}) {
  const expected = options.expectedDatabase ?? "ielts_ai";
  const validName = options.testDatabase === true ? /^ielts_reset_test_\d+_[a-f0-9]{32}$/.test(expected) : expected === "ielts_ai";
  if (!validName || db.databaseName !== expected) throw Error("Legacy-only reset is restricted to the exact IELTS database.");
  const historical = await import("./data/previous-bank");
  const banks = { content: historical.contentBank, vocabulary: historical.vocabularyBank, placementItems: historical.placementBank };
  const counts = { content: 628, vocabulary: 744, placementItems: 640 };
  for (const name of PUBLIC) {
    const ids = banks[name].map(row => row.id);
    if (ids.length !== counts[name] || new Set(ids).size !== ids.length || ids.some(id => id.startsWith("fresh-"))) throw Error("The known historical bank manifest is invalid.");
    const collection = db.collection<Document & { _id: string }>(name);
    if (await collection.countDocuments() !== counts[name] || await collection.findOne({ $or: [{ _id: /^fresh-/ }, { id: /^fresh-/ }] }, { projection: { _id: 1 } }))
      throw Error("Legacy-only reset refused: the installed bank is fresh, mixed or has changed counts.");
    if (await collection.countDocuments({ _id: { $in: ids }, $expr: { $eq: ["$_id", "$id"] } }) !== counts[name]) throw Error("Legacy-only reset refused: the complete known historical IDs are absent.");
  }
  return { status: "legacy-verified", database: db.databaseName, counts };
}
export async function inspectBankReset(db: Db, credentials: DuoCredentialSettings, bank: ReplacementBank) {
  assertBank(bank); const users = await identities(db, credentials);
  const counts: Record<string, number> = {};
  for (const name of await namesOf(db)) counts[name] = await db.collection(name).countDocuments();
  return { database: db.databaseName, retainedAccountIds: users.map(x => x._id), counts,
    replacement: { version: bank.version, content: bank.content.length, vocabulary: bank.vocabulary.length, placementItems: bank.placementItems.length } };
}
export async function resetBank(db: Db, credentials: DuoCredentialSettings, bank: ReplacementBank, options: {
  expectedDatabase: string;
  backupDirectory: string;
  appOffline: boolean;
  testDatabase?: boolean;
  beforeMutation?: () => Promise<void>;
}) {
  const validName = options.testDatabase === true ? /^ielts_reset_test_\d+_[a-f0-9]{32}$/.test(options.expectedDatabase) : options.expectedDatabase === "ielts_ai";
  if (!validName || db.databaseName !== options.expectedDatabase || options.appOffline !== true || !isAbsolute(options.backupDirectory))
    throw Error("Reset requires the exact IELTS database, offline app and absolute private backup directory.");
  assertBank(bank);
  const kept = await identities(db, credentials);
  const names = await namesOf(db);
  // The caller must supply a new directory; never overwrite an earlier backup.
  await mkdir(options.backupDirectory, { mode: 0o700 });
  const directory = await lstat(options.backupDirectory);
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw Error("Invalid backup directory.");
  await chmod(options.backupDirectory, 0o700);
  const backups: Record<string, { file: string; count: number; sha256: string; metadataFile: string; metadataSha256: string }> = {};
  for (const [index, name] of names.entries()) {
    const filename = `collection-${index}.ejsonl`, path = join(options.backupDirectory, filename);
    const handle = await open(path, "wx", 0o600);
    const hash = createHash("sha256"); let count = 0;
    try {
      for await (const doc of db.collection(name).find().sort({ _id: 1 })) {
        const line = canonical(doc) + "\n";
        await handle.writeFile(line); hash.update(line); count++;
      }
      await handle.sync();
    } finally { await handle.close(); }
    const metadataFile = `metadata-${index}.ejson`, metadata = canonical(await collectionMetadata(db, name));
    const metadataSha256 = createHash("sha256").update(metadata).digest("hex");
    backups[name] = { file: filename, count, sha256: hash.digest("hex"), metadataFile, metadataSha256 };
    await writeFile(join(options.backupDirectory, metadataFile), metadata, { flag: "wx", mode: 0o600 });
    if (await fileDigest(path) !== backups[name]!.sha256 || await fileDigest(join(options.backupDirectory, metadataFile)) !== metadataSha256)
      throw Error("Backup file verification failed; no data removed.");
  }
  const receiptPath = join(options.backupDirectory, "receipt.json");
  const receipt = { database: db.databaseName, createdAt: new Date().toISOString(), state: "backed-up", bankVersion: bank.version, retainedAccountIds: kept.map(x => x._id), backups };
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2), { flag: "wx", mode: 0o600 });
  // Refuse concurrent changes, including a newly created collection, before any deletion.
  await options.beforeMutation?.();
  if (JSON.stringify(await namesOf(db)) !== JSON.stringify(names)) throw Error("Database collections changed during backup; no data removed.");
  for (const name of names) {
    if (JSON.stringify(await digestCollection(db, name)) !== JSON.stringify({ count: backups[name]!.count, sha256: backups[name]!.sha256 }) ||
        createHash("sha256").update(canonical(await collectionMetadata(db, name))).digest("hex") !== backups[name]!.metadataSha256 ||
        await fileDigest(join(options.backupDirectory, backups[name]!.file)) !== backups[name]!.sha256 ||
        await fileDigest(join(options.backupDirectory, backups[name]!.metadataFile)) !== backups[name]!.metadataSha256)
      throw Error("Database changed during backup; no data removed.");
  }
  if (JSON.stringify((await identities(db, credentials)).map(canonical)) !== JSON.stringify(kept.map(canonical)))
    throw Error("Accounts changed during backup; no data removed.");
  receipt.state = "replacing";
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2), { mode: 0o600 });
  // Keep collection definitions/indexes. Never drop the database or touch another DB.
  for (const name of names) if (name !== "users") await db.collection(name).deleteMany({});
  await db.collection<UserRecord>("users").deleteMany({ _id: { $nin: kept.map(x => x._id) } });
  for (const user of kept) {
    const initial = initialProfile({ name: user.name, email: user.email, targetBand: 8, testType: "academic" }, user.id);
    const replaced = await db.collection<UserRecord>("users").replaceOne({ _id: user._id, passwordHash: user.passwordHash }, {
      ...initial, email: user.email, createdAt: user.createdAt, phone: user.phone, duoRole: user.duoRole,
      duoId: user.duoId, passwordHash: user.passwordHash, personalEstimatedBand: null,
    });
    if (replaced.matchedCount !== 1) throw Error("Fixed account changed during reset; keep the app offline and inspect the backup.");
  }
  for (const name of PUBLIC) await db.collection<Document & { _id: string }>(name).insertMany(bank[name].map(x => ({ ...x, _id: x.id })), { ordered: true, ignoreUndefined: true });
  const report = await verifyBankReset(db, credentials, bank);
  receipt.state = "complete";
  await writeFile(receiptPath, JSON.stringify({ ...receipt, completedAt: new Date().toISOString(), report }, null, 2), { mode: 0o600 });
  return { ...report, backupDirectory: options.backupDirectory };
}
export async function verifyBankReset(db: Db, credentials: DuoCredentialSettings, bank: ReplacementBank) {
  const users = await identities(db, credentials);
  if (await db.collection("users").countDocuments() !== 2 || users.some(x => x.currentBand !== null || x.personalEstimatedBand !== null || x.cefr !== null || x.examDate !== null || x.selfAssessment || x.targetBand !== 8 || x.testType !== "academic" || x.dailyMinutes !== 45 || x.weeklyMinutes !== 300))
    throw Error("Account identity/reset verification failed.");
  for (const name of PUBLIC) {
    const actual = await db.collection(name).find().sort({ _id: 1 }).toArray();
    // Compare the BSON representation actually stored by MongoDB (undefined
    // optional properties are omitted, matching insertMany's ignoreUndefined).
    const expected = bank[name].map(x => BSON.deserialize(BSON.serialize({ ...x, _id: x.id }, { ignoreUndefined: true })))
      .sort((a, b) => String(a._id).localeCompare(String(b._id)));
    if (actual.length !== expected.length || actual.some((x, i) => canonical(x) !== canonical(expected[i])))
      throw Error("Replacement bank differs from source.");
  }
  for (const name of await namesOf(db)) if (name !== "users" && !PUBLIC.includes(name as typeof PUBLIC[number]) && await db.collection(name).countDocuments() !== 0)
    throw Error("Old learning data remains after reset.");
  return { status: "verified", bankVersion: bank.version, retainedAccounts: users.length,
    content: bank.content.length, lessons: bank.content.filter(x => x.format === "lesson").length,
    mocks: bank.content.filter(x => x.format === "full-mock").length, vocabulary: bank.vocabulary.length, placement: bank.placementItems.length,
    privateLearningDataEmpty: true };
}
