export type WordAccent = "en-GB" | "en-US";
export interface WordSpeechOptions {
  accent?: WordAccent;
  slow?: boolean;
  onState?: (state: "loading" | "speaking" | "idle") => void;
  onError?: (message: string) => void;
  onNotice?: (message: string) => void;
}

interface WordPlayback { cancel: () => void }
let activeWord: WordPlayback | null = null;

export function wordSpeechAvailable(): boolean {
  return typeof window !== "undefined" && Boolean(window.speechSynthesis)
    && typeof SpeechSynthesisUtterance !== "undefined";
}

/** Called before another app speech player takes over the browser's one queue. */
export function stopWordPronunciation(): void {
  activeWord?.cancel();
}

/** Device speech only: this function never fetches audio or calls a paid API. */
export function pronounceWord(word: string, options: WordSpeechOptions = {}): () => void {
  if (!wordSpeechAvailable())
    throw new Error("Trình duyệt chưa hỗ trợ phát âm. Bạn vẫn có thể đọc phiên âm IPA.");
  const text = word.trim();
  if (!text || text.length > 120) throw new Error("Từ cần phát âm không hợp lệ.");
  const synthesis = window.speechSynthesis;
  const replacingWord = Boolean(activeWord);
  stopWordPronunciation();
  // A lesson/dialogue can own the same browser queue. Do not interrupt it or
  // silently append a word behind a long Listening passage.
  if (!replacingWord && (synthesis.speaking || synthesis.pending))
    throw new Error("Một đoạn nghe khác đang phát. Hãy dừng đoạn đó trước khi nghe từ.");
  let closed = false;
  let voiceTimer: ReturnType<typeof setTimeout> | undefined;
  let playbackTimer: ReturnType<typeof setTimeout> | undefined;
  let utterance: SpeechSynthesisUtterance | null = null;
  const clean = () => {
    if (voiceTimer !== undefined) clearTimeout(voiceTimer);
    if (playbackTimer !== undefined) clearTimeout(playbackTimer);
    synthesis.removeEventListener("voiceschanged", voicesChanged);
    if (utterance) { utterance.onend = null; utterance.onerror = null; }
  };
  const finish = (error?: string, cancelOwned = false) => {
    if (closed) return;
    closed = true;
    const owned = activeWord === session;
    if (owned) activeWord = null;
    clean();
    if (owned && cancelOwned) synthesis.cancel();
    options.onState?.("idle");
    if (error) options.onError?.(error);
  };
  const session: WordPlayback = { cancel: () => finish(undefined, true) };
  activeWord = session;
  function start() {
    if (closed) return;
    const catalog = synthesis.getVoices();
    const english = catalog.filter(voice => /^en(?:[-_]|$)/iu.test(voice.lang));
    if (!english.length) {
      finish("Thiết bị chưa có giọng tiếng Anh. Hãy cài giọng tiếng Anh hoặc thử Chrome/Edge.");
      return;
    }
    const accent = options.accent ?? "en-GB";
    const exact = english.filter(voice => voice.lang.replaceAll("_", "-").toLowerCase() === accent.toLowerCase());
    const candidates = exact.length ? exact : english;
    const voice = candidates.find(item => item.localService) ?? candidates[0];
    if (!exact.length) options.onNotice?.(`Thiết bị đang dùng giọng tiếng Anh ${voice.lang}.`);
    utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = voice.lang;
    utterance.voice = voice;
    utterance.rate = options.slow ? 0.7 : 1;
    utterance.pitch = 1;
    utterance.onend = () => finish();
    utterance.onerror = () => finish("Chưa phát được âm thanh. Hãy kiểm tra âm lượng rồi thử lại.");
    playbackTimer = setTimeout(() => finish("Phát âm chưa hoàn tất. Hãy bấm nghe để thử lại.", true), 20_000);
    options.onState?.("speaking");
    try { synthesis.resume?.(); synthesis.speak(utterance); }
    catch { finish("Chưa phát được âm thanh. Hãy thử lại.", true); }
  }
  function voicesChanged() {
    try {
      if (closed || !synthesis.getVoices().length) return;
      if (voiceTimer !== undefined) clearTimeout(voiceTimer);
      synthesis.removeEventListener("voiceschanged", voicesChanged);
      start();
    } catch { finish("Chưa lấy được giọng đọc tiếng Anh. Hãy thử lại."); }
  }
  options.onState?.("loading");
  try {
    if (synthesis.getVoices().length) start();
    else {
      synthesis.addEventListener("voiceschanged", voicesChanged);
      voiceTimer = setTimeout(() => {
        try { start(); }
        catch { finish("Chưa lấy được giọng đọc tiếng Anh. Hãy thử lại."); }
      }, 1_500);
    }
  } catch { finish("Chưa lấy được giọng đọc tiếng Anh. Hãy thử lại."); }
  return session.cancel;
}
