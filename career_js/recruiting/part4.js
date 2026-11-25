// Recruiting, part 4: a contact's points and pestering, the
// week's helpers (a revealed priority, the commit counts, the seeded stream, the log), a school's fit for every
// prospect and its board, Auto-recruit's week, official visits, a commitment (and a Package Deal's mate), the flip
// odds, money and other promises at the week step, commitments firming up, a school's room, and the week's draws.
//
// Every name of recruiting is reached through the `recruiting` namespace, whichever part defines it
// (engine_js/PORTING.md, "Big Files in Parts").
//
// Notes:
//  - `_event(state, kind, pid, school, extra)` and `_commit(state, pid, slug, kind, pair, extra)` take the fields
//    carried onto an event as one object, last (its keys in the order they are written onto the event).
//  - `_Room(state, flier)` (with or without `new`) returns a function
//    `room(slug, pid)` carrying the instance's attributes and methods (`room.commits`, `room.groups`, `room.slack`,
//    `room.yours`, `room.portal`, `room._at`, `room._limit`, `room.why_not`, `room.took`, and `room.__call__`).
//    `room.groups[slug]` is the pair `[need, commits]`.
//  - `_class_by_position` is keyed by `school + "\u0000" + position`
//    (`recruiting._pos_key(school, position)`); no slug or position holds that character.
//  - `_FITS` is the array `[key, fits by school, pool, version, tiers]`, its key the array
//    `[state id, class key]` (or null), compared item by item. The tiers' keys and the two pools' states are compared
//    by value: the same keys (and values), whatever their order.
//  - `redo` in `_fits` is a Set that `_fit_all` walks in insertion order. Each prospect's fit is worked out on its
//    own and written over the one kept, so the order changes nothing.
//  - `_national_share` keeps its answers in a Map by its argument (`recruiting._national_share.cache_clear()` empties
//    it).
//  - A square of a float is `pypow(x, 2)` (exact); `Math.sin`, `cos`, `asin`, `exp` and `log` are the JavaScript
//    engine's own, so a fit (`_fit_all`) and a board's sampling keys can differ between machines in the last digit
//    (PORTING.md, "Numbers").
//  - A dict keyed by prospect id that this part builds (`_fit_all`'s fits, `_fits`' tiers, `_offers_by_prospect`) is an
//    odict: a transfer's id can be all digits.
import { Random, round, int, sum, cmp, sorted, get, truthy, odict } from "../../engine_js/pyrt.js";
import { modules } from "../../engine_js/modules.js";
import { pypow } from "../recruits.js";
import { recruiting } from "../recruiting_ns.js";

// ----- small helpers (local to this part) --------------------------------------------------------------------

const has = (d, k) => Object.prototype.hasOwnProperty.call(d, k);

/** `x in coll` for a set, a list or a tuple. */
const _in = (x, coll) => (coll instanceof Set ? coll.has(x) : Array.from(coll).includes(x));

/** list(dict.fromkeys(xs)): each item once, in the order first met. */
const _unique = (xs) => [...new Set(xs)];

/** list.remove(x): the first one. */
function _remove(xs, x) {
  const i = xs.indexOf(x);
  if (i !== -1) xs.splice(i, 1);
}

/** math.radians. */
const _radians = (deg) => deg * (Math.PI / 180);

/** Two cache keys (tuples, or None) are the same. */
function _same_key(a, b) {
  if (a === null || b === null || a === undefined || b === undefined) return a === b;
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Two dicts hold the same keys, whatever their order. */
function _same_keys(a, b) {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => has(b, k));
}

/** Two flat dicts are equal (the same keys and values, whatever the order). */
function _same_dict(a, b) {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => has(b, k) && a[k] === b[k]);
}

/** An `except RecruitingError`: anything else goes on up. */
function _only_recruiting_error(err) {
  if (!(err instanceof recruiting.RecruitingError)) throw err;
}

// ----- (the end of "your hours, points and actions") -----------------------------------------------------------

/**
 * A contact's points (a message, call or visit, one-shot or a scene's pitch): the pitch's worth
 * cut by earlier contacts, halved while he is cooled; a backfire is logged. Past PESTER_FREE
 * contacts from your hand while he is not considering you (`not_considering`), the contact pesters him instead: negative
 * points that grow with each pester, the pitch ignored, his ask from you up (not Auto-recruit's,
 * never an AI school's).
 */
function _contact_land(state, slug, p, contact, action, pitch, auto = false, manual = false) {
  const persona = modules.persona;
  const pid = p["id"];
  persona.note_contact(state, slug, pid, contact, pitch);
  if (!truthy(auto) && slug === get(state, "team") && contact["n"] >= persona.pester_free(state, pid) && !truthy(recruiting._pester_exempt(state, slug, pid))) {
    if (!truthy(recruiting.not_considering(state, slug, pid))) {
      delete contact["pester"];           // he is considering you: the old pesters are forgotten
    } else {
      const k = get(contact, "pester", 0);
      contact["pester"] = k + 1;
      contact["ask_mult"] = round(Math.min(recruiting.ASK_MULT_MAX, get(contact, "ask_mult", 1.0) * recruiting.PESTER_ASK), 3);
      recruiting._event(state, "pester", pid, slug, { action, n: k + 1 });
      let points = -(recruiting.PESTER_COST * recruiting.BASE_POINTS[action]) * (1 + recruiting.PESTER_RAMP * k);
      if (truthy(recruiting.cooled(state, slug, pid))) points *= recruiting.COOLED_CONTACT;
      contact["n"] += 1;
      if (action === "call") contact["calls"] = get(contact, "calls", 0) + 1;
      return points;
    }
  }
  const base = truthy(manual) && _in(action, recruiting.PLANNABLE) ? recruiting._grade_points(state, slug, p, action)     // your quick action: the blanket rate
    : recruiting._contact_points(state, slug, p, action, pitch, action === "call" && !truthy(get(contact, "calls")));
  let points = base / (1 + recruiting.DIMINISH * contact["n"]);
  if (points < 0) recruiting._event(state, "not_buying", pid, slug, { topic: pitch });
  if (truthy(recruiting.cooled(state, slug, pid))) points *= recruiting.COOLED_CONTACT;
  contact["n"] += 1;
  if (action === "call") contact["calls"] = get(contact, "calls", 0) + 1;
  return points;
}

/**
 * A school he has come to consider (or that hosted or landed him) starts clean: a later slide
 * does not carry the old pesters. Only your school ever has any.
 */
function _forgive_pesters(state) {
  const rc = state["recruiting"], me = get(state, "team");
  for (const [pid, by] of Object.entries(rc["contacts"])) {
    const c = get(by, me);
    if (truthy(c) && truthy(get(c, "pester")) && (truthy(recruiting._pester_exempt(state, me, pid)) || !truthy(recruiting.not_considering(state, me, pid)))) {
      delete c["pester"];
    }
  }
}

// ----- the week: AI schools, visits, commitments, flips and signing ----------------------------------

/** The next of his priorities this school learns, if any are left. */
function _reveal(state, slug, pid) {
  const rc = state["recruiting"];
  if (!has(rc["revealed"], slug)) rc["revealed"][slug] = odict();          // by prospect id
  const of_school = rc["revealed"][slug];
  if (!has(of_school, pid)) of_school[pid] = [];
  const seen = of_school[pid];
  let revealed = null;
  for (const t of rc["prospects"][pid]["priorities"]) {
    if (!seen.includes(t)) { revealed = t; break; }
  }
  if (truthy(revealed)) seen.push(revealed);
  return revealed;
}

