// Coach Career Prospect Profiles (docs/superpowers/specs/2026-10-22-coach-career-design.md,
// section 6): a prospect's public page (the national rankings' read of him, with its own error), a
// written evaluation for the top 300, comps only to real starters and only when close, and your
// staff's grades and comp once they have seen enough of him.
//
// A comp compares where the prospect projects to (his ratings now, grown the way a player of his
// coachability grows over COMP_YEARS offseasons toward his potential) with a player's ratings over
// the attributes that matter most at his EA position.
//
// Ported from coach_career/prospects.py by engine_js/PORTING.md's rules. The modules it asks that may not be
// ported yet (recruiting, persona, clear, grades, offseason, ability_goals) and the season are reached through
// `modules` at the call. What could not be written literally is marked "(port)" where it stands.
import { Random, round, int, get, sum, sorted, cmp, title, truthy, isNumber, odict, floordiv, mod } from "../engine_js/pyrt.js";
import { fmean } from "../engine_js/pystat.js";
import { modules } from "../engine_js/modules.js";
import { build_teams } from "../teamdata_js/build_teams.js";
import { game_scale } from "../teamdata_js/game_scale.js";
import { ratings as rv2 } from "../teamdata_js/ratings.js";
import { shown as shown_scale } from "../teamdata_js/shown.js";       // teamdata/shown.py (this file has its own `shown`)
import { recruits } from "./recruits.js";

export const prospects = {};

// ---- (port) small things Python has built in ------------------------------------------------------------------------

/** `x in c` for a list, a set or a dict (a dict: the key is there). */
function _in(x, c) {
  if (Array.isArray(c)) return c.includes(x);
  if (c instanceof Set) return c.has(x);
  return c[x] !== undefined;
}

/** str.format with named fields: "{noun}" from `vars`. */
function format(text, vars) {
  return text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k]));
}

/** set(x) of a dict (its keys) or a list. */
const members = (x) => (Array.isArray(x) ? x : x instanceof Set ? [...x] : Object.keys(x));

// math.sumprod as CPython 3.13 adds floats: every product exact (its rounding error kept), the total in three doubles.
function dl_sum(a, b) {
  const x = a + b, z = x - a;
  return [x, (a - (x - z)) + (b - z)];
}
function dl_split(x) {
  const t = x * 134217729.0, hi = t - (t - x);
  return [hi, x - hi];
}
function dl_mul(x, y) {
  // the product and what its rounding lost (C's fma(x, y, -z), here by Dekker's splitting: the same number)
  const z = x * y;
  const [xh, xl] = dl_split(x), [yh, yl] = dl_split(y);
  return [z, ((xh * yh - z) + xh * yl + xl * yh) + xl * yl];
}
export function sumprod(p, q) {
  let hi = 0.0, lo = 0.0, tiny = 0.0;
  for (let i = 0; i < p.length; i++) {
    const pr = dl_mul(p[i], q[i]);
    const sm = dl_sum(hi, pr[0]);
    const r1 = dl_sum(lo, pr[1]);
    const r2 = dl_sum(r1[0], sm[1]);
    hi = sm[0]; lo = r2[0]; tiny = tiny + r1[1] + r2[1];
  }
  const last = dl_sum(lo, hi);
  return tiny + last[1] + last[0];
}

// statistics._sqrtprod: sqrt(x * y) with its last digit corrected.
function _sqrtprod(x, y) {
  const h = Math.sqrt(x * y);
  if (!Number.isFinite(h)) {
    if (h === Infinity && Number.isFinite(x) && Number.isFinite(y)) {
      const scale = Math.pow(2.0, -512);
      return _sqrtprod(scale * x, scale * y) / scale;
    }
    return h;
  }
  if (!h) {
    if (x && y) {
      const scale = Math.pow(2.0, 537);
      return _sqrtprod(scale * x, scale * y) / scale;
    }
    return h;
  }
  const d = sumprod([x, h], [y, -h]);
  return h + d / (2.0 * h);
}

/** statistics.correlation(x, y) (Pearson's); null where Python raises StatisticsError (an input that is constant). */
export function correlation(x, y) {
  const n = x.length;
  if (y.length !== n || n < 2) return null;
  const xbar = fmean(x), ybar = fmean(y);            // fsum(x) / n
  const xs = x.map((xi) => xi - xbar), ys = y.map((yi) => yi - ybar);
  const sxy = sumprod(xs, ys), sxx = sumprod(xs, xs), syy = sumprod(ys, ys);
  const den = _sqrtprod(sxx, syy);
  if (den === 0) return null;                        // Python's ZeroDivisionError
  return sxy / den;
}

/** int(text) as Python reads a whole number from text; null where Python raises ValueError. */
function int_text(t) {
  const m = /^\s*([+-]?\d+(?:_\d+)*)\s*$/.exec(t);
  return m ? Number(m[1].replace(/_/g, "")) : null;
}

// ---------------------------------------------------------------------------------------------------------------------

prospects.ROOT = ".";                        // the project root (paths here are from it)
prospects.EVALUATED = 300;                   // the top 300 get a written evaluation and a public comp
prospects.COMP_PERCENTILE = 0.50;            // COMP_MAX_DISTANCE: this percentile of starter-to-starter distances *tune*
prospects.COMP_ATTRIBUTES = 10;              // the attributes compared: those that track a starter's overall most at the position
prospects.COMP_CHOICES = 6;                  // a comp is one of this many nearest players, picked by the recruit's own seed, so a class's best do not all share one comp *tune*
prospects.COMP_YEARS = 4;                    // a comp is who he projects to be after this many offseasons of average growth *tune*
prospects.OUR_COMP_LOOKS = 3;                // looks before your staff offer their own comp
prospects.READ_SHIFT = 0.5;                  // rating points an attribute moves per grade point a read is off *tune*
prospects.PUBLIC_SD = 3.0;                   // the national rankings' error on his grades, in grade points *tune*
prospects.EVAL_GROUPS = ["athleticism", "size_strength", "technique", "football_iq", "potential"];
prospects.GROUP_NAMES = { athleticism: "athleticism", size_strength: "size and strength", technique: "technique",
  football_iq: "football IQ", potential: "upside", coachability: "coachability" };
// the public evaluation's lines: each a whole sentence that names its group once (no "Upside: Big upside")
prospects.STRENGTH_TEXT = {
  athleticism: "Rare athleticism for {a_noun}: he moves better than most at his position.",
  size_strength: "His size and strength are already at a college level; he wins with power.",
  technique: "Polished technique: he plays like a coached, refined {noun}.",
  football_iq: "A high football IQ: he reads the game fast and is rarely out of position.",
  potential: "Real upside: the frame and tools to keep climbing for years.",
};
prospects.WEAKNESS_TEXT = {
  athleticism: "His athleticism is only average for the position; he may lack a top gear.",
  size_strength: "He needs to add size and strength and fill out his frame.",
  technique: "His technique is raw and will need refinement.",
  football_iq: "His football IQ is still developing; his processing can be slow.",
  potential: "Less upside than most: he is closer to his ceiling at this stage.",
};
prospects.STRENGTH_FROM = 60; prospects.WEAKNESS_BELOW = 45;      // the game's scale: a Solid-and-up read is a strength (60), below 45 a weakness
prospects.SOLID_TEXT = "Solid {group} for {a_noun} at this level; not a concern.";
// (port) these two are odicts: Python lists their keys 5 first, a plain object here would list 2 first
prospects.OUTLOOK = odict([
  ["5", "A day-one impact {noun} with early-round NFL upside."],
  ["4", "Projects as a multi-year starter at a Power 4 program."],
  ["3", "A developmental {noun} who could start by his third year."],
  ["2", "A depth {noun} with a path to the field through special teams and development."],
]);
// a kicker's or a punter's: he is not a "first-round" talent or a special teams body, he wins the job or he does not
prospects.OUTLOOK_KICK = odict([["5", "A {noun} who can be a weapon from day one."], ["4", "A {noun} who should win the job early."],
  ["3", "A {noun} who can win the job in time."], ["2", "A depth {noun} who will have to win the job in camp."]]);
prospects.OPENING_KICK = { "All-American": "A rare {noun} who can be a weapon from day one.", Elite: "A gifted {noun} who should win the job early." };
prospects.SCHOOL_KINDS = ["High School", "High School", "High School", "Central", "North", "South", "Catholic", "Prep", "Academy"];


// ----- comps ---------------------------------------------------------------------------------------

let _player_pool = null;
export function player_pool() {
  // Everyone on a roster in the league in play (starters and backups alike), with their skills on our
  // scale and our overall: who a recruit can be compared to.
  if (_player_pool !== null) return _player_pool;
  const season = modules.season;
  const keys = game_scale.keys();
  const out = [];
  for (const [slug, t] of Object.entries(season.load_teams())) {
    if (truthy(get(t, "fictional"))) continue;
    for (const p of [...t["offense"], ...t["defense"]]) {
      if (truthy(get(p, "skills")) && truthy(get(p, "role"))) {
        const skills = {};
        const n = Math.min(keys.length, p["skills"].length);
        for (let i = 0; i < n; i++) skills[keys[i]] = p["skills"][i];
        out.push({ name: p["name"], slug: p["slug"], school: get(t, "school") || t["name"], team: slug,
          position: p["role"], skills, overall: get(p, "ovr"), starter: truthy(get(p, "in_game")) });
      }
    }
  }
  _player_pool = out;
  return out;
}
player_pool.cache_clear = () => { _player_pool = null; };

let _starter_pool = null;
export function starter_pool() {
  // Today's starters in the league in play: what the comps' skills and distances are measured on.
  if (_starter_pool === null) _starter_pool = prospects.player_pool().filter((s) => s["starter"]);
  return _starter_pool;
}
starter_pool.cache_clear = () => { _starter_pool = null; };

const _attributes_cache = new Map();
export function _attributes(position) {
  // The skills compared at a position: those that track a starter's overall most there.
  if (_attributes_cache.has(position)) return _attributes_cache.get(position);
  const starters = prospects.starter_pool().filter((s) => s["position"] === position && get(s, "overall") !== null);
  let out;
  if (starters.length < 3) out = [];
  else {
    const overall = starters.map((s) => s["overall"]);
    const corr = (k) => {
      const r = correlation(starters.map((s) => get(s["skills"], k, 0)), overall);
      return r === null ? 0.0 : r;                 // a skill every starter shares
    };
    out = sorted(Object.keys(starters[0]["skills"]), (k) => -corr(k)).slice(0, prospects.COMP_ATTRIBUTES);
  }
  _attributes_cache.set(position, out);
  return out;
}
_attributes.cache_clear = () => _attributes_cache.clear();

export function _distance(a, b, keys) {
  // (port) Python squares with `** 2`, the C library's pow, which is the nearest double to the square all but about
  // once in 1,200; this is always the nearest. A distance can so differ in its last digit.
  return Math.sqrt(sum(keys.map((k) => { const d = get(a, k, 0) - get(b, k, 0); return d * d; })) / keys.length);
}

const _comp_max_cache = new Map();
export function comp_max_distance(position) {
  // COMP_MAX_DISTANCE at a position: the 30th percentile of distances between its starters.
  if (_comp_max_cache.has(position)) return _comp_max_cache.get(position);
  const starters = prospects.starter_pool().filter((s) => s["position"] === position);
  const keys = prospects._attributes(position);
  const d = [];
  for (let i = 0; i < starters.length; i++) {
    for (let j = i + 1; j < starters.length; j++) d.push(prospects._distance(starters[i]["skills"], starters[j]["skills"], keys));
  }
  d.sort((x, y) => cmp(x, y));
  const out = d.length ? d[int(prospects.COMP_PERCENTILE * (d.length - 1))] : 0.0;
  _comp_max_cache.set(position, out);
  return out;
}
comp_max_distance.cache_clear = () => _comp_max_cache.clear();

export function warm() {
  // Load the starters and each position's comp distance ahead of the first profile.
  for (const position of new Set(prospects.starter_pool().map((s) => s["position"]))) prospects.comp_max_distance(position);
}

export function ceiling(state, p) {
  // A prospect's projected skills (his potential, our scale): what a comp is measured on.
  return modules.recruiting.attributes(state, p, "potential");
}

export function comp(profile_vector, position, pool, key = null) {
  // A player in `pool` at the same position he compares to, or None when nobody is close enough.
  // With a `key` (the recruit, and whose read it is) the comp is one of the COMP_CHOICES nearest,
  // picked by a stream seeded on the key: the same recruit keeps his comp while those players stay
  // his nearest, and two recruits of one mold do not always land on the same name. Without a key,
  // the nearest.
  const keys = prospects._attributes(position);
  if (!keys.length) return null;
  const limit = prospects.comp_max_distance(position);
  let near = sorted(pool.filter((s) => s["position"] === position).map((s) => [prospects._distance(profile_vector, s["skills"], keys), s["team"], s["slug"], s]),
    (x) => x.slice(0, 3));
  near = near.filter((x) => x[0] <= limit).map((x) => x[3]).slice(0, key ? prospects.COMP_CHOICES : 1);
  if (!near.length) return null;
  const best = key ? new Random(`comp-${key}`).choice(near) : near[0];
  const out = {};
  for (const k of ["name", "slug", "school", "team"]) out[k] = best[k];
  out["position"] = prospects.display_pos(best["position"]);
  out["overall"] = shown_scale.overall(get(best, "overall"));     // as the page shows an overall
  return out;
}

export function _shifted(state, p, grades, field = "potential") {
  // His ceiling (`field` "potential") or his skills now ("ratings") as a read sees them: each
  // group's attributes moved by how far the read is off his true grade (grade points to rating points).
  const recruiting = modules.recruiting;
  const groups = { athleticism: recruiting._ATHLETIC, size_strength: recruiting._SIZE, football_iq: recruiting._IQ };
  const out = {};
  for (const [k, v] of Object.entries(recruiting.attributes(state, p, field))) {
    let g = "technique";
    for (const [name, keys] of Object.entries(groups)) if (_in(k, keys)) { g = name; break; }
    const off = prospects.READ_SHIFT * (grades[g] - p["truth"][g]) + prospects.READ_SHIFT / 2 * (grades["potential"] - p["truth"]["potential"]);
    out[k] = Math.max(0, Math.min(99, v + off));
  }
  return out;
}

export function _dev_rate(points) {
  // A coachability grade (recruiting.COACHABILITY_POINTS' scale) as a yearly development rate
  // (recruits.RATE), read between the levels on either side of it.
  const pts = sorted(Object.entries(modules.recruiting.COACHABILITY_POINTS).map(([k, v]) => [v, recruits.RATE[k]]));
  if (points <= pts[0][0]) return pts[0][1];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [a, ra] = pts[i], [b, rb] = pts[i + 1];
    if (points <= b) return ra + (rb - ra) * (points - a) / (b - a);
  }
  return pts[pts.length - 1][1];
}

