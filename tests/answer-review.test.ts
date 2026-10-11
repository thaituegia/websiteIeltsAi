import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { test } from "node:test";
import { createApp, sanitizeContent } from "../server/app";
import { hashPassword } from "../server/auth";
import { parseDuoCredentials, provisionDuoAccounts } from "../server/duo-auth";
import { gradeObjective } from "../server/learning";
import { connectDatabase } from "../server/storage";
import type { Attempt, Feedback, PlacementItem, PlacementState, PlacementSummary, StoredContent, StoredQuestion } from "../shared/types";

function objective(id: string, skill: "reading" | "listening" | "grammar", mock = false): StoredContent {
  const count = mock ? 40 : 6;
  const questions: StoredQuestion[] = Array.from({ length: count }, (_, index) => ({
    id: `${id}-q${index + 1}`, number: index + 1, type: "text", prompt: `What is record ${index + 1}?`,
    answer: `record ${index + 1}`, acceptedAnswers: [`entry ${index + 1}`], explanation: `The passage explicitly identifies record ${index + 1}.`,
    evidence: `record ${index + 1}`, sectionIndex: 0, subskill: "review-details", wordLimit: 2, questionType: "short-answer",
  }));
  if (!mock) {
    questions[0] = { ...questions[0], type: "choice", options: ["Wednesday", "Thursday", "Friday"], answer: "Thursday", acceptedAnswers: undefined, prompt: "On which day is the appointment?", explanation: "The speaker moves the appointment to Thursday.", evidence: "Thursday", questionType: "multiple-choice" };
    questions[1] = { ...questions[1], answer: "water", acceptedAnswers: ["river water"], prompt: "What is collected?", explanation: "The sampling team collects water, specifically river water.", evidence: "river water" };
    for (const index of [4, 5]) questions[index] = { ...questions[index], type: "choice-multiple", answer: index === 4 ? "A" : "C", acceptedAnswers: undefined, options: ["A", "B", "C", "D"], selectionGroup: { id: `${id}-group`, count: 2 }, prompt: "Choose TWO confirmed services.", questionType: "multiple-choice-multiple", explanation: `Service ${index === 4 ? "A" : "C"} is confirmed.`, evidence: "Services A and C are available." };
  }
  return {
    id, skill, title: `Synthetic ${skill} review`, description: "A test-only review fixture.", topic: "Education", band: 5, cefr: "B1", testType: "academic", durationMinutes: mock ? 60 : 10, format: mock ? "full-mock" : "lesson", questions,
    sections: [{ id: `${id}-section`, title: "Review source", text: `The appointment is on Thursday. The team collects river water. Services A and C are available. ${Array.from({ length: count }, (_, i) => `The value is record ${i + 1}.`).join(" ")}` }],
    vocabularyIds: [], tags: ["synthetic-review"], source: "authored", quality: "authored-unreviewed", createdAt: "2026-10-11T00:00:00.000Z",
  };
}
function productive(id: string, skill: "writing" | "speaking", mock = false): StoredContent {
  const tasks = mock ? (skill === "writing" ? 2 : 3) : 1;
  return {
    ...objective(id, "reading"), skill, questions: [], format: mock ? "full-mock" : "lesson",
    sections: Array.from({ length: tasks }, (_, index) => ({ id: `${id}-section-${index + 1}`, title: skill === "writing" ? `Task ${index + 1}` : `Part ${index + 1}`, text: skill === "writing" ? "Describe a community learning programme." : "Describe a place where you enjoy learning.", ...(skill === "writing" ? { task: (index + 1) as 1 | 2 } : {}) })),
    referenceAnswers: Array.from({ length: tasks }, (_, index) => ({ sectionId: `${id}-section-${index + 1}`, title: "Illustrative response; no certified band", sampleAnswer: `REFERENCE_PRIVATE_${id}_${index + 1}: I study at a community library because it provides a quiet space and reliable resources.`, explanation: "This is one possible response, not the only correct answer and not an examiner score.", keyPoints: ["Respond to the prompt.", "Support your ideas."], ...(skill === "speaking" ? { responses: [{ prompt: "Where do you learn?", sampleAnswer: "I often learn at the local library.", explanation: "A personal answer with one reason." }] } : {}) })),
  };
}
function noStoredKeys(content: unknown): void {
  const object = content as { questions?: Record<string, unknown>[]; referenceAnswers?: unknown };
  assert.equal(object.referenceAnswers, undefined);
  for (const question of object.questions ?? []) for (const field of ["answer", "acceptedAnswers", "explanation", "evidence"]) assert.equal(field in question, false, field);
  assert.equal(JSON.stringify(content).includes("REFERENCE_PRIVATE_"), false);
}

