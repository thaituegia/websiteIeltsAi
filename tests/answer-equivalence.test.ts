import assert from "node:assert/strict";
import { test } from "node:test";
import type { StoredContent, StoredQuestion } from "../shared/types";
import { gradeObjective } from "../server/learning";
import { matchingEquivalentShortAnswer } from "../server/answer-equivalence";

function fixture(
  answer: string,
  prompt: string,
  evidence: string,
  overrides: Partial<StoredQuestion> = {},
  skill: StoredContent["skill"] = "reading",
): StoredContent {
  return {
    id: "synthetic-answer-equivalence", title: "A classroom garden", skill,
    description: "Synthetic answer marking fixture", topic: "Education", band: 3,
    cefr: "A2", testType: "academic", durationMinutes: 10, format: "lesson",
    sections: [{ id: "section", title: "A classroom garden", text: evidence }],
    questions: [{ id: "answer", number: 1, type: "text", questionType: "short-answer",
      prompt: `${prompt} Write NO MORE THAN 2 WORDS from the text.`, answer,
      evidence, explanation: "The source identifies the requested object.",
      wordLimit: 2, sectionIndex: 0, subskill: "detail", ...overrides }],
    vocabularyIds: [], tags: [], source: "authored", quality: "authored-unreviewed",
    createdAt: "2026-11-05T00:00:00.000Z",
  };
}
function correct(content: StoredContent, response: string): boolean {
  return gradeObjective(content, { answer: response }).answers[0]!.correct;
}

test("the reported container-kind answer accepts singular/plural without changing the stored key or response", () => {
  for (const skill of ["reading", "listening"] as const) {
    const content = fixture("yoghurt pots", "What kind of old container do the children reuse?", "The children use old yoghurt pots.", {}, skill);
    for (const response of ["yoghurt pots", "Yoghurt pot", "  YOGHURT   POT  "]) {
      const feedback = gradeObjective(content, { answer: response });
      assert.equal(feedback.rawScore, 1, `${skill}: ${response}`);
      assert.equal(feedback.answers[0]!.answer, "yoghurt pots");
      assert.equal(feedback.answers[0]!.response, response);
    }
  }
});

test("the reported article answer accepts the actual source phrase in reading and listening", () => {
  for (const skill of ["reading", "listening"] as const) {
    const content = fixture("tray", "What keeps water off the floor?", "A tray under the pots keeps the floor dry.", {}, skill);
    for (const response of ["tray", "A tray", "  a   TRAY  "]) assert.equal(correct(content, response), true, response);
    for (const response of ["an tray", "a table", "water tray", "trays"]) assert.equal(correct(content, response), false, response);
  }
});

test("removing an article from a standalone source answer keeps the identified object", () => {
  const content = fixture("the tray", "What catches the extra water?", "The tray catches the extra water.");
  assert.equal(correct(content, "tray"), true);
  assert.equal(correct(content, "the tray"), true);
  assert.equal(correct(content, "an tray"), false);
});

test("category questions support conservative regular noun inflections and retain every modifier", () => {
  for (const [answer, response] of [["plastic boxes", "plastic box"], ["batteries", "battery"], ["buses", "bus"], ["shelves", "shelf"], ["wooden benches", "wooden bench"]]) {
    const content = fixture(answer!, "Which type of equipment is reused?", `The collection includes ${answer}.`);
    assert.equal(correct(content, response!), true, response);
  }
  const content = fixture("glass bottles", "What kind of containers are collected?", "The volunteers collect glass bottles.");
  for (const response of ["glass bottle", "glass bottles"]) assert.equal(correct(content, response), true);
  for (const response of ["bottle", "plastic bottle", "bottle glass", "glass jar"]) assert.equal(correct(content, response), false, response);
});

