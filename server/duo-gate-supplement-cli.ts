import { MongoClient, type Collection, type Db } from "mongodb";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { buildSpeechScript, chunkSpeechTurns } from "../shared/speech-script";
import { loadDuoCredentials } from "./duo-auth";
import { ensureDuoGateSupplement } from "./duo-exam-content";
import { newDuoGatePapers, NEW_DUO_GATE_LISTENING_IDS, SUPPLEMENT_VERSION } from "./data/duo-gate-supplement";
import { newAdditionalDuoGatePapers, ADDITIONAL_DUO_GATE_LISTENING_IDS, ADDITIONAL_SUPPLEMENT_VERSION } from "./data/duo-gate-supplement-2";
import { newFiveDuoGatePapers, FIVE_DUO_GATE_LISTENING_IDS, FIVE_SUPPLEMENT_VERSION } from "./data/duo-gate-supplement-3";
import { activateProviderConfig } from "./provider-config";
import { SpeechAudioCache, speechCapabilities, speechSectionFingerprint } from "./speech-audio";
import { SpeechGenerationBudget } from "./speech-budget";
import type { Database } from "./storage";

const LEDGER_COLLECTION = "duo_gate_audio_supplements";
const PER_CLIP_CHARACTERS = 3000;
const METADATA_TIMEOUT_MS = 8000;
const OWNED_TEST_DATABASE = /^ielts_gate_supplement_test_[a-f0-9]{32}$/;
const SUPPLEMENT_BATCHES = {
  initial: { argument: "--prepare", version: SUPPLEMENT_VERSION, ids: NEW_DUO_GATE_LISTENING_IDS,
    papers: newDuoGatePapers, maxProviderRequests: 3, maxInputCharacters: 9000, deadlineMs: 180_000 },
  additional: { argument: "--prepare-additional", version: ADDITIONAL_SUPPLEMENT_VERSION, ids: ADDITIONAL_DUO_GATE_LISTENING_IDS,
    papers: newAdditionalDuoGatePapers, maxProviderRequests: 3, maxInputCharacters: 9000, deadlineMs: 180_000 },
  five: { argument: "--prepare-five", version: FIVE_SUPPLEMENT_VERSION, ids: FIVE_DUO_GATE_LISTENING_IDS,
    papers: newFiveDuoGatePapers, maxProviderRequests: 5, maxInputCharacters: 15000, deadlineMs: 300_000 },
} as const;
type SupplementBatch = keyof typeof SUPPLEMENT_BATCHES;

interface Ledger {
  _id: string;
  targets: { id: string; fingerprint: string }[];
  attemptedIds: string[];
  requestsReserved: number;
  inputCharactersReserved: number;
  preparing?: { id: string; owner: string; expiresAt: Date }[];
  createdAt: Date;
  updatedAt: Date;
}
export interface DuoGateSupplementResult {
  ok: boolean;
  version: string;
  total: number;
  ready: number;
  providerRequests: number;
  maxProviderRequests: number;
  inputCharacters: number;
  maxInputCharacters: number;
}

/** A clip may spend one request, and all clips share the same run allowance. */
class ClipBudget extends SpeechGenerationBudget {
  constructor(private readonly shared: SpeechGenerationBudget) {
    super({ maxProviderRequests: 1, maxInputCharacters: PER_CLIP_CHARACTERS });
  }
  override consume(characters: number): void {
    super.consume(characters);
    this.shared.consume(characters);
  }
}

async function waitForFundedPreparation(ledger: Collection<Ledger>, version: string, id: string, signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    const row = await ledger.findOne({ _id: version }, { timeoutMS: METADATA_TIMEOUT_MS });
    const claim = row?.preparing?.find(claim => claim.id === id);
    if (!claim || claim.expiresAt.getTime() <= Date.now()) return;
    await new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
      const timer = setTimeout(done, Math.min(250, claim.expiresAt.getTime() - Date.now()));
      signal.addEventListener("abort", done, { once: true });
      if (signal.aborted) done();
    });
  }
}

