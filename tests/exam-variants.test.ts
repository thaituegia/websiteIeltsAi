import assert from "node:assert/strict";
import { test } from "node:test";
import { validateContentStructure } from "../shared/content-visuals";
import type { ContentSection, StoredContent, StoredQuestion } from "../shared/types";
import { contentBank } from "../server/data/index";
import { createExamReplacement, examReplacementSourceIds, ExamReplacementUnavailableError, type ExamReplacementRecord } from "../server/exam-variants";
import type { Database } from "../server/storage";

function databaseFor(items: StoredContent[]): Database {
  // Only a read operation is available. A selector that writes learner state or
  // the public bank will fail these tests instead of silently changing fixtures.
  return { content: { find: () => ({ toArray: async () => items.map(item => ({ ...item, _id: item.id })) }) } } as unknown as Database;
}

function reading(id: string, counts = [13, 13, 14]): StoredContent {
  const sections: ContentSection[] = [];
  const questions: StoredQuestion[] = [];
  for (const [index, count] of counts.entries()) {
    sections.push({ id: `${id}-s${index}`, title: `Passage ${index + 1}`, text: Array.from({ length: 70 }, (_, word) => `${id}-passage-${index}-word-${word}`).join(" ") });
    for (let position = 0; position < count; position++) {
      const number = questions.length + 1;
      const answer = `${id}-answer-${number}`;
      questions.push({ id: `${id}-q${number}`, number, type: "choice", questionType: "multiple-choice", prompt: `${id}: What does passage ${index + 1} show at point ${position + 1}?`, options: [answer, `${id}-distractor-${number}`], answer,
        sectionIndex: index, subskill: "evidence", explanation: `${id} explanation ${number}`, evidence: `${id} evidence ${number}` });
    }
  }
  return { id, skill: "reading", title: id, description: "Original teacher fixture", topic: id, band: 6, cefr: "B2", testType: "academic", durationMinutes: 60,
    format: "full-mock", sections, questions, vocabularyIds: [`${id}-vocabulary`], tags: ["teacher-material"], source: "authored", quality: "authored-unreviewed", createdAt: "2026-10-11T00:00:00Z" };
}

function layouts(content: StoredContent, index: number): void {
  const section = content.sections[index]!;
  const questions = content.questions.filter(question => question.sectionIndex === index);
  const blockId = `${section.id}-notes`;
  const visualId = `${section.id}-process`;
  const first = questions[0]!;
  Object.assign(first, { type: "text", questionType: "note-completion", wordLimit: 1, blockId, answer: `${content.id}first`, acceptedAnswers: [`${content.id}FIRST`] });
  delete first.options;
  section.questionBlocks = [{ id: blockId, type: "note", title: `Question ${first.number}`, instructions: `Complete question ${first.number}.`, questionNumbers: [first.number], rows: [{ label: "A result", cells: [`The result is {{${first.number}}}.`] }] }];
  for (const position of [1, 4]) {
    const question = questions[position]!;
    Object.assign(question, { type: "text", questionType: "diagram-labelling", wordLimit: 1, visualId, prompt: `Identify the space marked ${question.number}.`, answer: `${content.id}stage${position}`, acceptedAnswers: [`${content.id}STAGE${position}`] });
    delete question.options;
  }
  section.visuals = [{ id: visualId, type: "process", title: "Operating process", width: 400, height: 200, labels: [{ id: `${visualId}-landmark`, x: 20, y: 170, text: "Entrance" }],
    areas: [{ id: `${visualId}-area`, x: 10, y: 10, width: 350, height: 140, fill: "#eee" }], paths: [{ id: `${visualId}-path`, points: [[10, 180], [350, 180]] }],
    nodes: [{ id: `${visualId}-first`, x: 20, y: 20, width: 80, height: 80, questionNumber: questions[1]!.number }, { id: `${visualId}-second`, x: 180, y: 20, width: 80, height: 80, questionNumber: questions[4]!.number }],
    connections: [{ from: `${visualId}-first`, to: `${visualId}-second` }] }];
  const options = [`${content.id}featureA`, `${content.id}featureB`, `${content.id}featureC`];
  for (const position of [2, 3]) Object.assign(questions[position]!, { type: "choice-multiple", questionType: "multiple-choice-multiple", prompt: "Which TWO features were confirmed?", options: [...options], answer: options[position - 2], selectionGroup: { id: `${section.id}-selections`, count: 2 }, groupInstructions: "Choose TWO options." });
  validateContentStructure(content);
}