test("word and number limits still apply before accepting a phrase variant", () => {
  const oneWord = fixture("tray", "What catches the water?", "A tray catches the water.", { wordLimit: 1 });
  assert.equal(correct(oneWord, "A tray"), false);
  assert.match(gradeObjective(oneWord, { answer: "A tray" }).answers[0]!.explanation, /Vượt quá giới hạn 1/u);
  const twoWords = fixture("yoghurt pots", "What kind of containers are reused?", "The yoghurt pot is reused; other yoghurt pots are collected.");
  assert.equal(correct(twoWords, "the yoghurt pot"), false, "a matched category must not bypass the original two-word limit");
  const counted = fixture("two pots", "What kind of containers does the class reuse?", "The class reuses two pots.");
  assert.equal(correct(counted, "two pot"), false, "a stated quantity still requires its keyed grammatical form");
});

test("quantity questions and sentence/completion gaps do not receive number-neutral category marking", () => {
  const quantity = fixture("pots", "How many pots are collected?", "Several pots are collected.");
  assert.equal(correct(quantity, "pot"), false);
  const gaps: Partial<StoredQuestion>[] = [
    { questionType: "sentence-completion", prompt: "Place the ______ under the plants." },
    { questionType: "summary-completion", prompt: "Several ______ are collected." },
    { questionType: "note-completion", prompt: "Kind of container: ______" },
    { questionType: "short-answer", prompt: "What kind of container: ______" },
  ];
  for (const override of gaps) {
    assert.equal(correct(fixture("pots", "What kind of containers are reused?", "The children use pots.", override), "pot"), false, override.questionType);
    assert.equal(correct(fixture("tray", "What catches water?", "A tray catches water.", override), "A tray"), false, override.questionType);
  }
});

test("ambiguous lexical endings and unrelated synonyms are not stemmed into a correct answer", () => {
  for (const [answer, response] of [["glasses", "glass"], ["customs", "custom"], ["species", "specie"], ["news", "new"], ["yoghurt pots", "flower pots"], ["wooden boxes", "wooden crate"]]) {
    const content = fixture(answer!, "What kind of objects are described?", `The passage refers to ${answer}.`);
    assert.equal(correct(content, response!), false, `${answer}: ${response}`);
  }
});

test("name/title questions keep their exact keyed articles", () => {
  const content = fixture("The Times", "What is the name of the newspaper?", "The library subscribes to The Times.");
  assert.equal(correct(content, "The Times"), true);
  assert.equal(correct(content, "Times"), false);
});

test("choice, matching and grammar marking do not inherit short-answer flexibility", () => {
  for (const type of ["choice", "matching", "true-false", "yes-no"] as const) {
    const content = fixture("tray", "What catches water?", "A tray catches water.", { type });
    assert.equal(correct(content, "A tray"), false, type);
  }
  const grammar = fixture("tray", "What catches water?", "A tray catches water.", {}, "grammar");
  assert.equal(correct(grammar, "A tray"), false);
});

test("explicit authored alternatives and existing written-clock support remain effective", () => {
  const spelling = fixture("yoghurt pots", "What kind of containers are reused?", "The children reuse yoghurt pots.", { acceptedAnswers: ["yogurt pots"] });
  assert.equal(correct(spelling, "yogurt pot"), true);
  assert.equal(correct(spelling, "yogurt pots"), true);
  const clock = fixture("6:30", "What time does the class start?", "The class starts at half past six.", { questionType: "form-completion", wordLimit: 1, allowNumbers: true }, "listening");
  for (const response of ["six thirty", "half past six", "06:30"]) assert.equal(correct(clock, response), true, response);
  assert.equal(correct(clock, "seven thirty"), false);
});

test("the phrase helper is deterministic and never mutates authored answer keys", () => {
  const content = fixture("yoghurt pots", "What kind of containers are reused?", "The children reuse yoghurt pots.");
  const question = content.questions[0]!;
  const keys = Object.freeze([question.answer]);
  const before = structuredClone(question);
  assert.equal(matchingEquivalentShortAnswer("Yoghurt pot", keys, question), "yoghurt pots");
  assert.deepEqual(question, before);
  assert.deepEqual(keys, ["yoghurt pots"]);
});
