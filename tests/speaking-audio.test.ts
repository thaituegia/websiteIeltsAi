import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateSpeaking } from "../server/ai";
import type { StoredContent } from "../shared/types";
const names = ["Fluency & Coherence", "Lexical Resource", "Grammatical Range & Accuracy", "Pronunciation"];
const transcript = "I usually study in the local library because the quiet rooms help me concentrate. I sometimes hesitate when I explain a complicated idea.";
const content: StoredContent = { id: "synthetic-audio-assessment", skill: "speaking", title: "Synthetic speaking", description: "Controlled audio transport test", topic: "Education", band: 6, cefr: "B2", testType: "academic", durationMinutes: 5, format: "lesson", sections: [{ id: "part-1", title: "Part 1", text: "Where do you usually study?" }], questions: [], vocabularyIds: [], tags: [], source: "authored", quality: "authored-unreviewed", createdAt: new Date(0).toISOString() };
function wav(seconds = 20) {
  const body = Buffer.alloc(seconds * 32000), header = Buffer.alloc(44);
  header.write("RIFF"); header.writeUInt32LE(body.length + 36, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(body.length, 40); return Buffer.concat([header, body]);
}
function grade() { return { summary: "Synthetic provider response, not live audio evidence.", speechDetected: true,
  criteria: names.map(name => ({ name, band: 6.5, confidence: 0.6, feedback: "Controlled feedback", evidence: ["local library"] })),
  corrections: [{ original: "quiet rooms", suggestion: "quiet study rooms", explanation: "More precise." }],
  observations: [
    { criterion: "Pronunciation", startSeconds: 1, endSeconds: 4, quote: "local library", observation: "Controlled audible observation." },
    { criterion: "Fluency & Coherence", startSeconds: 5, endSeconds: 8, quote: "quiet rooms", observation: "Controlled pause observation." },
  ] }; }
test("audio Speaking validates waveform transport, four criteria, acoustic timestamps and honest partial results", async t => {
  const keys = ["IELTS_OPENAI_API_KEY", "OPENAI_API_KEY", "SPEAKING_AUDIO_MODEL", "IELTS_AZURE_SPEECH_KEY", "AZURE_SPEECH_KEY"];
  const old = new Map(keys.map(key => [key, process.env[key]])), oldFetch = globalThis.fetch;
  keys.forEach(key => delete process.env[key]); process.env.IELTS_OPENAI_API_KEY = "sk-synthetic-audio-test"; process.env.SPEAKING_AUDIO_MODEL = "gpt-audio";
  let payload = grade(); let audioCalls = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/transcriptions")) return Response.json({ text: transcript, duration: 20 });
    audioCalls++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "gpt-audio"); assert.deepEqual(body.modalities, ["text"]);
    assert.equal(body.messages[1].content[1].type, "input_audio");
    assert.equal(Buffer.from(body.messages[1].content[1].input_audio.data, "base64").subarray(0, 4).toString(), "RIFF");
    return Response.json({ choices: [{ message: { content: JSON.stringify(payload) }, finish_reason: "stop" }] });
  };
  const evaluate = (seconds = 20) => evaluateSpeaking(content, "", { buffer: wav(seconds), mimetype: "audio/wav" });
  try {
    await t.test("uses actual audio request and records attributable observations without fake Azure metrics", async () => {
      const result = await evaluate(); assert.equal(result.estimatedBand, 6.5); assert.equal(result.source, "ai");
      assert.equal(result.audioAssessment?.provider, "openai"); assert.equal(result.audioAssessment?.durationSeconds, 20);
      assert.equal(result.pronunciation, null); assert.match(result.criteria[0].feedback, /5.0–8.0/);
    });
    for (const [label, change] of [
      ["out-of-bounds timestamp", () => { payload.observations[0].endSeconds = 21; }],
      ["missing acoustic category", () => { payload.observations.pop(); }],
      ["fabricated evidence", () => { payload.criteria[0].evidence = ["invented quotation"]; }],
      ["fabricated correction", () => { payload.corrections[0].original = "invented quotation"; }],
      ["missing language evidence", () => { payload.criteria[1].evidence = []; }],
    ] as const) await t.test(`rejects ${label}`, async () => { payload = grade(); change(); await assert.rejects(evaluate(), /AI/); });
    await t.test("silence and insufficient recording duration never receive a full band", async () => {
      payload = grade(); payload.speechDetected = false; assert.equal((await evaluate()).estimatedBand, null);
      payload = grade(); payload.observations = []; assert.equal((await evaluate(2)).estimatedBand, null);
    });
    assert.ok(audioCalls >= 8);
  } finally { globalThis.fetch = oldFetch; old.forEach((value, key) => value === undefined ? delete process.env[key] : process.env[key] = value); }
});
