#!/usr/bin/env node
/** Offline, owner-authorized rank assignment. Never provisions users or invents scores.
 * Run in the existing app image with `node --import tsx`; its server-owned
 * curriculum builder supplies the version-compatible path without rebuilding.
 */
import { createHash } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const VERSION = "duo-band-3-v1";
const ROLES = ["husband", "wife"];
const COLLECTIONS = new Set(["users", "duo_learning_paths", "placements", "exam_integrity_sessions"]);
const TEST_DATABASE = /^ielts_duo_band_admin_test_[a-f0-9]{32}$/;
const runtimeCache = new Map();
const sha = value => createHash("sha256").update(value).digest("hex");
const fail = code => { throw new Error(`DUO_BAND_ADMIN:${code}`); };
const numeric = value => typeof value === "number" ? value : Number(value?.valueOf());

async function runtime() {
  const root = process.env.IELTS_APP_ROOT || "/app";
  if (!isAbsolute(root)) fail("INVALID_APP_ROOT");
  if (!runtimeCache.has(root)) runtimeCache.set(root, (async () => {
    const require = createRequire(join(root, "package.json"));
    const mongodb = require("mongodb");
    const duo = await import(pathToFileURL(join(root, "server/duo.ts")).href);
    const auth = await import(pathToFileURL(join(root, "server/duo-auth.ts")).href);
    if (typeof duo.createDuoService !== "function" ||
        typeof duo.DuoService?.prototype?.buildBand !== "function" || duo.DuoService.prototype.buildBand.length !== 3 ||
        typeof auth.parseDuoCredentials !== "function" || typeof auth.loadDuoCredentials !== "function" || !mongodb.BSON?.EJSON)
      fail("UNSUPPORTED_APP_CURRICULUM_ADAPTER");
    return { ...mongodb, EJSON: mongodb.BSON.EJSON, ...duo, ...auth };
  })());
  return runtimeCache.get(root);
}

function assertDatabase(database) {
  const name = database?.db?.databaseName;
  if (name !== "ielts_ai" && !TEST_DATABASE.test(name || "")) fail("DATABASE_NOT_ALLOWED");
  if (!database.users || !database.content || !database.vocabulary || !database.placements) fail("DATABASE_ADAPTER_INVALID");
}

function assertOffline(database) {
  if (database.db.databaseName === "ielts_ai" && process.env.IELTS_APP_OFFLINE !== "true") fail("APP_MUST_BE_OFFLINE");
}

const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const serialize = (EJSON, value) => EJSON.stringify(value, { relaxed: false });
const canonical = (EJSON, value) => JSON.stringify(stable(EJSON.serialize(value, { relaxed: false })));
const clone = (EJSON, value) => EJSON.parse(serialize(EJSON, value), { relaxed: false });
const equal = (EJSON, a, b) => canonical(EJSON, a) === canonical(EJSON, b);
const raw = { promoteValues: false };

async function assertNoActiveDuo(database, duoId, userIds) {
  const assessments = await database.db.collection("duo_assessments").findOne({ duoId,
    $or: [{ status: { $in: ["in-progress", "pending-ai", "grading"] } },
      { active: true, status: { $nin: ["passed", "failed"] } }] }, { projection: { _id: 1 } });
  if (assessments) fail("ACTIVE_DUO_ASSESSMENT_OR_PENDING_AI");
  const room = await database.db.collection("duo_promotion_rooms").findOne({ duoId,
    $or: [{ status: { $in: ["waiting", "countdown", "in-progress", "pending-ai", "grading"] } },
      { active: true, status: { $nin: ["completed", "cancelled", "invalidated"] } }] }, { projection: { _id: 1 } });
  if (room) fail("ACTIVE_DUO_ROOM");
  const grading = await database.db.collection("exam_integrity_sessions").findOne({
    userId: { $in: userIds }, status: "active", phase: "grading",
  }, { projection: { _id: 1 } });
  if (grading) fail("ACTIVE_PROVIDER_GRADING");
  const lease = await database.db.collection("attempts").findOne({ userId: { $in: userIds },
    status: "in-progress", "submissionLease.expiresAt": { $gt: new Date().toISOString() },
  }, { projection: { _id: 1 } });
  if (lease) fail("ACTIVE_PROVIDER_GRADING");
}

