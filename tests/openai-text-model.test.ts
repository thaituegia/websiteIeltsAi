import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateWriting, generateContent } from "../server/ai";
import { ApiError } from "../server/errors";
import { DEFAULT_OPENAI_TEXT_MODEL, OPENAI_TEXT_MODEL_ROLES, resolveOpenAITextModel } from "../server/openai-text-model";
import { activateProviderConfig } from "../server/provider-config";
import { translateWordWithOpenAI } from "../server/word-translation";
import type { DuoCredentialSettings } from "../server/duo-auth";
import type { StoredContent } from "../shared/types";

const names = ["Task Achievement/Response", "Coherence & Cohesion", "Lexical Resource", "Grammatical Range & Accuracy"];
const essay = "Frequent buses help students reach school. Affordable transport improves access to education.";
const content: StoredContent = {
  id: "synthetic-model-upgrade", title: "Access to education", skill: "writing", topic: "Education",
  description: "Synthetic model compatibility fixture", band: 6, cefr: "B2", testType: "academic",
  durationMinutes: 40, format: "lesson", questions: [], vocabularyIds: [], tags: [], source: "authored",
  quality: "authored-unreviewed", createdAt: "2026-11-05T00:00:00.000Z",
  sections: [{ id: "synthetic-task", title: "Task 2", task: 2, text: "Discuss access to education." }],
};
const settings: DuoCredentialSettings = { duoId: "synthetic-model-pair", accounts: [
  { role: "husband", name: "Synthetic A", phone: "0390000081", passwordHash: `scrypt:${"a".repeat(32)}:${"b".repeat(128)}` },
  { role: "wife", name: "Synthetic B", phone: "0390000082", passwordHash: `scrypt:${"c".repeat(32)}:${"d".repeat(128)}` },
] };

function envelope(payload: unknown) {
  return Response.json({ choices: [{ message: { content: JSON.stringify(payload) }, finish_reason: "stop" }] });
}
function extraction() {
  return { tasks: [{ task: 2, quotes: names.map(criterion => ({ criterion, quote: "Frequent buses", observation: "A relevant source phrase." })), paragraphs: [], corrections: [] }] };
}
function scoring() {
  return { summary: "Nhận xét dựa trên bài đã nộp.", tasks: [{ task: 2, summary: "Phát triển thêm ví dụ.", criteria: names.map(name => ({ name, band: 6, confidence: 0.7, feedback: "Bổ sung chi tiết hỗ trợ.", evidence: ["Frequent buses"] })) }] };
}
async function configured<T>(overrides: NodeJS.ProcessEnv, callback: () => Promise<T>) {
  const originalFetch = globalThis.fetch;
  const prior = new Map(["OPENAI_API_KEY", "IELTS_OPENAI_API_KEY", ...OPENAI_TEXT_MODEL_ROLES].map(name => [name, process.env[name]]));
  for (const name of prior.keys()) delete process.env[name];
  process.env.IELTS_OPENAI_API_KEY = "sk-synthetic-model-test-no-paid-calls";
  Object.assign(process.env, overrides);
  try { return await callback(); }
  finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of prior) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
}
function assertCurrentParameters(body: Record<string, unknown>, model: string, limit: number) {
  assert.equal(body.model, model);
  assert.equal(body.max_completion_tokens, limit);
  for (const unsupported of ["max_tokens", "temperature", "reasoning_effort"]) assert.equal(unsupported in body, false);
}

test("all text roles default to the current model, while trimmed private overrides win", () => {
  assert.equal(DEFAULT_OPENAI_TEXT_MODEL, "gpt-6.1-sol");
  for (const role of OPENAI_TEXT_MODEL_ROLES) {
    assert.equal(resolveOpenAITextModel(role, {}), DEFAULT_OPENAI_TEXT_MODEL);
    assert.equal(resolveOpenAITextModel(role, { [role]: "  " }), DEFAULT_OPENAI_TEXT_MODEL);
    assert.equal(resolveOpenAITextModel(role, { [role]: " gpt-4o " }), "gpt-4o");
  }
});

test("provider activation retains the key and audio setting while filling current text defaults", () => {
  const env: NodeJS.ProcessEnv = { IELTS_OPENAI_API_KEY: "sk-synthetic-existing-key", SPEAKING_AUDIO_MODEL: "synthetic-audio-override", SCORING_MODEL: " gpt-4o ", CONTENT_MODEL: " " };
  assert.equal(activateProviderConfig(settings, env), true);
  assert.equal(env.IELTS_OPENAI_API_KEY, "sk-synthetic-existing-key");
  assert.equal(env.SPEAKING_AUDIO_MODEL, "synthetic-audio-override");
  assert.equal(env.SCORING_MODEL, "gpt-4o");
  for (const role of ["CONTENT_MODEL", "EXTRACTOR_MODEL", "TRANSLATION_MODEL"] as const) assert.equal(env[role], DEFAULT_OPENAI_TEXT_MODEL);
  const alias: NodeJS.ProcessEnv = { OPENAI_API_KEY: "sk-synthetic-alias-key" };
  assert.equal(activateProviderConfig(settings, alias), true);
  assert.equal(alias.OPENAI_API_KEY, "sk-synthetic-alias-key");
  for (const role of OPENAI_TEXT_MODEL_ROLES) assert.equal(alias[role], DEFAULT_OPENAI_TEXT_MODEL);
});

