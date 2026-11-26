// Filling a league file's rosters (docs/superpowers/specs/2026-11-05-league-file-design.md, "Filling a
// Roster"): each team gets a target strength, given overalls and ratings are kept exactly, missing players
// and skills are generated from the recruits' position templates, short rosters are topped up, and the
// generated players are nudged together so the team lands on its target. Every draw comes from the rng
// the caller passes (new Random(`league-${seed}-${slug}`)), in a fixed order, so a file and a seed
// always give the same league.
//
// Notes:
//   - the three module-level values that come from other modules or a data file (COACH_YEAR, _COACH_ROLES,
//     STATE_CENTER) are worked out at their first use (a host sets its reader, and the other modules load, after
//     this one);
//   - `taken` and the coach names are Sets;
//   - parts of two documents are compared by value with `_eq(a, b)`;
//   - `league_seed` takes the file's bytes as a Uint8Array (or its text) and has its own SHA-256.
import { Random, round, int, sum, sorted, minBy, floordiv, mod, get, isNumber, truthy, odict } from "../engine_js/pyrt.js";
import { mean, median } from "../engine_js/pystat.js";
import { modules } from "../engine_js/modules.js";
import { game_scale } from "../teamdata_js/game_scale.js";
import { recruits } from "./recruits.js";

const STRENGTH_GRADE = { "Elite": 95, "Strong": 75, "Average": 50, "Weak": 20 };  // *tune* each word's place among the FBS teams (percentile)
const SLOT_STEP = { "starter": 0.0, "backup": -4.0, "depth": -7.0 };  // *tune* generated overall by depth slot, against the team's starter level
const CLASS_STEP = { "FR": -3.0, "FRRS": -2.4, "SO": -1.5, "SORS": -0.9, "JR": 0.0, "JRRS": 0.3, "SR": 0.6, "SRRS": 0.9 };  // *tune* juniors and seniors above freshmen
const STAR_STEP = { 5: 3.6, 4: 1.8, 3: 0.0, 2: -1.8, 1: -3.0 };  // *tune* given stars' lift
const PLAYER_SD = 1.8;  // *tune* spread of a generated overall around its slot
const OVERALL_RANGE = [64, 96];            // a generated player's overall stays in this range
const NUDGE_RANGE = [-18.0, 18.0];         // the common shift of the generated players' overalls, searched by bisection
const NUDGE_STEPS = 20;
const NUDGE_CLOSE = 0.3;                   // team overall points from the target that end the search
const CLASS_MIX = { "FR": 0.151, "FRRS": 0.122, "SO": 0.086, "SORS": 0.149, "JR": 0.086, "JRRS": 0.153, "SR": 0.069, "SRRS": 0.185 };  // *tune* added players' classes (the built-in FBS rosters' mix)
const CLASS_LEAD = { "SRRS": 0.0, "JRRS": 0.1, "SR": 0.15, "JR": 0.2, "SORS": 0.3, "SO": 0.4, "FRRS": 0.7, "FR": 0.85 };  // *tune* how late in a group's order each class's first player comes (older first, so starters are mostly upperclassmen, as on the built-in rosters)
const ROOM_BY_CLASS = { "FR": 0.84, "FRRS": 0.93, "SO": 0.86, "SORS": 0.82, "JR": 0.86, "JRRS": 0.65, "SR": 0.61, "SRRS": 0.0 };  // *tune* a generated player's share of a recruit's room to potential, by class (fit to the built-in rosters)
const _TEMPLATE_POS = { "FB": "HB" };        // positions with no recruit template borrow a neighbor's
const _LB = ["MIKE", "WILL", "SAM"];       // the order league.lineup fills the linebacker spots

// ---- small helpers --------------------------------------------------------------------------------------------------

// isinstance(v, dict): a dict of the data, not a list and not None.
const _is_dict = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Set);

// Python's a == b for two values of the data (dicts by their keys and values whatever the order, lists item by
// item, True the same as 1).
export function _eq(a, b) {
  if (a === undefined) a = null;
  if (b === undefined) b = null;
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a === "boolean") a = Number(a);
  if (typeof b === "boolean") b = Number(b);
  if (typeof a !== "object" || typeof b !== "object") return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!_eq(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (b[k] === undefined || !_eq(a[k], b[k])) return false;
  return true;
}

// d[k], throwing a KeyError for a key that is not there (a value the file's checks would have refused):
// to_league turns the error into the team's TeamBuildError, so it has to be one here too.
function _key(d, k) {
  const v = d[k];
  if (v === undefined) throw new Error(`KeyError: ${JSON.stringify(k)}`);
  return v;
}

// copy.deepcopy of a value of the data (key order kept, an odict's too).
function _deepcopy(v) {
  if (v === null || v === undefined || typeof v !== "object") return v === undefined ? null : v;
  if (Array.isArray(v)) return v.map(_deepcopy);
  const out = {};
  for (const k of Object.keys(v)) out[k] = _deepcopy(v[k]);
  return out;
}

// str.strip() and str.split(): Python's white space.
const _WS = "[\\t\\n\\v\\f\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]";
const _WS_ENDS = new RegExp(`^${_WS}+|${_WS}+$`, "g"), _WS_RUN = new RegExp(`${_WS}+`);
const _strip = (s) => s.replace(_WS_ENDS, "");
const _words = (s) => s.split(_WS_RUN).filter((w) => w !== "");

// SHA-256 of bytes, as hex (hashlib.sha256(...).hexdigest()).
const _K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be,
  0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa,
  0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85,
  0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f,
  0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);

