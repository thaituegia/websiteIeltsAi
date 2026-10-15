/** Clock answers only: this is deliberately not a general number/synonym matcher. */
interface ClockTime {
  hour: number;
  minute: number;
  /** A 24-hour value, noon/midnight or an explicit day period fixes AM/PM. */
  periodKnown: boolean;
  /** Bare hours and decimal-looking numbers need a clock cue in the question. */
  intrinsic: boolean;
}

const units = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen",
];
const tens = ["", "", "twenty", "thirty", "forty", "fifty"];
function numberWords(value: number): string {
  return value < 20 ? units[value] : `${tens[Math.floor(value / 10)]}${value % 10 ? ` ${units[value % 10]}` : ""}`;
}
function integer(value: string): number | null {
  if (/^\d{1,2}$/u.test(value)) return Number(value);
  const basic = units.indexOf(value);
  if (basic >= 0) return basic;
  for (let decade = 2; decade <= 5; decade++) {
    if (value === tens[decade]) return decade * 10;
    const prefix = `${tens[decade]} `;
    if (value.startsWith(prefix)) {
      const unit = units.indexOf(value.slice(prefix.length));
      if (unit >= 1 && unit <= 9) return decade * 10 + unit;
    }
  }
  return null;
}

type DayPeriod = "am" | "pm" | "night";
function hourValue(value: string, period?: DayPeriod): { hour: number; known: boolean } | null {
  if (value === "noon" || value === "midday" || value === "midnight")
    return period ? null : { hour: value === "midnight" ? 0 : 12, known: true };
  const hour = integer(value);
  if (hour === null || hour < 0 || hour > 23) return null;
  if (period) {
    if (hour > 12 || (hour === 0 && period === "pm")) return null;
    const resolved = period === "night" ? (hour >= 6 && hour < 12 ? "pm" : "am") : period;
    return { hour: hour % 12 + (resolved === "pm" ? 12 : 0), known: true };
  }
  return { hour, known: hour === 0 || hour > 12 };
}