function productive(id: string): StoredContent {
  const base = reading(id);
  return { ...base, skill: "writing", questions: [], sections: [{ id: `${id}-task1`, task: 1, title: "Task 1", text: `Describe the ${id} chart.`, visuals: [{ id: `${id}-chart`, type: "bar", title: "Results", rows: [{ label: id, values: [20, 30] }], series: ["Before", "After"], unit: "%" }] },
    { id: `${id}-task2`, task: 2, title: "Task 2", text: `Discuss the advantages of ${id}.` }], referenceAnswers: [1, 2].map(task => ({ sectionId: `${id}-task${task}`, title: `Model ${task}`, sampleAnswer: `${id} genuine model for task ${task}`, explanation: `${id} explanation`, keyPoints: [`${id} key point`], responses: [{ prompt: `${id} prompt`, sampleAnswer: `${id} response` }] })) };
}

test("whole replacements preserve actual donor keys and models, with private fresh IDs and untouched originals", async () => {
  const source = productive("original");
  const donor = productive("different");
  const before = structuredClone([source, donor]);
  const result = await createExamReplacement(databaseFor([source, donor]), source, []);
  assert.match(result.id, /^exam-variant-/);
  assert.equal(result._id, result.id);
  assert.deepEqual(examReplacementSourceIds(result), [donor.id]);
  assert.equal((result as ExamReplacementRecord).replacement.rootContentId, source.id);
  assert.equal((result as ExamReplacementRecord).replacement.method, "equivalent-bank");
  assert.deepEqual(result.sections.map(section => section.text), donor.sections.map(section => section.text));
  assert.deepEqual(result.referenceAnswers!.map(({ sectionId: _id, ...reference }) => reference), donor.referenceAnswers!.map(({ sectionId: _id, ...reference }) => reference));
  for (const reference of result.referenceAnswers!) assert.ok(result.sections.some(section => section.id === reference.sectionId));
  assert.equal(result.sections[0]!.visuals![0]!.id.startsWith(result.id), true);
  result.referenceAnswers![0]!.keyPoints.push("private learner snapshot change");
  assert.deepEqual([source, donor], before, "the selector or returned snapshot mutated original teacher material");
});

test("section fallback retains 40 slots, original answer keys and remaps all numbered layouts and nested IDs", async () => {
  const source = reading("old");
  // Every donor is a complete, valid forty-question paper, but none has the
  // requested 13/13/14 workload. Intact compatible passages form a fresh paper.
  const donors = [reading("donorA", [13, 12, 15]), reading("donorB", [14, 13, 13]), reading("donorC", [12, 14, 14])];
  layouts(donors[1]!, 1);
  donors[1]!.sections[1]!.title = "Questions 15–27: an independent passage";
  donors[1]!.sections[1]!.text += " Complete questions 15–27 using the passage.";
  const middleBlock = donors[1]!.sections[1]!.questionBlocks![0]!;
  middleBlock.text = "Complete question 15 here: {{15}}.";
  delete middleBlock.rows;
  const before = structuredClone([source, ...donors]);
  const result = await createExamReplacement(databaseFor([source, ...donors]), source, []);
  assert.equal((result as ExamReplacementRecord).replacement.method, "section-combination");
  assert.equal(result.questions.length, 40);
  assert.deepEqual(result.sections.map((_, index) => result.questions.filter(question => question.sectionIndex === index).length), [13, 13, 14]);
  assert.deepEqual(result.questions.map(question => question.number), Array.from({ length: 40 }, (_, index) => index + 1));
  assert.doesNotThrow(() => validateContentStructure(result));
  assert.deepEqual(examReplacementSourceIds(result), donors.map(donor => donor.id));
  const oldIds = new Set([source, ...donors].flatMap(content => content.questions.map(question => question.id)));
  assert.ok(result.questions.every(question => !oldIds.has(question.id)));
  assert.ok(result.sections.every(section => !source.sections.some(previous => previous.text === section.text)));
  for (const question of result.questions) {
    const original = donors.flatMap(donor => donor.questions).find(original => original.evidence === question.evidence)!;
    assert.equal(question.answer, original.answer);
    assert.deepEqual(question.acceptedAnswers, original.acceptedAnswers);
    assert.equal(question.explanation, original.explanation);
    assert.deepEqual(question.options, original.options);
  }
  const middle = result.sections[1]!;
  const block = middle.questionBlocks![0]!;
  assert.deepEqual(block.questionNumbers, [14]);
  assert.equal(block.text, "Complete question 14 here: {{14}}.");
  assert.equal(middle.title, "Questions 14 – 26: an independent passage");
  assert.match(middle.text, /Complete questions 14 – 26 using the passage\./);
  assert.equal(block.title, "Question 14");
  assert.equal(result.questions[13]!.blockId, block.id);
  const visual = middle.visuals![0]!;
  assert.ok("nodes" in visual);
  if (!("nodes" in visual)) throw Error("Expected process visual");
  assert.deepEqual(visual.nodes!.map(node => node.questionNumber), [15, 18]);
  assert.equal(visual.connections![0]!.from, visual.nodes![0]!.id);
  assert.equal(visual.connections![0]!.to, visual.nodes![1]!.id);
  assert.match(result.questions[14]!.prompt, /marked 15\./);
  assert.equal(result.questions[14]!.visualId, visual.id);
  assert.equal(result.questions[15]!.selectionGroup!.id, result.questions[16]!.selectionGroup!.id);
  assert.ok([visual.id, ...visual.labels.map(label => label.id), ...visual.nodes!.map(node => node.id), ...visual.areas!.map(area => area.id), ...visual.paths!.map(path => path.id), block.id, result.questions[15]!.selectionGroup!.id].every(id => id.startsWith(result.id)));
  assert.deepEqual([source, ...donors], before);
});

