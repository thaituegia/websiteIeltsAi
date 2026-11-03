import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "../server/errors";
import {
  parseSpeakingAudioResponse, speakingAudioOutputSchema, SpeakingAudioResponseError,
} from "../server/speaking-audio-response";

const names = ["Fluency & Coherence", "Lexical Resource", "Grammatical Range & Accuracy", "Pronunciation"];
const allowedFields = ["summary", "speechDetected", "criteria", "band", "confidence", "evidence", "corrections", "observations", "timestamps"];
const privateValue = "SYNTHETIC_PRIVATE_AUDIO_PROVIDER_VALUE";

function response(): any {
  return {
    summary: "Synthetic audio assessment, not a real learner result.", speechDetected: true,
    criteria: names.map(name => ({ name, band: 5.5, confidence: 0.7,
      feedback: "A synthetic observation grounded in the example.", evidence: ["a quiet study room"] })),
    corrections: [{ original: "a quiet room", suggestion: "a quiet study room", explanation: "A more specific phrase." }],
    observations: [
      { criterion: "Pronunciation", startSeconds: 1, endSeconds: 3, quote: "a quiet study room", observation: "Synthetic audible evidence." },
      { criterion: "Fluency & Coherence", startSeconds: 4, endSeconds: 7, quote: "a quiet study room", observation: "Another synthetic observation." },
    ],
  };
}

function invalid(input: unknown, expectedField?: string): SpeakingAudioResponseError {
  let captured: SpeakingAudioResponseError | undefined;
  assert.throws(() => parseSpeakingAudioResponse(input), error => {
    assert.ok(error instanceof ApiError);
    assert.ok(error instanceof SpeakingAudioResponseError);
    assert.equal(error.status, 502); assert.equal(error.code, "AI_RESPONSE_INVALID");
    assert.match(error.message, /Bản ghi vẫn được giữ/u);
    assert.ok(Object.isFrozen(error.fields));
    assert.ok(error.fields.every(field => allowedFields.includes(field)));
    if (expectedField) assert.ok(error.fields.includes(expectedField as never), expectedField);
    captured = error;
    return true;
  });
  return captured!;
}

test("complete audio responses retain all scores, evidence, corrections and acoustic observations", () => {
  const input = response(), before = structuredClone(input);
  const parsed = parseSpeakingAudioResponse(input);
  assert.deepEqual(parsed, before);
  assert.deepEqual(input, before);
  assert.notEqual(parsed.criteria, input.criteria);
});

test("missing optional confidence is unknown while missing/null collections remain empty", () => {
  for (const absent of [true, false]) {
    const input = response();
    for (const criterion of input.criteria) delete criterion.confidence;
    if (absent) { delete input.corrections; delete input.observations; }
    else { input.corrections = null; input.observations = null; }
    const before = structuredClone(input), parsed = parseSpeakingAudioResponse(input);
    assert.deepEqual(parsed.criteria.map(criterion => criterion.confidence), [null, null, null, null]);
    assert.deepEqual(parsed.corrections, []); assert.deepEqual(parsed.observations, []);
    assert.deepEqual(input, before);
    // This parser does not manufacture acoustic support. The caller must still
    // reject scored acoustic categories with no timestamped observations.
    assert.equal(parsed.criteria[0].band, 5.5);
  }
});

test("explicit no-speech and null scores remain a partial assessment without invented values", () => {
  const input = response(); input.speechDetected = false;
  for (const criterion of input.criteria) { criterion.band = null; criterion.confidence = null; criterion.evidence = []; }
  input.corrections = null; input.observations = null;
  const result = parseSpeakingAudioResponse(input);
  assert.equal(result.speechDetected, false);
  assert.ok(result.criteria.every(criterion => criterion.band === null && criterion.confidence === null));
  assert.deepEqual(result.observations, []); assert.deepEqual(result.corrections, []);
});

test("required response and criterion fields never receive guessed defaults", () => {
  for (const field of ["summary", "speechDetected", "criteria"]) {
    const input = response(); delete input[field]; invalid(input, field);
  }
  for (const field of ["name", "band", "feedback", "evidence"]) {
    const input = response(); delete input.criteria[0][field];
    invalid(input, field === "band" || field === "evidence" ? field : "criteria");
  }
  for (const value of [undefined, null, [], "not an assessment", { summary: privateValue }]) invalid(value);
});

