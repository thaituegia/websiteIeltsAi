import type { Page } from "@playwright/test";
import type { Attempt, ListeningAudioReadiness, PlacementState } from "../../shared/types";
import type { Database } from "../../server/storage";
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

async function speechHealth(page: Page, provider: "openai" | "elevenlabs" | null, integrityEnabled = false) {
  await page.route("**/api/health", async (route) => {
    const response = await route.fetch();
    const health = await response.json();
    await route.fulfill({
      response,
      json: {
        ...health,
        examIntegrityEnabled: integrityEnabled,
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
  let deliverAudio!: () => void;
  const preparedDelivery = new Promise<void>(resolve => { deliverAudio = resolve; });
  await page.route("**/api/attempts/*/listening-audio", async route => {
    await preparedDelivery;
    await route.fulfill({
      status: 200, body: waveform(), headers: {
        "Content-Type": "audio/wav", "X-Speech-Provider": "openai",
        "X-Speech-Voices": "6", "X-Speech-Cache": "hit",
      },
    });
  });
  await duoLogin(page, duoServer, 0);
  const source = await duoServer.database.content.findOne({ skill: "listening", format: "full-mock" });
  if (!source) throw new Error("Missing authored Listening mock in isolated fixture database");
  const response = await page.request.post("/api/attempts", { data: { contentId: source.id, mode: "practice" } });
  expect(response.ok(), await response.text()).toBeTruthy();
  const attempt: Attempt = (await response.json()).attempt;
  await page.goto(`/learn/${attempt.id}`);
  await page.getByRole("button", { name: "Phát bản nghe", exact: true }).click();
  try {
    await expect(page.locator(".listening-player")).toContainText("Đang tải bản nghe đã chuẩn bị sẵn");
    expect(await page.evaluate(() => window.__listeningDevices)).toEqual({ spoken: [], audio: [] });
  } finally { deliverAudio(); }
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

test("placement loads prepared audio for the current question, shows metadata, and reports cache delivery failures without browser fallback", async ({ page, duoServer }) => {
  await installListeningDevices(page);
  await speechHealth(page, "elevenlabs");
  const placement = placementState();
  await servePlacement(page, placement);
  const requests: unknown[] = [];
  let cachedAudioUnavailable = false;
  const notice = "2 giọng AI theo nhân vật · ElevenLabs · accent chưa kiểm định.";
  await page.route(`**/api/placement/${placement.id}/audio`, async (route) => {
    requests.push({ method: route.request().method(), body: route.request().postDataJSON() });
    if (cachedAudioUnavailable) {
      await route.fulfill({ status: 503, json: { error: "Synthetic prepared audio unavailable." } });
      return;
    }
    await route.fulfill({ status: 200, body: waveform(), headers: {
      "Content-Type": "audio/wav", "X-Speech-Provider": "elevenlabs",
      "X-Speech-Voices": "2", "X-Speech-Cache": "hit",
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
  cachedAudioUnavailable = true;
  await page.reload();
  await page.getByRole("button", { name: "Nghe đoạn văn", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Synthetic prepared audio unavailable.");
  await expect(page.getByRole("button", { name: "Nghe đoạn văn", exact: true })).toBeEnabled();
  expect(requests).toHaveLength(2);
  expect(await page.evaluate(() => window.__listeningDevices)).toEqual({ spoken: [], audio: [] });
});

async function listeningResourceSnapshot(database: Database) {
  const collections = ["attempts", "placements", "exam_integrity_sessions", "speech_audio_jobs", "speech_audio.files", "speech_audio.chunks"];
  return Object.fromEntries(await Promise.all(collections.map(async name => [name,
    await database.db.collection(name).find().sort({ _id: 1 }).toArray(),
  ])));
}

function resourceWrites(page: Page) {
  const requests: { path: string; method: string }[] = [];
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (request.method() !== "GET" && (/^\/api\/(?:attempts|placement\/start|exam-integrity\/open)$/u.test(path)
      || /\/api\/(?:attempts|content|placement)\/.+\/(?:audio|listening-audio|listening-source)$/u.test(path)))
      requests.push({ path, method: request.method() });
  });
  return requests;
}

function readiness(ready: boolean, totalCount: number): ListeningAudioReadiness {
  return {
    configured: true, ready, state: ready ? "ready" : "pending",
    notice: ready ? "Bản nghe đã sẵn sàng." : "Bản nghe đang được chuẩn bị sẵn. Hãy kiểm tra lại sau.",
    readyCount: ready ? totalCount : 0, totalCount,
  };
}

test.describe("prepared Listening gates", () => {
  test.use({ integrityEnabled: true });

  for (const mode of ["practice", "exam"] as const) {
    test(`${mode} waits for a GET-only readiness refresh before creating a Listening sitting`, async ({ page, duoServer }, testInfo) => {
      await installListeningDevices(page);
      await speechHealth(page, "openai", true);
      let prepared = false;
      const checks: { path: string; method: string; ready: boolean }[] = [];
      await page.route(/\/api\/content\/[^/]+\/listening-audio\/readiness(?:\?.*)?$/u, async route => {
        const url = new URL(route.request().url());
        expect(route.request().method()).toBe("GET");
        expect(url.searchParams.get("mode")).toBe(mode);
        checks.push({ path: url.pathname + url.search, method: route.request().method(), ready: prepared });
        await route.fulfill({ json: { audio: readiness(prepared, mode === "exam" ? 4 : 1) } });
      });
      const writes = resourceWrites(page);
      await duoLogin(page, duoServer, 0);
      const before = await listeningResourceSnapshot(duoServer.database);
      await page.goto(`${mode === "exam" ? "/exams" : "/library"}?skill=listening`);
      const card = page.locator(".content-card.listening").first();
      const start = card.getByRole("button", { name: mode === "exam" ? "Bắt đầu thi thử" : "Bắt đầu luyện", exact: true });
      await start.click();
      await expect(card.getByRole("status")).toHaveText(readiness(false, 1).notice);
      await expect(start).toBeDisabled();
      await expect(page.getByRole("dialog", { name: "Quy định phòng thi", exact: true })).toHaveCount(0);
      await expect(page.locator(".learning-page")).toHaveCount(0);
      expect(writes).toEqual([]);
      expect(await listeningResourceSnapshot(duoServer.database)).toEqual(before);
      expect(await page.evaluate(() => window.__listeningDevices)).toEqual({ spoken: [], audio: [] });

      const refresh = card.getByRole("button", { name: "Kiểm tra lại âm thanh", exact: true });
      await refresh.click();
      await expect.poll(() => checks.length).toBe(2);
      await expect(start).toBeDisabled();
      expect(checks.map(check => check.method)).toEqual(["GET", "GET"]);
      expect(writes).toEqual([]);
      expect(await listeningResourceSnapshot(duoServer.database)).toEqual(before);

      prepared = true;
      await refresh.click();
      await expect(card.getByRole("status")).toHaveText(readiness(true, 1).notice);
      await expect(start).toBeEnabled();
      await expect(refresh).toHaveCount(0);
      expect(checks.map(check => check.ready)).toEqual([false, false, true]);
      expect(writes).toEqual([]);
      expect(await listeningResourceSnapshot(duoServer.database)).toEqual(before);
      await noOverflow(page);
      await testInfo.attach(`listening-${mode}-prepared-readiness`, {
        body: JSON.stringify({ checks, writes, resources: before }, null, 2), contentType: "application/json",
      });

      const created = page.waitForResponse(response => new URL(response.url()).pathname === "/api/attempts" && response.request().method() === "POST");
      await start.click();
      if (mode === "exam") {
        const rules = page.getByRole("dialog", { name: "Quy định phòng thi", exact: true });
        await expect(rules).toBeVisible();
        expect(writes).toEqual([]);
        expect(await listeningResourceSnapshot(duoServer.database)).toEqual(before);
        await rules.getByRole("button", { name: "Tôi hiểu, bắt đầu bài thi", exact: true }).click();
      }
      const response = await created;
      expect(response.status(), await response.text()).toBe(201);
      const attempt: Attempt = (await response.json()).attempt;
      expect(attempt.mode).toBe(mode); expect(attempt.skill).toBe("listening");
      expect((await duoServer.database.attempts.findOne({ _id: attempt.id }))?.startedAt).toBeTruthy();
      await expect(page.locator(".learning-page")).toBeVisible();
      expect(checks.every(check => check.method === "GET")).toBe(true);
      expect(await page.evaluate(() => window.__listeningDevices)).toEqual({ spoken: [], audio: [] });
    });
  }

  test("placement waits for all clips before consent and starts only after a GET-only refresh", async ({ page, duoServer }, testInfo) => {
    await installListeningDevices(page);
    await speechHealth(page, "openai", true);
    let prepared = false;
    const checks: { method: string; ready: boolean }[] = [];
    await page.route("**/api/placement/audio/readiness", async route => {
      expect(route.request().method()).toBe("GET");
      checks.push({ method: route.request().method(), ready: prepared });
      await route.fulfill({ json: { audio: readiness(prepared, 240) } });
    });
    const writes = resourceWrites(page);
    await duoLogin(page, duoServer, 0);
    const before = await listeningResourceSnapshot(duoServer.database);
    await page.goto("/placement");
    const quick = page.getByRole("button", { name: "Bắt đầu kiểm tra nhanh", exact: true });
    const deep = page.getByRole("button", { name: "Bắt đầu đánh giá chuyên sâu", exact: true });
    await quick.click();
    await expect(page.getByRole("status")).toContainText(readiness(false, 240).notice);
    await expect(quick).toBeDisabled(); await expect(deep).toBeDisabled();
    await expect(page.getByRole("dialog", { name: "Quy định phòng thi", exact: true })).toHaveCount(0);
    await expect(page.locator(".placement-question")).toHaveCount(0);
    expect(writes).toEqual([]);
    expect(await listeningResourceSnapshot(duoServer.database)).toEqual(before);
    const refresh = page.getByRole("button", { name: "Kiểm tra lại âm thanh", exact: true });
    await refresh.click();
    await expect.poll(() => checks.length).toBe(2);
    await expect(quick).toBeDisabled(); await expect(deep).toBeDisabled();
    expect(writes).toEqual([]);
    expect(await listeningResourceSnapshot(duoServer.database)).toEqual(before);

    prepared = true;
    await refresh.click();
    await expect(page.getByRole("status")).toContainText(readiness(true, 240).notice);
    await expect(quick).toBeEnabled(); await expect(deep).toBeEnabled();
    await expect(refresh).toHaveCount(0);
    expect(checks).toEqual([{ method: "GET", ready: false }, { method: "GET", ready: false }, { method: "GET", ready: true }]);
    expect(writes).toEqual([]);
    expect(await listeningResourceSnapshot(duoServer.database)).toEqual(before);
    expect(await page.evaluate(() => window.__listeningDevices)).toEqual({ spoken: [], audio: [] });
    await noOverflow(page);
    await testInfo.attach("placement-prepared-readiness", {
      body: JSON.stringify({ checks, writes, resources: before }, null, 2), contentType: "application/json",
    });

    await quick.click();
    const rules = page.getByRole("dialog", { name: "Quy định phòng thi", exact: true });
    await expect(rules).toBeVisible();
    expect(writes).toEqual([]);
    expect(await listeningResourceSnapshot(duoServer.database)).toEqual(before);
    const started = page.waitForResponse(response => new URL(response.url()).pathname === "/api/placement/start" && response.request().method() === "POST");
    await rules.getByRole("button", { name: "Tôi hiểu, bắt đầu bài thi", exact: true }).click();
    const response = await started;
    expect(response.status(), await response.text()).toBe(201);
    const placement: PlacementState = (await response.json()).placement;
    expect((await duoServer.database.placements.findOne({ _id: placement.id }))?.startedAt).toBeTruthy();
    await expect(page.locator(".placement-question")).toBeVisible();
    expect(checks.every(check => check.method === "GET")).toBe(true);
    expect(await page.evaluate(() => window.__listeningDevices)).toEqual({ spoken: [], audio: [] });
  });
});
