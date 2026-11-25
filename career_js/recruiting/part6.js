// Recruiting, part 6: what a recruit wants from a program (his standards, never shown), how well a program fits him,
// how he takes a pitch, when he will not consider a school at all, and his finalists.
//
// Every school grade is a letter (career_js/grades.js, SCHOOL_LINES). A recruit holds a standard, a letter, on each of
// his three priorities (and on his decider's topic). A program's case on a topic (its pull on him there, as a letter)
// against that standard decides four things, for every school, the AI's too:
//   - how he takes a pitch on the topic (reaction_kind: Sold, Lights Up, Listening, Lukewarm, Isn't Buying It);
//   - his interest in the school before anyone has worked him (interest adds fit_interest);
//   - how much a contact from the school is worth (move_mult; your quick actions: quick_mult);
//   - whether he will consider the school at all (locked_out).
// The standards are drawn from his own seeded stream and stored nowhere, so a save from before them plays on with the
// same recruits wanting the same things, and no view can send them.
//
// Every name of recruiting is reached through the `recruiting` namespace, whichever part defines it
// (engine_js/PORTING.md, "Big Files in Parts").
import { Random, sorted, get, truthy, int, round } from "../../engine_js/pyrt.js";
import { modules } from "../../engine_js/modules.js";
import { grades } from "../grades.js";
import { recruiting } from "../recruiting_ns.js";

const has = (d, k) => Object.prototype.hasOwnProperty.call(d, k);
const _key = (...parts) => JSON.stringify(parts);
const pystr = (v) => (v === null || v === undefined ? "None" : v === true ? "True" : v === false ? "False" : String(v));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ----- his standards -------------------------------------------------------------------------------------------

recruiting.STANDARD_TOP = { 5: "A", 4: "B", 3: "C", 2: "D" };   // *tune* what a typical recruit wants on his top priority, by stars
recruiting.STANDARD_DROP = { 5: [0, 1, 2], 4: [0, 1, 3], 3: [0, 2, 3], 2: [0, 1, 2] };   // *tune* how many grades easier his first, second and third priority are (a five-star holds real standards on all three)
recruiting.STANDARD_DECIDER_DROP = { 5: 2, 4: 3, 3: 3, 2: 2 };   // *tune* ... and his decider's topic, when it is not one of his three
recruiting.STANDARD_ODDS = { easier: 0.25, harder: 0.20 };       // *tune* how many recruits are a notch easier or harder to please than their stars say
recruiting.STANDARD_NOTCH = 3;                                   // *tune* a notch, in grades: a full letter (B to A, or B to C)
recruiting.STANDARD_LEAN = { cocky: 0.15, business: 0.05, shy: -0.15 };   // *tune* his personality moves those odds: this much from easier to harder (a Cocky recruit wants more, a Shy one less)
recruiting.STANDARD_JITTER = [-1, 0, 0, 1];                      // *tune* each standard lands a grade either side of its line this often (a plus or a minus)
recruiting.STANDARD_EASE = { proximity: 3 };                     // *tune* grades easier on a topic whatever his stars: nobody needs an A in Close to Home (under 70 miles)
recruiting.STANDARD_PORTAL_STEP = 1;                             // *tune* a transfer wants what a recruit this many stars lower would: he has seen college football and is after a fit
recruiting.STANDARD_RANGE = ["D-", "A+"];                        // *tune* no recruit wants less than the first or more than the last

// ----- what the standards do -----------------------------------------------------------------------------------