function validatePath(path, duoId, members) {
  if (!path || path._id !== duoId || path.duoId !== duoId ||
      path.members?.husband !== members.husband || path.members?.wife !== members.wife ||
      Object.keys(path.members).length !== 2 || numeric(path.targetBand) !== 8 ||
      !Number.isInteger(numeric(path.revision)) || numeric(path.revision) < 0 ||
      !Number.isFinite(numeric(path.currentBand)) || numeric(path.currentBand) < 3 || numeric(path.currentBand) > 8 ||
      !Number.isFinite(numeric(path.startingBand)) || numeric(path.startingBand) < 3 || numeric(path.startingBand) > 8)
    fail("EXISTING_PATH_IDENTITY_OR_SCHEMA_MISMATCH");
  for (let band = 3; band <= 8; band += 0.5) {
    const row = path.bands?.[`b${band * 2}`];
    if (!row || numeric(row.band) !== band || !Array.isArray(row.lessons) || !row.lessons.length ||
        !Array.isArray(row.gates) || !Array.isArray(row.promotionContentIds) || row.promotionContentIds.length !== 4 ||
        !row.promotionResults || !ROLES.every(role => Object.hasOwn(row.promotionResults, role)))
      fail("EXISTING_PATH_CURRICULUM_INCOMPLETE");
  }
}

