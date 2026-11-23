import type { CSSProperties } from "react";
import { inkOn, teamAccent } from "../../colors.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

type Size = "sm" | "md" | "lg";

/** Whether a string is a school grade the game sends ("A+", "B", "C-", "F"). */
export const isSchoolGrade = (s: string | null | undefined): s is string => !!s && /^[A-DF][+-]?$/.test(s);

/** The school grades, worst first (career_js/grades.js ORDER): a grade's place is how it sorts. */
const ORDER = ["F", "D-", "D", "D+", "C-", "C", "C+", "B-", "B", "B+", "A-", "A", "A+"];
export const gradePlace = (grade: string | null | undefined): number => (grade ? ORDER.indexOf(grade) : -1);

/** The page's theme as it stands on <html> (theme.ts keeps it there). */
const themeNow = (): "light" | "dark" => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

/**
 * A school grade as a varsity patch in a team's colors: the letter the game sent (A+ to F), never worked out here.
 * The better the grade, the more of the team's color it wears: an A is the full patch with a stitched inner edge, a B
 * the solid color, a C a tint of it, a D a plain outline and an F a dashed one. The letter sits on the color in the
 * ink that reads on it (--team-on). Your own colors by default (the game's --team); `colors` for another school's.
 * `flip` when the patch itself sits on your team color (a picked button): the two colors trade places.
 */
export default function SchoolGrade({
  grade,
  size = "md",
  colors,
  flip = false,
  title,
}: {
  grade: string | null | undefined;
  size?: Size;
  /** another school's colors; yours when left out */
  colors?: { primary: string; secondary: string };
  flip?: boolean;
  title?: string;
}) {
  if (!isSchoolGrade(grade))
    return (
      <span className={`sgrade sgrade--none sgrade--${size}`} role="img" aria-label={m.none} title={title}>
        –
      </span>
    );
  const accent = colors ? teamAccent(colors, themeNow()) : null;
  const style = accent
    ? ({
        "--sg": accent,
        "--sg-on": inkOn(accent),
        // the pennant corner: the school's other color (trim only)
        "--sg-2": accent === colors?.primary ? colors.secondary : colors?.primary,
      } as CSSProperties)
    : undefined;
  const sign = grade.slice(1);
  return (
    <span
      className={`sgrade sgrade--${grade[0].toLowerCase()} sgrade--${size}${flip ? " is-flip" : ""}`}
      style={style}
      role="img"
      aria-label={m.grade(grade)}
      title={title}
    >
      <b>{grade[0]}</b>
      {sign && <i>{sign === "-" ? "−" : "+"}</i>}
    </span>
  );
}
