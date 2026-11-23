// Recruiting, part 3: what an action costs, your planned quick
// actions, a school's NIL record, home weekends for a visit, `act` (the page's one way in) with its scenes (your
// answer, Promise Him the Job, your opening), the pitch marks, the week's pending points and their flush, the weekly
// rank snapshot and report, and `_act`, the one action path every school takes.
//
// Every name of recruiting is reached through the `recruiting` namespace, whichever part defines it
// (engine_js/PORTING.md, "Big Files in Parts"). Season, scenes, word, promises, offseason, prospects and
// persona are reached through `modules` at the call.
import { Random, round, int, sum, cmp, sorted, maxBy, get, truthy, odict } from "../../engine_js/pyrt.js";
import { modules } from "../../engine_js/modules.js";
import { pypow } from "../recruits.js";
import { recruiting } from "../recruiting_ns.js";

// ----- small helpers (local to this part) --------------------------------------------------------------------

const has = (d, k) => Object.prototype.hasOwnProperty.call(d, k);

/** `x in coll` for a tuple, list, set or dict. */
const _in = (x, coll) => (coll instanceof Set ? coll.has(x) : Array.isArray(coll) ? coll.includes(x) : coll[x] !== undefined);

/** dict.setdefault(key, value): the stored value when the key is there (a stored None stays), else `value`, stored. */
function setdefault(d, k, v) {
  if (d[k] === undefined) d[k] = v;
  return d[k];
}

/** dict.pop(key, default). */
function pop(d, k, dflt = null) {
  const v = d[k];
  if (v === undefined) return dflt;
  delete d[k];
  return v;
}

/** list.remove(x): the first one. */
function remove(xs, x) {
  const i = xs.indexOf(x);
  if (i !== -1) xs.splice(i, 1);
}

/** `{k: v for k, v in d.items() if k != "reply"}`. */
function _no_reply(d) {
  const out = {};
  for (const [k, v] of Object.entries(d)) if (k !== "reply") out[k] = v;
  return out;
}

/** id(obj) for a list: a number of its own for as long as it lives (pitch_marks's cache key). */
const _ids = new WeakMap();
let _next_id = 1;
function _id(obj) {
  let n = _ids.get(obj);
  if (n === undefined) { n = _next_id++; _ids.set(obj, n); }
  return n;
}


function action_hours(state, slug, pid, action) {
  // What an action costs `slug` on this prospect: HOURS, but your invite to visit and your head coach's in-home visit
  // by the miles between his hometown and your campus (VISIT_MILES, HC_MILES; the portal keeps the flat costs).
  const table = get({ official_visit: recruiting.VISIT_MILES, hc_visit: recruiting.HC_MILES }, action);
  if (truthy(table) && slug === get(state, "team") && !recruiting.is_portal(state)) {
    const [loc, home] = [get(recruiting._team_model(slug), "location"), get(state["recruiting"]["prospects"][pid], "home")];
    if (truthy(loc) && truthy(home)) {
      const miles = recruiting._miles([loc[0], loc[1]], [home[0], home[1]]);
      for (const [upto, cost] of table) if (upto === null || miles <= upto) return cost;
      throw new Error("StopIteration");                // (never reached: the tables end with a null floor)
    }
  }
  return recruiting.HOURS[action];
}


function planned(state) {
  // Your planned quick actions ({pid: [actions]}): ticked on his row, sent at the week step. One for a recruit you
  // have since taken off your board is let go here, so its energy is yours again (set_board lets it go at once; this
  // is for a save made before it did: the player's "i removed recruits that had actions sent on them and my energy
  // is still gone").
  const rc = state["recruiting"];
  const plans = setdefault(rc, "planned", {});
  const dropped = get(rc, "dropped") || [];
  if (dropped.length) for (const pid of Object.keys(plans)) if (dropped.includes(pid)) delete plans[pid];
  return plans;
}


function hours_planned(state) {
  // The energy your plans hold.
  const costs = [];
  for (const acts of Object.values(recruiting.planned(state))) for (const a of acts) costs.push(recruiting.HOURS[a]);
  return sum(costs);
}


function hours_free(state, slug) {
  // The energy `slug` has left to spend: for you, less what your plans hold.
  return recruiting._hours(state, slug) - (slug === get(state, "team") ? recruiting.hours_planned(state) : 0);
}


function plan(state, pid, action, on) {
  // Tick or untick a quick action on a recruit (PLANNABLE): it holds its energy now and goes out at the week step, so
  // you can move it to someone else until then. Returns your plans for him and the energy left. Raises RecruitingError.
  const [rc, me] = [state["recruiting"], get(state, "team")];
  if (recruiting.closed(state)) throw new recruiting.RecruitingError(409, recruiting.CLOSED_TEXT);
  if (!_in(action, recruiting.PLANNABLE) || !has(rc["prospects"], pid)) throw new recruiting.RecruitingError(400, "That is not something to plan.");
  const mine = setdefault(recruiting.planned(state), pid, []);
  if (truthy(on) && !mine.includes(action)) {
    const st = rc["status"][pid];
    if (truthy(st["signed"]) || (truthy(st["committed"]) && st["committed"] !== me && truthy(get(st, "hard")))) {
      throw new recruiting.RecruitingError(409, "He is not taking calls.");
    }
    const out = recruiting.blocked(state, me, pid);
    if (out !== null) throw new recruiting.RecruitingError(409, out["text"]);
    if (get(get(recruiting._contact(state, me, pid), "week") || {}, action) === recruiting.contact_week(state)) {
      throw new recruiting.RecruitingError(409, "Done this week.");
    }
    if (recruiting.hours_free(state, me) < recruiting.HOURS[action]) throw new recruiting.RecruitingError(409, "Not enough energy left this week.");
    mine.push(action);
  } else if (!truthy(on) && mine.includes(action)) {
    remove(mine, action);
  }
  if (!mine.length) pop(recruiting.planned(state), pid, null);
  return { planned: Array.from(get(recruiting.planned(state), pid, [])), hours_left: recruiting.hours_free(state, me) };
}


function _run_planned(state) {
  // Send your planned quick actions (the week step's first move, before the week's contacts land). One that can no
  // longer be made (he signed, he committed hard elsewhere) is dropped and its energy was never spent.
  const [rc, me] = [state["recruiting"], get(state, "team")];
  let plans = pop(rc, "planned", null);
  if (!truthy(plans)) plans = {};
  for (const [pid, acts] of Object.entries(plans)) {
    for (const action of acts) {
      try {
        recruiting._act(state, me, pid, action, null, 0, undefined, undefined, undefined, undefined, undefined, action !== "call", action === "call");
      } catch (e) {
        if (!(e instanceof recruiting.RecruitingError)) throw e;
      }
    }
  }
  rc["carry"] = plans;               // ticked again next week (the player's ask), see _carry_planned
}


function _carry_planned(state) {
  // The week step's last move: the quick actions you sent stay ticked for the new week, so a recruit you work every
  // week needs no new clicks; one who committed or signed this week is let go, and so is whatever the new week's energy
  // cannot hold.
  const [rc, me] = [state["recruiting"], get(state, "team")];
  let plans = pop(rc, "carry", null);
  if (!truthy(plans)) plans = {};
  if (!truthy(plans) || recruiting.closed(state)) return;      // (nothing planned: the new week's energy record is left unopened)
  let left = recruiting.hours_free(state, me);
  for (const [pid, acts] of Object.entries(plans)) {
    const st = get(rc["status"], pid);
    if (!truthy(st) || truthy(st["signed"]) || truthy(st["committed"]) || recruiting.blocked(state, me, pid) !== null) continue;
    if ((get(rc, "dropped") || []).includes(pid)) continue;        // you took him off your board: nothing is ticked for him again
    for (const action of acts) {
      if (_in(action, recruiting.PLANNABLE) && recruiting.HOURS[action] <= left && !get(recruiting.planned(state), pid, []).includes(action)) {
        setdefault(recruiting.planned(state), pid, []).push(action);
        left -= recruiting.HOURS[action];
      }
    }
  }
}