/** Read-only: exact private credential identities, safe curriculum, and complete CAS targets. */
export async function prepareAssignment(database, settings, config = {}) {
  assertDatabase(database);
  const rt = await runtime();
  let validated;
  try { validated = rt.parseDuoCredentials(settings); } catch { fail("PRIVATE_DUO_SETTINGS_INVALID"); }
  const allUsers = await database.users.find({}, raw).limit(3).toArray();
  if (allUsers.length !== 2 || await database.users.countDocuments() !== 2) fail("EXPECTED_EXACTLY_TWO_USERS");
  const members = {};
  for (const role of ROLES) {
    const account = validated.accounts.find(value => value.role === role);
    const user = allUsers.find(value => value.duoRole === role);
    if (!user || user.duoId !== validated.duoId || user.name !== account.name || user.phone !== account.phone ||
        user.passwordHash !== account.passwordHash || user.demo !== false || typeof user._id !== "string" ||
        !user._id || user.id !== user._id || numeric(user.targetBand) !== 8)
      fail("PRIVATE_ACCOUNT_IDENTITY_MISMATCH");
    members[role] = user;
  }
  if (members.husband.id === members.wife.id) fail("PRIVATE_ACCOUNT_IDENTITY_MISMATCH");
  await assertNoActiveDuo(database, validated.duoId, Object.values(members).map(user => user.id));
  const service = rt.createDuoService(database, config);
  if (typeof service.buildBand !== "function" || !service.config) fail("UNSUPPORTED_APP_CURRICULUM_ADAPTER");
  const at = new Date(config.now?.() ?? Date.now()).toISOString();
  const assignment = { version: VERSION, band: 3, at, source: "owner-request" };
  const changes = [];
  const identities = Object.fromEntries(ROLES.map(role => [role, members[role].id]));
  const beforePath = await database.db.collection("duo_learning_paths").findOne({ _id: validated.duoId }, raw);
  let afterPath;
  if (beforePath) {
    validatePath(beforePath, validated.duoId, identities);
    afterPath = clone(rt.EJSON, beforePath);
    const needsChange = numeric(afterPath.startingBand) !== 3 || numeric(afterPath.currentBand) !== 3 ||
      !afterPath.bands.b6.unlockedAt || afterPath.bands.b6.completedAt !== null ||
      ROLES.some(role => afterPath.bands.b6.promotionResults[role] !== null) || afterPath.bands.b6.lastPromotionRoomId !== null;
    if (needsChange) {
      afterPath.startingBand = 3; afterPath.currentBand = 3;
      afterPath.bands.b6.unlockedAt ||= at;
      afterPath.bands.b6.completedAt = null;
      afterPath.bands.b6.promotionResults = { husband: null, wife: null };
      afterPath.bands.b6.lastPromotionRoomId = null;
      afterPath.updatedAt = at; afterPath.revision = numeric(beforePath.revision) + 1;
      afterPath.administrativeBandAssignment = assignment;
      changes.push({ collection: "duo_learning_paths", id: afterPath._id, before: beforePath, after: afterPath });
    }
  } else {
    const bands = {};
    for (let band = 3; band <= 8; band += 0.5) bands[`b${band * 2}`] = await service.buildBand(band, validated.duoId, members.husband.testType);
    bands.b6.unlockedAt = at;
    afterPath = { _id: validated.duoId, duoId: validated.duoId, members: identities, startingBand: 3, currentBand: 3, targetBand: 8,
      gateInterval: service.config.gateInterval, sessionsPerBand: service.config.sessionsPerBand,
      passPercent: service.config.passPercent, strictRetakeMode: service.config.strictRetakeMode,
      revision: 0, startedAt: at, updatedAt: at, bands, administrativeBandAssignment: assignment };
    validatePath(afterPath, validated.duoId, identities);
    changes.push({ collection: "duo_learning_paths", id: afterPath._id, before: null, after: afterPath });
  }
  const expectedUsers = {};
  for (const role of ROLES) {
    const before = members[role];
    let after = clone(rt.EJSON, before);
    if (numeric(before.currentBand) !== 3 || numeric(before.personalEstimatedBand) !== 3 || before.cefr !== "A2") {
      after.currentBand = 3; after.personalEstimatedBand = 3; after.cefr = "A2";
      after.administrativeBandAssignment = assignment;
      changes.push({ collection: "users", id: before._id, before, after });
    }
    expectedUsers[role] = after;
  }
  const unfinished = await database.placements.find({ userId: members.wife.id, currentQuestionId: { $ne: null } }, raw).toArray();
  for (const before of unfinished) {
    if (typeof before._id !== "string" || typeof before.currentQuestionId !== "string" || !before.currentQuestionId ||
        before.completionReason === "invalidated" || before.invalidatedAt || before.result != null)
      fail("UNFINISHED_PLACEMENT_SCHEMA_MISMATCH");
    const after = clone(rt.EJSON, before);
    after.currentQuestionId = null; after.draftAnswer = null; after.completedAt = at;
    after.result = null; after.administrativelySkippedAt = at; after.administrativeBandAssignment = assignment;
    changes.push({ collection: "placements", id: before._id, before, after });
    const guards = await database.db.collection("exam_integrity_sessions").find({
      userId: members.wife.id, kind: "placement", resourceId: before._id, status: "active",
    }, raw).toArray();
    for (const guardBefore of guards) {
      if (guardBefore.phase === "grading" || guardBefore.resetPending === true) fail("PLACEMENT_GUARD_RESET_OR_GRADING_PENDING");
      const guardAfter = clone(rt.EJSON, guardBefore);
      guardAfter.status = "completed"; guardAfter.resetPending = false; guardAfter.updatedAt = at;
      guardAfter.administrativelySkippedAt = at;
      changes.push({ collection: "exam_integrity_sessions", id: guardBefore._id, before: guardBefore, after: guardAfter });
    }
  }
  return { version: VERSION, databaseName: database.db.databaseName, duoId: validated.duoId, createdAt: at,
    members: identities, expectedUsers, expectedPath: afterPath, changes,
    skippedPlacements: unfinished.length, alreadyAssigned: changes.length === 0 };
}

