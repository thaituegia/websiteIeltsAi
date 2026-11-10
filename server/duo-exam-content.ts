import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import type { ContentKind, StoredContent } from "../shared/types";
import { validateContentStructure } from "../shared/content-visuals";
import { ApiError } from "./errors";
import type { Database } from "./storage";
import { makeExclusiveReading } from "./data/duo-exclusive-reading";
import { makeExclusiveListening } from "./data/duo-exclusive-listening";
import { makeExclusiveGrammar, makeExclusiveSpeaking, makeExclusiveWriting } from "./data/duo-exclusive-support";
import { newDuoGatePapers } from "./data/duo-gate-supplement";
import { newAdditionalDuoGatePapers } from "./data/duo-gate-supplement-2";
import { newFiveDuoGatePapers } from "./data/duo-gate-supplement-3";
import { newTenDuoGatePapers } from "./data/duo-gate-supplement-4";

export const DUO_EXAM_CONTENT_COLLECTION = "duo_exam_content";
export const DUO_EXAM_BANK_VERSION = "exclusive-20261105-v1";
type Context = Pick<Database, "db">;
type Kind = "gate" | "promotion";
interface PrivatePaper extends StoredContent {
  _id: string;
  duoExam: { version: string; kind: Kind; sourceHash: string };
}
export const isExclusiveDuoContentId = (id: string): boolean => id.startsWith("duo-private-");

let catalog: PrivatePaper[] | undefined;
const seeded = new WeakMap<Db, Promise<void>>();
const sourceHash = (content: StoredContent): string => createHash("sha256")
  .update(JSON.stringify(content, (_key, value: unknown) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : value)).digest("hex");

function authoredCatalog(): PrivatePaper[] {
  if (catalog) return catalog;
  const papers: PrivatePaper[] = [];
  const add = (input: StoredContent, kind: Kind) => {
    // Persist precisely the JSON representation whose immutable hash is checked.
    const content = JSON.parse(JSON.stringify(input)) as StoredContent;
    if (!isExclusiveDuoContentId(content.id)) throw new Error("Private Duo paper requires its reserved namespace.");
    validateContentStructure(content);
    papers.push({ ...content, _id: content.id, duoExam: {
      version: DUO_EXAM_BANK_VERSION, kind,
      sourceHash: sourceHash(content),
    } });
  };
  for (let band10 = 30; band10 <= 80; band10 += 5) {
    const band = band10 / 10;
    for (let variant = 0; variant < 8; variant++) {
      add(makeExclusiveReading(band, variant, "lesson"), "gate");
      add(makeExclusiveListening(band, variant, "lesson"), "gate");
      add(makeExclusiveGrammar(band, variant), "gate");
    }
    for (let variant = 0; variant < 4; variant++) {
      add(makeExclusiveReading(band, variant, "full-mock"), "promotion");
      add(makeExclusiveListening(band, variant, "full-mock"), "promotion");
      add(makeExclusiveWriting(band, variant, "academic"), "promotion");
      add(makeExclusiveWriting(band, variant, "general"), "promotion");
      add(makeExclusiveSpeaking(band, variant), "promotion");
    }
  }
  // Additive supplement: keep every existing private ID and source immutable,
  // including the scripts that already have paid audio in the shared cache.
  for (const paper of newDuoGatePapers()) add(paper, "gate");
  for (const paper of newAdditionalDuoGatePapers()) add(paper, "gate");
  for (const paper of newFiveDuoGatePapers()) add(paper, "gate");
  for (const paper of newTenDuoGatePapers()) add(paper, "gate");
  if (new Set(papers.map(paper => paper.id)).size !== papers.length)
    throw new Error("Private Duo paper identifiers must be unique.");
  const sources = new Set<string>();
  for (const paper of papers.filter(paper => ["reading", "listening"].includes(paper.skill))) {
    for (const section of paper.sections) {
      const text = (section.dialogue?.length ? section.dialogue.map(line => line.text).join(" ") : section.text)
        .normalize("NFC").toLowerCase().replace(/\s+/gu, " ").trim();
      const hash = createHash("sha256").update(text).digest("hex");
      if (!text || sources.has(hash)) throw new Error("Private Duo source passages must not repeat across papers.");
      sources.add(hash);
    }
  }
  catalog = papers;
  return catalog;
}

/** Read-only authored inventory. It is never added to the public content bank. */
export function exclusiveDuoBank(): StoredContent[] {
  return authoredCatalog().map(({ _id: _, duoExam: __, ...content }) => structuredClone(content));
}

