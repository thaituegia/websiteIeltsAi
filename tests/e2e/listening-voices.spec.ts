import type { Page } from "@playwright/test";
import type { Attempt, PlacementState } from "../../shared/types";
import { test, expect, duoLogin, noOverflow } from "./duo-fixtures";

interface ListeningDeviceSnapshot {
  spoken: { text: string; voice: string | null; pitch: number; rate: number }[];
  audio: { src: string; plays: number; pauses: number }[];
}

declare global {
  interface Window {
    __listeningDevices: ListeningDeviceSnapshot;
  }
}

async function installListeningDevices(page: Page) {
  await page.addInitScript(() => {
    const state: ListeningDeviceSnapshot = { spoken: [], audio: [] };
    window.__listeningDevices = state;
    // Native utterance.voice only accepts branded browser voice objects. Mock
    // the device utterance too, so synthetic voices can exercise assignment.
    class ControlledUtterance {
      voice: SpeechSynthesisVoice | null = null;
      lang = "";
      rate = 1;
      pitch = 1;
      onend: ((event: SpeechSynthesisEvent) => void) | null = null;
      onerror: ((event: SpeechSynthesisErrorEvent) => void) | null = null;
      constructor(readonly text: string) {}
    }
    window.SpeechSynthesisUtterance = ControlledUtterance as unknown as typeof SpeechSynthesisUtterance;
    const voices = ["Synthetic Zoe", "Synthetic Ada", "Synthetic Ben"].map((name) => ({
      name, lang: "en-GB", voiceURI: `synthetic:${name}`, default: false, localService: true,
    }));
    const synthesis = window.speechSynthesis;
    Object.defineProperty(synthesis, "getVoices", { value: () => voices });
    Object.defineProperty(synthesis, "speak", {
      value: (utterance: SpeechSynthesisUtterance) => {
        state.spoken.push({
          text: utterance.text, voice: utterance.voice?.voiceURI || null,
          pitch: utterance.pitch, rate: utterance.rate,
        });
        queueMicrotask(() => utterance.onend?.({} as SpeechSynthesisEvent));
      },
    });
    for (const method of ["cancel", "pause", "resume"])
      Object.defineProperty(synthesis, method, { value: () => undefined });
    // Playback is a synthetic device only. API URLs, authentication and the
    // bundled application remain real; no live provider audio is requested.
    class ControlledAudio extends EventTarget {
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      private record: ListeningDeviceSnapshot["audio"][number];
      constructor(readonly src: string) {
        super();
        this.record = { src, plays: 0, pauses: 0 };
        state.audio.push(this.record);
      }
      async play() { this.record.plays++; }
      pause() { this.record.pauses++; }
    }
    window.Audio = ControlledAudio as unknown as typeof Audio;
  });
}

async function speechHealth(page: Page, provider: "openai" | "elevenlabs" | null) {
  await page.route("**/api/health", async (route) => {
    const response = await route.fetch();
    const health = await response.json();
    await route.fulfill({
      response,
      json: {
        ...health,
        examIntegrityEnabled: false,
        services: {
          ...health.services,
          openai: provider === "openai",
          elevenlabs: provider === "elevenlabs",
          speech: { configured: !!provider, provider, voiceCount: provider ? 6 : 0 },
        },
      },
    });
  });
}

function waveform() {
  const body = Buffer.alloc(44 + 320);
  body.write("RIFF", 0); body.writeUInt32LE(body.length - 8, 4);
  body.write("WAVEfmt ", 8); body.writeUInt32LE(16, 16);
  body.writeUInt16LE(1, 20); body.writeUInt16LE(1, 22);
  body.writeUInt32LE(16000, 24); body.writeUInt32LE(32000, 28);
  body.writeUInt16LE(2, 32); body.writeUInt16LE(16, 34);
  body.write("data", 36); body.writeUInt32LE(body.length - 44, 40);
  return body;
}

const placementState = (): PlacementState => ({
  id: "synthetic-listening-placement", mode: "quick", total: 15, completed: 0,
  theta: 0, standardError: 1, estimatedBand: 5, result: null,
  deadlineAt: new Date(Date.now() + 20 * 60_000).toISOString(),
  serverNow: new Date().toISOString(), suggestedQuestionSeconds: 90,
  question: {
    id: "synthetic-listening-item", skill: "listening", band: 5, cefr: "B1",
    subskill: "specific detail",
    text: "Teacher: Class begins at 09:30.\nPupil: The plan is: study together.",
    question: "When does the class begin?", options: ["09:30", "10:30", "11:30"],
  },
});

async function servePlacement(page: Page, placement: PlacementState) {
  await page.route("**/api/placement/active", (route) => route.fulfill({
    json: { placement },
  }));
}

