import { createHash, randomUUID } from "node:crypto";
import { GridFSBucket, MongoGridFSChunkError, type Collection, type GridFSFile, ObjectId } from "mongodb";
import type { ContentSection } from "../shared/types";
import { buildSpeechScript, chunkSpeechTurns, type SpeechTurn } from "../shared/speech-script";
import { ApiError } from "./errors";
import type { Database } from "./storage";

type Provider = "openai" | "elevenlabs";
export interface SpeechAudioResult {
  buffer: Buffer;
  mimetype: string;
  provider: Provider;
  voiceCount: number;
}
// Keep this list/version in the fingerprint: changing a cast must invalidate audio.
const OPENAI_VOICES = ["coral", "ash", "sage", "verse", "onyx", "nova", "alloy", "ballad", "echo", "fable", "shimmer"] as const;
const OPENAI_MODEL = "gpt-4o-mini-tts";
const AUDIO_VERSION = "ielts-section-pcm16-v3";
const MAX_AUDIO_BYTES = 64 * 1024 * 1024;
const MAX_SCRIPT_CHARACTERS = 40_000;
const MAX_SCRIPT_TURNS = 240;
const TURN_GAP_BYTES = 16_000 * 2 * 0.2;
const REQUEST_TIMEOUT_MS = 120_000;
const GENERATION_TIMEOUT_MS = 15 * 60_000;
const LEASE_MS = 45_000;
const POLL_MS = 250;
const CACHE_METADATA_TIMEOUT_MS = 5_000;
const CACHE_DOWNLOAD_TIMEOUT_MS = 20_000;
const WORKER_METADATA_TIMEOUT_MS = 20_000;
const WORKER_STREAM_TIMEOUT_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;

export type SpeechFailureStage = "provider-request" | "provider-response" | "generation" | "claim-wait"
  | "cache-initialize" | "cache-metadata" | "cache-read" | "cache-write" | "cache-publish"
  | "lease-renew" | "lease-heartbeat" | "bank-scan" | "bank-metadata" | "bank-publish";

/** Safe operational categories; never retain driver/provider messages or bodies. */
export class SpeechCacheError extends ApiError {
  constructor(public readonly kind: "storage" | "lease-lost" | "interrupted" | "claim-timeout", public readonly stage: SpeechFailureStage) {
    super(kind === "claim-timeout" ? 504 : 503, kind === "storage"
      ? stage === "cache-metadata" ? "Không thể kiểm tra audio lúc này. Vui lòng thử lại sau."
        : stage === "cache-read" ? "Không thể tải audio lúc này. Vui lòng thử lại sau."
          : "Không thể lưu audio lúc này. Vui lòng thử lại sau."
      : kind === "claim-timeout" ? "Audio đang được tạo. Vui lòng thử lại sau."
        : "Tạo audio bị gián đoạn. Vui lòng thử lại sau.");
  }
}

export async function speechStorageOperation<T>(stage: SpeechFailureStage, work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) { if (error instanceof SpeechCacheError) throw error; throw new SpeechCacheError("storage", stage); }
}

function interrupted(signal?: AbortSignal, stage: SpeechFailureStage = "generation"): SpeechCacheError {
  return signal?.reason instanceof SpeechCacheError ? signal.reason : new SpeechCacheError("interrupted", stage);
}

interface Configuration { provider: Provider; key: string; voices: string[]; model: string }
interface VoicedTurn extends SpeechTurn { voice: string; delivery: string }
interface Plan { configuration: Configuration; turns: VoicedTurn[]; fingerprint: string; voiceCount: number; voiceIds: string[] }
export interface SpeechAudioReadiness {
  configured: boolean;
  ready: boolean;
  state: "ready" | "pending" | "disabled";
  notice: string;
  readyCount: number;
  totalCount: number;
}
const PREPARATION_NOTICE = "Audio đang được chuẩn bị trước. Vui lòng quay lại sau khi bài nghe đã sẵn sàng.";

function configuration(): Configuration | null {
  const openAIKey = process.env.IELTS_OPENAI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (openAIKey) return { provider: "openai", key: openAIKey, voices: [...OPENAI_VOICES], model: OPENAI_MODEL };
  const key = process.env.ELEVENLABS_API_KEY?.trim();
  const voices = [process.env.ELEVENLABS_VOICE_BRITISH, process.env.ELEVENLABS_VOICE_AMERICAN, process.env.ELEVENLABS_VOICE_AUSTRALIAN].map(value => value?.trim() || "");
  if (key && voices.every(Boolean) && new Set(voices).size === voices.length)
    return { provider: "elevenlabs", key, voices, model: process.env.ELEVENLABS_MODEL?.trim() || "eleven_v3" };
  return null;
}

/** Configuration only; this never makes a paid request or writes to MongoDB. */
export function speechCapabilities(): { configured: boolean; provider: Provider | null; voiceCount: number } {
  const config = configuration();
  return { configured: Boolean(config), provider: config?.provider ?? null, voiceCount: config?.voices.length ?? 0 };
}

