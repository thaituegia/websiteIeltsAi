import assert from "node:assert/strict";
import test from "node:test";
import { api, ApiError } from "../client/api";

test("gateway errors retain their status and provide a useful message for JSON and HTML", async t => {
  for (const body of ["<html><h1>502 Bad Gateway</h1></html>", JSON.stringify({ error: "upstream connection reset" })]) {
    const mocked = t.mock.method(globalThis, "fetch", async () => new Response(body, { status: 502 }));
    await assert.rejects(api("/content/example/listening-audio/readiness"), cause => {
      assert.ok(cause instanceof ApiError);
      assert.equal(cause.status, 502);
      assert.equal(cause.message, "Máy chủ tạm thời gián đoạn. Vui lòng thử lại.");
      return true;
    });
    mocked.mock.restore();
  }
});

test("an opted-in deadline cancels a stalled read and gives a retryable error", async t => {
  let requestSignal: AbortSignal | null | undefined;
  t.mock.method(globalThis, "fetch", async (_path: RequestInfo | URL, options?: RequestInit) => {
    requestSignal = options?.signal;
    return new Promise<Response>((_resolve, reject) => {
      requestSignal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
  });
  await assert.rejects(api("/content/example/listening-audio/readiness", { timeoutMs: 20 }), cause => {
    assert.ok(cause instanceof ApiError);
    assert.equal(cause.status, 504);
    assert.equal(cause.message, "Máy chủ phản hồi quá lâu. Vui lòng thử lại.");
    return true;
  });
  assert.equal(requestSignal?.aborted, true);
});

test("the read deadline also covers a stalled response body", async t => {
  t.mock.method(globalThis, "fetch", async (_path: RequestInfo | URL, options?: RequestInit) => ({
    ok: true, status: 200,
    json: () => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }),
  } as Response));
  await assert.rejects(api("/content/example/listening-audio/readiness", { timeoutMs: 20 }),
    cause => cause instanceof ApiError && cause.status === 504);
});

test("caller cancellation stays cancellation instead of becoming a server failure", async t => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async (_path: RequestInfo | URL, options?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      options!.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
  });
  const pending = api("/content/example/listening-audio/readiness", { signal: controller.signal, timeoutMs: 100 });
  controller.abort();
  await assert.rejects(pending, cause => cause instanceof DOMException && cause.name === "AbortError");
});

test("mutations and grading have no implicit short deadline", async t => {
  const received: RequestInit[] = [];
  t.mock.method(globalThis, "fetch", async (_path: RequestInfo | URL, options?: RequestInit) => {
    received.push(options!);
    return new Response(JSON.stringify({ saved: true }), { headers: { "Content-Type": "application/json" } });
  });
  assert.deepEqual(await api("/attempts", { method: "POST", body: "{}" }), { saved: true });
  assert.deepEqual(await api("/attempts/example/submit", { method: "POST" }), { saved: true });
  assert.ok(received.every(options => options.signal === undefined && !("timeoutMs" in options)));
});
