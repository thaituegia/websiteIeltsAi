/** Public, finite diagnostics; never include provider payloads or learner text. */
export const AI_ERROR_CODES = [
  "AI_PROVIDER_AUTH",
  "AI_PROVIDER_QUOTA",
  "AI_PROVIDER_RATE_LIMIT",
  "AI_PROVIDER_UNAVAILABLE",
  "AI_PROVIDER_TIMEOUT",
  "AI_PROVIDER_NETWORK",
  "AI_MODEL_UNAVAILABLE",
  "AI_RESPONSE_INVALID",
  "AI_EVIDENCE_INVALID",
] as const;
export type AiErrorCode = typeof AI_ERROR_CODES[number];

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: AiErrorCode,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
