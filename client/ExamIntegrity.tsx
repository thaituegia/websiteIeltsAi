import { useEffect, useState } from "react";
import { ShieldCheck, AlertTriangle } from "lucide-react";
import { api, json } from "./api";
import { Button, Card, Modal } from "./components";
import { examTabId as tabId } from "./examTransport";
import type { ExamIntegrityKind as ExamKind, ExamIntegrityReason as ViolationReason, ExamIntegritySession } from "../shared/exam-integrity";
import type { DuoRoomView } from "../shared/duo";
export type { ExamIntegritySession } from "../shared/exam-integrity";
export { examHeaders } from "./examTransport";
interface MonitorState {
  session: ExamIntegritySession | null;
  error: string;
  openingKey: string;
  room: { id: string; status: DuoRoomView["status"]; requiresPresence: boolean; invalidated: boolean; reason?: string; serverNow: string } | null;
}

// A reload is a new document, and must never inherit the previous exam lease.
let ownerId = "";
let monitor: MonitorState = { session: null, error: "", openingKey: "", room: null };
let channel: BroadcastChannel | null = null;
let initialized = false;
let lastHeartbeat = 0;
let heartbeatPendingSession: string | null = null;
let submitting = false;
let currentRoute = "";
const allowedAttempts = new Map<string, Set<string>>();
const roomRoutes = new Map<string, { assessments: Set<string>; attempts: Set<string> }>();
const roomLoading = new Map<string, Promise<void>>();
let roomHeartbeatPending: string | null = null;
let lastRoomHeartbeat = 0;
const listeners = new Set<() => void>();
const opening = new Map<string, Promise<ExamIntegritySession>>();
const storageKey = "ielts-exam-tab-event";

