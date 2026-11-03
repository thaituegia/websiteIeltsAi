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

const evidenceKinds = [
  "missing", "null", "string", "quote-object", "text-object", "ambiguous-object", "other-object", "other",
  "empty-array", "string-array", "object-array", "mixed-array", "nested-array", "other-array", "array",
] as const;
const evidenceIssues = ["none", "missing", "null", "empty", "too-long", "too-many", "ambiguous", "nested", "unsupported"] as const;
export interface SpeakingEvidenceDetail {
  index: number;
  criterion: typeof criterionNames[number] | "unknown";
  kind: typeof evidenceKinds[number];
  issue: typeof evidenceIssues[number];
}

/** Finite field categories only; never retain provider values or raw Zod paths. */
export class SpeakingAudioResponseError extends ApiError {
  readonly fields: readonly SpeakingAudioResponseField[];
  readonly evidenceDetails: readonly Readonly<SpeakingEvidenceDetail>[];
  constructor(fields: readonly SpeakingAudioResponseField[], details: readonly SpeakingEvidenceDetail[] = []) {
    super(502, "Đánh giá âm thanh không đúng cấu trúc. Bản ghi vẫn được giữ; hãy thử lại.", "AI_RESPONSE_INVALID");
    this.name = "SpeakingAudioResponseError";
    this.fields = Object.freeze(diagnosticFields.filter(field => fields.includes(field)));
    this.evidenceDetails = Object.freeze(details.slice(0, 4).filter(detail =>
      Number.isInteger(detail.index) && detail.index >= 0 && detail.index < 4
      && evidenceKinds.includes(detail.kind) && evidenceIssues.includes(detail.issue),
    ).map(detail => Object.freeze({ index: detail.index,
      criterion: criterionNames.includes(detail.criterion as typeof criterionNames[number]) ? detail.criterion : "unknown" as const,
      kind: detail.kind, issue: detail.issue,
    })));
  }
}

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const own = (value: Record<string, unknown>, key: string) => Object.hasOwn(value, key);
function literal(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!object(value)) return undefined;
  const hasQuote = own(value, "quote"), hasText = own(value, "text");
  if (hasQuote && hasText) return typeof value.quote === "string" && value.quote === value.text ? value.quote : undefined;
  if (hasQuote) return typeof value.quote === "string" ? value.quote : undefined;
  if (hasText) return typeof value.text === "string" ? value.text : undefined;
  return undefined;
}
function valueDescription(value: unknown): Pick<SpeakingEvidenceDetail, "kind" | "issue"> {
  if (value === undefined) return { kind: "missing", issue: "missing" };
  if (value === null) return { kind: "null", issue: "null" };
  if (typeof value === "string") return { kind: "string", issue: !value.trim() ? "empty" : value.length > 2000 ? "too-long" : "none" };
  if (object(value)) {
    if (own(value, "quote") && own(value, "text") && value.quote !== value.text)
      return { kind: "ambiguous-object", issue: "ambiguous" };
    const text = literal(value);
    if (text === undefined) return { kind: "other-object", issue: "unsupported" };
    return { kind: own(value, "quote") ? "quote-object" : "text-object",
      issue: !text.trim() ? "empty" : text.length > 2000 ? "too-long" : "none" };
  }
  return { kind: "other", issue: "unsupported" };
}
function evidenceDescription(value: unknown): Pick<SpeakingEvidenceDetail, "kind" | "issue"> {
  if (!Array.isArray(value)) return valueDescription(value);
  if (value.length > 20) return { kind: "array", issue: "too-many" };
  if (!value.length) return { kind: "empty-array", issue: "empty" };
  if (value.some(Array.isArray)) return { kind: "nested-array", issue: "nested" };
  const items = value.map(valueDescription);
  const allStrings = items.every(item => item.kind === "string");
  const allObjects = items.every(item => item.kind === "quote-object" || item.kind === "text-object");
  const validKinds = items.every(item => item.kind === "string" || item.kind === "quote-object" || item.kind === "text-object");
  const issue = items.find(item => item.issue !== "none")?.issue ?? "none";
  return { kind: allStrings ? "string-array" : allObjects ? "object-array" : validKinds ? "mixed-array" : "other-array", issue };
}
function evidenceDetails(input: unknown): SpeakingEvidenceDetail[] {
  if (!object(input) || !Array.isArray(input.criteria)) return [];
  return input.criteria.slice(0, 4).map((criterion: unknown, index) => ({ index,
    criterion: object(criterion) && criterionNames.includes(criterion.name as typeof criterionNames[number])
      ? criterion.name as typeof criterionNames[number] : "unknown",
    ...evidenceDescription(object(criterion) ? criterion.evidence : undefined),
  }));
}

