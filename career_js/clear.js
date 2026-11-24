// What the game knows, said in numbers and letters (it began as "Clear Mode", an experiment that became the game).
//
// - A prospect's scouting shows up to eight of his position's key ratings, each a range that narrows with every look,
//   with the staff's confidence in a word (High, Medium, Low). Potential reads as a letter grade at his position. The
//   report's verdict, strengths and the uncertainty card stay.
// - Players grow by kind (athleticism slowly, technique and the mental game faster), and a year's ceilings can fall too.
//
// Nothing here changes how a game or a recruit plays; it is what the player is shown, and how a roster develops.
import { Random, round, int, sum, get, truthy } from "../engine_js/pyrt.js";
import { modules } from "../engine_js/modules.js";
import { ratings as rv2 } from "../teamdata_js/ratings.js";
import { shown } from "../teamdata_js/shown.js";
import { grades } from "./grades.js";

/** d.get(k, default) for one of this file's own tables asked with a key from outside: only a key the table holds. */
const own = (o, k, d = null) => (typeof k === "string" && Object.hasOwn(o, k) ? o[k] : d);

// confidence is judged on the range the page shows (the read plus WORD_SLACK each side), not the word read's own
// width: half-widths under these are High, then Medium, else Low; a complete report is High *tune*
const CLEAR_CONFIDENCE = [[6.0, "High"], [10.0, "Medium"]];

// each position group's key player-card ratings, most important first (up to eight); the card's own labels name them
const KEYS = {
  QB: ["arm_strength", "short_accuracy", "mid_accuracy", "deep_accuracy", "throw_on_move", "decision_making", "pocket_poise", "football_iq"],
  RB: ["run_vision", "burst", "agility", "elusiveness", "ball_security", "power_running", "top_speed", "tackle_breaking"],
  FB: ["lead_block", "drive_block", "power_running", "strength", "run_vision", "hands", "ball_security", "football_iq"],
  WR: ["hands", "top_speed", "release", "short_routes", "mid_routes", "deep_routes", "contested_catch", "agility"],
  TE: ["hands", "drive_block", "reach_block", "contested_catch", "short_routes", "mid_routes", "release", "strength"],
  OL: ["pass_anchor", "pass_footwork", "drive_block", "reach_block", "strength", "finish_block", "agility", "football_iq"],
  DL: ["power_rush", "speed_rush", "block_shedding", "strength", "burst", "tackling", "pursuit", "diagnosis"],
  LB: ["tackling", "diagnosis", "pursuit", "block_shedding", "zone_coverage", "man_coverage", "hit_power", "top_speed"],
  CB: ["man_coverage", "zone_coverage", "press", "top_speed", "agility", "ball_skills", "diagnosis", "burst"],
  S: ["zone_coverage", "man_coverage", "diagnosis", "tackling", "pursuit", "ball_skills", "top_speed", "hit_power"],
  K: ["kick_power", "kick_accuracy", "football_iq", "stamina"],
  P: ["punt_power", "punt_accuracy", "football_iq", "stamina"],
};

// the physical traits shown for every prospect, after his position's own ratings *tune*
const PHYSICAL = ["top_speed", "burst", "agility", "strength", "leaping"];
const KEY_SKILLS = 5;                   // *tune* how many of his position's own ratings lead the list

// growth by kind (the player's ask): athleticism is mostly set by the time he arrives, coaching shows in
// technique and the mental game. SKILL_RATE is set so the average overall gain a year matches the game's.
const PHYS_RATE = 0.5;                  // *tune* physical ratings close their gap to potential at this share of the usual pace
const SKILL_RATE = 1.08;                // *tune* technique and mental ratings at this share (calibrated: the same average overall gain a year, 4.05 vs 4.07)

// potential that moves both ways each offseason (the player's ask): a year's ceilings can fall too
const CEIL_STRUGGLE = 5;                // *tune* a starter who struggled (his production in a starter's bottom fifth) loses this much room
const CEIL_SOLID = 2;                   // *tune* a solid year (production CEIL_SOLID_Z over the average starter, short of a breakout) adds this
const CEIL_SOLID_Z = 0.0;               // *tune* ... from this production score up (about a starter's top fifth; a breakout is 1.0)
const CEIL_STRUGGLE_Z = -2.0;           // *tune* a struggling year: this production score or under (about a starter's bottom fifth)
const CEIL_SLOW = 1;                    // *tune* the slow coachability levels lose this much room a year, the fast ones gain it
const CEIL_DRIFT_SD = 1.5;              // *tune* every player's ceilings drift this much either way a year (one draw a player)
const SLOW_LEVELS = ["Slow to Click", "Set in His Ways"];
const FAST_LEVELS = ["Coach's Dream", "Film Junkie", "Quick Study"];   // as many players as SLOW_LEVELS (about 30% each), so it nets out

