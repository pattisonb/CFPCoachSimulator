// Recruiting, part 7: the other schools answer your recruiting, and the unpaid offer.
//
// Recruiting by hand was unopposed: every other school worked its own board whatever you did. Here a school that is
// in the race for a recruit YOU OFFERED BY HAND answers when you pass it on his list, book his visit or take his
// commitment, and stays on him until he is decided or it is too far behind:
//       (only while you are a contender for him: in his top REACT_TOP, or holding his visit or his commitment; and at
//       most REACT_RACE_MAX schools at a time, the ones he likes best first)
//   R1  it answers and stays: a NIL raise to his ask (once), a visit invite, a head-coach visit, a call, a message;
//   R2  short of money for the raise, it pulls its offers to recruits it has no chance on, worst first;
//   R3  trailing you by too much it gives up: its offer is pulled and it does not come back;
//   R4  a school with him on its board and no offer out makes the offer;
//   R5  your offer to a blue chip few blue-chip programs are on puts him on the board of the best-fitting one;
//   R6  it keeps calling your soft commit, and a week it reached him and you did not costs him firmness.
//
// The gate is strict: nothing here runs, draws or writes unless you have an offer out by hand
// (`recruiting.manual_offers`), so a career without one plays exactly as it did. Everything a school does goes through
// `_act`, the one action path, from its own hours and NIL under the same weekly and monthly rules, and a school the
// recruit has locked out or cut cannot act on him (`_act` refuses it). Never on a Quiet Commit, a hard commit or a
// signed recruit. Not in the transfer portal (its four weeks are decisions, not races).
// REACT_LEVEL is the one difficulty knob: 0 is the game without reactions.
//
// New state, absent from an older save and read with defaults: rc["races"] = {school: [prospect]} (the schools in
// the race), rc["races_out"] = {school: [prospect]} (the ones that gave up), rc["mapped"] = {prospect: [school]}
// (R5), and on a school's contact with him `react_nil` (its one raise is made), `react_press` (told once) and
// `mapped`. Your own contact carries `touch_week`: the week a contact you made by hand lands (`_firm_up`).
//
// Every name of recruiting is reached through the `recruiting` namespace, whichever part defines it
// (engine_js/PORTING.md, "Big Files in Parts").
import { Random, round, get, truthy, cmp } from "../../engine_js/pyrt.js";
import { modules } from "../../engine_js/modules.js";
import { recruiting } from "../recruiting_ns.js";

const has = (d, k) => Object.prototype.hasOwnProperty.call(d, k);

recruiting.REACT_LEVEL = 1.0;            // *tune* the one knob: 0 no reactions, 1 the first step, 2 hard (it scales REACT_BASE, REACT_MAX and REACT_PRESS, and adds one to REACT_CHAIN and REACT_HC from 2)
recruiting.REACT_BASE = 0.6;             // *tune* the weekly chance a school answers you, for a five-star at a position it needs
recruiting.REACT_TIER = { 5: 1.0, 4: 0.85, 3: 0.3, 2: 0.1 };   // *tune* ... times this by his stars
recruiting.REACT_TOP = 3;                // *tune* a school answers you passing it only while you stand in his top this many offering schools (a visit you booked or his commitment always counts)
recruiting.REACT_REACH = 20.0;           // *tune* ... and only a school that trails you by no more than this much interest
recruiting.REACT_RACE_MAX = 3;           // *tune* the most schools in a race with you for one recruit at a time (the best placed with him first)
recruiting.REACT_GIVE_UP = 35.0;         // *tune* trailing you by more than this it gives up on him
recruiting.REACT_MAX = 3;                // *tune* the recruits a school answers on in one week
recruiting.REACT_HC = 1;                 // *tune* the head-coach visits a week it spends on an answer
recruiting.REACT_DROP_BEHIND = 10.0;     // *tune* short of money for the raise, it pulls its offers to recruits it trails by more than this
recruiting.REACT_CHAIN = 1;              // *tune* your by-hand offer to a four- or five-star puts him on the boards of this many more programs that sign his level ...
recruiting.REACT_CHAIN_MIN = 3;          // *tune* ... while fewer than this many such programs offer him
recruiting.REACT_PRESS = 4;              // *tune* the firmness your soft commit loses in a week a school pressing him reached him and you did not
recruiting._REACT_OPEN = [null, null, {}];   // (career, week, who may join a race this week): made each week, never saved
recruiting.UNPAID_HOLD = true;           // *tune* the unpaid offer: a recruit does not commit to you on a standing lowball (false: he can, as before) ...
recruiting.UNPAID_STARS = 4;             // *tune* ... a recruit of this many stars or more, whoever else is on him; one under it only while another school offers him
recruiting.UNPAID_RIVAL = "offer";       // *tune* ... ("offer": any other school's offer counts; "paid": only one paying him real money)
recruiting.UNPAID_FIT = 2.5;             // *tune* ... unless your program is this many grades over what he wants (his standards, part 6): a program he dreams of can lowball him

