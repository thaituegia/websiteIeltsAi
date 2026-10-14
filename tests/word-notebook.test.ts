import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { test } from "node:test";
import { createApp } from "../server/app";
import { hashPassword } from "../server/auth";
import { parseDuoCredentials, provisionDuoAccounts } from "../server/duo-auth";
import { connectDatabase, type AttemptRecord, type PlacementRecord } from "../server/storage";
import { visibleWordContext } from "../server/word-notebook";
import type { DuoAssessmentView } from "../shared/duo";
import type { Feedback, PlacementItem, StoredContent, VocabularyEntry } from "../shared/types";

type Learner = "a" | "b";
const readingSentences = [
  "Amber volunteers restore habitats beside the river.",
  "The carpenter repairs a wooden bench beside the trail.",
  "A bank stores money securely.",
  "A well-known editor doesn't dismiss practical ideas.",
  "The patient gardener cultivates resilient orchids.",
];
const riverBankSentence = "The bank beside the river supports wild flowers.";
const hiddenListeningSentence = "The secretive organiser concealed a sapphire in the harbour.";

function content(skill: "reading" | "listening" = "reading"): StoredContent {
  const id = `synthetic-notebook-${skill}`;
  return {
    id, skill, title: `Synthetic notebook ${skill}`, description: "Private native HTTP fixture", topic: "Community",
    band: 5, cefr: "B1", testType: "academic", durationMinutes: 20, format: "lesson",
    sections: [
      { id: `${id}-section-0`, title: "Workshop", text: skill === "reading" ? readingSentences.join(" ") : hiddenListeningSentence,
        ...(skill === "listening" ? { dialogue: [{ speaker: "Organiser", accent: "british" as const, text: hiddenListeningSentence }] } : {}) },
      { id: `${id}-section-1`, title: "River", text: riverBankSentence },
    ],
    questions: [{ id: `${id}-q1`, number: 1, sectionIndex: 0, type: "choice", questionType: "multiple-choice",
      prompt: "Which compass should visitors bring?", options: ["silver compass", "wooden lantern"],
      answer: "silver compass", explanation: "PRIVATE ANSWER EXPLANATION", evidence: "PRIVATE ANSWER EVIDENCE", subskill: "details" },
    { id: `${id}-q2`, number: 2, sectionIndex: 0, type: "true-false", questionType: "true-false-not-given",
      prompt: "Visitors meet at midday.", answer: "TRUE", explanation: "PRIVATE TRUE FALSE EXPLANATION", evidence: "PRIVATE TRUE FALSE EVIDENCE", subskill: "details" },
    { id: `${id}-q3`, number: 3, sectionIndex: 0, type: "yes-no", questionType: "yes-no-not-given",
      prompt: "The author supports guided visits.", answer: "YES", explanation: "PRIVATE YES NO EXPLANATION", evidence: "PRIVATE YES NO EVIDENCE", subskill: "details" }],
    vocabularyIds: [], tags: ["synthetic-notebook"], source: "authored", quality: "authored-unreviewed",
    createdAt: "2026-10-14T00:00:00.000Z",
  };
}

function placementItem(id: string, skill: "reading" | "listening"): PlacementItem {
  return {
    id, skill, text: skill === "reading" ? "The diligent curator displays ancient pottery." : hiddenListeningSentence,
    question: "Which lantern should visitors carry?", options: ["brass lantern", "paper map", "blue bag", "red pen"],
    answer: "brass lantern", explanation: "PRIVATE PLACEMENT EXPLANATION", band: 5, cefr: "B1", difficulty: 0, subskill: "details",
  };
}

function feedback(skill: Feedback["skill"], item?: PlacementItem): Feedback {
  return {
    id: randomUUID(), skill, estimatedBand: 5, rawScore: 1, total: 1, summary: "Synthetic completed review",
    criteria: [], corrections: [], paragraphs: [], source: "rule-based", createdAt: "2026-10-14T00:00:00.000Z",
    answers: item ? [{ questionId: item.id, questionNumber: 1, response: item.answer, answer: item.answer, correct: true,
      explanation: item.explanation, evidence: item.text, subskill: item.subskill, prompt: item.question,
      options: item.options, context: item.text }] : [],
  };
}

function bankEntry(word: string, example: string, meaning: string): VocabularyEntry {
  return {
    id: `synthetic-notebook-vocabulary-${word}`, word, meaning, definition: "A financial institution.", partOfSpeech: "noun",
    ipa: "", cefr: "B1", topic: "Community", collocations: [], examples: [example], family: [], commonError: "",
    synonyms: [], register: "neutral",
  };
}

function assertSavePayload(body: any, word: string, alreadySaved: boolean): string {
  assert.deepEqual(Object.keys(body), ["saved"]);
  assert.deepEqual(Object.keys(body.saved).sort(), ["alreadySaved", "cardId", "word"]);
  assert.equal(body.saved.word, word);
  assert.equal(body.saved.alreadySaved, alreadySaved);
  assert.equal(typeof body.saved.cardId, "string");
  return body.saved.cardId;
}

function assertPrivateTranslation(body: any): void {
  assert.ok(Object.keys(body).every(key => key === "translation" || key === "card"));
  assert.ok(Object.keys(body.translation).every(key => ["word", "meaning", "definition", "partOfSpeech", "source", "context"].includes(key)));
  if (body.card) {
    for (const key of ["_id", "userId", "scheduler", "reviewLog", "answers", "feedback"])
      assert.equal(key in body.card, false, `Private ${key} leaked in translated card`);
  }
}

function gate() {
  let enter!: () => void;
  let release!: () => void;
  return {
    entered: new Promise<void>(resolve => { enter = resolve; }),
    released: new Promise<void>(resolve => { release = resolve; }),
    enter: () => enter(), release: () => release(),
  };
}

async function controlledOperation(promise: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("The controlled HTTP/provider operation did not start")), 5_000);
    })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