test("exact four distinct criterion names are mandatory, with no aliases or dropped entries", () => {
  const duplicate = response(); duplicate.criteria[3].name = names[0]; invalid(duplicate, "criteria");
  const missing = response(); missing.criteria.pop(); invalid(missing, "criteria");
  const extra = response(); extra.criteria.push(structuredClone(extra.criteria[0])); invalid(extra, "criteria");
  for (const value of ["Fluency and Coherence", "pronunciation", privateValue]) {
    const input = response(); input.criteria[0].name = value; invalid(input, "criteria");
  }
});

test("band values stay numeric half bands in range; confidence is never converted from percentages", () => {
  for (const value of [-0.5, 9.5, 5.25, NaN, Infinity, "5.5", "Band 5.5", false]) {
    const input = response(); input.criteria[0].band = value; invalid(input, "band");
  }
  for (const value of [-0.01, 1.01, 70, NaN, Infinity, "0.7", "70%", false]) {
    const input = response(); input.criteria[0].confidence = value; invalid(input, "confidence");
  }
  for (const value of [0, 0.5, 5.5, 9, null]) {
    const input = response(); input.criteria[0].band = value;
    assert.equal(parseSpeakingAudioResponse(input).criteria[0].band, value);
  }
});

test("evidence is required and bounded even when a criterion abstains from scoring", () => {
  for (const value of [undefined, null, "a quiet room", [""], ["x".repeat(2001)], Array(21).fill("a quiet room")]) {
    const input = response(); input.criteria[0].band = null; input.criteria[0].evidence = value; invalid(input, "evidence");
  }
  const input = response(); input.criteria[0].band = null; input.criteria[0].evidence = [];
  assert.deepEqual(parseSpeakingAudioResponse(input).criteria[0].evidence, []);
});

test("optional collections accept only null/absence or bounded well-formed arrays", () => {
  for (const field of ["corrections", "observations"]) {
    for (const value of [false, "none", {}, [{}], Array(25).fill({})]) {
      const input = response(); input[field] = value; invalid(input, field);
    }
  }
  const input = response(); input.corrections = Array(21).fill(input.corrections[0]); invalid(input, "corrections");
});

test("acoustic observations retain exact categories and numeric timestamps", () => {
  for (const [key, value] of [["startSeconds", -1], ["startSeconds", "1"], ["endSeconds", 0], ["endSeconds", "3"], ["endSeconds", Infinity]] as const) {
    const input = response(); input.observations[0][key] = value; invalid(input, "timestamps");
  }
  const category = response(); category.observations[0].criterion = "Grammar"; invalid(category, "observations");
  const missingQuote = response(); delete missingQuote.observations[0].quote; invalid(missingQuote, "observations");
  // Cross-field ordering, source quotation and duration checks remain with the
  // audio-aware caller, which has the recording and transcript available.
  const exact = response(); exact.observations[0].startSeconds = 1.25; exact.observations[0].endSeconds = 3.75;
  assert.equal(parseSpeakingAudioResponse(exact).observations[0].endSeconds, 3.75);
});

test("finite diagnostics never expose provider values or arbitrary object keys", () => {
  const input = response(); input.criteria[0].band = privateValue;
  input.criteria[1].evidence = [{ [privateValue]: privateValue }];
  input.observations[0].startSeconds = privateValue;
  input[privateValue] = privateValue;
  const error = invalid(input);
  for (const serialized of [error.message, error.stack, JSON.stringify(error), JSON.stringify(error.fields)])
    assert.equal(serialized?.includes(privateValue), false);
  assert.deepEqual(error.fields, ["band", "evidence", "timestamps"]);
  assert.equal(Reflect.set(error.fields, 0, privateValue), false);
  const extra = response(); extra[privateValue] = privateValue;
  assert.equal(JSON.stringify(parseSpeakingAudioResponse(extra)).includes(privateValue), false);
});

test("generated prompt schema describes required response, real names and score constraints", () => {
  const schema = speakingAudioOutputSchema as any;
  for (const name of ["summary", "speechDetected", "criteria"]) assert.ok(schema.required.includes(name));
  const criteria = schema.properties.criteria;
  assert.equal(criteria.minItems, 4); assert.equal(criteria.maxItems, 4);
  assert.deepEqual(criteria.items.properties.name.enum, names);
  assert.ok(criteria.items.required.includes("band"));
  assert.ok(criteria.items.required.includes("evidence"));
  assert.equal(criteria.items.properties.confidence.default, null);
  assert.equal(schema.properties.speechDetected.type, "boolean");
  assert.ok(JSON.stringify(schema).includes('"multipleOf":0.5'));
});