const _AFTER = { lead: "after you took the lead", passed: "after you moved past it on his list", visit: "after you booked his visit", commit: "after he committed to you",
  map: "after your offer put him on the map", offer: "after your offer" };
const _KNOWN_RANK = 100;                 // a recruit ranked this high was on the map already: the line says "after your offer"


function _react_mine(state) {
  // The recruits you have an offer out to by hand, or null when nothing here applies: reactions are off, it is the
  // portal, or you have none. (Read from the marks themselves: no set is made for a career that has none.)
  if (!(recruiting.REACT_LEVEL > 0)) return null;
  const rc = state["recruiting"];
  if (truthy(get(rc, "portal")) || !truthy(get(state, "team"))) return null;
  const marks = get(rc, "manual_offers");
  if (!truthy(marks) || !marks.length) return null;
  return new Set(marks);
}


function racing(state, slug) {
  // The recruits the school is in a race with you for (it answered you and has not given up).
  return get(get(state["recruiting"], "races") || {}, slug) || [];
}


function _race_join(state, slug, pid) {
  const rc = state["recruiting"];
  if (!has(rc, "races")) rc["races"] = {};
  if (!has(rc["races"], slug)) rc["races"][slug] = [];
  if (!rc["races"][slug].includes(pid)) rc["races"][slug].push(pid);
}


function _race_leave(state, slug, pid) {
  // The school is out of the race for him (he signed, went elsewhere, hardened, or it gave up). True when it was in it.
  const list = get(get(state["recruiting"], "races") || {}, slug);
  if (!truthy(list) || !list.includes(pid)) return false;
  list.splice(list.indexOf(pid), 1);
  if (!list.length) delete state["recruiting"]["races"][slug];
  return true;
}


function gave_up(state, slug, pid) {
  // The school gave up on him in a race with you: it does not offer him again.
  return (get(get(state["recruiting"], "races_out") || {}, slug) || []).includes(pid);
}


function _possessive(name) {
  return name.endsWith("s") ? `${name}'` : `${name}'s`;
}


function _push_line(name, how, after) {
  // The sentence the player reads for a school's move. `after` null: a school already in the race (the cause was said
  // when it joined).
  const tail = after === null ? null : _AFTER[after];
  if (tail === null) {
    if (how === "raise_nil") return `${name} raised its NIL offer.`;
    if (how === "hc_visit") return `${_possessive(name)} head coach visited him.`;
    if (how === "visit") return `${name} invited him to campus.`;
    if (how === "offer") return `${name} offered him.`;
  }
  if (how === "gave_up") return `${name} has stopped calling him.`;
  if (how === "press") return `${name} is still calling your commit. Keep in touch.`;
  if (how === "cost") return `${name} reached your commit this week and you did not. His commitment is softer.`;
  if (how === "offer") return `${name} offered him ${tail}.`;
  if (how === "raise_nil") return `${name} raised its NIL offer ${tail}.`;
  if (how === "hc_visit") return `${_possessive(name)} head coach visited him ${tail}.`;
  if (how === "visit") return `${name} invited him to campus ${tail}.`;
  return tail === null ? `${name} called him.` : `${name} called him ${tail}.`;
}


function _push(state, slug, pid, how, after) {
  // A "rival_push" event: the school's move on a recruit of yours, for his History, the week's report and the news.
  return recruiting._event(state, "rival_push", pid, slug, { how, ...(after === null ? {} : { after }), line: _push_line(recruiting.school_name(slug), how, after) });
}


