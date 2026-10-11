import type { Cefr, ContentSection, SpatialVisual, StoredContent } from "../../../shared/types.js";

const generatedAt = "2026-10-11T07:00:00.000Z";
const task1Instructions = "You should spend about 20 minutes on this task. Write at least 150 words.";
const task2Instructions = "You should spend about 40 minutes on this task. Write at least 250 words. Give reasons for your answer and include any relevant examples from your own knowledge or experience.";
const report = "Summarise the information by selecting and reporting the main features, and make comparisons where relevant.";
function healthMap(id: string, title: string, places: [string, number, number, number, number][]): SpatialVisual {
  return { id, type: "map", title, width: 800, height: 500,
    labels: [{ id: `${id}-north`, text: "North ↑", x: 712, y: 28 }, { id: `${id}-road`, text: "South Road", x: 400, y: 482 }, ...places.map(([text, x, y, width, height], i) => ({ id: `${id}-label-${i}`, text, x: x + width / 2, y: y + height / 2 }))],
    areas: places.map(([text, x, y, width, height], i) => ({ id: `${id}-area-${i}`, x, y, width, height, fill: /garden|path/.test(text) ? "#d4e7bf" : "#ecdfc5" })),
    paths: [{ id: `${id}-south-road`, points: [[20, 450], [780, 450]], style: "road" }] };
}
function mock(id: string, title: string, topic: string, testType: "academic" | "general", band: number, task1: ContentSection, task2: string): StoredContent {
  const cefr: Cefr = band >= 7.5 ? "C1" : "B2";
  return { id, skill: "writing", title, topic, description: "An original full IELTS-style Writing test: Task 1 requires at least 150 words; Task 2 requires at least 250 words and carries twice the weight. Reference responses become available after submission.", testType, band, cefr, durationMinutes: 60, format: "full-mock", questions: [], vocabularyIds: [],
    sections: [{ ...task1, id: `${id}-task1`, task: 1, instructions: task1Instructions }, { id: `${id}-task2`, title: "Task 2", task: 2, text: task2, instructions: task2Instructions }],
    source: "ai", quality: "ai-unreviewed", createdAt: generatedAt, tags: ["new-exams-20261011", "original-prompt", "independent-mock", testType],
    objectives: ["Select accurate main features or address all three letter points.", "Develop a clear position supported by relevant explanations and examples."], errorTypes: ["task-coverage", "paragraph-coherence", "lexical-precision", "grammatical-control"],
    provenance: { method: "ai-assisted", version: "new-exams-20261011", generatedAt }, estimatedDifficulty: { band, cefr, basis: "An estimated practice target based on task demands, not an examiner-calibrated score or a guaranteed model-answer band." }, review: { status: "unreviewed", checks: [], limitations: ["Original AI-authored practice and reference responses; not official IELTS material or independently examiner reviewed."] } };
}

export const newWritingMocks: StoredContent[] = [
  mock("fresh-w-exam-transport-01", "Academic Writing · Cleaner urban travel", "Transport and technology", "academic", 7,
    { id: "", title: "Task 1 · Mixed charts", text: `The line graph shows the percentage of weekday bus journeys made by electric buses in three cities between 2016 and 2025. The table compares the number of public bus-charging points and the average daily bus journeys in those cities in 2025. ${report}`, visuals: [
      { id: "fresh-w-exam-electric-bus-trends", type: "line", title: "Weekday journeys made by electric buses", unit: "% of weekday bus journeys", series: ["Ashford", "Bellmere", "Cresswick"], rows: [{ label: "2016", values: [4, 9, 2] }, { label: "2019", values: [16, 24, 7] }, { label: "2022", values: [39, 46, 21] }, { label: "2025", values: [68, 61, 43] }] },
      { id: "fresh-w-exam-electric-bus-table", type: "table", title: "Bus infrastructure and use, 2025", unit: "units specified in columns", series: ["Public charging points", "Average daily bus journeys (thousands)"], rows: [{ label: "Ashford", values: [145, 310] }, { label: "Bellmere", values: [172, 425] }, { label: "Cresswick", values: [96, 268] }] },
    ] }, "Some people believe that protecting the environment is mainly the responsibility of individuals. Others believe governments and large companies have the greater responsibility. Discuss both views and give your own opinion."),
  mock("fresh-w-exam-health-02", "Academic Writing · A community health centre", "Health and education", "academic", 7.5,
    { id: "", title: "Task 1 · Maps", text: `The plans show a neighbourhood clinic in 2008 and the same site after its conversion into a community health centre in 2025. South Road and the site's boundaries remain unchanged. ${report}`, visuals: [
      healthMap("fresh-w-exam-clinic-2008", "Neighbourhood clinic, 2008", [["Car park", 30, 60, 330, 110], ["Main clinic", 30, 225, 330, 150], ["Storage building", 505, 60, 215, 110], ["Unused ground", 480, 225, 240, 150]]),
      healthMap("fresh-w-exam-clinic-2025", "Community health centre, 2025", [["Car park", 30, 60, 330, 110], ["Main clinic", 30, 225, 330, 150], ["Physiotherapy rooms", 465, 60, 265, 110], ["Exercise garden", 480, 205, 240, 95], ["Covered walking path", 480, 320, 240, 55], ["Cycle parking", 370, 225, 100, 150]]),
    ] }, "Some people think universities should deliver all lectures online. Others believe face-to-face lectures remain essential. Discuss both views and give your own opinion."),
  mock("fresh-w-exam-work-03", "General Training Writing · Cycling to work", "Work and transport", "general", 6.5,
    { id: "", title: "Task 1 · Formal letter", text: "Several employees at your workplace cycle to work, but the company provides nowhere secure to keep bicycles. Write a letter to the facilities manager. In your letter:\n• explain the current parking problem\n• describe how secure bicycle parking would benefit staff and the company\n• suggest a suitable location and ask for a response\n\nYou do not need to write any addresses." }, "An increasing number of employees work entirely from home rather than at their employer's premises. What are the advantages and disadvantages of this development?"),
  mock("fresh-w-exam-fitness-04", "General Training Writing · Keeping an exercise routine", "Health and community services", "general", 7,
    { id: "", title: "Task 1 · Semi-formal letter", text: "You regularly attend an evening fitness class at a community centre. The organiser, whom you know, has announced that this class will be cancelled. Write a letter to the organiser. In your letter:\n• explain why the class is important to you\n• describe the difficulties the cancellation would cause\n• suggest an alternative arrangement\n\nYou do not need to write any addresses." }, "Many school pupils spend less time being physically active than pupils did in the past. What are the reasons for this change, and what could schools and families do to address it?"),
];
