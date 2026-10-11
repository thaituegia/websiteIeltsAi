import { readingLessonsA } from './reading-lessons-a.js';
import { readingLessonsB } from './reading-lessons-b.js';
import { readingMocksA1 } from './reading-mocks-a1.js';
import { readingMocksA2 } from './reading-mocks-a2.js';
import { readingMocksA3 } from './reading-mocks-a3.js';
import { readingMocksA4 } from './reading-mocks-a4.js';
import { readingMocksA5 } from './reading-mocks-a5.js';
import { readingMocksA6 } from './reading-mocks-a6.js';
import { readingMocksG1 } from './reading-mocks-g1.js';
import { readingMocksG2 } from './reading-mocks-g2.js';
import { readingMocksG3 } from './reading-mocks-g3.js';
import { readingMocksG4 } from './reading-mocks-g4.js';
import { readingAdditionalQuestions } from './reading-lesson-additional-questions.js';
import { rootReadingMocks } from './reading-mocks-root.js';
import { buildReadingLesson, buildReadingMock } from './reading-model.js';

export const expandedReadingLessons = [...readingLessonsA, ...readingLessonsB].map((source, index) => buildReadingLesson({ ...source, questions: readingAdditionalQuestions[source.title] ? [...source.questions, readingAdditionalQuestions[source.title]!] : source.questions }, index));
const firstNineReadingMocks = [...readingMocksA1, ...readingMocksA2, ...readingMocksG1, ...readingMocksG2, ...readingMocksA3, ...readingMocksA4, ...readingMocksA5, ...readingMocksG3, ...readingMocksA6].map(buildReadingMock);
export const expandedReadingMocks = [...firstNineReadingMocks, ...rootReadingMocks, buildReadingMock(readingMocksG4[0]!, 11)];
