/** Public model IDs, never credentials. Audio/STT/TTS use their own models. */
export const DEFAULT_OPENAI_TEXT_MODEL = "gpt-6.1-sol";

export const OPENAI_TEXT_MODEL_ROLES = [
  "CONTENT_MODEL",
  "EXTRACTOR_MODEL",
  "SCORING_MODEL",
  "TRANSLATION_MODEL",
] as const;
export type OpenAITextModelRole = (typeof OPENAI_TEXT_MODEL_ROLES)[number];

export function resolveOpenAITextModel(
  role: OpenAITextModelRole,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env[role]?.trim() || DEFAULT_OPENAI_TEXT_MODEL;
}

/** Completion limits include reasoning tokens. Leave model-specific sampling
 * and reasoning controls unset rather than assuming their supported values. */
export function openAITextCompletionParameters(
  role: OpenAITextModelRole,
  env: NodeJS.ProcessEnv = process.env,
) {
  return {
    model: resolveOpenAITextModel(role, env),
    max_completion_tokens: role === "CONTENT_MODEL" ? 24_000 : role === "TRANSLATION_MODEL" ? 2_048 : 16_000,
  };
}
