import "dotenv/config";
import { MongoClient } from "mongodb";
import { pathToFileURL } from "node:url";
import { loadDuoCredentials } from "./duo-auth";
import { activateProviderConfig } from "./provider-config";
import { inspectSpeechBank, runSpeechBankPrewarm, watchSpeechBankPrewarm } from "./speech-prewarm";

export function parseSpeechPrewarmArguments(args: string[]) {
  let mode: "inspect" | "once" | "watch" = "inspect", selected = false, maxClips = 32, maxRetries = 3, intervalMs = 60_000, resume = false;
  const number = (value: string | undefined, min: number, max: number) => {
    if (!value || !/^\d+$/u.test(value) || Number(value) < min || Number(value) > max) throw new Error("Invalid speech pregeneration bound.");
    return Number(value);
  };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (["--inspect", "--once", "--watch"].includes(arg)) {
      if (selected) throw new Error("Select exactly one speech pregeneration mode.");
      mode = arg.slice(2) as "inspect" | "once" | "watch"; selected = true;
    } else if (arg === "--max-clips") maxClips = number(args[++index], 1, 4096);
    else if (arg === "--max-retries") maxRetries = number(args[++index], 0, 5);
    else if (arg === "--interval-seconds") intervalMs = number(args[++index], 1, 3600) * 1000;
    else if (arg === "--resume") resume = true;
    else throw new Error("Usage: speech-prewarm-cli.ts --inspect | --once | --watch [--max-clips 32] [--max-retries 3] [--interval-seconds 60] [--resume]");
  }
  if (mode === "inspect" && resume) throw new Error("Read-only inspection cannot resume a paused worker.");
  return { mode, maxClips, maxRetries, intervalMs, resume };
}

export async function speechPrewarmMain(args = process.argv.slice(2)): Promise<void> {
  const { mode, ...bounds } = parseSpeechPrewarmArguments(args);
  // Unlock the existing installation payload only at its authorized origin.
  // Loading settings never provisions accounts or touches learner collections.
  if (process.env.APP_ORIGIN !== "https://sutonghanyu.vn") throw new Error("Speech pregeneration requires APP_ORIGIN=https://sutonghanyu.vn.");
  activateProviderConfig(loadDuoCredentials());
  const client = new MongoClient(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/ielts_ai", {
    serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000, maxPoolSize: 2,
  });
  const controller = new AbortController(), stop = () => controller.abort();
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
  try {
    await client.connect(); const db = client.db();
    if (db.databaseName !== "ielts_ai") throw new Error("Speech pregeneration operates only on ielts_ai.");
    const options = { ...bounds, signal: controller.signal, onProgress: (status: unknown) => console.log(JSON.stringify(status)) };
    if (mode === "watch") await watchSpeechBankPrewarm(db, options);
    else console.log(JSON.stringify(mode === "inspect" ? await inspectSpeechBank(db, options) : await runSpeechBankPrewarm(db, options)));
  } catch {
    // Never let Mongo/provider errors print credentials, URIs or response bodies.
    console.error("Speech pregeneration did not complete. Inspect its generic progress metadata and provider configuration.");
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGTERM", stop); process.removeListener("SIGINT", stop);
    await client.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await speechPrewarmMain().catch(() => { console.error("Speech pregeneration configuration is invalid."); process.exitCode = 1; });
