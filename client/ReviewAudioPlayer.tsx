import { useEffect, useRef, useState } from "react";
import { RotateCcw, Volume2 } from "lucide-react";
import { Button } from "./components";
import { examHeaders } from "./examTransport";

function audioTime(value: number): string {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Review playback is separate from the server-consumed, one-play exam audio. */
export function ReviewAudioPlayer({
  src,
  title,
  description,
  examScoped = false,
}: {
  src: string;
  title: string;
  description?: string;
  examScoped?: boolean;
}) {
  const player = useRef<HTMLAudioElement | null>(null);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [rate, setRate] = useState("1");
  const [failed, setFailed] = useState(false);
  const [scopedUrl, setScopedUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    setDuration(0); setPosition(0); setRate("1"); setFailed(false);
    const audio = player.current;
    if (audio) audio.playbackRate = 1;
    return () => { audio?.pause(); };
  }, [src]);

  useEffect(() => {
    setScopedUrl("");
    if (!examScoped) { setLoading(false); return; }
    const controller = new AbortController();
    let url = "", disposed = false;
    const timer = window.setTimeout(() => controller.abort(), 25_000);
    setLoading(true); setFailed(false);
    void (async () => {
      try {
        // Intermediate Duo review still belongs to its monitored document.
        // Fetch carries its tab header; the resulting local blob remains seekable.
        const response = await fetch(src, { credentials: "include", headers: examHeaders(), signal: controller.signal });
        if (!response.ok) throw new Error("Review audio unavailable");
        const blob = await response.blob();
        if (!blob.size || blob.size > 64 * 1024 * 1024) throw new Error("Review audio size invalid");
        if (disposed || controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setScopedUrl(url);
      } catch {
        if (!disposed) setFailed(true);
      } finally {
        window.clearTimeout(timer);
        if (!disposed) setLoading(false);
      }
    })();
    return () => {
      disposed = true; controller.abort(); window.clearTimeout(timer);
      if (url) URL.revokeObjectURL(url);
    };
  }, [src, examScoped, retry]);

  function seek(value: number) {
    if (!player.current || !duration) return;
    const next = Math.max(0, Math.min(duration, value));
    player.current.currentTime = next;
    setPosition(next);
  }

  return (
    <section className="review-audio-player" aria-label={title}>
      <div className="review-audio-heading">
        <Volume2 size={19} aria-hidden="true" />
        <strong>{title}</strong>
      </div>
      {description && <p className="muted tiny">{description}</p>}
      <audio
        ref={player}
        controls
        preload="metadata"
        src={examScoped ? scopedUrl || undefined : src}
        aria-label={title}
        onLoadedMetadata={(event) => {
          const value = event.currentTarget.duration;
          setDuration(Number.isFinite(value) && value > 0 ? value : 0);
          setFailed(false);
        }}
        onDurationChange={(event) => {
          const value = event.currentTarget.duration;
          if (Number.isFinite(value) && value > 0) setDuration(value);
        }}
        onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
        onSeeked={(event) => setPosition(event.currentTarget.currentTime)}
        onError={() => setFailed(true)}
      />
      {loading && <p className="muted tiny" role="status">Đang tải âm thanh đã lưu…</p>}
      <div className="review-audio-seek">
        <label>
          <span>Tua âm thanh</span>
          <input
            type="range"
            min="0"
            max={duration || 1}
            step="0.1"
            value={Math.min(position, duration || 1)}
            disabled={!duration || failed}
            aria-label={`Tua: ${title}`}
            aria-valuetext={`${audioTime(position)} / ${audioTime(duration)}`}
            onChange={(event) => seek(Number(event.target.value))}
          />
        </label>
        <output aria-live="off">{audioTime(position)} / {audioTime(duration)}</output>
      </div>
      <div className="review-audio-actions row wrap">
        <Button className="secondary small" disabled={!duration || failed} onClick={() => seek(position - 10)}>
          Lùi 10 giây
        </Button>
        <Button className="secondary small" disabled={!duration || failed} onClick={() => seek(position + 10)}>
          Tiến 10 giây
        </Button>
        <label>
          Tốc độ
          <select aria-label={`Tốc độ: ${title}`} value={rate} onChange={(event) => {
            setRate(event.target.value);
            if (player.current) player.current.playbackRate = Number(event.target.value);
          }}>
            <option value="0.75">0.75×</option>
            <option value="1">1×</option>
            <option value="1.25">1.25×</option>
            <option value="1.5">1.5×</option>
          </select>
        </label>
      </div>
      {failed && <div className="notice warning" role="status">
        <span>Chưa tải được âm thanh đã lưu. Bạn vẫn có thể xem transcript; hãy thử tải lại âm thanh.</span>
        <Button className="secondary small" onClick={() => {
          setFailed(false); setDuration(0); setPosition(0);
          if (examScoped) setRetry(value => value + 1);
          else player.current?.load();
        }}><RotateCcw size={14} /> Thử lại âm thanh</Button>
      </div>}
    </section>
  );
}
