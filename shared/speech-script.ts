import type { ContentSection } from "./types";

export interface SpeechTurn {
  /** A character belongs to its section, rather than every similarly named role. */
  speakerId: string;
  speaker: string;
  accent: "british" | "american" | "australian";
  text: string;
  sectionIndex: number;
}

// These are authored role labels, not names or learner data. Keeping this small
// lexicon here avoids importing the server's question/answer banks in the client.
const roleLabels = `Administrator|Adviser|Agent|Analyst|Announcement|Announcer|Aquarist|Aquarium assistant|Architect|Archivist|Art officer|Artist|Assistant|Athlete|Baker|Booking clerk|Bookseller|Borrower|Brother|Building manager|Bus driver|Café owner|Caller|Candidate|Careers researcher|Caretaker|Cashier|Chef|Child|Choir leader|Cleaner|Clerk|Client|Clinic analyst|Club secretary|Coach|Colleague|Conductor|Consultation officer|Cook|Coordinator|Councillor|Curator|Customer|Cyclist|Daughter|Delegate|Delivery worker|Dental receptionist|Designer|Director|Dog owner|Donor|Driver|Ecologist|Economist|Editor|Emergency planner|Employee|Engineer|Facilitator|Farmer|Father|Florist|Food-bank volunteer|Friend|Gardener|Grandchild|Grandfather|Guard|Guest|Guide|Head teacher|Hiker|Historian|Host|Instructor|Interviewer|Journal editor|Judge|Laboratory director|Laundry worker|Leader|Learner|Lecturer|Librarian|Listener|Manager|Member|Mother|Musician|Neighbour|New member|Observer|Officer|Organiser|Owner|Panel chair|Parent|Park ranger|Parking attendant|Participant|Partner|Passenger|Patient|Philosopher|Photographer|Piano teacher|Planner|Player|Presenter|Producer|Pupil|Radio host|Ranger|Receptionist|Researcher|Resident|Restaurant manager|Restorer|Scientist|Seller|Server|Shop assistant|Shopkeeper|Shopper|Singer|Sister|Son|Staff member|Student|Supervisor|Teacher|Technician|Tenant|Tester|Ticket seller|Trader|Trainee|Trainer|Tutor|Visitor|Volunteer|Waiter|Water officer|Weather presenter|Worker|Examiner|Narrator`;

