import type { FreshListeningSource } from '../fresh/listening-advanced-sources.js';
import { lectureEnrichment } from './listening-lecture-enrichment.js';
import { discussionEnrichment } from './listening-discussion-enrichment.js';
import { transactionEnrichment } from './listening-transaction-enrichment.js';
import { orientationEnrichment } from './listening-orientation-enrichment.js';

export type Detail = readonly [label: string, answer: string, reason: string, distractors?: readonly string[]];
export interface ListeningScenario {
  title: string;
  topic: string;
  context: string;
  details: readonly Detail[];
  closing: string;
  band: number;
  style?: FreshListeningSource['style'];
  orientation?: 'map' | 'plan';
  centerLabel?: string;
}
export type ExpandedSource = FreshListeningSource & Pick<ListeningScenario, 'orientation' | 'centerLabel'>;
const count = (text: string): number => text.trim().split(/\s+/u).filter(Boolean).length;

/** The supplied explanations carry the substance; no unrelated text is appended to reach a length. */
export function transaction(s: ListeningScenario, long: boolean): ExpandedSource {
  const speech: [string, string][] = [['Coordinator', `Good morning. You have reached our ${s.topic.toLowerCase()} information service. How can I help you today?`], ['Visitor', s.context]];
  const facts: ExpandedSource['facts'] = [];
  const followups = transactionEnrichment[s.title];
  if (long && (!followups || followups.length !== 5)) throw new Error(`${s.title}: missing original customer follow-ups`);
  for (let i = 0; i < s.details.length; i++) {
    const [label, answer, reason, distractors] = s.details[i]!;
    const monetary = i < 8 && /fee|price|charge|cost|deposit|contribution/iu.test(label) && /^\d+$/u.test(answer);
    const evidence = i < 8 ? `The ${label.toLowerCase()} is ${answer}${monetary ? ' pounds' : ''}.` : answer;
    speech.push(['Visitor', `Could you explain the ${label.toLowerCase()}? ${i === 0 ? 'I would rather check with you than rely on an old advertisement.' : i === 2 ? 'That will affect how I arrange the rest of the day.' : i === 4 ? 'I need to decide what to prepare before I come.' : i === 6 ? 'I want to avoid arriving with something that cannot be used.' : 'I have not used this service before, so I am checking the details.'}`]);
    speech.push(['Coordinator', `${evidence} ${reason}`]);
    if (long && i % 2 === 0) speech.push(['Visitor', followups![Math.floor(i / 2)]!]);
    facts.push([`${label}${monetary ? ' (in pounds)' : ''}`, answer, evidence, distractors ? [...distractors] : undefined]);
  }
  speech.push(['Visitor', s.closing], ['Coordinator', 'I will send the details we have agreed by email. Please check the message rather than making a second reservation, because two requests can look like bookings for separate people. If your circumstances change, reply to the confirmation so the coordinator can see the original arrangements.']);
  return { part: 1, title: s.title, topic: s.topic, band: s.band, speech, facts, style: s.style };
}

export function orientationTalk(s: ListeningScenario, long: boolean): ExpandedSource {
  const speech: [string, string][] = [['Guide', `${s.context} On the plan, north is at the top and the visitor entrance is at the bottom. Walk from that southern entrance to the ${s.centerLabel}. Keep the plan facing the same direction even if you turn your body. The four numbered areas surround this landmark.`]];
  const facts: ExpandedSource['facts'] = [];
  const enrichment = orientationEnrichment[s.title];
  if (long && (!enrichment || enrichment.length !== 2)) throw new Error(`${s.title}: missing independent venue-guide explanation`);
  const directions = ['north-west', 'north-east', 'south-west', 'south-east'];
  const routeNotes = [
    'From the central landmark, follow the branch towards the upper-left part of the plan. It leads directly into the numbered area without taking you through another activity. The top edge remains north while you follow the route.',
    'Return to the central landmark and look across the northern half of the plan. This area occupies the upper-right space. Its connecting path begins from the same centre, so the two northern areas should not be confused with each other.',
    'For this area, look back towards the southern entrance marked at the bottom. The numbered space lies on the western side of that approach. You can return by its own branch rather than crossing through the neighbouring activity area.',
    'The remaining southern area lies across the approach on the eastern side. It has a separate branch from the central landmark. Check the bottom-right position on the plan before following the path, rather than relying only on which area was described last.',
  ];
  for (let i = 0; i < 10; i++) {
    const [label, answer, reason, distractors] = s.details[i]!;
    const evidence = i < 4 ? `The ${answer} is ${directions[i]} of the ${s.centerLabel}.` : i < 8 ? `For ${label.toLowerCase()}, remember this instruction: ${answer}.` : answer;
    speech.push(['Guide', `${i < 4 ? `Now look at the ${directions[i]} area on your plan. ` : ''}${evidence} ${reason}${long && i < 4 ? ` ${routeNotes[i]}` : ''}`]);
    if (long && (i === 4 || i === 7)) speech.push(['Guide', enrichment![i === 4 ? 0 : 1]!]);
    facts.push([i < 4 ? `Label area ${i + 1} on the visitor ${s.orientation}.` : label, answer, evidence, distractors ? [...distractors] : undefined]);
  }
  speech.push(['Guide', `${s.closing} Before setting off, find the southern entrance again and check how your chosen area connects with the central landmark. If you lose your place on the plan, return to that point rather than reversing the north and south labels. Staff will describe a suitable route if a marked path is difficult for you.`]);
  return { part: 2, title: s.title, topic: s.topic, band: s.band, speech, facts, orientation: s.orientation, centerLabel: s.centerLabel };
}

