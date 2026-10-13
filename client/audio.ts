import type { Attempt, ContentSection } from "../shared/types";
import { buildSpeechScript, chunkSpeechTurns } from "../shared/speech-script";
import { examHeaders } from "./examTransport";

export interface RecordingSession {
  stop: () => Promise<Blob>;
  discard: () => Promise<void>;
}

/** Actual microphone PCM, resampled to mono 16 kHz WAV for speech services. */
export async function startRecording(): Promise<RecordingSession> {
  if (!navigator.mediaDevices?.getUserMedia)
    throw new Error(
      "Ghi âm cần HTTPS hoặc localhost và trình duyệt hỗ trợ microphone.",
    );
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const context = new AudioContext();
  const chunks: Float32Array[] = [];
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const mute = context.createGain();
  mute.gain.value = 0;
  source.connect(processor);
  processor.connect(mute);
  mute.connect(context.destination);
  processor.onaudioprocess = (event) =>
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  await context.resume();
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    processor.onaudioprocess = null;
    source.disconnect();
    processor.disconnect();
    mute.disconnect();
    stream.getTracks().forEach((track) => track.stop());
    await context.close();
  }
  return {
    async stop() {
      const rate = context.sampleRate;
      await close();
      const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
      const samples = new Float32Array(length);
      let cursor = 0;
      for (const chunk of chunks) {
        samples.set(chunk, cursor);
        cursor += chunk.length;
      }
      if (!samples.length)
        throw new Error(
          "Bản ghi chưa có âm thanh. Hãy ghi âm thêm và thử lại.",
        );
      const count = Math.floor((samples.length * 16000) / rate);
      const buffer = new ArrayBuffer(44 + count * 2);
      const view = new DataView(buffer);
      function text(offset: number, value: string) {
        for (let index = 0; index < value.length; index++)
          view.setUint8(offset + index, value.charCodeAt(index));
      }
      text(0, "RIFF");
      view.setUint32(4, 36 + count * 2, true);
      text(8, "WAVE");
      text(12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, 16000, true);
      view.setUint32(28, 32000, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      text(36, "data");
      view.setUint32(40, count * 2, true);
      for (let index = 0; index < count; index++) {
        const position = (index * rate) / 16000;
        const left = Math.floor(position);
        const sample = Math.max(
          -1,
          Math.min(
            1,
            samples[left] * (1 - (position - left)) +
              (samples[Math.min(left + 1, samples.length - 1)] || 0) *
                (position - left),
          ),
        );
        view.setInt16(
          44 + index * 2,
          Math.round(sample < 0 ? sample * 32768 : sample * 32767),
          true,
        );
      }
      return new Blob([buffer], { type: "audio/wav" });
    },
    discard: close,
  };
}

export interface BrowserSpeechOptions {
  onNotice?: (message: string) => void;
}

/** Fetches prepared, authenticated exam-scoped audio without exposing provider credentials. */
export async function fetchListeningAudio(
  path: string,
  signal: AbortSignal,
  body?: { questionId: string },
): Promise<{ blob: Blob; notice: string; voiceCount: number | null }> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      credentials: "include",
      signal,
      headers: { ...examHeaders(), ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (cause) {
    if (signal.aborted) throw cause;
    throw new Error("Không kết nối được dịch vụ âm thanh AI. Kiểm tra kết nối và thử lại.");
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    const message = payload?.error || "Không tải được bản nghe AI đã chuẩn bị.";
    throw new Error(response.status >= 500 || response.status === 429
      ? `${message} Hãy kiểm tra lại trạng thái âm thanh.` : message);
  }
  const blob = await response.blob();
  if (!blob.size) throw new Error("Bản nghe AI chưa có âm thanh. Hãy thử lại.");
  const provider = response.headers.get("X-Speech-Provider");
  const providerName = provider === "openai" ? "OpenAI" : provider === "elevenlabs" ? "ElevenLabs" : "AI";
  const count = Number(response.headers.get("X-Speech-Voices"));
  const voiceCount = Number.isInteger(count) && count > 0 ? count : null;
  const voices = voiceCount ? `${voiceCount} giọng AI theo nhân vật` : "Giọng AI theo nhân vật";
  return { blob, voiceCount, notice: `${voices} · ${providerName} · accent chưa kiểm định.` };
}