export function growth_share(points) {
  // How much of the room between his ratings and his potential a player of this coachability
  // grade closes over COMP_YEARS offseasons at the game's own average pace (offseason.develop: his
  // rate, DEV_RATE and the year's curve, no more than DEV_YEAR_CAP a year).
  const offseason = modules.offseason;
  let left = 1.0;
  for (let y = 0; y < prospects.COMP_YEARS; y++) {
    const pace = offseason.YEAR_CURVE[Math.min(offseason.YEAR_CURVE.length - 1, y)];
    left *= 1 - Math.min(offseason.DEV_YEAR_CAP, prospects._dev_rate(points) * offseason.DEV_RATE * pace);
  }
  return 1 - left;
}

export function projection(state, p, grades) {
  // Who a read says he becomes, for a comp: his skills now as the read sees them, each grown by
  // growth_share of its room to his potential (as the read sees that). The read's coachability
  // sets the share: a Coach's Dream nearly reaches his ceiling, a player Set in His Ways stays
  // close to what he is, so two recruits of one ceiling do not project to the same player.
  const now = prospects._shifted(state, p, grades, "ratings"), top = prospects._shifted(state, p, grades, "potential");
  const share = prospects.growth_share(get(grades, "coachability", modules.recruiting.COACHABILITY_POINTS["Steady Grinder"]));
  const out = {};
  for (const [k, v] of Object.entries(now)) out[k] = v + Math.max(0.0, get(top, k, v) - v) * share;
  return out;
}


// ----- "OC likes him": a coordinator vouches for a recruit the read says would start -------------------

prospects.LIKES_TEXT = "Your {role} thinks he starts for you next year.";
prospects.COORDINATORS = { OC: "offensive coordinator", DC: "defensive coordinator" };
prospects.OFFENSE_GROUPS = ["QB", "RB", "WR", "TE", "OL"];
prospects.KICKING_GROUPS = ["K", "P"];
// (class key, {(pid, looks, viewer): the like}): a board builds hundreds of rows
// (port) the class key is kept as its text and the likes in a Map by their key's text: a tuple cannot be a key here
prospects._LIKES = [null, new Map()];

export function read_overall(state, pid) {
  // His overall now as your staff's read sees it, never the truth: the midpoint of each group's read
  // (recruiting.read_interval) moved onto his current attributes (_shifted, "ratings"), scored at his
  // position (game_scale.overall, the roster's own scale). None before any look.
  const recruiting = modules.recruiting;
  const rc = state["recruiting"];
  const p = rc["prospects"][pid], read = get(rc["reads"], pid);
  if (!truthy(read)) return null;
  const grades = {};
  for (const g of recruiting.GROUPS) {
    const [lo, hi] = recruiting.read_interval(state, pid, g);
    grades[g] = (lo + hi) / 2;
  }
  return game_scale.overall(prospects._shifted(state, p, grades, "ratings"), p["ea_position"]);
}

export function staff_likes(state, pid, viewer) {
  // Your coordinator's word on him, from the read: {"who": "OC"|"DC", "name", "text"} when his report
  // is complete (FIND_LOOKS looks, the flags' gate) and his read overall (read_overall) would start on
  // your returning roster at his position group, counted as recruiting.ahead_of counts (the season's
  // roster, seniors out): fewer returning players at or above him than the group starts
  // (offseason.STARTERS: one QB, three receivers, five linemen ...), so a kicker or punter is liked when he
  // beats your returning K or P. The OC speaks for the offense, the DC for the defense, one of them, fixed
  // by the seed, for a kicker or punter; `name` is None while the slot is vacant. Never in the portal,
  // never once he has signed elsewhere. Cached per read, like _ranks.
  const recruiting = modules.recruiting;
  const rc = state["recruiting"];
  const p = get(rc["prospects"], pid), read = get(rc["reads"], pid);
  const st = get(rc["status"], pid) || {};
  if (p === null || truthy(get(p, "portal")) || truthy(get(rc, "portal")) || !recruiting.report_complete(read)
      || (truthy(get(st, "signed")) && st["signed"] !== viewer)) return null;
  const class_key = JSON.stringify([state["id"], recruiting._ck(rc), get(rc, "seed")]);
  let cached = prospects._LIKES;
  if (cached[0] !== class_key) cached = prospects._LIKES = [class_key, new Map()];
  // the read itself: a rewritten read at the same looks is a new one
  const key = JSON.stringify([pid, read["looks"], recruiting.GROUPS.map((g) => read["g"][g][0]), viewer]);
  if (cached[1].has(key)) return cached[1].get(key);
  const offseason = modules.offseason;
  const group = recruiting._group_of(p);
  const ovr = prospects.read_overall(state, pid);
  const ahead = sum(recruiting._returning(viewer, group).map((o) => (o >= ovr ? 1 : 0)));
  let out = null;
  if (ahead < get(offseason.STARTERS, group, 1)) {
    const who = prospects.OFFENSE_GROUPS.includes(group) ? "OC"
      : prospects.KICKING_GROUPS.includes(group) ? new Random(`likes-${rc["seed"]}-${pid}`).choice(["OC", "DC"]) : "DC";
    const member = get(get(state, "career") || {}, "staff", []).find((m) => get(m, "role") === who) ?? null;
    const name = member && truthy(get(member, "name")) && member["name"] !== who ? member["name"] : null;
    out = { who, name, text: format(prospects.LIKES_TEXT, { role: prospects.COORDINATORS[who] }) };
  }
  cached[1].set(key, out);
  return out;
}


// ----- the profile ---------------------------------------------------------------------------------

// ----- what the page shows of him: the game's position, his size, the staff's write-up ----------------
prospects.DISPLAY_POS = { LEDG: "EDGE", REDG: "EDGE", LT: "OT", RT: "OT", LG: "OG", RG: "OG",
  HB: "RB", FB: "RB", SAM: "WILL" };   // the positions the recruiting pages count by (recruiting.SPOTS): C, MIKE, WILL, FS and SS are their own
prospects.POS_NOUNS = { QB: "quarterback", RB: "running back", WR: "receiver", TE: "tight end", OT: "offensive tackle",
  IOL: "interior lineman", OG: "guard", C: "center", MIKE: "middle linebacker", WILL: "outside linebacker",
  FS: "free safety", SS: "strong safety", EDGE: "edge rusher", DT: "defensive tackle", LB: "linebacker",
  CB: "cornerback", S: "safety", K: "kicker", P: "punter", ATH: "athlete" };
prospects.REPORT_LABELS = { athleticism: "Athleticism", football_iq: "Football IQ", technique: "Technique",
  size_strength: "Size / Strength", coachability: "Coachability", potential: "Upside" };
prospects.ATTRIBUTE_GROUPS = ["athleticism", "football_iq", "technique", "size_strength", "coachability"];   // the Attributes card, in order
prospects.GOOD_FROM = 65; prospects.SOLID_FROM = 50;     // a read's midpoint: Strong and up is green, Solid and Fair yellow, Weak red (recruiting.WORD_FLOORS)
prospects.OPENING = {      // the verdict's first sentence, by the potential read's midpoint word
  "All-American": "A rare {noun} with first-round NFL upside.",
  Elite: "A gifted {noun} with early-round NFL upside.",
  Strong: "{A_noun} who projects as a multi-year starter at a Power 4 program.",
  Solid: "A developmental {noun} who could start by his third year.",
  Fair: "A depth {noun} with a path to the field through development.",
  Weak: "A long-term {noun} project who needs years of development.",
};
// a transfer's: he is here for a year or two, so nothing about "multi-year" or "years of development" (the text sweep's
// find: a fifth-year senior "who projects as a multi-year starter")
prospects.OPENING_PORTAL = {
  "All-American": "A proven {noun} ready to start from day one.",
  Elite: "A proven {noun} ready to start from day one.",
  Strong: "A capable {noun} who can compete for a starting job right away.",
  Solid: "A rotation {noun} who can help right away.",
  Fair: "A depth {noun} for the back of the roster.",
  Weak: "A depth {noun} for the back of the roster.",
};
prospects.STRENGTH_LINE = {
  athleticism: "His athleticism stands out: he moves better than most at his position.",
  football_iq: "He reads the game fast and is rarely out of position.",
  technique: "His technique is polished; he plays like a coached, refined {noun}.",
  size_strength: "He already has college size and strength and wins with power.",
  coachability: "Coaches love him: he takes teaching and puts it on the field.",
};
prospects.CONCERN_LINE = {
  athleticism: "His athleticism is only average for the position; he may lack a top gear.",
  football_iq: "He is still learning the game, and his processing can be slow.",
  technique: "His technique is raw and will need real refinement.",
  size_strength: "He needs to add strength and fill out his frame.",
  coachability: "Coaches will have to work to get through to him.",
};
prospects.NO_CONCERN = "There is no glaring hole in his game.";
prospects.UNCERTAINTY = [[6.0, "Low"], [12.0, "Medium"]];   // *tune* a read's half-width in grade points: under this, the word; past both, High
prospects.TRAIT_HINTS = {      // how an unknown trait is revealed, a sentence under "Not Known Yet"
  personality: "Your first call or in-home visit shows it.",
  decider: "Two looks from your staff tell you.",
  story: "A complete report finds it.",
  commit_style: "An official visit, or four weeks holding your offer, shows it.",
};


export function display_pos(ea_position) {
  // His position as the game shows it (LEDG -> EDGE, DT stays DT): the profile, the evaluation and the comp agree.
  return get(prospects.DISPLAY_POS, ea_position, ea_position);
}

export function height_text(h) {
  // 6'5" from inches; a transfer's height already comes as text.
  if (h === null || h === undefined) return null;
  return typeof h === "string" ? h : `${floordiv(int(h), 12)}'${mod(int(h), 12)}"`;
}

export function weight_text(w) {
  return w === null || w === undefined ? null : `${w} lbs`;
}

export function pos_rank(state, pid) {
  // His rank among the class at his game position (display_pos), by national rank.
  const rc = state["recruiting"];
  const key = JSON.stringify([state["id"], modules.recruiting._ck(rc), Object.keys(rc["prospects"]).length, get(rc, "class_v", 0)]);
  let cached = prospects._POS_RANKS;
  if (cached[0] !== key) {
    const seen = {}, out = {};
    for (const q of sorted(Object.keys(rc["prospects"]), (x) => rc["prospects"][x]["rank"])) {
      const d = prospects.display_pos(rc["prospects"][q]["ea_position"]);
      seen[d] = get(seen, d, 0) + 1;
      out[q] = seen[d];
    }
    cached = prospects._POS_RANKS = [key, out];
  }
  return cached[1][pid];
}

prospects._POS_RANKS = [null, {}];           // (port) the key is kept as its text

export function uncertainty(state, pid, group) {
  // How sure the read is, in a word: Low, Medium or High uncertainty (Low once his report is complete).
  const recruiting = modules.recruiting;
  const spread = recruiting.read_spread(state, pid, group);
  if (spread === null) return null;
  if (recruiting.report_complete(get(state["recruiting"]["reads"], pid))) return "Low";
  for (const [edge, w] of prospects.UNCERTAINTY) if (spread[1] < edge) return w;
  return "High";
}

export function report(state, pid) {
  // Your staff's Scouting Report on him, written from the read alone (read_interval: never his true grades):
  // the potential headline, a verdict of two or three sentences, Strengths (his best reads from Solid up, three at
  // most), Areas to Develop (his weakest below Solid, three at most), and the Attributes card's bars (0-100 on the
  // grade scale, with the range's words, a tone and the read's uncertainty). None before his first look.
  const recruiting = modules.recruiting;
  if (!_in(pid, state["recruiting"]["reads"])) return null;
  const p = state["recruiting"]["prospects"][pid];
  const pos = prospects.display_pos(p["ea_position"]);
  const noun = get(prospects.POS_NOUNS, pos, pos);
  const iv = {}, mid = {}, words = {};
  for (const g of recruiting.GROUPS) iv[g] = recruiting.read_interval(state, pid, g);
  for (const g of recruiting.GROUPS) mid[g] = (iv[g][0] + iv[g][1]) / 2;
  for (const g of recruiting.GROUPS) words[g] = [...recruiting.grade_range(state, pid, g)];
  const pot = words["potential"];
  const order = sorted(recruiting.GROUPS, (g) => -mid[g]);
  const strengths = order.filter((g) => mid[g] >= prospects.SOLID_FROM).slice(0, 3);
  const develop = order.slice().reverse().filter((g) => mid[g] < prospects.SOLID_FROM && !strengths.includes(g)).slice(0, 3);
  const skills = order.filter((g) => prospects.ATTRIBUTE_GROUPS.includes(g));
  const best = skills[0], worst = skills[skills.length - 1];
  const a_noun = `${"aeiou".includes(noun.slice(0, 1).toLowerCase()) ? "An" : "A"} ${noun}`;
  const word = recruiting.word(mid["potential"]);
  const opening = truthy(get(p, "portal")) ? prospects.OPENING_PORTAL
    : (pos === "K" || pos === "P") && _in(word, prospects.OPENING_KICK) ? prospects.OPENING_KICK : prospects.OPENING;
  const lines = [format(opening[word], { noun, pos, A_noun: a_noun })];
  if (mid[best] >= prospects.GOOD_FROM) lines.push(format(prospects.STRENGTH_LINE[best], { pos, noun }));
  lines.push(mid[worst] < prospects.SOLID_FROM ? prospects.CONCERN_LINE[worst] : prospects.NO_CONCERN);
  const clamp = (x) => round(Math.max(0.0, Math.min(100.0, x)), 1);
  const tone = (m) => (m >= prospects.GOOD_FROM ? "good" : m >= recruiting.WORD_FLOORS[4] ? "warn" : "bad");
  return {
    headline: pot[0] === pot[1] ? pot[0] : `${pot[0]} – ${pot[1]}`,
    potential: pot, potential_tone: tone(mid["potential"]),
    verdict: lines.join(" "),
    strengths: strengths.map((g) => prospects.REPORT_LABELS[g]),
    develop: develop.map((g) => prospects.REPORT_LABELS[g]),
    attributes: prospects.ATTRIBUTE_GROUPS.map((g) => ({ group: g, label: prospects.REPORT_LABELS[g], words: words[g], lo: clamp(iv[g][0]), hi: clamp(iv[g][1]),
      mid: clamp(mid[g]), word: recruiting.word(mid[g]), tone: tone(mid[g]), uncertainty: prospects.uncertainty(state, pid, g) })),
    certainty: prospects.uncertainty(state, pid, "potential"),
  };
}

