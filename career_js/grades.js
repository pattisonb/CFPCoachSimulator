// Letter grades for a player's overall potential (the player's ask): A through F in place of the number, on the page
// only. Nothing here is read by the sim or by any recruiting decision: a view turns a potential (or a read's two ends)
// into letters as it is sent.
//
// A letter is a school grade on the scale ratings are shown on (teamdata_js/shown.js, where the average player is about a
// 70): an A is 90 and up, a B the 80s, a C the 70s, a D the 60s, an F anything under 60. A potential comes in on the
// game's own scale and is put on the shown one here. A plus or a minus is a finer read, a third of a band, and it takes
// a sharp eye: your staff's and your own evaluating ability (`eye`) at PLUS_MINUS_EYE or better. Your own players always
// show it: you coach them every day.
import { round, int, get } from "../engine_js/pyrt.js";
import { modules } from "../engine_js/modules.js";
import { shown } from "../teamdata_js/shown.js";

const BANDS = [["A", 90], ["B", 80], ["C", 70], ["D", 60], ["F", 0]];   // *tune* a letter and the lowest shown potential that earns it
const PLUS_FROM = 7, MINUS_UNDER = 3;      // *tune* inside a band's 10 points: this far up is a plus, under this a minus
const NO_FINE = ["F"];                     // *tune* letters that take no plus or minus
const PLUS_MINUS_EYE = 70;                 // *tune* your best evaluator (staff or you) at this or better reads plus and minus

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

export function fine(state) {
  // Whether your reads of a recruit carry a plus or a minus.
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

export const grades = { BANDS, PLUS_FROM, MINUS_UNDER, NO_FINE, PLUS_MINUS_EYE, ORDER, letter, place, eye, fine, span, sort_key };
modules.grades = grades;
