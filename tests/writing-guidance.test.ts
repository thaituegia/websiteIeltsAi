import assert from "node:assert/strict";
import { test } from "node:test";
import type { ContentSection, ReferenceResponse, SpatialVisual, StoredContent } from "../shared/types";
import { contentBank } from "../server/data/index";
import { buildWritingGuides } from "../server/writing-guidance";

const writing = contentBank.filter(item => item.skill === "writing");
function fixture(): StoredContent { return structuredClone(writing.find(item => item.format === "full-mock" && item.sections.some(section => section.visuals?.some(visual => visual.type === "line")))!); }
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function references(content: StoredContent): ReferenceResponse[] { return content.referenceAnswers!; }

test("all360 Writing tasks have readable Vietnamese guidance anchored to unchanged real samples", () => {
  const before = JSON.stringify(writing);
  const families = new Set<string>();
  let count = 0;
  for (const content of writing) {
    const guides = buildWritingGuides(content, references(content));
    assert.equal(guides.length, content.sections.length, content.id);
    for (const guide of guides) {
      count++; families.add(guide.taskType);
      const section = content.sections.find(row => row.id === guide.sectionId)!;
      const reference = references(content).find(row => row.sectionId === section.id)!;
      assert.equal(guide.sourceVerified, true, section.id);
      assert.equal(guide.task, section.task);
      assert.ok(guide.analysis.length >= 2, section.id);
      assert.ok(guide.analysis.some(text => text.includes(section.text)), section.id);
      assert.equal(guide.timePlan.totalMinutes, section.task === 1 ? 20 : 40);
      assert.equal(guide.timePlan.minimumWords, section.task === 1 ? 150 : 250);
      assert.equal(guide.timePlan.planningMinutes + guide.timePlan.writingMinutes + guide.timePlan.checkingMinutes, guide.timePlan.totalMinutes);
      assert.equal(guide.paragraphs.length, reference.sampleAnswer.split(/\n\s*\n/gu).filter(row => row.trim()).length);
      guide.paragraphs.forEach((paragraph, index) => {
        assert.equal(paragraph.index, index);
        assert.ok(reference.sampleAnswer.includes(paragraph.excerpt), `${section.id}: exact excerpt`);
        assert.match(paragraph.guidance, /[à-ỹ]/iu);
      });
      for (const phrase of guide.usefulLanguage) {
        assert.ok(reference.sampleAnswer.includes(phrase.phrase));
        assert.match(phrase.meaningVi, /[à-ỹ]/iu);
      }
      assert.ok(guide.steps.length >= 3);
      assert.ok(guide.checklist.length >= 4);
      assert.ok(guide.pitfalls.some(row => row.includes("không phải cam kết band")));
    }
  }
  assert.equal(writing.length, 306); assert.equal(count, 360);
  for (const family of ["line", "bar", "pie", "table", "map", "process", "mixed", "letter-formal", "letter-semi-formal", "letter-informal", "opinion", "discussion", "advantages-disadvantages", "problem-solution", "causes-effects", "two-part"])
    assert.ok(families.has(family), family);
  assert.equal(JSON.stringify(writing), before);
});

test("source proof compares both source and saved model and is independent for each Task", () => {
  const content = fixture(), refs = structuredClone(references(content));
  content.sections[0].text = "CHANGED_PROMPT_987654321";
  const changed = content.sections[0].visuals!.find(visual => "rows" in visual)!;
  if ("rows" in changed) changed.rows[0].values[0] = 987654321;
  const guides = buildWritingGuides(content, refs);
  assert.equal(guides[0].sourceVerified, false);
  assert.equal(guides[0].taskType, "unverified");
  assert.ok(guides[0].notice);
  assert.equal(JSON.stringify(guides[0]).includes("987654321"), false);
  assert.equal(guides[1].sourceVerified, true, "Unchanged Task2 remains independently proven");
  assert.ok(guides[0].paragraphs.every(paragraph => refs[0].sampleAnswer.includes(paragraph.excerpt)));

  const teacher = fixture(), teacherRefs = structuredClone(references(teacher));
  teacherRefs[0].sampleAnswer = "A teacher changed this saved sample.\n\nThis exact paragraph must remain available.";
  const teacherGuide = buildWritingGuides(teacher, teacherRefs)[0];
  assert.equal(teacherGuide.sourceVerified, false);
  assert.equal(teacherGuide.paragraphs[1].excerpt, "This exact paragraph must remain available.");
  assert.equal(teacherRefs[0].sampleAnswer, "A teacher changed this saved sample.\n\nThis exact paragraph must remain available.");
});

