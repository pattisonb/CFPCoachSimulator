// Recruiting, part 5: the Hat Ceremony, Package Deals at a
// commitment, the two Signing Days, the weekly step itself, the portal's weekly decisions and why an entrant went
// elsewhere, the portal as a recruiting class, and scouting (truths, looks, reads and grades, the staff, your board).
//
// Every name of recruiting is reached through the `recruiting` namespace, whichever part defines it
// (engine_js/PORTING.md, "Big Files in Parts").
import { Random, round, sum, cmp, sorted, maxBy, get, truthy, floordiv, mod } from "../../engine_js/pyrt.js";
import { modules } from "../../engine_js/modules.js";
import { game_scale } from "../../teamdata_js/game_scale.js";
import { recruits, pypow } from "../recruits.js";
import { prospects as pr } from "../prospects.js";
import { coach_names } from "../coach_names.js";
import { grades } from "../grades.js";
import { recruiting } from "../recruiting_ns.js";

// ----- small helpers (local to this part) --------------------------------------------------------------------

/** dict.setdefault(k, v): the value there, or `v` stored and returned. */
function setdefault(d, k, v) {
  if (d[k] === undefined) d[k] = v;
  return d[k];
}

/** dict.pop(k, None) where only the removal matters. */
const discard = (d, k) => { if (d[k] !== undefined) delete d[k]; };

/** list.remove(x): the first one out. */
const remove = (xs, x) => { xs.splice(xs.indexOf(x), 1); };

/** str(x) of a value that may be None, inside a sentence. */
const pystr = (x) => (x === null || x === undefined ? "None" : String(x));

/**
 * `room(slug, pid)`: a _Room called. The class is another part's: an object that can be called
 * is called, one with a `__call__` method has it called, and otherwise it is what __call__ is, `why_not(...) is None`.
 */
function _has_room(room, slug, pid) {
  if (typeof room === "function") return truthy(room(slug, pid));
  if (typeof room.__call__ === "function") return truthy(room.__call__(slug, pid));
  return room.why_not(slug, pid) === null;
}

/** `_Room(state, flier)`: the class made (a class or a plain function is made with `new`, an arrow function is called). */
const _make_room = (state, flier) => (recruiting._Room.prototype ? new recruiting._Room(state, flier) : recruiting._Room(state, flier));

/** Two word ranges (or None) the same, item by item. */
const same_words = (a, b) => JSON.stringify(a) === JSON.stringify(b);


