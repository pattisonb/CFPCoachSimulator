// Promise Him the Job (docs/superpowers/plans/2026-11-11-promise-the-job.md): on any call or visit you can promise a
// recruit the starting job, asked or not. It helps land him and is a real promise. Two promises at one position are both
// judged on who starts; the second may not be believed, and it strains the first.
import { start, test, run, assert, raises } from "./harness.mjs";
import { Random, sorted, get } from "../engine_js/pyrt.js";

const game = await start();
const { season, recruiting, offseason } = game;
const { clear, persona, promises, scenes, word } = game.modules;

const ME = "iowa";
const HEARD_NOTE = "He heard you promised the job to another player at his position.";     // Clear Mode's note for scenes.HEARD_RIVAL
const show = (v) => JSON.stringify(v);

function fresh() {
  recruiting.use_league_models({});
  season.use_league(null);     // the 2026 league: test_strain_on_roster_player leaves its career's second-season league in play
  const st = season.new_season(ME, "full", 5, undefined, undefined, true);
  st["current_week"] = 1;
  st["recruiting"]["hours"][ME] = 1000;
  return st;
}

function ranked(st, start_ = 40) {
  const rc = st["recruiting"];
  return sorted(Object.keys(rc["prospects"]), (q) => rc["prospects"][q]["rank"]).slice(start_)
    .filter((q) => !get(rc["prospects"][q], "hidden") && !rc["status"][q]["committed"]);
}

function setup(st, pid, pt = true, personality = "business") {
  const p = st["recruiting"]["prospects"][pid];
  p["persona"] = { ...persona.of(st, pid), personality: personality, decider_topic: null };
  const rest = p["priorities"].filter((t) => t !== "playing_time");
  p["priorities"] = pt ? ["playing_time", ...rest].slice(0, 3) : [...recruiting.PITCHES].filter((t) => t !== "playing_time").slice(0, 3);
}

function open_call(st, pid) {
  const c = recruiting._contact(st, ME, pid);
  if (c["calls"] === undefined) c["calls"] = 1;
  return recruiting.act(st, ME, pid, "call")["scene"];
}

function nobody_ahead(st, n = 1, group = null) {
  const out = [];
  for (const q of ranked(st)) {
    if (recruiting.ahead_of(st, ME, q) === null && (group === null || recruiting._group_of(st["recruiting"]["prospects"][q]) === group)) out.push(q);
    if (out.length === n) return out;
  }
  throw new Error("no prospect with nobody ahead");
}

/** Two prospects at one position group, neither with anyone ahead of him (the first group that has two). */
function two_at_one_group(st) {
  const by = {};
  for (const q of ranked(st)) {
    if (recruiting.ahead_of(st, ME, q) === null) {
      const g = recruiting._group_of(st["recruiting"]["prospects"][q]);
      if (by[g] === undefined) by[g] = [];
      const pair = by[g];
      pair.push(q);
      if (pair.length === 2) return pair;
    }
  }
  throw new Error("no two prospects at one group with nobody ahead");
}

function roster_promises(st, pid) {
  return (get(get(get(st["recruiting"]["contacts"], pid, {}), ME, {}), "promises") || []).filter((pr) => pr["kind"] === "roster");
}

function worth(st, pid, mult) {
  return recruiting.ANSWER_PROMISE * word.promise_mult(st, pid, recruiting._group_of(st["recruiting"]["prospects"][pid])) * mult;
}

/** tests/test_offseason's `finished`: every game played (the better team usually wins), every school's class signed, season over. */
function finished(st) {
  const rng = new Random(1);
  const teams = season.load_teams();
  for (const g of Object.values(st["games"])) {
    const [h, a] = [teams[g["home"]]["team_ratings"]["overall"], teams[g["away"]]["team_ratings"]["overall"]];
    const hs = rng.randint(10, 45);
    const win = rng.random() < 1 / (1 + Math.pow(10, (a - h) / 12));
    g["played"] = true;
    g["home_score"] = win ? hs : Math.max(0, hs - rng.randint(1, 20));
    g["away_score"] = win ? hs - rng.randint(1, 20) : hs;
    if (g["home_score"] === g["away_score"]) g["home_score"] += 3;
  }
  const rc = st["recruiting"];
  const schools = Object.entries(teams).filter(([, t]) => !t["fictional"]).map(([s]) => s);
  const pids = sorted(Object.keys(rc["prospects"]), (p) => rc["prospects"][p]["rank"]);
  pids.slice(0, schools.length * 21).forEach((pid, i) => { rc["status"][pid]["signed"] = schools[i % schools.length]; });
  Object.assign(st, { done: true, current_week: season.FINAL_WEEK, champion: "ohio-state" });
}

/** tests/test_promises' `second_season`: a career in 2027 with its own league (offseason run through). */
function second_season() {
  const st = season.new_season("iowa", "full", 5, undefined, undefined, true);
  finished(st);
  offseason.start(st);
  offseason.run_all(st);
  return offseason.next_season(st);
}

