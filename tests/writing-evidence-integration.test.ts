import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateSpeaking, evaluateWriting } from "../server/ai";
import { ApiError } from "../server/errors";
import type { StoredContent } from "../shared/types";

const names = ["Task Achievement/Response", "Coherence & Cohesion", "Lexical Resource", "Grammatical Range & Accuracy"];
// Entirely synthetic learner prose. Intentional errors and formatting exercise
// source fidelity; this is not copied from a real learner's submitted work.
const parts = [
  "Public libraries can widen access to learning, and I support practical classes when reading spaces stay quiet. Residents’ needs differ, so no single service suits everyone. A parent may want help using online forms, while an older resident might prefer a reading group. These activities can share a public building if staff explain their purpose and protect the resources that existing visitors already use every week.",
  "However, the council don’t always explain its timetable clearly. A class advertised at the last moment may attract too few people and waste a tutor's time. Staff should give new  learners advance notice through schools, community centres and printed leaflets. They should also explain the cost, equipment and expected level, because a vague advertisement can discourage someone who has never attended an organised course before.",
  "The cafe\u0301 area could host informal conversation without disturbing the silent room. In contrast, a workshop involving noisy machines would require a different venue. The building has limited space, and every activity should be considered against that constraint. Managers could begin with one weekly class, ask participants for comments and compare attendance before adding more sessions. This gradual approach would give both staff and visitors time to adapt.",
  "The notice says “book ahead” so that materials can be prepared for everyone. A simple registration process should still include people who cannot use a computer. Telephone booking or a desk appointment would provide another route. Overall, libraries can offer practical learning while remaining dependable places to read, provided that their programme is planned carefully, communicated clearly and reviewed against the experience of the whole local community.",
];
const originalEvidence = ["Residents’ needs differ", "new  learners advance notice", "The cafe\u0301 area", "The notice says “book ahead”"];
const providerForm = (value: string) => value.normalize("NFC").replace(/[‘’]/gu, "'").replace(/[“”]/gu, '"').replace(/\s+/gu, " ");
const environmentNames = ["IELTS_OPENAI_API_KEY", "OPENAI_API_KEY", "EXTRACTOR_MODEL", "SCORING_MODEL"];

function writing(): StoredContent {
  return { id: "synthetic-evidence-layout", skill: "writing", title: "Community learning", description: "Synthetic formatting regression",
    topic: "Education", band: 5, cefr: "B1", testType: "both", durationMinutes: 40, format: "lesson", questions: [],
    vocabularyIds: [], tags: [], source: "authored", quality: "authored-unreviewed", createdAt: "2026-11-02T00:00:00.000Z",
    sections: [{ id: "task2", title: "Task 2", task: 2, text: "Should councils finance community learning in public libraries?" }],
  };
}
function extraction(soft = false) {
  return { tasks: [{ task: 2, quotes: names.map((criterion, index) => ({ criterion,
    quote: soft ? providerForm(originalEvidence[index]) : originalEvidence[index], observation: "Observation grounded in the saved prose." })),
  paragraphs: parts.map((_, index) => ({ index, quote: soft ? providerForm(originalEvidence[index]) : originalEvidence[index], feedback: "Develop this paragraph's main point." })),
  corrections: [{ original: soft ? "the council don't" : "the council don’t", suggestion: "the council does not", explanation: "Check subject–verb agreement." }],
  }] };
}
function scoring(soft = false) {
  return { summary: "Synthetic evidence-backed practice feedback.", tasks: [{ task: 2, summary: "A controlled Task 2 assessment.",
    criteria: names.map((name, index) => ({ name, band: 5, confidence: 0.7, feedback: "Develop the explanation and check the source wording.",
      evidence: [soft ? providerForm(originalEvidence[index]) : originalEvidence[index]] })),
  }] };
}
const envelope = (value: unknown) => Response.json({ choices: [{ message: { content: JSON.stringify(value) }, finish_reason: "stop" }] });
async function controlled(provider: (payload: any, call: number) => Response, work: (calls: () => number) => Promise<void>) {
  const prior = new Map(environmentNames.map(name => [name, process.env[name]]));
  const original = globalThis.fetch;
  for (const name of environmentNames) delete process.env[name];
  process.env.IELTS_OPENAI_API_KEY = "synthetic-writing-format-no-real-provider";
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://api.openai.com/v1/chat/completions");
    const payload = JSON.parse(String(init?.body));
    calls++;
    assert.ok(calls <= 2, "No hidden paid retry is allowed");
    return provider(JSON.parse(payload.messages[1].content), calls);
  };
  try { await work(() => calls); }
  finally {
    globalThis.fetch = original;
    for (const [name, value] of prior) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
}
const invalidEvidence = (error: unknown) => error instanceof ApiError && error.status === 502 && error.code === "AI_EVIDENCE_INVALID";