recruiting.FIT_SHORT_CAP = 9;            // *tune* a topic counts at most this many grades short (three letters) ...
recruiting.FIT_OVER_CAP = 3;             // *tune* ... and at most this many over (a letter): being far better than he asked is worth little more
recruiting.FIT_INTEREST = 0.25;          // *tune* interest points per grade of fit, before any contact (his list at week 0)
recruiting.FIT_CENTER = 0.5;             // *tune* the fit a school working a recruit usually has: interest and a contact's worth move around this
recruiting.FIT_INTEREST_RANGE = [-1.5, 0.75];   // *tune* the most the fit takes from or adds to his interest
recruiting.MOVE_PER_STEP = 0.07;         // *tune* a contact is worth this much more or less per grade of fit ...
recruiting.MOVE_FLOOR = 0.6;             // *tune* ... never under this share of its usual worth (a program far short of what he wants)
recruiting.MOVE_CEIL = 1.15;             // *tune* ... nor over this (a program well past it)
recruiting.QUICK_BASE = { message: 2.3, offer: 2.3, call: 1.0, call_recruit: 1.0 };   // *tune* your quick action's worth at a program that fits him as usual, in the action's base points
//                                          (a message and an offer by hand were worth 1 to 4 times their base by your grades: this is the middle)
recruiting.QUICK_PER_STEP = 0.12;        // *tune* your quick action (a message, a call, a video call from his row) is worth this much more or less per grade of fit ...
recruiting.QUICK_FLOOR = 0.5;            // *tune* ... never under this share ...
recruiting.QUICK_CEIL = 1.25;            // *tune* ... nor over this
// How he takes a pitch on one of his priorities: your letter there against what he wants, in grades (LETTER: 3).
recruiting.SOLD_FROM = 3;                // *tune* this many grades over what he wants (a full letter): He's Sold
recruiting.LISTENING_TO = 2;             // *tune* up to this many grades short (within a letter): He's Listening
recruiting.LUKEWARM_TO = 6;              // *tune* up to this many short (one to two letters): He's Lukewarm; further, or an F: He Isn't Buying It
recruiting.REACTIONS = ["sold", "hit", "fair", "lukewarm", "quiet"];       // best first: Sold, Lights Up, Listening, Lukewarm, Isn't Buying It
recruiting.REACTION_WORTH = { sold: 3.4, hit: 2.75, fair: 2.0, lukewarm: 1.3 };   // *tune* a pitch on one of his priorities, in the action's base points, by how he takes it
//                                          (it was 1 + 3 times your strength: 1.75 to 4); He Isn't Buying It costs BACKFIRE_COST
recruiting.PRESENT_WORTH = { sold: 2.0, hit: 1.75, fair: 1.5, lukewarm: 1.25 };  // *tune* your opening's share for each of his priorities, by how he takes it (it was 1 + your strength)
recruiting.LOCKOUT_AT = 3.5;             // *tune* a program this many grades short of what he wants, over his priorities, is one he will not consider (it was 5.0: the player's ask, more recruits shut the door)
recruiting.LOCKOUT_WINNING = 1.0;        // *tune* a season going well or badly moves that by up to this many grades (a lockout near the edge lifts when you win)
// His finalists: from these weeks he has cut his list to his top this many (the schools that offered or worked him, by
// interest), and a school not on it cannot work him or add him. Before the first he is open to anyone.
recruiting.FINALISTS = [[10, 5], [13, 3]];                // *tune* (from this week, his top this many); only a recruit who holds an offer cuts his list
recruiting.LOCKOUT_ON = true;                            // shutting a school out for its grades (locked_out); a test of the lists alone turns it off
// His list of ten as the class opens (tens): the schools that would recruit a player like him (each school's best
// LIST_REACH fits: its footprint, the stars it signs, his position), the ten of them he likes most.
recruiting.LIST_MIN = 6;                                 // *tune* a recruit fewer schools than this would chase has no list (a school was 1st of 3 for dozens of recruits nobody else wanted: the academies most, whose footprint is the whole country)
recruiting.LIST_REACH = [150, 400];                      // *tune* how many recruits a school is a candidate for: the least prestigious program, the most
recruiting.PORTAL_FINALISTS = [[4, 5]];                  // *tune* the same in the portal, by its week: his top five in its last week (an earlier or
//                                                          tighter cut sends the cut schools' offers to everyone else, and too many transfers find a school)
recruiting.LOCKED_TEXT = "He will not consider your program: it is too far from what he wants.";

recruiting._STANDARDS = new Map();       // (seed, portal, prospect, tier, priorities, decider's topic, personality) -> his standards
recruiting._FORCED_STANDARDS = new Map();   // tests: (career, prospect) -> {topic: letter}
recruiting._FIT = new Map();             // (career, class, prospect, school, moved) -> the parts of the fit that hold all season


