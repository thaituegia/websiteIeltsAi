import { BookOpen, CheckCircle2, Clock3, LockKeyhole, NotebookPen, Sparkles } from "lucide-react";
import type { ContentSection, ReferenceResponse, WritingStudyGuide } from "../shared/types";
import { Badge, Card } from "./components";
import { WordText } from "./WordNotebook";
import "./writing-study.css";

export function WritingStudyLocked() {
  return <div className="writing-study-locked">
    <LockKeyhole size={18} aria-hidden="true" />
    <p>Bài mẫu và hướng dẫn sẽ mở sau khi nộp bài.</p>
  </div>;
}

/** Review material belongs to the selected submitted task, never to the editor. */
export function WritingStudyPanel({ section, sectionIndex, reference, guide }: {
  section: ContentSection;
  sectionIndex: number;
  reference?: ReferenceResponse;
  guide?: WritingStudyGuide;
}) {
  // Even malformed legacy feedback must not display another task's model.
  const matchedReference = reference?.sectionId === section.id ? reference : undefined;
  const matchedGuide = guide?.sectionId === section.id ? guide : undefined;
  const task = section.task ?? matchedGuide?.task ?? 1;
  const sample = matchedReference?.sampleAnswer || "";
  const count = sample.trim().split(/\s+/u).filter(Boolean).length;
  return <section className="writing-study-panel" data-section-id={section.id}
    aria-label={`Bài mẫu và hướng dẫn Task ${task}`}>
    <header className="writing-study-heading">
      <span className="writing-study-book" aria-hidden="true"><NotebookPen size={27} /></span>
      <div>
        <p className="eyebrow">SỔ TAY WRITING · TASK {task}</p>
        <h2>Đọc bài mẫu, hiểu cách viết</h2>
        <p>Đối chiếu với bài của bạn rồi thử viết lại bằng lời văn riêng.</p>
      </div>
    </header>
    <div className="writing-study-grid">
      <Card className="reference-answer-card writing-study-model">
        <div className="writing-study-title">
          <h3><BookOpen size={19} aria-hidden="true" />Bài mẫu tham khảo</h3>
          {!!count && <Badge>{count} từ</Badge>}
        </div>
        <p className="reference-answer-notice">
          Đây là một cách trả lời phù hợp để học cách triển khai ý; không phải đáp án duy nhất hoặc cam kết đạt một band cụ thể.
        </p>
        {sample ? <div className="reference-answers">
          <article className="reference-answer" aria-label={matchedReference!.title}>
            <h4><WordText text={matchedReference!.title} sectionIndex={sectionIndex} /></h4>
            <div className="reference-sample" lang="en"><WordText text={sample} sectionIndex={sectionIndex} /></div>
            {matchedReference!.explanation && <p className="writing-study-model-note"><strong>Cách tiếp cận:</strong> {matchedReference!.explanation}</p>}
            {!!matchedReference!.keyPoints.length && <details className="writing-study-original-notes">
              <summary>Ghi chú gốc đi kèm bài mẫu</summary>
              <ul>{matchedReference!.keyPoints.map((point, index) => <li key={index}>{point}</li>)}</ul>
            </details>}
          </article>
        </div> : <p className="writing-study-missing" role="status">
          Task này chưa có bài mẫu được lưu. Bài viết và phản hồi của bạn vẫn được giữ nguyên.
        </p>}
      </Card>
      <Card className="writing-study-guide">
        <div className="writing-study-title">
          <h3><Sparkles size={19} aria-hidden="true" />Hướng dẫn làm bài bằng tiếng Việt</h3>
        </div>
        {matchedGuide ? <>
          <p className="writing-study-type">{matchedGuide.taskTypeLabel}</p>
          {matchedGuide.notice && <p className="writing-study-source-notice" role="status">{matchedGuide.notice}</p>}
          <div className="writing-study-time" aria-label="Phân bổ thời gian gợi ý">
            <h4>Phân bổ thời gian gợi ý</h4>
            <p><Clock3 size={16} aria-hidden="true" /><strong>{matchedGuide.timePlan.totalMinutes} phút</strong><span>· ít nhất {matchedGuide.timePlan.minimumWords} từ</span></p>
            <ol>
              <li><strong>{matchedGuide.timePlan.planningMinutes}′</strong><span>Đọc đề, lập dàn ý</span></li>
              <li><strong>{matchedGuide.timePlan.writingMinutes}′</strong><span>Viết bài</span></li>
              <li><strong>{matchedGuide.timePlan.checkingMinutes}′</strong><span>Đọc và sửa</span></li>
            </ol>
            <p className="writing-study-time-note">Gợi ý theo thời lượng IELTS; không thay đổi đồng hồ của bài đã làm.</p>
          </div>
          <details className="writing-study-detail" open>
            <summary>Phân tích đề và cách làm</summary>
            <div className="writing-study-detail-body">
              <ul className="writing-study-analysis">{matchedGuide.analysis.map((point, index) => <li key={index}>{point}</li>)}</ul>
              <ol className="writing-study-steps">{matchedGuide.steps.map((step, index) => <li key={index}>
                <span className="writing-study-step-number" aria-hidden="true">{index + 1}</span>
                <div><h4>{step.title}</h4><p>{step.detail}</p></div>
              </li>)}</ol>
            </div>
          </details>
          {!!matchedGuide.paragraphs.length && <details className="writing-study-detail">
            <summary>Dàn ý theo bài mẫu</summary>
            <div className="writing-study-detail-body writing-study-paragraphs">
              <p className="writing-study-help">Xem vai trò của từng đoạn rồi đối chiếu với đoạn tương ứng trong bài mẫu.</p>
              {matchedGuide.paragraphs.map((paragraph) => <article key={paragraph.index}>
                <h4>Đoạn {paragraph.index + 1} · {paragraph.role}</h4>
                <p>{paragraph.guidance}</p>
                {paragraph.excerpt && <blockquote lang="en">{paragraph.excerpt}</blockquote>}
              </article>)}
            </div>
          </details>}
          {!!matchedGuide.usefulLanguage.length && <details className="writing-study-detail">
            <summary>Cụm từ trong bài mẫu</summary>
            <div className="writing-study-detail-body">
              <p className="writing-study-help">Học cách dùng theo ngữ cảnh, tránh chép nguyên câu vào mọi đề.</p>
              <dl className="writing-study-language">{matchedGuide.usefulLanguage.map((item, index) => <div key={index}>
                <dt lang="en">{item.phrase}</dt><dd>{item.meaningVi}</dd>
              </div>)}</dl>
            </div>
          </details>}
          {!!matchedGuide.checklist.length && <details className="writing-study-detail">
            <summary>Checklist tự soát bài</summary>
            <ul className="writing-study-detail-body writing-study-checklist">{matchedGuide.checklist.map((point, index) => <li key={index}>
              <CheckCircle2 size={16} aria-hidden="true" /><span>{point}</span>
            </li>)}</ul>
          </details>}
          {!!matchedGuide.pitfalls.length && <details className="writing-study-detail">
            <summary>Lỗi cần tránh</summary>
            <ul className="writing-study-detail-body writing-study-pitfalls">{matchedGuide.pitfalls.map((point, index) => <li key={index}>{point}</li>)}</ul>
          </details>}
        </> : <p className="writing-study-missing" role="status">
          Chưa có hướng dẫn riêng cho Task này. Bạn vẫn có thể đọc bài mẫu và phần phản hồi đã lưu.
        </p>}
      </Card>
    </div>
  </section>;
}
