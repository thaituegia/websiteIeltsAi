export type ExamIntegrityKind = "attempt" | "placement" | "assessment";
export type ExamIntegrityReason = "hidden" | "page-exit" | "duplicate-tab" | "navigation" | "heartbeat-lost";
export interface ExamIntegrityState {
  sessionId?: string;
  status: "active" | "invalidated" | "completed";
  reason?: string;
  replacementResourceId?: string;
  phase?: "answering" | "grading";
}
export interface ExamIntegritySession {
  id: string;
  kind: ExamIntegrityKind;
  resourceId: string;
  status: "active" | "invalidated" | "completed";
  leaseSeconds: number;
  reason?: string;
  replacementResourceId?: string;
  phase?: "answering" | "grading";
}