function deliveryFor(speaker: string): string {
  if (/\b(teacher|lecturer|professor|tutor)\b/iu.test(speaker))
    return "Use a clear, professional and encouraging delivery.";
  if (/\b(receptionist|assistant|clerk|officer|agent|guide|server|waiter|waitress)\b/iu.test(speaker))
    return "Use a polite, helpful and professional conversational delivery.";
  if (/\b(child)\b/iu.test(speaker)) return "Use a gentle and lively conversational delivery without exaggeration.";
  if (/\b(student|pupil)\b/iu.test(speaker)) return "Use a relaxed, curious and natural conversational delivery.";
  return "Use a calm, natural conversational delivery.";
}

function checkScript(script: SpeechTurn[]): void {
  const characters = script.reduce((sum, turn) => sum + turn.text.length, 0);
  if (!script.length || !characters || characters > MAX_SCRIPT_CHARACTERS || script.length > MAX_SCRIPT_TURNS)
    throw new ApiError(400, "Script audio rỗng hoặc vượt giới hạn một lần tạo.");
}

function sectionPlan(section: ContentSection, config: Configuration): Plan {
  // Parsing one scene gives actors local normalized identities. Authored IDs,
  // titles and the scene's position in a future exam never affect acoustics.
  const script = buildSpeechScript([section]);
  checkScript(script);
  const seed = JSON.stringify(script.map(({ speakerId, accent, text, speaker }) => ({ speakerId, accent, text, delivery: deliveryFor(speaker) })));
  const cast = new Map<string, string>();
  const available = [...config.voices];
  for (const turn of script) {
    if (cast.has(turn.speakerId)) continue;
    if (!available.length) throw new ApiError(400, "Bài nghe có nhiều nhân vật hơn số giọng đọc đã cấu hình.");
    // ElevenLabs accents provide a preference, never an identity. A second
    // British actor gets a different configured voice, rather than the first.
    const preferred = config.provider === "elevenlabs" ? config.voices[["british", "american", "australian"].indexOf(turn.accent)] : undefined;
    const identity = `${seed}\0${turn.speakerId}`;
    const index = config.provider === "openai"
      ? createHash("sha256").update(identity).digest().readUInt32BE(0) % available.length
      : preferred && available.includes(preferred) ? available.indexOf(preferred) : 0;
    cast.set(turn.speakerId, available.splice(index, 1)[0]);
  }
  const turns = chunkSpeechTurns(script, 3000).map(turn => ({ ...turn, voice: cast.get(turn.speakerId)!, delivery: deliveryFor(turn.speaker) }));
  if (!turns.length || turns.some(turn => !turn.text.trim() || turn.text.length > 3000 || !turn.voice))
    throw new ApiError(400, "Script audio không hợp lệ.");
  const fingerprint = createHash("sha256").update(JSON.stringify({
    version: AUDIO_VERSION, provider: config.provider, model: config.model,
    turns: turns.map(({ speakerId, accent, text, voice, delivery }) => ({ speakerId, accent, text, voice, delivery })),
  })).digest("hex");
  const voiceIds = [...new Set(cast.values())].sort();
  return { configuration: config, turns, fingerprint, voiceCount: voiceIds.length, voiceIds };
}

function makePlans(sections: ContentSection[]): Plan[] {
  const config = configuration();
  if (!config) throw new ApiError(503, "Chưa cấu hình dịch vụ tạo audio. Cần OpenAI hoặc ElevenLabs với ba giọng đọc khác nhau.");
  if (!sections.length) throw new ApiError(400, "Script audio rỗng hoặc vượt giới hạn một lần tạo.");
  return sections.map(section => sectionPlan(section, config));
}

function makePlan(sections: ContentSection[]): Plan {
  checkScript(buildSpeechScript(sections));
  const plans = makePlans(sections), voiceIds = [...new Set(plans.flatMap(plan => plan.voiceIds))].sort();
  return {
    configuration: plans[0].configuration,
    turns: plans.flatMap((plan, sectionIndex) => plan.turns.map(turn => ({ ...turn, sectionIndex, speakerId: `${sectionIndex}:${turn.speakerId}` }))),
    fingerprint: createHash("sha256").update(JSON.stringify(plans.map(plan => plan.fingerprint))).digest("hex"),
    voiceIds, voiceCount: voiceIds.length,
  };
}

export function speechSectionFingerprint(section: ContentSection): string {
  return makePlans([section])[0].fingerprint;
}

// A process may have many HTTP requests, but only one synthesis job can hold
// PCM chunks in memory. Failed jobs release the queue as well.
let generationTail: Promise<void> = Promise.resolve();
async function withGenerationSlot<T>(work: () => Promise<T>): Promise<T> {
  const previous = generationTail;
  let release!: () => void;
  generationTail = new Promise<void>(resolve => { release = resolve; });
  await previous;
  try { return await work(); } finally { release(); }
}

