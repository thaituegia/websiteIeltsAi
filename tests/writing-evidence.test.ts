import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "../server/errors";
import { createWritingEvidenceSource, writingParagraphs } from "../server/writing-evidence";

function rejected(callback: () => unknown): void {
  assert.throws(callback, error => error instanceof ApiError && error.status === 502 && error.code === "AI_EVIDENCE_INVALID");
}

test("Writing paragraphs recognise actual line endings and keep exact nonempty source chunks", () => {
  const text = "  A community garden is useful.\r\n\r\n  Local volunteers maintain the paths.\n\t\nResidents can grow vegetables.\rChildren enjoy the activities.\u2028Public spaces bring people together.\u2029   ";
  const blocks = writingParagraphs(text);
  assert.deepEqual(blocks, ["A community garden is useful.", "Local volunteers maintain the paths.", "Residents can grow vegetables.", "Children enjoy the activities.", "Public spaces bring people together."]);
  assert.ok(blocks.every(block => text.includes(block)));
  assert.deepEqual(writingParagraphs("A long sentence wraps visually in a textarea but has no real line break."),
    ["A long sentence wraps visually in a textarea but has no real line break."]);
  assert.deepEqual(writingParagraphs(" \n\r\n\t\u2028\u2029"), []);
});

test("single LF and CRLF paragraph evidence is scoped to the explicit server index", () => {
  for (const newline of ["\n", "\r\n", "\r", "\u2028", "\u2029", "\n\n"]) {
    const source = createWritingEvidenceSource(`Community parks are valuable.${newline}Local councils can improve access.`);
    assert.equal(source.paragraphs.length, 2);
    assert.equal(source.paragraphQuote(1, "Local councils"), "Local councils");
    rejected(() => source.paragraphQuote(0, "Local councils"));
    for (const index of [-1, 2, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) rejected(() => source.paragraphQuote(index, "Local councils"));
  }
});

test("exact quotations are returned byte-for-byte before applying format equivalence", () => {
  const text = "The café serves tea.\nThe cafe\u0301 serves tea.  Learners don’t need expensive tools. Learners don't need expensive tools.";
  const source = createWritingEvidenceSource(text);
  for (const exact of ["café", "cafe\u0301", "serves tea.\nThe", "  Learners don’t", "Learners don't", "don’t"])
    assert.equal(source.quote(exact), exact);
  assert.equal(source.text, text);
});

test("benign whitespace and typography map back to the original learner spelling", () => {
  const text = "I don’t think the plan is expensive.\r\nA café\u00a0\u00a0can serve\ttea.\nHe calls it “a shared space”.";
  const source = createWritingEvidenceSource(text);
  assert.equal(source.quote("I don't think the plan is expensive."), "I don’t think the plan is expensive.");
  assert.equal(source.quote("A cafe\u0301 can serve tea."), "A café\u00a0\u00a0can serve\ttea.");
  assert.equal(source.quote('He calls it "a shared space".'), "He calls it “a shared space”.");
  assert.equal(source.quote("expensive. A café"), "expensive.\r\nA café");
  assert.equal(source.paragraphQuote(1, "A café can serve tea."), "A café\u00a0\u00a0can serve\ttea.");
  rejected(() => source.paragraphQuote(0, "A café can serve tea."));
  assert.equal(source.text, text, "Formatting repairs never change the submitted essay");
});

test("Unicode offset recovery preserves combining accents and surrounding emoji", () => {
  const text = "🙂 Learners meet at the cafe\u0301\u00a0after class. 👩🏽‍💻 The idea is ‘practical’.";
  const source = createWritingEvidenceSource(text);
  assert.equal(source.quote("café after class."), "cafe\u0301\u00a0after class.");
  assert.equal(source.quote("🙂 Learners meet at the café"), "🙂 Learners meet at the cafe\u0301");
  assert.equal(source.quote("👩🏽‍💻 The idea is 'practical'."), "👩🏽‍💻 The idea is ‘practical’.");
  assert.equal(source.quote("after class. 👩🏽‍💻"), "after class. 👩🏽‍💻");
  rejected(() => source.quote("👩🏽‍💻 The idea is 'practical'. MORE"));
});

test("normalised matches cannot expand a partial grapheme into invented evidence", () => {
  const source = createWritingEvidenceSource("A 👩🏽‍💻 café is busy.");
  // These variants do not exist exactly and would start/end inside the joined
  // emoji's grapheme after canonical matching. Recovering the whole emoji would
  // produce a different quote, which must not be accepted.
  rejected(() => source.quote("💻 cafe\u0301"));
  rejected(() => source.quote("A 👩🏽" + "\u00a0"));
});

test("evidence matching never fixes grammar or accepts omissions, punctuation changes or a prompt", () => {
  const source = createWritingEvidenceSource("Children is interested in plants. The library opens at six-thirty. A cafe\u0301 provides tea. My friend said ‘yes’." );
  for (const invalid of [
    "Children are interested in plants.", "children is interested in plants.", "Children interested in plants.",
    "Children ... plants.", "Children is interested in plants!", "The library opens at six thirty.",
    "The library opens at 6:30.", "My friend said yes.", "Advertising should be banned.",
    "A café provides coffee.", "", " ", "\n\t", "x".repeat(2001),
  ]) rejected(() => source.quote(invalid));
  assert.equal(source.quote("A café provides tea."), "A cafe\u0301 provides tea.");
});

test("NFC is allowed while compatibility characters and punctuation stay distinct", () => {
  const source = createWritingEvidenceSource("The oﬃce has fullwidth Ａ signs. A plan–a draft—takes time. She calls it a café." );
  for (const invalid of ["The office has", "fullwidth A signs", "plan-a draft", "a draft-takes time", "She calls it a CAFE."])
    rejected(() => source.quote(invalid));
  assert.equal(source.quote("cafe\u0301"), "café");
});

test("a quote belongs only to its essay and exposed paragraph metadata cannot alter scope", () => {
  const first = createWritingEvidenceSource("A school garden supports learning.\nPupils observe real plants.");
  const second = createWritingEvidenceSource("A town library supports reading.\nVisitors can borrow books.");
  rejected(() => second.quote("school garden"));
  rejected(() => first.quote("Visitors can borrow books."));
  first.paragraphs[1] = "Visitors can borrow books.";
  first.paragraphs.push("A fabricated paragraph.");
  assert.equal(first.paragraphQuote(1, "Pupils observe"), "Pupils observe");
  rejected(() => first.paragraphQuote(1, "Visitors can borrow books."));
  rejected(() => first.paragraphQuote(2, "A fabricated paragraph."));
});

test("a bounded long source remains reusable across many evidence lookups", () => {
  const text = `${"Synthetic text about shared resources. ".repeat(1_400)}An actual cafe\u0301\u00a0serves tea.`;
  assert.ok(text.length < 60_000);
  const source = createWritingEvidenceSource(text);
  for (let index = 0; index < 100; index++) assert.equal(source.quote("An actual café serves tea."), "An actual cafe\u0301\u00a0serves tea.");
  rejected(() => createWritingEvidenceSource("x".repeat(60_001)));
});
