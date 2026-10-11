import type { Cefr, ContentSection, ReferenceResponse, StoredContent } from '../../../shared/types.js';
import type { SpeakingInterviewPack, SpeakingLongTurnPack, SpeakingMockPack, SpeakingQuestionResponse } from './speaking-model.js';
import { speakingPart1Packs } from './speaking-part1.js';
import { speakingPart2Packs } from './speaking-part2.js';
import { speakingPart3Packs } from './speaking-part3.js';
import { speakingMockPacksA } from './speaking-mocks-a.js';
import { speakingMockPacksB } from './speaking-mocks-b.js';
import { extraSpeakingLessonPart1, extraSpeakingLessonPart3, extraSpeakingMockInterviews } from './speaking-extra-responses.js';

const generatedAt = '2026-10-11T12:00:00.000Z';
const level = (band: number): Cefr => band < 4.5 ? 'A2' : band < 6 ? 'B1' : band < 7.5 ? 'B2' : 'C1';
function interviewSection(id: string, part: 1 | 3, entries: SpeakingQuestionResponse[]): ContentSection {
  if (entries.length !== 6) throw new Error(`Incomplete Speaking interview: ${id}`);
  return { id, title: part === 1 ? 'Part 1 · Introduction and interview' : 'Part 3 · Two-way discussion',
    text: entries.map((entry, i) => `${i + 1}. ${entry.prompt}`).join('\n'),
    instructions: part === 1
      ? 'Answer these familiar interview questions naturally. Part 1 takes 4–5 minutes in the complete test; extend each answer with a relevant personal detail.'
      : 'Discuss these wider issues with the examiner. Explain your reasons, use examples and qualify broad claims. Part 3 takes 4–5 minutes in the complete test.' };
}
function cueSection(id: string, pack: SpeakingLongTurnPack | SpeakingMockPack): ContentSection {
  return { id, title: 'Part 2 · Individual long turn', text: pack.cue, cuePoints: [...pack.points],
    instructions: 'You have one minute to prepare and may make notes. Speak for one to two minutes about the cue card, developing the four points into a connected account.' };
}
function interviewReference(section: ContentSection, part: 1 | 3, entries: SpeakingQuestionResponse[]): ReferenceResponse {
  return { sectionId: section.id, title: `Câu trả lời tham khảo · Part ${part}`,
    sampleAnswer: entries.map(entry => `${entry.prompt}\n${entry.answer}`).join('\n\n'),
    explanation: part === 1
      ? 'Mỗi câu trả lời minh họa mở bằng ý trả lời trực tiếp, sau đó thêm chi tiết cá nhân phù hợp. Hãy dùng trải nghiệm của bạn; mẫu này không có band do giám khảo xác nhận và không đánh giá phát âm.'
      : 'Các câu trả lời minh họa phát triển quan điểm bằng lý do, ví dụ và giới hạn phù hợp. Quan điểm khác vẫn có thể tốt nếu giải thích rõ; mẫu không phải đáp án duy nhất hoặc điểm IELTS được chứng nhận.',
    keyPoints: entries.map(entry => entry.prompt), responses: entries.map(entry => ({ prompt: entry.prompt, sampleAnswer: entry.answer })) };
}
function longTurnReference(section: ContentSection, pack: SpeakingLongTurnPack | SpeakingMockPack): ReferenceResponse {
  return { sectionId: section.id, title: 'Bài nói tham khảo · Part 2', sampleAnswer: pack.answer,
    explanation: 'Đây là câu chuyện của người nói hư cấu, minh họa cách nối bốn gợi ý bằng các chi tiết liên quan và một phần giải thích. Câu trả lời khác vẫn phù hợp. Dùng mẫu để nhận ra cách phát triển ý, không học thuộc; độ dài phải điều chỉnh theo tốc độ nói thực tế.', keyPoints: [...pack.points] };
}
function base(id: string, topic: string, band: number): Omit<StoredContent, 'title' | 'description' | 'sections'> {
  return { id, topic, band, cefr: level(band), skill: 'speaking', testType: 'both', durationMinutes: 5, format: 'lesson',
    questions: [], vocabularyIds: [], tags: ['fresh-x3-20261011', 'original-interview'], source: 'ai', quality: 'ai-unreviewed', createdAt: generatedAt,
    estimatedDifficulty: { band, cefr: level(band), basis: 'Estimated practice target for fluency, coherence, vocabulary precision and grammatical range. Familiar IELTS-style topics remain accessible across levels; the label does not certify the reference response or promise a score.' },
    provenance: { method: 'ai-assisted', version: 'fresh-x3-20261011', generatedAt },
    review: { status: 'unreviewed', checks: [], limitations: ['Original AI-assisted practice, not official IELTS content or independently examiner-reviewed difficulty calibration.', 'Reference responses are illustrative; Speaking has no unique correct wording. Audio quality and pronunciation require separate assessment.'] },
    objectives: ['Respond directly to the particular question and develop a relevant idea.', 'Organise speech naturally and use concrete examples instead of memorised scripts.'],
    errorTypes: ['underdeveloped-response', 'memorised-language', 'unclear-reference', 'lexical-precision'] };
}
function interviewLesson(pack: SpeakingInterviewPack, part: 1 | 3, index: number): StoredContent {
  const id = `fresh-x3-s-p${part}-${String(index + 1).padStart(3, '0')}`;
  const extra = (part === 1 ? extraSpeakingLessonPart1 : extraSpeakingLessonPart3)[pack.topic];
  if (!extra) throw new Error(`Missing sixth Speaking lesson response: ${pack.topic}`);
  const entries = [...pack.questions, extra];
  const section = interviewSection(`${id}-part${part}`, part, entries);
  return { ...base(id, pack.topic, pack.band), title: `${pack.topic} · Part ${part}`, description: `Six original Part ${part} interview questions with completed-attempt reference responses. Estimated practice target band ${pack.band}.`,
    sections: [section], tags: ['fresh-x3-20261011', `speaking-part:${part}`, `target-band:${pack.band}`], referenceAnswers: [interviewReference(section, part, entries)] };
}
function longTurnLesson(pack: SpeakingLongTurnPack, index: number): StoredContent {
  const id = `fresh-x3-s-p2-${String(index + 1).padStart(3, '0')}`;
  const section = cueSection(`${id}-part2`, pack);
  return { ...base(id, pack.topic, pack.band), title: `${pack.topic} · Part 2`, description: `An original long-turn cue card and four prompts; an illustrative connected response becomes available after completion. Estimated practice target band ${pack.band}.`,
    durationMinutes: 4, sections: [section], tags: ['fresh-x3-20261011', 'speaking-part:2', `target-band:${pack.band}`], referenceAnswers: [longTurnReference(section, pack)] };
}
export const expandedSpeakingLessons: StoredContent[] = [
  ...speakingPart1Packs.map((pack, index) => interviewLesson(pack, 1, index)),
  ...speakingPart2Packs.map(longTurnLesson),
  ...speakingPart3Packs.map((pack, index) => interviewLesson(pack, 3, index)),
];
export const expandedSpeakingMocks: StoredContent[] = [...speakingMockPacksA, ...speakingMockPacksB].map((pack, index) => {
  const id = `fresh-x3-s-mock-${String(index + 1).padStart(3, '0')}`;
  const extra = extraSpeakingMockInterviews[pack.topic];
  if (!extra) throw new Error(`Missing sixth Speaking mock responses: ${pack.topic}`);
  const part1 = [...pack.part1, extra.part1];
  const part3 = [...pack.part3, extra.part3];
  const sections = [interviewSection(`${id}-part1`, 1, part1), cueSection(`${id}-part2`, pack), interviewSection(`${id}-part3`, 3, part3)];
  return { ...base(id, pack.topic, pack.band), title: `Speaking · Independent interview · ${pack.topic}`, description: 'An independent 11–14-minute IELTS-style interview with all three parts. Every examiner question and the long turn have illustrative reference responses after submission.',
    durationMinutes: 14, format: 'full-mock', sections, tags: ['fresh-x3-20261011', 'independent-mock', 'three-parts', `target-band:${pack.band}`],
    referenceAnswers: [interviewReference(sections[0]!, 1, part1), longTurnReference(sections[1]!, pack), interviewReference(sections[2]!, 3, part3)] };
});
