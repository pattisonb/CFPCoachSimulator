// NIL before and after the money is on the table (career_js/recruiting/). Until NIL is attached to an offer, your NIL
// strength with a recruit reads what you could pay him (your NIL room against his ask), not zero after an offer and
// not the program's tier before one; with NIL attached it reads the deal; the page's grade reads the ask only as you
// know it. And talking money is a promise: pitch NIL to a recruit who cares about it with nothing on the offer, and
// you owe him most of his ask within NIL_PROMISE_WEEKS: kept, broken (he cools), or closed when he is no longer
// yours to win.
// `node tests/test_nil_pitch.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random, get, round } from "../engine_js/pyrt.js";

const game = await start();
const { season, recruiting } = game;
const { prospects, scenes, persona } = game.modules;

const ME = "iowa";
const J = (v) => () => JSON.stringify(v);
const clone = (v) => JSON.parse(JSON.stringify(v));

const bases = {};
/** A career in Week 1 with hours to burn (each test gets a copy of its own). */
function fresh(team = ME) {
  if (!bases[team]) {
    const st = season.new_season(team, "full", 5, undefined, undefined, true);
    st["current_week"] = 1;
    st["recruiting"]["hours"][team] = 1000;
    bases[team] = st;
  }
  recruiting.reset_caches();
  return clone(bases[team]);
}
function ranked(st) {
  const rc = st["recruiting"];
  return Object.keys(rc["prospects"]).sort((a, b) => rc["prospects"][a]["rank"] - rc["prospects"][b]["rank"])
    .filter((q) => !rc["prospects"][q]["hidden"] && !rc["status"][q]["committed"]);
}
const room = (st, slug, pid) => recruiting.nil_left(st, slug) + get(get(get(st["recruiting"]["nil"], slug, {}), "held", {}), pid, 0);
const act = (st, slug, pid, action, o = {}) => recruiting.act(st, slug, pid, action, o.pitch ?? null, o.nil ?? 0, o.scene ?? null, o.answer ?? null, o.topics ?? null);

// ----- the NIL strength --------------------------------------------------------------------------------------------------

test("an offer with no NIL on it reads your room against his ask, not zero", () => {
  const st = fresh(), pid = ranked(st)[60];
  act(st, ME, pid, "offer");
  const ask = recruiting.ask_from(st, ME, pid);
  const want = ask ? round(Math.min(1.0, room(st, ME, pid) / ask), 3) : 1.0;
  const got = recruiting.strengths(st, ME, pid)["nil"];
  assert(got === want && got > 0, J([got, want, ask]));
});

test("before an offer a small school that can cover him reads strong, and weak once its room is spent elsewhere", () => {
  const st = fresh("tulane");
  const pid = ranked(st).slice(0, 200).find((q) => { const a = recruiting.ask_from(st, "tulane", q); return a > 0 && a <= room(st, "tulane", q); });
  assert(recruiting.strengths(st, "tulane", pid)["nil"] === 1.0);
  recruiting._nil(st, "tulane")["held"]["__elsewhere__"] = recruiting.nil_left(st, "tulane");
  assert(recruiting.strengths(st, "tulane", pid)["nil"] < 0.25);
});

test("with NIL attached the strength reads the deal: the NIL against his ask", () => {
  const st = fresh(), pid = ranked(st)[60];
  const ask = recruiting.ask_from(st, ME, pid), nil = recruiting._five(ask / 2);
  act(st, ME, pid, "offer", { nil });
  assert(Math.abs(recruiting.strengths(st, ME, pid)["nil"] - Math.min(1.0, nil / ask)) < 0.01);
});

test("a budget all spent reads as nothing to offer", () => {
  const st = fresh(), pid = ranked(st)[60];
  recruiting._nil(st, ME)["held"]["__elsewhere__"] = recruiting.nil_left(st, ME);
  assert(recruiting.strengths(st, ME, pid)["nil"] === 0.0);
});