async function privateFile(path, data) {
  const file = await open(path, "wx", 0o600);
  try { await file.writeFile(data); await file.sync(); } finally { await file.close(); }
}

async function assertPrivate(path, directory = false) {
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()) || (stat.mode & 0o077) !== 0)
    fail("PRIVATE_BACKUP_PERMISSIONS_INVALID");
}

async function collectionMetadata(db) {
  return (await db.listCollections({}, { nameOnly: false }).toArray()).sort((a, b) => a.name.localeCompare(b.name));
}

async function indexDescription(collection, EJSON) {
  const indexes = (await collection.listIndexes().toArray()).sort((a, b) => a.name.localeCompare(b.name));
  return { indexes, indexHash: sha(canonical(EJSON, indexes)) };
}

/** Streaming, private, full-database EJSON backup. It must complete before apply. */
export async function backupAssignment(database, plan, directory) {
  assertDatabase(database);
  assertOffline(database);
  const { EJSON } = await runtime();
  if (!isAbsolute(directory || "")) fail("PRIVATE_BACKUP_DIRECTORY_REQUIRED");
  if (plan.version !== VERSION || plan.databaseName !== database.db.databaseName) fail("PLAN_DATABASE_MISMATCH");
  await mkdir(directory, { mode: 0o700 });
  await assertPrivate(directory, true);
  if ((await readdir(directory)).length) fail("PRIVATE_BACKUP_DIRECTORY_NOT_EMPTY");
  const planText = serialize(EJSON, plan);
  await privateFile(join(directory, "plan.ejson"), planText);
  const manifest = { version: VERSION, databaseName: database.db.databaseName, createdAt: plan.createdAt,
    planHash: sha(planText), collections: [] };
  const metadata = await collectionMetadata(database.db);
  for (const [index, info] of metadata.entries()) {
    if (info.type !== "collection") fail("UNSUPPORTED_DATABASE_VIEW");
    const collection = database.db.collection(info.name);
    const fileName = `collection-${index}.ejsonl`;
    const file = await open(join(directory, fileName), "wx", 0o600);
    const hash = createHash("sha256"); let count = 0;
    try {
      for await (const row of collection.find({}, { ...raw, batchSize: 25 }).sort({ _id: 1 })) {
        await file.write(serialize(EJSON, row) + "\n");
        hash.update(canonical(EJSON, row) + "\n"); count++;
      }
      await file.sync();
    } finally { await file.close(); }
    const indexes = await indexDescription(collection, EJSON);
    manifest.collections.push({ name: info.name, metadata: info, file: fileName, count, documentsHash: hash.digest("hex"), ...indexes });
  }
  const manifestText = serialize(EJSON, manifest);
  await privateFile(join(directory, "manifest.ejson"), manifestText);
  const receipt = { version: VERSION, databaseName: database.db.databaseName,
    planHash: manifest.planHash, manifestHash: sha(manifestText), complete: true };
  const receiptText = JSON.stringify(receipt);
  await privateFile(join(directory, "backup-complete.json"), receiptText);
  const dir = await open(directory, "r"); try { await dir.sync(); } finally { await dir.close(); }
  plan.backup = { directory, receiptHash: sha(receiptText), planHash: receipt.planHash, manifestHash: receipt.manifestHash };
  return plan;
}

