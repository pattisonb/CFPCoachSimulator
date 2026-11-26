// The game's numbers: every rating, potential and overall is a card number (1-99, the average player about a 70), the
// number the player's card shows and the roster file holds. This file holds what is frozen about them, in
// data/game_scale.json: the 54 ratings' keys, the overall's formula per position (card_overall, on card numbers), the
// average FBS starter at each engine position (starter_means: what the play engine reads a player against), each
// card group's average starter in his card attributes (attribute_means) and the scouting reads' words (read_words).
// Generated recruits are drawn in card numbers by a model learned from real players (from_draw).
import { round, int, sum, get, isNumber, truthy } from "../engine_js/pyrt.js";
import { read_json } from "../engine_js/files.js";
import { prospects } from "../career_js/prospects.js";
import { ratings as rv2 } from "./ratings.js";

const FILE = "data/game_scale.json";
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
  // The position group of an EA position (LT, MIKE, ...) or an engine position (OL, MLB, ...).
  return get(game_scale.GROUP_OF, pos) || get(_ENGINE_GROUP, pos, pos);
}

export function whole(v) {
  // A card number as the game keeps it: whole, 1-99.
  return Math.max(1, Math.min(99, int(round(Number(v)))));
}

export function from_draw(ratings) {
  // A generated player's draw (recruits.js draws card numbers) as whole card numbers.
  const out = {};
  for (const k of keys()) if (ratings[k] !== undefined) out[k] = whole(ratings[k]);
  return out;
}

// How far a generated player grows, by position group: his drawn room to potential (card points) times this. Set
// so a career's starters settle, season after season, where the real 2026 starters were (tools/long_run.mjs). *tune*
const ROOM = { QB: 1.33, RB: 1.0, WR: 1.11, TE: 1.21, OL: 1.24, DL: 1.35, LB: 1.45, CB: 1.48, S: 1.63, K: 1.25, P: 0.85 };

export function potential_from_draw(potential, card, pos) {
  // A generated player's potential, in card numbers: his room above his ratings (`card`) scaled by ROOM.
  const m = get(game_scale.ROOM, group(pos), 1.0);
  const pot = from_draw(potential);
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

export function card_attributes(card, pos) {
  // His player card's attributes from his ratings, at EA position `pos`.
  return prospects.card_attributes(card, { ea_position: pos, position: pos });
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

export const game_scale = {
  FILE, GROUP_OF, ROOM, MISSING, _FIRST, modules,
  data, keys, group, whole, from_draw, potential_from_draw,
  has_overall, card_formula, card_value, card_attributes, overall, skill_weights, position_skills, card_position,
  overall_version, starter_means,
};
