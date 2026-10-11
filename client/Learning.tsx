import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  BookOpen,
  Headphones,
  PenLine,
  Mic,
  Clock3,
  ArrowRight,
  ArrowLeft,
  Search,
  Play,
  Pause,
  Square,
  Check,
  CheckCircle2,
  AlertTriangle,
  Volume2,
  Save,
  Sparkles,
  Send,
  RotateCcw,
  ChevronRight,
  Layers,
} from "lucide-react";
import type {
  Attempt,
  AttemptSummary,
  ContentItem,
  ContentKind,
  ContentSection,
  Feedback,
  LibraryResult,
  PlacementState,
  Question,
  QuestionBlock,
  VocabularyEntry,
} from "../shared/types";
import { api, ApiError, json } from "./api";
import { useApi, useSession } from "./hooks";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Loading,
  Modal,
  PageHeader,
  SkillBadge,
  bandLabel,
  skillNames,
} from "./components";
import {
  speakSections,
  startRecording,
  submitSpeaking,
  type RecordingSession,
} from "./audio";
import { SectionVisuals } from "./ContentVisual";
import "./learning.css";
import { DuoPlacementStatus, DuoAttemptContext } from "./Duo";
import {
  ExamRules, ExamStartDialog, InvalidatedExam, useExamIntegrity,
  isExamInvalidated, beginExamSubmission, completeExamIntegrity, resumeExamSubmission,
  examHeaders,
  useSharedRoomIntegrity,
} from "./ExamIntegrity";

const icons = {
  reading: BookOpen,
  listening: Headphones,
  writing: PenLine,
  speaking: Mic,
  grammar: Layers,
};
const errorMessage = (cause: unknown) =>
  cause instanceof Error
    ? cause.message
    : "Không thể hoàn thành thao tác. Hãy thử lại.";
const wordCount = (text: string) =>
  text.trim().split(/\s+/u).filter(Boolean).length;
const formatTime = (seconds: number) =>
  `${Math.floor(Math.max(0, seconds) / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(Math.max(0, seconds) % 60)
    .toString()
    .padStart(2, "0")}`;
const skillDescriptions: Record<ContentKind, string> = {
  reading: "Đọc sâu. Hiểu rõ. Tìm đúng bằng chứng.",
  listening: "Lắng nghe từng ý, nắm bắt từng chi tiết.",
  writing: "Phát triển ý tưởng, viết có cấu trúc.",
  speaking: "Luyện giọng nói và diễn đạt của riêng bạn.",
  grammar: "Nền tảng vững vàng cho cả bốn kỹ năng.",
};

/* Decorative campaign scenery. Progress and results remain in the real lesson UI. */
function LibraryCampaignArt({ exam }: { exam: boolean }) {
  return (
    <svg className="campaign-intro-art" viewBox="0 0 420 260" aria-hidden="true" focusable="false">
      <ellipse cx="223" cy="225" rx="177" ry="20" fill="#172f22" opacity=".15" />
      <path d="m32 162 163-101 191 99-174 79Z" fill="#85603d" stroke="#624a32" strokeWidth="3" strokeLinejoin="round" />
      <path d="m32 146 163-99 191 98-174 79Z" fill="#acc286" stroke="#624a32" strokeWidth="3" strokeLinejoin="round" />
      <path d="m51 144 144-85 174 86-157 67Z" fill="#cad49b" />
      <path d="M102 170c53-47 53-58 91-59 47-1 11 55 78 61 18 2 29-7 42-19" fill="none" stroke="#fff2c9" strokeWidth="17" strokeLinecap="round" />
      <path d="M102 170c53-47 53-58 91-59 47-1 11 55 78 61 18 2 29-7 42-19" fill="none" stroke="#ae8148" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="2 10" />
      {[{ x: 80, y: 133 }, { x: 122, y: 110 }, { x: 295, y: 188 }, { x: 335, y: 172 }].map(({ x, y }) => (
        <g key={`${x}-${y}`} transform={`translate(${x} ${y})`}>
          <ellipse cx="0" cy="11" rx="15" ry="6" fill="#6e884b" opacity=".45" />
          <path d="M0-7v18" stroke="#775533" strokeWidth="6" strokeLinecap="round" />
          <path d="m0-43-18 32h8L-22 5h44L10-11h8Z" fill="#315e3d" stroke="#25492f" strokeWidth="2" strokeLinejoin="round" />
          <path d="m0-37-11 21h7L-13-1H0Z" fill="#6c954e" />
        </g>
      ))}
      <g transform="translate(261 47)">
        <path d="m-31 73 49 26 50-28-50-23Z" fill="#55734c" opacity=".28" />
        <path d="M-23 19v58l43 22V44Z" fill="#c36b44" stroke="#713f2e" strokeWidth="3" />
        <path d="m20 44 40-20v53L20 99Z" fill="#e6af69" stroke="#713f2e" strokeWidth="3" />
        <path d="m-23 19 39-22 44 27-40 20Z" fill="#fff0c7" stroke="#713f2e" strokeWidth="3" />
        <path d="M-28 21V2l10 5V-4l10 5v12l11 6V8l11 6v20Z" fill="#f2c987" stroke="#713f2e" strokeWidth="3" strokeLinejoin="round" />
        <path d="M48 29V11l10-5V-5l10-5v11l10-5v18Z" fill="#e4ac60" stroke="#713f2e" strokeWidth="3" strokeLinejoin="round" />
        <path d="M1 65c0-13 14-7 14 8v19L1 84Z" fill="#663a2a" />
        <path d="M27 8V-33" stroke="#713f2e" strokeWidth="4" strokeLinecap="round" />
        <path d="m29-33 32 10-32 10Z" fill="#d54d30" stroke="#8b3a27" strokeWidth="2" strokeLinejoin="round" />
      </g>
      <g transform="translate(190 127) rotate(-8)">
        <ellipse cx="0" cy="34" rx="28" ry="10" fill="#607e45" opacity=".35" />
        <path d="m-23-14 45 8v37l-45-7Z" fill="#e9ca84" stroke="#7d572d" strokeWidth="3" strokeLinejoin="round" />
        <path d="m-23-14 8-6 44 8-7 6Z" fill="#fff0bf" stroke="#7d572d" strokeWidth="2" />
        <path d="m22-6 7-6v38l-7 5Z" fill="#b78847" stroke="#7d572d" strokeWidth="2" />
        <path d="m-13-3 25 5m-25 5 20 3m-20 5 24 4" stroke="#a07742" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="12" cy="22" r="7" fill="#b8492d" stroke="#813923" strokeWidth="2" />
      </g>
      <g transform="translate(103 173)">
        <ellipse cx="0" cy="0" rx="20" ry="10" fill="#7d4d2e" />
        <ellipse cx="0" cy="-4" rx="20" ry="10" fill="#fff2c1" stroke="#94632f" strokeWidth="3" />
        <path d="M0-4v-35" stroke="#76452b" strokeWidth="4" strokeLinecap="round" />
        <path d="m2-39 27 9-27 11Z" fill={exam ? "#d24d30" : "#3c724c"} stroke="#73462b" strokeWidth="2" strokeLinejoin="round" />
      </g>
      <g transform="translate(346 118)">
        <path d="m-20 9 20 10 22-12V-7L1-17-20-6Z" fill="#cc8b35" stroke="#855523" strokeWidth="3" strokeLinejoin="round" />
        <path d="m-20-6 21 10 21-11M1 4v15" fill="none" stroke="#855523" strokeWidth="3" />
        <path d="m-11-11 22 10M-9 15V0m20 15V0" fill="none" stroke="#ffdc76" strokeWidth="4" />
        <path d="m-5-36 4 8 9 2-8 5-1 10-6-7-9 1 5-8-4-8Z" fill="#f7c44c" stroke="#c58b29" strokeWidth="2" />
      </g>
    </svg>
  );
}

function QuestTerrain() {
  return (
    <svg className="content-art-landscape" viewBox="0 0 300 130" aria-hidden="true" focusable="false">
      <path d="M-5 108 81 37l57 27 57-45 111 75v41H-5Z" fill="currentColor" opacity=".1" />
      <path d="M-5 128 91 74l61 35 71-47 85 46v25H-5Z" fill="currentColor" opacity=".15" />
      <path d="m200 126-47-33 44-23 82 26" fill="none" stroke="currentColor" opacity=".25" strokeWidth="3" strokeDasharray="5 7" />
      <path d="M256 49v37m1-37 20 7-20 8" fill="none" stroke="currentColor" opacity=".4" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="m39 66-11 21h6L25 101h28L43 87h7Z" fill="currentColor" opacity=".3" />
    </svg>
  );
}

export function LibraryPage() {
  return <ContentLibrary exam={false} />;
}
export function ExamPage() {
  return <ContentLibrary exam />;
}