test("source history excludes clones and all used sources; an exhausted bank explicitly refuses", async () => {
  const source = reading("original");
  const firstDonor = reading("first-donor");
  const secondDonor = reading("second-donor");
  const copy = structuredClone(source);
  copy.id = "copied-source";
  for (const section of copy.sections) section.id = `copy-${section.id}`;
  for (const question of copy.questions) question.id = `copy-${question.id}`;
  const first = await createExamReplacement(databaseFor([source, firstDonor]), source, []);
  const next = await createExamReplacement(databaseFor([source, firstDonor, secondDonor, copy, first]), first, [source.id, ...examReplacementSourceIds(first)]);
  assert.deepEqual(examReplacementSourceIds(next), [secondDonor.id]);
  assert.equal((next as ExamReplacementRecord).replacement.rootContentId, source.id);
  await assert.rejects(createExamReplacement(databaseFor([source, firstDonor, secondDonor, copy, first]), next,
    [source.id, ...examReplacementSourceIds(first), ...examReplacementSourceIds(next)]), error => error instanceof ExamReplacementUnavailableError && error.code === "EXAM_REPLACEMENT_UNAVAILABLE");
});

test("wrong skill, test type, workload, difficulty and corrupt material cannot become replacements", async () => {
  const source = reading("original");
  const wrongSkill = { ...reading("listening"), skill: "listening" as const };
  const wrongTestType = { ...reading("general"), testType: "general" as const };
  const wrongDuration = { ...reading("duration"), durationMinutes: 15 };
  const wrongDifficulty = { ...reading("difficulty"), band: 8, cefr: "C1" as const };
  const corrupt = reading("corrupt");
  corrupt.questions[0]!.answer = "missing option";
  await assert.rejects(createExamReplacement(databaseFor([source, wrongSkill, wrongTestType, wrongDuration, wrongDifficulty, corrupt]), source, []), ExamReplacementUnavailableError);
  const malformedHistory = reading("malformed-history");
  delete (malformedHistory.questions[0]! as Partial<StoredQuestion>).evidence;
  const fresh = reading("fresh-valid");
  const result = await createExamReplacement(databaseFor([source, malformedHistory, fresh]), source, [malformedHistory.id]);
  assert.deepEqual(examReplacementSourceIds(result), [fresh.id], "a malformed previously-used record must not block a genuine valid donor");
});

test("closest actual band wins and repeated replacement remains anchored to the requested original difficulty", async () => {
  const source = reading("original");
  const close = { ...reading("close"), band: 6.5 };
  const further = { ...reading("further"), band: 7 };
  const drift = { ...reading("drift"), band: 7.5 };
  const first = await createExamReplacement(databaseFor([source, close, further]), source, []);
  assert.deepEqual(examReplacementSourceIds(first), [close.id]);
  assert.equal(first.band, close.band);
  const second = await createExamReplacement(databaseFor([source, close, further, drift]), first, [source.id, close.id]);
  assert.deepEqual(examReplacementSourceIds(second), [further.id]);
  await assert.rejects(createExamReplacement(databaseFor([source, close, further, drift]), second, [source.id, close.id, further.id]), ExamReplacementUnavailableError);
});