function _commits(state) {
  const out = {};
  for (const st of Object.values(state["recruiting"]["status"])) {
    if (truthy(st["committed"]) && st["committed"] !== "FCS") out[st["committed"]] = get(out, st["committed"], 0) + 1;
  }
  return out;
}

function signed_class(state, slug) {
  return Object.entries(state["recruiting"]["status"]).filter(([pid, st]) => st["signed"] === slug).map(([pid, st]) => pid);
}

/** A seeded stream of its own for `what` this week (twists): new randomness never moves an old draw. */
function _rng(state, what) {
  const rc = state["recruiting"];
  return new Random(`${what}-${rc["seed"]}-${truthy(get(rc, "portal")) ? "portal-" : ""}${state["current_week"]}`);
}

/**
 * A line in the recruiting log. In the portal it also carries the portal week (`portal_week`):
 * the season's week stands still through the offseason. (`extra`: the event's other fields, as one object.)
 */
const _LIVE_NEVER = ["commit", "hard", "flip", "decommit", "signed", "unsigned"];   // his own moves: a step's, whenever they are logged


function _event(state, kind, pid, school = null, extra = {}) {
  const e = { week: state["current_week"], kind: kind, pid: pid, school: school, ...extra };
  if (truthy(get(state["recruiting"], "portal"))) e["portal_week"] = get(state["recruiting"], "week");
  // your own action, made between two weeks' steps: it belongs to the week you are in (the one after `week`), where
  // a step's event belongs to `week` itself. `live` says which, so his History names the right week (the stored
  // week is unchanged: the month between visits and the week's contacts are counted from it).
  else if (recruiting._STEP_WEEK[0] === null && school !== null && school === get(state, "team") && !_LIVE_NEVER.includes(kind)) e["live"] = true;
  state["recruiting"]["log"].push(e);
  return e;
}

/**
 * How well each prospect fits a school's usual recruiting: its states (each state's real share
 * of its signees spread over that state's prospects in this class; the rest over everyone else,
 * nearer first), a blue-chip program's national reach, its star level and its positions.
 * With `only` and `out`: the same sum for those prospects alone, written into `out` (a school's
 * fits kept from before, after a few stars moved).
 */
function _fit_all(slug, prospects, pool, only = null, out = null) {
  const tm = recruiting._team_model(slug);
  const shares = Object.fromEntries(get(tm, "top_states") || []);
  const rest = pool["total"] - sum(Object.keys(shares).map((s) => get(pool["states"], s, 0)));
  const rest_w = Math.max(0.0, 1 - sum(Object.values(shares))) / Math.max(1, rest);
  const reach = recruiting.NATIONAL_REACH * (get(tm, "blue_chip_share") || 0.0) / pool["blue_chips"];
  const star_share = get(tm, "star_share") || {};
  const lift = {};
  for (const n of [2, 3, 4, 5]) lift[n] = get(star_share, get(recruiting.STAR_KEY, n, "2*"), 0.0) / recruiting._national_share(n) + 0.05;
  const per_class = get(tm, "positions_per_class") || {};
  const loc = get(tm, "location");
  const [lat0, lon0] = truthy(loc) ? [_radians(loc[0]), _radians(loc[1])] : [null, null];
  const cos0 = truthy(loc) ? Math.cos(lat0) : 0.0;
  if (out === null || out === undefined) out = odict();
  const todo = only === null || only === undefined ? Object.entries(prospects) : Array.from(only, (pid) => [pid, prospects[pid]]);
  for (const [pid, p] of todo) {
    const home = p["hometown"]["state"];
    let w;
    if (has(shares, home)) {
      w = shares[home] / pool["states"][home];
    } else if (truthy(loc)) {
      const lat = _radians(p["home"][0]), lon = _radians(p["home"][1]);
      const h = pypow(Math.sin((lat - lat0) / 2), 2) + cos0 * Math.cos(lat) * pypow(Math.sin((lon - lon0) / 2), 2);
      w = rest_w * recruiting.REST_NEAR * Math.exp(-3958.8 * 2 * Math.asin(Math.sqrt(h)) / recruiting.REST_MILES);
    } else {
      w = rest_w;
    }
    const tier = recruiting.tier_of(p);
    if (tier >= 4) w += reach;
    const pos = get(per_class, get(recruiting.POS_247, p["position"], p["position"]), 1.0);
    out[pid] = w * get(lift, tier, lift[2]) * (0.9 + 0.2 * Math.min(1.0, pos / 2));
  }
  return out;
}

/** The class's prospects by home state, for spreading schools' state shares. */
function _pool(state) {
  const pros = Object.values(state["recruiting"]["prospects"]);
  const states = {};
  for (const p of pros) states[p["hometown"]["state"]] = get(states, p["hometown"]["state"], 0) + 1;
  return { states: states, total: pros.length, blue_chips: Math.max(1, pros.filter((p) => recruiting.tier_of(p) >= 4).length) };
}

/** The share of a class at a star level: a school's star lift is its share over this. (lru_cache: kept by its argument.) */
const _national_share_cache = new Map();
function _national_share(stars) {
  if (_national_share_cache.has(stars)) return _national_share_cache.get(stars);
  const counts = recruiting.model()["generation"]["prospects_per_class"];
  const value = int(Number(get(counts, String(stars), 1))) / sum(Object.values(counts).map((v) => int(Number(v))));
  _national_share_cache.set(stars, value);
  return value;
}
_national_share.cache_clear = () => _national_share_cache.clear();

// (career and class, each school's fit for every prospect, the pool, the class's star version, every prospect's tier then)
recruiting._FITS = [null, {}, null, null, {}];

/** Every prospect's tier, by id in the class's order. */
function _tiers_now(rc) {
  const tiers = odict();
  for (const [pid, p] of Object.entries(rc["prospects"])) tiers[pid] = recruiting.tier_of(p);
  return tiers;
}

/**
 * A school's fit for every prospect in the class, cached for one career. A fit is fixed all season but for a
 * star that moves (a Late Bloomer's jump, rc["class_v"]): then only what the jump touches is worked out again,
 * his own fit at every school, and every blue chip's when the jump changed how many there are (their national
 * reach is shared out among them). Working every school's whole class out again cost three seconds a jump.
 */
function _fits(state, slug) {
  const rc = state["recruiting"];
  const key = [state["id"], recruiting._ck(rc)];
  const version = get(rc, "class_v", 0);
  let cached = recruiting._FITS;
  if (!_same_key(cached[0], key)) {
    const pool = recruiting._pool(state);
    cached = recruiting._FITS = [key, {}, pool, version, _tiers_now(rc)];
  } else if (cached[3] !== version) {
    const pool = recruiting._pool(state), tiers = _tiers_now(rc);
    const old_pool = cached[2], old_tiers = cached[4];
    if (!_same_keys(tiers, old_tiers) || !_same_dict(pool["states"], old_pool["states"])) {     // another class of prospects: start over
      cached = recruiting._FITS = [key, {}, pool, version, tiers];
    } else {
      const redo = new Set(Object.entries(tiers).filter(([pid, t]) => t !== old_tiers[pid]).map(([pid, t]) => pid));
      if (pool["blue_chips"] !== old_pool["blue_chips"]) {
        for (const [pid, t] of Object.entries(tiers)) if (t >= 4) redo.add(pid);
      }
      for (const [school, kept] of Object.entries(cached[1])) recruiting._fit_all(school, rc["prospects"], pool, redo, kept);
      cached = recruiting._FITS = [key, cached[1], pool, version, tiers];
    }
  }
  let fits = get(cached[1], slug);
  if (fits === null) fits = cached[1][slug] = recruiting._fit_all(slug, rc["prospects"], cached[2]);
  return fits;
}

