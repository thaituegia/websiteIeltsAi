import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateSpeaking } from "../server/ai";
import { ApiError } from "../server/errors";
import type { Feedback, StoredContent } from "../shared/types";

const names = ["Fluency & Coherence", "Lexical Resource", "Grammatical Range & Accuracy", "Pronunciation"];
const transcript = "I often study in the community workshop because its quiet room helps me concentrate. "
  + "The tutor gives clear examples and I compare my notes with a partner before practising again.";
const quotes = ["quiet room", "clear examples", "I compare my notes", "community workshop"];
const privateProviderValue = "SYNTHETIC_PRIVATE_EVIDENCE_SHAPE_NEVER_LOG";
const content: StoredContent = {
  id: "synthetic-speaking-evidence-format", skill: "speaking", title: "Community learning",
  description: "Synthetic evidence representation regression", topic: "Education", band: 5.5, cefr: "B1",
  testType: "both", durationMinutes: 5, format: "lesson", questions: [], vocabularyIds: [], tags: [],
  source: "authored", quality: "authored-unreviewed", createdAt: "2026-11-03T00:00:00.000Z",
  sections: [{ id: "synthetic-format-part1", title: "Part 1", text: "Where do you like to study?" }],
};
interface AudioGrade {
  summary: string;
  speechDetected: boolean;
  criteria: { name: string; band: number | null; confidence: number | null; feedback: string; evidence?: unknown }[];
  corrections: { original: string; suggestion: string; explanation: string }[];
  observations: { criterion: "Fluency & Coherence" | "Pronunciation"; startSeconds: number; endSeconds: number; quote: string; observation: string }[];
}
function grade(): AudioGrade {
  return {
    summary: "A controlled synthetic assessment; not a live learner result.", speechDetected: true,
    criteria: names.map((name, index) => ({ name, band: 5.5, confidence: 0.7,
      feedback: "A specific synthetic observation based on the supplied recording.", evidence: [quotes[index]] })),
    corrections: [],
    observations: [
      { criterion: "Fluency & Coherence", startSeconds: 2, endSeconds: 5, quote: quotes[0], observation: "A controlled audible pause observation." },
      { criterion: "Pronunciation", startSeconds: 7, endSeconds: 10, quote: quotes[3], observation: "A controlled audible articulation observation." },
    ],
  };
}
function wav(): Buffer {
  const pcm = Buffer.alloc(20 * 32_000), header = Buffer.alloc(44);
  header.write("RIFF"); header.writeUInt32LE(pcm.length + 36, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16_000, 24); header.writeUInt32LE(32_000, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
const recording = wav();
const envNames = ["IELTS_OPENAI_API_KEY", "OPENAI_API_KEY", "SPEAKING_AUDIO_MODEL", "TRANSCRIPTION_MODEL",
  "IELTS_AZURE_SPEECH_KEY", "AZURE_SPEECH_KEY", "IELTS_AZURE_SPEECH_REGION", "AZURE_SPEECH_REGION"];

async function controlled(payload: AudioGrade, work: (evaluate: () => Promise<Feedback>, state: {
  calls: () => { stt: number; audio: number }; logs: unknown[][]; stages: string[];
}) => Promise<void>, cached = false): Promise<void> {
  const before = new Map(envNames.map(name => [name, process.env[name]]));
  const originalFetch = globalThis.fetch, originalError = console.error;
  const logs: unknown[][] = [], stages: string[] = [];
  let sttCalls = 0, audioCalls = 0;
  for (const name of envNames) delete process.env[name];
  process.env.IELTS_OPENAI_API_KEY = "synthetic-speaking-shape-fixture-no-real-provider";
  process.env.SPEAKING_AUDIO_MODEL = "gpt-audio";
  console.error = (...args) => { logs.push(args); };
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://api.openai.com/v1/audio/transcriptions") {
      sttCalls++;
      assert.equal(cached, false, "A recognized recording must not incur another STT request");
      assert.equal(sttCalls, 1);
      assert.ok(init?.body instanceof FormData);
      const file = init.body.get("file"); assert.ok(file instanceof Blob);
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), recording);
      return Response.json({ text: transcript, duration: 20 });
    }
    assert.equal(url, "https://api.openai.com/v1/chat/completions", "No other real endpoint is allowed");
    assert.equal(++audioCalls, 1, "No automatic evidence-repair request is allowed");
    const request = JSON.parse(String(init?.body));
    assert.equal(request.model, "gpt-audio"); assert.deepEqual(request.modalities, ["text"]);
    const prompt = JSON.parse(request.messages[1].content[0].text);
    assert.equal(prompt.transcript, transcript); assert.equal(prompt.durationSeconds, 20);
    assert.equal(request.messages[1].content[1].type, "input_audio");
    assert.deepEqual(Buffer.from(request.messages[1].content[1].input_audio.data, "base64"), recording);
    return Response.json({ choices: [{ message: { content: JSON.stringify(payload) }, finish_reason: "stop" }] });
  };
  try {
    await work(() => evaluateSpeaking(content, "An editable draft is not verified recognition.",
      { buffer: recording, mimetype: "audio/wav" }, event => { stages.push(event.stage); },
      cached ? { recognizedTranscript: transcript } : {}),
    { calls: () => ({ stt: sttCalls, audio: audioCalls }), logs, stages });
  } finally {
    globalThis.fetch = originalFetch; console.error = originalError;
    for (const [name, value] of before) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
}
function rejected(code: "AI_RESPONSE_INVALID" | "AI_EVIDENCE_INVALID") {
  return (error: unknown) => {
    assert.ok(error instanceof ApiError); assert.equal(error.status, 502); assert.equal(error.code, code);
    for (const value of [privateProviderValue, transcript]) assert.equal(JSON.stringify(error).includes(value), false);
    return true;
  };
}

