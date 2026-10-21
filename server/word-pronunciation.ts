import type { WordPronunciation } from "../shared/types";
import { ApiError } from "./errors";
import type { Database } from "./storage";

export interface WordPronunciationOptions {
  /** Server-only injection for isolated fixtures; never accepted from callers. */
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  now?: () => number;
}

const unavailable = () => new ApiError(503, "Chưa tra được phiên âm lúc này. Từ đã lưu vẫn được giữ; hãy thử lại sau.");
const missing = () => new ApiError(404, "Chưa tìm thấy phiên âm đáng tin cậy cho từ này. Bạn vẫn có thể dùng nút nghe phát âm.");

/** A bounded English word/bank phrase, never a URL or invented base form. */
export function pronunciationWord(value: string): string {
  const word = value.normalize("NFC").replace(/[’‘]/gu, "'").replace(/\s+/gu, " ").trim().toLowerCase();
  if (word.length > 80 || !/^[a-z]+(?:['-][a-z]+)*(?: [a-z]+(?:['-][a-z]+)*)*$/u.test(word))
    throw new ApiError(400, "Hãy chọn một từ tiếng Anh để xem phiên âm.");
  return word;
}

/** Keep IPA text only; definitions, HTML, URLs and arbitrary payloads are rejected. */
export function validIpa(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.normalize("NFC").trim();
  if (!text || text.length > 240 || /[\r\n]/u.test(text)) return undefined;
  const delimited = text.startsWith("/") && text.endsWith("/") || text.startsWith("[") && text.endsWith("]");
  const body = delimited ? text.slice(1, -1).trim() : text;
  if (!body || !/^[a-zA-Z\u00c0-\u02ff\u0300-\u036f\u1d00-\u1dbf\u03b8 .()\-]+$/u.test(body)) return undefined;
  return delimited ? text : `/${body}/`;
}

async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw unavailable();
  let size = 0;
  const chunks: Uint8Array[] = [];
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  try {
    for (;;) {
      const row = await reader.read();
      if (row.done) break;
      size += row.value.byteLength;
      if (size > 128 * 1024) throw unavailable();
      chunks.push(row.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    signal.removeEventListener("abort", cancel);
    // A provider's stream cleanup must not hold the request open indefinitely.
    void reader.cancel().catch(() => undefined);
  }
}

function dictionaryIpa(payload: unknown, word: string): string | undefined {
  if (!Array.isArray(payload) || payload.length > 32) return undefined;
  for (const entry of payload) {
    if (!entry || typeof entry !== "object" || typeof entry.word !== "string") continue;
    // The dictionary may redirect an inflection to its lemma. That spelling's
    // pronunciation cannot be silently attached to the selected written word.
    if (entry.word.normalize("NFC").replace(/[’‘]/gu, "'").trim().toLowerCase() !== word) continue;
    const phonetics = Array.isArray(entry.phonetics) ? entry.phonetics.slice(0, 32) : [];
    for (const item of phonetics) {
      const ipa = item && typeof item === "object" ? validIpa(item.text) : undefined;
      if (ipa) return ipa;
    }
  }
  return undefined;
}

/** Free lookup of pronunciation metadata only; never calls a paid AI service. */
export class WordPronunciationResolver {
  private readonly cache = new Map<string, { value: WordPronunciation | null; expiresAt: number }>();
  private readonly inFlight = new Map<string, Promise<WordPronunciation>>();
  private readonly now: () => number;
  constructor(private readonly database: Pick<Database, "vocabulary">, private readonly options: WordPronunciationOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  async get(input: string): Promise<WordPronunciation> {
    const word = pronunciationWord(input);
    const cached = this.cache.get(word);
    if (cached && cached.expiresAt > this.now()) {
      if (!cached.value) throw missing();
      return { ...cached.value };
    }
    if (cached) this.cache.delete(word);
    const shared = this.inFlight.get(word);
    if (shared) return { ...await shared };
    if (this.inFlight.size >= 32) throw unavailable();
    const work = this.resolve(word);
    this.inFlight.set(word, work);
    try {
      const value = await work;
      this.remember(word, value, 24 * 60 * 60_000);
      return { ...value };
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) this.remember(word, null, 5 * 60_000);
      throw error;
    } finally { this.inFlight.delete(word); }
  }

  private remember(word: string, value: WordPronunciation | null, ttl: number): void {
    if (this.cache.size >= 500) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(word, { value, expiresAt: this.now() + ttl });
  }

  private async resolve(word: string): Promise<WordPronunciation> {
    const bank = await this.database.vocabulary.findOne({
      word: { $regex: `^${word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`, $options: "i" },
    }, { projection: { ipa: 1 }, timeoutMS: 5_000 });
    const bankIpa = validIpa(bank?.ipa);
    if (bankIpa) return { word, ipa: bankIpa, source: "bank" };
    if (word.includes(" ")) throw missing();
    const timeoutMs = Math.max(1, Math.min(8_000, this.options.timeoutMs ?? 6_000));
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(unavailable()); }, timeoutMs);
    });
    try {
      const work = (async () => {
        const response = await (this.options.fetch ?? globalThis.fetch)(
          `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
          { method: "GET", redirect: "error", headers: { Accept: "application/json" }, signal: controller.signal },
        );
        if (!response.ok) {
          void response.body?.cancel().catch(() => undefined);
          if (response.status === 404) throw missing();
          throw unavailable();
        }
        const ipa = dictionaryIpa(await boundedJson(response, controller.signal), word);
        if (!ipa) throw missing();
        return { word, ipa, source: "dictionary" as const };
      })();
      return await Promise.race([work, timeout]);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw unavailable();
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }
}
