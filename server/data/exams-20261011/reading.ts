import type { ContentSection, IeltsQuestionType, StoredContent, StoredQuestion } from '../../../shared/types.js';
import type { FreshReadingSource } from '../fresh/reading-model.js';
import { newReadingMockSources } from './reading-sources.js';

const generatedAt = '2026-10-11T07:00:00.000Z';

/** Converts independent authored sources to the existing numbered IELTS widgets. */
function sectionFromSource(source: FreshReadingSource, id: string, sectionIndex: number, start: number) {
  const sectionId = `${id}-s${sectionIndex + 1}`;
  const shiftBlank = (text: string) => text.replace(/\{\{(\d+)\}\}/gu, (_, number: string) => `{{${Number(number) + start - 1}}}`);
  const section: ContentSection = {
    id: sectionId, title: source.title,
    text: source.paragraphs.map((paragraph, index) => `[${String.fromCharCode(65 + index)}] ${paragraph.replace(/^[A-Z]\.\s/u, '')}`).join('\n\n'),
    instructions: 'Read the text and answer using only the information and views it contains. Follow the word limit for each completion task.',
  };
  if (source.blocks) section.questionBlocks = source.blocks.map((block, index) => ({
    ...block, id: `${sectionId}-block${index + 1}`, questionNumbers: block.questionNumbers.map(n => n + start - 1),
    ...(block.text ? { text: shiftBlank(block.text) } : {}),
    ...(block.rows ? { rows: block.rows.map(row => ({ ...row, cells: row.cells.map(shiftBlank) })) } : {}),
  }));
  const automaticBlocks = new Map<IeltsQuestionType, string>();
  const blockTypes: Partial<Record<IeltsQuestionType, NonNullable<ContentSection['questionBlocks']>[number]['type']>> = {
    'sentence-completion': 'sentence', 'summary-completion': 'summary', 'note-completion': 'note',
    'table-completion': 'table', 'flow-chart-completion': 'flow-chart',
  };
  for (const [kind, type] of Object.entries(blockTypes)) {
    const rows = source.questions.map((question, index) => ({ question, number: start + index }))
      .filter(row => row.question.questionType === kind && row.question.block === undefined);
    if (!rows.length) continue;
    section.questionBlocks ??= [];
    const blockId = `${sectionId}-block${section.questionBlocks.length + 1}`;
    automaticBlocks.set(kind as IeltsQuestionType, blockId);
    const lines = rows.map(row => row.question.prompt.replace('________', `{{${row.number}}}`));
    section.questionBlocks.push({ id: blockId, type: type!, title: 'Complete the information from the passage',
      instructions: 'Use words from the passage, within the word limit shown beside each question.',
      questionNumbers: rows.map(row => row.number),
      ...(type === 'table' || type === 'flow-chart' ? { rows: lines.map(line => ({ cells: [line] })) } : { text: lines.join('\n') }),
    });
  }
  if (source.visuals) section.visuals = source.visuals.map((visual, index) => ({
    ...visual, id: `${sectionId}-visual${index + 1}`,
    labels: visual.labels.map(label => ({ ...label, ...(label.questionNumber ? { questionNumber: label.questionNumber + start - 1 } : {}) })),
    ...(visual.nodes ? { nodes: visual.nodes.map(node => ({ ...node, ...(node.questionNumber ? { questionNumber: node.questionNumber + start - 1 } : {}) })) } : {}),
  }));
  const questions: StoredQuestion[] = source.questions.map((question, index) => {
    const number = start + index;
    const offset = question.options ? (number + sectionIndex) % question.options.length : 0;
    const options = question.options && !['true-false', 'yes-no', 'choice-multiple'].includes(question.type)
      ? [...question.options.slice(offset), ...question.options.slice(0, offset)] : question.options;
    const wordLimit = question.type === 'text' ? question.wordLimit ?? 2 : undefined;
    const stored: StoredQuestion = {
      id: `${id}-q${number}`, number, sectionIndex, type: question.type, questionType: question.questionType,
      prompt: question.type === 'text' && !/write no more than/iu.test(question.prompt)
        ? `${question.prompt} Write NO MORE THAN ${wordLimit} WORDS from the text.` : question.prompt,
      answer: question.answer, evidence: question.evidence, explanation: question.explanation, subskill: question.questionType,
      ...(options ? { options } : {}), ...(wordLimit ? { wordLimit } : {}),
      ...(question.group ? { selectionGroup: { id: `${sectionId}-${question.group}`, count: 2 },
        groupInstructions: 'Choose TWO answers. The paired numbered rows share one answer group.' } : {}),
      ...(question.visual ? { visualId: `${sectionId}-visual1` } : {}),
      ...(question.block !== undefined ? { blockId: `${sectionId}-block${question.block + 1}` }
        : automaticBlocks.has(question.questionType) ? { blockId: automaticBlocks.get(question.questionType)! } : {}),
    };
    if (!section.text.includes(stored.evidence)) throw new Error(`${stored.id}: evidence does not occur in the new source`);
    if (wordLimit && !section.text.toLowerCase().includes(stored.answer.toLowerCase())) throw new Error(`${stored.id}: completion key is absent from the source`);
    return stored;
  });
  return { section, questions };
}

