import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { createInterface } from "node:readline";
import { BSON, type Db, type Document } from "mongodb";
import type { ReplacementBank } from "./bank-reset";
import { addMissingReferenceAnswers, contentSourceDigest } from "./content-references";
import type { StoredContent } from "../shared/types";
import { validateContentStructure } from "../shared/content-visuals";

const PUBLIC = ["content", "vocabulary", "placementItems"] as const;
const canonical = (input: unknown): string => {
  const value = BSON.EJSON.serialize(input, { relaxed: false });
  const order = (item: unknown): unknown => Array.isArray(item) ? item.map(order)
    : item && typeof item === "object" ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, order(child)])) : item;
  return JSON.stringify(order(value));
};
const stored = (value: unknown): Document => BSON.deserialize(BSON.serialize(value as Document, { ignoreUndefined: true }));
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
interface BackupEntry { file: string; count: number; sha256: string; metadataFile: string; metadataSha256: string }
interface Receipt {
  database: string; bankVersion: string; createdAt: string;
  state: "backed-up" | "upgrading" | "complete";
  newContentIds: string[]; backups: Record<string, BackupEntry>;
  newVocabularyIds: string[]; newPlacementIds: string[];
}
async function names(db: Db): Promise<string[]> {
  const rows = await db.listCollections({}, { nameOnly: false }).toArray();
  if (rows.some(row => row.type !== "collection" || row.name.startsWith("system."))) throw Error("Unexpected view/system collection; upgrade refused.");
  return rows.map(row => row.name).sort();
}
async function metadata(db: Db, name: string) {
  const [definition] = await db.listCollections({ name }, { nameOnly: false }).toArray();
  return { definition, indexes: await db.collection(name).listIndexes().toArray() };
}
async function digest(db: Db, name: string) {
  const sum = createHash("sha256"); let count = 0;
  for await (const row of db.collection(name).find().sort({ _id: 1 })) { sum.update(canonical(row) + "\n"); count++; }
  return { count, sha256: sum.digest("hex") };
}
async function fileDigest(path: string) {
  const sum = createHash("sha256"); for await (const chunk of createReadStream(path)) sum.update(chunk); return sum.digest("hex");
}
function compatibleBanks(baseline: ReplacementBank, target: ReplacementBank) {
  if (!/^fresh-[a-z0-9-]+$/.test(target.version) || baseline.version === target.version) throw Error("Upgrade versions must identify a fresh baseline and a distinct target.");
  for (const item of target.content) validateContentStructure(item);
  for (const name of PUBLIC) {
    for (const bank of [baseline, target]) {
      if (!bank[name].length || new Set(bank[name].map(row => row.id)).size !== bank[name].length || bank[name].some(row => !/^fresh-[a-z0-9-]+$/.test(row.id))) throw Error("Invalid unique fresh bank IDs.");
    }
    const expected = new Map(target[name].map(row => [row.id, row]));
    for (const old of baseline[name]) {
      const next = expected.get(old.id);
      if (!next || (name === "content"
        ? contentSourceDigest(old as StoredContent) !== contentSourceDigest(next as StoredContent)
        : canonical(stored(old)) !== canonical(stored(next)))) throw Error("A preserving upgrade cannot change existing prompts, keys, vocabulary or placement items.");
    }
  }
}
/** Read-only: require the complete fresh baseline before any build switch/writes. */
export async function inspectBankUpgrade(db: Db, baseline: ReplacementBank, target: ReplacementBank) {
  compatibleBanks(baseline, target);
  const collections = await names(db);
  for (const name of PUBLIC) {
    const ids = baseline[name].map(row => row.id);
    if (!collections.includes(name) || await db.collection<Document & { _id: string }>(name).countDocuments({ _id: { $in: ids } }) !== ids.length)
      throw Error("The complete initial fresh bank is absent. This preserving updater cannot reset or migrate a legacy bank.");
  }
  const additions: Record<typeof PUBLIC[number], string[]> = { content: [], vocabulary: [], placementItems: [] };
  for (const name of PUBLIC) {
    const oldIds = new Set(baseline[name].map(row => row.id));
    const extras = target[name].filter(row => !oldIds.has(row.id));
    const found = await db.collection<Document & { _id: string }>(name).find({ _id: { $in: extras.map(row => row.id) } }, { projection: { _id: 1 } }).toArray();
    const present = new Set(found.map(row => row._id));
    additions[name] = extras.filter(row => !present.has(row.id)).map(row => row.id);
  }
  const counts: Record<string, number> = {};
  for (const name of collections) counts[name] = await db.collection(name).countDocuments();
  return { database: db.databaseName, bankVersion: target.version, counts, newContentIds: additions.content,
    newVocabularyIds: additions.vocabulary, newPlacementIds: additions.placementItems,
    target: { content: target.content.length, lessons: target.content.filter(row => row.format === "lesson").length, mocks: target.content.filter(row => row.format === "full-mock").length, vocabulary: target.vocabulary.length, placement: target.placementItems.length } };
}
function exactDatabase(db: Db, expected: string, testDatabase = false) {
  const valid = testDatabase ? /^ielts_upgrade_test_\d+_[a-f0-9]{32}$/.test(expected) : expected === "ielts_ai";
  if (!valid || db.databaseName !== expected) throw Error("This upgrade is restricted to the exact IELTS database.");
}
async function privateReceipt(directory: string): Promise<Receipt> {
  if (!isAbsolute(directory)) throw Error("An absolute private backup directory is required.");
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077)) throw Error("Unsafe backup directory.");
  const receiptFile = join(directory, "receipt.json"); const receiptInfo = await lstat(receiptFile);
  if (!receiptInfo.isFile() || receiptInfo.isSymbolicLink() || (receiptInfo.mode & 0o077)) throw Error("Unsafe backup receipt.");
  const receipt = JSON.parse(await readFile(receiptFile, "utf8")) as Receipt;
  if (!receipt || !["backed-up", "upgrading", "complete"].includes(receipt.state) ||
    ![receipt.newContentIds, receipt.newVocabularyIds, receipt.newPlacementIds].every(ids => Array.isArray(ids) && ids.every(id => typeof id === "string" && /^fresh-[a-z0-9-]+$/.test(id)) && new Set(ids).size === ids.length) ||
    typeof receipt.backups !== "object" || !receipt.backups) throw Error("Invalid upgrade backup receipt.");
  for (const entry of Object.values(receipt.backups)) {
    if (!/^collection-\d+\.ejsonl$/.test(entry.file) || !/^metadata-\d+\.ejson$/.test(entry.metadataFile) || !Number.isSafeInteger(entry.count) || entry.count < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256) || !/^[a-f0-9]{64}$/.test(entry.metadataSha256)) throw Error("Invalid backup manifest.");
    for (const filename of [entry.file, entry.metadataFile]) {
      const info = await lstat(join(directory, filename));
      if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077)) throw Error("Unsafe backup file.");
    }
    if (await fileDigest(join(directory, entry.file)) !== entry.sha256 || await fileDigest(join(directory, entry.metadataFile)) !== entry.metadataSha256) throw Error("Upgrade backup integrity check failed.");
  }
  return receipt;
}

