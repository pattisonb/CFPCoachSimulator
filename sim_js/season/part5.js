// sim/season.py, part 5 (the Python file's lines 3449 to 4270): this week's game and its simulated prediction, the
// ratings a page shows for a team, the schedule view, the summary every page load reads, the bracket and bowl
// projections, the preseason awards outlook, the bowls, and the season in review.
//
// Ported by engine_js/PORTING.md's rules ("A big file ported in parts"): every name of the season file is reached
// through the `season` namespace, and this part's own are put on it where the Python defines them.
import { round, sum, cmp, sorted, maxBy, minBy, get, truthy, isNumber, floordiv, range, json_dumps } from "../../engine_js/pyrt.js";
import { modules } from "../../engine_js/modules.js";
import { simulate_game } from "../../engine_js/game.js";
import { season } from "../season_ns.js";
import { awards } from "../awards.js";
import { bowls } from "../bowls.js";
import { coaches } from "../coaches.js";
import { polls } from "../polls.js";
import { shown as _shown } from "../../teamdata_js/shown.js";

// ----- what Python has built in and JavaScript does not (this file's own, not on the namespace) -----------------

const _SHA_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
const _encoder = new TextEncoder();

/** hashlib.sha256(text.encode()).hexdigest(): the text's UTF-8 bytes hashed, as 64 hex digits. */
export function sha256_hex(text) {
  const bytes = _encoder.encode(text);
  const len = bytes.length;
  const total = (Math.floor((len + 9) / 64) + ((len + 9) % 64 ? 1 : 0)) * 64;
  const m = new Uint8Array(total);
  m.set(bytes);
  m[len] = 0x80;
  const bits = len * 8;
  m[total - 1] = bits & 0xff; m[total - 2] = (bits >>> 8) & 0xff; m[total - 3] = (bits >>> 16) & 0xff; m[total - 4] = (bits >>> 24) & 0xff;
  m[total - 5] = Math.floor(bits / 4294967296) & 0xff;
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
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
      const t1 = (h + S1 + ch + _SHA_K[i] + W[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + mj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  let out = "";
  for (let i = 0; i < 8; i++) out += H[i].toString(16).padStart(8, "0");
  return out;
}

const _f64 = new DataView(new ArrayBuffer(8));
_f64.setUint32(0, 0x4006db6e);
_f64.setUint32(4, 0);
const _ERF_SPLIT = _f64.getFloat64(0);                  // about 1/0.35: fdlibm tests the number's high word against this

// math.erf's coefficients (fdlibm's s_erf.c, which the C library's erf is).
const _PP = [1.28379167095512558561e-01, -3.25042107247001499370e-01, -2.84817495755985104766e-02, -5.77027029648944159157e-03,
  -2.37630166566501626084e-05];
const _QQ = [0.0, 3.97917223959155352819e-01, 6.50222499887672944485e-02, 5.08130628187576562776e-03, 1.32494738004321644526e-04,
  -3.96022827877536812320e-06];
const _PA = [-2.36211856075265944077e-03, 4.14856118683748331666e-01, -3.72207876035701323847e-01, 3.18346619901161753674e-01,
  -1.10894694282396677476e-01, 3.54783043256182359371e-02, -2.16637559486879084300e-03];
const _QA = [0.0, 1.06420880400844228286e-01, 5.40397917702171048937e-01, 7.18286544141962662868e-02, 1.26171219808761642112e-01,
  1.36370839120290507362e-02, 1.19844998467991074170e-02];
const _RA = [-9.86494403484714822705e-03, -6.93858572707181764372e-01, -1.05586262253232909814e+01, -6.23753324503260060396e+01,
  -1.62396669462573470355e+02, -1.84605092906711035994e+02, -8.12874355063065934246e+01, -9.81432934416914548592e+00];
const _SA = [0.0, 1.96512716674392571292e+01, 1.37657754143519042600e+02, 4.34565877475229228821e+02, 6.45387271733267880336e+02,
  4.29008140027567833386e+02, 1.08635005541779435134e+02, 6.57024977031928170135e+00, -6.04244152148580987438e-02];
const _RB = [-9.86494292470009928597e-03, -7.99283237680523006574e-01, -1.77579549177547519889e+01, -1.60636384855821916062e+02,
  -6.37566443368389627722e+02, -1.02509513161107724954e+03, -4.83519191608651397019e+02];
const _SB = [0.0, 3.03380607434824582924e+01, 3.25792512996573918826e+02, 1.53672958608443695994e+03, 3.19985821950859553908e+03,
  2.55305040643316442583e+03, 4.74528541206955367215e+02, -2.24409524465858183362e+01];

/**
 * math.erf(x): the C library's (glibc's s_erf.c: fdlibm's method, its polynomials summed in glibc's order), written
 * the same way so the two agree to the last digit wherever their exp does.
 */
export function erf(x) {
  if (Number.isNaN(x)) return x;
  if (x === Infinity) return 1;
  if (x === -Infinity) return -1;
  const neg = x < 0 || Object.is(x, -0);
  const ax = Math.abs(x);
  if (ax < 0.84375) {
    if (ax < 3.7252902984619140625e-09) {                 // |x| < 2**-28
      if (ax < Math.pow(2, -1015)) return 0.0625 * (16.0 * x + (16.0 * 1.28379167095512586316e-01) * x);    // avoid underflow
      return x + 1.28379167095512586316e-01 * x;
    }
    const z = x * x;
    const r1 = _PP[0] + z * _PP[1], z2 = z * z;
    const r2 = _PP[2] + z * _PP[3], z4 = z2 * z2;
    const s1 = 1.0 + z * _QQ[1];
    const s2 = _QQ[2] + z * _QQ[3];
    const s3 = _QQ[4] + z * _QQ[5];
    const r = r1 + z2 * r2 + z4 * _PP[4];
    const s = s1 + z2 * s2 + z4 * s3;
    const y = r / s;
    return x + x * y;
  }
  if (ax < 1.25) {
    const s = ax - 1.0;
    const P1 = _PA[0] + s * _PA[1], s2 = s * s;
    const Q1 = 1.0 + s * _QA[1], s4 = s2 * s2;
    const P2 = _PA[2] + s * _PA[3], s6 = s4 * s2;
    const Q2 = _QA[2] + s * _QA[3];
    const P3 = _PA[4] + s * _PA[5];
    const Q3 = _QA[4] + s * _QA[5];
    const P = P1 + s2 * P2 + s4 * P3 + s6 * _PA[6];
    const Q = Q1 + s2 * Q2 + s4 * Q3 + s6 * _QA[6];
    const erx = 8.45062911510467529297e-01;
    return neg ? -erx - P / Q : erx + P / Q;
  }
  if (ax >= 6) return neg ? 1e-300 - 1.0 : 1.0 - 1e-300;
  const s = 1.0 / (ax * ax);
  let R, S;
  if (ax < _ERF_SPLIT) {
    const R1 = _RA[0] + s * _RA[1], s2 = s * s;
    const S1 = 1.0 + s * _SA[1], s4 = s2 * s2;
    const R2 = _RA[2] + s * _RA[3], s6 = s4 * s2;
    const S2 = _SA[2] + s * _SA[3], s8 = s4 * s4;
    const R3 = _RA[4] + s * _RA[5];
    const S3 = _SA[4] + s * _SA[5];
    const R4 = _RA[6] + s * _RA[7];
    const S4 = _SA[6] + s * _SA[7];
    R = R1 + s2 * R2 + s4 * R3 + s6 * R4;
    S = S1 + s2 * S2 + s4 * S3 + s6 * S4 + s8 * _SA[8];
  } else {
    const R1 = _RB[0] + s * _RB[1], s2 = s * s;
    const S1 = 1.0 + s * _SB[1], s4 = s2 * s2;
    const R2 = _RB[2] + s * _RB[3], s6 = s4 * s2;
    const S2 = _SB[2] + s * _SB[3];
    const R3 = _RB[4] + s * _RB[5];
    const S3 = _SB[4] + s * _SB[5];
    const S4 = _SB[6] + s * _SB[7];
    R = R1 + s2 * R2 + s4 * R3 + s6 * _RB[6];
    S = S1 + s2 * S2 + s4 * S3 + s6 * S4;
  }
  _f64.setFloat64(0, ax);
  _f64.setUint32(4, 0);                                   // z: |x| with its low 32 bits cleared
  const z = _f64.getFloat64(0);
  const r = Math.exp(-z * z - 0.5625) * Math.exp((z - ax) * (z + ax) + R / S);
  return neg ? r / ax - 1.0 : 1.0 - r / ax;
}

/** `item in container` where the container is Python's set, tuple, list or dict (whatever shape its port took). */
function _in(item, container) {
  if (container === null || container === undefined) return false;
  if (container instanceof Set || container instanceof Map) return container.has(item);
  if (Array.isArray(container)) return container.includes(item);
  return Object.prototype.hasOwnProperty.call(container, item);
}

/** A dict with whole-number keys (PLAYOFF_WEEKS, BOWL_WEEK_LABELS): its [key, value] pairs, the keys as numbers. */
function _int_items(d) {
  if (d instanceof Map) return [...d.entries()].map(([k, v]) => [Number(k), v]);
  return Object.entries(d).map(([k, v]) => [Number(k), v]);
}

/** Such a dict's .get(key, default). */
function _int_get(d, k, dflt = null) {
  if (d instanceof Map) return d.has(k) ? d.get(k) : d.has(String(k)) ? d.get(String(k)) : dflt;
  return get(d, k, dflt);
}

/** max(xs, key=..., default=None). */
const _max_or_none = (xs, key) => (xs.length ? maxBy(xs, key) : null);

/** str(v) for a value an f-string prints as it is. */
const _str = (v) => (v === null || v === undefined ? "None" : v === true ? "True" : v === false ? "False" : String(v));

/** Whether two of team_ratings_now's signatures (tuples in Python) are equal. */
function _same_sig(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Array.isArray(a[i]) && Array.isArray(b[i])) {
      if (a[i].length !== b[i].length || a[i].some((v, j) => v !== b[i][j])) return false;
    } else if (a[i] !== b[i]) return false;
  }
  return true;
}

