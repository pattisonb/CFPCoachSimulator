// The game's own ratings: the one scale every player, prospect and number in the game is on.
//
// EA's ratings were only the jumping-off point. A one-time fit, run offline and not part of the game, read the real 2026
// rosters once and froze, in data/game_scale.json:
//   - each of the 54 skills on our 1-99 scale per position group: 50 is the middle Power 4 starter
//     at the position, 15 points a standard deviation above him, 9 below (as the player cards),
//   - the player card attributes' scale (ratings.js, the same shape),
//   - our overall: a formula per position on those skills, fit once to the 2026 card overall.
// After that nothing reads EA: a career's league and its recruits store our ratings, develop in
// them, and the engine reads them back through `to_base` (the frozen inverse) into the formulas it
// was tuned on. Generated recruits are drawn by a model learned from real players and converted
// with `from_ea` the moment they are made.
import { round, int, sum, get, isNumber, truthy } from "../engine_js/pyrt.js";
import { read_json } from "../engine_js/files.js";
import { prospects } from "../career_js/prospects.js";
import { recruits } from "../career_js/recruits.js";
import { shown } from "./shown.js";
import { ratings as rv2 } from "./ratings.js";

const FILE = "data/game_scale.json";
const ABOVE = 15.0, BELOW = 9.0;         // scale points per standard deviation above and below the middle starter
const GROUP_OF = { QB: "QB", HB: "RB", FB: "RB", WR: "WR", TE: "TE", LT: "OL", LG: "OL", C: "OL", RG: "OL", RT: "OL",
  LEDG: "DL", REDG: "DL", DT: "DL", SAM: "LB", MIKE: "LB", WILL: "LB", CB: "CB", FS: "S", SS: "S",
  K: "K", P: "P" };
const _ENGINE_GROUP = { RB: "RB", OL: "OL", DL: "DL", MLB: "LB", ROLB: "LB", LOLB: "LB", S: "S" };

export function data() {
  return read_json(game_scale.FILE);       // parsed once (files.js keeps it)
}

export function keys() {
  return game_scale.data()["keys"];
}

export function group(pos) {
  // The scale group of an EA position (LT, MIKE, ...) or an engine position (OL, MLB, ...).
  return get(game_scale.GROUP_OF, pos) || get(_ENGINE_GROUP, pos, pos);
}

export function to_ours(base, grp, key) {
  const [m, sd] = game_scale.data()["skills"][grp][key];
  return int(round(Math.max(1, Math.min(99, 50 + (base - m) / sd * (base >= m ? game_scale.ABOVE : game_scale.BELOW)))));
}

export function to_base(ours, grp, key) {
  const [m, sd] = game_scale.data()["skills"][grp][key];
  return m + (ours - 50) * sd / (ours >= 50 ? game_scale.ABOVE : game_scale.BELOW);
}

export function ours_from_base(ratings, pos) {
  const g = group(pos);
  const out = {};
  for (const k of keys()) if (ratings[k] !== undefined) out[k] = to_ours(ratings[k], g, k);
  return out;
}

const _tenths = new Map();     // "group|skill" -> the answers by rating (a whole 1-99 one is asked for again and again)

export function _base_tenth(ours, grp, key) {
  if (!Number.isInteger(ours) || ours < 0 || ours > 99) return round(to_base(ours, grp, key), 1);
  const at = `${grp}|${key}`;
  let row = _tenths.get(at);
  if (row === undefined) _tenths.set(at, row = new Array(100));
  if (row[ours] === undefined) row[ours] = round(to_base(ours, grp, key), 1);
  return row[ours];
}

export function base_from_ours(ours, pos) {
  const g = group(pos);
  const out = {};
  for (const [k, v] of Object.entries(ours)) out[k] = _base_tenth(v, g, k);
  return out;
}

export function whole(v) {
  // A card number as the game keeps it: whole, 1-99.
  return Math.max(1, Math.min(99, int(round(Number(v)))));
}

