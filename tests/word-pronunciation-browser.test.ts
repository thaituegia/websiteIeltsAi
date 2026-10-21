import assert from "node:assert/strict";
import { test } from "node:test";
import { pronounceWord, stopWordPronunciation, wordSpeechAvailable } from "../client/word-pronunciation";

function voice(name: string, lang: string, localService = true): SpeechSynthesisVoice {
  return { name, lang, localService, default: false, voiceURI: `synthetic:${name}` };
}
class Utterance {
  lang = ""; rate = 1; pitch = 1; voice: SpeechSynthesisVoice | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly text: string) {}
}
class Synthesis extends EventTarget {
  voices: SpeechSynthesisVoice[] = [];
  spoken: Utterance[] = [];
  cancellations = 0; speaking = false; pending = false;
  getVoices() { return this.voices; }
  speak(utterance: Utterance) { this.spoken.push(utterance); this.speaking = true; }
  cancel() { ++this.cancellations; this.speaking = false; this.pending = false; }
  resume() {}
  load(voices: SpeechSynthesisVoice[]) { this.voices = voices; this.dispatchEvent(new Event("voiceschanged")); }
  finish() { this.speaking = false; this.spoken.at(-1)?.onend?.(); }
}

test("word pronunciation uses device English voices without paid audio calls or stealing another player", async t => {
  const keys = ["window", "SpeechSynthesisUtterance", "fetch"] as const;
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const replace = (key: string, value: unknown) => Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  replace("SpeechSynthesisUtterance", Utterance);
  replace("fetch", () => { throw new Error("Word playback must never fetch paid/provider audio"); });
  let synthesis: Synthesis;
  function device(voices: SpeechSynthesisVoice[] = []) {
    stopWordPronunciation();
    synthesis = new Synthesis(); synthesis.voices = voices;
    replace("window", { speechSynthesis: synthesis });
    return synthesis;
  }
  try {
    await t.test("unsupported browsers report the limitation while leaving IPA usable", () => {
      replace("window", {});
      assert.equal(wordSpeechAvailable(), false);
      assert.throws(() => pronounceWord("habitat"), /phiên âm IPA/u);
    });

    await t.test("selects a real requested English accent and reads the word, not IPA", () => {
      const player = device([voice("Vietnamese", "vi-VN"), voice("American", "en-US"), voice("British", "en-GB")]);
      const state: string[] = [];
      const cancel = pronounceWord("habitat", { accent: "en-GB", onState: value => state.push(value) });
      assert.equal(player.spoken[0].text, "habitat");
      assert.equal(player.spoken[0].voice?.name, "British");
      assert.equal(player.spoken[0].lang, "en-GB");
      assert.equal(player.spoken[0].rate, 1);
      player.finish(); cancel();
      assert.deepEqual(state, ["loading", "speaking", "idle"]);
      assert.equal(player.cancellations, 0, "Completed media cleanup must not cancel a new player");
    });

    await t.test("slow/repeat controls replace only the previous owned word", () => {
      const player = device([voice("American", "en-US")]);
      const firstCancel = pronounceWord("conservation", { accent: "en-US" });
      const secondCancel = pronounceWord("conservation", { accent: "en-US", slow: true });
      assert.equal(player.spoken.length, 2);
      assert.equal(player.spoken[1].rate, 0.7);
      assert.equal(player.cancellations, 1);
      firstCancel();
      assert.equal(player.cancellations, 1, "A stale component cannot cancel the next word");
      secondCancel();
      assert.equal(player.cancellations, 2);
    });

    await t.test("waits for delayed voices and removes the pending request on close", () => {
      const player = device();
      let errors = 0;
      const cancel = pronounceWord("lantern", { onError: () => ++errors });
      assert.equal(player.spoken.length, 0);
      player.load([voice("British", "en-GB")]);
      assert.equal(player.spoken.length, 1);
      cancel();
      const pending = device();
      const close = pronounceWord("river", { onError: () => ++errors });
      close();
      pending.load([voice("British", "en-GB")]);
      assert.equal(pending.spoken.length, 0);
      assert.equal(errors, 0);
    });

    await t.test("a non-English catalog reports an error without using a default voice", () => {
      const player = device([voice("Vietnamese", "vi-VN")]);
      const errors: string[] = [];
      pronounceWord("school", { onError: value => errors.push(value) });
      assert.equal(player.spoken.length, 0);
      assert.equal(errors.length, 1);
      assert.match(errors[0], /giọng tiếng Anh/u);
    });

    await t.test("discloses the actual English fallback accent", () => {
      const player = device([voice("Australian", "en-AU")]);
      const notices: string[] = [];
      const cancel = pronounceWord("teacher", { accent: "en-GB", onNotice: value => notices.push(value) });
      assert.equal(player.spoken[0].lang, "en-AU");
      assert.match(notices[0], /en-AU/u);
      cancel();
    });

    await t.test("playback failure returns to idle and another click can retry", () => {
      const player = device([voice("British", "en-GB")]);
      const errors: string[] = [], states: string[] = [];
      pronounceWord("garden", { onError: value => errors.push(value), onState: value => states.push(value) });
      player.spoken[0].onerror?.(); player.speaking = false;
      assert.equal(states.at(-1), "idle");
      assert.equal(errors.length, 1);
      const cancel = pronounceWord("garden");
      assert.equal(player.spoken.length, 2);
      cancel();
    });

    await t.test("an existing Listening playback is neither cancelled nor queued behind", () => {
      const player = device([voice("British", "en-GB")]);
      player.speaking = true;
      assert.throws(() => pronounceWord("train"), /đoạn nghe khác/u);
      assert.equal(player.cancellations, 0);
      assert.equal(player.spoken.length, 0);
    });

    await t.test("Listening takeover clears word ownership before later component cleanup", () => {
      const player = device([voice("British", "en-GB")]);
      const oldCleanup = pronounceWord("library");
      stopWordPronunciation();
      player.speak(new Utterance("A Listening dialogue owns the queue now."));
      const before = player.cancellations;
      oldCleanup();
      assert.equal(player.cancellations, before);
      assert.equal(player.speaking, true);
    });
  } finally {
    stopWordPronunciation();
    for (const [key, descriptor] of previous)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
  }
});