test("Writing receives explicit paragraph boundaries for ordinary hard line breaks without altering the essay", async t => {
  assert.ok(parts.join(" ").split(/\s+/u).length >= 250);
  for (const [name, separators] of [
    ["single LF", ["\n", "\n", "\n"]], ["CRLF", ["\r\n", "\r\n", "\r\n"]],
    ["CR", ["\r", "\r", "\r"]], ["Unicode line and paragraph breaks", ["\u2028", "\u2029", "\n"]],
  ] as const) await t.test(name, async () => {
    const essay = parts.map((part, index) => part + (separators[index] ?? "")).join("");
    await controlled((input, call) => {
      assert.equal(input.tasks[0].essay, essay);
      if (call === 1) assert.deepEqual(input.tasks[0].paragraphs, parts.map((text, index) => ({ index, text })));
      return envelope(call === 1 ? extraction() : scoring());
    }, async calls => {
      const result = await evaluateWriting(writing(), { task2: essay });
      assert.equal(result.source, "ai"); assert.equal(result.estimatedBand, 5); assert.equal(calls(), 2);
      assert.deepEqual(result.paragraphs.map(paragraph => paragraph.index), [0, 1, 2, 3]);
      assert.deepEqual(result.criteria.map(criterion => criterion.evidence[0]), originalEvidence);
    });
  });
});

test("benign typography and whitespace are restored to exact source spans before scoring and feedback", async () => {
  const essay = parts.join("\r\n").replace("new  learners", "new\u00a0 learners");
  const expected = originalEvidence.map(quote => quote.replace("new  learners", "new\u00a0 learners"));
  await controlled((input, call) => {
    assert.equal(input.tasks[0].essay, essay);
    if (call === 2) {
      const verified = input.verifiedEvidence.tasks[0];
      assert.deepEqual(verified.quotes.map((item: { quote: string }) => item.quote), expected);
      assert.deepEqual(verified.paragraphs.map((item: { quote: string }) => item.quote), expected);
      assert.equal(verified.corrections[0].original, "the council don’t");
    }
    return envelope(call === 1 ? extraction(true) : scoring(true));
  }, async calls => {
    const result = await evaluateWriting(writing(), { task2: essay });
    assert.equal(calls(), 2);
    assert.deepEqual(result.criteria.map(criterion => criterion.evidence[0]), expected);
    assert.equal(result.corrections[0].original, "the council don’t");
    assert.equal(result.estimatedBand, 5);
    for (const criterion of result.criteria) for (const quote of criterion.evidence) assert.ok(essay.includes(quote));
    assert.ok(essay.includes(result.corrections[0].original));
  });
});

test("real source mismatches remain rejected without retrying or manufacturing a score", async t => {
  const essay = parts.join("\n");
  for (const failure of ["wrong paragraph", "prompt only", "corrected grammar", "changed case", "invented scorer"] as const)
    await t.test(failure, async () => {
      const extracted = extraction(), graded = scoring();
      if (failure === "wrong paragraph") extracted.tasks[0].paragraphs[1].index = 0;
      if (failure === "prompt only") extracted.tasks[0].quotes[0].quote = writing().sections[0].text;
      if (failure === "corrected grammar") extracted.tasks[0].corrections[0].original = "the council doesn’t";
      if (failure === "changed case") extracted.tasks[0].quotes[0].quote = "residents’ needs differ";
      if (failure === "invented scorer") graded.tasks[0].criteria[0].evidence = ["An invented phrase absent from the learner's prose."];
      await controlled((_input, call) => envelope(call === 1 ? extracted : graded), async calls => {
        await assert.rejects(evaluateWriting(writing(), { task2: essay }), invalidEvidence);
        assert.equal(calls(), failure === "invented scorer" ? 2 : 1);
      });
    });
});

test("a quotation from another submitted task cannot satisfy Writing evidence", async () => {
  const content = writing();
  content.sections.unshift({ id: "task1", title: "Task 1", task: 1, text: "Describe the synthetic museum table." });
  const task1Essay = "The table compares three museum sites and their weekly visitor numbers.";
  const extracted = extraction();
  extracted.tasks.unshift({ ...structuredClone(extracted.tasks[0]), task: 1,
    quotes: names.map(criterion => ({ criterion, quote: "three museum sites", observation: "An exact Task 1 quotation." })),
    paragraphs: [], corrections: [],
  });
  extracted.tasks[1].quotes[0].quote = "three museum sites";
  await controlled(() => envelope(extracted), async calls => {
    await assert.rejects(evaluateWriting(content, { task1: task1Essay, task2: parts.join("\n") }), invalidEvidence);
    assert.equal(calls(), 1);
  });
});

test("Writing tolerance does not loosen Speaking transcript evidence checks", async () => {
  const content = writing(); content.skill = "speaking";
  const transcript = "Residents’ needs differ, and clear information helps everyone.";
  await controlled(() => envelope({ summary: "Synthetic transcript-only assessment.",
    criteria: ["Fluency & Coherence", "Lexical Resource", "Grammatical Range & Accuracy", "Pronunciation"].map(name => ({
      name, band: name === "Pronunciation" || name === "Fluency & Coherence" ? null : 5,
      confidence: name === "Pronunciation" || name === "Fluency & Coherence" ? null : 0.7,
      feedback: "A controlled transcript-only observation.", evidence: name === "Lexical Resource" ? ["Residents' needs differ"] : [],
    })), corrections: [],
  }), async calls => {
    await assert.rejects(evaluateSpeaking(content, transcript), invalidEvidence);
    assert.equal(calls(), 1);
  });
});
