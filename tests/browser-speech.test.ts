import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { test } from "node:test";
import type { ContentSection } from "../shared/types";

function voice(name: string, lang = "en-GB"): SpeechSynthesisVoice {
  return { name, lang, voiceURI: `synthetic:${name}`, localService: true, default: false };
}

class BrowserUtterance {
  lang = "";
  rate = 1;
  pitch = 1;
  voice: SpeechSynthesisVoice | null = null;
  onend: ((event: SpeechSynthesisEvent) => void) | null = null;
  onerror: ((event: SpeechSynthesisErrorEvent) => void) | null = null;
  constructor(readonly text: string) {}
}

class BrowserSynthesis extends EventTarget {
  voices: SpeechSynthesisVoice[] = [];
  spoken: BrowserUtterance[] = [];
  cancellations = 0;
  getVoices() { return this.voices; }
  speak(utterance: BrowserUtterance) { this.spoken.push(utterance); }
  cancel() { this.cancellations++; }
  finish() {
    for (let index = 0; index < this.spoken.length; index++) {
      if (index > 1_000) throw new Error("Speech failed to terminate");
      this.spoken[index].onend?.({} as SpeechSynthesisEvent);
    }
  }
  load(voices: SpeechSynthesisVoice[]) {
    this.voices = voices;
    this.dispatchEvent(new Event("voiceschanged"));
  }
}