test("placement browser fallback speaks the content without Teacher or Pupil labels and retains times and colons", async ({ page, duoServer }) => {
  await installListeningDevices(page);
  await speechHealth(page, null);
  const placement = placementState();
  await servePlacement(page, placement);
  await duoLogin(page, duoServer, 0);
  await page.goto("/placement");
  await expect(page.locator(".placement-listening")).toBeVisible();
  await page.getByRole("button", { name: "Nghe đoạn văn", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__listeningDevices.spoken.length)).toBe(2);
  const devices = await page.evaluate(() => window.__listeningDevices);
  expect(devices.spoken.map((line) => line.text)).toEqual([
    "Class begins at 09:30.", "The plan is: study together.",
  ]);
  expect(devices.spoken[0].voice).not.toBe(devices.spoken[1].voice);
  expect(devices.audio).toEqual([]);
  await expect(page.locator(".placement-listening")).toContainText("trình duyệt");
  await expect(page.getByRole("button", { name: "Nghe đoạn văn", exact: true })).toBeEnabled();
  await noOverflow(page);
});

test("full Listening uses the attempt audio endpoint and displays its provider metadata", async ({ page, duoServer }, testInfo) => {
  await installListeningDevices(page);
  // OpenAI speech remains usable when the legacy ElevenLabs flag is false.
  await speechHealth(page, "openai");
  const requested: { path: string; method: string }[] = [];
  page.on("request", (request) => {
    if (/\/api\/(?:content|attempts)\/.+\/(?:audio|listening-audio|listening-source)$/u.test(new URL(request.url()).pathname))
      requested.push({ path: new URL(request.url()).pathname, method: request.method() });
  });
  const notice = "6 giọng AI theo nhân vật · OpenAI · accent chưa kiểm định.";
  await page.route("**/api/attempts/*/listening-audio", (route) => route.fulfill({
    status: 200, body: waveform(), headers: {
      "Content-Type": "audio/wav", "X-Speech-Provider": "openai",
      "X-Speech-Voices": "6",
    },
  }));
  await duoLogin(page, duoServer, 0);
  const source = await duoServer.database.content.findOne({ skill: "listening", format: "full-mock" });
  if (!source) throw new Error("Missing authored Listening mock in isolated fixture database");
  const response = await page.request.post("/api/attempts", { data: { contentId: source.id, mode: "practice" } });
  expect(response.ok(), await response.text()).toBeTruthy();
  const attempt: Attempt = (await response.json()).attempt;
  await page.goto(`/learn/${attempt.id}`);
  await page.getByRole("button", { name: "Phát bản nghe", exact: true }).click();
  await expect(page.getByRole("button", { name: "Dừng", exact: true })).toBeVisible();
  await expect(page.locator(".listening-player")).toContainText(notice);
  expect(requested).toEqual([{ path: `/api/attempts/${attempt.id}/listening-audio`, method: "POST" }]);
  const devices = await page.evaluate(() => window.__listeningDevices);
  expect(devices.spoken).toEqual([]);
  expect(devices.audio).toHaveLength(1);
  expect(devices.audio[0].src).toMatch(/^blob:/u);
  expect(devices.audio[0].plays).toBe(1);
  await noOverflow(page);
  await testInfo.attach("listening-provider-metadata", {
    body: JSON.stringify({ requested, notice, devices }, null, 2), contentType: "application/json",
  });
  await testInfo.attach("listening-provider-controls", {
    body: await page.locator(".listening-player").screenshot(), contentType: "image/png",
  });
  await page.getByRole("button", { name: "Dừng", exact: true }).click();
});

test("placement requests provider audio for the current question, shows metadata, and reports provider failures without browser fallback", async ({ page, duoServer }) => {
  await installListeningDevices(page);
  await speechHealth(page, "elevenlabs");
  const placement = placementState();
  await servePlacement(page, placement);
  const requests: unknown[] = [];
  let providerUnavailable = false;
  const notice = "2 giọng AI theo nhân vật · ElevenLabs · accent chưa kiểm định.";
  await page.route(`**/api/placement/${placement.id}/audio`, async (route) => {
    requests.push({ method: route.request().method(), body: route.request().postDataJSON() });
    if (providerUnavailable) {
      await route.fulfill({ status: 503, json: { error: "Synthetic provider unavailable." } });
      return;
    }
    await route.fulfill({ status: 200, body: waveform(), headers: {
      "Content-Type": "audio/wav", "X-Speech-Provider": "elevenlabs",
      "X-Speech-Voices": "2",
    } });
  });
  await duoLogin(page, duoServer, 0);
  await page.goto("/placement");
  await page.getByRole("button", { name: "Nghe đoạn văn", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__listeningDevices.audio.length)).toBe(1);
  expect(requests).toEqual([{ method: "POST", body: { questionId: placement.question!.id } }]);
  const devices = await page.evaluate(() => window.__listeningDevices);
  expect(devices.spoken).toEqual([]);
  expect(devices.audio[0].plays).toBe(1);
  await expect(page.locator(".placement-listening")).toContainText(notice);
  await noOverflow(page);
  providerUnavailable = true;
  await page.reload();
  await page.getByRole("button", { name: "Nghe đoạn văn", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Synthetic provider unavailable.");
  await expect(page.getByRole("button", { name: "Nghe đoạn văn", exact: true })).toBeEnabled();
  expect(requests).toHaveLength(2);
  expect(await page.evaluate(() => window.__listeningDevices)).toEqual({ spoken: [], audio: [] });
});