function _hat(state, pid, week, finalists) {
  // A Hat Ceremony named: persona.HAT_LEAD weeks out (on signing day at the latest, the early one when it
  // is still ahead), only his finalists can win. Kept in rc["hats"][pid] = [week, finalists]; a "hat" event.
  const persona = modules.persona;
  const rc = state["recruiting"];
  let day = week + persona.HAT_LEAD;
  day = Math.min(day, week < recruiting.early_signing_week() ? recruiting.early_signing_week() : recruiting.signing_week());
  setdefault(rc, "hats", {})[pid] = [day, finalists];
  const names = finalists.map((s) => persona._school_name(s));
  const said = names.length === 1 ? names[0] : names.length === 2 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
    : `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
  const news = modules.news;
  recruiting._event(state, "hat", pid, null, { finalists, day,
    line: names.length > 1 ? `He will pick from ${said} at a hat ceremony ${news._when(day)}.` : `He will announce at a hat ceremony ${news._when(day)}.` });
}


function _pair_ok(state, slug, pid, offered, room) {
  // A Package Deal commits only where his mate can come too: the mate has signed or committed there, or
  // holds its offer, is free to move (no hard commit elsewhere) and the school has room for both.
  const mate = modules.persona.mate(state, pid);
  if (!truthy(mate)) return true;
  const ms = state["recruiting"]["status"][mate];
  if (truthy(ms["signed"])) return ms["signed"] === slug;
  if (ms["committed"] === slug) return true;
  if (truthy(get(ms, "hard")) || !get(offered, mate, []).includes(slug)) return false;
  room.took(slug, pid);                                // room for both: him first, then his mate
  const ok = _has_room(room, slug, mate);
  room.took(slug, pid, -1);
  return ok;
}


function _last_quarterbacks(state, room, win, offered) {
  // The last Signing Day, before everyone else picks: each school with no quarterback in its class (QB_EVERY_CLASS;
  // never yours, whose class is your own to fill) takes the uncommitted quarterback most interested in it, when he
  // would rather come than play FCS (it need not have offered him: a late call to a quarterback with nowhere to go). Recruiting closes after Championship Week, so a
  // school short a quarterback then has no weeks left to find one. Schools go in name order, each taking one.
  const rc = state["recruiting"];
  const free = Object.entries(rc["prospects"]).filter(([pid, p]) => recruiting._group_of(p) === "QB" && !truthy(rc["status"][pid]["committed"])
    && !truthy(rc["status"][pid]["signed"])).map(([pid]) => pid);
  if (!free.length) return;
  for (const s of sorted(Object.keys(rc["boards"]))) {
    if (s === get(state, "team") || recruiting.commits_by_group(state, s)["QB"] > 0) continue;
    const found = [];
    for (const pid of free) {
      if (_has_room(room, s, pid) && recruiting._pair_ok(state, s, pid, offered, room)) found.push([recruiting.interest(state, s, pid, win), pid]);
    }
    const best = found.length ? maxBy(found) : null;
    if (best && best[0] >= recruiting.FCS_LINE) {
      const pair = recruiting._commit(state, best[1], s);
      room.took(s, best[1]);
      remove(free, best[1]);
      if (truthy(pair)) {
        if (truthy(pair[1])) room.took(pair[1], pair[0], -1);
        room.took(s, pair[0]);
        if (free.includes(pair[0])) remove(free, pair[0]);
      }
    }
  }
}


function _sign(state, final) {
  // The early Signing Day (as recruiting closes): every committed prospect signs. The last one (final, after the
  // last game): whoever committed since signs, and the rest go to their leader with room, or to an FCS program.
  const persona = modules.persona;
  const rc = state["recruiting"];
  if (truthy(final)) {
    const room = _make_room(state, true), win = recruiting._winning(state), offered = recruiting._offers_by_prospect(state);
    if (recruiting.QB_EVERY_CLASS) {                 // first, a school still without a quarterback takes the best one left who would come
      recruiting._last_quarterbacks(state, room, win, offered);
    }
    const unpaid = recruiting._unpaid(state, true);  // the unpaid offer (part 7): he does not sign with you on your standing lowball
    for (const pid of sorted(Object.keys(rc["prospects"]), (q) => rc["prospects"][q]["rank"])) {
      const st = rc["status"][pid];
      if (truthy(st["committed"])) continue;
      // (a Set; the scores below are sorted on (interest, school), so its order does not show)
      let schools = new Set([...get(offered, pid, []), ...Object.keys(rc["lists"][pid])]);
      if (unpaid !== null && unpaid.has(pid)) schools.delete(get(state, "team"));
      const hat = get(get(rc, "hats") || {}, pid);          // his Hat Ceremony on signing day: his finalists, if one can take him
      if (truthy(hat) && hat[1].some((s) => schools.has(s) && _has_room(room, s, pid))) {
        const finalists = new Set(hat[1]);
        schools = new Set([...schools].filter((s) => finalists.has(s)));
      }
      const found = [];
      for (const s of schools) {
        if (_has_room(room, s, pid) && recruiting._pair_ok(state, s, pid, offered, room)) found.push([recruiting.interest(state, s, pid, win), s]);
      }
      const scores = sorted(found, undefined, true);
      if (scores.length && scores[0][0] >= recruiting.FCS_LINE) {
        const pair = recruiting._commit(state, pid, scores[0][1]);
        room.took(scores[0][1], pid);
        if (truthy(pair)) {
          if (truthy(pair[1])) room.took(pair[1], pair[0], -1);
          room.took(scores[0][1], pair[0]);
        }
      }
    }
  }
  rc["commits_v"] = get(rc, "commits_v", 0) + 1;
  for (const [pid, st] of Object.entries(rc["status"])) {
    if (truthy(st["signed"])) continue;
    if (truthy(st["committed"]) && st["committed"] !== "FCS" && truthy(persona.goes_pro(state, st["committed"], pid))) {
      const school = st["committed"];                // a Two-Sport recruit takes the baseball money: no signing, the package unspent
      discard(get(get(rc["nil"], school) || {}, "held", {}), pid);
      Object.assign(st, { signed: "FCS", committed: "FCS", fcs: true, hard: false, pro: true });
      recruiting._event(state, "pro", pid, school, { line: persona.pro_line(state, school) });
    } else if (truthy(st["committed"])) {
      st["signed"] = st["committed"];
      const n = get(rc["nil"], st["committed"]);
      if (truthy(n) && n["held"][pid] !== undefined) {   // the package is spent
        const held = n["held"][pid];
        delete n["held"][pid];
        n["budget"] -= held;
      }
      recruiting._event(state, "signed", pid, st["committed"]);
    } else if (truthy(final)) {
      Object.assign(st, { signed: "FCS", committed: "FCS", fcs: true });
      recruiting._event(state, "signed", pid, "FCS");
    } else {
      continue;
    }
    for (const [school, pids] of Object.entries(rc["offers"])) {   // every other school's offer to him lapses
      if (school !== st["signed"] && pids.includes(pid)) {
        remove(pids, pid);
        recruiting._unmark(state, school, pid);
        discard(get(get(rc["nil"], school, {}), "held", {}), pid);
      }
    }
  }
}


recruiting.AUTO_MODES = ["off", "week", "season"];


function auto_mode(state) {
  // Your Auto-recruit: "off", "week" (this coming week only) or "season" (saves from before the
  // one-week option stored true or false).
  const v = get(get(get(state, "career") || {}, "settings") || {}, "auto_recruit");
  return v === true ? "season" : recruiting.AUTO_MODES.includes(v) ? v : "off";
}


function _asks_for_more(state, week) {
  // A prospect who has heard a bigger number: when a rival's NIL on him is ASK_MORE[0] times a
  // school's and that school is in his top group, his ask from it rises ASK_MORE[1], once per rival.
  const rc = state["recruiting"];
  const win = recruiting._winning(state);
  const by_pid = {};
  for (const [slug, n] of Object.entries(rc["nil"])) {
    for (const [pid, held] of Object.entries(n["held"])) {
      if (get(rc["offers"], slug, []).includes(pid)) setdefault(by_pid, pid, {})[slug] = held;
    }
  }
  for (const [pid, held] of Object.entries(by_pid)) {
    if (Object.keys(held).length < 2 || truthy(rc["status"][pid]["signed"]) || !truthy(rc["prospects"][pid]["nil_ask"])) continue;
    const top = sorted(Object.keys(held), (s) => -recruiting.interest(state, s, pid, win)).slice(0, recruiting.top_size(state));
    for (const slug of top) {
      const c = recruiting._contact(state, slug, pid);
      const heard = setdefault(c, "heard", []);
      for (const [rival, theirs] of Object.entries(held)) {
        if (rival !== slug && !heard.includes(rival) && theirs >= recruiting.ASK_MORE[0] * Math.max(1, held[slug])) {
          heard.push(rival);
          c["ask_mult"] = round(get(c, "ask_mult", 1.0) * recruiting.ASK_MORE[1], 3);
          c["asked_more"] = true;
          recruiting._event(state, "asked_more", pid, slug, { rival });
        }
      }
    }
  }
}


function weekly_step(state, week, auto_user = false) {
  // The recruiting week after `week`'s games: visits, every AI school (and yours on Auto),
  // commitment draws, signing, then the hours reset. Returns the week's events. In the portal
  // `week` is the portal week (1-4) and entrants decide at each step instead of committing.
  recruiting._STEP_WEEK[0] = state["current_week"];    // the contacts made in the step count against the week it lands (contact_week)
  try {
    return recruiting._weekly_step(state, week, auto_user);
  } finally {
    recruiting._STEP_WEEK[0] = null;
  }
}


function _weekly_step(state, week, auto_user) {
  const persona = modules.persona;
  const rc = state["recruiting"];
  const start_log = rc["log"].length;
  const rng = new Random(`recruiting-${rc["seed"]}-${truthy(get(rc, "portal")) ? "portal-" : ""}${week}`);
  // the dead period (after Championship Week, until Signing Day): no school works a recruit, so nothing of a
  // working week runs. The recruits go on deciding among the offers they hold (the draws below)
  const dead = !truthy(get(rc, "portal")) && week > recruiting.close_week();
  recruiting._run_planned(state);                // the quick actions you ticked go out now
  recruiting._flush(state, week);                // your week's actions land
  if (!dead) persona.cool_quiet(state, week);    // a recruit who loves the attention cools on a school gone quiet
  if (!truthy(get(rc, "portal"))) {
    if (!dead) persona.bloom(state, week);       // a Late Bloomer's jump: public, and the AI boards that fit him add him
    persona.twist_week(state, week);             // his twist: a game he watched plays out; the ones run out end
  }
  if (!truthy(get(rc, "portal")) && !dead) {
    recruiting._visits(state, week);
    persona.learn_styles(state, week);           // an official visit or four weeks holding your offer: his commit style
  }
  if (!dead) {
    recruiting.scout_week(state, truthy(get(rc, "portal")) ? week + 1 : week);   // the portal's week counter moves after the step
    recruiting.spend_leftover(state, truthy(get(rc, "portal")) ? week + 1 : week);   // what you didn't spend, your staff does: half looks on your board
  }
  const mine = get(state, "team");
  const mode = recruiting.auto_mode(state);
  const auto_mine = truthy(auto_user) || mode !== "off";
  if (!dead) {
    recruiting._asks_for_more(state, week);
    const commits = recruiting._commits(state);  // AI weeks change offers and interest, not commitments
    recruiting._react_map(state, week);          // your offer puts a blue chip on the map (part 7; nothing without an offer of yours by hand)
    recruiting._react_open(state, week);         // ... and who may join a race with you this week
    for (const slug of recruiting.fbs_schools(state)) {
      if (slug !== mine || auto_mine) {
        recruiting.auto_recruit(state, slug, new Random(`auto-${rc["seed"]}-${slug}-${week}`), commits, slug === mine);
      }
    }
    recruiting._flush(state, week);              // the other schools' week lands with yours
  }
  recruiting._forgive_pesters(state);
  if (truthy(get(rc, "portal"))) {
    recruiting._portal_draws(state, week, rng);
  } else {
    recruiting._promises(state, week);           // the recruit you promised him over committed too: he remembers
    recruiting._firm_up(state, week);
    if (week < recruiting.signing_week()) recruiting._draws(state, week, rng);
    if (week === recruiting.early_signing_week()) {   // the early Signing Day, as recruiting closes: everyone committed signs
      recruiting._sign(state, false);
    }
    if (week >= recruiting.signing_week()) {     // the last Signing Day, after the last game: the dead period's commits sign, the rest take their leader
      recruiting._sign(state, true);
    }
    if (!dead) persona.roll_twists(state, week); // the week's twists (their own stream, after every other draw)
  }
  recruiting._snapshot_ranks(state, week);
  recruiting._report(state, week);
  rc["hours"] = {};
  rc["scout_points"] = {};
  if (mode === "week") {                         // Auto-recruit for one week: done, so off again
    state["career"]["settings"]["auto_recruit"] = "off";
  }
  recruiting._carry_planned(state);
  return rc["log"].slice(start_log);
}


function _portal_draws(state, week, rng) {
  // A portal week's decisions: each entrant with offers decides with PORTAL_COMMIT's chance for
  // the week, best players first, for the school he likes best with room (less the transfers it
  // already took at his position rated at least as high); a decision is a signing.
  const rc = state["recruiting"];
  const room = _make_room(state, week >= recruiting.PORTAL_WEEKS);
  const win = recruiting._winning(state), offered = recruiting._offers_by_prospect(state);
  const taken = {};                                // (school, position) -> the composites it took there
  const at = (school, position) => `${school}\u0000${position}`;
  for (const [pid, st_] of Object.entries(rc["status"])) {
    if (truthy(st_["signed"])) {
      setdefault(taken, at(st_["signed"], rc["prospects"][pid]["position"]), []).push(rc["prospects"][pid]["composite"]);
    }
  }
  const chance = recruiting.PORTAL_COMMIT[Math.min(recruiting.PORTAL_COMMIT.length, Math.max(1, week)) - 1];
  for (const pid of sorted(Object.keys(rc["prospects"]), (q) => rc["prospects"][q]["rank"])) {
    const st_ = rc["status"][pid];
    if (truthy(st_["signed"]) || !truthy(get(offered, pid)) || rng.random() >= chance) continue;
    const p = rc["prospects"][pid];
    const found = [];
    for (const s of offered[pid]) {
      if (_has_room(room, s, pid)) {
        found.push([recruiting.interest(state, s, pid, win)
          - recruiting.CROWD * sum(get(taken, at(s, p["position"]), []).filter((c) => c >= p["composite"]).map(() => 1)), s]);
      }
    }
    const scores = sorted(found, undefined, true);
    if (!scores.length) continue;
    const school = scores[0][1];
    const why = recruiting._lost_why(state, room, pid, school, offered[pid]);   // read before his signing changes the room
    recruiting._commit(state, pid, school);
    st_["signed"] = school;
    rc["commits_v"] = get(rc, "commits_v", 0) + 1;
    room.took(school, pid);
    setdefault(taken, at(school, p["position"]), []).push(p["composite"]);
    recruiting._event(state, "signed", pid, school, { ...why });
    for (const [other, pids] of Object.entries(rc["offers"])) {     // every other school's offer lapses
      if (other !== school && pids.includes(pid)) {
        remove(pids, pid);
        recruiting._unmark(state, other, pid);
        discard(get(get(rc["nil"], other, {}), "held", {}), pid);
      }
    }
    const n = get(rc["nil"], school);
    if (truthy(n) && n["held"][pid] !== undefined) {
      const held = n["held"][pid];
      delete n["held"][pid];
      n["budget"] -= held;
    }
  }
}


recruiting.GROUP_WORDS = { QB: "quarterback", RB: "running back", WR: "receiver", TE: "tight end", OL: "offensive line", DL: "defensive line",
  LB: "linebacker", CB: "cornerback", S: "safety", K: "kicker", P: "punter" };


function _title(words) {
  // A label's Title Case: "offensive line" -> "Offensive Line".
  return words.split(/\s+/).filter((w) => w.length).map((w) => w.slice(0, 1).toUpperCase() + w.slice(1)).join(" ");
}


function no_room(state, slug, pid) {
  // In the portal: why he could not sign with the school if he decided now (it is out of roster
  // spots, or on Auto-recruit at its cap at his position), as a chip and a sentence; None while it
  // has room, outside the portal and once he has signed. An entrant only picks among offering
  // schools with room, however much he likes one without it.
  const rc = state["recruiting"];
  if (!recruiting.is_portal(state) || truthy(rc["status"][pid]["signed"])) return null;
  const why = _make_room(state, get(rc, "week", 1) >= recruiting.PORTAL_WEEKS).why_not(slug, pid, true);
  if (why === null || why === undefined) return null;
  if (why === "roster") {
    return { why: "roster", label: "No Room on Your Roster",
      tip: "Your roster is full for the portal: he only signs with a school that has a spot, even one he likes less." };
  }
  const g = get(recruiting.GROUP_WORDS, recruiting._group_of(rc["prospects"][pid]), "his position");
  return { why: "group", group: g, label: `No Room at ${recruiting._title(g)}`,
    tip: `Auto-recruit has taken all it wants at ${g} this portal: he signs elsewhere unless he would start for you.` };
}


function _lost_why(state, room, pid, school, offered) {
  // An entrant signing with `school` who was yours to win (your offer, or on your board): why he
  // went there and not to you, for his History and the week's news ({} when he picked you or you
  // never had him in sight). `room` as his decision saw it.
  const me = get(state, "team");
  const rc = state["recruiting"];
  if (school === me || !truthy(me) || (!offered.includes(me) && !rc["board"].includes(pid))) return {};
  if (!offered.includes(me)) return { lost: "no_offer" };
  const why = room.why_not(me, pid);
  if (truthy(why)) {
    return { lost: `no_room_${why}`, ...(why === "group" ? { group: get(recruiting.GROUP_WORDS, recruiting._group_of(rc["prospects"][pid])) } : {}) };
  }
  const led = get(get(get(rc, "ranks") || {}, pid) || {}, "now") || {};
  return { lost: get(led, me) === 1 ? "passed" : "behind" };
}


function lost_reason(e, name) {
  // Why an entrant you recruited went elsewhere, as a sentence for the news ("You had no room
  // left at linebacker."), or None. `e`: his "signed" or "unsigned" event (with `lost`); `name`: a
  // school's display name from its slug.
  const why = get(e, "lost");
  if (!truthy(why)) return null;
  const to = truthy(get(e, "school")) ? name(e["school"]) : null;
  return get({ no_room_roster: "You had no roster spot left for him.",
    no_room_group: `You had no room left at ${get(e, "group") || "his position"}.`,
    passed: `${pystr(to)} passed you on his list at the week's end.`,
    behind: `${pystr(to)} stood ahead of you on his list.`,
    no_offer: "You never offered him.",
    unsigned: "Nobody with room offered him." }, why);
}


