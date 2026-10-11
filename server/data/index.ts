import type { StoredContent } from '../../shared/types.js';
import type { ReplacementBank } from '../bank-reset.js';
import { replacementBank as freshV2 } from './fresh-v2-bank.js';
import { expandedReadingLessons, expandedReadingMocks } from './tripled-20261011/reading.js';
import { expandedListeningLessons, expandedListeningMocks } from './tripled-20261011/listening.js';
import { expandedWritingLessons, expandedWritingMocks } from './tripled-20261011/writing.js';
import { expandedSpeakingLessons, expandedSpeakingMocks } from './tripled-20261011/speaking.js';
import { expandedGrammarLessons, expandedVocabularyBank, expandedPlacementBank } from './tripled-20261011/support.js';

export const bankVersion = 'fresh-20261011-v3';
export const vocabularyBank = [...freshV2.vocabulary, ...expandedVocabularyBank];
export const placementBank = [...freshV2.placementItems, ...expandedPlacementBank];
const levels = ['A2', 'B1', 'B2', 'C1'];
const additions: StoredContent[] = [
  ...expandedReadingLessons, ...expandedListeningLessons, ...expandedWritingLessons,
  ...expandedSpeakingLessons, ...expandedGrammarLessons, ...expandedReadingMocks,
  ...expandedListeningMocks, ...expandedWritingMocks, ...expandedSpeakingMocks,
].map(content => {
  const text = content.sections.map(section => section.text).join(' ').toLowerCase();
  const suitable = vocabularyBank.filter(word => levels.indexOf(word.cefr) <= levels.indexOf(content.cefr));
  const related = suitable.filter(word => text.includes(word.word.toLowerCase()) || content.topic.toLowerCase().includes(word.topic.toLowerCase()));
  const offset = Array.from(content.id).reduce((total, ch) => total + ch.charCodeAt(0), 0) % Math.max(1, suitable.length);
  const fallback = [...suitable.slice(offset), ...suitable.slice(0, offset)];
  return { ...content, vocabularyIds: [...new Set([...related, ...fallback].map(word => word.id))].slice(0, content.format === 'full-mock' ? 12 : 6) };
});
// Keep every v2 object unchanged, including models and its vocabulary links.
// Only new IDs receive links to the expanded vocabulary. Historical banks are
// compatibility/audit fixtures; they are never silently restored at startup.
export const contentBank: StoredContent[] = [...freshV2.content, ...additions];
export const replacementBank: ReplacementBank = {
  version: bankVersion, content: contentBank, vocabulary: vocabularyBank, placementItems: placementBank,
};
