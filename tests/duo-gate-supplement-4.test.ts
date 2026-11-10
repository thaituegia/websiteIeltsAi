import assert from "node:assert/strict";
import { test } from "node:test";
import { contentBank, placementBank } from "../server/data/index";
import { exclusiveDuoBank } from "../server/duo-exam-content";
import { newTenDuoGatePapers, TEN_DUO_GATE_LISTENING_IDS, TEN_SUPPLEMENT_VERSION } from "../server/data/duo-gate-supplement-4";
import { gradeObjective } from "../server/learning";
import { validateContentStructure, withinAnswerLimit } from "../shared/content-visuals";
import { buildSpeechScript, chunkSpeechTurns } from "../shared/speech-script";

const canonical = (text: string) => text.normalize("NFC").toLowerCase().replace(/\s+/gu, " ").trim();

test("ten varied Gate sets add thirty private papers with grounded keys and accepted answers", () => {
  const papers = newTenDuoGatePapers(), ids = new Set(papers.map(paper => paper.id));
  assert.equal(papers.length, 30); assert.equal(ids.size, 30);
  const previous = exclusiveDuoBank().filter(paper => !ids.has(paper.id));
  assert.equal(previous.length, 517);
  const oldIds = new Set([...previous, ...contentBank].map(paper => paper.id));
  const oldSources = new Set([
    ...[...previous, ...contentBank].flatMap(paper => paper.sections.map(section => canonical(section.dialogue?.map(line => line.text).join(" ") || section.text))),
    ...placementBank.map(item => canonical(item.text)),
  ]);
  const sources = new Set<string>();
  for (const skill of ["reading", "listening", "grammar"]) assert.equal(papers.filter(paper => paper.skill === skill).length, 10);
  for (const paper of papers) {
    validateContentStructure(paper);
    assert.match(paper.id, /^duo-private-(reading|listening|grammar)-lesson-30-extra-20261110-(?:1[2-9]|2[01])$/u);
    assert.equal(oldIds.has(paper.id), false); assert.equal(paper.band, 3);
    assert.equal(paper.testType, "both"); assert.equal(paper.format, "lesson");
    assert.equal(paper.provenance?.version, TEN_SUPPLEMENT_VERSION);
    assert.equal(paper.questions.length, paper.skill === "grammar" ? 10 : 8);
    const responses = Object.fromEntries(paper.questions.map(question => [question.id, question.answer]));
    assert.ok(gradeObjective(paper, responses).answers.every(answer => answer.correct), paper.id);
    const text = canonical(paper.sections[0]!.text);
    assert.equal(oldSources.has(text), false, paper.id);
    assert.equal(sources.has(text), false, paper.id); sources.add(text);
    for (const question of paper.questions) {
      assert.ok(question.explanation.trim(), question.id);
      if (paper.skill !== "grammar") assert.ok(text.includes(canonical(question.evidence)), question.id);
      if (question.type === "text") assert.ok(withinAnswerLimit(question.answer, question.wordLimit, question.allowNumbers));
      for (const answer of question.acceptedAnswers ?? []) {
        assert.ok(withinAnswerLimit(answer, question.wordLimit, question.allowNumbers));
        assert.ok(gradeObjective(paper, { ...responses, [question.id]: answer }).answers.every(result => result.correct), `${question.id}: ${answer}`);
      }
      const wrong = question.options?.find(option => option !== question.answer) ?? "unrelated synthetic response";
      assert.equal(gradeObjective(paper, { ...responses, [question.id]: wrong }).answers.find(answer => answer.questionId === question.id)?.correct, false, question.id);
    }
  }
  assert.equal(sources.size, 30);
  assert.deepEqual(newTenDuoGatePapers(), papers);
});

test("every new Reading and Listening paper mixes genuine tasks and working input layouts", () => {
  const papers = newTenDuoGatePapers();
  for (const skill of ["reading", "listening"] as const) {
    const items = papers.filter(paper => paper.skill === skill);
    const profiles = new Set(items.map(paper => paper.questions.map(question => question.questionType).join("|")));
    assert.ok(profiles.size >= 5, `${skill}: task mixes must vary across papers`);
    for (const paper of items) {
      assert.ok(new Set(paper.questions.map(question => question.questionType)).size >= 3, paper.id);
      assert.ok(new Set(paper.questions.map(question => question.type)).size >= 3, paper.id);
      if (skill === "listening") {
        assert.ok(paper.questions.some(question => question.type === "choice"), paper.id);
        assert.ok(paper.questions.some(question => question.type === "matching"), paper.id);
      }
      for (const question of paper.questions) {
        if (question.questionType?.startsWith("matching")) {
          assert.equal(question.type, "matching"); assert.ok(question.options!.length >= 3);
        }
        if (question.questionType?.endsWith("-completion")) {
          const block = paper.sections[question.sectionIndex]!.questionBlocks?.find(block => block.id === question.blockId);
          assert.ok(block, question.id);
          assert.ok(block.questionNumbers.includes(question.number), question.id);
          if (["table", "flow-chart"].includes(block.type)) assert.ok(block.rows?.length, `${question.id}: structured layout needs real rows`);
        }
      }
    }
  }
  const listeningBlocks = new Set(papers.filter(paper => paper.skill === "listening").flatMap(paper => paper.sections.flatMap(section => section.questionBlocks?.map(block => block.type) ?? [])));
  for (const type of ["form", "table", "sentence", "flow-chart", "note"] as const) assert.ok(listeningBlocks.has(type), type);
  assert.ok(papers.filter(paper => paper.skill === "grammar" && new Set(paper.questions.map(question => question.type)).size > 1).length >= 4);
});

test("the ten varied Listening papers still need only ten bounded single-speaker requests", () => {
  const papers = newTenDuoGatePapers().filter(paper => paper.skill === "listening");
  assert.deepEqual(papers.map(paper => paper.id), TEN_DUO_GATE_LISTENING_IDS);
  let serializedCharacters = 0;
  for (const paper of papers) {
    const section = paper.sections[0]!, turns = buildSpeechScript([section]);
    assert.equal(turns.length, 1); assert.equal(turns[0]!.speaker, "Narrator"); assert.equal(turns[0]!.accent, "british");
    assert.equal(turns[0]!.text, section.text); assert.equal(chunkSpeechTurns(turns).length, 1);
    const words = section.text.split(/\s+/u).filter(Boolean).length;
    assert.ok(words >= 220 && words <= 300, paper.id); assert.ok(section.text.length < 1900, paper.id);
    const upperBound = JSON.stringify({ input: section.text }).length + 1024;
    assert.ok(upperBound <= 3000, paper.id); serializedCharacters += upperBound;
    let previousPosition = -1;
    for (const question of paper.questions) {
      const position = section.text.indexOf(question.evidence);
      assert.ok(position >= previousPosition && position >= 0, question.id); previousPosition = position;
      if (question.type === "text") assert.equal(canonical(paper.title).includes(canonical(question.answer)), false, question.id);
    }
  }
  assert.ok(serializedCharacters <= 30_000);
});
