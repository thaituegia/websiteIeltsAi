import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateSpeaking } from "../server/ai";
import { ApiError } from "../server/errors";
import { createSpeakingEvidenceSource } from "../server/speaking-evidence-source";
import { speakingAudioEvidenceSchema, speakingAudioOutputSchema } from "../server/speaking-audio-response";
import type { Feedback, StoredContent } from "../shared/types";

const names = ["Fluency & Coherence", "Lexical Resource", "Grammatical Range & Accuracy", "Pronunciation"];
// Synthetic learner prose, including intentional errors and typographic forms.
// Nothing here is copied from a real learner's audio or transcript.
const transcript = "Our teacher don’t always explain the timetable clearly. Residents’ needs differ, so the organiser should offer several activities. "
  + "The cafe\u0301 corner provides a quiet place where new\u00a0 learners can ask questions without disturbing the main room. "
  + "Last week our group compared notes and discussed a practical example before we tried the activity again.";
const literalQuotes = ["teacher don’t", "Residents’ needs differ", "cafe\u0301 corner", "new\u00a0 learners"];
const reservedLiteral = "spref_deadbeefdeadbeef_7";
const providerSecret = "synthetic-speaking-anchor-fixture-no-real-provider";
const content: StoredContent = {
  id: "synthetic-speaking-anchor-assessment", skill: "speaking", title: "Community learning",
  description: "An isolated source-reference regression", topic: "Education", band: 5.5, cefr: "B1",
  testType: "both", durationMinutes: 5, format: "lesson", questions: [], vocabularyIds: [], tags: [],
  source: "authored", quality: "authored-unreviewed", createdAt: "2026-11-03T00:00:00.000Z",
  sections: [{ id: "synthetic-anchor-part1", title: "Part 1", text: "Where do you enjoy learning?" }],
};
interface Anchor { id: string; text: string }
interface Grade {
  summary: string;
  speechDetected: boolean;
  criteria: { name: string; band: number | null; confidence: number | null; feedback: string; evidence: string[] }[];
  corrections: { original: string; suggestion: string; explanation: string }[];
  observations: { criterion: "Fluency & Coherence" | "Pronunciation"; startSeconds: number; endSeconds: number; quote: string; observation: string }[];
}
function anchor(catalog: readonly Anchor[], needle: string): Anchor {
  const found = catalog.find(item => item.text.includes(needle));
  assert.ok(found, `Synthetic catalog must cover ${JSON.stringify(needle)}`);
  return found;
}
function selected(catalog: readonly Anchor[]): Anchor[] {
  return [anchor(catalog, "don’t"), anchor(catalog, "Residents’"), anchor(catalog, "cafe\u0301"), anchor(catalog, "learners")];
}
function grade(catalog: readonly Anchor[]): Grade {
  const chosen = selected(catalog);
  return {
    summary: "A controlled source-linked assessment, not a live examiner result.", speechDetected: true,
    criteria: names.map((name, index) => ({ name, band: 5.5, confidence: 0.7,
      feedback: "A synthetic observation grounded in the attached recording.", evidence: [chosen[index].id] })),
    corrections: [{ original: chosen[0].id, suggestion: "Our teacher does not always explain the timetable clearly.", explanation: "Check subject–verb agreement." }],
    observations: [
      { criterion: "Fluency & Coherence", startSeconds: 1, endSeconds: 4, quote: chosen[0].id, observation: "A controlled audible pause observation." },
      { criterion: "Pronunciation", startSeconds: 5, endSeconds: 8, quote: chosen[3].id, observation: "A controlled audible articulation observation." },
    ],
  };
}
function wav(seconds = 20): Buffer {
  const pcm = Buffer.alloc(seconds * 32_000), header = Buffer.alloc(44);
  header.write("RIFF"); header.writeUInt32LE(pcm.length + 36, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16_000, 24); header.writeUInt32LE(32_000, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
const envNames = ["IELTS_OPENAI_API_KEY", "OPENAI_API_KEY", "SPEAKING_AUDIO_MODEL", "TRANSCRIPTION_MODEL",
  "IELTS_AZURE_SPEECH_KEY", "AZURE_SPEECH_KEY", "IELTS_AZURE_SPEECH_REGION", "AZURE_SPEECH_REGION"];
interface State {
  catalog: readonly Anchor[];
  logs: unknown[][];
  stages: string[];
  calls(): { stt: number; audio: number };
}
async function controlled(
  response: (catalog: readonly Anchor[]) => Grade,
  work: (evaluate: () => Promise<Feedback>, state: State) => Promise<void>,
  options: { cached?: boolean; transcript?: string; seconds?: number } = {},
) {
  const text = options.transcript ?? transcript, seconds = options.seconds ?? 20;
  const audio = wav(seconds), before = new Map(envNames.map(name => [name, process.env[name]]));
  const originalFetch = globalThis.fetch, originalError = console.error;
  const canonicalSchemaBefore = JSON.stringify(speakingAudioOutputSchema);
  const state: State = { catalog: [], logs: [], stages: [], calls: () => ({ stt: sttCalls, audio: audioCalls }) };
  let sttCalls = 0, audioCalls = 0;
  for (const name of envNames) delete process.env[name];
  process.env.IELTS_OPENAI_API_KEY = providerSecret;
  process.env.SPEAKING_AUDIO_MODEL = "gpt-audio";
  console.error = (...args) => { state.logs.push(args); };
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://api.openai.com/v1/audio/transcriptions") {
      assert.equal(options.cached, undefined, "A saved recognition must not incur another STT request");
      assert.equal(++sttCalls, 1);
      assert.ok(init?.body instanceof FormData);
      const file = init.body.get("file"); assert.ok(file instanceof Blob);
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), audio);
      return Response.json({ text, duration: seconds });
    }
    assert.equal(url, "https://api.openai.com/v1/chat/completions", "Only controlled provider endpoints are allowed");
    assert.equal(++audioCalls, 1, "Quote recovery must not trigger a paid repair request");
    const payload = JSON.parse(String(init?.body));
    assert.equal(payload.model, "gpt-audio"); assert.deepEqual(payload.modalities, ["text"]);
    assert.equal(payload.response_format, undefined, "No unverified provider response mode is introduced");
    const source = JSON.parse(payload.messages[1].content[0].text);
    assert.equal(source.transcript, text); assert.equal(source.durationSeconds, seconds);
    assert.ok(Array.isArray(source.transcriptEvidence) && source.transcriptEvidence.length > 0);
    state.catalog = source.transcriptEvidence;
    assert.ok(state.catalog.length <= 512);
    assert.equal(new Set(state.catalog.map(item => item.id)).size, state.catalog.length);
    for (const item of state.catalog) {
      assert.match(item.id, /^spref_[a-f0-9]{16}_\d+$/u);
      assert.ok(item.text.length > 0 && item.text.length <= 1000);
      assert.ok(text.includes(item.text), "Every reference must be an exact source slice");
      assert.ok(payload.messages[0].content.includes(item.id), "Prompt schema must restrict output to current references");
    }
    assert.equal(payload.messages[1].content[1].type, "input_audio");
    assert.deepEqual(Buffer.from(payload.messages[1].content[1].input_audio.data, "base64"), audio);
    return Response.json({ choices: [{ message: { content: JSON.stringify(response(state.catalog)) }, finish_reason: "stop" }] });
  };
  try {
    await work(() => evaluateSpeaking(content, "An editable draft is not trusted recognition.",
      { buffer: audio, mimetype: "audio/wav" }, event => { state.stages.push(event.stage); },
      options.cached ? { recognizedTranscript: text } : {}), state);
    assert.equal(JSON.stringify(speakingAudioOutputSchema), canonicalSchemaBefore, "Per-request reference enums cannot mutate the shared schema");
  } finally {
    globalThis.fetch = originalFetch; console.error = originalError;
    for (const [name, value] of before) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
}
function rejection(state: State, code: "AI_EVIDENCE_INVALID" | "AI_RESPONSE_INVALID", source = transcript) {
  return (error: unknown) => {
    assert.ok(error instanceof ApiError); assert.equal(error.status, 502); assert.equal(error.code, code);
    const rendered = JSON.stringify(error) + JSON.stringify(state.logs);
    for (const value of [source, providerSecret, ...state.catalog.map(item => item.id)]) assert.equal(rendered.includes(value), false);
    const hash = state.catalog[0]?.id.split("_")[1];
    if (hash) assert.equal(rendered.includes(hash), false, "Diagnostic logs must not retain transcript hashes");
    return true;
  };
}