function ContentLibrary({ exam }: { exam: boolean }) {
  const { user, health } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [skill, setSkill] = useState(params.get("skill") || ""),
    [topic, setTopic] = useState(""),
    [band, setBand] = useState(""),
    [cefr, setCefr] = useState(""),
    [testType, setTestType] = useState(user.testType),
    [query, setQuery] = useState(""),
    [search, setSearch] = useState("");
  const [busy, setBusy] = useState(""),
    [actionError, setActionError] = useState(""),
    [generator, setGenerator] = useState(false),
    [page, setPage] = useState(1);
  const [startContentId, setStartContentId] = useState("");
  useEffect(() => setPage(1), [skill, topic, band, cefr, testType, search]);
  const queryString = new URLSearchParams({
    page: String(page),
    pageSize: "24",
    ...(skill ? { skill } : {}),
    ...(topic ? { topic } : {}),
    ...(band ? { band } : {}),
    ...(cefr ? { cefr } : {}),
    testType,
    ...(search ? { q: search } : {}),
    ...(exam ? { format: "full-mock" } : {}),
  }).toString();
  const { data, loading, error, reload } = useApi<LibraryResult>(
    `/content?${queryString}`,
  );
  const progress = useApi<{ attempts: AttemptSummary[] }>(
    "/attempts?status=in-progress",
  );
  async function begin(contentId: string, accepted = false) {
    if (exam && health?.examIntegrityEnabled !== false && !accepted) {
      setStartContentId(contentId);
      return;
    }
    setBusy(contentId);
    setActionError("");
    try {
      const result = await api<{ attempt: Attempt }>("/attempts", {
        method: "POST",
        body: json({ contentId, mode: exam ? "exam" : "practice" }),
      });
      navigate(`/learn/${result.attempt.id}`);
      setStartContentId("");
    } catch (cause) {
      setActionError(errorMessage(cause));
    } finally {
      setBusy("");
    }
  }
  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("generate");
    setActionError("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await api<{ content: ContentItem }>("/content/generate", {
        method: "POST",
        body: json({
          skill: String(form.get("skill")),
          topic: String(form.get("topic")),
          band: Number(form.get("band")),
          testType,
        }),
      });
      setGenerator(false);
      await begin(result.content.id);
    } catch (cause) {
      setActionError(errorMessage(cause));
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="stack page-stack learning-library">
      <PageHeader
        eyebrow={
          exam ? "TRẢI NGHIỆM MỘT KỲ THI" : "HỌC MỖI NGÀY, TIẾN BỘ MỖI NGÀY"
        }
        title={exam ? "Phòng thi thử IELTS" : "Kho bài tập của bạn"}
        description={
          exam
            ? "Thi thử riêng theo thời gian thật, bất cứ khi nào bạn sẵn sàng. Chỉ kỳ thi nâng band trong lộ trình cần cả hai."
            : "Tự chọn bài và học riêng theo nhịp của bạn, từ nền tảng đến band 8.0. Kho bài tập luôn mở cho cả hai."
        }
        action={
          !exam && (
            <Button
              className="secondary small"
              onClick={() => setGenerator(true)}
            >
              <Sparkles size={16} />
              Tạo bài bằng AI
            </Button>
          )
        }
      />
      <section className={`library-intro ${exam ? "exam-intro" : ""}`}>
        <div className="library-intro-copy">
          <Badge className="light">
            {exam ? "ĐẤU TRƯỜNG THI THỬ" : "BẢN ĐỒ RÈN LUYỆN"}
          </Badge>
          <h2>
            {exam
              ? "Bình tĩnh. Tập trung. Làm hết sức."
              : "Một kỹ năng. Một bước tiến."}
          </h2>
          <p>
            {exam
              ? "Bản nháp và thời gian kết thúc được lưu trên máy chủ. Đọc đáp án và phản hồi sau khi nộp bài."
              : "Lọc theo kỹ năng, chủ đề và trình độ để tìm một bài vừa sức. Mỗi câu trả lời đều có một điều để học."}
          </p>
        </div>
        <LibraryCampaignArt exam={exam} />
      </section>
      {exam && (
        <div className="exam-format-grid">
          {[
            { skill: "reading", text: "3 phần · 40 câu · 60 phút" },
            { skill: "listening", text: "4 phần · 40 câu · 30 phút" },
            { skill: "writing", text: "2 tasks · 60 phút · trọng số 1:2" },
            { skill: "speaking", text: "3 parts · khoảng 12 phút" },
          ].map((item) => (
            <div key={item.skill}>
              <strong>{skillNames[item.skill as ContentKind]}</strong>
              <span>{item.text}</span>
            </div>
          ))}
        </div>
      )}
      {!!progress.data?.attempts.length && (
        <Card className="resume-panel">
          <div className="section-heading compact">
            <h2>Tiếp tục bài đang làm</h2>
            <Badge>{progress.data.attempts.length} bản nháp</Badge>
          </div>
          <div className="resume-list">
            {progress.data.attempts.slice(0, 4).map((attempt) => (
              <Link
                key={attempt.id}
                className="resume-item"
                to={`/learn/${attempt.id}`}
              >
                <span>
                  <SkillBadge skill={attempt.skill} />
                  <strong>{attempt.title}</strong>
                  <small>
                    {attempt.mode === "exam"
                      ? "Thi thử có giới hạn thời gian"
                      : "Luyện tập · bản nháp đã lưu"}
                  </small>
                </span>
                <ArrowRight size={18} />
              </Link>
            ))}
          </div>
        </Card>
      )}
      <div
        className="learning-skill-tabs"
        role="group"
        aria-label="Lọc theo kỹ năng"
      >
        <button className={!skill ? "active" : ""} onClick={() => setSkill("")}>
          Tất cả
        </button>
        {Object.entries(icons)
          .filter(([key]) => !exam || key !== "grammar")
          .map(([key, Icon]) => (
            <button
              key={key}
              className={skill === key ? "active" : ""}
              onClick={() => setSkill(key)}
            >
              <Icon size={17} />
              {skillNames[key as ContentKind]}
            </button>
          ))}
      </div>
      <form
        className="filter-bar learning-filters"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(query);
        }}
      >
        <label className="search-field">
          <Search size={16} />
          <input
            aria-label="Tìm bài tập"
            placeholder="Tìm một bài, một chủ đề…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <select
          aria-label="Chủ đề"
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
        >
          <option value="">Mọi chủ đề</option>
          {data?.topics.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <select
          aria-label="Band bài tập"
          value={band}
          onChange={(event) => setBand(event.target.value)}
        >
          <option value="">Mọi band</option>
          {[3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8].map((value) => (
            <option key={value} value={value}>
              Band {value.toFixed(1)}
            </option>
          ))}
        </select>
        <select
          aria-label="CEFR"
          value={cefr}
          onChange={(event) => setCefr(event.target.value)}
        >
          <option value="">CEFR</option>
          {["A2", "B1", "B2", "C1"].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <select
          aria-label="Hình thức IELTS"
          value={testType}
          onChange={(event) =>
            setTestType(event.target.value as typeof testType)
          }
        >
          <option value="academic">Academic</option>
          <option value="general">General Training</option>
        </select>
        <Button className="secondary small" type="submit">
          Tìm
        </Button>
      </form>
      {actionError && <ErrorNotice message={actionError} />}
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorNotice message={error} retry={() => void reload()} />
      ) : !data?.items.length ? (
        <EmptyState
          title="Chưa tìm thấy bài phù hợp"
          text="Thử một chủ đề hoặc trình độ khác để khám phá thêm bài luyện."
        />
      ) : (
        <>
          <div className="section-heading compact">
            <span className="muted">
              {data.total} bài phù hợp ·{" "}
              {testType === "academic" ? "Academic" : "General Training"}
            </span>
            <span className="muted tiny">
              Nội dung tự biên soạn · chưa hiệu chuẩn
            </span>
          </div>
          <div className="content-grid">
            {data.items.map((item, index) => {
              const Icon = icons[item.skill];
              return (
                <article className={`content-card ${item.skill}`} key={item.id}>
                  <div className="content-art">
                    <QuestTerrain />
                    <span className="content-art-number">
                      {String((page - 1) * 24 + index + 1).padStart(2, "0")}
                    </span>
                    <span className="content-skill-token"><Icon size={32} strokeWidth={1.75} /></span>
                    <span>{item.topic}</span>
                  </div>
                  <div className="content-card-body">
                    <div className="row wrap">
                      <SkillBadge skill={item.skill} />
                      <Badge>{item.cefr}</Badge>
                      {item.format === "full-mock" && <Badge>Full mock</Badge>}
                    </div>
                    <h3>{item.title}</h3>
                    <p>{item.description || skillDescriptions[item.skill]}</p>
                    <div className="content-card-meta">
                      <span>
                        <Clock3 size={13} />
                        {item.durationMinutes} phút
                      </span>
                      <span>
                        {item.questions.length
                          ? `${item.questions.length} câu`
                          : `${item.sections.length} phần`}
                      </span>
                      <span>Band {item.band.toFixed(1)}</span>
                    </div>
                    <Button
                      className="secondary"
                      disabled={!!busy}
                      onClick={() => void begin(item.id)}
                    >
                      {busy === item.id
                        ? "Đang mở…"
                        : exam
                          ? "Bắt đầu thi thử"
                          : "Bắt đầu luyện"}
                      <ArrowRight size={16} />
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
          {data.total > 24 && (
            <div className="library-pagination">
              <Button
                className="secondary small"
                disabled={page === 1}
                onClick={() => {
                  setPage((value) => value - 1);
                  window.scrollTo({ top: 0 });
                }}
              >
                <ArrowLeft size={14} />
                Trang trước
              </Button>
              <span>
                Trang {page} / {Math.ceil(data.total / 24)}
              </span>
              <Button
                className="secondary small"
                disabled={page * 24 >= data.total}
                onClick={() => {
                  setPage((value) => value + 1);
                  window.scrollTo({ top: 0 });
                }}
              >
                Trang sau
                <ArrowRight size={14} />
              </Button>
            </div>
          )}
        </>
      )}
      <p className="learning-disclaimer">
        Bài luyện do hệ thống tự biên soạn, không phải đề thi chính thức. Band
        và CEFR của nội dung là mức tham khảo; ngân hàng chưa được hiệu chuẩn
        bởi giám khảo IELTS.
      </p>
      {startContentId && <ExamStartDialog busy={!!busy} onClose={() => !busy && setStartContentId("")} onStart={() => void begin(startContentId, true)} />}
      {generator && (
        <Modal
          title="Tạo một bài luyện mới"
          onClose={() => !busy && setGenerator(false)}
        >
          <form className="stack" onSubmit={(event) => void generate(event)}>
            <p className="muted">
              AI tạo đề gốc và kiểm tra cấu trúc trước khi đưa vào thư viện.
              Chất lượng vẫn cần người học đối chiếu.
            </p>
            {!health?.services.openai && (
              <div className="notice warning">
                <AlertTriangle size={18} />
                OpenAI chưa được cấu hình. Thư viện sẵn có vẫn dùng được; tạo
                bài AI hiện chưa khả dụng.
              </div>
            )}
            <label className="field">
              Kỹ năng
              <select name="skill" defaultValue={skill || "reading"}>
                {Object.keys(icons).map((key) => (
                  <option key={key} value={key}>
                    {skillNames[key as ContentKind]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Chủ đề
              <input
                name="topic"
                required
                minLength={3}
                maxLength={80}
                placeholder="Ví dụ: renewable energy"
              />
            </label>
            <label className="field">
              Band mục tiêu
              <select name="band" defaultValue={band || "5.5"}>
                {[3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8].map((value) => (
                  <option value={value} key={value}>
                    {value.toFixed(1)}
                  </option>
                ))}
              </select>
            </label>
            <Button disabled={!!busy || !health?.services.openai}>
              {busy === "generate" ? "Đang tạo và kiểm tra…" : "Tạo bài luyện"}
              <Sparkles size={17} />
            </Button>
          </form>
        </Modal>
      )}
    </div>
  );
}

export function PlacementPage() {
  const { refresh, health } = useSession();
  const [params, setParams] = useSearchParams();
  const reviewId = params.get("review");
  const active = useApi<{ placement: PlacementState | null }>(
    reviewId ? `/placement/${encodeURIComponent(reviewId)}` : "/placement/active",
  );
  const [placement, setPlacement] = useState<PlacementState | null>(null),
    [answer, setAnswer] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [listening, setListening] = useState(false);
  const [startMode, setStartMode] = useState<"quick" | "deep" | null>(null);
  const integrityEnabled = health?.examIntegrityEnabled !== false;
  const integrity = useExamIntegrity("placement", placement?.id,
    integrityEnabled && !reviewId && !!placement?.question && !isExamInvalidated(placement), undefined,
    !!placement?.result && !isExamInvalidated(placement));
  const invalidated = isExamInvalidated(placement) || integrity.invalidated;
  const cancelSpeech = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!invalidated) return;
    cancelSpeech.current?.(); setListening(false); setAnswer("");
  }, [invalidated]);
  const [timerNow, setTimerNow] = useState(Date.now());
  const serverOffset = useRef(0);
  const lastExpiryPoll = useRef(0);
  const remainingSeconds = placement?.deadlineAt
    ? Math.max(0, Math.ceil((Date.parse(placement.deadlineAt) - timerNow - serverOffset.current) / 1000)) : null;
  useEffect(() => {
    if (placement?.serverNow) serverOffset.current = Date.parse(placement.serverNow) - Date.now();
  }, [placement]);
  useEffect(() => {
    const timer = window.setInterval(() => setTimerNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (reviewId || invalidated || !integrity.ready || !placement?.question || remainingSeconds !== 0 || busy ||
      Date.now() - lastExpiryPoll.current < 1000) return;
    lastExpiryPoll.current = Date.now();
    cancelSpeech.current?.(); setListening(false); setBusy(true);
    void api<{ placement: PlacementState }>(`/placement/${placement.id}`).then(async result => {
      setPlacement(result.placement); setAnswer("");
      if (result.placement.result) await refresh();
    }).catch(cause => setError(errorMessage(cause))).finally(() => setBusy(false));
  }, [timerNow, remainingSeconds, placement, reviewId, busy, refresh, invalidated, integrity.ready]);
  useEffect(() => {
    setPlacement(null);
    setAnswer("");
  }, [reviewId]);
  useEffect(() => {
    const found = active.data?.placement;
    if (found && (!reviewId || found.id === reviewId)) { setPlacement(found); setAnswer(found.draftAnswer || ""); }
    else if (active.data?.placement === null) setPlacement(null);
  }, [active.data, reviewId]);
  useEffect(() => () => cancelSpeech.current?.(), []);
  async function start(mode: "quick" | "deep", accepted = false) {
    if (integrityEnabled && !accepted) { setStartMode(mode); return; }
    setBusy(true);
    setError("");
    try {
      setPlacement(
        (
          await api<{ placement: PlacementState }>("/placement/start", {
            method: "POST",
            body: json({ mode }),
          })
        ).placement,
      );
      setAnswer("");
      setStartMode(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (!placement?.question || !answer || invalidated || !integrity.ready) return;
    const finalSubmission = integrityEnabled && placement.completed + 1 >= placement.total;
    setBusy(true);
    setError("");
    cancelSpeech.current?.();
    setListening(false);
    if (finalSubmission) beginExamSubmission("placement", placement.id);
    try {
      const result = await api<{ placement: PlacementState }>(
        `/placement/${placement.id}/answer`,
        {
          method: "POST",
          body: json({ questionId: placement.question.id, answer }),
        },
      );
      if (result.placement.result && !isExamInvalidated(result.placement)) completeExamIntegrity("placement", placement.id);
      setPlacement(result.placement);
      setAnswer("");
      if (result.placement.result) await refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
      if (finalSubmission) void resumeExamSubmission();
    }
  }
  async function selectAnswer(value: string) {
    if (!placement?.question || busy || invalidated || !integrity.ready) return;
    setAnswer(value); setBusy(true); setError("");
    try {
      const result = await api<{ placement: PlacementState }>(`/placement/${placement.id}/draft`, {
        method: "POST", body: json({ questionId: placement.question.id, answer: value }),
      });
      setPlacement(result.placement);
      if (result.placement.result) { setAnswer(""); await refresh(); }
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  function listen() {
    if (!placement?.question) return;
    try {
      cancelSpeech.current?.();
      setListening(true);
      cancelSpeech.current = speakSections(
        [
          {
            id: placement.question.id,
            title: "",
            text: placement.question.text,
          },
        ],
        () => setListening(false),
        (message) => {
          setError(message);
          setListening(false);
        },
      );
    } catch (cause) {
      setError(errorMessage(cause));
      setListening(false);
    }
  }
  if (active.loading) return <Loading />;
  return (
    <div className="stack page-stack placement-page">
      <PageHeader
        eyebrow="BẮT ĐẦU TỪ CHÍNH BẠN"
        title={reviewId ? "Xem lại bài kiểm tra đầu vào" : "Khám phá trình độ hiện tại"}
        description={reviewId ? "Đối chiếu từng câu đã làm với đáp án, giải thích và nội dung gốc." : "Một bài đánh giá thích ứng giúp bạn tìm điểm bắt đầu phù hợp, với khoảng bất định được trình bày rõ ràng."}
      />
      <DuoPlacementStatus />
      {error && <ErrorNotice message={error} />}
      {active.error && (
        <ErrorNotice
          message={active.error}
          retry={() => void active.reload()}
        />
      )}
      {reviewId && (
        <Link className="text-link" to="/history">
          <ArrowLeft size={16} /> Quay lại lịch sử học
        </Link>
      )}
      {invalidated && <InvalidatedExam onRestart={() => { setPlacement(null); setAnswer(""); if (reviewId) setParams({}); }} />}
      {!placement && !reviewId && (
        <>
          <section className="placement-hero">
            <div className="placement-orbit">
              <span>A2</span>
              <span>B1</span>
              <span>B2</span>
              <span>C1</span>
              <div>
                <BookOpen size={38} />
                <strong>Điểm xuất phát của bạn</strong>
              </div>
            </div>
            <div>
              <p className="eyebrow">KHÔNG CẦN ÔN TRƯỚC</p>
              <h2>
                Hiểu mình đang ở đâu.
                <br />
                <em>Biết nên đi tiếp thế nào.</em>
              </h2>
              <p>
                Câu hỏi Reading và Listening điều chỉnh theo câu trả lời của
                bạn. Hãy chọn phương án bạn hiểu, kể cả khi chưa chắc chắn.
              </p>
              <div className="notice">
                <AlertTriangle size={18} />
                <span>
                  Đây là ước lượng sàng lọc từ ngân hàng chưa hiệu chuẩn.
                  Writing và Speaking được đánh giá riêng khi bạn luyện bài.
                </span>
              </div>
            </div>
          </section>
          <div className="grid-2 placement-options">
            <Card>
              <Badge>KHỞI ĐỘNG NHANH</Badge>
              <h2>15 câu thích ứng</h2>
              <p>
                Nhận một điểm xuất phát sơ bộ, thích hợp cho buổi học đầu tiên.
              </p>
              <ul>
                <li>Reading & Listening xen kẽ</li>
                <li>Câu hỏi từ A2 đến C1</li>
                <li>20 phút · tự lưu lựa chọn và kết thúc khi hết giờ</li>
              </ul>
              <Button disabled={busy} onClick={() => void start("quick")}>
                Bắt đầu kiểm tra nhanh
                <ArrowRight size={17} />
              </Button>
            </Card>
            <Card>
              <Badge>HIỂU RÕ HƠN</Badge>
              <h2>30 câu chuyên sâu</h2>
              <p>Thêm dữ liệu để mô hình giảm độ bất định của ước lượng.</p>
              <p>
                Sau 30 câu Reading và Listening, tiếp tục bài Writing và
                Speaking riêng để bổ sung đánh giá cả bốn kỹ năng.
              </p>
              <ul>
                <li>Thích ứng theo độ khó từng câu</li>
                <li>Ước lượng kèm sai số chuẩn</li>
                <li>40 phút · {integrityEnabled ? "giữ nguyên tab thi trong suốt bài" : "đồng hồ vẫn chạy khi tải lại trang"}</li>
              </ul>
              <Button
                className="secondary"
                disabled={busy}
                onClick={() => void start("deep")}
              >
                Bắt đầu đánh giá chuyên sâu
                <ArrowRight size={17} />
              </Button>
            </Card>
          </div>
        </>
      )}
      {reviewId && placement?.question && !invalidated && (
        <Card>
          <h2>Bài kiểm tra chưa hoàn thành</h2>
          <p>Đáp án được mở khi hoàn thành hoặc hết thời gian.</p>
          <Button onClick={() => setParams({})}>Tiếp tục kiểm tra</Button>
        </Card>
      )}
      {placement?.question && !reviewId && !invalidated && (
        <>
        {integrityEnabled && <ExamRules compact />}
        {integrity.error && <ErrorNotice message={integrity.error} retry={() => void integrity.retry()} />}
        <Card className="placement-question">
          <div className="placement-progress">
            <span>
              Câu {placement.completed + 1} / {placement.total}
            </span>
            <Badge>
              {placement.mode === "quick"
                ? "Kiểm tra nhanh"
                : "Đánh giá chuyên sâu"}
            </Badge>
          </div>
          <div className="progress-track">
            <span
              style={{
                width: `${(placement.completed / placement.total) * 100}%`,
              }}
            />
          </div>
          <div className="section-heading compact">
            <SkillBadge skill={placement.question.skill} />
            <span className="muted tiny">
              {placement.question.cefr} · câu hỏi tự biên soạn
            </span>
          </div>
          {remainingSeconds !== null && (
            <div className={`placement-timer notice ${remainingSeconds < 120 ? "warning" : ""}`} role="timer" aria-label="Thời gian bài kiểm tra còn lại">
              <Clock3 size={18} /><strong>{formatTime(remainingSeconds)}</strong>
              <span>{integrityEnabled ? "Tải lại trang sẽ hủy bài. " : "Đồng hồ tiếp tục khi tải lại. "}Gợi ý cho câu này: khoảng {placement.suggestedQuestionSeconds || 90} giây.</span>
            </div>
          )}
          {placement.question.skill === "listening" ? (
            <div className="placement-listening">
              <Headphones size={30} />
              <p>Nghe đoạn văn rồi chọn câu trả lời.</p>
              <Button
                className="secondary"
                onClick={listen}
                disabled={listening}
              >
                <Volume2 size={17} />
                {listening ? "Đang phát…" : "Nghe đoạn văn"}
              </Button>
              <small>Giọng máy của trình duyệt · accent chưa kiểm định</small>
            </div>
          ) : (
            <div className="reading-passage placement-passage">
              {placement.question.text.split("\n").map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>
          )}
          <h2>{placement.question.question}</h2>
          <div className="answer-options">
            {placement.question.options.map((option, index) => (
              <label
                key={option}
                className={`answer-option ${answer === option ? "selected" : ""}`}
              >
                <input
                  type="radio"
                  name="placement-answer"
                  value={option}
                  checked={answer === option}
                  disabled={busy || remainingSeconds === 0 || !integrity.ready}
                  onChange={() => void selectAnswer(option)}
                />
                <span className="option-letter">
                  {String.fromCharCode(65 + index)}
                </span>
                <span>{option}</span>
              </label>
            ))}
          </div>
          <div className="placement-footer">
            <span className="muted tiny">Lựa chọn được tự lưu. Hết giờ sẽ mở đáp án các câu đã gặp.</span>
            <Button disabled={busy || !answer || remainingSeconds === 0 || !integrity.ready} onClick={() => void submit()}>
              {busy ? "Đang lưu…" : "Câu tiếp theo"}
              <ArrowRight size={17} />
            </Button>
          </div>
        </Card>
        </>
      )}
      {placement?.result && !invalidated && (
        <>
          <Card className="placement-complete">
            <CheckCircle2 size={44} />
            <p className="eyebrow">BẠN ĐÃ TÌM ĐƯỢC ĐIỂM BẮT ĐẦU</p>
            <h2>Band ước lượng {bandLabel(placement.result.estimatedBand)}</h2>
            <p>
              Sai số chuẩn mô hình Rasch: {placement.standardError.toFixed(2)}{" "}
              (thang theta). Đây không phải khoảng tin cậy đã hiệu chuẩn theo
              band IELTS.
            </p>
            <div className="row wrap">
              <Link className="button" to="/plan">
                Xem lộ trình của hai người
                <ArrowRight size={17} />
              </Link>
              <Button className="secondary" onClick={() => {
                setPlacement(null);
                if (reviewId) setParams({});
              }}>
                Làm một bài đánh giá khác
              </Button>
            </div>
          </Card>
          <Card>
            <div className="section-heading compact">
              <h2>Bổ sung đánh giá hai kỹ năng còn lại</h2>
              <Badge>Writing & Speaking</Badge>
            </div>
            <p className="muted">
              Kết quả đầu vào hiện phản ánh Reading và Listening. Viết một bài
              và ghi một câu trả lời Speaking để bổ sung hồ sơ của bạn. Band
              tổng chỉ được tổng hợp khi cả bốn kỹ năng có ước lượng hợp lệ. Khi
              AI chưa kết nối, Writing và Speaking cung cấp checklist tự luyện
              và chưa có band.
            </p>
            <div className="row wrap">
              <Link className="button" to="/library?skill=writing">
                <PenLine size={17} />
                Tiếp tục với Writing
              </Link>
              <Link className="button secondary" to="/library?skill=speaking">
                <Mic size={17} />
                Tiếp tục với Speaking
              </Link>
            </div>
          </Card>
          <FeedbackView feedback={placement.result} />
        </>
      )}
      {startMode && <ExamStartDialog busy={busy} onClose={() => !busy && setStartMode(null)} onStart={() => void start(startMode, true)} />}
    </div>
  );
}

export function LearningPage() {
  const { attemptId: id = "" } = useParams();
  const { health, refresh } = useSession();
  const [attempt, setAttempt] = useState<Attempt | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const integrityEnabled = health?.examIntegrityEnabled !== false;
  const protectedExam = integrityEnabled && (attempt?.mode === "exam" || !!attempt?.duoAssessmentId);
  const integrityKind = attempt?.duoAssessmentId ? "assessment" : "attempt";
  const integrityResource = attempt?.duoAssessmentId || attempt?.id;
  const integrity = useExamIntegrity(integrityKind, integrityResource,
    protectedExam && !isExamInvalidated(attempt) && attempt?.integrity?.status !== "completed" && (!!attempt?.duoAssessmentId || attempt?.status === "in-progress"), attempt?.id,
    attempt?.integrity?.status === "completed" || (!attempt?.duoAssessmentId && attempt?.status === "submitted"));
  const roomIntegrity = useSharedRoomIntegrity(undefined, attempt?.duoAssessmentId);
  const invalidated = isExamInvalidated(attempt) || integrity.invalidated || roomIntegrity.invalidated;
  const grading = protectedExam && attempt?.status === "in-progress" &&
    (attempt.integrity?.phase === "grading" || integrity.session?.phase === "grading");
  const canWrite = useRef(false);
  canWrite.current = !invalidated && !grading && (!protectedExam || integrity.ready);
  const [responses, setResponses] = useState<Record<string, string>>({}),
    [essays, setEssays] = useState<Record<string, string>>({}),
    [transcript, setTranscript] = useState(""),
    [revision, setRevision] = useState(0),
    [saveState, setSaveState] = useState("saved"),
    [saveError, setSaveError] = useState("");
  const [section, setSection] = useState(0),
    [now, setNow] = useState(Date.now()),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false),
    [progress, setProgress] = useState("");
  const [recording, setRecording] = useState(false),
    [recordSeconds, setRecordSeconds] = useState(0),
    [recordBusy, setRecordBusy] = useState(false),
    [audioBlob, setAudioBlob] = useState<Blob | null>(null),
    [audioUrl, setAudioUrl] = useState("");
  const [playing, setPlaying] = useState(false),
    [paused, setPaused] = useState(false),
    [listenNotice, setListenNotice] = useState(""),
    [listenBusy, setListenBusy] = useState(false),
    [showTranscript, setShowTranscript] = useState(false),
    [savedWord, setSavedWord] = useState(""),
    [savedVocabularyIds, setSavedVocabularyIds] = useState<Set<string>>(
      new Set(),
    ),
    [vocabulary, setVocabulary] = useState<VocabularyEntry[]>([]),
    [activeSeconds, setActiveSeconds] = useState(0);
  const recorder = useRef<RecordingSession | null>(null),
    stopSpeech = useRef<(() => void) | null>(null),
    listenAudio = useRef<HTMLAudioElement | null>(null),
    listenUrl = useRef(""),
    timedOut = useRef(false),
    recordingStart = useRef(0);
  useEffect(() => {
    if (!invalidated) return;
    setResponses({}); setEssays({}); setTranscript(""); setAudioBlob(null);
    void recorder.current?.discard(); recorder.current = null;
    stopSpeech.current?.(); listenAudio.current?.pause();
    setRecording(false); setPlaying(false); setConfirm(false);
  }, [invalidated]);
  const activeMilliseconds = useRef(0);
  const loadGeneration = useRef(0);
  const mounted = useRef(true);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const draftVersion = useRef(0);
  const latest = useRef({ responses, essays, transcript });
  latest.current = { responses, essays, transcript };
  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoading(true);
    setError("");
    setAttempt(null);
    try {
      const result = await api<{ attempt: Attempt }>(
        `/attempts/${encodeURIComponent(id)}`,
      );
      if (generation !== loadGeneration.current || !mounted.current) return;
      setAttempt(result.attempt);
      setResponses(result.attempt.responses);
      setEssays(result.attempt.essays);
      setTranscript(result.attempt.transcript);
      setAudioBlob(null);
      setSection(0);
      setRecording(false);
      setPlaying(false);
      setShowTranscript(false);
      setVocabulary([]);
      setSaveError("");
      activeMilliseconds.current = result.attempt.durationSeconds * 1000;
      setActiveSeconds(result.attempt.durationSeconds);
      setRevision(0);
      setSaveState("saved");
      timedOut.current = false;
    } catch (cause) {
      if (generation === loadGeneration.current && mounted.current)
        setError(errorMessage(cause));
    } finally {
      if (generation === loadGeneration.current && mounted.current)
        setLoading(false);
    }
  }, [id]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!attempt || attempt.status !== "in-progress" ||
        (!grading && integrity.session?.status !== "completed")) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const result = await api<{ attempt: Attempt }>(`/attempts/${encodeURIComponent(attempt.id)}`);
        if (cancelled) return;
        setAttempt(result.attempt);
        if (result.attempt.status === "submitted") {
          setResponses(result.attempt.responses); setEssays(result.attempt.essays); setTranscript(result.attempt.transcript);
          await refresh();
        }
      } catch (cause) {
        if (!cancelled) setError(errorMessage(cause));
      }
    };
    const timer = window.setInterval(() => { void poll(); }, 2500);
    void poll();
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [attempt?.id, attempt?.status, grading, integrity.session?.status]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!attempt || attempt.status !== "in-progress") return;
    let tick = performance.now();
    const timer = setInterval(() => {
      const current = performance.now();
      if (document.visibilityState === "visible")
        activeMilliseconds.current += Math.min(2000, current - tick);
      tick = current;
      setActiveSeconds(Math.floor(activeMilliseconds.current / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [attempt?.id, attempt?.status]);
  useEffect(
    () => () => {
      void recorder.current?.discard();
      stopSpeech.current?.();
      listenAudio.current?.pause();
      if (listenUrl.current) URL.revokeObjectURL(listenUrl.current);
    },
    [id],
  );
  useEffect(() => {
    if (!audioBlob) {
      setAudioUrl("");
      return;
    }
    const url = URL.createObjectURL(audioBlob);
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [audioBlob]);
  useEffect(() => {
    if (!attempt?.content.vocabularyIds.length) return;
    let cancelled = false;
    const ids = attempt.content.vocabularyIds;
    async function loadWords() {
      const first = await api<{ items: VocabularyEntry[]; total: number }>(
        "/vocabulary/bank?pageSize=100",
      );
      const pages = await Promise.all(
        Array.from(
          { length: Math.max(0, Math.ceil(first.total / 100) - 1) },
          (_, index) =>
            api<{ items: VocabularyEntry[] }>(
              `/vocabulary/bank?pageSize=100&page=${index + 2}`,
            ),
        ),
      );
      if (!cancelled)
        setVocabulary(
          [...first.items, ...pages.flatMap((page) => page.items)].filter(
            (item) => ids.includes(item.id),
          ),
        );
    }
    void loadWords().catch(() => undefined);
    void api<{ cards: { vocabularyId: string | null }[] }>("/vocabulary/cards")
      .then((result) => {
        if (!cancelled)
          setSavedVocabularyIds(
            new Set(
              result.cards.flatMap((card) =>
                card.vocabularyId ? [card.vocabularyId] : [],
              ),
            ),
          );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [attempt?.contentId]);
  const submitted = attempt?.status === "submitted";
  const saveDraft = useCallback(async () => {
    if (!attempt || attempt.status !== "in-progress" || !canWrite.current) return;
    const generation = loadGeneration.current;
    const work = saveQueue.current
      .catch(() => undefined)
      .then(async () => {
        if (generation !== loadGeneration.current || !mounted.current || !canWrite.current) return;
        const version = draftVersion.current;
        setSaveState("saving");
        setSaveError("");
        try {
          const result = await api<{ attempt: Attempt }>(
            `/attempts/${attempt.id}`,
            {
              method: "PATCH",
              body: json({
                ...latest.current,
                durationSeconds: Math.floor(activeMilliseconds.current / 1000),
              }),
            },
          );
          if (generation !== loadGeneration.current || !mounted.current) return;
          if (result.attempt.status !== "in-progress") setAttempt(result.attempt);
          setSaveState(version === draftVersion.current ? "saved" : "pending");
        } catch (cause) {
          if (generation !== loadGeneration.current || !mounted.current) return;
          if (cause instanceof ApiError && cause.status === 409) {
            const current = await api<{ attempt: Attempt }>(
              `/attempts/${attempt.id}`,
            );
            if (current.attempt.status !== "in-progress") {
              setAttempt(current.attempt);
              setSaveState("saved");
              return;
            }
          }
          setSaveState("error");
          setSaveError(errorMessage(cause));
          throw cause;
        }
      });
    saveQueue.current = work;
    await work;
  }, [attempt?.id, attempt?.status, attempt?.startedAt]);
  useEffect(() => {
    if (!revision || submitted || busy || invalidated || !integrity.ready) return;
    setSaveState("pending");
    const timer = setTimeout(() => {
      void saveDraft().catch(() => undefined);
    }, 650);
    return () => clearTimeout(timer);
  }, [revision, submitted, busy, saveDraft, invalidated, integrity.ready]);
  useEffect(() => {
    if (!attempt || submitted || busy || invalidated || !integrity.ready) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible")
        void saveDraft().catch(() => undefined);
    }, 15000);
    return () => clearInterval(timer);
  }, [saveDraft, submitted, busy, attempt?.id, invalidated, integrity.ready]);
  function changed() {
    draftVersion.current++;
    setRevision((value) => value + 1);
    setSaveState("pending");
  }
  async function stopRecordingNow() {
    const generation = loadGeneration.current;
    const current = recorder.current;
    recorder.current = null;
    setRecording(false);
    if (!current) return audioBlob;
    try {
      const blob = await current.stop();
      if (!canWrite.current || !mounted.current || generation !== loadGeneration.current) return null;
      if (blob.size > 25 * 1024 * 1024)
        throw new Error(
          "Bản ghi vượt giới hạn 25 MB. Hãy ghi lại một đoạn ngắn hơn.",
        );
      setAudioBlob(blob);
      return blob;
    } catch (cause) {
      setError(errorMessage(cause));
      return null;
    }
  }
  async function beginRecording() {
    const generation = loadGeneration.current;
    setError("");
    setRecordBusy(true);
    try {
      const session = await startRecording();
      if (generation !== loadGeneration.current || !mounted.current || !canWrite.current) {
        await session.discard();
        return;
      }
      recorder.current = session;
      recordingStart.current = Date.now();
      setRecordSeconds(0);
      setRecording(true);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setRecordBusy(false);
    }
  }
  useEffect(() => {
    if (!recording) return;
    const limit =
      attempt?.mode === "exam" && attempt.content.format === "full-mock"
        ? 720
        : 180;
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - recordingStart.current) / 1000);
      setRecordSeconds(elapsed);
      if (elapsed >= limit) void stopRecordingNow();
    }, 250);
    return () => clearInterval(timer);
  }, [recording, attempt?.mode, attempt?.content.format]);
  async function submit(timeout = false) {
    if (!attempt || busy || submitted || !canWrite.current) return;
    const generation = loadGeneration.current;
    setBusy(true);
    setConfirm(false);
    setError("");
    let finalSubmission = false;
    try {
      let recordingBlob = recording ? await stopRecordingNow() : audioBlob;
      if (
        attempt.skill === "speaking" &&
        !recordingBlob &&
        attempt.audioAvailable
      ) {
        const stored = await fetch(`/api/attempts/${attempt.id}/audio`, {
          credentials: "include",
          headers: examHeaders(),
        });
        if (!stored.ok)
          throw new Error(
            "Không tải lại được bản ghi đã lưu. Hãy tải lại trang và thử lần nữa.",
          );
        recordingBlob = await stored.blob();
      }
      await saveDraft();
      if (!canWrite.current) return;
      if (protectedExam && !attempt.duoAssessmentId) {
        finalSubmission = true;
        beginExamSubmission("attempt", attempt.id);
      }
      else if (protectedExam && attempt.duoAssessmentId) {
        const current = await api<{ assessment: { parts: { attemptId: string | null; status: string }[] } }>(`/duo/assessments/${encodeURIComponent(attempt.duoAssessmentId)}`);
        if (current.assessment.parts.every(part => part.attemptId === attempt.id || (!!part.attemptId && part.status !== "in-progress"))) {
          finalSubmission = true;
          beginExamSubmission("assessment", attempt.duoAssessmentId);
        }
      }
      let result: Attempt;
      if (
        attempt.skill === "speaking" &&
        (recordingBlob || latest.current.transcript.trim())
      ) {
        result = await submitSpeaking(
          attempt.id,
          recordingBlob,
          latest.current.transcript,
          (stage, detected) => {
            if (!mounted.current || generation !== loadGeneration.current || (!canWrite.current && !finalSubmission)) return;
            const labels: Record<string, string> = {
              transcribing: "Đang phiên âm bản ghi…",
              transcribed: "Đã phiên âm, đang xử lý…",
              pronunciation: "Đang phân tích phát âm từ âm thanh…",
              "audio-scoring": "Đang nghe bản ghi và chấm bốn tiêu chí Speaking…",
              evaluating: "Đang đọc và phản hồi bài nói…",
              saving: "Đang lưu kết quả…",
            };
            setProgress(labels[stage] || "Đang xử lý bài nói…");
            if (detected) setTranscript(detected);
          },
        );
      } else
        result = (
          await api<{ attempt: Attempt }>(`/attempts/${attempt.id}/submit`, {
            method: "POST",
          })
        ).attempt;
      if (finalSubmission && result.status === "submitted") completeExamIntegrity(integrityKind, integrityResource!);
      else await resumeExamSubmission();
      if (generation !== loadGeneration.current || !mounted.current) return;
      setAttempt(result);
      setResponses(result.responses);
      setEssays(result.essays);
      setTranscript(result.transcript);
      setSaveState("saved");
      stopSpeech.current?.();
      listenAudio.current?.pause();
      setPlaying(false);
      await refresh();
    } catch (cause) {
      await resumeExamSubmission();
      if (generation !== loadGeneration.current || !mounted.current) return;
      setError(`${timeout ? "Đã hết thời gian. " : ""}${errorMessage(cause)}`);
      if (attempt.skill === "speaking")
        void api<{ attempt: Attempt }>(`/attempts/${attempt.id}`)
          .then((result) => {
            setAttempt(result.attempt);
          })
          .catch(() => undefined);
    } finally {
      if (generation === loadGeneration.current && mounted.current) {
        setBusy(false);
        setProgress("");
      }
    }
  }
  const remaining = attempt?.deadlineAt
    ? Math.max(0, Math.ceil((Date.parse(attempt.deadlineAt) - now) / 1000))
    : null;
  useEffect(() => {
    if (
      attempt &&
      !submitted &&
      !invalidated &&
      integrity.ready &&
      remaining === 0 &&
      !busy &&
      !timedOut.current
    ) {
      timedOut.current = true;
      void submit(true);
    }
  }, [remaining, submitted, busy, attempt?.id, invalidated, integrity.ready]);
  async function listen() {
    if (!attempt || !canWrite.current) return;
    const generation = loadGeneration.current;
    setListenBusy(true);
    setError("");
    stopSpeech.current?.();
    listenAudio.current?.pause();
    try {
      if (health?.services.elevenlabs) {
        const response = await fetch(
          `/api/content/${attempt.contentId}/audio`,
          { method: "POST", credentials: "include", headers: examHeaders() },
        );
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(payload?.error || "Không tải được bản nghe.");
        }
        const blob = await response.blob();
        if (!canWrite.current || !mounted.current || generation !== loadGeneration.current) return;
        if (listenUrl.current) URL.revokeObjectURL(listenUrl.current);
        listenUrl.current = URL.createObjectURL(blob);
        const audio = new Audio(listenUrl.current);
        listenAudio.current = audio;
        audio.onended = () => setPlaying(false);
        audio.onerror = () => {
          setPlaying(false);
          setError("Không phát được bản nghe. Kiểm tra thiết bị âm thanh.");
        };
        await audio.play();
        if (!canWrite.current || !mounted.current || generation !== loadGeneration.current) { audio.pause(); return; }
        setPlaying(true);
        setPaused(false);
        setListenNotice(
          "Giọng đọc ElevenLabs · nội dung tự biên soạn, accent chưa kiểm định.",
        );
      } else {
        const source = await api<{
          sections: ContentSection[];
          source: string;
          notice: string;
        }>(`/attempts/${attempt.id}/listening-source`, { method: "POST" });
        if (!canWrite.current || !mounted.current || generation !== loadGeneration.current) return;
        setListenNotice(source.notice);
        setPlaying(true);
        setPaused(false);
        stopSpeech.current = speakSections(
          source.sections,
          () => setPlaying(false),
          (message) => {
            setError(message);
            setPlaying(false);
          },
        );
      }
    } catch (cause) {
      setError(errorMessage(cause));
      setPlaying(false);
    } finally {
      setListenBusy(false);
    }
  }
  function pauseListening() {
    if (paused) {
      if (listenAudio.current)
        void listenAudio.current
          .play()
          .catch((cause) => setError(errorMessage(cause)));
      else speechSynthesis.resume();
    } else {
      if (listenAudio.current) listenAudio.current.pause();
      else speechSynthesis.pause();
    }
    setPaused(!paused);
  }
  function endListening() {
    stopSpeech.current?.();
    listenAudio.current?.pause();
    setPlaying(false);
    setPaused(false);
  }
  async function saveVocabulary(word: VocabularyEntry) {
    setSavedWord(`saving:${word.id}`);
    setError("");
    try {
      await api("/vocabulary/cards", {
        method: "POST",
        body: json({ vocabularyId: word.id }),
      });
      setSavedWord(word.id);
      setSavedVocabularyIds((previous) => new Set([...previous, word.id]));
    } catch (cause) {
      setError(errorMessage(cause));
      setSavedWord("");
    }
  }
  if (loading) return <Loading text="Đang mở bài và khôi phục bản nháp…" />;
  if (!attempt)
    return (
      <ErrorNotice
        message={error || "Không tìm thấy bài luyện."}
        retry={() => void load()}
      />
    );
  if (invalidated) return <div className="stack page-stack learning-page"><InvalidatedExam href={attempt.duoAssessmentId ? "/plan" : attempt.mode === "exam" ? "/exams" : "/library"} /></div>;
  const content = attempt.content;
  const activeSection = content.sections[section] || content.sections[0];
  const Icon = icons[attempt.skill];
  const questions = content.questions.filter(
    (question) => question.sectionIndex === section,
  );
  const answered = content.questions.filter((question) => {
    const response = responses[question.id] || "";
    return question.type === "choice-multiple"
      ? parseSelections(response).length === (question.selectionGroup?.count || 1)
      : !!response.trim();
  }).length;
  function updateResponse(questionIds: string[], value: string) {
    setResponses((previous) => ({
      ...previous,
      ...Object.fromEntries(questionIds.map(questionId => [questionId, value])),
    }));
    changed();
  }
  const locked = submitted || busy || grading || remaining === 0 || (protectedExam && !integrity.ready);
  return (
    <div className="stack page-stack learning-page">
      <DuoAttemptContext attempt={attempt} />
      {(roomIntegrity.requiresPresence || (protectedExam && !submitted && !grading)) && <ExamRules compact />}
      {grading && <div className="notice" role="status"><Clock3 size={20} /><span>Đã gửi bài, đang chờ máy chủ chấm. Câu trả lời đã được khóa; kết quả sẽ tự cập nhật khi chấm xong.</span></div>}
      {protectedExam && integrity.error && <ErrorNotice message={integrity.error} retry={() => void integrity.retry()} />}
      <div className="learning-breadcrumb">
        <Link to={attempt.mode === "exam" ? "/exams" : "/library"}>
          <ArrowLeft size={14} />
          {attempt.mode === "exam" ? "Phòng thi thử" : "Kho bài tập"}
        </Link>
        <span>/</span>
        <span>{skillNames[attempt.skill]}</span>
      </div>
      <PageHeader
        eyebrow={
          attempt.mode === "exam" ? "CHẾ ĐỘ THI THỬ" : "CHẾ ĐỘ LUYỆN TẬP"
        }
        title={attempt.title}
        description={content.description}
        action={
          <div className="learning-heading-icon">
            <Icon size={29} />
          </div>
        }
      />
      <div
        className={`attempt-toolbar ${remaining != null && remaining < 120 && !submitted ? "time-warning" : ""}`}
      >
        <div className="row wrap">
          <SkillBadge skill={attempt.skill} />
          <Badge>{content.cefr}</Badge>
          <span>
            {content.testType === "both"
              ? "Academic / General"
              : content.testType === "academic"
                ? "Academic"
                : "General Training"}
          </span>
          {content.questions.length > 0 && (
            <span>
              {answered}/{content.questions.length} câu đã trả lời
            </span>
          )}
        </div>
        <div className="attempt-status">
          {submitted ? (
            <Badge className="success">
              <Check size={12} />
              Đã nộp
            </Badge>
          ) : (
            <>
              <span className={`draft-status ${saveState}`} role="status">
                <Save size={13} />
                {saveState === "saved"
                  ? "Đã lưu"
                  : saveState === "saving"
                    ? "Đang lưu…"
                    : saveState === "error"
                      ? "Chưa lưu được"
                      : "Đang chờ lưu…"}
              </span>
              <strong className="attempt-timer">
                <Clock3 size={17} />
                {remaining == null
                  ? formatTime(activeSeconds)
                  : formatTime(remaining)}
              </strong>
            </>
          )}
        </div>
      </div>
      {attempt.mode === "practice" && content.source === "ai" &&
        content.format === "lesson" && content.band >= 7.5 &&
        !!content.objectives?.length && (
          <details className="practice-band-guide">
            <summary><Sparkles size={18} /> Hướng dẫn luyện band {content.band.toFixed(1)}</summary>
            <div className="stack">
              <p className="muted">Gợi ý cách học, tiêu chí tự rà soát và ví dụ diễn đạt. Dùng để luyện và tự sửa trước khi chuyển sang thi thử.</p>
              {content.objectives.map((objective, index) => <p key={index}>{objective}</p>)}
            </div>
          </details>
        )}
      {attempt.mode === "exam" && !submitted && (
        <div className="notice exam-notice">
          <Clock3 size={18} />
          <span>
            Đếm ngược theo hạn nộp trên máy chủ; {integrityEnabled ? "tải lại trang sẽ hủy lượt thi." : "tải lại trang không bắt đầu lại."} Không có gợi ý hoặc đáp án trước khi nộp.
            {attempt.skill === "listening" &&
              " Bản nghe chỉ phát một lần, kể cả khi tải lại."}
          </span>
        </div>
      )}
      {error && <ErrorNotice message={error} />}
      {saveError && (
        <ErrorNotice
          message={`Bản nháp chưa lưu: ${saveError}`}
          retry={() => void saveDraft().catch(() => undefined)}
        />
      )}
      {progress && <Loading text={progress} />}
      <div className="section-tabs" role="group" aria-label="Phần của bài tập">
        {content.sections.map((item, index) => (
          <button
            key={item.id}
            className={section === index ? "active" : ""}
            onClick={() => setSection(index)}
          >
            {item.task ? `Task ${item.task}` : `Phần ${index + 1}`}
            <span>{item.title}</span>
          </button>
        ))}
      </div>
      {attempt.skill === "listening" && !submitted && (
        <Card className="listening-player">
          <div className="listening-symbol">
            <Headphones size={27} />
            <div className={`audio-wave ${playing && !paused ? "active" : ""}`}>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((value) => (
                <i key={value} style={{ animationDelay: `${value * 0.12}s` }} />
              ))}
            </div>
          </div>
          <div>
            <h3>Nghe và ghi lại điều bạn hiểu</h3>
            <p>
              {health?.services.elevenlabs
                ? "Giọng đọc nhiều nhân vật từ ElevenLabs"
                : "Giọng máy của trình duyệt · âm thanh tự luyện"}
            </p>
            <small>
              {listenNotice ||
                (attempt.mode === "exam"
                  ? "Một lượt phát cho toàn bộ các phần. Lượt phát được lưu trên máy chủ."
                  : "Bạn có thể nghe lại trong chế độ luyện tập.")}
            </small>
          </div>
          <div className="row wrap">
            {attempt.mode === "practice" && (
              <Button
                className="secondary small"
                onClick={() => setShowTranscript((value) => !value)}
              >
                <BookOpen size={14} />
                {showTranscript ? "Ẩn transcript" : "Hiện transcript"}
              </Button>
            )}
            {playing ? (
              <>
                <Button className="secondary small" onClick={pauseListening}>
                  {paused ? <Play size={15} /> : <Pause size={15} />}
                  {paused ? "Tiếp tục nghe" : "Tạm dừng"}
                </Button>
                <Button className="secondary small" onClick={endListening}>
                  <Square size={14} />
                  Dừng
                </Button>
              </>
            ) : (
              <Button
                disabled={listenBusy || locked}
                onClick={() => void listen()}
              >
                <Play size={16} />
                {listenBusy ? "Đang tải…" : "Phát bản nghe"}
              </Button>
            )}
          </div>
        </Card>
      )}
      {(attempt.skill === "reading" ||
        attempt.skill === "listening" ||
        attempt.skill === "grammar") && (
        <div
          className={`practice-split ${attempt.skill === "listening" && !submitted && !showTranscript ? "listening-exam-split" : ""}`}
        >
          <Card className="passage-card">
            <div className="section-heading compact">
              <h2>{activeSection?.title}</h2>
              <Badge>
                {attempt.skill === "listening" ? "Transcript" : "Bài đọc"}
              </Badge>
            </div>
            {attempt.skill === "listening" &&
            !submitted &&
            !(attempt.mode === "practice" && showTranscript) ? (
              <div className="transcript-lock">
                <Headphones size={34} />
                <h3>Tập trung vào điều bạn nghe</h3>
                <p>
                  {attempt.mode === "exam"
                    ? "Transcript xuất hiện sau khi nộp bài. Phát bản nghe ở phía trên rồi trả lời câu hỏi."
                    : "Bấm Hiện transcript nếu bạn muốn đối chiếu khi luyện tập."}
                </p>
              </div>
            ) : (
              <>
                <p className="passage-instructions">
                  {activeSection?.instructions}
                </p>
                <div className="reading-passage">
                  {activeSection?.dialogue?.length
                    ? activeSection.dialogue.map((line, index) => (
                        <p key={index}>
                          <strong>{line.speaker}:</strong> {line.text}
                        </p>
                      ))
                    : activeSection?.text
                        .split("\n")
                        .filter(Boolean)
                        .map((paragraph, index) => (
                          <p key={index}>{paragraph}</p>
                        ))}
                </div>
              </>
            )}
          </Card>
          <Card className="questions-card">
            <div className="section-heading compact">
              <h2>Câu hỏi</h2>
              <span className="muted tiny">
                {questions.length} câu trong phần này
              </span>
            </div>
            {activeSection && <SectionVisuals section={activeSection} />}
            <ObjectiveQuestions
              questions={questions}
              blocks={activeSection?.questionBlocks || []}
              responses={responses}
              disabled={locked}
              onChange={updateResponse}
              feedback={submitted ? attempt.feedback?.answers || [] : []}
            />
          </Card>
        </div>
      )}
      {attempt.skill === "writing" && activeSection && (
        <div className="writing-workspace">
          <Card className="writing-prompt">
            <div className="section-heading compact">
              <div>
                <Badge>Task {activeSection.task || section + 1}</Badge>
                <h2>{activeSection.title}</h2>
              </div>
              <span className="muted tiny">
                {activeSection.task === 1
                  ? "Ít nhất 150 từ · khoảng 20 phút"
                  : "Ít nhất 250 từ · khoảng 40 phút"}
              </span>
            </div>
            <div className="reading-passage">
              {activeSection.text.split("\n").map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>
            <SectionVisuals section={activeSection} />
            <p className="prompt-instructions">{activeSection.instructions}</p>
            {content.sections.length > 1 && (
              <p className="muted tiny">
                Task 2 có trọng số gấp đôi Task 1 trong điểm Writing ước lượng.
              </p>
            )}
          </Card>
          <Card className="writing-editor">
            <div className="section-heading compact">
              <h2>Bài viết của bạn</h2>
              <span
                className={`word-counter ${wordCount(essays[activeSection.id] || "") >= (activeSection.task === 1 ? 150 : 250) ? "complete" : ""}`}
              >
                {wordCount(essays[activeSection.id] || "")} /{" "}
                {activeSection.task === 1 ? 150 : 250} từ
              </span>
            </div>
            <label className="field">
              <span className="sr-only">
                Bài viết Task {activeSection.task || section + 1}
              </span>
              <textarea
                aria-label={`Bài viết Task ${activeSection.task || section + 1}`}
                spellCheck={attempt.mode !== "exam"}
                value={essays[activeSection.id] || ""}
                onChange={(event) => {
                  setEssays((previous) => ({
                    ...previous,
                    [activeSection.id]: event.target.value,
                  }));
                  changed();
                }}
                disabled={locked}
                placeholder="Start writing your answer here…"
                rows={17}
                maxLength={30000}
              />
            </label>
            <div className="editor-footer">
              <span>
                <Save size={13} />
                Bản nháp tự lưu sau khi bạn dừng gõ.
              </span>
              <span>
                {attempt.mode === "exam"
                  ? "Không có trợ giúp trong lúc thi thử"
                  : "Hãy viết bằng ý tưởng và lời văn của bạn"}
              </span>
            </div>
            {!health?.services.openai && (
              <div className="notice">
                <Sparkles size={17} />
                <span>
                  AI chưa kết nối. Sau khi nộp, bạn nhận checklist, số từ và gợi
                  ý tự rà soát; hệ thống không gán band giả.
                </span>
              </div>
            )}
          </Card>
        </div>
      )}
      {attempt.skill === "speaking" && (
        <div className="speaking-workspace">
          <Card className="speaking-prompt">
            <Badge>Part {section + 1}</Badge>
            <h2>{activeSection?.title}</h2>
            <div className="reading-passage">
              {activeSection?.text.split("\n").map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>
            {activeSection?.cuePoints?.length && (
              <ul className="cue-points">
                {activeSection.cuePoints.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            )}
            <p className="prompt-instructions">{activeSection?.instructions}</p>
            <div className="notice">
              <Mic size={17} />
              <span>
                Part 1: trả lời tự nhiên · Part 2: chuẩn bị 1 phút, nói 2 phút ·
                Part 3: phát triển lập luận.
              </span>
            </div>
          </Card>
          <Card className="recording-card">
            <div className={`recording-orb ${recording ? "recording" : ""}`}>
              <Mic size={36} />
            </div>
            <h2>
              {recording
                ? "Đang ghi âm giọng của bạn"
                : submitted
                  ? "Bài nói đã lưu"
                  : "Sẵn sàng cất tiếng nói?"}
            </h2>
            <p className="muted">
              {recording
                ? `Thời gian ${formatTime(recordSeconds)}`
                : `WAV mono 16 kHz · ${attempt.mode === "exam" ? "tối đa 12 phút" : "tối đa 3 phút"} · giới hạn 25 MB`}
            </p>
            {!submitted && (
              <div className="row recording-actions">
                {recording ? (
                  <Button
                    className="danger"
                    onClick={() => void stopRecordingNow()}
                  >
                    <Square size={16} />
                    Dừng ghi âm
                  </Button>
                ) : (
                  <Button
                    disabled={recordBusy || locked}
                    onClick={() => void beginRecording()}
                  >
                    <Mic size={16} />
                    {recordBusy
                      ? "Đang xin quyền microphone…"
                      : audioBlob
                        ? "Ghi âm lại"
                        : "Bắt đầu ghi âm"}
                  </Button>
                )}
              </div>
            )}
            {(audioUrl || attempt.audioAvailable) && (
              <div className="recording-playback">
                <label>Nghe lại bản ghi của bạn</label>
                <audio
                  controls
                  src={audioUrl || `/api/attempts/${attempt.id}/audio`}
                  preload="metadata"
                />
              </div>
            )}
            <label className="field transcript-field">
              Transcript của bạn
              <textarea
                aria-label="Transcript bài nói"
                value={transcript}
                rows={7}
                maxLength={40000}
                disabled={locked}
                placeholder={
                  health?.services.openai
                    ? "Whisper sẽ phiên âm bản ghi khi bạn nộp. Bạn cũng có thể nhập transcript để luyện bằng văn bản."
                    : "Nhập nội dung bạn đã nói. Khi chưa có Whisper, transcript cho phép nhận checklist tự luyện."
                }
                onChange={(event) => {
                  setTranscript(event.target.value);
                  changed();
                }}
              />
              <small>
                {wordCount(transcript)} từ · Text không đủ để đo tốc độ nói,
                ngắt nghỉ hoặc phát âm.
              </small>
            </label>
            {!health?.services.openai && (
              <div className="notice warning">
                <AlertTriangle size={18} />
                <span>
                  Chưa bật phiên âm tự động. Bản ghi gửi lên vẫn được lưu riêng;
                  nhập nội dung bài nói để nhận phản hồi tự luyện. Chỉ số phát
                  âm chỉ xuất hiện khi có phân tích âm học thật.
                </span>
              </div>
            )}
          </Card>
        </div>
      )}
      {!submitted && (
        <div className="submit-bar">
          <div>
            <strong>
              {attempt.mode === "exam"
                ? "Hoàn thành bài thi thử"
                : "Bạn đã sẵn sàng xem phản hồi?"}
            </strong>
            <p>
              {attempt.skill === "writing" && content.sections.length > 1
                ? "Nộp cả hai tasks cùng lúc để nhận phản hồi đầy đủ."
                : "Bản nháp được lưu trước khi chấm và chuyển vào lịch sử của bạn."}
            </p>
          </div>
          <Button
            disabled={locked || recording || recordBusy}
            onClick={() => setConfirm(true)}
          >
            <Send size={17} />
            {busy ? "Đang chấm…" : "Nộp bài & xem phản hồi"}
          </Button>
        </div>
      )}
      {submitted && attempt.feedback && <FeedbackView feedback={attempt.feedback} />}
      {!!vocabulary.length && (attempt.mode !== "exam" || submitted) && (
        <Card className="lesson-vocabulary">
          <div className="section-heading compact">
            <h2>Từ vựng trong bài</h2>
            <Link to="/vocabulary" className="text-link">
              Mở sổ từ
              <ArrowRight size={14} />
            </Link>
          </div>
          <div className="lesson-word-grid">
            {vocabulary.map((word) => (
              <div key={word.id}>
                <strong>{word.word}</strong>
                <span>{word.ipa}</span>
                <p>{word.meaning}</p>
                <Button
                  className="secondary small"
                  disabled={
                    savedWord.startsWith("saving:") ||
                    savedVocabularyIds.has(word.id)
                  }
                  onClick={() => void saveVocabulary(word)}
                >
                  {savedVocabularyIds.has(word.id) ? (
                    <Check size={13} />
                  ) : (
                    <Save size={13} />
                  )}
                  {savedVocabularyIds.has(word.id) ? "Đã lưu" : "Lưu vào sổ từ"}
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}
      {submitted && (
        <div className="row wrap">
          <Link to="/library" className="button">
            <BookOpen size={16} />
            Tìm bài luyện tiếp theo
          </Link>
          <Link to="/history" className="button secondary">
            Xem lịch sử học
            <ChevronRight size={16} />
          </Link>
        </div>
      )}
      {confirm && (
        <Modal title="Nộp bài luyện của bạn?" onClose={() => setConfirm(false)}>
          <p className="muted">
            {content.questions.length
              ? `${answered}/${content.questions.length} câu đã trả lời. Những câu còn trống được tính là chưa trả lời.`
              : attempt.skill === "writing"
                ? `Bài có ${content.sections.length} task. Hãy kiểm tra bạn đã viết đủ các phần.`
                : "Bản ghi và transcript sẽ được gửi để xử lý. AI chưa cấu hình chỉ cung cấp checklist tự luyện."}
          </p>
          <p className="muted">
            Sau khi nộp, câu trả lời của lượt này được giữ nguyên để bạn đối
            chiếu.
          </p>
          <div className="row wrap">
            <Button onClick={() => void submit()}>
              <Send size={16} />
              Nộp bài
            </Button>
            <Button className="secondary" onClick={() => setConfirm(false)}>
              Tiếp tục làm bài
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function parseSelections(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every(item => typeof item === "string")
      ? [...new Set(parsed)] : [];
  } catch { return []; }
}

function ObjectiveQuestions({ questions, blocks, responses, disabled, onChange, feedback }: {
  questions: Question[]; blocks: QuestionBlock[]; responses: Record<string, string>;
  disabled: boolean; onChange: (ids: string[], value: string) => void;
  feedback: Feedback["answers"];
}) {
  const blockNumbers = new Set(blocks.flatMap(block => block.questionNumbers));
  const groups = new Set<string>();
  const items: { number: number; element: React.ReactNode }[] = blocks.map(block => ({
    number: Math.min(...block.questionNumbers),
    element: <CompletionBlock key={block.id} block={block} questions={questions} responses={responses} disabled={disabled} onChange={onChange} feedback={feedback} />,
  }));
  for (const question of questions) {
    if (blockNumbers.has(question.number)) continue;
    if (question.type === "choice-multiple") {
      const groupId = question.selectionGroup?.id || question.id;
      if (groups.has(groupId)) continue;
      groups.add(groupId);
      const grouped = question.selectionGroup
        ? questions.filter(item => item.type === "choice-multiple" && item.selectionGroup?.id === groupId)
        : [question];
      items.push({ number: question.number, element: <MultipleChoiceGroup key={groupId} questions={grouped} value={responses[question.id] || ""} disabled={disabled} onChange={value => onChange(grouped.map(item => item.id), value)} feedback={feedback.filter(answer => grouped.some(item => item.id === answer.questionId))} /> });
    } else items.push({ number: question.number, element: <QuestionInput key={question.id} question={question} value={responses[question.id] || ""} disabled={disabled} onChange={value => onChange([question.id], value)} feedback={feedback.find(answer => answer.questionId === question.id)} /> });
  }
  return <div className="question-list">{items.sort((a, b) => a.number - b.number).map(item => item.element)}</div>;
}
function MultipleChoiceGroup({ questions, value, onChange, disabled, feedback }: {
  questions: Question[]; value: string; onChange: (value: string) => void;
  disabled: boolean; feedback: Feedback["answers"];
}) {
  const question = questions[0], count = question.selectionGroup?.count || 1;
  const selected = parseSelections(value), complete = selected.length === count;
  return <fieldset className={`practice-question multiple-choice-group ${feedback.length ? (feedback.every(answer => answer.correct) ? "correct" : "incorrect") : ""}`}>
    <legend><span className="question-number">{questions.map(item => item.number).join("–")}</span>{question.prompt}</legend>
    <p className="question-limit">{question.groupInstructions || `Choose ${count} answers.`} <span className={complete ? "selection-complete" : ""}>({selected.length}/{count})</span></p>
    <div className="answer-options">{(question.options || []).map((option, index) => {
      const checked = selected.includes(option);
      return <label key={option} className={`answer-option ${checked ? "selected" : ""} ${!checked && complete ? "option-at-limit" : ""}`}>
        <input type="checkbox" checked={checked} disabled={disabled || (!checked && complete)} onChange={() => {
          const next = checked ? selected.filter(item => item !== option) : [...selected, option];
          onChange(next.length ? JSON.stringify(next) : "");
        }} />
        <span className="option-letter">{String.fromCharCode(65 + index)}</span><span>{option}</span>
      </label>;
    })}</div>
    {feedback.length > 0 && <div className="question-feedback"><strong>{feedback.filter(answer => answer.correct).length}/{questions.length} điểm</strong>{feedback.map(answer => <div key={answer.questionId}><p><b>Đáp án: {answer.answer}</b> · {answer.correct ? "Đã chọn đúng" : "Chưa chọn đúng"}</p><p>{answer.explanation}</p>{answer.evidence && <blockquote>{answer.evidence}</blockquote>}</div>)}</div>}
  </fieldset>;
}
function CompletionBlock({ block, questions, responses, disabled, onChange, feedback }: {
  block: QuestionBlock; questions: Question[]; responses: Record<string, string>;
  disabled: boolean; onChange: (ids: string[], value: string) => void;
  feedback: Feedback["answers"];
}) {
  const blockQuestions = questions.filter(question => block.questionNumbers.includes(question.number));
  function filledText(text: string) {
    return text.split(/(\{\{\d+\}\})/gu).map((part, index) => {
      const match = /^\{\{(\d+)\}\}$/u.exec(part);
      if (!match) return <span key={index}>{part}</span>;
      const question = blockQuestions.find(item => item.number === Number(match[1]));
      if (!question) return <span key={index}>{match[1]} ……</span>;
      return <label key={index} className="completion-blank"><span className="blank-number">{question.number}</span><input aria-label={`Câu ${question.number}`} value={responses[question.id] || ""} disabled={disabled} onChange={event => onChange([question.id], event.target.value)} autoComplete="off" maxLength={500} placeholder="…………" /></label>;
    });
  }
  return <section className={`completion-block completion-${block.type}`} aria-label={block.title}>
    <div className="completion-block-heading"><span className="question-number">{block.questionNumbers.length === 1 ? block.questionNumbers[0] : `${Math.min(...block.questionNumbers)}–${Math.max(...block.questionNumbers)}`}</span><h3>{block.title}</h3></div>
    <p className="question-limit">{block.instructions}</p>
    {block.text && <div className="completion-prose">{filledText(block.text)}</div>}
    {block.rows?.length && (block.type === "table" ? <div className="completion-table-scroll"><table><tbody>{block.rows.map((row, index) => <tr key={index}>{row.label && <th scope="row">{filledText(row.label)}</th>}{row.cells.map((cell, cellIndex) => <td key={cellIndex}>{filledText(cell)}</td>)}</tr>)}</tbody></table></div> : <div className={`completion-rows ${block.type === "flow-chart" ? "completion-flow" : ""}`}>{block.rows.map((row, index) => <div key={index} className="completion-row">{row.label && <strong>{filledText(row.label)}</strong>}<div>{row.cells.map((cell, cellIndex) => <span key={cellIndex}>{filledText(cell)}{cellIndex < row.cells.length - 1 ? " " : ""}</span>)}</div></div>)}</div>)}
    {blockQuestions.flatMap(question => {
      const answer = feedback.find(item => item.questionId === question.id);
      return answer ? [<div key={question.id} className={`question-feedback ${answer.correct ? "completion-correct" : "completion-incorrect"}`}><strong>Câu {question.number}: {answer.correct ? "Chính xác" : `Đáp án: ${answer.answer}`}</strong><p>{answer.explanation}</p>{answer.evidence && <blockquote>{answer.evidence}</blockquote>}</div>] : [];
    })}
  </section>;
}

function QuestionInput({
  question,
  value,
  onChange,
  disabled,
  feedback,
}: {
  question: Question;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  feedback?: Feedback["answers"][number];
}) {
  const options =
    question.type === "true-false"
      ? ["TRUE", "FALSE", "NOT GIVEN"]
      : question.type === "yes-no"
        ? ["YES", "NO", "NOT GIVEN"]
        : question.options;
  return (
    <fieldset
      className={`practice-question ${feedback ? (feedback.correct ? "correct" : "incorrect") : ""}`}
    >
      <legend>
        <span className="question-number">{question.number}</span>
        {question.prompt}
      </legend>
      {question.wordLimit && (
        <p className="question-limit">
          Không quá {question.wordLimit} từ
          {question.allowNumbers ? " và/hoặc một số" : ""}.
        </p>
      )}
      {options?.length ? (
        <div className="answer-options">
          {options.map((option, index) => (
            <label
              key={option}
              className={`answer-option ${value === option ? "selected" : ""}`}
            >
              <input
                type="radio"
                name={question.id}
                value={option}
                checked={value === option}
                disabled={disabled}
                onChange={() => onChange(option)}
              />
              {question.type === "choice" && (
                <span className="option-letter">
                  {String.fromCharCode(65 + index)}
                </span>
              )}
              <span>{option}</span>
            </label>
          ))}
        </div>
      ) : (
        <label className="field">
          <span className="sr-only">Câu {question.number}</span>
          <input
            aria-label={`Câu ${question.number}`}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            maxLength={500}
            disabled={disabled}
            autoComplete="off"
            placeholder="Nhập câu trả lời…"
          />
        </label>
      )}
      {feedback && (
        <div className="question-feedback">
          <strong>
            {feedback.correct ? "Chính xác" : `Đáp án: ${feedback.answer}`}
          </strong>
          <p>{feedback.explanation}</p>
          {feedback.evidence && <blockquote>{feedback.evidence}</blockquote>}
        </div>
      )}
    </fieldset>
  );
}

function readableAnswer(value: string): string {
  // Paired selections are saved as JSON arrays for grading, but learners see
  // the selected option texts rather than an internal serialization format.
  if (!value.trim()) return "Chưa trả lời";
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return parsed.length ? parsed.join(" · ") : "Chưa trả lời";
    }
  } catch { /* Ordinary free-text responses are displayed as written. */ }
  return value;
}

function AnswerContext({ context, id }: { context: string; id: string }) {
  const [expanded, setExpanded] = useState(false);
  const regionId = `answer-context-${id}`;
  return (
    <div className="answer-context">
      <Button className="secondary small" aria-expanded={expanded} aria-controls={regionId} onClick={() => setExpanded((previous) => !previous)}>
        {expanded ? "Ẩn nội dung gốc / transcript" : "Xem nội dung gốc / transcript"}
      </Button>
      {expanded && <div id={regionId}>{context}</div>}
    </div>
  );
}

function ObjectiveAnswerReview({ answers }: { answers: Feedback["answers"] }) {
  const [filter, setFilter] = useState<"all" | "wrong" | "unanswered">("all");
  const unanswered = (answer: Feedback["answers"][number]) =>
    readableAnswer(answer.response) === "Chưa trả lời";
  const wrong = answers.filter((answer) => !answer.correct && !unanswered(answer));
  const skipped = answers.filter(unanswered);
  const visible = answers.filter((answer) =>
    filter === "all" || (filter === "wrong" ? !answer.correct && !unanswered(answer) : unanswered(answer)),
  );
  return (
    <Card className="answer-review-card">
      <h3>Đáp án và bằng chứng</h3>
      <p className="muted answer-review-intro">
        Đáp án của toàn bộ {answers.length} câu, gồm câu đúng, câu sai và câu chưa trả lời. Mở từng câu để xem câu hỏi và lý do.
      </p>
      <div className="answer-review-filters row wrap" role="group" aria-label="Lọc đáp án">
        {([
          ["all", "Tất cả", answers.length],
          ["wrong", "Sai", wrong.length],
          ["unanswered", "Chưa trả lời", skipped.length],
        ] as const).map(([value, label, count]) => (
          <Button key={value} className={`small ${filter === value ? "" : "secondary"}`} aria-pressed={filter === value} onClick={() => setFilter(value)}>
            {label} ({count})
          </Button>
        ))}
      </div>
      <div className="answer-review">
        {visible.map((answer, index) => {
          const number = answer.questionNumber ?? answers.indexOf(answer) + 1;
          const status = unanswered(answer) ? "Chưa trả lời" : answer.correct ? "Đúng" : "Sai";
          const correctOptions = new Set([answer.answer, ...(answer.acceptedAnswers || [])]);
          const alternatives = (answer.acceptedAnswers || []).filter((value) => value !== answer.answer);
          return (
            <details key={answer.questionId} open={index === 0} data-question-number={number}>
              <summary>
                <span className={`answer-result-icon ${answer.correct ? "correct" : "incorrect"}`} aria-hidden="true">
                  {answer.correct ? <Check size={14} /> : <AlertTriangle size={14} />}
                </span>
                <span>Câu {number}</span>
                <span className="answer-key-summary"><b>Đáp án:</b> {readableAnswer(answer.answer)}</span>
                <Badge className={answer.correct ? "success" : "warning"}>{status}</Badge>
              </summary>
              <div className="answer-review-body">
                {answer.sectionTitle && <p className="eyebrow">{answer.sectionTitle}</p>}
                {answer.prompt && <h4>{answer.prompt}</h4>}
                {answer.options?.length ? (
                  <ul className="answer-review-options" aria-label="Các phương án trả lời">
                    {answer.options.map((option, optionIndex) => (
                      <li key={`${optionIndex}-${option}`} className={correctOptions.has(option) ? "answer-option-correct" : ""}>
                        <span aria-hidden="true">{String.fromCharCode(65 + optionIndex)}.</span> {option}
                        {correctOptions.has(option) && <span className="sr-only"> — Đáp án đúng</span>}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="answer-comparison">
                  <p><strong>Bạn trả lời:</strong> <span>{readableAnswer(answer.response)}</span></p>
                  <p className="answer-correct-value"><strong>Đáp án đúng:</strong> <span>{readableAnswer(answer.answer)}</span></p>
                </div>
                {!!alternatives.length && <p><strong>Cũng chấp nhận:</strong> {alternatives.map(readableAnswer).join(" · ")}</p>}
                <p><strong>Giải thích:</strong> {answer.explanation}</p>
                {answer.evidence && <blockquote><span className="eyebrow">BẰNG CHỨNG TRONG BÀI</span><br />{answer.evidence}</blockquote>}
                {answer.context && <AnswerContext context={answer.context} id={answer.questionId} />}
                <p className="muted tiny">{answer.questionType?.replaceAll("-", " ") || answer.subskill.replaceAll("-", " ")}</p>
              </div>
            </details>
          );
        })}
        {!visible.length && <p className="muted" role="status">Không có câu nào trong nhóm này.</p>}
      </div>
    </Card>
  );
}

function ReferenceAnswerReview({ feedback }: { feedback: Feedback }) {
  if (!feedback.referenceAnswers?.length) return null;
  return (
    <Card className="reference-answer-card">
      <h3>Bài mẫu tham khảo</h3>
      <p className="reference-answer-notice">
        Writing và Speaking có nhiều cách trả lời phù hợp. Đây là ví dụ để đối chiếu cách triển khai ý, không phải đáp án duy nhất hay cam kết đạt một band cụ thể.
      </p>
      <div className="reference-answers">
        {feedback.referenceAnswers.map((reference) => (
          <article key={reference.sectionId} className="reference-answer" aria-label={reference.title}>
            <h4>{reference.title}</h4>
            {reference.sampleAnswer && <div className="reference-sample" lang="en">{reference.sampleAnswer}</div>}
            {reference.responses?.map((response, index) => (
              <div key={`${index}-${response.prompt}`} className="reference-response">
                <h5>{response.prompt}</h5>
                <p className="reference-sample" lang="en">{response.sampleAnswer}</p>
                {response.explanation && <p><strong>Gợi ý triển khai:</strong> {response.explanation}</p>}
              </div>
            ))}
            {reference.explanation && <p><strong>Cách tiếp cận:</strong> {reference.explanation}</p>}
            {!!reference.keyPoints.length && (
              <><h5>Điểm cần chú ý</h5><ul>{reference.keyPoints.map((point, index) => <li key={index}>{point}</li>)}</ul></>
            )}
          </article>
        ))}
      </div>
    </Card>
  );
}

function FeedbackView({ feedback }: { feedback: Feedback }) {
  return (
    <section className="feedback-section stack">
      <div className="section-heading">
        <div>
          <p className="eyebrow">NHÌN LẠI ĐỂ TIẾN BỘ</p>
          <h2>Phản hồi bài luyện</h2>
        </div>
        <Badge className={feedback.source === "ai" ? "writing" : "neutral"}>
          {feedback.source === "ai"
            ? "Phản hồi AI"
            : "Đáp án / checklist tự luyện"}
        </Badge>
      </div>
      <Card className="feedback-summary">
        <div className="feedback-score">
          {feedback.estimatedBand != null ? (
            <>
              <strong>{feedback.estimatedBand.toFixed(1)}</strong>
              <span>band luyện tập ước lượng</span>
            </>
          ) : feedback.rawScore != null ? (
            <>
              <strong>
                {feedback.rawScore}
                <small>/{feedback.total}</small>
              </strong>
              <span>câu trả lời đúng</span>
            </>
          ) : (
            <>
              <CheckCircle2 size={34} />
              <span>Đã lưu bài · chưa có band</span>
            </>
          )}
        </div>
        <div>
          <h3>
            {feedback.estimatedBand != null
              ? "Một điểm tham khảo cho bước tiếp theo"
              : feedback.rawScore != null
                ? "Hiểu lý do, không chỉ nhớ đáp án"
                : "Rà soát bài của bạn từng bước"}
          </h3>
          <p>{feedback.summary}</p>
          <small>
            Ước lượng phục vụ tự luyện. Nội dung chưa hiệu chuẩn; kết quả không
            thay thế điểm IELTS chính thức.
          </small>
        </div>
      </Card>
      {!!feedback.criteria.length && (
        <div className="criteria-grid">
          {feedback.criteria.map((criterion) => (
            <Card key={criterion.name}>
              <div className="criterion-heading">
                <h3>{criterion.name}</h3>
                <strong>
                  {criterion.band == null ? "—" : criterion.band.toFixed(1)}
                </strong>
              </div>
              <p>{criterion.feedback}</p>
              {criterion.confidence != null && (
                <small>
                  Mức tin cậy AI khai báo:{" "}
                  {Math.round(criterion.confidence * 100)}% · chưa hiệu chuẩn
                </small>
              )}
              {criterion.evidence.map((quote, index) => (
                <blockquote key={index}>{quote}</blockquote>
              ))}
            </Card>
          ))}
        </div>
      )}
      {!!feedback.taskScores?.length && (
        <Card>
          <h3>Điểm ước lượng theo từng task</h3>
          <div className="row wrap">
            {feedback.taskScores.map((task) => (
              <Badge key={task.task}>
                Task {task.task}:{" "}
                {task.estimatedBand == null
                  ? "chưa có điểm"
                  : task.estimatedBand.toFixed(1)}
              </Badge>
            ))}
          </div>
          <p className="muted tiny">
            Writing tổng hợp với trọng số Task 1 : Task 2 = 1 : 2 khi cả hai
            task có điểm hợp lệ.
          </p>
        </Card>
      )}
      {!!feedback.corrections.length && (
        <Card>
          <h3>Chỉnh sửa có bằng chứng</h3>
          <div className="correction-list">
            {feedback.corrections.map((item, index) => (
              <div key={index}>
                <div className="grid-2">
                  <div>
                    <span className="eyebrow">TRÍCH NGUYÊN VĂN</span>
                    <p className="correction-original">{item.original}</p>
                  </div>
                  <div>
                    <span className="eyebrow">GỢI Ý SỬA</span>
                    <p className="correction-suggestion">{item.suggestion}</p>
                  </div>
                </div>
                <p>{item.explanation}</p>
              </div>
            ))}
          </div>
        </Card>
      )}
      {!!feedback.paragraphs.length && (
        <Card>
          <h3>Nhận xét từng đoạn</h3>
          <div className="paragraph-feedback">
            {feedback.paragraphs.map((paragraph) => (
              <div key={paragraph.index}>
                <Badge>Đoạn {paragraph.index + 1}</Badge>
                <p>{paragraph.feedback}</p>
              </div>
            ))}
          </div>
        </Card>
      )}
      {feedback.transcript && (
        <Card>
          <h3>Transcript được xử lý</h3>
          <p className="feedback-transcript">{feedback.transcript}</p>
          <div className="row wrap">
            {feedback.wordCount != null && (
              <Badge>{feedback.wordCount} từ</Badge>
            )}
            {feedback.fillerCount != null && (
              <Badge>{feedback.fillerCount} filler words</Badge>
            )}
            {feedback.fillerDensity != null && (
              <Badge>
                Mật độ filler: {(feedback.fillerDensity * 100).toFixed(1)}%
              </Badge>
            )}
          </div>
        </Card>
      )}
      {feedback.pronunciation && (
        <Card>
          <h3>Chỉ số âm học Azure</h3>
          <div className="acoustic-grid">
            {Object.entries(feedback.pronunciation)
              .filter(([, value]) => value != null)
              .map(([key, value]) => (
                <div key={key}>
                  <strong>
                    {value?.toFixed(1)}
                    <small>/100</small>
                  </strong>
                  <span>
                    {
                      (
                        {
                          accuracy: "Độ chính xác",
                          fluency: "Độ trôi chảy",
                          completeness: "Độ đầy đủ",
                          prosody: "Ngữ điệu",
                        } as Record<string, string>
                      )[key]
                    }
                  </span>
                </div>
              ))}
          </div>
          <p className="muted tiny">
            Đo từ bản ghi thực; các chỉ số 0–100 không phải bảng chuyển đổi band
            IELTS.
          </p>
        </Card>
      )}
      {!!feedback.answers.length && <ObjectiveAnswerReview answers={feedback.answers} />}
      <ReferenceAnswerReview feedback={feedback} />
    </section>
  );
}
