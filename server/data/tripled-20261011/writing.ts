import type { Cefr, ContentSection, ReferenceResponse, StoredContent } from '../../../shared/types.js';
import { expandedAcademicLessons, expandedMockAcademicTasks, type WritingAcademicPack } from './writing-academic.js';
import { expandedLetterLessons, type WritingLetterPack } from './writing-letters.js';
import { expandedMockLetters } from './writing-letters-mocks.js';
import { expandedEssayLessons, expandedMockEssays, type WritingEssayPack } from './writing-essays.js';

const generatedAt = '2026-10-11T12:00:00.000Z';
const bands = [3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8];
const cefrFor = (band: number): Cefr => band < 4.5 ? 'A2' : band < 6 ? 'B1' : band < 7.5 ? 'B2' : 'C1';
const instructions = (task: 1 | 2) => task === 1
  ? 'You should spend about 20 minutes on this task. Write at least 150 words.'
  : 'You should spend about 40 minutes on this task. Write at least 250 words. Give reasons for your answer and include any relevant examples from your own knowledge or experience.';
const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const essayFamilyNames: Record<string, string> = { advantages: 'advantages-disadvantages', problems: 'problem-solution', causes: 'causes-effects' };
const familyFor = (pack: WritingEssayPack) => essayFamilyNames[pack.family] ?? pack.family;
type ProductivePack = WritingAcademicPack | WritingLetterPack | WritingEssayPack;
function isEssay(pack: ProductivePack): boolean { return 'family' in pack && !('visuals' in pack); }
function packFamily(pack: ProductivePack): string {
  if ('visuals' in pack) return pack.family;
  if ('register' in pack) return pack.register;
  return familyFor(pack);
}
function base(id: string, pack: ProductivePack, band: number): Omit<StoredContent, 'title' | 'description' | 'sections'> {
  const cefr = cefrFor(band);
  return { id, skill: 'writing', topic: pack.topic, band, cefr, testType: 'both', durationMinutes: 20, format: 'lesson', questions: [], vocabularyIds: [],
    tags: ['tripled-20261011', 'original-prompt', `target-band:${band}`], source: 'ai', quality: 'ai-unreviewed', createdAt: generatedAt,
    objectives: ['Answer every part of the task using relevant details.', 'Organise information and arguments into coherent paragraphs.', 'Use precise vocabulary and accurate grammatical forms appropriate to the task.'],
    errorTypes: ['task-coverage', 'paragraph-coherence', 'lexical-precision', 'grammatical-control'],
    estimatedDifficulty: { band, cefr, basis: 'Estimated practice target based on expected linguistic control and available learning support. Authentic IELTS task lengths are retained throughout bands 3–8. Neither prompts nor reference responses are examiner-calibrated or guaranteed to receive the target band.' },
    provenance: { method: 'ai-assisted', version: 'fresh-x3-20261011', generatedAt },
    review: { status: 'unreviewed', checks: [], limitations: ['Original AI-assisted practice and illustrative reference responses; not official IELTS material or independently reviewed by an IELTS examiner. A lower practice target does not reduce the authentic minimum word count.'] } };
}
function section(pack: ProductivePack, id: string): ContentSection {
  const task = isEssay(pack) ? 2 : 1;
  const family = packFamily(pack);
  return { id, title: `Task ${task} · ${family}`, task, text: pack.prompt, instructions: instructions(task), ...('visuals' in pack ? { visuals: pack.visuals } : {}) };
}
function reference(pack: ProductivePack, sectionId: string): ReferenceResponse {
  const task = isEssay(pack) ? 2 : 1;
  const count = wordCount(pack.model);
  if (count < (task === 1 ? 150 : 250)) throw new Error(`Writing reference below the authentic minimum: ${pack.key}`);
  if (pack.keyPoints.length < 2) throw new Error(`Writing reference needs specific key points: ${pack.key}`);
  return { sectionId, title: `Task ${task} · Bài tham khảo (${count} từ)`, sampleAnswer: pack.model, keyPoints: pack.keyPoints,
    explanation: task === 2
      ? 'Đây là một cách lập luận tham khảo, không phải đáp án duy nhất hay bài được giám khảo chứng nhận điểm band. So sánh cách bài trả lời từng yêu cầu của đề, phát triển lý do và ví dụ, giữ quan điểm nhất quán; quan điểm khác vẫn hợp lệ nếu có hỗ trợ phù hợp.'
      : 'register' in pack
        ? 'Thư tham khảo xử lý đủ ba gạch đầu dòng và dùng giọng phù hợp với người nhận. Tên, ngày và chi tiết bổ sung là ví dụ hư cấu có thể lựa chọn. Không cần sao chép thư hay coi đây là đáp án duy nhất.'
        : 'Báo cáo tham khảo mô tả số liệu, vị trí hoặc trình tự thực sự có trong hình của đề, có tổng quan và so sánh chính. Không thêm nguyên nhân, số liệu, lối đi hay giai đoạn không được thể hiện. Đây là một cách diễn đạt minh họa, không phải điểm band được giám khảo bảo đảm.' };
}
const lessonPacks: ProductivePack[] = [...expandedAcademicLessons, ...expandedLetterLessons, ...expandedEssayLessons];
export const expandedWritingLessons: StoredContent[] = lessonPacks.map((pack, i) => {
  const task = isEssay(pack) ? 2 : 1;
  const id = `fresh-x3-w-lesson-${pack.key}`;
  const testType = isEssay(pack) ? 'both' : 'register' in pack ? 'general' : 'academic';
  const family = packFamily(pack);
  const band = bands[i % bands.length]!;
  const contentSection = section(pack, `${id}-task${task}`);
  return { ...base(id, pack, band), title: pack.title, description: `Original ${testType === 'general' ? 'General Training' : testType === 'academic' ? 'Academic' : 'IELTS'} Task ${task} practice with the authentic ${task === 1 ? 150 : 250}-word minimum. Estimated practice target: band ${band}. An illustrative response becomes available after submission.`, testType, durationMinutes: task === 1 ? 20 : 40,
    tags: ['tripled-20261011', 'original-prompt', `task-${task}`, `writing-family:${family}`, `target-band:${band}`], sections: [contentSection], referenceAnswers: [reference(pack, contentSection.id)] };
});