function _build_board(state, slug, rng, touch = true) {
  const rc = state["recruiting"];
  const free = Object.entries(rc["status"]).filter(([pid, st]) => !truthy(st["signed"]) && !truthy(st["committed"])
    && get(rc["prospects"][pid], "from") !== slug).map(([pid, st]) => pid);            // the portal: never a school's own leaver
  // weighted sampling without replacement (key u^(1/fit)): the board's mix of states and star
  // levels follows the school's real shares instead of always taking its home state first
  let keyed = [];
  const fits = recruiting._fits(state, slug);
  const need = recruiting.needs(state, slug);
  const factor_of = {};
  for (const [g, n] of Object.entries(need)) factor_of[g] = recruiting.need_factor(n);
  const tm0 = recruiting._team_model(slug);
  const takes_fives = (get(get(tm0, "star_share") || {}, "5*", 0.0) / recruiting._national_share(5)) >= 1;   // a blue blood takes a five-star anywhere
  const pros = rc["prospects"];
  const tiers = recruiting._tiers(rc);
  for (const pid of free) {
    const p = pros[pid];
    let factor = factor_of[get(p, "group") || recruiting._group_of(p)];
    if (takes_fives && tiers[pid] === 5) factor = Math.max(factor, recruiting.FIVE_STAR_FLOOR);
    const f = fits[pid] * factor;
    if (f > 0) keyed.push([Math.log(rng.random() || 1e-12) / f, pid]);
  }
  keyed.sort((a, b) => cmp(b, a));
  const sampled = keyed.slice(0, recruiting.BOARD_FACTOR * recruiting.open_spots(state, slug)).map(([_, pid]) => pid);
  // blue-chip programs chase the best four- and five-stars nationally, ahead of the rest
  const tm = recruiting._team_model(slug);
  const n = (get(tm, "blue_chip_share") || 0) >= 0.25 ? round(recruiting.NATIONAL_TARGETS * (get(tm, "blue_chip_share") || 0.0)) : 0;
  // the school's star lift at each tier, once (the same expression the per-prospect lambda evaluated)
  const lift_at = {};
  for (const t of [4, 5]) lift_at[t] = get(get(tm, "star_share") || {}, get(recruiting.STAR_KEY, t, "2*"), 0.0) / recruiting._national_share(t);
  keyed = [];
  for (const pid of free) {
    const tier = tiers[pid];
    if (tier >= 4 && lift_at[tier] >= 1) {
      const p = pros[pid];
      const weight = lift_at[tier] * Math.exp(recruiting.NATIONAL_TILT * (p["composite"] - 0.9));
      keyed.push([Math.log(rng.random() || 1e-12) / weight, pid]);
    }
  }
  let national = keyed.slice().sort((a, b) => cmp(b, a)).slice(0, n).map(([_, pid]) => pid);
  if (truthy(recruiting.is_portal(state)) && truthy(recruiting._p4(slug))) {     // the portal: the best entrants hear from every Power 4 program
    national = sorted(free.filter((pid) => pros[pid]["rank"] <= recruiting.PORTAL_NATIONAL), (q) => pros[q]["rank"]).concat(national);
  }
  const board = _unique(national.concat(sampled));
  for (const pid of (truthy(touch) ? board : [])) {   // a board is prospects the staff has evaluated and spoken to: not cold, one priority known
    const c = recruiting._contact(state, slug, pid);
    if (!truthy(c["n"])) {
      c["n"] = 1;
      recruiting._reveal(state, slug, pid);
    }
  }
  return board;
}

/**
 * A school's week by the Auto-recruit rules: keep a board from its footprint and star level,
 * offer its best fits as the fall goes, invite top targets to home games, and spend the rest of
 * its hours on calls and messages pitching the priorities it knows, NIL on its top offers.
 * `yours`: your school on Auto-recruit works from your board (your picks first) and puts
 * everyone it recruits on your board, so you see what your staff are doing.
 */
function auto_recruit(state, slug, rng = null, commits = null, yours = false) {
  const persona = modules.persona;
  const rc = state["recruiting"];
  rng = rng || new Random(`auto-${rc["seed"]}-${slug}-${state["current_week"]}`);
  const week = state["current_week"];
  const spots_left = recruiting.open_spots(state, slug) - get(commits !== null && commits !== undefined ? commits : recruiting._commits(state), slug, 0);
  const live = (pid) => !truthy(rc["status"][pid]["signed"]) && (rc["status"][pid]["committed"] === null || rc["status"][pid]["committed"] === slug);
  const dropped = truthy(yours) ? new Set(get(rc, "dropped", [])) : new Set();      // ones you took off your board stay off
  const picks = truthy(yours) ? rc["board"].filter((pid) => live(pid)) : [];
  let board = _unique(picks.concat(get(rc["boards"], slug, []).filter((pid) => live(pid) && !dropped.has(pid))));
  if (spots_left > 0 && board.length < 2 * spots_left) {
    board = _unique(board.concat(recruiting._build_board(state, slug, rng).filter((pid) => !dropped.has(pid))));
  }
  if ((week >= recruiting.LATE_MARKET || truthy(recruiting.is_portal(state))) && spots_left > 0) {        // the late market: whoever is still out there is worth a look
    board = _unique(board.concat(recruiting._build_board(state, slug, rng).filter((pid) => !dropped.has(pid))));
  }
  if (!truthy(yours)) {                       // his story: its legacies first, its state's blue-chip heroes on the board
    const [front, back] = persona.board_front(state, slug);
    if (truthy(front) || truthy(back)) {
      board = _unique(Array.from(front).filter((pid) => live(pid)).concat(board, Array.from(back).filter((pid) => live(pid))));
    }
    if (truthy(get(rc, "twists")) && truthy(recruiting.academic(slug))) {       // a Grades Scare: the academic schools keep him off while it lasts
      board = board.filter((pid) => !truthy(persona.scared_off(state, slug, pid)));
    }
  }
  const [win_, offered_] = [recruiting._winning(state), recruiting.finalists_size(state) === null ? null : recruiting._offers_by_prospect(state)];
  board = board.filter((pid) => recruiting.blocked(state, slug, pid, win_, offered_) === null);   // one who will not consider the school, or has cut it, is off its board (part 6)
  rc["boards"][slug] = board;
  if (truthy(yours)) {
    const before = new Map();
    for (const [pid, by] of Object.entries(rc["contacts"])) if (has(by, slug)) before.set(pid, by[slug]["n"]);
    try {
      recruiting._auto_week(state, slug, rng, board, spots_left, week);
    } finally {                                // everyone your staff recruited this week shows on your board
      const worked = Object.entries(rc["contacts"]).filter(([pid, by]) => has(by, slug) && by[slug]["n"] !== (before.has(pid) ? before.get(pid) : null))
        .map(([pid, by]) => pid);
      for (const pid of Array.from(get(rc["offers"], slug, [])).concat(worked)) {
        if (!rc["board"].includes(pid) && !dropped.has(pid) && !truthy(rc["status"][pid]["signed"]) && rc["board"].length < recruiting.BOARD_CAP) rc["board"].push(pid);   // (never past the board's cap)
      }
    }
    return;
  }
  recruiting._auto_week(state, slug, rng, board, spots_left, week);
}

