import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import type { Attempt, StoredContent, VocabularyEntry } from "../../shared/types";
import { test, expect, duoLogin, noOverflow, type DuoBrowserServer } from "./duo-fixtures";

interface WordDeviceState {
  spoken: { text: string; lang: string; voice: string | null; rate: number }[];
  failNext: boolean;
  cancellations: number;
}

declare global {
  interface Window { __wordDevice: WordDeviceState }
}

async function installWordDevice(page: Page, supported = true) {
  await page.addInitScript(({ supported }) => {
    const state: WordDeviceState = { spoken: [], failNext: false, cancellations: 0 };
    window.__wordDevice = state;
    if (!supported) {
      Object.defineProperty(window, "speechSynthesis", { configurable: true, value: undefined });
      return;
    }
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
    const voices = [
      { name: "Synthetic British", lang: "en-GB", voiceURI: "synthetic:british", localService: true, default: true },
      { name: "Synthetic American", lang: "en-US", voiceURI: "synthetic:american", localService: true, default: false },
    ];
    const synthesis = window.speechSynthesis;
    Object.defineProperty(synthesis, "getVoices", { configurable: true, value: () => voices });
    for (const property of ["speaking", "pending", "paused"])
      Object.defineProperty(synthesis, property, { configurable: true, get: () => false });
    Object.defineProperty(synthesis, "speak", { configurable: true, value: (utterance: SpeechSynthesisUtterance) => {
      state.spoken.push({ text: utterance.text, lang: utterance.lang, voice: utterance.voice?.voiceURI ?? null, rate: utterance.rate });
      const failed = state.failNext; state.failNext = false;
      queueMicrotask(() => failed
        ? utterance.onerror?.({ error: "audio-busy" } as SpeechSynthesisErrorEvent)
        : utterance.onend?.({} as SpeechSynthesisEvent));
    } });
    Object.defineProperty(synthesis, "cancel", { configurable: true, value: () => { state.cancellations++; } });
    for (const method of ["resume", "pause"])
      Object.defineProperty(synthesis, method, { configurable: true, value: () => undefined });
  }, { supported });
}

const word = "unfaltering";
const ipa = "/ʌnˈfɔːl.tər.ɪŋ/";
const context = "The team showed unfaltering commitment to the learning plan.";

async function seedWord(server: DuoBrowserServer, selectedWord = word, selectedIpa = ipa) {
  const id = `word-pronunciation-${randomUUID()}`;
  const entry: VocabularyEntry = {
    id, word: selectedWord, ipa: selectedIpa, meaning: "không nao núng",
    definition: "Continuing firmly without hesitation.", partOfSpeech: "adjective", cefr: "B2", topic: "Education",
    collocations: [], examples: [context], family: [], commonError: "", synonyms: [], register: "neutral",
  };
  // Only this test's disposable namespace is changed; isolate from any bank
  // entry with the same spelling so the IPA source is unambiguous.
  await server.database.vocabulary.deleteMany({ word: { $regex: `^${selectedWord}$`, $options: "i" } });
  await server.database.vocabulary.insertOne({ ...entry, _id: id });
  return entry;
}

function withoutPronunciation<T extends object>(value: T | null) {
  if (!value) return value;
  const { ipa: _ipa, ipaSource: _source, ...rest } = value as T & { ipa?: string; ipaSource?: string };
  return rest;
}

