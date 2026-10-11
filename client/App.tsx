import { useEffect, useState, type FormEvent } from "react";
import {
  NavLink,
  Navigate,
  Route,
  Routes,
  Link,
  useLocation,
} from "react-router-dom";
import {
  LayoutDashboard,
  LibraryBig,
  ClipboardCheck,
  Compass,
  Route as RouteIcon,
  Layers,
  History,
  NotebookPen,
  Settings,
  Menu,
  X,
  LogOut,
  ArrowUpRight,
  Sparkles,
  ShieldCheck,
  Headphones,
  Check,
  Flame,
  Trees,
} from "lucide-react";
import type { Health, Profile } from "../shared/types";
import { api, json } from "./api";
import { Button, ErrorNotice, Loading } from "./components";
import { SessionContext } from "./hooks";
import {
  DashboardPage,
  PlanPage,
  VocabularyPage,
  HistoryPage,
  ErrorsPage,
  SettingsPage,
} from "./pages";
import { LibraryPage, ExamPage, PlacementPage, LearningPage } from "./Learning";
import { DuoPlanPage, DuoAssessmentPage, DuoRoomPage } from "./Duo";
import { initializeExamIntegrity, observeExamRoute } from "./ExamIntegrity";

const links = [
  ["/dashboard", "Tổng quan", LayoutDashboard],
  ["/library", "Kho bài tập", LibraryBig],
  ["/exams", "Thi thử IELTS", ClipboardCheck],
  ["/placement", "Kiểm tra đầu vào", Compass],
  ["/plan", "Lộ trình của hai người", RouteIcon],
  ["/vocabulary", "Sổ từ vựng", Layers],
  ["/history", "Lịch sử học", History],
  ["/errors", "Sổ lỗi thường gặp", NotebookPen],
  ["/settings", "Cài đặt", Settings],
] as const;
export default function App() {
  const [user, setUser] = useState<Profile | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [menu, setMenu] = useState(false);
  const location = useLocation();
  useEffect(() => {
    observeExamRoute(`${location.pathname}${location.search}`);
  }, [location.pathname, location.search]);
  useEffect(() => {
    initializeExamIntegrity(user?.id || "");
  }, [user?.id]);
  useEffect(() => {
    setMenu(false);
    window.scrollTo({ top: 0 });
  }, [location.pathname]);
  async function bootstrap() {
    setLoading(true);
    setError("");
    try {
      const [session, status] = await Promise.all([
        api<{ user: Profile | null }>("/auth/me"),
        api<Health>("/health"),
      ]);
      setUser(session.user);
      setHealth(status);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Không thể kết nối máy chủ.",
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void bootstrap();
  }, []);
  async function refresh() {
    const result = await api<{ user: Profile | null }>("/auth/me");
    setUser(result.user);
  }
  async function logout() {
    try {
      await api("/auth/logout", { method: "POST" });
      setUser(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể đăng xuất.");
    }
  }
  if (loading)
    return (
      <div className="boot-screen">
        <Logo />
        <Loading text="Đang chuẩn bị không gian học của bạn…" />
      </div>
    );
  if (!user)
    return (
      <AuthPage
        health={health}
        setUser={setUser}
        error={error}
        retry={bootstrap}
      />
    );
  return (
    <SessionContext.Provider value={{ user, health, setUser, refresh }}>
      <div className="app-layout">
        <header className="mobile-bar">
          <Link to="/dashboard">
            <Logo />
          </Link>
          <button
            aria-label={menu ? "Đóng menu" : "Mở menu"}
            aria-expanded={menu}
            className="icon-button"
            onClick={() => setMenu(!menu)}
          >
            {menu ? <X /> : <Menu />}
          </button>
        </header>
        {menu && (
          <button
            className="menu-overlay"
            aria-label="Đóng menu"
            onClick={() => setMenu(false)}
          />
        )}
        <aside className={`sidebar ${menu ? "open" : ""}`}>
          <Link to="/dashboard" className="brand-link">
            <Logo />
          </Link>
          <p className="sidebar-caption">BÀN ĐIỀU HÀNH CHIẾN DỊCH</p>
          <nav aria-label="Điều hướng chính">
            {links.map(([path, label, Icon]) => (
              <NavLink
                key={path}
                to={path}
                className={({ isActive }) =>
                  `nav-item ${isActive ? "active" : ""}`
                }
              >
                <Icon size={19} />
                <span>{label}</span>
                {path === "/placement" && <span className="nav-dot" />}
              </NavLink>
            ))}
          </nav>
          <div className="sidebar-goal">
            <Sparkles size={20} />
            <p>Mục tiêu chung</p>
            <strong>Band {user.targetBand.toFixed(1)}</strong>
            <Link to="/plan">
              Xem lộ trình <ArrowUpRight size={15} />
            </Link>
          </div>
          <div className="sidebar-user">
            <div className="avatar">
              {user.name.split(" ").at(-1)?.[0]?.toUpperCase() || "H"}
            </div>
            <div>
              <strong>{user.name}</strong>
              <small>{"Thành viên Duo"}</small>
            </div>
            <button
              className="icon-button"
              aria-label="Đăng xuất"
              onClick={() => void logout()}
            >
              <LogOut size={18} />
            </button>
          </div>
        </aside>
        <main className="main-content">
          <div className="topbar">
            <span className="topbar-note">
              <span className="status-dot" />
              Không gian học của hai người
            </span>
            <div className="topbar-right">
              <span className="element-pair" aria-label="Phong cách Hỏa và Mộc">
                <Flame size={14} /> Hỏa <span>·</span> <Trees size={14} /> Mộc
              </span>
              <span>
                {user.testType === "academic"
                  ? "IELTS Academic"
                  : "IELTS General Training"}
              </span>
              <Link
                to="/settings"
                className="avatar small"
                aria-label="Hồ sơ của bạn"
              >
                {user.name.split(" ").at(-1)?.[0]?.toUpperCase()}
              </Link>
            </div>
          </div>
          {error && <ErrorNotice message={error} retry={() => setError("")} />}
          <div className="page-content">
            <Routes>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/library" element={<LibraryPage />} />
              <Route path="/exams" element={<ExamPage />} />
              <Route path="/placement" element={<PlacementPage />} />
              <Route path="/learn/:attemptId" element={<LearningPage />} />
              <Route
                path="/plan"
                element={
                  health?.duoEnabled === false ? <PlanPage /> : <DuoPlanPage />
                }
              />
              <Route
                path="/duo/assessments/:assessmentId"
                element={<DuoAssessmentPage />}
              />
              <Route path="/duo/rooms/:roomId" element={<DuoRoomPage />} />
              <Route path="/vocabulary" element={<VocabularyPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/errors" element={<ErrorsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </div>
          <footer className="site-footer">
            IELTS AI · Học có mục tiêu, tiến bộ có dữ liệu.
            <span>
              Điểm band là ước lượng luyện tập, không phải kết quả IELTS chính
              thức.
            </span>
          </footer>
        </main>
      </div>
    </SessionContext.Provider>
  );
}
function Logo() {
  return (
    <span className="brand">
      <span className="brand-mark">
        <Flame size={23} strokeWidth={2} />
        <Trees size={16} strokeWidth={2} />
      </span>
      <span>
        IELTS<span className="brand-ai"> AI</span>
        <small>ĐỒNG HÀNH CHINH PHỤC</small>
      </span>
    </span>
  );
}
function AuthPage({
  health,
  setUser,
  error,
  retry,
}: {
  health: Health | null;
  setUser: (user: Profile) => void;
  error: string;
  retry: () => void;
}) {
  if (health?.duoEnabled === false)
    return (
      <LegacyAuthPage
        health={health}
        setUser={setUser}
        error={error}
        retry={retry}
      />
    );
  return <DuoAuthPage setUser={setUser} error={error} retry={retry} />;
}
function DuoAuthPage({
  setUser,
  error,
  retry,
}: {
  setUser: (user: Profile) => void;
  error: string;
  retry: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setLocalError("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await api<{ user: Profile }>("/auth/login", {
        method: "POST",
        body: json({
          phone: String(form.get("phone")).trim(),
          password: String(form.get("password")),
        }),
      });
      setUser(result.user);
    } catch (cause) {
      setLocalError(
        cause instanceof Error ? cause.message : "Không thể đăng nhập.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-layout">
      <section className="auth-story">
        <Logo />
        <div className="auth-story-content">
          <div className="pill">
            <Sparkles size={16} /> TWO LEARNERS. ONE JOURNEY.
          </div>
          <h1>
            Cùng nhau tiến bộ.
            <br />
            <em>Cùng chạm band 8.0.</em>
          </h1>
          <p>
            Một mục tiêu chung, hai nhịp học riêng. Tích lũy từng ngày và cùng
            bước lên band tiếp theo.
          </p>
          <div className="auth-feature">
            <Check /> Lộ trình chung từ kết quả đầu vào của cả hai
          </div>
          <div className="auth-feature">
            <Check /> Kho bài tập và thi thử luôn có thể học riêng
          </div>
          <div className="auth-feature">
            <Check /> Cùng tham gia kỳ thi nâng band
          </div>
          <LearningIllustration />
        </div>
        <div className="auth-story-footer">
          <ShieldCheck size={17} /> Bài làm và câu trả lời được lưu riêng cho
          từng người
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-box">
          <p className="eyebrow">HÀNH TRÌNH IELTS CỦA HAI NGƯỜI</p>
          <h2>Chào mừng bạn trở lại.</h2>
          <p className="muted">
            Đăng nhập bằng số điện thoại để tiếp tục hành trình Duo.
          </p>
          {(error || localError) && (
            <ErrorNotice
              message={localError || error}
              retry={error ? retry : undefined}
            />
          )}
          <form
            className="stack auth-form"
            onSubmit={(event) => void submit(event)}
          >
            <label className="field">
              Số điện thoại
              <input
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="username"
                required
                maxLength={20}
                placeholder="Nhập số điện thoại của bạn"
              />
            </label>
            <label className="field">
              Mật khẩu
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                minLength={1}
                maxLength={128}
                required
                placeholder="Nhập mật khẩu của bạn"
              />
            </label>
            <Button disabled={busy} type="submit" className="full">
              {busy ? "Đang đăng nhập…" : "Đăng nhập"}
              <ArrowUpRight size={18} />
            </Button>
          </form>
          <p className="auth-demo-note">
            Không gian riêng dành cho hai thành viên đã được thiết lập.
          </p>
          <div className="auth-bottom">
            <Headphones size={17} />
            <span>Reading · Listening · Writing · Speaking</span>
          </div>
        </div>
      </section>
    </div>
  );
}
function LegacyAuthPage({
  health,
  setUser,
  error,
  retry,
}: {
  health: Health | null;
  setUser: (user: Profile) => void;
  error: string;
  retry: () => void;
}) {
  const [register, setRegister] = useState(false),
    [busy, setBusy] = useState(false),
    [localError, setLocalError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setLocalError("");
    const form = new FormData(event.currentTarget);
    const data = register
      ? {
          name: String(form.get("name")),
          email: String(form.get("email")),
          password: String(form.get("password")),
          targetBand: Number(form.get("targetBand")),
          testType: String(form.get("testType")),
          weeklyMinutes: 300,
          dailyMinutes: 45,
        }
      : {
          email: String(form.get("email")),
          password: String(form.get("password")),
        };
    try {
      setUser(
        (
          await api<{ user: Profile }>(
            `/auth/${register ? "register" : "login"}`,
            { method: "POST", body: json(data) },
          )
        ).user,
      );
    } catch (cause) {
      setLocalError(
        cause instanceof Error ? cause.message : "Không thể đăng nhập.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function demo(learner: 1 | 2) {
    setBusy(true);
    setLocalError("");
    try {
      setUser(
        (
          await api<{ user: Profile }>("/auth/demo", {
            method: "POST",
            body: json({ learner }),
          })
        ).user,
      );
    } catch (cause) {
      setLocalError(
        cause instanceof Error ? cause.message : "Không thể mở tài khoản mẫu.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-layout">
      <section className="auth-story">
        <Logo />
        <div className="auth-story-content">
          <div className="pill">
            <Sparkles size={16} />A little progress. Every day.
          </div>
          <h1>
            Mở cánh cửa mới.
            <br />
            <em>Bắt đầu với IELTS.</em>
          </h1>
          <p>
            Hiểu trình độ của bạn, luyện đúng điều cần luyện và biến từng buổi
            học thành một bước tiến.
          </p>
          <div className="auth-feature">
            <Check />
            Lộ trình cá nhân hóa từ bài kiểm tra đầu vào
          </div>
          <div className="auth-feature">
            <Check />
            Luyện 4 kỹ năng, từ vựng và ngữ pháp
          </div>
          <div className="auth-feature">
            <Check />
            Phản hồi AI khi kết nối dịch vụ chấm bài
          </div>
          <LearningIllustration />
        </div>
        <div className="auth-story-footer">
          <ShieldCheck size={17} />
          Dữ liệu học riêng biệt cho từng tài khoản
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-box">
          <p className="eyebrow">KHỞI ĐẦU HÀNH TRÌNH CỦA BẠN</p>
          <h2>
            {register
              ? "Một mục tiêu, một khởi đầu."
              : "Chào mừng bạn trở lại."}
          </h2>
          <p className="muted">
            {register
              ? "Tạo tài khoản để lưu tiến độ và lộ trình của riêng bạn."
              : "Tiếp tục hành trình đến band điểm bạn mong muốn."}
          </p>
          <div className="auth-tabs">
            <button
              className={!register ? "selected" : ""}
              onClick={() => {
                setRegister(false);
                setLocalError("");
              }}
            >
              Đăng nhập
            </button>
            <button
              className={register ? "selected" : ""}
              onClick={() => {
                setRegister(true);
                setLocalError("");
              }}
            >
              Tạo tài khoản
            </button>
          </div>
          {(error || localError) && (
            <ErrorNotice
              message={localError || error}
              retry={error ? retry : undefined}
            />
          )}
          <form
            className="stack auth-form"
            onSubmit={(event) => void submit(event)}
          >
            {register && (
              <label className="field">
                Tên của bạn
                <input
                  name="name"
                  autoComplete="name"
                  required
                  minLength={2}
                  maxLength={80}
                  placeholder="Nguyễn Minh Anh"
                />
              </label>
            )}
            <label className="field">
              Email
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="ban@example.com"
              />
            </label>
            <label className="field">
              Mật khẩu
              <input
                name="password"
                type="password"
                autoComplete={register ? "new-password" : "current-password"}
                minLength={register ? 10 : 1}
                maxLength={128}
                required
                placeholder={
                  register ? "Ít nhất 10 ký tự" : "Nhập mật khẩu của bạn"
                }
              />
            </label>
            {register && (
              <div className="grid-2">
                <label className="field">
                  Mục tiêu band
                  <select name="targetBand" defaultValue="6.5">
                    {[3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7].map((band) => (
                      <option key={band} value={band}>
                        {band.toFixed(1)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Hình thức thi
                  <select name="testType" defaultValue="academic">
                    <option value="academic">Academic</option>
                    <option value="general">General Training</option>
                  </select>
                </label>
              </div>
            )}
            <Button disabled={busy} type="submit" className="full">
              {busy ? "Đang xử lý…" : register ? "Tạo tài khoản" : "Đăng nhập"}
              <ArrowUpRight size={18} />
            </Button>
          </form>
          {health?.demoEnabled && (
            <>
              <div className="auth-divider">
                <span>hoặc trải nghiệm trước</span>
              </div>
              <div className="grid-2">
                <Button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void demo(1)}
                >
                  Học viên 01
                </Button>
                <Button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void demo(2)}
                >
                  Học viên 02
                </Button>
              </div>
              <p className="auth-demo-note">
                Tài khoản trải nghiệm lưu dữ liệu học riêng. Hãy tạo tài khoản
                để sử dụng lâu dài.
              </p>
            </>
          )}
          <div className="auth-bottom">
            <Headphones size={17} />
            <span>Reading · Listening · Writing · Speaking</span>
          </div>
        </div>
      </section>
    </div>
  );
}
export function LearningIllustration() {
  return (
    <img
      className="learning-illustration campaign-world"
      src="/assets/campaign-world.webp"
      width={1536}
      height={1024}
      alt=""
      decoding="async"
    />
  );
}
