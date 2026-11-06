/** A deadline belongs to the server. Wall-clock changes on the device must not
 * end a live attempt, and delayed replies must not grant extra time. */
export interface AttemptClock {
  attemptId: string;
  serverMilliseconds: number;
  sampledAt: number;
  authoritative: boolean;
  serverSample: number;
}

export function attemptClockNow(clock: AttemptClock | null, monotonicNow: number, wallNow: number): number {
  return clock ? clock.serverMilliseconds + Math.max(0, monotonicNow - clock.sampledAt) : wallNow;
}

export function sampleAttemptClock(previous: AttemptClock | null, attemptId: string,
  serverNow: string | undefined, monotonicNow: number, wallNow: number,
  deadlinePending = false): AttemptClock {
  const sampled = serverNow ? Date.parse(serverNow) : NaN;
  const authoritative = Number.isFinite(sampled);
  const same = previous?.attemptId === attemptId;
  if (same && !authoritative) return previous;
  if (same && previous.authoritative && authoritative && !deadlinePending && sampled < previous.serverSample)
    return previous;
  const base = authoritative ? sampled : wallNow;
  return {
    attemptId, authoritative, serverSample: base, sampledAt: monotonicNow,
    serverMilliseconds: same && previous.authoritative && authoritative && !deadlinePending
      ? Math.max(base, attemptClockNow(previous, monotonicNow, wallNow)) : base,
  };
}