/** Auto-recruit's offers, visits and contacts for one school's week, best of its board first. */
function _auto_week(state, slug, rng, board, spots_left, week) {
  const persona = modules.persona;
  const rc = state["recruiting"];
  if (spots_left <= 0) {
    if (rc["races"] !== undefined) recruiting._react_idle(state, slug);     // its class is full: it is out of its races with you (part 7)
    return;
  }
  if (!has(rc["offers"], slug)) rc["offers"][slug] = [];
  const offers = rc["offers"][slug];
  const kept = recruiting.manual_offers(state, slug);          // your offers by hand: never pulled here (a signing elsewhere still ends one)
  const elsewhere = (q) => rc["status"][q]["committed"] !== null && rc["status"][q]["committed"] !== slug;
  const mine_or_free = (q) => rc["status"][q]["committed"] === null || rc["status"][q]["committed"] === slug;
  // its races with you (part 7): its offer to your soft commit stands while it is still calling him
  const pressed = rc["races"] !== undefined ? recruiting.racing(state, slug).filter((q) => rc["status"][q]["committed"] === get(state, "team")) : [];
  for (const pid of offers.filter((q) => elsewhere(q)
    && (truthy(rc["status"][q]["signed"]) || (rc["prospects"][q]["rank"] > recruiting.RIVAL_RANK && !_in(q, kept) && !pressed.includes(q))))) {
    _remove(offers, pid);                  // he went elsewhere: the offer frees up (a top prospect is still chased)
    recruiting._unmark(state, slug, pid);
    delete recruiting._nil(state, slug)["held"][pid];
  }
  const edge = 1 + recruiting._coach_edge(state, slug);
  const allowed = Math.ceil(recruiting.offer_cap(state, slug) * (truthy(recruiting.is_portal(state)) ? 1.0
    : Math.min(1.0, 0.35 + 0.65 * week / 8) * (week >= recruiting.LATE_MARKET ? recruiting.LATE_OFFERS : 1.0)));
  const budget = recruiting._nil(state, slug)["budget"];
  const known = get(rc["revealed"], slug, {});     // (unused)
  const win = recruiting._winning(state);
  // his ask as this staff reads it: an AI school its own number from him, as always; your staff on Auto only what
  // your scouting knows (known_ask: the number at a complete report, else the middle of the range you are shown)
  const ask_of = (q) => (slug === get(state, "team") ? recruiting.known_ask(state, slug, q) : recruiting.ask_from(state, slug, q, win));
  const need = recruiting.needs(state, slug), commits = recruiting.commits_by_group(state, slug);
  for (const pid of Array.from(offers)) {                   // a group at its cap: the open offers there are pulled (no more chasing flips), yours by hand kept
    if (!_in(pid, kept) && rc["status"][pid]["committed"] !== slug && !truthy(rc["status"][pid]["signed"])
        && !truthy(recruiting.is_generational(state, pid))
        && commits[recruiting._group_of(rc["prospects"][pid])] >= recruiting.group_cap(need, recruiting._group_of(rc["prospects"][pid]))) {   // a generational talent is never pulled for a full group
      _remove(offers, pid);
      delete recruiting._nil(state, slug)["held"][pid];
      recruiting._offer_gone(state, slug, pid, "group");
    }
  }
  const open_ = recruiting.offers_by_group(state, slug);
  for (const pid of board) {                          // its board's order (the board already leans to the thin groups); the caps hold
    if (offers.length >= allowed) break;
    if (!offers.includes(pid) && rc["status"][pid]["committed"] === null) {
      if (rc["races_out"] !== undefined && recruiting.gave_up(state, slug, pid)) continue;     // it gave up on him in a race with you (part 7)
      const p = rc["prospects"][pid];
      const g = recruiting._group_of(p);
      if (truthy(persona.ai_doubts(state, slug, pid))) continue;          // an Injury Comeback: this school doubts the knee
      if (truthy(recruiting.group_full(state, slug, g, need, commits, open_)) && !truthy(recruiting.portal_upgrade(state, slug, p))) continue;
      open_[g] += 1;
      const left = recruiting.nil_left(state, slug);
      const by_tier = round(budget * get(recruiting.AI_NIL, recruiting.tier_of(p), 0));
      const nil = Math.min(left, by_tier, round(recruiting.AI_OVER_ASK * ask_of(pid)));
      try {
        recruiting._act(state, slug, pid, "offer", recruiting.best_pitch(state, slug, pid, true), nil, edge);
      } catch (err) {
        _only_recruiting_error(err);
        break;
      }
      const mate = persona.mate(state, pid);                    // a Package Deal: his mate's offer comes with his
      if (truthy(mate) && !offers.includes(mate) && mine_or_free(mate) && !truthy(rc["status"][mate]["signed"])) {
        const q = rc["prospects"][mate];
        try {
          const pitch = recruiting.best_pitch(state, slug, mate, true);
          const mate_left = recruiting.nil_left(state, slug);
          const mate_tier = round(budget * get(recruiting.AI_NIL, recruiting.tier_of(q), 0));
          const mate_nil = Math.min(mate_left, mate_tier, round(recruiting.AI_OVER_ASK * ask_of(mate)));
          recruiting._act(state, slug, mate, "offer", pitch, mate_nil, edge);
          open_[recruiting._group_of(q)] += 1;
        } catch (err) {
          _only_recruiting_error(err);
        }
      }
    }
  }
  for (const pid of offers) {                          // asked for more: raise once to his ask, as the budget allows (your hand's NIL stays yours)
    if (_in(pid, kept)) continue;
    const c = recruiting._contact(state, slug, pid);
    if (truthy(get(c, "asked_more")) && !truthy(get(c, "ai_raised")) && mine_or_free(pid)) {
      const ask = ask_of(pid);
      const want = Math.min(ask, get(recruiting._nil(state, slug)["held"], pid, 0) + recruiting.nil_left(state, slug));
      c["ai_raised"] = true;
      if (want > get(recruiting._nil(state, slug)["held"], pid, 0)) {
        try {
          recruiting._act(state, slug, pid, "raise_nil", undefined, want, edge);
        } catch (err) {
          _only_recruiting_error(err);
        }
      }
    }
  }
  recruiting._react_week(state, slug, week);          // its answers to your recruiting come first (part 7; nothing without an offer of yours by hand)
  let targets = offers.filter((pid) => rc["status"][pid]["committed"] === null && !truthy(rc["status"][pid]["signed"]));
  targets = targets.concat(offers.filter((pid) => elsewhere(pid) && !truthy(rc["status"][pid]["signed"])));
  targets = targets.filter((pid) => recruiting.blocked(state, slug, pid) === null);    // he has cut the school from his list, or will not consider it
  for (const pid of targets.slice(0, 2)) {
    if (!has(get(rc["visits"], pid, {}), slug)) {
      try {
        recruiting._act(state, slug, pid, "official_visit");
      } catch (err) {
        _only_recruiting_error(err);
      }
    }
  }
  targets = targets.filter((pid) => !truthy(recruiting.would_pester(state, slug, pid)));   // your staff on Auto never pester: those hours go elsewhere
  if (targets.length) {
    try {
      recruiting._act(state, slug, targets[0], "hc_visit", recruiting.best_pitch(state, slug, targets[0]), undefined, edge, undefined, undefined, true);
    } catch (err) {
      _only_recruiting_error(err);
    }
  }
  for (const action of ["call", "message"]) {          // each target a call and a message a week, as the hours allow
    for (const pid of targets) {
      if (recruiting._hours(state, slug) < recruiting.HOURS[action]) break;
      try {
        recruiting._act(state, slug, pid, action, recruiting.best_pitch(state, slug, pid), undefined, edge, undefined, undefined, true);
      } catch (err) {
        _only_recruiting_error(err);
      }
    }
  }
  for (const pid of offers.filter((q) => rc["status"][q]["committed"] === slug && !truthy(rc["status"][q]["signed"]))) {
    if (recruiting._hours(state, slug) < recruiting.HOURS["message"]) break;   // out of hours: the commits go quiet this week and soften
    try {                                   // a message a week keeps a commitment firm
      recruiting._act(state, slug, pid, "message", recruiting.best_pitch(state, slug, pid), undefined, edge, undefined, undefined, true);
    } catch (err) {
      _only_recruiting_error(err);
    }
  }
}