// ----- this week: the upcoming game and a simulated prediction ------------------------

season._preview_cache = {};


function _preview_team(state, slug) {
  // The team as the next sim will see it: god-mode edits where that exists, the depth
  // chart and the injury list.
  return season._with_injuries(season.apply_depth(season.team_data(state, slug), get(get(state, "depth") || {}, slug)), season._injured(state, slug));
}


season._PREVIEW_KEYS = ["completions", "pass_attempts", "pass_yards", "passing_touchdowns", "interceptions_thrown",
  "carries", "rush_yards", "rushing_touchdowns", "receptions", "receiving_yards", "receiving_touchdowns"];
// (Python's _preview_lock is dropped: there are no threads here)
season._preview_inflight = {};      // cache key -> Event while one thread computes it (always empty here)


function _preview_sim(args) {
  // One simulation of the previewed game (in a pool worker when there is one); only the
  // numbers the This week card uses come back.
  const [home, away, seed, venue] = args;
  const r = simulate_game(home, away, null, seed, venue);
  const out = {};
  for (const side of ["home", "away"]) {
    const players = [];
    for (const p of r[side]["players"]) {
      if (!truthy(get(p, "stats"))) continue;
      const stats = {};
      for (const k of season._PREVIEW_KEYS) if (isNumber(get(p["stats"], k))) stats[k] = p["stats"][k];
      players.push([p["name"], p["position"], stats]);
    }
    out[side] = { score: r[side]["score"], players };
  }
  return out;
}


function _preview_prediction(state, g, sims) {
  // Simulate the previewed game `sims` times (in parallel on the worker pool when there
  // is one) and sum it up: win odds, the likely score, and the players to watch.
  const h = season._preview_team(state, g["home"]), a = season._preview_team(state, g["away"]);
  const seed0 = parseInt(sha256_hex(`${state["id"]}|${g["event_id"]}|${state["current_week"]}`).slice(0, 8), 16);
  const venue = truthy(g["neutral"]) ? "neutral" : "home";
  const jobs = range(sims).map((i) => [h, a, seed0 + i, venue]);
  // (no pool here: the sims are played one after the other, as Python does without one)
  const results = jobs.map((j) => season._preview_sim(j));
  let wins = 0;
  const pts = { home: [], away: [] };
  const stat_sum = { home: {}, away: {} };
  for (const r of results) {
    if (r["home"]["score"] > r["away"]["score"]) wins += 1;
    for (const side of ["home", "away"]) {
      pts[side].push(r[side]["score"]);
      for (const [name, position, stats] of r[side]["players"]) {
        const k0 = `${name}|${position}`;
        if (stat_sum[side][k0] === undefined) stat_sum[side][k0] = { name, position, stats: {} };
        const acc = stat_sum[side][k0];
        for (const [k, v] of Object.entries(stats)) acc["stats"][k] = get(acc["stats"], k, 0) + v;
      }
    }
  }

  const watch = (side, key_stat, keys) => {
    const best = _max_or_none(Object.values(stat_sum[side]), (x) => get(x["stats"], key_stat, 0));
    if (!best || !truthy(get(best["stats"], key_stat))) return null;
    const out = { name: best["name"], position: best["position"] };
    for (const k of keys) out[k] = round(get(best["stats"], k, 0) / sims, 1);
    return out;
  };

  const avg = {};
  for (const [s, v] of Object.entries(pts)) avg[s] = sum(v) / sims;
  // Win odds: the simulated win rate (with a one-game prior so 20 of 20 is not "certain")
  // blended with a margin model (a 16-point favorite wins about 84% of the time in
  // college football), and never below 2% or above 98%: upsets happen.
  const p_sims = (wins + 1) / (sims + 2);
  const p_margin = 0.5 * (1 + erf((avg["home"] - avg["away"]) / (16 * Math.sqrt(2))));
  const p_home = Math.max(0.02, Math.min(0.98, 0.5 * p_sims + 0.5 * p_margin));
  const pred = { sims, home_win_prob: round(p_home, 2), home_points: round(avg["home"], 1), away_points: round(avg["away"], 1),
    margin: round(round(avg["home"], 1) - round(avg["away"], 1), 1), total: round(round(avg["home"], 1) + round(avg["away"], 1), 1),
    watch: {} };
  for (const side of ["home", "away"]) {
    pred["watch"][side] = {
      passer: watch(side, "pass_yards", ["completions", "pass_attempts", "pass_yards", "passing_touchdowns", "interceptions_thrown"]),
      rusher: watch(side, "rush_yards", ["carries", "rush_yards", "rushing_touchdowns"]),
      receiver: watch(side, "receiving_yards", ["receptions", "receiving_yards", "receiving_touchdowns"]) };
  }
  return pred;
}


season._RATINGS_NOW = {};       // (a save's id, a team) as JSON text -> [signature, ratings]


function team_ratings_now(state, slug) {
  // A team's ratings as it would line up today (the player's ask): its depth chart as it is set, anyone hurt stepping
  // aside for the next man, every edit to a player in. The same sum as the ratings built with the team
  // (game_ratings, which rates every team as its file loads), so an untouched, healthy team reads exactly as it was
  // built. None for an FCS stand-in. On the game's own scale: the page's is _unit_overalls.
  const base = truthy(slug) ? get(season.load_teams(), slug) : null;
  if (base === null || truthy(get(base, "fictional"))) return null;
  const hurt = get(get(state, "injuries") || {}, slug) || {};
  const depth = get(get(state, "depth") || {}, slug);
  // (the signature's last item is id(base) in Python: the team's own object here, compared by identity)
  const sig = [season.season_year(state), get(state, "current_week"), truthy(depth) ? json_dumps(depth, { sort_keys: true }) : "",
    sorted(Object.keys(hurt)), json_dumps(get(get(state, "player_edits") || {}, slug) || {}, { sort_keys: true }), base];
  const key = JSON.stringify([get(state, "id"), slug]);
  const hit = get(season._RATINGS_NOW, key);
  if (hit && _same_sig(hit[0], sig)) return hit[1];
  const t = season.apply_depth(season.team_data(state, slug), depth);
  const out = season.game_ratings(t, hurt);
  season._RATINGS_NOW[key] = [sig, out];
  return out;
}


