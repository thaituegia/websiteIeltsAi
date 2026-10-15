import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { test } from "node:test";
import type { Attempt, StoredContent, StoredQuestion } from "../shared/types";
import { createApp } from "../server/app";
import { gradeObjective } from "../server/learning";
import { connectDatabase } from "../server/storage";
import { matchingTimeAnswer, timeAnswerExamples } from "../server/time-answers";

function fixture(answer = "6:30", extra: Partial<StoredQuestion> = {}): StoredContent {
  return {
    id: "clock-fixture", skill: "listening", title: "Community class reservation",
    description: "A synthetic marking fixture", topic: "education", band: 3,
    cefr: "A2", testType: "academic", durationMinutes: 8, format: "lesson",
    sections: [{ id: "section", title: "Part 1", text: "The class begins at half past six." }],
    questions: [{
      id: "time", number: 1, type: "text", prompt: "Class starting time: ______",
      wordLimit: 1, allowNumbers: true, sectionIndex: 0, subskill: "detail",
      questionType: "form-completion", answer,
      explanation: "The class begins at half past six.",
      evidence: "The class begins at half past six.", ...extra,
    }],
    vocabularyIds: [], tags: [], source: "authored", quality: "authored-unreviewed",
    createdAt: "2026-10-15T00:00:00.000Z",
  };
}

test("numeric clock keys accept equivalent English and timetable forms without leaking into other input types", () => {
  const content = fixture();
  for (const response of [
    "6:30", "06:30", "6.30", "six thirty", "half past six", "half six",
    "thirty past six", "thirty minutes past six", "half past 6", "at half past six",
    "  SIX THIRTY  ", "six-thirty", "６：３０", "6:30 pm", "18:30",
  ]) {
    const marked = gradeObjective(content, { time: response });
    assert.equal(marked.rawScore, 1, response);
    assert.equal(marked.answers[0].response, response, "keep learner wording in review");
    assert.doesNotMatch(marked.answers[0].explanation, /Vượt quá/u, response);
  }
  for (const type of ["choice", "matching", "true-false", "yes-no"] as const)
    assert.equal(gradeObjective(fixture("6:30", { type }), { time: "half past six" }).rawScore, 0, type);
});

test("quarter, minute, zero and midnight/noon arithmetic preserve the exact minute", () => {
  const examples: [string, string[]][] = [
    ["06:05", ["six oh five", "six zero five", "six five", "five past six"]],
    ["6:15", ["six fifteen", "a quarter past six", "quarter past six", "fifteen minutes past six"]],
    ["6:35", ["six thirty-five", "twenty five to seven", "twenty-five minutes to seven"]],
    ["6:45", ["six forty five", "quarter to seven", "a quarter to 7"]],
    ["6:00", ["six", "six o'clock", "six o’clock", "six zero"]],
    ["00:00", ["midnight", "twelve am", "12:00 a.m.", "zero o'clock"]],
    ["00:15", ["quarter past midnight", "twelve fifteen am"]],
    ["12:00 pm", ["noon", "midday", "twelve noon", "12:00 PM"]],
    ["23:45", ["quarter to midnight", "quarter to twelve am", "eleven forty five pm"]],
    ["11:45 am", ["quarter to noon", "quarter to twelve pm", "eleven forty five am"]],
  ];
  for (const [answer, responses] of examples)
    for (const response of responses)
      assert.equal(gradeObjective(fixture(answer), { time: response }).rawScore, 1, `${answer}: ${response}`);
});

