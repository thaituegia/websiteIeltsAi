import { createDecipheriv, hkdfSync } from "node:crypto";
import { z } from "zod";
import type { DuoCredentialSettings } from "./duo-auth";
import { sealedProviderConfig } from "./provider-sealed";

const sealedSchema = z.object({
  version: z.literal(1),
  origin: z.literal("https://sutonghanyu.vn"),
  salt: z.string().regex(/^[a-f0-9]{64}$/),
  iv: z.string().regex(/^[a-f0-9]{24}$/),
  tag: z.string().regex(/^[a-f0-9]{32}$/),
  ciphertext: z.string().regex(/^[a-f0-9]+$/).min(2).max(8192),
}).strict();
const payloadSchema = z.object({
  key: z.string().regex(/^sk-[A-Za-z0-9_-]{20,500}$/),
  scoringModel: z.literal("gpt-4o"),
  transcriptionModel: z.literal("whisper-1"),
  speakingAudioModel: z.literal("gpt-audio"),
}).strict();
export type SealedProviderConfig = z.infer<typeof sealedSchema>;

/** The published payload contains ciphertext only. Its unlock material is the
 * installation's existing private salted hashes, never account passwords. */
export function providerUnlockKey(settings: DuoCredentialSettings, salt: string): Buffer {
  const material = JSON.stringify({
    duoId: settings.duoId,
    accounts: [...settings.accounts].sort((a, b) => a.role.localeCompare(b.role))
      .map(({ role, passwordHash }) => ({ role, passwordHash })),
  });
  return Buffer.from(hkdfSync("sha256", Buffer.from(material), Buffer.from(salt, "hex"),
    "websiteIeltsAi/provider-config/v1", 32));
}
export function unlockProviderConfig(settings: DuoCredentialSettings, input: unknown = sealedProviderConfig) {
  try {
    const sealed = sealedSchema.parse(input);
    const decipher = createDecipheriv("aes-256-gcm", providerUnlockKey(settings, sealed.salt), Buffer.from(sealed.iv, "hex"));
    decipher.setAAD(Buffer.from(JSON.stringify([sealed.version, sealed.origin])));
    decipher.setAuthTag(Buffer.from(sealed.tag, "hex"));
    const clear = Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, "hex")), decipher.final()]);
    return payloadSchema.parse(JSON.parse(clear.toString("utf8")));
  } catch {
    // Do not include crypto/provider errors or credential values in logs.
    return null;
  }
}
export function activateProviderConfig(settings: DuoCredentialSettings, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.IELTS_OPENAI_API_KEY?.trim() || env.OPENAI_API_KEY?.trim()) {
    env.SPEAKING_AUDIO_MODEL ||= "gpt-audio";
    return true;
  }
  const payload = unlockProviderConfig(settings);
  if (!payload || (env.NODE_ENV === "production" && env.APP_ORIGIN !== sealedProviderConfig.origin)) return false;
  env.IELTS_OPENAI_API_KEY = payload.key;
  env.SCORING_MODEL ||= payload.scoringModel;
  env.EXTRACTOR_MODEL ||= payload.scoringModel;
  env.TRANSCRIPTION_MODEL ||= payload.transcriptionModel;
  env.SPEAKING_AUDIO_MODEL ||= payload.speakingAudioModel;
  return true;
}