function game_ratings(t, hurt = []) {
  // A team's offense, defense, special teams and overall on the game's own scale (what the polls, the odds, the awards
  // and an AD's expectations read), from the same average the page shows (the player's ask: one rating everywhere): its
  // players' overalls weighted by position (PAGE_POS_VALUE), the starters in full and one backup a starting spot a
  // little (PAGE_DEPTH_WEIGHT), each unit through league.TEAM_FIT. Every team is rated this way as its file loads
  // (load_teams), so a team as it was built and as it lines up today are the same sum.
  const league = modules.league;
  const units = { offense: [], defense: [], special_teams: [] };
  for (const [role, group] of Object.entries(season._players_by_role(t, t["offense"].concat(t["defense"])))) {
    if (role === "KR" || role === "PR") continue;
    const fit = group.filter((p) => !_in(`${p["name"]}|${p["position"]}`, hurt));
    const n = season.role_starters(t, role), value = get(season.PAGE_POS_VALUE, role, 1.0);
    const unit = role === "K" || role === "P" ? "special_teams" : _in(role, league.OFFENSE_ROLES) ? "offense" : "defense";
    fit.slice(0, 2 * n).forEach((p, i) => {
      units[unit].push([season.shown_overall(p), i < n ? value : value * season.PAGE_DEPTH_WEIGHT]);
    });
  }
  const out = {};
  for (const [unit, rows] of Object.entries(units)) {
    const [a, b] = league.TEAM_FIT[unit];
    out[unit] = rows.length
      ? round(Math.max(1.0, Math.min(99.0, a * sum(rows.map(([o, w]) => o * w)) / sum(rows.map(([, w]) => w)) + b)), 1)
      : 40.0;
  }
  out["overall"] = round(0.45 * out["offense"] + 0.45 * out["defense"] + 0.1 * out["special_teams"], 1);
  return out;
}


function team_overall(state, slug) {
  // A team's overall as the page shows it (a box score's scoreboard); None for an FCS stand-in.
  return get(season._unit_overalls(state, slug) || {}, "overall");
}


// *tune* what a position is worth in the rating a page shows for a team (page_ratings): the quarterback most, the edges,
// tackles, corners and receivers next
season.PAGE_POS_VALUE = { QB: 3.0, HB: 1.0, FB: 0.4, WR: 1.2, TE: 0.9, LT: 1.3, LG: 1.0, C: 1.0, RG: 1.0, RT: 1.2,
  LEDG: 1.4, REDG: 1.4, DT: 1.1, SAM: 0.9, MIKE: 1.0, WILL: 0.9, CB: 1.3, FS: 1.0, SS: 1.0,
  K: 0.6, P: 0.4 };
season.PAGE_DEPTH_WEIGHT = 0.15;         // *tune* a backup counts this much of a starter at his position (one backup a starting spot)
season._PAGE_NOW = {};


function page_ratings(t, hurt = []) {
  // A team's overall, offense and defense as the page shows them (the player's ask): an average of its players'
  // overalls as their cards show them, each weighted by what his position is worth (PAGE_POS_VALUE), the starters in
  // full and one backup a starting spot a little (PAGE_DEPTH_WEIGHT). So an offense of mid-80s starters reads in the
  // mid 80s. The game's own ratings (team_ratings_now, which the sim, the polls and the odds read) are untouched.
  const league = modules.league;
  const units = { offense: [], defense: [], special_teams: [] };
  for (const [role, group] of Object.entries(season._players_by_role(t, t["offense"].concat(t["defense"])))) {
    if (role === "KR" || role === "PR") continue;
    const fit = group.filter((p) => !_in(`${p["name"]}|${p["position"]}`, hurt));
    const n = season.role_starters(t, role), value = get(season.PAGE_POS_VALUE, role, 1.0);
    const unit = role === "K" || role === "P" ? "special_teams" : _in(role, league.OFFENSE_ROLES) ? "offense" : "defense";
    fit.slice(0, 2 * n).forEach((p, i) => {
      units[unit].push([_shown.overall(season.shown_overall(p)), i < n ? value : value * season.PAGE_DEPTH_WEIGHT]);
    });
  }

  const mean = (rows) => (rows.length ? round(sum(rows.map(([o, w]) => o * w)) / sum(rows.map(([, w]) => w))) : 40);
  return { overall: mean(units["offense"].concat(units["defense"], units["special_teams"])),
    offense: mean(units["offense"]), defense: mean(units["defense"]) };
}


function _unit_overalls(state, slug) {
  // A team's overall, offense and defense as the page shows a team rating, as it lines up today (page_ratings over
  // its depth chart as it is set, anyone hurt stepping aside); None for a team without ratings (an FCS stand-in).
  if (season.team_ratings_now(state, slug) === null) return null;
  const key = JSON.stringify([get(state, "id"), slug]);
  const sig = season._RATINGS_NOW[key][0];              // team_ratings_now's: the chart, the injuries, the edits, the week
  const hit = get(season._PAGE_NOW, key);
  if (hit && _same_sig(hit[0], sig)) return { ...hit[1] };
  const t = season.apply_depth(season.team_data(state, slug), get(get(state, "depth") || {}, slug));
  const out = season.page_ratings(t, get(get(state, "injuries") || {}, slug) || {});
  season._PAGE_NOW[key] = [sig, out];
  return { ...out };
}


function game_preview(state, slug, sims = 20) {
  // This week for one team: the next game with both ranks and records, and a prediction
  // from simulating it `sims` times (win odds, the likely score, the margin, the passer and
  // rusher to watch). Nothing here touches the season's random stream.
  season.check_fbs(slug);
  const teams = season.load_teams();
  const week = state["current_week"] + 1;
  let g = null;
  for (const x of Object.values(state["games"])) {
    if ((slug === x["home"] || slug === x["away"]) && x["week"] === week) { g = x; break; }
  }
  if (truthy(state["done"])) {
    return { team: slug, team_name: teams[slug]["name"], game: null, reason: "done", injuries: season.injury_report(state, slug) };
  }
  if (g === null) {
    return { team: slug, team_name: teams[slug]["name"], game: null, reason: "bye", week, injuries: season.injury_report(state, slug) };
  }
  const home = g["home"] === slug;
  const opp = home ? g["away"] : g["home"];
  const ranks = season.rank_map(state, state["current_week"]);
  const rec = season._records(state, undefined, true);
  const game = { event_id: g["event_id"], week: g["week"], kind: g["kind"], title: get(g, "title"), site: get(g, "site"), date: get(g, "date") };
  if (!truthy(g["played"])) game["bye_first"] = g["week"] > state["current_week"] + 1;
  Object.assign(game, { opponent: opp, opponent_name: home ? g["away_display"] : g["home_display"], opponent_rank: get(ranks, opp),
    opponent_record: rec[opp] !== undefined && !truthy(get(get(teams, opp, {}), "fictional")) ? season._record_str(rec[opp]) : "",
    my_rank: get(ranks, slug), my_record: season._record_str(rec[slug]),
    venue: season._venue(g, home), rivalry: season.game_rivalry(state, g, g["played"]) });
  game["ratings"] = { mine: season._unit_overalls(state, slug), theirs: season._unit_overalls(state, opp) };   // the Office's matchup: each side's overall, offense, defense
  if (truthy(g["played"])) {
    // game day is done: the result, not a prediction
    const [pf, pa] = season._scores_for(g, home);
    Object.assign(game, { played: true, won: pf > pa, points_for: pf, points_against: pa, overtime: get(g, "overtime") || 0,
      has_box: season.has_box(state, g) });
    return { team: slug, team_name: teams[slug]["name"], game, played: true, prediction: null, injuries: season.injury_report(state, slug) };
  }
  // (Python's key is a tuple; its JSON text is the key here)
  const key = JSON.stringify([state["id"], state["current_week"], g["event_id"],
    json_dumps(get(state, "player_edits") || {}, { sort_keys: true }).slice(0, 200),
    json_dumps(get(state, "depth") || {}, { sort_keys: true }).slice(0, 200), json_dumps(get(state, "injuries") || {}).length]);
  // one computation per matchup: a second request (the page, while the server warms the
  // card after a sim) waits for the first instead of simulating the game again
  // (no threads here: nothing is ever in flight, so the lock, the event and the wait are gone)
  let pred = get(season._preview_cache, key);
  if (pred === null) {
    pred = season._preview_prediction(state, g, sims);
    if (Object.keys(season._preview_cache).length > 64) {
      for (const k of Object.keys(season._preview_cache)) delete season._preview_cache[k];
    }
    season._preview_cache[key] = pred;
  }
  const [mine, theirs] = home ? ["home", "away"] : ["away", "home"];
  const prediction = { sims: pred["sims"], win_prob: home ? pred["home_win_prob"] : round(1 - pred["home_win_prob"], 2),
    points_for: pred[`${mine}_points`], points_against: pred[`${theirs}_points`],
    margin: round(pred[`${mine}_points`] - pred[`${theirs}_points`], 1), total: pred["total"],
    watch: pred["watch"][mine], their_watch: truthy(teams[opp]["fictional"]) ? null : pred["watch"][theirs] };
  return { team: slug, team_name: teams[slug]["name"], game, prediction,
    injuries: season.injury_report(state, slug) };
}