function _nil(state, slug) {
  // The school's NIL record this block: in the portal its pool; in the class the year's budget
  // plus last year's carry-over, consumed once when the record is created.
  let n = get(state["recruiting"]["nil"], slug);
  if (n === null) {
    if (recruiting.is_portal(state)) {
      n = { budget: recruiting.portal_budget(state, slug), held: {} };
    } else {                                  // the carry is next season's: the old class block (the offseason still open) leaves it alone
      const carry = !truthy(get(state, "offseason")) ? int(pop(get(state, "nil_carry") || {}, slug, 0) || 0) : 0;
      n = { budget: recruiting.nil_budget(state, slug) + carry, held: {} };
      if (carry) n["carry"] = carry;
    }
    state["recruiting"]["nil"][slug] = n;
  }
  return n;
}


function nil_left(state, slug) {
  const n = recruiting._nil(state, slug);
  return n["budget"] - sum(Object.values(n["held"]));
}


function _home_game_left(state, slug, pid = null) {
  // The school's first home game still to play; with `pid`, the first weekend he has free: one
  // official visit a weekend (he was booked at three schools for the same Saturday).
  const taken = new Set();
  if (truthy(pid)) {
    for (const [s, v] of Object.entries(get(state["recruiting"]["visits"], pid) || {})) if (s !== slug) taken.add(v["week"]);
  }
  const weeks = [];
  for (const g of Object.values(state["games"])) {
    if (g["home"] === slug && g["kind"] === "regular" && !truthy(g["played"]) && g["week"] > state["current_week"] && !taken.has(g["week"])) {
      weeks.push(g["week"]);
    }
  }
  return weeks.length ? Math.min(...weeks) : null;
}


function home_weekends(state, slug) {
  // The school's regular-season home games still to play after this week, in order, as the visit picker
  // lists them: {week, label (the week's label), opponent, opponent_name, opponent_rank (the current top 25,
  // or None)}. One list per view: `visit_weekends` adds what is per prospect.
  const season = modules.season;
  const teams = season.load_teams();
  const ranks = season.rank_map(state, state["current_week"]);
  const games = sorted(Object.values(state["games"]).filter((g) => g["home"] === slug && g["kind"] === "regular" && !truthy(g["played"])
    && g["week"] > state["current_week"]), (g) => g["week"]);
  return games.map((g) => ({
    week: g["week"], label: season.week_label(g["week"]), opponent: g["away"],
    opponent_name: season.team_display(g["away"], teams), opponent_rank: get(ranks, g["away"]),
  }));
}


function visit_weekends(state, slug, pid, homes = null) {
  // The school's home weekends for him: `home_weekends` plus `taken_by` (the name of the school he
  // visits that weekend, or None) and `first` (the one the game books without a week picked).
  homes = homes === null ? recruiting.home_weekends(state, slug) : homes;
  const taken = new Map();
  for (const [s, v] of Object.entries(get(state["recruiting"]["visits"], pid) || {})) if (s !== slug) taken.set(v["week"], s);
  const out = [];
  let seen = false;
  for (const h of homes) {
    const held = taken.has(h["week"]) ? taken.get(h["week"]) : null;
    const first = held === null && !seen;
    seen = seen || first;
    out.push({ ...h, taken_by: truthy(held) ? recruiting.school_name(held) : null, first });
  }
  return out;
}


function manual_offers(state, slug) {
  // Your offers made by hand (through `act`), which Auto-recruit never pulls; empty for any
  // other school (Auto-recruit's own offers and the AI's are never marked).
  if (slug !== get(state, "team")) return new Set();
  return new Set(get(state["recruiting"], "manual_offers") || []);
}


function _unmark(state, slug, pid) {
  // Your offer to him is gone (pulled by hand, or lapsed when he signed): its hand mark goes too.
  if (slug === get(state, "team")) {
    const marks = get(state["recruiting"], "manual_offers");
    if (truthy(marks) && marks.includes(pid)) remove(marks, pid);
  }
}


recruiting._LAST_LOOK = [null];      // the trip's look entry, for the scout action's response


function act(state, slug, pid, action, pitch = null, nil = 0, scene = null, answer = null, topics = null, week = null) {
  // One recruiting action by `slug` on prospect `pid` this week. Its interest lands at the week
  // step (you see his list move next week), so this returns no interest. Your call or in-home visit
  // without a pitch opens a scene (returned); `answer` with the scene's id fields his question
  // (`_answer`); `pitch` with the scene's id finishes it and returns his reaction. `week`: the home
  // weekend an official visit is for (none: his first free one). Raises RecruitingError.
  const rc = state["recruiting"];
  if (recruiting.closed(state)) throw new recruiting.RecruitingError(409, recruiting.CLOSED_TEXT);
  if (action === "answer") return recruiting._answer(state, slug, pid, scene, answer);
  if (action === "promise_job") return recruiting._promise_job(state, slug, pid, scene);
  if (action === "present") return recruiting._present(state, slug, pid, scene, topics);
  if (action === "pitch") {
    const sc = get(get(get(rc, "scenes") || {}, slug) || {}, pid);
    const start = rc["log"].length;
    const scenes = modules.scenes;
    const revealed = recruiting._act(state, slug, pid, action, pitch, nil, undefined, scene);
    const tired = rc["log"].slice(start).some((e) => e["kind"] === "pester");      // the call or visit pestered him: the pitch fell flat
    const said = scenes.reaction(state, slug, pid, pitch, tired);
    if (slug === get(state, "team")) {              // your History: the pitch and how he took it
      recruiting._event(state, "pitch", pid, slug, { action: sc["action"], pitch, reaction: said["kind"] });
    }
    return {
      hours_left: rc["hours"][slug], reaction: { ...said, revealed },
      money_owed: pitch === "nil" ? recruiting.money_owed(state, slug, pid) : null,
    };
  }
  // a quick call (the player's ask): after his first call, or once your head coach has visited him, Call just spends
  // the hours for a slight boost; Call and Pitch opens the conversation as before
  const you = slug === get(state, "team");
  const quick = you && action === "call" && answer === "quick";
  if (you && action === "promise_role") {                 // the starting job, free, once he holds your offer (the player's ask)
    if (!get(rc["offers"], slug, []).includes(pid)) throw new recruiting.RecruitingError(409, "Offer him first.");
    if (truthy(recruiting._open_roster_promise(recruiting._contact(state, slug, pid)))) {
      throw new recruiting.RecruitingError(409, "You already promised him the job.");
    }
    return { hours_left: recruiting.hours_free(state, slug), revealed: null, promise: _no_reply(recruiting._job_promise(state, slug, pid, "offer")) };
  }
  if (you && has(recruiting.HOURS, action) && recruiting.hours_free(state, slug) < recruiting.action_hours(state, slug, pid, action)) {
    throw new recruiting.RecruitingError(409, "Not enough energy left this week.");
  }
  const opens = you && _in(action, recruiting.SCENES) && pitch === null && !quick;
  const manual = you && ["message", "offer", "call_recruit"].includes(action);
  if (manual) pitch = null;                               // the player's ask: no pitch on a message or an offer
  if (manual && action === "offer" && answer === "promise" && truthy(recruiting._open_roster_promise(recruiting._contact(state, slug, pid)))) {
    throw new recruiting.RecruitingError(409, "You already promised him the job.");
  }
  const revealed = recruiting._act(state, slug, pid, action, pitch, nil, undefined, undefined, opens, undefined, week, manual, quick);
  if (["offer", "raise_nil"].includes(action) && slug === get(state, "team")) {     // your offer or your NIL by hand: Auto-recruit leaves it be
    const marks = setdefault(rc, "manual_offers", []);
    if (!marks.includes(pid)) marks.push(pid);
  }
  const out = { hours_left: recruiting.hours_free(state, slug), revealed };
  if (manual && action === "offer" && answer === "promise") {     // the offer carries the job: worth more where playing time is his
    out["promise"] = _no_reply(recruiting._job_promise(state, slug, pid, "offer"));
  }
  if (action === "scout") {                               // the desk shows the trip's before/after from this, and the like a completed report earned
    const pr = modules.prospects;
    out["look"] = { ...recruiting._LAST_LOOK[0], likes: pr.staff_likes(state, pid, slug) };
    const read = get(rc["reads"], pid);                   // his looks and the read's potential range now: an open list patches its row from these
    out["looks"] = pr.looks_out(read);
    out["potential"] = truthy(read) ? recruiting.shown_range(state, pid, "potential") : null;
  }
  if (opens) out["scene"] = rc["scenes"][slug][pid];
  return out;
}


