import { createHash, randomInt, randomUUID } from "node:crypto";
import { validateContentStructure } from "../shared/content-visuals";
import type { ContentSection, StoredContent, StoredQuestion } from "../shared/types";
import type { Database, StoredContentRecord } from "./storage";

/** Keep grading material and metadata server-side; sanitize before responding. */
export interface ExamReplacementRecord extends StoredContentRecord {
  replacement: {
    rootContentId: string;
    sourceContentIds: string[];
    method: "equivalent-bank" | "section-combination";
    /** The sole source at its CEFR level may need the nearest adjacent level. */
    difficultyFallback: boolean;
  };
}

export class ExamReplacementUnavailableError extends Error {
  readonly code = "EXAM_REPLACEMENT_UNAVAILABLE";
  constructor() {
    super("There is not enough unused equivalent material for a different question set. Choose another test or ask your teacher to add suitable material.");
    this.name = "ExamReplacementUnavailableError";
  }
}

function replacementMetadata(content: StoredContent): ExamReplacementRecord["replacement"] | undefined {
  return (content as Partial<ExamReplacementRecord>).replacement;
}

/** Include these IDs from every previous snapshot when requesting a replacement. */
export function examReplacementSourceIds(content: StoredContent): string[] {
  return replacementMetadata(content)?.sourceContentIds ?? [content.id];
}

const normalized = (value: string | undefined | null): string => typeof value === "string" ? value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase() : "";
const digest = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const words = (value: string): number => value.trim().split(/\s+/u).filter(Boolean).length;
const numberedPrompts = (section: ContentSection): string[] => section.text.split(/\n/u)
  .filter(line => /^\s*\d+[.)]\s+/u.test(line)).map(line => line.replace(/^\s*\d+[.)]\s+/u, ""));

interface SectionMaterial {
  content: StoredContent;
  index: number;
  section: ContentSection;
  questions: StoredQuestion[];
  fingerprints: Set<string>;
}

function material(content: StoredContent, index: number): SectionMaterial {
  const section = content.sections[index]!;
  const questions = (Array.isArray(content.questions) ? content.questions : []).filter(question => question && question.sectionIndex === index);
  const sourceText = section.dialogue?.map(line => line.text).join(" ") || section.text;
  // A Writing chart's values and a cue card's points are part of its source.
  // Omit identities because private variants remap all of them.
  const sourceAssets = (section.visuals ?? []).map(visual => {
    if ("rows" in visual) return { rows: visual.rows.map(row => ({ label: normalized(row.label), values: row.values })), series: visual.series.map(normalized), unit: normalized(visual.unit), xLabel: visual.xLabel && normalized(visual.xLabel), yLabel: visual.yLabel && normalized(visual.yLabel) };
    const identities = "labels" in visual ? new Map([...(visual.nodes ?? []), ...visual.labels, ...(visual.areas ?? []), ...(visual.paths ?? [])].map((element, position) => [element.id, position])) : new Map();
    return JSON.parse(JSON.stringify(visual, (key, value: unknown) => key === "id" || key === "questionNumber" ? undefined :
      key === "from" || key === "to" ? identities.get(String(value)) : typeof value === "string" ? normalized(value) : value)) as unknown;
  });
  const legacyChart = section.chart?.map(row => ({ label: normalized(row.label), values: row.values }));
  const fingerprints = new Set([digest(["source", normalized(sourceText), section.cuePoints?.map(normalized), legacyChart, section.chartSeries?.map(normalized), section.chartUnit && normalized(section.chartUnit), sourceAssets])]);
  for (const question of questions) {
    // IDs/numbers may differ in copies of the same bank material. Evidence and
    // keys identify the actual question, rather than its generic input widget.
    fingerprints.add(digest(["question", normalized(question.prompt).replace(/\d+/gu, "#"), normalized(question.evidence), normalized(question.answer)]));
    fingerprints.add(`id:${question.id}`);
  }
  if (content.skill === "speaking") {
    for (const prompt of numberedPrompts(section)) fingerprints.add(digest(["spoken-prompt", normalized(prompt)]));
    if (section.cuePoints?.length) fingerprints.add(digest(["spoken-cue", normalized(section.text)]));
  }
  return { content, index, section, questions, fingerprints };
}

