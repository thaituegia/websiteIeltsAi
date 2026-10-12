import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Headphones,
  PenLine,
  Mic,
  Clock3,
  Flame,
  Layers,
  Check,
  Sparkles,
  ChevronRight,
  Volume2,
  Plus,
  Search,
  Download,
  Trash2,
  Target,
  CalendarDays,
  RotateCcw,
  CircleCheck,
  AlertTriangle,
} from "lucide-react";
import type {
  Attempt,
  AttemptSummary,
  Dashboard,
  ErrorNotebook,
  Profile,
  PlacementSummary,
  StudyPlan,
  StudyTask,
  VocabularyCard,
  VocabularyEntry,
} from "../shared/types";
import { api, json } from "./api";
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
  dateLabel,
  skillNames,
} from "./components";
import { DuoDashboardCard } from "./Duo";

const skillIcons = {
  reading: BookOpen,
  listening: Headphones,
  writing: PenLine,
  speaking: Mic,
};
const skillDescriptions = {
  reading: "Đọc hiểu & tìm bằng chứng",
  listening: "Nghe chính xác, hiểu ý chính",
  writing: "Ý tưởng rõ ràng, lập luận chặt",
  speaking: "Tự tin nói, diễn đạt tự nhiên",
};

/** Original chibi stickers; achievement state always comes from learning data. */
function CampaignRelic({ kind }: { kind: "book" | "scroll" | "forge" | "compass" }) {
  return (
    <svg className="campaign-relic" viewBox="0 0 132 116" aria-hidden="true" focusable="false">
      <ellipse cx="66" cy="58" rx="52" ry="49" fill={kind === "forge" ? "#def5e9" : "#eee6ff"} />
      <ellipse cx="66" cy="103" rx="36" ry="5" fill="#343247" opacity=".08" />
      <g stroke="#343247" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        {kind === "book" ? (
          <>
            <path d="M25 34q22-8 41 2 19-10 41-2v53q-22-7-41 2-19-9-41-2Z" fill="#e75d70" />
            <path d="M29 27q19-6 37 5 18-11 37-5v52q-20-5-37 5-17-10-37-5Z" fill="#fffdf9" />
            <path d="M66 32v52M37 38l14 2m-14 7 11 2m29-10 15-2m-15 12 12-2" fill="none" stroke="#c9bed8" />
            <path d="M85 25v24l6-5 6 3V24" fill="#83ceb3" />
            <circle cx="48" cy="62" r="2.8" fill="#343247" stroke="none" />
            <circle cx="84" cy="62" r="2.8" fill="#343247" stroke="none" />
            <path d="M59 66q7 8 14 0" fill="none" />
            <ellipse cx="40" cy="67" rx="5" ry="3" fill="#ffb5bd" stroke="none" />
            <ellipse cx="92" cy="67" rx="5" ry="3" fill="#ffb5bd" stroke="none" />
          </>
        ) : kind === "scroll" ? (
          <>
            <rect x="35" y="23" width="63" height="74" rx="10" fill="#fff0b6" />
            <path d="M47 19h33v12H47Z" fill="#bb9cdd" />
            <path d="M48 41h28m-28 8h21m-21 34h32" stroke="#c9a557" />
            <circle cx="54" cy="63" r="2.8" fill="#343247" stroke="none" />
            <circle cx="78" cy="63" r="2.8" fill="#343247" stroke="none" />
            <path d="M60 70q6 6 12 0" fill="none" />
            <circle cx="98" cy="88" r="15" fill="#e75d70" />
            <path d="m91 88 5 5 9-10" fill="none" stroke="#fffdf9" />
          </>
        ) : kind === "forge" ? (
          <>
            <path d="M66 62V43m0 10q-22 3-26-14 22-7 26 14m0 9q24-1 26-18-24-7-26 18" fill="#83ceb3" />
            <path d="M38 66h56l-7 29H45Z" fill="#f6a9b2" />
            <rect x="34" y="61" width="64" height="10" rx="5" fill="#e75d70" />
            <circle cx="55" cy="80" r="2.8" fill="#343247" stroke="none" />
            <circle cx="77" cy="80" r="2.8" fill="#343247" stroke="none" />
            <path d="M60 87q6 6 12 0" fill="none" />
            <path d="m66 17 4 7 8 1-6 6 1 8-7-4-7 4 1-8-6-6 8-1Z" fill="#ffe17d" />
          </>
        ) : (
          <>
            <circle cx="66" cy="62" r="36" fill="#fff0b6" />
            <circle cx="66" cy="62" r="28" fill="#fffdf9" />
            <path d="M60 25v-9h12v9M66 37v8m-25 17h8m34 0h8" fill="none" />
            <path d="m66 42 8 20-8 8-8-8Z" fill="#e75d70" />
            <path d="m66 82-8-20 8 8 8-8Z" fill="#83ceb3" />
            <circle cx="48" cy="60" r="2.8" fill="#343247" stroke="none" />
            <circle cx="84" cy="60" r="2.8" fill="#343247" stroke="none" />
            <path d="M57 76q9 9 18 0" fill="none" />
          </>
        )}
      </g>
      <path d="m19 16 3 6 6 1-5 4 1 6-5-3-5 3 1-6-5-4 6-1Z" fill="#ffe17d" />
      <circle cx="115" cy="73" r="4" fill="#83ceb3" />
      <path d="M107 22v10m-5-5h10" stroke="#e75d70" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
function CampaignBanner({
  kind,
  eyebrow,
  title,
  text,
  children,
}: {
  kind: "book" | "scroll" | "forge" | "compass";
  eyebrow: string;
  title: string;
  text: string;
  children?: React.ReactNode;
}) {
  return (
    <section className={`campaign-banner campaign-banner-${kind}`}>
      <div className="campaign-banner-relic"><CampaignRelic kind={kind} /></div>
      <div className="campaign-banner-copy">
        <span className="campaign-banner-eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        <p>{text}</p>
        {children && <div className="campaign-banner-details">{children}</div>}
      </div>
    </section>
  );
}

function errorMessage(cause: unknown) {
  return cause instanceof Error
    ? cause.message
    : "Có lỗi xảy ra. Vui lòng thử lại.";
}
async function createAttempt(
  contentId: string,
  mode: "practice" | "exam" = "practice",
) {
  return (
    await api<{ attempt: Attempt }>("/attempts", {
      method: "POST",
      body: json({ contentId, mode }),
    })
  ).attempt;
}
export function DashboardPage() {
  const { user } = useSession();
  const { data, loading, error, reload } = useApi<Dashboard>("/dashboard");
  const navigate = useNavigate();
  const [busy, setBusy] = useState(""),
    [actionError, setActionError] = useState("");
  async function start(contentId: string) {
    setBusy(contentId);
    setActionError("");
    try {
      const attempt = await createAttempt(contentId);
      navigate(`/learn/${attempt.id}`);
    } catch (cause) {
      setActionError(errorMessage(cause));
    } finally {
      setBusy("");
    }
  }
  if (loading) return <Loading />;
  if (error || !data)
    return (
      <ErrorNotice
        message={error || "Không có dữ liệu."}
        retry={() => void reload()}
      />
    );
  const name = user.name.split(" ").at(-1);
  const greeting = new Intl.DateTimeFormat("vi-VN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Bangkok",
  }).format(new Date());
  return (
    <div className="stack page-stack campaign-dashboard">
      <PageHeader
        eyebrow={greeting.toUpperCase()}
        title={`Chào ${name}, học một chút nhé!`}
        description="Một bài học nhỏ hôm nay, một bước gần hơn tới mục tiêu của chúng mình."
        action={
          <Link to="/plan" className="button secondary small">
            Lộ trình của hai người
            <ArrowUpRight size={16} />
          </Link>
        }
      />
      <section className="dashboard-hero campaign-hero">
        <div className="hero-copy">
          <div className="pill">
            <Sparkles size={15} />
            HÀNH TRÌNH ĐẾN BAND {user.targetBand.toFixed(1)}
          </div>
          <h2>
            Học vui mỗi ngày.
            <br />
            <em>Tiến xa cùng nhau.</em>
          </h2>
          <p>
            {user.currentBand == null
              ? "Bắt đầu với bài kiểm tra đầu vào để hiểu điểm mạnh và điều bạn cần luyện tiếp theo."
              : "Cùng theo một band chung, luyện tập riêng theo nhịp của bạn và cùng thi nâng band."}
          </p>
          <Link
            className="button light"
            to={user.currentBand == null ? "/placement" : "/plan"}
          >
            {user.currentBand == null
              ? "Khám phá trình độ của tôi"
              : "Tiếp tục buổi học hôm nay"}
            <ArrowRight size={18} />
          </Link>
          <span className="hero-note">
            <Clock3 size={14} />
            {user.currentBand == null
              ? "15 câu cho bài kiểm tra nhanh"
              : `${user.dailyMinutes} phút mỗi ngày · Học theo nhịp của bạn`}
          </span>
        </div>
        <div className="hero-art">
          <img
            className="campaign-world"
            src="/assets/chibi-world.webp"
            alt=""
            decoding="async"
          />
          <div className="hero-art-tag">
            ĐÔI BẠN CÙNG TIẾN
            <strong>Đi một bước. Vui một chút.</strong>
          </div>
          <div className="hero-art-note">
            <span className="status-dot" />
            Luyện riêng · Vượt mốc cùng nhau
          </div>
        </div>
      </section>
      <DuoDashboardCard />
      <div className="stats-grid">
        <Stat
          icon={<Target size={20} />}
          value={bandLabel(data.overallBand)}
          label="Band luyện tập ước lượng"
          detail={
            data.overallBand == null
              ? "Hoàn thành bài để có dữ liệu"
              : "Từ kết quả gần đây của bạn"
          }
        />
        <Stat
          icon={<Clock3 size={20} />}
          value={`${data.weekMinutes}`}
          label="Phút học tuần này"
          detail={`Mục tiêu ${user.weeklyMinutes} phút / tuần`}
        />
        <Stat
          icon={<Flame size={20} />}
          value={`${data.streakDays}`}
          label="Ngày học liên tiếp"
          detail={`${data.completedCount} bài đã hoàn thành`}
        />
        <Stat
          icon={<Layers size={20} />}
          value={`${data.dueCards}`}
          label="Từ vựng đến hạn ôn"
          detail={`${data.totalCards} thẻ trong sổ từ vựng`}
          to="/vocabulary"
        />
      </div>
      <div className="section-heading">
        <div>
          <p className="eyebrow">BỐN VÙNG ĐẤT · BỐN KỸ NĂNG</p>
          <h2>Hiểu thế mạnh của bạn</h2>
        </div>
        <Link to="/library" className="text-link">
          Khám phá bài tập
          <ArrowRight size={16} />
        </Link>
      </div>
      <div className="skills-grid">
        {data.skills.map((item) => {
          const Icon = skillIcons[item.skill];
          return (
            <Link
              to={`/library?skill=${item.skill}`}
              key={item.skill}
              className={`skill-card campaign-skill-card ${item.skill}`}
            >
              <div className="skill-card-top">
                <span className={`skill-icon ${item.skill}`}>
                  <Icon size={21} />
                </span>
                <ArrowUpRight size={18} />
              </div>
              <h3>{skillNames[item.skill]}</h3>
              <p>{skillDescriptions[item.skill]}</p>
              <div className="skill-band">
                <strong>{bandLabel(item.estimatedBand)}</strong>
                <span>
                  {item.estimatedBand == null
                    ? "Chưa có kết quả"
                    : "band ước lượng"}
                </span>
              </div>
              <div className="skill-progress">
                <span
                  style={{
                    width: `${item.estimatedBand == null ? 0 : (item.estimatedBand / 9) * 100}%`,
                  }}
                />
              </div>
              <small>
                {item.attempts} bài hoàn thành
                {item.uncertainty != null
                  ? ` · Sai số ±${item.uncertainty.toFixed(1)}`
                  : ""}
              </small>
            </Link>
          );
        })}
      </div>
      {actionError && <ErrorNotice message={actionError} />}
      <div className="dashboard-lower">
        <Card>
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">THỬ THÁCH CHO LƯỢT HỌC NÀY</p>
              <h2>Gợi ý dành cho bạn</h2>
            </div>
            <Link
              to="/library"
              className="icon-link"
              aria-label="Xem tất cả bài tập"
            >
              <ArrowUpRight size={20} />
            </Link>
          </div>
          <div className="recommendations">
            {data.recommendations.slice(0, 3).map((item) => (
              <div className="recommendation" key={item.id}>
                <span className={`skill-icon ${item.skill}`}>
                  {item.skill === "grammar" ? (
                    <PenLine size={20} />
                  ) : (
                    (() => {
                      const Icon = skillIcons[item.skill];
                      return <Icon size={20} />;
                    })()
                  )}
                </span>
                <div>
                  <SkillBadge skill={item.skill} />
                  <h3>{item.title}</h3>
                  <p>
                    {item.durationMinutes} phút · {item.cefr} · Band{" "}
                    {item.band.toFixed(1)}
                  </p>
                </div>
                <button
                  className="icon-button"
                  aria-label={`Bắt đầu ${item.title}`}
                  disabled={!!busy}
                  onClick={() => void start(item.id)}
                >
                  <ArrowRight size={19} />
                </button>
              </div>
            ))}
          </div>
          <div className="content-disclaimer">
            Nội dung được biên soạn cho luyện tập; chưa được giám khảo IELTS
            thẩm định.
          </div>
        </Card>
        <Card>
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">DẤU CHÂN TRÊN HÀNH TRÌNH</p>
              <h2>Tiến độ của bạn</h2>
            </div>
            <Badge>{data.completedCount} bài</Badge>
          </div>
          {data.trend.length ? (
            <TrendChart dashboard={data} />
          ) : (
            <EmptyState
              title="Hành trình vừa bắt đầu"
              text="Kết quả của những bài đã chấm sẽ xuất hiện ở đây. Mọi bước tiến đều được ghi nhận."
            />
          )}
          <Link to="/history" className="text-link">
            Xem lịch sử học
            <ArrowRight size={16} />
          </Link>
        </Card>
      </div>
      {!!data.recentAttempts.length && (
        <Card>
          <div className="section-heading compact">
            <h2>Buổi học gần đây</h2>
            <Link to="/history" className="text-link">
              Xem tất cả
              <ArrowRight size={16} />
            </Link>
          </div>
          <AttemptList items={data.recentAttempts.slice(0, 4)} />
        </Card>
      )}
      <div className="quiet-note">
        <ShieldNote />
        Điểm số là ước lượng cho luyện tập. Writing và Speaking chỉ có band khi
        dịch vụ chấm AI được kết nối và trả kết quả hợp lệ.
      </div>
    </div>
  );
}
function ShieldNote() {
  return <CircleCheck size={17} />;
}
function Stat({
  icon,
  value,
  label,
  detail,
  to,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  detail: string;
  to?: string;
}) {
  const inner = (
    <>
      <div className="stat-top">
        <span>{icon}</span>
        <strong>{value}</strong>
      </div>
      <h3>{label}</h3>
      <p>{detail}</p>
    </>
  );
  return to ? (
    <Link to={to} className="stat-card">
      {inner}
    </Link>
  ) : (
    <div className="stat-card">{inner}</div>
  );
}
function TrendChart({ dashboard }: { dashboard: Dashboard }) {
  const points = dashboard.trend.slice(-12),
    width = 500,
    height = 180;
  const path = points
    .map(
      (point, index) =>
        `${index ? "L" : "M"}${30 + (index * (width - 60)) / Math.max(points.length - 1, 1)},${height - 25 - (point.estimatedBand / 9) * 135}`,
    )
    .join(" ");
  return (
    <div className="trend-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Band ước lượng của các bài học gần đây"
      >
        {[3, 6, 9].map((band) => (
          <g key={band}>
            <line
              x1="30"
              x2="480"
              y1={height - 25 - (band / 9) * 135}
              y2={height - 25 - (band / 9) * 135}
              stroke="#e2d5ba"
              strokeDasharray="4 4"
            />
            <text
              x="3"
              y={height - 20 - (band / 9) * 135}
              fontSize="11"
              fill="#6b745d"
            >
              {band}
            </text>
          </g>
        ))}
        <path
          d={path}
          stroke="#396747"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        {points.map((point, index) => (
          <circle
            key={`${point.day}-${index}`}
            cx={30 + (index * (width - 60)) / Math.max(points.length - 1, 1)}
            cy={height - 25 - (point.estimatedBand / 9) * 135}
            r="4"
            fill="#396747"
          >
            <title>
              {point.day} · {skillNames[point.skill]} ·{" "}
              {point.estimatedBand.toFixed(1)}
            </title>
          </circle>
        ))}
      </svg>
      <p className="muted small-text">
        Mỗi điểm là một kết quả thực tế đã chấm, theo thứ tự thời gian.
      </p>
    </div>
  );
}
export function PlanPage() {
  const { data, loading, error, reload, setData } = useApi<{ plan: StudyPlan }>(
    "/plan",
  );
  const { user } = useSession();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(""),
    [actionError, setError] = useState("");
  async function complete(task: StudyTask) {
    setBusy(task.id);
    setError("");
    try {
      setData(
        await api<{ plan: StudyPlan }>(`/plan/tasks/${task.id}`, {
          method: "PATCH",
          body: json({ completed: !task.completed }),
        }),
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy("");
    }
  }
  async function start(task: StudyTask) {
    if (task.kind === "vocabulary") return navigate("/vocabulary");
    if (task.kind === "placement") return navigate("/placement");
    if (!task.contentId) return navigate("/library");
    setBusy(task.id);
    setError("");
    try {
      navigate(`/learn/${(await createAttempt(task.contentId)).id}`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy("");
    }
  }
  if (loading) return <Loading />;
  if (error || !data)
    return (
      <ErrorNotice
        message={error || "Không có lộ trình."}
        retry={() => void reload()}
      />
    );
  const plan = data.plan;
  const done = plan.tasks.filter((task) => task.completed).length;
  const days = [...new Set(plan.tasks.map((task) => task.day))];
  return (
    <div className="stack page-stack campaign-plan">
      <PageHeader
        eyebrow="NHẬT LỆNH TUẦN NÀY"
        title="Lộ trình của hai người"
        description="Từng buổi học nhỏ, cùng hướng về một mục tiêu lớn."
        action={
          <Link className="button secondary" to="/settings">
            <SettingsIcon />
            Điều chỉnh mục tiêu
          </Link>
        }
      />
      <Card className="plan-summary campaign-plan-summary">
        <CampaignRelic kind="compass" />
        <div>
          <Badge>Tuần bắt đầu {dateLabel(plan.weekStart)}</Badge>
          <h2>Hướng đến band {plan.targetBand.toFixed(1)}</h2>
          <p className="muted">{plan.explanation}</p>
        </div>
        <div className="plan-progress">
          <strong>
            {done}
            <span>/{plan.tasks.length}</span>
          </strong>
          <p>Nhiệm vụ hoàn thành</p>
          <progress max={Math.max(plan.tasks.length, 1)} value={done} />
        </div>
      </Card>
      <div className="notice">
        <CalendarDays size={19} />
        <span>
          {user.weeklyMinutes} phút / tuần · {user.dailyMinutes} phút / ngày ·{" "}
          {user.testType === "academic" ? "Academic" : "General Training"}. Đánh
          dấu hoàn thành khi bạn đã thực sự học xong.
        </span>
      </div>
      {actionError && <ErrorNotice message={actionError} />}
      {days.map((day) => (
        <section key={day} className="plan-day">
          <div className="plan-day-label">
            <span>
              {new Intl.DateTimeFormat("vi-VN", {
                weekday: "long",
                timeZone: "Asia/Bangkok",
              }).format(new Date(day))}
            </span>
            <small>{dateLabel(day)}</small>
          </div>
          <div className="stack">
            {plan.tasks
              .filter((task) => task.day === day)
              .map((task) => (
                <div
                  key={task.id}
                  className={`plan-task ${task.completed ? "completed" : ""}`}
                >
                  <button
                    className="task-check"
                    aria-label={`${task.completed ? "Bỏ đánh dấu" : "Hoàn thành"} ${task.title}`}
                    aria-pressed={task.completed}
                    disabled={!!busy}
                    onClick={() => void complete(task)}
                  >
                    {task.completed && <Check size={18} />}
                  </button>
                  <div className="plan-task-content">
                    <Badge>
                      {task.kind === "vocabulary"
                        ? "Từ vựng"
                        : task.kind === "placement"
                          ? "Đầu vào"
                          : skillNames[task.kind]}
                    </Badge>
                    <h3>{task.title}</h3>
                    <p>{task.reason}</p>
                  </div>
                  <span className="task-duration">
                    <Clock3 size={15} />
                    {task.minutes} phút
                  </span>
                  <Button
                    className="secondary small"
                    disabled={!!busy}
                    onClick={() => void start(task)}
                  >
                    {task.completed ? "Học lại" : "Bắt đầu"}
                    <ArrowRight size={16} />
                  </Button>
                </div>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
function SettingsIcon() {
  return <Target size={18} />;
}

export function VocabularyPage() {
  const [tab, setTab] = useState<"bank" | "cards" | "review">("bank"),
    [q, setQ] = useState(""),
    [query, setQuery] = useState(""),
    [cefr, setCefr] = useState(""),
    [topic, setTopic] = useState(""),
    [page, setPage] = useState(1);
  const bank = useApi<{ items: VocabularyEntry[]; total: number }>(
    `/vocabulary/bank?q=${encodeURIComponent(query)}&cefr=${cefr}&topic=${encodeURIComponent(topic)}&page=${page}`,
  );
  const cards = useApi<{ cards: VocabularyCard[]; dueCount: number }>(
    "/vocabulary/cards",
  );
  const [entry, setEntry] = useState<VocabularyEntry | null>(null),
    [custom, setCustom] = useState(false),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [flipped, setFlipped] = useState(false),
    [reviewed, setReviewed] = useState(0);
  const topics = [
    "Education",
    "Environment",
    "Technology",
    "Health",
    "Work",
    "Transport",
    "Travel",
    "Arts",
    "Community",
    "Food",
    "Science",
    "Finance",
  ];
  async function save(vocabularyId: string) {
    setBusy(vocabularyId);
    setError("");
    try {
      await api("/vocabulary/cards", {
        method: "POST",
        body: json({ vocabularyId }),
      });
      await cards.reload();
      setNotice("Đã lưu từ vào sổ của bạn.");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy("");
    }
  }
  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("custom");
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await api("/vocabulary/cards", {
        method: "POST",
        body: json({
          word: String(form.get("word")),
          meaning: String(form.get("meaning")),
          example: String(form.get("example")),
          cefr: String(form.get("cefr")),
          topic: "Custom",
        }),
      });
      await cards.reload();
      setCustom(false);
      setNotice("Đã thêm thẻ từ vựng của bạn.");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy("");
    }
  }
  async function review(card: VocabularyCard, rating: 1 | 2 | 3 | 4) {
    setBusy(card.id);
    setError("");
    try {
      await api(`/vocabulary/cards/${card.id}/review`, {
        method: "POST",
        body: json({ rating }),
      });
      await cards.reload();
      setFlipped(false);
      setReviewed((count) => count + 1);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy("");
    }
  }
  const saved = new Set(cards.data?.cards.map((card) => card.vocabularyId));
  const due = cards.data?.cards.filter((card) => card.due) || [];
  const activeCard = due[0];
  return (
    <div className="stack page-stack campaign-vocabulary">
      <PageHeader
        eyebrow="KHO HÀNH TRANG NGÔN NGỮ"
        title="Sổ từ vựng"
        description="Khám phá từ theo chủ đề, lưu vào sổ và ôn đúng lúc để nhớ lâu hơn."
        action={
          <Button className="secondary" onClick={() => setCustom(true)}>
            <Plus size={17} />
            Thêm từ của tôi
          </Button>
        }
      />
      <CampaignBanner
        kind="book"
        eyebrow="MỖI TỪ LÀ MỘT MẢNH HÀNH TRANG"
        title="Gom từng từ. Mở rộng vốn diễn đạt."
        text="Lưu từ bạn cần, lật thẻ để thử trí nhớ rồi chọn mức độ nhớ thật của mình."
      >
        {cards.data && (
          <>
            <span><BookOpen size={15} />{cards.data.cards.length} từ đã lưu</span>
            <span><Clock3 size={15} />{cards.data.dueCount} thẻ đến hạn ôn</span>
          </>
        )}
      </CampaignBanner>
      <div className="tabs" role="tablist" aria-label="Chế độ từ vựng">
        <button
          role="tab"
          aria-selected={tab === "bank"}
          className={tab === "bank" ? "selected" : ""}
          onClick={() => setTab("bank")}
        >
          Khám phá từ vựng
        </button>
        <button
          role="tab"
          aria-selected={tab === "cards"}
          className={tab === "cards" ? "selected" : ""}
          onClick={() => setTab("cards")}
        >
          Từ đã lưu <Badge>{cards.data?.cards.length || 0}</Badge>
        </button>
        <button
          role="tab"
          aria-selected={tab === "review"}
          className={tab === "review" ? "selected" : ""}
          onClick={() => {
            setTab("review");
            setFlipped(false);
          }}
        >
          Ôn hôm nay <Badge>{cards.data?.dueCount || 0}</Badge>
        </button>
      </div>
      {error && <ErrorNotice message={error} />}{" "}
      {notice && (
        <div className="notice success" role="status">
          <CircleCheck size={18} />
          {notice}
          <button className="text-link" onClick={() => setNotice("")}>
            Đóng
          </button>
        </div>
      )}
      {tab === "bank" && (
        <>
          <form
            className="filter-bar"
            onSubmit={(event) => {
              event.preventDefault();
              setQuery(q);
              setPage(1);
            }}
          >
            <div className="search-field">
              <Search size={18} />
              <input
                aria-label="Tìm từ vựng"
                value={q}
                onChange={(event) => setQ(event.target.value)}
                placeholder="Tìm từ hoặc nghĩa tiếng Việt…"
              />
            </div>
            <select
              aria-label="Cấp độ CEFR"
              value={cefr}
              onChange={(event) => {
                setCefr(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Mọi cấp độ</option>
              {["A2", "B1", "B2", "C1"].map((level) => (
                <option key={level}>{level}</option>
              ))}
            </select>
            <select
              aria-label="Chủ đề từ vựng"
              value={topic}
              onChange={(event) => {
                setTopic(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Mọi chủ đề</option>
              {topics.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
            <Button className="small" type="submit">
              Tìm kiếm
            </Button>
          </form>
          {bank.loading ? (
            <Loading />
          ) : bank.error ? (
            <ErrorNotice
              message={bank.error}
              retry={() => void bank.reload()}
            />
          ) : (
            <>
              <p className="muted small-text">
                {bank.data?.total || 0} từ vựng phù hợp · Chọn một từ để xem
                cách dùng.
              </p>
              <div className="vocab-grid">
                {bank.data?.items.map((item) => (
                  <article className="vocab-card" key={item.id}>
                    <div className="vocab-card-header">
                      <Badge>{item.cefr}</Badge>
                      <button
                        className="icon-button"
                        aria-label={`Phát âm ${item.word}`}
                        onClick={() => speak(item.word)}
                      >
                        <Volume2 size={17} />
                      </button>
                    </div>
                    <button
                      className="vocab-word"
                      onClick={() => setEntry(item)}
                    >
                      {item.word}
                    </button>
                    <p className="vocab-ipa">
                      {item.ipa} · {item.partOfSpeech}
                    </p>
                    <p className="vocab-meaning">{item.meaning}</p>
                    <div className="vocab-card-footer">
                      <span>{item.topic}</span>
                      <button
                        className={`save-word ${saved.has(item.id) ? "saved" : ""}`}
                        disabled={!!busy || saved.has(item.id)}
                        onClick={() => void save(item.id)}
                        aria-label={`${saved.has(item.id) ? "Đã lưu" : "Lưu"} ${item.word}`}
                      >
                        {saved.has(item.id) ? (
                          <Check size={16} />
                        ) : (
                          <Plus size={16} />
                        )}{" "}
                        {saved.has(item.id) ? "Đã lưu" : "Lưu từ"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              {!bank.data?.items.length && (
                <EmptyState
                  title="Chưa tìm thấy từ phù hợp"
                  text="Thử một từ khóa hoặc chủ đề khác."
                />
              )}
              <div className="pagination">
                <Button
                  className="secondary small"
                  disabled={page <= 1}
                  onClick={() => setPage((value) => value - 1)}
                >
                  Trang trước
                </Button>
                <span>Trang {page}</span>
                <Button
                  className="secondary small"
                  disabled={
                    !bank.data?.items.length || page * 30 >= bank.data.total
                  }
                  onClick={() => setPage((value) => value + 1)}
                >
                  Trang tiếp
                </Button>
              </div>
            </>
          )}
        </>
      )}
      {tab === "cards" &&
        (cards.loading ? (
          <Loading />
        ) : cards.error ? (
          <ErrorNotice
            message={cards.error}
            retry={() => void cards.reload()}
          />
        ) : !cards.data?.cards.length ? (
          <EmptyState
            title="Sổ từ vựng đang chờ bạn"
            text="Lưu từ từ kho từ vựng hoặc thêm thẻ của riêng bạn."
          >
            <Button onClick={() => setTab("bank")}>
              Khám phá từ vựng
              <ArrowRight size={16} />
            </Button>
          </EmptyState>
        ) : (
          <div className="saved-card-list">
            {cards.data.cards.map((card) => (
              <Card key={card.id} className="saved-card">
                <div>
                  <div className="row">
                    <h3>{card.word}</h3>
                    <button
                      className="icon-button"
                      aria-label={`Phát âm ${card.word}`}
                      onClick={() => speak(card.word)}
                    >
                      <Volume2 size={17} />
                    </button>
                    <Badge>{card.cefr}</Badge>
                  </div>
                  <p>{card.meaning}</p>
                  {card.example && (
                    <p className="muted italic">{card.example}</p>
                  )}
                </div>
                <div className="saved-card-schedule">
                  <Badge className={card.due ? "due" : ""}>
                    {card.due
                      ? "Đến hạn ôn"
                      : `Ôn tiếp ${dateLabel(card.dueAt)}`}
                  </Badge>
                  <small>
                    {card.reps} lần ôn · Độ ổn định {card.stability.toFixed(1)}{" "}
                    ngày
                  </small>
                </div>
              </Card>
            ))}
          </div>
        ))}
      {tab === "review" &&
        (cards.loading ? (
          <Loading />
        ) : cards.error ? (
          <ErrorNotice
            message={cards.error}
            retry={() => void cards.reload()}
          />
        ) : activeCard ? (
          <>
            <div className="review-heading">
              <p>
                {due.length} thẻ đến hạn · {reviewed} thẻ đã ôn trong buổi này
              </p>
              <Badge>Lặp lại ngắt quãng · FSRS</Badge>
            </div>
            <Card className={`flashcard ${flipped ? "flipped" : ""}`}>
              <span className="campaign-flashcard-eyebrow">THỬ THÁCH TRÍ NHỚ</span>
              <Badge>
                {activeCard.cefr} · {activeCard.topic}
              </Badge>
              <button
                className="icon-button flashcard-sound"
                aria-label={`Phát âm ${activeCard.word}`}
                onClick={() => speak(activeCard.word)}
              >
                <Volume2 />
              </button>
              <h2>{activeCard.word}</h2>
              {flipped ? (
                <div className="flashcard-answer">
                  <p>{activeCard.meaning}</p>
                  {activeCard.example && (
                    <blockquote>{activeCard.example}</blockquote>
                  )}
                </div>
              ) : (
                <p className="muted">
                  Thử nhớ nghĩa và một câu ví dụ trước khi lật thẻ.
                </p>
              )}
              <Button
                className="secondary"
                onClick={() => setFlipped(!flipped)}
              >
                <RotateCcw size={17} />
                {flipped ? "Ẩn đáp án" : "Lật thẻ"}
              </Button>
            </Card>
            {flipped && (
              <div className="review-ratings">
                {(
                  [
                    { rating: 1, label: "Chưa nhớ", sub: "Cần học lại" },
                    { rating: 2, label: "Khó", sub: "Nhớ với gợi ý" },
                    { rating: 3, label: "Nhớ được", sub: "Nhớ đúng" },
                    { rating: 4, label: "Dễ", sub: "Nhớ ngay" },
                  ] as const
                ).map((item) => (
                  <button
                    className={`rating rating-${item.rating}`}
                    disabled={!!busy}
                    key={item.rating}
                    onClick={() => void review(activeCard, item.rating)}
                  >
                    <strong>{item.label}</strong>
                    <small>{item.sub}</small>
                  </button>
                ))}
              </div>
            )}
            <p className="muted small-text center">
              Chọn đúng mức độ nhớ. Hệ thống sẽ tính thời điểm ôn tiếp theo từ
              lịch sử của bạn.
            </p>
          </>
        ) : (
          <EmptyState
            title={
              reviewed ? "Một buổi ôn thật tốt!" : "Hôm nay chưa có thẻ đến hạn"
            }
            text={
              cards.data?.cards.length
                ? "Hẹn bạn vào lần ôn tiếp theo. Lịch của từng thẻ được cập nhật theo mức độ nhớ."
                : "Lưu một vài từ mới để bắt đầu luyện nhớ."
            }
          >
            <Button onClick={() => setTab("bank")}>
              Khám phá thêm từ
              <ArrowRight size={17} />
            </Button>
          </EmptyState>
        ))}
      {entry && (
        <Modal title={entry.word} onClose={() => setEntry(null)}>
          <div className="stack">
            <div className="row">
              <Badge>{entry.cefr}</Badge>
              <Badge>{entry.register}</Badge>
              <span className="muted">
                {entry.ipa} · {entry.partOfSpeech}
              </span>
              <button
                className="icon-button"
                aria-label={`Phát âm ${entry.word}`}
                onClick={() => speak(entry.word)}
              >
                <Volume2 size={18} />
              </button>
            </div>
            <h3>{entry.meaning}</h3>
            <p className="muted">{entry.definition}</p>
            <div>
              <h4>Ví dụ trong ngữ cảnh</h4>
              {entry.examples.map((example) => (
                <blockquote key={example}>{example}</blockquote>
              ))}
            </div>
            <div>
              <h4>Collocations</h4>
              <div className="tag-list">
                {entry.collocations.map((value) => (
                  <Badge key={value}>{value}</Badge>
                ))}
              </div>
            </div>
            <div className="grid-2">
              <div>
                <h4>Họ từ</h4>
                <p>{entry.family.join(" · ") || "—"}</p>
              </div>
              <div>
                <h4>Từ gần nghĩa</h4>
                <p>{entry.synonyms.join(" · ") || "—"}</p>
              </div>
            </div>
            <div className="notice warning">
              <AlertTriangle size={18} />
              <div>
                <strong>Lỗi người học thường gặp</strong>
                <p>{entry.commonError}</p>
              </div>
            </div>
            <Button
              disabled={!!busy || saved.has(entry.id)}
              onClick={() => void save(entry.id)}
            >
              {saved.has(entry.id)
                ? "Đã có trong sổ từ vựng"
                : "Lưu vào sổ từ vựng"}
              <Plus size={17} />
            </Button>
          </div>
        </Modal>
      )}
      {custom && (
        <Modal title="Thêm từ của bạn" onClose={() => setCustom(false)}>
          <form className="stack" onSubmit={(event) => void add(event)}>
            <label className="field">
              Từ / cụm từ
              <input
                name="word"
                required
                maxLength={100}
                placeholder="a turning point"
              />
            </label>
            <label className="field">
              Nghĩa tiếng Việt
              <input
                name="meaning"
                required
                maxLength={500}
                placeholder="một bước ngoặt"
              />
            </label>
            <label className="field">
              Câu ví dụ
              <textarea
                name="example"
                rows={3}
                maxLength={1000}
                placeholder="Moving abroad was a turning point in my life."
              />
            </label>
            <label className="field">
              Cấp độ
              <select name="cefr" defaultValue="B1">
                {["A2", "B1", "B2", "C1"].map((level) => (
                  <option key={level}>{level}</option>
                ))}
              </select>
            </label>
            {error && <ErrorNotice message={error} />}
            <Button type="submit" disabled={!!busy}>
              {busy ? "Đang lưu…" : "Lưu thẻ"}
            </Button>
          </form>
        </Modal>
      )}
    </div>
  );
}
function speak(text: string) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-GB";
  utterance.rate = 0.88;
  window.speechSynthesis.speak(utterance);
}
export function HistoryPage() {
  const [skill, setSkill] = useState(""),
    [status, setStatus] = useState("");
  const { data, loading, error, reload } = useApi<{
    attempts: AttemptSummary[];
  }>(`/attempts?skill=${skill}&status=${status}`);
  return (
    <div className="stack page-stack campaign-history">
      <PageHeader
        eyebrow="NHỮNG BƯỚC TIẾN ĐÃ GOM GÓP"
        title="Lịch sử học"
        description="Mở lại bài đã làm, xem phản hồi và tiếp tục bài đang dang dở."
      />
      <CampaignBanner
        kind="scroll"
        eyebrow="NHÌN LẠI NHỮNG LƯỢT HỌC"
        title="Mỗi buổi học để lại một dấu chân."
        text="Bài đang làm và kết quả đã nộp được giữ trong nhật ký. Chọn một bài để tiếp tục hoặc xem lại phản hồi."
      />
      <div className="filter-bar">
        <select
          aria-label="Lọc kỹ năng"
          value={skill}
          onChange={(event) => setSkill(event.target.value)}
        >
          <option value="">Tất cả kỹ năng</option>
          {Object.entries(skillNames).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="Lọc trạng thái"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">Tất cả trạng thái</option>
          <option value="in-progress">Đang làm</option>
          <option value="submitted">Đã nộp</option>
        </select>
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorNotice message={error} retry={() => void reload()} />
      ) : !data?.attempts.length ? (
        <EmptyState
          title="Chưa có bài học trong bộ lọc này"
          text="Hãy bắt đầu một bài tập. Bài làm và phản hồi sẽ được lưu ở đây."
        >
          <Link to="/library" className="button">
            Bắt đầu luyện tập
            <ArrowRight size={16} />
          </Link>
        </EmptyState>
      ) : (
        <Card>
          <AttemptList items={data.attempts} />
        </Card>
      )}
      <PlacementHistory />
    </div>
  );
}
function PlacementHistory() {
  const { data, loading, error, reload } = useApi<{
    placements: PlacementSummary[];
  }>("/placement/history");
  return (
    <Card>
      <div className="section-heading compact">
        <div>
          <p className="eyebrow">KẾT QUẢ CHẨN ĐOÁN ĐÃ LƯU</p>
          <h2>Kiểm tra đầu vào</h2>
        </div>
        <Link to="/placement" className="text-link">
          Kiểm tra lại
          <ArrowRight size={16} />
        </Link>
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorNotice message={error} retry={() => void reload()} />
      ) : !data?.placements.length ? (
        <EmptyState
          title="Chưa có bài kiểm tra đầu vào"
          text="Bài kiểm tra Reading và Listening giúp định hướng lộ trình luyện tập của bạn."
        />
      ) : (
        <div className="attempt-list">
          {data.placements.map((item) => (
            <article key={item.id} className="placement-history-row">
              <div className="row wrap">
                <h3>
                  {item.mode === "quick"
                    ? "Kiểm tra nhanh"
                    : "Kiểm tra chuyên sâu"}
                </h3>
                <Badge>
                  {item.completed}/{item.total} câu
                </Badge>
                <span className="muted small-text">
                  {dateLabel(item.startedAt)}
                </span>
              </div>
              {item.result ? (
                <>
                  <div className="placement-history-result">
                    <strong>
                      Band {bandLabel(item.result.estimatedBand)}{" "}
                      <small>ước lượng Reading / Listening</small>
                    </strong>
                    <Badge>
                      Sai số chuẩn θ: {item.standardError.toFixed(2)}
                    </Badge>
                  </div>
                  <p className="muted small-text">{item.result.summary}</p>
                  <Link className="text-link" to={`/placement?review=${encodeURIComponent(item.id)}`}>
                    Xem lại đáp án từng câu
                    <ArrowRight size={15} />
                  </Link>
                </>
              ) : (
                <div className="row">
                  <Badge className="warning">Chưa hoàn thành</Badge>
                  <Link className="text-link" to="/placement">
                    Tiếp tục kiểm tra
                    <ArrowRight size={15} />
                  </Link>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      <p className="muted small-text">
        Chẩn đoán từ câu hỏi Reading và Listening; chưa đo Writing hoặc
        Speaking. Điểm tham khảo chưa được hiệu chuẩn như bài thi IELTS chính
        thức.
      </p>
    </Card>
  );
}
function AttemptList({ items }: { items: AttemptSummary[] }) {
  return (
    <div className="attempt-list">
      {items.map((item) => (
        <Link key={item.id} to={`/learn/${item.id}`} className="attempt-row">
          <div>
            <SkillBadge skill={item.skill} />
            <h3>{item.title}</h3>
            <p>
              {dateLabel(item.startedAt)} ·{" "}
              {item.mode === "exam" ? "Thi thử" : "Luyện tập"} ·{" "}
              {Math.round(item.durationSeconds / 60)} phút
            </p>
          </div>
          <div className="attempt-result">
            {item.status === "in-progress" ? (
              <Badge className="warning">Đang làm</Badge>
            ) : (
              <>
                <strong>
                  {item.estimatedBand == null
                    ? item.rawScore == null
                      ? "Đã lưu"
                      : `${item.rawScore}/${item.total}`
                    : item.estimatedBand.toFixed(1)}
                </strong>
                <small>
                  {item.estimatedBand == null
                    ? "Kết quả luyện tập"
                    : "band ước lượng"}
                </small>
              </>
            )}
            <ChevronRight size={18} />
          </div>
        </Link>
      ))}
    </div>
  );
}
export function ErrorsPage() {
  const { data, loading, error, reload } = useApi<ErrorNotebook>("/errors");
  const navigate = useNavigate();
  const [busy, setBusy] = useState(""),
    [actionError, setError] = useState("");
  async function retry(contentId: string) {
    setBusy(contentId);
    setError("");
    try {
      navigate(`/learn/${(await createAttempt(contentId)).id}`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="stack page-stack campaign-errors">
      <PageHeader
        eyebrow="XƯỞNG RÈN KỸ NĂNG"
        title="Sổ lỗi thường gặp"
        description="Những điểm cần luyện được tổng hợp từ câu trả lời thật của bạn."
      />
      <CampaignBanner
        kind="forge"
        eyebrow="RÈN LẠI · HIỂU SÂU HƠN"
        title="Biến từng lỗi nhỏ thành một bước tiến."
        text="Đối chiếu câu trả lời với bằng chứng và luyện lại đúng dạng bài. Đây là nơi chuẩn bị cho thử thách tiếp theo."
      />
      {actionError && <ErrorNotice message={actionError} />}{" "}
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorNotice message={error} retry={() => void reload()} />
      ) : !data?.items.length ? (
        <EmptyState
          title="Chưa có lỗi cần ôn"
          text="Khi bạn làm bài, hệ thống sẽ gom các câu trả lời sai theo kỹ năng và dạng bài để bạn học lại có mục tiêu."
        />
      ) : (
        <div className="stack">
          {data.items.map((item) => (
            <Card key={`${item.skill}-${item.tag}`}>
              <div className="section-heading compact">
                <div>
                  <SkillBadge skill={item.skill} />
                  <h2 className="error-tag">{item.tag.replaceAll("-", " ")}</h2>
                </div>
                <Badge className="warning">{item.count} lần cần luyện</Badge>
              </div>
              <div className="error-examples">
                {item.examples.map((example, index) => (
                  <div
                    className="error-example"
                    key={`${example.contentId}-${index}`}
                  >
                    <h4>{example.prompt}</h4>
                    <div className="grid-2">
                      <div>
                        <p className="eyebrow">CÂU TRẢ LỜI CỦA BẠN</p>
                        <p className="wrong-answer">
                          {example.response || "(Chưa trả lời)"}
                        </p>
                      </div>
                      <div>
                        <p className="eyebrow">ĐÁP ÁN / GỢI Ý SỬA</p>
                        <p className="correct-answer">{example.correction}</p>
                      </div>
                    </div>
                    <p className="muted">{example.explanation}</p>
                    <Button
                      className="secondary small"
                      disabled={!!busy}
                      onClick={() => void retry(example.contentId)}
                    >
                      Luyện lại bài này
                      <ArrowRight size={15} />
                    </Button>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
export function SettingsPage() {
  const { user, health, setUser, refresh } = useSession();
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [confirm, setConfirm] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("profile");
    setError("");
    setNotice("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await api<{ user: Profile }>("/profile", {
        method: "PATCH",
        body: json({
          name:
            health?.duoEnabled === false ? String(form.get("name")) : user.name,
          targetBand:
            health?.duoEnabled === false
              ? Number(form.get("targetBand"))
              : user.targetBand,
          testType: String(form.get("testType")),
          examDate: form.get("examDate") ? String(form.get("examDate")) : null,
          weeklyMinutes: Number(form.get("weeklyMinutes")),
          dailyMinutes: Number(form.get("dailyMinutes")),
          selfAssessment: Object.fromEntries(
            ["reading", "listening", "writing", "speaking"].map((skill) => [
              skill,
              form.get(`self-${skill}`)
                ? Number(form.get(`self-${skill}`))
                : null,
            ]),
          ),
        }),
      });
      setUser(result.user);
      setNotice("Đã cập nhật hồ sơ và mục tiêu học.");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy("");
    }
  }
  async function exportData() {
    setBusy("export");
    setError("");
    try {
      const data = await api<unknown>("/account/export");
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `ielts-ai-learning-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("Đã tải bản sao dữ liệu học của bạn.");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy("");
    }
  }
  async function clearHistory() {
    setBusy("clear");
    setError("");
    try {
      await api("/account/history", {
        method: "DELETE",
        body: json({ confirm: true }),
      });
      await refresh();
      setConfirm(false);
      setNotice("Đã xóa lịch sử học. Hồ sơ tài khoản vẫn được giữ.");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="stack page-stack campaign-settings">
      <PageHeader
        eyebrow="CHUẨN BỊ HÀNH TRANG"
        title="Hồ sơ & cài đặt"
        description="Một mục tiêu rõ ràng giúp mỗi buổi học có ý nghĩa hơn."
      />
      <CampaignBanner
        kind="compass"
        eyebrow="LA BÀN CỦA BẠN"
        title="Chuẩn bị cho chặng đường tiếp theo."
        text="Chọn nhịp học phù hợp và theo dõi mục tiêu. Lộ trình cùng nhau vẫn dựa trên kết quả học thực tế."
      >
        <span><Target size={15} />Mục tiêu band {user.targetBand.toFixed(1)}</span>
        <span><Clock3 size={15} />{user.dailyMinutes} phút mỗi ngày</span>
      </CampaignBanner>
      {error && <ErrorNotice message={error} />}{" "}
      {notice && (
        <div className="notice success" role="status">
          <Check size={18} />
          {notice}
        </div>
      )}
      <Card>
        <div className="section-heading compact">
          <h2>Hồ sơ & mục tiêu IELTS</h2>
          {user.demo && <Badge>Tài khoản trải nghiệm</Badge>}
        </div>
        <form className="stack" onSubmit={(event) => void save(event)}>
          <div className="grid-2">
            <label className="field">
              Tên của bạn
              {health?.duoEnabled === false ? (
                <input
                  name="name"
                  defaultValue={user.name}
                  required
                  minLength={2}
                  maxLength={80}
                />
              ) : (
                <input name="name" value={user.name} readOnly disabled />
              )}
            </label>
            <label className="field">
              {health?.duoEnabled === false ? "Email" : "Số điện thoại"}
              <input
                value={
                  health?.duoEnabled === false ? user.email : user.phone || ""
                }
                disabled
                readOnly
              />
              <small>
                {health?.duoEnabled === false
                  ? "Email tài khoản hiện tại"
                  : "Số điện thoại đăng nhập"}
              </small>
            </label>
            <label className="field">
              {health?.duoEnabled === false
                ? "Mục tiêu band"
                : "Mục tiêu band chung"}
              <select
                name="targetBand"
                defaultValue={user.targetBand}
                disabled={health?.duoEnabled !== false}
              >
                {[3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8].map((value) => (
                  <option value={value} key={value}>
                    {value.toFixed(1)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Hình thức IELTS
              <select name="testType" defaultValue={user.testType}>
                <option value="academic">Academic</option>
                <option value="general">General Training</option>
              </select>
            </label>
            <label className="field">
              Ngày dự định thi
              <input
                name="examDate"
                type="date"
                defaultValue={user.examDate?.slice(0, 10) || ""}
              />
              <small>Có thể để trống nếu bạn chưa chốt lịch thi.</small>
            </label>
            <label className="field">
              Thời gian học mỗi ngày (phút)
              <input
                name="dailyMinutes"
                type="number"
                min={10}
                max={180}
                step={5}
                defaultValue={user.dailyMinutes}
                required
              />
            </label>
            <label className="field">
              Thời gian học mỗi tuần (phút)
              <input
                name="weeklyMinutes"
                type="number"
                min={30}
                max={3000}
                step={10}
                defaultValue={user.weeklyMinutes}
                required
              />
            </label>
            <div className="profile-level">
              <p className="eyebrow">TRÌNH ĐỘ TỪ DỮ LIỆU HỌC</p>
              <strong>{bandLabel(user.currentBand)}</strong>
              <span>Band ước lượng · CEFR {user.cefr || "chưa xác định"}</span>
              <Link to="/placement" className="text-link">
                Làm lại bài đầu vào
                <ArrowRight size={15} />
              </Link>
            </div>
          </div>
          <div className="self-assessment">
            <h3>Tự đánh giá trình độ (tùy chọn)</h3>
            <p className="muted small-text">
              Chỉ dùng để định hướng lộ trình khi chưa có kết quả học. Đây là
              đánh giá của bạn, không phải điểm kiểm tra.
            </p>
            <div className="self-assessment-grid">
              {(["reading", "listening", "writing", "speaking"] as const).map(
                (skill) => (
                  <label className="field" key={skill}>
                    {skillNames[skill]}
                    <select
                      name={`self-${skill}`}
                      defaultValue={user.selfAssessment?.[skill] ?? ""}
                    >
                      <option value="">Chưa biết</option>
                      {[3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8].map(
                        (band) => (
                          <option key={band} value={band}>
                            {band.toFixed(1)}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                ),
              )}
            </div>
          </div>
          <div>
            <Button type="submit" disabled={!!busy}>
              {busy === "profile" ? "Đang lưu…" : "Lưu thay đổi"}
              <Check size={17} />
            </Button>
          </div>
        </form>
      </Card>
      <Card>
        <div className="section-heading compact">
          <div>
            <h2>Khả năng của dịch vụ</h2>
            <p className="muted">
              Trạng thái cấu hình trên máy chủ. Đã cấu hình không đồng nghĩa đã
              kiểm chứng chất lượng kết quả.
            </p>
          </div>
        </div>
        <div className="service-grid">
          {(
            [
              {
                key: "openai",
                label: "Phản hồi AI & phiên âm",
                detail: "Chấm Writing, phản hồi Speaking, tạo bài và Whisper.",
              },
              {
                key: "elevenlabs",
                label: "Giọng đọc nhiều nhân vật",
                detail: "Audio Listening theo hội thoại và giọng đọc phù hợp.",
              },
              {
                key: "azure",
                label: "Phân tích phát âm",
                detail: "Azure Speech: độ chính xác, trôi chảy và ngữ điệu.",
              },
            ] as const
          ).map((service) => (
            <div className="service-card" key={service.key}>
              <Badge
                className={
                  health?.services[service.key] ? "success" : "neutral"
                }
              >
                {health?.services[service.key]
                  ? "Đã cấu hình"
                  : "Chưa cấu hình"}
              </Badge>
              <h3>{service.label}</h3>
              <p>{service.detail}</p>
            </div>
          ))}
        </div>
        <div className="notice">
          <Sparkles size={18} />
          <span>
            Khi AI chưa kết nối, bạn vẫn luyện bài, xem đáp án, lưu bài viết và
            ôn từ. Hệ thống không tự gán band AI giả.
          </span>
        </div>
      </Card>
      <Card>
        <h2>Dữ liệu học của bạn</h2>
        <p className="muted">
          Tải bản sao trước khi xóa. Chỉ dữ liệu thuộc tài khoản đang đăng nhập
          được xử lý.
        </p>
        <div className="row wrap">
          <Button
            className="secondary"
            disabled={!!busy}
            onClick={() => void exportData()}
          >
            <Download size={17} />
            {busy === "export" ? "Đang tải…" : "Xuất dữ liệu JSON"}
          </Button>
          {health?.duoEnabled === false && (
            <Button
              className="danger secondary"
              disabled={!!busy}
              onClick={() => setConfirm(true)}
            >
              <Trash2 size={17} />
              Xóa lịch sử học
            </Button>
          )}
        </div>
      </Card>
      {confirm && (
        <Modal
          title="Xóa lịch sử học của bạn?"
          onClose={() => setConfirm(false)}
        >
          <div className="stack">
            <div className="notice warning">
              <AlertTriangle size={20} />
              <span>
                Bài làm, kết quả đầu vào, lộ trình và dữ liệu ôn từ của tài
                khoản này sẽ bị xóa. Thao tác không thể hoàn tác.
              </span>
            </div>
            <p>
              Hồ sơ tài khoản vẫn được giữ. Bạn có thể tải bản sao dữ liệu trước
              khi tiếp tục.
            </p>
            <div className="row">
              <Button
                className="secondary"
                disabled={!!busy}
                onClick={() => setConfirm(false)}
              >
                Giữ dữ liệu
              </Button>
              <Button
                className="danger"
                disabled={!!busy}
                onClick={() => void clearHistory()}
              >
                {busy === "clear" ? "Đang xóa…" : "Xác nhận xóa lịch sử"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
