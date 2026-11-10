import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createDuoService } from "../server/duo";
import { ensureExclusiveDuoBank, exclusiveDuoBank, isExclusiveDuoContentId } from "../server/duo-exam-content";
import { newTenDuoGatePapers } from "../server/data/duo-gate-supplement-4";
import { ApiError } from "../server/errors";
import { connectDatabase, type UserRecord } from "../server/storage";
import type { ContentKind, StoredContent } from "../shared/types";
import type { DuoRole } from "../shared/duo";

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

interface SharedAssessment {
  _id: string; userId: string; role: DuoRole; status: string; active: boolean; paperRevision?: number;
  parts: { contentId: string; attemptId: string | null }[];
}
interface SharedGate {
  id: string; contentIds: string[]; paperRevision?: number;
  results: Record<DuoRole, { status: string; assessmentId: string; at: string } | null>;
  paperReservations?: Partial<Record<DuoRole, { assessmentId: string; contentIds: string[]; paperRevision: number; reservedAt: string }>>;
}
interface SharedBand {
  unlockedAt: string | null;
  lessons: { number: number; completion: Record<DuoRole, unknown> }[];
  gates: SharedGate[];
}
interface SharedPath {
  _id: string; duoId: string; bands: Record<string, SharedBand>;
}

async function sharedGateFixture() {
  const name = "ielts_gate_pair_test_" + randomUUID().replaceAll("-", "");
  const database = await connectDatabase("mongodb://127.0.0.1:27017", name);
  let clock = Date.parse("2026-11-06T12:00:00.000Z");
  const iso = () => new Date(clock).toISOString();
  const duoId = "synthetic-shared-" + randomUUID();
  const users = Object.fromEntries((["husband", "wife"] as DuoRole[]).map(role => {
    const id = duoId + ":" + role;
    return [role, { _id: id, id, name: "Synthetic " + role, duoId, duoRole: role, email: role + "@fixture.invalid",
      passwordHash: null, currentBand: 3, targetBand: 8, testType: "academic", examDate: null,
      weeklyMinutes: 300, dailyMinutes: 45, cefr: "A2", createdAt: iso() } as UserRecord];
  })) as Record<DuoRole, UserRecord>;
  await database.users.insertMany(Object.values(users));
  const lessons = skills.map(publicLesson);
  await database.content.insertMany(lessons.map(content => ({ ...content, _id: content.id })));
  let readiness: (() => Promise<void>) | undefined;
  const service = createDuoService(database, { now: () => clock, ensureAudioReady: async () => { await readiness?.(); } });
  await service.initialize();
  const adapter = service as unknown as SelectionAdapter & {
    startGate(user: UserRecord, gateId: string): Promise<SharedAssessment>;
  };
  const band = await adapter.buildBand(3, duoId, "academic") as unknown as SharedBand;
  band.unlockedAt = iso();
  for (const lesson of band.lessons.filter(lesson => lesson.number <= 5))
    for (const role of ["husband", "wife"] as DuoRole[])
      lesson.completion[role] = { at: iso(), proofIds: ["synthetic-earned-proof"], kind: "attempt" };
  const paths = database.db.collection<SharedPath>("duo_learning_paths");
  await paths.insertOne({ _id: duoId, duoId, members: { husband: users.husband.id, wife: users.wife.id }, startingBand: 3,
    currentBand: 3, targetBand: 8, gateInterval: 5, sessionsPerBand: 20, passPercent: 70, strictRetakeMode: false,
    revision: 0, startedAt: iso(), updatedAt: iso(), bands: { b6: band } } as SharedPath);
  const gateId = band.gates[0]!.id;
  const records = database.db.collection<SharedAssessment>("duo_assessments");
  return { database, records, paths, users, duoId, gateId, iso,
    setReadiness(callback: (() => Promise<void>) | undefined) { readiness = callback; },
    advance(ms: number) { clock += ms; },
    start(role: DuoRole) { return adapter.startGate(users[role], gateId); },
    async settle(record: SharedAssessment, status: "failed" | "passed") {
      await records.updateOne({ _id: record._id }, { $set: { status, active: false } });
      await paths.updateOne({ _id: duoId }, { $set: { [`bands.b6.gates.0.results.${record.role}`]: {
        status, assessmentId: record._id, at: iso(),
      } } });
    },
    async close() { await database.db.dropDatabase(); await database.client.close(); },
  };
}

