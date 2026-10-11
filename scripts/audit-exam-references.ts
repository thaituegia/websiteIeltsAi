import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { contentBank } from "../server/data/index";
import { contentBank as initialContentBank } from "../server/data/initial-fresh-bank";
import { contentSourceDigest } from "../server/content-references";
import type { ReferenceResponse, StoredContent } from "../shared/types";

const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const wordCount = (value: string) => value.trim().split(/\s+/u).filter(Boolean).length;

export function auditExamReferences(bank: readonly StoredContent[] = contentBank) {
  const issues: string[] = [];
  const check = (condition: unknown, message: string) => { if (!condition) issues.push(message); };
  const originals = new Map(initialContentBank.map(item => [item.id, item]));
  const newMocks = bank.filter(item => !originals.has(item.id));
  check(newMocks.length === 16 && newMocks.every(item => item.format === "full-mock"), "The upgrade must add exactly sixteen independent full mocks.");
  for (const skill of ["reading", "listening", "writing", "speaking"])
    check(newMocks.filter(item => item.skill === skill).length === 4, `${skill}: four new complete mocks required`);
  for (const previous of initialContentBank) {
    const current = bank.find(item => item.id === previous.id);
    check(current && contentSourceDigest(current) === contentSourceDigest(previous), `${previous.id}: an existing source/task/key changed during the additive upgrade`);
  }
  const fullSamples = new Map<string, string>();
  const speakingResponses = new Map<string, string>();
  let reviewedContents = 0, reviewedSections = 0, interviewResponses = 0;
  const validate = (item: StoredContent, reference: ReferenceResponse) => {
    const section = item.sections.find(section => section.id === reference.sectionId);
    const label = `${item.id}/${reference.sectionId}`;
    check(section, `${label}: reference has no matching section`);
    check(reference.title.trim() && reference.explanation.trim() && reference.keyPoints.length >= 2 && reference.keyPoints.every(point => point.trim()), `${label}: missing explanation or learning points`);
    const signature = normalize(reference.sampleAnswer);
    check(signature && !fullSamples.has(signature), `${label}: repeated or empty full sample ${fullSamples.get(signature) ?? ""}`);
    fullSamples.set(signature, label);
    if (!section) return;
    check(!section.text.includes(reference.sampleAnswer), `${label}: sample leaked into the task stimulus`);
    if (item.skill === "writing") {
      check(wordCount(reference.sampleAnswer) >= (section.task === 1 ? 150 : 250), `${label}: model below authentic Writing minimum`);
      check(!reference.responses?.length, `${label}: Writing needs a coherent complete model`);
      const charts = section.visuals?.filter(visual => "rows" in visual) ?? [];
      const numericMentions = new Set([...reference.sampleAnswer.matchAll(/(?<![\p{L}\d.])-?\d+(?:,\d{3})*(?:\.\d+)?(?![\d.])/gu)]
        .map(match => Number(match[0].replaceAll(",", ""))));
      for (const chart of charts) if ("rows" in chart) {
        const numbers = [...new Set(chart.rows.flatMap(row => row.values))];
        const mentioned = numbers.filter(number => numericMentions.has(number));
        check(mentioned.length >= Math.min(3, numbers.length), `${label}: model lacks enough actual values from ${chart.id}`);
      }
    }
    if (item.skill === "speaking") {
      const part = /^Part ([123])/.exec(section.title)?.[1];
      if (part === "2") {
        check(wordCount(reference.sampleAnswer) >= 170 && wordCount(reference.sampleAnswer) <= 330, `${label}: long-turn sample is not plausible for one to two minutes`);
        check(section.cuePoints?.length === 4, `${label}: long turn lacks four cues`);
      } else {
        const prompts = section.text.split("\n").filter(line => /^\d+[.)]\s/.test(line)).map(line => line.replace(/^\d+[.)]\s*/, ""));
        check(reference.responses?.length === prompts.length && prompts.length >= 5, `${label}: every interview question needs its own sample`);
        for (const [index, response] of (reference.responses ?? []).entries()) {
          check(normalize(response.prompt) === normalize(prompts[index] ?? ""), `${label}: sample is assigned to a different interview question`);
          check(wordCount(response.sampleAnswer) >= (part === "3" ? 35 : 18), `${label}/${index + 1}: interview sample is too brief`);
          const signature = normalize(response.sampleAnswer);
          check(!speakingResponses.has(signature), `${label}/${index + 1}: reused complete interview response ${speakingResponses.get(signature) ?? ""}`);
          speakingResponses.set(signature, `${label}/${index + 1}`);
          interviewResponses++;
        }
      }
    }
  };
  for (const item of bank.filter(item => ["writing", "speaking"].includes(item.skill))) {
    reviewedContents++;
    check(item.referenceAnswers?.length === item.sections.length && new Set(item.referenceAnswers?.map(reference => reference.sectionId)).size === item.sections.length, `${item.id}: each task/Part needs one unique completed-review reference`);
    for (const reference of item.referenceAnswers ?? []) { reviewedSections++; validate(item, reference); }
  }
  return {
    status: issues.length ? "failed" : "passed", newMocks: newMocks.length,
    bySkill: Object.fromEntries(["reading", "listening", "writing", "speaking"].map(skill => [skill, newMocks.filter(item => item.skill === skill).length])),
    reviewedContents, reviewedSections, interviewResponses, issues,
    limitations: ["Automated coverage, unchanged-key, alignment, sample-length and duplication checks do not replace IELTS examiner review; samples are illustrative, not unique correct answers or promised scores."],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = auditExamReferences();
  await mkdir(".local/exam-upgrade", { recursive: true, mode: 0o700 });
  await writeFile(".local/exam-upgrade/reference-audit.json", JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== "passed") process.exitCode = 1;
}