export function trait_hints(traits) {
  // How each trait he has not shown yet is revealed: {trait: sentence}, for the traits the view leaves None.
  if (get(traits, "has_style") === false) {            // no commit style to find: no hint for one
    traits = Object.fromEntries(Object.entries(traits).filter(([k]) => k !== "commit_style"));
  }
  const out = {};
  for (const [k, v] of Object.entries(traits)) if (v === null && _in(k, prospects.TRAIT_HINTS)) out[k] = prospects.TRAIT_HINTS[k];
  return out;
}

export function shown(state, p) {
  // The page's display fields for him (a list row and the profile's public block).
  return { display_pos: prospects.display_pos(p["ea_position"]), pos_rank: prospects.pos_rank(state, p["id"]),
    height_display: prospects.height_text(get(p, "height")), weight_display: prospects.weight_text(get(p, "weight")),
    class_of: get(p, "class_of") };
}

export function _public_grades(p) {
  // The national rankings' grades: his true ones with their error; a prospect shown low for his story
  // (an Injury Comeback, a Late Bloomer before his jump: p["real"]) understated by persona.SHOWN_BAND.
  const rng = new Random(`public-${p["id"]}`);
  const low = truthy(get(p, "real")) ? modules.persona.SHOWN_BAND : 0.0;
  const out = {};
  for (const g of modules.recruiting.GROUPS) out[g] = p["truth"][g] + rng.gauss(0, prospects.PUBLIC_SD) - low;
  return out;
}

export function _ranks(state) {
  // (position rank, state rank) for every prospect. Keyed by the recruiting block (recruiting._ck),
  // not its year alone: the transfer portal's block shares its year with the class it replaces.
  const rc = state["recruiting"];
  const key = JSON.stringify([state["id"], modules.recruiting._ck(rc), Object.keys(rc["prospects"]).length, get(rc, "class_v", 0)]);     // a Late Bloomer's jump re-ranks the class
  const cached = prospects._RANKS;                       // one read: another request may swap it in meanwhile
  if (cached[0] === key) return cached[1];
  const pos = {}, home = {}, out = {};
  for (const pid of sorted(Object.keys(rc["prospects"]), (q) => rc["prospects"][q]["rank"])) {
    const p = rc["prospects"][pid];
    pos[p["position"]] = get(pos, p["position"], 0) + 1;
    home[p["hometown"]["state"]] = get(home, p["hometown"]["state"], 0) + 1;
    out[pid] = [pos[p["position"]], home[p["hometown"]["state"]]];
  }
  prospects._RANKS = [key, out];
  return out;
}

prospects._RANKS = [null, {}];               // (port) the key is kept as its text


prospects.DETAIL_PEERS = 8;                  // prospects at his position needed to describe a grade from them alone


export function grade_detail(state, p, group, lo, hi) {
  // What a grade range looks like in ratings: the middle half of the EA ratings of this class's
  // prospects whose true grade falls in the range (at his position when there are enough). A single
  // grade (lo == hi, a complete report's final grade) is described by the prospects whose true grade
  // carries that word (the word's whole band), so the ranges inside the tooltip are still the middle
  // half of his peers. Coachability is described by its labels instead.
  const recruiting = modules.recruiting;
  const rc = state["recruiting"];
  if (lo === hi && group !== "coachability") {                     // one final grade: the prospects graded like that
    [lo, hi] = recruiting.word_band(lo);
  }
  lo = Math.max(recruiting.GRADE_LOW, lo); hi = Math.min(recruiting.GRADE_LOW + recruiting.GRADE_SPAN, hi);
  if (group === "coachability") {
    const labels = Object.entries(recruiting.COACHABILITY_POINTS).filter(([, pts]) => lo - 5 <= pts && pts <= hi + 5).map(([name]) => name);
    let nearest = null, nearest_d = null;                          // min(..., key=...): the first of equals
    if (!labels.length) {
      for (const n of Object.keys(recruiting.COACHABILITY_POINTS)) {
        const d = Math.abs(recruiting.COACHABILITY_POINTS[n] - (lo + hi) / 2);
        if (nearest === null || d < nearest_d) { nearest = n; nearest_d = d; }
      }
    }
    return { labels: labels.length ? labels : [nearest], ratings: {} };
  }
  let peers = Object.values(rc["prospects"]).filter((q) => lo <= q["truth"][group] && q["truth"][group] <= hi);
  const same = peers.filter((q) => q["ea_position"] === p["ea_position"]);
  peers = same.length >= prospects.DETAIL_PEERS ? same : peers;
  if (peers.length < 4) {                         // a narrow read: the nearest prospects instead
    const mid = (lo + hi) / 2;
    peers = sorted(Object.values(rc["prospects"]), (q) => Math.abs(q["truth"][group] - mid)).slice(0, 30);
  }
  if (group === "potential") {
    const vals = peers.map((q) => q["pot_ovr"]);
    const mid = prospects._middle(vals);
    const pos = prospects.engine_position(p);
    return { ratings: { "Projected overall": mid }, peers: peers.length,
      league: { "Projected overall": prospects.league_rank(pos, "overall", (mid[0] + mid[1]) / 2) } };
  }
  const keys = prospects.group_keys(p, group);
  const cards = peers.map((q) => prospects.game_attributes(state, q));
  const ratings = {};
  for (const k of keys) if (cards.some((c) => _in(k, c))) ratings[k] = prospects._middle(cards.filter((c) => _in(k, c)).map((c) => c[k]));
  const pos = prospects.engine_position(p);
  const out = { ratings: {}, peers: peers.length, league: {} };
  for (const [k, v] of Object.entries(ratings)) out.ratings[rv2.ATTRIBUTES[k][0]] = v;
  for (const [k, v] of Object.entries(ratings)) out.league[rv2.ATTRIBUTES[k][0]] = prospects.league_rank(pos, k, (v[0] + v[1]) / 2);
  return out;
}


prospects._LEAGUE = new Map();               // (port) keyed by "group|key": a tuple cannot be a key here


export function reset_caches() {
  // Forget everything worked out from the league's rosters (season.use_league switched it).
  prospects._LEAGUE.clear();
  prospects._RANKS = [null, {}];
  prospects._POS_RANKS = [null, {}];
  prospects._LIKES = [null, new Map()];
  prospects.player_pool.cache_clear();
  prospects.starter_pool.cache_clear();
  prospects._attributes.cache_clear();
  prospects.comp_max_distance.cache_clear();
}

export function league_values(pos, key) {
  // Today's FBS players at a position (linebackers together): their card values of `key`
  // (an attribute, or 'overall'), all of them and the starters, highest first.
  const season = modules.season;
  const group = get(season.SCALE_GROUP, pos, pos);
  const at = `${group}|${key}`;
  if (!prospects._LEAGUE.has(at)) {
    const allv = [], starters = [];
    for (const t of Object.values(season.load_teams())) {
      if (truthy(get(t, "fictional")) || get(t, "subdivision") === "FCS") continue;
      for (const q of [...t["offense"], ...t["defense"]]) {
        if (get(season.SCALE_GROUP, q["position"], q["position"]) !== group) continue;
        const v = key === "overall" ? season.shown_overall(q) : get(get(q, "attributes") || {}, key);
        if (v === null) continue;
        allv.push(v);
        if (truthy(get(q, "in_game"))) starters.push(v);
      }
    }
    prospects._LEAGUE.set(at, [sorted(allv, undefined, true), sorted(starters, undefined, true)]);
  }
  return prospects._LEAGUE.get(at);
}

export function league_rank(pos, key, value) {
  // Where a value would rank among today's players at the position: {rank, of, starter_rank, starters}.
  const [allv, starters] = prospects.league_values(pos, key);
  return { rank: 1 + sum(allv.map((v) => (v > value ? 1 : 0))), of: allv.length,
    starter_rank: 1 + sum(starters.map((v) => (v > value ? 1 : 0))), starters: starters.length, group: pos };
}


// the player card's attributes each grade is read from (technique: the position's skills)
prospects.GAME_GROUPS = { athleticism: ["top_speed", "burst", "agility", "leaping"], size_strength: ["strength", "stamina", "durability"],
  football_iq: ["football_iq"] };


export function engine_position(p) {
  return get(build_teams.POSITION_MAP, p["ea_position"], p["position"]);
}

export function group_keys(p, group) {
  // The player-card attributes a grade is the average of: GAME_GROUPS, technique his
  // position's skills (a kicker's leg), athleticism a specialist's physical ones he has.
  const season = modules.season;
  const pos = prospects.engine_position(p);
  const card = get(rv2.POSITION_ATTRIBUTES, get(season.SCALE_GROUP, pos, pos), []);
  if (group === "technique") return card.filter((k) => rv2.ATTRIBUTES[k][1] !== "Physical" && k !== "return_skill").slice(0, 4);
  const keys = prospects.GAME_GROUPS[group].filter((k) => card.includes(k));
  return keys.length ? keys : card.filter((k) => rv2.ATTRIBUTES[k][1] === "Physical" && k !== "football_iq");
}

export function game_attributes(state, p, field = "ratings") {
  // A prospect's attributes on the game's scale (his EA ratings, or potential with
  // field="potential").
  return prospects.card_attributes(modules.recruiting.attributes(state, p, field), p);
}

export function card_attributes(ours, p) {
  // A prospect's player card attributes from his skills (our scale), exactly as a player's card
  // gets them (build_teams): the skills back through the frozen scale, the card's composites, then
  // the card scale (50 at the middle Power 4 starter at his position).
  const pos = engine_position(p);
  return { ..._card(pos, get(p, "ea_position") || pos, Object.entries(ours)) };
}

const _CARD_MAX = 60000;
const _card_cache = new Map();

// one player's card is asked for more than once (his overall, then his grades)
// `skills`: [skill, value] pairs in his dict's order (Python's tuple(ours.items())).
export function _card(pos, ea_position, skills) {
  const at = `${pos}|${ea_position}|${skills.map((kv) => `${kv[0]}:${kv[1]}`).join(",")}`;
  const kept = _card_cache.get(at);
  if (kept !== undefined) return kept;
  const raw = rv2.raw_attributes(game_scale.base_from_ours(Object.fromEntries(skills), ea_position), pos, pos);
  let group = rv2.card_group(pos, pos);
  group = group === "FB" ? "RB" : group;
  const scale = game_scale.card_scale();
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const [m, hi, lo] = get(scale, `${group}|${k}`, [v, 1.5, 0.9]);
    out[k] = int(round(Math.max(1, Math.min(99, 50 + (v - m) * (v >= m ? hi : lo)))));
  }
  if (_card_cache.size >= _CARD_MAX) _card_cache.clear();
  _card_cache.set(at, out);
  return out;
}
_card.cache_clear = () => _card_cache.clear();

export function _middle(vals) {
  // The middle half of some ratings, as [low, high].
  vals = sorted(vals);
  const pick = (f) => vals[Math.min(vals.length - 1, int(f * (vals.length - 1) + 0.5))];
  return [int(round(Math.max(0, Math.min(99, pick(0.25))))), int(round(Math.max(0, Math.min(99, pick(0.75)))))];
}

export function _high_school(p) {
  const kind = new Random(`school-${p["id"]}`).choice(prospects.SCHOOL_KINDS);
  const city = get(p["hometown"], "city");
  return truthy(city) ? `${city} ${kind}` : null;          // a transfer has no town on file: no school, not " Academy"
}

export function seen_status(state, pid, viewer) {
  // His status as `viewer` sees it: a Quiet Commit's commitment elsewhere is not shown (he reads as
  // uncommitted, marked "quiet").
  const st = state["recruiting"]["status"][pid];
  if (truthy(viewer) && modules.persona.hidden_from(state, viewer, pid)) {
    return { ...st, committed: null, hard: false, firmness: null, quiet: true };
  }
  return st;
}

export function visit_view(state, slug, v) {
  // An official visit as the page shows it: the stored {week, done} plus `game`, the visited school's game that
  // week from the school's side ({week, opponent_name, venue, played, won, points_for, points_against, overtime};
  // the score only once played), or None when it has no game that week (a bye, a portal campus visit). Read-only:
  // the stored visit is never changed.
  if (!truthy(v)) return v ?? null;
  const season = modules.season;
  let g = null;
  for (const x of Object.values(state["games"])) {
    if (x["week"] === v["week"] && (slug === x["home"] || slug === x["away"])) { g = x; break; }
  }
  const out = { ...v, game: null };
  if (g === null) return out;
  const home = g["home"] === slug;
  const played = truthy(get(g, "played")) && get(g, "home_score") !== null && get(g, "away_score") !== null;
  const [pf, pa] = played ? (home ? [g["home_score"], g["away_score"]] : [g["away_score"], g["home_score"]]) : [null, null];
  out["game"] = { week: g["week"], opponent_name: season.team_display(home ? g["away"] : g["home"], season.load_teams()),
    venue: truthy(get(g, "neutral")) ? "neutral" : home ? "home" : "away", played,
    won: played ? pf > pa : null, points_for: pf, points_against: pa,
    overtime: played ? (get(g, "overtime") || 0) : 0 };
  return out;
}

export function _schools(state, pid, viewer = null) {
  // His list: the ten schools he likes most among those recruiting him, the leader first.
  const recruiting = modules.recruiting, season = modules.season;
  const rc = state["recruiting"];
  const teams = season.load_teams();
  const offers = new Set(Object.entries(rc["offers"]).filter(([, pids]) => _in(pid, pids)).map(([s]) => s));
  const schools = new Set([...offers, ...members(rc["lists"][pid])]);
  // (port) a set is walked in no order Python promises; the sort below is by (interest, school), which orders them all
  const rows = sorted([...schools].map((s) => [recruiting.interest(state, s, pid), s]), undefined, true).slice(0, 10);
  const visits = get(rc["visits"], pid, {});
  const pct = {};
  for (const o of prospects.odds(state, pid, undefined, viewer)["schools"]) pct[o["school"]] = o;
  const ranks = get(get(rc, "ranks", {}), pid) || {};
  const now = get(ranks, "now") || {}, prev = get(ranks, "prev") || {};
  const why = get(get(rc, "why", {}), pid) || {};
  const top = rows.length && rows[0][0] > 0 ? rows[0][0] : 1.0;
  return rows.map(([v, s]) => ({ school: s, name: teams[s]["name"], interest: round(v, 1), offered: offers.has(s),
    visit: prospects.visit_view(state, s, get(visits, s)), pct: _in(s, pct) ? round(pct[s]["pct"], 3) : null,
    bar: round(Math.max(0.0, Math.min(1.0, v / top)), 3), rank: get(now, s),
    move: _in(s, prev) && _in(s, now) ? prev[s] - now[s] : null,
    new: truthy(now) && _in(s, now) && !_in(s, prev),
    why: get(get(why, s) || {}, "action") }));
}