export function speakSections(
  sections: ContentSection[],
  onEnd: () => void,
  onError: (message: string) => void,
  options: BrowserSpeechOptions = {},
) {
  if (!("speechSynthesis" in window))
    throw new Error(
      "Trình duyệt chưa hỗ trợ đọc văn bản. Thử Chrome hoặc Edge.",
    );
  const turns = buildSpeechScript(sections);
  // Short utterances avoid Chromium's long-utterance playback stalls.
  const lines = chunkSpeechTurns(turns, 220);
  if (!lines.length)
    throw new Error("Bài nghe chưa có nội dung phát âm thanh.");
  speechSynthesis.cancel();
  speechSynthesis.resume?.();
  let cursor = 0;
  let cancelled = false;
  let finished = false;
  let cancelVoiceWait: (() => void) | null = null;
  const languageFor = (accent: string) => accent === "american" ? "en-US"
    : accent === "australian" ? "en-AU" : "en-GB";
  const normalizedLanguage = (language: string) => language.replaceAll("_", "-").toLowerCase();
  const voiceKey = (voice: SpeechSynthesisVoice) =>
    voice.voiceURI || `${normalizedLanguage(voice.lang)}|${voice.name}`;
  function englishVoices() {
    const unique = new Map<string, SpeechSynthesisVoice>();
    const sorted = [...speechSynthesis.getVoices()].filter(voice => /^en(?:[-_]|$)/iu.test(voice.lang))
      .sort((left, right) => {
        const a = `${normalizedLanguage(left.lang)}|${left.name}|${voiceKey(left)}|${left.localService}`;
        const b = `${normalizedLanguage(right.lang)}|${right.name}|${voiceKey(right)}|${right.localService}`;
        return a < b ? -1 : a > b ? 1 : 0;
      });
    for (const voice of sorted) if (!unique.has(voiceKey(voice))) unique.set(voiceKey(voice), voice);
    return [...unique.values()];
  }
  function fail(message: string) {
    if (cancelled || finished) return;
    finished = true;
    speechSynthesis.cancel();
    onError(message);
  }
  async function begin() {
    if (!speechSynthesis.getVoices().length) {
      await new Promise<void>(resolve => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          speechSynthesis.removeEventListener("voiceschanged", changed);
          cancelVoiceWait = null;
          resolve();
        };
        const changed = () => { if (speechSynthesis.getVoices().length) finish(); };
        const timer = window.setTimeout(finish, 1200);
        cancelVoiceWait = finish;
        speechSynthesis.addEventListener("voiceschanged", changed);
        changed();
      });
    }
    if (cancelled) return;
    const voices = englishVoices();
    if (!voices.length) {
      fail("Thiết bị chưa có giọng đọc tiếng Anh. Hãy cài giọng tiếng Anh hoặc thử trình duyệt khác.");
      return;
    }
    const speakers = [...new Map(turns.map(turn => [turn.speakerId, turn])).values()];
    const assigned = new Map<string, SpeechSynthesisVoice>();
    const used = new Set<string>();
    const matches = (voice: SpeechSynthesisVoice, accent: string) =>
      normalizedLanguage(voice.lang).startsWith(languageFor(accent).toLowerCase());
    // Reserve matching accents before assigning the remaining English voices.
    for (const speaker of speakers) {
      const voice = voices.find(candidate => !used.has(voiceKey(candidate)) && matches(candidate, speaker.accent));
      if (voice) { assigned.set(speaker.speakerId, voice); used.add(voiceKey(voice)); }
    }
    for (const speaker of speakers) {
      if (assigned.has(speaker.speakerId)) continue;
      const voice = voices.find(candidate => !used.has(voiceKey(candidate)))
        || voices.find(candidate => matches(candidate, speaker.accent)) || voices[0];
      assigned.set(speaker.speakerId, voice);
      used.add(voiceKey(voice));
    }
    options.onNotice?.(voices.length === 1 && speakers.length > 1
      ? "Thiết bị chỉ có 1 giọng tiếng Anh; các nhân vật chỉ khác nhẹ về cao độ và tốc độ."
      : used.size < speakers.length
        ? `Thiết bị có ${used.size} giọng tiếng Anh cho ${speakers.length} nhân vật; một số nhân vật dùng chung giọng.`
        : `${used.size} giọng trình duyệt theo nhân vật · accent chưa kiểm định.`);
    function next() {
      if (cancelled || finished) return;
      const line = lines[cursor++];
      if (!line) { finished = true; onEnd(); return; }
      const utterance = new SpeechSynthesisUtterance(line.text);
      const speakerIndex = speakers.findIndex(speaker => speaker.speakerId === line.speakerId);
      const deliveryOffset = speakers.length > 1 ? speakerIndex / (speakers.length - 1) * 2 - 1 : 0;
      utterance.lang = languageFor(line.accent);
      utterance.voice = assigned.get(line.speakerId) || null;
      utterance.rate = voices.length === 1 ? 0.93 + deliveryOffset * 0.025 : 0.93;
      utterance.pitch = voices.length === 1 ? 1 + deliveryOffset * 0.08 : 1;
      utterance.onend = next;
      utterance.onerror = event => {
        if (!["interrupted", "canceled"].includes(event.error))
          fail("Không phát được giọng trình duyệt. Kiểm tra âm lượng và giọng đọc tiếng Anh trên thiết bị.");
      };
      try { speechSynthesis.speak(utterance); }
      catch { fail("Không phát được giọng trình duyệt. Kiểm tra âm lượng và giọng đọc tiếng Anh trên thiết bị."); }
    }
    next();
  }
  void begin().catch(() => fail("Không tải được giọng trình duyệt. Hãy thử lại."));
  return () => {
    cancelled = true;
    cancelVoiceWait?.();
    speechSynthesis.cancel();
  };
}

