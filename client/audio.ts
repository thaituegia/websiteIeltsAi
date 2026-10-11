import type { Attempt, ContentSection } from "../shared/types";
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

export function speakSections(
  sections: ContentSection[],
  onEnd: () => void,
  onError: (message: string) => void,
) {
  if (!("speechSynthesis" in window))
    throw new Error(
      "Trình duyệt chưa hỗ trợ đọc văn bản. Thử Chrome hoặc Edge.",
    );
  speechSynthesis.cancel();
  const lines = sections
    .flatMap((section) => [
      { text: section.title, accent: "british" },
      ...(section.dialogue?.length
        ? section.dialogue.map((line) => ({
            text: line.text,
            accent: line.accent,
          }))
        : [{ text: section.text, accent: "british" }]),
    ])
    .filter((line) => line.text.trim())
    .flatMap((line) => {
      // Short utterances avoid Chromium's long-utterance playback stalls.
      const sentences = line.text.split(/(?<=[.!?])\s+/u);
      return sentences.flatMap((sentence) => {
        const words = sentence.trim().split(/\s+/u);
        const chunks: { text: string; accent: string }[] = [];
        for (let index = 0; index < words.length; index += 26)
          chunks.push({
            text: words.slice(index, index + 26).join(" "),
            accent: line.accent,
          });
        return chunks;
      });
    });
  if (!lines.length)
    throw new Error("Bài nghe chưa có nội dung phát âm thanh.");
  const voices = speechSynthesis.getVoices();
  let cursor = 0;
  let cancelled = false;
  function next() {
    if (cancelled) return;
    const line = lines[cursor++];
    if (!line) {
      onEnd();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(line.text);
    const language =
      line.accent === "american"
        ? "en-US"
        : line.accent === "australian"
          ? "en-AU"
          : "en-GB";
    utterance.lang = language;
    utterance.rate = 0.93;
    utterance.voice =
      voices.find((voice) => voice.lang === language) ||
      voices.find((voice) => voice.lang.startsWith("en")) ||
      null;
    utterance.onend = next;
    utterance.onerror = (event) => {
      if (!cancelled && !["interrupted", "canceled"].includes(event.error))
        onError(
          "Không phát được giọng trình duyệt. Kiểm tra âm lượng và giọng đọc tiếng Anh trên thiết bị.",
        );
    };
    speechSynthesis.speak(utterance);
  }
  next();
  return () => {
    cancelled = true;
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