export function _evaluation(p, public_) {
  // His three best and two weakest groups, written up: a strength only from Strong/Solid up (60), a weakness
  // only below Fair (45); anything between is "solid" (a five-star's lowest grade is often still good). His position
  // is the game's display (display_pos), as on the rest of his profile.
  const order = sorted(prospects.EVAL_GROUPS, (g) => -public_[g]);
  const pos = prospects.display_pos(p["ea_position"]);
  const noun = get(prospects.POS_NOUNS, pos, pos);
  const a_noun = `${"aeiou".includes(noun[0].toLowerCase()) ? "an" : "a"} ${noun}`;
  const text = (t, g) => format(t, { pos, noun, a_noun, group: prospects.GROUP_NAMES[g] });
  const strengths = [], solid = [], weaknesses = [];
  for (const g of order.slice(0, 3)) {
    (public_[g] >= prospects.STRENGTH_FROM ? strengths : solid).push(text(public_[g] >= prospects.STRENGTH_FROM ? prospects.STRENGTH_TEXT[g] : prospects.SOLID_TEXT, g));
  }
  for (const g of order.slice(-2)) {
    (public_[g] < prospects.WEAKNESS_BELOW ? weaknesses : solid).push(text(public_[g] < prospects.WEAKNESS_BELOW ? prospects.WEAKNESS_TEXT[g] : prospects.SOLID_TEXT, g));
  }
  const table = pos === "K" || pos === "P" ? prospects.OUTLOOK_KICK : prospects.OUTLOOK;
  return { strengths, solid, weaknesses, outlook: format(get(table, modules.recruiting.tier_of(p), prospects.OUTLOOK[2]), { pos, noun }) };
}

export function generational_seen(rc, pid, viewer) {
  // The Generational tag as `viewer` sees it: drawn for him (recruiting.draw_generational) and
  // found by your staff once his report is complete (the same test as a gem or a bust risk: no
  // flag at 2 or 2.5 looks), or shown once he has signed with you. The CPU never reads this; it
  // recruits him as the top prospect he is either way.
  if (truthy(get(rc, "portal")) || !_in(pid, get(rc, "generational") || [])) return false;
  return modules.recruiting.report_complete(get(rc["reads"], pid)) || (viewer !== null && viewer !== undefined && rc["status"][pid]["signed"] === viewer);
}

export function find(state, pid) {
  // Your staff's finding from the read, never the truth: "gem", "bust" or None. Needs a complete
  // report (REPORT_LOOKS looks: no flag at 2 or 2.5); portal prospects get none. The cuts are relative to his star tier (recruiting.flag_cuts):
  // a gem is a three-star or less ranked past GEM_RANK whose potential read, even at its low end,
  // beats the GEM_PERCENTILE (94th) of true potential at his star level; a bust risk is a four- or
  // five-star whose read, even at its high end, sits under the BUST_PERCENTILE (1.75th) of his. A flag
  // holds: `read["find"]`, the finding after his last look (look() keeps it), stays until the read
  // moves FLAG_HOLD points back past its cut, so one look that widens the read does not flicker it.
  const recruiting = modules.recruiting;
  const rc = state["recruiting"];
  const p = rc["prospects"][pid], read = get(rc["reads"], pid);
  if (truthy(get(p, "portal")) || p["stars"] === null || !truthy(read) || !recruiting.report_complete(read)) return null;
  const [mean, half] = recruiting.read_spread(state, pid, "potential");      // the read's own spread: the final grade's collapse to one point (read_interval) does not move a flag's cut
  const lo = mean - half, hi = mean + half;
  const [gem_cut, bust_cut] = get(recruiting.flag_cuts(rc), p["stars"], [99.0, -1.0]);
  const held = get(read, "find");
  if (p["stars"] <= 3 && p["rank"] > recruiting.GEM_RANK && lo >= gem_cut - (held === "gem" ? recruiting.FLAG_HOLD : 0.0)) return "gem";
  if (p["stars"] >= 4 && hi < bust_cut + (held === "bust" ? recruiting.FLAG_HOLD : 0.0)) return "bust";
  return null;
}


prospects.FLIP_WORDS = [[0.15, "Likely"], [0.05, "Real"], [0.0, "Slim"]];     // a flip chance as a word: at or past the share; exactly 0 is "None"


export function flip_word(pct) {
  // A flip chance (a share, 0-1) as the game says it: None, Slim (under 5%), Real (under 15%), Likely.
  if (pct <= 0) return "None";
  for (const [edge, w] of prospects.FLIP_WORDS) if (pct >= edge) return w;
  throw new Error("StopIteration");          // (port) Python's next() with nothing left: a share that is not a number
}

export function flip_view(state, pid, viewer = null) {
  // A committed prospect's chance to flip before signing day, in words, never a number: {"total": the
  // rivals' share together, "word": its word ("Locked In" on a hard commit), "rivals": [{school, name, pct,
  // word}] by pct, the offering schools other than the one he holds}. None unless he holds a verbal or hard
  // commitment to an FBS school (signed, or uncommitted: nothing to flip from) that `viewer` can see.
  const season = modules.season;
  const st = prospects.seen_status(state, pid, viewer);
  if (truthy(st["signed"]) || !truthy(st["committed"]) || st["committed"] === "FCS") return null;
  const o = prospects.odds(state, pid, undefined, viewer);
  const teams = season.load_teams();
  const rivals = sorted(o["schools"].filter((r) => r["school"] !== st["committed"]), (r) => -r["pct"]);
  const total = round(Math.min(1.0, sum(rivals.map((r) => round(r["pct"], 4)))), 4);      // the shares as shown, added: they always sum to the total
  return { total, word: truthy(get(st, "hard")) ? "Locked In" : prospects.flip_word(total),
    rivals: rivals.map((r) => ({ school: r["school"], name: teams[r["school"]]["name"], pct: round(r["pct"], 4), word: prospects.flip_word(r["pct"]) })) };
}

export function _abilities_seen(p) {
  const ability_goals = modules.ability_goals;
  return ability_goals.recruit_abilities(p);
}

export function profile(state, pid, viewer) {
  // The Prospect Profile as `viewer` (your school) sees it. Never carries the true grades. During the portal weeks
  // a recruit of the signed high school class (kept aside, class_rc: Headquarters' replacements, the class widgets)
  // opens from that class.
  const recruiting = modules.recruiting, persona = modules.persona, clear = modules.clear;
  const rc = state["recruiting"];
  if (!_in(pid, rc["prospects"]) && truthy(get(rc, "portal"))) {
    const kept = prospects.class_rc(state);
    if (kept !== rc && _in(pid, kept["prospects"])) return prospects.profile({ ...state, recruiting: kept }, pid, viewer);
  }
  const p = get(rc["prospects"], pid);
  if (p === null || !_in(pid, recruiting.visible(state))) throw new recruiting.RecruitingError(404, "unknown prospect");
  const [pos_rank_, state_rank] = prospects._ranks(state)[pid];
  const status = prospects.seen_status(state, pid, viewer);
  const top = p["rank"] <= prospects.EVALUATED;
  const public_grades = prospects._public_grades(p);
  const public_ = {
    id: pid, name: p["name"], avatar_seed: pid, hometown: { city: p["hometown"]["city"], state: p["hometown"]["state"] },
    high_school: prospects._high_school(p), height: p["height"], weight: p["weight"], position: p["position"],
    ea_position: p["ea_position"], archetype: p["archetype"], stars: p["stars"], composite: p["composite"],
    generational: prospects.generational_seen(rc, pid, viewer), find: prospects.find(state, pid),
    national_rank: p["rank"], position_rank: pos_rank_, state_rank,
    schools: prospects._schools(state, pid, viewer),
    // every school recruiting him, counted (his list above carries the ten he likes most): a transfer can have sixty
    schools_n: new Set([...Object.entries(rc["offers"]).filter(([, pids]) => _in(pid, pids)).map(([s]) => s), ...members(get(rc["lists"], pid) || [])]).size,
    committed: status["committed"], signed: status["signed"], pro: truthy(get(status, "pro")),
    quiet: truthy(get(status, "quiet")),
    hard: truthy(get(status, "hard")) && !truthy(status["signed"]),
    leaning_fcs: truthy(status["fcs"]), offered_by_you: _in(pid, get(rc["offers"], viewer, [])),
    on_board: _in(pid, rc["board"]), favorite: _in(pid, get(rc, "favorites") || []),
    no_room: recruiting.no_room(state, viewer, pid),            // the portal: your roster (or Auto's cap at his position) has no room for him
    trips: get(get(get(rc["contacts"], pid) || {}, viewer) || {}, "scouted", 0),
    priorities_known: [...get(get(rc["revealed"], viewer) || {}, pid, [])],
    pitch_marks: recruiting.pitch_marks(state, viewer, pid),
    ...prospects.shown(state, p),
  };
  const read = get(rc["reads"], pid);
  let our_grades = null;
  if (truthy(read)) {
    our_grades = {};
    for (const g of recruiting.GROUPS) our_grades[g] = [...recruiting.grade_range(state, pid, g)];
  }
  let our_comp = null;
  if (truthy(read) && recruiting.report_looks(read) >= prospects.OUR_COMP_LOOKS && !truthy(get(p, "portal"))) {       // a transfer is who he is: no comp
    const ours = {};
    for (const g of recruiting.GROUPS) ours[g] = read["g"][g][0];
    our_comp = prospects.comp(prospects.projection(state, p, ours), p["ea_position"], prospects.player_pool(), `ours-${pid}`);
  }
  let details = null;
  if (truthy(read)) {
    details = {};
    for (const g of recruiting.GROUPS) details[g] = prospects.grade_detail(state, p, g, ...recruiting.read_interval(state, pid, g));
  }
  const traits = persona.view(state, viewer, pid);
  return {
    public: public_,
    traits,
    trait_hints: prospects.trait_hints(traits),
    report: prospects.report(state, pid),
    need: recruiting.needs_by_spot(state, viewer)[recruiting.spot_of(p)]["need"],     // at his position, as your pages count it
    row: prospects.board_row(state, pid, viewer),          // the board's own line for him: the popup draws the board's pane from it
    twist: persona.twist_view(state, viewer, pid),
    flip: prospects.flip_view(state, pid, viewer),
    grade_details: details,
    evaluation: top && !truthy(get(p, "portal")) ? prospects._evaluation(p, public_grades) : null,    // a high school senior's write-up: not a transfer's
    // the abilities he arrives with, once your staff has looked at him
    abilities: truthy(read) ? prospects._abilities_seen(p) : null,
    public_comp: top && !truthy(get(p, "portal")) ? prospects.comp(prospects.projection(state, p, public_grades), p["ea_position"], prospects.player_pool(), `public-${pid}`) : null,
    our_grades,
    clear: clear.ratings(state, pid),                          // his key ratings in numbers
    looks: prospects.looks_out(read),
    our_comp,
    likes: prospects.staff_likes(state, pid, viewer),
    can_scout: prospects.can_scout(state, viewer, pid),
    scout_cost: recruiting.look_cost(state, viewer, pid),       // a Send's scouting points (as the board row's)
    points_left: recruiting.scout_points_left(state, viewer),     // the week's scouting points left (a Send it cannot pay is disabled)
    ratings: status["signed"] === viewer ? prospects.signed_ratings(state, p) : null,     // signing day shows what you got
    ask: recruiting.ask_view(state, viewer, pid), cooled: recruiting.cooled(state, viewer, pid),
    cooled_why: recruiting.cooled(state, viewer, pid) ? persona.cooled_why(state, viewer, pid) : null,
    stage: recruiting.stage(state, viewer, pid), strength: recruiting.strengths(state, viewer, pid, true),
    pestering: recruiting.would_pester(state, viewer, pid), pesters: recruiting.pesters(state, viewer, pid),
  };
}


// ----- list rows and the Recruiting tab --------------------------------------------------------------


export function row(state, pid, viewer) {
  // A prospect as a line in a list: who he is, where he stands, what you know.
  const recruiting = modules.recruiting, season = modules.season, clear = modules.clear;
  const rc = state["recruiting"];
  const p = rc["prospects"][pid], st = prospects.seen_status(state, pid, viewer);
  const school = st["signed"] || st["committed"];
  const teams = season.load_teams();
  const read = get(rc["reads"], pid);
  const out = {
    quiet: truthy(get(st, "quiet")),
    id: pid, name: p["name"], stars: p["stars"], composite: p["composite"], national_rank: p["rank"],
    generational: prospects.generational_seen(rc, pid, viewer), find: prospects.find(state, pid),
    position: p["position"], ea_position: p["ea_position"], archetype: p["archetype"],
    height: p["height"], weight: p["weight"], home: p["home"], ...prospects.shown(state, p),
    hometown: { city: p["hometown"]["city"], state: p["hometown"]["state"] },
    committed: st["committed"], signed: st["signed"], leaning_fcs: truthy(st["fcs"]),
    ask: recruiting.ask_view(state, viewer, pid, true),     // his NIL ask of you as you know it: the number, or a range
    hard: truthy(get(st, "hard")) && !truthy(st["signed"]),          // a hard commit: the Status column says so, and sorts it over a verbal one
    stage: recruiting.stage(state, viewer, pid),              // where you stand with him: cold, contact, top, visited, committed
    school_name: truthy(get(st, "pro")) ? prospects.PRO : school === "FCS" ? "FCS" : (truthy(school) ? season.team_display(school, teams) : null),
    pro: truthy(get(st, "pro")),
    on_board: _in(pid, rc["board"]), offered: _in(pid, get(rc["offers"], viewer, [])),
    favorite: _in(pid, get(rc, "favorites") || []),          // your own mark (♥): a filter, nothing more
    // your offer is out but he hasn't read it yet: it lands at the week step (contact_week moves past it then)
    offer_landing: _in(pid, get(rc["offers"], viewer, [])) && get(get(rc, "offer_landing") || {}, pid) === recruiting.contact_week(state),
    group: recruiting.spot_of(p),              // his position as your pages count and filter him (recruiting.SPOTS)
    looks: prospects.looks_out(read), scouted: recruiting.report_complete(read), likes: prospects.staff_likes(state, pid, viewer),
    trips: get(get(get(rc["contacts"], pid) || {}, viewer) || {}, "scouted", 0),
    our_potential: truthy(read) ? recruiting.shown_range(state, pid, "potential") : null,
    our_grades: null,
  };
  if (truthy(read)) {
    out.our_grades = {};
    for (const g of recruiting.GROUPS) out.our_grades[g] = [...recruiting.grade_range(state, pid, g)];
  }
  if (truthy(read)) {                                        // his potential as the report reads it (a letter grade)
    const r = clear.ratings(state, pid);
    out.clear_pot = truthy(r) ? r["potential"] : r;
  }
  if (truthy(get(p, "portal"))) {
    Object.assign(out, { portal: true, from: p["from"], from_name: p["from_name"], cls: p["cls"], usage: get(p, "usage"),
      line: get(p, "line"), portal_rank: get(p, "portal_rank") });
  }
  return out;
}

