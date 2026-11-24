// Recruiting, part 2: a school's needs by roster group and by
// your pages' positions, the Auto-recruit recommendations, a school's pull on a prospect and his interest in it,
// the stages, this season's standing, your hours and scouting points, the NIL budget, the portal's pool and spots,
// and what one action is worth to a prospect.
//
// Every name of recruiting is reached through the `recruiting` namespace, whichever part defines it
// (engine_js/PORTING.md, "Big Files in Parts").
//
// Notes:
//  - The caches with a compound key (`_PULLS`, `_STATIC`, `_FORCED`) are Maps keyed by the key's parts as JSON text;
//    the caches that hold one (key, value) pair (`_GROUP_COUNTS`, `_SPOT_NEEDS`, `_WINNING`) are a two-item array
//    whose key is that same text (null before the first answer).
//  - `_returning`, `_taste` and `_open_spots` keep their answers in a Map behind the function, with `cache_clear`;
//    `_taste` drops its oldest answer past 20000 (no answer changes).
//  - `forced_strength` is a class with `__enter__` and `__exit__`: call them around the test.
//  - `top_group` sorts a Set, walked in the order built (his list's schools, then the offers', then the pending
//    ones'). That order decides only an exact tie in interest at the group's edge.
//  - `covered_states` returns a Set.
import { Random, round, int, floordiv, sum, cmp, sorted, maxBy, get, truthy, range } from "../../engine_js/pyrt.js";
import { modules } from "../../engine_js/modules.js";
import { programs } from "../programs.js";
import { shown } from "../../teamdata_js/shown.js";
import { recruiting } from "../recruiting_ns.js";

// ----- small helpers (local to this part) --------------------------------------------------------------------

const has = (d, k) => Object.prototype.hasOwnProperty.call(d, k);

/** `x in coll` for a set, a tuple or list, or a dict (its keys). */
function _in(x, coll) {
  if (coll instanceof Set || coll instanceof Map) return coll.has(x);
  if (Array.isArray(coll)) return coll.includes(x);
  return x !== null && x !== undefined && has(coll, x);
}

/** A tuple used as a cache key, as text. */
const _key = (...parts) => JSON.stringify(parts);

/** str(v) inside an f-string, for what a save holds: "None", "True" and "False", as the seeds and keys have always had them. */
const pystr = (v) => (v === null || v === undefined ? "None" : v === true ? "True" : v === false ? "False" : String(v));

/** dict.setdefault(k, v). */
function setdefault(d, k, v) {
  if (d[k] === undefined) d[k] = v;
  return d[k];
}

/** dict.clear() of a cache another part keeps, a Map or a plain object. */
function _clear(d) {
  if (d instanceof Map || d instanceof Set) d.clear();
  else for (const k of Object.keys(d)) delete d[k];
}

/** A function's answers kept by its arguments (text and numbers), with a cache_clear. */
function cached(fn, maxsize = null) {
  const kept = new Map();
  const f = (...args) => {
    const at = _key(...args);
    if (!kept.has(at)) {
      if (maxsize !== null && kept.size >= maxsize) kept.delete(kept.keys().next().value);
      kept.set(at, fn(...args));
    }
    return kept.get(at);
  };
  f.cache_clear = () => kept.clear();
  return f;
}

/** t["offense"] + t["defense"]. */
const _players = (t) => [...t["offense"], ...t["defense"]];

