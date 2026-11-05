import assert from "node:assert/strict";
import { test } from "node:test";
import { contentStructureIssues, withinAnswerLimit } from "../shared/content-visuals";
import { contentBank } from "../server/data/index";
import { makeExclusiveReading } from "../server/data/duo-exclusive-reading";

const catalog = Array.from({ length: 11 }, (_unused, index) => 3 + index * 0.5)
  .flatMap(band => (["lesson", "full-mock"] as const).flatMap(format =>
    Array.from({ length: format === "lesson" ? 8 : 4 }, (_unused, variant) => makeExclusiveReading(band, variant, format))));
const normalize = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

test("every private Reading paper has complete IELTS structure and source-backed answer material", () => {
  assert.equal(catalog.length, 132);
  for (const content of catalog) {
    assert.deepEqual(contentStructureIssues(content), [], content.id);
    assert.equal(content.skill, "reading");
    assert.equal(content.source, "authored");
    assert.equal(content.quality, "authored-unreviewed");
    assert.equal(content.testType, "both");
    assert.equal(content.questions.length, content.format === "lesson" ? 8 : 40);
    assert.equal(content.sections.length, content.format === "lesson" ? 1 : 3);
    for (const question of content.questions) {
      assert.ok(question.evidence.length > 0, question.id);
      assert.ok(content.sections[question.sectionIndex].text.includes(question.evidence), question.id);
      if (question.type === "text") assert.ok(withinAnswerLimit(question.answer, question.wordLimit, question.allowNumbers), question.id);
    }
  }
});

test("gate and promotion papers never share source texts or scoped question identities", () => {
  const ids = new Set<string>();
  const sections = new Set<string>();
  const prompts = new Set<string>();
  const facts = new Set<string>();
  for (const content of catalog) {
    assert.ok(!ids.has(content.id), content.id);
    ids.add(content.id);
    for (const section of content.sections) {
      const text = normalize(section.text);
      assert.ok(!sections.has(text), section.id);
      sections.add(text);
      // Changing only a title, location or person's name cannot satisfy this
      // assertion: the intervention, equipment, month, duration and reported
      // outcome data must form a different source profile as well.
      const profile = [
        section.text.match(/The immediate aim was to ([^.]+)\./u)?.[1],
        section.text.match(/The team introduced ([^.]+)\./u)?.[1],
        section.text.match(/staff used ([^.]+?) to put/u)?.[1],
        section.text.match(/The project began in ([^,]+)/u)?.[1],
        section.text.match(/The trial lasted ([^.]+)\./u)?.[1],
        section.text.match(/It stood at ([^.]+)\./u)?.[1],
      ];
      assert.ok(profile.every(value => typeof value === "string" && value.length > 0), section.id);
      const fingerprint = JSON.stringify(profile);
      assert.ok(!facts.has(fingerprint), section.id);
      facts.add(fingerprint);
    }
    for (const question of content.questions) {
      assert.ok(!ids.has(question.id), question.id);
      ids.add(question.id);
      assert.ok(!prompts.has(question.prompt), question.id);
      prompts.add(question.prompt);
    }
  }
  assert.equal(sections.size, 220);
  assert.equal(prompts.size, 2464);
});

test("private Reading sources are not a republished public lesson or mock", () => {
  const publicSources = new Set(contentBank.filter(content => content.skill === "reading")
    .flatMap(content => content.sections.map(section => normalize(section.text))));
  for (const content of catalog) for (const section of content.sections)
    assert.equal(publicSources.has(normalize(section.text)), false, section.id);
  assert.ok(contentBank.every(content => !content.id.startsWith("duo-private-reading-")));
});

test("full mocks contain substantial passages and answer patterns are not a fixed T/F sequence", () => {
  const patterns = new Set<string>();
  const comparisonHeadings = new Set<string>();
  for (const content of catalog) {
    if (content.format === "full-mock") {
      assert.deepEqual(content.sections.map((_section, index) => content.questions.filter(question => question.sectionIndex === index).length), [13, 13, 14]);
      for (const section of content.sections) assert.ok(section.text.split(/\s+/u).length >= 700, section.id);
      for (const question of content.questions.filter(question => question.questionType === "matching-headings")) comparisonHeadings.add(question.answer);
    }
    patterns.add(content.questions.filter(question => question.type === "true-false").map(question => question.answer).join("/"));
  }
  assert.ok(patterns.size >= 6);
  assert.equal(comparisonHeadings.size, 3);
});

test("private factory is deterministic and rejects unsupported bank coordinates", () => {
  assert.deepEqual(makeExclusiveReading(6.5, 2, "full-mock"), makeExclusiveReading(6.5, 2, "full-mock"));
  for (const band of [2.5, 8.5, 3.25, Number.NaN, Number.POSITIVE_INFINITY]) assert.throws(() => makeExclusiveReading(band, 0, "lesson"));
  for (const variant of [-1, 1.2, 8, Number.NaN]) assert.throws(() => makeExclusiveReading(5, variant, "lesson"));
  assert.throws(() => makeExclusiveReading(5, 4, "full-mock"));
});
