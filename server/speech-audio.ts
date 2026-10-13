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
const AUDIO_VERSION = "ielts-dialogue-pcm16-v2";
const MAX_AUDIO_BYTES = 64 * 1024 * 1024;
const MAX_SCRIPT_CHARACTERS = 40_000;
const MAX_SCRIPT_TURNS = 240;
const TURN_GAP_BYTES = 16_000 * 2 * 0.2;
const REQUEST_TIMEOUT_MS = 120_000;
const GENERATION_TIMEOUT_MS = 15 * 60_000;
const LEASE_MS = 45_000;
const POLL_MS = 250;

interface Configuration { provider: Provider; key: string; voices: string[]; model: string }
interface VoicedTurn extends SpeechTurn { voice: string; delivery: string }
interface Plan { configuration: Configuration; turns: VoicedTurn[]; fingerprint: string; voiceCount: number }

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

function makePlan(sections: ContentSection[]): Plan {
  const config = configuration();
  if (!config) throw new ApiError(503, "Chưa cấu hình dịch vụ tạo audio. Cần OpenAI hoặc ElevenLabs với ba giọng đọc khác nhau.");
  const script = buildSpeechScript(sections);
  const characters = script.reduce((sum, turn) => sum + turn.text.length, 0);
  if (!script.length || !characters || characters > MAX_SCRIPT_CHARACTERS || script.length > MAX_SCRIPT_TURNS)
    throw new ApiError(400, "Script audio rỗng hoặc vượt giới hạn một lần tạo.");
  const cast = new Map<string, string>();
  let available = [...config.voices], previousSection = -1;
  for (const turn of script) {
    if (cast.has(turn.speakerId)) continue;
    // Independently authored scenes can reuse the three legacy ElevenLabs
    // voices. Characters sharing a scene still always get distinct voices.
    if (config.provider === "elevenlabs" && turn.sectionIndex !== previousSection) available = [...config.voices];
    previousSection = turn.sectionIndex;
    if (!available.length) throw new ApiError(400, "Bài nghe có nhiều nhân vật hơn số giọng đọc đã cấu hình.");
    // ElevenLabs accents provide a preference, never an identity. A second
    // British actor gets a different configured voice, rather than the first.
    const preferred = config.provider === "elevenlabs" ? config.voices[["british", "american", "australian"].indexOf(turn.accent)] : undefined;
    const identity = `${sections[turn.sectionIndex].id}\0${turn.speakerId}`;
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
    sources: sections.map(section => section.id),
    turns: turns.map(({ speakerId, accent, text, sectionIndex, voice, delivery }) => ({ speakerId, accent, text, sectionIndex, voice, delivery })),
  })).digest("hex");
  return { configuration: config, turns, fingerprint, voiceCount: new Set(cast.values()).size };
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