const waitForSpeech = async (synthesis: BrowserSynthesis) => {
  const deadline = Date.now() + 500;
  while (!synthesis.spoken.length && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(synthesis.spoken.length, "Expected the loaded English voice to start playback");
};

test("browser Listening preserves character voices and speaks dialogue without role labels", async (t) => {
  // audio.ts imports the document identity module. Install browser globals before
  // importing it, and restore every descriptor so other native tests stay isolated.
  const names = ["window", "speechSynthesis", "SpeechSynthesisUtterance", "crypto"] as const;
  const originals = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  let synthesis = new BrowserSynthesis();
  const replace = (name: string, value: unknown) => Object.defineProperty(globalThis, name, {
    configurable: true, writable: true, value,
  });
  replace("crypto", webcrypto);
  replace("SpeechSynthesisUtterance", BrowserUtterance);
  function reset(voices: SpeechSynthesisVoice[]) {
    synthesis = new BrowserSynthesis();
    synthesis.voices = voices;
    replace("speechSynthesis", synthesis);
    replace("window", { speechSynthesis: synthesis, setTimeout, clearTimeout });
    return synthesis;
  }
  reset([]);
  try {
    const { speakSections } = await import("../client/audio");
    const sections: ContentSection[] = [
      {
        id: "synthetic-duo", title: "", text: "",
        dialogue: [
          { speaker: "Receptionist", accent: "british", text: "Receptionist: Welcome to the library." },
          { speaker: "Student", accent: "british", text: "Student: I have a booking at 09:30." },
          { speaker: "Receptionist", accent: "british", text: "Receptionist: The reminder is: bring a notebook." },
        ],
      },
      {
        id: "synthetic-repeat", title: "", text: "",
        dialogue: [{ speaker: "Student", accent: "british", text: "Student: Thank you for your help." }],
      },
    ];
    await t.test("same-accent characters keep distinct voices across repeated turns and catalog order, with a fresh cast for each section", async () => {
      const catalog = [voice("Zoe"), voice("Ada"), voice("Ben")];
      const assignments: string[][] = [];
      for (const voices of [catalog, [catalog[1], catalog[0], catalog[2], catalog[1]]]) {
        const device = reset(voices);
        let ended = 0;
        const errors: string[] = [];
        const cancel = speakSections(sections, () => ended++, (error) => errors.push(error));
        await waitForSpeech(device);
        device.finish();
        assert.equal(ended, 1);
        assert.deepEqual(errors, []);
        assert.deepEqual(device.spoken.map((line) => line.text), [
          "Welcome to the library.", "I have a booking at 09:30.",
          "The reminder is: bring a notebook.", "Thank you for your help.",
        ]);
        const assigned = device.spoken.map((line) => line.voice?.voiceURI || "");
        assert.ok(assigned.every(Boolean), "Every turn should use an installed voice");
        assert.notEqual(assigned[0], assigned[1], "Two British speakers should not collapse to one voice");
        assert.equal(assigned[0], assigned[2]);
        assert.notEqual(assigned[1], assigned[3], "A Student in the next section is a separate character");
        assignments.push(assigned);
        cancel();
      }
      assert.deepEqual(assignments[0], assignments[1]);
    });

    await t.test("flat placement role labels are silent while punctuation, times and chunked speech remain intact", async () => {
      const device = reset([voice("Ada"), voice("Ben")]);
      const words = Array.from({ length: 60 }, (_, index) => `detail${index + 1}`).join(" ");
      const cancel = speakSections([
        { id: "placement", title: "", text: "Teacher: Class begins at 09:30.\nPupil: The plan is: study together." },
        { id: "long-turn", title: "", text: "", dialogue: [{ speaker: "Teacher", accent: "british", text: `Teacher: ${words}.` }] },
      ], () => undefined, (error) => assert.fail(error));
      await waitForSpeech(device);
      device.finish();
      const text = device.spoken.map((line) => line.text).join(" ");
      assert.doesNotMatch(text, /Pupil:|Teacher:/u);
      assert.match(text, /Class begins at 09:30\./u);
      assert.match(text, /The plan is: study together\./u);
      assert.match(text, /detail1 detail2/u);
      assert.match(text, /detail59 detail60\./u);
      const chunks = device.spoken.filter((line) => line.text.includes("detail"));
      assert.ok(chunks.length >= 3, "A long turn must be split into short utterances");
      assert.equal(new Set(chunks.map((line) => line.voice?.voiceURI)).size, 1);
      cancel();
    });

    await t.test("waits for delayed English voices instead of choosing a silent browser default", async () => {
      const device = reset([]);
      let ended = 0;
      const errors: string[] = [];
      const cancel = speakSections(sections, () => ended++, (error) => errors.push(error));
      assert.equal(device.spoken.length, 0);
      device.load([voice("Zoe"), voice("Ada")]);
      await waitForSpeech(device);
      device.finish();
      assert.equal(ended, 1);
      assert.deepEqual(errors, []);
      assert.ok(device.spoken.every((line) => line.voice));
      cancel();
    });

    await t.test("canceling while voices load prevents late speech and callbacks", async () => {
      const device = reset([]);
      let ended = 0;
      const errors: string[] = [];
      const notices: string[] = [];
      const cancel = speakSections(sections, () => ended++, (error) => errors.push(error), {
        onNotice: (notice) => notices.push(notice),
      });
      cancel();
      device.load([voice("Ada"), voice("Ben")]);
      await new Promise((resolve) => setTimeout(resolve, 25));
      assert.equal(device.spoken.length, 0);
      assert.equal(ended, 0);
      assert.deepEqual(errors, []);
      assert.deepEqual(notices, []);
      assert.ok(device.cancellations >= 1);
    });

    await t.test("a catalog without English voices reports one actionable error without silent default playback", async () => {
      const device = reset([voice("Synthetic Spanish", "es-ES")]);
      let ended = 0;
      const errors: string[] = [];
      const cancel = speakSections(sections, () => ended++, (error) => errors.push(error));
      await new Promise((resolve) => setTimeout(resolve, 5));
      device.load([voice("Synthetic Spanish", "es-ES")]);
      assert.equal(device.spoken.length, 0);
      assert.equal(ended, 0);
      assert.equal(errors.length, 1);
      assert.match(errors[0], /giọng.*tiếng Anh/u);
      cancel();
    });

    await t.test("a single installed voice discloses character sharing and varies delivery without claiming distinct voices", async () => {
      const device = reset([voice("Only English voice")]);
      const notices: string[] = [];
      const cancel = speakSections(sections, () => undefined, (error) => assert.fail(error), {
        onNotice: (notice) => notices.push(notice),
      });
      await waitForSpeech(device);
      device.finish();
      assert.equal(new Set(device.spoken.map((line) => line.voice?.voiceURI)).size, 1);
      assert.notDeepEqual(
        [device.spoken[0].pitch, device.spoken[0].rate],
        [device.spoken[1].pitch, device.spoken[1].rate],
      );
      assert.ok(notices.some((notice) => /1 giọng/u.test(notice)));
      cancel();
    });
  } finally {
    synthesis.cancel();
    for (const [name, descriptor] of originals)
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
  }
});