function _go(state, slug, pid, action, pitch, nil, scale) {
  // One action through the game's own path; false when the game refuses it (no hours, no NIL, done this week, the
  // month's visit made, he has shut the school out).
  try {
    recruiting._act(state, slug, pid, action, pitch, nil, scale, undefined, undefined, true);
    return true;
  } catch (err) {
    if (!(err instanceof recruiting.RecruitingError)) throw err;
    return false;
  }
}


function _quit(state, slug, pid) {
  // R3: the school gives up on him. Its offer is pulled (its NIL and hours go to its other races), it is remembered
  // so it does not offer him again, and you are told.
  const rc = state["recruiting"];
  recruiting._race_leave(state, slug, pid);
  if (!has(rc, "races_out")) rc["races_out"] = {};
  if (!has(rc["races_out"], slug)) rc["races_out"][slug] = [];
  if (!rc["races_out"][slug].includes(pid)) rc["races_out"][slug].push(pid);
  if (get(rc["offers"], slug, []).includes(pid)) _go(state, slug, pid, "pull_offer", null, 0, 1.0);
  _push(state, slug, pid, "gave_up", "passed");
}


function _react_idle(state, slug) {
  // The school's class is full: it is out of every race it was in (no line: it has what it came for).
  const rc = state["recruiting"];
  if (has(get(rc, "races") || {}, slug)) delete rc["races"][slug];
}


function _fund(state, slug, pid, ask, win, offered) {
  // R2: short of money for the raise, the school pulls its offers to the recruits it trails by more than
  // REACT_DROP_BEHIND, the furthest behind first, until it can pay him (never a commit of its own, never another race).
  const rc = state["recruiting"];
  const nil = recruiting._nil(state, slug);
  const held = () => get(nil["held"], pid, 0);
  if (held() + recruiting.nil_left(state, slug) >= ask) return;
  const mine = recruiting.racing(state, slug);
  const rows = [];
  for (const [q, v] of Object.entries(nil["held"])) {
    const st = rc["status"][q];
    if (q === pid || !(v > 0) || st["committed"] === slug || truthy(st["signed"]) || mine.includes(q)) continue;
    let best = -Infinity;
    for (const x of get(offered, q) || []) best = Math.max(best, recruiting.interest(state, x, q, win));
    const trail = best - recruiting.interest(state, slug, q, win);
    if (trail > recruiting.REACT_DROP_BEHIND) rows.push([trail, rc["prospects"][q]["rank"], q]);
  }
  rows.sort((a, b) => cmp([-a[0], a[1]], [-b[0], b[1]]));
  for (const [, , q] of rows) {
    if (held() + recruiting.nil_left(state, slug) >= ask) break;
    if (_go(state, slug, q, "pull_offer", null, 0, 1.0)) recruiting._offer_gone(state, slug, q, "money");
  }
}


function _offer_gone(state, slug, pid, why) {
  // Another school pulled its offer to a recruit you are after (on your board, or holding your offer) while he is
  // still open: his History says so, and why. `why`: "group" (it is full at his position), "money" (it moved its NIL
  // to a recruit it is closer to). Nothing for a school's offer to anyone else, or yours.
  const rc = state["recruiting"];
  const me = get(state, "team");
  if (!truthy(me) || slug === me || truthy(recruiting.is_portal(state))) return null;
  const st = rc["status"][pid];
  if (truthy(st["signed"]) || st["committed"] !== null) return null;
  if (!get(rc, "board", []).includes(pid) && !get(rc["offers"], me, []).includes(pid)) return null;
  const name = recruiting.school_name(slug);
  const group = get(recruiting.GROUP_WORDS, recruiting._group_of(rc["prospects"][pid]), "his position");
  const line = why === "group" ? `${name} pulled its offer: it is full at ${group}.` : `${name} pulled its offer to spend its NIL on another recruit.`;
  return recruiting._event(state, "offer_gone", pid, slug, { why, line });
}


