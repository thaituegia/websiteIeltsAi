import { useEffect, useRef, useState } from "react";
import { LoaderCircle, RotateCcw, Square, Volume2 } from "lucide-react";
import { api, json } from "./api";
import { pronounceWord, wordSpeechAvailable, type WordAccent } from "./word-pronunciation";
import "./word-pronunciation.css";

export interface WordPronunciationProps {
  word: string;
  ipa?: string;
  lookup?: { path: string; body?: unknown };
  compact?: boolean;
  disabled?: boolean;
}
const sameWord = (value: string) => value.normalize("NFC").replace(/[’‘]/gu, "'")
  .replace(/\s+/gu, " ").trim().toLowerCase();

/** IPA is data; device speech reads the original word, never the IPA symbols. */
export function WordPronunciation({ word, ipa, lookup, compact = false, disabled = false }: WordPronunciationProps) {
  const [resolvedIpa, setResolvedIpa] = useState(ipa?.trim() || "");
  const [loading, setLoading] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [speechError, setSpeechError] = useState("");
  const [speechNotice, setSpeechNotice] = useState("");
  const [speechState, setSpeechState] = useState<"idle" | "loading" | "speaking">("idle");
  const [accent, setAccent] = useState<WordAccent>("en-GB");
  const [supported, setSupported] = useState(true);
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const playback = useRef<(() => void) | null>(null);
  const lookupKey = lookup ? `${lookup.path}\u0000${JSON.stringify(lookup.body ?? null)}` : "";
  useEffect(() => {
    ++generation.current;
    request.current?.abort();
    playback.current?.(); playback.current = null;
    setResolvedIpa(ipa?.trim() || ""); setLoading(false); setLookupError("");
    setSpeechError(""); setSpeechNotice(""); setSpeechState("idle");
    setSupported(wordSpeechAvailable());
    return () => {
      ++generation.current;
      request.current?.abort();
      playback.current?.(); playback.current = null;
    };
  }, [word, ipa, lookupKey, disabled]);

  async function lookupIpa() {
    if (!lookup || loading || disabled) return;
    const token = generation.current;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setLookupError("");
    try {
      const result = await api<{ pronunciation: { word: string; ipa: string; source: string } }>(lookup.path, {
        method: "POST", ...(lookup.body === undefined ? {} : { body: json(lookup.body) }),
        signal: controller.signal, timeoutMs: 15_000,
      });
      if (controller.signal.aborted || token !== generation.current) return;
      if (!result.pronunciation || typeof result.pronunciation.word !== "string"
          || typeof result.pronunciation.ipa !== "string" || result.pronunciation.ipa.length > 500
          || sameWord(result.pronunciation.word) !== sameWord(word) || !result.pronunciation.ipa.trim())
        throw new Error("Chưa có phiên âm cho từ này.");
      setResolvedIpa(result.pronunciation.ipa);
    } catch (cause) {
      if (!controller.signal.aborted && token === generation.current)
        setLookupError(cause instanceof Error ? cause.message : "Chưa có phiên âm cho từ này.");
    } finally {
      if (request.current === controller) request.current = null;
      if (token === generation.current) setLoading(false);
    }
  }
  function play(slow = false) {
    if (disabled) return;
    const token = generation.current;
    setSpeechError(""); setSpeechNotice("");
    try {
      playback.current = pronounceWord(word, {
        accent, slow,
        onState: state => { if (token === generation.current) setSpeechState(state); },
        onError: message => { if (token === generation.current) setSpeechError(message); },
        onNotice: message => { if (token === generation.current) setSpeechNotice(message); },
      });
    } catch (cause) { setSpeechState("idle"); setSpeechError(cause instanceof Error ? cause.message : "Chưa phát được âm thanh."); }
  }
  return <div className={`word-pronunciation${compact ? " compact" : ""}`} aria-label={`Phiên âm và phát âm ${word}`}>
    <div className="word-pronunciation-ipa-line">
      <span className="word-pronunciation-ipa-label">IPA</span>
      {resolvedIpa ? <span className="word-pronunciation-ipa" lang="en-fonipa">{resolvedIpa}</span>
        : lookup ? <button type="button" className="word-pronunciation-lookup" disabled={disabled || loading}
          onClick={() => void lookupIpa()} aria-label={`Xem phiên âm ${word}`}>
          {loading ? <LoaderCircle size={13} className="spin" /> : lookupError ? <RotateCcw size={13} /> : null}
          {loading ? "Đang tra phiên âm…" : lookupError ? "Thử tra phiên âm lại" : "Xem phiên âm"}
        </button> : <span className="word-pronunciation-empty">Chưa có phiên âm</span>}
    </div>
    <div className="word-pronunciation-controls">
      {!compact && <select value={accent} aria-label={`Giọng đọc từ ${word}`} disabled={disabled}
        onChange={event => { playback.current?.(); setAccent(event.target.value as WordAccent); }}>
        <option value="en-GB">Ưu tiên Anh–Anh</option><option value="en-US">Ưu tiên Anh–Mỹ</option>
      </select>}
      <button type="button" disabled={disabled || !supported} onClick={() => play()}
        aria-label={`Phát âm ${word}`}><Volume2 size={14} />Nghe</button>
      <button type="button" disabled={disabled || !supported} onClick={() => play(true)}
        aria-label={`Phát âm chậm ${word}`}><Volume2 size={14} />Nghe chậm</button>
      {speechState !== "idle" && <button type="button" className="word-pronunciation-stop"
        aria-label={`Dừng phát âm ${word}`} onClick={() => playback.current?.()}><Square size={12} />Dừng</button>}
    </div>
    {!supported && <small className="word-pronunciation-status">Trình duyệt chưa hỗ trợ phát âm; phiên âm IPA vẫn hiển thị.</small>}
    {lookupError && <small className="word-pronunciation-error" role="status">{lookupError}</small>}
    {speechError && <small className="word-pronunciation-error" role="status">{speechError}</small>}
    {speechNotice && !speechError && <small className="word-pronunciation-status" role="status">{speechNotice}</small>}
    {speechState === "loading" && <small className="word-pronunciation-status" role="status">Đang tải giọng tiếng Anh…</small>}
  </div>;
}