function team_schedule_view(state, slug) {
  // a stand-in's schedule is refused by the dispatcher (no page asks for it); the
  // no-real-FCS scan still reads it here
  const teams = season.load_teams();
  const t = teams[slug];
  const rec = season._records(state, undefined, true)[slug];
  let rk = null;   // the rank in the latest poll released
  for (let w = state["current_week"]; w > -1; w--) {
    if (state["polls"][String(w)] !== undefined) {
      rk = get(season.rank_map(state, w), slug);
      break;
    }
  }
  return { team: slug, team_name: t["name"], conference: t["conference"], record: { wins: rec["wins"], losses: rec["losses"],
    conf_wins: rec["conf_wins"], conf_losses: rec["conf_losses"] }, rank: rk, schedule: season.team_schedule(state, slug) };
}


function _coach_line(state, team) {
  // Who is coaching your team this season, for the season page header: your created coach
  // (the Your coach page) or the team's own head coach, and who runs each side.
  const coach = get(state, "coach");
  // a career's coordinators are its staff's (coach_names: the data's head coach doubling as OC is his own man there)
  const names = {};
  for (const s of (get(get(state, "career") || {}, "staff") || [])) {
    if (get(s, "role") === "OC" || get(s, "role") === "DC") names[s["role"]] = s["name"];
  }
  if (Object.keys(names).length) {
    const cs = { ...(get(team, "coaches") || {}) };
    for (const [role, key] of [["OC", "offensive_coordinator"], ["DC", "defensive_coordinator"]]) {
      if (names[role] !== undefined && truthy(get(cs, key))) cs[key] = { ...cs[key], name: names[role] };
    }
    team = { ...team, coaches: cs };
  }
  if (truthy(coach)) {
    const out = {};
    for (const k of ["id", "first_name", "last_name", "archetype", "offense_scheme",
      "defense_scheme", "calls_offense", "calls_defense", "look"]) out[k] = get(coach, k);
    out["existing"] = false;
    out["staff"] = coaches.staff(coach, team);
    return out;
  }
  const hc = get(get(team, "coaches") || {}, "head_coach") || {};
  return { existing: true, name: get(hc, "name") || "the head coach", staff: coaches.staff(null, team) };
}


function _job(state) {
  try {
    return modules.carousel.status(state);
  } catch (e) {  // a program the recruiting model lacks: no job card
    return null;
  }
}


function summary(state) {
  const teams = season.load_teams();
  const rec = season._records(state, undefined, true)[state["team"]];
  const schedule = season.team_schedule(state, state["team"]);
  const week_set = new Set(Object.values(state["games"]).map((g) => g["week"]));
  week_set.add(season.CCG_WEEK);
  week_set.add(season.SELECTION_WEEK);
  for (const [w] of _int_items(season.PLAYOFF_WEEKS)) week_set.add(w);
  const weeks = sorted(week_set);
  const week_labels = {};
  for (const w of range(1, season.LAST_REGULAR_WEEK + 1)) week_labels[w] = season.week_name(w);
  week_labels[season.CCG_WEEK] = "Championship Week";
  week_labels[season.SELECTION_WEEK] = "Selection";
  for (const [w, label] of _int_items(season.BOWL_WEEK_LABELS)) week_labels[w] = label;
  const fbs = season.fbs_only(teams);
  return {
    id: state["id"], team: state["team"], team_name: state["team_name"], conference: state["conference"],
    mode: state["mode"], created_at: state["created_at"], current_week: state["current_week"],
    phase: state["phase"], done: state["done"], champion: get(state, "champion"), year: season.season_year(state),
    offseason_stage: get(get(state, "offseason") || {}, "stage"),
    job: truthy(get(state, "career")) ? season._job(state) : null,
    champion_name: truthy(get(state, "champion")) ? teams[state["champion"]]["name"] : null,
    // the national championship once its two teams are known (the season strip's Title Wk tile), with its score once played
    title_game: truthy(get(state["games"], "cfp-final")) ? season._game_line(state["games"]["cfp-final"], teams, state) : null,
    record: rec, schedule, weeks, my_rank: season.current_rank(state),
    coach: season._coach_line(state, teams[state["team"]]),
    week_labels,
    polls: state["polls"], champions: state["champions"], bracket: state["bracket"], playoff: state["playoff"],
    cfp_weeks: sorted(season.CFP_WEEKS), bowls: season.bowl_view(state), playoff_sites: get(state, "playoff_sites"),
    bowl_projection: season.bowl_projection(state),
    // outlooks before there is anything official (views only): the bracket as it would be seeded today, and the
    // bowls from the same order, both from the AP poll until the committee ranks
    bracket_projection: season.bracket_projection(state),
    bowl_outlook: season.bowl_projection(state, true),
    week_dates: season.week_dates(state),
    heisman: get(get(get(state, "awards") || {}, "national") || {}, "heisman"),
    settings: season.settings(state),
    injuries: season.injury_report(state, state["team"]),
    // (Python walks the set of FBS slugs that have an injury list; a sum of whole numbers, so the order is nothing)
    injury_count: sum(Object.keys(get(state, "injuries", {})).filter((k) => _in(k, fbs)).map((k) => Object.keys(state["injuries"][k]).length)),
    my_awards: truthy(get(state, "awards")) ? awards.my_awards(state, state["awards"]) : [],
    career: get(state, "career"),
    league: get(get(get(state, "league") || {}, "source") || {}, "name"),   // a career from a league file
  };
}


function _projection_order(state) {
  // The ranking a projection reads, best first: the committee's latest when it has ranked, else the latest AP poll
  // (its 25, the others receiving votes, then every other FBS team by rating). (order, "cfp" or "ap", the poll's week).
  const ps = get(state, "polls", {});
  for (let w = state["current_week"]; w > -1; w--) {
    const p = get(ps, String(w)) || {};
    if (truthy(get(p, "cfp"))) {
      return [truthy(get(p, "cfp_full")) ? p["cfp_full"] : p["cfp"].map((e) => e["team"]), "cfp", w];
    }
  }
  const teams = season.load_teams();
  for (let w = state["current_week"]; w > -1; w--) {
    const p = get(ps, String(w)) || {};
    if (truthy(get(p, "ap"))) {
      const order = p["ap"].map((e) => e["team"]).concat((get(p, "ap_others") || []).map((e) => e["team"]));
      const seen = new Set(order);
      const rest = sorted(Object.entries(teams).filter(([s, t]) => !truthy(t["fictional"]) && !seen.has(s)).map(([s]) => s),
        (s) => -teams[s]["team_ratings"]["overall"]);
      return [order.concat(rest), "ap", w];
    }
  }
  return null;
}


