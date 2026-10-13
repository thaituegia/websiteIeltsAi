import { examHeaders } from "./examTransport";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
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
      } | null;
      throw new ApiError(
        response.status,
        response.status === 502
          ? "Máy chủ tạm thời gián đoạn. Vui lòng thử lại."
          : body?.error || body?.message ||
            (response.status >= 500
              ? "Máy chủ tạm thời chưa sẵn sàng. Vui lòng thử lại."
              : `Không thể tải dữ liệu (${response.status}).`),
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
