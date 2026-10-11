import type { StoredContent } from "../../shared/types.js";
import type { ReplacementBank } from "../bank-reset.js";
import { freshReadingLessons, freshReadingMocks } from "./fresh/reading.js";
import { freshListeningLessons, freshListeningMocks } from "./fresh/listening.js";
import { freshWritingLessons, freshWritingMocks, freshSpeakingLessons, freshSpeakingMocks } from "./fresh/productive.js";
import { freshGrammarLessons, freshVocabularyBank, freshPlacementBank } from "./fresh/support.js";

// Only this wholly new bank is seeded at runtime. previous-bank.ts is a
// historical audit fixture; it is never loaded or seeded by the application.
export const bankVersion = "fresh-20261011";
export const vocabularyBank = freshVocabularyBank;
export const placementBank = freshPlacementBank;
const levels = ["A2", "B1", "B2", "C1"];
export const contentBank: StoredContent[] = [
  ...freshReadingLessons, ...freshListeningLessons, ...freshWritingLessons,
  ...freshSpeakingLessons, ...freshGrammarLessons, ...freshReadingMocks,
  ...freshListeningMocks, ...freshWritingMocks, ...freshSpeakingMocks,
].map(content => {
  const text = content.sections.map(section => section.text).join(" ").toLowerCase();
  const suitable = vocabularyBank.filter(word => levels.indexOf(word.cefr) <= levels.indexOf(content.cefr));
  const related = suitable.filter(word => text.includes(word.word.toLowerCase()) || content.topic.toLowerCase().includes(word.topic.toLowerCase()));
  // Vocabulary sessions always have fresh, level-appropriate cards even when
  // an individual topic has no literal word match in the short prompt.
  const offset = Array.from(content.id).reduce((total, ch) => total + ch.charCodeAt(0), 0) % Math.max(1, suitable.length);
  const fallback = [...suitable.slice(offset), ...suitable.slice(0, offset)];
  return { ...content, vocabularyIds: [...new Set([...related, ...fallback].map(word => word.id))].slice(0, content.format === "full-mock" ? 12 : 6) };
});
export const replacementBank: ReplacementBank = {
  version: bankVersion, content: contentBank, vocabulary: vocabularyBank, placementItems: placementBank,
};
