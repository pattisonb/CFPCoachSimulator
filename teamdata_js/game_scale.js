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
import { round, int, sum, get, truthy } from "../engine_js/pyrt.js";
import { read_json } from "../engine_js/files.js";
import { prospects } from "../career_js/prospects.js";
import { recruits } from "../career_js/recruits.js";

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

export function _base_tenth(ours, grp, key) {
  return round(to_base(ours, grp, key), 1);
}

export function base_from_ours(ours, pos) {
  const g = group(pos);
  const out = {};
  for (const [k, v] of Object.entries(ours)) out[k] = _base_tenth(v, g, k);
  return out;
}

export function from_ea(ratings_ea, pos) {
  // A generated recruit's EA-scale draw, converted once (the source curve, then our scale).
  const curved = {};
  for (const [k, v] of Object.entries(ratings_ea)) curved[k] = recruits.curve(v);
  return ours_from_base(curved, pos);
}

// How far a generated player grows, by position group: his drawn room to potential times this. Set
// so a career's starters settle, season after season, where the real 2026 starters were (tools/long_run.mjs).
const ROOM = { QB: 1.33, RB: 1.0, WR: 1.11, TE: 1.21, OL: 1.24, DL: 1.35, LB: 1.45, CB: 1.48, S: 1.63, K: 1.25, P: 0.85 };

