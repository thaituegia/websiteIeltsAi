import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { test } from "node:test";
import { createApp } from "../server/app";
import { connectDatabase } from "../server/storage";
import type { Attempt, StoredContent } from "../shared/types";

const criteria = ["Fluency & Coherence", "Lexical Resource", "Grammatical Range & Accuracy", "Pronunciation"];
const transcriptA = "I usually visit the community workshop because its quiet rooms help me learn. The tutor explains each activity and gives everyone time to ask questions.";
const transcriptB = "I often study in the museum classroom because practical demonstrations make the lesson clearer. Our group discusses each display before we compare our notes.";
const typedDecoy = "This is a typed draft, not speech recognition from the current recording.";
const forgedRecognition = "CLIENT_SUPPLIED_RECOGNITION_MUST_NOT_BE_TRUSTED";
const providerSecret = "synthetic-speaking-retry-key-never-a-real-credential";
const privateProviderValue = "SYNTHETIC_PRIVATE_AUDIO_SCHEMA_VALUE_NEVER_LOG";
const envNames = ["IELTS_OPENAI_API_KEY", "OPENAI_API_KEY", "SPEAKING_AUDIO_MODEL", "TRANSCRIPTION_MODEL",
  "IELTS_AZURE_SPEECH_KEY", "AZURE_SPEECH_KEY", "IELTS_AZURE_SPEECH_REGION", "AZURE_SPEECH_REGION", "ELEVENLABS_API_KEY"];

