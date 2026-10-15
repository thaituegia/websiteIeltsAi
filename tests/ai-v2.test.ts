import assert from "node:assert/strict";
import { test } from "node:test";
import * as speech from "microsoft-cognitiveservices-speech-sdk";
import {
  evaluateSpeaking,
  evaluateWriting,
  generateContent,
  listeningAudio,
  services,
} from "../server/ai";
import { ApiError } from "../server/errors";
import type { StoredContent } from "../shared/types";

const envNames = [
  "IELTS_OPENAI_API_KEY",
  "OPENAI_API_KEY",
  "IELTS_AZURE_SPEECH_KEY",
  "IELTS_AZURE_SPEECH_REGION",
  "AZURE_SPEECH_KEY",
  "AZURE_SPEECH_REGION",
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_VOICE_BRITISH",
  "ELEVENLABS_VOICE_AMERICAN",
  "ELEVENLABS_VOICE_AUSTRALIAN",
] as const;
const names = [
  "Task Achievement/Response",
  "Coherence & Cohesion",
  "Lexical Resource",
  "Grammatical Range & Accuracy",
];
const speakingNames = [
  "Fluency & Coherence",
  "Lexical Resource",
  "Grammatical Range & Accuracy",
  "Pronunciation",
];
const essay =
  "Public transport can improve access to education. Better buses reduce travel costs.\n\nSchools should teach critical thinking through practical projects.";
