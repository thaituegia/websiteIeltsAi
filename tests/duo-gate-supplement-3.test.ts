import assert from "node:assert/strict";
import { test } from "node:test";
import { validateContentStructure, withinAnswerLimit } from "../shared/content-visuals";
import { buildSpeechScript, chunkSpeechTurns } from "../shared/speech-script";
import { contentBank, placementBank } from "../server/data/index";
import { exclusiveDuoBank } from "../server/duo-exam-content";
import { newDuoGatePapers } from "../server/data/duo-gate-supplement";
import { newAdditionalDuoGatePapers } from "../server/data/duo-gate-supplement-2";
import { newFiveDuoGatePapers, FIVE_DUO_GATE_LISTENING_IDS, FIVE_SUPPLEMENT_VERSION } from "../server/data/duo-gate-supplement-3";
import { gradeObjective } from "../server/learning";

const canonical = (text: string) => text.normalize("NFC").toLowerCase().replace(/\s+/gu, " ").trim();

test("five further Gate sets contain fifteen new private papers with valid keys and accepted alternatives", () => {
  const papers = newFiveDuoGatePapers();
  const newIds = new Set(papers.map(paper => paper.id));
  assert.equal(papers.length, 15);
  assert.equal(newIds.size, 15);
  const previous = exclusiveDuoBank().filter(paper => !newIds.has(paper.id));
  assert.equal(previous.length, 502);
  const oldIds = new Set([...contentBank, ...previous].map(paper => paper.id));
  const oldSources = new Set([
    ...[...contentBank, ...previous].flatMap(paper => paper.sections.map(section => canonical(section.dialogue?.map(line => line.text).join(" ") || section.text))),
    ...placementBank.map(item => canonical(item.text)),
  ]);
  for (const skill of ["reading", "listening", "grammar"])
    assert.equal(papers.filter(paper => paper.skill === skill).length, 5);
  const newSources = new Set<string>();
  for (const paper of papers) {
    validateContentStructure(paper);
    assert.equal(paper.band, 3);
    assert.equal(paper.cefr, "A2");
    assert.equal(paper.testType, "both");
    assert.equal(paper.format, "lesson");
    assert.equal(paper.provenance?.version, FIVE_SUPPLEMENT_VERSION);
    assert.equal(oldIds.has(paper.id), false);
    assert.match(paper.id, /^duo-private-(reading|listening|grammar)-lesson-30-extra-20261110-(?:7|8|9|10|11)$/u);
    assert.equal(paper.questions.length, paper.skill === "grammar" ? 10 : 8);
    assert.deepEqual(paper.questions.map(question => question.number), Array.from({ length: paper.questions.length }, (_, index) => index + 1));
    const responses = Object.fromEntries(paper.questions.map(question => [question.id, question.answer]));
    assert.ok(gradeObjective(paper, responses).answers.every(answer => answer.correct), paper.id);
    for (const question of paper.questions) {
      assert.ok(question.explanation.trim());
      if (question.type === "text") assert.ok(withinAnswerLimit(question.answer, question.wordLimit, question.allowNumbers));
      if (question.type === "choice") {
        assert.equal(question.options?.length, 4);
        assert.equal(new Set(question.options).size, 4);
        assert.equal(question.options?.filter(option => option === question.answer).length, 1);
      }
      for (const answer of question.acceptedAnswers ?? []) {
        assert.ok(withinAnswerLimit(answer, question.wordLimit, question.allowNumbers));
        assert.ok(gradeObjective(paper, { ...responses, [question.id]: answer }).answers.every(row => row.correct), paper.id + ": " + answer);
      }
    }
    const source = canonical(paper.sections[0]!.text);
    assert.equal(oldSources.has(source), false, paper.id);
    assert.equal(newSources.has(source), false, paper.id);
    newSources.add(source);
    if (paper.skill !== "grammar") for (const question of paper.questions)
      assert.ok(source.includes(canonical(question.evidence)), paper.id + ": evidence " + question.number);
  }
  assert.equal(newSources.size, 15);
  assert.equal([...newDuoGatePapers(), ...newAdditionalDuoGatePapers()].some(paper => newIds.has(paper.id)), false);
  assert.deepEqual(newFiveDuoGatePapers(), papers);
});

test("the five new Reading passages provide substantial distinct sources and mixed evidence tasks", () => {
  for (const paper of newFiveDuoGatePapers().filter(paper => paper.skill === "reading")) {
    const words = paper.sections[0]!.text.split(/\s+/u).filter(Boolean).length;
    assert.ok(words >= 250 && words <= 350, paper.id + ": " + words + " words");
    assert.ok(paper.questions.some(question => question.type === "choice"));
    assert.ok(paper.questions.some(question => question.type === "text"));
    assert.deepEqual(new Set(paper.questions.filter(question => question.type === "true-false").map(question => question.answer)), new Set(["TRUE", "FALSE", "NOT GIVEN"]));
  }
});

test("the third batch contains exactly five bounded British monologues with eight ordered supported notes each", () => {
  const papers = newFiveDuoGatePapers().filter(paper => paper.skill === "listening");
  assert.deepEqual(papers.map(paper => paper.id), FIVE_DUO_GATE_LISTENING_IDS);
  let serializedCharacters = 0;
  for (const paper of papers) {
    const section = paper.sections[0]!;
    const turns = buildSpeechScript([section]);
    assert.equal(turns.length, 1);
    assert.equal(turns[0]!.speaker, "Narrator");
    assert.equal(turns[0]!.accent, "british");
    assert.equal(turns[0]!.text, section.text);
    assert.equal(chunkSpeechTurns(turns).length, 1);
    assert.ok(section.text.length < 1900);
    const words = section.text.split(/\s+/u).filter(Boolean).length;
    assert.ok(words >= 220 && words <= 300, paper.id + ": " + words + " words");
    const upperBound = JSON.stringify({ input: section.text }).length + 1024;
    assert.ok(upperBound <= 3000, paper.id + ": request headroom");
    serializedCharacters += upperBound;
    let lastPosition = -1;
    for (const question of paper.questions) {
      const position = section.text.indexOf(question.evidence);
      assert.ok(position > lastPosition, paper.id + ": note " + question.number + " follows audio");
      lastPosition = position;
      assert.equal(question.wordLimit, 3);
      assert.equal(question.allowNumbers, true);
      assert.ok(question.evidence.includes(question.answer));
      assert.equal(canonical(paper.title).includes(canonical(question.answer)), false, paper.id + ": title must not reveal a keyed answer");
    }
  }
  assert.ok(serializedCharacters <= 15000);
});