export function _flip_risk(state, pid, viewer) {
  // Your commit's chance to flip, for the board's line: {"word" (Slim, Real, Likely), "school": the rival
  // nearest to flipping him}, or None when nobody is working him (or he is locked in).
  const f = prospects.flip_view(state, pid, viewer);
  if (!truthy(f) || !f["rivals"].length || f["word"] === "None" || f["word"] === "Locked In") return null;
  return { word: f["word"], school: f["rivals"][0]["name"] };
}

export function _role(place) {
  return { start: "Would Start", next: "Next in Line", depth: "Depth" }[place];
}

export function _stage_move(state, pid, viewer) {
  // Which way he moved across the board's columns at the last week step (None: no snapshot, no change).
  const recruiting = modules.recruiting;
  const snap = get(get(state["recruiting"], "stages") || {}, pid);
  const st = state["recruiting"]["status"][pid];
  const held = st["committed"] || st["signed"];
  if (!truthy(snap) || snap["week"] < state["current_week"] - 1 || !(held === null || held === viewer)) return null;
  if (!recruiting.STAGES.includes(snap["now"]) || !recruiting.STAGES.includes(snap["prev"])) return null;
  const d = recruiting.STAGES.indexOf(snap["now"]) - recruiting.STAGES.indexOf(snap["prev"]);
  return d > 0 ? "up" : d < 0 ? "down" : null;
}


prospects.HISTORY_SHOWN = 40;                          // a board row's History: his newest log entries, this many
prospects.HIS_OWN = ["commit", "hard", "flip", "decommit", "signed", "leaning_fcs", "bloomed", "pro", "twist", "hat", "softened"];   // his own moves: every school's show (persona.shown_to: a quiet one, a private one, only its school)
prospects.PRO = "Pro Baseball";                        // where a Two-Sport recruit who took the baseball money went
prospects.HISTORY_KEYS = ["week", "portal_week", "kind", "action", "pitch", "nil", "reaction", "school", "answer", "about", "truthful", "topics", "hit", "line",
  "question", "offered", "why"];   // a Package Deal question's answer (about his mate, offered or not), a promise broken over his mate


export function history_index(state, viewer) {
  // One pass over the log: each prospect's History for the viewer, newest first and capped. His
  // own moves and any school's offer show; everything else only when it is the viewer's.
  const recruiting = modules.recruiting, persona = modules.persona;
  const out = odict();                       // by prospect id (a transfer's can be all digits)
  const log = state["recruiting"]["log"];
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (get(e, "school") !== viewer && !prospects.HIS_OWN.includes(e["kind"]) && e["kind"] !== "offer") continue;
    if (!persona.shown_to(e, viewer)) continue;        // a Quiet Commit's moves, a twist he told another school
    if (out[e["pid"]] === undefined) out[e["pid"]] = [];
    const rows = out[e["pid"]];
    if (rows.length < prospects.HISTORY_SHOWN) {
      const row_ = {};
      for (const k of prospects.HISTORY_KEYS) if (get(e, k) !== null) row_[k] = e[k];
      if (truthy(get(e, "lost"))) {                     // an entrant you recruited went elsewhere: where, and why not you
        row_["line"] = recruiting.lost_line(e, recruiting.school_name);
      }
      rows.push(row_);
    }
  }
  return out;
}

export function board_row(state, pid, viewer, history = null, homes = null) {
  // A board line adds your standing with him: your interest, the leader and his known priorities,
  // and his History (`history`: a `history_index` built once per view; without it, one pass for him).
  // `homes`: your remaining home games (`recruiting.home_weekends`, once per view) for his `visit_weeks`,
  // the Official Visit picker's rows; in the portal (a campus visit, no game) the list is empty.
  const recruiting = modules.recruiting, persona = modules.persona;
  const rc = state["recruiting"];
  if (history === null) history = prospects.history_index(state, viewer);
  if (homes === null) homes = truthy(get(rc, "portal")) ? [] : recruiting.home_weekends(state, viewer);
  const out = prospects.row(state, pid, viewer);
  const schools = prospects._schools(state, pid, viewer);
  const seen = prospects.seen_status(state, pid, viewer);
  const mine = schools.find((s) => s["school"] === viewer) ?? null;
  const contact = () => get(get(rc["contacts"], pid) || {}, viewer) || {};
  out.interest = mine === null ? round(recruiting.interest(state, viewer, pid), 1) : mine["interest"];
  out.leader = schools.length ? schools[0] : null;
  out.schools = schools.length;
  out.visit = prospects.visit_view(state, viewer, get(get(rc["visits"], pid) || {}, viewer));
  out.visit_weeks = recruiting.visit_weekends(state, viewer, pid, homes);
  out.priorities_known = [...get(get(rc["revealed"], viewer) || {}, pid, [])];
  out.pitch_marks = recruiting.pitch_marks(state, viewer, pid);
  out.job_promised = truthy(recruiting._open_roster_promise(contact()));
  out.traits = persona.view(state, viewer, pid);
  out.twist = persona.twist_view(state, viewer, pid);
  out.hc_week = recruiting.hc_visit_week(state, viewer, pid);    // a visit that broke before it opened never counts
  out.hc_wait = recruiting.hc_visit_week(state, viewer, pid) !== null
    ? Math.max(0, recruiting.HC_VISIT_GAP - (state["current_week"] - recruiting.hc_visit_week(state, viewer, pid))) : 0;    // weeks until your head coach can visit again
  out.calls = int(get(contact(), "calls") || 0);   // finished calls: after one, Call is a quick call
  out.done_this_week = Object.entries(get(contact(), "week") || {}).filter(([, w]) => w === recruiting.contact_week(state)).map(([k]) => k);
  out.planned = viewer === get(state, "team") ? [...get(recruiting.planned(state), pid, [])] : [];   // ticked on his row: sent at the week step
  out.visit_cost = recruiting.action_hours(state, viewer, pid, "official_visit"); out.hc_cost = recruiting.action_hours(state, viewer, pid, "hc_visit");                     // your invite by how far he comes
  out.nil = get(get(get(rc["nil"], viewer, {}), "held", {}), pid, 0);
  out.need = recruiting.needs_by_spot(state, viewer)[recruiting.spot_of(rc["prospects"][pid])]["need"];
  out.ask = recruiting.ask_view(state, viewer, pid); out.cooled = recruiting.cooled(state, viewer, pid);
  out.money_owed = recruiting.money_owed(state, viewer, pid);
  out.cooled_why = recruiting.cooled(state, viewer, pid) ? persona.cooled_why(state, viewer, pid) : null;
  out.stage = recruiting.stage(state, viewer, pid); out.strength = recruiting.strengths(state, viewer, pid, true);
  out.pestering = recruiting.would_pester(state, viewer, pid); out.pesters = recruiting.pesters(state, viewer, pid);
  out.stage_move = prospects._stage_move(state, pid, viewer);
  out.scene = get(get(get(rc, "scenes") || {}, viewer) || {}, pid);
  out.list = schools.slice(0, 5).map((x) => ({ ...x, you: x["school"] === viewer }));
  out.firmness = seen["committed"] === viewer && !truthy(seen["signed"]) ? get(seen, "firmness") : null;
  out.hard = truthy(get(seen, "hard")) && !truthy(seen["signed"]);
  out.flip = seen["committed"] === viewer && !truthy(seen["signed"]) ? prospects._flip_risk(state, pid, viewer) : null;
  out.can_scout = prospects.can_scout(state, viewer, pid);
  out.scout_cost = recruiting.look_cost(state, viewer, pid);
  out.role = prospects._role(recruiting.depth_place(state, viewer, pid));
  out.standing = prospects.standing(state, pid, viewer);
  out.no_room = recruiting.no_room(state, viewer, pid);
  out.history = get(history, pid, []);
  return out;
}

export function looks_out(read) {
  // A read's looks for a view: in trip units, never past REPORT_LOOKS, whole numbers as ints (2, 1.5, 3).
  // (port) a whole number is one number here, float or int: the looks as they are
  return modules.recruiting.report_looks(read);
}

export function can_scout(state, viewer, pid) {
  // Whether you can still send a scout: not once he has signed or committed to you, nor once his report is complete.
  const rc = state["recruiting"];
  const st = rc["status"][pid];
  return !truthy(st["signed"]) && st["committed"] !== viewer && !modules.recruiting.report_complete(get(rc["reads"], pid));
}

export function signed_ratings(state, p) {
  // A signee's full ratings, as his roster card will show them: every attribute now and at his
  // potential, with his overall and projected overall.
  const keys = [...game_scale.keys()];
  const grp = game_scale.group(p["ea_position"]);            // every number as the page shows it (teamdata/shown.py)
  const rows = [];
  const n = Math.min(keys.length, p["ratings"].length, p["potential"].length);
  for (let i = 0; i < n; i++) {
    const k = keys[i], v = p["ratings"][i], q = p["potential"][i];
    rows.push({ key: k, label: _in(k, rv2.ATTRIBUTES) ? rv2.ATTRIBUTES[k][0] : title(k.replaceAll("_", " ")),
      value: shown_scale.skill(v, grp, k), potential: shown_scale.skill(q, grp, k) });
  }
  return { overall: shown_scale.overall(p["ovr"]), potential_overall: shown_scale.overall(p["pot_ovr"]), attributes: rows };
}

export function standing(state, pid, viewer) {
  // Where you stand with him, as the board shows it: your place among the offering schools,
  // your chance as a range that narrows toward signing day, and the leader. `place` is None
  // until you offer.
  const season = modules.season;
  const o = prospects.odds(state, pid, undefined, viewer);
  const order = o["schools"].map((r) => r["school"]);
  const mine = o["schools"].find((r) => r["school"] === viewer) ?? null;
  const lead = o["schools"].length ? o["schools"][0] : null;
  const rnd = (x) => round(x, 3);
  return { place: mine ? order.indexOf(viewer) + 1 : null, of: order.length,
    pct: mine ? rnd(mine["pct"]) : null, lo: mine ? rnd(mine["lo"]) : null,
    hi: mine ? rnd(mine["hi"]) : null, certainty: o["certainty"], field: rnd(o["field"]),
    leader: lead ? { school: lead["school"], name: season.load_teams()[lead["school"]]["name"], pct: rnd(lead["pct"]) } : null };
}


prospects.INTEREST_LEVELS = [[0.15, "High"], [0.5, "Medium"], [1.0, "Low"]];   // *tune* the shares of a star band shown High, then Medium; the rest Low


export function your_interest(state, viewer, pids) {
  // Each prospect's interest in your school, and the cut-offs of the levels shown, per star rating:
  // a prospect is graded against the prospects of his own star rating you can see (High for the top
  // 15% of his star band, Medium for the next 35%, Low for the rest), so High means he likes you more
  // than most recruits of his caliber do, whatever his caliber. Returns `(values, cuts)`, `cuts` a
  // dict star -> the levels' cut-offs; a band with no prospects is graded Low.
  const recruiting = modules.recruiting;
  const win = recruiting._winning(state);
  const rc = state["recruiting"];
  const vals = odict();                      // by prospect id, in the order asked
  for (const pid of pids) vals[pid] = recruiting.interest(state, viewer, pid, win);
  const bands = odict();                     // by stars (5, 4, ... or None in the portal), in the order met
  for (const pid of pids) {
    const stars = rc["prospects"][pid]["stars"];
    if (bands[stars] === undefined) bands[stars] = [];
    bands[stars].push(vals[pid]);
  }
  const cuts = odict();
  for (const [stars, values] of Object.entries(bands)) {
    const ordered = sorted(values, undefined, true);
    cuts[stars] = prospects.INTEREST_LEVELS.map(([share]) => ordered[Math.min(ordered.length - 1, int(share * ordered.length))]);
  }
  return [vals, cuts];
}

export function _level(value, stars, cuts) {
  // The level shown for `value` against the cut-offs of his star band (`cuts[stars]`).
  const band = get(cuts, stars);
  if (!truthy(band)) return "Low";
  const n = Math.min(prospects.INTEREST_LEVELS.length, band.length);
  for (let i = 0; i < n; i++) if (value >= band[i]) return prospects.INTEREST_LEVELS[i][1];
  return "Low";
}

export function _height_in(h) {
  // Inches (a class stores 74; a portal entrant 6'2"); 0 when unknown.
  if (isNumber(h)) return int(h);
  const parts = String(h === null || h === undefined ? "None" : h).replaceAll('"', "").split("'");
  if (parts.length !== 2) return 0;
  const ft = int_text(parts[0]), inch = int_text(parts[1] || "0");
  if (ft === null || inch === null) return 0;
  return ft * 12 + inch;
}


// the Status column's order, furthest along first: signed, a hard commit, a verbal one, then where you stand with the
// uncommitted (recruiting.stage: visited, his top group, in contact, cold), the FCS leaners last
prospects.STATUS_ORDER = { signed: 0, hard: 1, committed: 2, visited: 3, top: 4, contact: 5, cold: 6, leaning_fcs: 7 };