function _react_open(state, week) {
  // Once a week, before the schools' weeks: for each recruit you offered by hand, the schools that may JOIN a race for
  // him this week, {prospect: [school]}. Nobody while you are not a contender for him (outside his top REACT_TOP
  // offering schools with no visit booked and no commitment). Otherwise the schools you have passed, or any school
  // once you hold his visit or his commitment, that trail you by no more than REACT_REACH, have not given up and that
  // he has not shut out; the ones he likes best first, as many as REACT_RACE_MAX leaves free. No draw, nothing saved.
  const mine = recruiting._react_mine(state);
  const out = {};
  recruiting._REACT_OPEN = [state["id"], week, out];
  if (mine === null) return out;
  const rc = state["recruiting"], me = state["team"];
  const persona = modules.persona;
  const win = recruiting._winning(state);
  const offered = recruiting._offers_by_prospect(state);
  const in_race = {};
  for (const [slug, pids] of Object.entries(get(rc, "races") || {})) for (const pid of pids) in_race[pid] = (in_race[pid] || []).concat([slug]);
  let boards = null;
  for (const pid of mine) {
    const st = rc["status"][pid];
    const schools = get(offered, pid) || [];
    if (truthy(st["signed"]) || !schools.includes(me)) continue;
    if (truthy(st["committed"]) && (st["committed"] !== me || truthy(get(st, "hard")) || truthy(persona.is_quiet(state, pid)))) continue;
    const free = recruiting.REACT_RACE_MAX - (in_race[pid] || []).length;
    if (free <= 0) continue;
    const val = {};
    for (const x of schools) val[x] = recruiting.interest(state, x, pid, win);
    const ahead = schools.filter((x) => x !== me && val[x] >= val[me]).length;
    const held = st["committed"] === me || has(get(rc["visits"], pid) || {}, me);
    if (!held && ahead >= recruiting.REACT_TOP) continue;
    if (boards === null) {                                 // the schools with him on a board and no offer out (R4), once
      boards = {};
      for (const [x, b] of Object.entries(rc["boards"])) {
        if (x === me) continue;
        for (const q of b) if (mine.has(q) && !get(rc["offers"], x, []).includes(q)) (boards[q] = boards[q] || []).push(x);
      }
    }
    const rows = [];
    for (const x of schools.concat(st["committed"] === null ? boards[pid] || [] : [])) {
      if (x === me || (in_race[pid] || []).includes(x) || recruiting.gave_up(state, x, pid)) continue;
      const v = has(val, x) ? val[x] : recruiting.interest(state, x, pid, win);
      const behind = val[me] - v;
      if (!(held || behind > 0) || behind > recruiting.REACT_REACH) continue;
      if (recruiting.blocked(state, x, pid, win, offered) !== null) continue;
      rows.push([v, x]);
    }
    rows.sort((a, b) => cmp([-a[0], a[1]], [-b[0], b[1]]));
    if (rows.length) out[pid] = rows.slice(0, free).map(([, x]) => x);
  }
  return out;
}


