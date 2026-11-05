import assert from "node:assert/strict";
import { test } from "node:test";
import { contentStructureIssues } from "../shared/content-visuals";
import { contentBank } from "../server/data/index";
import { makeExclusiveGrammar, makeExclusiveSpeaking, makeExclusiveWriting } from "../server/data/duo-exclusive-support";
import { buildWritingGuides } from "../server/writing-guidance";
import type { StoredContent } from "../shared/types";

const all: StoredContent[] = [];
for (let bandIndex = 0; bandIndex < 11; bandIndex++) {
  const band = 3 + bandIndex / 2;
  for (let variant = 0; variant < 8; variant++) all.push(makeExclusiveGrammar(band, variant));
  for (let variant = 0; variant < 4; variant++)
    all.push(makeExclusiveWriting(band, variant, "academic"), makeExclusiveWriting(band, variant, "general"), makeExclusiveSpeaking(band, variant));
}
const normal = (text: string) => text.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase();

test("all 220 reserved support papers have valid structure and globally unique identifiers", () => {
  assert.equal(all.length, 220);
  assert.equal(new Set(all.map(item => item.id)).size, all.length);
  const sectionIds = new Set<string>();
  const questionIds = new Set<string>();
  for (const paper of all) {
    assert.match(paper.id, /^duo-private-(?:grammar|writing|speaking)-/);
    assert.deepEqual(contentStructureIssues(paper), [], paper.id);
    assert.equal(paper.source, "authored");
    assert.equal(paper.quality, "authored-unreviewed");
    for (const section of paper.sections) {
      assert.ok(!sectionIds.has(section.id), section.id);
      sectionIds.add(section.id);
    }
    for (const question of paper.questions) {
      assert.ok(!questionIds.has(question.id), question.id);
      questionIds.add(question.id);
    }
  }
});

test("reserved papers and all their section texts are absent from the public bank", () => {
  const publicIds = new Set(contentBank.map(item => item.id));
  const publicText = new Set(contentBank.flatMap(item => item.sections.map(section => normal(section.text))));
  for (const paper of all) {
    assert.ok(!publicIds.has(paper.id), paper.id);
    for (const section of paper.sections) assert.ok(!publicText.has(normal(section.text)), `${paper.id}/${section.id}`);
  }
});

test("all writing essays are distinct across bands, variants and Academic/General profiles", () => {
  const writing = all.filter(item => item.skill === "writing");
  assert.equal(writing.length, 88);
  const essays = writing.map(item => normal(item.sections.find(section => section.task === 2)!.text));
  assert.equal(new Set(essays).size, essays.length);
  for (const paper of writing) {
    assert.equal(paper.durationMinutes, 60);
    assert.deepEqual(paper.sections.map(section => section.task), [1, 2]);
    assert.match(paper.sections[0].instructions!, /150 words/u);
    assert.match(paper.sections[1].instructions!, /250 words/u);
    if (paper.testType === "academic") {
      const table = paper.sections[0].visuals![0];
      assert.equal(table.type, "table");
      assert.ok("rows" in table);
      assert.equal(table.rows.length, 3);
      assert.equal(table.series.length, 3);
      for (const row of table.rows) assert.ok(row.values.every(value => Number.isInteger(value) && value >= 0));
    } else {
      assert.equal(paper.sections[0].visuals, undefined);
      assert.equal(paper.sections[0].cuePoints?.length, 3);
      assert.match(paper.sections[0].instructions!, /Dear Sir or Madam/u);
    }
  }
});

test("all Speaking long turns and interview sets are unique and retain full test timing", () => {
  const speaking = all.filter(item => item.skill === "speaking");
  assert.equal(speaking.length, 44);
  assert.equal(new Set(speaking.map(item => normal(item.sections[1].text))).size, speaking.length);
  assert.equal(new Set(speaking.map(item => normal(item.sections[0].text))).size, speaking.length);
  assert.equal(new Set(speaking.map(item => normal(item.sections[2].text))).size, speaking.length);
  for (const paper of speaking) {
    assert.equal(paper.sections.length, 3);
    assert.equal(paper.durationMinutes, 14);
    assert.equal(paper.sections[0].text.split(/\n\n/u).length, 6);
    assert.equal(paper.sections[1].cuePoints?.length, 4);
    assert.match(paper.sections[1].instructions!, /one minute to prepare/u);
    assert.equal(paper.sections[2].text.split(/\n\n/u).length, 6);
  }
});