/** {g: 0 for g in offseason.TARGET}. */
function _zeros(value = 0) {
  const out = {};
  for (const g of Object.keys(modules.offseason.TARGET)) out[g] = value;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------

function _group_of(p) {
  // A prospect's roster group (QB, RB, ... K, P) from his EA position.
  let g = get(p, "group");
  if (g === null) {
    if (!truthy(recruiting._GROUP)) {
      const offseason = modules.offseason;
      Object.assign(recruiting._GROUP, offseason.GROUP);
    }
    g = p["group"] = get(recruiting._GROUP, p["ea_position"], "S");
  }
  return g;
}


recruiting._GROUP_COUNTS = [null, {}];   // (career, class and events so far; every school's commits by group)


function commits_by_group(state, slug) {
  // The school's commits and signees this class, by roster group (every school's are counted
  // in one pass and kept until the next commitment, signing or flip (`_commit` and `_sign` bump
  // `commits_v`; a commitment set any other way needs reset_caches()).
  const rc = state["recruiting"];
  const key = _key(state["id"], recruiting._ck(rc), get(rc, "commits_v", 0));
  if (recruiting._GROUP_COUNTS[0] !== key) {
    const counts = {};
    for (const [pid, st] of Object.entries(rc["status"])) {
      const school = st["signed"] || st["committed"];
      if (school && school !== "FCS") {
        setdefault(counts, school, _zeros())[recruiting._group_of(rc["prospects"][pid])] += 1;
      }
    }
    recruiting._GROUP_COUNTS = [key, counts];
  }
  return { ...(get(recruiting._GROUP_COUNTS[1], slug) || _zeros()) };
}


function needs(state, slug) {
  // What the school still needs at each group this class: a healthy 85-man make-up
  // (offseason.TARGET) minus the players coming back (seniors gone, the draft-eligible
  // underclassmen projecting a top-100 pick part-counted, the usual attrition off the rest)
  // minus its commits and signees.
  const season = modules.season;
  const offseason = modules.offseason;
  if (recruiting.is_portal(state)) {                       // next year's roster is known: signees in, leavers gone
    const back = _zeros(0.0);
    for (const c of state["league"]["teams"][slug]["roster"]) {
      back[get(offseason.GROUP, c["pos"], "S")] += 1;
    }
    const commits = recruiting.commits_by_group(state, slug);
    const out = {};
    for (const g of Object.keys(offseason.TARGET)) out[g] = int(round(offseason.TARGET[g] - back[g] - commits[g]));
    return out;
  }
  const t = season.load_teams()[slug];
  const cut = recruiting._early_leaver_cut(state);
  const back = _zeros(0.0);
  for (const p of _players(t)) {
    const g = get(recruiting.ENGINE_GROUP, p["position"], p["position"]);
    if (!has(back, g) || _in(get(p, "class"), recruiting.LEAVING)) continue;
    const early = _in(get(p, "class"), offseason.UNDERCLASS_ELIGIBLE) && (get(p, "ovr") || 0) >= cut;
    back[g] += (early ? 1 - recruiting.EARLY_LEAVER_RATE : 1) * (1 - recruiting.ATTRITION);
  }
  const commits = recruiting.commits_by_group(state, slug);
  const out = {};
  for (const g of Object.keys(offseason.TARGET)) out[g] = int(round(offseason.TARGET[g] - back[g] - commits[g]));
  if (recruiting.QB_EVERY_CLASS) {
    out["QB"] = Math.max(out["QB"], 1 - commits["QB"]);
  }
  return out;
}


function needs_detail(state, slug) {
  // Needs for the page, per roster group: the healthy make-up (target), who comes back, the
  // school's commits (firm: FIRM_VISIT and up; soft below), its board (yours to get, and the ones you got) and open offers there, and
  // what is left (`need`, as needs()).
  const offseason = modules.offseason;
  const rc = state["recruiting"];
  const need = recruiting.needs(state, slug);
  const commits = recruiting.commits_by_group(state, slug);
  const offers = recruiting.offers_by_group(state, slug);
  const firm = _zeros();
  const board = _zeros();
  for (const [pid, st] of Object.entries(rc["status"])) {
    if ((st["signed"] || st["committed"]) === slug && truthy(st["signed"] || get(st, "hard"))) {
      firm[recruiting._group_of(rc["prospects"][pid])] += 1;
    }
  }
  for (const pid of slug === state["team"] ? rc["board"] : []) {
    const st = rc["status"][pid];
    const whose = st["signed"] || st["committed"];
    if (whose === null || whose === slug) {       // everyone on your board still yours to get, and the ones you got
      board[recruiting._group_of(rc["prospects"][pid])] += 1;
    }
  }
  // in the portal your high school class has signed and sits on next year's roster (so in `back`): `signees` names
  // them apart, so the page never reads "0 committed" with a class signed
  const signees = _zeros();
  const last = recruiting.is_portal(state) ? get(state, "recruiting_last") : null;
  for (const [pid, st] of Object.entries(get(last || {}, "status") || {})) {
    const q = get(get(last, "prospects") || {}, pid);
    if (truthy(q) && get(st, "signed") === slug) {
      signees[recruiting._group_of(q)] = get(signees, recruiting._group_of(q), 0) + 1;
    }
  }
  const out = {};
  for (const [g, target] of Object.entries(offseason.TARGET)) {
    const c = commits[g];
    const back = Math.max(0, target - need[g] - c);
    out[g] = { "target": target, "back": back, "commits": c, "firm": Math.min(c, firm[g]), "soft": c - Math.min(c, firm[g]),
               "board": board[g], "offers": offers[g], "need": need[g],
               ...(last !== null ? { "portal": true, "signees": Math.min(back, get(signees, g, 0)) } : {}) };
  }
  return out;
}


// ----- the recruiting pages' positions: four groups shown as the positions in them (the player's ask) -----------------
// The schools still recruit by roster group (needs, a group's cap, "no room"): this is how your pages count and filter.
recruiting.SPOTS = { "OL": [["OT", 2], ["OG", 2], ["C", 1]], "DL": [["EDGE", 2], ["DT", 2]],
                     "LB": [["MIKE", 1], ["WILL", 2]], "S": [["FS", 1], ["SS", 1]] };   // *tune* a group's positions, each with its starters (the group's spots are shared out by them)
recruiting.SPOT_OF = { "LT": "OT", "RT": "OT", "LG": "OG", "RG": "OG", "C": "C", "LEDG": "EDGE", "REDG": "EDGE", "DT": "DT",
                       "MIKE": "MIKE", "MLB": "MIKE", "WILL": "WILL", "SAM": "WILL", "ROLB": "WILL", "LOLB": "WILL", "FS": "FS", "SS": "SS" };
recruiting.SPOT_ORDER = ["QB", "RB", "WR", "TE", "OT", "OG", "C", "EDGE", "DT", "MIKE", "WILL", "CB", "FS", "SS", "K", "P"];
recruiting.SPOT_GROUP = {};
for (const [g, parts] of Object.entries(recruiting.SPOTS)) for (const [name] of parts) recruiting.SPOT_GROUP[name] = g;


function spot_of(p) {
  // A prospect's position as the recruiting pages count him: OT, OG or C for a lineman, EDGE or DT, MIKE or WILL (a
  // SAM is a WILL: the depth chart has two linebacker roles), FS or SS; his roster group anywhere else.
  const g = recruiting._group_of(p);
  if (!has(recruiting.SPOTS, g)) return g;
  const s = get(recruiting.SPOT_OF, get(p, "ea_position"));
  return _in(s, recruiting.SPOT_GROUP) && recruiting.SPOT_GROUP[recruiting.SPOT_OF[p["ea_position"]]] === g
    ? s : recruiting.SPOTS[g][0][0];
}


function spot_of_player(role, group) {
  // A roster player's position as your pages count him, from his depth-chart role (LT, MIKE, FS) and his roster
  // group: the same positions a recruit is counted at (spot_of); a lineman with no role is counted at his group's first.
  if (!_in(group, recruiting.SPOTS)) return group;
  const s = get(recruiting.SPOT_OF, role || "");
  return _in(s, recruiting.SPOT_GROUP) && recruiting.SPOT_GROUP[s] === group ? s : recruiting.SPOTS[group][0][0];
}


recruiting.SPOT_STARTERS = { "QB": 1, "RB": 1, "WR": 3, "TE": 1, "CB": 2, "K": 1, "P": 1 };     // *tune* how many start at each of your pages' positions
for (const parts of Object.values(recruiting.SPOTS)) for (const [name, n] of parts) recruiting.SPOT_STARTERS[name] = n;


function need_levels(state, slug) {
  // How pressing each position's need is, for the board's Triage colors: 0 covered (the class needs no one there),
  // 1 depth (spots to fill, every starter back), 2 a starter leaves, 3 every starter leaves. A position's starters are
  // its best players now (SPOT_STARTERS of them, by overall); one leaves when he is a senior (LEAVING). Each carries
  // `leaving` and `starters` for the chip's tip. In the portal next year's roster is the roster, so no one leaves.
  const season = modules.season;
  const need = {};
  for (const [k, d] of Object.entries(recruiting.needs_by_spot(state, slug))) need[k] = d["need"];
  const at = {};
  if (!recruiting.is_portal(state)) {
    const t = season.load_teams()[slug];
    for (const p of _players(t)) {
      const g = get(recruiting.ENGINE_GROUP, p["position"], p["position"]);
      setdefault(at, recruiting.spot_of_player(get(p, "role"), g) || g, []).push(p);
    }
  }
  const out = {};
  for (const [k, n] of Object.entries(need)) {
    const first = sorted(get(at, k, []), (p) => -(get(p, "ovr") || 0)).slice(0, get(recruiting.SPOT_STARTERS, k, 1));
    let leaving = 0;
    for (const p of first) if (_in(get(p, "class"), recruiting.LEAVING)) leaving += 1;
    const level = n <= 0 ? 0 : !leaving ? 1 : leaving >= first.length ? 3 : 2;
    out[k] = { "level": level, "leaving": leaving, "starters": first.length };
  }
  return out;
}


function spot_matches(p, key) {
  // A page's position filter: a position (OT, MIKE) or a whole group (OL, LB), whichever it is given.
  return !key || key === recruiting.spot_of(p) || key === recruiting._group_of(p);
}


function _share(total, weights) {
  // `total` shared out by `weights` in whole numbers that add up to it (largest remainders).
  const w = sum(weights) || 1.0;
  const raw = weights.map((x) => total * x / w);
  const out = raw.map((x) => int(x));
  for (const i of sorted(range(raw.length), (i) => raw[i] - out[i], true).slice(0, total - sum(out))) {
    out[i] += 1;
  }
  return out;
}


recruiting._SPOT_NEEDS = [null, {}];


function _copy_rows(rows) {
  const out = {};
  for (const [k, v] of Object.entries(rows)) out[k] = { ...v };
  return out;
}


function needs_by_spot(state, slug) {
  // needs_detail for your pages, with OL, DL, LB and S as their positions (SPOTS): a group's spots (`target`) are
  // shared out by its starters, the players coming back (`back`) by where the returning roster plays, and your commits,
  // board and offers are counted where each recruit plays; `need` is what is left of each position's spots. In
  // SPOT_ORDER. A view only: the game's own needs stay by group (needs).
  const rc = state["recruiting"];
  const key = _key(get(state, "id"), slug, recruiting._ck(rc), get(rc, "commits_v", 0), (get(rc, "board") || []).length,
                   get(rc["offers"], slug, []).length, get(state, "current_week"), get(rc, "week"));
  if (recruiting._SPOT_NEEDS[0] === key) {
    return _copy_rows(recruiting._SPOT_NEEDS[1]);
  }
  const by_group = recruiting.needs_detail(state, slug);
  // the returning roster by position, for sharing out `back`
  const here = {};
  let roster;
  if (recruiting.is_portal(state)) {
    roster = state["league"]["teams"][slug]["roster"].map((c) => c["pos"]);
  } else {
    const season = modules.season;
    const t = season.load_teams()[slug];
    roster = _players(t).filter((p) => !_in(get(p, "class"), recruiting.LEAVING)).map((p) => get(p, "role") || p["position"]);
  }
  for (const pos of roster) {
    if (_in(get(recruiting.SPOT_OF, pos), recruiting.SPOT_GROUP)) {
      here[recruiting.SPOT_OF[pos]] = get(here, recruiting.SPOT_OF[pos], 0) + 1;
    }
  }
  const count = { "commits": {}, "firm": {}, "board": {}, "offers": {} };
  const bump = (what, pid) => {
    const s = recruiting.spot_of(rc["prospects"][pid]);
    count[what][s] = get(count[what], recruiting.spot_of(rc["prospects"][pid]), 0) + 1;
  };
  for (const [pid, st] of Object.entries(rc["status"])) {
    if ((st["signed"] || st["committed"]) === slug) {
      bump("commits", pid);
      if (truthy(st["signed"] || get(st, "hard"))) {
        bump("firm", pid);
      }
    }
  }
  for (const pid of slug === state["team"] ? rc["board"] : []) {
    const st = rc["status"][pid];
    const whose = st["signed"] || st["committed"];
    if (whose === null || whose === slug) {
      bump("board", pid);
    }
  }
  for (const pid of get(rc["offers"], slug, [])) {
    const st = rc["status"][pid];
    if (!st["signed"] && st["committed"] === null) {
      bump("offers", pid);
    }
  }
  let out = {};
  for (const [g, d] of Object.entries(by_group)) {
    if (!has(recruiting.SPOTS, g)) {
      out[g] = { ...d, "group": g };
      continue;
    }
    const names = recruiting.SPOTS[g].map(([n]) => n);
    const weights = recruiting.SPOTS[g].map(([, w]) => Number(w));
    const targets = recruiting._share(int(d["target"]), weights);
    const backs = recruiting._share(int(d["back"]), names.some((n) => truthy(get(here, n))) ? names.map((n) => get(here, n, 0)) : weights);
    const signees = recruiting._share(int(get(d, "signees") || 0), weights);
    for (let i = 0; i < names.length; i++) {
      const n = names[i], target = targets[i], back = backs[i], sg = signees[i];
      const c = get(count["commits"], n, 0);
      const firm = Math.min(c, get(count["firm"], n, 0));
      out[n] = { "target": target, "back": back, "commits": c, "firm": firm, "soft": c - firm, "board": get(count["board"], n, 0),
                 "offers": get(count["offers"], n, 0), "need": target - back - c, "group": g,
                 ...(truthy(get(d, "portal")) ? { "portal": true, "signees": Math.min(back, sg) } : {}) };
    }
  }
  const ordered = {};
  for (const k of recruiting.SPOT_ORDER) if (has(out, k)) ordered[k] = out[k];
  out = ordered;
  recruiting._SPOT_NEEDS = [key, _copy_rows(out)];
  return out;
}


recruiting.RECOMMENDED_WHY = { "home": "from a state you sign from", "near": "close to campus", "national": "a national target for a program like yours",
                               "stars": "the star level you usually sign", "need": "a position you need", "position": "a position you sign every class" };


function recommended(state, slug) {
  // The prospects the Auto-recruit rules would put on your board this week (the same draw the AI
  // schools make: fit by state, star level and position, need), not already on it, best fit first,
  // each with why he fits. The same list all week.
  const rc = state["recruiting"];
  const rng = new Random(`recs-${pystr(state["id"])}-${pystr(get(rc, "year"))}-${pystr(get(state, "current_week"))}`);
  const board = slug === state["team"] ? new Set(rc["board"]) : new Set();
  const seen = slug === state["team"] ? new Set(recruiting.prospect_list(state)) : new Set(Object.keys(rc["prospects"]));     // only prospects you can see
  const picks = recruiting._build_board(state, slug, rng, false).filter((pid) => !board.has(pid) && seen.has(pid)
    && recruiting.blocked(state, slug, pid) === null);        // never one who will not consider the school, or has cut it
  const fits = recruiting._fits(state, slug);
  const need = recruiting.needs(state, slug);
  const tm = recruiting._team_model(slug);
  const shares = {};
  for (const [k, v] of get(tm, "top_states") || []) shares[k] = v;
  const per_class = get(tm, "positions_per_class") || {};
  const star_share = get(tm, "star_share") || {};
  const out = [];
  for (const pid of picks) {
    const p = rc["prospects"][pid];
    const g = recruiting._group_of(p);
    const why = [];
    if (has(shares, p["hometown"]["state"])) {
      why.push(recruiting.RECOMMENDED_WHY["home"]);
    } else if (fits[pid] > 0 && recruiting.tier_of(p) < 4) {
      why.push(recruiting.RECOMMENDED_WHY["near"]);
    }
    if (recruiting.tier_of(p) >= 4 && (get(tm, "blue_chip_share") || 0) >= 0.25) {
      why.push(recruiting.RECOMMENDED_WHY["national"]);
    }
    if (get(star_share, get(recruiting.STAR_KEY, recruiting.tier_of(p), "2*"), 0.0) / recruiting._national_share(recruiting.tier_of(p)) >= 1) {
      why.push(recruiting.RECOMMENDED_WHY["stars"]);
    }
    if (get(need, g, 0) >= 1) {
      why.push(`${recruiting.RECOMMENDED_WHY["need"]}: ${g} ${need[g]} left`);
    }
    if (get(per_class, get(recruiting.POS_247, p["position"], p["position"]), 0) >= 1.5) {
      why.push(recruiting.RECOMMENDED_WHY["position"]);
    }
    const top = why.slice(0, 3);
    out.push({ "pid": pid, "fit": round(fits[pid] * recruiting.need_factor(get(need, g, 0)), 4), "why": top.length ? top : ["fits your usual class"] });
  }
  const k = (r) => [-r["fit"], -rc["prospects"][r["pid"]]["composite"], r["pid"]];
  out.sort((a, b) => cmp(k(a), k(b)));
  return out;
}


function need_factor(need) {
  for (const [at, factor] of recruiting.NEED_FACTOR) {
    if (need >= at) {
      return factor;
    }
  }
  return recruiting.NEED_FLOOR;
}


function offers_by_group(state, slug) {
  // The school's open offers by group: to prospects not committed elsewhere (an offer chasing a
  // flip does not hold a spot).
  const rc = state["recruiting"];
  const out = _zeros();
  for (const pid of get(rc["offers"], slug, [])) {
    const st = rc["status"][pid];
    if (!st["signed"] && st["committed"] === null) {
      out[recruiting._group_of(rc["prospects"][pid])] += 1;
    }
  }
  return out;
}


function group_cap(need, group) {
  // How many a school takes at a group this class: its need plus one (quarterbacks and
  // specialists: one unless the need is higher).
  if (group === "QB") return Math.min(recruiting.QB_CLASS_MAX, Math.max(1, need[group]));
  return _in(group, recruiting.ONE_A_CLASS) ? Math.max(1, need[group]) : need[group] + 1;
}


function group_full(state, slug, group, need = null, commits = null, offers = null) {
  // Whether a school stops offering at a group: its commits there reach the cap, or its commits
  // and open offers reach OFFER_ROOM times the cap (it offers more than it takes) plus one.
  need = need != null ? need : recruiting.needs(state, slug);
  commits = commits != null ? commits : recruiting.commits_by_group(state, slug);
  offers = offers != null ? offers : recruiting.offers_by_group(state, slug);
  const cap = recruiting.group_cap(need, group);
  return commits[group] >= cap || commits[group] + offers[group] >= Math.ceil(recruiting.OFFER_ROOM * cap) + 1;
}


// (@lru_cache(maxsize=None))
const _returning = cached((slug, group) => {
  const season = modules.season;
  const t = season.load_teams()[slug];
  return _players(t)
    .filter((p) => (["MLB", "ROLB", "LOLB"].includes(p["position"]) ? "LB" : p["position"]) === group
      && !_in(get(p, "class"), recruiting.LEAVING))
    .map((p) => get(p, "ovr") || 0);
});


function _coach_edge(state, slug) {
  if (slug === get(state, "team") && truthy(get(get(state, "coach") || {}, "ratings"))) {
    return (get(state["coach"]["ratings"], "recruiting", 50) - 50) / 160;      // your created coach
  }
  const season = modules.season;
  const hc = get(get(get(season.load_teams(), slug) || {}, "coaches") || {}, "head_coach") || {};
  if ((get(hc, "since") || 0) > 2026) {                 // a career's new hire: his rating is all there is to go on
    return (get(get(hc, "ratings") || {}, "recruiting", 50) - 50) / 160;
  }
  const cur = get(recruiting.model()["coaches"]["current"], slug) || {};
  return get(cur, "edge") || 0.0;
}


function pull(state, slug, pid, winning = true) {
  // The school's pull on the prospect by topic, each 0-1 (`winning=False`: all but this
  // season's standing, the part that holds all season).
  const persona = modules.persona;
  const p = state["recruiting"]["prospects"][pid];
  const loc = get(recruiting._team_model(slug), "location");
  const miles = truthy(loc) ? recruiting._miles([...persona.home_of(state, p)], [...loc]) : 1500.0;      // a Family Move takes his home along
  const group = recruiting._group(p["ea_position"]);
  const starters = get(recruiting.STARTERS, group, 2);
  const pr = programs.get(state, slug);
  const z = programs.z_of(pr["prestige"] * 0.6 + pr["rating"] * 0.4);       // the brand, with the program's standing today
  const zn = programs.z_of(pr["nil"]);
  const out = {};
  out["proximity"] = Math.max(recruiting.PROXIMITY_FLOOR, Math.exp(-miles / recruiting.PROXIMITY_MILES));
  out["playing_time"] = Math.max(0.1, 1 - recruiting._ahead(state, slug, group, p["ovr"]) / (2 * starters + 1));
  out["prestige"] = recruiting._logistic(1.2 * z);
  if (winning) {                                                 // this season's topics: they move every week (weekly)
    const wk = recruiting.weekly(state);
    for (const t of recruiting.WEEKLY) out[t] = Math.min(1.0, get(wk[t], slug, 0.5));
  }
  out["nil"] = recruiting._logistic(1.4 * zn);
  out["coach"] = Math.min(1.0, Math.max(0.0, 0.5 + 1.5 * recruiting._coach_edge(state, slug)));
  out["pro"] = recruiting._logistic(recruiting.PRO_PULL_K * (programs.pro_group_grade(pr, group) - 50) / 25);
  Object.assign(out, recruiting._grade_pulls(state, slug, p));
  return out;
}


function place_taste(p) {
  // Where he'd like to live: a setting and a climate, from his own seeded stream (stored nowhere, so an old save has it
  // too). The climate is the one he grew up in HOME_CLIMATE of the time.
  return { ...recruiting._taste(p["id"], get(get(p, "hometown") || {}, "state")) };
}


// (@functools.lru_cache(maxsize=20000))
const _taste = cached((pid, home) => {
  const p = { "id": pid, "hometown": { "state": home } };
  const rng = new Random(`place-${pystr(p["id"])}`);
  const setting = rng.choices(Object.keys(recruiting.PLACE_SETTINGS), { weights: Object.values(recruiting.PLACE_SETTINGS) })[0];
  home = get(get(p, "hometown") || {}, "state");
  const grew = _in(home, recruiting.WARM_STATES) ? "Warm" : _in(home, recruiting.COLD_STATES) ? "Cold" : "Mild";
  const climate = rng.random() < recruiting.HOME_CLIMATE ? grew : rng.choice(["Warm", "Mild", "Cold"]);
  return { "setting": setting, "climate": climate };
}, 20000);


function _grade_pulls(state, slug, p) {
  // The school grades as pulls (programs.grades / 100); Location also reads its tags against his taste. A program with
  // no grades reads NEUTRAL_PULL (Academics: the old ACADEMIC list).
  const g = programs.grades_now(state, slug);                 // Phase 3: the live grades
  if (g === null) {
    const out = { "academics": _in(slug, recruiting.ACADEMIC) ? 0.9 : 0.5 };
    for (const t of ["facilities", "location", "stability", "game_day", "exposure"]) out[t] = recruiting.NEUTRAL_PULL;
    const people = programs.people_base(state, slug);        // Player Development and Culture start from its head coach
    for (const t of ["development", "culture"]) out[t] = people[t] / 100;
    return out;
  }
  const out = {};
  for (const t of ["academics", "facilities", "location", "stability", "game_day", "exposure", "development", "culture"]) out[t] = get(g, t, 50.0) / 100;
  const tags = programs.tags(slug) || {}, taste = recruiting.place_taste(p);
  for (const k of ["setting", "climate"]) {
    if (truthy(get(tags, k))) {
      out["location"] += tags[k] === taste[k] ? recruiting.LOCATION_MATCH : -recruiting.LOCATION_CLASH;
    }
  }
  out["location"] = Math.max(0.0, Math.min(1.0, out["location"]));
  return out;
}


function academic_schools() {
  // Every academic school (academic()), sorted: the Grades Scare's list.
  const all = new Set([...Object.keys(programs.profile_rows()), ...recruiting.ACADEMIC]);
  return sorted([...all].filter((s) => recruiting.academic(s)));
}


function academic(slug) {
  // An academic school (the Grades Scare's): an Academics grade of ACADEMIC_FROM or better; with no grades, the old list.
  const g = programs.grades(slug);
  return g === null ? _in(slug, recruiting.ACADEMIC) : g["academics"] >= recruiting.ACADEMIC_FROM;
}


recruiting._FORCED = new Map();        // tests: (career, school, prospect, topic) -> strength


recruiting._PULLS = new Map();         // (career, class, prospect, school) -> the school's pulls that hold all season


function nil_room(state, slug) {
  // The NIL the school could still put on an offer, read only (never opens its NIL record): what is left
  // of its budget, or the whole budget (the portal's pool) before the record exists.
  const rec = get(state["recruiting"]["nil"], slug);
  if (rec !== null) {
    return rec["budget"] - sum(Object.values(rec["held"]));
  }
  return recruiting.is_portal(state) ? recruiting.portal_budget(state, slug) : recruiting.nil_budget(state, slug);
}


function known_ask(state, slug, pid) {
  // His ask as the player knows it (ask_view): the number once he is fully scouted, else the range's middle (which is
  // not his number: ask_spot).
  const v = recruiting.ask_view(state, slug, pid, true);
  return has(v, "exact") ? v["exact"] : recruiting._five((v["lo"] + v["hi"]) / 2);
}


function strengths(state, slug, pid, known = false) {
  // Your program's strength on each topic for this prospect, 0-1: the school's pull on him
  // (playing time from his place on the depth chart, winning, prestige, proximity, coach,
  // academics) with NIL read against his ask: the NIL held on him once there is some (the deal), and
  // before that what the school could pay him (nil_room plus anything held), never the program's tier.
  // `known`: read his ask as the player knows it (known_ask), so the page's word never leaks the number.
  const mv = get(state["recruiting"], "moved");
  const key = _key(state["id"], recruiting._ck(state["recruiting"]), pid, slug, truthy(mv) && _in(pid, mv));
  let static_ = recruiting._PULLS.get(key);
  if (static_ === undefined) {
    if (recruiting._PULLS.size > 2_000_000) {
      recruiting._PULLS.clear();
    }
    static_ = recruiting.pull(state, slug, pid, false);
    recruiting._PULLS.set(key, static_);
  }
  const out = { ...static_ };
  const wk = recruiting.weekly(state);
  for (const t of recruiting.WEEKLY) out[t] = Math.min(1.0, get(wk[t], slug, 0.5));
  const held = get(get(get(state["recruiting"]["nil"], slug, {}), "held", {}), pid) || 0;
  const ask = known ? recruiting.known_ask(state, slug, pid) : recruiting.ask_from(state, slug, pid, undefined, true);
  out["nil"] = !ask ? 1.0 : Math.min(1.0, (held > 0 ? held : recruiting.nil_room(state, slug)) / ask);
  for (const [k, v] of recruiting._FORCED) {
    const [sid, s_, p_, topic] = JSON.parse(k);
    if (sid === state["id"] && s_ === slug && p_ === pid) {
      out[topic] = v;
    }
  }
  const res = {};
  for (const [t, v] of Object.entries(out)) res[t] = round(Math.max(0.0, Math.min(1.0, v)), 3);
  return res;
}


class forced_strength {
  // A test's lever: `with forced_strength(state, slug, pid, topic, value): ...` (here: __enter__() ... __exit__()).

  constructor(state, slug, pid, topic, value) {
    this.key = [state["id"], slug, pid, topic];
    this.value = value;
  }

  __enter__() {
    recruiting._FORCED.set(_key(...this.key), this.value);
  }

  __exit__(...exc) {
    recruiting._FORCED.delete(_key(...this.key));
  }
}


function top_group(state, pid, win = null) {
  // The schools he is seriously considering: his top TOP_GROUP by interest among those that
  // have offered or worked him; from the weeks in FINALISTS his finalists, a shorter list (top_size).
  const rc = state["recruiting"];
  const schools = new Set(Object.keys(rc["lists"][pid]));
  for (const [s, pids] of Object.entries(rc["offers"])) if (pids.includes(pid)) schools.add(s);
  for (const s of Object.keys(get(get(rc, "pending") || {}, pid, {}))) schools.add(s);
  win = win != null ? win : recruiting._winning(state);
  return sorted(schools, (s) => -(recruiting.interest(state, s, pid, win) + recruiting.pending(state, s, pid))).slice(0, recruiting.top_size(state));
}


function stage(state, slug, pid) {
  // Where the school stands with him: cold, contact, top (his top group, offer in hand),
  // visited (an official visit happened) or committed.
  const rc = state["recruiting"];
  if (rc["status"][pid]["committed"] === slug || rc["status"][pid]["signed"] === slug) {
    return "committed";
  }
  if (truthy(get(get(get(rc["visits"], pid, {}), slug) || {}, "done"))) {
    return "visited";
  }
  if (get(rc["offers"], slug, []).includes(pid) && recruiting.top_group(state, pid).includes(slug)) {
    return "top";
  }
  const c = get(get(rc["contacts"], pid) || {}, slug) || {};
  return truthy(get(c, "n")) || get(rc["offers"], slug, []).includes(pid) ? "contact" : "cold";
}


function on_field(state, slug, week, records = null, ranks = null) {
  // Last season blended with this one, this season counting more every week (spec section 3).
  const season = modules.season;
  records = records != null ? records : season._records(state);
  ranks = ranks != null ? ranks : season.rank_map(state, state["current_week"]);
  const ls = get(recruiting._team_model(slug), "last_season");
  let last;
  if (truthy(ls) && ls["wins"] + ls["losses"]) {
    last = ls["wins"] / (ls["wins"] + ls["losses"]) + recruiting._bump(get(ls, "final_rank"));
  } else {
    last = 0.5;
  }
  const rec = records[slug];
  const games = rec["wins"] + rec["losses"];
  const now = games ? rec["wins"] / games + recruiting._bump(get(ranks, slug)) : last;
  const w = recruiting._interp(recruiting.LAST_SEASON_WEIGHT, week);
  return w * last + (1 - w) * now;
}


function _bump(rank) {
  if (!rank) {
    return 0.0;
  }
  for (const [top, b] of recruiting.POLL_BUMP) if (rank <= top) return b;
  return 0.0;
}


function weights(p) {
  // How much each topic counts for this prospect: his three priorities, the rest evenly.
  const rest = recruiting.OTHER_WEIGHT / (recruiting.PITCHES.length - 3);
  const w = {};
  for (const t of recruiting.PITCHES) w[t] = rest;
  const n = Math.min(p["priorities"].length, recruiting.PRIORITY_WEIGHTS.length);
  for (let i = 0; i < n; i++) {
    w[p["priorities"][i]] = recruiting.PRIORITY_WEIGHTS[i];
  }
  return w;
}


function interest(state, slug, pid, win = null) {
  const persona = modules.persona;
  const rc = state["recruiting"];
  const p = rc["prospects"][pid];
  const mv = get(rc, "moved");
  const key = _key(state["id"], recruiting._ck(rc), pid, slug, truthy(mv) && _in(pid, mv));       // a Family Move changes his pulls
  let static_ = recruiting._STATIC.get(key);
  if (static_ === undefined) {
    if (recruiting._STATIC.size > 2_000_000) {
      recruiting._STATIC.clear();
    }
    const w = recruiting.weights(p);
    static_ = sum(Object.entries(recruiting.pull(state, slug, pid, false)).map(([t, v]) => w[t] * v));
    recruiting._STATIC.set(key, static_);
  }
  const wmap = win != null ? win : recruiting._winning(state);
  win = Math.min(1.0, get(wmap, slug, 0.5));
  const wts = recruiting.weights(p), wk = recruiting.weekly(state);
  const season_part = wts["winning"] * win + wts["contender"] * Math.min(1.0, get(wk["contender"], slug, 0.5))
    + wts["recruiting"] * Math.min(1.0, get(wk["recruiting"], slug, 0.5));       // this season's standing: it moves every week
  const out = persona.story_interest(state, slug, pid, recruiting.PULL_SCALE * (static_ + season_part))
    + recruiting.fit_interest(state, slug, pid, wmap, key) + get(rc["lists"][pid], slug, 0.0);       // the fit: the program against what he wants (part 6)
  let tw = get(rc, "twists");
  tw = truthy(tw) ? get(tw, pid) : null;
  return truthy(tw) && tw["k"] === "surprise" && tw["s"] === slug ? out + tw["b"] : out;      // persona.twist_bonus, inline: this runs often
}


recruiting._STATIC = new Map();       // a prospect's pulls that hold all season (everything but winning), per school


function reset_caches() {
  // Forget everything worked out from the league's rosters (season.use_league switched it).
  recruiting._STATIC.clear();
  recruiting._PULLS.clear();
  recruiting._FIT.clear();
  _clear(recruiting._ASKS);
  recruiting._WINNING = [null, {}];
  recruiting._WEEKLY = [null, null];
  recruiting._BASE_CLASS = null;
  recruiting._FITS = [null, {}, null, null, {}];
  recruiting._GROUP_COUNTS = [null, {}];
  recruiting._LEAVER_CUT = [null, 0];
  recruiting._returning.cache_clear();
  recruiting._open_spots.cache_clear();
}
recruiting._WINNING = [null, {}];   // (career and week, this week's on-field standing of every school)


function _winning(state) {
  const season = modules.season;
  const key = _key(state["id"], get(state, "year"), state["current_week"], truthy(get(state, "done")));
  const cached_ = recruiting._WINNING;                     // one read: another request may swap it in meanwhile
  if (cached_[0] === key) {
    return cached_[1];
  }
  const records = season._records(state), ranks = season.rank_map(state, state["current_week"]);
  const value = {};
  for (const slug of recruiting.fbs_schools(state)) {
    value[slug] = recruiting.on_field(state, slug, state["current_week"], records, ranks);
  }
  recruiting._WINNING = [key, value];
  return value;
}


recruiting._WEEKLY = [null, null];   // (career, week and commitments; this week's standings of every school on the season's topics)
recruiting._BASE_CLASS = null;       // every school's standing in recruiting before the career's own classes (the model's baseline)


function _base_class() {
  // A school's recruiting standing going into the career, 0-1: its place among the schools by the model's baseline
  // strength (how it has really recruited), read as a class of that rank (programs.class_standing).
  if (recruiting._BASE_CLASS === null) {
    const schools = Object.keys(recruiting.model()["teams"]);
    const order = sorted(schools, (s) => [-recruiting._baseline(s), s]);
    const out = {};
    order.forEach((s, i) => { out[s] = programs.class_standing(1 + Math.floor(i * 138 / Math.max(1, order.length))); });
    recruiting._BASE_CLASS = out;
  }
  return recruiting._BASE_CLASS;
}


function weekly(state) {
  // Every school's standing this week on the season's topics (WEEKLY), each 0-1: {"winning": {slug: v}, "contender":
  // {...}, "recruiting": {...}}.
  //   winning:    this season's record and ranking, last season counting less every week (on_field);
  //   contender:  is it in the playoff picture: its ranking, else its record, never more than its losses allow
  //               (programs.contender_of), blended with how last season ended the same way;
  //   recruiting: its last three signed classes by national rank, newest counting most, with the class it is building
  //               now counting more as the cycle goes (half by Signing Day).
  const season = modules.season, prospects = modules.prospects;
  const rc = state["recruiting"];
  // (asked for with every interest and every fit: the key is compared part by part, never built as text)
  const key = [state["id"], get(state, "year"), state["current_week"], truthy(get(state, "done")), recruiting._ck(rc), get(rc, "commits_v", 0),
    get(rc, "week", 0)];
  const cached_ = recruiting._WEEKLY;
  const had = cached_[0];
  if (had !== null && had[0] === key[0] && had[1] === key[1] && had[2] === key[2] && had[3] === key[3] && had[4] === key[4] && had[5] === key[5]
      && had[6] === key[6]) return cached_[1];
  const week = state["current_week"];
  const records = season._records(state), ranks = season.rank_map(state, week);
  const winning = recruiting._winning(state);
  const w_last = recruiting._interp(recruiting.LAST_SEASON_WEIGHT, week);
  const w_now = truthy(get(rc, "portal")) ? programs.CLASS_NOW[programs.CLASS_NOW.length - 1][1] : recruiting._interp(programs.CLASS_NOW, week);
  let table = {};
  try {
    table = prospects.class_table(state, null);
  } catch (err) {
    table = {};
  }
  const base = _base_class();
  const lgd = get(state, "league") || {};
  const contender = {}, classes = {};
  for (const slug of recruiting.fbs_schools(state)) {
    const ls = get(recruiting._team_model(slug), "last_season");
    const last = truthy(ls) && ls["wins"] + ls["losses"] ? programs.contender_of(get(ls, "final_rank"), ls["wins"], ls["losses"], false)
      : programs.CONTENDER_UNRANKED[0] + programs.CONTENDER_UNRANKED[1] * 0.5;
    const rec = get(records, slug) || { wins: 0, losses: 0 };
    const games = rec["wins"] + rec["losses"];
    const now = games ? programs.contender_of(get(ranks, slug), rec["wins"], rec["losses"]) : truthy(get(ranks, slug)) ? programs.contender_of(ranks[slug], 0, 0) : last;
    contender[slug] = w_last * last + (1 - w_last) * now;
    const before = get(base, slug, 0.4);
    const signed = (get(get(get(get(lgd, "teams") || {}, slug) || {}, "program") || {}, "classes") || []).map(([, r]) => programs.class_standing(r)).reverse();   // newest first
    let past = 0.0, total = 0.0;
    programs.CLASS_WEIGHTS.forEach((wt, i) => { past += wt * (i < signed.length ? signed[i] : before); total += wt; });
    past /= total;
    const row = get(table, slug);
    const building = truthy(row) && get(row, "pids", []).length ? programs.class_standing(row["rank"]) : past;
    classes[slug] = (1 - w_now) * past + w_now * building;
  }
  const value = { winning: winning, contender: contender, recruiting: classes };
  recruiting._WEEKLY = [key, value];
  return value;
}


// ----- your hours, points and actions -----------------------------------------------------------------

class RecruitingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RecruitingError";
    this.code = code;
    this.message = message;
  }
}