function _react_week(state, slug, week) {
  // One school's answers this week (R1 to R4, and R6's calls), before its ordinary targets: its races come first.
  // Called from `_auto_week` for every school but yours, with a class still open.
  const mine = recruiting._react_mine(state);
  if (mine === null) return;
  const me = state["team"];
  if (slug === me) return;
  const persona = modules.persona;
  const rc = state["recruiting"];
  const in_race = recruiting.racing(state, slug).slice();
  for (const pid of in_race) {                             // you pulled your offer, or he signed: the race is over
    if (!mine.has(pid) || truthy(rc["status"][pid]["signed"])) recruiting._race_leave(state, slug, pid);
  }
  const offers = get(rc["offers"], slug, []);
  const seen = new Set();
  const cands = [];
  for (const pid of offers.concat(get(rc["boards"], slug, []))) {
    if (seen.has(pid) || !mine.has(pid) || truthy(rc["status"][pid]["signed"])) continue;
    seen.add(pid);
    cands.push(pid);
  }
  if (!cands.length) return;
  cands.sort((a, b) => cmp([rc["prospects"][a]["rank"], a], [rc["prospects"][b]["rank"], b]));
  const level = recruiting.REACT_LEVEL;
  const most = Math.max(1, round(recruiting.REACT_MAX * level));
  const hc_most = recruiting.REACT_HC + (level >= 2 ? 1 : 0);
  let open = recruiting._REACT_OPEN;                       // who may join a race this week (made before the schools' weeks)
  open = open[0] === state["id"] && open[1] === week ? open[2] : recruiting._react_open(state, week);
  const rng = new Random(`react-${rc["seed"]}-${slug}-${week}`);          // its own stream, one a school a week
  const win = recruiting._winning(state);
  const offered = recruiting._offers_by_prospect(state);
  const need = recruiting.needs(state, slug);
  const edge = 1 + recruiting._coach_edge(state, slug);
  let fired = 0, hc = 0;
  for (const pid of cands) {
    const roll = rng.random();                             // always drawn: the stream never depends on what fired
    const st = rc["status"][pid], p = rc["prospects"][pid];
    const was_in = recruiting.racing(state, slug).includes(pid);
    const c = recruiting._contact(state, slug, pid);
    if (get(c, "mapped") === true && offers.includes(pid)) {     // R5: the program your offer put on him has offered
      c["mapped"] = "said";
      _push(state, slug, pid, "offer", p["rank"] <= _KNOWN_RANK ? "offer" : "map");
    }
    if (st["committed"] === slug || recruiting.gave_up(state, slug, pid)) continue;
    if (truthy(st["committed"]) && st["committed"] !== me) {         // he went elsewhere: nobody's race with you now
      // (a Quiet Commit's school is his secret: the race stays on your page, idle, until he signs)
      if (!truthy(persona.is_quiet(state, pid))) recruiting._race_leave(state, slug, pid);
      continue;
    }
    if (st["committed"] === me && (truthy(get(st, "hard")) || truthy(persona.is_quiet(state, pid)))) {   // a hard commit, or one nobody else knows of
      recruiting._race_leave(state, slug, pid);
      continue;
    }
    if (recruiting.blocked(state, slug, pid, win, offered) !== null) {      // he has shut the school out: it cannot act on him
      if (was_in) _quit(state, slug, pid);
      continue;
    }
    const has_offer = offers.includes(pid);
    const schools = (get(offered, pid) || []).slice();
    if (!schools.includes(me)) continue;
    if (!has_offer) schools.push(slug);
    const val = {};
    for (const x of schools) val[x] = recruiting.interest(state, x, pid, win);
    const behind = val[me] - val[slug];
    const visit = get(get(rc["visits"], pid) || {}, me);
    let after = st["committed"] === me ? "commit" : behind > 0 ? "lead" : truthy(visit) ? "visit" : null;
    if (after === "lead" && schools.some((x) => x !== me && val[x] >= val[me])) after = "passed";     // you are ahead of it, not of everyone
    if (after === null) continue;                          // you have not passed it, booked his visit or taken his commitment
    if (behind > recruiting.REACT_GIVE_UP) {               // R3
      if (was_in) _quit(state, slug, pid);
      continue;
    }
    const g = recruiting._group_of(p);
    if (!was_in) {
      if (!(get(open, pid) || []).includes(slug)) continue;       // you are no contender for him, it is out of reach, or the race is full
      const want = Math.min(1.0, level * recruiting.REACT_BASE * get(recruiting.REACT_TIER, recruiting.tier_of(p), 0.1)
        * Math.min(1.0, recruiting.need_factor(get(need, g, 0)) / 1.2));
      if (roll >= want) continue;
    }
    if (fired >= most) continue;
    const commits = recruiting.commits_by_group(state, slug);
    if (commits[g] >= recruiting.group_cap(need, g) && !truthy(recruiting.is_generational(state, pid))) {   // no room at his group any more
      if (was_in) recruiting._race_leave(state, slug, pid);
      continue;
    }
    const did = [];
    if (!has_offer) {                                       // R4: on its board with no offer out: the offer, paid as any of its offers
      if (truthy(st["committed"])) continue;
      const budget = recruiting._nil(state, slug)["budget"];
      const nil0 = Math.min(recruiting.nil_left(state, slug), round(budget * get(recruiting.AI_NIL, recruiting.tier_of(p), 0)),
        round(recruiting.AI_OVER_ASK * recruiting.ask_from(state, slug, pid, win)));
      if (!_go(state, slug, pid, "offer", recruiting.best_pitch(state, slug, pid, true), nil0, edge)) continue;
      if (get(c, "mapped") === true) c["mapped"] = "said";
      did.push("offer");
    }
    fired += 1;
    recruiting._race_join(state, slug, pid);
    if (!truthy(get(c, "react_nil"))) {                    // one raise to his ask, from what it has and what R2 frees
      const ask = recruiting.ask_from(state, slug, pid, win);
      _fund(state, slug, pid, ask, win, offered);
      const held = get(recruiting._nil(state, slug)["held"], pid, 0);
      const to = Math.min(ask, held + recruiting.nil_left(state, slug));
      c["react_nil"] = true;
      if (to > held && _go(state, slug, pid, "raise_nil", null, to, edge)) did.push("raise_nil");
    }
    const invited = !has(get(rc["visits"], pid) || {}, slug) && _go(state, slug, pid, "official_visit", null, 0, 1.0);
    if (hc < hc_most && _go(state, slug, pid, "hc_visit", recruiting.best_pitch(state, slug, pid), 0, edge)) {
      hc += 1;
      did.push("hc_visit");
    }
    if (invited) did.push("visit");
    if (_go(state, slug, pid, "call", recruiting.best_pitch(state, slug, pid), 0, edge)) did.push("call");
    _go(state, slug, pid, "message", recruiting.best_pitch(state, slug, pid), 0, edge);
    // what you are told: the week it joins, its biggest move; after that only an offer, a raise, a head-coach visit or
    // an invitation (a week of calls alone is the chip on his row, not a line), and once that it is on your commit
    const told = did.filter((h) => h !== "call" || !was_in);
    if (after === "commit") {
      if (!truthy(get(c, "react_press")) && (did.length || was_in)) {
        c["react_press"] = true;
        _push(state, slug, pid, "press", after);
      } else if (told.length && told[0] !== "call") {
        _push(state, slug, pid, told[0], null);
      }
    } else if (told.length) {
      _push(state, slug, pid, told[0], was_in ? null : after);
    }
  }
}


