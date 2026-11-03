import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { ApiError } from "../server/errors";
import { createSpeakingEvidenceSource, SpeakingEvidenceError } from "../server/speaking-evidence-source";

function rejected(work: () => unknown, reason?: SpeakingEvidenceError["reason"]): SpeakingEvidenceError {
  let caught: SpeakingEvidenceError | undefined;
  assert.throws(work, error => {
    assert.ok(error instanceof ApiError); assert.ok(error instanceof SpeakingEvidenceError);
    assert.equal(error.status, 502); assert.equal(error.code, "AI_EVIDENCE_INVALID");
    assert.match(error.message, /Bản ghi vẫn được giữ/u);
    if (reason) assert.equal(error.reason, reason);
    caught = error; return true;
  });
  return caught!;
}
const withoutSpaces = (text: string) => text.replace(/\s+/gu, "");

function checkCatalog(text: string) {
  const source = createSpeakingEvidenceSource(text);
  assert.ok(source.catalog.length > 0 && source.catalog.length <= 512);
  assert.equal(new Set(source.catalog.map(row => row.id)).size, source.catalog.length);
  assert.equal(withoutSpaces(source.catalog.map(row => row.text).join("")), withoutSpaces(text));
  const starts = new Set<number>([0]);
  for (const part of new Intl.Segmenter("en", { granularity: "grapheme" }).segment(text)) starts.add(part.index + part.segment.length);
  let cursor = 0;
  for (const row of source.catalog) {
    assert.ok(row.text.length > 0 && row.text.length <= 1000);
    const start = text.indexOf(row.text, cursor); assert.ok(start >= cursor);
    const end = start + row.text.length;
    assert.ok(starts.has(start) && starts.has(end), "Catalog boundaries must be complete graphemes");
    assert.equal(source.quote(row.id), row.text);
    cursor = end;
  }
  return source;
}

test("Speaking catalogs provide current transcript-scoped IDs resolving exact original spans", () => {
  const transcript = "  A community workshop offers several practical classes. I enjoy learning beside the quiet garden. Our tutor explains each task clearly, and everyone has time to ask questions.  ";
  const before = transcript;
  const source = checkCatalog(transcript);
  const prefix = `spref_${createHash("sha256").update(transcript).digest("hex").slice(0, 16)}_`;
  assert.ok(source.catalog.every((row, index) => row.id === `${prefix}${index + 1}`));
  assert.ok(source.catalog.length >= 4, "Short answers have small useful source groups");
  assert.equal(source.quote(` ${source.catalog[0].id}\n`), source.catalog[0].text);
  assert.equal(transcript, before);
  assert.deepEqual(createSpeakingEvidenceSource(transcript).catalog, source.catalog);
});

test("unknown, stale and foreign IDs never fall back to literal source matching", () => {
  const source = createSpeakingEvidenceSource("We discuss practical workshops and quiet rooms every week.");
  const other = createSpeakingEvidenceSource("We discuss practical workshops and quiet rooms every month.");
  rejected(() => source.quote(other.catalog[0].id), "unknown-source-id");
  rejected(() => source.quote(source.catalog[0].id + "9"), "unknown-source-id");
  rejected(() => source.quote(source.catalog[0].id.toUpperCase()), "unknown-source-id");
  const lookalike = "spref_0000000000000000_999";
  const containsId = createSpeakingEvidenceSource(lookalike);
  rejected(() => containsId.quote(lookalike), "unknown-source-id");
  assert.equal(containsId.quote(containsId.catalog[0].id), lookalike,
    "A real ID-like utterance is returned once through a current valid source anchor");
});

test("catalog and source handles cannot be mutated to replace private original quotes", () => {
  const source = createSpeakingEvidenceSource("A quiet workshop allows careful study and useful discussions.");
  const first = source.catalog[0], original = first.text;
  assert.ok(Object.isFrozen(source)); assert.ok(Object.isFrozen(source.catalog)); assert.ok(Object.isFrozen(first));
  assert.equal(Reflect.set(first, "text", "An invented replacement"), false);
  assert.equal(Reflect.set(first, "id", "spref_foreign_1"), false);
  assert.equal(Reflect.set(source.catalog, 0, { id: first.id, text: "An invented replacement" }), false);
  assert.equal(Reflect.set(source, "quote", () => "An invented replacement"), false);
  assert.equal(source.quote(first.id), original);
});

test("legacy literal quotations preserve exact source spelling before normalisation", () => {
  const transcript = "Our organiser don’t always explain the timetable. New  visitors need advance notice.";
  const source = createSpeakingEvidenceSource(transcript);
  for (const exact of ["Our organiser don’t", "New  visitors", "the timetable."])
    assert.equal(source.quote(exact), exact);
  assert.equal(source.quote("Our organiser don't"), "Our organiser don’t");
  assert.equal(source.quote("New visitors"), "New  visitors");
});