test("reading a strength opens no contact and no NIL record for a school that never touched him", () => {
  const st = fresh(), rc = st["recruiting"], pid = ranked(st)[90];
  const mark = () => [pid in rc["contacts"] && "tulane" in rc["contacts"][pid], "tulane" in rc["nil"]];
  equal(mark(), [false, false]);
  recruiting.strengths(st, "tulane", pid);
  recruiting.strengths(st, "tulane", pid, true);
  equal(mark(), [false, false]);
});

test("the page's NIL grade reads his ask as you know it: two recruits in the same range read the same", () => {
  const st = fresh();
  const by_range = {};
  for (const pid of ranked(st).slice(0, 400)) {
    const v = recruiting.ask_view(st, ME, pid);
    (by_range[`${get(v, "lo")}-${get(v, "hi")}`] ||= []).push(pid);
  }
  const pair = Object.values(by_range).find((ps) => new Set(ps.map((q) => recruiting.ask_from(st, ME, q))).size > 1);
  assert(pair, "two prospects sharing a range with different asks");
  assert(new Set(pair.map((q) => recruiting.strengths(st, ME, q, true)["nil"])).size === 1);
});

// ----- talking money is a promise -----------------------------------------------------------------------------------------

/** Make NIL his first priority (or none of his), in a recruit of the given personality who decides for himself. */
function cares(st, pid, nil, personality = "business") {
  const p = st["recruiting"]["prospects"][pid];
  p["persona"] = { ...persona.of(st, pid), personality, decider_topic: null };
  const rest = p["priorities"].filter((t) => t !== "nil");
  p["priorities"] = nil ? ["nil", ...rest].slice(0, 3) : recruiting.PITCHES.filter((t) => t !== "nil").slice(0, 3);
}
/** A call: present, answer if he asks, then pitch NIL; his reaction. (Not his first call: a Shy recruit's first tells nothing.) */
function money_pitch(st, pid, slug = ME) {
  const c = recruiting._contact(st, slug, pid);
  c["calls"] ??= 1;
  let sc = act(st, slug, pid, "call")["scene"];
  sc = act(st, slug, pid, "present", { scene: sc["id"], topics: recruiting.PITCHES.slice(0, 3) })["scene"];
  if (get(sc, "question")) act(st, slug, pid, "answer", { scene: sc["id"], answer: "straight" });
  return act(st, slug, pid, "pitch", { pitch: "nil", scene: sc["id"] });
}
const promises = (st, pid, slug = ME) => (get(st["recruiting"]["contacts"][pid][slug], "promises") || []).filter((pr) => pr["kind"] === "money");
const with_ask = (st, slug = ME) => ranked(st).slice(40, 100).find((q) => recruiting.ask_from(st, slug, q) >= 15);
/** A prospect with a real ask, NIL his priority, offered with nothing on the offer. */
function nil_target(st) {
  const pid = with_ask(st);
  cares(st, pid, true);
  act(st, ME, pid, "offer");
  return pid;
}
const weeks_pass = (st, n = recruiting.NIL_PROMISE_WEEKS) => {
  for (let w = st["current_week"] + 1; w < st["current_week"] + 1 + n; w++) recruiting._promises(st, w);
};
const log_of = (st, pid, kind) => st["recruiting"]["log"].filter((e) => e["pid"] === pid && e["kind"] === kind);