async function readBackup(plan) {
  const { EJSON } = await runtime();
  const directory = plan.backup?.directory;
  if (!isAbsolute(directory || "")) fail("VERIFIED_PRIVATE_BACKUP_REQUIRED");
  await assertPrivate(directory, true);
  for (const name of ["plan.ejson", "manifest.ejson", "backup-complete.json"]) await assertPrivate(join(directory, name));
  const [planText, manifestText, receiptText] = await Promise.all([
    readFile(join(directory, "plan.ejson"), "utf8"), readFile(join(directory, "manifest.ejson"), "utf8"),
    readFile(join(directory, "backup-complete.json"), "utf8"),
  ]);
  const receipt = JSON.parse(receiptText);
  if (!receipt.complete || receipt.version !== VERSION || receipt.databaseName !== plan.databaseName ||
      sha(planText) !== receipt.planHash || sha(manifestText) !== receipt.manifestHash ||
      sha(receiptText) !== plan.backup.receiptHash || plan.backup.planHash !== receipt.planHash || plan.backup.manifestHash !== receipt.manifestHash)
    fail("PRIVATE_BACKUP_RECEIPT_MISMATCH");
  const saved = EJSON.parse(planText, { relaxed: false });
  const withoutBackup = { ...plan }; delete withoutBackup.backup;
  if (!equal(EJSON, saved, withoutBackup)) fail("PRIVATE_BACKUP_PLAN_MISMATCH");
  const manifest = EJSON.parse(manifestText, { relaxed: false });
  for (const entry of manifest.collections) await assertPrivate(join(directory, entry.file));
  return { directory, manifest, EJSON };
}

function validatePlan(database, plan) {
  assertDatabase(database);
  if (plan.version !== VERSION || plan.databaseName !== database.db.databaseName || !plan.duoId ||
      !plan.members?.husband || !plan.members?.wife || plan.members.husband === plan.members.wife || !Array.isArray(plan.changes))
    fail("PLAN_DATABASE_MISMATCH");
  if (plan.changes.some(change => !COLLECTIONS.has(change.collection) || typeof change.id !== "string" ||
      change.after?._id !== change.id || (change.before !== null && change.before?._id !== change.id) ||
      (change.before === null && change.collection !== "duo_learning_paths"))) fail("PLAN_WRITE_SCOPE_INVALID");
  const keys = plan.changes.map(change => `${change.collection}\0${change.id}`);
  if (new Set(keys).size !== keys.length) fail("PLAN_DUPLICATE_TARGET");
}

async function assertTargets(database, plan, after) {
  const { EJSON } = await runtime();
  if (await database.users.countDocuments() !== 2) fail("EXPECTED_EXACTLY_TWO_USERS");
  for (const change of plan.changes) {
    const actual = await database.db.collection(change.collection).findOne({ _id: change.id }, raw);
    if (!equal(EJSON, actual, after ? change.after : change.before)) fail(after ? "ASSIGNMENT_TARGET_VERIFICATION_FAILED" : "STALE_ASSIGNMENT_PLAN");
  }
  await assertNoActiveDuo(database, plan.duoId, Object.values(plan.members));
}

async function verifyDatabasePreservation(database, plan) {
  const { manifest, EJSON } = await readBackup(plan);
  const old = new Map(manifest.collections.map(entry => [entry.name, entry]));
  const present = await collectionMetadata(database.db);
  const presentNames = new Set(present.map(info => info.name));
  for (const name of old.keys()) if (!presentNames.has(name)) fail("UNRELATED_COLLECTION_REMOVED");
  const changesByCollection = new Map();
  for (const change of plan.changes) {
    if (!changesByCollection.has(change.collection)) changesByCollection.set(change.collection, new Map());
    changesByCollection.get(change.collection).set(change.id, change);
  }
  for (const info of present) {
    const previous = old.get(info.name);
    const changes = changesByCollection.get(info.name) || new Map();
    const inserted = [...changes.values()].filter(change => change.before === null);
    if (!previous && (info.name !== "duo_learning_paths" || inserted.length !== 1)) fail("UNRELATED_COLLECTION_CREATED");
    const collection = database.db.collection(info.name);
    const indexes = await indexDescription(collection, EJSON);
    if (previous && indexes.indexHash !== previous.indexHash) fail("INDEXES_CHANGED");
    if (!previous && (indexes.indexes.length !== 1 || indexes.indexes[0].name !== "_id_")) fail("UNEXPECTED_NEW_PATH_INDEXES");
    if (previous && !equal(EJSON, info.options ?? {}, previous.metadata.options ?? {})) fail("COLLECTION_OPTIONS_CHANGED");
    const hash = createHash("sha256"); let count = 0;
    const seen = new Set();
    for await (const row of collection.find({}, { ...raw, batchSize: 25 }).sort({ _id: 1 })) {
      const change = typeof row._id === "string" ? changes.get(row._id) : undefined;
      if (change) {
        if (!equal(EJSON, row, change.after)) fail("ASSIGNMENT_TARGET_VERIFICATION_FAILED");
        seen.add(change.id);
        if (change.before !== null) { hash.update(canonical(EJSON, change.before) + "\n"); count++; }
      } else { hash.update(canonical(EJSON, row) + "\n"); count++; }
    }
    if (seen.size !== changes.size) fail("ASSIGNMENT_TARGET_MISSING");
    if (previous && (count !== numeric(previous.count) || hash.digest("hex") !== previous.documentsHash)) fail("UNRELATED_DOCUMENT_CHANGED");
    if (!previous && count !== 0) fail("UNRELATED_DOCUMENT_CREATED");
  }
}