test("word context chooses a complete token when an earlier sentence contains only its prefix", () => {
  assert.equal(visibleWordContext("bank", ["The bankruptcy was unexpected. The bank grew."], "bank"), "The bank grew.");
});

test("native HTTP word notebook saves privately and translates only completed, authoritative context", { timeout: 90_000 }, async t => {
  const databaseName = `ielts_word_notebook_test_${randomUUID().replaceAll("-", "")}`;
  assert.match(databaseName, /^ielts_word_notebook_test_[a-f0-9]{32}$/);
  // This suite never uses application MONGODB_URI, seeded content, real credentials, or paid requests.
  const database = await connectDatabase("mongodb://127.0.0.1:27017", databaseName);
  let server: Server | undefined;
  let origin = "";
  const cookies: Record<Learner, string> = { a: "", b: "" };
  const users = {} as Record<Learner, { id: string }>;
  const providerCalls: { body: any; signal?: AbortSignal | null }[] = [];
  let providerMode: "success" | "failure" | "malformed" | "timeout" | "held" = "success";
  let heldProvider: ReturnType<typeof gate> | undefined;
  let providerMeaning = "nghĩa theo ngữ cảnh";
  const providerFetch: typeof globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.openai.com/v1/chat/completions", "Only the provider transport may be mocked");
    assert.equal(init?.method, "POST");
    assert.equal(typeof init?.body, "string");
    const body = JSON.parse(init!.body as string);
    assert.equal(body.model, "gpt-4o-mini");
    providerCalls.push({ body, signal: init?.signal });
    if (providerMode === "held") {
      assert.ok(heldProvider);
      const held = heldProvider;
      held.enter();
      let abort!: () => void;
      try {
        await Promise.race([held.released, new Promise<never>((_resolve, reject) => {
          abort = () => reject(new DOMException("Synthetic abort", "AbortError"));
          if (init?.signal?.aborted) abort();
          else init?.signal?.addEventListener("abort", abort, { once: true });
        })]);
      } finally {
        init?.signal?.removeEventListener("abort", abort);
      }
    }
    if (providerMode === "timeout") {
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => reject(new DOMException("Synthetic abort", "AbortError"));
        if (init?.signal?.aborted) abort();
        else init?.signal?.addEventListener("abort", abort, { once: true });
      });
    }
    if (providerMode === "failure")
      return new Response("provider-private-marker synthetic-provider-key", { status: 500 });
    return Response.json({ choices: [{ message: { content: providerMode === "malformed" ? "not valid JSON: provider-private-marker" : JSON.stringify({
      meaning: providerMeaning, definition: "A definition for the selected sentence.", partOfSpeech: "noun",
    }) } }] });
  };

  async function request(who: Learner | null, method: string, path: string, payload?: unknown, expected: number | readonly number[] = 200): Promise<any> {
    const response = await globalThis.fetch(`${origin}/api${path}`, {
      method, headers: { ...(who && cookies[who] ? { Cookie: cookies[who] } : {}),
        ...(payload === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    const cookie = response.headers.getSetCookie().at(-1);
    if (who && cookie) cookies[who] = cookie.split(";")[0];
    const body = await response.json();
    const statuses = typeof expected === "number" ? [expected] : expected;
    assert.ok(statuses.includes(response.status), `${method} ${path}: expected ${statuses.join("/")}, got ${response.status}: ${JSON.stringify(body)}`);
    return body;
  }

  async function attempt(who: Learner, source: StoredContent, status: AttemptRecord["status"], mode: AttemptRecord["mode"] = "exam"): Promise<AttemptRecord> {
    const id = randomUUID();
    const row: AttemptRecord = {
      _id: id, id, userId: users[who].id, contentId: source.id, title: source.title, skill: source.skill, mode, status,
      startedAt: "2026-10-14T12:00:00.000Z", deadlineAt: "2099-10-14T12:20:00.000Z",
      submittedAt: status === "submitted" ? "2026-10-14T12:10:00.000Z" : null, durationSeconds: 93,
      responses: { [source.questions[0].id]: "synthetic saved draft" }, essays: { task: "Synthetic essay draft" },
      transcript: "Synthetic speaking draft", feedback: status === "submitted" ? feedback(source.skill) : null,
      ...(status === "invalidated" ? { invalidatedAt: "2026-10-14T12:01:00.000Z", integrityReason: "hidden" } : {}),
    };
    await database.attempts.insertOne(row);
    return row;
  }

  async function placement(who: Learner, item: PlacementItem, state: "active" | "complete" | "deadline" | "partial" | "invalidated"): Promise<PlacementRecord> {
    const review = feedback("placement", item);
    const completed = state === "complete" || state === "deadline" || state === "partial";
    const row: PlacementRecord = {
      _id: randomUUID(), userId: users[who].id, mode: "quick", total: state === "deadline" || state === "partial" ? 12 : 1,
      theta: 0, standardError: 1, estimatedBand: 5, currentQuestionId: state === "active" ? item.id : null,
      answers: completed ? [{ questionId: item.id, answer: item.answer, correct: true, review: review.answers[0] }] : [],
      result: completed ? review : null, startedAt: "2026-10-14T12:00:00.000Z", deadlineAt: "2099-10-14T12:20:00.000Z",
      draftAnswer: state === "active" ? { questionId: item.id, answer: item.options[1] } : null,
      ...(state === "complete" ? { completionReason: "answered" as const } : {}),
      ...(state === "deadline" ? { completionReason: "deadline" as const } : {}),
      ...(state === "invalidated" ? { completionReason: "invalidated" as const, invalidatedAt: "2026-10-14T12:01:00.000Z" } : {}),
    };
    await database.placements.insertOne(row);
    return row;
  }

  async function protectedDocuments() {
    const names = ["users", "sessions", "attempts", "placements", "plans", "audio", "recordings.files", "recordings.chunks", "content", "placementItems", "vocabulary"];
    return Object.fromEntries(await Promise.all(names.map(async name => [name, await database.db.collection(name).find({}).sort({ _id: 1 }).toArray()])));
  }

  try {
    const reading = content();
    const listening = content("listening");
    const readingPlacement = placementItem("synthetic-notebook-placement-reading", "reading");
    const listeningPlacement = placementItem("synthetic-notebook-placement-listening", "listening");
    const unservedPlacement = placementItem("synthetic-notebook-placement-unserved", "reading");
    await database.content.insertMany([reading, listening].map(row => ({ ...row, _id: row.id })));
    await database.placementItems.insertMany([readingPlacement, listeningPlacement, unservedPlacement].map(row => ({ ...row, _id: row.id })));
    const bank = bankEntry("bank", readingSentences[2], "ngân hàng");
    await database.vocabulary.insertOne({ ...bank, _id: bank.id });
    server = createApp(database, { production: false, serveClient: false, duoEnabled: false, demoEnabled: false,
      examIntegrityEnabled: false, maxLearners: 2, wordTranslation: { fetch: providerFetch, apiKey: () => "synthetic-provider-key", timeoutMs: 300 } }).listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    origin = `http://127.0.0.1:${address.port}`;
    for (const who of ["a", "b"] as const) {
      users[who] = (await request(who, "POST", "/auth/register", { name: `Synthetic Notebook ${who.toUpperCase()}`,
        email: `synthetic-notebook-${who}@example.test`, password: "synthetic-notebook-password", targetBand: 6.5, testType: "academic" }, 201)).user;
    }

    const active = await attempt("a", reading, "in-progress");
    const practice = await attempt("a", reading, "in-progress", "practice");
    const submitted = await attempt("a", reading, "submitted");
    submitted.feedback!.answers.push({ questionId: reading.questions[0].id, response: reading.questions[0].answer,
      answer: reading.questions[0].answer, correct: true, explanation: "PRIVATE ANSWER EXPLANATION", evidence: "PRIVATE ANSWER EVIDENCE",
      subskill: "details", sectionTitle: "Historic observatory" });
    await database.attempts.replaceOne({ _id: submitted.id }, submitted);
    const raceSource = await attempt("a", reading, "submitted");
    const invalidated = await attempt("a", reading, "invalidated");
    const listeningActive = await attempt("a", listening, "in-progress");
    const listeningPractice = await attempt("a", listening, "in-progress", "practice");
    const listeningSubmitted = await attempt("a", listening, "submitted");
    const peer = await attempt("b", reading, "submitted");
    const placementActive = await placement("a", readingPlacement, "active");
    const placementListening = await placement("a", listeningPlacement, "active");
    const placementComplete = await placement("a", readingPlacement, "complete");
    const placementDeadline = await placement("a", listeningPlacement, "deadline");
    const placementPartial = await placement("a", readingPlacement, "partial");
    const placementInvalidated = await placement("a", readingPlacement, "invalidated");
    const placementPeer = await placement("b", readingPlacement, "complete");

    const legacy = (await request("a", "POST", "/vocabulary/cards", { word: "habitats", meaning: "legacy meaning", example: "Legacy example" }, 201)).card;
    const reviewed = (await request("a", "POST", `/vocabulary/cards/${legacy.id}/review`, { rating: 4 })).card;
    assert.equal(reviewed.reps, 1);
    const legacyBefore = await database.cards.findOne({ _id: legacy.id });
    const upload = database.recordings.openUploadStream("synthetic-notebook-recording", { contentType: "audio/wav" });
    upload.end(Buffer.from("synthetic-audio-preservation-fixture"));
    await once(upload, "finish");
    await database.audio.insertOne({ _id: randomUUID(), userId: users.a.id, attemptId: submitted.id, fileId: upload.id,
      mime: "audio/wav", createdAt: "2026-10-14T12:00:00.000Z" });
    await database.db.collection<{ _id: string; userId: string; weekStart: string; synthetic: string }>("plans")
      .insertOne({ _id: randomUUID(), userId: users.a.id, weekStart: "2026-10-12", synthetic: "preserve history" });
    const protectedBefore = await protectedDocuments();

    await t.test("ownership and completion gates run before any provider call", async () => {
      const selection = { word: "restore", context: readingSentences[0], sectionIndex: 0 };
      await request(null, "POST", `/attempts/${submitted.id}/words`, selection, 401);
      for (const suffix of ["words", "words/translate"]) {
        await request("b", "POST", `/attempts/${submitted.id}/${suffix}`, selection, 404);
        await request("a", "POST", `/attempts/${peer.id}/${suffix}`, selection, 404);
        await request("a", "POST", `/attempts/${randomUUID()}/${suffix}`, selection, 404);
        await request("b", "POST", `/placement/${placementComplete._id}/${suffix}`, { word: "curator", questionId: readingPlacement.id }, 404);
        await request("a", "POST", `/placement/${placementPeer._id}/${suffix}`, { word: "curator", questionId: readingPlacement.id }, 404);
      }
      for (const row of [active, practice, invalidated])
        await request("a", "POST", `/attempts/${row.id}/words/translate`, selection, 409);
      for (const row of [placementActive, placementListening, placementPartial, placementInvalidated])
        await request("a", "POST", `/placement/${row._id}/words/translate`, { word: "lantern", questionId: row.currentQuestionId ?? readingPlacement.id }, 409);
      assert.equal(providerCalls.length, 0);
      assert.equal(await database.cards.countDocuments({}), 1);
    });

    await t.test("save validates a complete English token against visible authoritative text", async () => {
      for (const word of ["", "two words", "river.", "123", "café", "a".repeat(81), "store", "habitat", "<script>"])
        await request("a", "POST", `/attempts/${active.id}/words`, { word, sectionIndex: 0 }, 400);
      await request("a", "POST", `/attempts/${active.id}/words`, { word: "restore", context: "Amber volunteers restore SECRET INVENTED INSTRUCTIONS.", sectionIndex: 0 }, 400);
      await request("a", "POST", `/attempts/${active.id}/words`, { word: "habitat", context: "habitat", sectionIndex: 0 }, 400);
      await request("a", "POST", `/attempts/${active.id}/words`, { word: "known", context: "known", sectionIndex: 0 }, 400);
      await request("a", "POST", `/attempts/${active.id}/words`, { word: "restore", context: readingSentences[0], sectionIndex: 1 }, 400);
      await request("a", "POST", `/attempts/${active.id}/words`, { word: "restore", sectionIndex: -1 }, 400);
      await request("a", "POST", `/attempts/${active.id}/words`, { word: "restore", sectionIndex: 99 }, 400);
      await request("a", "POST", `/placement/${placementActive._id}/words`, { word: "curator", questionId: unservedPlacement.id }, 400);
      await request("a", "POST", `/placement/${placementActive._id}/words`, { word: "curator", questionId: readingPlacement.id, context: "The curator invented this context." }, 400);
      await request("a", "POST", `/attempts/${listeningActive.id}/words`, { word: "sapphire", context: hiddenListeningSentence, sectionIndex: 0 }, 400);
      await request("a", "POST", `/placement/${placementListening._id}/words`, { word: "sapphire", context: hiddenListeningSentence, questionId: listeningPlacement.id }, 400);
      assert.equal(providerCalls.length, 0);
      assert.equal(await database.cards.countDocuments({}), 1);
      assertSavePayload(await request("a", "POST", `/attempts/${active.id}/words`, { word: "well-known", context: readingSentences[3], sectionIndex: 0 }, 201), "well-known", false);
      assertSavePayload(await request("a", "POST", `/attempts/${active.id}/words`, { word: "doesn't", context: readingSentences[3], sectionIndex: 0 }, 201), "doesn't", false);
      assertSavePayload(await request("a", "POST", `/attempts/${listeningActive.id}/words`, { word: "compass", context: listening.questions[0].prompt, sectionIndex: 0 }, 201), "compass", false);
      assertSavePayload(await request("a", "POST", `/placement/${placementListening._id}/words`, { word: "lantern", context: listeningPlacement.question, questionId: listeningPlacement.id }, 201), "lantern", false);
      assertSavePayload(await request("a", "POST", `/attempts/${listeningPractice.id}/words`, { word: "sapphire", context: hiddenListeningSentence, sectionIndex: 0 }, 201), "sapphire", false);
      for (const word of ["true", "false", "yes", "no"])
        assertSavePayload(await request("a", "POST", `/attempts/${active.id}/words`, { word, context: word.toUpperCase(), sectionIndex: 0 }, 201), word, false);
      assertSavePayload(await request("a", "POST", `/attempts/${submitted.id}/words`, {
        word: "observatory", context: "Historic observatory", sectionIndex: 0 }, 201), "observatory", false);
      assert.equal(providerCalls.length, 0);
    });

    let restoreCardId = "";
    await t.test("exam save is pending, response contains only acknowledgement, and owners deduplicate atomically", async () => {
      restoreCardId = assertSavePayload(await request("a", "POST", `/attempts/${active.id}/words`, {
        word: "  RESTORE  ", context: readingSentences[0], sectionIndex: 0 }, 201), "restore", false);
      const pending = await database.cards.findOne({ _id: restoreCardId });
      assert.ok(pending);
      assert.equal(pending.meaning, "");
      assert.equal(pending.meaningStatus, "pending");
      assert.deepEqual(pending.origin, { kind: "attempt", resourceId: active.id, context: readingSentences[0], sectionIndex: 0 });
      assert.equal(pending.reps, 0);
      assert.equal(pending.stability, 0);
      assert.deepEqual(pending.reviewLog, []);
      const duplicate = await request("a", "POST", `/attempts/${submitted.id}/words`, { word: "Restore", context: readingSentences[0], sectionIndex: 0 });
      assert.equal(assertSavePayload(duplicate, "restore", true), restoreCardId);
      const recaptured = await database.cards.findOne({ _id: restoreCardId });
      assert.deepEqual(recaptured, { ...pending, origin: { ...pending.origin!, resourceId: submitted.id } });
      const concurrent = await Promise.all(Array.from({ length: 8 }, () => request("a", "POST", `/attempts/${active.id}/words`, {
        word: "orchids", context: readingSentences[4], sectionIndex: 0 }, [200, 201])));
      assert.equal(new Set(concurrent.map(row => row.saved.cardId)).size, 1);
      assert.equal(concurrent.filter(row => row.saved.alreadySaved === false).length, 1);
      for (const row of concurrent) assertSavePayload(row, "orchids", row.saved.alreadySaved);
      assert.equal(await database.cards.countDocuments({ userId: users.a.id, word: "orchids" }), 1);
      const other = assertSavePayload(await request("b", "POST", `/attempts/${peer.id}/words`, { word: "restore", context: readingSentences[0], sectionIndex: 0 }, 201), "restore", false);
      assert.notEqual(other, restoreCardId);
      const placementSaved = assertSavePayload(await request("a", "POST", `/placement/${placementActive._id}/words`, {
        word: "curator", context: readingPlacement.text, questionId: readingPlacement.id }, 201), "curator", false);
      assert.deepEqual((await database.cards.findOne({ _id: placementSaved }))!.origin,
        { kind: "placement", resourceId: placementActive._id, context: readingPlacement.text, questionId: readingPlacement.id });
      assertSavePayload(await request("a", "POST", `/attempts/${active.id}/words`, { word: "habitats", context: readingSentences[0], sectionIndex: 0 }), "habitats", true);
      assert.deepEqual(await database.cards.findOne({ _id: legacy.id }), legacyBefore);
      assert.equal(providerCalls.length, 0);
      assert.deepEqual(await protectedDocuments(), protectedBefore);
    });

    await t.test("a bank word stays pending until completion and only a compatible sentence reuses the bank", async () => {
      const bankCardId = assertSavePayload(await request("a", "POST", `/attempts/${active.id}/words`, {
        word: "bank", context: readingSentences[2], sectionIndex: 0 }, 201), "bank", false);
      assert.equal((await database.cards.findOne({ _id: bankCardId }))!.meaning, "");
      await request("a", "POST", `/attempts/${active.id}/words/translate`, { word: "bank", context: readingSentences[2], sectionIndex: 0 }, 409);
      const compatible = await request("a", "POST", `/attempts/${submitted.id}/words/translate`, { word: "bank", context: readingSentences[2], sectionIndex: 0 });
      assertPrivateTranslation(compatible);
      assert.equal(compatible.translation.source, "bank");
      assert.equal(compatible.translation.meaning, "ngân hàng");
      assert.equal(compatible.translation.context, readingSentences[2]);
      assert.equal(compatible.card.id, bankCardId);
      assert.equal(compatible.card.meaningStatus, "ready");
      assert.equal(providerCalls.length, 0);
      const bankCard = await database.cards.findOne({ _id: bankCardId });
      providerMeaning = "bờ sông";
      const differentSense = await request("a", "POST", `/attempts/${submitted.id}/words/translate`, { word: "bank", context: riverBankSentence, sectionIndex: 1 });
      assertPrivateTranslation(differentSense);
      assert.equal(differentSense.translation.source, "openai");
      assert.equal(differentSense.translation.meaning, "bờ sông");
      assert.equal(differentSense.translation.context, riverBankSentence);
      assert.equal(providerCalls.length, 1);
      assert.deepEqual(await database.cards.findOne({ _id: bankCardId }), bankCard, "Translation must not overwrite a ready card's other sense");
    });

    await t.test("mocked completion fills a pending card without changing its FSRS schedule, then caches its exact context", async () => {
      const before = await database.cards.findOne({ _id: restoreCardId });
      providerMeaning = "khôi phục";
      const callsBefore = providerCalls.length;
      const translated = await request("a", "POST", `/attempts/${submitted.id}/words/translate`, { word: "restore", context: readingSentences[0], sectionIndex: 0 });
      assertPrivateTranslation(translated);
      assert.equal(translated.translation.word, "restore");
      assert.equal(translated.translation.meaning, "khôi phục");
      assert.equal(translated.translation.source, "openai");
      assert.equal(translated.translation.context, readingSentences[0]);
      assert.equal(translated.card.id, restoreCardId);
      assert.equal(translated.card.meaningStatus, "ready");
      assert.equal(providerCalls.length, callsBefore + 1);
      const after = await database.cards.findOne({ _id: restoreCardId });
      assert.ok(before && after);
      assert.equal(after.translationContext, readingSentences[0]);
      for (const key of ["scheduler", "reviewLog", "savedAt", "dueAt", "reps", "stability", "difficulty", "origin"] as const)
        assert.deepEqual(after[key], before[key], `Translation changed ${key}`);
      const cached = await request("a", "POST", `/attempts/${submitted.id}/words/translate`, { word: "restore", context: readingSentences[0], sectionIndex: 0 });
      assert.equal(cached.translation.meaning, translated.translation.meaning);
      assert.equal(providerCalls.length, callsBefore + 1);
      const providerText = JSON.stringify(providerCalls.at(-1)!.body.messages);
      assert.ok(providerText.includes("restore"));
      assert.ok(providerText.includes(readingSentences[0]));
      assert.equal(providerText.includes("PRIVATE ANSWER"), false);
    });

    await t.test("translation neither auto-saves a word nor reuses or overwrites a generic legacy meaning", async () => {
      const cardsBefore = await database.cards.countDocuments({});
      const translated = await request("a", "POST", `/attempts/${submitted.id}/words/translate`, { word: "river", context: readingSentences[0], sectionIndex: 0 });
      assertPrivateTranslation(translated);
      assert.equal(translated.translation.source, "openai");
      assert.equal("card" in translated, false);
      assert.equal(await database.cards.countDocuments({}), cardsBefore);
      const callsBefore = providerCalls.length;
      providerMeaning = "môi trường sống";
      const legacyTranslation = await request("a", "POST", `/attempts/${submitted.id}/words/translate`, { word: "habitats", context: readingSentences[0], sectionIndex: 0 });
      assert.equal(legacyTranslation.translation.source, "openai");
      assert.equal(legacyTranslation.translation.meaning, "môi trường sống");
      assert.equal(providerCalls.length, callsBefore + 1);
      assert.deepEqual(await database.cards.findOne({ _id: legacy.id }), legacyBefore);
      const peerPending = await database.cards.findOne({ userId: users.b.id, word: "restore" });
      assert.equal(peerPending!.meaning, "");
      assert.equal(peerPending!.meaningStatus, "pending");
    });

    await t.test("a different sentence's translation cannot enrich a pending card captured in another context", async () => {
      const id = assertSavePayload(await request("a", "POST", `/attempts/${submitted.id}/words`, {
        word: "river", context: readingSentences[0], sectionIndex: 0 }, 201), "river", false);
      const pending = await database.cards.findOne({ _id: id });
      providerMeaning = "dòng sông";
      const translated = await request("a", "POST", `/attempts/${submitted.id}/words/translate`, {
        word: "river", context: riverBankSentence, sectionIndex: 1 });
      assert.equal(translated.translation.context, riverBankSentence);
      assert.equal(translated.translation.meaning, "dòng sông");
      assert.equal(translated.card.id, id);
      assert.equal(translated.card.meaningStatus, "pending");
      assert.equal(translated.card.meaning, "");
      assert.deepEqual(await database.cards.findOne({ _id: id }), pending);
    });

    await t.test("the existing manual-card endpoint resolves a pending notebook card without resetting its schedule", async () => {
      const id = assertSavePayload(await request("a", "POST", `/attempts/${active.id}/words`, {
        word: "patient", context: readingSentences[4], sectionIndex: 0 }, 201), "patient", false);
      const pending = await database.cards.findOne({ _id: id });
      await request("a", "POST", `/vocabulary/cards/${id}/review`, { rating: 4 }, 409);
      assert.deepEqual(await database.cards.findOne({ _id: id }), pending);
      const resolved = await request("a", "POST", "/vocabulary/cards", { word: "PATIENT", meaning: "kiên nhẫn" });
      assert.equal(resolved.card.id, id);
      assert.equal(resolved.card.meaningStatus, "ready");
      assert.equal(resolved.card.meaning, "kiên nhẫn");
      const ready = await database.cards.findOne({ _id: id });
      assert.ok(pending && ready);
      for (const key of ["scheduler", "reviewLog", "savedAt", "dueAt", "reps", "stability", "difficulty"] as const)
        assert.deepEqual(ready[key], pending[key], `Manual completion changed ${key}`);
      const duplicate = await request("a", "POST", "/vocabulary/cards", { word: "patient", meaning: "A later duplicate meaning" });
      assert.equal(duplicate.card.id, id);
      assert.equal(duplicate.card.meaning, "kiên nhẫn");
      assert.deepEqual(await database.cards.findOne({ _id: id }), ready);
    });

    await t.test("identical concurrent review translations share one provider request and remain reusable after saving", async () => {
      const selection = { word: "carpenter", context: readingSentences[1], sectionIndex: 0 };
      const callsBefore = providerCalls.length;
      const cardsBefore = await database.cards.countDocuments({});
      const held = gate();
      heldProvider = held;
      providerMode = "held";
      providerMeaning = "thợ mộc";
      const sourceReads = gate();
      const originalFind = database.content.findOne.bind(database.content);
      let resolvedSources = 0;
      Object.assign(database.content, { findOne: async (filter: any, options: any) => {
        const row = await originalFind(filter, options);
        if (filter._id === reading.id && ++resolvedSources === 6) sourceReads.enter();
        return row;
      } });
      const responses = Promise.all(Array.from({ length: 6 }, () => request("a", "POST", `/attempts/${submitted.id}/words/translate`, selection)));
      try {
        await controlledOperation(Promise.all([held.entered, sourceReads.entered]).then(() => {}));
        // Let every completed source read continue while the provider remains held.
        await new Promise<void>(resolve => setImmediate(resolve));
        assert.equal(providerCalls.length, callsBefore + 1);
        held.release();
        const translated = await responses;
        assert.equal(providerCalls.length, callsBefore + 1);
        for (const body of translated) {
          assertPrivateTranslation(body);
          assert.deepEqual(body.translation, translated[0].translation);
          assert.equal("card" in body, false);
        }
        assert.equal(await database.cards.countDocuments({}), cardsBefore);
      } finally {
        held.release();
        await responses.catch(() => {});
        Object.assign(database.content, { findOne: originalFind });
        providerMode = "success";
        heldProvider = undefined;
      }
      const saved = assertSavePayload(await request("a", "POST", `/attempts/${submitted.id}/words`, selection, 201), "carpenter", false);
      assert.equal((await database.cards.findOne({ _id: saved }))!.meaningStatus, "pending");
      const cached = await request("a", "POST", `/attempts/${submitted.id}/words/translate`, selection);
      assert.equal(cached.translation.meaning, "thợ mộc");
      assert.equal(cached.card.id, saved);
      assert.equal(cached.card.meaningStatus, "ready");
      assert.equal(providerCalls.length, callsBefore + 1);
    });

    await t.test("invalidation while provider work is held blocks disclosure and leaves the saved card pending", async () => {
      const selection = { word: "volunteers", context: readingSentences[0], sectionIndex: 0 };
      const cardId = assertSavePayload(await request("a", "POST", `/attempts/${raceSource.id}/words`, selection, 201), "volunteers", false);
      const pending = await database.cards.findOne({ _id: cardId });
      const callsBefore = providerCalls.length;
      const held = gate();
      heldProvider = held;
      providerMode = "held";
      providerMeaning = "PRIVATE RACE MEANING";
      const response = request("a", "POST", `/attempts/${raceSource.id}/words/translate`, selection, 409);
      try {
        await controlledOperation(held.entered);
        await database.attempts.updateOne({ _id: raceSource.id }, { $set: {
          status: "invalidated", invalidatedAt: "2026-10-14T12:11:00.000Z", integrityReason: "hidden",
        } });
        held.release();
        const rejected = await response;
        assert.equal(providerCalls.length, callsBefore + 1);
        assert.equal("translation" in rejected, false);
        assert.equal("card" in rejected, false);
        assert.equal(JSON.stringify(rejected).includes("PRIVATE RACE MEANING"), false);
        assert.deepEqual(await database.cards.findOne({ _id: cardId }), pending);
      } finally {
        held.release();
        await response.catch(() => {});
        // This deliberate race mutates only this disposable fixture; restore it for the preservation check.
        await database.attempts.replaceOne({ _id: raceSource.id }, raceSource);
        providerMode = "success";
        heldProvider = undefined;
      }
    });

    await t.test("provider failures, invalid JSON and timeout keep the pending card retryable and hide provider details", async () => {
      const selection = { word: "gardener", context: readingSentences[4], sectionIndex: 0 };
      const id = assertSavePayload(await request("a", "POST", `/attempts/${active.id}/words`, selection, 201), "gardener", false);
      const pending = await database.cards.findOne({ _id: id });
      for (const mode of ["failure", "malformed", "timeout"] as const) {
        providerMode = mode;
        const callsBefore = providerCalls.length;
        const failure = await request("a", "POST", `/attempts/${submitted.id}/words/translate`, selection, 503);
        assert.equal(providerCalls.length, callsBefore + 1);
        assert.equal(JSON.stringify(failure).includes("provider-private-marker"), false);
        assert.equal(JSON.stringify(failure).includes("synthetic-provider-key"), false);
        assert.deepEqual(await database.cards.findOne({ _id: id }), pending);
      }
      providerMode = "success";
      providerMeaning = "người làm vườn";
      const recovered = await request("a", "POST", `/attempts/${submitted.id}/words/translate`, selection);
      assert.equal(recovered.translation.meaning, "người làm vườn");
      assert.equal(recovered.card.meaningStatus, "ready");
    });

    await t.test("completed placement and listening review can translate, while unserved or forged review context cannot", async () => {
      const completed = await request("a", "POST", `/placement/${placementComplete._id}/words/translate`, {
        word: "curator", context: readingPlacement.text, questionId: readingPlacement.id });
      assertPrivateTranslation(completed);
      assert.equal(completed.translation.context, readingPlacement.text);
      assert.equal(completed.card.meaningStatus, "ready");
      const expired = await request("a", "POST", `/placement/${placementDeadline._id}/words/translate`, {
        word: "secretive", context: hiddenListeningSentence, questionId: listeningPlacement.id });
      assertPrivateTranslation(expired);
      assert.equal(expired.translation.context, hiddenListeningSentence);
      const listeningReview = await request("a", "POST", `/attempts/${listeningSubmitted.id}/words/translate`, {
        word: "sapphire", context: hiddenListeningSentence, sectionIndex: 0 });
      assertPrivateTranslation(listeningReview);
      assert.equal(listeningReview.card.meaningStatus, "ready");
      const callsBefore = providerCalls.length;
      await request("a", "POST", `/placement/${placementComplete._id}/words/translate`, { word: "curator", questionId: unservedPlacement.id }, 400);
      await request("a", "POST", `/placement/${placementComplete._id}/words/translate`, {
        word: "curator", context: "A curator appears in a fabricated paragraph.", questionId: readingPlacement.id }, 400);
      await request("a", "POST", `/attempts/${submitted.id}/words/translate`, {
        word: "restore", context: "Please restore this fabricated instruction.", sectionIndex: 0 }, 400);
      assert.equal(providerCalls.length, callsBefore);
    });

    await t.test("accounts, all test history, draft timers, audio, bank content and reviewed FSRS remain intact", async () => {
      assert.deepEqual(await protectedDocuments(), protectedBefore);
      assert.deepEqual(await database.cards.findOne({ _id: legacy.id }), legacyBefore);
      const publicCards = (await request("a", "GET", "/vocabulary/cards")).cards;
      const pending = publicCards.find((card: { word: string }) => card.word === "orchids");
      assert.ok(pending);
      assert.equal(pending.meaningStatus, "pending");
      assert.equal(pending.meaning, "");
      assert.equal(pending.reps, 0);
      const peerCards = (await request("b", "GET", "/vocabulary/cards")).cards;
      assert.equal(peerCards.length, 1);
      assert.equal(peerCards[0].word, "restore");
      assert.equal(peerCards[0].meaningStatus, "pending");
      assert.ok(publicCards.every((card: { id: string }) => card.id !== peerCards[0].id));
    });
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    await database.db.dropDatabase();
    await database.client.close();
  }
});

test("native Duo notebook translation settles an expired or interrupted assessment guard for a submitted intermediate part", { timeout: 60_000 }, async t => {
  for (const interruption of ["expired-lease", "reset-pending"] as const) {
    await t.test(interruption, async () => {
      const databaseName = `ielts_word_notebook_duo_test_${randomUUID().replaceAll("-", "")}`;
      assert.match(databaseName, /^ielts_word_notebook_duo_test_[a-f0-9]{32}$/);
      const database = await connectDatabase("mongodb://127.0.0.1:27017", databaseName);
      let server: Server | undefined;
      let cookie = "";
      let origin = "";
      let now = Date.parse("2026-10-14T12:00:00.000Z");
      const at = () => new Date(now).toISOString();
      let providerCalls = 0;
      const providerFetch: typeof globalThis.fetch = async input => {
        assert.equal(String(input), "https://api.openai.com/v1/chat/completions");
        providerCalls++;
        return Response.json({ choices: [{ message: { content: JSON.stringify({
          meaning: "PRIVATE DUO MEANING", definition: "Synthetic contextual meaning.", partOfSpeech: "verb",
        }) } }] });
      };
      async function request(method: string, path: string, payload?: unknown, expected = 200, tabId?: string): Promise<any> {
        const response = await globalThis.fetch(`${origin}/api${path}`, {
          method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(payload === undefined ? {} : { "Content-Type": "application/json" }),
            ...(tabId ? { "X-Exam-Tab": tabId } : {}) }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
        });
        const created = response.headers.getSetCookie().at(-1);
        if (created) cookie = created.split(";")[0];
        const body = await response.json();
        assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(body)}`);
        return body;
      }
      try {
        const base = content();
        const bank: StoredContent[] = [0, 1].map(index => {
          const id = `synthetic-notebook-duo-reading-${index}`;
          return { ...base, id, title: `Synthetic Duo passage ${index}`, band: 6, cefr: "B2",
            sections: [{ ...base.sections[0], id: `${id}-section`,
              text: index === 0 ? readingSentences[0] : "Local museums support educational programmes for families." }],
            questions: [{ ...base.questions[0], id: `${id}-q1` }] };
        });
        await database.content.insertMany(bank.map(row => ({ ...row, _id: row.id })));
        const settings = parseDuoCredentials({ duoId: `synthetic-notebook-duo-${interruption}`, accounts: [
          { role: "husband", name: "Synthetic Notebook Duo A", phone: "0390000091", passwordHash: await hashPassword("synthetic-notebook-duo-password-a") },
          { role: "wife", name: "Synthetic Notebook Duo B", phone: "0390000092", passwordHash: await hashPassword("synthetic-notebook-duo-password-b") },
        ] });
        const users = await provisionDuoAccounts(database, settings);
        const members = { husband: users.find(user => user.duoRole === "husband")!.id,
          wife: users.find(user => user.duoRole === "wife")!.id };
        await database.users.updateMany({ duoId: settings.duoId }, { $set: { currentBand: 6, cefr: "B2" } });
        const completion = {
          husband: { at: at(), proofIds: ["synthetic-notebook-duo-practice-a"], kind: "attempt" },
          wife: { at: at(), proofIds: ["synthetic-notebook-duo-practice-b"], kind: "attempt" },
        };
        const gateId = "synthetic-notebook-duo:gate";
        const path = {
          _id: settings.duoId, duoId: settings.duoId, members, startingBand: 6, currentBand: 6, targetBand: 8,
          gateInterval: 5, sessionsPerBand: 5, passPercent: 70, strictRetakeMode: false, revision: 0, startedAt: at(), updatedAt: at(),
          bands: { b12: {
            band: 6, unlockedAt: at(), completedAt: null,
            lessons: Array.from({ length: 5 }, (_, index) => ({ id: `synthetic-notebook-duo:lesson:${index}`, number: index + 1,
              title: "Completed synthetic practice", kind: "reading", contentId: bank[0].id, vocabularyIds: [], completion: structuredClone(completion) })),
            gates: [{ id: gateId, number: 1, fromLesson: 1, afterLesson: 5, contentIds: bank.map(row => row.id), results: { husband: null, wife: null } }],
            promotionContentIds: [], promotionResults: { husband: null, wife: null }, lastPromotionRoomId: null,
          } },
        };
        await database.db.collection<typeof path>("duo_learning_paths").insertOne(path);
        server = createApp(database, { production: false, serveClient: false, duoEnabled: true, demoEnabled: false,
          duoCredentials: settings, examIntegrityEnabled: true,
          duo: { sessionsPerBand: 5, gateInterval: 5, lessonKinds: ["reading"], now: () => now },
          wordTranslation: { fetch: providerFetch, apiKey: () => "synthetic-provider-key", timeoutMs: 300 },
        }).listen(0, "127.0.0.1");
        await once(server, "listening");
        const address = server.address();
        assert.ok(address && typeof address !== "string");
        origin = `http://127.0.0.1:${address.port}`;
        await request("POST", "/auth/login", { phone: settings.accounts[0].phone, password: "synthetic-notebook-duo-password-a" });
        const tab = randomUUID();
        const assessment = (await request("POST", `/duo/gates/${gateId}/start`, {}, 200, tab)).assessment as DuoAssessmentView;
        assert.equal(assessment.parts.length, 2);
        const attempt = (await request("POST", "/attempts", {
          contentId: bank[0].id, mode: "exam", duoAssessmentId: assessment.id,
        }, 201, tab)).attempt;
        const selection = { word: "restore", context: readingSentences[0], sectionIndex: 0 };
        const cardId = assertSavePayload(await request("POST", `/attempts/${attempt.id}/words`, selection, 201, tab), "restore", false);
        await request("PATCH", `/attempts/${attempt.id}`, { responses: { [bank[0].questions[0].id]: bank[0].questions[0].answer } }, 200, tab);
        const submitted = (await request("POST", `/attempts/${attempt.id}/submit`, {}, 200, tab)).attempt;
        assert.equal(submitted.status, "submitted");
        const assessments = database.db.collection<{
          _id: string; active: boolean; status: string; invalidatedAt?: string; integrityReason?: string;
          parts: { attemptId: string | null }[];
        }>("duo_assessments");
        const activeAssessment = await assessments.findOne({ _id: assessment.id });
        assert.equal(activeAssessment!.active, true);
        assert.equal(activeAssessment!.parts[0].attemptId, attempt.id);
        assert.equal(activeAssessment!.parts[1].attemptId, null);
        const sessions = database.db.collection<{
          _id: string; userId: string; resourceId: string; kind: string; status: string; phase: string;
          leaseUntil: number; reason?: string; resetPending?: boolean;
        }>("exam_integrity_sessions");
        const guard = await sessions.findOne({ userId: members.husband, resourceId: assessment.id });
        assert.ok(guard);
        assert.equal(guard.kind, "assessment");
        assert.equal(guard.status, "active");
        assert.equal(guard.phase, "answering");
        const pending = await database.cards.findOne({ _id: cardId });
        const companionBefore = await database.users.findOne({ _id: members.wife });
        assert.equal(pending!.meaningStatus, "pending");
        await request("POST", `/attempts/${attempt.id}/words/translate`, selection, 400);
        assert.equal(providerCalls, 0);
        assert.deepEqual(await database.cards.findOne({ _id: cardId }), pending);
        if (interruption === "expired-lease") now = guard.leaseUntil + 1;
        else await sessions.updateOne({ _id: guard._id }, { $set: { status: "invalidated", reason: "heartbeat-lost", resetPending: true } });
        assert.ok(Date.parse(assessment.deadlineAt) > now, "This is guard expiry, before the sitting deadline");

        // Omit X-Exam-Tab: only source inspection can settle this linked assessment.
        const rejected = await request("POST", `/attempts/${attempt.id}/words/translate`, selection, 409);
        assert.equal(providerCalls, 0);
        assert.equal("translation" in rejected, false);
        assert.equal(JSON.stringify(rejected).includes("PRIVATE DUO MEANING"), false);
        assert.deepEqual(await database.cards.findOne({ _id: cardId }), pending);
        const cancelled = await assessments.findOne({ _id: assessment.id });
        assert.equal(cancelled!.active, false);
        assert.ok(cancelled!.invalidatedAt);
        assert.equal(cancelled!.integrityReason, "heartbeat-lost");
        assert.equal((await database.attempts.findOne({ _id: attempt.id }))!.status, "invalidated");
        const settled = await sessions.findOne({ _id: guard._id });
        assert.equal(settled!.status, "invalidated");
        assert.equal(settled!.resetPending, false);
        assert.deepEqual(await database.users.findOne({ _id: members.wife }), companionBefore);
        assert.deepEqual(await database.content.find({}).sort({ _id: 1 }).toArray(), bank.map(row => ({ ...row, _id: row.id })));
      } finally {
        if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
        await database.db.dropDatabase();
        await database.client.close();
      }
    });
  }
});