function numberedPart(content: StoredContent, section: ContentSection): number | undefined {
  const text = `${section.title} ${section.id} ${content.sections.length === 1 ? content.tags.join(" ") : ""}`;
  const match = /\bpart\s*[-:]?\s*([1-4])\b/iu.exec(text);
  return match ? Number(match[1]) : undefined;
}

function role(entry: SectionMaterial): string | undefined {
  const { content, section, index } = entry;
  if (content.skill === "writing") return section.task ? `task:${section.task}` : undefined;
  if (content.skill === "speaking" || content.skill === "listening") {
    const part = numberedPart(content, section);
    return part ? `part:${part}` : undefined;
  }
  if (content.skill === "grammar") return "grammar";
  return content.format === "full-mock" ? `passage:${index}` : "reading";
}

function questionKinds(questions: StoredQuestion[], distinct = false): string {
  const kinds = questions.map(question => (question.questionType ?? question.type).replace(/^(?:map|plan)-labelling$/u, "orientation-labelling"));
  return (distinct ? [...new Set(kinds)] : kinds).sort().join("|");
}

function taskFamilies(questions: StoredQuestion[]): Set<string> {
  return new Set(questions.map(question => question.type === "true-false" || question.type === "yes-no" ? "truth-judgement" :
    question.type === "choice-multiple" ? "choice" : question.type));
}

function similarLessonTasks(target: StoredQuestion[], candidate: StoredQuestion[]): boolean {
  if (!target.length || !candidate.length) return target.length === candidate.length;
  const targetFamilies = taskFamilies(target);
  const candidateFamilies = taskFamilies(candidate);
  const common = [...targetFamilies].filter(family => candidateFamilies.has(family)).length;
  return common / Math.max(targetFamilies.size, candidateFamilies.size) >= 0.5;
}

function equivalentSection(target: SectionMaterial, candidate: SectionMaterial, flexibleLesson = false): boolean {
  const targetRole = role(target);
  if (!targetRole || targetRole !== role(candidate)) return false;
  if (flexibleLesson) {
    if (candidate.questions.length < target.questions.length * 0.67 || candidate.questions.length > target.questions.length * 1.5) return false;
  } else if (target.questions.length !== candidate.questions.length) return false;
  const skill = target.content.skill;
  if (target.content.format === "lesson" && (flexibleLesson ? !similarLessonTasks(target.questions, candidate.questions) :
    questionKinds(target.questions) !== questionKinds(candidate.questions))) return false;
  if (skill === "speaking") {
    if (numberedPrompts(target.section).length !== numberedPrompts(candidate.section).length ||
      (target.section.cuePoints?.length ?? 0) !== (candidate.section.cuePoints?.length ?? 0)) return false;
  }
  if (skill === "listening" || skill === "reading") {
    const size = words(target.section.dialogue?.map(line => line.text).join(" ") || target.section.text);
    const candidateSize = words(candidate.section.dialogue?.map(line => line.text).join(" ") || candidate.section.text);
    if (!size || candidateSize < size * 0.75 || candidateSize > size * 1.34) return false;
  }
  if (skill === "listening") {
    const speakers = new Set(candidate.section.dialogue?.map(line => line.speaker) ?? []).size;
    const part = numberedPart(candidate.content, candidate.section);
    if (part === 1 || part === 3 ? speakers < 2 : speakers !== 1) return false;
  }
  if (skill === "writing" && target.section.task === 1 &&
    Boolean(target.section.visuals?.length || target.section.chart?.length) !== Boolean(candidate.section.visuals?.length || candidate.section.chart?.length)) return false;
  // A replacement cannot remove answer models the source test supplies.
  if (target.content.referenceAnswers?.some(reference => reference.sectionId === target.section.id) &&
    !candidate.content.referenceAnswers?.some(reference => reference.sectionId === candidate.section.id && reference.sampleAnswer.trim())) return false;
  return true;
}