/** CAS writes only the explicit rank/path/unfinished-wife-placement/guard targets. */
export async function applyAssignment(database, plan) {
  validatePlan(database, plan);
  assertOffline(database);
  if (!plan.changes.length) return verifyAssignment(database, plan);
  await readBackup(plan);
  const { EJSON } = await runtime();
  const actualTargets = await Promise.all(plan.changes.map(change => database.db.collection(change.collection).findOne({ _id: change.id }, raw)));
  if (actualTargets.every((value, index) => equal(EJSON, value, plan.changes[index].after))) return verifyAssignment(database, plan);
  await assertTargets(database, plan, false);
  await privateFile(join(plan.backup.directory, "mutation-started.json"), JSON.stringify({ version: VERSION, planHash: plan.backup.planHash, startedAt: new Date().toISOString() }));
  const dir = await open(plan.backup.directory, "r"); try { await dir.sync(); } finally { await dir.close(); }
  for (const change of plan.changes) {
    const collection = database.db.collection(change.collection);
    if (change.before === null) {
      try { await collection.insertOne(change.after); } catch { fail("PATH_INSERT_CONFLICT"); }
    } else {
      const result = await collection.replaceOne({ _id: change.id, $expr: { $eq: ["$$ROOT", { $literal: change.before }] } }, change.after);
      if (result.matchedCount !== 1) fail("TARGET_CAS_FAILED_AFTER_MUTATION_STARTED");
    }
  }
  return verifyAssignment(database, plan);
}

/** Read-only, including when the backup directory is mounted read-only. */
export async function verifyAssignment(database, plan) {
  validatePlan(database, plan);
  const { EJSON } = await runtime();
  await assertTargets(database, plan, true);
  for (const role of ROLES) {
    const user = await database.users.findOne({ _id: plan.members[role] }, raw);
    if (!equal(EJSON, user, plan.expectedUsers[role]) || numeric(user?.currentBand) !== 3 ||
        numeric(user?.personalEstimatedBand) !== 3 || user?.cefr !== "A2") fail("USER_RANK_VERIFICATION_FAILED");
  }
  const path = await database.db.collection("duo_learning_paths").findOne({ _id: plan.duoId }, raw);
  validatePath(path, plan.duoId, plan.members);
  if (!equal(EJSON, path, plan.expectedPath) || numeric(path.currentBand) !== 3 || numeric(path.startingBand) !== 3 ||
      !path.bands.b6.unlockedAt || path.bands.b6.completedAt !== null ||
      ROLES.some(role => path.bands.b6.promotionResults[role] !== null) || path.bands.b6.lastPromotionRoomId !== null)
    fail("SHARED_RANK_VERIFICATION_FAILED");
  if (await database.placements.countDocuments({ userId: plan.members.wife, currentQuestionId: { $ne: null } }))
    fail("WIFE_PLACEMENT_STILL_ACTIVE");
  if (plan.backup) await verifyDatabasePreservation(database, plan);
  return { verified: true, alreadyAssigned: plan.alreadyAssigned, rank: 3, users: 2, pathAvailable: true,
    skippedPlacements: plan.skippedPlacements, changedDocuments: plan.changes.length, databasePreserved: Boolean(plan.backup) };
}

