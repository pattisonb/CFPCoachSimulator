// The scale every rating is shown on (the player's ask): the shape of EA's, where the average player is about a 70.
//
// Nothing is stored on it. The game keeps every rating as it always has (game_scale: 50 is the middle Power 4 starter
// at the position), the sim reads those, and the rules that cut on a rating (the draft, a gem, how a player grows) cut on
// those. A number is put on this scale as it leaves for the page, and a number typed on the page (a god-mode edit) is
// taken back off it. So a save from before shows on this scale the moment it loads, and no game's result moves.
//
// - An overall (and a potential, which is an overall he may reach): OVERALL_KNOTS, our overalls spread the way EA's are
//   across every FBS player (the same share in the 90s, the 80s, the 70s...). The order of players is ours, untouched.
// - A skill (Speed, Catching, Throw Power): the skill itself, not where he stands among his own position. A receiver's
//   Throw Power reads low, as it is, where our stored scale grades it against other receivers.
// - A card attribute (Hands, Pass Pro: Anchor): what it is built from, on the same footing as a skill.
// - A team's overall, offense, defense and special teams: TEAM_KNOTS, each by where the team stands among FBS teams at
//   it (the worst in the mid 60s, the middle one a 77, the top handful in the 90s). A unit's stored rating spreads wider
//   than an overall's, so each has its own line: the ninth-best offense reads 87, not 91.
// - A coach's or a staff member's rating: COACH_KNOTS, the average coach a 70.
import { round, int, get, isNumber, truthy } from "../engine_js/pyrt.js";
import { read_json } from "../engine_js/files.js";
import { game_scale } from "./game_scale.js";

// *tune* (our overall, the overall shown): the 2026 FBS players' overalls at the same share of players as EA's
// (the 0.1st, 1st, 5th, 10th, 25th, 50th, 75th, 90th, 95th, 99th and 99.9th percentiles, and the two ends). Straight
// lines between them. Fit once from data/engine_teams.json against cfb_sim_data's overalls.
const OVERALL_KNOTS = [[0, 40], [3, 41], [9, 50], [15, 57], [22, 62], [25, 64], [30, 67], [36, 71], [43, 76], [54, 81],
  [61, 84], [77, 89], [93, 94], [99, 99]];
const LOW = 1, HIGH = 99;
// *tune* (a team rating of ours, the one shown), a line for each kind: the 2026 FBS teams' lowest, 5th, 25th, 50th, 75th,
// 90th and 97th percentile and highest land on 66, 69, 73, 77, 81, 85, 89 and 93-94 (about four teams at 90 or better)
const TEAM_KNOTS = {
  overall: [[35, 50], [49.8, 66], [50.5, 69], [53.9, 73], [57.8, 77], [63.5, 81], [68.1, 85], [73.4, 89], [75.7, 93], [90, 99]],
  unit: [[35, 50], [48.5, 66], [50.4, 69], [54.0, 73], [58.7, 77], [64.4, 81], [70.7, 85], [74.8, 89], [79.7, 94], [92, 99]],
  special_teams: [[25, 50], [39.0, 62], [45.0, 67], [48.5, 72], [53.0, 76], [57.5, 80], [62.5, 84], [68.0, 88], [77.5, 94], [90, 99]],
};
// *tune* (a coach's or staff member's rating, the one shown): the league's coaches run 15 to 99 with the middle at 49
const COACH_KNOTS = [[15, 45], [30, 56], [40, 63], [50, 70], [60, 76], [70, 82], [80, 88], [90, 94], [99, 99]];

/** Python's float(x) of a number (or of a number typed as text). */
const float = (x) => Number(x);

/** The same knots read the other way: tuple((y, x) for x, y in knots). */
const flipped = (knots) => knots.map(([x, y]) => [y, x]);

export function _line(knots, x) {
  // `x` carried along the straight lines through `knots` (held at the ends).
  if (x <= knots[0][0]) return knots[0][1];
  if (x >= knots[knots.length - 1][0]) return knots[knots.length - 1][1];
  let i = 0, top = knots.length;                 // bisect_right([k[0] for k in knots], x)
  while (i < top) {
    const mid = (i + top) >> 1;
    if (x < knots[mid][0]) top = mid; else i = mid + 1;
  }
  const [x0, y0] = knots[i - 1], [x1, y1] = knots[i];
  return y0 + (x - x0) * (y1 - y0) / (x1 - x0);
}

export function overall_exact(ours) {
  // An overall (or a potential) on the shown scale, unrounded: for a difference of two (a gain) or a range's ends.
  return _line(shown.OVERALL_KNOTS, float(ours));
}

export function overall(ours) {
  // An overall as the page shows it. None stays None (a view that has no overall to show says so itself).
  if (!isNumber(ours)) return ours;
  return int(round(Math.max(shown.LOW, Math.min(shown.HIGH, overall_exact(ours)))));
}