export function _sort_key(state, viewer, key, keen) {
  // A Prospects column's sort key (best or first on top; ties by national rank): rank, interest, name, pos, ht, wt,
  // stars, status, offers (the schools that have offered), ask (his NIL ask of you), sc (your looks), pot (your potential read; unscouted last).
  const recruiting = modules.recruiting;
  const rc = state["recruiting"];
  const P = rc["prospects"];
  if (key === "interest" || key === "int") return (pid) => -keen[pid];
  if (key === "name" || key === "who") return (pid) => P[pid]["name"].toLowerCase();
  if (key === "pos") return (pid) => P[pid]["position"];
  if (key === "ht") return (pid) => -prospects._height_in(P[pid]["height"]);
  if (key === "wt") return (pid) => -(P[pid]["weight"] || 0);
  if (key === "stars") {
    const cls = { FR: 1, FRRS: 2, SO: 3, SORS: 4, JR: 5, JRRS: 6, SR: 7, SRRS: 8 };   // the portal's Class column
    return (pid) => (get(P[pid], "stars") !== null ? -(P[pid]["stars"] || 0) : get(cls, get(P[pid], "cls"), 9));
  }
  if (key === "status") {
    return (pid) => {
      const x = prospects.seen_status(state, pid, viewer);
      if (truthy(x["signed"]) || truthy(x["committed"])) {
        return prospects.STATUS_ORDER[truthy(x["signed"]) ? "signed" : truthy(get(x, "hard")) ? "hard" : "committed"];
      }
      return prospects.STATUS_ORDER[truthy(x["fcs"]) ? "leaning_fcs" : recruiting.stage(state, viewer, pid)];
    };
  }
  if (key === "ask") {                          // his NIL ask of you as you know it (a range by its middle), biggest first
    return (pid) => {
      const a = recruiting.ask_view(state, viewer, pid, true);
      return -(_in("exact", a) ? a["exact"] : (a["lo"] + a["hi"]) / 2);
    };
  }
  if (key === "offers") {                       // the schools that have offered him, most first
    const n = {};
    for (const pids of Object.values(rc["offers"])) for (const pid of pids) n[pid] = get(n, pid, 0) + 1;
    return (pid) => -get(n, pid, 0);
  }
  if (key === "sc") return (pid) => -recruiting.report_looks(get(rc["reads"], pid));
  if (key === "pot") {
    const sharp = modules.grades.fine(state);                               // once, not once a prospect
    return (pid) => {
      // by the letters the page shows (best first), never the number behind them: two B's tie, and rank breaks it
      const shown_ = truthy(get(rc["reads"], pid)) ? recruiting.shown_range(state, pid, "potential", sharp) : null;
      if (!truthy(shown_)) return Infinity;                                 // unscouted last
      return modules.grades.sort_key(shown_);
    };
  }
  return (pid) => P[pid]["rank"];
}

export function search(state, viewer, position = null, stars = null, home = null, status = null, q = null,
  offset = 0, limit = 50, sort = "rank", group = null, cols = null) {
  // The class you can see, filtered and paged, by national rank or any column (`sort`: _sort_key's names, "-" first to
  // reverse; "interest" is interest in your school). `status="interested"` keeps those graded High: the prospects your
  // school appeals to most among recruits of their star rating. `cols` filters by the table's columns (the player's
  // ask): `commit` (open, committed, signed), `interest` (High, Medium, Low), `scouted` (none, partly, fully), `pot` (a
  // letter: your read's best grade starts with it), and a low and a high end for ht (inches), wt, offers (the schools
  // that have offered) and ask (his NIL ask of you as you know it, a range by its middle): ht_min, ht_max and so on.
  const recruiting = modules.recruiting;
  const rc = state["recruiting"];
  cols = Object.fromEntries(Object.entries(cols || {}).filter(([, v]) => !(v === null || v === undefined || v === "")));
  let span = {};
  for (const k of ["ht", "wt", "offers", "ask"]) {
    const pair = [get(cols, `${k}_min`), get(cols, `${k}_max`)];
    if (!(pair[0] === null && pair[1] === null)) span[k] = pair;
  }
  const offers_n = {};
  if (_in("offers", span)) {
    for (const pids of Object.values(rc["offers"])) for (const x of pids) offers_n[x] = get(offers_n, x, 0) + 1;
  }
  const sharp = truthy(get(cols, "pot")) ? modules.grades.fine(state) : null;
  let keen, cuts;

  const within = (k, v) => {
    const [lo, hi] = span[k];
    return (lo === null || v >= lo) && (hi === null || v <= hi);
  };

  const col_ok = (pid, p, st) => {
    const c = get(cols, "commit");
    if (c === "open" && (truthy(st["committed"]) || truthy(st["signed"]))) return false;
    if (c === "committed" && !(truthy(st["committed"]) && !truthy(st["signed"]))) return false;
    if (c === "signed" && !truthy(st["signed"])) return false;
    if (truthy(get(cols, "interest")) && prospects._level(keen[pid], p["stars"], cuts) !== cols["interest"]) return false;
    if (truthy(get(cols, "scouted"))) {
      const read = get(rc["reads"], pid);
      const n = recruiting.report_looks(read);
      if (cols["scouted"] !== (recruiting.report_complete(read) ? "fully" : n ? "partly" : "none")) return false;
    }
    if (truthy(get(cols, "pot"))) {
      const shown_ = truthy(get(rc["reads"], pid)) ? recruiting.shown_range(state, pid, "potential", sharp) : null;
      if (!truthy(shown_) || !String(shown_[shown_.length - 1]).startsWith(cols["pot"])) return false;
    }
    if (_in("ht", span) && !within("ht", prospects._height_in(p["height"]))) return false;
    if (_in("wt", span) && !within("wt", p["weight"] || 0)) return false;
    if (_in("offers", span) && !within("offers", get(offers_n, pid, 0))) return false;
    if (_in("ask", span)) {
      const a = recruiting.ask_view(state, viewer, pid, true);
      if (!within("ask", _in("exact", a) ? a["exact"] : (a["lo"] + a["hi"]) / 2)) return false;
    }
    return true;
  };

  q = (q || "").trim().toLowerCase();
  let out = [];
  const visible = recruiting.prospect_list(state);
  [keen, cuts] = prospects.your_interest(state, viewer, visible);
  const recs = odict();                      // by prospect id, in the recommendations' order
  if (status === "recommended") for (const r of recruiting.recommended(state, viewer)) recs[r["pid"]] = r;
  const has_cols = Object.keys(cols).length > 0;
  for (const pid of visible) {
    const p = rc["prospects"][pid], st = prospects.seen_status(state, pid, viewer);
    if (truthy(position) && !(position === p["position"] || position === p["ea_position"])) continue;
    if (!recruiting.spot_matches(p, group)) continue;
    if (status === "recommended" && !_in(pid, recs)) continue;
    if (truthy(stars) && p["stars"] !== stars) continue;
    if (truthy(home) && p["hometown"]["state"] !== home) continue;
    if (q && !p["name"].toLowerCase().includes(q)) continue;
    if (status === "open" && (truthy(st["committed"]) || truthy(st["signed"]))) continue;
    if (status === "committed" && !(truthy(st["committed"]) && !truthy(st["signed"]))) continue;
    if (status === "signed" && !truthy(st["signed"])) continue;
    if (status === "leaning_fcs" && !truthy(st["fcs"])) continue;
    if (status === "offered" && !_in(pid, get(rc["offers"], viewer, []))) continue;
    if (status === "favorites" && !_in(pid, get(rc, "favorites") || [])) continue;
    if (status === "board" && !_in(pid, rc["board"])) continue;
    if (status === "interested" && (prospects._level(keen[pid], p["stars"], cuts) !== "High" || truthy(st["signed"]))) continue;
    if (has_cols && !col_ok(pid, p, st)) continue;
    out.push(pid);
  }
  // the sort you picked holds whatever the filter (the player's report: Interested in You forced its own order); a
  // column's key, "-" first for the other way. Recommended keeps its fit order until you pick another sort.
  const desc = sort.startsWith("-");
  const key = sort.replace(/^-+/, "") || "rank";
  if (key === "rank" && status === "recommended" && !desc) {
    out = sorted(out, (pid) => -recs[pid]["fit"]);
  } else {
    const fn = prospects._sort_key(state, viewer, key, keen);
    out = sorted(out, (pid) => rc["prospects"][pid]["rank"]);     // ties stay in national rank order either way (a stable sort)
    out = sorted(out, fn, desc);
  }
  limit = Math.max(1, Math.min(5000, limit));
  const rows = [];
  for (const pid of out.slice(offset, offset + limit)) {
    const r = prospects.row(state, pid, viewer);
    r.interest_in_you = round(keen[pid], 1); r.interest_level = prospects._level(keen[pid], rc["prospects"][pid]["stars"], cuts);
    r.can_scout = prospects.can_scout(state, viewer, pid); r.hard = truthy(get(rc["status"][pid], "hard")) && !truthy(rc["status"][pid]["signed"]);
    if (_in(pid, recs)) r["why"] = recs[pid]["why"];
    r["offers_n"] = sum(Object.values(rc["offers"]).map((pids) => (_in(pid, pids) ? 1 : 0)));     // how many schools have offered him
    rows.push(r);
  }
  const needs = recruiting.needs_by_spot(state, viewer);                   // by position: OT, OG and C, EDGE and DT, MIKE and WILL, FS and SS
  return { total: out.length, rows, needs, recommended_ids: Object.keys(recs),
    summary: prospects.class_summary(state, viewer, visible, needs) };
}


prospects.TOP_UNCOMMITTED = 12;        // *tune* the best uncommitted prospects listed under the map (the side column's height)
prospects.MAP_CITIES = 30;             // *tune* towns a state sends the big map (it draws the ones that do not crowd)
prospects.TOP_IN_STATE = 12;           // *tune* ... and the best of each state, shown when one is picked on the map


export function class_summary(state, viewer, visible, needs) {
  // The Prospects tab's side column and header, over the whole class you can see (never the filters):
  // the class by star level, your footprint (on your board, in contact, evaluated by your staff), your
  // class so far (commits against the spots to fill, and commits by star level: plain counts, no targets)
  // and the best uncommitted prospects in the country.
  const rc = state["recruiting"];
  const stars = odict([["5", 0], ["4", 0], ["3", 0], ["2", 0]]);      // (port) odicts: Python lists these 5 first
  const mine = odict([["5", 0], ["4", 0], ["3", 0], ["2", 0]]);
  let contact = 0, evaluated = 0;
  const top = [];
  const top_in = {};
  const offers = new Set(get(rc["offers"], viewer, []));
  const board = new Set(rc["board"]);
  const towns = {};                          // per home state, the class by town: {town: [n, lat, lon]}
  const board_at = [];                       // the map's dots: [state, lat, lon, what he is to you ("board offered scouted committed")]
  const by_state = {};                       // the new UI's tile map: per home state, the class, its blue chips, your board
  for (const pid of visible) {
    const p = rc["prospects"][pid], st = prospects.seen_status(state, pid, viewer);
    const k = String(get(p, "stars") || 0);
    if (_in(k, stars)) stars[k] += 1;
    const home = get(get(p, "hometown") || {}, "state");
    if (truthy(home)) {
      if (by_state[home] === undefined) by_state[home] = { n: 0, blue: 0, board: 0 };
      const cell = by_state[home];
      cell["n"] += 1;
      cell["blue"] += (get(p, "stars") || 0) >= 4 ? 1 : 0;
      cell["board"] += board.has(pid) ? 1 : 0;
      let town = get(p, "hometown") || {};
      if (truthy(get(town, "city")) && get(town, "lat") !== null) {
        if (towns[home] === undefined) towns[home] = odict();
        if (towns[home][town["city"]] === undefined) towns[home][town["city"]] = [0, town["lat"], town["lon"]];
        towns[home][town["city"]][0] += 1;
      }
      const tags = [["board", board.has(pid)], ["offered", offers.has(pid)], ["scouted", truthy(get(rc["reads"], pid))],
        ["committed", (st["signed"] || st["committed"]) === viewer]].filter(([, on]) => on).map(([name]) => name);
      if (tags.length) {
        town = get(p, "hometown") || {};
        board_at.push([home, get(town, "lat"), get(town, "lon"), tags.join(" ")]);
      }
    }
    const c = get(get(rc["contacts"], pid) || {}, viewer) || {};
    if (truthy(get(c, "n")) || offers.has(pid)) contact += 1;
    if (truthy(get(rc["reads"], pid))) evaluated += 1;
    if ((st["signed"] || st["committed"]) === viewer && _in(k, mine)) mine[k] += 1;
    if (!(truthy(st["signed"]) || truthy(st["committed"]) || truthy(get(st, "pro")))) {
      const line = { id: pid, name: p["name"], stars: get(p, "stars") || 0, national_rank: p["rank"],
        display_pos: prospects.display_pos(p["ea_position"]), position: p["position"], portal: truthy(get(p, "portal")),
        home: [get(get(p, "hometown") || {}, "city"), home].filter((x) => truthy(x)).join(", ") };
      if (top.length < prospects.TOP_UNCOMMITTED) top.push(line);
      if (truthy(home)) {
        if (top_in[home] === undefined) top_in[home] = [];
        if (top_in[home].length < prospects.TOP_IN_STATE) top_in[home].push(line);
      }
    }
  }
  const commits = sum(Object.values(needs).map((r) => r["commits"]));
  const cities = {};
  // the big map's one-state view: each state's biggest towns of this class, [name, lat, lon, prospects]
  for (const [st, ts] of Object.entries(towns)) {
    cities[st] = sorted(Object.entries(ts), (kv) => [-kv[1][0], kv[0]]).slice(0, prospects.MAP_CITIES).map(([name, v]) => [name, v[1], v[2], v[0]]);
  }
  return { stars, total: visible.length,
    footprint: { board: rc["board"].length, contact, evaluated },
    outlook: { commits, spots: commits + sum(Object.values(needs).map((r) => Math.max(0, r["need"]))), by_stars: mine },
    top, top_in, board_at, by_state, cities };
}


export class class_block {
  // `with class_block(state):` the high school class is the recruiting block for the calls inside
  // (during the portal weeks the transfer pool holds that place; the classes views need the class).
  // (port) there is no `with` here: `const b = new class_block(state); b.__enter__(); try { ... } finally { b.__exit__(); }`

  constructor(state) {
    this.state = state; this.swapped = false;
  }

  __enter__() {
    const rc = get(this.state, "recruiting") || {};
    if (truthy(get(rc, "portal")) && truthy(get(this.state, "recruiting_last"))) {
      [this.state["recruiting"], this.state["recruiting_last"]] = [this.state["recruiting_last"], rc];
      this.swapped = true;
    }
    return this.state;
  }

  __exit__() {
    if (this.swapped) {
      [this.state["recruiting"], this.state["recruiting_last"]] = [this.state["recruiting_last"], this.state["recruiting"]];
    }
  }
}

export function class_rc(state) {
  // The high school class's recruiting block (during the portal weeks, the signed class kept aside).
  const rc = state["recruiting"];
  return truthy(get(rc, "portal")) ? (truthy(get(state, "recruiting_last")) ? state["recruiting_last"] : rc) : rc;
}

