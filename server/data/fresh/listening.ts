import type { ContentSection, DialogueLine, QuestionBlock, SpatialVisual, StoredContent, StoredQuestion } from '../../../shared/types.js';
import { validateContentStructure, withinAnswerLimit } from '../../../shared/content-visuals.js';
import { socialLessonSources } from './listening-social-lesson-sources.js';
import { socialMockSources } from './listening-social-mock-sources.js';
import { advancedLessonSources, advancedMockSources, type FreshListeningSource } from './listening-advanced-sources.js';

const generatedAt = '2026-10-11T00:00:00.000Z';
type Source = FreshListeningSource & { orientation?: 'map' | 'plan'; centerLabel?: string };
const rotate = <T>(values: T[], offset: number): T[] => [...values.slice(offset % values.length), ...values.slice(0, offset % values.length)];
const words = (text: string): number => text.trim().split(/\s+/u).filter(Boolean).length;
const cefr = (band: number): StoredContent['cefr'] => band <= 4 ? 'A2' : band <= 5.5 ? 'B1' : band <= 7 ? 'B2' : 'C1';

function answerVariants(answer: string, evidence: string): string[] {
  const variants = new Set([answer.toLowerCase()]);
  if (answer.includes('’')) variants.add(answer.replaceAll('’', "'"));
  if (answer.includes('é')) variants.add(answer.replaceAll('é', 'e'));
  const numbers: Record<string, string> = { two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10', twelve: '12' };
  const first = answer.split(' ')[0]!.toLowerCase();
  if (numbers[first]) variants.add(answer.replace(new RegExp(`^${first}`, 'iu'), numbers[first]!));
  const time = /^(\d{1,2}):(\d{2})$/u.exec(answer);
  if (time) {
    const hour = Number(time[1]);
    const clock = hour % 12 || 12;
    const period = hour >= 12 ? 'pm' : /afternoon|evening/iu.test(evidence) ? 'pm' : /morning/iu.test(evidence) ? 'am' : null;
    variants.add(`${hour}.${time[2]}`);
    if (period) {
      variants.add(`${clock}:${time[2]} ${period}`);
      variants.add(`${clock}.${time[2]} ${period}`);
    }
  }
  return [...variants];
}

function orientation(source: Source, id: string, start: number, serial: number): SpatialVisual {
  const width = 640 + (serial % 7) * 4;
  const height = 420 + (serial % 5) * 4;
  const cx = width / 2, cy = height / 2;
  const areas = [
    { id: `${id}-a`, x: 55, y: 64, width: cx - 101, height: cy - 104, fill: '#e1ecd9' },
    { id: `${id}-b`, x: cx + 46, y: 64, width: cx - 101, height: cy - 104, fill: '#ede7d5' },
    { id: `${id}-c`, x: 55, y: cy + 48, width: cx - 101, height: cy - 105, fill: '#eadfd2' },
    { id: `${id}-d`, x: cx + 46, y: cy + 48, width: cx - 101, height: cy - 105, fill: '#e1e7ee' },
  ];
  return {
    id, type: source.orientation ?? (serial % 2 ? 'map' : 'plan'), title: `${source.title}: visitor orientation`,
    description: `North is at the top. Enter from the south. Four numbered spaces are located north-west, north-east, south-west and south-east of the central ${source.centerLabel ?? 'meeting point'}. Listen to identify them.`,
    width, height, areas,
    paths: [{ id: `${id}-entry-path`, points: [[cx, height - 18], [cx, cy]], style: 'path' }, ...areas.map((area, index) => ({ id: `${id}-branch${index}`, points: [[cx, cy], [area.x + area.width / 2, area.y + area.height / 2]] as [number, number][], style: 'path' as const }))],
    labels: [
      { id: `${id}-entry`, x: cx, y: height - 8, text: 'Entrance' },
      { id: `${id}-centre`, x: cx, y: cy - 10, text: source.centerLabel ?? 'Meeting point' },
      ...areas.map((area, index) => ({ id: `${id}-blank${index}`, x: area.x + area.width / 2, y: area.y + area.height / 2, questionNumber: start + index + 1 })),
    ],
  };
}

function processVisual(id: string, numbers: number[], serial: number): SpatialVisual {
  const width = 700 + serial % 4 * 4;
  const height = 370;
  const positions = [[30, 48], [260, 48], [490, 48], [490, 238], [260, 238], [30, 238]];
  const nodes = numbers.map((number, index) => ({ id: `${id}-node${index}`, x: positions[index]![0]!, y: positions[index]![1]!, width: 176, height: 82, questionNumber: number }));
  return { id, type: 'process', title: 'Main operating sequence', description: 'Follow the six connected stages from the upper left, across the upper row, then down and back along the lower row. Supporting design conditions are recorded separately in the notes.', width, height, labels: [], nodes, connections: nodes.slice(1).map((node, index) => ({ from: nodes[index]!.id, to: node.id })) };
}

function apparatusVisual(source: Source, id: string, start: number, serial: number): SpatialVisual {
  const width = 560 + serial % 5 * 6;
  const supports = /posts|legs|columns|supports|rods/iu.test(source.facts[7]![1])
    ? [{ id: `${id}-lower-a`, x: 204, y: 162, width: 20, height: 135, fill: '#eadfd2' }, { id: `${id}-lower-b`, x: 336, y: 162, width: 20, height: 135, fill: '#eadfd2' }]
    : [{ id: `${id}-lower`, x: 256, y: 162, width: 46, height: 135, fill: '#eadfd2' }];
  return { id, type: 'diagram', title: 'Field apparatus: numbered components', description: 'Schematic field device with an upper operating component and a lower supporting component. Identify both from the spoken explanation.', width, height: 360,
    areas: [{ id: `${id}-surface`, x: 35, y: 300, width: width - 70, height: 28, fill: '#e0e8d2' }, { id: `${id}-upper`, x: 190, y: 80, width: 180, height: 80, fill: '#e1e7ee' }, ...supports],
    labels: [{ id: `${id}-upper-blank`, x: 280, y: 126, questionNumber: start + 7 }, { id: `${id}-lower-blank`, x: 279, y: 230, questionNumber: start + 8 }, { id: `${id}-surface-label`, x: 85, y: 321, text: 'Ground' }],
  };
}

function section(source: Source, contentId: string, sectionIndex: number, serial: number, isMock: boolean): { section: ContentSection; questions: StoredQuestion[] } {
  const id = `${contentId}-p${source.part}`;
  const start = sectionIndex * 10;
  const speakers = [...new Set(source.speech.map(([speaker]) => speaker))];
  if (source.facts.length !== 10) throw new Error(`${source.title}: exactly ten authored facts required.`);
  if ([1, 3].includes(source.part) ? speakers.length < 2 : speakers.length !== 1) throw new Error(`${source.title}: incorrect dialogue/monologue structure.`);
  const spoken = source.speech.map(([, text]) => text).join(' ');
  const size = words(spoken);
  if (size < (isMock ? 650 : 400) || size > (isMock ? 850 : 700)) throw new Error(`${source.title}: recording length ${size} is outside ${isMock ? '650–850' : '400–700'} spoken words.`);
  const dialogue: DialogueLine[] = source.speech.map(([speaker, text]) => ({ speaker, text, accent: speakers.indexOf(speaker) === 1 ? 'australian' : speakers.indexOf(speaker) > 1 ? 'american' : 'british' }));
  const blocks = new Map<string, QuestionBlock>();
  const visuals: SpatialVisual[] = [];
  const style = source.style ?? 'note';
  let lastEvidence = -1;
  const addBlock = (question: StoredQuestion, kind: QuestionBlock['type'], suffix: string): void => {
    const blockId = `${id}-${suffix}`;
    const instructions = 'Write NO MORE THAN THREE WORDS AND/OR A NUMBER for each answer.';
    let block = blocks.get(blockId);
    if (!block) {
      block = { id: blockId, type: kind, title: kind === 'form' ? 'Booking details' : kind === 'flow-chart' ? 'Operating sequence' : kind === 'table' ? 'Listening table' : kind === 'summary' ? 'Lecture summary' : kind === 'sentence' ? 'Complete the sentences' : 'Listening notes', instructions, questionNumbers: [], rows: [] };
      blocks.set(blockId, block);
    }
    question.blockId = blockId;
    question.questionType = `${kind}-completion`;
    block.questionNumbers.push(question.number);
    const blank = `{{${question.number}}}`;
    const completedLine = question.prompt.includes('____') ? question.prompt.replace('____', blank) : `${question.prompt}: ${blank}`;
    if (kind === 'summary') {
      block.text = [block.text, completedLine].filter(Boolean).join(' ');
      delete block.rows;
    } else if (kind === 'form' || kind === 'table' || kind === 'note') {
      block.rows!.push(question.prompt.includes('____') ? { cells: [completedLine] } : { label: question.prompt, cells: [blank] });
    } else block.rows!.push({ cells: [completedLine] });
  };
  const matchingSlice = source.part === 2 ? source.facts.slice(4, 8) : source.facts.slice(6, 9);
  const matchingOptions = rotate([...new Set(matchingSlice.flatMap(fact => [fact[1], ...(fact[3] ?? [])]))], serial);
  const pairedOptions = source.part === 3 ? rotate([...new Set([source.facts[4]![1], source.facts[5]![1], ...(source.facts[4]![3] ?? [])])], serial) : [];
  const flowIndices = new Set([0, 1, 2, 5, 6, 7]);
  const questions = source.facts.map(([prompt, answer, evidence, distractors], index): StoredQuestion => {
    const position = spoken.indexOf(evidence);
    if (position < 0 || position < lastEvidence) throw new Error(`${source.title}/${index + 1}: evidence must be verbatim and chronologically ordered.`);
    lastEvidence = position;
    const number = start + index + 1;
    const question: StoredQuestion = { id: `${contentId}-q${number}`, number, sectionIndex, type: 'text', prompt, answer, acceptedAnswers: answerVariants(answer, evidence), evidence, explanation: `Đáp án được xác nhận trực tiếp trong bản nghe: “${evidence}”. Giữ đúng giới hạn từ/số và phân biệt thông tin đã sửa với lựa chọn bị bác bỏ.`, wordLimit: 3, allowNumbers: true, subskill: 'identify-specific-spoken-information' };
    const choice = (source.part === 1 && index >= 8) || (source.part === 2 && index >= 8) || (source.part === 3 && index < 4);
    if (choice) {
      if (!distractors || distractors.length < 2) throw new Error(`${source.title}/${number}: authored distractors are missing.`);
      question.type = 'choice'; question.questionType = 'multiple-choice'; question.options = rotate([answer, ...distractors], serial + index);
      delete question.wordLimit; delete question.allowNumbers; delete question.acceptedAnswers;
      question.subskill = 'paraphrase-and-distractor-rejection';
    } else if (source.part === 3 && (index === 4 || index === 5)) {
      question.type = 'choice-multiple'; question.questionType = 'multiple-choice-multiple'; question.prompt = source.facts[4]![0]; question.options = pairedOptions;
      question.selectionGroup = { id: `${id}-two-selections`, count: 2 }; question.groupInstructions = 'Choose TWO options. Order does not matter; each correct choice earns one mark.';
      delete question.wordLimit; delete question.allowNumbers; delete question.acceptedAnswers;
      question.subskill = 'two-confirmed-features';
    } else if (source.part === 2 && index < 4) {
      question.visualId = `${id}-orientation`; question.questionType = (source.orientation ?? (serial % 2 ? 'map' : 'plan')) === 'map' ? 'map-labelling' : 'plan-labelling';
      question.subskill = 'follow-spatial-orientation';
    } else if (source.part === 2 && index < 8 || source.part === 3 && index >= 6 && index < 9) {
      question.type = 'matching'; question.questionType = 'matching'; question.options = matchingOptions;
      question.groupInstructions = 'Choose the appropriate feature for each item. An option may be used more than once.';
      delete question.wordLimit; delete question.allowNumbers; delete question.acceptedAnswers;
      question.subskill = 'match-speakers-or-activities';
    } else if (source.part === 4 && style === 'diagram' && (index === 6 || index === 7)) {
      question.visualId = `${id}-apparatus`; question.questionType = 'diagram-labelling'; question.subskill = 'understand-device-components';
    } else if (source.part === 4 && style === 'flow' && flowIndices.has(index)) {
      question.visualId = `${id}-process`; addBlock(question, 'flow-chart', index < 3 ? 'sequence-first' : 'sequence-final'); question.subskill = 'follow-a-spoken-process';
    } else if (style === 'short' || source.part === 3) question.questionType = 'short-answer';
    else {
      const kind: QuestionBlock['type'] = source.part === 1 && !source.style ? 'form' : style === 'table' ? 'table' : style === 'summary' ? 'summary' : style === 'sentence' ? 'sentence' : 'note';
      const suffix = style === 'diagram' && index >= 8 ? 'final-notes' : style === 'flow' ? index < 5 ? 'supporting-notes' : 'final-notes' : kind;
      addBlock(question, kind, suffix);
    }
    if (question.type === 'text' && (!withinAnswerLimit(answer, question.wordLimit, question.allowNumbers) || question.acceptedAnswers?.some(value => !withinAnswerLimit(value, question.wordLimit, question.allowNumbers)))) throw new Error(`${source.title}/${number}: answer exceeds the declared limit.`);
    return question;
  });
  if (source.part === 2) visuals.push(orientation(source, `${id}-orientation`, start, serial));
  if (source.part === 4 && style === 'diagram') visuals.push(apparatusVisual(source, `${id}-apparatus`, start, serial));
  if (source.part === 4 && style === 'flow') visuals.push(processVisual(`${id}-process`, [...flowIndices].map(index => start + index + 1), serial));
  return {
    section: { id, title: `Part ${source.part}: ${source.title}`, text: dialogue.map(line => `${line.speaker}: ${line.text}`).join('\n\n'), dialogue, instructions: 'Listen once in exam mode. Read each question group carefully and follow its word limit or required number of selections.', questionBlocks: [...blocks.values()], visuals: visuals.length ? visuals : undefined },
    questions,
  };
}

export function buildFreshListeningContent(id: string, sources: Source[], band: number, format: StoredContent['format'], serial: number): StoredContent {
  const parts = sources.map((source, index) => section(source, id, index, serial * 4 + index, format === 'full-mock'));
  const item: StoredContent = {
    id, skill: 'listening', title: format === 'lesson' ? sources[0]!.title : `Fresh Listening ${serial + 1}: four independent recordings`,
    description: format === 'lesson' ? `Bài nghe mới hoàn toàn Part ${sources[0]!.part}, 10 câu với hội thoại/bài nói nguyên bản, đáp án và bằng chứng. Band ${band.toFixed(1)} chỉ là ước tính luyện tập.` : 'Đề Listening mới gồm bốn bản nghe độc lập, 40 câu, 30 phút; không tái dùng bản nghe từ bài luyện và không phải đề IELTS chính thức.',
    topic: sources.map(source => source.topic).join(' / '), band, cefr: cefr(band), testType: 'both', durationMinutes: format === 'full-mock' ? 30 : 12, format,
    sections: parts.map(part => part.section), questions: parts.flatMap(part => part.questions), vocabularyIds: [],
    tags: ['fresh-bank-v6', 'independent-recordings', 'difficulty-estimated', ...sources.map(source => `part-${source.part}`), ...new Set(parts.flatMap(part => part.questions.map(question => question.questionType!)))],
    source: 'ai', quality: 'ai-unreviewed', createdAt: generatedAt,
    estimatedDifficulty: { band, cefr: cefr(band), basis: 'Ước tính theo độ dài thông tin, mức diễn đạt tương đương, suy luận có bằng chứng và mật độ từ vựng; chưa hiệu chuẩn từ dữ liệu thí sinh.' },
    objectives: ['Theo dõi thông tin theo thứ tự bản nghe', 'Phân biệt quyết định cuối với phương án loại bỏ', 'Hoàn thành đúng loại câu hỏi và giới hạn từ/số'],
    errorTypes: ['word-limit', 'distractor-selection', 'spatial-direction', 'matching', 'multi-select'],
    provenance: { method: 'ai-assisted', version: 'fresh-bank-v6-2026-10-11', generatedAt },
    review: { status: 'unreviewed', checks: ['typed-asset-structure', 'verbatim-ordered-evidence', 'answer-word-limits', 'dialogue-and-monologue-roles', 'independent-mock-sources'], limitations: ['Chưa qua thẩm định độc lập của chuyên gia IELTS hoặc hiệu chuẩn độ khó.', 'Giọng/accent là metadata tổng hợp; cần nhà cung cấp âm thanh để phát audio.'] },
  };
  validateContentStructure(item);
  return item;
}

const lessons: Source[] = [...socialLessonSources, ...advancedLessonSources];
const mocks: Source[] = [...socialMockSources, ...advancedMockSources];
export const freshListeningLessons: StoredContent[] = lessons.map((source, index) => buildFreshListeningContent(`fresh-l-lesson-${String(index + 1).padStart(3, '0')}`, [source], source.band, 'lesson', index));
export const freshListeningMocks: StoredContent[] = Array.from({ length: 6 }, (_, index) => {
  const sources = [1, 2, 3, 4].map(part => mocks.filter(source => source.part === part)[index]!);
  if (sources.some(source => !source)) throw new Error(`Fresh Listening mock ${index + 1}: missing independent part.`);
  return buildFreshListeningContent(`fresh-l-mock-${String(index + 1).padStart(3, '0')}`, sources, [3.5, 4.5, 5.5, 6.5, 7.5, 8][index]!, 'full-mock', index);
});
