import { randomUUID } from "node:crypto";
import { MongoServerError, type Collection } from "mongodb";
import { ApiError } from "./errors";
import type { Database, UserRecord } from "./storage";
import type { ExamIntegrityKind, ExamIntegrityReason, ExamIntegritySession } from "../shared/exam-integrity";

export const EXAM_LEASE_SECONDS = 25;
export interface ExamTarget { kind: ExamIntegrityKind; resourceId: string; finished: boolean }
export interface ExamResetResult {
  affected?: { kind: ExamIntegrityKind; resourceId: string; userId: string }[];
  replacementResourceId?: string;
}
interface GuardRecord {
  _id: string; userId: string; kind: ExamIntegrityKind; resourceId: string;
  tabId: string; status: ExamIntegritySession["status"];
  phase: "answering" | "grading"; leaseUntil: number;
  createdAt: string; updatedAt: string; reason?: ExamIntegrityReason;
  replacementResourceId?: string; resetPending?: boolean;
}
export function requireExamTab(value: string | undefined): string {
  if (!value || !/^[A-Za-z0-9_-]{8,80}$/.test(value))
    throw new ApiError(400, "Cần mở bài trong một cửa sổ có chế độ giám sát. Hãy tải lại trang bắt đầu.");
  return value;
}
/** One answering document per learner. Mongo CAS and a partial unique index
 * arbitrate across app processes; only the server can create/renew a lease. */
