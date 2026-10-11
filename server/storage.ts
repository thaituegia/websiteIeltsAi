import { randomUUID } from "node:crypto";
import {
  GridFSBucket,
  MongoClient,
  ObjectId,
  type Collection,
  type Db,
} from "mongodb";
import type {
  Attempt,
  PlacementItem,
  Profile,
  StoredContent,
  StudyPlan,
  VocabularyCard,
  VocabularyEntry,
  Feedback,
} from "../shared/types";
import { contentBank as contentBankDefault, placementBank as placementBankDefault, vocabularyBank as vocabularyBankDefault } from "./data/index";
import { contentBank as initialContentBank } from "./data/initial-fresh-bank";
import { vocabularyBank as previousVocabularyBank, placementBank as previousPlacementBank } from "./data/fresh-v2-bank";
import { addMissingReferenceAnswers } from "./content-references";
import { validateContentStructure } from "../shared/content-visuals";

export interface UserRecord extends Profile {
  _id: string;
  passwordHash: string | null;
  registrationSlot?: number;
}
export interface SessionRecord {
  _id: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
  duoCredentialVersion?: string;
}
export interface AttemptRecord
  extends Omit<Attempt, "content" | "audioAvailable"> {
  _id: string;
  userId: string;
  listeningPlayed?: boolean;
  duoAssessmentId?: string;
}
export interface CardRecord extends VocabularyCard {
  _id: string;
  userId: string;
  scheduler: string;
  reviewLog: string[];
}
export interface PlacementRecord {
  _id: string;
  userId: string;
  mode: "quick" | "deep";
  total: number;
  theta: number;
  standardError: number;
  estimatedBand: number;
  currentQuestionId: string | null;
  answers: {
    questionId: string; answer: string; correct: boolean;
    /** Snapshot of the actual item answered; never exposed while active. */
    review?: Feedback["answers"][number];
  }[];
  result: Feedback | null;
  startedAt: string;
  deadlineAt?: string;
  completedAt?: string;
  completionReason?: "answered" | "deadline";
  draftAnswer?: { questionId: string; answer: string } | null;
}
export interface PlanRecord extends StudyPlan {
  _id: string;
  userId: string;
}
export interface AudioRecord {
  _id: string;
  userId: string;
  attemptId: string;
  fileId: ObjectId;
  mime: string;
  createdAt: string;
}
export interface StoredContentRecord extends StoredContent {
  _id: string;
}
export interface StoredVocabularyRecord extends VocabularyEntry {
  _id: string;
}
export interface PlacementItemRecord extends PlacementItem {
  _id: string;
}

export interface Database {
  client: MongoClient;
  db: Db;
  recordings: GridFSBucket;
  users: Collection<UserRecord>;
  sessions: Collection<SessionRecord>;
  attempts: Collection<AttemptRecord>;
  cards: Collection<CardRecord>;
  placements: Collection<PlacementRecord>;
  plans: Collection<PlanRecord>;
  audio: Collection<AudioRecord>;
  content: Collection<StoredContentRecord>;
  vocabulary: Collection<StoredVocabularyRecord>;
  placementItems: Collection<PlacementItemRecord>;
}

export async function connectDatabase(
  uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/ielts_ai",
  databaseName?: string,
): Promise<Database> {
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 8000,
    connectTimeoutMS: 8000,
    maxPoolSize: 20,
  });
  try {
    await client.connect();
    const db = client.db(databaseName);
    await db.command({ ping: 1 });
    const database: Database = {
      client,
      db,
      recordings: new GridFSBucket(db, { bucketName: "recordings" }),
      users: db.collection("users"),
      sessions: db.collection("sessions"),
      attempts: db.collection("attempts"),
      cards: db.collection("cards"),
      placements: db.collection("placements"),
      plans: db.collection("plans"),
      audio: db.collection("audio"),
      content: db.collection("content"),
      vocabulary: db.collection("vocabulary"),
      placementItems: db.collection("placementItems"),
    };
    await Promise.all([
      database.users.createIndex({ email: 1 }, { unique: true }),
      database.users.createIndex(
        { registrationSlot: 1 },
        {
          unique: true,
          partialFilterExpression: { registrationSlot: { $type: "number" } },
        },
      ),
      database.sessions.createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: 0 },
      ),
      database.sessions.createIndex({ userId: 1 }),
      database.attempts.createIndex({ userId: 1, startedAt: -1 }),
      database.attempts.createIndex(
        { userId: 1, contentId: 1, mode: 1 },
        { unique: true, partialFilterExpression: { status: "in-progress" } },
      ),
      database.cards.createIndex({ userId: 1, word: 1 }, { unique: true }),
      database.cards.createIndex({ userId: 1, dueAt: 1 }),
      database.placements.createIndex({ userId: 1, startedAt: -1 }),
      database.plans.createIndex({ userId: 1, weekStart: 1 }, { unique: true }),
      database.audio.createIndex({ userId: 1, attemptId: 1 }, { unique: true }),
      database.content.createIndex({ skill: 1, band: 1, testType: 1 }),
      database.vocabulary.createIndex({ topic: 1, cefr: 1 }),
    ]);
    return database;
  } catch (error) {
    await client.close();
    throw error;
  }
}