test("test_promise_job_helps", () => {
  const st = fresh();
  const pid = nobody_ahead(st)[0];
  setup(st, pid);
  const sc = open_call(st, pid);
  const r = recruiting.act(st, ME, pid, "promise_job", undefined, undefined, sc["id"]);
  assert(Math.abs(r["points"] - worth(st, pid, recruiting.JOB_PRIORITY)) < 1e-9 && r["truthful"], show(r));
  const prs = roster_promises(st, pid);
  assert(prs.length === 1 && get(prs[0], "job"), show(prs));
  assert(st["recruiting"]["log"].some((e) => e["pid"] === pid && get(e, "line") === "You told him the job is his."));
});

test("test_not_his_priority_counts_less", () => {
  const st = fresh();
  const pid = nobody_ahead(st)[0];
  setup(st, pid, false);
  const sc = open_call(st, pid);
  const r = recruiting.act(st, ME, pid, "promise_job", undefined, undefined, sc["id"]);
  assert(Math.abs(r["points"] - worth(st, pid, recruiting.JOB_NOT_PRIORITY)) < 1e-9, show(r));
});

test("test_one_per_recruit", () => {
  const st = fresh();
  const pid = nobody_ahead(st)[0];
  setup(st, pid);
  const sc = open_call(st, pid);
  recruiting.act(st, ME, pid, "promise_job", undefined, undefined, sc["id"]);
  let e;
  try {
    e = raises(() => recruiting.act(st, ME, pid, "promise_job", undefined, undefined, sc["id"]), recruiting.RecruitingError);
  } catch (err) {
    if (err instanceof recruiting.RecruitingError) throw err;
    throw new Error("a second job promise is refused");
  }
  assert(e.code === 409 && e.message.toLowerCase().includes("already promised"), e.message);
  assert(roster_promises(st, pid).length === 1);
});

test("test_promise_over_a_better_player_holds", () => {
  const st = fresh();
  let pid = null;
  for (const q of ranked(st)) {
    const a = recruiting.ahead_of(st, ME, q);
    if (a && !a["last_year"] && st["recruiting"]["prospects"][q]["ovr"] < a["ovr"] - recruiting.PROMISE_MARGIN) {
      pid = q;
      break;
    }
  }
  setup(st, pid);
  const sc = open_call(st, pid);
  const r = recruiting.act(st, ME, pid, "promise_job", undefined, undefined, sc["id"]);
  // the player's ask: a promised start is your word to play him over the better player (next season judges it), never hollow
  assert(r["truthful"] && r["points"] > 0, show(r));
  assert(!recruiting.cooled(st, ME, pid));
});

test("test_crowd_and_strain", () => {
  const st = fresh();
  const [a, b] = two_at_one_group(st);
  for (const q of [a, b]) setup(st, q);
  const saved = recruiting.JOB_CROWD_DOUBT;
  recruiting.JOB_CROWD_DOUBT = 0.0;
  let r;
  try {
    recruiting.act(st, ME, a, "promise_job", undefined, undefined, open_call(st, a)["id"]);
    r = recruiting.act(st, ME, b, "promise_job", undefined, undefined, open_call(st, b)["id"]);
  } finally {
    recruiting.JOB_CROWD_DOUBT = saved;
  }
  assert(Math.abs(r["points"] - worth(st, b, recruiting.JOB_PRIORITY * recruiting.JOB_CROWD)) < 1e-9, show(r));
  const ca = st["recruiting"]["contacts"][a][ME];
  assert(recruiting.cooled(st, ME, a) && get(ca, "heard_rival") === recruiting.rival_stamp(st), show(ca));
  assert(st["recruiting"]["log"].some((e) => e["kind"] === "promise_strained" && e["pid"] === a && get(e, "line") === scenes.HEARD_RIVAL));
});

test("test_strain_on_roster_player", () => {
  const st = second_season();
  st["current_week"] = 1;
  st["recruiting"]["hours"][st["team"]] = 1000;
  const [me, year] = [st["team"], season.season_year(st)];
  const roster = st["league"]["teams"][me]["roster"];
  const rc = st["recruiting"];
  const pid = sorted(Object.keys(rc["prospects"]), (q) => rc["prospects"][q]["rank"]).slice(40).find((q) => !get(rc["prospects"][q], "hidden"));
  const group = recruiting._group_of(rc["prospects"][pid]);
  const pl = roster.find((c) => get(offseason.GROUP, c["pos"]) === group);
  pl["promised"] = year;
  const weeks = [{ week: 1, started: true, injured: false, big: false }, { week: 2, started: true, injured: false, big: false }];
  const before = promises.score(weeks, pl["pos"], "business");
  setup(st, pid);
  const c = recruiting._contact(st, me, pid);
  if (c["calls"] === undefined) c["calls"] = 1;
  const sc = recruiting.act(st, me, pid, "call")["scene"];
  recruiting.act(st, me, pid, "promise_job", undefined, undefined, sc["id"]);
  assert(promises.strain(st, year, pl["id"]) === 1);
  assert(Math.abs(promises.score(weeks, pl["pos"], "business", 1) - (before - recruiting.JOB_STRAIN_SCORE)) < 1e-9);
});