test("format-only variants recover exact NFC, whitespace and curly-quote source slices", () => {
  const transcript = "The cafe\u0301 offers “quiet\u00a0 rooms”.\r\nLearners’ plans remain useful.";
  const source = createSpeakingEvidenceSource(transcript);
  const exact = "The cafe\u0301 offers “quiet\u00a0 rooms”.\r\nLearners’ plans";
  assert.equal(source.quote('The café offers "quiet rooms". Learners\' plans'), exact);
  assert.ok(transcript.includes(source.quote('“quiet rooms”')));
  assert.equal(source.quote('“quiet rooms”'), "“quiet\u00a0 rooms”");
});

test("grammar fixes, case changes, omissions and punctuation changes remain unsupported", () => {
  const source = createSpeakingEvidenceSource("Our tutor don’t always speak quickly. We like the quiet, bright room. The result was Ⅳ.");
  for (const quote of [
    "Our tutor doesn’t always speak quickly.", "our tutor don’t", "We like the bright room.",
    "We like the quiet bright room.", "Our tutor ... quickly.", "The result was IV.", "The result was 4.",
    "Only this unrelated prompt contains the phrase.",
  ]) rejected(() => source.quote(quote), "source-mismatch");
  assert.equal(source.quote("Our tutor don't always speak quickly."), "Our tutor don’t always speak quickly.");
});

test("Unicode groups preserve emoji, combining marks and exact repeated source occurrences", () => {
  const text = "🙂 Our cafe\u0301 workshop has a helpful tutor. The group uses 👩‍🔬 demonstrations and quiet reading rooms. Our cafe\u0301 workshop has a helpful tutor.";
  const source = checkCatalog(text);
  assert.equal(source.quote("Our café workshop"), "Our cafe\u0301 workshop");
  assert.equal(source.quote("👩‍🔬"), "👩‍🔬");
  rejected(() => source.quote("👩"), "source-mismatch");
  rejected(() => source.quote("\ud83d"), "source-mismatch");
  const whitespaceCluster = checkCatalog("A \u0301 B remains a source with complete grapheme boundaries.");
  assert.equal(whitespaceCluster.quote(" \u0301"), " \u0301");
  rejected(() => whitespaceCluster.quote("\u0301"), "source-mismatch");
});

test("long unpunctuated words and 100k Speaking sources retain complete bounded coverage", () => {
  for (const text of ["x".repeat(100_000), "x ".repeat(50_000).trim(), "😀".repeat(50_000), "a\u0301".repeat(50_000)])
    checkCatalog(text);
  const mixed = Array.from({ length: 45 }, (_, index) => `${"w ".repeat(index % 13 + 1)}${"z".repeat(1500)} `).join("");
  assert.ok(mixed.length < 100_000); checkCatalog(mixed);
});

test("quote and resolved-span limits reject oversized data without truncating source", () => {
  const text = "A" + " ".repeat(3000) + "B";
  const source = checkCatalog(text);
  rejected(() => source.quote("A B"), "oversized-span");
  rejected(() => source.quote("x".repeat(2001)), "invalid-quote");
  for (const quote of ["", " \n\t", null, undefined, {}, false])
    rejected(() => source.quote(quote as string), "invalid-quote");
  for (const input of ["", " \n\t", "x".repeat(100_001), null, undefined, {}, "\ud800"])
    rejected(() => createSpeakingEvidenceSource(input as string), "invalid-source");
  rejected(() => createSpeakingEvidenceSource("a" + "\u0301".repeat(1000)), "oversized-span");
});

test("errors retain only finite reasons, never source values, IDs or hashes", () => {
  const privateValue = "SYNTHETIC_PRIVATE_SPEAKING_VALUE_DO_NOT_EXPOSE";
  const source = createSpeakingEvidenceSource(privateValue);
  const error = rejected(() => source.quote("spref_ffff_999"), "unknown-source-id");
  for (const rendered of [error.message, error.stack, JSON.stringify(error)]) {
    assert.equal(rendered?.includes(privateValue), false);
    assert.equal(rendered?.includes(source.catalog[0].id), false);
    assert.equal(rendered?.includes("spref_ffff_999"), false);
  }
  const safe = new SpeakingEvidenceError(privateValue as SpeakingEvidenceError["reason"]);
  assert.equal(safe.reason, "invalid-quote"); assert.equal(JSON.stringify(safe).includes(privateValue), false);
});
