import { createHash } from "node:crypto";
import { ApiError } from "./errors";

const MAX_SOURCE = 100_000;
const MAX_CATALOG = 512;
const MAX_SEGMENT = 1_000;
const MAX_QUOTE = 2_000;
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
const reasons = ["unknown-source-id", "source-mismatch", "invalid-source", "invalid-quote", "oversized-span"] as const;
export type SpeakingEvidenceReason = typeof reasons[number];

/** Safe diagnostic categories only; never retain a quote, ID or source hash. */
export class SpeakingEvidenceError extends ApiError {
  readonly reason: SpeakingEvidenceReason;
  constructor(reason: SpeakingEvidenceReason) {
    super(502, "AI trả về dẫn chứng Speaking không khớp với transcript đã lưu. Bản ghi vẫn được giữ; hãy thử lại.", "AI_EVIDENCE_INVALID");
    this.name = "SpeakingEvidenceError";
    this.reason = reasons.includes(reason) ? reason : "invalid-quote";
  }
}

export interface SpeakingSourceSegment { readonly id: string; readonly text: string }
export interface SpeakingEvidenceSource {
  readonly catalog: readonly SpeakingSourceSegment[];
  /** Resolve a current source ID or a formatting-only equivalent literal. */
  quote(value: string): string;
}
interface Span { start: number; end: number }
interface Canonical { text: string; starts: number[]; ends: number[] }

function canonical(text: string, offsets = false): Canonical {
  const units: string[] = [], starts: number[] = [], ends: number[] = [];
  for (const part of segmenter.segment(text)) {
    const start = part.index, end = start + part.segment.length;
    const normalized = part.segment.normalize("NFC").replace(/[\u2018\u2019]/gu, "'").replace(/[\u201c\u201d]/gu, '"');
    for (const point of normalized) {
      const value = /\s/u.test(point) ? " " : point;
      if (value === " " && units.at(-1) === " ") {
        if (offsets) ends[ends.length - 1] = end;
        continue;
      }
      units.push(value);
      if (offsets) for (let index = 0; index < value.length; index++) { starts.push(start); ends.push(end); }
    }
  }
  return { text: units.join(""), starts, ends };
}

/** Build complete, exact word groups; no displayed source text is rewritten. */
function sourceSpans(text: string): { spans: Span[]; boundaries: Set<number> } {
  const words: Span[] = [], boundaries = new Set<number>([0]);
  let wordStart: number | undefined;
  for (const part of segmenter.segment(text)) {
    const start = part.index, end = start + part.segment.length;
    if (part.segment.length > MAX_SEGMENT) throw new SpeakingEvidenceError("oversized-span");
    // A lone surrogate has no valid Unicode character to put in a catalog.
    if ([...part.segment].some(point => point.length === 1 && /[\ud800-\udfff]/u.test(point)))
      throw new SpeakingEvidenceError("invalid-source");
    boundaries.add(end);
    if (/^\s+$/u.test(part.segment)) {
      if (wordStart !== undefined) { words.push({ start: wordStart, end: start }); wordStart = undefined; }
    } else if (wordStart === undefined) wordStart = start;
  }
  if (wordStart !== undefined) words.push({ start: wordStart, end: text.length });
  if (!words.length) throw new SpeakingEvidenceError("invalid-source");

  const targetWords = Math.max(6, Math.ceil(words.length / 256));
  const spans: Span[] = [];
  let current: Span | undefined, count = 0;
  const flush = () => { if (current) spans.push(current); current = undefined; count = 0; };
  for (const word of words) {
    if (word.end - word.start > MAX_SEGMENT) {
      flush();
      let pieceStart = word.start, pieceEnd = word.start;
      for (const part of segmenter.segment(text.slice(word.start, word.end))) {
        const start = word.start + part.index, end = start + part.segment.length;
        if (end - pieceStart > MAX_SEGMENT) {
          spans.push({ start: pieceStart, end: start });
          pieceStart = start;
        }
        pieceEnd = end;
      }
      if (pieceEnd > pieceStart) spans.push({ start: pieceStart, end: pieceEnd });
      continue;
    }
    if (current && (count >= targetWords || word.end - current.start > MAX_SEGMENT)) flush();
    if (!current) current = { ...word };
    else current.end = word.end;
    count++;
  }
  flush();
  if (spans.length <= MAX_CATALOG) return { spans, boundaries };

  // Pathological word lengths can force extra groups. Repack only then. With a
  // 100k source, maximal adjacent <=1k packing cannot exceed 201 entries: each
  // disjoint pair of unmergeable groups spans more than 1k source characters.
  const packed: Span[] = [];
  for (const span of spans) {
    const previous = packed.at(-1);
    if (previous && span.end - previous.start <= MAX_SEGMENT) previous.end = span.end;
    else packed.push({ ...span });
  }
  if (packed.length > MAX_CATALOG) throw new SpeakingEvidenceError("invalid-source");
  return { spans: packed, boundaries };
}

/** Keep recognition text private to this evaluation and expose immutable IDs. */
export function createSpeakingEvidenceSource(transcript: string): SpeakingEvidenceSource {
  if (typeof transcript !== "string" || transcript.length > MAX_SOURCE || !transcript.trim())
    throw new SpeakingEvidenceError("invalid-source");
  const { spans, boundaries } = sourceSpans(transcript);
  const prefix = `spref_${createHash("sha256").update(transcript).digest("hex").slice(0, 16)}_`;
  const originals = new Map<string, string>();
  const catalog = Object.freeze(spans.map((span, index) => {
    const id = `${prefix}${index + 1}`;
    const text = transcript.slice(span.start, span.end);
    originals.set(id, text);
    return Object.freeze({ id, text });
  }));
  let mapped: Canonical | undefined;
  const quote = (value: string): string => {
    if (typeof value !== "string" || !value.trim() || value.length > MAX_QUOTE)
      throw new SpeakingEvidenceError("invalid-quote");
    const id = value.trim();
    // Reserved references must never be rescued by literal matching. A learner
    // can still quote ID-like content through its own valid catalog reference.
    if (/^spref_/iu.test(id)) {
      const original = originals.get(id);
      if (original === undefined) throw new SpeakingEvidenceError("unknown-source-id");
      return original;
    }
    let cursor = 0;
    while (cursor <= transcript.length - value.length) {
      const found = transcript.indexOf(value, cursor);
      if (found < 0) break;
      if (boundaries.has(found) && boundaries.has(found + value.length)) return value;
      cursor = found + 1;
    }
    const needle = canonical(value).text.trim();
    if (!needle) throw new SpeakingEvidenceError("invalid-quote");
    mapped ??= canonical(transcript, true);
    cursor = 0;
    while (cursor <= mapped.text.length - needle.length) {
      const found = mapped.text.indexOf(needle, cursor);
      if (found < 0) break;
      const last = found + needle.length - 1;
      const start = mapped.starts[found], end = mapped.ends[last];
      const startsAtBoundary = found === 0 || mapped.starts[found - 1] !== start;
      const endsAtBoundary = last + 1 === mapped.text.length || mapped.ends[last + 1] !== end;
      if (startsAtBoundary && endsAtBoundary) {
        if (end - start > MAX_QUOTE) throw new SpeakingEvidenceError("oversized-span");
        const original = transcript.slice(start, end);
        if (canonical(original).text.trim() === needle) return original;
        throw new SpeakingEvidenceError("source-mismatch");
      }
      cursor = found + 1;
    }
    throw new SpeakingEvidenceError("source-mismatch");
  };
  return Object.freeze({ catalog, quote });
}
