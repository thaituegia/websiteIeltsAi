import type { ReferenceResponse, StoredContent } from '../../../shared/types.js';
import { freshSpeakingLessons, freshSpeakingMocks } from '../fresh/speaking.js';
import { newSpeakingMocks } from './speaking.js';
import type { SpeakingReferencePack } from './speaking-reference-model.js';
import { lessonReferencesA } from './speaking-references-lessons-a.js';
import { lessonReferencesB } from './speaking-references-lessons-b.js';
import { lessonReferencesC } from './speaking-references-lessons-c.js';
import { lessonReferencesD } from './speaking-references-lessons-d.js';
import { mockReferences } from './speaking-references-mocks.js';

const packs: SpeakingReferencePack[] = [
  ...lessonReferencesA, ...lessonReferencesB, ...lessonReferencesC, ...lessonReferencesD,
  ...mockReferences,
];
const byTopic = new Map(packs.map(pack => [pack.topic, pack]));
if (byTopic.size !== packs.length) throw new Error('Speaking reference topic packs must be distinct.');

function references(item: StoredContent): ReferenceResponse[] {
  const pack = byTopic.get(item.topic);
  if (!pack) throw new Error(`A Speaking reference pack is missing for ${item.id}.`);
  return item.sections.map(section => {
    const part = /^Part ([123])\b/u.exec(section.title)?.[1];
    if (!part) throw new Error(`Speaking part cannot be identified for ${section.id}.`);
    if (part === '2') {
      if (section.cuePoints?.length !== 4) throw new Error(`The long-turn cue card needs four points: ${section.id}.`);
      return {
        sectionId: section.id, title: 'Bài nói tham khảo · Part 2', sampleAnswer: pack.part2,
        explanation: 'Đây là lời kể minh họa của một người nói hư cấu, không phải đáp án duy nhất hoặc bài được giám khảo chấm band. Đối chiếu cách mở câu chuyện, chi tiết cụ thể và phần giải thích với bốn gợi ý; hãy dùng trải nghiệm của chính bạn thay vì học thuộc mẫu.',
        keyPoints: [...section.cuePoints],
      };
    }
    const prompts = section.text.split('\n')
      .filter(line => /^\d+[.)]\s/u.test(line))
      .map(line => line.replace(/^\d+[.)]\s*/u, '').trim());
    const answers = part === '1' ? pack.part1 : pack.part3;
    if (prompts.length !== 6 || answers.length !== prompts.length)
      throw new Error(`Every Speaking interview prompt needs a matching model: ${section.id}.`);
    return {
      sectionId: section.id, title: `Câu trả lời tham khảo · Part ${part}`,
      sampleAnswer: part === '1'
        ? `Part 1 · ${item.topic}: six illustrative personal responses below show how a direct answer can be followed by a relevant detail, preference or experience.`
        : `Part 3 · ${item.topic}: six illustrative discussion responses below develop a position with reasons and qualifications rather than presenting an absolute claim as a fact.`,
      explanation: part === '1'
        ? 'Mỗi mẫu trả lời đúng câu hỏi tương ứng, rồi phát triển bằng một chi tiết. Người nói và các trải nghiệm là minh họa; câu trả lời khác vẫn có thể phù hợp. Mẫu không đánh giá phát âm và không bảo đảm band.'
        : 'Mỗi mẫu bàn đúng vấn đề được hỏi, nêu lý do hoặc ví dụ và điều kiện giới hạn. Bạn có thể có quan điểm khác nếu giải thích rõ. Đây là tài liệu minh họa, không phải đáp án duy nhất hay điểm IELTS được chứng nhận.',
      keyPoints: part === '1'
        ? ['Trả lời trực tiếp rồi bổ sung một chi tiết liên quan.', `Liên hệ chủ đề “${item.topic}” với trải nghiệm hoặc lựa chọn cá nhân.`, 'Giữ câu trả lời tự nhiên; không đọc thuộc một bài dài.']
        : [`Phát triển các vấn đề rộng hơn của chủ đề “${item.topic}”.`, 'Giải thích quan điểm bằng lý do và một ví dụ thích hợp.', 'Nêu điều kiện hoặc giới hạn khi nhận định không áp dụng cho mọi trường hợp.'],
      responses: prompts.map((prompt, index) => ({ prompt, sampleAnswer: answers[index]! })),
    };
  });
}

/** Kept outside public tasks; the server exposes these only in completed-attempt feedback. */
export const speakingReferenceAnswers: Record<string, ReferenceResponse[]> = Object.fromEntries(
  [...freshSpeakingLessons, ...freshSpeakingMocks, ...newSpeakingMocks].map(item => [item.id, references(item)]),
);