function lost_line(e, name) {
  // His History's sentence for an entrant you recruited who went elsewhere ("He signed with
  // Georgia: you had no room left at linebacker."), or None (see lost_reason).
  const why = get(e, "lost");
  if (!truthy(why)) return null;
  if (e["kind"] === "unsigned") return "He went unsigned and is leaving FBS.";
  const to = pystr(name(e["school"]));
  if (truthy(get(e, "walk_on"))) return `He went unsigned and took a walk-on spot at ${to}.`;
  return get({ no_room_roster: `He signed with ${to}: you had no roster spot left for him.`,
    no_room_group: `He signed with ${to}: you had no room left at ${get(e, "group") || "his position"}.`,
    passed: `He signed with ${to}, who passed you on his list at the week's end.`,
    behind: `He signed with ${to}, who stood ahead of you on his list.`,
    no_offer: `He signed with ${to}: you never offered him.` }, why, `He signed with ${to}.`);
}


function school_name(slug) {
  // A school's display name (its slug when unknown).
  const season = modules.season;
  return get(get(season.load_teams(), slug) || {}, "name") || pystr(slug);
}


recruiting.POS_247_OF = { QB: "QB", HB: "RB", FB: "RB", WR: "WR", TE: "TE", LT: "OT", RT: "OT", LG: "IOL", RG: "IOL", C: "IOL",
  LEDG: "EDGE", REDG: "EDGE", DT: "DL", SAM: "LB", MIKE: "LB", WILL: "LB", CB: "CB", FS: "S", SS: "S",
  K: "K", P: "P" };