export function struggled(perf) {
  // A starter's hard year by his production (CEIL_STRUGGLE_Z): the one that costs him room.
  const z = get(perf || {}, "z");
  return z !== null && z <= clear.CEIL_STRUGGLE_Z;
}

export function ceiling_drift(p, attrs, perf, year, physical) {
  // Move one player's room to grow (p["g"]) for a year, on his skill and football IQ (never his physical
  // ratings, as a breakout's room): a struggling starter loses CEIL_STRUGGLE and a solid year adds CEIL_SOLID; the slow
  // learners lose CEIL_SLOW and the fast ones gain it; and everyone
  // drifts by a draw of its own stream (`ceiling-{year}-{id}`), so no other draw moves. Room stays within 0 and his
  // ratings' 99. Returns the points of room changed, summed (negative: his ceiling fell).
  // (`physical`: a Set, or a list, of the physical ratings' names.)
  let shift = new Random(`ceiling-${year}-${p["id"]}`).gauss(0, clear.CEIL_DRIFT_SD);
  const z = get(perf || {}, "z");
  if (z !== null && z <= clear.CEIL_STRUGGLE_Z) shift -= clear.CEIL_STRUGGLE;
  else if (z !== null && clear.CEIL_SOLID_Z <= z && z < 1.0) shift += clear.CEIL_SOLID;     // a breakout (z >= 1, offseason.BREAKOUT_FROM) already adds its own room
  if (clear.SLOW_LEVELS.includes(get(p, "c"))) shift -= clear.CEIL_SLOW;
  else if (clear.FAST_LEVELS.includes(get(p, "c"))) shift += clear.CEIL_SLOW;
  const step = int(round(shift));
  if (!step) return 0;
  const before = sum(p["g"]);
  const is_physical = physical instanceof Set ? (k) => physical.has(k) : (k) => physical.includes(k);
  const n = Math.min(attrs.length, p["g"].length, p["r"].length);       // zip stops at the shortest
  const g_new = [];
  for (let i = 0; i < n; i++) {
    const k = attrs[i], g = p["g"][i], v = p["r"][i];
    g_new.push(is_physical(k) ? g : Math.max(0, Math.min(99 - v, g + step)));
  }
  p["g"] = g_new;
  return sum(p["g"]) - before;
}

export function confidence(state, pid, group) {
  // How sure the staff is of a read, in a word: High, Medium or Low (the report's uncertainty, turned around).
  const recruiting = modules.recruiting;
  const mh = clear._raw_half(state, pid, group);
  if (mh === null) return "High";
  if (truthy(recruiting.report_complete(get(state["recruiting"]["reads"], pid)))) return "High";
  const half = Math.max(2.0, mh[1]);                          // the half-width the row shows (ratings' row: at least a couple of points)
  for (const [edge, w] of clear.CLEAR_CONFIDENCE) if (half < edge) return w;
  return "Low";
}

export function _raw_half(state, pid, group) {
  // [mean, half] of a group read without the word slack (the read itself).
  const recruiting = modules.recruiting;
  const spread = recruiting.read_spread(state, pid, group);
  if (spread === null || spread === undefined) return null;
  const [mean, half] = spread;
  return [mean, half + recruiting.WORD_SLACK];
}

export function _group_of_key(p, key) {
  // The scouting group a card rating reads through: athleticism, size and strength, football IQ, else technique.
  const pr = modules.prospects;
  for (const g of ["athleticism", "size_strength", "football_iq"]) {
    if (get(pr.GAME_GROUPS, g, []).includes(key)) return g;
  }
  return "technique";
}

export function measures(state, p) {
  // The ratings a prospect is read on, in the order his card lists them, as [{key, label}]: his position's own first,
  // then the physical traits (what Key Ratings shows; the Prospects table's Measure menu offers the same).
  const pr = modules.prospects, season = modules.season;
  const attrs = get(state["recruiting"], "attrs");
  const ours = {};
  for (let i = 0; i < Math.min(attrs.length, p["ratings"].length); i++) ours[attrs[i]] = p["ratings"][i];
  const cards = pr.card_attributes(ours, p);
  const pos = pr.engine_position(p);
  const grp = own(season.SCALE_GROUP, pos, pos);
  const listed = own(clear.KEYS, grp, []).filter((k) => k in cards);
  const keys = ["K", "P"].includes(grp) ? listed.slice(0, 8)
    : [...listed.filter((k) => !clear.PHYSICAL.includes(k)).slice(0, clear.KEY_SKILLS), ...clear.PHYSICAL.filter((k) => k in cards)];
  return keys.map((k) => ({ key: k, label: rv2.ATTRIBUTES[k][0] }));
}

