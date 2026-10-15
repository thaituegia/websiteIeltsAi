import { ArrowRight, CheckCircle2, History, RotateCcw } from "lucide-react";
import type { AttemptSummary, ContentProgress } from "../shared/types";
import { Button, ErrorNotice, Modal } from "./components";

const submittedDate = (attempt: AttemptSummary) => {
  const value = attempt.submittedAt && new Date(attempt.submittedAt);
  return value && Number.isFinite(value.getTime())
    ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(value)
    : "Đã lưu";
};

/** Only server-confirmed submissions count as completed; drafts never replace a result. */
export function CompletedExerciseResult({ attempt }: { attempt: AttemptSummary }) {
  const score = attempt.estimatedBand != null
    ? `Band ${attempt.estimatedBand.toFixed(1)}`
    : attempt.rawScore != null && attempt.total != null
      ? `${attempt.rawScore}/${attempt.total} câu đúng`
      : attempt.feedbackSource == null
        ? "Đang chờ chấm"
        : "Đã lưu phản hồi";
  return (
    <div className="completed-exercise-result">
      <strong>{score}</strong>
      <span>Lần nộp gần nhất: {submittedDate(attempt)}</span>
    </div>
  );
}

export function CompletedExerciseDialog({
  progress, title, busy = false, error, onClose, onReview, onRetake,
}: {
  progress: ContentProgress;
  title: string;
  busy?: boolean;
  error?: string;
  onClose: () => void;
  onReview: () => void;
  onRetake: () => void;
}) {
  return (
    <Modal title="Bạn đã hoàn thành bài này" onClose={() => { if (!busy) onClose(); }}>
      <div className="completed-exercise-dialog stack" aria-busy={busy}>
        <div className="completed-exercise-heading">
          <span className="completed-exercise-medal"><CheckCircle2 size={30} aria-hidden="true" /></span>
          <div><h3>{title}</h3><p>{progress.completedCount} lượt đã hoàn thành</p></div>
        </div>
        {progress.latestAttempt && <CompletedExerciseResult attempt={progress.latestAttempt} />}
        <p className="muted">
          Kết quả lần làm gần nhất được lưu sau khi bạn nộp bài. Làm lại không xóa kết quả cũ;
          mọi lượt đã nộp vẫn có trong lịch sử học.
        </p>
        {progress.activeAttemptId && <p className="completed-exercise-draft">
          Bạn đang có một lượt làm lại chưa nộp. Tiếp tục lượt này để giữ bản nháp đã lưu.
        </p>}
        {error && <ErrorNotice message={error} />}
        <div className="completed-exercise-actions">
          <Button disabled={busy || !progress.latestAttempt} onClick={onReview}>
            <History size={16} /> Xem kết quả gần nhất <ArrowRight size={15} />
          </Button>
          <Button className="secondary" disabled={busy} onClick={onRetake}>
            <RotateCcw size={16} />
            {busy ? "Đang mở…" : progress.activeAttemptId ? "Tiếp tục làm lại" : "Làm lại"}
          </Button>
          <Button className="secondary" disabled={busy} onClick={onClose}>Đóng</Button>
        </div>
      </div>
    </Modal>
  );
}