test("pitching NIL with nothing on the offer opens a money promise: you are told you owe it, and he names no number", () => {
  const st = fresh(), pid = nil_target(st);
  recruiting.set_board(st, pid, true);
  const r = money_pitch(st, pid);
  assert(promises(st, pid).length === 1 && r["reaction"]["kind"] !== "quiet", J(r["reaction"]));
  const ask = recruiting.ask_from(st, ME, pid);
  assert(!("exact" in recruiting.ask_view(st, ME, pid)), "his number is your scouts' to learn, not his to tell");
  const lines = st["recruiting"]["log"].filter((e) => e["pid"] === pid).map((e) => get(e, "line"));
  assert(lines.includes(scenes.MONEY_OWED_LINE) && !lines.some((l) => /looking for/.test(l || "")), J(lines));
  // the board row and the pitch's answer carry what is owed and by when: before he is fully scouted, an amount sure to
  // cover it (the share of the top of the range you are shown); fully scouted, the number. Kept, it is gone
  const by_week = st["current_week"] + recruiting.NIL_PROMISE_WEEKS;
  const sure = 5 * Math.ceil(recruiting.NIL_PROMISE_SHARE * recruiting.ask_view(st, ME, pid)["hi"] / 5);
  equal(prospects.board_row(st, pid, ME)["money_owed"], { nil: null, sure, by_week });
  equal(r["money_owed"], { nil: null, sure, by_week });
  const need = 5 * Math.ceil(recruiting.NIL_PROMISE_SHARE * ask / 5);
  for (let i = 0; i < recruiting.REPORT_LOOKS; i++) recruiting.look(st, pid, 80, new Random(`test-look-${i}`));
  equal(prospects.board_row(st, pid, ME)["money_owed"], { nil: need, by_week });
  recruiting._nil(st, ME)["held"][pid] = need;
  recruiting._promises(st, st["current_week"] + 1);
  assert(prospects.board_row(st, pid, ME)["money_owed"] === null);
  const pr = promises(st, pid)[0];
  assert(pr["kept"] !== null && pr["broken"] === null && log_of(st, pid, "promise_kept").length === 1, J(pr));
});

test("the promise is kept at his ask as it stands now, when he wants less than he did when you pitched", () => {
  const st = fresh(), pid = nil_target(st);
  money_pitch(st, pid);
  promises(st, pid)[0]["about"]["ask"] *= 2;             // he asked more when you pitched (you trailed)
  recruiting._nil(st, ME)["held"][pid] = recruiting._five(recruiting.NIL_PROMISE_SHARE * recruiting.ask_from(st, ME, pid) + 2.4);
  recruiting._promises(st, st["current_week"] + 1);
  assert(promises(st, pid)[0]["kept"] !== null, J(promises(st, pid)));
});

test("nothing on the offer by the deadline breaks it: he cools on you and the line fits the money and the kid", () => {
  for (const personality of ["business", "shy"]) {
    for (const some of [false, true]) {
      const st = fresh(), pid = nil_target(st);
      cares(st, pid, true, personality);
      money_pitch(st, pid);
      if (some) recruiting._nil(st, ME)["held"][pid] = 5;
      weeks_pass(st);
      assert(promises(st, pid)[0]["broken"] !== null, J(promises(st, pid)));
      assert(get(st["recruiting"]["contacts"][pid][ME], "cooled_until"), "he cools on you");
      const ev = log_of(st, pid, "promise_broken").at(-1);
      assert(ev["why"] === "money" && ev["line"] === scenes.MONEY_BROKEN_LINES[some ? "short" : "none"][personality], J([personality, some, ev]));
    }
  }
});

test("one NIL step short of the share still breaks it", () => {
  const st = fresh(), pid = nil_target(st);
  money_pitch(st, pid);
  const ask = recruiting.ask_from(st, ME, pid);
  let under = 0;
  for (let n = 0; n < ask + 5; n += 5) if (n < recruiting.NIL_PROMISE_SHARE * ask) under = n;
  recruiting._nil(st, ME)["held"][pid] = under;
  weeks_pass(st);
  assert(promises(st, pid)[0]["broken"] !== null, J([under, ask]));
});

test("the promise closes with no penalty once he is not yours to win: committed elsewhere, signed, or your offer pulled", () => {
  for (const how of ["commit", "sign", "pull"]) {
    const st = fresh(), pid = nil_target(st), rc = st["recruiting"];
    money_pitch(st, pid);
    if (how === "commit") rc["status"][pid]["committed"] = "ohio-state";
    else if (how === "sign") rc["status"][pid]["signed"] = "ohio-state";
    else rc["offers"][ME] = rc["offers"][ME].filter((q) => q !== pid);
    weeks_pass(st, recruiting.NIL_PROMISE_WEEKS + 1);
    const pr = promises(st, pid)[0];
    assert(pr["broken"] === null && pr["kept"] === null && get(pr, "closed") !== null, J([how, pr]));
    assert(!log_of(st, pid, "promise_broken").length);
  }
});

