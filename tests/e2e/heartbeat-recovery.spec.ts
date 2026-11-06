import { test, expect, type Page } from "@playwright/test";

type Kind = "session" | "room";
type Transport = "healthy" | "first-hangs" | "offline";
interface Observed {
  calls: number;
  aborted: number;
  violations: { reason: string; path: string }[];
}
declare global {
  interface Window {
    heartbeatFixture: {
      start(kind: Kind, transport: Transport): Promise<void>;
      observed(): Observed;
    };
  }
}

const epoch = Date.parse("2026-11-06T12:00:00.000Z");

async function monitor(page: Page, kind: Kind, transport: Transport) {
  await page.clock.install({ time: new Date(epoch) });
  await page.route("**/heartbeat-fixture", route => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><html><body><h1>Heartbeat transport fixture</h1>
      <script type="module">
        import RefreshRuntime from "/@react-refresh";
        RefreshRuntime.injectIntoGlobalHook(window);
        window.$RefreshReg$ = () => {};
        window.$RefreshSig$ = () => (type) => type;
        window.__vite_plugin_react_preamble_installed__ = true;
        window.integrityModule = await import("/client/ExamIntegrity.tsx");
        document.body.dataset.ready = "true";
      </script></body></html>`,
  }));
  await page.goto("/heartbeat-fixture");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  // The initial Vite transform may take over a second on a cold worker.
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 1000));
  await page.evaluate(() => {
    // Only the transport is mocked. The production monitor, timeout helper,
    // monotonic clock, document listeners and pending-request fences run as-is.
    const integrity = (window as unknown as { integrityModule: typeof import("../../client/ExamIntegrity") }).integrityModule;
    const observed: Observed = { calls: 0, aborted: 0, violations: [] };
    let transport: Transport = "healthy";
    const session = {
      id: "synthetic-heartbeat-session", kind: "attempt" as const,
      resourceId: "synthetic-heartbeat-attempt", status: "active" as const,
      leaseSeconds: 25, phase: "answering" as const,
    };
    const room = {
      id: "synthetic-heartbeat-room", status: "in-progress" as const,
      requiresPresence: true, serverNow: "2026-11-06T12:00:00.000Z",
    };
    const response = (data: unknown) => Promise.resolve(new Response(JSON.stringify(data), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    const violation = (path: string, body: unknown) => {
      const parsed = typeof body === "string" ? JSON.parse(body) : {};
      observed.violations.push({ path, reason: String(parsed.reason) });
    };
    navigator.sendBeacon = (url, data) => {
      void (data as Blob).text().then(body => violation(String(url), body));
      return true;
    };
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), window.location.origin).pathname;
      if (path === "/api/exam-integrity/open") return response({ enabled: true, session });
      if (path.endsWith("/heartbeat")) {
        observed.calls++;
        if (transport === "offline" || (transport === "first-hangs" && observed.calls === 1)) {
          return new Promise<Response>((_resolve, reject) => {
            const abort = () => {
              observed.aborted++;
              reject(new DOMException("Synthetic hung heartbeat aborted", "AbortError"));
            };
            if (init?.signal?.aborted) abort();
            else init?.signal?.addEventListener("abort", abort, { once: true });
          });
        }
        return response(path.includes("/duo/rooms/") ? { room } : { session });
      }
      if (path.endsWith("/leave")) {
        violation(path, init?.body);
        return response({ room: { ...room, status: "invalidated", requiresPresence: false } });
      }
      if (path.endsWith("/violation")) {
        violation(path, init?.body);
        return response({ session: { ...session, status: "invalidated" } });
      }
      throw new Error("Unexpected API call in isolated heartbeat fixture: " + path);
    }) as typeof fetch;
    window.heartbeatFixture = {
      async start(kind, selected) {
        transport = selected;
        integrity.observeExamRoute(kind === "session" ? "/learn/" + session.resourceId : "/duo/rooms/" + room.id);
        integrity.initializeExamIntegrity("synthetic-heartbeat-owner");
        if (kind === "session") await integrity.openExamIntegrity("attempt", session.resourceId);
        else integrity.updateSharedRoom(room as unknown as import("../../shared/duo").DuoRoomView);
      },
      observed: () => structuredClone(observed),
    };
  });
  await page.evaluate(({ kind, transport }) => window.heartbeatFixture.start(kind, transport), { kind, transport });
}

async function advance(page: Page, milliseconds: number) {
  // Allow asynchronous fetch/JSON continuations to settle between interval ticks.
  while (milliseconds > 0) {
    const step = Math.min(1000, milliseconds);
    await page.clock.runFor(step);
    await page.evaluate(async () => { await Promise.resolve(); });
    milliseconds -= step;
  }
}

for (const kind of ["session", "room"] as const) {
  test(`${kind}: a hung heartbeat times out and recovers before the lease expires`, async ({ page }) => {
    await monitor(page, kind, "first-hangs");
    await advance(page, 30_000);
    const observed = await page.evaluate(() => window.heartbeatFixture.observed());
    expect(observed.aborted).toBe(1);
    expect(observed.calls).toBeGreaterThanOrEqual(4);
    expect(observed.violations).toEqual([]);
  });

  test(`${kind}: changing the device wall clock does not expire a healthy lease`, async ({ page }) => {
    await monitor(page, kind, "healthy");
    await page.clock.setSystemTime(new Date(epoch + 60 * 60_000));
    await advance(page, 10_000);
    await page.clock.setSystemTime(new Date(epoch - 60 * 60_000));
    await advance(page, 25_000);
    const observed = await page.evaluate(() => window.heartbeatFixture.observed());
    expect(observed.calls).toBeGreaterThanOrEqual(6);
    expect(observed.violations).toEqual([]);
  });

  test(`${kind}: genuine sustained heartbeat loss still invalidates the exam`, async ({ page }) => {
    await monitor(page, kind, "offline");
    await advance(page, 24_000);
    expect((await page.evaluate(() => window.heartbeatFixture.observed())).violations).toEqual([]);
    await advance(page, 1000);
    await expect.poll(async () => (await page.evaluate(() => window.heartbeatFixture.observed())).violations)
      .toEqual([{ path: kind === "session" ? "/api/exam-integrity/synthetic-heartbeat-session/violation" : "/api/duo/rooms/synthetic-heartbeat-room/leave", reason: "heartbeat-lost" }]);
  });
}

for (const [kind, departure] of [["session", "hidden"], ["room", "pagehide"]] as const) {
  test(`${kind}: real ${departure} events still invalidate immediately`, async ({ page }) => {
    await monitor(page, kind, "healthy");
    await page.evaluate(event => {
      if (event === "hidden") {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
        document.dispatchEvent(new Event("visibilitychange"));
      } else window.dispatchEvent(new Event("pagehide"));
    }, departure);
    await expect.poll(async () => (await page.evaluate(() => window.heartbeatFixture.observed())).violations.map(value => value.reason))
      .toEqual([departure === "hidden" ? "hidden" : "page-exit"]);
  });
}

test("a cancelled beforeunload attempt keeps the visible exam and heartbeat active", async ({ page }) => {
  await monitor(page, "session", "healthy");
  const cancelled = await page.evaluate(() => {
    window.addEventListener("beforeunload", event => {
      event.preventDefault();
      event.returnValue = "";
    }, { once: true });
    const event = new Event("beforeunload", { cancelable: true });
    const result = window.dispatchEvent(event);
    return { cancelled: !result && event.defaultPrevented, visibility: document.visibilityState };
  });
  expect(cancelled).toEqual({ cancelled: true, visibility: "visible" });
  await advance(page, 10_000);
  const observed = await page.evaluate(() => window.heartbeatFixture.observed());
  expect(observed.calls).toBeGreaterThanOrEqual(2);
  expect(observed.violations).toEqual([]);
});

test("beforeunload followed by real pagehide still invalidates the shared exam", async ({ page }) => {
  await monitor(page, "room", "healthy");
  await page.evaluate(() => window.dispatchEvent(new Event("beforeunload", { cancelable: true })));
  await advance(page, 5000);
  expect((await page.evaluate(() => window.heartbeatFixture.observed())).violations).toEqual([]);
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await expect.poll(async () => (await page.evaluate(() => window.heartbeatFixture.observed())).violations)
    .toEqual([{ path: "/api/duo/rooms/synthetic-heartbeat-room/leave", reason: "page-exit" }]);
});
