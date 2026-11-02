import { ApiError } from "./errors";

const MAX_SOURCE_LENGTH = 60_000;
const MAX_QUOTE_LENGTH = 2_000;
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
const invalidEvidence = (): ApiError => new ApiError(
  502,
  "AI trả về bằng chứng không có trong bài. Bài nháp vẫn được giữ; hãy thử chấm lại.",
  "AI_EVIDENCE_INVALID",
);

/** Actual input line breaks are paragraph boundaries; textarea wrapping is not. */
export function writingParagraphs(text: string): string[] {
  return text.split(/[\r\n\u2028\u2029]+/u).map(paragraph => paragraph.trim()).filter(Boolean);
}

interface CanonicalSource {
  text: string;
  starts: number[];
  ends: number[];
}

/** Canonicalise typography, never the learner's words, spelling or grammar. */
function canonical(text: string, offsets = false): CanonicalSource {
  const units: string[] = [], starts: number[] = [], ends: number[] = [];
  for (const part of segmenter.segment(text)) {
    const start = part.index, end = start + part.segment.length;
    const normalized = part.segment.normalize("NFC").replace(/[\u2018\u2019]/gu, "'").replace(/[\u201c\u201d]/gu, '"');
    for (const point of normalized) {
      const unit = /\s/u.test(point) ? " " : point;
      if (unit === " " && units.at(-1) === " ") {
        if (offsets) ends[ends.length - 1] = end;
        continue;
      }
      units.push(unit);
      if (offsets) {
        // Search operates in UTF-16 code units. A canonical code point can use
        // two units; both still refer to the entire original grapheme.
        for (let index = 0; index < unit.length; index++) { starts.push(start); ends.push(end); }
      }
    }
  }
  return { text: units.join(""), starts, ends };
}

function matcher(source: string): (candidate: string) => string {
  let mapped: CanonicalSource | undefined;
  return candidate => {
    if (typeof candidate !== "string" || !candidate.trim() || candidate.length > MAX_QUOTE_LENGTH)
      throw invalidEvidence();
    // Preserve exact quotations, including their original spelling and spacing.
    if (source.includes(candidate)) return candidate;
    const needle = canonical(candidate).text.trim();
    if (!needle) throw invalidEvidence();
    mapped ??= canonical(source, true);
    let cursor = 0;
    while (cursor <= mapped.text.length - needle.length) {
      const found = mapped.text.indexOf(needle, cursor);
      if (found < 0) break;
      const last = found + needle.length - 1;
      const start = mapped.starts[found], end = mapped.ends[last];
      // Do not expand a partial canonical grapheme into a larger source span.
      // Boundary checks avoid repeatedly normalising long overlapping matches.
      const startsAtBoundary = found === 0 || mapped.starts[found - 1] !== start;
      const endsAtBoundary = last + 1 === mapped.text.length || mapped.ends[last + 1] !== end;
      if (startsAtBoundary && endsAtBoundary) {
        const original = source.slice(start, end);
        if (canonical(original).text.trim() === needle) return original;
        throw invalidEvidence();
      }
      cursor = found + 1;
    }
    throw invalidEvidence();
  };
}

export interface WritingEvidenceSource {
  text: string;
  paragraphs: string[];
  /** Return the exact source substring, or reject evidence not in this essay. */
  quote(candidate: string): string;
  /** Scope a quotation to the server-defined zero-based paragraph. */
  paragraphQuote(index: number, candidate: string): string;
}

/** Writing-only evidence resolution; never mutates the stored learner essay. */
export function createWritingEvidenceSource(text: string): WritingEvidenceSource {
  if (typeof text !== "string" || text.length > MAX_SOURCE_LENGTH) throw invalidEvidence();
  const blocks = writingParagraphs(text);
  const paragraphMatchers = new Map<number, (candidate: string) => string>();
  return {
    text,
    paragraphs: [...blocks],
    quote: matcher(text),
    paragraphQuote(index, candidate) {
      if (!Number.isInteger(index) || index < 0 || index >= blocks.length) throw invalidEvidence();
      let resolve = paragraphMatchers.get(index);
      if (!resolve) { resolve = matcher(blocks[index]); paragraphMatchers.set(index, resolve); }
      return resolve(candidate);
    },
  };
}
