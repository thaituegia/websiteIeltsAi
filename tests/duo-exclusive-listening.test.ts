import assert from "node:assert/strict";
import { test } from "node:test";
import { makeExclusiveListening } from "../server/data/duo-exclusive-listening";
import { contentBank } from "../server/data/index";
import { contentStructureIssues, withinAnswerLimit } from "../shared/content-visuals";
import type { ContentSection } from "../shared/types";

const spoken = (section: ContentSection) => (section.dialogue?.map(line => line.text).join(" ") ?? section.text)
  .normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase();

test("all private Listening coordinates have separate recordings, supported answers and complete IELTS paper structure", () => {
  const identifiers = new Set<string>();
  const recordings = new Set<string>();
  const publicRecordings = new Set(contentBank.filter(content => content.skill === "listening")
    .flatMap(content => content.sections.map(spoken)));
  let papers = 0;
  let sections = 0;
  for (let band = 3; band <= 8; band += 0.5) {
    for (const format of ["lesson", "full-mock"] as const) {
      for (let variant = 0; variant < (format === "lesson" ? 8 : 4); variant++) {
        const paper = makeExclusiveListening(band, variant, format);
        papers++;
        assert.equal(identifiers.has(paper.id), false);
        identifiers.add(paper.id);
        assert.match(paper.id, /^duo-private-listening-/u);
        assert.equal(contentBank.some(item => item.id === paper.id), false);
        assert.deepEqual(contentStructureIssues(paper), []);
        assert.equal(paper.questions.length, format === "lesson" ? 8 : 40);
        assert.equal(paper.sections.length, format === "lesson" ? 1 : 4);
        assert.deepEqual(paper.questions.map(question => question.number), Array.from({ length: paper.questions.length }, (_, index) => index + 1));
        for (const [index, section] of paper.sections.entries()) {
          sections++;
          const text = spoken(section);
          assert.equal(recordings.has(text), false, `Previously used recording: ${section.id}`);
          assert.equal(publicRecordings.has(text), false, `Public recording reused: ${section.id}`);
          recordings.add(text);
          assert.ok(text.split(/\s+/u).length >= 400, "A recording needs substantive contextual speech.");
          assert.ok(section.dialogue?.length);
          assert.equal(new Set(section.dialogue!.map(line => line.speaker)).size, format === "lesson" || index === 0 || index === 2 ? 2 : 1);
          assert.ok(section.dialogue!.every(line => !/^(?:Coordinator|Visitor|Programme leader|Research student|Project tutor|Lecturer):/u.test(line.text)));
          assert.equal(identifiers.has(section.id), false);
          identifiers.add(section.id);
        }
        for (const question of paper.questions) {
          assert.equal(identifiers.has(question.id), false);
          identifiers.add(question.id);
          assert.ok(paper.sections[question.sectionIndex]!.text.includes(question.evidence));
          assert.ok(question.evidence.includes(question.answer));
          if (question.type === "text") assert.ok(withinAnswerLimit(question.answer, question.wordLimit, question.allowNumbers));
          else {
            assert.ok(question.options?.includes(question.answer));
            assert.equal(new Set(question.options).size, question.options!.length);
          }
        }
      }
    }
  }
  assert.equal(papers, 132);
  assert.equal(sections, 264);
});

test("private Listening construction is deterministic and does not share mutable paper objects", () => {
  const first = makeExclusiveListening(5, 2, "full-mock");
  const expected = structuredClone(first);
  first.sections[0]!.dialogue![0]!.text = "A caller must not mutate the next paper.";
  first.questions[0]!.answer = "changed";
  assert.deepEqual(makeExclusiveListening(5, 2, "full-mock"), expected);
  assert.notDeepEqual(makeExclusiveListening(5, 2, "lesson").sections[0]!.dialogue, expected.sections[0]!.dialogue);
});

test("private Listening refuses unsupported bank coordinates", () => {
  for (const band of [NaN, Infinity, 2.5, 8.5, 3.2]) assert.throws(() => makeExclusiveListening(band, 0, "lesson"));
  for (const variant of [-1, 0.5, NaN, 8]) assert.throws(() => makeExclusiveListening(3, variant, "lesson"));
  assert.throws(() => makeExclusiveListening(3, 4, "full-mock"));
});