function _draw_standards(seed, portal, pid, tier, priorities, decider_topic, personality) {
  // His standards, drawn once from his own stream: {topic: grade's place}. The draws are the same four whatever he
  // is, so nothing about him changes another's.
  const rng = new Random(`standards-${pystr(seed)}-${portal ? "portal-" : ""}${pystr(pid)}`);
  const t = clamp(tier, 2, 5);
  const lean = get(recruiting.STANDARD_LEAN, personality, 0.0);
  const easier = clamp(recruiting.STANDARD_ODDS["easier"] - lean, 0.0, 1.0), harder = clamp(recruiting.STANDARD_ODDS["harder"] + lean, 0.0, 1.0);
  const u = rng.random();
  const shift = u < easier ? -recruiting.STANDARD_NOTCH : u < easier + harder ? recruiting.STANDARD_NOTCH : 0;
  const jitter = [];
  for (let i = 0; i < 4; i++) jitter.push(rng.choice(recruiting.STANDARD_JITTER));
  const top = grades.place(recruiting.STANDARD_TOP[t]);
  const [lo, hi] = recruiting.STANDARD_RANGE.map((g) => grades.place(g));
  const at = (topic, drop, j) => clamp(top - drop + shift + j - get(recruiting.STANDARD_EASE, topic, 0), lo, hi);
  const out = {};
  const drops = recruiting.STANDARD_DROP[t];
  priorities.slice(0, 3).forEach((topic, i) => { out[topic] = at(topic, drops[i], jitter[i]); });
  if (decider_topic !== null && decider_topic !== undefined && !has(out, decider_topic)) {
    out[decider_topic] = at(decider_topic, recruiting.STANDARD_DECIDER_DROP[t], jitter[3]);
  }
  return out;
}


function standards(state, pid) {
  // What he wants from a program on each of his priorities (and his decider's topic): {topic: a grade's place on
  // grades.ORDER}. Read only and stored nowhere: his fixed draw, kept in memory. INTERNAL: no view sends it.
  const rc = state["recruiting"];
  if (recruiting._FORCED_STANDARDS.size) {
    const forced = recruiting._FORCED_STANDARDS.get(_key(state["id"], pid));
    if (forced !== undefined) return Object.fromEntries(Object.entries(forced).map(([t, g]) => [t, grades.place(g)]));
  }
  const p = rc["prospects"][pid];
  const d = modules.persona.of(state, pid);
  const portal = truthy(get(rc, "portal"));
  const tier = recruiting.tier_of(p) - (portal ? recruiting.STANDARD_PORTAL_STEP : 0);        // (a transfer's standing is read from his overall)
  const key = _key(get(rc, "seed", 0), portal, pid, tier, p["priorities"], d["decider_topic"], d["personality"]);
  let out = recruiting._STANDARDS.get(key);
  if (out === undefined) {
    if (recruiting._STANDARDS.size > 200_000) recruiting._STANDARDS.clear();
    out = _draw_standards(get(rc, "seed", 0), portal, pid, tier, p["priorities"], d["decider_topic"], d["personality"]);
    recruiting._STANDARDS.set(key, out);
  }
  return out;
}


class forced_standards {
  // A test's lever, as forced_strength: __enter__() ... __exit__(). `wants`: {topic: letter}.

  constructor(state, pid, wants) {
    this.key = _key(state["id"], pid);
    this.wants = wants;
  }

  __enter__() {
    recruiting._FORCED_STANDARDS.set(this.key, this.wants);
    recruiting._FIT.clear();
    recruiting._STATIC.clear();
  }

  __exit__(...exc) {
    recruiting._FORCED_STANDARDS.delete(this.key);
    recruiting._FIT.clear();
    recruiting._STATIC.clear();
  }
}


function standard_of(state, pid, topic) {
  // His standard on a topic (a grade's place): one of his, or for any other topic his easiest.
  const st = recruiting.standards(state, pid);
  if (has(st, topic)) return st[topic];
  const all = Object.values(st);
  return all.length ? Math.min(...all) : grades.place(recruiting.STANDARD_RANGE[0]);
}


// ----- the fit ---------------------------------------------------------------------------------------------------