function _signs(slug, tier) {
  // A program that signs his star level at the national rate or better.
  const share = get(get(recruiting._team_model(slug), "star_share") || {}, get(recruiting.STAR_KEY, tier, "2*"), 0.0);
  return share / recruiting._national_share(tier) >= 1;
}


function _react_map(state, week) {
  // R5, once a week before the schools' weeks: "your offer puts him on the map". Each four- or five-star you offered
  // by hand whom fewer than REACT_CHAIN_MIN programs of his level offer goes on the board (at the front) of the
  // REACT_CHAIN such programs that fit him best and need his group. No draw, no points: the program then recruits
  // him as it does anyone on its board.
  const mine = recruiting._react_mine(state);
  if (mine === null) return;
  const chain = recruiting.REACT_CHAIN + (recruiting.REACT_LEVEL >= 2 ? 1 : 0);
  if (chain <= 0) return;
  const rc = state["recruiting"], me = state["team"];
  let big = null, win = null, offered = null;
  const need_of = {};
  for (const pid of get(rc, "manual_offers")) {
    const p = rc["prospects"][pid], st = rc["status"][pid];
    const tier = recruiting.tier_of(p);
    const done = get(get(rc, "mapped") || {}, pid) || [];
    if (tier < 4 || truthy(st["signed"]) || truthy(st["committed"]) || done.length >= chain) continue;
    if (offered === null) {
      offered = recruiting._offers_by_prospect(state);
      win = recruiting._winning(state);
      big = recruiting.fbs_schools(state).filter((x) => x !== me);
    }
    const on = (get(offered, pid) || []).filter((x) => x !== me && _signs(x, tier)).length;
    if (on >= recruiting.REACT_CHAIN_MIN) continue;
    const g = recruiting._group_of(p);
    const rows = [];
    for (const x of big) {
      if (!_signs(x, tier) || get(rc["offers"], x, []).includes(pid) || get(rc["boards"], x, []).includes(pid)) continue;
      if (done.includes(x) || recruiting.gave_up(state, x, pid) || recruiting.blocked(state, x, pid, win, offered) !== null) continue;
      if (!has(need_of, x)) need_of[x] = recruiting.needs(state, x);
      const fit = get(recruiting._fits(state, x), pid, 0) * recruiting.need_factor(get(need_of[x], g, 0));
      if (fit > 0) rows.push([fit, x]);
    }
    rows.sort((a, b) => cmp([-a[0], a[1]], [-b[0], b[1]]));
    for (const [, x] of rows.slice(0, chain - done.length)) {
      if (!has(rc["boards"], x)) rc["boards"][x] = [];
      rc["boards"][x].unshift(pid);
      const c = recruiting._contact(state, x, pid);
      if (!truthy(c["n"])) {                               // a board is prospects the staff has spoken to (`_build_board`)
        c["n"] = 1;
        recruiting._reveal(state, x, pid);
      }
      c["mapped"] = true;
      if (!has(rc, "mapped")) rc["mapped"] = {};
      if (!has(rc["mapped"], pid)) rc["mapped"][pid] = [];
      rc["mapped"][pid].push(x);
    }
  }
}