recruiting.LINE_KEYS = { QB: ["pass_yards", "passing_touchdowns", "interceptions_thrown", "rush_yards"], RB: ["carries", "rush_yards", "rushing_touchdowns"],
  WR: ["receptions", "receiving_yards", "receiving_touchdowns"], TE: ["receptions", "receiving_yards", "receiving_touchdowns"],
  OL: ["snaps"], DL: ["tackles", "sacks", "tackles_for_loss"], LB: ["tackles", "sacks", "interceptions"],
  CB: ["tackles", "interceptions", "passes_defended"], S: ["tackles", "interceptions", "passes_defended"],
  K: ["field_goals_made", "field_goals_attempted"], P: ["punts", "punt_yards"] };


function _season_line(state, slug, name, group) {
  // What he did last season: games, starts and his position's numbers (the box scores' totals).
  const team = get(get(state, "season_stats") || {}, slug) || {};
  let rec = null;
  for (const [k, v] of Object.entries(get(team, "players") || {})) {
    if (k.split("|")[0] === name) { rec = v; break; }
  }
  if (!truthy(rec)) return { games: 0, started: 0, stats: {} };
  const stats = get(rec, "stats") || {};
  const line = {};
  for (const k of get(recruiting.LINE_KEYS, group, [])) if (truthy(get(stats, k))) line[k] = stats[k];
  return { games: get(rec, "games", 0), started: get(stats, "games_started", 0), stats: line };
}


