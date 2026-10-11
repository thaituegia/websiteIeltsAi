import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { replacementBank } from "../server/data/index.js";
import { contentBank as previousContent, vocabularyBank as previousVocabulary, placementBank as previousPlacement } from "../server/data/previous-bank.js";
import { visualSignature } from "./audit-band8.js";
import { contentStructureIssues, withinAnswerLimit } from "../shared/content-visuals.js";
import { gradeObjective } from "../server/learning.js";
import type { ReplacementBank } from "../server/bank-reset.js";
import type { ContentSection } from "../shared/types.js";

const normalized = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const wordCount = (s: string) => s.trim().split(/\s+/u).filter(Boolean).length;
const speech = (s: ContentSection) => s.dialogue?.length ? s.dialogue.map(x => x.text).join(" ") : s.text;
const grams = (s: string) => { const t = normalized(s).split(" "); return new Set(t.slice(0, -4).map((_, i) => t.slice(i, i + 5).join(" "))); };

export function auditFreshBank(bank: ReplacementBank = replacementBank) {
  const issues: string[] = [];
  const check = (value: unknown, why: string) => { if (!value) issues.push(why); };
  const counts = { content: bank.content.length, lessons: bank.content.filter(x => x.format === "lesson").length,
    mocks: bank.content.filter(x => x.format === "full-mock").length, vocabulary: bank.vocabulary.length, placement: bank.placementItems.length };
  const specification = bank.version === "fresh-20261011-v3"
    ? { content: 966, lessons: 810, mocks: 156, vocabulary: 648, placement: 480 }
    : { content: 322, lessons: 270, mocks: 52, vocabulary: 216, placement: 160 };
  check(JSON.stringify(counts) === JSON.stringify(specification), "Fresh bank counts differ from the requested bank specification.");
  const oldIds = new Set([...previousContent, ...previousVocabulary, ...previousPlacement].map(x => x.id));
  const ids = new Set<string>();
  for (const row of [...bank.content, ...bank.vocabulary, ...bank.placementItems]) {
    check(/^fresh-[a-z0-9-]+$/.test(row.id) && !oldIds.has(row.id) && !ids.has(row.id), `${row.id}: duplicate/previous/invalid identifier`); ids.add(row.id);
  }
  const wordIds = new Set(bank.vocabulary.map(x => x.id));
  const coverage: Record<string, Set<string>> = Object.fromEntries(["reading", "listening", "writing", "speaking"].map(x => [x, new Set<string>()]));
  let objectiveQuestionsChecked = 0;
  const workload: { id: string; sections: number[]; total: number }[] = [];
  const previousSections = previousContent.flatMap(item => item.sections.map(section => ({ item, section, old: true })));
  const currentSections = bank.content.flatMap(item => item.sections.map(section => ({ item, section, old: false })));
  const seenSections = new Map<string, string>(), seenVisuals = new Map<string, string>(), seenChartNumbers = new Map<string, string>();
  for (const { item, section, old } of [...previousSections, ...currentSections]) {
    const label = `${item.id}/${section.id}`, signature = normalized(section.text);
    check(old || !seenSections.has(signature), `${label}: repeats an existing source/task ${seenSections.get(signature)}`);
    if (!seenSections.has(signature)) seenSections.set(signature, label);
    for (const visual of section.visuals ?? []) {
      const key = visualSignature(visual);
      check(old || !seenVisuals.has(key), `${label}/${visual.id}: repeats existing visual data ${seenVisuals.get(key)}`);
      if (!seenVisuals.has(key)) seenVisuals.set(key, label);
      if ("rows" in visual) {
        const numbers = JSON.stringify(visual.rows.map(row => row.values));
        check(old || !seenChartNumbers.has(numbers), `${label}/${visual.id}: repeats an existing chart number matrix ${seenChartNumbers.get(numbers)}`);
        if (!seenChartNumbers.has(numbers)) seenChartNumbers.set(numbers, label);
      }
    }
  }
  const receptive = [...previousSections, ...currentSections].filter(x => ["reading", "listening"].includes(x.item.skill))
    .map(x => ({ ...x, shingles: grams(x.item.skill === "listening" ? speech(x.section) : x.section.text) }));
  for (const [i, current] of receptive.entries()) {
    if (current.old) continue;
    for (const other of receptive.slice(0, i)) {
      if (current.item.skill !== other.item.skill) continue;
      const small = current.shingles.size <= other.shingles.size ? current.shingles : other.shingles;
      const large = small === current.shingles ? other.shingles : current.shingles;
      const fraction = [...small].filter(x => large.has(x)).length / Math.max(1, small.size);
      check(fraction <= 0.55, `${current.item.id}/${current.section.id}: excessive source overlap (${Math.round(fraction * 100)}%) with ${other.item.id}/${other.section.id}`);
    }
  }
  for (const item of bank.content) {
    issues.push(...contentStructureIssues(item).map(x => `${item.id}: ${x}`));
    check(item.band >= 3 && item.band <= 8 && item.source === "ai" && item.quality === "ai-unreviewed" && item.provenance?.method === "ai-assisted" && item.estimatedDifficulty?.band === item.band && item.review?.limitations.length, `${item.id}: difficulty/provenance/review metadata invalid`);
    check(item.vocabularyIds.length > 0 && item.vocabularyIds.every(x => wordIds.has(x)), `${item.id}: vocabulary linkage invalid`);
    for (const s of item.sections) for (const asset of s.visuals ?? []) if ("width" in asset) {
      for (const shape of [...asset.labels, ...(asset.nodes ?? []), ...(asset.areas ?? [])])
        check(shape.x >= 0 && shape.y >= 0 && shape.x <= asset.width && shape.y <= asset.height && (!("width" in shape) || shape.x + shape.width <= asset.width && shape.y + shape.height <= asset.height), `${item.id}/${asset.id}: visual extends outside the canvas`);
      for (const path of asset.paths ?? []) for (const [x, y] of path.points)
        check(x >= 0 && y >= 0 && x <= asset.width && y <= asset.height, `${item.id}/${asset.id}: path extends outside the canvas`);
    }
    for (const [index, question] of item.questions.entries()) {
      check(question.number === index + 1 && question.answer && question.evidence && question.explanation && question.subskill, `${question.id}: question/answer metadata invalid`);
      if (["choice", "choice-multiple", "matching", "true-false", "yes-no"].includes(question.type))
        check(question.options && new Set(question.options.map(normalized)).size === question.options.length && question.options.filter(x => x === question.answer).length === 1, `${question.id}: key must match exactly one distinct option`);
      check([question.answer, ...(question.acceptedAnswers ?? [])].every(answer => withinAnswerLimit(answer, question.wordLimit, question.allowNumbers)), `${question.id}: answer exceeds limit`);
      if (["reading", "listening"].includes(item.skill)) {
        check(question.answer === "NOT GIVEN" || item.sections[question.sectionIndex]?.text.includes(question.evidence), `${question.id}: evidence is not an exact source quote`);
        if (question.questionType) coverage[item.skill]!.add(question.questionType);
      }
    }
    if (["reading", "listening", "grammar"].includes(item.skill)) {
      const response = Object.fromEntries(item.questions.map(q => [q.id, q.type === "choice-multiple" ? JSON.stringify(item.questions.filter(x => x.selectionGroup?.id === q.selectionGroup?.id).map(x => x.answer)) : q.answer]));
      const result = gradeObjective(item, response);
      check(result.rawScore === item.questions.length && result.total === item.questions.length && item.questions.length > 0, `${item.id}: perfect keys fail actual grading`);
      objectiveQuestionsChecked += item.questions.length;
    }
    if (["reading", "listening"].includes(item.skill) && item.format === "full-mock") {
      const wc = item.sections.map(x => wordCount(item.skill === "listening" ? speech(x) : x.text));
      const total = wc.reduce((a, b) => a + b, 0); workload.push({ id: item.id, sections: wc, total });
      check(item.questions.length === 40 && item.sections.length === (item.skill === "reading" ? 3 : 4) && item.durationMinutes === (item.skill === "reading" ? 60 : 30), `${item.id}: invalid mock structure`);
      check(item.skill === "reading" ? total >= 2150 && total <= 2750 : wc.every(n => n >= 650 && n <= 850), `${item.id}: inappropriate full mock workload (${total})`);
      if (item.skill === "reading" && item.testType === "general") check(wc[2]! > wc[0]! && wc[2]! > wc[1]!, `${item.id}: GT final passage must be longer`);
    }
    if (item.skill === "listening") for (const [i, section] of item.sections.entries()) {
      check(!!section.dialogue?.length && section.text === section.dialogue.map(line => `${line.speaker}: ${line.text}`).join("\n\n"), `${section.id}: visible transcript differs from spoken dialogue`);
      let last = -1;
      for (const q of item.questions.filter(x => x.sectionIndex === i)) {
        const position = speech(section).indexOf(q.evidence);
        check(position >= last && position >= 0, `${q.id}: listening question order differs from speech`); last = position;
      }
      if (item.format === "full-mock") {
        const speakers = new Set(section.dialogue?.map(x => x.speaker));
        check((i === 1 || i === 3 ? speakers.size === 1 : speakers.size >= 2) && item.questions.filter(x => x.sectionIndex === i).length === 10, `${item.id}: wrong Part ${i + 1} structure`);
      }
    }
    if (item.skill === "writing") {
      for (const s of item.sections) {
        check([1, 2].includes(s.task!) && (s.instructions ?? "").includes(s.task === 1 ? "150" : "250"), `${s.id}: writing task/word minimum invalid`);
        if (s.task === 1) {
          check(item.testType === "general" ? /letter/i.test(s.text) && !s.visuals?.length : !!s.visuals?.length, `${s.id}: missing Task 1 stimulus`);
          coverage.writing!.add(item.testType === "general" ? "letter" : s.visuals![0]!.type);
          if ((s.visuals?.length ?? 0) > 1) coverage.writing!.add("mixed");
        }
      }
      if (item.format === "full-mock") check(item.durationMinutes === 60 && item.sections.map(s => s.task).join() === "1,2", `${item.id}: invalid writing mock`);
    }
    if (item.skill === "speaking") {
      for (const s of item.sections) {
        const part = /^Part ([123])/.exec(s.title)?.[1];
        check(part, `${s.id}: missing speaking Part`); if (part) coverage.speaking!.add(part);
        if (part === "2") check(s.cuePoints?.length === 4, `${s.id}: invalid cue card`);
      }
      if (item.format === "full-mock") check(item.sections.length === 3 && item.sections.every((s, i) => s.title.startsWith(`Part ${i + 1}`)) && item.durationMinutes >= 11 && item.durationMinutes <= 14, `${item.id}: invalid speaking mock`);
    }
  }
  for (const type of ["multiple-choice", "multiple-choice-multiple", "true-false-not-given", "yes-no-not-given", "matching-headings", "matching-information", "matching-features", "matching-sentence-endings", "sentence-completion", "summary-completion", "note-completion", "table-completion", "flow-chart-completion", "diagram-labelling", "short-answer"]) check(coverage.reading!.has(type), `Reading missing ${type}`);
  for (const type of ["multiple-choice", "multiple-choice-multiple", "matching", "form-completion", "note-completion", "table-completion", "flow-chart-completion", "summary-completion", "sentence-completion", "short-answer", "map-labelling", "plan-labelling", "diagram-labelling"]) check(coverage.listening!.has(type), `Listening missing ${type}`);
  for (const type of ["line", "bar", "pie", "table", "map", "process", "mixed", "letter"]) check(coverage.writing!.has(type), `Writing missing ${type}`);
  const oldWords = new Set(previousVocabulary.map(x => normalized(x.word))), words = new Set<string>();
  for (const word of bank.vocabulary) {
    const key = normalized(word.word); check(!oldWords.has(key) && !words.has(key), `${word.id}: repeats a vocabulary lexeme`); words.add(key);
    check(word.collocations.length >= 2 && word.examples.length >= 2 && new Set(word.examples).size === word.examples.length && word.meaning && word.definition && word.commonError && /^\/.+\/$/u.test(word.ipa), `${word.id}: incomplete study entry`);
  }
  const oldPlacement = new Set(previousPlacement.map(x => normalized(x.text))), contexts = new Set<string>();
  for (const p of bank.placementItems) {
    const key = normalized(p.text); check(!oldPlacement.has(key) && !contexts.has(key), `${p.id}: repeats placement context`); contexts.add(key);
    check(p.options.length === 4 && new Set(p.options).size === 4 && p.options.filter(x => x === p.answer).length === 1 && p.explanation && Math.abs(p.difficulty - (p.band - 5) * 1.2) < 1e-9, `${p.id}: invalid placement key/configuration`);
  }
  const bySkill = Object.fromEntries(["reading", "listening", "writing", "speaking", "grammar"].map(skill => [skill, { lessons: bank.content.filter(x => x.skill === skill && x.format === "lesson").length, mocks: bank.content.filter(x => x.skill === skill && x.format === "full-mock").length }]));
  return { status: issues.length ? "failed" : "passed", version: bank.version, counts, bySkill, objectiveQuestionsChecked,
    coverage: Object.fromEntries(Object.entries(coverage).map(([k, v]) => [k, [...v].sort()])), workload, issues,
    limitations: ["Automated structural, evidence, key and duplication checks; AI-generated difficulty estimates are not examiner review or empirical calibration. Reusable map/diagram layouts are permitted when the scenario and answer-bearing features differ."] };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = auditFreshBank();
  const file = resolve(".local/fresh-bank/audit.json"); await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2)); if (report.status !== "passed") process.exitCode = 1;
}
