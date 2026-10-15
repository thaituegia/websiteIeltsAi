import type { Response } from "express";

/** A single RFC 9110 byte range; rejecting multi-ranges avoids multipart buffers. */
export function audioRange(header: string | undefined, length: number): { start: number; end: number } | null | "invalid" {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(length) || length < 1) return "invalid";
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return "invalid";
    return { start: Math.max(0, length - suffix), end: length - 1 };
  }
  const start = Number(match[1]), requestedEnd = match[2] ? Number(match[2]) : length - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || start >= length || requestedEnd < start) return "invalid";
  return { start, end: Math.min(requestedEnd, length - 1) };
}

/** Return false after responding to an unsatisfiable range. */
export function setAudioRange(response: Response, header: string | undefined, length: number): { start: number; end: number } | false {
  response.set({ "Accept-Ranges": "bytes", "Cache-Control": "private, no-store" });
  const range = audioRange(header, length);
  if (range === "invalid") {
    response.status(416).set("Content-Range", `bytes */${length}`).end();
    return false;
  }
  if (range) {
    response.status(206).set({ "Content-Range": `bytes ${range.start}-${range.end}/${length}`, "Content-Length": String(range.end - range.start + 1) });
    return range;
  }
  response.set("Content-Length", String(length));
  return { start: 0, end: length - 1 };
}