/** Official visits at this week's home games: a win sells, a blowout loss hurts, a big crowd helps. */
function _visits(state, week) {
  const rc = state["recruiting"];
  const season = modules.season;
  for (const [pid, by_school] of Object.entries(rc["visits"])) {
    for (const [slug, v] of Object.entries(by_school)) {
      if (truthy(v["done"]) || v["week"] !== week) continue;
      let game = null;
      for (const g of Object.values(state["games"])) {
        if (g["week"] === week && g["home"] === slug && truthy(g["played"])) { game = g; break; }
      }
      v["done"] = true;
      if (game === null) continue;
      while (truthy(recruiting._reveal(state, slug, pid))) { /* a weekend on campus: you learn everything he cares about (his ask is your scouts' to learn) */ }
      recruiting._contact(state, slug, pid)["last_contact"] = week;
      delete recruiting._contact(state, slug, pid)["pester"];     // a weekend on campus clears the air
      const margin = game["home_score"] - game["away_score"];
      const mood = margin > 0 ? 1.2 : (margin <= -21 ? 0.6 : 0.9);
      const cap = (get(get(season.load_teams()[slug], "stadium") || {}, "capacity") || 50000);
      const crowd = Math.min(1.15, Math.max(0.85, cap / 80000));
      recruiting._add_points(state, slug, pid, recruiting.BASE_POINTS["official_visit"] * mood * crowd, "official_visit");
    }
  }
}

function _offers_by_prospect(state) {
  const out = odict();
  for (const [slug, pids] of Object.entries(state["recruiting"]["offers"])) {
    for (const pid of pids) {
      if (!has(out, pid)) out[pid] = [];
      out[pid].push(slug);
    }
  }
  return out;
}

/**
 * He commits (or flips) to the school. A Package Deal's mate comes with him the same week when the
 * school has offered him and he is free to move (not signed, not a hard commit elsewhere): returns
 * [mate, the school he left or null] when he moved, else null. His commit style: an Early Bird starts
 * firmer; a Quiet Commit's event is marked quiet (no news, no other school sees it); `extra` rides on
 * the event (a Hat Ceremony's hat).
 */
function _commit(state, pid, slug, kind = "commit", pair = true, extra = {}) {
  const persona = modules.persona;
  const rc = state["recruiting"];
  const old = rc["status"][pid]["committed"];
  const visited = truthy(get(get(get(rc["visits"], pid, {}), slug) || {}, "done"));
  const firm = visited ? recruiting.FIRM_VISIT : recruiting.FIRM_START;
  const firmness = slug !== "FCS" ? persona.start_firmness(state, pid, firm) : firm;
  Object.assign(rc["status"][pid], { committed: slug, fcs: false, firmness: firmness, hard: false });
  rc["commits_v"] = get(rc, "commits_v", 0) + 1;
  for (const [school, n] of Object.entries(rc["nil"])) {           // rivals' NIL packages for him are released
    if (school !== slug) delete n["held"][pid];
  }
  const hats = get(rc, "hats");
  if (truthy(hats)) delete hats[pid];
  recruiting._event(state, kind, pid, slug, { ...(truthy(old) ? { from: old } : {}), ...(slug !== "FCS" ? persona.quiet_mark(state, pid) : {}), ...extra });
  const mate = truthy(pair) && slug !== "FCS" ? persona.mate(state, pid) : null;
  if (!truthy(mate)) return null;
  const ms = rc["status"][mate];
  if (truthy(ms["signed"]) || ms["committed"] === slug || truthy(get(ms, "hard")) || !get(rc["offers"], slug, []).includes(mate)) return null;
  const was = ms["committed"] !== null && ms["committed"] !== "FCS" ? ms["committed"] : null;
  if (truthy(was)) recruiting._event(state, "decommit", mate, was, { ...persona.quiet_mark(state, mate) });
  recruiting._commit(state, mate, slug, truthy(was) ? "flip" : "commit", false);
  return [mate, was];
}

/**
 * This week's chance a commit flips, from the best rival's lead in interest and how firm he is.
 * A hard commit never flips.
 */
function flip_weekly(state, pid, gap, firmness = null) {
  const st = state["recruiting"]["status"][pid];
  if (truthy(get(st, "hard"))) return 0.0;
  if (firmness === null || firmness === undefined) firmness = get(st, "firmness") || recruiting.FIRM_START;
  if (firmness >= recruiting.HARD_AT) return 0.0;
  return 2 * recruiting.DECOMMIT_RATE * recruiting._logistic(gap / recruiting.FLIP_MARGIN) * (100 - firmness) / 100 * modules.persona.decommit_mult(state, pid);
}

/**
 * His chance to flip before signing day, his commitment firming up FIRM_TOUCH + FIRM_NIL a week
 * as a school that keeps in touch would see it, and locking hard at HARD_AT.
 */
function flip_by_signing(state, pid, gap, weeks_left) {
  const st = state["recruiting"]["status"][pid];
  if (truthy(get(st, "hard"))) return 0.0;
  let f = get(st, "firmness") || recruiting.FIRM_START;
  let keep = 1.0;
  for (let _ = 0; _ < Math.max(0, weeks_left); _++) {
    if (f >= recruiting.HARD_AT) break;
    keep *= 1 - Math.min(1.0, recruiting.flip_weekly(state, pid, gap, f));   // as a chance: a big rival lead never takes it over 1 (the odds stay non-negative)
    f = Math.min(100, f + recruiting.FIRM_TOUCH + recruiting.FIRM_NIL);
  }
  return 1 - keep;
}

/** An open promise: not broken, kept or closed yet. */
const _open_promise = (pr) => get(pr, "broken") === null && get(pr, "kept") === null && get(pr, "closed") === null;

/**
 * You pitched NIL in a call or visit. When NIL is his (a priority or his decider's topic), he has an ask and
 * nothing is held on him yet, you owe him a money promise (he never names his number: your scouts learn it, ask_known): NIL_PROMISE_SHARE of his ask on your offer within NIL_PROMISE_WEEKS (_promises), and the
 * History says so. Not on a call that keeps his priorities to himself (`tells` False: he gives nothing away), not on
 * a call that pestered him (`tired`: the pitch fell flat), and not in the portal (its weeks judge no promises).
 */