test("an explicit period is required by period-specific keys and conflicting periods stay wrong", () => {
  for (const answer of ["18:30", "6:30 pm", "six thirty in the evening"])
    for (const response of ["18:30", "six thirty p.m.", "half past six pm", "eighteen thirty", "half past six in the evening"])
      assert.equal(gradeObjective(fixture(answer, { wordLimit: 6 }), { time: response }).rawScore, 1, `${answer}: ${response}`);
  for (const response of ["6:30", "six thirty", "half past six", "6:30 am", "06:30", "six thirty in the morning", "18:30 am"])
    assert.equal(gradeObjective(fixture("6:30 pm"), { time: response }).rawScore, 0, response);
  assert.equal(gradeObjective(fixture("6:30 am"), { time: "half past six at night" }).rawScore, 0);
  assert.equal(gradeObjective(fixture("01:30"), { time: "half past one at night" }).rawScore, 1);
  assert.equal(gradeObjective(fixture("6:30 pm", { acceptedAnswers: ["6:30"] }), { time: "half past six" }).rawScore, 1,
    "the authored answer key can explicitly permit an omitted period");
});

test("invalid clocks, extra prose, ranges and approximate or wrong times receive no credit", () => {
  for (const response of [
    "", "six thirteen", "6:03", "6:31", "6:60", "24:00", "25:30", "-6:30",
    "6:30 to 7:30", "6:30/7:30", "6:30, 7:30", "around six thirty", "about half past six",
    "the answer is six thirty", "six thirty or seven thirty", "6:30 hours later",
    "6:30 bananas", "6.300", "6:3", "six thirty thirty", "half past six thirty",
    "six zero thirty", "six oh thirty",
    "sixty past five", "6:30:00", "six thirty pm am", "23:59", "six thirty".repeat(100),
  ]) assert.equal(gradeObjective(fixture(), { time: response }).rawScore, 0, response);
  assert.equal(matchingTimeAnswer("twenty three fifty nine", ["23:59"], "Time"), "23:59");
  assert.equal(matchingTimeAnswer("twenty four zero", ["24:00"], "Time"), undefined);
  assert.equal(matchingTimeAnswer("twenty four", ["20:04"], "Time"), undefined,
    "twenty four is not a valid hour or a safe reading of twenty oh four");
});

test("clock equivalence never turns decimals, quantities, durations or general answers into synonyms", () => {
  for (const [answer, prompt, response] of [
    ["6.30", "Ticket price in pounds", "six thirty"],
    ["6.30", "Complete the missing figure", "6:30"],
    ["6", "Room number", "six o'clock"],
    ["6", "How many hours does the course last?", "6:00"],
    ["six", "How long is the journey in hours?", "six o'clock"],
    ["21", "Number of seats", "twenty one"],
    ["6", "Departure fee", "6:00"],
    ["1:30", "How long does the journey take?", "half past one"],
    ["1:30", "Journey duration", "one thirty"],
    ["1:30", "Elapsed time", "one thirty"],
  ]) assert.equal(gradeObjective(fixture(answer, { prompt }), { time: response }).rawScore, 0, `${answer}: ${prompt}: ${response}`);
  assert.equal(gradeObjective(fixture("6.30"), { time: "half past six" }).rawScore, 1,
    "the time cue disambiguates a decimal-looking timetable key");
  assert.equal(gradeObjective(fixture("6", { prompt: "Arrival time" }), { time: "six o'clock" }).rawScore, 1);
  const day = fixture("Tuesday", { prompt: "Class day", acceptedAnswers: ["tue"] });
  assert.equal(gradeObjective(day, { time: " TUE " }).rawScore, 1);
  assert.equal(gradeObjective(day, { time: "Tuesday morning" }).rawScore, 0);
  assert.match(gradeObjective(day, { time: "Tuesday morning" }).answers[0].explanation, /giới hạn/u);
});