function recording(sample: number): Buffer {
  const data = Buffer.alloc(20 * 32_000), header = Buffer.alloc(44);
  for (let offset = 0; offset < data.length; offset += 2) data.writeInt16LE(sample, offset);
  header.write("RIFF"); header.writeUInt32LE(data.length + 36, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16_000, 24); header.writeUInt32LE(32_000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
const audioA = recording(300), audioB = recording(700);

function audioGrade(text: string, malformed: boolean) {
  const quote = text === transcriptA ? "quiet rooms" : "practical demonstrations";
  return {
    summary: "Synthetic audio assessment fixture; not a live examiner result.", speechDetected: true,
    // Missing confidence and corrections are legitimate optional diagnostics.
    // An arbitrary confidence string remains structurally invalid.
    criteria: criteria.map((name, index) => ({ name, band: 5.5, feedback: "A controlled source-backed observation.", evidence: [quote],
      ...(malformed && index === 0 ? { confidence: privateProviderValue } : {}),
    })),
    observations: [
      { criterion: "Pronunciation", startSeconds: 1, endSeconds: 4, quote, observation: "A controlled audible articulation observation." },
      { criterion: "Fluency & Coherence", startSeconds: 5, endSeconds: 8, quote, observation: "A controlled audible pause observation." },
    ],
  };
}
const envelope = (payload: unknown) => Response.json({ choices: [{ message: { content: JSON.stringify(payload) }, finish_reason: "stop" }] });

interface StreamEvent { event: string; data: any }
function parseEvents(text: string): StreamEvent[] {
  return text.split(/\n\n/u).flatMap(block => {
    const event = /^event: (.+)$/mu.exec(block)?.[1];
    const data = /^data: (.+)$/mu.exec(block)?.[1];
    return event && data ? [{ event, data: JSON.parse(data) }] : [];
  });
}

test("Speaking schema failures preserve the exact recording and recognition for private retry without another STT call", { timeout: 60_000 }, async t => {
  const name = `ielts_speaking_retry_${randomUUID().replaceAll("-", "")}`;
  assert.match(name, /^ielts_speaking_retry_[a-f0-9]{32}$/u);
  const database = await connectDatabase("mongodb://127.0.0.1:27017", name);
  const previousEnv = new Map(envNames.map(name => [name, process.env[name]]));
  const originalFetch = globalThis.fetch, originalError = console.error;
  const logs: unknown[][] = [];
  const jars = { a: "", b: "" };
  let server: Server | undefined, origin = "", malformed = true;
  let transcriptionCalls = 0, audioCalls = 0;
  let expectedAudio = audioA, expectedTranscript = transcriptA;
  const source: StoredContent = {
    id: "synthetic-speaking-retry", skill: "speaking", title: "Synthetic community interview", description: "An isolated audio-retry fixture",
    topic: "Education", band: 5, cefr: "B1", testType: "both", durationMinutes: 5, format: "lesson", questions: [],
    sections: [{ id: "synthetic-speaking-retry-part1", title: "Part 1", text: "Where do you enjoy learning? Why is it useful?" }],
    referenceAnswers: [{ sectionId: "synthetic-speaking-retry-part1", title: "Part 1 · Synthetic reference",
      sampleAnswer: "An illustrative response describes a real place and gives a relevant reason.", explanation: "Mẫu tổng hợp dùng cho kiểm thử.", keyPoints: ["Trả lời trực tiếp.", "Giải thích lý do."] }],
    vocabularyIds: [], tags: ["synthetic-retry"], source: "authored", quality: "authored-unreviewed", createdAt: "2026-11-03T00:00:00.000Z",
  };
  for (const name of envNames) delete process.env[name];
  process.env.IELTS_OPENAI_API_KEY = providerSecret;
  process.env.SPEAKING_AUDIO_MODEL = "gpt-audio";
  console.error = (...args) => { logs.push(args); };
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://api.openai.com/v1/audio/transcriptions") {
      transcriptionCalls++;
      assert.ok(init?.body instanceof FormData);
      const file = init.body.get("file"); assert.ok(file instanceof Blob);
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), expectedAudio);
      return Response.json({ text: expectedTranscript, duration: 20 });
    }
    assert.equal(url, "https://api.openai.com/v1/chat/completions", "Only the controlled audio-assessment endpoint may be called");
    audioCalls++;
    const payload = JSON.parse(String(init?.body));
    assert.equal(payload.model, "gpt-audio");
    assert.deepEqual(payload.modalities, ["text"]);
    const user = payload.messages[1].content;
    const inputText = JSON.parse(user[0].text);
    assert.equal(inputText.transcript, expectedTranscript, "Audio grading must use recognition of this exact file, never the typed/client cache fields");
    assert.equal(inputText.durationSeconds, 20);
    assert.equal(user[1].type, "input_audio");
    assert.deepEqual(Buffer.from(user[1].input_audio.data, "base64"), expectedAudio, "Retry still assesses the actual waveform");
    return envelope(audioGrade(expectedTranscript, malformed));
  };

  async function request(who: "a" | "b", method: string, path: string, body?: unknown, status = 200, stream = false) {
    const response = await originalFetch(`${origin}/api${path}`, { method,
      headers: { ...(jars[who] ? { Cookie: jars[who] } : {}), ...(stream ? { Accept: "text/event-stream" } : {}),
        ...(body === undefined || body instanceof FormData ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
    });
    const text = await response.text();
    const events = response.headers.get("content-type")?.includes("text/event-stream") ? parseEvents(text) : [];
    const result = events.length ? null : JSON.parse(text);
    assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(result ?? events)}`);
    const cookie = response.headers.getSetCookie().at(-1); if (cookie) jars[who] = cookie.split(";")[0];
    return { body: result, events };
  }
  function form(audio?: Buffer) {
    const result = new FormData();
    result.append("transcript", typedDecoy);
    result.append("recognizedTranscript", forgedRecognition);
    if (audio) result.append("audio", new Blob([new Uint8Array(audio)], { type: "audio/wav" }), "synthetic-recording.wav");
    return result;
  }
  async function start(): Promise<Attempt> {
    return (await request("a", "POST", "/attempts", { contentId: source.id, mode: "practice" }, 201)).body.attempt;
  }
  function assertSafeError(error: any) {
    assert.equal(error.code, "AI_RESPONSE_INVALID"); assert.equal(error.status ?? 502, 502);
    assert.match(error.error, /Bản ghi.*giữ/u);
    for (const value of [privateProviderValue, providerSecret, expectedTranscript, forgedRecognition]) {
      assert.equal(JSON.stringify(error).includes(value), false);
      assert.equal(JSON.stringify(logs).includes(value), false);
    }
  }
  let firstCompletedSnapshot: Awaited<ReturnType<typeof database.attempts.findOne>>;
  try {
    await database.content.insertOne({ ...source, _id: source.id });
    const bankBefore = await database.content.find().toArray();
    server = createApp(database, { serveClient: false, production: false, duoEnabled: false, demoEnabled: false,
      examIntegrityEnabled: false, maxLearners: 2 }).listen(0, "127.0.0.1");
    await once(server, "listening"); const address = server.address(); assert.ok(address && typeof address !== "string");
    origin = `http://127.0.0.1:${address.port}`;
    for (const who of ["a", "b"] as const) await request(who, "POST", "/auth/register", { name: `Synthetic Speaking ${who}`,
      email: `${who}@speaking-retry.example.test`, password: "synthetic-speaking-retry-password", targetBand: 6, testType: "academic" }, 201);
    const first = await start();
    let firstFileId = "";

    await t.test("SSE schema rejection retains original bytes, recognized transcript, prompt snapshot and a retryable lease-free attempt", async () => {
      const response = await request("a", "POST", `/attempts/${first.id}/speaking`, form(audioA), 200, true);
      assert.equal(transcriptionCalls, 1); assert.equal(audioCalls, 1, "No hidden audio-schema repair request");
      const error = response.events.find(event => event.event === "error")?.data; assert.ok(error); assertSafeError(error);
      assert.ok(response.events.some(event => event.event === "progress" && event.data.transcript === transcriptA));
      const record = await database.attempts.findOne({ _id: first.id }); assert.ok(record);
      const audio = await database.audio.findOne({ attemptId: first.id }); assert.ok(audio);
      firstFileId = audio.fileId.toHexString();
      assert.equal(record.status, "in-progress"); assert.equal(record.feedback, null); assert.equal("submissionLease" in record, false);
      assert.equal(record.transcript, transcriptA); assert.equal(audio.recognizedTranscript, transcriptA);
      assert.deepEqual(record.speakingPromptSnapshot?.map(section => section.text), source.sections.map(section => section.text));
      const bytes = await originalFetch(`${origin}/api/attempts/${first.id}/audio`, { headers: { Cookie: jars.a } });
      assert.equal(bytes.status, 200); assert.deepEqual(Buffer.from(await bytes.arrayBuffer()), audioA);
      assert.equal(await database.db.collection("recordings.files").countDocuments(), 1);
    });

    await t.test("the other owner cannot read, replace or retry the failed recording", async () => {
      const before = await database.audio.findOne({ attemptId: first.id });
      await request("b", "GET", `/attempts/${first.id}`, undefined, 404);
      await request("b", "GET", `/attempts/${first.id}/audio`, undefined, 404);
      await request("b", "POST", `/attempts/${first.id}/speaking`, form(), 404);
      assert.equal(transcriptionCalls, 1); assert.equal(audioCalls, 1);
      assert.deepEqual(await database.audio.findOne({ attemptId: first.id }), before);
    });

    await t.test("no-file retry reuses server recognition while evaluating the same waveform and normalizing optional diagnostics", async () => {
      malformed = false;
      const result = (await request("a", "POST", `/attempts/${first.id}/speaking`, form())).body.attempt as Attempt;
      assert.equal(transcriptionCalls, 1, "The failed audio assessment must not cause another Whisper request");
      assert.equal(audioCalls, 2); assert.equal(result.id, first.id); assert.equal(result.status, "submitted");
      assert.equal(result.transcript, transcriptA); assert.equal(result.feedback?.transcriptSource, "speech-recognition");
      assert.equal(result.feedback?.estimatedBand, 5.5); assert.deepEqual(result.feedback?.corrections, []);
      assert.ok(result.feedback?.criteria.every(criterion => criterion.confidence === null));
      assert.deepEqual(result.feedback?.referenceAnswers, source.referenceAnswers);
      assert.equal(result.speakingReview?.recognizedTranscript, transcriptA);
      assert.equal(result.speakingReview?.recordingAvailable, true);
      const audio = await database.audio.findOne({ attemptId: first.id }); assert.ok(audio);
      assert.equal(audio.fileId.toHexString(), firstFileId); assert.equal(audio.recognizedTranscript, transcriptA);
      assert.equal(await database.db.collection("recordings.files").countDocuments(), 1);
      firstCompletedSnapshot = await database.attempts.findOne({ _id: first.id });
      const reopened = (await request("a", "GET", `/attempts/${first.id}`)).body.attempt as Attempt;
      assert.deepEqual(reopened.feedback, result.feedback); assert.equal(reopened.speakingReview?.recognizedTranscript, transcriptA);
    });

    await t.test("a newly uploaded recording clears the old recognition before scoring and gets its own STT result", async () => {
      const second = await start();
      malformed = true;
      const failureA = (await request("a", "POST", `/attempts/${second.id}/speaking`, form(audioA), 502)).body;
      assertSafeError(failureA); assert.equal(transcriptionCalls, 2); assert.equal(audioCalls, 3);
      const oldAudio = await database.audio.findOne({ attemptId: second.id }); assert.ok(oldAudio);
      expectedAudio = audioB; expectedTranscript = transcriptB;
      const failureB = (await request("a", "POST", `/attempts/${second.id}/speaking`, form(audioB), 502)).body;
      assertSafeError(failureB); assert.equal(transcriptionCalls, 3); assert.equal(audioCalls, 4);
      const replacement = await database.audio.findOne({ attemptId: second.id }); assert.ok(replacement);
      assert.notEqual(replacement.fileId.toHexString(), oldAudio.fileId.toHexString());
      assert.equal(replacement.recognizedTranscript, transcriptB);
      assert.equal(await database.db.collection("recordings.files").countDocuments({ _id: oldAudio.fileId }), 0);
      const retained = await database.attempts.findOne({ _id: second.id }); assert.ok(retained);
      assert.equal(retained.status, "in-progress"); assert.equal("submissionLease" in retained, false); assert.equal(retained.transcript, transcriptB);
      malformed = false;
      const result = (await request("a", "POST", `/attempts/${second.id}/speaking`, form())).body.attempt as Attempt;
      assert.equal(transcriptionCalls, 3); assert.equal(audioCalls, 5);
      assert.equal(result.speakingReview?.recognizedTranscript, transcriptB); assert.equal(result.feedback?.transcriptSource, "speech-recognition");
      assert.equal((await database.audio.findOne({ attemptId: second.id }))?.fileId.toHexString(), replacement.fileId.toHexString());
      assert.deepEqual(await database.attempts.findOne({ _id: first.id }), firstCompletedSnapshot, "Later retries must not alter earlier results");
      assert.deepEqual(await database.content.find().toArray(), bankBefore);
      assert.equal(await database.attempts.countDocuments(), 2); assert.equal(await database.audio.countDocuments(), 2);
      assert.equal(await database.db.collection("recordings.files").countDocuments(), 2);
    });
  } finally {
    globalThis.fetch = originalFetch; console.error = originalError;
    for (const [name, value] of previousEnv) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
    assert.match(database.db.databaseName, /^ielts_speaking_retry_[a-f0-9]{32}$/u);
    await database.db.dropDatabase(); await database.client.close();
  }
});
