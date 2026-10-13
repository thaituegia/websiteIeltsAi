import assert from "node:assert/strict";
import test from "node:test";
import { contentBank, placementBank } from "../server/data/index.js";
import { buildSpeechScript, chunkSpeechTurns, type SpeechTurn } from "../shared/speech-script.js";
import type { ContentSection } from "../shared/types.js";

const section = (text: string, extra: Partial<ContentSection> = {}): ContentSection => ({
  id: "synthetic-section", title: "This title must never be spoken", text, ...extra,
});
const normalizeWhitespace = (text: string) => text.replace(/\s+/gu, " ").trim();
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const nested of Object.values(value)) freeze(nested);
  }
  return value;
}

test("all active Listening dialogue bodies remain verbatim and inputs stay unchanged", () => {
  const listening = contentBank.filter(content => content.skill === "listening");
  assert.equal(listening.filter(content => content.format === "lesson").length, 72);
  assert.equal(listening.filter(content => content.format === "full-mock").length, 30);
  let sectionCount = 0;
  let turnCount = 0;
  for (const content of listening) {
    const sections = freeze(structuredClone(content.sections));
    const before = JSON.stringify(sections);
    const turns = buildSpeechScript(sections);
    assert.deepEqual(turns.map(turn => turn.text), sections.flatMap(part => part.dialogue!.map(line => line.text)), content.id);
    sections.forEach((part, sectionIndex) => {
      const actual = turns.filter(turn => turn.sectionIndex === sectionIndex);
      assert.deepEqual(actual.map(turn => [turn.speaker, turn.accent]), part.dialogue!.map(line => [line.speaker, line.accent]));
      for (const turn of actual) assert.ok(turn.speakerId.startsWith(`section:${sectionIndex}:speaker:`));
    });
    assert.equal(JSON.stringify(sections), before, content.id);
    sectionCount += sections.length;
    turnCount += turns.length;
  }
  assert.equal(sectionCount, 192);
  assert.equal(turnCount, 3389);
});

test("all active Placement clips reconstruct exactly apart from boundary whitespace", () => {
  const listening = placementBank.filter(item => item.skill === "listening");
  assert.equal(listening.length, 240);
  let turnCount = 0;
  let inlineClips = 0;
  for (const item of listening) {
    const input = freeze([section(item.text, { id: item.id })]);
    const before = JSON.stringify(input);
    const turns = buildSpeechScript(input);
    assert.ok(turns.every(turn => turn.speakerId.includes(":speaker:")), item.id);
    assert.equal(
      normalizeWhitespace(turns.map(turn => `${turn.speaker}: ${turn.text}`).join(" ")),
      normalizeWhitespace(item.text),
      item.id,
    );
    assert.equal(JSON.stringify(input), before, item.id);
    turnCount += turns.length;
    if (!item.text.includes("\n") && turns.length > 1) inlineClips++;
  }
  assert.equal(turnCount, 728);
  assert.equal(inlineClips, 40);
});

test("structured bodies, including literal label-looking words, are not stripped", () => {
  const text = "  Teacher: That is a spoken quotation. One more question: can I call at 18:30?\nI am Priya Selwyn.  ";
  const turns = buildSpeechScript([section("ignored transcript", {
    dialogue: [{ speaker: "Priya", accent: "australian", text }],
  })]);
  assert.equal(turns.length, 1);
  assert.equal(turns[0]!.text, text);
  assert.equal(turns[0]!.speaker, "Priya");
  assert.equal(turns[0]!.accent, "australian");
});

test("only an exact unquoted structured speaker prefix is removed", () => {
  const bodies = [
    "  TEACHER : One more question: can I call at 18:30?",
    '"Teacher: Wait here." That is the quotation.',
    "“Teacher: Wait here.” That is the quotation.",
    "Student: This is another character's spoken name.",
    "I am Teacher Smith. My website is https://example.com:8443/a.",
  ];
  const input = freeze([section("ignored", { dialogue: bodies.map(text => ({ speaker: "Teacher", accent: "british", text })) })]);
  const before = JSON.stringify(input);
  assert.deepEqual(buildSpeechScript(input).map(turn => turn.text), [
    "One more question: can I call at 18:30?", ...bodies.slice(1),
  ]);
  assert.equal(JSON.stringify(input), before);
});

test("flat roles retain punctuation, continuation lines, Unicode and self-introductions", () => {
  const turns = buildSpeechScript([section(
    "Café owner: Sam speaking. I am Priya Selwyn.\r\nKeep this continuation.\r\n\r\n" +
    "Food-bank volunteer: Can I call at 18:30? Piano teacher: Yes! Café owner: Thanks.",
  )]);
  assert.deepEqual(turns.map(turn => turn.speaker), ["Café owner", "Food-bank volunteer", "Piano teacher", "Café owner"]);
  assert.deepEqual(turns.map(turn => turn.text), [
    "Sam speaking. I am Priya Selwyn.\r\nKeep this continuation.",
    "Can I call at 18:30?", "Yes!", "Thanks.",
  ]);
  assert.equal(turns[0]!.speakerId, turns[3]!.speakerId);
  assert.equal(turns[0]!.accent, turns[3]!.accent);
  assert.ok(turns.every(turn => turn.accent === "british"));
});