function parseClock(value: string): ClockTime | null {
  if (value.length > 100) return null;
  let text = value.normalize("NFKC").trim().toLowerCase()
    .replace(/[’‘]/gu, "'")
    .replace(/(?<=[a-z])-(?=[a-z])/gu, " ")
    .replace(/\s+/gu, " ");
  if (!text || text.split(" ").length > 12) return null;
  // A single final sentence stop is harmless; other punctuation stays significant.
  text = text.replace(/\.$/u, "").replace(/^at /u, "");
  let period: DayPeriod | undefined;
  const suffix = text.match(/(?:\s*([ap])\.?m\.?|\s+in the (morning|afternoon|evening)|\s+at night)$/u);
  if (suffix) {
    period = suffix[1] ? (suffix[1] === "a" ? "am" : "pm")
      : suffix[2] ? (suffix[2] === "morning" ? "am" : "pm") : "night";
    text = text.slice(0, suffix.index).trim();
  }
  const clock = (hour: { hour: number; known: boolean } | null, minute: number, intrinsic: boolean): ClockTime | null =>
    hour && minute >= 0 && minute < 60
      ? { hour: hour.hour, minute, periodKnown: hour.known, intrinsic: intrinsic || period !== undefined }
      : null;

  const namedTwelve = text.match(/^(?:12|twelve) (noon|midday|midnight)$/u);
  if (namedTwelve) return clock(hourValue(namedTwelve[1], period), 0, true);

  const digits = text.match(/^(\d{1,2})([:.])(\d{2})$/u);
  if (digits) return clock(hourValue(digits[1], period), Number(digits[3]), digits[2] === ":");

  const relative = text.match(/^(?:a )?(half|quarter|[a-z\d ]+?)(?: minutes?)? (past|to) (.+)$/u);
  if (relative) {
    const minutes = relative[1] === "half" ? 30 : relative[1] === "quarter" ? 15 : integer(relative[1]);
    const hour = hourValue(relative[3], period);
    if (!hour || minutes === null || minutes < 1 || minutes > 30) return null;
    const total = (hour.hour * 60 + (relative[2] === "to" ? -minutes : minutes) + 1440) % 1440;
    return { hour: Math.floor(total / 60), minute: total % 60, periodKnown: hour.known, intrinsic: true };
  }
  // "Half six" is the usual British shorthand for half past six.
  const half = text.match(/^half (.+)$/u);
  if (half) return clock(hourValue(half[1], period), 30, true);
  const oclock = text.match(/^(.+) o'clock$/u);
  if (oclock) return clock(hourValue(oclock[1], period), 0, true);

  const wholeHour = hourValue(text, period);
  if (wholeHour || integer(text) !== null) return clock(wholeHour, 0, /^(?:noon|midday|midnight)$/u.test(text));
  const tokens = text.split(" ");
  for (let split = 1; split < tokens.length; split++) {
    const hour = hourValue(tokens.slice(0, split).join(" "), period);
    if (!hour) continue;
    let minuteText = tokens.slice(split).join(" ");
    const zeroPrefix = minuteText.match(/^(?:oh|zero) (.+)$/u);
    if (zeroPrefix) {
      const digit = integer(zeroPrefix[1]);
      if (digit !== null && digit < 10) minuteText = zeroPrefix[1];
    }
    const minute = minuteText === "oh" ? 0 : integer(minuteText);
    if (minute !== null) return clock(hour, minute, true);
  }
  return null;
}

function isClockKey(time: ClockTime, prompt: string): boolean {
  // 1:30 can describe one hour and thirty minutes rather than a clock reading.
  if (/\b(?:how long|how many (?:hours?|minutes?|seconds?)|duration|elapsed|time (?:taken|spent)|journey length)\b/iu.test(prompt))
    return false;
  if (time.intrinsic) return true;
  // Do not reinterpret prices, durations, room numbers or arbitrary decimals.
  return !/\b(?:how (?:long|many)|duration|minutes?|hours?|seconds?|cost|price|fee|amount|number)\b/iu.test(prompt) &&
    /\b(?:time|arrival|departure|when|o['’]clock)\b/iu.test(prompt);
}

function promptPeriod(prompt: string): "am" | "pm" | undefined {
  if (/\b(?:not|rather than|instead of|except|before|after)\s+(?:in the )?(?:morning|afternoon|evening)\b/iu.test(prompt)) return undefined;
  const periods = new Set<string>();
  for (const match of prompt.matchAll(/\bin the (morning|afternoon|evening)\b|\b([ap])\.m\.?(?=\s|[),?:;]|$)/giu))
    periods.add(match[1] ? (match[1].toLowerCase() === "morning" ? "am" : "pm") : match[2].toLowerCase() === "a" ? "am" : "pm");
  for (const match of prompt.matchAll(/\b(AM|PM)\b/gu)) periods.add(match[1] === "AM" ? "am" : "pm");
  for (const match of prompt.matchAll(/(?:\(|\d)\s*([ap])m\b/giu)) periods.add(match[1].toLowerCase() === "a" ? "am" : "pm");
  // Do not infer a period from questions that contrast morning and evening.
  return periods.size === 1 ? [...periods][0] as "am" | "pm" : undefined;
}

function inPromptPeriod(time: ClockTime, prompt: string): ClockTime {
  const period = promptPeriod(prompt);
  if (time.periodKnown || !period) return time;
  return { ...time, hour: (time.hour % 12) + (period === "pm" ? 12 : 0), periodKnown: true };
}

/** The returned key lets the caller enforce the keyed answer's word/number limit. */
export function matchingTimeAnswer(response: string, keys: string[], prompt: string): string | undefined {
  const parsed = parseClock(response);
  if (!parsed) return undefined;
  const candidate = inPromptPeriod(parsed, prompt);
  return keys.find((key) => {
    const parsedKey = parseClock(key);
    if (!parsedKey || !isClockKey(parsedKey, prompt)) return false;
    const reference = inPromptPeriod(parsedKey, prompt);
    if (reference.minute !== candidate.minute) return false;
    return reference.periodKnown
      ? candidate.periodKnown && reference.hour === candidate.hour
      : reference.hour % 12 === candidate.hour % 12;
  });
}

/** A short representative list for completed reviews, rather than every spelling. */
export function timeAnswerExamples(key: string, prompt: string): string[] {
  const parsed = parseClock(key);
  if (!parsed || !isClockKey(parsed, prompt)) return [];
  const time = inPromptPeriod(parsed, prompt);
  const suffix = time.periodKnown ? (time.hour < 12 ? " am" : " pm") : "";
  const twelveHour = time.hour % 12 || 12;
  const hour = numberWords(twelveHour);
  const numeric = `${time.periodKnown ? time.hour.toString().padStart(2, "0") : twelveHour}:${time.minute.toString().padStart(2, "0")}`;
  const spoken = time.minute === 0 ? `${hour} o'clock${suffix}`
    : `${hour} ${time.minute < 10 ? "oh " : ""}${numberWords(time.minute)}${suffix}`;
  const examples = [numeric, spoken];
  if (time.minute === 0 && time.periodKnown && (time.hour === 0 || time.hour === 12))
    examples.push(time.hour === 0 ? "midnight" : "noon");
  if (time.minute === 15 || time.minute === 30)
    examples.push(`${time.minute === 15 ? "quarter" : "half"} past ${hour}${suffix}`);
  if (time.minute === 45) {
    const next = (time.hour + 1) % 24;
    examples.push(`quarter to ${numberWords(next % 12 || 12)}${time.periodKnown ? (next < 12 ? " am" : " pm") : ""}`);
  }
  if (time.periodKnown && time.hour > 12 && time.minute > 0)
    examples.push(`${numberWords(time.hour)} ${time.minute < 10 ? "oh " : ""}${numberWords(time.minute)}`);
  // Keep examples subject to the exact same specificity rules as actual grading.
  return [...new Set(examples)].filter((example) => matchingTimeAnswer(example, [key], prompt));
}