test("partners receive one shared private Gate paper and coordinated fresh retry rounds", async t => {
  const cases = async (action: (fixture: Awaited<ReturnType<typeof sharedGateFixture>>) => Promise<void>) => {
    const fixture = await sharedGateFixture();
    try { await action(fixture); } finally { await fixture.close(); }
  };
  const ids = (record: SharedAssessment) => record.parts.map(part => part.contentId);

  await t.test("ten additional sets recover all nineteen consumed Gate variants with fresh shared rounds and preserve every earlier result", () => cases(async f => {
    const newIds = new Set(newTenDuoGatePapers().map(paper => paper.id));
    const oldPapers = exclusiveDuoBank().filter(paper => paper.band === 3 && paper.format === "lesson" && !newIds.has(paper.id));
    assert.equal(oldPapers.length, 57);
    const history = Array.from({ length: 19 }, (_unused, index) => ({
      _id: "synthetic-prior-" + index, userId: f.users.husband.id, role: "husband" as const,
      duoId: f.duoId, gateId: f.gateId, kind: "gate", band: 3, status: "failed", active: false,
      createdAt: f.iso(), deadlineAt: f.iso(),
      parts: ["reading", "listening", "grammar"].map(skill => ({
        contentId: oldPapers.filter(paper => paper.skill === skill)[index]!.id, attemptId: null,
      })),
    }));
    await f.records.insertMany(history);
    const consumed = new Set<string>();
    for (let round = 0; round < 10; round++) {
      const husband = await f.start("husband"), wife = await f.start("wife");
      assert.deepEqual(ids(husband), ids(wife));
      assert.equal(ids(husband).length, 3);
      assert.ok(ids(husband).every(id => newIds.has(id) && !consumed.has(id)));
      assert.ok([...husband.parts, ...wife.parts].every(part => part.attemptId === null));
      ids(husband).forEach(id => consumed.add(id));
      await f.settle(husband, "failed"); await f.settle(wife, "failed");
    }
    assert.equal(consumed.size, 30);
    await assert.rejects(f.start("husband"), error => error instanceof ApiError && error.code === "DUO_GATE_PAPERS_EXHAUSTED");
    assert.equal(await f.records.countDocuments(), 39);
    for (const previous of history) assert.deepEqual(await f.records.findOne({ _id: previous._id }), previous);
    assert.equal(await f.database.db.collection("speech_audio.files").countDocuments(), 0);
  }));

  await t.test("sequential first starts use the exact same paper but retain separate answers", () => cases(async f => {
    const husband = await f.start("husband"), wife = await f.start("wife");
    assert.notEqual(husband._id, wife._id);
    assert.deepEqual(ids(husband), ids(wife));
    assert.ok(ids(husband).every(isExclusiveDuoContentId));
    assert.equal(husband.paperRevision, 1); assert.equal(wife.paperRevision, 1);
    assert.equal(await f.records.countDocuments(), 2);
  }));

  await t.test("concurrent partner starts and duplicate clicks cannot allocate separate paper sets", () => cases(async f => {
    const [first, second, wife] = await Promise.all([f.start("husband"), f.start("husband"), f.start("wife")]);
    assert.equal(first._id, second._id);
    assert.deepEqual(ids(first), ids(wife));
    assert.equal(await f.records.countDocuments(), 2);
  }));

  await t.test("both ordinary failed partners join the same fresh round even when retries race", () => cases(async f => {
    const first = await f.start("husband"), other = await f.start("wife");
    await f.settle(first, "failed"); await f.settle(other, "failed");
    const [husband, wife] = await Promise.all([f.start("husband"), f.start("wife")]);
    assert.deepEqual(ids(husband), ids(wife));
    assert.ok(ids(husband).every(id => !ids(first).includes(id)));
    assert.equal(husband.paperRevision, 2); assert.equal(wife.paperRevision, 2);
  }));

  await t.test("retry waits for an active partner and never invalidates their draft", () => cases(async f => {
    const husband = await f.start("husband"), wife = await f.start("wife");
    await f.settle(husband, "failed");
    await assert.rejects(f.start("husband"), /Người còn lại đang làm/u);
    assert.equal((await f.records.findOne({ _id: wife._id }))?.active, true);
    assert.equal(await f.records.countDocuments(), 2);
    await f.settle(wife, "failed");
    const replacement = await f.start("husband");
    assert.ok(ids(replacement).every(id => !ids(husband).includes(id)));
  }));

  await t.test("a passed partner keeps the earned receipt while the failed partner retries fresh", () => cases(async f => {
    const husband = await f.start("husband"), wife = await f.start("wife");
    await f.settle(husband, "failed"); await f.settle(wife, "passed");
    const replacement = await f.start("husband");
    assert.ok(ids(replacement).every(id => !ids(husband).includes(id)));
    assert.equal((await f.start("wife"))._id, wife._id);
    assert.equal((await f.paths.findOne({ _id: f.duoId }))?.bands.b6.gates[0]?.results.wife?.assessmentId, wife._id);
  }));

  await t.test("a pending first start fences an overlapping retry before its assessment insert", () => cases(async f => {
    const husband = await f.start("husband"); await f.settle(husband, "failed");
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const inside = new Promise<void>(resolve => { entered = resolve; });
    let calls = 0;
    f.setReadiness(async () => { if (++calls === 2) { entered(); await held; } });
    const starting = f.start("wife"); await inside;
    try { await assert.rejects(f.start("husband"), /Người còn lại đang làm/u); }
    finally { release(); }
    const wife = await starting;
    assert.deepEqual(ids(wife), ids(husband));
  }));

  await t.test("missing audio leaves no reservation and a stale pending ticket can recover", () => cases(async f => {
    f.setReadiness(async () => { throw new ApiError(409, "Synthetic missing cached audio"); });
    await assert.rejects(f.start("husband"), /missing cached audio/u);
    let path = await f.paths.findOne({ _id: f.duoId });
    assert.equal(path?.bands.b6.gates[0]?.paperReservations?.husband, undefined);
    f.setReadiness(undefined);
    const gate = path!.bands.b6.gates[0]!;
    await f.paths.updateOne({ _id: path!._id }, { $set: { "bands.b6.gates.0.paperReservations.husband": {
      assessmentId: "synthetic-crashed-start", contentIds: gate.contentIds, paperRevision: 1,
      reservedAt: new Date(Date.parse(f.iso()) - 61_000).toISOString(),
    } } });
    const assessment = await f.start("husband");
    assert.notEqual(assessment._id, "synthetic-crashed-start");
    path = await f.paths.findOne({ _id: path!._id });
    assert.equal(path?.bands.b6.gates[0]?.paperReservations?.husband, undefined);
  }));

  await t.test("a second readiness failure releases the pending start without resetting its partner", () => cases(async f => {
    let checks = 0;
    f.setReadiness(async () => { if (++checks === 2) throw new ApiError(409, "Synthetic transient cache lookup"); });
    await assert.rejects(f.start("husband"), /transient cache lookup/u);
    const path = await f.paths.findOne({ _id: f.duoId });
    assert.equal(path?.bands.b6.gates[0]?.paperReservations?.husband, undefined);
    assert.equal(await f.records.countDocuments(), 0);
    f.setReadiness(undefined);
    const wife = await f.start("wife"), husband = await f.start("husband");
    assert.deepEqual(ids(husband), ids(wife));
  }));

  await t.test("already active legacy partners keep different saved papers and their owned answers", () => cases(async f => {
    const husband = await f.start("husband"), wife = await f.start("wife");
    const path = await f.paths.findOne({ _id: f.duoId });
    const legacyIds = path!.bands.b6.gates[1]!.contentIds;
    const draftId = randomUUID();
    const parts = wife.parts.map((part, index) => ({ ...part, contentId: legacyIds[index]!,
      attemptId: index === 0 ? draftId : null }));
    await f.records.updateOne({ _id: wife._id }, { $set: { parts }, $unset: { paperRevision: "" } });
    const draft = { _id: draftId, id: draftId, userId: f.users.wife.id, duoAssessmentId: wife._id,
      contentId: legacyIds[0]!, skill: "reading", mode: "exam", status: "in-progress",
      responses: { "synthetic-owned-answer": "Keep this saved answer" }, startedAt: f.iso(),
      deadlineAt: new Date(Date.parse(f.iso()) + 60_000).toISOString(), feedback: null, submittedAt: null };
    const attempts = f.database.db.collection<typeof draft>("attempts");
    await attempts.insertOne(draft);
    const resumedWife = await f.start("wife"), resumedHusband = await f.start("husband");
    assert.equal(resumedWife._id, wife._id); assert.equal(resumedHusband._id, husband._id);
    assert.deepEqual(ids(resumedWife), legacyIds);
    assert.deepEqual(ids(resumedHusband), ids(husband));
    assert.equal(resumedWife.paperRevision, undefined);
    assert.deepEqual(await attempts.findOne({ _id: draftId }), draft);
    assert.equal(await f.records.countDocuments(), 2);
  }));

  await t.test("legacy failed partners get a fresh shared paper instead of a stale canonical variant", () => cases(async f => {
    const husband = await f.start("husband"), wife = await f.start("wife");
    const prior = ids(husband);
    const legacyOtherIds = prior.map(id => id.replace(/-0$/u, "-3"));
    assert.ok(legacyOtherIds.every((id, index) => id !== prior[index]));
    await f.records.updateOne({ _id: wife._id }, { $set: { parts: wife.parts.map((part, index) => ({ ...part, contentId: legacyOtherIds[index]! })) } });
    await f.settle(husband, "failed"); await f.settle(wife, "failed");
    await f.paths.updateOne({ _id: f.duoId }, { $unset: { "bands.b6.gates.0.paperRevision": "", "bands.b6.gates.0.paperReservations": "" } });
    const nextWife = await f.start("wife"), nextHusband = await f.start("husband");
    assert.deepEqual(ids(nextWife), ids(nextHusband));
    assert.ok(ids(nextWife).every(id => ![...prior, ...legacyOtherIds].includes(id)));
    assert.equal(nextWife.paperRevision, 1);
    assert.equal(nextHusband.paperRevision, 1);
  }));
});