test("ordinary colons, URLs and quoted role labels stay spoken", () => {
  const body = 'One more question: can my father use https://example.com:8443/a:b at 18:30? ' +
    'The poster reads “Wait. Clerk: take a ticket.” She said "Stop. Teacher: wait here." ' +
    "Then follow this instruction: keep left.";
  const turns = buildSpeechScript([section(`Teacher: ${body}\nStudent: Understood.`)]);
  assert.deepEqual(turns.map(turn => turn.text), [body, "Understood."]);
  const quoted = "He said 'I don't know. Clerk: bring the form' yesterday.";
  assert.deepEqual(
    buildSpeechScript([section(`Teacher: ${quoted} Student: All right.`)]).map(turn => turn.text),
    [quoted, "All right."],
  );
  assert.deepEqual(
    buildSpeechScript([section("Teacher: She said “Stop.” Student: Understood.")]).map(turn => turn.text),
    ["She said “Stop.”", "Understood."],
  );
  const narration = "Reminder: Bring https://example.com:8443/a at 18:30.\nNote: Read the instructions: carefully.";
  assert.deepEqual(buildSpeechScript([section(narration)]).map(turn => turn.text), [narration]);
  assert.deepEqual(
    buildSpeechScript([section("Teacher: First.\nSchedule: Tuesday at 18:30.\nTeacher: Second.")]).map(turn => turn.text),
    ["First.\nSchedule: Tuesday at 18:30.", "Second."],
  );
  for (const text of ["Speakerphone: This device works.", "Student summary: More practice.", "PlacementTeacher: Class begins at 09:30."])
    assert.deepEqual(buildSpeechScript([section(text)]).map(turn => turn.text), [text]);
});

test("numbered, titled and established named speakers retain separate identities", () => {
  const numbered = buildSpeechScript([section("Speaker #1: Sam speaking. Speaker #2: I am Priya. Speaker #1: Welcome.")]);
  assert.deepEqual(numbered.map(turn => turn.speaker), ["Speaker #1", "Speaker #2", "Speaker #1"]);
  assert.equal(numbered[0]!.speakerId, numbered[2]!.speakerId);
  const named = buildSpeechScript([section("Alice: Hello. Bob: Hi! Alice: Shall we begin?")]);
  assert.deepEqual(named.map(turn => turn.text), ["Hello.", "Hi!", "Shall we begin?"]);
  const titled = buildSpeechScript([section("Dr. Hsu: Begin at 10:15.\nProfessor Lim: Certainly.")]);
  assert.deepEqual(titled.map(turn => turn.speaker), ["Dr. Hsu", "Professor Lim"]);
});

test("identities normalize within sections, stay section scoped, and distinguish narration", () => {
  const turns = buildSpeechScript([
    section(" Teacher: First.\nteacher: Second.\nTEACHER: Third."),
    section("Teacher: Another character in another section."),
    section("Spoken narration."),
    section("Narrator: An explicitly labelled character."),
  ]);
  assert.equal(turns[0]!.speakerId, turns[1]!.speakerId);
  assert.equal(turns[1]!.speakerId, turns[2]!.speakerId);
  assert.notEqual(turns[0]!.speakerId, turns[3]!.speakerId);
  assert.match(turns[4]!.speakerId, /:narrator$/u);
  assert.match(turns[5]!.speakerId, /:speaker:narrator$/u);
  assert.ok(turns.every(turn => !turn.text.includes("This title must never")));
  assert.deepEqual(buildSpeechScript([section(" \n\t")] ), []);
});

test("chunks preserve every character, speaker attribute and order without broken surrogate pairs", () => {
  const texts = [
    "  First sentence.\r\n\tSecond  sentence?  " + "a long phrase with spaces ".repeat(8),
    "x".repeat(80) + "😀" + "y".repeat(60),
    "a".repeat(30) + "😀 next sentence! trailing spaces  ",
    "\t".repeat(40) + "word",
  ];
  const turns: SpeechTurn[] = texts.map((text, index) => ({
    speakerId: `character:${index}`, speaker: `Character ${index}`,
    accent: "british", text, sectionIndex: index,
  }));
  const before = JSON.stringify(turns);
  const chunks = chunkSpeechTurns(freeze(turns), 31);
  for (const turn of turns) {
    const actual = chunks.filter(chunk => chunk.speakerId === turn.speakerId);
    assert.equal(actual.map(chunk => chunk.text).join(""), turn.text);
    for (const chunk of actual) {
      assert.ok(chunk.text.length <= 31);
      assert.deepEqual({ ...chunk, text: "" }, { ...turn, text: "" });
      assert.doesNotMatch(chunk.text, /^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u);
    }
  }
  assert.equal(JSON.stringify(turns), before);
  assert.deepEqual(chunkSpeechTurns([]), []);
  for (const invalid of [0, -1, NaN, Infinity, 1.5]) assert.throws(() => chunkSpeechTurns(turns, invalid), RangeError);
});