export function overall_back(shown_value) {
  // The inverse: a shown overall (one typed on the page) on our scale.
  return _line(flipped(shown.OVERALL_KNOTS), float(shown_value));
}

export function team(ours, kind = "overall") {
  // A team rating as the page shows it: `kind` is "overall", "offense", "defense" or "special_teams".
  if (typeof ours !== "number") return ours;
  const knots = typeof kind === "string" && Object.hasOwn(shown.TEAM_KNOTS, kind) ? shown.TEAM_KNOTS[kind] : null;
  return int(round(_line(knots || shown.TEAM_KNOTS["unit"], float(ours))));
}

export function team_ratings(r) {
  // A team's ratings for the page: its units on the team line, its roster and position-group averages (averages of
  // players' overalls) on the players' line.
  const out = truthy(r) ? { ...r } : {};
  for (const k of ["overall", "offense", "defense", "special_teams"]) {
    if (k in out) out[k] = team(out[k], k);
  }
  if ("roster_avg" in out) out["roster_avg"] = overall(out["roster_avg"]);
  const groups = get(out, "position_groups");
  if (groups !== null && typeof groups === "object" && !Array.isArray(groups)) {
    const shown_groups = {};
    for (const [k, v] of Object.entries(groups)) shown_groups[k] = overall(v);
    out["position_groups"] = shown_groups;
  }
  return out;
}

export function coach(ours) {
  // A coach's or staff member's rating as the page shows it. The game's rules keep reading the stored one.
  if (typeof ours !== "number") return ours;
  return int(round(_line(shown.COACH_KNOTS, float(ours))));
}

export function gain(before, after) {
  // A change in overall as the page shows it: the shown overall after less the shown overall before (a point of
  // ours is worth more or less of a shown point at different places on the scale).
  return overall(after) - overall(before);
}

// the curve as the file holds it, and the two lines made from it (made once)
let curve_of = null, curve_points = null, curve_flipped = null;

export function _curve() {
  // EA's scale to the source scale the sim's ratings sit on (cfb_sim_data/league.json), as its points.
  // (The same file career_js/recruits.js's model() reads; files.js parses it once.)
  const points = read_json("data/recruiting_model.json")["players"]["curve"];
  if (points !== curve_of) {
    curve_of = points;
    curve_points = points.map(([x, y]) => [float(x), float(y)]);
    curve_flipped = flipped(curve_points);
  }
  return curve_points;
}

export function from_base(base) {
  // A source-scale rating (the sim's own) on the shown scale: back through the source's curve.
  _curve();
  return int(round(Math.max(shown.LOW, Math.min(shown.HIGH, _line(curve_flipped, float(base))))));
}

export function from_base_exact(base) {
  // The same, unrounded and unheld: for a difference of two.
  _curve();
  return _line(curve_flipped, float(base));
}

export function to_base(shown_value) {
  // The inverse: a shown rating on the source scale.
  return _line(_curve(), float(shown_value));
}

export function skill(ours, group, key) {
  // One of a player's stored skills (our scale, at his position group) as the page shows it.
  if (!isNumber(ours)) return ours;
  return from_base(game_scale.to_base(ours, group, key));
}

export function skill_back(shown_value, group, key) {
  // The inverse: a shown skill as the stored one at his position group.
  return game_scale.to_ours(to_base(shown_value), group, key);
}

export function _card(group, key) {
  return get(game_scale.card_scale(), `${group === "FB" ? "RB" : group}|${key}`);
}

export function attribute(value, group, key) {
  // A player card attribute (the card's own scale, at his card group: QB, RB, WR, TE, OL, DL, LB, CB, S, K, P) as the
  // page shows it: back to what it is built from, then onto the shown scale. One the card scale does not know (an
  // older file) goes by the overall's line, so it still lands on the scale.
  if (!isNumber(value)) return value;
  const s = _card(group, key);
  if (!truthy(s)) return overall(value);
  const [m, hi, lo] = s;
  return from_base(m + (value - 50) / ((value >= 50 ? hi : lo) || 1.0));
}

export function attribute_back(shown_value, group, key) {
  // The inverse: a shown card attribute on the card's own scale.
  const s = _card(group, key);
  if (!truthy(s)) return int(round(overall_back(shown_value)));
  const [m, hi, lo] = s;
  const raw = to_base(shown_value);
  return int(round(Math.max(shown.LOW, Math.min(shown.HIGH, 50 + (raw - m) * (raw >= m ? hi : lo)))));
}

export const shown = {
  OVERALL_KNOTS, LOW, HIGH, TEAM_KNOTS, COACH_KNOTS, _line, overall_exact, overall, overall_back, team, team_ratings,
  coach, gain, _curve, from_base, from_base_exact, to_base, skill, skill_back, _card, attribute, attribute_back,
};