function _conference_leaders(state, teams, order) {
  // Each conference's leader today, a projection's champion: by conference record, then record, then the ranking,
  // then rating (before anyone has played, the best-ranked team).
  const rec = season._records(state);
  const pos = {};
  order.forEach((s, i) => { pos[s] = i; });
  const leaders = {};
  for (const [slug, t] of Object.entries(teams)) {
    if (truthy(t["fictional"])) continue;
    const r = rec[slug];
    const cg = r["conf_wins"] + r["conf_losses"];
    const key = [cg ? r["conf_wins"] / cg : 0.0, r["wins"] / Math.max(1, r["wins"] + r["losses"]), -get(pos, slug, 999),
      t["team_ratings"]["overall"]];
    if (leaders[t["conference"]] === undefined || cmp(key, leaders[t["conference"]][0]) > 0) {
      leaders[t["conference"]] = [key, slug];
    }
  }
  const out = {};
  for (const [conf, [, slug]] of Object.entries(leaders)) out[conf] = slug;
  return out;
}


function bracket_projection(state) {
  // The playoff bracket as it would be seeded today (polls.build_bracket), from the committee's latest ranking, or
  // the AP poll before the committee ranks, with each conference's current leader as its champion. A view only: the
  // real bracket is set on selection day (state["bracket"]), and then this is None.
  if (truthy(get(state, "bracket"))) return null;
  const got = season._projection_order(state);
  if (!got) return null;
  const [order, source, week] = got;
  const teams = season.load_teams();
  const conf_of = {}, names = {};
  for (const [slug, t] of Object.entries(teams)) { conf_of[slug] = t["conference"]; names[slug] = t["name"]; }
  let b;
  try {
    b = polls.build_bracket(order, season._conference_leaders(state, teams, order), conf_of, names);
  } catch (e) {  // a field that will not build: no projection
    return null;
  }
  return { ...b, projected: true, source, week };
}


season.AWARDS_RACE_WEEK = 4;          // *tune* the awards page shows the preseason favorites until this many weeks are played
season.OUTLOOK_HOPEFULS = 5;          // *tune* names in each award's preseason list
season.OUTLOOK_HEISMAN = 12;          // *tune* names on the preseason Heisman watch
season.OUTLOOK_TEAM = 4.0;            // *tune* rating points a team's poll position is worth to a favorite (x awards._rank_bonus)
// an award's kind -> the position groups it draws from (awards.Pool._group); a few kinds add a rule of their own below
season._OUTLOOK_GROUPS = {
  mvp: ["QB", "RB", "WR", "TE", "EDGE", "DT", "LB", "DB"], mvp_team: ["QB", "RB", "WR", "TE", "EDGE", "DT", "LB", "DB"],
  qb: ["QB"], qb_upper: ["QB"], rb: ["RB"], wr: ["WR"], te: ["TE"], interior: ["OL", "DT"], c: ["OL"],
  front: ["OL", "EDGE", "DT", "LB"], dpoy: ["EDGE", "DT", "LB", "DB"], dpoy_alt: ["EDGE", "DT", "LB", "DB"],
  lb: ["LB"], db: ["DB"], edge: ["EDGE"], k: ["K"], p: ["P"], rs: ["RB", "WR", "DB"],
  versatile: ["RB", "WR", "DB"], freshman: ["QB", "RB", "WR", "TE", "EDGE", "DT", "LB", "DB"],
};


function awards_outlook(state, teams) {
  // Preseason award favorites, shaped like awards.race_view, for the weeks before anyone has played enough to
  // race: the best-rated starters at each award's positions, lifted by their team's poll position. The Heisman
  // watch splits a full ballot's points by the same score. A view only: no award is decided from it.
  const ps = get(state, "polls", {});
  let ap = {};
  for (let w = state["current_week"]; w > -1; w--) {
    const p = get(ps, String(w)) || {};
    if (truthy(get(p, "ap"))) {
      ap = {};
      for (const e of p["ap"]) ap[e["team"]] = e["rank"];
      break;
    }
  }
  const rec = season._records(state);
  const pool = [];
  for (const [slug, t] of Object.entries(teams)) {
    if (truthy(t["fictional"])) continue;
    const returners = new Set([get(t, "kick_returner"), get(t, "punt_returner")]);
    for (const p of t["offense"].concat(t["defense"])) {
      const group = awards.Pool._group(p["position"], get(p, "role"), {});
      if (!truthy(group) || !(truthy(get(p, "in_game")) || get(p, "depth") === 1)) continue;
      pool.push({ p, team: slug, t, group, returner: returners.has(get(p, "slug")),
        bonus: season.OUTLOOK_TEAM * awards._rank_bonus(get(ap, slug)) });
    }
  }

  const card = (x, score) => {
    const p = x["p"], t = x["t"];
    return { name: p["name"], position: p["position"], role: get(p, "role"), class: get(p, "class"), team: x["team"],
      team_name: t["name"], conference: t["conference"], games: 0,
      line: [get(season.CLASS_NAMES, get(p, "class") || "", get(p, "class")), get(p, "archetype")].filter((b) => truthy(b)).join(" · "),
      headline: `${season.page_overall(p)} OVR`, score: round(score, 2) };
  };

  const ranked = (kind, team_weight) => {
    const cross = kind === "mvp" || kind === "mvp_team" || kind === "freshman";
    const rows = [];
    for (const x of pool) {
      const p = x["p"];
      if (!_in(x["group"], get(season._OUTLOOK_GROUPS, kind, []))) continue;
      if (kind === "qb_upper" && !_in(get(p, "class"), awards.UPPERCLASS)) continue;
      if (kind === "freshman" && !_in(get(p, "class"), awards.FRESHMAN)) continue;
      if (kind === "c" && get(p, "role") !== "C") continue;
      if (kind === "rs" && !x["returner"]) continue;
      let base = kind === "rs" ? Number(get(p, "return_rating") || 0) : Number(get(p, "ovr") || 0);
      if (kind === "versatile") base = 0.6 * base + 0.4 * Number(get(p, "return_rating") || 0);
      if (cross) base *= 0.7 + 0.3 * get(awards.POSITION_PRIOR, x["group"], 0.5);
      rows.push([base + team_weight * x["bonus"], x]);
    }
    rows.sort((r1, r2) => cmp(-r1[0], -r2[0]));
    return rows;
  };

  const out_awards = [];
  for (const [name, kind, tw, honors] of awards.NATIONAL_AWARDS) {
    const race = ranked(kind, tw).slice(0, season.OUTLOOK_HOPEFULS).map(([s, x]) => card(x, s));
    out_awards.push({ name, kind, honors, winner: null, finalists: [], race });
  }
  const top = ranked("mvp", 1.0).slice(0, season.OUTLOOK_HEISMAN);
  let heisman = null;
  if (top.length) {
    const ballots = 871;
    const possible = 3 * ballots;
    const best = top[0][0];
    const weights = top.map(([s]) => Math.exp((s - best) / 9.0));   // *tune* the divisor: larger spreads the points wider
    const total = sum(weights);
    const rows = [];
    top.forEach(([s, x], i) => {
      const wgt = weights[i];
      const pts = round(0.92 * possible * wgt / total);
      const first = floordiv(pts, 5), second = floordiv(pts, 6);
      const c = card(x, s);
      const r = rec[x["team"]];
      let region = "South";
      for (const [rg, sts] of Object.entries(awards.REGIONS)) {
        if (_in(get(x["t"], "state"), sts)) { region = rg; break; }
      }
      Object.assign(c, { first, second, third: Math.max(0, pts - 3 * first - 2 * second), points: pts,
        region,
        record: `${r["wins"]}-${r["losses"]}`, rank: get(ap, x["team"]) });
      rows.push(c);
    });
    heisman = { candidates: rows, winner: rows[0], finalists: rows.slice(0, 4), ballots, possible,
      share: round(100 * rows[0]["points"] / possible, 1) };
  }
  return { live: true, preseason: true, heisman, awards: out_awards, coach_awards: [], conference: {} };
}


