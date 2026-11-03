import { z } from "zod";
import type { CriterionFeedback } from "../shared/types";
import { ApiError } from "./errors";

const criterionNames = [
  "Fluency & Coherence", "Lexical Resource", "Grammatical Range & Accuracy", "Pronunciation",
] as const;
const diagnosticFields = [
  "summary", "speechDetected", "criteria", "band", "confidence", "evidence",
  "corrections", "observations", "timestamps",
] as const;
export type SpeakingAudioResponseField = typeof diagnosticFields[number];

/** Finite field categories only; never retain provider values or raw Zod paths. */
export class SpeakingAudioResponseError extends ApiError {
  readonly fields: readonly SpeakingAudioResponseField[];
  constructor(fields: readonly SpeakingAudioResponseField[]) {
    super(502, "Đánh giá âm thanh không đúng cấu trúc. Bản ghi vẫn được giữ; hãy thử lại.", "AI_RESPONSE_INVALID");
    this.name = "SpeakingAudioResponseError";
    this.fields = Object.freeze(diagnosticFields.filter(field => fields.includes(field)));
  }
}

const observationSchema = z.object({
  criterion: z.enum(["Fluency & Coherence", "Pronunciation"]),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().positive(),
  quote: z.string().min(1).max(2000),
  observation: z.string().min(1).max(3000),
});
const inputSchema = z.object({
  summary: z.string().min(1).max(6000),
  speechDetected: z.boolean(),
  criteria: z.array(z.object({
    name: z.enum(criterionNames),
    band: z.number().min(0).max(9).multipleOf(0.5).nullable(),
    // An omitted uncertainty estimate is unknown, never an invented confidence.
    confidence: z.number().min(0).max(1).nullable().default(null),
    feedback: z.string().min(1).max(4000),
    evidence: z.array(z.string().min(1).max(2000)).max(20),
  })).length(4),
  corrections: z.array(z.object({
    original: z.string().min(1).max(2000),
    suggestion: z.string().min(1).max(2000),
    explanation: z.string().min(1).max(3000),
  })).max(20).nullable().optional(),
  observations: z.array(observationSchema).max(24).nullable().optional(),
});

/** Prompt contract only: no unsupported provider response-format mode is implied. */
export const speakingAudioOutputSchema = z.toJSONSchema(inputSchema);

export interface SpeakingAudioResponse {
  summary: string;
  speechDetected: boolean;
  criteria: CriterionFeedback[];
  corrections: { original: string; suggestion: string; explanation: string }[];
  observations: z.infer<typeof observationSchema>[];
}

function issueField(path: readonly PropertyKey[]): SpeakingAudioResponseField[] {
  const [root, , child] = path;
  if (root === "criteria") {
    if (child === "band" || child === "confidence" || child === "evidence") return [child];
    return ["criteria"];
  }
  if (root === "observations") {
    if (child === "startSeconds" || child === "endSeconds") return ["timestamps"];
    return ["observations"];
  }
  if (root === "summary" || root === "speechDetected" || root === "corrections") return [root];
  // A non-object response has no trustworthy field path. Describe only the
  // required root categories instead of logging any arbitrary provider text.
  return ["summary", "speechDetected", "criteria"];
}

/** Normalise optional metadata only; scored acoustic support is checked by the caller. */
export function parseSpeakingAudioResponse(input: unknown): SpeakingAudioResponse {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    throw new SpeakingAudioResponseError(parsed.error.issues.flatMap(issue => issueField(issue.path)));
  }
  if (new Set(parsed.data.criteria.map(criterion => criterion.name)).size !== criterionNames.length)
    throw new SpeakingAudioResponseError(["criteria"]);
  return {
    ...parsed.data,
    corrections: parsed.data.corrections ?? [],
    observations: parsed.data.observations ?? [],
  };
}