/** Prepare only the selected batch of authored band-3 Gate recordings. A durable reservation
 * is consumed before each first attempt and is never refunded, even on timeout
 * or an ambiguous response. A subsequent run may assemble saved turns with a
 * zero budget, but cannot buy a second attempt for that clip. */
export async function prepareDuoGateSupplement(db: Db, options: { expectedDatabase?: string; signal?: AbortSignal; batch?: SupplementBatch } = {}): Promise<DuoGateSupplementResult> {
  const expected = options.expectedDatabase ?? "ielts_ai";
  if (db.databaseName !== expected || expected !== "ielts_ai" && !OWNED_TEST_DATABASE.test(expected))
    throw new Error("Supplement preparation requires the installation or an owned synthetic database.");
  const batch = options.batch ?? "initial";
  if (!Object.hasOwn(SUPPLEMENT_BATCHES, batch)) throw new Error("Supplement batch is invalid.");
  const selected = SUPPLEMENT_BATCHES[batch];
  const { version, maxProviderRequests, maxInputCharacters, deadlineMs } = selected;
  const ids: string[] = [...selected.ids];
  const papers = selected.papers().filter(paper => ids.includes(paper.id));
  if (ids.length !== maxProviderRequests || new Set(ids).size !== maxProviderRequests || papers.length !== maxProviderRequests ||
      papers.some(paper => paper.band !== 3 || paper.skill !== "listening" || paper.format !== "lesson" || paper.sections.length !== 1))
    throw new Error("Supplement inventory is invalid.");
  for (const paper of papers) {
    const turns = chunkSpeechTurns(buildSpeechScript(paper.sections));
    // Include conservative room for provider JSON, voice/model and instructions.
    // The runtime budget separately checks the actual serialized request body.
    if (turns.length !== 1 || turns[0]!.accent !== "british" ||
        JSON.stringify(turns[0]!.text).length + 1024 > PER_CLIP_CHARACTERS)
      throw new Error("A supplement clip exceeds its one-request allowance.");
  }
  if (!speechCapabilities().configured) throw new Error("Supplement provider configuration is unavailable.");
  const controller = new AbortController();
  const deadline = Date.now() + deadlineMs;
  const timer = setTimeout(() => controller.abort(), deadlineMs);
  timer.unref();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const budget = new SpeechGenerationBudget({ maxProviderRequests, maxInputCharacters });
  const cache = new SpeechAudioCache({ db } as Database);
  let ready = 0;
  const report = (): DuoGateSupplementResult => {
    const usage = budget.snapshot();
    return { ok: ready === maxProviderRequests && !signal.aborted, version, total: maxProviderRequests, ready,
      providerRequests: usage.providerRequests, maxProviderRequests,
      inputCharacters: usage.inputCharacters, maxInputCharacters };
  };
  try {
    if (signal.aborted) return report();
    await ensureDuoGateSupplement({ db }, batch);
    const targets = papers.map(paper => ({ id: paper.id, fingerprint: speechSectionFingerprint(paper.sections[0]!) }));
    const ledger = db.collection<Ledger>(LEDGER_COLLECTION);
    for (const paper of papers) {
      if (signal.aborted) return report();
      if ((await cache.readiness(paper.sections)).ready) {
        await cache.getReady(paper.sections);
        ready++;
        continue;
      }
      const now = new Date();
      try {
        await ledger.insertOne({ _id: version, targets, attemptedIds: [], requestsReserved: 0,
          inputCharactersReserved: 0, createdAt: now, updatedAt: now }, { timeoutMS: METADATA_TIMEOUT_MS });
      } catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === 11000)) throw error;
      }
      const previous = await ledger.findOne({ _id: version }, { timeoutMS: METADATA_TIMEOUT_MS });
      if (!previous || JSON.stringify(previous.targets) !== JSON.stringify(targets) ||
          !Array.isArray(previous.attemptedIds) || new Set(previous.attemptedIds).size !== previous.attemptedIds.length ||
          previous.attemptedIds.some(id => !ids.includes(id)) ||
          previous.requestsReserved !== previous.attemptedIds.length || previous.requestsReserved > maxProviderRequests ||
          previous.inputCharactersReserved !== previous.requestsReserved * PER_CLIP_CHARACTERS)
        throw new Error("Supplement allowance metadata is invalid.");
      const owner = randomUUID();
      const reserved = await ledger.updateOne({ _id: version, targets,
        attemptedIds: { $ne: paper.id }, requestsReserved: { $lt: maxProviderRequests },
        inputCharactersReserved: { $lte: maxInputCharacters - PER_CLIP_CHARACTERS },
      }, { $addToSet: { attemptedIds: paper.id }, $inc: { requestsReserved: 1, inputCharactersReserved: PER_CLIP_CHARACTERS },
        $push: { preparing: { id: paper.id, owner, expiresAt: new Date(deadline) } },
        $set: { updatedAt: now } }, { timeoutMS: METADATA_TIMEOUT_MS });
      if (reserved.modifiedCount) {
        try {
          await cache.get(paper.sections, signal, new ClipBudget(budget));
        } finally {
          await ledger.updateOne({ _id: version, preparing: { $elemMatch: { id: paper.id, owner } } },
            { $pull: { preparing: { id: paper.id, owner } } }, { timeoutMS: METADATA_TIMEOUT_MS });
        }
      } else {
        // A zero-budget recovery must not win the cache claim before the funded
        // reservation owner gets there. Wait for that owner to finish or expire.
        await waitForFundedPreparation(ledger, version, paper.id, signal);
        await cache.get(paper.sections, signal, new SpeechGenerationBudget());
      }
      await cache.getReady(paper.sections);
      ready++;
    }
    return report();
  } catch {
    // Only counts leave this worker; raw Mongo/provider errors remain private.
    return report();
  } finally { clearTimeout(timer); }
}

