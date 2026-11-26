// Keeps His Word: your coach's reputation for keeping promises (docs/superpowers/specs/2026-11-10-promises-expansion-
// design.md, section 1). It lives on state["career"]["word"], so it follows you to a new job. Kept promises raise it,
// broken ones cost more, and the broken player's position remembers it on top. Each offseason it drifts back toward
// neutral. Recruits read it when you promise; below FLOOR they do not believe you. Only your coach has one (AI coaches
// make no promises), and it never draws randomness, so the golden sim is untouched. Shown in words, never a number.
import { round, int, get, truthy, minBy } from "../engine_js/pyrt.js";
import { modules } from "../engine_js/modules.js";
import { coaches } from "../sim_js/coaches.js";
import { promises } from "./promises.js";

/** d.get(k, default) for one of this file's own tables asked with a key from outside: only a key the table holds. */
const own = (o, k, d = null) => (typeof k === "string" && Object.hasOwn(o, k) ? o[k] : d);
/** d.setdefault(k, default) */
const setdefault = (o, k, d) => (o[k] === undefined ? (o[k] = d) : o[k]);
/** repr(s) of a string, for an error's words */
const repr = (v) => (typeof v !== "string" ? (v === null || v === undefined ? "None" : v === true ? "True" : v === false ? "False" : String(v))
  : v.includes("'") && !v.includes('"') ? `"${v.replace(/\\/g, "\\\\")}"` : `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`);

const WORD_START = 70;                                   // *tune* where a new coach's word starts (Strong)
const GAIN = { kept: 3, money_kept: 2, package_kept: 2 };   // *tune* what a kept promise adds
const COST = { bent: 2, broken: 8, money_broken: 5, package_broken: 5, recruit_broken: 5 };   // *tune* what a broken one costs
const STAR_COST = 1.5;                                   // *tune* a broken promise to a starter-level player or a four-star-plus recruit costs this much more
const GUARDED_COST = 1.5;                                // *tune* a Guarded player's broken promise costs this much more
const GROUP_EXTRA = 1.0;                                 // *tune* the broken player's position takes the same delta again, times this
const RECOVER = 0.25;                                    // *tune* each offseason the overall moves this share back toward WORD_START
const GROUP_DECAY = 0.5;                                 // *tune* each offseason a position's extra is multiplied by this
const FLOOR = 35;                                        // *tune* below this a recruit does not believe a promise
const PROMISE_MULT = [0.5, 1.5];                         // *tune* a believed promise's points run from this at 0 to this at 100
const CARES_MORE = 1.5;                                  // *tune* a Guarded recruit, or one whose decider is playing time, reads the word this much harder
const STAR_OVR = 87;                                     // *tune* an overall this high makes a transfer a star for STAR_COST
const LOG_KEEP = 20;                                     // the log keeps this many lines

export function _year(state) {
  try {
    const season = modules.season;
    return season.season_year(state);
  } catch (e) {
    return int(Number(get(state, "season_year") || 0));
  }
}

export function _clamp(v) {
  return Math.max(0.0, Math.min(100.0, v));
}

export function _seen(state) {
  // The book without creating it (reads never write into the save).
  return get(get(state, "career") || {}, "word") || {};
}

export function book(state) {
  // The coach's word, created on first use.
  const career = setdefault(state, "career", {});
  if (career["word"] === undefined) career["word"] = { overall: word.WORD_START, by_group: {}, log: [] };
  return career["word"];
}