test("Writing sends compatible parameters for both new-default calls and keeps strict source scoring", async () => {
  await configured({}, async () => {
    let calls = 0;
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://api.openai.com/v1/chat/completions");
      const body = JSON.parse(String(init?.body));
      assertCurrentParameters(body, DEFAULT_OPENAI_TEXT_MODEL, 16_000);
      assert.deepEqual(body.response_format, { type: "json_object" });
      return envelope(++calls === 1 ? extraction() : scoring());
    };
    const feedback = await evaluateWriting(content, { "synthetic-task": essay });
    assert.equal(calls, 2);
    assert.equal(feedback.source, "ai");
    assert.equal(feedback.estimatedBand, 6);
    assert.deepEqual(feedback.taskScores?.[0].criteria[0].evidence, ["Frequent buses"]);
  });
});

test("distinct extraction and scoring overrides remain effective after the model upgrade", async () => {
  await configured({ EXTRACTOR_MODEL: " gpt-4.1-mini ", SCORING_MODEL: " gpt-4o " }, async () => {
    const models: string[] = [];
    globalThis.fetch = async (_url, init) => {
      models.push(JSON.parse(String(init?.body)).model);
      return envelope(models.length === 1 ? extraction() : scoring());
    };
    await evaluateWriting(content, { "synthetic-task": essay });
    assert.deepEqual(models, ["gpt-4.1-mini", "gpt-4o"]);
  });
});

test("model access failures never silently fall back or issue another paid call", async () => {
  await configured({}, async () => {
    let calls = 0;
    globalThis.fetch = async (_url, init) => {
      assert.equal(JSON.parse(String(init?.body)).model, DEFAULT_OPENAI_TEXT_MODEL);
      calls++;
      return Response.json({ error: { code: "model_not_found", message: "SYNTHETIC_PRIVATE_PROVIDER_DETAIL" } }, { status: 404 });
    };
    await assert.rejects(evaluateWriting(content, { "synthetic-task": essay }), error => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "AI_MODEL_UNAVAILABLE");
      assert.equal(error.message.includes("SYNTHETIC_PRIVATE"), false);
      return true;
    });
    assert.equal(calls, 1);
  });
});

test("content generation uses the new model and reasoning-inclusive output allowance", async () => {
  await configured({}, async () => {
    let calls = 0;
    globalThis.fetch = async (_url, init) => {
      assertCurrentParameters(JSON.parse(String(init?.body)), DEFAULT_OPENAI_TEXT_MODEL, 24_000);
      calls++;
      return envelope({ invalid: "Synthetic invalid content must still be rejected." });
    };
    await assert.rejects(generateContent({ skill: "writing", band: 6, topic: "Education", testType: "academic" }), ApiError);
    assert.equal(calls, 1);
  });
});

test("word translation upgrades its text model while preserving exact word context and output schema", async () => {
  await configured({}, async () => {
    const output = await translateWordWithOpenAI("bank", "We sat on the river bank.", {
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        assertCurrentParameters(body, DEFAULT_OPENAI_TEXT_MODEL, 2_048);
        assert.equal(body.response_format.type, "json_schema");
        assert.equal(body.response_format.json_schema.strict, true);
        assert.deepEqual(JSON.parse(body.messages[1].content), { word: "bank", context: "We sat on the river bank." });
        return envelope({ meaning: "bờ sông", definition: "The land beside a river.", partOfSpeech: "noun" });
      },
    });
    assert.equal(output.meaning, "bờ sông");
    assert.equal(output.context, "We sat on the river bank.");
    assert.equal(output.source, "openai");
  });
});

test("translation can retain an explicit smaller model without changing the upgraded grading defaults", async () => {
  await configured({ TRANSLATION_MODEL: " gpt-4o-mini " }, async () => {
    const output = await translateWordWithOpenAI("bus", "I travel by bus.", {
      fetch: async (_url, init) => {
        assertCurrentParameters(JSON.parse(String(init?.body)), "gpt-4o-mini", 2_048);
        return envelope({ meaning: "xe buýt", definition: "A road vehicle carrying passengers.", partOfSpeech: "noun" });
      },
    });
    assert.equal(output.word, "bus");
    assert.equal(resolveOpenAITextModel("SCORING_MODEL"), DEFAULT_OPENAI_TEXT_MODEL);
  });
});