export function from_ea(ratings, pos = null) {
  // A generated player's draw (recruits.js draws on the card's own scale) as whole card numbers.
  const out = {};
  for (const k of keys()) if (ratings[k] !== undefined) out[k] = whole(ratings[k]);
  return out;
}

export function base_from_card(card) {
  // What the play engine's formulas read for a player's card numbers: each through the source curve they were tuned
  // on (the engine's input; never stored or shown).
  const out = {};
  for (const [k, v] of Object.entries(card)) out[k] = _base_of(v);
  return out;
}
export function card_from_base(base) {
  // The other way, for a player who comes with only what the engine's formulas read: his card numbers.
  const out = {};
  for (const k of keys()) if (isNumber(base[k])) out[k] = shown.from_base(base[k]);
  return out;
}
const _bases = new Array(100);
function _base_of(v) {
  if (!Number.isInteger(v) || v < 0 || v > 99) return round(shown.to_base(v), 1);
  if (_bases[v] === undefined) _bases[v] = round(shown.to_base(v), 1);
  return _bases[v];
}

// How far a generated player grows, by position group: his drawn room to potential (card points) times this. Set
// so a career's starters settle, season after season, where the real 2026 starters were (tools/long_run.mjs). *tune*
const ROOM = { QB: 1.33, RB: 1.0, WR: 1.11, TE: 1.21, OL: 1.24, DL: 1.35, LB: 1.45, CB: 1.48, S: 1.63, K: 1.25, P: 0.85 };

export function potential_from_ea(potential_ea, card, pos) {
  // A generated player's potential, in card numbers: his room above his ratings (`card`) scaled by ROOM.
  const m = get(game_scale.ROOM, group(pos), 1.0);
  const pot = from_ea(potential_ea, pos);
  const out = {};
  for (const [k, v] of Object.entries(pot)) {
    out[k] = int(round(Math.min(99, get(card, k, v) + m * Math.max(0, v - get(card, k, v)))));
  }
  return out;
}

export function has_overall() {
  let d;
  try {
    d = game_scale.data();            // a host without the file throws
  } catch (e) {
    return false;
  }
  return truthy(get(d, "card_overall"));
}

const MISSING = 60;                      // a rating a player has none of, read as this card number (rosters.MISSING)

export function card_formula(pos) {
  // The overall formula at EA position `pos` (or his engine position's group): {"pos": the position it is for,
  // "const", "w": {card attribute: weight}}, on his card's numbers (each card attribute is one of his ratings).
  const f = get(game_scale.data(), "card_overall") || {};
  const at = f[pos] !== undefined ? pos : get(game_scale._FIRST, group(pos), "QB");
  return f[at] !== undefined ? { pos: at, ...f[at] } : null;
}

// card attribute -> the rating it is (ratings.js: each card attribute reads one rating)
let _skill_of = null;
function skill_of(attr) {
  if (_skill_of === null) {
    _skill_of = {};
    for (const [a, row] of Object.entries(rv2.ATTRIBUTES)) _skill_of[a] = row[3].sources;
  }
  return get(_skill_of, attr) || [attr];
}

export function card_value(card, attr, own = null) {
  // One card attribute's number from a player's ratings (`card`: rating -> card number). A quarterback's Decision
  // Making is his own (`own`); one who has none yet reads where his Football IQ and Pocket Poise stand.
  if (attr === "decision_making") {
    if (isNumber(own)) return own;
    return 0.6 * get(card, "awareness", MISSING) + 0.4 * get(card, "throw_under_pressure", MISSING);
  }
  const src = skill_of(attr);
  if (src.length === 1) return get(card, src[0], MISSING);
  return sum(src.map((k) => get(card, k, MISSING))) / src.length;
}