export function national_classes(state, viewer = null) {
  // Every FBS school's class (its commitments, or signees once they sign), ranked by class_table as
  // the viewer sees them: count, stars, its three best recruits; and where the calendar is.
  const recruiting = modules.recruiting, season = modules.season;
  const rc = prospects.class_rc(state);
  const teams = season.load_teams();
  const table = prospects.class_table(state, viewer);
  let rows = [];
  for (const slug of recruiting.fbs_schools(state)) {
    const t = table[slug];
    const pids = t["pids"];
    const stars = odict();                   // (port) an odict: Python lists these 5 first
    for (const n of [5, 4, 3, 2]) stars[String(n)] = sum(pids.map((q) => (rc["prospects"][q]["stars"] === n ? 1 : 0)));
    rows.push({ school: slug, name: teams[slug]["name"], conference: teams[slug]["conference"],
      count: pids.length, signed: sum(pids.map((q) => (truthy(rc["status"][q]["signed"]) ? 1 : 0))), stars,
      _points: t["points"], rank: t["rank"], yours: slug === viewer,
      top: pids.slice(0, 3).map((q) => ({ id: q, name: rc["prospects"][q]["name"], stars: rc["prospects"][q]["stars"],
        position: rc["prospects"][q]["position"], rank: rc["prospects"][q]["rank"],
        generational: prospects.generational_seen(rc, q, viewer) })) });
  }
  rows = sorted(rows, (r) => [-r["_points"], r["name"]]);
  for (const r of rows) {
    const points = r["_points"];
    delete r["_points"];
    r["points"] = round(points, 3);
  }
  const statuses = Object.values(rc["status"]);
  const signed = sum(statuses.map((st) => (truthy(st["signed"]) ? 1 : 0)));
  const phase = signed === statuses.length ? "Signed" : signed ? "Early Signing Period Done" : "Recruiting";
  return { schools: rows, phase, fcs: sum(statuses.map((st) => (st["signed"] === "FCS" ? 1 : 0))) };
}

export function class_detail(state, slug, viewer) {
  // One school's class, best first, as list rows.
  const persona = modules.persona;
  const rc = prospects.class_rc(state);
  const pids = Object.entries(rc["status"]).filter(([pid, st]) => (st["signed"] || st["committed"]) === slug
    && !(rc === state["recruiting"] && persona.hidden_from(state, viewer, pid))).map(([pid]) => pid);
  const rows = sorted(pids, (q) => rc["prospects"][q]["rank"]).map((pid) => prospects.row(state, pid, viewer));
  for (const r of rows) {                           // his real ratings show once he signs with you: did the find hold?
    if (r["signed"] === viewer) {
      const truth = rc["prospects"][r["id"]]["truth"]["potential"];
      r["find_held"] = r["find"] === null ? null : (r["find"] === "gem" ? truth >= 80 : truth < 50);
    }
  }
  return rows;
}

export function season_week_label(week) {
  return modules.season.week_label(week);
}

export function recruiting_view(state) {
  // The Recruiting tab: your week's hours and NIL points, your board and last week's news.
  const recruiting = modules.recruiting, persona = modules.persona;
  const rc = state["recruiting"], me = state["team"];
  const offers = get(rc["offers"], me, []);
  const nil = recruiting._nil(state, me);
  const week = state["current_week"];
  const mine = new Set([...rc["board"], ...offers]);
  const hist = prospects.history_index(state, me);
  const homes = truthy(get(rc, "portal")) ? [] : recruiting.home_weekends(state, me);
  const board = rc["board"].map((pid) => prospects.board_row(state, pid, me, hist, homes));
  const skip = ["leaning_fcs", ...recruiting.HISTORY_ONLY];
  const recap = rc["log"].filter((e) => e["week"] === week && (get(e, "school") === me || get(e, "from") === me || mine.has(e["pid"]))
    && !skip.includes(e["kind"]) && persona.shown_to(e, me));
  const out = {};
  // the dead period: recruiting is closed until Signing Day (no hours to spend; the page says so)
  out.closed = recruiting.closed(state); out.signing = prospects.season_week_label(recruiting.signing_week());
  out.week = week; out.hours = recruiting.weekly_hours(state, me); out.hours_left = recruiting.closed(state) ? 0 : recruiting.hours_free(state, me);
  out.points_left = recruiting.scout_points_left(state, me); out.points_week = recruiting.scout_points(state, me);
  out.nil = { budget: nil["budget"], held: sum(Object.values(nil["held"])), left: recruiting.nil_left(state, me),
    base: recruiting.nil_budget(state, me),                      // the year's budget alone (the class: budget = base + carry)
    pool: truthy(get(rc, "portal")) ? nil["budget"] : null,            // the portal: the pool less what keeping players home cost
    carry: truthy(get(rc, "portal")) ? null : int(get(nil, "carry") || 0) };   // the class: last year's portal NIL carried over
  out.open_spots = recruiting.open_spots(state, me); out.committed = Object.values(rc["status"]).filter((s) => s["committed"] === me).length;
  out.needs = {};
  for (const [k, d] of Object.entries(recruiting.needs_by_spot(state, me))) out.needs[k] = d["need"];     // by position, as the board counts
  out.needs_detail = recruiting.needs_by_spot(state, me);
  out.need_levels = recruiting.need_levels(state, me);                       // the Triage colors: how pressing each one is
  out.report = recruiting.latest_report(state);
  out.portal = truthy(get(rc, "portal")) ? { week: get(rc, "week"), weeks: get(rc, "weeks", 4), entrants: Object.keys(rc["prospects"]).length,
    signed: sum(Object.values(rc["status"]).map((s_) => (truthy(s_["signed"]) ? 1 : 0))) } : null;
  out.offers = offers.length; out.offers_left = recruiting.offer_cap(state, me) - offers.length;
  out.board = board;
  out.targets = sorted(board.filter((b) => b["standing"]["pct"] !== null && !truthy(b["committed"])), (b) => -b["standing"]["pct"]).slice(0, 4);
  out.class_rank = prospects.class_rank(state, me);
  out.hours_used = recruiting.weekly_hours(state, me) - recruiting._hours(state, me);
  out.recap = recap.slice(-60).map((e) => ({ ...e, name: rc["prospects"][e["pid"]]["name"],
    ...(truthy(get(e, "lost")) ? { reason: recruiting.lost_reason(e, recruiting.school_name) } : {}) }));
  out.auto_recruit = recruiting.auto_mode(state);
  out.staff = get(state["career"], "staff", []);
  out.areas = {};
  for (const [a, states] of Object.entries(recruiting.AREAS)) out.areas[a] = [...states];
  out.area_counts = {};
  for (const [a, states] of Object.entries(recruiting.AREAS)) {
    out.area_counts[a] = sum(Object.keys(rc["prospects"]).map((pid) => (states.includes(rc["prospects"][pid]["hometown"]["state"])
      && !truthy(rc["status"][pid]["signed"]) ? 1 : 0)));
  }
  out.pitches = [...recruiting.PITCHES]; out.hours_cost = recruiting.HOURS;
  return out;
}


// ----- the Scouting tab -------------------------------------------------------------------------------

prospects.ROLE_NAMES = { OC: "Offensive Coordinator", DC: "Defensive Coordinator", Recruiter: "Recruiter" };
prospects.NOT_ENOUGH_POINTS = "Not Enough Points";
// (port) the three below are built from recruiting's constants when the Python file loads; recruiting may load after
// this file here, so each is worked out the first time it is read (and can still be set)
function lazy(name, make) {
  Object.defineProperty(prospects, name, {
    enumerable: true, configurable: true,
    get() { const v = make(); Object.defineProperty(prospects, name, { value: v, writable: true, enumerable: true, configurable: true }); return v; },
    set(v) { Object.defineProperty(prospects, name, { value: v, writable: true, enumerable: true, configurable: true }); },
  });
}
lazy("REPORT_COMPLETE", () => `His report is complete: ${modules.recruiting.REPORT_LOOKS} of ${modules.recruiting.REPORT_LOOKS} looks`);   // a board row kept in the queue with no Send
lazy("REPORT_ITEMS", () => modules.recruiting.LOOK_LOG_KEEP);   // a scout's report lists this many of his changed looks: flags, then potential, then the rest
prospects.LOOK_NAMES = { ...prospects.GROUP_NAMES, potential: "potential" };
prospects.STANDING_WORDS = { cold: "Not Yet Contacted", contact: "In Contact", top: "In His Top Group", visited: "Visited",
  committed: "Committed to You" };


export function _look_change(e) {
  // What a logged look changed, in words: potential first, else the first group whose words moved
  // ("narrowed to" when the range tightened, "now" when it shifted, "first read:" for his first look); "" for none.
  const recruiting = modules.recruiting;
  for (const g of prospects._LOOK_ORDER) {
    const after = get(e["after"], g), before = get(e["before"], g);
    if (after === null) continue;
    const name = prospects.LOOK_NAMES[g];
    const words = after[0] !== after[1] ? `${after[0]}–${after[1]}` : after[0];
    if (before === null) return `first read: ${name} ${words}`;
    const width = (r) => recruiting.WORDS.indexOf(r[0]) - recruiting.WORDS.indexOf(r[1]);
    return `${name} ${width(after) < width(before) ? "narrowed to" : "now"} ${words}`;
  }
  return "";
}


lazy("_LOOK_ORDER", () => ["potential", ...modules.recruiting.GROUPS.filter((g) => g !== "potential")]);


export function _report_groups(state, entries, counts, changes, staff) {
  // One week's look log as the desk's reports: grouped by scout in order of the newest logged look
  // (then the scouts whose looks changed nothing, in staff order), each group's looks counted (`looks`,
  // from the week's tally), the looks that changed a grade word or gained a flag counted (`changed`,
  // from the tally) and the most notable REPORT_ITEMS of them listed (flags, then potential, then the
  // rest; newest first within each). Each item carries `on_board` and `complete` (his report is complete now:
  // a look this week on a complete report is the look that completed it), read-only, for the tab's This Week digest.
  const recruiting = modules.recruiting;
  const rc = state["recruiting"];
  const groups = odict();                    // by scout id
  const kept = {};

  const group = (by) => {
    let g = get(groups, by);
    if (g === null) {
      const member = get(staff, by);
      g = groups[by] = { scout_id: by, scout: truthy(member) ? member["name"] : "Your trips",
        area: truthy(member) ? get(member, "area") : null, looks: get(counts, by, 0),
        changed: get(get(changes, by) || {}, "changed", 0), items: [] };
    }
    return g;
  };

  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    group(e["by"]);
    if (kept[e["by"]] === undefined) kept[e["by"]] = [];
    kept[e["by"]].push(e);
  }
  for (const by of [...Object.keys(staff), "trip"]) if (truthy(get(counts, by))) group(by);
  for (const [by, g] of Object.entries(groups)) {
    for (const e of sorted(get(kept, by, []), recruiting.look_notability).slice(0, prospects.REPORT_ITEMS)) {
      const p = rc["prospects"][e["pid"]];
      g["items"].push({ pid: e["pid"], name: p["name"], position: p["position"], stars: p["stars"],
        change: prospects._look_change(e), flags: [...e["flags"]], likes: prospects.staff_likes(state, e["pid"], state["team"]),
        on_board: _in(e["pid"], rc["board"]), complete: recruiting.report_complete(get(rc["reads"], e["pid"])) });
    }
  }
  return Object.values(groups);
}


prospects.QUEUE_LIMIT = 120; prospects.QUEUE_MAX = 400;            // the queue's page: the default and the most rows one ask returns
prospects.QUEUE_SORTS = ["rank", "board", "need", "potential", "looks"];   // the Prospect Database's orders; rank by default
prospects.COMMITTED_TO_YOU = "He is committed to you"; prospects.SIGNED = "He has signed";   // why a listed prospect takes no Send
prospects.FLAG_ORDER = ["generational", "gem", "likes", "bust"];   // the Flags list: the liked recruits after the gems