function usable(content: StoredContent): boolean {
  try {
    validateContentStructure(content);
    if (content.sections.some(section => !section.text?.trim())) return false;
    if (content.questions.some(question => !question.answer?.trim() || !question.evidence?.trim() || !question.explanation?.trim())) return false;
    if (content.referenceAnswers?.some(reference => !content.sections.some(section => section.id === reference.sectionId) || !reference.sampleAnswer.trim())) return false;
    if (content.format === "full-mock") {
      const entries = content.sections.map((_, index) => material(content, index));
      const roles = entries.map(role).join("|");
      if (content.skill === "reading" && (content.sections.length !== 3 || content.durationMinutes !== 60)) return false;
      if (content.skill === "listening" && (roles !== "part:1|part:2|part:3|part:4" || content.durationMinutes !== 30 || entries.some(entry => entry.questions.length !== 10))) return false;
      if (content.skill === "writing" && (roles !== "task:1|task:2" || content.durationMinutes !== 60)) return false;
      if (content.skill === "speaking" && (roles !== "part:1|part:2|part:3" || content.durationMinutes < 11 || content.durationMinutes > 14 ||
        !numberedPrompts(content.sections[0]!).length || !content.sections[1]!.cuePoints?.length || !numberedPrompts(content.sections[2]!).length)) return false;
      if (content.skill === "grammar") return false;
    }
    return true;
  } catch { return false; }
}

function intersects(left: Set<string>, right: Set<string>): boolean {
  for (const value of left) if (right.has(value)) return true;
  return false;
}

function shuffled<T>(values: T[]): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const other = randomInt(index + 1);
    [result[index], result[other]] = [result[other]!, result[index]!];
  }
  return result;
}