function clear_scenes(state, slug) {
  // Drop the school's open scenes (Auto-recruit took over): no points, the hours stay spent.
  pop(get(state["recruiting"], "scenes") || {}, slug, null);
}


function _answer(state, slug, pid, scene, answer) {
  // Your answer to the open scene's question (spec section 3), no hours: straight earns
  // ANSWER_STRAIGHT and tells you he cares about playing time; a promise earns ANSWER_PROMISE when
  // he can believe it (`promise_holds`) and
  // otherwise costs ANSWER_HOLLOW and cools him a week; a deflection does nothing. The points go on
  // the scene's action; the answer and his reply are kept on the scene, a promise on his contact.
  // A Package Deal's question ("package", about his mate): straight earns ANSWER_STRAIGHT plus
  // PACKAGE_OFFERED when his mate already holds your offer and nothing otherwise (you will look at
  // him); a promise earns nothing now and waits on the offer (`_promises`: kept within
  // PACKAGE_PROMISE_WEEKS for PACKAGE_KEPT, broken after). Your promise is worth ANSWER_PROMISE times Keeps His Word's
  // promise_mult; under its floor he doesn't believe you: nothing, and his line names the last promise you broke at his
  // position.
  const [scenes, word, persona] = [modules.scenes, modules.word, modules.persona];
  const rc = state["recruiting"];
  const p = get(rc["prospects"], pid);
  if (p === null) throw new recruiting.RecruitingError(400, "unknown prospect");
  if (answer === null) throw new recruiting.RecruitingError(422, "answer is required");
  if (!_in(answer, scenes.ANSWERS)) throw new recruiting.RecruitingError(400, "unknown answer");
  const sc = get(get(get(rc, "scenes") || {}, slug) || {}, pid);
  if (sc === null || scene === null || sc["id"] !== scene) throw new recruiting.RecruitingError(409, "no call or visit open");
  const q = get(sc, "question");
  if (!truthy(q)) throw new recruiting.RecruitingError(409, "he asked nothing");
  if (truthy(get(q, "answer"))) throw new recruiting.RecruitingError(409, "you already answered");
  const contact = recruiting._contact(state, slug, pid);
  const week = state["current_week"];
  let [points, truthful, doubted] = [0.0, null, false];
  const revealed = [];
  const package_ = get(q, "kind") === "package";
  if (package_) {
    const offered = get(rc["offers"], slug, []).includes(q["about"]["pid"]);
    q["about"]["offered"] = offered;                                  // as it stands when you answer
    if (answer === "straight" && offered) {
      points = recruiting.ANSWER_STRAIGHT + recruiting.PACKAGE_OFFERED;
    } else if (answer === "promise" && !(get(contact, "promises") || []).some((pr) => pr["kind"] === "package"
      && get(get(pr, "about") || {}, "pid") === q["about"]["pid"] && !truthy(get(pr, "broken")) && get(pr, "closed") === null)) {   // one promise per mate
      setdefault(contact, "promises", []).push({ kind: "package", about: { ...q["about"] }, week, broken: null, kept: null });
    }
  } else if (answer === "straight") {
    points = recruiting.ANSWER_STRAIGHT;
    const seen = setdefault(setdefault(rc["revealed"], slug, {}), pid, []);
    if (!seen.includes("playing_time")) {
      seen.push("playing_time");
      revealed.push("playing_time");
    }
  } else if (answer === "promise") {
    if (truthy(recruiting._open_roster_promise(contact))) {               // Promise Him the Job already made it: one per recruit, both ways
      throw new recruiting.RecruitingError(409, "You already promised him the job.");
    }
    truthful = recruiting.promise_holds(state, slug, pid, q);
    const group = recruiting._group_of(p);
    if (truthy(truthful) && slug === get(state, "team") && !word.believes(state, group)) {   // Keeps His Word under the floor: he doesn't believe you
      doubted = true;
    } else if (truthy(truthful)) {
      points = recruiting.ANSWER_PROMISE * (slug === get(state, "team") ? word.promise_mult(state, pid, group) : 1.0);
    } else {
      points = -recruiting.ANSWER_HOLLOW * persona.hollow_mult(state, pid, slug);
      contact["cooled_until"] = week + 1;
      persona.set_cooled_why(state, slug, pid, "promise");
      recruiting._event(state, "not_buying", pid, slug, { topic: "playing_time" });
    }
    setdefault(contact, "promises", []).push({ kind: q["kind"], about: q["about"], week, broken: null });
  }
  q["answer"] = answer;
  if (doubted) {
    const name = word.last_broken(state, recruiting._group_of(p));
    q["reply"] = truthy(name) ? scenes.WORD_DOUBT.split("{name}").join(name) : scenes.WORD_DOUBT_ANY;
  } else {
    q["reply"] = scenes.answer_reply(state, slug, pid, q, answer, truthful);
  }
  recruiting._event(state, "answer", pid, slug, {
    action: sc["action"], answer, about: q["about"]["name"], truthful,
    ...(package_ ? { question: "package", offered: Boolean(truthy(get(q["about"], "offered"))) } : {}),
    ...(doubted ? { doubted: true } : {}),
  });
  if (points) recruiting._add_points(state, slug, pid, points, sc["action"]);
  const hours = recruiting._hours(state, slug);           // (worked out before the lookup, whether or not it is used)
  return { scene: sc, points, truthful, revealed, hours_left: get(rc["hours"], slug, hours) };
}


recruiting.PITCH_MARK = { sold: "sold", hit: "hit", fair: "fair", lukewarm: "lukewarm", quiet: "weak", polite: "not_his", tired: "no_read" };   // his reaction -> the mark the page shows


recruiting._MARKS = new Map();       // (career, school, log identity, log length) -> {pid: marks}: one pass over the log per view


