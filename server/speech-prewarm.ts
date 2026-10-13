import { createHash, randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { buildSpeechScript } from "../shared/speech-script";
import type { ContentSection } from "../shared/types";
import { ApiError } from "./errors";
import { SpeechAudioCache, SpeechProviderError, speechCapabilities, speechSectionFingerprint } from "./speech-audio";
import type { Database } from "./storage";

const COLLECTION = "speech_bank_prewarm";
const LEASE_MS = 90_000;
const MAX_RETRY_DELAY_MS = 5 * 60_000;
const OWNED_TEST_DATABASE = /^ielts_prewarm_test_\d+_[a-f0-9]{32}$/;
type ErrorCode = "auth" | "quota" | "rate-limit" | "unavailable" | "invalid" | "storage" | "interrupted";
type BankState = "pending" | "running" | "complete" | "paused" | "unconfigured";

interface Manifest {
  _id: string;
  state: BankState | "ready" | "failed";
  total?: number;
  ready?: number;
  failed?: number;
  attempts?: number;
  retryable?: boolean;
  nextAttemptAt?: Date;
  lastErrorCode?: ErrorCode;
  owner?: string;
  leaseExpiresAt?: Date;
  updatedAt: Date;
}

export interface SpeechPrewarmStatus {
  configured: boolean;
  state: BankState;
  total: number;
  ready: number;
  pending: number;
  failed: number;
  updatedAt?: string;
  lastErrorCode?: ErrorCode;
}

export interface SpeechPrewarmOptions {
  /** Production uses ielts_ai; tests must explicitly name an owned random DB. */
  expectedDatabase?: string;
  /** A pass is bounded even when newly authored material keeps arriving. */
  maxClips?: number;
  maxRetries?: number;
  resume?: boolean;
  signal?: AbortSignal;
  onProgress?: (status: SpeechPrewarmStatus) => void;
}

function assertDatabase(db: Db, expected = "ielts_ai"): void {
  if (db.databaseName !== expected || (expected !== "ielts_ai" && !OWNED_TEST_DATABASE.test(expected)))
    throw new Error("Speech pregeneration requires the exact IELTS database or an explicitly owned synthetic test database.");
}

function statusOf(manifest: Manifest | null, configured = speechCapabilities().configured): SpeechPrewarmStatus {
  const total = manifest?.total ?? 0, ready = manifest?.ready ?? 0, failed = manifest?.failed ?? 0;
  return {
    configured, state: configured ? (manifest?.state as BankState || "pending") : "unconfigured",
    total, ready, pending: Math.max(0, total - ready - failed), failed,
    ...(manifest?.updatedAt ? { updatedAt: manifest.updatedAt.toISOString() } : {}),
    ...(manifest?.lastErrorCode ? { lastErrorCode: manifest.lastErrorCode } : {}),
  };
}

/** A single metadata lookup: no index creation, download, synthesis or writes. */
export async function readSpeechPrewarmStatus(db: Db): Promise<SpeechPrewarmStatus> {
  return statusOf(await db.collection<Manifest>(COLLECTION).findOne({ _id: "bank" }));
}

/** Only public authored sources are scanned; projections exclude answers. */
async function* authoredSections(db: Db): AsyncGenerator<ContentSection> {
  // Prepare lower-band lessons before mocks, so early practice becomes ready
  // while the rest of the bank is still being synthesized.
  for (const filter of [{ skill: "listening", format: "lesson" }, { skill: "listening", format: { $ne: "lesson" } }]) {
    const content = db.collection("content").find(filter, {
      projection: { _id: 0, "sections.id": 1, "sections.text": 1, "sections.dialogue": 1 },
    }).sort({ band: 1, _id: 1 }).batchSize(24);
    try {
      for await (const document of content) {
        if (!Array.isArray(document.sections)) continue;
        for (const section of document.sections) yield { ...section, title: "" } as ContentSection;
      }
    } finally { await content.close(); }
  }
  const placement = db.collection("placementItems").find({ skill: "listening" }, {
    projection: { _id: 0, id: 1, text: 1 },
  }).sort({ band: 1, _id: 1 }).batchSize(24);
  try {
    for await (const item of placement) yield { id: item.id, title: "", text: item.text } as ContentSection;
  } finally { await placement.close(); }
}

function fingerprint(section: ContentSection, configured: boolean): { key: string; valid: boolean } {
  // A read-only, unconfigured inspection still counts distinct authored scripts.
  // This fallback is never used for writes or paid generation.
  try {
    return { key: configured ? speechSectionFingerprint(section)
      : createHash("sha256").update(JSON.stringify(buildSpeechScript([section]))).digest("hex"), valid: true };
  } catch (error) {
    if (error instanceof ApiError && error.status !== 400) throw error;
    // Invalid newly authored content must not block the rest of the bank. This
    // hash identifies its failed manifest entry; it can never be synthesized.
    return { key: `invalid-${createHash("sha256").update(JSON.stringify({ text: section.text, dialogue: section.dialogue })).digest("hex")}`, valid: false };
  }
}

async function inspect(db: Db, cache: SpeechAudioCache, writeManifest = false, signal?: AbortSignal): Promise<SpeechPrewarmStatus> {
  const configured = speechCapabilities().configured, seen = new Set<string>();
  const collection = db.collection<Manifest>(COLLECTION);
  let ready = 0, failed = 0;
  for await (const section of authoredSections(db)) {
    if (signal?.aborted) break;
    const { key, valid } = fingerprint(section, configured);
    if (seen.has(key)) continue;
    seen.add(key);
    const available = configured && valid && (await cache.readiness([section])).ready;
    const old = await collection.findOne({ _id: `clip:${key}` });
    if (available) ready++;
    if (!available && ((!valid && configured) || old?.state === "failed")) failed++;
    if (writeManifest) {
      await collection.updateOne({ _id: `clip:${key}` }, {
        $set: { state: available ? "ready" : !valid || old?.state === "failed" ? "failed" : "pending", updatedAt: new Date(),
          ...(!valid ? { lastErrorCode: "invalid", retryable: false } : {}),
        },
        $setOnInsert: { attempts: 0 },
        ...(available ? { $unset: { lastErrorCode: "", nextAttemptAt: "", retryable: "" } } : {}),
      }, { upsert: true });
    }
  }
  return { configured, state: !configured ? "unconfigured" : ready === seen.size ? "complete" : "pending", total: seen.size, ready, pending: Math.max(0, seen.size - ready - failed), failed };
}

/** Inspect all current content/variants and placement, without writing anything. */
export async function inspectSpeechBank(db: Db, options: Pick<SpeechPrewarmOptions, "expectedDatabase" | "signal"> = {}): Promise<SpeechPrewarmStatus> {
  assertDatabase(db, options.expectedDatabase);
  const status = await inspect(db, new SpeechAudioCache({ db } as Database), false, options.signal);
  const previous = await db.collection<Manifest>(COLLECTION).findOne({ _id: "bank" });
  if (status.configured && previous?.state === "paused") {
    status.state = "paused";
    if (previous.lastErrorCode) status.lastErrorCode = previous.lastErrorCode;
  }
  return status;
}

function failure(error: unknown): { code: ErrorCode; retryable: boolean; pause: boolean; retryAfterMs?: number } {
  if (error instanceof SpeechProviderError) return {
    code: error.kind, retryable: ["rate-limit", "unavailable"].includes(error.kind),
    pause: ["auth", "quota"].includes(error.kind), retryAfterMs: error.retryAfterMs,
  };
  if (error instanceof ApiError && [502, 503, 504].includes(error.status)) return { code: "storage", retryable: true, pause: false };
  // Never persist a thrown message: it may contain a URI, key or response body.
  return { code: "invalid", retryable: false, pause: false };
}

/** Interruptible waits avoid a shutdown waiting for an entire backoff period. */
async function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  await new Promise<void>(resolve => {
    const done = () => { clearTimeout(timer); signal?.removeEventListener("abort", done); resolve(); };
    const timer = setTimeout(done, milliseconds);
    signal?.addEventListener("abort", done, { once: true });
  });
}