export const newReadingMocks: StoredContent[] = newReadingMockSources.map((mock, index) => {
  const id = `fresh-exam-r-${String(index + 1).padStart(2, '0')}`;
  let start = 1;
  const built = mock.sources.map((source, sectionIndex) => {
    const result = sectionFromSource(source, id, sectionIndex, start);
    start += result.questions.length;
    return result;
  });
  const questions = built.flatMap(result => result.questions);
  const sectionWords = built.map(result => result.section.text.trim().split(/\s+/u).length);
  const wordCount = sectionWords.reduce((sum, n) => sum + n, 0);
  if (questions.length !== 40 || built.length !== 3 || wordCount < 2150 || wordCount > 2750)
    throw new Error(`${id}: full Reading paper must have 3 sections, 40 questions and 2150–2750 words (${wordCount})`);
  if (mock.testType === 'general' && !(sectionWords[2]! > sectionWords[0]! && sectionWords[2]! > sectionWords[1]!))
    throw new Error(`${id}: the General Training final section must be the longest`);
  return {
    id, skill: 'reading', title: mock.title,
    description: 'Đề Reading nguyên bản: 3 sections, 40 câu, 60 phút. Chủ đề phổ biến trong IELTS; nguồn và câu hỏi độc lập với học liệu đã có.',
    topic: mock.topic, band: mock.band, cefr: mock.cefr, testType: mock.testType, durationMinutes: 60,
    format: 'full-mock', sections: built.map(result => result.section), questions, vocabularyIds: [],
    tags: ['exam-oct11', 'independent-mock', 'original-source', ...new Set(questions.map(question => question.questionType!))],
    source: 'ai', quality: 'ai-unreviewed', createdAt: generatedAt,
    estimatedDifficulty: { band: mock.band, cefr: mock.cefr,
      basis: 'Author estimate based on lexical range, qualification of arguments, paraphrase, reference tracking and the distinction between contradiction and missing information; not calibrated with candidate results.' },
    objectives: ['Locate exact evidence across three independent texts', 'Distinguish stated facts and author views from unsupported inference', 'Follow complex conditions and paraphrases within 60 minutes'],
    errorTypes: ['unsupported-inference', 'scope-shift', 'false-versus-not-given', 'word-limit', 'distractor-detail'],
    provenance: { method: 'ai-assisted', version: 'new-reading-exams-20261011', sourceDocument: 'Original IELTS-topic mock papers commissioned 2026-10-11', generatedAt },
    review: { status: 'unreviewed', checks: [], limitations: ['Original fictional teaching texts; these are not official IELTS papers.', 'Automated structural and evidence checks do not replace expert IELTS review.', 'Difficulty and CEFR labels are estimates rather than calibrated exam results.'] },
  };
});
