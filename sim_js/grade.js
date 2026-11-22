// The Season Grade on the Season Recap: a letter (A+ to F) and a one-sentence verdict, read off
// what the season already knows. Nothing here is random and nothing is written to the state: the
// grade is a pure function of the record against the AD's goal (coach_career/programs.GOALS), the
// conference title, how far the playoff run went, the bowl, and the final AP rank.
//
//     season_grade(state) -> {"grade": "B-", "score": 81, "band": "met", "line": "..."}
//
// A score starts at GRADE_BASE (a season exactly at the goal's win count) and moves by the table
// below; the letter is read off GRADE_LETTERS. A national champion is always an A+, and only a
// champion is. The verdict is one sentence per band (GRADE_LINES), keyed by what the season was:
// champion, a playoff run, the goal met, a bowl trip short of the goal, the goal missed, a losing
// season, or a fired-level season (an F).
import { round, int, sorted, get, truthy } from "../engine_js/pyrt.js";
import { modules } from "../engine_js/modules.js";

const GRADE_BASE = 80;              // a season right at the AD's goal: a B- *tune*
const GRADE_PER_WIN = 3;            // each win over (under) the goal's win count *tune*
const GRADE_CONFERENCE = 4;         // a conference title *tune*
const GRADE_PLAYOFF = { 17: 3, 18: 5, 19: 8, 20: 11 };   // the furthest playoff week played: first round, quarterfinals, semifinals, the title game *tune*
const GRADE_BOWL_WIN = 3;           // a bowl won (a bowl lost moves nothing) *tune*
const GRADE_RANK = [[10, 3], [25, 1]];                 // a final AP rank inside the top 10, the top 25 *tune*
const GRADE_MISSED_KIND = -6;       // the goal asked for the playoff or the conference title and the wins came without it *tune*
const GRADE_LOSING = -4;            // a losing season, on top of the wins under the goal *tune*
const GRADE_CAP = 96;               // the best a season without the title can score: an A, never the A+ *tune*
const GRADE_LETTERS = [["A+", 97], ["A", 93], ["A-", 90], ["B+", 87], ["B", 83], ["B-", 80], ["C+", 77], ["C", 73], ["C-", 70],
  ["D+", 67], ["D", 63], ["D-", 60], ["F", 0]];

const ROUND_WORDS = { 17: "the first round", 18: "the quarterfinals", 19: "the semifinals", 20: "the national championship game" };
// one sentence per band; {record} is the final record, {goal} the AD's goal in lowercase (the table holds it in Title Case), {round} the playoff exit
const GRADE_LINES = {
  champion: "National champions at {record}: the season every program dreams of.",
  playoff: "A playoff season at {record}; the run ended in {round}.",
  met: "The AD asked you to {goal}, and {record} did it: a season to build on.",
  bowl: "{A} {record} season that reached a bowl but fell short of the AD's goal to {goal}.",
  missed: "A competitive {record} season, but it fell short of the postseason and the AD's goal to {goal}.",
  losing: "A losing season at {record}; the program needs a better year.",
  fired: "{A} {record} season that puts the job in question.",
};

export function _letter(score) {
  for (const [letter, floor] of grade.GRADE_LETTERS) if (score >= floor) return letter;
  return "F";
}

export function _my_games(state) {
  const me = state["team"];
  return sorted(Object.values(state["games"]).filter((g) => truthy(g["played"]) && (me === g["home"] || me === g["away"])), (g) => g["week"]);
}

export function _won(g, me) {
  const mine = g["home"] === me ? g["home_score"] : g["away_score"];
  const theirs = g["home"] === me ? g["away_score"] : g["home_score"];
  return mine > theirs;
}

export function season_grade(state) {
  // The letter, its score, the band and the verdict for the season as it stands.
  const carousel = modules.carousel, season = modules.season;

  const me = state["team"];
  const rec = season._records(state, undefined, true)[me];
  const wins = rec["wins"], losses = rec["losses"];
  const goal = carousel.goal(me, state);
  const games = grade._my_games(state);
  const playoff = games.filter((g) => g["kind"] === "playoff");
  const bowls = games.filter((g) => g["kind"] === "bowl");
  const champion = get(state, "champion") === me;
  const conf_title = get(get(state, "champions") || {}, state["conference"]) === me;
  let last = 0;
  for (const k of Object.keys(get(state, "polls") || {})) last = Math.max(last, pyint(k));
  const last_poll = get(get(state, "polls") || {}, String(last), {});
  let rank = null;
  for (const e of get(last_poll, "ap", [])) if (e["team"] === me) { rank = e["rank"]; break; }
  const met = wins >= goal["wins"] && (goal["kind"] !== "playoff" || playoff.length > 0) && (goal["kind"] !== "conference" || conf_title);

  let score = grade.GRADE_BASE + grade.GRADE_PER_WIN * (wins - goal["wins"]);
  if (conf_title) score += grade.GRADE_CONFERENCE;
  if (playoff.length) score += get(grade.GRADE_PLAYOFF, Math.max(...playoff.map((g) => g["week"])), 0);
  if (bowls.length && grade._won(bowls[bowls.length - 1], me)) score += grade.GRADE_BOWL_WIN;
  if (truthy(rank)) {
    for (const [top, pts] of grade.GRADE_RANK) if (rank <= top) { score += pts; break; }
  }
  if (wins >= goal["wins"] && !met) score += grade.GRADE_MISSED_KIND;
  if (wins < losses) score += grade.GRADE_LOSING;
  score = int(round(score));
  const letter = champion ? "A+" : grade._letter(Math.min(score, grade.GRADE_CAP));

  let band;
  if (champion) band = "champion";
  else if (playoff.length) band = "playoff";
  else if (letter === "F") band = "fired";
  else if (wins < losses) band = "losing";
  else if (met) band = "met";
  else if (bowls.length) band = "bowl";
  else band = "missed";
  const text = goal["text"];
  const last_week = playoff.length ? Math.max(...playoff.map((g) => g["week"])) : 0;
  const fill = { record: `${wins}-${losses}`, A: [8, 11, 18].includes(wins) ? "An" : "A", goal: text.toLowerCase().replace("college football playoff", "College Football Playoff"),
    round: get(grade.ROUND_WORDS, last_week, "the playoff") };
  const line = grade.GRADE_LINES[band].replace(/\{(record|A|goal|round)\}/g, (_, k) => fill[k]);
  return { grade: letter, score, band, line, goal: text, met };
}

/** int(k) of a poll's week key */
function pyint(k) {
  if (typeof k === "number") return int(k);
  if (typeof k === "string" && /^\s*[+-]?\d+\s*$/.test(k)) return Number(k);
  throw new Error(`invalid literal for int() with base 10: '${k}'`);
}

export const grade = {
  GRADE_BASE, GRADE_PER_WIN, GRADE_CONFERENCE, GRADE_PLAYOFF, GRADE_BOWL_WIN, GRADE_RANK, GRADE_MISSED_KIND, GRADE_LOSING, GRADE_CAP,
  GRADE_LETTERS, ROUND_WORDS, GRADE_LINES, _letter, _my_games, _won, season_grade,
};
modules.grade = grade;