function portal_rc(state, entrants, year) {
  // The transfer portal as a recruiting class: every entrant in a prospect's form (no stars: his
  // class, last school, last season's line, a public portal rank, his ask), empty boards, a
  // four-week clock. `entrants`: offseason._departures' {pid: {"player": compact, "from", ...}}.
  const offseason = modules.offseason;
  const persona = modules.persona;
  const attrs = game_scale.keys();
  const seed = get(state, "rng_state", 0);
  const rng = new Random(`portal-rank-${year}-${seed}`);
  const prospects = {};
  for (const [pid, e] of Object.entries(entrants)) {
    const c = e["player"];
    const group = get(offseason.GROUP, c["pos"], "S");
    const ht = get(c, "ht") || 72;
    const ratings = [...c["r"]];
    const potential = c["r"].map((r, i) => Math.min(99, r + c["g"][i])).slice(0, Math.min(c["r"].length, c["g"].length));
    const p = { id: pid, name: c["n"], position: get(recruiting.POS_247_OF, c["pos"], c["pos"]), ea_position: c["pos"], archetype: get(c, "a"),
      height: `${floordiv(ht, 12)}'${mod(ht, 12)}"`, weight: get(c, "wt"), hometown: { city: "", state: get(c, "home") || "" },
      stars: null, composite: round(c["o"] / 100, 4), class_of: year, portal: true,
      from: e["from"], from_name: get(e, "from_name") || e["from"], cls: c["cls"], usage: get(e, "usage"),
      line: recruiting._season_line(state, e["from"], c["n"], group),
      coachability: get(c, "c") || "Steady Grinder", ratings, potential,
      ovr: c["o"], pot_ovr: game_scale.overall(Object.fromEntries(attrs.slice(0, potential.length).map((k, i) => [k, potential[i]])), c["pos"]),
      hidden: false, group };
    p["tier"] = recruiting.tier_of(p);
    p["priorities"] = recruiting._priorities(pid, p["tier"] >= recruiting.PORTAL_TOP_TIER ? recruiting.PORTAL_TOP_PRIORITY_ODDS : recruiting.PORTAL_PRIORITY_ODDS,
      recruiting.tilt_for(p, persona.draw(pid, seed, true)));
    p["home"] = recruiting._home(p);
    p["nil_ask"] = recruiting.nil_ask(p, year, seed);
    p["_sort"] = c["o"] + rng.gauss(0, recruiting.PORTAL_RANK_NOISE);
    prospects[pid] = p;
  }
  const order = sorted(Object.keys(prospects), (q) => { const v = prospects[q]["_sort"]; delete prospects[q]["_sort"]; return -v; });
  order.forEach((pid, i) => { prospects[pid]["rank"] = i + 1; prospects[pid]["portal_rank"] = i + 1; });   // (rank, then portal_rank: the keys' order in a save)
  recruiting._truths(prospects, attrs);
  const each = (make) => Object.fromEntries(Object.keys(prospects).map((pid) => [pid, make()]));
  return { portal: true, week: 1, weeks: recruiting.PORTAL_WEEKS, year, cache_key: `${year}-portal`, prospects,
    lists: each(() => ({})),
    status: each(() => ({ committed: null, signed: null, fcs: false })),
    offers: {}, visits: {}, contacts: {}, hours: {}, scout_points: {}, nil: {}, revealed: {}, board: [], log: [],
    boards: {}, seed, topics_v: 2, reads: {}, attrs, grades: "game", scale: "ours", overall_v: game_scale.overall_version(),
    pending: {}, why: {}, ranks: {}, reports: [], action_points: {}, leader_changes: {} };
}


// ----- scouting: truths, looks, reads and grades -------------------------------------------------------

function _truths(prospects, attrs) {
  // Each prospect's true grade per group, on the game's own scale: the average of the player-card
  // attributes behind it (athleticism: Top Speed, Burst, Agility, Leaping; technique: his position's
  // skills), and for potential his projected overall. Coachability comes from his label. Hidden from
  // the player; reads estimate them.
  for (const p of Object.values(prospects)) {
    const cards = pr.card_attributes(Object.fromEntries(attrs.slice(0, p["ratings"].length).map((k, i) => [k, p["ratings"][i]])), p);
    const truth = {};
    for (const g of recruiting.GROUPS.slice(0, -2)) {
      truth[g] = round(sum(pr.group_keys(p, g).map((k) => cards[k])) / pr.group_keys(p, g).length, 1);
    }
    truth["potential"] = Number(p["pot_ovr"]);
    truth["coachability"] = get(recruiting.COACHABILITY_POINTS, get(p, "coachability"), recruiting.COACHABILITY_POINTS["Steady Grinder"]);
    p["truth"] = truth;
  }
}


function word(points) {
  for (let i = 0; i < Math.min(recruiting.WORDS.length, recruiting.WORD_FLOORS.length); i++) {
    if (points >= recruiting.WORD_FLOORS[i]) return recruiting.WORDS[i];
  }
  throw new Error("StopIteration");
}


function word_band(points) {
  // The grade points that carry the same word as `points`: [its floor, the next word's floor), on
  // the grade scale (Weak from GRADE_LOW, All-American to its top).
  const i = recruiting.WORDS.indexOf(recruiting.word(points));
  const lo = i < recruiting.WORDS.length - 1 ? recruiting.WORD_FLOORS[i] : recruiting.GRADE_LOW;
  const hi = i > 0 ? recruiting.WORD_FLOORS[i - 1] - 1e-9 : recruiting.GRADE_LOW + recruiting.GRADE_SPAN;
  return [lo, hi];
}


function look_week(state) {
  // The week a look belongs to: the season's week, or the portal's own.
  const rc = state["recruiting"];
  return truthy(get(rc, "portal")) ? rc["week"] : state["current_week"];
}


/** The best evaluator behind a read as a share of 99: max(read["by"].items(), key=(looks, rating)), its rating. */
const _best_share = (read) => Math.trunc(Number(maxBy(Object.entries(read["by"]), (kv) => [kv[1], Math.trunc(Number(kv[0]))])[0])) / 99;


function _read_words(state, pid) {
  // Every group's grade range in words, or {} before his first look (the look log's before/after).
  const read = get(state["recruiting"]["reads"], pid);
  if (read === null) return {};
  const out = {};
  if (!truthy(read)) {
    for (const g of recruiting.GROUPS) out[g] = [...recruiting.grade_range(state, pid, g)];
    return out;
  }
  // grade_range for every group at once (read_spread and read_interval's own lines): the best evaluator and whether
  // the report is complete are the same for all six, and a look asks for all six twice
  const s = _best_share(read);
  const complete = recruiting.report_complete(read);
  for (const g of recruiting.GROUPS) {
    const [mean, prec] = read["g"][g];
    if (complete) {
      out[g] = [recruiting.word(mean), recruiting.word(mean)];
    } else {
      const half = Math.max(0.0, (0.6 + 1.1 * s) / Math.sqrt(prec) - recruiting.WORD_SLACK);
      out[g] = [recruiting.word(mean - half), recruiting.word(mean + half)];
    }
  }
  return out;
}


function _flags(state, pid) {
  // Your staff's flags on him from the read: gem, bust, generational (prospects.find, generational_seen).
  const rc = state["recruiting"];
  const out = [];
  const f = pr.find(state, pid);
  if (truthy(f)) out.push(f);
  if (truthy(pr.generational_seen(rc, pid, get(state, "team")))) out.push("generational");
  return out;
}


function report_looks(read) {
  // A read's looks in trip units, never past REPORT_LOOKS (an old save may hold more); 0 before any look.
  if (!truthy(read)) return 0.0;
  return Math.min(Number(recruiting.REPORT_LOOKS), Number(get(read, "looks") || 0));
}


function area_looks(read) {
  // The looks his area scouts have put in, up to AREA_CAP; an old save without the tally counts its looks, capped.
  if (!truthy(read)) return 0.0;
  if (get(read, "area") === null) return Math.min(Number(recruiting.AREA_CAP), Number(get(read, "looks") || 0));
  return Math.min(Number(recruiting.AREA_CAP), Number(read["area"]));
}


