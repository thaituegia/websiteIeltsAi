import type { ContentKind } from "./types";

export type DuoRole = "husband" | "wife";
export type DuoStatus =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "GATE_LOCKED"
  | "WAITING_FOR_PARTNER"
  | "BAND_EXAM_AVAILABLE"
  | "BAND_EXAM_IN_PROGRESS"
  | "WAITING_FOR_BAND_PASS"
  | "BAND_COMPLETED";
export type DuoResultStatus =
  | "in-progress"
  | "pending-ai"
  | "passed"
  | "failed";
export interface DuoMemberView {
  id: string;
  name: string;
  role: DuoRole;
  placementBand: number | null;
  personalEstimatedBand: number | null;
}
export interface DuoLessonView {
  id: string;
  number: number;
  title: string;
  kind: ContentKind | "vocabulary";
  contentId: string | null;
  vocabularyIds: string[];
  unlocked: boolean;
  completed: Record<DuoRole, boolean>;
  completedAt: Record<DuoRole, string | null>;
}
export interface DuoGateView {
  id: string;
  number: number;
  afterLesson: number;
  fromLesson: number;
  contentIds: string[];
  eligible: boolean;
  unlocked: boolean;
  results: Record<DuoRole, DuoResultStatus | null>;
  assessmentIds: Record<DuoRole, string | null>;
}
export interface DuoAssessmentPart {
  contentId: string;
  title: string;
  skill: ContentKind;
  attemptId: string | null;
  status: DuoResultStatus;
  scorePercent: number | null;
  estimatedBand: number | null;
  startsAt: string;
  deadlineAt: string;
}
export interface DuoAssessmentView {
  id: string;
  kind: "gate" | "promotion";
  band: number;
  gateId: string | null;
  roomId: string | null;
  status: DuoResultStatus;
  parts: DuoAssessmentPart[];
  passPercent: number;
  requiredBand: number;
  deadlineAt: string;
  createdAt: string;
  completedAt: string | null;
  invalidatedAt?: string;
  integrityReason?: string;
  integrity?: { sessionId?: string; status: "active" | "invalidated" | "completed"; reason?: string; replacementResourceId?: string };
  serverNow: string;
}
export interface DuoRoomMember {
  joined: boolean;
  present: boolean;
  ready: boolean;
  companion: boolean;
  lastSeenAt: string | null;
  assessmentId: string | null;
}
export interface DuoRoomView {
  id: string;
  band: number;
  status: "waiting" | "countdown" | "in-progress" | "completed" | "cancelled" | "invalidated";
  members: Record<DuoRole, DuoRoomMember>;
  serverNow: string;
  startsAt: string | null;
  deadlineAt: string | null;
  countdownSeconds: number;
  presenceTimeoutSeconds: number;
  /** True while a protected shared sitting still requires both documents. */
  requiresPresence?: boolean;
  invalidatedAt?: string;
  integrityReason?: string;
  integrity?: { sessionId?: string; status: "active" | "invalidated" | "completed"; reason?: string; replacementResourceId?: string };
}
export interface DuoBandView {
  band: number;
  unlocked: boolean;
  completed: boolean;
  lessons: DuoLessonView[];
  gates: DuoGateView[];
  promotionEligible: boolean;
  promotionResults: Record<DuoRole, DuoResultStatus | null>;
}
export interface DuoSnapshot {
  role: DuoRole;
  duoId: string;
  status: DuoStatus;
  path: {
    id: string;
    startingBand: number;
    currentBand: number;
    targetBand: number;
    gateInterval: 5 | 10;
    sessionsPerBand: number;
    passPercent: number;
    strictRetakeMode: boolean;
    startedAt: string;
  } | null;
  members: DuoMemberView[];
  bands: DuoBandView[];
  room: DuoRoomView | null;
  assessments: DuoAssessmentView[];
}

export interface DuoHistoryResult {
  assessments: DuoAssessmentView[];
  total: number;
  page: number;
  pageSize: number;
  serverNow: string;
}