function _gap(place, wants) {
  return clamp(place - wants, -recruiting.FIT_SHORT_CAP, recruiting.FIT_OVER_CAP);
}


function _season_pulls(state, slug, pid, key) {
  // The school's pulls on him that hold all season (strengths keeps the same answers in the same cache, by `key`).
  let static_ = recruiting._PULLS.get(key);
  if (static_ === undefined) {
    if (recruiting._PULLS.size > 2_000_000) recruiting._PULLS.clear();
    static_ = recruiting.pull(state, slug, pid, false);
    recruiting._PULLS.set(key, static_);
  }
  return static_;
}


function _forced_pulls(state, slug, pid, pulls) {
  // A test's forced strengths (forced_strength) count in the fit as they do in a pitch.
  if (!recruiting._FORCED.size) return pulls;
  const out = { ...pulls };
  for (const [k, v] of recruiting._FORCED) {
    const [sid, s_, p_, topic] = JSON.parse(k);
    if (sid === state["id"] && s_ === slug && p_ === pid) out[topic] = v;
  }
  return out;
}


function fit(state, slug, pid, win = null, key = null) {
  // How well the program fits what he wants, in grades: its letter on each of his priorities against his standard
  // there (short by at most FIT_SHORT_CAP, over by at most FIT_OVER_CAP), his first priority weighing most
  // (PRIORITY_WEIGHTS). 0 meets him; negative is short. The program's case here is its standing pull on him (what
  // the program is: its NIL grade, not this week's money), with this season's winning as it stands.
  // `key`: the season cache's key for him and the school, when the caller already has it (interest).
  const forced = recruiting._FORCED.size > 0 || recruiting._FORCED_STANDARDS.size > 0;
  if (key === null) {
    const rc = state["recruiting"], mv = get(rc, "moved");
    key = _key(state["id"], recruiting._ck(rc), pid, slug, truthy(mv) && (Array.isArray(mv) ? mv.includes(pid) : has(mv, pid)));
  }
  let parts = forced ? undefined : recruiting._FIT.get(key);
  if (parts === undefined) {
    const pulls = _forced_pulls(state, slug, pid, _season_pulls(state, slug, pid, key));
    const p = state["recruiting"]["prospects"][pid];
    const wants = recruiting.standards(state, pid);
    let fixed = 0.0, total = 0.0, win_w = 0.0, win_wants = 0, win_forced = null;
    const more = [];                 // his other priorities that move every week (Contender, Recruiting): [topic, weight, what he wants]
    const n = Math.min(p["priorities"].length, recruiting.PRIORITY_WEIGHTS.length);
    for (let i = 0; i < n; i++) {
      const t = p["priorities"][i], w = recruiting.PRIORITY_WEIGHTS[i];
      total += w;
      if (t !== "winning" && recruiting.WEEKLY.includes(t) && !has(pulls, t)) {
        more.push([t, w, get(wants, t, 0)]);
      } else if (t === "winning" && !has(pulls, "winning")) {
        win_w = w; win_wants = get(wants, t, 0);
      } else if (t === "winning" && forced) {
        win_w = w; win_wants = get(wants, t, 0); win_forced = pulls["winning"];
      } else {
        fixed += w * _gap(grades.place(grades.school_pull(clamp(get(pulls, t, 0.0), 0.0, 1.0))), get(wants, t, 0));
      }
    }
    parts = [fixed, total, win_w, win_wants, win_forced, more];
    if (!forced) {
      if (recruiting._FIT.size > 2_000_000) recruiting._FIT.clear();
      recruiting._FIT.set(key, parts);
    }
  }
  const [fixed0, total, win_w, win_wants, win_forced, more] = parts;
  if (!total) return 0.0;
  let fixed = fixed0;
  if (more && more.length) {         // this week's standing on them
    const wk = recruiting.weekly(state);
    for (const [t, w, wants] of more) fixed += w * _gap(grades.place(grades.school_pull(clamp(get(wk[t], slug, 0.5), 0.0, 1.0))), wants);
  }
  if (!win_w) return fixed / total;
  const w = win_forced !== null ? win_forced : Math.min(1.0, get(win !== null && win !== undefined ? win : recruiting._winning(state), slug, 0.5));
  return (fixed + win_w * _gap(grades.place(grades.school_pull(w)), win_wants)) / total;
}


