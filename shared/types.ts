export type Skill = "reading" | "listening" | "writing" | "speaking";
export type ContentKind = Skill | "grammar";
export type Cefr = "A2" | "B1" | "B2" | "C1";
export type TestType = "academic" | "general";
export type Mode = "practice" | "exam";
export type QuestionType =
  | "choice"
  | "true-false"
  | "yes-no"
  | "text"
  | "matching"
  | "choice-multiple";

/** IELTS task labels are separate from the input widget and scoring rule. */
export type IeltsQuestionType =
  | "multiple-choice"
  | "multiple-choice-multiple"
  | "matching"
  | "plan-labelling"
  | "map-labelling"
  | "diagram-labelling"
  | "form-completion"
  | "note-completion"
  | "table-completion"
  | "flow-chart-completion"
  | "summary-completion"
  | "sentence-completion"
  | "short-answer"
  | "matching-headings"
  | "matching-information"
  | "matching-features"
  | "matching-sentence-endings"
  | "true-false-not-given"
  | "yes-no-not-given";

export interface ChartVisual {
  id: string;
  type: "bar" | "line" | "pie" | "table";
  title: string;
  description?: string;
  rows: { label: string; values: number[] }[];
  series: string[];
  unit: string;
  xLabel?: string;
  yLabel?: string;
}
export interface VisualLabel {
  id: string;
  x: number;
  y: number;
  /** A fixed landmark, or a blank question number, never both. */
  text?: string;
  questionNumber?: number;
}
export interface SpatialVisual {
  id: string;
  type: "map" | "plan" | "process" | "diagram";
  title: string;
  description?: string;
  width: number;
  height: number;
  areas?: {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    fill?: string;
  }[];
  paths?: {
    id: string;
    points: [number, number][];
    style?: "path" | "road" | "river";
  }[];
  labels: VisualLabel[];
  nodes?: (VisualLabel & { width: number; height: number })[];
  connections?: { from: string; to: string; label?: string }[];
}
/** Mixed tasks carry two or more typed assets; no raw SVG or HTML is stored. */
export type VisualAsset = ChartVisual | SpatialVisual;

export interface QuestionBlock {
  id: string;
  type: "form" | "note" | "table" | "flow-chart" | "summary" | "sentence";
  title: string;
  instructions: string;
  questionNumbers: number[];
  /** Numbered blanks use {{12}} and reference the actual question number. */
  text?: string;
  rows?: { label?: string; cells: string[] }[];
}

