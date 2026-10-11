import type { ContentSection, StoredContent } from '../../../shared/types.js';

export interface NewSpeakingPack {
  topic: string;
  part1: string[];
  cue: string;
  points: [string, string, string, string];
  part3: string[];
}

export const newSpeakingPacks: NewSpeakingPack[] = [
  {
    topic: 'Learning beyond your main course',
    part1: ['Where do you study when you need to understand something difficult?', 'Do you usually make notes while studying?', 'What helps you return to studying after a break?', 'Do you enjoy lessons that involve a practical task?', 'How do you choose something new to learn?', 'Would you join an evening class with a friend?'],
    cue: 'Describe a short course outside your main studies that you found worthwhile.',
    points: ['what the course covered', 'why you enrolled', 'what you did during the course', 'and explain how it was useful afterwards'],
    part3: ['Why might adults choose to study a subject unrelated to their job?', 'How should a college decide which evening classes to offer?', 'What can prevent people with caring responsibilities from attending courses?', 'Is it useful to assess every activity in an adult education course?', 'How can employers encourage learning without controlling employees’ interests?', 'What might be lost if all adult classes moved online?'],
  },
  {
    topic: 'Choosing lower-impact journeys',
    part1: ['When would you choose to walk instead of taking a vehicle?', 'Do you notice how busy the roads are at different times?', 'What makes waiting at a bus stop comfortable?', 'Have you changed the way you make a regular journey?', 'Do you carry shopping in a bag or a backpack?', 'Would you like to try travelling by tram?'],
    cue: 'Describe a decision to make a journey in a way that was better for the environment.',
    points: ['where you needed to go', 'which travel options you considered', 'what arrangement you finally made', 'and explain what you learned from making that choice'],
    part3: ['Why can environmental intentions be difficult to translate into travel choices?', 'Should public transport improvements come before restrictions on cars?', 'How can planners include people whose work starts before normal bus services?', 'What makes an environmental travel campaign persuasive rather than irritating?', 'Could cheaper public transport increase journeys rather than replace car trips?', 'Who should bear the cost of helping a town change its transport habits?'],
  },
  {
    topic: 'Health information and everyday choices',
    part1: ['How do you remember to drink enough water during a busy day?', 'Do you prefer a predictable bedtime?', 'Which everyday habit would you like to improve?', 'Do people in your household discuss healthy meals?', 'What do you do to rest after concentrating for a long time?', 'Would you find it useful to keep a simple health diary?'],
    cue: 'Describe a time when you checked health information before changing an everyday habit.',
    points: ['what change you were considering', 'where the information came from', 'how you checked or compared it', 'and explain how it influenced your decision'],
    part3: ['Why do simple health claims attract attention online?', 'What should distinguish general wellbeing advice from individual medical advice?', 'How can public-health information acknowledge uncertainty without confusing people?', 'Should companies be allowed to use health-related claims when advertising ordinary food?', 'What helps health advice reach people with limited reading skills?', 'How can a community encourage healthier habits without judging individuals?'],
  },
  {
    topic: 'Digital services and working life',
    part1: ['How often do you fill in a form online?', 'Do you save copies of important digital documents?', 'What makes an app easy for you to use?', 'Have you ever chosen to speak to a person instead of using an automated service?', 'Do you prefer reminders by email or by text message?', 'What online task would you like to become more confident about?'],
    cue: 'Describe an occasion when you solved a work or study problem using a digital service.',
    points: ['what problem you needed to solve', 'which service you used', 'what steps you took', 'and explain its advantages and any limitations you noticed'],
    part3: ['Which kinds of workplace decisions should remain with a person rather than software?', 'How can a digital service earn the trust of people using it for the first time?', 'Who should help when an essential online form is inaccessible?', 'Can automation make a job more interesting as well as remove some tasks?', 'What risks arise when workers use several disconnected digital systems?', 'How should organisations judge whether a new system has actually saved time?'],
  },
];

function section(pack: NewSpeakingPack, part: 1 | 2 | 3, id: string): ContentSection {
  const numbered = (questions: string[]) => questions.map((question, i) => `${i + 1}. ${question}`).join('\n');
  if (part === 1) return { id, title: 'Part 1 · Introduction and interview', text: numbered(pack.part1), instructions: 'Answer six familiar interview questions naturally. In a complete IELTS interview, Part 1 lasts 4–5 minutes.' };
  if (part === 2) return { id, title: 'Part 2 · Individual long turn', text: pack.cue, cuePoints: pack.points, instructions: 'Prepare for one minute, then speak for one to two minutes. Use the four prompts to organise a connected account.' };
  return { id, title: 'Part 3 · Two-way discussion', text: numbered(pack.part3), instructions: 'Develop your answers to these broader questions with reasons, examples and appropriate qualifications. Part 3 lasts 4–5 minutes.' };
}

export const newSpeakingMocks: StoredContent[] = newSpeakingPacks.map((pack, i) => {
  const id = `fresh-exam-s-${String(i + 1).padStart(2, '0')}`;
  const band = [6, 7, 7.5, 8][i]!;
  const cefr = band >= 7.5 ? 'C1' as const : 'B2' as const;
  const generatedAt = '2026-10-11T07:00:00.000Z';
  return {
    id, title: `Speaking · Practice interview ${i + 1} · ${pack.topic}`, skill: 'speaking', topic: pack.topic,
    description: 'An original three-part, 11–14-minute IELTS-style interview. Topic-specific illustrative responses are available only after submission.',
    band, cefr, testType: 'both', durationMinutes: 14, format: 'full-mock',
    questions: [], vocabularyIds: [], sections: ([1, 2, 3] as const).map(part => section(pack, part, `${id}-part${part}`)),
    tags: ['exam-bank-20261011', 'independent-mock', 'three-parts'], source: 'ai', quality: 'ai-unreviewed', createdAt: generatedAt,
    objectives: ['Give a direct answer and develop it with relevant reasons and examples.', 'Speak naturally and distinguish personal experiences from general claims.'],
    estimatedDifficulty: { band, cefr, basis: 'Estimated response-development target. Interview topics are IELTS-style; labels are not examiner-calibrated question difficulty or guaranteed scores.' },
    provenance: { method: 'ai-assisted', version: 'exam-bank-20261011', generatedAt },
    review: { status: 'unreviewed', checks: [], limitations: ['AI-authored practice, not official IELTS questions. Reference speakers are illustrative and responses have no unique correct wording or examiner-scored band.'] },
    errorTypes: ['underdeveloped-response', 'memorised-language', 'unclear-reference', 'lexical-precision'],
  };
});