test("pitched with no offer: it breaks if you keep after him, and closes if you take him off your board or go quiet", () => {
  for (const how of ["strung along", "walked away", "went quiet"]) {
    const st = fresh(), pid = with_ask(st);
    cares(st, pid, true);
    recruiting.set_board(st, pid, true);
    money_pitch(st, pid);
    if (how === "strung along") recruiting._contact(st, ME, pid)["n"] += 1;      // another contact after the pitch
    if (how === "walked away") recruiting.set_board(st, pid, false);
    weeks_pass(st, recruiting.NIL_PROMISE_WEEKS + 1);
    const pr = promises(st, pid)[0];
    if (how === "strung along") assert(pr["broken"] !== null, J(pr));
    else assert(pr["broken"] === null && get(pr, "closed") !== null && !log_of(st, pid, "promise_broken").length, J([how, pr]));
  }
});

test("no promise when money is not what he is about, when he asks for nothing, on a guarded call, or in the portal", () => {
  let st = fresh(), pid = nil_target(st);
  cares(st, pid, false);
  money_pitch(st, pid);
  assert(!promises(st, pid).length, "NIL is not one of his priorities");

  st = fresh();
  pid = ranked(st).reverse().find((q) => recruiting.ask_from(st, ME, q) === 0);
  cares(st, pid, true);
  act(st, ME, pid, "offer");
  money_pitch(st, pid);
  assert(!promises(st, pid).length, "he asks for nothing");

  st = fresh();
  pid = nil_target(st);
  cares(st, pid, true, "guarded");
  money_pitch(st, pid);
  assert(!promises(st, pid).length && !("exact" in recruiting.ask_view(st, ME, pid)), "a guarded call gives nothing away");

  st = fresh();
  pid = nil_target(st);
  st["recruiting"]["portal"] = true;
  recruiting._money_talk(st, ME, pid, recruiting._contact(st, ME, pid), st["current_week"]);
  delete st["recruiting"]["portal"];
  assert(!promises(st, pid).length, "the portal has no money promises");
});

test("a kind kid at a small school can let a broken money promise go; at a big school he cools as usual", () => {
  const chances = recruiting.MONEY_FORGIVE_CHANCE;
  equal(new Set(Object.keys(chances)), new Set(Object.keys(scenes.MONEY_FORGIVEN_LINES)));
  assert(["cocky", "shy", "guarded", "attention", "business"].every((k) => chances[k] > 0 && chances[k] < 1), J(chances));
  assert(chances["shy"] === Math.max(...Object.values(chances)) && chances["cocky"] === Math.min(...Object.values(chances)));
  const saved = chances["shy"];
  chances["shy"] = 1.0;                                   // a sure thing, so the test reads the rule, not the draw
  try {
    for (const [school, forgives] of [["tulane", true], [ME, false]]) {
      const st = fresh(school), pid = with_ask(st, school), week = st["current_week"];
      cares(st, pid, true, "shy");
      act(st, school, pid, "offer");
      money_pitch(st, pid, school);
      for (let w = week + 1; w < week + 1 + recruiting.NIL_PROMISE_WEEKS; w++) recruiting._promises(st, w);
      const ev = log_of(st, pid, "promise_broken").at(-1);
      const cooled = get(st["recruiting"]["contacts"][pid][school], "cooled_until") === week + recruiting.NIL_PROMISE_WEEKS + recruiting.COOL_WEEKS;
      assert((ev["line"] === scenes.MONEY_FORGIVEN_LINES["shy"]) === forgives && cooled !== forgives, J([school, ev, cooled]));
    }
  } finally {
    chances["shy"] = saved;
  }
});

await run();