function _recruiting_rating(state, slug) {
  if (slug === get(state, "team") && truthy(get(get(state, "coach") || {}, "ratings"))) {
    return get(state["coach"]["ratings"], "recruiting", 50);
  }
  const season = modules.season;
  const hc = get(get(season.load_teams()[slug], "coaches") || {}, "head_coach") || {};
  return get(get(hc, "ratings") || {}, "recruiting", 50);
}


function weekly_hours(state, slug) {
  // A school's energy a week, by its program's stars: ENERGY_ZERO plus ENERGY_PER_STAR a star (180 at none, 480 at five).
  let rating;
  try {
    rating = programs.get(state, slug)["rating"];
  } catch (e) {
    rating = programs.base(slug)["rating"];          // a school the career holds no program for
  }
  return int(round(recruiting.ENERGY_ZERO + recruiting.ENERGY_PER_STAR * programs.stars_of(rating)));
}


function scout_blend(state, pid) {
  // Your staff's read of one prospect, on the scale the page shows (the average coach a 70): half the recruiter who
  // covers his state (your best recruiter when none does), a quarter the coordinator on his side of the ball (both,
  // averaged, for a kicker, a punter or an athlete), a quarter you. It sets how many looks finish his report
  // (looks_needed) and whether his potential reads with a plus or a minus (grades.fine).
  const staff = get(get(state, "career") || {}, "staff") || [];
  const p = state["recruiting"]["prospects"][pid];
  const home = get(get(p, "hometown") || {}, "state");
  const rated = (m) => Number(get(m, "evaluation", 50) || 0);
  const recruiters = staff.filter((m) => get(m, "role") === "Recruiter");
  const there = recruiters.filter((m) => get(recruiting.AREAS, get(m, "area"), []).includes(home));
  const pool = there.length ? there : recruiters;
  const scout = pool.length ? Math.max(...pool.map(rated)) : 50;
  const of = (role) => {
    const m = staff.find((x) => get(x, "role") === role);
    return m ? rated(m) : 50;
  };
  const g = recruiting._group_of(p);
  const coordinator = recruiting.OFFENSE_GROUPS.includes(g) ? of("OC") : recruiting.DEFENSE_GROUPS.includes(g) ? of("DC") : (of("OC") + of("DC")) / 2;
  const coach = Number(get(get(get(state, "coach") || {}, "ratings") || {}, "evaluation", 60) || 0);
  const w = recruiting.BLEND_WEIGHTS;
  return round(w["scout"] * shown.coach(scout) + w["coordinator"] * shown.coach(coordinator) + w["coach"] * shown.coach(coach), 1);
}


