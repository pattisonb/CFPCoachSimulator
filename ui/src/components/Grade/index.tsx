import { messages as m } from "./messages.ts";
import "./index.css";

/** The letters, best first, as the scale draws them. */
const LETTERS = ["A", "B", "C", "D", "F"] as const;

/** Whether a string is a letter grade ("B", "A-", "C+"): a page that may also get a word or a number asks first. */
export const isGrade = (s: string | null | undefined): s is string => !!s && /^[A-DF][+-]?$/.test(s);

type Size = "sm" | "md" | "lg";

/**
 * A letter grade as a small tile in its letter's color: A green, B a lighter green, C yellow, D orange, F red. A plus
 * or a minus rides on the letter. The colors are fixed, so the letter on each is fixed too (white or near black,
 * whichever reads).
 */
export default function Grade({ grade, size = "md" }: { grade: string; size?: Size }) {
  return (
    <span className={`grade grade--${grade[0].toLowerCase()} grade--${size}`} role="img" aria-label={m.grade(grade)}>
      {grade}
    </span>
  );
}

/**
 * A read as grades: one tile once it sits in one grade, else its low and high ends with "to" between them. Given
 * anything that is not a pair of grades (the old grade words, a number), it says it in plain text, as before.
 */
export function GradeRange({ read, size = "md" }: { read: string[]; size?: Size }) {
  const lo = read[0];
  const hi = read[read.length - 1];
  if (!isGrade(lo) || !isGrade(hi)) return <>{lo === hi ? lo : m.plain(lo, hi)}</>;
  if (lo === hi) return <Grade grade={lo} size={size} />;
  return (
    <span className="grade-range" role="img" aria-label={m.range(lo, hi)}>
      <Grade grade={lo} size={size} />
      <span className="grade-range__to" aria-hidden="true">
        {m.to}
      </span>
      <Grade grade={hi} size={size} />
    </span>
  );
}

/** The whole scale, F to A, with the letters a read covers lit in their colors: where he sits, at a glance. */
export function GradeScale({ read }: { read: string[] }) {
  const lo = read[0];
  const hi = read[read.length - 1];
  if (!isGrade(lo) || !isGrade(hi)) return null;
  const a = LETTERS.indexOf(hi[0] as (typeof LETTERS)[number]);
  const b = LETTERS.indexOf(lo[0] as (typeof LETTERS)[number]);
  return (
    <span className="grade-scale" aria-hidden="true">
      {[...LETTERS].reverse().map((l) => {
        const i = LETTERS.indexOf(l);
        return (
          <span key={l} className={`grade-scale__step${i >= a && i <= b ? ` grade--${l.toLowerCase()} is-on` : ""}`}>
            {l}
          </span>
        );
      })}
    </span>
  );
}