test("identifier-remapped charts/maps/processes verify while real graph or data edits fail", () => {
  for (const type of ["line", "map", "process"] as const) {
    const content = structuredClone(writing.find(row => row.format === "lesson" && row.sections.some(section => section.visuals?.some(asset => asset.type === type)))!);
    const section = content.sections[0], refs = references(content);
    section.id = "replacement-section"; refs[0].sectionId = section.id;
    for (const [index, asset] of section.visuals!.entries()) {
      asset.id = `replacement-v${index}`;
      if (!("labels" in asset)) continue;
      const ids = new Map<string, string>();
      for (const key of ["labels", "nodes", "areas", "paths"] as const)
        for (const [position, item] of (asset[key] ?? []).entries()) ids.set(item.id, `replacement-${key}-${position}`);
      for (const key of ["labels", "nodes", "areas", "paths"] as const)
        for (const item of asset[key] ?? []) item.id = ids.get(item.id)!;
      for (const edge of asset.connections ?? []) { edge.from = ids.get(edge.from)!; edge.to = ids.get(edge.to)!; }
    }
    assert.equal(buildWritingGuides(content, refs)[0].sourceVerified, true, type);
    const asset = section.visuals![0];
    if ("rows" in asset) asset.rows[0].values[0] += 1;
    else if (asset.connections?.length) asset.connections[0].from = asset.connections[0].to;
    else asset.labels[0].x += 1;
    assert.equal(buildWritingGuides(content, refs)[0].sourceVerified, false, `${type}: changed semantics`);
  }
});

test("actual Task2 questions choose the walkthrough even when decorative titles disagree", () => {
  const content = fixture(), section = content.sections.find(row => row.task === 2)!;
  content.sections = [section];
  section.title = "Task2 · pie chart · opinion";
  const ref = references(content).find(row => row.sectionId === section.id)!;
  const prompts: [string, string][] = [
    ["Some people support online work; others support office work. Discuss both views and give your own opinion.", "discussion"],
    ["Do the advantages of remote work outweigh the disadvantages?", "advantages-disadvantages"],
    ["Many workers commute. What problems can this cause, and how can employers address them?", "problem-solution"],
    ["Many people commute. What are the causes of this change and what effects can it have?", "causes-effects"],
    ["People commute longer. Why has this happened and what could employers do to address it?", "causes-solutions"],
    ["Public transport should be free. To what extent do you agree or disagree?", "opinion"],
    ["Why do people move to cities? Is this a positive or negative development?", "two-part"],
    ["Why is clear communication about science important? How can news organisations improve it?", "two-part"],
    ["Why might they make this choice? What could local organisations do to support them?", "two-part"],
    ["New schemes aim to improve access to classes. What are the causes of declining attendance, and what effects can it have?", "causes-effects"],
    ["Some programmes create problems. Why is public access important? How can organisations improve it?", "two-part"],
  ];
  for (const [prompt, expected] of prompts) {
    section.text = prompt;
    const guide = buildWritingGuides(content, [ref], { sourceVerified: true })[0];
    assert.equal(guide.taskType, expected);
    assert.ok(guide.analysis[0].includes(prompt));
  }
});

test("all180 Task2 walkthroughs follow actual commands, including mislabeled cause/effect packs", () => {
  // These saved tags classify the authoring pack, but the actual question asks
  // for action/solutions rather than effects. Preserve the bank and follow the
  // question. The exercise-programme prompt uses neutral two-question support.
  const exceptions: Record<string, string> = Object.fromEntries([
    "fresh-w-lesson-066", "fresh-x3-w-lesson-triple-task2-late-night-sleep",
    "fresh-x3-w-lesson-triple-task2-small-town-young-leave", "fresh-x3-w-lesson-triple-task2-language-dialect-loss",
    "fresh-x3-w-lesson-triple-task2-public-bus-decline", "fresh-x3-w-lesson-triple-task2-children-less-outdoors",
    "fresh-x3-w-lesson-triple-task2-water-groundwater", "fresh-x3-w-lesson-triple-task2-women-engineering-barrier",
    "fresh-x3-w-lesson-triple-task2-city-noise-rise", "fresh-x3-w-lesson-triple-task2-wildlife-city",
    "fresh-x3-w-mock-nursery-plants", "fresh-x3-w-mock-electricity-bill", "fresh-x3-w-mock-storm-holiday",
  ].map(id => [id, "causes-solutions"]));
  exceptions["fresh-x3-w-mock-refill-stores"] = "two-part";
  const untagged: Record<string, string> = {
    "fresh-w-exam-transport-01": "discussion", "fresh-w-exam-health-02": "discussion",
    "fresh-w-exam-work-03": "advantages-disadvantages", "fresh-w-exam-fitness-04": "causes-solutions",
  };
  let count = 0;
  for (const content of writing) {
    for (const guide of buildWritingGuides(content, references(content))) {
      if (guide.task !== 2) continue;
      count++;
      const prefix = content.format === "full-mock" ? "essay-family:" : "writing-family:";
      const tag = content.tags.find(row => row.startsWith(prefix))?.slice(prefix.length);
      const expected = exceptions[content.id] ?? tag ?? untagged[content.id];
      assert.ok(expected, `${content.id}: prompt audit must explicitly cover untagged tasks`);
      assert.equal(guide.taskType, expected, content.id);
    }
  }
  assert.equal(count, 180);
});

