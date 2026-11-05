import type { StoredQuestion } from "../shared/types";

type ShortAnswer = Pick<StoredQuestion, "type" | "questionType" | "prompt" | "evidence">;

const normalized = (value: string): string => value.normalize("NFC").trim()
  .toLowerCase().replace(/[’‘]/gu, "'").replace(/\s+/gu, " ");

// These unambiguous count nouns are inflected only when the question asks for
// a kind/type, never when it asks for a quantity or a word that fills a sentence.
// Do not stem arbitrary words: glasses/glass, customs/custom and species are
// examples where removing an ending can change the answer's meaning.
const countNouns = [
  "bag", "battery", "bench", "bicycle", "board", "boat", "book", "bottle", "box",
  "bucket", "building", "bus", "button", "cable", "camera", "car", "card", "chair",
  "charger", "computer", "container", "cup", "desk", "device", "display", "door",
  "file", "flower", "folder", "form", "jar", "key", "label", "lamp", "leaflet",
  "letter", "lock", "marker", "notebook", "panel", "pen", "pencil", "phone",
  "plant", "poster", "pot", "room", "seed", "shelf", "sign", "speaker", "table",
  "tablet", "ticket", "tool", "train", "tray", "tree", "window",
] as const;
function plural(noun: string): string {
  if (noun === "shelf") return "shelves";
  if (/[^aeiou]y$/u.test(noun)) return noun.slice(0, -1) + "ies";
  if (/(?:s|x|z|ch|sh)$/u.test(noun)) return noun + "es";
  return noun + "s";
}
const nounForms = new Map<string, string>(countNouns.flatMap(noun =>
  [[noun, noun], [plural(noun), noun]] as [string, string][],
));

function nounPhrase(value: string): { article: string; phrase: string } {
  const match = /^(a|an|the) (.+)$/u.exec(value);
  return match ? { article: match[1]!, phrase: match[2]! } : { article: "", phrase: value };
}
function sourceContains(source: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "u").test(source);
}
function nounCategory(phrase: string): string | undefined {
  // A numerical/quantified answer is not a number-neutral category answer.
  if (/[\p{N}]/u.test(phrase) || /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|several|many|few|each|every|both)\b/u.test(phrase)) return;
  const words = phrase.split(" ");
  const head = nounForms.get(words.at(-1)!);
  if (!head) return;
  return [...words.slice(0, -1), head].join(" ");
}

/** Additional, conservative equivalence for standalone Reading/Listening short
 * answers. The caller still enforces word/number limits and explicit keys.
 * It does not supply synonyms, fuzzy spelling, or gap-filling grammar repairs. */
export function matchingEquivalentShortAnswer(
  response: string,
  keys: readonly string[],
  question: ShortAnswer,
  sectionText = "",
): string | undefined {
  if (question.type !== "text" || question.questionType !== "short-answer" ||
      /_{2,}|\{\{\d+\}\}/u.test(question.prompt)) return;
  const stem = normalized(question.prompt).replace(/\b(?:write|use|give)\s+(?:no more than|not more than|one|two|three|a maximum of|\d)\b.*$/u, "");
  if (/\bhow\s+(?:many|much)\b|\b(?:number|quantity|amount|total|name|title|called|company|newspaper|organisation|organization|journal|magazine|brand|author)\b/u.test(stem)) return;
  const candidate = nounPhrase(normalized(response));
  if (!candidate.phrase || /[^\p{L}\p{M}' -]/u.test(candidate.phrase)) return;
  const source = normalized(`${question.evidence}\n${sectionText}`).replace(/\[\[|\]\]/gu, "");
  const categoryQuestion = /\b(?:kind|type|sort)\s+of\b/u.test(stem);
  for (const key of keys) {
    const expected = nounPhrase(normalized(key));
    // An additional/different article must form an actual source phrase. This
    // admits "A tray" while rejecting invented articles such as "an tray".
    if (candidate.article && candidate.article !== expected.article &&
        !sourceContains(source, `${candidate.article} ${candidate.phrase}`)) continue;
    if (candidate.phrase === expected.phrase) return key;
    if (categoryQuestion) {
      const expectedCategory = nounCategory(expected.phrase);
      if (expectedCategory && expectedCategory === nounCategory(candidate.phrase)) return key;
    }
  }
  return;
}