/** Convert representation only. Every resulting literal is source-checked by the caller. */
function normalizeEvidenceInput(input: unknown): unknown {
  if (!object(input) || !Array.isArray(input.criteria) || input.criteria.length !== 4) return input;
  return { ...input, criteria: input.criteria.map((criterion: unknown) => {
    if (!object(criterion)) return criterion;
    const value = criterion.evidence;
    const absent = value == null || Array.isArray(value) && value.length === 0;
    if (absent) {
      let evidence: unknown[] = [];
      if (typeof criterion.band === "number" && (criterion.name === "Pronunciation" || criterion.name === "Fluency & Coherence")
          && Array.isArray(input.observations) && input.observations.length <= 24) {
        // Same-category observations already carry the audible quote. Reuse it
        // instead of inventing a second, redundant quotation. The canonical
        // schema and the audio-aware caller still validate all quotes/times.
        evidence = [...new Set(input.observations.filter(observation => object(observation) && observation.criterion === criterion.name)
          .map(observation => (observation as Record<string, unknown>).quote))];
      }
      return { ...criterion, evidence };
    }
    if (Array.isArray(value)) {
      // Never filter or salvage an invalid member; it must fail canonical parsing.
      if (value.length > 20) return criterion;
      return { ...criterion, evidence: value.map(item => literal(item) ?? item) };
    }
    const text = literal(value);
    return text === undefined ? criterion : { ...criterion, evidence: [text] };
  }) };
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

/** A request-scoped prompt contract; the shared canonical schema stays intact. */
export function speakingAudioEvidenceSchema(sourceIds: readonly string[]): typeof speakingAudioOutputSchema {
  const schema = structuredClone(speakingAudioOutputSchema);
  // These paths are generated from the fixed schema above, not provider keys.
  const properties = schema.properties!;
  const criteria = properties.criteria as { items: { properties: { evidence: { items: Record<string, unknown> } } } };
  const observations = properties.observations as { anyOf: { items?: { properties: { quote: Record<string, unknown> } } }[] };
  const corrections = properties.corrections as { anyOf: { items?: { properties: { original: Record<string, unknown> } } }[] };
  criteria.items.properties.evidence.items.enum = [...sourceIds];
  for (const branch of observations.anyOf) if (branch.items)
    branch.items.properties.quote.enum = [...sourceIds];
  for (const branch of corrections.anyOf) if (branch.items)
    branch.items.properties.original.enum = [...sourceIds];
  return schema;
}

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
  const details = evidenceDetails(input);
  const parsed = inputSchema.safeParse(normalizeEvidenceInput(input));
  if (!parsed.success) {
    throw new SpeakingAudioResponseError(parsed.error.issues.flatMap(issue => issueField(issue.path)), details);
  }
  if (new Set(parsed.data.criteria.map(criterion => criterion.name)).size !== criterionNames.length)
    throw new SpeakingAudioResponseError(["criteria"], details);
  return {
    ...parsed.data,
    corrections: parsed.data.corrections ?? [],
    observations: parsed.data.observations ?? [],
  };
}