test("objective review includes all numbered rows, accepted spellings, evidence and grouped choices", () => {
  const content = objective("review-objective", "reading");
  const feedback = gradeObjective(content, { [content.questions[0].id]: "Thursday", [content.questions[2].id]: "wrong", [content.questions[4].id]: '["A","D"]', [content.questions[5].id]: '["A","D"]' });
  assert.equal(feedback.answers.length, 6);
  assert.equal(feedback.answers[1].response, "");
  assert.equal(feedback.answers[1].correct, false);
  assert.deepEqual(feedback.answers[1].acceptedAnswers, ["water", "river water"]);
  assert.deepEqual(feedback.answers.map(row => row.questionNumber), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(feedback.answers[0].options, ["Wednesday", "Thursday", "Friday"]);
  assert.equal(feedback.answers[0].prompt, content.questions[0].prompt);
  assert.equal(feedback.answers[0].context, content.sections[0].text);
  assert.equal(feedback.answers[4].correct, true);
  assert.equal(feedback.answers[5].correct, false);
  assert.equal(feedback.estimatedBand, null);
  assert.ok(feedback.answers.every(row => row.answer && row.explanation && row.evidence && row.sectionTitle));
  const writing = productive("review-writing", "writing");
  noStoredKeys(sanitizeContent(writing));
});

test("native Mongo HTTP: completed reviews are complete, private, persisted and usable without an AI key", { timeout: 90_000 }, async (t) => {
  const name = `ielts_answer_review_test_${randomUUID().replaceAll("-", "")}`;
  assert.match(name, /^ielts_answer_review_test_[a-f0-9]{32}$/);
  const database = await connectDatabase(process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017", name);
  let server: Server | undefined;
  const keys = ["IELTS_OPENAI_API_KEY", "OPENAI_API_KEY", "IELTS_AZURE_SPEECH_KEY", "AZURE_SPEECH_KEY", "ELEVENLABS_API_KEY"];
  const previous = new Map(keys.map(key => [key, process.env[key]]));
  keys.forEach(key => delete process.env[key]);
  const bank = [objective("review-r", "reading"), objective("review-l", "listening"), objective("review-g", "grammar"), objective("review-r-mock", "reading", true), objective("review-l-mock", "listening", true), productive("review-w", "writing"), productive("review-w-mock", "writing", true), productive("review-s", "speaking"), productive("review-s-mock", "speaking", true)];
  const placementBank: PlacementItem[] = Array.from({ length: 80 }, (_, index) => ({ id: `review-placement-${index + 1}`, skill: index % 2 ? "listening" : "reading", text: `Synthetic passage ${index + 1}: the workshop supplies item ${index + 1}.`, question: `What does workshop ${index + 1} supply?`, options: [`item ${index + 1}`, `alternative ${index + 1}`, `extra ${index + 1}`, `different ${index + 1}`], answer: `item ${index + 1}`, explanation: `The passage states that workshop ${index + 1} supplies item ${index + 1}.`, band: 5, cefr: "B1", difficulty: ((index % 9) - 4) / 2, subskill: "placement-details" }));
  const jars = { a: "", b: "" };
  let origin = "";
  let now = Date.now();
  async function request(who: "a" | "b", method: string, path: string, payload?: unknown, expected = 200, headers: Record<string, string> = {}): Promise<any> {
    const response = await fetch(`${origin}/api${path}`, { method, headers: { ...(jars[who] ? { Cookie: jars[who] } : {}), ...(payload === undefined ? {} : { "Content-Type": "application/json" }), ...headers }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
    const cookie = response.headers.getSetCookie().at(-1); if (cookie) jars[who] = cookie.split(";")[0];
    if (headers.Accept === "text/event-stream") {
      const text = await response.text(); assert.equal(response.status, expected, text);
      const result = /event: result\ndata: ([^\n]+)\n/.exec(text); assert.ok(result, text);
      return JSON.parse(result[1]);
    }
    const body: unknown = await response.json(); assert.equal(response.status, expected, JSON.stringify(body)); return body;
  }
  async function begin(content: StoredContent, mode: "practice" | "exam" = "practice"): Promise<Attempt> {
    const result = (await request("a", "POST", "/attempts", { contentId: content.id, mode }, 201)).attempt as Attempt;
    assert.equal(result.status, "in-progress"); assert.equal(result.feedback, null); noStoredKeys(result.content); return result;
  }
  const completed = new Map<string, Attempt>();
  try {
    await database.content.insertMany(bank.map(content => ({ ...content, _id: content.id })));
    await database.placementItems.insertMany(placementBank.map(item => ({ ...item, _id: item.id })));
    const credentials = parseDuoCredentials({ duoId: "synthetic-answer-review-duo", accounts: [
      { role: "husband", name: "Synthetic Review A", phone: "0390000031", passwordHash: await hashPassword("synthetic-review-password-a") },
      { role: "wife", name: "Synthetic Review B", phone: "0390000032", passwordHash: await hashPassword("synthetic-review-password-b") },
    ] });
    await provisionDuoAccounts(database, credentials);
    // Legacy API/resume fixtures omit monitoring; dedicated native/browser integrity suites cover strict policy.
    server = createApp(database, { production: false, serveClient: false, examIntegrityEnabled: false, duoEnabled: true, duoCredentials: credentials, duo: { now: () => now } }).listen(0, "127.0.0.1");
    await once(server, "listening"); const address = server.address(); assert.ok(address && typeof address !== "string"); origin = `http://127.0.0.1:${address.port}`;
    await request("a", "POST", "/auth/login", { phone: credentials.accounts[0].phone, password: "synthetic-review-password-a" });
    await request("b", "POST", "/auth/login", { phone: credentials.accounts[1].phone, password: "synthetic-review-password-b" });

    await t.test("library, active practice/exams and blocked Duo starts disclose no answer material", async () => {
      const library = await request("a", "GET", "/content?pageSize=100"); library.items.forEach(noStoredKeys);
      for (const content of bank) noStoredKeys((await request("a", "GET", `/content/${content.id}`)).content);
      const denied = await request("a", "POST", "/attempts", { contentId: "review-w", mode: "exam", duoAssessmentId: "nonexistent-assessment" }, 409);
      assert.equal(JSON.stringify(denied).includes("REFERENCE_PRIVATE_"), false);
    });

    await t.test("Reading, Listening, Grammar and both 40-question mocks expose every key only after submission", async () => {
      for (const content of bank.filter(item => ["reading", "listening", "grammar"].includes(item.skill))) {
        const active = await begin(content, content.format === "full-mock" || content.skill === "listening" ? "exam" : "practice");
        const responses = { [content.questions[0].id]: "intentionally wrong" };
        const saved = (await request("a", "PATCH", `/attempts/${active.id}`, { responses })).attempt as Attempt;
        assert.equal(saved.feedback, null); noStoredKeys(saved.content);
        await request("b", "GET", `/attempts/${active.id}`, undefined, 404);
        await request("b", "POST", `/attempts/${active.id}/submit`, {}, 404);
        const result = (await request("a", "POST", `/attempts/${active.id}/submit`, {})).attempt as Attempt;
        assert.equal(result.status, "submitted"); assert.ok(result.feedback); noStoredKeys(result.content);
        assert.equal(result.feedback.answers.length, content.questions.length);
        for (const [index, row] of result.feedback.answers.entries()) {
          assert.equal(row.questionId, content.questions[index].id); assert.equal(row.questionNumber, index + 1);
          assert.equal(row.answer, content.questions[index].answer); assert.equal(row.explanation.includes(content.questions[index].explanation), true);
          assert.equal(row.prompt, content.questions[index].prompt); assert.equal(row.context, content.sections[0].text);
          assert.equal(row.correct, false); assert.equal(row.response, index === 0 ? "intentionally wrong" : "");
        }
        const persisted = await database.attempts.findOne({ _id: active.id }); assert.deepEqual(persisted?.feedback?.answers, result.feedback.answers);
        assert.deepEqual((await request("a", "GET", `/attempts/${active.id}`)).attempt.feedback.answers, result.feedback.answers);
        completed.set(content.id, result);
      }
    });

    await t.test("Writing and Speaking references, including all mock tasks and SSE, work offline without fabricated bands", async () => {
      for (const content of bank.filter(item => ["writing", "speaking"].includes(item.skill))) {
        const active = await begin(content, content.format === "full-mock" ? "exam" : "practice");
        let result: Attempt;
        if (content.skill === "writing") {
          const essays = Object.fromEntries(content.sections.map(section => [section.id, "Community learning programmes can provide practical support to residents. They work best when classes are affordable and teachers adapt the content to local needs."]));
          await request("a", "PATCH", `/attempts/${active.id}`, { essays });
          result = (await request("a", "POST", `/attempts/${active.id}/submit`, {})).attempt;
        } else {
          result = (await request("a", "POST", `/attempts/${active.id}/speaking`, { transcript: "I enjoy learning at the local library. It is quiet, and I can borrow useful books or meet a friend to discuss difficult ideas." }, 200, { Accept: "text/event-stream" })).attempt;
        }
        assert.equal(result.status, "submitted"); assert.ok(result.feedback);
        assert.equal(result.feedback.estimatedBand, null); assert.equal(result.feedback.source, "rule-based");
        assert.deepEqual(result.feedback.referenceAnswers, content.referenceAnswers);
        assert.ok(result.feedback.criteria.every(criterion => criterion.band === null));
        noStoredKeys(result.content);
        assert.deepEqual((await database.attempts.findOne({ _id: active.id }))?.feedback?.referenceAnswers, content.referenceAnswers);
        await request("b", "GET", `/attempts/${active.id}`, undefined, 404);
        const repeat = (await request("a", "POST", `/attempts/${active.id}/submit`, {})).attempt;
        assert.deepEqual(repeat.feedback.referenceAnswers, content.referenceAnswers);
        completed.set(content.id, result);
      }
      const writing = completed.get("review-w")!;
      await database.attempts.updateOne({ _id: writing.id }, { $unset: { "feedback.referenceAnswers": "" } });
      assert.deepEqual((await request("a", "GET", `/attempts/${writing.id}`)).attempt.feedback.referenceAnswers, bank.find(item => item.id === "review-w")!.referenceAnswers, "Legacy completed results hydrate stored references");
    });

    await t.test("server expiry completes blank Writing before exposing its reference response", async () => {
      const content = bank.find(item => item.id === "review-w")!;
      const active = await begin(content, "exam");
      assert.equal((await request("a", "GET", `/attempts/${active.id}`)).attempt.feedback, null);
      now += content.durationMinutes * 60_000 + 1;
      const expired = (await request("a", "GET", `/attempts/${active.id}`)).attempt as Attempt;
      assert.equal(expired.status, "submitted"); assert.equal(expired.feedback?.estimatedBand, null);
      assert.deepEqual(expired.feedback?.referenceAnswers, content.referenceAnswers);
    });

    await t.test("quick/deep placement snapshots the exact adaptive order and scopes every completed review", async () => {
      for (const mode of ["quick", "deep"] as const) {
        let placement = (await request("a", "POST", "/placement/start", { mode }, 201)).placement as PlacementState;
        const expected: { item: PlacementItem; response: string }[] = [];
        assert.equal(placement.result, null);
        await request("b", "GET", `/placement/${placement.id}`, undefined, 404);
        while (placement.question) {
          assert.equal("answer" in placement.question, false); assert.equal("explanation" in placement.question, false);
          const item = placementBank.find(question => question.id === placement.question!.id)!; assert.ok(item);
          const response = expected.length % 2 ? item.options[1] : item.answer; expected.push({ item, response });
          placement = (await request("a", "POST", `/placement/${placement.id}/answer`, { questionId: item.id, answer: response })).placement;
          if (expected.length === 1) {
            const stored = await database.placements.findOne({ _id: placement.id });
            assert.equal(stored?.answers[0].review?.prompt, item.question);
            await database.placementItems.updateOne({ _id: item.id }, { $set: { question: "Changed after the first answer", text: "Changed source after the first answer", answer: "changed key", explanation: "Changed explanation" } });
          }
          if (placement.question) {
            assert.equal(placement.result, null);
            const history = (await request("a", "GET", "/placement/history")).placements as PlacementSummary[];
            assert.equal(history.find(row => row.id === placement.id)?.result, null);
          }
        }
        assert.equal(expected.length, mode === "quick" ? 15 : 30); assert.ok(placement.result);
        assert.equal(placement.result.answers.length, expected.length);
        for (const [index, row] of placement.result.answers.entries()) {
          assert.equal(row.questionId, expected[index].item.id); assert.equal(row.questionNumber, index + 1);
          assert.equal(row.prompt, expected[index].item.question); assert.equal(row.context, expected[index].item.text);
          assert.equal(row.answer, expected[index].item.answer); assert.equal(row.response, expected[index].response);
          assert.deepEqual(row.options, expected[index].item.options); assert.equal(row.explanation, expected[index].item.explanation);
        }
        assert.deepEqual((await database.placements.findOne({ _id: placement.id }))?.result?.answers, placement.result.answers);
        assert.deepEqual((await request("a", "GET", `/placement/${placement.id}`)).placement.result.answers, placement.result.answers);
        assert.deepEqual((await request("a", "GET", "/placement/history")).placements.find((row: PlacementSummary) => row.id === placement.id).result.answers, placement.result.answers);
        assert.equal((await request("b", "GET", "/placement/history")).placements.length, 0);
        await request("b", "POST", `/placement/${placement.id}/answer`, { questionId: expected[0].item.id, answer: expected[0].item.answer }, 404);
        await database.placementItems.updateMany({}, { $set: { answer: "replacement key", text: "replacement context", explanation: "replacement explanation" } });
        assert.deepEqual((await request("a", "GET", `/placement/${placement.id}`)).placement.result.answers, placement.result.answers, "Persisted review survives source edits");
        for (const item of placementBank) await database.placementItems.replaceOne({ _id: item.id }, item);
        await database.placements.updateOne({ _id: placement.id }, { $set: { "result.answers": [] } });
        await database.placements.updateOne({ _id: placement.id }, { $unset: Object.fromEntries(expected.map((_, index) => [`answers.${index}.review`, ""])) });
        const legacy = (await request("a", "GET", `/placement/${placement.id}`)).placement as PlacementState;
        assert.deepEqual(legacy.result?.answers, placement.result.answers, "Old empty reviews hydrate only their attempted questions");
        const unused = placementBank.find(item => !expected.some(row => row.item.id === item.id))!;
        await database.placements.updateOne({ _id: placement.id }, { $set: { "result.answers": [{ questionId: unused.id, response: "", answer: unused.answer, correct: false, explanation: unused.explanation, evidence: unused.text, subskill: unused.subskill }] } });
        const filtered = (await request("a", "GET", `/placement/${placement.id}`)).placement as PlacementState;
        assert.deepEqual(filtered.result?.answers.map(row => row.questionId), expected.map(row => row.item.id));
        assert.equal(filtered.result?.answers.some(row => row.questionId === unused.id), false);
      }
    });

    await t.test("drafts cannot disclose accidentally persisted feedback through views, histories, errors or export", async () => {
      const content = bank.find(item => item.id === "review-r")!;
      const active = await begin(content);
      const priorErrors = await request("a", "GET", "/errors");
      const fake: Feedback = { ...gradeObjective(content, {}), referenceAnswers: productive("accidental", "writing").referenceAnswers };
      await database.attempts.updateOne({ _id: active.id }, { $set: { feedback: fake } });
      assert.equal((await request("a", "GET", `/attempts/${active.id}`)).attempt.feedback, null);
      const placement = (await request("a", "POST", "/placement/start", { mode: "quick" }, 201)).placement as PlacementState;
      await database.placements.updateOne({ _id: placement.id }, { $set: { result: { ...fake, skill: "placement" } } });
      assert.equal((await request("a", "GET", `/placement/${placement.id}`)).placement.result, null);
      assert.equal((await request("a", "GET", "/placement/history")).placements.find((row: PlacementSummary) => row.id === placement.id).result, null);
      const errors = await request("a", "GET", "/errors");
      assert.deepEqual(errors, priorErrors, "Incomplete drafts add no keys or corrections to the error notebook");
      const exported = await request("a", "GET", "/account/export");
      assert.equal(exported.attempts.find((attempt: Attempt) => attempt.id === active.id).feedback, null);
      assert.equal(exported.placements.find((row: PlacementState) => row.id === placement.id).result, null);
      assert.equal(JSON.stringify(exported).includes("REFERENCE_PRIVATE_accidental"), false);
    });
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    if (database.db.databaseName === name && /^ielts_answer_review_test_[a-f0-9]{32}$/.test(name)) await database.db.dropDatabase();
    await database.client.close();
    for (const [key, value] of previous) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
