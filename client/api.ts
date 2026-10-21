import { examHeaders } from "./examTransport";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

// Application grading failures carry a finite, server-owned code. Gateway
// responses may also be JSON, so an arbitrary error string is not enough to
// treat a 502 response as a safe application message.
const aiFailureCodes = new Set([
  "AI_PROVIDER_AUTH",
  "AI_PROVIDER_QUOTA",
  "AI_PROVIDER_RATE_LIMIT",
  "AI_PROVIDER_UNAVAILABLE",
  "AI_PROVIDER_TIMEOUT",
  "AI_PROVIDER_NETWORK",
  "AI_MODEL_UNAVAILABLE",
  "AI_RESPONSE_INVALID",
  "AI_EVIDENCE_INVALID",
]);
function applicationAiFailure(body: unknown): { code: string; message: string } | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  if (typeof value.code !== "string" || !aiFailureCodes.has(value.code)) return null;
  const message = [value.error, value.message].find(
    candidate => typeof candidate === "string" && candidate.trim().length > 0,
  );
  if (typeof message !== "string" || message.length > 2000) return null;
  return { code: value.code, message };
}

export interface ApiRequestOptions extends RequestInit {
  /** Opt in for short read requests; grading and mutations keep their own limits. */
  timeoutMs?: number;
}

export async function api<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { timeoutMs, ...requestOptions } = options;
  const deadline = timeoutMs && timeoutMs > 0 ? new AbortController() : null;
  let timedOut = false;
  const timer = deadline ? setTimeout(() => {
    timedOut = true;
    deadline.abort();
  }, timeoutMs) : undefined;
  try {
    const response = await fetch(
      path.startsWith("/api/") ? path : `/api${path}`,
      {
        ...requestOptions,
        ...(deadline ? { signal: requestOptions.signal
          ? AbortSignal.any([requestOptions.signal, deadline.signal]) : deadline.signal } : {}),
        credentials: "include",
        headers: {
          ...examHeaders(),
          ...(requestOptions.body && !(requestOptions.body instanceof FormData)
            ? { "Content-Type": "application/json" }
            : {}),
          ...requestOptions.headers,
        },
      },
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        message?: string;
        code?: unknown;
      } | null;
      const applicationFailure = applicationAiFailure(body);
      throw new ApiError(
        response.status,
        response.status === 502
          ? applicationFailure?.message || "Máy chủ tạm thời gián đoạn. Vui lòng thử lại."
          : body?.error || body?.message ||
            (response.status >= 500
              ? "Máy chủ tạm thời chưa sẵn sàng. Vui lòng thử lại."
              : `Không thể tải dữ liệu (${response.status}).`),
        applicationFailure?.code,
      );
    }
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  } catch (cause) {
    if (timedOut && !requestOptions.signal?.aborted)
      throw new ApiError(504, "Máy chủ phản hồi quá lâu. Vui lòng thử lại.");
    throw cause;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export const json = (value: unknown) => JSON.stringify(value);