function bowl_projection(state, early = false) {
  // Projected bowl lineup from the current committee ranking: each team's record is
  // carried to the end of the regular season with rating-based win odds, the playoff
  // field is the projected bracket (current conference leaders as champions), and the
  // bowls then pick as they will on selection day. None until the first CFP ranking.
  if (truthy(get(state, "bowls"))) return null;
  let order, pw;
  if (truthy(early)) {
    // the outlook: the AP poll stands in until the committee ranks (`early`; the page tags it a projection)
    const got = season._projection_order(state);
    if (!got) return null;
    [order, , pw] = got;
  } else {
    if (state["current_week"] < Math.min(...season.CFP_WEEKS)) return null;
    const polls_state = get(state, "polls", {});
    const weeks = [];
    for (let w = state["current_week"]; w > 0; w--) {
      if (truthy(get(get(polls_state, String(w), {}), "cfp"))) weeks.push(w);
    }
    if (!weeks.length) return null;
    pw = weeks[0];
    const p = polls_state[String(pw)];
    order = truthy(get(p, "cfp_full")) ? p["cfp_full"] : p["cfp"].map((e) => e["team"]);
  }
  const teams = season.load_teams();
  const rec = season._records(state);
  const ratings = {};
  for (const [slug, t] of Object.entries(teams)) ratings[slug] = t["team_ratings"]["overall"];
  // carry every record through the regular season
  const expected = {};
  for (const slug of Object.keys(teams)) expected[slug] = 0.0;
  for (const g of Object.values(state["games"])) {
    if (truthy(g["played"]) || g["week"] > season.LAST_REGULAR_WEEK) continue;
    const edge = (ratings[g["home"]] - ratings[g["away"]]) / 60 + (truthy(g["neutral"]) ? 0.0 : 0.04);
    const p_home = Math.max(0.08, Math.min(0.92, 0.5 + edge));
    expected[g["home"]] += p_home;
    expected[g["away"]] += 1 - p_home;
  }
  const projected = {};
  for (const [slug, r] of Object.entries(rec)) {
    const add = expected[slug];
    projected[slug] = { ...r, wins: r["wins"] + round(add), losses: r["losses"] + round(season._remaining(state, slug) - add) };
  }
  // projected champions: the current leader of each conference
  const conf_of = {};
  for (const [slug, t] of Object.entries(teams)) conf_of[slug] = t["conference"];
  const leaders = {};
  for (const [slug, t] of Object.entries(teams)) {
    if (truthy(t["fictional"])) continue;
    const r = rec[slug];
    const cg = r["conf_wins"] + r["conf_losses"];
    const key = [cg ? r["conf_wins"] / cg : 0.0, r["wins"] / Math.max(1, r["wins"] + r["losses"]), order.includes(slug) ? -order.indexOf(slug) : -99, ratings[slug]];
    if (leaders[t["conference"]] === undefined || cmp(key, leaders[t["conference"]][0]) > 0) {
      leaders[t["conference"]] = [key, slug];
    }
  }
  const champions = {};
  for (const [conf, [, slug]] of Object.entries(leaders)) champions[conf] = slug;
  const names = {};
  for (const [slug, t] of Object.entries(teams)) names[slug] = t["name"];
  let field;
  try {
    const bracket = polls.build_bracket(order, champions, conf_of, names);
    field = new Set(get(bracket, "seeds", []).map((x) => x["team"]));
  } catch (e) {
    field = new Set(order.slice(0, 12));
  }
  const info = {};
  for (const b of bowls.load_bowls()["bowls"]) info[b["bowl"]] = b;
  const out = [];
  for (const b of bowls.select_bowls(projected, teams, field, order, ratings)) {
    const meta = get(info, b["bowl"], {});
    const b_home = get(b, "home"), b_away = get(b, "away");
    const entry = { ...b, projected: true, played: false, has_box: false, mine: state["team"] === b_home || state["team"] === b_away,
      home_name: truthy(b_home) ? teams[b["home"]]["name"] : null, away_name: truthy(b_away) ? teams[b["away"]]["name"] : null,
      home_record: truthy(b_home) ? season._record_str(projected[b["home"]]) : null,
      away_record: truthy(b_away) ? season._record_str(projected[b["away"]]) : null,
      home_conference: get(conf_of, b_home), away_conference: get(conf_of, b_away),
      games_played: get(meta, "games_played"), first_played: get(meta, "first_played") };
    out.push(entry);
  }
  out.sort((x, y) => cmp([x["week"], x["date"] || "", x["time"] || ""], [y["week"], y["date"] || "", y["time"] || ""]));
  // (the field is a set in Python: teams the ranking does not hold tie at 99 and come out in the set's order there,
  // in the bracket's seed order here)
  return { week: pw, bowls: out, playoff: sorted(field, (s) => (order.includes(s) ? order.indexOf(s) : 99)) };
}


function _remaining(state, slug) {
  let n = 0;
  for (const g of Object.values(state["games"])) {
    if (!truthy(g["played"]) && g["week"] <= season.LAST_REGULAR_WEEK && (slug === g["home"] || slug === g["away"])) n += 1;
  }
  return n;
}


function bowl_view(state) {
  // Every bowl of the season with its matchup, result, tie-ins and history.
  const teams = season.load_teams();
  const info = {};
  for (const b of bowls.load_bowls()["bowls"]) info[b["bowl"]] = b;
  const rec = season._records(state, undefined, true);
  const out = [];
  for (const b of get(state, "bowls", [])) {
    const g = get(state["games"], b["event_id"]);
    const meta = get(info, b["bowl"], {});
    const b_home = get(b, "home"), b_away = get(b, "away");
    out.push({ ...b, home_name: truthy(b_home) ? teams[b["home"]]["name"] : null,
      away_name: truthy(b_away) ? teams[b["away"]]["name"] : null,
      home_conference: truthy(b_home) ? teams[b["home"]]["conference"] : null,
      away_conference: truthy(b_away) ? teams[b["away"]]["conference"] : null,
      home_record: truthy(b_home) ? season._record_str(rec[b["home"]]) : null,
      away_record: truthy(b_away) ? season._record_str(rec[b["away"]]) : null,
      played: truthy(g) && truthy(g["played"]), home_score: truthy(g) ? g["home_score"] : null, away_score: truthy(g) ? g["away_score"] : null,
      overtime: truthy(g) ? (get(g, "overtime") || 0) : 0,
      mine: state["team"] === b_home || state["team"] === b_away, has_box: truthy(g) && season.has_box(state, g),
      games_played: get(meta, "games_played"), first_played: get(meta, "first_played"),
      most_appearances: get(meta, "most_appearances", []).slice(0, 4), recent: get(meta, "recent", []).slice(0, 3),
      wiki_tie_ins: get(meta, "tie_ins", []), previous_tie_ins: get(meta, "previous_tie_ins", []),
      payout: get(meta, "payout") });
  }
  out.sort((x, y) => cmp([x["week"], x["date"] || "", x["time"] || ""], [y["week"], y["date"] || "", y["time"] || ""]));
  return out;
}


// ----- season summary ------------------------------------------------------

function _game_line(g, teams, state = null) {
  return { has_box: truthy(state) ? season.has_box(state, g) : false, event_id: g["event_id"], week: g["week"], title: get(g, "title"),
    site: get(g, "site"), played: g["played"],
    home: g["home"], away: g["away"], home_name: get(g, "home_display") || teams[g["home"]]["name"],
    away_name: get(g, "away_display") || teams[g["away"]]["name"], home_score: g["home_score"], away_score: g["away_score"],
    overtime: get(g, "overtime", 0), winner: truthy(g["played"]) ? season._winner(g) : null,
    home_seed: get(g, "home_seed"), away_seed: get(g, "away_seed"), bowl: get(g, "bowl") };
}


