// Letter grades for a player's overall potential (the player's ask): A through F in place of the number, on the page
// only. Nothing here is read by the sim or by any recruiting decision: a view turns a potential (or a read's two ends)
// into letters as it is sent.
//
// A letter is a school grade on the scale ratings are shown on (teamdata_js/shown.js, where the average player is about a
// 70): an A is 90 and up, a B the 80s, a C the 70s, a D the 60s, an F anything under 60. A potential comes in on the
// game's own scale and is put on the shown one here. A plus or a minus is a finer read, a third of a band, and it takes
// a sharp eye: your staff's and your own evaluating ability (`eye`) at PLUS_MINUS_EYE or better. Your own players always
// show it: you coach them every day.
import { round, int, get, truthy } from "../engine_js/pyrt.js";
import { modules } from "../engine_js/modules.js";
import { shown } from "../teamdata_js/shown.js";

const BANDS = [["A", 90], ["B", 80], ["C", 70], ["D", 60], ["F", 0]];   // *tune* a letter and the lowest shown potential that earns it
const PLUS_FROM = 7, MINUS_UNDER = 3;      // *tune* inside a band's 10 points: this far up is a plus, under this a minus
const NO_FINE = ["F"];                     // *tune* letters that take no plus or minus
const PLUS_MINUS_EYE = 70;                 // *tune* your best evaluator (staff or you) at this or better reads plus and minus

// School grades (the player's ask): every grade a school gets reads as a letter on this same scale, A+ down to F: the
// Programs page's measures (0-100) and a program's case with one recruit on a pitch topic (a pull, 0-1). These lines are
// the one place a value becomes a letter, for the game and the page alike (the page is sent the letter). They were set
// from every program's grades (tools: the spread is F 11%, the D's 26%, the C's 32%, the B's 22%, the A's 10%, A+ 2.5%)
// so that recruiting's two cut-offs sit on letter lines: a case from B- up is a strong one (recruiting.STRONG_CASE, 0.6)
// and an F is a case that backfires (recruiting.BACKFIRE, 0.25).
const SCHOOL_LINES = [["A+", 94], ["A", 87], ["A-", 80], ["B+", 74], ["B", 67], ["B-", 60], ["C+", 54], ["C", 47], ["C-", 40],
  ["D+", 35], ["D", 30], ["D-", 25], ["F", 0]];   // *tune* a school grade and the lowest value (0-100) that earns it
const LETTER_STEPS = 3;                    // the grades in a full letter (B- to A-): what "a letter better" means

// every grade, worst first: its place is how it sorts
const ORDER = [];
for (const [letter] of [...BANDS].reverse()) ORDER.push(...(NO_FINE.includes(letter) ? [letter] : [letter + "-", letter, letter + "+"]));

export function letter(value, fine = false) {
  // The letter for a potential (the game's own scale, as stored); with `fine`, its plus or minus.
  const v = Math.max(0.0, Math.min(99.0, round(shown.overall_exact(Math.max(0.0, Math.min(99.0, Number(value)))))));
  const [name, floor] = grades.BANDS.find(([, f]) => v >= f);
  if (!fine || grades.NO_FINE.includes(name)) return name;
  const into = v - floor;
  return name + (into >= grades.PLUS_FROM ? "+" : into < grades.MINUS_UNDER ? "-" : "");
}

export function school(value) {
  // The letter for a school grade on the 0-100 scale (programs.js: a measure of the program, a campus grade).
  const v = Number(value);
  for (const [name, floor] of grades.SCHOOL_LINES) if (v >= floor) return name;
  return grades.SCHOOL_LINES[grades.SCHOOL_LINES.length - 1][0];
}

export function school_pull(pull) {
  // The letter for a program's case on a topic, a pull of 0-1 (recruiting.strengths): the same lines, read as shares
  // (60 / 100 is exactly the 0.6 a strength is compared with, where 0.6 * 100 is not always 60).
  const v = Number(pull);
  for (const [name, floor] of grades.SCHOOL_LINES) if (v >= floor / 100) return name;
  return grades.SCHOOL_LINES[grades.SCHOOL_LINES.length - 1][0];
}

export function school_floor(grade) {
  // The lowest value (0-100) that earns a school grade.
  const found = grades.SCHOOL_LINES.find(([name]) => name === grade);
  return found ? found[1] : 0;
}

export function place(grade) {
  // Where a grade sorts, worst (0) to best: a bare letter sits between its minus and its plus.
  return grades.ORDER.indexOf(grade);
}

export function eye(state) {
  // Your side's best evaluating ability: your staff's evaluation ratings (your coordinators' is their player
  // development; your recruiters have their own) and your own player development as head coach.
  const staff = get(get(state, "career") || {}, "staff") || [];
  let mine = 0;
  try {
    const season = modules.season;
    const hc = get(get(season.team_data(state, state["team"]), "coaches") || {}, "head_coach") || {};
    mine = pyint(get(get(hc, "ratings") || {}, "player_development") || 0);
  } catch (e) {
    mine = 0;
  }
  return Math.max(...staff.map((m) => pyint(get(m, "evaluation") || 0)), mine);
}

/** int(x) of a stored rating: a number toward zero, a whole number's text as that number; anything else Python refuses. */
function pyint(x) {
  if (typeof x === "number" || typeof x === "boolean") return int(Number(x));
  if (typeof x === "string" && /^\s*[+-]?\d+\s*$/.test(x)) return Number(x);
  throw new TypeError(`int() cannot read ${JSON.stringify(x)}`);
}

export function fine(state, pid = null) {
  // Whether your read carries a plus or a minus. Of a recruit (`pid`): your staff's blend for him (recruiting.scout_blend:
  // his area's recruiter, the coordinator on his side of the ball, you) at recruiting.FINE_BLEND or better, the same
  // bar that finishes his report in two looks. With no recruit named: your best evaluator at PLUS_MINUS_EYE, as before.
  if (pid !== null && pid !== undefined) {
    const recruiting = modules.recruiting;
    if (truthy(get(get(state, "recruiting") || {}, "prospects")) && get(state["recruiting"]["prospects"], pid) !== undefined && get(state["recruiting"]["prospects"], pid) !== null) {
      return recruiting.scout_blend(state, pid) >= recruiting.FINE_BLEND;
    }
  }
  return grades.eye(state) >= grades.PLUS_MINUS_EYE;
}

export function span(lo, hi, fine_read) {
  // A read's two ends as letters, low then high (the same letter twice once it sits in one grade).
  const a = grades.letter(Math.min(lo, hi), fine_read), b = grades.letter(Math.max(lo, hi), fine_read);
  return [a, b];
}

export function sort_key(grades_) {
  // A shown read as one number to sort by, best first: its high grade, then its low one. Two reads that show the
  // same letters tie (the caller breaks it by national rank): the number behind them never orders them.
  return -(grades.place(grades_[grades_.length - 1]) * 100 + grades.place(grades_[0]));
}

export const grades = { BANDS, PLUS_FROM, MINUS_UNDER, NO_FINE, PLUS_MINUS_EYE, ORDER, SCHOOL_LINES, LETTER_STEPS, letter, school, school_pull, school_floor, place, eye, fine, span, sort_key };
modules.grades = grades;