export class SpeechProviderError extends ApiError {
  constructor(status: number, message: string, public readonly kind: "auth" | "quota" | "rate-limit" | "unavailable" | "invalid" | "provider-timeout", public readonly retryAfterMs?: number,
    public readonly stage: SpeechFailureStage = "provider-request") {
    super(status, message);
  }
}

function providerError(provider: Provider, status?: number, quota = false, retryAfterMs?: number, stage: SpeechFailureStage = "provider-response"): SpeechProviderError {
  const label = provider === "openai" ? "OpenAI" : "ElevenLabs";
  if (status === 401 || status === 403) return new SpeechProviderError(503, `${label} chưa chấp nhận cấu hình audio. Vui lòng kiểm tra khóa và quyền truy cập dịch vụ.`, "auth", undefined, stage);
  if (status === 402 || quota) return new SpeechProviderError(503, `${label} đã hết hạn mức audio. Vui lòng kiểm tra hạn mức dịch vụ.`, "quota", undefined, stage);
  if (status === 429) return new SpeechProviderError(503, `${label} đang giới hạn yêu cầu audio. Vui lòng thử lại sau.`, "rate-limit", retryAfterMs, stage);
  return new SpeechProviderError(502, `${label} chưa trả về audio hợp lệ. Vui lòng thử lại sau.`, status === undefined ? "invalid" : "unavailable", undefined, stage);
}

async function responseError(provider: Provider, response: Response, signal: AbortSignal): Promise<SpeechProviderError> {
  let quota = false;
  if (response.status === 429 && response.body) {
    // Inspect only bounded error codes to distinguish exhausted billing from a
    // transient rate limit. Provider bodies never enter errors, logs or Mongo.
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    const cancel = () => { void reader.cancel().catch(() => undefined); };
    signal.addEventListener("abort", cancel, { once: true });
    let bytes = 0;
    try {
      while (bytes <= 8192 && !signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 8192) break;
        chunks.push(value);
      }
      if (bytes <= 8192) {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { error?: { code?: unknown; type?: unknown }; detail?: { status?: unknown } };
        quota = [body.error?.code, body.error?.type, body.detail?.status].some(code => typeof code === "string" && /^(?:insufficient_quota|quota_exceeded|billing_hard_limit_reached|payment_required|credits_exhausted)$/u.test(code));
      }
    } catch { /* Unrecognized bodies remain transient and private. */ }
    finally { signal.removeEventListener("abort", cancel); await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  } else await response.body?.cancel().catch(() => undefined);
  const retry = response.headers.get("retry-after");
  const delay = retry === null ? NaN : /^\d+(?:\.\d+)?$/u.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now();
  return providerError(provider, response.status, quota, Number.isFinite(delay) ? Math.max(1000, Math.min(300_000, delay)) : undefined);
}