function publish(next: Partial<MonitorState>) {
  monitor = { ...monitor, ...next };
  for (const listener of listeners) listener();
}
function announce(type: "hello" | "peer" | "exam-start") {
  if (!ownerId) return;
  const event = { type, tabId, ownerId, nonce: crypto.randomUUID() };
  if (channel) channel.postMessage(event);
  else {
    try { localStorage.setItem(storageKey, JSON.stringify(event)); }
    catch { /* The server lease still protects against concurrent exam writes. */ }
  }
}
function receive(value: unknown) {
  if (!value || typeof value !== "object") return;
  const event = value as { type?: string; tabId?: string; ownerId?: string };
  if (!event.tabId || event.tabId === tabId || !ownerId || event.ownerId !== ownerId) return;
  if (event.type === "hello" || event.type === "exam-start") announce("peer");
  if (["hello", "peer", "exam-start"].includes(event.type || ""))
    violate("duplicate-tab");
}
function reportViolation(session: ExamIntegritySession, reason: ViolationReason) {
  const url = `/api/exam-integrity/${encodeURIComponent(session.id)}/violation`;
  const body = json({ tabId, reason });
  // Beacon includes same-origin cookies and continues during document teardown.
  if (navigator.sendBeacon?.(url, new Blob([body], { type: "application/json" }))) return;
  void fetch(url, {
    method: "POST", credentials: "include", keepalive: true,
    headers: { "Content-Type": "application/json" }, body,
  }).catch(() => undefined);
}
function roomRouteAllowed(roomId: string, route: string) {
  const url = new URL(route || window.location.href, window.location.origin);
  const allowed = roomRoutes.get(roomId);
  if (url.pathname === `/duo/rooms/${roomId}`) return true;
  if (url.pathname.startsWith("/duo/assessments/")) return !!allowed?.assessments.has(url.pathname.slice("/duo/assessments/".length));
  return url.pathname.startsWith("/learn/") && (
    !!allowed?.attempts.has(url.pathname.slice("/learn/".length)) ||
    !!allowed?.assessments.has(url.searchParams.get("duoAssessment") || "")
  );
}
function violateRoom(reason: ViolationReason) {
  const room = monitor.room;
  if (!room?.requiresPresence || room.invalidated) return;
  publish({ room: { ...room, invalidated: true, requiresPresence: false, reason } });
  const url = `/api/duo/rooms/${encodeURIComponent(room.id)}/leave`;
  const body = json({ reason, tabId });
  if (reason === "page-exit" && navigator.sendBeacon?.(url, new Blob([body], { type: "application/json" }))) return;
  // A response can confirm that both final submissions were already accepted
  // just before the browser event, preserving valid results in that race.
  void fetch(url, {
    method: "POST", credentials: "include", keepalive: true,
    headers: { "Content-Type": "application/json" }, body,
  }).then(async response => {
    if (!response.ok) return;
    const result = await response.json() as { room?: DuoRoomView };
    if (result.room && monitor.room?.id === room.id && !result.room.requiresPresence &&
        !isExamInvalidated(result.room) && result.room.status !== "cancelled")
      updateSharedRoom(result.room, undefined, undefined, true);
  }).catch(() => undefined);
}
function violate(reason: ViolationReason) {
  violateRoom(reason);
  const session = monitor.session;
  if (!session || session.status !== "active" || session.phase === "grading" || submitting) return;
  publish({ session: { ...session, status: "invalidated", reason }, error: "" });
  reportViolation(session, reason);
}
function routeAllowed(session: ExamIntegritySession, route: string) {
  const url = new URL(route || window.location.href, window.location.origin);
  if (session.kind === "placement") return url.pathname === "/placement" && !url.searchParams.has("review");
  if (session.kind === "attempt") return url.pathname === `/learn/${session.resourceId}`;
  if (url.pathname === `/duo/assessments/${session.resourceId}`) return true;
  for (const [roomId, routes] of roomRoutes)
    if (routes.assessments.has(session.resourceId) && url.pathname === `/duo/rooms/${roomId}`) return true;
  return url.pathname.startsWith("/learn/") && (
    allowedAttempts.get(session.resourceId)?.has(url.pathname.slice("/learn/".length)) ||
    url.searchParams.get("duoAssessment") === session.resourceId
  );
}
export function observeExamRoute(route: string) {
  currentRoute = route;
  if (monitor.room?.requiresPresence && !roomRouteAllowed(monitor.room.id, route)) violateRoom("navigation");
  if (monitor.session?.status === "active" && !routeAllowed(monitor.session, route)) violate("navigation");
}
export function initializeExamIntegrity(userId: string) {
  if (ownerId && ownerId !== userId) violate("navigation");
  ownerId = userId;
  if (!initialized) {
    initialized = true;
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel("ielts-exam-integrity");
      channel.onmessage = event => receive(event.data);
    }
    window.addEventListener("storage", event => {
      if (event.key !== storageKey || !event.newValue) return;
      try { receive(JSON.parse(event.newValue)); } catch { /* Ignore unrelated storage. */ }
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") violate("hidden");
    });
    window.addEventListener("pagehide", () => violate("page-exit"));
    window.addEventListener("beforeunload", () => violate("page-exit"));
    window.setInterval(() => { void heartbeat(); void roomHeartbeat(); }, 5000);
  }
  announce("hello");
}
function registerRoomRoutes(roomId: string, assessmentId?: string, attemptId?: string) {
  const routes = roomRoutes.get(roomId) || { assessments: new Set<string>(), attempts: new Set<string>() };
  if (assessmentId) routes.assessments.add(assessmentId);
  if (attemptId) routes.attempts.add(attemptId);
  roomRoutes.set(roomId, routes);
}
export function updateSharedRoom(room: DuoRoomView, assessmentId?: string, attemptId?: string, authoritative = false, heartbeatAck = false) {
  registerRoomRoutes(room.id, assessmentId, attemptId);
  if (monitor.room?.id === room.id && Date.parse(monitor.room.serverNow) > Date.parse(room.serverNow)) return;
  if (monitor.room?.id === room.id && monitor.room.invalidated && !authoritative && !isExamInvalidated(room)) return;
  const activated = room.requiresPresence && (!monitor.room?.requiresPresence || monitor.room.id !== room.id);
  if (heartbeatAck || activated || monitor.room?.id !== room.id) lastRoomHeartbeat = Date.now();
  publish({ room: {
    id: room.id, status: room.status, requiresPresence: !!room.requiresPresence,
    invalidated: isExamInvalidated(room), reason: room.integrityReason, serverNow: room.serverNow,
  } });
  if (room.requiresPresence) {
    if (document.visibilityState === "hidden") violateRoom("hidden");
    else if (!roomRouteAllowed(room.id, currentRoute)) violateRoom("navigation");
    if (activated) announce("exam-start");
  }
}
export function connectSharedRoom(roomId: string, assessmentId?: string, attemptId?: string) {
  registerRoomRoutes(roomId, assessmentId, attemptId);
  if (monitor.room?.id === roomId || roomLoading.has(roomId)) return;
  const request = api<{ room: DuoRoomView }>(`/duo/rooms/${encodeURIComponent(roomId)}`)
    .then(result => { updateSharedRoom(result.room, assessmentId, attemptId); })
    .catch(() => undefined).finally(() => { roomLoading.delete(roomId); });
  roomLoading.set(roomId, request);
}
async function roomHeartbeat() {
  const room = monitor.room;
  if (!room || room.invalidated || ["completed", "cancelled", "invalidated"].includes(room.status) ||
      document.visibilityState === "hidden" || !roomRouteAllowed(room.id, currentRoute)) return;
  if (room.requiresPresence && Date.now() - lastRoomHeartbeat >= 25_000) { violateRoom("heartbeat-lost"); return; }
  // Visible members retain presence during grading, so a provider failure can
  // restore answering without treating that legitimate wait as a departure.
  if (roomHeartbeatPending === room.id) return;
  roomHeartbeatPending = room.id;
  try {
    const result = await api<{ room: DuoRoomView }>(`/duo/rooms/${encodeURIComponent(room.id)}/heartbeat`, { method: "POST" });
    if (monitor.room?.id !== room.id || monitor.room.invalidated) return;
    updateSharedRoom(result.room, undefined, undefined, false, true);
  } catch { /* The presence watchdog also covers a request that never returns. */ }
  finally { if (roomHeartbeatPending === room.id) roomHeartbeatPending = null; }
}
export function useSharedRoomIntegrity(roomId?: string | null, assessmentId?: string | null) {
  const [state, setState] = useState(monitor);
  useEffect(() => {
    const update = () => setState(monitor);
    listeners.add(update); update();
    return () => { listeners.delete(update); };
  }, []);
  const room = state.room && ((roomId && state.room.id === roomId) ||
    (assessmentId && roomRoutes.get(state.room.id)?.assessments.has(assessmentId))) ? state.room : null;
  return { room, invalidated: !!room?.invalidated, requiresPresence: !!room?.requiresPresence };
}
async function heartbeat() {
  const session = monitor.session;
  if (!session || session.status !== "active" || submitting) return;
  if (session.phase !== "grading" && Date.now() - lastHeartbeat >= session.leaseSeconds * 1000) {
    violate("heartbeat-lost");
    return;
  }
  if (heartbeatPendingSession === session.id) return;
  heartbeatPendingSession = session.id;
  try {
    const result = await api<{ session: ExamIntegritySession }>(`/exam-integrity/${encodeURIComponent(session.id)}/heartbeat`, {
      method: "POST", body: json({ tabId }),
    });
    if (monitor.session?.id !== session.id || monitor.session.status !== "active") return;
    lastHeartbeat = Date.now();
    publish({ session: result.session, error: "" });
    if (result.session.status === "active" && result.session.phase !== "grading") {
      if (document.visibilityState === "hidden") violate("hidden");
      else if (!routeAllowed(result.session, currentRoute)) violate("navigation");
    }
  } catch {
    if (session.phase !== "grading" && Date.now() - lastHeartbeat >= session.leaseSeconds * 1000) violate("heartbeat-lost");
  } finally {
    if (heartbeatPendingSession === session.id) heartbeatPendingSession = null;
  }
}
export async function openExamIntegrity(kind: ExamKind, resourceId: string, attemptId?: string) {
  if (kind === "assessment" && attemptId) {
    const attempts = allowedAttempts.get(resourceId) || new Set<string>();
    attempts.add(attemptId);
    allowedAttempts.set(resourceId, attempts);
  }
  const key = `${kind}:${resourceId}`;
  if (monitor.session?.kind === kind && monitor.session.resourceId === resourceId) return monitor.session;
  const pending = opening.get(key);
  if (pending) return pending;
  publish({ openingKey: key, error: "" });
  const request = api<{ enabled: boolean; session: ExamIntegritySession | null }>("/exam-integrity/open", {
    method: "POST", body: json({ kind, resourceId, tabId }),
  }).then(result => {
    if (!result.session) {
      publish({ openingKey: "", error: "" });
      throw new Error("Giám sát bài thi chưa được bật.");
    }
    lastHeartbeat = Date.now();
    submitting = false;
    publish({ session: result.session, openingKey: "", error: "" });
    if (document.visibilityState === "hidden") violate("hidden");
    else if (!routeAllowed(result.session, currentRoute || window.location.href)) violate("navigation");
    announce("exam-start");
    return result.session;
  }).catch(cause => {
    publish({ openingKey: "", error: cause instanceof Error ? cause.message : "Không thể xác nhận phiên thi." });
    throw cause;
  }).finally(() => opening.delete(key));
  opening.set(key, request);
  return request;
}
export function completeExamIntegrity(kind: ExamKind, resourceId: string) {
  if (monitor.session?.kind === kind && monitor.session.resourceId === resourceId && monitor.session.status === "active") {
    submitting = false;
    publish({ session: { ...monitor.session, status: "completed" } });
  }
}
export function isExamInvalidated(value: unknown) {
  const resource = value as { status?: string; completionReason?: string; invalidatedAt?: string; integrity?: { status?: string } } | null | undefined;
  return resource?.status === "invalidated" || resource?.completionReason === "invalidated" || !!resource?.invalidatedAt || resource?.integrity?.status === "invalidated";
}
// Once the final answer is sent, the server owns completion and AI processing.
export function beginExamSubmission(kind: ExamKind, resourceId: string) {
  if (monitor.session?.kind === kind && monitor.session.resourceId === resourceId) submitting = true;
}
export async function resumeExamSubmission() {
  // The final submission response acknowledges the server's grading phase.
  const wasSubmitting = submitting;
  if (wasSubmitting) {
    const session = monitor.session;
    if (session?.status === "active") {
      try {
        const result = await api<{ session: ExamIntegritySession }>(`/exam-integrity/${encodeURIComponent(session.id)}`);
        if (monitor.session?.id === session.id && monitor.session.status === "active")
          publish({ session: result.session });
      } catch { /* Restore monitoring below if the server cannot confirm completion. */ }
    }
    lastHeartbeat = Date.now();
  }
  submitting = false;
  if (!wasSubmitting) await heartbeat();
  if (document.visibilityState === "hidden") violate("hidden");
  else if (monitor.session?.status === "active" && !routeAllowed(monitor.session, currentRoute)) violate("navigation");
}
export function useExamIntegrity(kind: ExamKind, resourceId: string | undefined, active: boolean, attemptId?: string, completed = false) {
  const [state, setState] = useState(monitor);
  useEffect(() => {
    const update = () => setState(monitor);
    listeners.add(update); update();
    return () => { listeners.delete(update); };
  }, []);
  useEffect(() => {
    if (!resourceId) return;
    if (active) void openExamIntegrity(kind, resourceId, attemptId).catch(() => undefined);
    else if (completed) completeExamIntegrity(kind, resourceId);
  }, [kind, resourceId, active, attemptId, completed]);
  const session = state.session?.kind === kind && state.session.resourceId === resourceId ? state.session : null;
  return {
    session,
    ready: !active || (session?.status === "active" && session.phase !== "grading"),
    invalidated: session?.status === "invalidated",
    error: state.error,
    retry: () => resourceId && openExamIntegrity(kind, resourceId, attemptId).catch(() => undefined),
  };
}