function _player_leaders(boxes, me) {
  // Season totals for your players from the stored box scores, and the leader in each category.
  const totals = new Map();        // (name, position) -> his totals, in the order first seen
  for (const box of boxes) {
    const side = (get(box, "home_slug") || get(box["home"], "slug")) === me ? box["home"] : box["away"];
    for (const p of side["players"]) {
      if (!Object.values(p["stats"]).some((v) => truthy(v))) continue;
      const k0 = JSON.stringify([p["name"], p["position"]]);
      if (!totals.has(k0)) totals.set(k0, { name: p["name"], position: p["position"], games: 0, stats: {} });
      const t = totals.get(k0);
      t["games"] += 1;
      for (const [k, v] of Object.entries(p["stats"])) t["stats"][k] = get(t["stats"], k, 0) + v;
    }
  }
  const players = [...totals.values()];

  const top = (key, ...needs) => {
    const pool = players.filter((p) => needs.every((n) => truthy(get(p["stats"], n))));
    const best = _max_or_none(pool, (p) => get(p["stats"], key, 0));
    return best && get(best["stats"], key, 0) > 0 ? best : null;
  };

  const tackles = (p) => get(p["stats"], "solo_tackles", 0) + get(p["stats"], "assisted_tackles", 0);
  const returns = (p) => get(p["stats"], "kickoff_return_yards", 0) + get(p["stats"], "punt_return_yards", 0);

  const tackler = _max_or_none(players, tackles);
  const returner = _max_or_none(players, returns);
  return {
    passer: top("pass_yards", "pass_attempts"), rusher: top("rush_yards", "carries"), receiver: top("receiving_yards", "receptions"),
    tackler: tackler && truthy(tackles(tackler)) ? tackler : null, sacks: top("sacks"), interceptions: top("interceptions"),
    kicker: top("fg_made", "fg_attempted") || top("pat_made", "pat_attempts"),
    returner: returner && truthy(returns(returner)) ? returner : null,
    games_with_stats: boxes.length,
  };
}


function _national_leaders(state) {
  // The country's leader in each category from the season-long stats of every
  // simulated game (empty when the season only has your own games' box scores).
  if (truthy(get(state, "season_stats_partial")) || !truthy(get(state, "season_stats"))) {
    season._season_stats(state);
    if (truthy(get(state, "season_stats_partial"))) return {};
  }

  const top = (category, key) => {
    const players = season.player_stats_view(state, null, category, 10000)["players"];
    const best = _max_or_none(players, (p) => get(p["stats"], key, 0));
    return best && get(best["stats"], key, 0) > 0 ? best : null;
  };

  const out = { passing: top("passing", "pass_yards"), rushing: top("rushing", "rush_yards"), receiving: top("receiving", "receiving_yards"),
    sacks: top("defense", "sacks"), interceptions: top("defense", "interceptions") };
  const defenders = season.player_stats_view(state, null, "defense", 10000)["players"];
  for (const p of defenders) p["stats"]["tackles"] = get(p["stats"], "solo_tackles", 0) + get(p["stats"], "assisted_tackles", 0);
  out["tackles"] = _max_or_none(defenders, (p) => p["stats"]["tackles"]);
  const kickers = season.player_stats_view(state, null, "kicking", 10000)["players"];
  for (const p of kickers) p["stats"]["points"] = get(p["stats"], "fg_made", 0) * 3 + get(p["stats"], "pat_made", 0);
  out["kicking"] = _max_or_none(kickers, (p) => p["stats"]["points"]);
  const kept = {};
  for (const [k, v] of Object.entries(out)) if (truthy(v)) kept[k] = v;
  return kept;
}


function _surprises(state, teams, final_ap) {
  // Teams whose finish most exceeded (surprise) or fell short of (disappointment) what
  // was expected of them. Expectation is the preseason AP rank, or for unranked teams a
  // slot below the top 25 by roster rating. The finish is the final AP rank, or for
  // unranked teams a slot below the top 25 by record and point differential.
  const records = season._records(state);
  const fbs = Object.entries(teams).filter(([, t]) => !truthy(t["fictional"])).map(([s]) => s);
  const by_rating = sorted(fbs, (s) => -teams[s]["team_ratings"]["overall"]);
  const rating_rank = {};
  by_rating.forEach((s, i) => { rating_rank[s] = i + 1; });
  const pre_ap = {};
  for (const e of get(get(state["polls"], "0", {}), "ap", [])) pre_ap[e["team"]] = e["rank"];
  const fin_ap = {};
  for (const e of final_ap) fin_ap[e["team"]] = e["rank"];
  const unranked = fbs.filter((s) => fin_ap[s] === undefined);
  unranked.sort((s1, s2) => {
    const key = (s) => [-(records[s]["wins"] / Math.max(1, records[s]["wins"] + records[s]["losses"])),
      -(records[s]["points_for"] - records[s]["points_against"])];
    return cmp(key(s1), key(s2));
  });
  const finish_rank = { ...fin_ap };
  unranked.forEach((s, i) => { finish_rank[s] = 26 + i; });
  const pre_unranked = by_rating.filter((s) => pre_ap[s] === undefined);
  const expected_rank = { ...pre_ap };
  pre_unranked.forEach((s, i) => { expected_rank[s] = 26 + i; });
  // each team's AP path through the season: [(week, rank)] for the weeks it was ranked
  const path = {};
  const poll_weeks = sorted(Object.keys(state["polls"]).map((k) => parseInt(k, 10)));
  for (const w of poll_weeks) {
    if (w === 0) continue;
    for (const e of get(state["polls"][String(w)], "ap", [])) {
      if (path[e["team"]] === undefined) path[e["team"]] = [];
      path[e["team"]].push([w, e["rank"]]);
    }
  }
  const last_week = poll_weeks.length ? poll_weeks[poll_weeks.length - 1] : 0;
  const rows = [];
  for (const s of fbs) {
    const r = records[s];
    if (r["wins"] + r["losses"] < 6) continue;
    // log ratio of (rank + 10): climbing from 99th to 19th outweighs climbing from 138th
    // to 50th, and a preseason #1 that finishes #8 is not a bigger letdown than a
    // preseason #10 that finishes 7-6 and unranked
    const swing = Math.log((expected_rank[s] + 10) / (finish_rank[s] + 10));
    const ranked = get(path, s, []);
    const peak = ranked.length ? minBy(ranked, (wr) => [wr[1], wr[0]]) : null;
    rows.push({ team: s, name: teams[s]["name"], conference: teams[s]["conference"], record: `${r["wins"]}-${r["losses"]}`,
      preseason_rank: get(pre_ap, s), rating_rank: rating_rank[s], expected: expected_rank[s],
      final_rank: get(fin_ap, s), finish: finish_rank[s], swing: round(swing, 3),
      peak_rank: peak ? peak[1] : null, peak_week: peak ? peak[0] : null,
      first_ranked_week: ranked.length ? ranked[0][0] : null, last_ranked_week: ranked.length ? ranked[ranked.length - 1][0] : null,
      last_week });
  }
  rows.sort((x, y) => cmp(-x["swing"], -y["swing"]));
  return [rows.slice(0, 3), rows.slice(-3).reverse()];
}