function looks_needed(state, pid) {
  // How many looks finish his report with the staff you have now: 2 for a blend of 85 or better, 3 from 70, else 4.
  const blend = recruiting.scout_blend(state, pid);
  for (const [floor, n] of recruiting.LOOKS_BY_BLEND) if (blend >= floor) return n;
  return recruiting.LOOKS_WORST;
}


function look_unit(state, pid) {
  // What one of his looks is worth in a read's own units (a complete report is REPORT_LOOKS of them).
  return recruiting.REPORT_LOOKS / recruiting.looks_needed(state, pid);
}


function looks_done(state, pid) {
  // His report in his own looks, to the half look ("1.5" of looks_needed): what the page shows.
  const read = get(state["recruiting"]["reads"], pid);
  const n = recruiting.looks_needed(state, pid);
  if (recruiting.report_complete(read)) return n;
  return Math.min(n - 0.5, round((recruiting.report_looks(read) / recruiting.look_unit(state, pid)) * 2) / 2);
}


function best_evaluator(state) {
  // The best evaluation rating on your side: your staff and your coach.
  const staff = get(get(state, "career") || {}, "staff") || [];
  return Math.max(...staff.map((m) => get(m, "evaluation", 50)), get(get(get(state, "coach") || {}, "ratings") || {}, "evaluation", 60));
}