function _pressing(state) {
  // R6: {your soft commit: the schools still in the race for him}, or null when there is none.
  if (!(recruiting.REACT_LEVEL > 0)) return null;
  const rc = state["recruiting"];
  const races = get(rc, "races");
  if (!truthy(races)) return null;
  const me = get(state, "team");
  let out = null;
  for (const [slug, pids] of Object.entries(races)) {
    for (const pid of pids) {
      const st = rc["status"][pid];
      if (st["committed"] !== me || truthy(st["signed"]) || truthy(get(st, "hard"))) continue;
      if (out === null) out = {};
      if (!has(out, pid)) out[pid] = [];
      out[pid].push(slug);
    }
  }
  return out;
}


function _press_cost(state, pid, schools, week, touched) {
  // What a pressed commit's week costs his firmness: REACT_PRESS (times the level) when a school pressing him reached
  // him this week and you did not; nothing when you kept in touch.
  if (touched) return 0;
  const by = get(state["recruiting"]["contacts"], pid) || {};
  for (const slug of schools) {
    if (get(get(by, slug) || {}, "last_contact") === week) {
      const cost = round(recruiting.REACT_PRESS * recruiting.REACT_LEVEL);
      if (cost > 0) _push(state, slug, pid, "cost", "commit");
      return cost;
    }
  }
  return 0;
}


function rival_pushes(state, pid, viewer = null) {
  // For the page: the schools in a race with you for him, in the order they joined: [{school, pressing}].
  // `pressing`: he is your commit and the school is still calling him.
  const me = get(state, "team");
  if ((viewer !== null && viewer !== me) || !(recruiting.REACT_LEVEL > 0)) return [];
  const rc = state["recruiting"];
  const races = get(rc, "races");
  if (!truthy(races)) return [];
  const st = rc["status"][pid];
  if (truthy(st["signed"]) || truthy(get(st, "hard")) || !(get(rc, "manual_offers") || []).includes(pid)) return [];
  if (truthy(st["committed"]) && st["committed"] !== me && !truthy(modules.persona.hidden_from(state, me, pid))) return [];   // he went elsewhere, in the open: nobody's race with you
  const out = [];
  for (const [slug, pids] of Object.entries(races)) {
    if (pids.includes(pid)) out.push({ school: slug, pressing: st["committed"] === me });
  }
  return out;
}


function pressed_commits(state) {
  // For the Office: your soft commits another school is still calling, each with the school (the first that joined)
  // and whether he has heard from you this week (`kept`: a contact made, or a quick action ticked for the week's step).
  const out = [];
  const rc = get(state, "recruiting");
  if (!truthy(rc) || !truthy(get(rc, "races"))) return out;
  const me = get(state, "team"), week = recruiting.contact_week(state);
  const planned = recruiting.planned(state);
  for (const pid of get(rc, "manual_offers") || []) {
    const st = rc["status"][pid];
    if (st["committed"] !== me) continue;
    const on = recruiting.rival_pushes(state, pid, me);
    if (!on.length) continue;
    const c = get(get(rc["contacts"], pid) || {}, me) || {};
    const kept = (get(planned, pid) || []).length > 0 || get(c, "touch_week") === week || Object.values(get(c, "week") || {}).includes(week);
    out.push({ pid, name: rc["prospects"][pid]["name"], school: on[0]["school"], school_name: recruiting.school_name(on[0]["school"]), kept });
  }
  return out;
}


// ----- the unpaid offer ----------------------------------------------------------------------------------------