function _marks_index(state, slug) {
  // Every prospect's pitch marks for `slug` in one pass over the log (pitch_marks's rules).
  const out = {};
  for (const e of get(state["recruiting"], "log") || []) {
    if (get(e, "school") !== slug) continue;
    let seen;
    if (get(e, "kind") === "pitch" && truthy(get(e, "pitch"))) {
      seen = [[e["pitch"], get(recruiting.PITCH_MARK, get(e, "reaction"), "no_read")]];
    } else if (get(e, "kind") === "present") {
      seen = Array.from(get(e, "topics") || [], (t) => [t, "no_read"]);
    } else {
      continue;
    }
    const mine = setdefault(out, get(e, "pid"), {});
    for (const [topic, mark] of seen) {
      if (mark === "no_read" && has(mine, topic) && mine[topic]["mark"] !== "no_read") continue;
      mine[topic] = { mark, week: get(e, "week"), action: get(e, "action") };
    }
  }
  return out;
}


function pitch_marks(state, slug, pid) {
  // What he said about each topic your school pitched him (your History): {topic: {"mark", "week", "action"}}. The mark
  // is "sold", "hit" (He Lit Up), "fair", "lukewarm", "weak" (he isn't buying it: he cares, your case is too far from what
  // he wants), "not_his" (Not His Thing: polite, not one of his
  // priorities) or "no_read" (tired, or one of your opening's three, which reads no single topic). The latest real
  // read wins and a No Read never hides one. A topic you never pitched has no entry. The log is read once per view
  // (_marks_index, cached on the log's length).
  let log = get(state["recruiting"], "log");
  if (!truthy(log)) log = [];
  const key = JSON.stringify([get(state, "id"), slug, _id(log), log.length]);
  let idx = recruiting._MARKS.get(key);
  if (idx === undefined) {
    if (recruiting._MARKS.size > 64) recruiting._MARKS.clear();
    idx = recruiting._marks_index(state, slug);
    recruiting._MARKS.set(key, idx);
  }
  return { ...(get(idx, pid) || {}) };
}


recruiting.JOB_PRIORITY = 1.5;         // *tune* a job promise is worth this much more when playing time is one of his priorities ...
recruiting.JOB_NOT_PRIORITY = 0.5;     // *tune* ... and this much when it is not
recruiting.JOB_CROWD = 0.6;            // *tune* worth this much less for each open promise you already hold at his position
recruiting.JOB_CROWD_DOUBT = 0.25;     // *tune* his chance to hear it as hollow, for each such promise (its own seeded draw)
recruiting.JOB_STRAIN_FIRM = 10;       // *tune* the firmness a committed earlier promise loses when you promise the job again
recruiting.JOB_STRAIN_SCORE = 0.1;     // *tune* a promised roster player's season score loses this for each strain (promises.score)


function _open_roster_promise(c) {
  for (const pr of get(c, "promises") || []) {
    if (pr["kind"] === "roster" && get(pr, "broken") === null && get(pr, "closed") === null) return pr;
  }
  return null;
}


function job_crowd(state, slug, group, but) {
  // The open starting-job promises at a position group other than `but`'s: recruits holding an open roster promise
  // from you (uncommitted or committed to you) and your promised roster players (this season's, or next year's roster in
  // the portal). Each: {"kind": "recruit"|"player", "id", "name"}.
  const rc = state["recruiting"];
  const out = [];
  for (const [pid, by] of Object.entries(get(rc, "contacts") || {})) {
    const c = get(by, slug);
    if (pid === but || !truthy(c) || !has(rc["prospects"], pid) || recruiting._group_of(rc["prospects"][pid]) !== group
      || !truthy(recruiting._open_roster_promise(c))) continue;
    const st_ = rc["status"][pid];
    if ((truthy(st_["signed"]) && st_["signed"] !== slug) || (truthy(st_["committed"]) && st_["committed"] !== slug)) continue;
    out.push({ kind: "recruit", id: pid, name: rc["prospects"][pid]["name"] });
  }
  const [offseason, promises, season] = [modules.offseason, modules.promises, modules.season];
  let rows;
  if (recruiting.is_portal(state)) {
    const year = get(get(state, "offseason") || {}, "year") || season.season_year(state) + 1;
    rows = (get(get(get(get(state, "league") || {}, "teams", {}), slug) || {}, "roster") || []).filter((c) => get(c, "promised") === year);
  } else {
    rows = slug === get(state, "team") ? Object.values(promises.promised_now(state)) : [];
  }
  for (const c of rows) {
    if (get(offseason.GROUP, c["pos"]) === group) out.push({ kind: "player", id: c["id"], name: get(c, "n") || "" });
  }
  return out;
}


function rival_stamp(state) {
  // When he heard you promised his job again: [season week, portal week] (the season's week stands still in the portal).
  const rc = get(state, "recruiting") || {};
  return [get(state, "current_week") || 0, truthy(get(rc, "portal")) ? (get(rc, "week") || 0) : 0];
}


function _strain(state, slug, crowd, week) {
  // You promised the job again at his position: each earlier promise hears it. A recruit still deciding cools and will
  // bring it up (heard_rival); one committed to you (not a hard commit) loses JOB_STRAIN_FIRM; a promised player's season
  // takes a strain (promises.add_strain).
  const [promises, scenes, season, persona] = [modules.promises, modules.scenes, modules.season, modules.persona];
  const rc = state["recruiting"];
  for (const x of crowd) {
    if (x["kind"] === "recruit") {
      const [pid, st_] = [x["id"], rc["status"][x["id"]]];
      const c = recruiting._contact(state, slug, pid);
      if (st_["committed"] === slug) {
        if (!truthy(get(st_, "hard"))) {
          st_["firmness"] = int(Math.max(0, (get(st_, "firmness") || recruiting.FIRM_START) - recruiting.JOB_STRAIN_FIRM));
        }
      } else {
        c["cooled_until"] = week + recruiting.COOL_WEEKS;
        persona.set_cooled_why(state, slug, pid, "promise");
      }
      c["heard_rival"] = recruiting.rival_stamp(state);
      recruiting._event(state, "promise_strained", pid, slug, { line: scenes.HEARD_RIVAL });
    } else {
      const year = recruiting.is_portal(state) ? get(get(state, "offseason") || {}, "year") : season.season_year(state);
      promises.add_strain(state, year || season.season_year(state), x["id"]);
    }
  }
}


function _promise_job(state, slug, pid, scene) {
  // Promise Him the Job on an open call or visit, asked or not (the player's November 11 ask): a roster promise like
  // his question's, worth ANSWER_PROMISE times Keeps His Word's promise_mult, JOB_PRIORITY when playing time is one of
  // his priorities (else JOB_NOT_PRIORITY) and JOB_CROWD for each open promise you hold at his position, where his own
  // draw may hear it as hollow (JOB_CROWD_DOUBT each). A promise he can't believe (a better returning starter) costs what
  // a hollow promise costs and cools him. Under Keeps His Word's floor he doubts it. One per recruit; your school only.
  // The earlier promises at his position take the strain (_strain).
  const scenes = modules.scenes;
  if (slug !== get(state, "team")) throw new recruiting.RecruitingError(400, "only your school promises the job");
  const rc = state["recruiting"];
  const p = get(rc["prospects"], pid);
  if (p === null) throw new recruiting.RecruitingError(400, "unknown prospect");
  const sc = get(get(get(rc, "scenes") || {}, slug) || {}, pid);
  if (sc === null || scene === null || sc["id"] !== scene) throw new recruiting.RecruitingError(409, "no call or visit open");
  if (truthy(recruiting._open_roster_promise(recruiting._contact(state, slug, pid)))) {
    throw new recruiting.RecruitingError(409, "You already promised him the job.");
  }
  const out = recruiting._job_promise(state, slug, pid, sc["action"]);
  setdefault(sc, "turns", []).push({ who: "you", text: scenes.JOB_SAID }, { who: "him", text: out["reply"] });
  sc["job"] = true;
  const hours = recruiting._hours(state, slug);           // (worked out before the lookup, whether or not it is used)
  return {
    scene: sc, points: out["points"], truthful: out["truthful"], doubted: out["doubted"], crowded: out["crowded"],
    hours_left: get(rc["hours"], slug, hours),
  };
}