function configurationFromEnvironment() {
  const number = (key, fallback) => {
    const value = Number(process.env[key] || fallback);
    if (!Number.isFinite(value)) fail("DUO_CURRICULUM_CONFIGURATION_INVALID");
    return value;
  };
  const strict = process.env.DUO_STRICT_RETAKE_MODE || "false";
  if (!["true", "false"].includes(strict)) fail("DUO_CURRICULUM_CONFIGURATION_INVALID");
  let sessionsByBand;
  try { if (process.env.DUO_SESSIONS_BY_BAND) sessionsByBand = JSON.parse(process.env.DUO_SESSIONS_BY_BAND); }
  catch { fail("DUO_CURRICULUM_CONFIGURATION_INVALID"); }
  return { gateInterval: number("DUO_GATE_INTERVAL", 5), sessionsPerBand: number("DUO_SESSIONS_PER_BAND", 20),
    passPercent: number("DUO_PASS_PERCENT", 70), strictRetakeMode: strict === "true", ...(sessionsByBand ? { sessionsByBand } : {}) };
}

async function loadSavedPlan(directory) {
  const { EJSON } = await runtime();
  if (!isAbsolute(directory || "")) fail("PRIVATE_BACKUP_DIRECTORY_REQUIRED");
  const receiptText = await readFile(join(directory, "backup-complete.json"), "utf8");
  const receipt = JSON.parse(receiptText);
  const plan = EJSON.parse(await readFile(join(directory, "plan.ejson"), "utf8"), { relaxed: false });
  plan.backup = { directory, receiptHash: sha(receiptText), planHash: receipt.planHash, manifestHash: receipt.manifestHash };
  return plan;
}

async function main() {
  const action = process.argv[2];
  if (!["inspect", "apply", "verify"].includes(action)) fail("EXPECTED_INSPECT_APPLY_OR_VERIFY");
  const rt = await runtime();
  if (!process.env.MONGODB_URI) fail("MONGODB_URI_REQUIRED");
  const client = new rt.MongoClient(process.env.MONGODB_URI, { maxPoolSize: 2, serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000 });
  try {
    await client.connect();
    const db = client.db();
    if (db.databaseName !== "ielts_ai") fail("CLI_REQUIRES_IELTS_AI_DATABASE");
    const database = { client, db, users: db.collection("users"), content: db.collection("content"), vocabulary: db.collection("vocabulary"), placements: db.collection("placements") };
    if (action === "verify") {
      const plan = await loadSavedPlan(process.env.IELTS_BAND_BACKUP_DIR);
      process.stdout.write(JSON.stringify(await verifyAssignment(database, plan)) + "\n");
      return;
    }
    const settings = rt.loadDuoCredentials();
    const plan = await prepareAssignment(database, settings, configurationFromEnvironment());
    if (action === "inspect") {
      process.stdout.write(JSON.stringify({ alreadyAssigned: plan.alreadyAssigned, rank: 3, users: 2,
        pathAvailable: true, skippedPlacements: plan.skippedPlacements, changedDocuments: plan.changes.length }) + "\n");
      return;
    }
    await backupAssignment(database, plan, process.env.IELTS_BAND_BACKUP_DIR);
    process.stdout.write(JSON.stringify(await applyAssignment(database, plan)) + "\n");
  } finally { await client.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    const message = typeof error?.message === "string" && /^DUO_BAND_ADMIN:[A-Z_]+$/.test(error.message)
      ? error.message : "DUO_BAND_ADMIN:OPERATION_FAILED_PRIVATE_DETAILS_WITHHELD";
    process.stderr.write(message + "\n"); process.exitCode = 1;
  });
}