test("all grammar papers use distinct situations/questions with one keyed choice", () => {
  const grammar = all.filter(item => item.skill === "grammar");
  assert.equal(grammar.length, 88);
  assert.equal(new Set(grammar.map(item => normal(item.sections[0].text))).size, grammar.length);
  assert.equal(new Set(grammar.flatMap(item => item.questions.map(question => normal(question.prompt)))).size, 880);
  for (const paper of grammar) {
    assert.equal(paper.questions.length, 10);
    for (const question of paper.questions) {
      assert.equal(question.options?.filter(option => option === question.answer).length, 1);
      assert.equal(new Set(question.options).size, 4);
      assert.ok(!question.evidence.includes("___"));
      assert.ok(question.explanation.length > 20);
    }
  }
});

test("invalid coordinates refuse rather than reusing an existing reserved paper", () => {
  for (const band of [NaN, Infinity, 2.5, 8.5, 3.1])
    for (const build of [makeExclusiveGrammar, makeExclusiveSpeaking, makeExclusiveWriting]) assert.throws(() => build(band, 0));
  assert.throws(() => makeExclusiveGrammar(3, 8));
  assert.throws(() => makeExclusiveSpeaking(3, 4));
  assert.throws(() => makeExclusiveWriting(3, -1));
});

test("all 88 Writing papers preserve original post-submission models and Vietnamese guides", () => {
  const writing = all.filter(item => item.skill === "writing");
  const publicSamples = new Set(contentBank.flatMap(item => (item.referenceAnswers ?? []).map(reference => normal(reference.sampleAnswer))));
  const privateSamples = new Set<string>();
  let references = 0;
  for (const paper of writing) {
    assert.equal(paper.referenceAnswers?.length, 2, paper.id);
    for (const [index, reference] of paper.referenceAnswers!.entries()) {
      assert.equal(reference.sectionId, paper.sections[index].id);
      const words = reference.sampleAnswer.trim().split(/\s+/u).length;
      assert.ok(words >= (index === 0 ? 150 : 250), `${paper.id}/${index}: ${words} words`);
      assert.ok(reference.explanation.length > 100);
      assert.ok(reference.keyPoints.length >= 3);
      const text = normal(reference.sampleAnswer);
      assert.ok(!publicSamples.has(text), paper.id);
      assert.ok(!privateSamples.has(text), paper.id);
      privateSamples.add(text);
      references++;
      assert.ok(reference.sampleAnswer.includes("\n\n"));
    }
    const guides = buildWritingGuides(paper, paper.referenceAnswers!, { sourceVerified: true });
    assert.equal(guides.length, 2, paper.id);
    assert.deepEqual(guides.map(guide => guide.task), [1, 2]);
    for (const guide of guides) {
      assert.equal(guide.sourceVerified, true);
      assert.ok(guide.analysis.length > 0);
      assert.ok(guide.steps.length > 0);
      assert.ok(guide.paragraphs.length > 0);
    }
  }
  assert.equal(references, 176);
});

test("Academic table models quote the exact nine figures, labels, years and unit", () => {
  for (const paper of all.filter(item => item.skill === "writing" && item.testType === "academic")) {
    const table = paper.sections[0].visuals![0];
    assert.ok("rows" in table);
    const sample = paper.referenceAnswers![0].sampleAnswer;
    for (const row of table.rows) {
      assert.ok(sample.toLowerCase().includes(row.label.toLowerCase()));
      for (const value of row.values) assert.match(sample, new RegExp(`\\b${value}\\b`, "u"));
    }
    for (const year of table.series) assert.ok(sample.includes(year));
    assert.ok(sample.includes("people per week"));
    assert.ok(sample.includes("peak"));
    assert.ok(!/\bcaused by\b|\bas a result of\b/iu.test(sample));
  }
});