function _job_promise(state, slug, pid, action) {
  // The starting-job promise itself, made on a call or visit (_promise_job) or with your offer (act, answer "promise"):
  // see _promise_job for what it is worth. Records the promise and its History line and adds its points. Returns points,
  // his reply, truthful, doubted, crowded.
  const [scenes, word, persona] = [modules.scenes, modules.word, modules.persona];
  const rc = state["recruiting"];
  const p = rc["prospects"][pid];
  const contact = recruiting._contact(state, slug, pid);
  const week = state["current_week"];
  const group = recruiting._group_of(p);
  let about = recruiting.ahead_of(state, slug, pid);
  if (!truthy(about)) about = { name: null, ovr: 0, last_year: true, cls: null };
  const truthful = recruiting.promise_holds(state, slug, pid, { kind: "roster", about });
  const crowd = recruiting.job_crowd(state, slug, group, pid);
  const rng = new Random(`promise-job-${rc["seed"]}-${slug}-${pid}-${week}`);
  const crowded = crowd.length > 0 && rng.random() < recruiting.JOB_CROWD_DOUBT * crowd.length;
  const doubted = truthful && !word.believes(state, group);
  let points, reply;
  if (truthy(doubted)) {
    points = 0.0;
    reply = truthy(word.last_broken(state, group)) ? scenes.WORD_DOUBT.split("{name}").join(word.last_broken(state, group)) : scenes.WORD_DOUBT_ANY;
  } else if (truthy(truthful) && !crowded) {
    const mult = _in("playing_time", p["priorities"]) ? recruiting.JOB_PRIORITY : recruiting.JOB_NOT_PRIORITY;
    points = recruiting.ANSWER_PROMISE * word.promise_mult(state, pid, group) * mult * pypow(recruiting.JOB_CROWD, crowd.length);
    reply = scenes.REPLY_LINES["promise"];
  } else {
    points = -recruiting.ANSWER_HOLLOW * persona.hollow_mult(state, pid, slug);
    reply = truthy(truthful) ? scenes.REPLY_LINES["crowded"] : scenes.REPLY_LINES["hollow"];
    contact["cooled_until"] = week + 1;
    persona.set_cooled_why(state, slug, pid, "promise");
    recruiting._event(state, "not_buying", pid, slug, { topic: "playing_time" });
  }
  setdefault(contact, "promises", []).push({ kind: "roster", about, week, broken: null, job: true });
  recruiting._event(state, "answer", pid, slug, {
    action, answer: "promise", about: get(about, "name"), truthful, job: true, line: "You told him the job is his.",
    ...(truthy(doubted) ? { doubted: true } : {}), ...(crowded ? { crowded: true } : {}),
  });
  if (points) recruiting._add_points(state, slug, pid, points, action);
  if (crowd.length) recruiting._strain(state, slug, crowd, week);
  return { points, reply, truthful, doubted, crowded };
}


function _present(state, slug, pid, scene, topics) {
  // Your opening on the open scene (scenes.present), no hours: three different topics, scored
  // against his true priorities (he answers each with a Yes or No). Each that is one of his earns PRESENT_HIT of
  // the action's base times PRESENT_WORTH for how he takes it (reaction_kind: your letter there against what he
  // wants); one he isn't buying costs BACKFIRE_COST of that share; the rest add nothing; the total caps at the
  // base. His priorities
  // include his decider's topic, and his personality and decider scale each share and the cap as they
  // do a pitch (persona.pitch_mult: a Shy recruit's visit, his first call, a visit on the decider's
  // topic). The points are the
  // call's or visit's (diminished by his earlier contacts, halved while he is cooled, nothing while
  // the call pesters him) and land through `_add_points` on the scene's action. His answers and
  // his question join the scene; it remembers what you presented.
  const [scenes, persona] = [modules.scenes, modules.persona];
  const rc = state["recruiting"];
  const p = get(rc["prospects"], pid);
  if (p === null) throw new recruiting.RecruitingError(400, "unknown prospect");
  const sc = get(get(get(rc, "scenes") || {}, slug) || {}, pid);
  if (sc === null || scene === null || sc["id"] !== scene) throw new recruiting.RecruitingError(409, "no call or visit open");
  if (truthy(get(sc, "presented"))) throw new recruiting.RecruitingError(409, "you already presented");
  if (!Array.isArray(topics) || topics.length !== 3 || new Set(topics).size !== 3 || topics.some((t) => !_in(t, recruiting.PITCHES))) {
    throw new recruiting.RecruitingError(400, "present exactly three different topics");
  }
  const contact = recruiting._contact(state, slug, pid);
  const st_ = recruiting.strengths(state, slug, pid);
  const action = sc["action"];
  const base = recruiting.BASE_POINTS[action];
  const first_call = action === "call" && !truthy(get(contact, "calls"));      // a scene's call is counted when its pitch lands
  const mult = {};
  for (const t of topics) {
    mult[t] = persona.pitch_mult(state, pid, action, t, first_call) * persona.story_mult(state, slug, pid, t) * persona.twist_mult(state, slug, pid, t);
  }
  const [hits, back] = [[], []];
  let raw = 0.0;
  for (const t of topics) {
    if (!persona.counts_as_priority(state, pid, t)) continue;          // his priorities, or his decider's topic
    const kind = recruiting.reaction_kind(state, slug, pid, t, st_[t]);   // your letter there against what he wants
    if (kind === "quiet") {
      back.push(t);
      raw -= recruiting.BACKFIRE_COST * recruiting.PRESENT_HIT * base;
    } else {
      hits.push(t);
      raw += recruiting.PRESENT_HIT * base * recruiting.PRESENT_WORTH[kind] * mult[t];
    }
  }
  raw *= raw > 0 ? recruiting.move_mult(state, slug, pid) : 1.0;       // the further your program is from what he wants, the less it moves him
  const cap = base * Math.max(persona.pitch_mult(state, pid, action, null, first_call), ...topics.map((t) => mult[t]));   // his personality scales the cap too
  const tired = recruiting.would_pester(state, slug, pid);
  let points = truthy(tired) ? 0.0 : Math.min(raw, cap) / (1 + recruiting.DIMINISH * contact["n"]);
  if (points && recruiting.cooled(state, slug, pid)) points *= recruiting.COOLED_CONTACT;
  if (points < 0) recruiting._event(state, "not_buying", pid, slug, { topic: back[0] });
  scenes.present(state, slug, pid, sc, topics, hits, back, tired);
  recruiting._event(state, "present", pid, slug, { action, topics: Array.from(topics), hit: hits.length });
  if (points) recruiting._add_points(state, slug, pid, points, sc["action"]);
  const hours = recruiting._hours(state, slug);           // (worked out before the lookup, whether or not it is used)
  return { scene: sc, points, hit: hits, hours_left: get(rc["hours"], slug, hours) };
}


recruiting.REPORTS_KEPT = 4;          // weekly reports kept (the Office shows the latest)
recruiting.MOVES_SHOWN = 3;           // the biggest movers on his list a report names


function _add_points(state, slug, pid, points, action) {
  // Interest from an action this week: pending until the week step, with what earned it (a Quiet
  // Commit's interest in the other schools does not climb).
  const rc = state["recruiting"];
  points = modules.persona.climbs(state, slug, pid, points);
  const sofar = get(get(rc["pending"], pid, {}), slug, 0.0) + points;      // (the right side is read before the left is made)
  setdefault(setdefault(rc, "pending", {}), pid, {})[slug] = sofar;
  const why = setdefault(setdefault(setdefault(rc, "why_week", {}), pid, {}), slug, {});
  why[action] = get(why, action, 0.0) + points;
  const tally = setdefault(setdefault(rc, "action_points", {}), action, [0, 0.0]);
  tally[0] += 1;
  tally[1] += points;
}