/** Preserve the actual material and grading keys while assigning private IDs. */
function buildReplacement(source: StoredContent, selected: SectionMaterial[], method: ExamReplacementRecord["replacement"]["method"]): ExamReplacementRecord {
  const id = `exam-variant-${randomUUID()}`;
  const template = method === "equivalent-bank" ? selected[0]!.content : source;
  const result = structuredClone(template) as ExamReplacementRecord;
  result.id = id;
  result._id = id;
  result.durationMinutes = method === "equivalent-bank" ? template.durationMinutes : source.durationMinutes;
  result.sections = [];
  result.questions = [];
  result.referenceAnswers = [];
  const sourceIds = [...new Set(selected.flatMap(entry => examReplacementSourceIds(entry.content)))];
  result.replacement = { rootContentId: replacementMetadata(source)?.rootContentId ?? source.id, sourceContentIds: sourceIds, method, difficultyFallback: template.cefr !== source.cefr };
  result.createdAt = new Date().toISOString();
  result.vocabularyIds = [...new Set(selected.flatMap(entry => entry.content.vocabularyIds))];
  if (method === "section-combination") {
    result.topic = [...new Set(selected.map(entry => entry.content.topic))].join(" / ");
    result.source = selected.every(entry => entry.content.source === "authored") ? "authored" : "ai";
    result.quality = result.source === "authored" ? "authored-unreviewed" : "ai-unreviewed";
    // Composite tests retain the requested target and existing review limits.
    // There is no claim that combining bank sections calibrates difficulty.
    result.review = { status: "structural-checks-passed", checks: ["Existing bank sections and keys retained", "Section workload and roles preserved", "Unused material checked", "References and numbered assets remapped"],
      limitations: [...new Set([...(source.review?.limitations ?? []), "Sections combined from existing teaching material; difficulty remains an author estimate, not an independently calibrated IELTS paper."])] };
  }
  for (const [index, entry] of selected.entries()) {
    const section = structuredClone(entry.section);
    const sectionId = `${id}-s${index + 1}`;
    section.id = sectionId;
    const numbers = new Map(entry.questions.map((question, position) => [question.number, result.questions.length + position + 1]));
    const renumber = (number: number): number => {
      const replacement = numbers.get(number);
      if (replacement === undefined) throw new Error("A replacement section contains an orphan numbered reference.");
      return replacement;
    };
    const placeholders = (text: string): string => text.replace(/\{\{(\d+)\}\}/gu, (_, number: string) => `{{${renumber(Number(number))}}}`);
    const numberedReferences = (text: string): string => text.replace(/\b(questions?|blanks?|spaces?|labels?|marked)\s+(\d+)(?:\s*(–|-|to|and)\s*(\d+))?/giu,
      (match, prefix: string, first: string, separator: string | undefined, last: string | undefined) => {
        if (!numbers.has(Number(first)) || (last && !numbers.has(Number(last)))) return match;
        return `${prefix} ${renumber(Number(first))}${last ? ` ${separator} ${renumber(Number(last))}` : ""}`;
      });
    section.title = numberedReferences(section.title);
    section.text = numberedReferences(section.text);
    if (section.instructions) section.instructions = numberedReferences(section.instructions);
    const visuals = new Map((section.visuals ?? []).map((visual, position) => [visual.id, `${sectionId}-v${position + 1}`]));
    const blocks = new Map((section.questionBlocks ?? []).map((block, position) => [block.id, `${sectionId}-b${position + 1}`]));
    for (const visual of section.visuals ?? []) {
      visual.id = visuals.get(visual.id)!;
      visual.title = numberedReferences(visual.title);
      if (visual.description) visual.description = numberedReferences(visual.description);
      if (!("labels" in visual)) continue;
      const elements = [...visual.labels, ...(visual.nodes ?? []), ...(visual.areas ?? []), ...(visual.paths ?? [])];
      const elementIds = new Map(elements.map((element, position) => [element.id, `${visual.id}-e${position + 1}`]));
      for (const element of elements) element.id = elementIds.get(element.id)!;
      for (const label of [...visual.labels, ...(visual.nodes ?? [])]) if (label.questionNumber !== undefined) label.questionNumber = renumber(label.questionNumber);
      for (const connection of visual.connections ?? []) {
        connection.from = elementIds.get(connection.from)!;
        connection.to = elementIds.get(connection.to)!;
      }
    }
    for (const block of section.questionBlocks ?? []) {
      block.id = blocks.get(block.id)!;
      block.title = numberedReferences(block.title);
      block.instructions = numberedReferences(block.instructions);
      block.questionNumbers = block.questionNumbers.map(renumber);
      if (block.text) block.text = numberedReferences(placeholders(block.text));
      for (const row of block.rows ?? []) {
        if (row.label) row.label = numberedReferences(placeholders(row.label));
        row.cells = row.cells.map(cell => numberedReferences(placeholders(cell)));
      }
    }
    const groups = new Map<string, string>();
    for (const original of entry.questions) {
      const question = structuredClone(original);
      question.number = renumber(original.number);
      question.id = `${id}-q${question.number}`;
      question.sectionIndex = index;
      if (question.visualId) question.visualId = visuals.get(question.visualId)!;
      if (question.blockId) question.blockId = blocks.get(question.blockId)!;
      if (question.selectionGroup) {
        const group = question.selectionGroup.id;
        if (!groups.has(group)) groups.set(group, `${sectionId}-g${groups.size + 1}`);
        question.selectionGroup.id = groups.get(group)!;
      }
      // Authored questions can name their visual blank in prose as well.
      question.prompt = numberedReferences(question.prompt);
      if (question.groupInstructions) question.groupInstructions = numberedReferences(question.groupInstructions);
      result.questions.push(question);
    }
    result.sections.push(section);
    result.referenceAnswers.push(...(entry.content.referenceAnswers ?? []).filter(reference => reference.sectionId === entry.section.id)
      .map(reference => ({ ...structuredClone(reference), sectionId })));
  }
  if (!result.referenceAnswers.length) delete result.referenceAnswers;
  validateContentStructure(result);
  return result;
}

/**
 * Read-only selection: callers keep the returned keys in private snapshots and
 * sanitize content before responding. Exclusions must include the source IDs
 * of prior snapshots, not just their newly generated variant IDs.
 */