function _money_talk(state, slug, pid, contact, week, tells = true, tired = false) {
  if (!truthy(tells) || truthy(tired) || truthy(recruiting.is_portal(state)) || !truthy(modules.persona.counts_as_priority(state, pid, "nil"))) return;
  const ask = recruiting.ask_from(state, slug, pid);
  const held = get(get(get(state["recruiting"]["nil"], slug) || {}, "held", {}), pid, 0);
  if (!truthy(ask) || truthy(held)) return;
  if (!(get(contact, "promises") || []).some((pr) => pr["kind"] === "money" && _open_promise(pr))) {
    const scenes = modules.scenes;
    if (!has(contact, "promises")) contact["promises"] = [];
    contact["promises"].push({ kind: "money", about: { ask: ask }, week: week, broken: null, kept: null,
      offered: get(state["recruiting"]["offers"], slug, []).includes(pid), n: get(contact, "n", 0) });
    recruiting._event(state, "learned", pid, slug, { line: scenes.MONEY_OWED_LINE });
  }
}

/**
 * An open money promise as the page shows it: the NIL to put on your offer (NIL_PROMISE_SHARE of his ask, up to the
 * next NIL step) and the week it is due; null when there is none. The number is yours only once you know his ask
 * (ask_view: a complete report): before that `nil` is null and `sure` is the share of the top of the range you are
 * shown, which covers it whatever his number is.
 */
function money_owed(state, slug, pid) {
  const c = get(get(state["recruiting"]["contacts"], pid) || {}, slug) || {};
  const pr = (get(c, "promises") || []).find((x) => x["kind"] === "money" && _open_promise(x));
  if (pr === undefined) return null;
  const ask = Math.min(pr["about"]["ask"], recruiting.ask_from(state, slug, pid, undefined, true) || pr["about"]["ask"]);
  const by_week = pr["week"] + recruiting.NIL_PROMISE_WEEKS;
  const seen = recruiting.ask_view(state, slug, pid, true);
  if (!has(seen, "exact")) return { nil: null, sure: 5 * Math.ceil(recruiting.NIL_PROMISE_SHARE * seen["hi"] / 5), by_week };
  return { nil: 5 * Math.ceil(recruiting.NIL_PROMISE_SHARE * ask / 5), by_week };
}

/**
 * A money promise at the week step: kept once the offer holds NIL_PROMISE_SHARE of his ask (PACKAGE_KEPT lands,
 * promise_kept), broken after NIL_PROMISE_WEEKS without it (he cools; promise_broken, why "money"), closed with
 * neither once he is no longer yours to win (committed elsewhere, signed, an offer you made pulled, or, never offered,
 * taken off your board: you walked away). Never offered and not contacted since the pitch, it fades at the deadline;
 * it breaks only if you kept after him without an offer, or your offer came up short. The share reads his ask now when
 * it fell since the pitch. At a small school (MONEY_FORGIVE_TIER) he may let it go (MONEY_FORGIVE_CHANCE by his
 * personality, its own seeded draw); otherwise his line says whether nothing or too little reached the offer.
 */
function _money_promise(state, slug, pid, c, pr, week) {
  const scenes = modules.scenes, word = modules.word, persona = modules.persona;
  const rc = state["recruiting"];
  const st_ = rc["status"][pid];
  const offered = get(rc["offers"], slug, []).includes(pid);
  if (offered) pr["offered"] = true;
  const walked = !truthy(get(pr, "offered")) && slug === get(state, "team") && !(get(rc, "board") || []).includes(pid);   // you took him off your board
  if (truthy(st_["signed"]) || (truthy(st_["committed"]) && st_["committed"] !== slug) || (truthy(get(pr, "offered")) && !offered) || walked) {
    pr["closed"] = week;
    return;
  }
  const held = get(get(get(rc["nil"], slug) || {}, "held", {}), pid, 0);
  if (truthy(held) && held >= recruiting.NIL_PROMISE_SHARE * Math.min(pr["about"]["ask"], recruiting.ask_from(state, slug, pid) || pr["about"]["ask"])) {
    pr["kept"] = week;
    rc["lists"][pid][slug] = get(rc["lists"][pid], slug, 0.0) + persona.climbs(state, slug, pid, recruiting.PACKAGE_KEPT);
    recruiting._event(state, "promise_kept", pid, slug, { why: "money", line: scenes.MONEY_KEPT_LINE });
    word.recruit_event(state, slug, pid, "money_kept");
    return;
  }
  if (week - pr["week"] < recruiting.NIL_PROMISE_WEEKS) return;
  if (!offered && get(c, "n", 0) <= get(pr, "n", get(c, "n", 0))) {
    pr["closed"] = week;                          // no offer and no contact since the pitch: you went quiet, it fades
    return;
  }
  pr["broken"] = week;
  const kind = persona.of(state, pid)["personality"];
  const programs = modules.programs;
  if (programs.get(state, slug)["tier"] >= recruiting.MONEY_FORGIVE_TIER
      && new Random(`money-forgive-${rc["seed"]}-${slug}-${pid}-${week}`).random() < get(recruiting.MONEY_FORGIVE_CHANCE, kind, 0.0)) {
    recruiting._event(state, "promise_broken", pid, slug, { why: "money", forgiven: true,          // no cooling, no firmness lost
      line: get(scenes.MONEY_FORGIVEN_LINES, kind, scenes.MONEY_FORGIVEN_LINE) });
    return;
  }
  const line = get(scenes.MONEY_BROKEN_LINES[truthy(held) ? "short" : "none"], kind, scenes.MONEY_BROKEN_LINE);
  if (st_["committed"] === slug && !truthy(get(st_, "hard"))) {
    st_["firmness"] = int(Math.max(0, (get(st_, "firmness") || recruiting.FIRM_START) - recruiting.PROMISE_RIVAL));
  } else if (st_["committed"] !== slug) {
    c["cooled_until"] = week + recruiting.COOL_WEEKS;
    persona.set_cooled_why(state, slug, pid, "promise");
  }
  recruiting._event(state, "promise_broken", pid, slug, { why: "money", line: line });
  word.recruit_event(state, slug, pid, "money_broken");
}

/**
 * Promises follow him (spec section 4): a recruit told he was the one over another recruit
 * (a "recruit" promise) remembers when that recruit commits to the school too, once: committed
 * to the school, his firmness drops PROMISE_RIVAL (a hard commit is immune); otherwise he cools on
 * it for COOL_WEEKS. The promise is marked broken and a promise_broken event logged either way.
 * A Package Deal's mate promised an offer (a "package" promise) is kept the week step the mate
 * holds the school's offer, within PACKAGE_PROMISE_WEEKS of the promise (PACKAGE_KEPT points land
 * on his list, a promise_kept event with his line), and broken the same way as above once that
 * many weeks pass without it.
 */
function _promises(state, week) {
  const scenes = modules.scenes, word = modules.word, persona = modules.persona;
  const rc = state["recruiting"];
  for (const [pid, by] of Object.entries(rc["contacts"])) {
    for (const [slug, c] of Object.entries(by)) {
      for (const pr of (get(c, "promises") || [])) {
        if (!_open_promise(pr)) continue;
        if (pr["kind"] === "money") {
          recruiting._money_promise(state, slug, pid, c, pr, week);
          continue;
        }
        if (pr["kind"] !== "recruit" && pr["kind"] !== "package") continue;
        const st_ = rc["status"][pid];
        if (truthy(st_["signed"])) continue;
        const mate = get(pr["about"], "pid");
        if (pr["kind"] === "package") {
          if (get(rc["offers"], slug, []).includes(mate)) {
            pr["kept"] = week;
            rc["lists"][pid][slug] = get(rc["lists"][pid], slug, 0.0) + persona.climbs(state, slug, pid, recruiting.PACKAGE_KEPT);
            recruiting._event(state, "promise_kept", pid, slug, { about: pr["about"]["name"], other: mate,
              line: scenes.PROMISE_KEPT_LINE.split("{mate}").join(pr["about"]["name"]) });
            word.recruit_event(state, slug, pid, "package_kept");
            continue;
          }
          if (week - pr["week"] < recruiting.PACKAGE_PROMISE_WEEKS) continue;
        } else {
          const other = mate === null ? null : get(rc["status"], mate);
          if (!truthy(other) || (slug !== other["committed"] && slug !== other["signed"])) continue;
        }
        if (st_["committed"] === slug) {
          if (truthy(get(st_, "hard"))) continue;
          st_["firmness"] = int(Math.max(0, (get(st_, "firmness") || recruiting.FIRM_START) - recruiting.PROMISE_RIVAL));
        } else {
          c["cooled_until"] = week + recruiting.COOL_WEEKS;
          persona.set_cooled_why(state, slug, pid, "promise");
        }
        pr["broken"] = week;
        recruiting._event(state, "promise_broken", pid, slug, { about: pr["about"]["name"], other: mate, ...(pr["kind"] === "package" ? { why: "package" } : {}) });
        word.recruit_event(state, slug, pid, pr["kind"] === "package" ? "package_broken" : "recruit_broken");
      }
    }
  }
}

