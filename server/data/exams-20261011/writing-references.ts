import type { ChartVisual, ContentSection, ReferenceResponse, StoredContent } from "../../../shared/types.js";
import { freshWritingLessons, freshWritingMocks } from "../fresh/productive.js";
import { newWritingMocks } from "./writing.js";
import { opinionEssays } from "./writing-essays-opinion.js";
import { discussionEssays } from "./writing-essays-discussion.js";
import { advantagesEssays } from "./writing-essays-advantages.js";
import { problemEssays } from "./writing-essays-problems.js";
import { causesEssays } from "./writing-essays-causes.js";
import { twoPartEssays } from "./writing-essays-two-part.js";
import { academicMockEssays } from "./writing-essays-mocks-academic.js";
import { generalMockEssays } from "./writing-essays-mocks-general.js";
import { newMockEssays } from "./writing-essays-new.js";
import { lessonLetters } from "./writing-letters-lessons.js";
import { mockLetters } from "./writing-letters-mocks.js";
import { numericReport, spatialReports } from "./writing-reports.js";

const essays = { ...opinionEssays, ...discussionEssays, ...advantagesEssays, ...problemEssays, ...causesEssays, ...twoPartEssays, ...academicMockEssays, ...generalMockEssays, ...newMockEssays };
const letters = { ...lessonLetters, ...mockLetters };
const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
function firstSentence(text: string): string {
  return text.trim().match(/^[\s\S]*?[.!?](?:\s|$)/)?.[0].trim() ?? text.trim();
}
function essayExplanation(section: ContentSection): string {
  const prompt = section.text.toLowerCase();
  if (prompt.includes("discuss both views")) return "Bài tham khảo trình bày và giải thích cả hai quan điểm, sau đó xác lập ý kiến riêng. Hãy so sánh lập luận, ví dụ và cách duy trì quan điểm; IELTS Writing không có một bài văn duy nhất được coi là đáp án đúng.";
  if (prompt.includes("advantages and disadvantages")) return "Bài tham khảo phân tích cả lợi ích và hạn chế của đúng sự thay đổi được nêu trong đề, kèm ví dụ và điều kiện áp dụng. Một lập luận khác vẫn hợp lệ nếu trả lời đầy đủ và có hỗ trợ rõ ràng.";
  if (prompt.includes("agree or disagree")) return "Bài tham khảo nêu mức độ đồng ý rõ ràng, giải thích bằng các luận điểm và ví dụ liên quan trực tiếp đến đề. Đây là một cách trả lời khả thi, không phải quan điểm bắt buộc hay điểm band được giám khảo chứng nhận.";
  return "Bài tham khảo trả lời từng câu hỏi trong đề ở các đoạn riêng, phát triển nguyên nhân, hệ quả hoặc biện pháp theo đúng phạm vi yêu cầu. Chú ý mối liên hệ giữa lập luận và ví dụ; cách diễn đạt hay quan điểm khác vẫn có thể đạt yêu cầu.";
}
function task1KeyPoints(content: StoredContent, section: ContentSection, answer: string): string[] {
  const paragraphs = answer.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
  if (content.testType === "general") {
    const bullets = section.text.split("\n").filter(line => line.trim().startsWith("•")).map(line => line.replace(/^\s*•\s*/, ""));
    return bullets.map(bullet => `Required coverage: ${bullet}.`);
  }
  const charts = (section.visuals ?? []).filter((asset): asset is ChartVisual => ["line", "bar", "pie", "table"].includes(asset.type));
  if (charts.length) return [firstSentence(paragraphs[1] ?? answer), ...charts.map(chart => `${chart.title}: ${chart.series.join(" / ")}; unit: ${chart.unit}.`), "Describe only values and comparisons shown; do not invent causes, populations or unreported totals."];
  return paragraphs.slice(1).map(firstSentence);
}
function response(content: StoredContent, section: ContentSection): ReferenceResponse {
  const task = section.task ?? 2;
  let sampleAnswer: string;
  if (task === 2) {
    const essay = essays[section.id];
    if (!essay) throw new Error(`Missing Writing essay model for ${section.id}`);
    sampleAnswer = essay;
  } else if (content.testType === "general") {
    const letter = letters[section.id];
    if (!letter) throw new Error(`Missing Writing letter model for ${section.id}`);
    sampleAnswer = letter;
  } else {
    sampleAnswer = spatialReports[section.id] ?? numericReport(section);
  }
  if (wordCount(sampleAnswer) < (task === 1 ? 150 : 250)) throw new Error(`Writing reference below authentic minimum for ${section.id}`);
  const explanation = task === 2 ? essayExplanation(section) : content.testType === "general"
    ? "Thư tham khảo xử lý đủ ba gạch đầu dòng với cách xưng hô, mở và kết phù hợp người nhận. Các tên, ngày và tình huống bổ sung trong thư là ví dụ hư cấu có thể lựa chọn; không phải dữ kiện cố định mà người học phải sao chép."
    : "Báo cáo tham khảo dựa trên số liệu, vị trí hoặc các bước được thể hiện trong chính hình của đề. Cần có tổng quan, chọn đặc điểm chính và so sánh chính xác; không suy diễn nguyên nhân hay thêm chi tiết không có trong nguồn.";
  const keyPoints = task === 2 ? sampleAnswer.split(/\n\n+/).map(firstSentence) : task1KeyPoints(content, section, sampleAnswer);
  return { sectionId: section.id, title: `Task ${task} · Bài tham khảo (${wordCount(sampleAnswer)} từ)`, sampleAnswer, explanation, keyPoints };
}

/** Stored server-side and attached by the active registry. Public practice
 * payloads must omit these responses until the attempt has been submitted. */
export const writingReferenceAnswers: Record<string, ReferenceResponse[]> = Object.fromEntries(
  [...freshWritingLessons, ...freshWritingMocks, ...newWritingMocks].map(content => [content.id, content.sections.map(section => response(content, section))]),
);