function report_complete(read) {
  // Whether his report is complete: REPORT_LOOKS looks, so no Send and no area look adds anything.
  return recruiting.report_looks(read) >= recruiting.REPORT_LOOKS;
}


function looks_left(read) {
  // What a complete report still needs, in looks: the trips open on him (2.5 -> one Send finishes him).
  return Math.max(0.0, recruiting.REPORT_LOOKS - recruiting.report_looks(read));
}


function _normalize_read(read) {
  // A read as this code keeps it: `looks` and `area` floats within their caps (old saves hold ints past 3 and no area).
  read["looks"] = recruiting.report_looks(read);
  read["area"] = recruiting.area_looks(read);
}


// (weight's default is SEND_LOOK as it stands at the call)
function look(state, pid, evaluator_rating, rng, by = null, week = null, weight = recruiting.SEND_LOOK) {
  // One look at a prospect by an evaluator, worth `weight` looks (SEND_LOOK for a trip, AREA_LOOK
  // for an area scout's week): every group's read moves toward what he saw, the step and the
  // confidence gained scaled by the weight, and `read["looks"]` grows by it. Nothing goes past
  // REPORT_LOOKS: the weight is cut to what his report still needs, and an area look (`by` a staff
  // id) also to what AREA_CAP leaves his area (`read["area"]`); a look with nothing left is not
  // counted or logged and returns an entry that changed nothing. A look's error shrinks with the
  // rating; so does how far its confidence can stray (a weak evaluator is sometimes sure and wrong).
  // Counted in looks in `rc["look_counts"][week][by]` and, when it changed a grade word or gained a
  // flag, in `rc["look_changes"][week][by]` ({changed, flags}) and logged in `rc["looks"]` (the
  // scouting desk's reports) as `by` (a staff id, or "trip" for your scouting trip) at `week`
  // (default: look_week): the words before and after of the groups that changed, and the flags
  // gained. The log keeps a scout's LOOK_LOG_KEEP most notable looks a week (the save is written
  // after every action). Returns the entry, logged or not.
  const persona = modules.persona;
  const rc = state["recruiting"];
  const p = rc["prospects"][pid];
  week = week === null || week === undefined ? recruiting.look_week(state) : week;
  by = truthy(by) ? by : "trip";
  let read = get(rc["reads"], pid);
  if (read !== null) recruiting._normalize_read(read);
  let w = Math.min(Number(weight), recruiting.looks_left(read));
  if (by !== "trip") w = Math.min(w, recruiting.AREA_CAP - recruiting.area_looks(read));
  w = round(w, 3);
  if (w <= 0) {                                      // nothing left to add: no look, only the flag he holds refreshed
    if (read !== null) read["find"] = pr.find(state, pid);
    return { week, pid, by, before: {}, after: {}, flags: [] };
  }
  const before = recruiting._read_words(state, pid), flags_before = recruiting._flags(state, pid);     // before his first look: no words, no flags
  read = setdefault(rc["reads"], pid, { looks: 0.0, area: 0.0, by: {}, g: {} });
  const s = evaluator_rating / 99;
  const sd = (recruiting.LOOK_SD[0] * (1 - s) + recruiting.LOOK_SD[1]) * (recruiting.is_portal(state) ? recruiting.PORTAL_LOOK : 1.0);
  for (const g of recruiting.GROUPS) {
    const sd_g = sd * persona.read_mult(state, pid, g);          // an Injury Comeback's potential: a wider error (the same draws)
    const seen = p["truth"][g] + rng.gauss(0, sd_g);
    const felt = sd_g * Math.exp(rng.gauss(0, recruiting.CONFIDENCE_NOISE * (1 - s)));
    const add = w / pypow(felt, 2);
    const [mean, prec] = get(read["g"], g, [0.0, 0.0]);
    read["g"][g] = [round((mean * prec + seen * add) / (prec + add), 3), round(prec + add, 6)];
  }
  read["looks"] = round(read["looks"] + w, 3);
  if (by !== "trip") read["area"] = round(read["area"] + w, 3);
  const key = String(evaluator_rating);
  read["by"][key] = round(get(read["by"], key, 0) + w, 3);
  read["find"] = pr.find(state, pid);                // the flag he holds after this look: find's hysteresis anchor
  persona.learn_from_read(state, pid, recruiting.report_looks(read));
  const after = recruiting._read_words(state, pid);
  const moved = recruiting.GROUPS.filter((g) => !same_words(get(before, g), get(after, g)));
  const entry = { week, pid, by,
    before: Object.fromEntries(moved.filter((g) => before[g] !== undefined).map((g) => [g, before[g]])),
    after: Object.fromEntries(moved.map((g) => [g, after[g]])),
    flags: recruiting._flags(state, pid).filter((f) => !flags_before.includes(f)) };
  const counts = setdefault(setdefault(rc, "look_counts", {}), String(week), {});
  counts[by] = round(get(counts, by, 0) + w, 3);
  if (moved.length || entry["flags"].length) {       // a look that changed nothing is only counted
    const tally = setdefault(setdefault(setdefault(rc, "look_changes", {}), String(week), {}), by, { changed: 0, flags: 0 });
    tally["changed"] += 1;
    tally["flags"] += entry["flags"].length ? 1 : 0;
    const log = setdefault(rc, "looks", []);
    log.push(entry);
    const mine = [];
    log.forEach((e, i) => { if (e["week"] === week && e["by"] === by) mine.push(i); });
    if (mine.length > recruiting.LOOK_LOG_KEEP) {    // the log keeps a scout's most notable looks of the week
      log.splice(maxBy(mine, (i) => [recruiting.look_notability(log[i]), -i]), 1);
    }
  }
  return entry;
}


function look_notability(e) {
  // A logged look's place in a scout's report: a flag gained first (0), then a potential change (1), then the rest (2).
  return e["flags"].length ? 0 : e["after"]["potential"] !== undefined ? 1 : 2;
}


function read_spread(state, pid, group) {
  // The read itself: (mean, half-width) in grade points, however many looks it holds, or None before
  // any look. The half-width shrinks with the precision the looks gained and with the best evaluator's
  // rating, less WORD_SLACK. The flags (prospects.find) and the tests of a read's accuracy use this;
  // what the player sees goes through read_interval.
  const read = get(state["recruiting"]["reads"], pid);
  if (!truthy(read)) return null;
  const s = _best_share(read);
  const [mean, prec] = read["g"][group];
  const half = Math.max(0.0, (0.6 + 1.1 * s) / Math.sqrt(prec) - recruiting.WORD_SLACK);
  return [mean, half];
}