export function overall(card, pos, own = null) {
  // A player's overall at EA position `pos` (or his engine position's group): a weighted sum of his card's numbers
  // (card_formula: football IQ and a position's main skills count most). `card`: rating -> card number. `own`: a
  // quarterback's Decision Making (a rating of its own: his other ratings do not say it).
  const f = card_formula(pos);
  if (!f) return 1;
  let v = f["const"];
  for (const [a, w] of Object.entries(f["w"])) v += w * card_value(card, a, f["pos"] === "QB" ? own : null);
  return int(round(Math.max(1, Math.min(99, v))));
}

export function card_attributes(ours, pos) {
  // His player card's attributes (the sim's) from his skills, at EA position `pos`.
  return prospects.card_attributes(ours, { ea_position: pos, position: pos });
}

export function decision_card(own) {
  // A quarterback's own Decision Making (`own`: the number he has, on the scale the game shows) on his card's scale,
  // as his card keeps its attributes: what his overall reads for it.
  const [m, hi, lo] = get(card_scale(), "QB|decision_making", [50, 1.5, 0.9]);
  const v = round(shown.to_base(Math.max(1, Math.min(99, own))), 1);
  return int(round(Math.max(1, Math.min(99, 50 + (v - m) * (v >= m ? hi : lo)))));
}

export function skill_weights(pos) {
  // How much each of his ratings counts in his overall at `pos` (card_formula's weights, by the rating each reads).
  const out = {};
  for (const [a, w] of Object.entries(get(card_formula(pos) || {}, "w") || {})) for (const k of skill_of(a)) out[k] = get(out, k, 0) + w;
  return out;
}

export function position_skills(pos) {
  // The ratings a position is graded on: the ones its overall weighs (card_formula).
  const f = card_formula(pos);
  const out = new Set();
  for (const [a, w] of Object.entries(get(f || {}, "w") || {})) if (w > 0 && a !== "decision_making") for (const k of skill_of(a)) out.add(k);
  return out;
}

export function card_position(p) {
  // The EA position a built player's card is scored at: the one his skills were made for (the build keeps it as
  // "source_position"), else his depth-chart role, else his engine position (which only names the group, so card_formula
  // falls back to the group's first formula: a tackle scored as a guard).
  return get(p, "source_position") || get(p, "role") || p["position"];
}

export function overall_version() {
  // Which overall this build stores: 3, the card numbers' own formula (2 and 1 were the formulas before). A league and
  // a class are stamped with it when they are made ("overall_v").
  return 3;
}


// The career modules a save from before needs (teamdata_js/old_saves.js): this file cannot import them (they import
// it), so each is put here by whoever loads it: career_js/league.js sets game_scale.modules.league, app_js/game.js sets
// game_scale.modules.recruiting.
const modules = { league: null, recruiting: null };

const _FIRST = { QB: "QB", RB: "HB", WR: "WR", TE: "TE", OL: "LG", DL: "DT", LB: "MIKE", CB: "CB", S: "FS", K: "K", P: "P" };

export function starter_means() {
  // The average FBS starter at each engine position, in card numbers ("POS:attr" -> mean; "returners:return_rating"
  // the league's designated returners'), frozen from the real 2026 rosters: what the play engine reads a player
  // against (build_teams.normalize).
  return get(game_scale.data(), "starter_means") || {};
}

export function engine_means() {
  // The real 2026 build's FBS starter means of the engine's attributes ("POS:attr" -> mean),
  // frozen: a career's later seasons go onto the engine scale through them (build_teams.normalize).
  return get(game_scale.data(), "engine_means");
}

export function card_scale() {
  // The player card attributes' scale ("group|attr" -> [middle, slope above, slope below]), frozen.
  return game_scale.data()["card_scale"];
}

export const game_scale = {
  FILE, ABOVE, BELOW, GROUP_OF, ROOM, MISSING, _FIRST, modules,
  data, keys, group, to_ours, to_base, ours_from_base, _base_tenth, base_from_ours, whole, from_ea, potential_from_ea,
  has_overall, card_formula, card_value, card_attributes, decision_card, overall, skill_weights, position_skills, card_position, base_from_card, card_from_base,
  overall_version, starter_means, engine_means, card_scale,
};