export function ExamRules({ compact = false }: { compact?: boolean }) {
  return <div className={`exam-integrity-rules ${compact ? "compact" : ""}`} data-testid={compact ? "exam-integrity-active" : "exam-integrity-rules"}>
    <ShieldCheck size={22} aria-hidden="true" />
    <div><strong>{compact ? "Phiên thi đang được giám sát" : "Giữ bài thi trong một tab duy nhất"}</strong>
      <p>Rời bài thi, đổi tab, tải lại, đóng trang hoặc mở thêm trang của ứng dụng sẽ hủy toàn bộ lượt thi. Câu trả lời bị xóa; lượt mới dùng bộ câu hỏi khác.</p>
      {!compact && <p className="muted tiny">Trình duyệt phát hiện khi trang thi bị ẩn và khi mở thêm trang của ứng dụng. Trình duyệt không cho ứng dụng biết mọi tab hay chương trình khác đang mở; hãy tự tuân thủ quy định. Hộp cấp quyền microphone và chọn tệp không hủy bài nếu trang vẫn hiển thị.</p>}
    </div>
  </div>;
}
export function ExamStartDialog({ onStart, onClose, busy = false }: { onStart: () => void; onClose: () => void; busy?: boolean }) {
  return <Modal title="Quy định phòng thi" onClose={onClose}>
    <ExamRules />
    <div className="row wrap"><Button disabled={busy} onClick={onStart}>Tôi hiểu, bắt đầu bài thi</Button><Button className="secondary" disabled={busy} onClick={onClose}>Quay lại</Button></div>
  </Modal>;
}
export function InvalidatedExam({ onRestart, href, busy = false }: { onRestart?: () => void; href?: string; busy?: boolean }) {
  return <Card className="exam-integrity-invalidated">
    <AlertTriangle size={34} aria-hidden="true" /><h2>Bài thi đã bị hủy</h2>
    <p>Phiên thi đã kết thúc vì rời trang, đổi tab, mở thêm trang hoặc mất kết nối giám sát. Toàn bộ câu trả lời đã bị xóa. Bài bị hủy không có điểm, đáp án hoặc phản hồi.</p>
    <p>Bắt đầu lượt mới để nhận bộ câu hỏi khác.</p>
    {onRestart && <Button disabled={busy} onClick={onRestart}>Bắt đầu lượt mới</Button>}
    {href && <a className="button" href={href}>Bắt đầu lượt mới</a>}
  </Card>;
}