/**
 * Every verbal commitment firms up with the week: he warms to his school on his own
 * (FIRM_DRIFT), faster with contact from it (FIRM_TOUCH) and the NIL still held, and cools
 * when rivals in his top three offer more playing time. At HARD_AT he is a hard commit and
 * nothing moves him again.
 */
function _firm_up(state, week) {
  const persona = modules.persona;
  const rc = state["recruiting"];
  const win = recruiting._winning(state);
  const pressing = recruiting._pressing(state);       // your soft commits other schools are still calling (part 7), or null
  for (const [pid, st_] of Object.entries(rc["status"])) {
    const school = st_["committed"];
    if (truthy(st_["signed"]) || !truthy(school) || school === "FCS") continue;
    const c = get(get(rc["contacts"], pid) || {}, school) || {};
    if (truthy(persona.needs_attention(state, pid)) && recruiting._neglected(state, pid, school, c, week)) {
      continue;                                   // Needs Attention: a quiet week from his school costs him, hard commit or not
    }
    if (truthy(get(st_, "hard"))) continue;
    // (touch_week: your call or visit by hand is made before the step and lands this week, as a ticked message does)
    const touched = get(c, "last_contact") === week || get(c, "touch_week") === week;
    let delta = touched ? recruiting.FIRM_TOUCH : recruiting.FIRM_DRIFT;
    if (pressing !== null && has(pressing, pid)) delta -= recruiting._press_cost(state, pid, pressing[pid], week, touched);
    if (get(get(get(rc["nil"], school, {}), "held", {}), pid, 0) > 0 && get(rc["offers"], school, []).includes(pid)) delta += recruiting.FIRM_NIL;
    const rivals = recruiting.top_group(state, pid, win).filter((s) => s !== school && get(rc["offers"], s, []).includes(pid)).slice(0, recruiting.FIRM_RIVALS);
    if (rivals.length) {
      const mine = recruiting.strengths(state, school, pid)["playing_time"];
      let more = 0;
      for (const r of rivals) if (recruiting.strengths(state, r, pid)["playing_time"] > mine) more += 1;
      delta += recruiting.FIRM_RIVAL * more;
    }
    st_["firmness"] = int(Math.max(0, Math.min(100, get(st_, "firmness", recruiting.FIRM_START) + delta)));
    if (st_["firmness"] >= recruiting.HARD_AT) {
      st_["hard"] = true;
      recruiting._event(state, "hard", pid, school, { ...persona.quiet_mark(state, pid) });
    }
  }
}

/**
 * A Needs Attention commit his school has not been in touch with since the week before: his firmness
 * drops persona.NEEDS_DROP, hard commit or not, and persona.NEEDS_SILENT weeks of silence make a hard
 * commit flippable again (a "softened" event). True when it was such a week (no firming up then).
 */
function _neglected(state, pid, school, c, week) {
  const persona = modules.persona;
  const last = get(c, "last_contact");
  const silent = week - 1 - (last !== null ? last : week - 1 - persona.NEEDS_SILENT);
  if (silent < 1) return false;
  const st_ = state["recruiting"]["status"][pid];
  st_["firmness"] = int(Math.max(0, (get(st_, "firmness") || recruiting.FIRM_START) - persona.NEEDS_DROP));
  if (truthy(get(st_, "hard")) && silent >= persona.NEEDS_SILENT) {
    st_["hard"] = false;
    st_["firmness"] = Math.min(st_["firmness"], recruiting.HARD_AT - 1);
    recruiting._event(state, "softened", pid, school, { line: `He has not heard from ${persona._school_name(school)} in weeks, and his commitment is softening.`,
      ...persona.quiet_mark(state, pid) });
  }
  return true;
}

/** The key of `_class_by_position` for the tuple (school, position). */
const _pos_key = (school, position) => `${school}\u0000${position}`;

function _class_by_position(state) {
  const rc = state["recruiting"];
  const out = {};
  for (const [pid, st] of Object.entries(rc["status"])) {
    if (truthy(st["committed"]) && st["committed"] !== "FCS") {
      const p = rc["prospects"][pid];
      const k = recruiting._pos_key(st["committed"], p["position"]);
      if (!has(out, k)) out[k] = [];
      out[k].push(p["composite"]);
    }
  }
  return out;
}

/**
 * Where a school can still take a prospect: a spot in the class and room at his group (its
 * commits under the group's cap). Recruiting by hand, you may oversign a group you offered; in
 * the late market (`flier`: from LATE_MARKET and on signing day) every school takes one past a cap.
 * (A function that carries its instance: `room(slug, pid)` is `__call__`; made with or without `new`.)
 */
function _Room(state, flier = false) {
  const self = (slug, pid) => self.why_not(slug, pid) === null;
  self.state = state;
  self.commits = recruiting._commits(state);
  self.groups = {};
  self.slack = truthy(flier) ? 1 : 0;
  // (only a class you are recruiting by hand may oversign a group: on Auto-recruit, or in a week the game recruits
  // for you, your school is held to its room at each position as every other school is: the player's rule)
  self.yours = recruiting.auto_mode(state) === "off" && !recruiting._STEP_AUTO[0] ? get(state, "team") : null;
  self.portal = recruiting.is_portal(state);

  self._at = (slug) => {
    if (!has(self.groups, slug)) {
      const need = recruiting.needs(self.state, slug);
      self.groups[slug] = [need, recruiting.commits_by_group(self.state, slug)];
    }
    return self.groups[slug];
  };

  /**
   * The commits a school can hold. In the portal your signings already come off your portal
   * spots, and `commits` counts them too: your limit is your portal room, so each counts once
   * and the room the page shows is the room he sees. (An AI school's stays as it was.)
   */
  self._limit = (slug) => {
    if (truthy(self.portal) && slug === get(self.state, "team")) return recruiting.portal_room(self.state, slug);
    return recruiting.open_spots(self.state, slug);
  };

  /**
   * null when the school has room for him; "roster" when its class (in the portal: its roster)
   * is full, "group" when his position group is at its cap. `offered`: count the school's offer
   * as made (a board's "would he have room if you offered") instead of looking it up.
   */
  self.why_not = (slug, pid, offered = null) => {
    if (get(self.commits, slug, 0) >= self._limit(slug)) return "roster";
    if (offered === null || offered === undefined) offered = get(self.state["recruiting"]["offers"], slug, []).includes(pid);
    if (slug === self.yours && truthy(offered)) return null;                                 // you offered him: your call to oversign
    const [need, com] = self._at(slug);
    const p = self.state["recruiting"]["prospects"][pid];
    const g = recruiting._group_of(p);
    // a thin quarterback room (QB_THIN_NEED short of a full one) with no quarterback in the class yet: the class's
    // last spot is held for one (the player's rule: only the thin rooms; never a class you recruit by hand)
    if (g !== "QB" && !truthy(self.portal) && slug !== self.yours && com["QB"] === 0 && need["QB"] >= recruiting.QB_THIN_NEED
        && get(self.commits, slug, 0) >= self._limit(slug) - 1) return "roster";
    return com[g] < recruiting.group_cap(need, g) + self.slack || truthy(recruiting.portal_upgrade(self.state, slug, p)) ? null : "group";
  };

  self.__call__ = self;

  self.took = (slug, pid, n = 1) => {
    self.commits[slug] = get(self.commits, slug, 0) + n;
    self._at(slug)[1][recruiting._group_of(self.state["recruiting"]["prospects"][pid])] += n;
  };

  return self;
}