test("only explicit, unambiguous question periods constrain otherwise unqualified clock keys", () => {
  const morning = fixture("6:30", { prompt: "What time is the departure in the morning?" });
  for (const response of ["six thirty", "half past six", "6:30 am"])
    assert.equal(gradeObjective(morning, { time: response }).rawScore, 1, response);
  for (const response of ["18:30", "six thirty pm", "half past six in the evening"])
    assert.equal(gradeObjective(morning, { time: response }).rawScore, 0, response);
  assert.equal(gradeObjective(fixture("6:30", { prompt: "Arrival time in the evening" }), { time: "06:30 am" }).rawScore, 0);
  assert.equal(gradeObjective(fixture("6:30", { prompt: "Arrival time (p.m.)" }), { time: "18:30" }).rawScore, 1);
  assert.equal(gradeObjective(fixture("6:30", { prompt: "Arrival time in the morning or in the evening" }), { time: "18:30" }).rawScore, 1,
    "contrasting periods do not establish a single period");
  assert.equal(gradeObjective(fixture("6:30 am", { prompt: "Departure time in the morning" }), { time: "half past six" }).rawScore, 1,
    "an explicit question period can supply the omitted qualifier");
  for (const prompt of ["What time am I expected to arrive?", "What time is the revised appointment, not in the morning?"])
    assert.equal(gradeObjective(fixture("6:30", { prompt }), { time: "18:30" }).rawScore, 1,
      "a verb or negated period does not establish morning");
});

test("written equivalents use a valid keyed answer's limit, never waive limits on unrelated or invalid keys", () => {
  assert.equal(gradeObjective(fixture("6:30", { wordLimit: 1, allowNumbers: false }), { time: "half past six" }).rawScore, 1);
  assert.equal(gradeObjective(fixture("half past six", { wordLimit: 1, allowNumbers: false }), { time: "six thirty" }).rawScore, 0,
    "an invalid over-limit authored key cannot bypass the declared constraint");
  assert.equal(gradeObjective(fixture("6:30", { wordLimit: 0, allowNumbers: true }), { time: "half past six" }).rawScore, 1);
  assert.equal(gradeObjective(fixture("6:30", { wordLimit: 0, allowNumbers: false }), { time: "half past six" }).rawScore, 0);
  assert.equal(gradeObjective(fixture("half past six", { wordLimit: 1, acceptedAnswers: ["6:30"] }), { time: "six thirty" }).rawScore, 1,
    "use a valid explicit equivalent rather than an invalid earlier key");
});

test("completed reviews include representative equivalent time answers while preserving explicit variants", () => {
  const review = gradeObjective(fixture("6:30", { acceptedAnswers: ["06:30"] }), { time: "half past six" }).answers[0];
  assert.equal(review.correct, true);
  for (const answer of ["6:30", "06:30", "six thirty", "half past six"])
    assert(review.acceptedAnswers?.includes(answer), answer);
  assert.deepEqual(timeAnswerExamples("6.30", "Ticket price"), []);
  for (const answer of ["00:00", "00:15", "06:05", "6:30", "6:45", "11:45 am", "12:45 pm", "18:30", "23:45"])
    for (const example of timeAnswerExamples(answer, "Class starting time"))
      assert.equal(matchingTimeAnswer(example, [answer], "Class starting time"), answer, `${answer}: ${example}`);
});

test("every legal clock minute preserves exact 24-hour equivalence without accepting adjacent times", () => {
  for (let hour = 0; hour < 24; hour++) for (let minute = 0; minute < 60; minute++) {
    const key = `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}${hour > 0 && hour <= 12 ? " am" : ""}`;
    for (const example of timeAnswerExamples(key, "Time"))
      assert.equal(matchingTimeAnswer(example, [key], "Time"), key, `${key}: ${example}`);
    const nextMinute = `${hour}:${((minute + 1) % 60).toString().padStart(2, "0")}`;
    assert.equal(matchingTimeAnswer(nextMinute, [key], "Time"), undefined, `${key}: ${nextMinute}`);
  }
});