export interface Profile {
  id: string;
  name: string;
  email: string;
  phone?: string;
  duoRole?: "husband" | "wife";
  duoId?: string;
  demo: boolean;
  currentBand: number | null;
  personalEstimatedBand?: number | null;
  targetBand: number;
  testType: TestType;
  examDate: string | null;
  weeklyMinutes: number;
  dailyMinutes: number;
  cefr: Cefr | null;
  createdAt: string;
  selfAssessment?: Partial<Record<Skill, number | null>>;
}
export interface Question {
  id: string;
  number: number;
  type: QuestionType;
  prompt: string;
  options?: string[];
  wordLimit?: number;
  /** Allows at most one numeric token in addition to the stated word limit. */
  allowNumbers?: boolean;
  sectionIndex: number;
  subskill: string;
  questionType?: IeltsQuestionType;
  /** Each group has count distinct numbered rows and one answer key per row. */
  selectionGroup?: { id: string; count: number };
  groupInstructions?: string;
  visualId?: string;
  blockId?: string;
}
export interface StoredQuestion extends Question {
  answer: string;
  acceptedAnswers?: string[];
  explanation: string;
  evidence: string;
}
export interface DialogueLine {
  speaker: string;
  accent: "british" | "american" | "australian";
  text: string;
}
export interface ContentSection {
  id: string;
  title: string;
  text: string;
  dialogue?: DialogueLine[];
  task?: 1 | 2;
  instructions?: string;
  chart?: { label: string; values: number[] }[];
  chartSeries?: string[];
  chartUnit?: string;
  chartType?: "bar" | "line" | "pie" | "table";
  visuals?: VisualAsset[];
  questionBlocks?: QuestionBlock[];
  cuePoints?: string[];
}
export interface ContentItem {
  id: string;
  skill: ContentKind;
  title: string;
  description: string;
  topic: string;
  band: number;
  cefr: Cefr;
  testType: TestType | "both";
  durationMinutes: number;
  format: "lesson" | "full-mock";
  questions: Question[];
  sections: ContentSection[];
  vocabularyIds: string[];
  tags: string[];
  source: "authored" | "ai";
  quality: "authored-unreviewed" | "ai-unreviewed";
  createdAt: string;
  estimatedDifficulty?: { band: number; cefr: Cefr; basis: string };
  objectives?: string[];
  errorTypes?: string[];
  provenance?: {
    method: "ai-assisted" | "authored" | "legacy";
    version: string;
    sourceDocument?: string;
    generatedAt?: string;
  };
  review?: {
    status: "structural-checks-passed" | "unreviewed";
    checks: string[];
    limitations: string[];
  };
}
export interface StoredContent extends Omit<ContentItem, "questions"> {
  questions: StoredQuestion[];
  /** Stored answer material; disclosed only in a completed attempt's feedback. */
  referenceAnswers?: ReferenceResponse[];
}
/** An illustrative response, not a unique answer key or an examiner-scored band. */
export interface ReferenceResponse {
  sectionId: string;
  title: string;
  sampleAnswer: string;
  explanation: string;
  keyPoints: string[];
  responses?: {
    prompt: string;
    sampleAnswer: string;
    explanation?: string;
  }[];
}
export interface VocabularyEntry {
  id: string;
  word: string;
  meaning: string;
  definition: string;
  partOfSpeech: string;
  ipa: string;
  cefr: Cefr;
  topic: string;
  collocations: string[];
  examples: string[];
  family: string[];
  commonError: string;
  synonyms: string[];
  register: "neutral" | "academic" | "informal";
}
export interface VocabularyCard {
  id: string;
  vocabularyId: string | null;
  word: string;
  meaning: string;
  example: string;
  cefr: Cefr;
  topic: string;
  difficulty: number;
  stability: number;
  retrievability: number;
  dueAt: string;
  reps: number;
  due: boolean;
  savedAt: string;
  /** Captured during a lesson/exam; its meaning is resolved after submission. */
  meaningStatus?: "pending" | "ready";
  origin?: WordOrigin;
  translationSource?: WordTranslation["source"];
  translationContext?: string;
  definition?: string;
  partOfSpeech?: string;
  /** Optional pronunciation metadata; older saved cards remain compatible. */
  ipa?: string;
  ipaSource?: WordPronunciation["source"];
}
export interface WordOrigin {
  kind: "attempt" | "placement";
  resourceId: string;
  questionId?: string;
  sectionIndex?: number;
  /** Bounded sentence taken from material visible to this learner. */
  context: string;
}
export interface WordRequest {
  word: string;
  context?: string;
  sectionIndex?: number;
  questionId?: string;
}
export interface WordSaveResult {
  saved: { cardId: string; word: string; alreadySaved: boolean };
}
export interface WordTranslation {
  word: string;
  meaning: string;
  definition?: string;
  partOfSpeech?: string;
  ipa?: string;
  source: "bank" | "openai";
  context: string;
}
export interface WordTranslationResult {
  translation: WordTranslation;
  card?: VocabularyCard;
}
export interface WordPronunciation {
  word: string;
  ipa: string;
  source: "bank" | "dictionary";
}
export interface WordPronunciationResult {
  pronunciation: WordPronunciation;
}
export interface CriterionFeedback {
  name: string;
  band: number | null;
  confidence: number | null;
  feedback: string;
  evidence: string[];
}
export interface Feedback {
  id: string;
  skill: ContentKind | "placement";
  estimatedBand: number | null;
  rawScore: number | null;
  total: number | null;
  summary: string;
  criteria: CriterionFeedback[];
  corrections: { original: string; suggestion: string; explanation: string }[];
  paragraphs: { index: number; feedback: string }[];
  answers: {
    questionId: string;
    response: string;
    answer: string;
    correct: boolean;
    explanation: string;
    evidence: string;
    subskill: string;
    prompt?: string;
    questionNumber?: number;
    options?: string[];
    context?: string;
    acceptedAnswers?: string[];
    sectionTitle?: string;
    questionType?: IeltsQuestionType | QuestionType;
    /** Present in completed placement review so listening audio can be replayed. */
    skill?: ContentKind;
  }[];
  referenceAnswers?: ReferenceResponse[];
  wordCount?: number;
  fillerCount?: number;
  fillerDensity?: number;
  transcript?: string;
  /** Omitted for legacy results whose transcript provenance cannot be proven. */
  transcriptSource?: "speech-recognition" | "typed";
  audioAssessment?: {
    provider: "openai";
    model: string;
    durationSeconds: number;
    observations: {
      criterion: "Fluency & Coherence" | "Pronunciation";
      startSeconds: number;
      endSeconds: number;
      quote: string;
      observation: string;
    }[];
  };
  pronunciation?: {
    accuracy: number;
    fluency: number;
    completeness: number | null;
    prosody: number | null;
  } | null;
  taskScores?: {
    task: 1 | 2;
    estimatedBand: number | null;
    criteria: CriterionFeedback[];
  }[];
  source: "rule-based" | "ai";
  createdAt: string;
}
export interface Attempt {
  id: string;
  duoAssessmentId?: string;
  contentId: string;
  title: string;
  skill: ContentKind;
  mode: Mode;
  status: "in-progress" | "submitted" | "invalidated";
  integrity?: import("./exam-integrity").ExamIntegrityState;
  startedAt: string;
  deadlineAt: string | null;
  submittedAt: string | null;
  durationSeconds: number;
  responses: Record<string, string>;
  essays: Record<string, string>;
  transcript: string;
  feedback: Feedback | null;
  content: ContentItem;
  audioAvailable: boolean;
  /** Actual saved prompt/recording material, disclosed after submission only. */
  speakingReview?: SpeakingReview;
}
export interface SpeakingReview {
  version: 1;
  prompts: {
    sectionId: string;
    title: string;
    text: string;
    cuePoints?: string[];
    instructions?: string;
  }[];
  promptSource: "saved-authored-prompt" | "current-authored-prompt";
  transcriptSource: "speech-recognition" | "typed" | "unknown";
  transcript: string;
  recognizedTranscript?: string;
  recordingAvailable: boolean;
}
export interface AttemptSummary {
  id: string;
  contentId: string;
  title: string;
  skill: ContentKind;
  mode: Mode;
  status: "in-progress" | "submitted" | "invalidated";
  startedAt: string;
  submittedAt: string | null;
  durationSeconds: number;
  estimatedBand: number | null;
  rawScore: number | null;
  total: number | null;
  feedbackSource: "rule-based" | "ai" | null;
}
/** Private, mode-specific progress for a standalone library exercise. */
export interface ContentProgress {
  latestAttempt: AttemptSummary | null;
  activeAttemptId: string | null;
  completedCount: number;
}
export interface SkillEstimate {
  skill: Skill;
  estimatedBand: number | null;
  uncertainty: number | null;
  attempts: number;
}
export interface StudyTask {
  id: string;
  day: string;
  title: string;
  kind: ContentKind | "vocabulary" | "placement";
  contentId: string | null;
  minutes: number;
  completed: boolean;
  reason: string;
}
export interface StudyPlan {
  id: string;
  weekStart: string;
  targetBand: number;
  weeklyMinutes: number;
  tasks: StudyTask[];
  explanation: string;
}
export interface Dashboard {
  profile: Profile;
  skills: SkillEstimate[];
  overallBand: number | null;
  completedCount: number;
  weekMinutes: number;
  streakDays: number;
  dueCards: number;
  totalCards: number;
  vocabularyRetention: number | null;
  recentAttempts: AttemptSummary[];
  recommendations: ContentItem[];
  weaknesses: { tag: string; count: number; skill: ContentKind }[];
  trend: { day: string; skill: Skill; estimatedBand: number }[];
  activity: { day: string; minutes: number }[];
  plan: StudyPlan;
}
export interface PlacementItem {
  id: string;
  skill: "reading" | "listening";
  text: string;
  question: string;
  options: string[];
  answer: string;
  explanation: string;
  band: number;
  cefr: Cefr;
  difficulty: number;
  subskill: string;
}
export interface PlacementState {
  id: string;
  mode: "quick" | "deep";
  total: number;
  completed: number;
  theta: number;
  standardError: number;
  estimatedBand: number;
  question: Omit<PlacementItem, "answer" | "explanation" | "difficulty"> | null;
  result: Feedback | null;
  deadlineAt?: string;
  serverNow?: string;
  suggestedQuestionSeconds?: number;
  draftAnswer?: string;
  completionReason?: "answered" | "deadline" | "invalidated";
  integrity?: import("./exam-integrity").ExamIntegrityState;
}
export interface PlacementSummary {
  id: string;
  mode: "quick" | "deep";
  total: number;
  completed: number;
  estimatedBand: number;
  standardError: number;
  startedAt: string;
  result: Feedback | null;
}
export interface ListeningAudioReadiness {
  configured: boolean;
  ready: boolean;
  state: "ready" | "pending" | "disabled";
  notice: string;
  readyCount: number;
  totalCount: number;
}
export interface Health {
  examIntegrityEnabled?: boolean;
  status: "ok";
  database: "mongodb";
  demoEnabled: boolean;
  duoEnabled?: boolean;
  authMode?: "phone" | "email";
  services: {
    openai: boolean;
    elevenlabs: boolean;
    azure: boolean;
    speech?: {
      configured: boolean;
      provider: "openai" | "elevenlabs" | null;
      voiceCount: number;
    };
  };
  bank: {
    lessons: number;
    mocks: number;
    vocabulary: number;
    placement: number;
  };
}
export interface LibraryResult {
  items: ContentItem[];
  total: number;
  topics: string[];
  progress?: Record<string, ContentProgress>;
}
export interface ErrorNotebook {
  items: {
    tag: string;
    skill: ContentKind;
    count: number;
    examples: {
      prompt: string;
      response: string;
      correction: string;
      explanation: string;
      contentId: string;
    }[];
  }[];
}