test("test_ai_no_job_promise", () => {
  const st = fresh();
  const pid = ranked(st)[0];
  try {
    recruiting.act(st, "ohio-state", pid, "promise_job", undefined, undefined, "x");
  } catch (e) {
    if (e instanceof recruiting.RecruitingError) return;
    throw e;
  }
  throw new Error("an AI school makes no job promise");
});

test("test_heard_rival_line", () => {
  const st = fresh();
  const [a, b] = two_at_one_group(st);
  for (const q of [a, b]) setup(st, q);
  const sc = open_call(st, a);
  recruiting.act(st, ME, a, "promise_job", undefined, undefined, sc["id"]);
  if ([...(recruiting.SCENE_ACTIONS || [])].includes("hang_up")) recruiting.act(st, ME, a, "hang_up", undefined, undefined, sc["id"]);
  else delete st["recruiting"]["scenes"][ME][a];
  recruiting.act(st, ME, b, "promise_job", undefined, undefined, open_call(st, b)["id"]);
  st["current_week"] += 1;
  delete get(st["recruiting"]["scenes"], ME, {})[a];
  const sc2 = open_call(st, a);
  // Clear Mode (career_js/clear.js, on by default) says it in a plain note; the word-mode call (CFP_CLEAR=0) has him say it first
  let heard;
  if (clear.on()) {
    heard = (sc_) => sc_["turns"].filter((t) => t["who"] === "note" && t["text"] === HEARD_NOTE).map((t) => t["text"]);
    assert(heard(sc2).length === 1 && sc2["turns"].every((t) => t["who"] === "note"), show(sc2["turns"]));
  } else {
    heard = (sc_) => sc_["turns"].filter((t) => t["who"] === "him" && t["text"] === scenes.HEARD_RIVAL).map((t) => t["text"]);
    const him = sc2["turns"].filter((t) => t["who"] === "him").map((t) => t["text"]);
    assert(him.length && him[0] === scenes.HEARD_RIVAL, show(sc2["turns"]));
  }
  assert(!("heard_rival" in st["recruiting"]["contacts"][a][ME]), "the stamp is spent once he has said it");
  st["current_week"] += 1;
  delete st["recruiting"]["scenes"][ME][a];
  const sc3 = open_call(st, a);
  assert(sc3["turns"].length && !heard(sc3).length, "said once");
});

/** After a job promise, his question about a named player does not come up again, and answering "promise" to one
 * that is open is refused: one job promise per recruit, both ways. */
test("test_no_second_promise_through_his_question", () => {
  const st = fresh();
  const pid = nobody_ahead(st)[0];
  setup(st, pid);
  const sc = open_call(st, pid);
  recruiting.act(st, ME, pid, "promise_job", undefined, undefined, sc["id"]);
  for (let w = 2; w < 12; w++) {
    st["current_week"] = w;
    assert(scenes.question(st, ME, pid, w) === null || !["roster", "recruit"].includes(get(scenes.question(st, ME, pid, w), "kind")));
  }
  if (st["recruiting"]["scenes"][ME] === undefined) st["recruiting"]["scenes"][ME] = {};
  st["recruiting"]["scenes"][ME][pid] = { id: "s9", action: "call", week: st["current_week"],
    question: { kind: "roster", text: "x", about: { name: "A", ovr: 0, last_year: true, cls: "SR" }, answer: null, reply: null } };
  let e;
  try {
    e = raises(() => recruiting.act(st, ME, pid, "answer", undefined, undefined, "s9", "promise"), recruiting.RecruitingError);
  } catch (err) {
    if (err instanceof recruiting.RecruitingError) throw err;
    throw new Error("a second roster promise through his question is refused");
  }
  assert(e.code === 409, e.message);
  assert(roster_promises(st, pid).length === 1);
});

/** In the portal the season's week stands still: the heard-rival line reads the portal's own week. */
test("test_heard_rival_in_the_portal", () => {
  const st = fresh();
  const a = nobody_ahead(st)[0];
  const rc = st["recruiting"];
  const c = recruiting._contact(st, ME, a);
  rc["portal"] = true; rc["week"] = 1;
  c["heard_rival"] = recruiting.rival_stamp(st);
  rc["week"] = 2;
  assert(scenes.heard_rival_due(st, ME, a), "a later portal week brings it up");
  rc["week"] = 1;
  c["heard_rival"] = recruiting.rival_stamp(st);
  assert(!scenes.heard_rival_due(st, ME, a), "not the same week");
});

await run();
