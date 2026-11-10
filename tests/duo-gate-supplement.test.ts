import assert from "node:assert/strict";
import { test } from "node:test";
import { validateContentStructure } from "../shared/content-visuals";
import { buildSpeechScript, chunkSpeechTurns } from "../shared/speech-script";
import { contentBank, placementBank } from "../server/data/index";
import { newDuoGatePapers, NEW_DUO_GATE_LISTENING_IDS, SUPPLEMENT_VERSION } from "../server/data/duo-gate-supplement";
import { gradeObjective } from "../server/learning";

const canonical = (value: string) => value.normalize("NFC").toLowerCase().replace(/\s+/gu, " ").trim();

test("three new complete Gate sets are separate from public study content and accept every keyed answer", () => {
  const papers = newDuoGatePapers();
  assert.equal(papers.length, 9);
  assert.equal(new Set(papers.map(paper => paper.id)).size, 9);
  const publicIds = new Set(contentBank.map(paper => paper.id));
  const publicSources = new Set([
    ...contentBank.flatMap(paper => paper.sections.map(section => canonical(section.dialogue?.map(line => line.text).join(" ") || section.text))),
    ...placementBank.map(item => canonical(item.text)),
  ]);
  for (const skill of ["reading", "listening", "grammar"])
    assert.equal(papers.filter(paper => paper.skill === skill).length, 3);
  for (const paper of papers) {
    validateContentStructure(paper);
    assert.equal(paper.band, 3);
    assert.equal(paper.cefr, "A2");
    assert.equal(paper.testType, "both");
    assert.equal(paper.format, "lesson");
    assert.equal(paper.provenance?.version, SUPPLEMENT_VERSION);
    assert.equal(publicIds.has(paper.id), false);
    assert.match(paper.id, /^duo-private-(reading|listening|grammar)-lesson-30-extra-20261110-[123]$/u);
    assert.equal(paper.questions.length, paper.skill === "grammar" ? 10 : 8);
    assert.deepEqual(paper.questions.map(question => question.number), Array.from({ length: paper.questions.length }, (_, index) => index + 1));
    const responses = Object.fromEntries(paper.questions.map(question => [question.id, question.answer]));
    assert.ok(gradeObjective(paper, responses).answers.every(answer => answer.correct), paper.id);
    for (const question of paper.questions) {
      assert.ok(question.explanation.trim());
      for (const answer of question.acceptedAnswers ?? [])
        assert.ok(gradeObjective(paper, { ...responses, [question.id]: answer }).answers.every(result => result.correct), `${paper.id}: ${answer}`);
    }
    if (paper.skill !== "grammar") {
      const text = canonical(paper.sections[0]!.text);
      assert.equal(publicSources.has(text), false, paper.id);
      for (const question of paper.questions)
        assert.ok(text.includes(canonical(question.evidence)), `${paper.id} evidence ${question.number}`);
    }
  }
  assert.equal(new Set(papers.filter(paper => paper.skill !== "grammar").map(paper => canonical(paper.sections[0]!.text))).size, 6);
});

test("new Reading passages have distinct sufficient sources and balanced evidence tasks", () => {
  for (const paper of newDuoGatePapers().filter(paper => paper.skill === "reading")) {
    const words = paper.sections[0]!.text.split(/\s+/u).filter(Boolean).length;
    assert.ok(words >= 250 && words <= 350, `${paper.id}: ${words} words`);
    assert.ok(paper.questions.some(question => question.type === "choice"));
    assert.ok(paper.questions.some(question => question.type === "text"));
    assert.deepEqual(new Set(paper.questions.filter(question => question.type === "true-false").map(question => question.answer)), new Set(["TRUE", "FALSE", "NOT GIVEN"]));
  }
});

test("new Listening uses exactly three short single-speaker scripts within the bounded generation allowance", () => {
  const papers = newDuoGatePapers().filter(paper => paper.skill === "listening");
  assert.deepEqual(papers.map(paper => paper.id), NEW_DUO_GATE_LISTENING_IDS);
  let serializedCharacters = 0;
  for (const paper of papers) {
    const section = paper.sections[0]!;
    const turns = buildSpeechScript([section]);
    assert.equal(turns.length, 1);
    assert.equal(turns[0]!.speaker, "Narrator");
    assert.equal(turns[0]!.accent, "british");
    assert.equal(turns[0]!.text, section.text);
    assert.equal(chunkSpeechTurns(turns).length, 1);
    assert.ok(section.text.length < 2000);
    const words = section.text.split(/\s+/u).filter(Boolean).length;
    assert.ok(words >= 220 && words <= 300);
    // Reserve headroom for model, voice, instructions and request serialization.
    const upperBound = JSON.stringify({ input: section.text }).length + 1024;
    assert.ok(upperBound <= 3000, `${paper.id}: request headroom`);
    serializedCharacters += upperBound;
    let lastPosition = -1;
    for (const question of paper.questions) {
      const position = section.text.indexOf(question.evidence);
      assert.ok(position > lastPosition, `${paper.id}: question ${question.number} follows the recording`);
      lastPosition = position;
      assert.equal(question.wordLimit, 3);
      assert.equal(question.allowNumbers, true);
    }
  }
  assert.ok(serializedCharacters <= 9000);
});