export class ExamGuard {
  private sessions: Collection<GuardRecord>;
  private indexes?: Promise<unknown>;
  constructor(private database: Database, private now: () => number,
    private resolve: (user: UserRecord, kind: ExamIntegrityKind, id: string) => Promise<ExamTarget>,
    private reset: (user: UserRecord, target: ExamTarget, reason: ExamIntegrityReason) => Promise<ExamResetResult>) {
    this.sessions = database.db.collection("exam_integrity_sessions");
  }
  private initialize() {
    // Never add a collection/index on startup: offline upgrade verification
    // must see precisely the previous learner database until a new test starts.
    return this.indexes ??= Promise.all([
      this.sessions.createIndex({ userId: 1 }, { unique: true, partialFilterExpression: { status: "active" } }),
      this.sessions.createIndex({ userId: 1, kind: 1, resourceId: 1 }),
    ]);
  }
  private view(row: GuardRecord): ExamIntegritySession {
    return { id: row._id, kind: row.kind, resourceId: row.resourceId, status: row.status,
      leaseSeconds: row.phase === "grading" ? 1200 : EXAM_LEASE_SECONDS, phase: row.phase, ...(row.reason ? { reason: row.reason } : {}),
      ...(row.replacementResourceId ? { replacementResourceId: row.replacementResourceId } : {}) };
  }
  private async finish(row: GuardRecord): Promise<GuardRecord> {
    const updated = await this.sessions.findOneAndUpdate({ _id: row._id, status: "active" },
      { $set: { status: "completed", updatedAt: new Date(this.now()).toISOString() } }, { returnDocument: "after" });
    return updated ?? await this.sessions.findOne({ _id: row._id }) ?? row;
  }
  private async settle(user: UserRecord, row: GuardRecord): Promise<GuardRecord> {
    if (row.status === "invalidated" && row.resetPending) return this.invalidate(user, row, row.reason ?? "heartbeat-lost");
    if (row.status !== "active") return row;
    const target = await this.resolve(user, row.kind, row.resourceId);
    if (target.finished) return this.finish(row);
    if (row.leaseUntil <= this.now()) return this.invalidate(user, row, "heartbeat-lost");
    return row;
  }
  private async invalidate(user: UserRecord, row: GuardRecord, reason: ExamIntegrityReason): Promise<GuardRecord> {
    if (row.status === "completed") return row;
    if (row.status === "active") {
      const target = await this.resolve(user, row.kind, row.resourceId);
      if (target.finished) return this.finish(row);
      // Once the server has accepted final submission, browser dismissal does
      // not cancel asynchronous provider grading. Intermediate Duo parts stay guarded.
      if (row.phase === "grading" && row.leaseUntil > this.now()) return row;
      const claimed = await this.sessions.findOneAndUpdate({ _id: row._id, status: "active", phase: row.phase, leaseUntil: row.leaseUntil },
        { $set: { status: "invalidated", reason, resetPending: true, updatedAt: new Date(this.now()).toISOString() } }, { returnDocument: "after" });
      if (!claimed) return this.settle(user, await this.sessions.findOne({ _id: row._id }) ?? row);
      row = claimed;
    }
    if (!row.resetPending) return row;
    const result = await this.reset(user, { kind: row.kind, resourceId: row.resourceId, finished: false }, row.reason ?? reason);
    if (result.affected?.length) {
      await this.sessions.updateMany({ $or: result.affected.map(target => ({ userId: target.userId, kind: target.kind, resourceId: target.resourceId })) },
        { $set: { status: "invalidated", reason: row.reason ?? reason, resetPending: false, updatedAt: new Date(this.now()).toISOString() } });
    }
    await this.sessions.updateOne({ _id: row._id, status: "invalidated" }, { $set: { resetPending: false,
      ...(result.replacementResourceId ? { replacementResourceId: result.replacementResourceId } : {}) } });
    return await this.sessions.findOne({ _id: row._id }) ?? row;
  }
  async observe(user: UserRecord, tabId: string): Promise<void> {
    const row = await this.sessions.findOne({ userId: user.id, status: "active" });
    if (!row) return;
    const settled = await this.settle(user, row);
    if (settled.status === "active" && settled.tabId !== tabId)
      await this.invalidate(user, settled, "duplicate-tab");
  }
  async open(user: UserRecord, kind: ExamIntegrityKind, resourceId: string, tabId: string): Promise<ExamIntegritySession> {
    requireExamTab(tabId); const target = await this.resolve(user, kind, resourceId);
    const previous = await this.sessions.findOne({ userId: user.id, kind: target.kind, resourceId: target.resourceId }, { sort: { createdAt: -1 } });
    if (previous) {
      const row = await this.settle(user, previous);
      if (row.status === "active" && row.tabId !== tabId) return this.view(await this.invalidate(user, row, "duplicate-tab"));
      return this.view(row);
    }
    if (target.finished) return { id: "", kind: target.kind, resourceId: target.resourceId, status: "completed", leaseSeconds: EXAM_LEASE_SECONDS };
    const active = await this.sessions.findOne({ userId: user.id, status: "active" });
    if (active) {
      const row = await this.settle(user, active);
      if (row.status === "active") {
        const invalidated = await this.invalidate(user, row, row.tabId === tabId ? "navigation" : "duplicate-tab");
        if (invalidated.status === "active") throw new ApiError(409, "Hãy đợi lượt vừa nộp được lưu/chấm trước khi mở bài mới.");
        if (row.tabId !== tabId) throw new ApiError(409, "Đã phát hiện cửa sổ khác. Lượt trước bị hủy; hãy bắt đầu lại trong một cửa sổ.");
      }
    }
    await this.initialize();
    const row: GuardRecord = { _id: randomUUID(), userId: user.id, kind: target.kind, resourceId: target.resourceId, tabId,
      status: "active", phase: "answering", leaseUntil: this.now() + EXAM_LEASE_SECONDS * 1000,
      createdAt: new Date(this.now()).toISOString(), updatedAt: new Date(this.now()).toISOString() };
    try { await this.sessions.insertOne(row); }
    catch (error) {
      if (!(error instanceof MongoServerError) || error.code !== 11000) throw error;
      return this.open(user, kind, resourceId, tabId);
    }
    return this.view(row);
  }
  async current(user: UserRecord, id: string): Promise<ExamIntegritySession> {
    const row = await this.sessions.findOne({ _id: id, userId: user.id });
    if (!row) throw new ApiError(404, "Không tìm thấy phiên giám sát của bạn.");
    return this.view(await this.settle(user, row));
  }
  async heartbeat(user: UserRecord, id: string, tabId: string): Promise<ExamIntegritySession> {
    requireExamTab(tabId);
    const row = await this.sessions.findOne({ _id: id, userId: user.id });
    if (!row) throw new ApiError(404, "Không tìm thấy phiên giám sát của bạn.");
    const settled = await this.settle(user, row);
    if (settled.status !== "active") return this.view(settled);
    if (settled.tabId !== tabId) return this.view(await this.invalidate(user, settled, "duplicate-tab"));
    const updated = await this.sessions.findOneAndUpdate({ _id: id, userId: user.id, status: "active", tabId, phase: settled.phase,
      leaseUntil: { $gt: this.now() } }, { $set: { leaseUntil: this.now() + (settled.phase === "grading" ? 1200 : EXAM_LEASE_SECONDS) * 1000,
        updatedAt: new Date(this.now()).toISOString() } }, { returnDocument: "after" });
    if (updated) return this.view(updated);
    // A concurrent final submission can change the phase after settle(). Never
    // replace its lease using the previous phase, or return a stale active row.
    const current = await this.sessions.findOne({ _id: id, userId: user.id });
    if (!current) throw new ApiError(404, "Không tìm thấy phiên giám sát của bạn.");
    return this.view(await this.settle(user, current));
  }
  async violation(user: UserRecord, id: string, tabId: string, reason: ExamIntegrityReason): Promise<ExamIntegritySession> {
    requireExamTab(tabId);
    const row = await this.sessions.findOne({ _id: id, userId: user.id });
    if (!row) throw new ApiError(404, "Không tìm thấy phiên giám sát của bạn.");
    if (row.tabId !== tabId) throw new ApiError(403, "Cửa sổ này không sở hữu phiên giám sát.");
    return this.view(await this.invalidate(user, row, reason));
  }
  async assert(user: UserRecord, kind: ExamIntegrityKind, id: string, tabId: string): Promise<void> {
    requireExamTab(tabId); const target = await this.resolve(user, kind, id);
    const row = await this.sessions.findOne({ userId: user.id, kind: target.kind, resourceId: target.resourceId }, { sort: { createdAt: -1 } });
    if (!row) throw new ApiError(409, "Phiên giám sát chưa mở. Hãy quay lại màn hình làm bài.");
    const settled = await this.settle(user, row);
    if (settled.tabId !== tabId) {
      await this.invalidate(user, settled, "duplicate-tab");
      throw new ApiError(409, "Đã phát hiện cửa sổ khác; bài đã bị hủy.");
    }
    if (settled.status !== "active" && !target.finished)
      throw new ApiError(409, "Lượt đã bị hủy. Hãy bắt đầu bộ đề mới.");
  }
  async inspectResource(user: UserRecord, kind: ExamIntegrityKind, id: string): Promise<ExamIntegritySession | null> {
    const target = await this.resolve(user, kind, id);
    const row = await this.sessions.findOne({ userId: user.id, kind: target.kind, resourceId: target.resourceId }, { sort: { createdAt: -1 } });
    return row ? this.view(await this.settle(user, row)) : null;
  }
  async grading(user: UserRecord, kind: ExamIntegrityKind, id: string, enabled: boolean): Promise<void> {
    const target = await this.resolve(user, kind, id);
    const now = this.now();
    const updated = await this.sessions.updateOne({ userId: user.id, kind: target.kind, resourceId: target.resourceId, status: "active",
      ...(enabled ? { leaseUntil: { $gt: now } } : {}) },
      { $set: { phase: enabled ? "grading" : "answering", leaseUntil: now + (enabled ? 1200 : EXAM_LEASE_SECONDS) * 1000 } });
    if (enabled && !updated.matchedCount) throw new ApiError(409, "Lượt đã bị hủy trước khi chấm bài.");
  }
}
