import {
  createContext, useCallback, useContext, useEffect, useId, useRef, useState,
  type CSSProperties, type ReactNode,
} from "react";
import { BookMarked, Check, LoaderCircle, RotateCcw, X } from "lucide-react";
import type { WordSaveResult, WordTranslation, WordTranslationResult } from "../shared/types";
import { api, json } from "./api";
import "./word-notebook.css";

type WordSource = { sectionIndex?: number; questionId?: string };
type WordSelection = WordSource & { word: string; context: string; element: HTMLElement };
interface WordPicker {
  enabled: boolean;
  review: boolean;
  selected: HTMLElement | null;
  select: (selection: WordSelection) => void;
}
const WordPickerContext = createContext<WordPicker | null>(null);

/** Keeps word actions in the learning page and uses its authenticated exam transport. */
export function WordNotebook({ resource, review, scopeKey, disabled = false, className, children }: {
  resource: { kind: "attempt" | "placement"; id: string };
  review: boolean;
  scopeKey?: string | number;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [enabled, setEnabled] = useState(false);
  const [selection, setSelection] = useState<WordSelection | null>(null);
  const [translation, setTranslation] = useState<WordTranslation | null>(null);
  const [translating, setTranslating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [notice, setNotice] = useState("");
  const [saveError, setSaveError] = useState("");
  const [translateError, setTranslateError] = useState("");
  const [position, setPosition] = useState<CSSProperties>({});
  const panel = useRef<HTMLDivElement | null>(null);
  const title = useRef<HTMLHeadingElement | null>(null);
  const selectionRef = useRef<WordSelection | null>(null);
  const savedWords = useRef(new Map<string, string>());
  const requests = useRef(new Set<AbortController>());
  const generation = useRef(0);
  const panelId = useId();
  const base = resource.kind === "attempt" ? "attempts" : "placement";
  const path = `/${base}/${encodeURIComponent(resource.id)}/words`;
  const clear = useCallback(() => {
    ++generation.current;
    requests.current.forEach(controller => controller.abort());
    requests.current.clear();
    selectionRef.current = null;
    setSelection(null); setTranslation(null); setTranslateError(""); setSaveError("");
    setTranslating(false); setSaving(false); setNotice("");
  }, []);
  useEffect(() => {
    clear();
    return clear;
  }, [resource.kind, resource.id, scopeKey, review, disabled, clear]);
  useEffect(() => {
    savedWords.current = new Map();
    setEnabled(false);
  }, [resource.kind, resource.id]);
  const close = useCallback((restoreFocus = false) => {
    const previous = selectionRef.current?.element;
    clear();
    if (restoreFocus && previous?.isConnected) previous.focus({ preventScroll: true });
  }, [clear]);
  const select = useCallback((next: WordSelection) => {
    if (!enabled || disabled) return;
    clear();
    selectionRef.current = next;
    const [wordKey, contextKey] = selectionKey(next);
    setSelection(next); setSaved(savedWords.current.get(wordKey) === contextKey);
  }, [enabled, disabled, clear]);
  useEffect(() => {
    if (!selection) return;
    const anchor = selection.element;
    const updatePosition = () => {
      if (!anchor.isConnected || !anchor.getClientRects().length || anchor.closest("details:not([open])")) {
        close(); return;
      }
      const bounds = anchor.getBoundingClientRect();
      const width = Math.min(360, window.innerWidth - 24);
      const height = panel.current?.offsetHeight || 250;
      const below = bounds.bottom + 8;
      setPosition({
        width,
        left: Math.max(12, Math.min(bounds.left, window.innerWidth - width - 12)),
        top: Math.max(12, Math.min(below, window.innerHeight - height - 12)),
      });
    };
    updatePosition();
    title.current?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !panel.current?.contains(target) && !anchor.contains(target)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(true); }
    };
    const observer = new MutationObserver(() => {
      if (!anchor.isConnected || anchor.closest("details:not([open])")) close();
    });
    observer.observe(anchor.closest(".word-notebook") || document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open"] });
    const sizeObserver = new ResizeObserver(updatePosition);
    if (panel.current) sizeObserver.observe(panel.current);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      observer.disconnect();
      sizeObserver.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [selection, close]);
  const translate = useCallback(async () => {
    const current = selectionRef.current;
    if (!current || !review || disabled) return;
    const token = generation.current;
    const controller = new AbortController(); requests.current.add(controller);
    setTranslating(true); setTranslateError("");
    try {
      const result = await api<WordTranslationResult>(`${path}/translate`, {
        method: "POST", body: json(wordBody(current)), signal: controller.signal, timeoutMs: 25_000,
      });
      if (controller.signal.aborted || generation.current !== token) return;
      setTranslation(result.translation);
    } catch (cause) {
      if (!controller.signal.aborted && generation.current === token)
        setTranslateError(cause instanceof Error ? cause.message : "Chưa xem được nghĩa. Hãy thử lại.");
    } finally {
      requests.current.delete(controller);
      if (generation.current === token) setTranslating(false);
    }
  }, [review, disabled, path]);
  useEffect(() => { if (selection && review) void translate(); }, [selection, review, translate]);
  async function save() {
    const current = selectionRef.current;
    if (!current || disabled || saving || saved) return;
    const token = generation.current;
    const controller = new AbortController(); requests.current.add(controller);
    setSaving(true); setSaveError("");
    try {
      const result = await api<WordSaveResult>(path, {
        method: "POST", body: json(wordBody(current)), signal: controller.signal, timeoutMs: 15_000,
      });
      if (controller.signal.aborted || generation.current !== token) return;
      const [wordKey, contextKey] = selectionKey(current);
      savedWords.current.set(wordKey, contextKey);
      setSaved(true);
      setNotice(result.saved.alreadySaved ? "Từ này đã có trong sổ từ của bạn." : "Đã lưu vào sổ từ của bạn.");
      if (review) void translate();
    } catch (cause) {
      if (!controller.signal.aborted && generation.current === token)
        setSaveError(cause instanceof Error ? cause.message : "Chưa lưu được từ. Hãy thử lại.");
    } finally {
      requests.current.delete(controller);
      if (generation.current === token) setSaving(false);
    }
  }
  return <WordPickerContext.Provider value={{ enabled: enabled && !disabled, review, selected: selection?.element || null, select }}>
    <div className={`word-notebook ${className || ""}`}>
      {!!resource.id && <div className="word-picker-toolbar">
        <button type="button" className={`word-picker-toggle ${enabled ? "active" : ""}`} disabled={disabled}
          aria-pressed={enabled} onClick={() => { close(); setEnabled(value => !value); }}>
          <BookMarked size={17} />{review ? "Chọn từ để xem nghĩa" : "Chọn từ để lưu"}
        </button>
        <span>{enabled ? "Chạm vào từ tiếng Anh trong nội dung bài." : "Bật để chọn từ tiếng Anh trong nội dung bài."}
          {!review && " Nghĩa mở sau khi nộp bài."}</span>
      </div>}
      {children}
      {selection && <div ref={panel} id={panelId} className="word-inline-card" role="dialog"
        aria-modal="false" aria-labelledby={`${panelId}-title`} style={position} data-review={review}>
        <div className="word-inline-heading">
          <h3 ref={title} tabIndex={-1} id={`${panelId}-title`} lang="en">{selection.word}</h3>
          <button type="button" className="word-inline-close" aria-label="Đóng thẻ từ" onClick={() => close(true)}><X size={18} /></button>
        </div>
        <p className="word-inline-context" lang="en">{selection.context}</p>
        {review ? <div className="word-inline-translation" aria-live="polite" aria-busy={translating}>
          {translating && <p className="word-inline-status"><LoaderCircle className="word-spinner" size={15} />Đang xem nghĩa trong ngữ cảnh…</p>}
          {translation && <><strong className="word-inline-meaning">{translation.meaning}</strong>
            {translation.partOfSpeech && <small>{translation.partOfSpeech}</small>}
            {translation.definition && <p>{translation.definition}</p>}</>}
          {translateError && <div className="word-inline-error" role="alert"><p>{translateError}</p>
            <button type="button" onClick={() => void translate()}><RotateCcw size={14} />Thử xem nghĩa lại</button></div>}
        </div> : <p className="word-inline-lock">Lưu từ để ôn sau. Nghĩa tiếng Việt xuất hiện khi bạn đã nộp bài.</p>}
        <button type="button" className="word-inline-save" disabled={saving || saved} onClick={() => void save()}>
          {saving ? <LoaderCircle className="word-spinner" size={16} /> : saved ? <Check size={16} /> : <BookMarked size={16} />}
          {saving ? "Đang lưu từ…" : saved ? "Đã có trong sổ từ" : "Lưu vào sổ từ của tôi"}
        </button>
        {notice && <p className="word-inline-status" role="status">{notice}</p>}
        {saveError && <p className="word-inline-error" role="alert">{saveError} Bấm lưu để thử lại.</p>}
      </div>}
    </div>
  </WordPickerContext.Provider>;
}

function wordBody({ word, context, sectionIndex, questionId }: WordSelection) {
  return { word, context, ...(sectionIndex !== undefined ? { sectionIndex } : {}), ...(questionId ? { questionId } : {}) };
}

function selectionKey({ word, context }: WordSelection) {
  const canonical = (value: string) => value.normalize("NFC").replace(/[’‘]/gu, "'").replace(/\s+/gu, " ").trim();
  return [canonical(word).toLowerCase(), canonical(context)] as const;
}

/** Plain visible source text only; never pass hidden transcripts or input values. */
export function WordText({ text, sectionIndex, questionId }: { text?: string } & WordSource) {
  const picker = useContext(WordPickerContext);
  if (!text) return null;
  if (!picker?.enabled) return <>{text}</>;
  const parts = text.split(/(\p{L}+(?:['’\-]\p{L}+)*)/gu);
  let offset = 0;
  return <>{parts.map((part, index) => {
    const start = offset; offset += part.length;
    if (part.length > 80 || !/^[A-Za-z]+(?:['’\-][A-Za-z]+)*$/u.test(part)) return part;
    if (/[\p{L}\p{N}]/u.test(text[start - 1] || "") || /[\p{L}\p{N}]/u.test(text[offset] || "")) return part;
    // Keep context a contiguous sentence copied from the rendered source.
    const before = text.slice(0, start);
    const previousBreak = Math.max(before.lastIndexOf("\n"), before.lastIndexOf(". "), before.lastIndexOf("! "), before.lastIndexOf("? "));
    const after = text.slice(start + part.length);
    const nextBreak = after.search(/[.!?](?:\s|$)|\n/u);
    const contextStart = Math.max(previousBreak < 0 ? 0 : previousBreak + 1, start - 600);
    const contextEnd = Math.min(nextBreak < 0 ? text.length : start + part.length + nextBreak + 1, start + part.length + 600);
    const context = text.slice(contextStart, contextEnd).trim();
    return <span key={index} className="word-pick" role="button" tabIndex={0}
      aria-label={`${picker.review ? "Xem nghĩa từ" : "Lưu từ"} ${part}`} lang="en"
      onClick={event => { event.preventDefault(); event.stopPropagation(); picker.select({ word: part, context, sectionIndex, questionId, element: event.currentTarget }); }}
      onKeyDown={event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault(); event.stopPropagation();
          picker.select({ word: part, context, sectionIndex, questionId, element: event.currentTarget });
        }
      }}>{part}</span>;
  })}</>;
}