export function scouting_view(state, q = null, position = null, group = null, offset = 0, limit = prospects.QUEUE_LIMIT,
  scouted = false, sort = "rank", on_board = false) {
  // The Scouting tab: your scouts and this week's yield (looks in trip units: an area week counts
  // 0.5), one page of the queue of recruits worth a trip (your board's one Send from complete first,
  // then the board's open reports, then the board's complete reports (kept in view with no Send:
  // `can_send` False, `why` REPORT_COMPLETE), then the rest of the class by need and rank, a complete
  // report among them too (the tab is the prospect database: scouting a prospect never hides him); filtered by `q`
  // on name or home state, `position`, `group`; `queue_total` counts the whole match), this and last
  // week's reports from the look log, and your staff's flags this class (gems, bust risks, generational
  // prospects and the recruits a coordinator likes: staff_likes), every row carrying `likes`; a queue row
  // carries `on_board` (read-only). `scouted` keeps only prospects your staff has a read on, `on_board` only
  // your board. The list is every prospect you can see (`visible`), committed to you or signed too (no Send,
  // `why` says so), in `sort` order over the whole match (QUEUE_SORTS: rank by default; "board" is the board
  // first as above, then the class by need and rank). Read-only counts for the tab's header: `full_reports`
  // (complete reports this class) and `trips_this_week` (your Sends).
  const recruiting = modules.recruiting;
  const rc = state["recruiting"], me = state["team"];
  const week = recruiting.look_week(state);
  const staff = odict();                     // by staff id, in the staff's order
  for (const m of get(state["career"], "staff", [])) staff[m["id"]] = m;
  const log = get(rc, "looks") || [];
  const counts = get(rc, "look_counts") || {}, changes = get(rc, "look_changes") || {};
  const this_count = get(counts, String(week)) || {}, last_count = get(counts, String(week - 1)) || {};
  const this_changes = get(changes, String(week)) || {}, last_changes = get(changes, String(week - 1)) || {};
  const this_week = log.filter((e) => e["week"] === week);
  const last_week = log.filter((e) => e["week"] === week - 1);
  const hours_left = recruiting.hours_free(state, me);
  const points_left = recruiting.scout_points_left(state, me);
  const need = {};
  for (const [k, d] of Object.entries(recruiting.needs_by_spot(state, me))) need[k] = d["need"];
  const live = new Set(Object.entries(rc["status"]).filter(([, st]) => !truthy(st["signed"]) && st["committed"] !== me).map(([pid]) => pid));
  const scouts = [];
  for (const m of Object.values(staff)) {
    const codes = get(recruiting.AREAS, get(m, "area"), []);
    const mine = get(this_changes, m["id"]) || {};
    let looking_at = 0;                      // (port) counted over the set in the order it was built: only the count is used
    for (const pid of live) {
      if (codes.includes(rc["prospects"][pid]["hometown"]["state"]) && recruiting.area_open(get(rc["reads"], pid))) looking_at += 1;
    }
    scouts.push({ id: m["id"], name: m["name"], role: get(prospects.ROLE_NAMES, m["role"], m["role"]),
      evaluation_word: recruiting.word(m["evaluation"]), area: get(m, "area"), contract_until: get(m, "contract_until"),
      looking_at,
      yield: { looks: get(this_count, m["id"], 0), narrowed: get(mine, "changed", 0),
        flags: get(mine, "flags", 0) } });
  }
  const text = (q || "").trim().toLowerCase();
  const want_pos = (position || "").toUpperCase() || null, want_group = (group || "").toUpperCase() || null;

  const fits = (p) => {
    if ((want_pos && p["position"].toUpperCase() !== want_pos) || !recruiting.spot_matches(p, want_group)) return false;
    if ((truthy(scouted) && !_in(p["id"], rc["reads"])) || (truthy(on_board) && !_in(p["id"], rc["board"]))) return false;
    return !text || p["name"].toLowerCase().includes(text) || text === p["hometown"]["state"].toLowerCase();
  };

  const complete = (pid) => recruiting.report_complete(get(rc["reads"], pid));
  let board = rc["board"].filter((pid) => live.has(pid));
  // one Send from complete first, then the board's open reports, then its complete ones (they stay listed: no Send, a Complete tag)
  board = sorted(board, (pid) => (complete(pid) ? 2 : recruiting.looks_left(get(rc["reads"], pid)) <= recruiting.SEND_LOOK ? 0 : 1));
  // (port) recruiting.visible is a set, walked here in whatever order it comes in: Python's order is its own (it
  // differs from run to run), and it shows only between prospects that tie in the sort below
  const seen = [...recruiting.visible(state)].filter((pid) => _in(pid, rc["status"]));
  const rank_of = (pid) => rc["prospects"][pid]["rank"] || 10 ** 6;
  const need_of = (pid) => need[recruiting.spot_of(rc["prospects"][pid])];
  const sharp = modules.grades.fine(state);                                   // once, not once a prospect

  const potential_of = (pid) => {
    // by the letters shown (best first); a tie is broken by rank (below); no read sorts last
    if (!_in(pid, rc["reads"])) return -1;
    return -modules.grades.sort_key(recruiting.shown_range(state, pid, "potential", sharp));
  };
  sort = prospects.QUEUE_SORTS.includes(sort) ? sort : "rank";
  let order;
  if (sort === "board") {
    // the open board as above, then board prospects committed to you or signed, then the class by need and rank
    const listed = new Set(seen);
    order = [...board, ...rc["board"].filter((pid) => !board.includes(pid) && listed.has(pid)),
      ...sorted(seen.filter((pid) => !_in(pid, rc["board"])), (pid) => [-need_of(pid), rank_of(pid)])];
  } else if (sort === "need") {
    order = sorted(seen, (pid) => [-need_of(pid), rank_of(pid)]);
  } else if (sort === "potential") {
    order = sorted(seen, (pid) => [-potential_of(pid), rank_of(pid)]);
  } else if (sort === "looks") {
    order = sorted(seen, (pid) => [-(get(get(rc["reads"], pid) || {}, "looks") || 0), rank_of(pid)]);
  } else {
    order = sorted(seen, rank_of);
  }
  const trips_of = (pid) => get(get(get(rc["contacts"], pid) || {}, me) || {}, "scouted", 0);
  const matched = order.filter((pid) => fits(rc["prospects"][pid]));
  limit = Math.max(1, Math.min(int(limit), prospects.QUEUE_MAX));
  offset = Math.max(0, int(offset));
  const queue = [];
  for (const pid of matched.slice(offset, offset + limit)) {
    const p = rc["prospects"][pid], read = get(rc["reads"], pid), trips = trips_of(pid);
    const cost = recruiting.look_cost(state, me, pid);
    const short = points_left < cost;
    const done = complete(pid);
    const status = rc["status"][pid];
    const gone = truthy(status["signed"]) ? prospects.SIGNED : status["committed"] === me ? prospects.COMMITTED_TO_YOU : null;
    queue.push({ pid, name: p["name"], position: p["position"], display_pos: prospects.display_pos(p["ea_position"]), stars: p["stars"],
      group: recruiting.spot_of(p), need: need[recruiting.spot_of(p)], national_rank: p["rank"],
      looks: prospects.looks_out(read), trips, cost,
      potential: truthy(read) ? recruiting.shown_range(state, pid, "potential") : null,
      can_send: !short && !done && !gone,
      why: gone || (done ? prospects.REPORT_COMPLETE : short ? prospects.NOT_ENOUGH_POINTS : null),
      state: p["hometown"]["state"], likes: prospects.staff_likes(state, pid, me), on_board: _in(pid, rc["board"]),
      flags: truthy(read) ? recruiting._flags(state, pid) : [] });
  }
  let flags = [];
  for (const pid of Object.keys(rc["reads"])) {
    const p = get(rc["prospects"], pid);
    if (p === null) continue;
    const likes = prospects.staff_likes(state, pid, me);
    for (const flag of [...recruiting._flags(state, pid), ...(truthy(likes) ? ["likes"] : [])]) {
      flags.push({ pid, name: p["name"], position: p["position"], stars: p["stars"], flag,
        looks: prospects.looks_out(rc["reads"][pid]), likes, on_board: _in(pid, rc["board"]),
        standing_word: prospects._standing_word(state, pid, me) });
    }
  }
  flags = sorted(flags, (f) => [prospects.FLAG_ORDER.indexOf(f["flag"]), rc["prospects"][f["pid"]]["rank"]]);
  return { hours: recruiting.weekly_hours(state, me), hours_left, points_left,
    points_week: recruiting.scout_points(state, me), scouts, areas: recruiting.AREAS,
    full_reports: sum(Object.values(rc["reads"]).map((read) => (recruiting.report_complete(read) ? 1 : 0))),
    trips_this_week: round(get(this_count, "trip", 0)),
    board_size: rc["board"].length, board_scouted: sum(rc["board"].map((x) => (recruiting.report_looks(get(rc["reads"], x)) > 0 ? 1 : 0))),
    queue, queue_total: matched.length,
    reports: { this_week: prospects._report_groups(state, this_week, this_count, this_changes, staff),
      last_week: prospects._report_groups(state, last_week, last_count, last_changes, staff) },
    flags };
}

export function _standing_word(state, pid, me) {
  // Where he stands with you, in a few words: signed or committed (to you or elsewhere), else your stage with him.
  const season = modules.season;
  const st = prospects.seen_status(state, pid, me);
  if (st["signed"] === me) return "Signed With You";
  if (truthy(st["signed"]) || !(st["committed"] === null || st["committed"] === me)) {
    const school = st["signed"] || st["committed"];
    if (truthy(get(st, "pro"))) return "Chose Pro Baseball";
    const name = school === "FCS" ? "an FCS Program" : season.load_teams()[school]["name"];
    return truthy(st["signed"]) ? `Signed With ${name}` : `Committed to ${name}`;
  }
  return prospects.STANDING_WORDS[modules.recruiting.stage(state, me, pid)];
}


// ----- the odds you see ------------------------------------------------------------------------------

prospects.ODDS_TEMPERATURE = 3.0;            // interest points between two schools that make one e (2.7x) likelier *tune*
prospects.FIELD = [[0, 14.0], [8, 10.0], [16, 4.0]];   // interest of the schools not yet in it, fading toward signing day *tune*
prospects.ODDS_BAND = [[0, 0.25], [8, 0.12], [13, 0.04]];   // half-width of the range shown, by week *tune*
prospects.CLASS_SIGMA = 9.0;                 // class points, as 247Sports counts them: the bell curve's width, in commits (the spread of class sizes) *tune*
prospects.CLASS_FLOOR = 70.0;                // ... and the rating (composite times 100) a commit must beat to add anything *tune*
prospects.CERTAINTY = [[0.18, "Early Read"], [0.08, "Taking Shape"], [0.0, "Solid Read"]];

function _certainty(band) {
  for (const [edge, label] of prospects.CERTAINTY) if (band >= edge) return label;
  throw new Error("StopIteration");          // (port) Python's next() with nothing left: a band below zero
}

export function odds(state, pid, week = null, viewer = null) {
  // Each offering school's chance to land him, the field's (schools not yet in it), and the
  // range around each that narrows as signing day nears: {"schools": [{school, pct, lo, hi}],
  // "field", "band", "certainty"}, likeliest first (as `viewer` sees him: a Quiet Commit elsewhere
  // reads as uncommitted).
  const recruiting = modules.recruiting;
  const rc = state["recruiting"];
  week = week === null ? state["current_week"] : week;
  const st = prospects.seen_status(state, pid, viewer);
  if (truthy(st["signed"])) {                           // final
    const rows = st["signed"] === "FCS" ? [] : [{ school: st["signed"], pct: 1.0, lo: 1.0, hi: 1.0 }];
    return { schools: rows, field: rows.length ? 0.0 : 1.0, band: 0.0, certainty: "Signed", committed: st["signed"] };
  }
  const offered = Object.entries(rc["offers"]).filter(([, pids]) => _in(pid, pids)).map(([s]) => s);
  if (truthy(st["committed"]) && st["committed"] !== "FCS") return prospects._committed_odds(state, pid, st["committed"], offered, week);
  const field = recruiting._interp(prospects.FIELD, week);
  const weights = {};
  for (const s of offered) weights[s] = Math.exp(recruiting.interest(state, s, pid) / prospects.ODDS_TEMPERATURE);
  const w_field = Math.exp(field / prospects.ODDS_TEMPERATURE);
  const total = sum(Object.values(weights)) + w_field;
  const band = recruiting._interp(prospects.ODDS_BAND, week);
  const rows = sorted(Object.entries(weights).map(([s, w]) => ({ school: s, pct: w / total, lo: Math.max(0.0, w / total - band), hi: Math.min(1.0, w / total + band) })),
    (r) => -r["pct"]);
  const certainty = _certainty(band);
  return { schools: rows, field: w_field / total, band, certainty, committed: null };
}

export function _committed_odds(state, pid, school, offered, week) {
  // A committed prospect: his school keeps him unless he flips before signing day. The weekly
  // flip chance follows the weekly draws (recruiting._draws): DECOMMIT_RATE scaled by the best
  // rival's lead in interest; the flip chance is shared among the rivals as their odds.
  const recruiting = modules.recruiting;
  const rivals = offered.filter((s) => s !== school);
  const mine = recruiting.interest(state, school, pid);
  // the early Signing Day ends it for a commit made before it; one made in the dead period can flip until the last
  const weeks_left = Math.max(0, (week < recruiting.early_signing_week() ? recruiting.early_signing_week() : recruiting.signing_week()) - week);
  let flip;
  if (rivals.length) {
    const gap = Math.max(...rivals.map((s) => recruiting.interest(state, s, pid))) - mine;
    flip = recruiting.flip_by_signing(state, pid, gap, weeks_left);
  } else {
    flip = 0.0;
  }
  const weights = {};
  for (const s of rivals) weights[s] = Math.exp(recruiting.interest(state, s, pid) / prospects.ODDS_TEMPERATURE);
  const total = sum(Object.values(weights)) || 1.0;
  const band = recruiting._interp(prospects.ODDS_BAND, week) / 2;
  let rows = [{ school, pct: 1 - flip }, ...Object.entries(weights).map(([s, w]) => ({ school: s, pct: flip * w / total }))];
  for (const r of rows) {
    r["lo"] = Math.max(0.0, r["pct"] - band); r["hi"] = Math.min(1.0, r["pct"] + band);
  }
  rows = sorted(rows, (r) => -r["pct"]);
  const certainty = _certainty(band);
  return { schools: rows, field: 0.0, band, certainty, committed: school };
}

export function class_points(composites) {
  // A class's points the way 247Sports' team rankings count them: the commits best first, each one's rating
  // (his composite times 100) over CLASS_FLOOR, weighted down a bell curve by his place in the class
  // (e^(-(n-1)^2 / (2 CLASS_SIGMA^2))). The best commit counts in full, the tenth about half, the twentieth
  // a tenth: a top class lands a little over 300.
  const best = sorted(composites, undefined, true);
  const sigma2 = prospects.CLASS_SIGMA * prospects.CLASS_SIGMA;       // CLASS_SIGMA ** 2
  return sum(best.map((c, i) => Math.max(0.0, c * 100 - prospects.CLASS_FLOOR) * Math.exp(-(i * i) / (2 * sigma2))));
}

export function class_table(state, viewer = null) {
  // Every FBS school's class as the viewer sees it, the one ranking the Classes tab and class_rank share:
  // {slug: {"pids" best composite first, "points", "rank"}}. Points are class_points (247Sports' count: the best
  // recruits count most); the rank counts
  // the schools with more points. Another school's Quiet Commit is left out of the viewer's table, as the
  // viewer cannot see where he went (viewer None: every commitment counts).
  const recruiting = modules.recruiting, persona = modules.persona;
  const rc = prospects.class_rc(state);
  const live = rc === state["recruiting"];                 // the portal weeks rank the signed class: nothing quiet left
  const by_school = {};
  for (const [pid, st] of Object.entries(rc["status"])) {
    const school = st["signed"] || st["committed"];
    if (truthy(school) && school !== "FCS" && !(truthy(viewer) && live && persona.hidden_from(state, viewer, pid))) {
      if (by_school[school] === undefined) by_school[school] = [];
      by_school[school].push(pid);
    }
  }
  const table = {};
  for (const slug of recruiting.fbs_schools(state)) {
    const pids = sorted(get(by_school, slug, []), (q) => -rc["prospects"][q]["composite"]);
    table[slug] = { pids, points: prospects.class_points(pids.map((q) => rc["prospects"][q]["composite"])) };
  }
  const all = Object.values(table);
  for (const t of all) t["rank"] = 1 + sum(all.map((o) => (o["points"] > t["points"] ? 1 : 0)));
  return table;
}

export function class_rank(state, slug, viewer = null) {
  // Where a school's class stands nationally as the viewer sees it (by default the school itself, which
  // sees its own Quiet Commits and not another school's): the same rank as its row on the Classes tab.
  return prospects.class_table(state, viewer || slug)[slug]["rank"];
}

Object.assign(prospects, {
  player_pool, starter_pool, _attributes, _distance, comp_max_distance, warm, ceiling, comp, _shifted, _dev_rate, growth_share,
  projection, read_overall, staff_likes, display_pos, height_text, weight_text, pos_rank, uncertainty, report, trait_hints, shown,
  _public_grades, _ranks, grade_detail, reset_caches, league_values, league_rank, engine_position, group_keys, game_attributes,
  card_attributes, _card, _middle, _high_school, seen_status, visit_view, _schools, _evaluation, generational_seen, find,
  flip_word, flip_view, _abilities_seen, profile, row, _flip_risk, _role, _stage_move, history_index, board_row, looks_out,
  can_scout, signed_ratings, standing, your_interest, _level, _height_in, _sort_key, search, class_summary, class_block,
  class_rc, national_classes, class_detail, season_week_label, recruiting_view, _look_change, _report_groups, scouting_view,
  _standing_word, odds, _committed_odds, class_points, class_table, class_rank,
});

modules.prospects = prospects;