test("Speaking evidence representations retain exact source support and never create unsupported scores", async t => {
  for (const [label, form] of [
    ["literal string", (quote: string) => quote],
    ["quote object", (quote: string) => ({ quote, observation: "Additional provider metadata is not a quotation." })],
    ["text object", (quote: string) => ({ text: quote })],
    ["mixed literal and quote objects", (quote: string) => [quote, { quote }, { text: quote }]],
  ] as const) await t.test(`normalizes ${label} without altering bands or waveform`, async () => {
    const payload = grade(); payload.criteria.forEach((criterion, index) => { criterion.evidence = form(quotes[index]); });
    const original = structuredClone(payload);
    await controlled(payload, async (evaluate, state) => {
      const result = await evaluate(); assert.equal(result.estimatedBand, 5.5);
      assert.deepEqual(result.criteria.map(criterion => criterion.band), [5.5, 5.5, 5.5, 5.5]);
      assert.deepEqual(result.criteria.map(criterion => criterion.evidence), quotes.map(quote => label.startsWith("mixed") ? [quote, quote, quote] : [quote]));
      assert.deepEqual(result.audioAssessment?.observations, original.observations);
      assert.equal(result.transcript, transcript); assert.equal(result.transcriptSource, "speech-recognition");
      assert.deepEqual(state.calls(), { stt: 1, audio: 1 });
    });
    assert.deepEqual(payload, original, "Reading an evidence representation cannot mutate provider input");
  });

  for (const absence of ["missing", "null", "empty"] as const)
    await t.test(`scored acoustic ${absence} evidence can use only its own existing observations`, async () => {
      const payload = grade();
      for (const index of [0, 3]) {
        if (absence === "missing") delete payload.criteria[index].evidence;
        else payload.criteria[index].evidence = absence === "null" ? null : [];
      }
      await controlled(payload, async (evaluate, state) => {
        const result = await evaluate(); assert.equal(result.estimatedBand, 5.5);
        assert.deepEqual(result.criteria[0].evidence, [quotes[0]]); assert.deepEqual(result.criteria[3].evidence, [quotes[3]]);
        assert.deepEqual(state.calls(), { stt: 0, audio: 1 });
        assert.equal(state.stages.includes("transcribing"), false);
        assert.ok(state.stages.includes("transcribed") && state.stages.includes("audio-scoring"));
      }, true);
    });

  await t.test("abstained criteria with absent support remain unscored rather than inventing a full band", async () => {
    const payload = grade(); payload.criteria[0].band = null; delete payload.criteria[0].evidence;
    payload.criteria[3].band = null; payload.criteria[3].evidence = null; payload.observations = [];
    await controlled(payload, async (evaluate, state) => {
      const result = await evaluate(); assert.equal(result.estimatedBand, null);
      assert.deepEqual(result.criteria.filter(criterion => criterion.band === null).map(criterion => criterion.name), [names[0], names[3]]);
      assert.deepEqual(result.criteria[0].evidence, []); assert.deepEqual(result.criteria[3].evidence, []);
      assert.deepEqual(state.calls(), { stt: 1, audio: 1 });
    });
  });

  for (const absence of [undefined, null, []]) await t.test(`scored language evidence ${absence === undefined ? "missing" : absence === null ? "null" : "empty"} still blocks grading`, async () => {
    const payload = grade(); payload.criteria[1].evidence = absence;
    await controlled(payload, async (evaluate, state) => {
      await assert.rejects(evaluate(), rejected("AI_RESPONSE_INVALID"));
      assert.deepEqual(state.calls(), { stt: 1, audio: 1 });
    });
  });

  for (const [label, form] of [
    ["literal", privateProviderValue], ["object", { quote: privateProviderValue }],
    ["mixed array", [quotes[0], { text: privateProviderValue }]],
  ] as const) await t.test(`an explicit invented ${label} quotation is not replaced by valid acoustic observations`, async () => {
    const payload = grade(); payload.criteria[0].evidence = form;
    await controlled(payload, async (evaluate, state) => {
      await assert.rejects(evaluate(), rejected("AI_EVIDENCE_INVALID"));
      assert.equal(JSON.stringify(state.logs).includes(privateProviderValue), false);
      assert.deepEqual(state.calls(), { stt: 1, audio: 1 });
    });
  });

  for (const problem of ["out of bounds", "reversed", "wrong category", "invented derived quote"] as const)
    await t.test(`derived acoustic evidence cannot bypass ${problem} validation`, async () => {
      const payload = grade(); delete payload.criteria[0].evidence;
      if (problem === "out of bounds") payload.observations[0].endSeconds = 21;
      if (problem === "reversed") payload.observations[0].startSeconds = 6;
      if (problem === "wrong category") payload.observations = payload.observations.filter(observation => observation.criterion !== names[0]);
      if (problem === "invented derived quote") payload.observations[0].quote = privateProviderValue;
      await controlled(payload, async (evaluate, state) => {
        await assert.rejects(evaluate(), rejected(problem === "invented derived quote" ? "AI_EVIDENCE_INVALID" : "AI_RESPONSE_INVALID"));
        assert.deepEqual(state.calls(), { stt: 1, audio: 1 });
      });
    });

  await t.test("malformed evidence is never salvaged by dropping entries or logging provider values", async () => {
    for (const value of [false, 7, "", {}, [[quotes[0]]], { quote: quotes[0], text: "A different quotation." },
      [quotes[0], false], [quotes[0], { [privateProviderValue]: privateProviderValue }],
      "x".repeat(2001), Array(21).fill(quotes[0])]) {
      const payload = grade(); payload.criteria[0].evidence = value;
      await controlled(payload, async (evaluate, state) => {
        await assert.rejects(evaluate(), rejected("AI_RESPONSE_INVALID"));
        for (const privateText of [privateProviderValue, transcript]) assert.equal(JSON.stringify(state.logs).includes(privateText), false);
        assert.deepEqual(state.calls(), { stt: 1, audio: 1 });
      });
    }
  });
});
