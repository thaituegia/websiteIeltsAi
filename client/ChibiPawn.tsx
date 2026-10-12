import type { DuoRole } from "../shared/duo";

/** A decorative horse game piece. Its parent supplies the person's accessible label. */
export function ChibiPawn({ role, className = "" }: { role: DuoRole; className?: string }) {
  const husband = role === "husband";
  const coat = husband ? "#f06464" : "#3ca68b";
  const shade = husband ? "#cd484e" : "#28846e";
  const light = husband ? "#ffd0cb" : "#c9f1df";
  const mane = husband ? "#65475b" : "#7562a2";
  const ink = "#353047";
  return (
    <svg className={`chibi-pawn ${className}`} viewBox="0 0 100 112" fill="none" aria-hidden="true" focusable="false">
      <ellipse cx="50" cy="104" rx="35" ry="6" fill={ink} opacity=".13" />
      <path d="M21 92c0-8 13-13 29-13s29 5 29 13v5c0 8-13 12-29 12S21 105 21 97Z" fill={shade} stroke={ink} strokeWidth="2.5" />
      <ellipse cx="50" cy="91" rx="29" ry="11" fill={coat} stroke={ink} strokeWidth="2.5" />
      <ellipse cx="50" cy="89" rx="19" ry="5" fill={light} opacity=".75" />
      <path d="M33 87c-4-9-3-18 1-27l6-22c3-10 13-15 24-11 10 4 15 14 11 24l-8 18c2 8 6 11 5 18-10 7-29 8-39 0Z" fill={coat} stroke={ink} strokeWidth="2.8" strokeLinejoin="round" />
      <path d="M38 59c-8-2-13-9-11-16 2-8 9-10 10-19 8 3 13 10 13 19l-5 26" fill={mane} stroke={ink} strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M37 38c-6-8-4-21 1-27 8 4 12 13 10 21" fill={coat} stroke={ink} strokeWidth="2.7" strokeLinejoin="round" />
      <path d="M38 19c-1 4-1 9 2 12" stroke={light} strokeWidth="4" strokeLinecap="round" />
      <path d="M49 29c2-13 11-16 17-13-4 4-3 8-1 12" fill={mane} stroke={ink} strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M48 31c9-7 22-4 26 8l4 10c8 1 12 7 10 14-2 8-12 11-22 8l-15-5c-12-4-16-24-3-35Z" fill={coat} stroke={ink} strokeWidth="2.8" strokeLinejoin="round" />
      <path d="M66 51c11-4 23 0 22 11-1 8-12 12-23 8-6-2-7-14 1-19Z" fill={light} stroke={ink} strokeWidth="2.5" />
      <ellipse cx="72" cy="58" rx="2" ry="2.6" fill={ink} />
      <path d="M77 66c-3 2-6 2-9 0" stroke={ink} strokeWidth="2" strokeLinecap="round" />
      <ellipse cx="56" cy="43" rx="4.2" ry="5.6" fill={ink} />
      <circle cx="57.5" cy="41" r="1.6" fill="#fffdf8" />
      <ellipse cx="51" cy="56" rx="6" ry="3.5" fill={husband ? "#ffacae" : "#f6b3bb"} />
      <path d="M35 78c3-7 7-10 11-11" stroke={light} strokeWidth="5" strokeLinecap="round" />
      {husband ? (
        <>
          <path d="m40 64 15 5-6 10-10-8Z" fill="#ffe49c" stroke={ink} strokeWidth="2" strokeLinejoin="round" />
          <path d="m47 69 1.2 2.5 2.8.4-2 1.9.5 2.8-2.5-1.3-2.4 1.3.4-2.8-2-1.9 2.8-.4Z" fill={shade} />
        </>
      ) : (
        <>
          <path d="M45 27c-10-8-18-6-14 4 2 5 7 5 14 2 5 7 11 9 14 4 5-9-4-13-14-10Z" fill="#d1b8f0" stroke={ink} strokeWidth="2.2" strokeLinejoin="round" />
          <circle cx="44" cy="30" r="4" fill="#ffe49c" stroke={ink} strokeWidth="2" />
          <path d="m57 37 3-2" stroke={ink} strokeWidth="2" strokeLinecap="round" />
        </>
      )}
      <path d="M26 98c12 5 33 6 47 0" stroke={light} strokeWidth="2" strokeLinecap="round" opacity=".7" />
    </svg>
  );
}