function read_interval(state, pid, group) {
  // Your staff's read as the player sees it: a range of grade points while his report is short of
  // complete, and one point (the read's mean, twice) once it is complete (report_complete: 3 looks),
  // the staff's final grade; None before any look.
  const spread = recruiting.read_spread(state, pid, group);
  if (spread === null) return null;
  const [mean, half] = spread;
  if (recruiting.report_complete(get(state["recruiting"]["reads"], pid))) return [mean, mean];
  return [mean - half, mean + half];
}


function shown_range(state, pid, group, sharp = null) {
  // A read as the page shows it: the read's numbers (a narrow range once his report is complete). His potential is
  // letter grades (grades.js: low, high; the same letter twice once the read sits in one grade). Only for display:
  // code that ranks reads uses grade_range.
  let iv = recruiting.read_interval(state, pid, group);
  const clamp = (x) => String(Math.max(1, Math.min(99, round(x))));         // the game's 1-99 scale (a read's points can stray past it)
  if (!truthy(iv)) return null;
  if (group === "potential") {                                    // his overall potential is a letter grade (grades.js), never a number
    // a complete report settles on one grade: the letter is range enough
    return grades.span(iv[0], iv[1], sharp === null || sharp === undefined ? grades.fine(state) : sharp);   // `sharp`: a caller reading many passes it once
  }
  if (iv[0] === iv[1]) {                                          // a complete report: a narrow range, never one number
    const half = Math.max(2.0, recruiting.read_spread(state, pid, group)[1]);
    iv = [iv[0] - half, iv[0] + half];
  }
  return [clamp(iv[0]), clamp(iv[1])];
}


function grade_range(state, pid, group) {
  // (low, high) grade words, e.g. ("Solid", "Strong"); the same word twice once his report is
  // complete (one final grade); None before any look.
  const iv = recruiting.read_interval(state, pid, group);
  return truthy(iv) ? [recruiting.word(iv[0]), recruiting.word(iv[1])] : null;
}


function make_staff(state) {
  // Your OC and DC (evaluation = player development) and three generated recruiters, each on
  // one area: the school's own states first.
  const season = modules.season;
  const t = season.load_teams()[state["team"]];
  const rng = new Random(`staff-${get(state, "rng_state", 0)}-${state["team"]}`);
  const you = get(get(state, "career") || {}, "coach");
  const hc_name = get(you || {}, "name") || get(get(get(t, "coaches") || {}, "head_coach") || {}, "name");
  // no recruiter shares a prospect's name, a coach's or yours (coach_names: one coach, one name)
  const taken = new Set(Object.values(state["recruiting"]["prospects"]).map((p) => p["name"].toLowerCase()));
  for (const n of coach_names.base_names()) taken.add(n);
  taken.add((hc_name || "").toLowerCase());
  const staff = [];
  for (const [sid, role, key] of [["oc", "OC", "offensive_coordinator"], ["dc", "DC", "defensive_coordinator"]]) {
    const c = get(get(t, "coaches") || {}, key) || {};
    const r = get(c, "ratings") || {};
    const name = coach_names.coordinator_name(state["team"], key, get(c, "name") || "", hc_name, truthy(you)) || role;
    taken.add(name.toLowerCase());
    staff.push({ id: sid, role, name, evaluation: Math.trunc(get(r, "player_development", 60)),
      recruiting: Math.trunc(get(r, "recruiting", 60)) });
  }
  for (let i = 1; i < 4; i++) {
    const name = recruits._name(rng, taken);
    const evaluation = rng.randint(40, 80);
    staff.push({ id: `r${i}`, role: "Recruiter", name, evaluation, recruiting: rng.randint(40, 80) });
  }
  const order = [];
  for (const [st_code] of [...(get(recruiting._team_model(state["team"]), "top_states") || []), [[get(t, "state")], 0]]) {
    const codes = Array.isArray(st_code) ? st_code : [st_code];
    for (const code of codes) {
      let area = null;
      for (const [a, states] of Object.entries(recruiting.AREAS)) {
        if (states.includes(code)) { area = a; break; }
      }
      if (truthy(area) && !order.includes(area)) order.push(area);
    }
  }
  for (const a of Object.keys(recruiting.AREAS)) if (!order.includes(a)) order.push(a);
  for (let i = 0; i < Math.min(staff.length, order.length); i++) staff[i]["area"] = order[i];
  const year = get(state, "year", 2026);
  for (const member of staff) {                // signed through this season or the next one or two (offseason.js: contracts)
    member["contract_until"] = year + rng.randint(0, 2);
  }
  return staff;
}


function set_favorite(state, pid, on) {
  // Mark a prospect as one of your favorites (♥) or clear the mark: the player's own list, kept with the class (a new
  // class starts with none) and read only by the Prospects filter and the marks on the page. Nothing in recruiting reads it.
  const favs = setdefault(state["recruiting"], "favorites", []);
  if (truthy(on) && !favs.includes(pid)) favs.push(pid);
  else if (!truthy(on) && favs.includes(pid)) remove(favs, pid);
}


function set_board(state, pid, on) {
  // Put a prospect on your board or take him off; one you take off stays off, Auto-recruit
  // included, until you put him back. Taking him off pulls your offer too (the NIL comes back, a
  // verbal commit of yours decommits); a hard commit's offer stands, so he cannot come off, and
  // nor can a recruit who has signed with you.
  const rc = state["recruiting"];
  const dropped = setdefault(rc, "dropped", []);
  const me = get(state, "team");
  if (!truthy(on) && rc["status"][pid]["signed"] === me) {
    throw new recruiting.RecruitingError(409, "he has signed with you and stays on your board");
  }
  if (!truthy(on) && get(rc["offers"], me, []).includes(pid)) {
    const st = rc["status"][pid];
    if (st["committed"] === me && truthy(get(st, "hard"))) {
      throw new recruiting.RecruitingError(409, "he is a hard commit, and his offer stands until he signs");
    }
    if (!truthy(st["signed"])) recruiting.act(state, me, pid, "pull_offer");
  }
  if (truthy(on)) {
    if (!rc["board"].includes(pid)) {                    // he has signed, he will not consider you, or you are not one of his finalists (part 6)
      const out = recruiting.blocked(state, me, pid);
      if (out !== null) throw new recruiting.RecruitingError(409, out["text"]);
      rc["board"].push(pid);
    }
    if (dropped.includes(pid)) remove(dropped, pid);
  } else {
    if (rc["board"].includes(pid)) remove(rc["board"], pid);
    if (!dropped.includes(pid)) dropped.push(pid);
    delete recruiting.planned(state)[pid];              // what you had ticked for him is let go: its energy is yours again
    if (truthy(get(rc, "carry"))) delete rc["carry"][pid];
    const mine = get(rc["boards"], state["team"]);
    if (truthy(mine) && mine.includes(pid)) remove(mine, pid);
  }
}