export async function createExamReplacement(database: Database, source: StoredContent, excludedContentIds: string[]): Promise<StoredContentRecord> {
  if (!usable(source)) throw new ExamReplacementUnavailableError();
  const bank = await database.content.find({ skill: source.skill }).toArray();
  const rootId = replacementMetadata(source)?.rootContentId;
  const anchor = rootId ? bank.find(content => content.id === rootId && usable(content)) ?? source : source;
  const excludedIds = new Set([source.id, ...examReplacementSourceIds(source), ...excludedContentIds]);
  const prohibited = new Set<string>();
  for (const content of [source, ...bank.filter(item => excludedIds.has(item.id) || excludedIds.has(item._id))]) {
    if (!Array.isArray(content.sections)) continue;
    for (let index = 0; index < content.sections.length; index++) {
      if (!content.sections[index] || typeof content.sections[index]!.text !== "string") continue;
      for (const fingerprint of material(content, index).fingerprints) prohibited.add(fingerprint);
    }
  }
  const levels = ["A2", "B1", "B2", "C1"];
  const eligible = shuffled(bank.filter(candidate => !replacementMetadata(candidate) && !excludedIds.has(candidate.id) && !excludedIds.has(candidate._id) &&
    candidate.skill === anchor.skill && candidate.testType === anchor.testType && candidate.format === anchor.format &&
    Math.abs(candidate.band - anchor.band) <= 1 && Math.abs(levels.indexOf(candidate.cefr) - levels.indexOf(anchor.cefr)) <= 1 &&
    (anchor.format === "full-mock" ? candidate.durationMinutes === anchor.durationMinutes :
      candidate.durationMinutes >= anchor.durationMinutes * 0.67 && candidate.durationMinutes <= anchor.durationMinutes * 1.5) && usable(candidate)))
    .sort((left, right) => Math.abs(left.band - anchor.band) - Math.abs(right.band - anchor.band) ||
      Number(questionKinds(right.questions, true) === questionKinds(anchor.questions, true)) - Number(questionKinds(left.questions, true) === questionKinds(anchor.questions, true)));
  const targets = anchor.sections.map((_, index) => material(anchor, index));
  const available = eligible.filter(content => content.cefr === anchor.cefr).map(content => content.sections.map((_, index) => material(content, index)));
  const wholeIsFresh = (entries: SectionMaterial[]): boolean => {
    if (entries.length !== targets.length || entries.some((entry, index) => !equivalentSection(targets[index]!, entry, source.format === "lesson") || intersects(entry.fingerprints, prohibited))) return false;
    const used = new Set<string>();
    return !entries.some(entry => {
      const repeated = intersects(entry.fingerprints, used);
      for (const fingerprint of entry.fingerprints) used.add(fingerprint);
      return repeated;
    });
  };
  for (const entries of available) {
    if (wholeIsFresh(entries)) return buildReplacement(anchor, entries, "equivalent-bank");
  }
  // Do not merely shuffle an exhausted test. Assemble intact new sections with
  // the same workload/role, preserving each section's genuine keys and models.
  const pools = targets.map(target => available.flat().filter(entry => equivalentSection(target, entry) && !intersects(entry.fingerprints, prohibited)));
  const chosen: SectionMaterial[] = [];
  const select = (index: number, used: Set<string>): boolean => {
    if (index === targets.length) return true;
    for (const candidate of pools[index]!) {
      if (intersects(candidate.fingerprints, used)) continue;
      // Part 3 discussion develops the Part 2 topic: keep that authored pair.
      if (source.skill === "speaking" && role(targets[index]!) === "part:3") {
        const longTurn = chosen.find(entry => role(entry) === "part:2");
        if (longTurn && longTurn.content.id !== candidate.content.id) continue;
      }
      chosen.push(candidate);
      if (select(index + 1, new Set([...used, ...candidate.fingerprints]))) return true;
      chosen.pop();
    }
    return false;
  };
  if (select(0, new Set())) return buildReplacement(anchor, chosen, "section-combination");
  // The old bank has one A2 Listening mock. Only after the original level is
  // exhausted may a whole paper at the nearest adjacent CEFR be used, within
  // one band. Its actual donor band and CEFR stay visible to the learner.
  for (const content of eligible.filter(content => content.cefr !== anchor.cefr)) {
    const entries = content.sections.map((_, index) => material(content, index));
    if (wholeIsFresh(entries)) return buildReplacement(anchor, entries, "equivalent-bank");
  }
  throw new ExamReplacementUnavailableError();
}