function _draws(state, week, rng) {
  const persona = modules.persona;
  const rc = state["recruiting"];
  const room = recruiting._Room(state, week >= recruiting.LATE_MARKET);
  const commits = room.commits;                 // (unused)
  const base = week < recruiting.COMMIT_FREEZE_WEEKS ? 0.0 : recruiting._interp(recruiting.COMMIT_ODDS, week);
  const win = recruiting._winning(state), offered = recruiting._offers_by_prospect(state), by_pos = recruiting._class_by_position(state);
  const hats = truthy(get(rc, "hats")) ? rc["hats"] : {};
  // the unpaid offer (part 7): the recruits who will not commit to you on your standing lowball, or null
  const unpaid = recruiting._unpaid(state), me = get(state, "team");
  const held_out = (s, pid) => unpaid !== null && s === me && unpaid.has(pid);

  /** His interest less the crowd: recruits already committed there at his position, rated at least as high. */
  const score = (slug, pid) => {
    const p = rc["prospects"][pid];
    let crowd = get(by_pos, recruiting._pos_key(slug, p["position"]), []).filter((c) => c >= p["composite"]).length;
    if (rc["status"][pid]["committed"] === slug) crowd -= 1;                                 // not himself
    return recruiting.interest(state, slug, pid, win) - recruiting.CROWD * crowd;
  };

  const moved = new Set();

  /** He went to the school: its room and its class at his position; his Package Deal mate too, when he came along. */
  const took = (slug, pid, pair) => {
    for (const [q, old] of [[pid, null]].concat(truthy(pair) ? [pair] : [])) {
      if (truthy(old)) room.took(old, q, -1);
      room.took(slug, q);
      const k = recruiting._pos_key(slug, rc["prospects"][q]["position"]);
      if (!has(by_pos, k)) by_pos[k] = [];
      by_pos[k].push(rc["prospects"][q]["composite"]);
    }
    if (truthy(pair)) moved.add(pair[0]);                         // they moved together: his mate's own draw waits a week
  };

  for (const pid of sorted(Object.keys(rc["prospects"]), (q) => rc["prospects"][q]["rank"])) {
    const st = rc["status"][pid];
    if (truthy(st["signed"]) || moved.has(pid)) continue;
    let scores = get(offered, pid, []).map((s) => [score(s, pid), s]).sort((a, b) => cmp(b, a));
    if (truthy(st["committed"]) && !truthy(get(st, "hard"))) {
      const mine = score(st["committed"], pid);
      let rival = null;
      for (const [v, s] of scores) {
        if (s !== st["committed"] && !held_out(s, pid) && room(s, pid) && truthy(recruiting._pair_ok(state, s, pid, offered, room))) { rival = [v, s]; break; }
      }
      if (rival !== null && rng.random() < recruiting.flip_weekly(state, pid, rival[0] - mine)) {
        room.took(st["committed"], pid, -1);
        recruiting._event(state, "decommit", pid, st["committed"], { ...persona.quiet_mark(state, pid) });
        took(rival[1], pid, recruiting._commit(state, pid, rival[1], "flip"));
      }
      continue;
    }
    scores = scores.filter(([v, s]) => !held_out(s, pid) && room(s, pid) && truthy(recruiting._pair_ok(state, s, pid, offered, room)));
    const lean_is_list = !scores.length && !(week >= recruiting.FCS_NO_OFFER_WEEK);
    // (a blue chip never leans FCS: a school he likes makes room for him on signing day, part 5 BLUE_CHIP_HOME)
    const lean = !(recruiting.BLUE_CHIP_HOME && !recruiting.is_portal(state) && recruiting.tier_of(rc["prospects"][pid]) >= 4)
      && ((!scores.length && week >= recruiting.FCS_NO_OFFER_WEEK) || (scores.length > 0 && scores[0][0] < recruiting.FCS_LINE));
    const fcs = st["fcs"];
    if (lean_is_list || !((typeof fcs === "boolean" || typeof fcs === "number") && Number(fcs) === Number(lean))) {
      st["fcs"] = lean;
      if (lean) recruiting._event(state, "leaning_fcs", pid);
    }
    if (!scores.length || lean) continue;
    const hat = get(hats, pid);                            // his Hat Ceremony: only his finalists can win, on the day he named
    if (truthy(hat)) scores = scores.filter(([v, s]) => hat[1].includes(s));
    const [top, leader] = scores.length ? scores[0] : [0.0, null];
    const lead = top - (scores.length > 1 ? scores[1][0] : 0.8 * top);
    const visited = get(get(get(rc["visits"], pid, {}), leader) || {}, "done");
    const style = persona.style(state, pid);
    const early = style === "early_bird" && persona.EARLY_WEEKS[0] <= week && week <= persona.EARLY_WEEKS[1];     // persona.commit_odds_mult
    const odds = Math.min(0.9, base * (0.5 + lead / recruiting.LEAD_SCALE) * (truthy(visited) ? recruiting.VISIT_BOOST : 1.0) * (early ? persona.EARLY_ODDS : 1.0));
    const roll = rng.random();                            // always drawn: his commit style never moves the stream
    if (truthy(hat)) {
      if (week >= hat[0]) {
        if (truthy(leader)) took(leader, pid, recruiting._commit(state, pid, leader, undefined, undefined, { hat: true }));
        else delete hats[pid];                            // none of his finalists can take him: he opens it back up
      }
      continue;
    }
    if (style === "signing_day") {
      if (week >= recruiting.early_signing_week()) {           // Signing Day: no one until the early signing day, then his leader, no roll (persona.waits, signs_now)
        took(leader, pid, recruiting._commit(state, pid, leader));
      }
      continue;
    }
    if (roll < odds) {
      if (style === "hat") {                         // a Hat Ceremony: he names a date and his finalists instead
        recruiting._hat(state, pid, week, scores.slice(0, persona.HAT_FINALISTS).map(([_, s]) => s));
        continue;
      }
      took(leader, pid, recruiting._commit(state, pid, leader));
    }
  }
}

Object.assign(recruiting, {
  _contact_land, _forgive_pesters, _reveal, _commits, signed_class, _rng, _event, _fit_all, _pool, _national_share, _fits,
  _build_board, auto_recruit, _auto_week, _visits, _offers_by_prospect, _commit, flip_weekly, flip_by_signing, _money_talk,
  money_owed, _money_promise, _promises, _firm_up, _neglected, _pos_key, _class_by_position, _Room, _draws,
});