function _unpaid_why(state, pid, held) {
  // The hold itself, for a recruit your school holds `held` NIL on (0: none, or no offer at all): null (he can commit
  // to you), the school that is after him too, or true (nobody else: he is a blue chip holding out for real money).
  const rc = state["recruiting"], me = get(state, "team");
  const share = modules.persona.lowball_share(state, pid);
  const ask = recruiting.ask_from(state, me, pid, undefined, true);
  if (!ask || !recruiting.is_lowball(held, ask, share)) return null;
  if (recruiting.fit(state, me, pid) >= recruiting.UNPAID_FIT) return null;
  let best = null;
  for (const [x, pids] of Object.entries(rc["offers"])) {
    if (x === me || !pids.includes(pid)) continue;
    const theirs = get(get(get(rc["nil"], x) || {}, "held") || {}, pid, 0);
    const paid = theirs > 0 && !recruiting.is_lowball(theirs, recruiting.ask_from(state, x, pid, undefined, true), share);
    if (recruiting.UNPAID_RIVAL === "paid" && !paid) continue;
    const row = [paid ? theirs : 0, recruiting.interest(state, x, pid), x];
    if (best === null || cmp([-row[0], -row[1], row[2]], [-best[0], -best[1], best[2]]) < 0) best = row;
  }
  if (best !== null) return best[2];
  return recruiting.tier_of(rc["prospects"][pid]) >= recruiting.UNPAID_STARS ? true : null;
}


function unpaid_hold(state, pid, shown = false) {
  // Why he will not commit to you on your offer as it stands: null (he can), the school that is after him too, or
  // true (nobody else: he is a blue chip holding out for real money). Your offer by hand is a standing lowball (what
  // you hold on him is under his lowball line of his ask from you), your program is not well over what he wants (its
  // fit under UNPAID_FIT), and he is a blue chip (UNPAID_STARS) or another school offers him (UNPAID_RIVAL "paid": one
  // paying him at or over that line of his ask from it). The school named is the one paying him most, then the one he
  // likes best. A recruit committed elsewhere is held the same way (he does not flip to you unpaid). `shown`: for
  // the page, which never tells of a commitment nobody else knows of (a Quiet Commit's).
  if (!recruiting.UNPAID_HOLD) return null;
  const rc = state["recruiting"], me = get(state, "team");
  if (!truthy(me) || truthy(get(rc, "portal")) || !(get(rc, "manual_offers") || []).includes(pid)) return null;
  const st = rc["status"][pid];
  if (truthy(st["signed"]) || st["committed"] === me || !get(rc["offers"], me, []).includes(pid)) return null;
  if (shown && truthy(st["committed"]) && truthy(modules.persona.hidden_from(state, me, pid))) return null;
  return _unpaid_why(state, pid, get(get(get(rc["nil"], me) || {}, "held") || {}, pid, 0));
}


function _unpaid(state, final = false) {
  // The recruits who will not commit (or flip) to you this week (unpaid_hold), or null when there is none: the draws
  // and Signing Day leave your school out for them. `final`: the last Signing Day, when a recruit takes his leader
  // among every school that worked him: one you worked and hold no offer to is held as an offer of nothing would be
  // (no blue chip walks in unpaid).
  if (!recruiting.UNPAID_HOLD) return null;
  const rc = state["recruiting"], me = get(state, "team");
  const marks = get(rc, "manual_offers");
  if (!truthy(marks) || !marks.length || truthy(get(rc, "portal")) || !truthy(me)) return null;
  let out = null;
  for (const pid of marks) {
    if (recruiting.unpaid_hold(state, pid) !== null) {
      if (out === null) out = new Set();
      out.add(pid);
    }
  }
  if (final) {
    const mine = get(rc["offers"], me, []);
    for (const [pid, by] of Object.entries(rc["lists"])) {
      if (!has(by, me) || mine.includes(pid) || truthy(rc["status"][pid]["committed"]) || truthy(rc["status"][pid]["signed"])) continue;
      if (_unpaid_why(state, pid, 0) !== null) {
        if (out === null) out = new Set();
        out.add(pid);
      }
    }
  }
  return out;
}


Object.assign(recruiting, {
  _react_mine, racing, _race_join, _race_leave, gave_up, _push_line, _offer_gone, _react_idle, _react_open, _react_week, _react_map, _pressing,
  _press_cost, rival_pushes, pressed_commits, unpaid_hold, _unpaid,
});