function content(skill: StoredContent["skill"] = "writing"): StoredContent {
  return {
    id: "test-content",
    skill,
    title: "Original practice",
    description: "Controlled test",
    topic: "education",
    band: 6,
    cefr: "B2",
    testType: "academic",
    durationMinutes: 60,
    format: "full-mock",
    sections: [
      {
        id: "task-1",
        title: "Task 1",
        text: "Summarise the data.",
        task: 1,
        chart: [{ label: "Bus", values: [30, 40] }],
        chartSeries: ["2010", "2020"],
        chartUnit: "percent",
        chartType: "bar",
        visuals: [{ id: "synthetic-map", type: "map", title: "A synthetic park plan", width: 400, height: 240, labels: [{ id: "pond", text: "Pond", x: 160, y: 100 }], areas: [{ id: "pond-outline", x: 130, y: 80, width: 100, height: 60 }] }],
      },
      {
        id: "task-2",
        title: "Task 2",
        text: "Should schools teach practical skills?",
        task: 2,
      },
    ],
    questions: [],
    vocabularyIds: [],
    tags: [],
    source: "authored",
    quality: "authored-unreviewed",
    createdAt: new Date(0).toISOString(),
  };
}
function envelope(value: unknown): Response {
  return Response.json({
    choices: [
      { message: { content: JSON.stringify(value) }, finish_reason: "stop" },
    ],
  });
}
function extraction(taskNumbers: (1 | 2)[] = [1, 2]) {
  return {
    tasks: taskNumbers.map((task) => ({
      task,
      quotes: names.map((criterion) => ({
        criterion,
        quote: "Public transport",
        observation: "Specific language evidence",
      })),
      paragraphs: [
        {
          index: 0,
          quote: "Public transport",
          feedback: "Clarify the main comparison.",
        },
      ],
      corrections: [
        {
          original: "Better buses",
          suggestion: "More frequent buses",
          explanation: "Be more precise.",
        },
      ],
    })),
  };
}
function scoring() {
  return {
    summary: "Estimated practice assessment.",
    tasks: ([1, 2] as const).map((task) => ({
      task,
      summary: "Task result",
      criteria: names.map((name) => ({
        name,
        band: task === 1 ? 4 : 7,
        confidence: 0.6,
        feedback: "Develop the evidence.",
        evidence: ["Public transport"],
      })),
    })),
  };
}
async function configured(
  config: Record<string, string>,
  mock: typeof fetch | undefined,
  work: () => Promise<void>,
): Promise<void> {
  const prior = new Map(envNames.map((name) => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  envNames.forEach((name) => delete process.env[name]);
  Object.entries(config).forEach(([name, value]) => {
    process.env[name] = value;
  });
  if (mock) globalThis.fetch = mock;
  try {
    await work();
  } finally {
    globalThis.fetch = originalFetch;
    prior.forEach((value, name) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    });
  }
}
function wav(seconds = 2): Buffer {
  const body = Buffer.alloc(seconds * 32_000);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + body.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(body.length, 40);
  return Buffer.concat([header, body]);
}

test("AI adapters: honest offline, two-stage evidence, weighting, provider errors and audio transport", async (t) => {
  await t.test(
    "unconfigured Writing provides counts/checklist without band",
    async () => {
      await configured({}, undefined, async () => {
        const result = await evaluateWriting(content(), {
          "task-1": essay,
          "task-2": essay,
        });
        assert.equal(result.source, "rule-based");
        assert.equal(result.estimatedBand, null);
        assert.equal(result.taskScores?.length, 2);
        assert.ok((result.wordCount ?? 0) > 20);
        assert.match(result.summary, /150/);
        assert.match(result.summary, /250/);
        assert.equal(result.paragraphs.length, 4);
        assert.deepEqual(services(), {
          openai: false,
          elevenlabs: false,
          azure: false,
          speech: { configured: false, provider: null, voiceCount: 0 },
        });
      });
    },
  );
  await t.test(
    "live Writing verifies extractor before scorer and weights Task2 twice",
    async () => {
      let calls = 0;
      const payloads: unknown[] = [];
      await configured(
        { IELTS_OPENAI_API_KEY: "unit-test-only-token" },
        async (_, init) => {
          payloads.push(JSON.parse(String(init?.body)));
          return envelope(++calls === 1 ? extraction() : scoring());
        },
        async () => {
          const result = await evaluateWriting(content(), {
            "task-1": essay,
            "task-2": essay,
          });
          assert.equal(calls, 2);
          assert.equal(result.source, "ai");
          assert.equal(result.estimatedBand, 6);
          assert.deepEqual(
            result.taskScores?.map((task) => task.estimatedBand),
            [4, 7],
          );
          assert.equal(result.corrections.length, 2);
          assert.equal(result.paragraphs.length, 2);
          assert.ok(JSON.stringify(payloads[1]).includes("verifiedEvidence"));
          for (const payload of payloads) {
            const request = JSON.stringify(payload);
            assert.ok(request.includes("A synthetic park plan"), "Both assessment stages need the actual map stimulus");
            assert.ok(request.includes("chartSeries") && request.includes("2010") && request.includes("percent"), "Assessment must receive chart axes and units");
          }
        },
      );
    },
  );
  await t.test("fabricated extractor quote blocks scorer", async () => {
    let calls = 0;
    const bad = extraction([1]);
    bad.tasks[0].quotes[0].quote = "Quotation that does not exist";
    await configured(
      { OPENAI_API_KEY: "unit-test-only-token" },
      async () => {
        calls++;
        return envelope(bad);
      },
      async () => {
        await assert.rejects(
          evaluateWriting(content(), { "task-1": essay }),
          (error: unknown) => error instanceof ApiError && error.status === 502,
        );
        assert.equal(calls, 1);
      },
    );
  });
  await t.test(
    "configured quota error is exposed, sanitized, never falls back offline",
    async () => {
      await configured(
        { OPENAI_API_KEY: "unit-test-only-token" },
        async () =>
          new Response("private upstream error details", { status: 429 }),
        async () => {
          await assert.rejects(
            evaluateWriting(content(), { "task-1": essay }),
            (error: unknown) =>
              error instanceof ApiError &&
              error.status === 503 &&
              !error.message.includes("private upstream"),
          );
        },
      );
    },
  );
  await t.test("malformed provider schema is rejected", async () => {
    await configured(
      { OPENAI_API_KEY: "unit-test-only-token" },
      async () => envelope({ tasks: [] }),
      async () => {
        await assert.rejects(
          evaluateWriting(content(), { "task-1": essay }),
          (error: unknown) => error instanceof ApiError && error.status === 502,
        );
      },
    );
  });
  await t.test(
    "typed Speaking cannot invent acoustic bands even if model supplies them",
    async () => {
      await configured(
        { OPENAI_API_KEY: "unit-test-only-token" },
        async () =>
          envelope({
            summary: "Language advice.",
            criteria: speakingNames.map((name) => ({
              name,
              band: 6,
              confidence: 0.5,
              feedback: "Provide more detail.",
              evidence: ["Public transport"],
            })),
            corrections: [],
          }),
        async () => {
          const result = await evaluateSpeaking(content("speaking"), essay);
          assert.equal(result.transcriptSource, "typed");
          assert.equal(result.estimatedBand, null);
          assert.equal(result.pronunciation, null);
          assert.equal(
            result.criteria.find((item) => item.name === "Pronunciation")?.band,
            null,
          );
          assert.equal(
            result.criteria.find((item) => item.name === "Fluency & Coherence")
              ?.band,
            null,
          );
          assert.equal(
            result.criteria.find((item) => item.name === "Lexical Resource")
              ?.band,
            6,
          );
        },
      );
    },
  );
  await t.test(
    "audio Whisper multipart completes before language scoring and emits progress",
    async () => {
      const stages: string[] = [];
      let calls = 0;
      await configured(
        { OPENAI_API_KEY: "unit-test-only-token" },
        async (url, init) => {
          calls++;
          if (String(url).endsWith("/audio/transcriptions")) {
            assert.ok(init?.body instanceof FormData);
            assert.equal(init.body.get("response_format"), "verbose_json");
            return Response.json({ text: essay, duration: 2 });
          }
          return envelope({
            summary: "Language only.",
            criteria: speakingNames.map((name) => ({
              name,
              band:
                name === "Pronunciation" || name === "Fluency & Coherence"
                  ? null
                  : 6,
              confidence: 0.5,
              feedback: "Useful feedback.",
              evidence: ["Public transport"],
            })),
            corrections: [],
          });
        },
        async () => {
          const result = await evaluateSpeaking(
            content("speaking"),
            "",
            { buffer: wav(), mimetype: "audio/wav" },
            (event) => { stages.push(event.stage); },
          );
          assert.equal(calls, 2);
          assert.deepEqual(stages, ["transcribing", "transcribed", "scoring"]);
          assert.equal(result.transcript, essay);
          assert.equal(result.transcriptSource, "speech-recognition");
          assert.equal(result.estimatedBand, null);
          assert.match(result.summary, /Whisper STT/);
        },
      );
    },
  );
  await t.test(
    "audio-only unconfigured and invalid headers are explicit errors",
    async () => {
      await configured({}, undefined, async () => {
        await assert.rejects(
          evaluateSpeaking(content("speaking"), "", {
            buffer: wav(),
            mimetype: "audio/wav",
          }),
          (error: unknown) => error instanceof ApiError && error.status === 503,
        );
        await assert.rejects(
          evaluateSpeaking(content("speaking"), essay, {
            buffer: Buffer.from("not actual wave data"),
            mimetype: "audio/wav",
          }),
          (error: unknown) => error instanceof ApiError && error.status === 400,
        );
      });
    },
  );
  await t.test(
    "provider measured audio longer than 12 minutes is rejected",
    async () => {
      await configured(
        { OPENAI_API_KEY: "unit-test-only-token" },
        async () => Response.json({ text: essay, duration: 721 }),
        async () => {
          await assert.rejects(
            evaluateSpeaking(content("speaking"), "", {
              buffer: wav(),
              mimetype: "audio/wav",
            }),
            (error: unknown) =>
              error instanceof ApiError && error.status === 400,
          );
        },
      );
    },
  );
  await t.test(
    "continuous Azure assessment allows a full 12-minute recording and aggregates actual event metrics",
    async (context) => {
      const timer = context.mock.method(globalThis, "setTimeout");
      const stop = context.mock.method(
        speech.SpeechRecognizer.prototype,
        "stopContinuousRecognitionAsync",
        function (callback?: () => void) {
          callback?.();
        },
      );
      context.mock.method(
        speech.SpeechRecognizer.prototype,
        "startContinuousRecognitionAsync",
        function (this: speech.SpeechRecognizer, callback?: () => void) {
          callback?.();
          queueMicrotask(() => {
            for (const [accuracy, fluency, prosody, duration] of [
              [60, 70, 80, 10_000_000],
              [80, 90, 90, 30_000_000],
            ]) {
              const properties = new speech.PropertyCollection();
              properties.setProperty(
                speech.PropertyId.SpeechServiceResponse_JsonResult,
                JSON.stringify({
                  NBest: [
                    {
                      Words: [],
                      PronunciationAssessment: {
                        AccuracyScore: accuracy,
                        FluencyScore: fluency,
                        ProsodyScore: prosody,
                        CompletenessScore: 0,
                        PronScore: accuracy,
                      },
                    },
                  ],
                }),
              );
              const result = new speech.SpeechRecognitionResult(
                "provider-event",
                speech.ResultReason.RecognizedSpeech,
                "Recognized speech.",
                duration,
                0,
                "en-US",
                undefined,
                undefined,
                undefined,
                undefined,
                properties,
              );
              this.recognized?.(
                this,
                new speech.SpeechRecognitionEventArgs(result),
              );
            }
            this.sessionStopped?.(
              this,
              new speech.SessionEventArgs("provider-session"),
            );
          });
        },
      );
      await configured(
        {
          IELTS_AZURE_SPEECH_KEY: "unit-test-only-token",
          IELTS_AZURE_SPEECH_REGION: "eastus",
        },
        undefined,
        async () => {
          const result = await evaluateSpeaking(content("speaking"), essay, {
            buffer: wav(720),
            mimetype: "audio/wav",
          });
          assert.ok(
            timer.mock.calls.some(
              (call) =>
                typeof call.arguments[1] === "number" &&
                call.arguments[1] >= 720_000 &&
                call.arguments[1] <= 810_000,
            ),
          );
          assert.equal(stop.mock.callCount(), 1);
          assert.deepEqual(result.pronunciation, {
            accuracy: 75,
            fluency: 85,
            prosody: 87.5,
            completeness: null,
          });
          assert.equal(result.estimatedBand, null);
        },
      );
    },
  );
  await t.test(
    "ElevenLabs uses dialogue endpoint and real configured voice mapping",
    async () => {
      const sample = content("listening");
      sample.sections = [
        {
          id: "section-1",
          title: "Registration",
          text: "Good morning. Hello. Thanks.",
          dialogue: [
            { speaker: "A", accent: "british", text: "Good morning." },
            { speaker: "B", accent: "american", text: "Hello." },
            { speaker: "C", accent: "australian", text: "Thanks." },
          ],
        },
      ];
      await configured(
        {
          ELEVENLABS_API_KEY: "unit-test-only-token",
          ELEVENLABS_VOICE_BRITISH: "test-british",
          ELEVENLABS_VOICE_AMERICAN: "test-american",
          ELEVENLABS_VOICE_AUSTRALIAN: "test-australian",
        },
        async (url, init) => {
          assert.match(String(url), /\/v1\/text-to-dialogue\?output_format=/);
          const parsed = JSON.parse(String(init?.body)) as {
            inputs: { text: string; voice_id: string }[];
          };
          assert.deepEqual(
            parsed.inputs.map((input) => input.voice_id),
            ["test-british", "test-american", "test-australian"],
          );
          assert.deepEqual(parsed.inputs.map(input => input.text), ["Good morning.", "Hello.", "Thanks."]);
          return new Response(new Uint8Array([0, 0, 0xff, 0x7f]), {
            headers: { "content-type": "audio/pcm" },
          });
        },
        async () => {
          const audio = await listeningAudio(sample);
          assert.equal(audio.mimetype, "audio/wav");
          assert.equal(audio.buffer.toString("ascii", 0, 4), "RIFF");
          assert.equal(audio.buffer.readUInt32LE(24), 16_000);
          assert.ok(audio.buffer.length > 44);
          assert.equal(services().elevenlabs, true);
        },
      );
    },
  );
  await t.test(
    "missing ElevenLabs does not masquerade as browser speech synthesis",
    async () => {
      await configured({}, undefined, async () => {
        await assert.rejects(
          listeningAudio(content("listening")),
          (error: unknown) => error instanceof ApiError && error.status === 503,
        );
      });
    },
  );
  await t.test(
    "generation rejects answer keys without a supporting evidence span",
    async () => {
      const draft = {
        title: "Original grammar",
        description: "Grammar practice",
        cefr: "B1",
        durationMinutes: 12,
        format: "lesson",
        sections: [
          { id: "section", title: "Rule", text: "She goes to work daily." },
        ],
        questions: Array.from({ length: 10 }, (_, index) => ({
          id: `q-${index}`,
          number: index + 1,
          type: "choice",
          prompt: `Question ${index}`,
          options: ["goes", "go"],
          sectionIndex: 0,
          subskill: "agreement",
          answer: "goes",
          explanation: "Agreement",
          evidence: "Non-existent evidence",
        })),
        tags: [],
      };
      await configured(
        { OPENAI_API_KEY: "unit-test-only-token" },
        async () => envelope(draft),
        async () => {
          await assert.rejects(
            generateContent({
              skill: "grammar",
              band: 5,
              topic: "work",
              testType: "academic",
            }),
            (error: unknown) =>
              error instanceof ApiError && error.status === 502,
          );
        },
      );
    },
  );
  await t.test(
    "generation cannot label ten-question Reading or Grammar drills as full mocks",
    async () => {
      for (const skill of ["reading", "grammar"] as const) {
        const text =
          "She goes to work daily. " +
          Array.from(
            { length: 60 },
            (_, index) =>
              `The community service team discussed practical transport option ${index + 1}.`,
          ).join(" ");
        const draft = {
          title: "Original work practice",
          description: "Controlled format test",
          cefr: "B1",
          durationMinutes: 12,
          format: "full-mock",
          sections: [{ id: "section", title: "Work", text }],
          questions: Array.from({ length: 10 }, (_, index) => ({
            id: `q-${index}`,
            number: index + 1,
            type: index === 0 ? "text" : index === 1 ? "true-false" : "choice",
            prompt: `Distinct question ${index + 1}`,
            ...(index > 1 ? { options: ["goes", "go"] } : {}),
            ...(index === 0 ? { wordLimit: 1 } : {}),
            sectionIndex: 0,
            subskill: "agreement",
            answer: index === 1 ? "TRUE" : "goes",
            explanation: "The example provides the evidence.",
            evidence: "She goes to work daily.",
          })),
          tags: [],
        };
        let calls = 0;
        await configured(
          { OPENAI_API_KEY: "unit-test-only-token" },
          async () => {
            calls++;
            return envelope(
              calls === 1
                ? draft
                : {
                    approved: true,
                    issues: [],
                    difficultyReason: "Estimated difficulty.",
                  },
            );
          },
          async () => {
            await assert.rejects(
              generateContent({
                skill,
                band: 5,
                topic: "work",
                testType: "academic",
              }),
              (error: unknown) =>
                error instanceof ApiError &&
                error.status === 502 &&
                /định dạng lesson/.test(error.message),
            );
            assert.equal(calls, 1);
          },
        );
      }
    },
  );
  await t.test(
    "generation rejects duplicate answer options and repeated question prompts before critic",
    async () => {
      for (const defect of [
        "exact-option",
        "equivalent-option",
        "repeated-prompt",
      ] as const) {
        const draft = {
          title: "Original grammar",
          description: "Grammar practice",
          cefr: "B1",
          durationMinutes: 12,
          format: "lesson",
          sections: [
            { id: "section", title: "Rule", text: "She goes to work daily." },
          ],
          questions: Array.from({ length: 10 }, (_, index) => ({
            id: `q-${index}`,
            number: index + 1,
            type: "choice",
            prompt:
              defect === "repeated-prompt"
                ? "Which verb fits?"
                : `Distinct question ${index + 1}`,
            options:
              defect === "exact-option"
                ? ["goes", "goes", "go"]
                : defect === "equivalent-option"
                  ? ["goes", " GOES ", "go"]
                  : ["goes", "go"],
            sectionIndex: 0,
            subskill: "agreement",
            answer: "goes",
            explanation: "Subject-verb agreement.",
            evidence: "She goes to work daily.",
          })),
          tags: [],
        };
        let calls = 0;
        await configured(
          { OPENAI_API_KEY: "unit-test-only-token" },
          async () => {
            calls++;
            return envelope(
              calls === 1
                ? draft
                : {
                    approved: true,
                    issues: [],
                    difficultyReason: "Estimated difficulty.",
                  },
            );
          },
          async () => {
            await assert.rejects(
              generateContent({
                skill: "grammar",
                band: 5,
                topic: "work",
                testType: "academic",
              }),
              (error: unknown) =>
                error instanceof ApiError &&
                error.status === 502 &&
                /trùng/.test(error.message),
            );
            assert.equal(calls, 1);
          },
        );
      }
    },
  );
});