export function parseDuoGateSupplementArguments(args: string[]): SupplementBatch {
  if (args.length === 1) for (const batch of Object.keys(SUPPLEMENT_BATCHES) as SupplementBatch[])
    if (args[0] === SUPPLEMENT_BATCHES[batch].argument) return batch;
  throw new Error("Supplement requires one explicit bounded prepare mode.");
}

export async function duoGateSupplementMain(args = process.argv.slice(2)): Promise<void> {
  const batch = parseDuoGateSupplementArguments(args);
  const { version, deadlineMs } = SUPPLEMENT_BATCHES[batch];
  if (process.env.APP_ORIGIN !== "https://sutonghanyu.vn" ||
      process.env.MONGODB_URI !== "mongodb://mongo:27017/ielts_ai")
    throw new Error("Supplement requires the explicit bounded prepare mode at its installation.");
  activateProviderConfig(loadDuoCredentials());
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: METADATA_TIMEOUT_MS,
    connectTimeoutMS: METADATA_TIMEOUT_MS, maxPoolSize: 2 });
  const controller = new AbortController(), stop = () => controller.abort();
  const deadline = setTimeout(() => {
    controller.abort();
    console.log(JSON.stringify({ ok: false, version, code: "preparation-timeout" }));
    process.exit(1);
  }, deadlineMs);
  deadline.unref();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    await client.connect();
    const result = await prepareDuoGateSupplement(client.db(), { signal: controller.signal, batch });
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
  } finally {
    clearTimeout(deadline);
    process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
    await client.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await duoGateSupplementMain().catch(() => {
    const version = Object.values(SUPPLEMENT_BATCHES).find(batch => batch.argument === process.argv[2])?.version ?? SUPPLEMENT_VERSION;
    console.log(JSON.stringify({ ok: false, version, code: "preparation-unavailable" }));
    process.exitCode = 1;
  });