test("native Mongo HTTP: written clock answers are graded and persisted only on owned submission; history is not regraded", { timeout: 30_000 }, async () => {
  const name = `ielts_time_marking_test_${randomUUID().replaceAll("-", "")}`;
  assert.match(name, /^ielts_time_marking_test_[a-f0-9]{32}$/u);
  const database = await connectDatabase(process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017", name);
  let server: Server | undefined;
  const cookies = ["", ""];
  let origin = "";
  async function request(who: number, method: string, path: string, payload?: unknown, status = 200): Promise<{ attempt: Attempt }> {
    const response = await fetch(`${origin}/api${path}`, { method,
      headers: { ...(cookies[who] ? { Cookie: cookies[who] } : {}), ...(payload === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    const cookie = response.headers.getSetCookie().at(-1);
    if (cookie) cookies[who] = cookie.split(";")[0];
    const body = await response.json();
    assert.equal(response.status, status, JSON.stringify(body));
    return body as { attempt: Attempt };
  }
  try {
    const content = fixture();
    const base = content.questions[0];
    content.questions = [
      { ...base, id: "half" },
      { ...base, id: "spoken", number: 2 },
      { ...base, id: "quarter", number: 3, answer: "6:45" },
      { ...base, id: "period", number: 4, answer: "18:30" },
      { ...base, id: "price", number: 5, answer: "6.30", prompt: "Ticket price" },
      { ...base, id: "day", number: 6, answer: "Tuesday", prompt: "Class day" },
    ];
    await database.content.insertOne({ ...content, _id: content.id });
    server = createApp(database, { production: false, serveClient: false, duoEnabled: false, examIntegrityEnabled: false, maxLearners: 2 }).listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address(); assert(address && typeof address !== "string");
    origin = `http://127.0.0.1:${address.port}`;
    for (const who of [0, 1]) await request(who, "POST", "/auth/register", {
      name: `Synthetic clock learner ${who}`, email: `clock-${who}@example.test`, password: "synthetic-clock-password",
      targetBand: 8, testType: "academic",
    }, 201);
    const active = (await request(0, "POST", "/attempts", { contentId: content.id, mode: "practice" }, 201)).attempt;
    assert.equal(active.feedback, null);
    for (const question of active.content.questions) {
      assert.equal("answer" in question, false);
      assert.equal("acceptedAnswers" in question, false);
    }
    const responses = { half: "half past six", spoken: "six thirty", quarter: "quarter to seven", period: "6:30 am", price: "6:30", day: "Tuesday morning" };
    const draft = (await request(0, "PATCH", `/attempts/${active.id}`, { responses })).attempt;
    assert.equal(draft.feedback, null);
    await request(1, "POST", `/attempts/${active.id}/submit`, {}, 404);
    const result = (await request(0, "POST", `/attempts/${active.id}/submit`, {})).attempt;
    assert.equal(result.status, "submitted");
    assert.equal(result.feedback?.rawScore, 3);
    assert.deepEqual(result.feedback?.answers.map(row => row.correct), [true, true, true, false, false, false]);
    assert(result.feedback?.answers[0].acceptedAnswers?.includes("half past six"));
    assert.equal(result.feedback?.answers[0].response, "half past six");
    assert.deepEqual((await database.attempts.findOne({ _id: active.id }))?.feedback, result.feedback);
    assert.deepEqual((await request(0, "GET", `/attempts/${active.id}`)).attempt.feedback, result.feedback);
    await request(1, "GET", `/attempts/${active.id}`, undefined, 404);

    // Simulate a pre-upgrade saved score. Viewing it must not award new points.
    await database.attempts.updateOne({ _id: active.id }, { $set: { "feedback.rawScore": 0, "feedback.answers.0.correct": false } });
    const historical = (await request(0, "GET", `/attempts/${active.id}`)).attempt;
    assert.equal(historical.feedback?.rawScore, 0);
    assert.equal(historical.feedback?.answers[0].correct, false);
    assert.equal((await database.attempts.findOne({ _id: active.id }))?.feedback?.rawScore, 0);
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    if (database.db.databaseName === name && /^ielts_time_marking_test_[a-f0-9]{32}$/u.test(name)) await database.db.dropDatabase();
    await database.client.close();
  }
});