export function _sha256_hex(bytes) {
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const len = bytes.length;
  const total = Math.ceil((len + 9) / 64) * 64;
  const m = new Uint8Array(total);
  m.set(bytes);
  m[len] = 0x80;
  const bits_hi = Math.floor(len / 536870912), bits_lo = (len * 8) >>> 0;       // the length in bits, as two 32-bit halves
  for (let i = 0; i < 4; i++) {
    m[total - 8 + i] = (bits_hi >>> (24 - 8 * i)) & 0xff;
    m[total - 4 + i] = (bits_lo >>> (24 - 8 * i)) & 0xff;
  }
  const W = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = ((m[off + 4 * i] << 24) | (m[off + 4 * i + 1] << 16) | (m[off + 4 * i + 2] << 8) | m[off + 4 * i + 3]) >>> 0;
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + _K256[i] + W[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  return Array.from(H, (x) => x.toString(16).padStart(8, "0")).join("");
}

// ---- the fill ------------------------------------------------------------------------------------------------------

let _base_tables_cache = null;

// -> [slug -> team overall, position -> [median height, median weight]]
export function _base_tables() {
  // (slug -> team overall, position -> (median height, median weight)) over the built-in FBS league.
  // (The one answer is kept.)
  if (_base_tables_cache !== null) return _base_tables_cache;
  const league = modules.league;
  const lgd = league.from_base(league.FIRST_YEAR + 1);
  const strengths = {};
  for (const s of sorted(Object.keys(lgd["teams"]))) strengths[s] = league.source_team(lgd, s)["team_ratings"]["overall"];
  const sizes = {};
  for (const t of Object.values(lgd["teams"])) {
    for (const c of t["roster"]) {
      if (sizes[c["pos"]] === undefined) sizes[c["pos"]] = [[], []];
      const [h, w] = sizes[c["pos"]];
      if (truthy(get(c, "ht"))) h.push(c["ht"]);
      if (truthy(get(c, "wt"))) w.push(c["wt"]);
    }
  }
  const med = {};
  for (const [p, [h, w]] of Object.entries(sizes)) {
    med[p] = [h.length ? int(round(median(h))) : 74, w.length ? int(round(median(w))) : 220];
  }
  _base_tables_cache = [strengths, med];
  return _base_tables_cache;
}
_base_tables.cache_clear = () => { _base_tables_cache = null; };

let _base_strengths_cache = null;

export function base_strengths() {
  // Each built-in FBS team's overall team rating. (The one answer is kept.)
  if (_base_strengths_cache === null) _base_strengths_cache = { ...league_fill._base_tables()[0] };
  return _base_strengths_cache;
}
base_strengths.cache_clear = () => { _base_strengths_cache = null; };

export function _percentile(vals, g) {
  vals = sorted(vals);
  const x = Math.max(0.0, Math.min(100.0, Number(g))) / 100 * (vals.length - 1);
  const i = Math.min(int(x), vals.length - 2);
  return vals[i] + (x - i) * (vals[i + 1] - vals[i]);
}

export function strength_target(team, conference, strengths) {
  // The team overall a team should land on: its `strength` grade's place among the FBS teams, or
  // without one its conference's built-in members' mean (the FBS median for a new conference).
  const grade = get(team, "strength");
  if (grade !== null) {
    const g = typeof grade === "string" ? _key(league_fill.STRENGTH_GRADE, grade) : grade;
    return _percentile(Object.values(strengths), g);
  }
  const mine = [];
  for (const s of get(conference || {}, "members") || []) if (strengths[s] !== undefined) mine.push(strengths[s]);
  return mine.length ? mean(mine) : median(Object.values(strengths));
}

export function fit_overall(card, pos, target, keys) {
  // `card` with only `keys` shifted, all by the same amount (each clamped 1 to 99), so that his
  // overall is `target` when it can be; otherwise as close as it gets. Ratings are whole numbers and a
  // common one-point shift moves the overall more than a point, so the shift is searched in steps of one point
  // on one skill at a time (the heaviest in the overall first): every key moves by the same amount, or
  // by one more. The smallest such shift that reaches the target.
  keys = Array.from(keys).filter((k) => card[k] !== undefined);
  const have = game_scale.overall(card, pos);
  if (have === target || !keys.length) return { ...card };
  const w = game_scale.skill_weights(pos);
  keys = sorted(keys, (k) => -get(w, k, 0.0));
  const n = keys.length;

  const at = (level) => {
    const s = floordiv(level, n), m = mod(level, n);
    const out = { ...card };
    for (let i = 0; i < n; i++) {
      const k = keys[i];
      out[k] = int(Math.max(1, Math.min(99, card[k] + s + (i < m ? 1 : 0))));
    }
    return out;
  };

  const up = have < target;
  let [lo, hi] = up ? [0, 99 * n] : [-99 * n, 0];
  while (hi - lo > 1) {                     // up: the first level at or above the target; down: the last at or below
    const mid = floordiv(lo + hi, 2);
    const o = game_scale.overall(at(mid), pos);
    if (up ? o < target : o <= target) lo = mid;
    else hi = mid;
  }
  const cands = up ? [at(hi), at(lo)] : [at(lo), at(hi)];
  return minBy(cands, (r) => Math.abs(game_scale.overall(r, pos) - target));
}

export function starter_level(target) {
  // The starters' overall that gives about this team overall (a team's rating sits a little under its starters': its
  // backups count a little).
  return target + 0.5;
}

export function _slugify(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "player";
}

// `taken`: a Set, added to.
export function _unique_id(base, taken) {
  let pid = base, n = 2;
  while (taken.has(pid)) {
    pid = `${base}-${n}`;
    n = n + 1;
  }
  taken.add(pid);
  return pid;
}

export function _starters_at(formation, pos) {
  // How many starters the formation has at a league position.
  const [off, de, sp] = ["offense", "defense", "special_teams"].map((u) => get(formation, u) || {});
  if (league_fill._LB.includes(pos)) {
    return league_fill._LB.slice(0, get(de, "LB", 0)).includes(pos) ? 1 : 0;
  }
  return get(off, pos) || get(de, pos) || (pos === "K" || pos === "P" ? get(sp, pos) : 0) || 0;
}

// -> group -> [[league position, its share of the group]]
export function _group_positions(formation) {
  // group -> [(league position, its share of the group)] from the formation (linebackers evenly).
  const out = {};
  for (const [pos, grp] of Object.entries(modules.offseason.GROUP)) {
    if (pos === "FB" && !truthy(get(get(formation, "offense") || {}, "FB"))) continue;
    const w = league_fill._LB.includes(pos) ? 1.0 : Number(_starters_at(formation, pos));
    if (out[grp] === undefined) out[grp] = [];
    out[grp].push([pos, w]);
  }
  for (const [grp, lst] of Object.entries(out)) {
    if (!lst.some(([_, w]) => w)) out[grp] = lst.map(([p, _]) => [p, 1.0]);
  }
  return out;
}

export function _home(p, state) {
  const h = get(p, "hometown");
  if (typeof h === "string" && _strip(h)) {
    const parts = h.split(",");
    const tail = _strip(parts[parts.length - 1]);
    return /^\p{L}\p{L}$/u.test(tail) ? tail : state;       // len(tail) == 2 and tail.isalpha()
  }
  return state;
}

export function _default_formation() {
  return { "offense": { "QB": 1, "HB": 1, "WR": 3, "TE": 1, "LT": 1, "LG": 1, "C": 1, "RG": 1, "RT": 1 },
    "defense": { "LEDG": 1, "REDG": 1, "DT": 2, "LB": 2, "CB": 3, "FS": 1, "SS": 1 },
    "special_teams": { "K": 1, "P": 1, "KR": 1, "PR": 1 } };
}

export function _team_overall(slug, meta, formation, roster, attrs) {
  const lgd = { "year": modules.league_file.YEAR, "attrs": attrs,
    "teams": { [slug]: { "roster": roster, "coaches": {}, "formation": formation, "meta": meta } } };
  return modules.league.source_team(lgd, slug)["team_ratings"]["overall"];
}

// recruits.COACHABILITY as the draw's [name, share] pairs: one list, so recruits.weighted adds its weights up once.
let _coach_pairs = null;
function _coachability_pairs() {
  if (_coach_pairs === null) _coach_pairs = recruits.COACHABILITY.map(([nm, _, sh]) => [nm, sh]);
  return _coach_pairs;
}

// `taken`: a Set. -> [roster, lines]
export function fill_roster(team, target, rng, attrs, taken) {
  // A file team's roster in the league's form (league.compact's players) and the import summary's
  // sentences about it. `taken`: names (lower case) and player ids already used; this team's are added.
  const league = modules.league, league_file = modules.league_file, offseason = modules.offseason;
  const slug = team["slug"];
  const label = get(team, "short_name") || get(team, "name") || slug;
  const formation = truthy(get(team, "formation")) ? team["formation"] : _default_formation();
  const state = get(team, "state");
  const sizes = league_fill._base_tables()[1];
  const quantiles = recruits.model()["generation"]["rating_quantiles"];
  const level = starter_level(target);
  const lines = [];
  const roster_in = (get(team, "roster") || []).filter((p) => _is_dict(p));
  for (const p of roster_in) taken.add(_strip(String(_key(p, "name"))).toLowerCase());

  // 1. depth slots: the depth chart's order first, then roster order, at each position
  const charted = {};
  for (const [k, names] of Object.entries(get(team, "depth_chart") || {})) {
    const role = get(league_file.POS_IN, k, k);
    if (charted[role] === undefined) charted[role] = [];
    for (const n of names || []) charted[role].push(_strip(String(n)).toLowerCase());
  }
  const by_pos = {};
  roster_in.forEach((p, i) => {
    const pos = _key(league_file.POS_IN, _key(p, "pos"));
    if (by_pos[pos] === undefined) by_pos[pos] = [];
    by_pos[pos].push(i);
  });
  const place = new Map();
  for (const [pos, idx] of Object.entries(by_pos)) {
    const order = get(charted, pos, []);
    const ranked = sorted(idx, (i) => {
      const at = order.indexOf(_strip(roster_in[i]["name"]).toLowerCase());
      return [at !== -1 ? at : order.length, i];
    });
    ranked.forEach((i, n) => place.set(i, n));
  }

  const slot = (pos, n) => {
    const k = _starters_at(formation, pos);
    return n < k ? "starter" : n < 2 * k ? "backup" : "depth";
  };

  // -> [template ratings, archetype, raw overall target, room to potential]
  const generate = (pos, cls, stars, n) => {
    // (template ratings, archetype, raw overall target, room to potential): steps 5 and 6's draws.
    const tpos = get(league_fill._TEMPLATE_POS, pos, pos);
    const s = Math.max(2, Math.min(5, int(Number(truthy(stars) ? stars : 3))));
    const band = String(s);
    const [drawn, arche] = recruits._attributes(rng, tpos, band, quantiles[band][3]);
    const from = game_scale.from_draw(drawn);
    let card = {};
    for (const k of attrs) card[k] = get(from, k, game_scale.MISSING);
    // (STAR_STEP.get(stars, 0.0): its keys are the whole numbers 1 to 5; text or nothing given is not one of them)
    const star_step = isNumber(stars) ? get(league_fill.STAR_STEP, Number(stars), 0.0) : 0.0;
    const raw = level + league_fill.SLOT_STEP[slot(pos, n)] + get(league_fill.CLASS_STEP, cls, 0.0) + star_step + rng.gauss(0, league_fill.PLAYER_SD);
    const tmpl = fit_overall(card, pos, _clamp_overall(raw), attrs);
    const pot = game_scale.potential_from_draw(recruits._potential(rng, tpos, s, drawn), card, pos);
    const share = get(league_fill.ROOM_BY_CLASS, cls, 1.0);
    const room = {};
    for (const k of attrs) room[k] = int(round(share * Math.max(0, get(pot, k, card[k]) - card[k])));
    return [tmpl, arche, raw, room];
  };

  const coach = (p) => get(p, "coachability") || recruits.weighted(rng, _coachability_pairs());

  let out = [];
  const gen = [];   // [index in out, template, raw target, room, given potential]
  for (let i = 0; i < roster_in.length; i++) {
    const p = roster_in[i];
    const pos = _key(league_file.POS_IN, _key(p, "pos"));
    const cls = _key(p, "class");
    const given_r = {};
    for (const [k, v] of Object.entries(get(p, "ratings") || {})) if (attrs.includes(k)) given_r[k] = int(Number(v));
    const n_given = Object.keys(given_r).length;
    const given_o = get(p, "overall");
    let pid = get(p, "id");
    if (truthy(pid)) taken.add(pid);
    else pid = _unique_id(`${slug}-${_slugify(p["name"])}`, taken);
    if (n_given === attrs.length) {
      let card = {};
      for (const k of attrs) card[k] = given_r[k];
      const formula = game_scale.overall(card, pos);
      const o = given_o === null ? formula : int(Number(given_o));
      if (Math.abs(o - formula) > 1) {
        card = fit_overall(card, pos, o, attrs);
        lines.push(`${label}: ${p["name"]}'s ratings were moved to match his overall ${o}.`);
      }
      const q = { ...p, "id": pid, "pos": get(league_file._FILE_POS, pos, pos), "overall": o, "ratings": card };
      if (get(p, "potential") === null) {
        const [, , , room] = generate(pos, cls, get(p, "stars"), place.get(i));
        q["potential"] = {};
        for (const k of attrs) if (room[k] > 0) q["potential"][k] = Math.min(99, card[k] + room[k]);
      }
      const c = league_file.player_compact(q, attrs);
      c["c"] = coach(p);
      if (c["dev"] === null) c["dev"] = "Normal";
      if (c["yrs"] === null) c["yrs"] = get(league.EXPERIENCE, cls, 0);
      if (c["home"] === null) c["home"] = state;
      out.push(c);
      continue;
    }
    const [tmpl, arche, raw, room] = generate(pos, cls, get(p, "stars"), place.get(i));
    let card;
    if (n_given) {
      card = { ...tmpl, ...given_r };
      const missing = attrs.filter((k) => given_r[k] === undefined);
      card = fit_overall(card, pos, given_o !== null ? int(Number(given_o)) : game_scale.overall(tmpl, pos), missing);
    } else if (given_o !== null) {
      card = fit_overall(tmpl, pos, int(Number(given_o)), attrs);
    } else {
      card = tmpl;
    }
    const c = _compact(p, pid, pos, cls, card, room, arche, coach(p), attrs, sizes, state);
    if (given_o !== null) c["o"] = int(Number(given_o));
    out.push(c);
    if (!n_given && given_o === null) gen.push([out.length - 1, tmpl, raw, room, get(p, "potential") || {}]);
  }

  // 7. short rosters: an empty one to the healthy counts, a short group to its floor
  const counts = {};
  for (const g of Object.keys(offseason.FLOOR)) counts[g] = 0;
  const at_pos = {};
  for (const c of out) {
    counts[_key(offseason.GROUP, c["pos"])] += 1;
    at_pos[c["pos"]] = get(at_pos, c["pos"], 0) + 1;
  }
  const want = !out.length ? offseason.TARGET : offseason.FLOOR;
  const groups = _group_positions(formation);
  const added = [];
  for (const grp of Object.keys(offseason.FLOOR)) {
    for (const cls of _class_order(Math.max(0, want[grp] - counts[grp]))) {
      const pos = minBy(groups[grp], (pw) => (pw[1] ? get(at_pos, pw[0], 0) / pw[1] : Infinity))[0];
      const [tmpl, arche, raw, room] = generate(pos, cls, null, get(at_pos, pos, 0));
      at_pos[pos] = get(at_pos, pos, 0) + 1;
      const p = { "class": cls };
      const c = _compact(p, "", pos, cls, tmpl, room, arche, coach(p), attrs, sizes, state);
      out.push(c);
      gen.push([out.length - 1, tmpl, raw, room, {}]);
      added.push([out.length - 1, grp]);
    }
  }
  for (const [j] of added) {
    const name = recruits._name(rng, taken);
    out[j]["n"] = name;
    out[j]["id"] = _unique_id(`${slug}-${_slugify(name)}`, taken);
  }
  if (added.length) {
    if (!roster_in.length) {
      lines.push(`${label}: ${added.length} players generated (the roster was empty).`);
    } else {
      const per = {};
      for (const [, grp] of added) per[grp] = get(per, grp, 0) + 1;
      const parts = Object.entries(per).map(([g, n]) => `${n} ${g}`).join(", ");
      const word = added.length === 1 ? "player" : "players";
      lines.push(`${label}: ${added.length} ${word} added to reach the position floors (${parts}).`);
    }
  }

  // 8. the nudge: one common shift of the generated players' overalls lands the team on its target
  if (gen.length) {
    const meta = { "slug": slug, "short_name": label, "state": state };

    const shifted = (d) => {
      const res = out.slice();
      for (const [j, tmpl, raw, room, gpot] of gen) {
        const card = fit_overall(tmpl, res[j]["pos"], _clamp_overall(raw + d), attrs);
        res[j] = _with_ratings(res[j], card, room, gpot, attrs);
      }
      return res;
    };

    let [lo, hi] = league_fill.NUDGE_RANGE;
    let best = null;
    for (let _ = 0; _ < league_fill.NUDGE_STEPS; _++) {
      const mid = (lo + hi) / 2;
      const cand = shifted(mid);
      const got = _team_overall(slug, meta, formation, cand, attrs);
      if (best === null || Math.abs(got - target) < best[0]) best = [Math.abs(got - target), cand];
      if (Math.abs(got - target) <= league_fill.NUDGE_CLOSE) break;
      if (got < target) lo = mid;
      else hi = mid;
    }
    out = best[1];
  }
  return [out, lines];
}

export function _class_order(n) {
  // The classes of n players added to a group, in the order they are added: CLASS_MIX's counts
  // (largest remainders), each class spread evenly through the order with the older ones first.
  if (n <= 0) return [];
  const CLASS_MIX_ = league_fill.CLASS_MIX, CLASS_LEAD_ = league_fill.CLASS_LEAD;
  const exact = {};
  for (const [c, w] of Object.entries(CLASS_MIX_)) exact[c] = n * w / sum(Object.values(CLASS_MIX_));
  const count = {};
  for (const [c, x] of Object.entries(exact)) count[c] = int(x);
  const more = n - sum(Object.values(count));
  for (const c of sorted(Object.keys(exact), (c) => [-(exact[c] - count[c]), CLASS_LEAD_[c]]).slice(0, Math.max(0, more))) {
    count[c] += 1;
  }
  const keys = [];
  for (const c of Object.keys(count)) {
    for (let i = 0; i < count[c]; i++) keys.push([(i + CLASS_LEAD_[c]) / count[c], CLASS_LEAD_[c], c]);
  }
  return sorted(keys).map((k) => k[2]);
}

export function _clamp_overall(x) {
  return int(round(Math.max(league_fill.OVERALL_RANGE[0], Math.min(league_fill.OVERALL_RANGE[1], x))));
}

export function _with_ratings(c, card, room, gpot, attrs) {
  // The compact player `c` with these ratings, his room carried over (a given potential kept).
  c = { ...c };
  c["r"] = attrs.map((k) => int(card[k]));
  c["g"] = attrs.map((k) => (gpot[k] !== undefined ? Math.max(0, int(Number(gpot[k])) - card[k])
    : Math.max(0, Math.min(99, card[k] + room[k]) - card[k])));
  c["o"] = game_scale.overall(card, c["pos"], get(c, "dmv"));
  return c;
}

export function _compact(p, pid, pos, cls, card, room, arche, coachability, attrs, sizes, state) {
  // A generated or partly given player in league.compact's form.
  const [ht, wt] = get(sizes, pos, [74, 220]);
  const pot = {};
  for (const k of attrs) pot[k] = Math.min(99, card[k] + room[k]);
  const src = { "slug": pid, "name": get(p, "name", ""), "position": pos, "class": cls, "height": get(p, "height") || ht,
    "weight_lbs": get(p, "weight") || wt, "jersey": get(p, "jersey"), "archetype": get(p, "archetype") || arche,
    "dev_trait": get(p, "dev") || "Normal", "coachability": coachability, "stars": get(p, "stars"),
    "card": card, "potential_card": pot, "yrs": get(p, "years"), "abilities": get(p, "abilities"),
    "target_mult": get(p, "target_share") };
  const c = modules.league.compact(src, attrs, _home(p, state));
  const gpot = get(p, "potential") || {};
  if (Object.keys(gpot).length) {
    c["g"] = attrs.slice(0, c["g"].length).map((k, i) => (gpot[k] !== undefined ? Math.max(0, int(Number(gpot[k])) - card[k]) : c["g"][i]));
  }
  return c;
}

// ---- A new team's coaches, program, recruiting model and identity; the career league ----------

const NEUTRAL_COLORS = { "primary": { "name": "Gray", "hex": "#5A6270" }, "secondary": { "name": "White", "hex": "#FFFFFF" }, "accent": null };  // *tune* a team without colors (no accent: the neutral pill border)
const NEW_STADIUM_CAPACITY = 30000;  // *tune* a new team's stadium when the file gives none
// COACH_YEAR = league.FIRST_YEAR: a generated coach's first season (on the namespace below, read at its first use)
const NEW_TEAM_TIER = "Group of 5";  // a new team's recruiting tier
const US_CENTER = [39.8283, -98.5795];  // a new team with no state or location
// _COACH_ROLES = league_file._COACH_ROLES (on the namespace below, read at its first use)
const _IDENTITY = ["name", "short_name", "abbreviation", "mascot", "city", "state", "conference", "colors", "stadium", "home_field", "rivals"];

// -> state -> [lat, lon]
export function _state_center() {
  const out = {};
  for (const [state, towns] of Object.entries(recruits.model()["generation"]["towns"])) {
    const pts = [];
    for (const t of towns) {
      if (t.length >= 4 && isNumber(t[2]) && isNumber(t[3])) pts.push([Number(t[1]), Number(t[2]), Number(t[3])]);
    }
    const w = sum(pts.map(([n]) => n));
    if (pts.length && w > 0) {
      out[state] = [round(sum(pts.map(([n, a]) => n * a)) / w, 4), round(sum(pts.map(([n, _, b]) => n * b)) / w, 4)];
    }
  }
  return out;
}

// STATE_CENTER: each state's town-weighted center (recruits' towns); on the namespace below, worked out at its first use.

let _base_league_cache = null;

export function _base_league() {
  // The built-in league (read only): what new teams borrow coaches, styles and programs from.
  // (The one answer is kept.)
  if (_base_league_cache === null) _base_league_cache = modules.league.from_base(modules.league.FIRST_YEAR);
  return _base_league_cache;
}
_base_league.cache_clear = () => { _base_league_cache = null; };

export function _members(conf, lgd) {
  // The conference's built-in members (sorted); every built-in team for a new conference.
  const mine = sorted((get(conf || {}, "members") || []).filter((s) => lgd["teams"][s] !== undefined));
  return mine.length ? mine : sorted(Object.keys(lgd["teams"]));
}

export function _common(words) {
  // (The least of a set by (how often, the word): the same whatever order the set is walked in.)
  words = words.filter((w) => truthy(w));
  if (!words.length) return null;
  const count = (w) => words.filter((x) => x === w).length;
  return minBy(Array.from(new Set(words)), (w) => [-count(w), w]);
}

export function _median(vals, default_ = null) {
  vals = vals.filter((v) => typeof v === "number");      // a number and not a bool
  return vals.length ? median(vals) : default_;
}

export function _head(team) {
  const c = get(team, "coaches") || {};
  if (truthy(get(c, "head_coach"))) return c["head_coach"];
  return _is_dict(get(c, "head")) && truthy(c["head"]) ? c["head"] : {};
}

// -> [offensive philosophy, defensive philosophy, carrier]
export function _schemes(conf, lgd) {
  // (most common offensive philosophy, defensive philosophy, the first member carrying both) among the
  // conference's built-in head coaches (FBS-wide for a new conference).
  const mem = _members(conf, lgd);
  const sc = {};
  for (const s of mem) sc[s] = get(lgd["teams"][s]["coaches"]["head_coach"], "scheme") || {};
  const off = _common(mem.map((s) => get(sc[s], "offensive_philosophy")));
  const de = _common(mem.filter((s) => get(sc[s], "offensive_philosophy") === off).map((s) => get(sc[s], "defensive_philosophy")));
  let carrier;
  for (const s of mem) {
    if (get(sc[s], "offensive_philosophy") === off && get(sc[s], "defensive_philosophy") === de) { carrier = s; break; }
  }
  if (carrier === undefined) throw new Error("StopIteration");       // nothing to give
  return [off, de, carrier];
}

export function _initials(name) {
  const words = name.match(/[A-Za-z0-9]+/g) || [];
  return words.slice(0, 4).map((w) => w[0]).join("").toUpperCase() || Array.from(name).slice(0, 4).join("").toUpperCase();
}

// A file team's colors over the neutral ones (team_meta_doc and _meta_edit build them the same way).
function _colors(given) {
  const out = {};
  for (const k of ["primary", "secondary", "accent"]) {
    const v = _deepcopy(get(given, k));
    out[k] = truthy(v) ? v : (k !== "accent" ? league_fill.NEUTRAL_COLORS[k] : null);
  }
  return out;
}

export function team_meta_doc(team, conf_name) {
  // A new team's identity in the source format (league.base_meta's shape), with the defaults filled in.
  const league = modules.league;
  const name = _strip(team["name"]);
  const short = get(team, "short_name") || name;
  let hf = get(team, "home_field");
  if (hf === null) {
    let same = [];
    for (const s of league.base_slugs()) {
      if (!league.base_meta(s)["fictional"] && league.base_meta(s)["conference"] === conf_name) same.push(league.base_meta(s));
    }
    if (!same.length) {
      same = [];
      for (const s of league.base_slugs()) if (!league.base_meta(s)["fictional"]) same.push(league.base_meta(s));
    }
    hf = int(round(_median(same.map((m) => m["program"]["home_field_advantage"]), 50)));
  }
  let prestige = get(team, "prestige");
  if (prestige === null) prestige = modules.programs.BASE_DEFAULT["prestige"];
  let colors = { ...league_fill.NEUTRAL_COLORS };
  if (_is_dict(get(team, "colors"))) colors = _colors(team["colors"]);
  const stadium = { "name": `${short} Stadium`, "capacity": league_fill.NEW_STADIUM_CAPACITY, "surface": "turf" };   // what the file leaves out
  for (const [k, v] of Object.entries(_deepcopy(get(team, "stadium") || {}))) if (v !== null) stadium[k] = v;
  const words = _words(name);
  return { "slug": team["slug"], "school_name": name, "short_name": short,
    "abbreviation": get(team, "abbreviation") || _initials(name),
    "mascot": get(team, "mascot") || words[words.length - 1], "city": get(team, "city"), "state": get(team, "state"),
    "conference": conf_name, "subdivision": "FBS",
    "stadium": stadium,
    "colors": colors, "rivals": Array.from(get(team, "rivals") || []), "fictional": false,
    "program": { "prestige": 1 + round(5 * prestige / 100), "home_field_advantage": hf, "generated": true },
    "roster_size": (get(team, "roster") || []).length || sum(Object.values(modules.offseason.TARGET)) };
}

export function _set_rating(c, rating) {
  // The coach's overall set to `rating`, his other ratings shifted by the same amount.
  const shift = int(round(rating)) - c["ratings"]["overall"];
  const ratings = {};
  for (const [k, v] of Object.entries(c["ratings"])) ratings[k] = int(Math.max(1, Math.min(99, v + shift)));
  c["ratings"] = ratings;
  c["ratings"]["overall"] = int(round(rating));
}

// `taken`: a Set of coach names (lower case), or null.
export function coaches_for(team, conf, lgd, rng, taken = null) {
  // A file team's staff in the league's form: each role the file leaves out is generated like the
  // coach market's hires (carousel.generated), carrying the conference's most common scheme; a given
  // name or rating replaces the generated one; a role given with full ratings (a built-in coach, the
  // file's edits merged over him) is kept, with a given `rating` applied. `taken`: coach names (lower
  // case) already in the league; a generated name never repeats one, and this staff's are added.
  taken = taken === null || taken === undefined ? new Set() : taken;
  const slug = team["slug"];
  const given = get(team, "coaches") || {};
  const [off_c, def_c, carrier] = _schemes(conf, lgd);
  const off = typeof get(given, "offense") === "string" ? given["offense"] : null;
  const de = typeof get(given, "defense") === "string" ? given["defense"] : null;
  const out = {};
  for (const [key, role] of league_fill._COACH_ROLES) {
    const g = _is_dict(get(given, key)) ? given[key] : {};
    const model_keys = Object.keys(lgd["teams"][carrier]["coaches"][role]["ratings"]);
    const gr = _is_dict(get(g, "ratings")) ? g["ratings"] : {};
    let c;
    if (Object.keys(gr).length && model_keys.every((k) => gr[k] !== undefined)) {
      c = _deepcopy(g);
      c["team_slug"] = slug;                 // a coach copied from another team's export works here now
      c["role"] = role;
      if (c["is_interim"] === undefined) c["is_interim"] = false;
      const rating = get(c, "rating");
      delete c["rating"];
      if (rating !== null) _set_rating(c, rating);
    } else {
      c = modules.carousel.generated(rng, lgd, role, slug, league_fill.COACH_YEAR, lgd["teams"][carrier]["coaches"][role]);
      delete c["alma_mater"];
      c["team_slug"] = slug;
      c["role"] = role;
      c["is_interim"] = false;
      if (truthy(get(g, "name"))) c["name"] = _strip(String(g["name"]));
      else if (taken.has(c["name"].toLowerCase())) c["name"] = recruits._name(rng, taken);
      for (const [k, v] of Object.entries(gr)) if (c["ratings"][k] !== undefined) c["ratings"][k] = int(Number(v));
      if (get(g, "rating") !== null) _set_rating(c, g["rating"]);
      if (c["scheme"] === undefined) c["scheme"] = {};
      if (role === "head_coach") {
        c["scheme"]["offensive_philosophy"] = off_c;
        c["scheme"]["defensive_philosophy"] = def_c;
      } else if (role === "offensive_coordinator") {
        c["scheme"]["offensive_scheme"] = off_c;
      } else {
        c["scheme"]["defensive_scheme"] = def_c;
      }
    }
    if (c["scheme"] === undefined) c["scheme"] = {};
    const sc = c["scheme"];
    if (off && (role === "head_coach" || role === "offensive_coordinator")) {
      sc[role === "head_coach" ? "offensive_philosophy" : "offensive_scheme"] = off;
    }
    if (de && (role === "head_coach" || role === "defensive_coordinator")) {
      sc[role === "head_coach" ? "defensive_philosophy" : "defensive_scheme"] = de;
    }
    if (truthy(get(c, "name"))) taken.add(String(c["name"]).toLowerCase());
    out[role] = c;
  }
  return out;
}

// -> [style, formation]
export function style_and_formation(team, conf, lgd) {
  // (style, formation): the alphabetically first built-in conference member whose head coach plays the
  // team's head coach's offense (FBS-wide when none in the conference does); the conference's most common
  // scheme's carrier when no team plays it.
  let want = get(get(_head(team), "scheme") || {}, "offensive_philosophy") || get(get(team, "coaches") || {}, "offense");
  if (!truthy(want)) want = _schemes(conf, lgd)[0];

  const plays = (s) => get(get(lgd["teams"][s]["coaches"]["head_coach"], "scheme") || {}, "offensive_philosophy") === want;

  const mine = sorted((get(conf || {}, "members") || []).filter((s) => lgd["teams"][s] !== undefined));
  let style = null;
  for (const s of mine) if (plays(s)) { style = s; break; }
  if (!truthy(style)) {
    style = null;
    for (const s of sorted(Object.keys(lgd["teams"]))) if (plays(s)) { style = s; break; }
  }
  style = style || _schemes(conf, lgd)[2];
  return [style, _deepcopy(lgd["teams"][style]["formation"])];
}

export function program_for(team, conf, lgd) {
  // A new team's program (programs.init's shape): prestige from the file or the conference's mean,
  // winning, NIL and conference strength the conference's medians, a new program's market.
  const programs = modules.programs, league = modules.league;
  const mine = sorted((get(conf || {}, "members") || []).filter((s) => lgd["teams"][s] !== undefined));
  const progs = mine.map((s) => lgd["teams"][s]["program"]);
  let pr = get(team, "prestige");
  if (pr === null) pr = progs.length ? mean(progs.map((q) => q["prestige"])) : programs.BASE_DEFAULT["prestige"];
  const p = { "history": Number(pr), "prestige": Number(pr) };
  for (const k of ["winning", "nil", "conference"]) {
    p[k] = Number(_median(progs.map((q) => q[k]), programs.BASE_DEFAULT[k]));
  }
  p["market"] = programs.MARKET_DEFAULT;
  p["pro"] = 0;
  p["pro_groups"] = {};
  p["drafts"] = programs.empty_drafts(league.FIRST_YEAR - 1);
  const hc = _head(team);
  const overall = get(get(hc, "ratings") || {}, "overall", get(hc, "rating"));
  p["coach"] = overall !== null ? Number(overall) : programs.BASE_DEFAULT["coach"];
  p["rating"] = round(programs.mix(p), 1);
  p["tier"] = programs.tier_of(p["rating"]);
  return { ...p, "market_base": p["market"], "nil_base": p["nil"], "winning_base": p["winning"], "conference_base": p["conference"],
    "live": 0.0, "seasons": [], "year": league.FIRST_YEAR - 1 };
}

export function _tree_median(vals, missing_zero = false) {
  // Per-key medians of number dicts (missing keys count as 0 when `missing_zero`).
  const seen = new Set();
  for (const v of vals) if (_is_dict(v)) for (const k of Object.keys(v)) seen.add(k);
  const keys = sorted(Array.from(seen));
  // (a plain object lists number-like keys first; where the sorted keys hold any, an odict keeps the order they were added in)
  const out = keys.some((k) => /^(0|[1-9]\d*)$/.test(k)) ? odict() : {};
  for (const k of keys) {
    const col = vals.filter((v) => _is_dict(v)).map((v) => get(v, k, missing_zero ? 0 : null));
    const m = _median(col);
    if (m !== null) out[k] = round(m, 3);
  }
  return out;
}

// -> [lat, lon] or null
export function _town(city, state) {
  // A city's spot from the game's own town list (the recruits' hometowns, by state): [lat, lon], or None.
  if (typeof city !== "string" || !_strip(city) || typeof state !== "string") return null;
  // (str.casefold(): lower case here; the two differ only for a few letters outside the town list's, the German ß among them)
  const want = _strip(city).toLowerCase();
  for (const row of get(recruits.model()["generation"]["towns"], state) || []) {
    if (typeof row[0] === "string" && row[0].toLowerCase() === want && row[2] !== null && row[2] !== undefined) return [row[2], row[3]];
  }
  return null;
}

export function _location(team, members) {
  // A team's spot: its lat/lon, else its city in the game's town list, else its state's center, else its conference's.
  if (isNumber(get(team, "lat")) && isNumber(get(team, "lon"))) return [team["lat"], team["lon"]];
  const town = _town(get(team, "city"), get(team, "state"));
  if (town !== null) return town;
  const state = get(team, "state");
  if (typeof state === "string" && league_fill.STATE_CENTER[state] !== undefined) return Array.from(league_fill.STATE_CENTER[state]);
  const locs = members.filter((m) => truthy(get(m, "location"))).map((m) => m["location"]);
  return locs.length ? [round(mean(locs.map(([a]) => a)), 4), round(mean(locs.map(([_, b]) => b)), 4)] : Array.from(league_fill.US_CENTER);
}

export function recruiting_model_for(team, conf, strength) {
  // A new team's recruiting model (recruiting_model.json's per-team shape): the conference members'
  // medians (FBS-wide for a new conference), the baseline of the built-in team nearest in strength.
  const tms = recruits.model()["teams"];
  const strengths = {};
  for (const [s, v] of Object.entries(league_fill.base_strengths())) if (tms[s] !== undefined) strengths[s] = v;
  let mine = sorted((get(conf || {}, "members") || []).filter((s) => strengths[s] !== undefined));
  if (!mine.length) mine = sorted(Object.keys(strengths));
  const rows = mine.map((s) => tms[s]);
  const in_state = round(_median(rows.map((r) => get(r, "in_state_share")), 0.0), 3);
  const nearest = minBy(sorted(Object.keys(strengths)), (s) => Math.abs(strengths[s] - strength));
  return { "tier": league_fill.NEW_TEAM_TIER,
    "class_size": { "mean": round(_median(rows.map((r) => get(get(r, "class_size") || {}, "mean")), 20.0), 1), "by_year": {} },
    "star_share": _tree_median(rows.map((r) => get(r, "star_share") || {}), true),
    "blue_chip_share": round(_median(rows.map((r) => get(r, "blue_chip_share")), 0.0), 3),
    "avg_rating": round(_median(rows.map((r) => get(r, "avg_rating")), 0.0), 4), "signees": 0,   // no signing history of its own
    "positions_per_class": _tree_median(rows.map((r) => get(r, "positions_per_class") || {}), true),
    "in_state_share": in_state,
    "top_states": truthy(get(team, "state")) ? [[team["state"], in_state]] : [],
    "distance_miles": _tree_median(rows.map((r) => get(r, "distance_miles") || {})),
    "location": _location(team, rows), "last_season": null,
    "strength": { "baseline": get(get(tms[nearest], "strength") || {}, "baseline"), "by_class": {} } };
}

export function _meta_edit(slug, doc, base_doc, conf_name) {
  // A built-in team's identity with the file's changes over it.
  const league = modules.league;
  const m = _deepcopy(league.base_meta(slug));
  for (const [k_doc, k_meta] of [["name", "school_name"], ["short_name", "short_name"], ["abbreviation", "abbreviation"],
    ["mascot", "mascot"], ["city", "city"], ["state", "state"]]) {
    if (!_eq(get(doc, k_doc), get(base_doc, k_doc)) && get(doc, k_doc) !== null) m[k_meta] = doc[k_doc];
  }
  m["conference"] = conf_name;
  if (!_eq(get(doc, "colors"), get(base_doc, "colors")) && _is_dict(get(doc, "colors"))) m["colors"] = _colors(doc["colors"]);
  if (!_eq(get(doc, "stadium"), get(base_doc, "stadium")) && _is_dict(get(doc, "stadium"))) {
    m["stadium"] = { ...get(m, "stadium", {}), ...doc["stadium"] };
  }
  if (!_eq(get(doc, "home_field"), get(base_doc, "home_field")) && get(doc, "home_field") !== null) {
    m["program"] = { ...m["program"], "home_field_advantage": doc["home_field"] };
  }
  if (!_eq(get(doc, "rivals"), get(base_doc, "rivals"))) {
    const stand_ins = (get(m, "rivals") || []).filter((r) => Array.from(league.base_slugs()).includes(r) && league.base_meta(r)["fictional"]);
    m["rivals"] = Array.from(get(doc, "rivals") || []).concat(stand_ins);
  }
  return m;
}

export function _depth(doc, roster) {
  const by_name = new Map();
  for (const c of roster) by_name.set(_strip(c["n"]).toLowerCase(), c["id"]);
  const out = {};
  for (const [k, names] of Object.entries(get(doc, "depth_chart") || {})) {
    const role = get(modules.league_file.POS_IN, k, k);
    if (out[role] === undefined) out[role] = [];
    for (const n of names || []) {
      if (typeof n === "string" && by_name.has(_strip(n).toLowerCase())) out[role].push(by_name.get(_strip(n).toLowerCase()));
    }
  }
  return out;
}

export class TeamBuildError extends Error {
  // One team of a checked file that the fill could not build (a bug, or a value the checks missed).
  constructor(slug, label) {
    super(`${label}: the team could not be built`);
    this.name = "TeamBuildError";
    this.slug = slug;
    this.label = label;
  }
}

// The slugs of merged["added"] or merged["changed"] (a list, or a dict by slug).
const _slugs = (v) => (Array.isArray(v) ? v : v instanceof Set ? Array.from(v) : Object.keys(v));
const _len = (v) => (Array.isArray(v) ? v.length : v instanceof Set ? v.size : Object.keys(v).length);

// -> [league, lines]
export function to_league(merged, seed) {
  // A merged, checked league file as a career league (state["league"]; league.from_base's shape) and
  // the import summary's sentences. Built-in teams the file leaves alone are the built-in league's.
  const league = modules.league, league_file = modules.league_file, programs = modules.programs;
  const base = league_fill._base_league();
  const docs = league_file._builtin_docs();
  const lgd = league.from_base(league.FIRST_YEAR);
  for (const s of _slugs(merged["removed"])) delete lgd["teams"][s];
  const attrs = lgd["attrs"];
  const strengths = league_fill.base_strengths();
  const added = new Set(_slugs(merged["added"]));
  const work = sorted(Array.from(new Set(_slugs(merged["added"]).concat(_slugs(merged["changed"])))))
    .filter((s) => merged["teams"][s] !== undefined);

  const refill = new Set(work.filter((s) => added.has(s) || !_eq(get(merged["teams"][s], "roster"), get(docs[s], "roster"))));
  const taken = new Set();
  for (const [s, t] of Object.entries(lgd["teams"])) {                // every kept player's id and name, and every id the file gives
    if (!refill.has(s)) {
      for (const c of t["roster"]) {
        taken.add(c["id"]);
        taken.add(_strip(c["n"]).toLowerCase());
      }
    }
  }
  for (const s of refill) {                                           // (a set walked: only added to `taken`, so the order does not show)
    for (const p of get(merged["teams"][s], "roster") || []) if (_is_dict(p) && truthy(get(p, "id"))) taken.add(p["id"]);
  }

  const models = {};
  let fill_lines = [];
  const coach_names = modules.carousel._taken_names(lgd);        // every coach name already in the league (lower case)
  for (const slug of work) {
    try {
      const doc = merged["teams"][slug];
      const conf = get(merged["conferences"], get(doc, "conference")) || { "members": [] };
      const conf_name = league_file.engine_name(merged, get(doc, "conference"));   // a renamed built-in keeps its engine name
      const rng = new Random(`league-${seed}-${slug}`);
      const is_new = added.has(slug);
      const bdoc = get(docs, slug, {});
      if (lgd["teams"][slug] === undefined) lgd["teams"][slug] = {};
      const entry = lgd["teams"][slug];
      if (is_new || !_eq(get(doc, "coaches"), get(bdoc, "coaches"))) {
        entry["coaches"] = league_fill.coaches_for(doc, conf, base, rng, coach_names);
        if (!is_new && !_eq(entry["coaches"]["head_coach"], base["teams"][slug]["coaches"]["head_coach"])) {
          const p = entry["program"];              // a new or edited head coach: the program's coach appeal follows him
          p["coach"] = Number(entry["coaches"]["head_coach"]["ratings"]["overall"]);
          p["rating"] = round(programs.mix(p), 1);
          p["tier"] = programs.tier_of(p["rating"]);
        }
      }
      if (entry["coaches"] === undefined) throw new Error("KeyError: 'coaches'");
      const built = { ...doc, "coaches": entry["coaches"] };
      let target;
      if (is_new) {
        const [style, formation] = league_fill.style_and_formation(built, conf, base);
        entry["style"] = get(doc, "style") || style;
        const given_formation = _deepcopy(get(doc, "formation"));
        entry["formation"] = truthy(given_formation) ? given_formation : formation;
        entry["program"] = league_fill.program_for(built, conf, base);
        entry["meta"] = league_fill.team_meta_doc({ ...doc, "prestige": entry["program"]["prestige"] }, conf_name);
      } else {
        if (!_eq(get(doc, "formation"), get(bdoc, "formation")) && truthy(get(doc, "formation"))) {
          entry["formation"] = _deepcopy(doc["formation"]);
        }
        if (!_eq(get(doc, "style"), get(bdoc, "style")) && truthy(get(doc, "style"))) entry["style"] = doc["style"];
        if (league_fill._IDENTITY.some((k) => !_eq(get(doc, k), get(bdoc, k)))) {
          entry["meta"] = league_fill._meta_edit(slug, doc, bdoc, conf_name);
        }
        if (!_eq(get(doc, "prestige"), get(bdoc, "prestige")) && get(doc, "prestige") !== null) {
          const p = entry["program"];
          p["prestige"] = p["history"] = Number(doc["prestige"]);
          p["rating"] = round(programs.mix(p), 1);
          p["tier"] = programs.tier_of(p["rating"]);
          if (entry["meta"] === undefined) entry["meta"] = _deepcopy(league.base_meta(slug));
          entry["meta"]["program"] = { ...entry["meta"]["program"], "prestige": 1 + round(5 * Number(doc["prestige"]) / 100) };
        }
      }
      if (refill.has(slug)) {
        target = league_fill.strength_target(doc, conf, strengths);
        const team = { ...doc, "formation": entry["formation"] };
        if (!is_new && team["short_name"] === undefined) team["short_name"] = league.base_meta(slug)["short_name"];
        const [roster, more] = league_fill.fill_roster(team, target, rng, attrs, taken);
        entry["roster"] = roster;
        fill_lines = fill_lines.concat(more);
        if (entry["meta"] !== undefined) entry["meta"]["roster_size"] = entry["roster"].length;
      } else {
        target = get(strengths, slug, median(Object.values(strengths)));
      }
      if (truthy(get(doc, "depth_chart"))) entry["depth"] = league_fill._depth(doc, entry["roster"]);
      if (is_new) {
        models[slug] = league_fill.recruiting_model_for(doc, conf, target);
      } else if (["lat", "lon", "state", "city"].some((k) => !_eq(get(doc, k), get(bdoc, k)))) {
        const m = _deepcopy(get(recruits.model()["teams"], slug) || {});
        const town = _town(get(doc, "city"), get(doc, "state"));
        if (!_eq([get(doc, "lat"), get(doc, "lon")], [get(bdoc, "lat"), get(bdoc, "lon")]) && !_eq(_location(doc, []), Array.from(league_fill.US_CENTER))) {
          m["location"] = _location(doc, []);
        } else if (town !== null) {                              // moved city, no new lat/lon: the city in the game's town list
          m["location"] = town;
        } else if (!_eq(get(doc, "state"), get(bdoc, "state")) && typeof get(doc, "state") === "string"
                   && league_fill.STATE_CENTER[doc["state"]] !== undefined) {   // another state: its center
          m["location"] = Array.from(league_fill.STATE_CENTER[doc["state"]]);
        }
        if (!_eq(get(doc, "state"), get(bdoc, "state")) && truthy(get(doc, "state"))) {
          const share = get(m, "in_state_share") || 0.0;
          m["top_states"] = [[doc["state"], share]].concat((get(m, "top_states") || [])
            .filter((r) => r[0] !== doc["state"] && r[0] !== get(bdoc, "state")));
        }
        models[slug] = m;
      }
    } catch (e) {  // league_file.check turns it into the team's sentence
      const doc = get(merged["teams"], slug) || {};
      let label = slug;
      for (const v of [get(doc, "short_name"), get(doc, "name")]) {
        if (typeof v === "string" && _strip(v)) { label = _strip(v); break; }
      }
      const err = new TeamBuildError(slug, label);
      err.cause = e;
      throw err;
    }
  }

  lgd["source"] = { "format": league_file.FORMAT, "name": merged["name"] };
  lgd["recruiting_models"] = models;
  lgd["schedule_rules"] = league_file.schedule_rules(merged);   // the generator's rules_override (offseason.next_season)
  lgd["divisions"] = league_file.divisions(merged);             // season.divisions
  lgd["conference_names"] = league_file.conference_names(merged);   // engine name -> the file's display name
  const n_add = _len(merged["added"]), n_chg = _len(merged["changed"]), n_rem = _len(merged["removed"]);
  const lines = [`Added ${n_add} ${n_add === 1 ? "team" : "teams"}, changed ${n_chg} and removed ${n_rem}.`].concat(fill_lines);
  return [lgd, lines];
}

// `blob`: the file's bytes (a Uint8Array), or its text.
export function league_seed(blob, seed) {
  // The seed a league is filled with: the one asked for, else one read from the file's bytes.
  if (seed !== null && seed !== undefined) return int(Number(seed));
  const bytes = typeof blob === "string" ? new TextEncoder().encode(blob) : blob;
  return parseInt(_sha256_hex(bytes).slice(0, 8), 16);
}

export const league_fill = {
  STRENGTH_GRADE, SLOT_STEP, CLASS_STEP, STAR_STEP, PLAYER_SD, OVERALL_RANGE, NUDGE_RANGE, NUDGE_STEPS, NUDGE_CLOSE,
  CLASS_MIX, CLASS_LEAD, ROOM_BY_CLASS, _TEMPLATE_POS, _LB,
  _base_tables, base_strengths, _percentile, strength_target, fit_overall, starter_level, _slugify, _unique_id, _starters_at,
  _group_positions, _home, _default_formation, _team_overall, fill_roster, _class_order, _clamp_overall, _with_ratings, _compact,
  NEUTRAL_COLORS, NEW_STADIUM_CAPACITY, NEW_TEAM_TIER, US_CENTER, _IDENTITY,
  _state_center, _base_league, _members, _common, _median, _head, _schemes, _initials, team_meta_doc, _set_rating, coaches_for,
  style_and_formation, program_for, _tree_median, _town, _location, recruiting_model_for, _meta_edit, _depth, TeamBuildError,
  to_league, league_seed, _eq, _sha256_hex,
};

// The three values worked out at their first use, not as the module loads (and settable, as any module variable).
function _lazy(name, make) {
  let value, made = false;
  Object.defineProperty(league_fill, name, {
    enumerable: true,
    get() { if (!made) { value = make(); made = true; } return value; },
    set(v) { value = v; made = true; },
  });
}
_lazy("COACH_YEAR", () => modules.league.FIRST_YEAR);            // a generated coach's first season
_lazy("_COACH_ROLES", () => modules.league_file._COACH_ROLES);
_lazy("STATE_CENTER", () => _state_center());                    // each state's town-weighted center (recruits' towns)

modules.league_fill = league_fill;