// Distribute all six essay families across both Academic and General Training
// mock tests. Mock tasks are reserved for these tests, never repeated as lessons.
const essayFamilies = ['opinion', 'discussion', 'advantages', 'problems', 'causes', 'two-part'];
const mockEssayOrder = Array.from({ length: 6 }, (_, round) => essayFamilies.map(family => expandedMockEssays.filter(p => p.family === family)[round]!)).flat();
const mockTask1: ProductivePack[] = [...expandedMockAcademicTasks, ...expandedMockLetters];
export const expandedWritingMocks: StoredContent[] = mockTask1.map((task1, i) => {
  const task2 = mockEssayOrder[i]!;
  if (!task2) throw new Error(`Missing reserved mock essay at ${i}`);
  const id = `fresh-x3-w-mock-${task1.key}`;
  const band = bands[(i * 3) % bands.length]!;
  const testType = 'register' in task1 ? 'general' : 'academic';
  const section1 = section(task1, `${id}-task1`);
  const section2 = section(task2, `${id}-task2`);
  const family = 'register' in task1 ? task1.register : (task1 as WritingAcademicPack).family;
  return { ...base(id, task1, band), title: `${testType === 'general' ? 'General Training' : 'Academic'} Writing · ${task1.title}`, topic: `${task1.topic} / ${task2.topic}`, description: 'An original complete 60-minute Writing test. Task 1 requires at least 150 words; Task 2 requires at least 250 words and carries twice the weight. Both illustrative responses are available after submission.', format: 'full-mock', durationMinutes: 60, testType,
    tags: ['tripled-20261011', 'independent-mock', `writing-family:${family}`, `essay-family:${familyFor(task2)}`, `target-band:${band}`], sections: [section1, section2], referenceAnswers: [reference(task1, section1.id), reference(task2, section2.id)] };
});

if (expandedWritingLessons.length !== 168 || expandedWritingMocks.length !== 36) throw new Error('Writing tripling must add exactly 168 lessons and 36 independent full mocks.');