function scout_points(state, slug) {
  // There are no scouting points any more: a look is paid in energy (LOOK_ENERGY). Kept for the readers that still
  // ask: the week's energy.
  return recruiting.weekly_hours(state, slug);
}


function scout_points_left(state, slug) {
  // There are no scouting points any more: what a look is paid from is the week's energy left (less your plans).
  return slug === get(state, "team") ? recruiting.hours_free(state, slug) : recruiting._hours(state, slug);
}


function covered_states(state) {
  // The state codes a staff scout covers: the areas `scout_week` sends them to.
  const staff = get(get(state, "career") || {}, "staff") || [];
  const out = new Set();
  for (const member of staff) for (const code of get(recruiting.AREAS, get(member, "area"), [])) out.add(code);
  return out;
}


function near_home(state, slug, pid) {
  // Whether the prospect is close to your campus: his hometown state is your school's, or his home (after a
  // Family Move) lies within HOME_MILES of it.
  const season = modules.season;
  const persona = modules.persona;
  const p = state["recruiting"]["prospects"][pid];
  const team_state = get(get(season.load_teams(), slug) || {}, "state");
  if (team_state && p["hometown"]["state"] === team_state) {
    return true;
  }
  const loc = get(recruiting._team_model(slug), "location");
  return truthy(loc) && recruiting._miles([...persona.home_of(state, p)], [...loc]) <= recruiting.HOME_MILES;
}


