import type { Page, Route } from "@playwright/test";
import { test, expect, duoLogin, noOverflow } from "./duo-fixtures";

const readinessPath = /\/api\/content\/[^/]+\/listening-audio\/readiness(?:\?.*)?$/u;
const temporaryError = "Máy chủ tạm thời gián đoạn. Vui lòng thử lại.";

function gate() {
  let release!: () => void;
  return { pending: new Promise<void>(resolve => { release = resolve; }), release: () => release() };
}

async function speechHealth(page: Page) {
  await page.route("**/api/health", async route => {
    const response = await route.fetch();
    const health = await response.json();
    await route.fulfill({ response, json: {
      ...health, examIntegrityEnabled: true,
      services: { ...health.services, speech: { configured: true, provider: "openai", voiceCount: 11 } },
    } });
  });
}

async function ready(route: Route) {
  await route.fulfill({ json: { audio: {
    configured: true, ready: true, state: "ready", notice: "Bản nghe đã sẵn sàng.", readyCount: 4, totalCount: 4,
  } } });
}

function attemptedWrites(page: Page) {
  const writes: string[] = [];
  page.on("request", request => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/attempts") writes.push(request.url());
  });
  return writes;
}

test.describe("Listening start request failures", () => {
  test.use({ integrityEnabled: true });

  test("a delayed check stays visible, then an HTML 502 can be retried without starting a sitting", async ({ page, duoServer }) => {
    await speechHealth(page);
    const delivery = gate();
    let checks = 0;
    await page.route(readinessPath, async route => {
      if (++checks === 1) {
        await delivery.pending;
        await route.fulfill({ status: 502, contentType: "text/html", body: "<h1>502 Bad Gateway</h1>" });
      } else await ready(route);
    });
    const writes = attemptedWrites(page);
    await duoLogin(page, duoServer, 0);
    const before = await duoServer.database.attempts.countDocuments();
    await page.goto("/library?skill=listening");
    const card = page.locator(".content-card.listening").first();
    await card.getByRole("button", { name: "Bắt đầu luyện", exact: true }).click();
    await expect(card.getByRole("status")).toHaveText("Đang kiểm tra bản nghe…");
    await expect(card.getByRole("button", { name: "Đang kiểm tra âm thanh…", exact: true })).toBeDisabled();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(writes).toEqual([]);
    expect(await duoServer.database.attempts.countDocuments()).toBe(before);
    delivery.release();
    await expect(card.getByRole("alert")).toContainText(temporaryError);
    await expect(card.getByRole("alert")).toBeInViewport();
    await expect(card.getByRole("button", { name: "Bắt đầu luyện", exact: true })).toBeEnabled();
    await card.getByRole("button", { name: "Thử lại", exact: true }).click();
    await expect(card.getByRole("alert")).toHaveCount(0);
    await expect(card.getByRole("status")).toHaveText("Bản nghe đã sẵn sàng.");
    expect(writes).toEqual([]);
    expect(await duoServer.database.attempts.countDocuments()).toBe(before);
    const created = page.waitForResponse(response => new URL(response.url()).pathname === "/api/attempts" && response.request().method() === "POST");
    await card.getByRole("button", { name: "Bắt đầu luyện", exact: true }).click();
    expect((await created).status()).toBe(201);
    await expect(page.locator(".learning-page")).toBeVisible();
    expect(writes).toHaveLength(1);
    await noOverflow(page);
  });

  test("a stalled check times out and restores a visible retry without creating an attempt", async ({ page, duoServer }) => {
    await speechHealth(page);
    const delivery = gate();
    await page.route(readinessPath, async route => {
      await delivery.pending;
      await ready(route).catch(() => undefined);
    });
    const writes = attemptedWrites(page);
    await duoLogin(page, duoServer, 0);
    const before = await duoServer.database.attempts.countDocuments();
    try {
      await page.goto("/library?skill=listening");
      const card = page.locator(".content-card.listening").first();
      await card.getByRole("button", { name: "Bắt đầu luyện", exact: true }).click();
      await expect(card.getByRole("status")).toHaveText("Đang kiểm tra bản nghe…");
      await expect(card.getByRole("alert")).toContainText("Máy chủ phản hồi quá lâu. Vui lòng thử lại.", { timeout: 15_000 });
      await expect(card.getByRole("button", { name: "Bắt đầu luyện", exact: true })).toBeEnabled();
      await expect(card.getByRole("button", { name: "Thử lại", exact: true })).toBeEnabled();
      expect(writes).toEqual([]);
      expect(await duoServer.database.attempts.countDocuments()).toBe(before);
      await noOverflow(page);
    } finally { delivery.release(); }
  });

  for (const action of ["filter", "leave"] as const) {
    test(`changing ${action === "filter" ? "filters" : "pages"} cancels the check and ignores a late ready response`, async ({ page, duoServer }) => {
      await speechHealth(page);
      const delivery = gate();
      await page.route(readinessPath, async route => {
        await delivery.pending;
        await ready(route).catch(() => undefined);
      });
      const writes = attemptedWrites(page);
      await duoLogin(page, duoServer, 0);
      const before = await duoServer.database.attempts.countDocuments();
      try {
        await page.goto("/exams?skill=listening");
        const card = page.locator(".content-card.listening").first();
        await card.getByRole("button", { name: "Bắt đầu thi thử", exact: true }).click();
        await expect(card.getByRole("status")).toHaveText("Đang kiểm tra bản nghe…");
        const cancelled = page.waitForEvent("requestfailed", request => readinessPath.test(request.url()));
        if (action === "filter") await page.getByRole("button", { name: "Reading", exact: true }).click();
        else {
          const menu = page.getByRole("button", { name: "Mở menu", exact: true });
          if (await menu.isVisible()) await menu.click();
          await page.getByRole("navigation", { name: "Điều hướng chính", exact: true })
            .getByRole("link", { name: "Kho bài tập", exact: true }).click();
        }
        await cancelled;
        delivery.release();
        await expect(page.locator(".content-card").first()).toBeVisible();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(page.getByRole("alert")).toHaveCount(0);
        expect(writes).toEqual([]);
        expect(await duoServer.database.attempts.countDocuments()).toBe(before);
        await noOverflow(page);
      } finally { delivery.release(); }
    });
  }

  test("a transient failure after exam consent stays in the dialog and retries exactly once", async ({ page, duoServer }) => {
    await speechHealth(page);
    let checks = 0;
    await page.route(readinessPath, async route => {
      if (++checks === 2) await route.fulfill({ status: 502, json: { error: "upstream connection reset" } });
      else await ready(route);
    });
    const writes = attemptedWrites(page);
    await duoLogin(page, duoServer, 0);
    const before = await duoServer.database.attempts.countDocuments();
    await page.goto("/exams?skill=listening");
    await page.locator(".content-card.listening").first().getByRole("button", { name: "Bắt đầu thi thử", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Quy định phòng thi", exact: true });
    await expect(dialog).toBeVisible();
    const consent = dialog.getByRole("button", { name: "Tôi hiểu, bắt đầu bài thi", exact: true });
    await consent.click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("alert")).toContainText(temporaryError);
    await expect(consent).toBeEnabled();
    expect(writes).toEqual([]);
    expect(await duoServer.database.attempts.countDocuments()).toBe(before);
    await noOverflow(page);
    const created = page.waitForResponse(response => new URL(response.url()).pathname === "/api/attempts" && response.request().method() === "POST");
    await consent.click();
    expect((await created).status()).toBe(201);
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".learning-page")).toBeVisible();
    expect(writes).toHaveLength(1);
    expect(checks).toBe(3);
  });

  test("a stalled library list stops loading and can be retried without creating a sitting", async ({ page, duoServer }) => {
    const delivery = gate();
    let lists = 0;
    await page.route(/\/api\/content\?.*$/u, async route => {
      if (++lists === 1) {
        await delivery.pending;
        await route.fulfill({ status: 502, contentType: "text/html", body: "<h1>Late gateway error</h1>" }).catch(() => undefined);
      } else await route.continue();
    });
    const writes = attemptedWrites(page);
    await duoLogin(page, duoServer, 0);
    const before = await duoServer.database.attempts.countDocuments();
    try {
      await page.goto("/library?skill=listening");
      await expect(page.locator(".learning-library").getByRole("status")).toHaveText("Đang tải dữ liệu…");
      await expect(page.locator(".learning-library").getByRole("alert"))
        .toContainText("Máy chủ phản hồi quá lâu. Vui lòng thử lại.", { timeout: 15_000 });
      delivery.release();
      await page.locator(".learning-library").getByRole("button", { name: "Thử lại", exact: true }).click();
      await expect(page.locator(".content-card.listening").first()).toBeVisible();
      await expect(page.locator(".learning-library").getByRole("alert")).toHaveCount(0);
      expect(lists).toBe(2);
      expect(writes).toEqual([]);
      expect(await duoServer.database.attempts.countDocuments()).toBe(before);
      await noOverflow(page);
    } finally { delivery.release(); }
  });

  test("a committed start blocks filter changes and opens its attempt when the POST response arrives", async ({ page, duoServer }) => {
    await speechHealth(page);
    await page.route(readinessPath, ready);
    const delivery = gate();
    const committed = gate();
    let attemptId = "";
    await page.route("**/api/attempts", async route => {
      if (route.request().method() !== "POST") { await route.continue(); return; }
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      const result = await response.json();
      attemptId = result.attempt.id;
      committed.release();
      await delivery.pending;
      await route.fulfill({ response, json: result });
    });
    const writes = attemptedWrites(page);
    await duoLogin(page, duoServer, 0);
    const before = await duoServer.database.attempts.countDocuments();
    try {
      await page.goto("/library?skill=listening");
      const card = page.locator(".content-card.listening").first();
      await card.getByRole("button", { name: "Bắt đầu luyện", exact: true }).click();
      await committed.pending;
      expect((await duoServer.database.attempts.findOne({ _id: attemptId }))?.status).toBe("in-progress");
      const reading = page.getByRole("button", { name: "Reading", exact: true });
      await expect(reading).toBeDisabled();
      await reading.evaluate(button => (button as HTMLButtonElement).click());
      await expect(page.getByRole("button", { name: "Listening", exact: true })).toHaveClass("active");
      await expect(page.getByRole("button", { name: "Tạo bài bằng AI", exact: true })).toBeDisabled();
      await expect(page.getByRole("textbox", { name: "Tìm bài tập", exact: true })).toBeDisabled();
      await expect(page.getByRole("combobox", { name: "Chủ đề", exact: true })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Trang sau", exact: true })).toBeDisabled();
      await expect(card.getByRole("button", { name: "Đang mở…", exact: true })).toBeDisabled();
      expect(writes).toHaveLength(1);
      delivery.release();
      await expect(page).toHaveURL(new RegExp(`/learn/${attemptId}$`, "u"));
      await expect(page.locator(".learning-page")).toBeVisible();
      expect(writes).toHaveLength(1);
      expect(await duoServer.database.attempts.countDocuments()).toBe(before + 1);
      await noOverflow(page);
    } finally { delivery.release(); }
  });

  test("Escape during the consent check keeps the dialog open through a 502 and retry", async ({ page, duoServer }) => {
    await speechHealth(page);
    const delivery = gate();
    let checks = 0;
    await page.route(readinessPath, async route => {
      if (++checks === 2) {
        await delivery.pending;
        await route.fulfill({ status: 502, contentType: "text/html", body: "<h1>502 Bad Gateway</h1>" });
      } else await ready(route);
    });
    const writes = attemptedWrites(page);
    await duoLogin(page, duoServer, 0);
    const before = await duoServer.database.attempts.countDocuments();
    try {
      await page.goto("/exams?skill=listening");
      await page.locator(".content-card.listening").first().getByRole("button", { name: "Bắt đầu thi thử", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Quy định phòng thi", exact: true });
      const consent = dialog.getByRole("button", { name: "Tôi hiểu, bắt đầu bài thi", exact: true });
      await consent.click();
      await expect(dialog.getByRole("status")).toHaveText("Đang kiểm tra bản nghe…");
      await page.keyboard.press("Escape");
      await expect(dialog).toBeVisible();
      await expect(consent).toBeDisabled();
      delivery.release();
      await expect(dialog.getByRole("alert")).toContainText(temporaryError);
      await expect(dialog).toBeVisible();
      await expect(consent).toBeEnabled();
      expect(writes).toEqual([]);
      expect(await duoServer.database.attempts.countDocuments()).toBe(before);
      const created = page.waitForResponse(response => new URL(response.url()).pathname === "/api/attempts" && response.request().method() === "POST");
      await consent.click();
      expect((await created).status()).toBe(201);
      await expect(dialog).toHaveCount(0);
      await expect(page.locator(".learning-page")).toBeVisible();
      expect(writes).toHaveLength(1);
      expect(checks).toBe(3);
      await noOverflow(page);
    } finally { delivery.release(); }
  });
});