export async function submitSpeaking(
  id: string,
  audio: Blob | null,
  transcript: string,
  progress: (stage: string, transcript?: string) => void,
): Promise<Attempt> {
  const body = new FormData();
  if (audio) body.append("audio", audio, "speaking.wav");
  body.append("transcript", transcript);
  const response = await fetch(
    `/api/attempts/${encodeURIComponent(id)}/speaking`,
    {
      method: "POST",
      credentials: "include",
      headers: { Accept: "text/event-stream", ...examHeaders() },
      body,
    },
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(
      payload?.error || `Không gửi được bản ghi (${response.status}).`,
    );
  }
  if (!response.headers.get("content-type")?.includes("text/event-stream"))
    return ((await response.json()) as { attempt: Attempt }).attempt;
  if (!response.body)
    throw new Error("Trình duyệt không hỗ trợ phản hồi trực tiếp.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let result: Attempt | null = null;
  function consume(block: string) {
    const name = block
      .split("\n")
      .find((line) => line.startsWith("event:"))
      ?.slice(6)
      .trim();
    const text = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (!text) return;
    const payload = JSON.parse(text) as {
      attempt?: Attempt;
      error?: string;
      stage?: string;
      transcript?: string;
    };
    if (name === "error")
      throw new Error(payload.error || "Không xử lý được bài Speaking.");
    if (name === "result" && payload.attempt) result = payload.attempt;
    if (name === "progress")
      progress(payload.stage || "processing", payload.transcript);
  }
  try {
    for (;;) {
      const part = await reader.read();
      pending += decoder
        .decode(part.value, { stream: !part.done })
        .replaceAll("\r\n", "\n");
      let boundary: number;
      while ((boundary = pending.indexOf("\n\n")) >= 0) {
        consume(pending.slice(0, boundary));
        pending = pending.slice(boundary + 2);
      }
      if (part.done) break;
    }
    if (pending.trim()) consume(pending);
  } finally {
    reader.releaseLock();
  }
  if (!result)
    throw new Error(
      "Máy chủ chưa trả kết quả. Bản ghi đã gửi; hãy tải lại để kiểm tra trạng thái trước khi thử lại.",
    );
  return result;
}