function look_cost(state, slug, pid) {
  // What a Send on `pid` costs, in energy: LOOK_ENERGY, whoever and wherever he is. (It was scouting points, by how
  // far he was from your scouts; how good your staff is now sets how many looks his report takes: looks_needed.)
  return recruiting.LOOK_ENERGY;
}


function nil_budget(state, slug) {
  // A school's NIL points for the year: 3 × its NIL tier (10-100), so the top programs keep the
  // budget the recruiting baseline gave (Ohio State about 275) and the middle has room for a few
  // blue-chip asks (SMU about 135, Tulane 110). The class adds last year's carry-over (`_nil`).
  return Math.max(recruiting.NIL_FLOOR, recruiting._five(recruiting.NIL_PER_TIER * programs.get(state, slug)["nil"]));
}


function _reward_lines(facts) {
  // The reward lines a season earns: a winning record (nine wins replaces it), the conference
  // title, the playoff, a playoff game hosted on campus, the national title, the AD's goal met.
  const lines = [];
  if (get(facts, "wins", 0) >= 9) {
    lines.push("nine_wins");
  } else if (get(facts, "wins", 0) > get(facts, "losses", 0)) {
    lines.push("winning");
  }
  for (const k of ["conference", "playoff", "host", "title"]) {
    if (truthy(get(facts, k))) {
      lines.push(k);
    }
  }
  if (truthy(get(facts, "met"))) {
    lines.push("goal");
  }
  return lines;
}


