import "dotenv/config";
import { MongoClient } from "mongodb";
import { resolve } from "node:path";
import { inspectBankUpgrade, upgradeBank, verifyBankUpgrade } from "./bank-upgrade";
import { replacementBank as baseline } from "./data/initial-fresh-bank";
import { replacementBank as target } from "./data/index";

// Administrator-only entrypoint; no account provisioning, seeding or HTTP server.
const [action = "inspect", backup, ...extra] = process.argv.slice(2);
if (!["inspect", "apply", "verify"].includes(action) || extra.length || (action === "inspect" ? Boolean(backup) : !backup)) throw Error("Usage: bank-upgrade-cli.ts inspect | apply ABSOLUTE_NEW_BACKUP_DIRECTORY | verify ABSOLUTE_BACKUP_DIRECTORY");
if (action !== "inspect" && !backup?.startsWith("/")) throw Error("The backup path must be absolute.");
if (action === "apply" && (process.env.IELTS_APP_OFFLINE !== "true" || !backup?.startsWith("/"))) throw Error("Stop the IELTS app first; apply requires IELTS_APP_OFFLINE=true and an absolute new backup directory.");
const client = new MongoClient(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/ielts_ai", { serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000, maxPoolSize: 2 });
try {
  await client.connect(); const db = client.db();
  if (db.databaseName !== "ielts_ai") throw Error("This command operates only on the IELTS application's ielts_ai database.");
  const result = action === "inspect" ? await inspectBankUpgrade(db, baseline, target)
    : action === "apply" ? await upgradeBank(db, baseline, target, { expectedDatabase: "ielts_ai", backupDirectory: resolve(backup!), appOffline: true })
    : await verifyBankUpgrade(db, target, resolve(backup!), { expectedDatabase: "ielts_ai" });
  console.log(JSON.stringify(result, null, 2));
} catch {
  // Never emit URI, account details or private BSON documents to public logs.
  throw Error("IELTS preserving upgrade did not complete. Keep the app stopped after apply and inspect its private backup receipt before recovery.");
} finally { await client.close(); }
