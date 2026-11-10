import { MongoClient, type Db } from "mongodb";
import { pathToFileURL } from "node:url";
import { buildSpeechScript, chunkSpeechTurns } from "../shared/speech-script";
import { loadDuoCredentials } from "./duo-auth";
import { ensureDuoGateSupplement } from "./duo-exam-content";
import { newDuoGatePapers, NEW_DUO_GATE_LISTENING_IDS, SUPPLEMENT_VERSION } from "./data/duo-gate-supplement";
import { activateProviderConfig } from "./provider-config";
import { SpeechAudioCache, speechCapabilities, speechSectionFingerprint } from "./speech-audio";
import { SpeechGenerationBudget } from "./speech-budget";
import type { Database } from "./storage";

const LEDGER_COLLECTION = "duo_gate_audio_supplements";
const MAX_REQUESTS = 3;
const MAX_INPUT_CHARACTERS = 9000;
const PER_CLIP_CHARACTERS = MAX_INPUT_CHARACTERS / MAX_REQUESTS;
const DEADLINE_MS = 180_000;
const METADATA_TIMEOUT_MS = 8000;
const OWNED_TEST_DATABASE = /^ielts_gate_supplement_test_[a-f0-9]{32}$/;

interface Ledger {
  _id: string;
  targets: { id: string; fingerprint: string }[];
  attemptedIds: string[];
  requestsReserved: number;
  inputCharactersReserved: number;
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

/** Prepare only the three authored band-3 Gate recordings. A durable reservation
 * is consumed before each first attempt and is never refunded, even on timeout
 * or an ambiguous response. A subsequent run may assemble saved turns with a
 * zero budget, but cannot buy a second attempt for that clip. */
export async function prepareDuoGateSupplement(db: Db, options: { expectedDatabase?: string; signal?: AbortSignal } = {}): Promise<DuoGateSupplementResult> {
  const expected = options.expectedDatabase ?? "ielts_ai";
  if (db.databaseName !== expected || expected !== "ielts_ai" && !OWNED_TEST_DATABASE.test(expected))
    throw new Error("Supplement preparation requires the installation or an owned synthetic database.");
  const ids: string[] = [...NEW_DUO_GATE_LISTENING_IDS];
  const papers = newDuoGatePapers().filter(paper => ids.includes(paper.id));
  if (ids.length !== MAX_REQUESTS || new Set(ids).size !== MAX_REQUESTS || papers.length !== MAX_REQUESTS ||
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
  const timer = setTimeout(() => controller.abort(), DEADLINE_MS);
  timer.unref();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const budget = new SpeechGenerationBudget({ maxProviderRequests: MAX_REQUESTS, maxInputCharacters: MAX_INPUT_CHARACTERS });
  const cache = new SpeechAudioCache({ db } as Database);
  let ready = 0;
  const report = (): DuoGateSupplementResult => {
    const usage = budget.snapshot();
    return { ok: ready === MAX_REQUESTS && !signal.aborted, version: SUPPLEMENT_VERSION, total: MAX_REQUESTS, ready,
      providerRequests: usage.providerRequests, maxProviderRequests: MAX_REQUESTS,
      inputCharacters: usage.inputCharacters, maxInputCharacters: MAX_INPUT_CHARACTERS };
  };
  try {
    if (signal.aborted) return report();
    await ensureDuoGateSupplement({ db });
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
        await ledger.insertOne({ _id: SUPPLEMENT_VERSION, targets, attemptedIds: [], requestsReserved: 0,
          inputCharactersReserved: 0, createdAt: now, updatedAt: now }, { timeoutMS: METADATA_TIMEOUT_MS });
      } catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === 11000)) throw error;
      }
      const previous = await ledger.findOne({ _id: SUPPLEMENT_VERSION }, { timeoutMS: METADATA_TIMEOUT_MS });
      if (!previous || JSON.stringify(previous.targets) !== JSON.stringify(targets) ||
          !Array.isArray(previous.attemptedIds) || new Set(previous.attemptedIds).size !== previous.attemptedIds.length ||
          previous.attemptedIds.some(id => !ids.includes(id)) ||
          previous.requestsReserved !== previous.attemptedIds.length || previous.requestsReserved > MAX_REQUESTS ||
          previous.inputCharactersReserved !== previous.requestsReserved * PER_CLIP_CHARACTERS)
        throw new Error("Supplement allowance metadata is invalid.");
      const reserved = await ledger.updateOne({ _id: SUPPLEMENT_VERSION, targets,
        attemptedIds: { $ne: paper.id }, requestsReserved: { $lt: MAX_REQUESTS },
        inputCharactersReserved: { $lte: MAX_INPUT_CHARACTERS - PER_CLIP_CHARACTERS },
      }, { $addToSet: { attemptedIds: paper.id }, $inc: { requestsReserved: 1, inputCharactersReserved: PER_CLIP_CHARACTERS },
        $set: { updatedAt: now } }, { timeoutMS: METADATA_TIMEOUT_MS });
      // A spent reservation permits cache recovery only. No implicit paid retry.
      await cache.get(paper.sections, signal, reserved.modifiedCount ? new ClipBudget(budget) : new SpeechGenerationBudget());
      await cache.getReady(paper.sections);
      ready++;
    }
    return report();
  } catch {
    // Only counts leave this worker; raw Mongo/provider errors remain private.
    return report();
  } finally { clearTimeout(timer); }
}

export async function duoGateSupplementMain(args = process.argv.slice(2)): Promise<void> {
  if (args.length !== 1 || args[0] !== "--prepare" || process.env.APP_ORIGIN !== "https://sutonghanyu.vn" ||
      process.env.MONGODB_URI !== "mongodb://mongo:27017/ielts_ai")
    throw new Error("Supplement requires the explicit bounded prepare mode at its installation.");
  activateProviderConfig(loadDuoCredentials());
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: METADATA_TIMEOUT_MS,
    connectTimeoutMS: METADATA_TIMEOUT_MS, maxPoolSize: 2 });
  const controller = new AbortController(), stop = () => controller.abort();
  const deadline = setTimeout(() => {
    controller.abort();
    console.log(JSON.stringify({ ok: false, version: SUPPLEMENT_VERSION, code: "preparation-timeout" }));
    process.exit(1);
  }, DEADLINE_MS);
  deadline.unref();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    await client.connect();
    const result = await prepareDuoGateSupplement(client.db(), { signal: controller.signal });
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
    console.log(JSON.stringify({ ok: false, version: SUPPLEMENT_VERSION, code: "preparation-unavailable" }));
    process.exitCode = 1;
  });