function pending(state, slug, pid) {
  return get(get(get(state["recruiting"], "pending") || {}, pid, {}), slug, 0.0);
}


function points_now(state, slug, pid) {
  // His list points for the school as they stand: landed plus this week's pending.
  return get(state["recruiting"]["lists"][pid], slug, 0.0) + recruiting.pending(state, slug, pid);
}


function _flush(state, week) {
  // The week's pending interest lands on the lists; each school's top reason is kept for the moves.
  const rc = state["recruiting"];
  for (const [pid, by] of Object.entries(get(rc, "pending") || {})) {
    for (const [slug, pts] of Object.entries(by)) rc["lists"][pid][slug] = get(rc["lists"][pid], slug, 0.0) + pts;
  }
  for (const [pid, by] of Object.entries(get(rc, "why_week") || {})) {
    for (const [slug, acts] of Object.entries(by)) {
      const top = maxBy(Object.entries(acts), (kv) => Math.abs(kv[1]));
      setdefault(setdefault(rc, "why", {}), pid, {})[slug] = { week, action: top[0], points: round(top[1], 2) };
    }
  }
  [rc["pending"], rc["why_week"]] = [{}, {}];
  if (truthy(get(rc, "scenes"))) {              // a call or visit you never finished: no points, a line in the report
    const me = get(state, "team");
    for (const [pid, sc] of Object.entries(get(rc["scenes"], me) || {})) recruiting._event(state, "hung_up", pid, me, { action: sc["action"] });
    rc["scenes"] = {};
  }
}


function _snapshot_ranks(state, week) {
  // Every prospect's list as of this week step: each school's rank (the week before kept for the moves).
  const rc = state["recruiting"];
  const win = recruiting._winning(state);
  const ranks = setdefault(rc, "ranks", {});
  let changed = 0;
  const offered = {};                      // each prospect's offers, turned round once (asking every school about every prospect took a quarter second)
  for (const [s, pids] of Object.entries(rc["offers"])) {
    for (const pid of pids) setdefault(offered, pid, new Set()).add(s);
  }
  for (const [pid, lst] of Object.entries(rc["lists"])) {
    // (a Set, walked in the order built: his list's schools as they were added, then his other offers. The order
    // only shows between two schools of exactly equal interest)
    const schools = new Set([...Object.keys(lst), ...(offered[pid] || [])]);
    if (!schools.size) continue;
    const order = sorted(schools, (s) => -recruiting.interest(state, s, pid, win));
    const now = {};
    order.forEach((s, i) => { now[s] = i + 1; });
    const prev = get(get(ranks, pid) || {}, "now");
    if (truthy(prev) && Object.keys(prev)[0] !== order[0] && Math.min(...Object.values(prev)) === 1 && get(prev, order[0]) !== 1) changed += 1;
    ranks[pid] = { week, now, prev };
  }
  setdefault(rc, "leader_changes", odict())[String(week)] = changed;
  const stages = setdefault(rc, "stages", {});         // the viewer's board and offers: which column each prospect sits in
  const me = state["team"];
  for (const pid of new Set([...rc["board"], ...get(rc["offers"], me, [])])) {
    const old = get(stages, pid) || {};                  // an entry older than last week's step is stale: no move from it
    stages[pid] = { week, now: recruiting.stage(state, me, pid), prev: get(old, "week", -99) >= week - 1 ? get(old, "now") : null };
  }
}


function _report(state, week) {
  // What changed this week for the prospects on your board: your rank on his list, the leader,
  // the biggest movers and why, and the events (offers, commitments, flips, asks).
  const [season, persona] = [modules.season, modules.persona];
  const rc = state["recruiting"];
  const me = get(state, "team");
  const teams = season.load_teams();
  const name = (s) => (s !== null && s !== undefined && has(teams, s) ? teams[s]["name"] : s);
  const pids = [...new Set([...rc["board"], ...get(rc["offers"], me, [])])];
  const events = [];
  const pestered = new Set();
  const portal = truthy(get(rc, "portal"));
  for (const e of rc["log"]) {
    if ((portal ? get(e, "portal_week") : e["week"]) !== week || !_in(e["kind"], recruiting.REPORT_KINDS) || !persona.shown_to(e, me)) continue;
    if (e["kind"] === "pester") {              // once per prospect per week, however many contacts wore on him
      if (pestered.has(e["pid"])) continue;
      pestered.add(e["pid"]);
    }
    events.push(e);
  }
  const rows = [];
  for (const pid of pids) {
    const r = get(get(rc, "ranks", {}), pid) || {};
    const [now, prev] = [get(r, "now") || {}, get(r, "prev") || {}];
    const size = Object.keys(now).length;
    const moves = [];
    for (const [s_, rk] of Object.entries(now)) {
      const before = get(prev, s_);
      const why = get(get(get(rc, "why", {}), pid) || {}, s_);
      moves.push({ school: s_, name: name(s_), from: before, to: rk, why: truthy(why) && why["week"] === week ? why["action"] : null, you: s_ === me });
    }
    moves.sort((a, b) => cmp([-Math.abs((a["from"] || size + 1) - a["to"]), a["to"]], [-Math.abs((b["from"] || size + 1) - b["to"]), b["to"]]));
    let leader = null;
    for (const [s_, rk] of Object.entries(now)) if (rk === 1) { leader = s_; break; }
    const p = rc["prospects"][pid];
    rows.push({
      pid, name: p["name"], position: p["position"], stars: p["stars"],
      rank: get(now, me), prev_rank: truthy(prev) ? get(prev, me) : null, of: size,
      leader: truthy(leader) ? { school: leader, name: name(leader) } : null,
      moves: moves.filter((m) => m["from"] !== m["to"]).slice(0, recruiting.MOVES_SHOWN),
      events: events.filter((e) => e["pid"] === pid).map((e) => ({
        ...e, school_name: truthy(get(e, "school")) ? name(e["school"]) : null,
        rival_name: truthy(get(e, "rival")) ? name(e["rival"]) : null,
        ...(e["kind"] === "pester" ? { line: recruiting._pester_line(p["name"], name(e["school"])) } : {}),
        ...(truthy(get(e, "lost")) ? { reason: recruiting.lost_reason(e, name) } : {}),
      })),
    });
  }
  const report = { week, rows, ...(recruiting.is_portal(state) ? { portal: true } : {}) };   // a portal week is the portal's own
  const reports = setdefault(rc, "reports", []);
  reports.push(report);
  const keep = recruiting.REPORTS_KEPT;                   // del reports[:-REPORTS_KEPT]
  if (keep > 0 && reports.length > keep) reports.splice(0, reports.length - keep);
  return report;
}


recruiting.REPORT_KINDS = ["offer", "commit", "hard", "flip", "decommit", "signed", "asked_more", "not_buying", "hung_up", "pester", "promise_broken",
  "promise_kept", "bloomed", "pro", "twist", "hat", "softened", "rival_push"];
recruiting.CONTACT_KINDS = ["contact", "pitch", "raise_nil", "pull_offer", "answer", "present"];   // your actions, logged for his History (not news)
recruiting.HISTORY_ONLY = [...recruiting.CONTACT_KINDS, "learned"];   // his History's alone: never the week's news (what your staff learned is his, not news)