function fit_interest(state, slug, pid, win = null, key = null) {
  // What the fit adds to (or takes from) his interest in the school, list points aside.
  const [lo, hi] = recruiting.FIT_INTEREST_RANGE;
  return clamp(recruiting.FIT_INTEREST * (recruiting.fit(state, slug, pid, win, key) - recruiting.FIT_CENTER), lo, hi);
}


function move_mult(state, slug, pid) {
  // How much a contact from the school moves him, against a program that fits him as usual: the bigger the
  // shortfall, the less (MOVE_FLOOR at least, MOVE_CEIL at most).
  return clamp(1.0 + recruiting.MOVE_PER_STEP * (recruiting.fit(state, slug, pid) - recruiting.FIT_CENTER), recruiting.MOVE_FLOOR, recruiting.MOVE_CEIL);
}


function quick_mult(state, slug, pid) {
  // Your quick action's blanket scale (a message, a call or a video call from his row, no topic chosen): the fit,
  // between QUICK_FLOOR and QUICK_CEIL.
  return clamp(1.0 + recruiting.QUICK_PER_STEP * (recruiting.fit(state, slug, pid) - recruiting.FIT_CENTER), recruiting.QUICK_FLOOR, recruiting.QUICK_CEIL);
}


// ----- a pitch's reaction ----------------------------------------------------------------------------------------

function reaction_kind(state, slug, pid, topic, strength = null) {
  // How he takes a pitch on one of his priorities (or his decider's topic): your letter there against what he wants.
  // "sold" a full letter or more over; "hit" (he lights up) meets it; "fair" (he is listening) a little short;
  // "lukewarm" one to two letters short; "quiet" (he isn't buying it) further than that, or an F whatever he wants.
  const sv = strength !== null && strength !== undefined ? strength : recruiting.strengths(state, slug, pid)[topic];
  const letter = grades.school_pull(sv);
  if (sv < recruiting.BACKFIRE) return "quiet";
  const d = grades.place(letter) - recruiting.standard_of(state, pid, topic);
  if (d >= recruiting.SOLD_FROM) return "sold";
  if (d >= 0) return "hit";
  if (d >= -recruiting.LISTENING_TO) return "fair";
  if (d >= -recruiting.LUKEWARM_TO) return "lukewarm";
  return "quiet";
}


function best_reaction(kinds) {
  // The best of several reactions (your opening's: the best of his that you pitched decides it).
  let best = null;
  for (const k of kinds) if (best === null || recruiting.REACTIONS.indexOf(k) < recruiting.REACTIONS.indexOf(best)) best = k;
  return best;
}


function case_letters(state, slug, pid, known = true) {
  // The program's case with him on every topic, as letters (what the page shows; `known`: his ask as you know it, so
  // the NIL letter never tells his number).
  const out = {};
  for (const [t, v] of Object.entries(recruiting.strengths(state, slug, pid, known))) out[t] = grades.school_pull(v);
  return out;
}


// ----- the lockout and his finalists -----------------------------------------------------------------------------

function locked_out(state, slug, pid, win = null) {
  // He will not consider the school: it is LOCKOUT_AT grades or more short of what he wants over his priorities
  // (the fit), a good season counting for it and a bad one against (LOCKOUT_WINNING). Never the school he committed
  // to, signed with or visited. From week 0; it lifts when the program's case improves.
  if (!recruiting.LOCKOUT_ON || truthy(recruiting._pester_exempt(state, slug, pid))) return false;
  const w = Math.min(1.0, get(win !== null && win !== undefined ? win : recruiting._winning(state), slug, 0.5));
  return recruiting.fit(state, slug, pid, win) + recruiting.LOCKOUT_WINNING * (2 * w - 1) <= -recruiting.LOCKOUT_AT;
}


function finalists_size(state) {
  // How many schools his list is cut to this week; null while he is still open to anyone.
  const rc = state["recruiting"];
  const portal = truthy(get(rc, "portal"));
  const week = portal ? get(rc, "week", 1) : get(state, "current_week", 0);
  let size = null;
  for (const [from, n] of (portal ? recruiting.PORTAL_FINALISTS : recruiting.FINALISTS)) if (week >= from) size = n;
  return size;
}