export function apply(state, kind, group, name, star = false, personality = "") {
  // One kept or broken promise: the overall takes the delta (clamped 0-100), the player's position takes it again on
  // top. Returns the delta.
  let delta;
  if (typeof kind === "string" && Object.hasOwn(word.GAIN, kind)) delta = word.GAIN[kind];
  else if (typeof kind === "string" && Object.hasOwn(word.COST, kind)) {
    delta = -word.COST[kind] * (truthy(star) ? word.STAR_COST : 1.0) * (personality === "guarded" ? word.GUARDED_COST : 1.0);
  } else throw new coaches.ValueError(`unknown word event ${repr(kind)}`);
  const b = word.book(state);
  b["overall"] = word._clamp(get(b, "overall", word.WORD_START) + delta);
  if (truthy(group)) {
    const g = setdefault(b, "by_group", {});
    g[group] = Math.max(-100.0, Math.min(100.0, get(g, group, 0.0) + delta * word.GROUP_EXTRA));
  }
  const log = setdefault(b, "log", []);
  log.push({ year: word._year(state), kind, group, name, delta: round(delta, 2) });
  if (log.length > word.LOG_KEEP) log.splice(0, log.length - word.LOG_KEEP);
  return delta;
}

export function reading(state, group = null) {
  // The word, 0-100: the overall plus the position's extra when given.
  const b = word._seen(state);
  let v = get(b, "overall", word.WORD_START);
  if (truthy(group)) v += get(get(b, "by_group") || {}, group, 0.0);
  return word._clamp(v);
}

export function recover(state, year = null) {
  // An offseason passes: the overall moves RECOVER of the way back to WORD_START; each position's extra fades. Given
  // the offseason's year, once per year.
  const b = word._seen(state);
  if (!Object.keys(b).length || (year !== null && year !== undefined && (get(b, "recovered") || []).includes(String(year)))) return;
  if (year !== null && year !== undefined) setdefault(b, "recovered", []).push(String(year));
  b["overall"] = word._clamp(get(b, "overall", word.WORD_START) + (word.WORD_START - get(b, "overall", word.WORD_START)) * word.RECOVER);
  const faded = {};
  for (const [g, v] of Object.entries(get(b, "by_group") || {})) if (Math.abs(v * word.GROUP_DECAY) >= 0.5) faded[g] = v * word.GROUP_DECAY;
  b["by_group"] = faded;
}

export function word_text(value) {
  const programs = modules.programs;
  for (const [w, f] of programs.WORD_FLOORS) if (value >= f) return w;
  throw new Error("StopIteration");      // (nothing found: a value under every floor)
}

export function last_broken(state, group) {
  // The most recent broken promise's player at this position.
  const log = get(word._seen(state), "log") || [];
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (get(e, "group") === group && typeof get(e, "kind") === "string" && Object.hasOwn(word.COST, get(e, "kind")) && get(e, "kind") !== "bent") return get(e, "name");
  }
  return null;
}

// ----- what feeds it -----------------------------------------------------------------------------------------------------

const BAND_KIND = { kept: "kept", bent: "bent", broken: "broken" };   // a judged season's band -> the word's event ("none": nothing)

export function apply_bands(state, year, bands = null) {
  // Your promised players' season, judged (promises.bands), moves the word once per year. Name, position, overall
  // and stars come from your roster row; a player no longer on it is skipped.
  if (bands === null || bands === undefined) bands = promises.bands(state, year);
  const b = word._seen(state);
  if ((get(b, "applied") || []).includes(String(year))) return;
  const offseason = modules.offseason;
  const me = get(state, "team");
  const rows = new Map();
  for (const c of get(get(get(get(state, "league") || {}, "teams") || {}, me) || {}, "roster") || []) rows.set(c["id"], c);
  for (const [slug, info] of Object.entries(bands)) {
    const kind = own(word.BAND_KIND, get(info, "band")), c = rows.get(slug);
    if (kind === null || c === undefined || c === null) continue;
    const star = offseason.house(c["pos"], c["o"]) >= word.STAR_OVR || (get(c, "s") || 0) >= 4;
    word.apply(state, kind, own(offseason.GROUP, c["pos"], c["pos"]), get(c, "n") || "", star, get(info, "personality") || "");
  }
  setdefault(word.book(state), "applied", []).push(String(year));
}