test("Speaking reference schemas are request-scoped clones for all three quote carriers", () => {
  const before = JSON.stringify(speakingAudioOutputSchema);
  const first = createSpeakingEvidenceSource(transcript).catalog.map(item => item.id);
  const second = createSpeakingEvidenceSource(`${transcript} A different source.`).catalog.map(item => item.id);
  const schemas = [speakingAudioEvidenceSchema(Object.freeze(first)), speakingAudioEvidenceSchema(Object.freeze(second))] as any[];
  for (const [index, schema] of schemas.entries()) {
    const ids = index === 0 ? first : second;
    assert.deepEqual(schema.properties.criteria.items.properties.evidence.items.enum, ids);
    assert.deepEqual(schema.properties.observations.anyOf?.[0]?.items?.properties?.quote?.enum
      ?? schema.properties.observations.items?.properties?.quote?.enum, ids);
    assert.deepEqual(schema.properties.corrections.anyOf?.[0]?.items?.properties?.original?.enum
      ?? schema.properties.corrections.items?.properties?.original?.enum, ids);
  }
  assert.equal(JSON.stringify(speakingAudioOutputSchema), before);
  assert.ok(first.every(id => !second.includes(id)));
});

test("Speaking source references recover original text before grading without replacing acoustic proof", async t => {
  await t.test("all carriers return exact learner text rather than reference IDs or corrected grammar", async () => {
    await controlled(grade, async (evaluate, state) => {
      const result = await evaluate(), chosen = selected(state.catalog);
      assert.equal(result.estimatedBand, 5.5); assert.equal(result.transcript, transcript);
      assert.equal(result.transcriptSource, "speech-recognition");
      assert.deepEqual(result.criteria.map(criterion => criterion.band), [5.5, 5.5, 5.5, 5.5]);
      assert.deepEqual(result.criteria.map(criterion => criterion.evidence), chosen.map(item => [item.text]));
      assert.equal(result.corrections[0].original, chosen[0].text);
      assert.ok(result.corrections[0].original.includes("don’t"), "The source error stays visible in the original");
      assert.deepEqual(result.audioAssessment?.observations.map(item => item.quote), [chosen[0].text, chosen[3].text]);
      assert.equal(JSON.stringify(result).includes("spref_"), false);
      assert.deepEqual(state.calls(), { stt: 1, audio: 1 });
    });
  });

  await t.test("saved recognition still sends the waveform and uses only one assessment call", async () => {
    await controlled(grade, async (evaluate, state) => {
      const result = await evaluate(); assert.equal(result.estimatedBand, 5.5);
      assert.deepEqual(state.calls(), { stt: 0, audio: 1 });
      assert.equal(state.stages.includes("transcribing"), false);
      assert.ok(state.stages.includes("transcribed") && state.stages.includes("audio-scoring"));
    }, { cached: true });
  });

  await t.test("legacy format-only differences map back to exact transcript slices", async () => {
    const soft = (value: string) => value.normalize("NFC").replace(/[‘’]/gu, "'").replace(/[“”]/gu, '"').replace(/\s+/gu, " ");
    await controlled(catalog => {
      const payload = grade(catalog);
      payload.criteria.forEach((criterion, index) => { criterion.evidence = [soft(literalQuotes[index])]; });
      payload.corrections[0].original = soft(literalQuotes[0]);
      payload.observations[0].quote = soft(literalQuotes[0]); payload.observations[1].quote = soft(literalQuotes[3]);
      return payload;
    }, async (evaluate, state) => {
      const result = await evaluate(); assert.equal(result.estimatedBand, 5.5);
      assert.deepEqual(result.criteria.map(criterion => criterion.evidence[0]), literalQuotes);
      assert.equal(result.corrections[0].original, literalQuotes[0]);
      assert.deepEqual(result.audioAssessment?.observations.map(item => item.quote), [literalQuotes[0], literalQuotes[3]]);
      assert.deepEqual(state.calls(), { stt: 1, audio: 1 });
    });
  });

  for (const kind of ["unknown", "foreign"] as const) for (const carrier of ["criterion", "observation", "correction"] as const)
    await t.test(`${kind} reference in ${carrier} is rejected without literal rescue`, async () => {
      await controlled(catalog => {
        const payload = grade(catalog);
        const id = kind === "unknown" ? reservedLiteral : createSpeakingEvidenceSource("A different synthetic recording has other words.").catalog[0].id;
        if (carrier === "criterion") payload.criteria[1].evidence = [id];
        else if (carrier === "observation") payload.observations[0].quote = id;
        else payload.corrections[0].original = id;
        return payload;
      }, async (evaluate, state) => {
        await assert.rejects(evaluate(), rejection(state, "AI_EVIDENCE_INVALID"));
        assert.deepEqual(state.calls(), { stt: 1, audio: 1 });
      });
    });

  for (const carrier of ["criterion", "observation", "correction"] as const)
    await t.test(`a genuine grammar rewrite in ${carrier} is not accepted as original speech`, async () => {
      await controlled(catalog => {
        const payload = grade(catalog), changed = "Our teacher does not always explain";
        if (carrier === "criterion") payload.criteria[0].evidence = [changed];
        else if (carrier === "observation") payload.observations[0].quote = changed;
        else payload.corrections[0].original = changed;
        return payload;
      }, async (evaluate, state) => {
        await assert.rejects(evaluate(), rejection(state, "AI_EVIDENCE_INVALID"));
        assert.deepEqual(state.calls(), { stt: 1, audio: 1 });
      });
    });

  for (const problem of ["outside duration", "reversed time", "missing acoustic observation"] as const)
    await t.test(`resolved references cannot bypass ${problem}`, async () => {
      await controlled(catalog => {
        const payload = grade(catalog);
        if (problem === "outside duration") payload.observations[0].endSeconds = 21;
        else if (problem === "reversed time") payload.observations[0].startSeconds = 5;
        else payload.observations.pop();
        return payload;
      }, async (evaluate, state) => {
        await assert.rejects(evaluate(), rejection(state, "AI_RESPONSE_INVALID"));
        assert.deepEqual(state.calls(), { stt: 1, audio: 1 });
      });
    });

  await t.test("an available catalog cannot manufacture missing language evidence", async () => {
    await controlled(catalog => { const payload = grade(catalog); payload.criteria[1].evidence = []; return payload; }, async (evaluate, state) => {
      await assert.rejects(evaluate(), rejection(state, "AI_RESPONSE_INVALID"));
      assert.deepEqual(state.calls(), { stt: 1, audio: 1 });
    });
  });

  for (const problem of ["silence", "insufficient duration"] as const)
    await t.test(`${problem} remains without a full band after successful reference resolution`, async () => {
      await controlled(catalog => {
        const payload = grade(catalog); payload.observations = [];
        if (problem === "silence") payload.speechDetected = false;
        return payload;
      }, async (evaluate, state) => {
        const result = await evaluate(); assert.equal(result.estimatedBand, null);
        assert.ok(result.criteria.every(criterion => criterion.band === null && criterion.confidence === null));
        assert.deepEqual(state.calls(), { stt: 1, audio: 1 });
      }, { seconds: problem === "insufficient duration" ? 2 : 20 });
    });

  const withIdLiteral = `${transcript} The label contains ${reservedLiteral} as a literal identifier.`;
  await t.test("source text that resembles an ID is recovered once through its valid reference", async () => {
    await controlled(catalog => {
      const payload = grade(catalog), selected = anchor(catalog, reservedLiteral);
      payload.criteria[1].evidence = [selected.id];
      return payload;
    }, async (evaluate, state) => {
      const result = await evaluate(), expected = anchor(state.catalog, reservedLiteral).text;
      assert.deepEqual(result.criteria[1].evidence, [expected]); assert.equal(result.estimatedBand, 5.5);
      assert.deepEqual(state.calls(), { stt: 1, audio: 1 });
    }, { transcript: withIdLiteral });
  });
  await t.test("a reserved unknown reference cannot be rescued merely because its text appears in the source", async () => {
    await controlled(catalog => { const payload = grade(catalog); payload.criteria[1].evidence = [reservedLiteral]; return payload; }, async (evaluate, state) => {
      await assert.rejects(evaluate(), rejection(state, "AI_EVIDENCE_INVALID", withIdLiteral));
      assert.deepEqual(state.calls(), { stt: 1, audio: 1 });
    }, { transcript: withIdLiteral });
  });
});