function top_size(state, pid = null) {
  // His list's size this week: TOP_GROUP until he cuts his list, then his finalists'. With `pid`: his own, and a
  // recruit nobody has offered has not cut his list.
  const n = recruiting.finalists_size(state);
  if (n === null || (pid !== null && !recruiting.has_offer(state, pid))) return recruiting.TOP_GROUP;
  return Math.min(n, recruiting.TOP_GROUP);
}


function has_offer(state, pid, offered = null) {
  // Whether any school has offered him. `offered`: every prospect's offers (_offers_by_prospect), when the caller has them.
  if (offered !== null) return truthy(get(offered, pid)) && [...get(offered, pid)].length > 0;
  for (const pids of Object.values(state["recruiting"]["offers"])) if (pids.includes(pid)) return true;
  return false;
}


recruiting._NO_TENS = {};               // the portal's: a transfer has no list of ten
recruiting._TENS = [null, null];         // (career and class, every recruit's ten) worked out in this sitting, for a class that has none stored

function tens(state) {
  // Every recruit's list of ten schools as his class opened, his favorite first: {pid: [school, ...]}. A school is a
  // candidate for the LIST_REACH recruits it fits best (what its own board is drawn from: _fits), more of them the more
  // prestigious the program; he keeps the ten candidates he likes most (interest: the school's grades by what he
  // wants, home counting for a recruit who wants to stay near it). So a small school is on few lists, mostly recruits
  // near it, and a recruit few schools would chase (under LIST_MIN) has none. Stored with the class (keep_tens); a class
  // from before lists has it worked out as it stands, in memory. The portal has none: a transfer's list is who is
  // recruiting him.
  const rc = state["recruiting"];
  const kept = rc["tens"];
  // (asked for every prospect on a page: never `truthy` here, which counts the class's lists each time, 0.6 seconds a page)
  if (kept !== null && kept !== undefined) return kept;
  if (truthy(get(rc, "portal"))) return recruiting._NO_TENS;
  const key = `${state["id"]}|${recruiting._ck(rc)}`;
  if (recruiting._TENS[0] === key) return recruiting._TENS[1];
  const teams = modules.season.load_teams();
  const schools = recruiting.fbs_schools(state);
  const prestige = schools.map((s) => Number(get(teams[s], "prestige") || 0));
  const lo = Math.min(...prestige), span = Math.max(1e-9, Math.max(...prestige) - lo);
  const [few, many] = recruiting.LIST_REACH;
  const cand = {};
  schools.forEach((s, i) => {
    const reach = int(round(few + (many - few) * (prestige[i] - lo) / span));
    const best = Object.entries(recruiting._fits(state, s)).filter(([, f]) => f > 0).sort((a, b) => b[1] - a[1]).slice(0, reach);
    for (const [pid] of best) (cand[pid] || (cand[pid] = [])).push(s);
  });
  const win = recruiting._winning(state);
  const out = {};
  for (const pid of Object.keys(rc["prospects"])) {
    const c = cand[pid];
    if (!c) continue;
    const rows = c.filter((s) => !recruiting.locked_out(state, s, pid, win)).map((s) => [recruiting.interest(state, s, pid, win), s]);   // (never a school he will not consider)
    if (rows.length < recruiting.LIST_MIN) continue;        // too few schools would chase him to make a list: he is open to everyone
    rows.sort((a, b) => (b[0] - a[0]) || (a[1] < b[1] ? -1 : 1));
    out[pid] = rows.slice(0, recruiting.TOP_GROUP).map(([, s]) => s);
  }
  recruiting._TENS = [key, out];
  return out;
}


function keep_tens(state) {
  // Store the class's lists of ten with it (a class start, and the first week step of a class from before lists).
  const rc = state["recruiting"];
  if ((rc["tens"] === null || rc["tens"] === undefined) && !truthy(get(rc, "portal"))) rc["tens"] = recruiting.tens(state);
}