test("saved cards retain bank IPA, legacy cards resolve it on demand and word playback never changes FSRS", async ({ page, duoServer }, testInfo) => {
  await installWordDevice(page);
  await duoLogin(page, duoServer, 0);
  const entry = await seedWord(duoServer);
  const saved = await page.request.post("/api/vocabulary/cards", { data: { vocabularyId: entry.id } });
  expect(saved.status(), await saved.text()).toBe(201);
  const card = (await saved.json()).card;
  expect(card.ipa).toBe(ipa);
  const original = await duoServer.database.cards.findOne({ _id: card.id });
  await page.goto("/vocabulary");
  await page.getByRole("tab", { name: /^Từ đã lưu/ }).click();
  const row = page.locator(".saved-card").filter({ has: page.getByRole("heading", { name: word, exact: true }) });
  const pronunciation = row.locator(".word-pronunciation");
  await expect(pronunciation.locator(".word-pronunciation-ipa")).toHaveText(ipa);
  await pronunciation.getByRole("button", { name: `Phát âm ${word}`, exact: true }).click();
  await pronunciation.getByRole("button", { name: `Phát âm chậm ${word}`, exact: true }).click();
  const spoken = await page.evaluate(() => window.__wordDevice.spoken);
  expect(spoken).toHaveLength(2);
  expect(spoken.map(item => item.text)).toEqual([word, word]);
  expect(spoken.map(item => item.voice)).toEqual(["synthetic:british", "synthetic:british"]);
  expect(spoken[1].rate).toBeLessThan(spoken[0].rate);
  await pronunciation.getByRole("combobox", { name: `Giọng đọc từ ${word}`, exact: true }).selectOption("en-US");
  await pronunciation.getByRole("button", { name: `Phát âm ${word}`, exact: true }).click();
  expect((await page.evaluate(() => window.__wordDevice.spoken))[2]).toMatchObject({
    text: word, lang: "en-US", voice: "synthetic:american",
  });
  expect(await duoServer.database.cards.findOne({ _id: card.id })).toEqual(original);

  await page.evaluate(() => { window.__wordDevice.failNext = true; });
  await pronunciation.getByRole("button", { name: `Phát âm ${word}`, exact: true }).click();
  await expect(pronunciation.getByRole("status")).toContainText("Chưa phát được âm thanh");
  await pronunciation.getByRole("button", { name: `Phát âm ${word}`, exact: true }).click();
  await expect(pronunciation.getByText("Chưa phát được âm thanh", { exact: false })).toHaveCount(0);

  // Simulate a real card saved before IPA metadata existed. The controlled
  // bank lookup exercises the backend and never contacts a dictionary service.
  await duoServer.database.cards.updateOne({ _id: card.id }, { $unset: { ipa: "", ipaSource: "" } });
  const legacy = await duoServer.database.cards.findOne({ _id: card.id });
  await page.reload();
  await page.getByRole("tab", { name: /^Từ đã lưu/ }).click();
  const lookup = page.waitForResponse(response => new URL(response.url()).pathname === `/api/vocabulary/cards/${card.id}/pronunciation`);
  await row.getByRole("button", { name: `Xem phiên âm ${word}`, exact: true }).click();
  const response = await lookup;
  expect(response.status(), await response.text()).toBe(200);
  expect((await response.json()).pronunciation).toEqual({ word, ipa, source: "bank" });
  await expect(row.locator(".word-pronunciation-ipa")).toHaveText(ipa);
  const enriched = await duoServer.database.cards.findOne({ _id: card.id });
  expect(enriched?.ipa).toBe(ipa);
  expect(withoutPronunciation(enriched)).toEqual(withoutPronunciation(legacy));
  await page.reload();
  await page.getByRole("tab", { name: /^Từ đã lưu/ }).click();
  await expect(row.locator(".word-pronunciation-ipa")).toHaveText(ipa);
  await expect(row.getByRole("button", { name: `Xem phiên âm ${word}`, exact: true })).toHaveCount(0);
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("word-pronunciation-saved.png"), fullPage: true });
});