export function recruit_event(state, slug, pid, kind) {
  // A recruiting promise kept or broken (money, package, roster): your school's only; his position from his EA
  // position, a star at four stars or better.
  if (slug !== get(state, "team")) return;
  const persona = modules.persona, recruiting = modules.recruiting;
  const p = get(state["recruiting"]["prospects"], pid);
  if (p === null) return;
  const star = (get(p, "stars") || 0) >= 4 || (truthy(get(p, "portal")) && (get(p, "tier") || 0) >= recruiting.PORTAL_TOP_TIER);   // a four-star-plus recruit or transfer
  word.apply(state, kind, recruiting._group_of(p), get(p, "name") || "", star,
    persona.of(state, pid)["personality"]);
}

// ----- what recruits read --------------------------------------------------------------------------------------------------

export function promise_mult(state, pid, group, personality = null, decider = null) {
  // What a believed promise is worth, times its base: PROMISE_MULT by the reading at his position (1.0 at 50); a
  // Guarded player, or one whose decider is playing time, reads the distance from 1.0 CARES_MORE times as hard. A
  // recruit's personality and decider come from his persona; a roster player's are passed in.
  const [lo, hi] = word.PROMISE_MULT;
  let m = lo + (hi - lo) * word.reading(state, group) / 100.0;
  if (pid !== null && pid !== undefined && (personality === null || personality === undefined)) {
    const rc = get(state, "recruiting") || {};
    if (Object.hasOwn(get(rc, "prospects") || {}, pid)) {
      const persona = modules.persona;
      const per = persona.of(state, pid);
      personality = get(per, "personality");
      decider = get(per, "decider_topic");
    }
  }
  if (personality === "guarded" || decider === "playing_time") m = 1.0 + (m - 1.0) * word.CARES_MORE;
  return m;
}

export function believes(state, group) {
  // Whether a promise is believed at all: the reading at his position at FLOOR or above.
  return word.reading(state, group) >= word.FLOOR;
}

// ----- what you see (the Office's Keeps His Word card) -------------------------------------------------------------------

const GROUP_NAMES = { QB: "Quarterbacks", RB: "Running Backs", WR: "Receivers", TE: "Tight Ends", OL: "Offensive Linemen",
  DL: "Defensive Linemen", LB: "Linebackers", CB: "Cornerbacks", S: "Safeties", K: "Kickers", P: "Punters" };
const RECENT = 3;                                        // the card shows this many of the latest lines

export function _line(e) {
  const k = get(e, "kind");
  const verb = typeof k === "string" && Object.hasOwn(word.GAIN, k) ? "Kept" : k === "bent" ? "Bent" : "Broke";
  const who = get(e, "name") || "a player";
  return truthy(get(e, "group")) ? `${verb} your word to ${who} (${e["group"]}).` : `${verb} your word to ${who}.`;
}

export function view(state) {
  // The word in a word; the position with the lowest reading when its word is below the overall's; the latest lines.
  const overall = word.reading(state);
  const text = word.word_text(overall);
  let weakest = null;
  const groups = get(word._seen(state), "by_group") || {};
  if (Object.keys(groups).length) {
    const g = minBy(Object.keys(groups), (k) => [word.reading(state, k), k]);
    const low = word.reading(state, g);
    if (low < overall && word.word_text(low) !== text) weakest = { group: g, name: own(word.GROUP_NAMES, g, g), text: word.word_text(low) };
  }
  const recent = (get(word._seen(state), "log") || []).slice(-word.RECENT).reverse().map((e) => word._line(e));
  return { text, weakest, recent };
}

export const word = {
  WORD_START, GAIN, COST, STAR_COST, GUARDED_COST, GROUP_EXTRA, RECOVER, GROUP_DECAY, FLOOR, PROMISE_MULT, CARES_MORE, STAR_OVR,
  LOG_KEEP, _year, _clamp, _seen, book, apply, reading, recover, word_text, last_broken, BAND_KIND, apply_bands, recruit_event,
  promise_mult, believes, GROUP_NAMES, RECENT, _line, view,
};
modules.word = word;