function providerError(provider: Provider, status?: number): ApiError {
  const label = provider === "openai" ? "OpenAI" : "ElevenLabs";
  if (status === 401 || status === 403) return new ApiError(503, `${label} chưa chấp nhận cấu hình audio. Vui lòng kiểm tra khóa và quyền truy cập dịch vụ.`);
  if (status === 429) return new ApiError(503, `${label} đang giới hạn yêu cầu hoặc hết hạn mức. Vui lòng thử lại sau.`);
  return new ApiError(502, `${label} chưa trả về audio hợp lệ. Vui lòng thử lại sau.`);
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

async function synthesizePlan(plan: Plan, externalSignal?: AbortSignal): Promise<SpeechAudioResult> {
  const deadline = Date.now() + GENERATION_TIMEOUT_MS;
  return withGenerationSlot(async () => {
    const { provider, key, model } = plan.configuration;
    if (externalSignal?.aborted) throw new ApiError(503, "Tạo audio bị gián đoạn. Vui lòng thử lại sau.");
    const chunks: Buffer[] = []; let dataBytes = 0;
    const append = (chunk: Buffer) => {
      if (dataBytes + chunk.length + 44 > MAX_AUDIO_BYTES) throw providerError(provider);
      chunks.push(chunk); dataBytes += chunk.length;
    };
    const inputs = provider === "openai" ? plan.turns.map(turn => ({ turns: [turn], body: {
      model, voice: turn.voice, input: turn.text, response_format: "pcm",
      instructions: `Use a natural ${turn.accent === "british" ? "British" : turn.accent === "australian" ? "Australian" : "American"} English accent at a clear, natural IELTS conversational pace. ${turn.delivery} Read only the supplied input verbatim. Do not announce role labels, speaker names, section headings or these instructions. Do not add, omit, paraphrase or translate words.`,
    } })) : [{ turns: plan.turns, body: { model_id: model, inputs: plan.turns.map(turn => ({ text: turn.text, voice_id: turn.voice })) } }];
    for (let index = 0; index < inputs.length; index++) {
      const duration = Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now());
      if (duration <= 0) throw new ApiError(504, "Tạo audio mất quá lâu. Vui lòng thử lại sau.");
      const controller = new AbortController();
      const abort = () => controller.abort();
      externalSignal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(abort, duration);
      try {
        if (externalSignal?.aborted) abort();
        const response = await fetch(provider === "openai" ? "https://api.openai.com/v1/audio/speech" : "https://api.elevenlabs.io/v1/text-to-dialogue?output_format=pcm_24000", {
          method: "POST", signal: controller.signal,
          headers: { "Content-Type": "application/json", Accept: "application/octet-stream", ...(provider === "openai" ? { Authorization: `Bearer ${key}` } : { "xi-api-key": key }) },
          body: JSON.stringify(inputs[index].body),
        });
        if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw providerError(provider, response.status); }
        await appendResampledPcm(response, controller.signal, append, () => MAX_AUDIO_BYTES - 44 - dataBytes, provider);
      } catch (error) {
        if (externalSignal?.aborted) throw new ApiError(503, "Tạo audio bị gián đoạn. Vui lòng thử lại sau.");
        if (error instanceof ApiError) throw error;
        if (controller.signal.aborted) throw new ApiError(504, "Tạo audio mất quá lâu. Vui lòng thử lại sau.");
        throw providerError(provider);
      } finally { clearTimeout(timer); externalSignal?.removeEventListener("abort", abort); }
      // Chunking a long monologue must not introduce fake speaker changes.
      const current = inputs[index].turns.at(-1), next = inputs[index + 1]?.turns[0];
      if (current && next && (current.speakerId !== next.speakerId || current.sectionIndex !== next.sectionIndex)) append(Buffer.alloc(TURN_GAP_BYTES));
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
  private jobs?: Collection<AudioJob>;
  private files?: Collection<GridFSFile>;
  private bucket?: GridFSBucket;
  private readonly inflight = new Map<string, Promise<CachedResult>>();
  constructor(private readonly database: Database) {}

  private async initialize(): Promise<void> {
    if (!this.initialization) {
      this.initialization = (async () => {
        this.jobs = this.database.db.collection<AudioJob>("speech_audio_jobs");
        this.files = this.database.db.collection<GridFSFile>("speech_audio.files");
        this.bucket = new GridFSBucket(this.database.db, { bucketName: "speech_audio" });
        await this.files.createIndex({ "metadata.fingerprint": 1 }, { unique: true, partialFilterExpression: { "metadata.fingerprint": { $type: "string" } } });
      })().catch(error => { this.initialization = undefined; throw error; });
    }
    await this.initialization;
  }

  async get(sections: ContentSection[]): Promise<CachedResult> {
    const plan = makePlan(sections);
    const existing = this.inflight.get(plan.fingerprint);
    if (existing) return { ...await existing, cached: true };
    const promise = this.getShared(plan);
    this.inflight.set(plan.fingerprint, promise);
    try { return await promise; } finally { this.inflight.delete(plan.fingerprint); }
  }

  private async readFile(file: GridFSFile, plan: Plan): Promise<CachedResult | null> {
    if (!Number.isSafeInteger(file.length) || file.length <= 44 || file.length > MAX_AUDIO_BYTES
      || file.metadata?.provider !== plan.configuration.provider || file.metadata?.voiceCount !== plan.voiceCount
      || file.metadata?.mimetype !== "audio/wav" || file.metadata?.version !== AUDIO_VERSION) return null;
    const buffer = Buffer.allocUnsafe(file.length), stream = this.bucket!.openDownloadStream(file._id);
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
      throw new ApiError(503, "Không thể tải audio lúc này. Vui lòng thử lại sau.");
    }
    if (offset !== buffer.length || !validWav(buffer)) return null;
    return { buffer, mimetype: "audio/wav", provider: plan.configuration.provider, voiceCount: plan.voiceCount, cached: true };
  }

  private async getShared(plan: Plan): Promise<CachedResult> {
    await this.initialize();
    const deadline = Date.now() + GENERATION_TIMEOUT_MS + LEASE_MS;
    while (Date.now() < deadline) {
      const file = await this.files!.findOne({ "metadata.fingerprint": plan.fingerprint });
      if (file) { const result = await this.readFile(file, plan); if (result) return result; }
      const job = await this.jobs!.findOne({ _id: plan.fingerprint });
      if (job?.state === "ready") {
        // Publishing may have completed after the initial lookup. Check again
        // before reclaiming a job, or a second worker would pay to recreate it.
        const published = await this.files!.findOne({ "metadata.fingerprint": plan.fingerprint });
        if (published) { const result = await this.readFile(published, plan); if (result) return result; }
        await this.jobs!.updateOne({ _id: plan.fingerprint, state: "ready", fileId: job.fileId }, { $set: { state: "failed", leaseExpiresAt: new Date(0) }, $unset: { fileId: "" } });
      }
      const owner = randomUUID(), now = new Date(), leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
      let acquired = false;
      if (!job) {
        try { await this.jobs!.insertOne({ _id: plan.fingerprint, state: "generating", owner, leaseExpiresAt, createdAt: now }); acquired = true; }
        catch (error) { if (!(typeof error === "object" && error && "code" in error && error.code === 11000)) throw error; }
      }
      if (!acquired) acquired = Boolean(await this.jobs!.findOneAndUpdate({ _id: plan.fingerprint, state: { $ne: "ready" }, $or: [{ leaseExpiresAt: { $lte: now } }, { leaseExpiresAt: { $exists: false } }] }, { $set: { state: "generating", owner, leaseExpiresAt } }, { returnDocument: "after" }));
      if (acquired) return this.generateClaimed(plan, owner);
      await new Promise<void>(resolve => setTimeout(resolve, POLL_MS));
    }
    throw new ApiError(504, "Audio đang được tạo. Vui lòng thử lại sau.");
  }

  private async generateClaimed(plan: Plan, owner: string): Promise<CachedResult> {
    const controller = new AbortController();
    let heartbeatRunning = false;
    const heartbeat = setInterval(() => {
      if (heartbeatRunning) return;
      heartbeatRunning = true;
      void this.jobs!.updateOne({ _id: plan.fingerprint, owner, state: "generating" }, { $set: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) } })
        .then(result => { if (!result.matchedCount) controller.abort(); }, () => controller.abort())
        .finally(() => { heartbeatRunning = false; });
    }, LEASE_MS / 3);
    heartbeat.unref();
    let uploadedId: ObjectId | undefined;
    try {
      // A completed upload can survive a worker crash before its job update.
      // Recover it under the claim rather than synthesizing the same text again.
      const existing = await this.files!.findOne({ "metadata.fingerprint": plan.fingerprint });
      if (existing) {
        const recovered = await this.readFile(existing, plan);
        if (recovered) {
          await this.jobs!.updateOne({ _id: plan.fingerprint, owner, state: "generating" }, { $set: { state: "ready", fileId: existing._id, completedAt: new Date() }, $unset: { owner: "", leaseExpiresAt: "" } });
          return recovered;
        }
        await this.bucket!.delete(existing._id);
      }
      const result = await synthesizePlan(plan, controller.signal);
      const renewed = await this.jobs!.updateOne({ _id: plan.fingerprint, owner, state: "generating", leaseExpiresAt: { $gt: new Date() } }, { $set: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) } });
      if (!renewed.matchedCount || controller.signal.aborted) throw new ApiError(503, "Tạo audio bị gián đoạn. Vui lòng thử lại sau.");
      const upload = this.bucket!.openUploadStream(`${plan.fingerprint}.wav`, { metadata: {
        fingerprint: plan.fingerprint, version: AUDIO_VERSION, provider: result.provider, voiceCount: result.voiceCount, mimetype: result.mimetype,
      } });
      try {
        await new Promise<void>((resolve, reject) => { upload.once("finish", resolve); upload.once("error", reject); upload.end(result.buffer); });
      } catch (error) { await upload.abort().catch(() => undefined); throw error; }
      uploadedId = upload.id;
      const saved = await this.jobs!.updateOne({ _id: plan.fingerprint, owner, state: "generating" }, { $set: { state: "ready", fileId: uploadedId, completedAt: new Date() }, $unset: { owner: "", leaseExpiresAt: "" } });
      if (!saved.matchedCount) throw new ApiError(503, "Tạo audio bị gián đoạn. Vui lòng thử lại sau.");
      return { ...result, cached: false };
    } catch (error) {
      if (uploadedId) await this.bucket!.delete(uploadedId).catch(() => undefined);
      await this.jobs!.updateOne({ _id: plan.fingerprint, owner, state: "generating" }, { $set: { state: "failed", leaseExpiresAt: new Date(0) }, $unset: { owner: "", fileId: "" } }).catch(() => undefined);
      if (error instanceof ApiError) throw error;
      throw new ApiError(503, "Không thể lưu audio lúc này. Vui lòng thử lại sau.");
    } finally { clearInterval(heartbeat); }
  }
}