function his_list(state, pid, win = null, offered = null) {
  // His list today, his favorite first: the schools of his ten and the schools that have offered or worked him, the
  // TOP_GROUP of them he likes most; once he has cut it (he holds an offer, from the weeks in FINALISTS), his finalists.
  if (recruiting.finalists_size(state) !== null && recruiting.has_offer(state, pid, offered)) return recruiting.top_group(state, pid, win);
  const schools = _suitors(state, pid, offered);
  for (const s of get(recruiting.tens(state), pid) || []) schools.add(s);
  win = win !== null && win !== undefined ? win : recruiting._winning(state);
  const rows = [...schools].map((s) => [recruiting.interest(state, s, pid, win), s]);
  rows.sort((a, b) => (b[0] - a[0]) || (a[1] < b[1] ? -1 : 1));
  return rows.slice(0, recruiting.TOP_GROUP).map(([, s]) => s);
}


function list_place(state, slug, pid, win = null, offered = null) {
  // The school's place on his list (1 the favorite), or null: it is not on it. A school that is not one of his ten
  // and has not offered or worked him is never on it (asked first: the Prospects page asks this of the whole class).
  const rc = state["recruiting"];
  if (!(get(recruiting.tens(state), pid) || []).includes(slug) && get(rc["lists"][pid], slug) === null
    && !get(rc["offers"], slug, []).includes(pid) && get(get(get(rc, "pending") || {}, pid, {}), slug) === null) return null;
  const i = recruiting.his_list(state, pid, win, offered).indexOf(slug);
  return i < 0 ? null : i + 1;
}


function _suitors(state, pid, offered = null) {
  // The schools that have offered or worked him (the set top_group reads, in its order). `offered`: every
  // prospect's offers (_offers_by_prospect), when the caller has them.
  const rc = state["recruiting"];
  const schools = new Set(Object.keys(rc["lists"][pid]));
  if (offered !== null) for (const s of get(offered, pid) || []) schools.add(s);
  else for (const [s, pids] of Object.entries(rc["offers"])) if (pids.includes(pid)) schools.add(s);
  for (const s of Object.keys(get(get(rc, "pending") || {}, pid, {}))) schools.add(s);
  return schools;
}


function cut_out(state, slug, pid, offered = null) {
  // He has cut his list to his finalists and the school is not one: his list is full (as many suitors as his
  // finalists) and the school is outside his top group. Never the school he committed to or signed with.
  const n = recruiting.finalists_size(state);
  if (n === null) return false;
  if (!recruiting.has_offer(state, pid, offered)) return false;        // nobody has offered him: he has not cut his list
  const st = state["recruiting"]["status"][pid];
  if (st["committed"] === slug || st["signed"] === slug) return false;
  const schools = _suitors(state, pid, offered);
  if (!schools.has(slug)) return schools.size >= n;
  if (schools.size <= n) return false;
  return !recruiting.top_group(state, pid).includes(slug);
}


function blocked(state, slug, pid, win = null, offered = null) {
  // Why the school cannot work him or put him on its board, or null: he has signed (elsewhere), he will not consider
  // it (locked_out), or he has cut his list and it is not on it (cut_out). {why, text}: the text is a plain sentence.
  const rc = state["recruiting"];
  const st = get(rc["status"], pid);
  if (!truthy(st)) return null;
  if (truthy(st["signed"])) {
    if (st["signed"] === slug) return null;
    const where = st["signed"] === "FCS" ? "an FCS school" : recruiting.school_name(st["signed"]);
    return { why: "signed", text: `He has signed with ${where}.` };
  }
  if (recruiting.locked_out(state, slug, pid, win)) return { why: "locked", text: recruiting.LOCKED_TEXT };
  if (recruiting.cut_out(state, slug, pid, offered)) {
    return { why: "finalists", text: `He has cut his list to his top ${recruiting.finalists_size(state)}, and you are not on it.` };
  }
  return null;
}


Object.assign(recruiting, {
  _draw_standards, standards, forced_standards, standard_of, fit, fit_interest, move_mult, quick_mult, reaction_kind,
  best_reaction, case_letters, locked_out, finalists_size, top_size, cut_out, blocked,
  has_offer, tens, keep_tens, his_list, list_place,
});