async function appendVerifiedPapers(database: Context, papers: PrivatePaper[]): Promise<void> {
  const collection = database.db.collection<PrivatePaper>(DUO_EXAM_CONTENT_COLLECTION);
  await collection.bulkWrite(papers.map(paper => ({ updateOne: {
    filter: { _id: paper.id }, update: { $setOnInsert: paper }, upsert: true,
  } })), { ordered: false });
  const stored = await collection.find({ _id: { $in: papers.map(paper => paper.id) } }).toArray();
  const byId = new Map(stored.map(({ _id, duoExam, ...content }) => [_id, {
    ...duoExam, actualHash: sourceHash(content),
  }]));
  if (papers.some(paper => byId.get(paper.id)?.version !== DUO_EXAM_BANK_VERSION ||
      byId.get(paper.id)?.sourceHash !== paper.duoExam.sourceHash ||
      byId.get(paper.id)?.actualHash !== paper.duoExam.sourceHash))
    throw new ApiError(409, "Ngân hàng đề riêng chưa được xác minh; chưa mở bài thi.");
}

/** Only the papers in the explicitly selected batch; older papers are immutable. */
export async function ensureDuoGateSupplement(database: Context, batch: "initial" | "additional" | "five" | "ten" = "initial"): Promise<void> {
  const factories = { initial: newDuoGatePapers, additional: newAdditionalDuoGatePapers, five: newFiveDuoGatePapers, ten: newTenDuoGatePapers };
  if (!Object.hasOwn(factories, batch)) throw new Error("Unknown private Gate supplement batch.");
  const papers = factories[batch]();
  const ids = new Set(papers.map(paper => paper.id));
  await appendVerifiedPapers(database, authoredCatalog().filter(paper => ids.has(paper.id)));
}

/** Add-only initialization; historical papers, public content and learner data
 * are never overwritten. Failed initialization may safely be retried. */
export async function ensureExclusiveDuoBank(database: Context): Promise<void> {
  const existing = seeded.get(database.db);
  if (existing) return existing;
  const work = appendVerifiedPapers(database, authoredCatalog());
  seeded.set(database.db, work);
  try { await work; }
  catch (error) { seeded.delete(database.db); throw error; }
}

/** Owned assessment/review paths only. Public routes must not use this lookup
 * until the learner's assessment or attempt has been authorized. */
export async function duoAssessmentContents(database: Database, ids: string[]): Promise<(StoredContent & { _id: string })[]> {
  const publicIds = [...new Set(ids.filter(id => !isExclusiveDuoContentId(id)))];
  const privateIds = [...new Set(ids.filter(isExclusiveDuoContentId))];
  const [legacy, privatePapers] = await Promise.all([
    publicIds.length ? database.content.find({ _id: { $in: publicIds } }).toArray() : [],
    privateIds.length ? database.db.collection<PrivatePaper>(DUO_EXAM_CONTENT_COLLECTION)
      .find({ _id: { $in: privateIds } }).toArray() : [],
  ]);
  const rows = new Map<string, StoredContent & { _id: string }>(legacy.map(row => [row.id, row]));
  for (const { duoExam: _, ...paper } of privatePapers) rows.set(paper.id, paper);
  return ids.flatMap(id => rows.has(id) ? [rows.get(id)!] : []);
}

/** Pure selection supports read-only path planning. Each new sitting supplies
 * all prior paper IDs. Exhaustion is explicit; public lessons are never donors. */
export async function selectExclusiveDuoContent(_database: Context, options: {
  band: number; testType: "academic" | "general"; kind: Kind;
  skills: ContentKind[]; excludeIds?: string[];
}): Promise<string[]> {
  const excluded = new Set(options.excludeIds ?? []);
  const selected: string[] = [];
  for (const skill of [...new Set(options.skills)]) {
    const candidates = authoredCatalog().filter(paper => paper.duoExam.kind === options.kind &&
      paper.skill === skill && paper.band === options.band &&
      (paper.testType === options.testType || paper.testType === "both") &&
      !excluded.has(paper.id)).sort((a, b) => a.id.localeCompare(b.id));
    const candidate = candidates[0];
    if (!candidate) throw new ApiError(409, "Đã dùng hết đề riêng chưa làm cho kỹ năng này. Cần bổ sung đề mới trước khi thi lại.", "DUO_GATE_PAPERS_EXHAUSTED");
    excluded.add(candidate.id);
    selected.push(candidate.id);
  }
  if (!selected.length) throw new ApiError(409, "Bài thi cần ít nhất một kỹ năng hợp lệ.");
  return selected;
}