function reward(budget, facts) {
  // The NIL the season just played earns for the portal: the lines' shares of the year's budget,
  // summed and capped at REWARD_CAP, in fives, and never less than the playoff lines' flat points (REWARD_FLAT:
  // a playoff run pays a small collective what it pays anyone). `facts`: wins, losses, conference, playoff, host, title, met.
  const lines = recruiting._reward_lines(facts);
  const share = Math.min(recruiting.REWARD_CAP, sum(lines.map((k) => recruiting.REWARD[k])));
  return Math.max(recruiting._five(share * budget), sum(lines.map((k) => get(recruiting.REWARD_FLAT, k, 0))));
}


function reward_why(facts) {
  // The reward's lines in words, for the review.
  return recruiting._reward_lines(facts).map((k) => recruiting.REWARD_WHY[k]);
}


function portal_pool(state, slug, facts = null) {
  // A school's NIL for the portal: what it had left of the year's budget after signing day plus
  // the season's reward, never less than the collective's portal fund (PORTAL_FLOOR of the budget).
  // The record the review shows: left, reward, reward_why, floor, pool, record; `retained` (keep
  // them home) and, after the portal, `unspent` and `carry` are filled in as they happen.
  if (facts == null) {
    const offseason = modules.offseason;
    facts = get(offseason.season_facts(state), slug) || {};
  }
  const budget = recruiting.nil_budget(state, slug);
  const rc = recruiting.is_portal(state) ? get(state, "recruiting_last") : get(state, "recruiting");
  const n = truthy(rc) ? get(get(rc || {}, "nil", {}), slug) : null;
  const left = truthy(n) ? Math.max(0, n["budget"] - sum(Object.values(n["held"]))) : budget;
  const earned = recruiting.reward(budget, facts);
  const floor = recruiting._five(recruiting.PORTAL_FLOOR * budget);
  return { "budget": budget, "left": left, "reward": earned, "reward_why": recruiting.reward_why(facts), "floor": floor,
           "pool": Math.max(floor, left + earned), "retained": 0, "record": [get(facts, "wins", 0), get(facts, "losses", 0)] };
}


function pool_record(state, slug) {
  // The school's portal pool record, seeded by offseason.start (a save from before the pool: seeded now).
  const pools = setdefault(state, "nil_pool", {});
  if (!has(pools, slug)) {
    pools[slug] = recruiting.portal_pool(state, slug);
  }
  return pools[slug];
}


function portal_budget(state, slug) {
  // What the school brings to the portal: its pool less what it spent keeping players home.
  const p = recruiting.pool_record(state, slug);
  return Math.max(0, p["pool"] - get(p, "retained", 0));
}


function carry_over(state, slug, unspent) {
  // What a school's unspent portal NIL carries into next year: capped at CARRY_CAP of next
  // year's budget by the program's tier; anything above is gone.
  const cap = recruiting._five(recruiting.CARRY_CAP[programs.get(state, slug)["tier"]] * recruiting.nil_budget(state, slug));
  return Math.max(0, Math.min(5 * floordiv(int(unspent), 5), cap));          // whole fives only: a few stray points are not carried
}


function _five(x) {
  // NIL numbers come in fives: budgets, pools and asks.
  return int(5 * round(x / 5));
}