export async function seedDatabase(database: Database, historicalFixture?: {
  content: StoredContent[]; vocabulary: VocabularyEntry[]; placementItems: PlacementItem[];
}): Promise<void> {
  // Historical regression fixtures run only in disposable test databases.
  // Normal startup must never blend the old public bank with the replacement.
  if (historicalFixture && !/^ielts_ai_.*test_[a-f0-9]{32}$/.test(database.db.databaseName))
    throw Error("Historical seed fixtures are restricted to isolated test databases.");
  if (!historicalFixture) {
    for (const name of ["content", "vocabulary", "placementItems"]) {
      const rows = name === "content" ? contentBankDefault : name === "vocabulary" ? vocabularyBankDefault : placementBankDefault;
      const collection = database.db.collection<{ _id: string }>(name);
      const hasEarlierSeed = await collection.findOne({ _id: { $regex: "^(reading|listening|writing|speaking|grammar|mock|vocab|placement)-" } });
      // A custom-only old database is also not a clean installation. Future
      // personal AI content is allowed once the full active seed is present.
      const hasOtherPublic = await collection.findOne({ _id: { $nin: rows.map(x => x.id) } });
      const compatibleIds = name === "content" ? initialContentBank.map(x => x.id)
        : name === "vocabulary" ? previousVocabularyBank.map(x => x.id) : previousPlacementBank.map(x => x.id);
      // An intact first fresh bank may receive later new mocks even when it
      // contains a learner's own material. A custom-only old database may not.
      const activeComplete = !hasOtherPublic || await collection.countDocuments({ _id: { $in: compatibleIds } }) === compatibleIds.length;
      if (hasEarlierSeed || !activeComplete)
        throw Error("An earlier bank is present. Stop the IELTS app and run the scoped, backed-up bank reset before starting this release.");
    }
  }
  const { content: contentBank, vocabulary: vocabularyBank, placementItems: placementBank } = historicalFixture ?? {
    content: contentBankDefault, vocabulary: vocabularyBankDefault, placementItems: placementBankDefault,
  };
  // Shared seed is idempotent and never touches private progress.
  // Validate the complete bank before writing the first public document.
  for (const content of contentBank) validateContentStructure(content);
  if (contentBank.length)
    await database.content.bulkWrite(
      contentBank.map((item) => ({
        updateOne: {
          filter: { _id: item.id },
          update: { $setOnInsert: { ...item, _id: item.id } },
          upsert: true,
        },
      })),
      { ordered: false, ignoreUndefined: true },
    );
  if (vocabularyBank.length)
    await database.vocabulary.bulkWrite(
      vocabularyBank.map((item) => ({
        updateOne: {
          filter: { _id: item.id },
          update: { $setOnInsert: { ...item, _id: item.id } },
          upsert: true,
        },
      })),
      { ordered: false, ignoreUndefined: true },
    );
  if (placementBank.length)
    await database.placementItems.bulkWrite(
      placementBank.map((item) => ({
        updateOne: {
          filter: { _id: item.id },
          update: { $setOnInsert: { ...item, _id: item.id } },
          upsert: true,
        },
      })),
      { ordered: false, ignoreUndefined: true },
    );
  if (!historicalFixture) await addMissingReferenceAnswers(database.content, contentBank);
}

export function profileOf(user: UserRecord): Profile {
  const {
    _id: _ignored,
    passwordHash: _password,
    registrationSlot: _slot,
    ...profile
  } = user;
  return profile;
}

export async function ensureDemo(
  database: Database,
  learner: 1 | 2,
): Promise<UserRecord> {
  const id = `demo-${learner}`;
  const profile: UserRecord = {
    _id: id,
    id,
    name: `Học viên ${String(learner).padStart(2, "0")}`,
    email: `learner${learner}@demo.ielts.local`,
    demo: true,
    passwordHash: null,
    currentBand: null,
    targetBand: learner === 1 ? 6.5 : 7,
    testType: "academic",
    examDate: null,
    weeklyMinutes: 300,
    dailyMinutes: 45,
    cefr: null,
    createdAt: new Date().toISOString(),
  };
  await database.users.updateOne(
    { _id: id },
    { $setOnInsert: profile },
    { upsert: true },
  );
  const user = await database.users.findOne({ _id: id });
  if (!user) throw new Error("Cannot initialize demonstration learner");
  return user;
}
export function newId(): string {
  return randomUUID();
}
export { ObjectId };
