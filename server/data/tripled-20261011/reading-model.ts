import type { Cefr, ContentSection, IeltsQuestionType, StoredContent, StoredQuestion, TestType } from '../../../shared/types.js';
import type { FreshReadingLessonSource, FreshReadingSource } from '../fresh/reading-model.js';

export interface ExpandedReadingMockSource {
  title: string; topic: string; band: number; cefr: Cefr; testType: TestType; sources: FreshReadingSource[];
}
const generatedAt = '2026-10-11T12:00:00.000Z';

function sectionFromSource(source: FreshReadingSource, id: string, sectionIndex: number, start: number) {
  const sectionId = `${id}-s${sectionIndex + 1}`;
  const shift = (text: string) => text.replace(/\{\{(\d+)\}\}/gu, (_, n: string) => `{{${Number(n) + start - 1}}}`);
  const section: ContentSection = { id: sectionId, title: source.title,
    text: source.paragraphs.map((paragraph, index) => `[${String.fromCharCode(65 + index)}] ${paragraph}`).join('\n\n'),
    instructions: 'Read the passage and answer from its information or the writer’s views. Follow the word limit for each task.' };
  if (source.blocks) section.questionBlocks = source.blocks.map((block, index) => ({ ...block, id: `${sectionId}-block${index + 1}`,
    questionNumbers: block.questionNumbers.map(n => n + start - 1),
    ...(block.text ? { text: shift(block.text) } : {}),
    ...(block.rows ? { rows: block.rows.map(row => ({ ...row, cells: row.cells.map(shift) })) } : {}) }));
  const automatic = new Map<IeltsQuestionType, string>();
  const kinds = { 'sentence-completion': 'sentence', 'summary-completion': 'summary', 'note-completion': 'note',
    'table-completion': 'table', 'flow-chart-completion': 'flow-chart' } as const;
  for (const [kind, type] of Object.entries(kinds)) {
    const rows = source.questions.map((question, i) => ({ question, number: start + i }))
      .filter(row => row.question.questionType === kind && row.question.block === undefined);
    if (!rows.length) continue;
    section.questionBlocks ??= [];
    const blockId = `${sectionId}-block${section.questionBlocks.length + 1}`;
    automatic.set(kind as IeltsQuestionType, blockId);
    const lines = rows.map(row => row.question.prompt.replace('________', `{{${row.number}}}`));
    section.questionBlocks.push({ id: blockId, type: type as 'sentence' | 'summary' | 'note' | 'table' | 'flow-chart',
      title: 'Complete information from the passage', instructions: 'Use words from the passage within the limit stated for each question.',
      questionNumbers: rows.map(row => row.number),
      ...(type === 'table' || type === 'flow-chart' ? { rows: lines.map(line => ({ cells: [line] })) } : { text: lines.join('\n') }) });
  }
  if (source.visuals) section.visuals = source.visuals.map((visual, index) => ({ ...visual, id: `${sectionId}-visual${index + 1}`,
    labels: visual.labels.map(label => ({ ...label, ...(label.questionNumber ? { questionNumber: label.questionNumber + start - 1 } : {}) })),
    ...(visual.nodes ? { nodes: visual.nodes.map(node => ({ ...node, ...(node.questionNumber ? { questionNumber: node.questionNumber + start - 1 } : {}) })) } : {}) }));
  const questions: StoredQuestion[] = source.questions.map((q, index) => {
    const number = start + index, wordLimit = q.type === 'text' ? q.wordLimit ?? 2 : undefined;
    const offset = q.options ? (number + sectionIndex) % q.options.length : 0;
    const options = q.options && !['true-false', 'yes-no', 'choice-multiple'].includes(q.type)
      ? [...q.options.slice(offset), ...q.options.slice(0, offset)] : q.options;
    const question: StoredQuestion = { id: `${id}-q${number}`, number, sectionIndex, type: q.type, questionType: q.questionType,
      prompt: wordLimit && !/write no more than/iu.test(q.prompt) ? `${q.prompt} Write NO MORE THAN ${wordLimit} WORDS from the passage.` : q.prompt,
      answer: q.answer, evidence: q.evidence, explanation: `${q.explanation} Dẫn chứng trong bài: “${q.evidence}”`, subskill: q.questionType,
      ...(options ? { options } : {}), ...(wordLimit ? { wordLimit } : {}),
      ...(q.group ? { selectionGroup: { id: `${sectionId}-${q.group}`, count: 2 }, groupInstructions: 'Choose TWO answers. The paired numbered questions share one answer group.' } : {}),
      ...(q.visual ? { visualId: `${sectionId}-visual1` } : {}),
      ...(q.block !== undefined ? { blockId: `${sectionId}-block${q.block + 1}` }
        : automatic.has(q.questionType) ? { blockId: automatic.get(q.questionType)! } : {}) };
    if (!section.text.includes(q.evidence)) throw new Error(`${question.id}: evidence not found in authored passage`);
    if (wordLimit && !section.text.toLowerCase().includes(q.answer.toLowerCase())) throw new Error(`${question.id}: completion answer absent`);
    if (wordLimit && q.answer.trim().split(/\s+/u).length > wordLimit) throw new Error(`${question.id}: answer exceeds limit`);
    return question;
  });
  return { section, questions };
}
function metadata(band: number, cefr: Cefr) {
  return { source: 'ai' as const, quality: 'ai-unreviewed' as const, createdAt: generatedAt,
    estimatedDifficulty: { band, cefr, basis: 'Author estimate using vocabulary, syntactic complexity, reference tracking and paraphrase demands; not calibrated with candidate results.' },
    objectives: ['Identify exactly supported information', 'Separate missing information from contradiction', 'Follow argument, references and task word limits'],
    errorTypes: ['unsupported-inference', 'scope-shift', 'false-versus-not-given', 'word-limit', 'distractor-detail'],
    provenance: { method: 'ai-assisted' as const, version: 'tripled-reading-20261011', sourceDocument: 'Original IELTS-topic expansion requested 2026-10-11', generatedAt },
    review: { status: 'unreviewed' as const, checks: [], limitations: ['Original fictional teaching materials, not official IELTS papers.', 'Structural and evidence checks do not replace expert IELTS review.', 'Band and CEFR labels are author estimates.'] } };
}
export function buildReadingLesson(source: FreshReadingLessonSource, index: number): StoredContent {
  const id = `fresh-x3-r-lesson-${String(index + 1).padStart(2, '0')}`;
  const built = sectionFromSource(source, id, 0, 1);
  return { id, skill: 'reading', title: source.title, description: 'Bài đọc nguyên bản bổ sung: học liệu riêng, câu hỏi có dẫn chứng và giải thích sau khi hoàn thành.',
    topic: source.topic, band: source.band, cefr: source.cefr, testType: source.testType, durationMinutes: source.band < 5 ? 12 : source.band < 7 ? 18 : 22,
    format: 'lesson', sections: [built.section], questions: built.questions, vocabularyIds: [],
    tags: ['tripled-oct11', 'original-source', ...new Set(built.questions.map(q => q.questionType!))], ...metadata(source.band, source.cefr) };
}
export function buildReadingMock(mock: ExpandedReadingMockSource, index: number): StoredContent {
  const id = `fresh-x3-r-mock-${String(index + 1).padStart(2, '0')}`;
  let start = 1;
  const built = mock.sources.map((source, i) => { const result = sectionFromSource(source, id, i, start); start += result.questions.length; return result; });
  const questions = built.flatMap(result => result.questions);
  const counts = built.map(result => result.section.text.trim().split(/\s+/u).length);
  const total = counts.reduce((a, b) => a + b, 0);
  if (built.length !== 3 || questions.length !== 40 || total < 2150 || total > 2750) throw new Error(`${id}: invalid full Reading workload ${JSON.stringify(counts)}/${questions.length}`);
  if (mock.testType === 'general' && !(counts[2]! > counts[0]! && counts[2]! > counts[1]!)) throw new Error(`${id}: GT final section must be longest`);
  return { id, skill: 'reading', title: mock.title, description: 'Đề Reading độc lập: 3 sections, 40 câu, 60 phút. Nguồn riêng không dùng lại bài luyện hoặc ngân hàng cũ.',
    topic: mock.topic, band: mock.band, cefr: mock.cefr, testType: mock.testType, durationMinutes: 60, format: 'full-mock',
    sections: built.map(result => result.section), questions, vocabularyIds: [],
    tags: ['tripled-oct11', 'original-source', 'independent-mock', ...new Set(questions.map(q => q.questionType!))], ...metadata(mock.band, mock.cefr) };
}