test("letter advice respects actual recipient and covers exact required bullets", () => {
  const original = writing.find(row => row.testType === "general" && row.format === "lesson")!;
  for (const [recipient, expected] of [["your friend", "letter-informal"], ["the customer-service manager", "letter-formal"], ["your neighbour", "letter-semi-formal"]] as const) {
    const content = structuredClone(original), section = content.sections[0];
    section.title = "Task1 · line";
    section.text = `Write a letter to ${recipient}.\n• explain the problem\n• describe its effects\n• suggest an arrangement`;
    delete section.cuePoints;
    const guide = buildWritingGuides(content, references(content), { sourceVerified: true })[0];
    assert.equal(guide.taskType, expected);
    for (const bullet of ["explain the problem", "describe its effects", "suggest an arrangement"])
      assert.ok(guide.analysis.some(row => row.includes(bullet)));
    assert.ok(guide.checklist.some(row => row.includes("Lời chào")));
  }
});

test("mixed charts retain each exact unit; spatial guidance quotes only real labels and edges", () => {
  const mixed = writing.find(row => row.sections.some(section => (new Set(section.visuals?.map(asset => asset.type))).size > 1))!;
  const mixedGuide = buildWritingGuides(mixed, references(mixed))[0];
  assert.equal(mixedGuide.taskType, "mixed");
  for (const asset of mixed.sections[0].visuals!) if ("rows" in asset) {
    assert.ok(mixedGuide.analysis.some(row => row.includes(asset.unit)));
    assert.ok(mixedGuide.analysis.some(row => row.includes(String(asset.rows[0].values[0]))));
  }
  const process = writing.find(row => row.format === "lesson" && row.sections[0].visuals?.some(asset => asset.type === "process"))!;
  const guide = buildWritingGuides(process, references(process))[0];
  const visual = process.sections[0].visuals![0] as SpatialVisual;
  const names = new Map([...visual.labels, ...(visual.nodes ?? [])].map(node => [node.id, node.text]));
  const edge = visual.connections?.find(edge => names.get(edge.from) && names.get(edge.to));
  assert.ok(edge);
  assert.ok(guide.analysis.some(row => row.includes(`“${names.get(edge.from)}” → “${names.get(edge.to)}”`)));
  assert.ok(guide.analysis.some(row => row.includes("không thêm công đoạn")));
});

test("unknown legacy is conservative; current custom submission is opt-in and preserves samples", () => {
  const content = fixture(); content.sections[0].text = "CURRENT_UNKNOWN_SOURCE_998877";
  const refs = references(content);
  refs[0].sampleAnswer = "A custom teacher response remains exactly as saved.\n\nHowever, another illustration may also be appropriate.";
  const before = JSON.stringify({ content, refs });
  freeze(content); freeze(refs);
  const legacy = buildWritingGuides(content, refs)[0];
  assert.equal(legacy.sourceVerified, false);
  assert.equal(legacy.taskType, "unverified");
  assert.equal(JSON.stringify(legacy).includes("998877"), false);
  assert.equal(legacy.paragraphs[0].excerpt, "A custom teacher response remains exactly as saved.");
  const fresh = buildWritingGuides(content, refs, { sourceVerified: true })[0];
  assert.equal(fresh.sourceVerified, true);
  assert.ok(fresh.analysis[0].includes("998877"));
  assert.deepEqual(legacy.usefulLanguage, [{ phrase: "However", meaningVi: "Tuy nhiên; chỉ sự tương phản hoặc giới hạn." }]);
  assert.equal(JSON.stringify({ content, refs }), before);
});

test("orphan/blank models never generate a guide and non-Writing has no Writing notes", () => {
  const content = fixture();
  assert.deepEqual(buildWritingGuides(content, []), []);
  assert.deepEqual(buildWritingGuides(content, [{ ...references(content)[0], sectionId: "foreign-section" }]), []);
  assert.deepEqual(buildWritingGuides(content, [{ ...references(content)[0], sampleAnswer: "   " }]), []);
  content.skill = "speaking";
  assert.deepEqual(buildWritingGuides(content, references(content), { sourceVerified: true }), []);
});