function normalizeSpeaker(speaker: string): string {
  return speaker.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

const roles = new Set(roleLabels.split("|").map(normalizeSpeaker));
const headings = new Set(
  "note|notes|reminder|warning|important|example|examples|answer|answers|question|questions|section|part|topic|title|summary|conclusion|status|outcome|result|results|instruction|instructions|time|url|website|http|https".split("|"),
);

interface Label {
  start: number;
  end: number;
  speaker: string;
  normalized: string;
  lineStart: boolean;
  explicit: boolean;
}

function explicitSpeaker(label: string): boolean {
  return roles.has(normalizeSpeaker(label)) ||
    /^(?:speaker(?:\s*#\s*[\p{L}\p{N}]+|\s*\d+|\s+[\p{L}][\p{L}\p{M}’'-]*(?:\s+[\p{L}][\p{L}\p{M}’'-]*){0,2})|(?:student|researcher|candidate)\s+(?:[A-Z]|\d+))$/iu.test(label) ||
    /^(?:Dr\.?|Professor|Prof\.?|Mr\.?|Mrs\.?|Ms\.?)\s+[\p{L}][\p{L}\p{M}’' -]+$/iu.test(label);
}

function bareName(label: string): boolean {
  return !headings.has(normalizeSpeaker(label)) &&
    /^[\p{Lu}][\p{L}\p{M}’'-]+(?:\s+[\p{Lu}][\p{L}\p{M}’'-]+){0,2}$/u.test(label);
}

/** Labels inside a spoken quotation remain spoken words. */
function quotedPositions(text: string, positions: number[]): Set<number> {
  const quoted = new Set<number>();
  let cursor = 0;
  let double = false;
  let single = false;
  let curlyDouble = 0;
  let curlySingle = 0;
  for (const position of positions) {
    while (cursor < position) {
      const character = text[cursor];
      const wordBefore = /[\p{L}\p{N}]/u.test(text[cursor - 1] ?? "");
      const wordAfter = /[\p{L}\p{N}]/u.test(text[cursor + 1] ?? "");
      let backslashes = 0;
      for (let before = cursor - 1; before >= 0 && text[before] === "\\"; before--) backslashes++;
      if (backslashes % 2 === 0) {
        if (character === '"') double = !double;
        else if (character === "'" && (single ? !wordAfter : !wordBefore)) single = !single;
        else if (character === "“") curlyDouble++;
        else if (character === "”") curlyDouble = Math.max(0, curlyDouble - 1);
        else if (character === "‘" && !wordBefore) curlySingle++;
        else if (character === "’" && curlySingle > 0 && !wordAfter) curlySingle--;
      }
      cursor++;
    }
    if (double || single || curlyDouble || curlySingle) quoted.add(position);
  }
  return quoted;
}

function flatLabels(text: string): Label[] {
  // A label begins a line or follows sentence punctuation. Numeric clocks and
  // URLs do not fit the label shape; other colon clauses need stronger evidence.
  const pattern = /(?:^[\t ]*|(?<=[.!?]["'”’)\]]?)[\t ]+)((?:(?:Dr|Prof|Mr|Mrs|Ms)\.\s+)?[\p{L}][\p{L}\p{M}\p{N} ’'()/#-]{0,59}):[\t ]*/gmu;
  const candidates = [...text.matchAll(pattern)].map(match => {
    const start = match.index!;
    const speaker = match[1]!.trim();
    return {
      start, end: start + match[0].length, speaker,
      normalized: normalizeSpeaker(speaker),
      lineStart: /^[\t ]*$/u.test(text.slice(text.lastIndexOf("\n", start - 1) + 1, start)),
      explicit: explicitSpeaker(speaker),
    };
  });
  const quoted = quotedPositions(text, candidates.map(label => label.start));
  const outside = candidates.filter(label => !quoted.has(label.start));
  const names = outside.filter(label => !label.explicit && bareName(label.speaker));
  const nameCounts = new Map<string, number>();
  for (const name of names) nameCounts.set(name.normalized, (nameCounts.get(name.normalized) ?? 0) + 1);
  // A bare unknown name alone is ambiguous with a heading. A repeated name in
  // an exchange establishes identities; structured dialogue needs no inference.
  const namedExchange = nameCounts.size > 1 && [...nameCounts.values()].some(count => count > 1);
  const accepted: Label[] = [];
  for (const label of outside) {
    if (!label.explicit && !(namedExchange && nameCounts.has(label.normalized))) continue;
    if (!label.lineStart && !accepted.length) continue;
    accepted.push(label);
  }
  return accepted;
}

function spokenDialogueText(text: string, speaker: string): string {
  // Only the actual character's own unquoted prefix can be redundant metadata.
  // A quotation or another name/colon clause is part of the spoken body.
  const prefix = /^[\t ]*([^:\r\n]+):[\t ]*/u.exec(text);
  return prefix && normalizeSpeaker(prefix[1]!) === normalizeSpeaker(speaker)
    ? text.slice(prefix[0].length)
    : text;
}

/** Build spoken turns only; titles and transcript labels are not narration. */
export function buildSpeechScript(sections: ContentSection[]): SpeechTurn[] {
  return sections.flatMap((section, sectionIndex) => {
    const identity = (speaker: string) => `section:${sectionIndex}:speaker:${normalizeSpeaker(speaker)}`;
    const narrator = (text: string): SpeechTurn => ({
      speakerId: `section:${sectionIndex}:narrator`, speaker: "Narrator",
      accent: "british", text, sectionIndex,
    });
    if (section.dialogue?.length) {
      return section.dialogue.map(line => ({
        speakerId: identity(line.speaker), speaker: line.speaker.trim(),
        accent: line.accent, text: spokenDialogueText(line.text, line.speaker), sectionIndex,
      })).filter(line => line.text.trim());
    }
    const labels = flatLabels(section.text);
    if (!labels.length) return section.text.trim() ? [narrator(section.text)] : [];
    const turns: SpeechTurn[] = [];
    const prefix = section.text.slice(0, labels[0]!.start).trim();
    if (prefix) turns.push(narrator(prefix));
    labels.forEach((label, index) => {
      const text = section.text.slice(label.end, labels[index + 1]?.start ?? section.text.length).trim();
      if (!text) return;
      turns.push({
        speakerId: identity(label.speaker), speaker: label.speaker,
        // Flat scripts have no authored accent metadata; identities distinguish voices.
        accent: "british", text, sectionIndex,
      });
    });
    return turns;
  });
}

/** Slice existing text, retaining separators and character identity exactly. */
export function chunkSpeechTurns(turns: SpeechTurn[], maxCharacters = 3000): SpeechTurn[] {
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 1)
    throw new RangeError("Speech chunk length must be a positive integer.");
  return turns.flatMap(turn => {
    const chunks: SpeechTurn[] = [];
    let cursor = 0;
    while (turn.text.length - cursor > maxCharacters) {
      const window = turn.text.slice(cursor, cursor + maxCharacters);
      const sentenceEnds = [...window.matchAll(/[.!?]["'”’)\]]?(?:\s+|$)/gu)];
      const wordEnds = [...window.matchAll(/\s+/gu)];
      const boundary = sentenceEnds.at(-1) ?? wordEnds.at(-1);
      let length = boundary ? boundary.index! + boundary[0].length : maxCharacters;
      const before = turn.text.charCodeAt(cursor + length - 1);
      const after = turn.text.charCodeAt(cursor + length);
      if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) length--;
      if (!length) throw new RangeError("Speech chunk length cannot fit a Unicode character.");
      chunks.push({ ...turn, text: turn.text.slice(cursor, cursor + length) });
      cursor += length;
    }
    chunks.push({ ...turn, text: turn.text.slice(cursor) });
    return chunks;
  });
}
