import { createHash } from "node:crypto";
import { BSON, type Collection } from "mongodb";
import type { StoredContent } from "../shared/types";

const canonical = (value: unknown): string => {
  const order = (input: unknown): unknown => Array.isArray(input) ? input.map(order)
    : input && typeof input === "object"
      ? Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, order(child)]))
      : input;
  // Compare the representation actually stored by MongoDB; optional undefined
  // properties are omitted by seed insertion rather than persisted as null.
  return JSON.stringify(order(BSON.EJSON.serialize(BSON.deserialize(BSON.serialize({ value }, { ignoreUndefined: true })), { relaxed: false })));
};

/** Models are applicable only to exactly the source/task and keys they explain. */
export function contentSourceDigest(content: StoredContent): string {
  return createHash("sha256").update(canonical({
    skill: content.skill, testType: content.testType,
    sections: content.sections, questions: content.questions,
  })).digest("hex");
}

/** Add server-only models, never overwrite tasks, answer keys or learner data. */
export async function addMissingReferenceAnswers(
  collection: Collection<StoredContent & { _id: string }>,
  source: readonly StoredContent[],
) {
  const report = { added: 0, alreadyPresent: 0, skippedModifiedContent: 0, concurrentChanges: 0 };
  for (const expected of source) {
    if (!expected.referenceAnswers?.length) continue;
    const existing = await collection.findOne({ _id: expected.id });
    if (!existing) continue;
    if (contentSourceDigest(existing) !== contentSourceDigest(expected)) {
      report.skippedModifiedContent++;
      continue;
    }
    if (existing.referenceAnswers?.length) {
      // Preserve any model already stored, including a teacher's edits.
      report.alreadyPresent++;
      continue;
    }
    const updated = await collection.updateOne({
      _id: existing._id, skill: existing.skill, testType: existing.testType,
      sections: existing.sections, questions: existing.questions,
      referenceAnswers: existing.referenceAnswers === undefined
        ? { $exists: false } : existing.referenceAnswers,
    }, { $set: { referenceAnswers: expected.referenceAnswers } }, { ignoreUndefined: true });
    if (updated.matchedCount === 1) report.added++;
    else report.concurrentChanges++;
  }
  return report;
}