test("single-use source fingerprints include real chart data, and original answer models cannot be dropped", async () => {
  const source = productive("original");
  const changedChart = structuredClone(source);
  changedChart.id = "new-chart";
  changedChart.sections[0]!.visuals![0] = { id: "new-chart-visual", type: "bar", title: "Results", rows: [{ label: "original", values: [40, 80] }], series: ["Before", "After"], unit: "%" };
  changedChart.sections[1]!.text = "Discuss the impact of an independent new topic.";
  changedChart.referenceAnswers![0]!.sampleAnswer = "A genuine new model describing values forty and eighty.";
  const noModels = productive("missing-models");
  delete noModels.referenceAnswers;
  const result = await createExamReplacement(databaseFor([source, changedChart, noModels]), source, []);
  assert.deepEqual(examReplacementSourceIds(result), [changedChart.id]);
  assert.equal(result.referenceAnswers![0]!.sampleAnswer, changedChart.referenceAnswers![0]!.sampleAnswer);
  const presentationCopy = structuredClone(source);
  presentationCopy.id = "presentation-only-copy";
  const visual = presentationCopy.sections[0]!.visuals![0]!;
  assert.ok("rows" in visual);
  if (!("rows" in visual)) throw Error("Expected chart");
  visual.id = "new-display-id";
  visual.type = "line";
  visual.title = "A changed display caption";
  presentationCopy.sections[1]!.text = "A genuinely different essay does not make a reused Task 1 new.";
  await assert.rejects(createExamReplacement(databaseFor([source, presentationCopy]), source, []), ExamReplacementUnavailableError);
  const legacySource = productive("legacy-source");
  delete legacySource.sections[0]!.visuals;
  Object.assign(legacySource.sections[0]!, { chart: [{ label: "Original", values: [20, 30] }], chartSeries: ["Before", "After"], chartUnit: "%", chartType: "bar" });
  const legacyCopy = structuredClone(legacySource);
  legacyCopy.id = "legacy-display-copy";
  legacyCopy.sections[0]!.chartType = "line";
  legacyCopy.sections[0]!.chart![0]!.label = "  ORIGINAL  ";
  legacyCopy.sections[1]!.text = "An independent second essay still cannot refresh copied chart data.";
  await assert.rejects(createExamReplacement(databaseFor([legacySource, legacyCopy]), legacySource, []), ExamReplacementUnavailableError);
});

test("older band-eight Reading lessons receive genuinely new comparable practice material", async () => {
  for (const id of ["fresh-r-lesson-21", "fresh-r-lesson-22"]) {
    const source = contentBank.find(content => content.id === id)!;
    const result = await createExamReplacement(databaseFor(contentBank), source, []);
    assert.equal(result.skill, source.skill);
    assert.equal(result.testType, source.testType);
    assert.equal(result.format, source.format);
    assert.equal(result.cefr, source.cefr);
    assert.ok(Math.abs(result.band - source.band) <= 1);
    assert.ok(result.sections.every(section => !source.sections.some(previous => previous.text === section.text)));
    assert.doesNotThrow(() => validateContentStructure(result));
  }
});

test("the only A2 Listening mock uses the nearest genuine paper and retains its actual B1/band 4.5 labels", async () => {
  const source = contentBank.find(content => content.id === "fresh-l-mock-001")!;
  const result = await createExamReplacement(databaseFor(contentBank), source, []);
  assert.deepEqual(examReplacementSourceIds(result), ["fresh-l-mock-002"]);
  assert.equal(result.band, 4.5);
  assert.equal(result.cefr, "B1");
  assert.equal(result.estimatedDifficulty!.band, 4.5);
  assert.equal(result.estimatedDifficulty!.cefr, "B1");
  assert.equal((result as ExamReplacementRecord).replacement.difficultyFallback, true);
  assert.equal(result.questions.length, 40);
  assert.equal(result.durationMinutes, 30);
  assert.deepEqual(result.sections.map(section => /Part ([1-4])/u.exec(section.title)![1]), ["1", "2", "3", "4"]);
  assert.ok(result.sections.every(section => !source.sections.some(previous => previous.text === section.text)));
});

test("all 966 active bank sets have a structurally valid genuine first replacement with their original excluded", async () => {
  assert.equal(contentBank.length, 966);
  const database = databaseFor(contentBank);
  for (const source of contentBank) {
    const replacement = await createExamReplacement(database, source, [source.id]);
    assert.equal(replacement.skill, source.skill, source.id);
    assert.equal(replacement.format, source.format, source.id);
    assert.equal(replacement.testType, source.testType, source.id);
    assert.ok(Math.abs(replacement.band - source.band) <= 1, source.id);
    if (source.format === "full-mock") {
      assert.equal(replacement.durationMinutes, source.durationMinutes, source.id);
      assert.equal(replacement.questions.length, source.questions.length, source.id);
      assert.equal(replacement.sections.length, source.sections.length, source.id);
    }
    assert.ok(!examReplacementSourceIds(replacement).includes(source.id), source.id);
    assert.ok(replacement.questions.every(question => !source.questions.some(original => original.id === question.id)), source.id);
    assert.ok(replacement.sections.every(section => !source.sections.some(original => original.text === section.text)), source.id);
    assert.doesNotThrow(() => validateContentStructure(replacement), source.id);
  }
});