/** Backup all collections/indexes and append public study material. Never delete anything. */
export async function upgradeBank(db: Db, baseline: ReplacementBank, target: ReplacementBank, options: {
  expectedDatabase: string; backupDirectory: string; appOffline: boolean; testDatabase?: boolean;
  beforeMutation?: () => Promise<void>;
}) {
  exactDatabase(db, options.expectedDatabase, options.testDatabase);
  if (!options.appOffline || !isAbsolute(options.backupDirectory)) throw Error("Stop the IELTS app and provide a new absolute private backup directory.");
  const inspection = await inspectBankUpgrade(db, baseline, target);
  const beforeNames = await names(db);
  await mkdir(options.backupDirectory, { mode: 0o700 }); await chmod(options.backupDirectory, 0o700);
  const backups: Receipt["backups"] = {};
  for (const [index, name] of beforeNames.entries()) {
    const file = `collection-${index}.ejsonl`, metadataFile = `metadata-${index}.ejson`;
    const handle = await open(join(options.backupDirectory, file), "wx", 0o600);
    const sum = createHash("sha256"); let count = 0;
    try {
      for await (const row of db.collection(name).find().sort({ _id: 1 })) {
        const line = canonical(row) + "\n"; await handle.writeFile(line); sum.update(line); count++;
      }
      await handle.sync();
    } finally { await handle.close(); }
    const meta = canonical(await metadata(db, name));
    await writeFile(join(options.backupDirectory, metadataFile), meta, { mode: 0o600, flag: "wx" });
    backups[name] = { file, count, sha256: sum.digest("hex"), metadataFile, metadataSha256: hash(meta) };
  }
  const receipt: Receipt = { database: db.databaseName, bankVersion: target.version, createdAt: new Date().toISOString(), state: "backed-up",
    newContentIds: inspection.newContentIds, newVocabularyIds: inspection.newVocabularyIds, newPlacementIds: inspection.newPlacementIds, backups };
  const receiptPath = join(options.backupDirectory, "receipt.json");
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2), { flag: "wx", mode: 0o600 });
  await options.beforeMutation?.();
  if (canonical(await privateReceipt(options.backupDirectory)) !== canonical(receipt)) throw Error("Upgrade backup receipt changed; no content added.");
  if (JSON.stringify(await names(db)) !== JSON.stringify(beforeNames)) throw Error("Database collections changed during backup; no content added.");
  for (const name of beforeNames) {
    const entry = backups[name]!;
    if (JSON.stringify(await digest(db, name)) !== JSON.stringify({ count: entry.count, sha256: entry.sha256 }) || hash(canonical(await metadata(db, name))) !== entry.metadataSha256) throw Error("Database documents or indexes changed during backup; no content added.");
  }
  receipt.state = "upgrading"; await writeFile(receiptPath, JSON.stringify(receipt, null, 2), { mode: 0o600 });
  const additionIds = { content: receipt.newContentIds, vocabulary: receipt.newVocabularyIds, placementItems: receipt.newPlacementIds };
  for (const name of PUBLIC) {
    const wanted = new Set(additionIds[name]);
    const missing = target[name].filter(row => wanted.has(row.id));
    if (missing.length) await db.collection<Document & { _id: string }>(name).insertMany(missing.map(row => ({ ...row, _id: row.id })), { ignoreUndefined: true, ordered: true });
  }
  const references = await addMissingReferenceAnswers(db.collection<StoredContent & { _id: string }>("content"), target.content);
  if (references.concurrentChanges) throw Error("An existing task changed during model addition; keep the app offline.");
  const report = await verifyBankUpgrade(db, target, options.backupDirectory, { expectedDatabase: options.expectedDatabase, testDatabase: options.testDatabase });
  receipt.state = "complete";
  await writeFile(receiptPath, JSON.stringify({ ...receipt, completedAt: new Date().toISOString(), references, report }, null, 2), { mode: 0o600 });
  return { ...report, references, backupDirectory: options.backupDirectory };
}