function open_spots(state, slug) {
  if (recruiting.is_portal(state)) {
    return recruiting.portal_spots(state, slug);
  }
  // your class is CLASS_CAP every year, whatever room your roster has (the rest is Roster Cuts); another school's is
  // its usual size, under the same cap
  if (slug === get(state, "team") && truthy(get(state, "career"))) return recruiting.CLASS_CAP;
  return Math.min(recruiting.CLASS_CAP, recruiting._open_spots(slug));
}


function portal_room(state, slug) {
  // A school's room for transfers this portal, before any signs: the roster limit (plus the end
  // of the roster a Power 4 school or you would release) minus next year's roster.
  // (yours is TRANSFER_CAP every year, whatever your roster holds: Roster Cuts settles the limit; another school's is
  // its roster's room, under the same cap)
  if (slug === get(state, "team") && truthy(get(state, "career"))) return recruiting.TRANSFER_CAP;
  const extra = recruiting._p4(slug) ? recruiting.PORTAL_CHURN : 0;
  return Math.min(recruiting.TRANSFER_CAP, recruiting.ROSTER_LIMIT + extra - state["league"]["teams"][slug]["roster"].length);
}


function portal_spots(state, slug) {
  // A school's portal spots: its portal room minus the transfers it has signed.
  let taken = 0;
  for (const st_ of Object.values(state["recruiting"]["status"])) if (st_["signed"] === slug) taken += 1;
  return Math.max(0, recruiting.portal_room(state, slug) - taken);
}


function portal_upgrade(state, slug, p) {
  // Whether a transfer would start for the school: his overall beats the last starter at his
  // group on next year's roster. A school takes an upgrade past its group's cap, as a real one does.
  if (!recruiting.is_portal(state)) {
    return false;
  }
  const offseason = modules.offseason;
  const g = get(p, "group") || recruiting._group_of(p);
  const ovrs = sorted(state["league"]["teams"][slug]["roster"].filter((q) => get(offseason.GROUP, q["pos"]) === g).map((q) => q["o"]), undefined, true);
  const n = get(recruiting.PORTAL_STARTERS, g, 1);
  return p["ovr"] > (ovrs.length >= n ? ovrs[n - 1] : 0);
}


function _p4(slug) {
  const season = modules.season;
  return season._is_p4(slug, season.load_teams()[slug]);
}


// (@lru_cache(maxsize=None))
const _open_spots = cached((slug) => {
  const season = modules.season;
  const t = season.load_teams()[slug];
  const players = _players(t);
  let returning = 0;
  for (const p of players) if (!_in(get(p, "class"), recruiting.LEAVING)) returning += 1;
  const limit = recruiting.ROSTER_LIMIT;
  const usual = Math.ceil(get(get(recruiting._team_model(slug), "class_size") || {}, "mean") || 20) + recruiting.CLASS_ROOM;
  return Math.max(recruiting.MIN_OPEN, Math.min(limit - returning + recruiting.EARLY_LEAVERS, usual));
});


function offer_cap(state, slug) {
  return Math.ceil(recruiting.OFFER_FACTOR * recruiting.open_spots(state, slug));
}


function _contact_points(state, slug, p, action, pitch, first_call = false) {
  // What one action is worth to the prospect before diminishing returns: the pitch on one of
  // his priorities (or his decider's topic) counts by how he takes it, your letter there against what he
  // wants (reaction_kind, REACTION_WORTH; it backfires when he isn't buying it); any other topic counts a
  // little. His personality scales it (persona.pitch_mult), and so does how well the program fits him (move_mult).
  const persona = modules.persona;
  const pid = p["id"];
  let mult = persona.pitch_mult(state, pid, action, pitch, first_call) * persona.story_mult(state, slug, pid, pitch) * persona.twist_mult(state, slug, pid, pitch);
  if (action === "offer") {
    mult *= persona.offer_mult(state, pid);
  }
  mult *= recruiting.move_mult(state, slug, pid);        // the further the program is from what he wants, the less a contact moves him
  if (pitch == null) {
    return recruiting.BASE_POINTS[action] * mult;
  }
  const strength = recruiting.strengths(state, slug, pid)[pitch];
  if (persona.counts_as_priority(state, pid, pitch)) {
    const kind = recruiting.reaction_kind(state, slug, pid, pitch, strength);      // your letter there against what he wants
    if (kind === "quiet") {
      return -recruiting.BACKFIRE_COST * recruiting.BASE_POINTS[action];
    }
    return recruiting.BASE_POINTS[action] * recruiting.REACTION_WORTH[kind] * mult;
  }
  return recruiting.BASE_POINTS[action] * (recruiting.PITCH_OTHER[0] + recruiting.PITCH_OTHER[1] * strength) * mult;
}


function _grade_points(state, slug, p, action) {
  // Your own quick action, which carries no topic (a message, a call or a video call from his row, an offer by hand):
  // one blanket increase, the action's base (QUICK_BASE) scaled by how well your program fits him overall (quick_mult:
  // your letters on his priorities against what he wants, his first weighing most, between QUICK_FLOOR and
  // QUICK_CEIL), never a backfire; his personality scales it as it scales a contact. A conversation, where you pitch
  // a topic, can beat it (He's Sold, He Lights Up) or fall under it. Auto-recruit and the AI keep their one-pitch path.
  const persona = modules.persona;
  const pid = p["id"];
  let mult = persona.pitch_mult(state, pid, action, null, false);
  if (action === "offer") {
    mult *= persona.offer_mult(state, pid);
  }
  return recruiting.BASE_POINTS[action] * get(recruiting.QUICK_BASE, action, 1.0) * recruiting.quick_mult(state, slug, pid) * mult;
}


function best_pitch(state, slug, pid, required = false) {
  // The topic a staff pitches: of the priorities it knows, the one he takes best (reaction_kind; ties to its
  // strongest) that will not backfire; nothing in particular when it knows none (`required`, an offer: its strongest topic).
  const known = get(get(state["recruiting"]["revealed"], slug) || {}, pid) || [];
  const st_ = recruiting.strengths(state, slug, pid);
  const kind = {};
  for (const t of known) kind[t] = recruiting.reaction_kind(state, slug, pid, t, st_[t]);
  const pool = known.filter((t) => kind[t] !== "quiet");
  if (!pool.length) {
    return required ? maxBy(recruiting.PITCHES, (t) => st_[t]) : null;
  }
  return maxBy(pool, (t) => [-recruiting.REACTIONS.indexOf(kind[t]), st_[t]]);
}


function _hours(state, slug) {
  return setdefault(state["recruiting"]["hours"], slug, recruiting.weekly_hours(state, slug));
}


Object.assign(recruiting, {
  _group_of, commits_by_group, needs, needs_detail, spot_of, spot_of_player, need_levels, spot_matches, _share,
  needs_by_spot, recommended, need_factor, offers_by_group, group_cap, group_full, _returning, _coach_edge, pull,
  place_taste, _taste, _grade_pulls, academic_schools, academic, nil_room, known_ask, strengths, forced_strength,
  top_group, stage, on_field, _bump, weights, interest, reset_caches, _winning, _base_class, weekly, RecruitingError, _recruiting_rating,
  weekly_hours, scout_blend, looks_needed, look_unit, looks_done, best_evaluator, scout_points, scout_points_left, covered_states, near_home, look_cost, nil_budget,
  _reward_lines, reward, reward_why, portal_pool, pool_record, portal_budget, carry_over, _five, open_spots,
  portal_room, portal_spots, portal_upgrade, _p4, _open_spots, offer_cap, _contact_points, _grade_points, best_pitch,
  _hours,
});