export function discussion(s: ListeningScenario, long: boolean): ExpandedSource {
  const speech: [string, string][] = [['Tutor', s.context], ['Researcher A', 'We have separated the decisions we can support with evidence from suggestions that would need another study. Our proposal explains the limits of the sample as well as what we hope to learn.']];
  const facts: ExpandedSource['facts'] = [];
  const enrichment = discussionEnrichment[s.title];
  if (long && (!enrichment || enrichment.length !== 5)) throw new Error(`${s.title}: missing original discussion exchanges`);
  for (let i = 0; i < 10; i++) {
    const [label, answer, reason, distractors] = s.details[i]!;
    const evidence = i < 4 ? answer : i < 6 ? `We agreed on ${answer}.` : i < 9 ? `Researcher ${['A', 'B', 'C'][i - 6]} will ${answer}.` : `We need ${answer}.`;
    if (i === 4 || i === 5) speech.push([i === 4 ? 'Researcher A' : 'Researcher B', `${evidence} ${reason}`]);
    else {
      speech.push(['Tutor', `${i < 4 ? 'What have you decided about' : 'Can you clarify'} ${label.toLowerCase()}?`]);
      speech.push([i % 2 ? 'Researcher B' : 'Researcher A', `${evidence} ${reason}`]);
    }
    if (long && i % 2 === 1) speech.push([Math.floor(i / 2) % 2 ? 'Researcher B' : 'Researcher A', enrichment![Math.floor(i / 2)]!]);
    facts.push([i === 5 ? s.details[4]![0] : label, answer, evidence, distractors ? [...distractors] : undefined]);
  }
  speech.push(['Tutor', `${s.closing} For the introduction, explain the connection between your first decision and the next step. Your focus is ${s.details[0]![1].replace(/\.$/u, '')}, while the evidence you propose to use involves ${s.details[1]![1].replace(/\.$/u, '').toLowerCase()}. Those are related choices, but neither should be presented as a finding before you have collected the observations. Make that boundary clear to the audience.`]);
  return { part: 3, title: s.title, topic: s.topic, band: s.band, speech, facts, style: 'short' };
}

export function lecture(s: ListeningScenario, long: boolean): ExpandedSource {
  const speech: [string, string][] = [['Lecturer', s.context]];
  const facts: ExpandedSource['facts'] = [];
  const enrichment = lectureEnrichment[s.title];
  if (!enrichment || enrichment.length !== 5) throw new Error(`${s.title}: missing independent worked examples`);
  for (let i = 0; i < 10; i++) {
    const [label, answer, reason] = s.details[i]!;
    const evidence = `${label} is${s.style === 'flow' && /main stage/iu.test(label) ? ' to' : ''} ${answer}.`;
    speech.push(['Lecturer', `${evidence} ${reason}`]);
    if (i % 2 === 0) speech.push(['Lecturer', enrichment[Math.floor(i / 2)]!]);
    facts.push([label, answer, evidence]);
  }
  speech.push(['Lecturer', s.closing]);
  return { part: 4, title: s.title, topic: s.topic, band: s.band, speech, facts, style: s.style ?? 'note' };
}

export function assertSource(s: ExpandedSource, long: boolean): void {
  const length = count(s.speech.map(([, text]) => text).join(' '));
  if (length < (long ? 650 : 400) || length > (long ? 850 : 700)) throw new Error(`${s.title}: ${length} words`);
  if (s.facts.length !== 10) throw new Error(`${s.title}: missing authored details`);
}