function _pester_line(prospect, school) {
  return `${prospect} is tuning you out: he is not considering ${school}, and more contact pushes him further away.`;
}


function latest_report(state) {
  const reports = get(state["recruiting"], "reports") || [];
  return reports.length ? reports[reports.length - 1] : null;
}


function _act(state, slug, pid, action, pitch = null, nil = 0, scale = 1.0, scene = null, opens = false, auto = false,
  visit_week = null, manual = false, quick = false) {
  // The one action path every school takes (yours, the AI's, Auto-recruit's). Only `act` passes
  // `opens` (your call or visit with no pitch: a scene, no points yet) and `scene` (the pitch that
  // finishes it); every other caller keeps the one-shot path. `auto`: Auto-recruit's contact, which
  // never pesters him. `visit_week`: the home weekend an official visit is for, one of your remaining
  // regular-season home games he has not booked elsewhere (only you pick one; Auto-recruit and the
  // AI take his first free weekend). `manual`: your own message or offer by hand, which carries no pitch and is worth your
  // grades on what he cares about (_grade_points).
  const persona = modules.persona;
  const rc = state["recruiting"];
  const p = get(rc["prospects"], pid);
  if (p === null) throw new recruiting.RecruitingError(400, "unknown prospect");
  if (!has(recruiting.HOURS, action) && action !== "scout") throw new recruiting.RecruitingError(400, "unknown action");
  if (pitch !== null && !_in(pitch, recruiting.PITCHES)) throw new recruiting.RecruitingError(400, "unknown pitch");
  if (nil < 0) throw new recruiting.RecruitingError(400, "NIL points cannot be negative");
  if (truthy(rc["status"][pid]["signed"])) throw new recruiting.RecruitingError(409, "he has already signed");
  if (action !== "pull_offer" && action !== "scout" && action !== "pitch") {     // (a call already open is finished) he will not consider the school, or it is not one of his finalists: nothing lands (part 6)
    const out = recruiting.blocked(state, slug, pid);
    if (out !== null) throw new recruiting.RecruitingError(409, out["text"]);
  }
  if (action === "scout" && rc["status"][pid]["committed"] === slug) {
    throw new recruiting.RecruitingError(409, "he has committed to you, so no more looks are needed");
  }
  const contact = setdefault(setdefault(rc["contacts"], pid, {}), slug, { n: 0, hc_week: null });
  const week = state["current_week"];
  let [revealed, points] = [null, 0.0];
  const you = slug === get(state, "team");                // your actions go in the log for his History (the AI's are not kept)
  if (_in(action, recruiting.WEEKLY_ONCE) && get(get(contact, "week") || {}, action) === recruiting.contact_week(state)) {
    throw new recruiting.RecruitingError(409, "Done this week.");
  }
  if (action === "scout" && recruiting.report_complete(get(rc["reads"], pid))) {
    throw new recruiting.RecruitingError(409, `his report is complete at ${recruiting.looks_needed(state, pid)} of ${recruiting.looks_needed(state, pid)} looks`);
  }
  if (truthy(opens) && has(get(get(rc, "scenes") || {}, slug) || {}, pid)) throw new recruiting.RecruitingError(409, "finish your call with him first");
  if (action === "scout") {
    if (recruiting.scout_points_left(state, slug) < recruiting.look_cost(state, slug, pid)) {      // (the week's energy: a look is paid from it)
      throw new recruiting.RecruitingError(409, "Not enough energy left this week.");
    }
  } else if (recruiting._hours(state, slug) < recruiting.action_hours(state, slug, pid, action)) {
    throw new recruiting.RecruitingError(409, "Not enough energy left this week.");
  }
  const offers = setdefault(rc["offers"], slug, []);
  if (action === "pull_offer") {
    if (!offers.includes(pid)) throw new recruiting.RecruitingError(409, "no offer to pull");
    if (rc["status"][pid]["committed"] === slug && truthy(get(rc["status"][pid], "hard"))) {
      throw new recruiting.RecruitingError(409, "he is a hard commit, and his offer stands until he signs");
    }
    remove(offers, pid);
    recruiting._unmark(state, slug, pid);
    const held = pop(recruiting._nil(state, slug)["held"], pid, null);
    if (you) {
      recruiting._event(state, "pull_offer", pid, slug, { nil: held || 0 });
      pop(get(rc, "offer_weeks") || {}, pid, null);
    }
    if (rc["status"][pid]["committed"] === slug && !truthy(rc["status"][pid]["signed"])) {   // you let your own verbal commit go
      Object.assign(rc["status"][pid], { committed: null, firmness: null, hard: false });
      rc["commits_v"] = get(rc, "commits_v", 0) + 1;
      recruiting._event(state, "decommit", pid, slug);
    }
  } else if (action === "offer") {
    if (pitch === null && !truthy(manual)) throw new recruiting.RecruitingError(400, "an offer needs a pitch, the thing you are selling him");
    if (nil > recruiting.nil_left(state, slug)) throw new recruiting.RecruitingError(400, "not enough NIL points");
    if (offers.includes(pid)) throw new recruiting.RecruitingError(409, "already offered");
    // your own offers have no limit of their own: the board (BOARD_CAP) and your energy are the limit
    if (!you && offers.length >= recruiting.offer_cap(state, slug)) throw new recruiting.RecruitingError(409, "offer limit reached");
    const ask = recruiting.ask_from(state, slug, pid);
    offers.push(pid);
    if (you) {                                    // four weeks holding your offer shows you his commit style
      setdefault(rc, "offer_weeks", {})[pid] = week;
      // he reads it at the week step, as he does a call (the player's ask): the board waits on it till then
      setdefault(rc, "offer_landing", {})[pid] = recruiting.contact_week(state);
    }
    if (nil) recruiting._nil(state, slug)["held"][pid] = nil;
    recruiting._event(state, "offer", pid, slug, { nil });
    points = recruiting.nil_value(p, nil, ask, state);
    // he reads a lowball as: no points for the offer, and he cools on the school
    persona.note_contact(state, slug, pid, contact, pitch);
    if (recruiting.is_lowball(nil, ask, persona.lowball_share(state, pid))) {
      contact["cooled_until"] = week + persona.lowball_weeks(state, slug, pid);
      contact["lowball"] = true;
      persona.set_cooled_why(state, slug, pid, "lowball");
    } else {
      const cold = !truthy(contact["n"]) && !truthy(get(get(get(rc["visits"], pid, {}), slug) || {}, "done"));
      contact["cold_offer"] = cold;
      points += (truthy(manual) ? recruiting._grade_points(state, slug, p, "offer") : recruiting._contact_points(state, slug, p, "offer", pitch))
        * (cold ? recruiting.COLD_OFFER : 1.0);
    }
  } else if (action === "raise_nil") {
    if (!offers.includes(pid)) throw new recruiting.RecruitingError(409, "no offer to raise");
    const held = get(recruiting._nil(state, slug)["held"], pid, 0);
    if (nil <= held) throw new recruiting.RecruitingError(400, "raise it above what you offered");
    if (nil - held > recruiting.nil_left(state, slug)) throw new recruiting.RecruitingError(400, "not enough NIL points");
    const ask = recruiting.ask_from(state, slug, pid);
    recruiting._nil(state, slug)["held"][pid] = nil;
    if (you) recruiting._event(state, "raise_nil", pid, slug, { nil });
    points = recruiting.nil_value(p, nil, ask, state) - recruiting.nil_value(p, held, ask, state);
    if (nil >= ask && truthy(get(contact, "cooled_until"))) {     // meeting his ask ends the cooling
      pop(contact, "cooled_until", null);
      points += recruiting._contact_points(state, slug, p, "offer", null);      // and the offer itself counts now
    }
  } else if (action === "official_visit") {
    if (recruiting.cooled(state, slug, pid)) throw new recruiting.RecruitingError(409, recruiting.COOLED_409[persona.cooled_why(state, slug, pid)]);
    if (!_in(slug, recruiting.top_group(state, pid))) {
      throw new recruiting.RecruitingError(409, "he is not considering you yet, so get into his top group first");
    }
    if (has(get(rc["visits"], pid, {}), slug)) throw new recruiting.RecruitingError(409, "one official visit per school");
    if (recruiting.is_portal(state)) {                       // a campus visit: this week, no game; he sees it all
      setdefault(rc["visits"], pid, {})[slug] = { week, done: true };
      while (truthy(recruiting._reveal(state, slug, pid))) { /* every priority */ }
      contact["last_contact"] = week;                     // (his ask is your scouts' to learn: ask_known)
      pop(contact, "pester", null);
      points = recruiting.BASE_POINTS["official_visit"];
    } else if (visit_week !== null) {               // the weekend you picked: one of your home games left, free on his side
      if (!recruiting.home_weekends(state, slug).some((h) => h["week"] === visit_week)) {
        throw new recruiting.RecruitingError(409, "That is not a home weekend you have left.");
      }
      const taken = new Map();
      for (const [s, v] of Object.entries(get(rc["visits"], pid, {}))) if (s !== slug) taken.set(v["week"], s);
      if (taken.has(visit_week)) throw new recruiting.RecruitingError(409, `He is visiting ${recruiting.school_name(taken.get(visit_week))} that weekend.`);
      setdefault(rc["visits"], pid, {})[slug] = { week: visit_week, done: false };
    } else {
      const game_week = recruiting._home_game_left(state, slug, pid);
      if (game_week === null) {
        throw new recruiting.RecruitingError(409, recruiting._home_game_left(state, slug) === null ? "no home game left for a visit"
          : "he has a visit booked for every home game you have left");
      }
      setdefault(rc["visits"], pid, {})[slug] = { week: game_week, done: false };
    }
    if (you) recruiting._event(state, "contact", pid, slug, { action });
  } else if (action === "pitch") {                        // your scene's pitch: the stored call or visit's points, as the one-shot rule
    const sc = get(get(get(rc, "scenes") || {}, slug) || {}, pid);
    if (sc === null || scene === null || sc["id"] !== scene) throw new recruiting.RecruitingError(409, "no open call or visit with him");
    if (!truthy(get(sc, "presented"))) throw new recruiting.RecruitingError(409, "present your program first");
    if (truthy(get(sc, "question")) && !truthy(get(sc["question"], "answer"))) throw new recruiting.RecruitingError(409, "answer him first");
    if (pitch === null) throw new recruiting.RecruitingError(400, "pick a pitch, the thing you are selling him");
    const tells = sc["action"] !== "call" || persona.call_reveals(state, slug, pid, false);   // a Guarded or first-call Shy recruit keeps it to himself on a call
    if (_in(pitch, p["priorities"]) && truthy(tells)) {        // he tells you plainly when it is one of his
      const seen = setdefault(setdefault(rc["revealed"], slug, {}), pid, []);
      if (!seen.includes(pitch)) seen.push(pitch);
    }
    points = recruiting._contact_land(state, slug, p, contact, sc["action"], pitch, auto);
    if (pitch === "nil") recruiting._money_talk(state, slug, pid, contact, week, tells, Boolean(truthy(get(sc, "tired"))));
    delete rc["scenes"][slug][pid];
    if (points) {                                         // the points are the call's or the visit's; its hours went when it opened
      recruiting._add_points(state, slug, pid, points * scale, sc["action"]);
    }
    return _in(pitch, p["priorities"]) && truthy(tells) ? pitch : null;      // a hit or a quiet one tells you his priority
  } else if (action === "scout") {                        // a scouting trip: your best evaluator's look, no contact with him
    contact["scouted"] = get(contact, "scouted", 0) + 1;       // trips sent, a tally; the gate is his report's looks
    if (you) recruiting._event(state, "contact", pid, slug, { action });
    const rating = recruiting.best_evaluator(state);
    rc["hours"][slug] = recruiting._hours(state, slug) - recruiting.look_cost(state, slug, pid);      // a look is paid in energy
    const rng = new Random(`scout-${rc["seed"]}-${slug}-${pid}-${week}-${contact["scouted"]}`);
    recruiting._LAST_LOOK[0] = recruiting.look(state, pid, rating, rng, null, null, recruiting.look_unit(state, pid));   // one of his looks (2, 3 or 4 finish him), or what is left of his report
  } else {
    if (action === "hc_visit") {
      const last = recruiting.hc_visit_week(state, slug, pid);
      if (last !== null && week - last < recruiting.HC_VISIT_GAP) {     // yours too (the player's November 20 ask: monthly, not once)
        throw new recruiting.RecruitingError(409, "One in-home visit a month.");
      }
      contact["hc_week"] = week;
    }
    if (you) {                                       // a message, call or in-home visit (a scene's pitch is logged when it lands)
      recruiting._event(state, "contact", pid, slug, { action, ...(truthy(pitch) ? { pitch } : {}) });
    }
    if (_in(action, recruiting.WEEKLY_ONCE)) setdefault(contact, "week", {})[action] = recruiting.contact_week(state);
    if (["call", "hc_visit"].includes(action)) {
      persona.learn_on_contact(state, slug, pid, action);
      persona.knock_back(state, slug, pid, action);       // a Surprise Visit's school: a top-three school's call or visit knocks it back
    }
    if (truthy(opens)) {                                  // your scene: the contact is marked, the scene stored; no points until the pitch
      contact["last_contact"] = week;
      const scenes = modules.scenes;
      setdefault(setdefault(rc, "scenes", {}), slug, {})[pid] = scenes.open_scene(state, slug, pid, action, week);
    } else if (action === "hc_visit") {                   // an in-home visit tells you one thing he cares about (never his number: ask_known)
      revealed = recruiting._reveal(state, slug, pid);
    } else if (action === "call") {                       // a call: sometimes a priority
      if (persona.call_reveals(state, slug, pid)) revealed = recruiting._reveal(state, slug, pid);
    }
    if (you && recruiting._STEP_WEEK[0] === null && !truthy(get(rc, "portal"))) {
      contact["touch_week"] = recruiting.contact_week(state);     // made before the step: it lands, and counts as keeping in touch, the week of the step (_firm_up)
    }
    if (!truthy(opens)) {
      contact["last_contact"] = week;
      points = recruiting._contact_land(state, slug, p, contact, action, pitch, auto, truthy(manual) || truthy(quick)) * (truthy(quick) ? recruiting.QUICK_CALL : 1.0);
    }
  }
  if (action !== "scout") {                         // a Send spends scouting points, not hours
    rc["hours"][slug] = recruiting._hours(state, slug) - recruiting.action_hours(state, slug, pid, action);
  }
  if (points) recruiting._add_points(state, slug, pid, points * scale, action);
  return revealed;
}


Object.assign(recruiting, {
  action_hours, planned, hours_planned, hours_free, plan, _run_planned, _carry_planned, _nil, nil_left, _home_game_left,
  home_weekends, visit_weekends, manual_offers, _unmark, act, clear_scenes, _answer, _marks_index, pitch_marks,
  _open_roster_promise, job_crowd, rival_stamp, _strain, _promise_job, _job_promise, _present, _add_points, pending,
  points_now, _flush, _snapshot_ranks, _report, _pester_line, latest_report, _act,
});
