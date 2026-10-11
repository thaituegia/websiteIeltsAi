import type { ContentSection, StoredContent, StoredQuestion, ChartVisual, SpatialVisual } from "../../shared/types";
import { test, expect, loginDemo, createAttempt, getAttempt, noHorizontalOverflow, capturePage } from "./fixtures";

function content(id: string, skill: StoredContent["skill"], sections: ContentSection[], questions: StoredQuestion[] = []): StoredContent {
  return { id, skill, title: "Visual IELTS practice", description: "Structured visual tasks", topic: "Sustainable cities", band: 6, cefr: "B2", testType: "academic", durationMinutes: 30, format: "lesson", questions, sections, vocabularyIds: [], tags: ["visual-e2e"], source: "authored", quality: "authored-unreviewed", createdAt: new Date().toISOString() };
}
const chart: ChartVisual = { id: "chart", type: "line", title: "Commuting modes, 2000–2020", rows: [{ label: "2000", values: [20, 35] }, { label: "2010", values: [35, 40] }, { label: "2020", values: [50, 30] }], series: ["Bicycle", "Public transport"], unit: "%", xLabel: "Year", yLabel: "Percentage of commuters" };
const map: SpatialVisual = { id: "map", type: "map", title: "Riverside park", width: 620, height: 380, areas: [{ id: "building", x: 60, y: 65, width: 165, height: 70 }, { id: "garden", x: 320, y: 180, width: 160, height: 100 }], paths: [{ id: "road", style: "road", points: [[20, 300], [600, 300]] }, { id: "path", style: "path", points: [[290, 300], [290, 80]] }, { id: "river", style: "river", points: [[550, 20], [530, 160], [560, 270]] }], labels: [{ id: "entrance", x: 130, y: 333, text: "Main entrance" }, { id: "building-label", x: 145, y: 105, questionNumber: 7 }, { id: "garden-label", x: 400, y: 235, text: "Rose garden" }] };
const process: SpatialVisual = { id: "process", type: "process", title: "Water treatment cycle", width: 620, height: 280, labels: [], nodes: [{ id: "collect", x: 20, y: 90, width: 155, height: 80, text: "Collect rainwater" }, { id: "filter", x: 235, y: 90, width: 155, height: 80, text: "Filter sediment" }, { id: "store", x: 450, y: 90, width: 150, height: 80, text: "Store clean water" }], connections: [{ from: "collect", to: "filter" }, { from: "filter", to: "store" }] };

test("all seven Academic Task 1 chart categories render as their actual visual forms", async ({ page, db }) => {
  const variants: ContentSection[] = [
    ...(["line", "bar", "pie", "table"] as const).map((type, index) => ({ id: `task-${index}`, title: `${type} chart`, text: "Summarise the information by selecting and reporting the main features, and make comparisons where relevant.", task: 1 as const, visuals: [{ ...chart, id: type, type }] })),
    { id: "task-map", title: "Map comparison", text: "Compare the park layouts.", task: 1, visuals: [{ ...map, labels: map.labels.map(label => label.questionNumber ? { ...label, questionNumber: undefined, text: "Visitor centre" } : label) }] },
    { id: "task-process", title: "Process diagram", text: "Describe how rainwater is treated.", task: 1, visuals: [process] },
    { id: "task-mixed", title: "Mixed charts", text: "Summarise the line graph and the table.", task: 1, visuals: [chart, { ...chart, id: "mixed-table", type: "table" }] },
    { id: "task-legacy", title: "Legacy line chart", text: "Describe the trends.", task: 1, chart: chart.rows, chartSeries: chart.series, chartUnit: "%", chartType: "line" },
  ];
  const fixture = content("visual-e2e-writing", "writing", variants);
  await db.collection<StoredContent & { _id: string }>("content").replaceOne({ _id: fixture.id }, fixture, { upsert: true });
  await loginDemo(page);
  const attempt = await createAttempt(page, fixture);
  await page.goto(`/learn/${attempt.id}`);
  const tabs = page.getByRole("group", { name: "Phần của bài tập", exact: true }).getByRole("button");
  for (let index = 0; index < variants.length; index++) {
    await tabs.nth(index).click();
    const expected = index === 6 ? ["line", "table"] : [index === 7 ? "line" : ["line", "bar", "pie", "table", "map", "process"][index]];
    for (const type of expected) await expect(page.locator(`[data-visual-type="${type}"]`)).toBeVisible();
    if (expected.includes("line")) { await expect(page.locator("[data-visual-type=line] polyline")).toHaveCount(2); await expect(page.locator("[data-visual-type=line] rect")).toHaveCount(0); }
    if (expected.includes("pie")) await expect(page.locator(".pie-chart-panel svg path")).toHaveCount(6);
    if (expected.includes("table")) await expect(page.locator("[data-visual-type=table] table")).toBeVisible();
    if (expected.includes("process")) await expect(page.locator("[data-visual-type=process] line[marker-end]")).toHaveCount(2);
    await noHorizontalOverflow(page);
  }
  await tabs.nth(6).click();
  await capturePage(page, "v3-writing-mixed-charts");
});

