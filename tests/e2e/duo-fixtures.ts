import { test as base, expect, type Page } from "@playwright/test";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { createApp } from "../../server/app";
import { hashPassword } from "../../server/auth";
import {
  parseDuoCredentials,
  provisionDuoAccounts,
} from "../../server/duo-auth";
import {
  connectDatabase,
  seedDatabase,
  type Database,
} from "../../server/storage";
import type {
  Attempt,
  PlacementState,
  StoredContent,
} from "../../shared/types";
import type { DuoSnapshot } from "../../shared/duo";

export interface DuoBrowserServer {
  url: string;
  database: Database;
  advance: (milliseconds: number) => void;
}
interface DuoBrowserOptions {
  integrityEnabled?: boolean;
}
// Synthetic credentials only. This test never loads the deployment credentials.
export const duoAccounts = [
  {
    role: "husband",
    name: "Người học Một",
    phone: "0390000001",
    password: "synthetic-first-password",
  },
  {
    role: "wife",
    name: "Người học Hai",
    phone: "0390000002",
    password: "synthetic-second-password",
  },
] as const;
export const test = base.extend<DuoBrowserOptions & { duoServer: DuoBrowserServer }>({
  // Historical resume fixtures omit monitoring; dedicated native/browser integrity suites enable strict policy.
  integrityEnabled: [false, { option: true }],
  page: async ({ browser, duoServer, viewport, isMobile, hasTouch }, use) => {
    const context = await browser.newContext({
      baseURL: duoServer.url,
      viewport,
      isMobile,
      hasTouch,
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await use(page);
      expect(errors, "Unexpected Duo browser exceptions").toEqual([]);
    } finally {
      await context.close();
    }
  },
  duoServer: async ({ integrityEnabled }, use) => {
    const name = `ielts_duo_e2e_${Date.now()}_${randomUUID().replaceAll("-", "")}`;
    if (!/^ielts_duo_e2e_\d+_[a-f0-9]{32}$/.test(name))
      throw new Error("Unsafe Duo E2E database name");
    const database = await connectDatabase(
      process.env.E2E_MONGODB_BASE_URI || "mongodb://127.0.0.1:27017",
      name,
    );
    let server: Server | undefined;
    try {
      await seedDatabase(database);
      const settings = parseDuoCredentials({
        duoId: "synthetic-browser-duo",
        accounts: await Promise.all(
          duoAccounts.map(async ({ password, ...account }) => ({
            ...account,
            passwordHash: await hashPassword(password),
          })),
        ),
      });
      await provisionDuoAccounts(database, settings);
      let offset = 0;
      const app = createApp(database, {
        duoEnabled: true,
        duoCredentials: settings,
        production: false,
        examIntegrityEnabled: integrityEnabled ?? false,
        demoEnabled: false,
        serveClient: true,
        duo: {
          sessionsPerBand: 10,
          gateInterval: 5,
          lessonKinds: ["grammar"],
          countdownSeconds: 2,
          now: () => Date.now() + offset,
        },
      });
      server = app.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Missing Duo test server address");
      await use({
        url: `http://127.0.0.1:${address.port}`,
        database,
        advance: (milliseconds) => {
          offset += milliseconds;
        },
      });
    } finally {
      if (server) {
        // Finish page-exit beacons before closing their isolated database client.
        await new Promise<void>((resolve) => server!.close(() => resolve()));
      }
      if (!/^ielts_duo_e2e_\d+_[a-f0-9]{32}$/.test(database.db.databaseName))
        throw new Error("Refusing Duo E2E cleanup outside isolated database");
      await database.db.dropDatabase();
      await database.client.close();
    }
  },
});
export { expect };
export async function duoLogin(
  page: Page,
  server: DuoBrowserServer,
  index: 0 | 1,
) {
  await page.goto(`${server.url}/dashboard`);
  await page
    .getByLabel("Số điện thoại", { exact: true })
    .fill(duoAccounts[index].phone);
  await page
    .getByLabel("Mật khẩu", { exact: true })
    .fill(duoAccounts[index].password);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page.locator(".main-content")).toBeVisible();
}
export async function duoSnapshot(page: Page): Promise<DuoSnapshot> {
  const response = await page.request.get("/api/duo");
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()).duo;
}
export async function finishPlacement(
  page: Page,
  server: DuoBrowserServer,
  correct = true,
): Promise<PlacementState> {
  let response = await page.request.post("/api/placement/start", {
    data: { mode: "quick" },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  let state: PlacementState = (await response.json()).placement;
  while (state.question) {
    const source = await server.database.placementItems.findOne({
      _id: state.question.id,
    });
    if (!source) throw new Error("Missing placement seed");
    const answer = correct
      ? source.answer
      : source.options.find((option) => option !== source.answer)!;
    response = await page.request.post(`/api/placement/${state.id}/answer`, {
      data: { questionId: state.question.id, answer },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    state = (await response.json()).placement;
  }
  return state;
}
export async function objectiveAttempt(
  page: Page,
  server: DuoBrowserServer,
  contentId: string,
  correct = true,
  assessmentId?: string,
): Promise<Attempt> {
  const content = await server.database.content.findOne({ _id: contentId });
  if (!content) throw new Error("Missing lesson seed");
  let response = await page.request.post("/api/attempts", {
    data: {
      contentId,
      mode: assessmentId ? "exam" : "practice",
      ...(assessmentId ? { duoAssessmentId: assessmentId } : {}),
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const attempt: Attempt = (await response.json()).attempt;
  const responses = Object.fromEntries(
    content.questions.map((question) => [
      question.id,
      correct
        ? question.answer
        : question.options?.find((option) => option !== question.answer) ||
          "incorrect",
    ]),
  );
  response = await page.request.patch(`/api/attempts/${attempt.id}`, {
    data: { responses },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  response = await page.request.post(`/api/attempts/${attempt.id}/submit`);
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()).attempt;
}
export async function fillSimpleObjective(page: Page, content: StoredContent) {
  for (const question of content.questions) {
    const section = page.getByRole("group", {
      name: "Phần của bài tập",
      exact: true,
    });
    await section.getByRole("button").nth(question.sectionIndex).click();
    const field = page
      .locator("fieldset.practice-question")
      .filter({
        has: page.locator("legend").filter({ hasText: question.prompt }),
      });
    if (
      question.options?.length ||
      ["true-false", "yes-no"].includes(question.type)
    ) {
      const escaped = question.answer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      await field
        .getByRole("radio", { name: new RegExp(`^(?:[A-Z]\\s+)?${escaped}$`) })
        .check();
    } else
      await field
        .getByRole("textbox", { name: `Câu ${question.number}`, exact: true })
        .fill(question.answer);
  }
}
export async function submitUi(page: Page) {
  await page
    .getByRole("button", { name: "Nộp bài & xem phản hồi", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Nộp bài luyện của bạn?", exact: true })
    .getByRole("button", { name: "Nộp bài", exact: true })
    .click();
  await expect(page.locator(".attempt-status")).toContainText("Đã nộp");
}
export async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    ),
  ).toBeLessThanOrEqual(1);
}