function wavHeader(dataBytes: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(dataBytes + 36, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16_000, 24); header.writeUInt32LE(32_000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(dataBytes, 40);
  return header;
}

function validWav(buffer: Buffer): boolean {
  return buffer.length > 44 && buffer.length <= MAX_AUDIO_BYTES && buffer.toString("ascii", 0, 4) === "RIFF"
    && buffer.toString("ascii", 8, 16) === "WAVEfmt " && buffer.readUInt32LE(4) === buffer.length - 8
    && buffer.readUInt32LE(16) === 16 && buffer.readUInt16LE(20) === 1 && buffer.readUInt16LE(22) === 1
    && buffer.readUInt32LE(24) === 16_000 && buffer.readUInt32LE(28) === 32_000
    && buffer.readUInt16LE(32) === 2 && buffer.readUInt16LE(34) === 16
    && buffer.toString("ascii", 36, 40) === "data" && buffer.readUInt32LE(40) === buffer.length - 44
    && (buffer.length - 44) % 2 === 0;
}

/** Consume 24 kHz mono signed 16-bit PCM without retaining a second raw file. */
async function appendResampledPcm(response: Response, signal: AbortSignal, append: (chunk: Buffer) => void, remainingBytes: () => number, provider: Provider): Promise<void> {
  const type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (!response.body || !["application/octet-stream", "audio/pcm", "audio/raw"].includes(type ?? "")) {
    await response.body?.cancel().catch(() => undefined);
    throw providerError(provider);
  }
  const advertised = response.headers.get("content-length");
  const maxRawBytes = Math.ceil(remainingBytes() * 1.5) + 4;
  if (advertised !== null && (!/^\d+$/.test(advertised) || Number(advertised) <= 0 || Number(advertised) > maxRawBytes || Number(advertised) % 2)) {
    await response.body.cancel().catch(() => undefined);
    throw providerError(provider);
  }
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  let pendingByte: number | undefined, sampleIndex = 0, nextNumerator = 0, previous = 0, rawBytes = 0;
  let block = Buffer.allocUnsafe(8192), offset = 0;
  const emit = (sample: number) => {
    if (remainingBytes() < offset + 2) throw providerError(provider);
    block.writeInt16LE(sample, offset); offset += 2;
    if (offset === block.length) { append(block); block = Buffer.allocUnsafe(8192); offset = 0; }
  };
  const consume = (sample: number) => {
    if (nextNumerator === sampleIndex * 2) { emit(sample); nextNumerator += 3; }
    else if (nextNumerator === sampleIndex * 2 - 1) { emit(Math.round((previous + sample) / 2)); nextNumerator += 3; }
    previous = sample; sampleIndex++;
  };
  try {
    if (signal.aborted) throw new ApiError(504, "Tạo audio mất quá lâu. Vui lòng thử lại sau.");
    while (true) {
      const { value, done } = await reader.read();
      if (signal.aborted) throw new ApiError(504, "Tạo audio mất quá lâu. Vui lòng thử lại sau.");
      if (done) break;
      rawBytes += value.byteLength;
      if (rawBytes > maxRawBytes) throw providerError(provider);
      for (const byte of value) {
        if (pendingByte === undefined) pendingByte = byte;
        else { const unsigned = pendingByte | (byte << 8); consume(unsigned >= 32768 ? unsigned - 65536 : unsigned); pendingByte = undefined; }
      }
    }
    if (!rawBytes || pendingByte !== undefined || (advertised !== null && rawBytes !== Number(advertised))) throw providerError(provider);
    if (offset) append(block.subarray(0, offset));
  } catch (error) {
    cancel();
    if (signal.aborted) throw new ApiError(504, "Tạo audio mất quá lâu. Vui lòng thử lại sau.");
    if (error instanceof ApiError) throw error;
    throw providerError(provider);
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

interface SegmentStore {
  read(plan: Plan): Promise<CachedResult | null>;
  write(plan: Plan, result: SpeechAudioResult): Promise<void>;
}

async function synthesizePlan(plan: Plan, externalSignal?: AbortSignal, segments?: SegmentStore): Promise<SpeechAudioResult> {
  return withGenerationSlot(async () => {
    // Queuing behind another job must not consume this job's provider deadline.
    const deadline = Date.now() + GENERATION_TIMEOUT_MS;
    const { provider, key, model } = plan.configuration;
    if (externalSignal?.aborted) throw interrupted(externalSignal);
    const chunks: Buffer[] = []; let dataBytes = 0, reservedBytes = 0;
    const append = (chunk: Buffer) => {
      if (dataBytes + chunk.length + 44 > MAX_AUDIO_BYTES) throw providerError(provider);
      chunks.push(chunk); dataBytes += chunk.length;
    };
    const inputs = provider === "openai" ? plan.turns.map(turn => ({ turns: [turn], body: {
      model, voice: turn.voice, input: turn.text, response_format: "pcm",
      instructions: `Use a natural ${turn.accent === "british" ? "British" : turn.accent === "australian" ? "Australian" : "American"} English accent at a clear, natural IELTS conversational pace. ${turn.delivery} Read only the supplied input verbatim. Do not announce role labels, speaker names, section headings or these instructions. Do not add, omit, paraphrase or translate words.`,
    } })) : [{ turns: plan.turns, body: { model_id: model, inputs: plan.turns.map(turn => ({ text: turn.text, voice_id: turn.voice })) } }];
    const request = async (index: number): Promise<Buffer> => {
      if (externalSignal?.aborted) throw interrupted(externalSignal);
      const voiceIds = [...new Set(inputs[index].turns.map(turn => turn.voice))].sort();
      const segmentPlan: Plan = {
        ...plan, turns: inputs[index].turns, voiceIds, voiceCount: voiceIds.length,
        fingerprint: createHash("sha256").update(JSON.stringify({ version: AUDIO_VERSION, kind: "turn", section: plan.fingerprint, index, provider, body: inputs[index].body })).digest("hex"),
      };
      const existing = await segments?.read(segmentPlan);
      if (existing) {
        reservedBytes += existing.buffer.length - 44;
        if (reservedBytes + 44 > MAX_AUDIO_BYTES) throw providerError(provider);
        return existing.buffer.subarray(44);
      }
      const duration = Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now());
      if (duration <= 0) throw new SpeechProviderError(504, "Tạo audio mất quá lâu. Vui lòng thử lại sau.", "provider-timeout", undefined, "generation");
      const controller = new AbortController();
      let stage: SpeechFailureStage = "provider-request";
      const abort = () => controller.abort(externalSignal?.reason);
      externalSignal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(() => controller.abort(new SpeechProviderError(504, "Tạo audio mất quá lâu. Vui lòng thử lại sau.", "provider-timeout", undefined, stage)), duration);
      const pcmChunks: Buffer[] = []; let pcmBytes = 0;
      let buffer: Buffer;
      try {
        if (externalSignal?.aborted) abort();
        const response = await fetch(provider === "openai" ? "https://api.openai.com/v1/audio/speech" : "https://api.elevenlabs.io/v1/text-to-dialogue?output_format=pcm_24000", {
          method: "POST", signal: controller.signal,
          headers: { "Content-Type": "application/json", Accept: "application/octet-stream", ...(provider === "openai" ? { Authorization: `Bearer ${key}` } : { "xi-api-key": key }) },
          body: JSON.stringify(inputs[index].body),
        });
        stage = "provider-response";
        if (!response.ok) throw await responseError(provider, response, controller.signal);
        await appendResampledPcm(response, controller.signal, chunk => {
          if (reservedBytes + chunk.length + 44 > MAX_AUDIO_BYTES) throw providerError(provider);
          pcmChunks.push(chunk); pcmBytes += chunk.length; reservedBytes += chunk.length;
        }, () => MAX_AUDIO_BYTES - 44 - reservedBytes, provider);
        buffer = Buffer.concat([wavHeader(pcmBytes), ...pcmChunks], pcmBytes + 44);
        if (!validWav(buffer)) throw providerError(provider);
      } catch (error) {
        if (externalSignal?.aborted) throw interrupted(externalSignal);
        if (controller.signal.aborted && controller.signal.reason instanceof SpeechProviderError) throw controller.signal.reason;
        if (error instanceof ApiError) throw error;
        throw providerError(provider, 502, false, undefined, stage);
      } finally { clearTimeout(timer); externalSignal?.removeEventListener("abort", abort); }
      // Storage has its own deadline and category, independent of transport.
      await segments?.write(segmentPlan, { buffer, mimetype: "audio/wav", provider, voiceCount: voiceIds.length });
      return buffer.subarray(44);
    };
    // Background generation runs at most two bounded provider turns at once.
    // Await siblings even after an error so completed paid turns are persisted.
    // Direct synthesis retains its legacy serial transport contract.
    const concurrency = segments && provider === "openai" ? 2 : 1;
    for (let base = 0; base < inputs.length; base += concurrency) {
      const outcomes = await Promise.allSettled(Array.from({ length: Math.min(concurrency, inputs.length - base) }, (_, offset) => request(base + offset)));
      const failed = outcomes.find(outcome => outcome.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
      for (let offset = 0; offset < outcomes.length; offset++) {
        const outcome = outcomes[offset];
        if (outcome.status !== "fulfilled") continue;
        append(outcome.value);
        const index = base + offset;
        const current = inputs[index].turns.at(-1), next = inputs[index + 1]?.turns[0];
        if (current && next && (current.speakerId !== next.speakerId || current.sectionIndex !== next.sectionIndex)) {
          append(Buffer.alloc(TURN_GAP_BYTES)); reservedBytes += TURN_GAP_BYTES;
        }
      }
    }
    if (!dataBytes) throw providerError(provider);
    const buffer = Buffer.concat([wavHeader(dataBytes), ...chunks], dataBytes + 44);
    if (!validWav(buffer)) throw providerError(provider);
    return { buffer, mimetype: "audio/wav", provider, voiceCount: plan.voiceCount };
  });
}

export async function synthesizeSpeechAudio(sections: ContentSection[]): Promise<SpeechAudioResult> {
  return synthesizePlan(makePlan(sections));
}

interface AudioJob {
  _id: string;
  state: "generating" | "ready" | "failed";
  owner?: string;
  leaseExpiresAt?: Date;
  fileId?: ObjectId;
  createdAt?: Date;
  completedAt?: Date;
}
type CachedResult = SpeechAudioResult & { cached: boolean };

/** Shared authored audio only. Construction never creates indexes/collections. */
export class SpeechAudioCache {
  private initialization?: Promise<void>;
  private readonly jobs: Collection<AudioJob>;
  private readonly files: Collection<GridFSFile>;
  private readonly bucket: GridFSBucket;
  private readonly inflight = new Map<string, Promise<CachedResult>>();
  constructor(private readonly database: Database) {
    // Handles alone never create collections, indexes or GridFS chunks.
    this.jobs = this.database.db.collection<AudioJob>("speech_audio_jobs");
    this.files = this.database.db.collection<GridFSFile>("speech_audio.files");
    this.bucket = new GridFSBucket(this.database.db, { bucketName: "speech_audio" });
  }

  private async initialize(): Promise<void> {
    if (!this.initialization) {
      this.initialization = (async () => {
        await speechStorageOperation("cache-initialize", () => this.files.createIndex({ "metadata.fingerprint": 1 }, { unique: true, partialFilterExpression: { "metadata.fingerprint": { $type: "string" } }, timeoutMS: WORKER_METADATA_TIMEOUT_MS }));
      })().catch(error => { this.initialization = undefined; throw error; });
    }
    await this.initialization;
  }

  /** Background workers only: this entry point may make paid provider calls. */
  async get(sections: ContentSection[], signal?: AbortSignal): Promise<CachedResult> {
    const plans = makePlans(sections), results: CachedResult[] = [];
    let bytes = 44;
    for (const plan of plans) {
      if (signal?.aborted) throw interrupted(signal);
      const result = await this.getSection(plan, signal);
      bytes += result.buffer.length - 44 + (results.length ? TURN_GAP_BYTES : 0);
      if (bytes > MAX_AUDIO_BYTES) throw new ApiError(400, "Audio vượt giới hạn dung lượng.");
      results.push(result);
    }
    return this.combine(plans, results);
  }

  private async getSection(plan: Plan, signal?: AbortSignal): Promise<CachedResult> {
    const existing = this.inflight.get(plan.fingerprint);
    if (existing) return { ...await existing, cached: true };
    const promise = this.getShared(plan, signal);
    this.inflight.set(plan.fingerprint, promise);
    try { return await promise; } finally { this.inflight.delete(plan.fingerprint); }
  }

  private validMetadata(file: GridFSFile, plan: Plan, kind: "section" | "turn" = "section"): boolean {
    return Number.isSafeInteger(file.length) && file.length > 44 && file.length <= MAX_AUDIO_BYTES && (file.length - 44) % 2 === 0
      && file.metadata?.fingerprint === plan.fingerprint && file.metadata?.kind === kind
      && typeof file.metadata?.sha256 === "string" && /^[a-f0-9]{64}$/u.test(file.metadata.sha256)
      && JSON.stringify(file.metadata?.voiceIds) === JSON.stringify(plan.voiceIds)
      && file.metadata?.provider === plan.configuration.provider && file.metadata?.voiceCount === plan.voiceCount
      && file.metadata?.mimetype === "audio/wav" && file.metadata?.version === AUDIO_VERSION;
  }

  private async publishedFiles(plans: Plan[]): Promise<Map<string, GridFSFile>> {
    const fingerprints = [...new Set(plans.map(plan => plan.fingerprint))];
    // Bound the whole cursor, including later batches and stalled Mongo replies.
    const [files, jobs] = await Promise.all([
      this.files.find({ "metadata.fingerprint": { $in: fingerprints }, "metadata.kind": "section" }, {
        timeoutMS: CACHE_METADATA_TIMEOUT_MS, timeoutMode: "cursorLifetime",
      }).toArray(),
      this.jobs.find({ _id: { $in: fingerprints }, state: "ready" }, {
        timeoutMS: CACHE_METADATA_TIMEOUT_MS, timeoutMode: "cursorLifetime",
      }).toArray(),
    ]);
    const readyJobs = new Map(jobs.map(job => [job._id, job]));
    const byFingerprint = new Map(files.map(file => [file.metadata?.fingerprint, file]));
    const result = new Map<string, GridFSFile>();
    for (const plan of plans) {
      const file = byFingerprint.get(plan.fingerprint), job = readyJobs.get(plan.fingerprint);
      if (file && job?.fileId?.equals(file._id) && this.validMetadata(file, plan)) result.set(plan.fingerprint, file);
    }
    return result;
  }

  /** Metadata only, in two batched reads. Never queues work or creates indexes. */
  async readiness(sections: ContentSection[]): Promise<SpeechAudioReadiness> {
    if (!configuration()) return { configured: false, ready: true, state: "disabled", notice: "", readyCount: sections.length, totalCount: sections.length };
    const plans = makePlans(sections);
    try {
      const published = await this.publishedFiles(plans);
      const readyCount = plans.filter(plan => published.has(plan.fingerprint)).length;
      const ready = readyCount === plans.length;
      return { configured: true, ready, state: ready ? "ready" : "pending", notice: ready ? "" : PREPARATION_NOTICE, readyCount, totalCount: plans.length };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new SpeechCacheError("storage", "cache-metadata");
    }
  }

  /** Playback is cache-only. Missing or corrupt audio requires preparation. */
  async getReady(sections: ContentSection[]): Promise<CachedResult> {
    const plans = makePlans(sections), results: CachedResult[] = [];
    let bytes = 44;
    try {
      const published = await this.publishedFiles(plans);
      if (plans.some(plan => !published.has(plan.fingerprint))) throw new ApiError(409, PREPARATION_NOTICE);
      for (const plan of plans) {
        const file = published.get(plan.fingerprint)!;
        bytes += file.length - 44 + (results.length ? TURN_GAP_BYTES : 0);
        if (bytes > MAX_AUDIO_BYTES) throw new ApiError(400, "Audio vượt giới hạn dung lượng.");
        // GridFS CSOT bounds the complete learner download stream.
        const result = await this.readFile(file, plan, "section", CACHE_DOWNLOAD_TIMEOUT_MS);
        if (!result) throw new ApiError(409, PREPARATION_NOTICE);
        results.push(result);
      }
      return this.combine(plans, results);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new SpeechCacheError("storage", "cache-read");
    }
  }

  private combine(plans: Plan[], results: CachedResult[]): CachedResult {
    if (results.length === 1) return results[0];
    const chunks = results.flatMap((result, index) => index ? [Buffer.alloc(TURN_GAP_BYTES), result.buffer.subarray(44)] : [result.buffer.subarray(44)]);
    const bytes = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    if (bytes + 44 > MAX_AUDIO_BYTES) throw new ApiError(400, "Audio vượt giới hạn dung lượng.");
    return {
      buffer: Buffer.concat([wavHeader(bytes), ...chunks], bytes + 44), mimetype: "audio/wav", provider: plans[0].configuration.provider,
      voiceCount: new Set(plans.flatMap(plan => plan.voiceIds)).size, cached: results.every(result => result.cached),
    };
  }

  private async readFile(file: GridFSFile, plan: Plan, kind: "section" | "turn" = "section", timeoutMS = WORKER_STREAM_TIMEOUT_MS): Promise<CachedResult | null> {
    if (!this.validMetadata(file, plan, kind)) return null;
    const buffer = Buffer.allocUnsafe(file.length), stream = this.bucket!.openDownloadStream(file._id, { timeoutMS });
    let offset = 0;
    try {
      for await (const value of stream) {
        const chunk = Buffer.from(value);
        if (offset + chunk.length > buffer.length) { stream.destroy(); return null; }
        chunk.copy(buffer, offset); offset += chunk.length;
      }
    } catch (error) {
      stream.destroy();
      if (error instanceof MongoGridFSChunkError || (typeof error === "object" && error && "code" in error && error.code === "ENOENT")) return null;
      throw new SpeechCacheError("storage", "cache-read");
    }
    if (offset !== buffer.length || !validWav(buffer) || createHash("sha256").update(buffer).digest("hex") !== file.metadata?.sha256) return null;
    return { buffer, mimetype: "audio/wav", provider: plan.configuration.provider, voiceCount: plan.voiceCount, cached: true };
  }

  private async getShared(plan: Plan, signal?: AbortSignal): Promise<CachedResult> {
    await this.initialize();
    const deadline = Date.now() + GENERATION_TIMEOUT_MS + LEASE_MS;
    while (Date.now() < deadline) {
      if (signal?.aborted) throw interrupted(signal, "claim-wait");
      const file = await speechStorageOperation("cache-metadata", () => this.files.findOne({ "metadata.fingerprint": plan.fingerprint }, { timeoutMS: WORKER_METADATA_TIMEOUT_MS }));
      const result = file ? await this.readFile(file, plan) : null;
      const job = await speechStorageOperation("cache-metadata", () => this.jobs.findOne({ _id: plan.fingerprint }, { timeoutMS: WORKER_METADATA_TIMEOUT_MS }));
      if (result && job?.state === "ready" && job.fileId?.equals(file!._id)) return result;
      if (job?.state === "ready") {
        // Publishing may have completed after the initial lookup. Check again
        // before reclaiming a job, or a second worker would pay to recreate it.
        const published = await speechStorageOperation("cache-metadata", () => this.files.findOne({ "metadata.fingerprint": plan.fingerprint }, { timeoutMS: WORKER_METADATA_TIMEOUT_MS }));
        if (published && job.fileId?.equals(published._id)) { const result = await this.readFile(published, plan); if (result) return result; }
        await speechStorageOperation("cache-metadata", () => this.jobs.updateOne({ _id: plan.fingerprint, state: "ready", fileId: job.fileId }, { $set: { state: "failed", leaseExpiresAt: new Date(0) }, $unset: { fileId: "" } }, { timeoutMS: WORKER_METADATA_TIMEOUT_MS }));
      }
      const owner = randomUUID(), now = new Date(), leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
      let acquired = false;
      if (!job) {
        try { await this.jobs.insertOne({ _id: plan.fingerprint, state: "generating", owner, leaseExpiresAt, createdAt: now }, { timeoutMS: WORKER_METADATA_TIMEOUT_MS }); acquired = true; }
        catch (error) { if (!(typeof error === "object" && error && "code" in error && error.code === 11000)) throw new SpeechCacheError("storage", "cache-metadata"); }
      }
      if (!acquired) acquired = Boolean(await speechStorageOperation("cache-metadata", () => this.jobs.findOneAndUpdate({ _id: plan.fingerprint, state: { $ne: "ready" }, $or: [{ leaseExpiresAt: { $lte: now } }, { leaseExpiresAt: { $exists: false } }] }, { $set: { state: "generating", owner, leaseExpiresAt } }, { returnDocument: "after", timeoutMS: WORKER_METADATA_TIMEOUT_MS })));
      if (acquired) return this.generateClaimed(plan, owner, signal);
      await new Promise<void>(resolve => setTimeout(resolve, POLL_MS));
    }
    throw new SpeechCacheError("claim-timeout", "claim-wait");
  }

  private async upload(plan: Plan, result: SpeechAudioResult, kind: "section" | "turn"): Promise<ObjectId> {
    const upload = this.bucket.openUploadStream(`${plan.fingerprint}.wav`, { timeoutMS: WORKER_STREAM_TIMEOUT_MS, metadata: {
      fingerprint: plan.fingerprint, kind, version: AUDIO_VERSION, provider: result.provider,
      voiceCount: result.voiceCount, voiceIds: plan.voiceIds, mimetype: result.mimetype,
      sha256: createHash("sha256").update(result.buffer).digest("hex"),
    } });
    try {
      await new Promise<void>((resolve, reject) => { upload.once("finish", resolve); upload.once("error", reject); upload.end(result.buffer); });
      return upload.id;
    } catch { await upload.abort().catch(() => undefined); throw new SpeechCacheError("storage", "cache-write"); }
  }

  private async generateClaimed(plan: Plan, owner: string, signal?: AbortSignal): Promise<CachedResult> {
    const controller = new AbortController();
    const abort = () => controller.abort(interrupted(signal));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    let heartbeatRunning = false;
    const heartbeat = setInterval(() => {
      if (heartbeatRunning) return;
      heartbeatRunning = true;
      const now = new Date();
      void speechStorageOperation("lease-heartbeat", () => this.jobs.updateOne({ _id: plan.fingerprint, owner, state: "generating", leaseExpiresAt: { $gt: now } }, { $set: { leaseExpiresAt: new Date(now.getTime() + LEASE_MS) } }, { timeoutMS: HEARTBEAT_TIMEOUT_MS }))
        .then(result => { if (!result.matchedCount) controller.abort(new SpeechCacheError("lease-lost", "lease-heartbeat")); }, error => controller.abort(error))
        .finally(() => { heartbeatRunning = false; });
    }, LEASE_MS / 3);
    heartbeat.unref();
    let uploadedId: ObjectId | undefined;
    const renew = async () => {
      if (controller.signal.aborted) throw interrupted(controller.signal, "lease-renew");
      const renewed = await speechStorageOperation("lease-renew", () => this.jobs.updateOne({ _id: plan.fingerprint, owner, state: "generating", leaseExpiresAt: { $gt: new Date() } }, { $set: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) } }, { timeoutMS: WORKER_METADATA_TIMEOUT_MS }));
      if (controller.signal.aborted) throw interrupted(controller.signal, "lease-renew");
      if (!renewed.matchedCount) throw new SpeechCacheError("lease-lost", "lease-renew");
    };
    try {
      // A completed upload can survive a worker crash before its job update.
      // Recover it under the claim rather than synthesizing the same text again.
      const existing = await speechStorageOperation("cache-metadata", () => this.files.findOne({ "metadata.fingerprint": plan.fingerprint }, { timeoutMS: WORKER_METADATA_TIMEOUT_MS }));
      if (existing) {
        const recovered = await this.readFile(existing, plan);
        if (recovered) {
          await renew();
          const saved = await speechStorageOperation("cache-publish", () => this.jobs.updateOne({ _id: plan.fingerprint, owner, state: "generating" }, { $set: { state: "ready", fileId: existing._id, completedAt: new Date() }, $unset: { owner: "", leaseExpiresAt: "" } }, { timeoutMS: WORKER_METADATA_TIMEOUT_MS }));
          if (!saved.matchedCount) throw new SpeechCacheError("lease-lost", "cache-publish");
          return recovered;
        }
        await speechStorageOperation("cache-write", () => this.bucket.delete(existing._id, { timeoutMS: WORKER_STREAM_TIMEOUT_MS }));
      }
      const result = await synthesizePlan(plan, controller.signal, {
        read: async segment => {
          const file = await speechStorageOperation("cache-metadata", () => this.files.findOne({ "metadata.fingerprint": segment.fingerprint }, { timeoutMS: WORKER_METADATA_TIMEOUT_MS }));
          if (!file) return null;
          const ready = await this.readFile(file, segment, "turn");
          if (ready) return ready;
          await renew();
          await speechStorageOperation("cache-write", () => this.bucket.delete(file._id, { timeoutMS: WORKER_STREAM_TIMEOUT_MS }));
          return null;
        },
        write: async (segment, result) => {
          await renew();
          await this.upload(segment, result, "turn");
        },
      });
      await renew();
      uploadedId = await this.upload(plan, result, "section");
      await renew();
      const saved = await speechStorageOperation("cache-publish", () => this.jobs.updateOne({ _id: plan.fingerprint, owner, state: "generating" }, { $set: { state: "ready", fileId: uploadedId, completedAt: new Date() }, $unset: { owner: "", leaseExpiresAt: "" } }, { timeoutMS: WORKER_METADATA_TIMEOUT_MS }));
      if (!saved.matchedCount) throw new SpeechCacheError("lease-lost", "cache-publish");
      return { ...result, cached: false };
    } catch (error) {
      // A successful upload survives an ambiguous publication response. A new
      // owner can validate and publish it without purchasing the script again.
      await this.jobs.updateOne({ _id: plan.fingerprint, owner, state: "generating" }, { $set: { state: "failed", leaseExpiresAt: new Date(0) }, $unset: { owner: "", fileId: "" } }, { timeoutMS: WORKER_METADATA_TIMEOUT_MS }).catch(() => undefined);
      if (error instanceof ApiError) throw error;
      throw new SpeechCacheError("storage", "cache-write");
    } finally { clearInterval(heartbeat); signal?.removeEventListener("abort", abort); }
  }
}