test("selected lesson words expose IPA and playback in completed review while an active paper remains save-only", async ({ page, duoServer }, testInfo) => {
  await installWordDevice(page);
  await duoLogin(page, duoServer, 0);
  const entry = await seedWord(duoServer);
  const id = `word-pronunciation-source-${randomUUID()}`;
  const content: StoredContent = {
    id, skill: "reading", title: "Synthetic word pronunciation context", description: "Isolated source phonetics check",
    topic: "Education", band: 5, cefr: "B1", testType: "academic", durationMinutes: 10, format: "lesson",
    sections: [{ id: `${id}-source`, title: "A learning plan", text: context }],
    questions: [{ id: `${id}-q`, number: 1, type: "text", sectionIndex: 0, prompt: "What did the team follow?",
      answer: "learning plan", evidence: context, explanation: "The final phrase names the plan.", subskill: "detail" }],
    vocabularyIds: [entry.id], tags: ["synthetic-pronunciation"], source: "authored", quality: "authored-unreviewed", createdAt: new Date().toISOString(),
  };
  await duoServer.database.content.insertOne({ ...content, _id: id });
  const started = await page.request.post("/api/attempts", { data: { contentId: id, mode: "practice" } });
  expect(started.status()).toBe(201);
  const attempt: Attempt = (await started.json()).attempt;
  const pronunciationRequests: string[] = [];
  let popups = 0;
  page.on("request", request => { if (new URL(request.url()).pathname.endsWith("/pronunciation")) pronunciationRequests.push(request.url()); });
  page.on("popup", () => ++popups);
  await page.goto(`/learn/${attempt.id}`);
  await page.getByRole("button", { name: "Chọn từ để lưu", exact: true }).click();
  await page.locator(".reading-passage").getByRole("button", { name: `Lưu từ ${word}`, exact: true }).click();
  const inline = page.getByRole("dialog", { name: word, exact: true });
  await expect(inline).toBeVisible();
  await expect(inline.locator(".word-pronunciation")).toHaveCount(0);
  expect(pronunciationRequests).toHaveLength(0);
  await inline.getByRole("button", { name: "Lưu vào sổ từ của tôi", exact: true }).click();
  await expect(inline.getByRole("button", { name: "Đã có trong sổ từ", exact: true })).toBeDisabled();
  const before = await duoServer.database.cards.findOne({ word });
  expect(before?.meaningStatus).toBe("pending");
  await inline.getByRole("button", { name: "Đóng thẻ từ", exact: true }).click();
  const submitted = await page.request.post(`/api/attempts/${attempt.id}/submit`);
  expect(submitted.ok(), await submitted.text()).toBeTruthy();
  await page.reload();
  await page.getByRole("button", { name: "Chọn từ để xem nghĩa", exact: true }).click();
  await page.locator(".reading-passage").getByRole("button", { name: `Xem nghĩa từ ${word}`, exact: true }).click();
  await expect(inline.locator(".word-pronunciation-ipa")).toHaveText(ipa);
  await inline.getByRole("button", { name: `Phát âm ${word}`, exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__wordDevice.spoken.length)).toBe(1);
  expect((await page.evaluate(() => window.__wordDevice.spoken))[0].text).toBe(word);
  const after = await duoServer.database.cards.findOne({ word });
  expect(after?.scheduler).toBe(before?.scheduler);
  expect(after?.reviewLog).toEqual(before?.reviewLog);
  expect(after?.savedAt).toBe(before?.savedAt);
  expect(popups).toBe(0);
  expect(new URL(page.url()).pathname).toBe(`/learn/${attempt.id}`);
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("word-pronunciation-review.png"), fullPage: true });
});

test("IPA remains readable when the browser has no speech capability", async ({ page, duoServer }) => {
  await installWordDevice(page, false);
  await duoLogin(page, duoServer, 0);
  const entry = await seedWord(duoServer);
  const response = await page.request.post("/api/vocabulary/cards", { data: { vocabularyId: entry.id } });
  expect(response.status()).toBe(201);
  const card = (await response.json()).card;
  const original = await duoServer.database.cards.findOne({ _id: card.id });
  await page.goto("/vocabulary");
  await page.getByRole("tab", { name: /^Từ đã lưu/ }).click();
  const row = page.locator(".saved-card").filter({ has: page.getByRole("heading", { name: word, exact: true }) });
  await expect(row.locator(".word-pronunciation-ipa")).toHaveText(ipa);
  await expect(row.getByRole("button", { name: `Phát âm ${word}`, exact: true })).toBeDisabled();
  await expect(row.getByRole("button", { name: `Phát âm chậm ${word}`, exact: true })).toBeDisabled();
  await expect(row).toContainText("Trình duyệt chưa hỗ trợ phát âm");
  expect(await duoServer.database.cards.findOne({ _id: card.id })).toEqual(original);
  await noOverflow(page);
});