test("map blanks, six completion layouts and multiple-answer selections work and resume without answer leakage", async ({ page, db }) => {
  const blocks: ContentSection["questionBlocks"] = [
    { id: "form", type: "form", title: "Course registration form", instructions: "Write ONE WORD for each answer.", questionNumbers: [1], rows: [{ label: "Preferred day", cells: ["{{1}}"] }] },
    { id: "note", type: "note", title: "Fieldwork notes", instructions: "Write ONE WORD for each answer.", questionNumbers: [2], rows: [{ cells: ["Bring a {{2}} to the collection point."] }] },
    { id: "table", type: "table", title: "Equipment table", instructions: "Write ONE WORD for each answer.", questionNumbers: [3], rows: [{ label: "Device", cells: ["Purpose"] }, { label: "Sensor", cells: ["Measures {{3}}"] }] },
    { id: "flow", type: "flow-chart", title: "Collection procedure", instructions: "Write ONE WORD for each answer.", questionNumbers: [4], rows: [{ cells: ["Collect the sample"] }, { cells: ["Place it in a {{4}}"] }, { cells: ["Send it for analysis"] }] },
    { id: "summary", type: "summary", title: "Project summary", instructions: "Write ONE WORD for each answer.", questionNumbers: [5], text: "The group plans to survey the {{5}} before making a recommendation." },
    { id: "sentence", type: "sentence", title: "Complete the sentence", instructions: "Write ONE WORD for each answer.", questionNumbers: [6], text: "The final report will be submitted in {{6}}." },
  ];
  const answers = ["Tuesday", "notebook", "temperature", "container", "residents", "October", "visitor centre", "Improved footpaths", "More bicycle parking"];
  const questions: StoredQuestion[] = answers.map((answer, index) => ({ id: `visual-e2e-q${index + 1}`, number: index + 1, type: index >= 7 ? "choice-multiple" : "text", sectionIndex: 0, prompt: index >= 7 ? "Which TWO changes do the residents recommend?" : index === 6 ? "Label the building on the map." : `Complete blank ${index + 1}.`, subskill: "identifying-details", answer, wordLimit: index === 6 ? 2 : 1, explanation: "The speaker explicitly states this detail.", evidence: `The recording states: ${answer}.`, ...(index < 6 ? { blockId: blocks[index].id } : {}), ...(index === 6 ? { visualId: "map", questionType: "map-labelling" as const } : {}), ...(index >= 7 ? { selectionGroup: { id: "recommendations", count: 2 }, groupInstructions: "Choose TWO answers.", options: ["Improved footpaths", "More bicycle parking", "A larger café", "Longer opening hours"] } : {}) }));
  const section: ContentSection = { id: "listen-section", title: "Part 2: Riverside park consultation", text: "The visitor centre is near the main entrance. Residents ask for improved footpaths and more bicycle parking.", instructions: "Listen and answer questions 1–9.", visuals: [map], questionBlocks: blocks };
  const fixture = content("visual-e2e-listening", "listening", [section], questions);
  await db.collection<StoredContent & { _id: string }>("content").replaceOne({ _id: fixture.id }, fixture, { upsert: true });
  await loginDemo(page);
  const attempt = await createAttempt(page, fixture, "exam");
  await page.goto(`/learn/${attempt.id}`);
  await expect(page.locator("[data-visual-type=map]")).toBeVisible();
  await page.getByRole("button", { name: "Phóng to: Riverside park", exact: true }).click();
  const enlarged = page.getByRole("dialog", { name: "Riverside park", exact: true });
  await expect(enlarged).toBeVisible();
  expect(await enlarged.locator("svg[role=img]").evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(600);
  await enlarged.getByRole("button", { name: "Đóng", exact: true }).click();
  await expect(page.locator(".completion-block")).toHaveCount(6);
  await expect(page.locator(".multiple-choice-group")).toHaveCount(1);
  await expect(page.getByRole("checkbox")).toHaveCount(4);
  const svg = page.locator("[data-visual-type=map] svg");
  expect((await svg.textContent())?.toLowerCase()).not.toContain("visitor centre");
  expect(await svg.textContent()).toContain("Blank for question 7");
  expect(await svg.textContent()).toContain("N");
  await expect(page.getByText("Main entrance", { exact: true })).toBeVisible();
  await expect(page.locator(".reading-passage")).toHaveCount(0);
  for (let index = 0; index < 7; index++) await page.getByRole("textbox", { name: `Câu ${index + 1}`, exact: true }).fill(answers[index]);
  const group = page.locator(".multiple-choice-group");
  await group.getByRole("checkbox", { name: /Improved footpaths/ }).check();
  await group.getByRole("checkbox", { name: /More bicycle parking/ }).check();
  await expect(group.getByRole("checkbox", { name: /A larger café/ })).toBeDisabled();
  await expect(page.getByText("9/9 câu đã trả lời", { exact: true })).toBeVisible();
  await expect.poll(async () => (await getAttempt(page, attempt.id)).responses[questions[8].id]).toBe(JSON.stringify(answers.slice(7)));
  const saved = await getAttempt(page, attempt.id);
  expect(saved.responses[questions[7].id]).toBe(saved.responses[questions[8].id]);
  await page.reload();
  await expect(group.getByRole("checkbox", { name: /Improved footpaths/ })).toBeChecked();
  await expect(group.getByRole("checkbox", { name: /More bicycle parking/ })).toBeChecked();
  await expect(page.getByRole("textbox", { name: "Câu 1", exact: true })).toHaveValue("Tuesday");
  await noHorizontalOverflow(page);
  await capturePage(page, "v3-listening-map-completion");
  await page.getByRole("button", { name: "Nộp bài & xem phản hồi", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Nộp bài", exact: true }).click();
  await expect(group.getByText("2/2 điểm", { exact: true })).toBeVisible();
  await expect.poll(async () => (await getAttempt(page, attempt.id)).feedback?.rawScore).toBe(9);
});

test("reading diagram labels show numbered blanks and remain answerable", async ({ page, db }) => {
  const diagram: SpatialVisual = { ...process, id: "diagram", type: "diagram", title: "Rainwater system", nodes: process.nodes?.map((node, index) => index === 1 ? { ...node, text: undefined, questionNumber: 1 } : node) };
  const question: StoredQuestion = { id: "diagram-q1", number: 1, type: "text", sectionIndex: 0, prompt: "Label the middle stage of the system.", subskill: "diagram-labelling", questionType: "diagram-labelling", visualId: "diagram", answer: "sediment filter", wordLimit: 2, explanation: "The first filter removes sediment.", evidence: "Collected water passes through a sediment filter before storage." };
  const fixture = content("visual-e2e-reading", "reading", [{ id: "reading-section", title: "Rainwater harvesting", text: "Collected water passes through a sediment filter before storage.", visuals: [diagram] }], [question]);
  await db.collection<StoredContent & { _id: string }>("content").replaceOne({ _id: fixture.id }, fixture, { upsert: true });
  await loginDemo(page);
  const attempt = await createAttempt(page, fixture, "exam");
  await page.goto(`/learn/${attempt.id}`);
  const visual = page.locator("[data-visual-type=diagram]");
  await expect(visual).toBeVisible();
  expect((await visual.locator("svg").textContent())?.toLowerCase()).not.toContain("sediment filter");
  await page.getByRole("textbox", { name: "Câu 1", exact: true }).fill("sediment filter");
  await expect.poll(async () => (await getAttempt(page, attempt.id)).responses[question.id]).toBe("sediment filter");
  await noHorizontalOverflow(page);
});

test("legacy map captions fit their areas while numbered blanks and standalone labels keep their positions", async ({ page, db }) => {
  const captionMap: SpatialVisual = {
    id: "legacy-caption-map", type: "map", title: "Community garden access", width: 620, height: 380,
    areas: [
      { id: "caption-area-0", x: 40, y: 45, width: 180, height: 100 },
      { id: "caption-area-1", x: 300, y: 170, width: 160, height: 100 },
      { id: "caption-area-2", x: 300, y: 45, width: 160, height: 100 },
    ],
    labels: [
      { id: "caption-label-0", x: 50, y: 75, text: "Accessible outdoor learning garden" },
      { id: "caption-label-1", x: 310, y: 200, questionNumber: 1 },
      { id: "caption-label-2", x: 380, y: 95, text: "Covered walking path" },
      { id: "entrance", x: 130, y: 333, text: "Main entrance" },
      { id: "north", x: 510, y: 28, text: "North ↑" },
    ],
    paths: [{ id: "south-road", style: "road", points: [[20, 300], [600, 300]] }],
  };
  const question: StoredQuestion = { id: "caption-question", number: 1, type: "text", sectionIndex: 0, prompt: "Label the facility south of the walking path.", subskill: "diagram-labelling", questionType: "diagram-labelling", visualId: captionMap.id, answer: "visitor room", wordLimit: 2, explanation: "The passage names this facility.", evidence: "The visitor room is south of the covered walking path." };
  const fixture = content("visual-e2e-legacy-captions", "reading", [{ id: "caption-section", title: "Garden facilities", text: question.evidence!, visuals: [captionMap] }], [question]);
  await db.collection<StoredContent & { _id: string }>("content").replaceOne({ _id: fixture.id }, fixture, { upsert: true });
  await loginDemo(page);
  const attempt = await createAttempt(page, fixture, "exam");
  await page.goto(`/learn/${attempt.id}`);
  const visual = page.locator("[data-visual-type=map]");
  await expect(visual).toBeVisible();
  const caption = visual.locator("text.visual-label").filter({ hasText: "Accessible outdoor" });
  await expect(caption).toHaveAttribute("x", "130");
  await expect(caption.locator("tspan")).toHaveCount(2);
  const bounds = await caption.evaluate(element => {
    const box = (element as SVGGraphicsElement).getBBox();
    return { left: box.x, right: box.x + box.width, top: box.y, bottom: box.y + box.height };
  });
  expect(bounds.left).toBeGreaterThanOrEqual(40);
  expect(bounds.right).toBeLessThanOrEqual(220);
  expect(bounds.top).toBeGreaterThanOrEqual(45);
  expect(bounds.bottom).toBeLessThanOrEqual(145);
  const centred = visual.locator("text.visual-label").filter({ hasText: "Covered walking path" });
  await expect(centred).toHaveAttribute("x", "380");
  await expect(centred).toHaveAttribute("y", "99");
  const blank = visual.locator('rect[stroke-dasharray="4 3"]');
  await expect(blank).toHaveAttribute("x", "281");
  await expect(blank).toHaveAttribute("y", "187");
  const entrance = visual.locator("text.visual-label").filter({ hasText: "Main entrance" });
  await expect(entrance).toHaveAttribute("x", "130");
  await expect(entrance).toHaveAttribute("y", "333");
  await expect(visual.locator("text.visual-label").filter({ hasText: "North ↑" })).toHaveAttribute("y", "28");
  await noHorizontalOverflow(page);
});
