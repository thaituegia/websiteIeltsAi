import "dotenv/config";
import { createApp } from "./app";
import { connectDatabase, seedDatabase } from "./storage";
import { loadDuoCredentials, provisionDuoAccounts } from "./duo-auth";
import { activateProviderConfig } from "./provider-config";
import { z } from "zod";

const port = Number(process.env.PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT không hợp lệ.");
const production = process.env.NODE_ENV === "production";
if (production) {
  let origin: URL;
  try {
    origin = new URL(process.env.APP_ORIGIN || "");
  } catch {
    throw new Error(
      "Production cần APP_ORIGIN HTTPS hợp lệ để bảo vệ cookie và kiểm tra Origin.",
    );
  }
  if (origin.protocol !== "https:" || origin.username || origin.password)
    throw new Error("Production cần APP_ORIGIN HTTPS hợp lệ.");
  process.env.APP_ORIGIN = origin.origin;
}
const duoEnabled = production || process.env.DUO_ENABLED !== "false";
// Validate private account configuration before any startup seed or binding.
const duoCredentials = duoEnabled ? loadDuoCredentials() : undefined;
if (duoCredentials) activateProviderConfig(duoCredentials);
const duoConfig = duoEnabled ? {
  gateInterval: z.coerce.number().pipe(z.union([z.literal(5), z.literal(10)])).parse(process.env.DUO_GATE_INTERVAL || 5),
  sessionsPerBand: z.coerce.number().int().min(5).max(100).parse(process.env.DUO_SESSIONS_PER_BAND || 20),
  passPercent: z.coerce.number().min(1).max(100).parse(process.env.DUO_PASS_PERCENT || 70),
  strictRetakeMode: z.enum(["true", "false"]).parse(process.env.DUO_STRICT_RETAKE_MODE || "false") === "true",
  ...(process.env.DUO_SESSIONS_BY_BAND ? { sessionsByBand: z.record(z.string(), z.number().int().min(5).max(100)).parse(JSON.parse(process.env.DUO_SESSIONS_BY_BAND)) } : {}),
} : undefined;
const database = await connectDatabase();
await seedDatabase(database);
if (duoCredentials) await provisionDuoAccounts(database, duoCredentials);
const app = createApp(database, { duoEnabled, duoCredentials, duo: duoConfig,
  examIntegrityEnabled: process.env.NODE_ENV !== "test" || process.env.EXAM_INTEGRITY_ENABLED === "true" });
const server = app.listen(port, "0.0.0.0", () =>
  console.log(`IELTS AI API ready on port ${port}; MongoDB connected`),
);
server.requestTimeout = 16 * 60 * 1000;
server.timeout = 16 * 60 * 1000;
let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  server.close(async () => {
    await database.client.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", () => {
  void shutdown();
});
process.on("SIGINT", () => {
  void shutdown();
});