function retryDelay(retry: number, retryAfterMs?: number): number {
  const exponential = Math.min(MAX_RETRY_DELAY_MS, 30_000 * 2 ** retry);
  return Math.min(MAX_RETRY_DELAY_MS, Math.max(exponential + Math.floor(Math.random() * exponential * .2), retryAfterMs ?? 0));
}

/**
 * Resumable administrative worker. Successful sections/turns remain in the
 * generic cache. The manifest contains hashes, counts and safe error codes only.
 * The bank lease prevents two worker services from processing different clips
 * simultaneously; per-audio claims also protect publishing across processes.
 */
export async function runSpeechBankPrewarm(db: Db, options: SpeechPrewarmOptions = {}): Promise<SpeechPrewarmStatus> {
  assertDatabase(db, options.expectedDatabase);
  const maxClips = options.maxClips ?? 32, maxRetries = options.maxRetries ?? 3;
  if (!Number.isSafeInteger(maxClips) || maxClips < 1 || maxClips > 4096 || !Number.isSafeInteger(maxRetries) || maxRetries < 0 || maxRetries > 5)
    throw new Error("Speech pregeneration bounds require 1–4096 clips and 0–5 retries per pass.");
  const cache = new SpeechAudioCache({ db } as Database);
  if (!speechCapabilities().configured) return inspect(db, cache, false, options.signal);
  const collection = db.collection<Manifest>(COLLECTION);
  const previous = await collection.findOne({ _id: "bank" });
  if (previous?.state === "paused" && !options.resume) return statusOf(previous);
  const owner = randomUUID(), now = new Date();
  if (!previous) {
    try { await collection.insertOne({ _id: "bank", state: "pending", total: 0, ready: 0, failed: 0, updatedAt: now }); }
    catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === 11000)) throw error; }
  }
  const claim = await collection.findOneAndUpdate({ _id: "bank", ...(options.resume ? {} : { state: { $ne: "paused" } }),
    $or: [{ leaseExpiresAt: { $lte: now } }, { owner: { $exists: false } }],
  }, { $set: { state: "running", owner, leaseExpiresAt: new Date(now.getTime() + LEASE_MS), updatedAt: now },
    $unset: { lastErrorCode: "" },
  }, { returnDocument: "after" });
  if (!claim) return readSpeechPrewarmStatus(db);
  const interrupted = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, interrupted.signal]) : interrupted.signal;
  let heartbeatRunning = false, result = statusOf(claim);
  const heartbeat = setInterval(() => {
    if (heartbeatRunning) return;
    heartbeatRunning = true;
    void collection.updateOne({ _id: "bank", owner }, { $set: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) } })
      .then(update => { if (!update.matchedCount) interrupted.abort(); }, () => interrupted.abort())
      .finally(() => { heartbeatRunning = false; });
  }, LEASE_MS / 3);
  heartbeat.unref();
  const publish = async (state: BankState) => {
    result.state = state; result.updatedAt = new Date().toISOString();
    result.pending = Math.max(0, result.total - result.ready - result.failed);
    const { total, ready, failed, lastErrorCode } = result;
    const saved = await collection.updateOne({ _id: "bank", owner }, {
      $set: { state, total, ready, failed, updatedAt: new Date(), ...(lastErrorCode ? { lastErrorCode } : {}) },
      ...(!lastErrorCode ? { $unset: { lastErrorCode: "" } } : {}),
    });
    if (!saved.matchedCount) interrupted.abort();
    options.onProgress?.({ ...result });
  };
  try {
    result = await inspect(db, cache, true, signal);
    await publish("running");
    const seen = new Set<string>(); let processed = 0;
    for await (const section of authoredSections(db)) {
      if (signal.aborted || processed >= maxClips) break;
      const { key, valid } = fingerprint(section, true);
      if (!valid) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      const record = await collection.findOne({ _id: `clip:${key}` });
      // Authored inserts during a long pass are included in the next full scan.
      if (!record) continue;
      if ((await cache.readiness([section])).ready) continue;
      if (record?.state === "failed" && !options.resume && (!record.retryable || (record.nextAttemptAt && record.nextAttemptAt.getTime() > Date.now()))) continue;
      processed++;
      if (record?.state === "failed") result.failed--;
      let completed = false;
      for (let retry = 0; retry <= maxRetries && !signal.aborted; retry++) {
        await collection.updateOne({ _id: `clip:${key}` }, {
          $set: { state: "running", updatedAt: new Date() }, $inc: { attempts: 1 },
        });
        try {
          await cache.get([section], signal);
          await collection.updateOne({ _id: `clip:${key}` }, {
            $set: { state: "ready", updatedAt: new Date() },
            $unset: { lastErrorCode: "", nextAttemptAt: "", retryable: "" },
          });
          result.ready++; completed = true; delete result.lastErrorCode;
          await publish("running"); break;
        } catch (error) {
          const classification = signal.aborted ? { code: "interrupted" as const, retryable: true, pause: false } : failure(error);
          result.lastErrorCode = classification.code;
          const exhausted = retry === maxRetries || !classification.retryable || classification.pause || signal.aborted;
          await collection.updateOne({ _id: `clip:${key}` }, {
            $set: { state: exhausted && !signal.aborted ? "failed" : "pending", lastErrorCode: classification.code,
              retryable: classification.retryable, updatedAt: new Date(),
              ...(classification.retryable ? { nextAttemptAt: new Date(Date.now() + retryDelay(retry, classification.retryAfterMs)) } : {}),
            },
          });
          if (exhausted) {
            if (!signal.aborted) result.failed++;
            await publish(classification.pause ? "paused" : "running");
            if (classification.pause) return { ...result };
            break;
          }
          await publish("running");
          await delay(retryDelay(retry, classification.retryAfterMs), signal);
        }
      }
      if (!completed && signal.aborted) break;
      // Rate/concurrency cap is intentionally independent of the app process.
      await delay(1000, signal);
    }
    await publish(result.ready === result.total && !signal.aborted ? "complete" : "pending");
    return { ...result };
  } catch {
    // Transport exceptions are sanitized and the lease is always released.
    result.lastErrorCode = signal.aborted ? "interrupted" : "storage";
    await publish("pending").catch(() => undefined);
    return { ...result };
  } finally {
    clearInterval(heartbeat);
    await collection.updateOne({ _id: "bank", owner }, { $unset: { owner: "", leaseExpiresAt: "" } }).catch(() => undefined);
  }
}

/** A long-lived, bounded service discovers newly authored scripts each cycle. */
export async function watchSpeechBankPrewarm(db: Db, options: SpeechPrewarmOptions & { intervalMs?: number } = {}): Promise<void> {
  const interval = options.intervalMs ?? 60_000;
  if (!Number.isSafeInteger(interval) || interval < 1000 || interval > 3_600_000) throw new Error("Speech pregeneration scan interval must be 1–3600 seconds.");
  let resume = options.resume;
  while (!options.signal?.aborted) {
    await runSpeechBankPrewarm(db, { ...options, resume });
    resume = false;
    await delay(interval, options.signal);
  }
}