export function potential_from_ea(potential_ea, ours, pos) {
  // A generated player's potential on our scale: his room above his ratings scaled by ROOM.
  const m = get(game_scale.ROOM, group(pos), 1.0);
  const pot = from_ea(potential_ea, pos);
  const out = {};
  for (const [k, v] of Object.entries(pot)) {
    out[k] = int(round(Math.min(99, get(ours, k, v) + m * Math.max(0, v - get(ours, k, v)))));
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
  return truthy(get(d, "overall"));
}

const OVERALL_FLOOR = 0.02;             // *tune* the least any attribute on a position's card counts toward its overall (fit_card_overall)

export function card_formula(pos) {
  // The overall formula at EA position `pos` (or his engine position's group): {"pos": the position it is for,
  // "const", "w": {card attribute: weight}}. On the player card's attributes, the ones the sim plays with.
  const f = get(game_scale.data(), "card_overall") || {};
  const at = f[pos] !== undefined ? pos : get(game_scale._FIRST, group(pos), "QB");
  return f[at] !== undefined ? { pos: at, ...f[at] } : null;
}

export function card_attributes(ours, pos) {
  // His player card's attributes (the sim's) from his skills, at EA position `pos`.
  return prospects.card_attributes(ours, { ea_position: pos, position: pos });
}

export function overall(ours, pos) {
  // Our overall for a player at EA position `pos` (or his engine position's group): a weighted sum of his card's
  // attributes, the same ones the sim plays with and the card shows (card_formula). Every attribute on his position's
  // card counts (OVERALL_FLOOR at the least); some count for much more (football IQ, a position's main skills).
  const f = card_formula(pos);
  if (f) return _card_overall(f["pos"], keys().map((k) => get(ours, k, 50)));
  return legacy_overall(ours, pos) || 1;                                                 // a scale file from before
}

export function legacy_overall(ours, pos) {
  // The overall as first fit, on the skills themselves (the scale file's "overall"; fit() writes it once and nothing
  // refits it). The build's core-skill floor is gated on this one (build_teams.clamp_extremes), so the card's formula and
  // its constants can be refit and recentered without moving an engine rating. None when the scale has no formula yet.
  const fs = get(game_scale.data(), "overall") || {};
  let f = get(fs, pos);
  if (!truthy(f)) f = get(fs, get(game_scale._FIRST, group(pos), "QB"));
  if (!truthy(f)) return null;
  return int(round(Math.max(1, Math.min(99, f["const"] + sum(Object.entries(f["w"]).map(([k, w]) => w * get(ours, k, 50)))))));
}

export function position_skills(pos) {
  // The skills a position is graded on: the ones the overall as first fit weighs (legacy_overall's formula).
  const fs = get(game_scale.data(), "overall") || {};
  let f = get(fs, pos);
  if (!truthy(f)) f = get(fs, get(game_scale._FIRST, group(pos), "QB"));
  if (!truthy(f)) f = {};
  const out = new Set();
  for (const [k, w] of Object.entries(get(f, "w") || {})) if (w > 0) out.add(k);
  return out;
}

export function card_position(p) {
  // The EA position a built player's card is scored at: the one his skills were made for (the build keeps it as
  // "source_position"), else his depth-chart role, else his engine position (which only names the group, so card_formula
  // falls back to the group's first formula: a tackle scored as a guard).
  return get(p, "source_position") || get(p, "role") || p["position"];
}

const _CARD_OVERALL_MAX = 400000;
const _card_overall_cache = new Map();

// the same players are asked again and again (the base league is 12,000 of them)
// `skills`: his skills in keys() order.
export function _card_overall(pos, skills) {
  const at = `${pos}|${skills.join(",")}`;
  const kept = _card_overall_cache.get(at);
  if (kept !== undefined) return kept;
  const f = game_scale.data()["card_overall"][pos];
  const ks = keys();
  const ours = {};
  for (let i = 0; i < ks.length && i < skills.length; i++) ours[ks[i]] = skills[i];
  const card = game_scale.card_attributes(ours, pos);
  const out = int(round(Math.max(1, Math.min(99, f["const"] + sum(Object.entries(f["w"]).map(([k, w]) => w * get(card, k, 50)))))));
  if (_card_overall_cache.size >= _CARD_OVERALL_MAX) _card_overall_cache.clear();
  _card_overall_cache.set(at, out);
  return out;
}
_card_overall.cache_clear = () => _card_overall_cache.clear();

export function overall_version() {
  // Which overall formula this build stores: 2 on the card's attributes, 1 before. A league and a class are stamped
  // with it when they are made ("overall_v"), so opening the career does not work every overall out again.
  return truthy(get(game_scale.data(), "card_overall")) ? 2 : 1;
}

// Python's dict(zip(attrs, values)): the pairs until the shorter one runs out.
function _zip_dict(attrs, values) {
  const out = {};
  for (let i = 0; i < attrs.length && i < values.length; i++) out[attrs[i]] = values[i];
  return out;
}

// The career modules the two upgrades of old saves call. This file cannot import them (they import it), so each is
// put here by whoever loads it: career_js/league.js sets game_scale.modules.league, app_js/game.js sets
// game_scale.modules.recruiting. Without one, an old save that needs it is refused before anything is changed.
const modules = { league: null, recruiting: null };

function _module(name) {
  const m = game_scale.modules[name];
  if (!m) throw new Error(`game_scale: career_js/${name}.js is not loaded (game_scale.modules.${name})`);
  return m;
}

function _portal_players(state) {
  return Object.values(get(get(get(state, "offseason") || {}, "portal") || {}, "players", {})).map((e) => e["player"]);
}

export function upgrade_overalls(state) {
  // A career saved before the overall was built on the card's attributes: every stored overall recomputed (the
  // league's players, the portal's, the recruits' now and at their potential). Returns whether anything changed.
  // A league or class already stamped with this build's formula is left alone (it was 8,000 recruits recomputed on
  // every open of every career, most of the time a saved career took to load).
  const version = overall_version();
  let changed = false;
  const lg = get(state, "league");
  if (truthy(lg) && get(lg, "scale") === "ours" && get(lg, "overall_v", 1) !== version) {
    const attrs = lg["attrs"];
    let players = [];
    for (const t of Object.values(lg["teams"])) for (const c of t["roster"]) players.push(c);
    players = players.concat(_portal_players(state));
    const os = players.map((c) => overall(_zip_dict(attrs, c["r"]), c["pos"]));
    const moved = players.some((c, i) => os[i] !== c["o"]);
    if (moved) _module("league");        // asked for before anything is written, so a refusal leaves the save as it was
    players.forEach((c, i) => { c["o"] = os[i]; });
    lg["overall_v"] = version;
    if (moved) {                      // a new career is already on this formula: its teams files stand
      _module("league").forget(state["id"]);
    }
    changed = true;
  }
  const rc = get(state, "recruiting");
  if (truthy(rc) && get(rc, "scale") === "ours" && truthy(get(rc, "prospects")) && get(rc, "overall_v", 1) !== version) {
    const attrs = rc["attrs"];
    for (const p of Object.values(rc["prospects"])) {
      if (truthy(get(p, "ratings")) && truthy(get(p, "ea_position"))) {
        p["ovr"] = overall(_zip_dict(attrs, p["ratings"]), p["ea_position"]);
        if (truthy(get(p, "potential"))) p["pot_ovr"] = overall(_zip_dict(attrs, p["potential"]), p["ea_position"]);
      }
    }
    rc["overall_v"] = version;
    changed = true;
  }
  return changed;
}

const _FIRST = { QB: "QB", RB: "HB", WR: "WR", TE: "TE", OL: "LG", DL: "DT", LB: "MIKE", CB: "CB", S: "FS", K: "K", P: "P" };

export function engine_means() {
  // The real 2026 build's FBS starter means of the engine's attributes ("POS:attr" -> mean),
  // frozen: a career's later seasons go onto the engine scale through them (build_teams.normalize).
  return get(game_scale.data(), "engine_means");
}

export function card_scale() {
  // The player card attributes' scale ("group|attr" -> [middle, slope above, slope below]), frozen.
  return game_scale.data()["card_scale"];
}

// ----- saves from before: EA numbers converted once ------------------------------------------------

export function _convert(r, g, attrs, pos) {
  const ea = _zip_dict(attrs, r);
  const ours = from_ea(ea, pos);
  const grown = {};
  for (let i = 0; i < attrs.length && i < r.length && i < g.length; i++) grown[attrs[i]] = r[i] + g[i];
  const pot = from_ea(grown, pos);
  const ks = keys();
  const rr = ks.map((k) => get(ours, k, 50));
  return [rr, ks.map((k, i) => Math.max(0, get(pot, k, 50) - rr[i])), overall(ours, pos)];
}

export function upgrade(state) {
  // A career saved while its league and recruits were kept in EA numbers: converted to ours
  // (each read of a prospect keeps how far off it was). Returns whether anything changed.
  let changed = false;
  const lg = get(state, "league");
  const rc = get(state, "recruiting");
  const league_old = truthy(lg) && get(lg, "scale") !== "ours";
  const class_old = truthy(rc) && get(rc, "scale") !== "ours" && truthy(get(rc, "prospects"));
  // asked for before anything is written, so a refusal leaves the save as it was
  const league = league_old ? _module("league") : null;
  const recruiting = class_old ? _module("recruiting") : null;
  if (league_old) {
    const attrs = lg["attrs"];
    let players = [];
    for (const t of Object.values(lg["teams"])) for (const c of t["roster"]) players.push(c);
    players = players.concat(_portal_players(state));
    for (const c of players) [c["r"], c["g"], c["o"]] = _convert(c["r"], c["g"], attrs, c["pos"]);
    lg["attrs"] = keys();
    lg["scale"] = "ours";
    league.forget(state["id"]);
    changed = true;
  }
  if (class_old) {
    const attrs = rc["attrs"];
    const old = new Map();
    for (const [pid, p] of Object.entries(rc["prospects"])) old.set(pid, { ...p["truth"] });
    for (const p of Object.values(rc["prospects"])) {
      const ea_r = p["ratings_ea"], ea_p = p["potential_ea"];
      delete p["ratings_ea"];
      delete p["potential_ea"];
      const n = Math.min(ea_r.length, ea_p.length);
      const [rr, gg, ovr] = _convert(ea_r, ea_r.slice(0, n).map((a, i) => ea_p[i] - a), attrs, p["ea_position"]);
      p["ratings"] = rr;
      p["potential"] = rr.map((a, i) => a + gg[i]);
      p["ovr"] = ovr;
      p["pot_ovr"] = overall(_zip_dict(keys(), p["potential"]), p["ea_position"]);
      for (const k of ["overall_ea", "overall"]) delete p[k];
    }
    rc["attrs"] = keys();
    rc["scale"] = "ours";
    rc["grades"] = "game";
    recruiting._truths(rc["prospects"], rc["attrs"]);
    for (const [pid, read] of Object.entries(rc["reads"])) {
      const p = get(rc["prospects"], pid);
      if (p === null) continue;
      for (const [g, [mean, prec]] of Object.entries(read["g"])) {
        read["g"][g] = [round(p["truth"][g] + (mean - old.get(pid)[g]), 3), prec];
      }
    }
    changed = true;
  }
  return changed;
}

export const game_scale = {
  FILE, ABOVE, BELOW, GROUP_OF, ROOM, OVERALL_FLOOR, _FIRST, modules,
  data, keys, group, to_ours, to_base, ours_from_base, _base_tenth, base_from_ours, from_ea, potential_from_ea,
  has_overall, card_formula, card_attributes, overall, legacy_overall, position_skills, card_position, _card_overall,
  overall_version, upgrade_overalls, engine_means, card_scale, _convert, upgrade,
};