function assign(state, staff_id, area) {
  if (recruiting.AREAS[area] === undefined) throw new recruiting.RecruitingError(400, "unknown area");
  const member = get(state["career"], "staff", []).find((m) => m["id"] === staff_id) ?? null;
  if (member === null) throw new recruiting.RecruitingError(400, "unknown staff member");
  member["area"] = area;
}


function scout_week(state, week = null) {
  // Every prospect in each staffed area gets half a look (AREA_LOOK) from the staff member there,
  // logged at `week` (default: look_week; the portal's step passes the week it opens), until his
  // area has put in AREA_CAP looks or his report is complete: then the scout passes him by. Looks
  // older than the week before are dropped from the log and the counts first: the desk keeps this
  // week's and last week's.
  const staff = get(get(state, "career") || {}, "staff") || [];
  const rc = state["recruiting"];
  if (week === null || week === undefined) week = recruiting.look_week(state);
  rc["looks"] = (get(rc, "looks") || []).filter((e) => e["week"] >= week - 1);
  for (const key of ["look_counts", "look_changes"]) {
    rc[key] = Object.fromEntries(Object.entries(get(rc, key) || {}).filter(([w]) => Math.trunc(Number(w)) >= week - 1));
  }
  const rng = new Random(`scout-${state["recruiting"]["seed"]}-${state["current_week"]}`);
  const by_state = {};
  const me = get(state, "team");
  for (const [pid, p] of Object.entries(state["recruiting"]["prospects"])) {
    const st = state["recruiting"]["status"][pid];
    if (!truthy(st["signed"]) && st["committed"] !== me) {        // a commit of yours: his file is what it was
      setdefault(by_state, p["hometown"]["state"], []).push(pid);
    }
  }
  for (const member of staff) {
    for (const code of get(recruiting.AREAS, get(member, "area"), [])) {
      for (const pid of get(by_state, code, [])) {
        if (recruiting.area_open(get(rc["reads"], pid))) {
          recruiting.look(state, pid, member["evaluation"], rng, member["id"], week, recruiting.AREA_LOOK);
        }
      }
    }
  }
}


recruiting.LEFTOVER_LOOK = 0.5;      // *tune* a Send's worth of leftover scouting points buys your staff this much of a look at the week step


function spend_leftover(state, week) {
  // The scouting points you did not spend this week, spent by your staff at the week step: each Send's price (look_cost)
  // buys a LEFTOVER_LOOK look by your best evaluator at a prospect on your board whose report is short, the least-scouted
  // first (then by rank), one each a week, while the points last. Its own seeded stream. Returns the points spent.
  const rc = state["recruiting"], me = get(state, "team");
  if (!truthy(me) || !truthy(get(state, "career"))) return 0;      // a career's staff only
  const left = recruiting.scout_points_left(state, me);            // a week you never opened the board: all of the week's points are left
  if (!truthy(left)) return 0;
  const live = (get(rc, "board") || []).filter((q) => rc["prospects"][q] !== undefined && !truthy(rc["status"][q]["signed"])
    && (rc["status"][q]["committed"] === null || rc["status"][q]["committed"] === me) && recruiting.looks_left(get(rc["reads"], q)) > 0);
  live.sort((a, b) => cmp([get(get(rc["reads"], a) || {}, "looks", 0) || 0, rc["prospects"][a]["rank"]],
    [get(get(rc["reads"], b) || {}, "looks", 0) || 0, rc["prospects"][b]["rank"]]));
  const rng = new Random(`leftover-${rc["seed"]}-${week}`);
  const rating = recruiting.best_evaluator(state);
  let spent = 0;
  for (const q of live) {
    const cost = recruiting.look_cost(state, me, q);
    if (cost > left - spent) continue;
    recruiting.look(state, q, rating, rng, null, week, recruiting.LEFTOVER_LOOK);
    spent += cost;
  }
  rc["scout_points"][me] = left - spent;
  return spent;
}


function area_open(read) {
  // Whether an area scout's look still adds to his report: under AREA_CAP from his area and not complete.
  return !recruiting.report_complete(read) && recruiting.area_looks(read) < recruiting.AREA_CAP;
}


function visible(state) {
  // The prospects you can see: everyone but the hidden ones your staff have not seen and your
  // school has not offered or landed (Auto-recruit can find them).
  const rc = state["recruiting"], me = get(state, "team");
  const mine = new Set(get(rc["offers"], me, []));
  const out = new Set();
  for (const [pid, p] of Object.entries(rc["prospects"])) {
    if (!truthy(get(p, "hidden")) || rc["reads"][pid] !== undefined || mine.has(pid)
      || me === rc["status"][pid]["committed"] || me === rc["status"][pid]["signed"]) out.add(pid);
  }
  return out;
}


function prospect_list(state) {
  // The class as you can see it (`visible`), by rank.
  const rc = state["recruiting"];
  return sorted(recruiting.visible(state), (pid) => rc["prospects"][pid]["rank"]);
}


function _set_record(state, slug, wins, losses) {
  // Tests: mark the team's first wins + losses games played, the wins first.
  const games = sorted(Object.values(state["games"]).filter((g) => (slug === g["home"] || slug === g["away"]) && g["kind"] === "regular"),
    (g) => g["week"]);
  games.slice(0, wins + losses).forEach((g, i) => {
    const won = i < wins;
    const mine_home = g["home"] === slug;
    Object.assign(g, { played: true, home_score: mine_home ? (won ? 28 : 10) : (won ? 10 : 28),
      away_score: mine_home ? (won ? 10 : 28) : (won ? 28 : 10) });
  });
}


Object.assign(recruiting, {
  _hat, _pair_ok, _last_quarterbacks, _sign, auto_mode, _asks_for_more, weekly_step, _weekly_step, _portal_draws,
  _title, no_room, _lost_why, lost_reason, lost_line, school_name, _season_line, portal_rc, _truths, word, word_band,
  look_week, _read_words, _flags, report_looks, area_looks, report_complete, looks_left, _normalize_read, look,
  look_notability, read_spread, read_interval, shown_range, grade_range, make_staff, set_favorite, set_board, assign,
  scout_week, spend_leftover, area_open, visible, prospect_list, _set_record,
});