/** Prove every previous document/index is unchanged, except applicable models. */
export async function verifyBankUpgrade(db: Db, target: ReplacementBank, directory: string, options: { expectedDatabase: string; testDatabase?: boolean }) {
  exactDatabase(db, options.expectedDatabase, options.testDatabase);
  const receipt = await privateReceipt(directory);
  if (receipt.database !== db.databaseName || receipt.bankVersion !== target.version) throw Error("Backup does not identify this database/target.");
  const beforeNames = Object.keys(receipt.backups).sort();
  if (JSON.stringify(await names(db)) !== JSON.stringify(beforeNames)) throw Error("An existing collection disappeared or an unexpected collection appeared.");
  const sources = new Map(target.content.map(row => [row.id, row]));
  const additionIds = { content: receipt.newContentIds, vocabulary: receipt.newVocabularyIds, placementItems: receipt.newPlacementIds };
  const allowedAdditions = Object.fromEntries(PUBLIC.map(name => [name, new Set(additionIds[name])])) as Record<typeof PUBLIC[number], Set<string>>;
  for (const name of PUBLIC) {
    const expectedIds = new Set(target[name].map(row => row.id));
    if (additionIds[name].some(id => !expectedIds.has(id)) || !receipt.backups[name]) throw Error("Invalid public addition manifest.");
  }
  let preservedDocuments = 0; let referenceAnswersAdded = 0;
  for (const name of beforeNames) {
    const entry = receipt.backups[name]!;
    if (hash(canonical(await metadata(db, name))) !== entry.metadataSha256) throw Error("Existing collection/index definitions changed.");
    if (!PUBLIC.includes(name as typeof PUBLIC[number])) {
      if (JSON.stringify(await digest(db, name)) !== JSON.stringify({ count: entry.count, sha256: entry.sha256 })) throw Error("Existing learner/private/vocabulary/placement data changed.");
      preservedDocuments += entry.count; continue;
    }
    const publicName = name as typeof PUBLIC[number];
    if (await db.collection(name).countDocuments() !== entry.count + allowedAdditions[publicName].size) throw Error("Public count does not match the preserving addition.");
    const lines = createInterface({ input: createReadStream(join(directory, entry.file)), crlfDelay: Infinity });
    let readCount = 0;
    for await (const line of lines) {
      const old = BSON.EJSON.parse(line, { relaxed: false }) as StoredContent & { _id: string };
      if (allowedAdditions[publicName].has(old._id)) throw Error("Addition manifest includes a previous document.");
      const current = await db.collection<StoredContent & { _id: string }>(name).findOne({ _id: old._id });
      if (!current) throw Error("A previous public document disappeared.");
      if (canonical(old) !== canonical(current)) {
        if (name !== "content") throw Error("Existing learner/private/vocabulary/placement data changed.");
        const source = sources.get(old.id);
        const { referenceAnswers: oldModels, ...oldTask } = old;
        const { referenceAnswers: newModels, ...newTask } = current;
        if (oldModels?.length || !newModels?.length || !source?.referenceAnswers?.length || contentSourceDigest(old) !== contentSourceDigest(source) || canonical(oldTask) !== canonical(newTask) || canonical(newModels) !== canonical(stored({ models: source.referenceAnswers }).models)) throw Error("A previous task/key/model changed outside the allowed reference addition.");
        referenceAnswersAdded++;
      }
      readCount++; preservedDocuments++;
    }
    if (readCount !== entry.count) throw Error("Public backup count is invalid.");
  }
  for (const name of PUBLIC) {
    const expected = new Map(target[name].map(row => [row.id, row]));
    for (const id of allowedAdditions[name]) {
      const row = await db.collection<Document & { _id: string }>(name).findOne({ _id: id });
      if (canonical(row) !== canonical(stored({ ...expected.get(id), _id: id }))) throw Error("A newly added exam or study item differs from its source.");
    }
  }
  for (const name of PUBLIC) if (await db.collection<Document & { _id: string }>(name).countDocuments({ _id: { $in: target[name].map(row => row.id) } }) !== target[name].length) throw Error("The full target bank is incomplete.");
  return { status: "verified", bankVersion: target.version, newExamsAdded: allowedAdditions.content.size,
    newContentAdded: allowedAdditions.content.size, newVocabularyAdded: allowedAdditions.vocabulary.size,
    newPlacementItemsAdded: allowedAdditions.placementItems.size, referenceAnswersAdded, preservedDocuments,
    retainedAccounts: await db.collection("users").countDocuments(), allPreviousDocumentsPreserved: true,
    bank: { content: target.content.length, lessons: target.content.filter(row => row.format === "lesson").length, mocks: target.content.filter(row => row.format === "full-mock").length, vocabulary: target.vocabulary.length, placement: target.placementItems.length } };
}
