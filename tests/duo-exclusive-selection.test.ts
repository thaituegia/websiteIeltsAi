import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createDuoService } from "../server/duo";
import { ensureExclusiveDuoBank, isExclusiveDuoContentId } from "../server/duo-exam-content";
import { ApiError } from "../server/errors";
import { connectDatabase, type UserRecord } from "../server/storage";
import type { ContentKind, StoredContent } from "../shared/types";

interface BandFixture {
  lessons: { contentId: string | null }[];
  gates: { id: string; contentIds: string[] }[];
  promotionContentIds: string[];
}
interface PathFixture {
  duoId: string;
  currentBand: number;
  bands: Record<string, BandFixture>;
}
interface SelectionAdapter {
  buildBand(band: number, duoId: string, testType: "academic" | "general"): Promise<BandFixture>;
  exclusiveAssessmentSet(path: PathFixture, kind: "gate" | "promotion", canonicalIds: string[], testType: "academic" | "general", gateId?: string): Promise<string[]>;
}
const skills: ContentKind[] = ["reading", "listening", "writing", "speaking", "grammar"];
function publicLesson(skill: ContentKind): StoredContent {
  const id = `synthetic-public-${skill}`;
  return {
    id, title: `Public ${skill} practice`, skill, topic: "Synthetic public library", band: 3,
    cefr: "A2", testType: "academic", durationMinutes: 10, format: "lesson",
    description: "Disposable public-only curriculum fixture", source: "authored", quality: "authored-unreviewed",
    createdAt: "2026-11-05T00:00:00.000Z", tags: [], vocabularyIds: [],
    sections: [{ id: `${id}-section`, title: "Public practice", text: `Public ${skill} practice material.` }],
    questions: [],
  };
}

test("Duo paper allocation stays private and never reuses ordinary failed or completed-room papers", async t => {
  const name = `ielts_duo_exclusive_test_${randomUUID().replaceAll("-", "")}`;
  assert.match(name, /^ielts_duo_exclusive_test_[a-f0-9]{32}$/);
  const database = await connectDatabase("mongodb://127.0.0.1:27017", name);
  try {
    const lessons = skills.map(publicLesson);
    await database.content.insertMany(lessons.map(content => ({ ...content, _id: content.id })));
    const publicBefore = await database.content.find({}).sort({ _id: 1 }).toArray();
    await ensureExclusiveDuoBank(database);
    const duoId = `synthetic-exclusive-${randomUUID()}`;
    const service = createDuoService(database);
    // Exercise the actual curriculum/selection internals with real isolated
    // collections, without bypassing authentication on any production route.
    const selection = service as unknown as SelectionAdapter;
    const band = await selection.buildBand(3, duoId, "academic");
    const path: PathFixture = { duoId, currentBand: 3, bands: { b6: band } };
    const gate = band.gates[0]!;

    await t.test("practice remains public while all Gate and promotion allocations are distinct private papers", () => {
      assert.equal(band.gates.length, 3);
      const publicIds = new Set(lessons.map(content => content.id));
      assert.ok(band.lessons.every(lesson => !lesson.contentId || publicIds.has(lesson.contentId)));
      const gateIds = band.gates.flatMap(entry => entry.contentIds);
      assert.equal(gateIds.length, 9);
      assert.equal(new Set(gateIds).size, gateIds.length);
      assert.ok([...gateIds, ...band.promotionContentIds].every(isExclusiveDuoContentId));
      assert.ok([...gateIds, ...band.promotionContentIds].every(id => !publicIds.has(id)));
      assert.equal(band.promotionContentIds.length, 4);
      assert.ok(band.promotionContentIds.every(id => !gateIds.includes(id)));
    });

    await t.test("a legacy public Gate gets private material without consuming another upcoming Gate allocation", async () => {
      const legacyIds = ["reading", "listening", "grammar"].map(skill => `synthetic-public-${skill}`);
      const before = structuredClone(path);
      const ids = await selection.exclusiveAssessmentSet(path, "gate", legacyIds, "academic", gate.id);
      assert.equal(ids.length, 3);
      assert.ok(ids.every(isExclusiveDuoContentId));
      const otherGateIds = band.gates.slice(1).flatMap(entry => entry.contentIds);
      assert.ok(ids.every(id => !otherGateIds.includes(id)));
      assert.deepEqual(path, before, "selection itself must not rewrite a saved path or its completions");
    });

    await t.test("failed or expired attempts without an integrity marker still force unused papers", async () => {
      await database.db.collection<{ _id: string; duoId: string; status: string; active: boolean; parts: { contentId: string }[] }>("duo_assessments").insertOne({
        _id: randomUUID(), duoId, status: "failed", active: false,
        parts: gate.contentIds.map(contentId => ({ contentId })),
      });
      const first = await selection.exclusiveAssessmentSet(path, "gate", gate.contentIds, "academic", gate.id);
      assert.ok(first.every(id => !gate.contentIds.includes(id)));
      await database.db.collection<{ _id: string; duoId: string; status: string; active: boolean; parts: { contentId: string }[] }>("duo_assessments").insertOne({
        _id: randomUUID(), duoId, status: "failed", active: false,
        parts: first.map(contentId => ({ contentId })),
      });
      const second = await selection.exclusiveAssessmentSet(path, "gate", gate.contentIds, "academic", gate.id);
      assert.ok(second.every(id => ![...gate.contentIds, ...first].includes(id)));
      const reserved = band.gates.slice(1).flatMap(entry => entry.contentIds);
      assert.ok([...first, ...second].every(id => !reserved.includes(id)));
    });

    await t.test("a previously completed promotion room is excluded even without invalidation", async () => {
      await database.db.collection<{ _id: string; duoId: string; status: string; active: boolean; contentIds: string[] }>("duo_promotion_rooms").insertOne({
        _id: randomUUID(), duoId, status: "completed", active: false, contentIds: band.promotionContentIds,
      });
      const ids = await selection.exclusiveAssessmentSet(path, "promotion", band.promotionContentIds, "academic");
      assert.equal(ids.length, 4);
      assert.ok(ids.every(isExclusiveDuoContentId));
      assert.ok(ids.every(id => !band.promotionContentIds.includes(id)));
    });

    await t.test("private IDs cannot enter a standalone practice or exam attempt", async () => {
      for (const mode of ["practice", "exam"] as const)
        await assert.rejects(service.beforeAttempt({} as UserRecord, { contentId: gate.contentIds[0]!, mode }),
          error => error instanceof ApiError && error.status === 403);
    });

    assert.deepEqual(await database.content.find({}).sort({ _id: 1 }).toArray(), publicBefore);
    assert.equal(await database.users.countDocuments(), 0);
    assert.equal(await database.attempts.countDocuments(), 0);
  } finally {
    assert.match(database.db.databaseName, /^ielts_duo_exclusive_test_[a-f0-9]{32}$/);
    try { await database.db.dropDatabase(); } finally { await database.client.close(); }
  }
});
