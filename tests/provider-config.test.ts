import assert from "node:assert/strict";
import { createCipheriv, randomBytes } from "node:crypto";
import { test } from "node:test";
import { activateProviderConfig, providerUnlockKey, unlockProviderConfig } from "../server/provider-config";
import type { DuoCredentialSettings } from "../server/duo-auth";
const settings: DuoCredentialSettings = { duoId: "synthetic-sealed-pair", accounts: [
  { role: "husband", name: "Synthetic A", phone: "0390000081", passwordHash: `scrypt:${"a".repeat(32)}:${"b".repeat(128)}` },
  { role: "wife", name: "Synthetic B", phone: "0390000082", passwordHash: `scrypt:${"c".repeat(32)}:${"d".repeat(128)}` },
] };
function sealed() {
  const payload = { key: "sk-synthetic-test-provider-configuration", scoringModel: "gpt-4o", transcriptionModel: "whisper-1", speakingAudioModel: "gpt-audio" };
  const value = { version: 1 as const, origin: "https://sutonghanyu.vn" as const,
    salt: randomBytes(32).toString("hex"), iv: randomBytes(12).toString("hex"), tag: "", ciphertext: "" };
  const cipher = createCipheriv("aes-256-gcm", providerUnlockKey(settings, value.salt), Buffer.from(value.iv, "hex"));
  cipher.setAAD(Buffer.from(JSON.stringify([value.version, value.origin])));
  value.ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]).toString("hex");
  value.tag = cipher.getAuthTag().toString("hex");
  return { payload, value };
}
test("sealed provider config unlocks only with installation hashes and authentic metadata", () => {
  const { value, payload } = sealed();
  assert.deepEqual(unlockProviderConfig(settings, value), payload);
  assert.equal(JSON.stringify(value).includes(payload.key), false);
  assert.deepEqual(unlockProviderConfig({ ...settings, accounts: [...settings.accounts].reverse() }, value), payload);
  for (const modify of [
    () => ({ ...value, ciphertext: "00" + value.ciphertext.slice(2) }),
    () => ({ ...value, tag: "0".repeat(32) }),
    () => ({ ...value, origin: "https://other.invalid" }),
    () => ({ ...value, version: 2 }),
    () => ({ ...value, extra: "unexpected" }),
  ]) assert.equal(unlockProviderConfig(settings, modify()), null);
  assert.equal(unlockProviderConfig({ ...settings, duoId: "different-pair" }, value), null);
  assert.equal(unlockProviderConfig({ ...settings, accounts: settings.accounts.map(account => ({ ...account, passwordHash: "different" })) }, value), null);
});
test("synthetic installations never receive real sealed credentials; explicit private overrides are retained", () => {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "production", APP_ORIGIN: "https://sutonghanyu.vn" };
  assert.equal(activateProviderConfig(settings, env), false);
  assert.equal(env.IELTS_OPENAI_API_KEY, undefined);
  env.IELTS_OPENAI_API_KEY = "sk-explicit-synthetic-provider-key";
  assert.equal(activateProviderConfig(settings, env), true);
  assert.equal(env.IELTS_OPENAI_API_KEY, "sk-explicit-synthetic-provider-key");
  assert.equal(env.SPEAKING_AUDIO_MODEL, "gpt-audio");
});