function season_review(state) {
  // The season's big results (title game, playoff rounds, conference champions, final
  // polls) and your team's season in review (record, finish, best win, worst loss, streaks,
  // postseason, and your statistical leaders from the box scores).
  const teams = season.load_teams();
  const me = state["team"];
  const games = state["games"];
  const poll_week = Object.keys(state["polls"]).length ? Math.max(...Object.keys(state["polls"]).map((k) => parseInt(k, 10))) : 0;
  const last_poll = get(state["polls"], String(poll_week), {});
  const ap = get(last_poll, "ap", []);
  const cfp = get(last_poll, "cfp", []);
  const my_ap_e = ap.find((e) => e["team"] === me), my_cfp_e = cfp.find((e) => e["team"] === me);
  const my_ap = my_ap_e === undefined ? null : my_ap_e["rank"];
  const my_cfp = my_cfp_e === undefined ? null : my_cfp_e["rank"];

  const rounds = [];
  for (const [week, label] of sorted(_int_items(season.PLAYOFF_WEEKS))) {
    const gs = sorted(Object.values(games).filter((g) => g["kind"] === "playoff" && g["week"] === week), (g) => g["event_id"]);
    if (gs.length) rounds.push({ round: label, week, games: gs.map((g) => season._game_line(g, teams, state)) });
  }
  const final = get(games, "cfp-final");
  let title_game = truthy(final) ? season._game_line(final, teams, state) : null;
  const ccgs = {};
  for (const g of Object.values(games)) if (g["kind"] === "ccg") ccgs[g["event_id"]] = g;
  const champions = [];
  for (const [conf, slug] of sorted(Object.entries(state["champions"]))) {
    const g = get(ccgs, season._ccg_event_id(conf));
    champions.push({ conference: conf, team: slug, name: teams[slug]["name"], game: truthy(g) ? season._game_line(g, teams, state) : null });
  }

  const all_rec = season._records(state, undefined, true);
  const rec = all_rec[me];
  const row_ = get(season.standings(state), state["conference"], []).find((r) => r["slug"] === me);
  const row = row_ === undefined ? null : row_;
  const my_games = sorted(Object.values(games).filter((g) => (me === g["home"] || me === g["away"]) && truthy(g["played"])),
    (g) => [g["week"], g["date"] || ""]);

  const ap_before = (week) => {
    const out = {};
    for (const e of get(get(state["polls"], String(week - 1), {}), "ap", [])) out[e["team"]] = e["rank"];
    return out;
  };

  const lines = [], wins = [], losses = [];
  let best_streak = 0, cur = 0;
  for (const g of my_games) {
    const home = g["home"] === me;
    const opp = home ? g["away"] : g["home"];
    const [pf, pa] = season._scores_for(g, home);
    const won = pf > pa;
    const orank = get(ap_before(g["week"]), opp);
    const orec = teams[opp] !== undefined ? all_rec[opp] : null;
    const line = { event_id: g["event_id"], week: g["week"], kind: g["kind"], title: get(g, "title"), opponent: opp,
      opponent_name: season.team_display(opp, teams), opponent_rank: orank, opponent_record: truthy(orec) && !truthy(get(teams[opp], "fictional")) ? season._record_str(orec) : null,
      venue: season._venue(g, home), won, points_for: pf, points_against: pa,
      margin: pf - pa, overtime: get(g, "overtime", 0), has_box: season.has_box(state, g),
      conference_game: truthy(get(g, "conference_game")) };
    lines.push(line);
    (won ? wins : losses).push(line);
    cur = won ? cur + 1 : 0;
    best_streak = Math.max(best_streak, cur);
  }

  // ranked opponents first, then by their record
  const opp_quality = (line) => [truthy(line["opponent_rank"]) ? 0 : 1, line["opponent_rank"] || 99, -all_rec[line["opponent"]]["wins"]];

  const best_win = wins.length ? minBy(wins, opp_quality) : null;
  const worst_loss = losses.length ? maxBy(losses, opp_quality) : null;
  const biggest_win = wins.length ? maxBy(wins, (l) => l["margin"]) : null;
  const closest_loss = losses.length ? minBy(losses, (l) => -l["margin"]) : null;
  const n = my_games.length || 1;
  const postseason = lines.filter((l) => l["kind"] === "ccg" || l["kind"] === "bowl" || l["kind"] === "playoff");
  let finish;
  if (get(state, "champion") === me) {
    finish = "National champion";
  } else if (lines.some((l) => l["kind"] === "playoff")) {
    const mine_ = lines.filter((l) => l["kind"] === "playoff");
    const last = mine_[mine_.length - 1];
    if (last["won"] && !truthy(state["done"])) {         // still alive: it won its last playoff game (it read "Lost in the first round")
      finish = `Alive in the playoff: won in the ${_int_get(season.PLAYOFF_WEEKS, last["week"], "playoff").toLowerCase()}`;
    } else {
      finish = last["event_id"] === "cfp-final" ? "Lost the national championship game" : `Lost in the ${_int_get(season.PLAYOFF_WEEKS, last["week"], "playoff").toLowerCase()}`;
    }
  } else if (lines.some((l) => l["kind"] === "bowl")) {
    const mine_ = lines.filter((l) => l["kind"] === "bowl");
    const last = mine_[mine_.length - 1];
    finish = `${last["won"] ? "Won" : "Lost"} the ${_str(last["title"])}`;
  } else if (truthy(state["done"])) {
    finish = "No bowl";
  } else {
    finish = null;
  }
  const boxes = Object.values(state["my_boxes"]);
  const [surprises, disappointments] = season._surprises(state, teams, ap);
  if (title_game) {
    title_game = { ...title_game, home_record: season._record_str(all_rec[title_game["home"]]), away_record: season._record_str(all_rec[title_game["away"]]) };
  }
  const non_conf = lines.filter((l) => l["kind"] === "regular" && !l["conference_game"]);
  const regular_wins = lines.filter((l) => l["kind"] === "regular" && l["won"]).length;
  return {
    done: state["done"], current_week: state["current_week"], year: season.season_year(state),
    grade: truthy(state["done"]) ? modules.grade.season_grade(state) : null,
    national_leaders: season._national_leaders(state), surprises, disappointments,
    champion: get(state, "champion"), champion_name: truthy(get(state, "champion")) ? teams[state["champion"]]["name"] : null,
    title_game, rounds, champions,
    final_ap: ap.slice(0, 10), final_cfp: cfp.slice(0, 12), poll_week,
    mine: {
      team: me, name: state["team_name"], conference: state["conference"], wins: rec["wins"], losses: rec["losses"],
      conf_wins: rec["conf_wins"], conf_losses: rec["conf_losses"], conf_rank: row ? row["conf_rank"] : null,
      division: row ? row["division"] : null, conf_champion: get(state["champions"], state["conference"]) === me,
      final_ap: my_ap, final_cfp: my_cfp, finish,
      points_per_game: round(sum(lines.map((l) => l["points_for"])) / n, 1), allowed_per_game: round(sum(lines.map((l) => l["points_against"])) / n, 1),
      best_win, worst_loss, biggest_win, closest_loss,
      longest_streak: best_streak, postseason, leaders: season._player_leaders(boxes, me),
      non_conf_wins: non_conf.filter((l) => l["won"]).length, non_conf_losses: non_conf.filter((l) => !l["won"]).length,
      wins_short: finish === "No bowl" ? Math.max(0, season.BOWL_WINS - regular_wins) : 0,
      team_stats: season._team_stat_ranks(state, me),
    },
  };
}


season.BOWL_WINS = 6;     // the wins a bowl trip takes


function _team_stat_ranks(state, me) {
  // Your total offense, total defense and turnover margin with their national ranks (yards a
  // game and takeaways less giveaways, among every FBS team that has played a simulated game),
  // or None when the season kept no league-wide stats.
  if (!truthy(get(state, "season_stats"))) return null;
  const rows = season.team_stats_view(state)["teams"];
  const mine_ = rows.find((r) => r["team"] === me);
  const mine = mine_ === undefined ? null : mine_;
  if (!truthy(mine)) return null;

  const rank = (key, value, best_high = true) => rows.filter((r) => (best_high ? r[key] > value : r[key] < value)).length + 1;

  const margin = {};
  for (const r of rows) margin[r["team"]] = r["takeaways"] - r["turnovers"];
  return { total_offense: { value: round(mine["ypg"], 1), rank: rank("ypg", mine["ypg"]), of: rows.length },
    total_defense: { value: round(mine["opp_ypg"], 1), rank: rank("opp_ypg", mine["opp_ypg"], false), of: rows.length },
    turnover_margin: { value: margin[me], rank: Object.values(margin).filter((v) => v > margin[me]).length + 1, of: rows.length } };
}


Object.assign(season, {
  _preview_team, _preview_sim, _preview_prediction, team_ratings_now, game_ratings, team_overall, page_ratings, _unit_overalls,
  game_preview, team_schedule_view, _coach_line, _job, summary, _projection_order, _conference_leaders,
  bracket_projection, awards_outlook, bowl_projection, _remaining, bowl_view, _game_line, _player_leaders, _national_leaders,
  _surprises, season_review, _team_stat_ranks,
});