export function measure(state, pid, key) {
  // One of his key ratings as your staff reads it ({key, label, est, lo, hi, confidence}), or null before any look or
  // when his position is not read on it.
  const r = clear.ratings(state, pid);
  if (r === null) return null;
  const row = r["rows"].find((x) => x["key"] === key);
  return row !== undefined && row["est"] !== null ? row : null;
}

export function ratings(state, pid) {
  // His key ratings as the staff reads them, or null before any look: {"complete", "rows": [{key, label, est, lo, hi,
  // confidence}], "overall": {...}, "potential": {...}}. A rating's estimate is his true card rating moved by the staff's
  // error on its group (the same error the grade words carry), so it is no more exact than a word would be, only
  // said plainly. Always a range: it narrows with every look (a complete report's is a few points wide).
  const pr = modules.prospects, recruiting = modules.recruiting, season = modules.season;
  const rc = state["recruiting"];
  const p = get(rc["prospects"], pid);
  const read = get(rc["reads"], pid);
  if (!truthy(p) || !truthy(read)) return null;
  const complete = recruiting.report_complete(read);
  const attrs = get(rc, "attrs");
  const ours = {};
  for (let i = 0; i < Math.min(attrs.length, p["ratings"].length); i++) ours[attrs[i]] = p["ratings"][i];
  const cards = pr.card_attributes(ours, p);
  const pos = pr.engine_position(p);
  const grp = own(season.SCALE_GROUP, pos, pos);
  // his position's own ratings first (KEY_SKILLS of them, the physical ones left for the end), then the physical traits
  // every prospect is read on (PHYSICAL: the player's ask, "show those physical traits for all prospects"); a kicker's
  // and a punter's stay their own short list
  const listed = own(clear.KEYS, grp, []).filter((k) => k in cards);
  const keys = ["K", "P"].includes(grp) ? listed.slice(0, 8)
    : [...listed.filter((k) => !clear.PHYSICAL.includes(k)).slice(0, clear.KEY_SKILLS), ...clear.PHYSICAL.filter((k) => k in cards)];
  const card_grp = rv2.card_group(pos, pos);

  function row(key, label, truth, group) {
    const mh = clear._raw_half(state, pid, group);
    if (mh === null) return { key, label, est: null, lo: null, hi: null, confidence: null };
    let [mean, half] = mh;
    const err = mean - p["truth"][group];
    const est = Math.max(1, Math.min(99, int(round(truth + err))));
    half = Math.max(2.0, half);                        // never a single number: the read's own width, at least a couple of points
    const lo = Math.max(1, int(round(est - half))), hi = Math.min(99, int(round(est + half)));
    // as the page shows a rating (teamdata_js/shown.js): a card attribute at his card's group, his potential as an overall
    const put = key === "potential" ? (v) => shown.overall(v) : (v) => shown.attribute(v, card_grp, key);
    const out = { key, label, est: put(est), lo: put(lo), hi: put(hi), confidence: clear.confidence(state, pid, group) };
    if (key === "potential") out["ours"] = [est, lo, hi];              // the game's own scale: the letter grades are cut from these
    return out;
  }

  const rows = keys.map((k) => row(k, rv2.ATTRIBUTES[k][0], cards[k], clear._group_of_key(p, k)));
  const pos_label = pr.display_pos(p["ea_position"]);
  const pot = row("potential", `Potential at ${pos_label}`, Number(p["pot_ovr"]), "potential");   // his projected overall at his position
  pot["position"] = pos_label;
  if (truthy(get(pot, "ours"))) {                               // the page shows his potential as letters (grades.js), not these numbers
    const sharp = grades.fine(state, pid);
    const [est_, lo_, hi_] = pot["ours"];
    delete pot["ours"];
    const ends = truthy(complete) ? [est_, est_] : [lo_, hi_];     // a complete report settles on one grade
    pot["grade"] = grades.span(ends[0], ends[1], sharp);
    pot["fine"] = sharp;
    pot["eye"] = Math.round(modules.recruiting.scout_blend(state, pid));        // your staff's blend for him, as the page shows a rating
    pot["eye_needed"] = modules.recruiting.FINE_BLEND;
  }
  const coach = clear._raw_half(state, pid, "coachability") !== null ? clear.confidence(state, pid, "coachability") : null;
  return { complete, looks: recruiting.report_looks(read), rows, potential: pot,
    coach_confidence: coach };                // the Coachability row's confidence (its read stays one word)
}

export const clear = {
  measures, measure,
  CLEAR_CONFIDENCE, KEYS, PHYSICAL, KEY_SKILLS, PHYS_RATE, SKILL_RATE, CEIL_STRUGGLE, CEIL_SOLID, CEIL_SOLID_Z, CEIL_STRUGGLE_Z, CEIL_SLOW,
  CEIL_DRIFT_SD, SLOW_LEVELS, FAST_LEVELS, struggled, ceiling_drift, confidence, _raw_half, _group_of_key, ratings,
};
modules.clear = clear;
