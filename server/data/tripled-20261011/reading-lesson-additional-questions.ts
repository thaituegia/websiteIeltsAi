import { choice, rq, short, tf, type FreshReadingQuestion } from '../fresh/reading-model.js';

/** Additional assessed details keep question volume at least three times the baseline without duplicating an existing task. */
export const readingAdditionalQuestions: Record<string, FreshReadingQuestion> = {
  'Leaving a bag at the reading centre': short('What kind of water container is allowed in the reading room?', 'closed water bottle', 'a closed water bottle is allowed.', 3),
  'Borrowing an instrument for music class': tf('The project owns the loan instruments.', 'TRUE', 'The instruments belong to the project, not to the teacher.'),
  'Making a collection of pressed leaves': short('Which two collection details are written on a label?', 'place and date', 'writes the place and date of collection', 3),
  'Joining a beginner swimming session': short('On which weekday does the beginner session take place?', 'Tuesday', 'every Tuesday evening.'),
  'Finding the best place for a class display': tf('The volunteers read from marks at the same distance from each card.', 'TRUE', 'volunteers stood on a mark two metres from each card'),
  'The travelling health advice van': short('By what time in the morning is a weather-related location change announced?', 'eight', 'announces this change by eight in the morning.'),
  'What settles in a jar of soil?': tf('The starting amount of soil is kept equal between jars.', 'TRUE', 'put equal amounts of soil into clear jars.'),
  'Cooking in the hostel’s shared kitchen': short('At what time in the evening does the kitchen close?', 'ten', 'until ten at night.'),
  'A railway ticket tells only part of a journey': short('Which printed word helped explain a change in fare arrangements?', 'return', 'One printed ticket included the word return'),
  'Receiving deliveries at a furniture store': short('Where are incoming goods checked before entering the showroom?', 'covered yard', 'it is checked in the covered yard.'),
  'A bridge governed by the tide': short('What did the team place beside the lowest part of the causeway?', 'painted markers', 'placed painted markers beside the lowest part of the causeway.'),
  'Donating a recorded family story': choice('What helps staff catalogue a recording in a language other than English?', 'A short description in English', 'a short description in English helps staff decide where they belong in the catalogue.', ['A promise that the donor owns the recording device', 'A likely date supplied without qualification', 'Permission to remove pauses from the untouched original']),
  'Drying leaves for a small tea business': short('What type of storage vessel protects the dried leaves?', 'sealed containers', 'Dried leaves are stored in sealed containers'),
  'Claiming an object left on a train': short('For how long are ordinary lost items retained?', 'three months', 'Ordinary items are kept for three months.'),
  'Postcards from a changing migration route': rq('sentence-completion', 'For a more comparable set, Imani chose observers recording regular ________.', 'daily observation', 'regular daily observation.'),
  'Choosing a placement in a small company': tf('The placements differ in the skills and activities they emphasise.', 'TRUE', 'Each placement involves supervised work, but its focus differs.'),
  'Temperature above a painted playground': short('Which weather variable could move air across the two test areas?', 'wind', 'A separate weather station measured wind, which could carry air across the boundary between the areas.'),
  'Renting tools through a neighbourhood association': short('What consumable example must be purchased separately?', 'sanding sheets', 'Consumable materials such as sanding sheets are bought separately.'),
  'Listening notes in an electronic textbook': choice('How did the college assess understanding around use of the notes?', 'It compared written explanations made before and after their use', "compared students' written explanations before and after using the notes.", ['It counted plays and treated that count as a complete measure', 'It removed the written explanation task from every course', 'It assumed that all listening happened without other tasks']),
  'Handing over an allergy order at a café': short('Where does the cook prepare an order after suitable conditions have been agreed?', 'designated preparation area', 'the cook uses the designated preparation area', 3),
  'Why old roofs have different shapes': tf('Drainage details were recorded even for buildings in the drier valley.', 'TRUE', 'Surveyors recorded drainage details because even a dry region could experience sudden storms.'),
  'Returning cups at an outdoor festival': rq('sentence-completion', 'After sales end, return points remain staffed for ________.', 'thirty minutes', 'remain staffed for thirty minutes after drink sales end.'),
  'Measuring snow without counting a drift': short('Which type of cleared area should contributors avoid when taking snow readings?', 'paths', 'They avoided areas cleared for paths or compressed by regular walking.'),
  'Taking paid study leave': choice('Who examines whether staffing can support a study-leave request?', 'The line manager', 'A line manager considers staffing', ['The course provider alone', 'An employee’s presentation audience', 'The assessor marking the final examination']),
};
