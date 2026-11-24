// Recruiting actions and the week step (career_js/recruiting/): what a message, call, in-home visit, offer and official
// visit cost and earn, what each may be done how often, the conversation a call opens (present three topics, answer
// him, pitch one), a lowball offer cooling him, the stages a recruit moves through, and what lands when the week
// advances: points on his list, the weekly report, the stage arrows and a verbal commit firming up.
// `node tests/test_recruit_actions.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random, get, round } from "../engine_js/pyrt.js";

const game = await start();
const { season, recruiting, offseason } = game;
recruiting.LOCKOUT_AT = 5.0;   // the line these tests were written at: the game's own shuts more doors (test_standards holds it), and these pick recruits a mid program could then not work
const { prospects } = game.modules;

const ME = "ohio-state";
const J = (v) => () => JSON.stringify(v);
const remove_from = (xs, v) => { const i = xs.indexOf(v); if (i !== -1) xs.splice(i, 1); };
const has = (xs, v) => (xs instanceof Set ? xs.has(v) : xs.includes(v));
const PLAIN = () => ({ personality: "business", decider: "self", decider_topic: null });   // a recruit with no quirks: a Guarded or Shy one keeps things to himself on a call

function refused(fn, code, words = "") {
  try {
    fn();
  } catch (e) {
    if (!(e instanceof recruiting.RecruitingError)) throw e;
    assert((Array.isArray(code) ? code : [code]).includes(e.code) && e.message.includes(words), `${e.code} ${e.message}`);
    return e;
  }
  throw new Error(`not refused (${code} ${words})`);
}

const st = season.new_season(ME, "full", 4, undefined, undefined, true);
const rc = st["recruiting"];
const P = rc["prospects"];
const act = (pid, action, o = {}) => recruiting.act(st, ME, pid, action, o.pitch ?? null, o.nil ?? 0, o.scene ?? null, o.answer ?? null, o.topics ?? null, o.week ?? null);
const used = new Set();
/** An uncommitted prospect nobody at your school has touched, whom a contact will not pester; each is handed out once. */
function fresh(want = () => true) {
  const pid = recruiting.prospect_list(st).find((q) => !used.has(q) && !get(get(rc["contacts"], q, {}), ME) && !rc["status"][q]["committed"]
    && !rc["offers"][ME]?.includes(q) && !recruiting.would_pester(st, ME, q) && recruiting.blocked(st, ME, q) === null && want(P[q], q));
  assert(pid !== undefined, "no prospect fits");
  used.add(pid);
  return pid;
}
const hours = (n) => { rc["hours"][ME] = n; };
const off_topics = (pid) => recruiting.PITCHES.filter((t) => !P[pid]["priorities"].includes(t));
/** A call opened and presented with three topics that are not his: the opening earns nothing. */
function opened(pid) {
  const sc = act(pid, "call")["scene"];
  return act(pid, "present", { scene: sc["id"], topics: off_topics(pid).slice(0, 3) })["scene"];
}
/** Force your strength on one topic for the length of `fn`. */
function forced(pid, topic, value, fn) {
  const f = new recruiting.forced_strength(st, ME, pid, topic, value);
  f.__enter__();
  try { return fn(); } finally { f.__exit__(); }
}

// ----- what an action costs and tells ---------------------------------------------------------------------------------

test("a call with a pitch spends its hours and may tell you one of his priorities", () => {
  const pid = fresh();
  const h0 = recruiting.hours_free(st, ME);
  assert(h0 === recruiting.weekly_hours(st, ME) && h0 % 5 === 0);
  const r = act(pid, "call", { pitch: P[pid]["priorities"][0] });
  assert(r["hours_left"] === h0 - recruiting.HOURS["call"] && !("scene" in r), J(r));
  assert(r["revealed"] === null || P[pid]["priorities"].includes(r["revealed"]));
  assert(!("interest" in r), "the answer carries no interest: his list moves at the week step");
});

test("a call is not a confession: over many prospects it reveals a priority some of the time, not always and not never", () => {
  rc["hours"]["texas"] = 10 ** 6;
  // (the recruits who will take its call: one who will not consider a school hears nothing from it)
  const calls = Object.keys(P).filter((q) => recruiting.blocked(st, "texas", q) === null).slice(0, 60).map((q) => recruiting._act(st, "texas", q, "call", null, 0));
  const share = calls.filter((c) => c).length / calls.length;
  assert(share >= 0.25 && share <= 0.75, String(share));
  assert(!get(get(rc, "scenes") || {}, "texas"), "another school's call opens no conversation");
});

test("a call and an in-home visit never tell you his NIL ask (your scouts learn it); the visit tells you one priority for sure", () => {
  const pid = fresh((p, q) => p["nil_ask"] >= 15 && !get(rc["reads"], q));
  P[pid]["persona"] = PLAIN();
  hours(200);
  const before = recruiting.ask_view(st, ME, pid);
  act(pid, "call", { pitch: off_topics(pid)[0] });
  const ask = recruiting.ask_from(st, ME, pid), av = recruiting.ask_view(st, ME, pid);
  assert(get(av, "exact") === null && av["lo"] < ask && ask < av["hi"] && av["hi"] - av["lo"] <= Math.max(10, 0.6 * ask + 5), J([av, ask]));
  equal(av, before, "a call narrows nothing");
  const r = act(pid, "hc_visit", { pitch: off_topics(pid)[0] });
  assert(P[pid]["priorities"].includes(r["revealed"]), J(r));
  equal(recruiting.ask_view(st, ME, pid), before, "nor does the visit");
  refused(() => act(pid, "hc_visit", { pitch: off_topics(pid)[0] }), 409, "One in-home visit a month");
});

test("you may call and message a recruit once a week each; next week is fine", () => {
  const pid = fresh();
  hours(200);
  act(pid, "call", { pitch: "winning" });
  act(pid, "message");
  refused(() => act(pid, "call", { pitch: "winning" }), 409, "Done this week");
  refused(() => act(pid, "message"), 409, "Done this week");
  st["current_week"] += 1;
  try {
    act(pid, "message");
  } finally {
    st["current_week"] -= 1;
  }
});

test("the week's hours run out: an action you cannot afford is refused", () => {
  const pid = fresh();
  hours(recruiting.HOURS["message"] - 1);
  refused(() => act(pid, "message"), 409, "Not enough energy");
  hours(200);
});

test("a pitch on what he cares about, where you are strong, lands bigger than one off his list; where you are weak it backfires", () => {
  const pid = fresh();
  const p = P[pid], pri = p["priorities"][0], off = off_topics(pid)[0];
  const strong = forced(pid, pri, 0.9, () => recruiting._contact_points(st, ME, p, "call", pri));
  assert(strong > recruiting._contact_points(st, ME, p, "call", off), "his priority, at strength");
  assert(forced(pid, pri, 0.1, () => recruiting._contact_points(st, ME, p, "message", pri)) < 0, "he is not buying it");
});

// ----- the conversation a call opens ----------------------------------------------------------------------------------

test("a call without a pitch opens a conversation: the hours are spent, nothing is earned until you present and pitch", () => {
  const pid = fresh();
  P[pid]["persona"] = PLAIN();
  hours(100);
  const r = act(pid, "call");
  let sc = r["scene"];
  assert(r["hours_left"] === 100 - recruiting.HOURS["call"] && sc["action"] === "call" && sc["cue"] === null && sc["presented"] === null, J(sc));
  refused(() => act(pid, "pitch", { pitch: "winning", scene: sc["id"] }), 409, "present your program first");
  refused(() => act(pid, "present", { scene: sc["id"], topics: ["winning", "nil"] }), 400, "three different topics");
  refused(() => act(pid, "present", { scene: sc["id"], topics: ["winning", "nil", "nil"] }), 400, "three different topics");
  refused(() => act(pid, "present", { scene: "nope", topics: ["winning", "nil", "coach"] }), 409);
  const misses = off_topics(pid).slice(0, 3);
  const pr = act(pid, "present", { scene: sc["id"], topics: misses });
  sc = pr["scene"];
  equal(sc["presented"], misses);
  assert(pr["points"] === 0 && pr["hit"].length === 0 && sc["present"]["kind"] === "polite", J(pr));
  assert(recruiting.pending(st, ME, pid) === 0.0 && rc["scenes"][ME][pid]["id"] === sc["id"], "the open scene is remembered");
  refused(() => act(pid, "present", { scene: sc["id"], topics: misses }), 409, "already presented");
  refused(() => act(pid, "call"), 409, "Done this week");
  // a visit the same week cannot replace the open call, and spends nothing
  refused(() => act(pid, "hc_visit"), 409);
  assert(rc["hours"][ME] === 100 - recruiting.HOURS["call"] && rc["scenes"][ME][pid]["id"] === sc["id"]);
  assert(get(rc["contacts"][pid][ME], "hc_week") === null, "the refused visit left no mark");
});

test("presenting one of his priorities where you are strong earns points; one where you are weak costs", () => {
  for (const [value, kind] of [[0.9, "hit"], [0.05, "quiet"]]) {
    const pid = fresh();
    P[pid]["persona"] = PLAIN();
    hours(100);
    const pri = P[pid]["priorities"][0];
    const sc = act(pid, "call")["scene"];
    const pr = forced(pid, pri, value, () => act(pid, "present", { scene: sc["id"], topics: [pri, ...off_topics(pid).slice(0, 2)] }));
    assert(pr["scene"]["present"]["kind"] === kind, J(pr["scene"]["present"]));
    if (kind === "hit") assert(pr["points"] > 0 && pr["hit"].length === 1 && pr["hit"][0] === pri, J(pr["hit"]));
    else assert(pr["points"] < 0 && pr["hit"].length === 0, J(pr["points"]));
    assert(Math.abs(recruiting.pending(st, ME, pid) - pr["points"]) < 1e-9, "the opening's points are pending on his list");
  }
});

test("the pitch finishes the call: a priority at strength lights him up and is revealed, and the points are a call's", () => {
  const pid = fresh();
  P[pid]["persona"] = PLAIN();
  hours(100);
  const sc = opened(pid);
  if (sc["question"]) act(pid, "answer", { scene: sc["id"], answer: "deflect" });
  const pri = P[pid]["priorities"][0];
  const [r, want] = forced(pid, pri, 0.9, () => {
    const worth = recruiting._contact_points(st, ME, P[pid], "call", pri, true);
    return [act(pid, "pitch", { pitch: pri, scene: sc["id"] }), worth];
  });
  assert(r["reaction"]["kind"] === "hit" && r["reaction"]["revealed"] === pri && r["reaction"]["text"], J(r["reaction"]));
  assert(rc["revealed"][ME][pid].includes(pri));
  assert(Math.abs(recruiting.pending(st, ME, pid) - want) < 1e-6, J([recruiting.pending(st, ME, pid), want]));
  assert(!(pid in rc["scenes"][ME]), "the conversation is over");
  refused(() => act(pid, "pitch", { pitch: "nil", scene: sc["id"] }), 409);
});

test("a pitch that is not his thing gets a polite answer; one he cares about where you are weak falls quiet and is logged", () => {
  // (a plain recruit who will still hear from you as one: his standards lean with his personality)
  const pid = fresh((p, q) => { const was = p["persona"]; p["persona"] = PLAIN(); const open = recruiting.blocked(st, ME, q) === null; if (was === undefined) delete p["persona"]; else p["persona"] = was; return open; });
  P[pid]["persona"] = PLAIN();
  hours(100);
  let sc = opened(pid);
  if (sc["question"]) act(pid, "answer", { scene: sc["id"], answer: "deflect" });
  let r = act(pid, "pitch", { pitch: off_topics(pid)[3], scene: sc["id"] });
  assert(r["reaction"]["kind"] === "polite" && r["reaction"]["revealed"] === null, J(r["reaction"]));
  st["current_week"] += 1;
  try {
    sc = opened(pid);
    if (sc["question"]) act(pid, "answer", { scene: sc["id"], answer: "deflect" });
    const pri = P[pid]["priorities"][2];
    r = forced(pid, pri, 0.05, () => act(pid, "pitch", { pitch: pri, scene: sc["id"] }));
    assert(r["reaction"]["kind"] === "quiet", J(r["reaction"]));
    assert(rc["log"].some((e) => e["kind"] === "not_buying" && e["pid"] === pid));
  } finally {
    st["current_week"] -= 1;
  }
});

test("a call you open and never finish adds nothing, closes at the week step and is noted", () => {
  const copy = JSON.parse(JSON.stringify(st));
  const crc = copy["recruiting"];
  const pid = recruiting.prospect_list(copy).find((q) => !get(get(crc["contacts"], q, {}), ME) && !recruiting.would_pester(copy, ME, q));
  crc["hours"][ME] = 100;
  recruiting.act(copy, ME, pid, "call");
  const landed = get(crc["lists"][pid], ME, 0.0) + recruiting.pending(copy, ME, pid);
  recruiting._flush(copy, copy["current_week"]);
  assert(!Object.keys(get(get(crc, "scenes") || {}, ME) || {}).length, "the week step clears open scenes");
  assert(Math.abs(get(crc["lists"][pid], ME, 0.0) - landed) < 1e-6, "an abandoned scene added no points");
  assert(crc["log"].some((e) => e["kind"] === "hung_up" && e["pid"] === pid && e["action"] === "call"), "the report notes the call you never finished");
});

test("turning Auto-recruit on drops your open conversations", () => {
  const pid = fresh();
  hours(100);
  act(pid, "call");
  recruiting.clear_scenes(st, ME);
  assert(!get(get(rc, "scenes") || {}, ME));
});

test("your school through Auto-recruit's path calls in one shot, at a call's base points", () => {
  const pid = fresh((p, q) => !(q in rc["contacts"]));
  hours(100);
  recruiting._act(st, ME, pid, "call", null, 0);
  assert(!(pid in (get(get(rc, "scenes") || {}, ME) || {})));
  // a call's base, scaled by how well your program fits what he wants (recruiting.move_mult), as any school's is
  const want = recruiting.BASE_POINTS["call"] * recruiting.move_mult(st, ME, pid);
  assert(Math.abs(recruiting.pending(st, ME, pid) - want) < 1e-9 && want >= recruiting.MOVE_FLOOR * recruiting.BASE_POINTS["call"]
    && want <= recruiting.MOVE_CEIL * recruiting.BASE_POINTS["call"], String(recruiting.pending(st, ME, pid)));
});

test("an in-home visit's conversation carries his ask as your scouts have it: a range, the number at a complete report", () => {
  const pid = fresh((p, q) => p["nil_ask"] >= 15 && !get(rc["reads"], q));
  hours(100);
  const sc = act(pid, "hc_visit")["scene"];
  assert(sc["action"] === "hc_visit" && get(sc["ask"], "exact") === null && sc["ask"]["lo"] < sc["ask"]["hi"], J(sc["ask"]));
  recruiting.clear_scenes(st, ME);
  const known = fresh((p, q) => p["nil_ask"] >= 15 && !get(rc["reads"], q));
  for (let i = 0; i < recruiting.REPORT_LOOKS; i++) recruiting.look(st, known, 80, new Random(`test-look-${i}`));
  const sc2 = act(known, "hc_visit")["scene"];
  assert(sc2["ask"]["exact"] === recruiting.ask_from(st, ME, known), J(sc2["ask"]));
  recruiting.clear_scenes(st, ME);
});

// ----- offers, NIL and visits ------------------------------------------------------------------------------------------

test("another school's offer needs a pitch; yours by hand carries none and counts your grades on what he cares about", () => {
  const pid = fresh();
  refused(() => recruiting._act(st, "michigan", pid, "offer", null, 0), 400);
  assert(recruiting._grade_points(st, ME, P[pid], "offer") > 0);
});

test("a lowball offer cools him: no points for it and no visit, until the NIL reaches his ask", () => {
  const pid = fresh((p) => p["stars"] === 5);
  hours(200);
  const ask = recruiting.ask_from(st, ME, pid);
  const before = recruiting.points_now(st, ME, pid);
  act(pid, "offer", { nil: 0 });
  assert(recruiting.cooled(st, ME, pid) && recruiting.points_now(st, ME, pid) === before, "a lowball earns nothing");
  refused(() => act(pid, "official_visit"), 409);
  rc["nil"][ME]["budget"] += ask;                       // room for the raise is not the point here
  act(pid, "raise_nil", { nil: ask });
  assert(!recruiting.cooled(st, ME, pid) && rc["nil"][ME]["held"][pid] === ask);
  assert(recruiting.points_now(st, ME, pid) > before);
  act(pid, "pull_offer");
  rc["nil"][ME]["budget"] -= ask;
});

test("a recruit is cold until you contact him, and an offer to a cold recruit counts half", () => {
  const two = (p) => p["stars"] === 2 && p["nil_ask"] === 0;
  const a = fresh(two), b = fresh(two);
  hours(200);
  assert(recruiting.stage(st, ME, a) === "cold");
  act(a, "message");
  assert(recruiting.stage(st, ME, a) === "contact");
  const warm = recruiting._grade_points(st, ME, P[b], "offer");
  act(b, "offer", { nil: 0 });
  assert(rc["status"][b]["committed"] === null, "an offer is not a commitment");
  assert(Math.abs(recruiting.points_now(st, ME, b) - warm / 2) < 1e-6, J([recruiting.points_now(st, ME, b), warm]));
  act(b, "pull_offer");
});

test("an official visit needs you in his top group", () => {
  const pid = fresh((p) => p["stars"] === 2);
  hours(200);
  act(pid, "message");
  const crowd = recruiting.fbs_schools(st).filter((x) => x !== ME).slice(0, recruiting.TOP_GROUP);
  for (const x of crowd) rc["lists"][pid][x] = 10000.0;
  recruiting.reset_caches();
  refused(() => act(pid, "official_visit"), 409);
  for (const x of crowd) delete rc["lists"][pid][x];
  recruiting.reset_caches();
});

test("an offer holds its NIL from your budget; past the budget is refused; pulling it gives the NIL back", () => {
  const pid = fresh((p) => p["stars"] === 3 && p["nil_ask"] > 0 && p["nil_ask"] <= 20);
  hours(200);
  const left = recruiting.nil_left(st, ME), before = recruiting.points_now(st, ME, pid);
  refused(() => act(pid, "offer", { nil: 10 ** 6 }), [400, 409]);
  act(pid, "offer", { nil: 20 });
  assert(rc["offers"][ME].includes(pid) && rc["nil"][ME]["held"][pid] === 20 && recruiting.nil_left(st, ME) === left - 20);
  assert(recruiting.points_now(st, ME, pid) > before);
  assert(rc["manual_offers"].includes(pid), "an offer by hand is marked as yours");
  act(pid, "official_visit");
  refused(() => act(pid, "official_visit"), 409);
  act(pid, "pull_offer");
  assert(!rc["offers"][ME].includes(pid) && !(pid in rc["nil"][ME]["held"]) && recruiting.nil_left(st, ME) === left);
  assert(!rc["manual_offers"].includes(pid), "the pull clears the mark");
});

test("at signing, offers to prospects who signed elsewhere are dropped, so they never hold your offer cap", () => {
  const copy = JSON.parse(JSON.stringify(st));
  const crc = copy["recruiting"];
  const pid = recruiting.prospect_list(copy).find((q) => crc["status"][q]["committed"] === null && !get(crc["offers"], ME, []).includes(q));
  crc["hours"][ME] = 100;
  recruiting.act(copy, ME, pid, "offer");
  crc["status"][pid]["committed"] = "texas";
  recruiting._sign(copy, false);
  assert(crc["status"][pid]["signed"] === "texas" && !crc["offers"][ME].includes(pid));
  refused(() => recruiting.act(copy, ME, pid, "message"), 409);          // a signed prospect cannot be worked
});

// ----- needs ------------------------------------------------------------------------------------------------------------

test("needs are a healthy roster's make-up less who comes back and who has committed; a commit fills one", () => {
  const copy = JSON.parse(JSON.stringify(st));
  const crc = copy["recruiting"];
  const nd = recruiting.needs(copy, ME);
  equal(new Set(Object.keys(nd)), new Set(Object.keys(offseason.TARGET)));
  assert(Object.values(nd).every((v) => Number.isInteger(v)), J(nd));
  const t = season.load_teams()[ME];
  const back = [...t["offense"], ...t["defense"]].filter((q) => q["position"] === "QB" && !has(recruiting.LEAVING, get(q, "class"))).length;
  assert(Math.abs(nd["QB"] - (offseason.TARGET["QB"] - back)) <= 1, J([nd["QB"], back]));       // an expected early leaver may count
  const qb = Object.keys(crc["prospects"]).find((q) => crc["prospects"][q]["ea_position"] === "QB" && !crc["status"][q]["committed"]);
  recruiting._commit(copy, qb, ME);
  assert(recruiting.needs(copy, ME)["QB"] === nd["QB"] - 1);
  assert(recruiting.need_factor(2) > recruiting.need_factor(1) && recruiting.need_factor(1) > recruiting.need_factor(0)
    && recruiting.need_factor(0) > recruiting.need_factor(-1), "a bigger need pulls harder");
});

test("the page counts needs by position, and a group's positions add up to the group", () => {
  const nd = recruiting.needs(st, ME), sp = recruiting.needs_by_spot(st, ME), v = prospects.recruiting_view(st);
  assert(v["closed"] === false, "the first week is a working week, not the dead period");
  equal(v["needs"], Object.fromEntries(Object.entries(sp).map(([k, d]) => [k, d["need"]])));
  equal(v["needs_detail"], sp);
  equal(Object.keys(sp), [...recruiting.SPOT_ORDER]);
  for (const g of Object.keys(offseason.TARGET)) {
    const parts = g in recruiting.SPOTS ? recruiting.SPOTS[g].map(([n]) => n) : [g];
    assert(parts.reduce((a, n) => a + v["needs"][n], 0) === nd[g] && parts.every((n) => sp[n]["group"] === g), J([g, parts, nd[g]]));
    assert(parts.reduce((a, n) => a + sp[n]["target"], 0) === offseason.TARGET[g], g);
  }
  for (const q of Object.keys(P).slice(0, 40)) {
    assert(prospects.board_row(st, q, ME)["need"] === v["needs"][recruiting.spot_of(P[q])], "a board row's need is his position's");
  }
});

// ----- the odds you see ---------------------------------------------------------------------------------------------------

test("the odds add up to one with the field, the school he likes more ahead, and the range narrows toward signing day", () => {
  const copy = JSON.parse(JSON.stringify(st));
  const crc = copy["recruiting"];
  const pid = Object.keys(crc["prospects"]).find((q) => crc["status"][q]["committed"] === null && !Object.values(crc["offers"]).some((o) => o.includes(q)));
  for (const school of [ME, "michigan", "kent-state"]) (crc["offers"][school] ||= []).push(pid);
  crc["lists"][pid][ME] = get(crc["lists"][pid], ME, 0) + 8;
  const early = prospects.odds(copy, pid, 0), late = prospects.odds(copy, pid, 13);
  const total = (o) => o["schools"].reduce((a, s) => a + s["pct"], 0) + o["field"];
  assert(Math.abs(total(early) - 1) < 1e-6);
  assert(early["schools"][0]["school"] === ME && early["schools"][0]["pct"] > early["schools"].at(-1)["pct"]);
  assert(early["schools"].every((o) => o["lo"] <= o["pct"] && o["pct"] <= o["hi"]));
  const width = (o) => o["schools"][0]["hi"] - o["schools"][0]["lo"];
  assert(width(early) > width(late) && early["certainty"] === "Early Read" && late["certainty"] === "Solid Read", J([early["certainty"], late["certainty"]]));
  assert(late["field"] < early["field"]);
  // committed: his school holds most of it, more with fewer weeks left to flip in; signed is final
  crc["status"][pid]["committed"] = ME;
  const held = prospects.odds(copy, pid);
  assert(held["committed"] === ME && held["schools"][0]["school"] === ME, J(held));
  assert(prospects.odds(copy, pid, 14)["schools"][0]["pct"] > held["schools"][0]["pct"]);
  crc["status"][pid]["committed"] = "kent-state";          // a school he likes less: a real flip risk
  const shaky = prospects.odds(copy, pid);
  assert(shaky["schools"][0]["school"] !== "kent-state" || shaky["schools"][0]["pct"] < held["schools"][0]["pct"]);
  crc["status"][pid]["committed"] = "michigan";
  const mich = prospects.odds(copy, pid);
  assert(Math.abs(total(mich) - 1) < 1e-6 && mich["field"] === 0 && mich["schools"].every((s) => s["pct"] >= 0));
  crc["status"][pid]["signed"] = "michigan";
  const done = prospects.odds(copy, pid);
  assert(done["schools"].length === 1 && done["schools"][0]["pct"] === 1);
});

test("a commit's chance to flip is never over one: his school's share is never negative and the rivals' add up to it", () => {
  const copy = JSON.parse(JSON.stringify(st));
  const crc = copy["recruiting"];
  const pid = Object.keys(crc["prospects"]).filter((q) => !crc["prospects"][q]["hidden"] && !crc["status"][q]["committed"])
    .sort((a, b) => crc["prospects"][a]["rank"] - crc["prospects"][b]["rank"])[0];
  for (const s of ["georgia", "alabama", "michigan", ME]) (crc["offers"][s] ||= []).push(pid);
  Object.assign(crc["status"][pid], { committed: ME, hard: false });
  const o = prospects.odds(copy, pid, null, ME);
  assert(o["schools"].every((r) => r["pct"] >= 0), J(o["schools"]));
  const f = prospects.flip_view(copy, pid, ME);
  assert(Math.abs(f["rivals"].reduce((a, r) => a + r["pct"], 0) - f["total"]) < 1e-3, J(f));
});

test("an evaluation calls only a genuinely low grade a weakness; a strong player's lowest is just solid", () => {
  const star = { ea_position: "WR", stars: 5 };
  const high = prospects._evaluation(star, { athleticism: 88, size_strength: 66, technique: 82, football_iq: 70, potential: 86 });
  assert(high["weaknesses"].length === 0 && high["solid"].length === 2, J(high));
  const low = prospects._evaluation(star, { athleticism: 88, size_strength: 40, technique: 82, football_iq: 70, potential: 86 });
  assert(low["weaknesses"].length === 1 && low["weaknesses"][0].toLowerCase().includes("size and strength"), J(low));
});

// ----- the week step ------------------------------------------------------------------------------------------------------

const st2 = season.new_season(ME, "full", 7, undefined, undefined, true);
const rc2 = st2["recruiting"];
const one = Object.keys(rc2["prospects"]).find((q) => rc2["prospects"][q]["stars"] === 3 && !(q in rc2["contacts"]) && !rc2["status"][q]["committed"]
  && !rc2["prospects"][q]["hidden"]);

test("your actions land at the week step: until then his list has not moved, after it the report shows the move", () => {
  rc2["board"].push(one);
  recruiting.act(st2, ME, one, "call", recruiting.PITCHES.find((t) => !rc2["prospects"][one]["priorities"].includes(t)));
  assert(get(rc2["lists"][one], ME, 0.0) === 0.0 && recruiting.pending(st2, ME, one) > 0);
  assert(recruiting.points_now(st2, ME, one) === recruiting.pending(st2, ME, one));
  recruiting.weekly_step(st2, 0);
  assert(rc2["lists"][one][ME] > 0 && recruiting.pending(st2, ME, one) === 0);
  const report = recruiting.latest_report(st2);
  const row = report["rows"].find((r) => r["pid"] === one);
  assert(report["week"] === 0 && ["rank", "prev_rank", "leader", "moves", "events"].every((k) => k in row), J(row));
  assert(row["rank"] !== null && row["prev_rank"] === null, "his first list has no place before it");
  const listed = prospects.profile(st2, one, ME)["public"]["schools"];
  assert(listed.length && listed.every((x) => "move" in x && "bar" in x && "why" in x), J(listed[0]));
  assert(recruiting.scout_points_left(st2, ME) === recruiting.scout_points(st2, ME), "the week's scouting points are refilled");
});

test("the board shows a stage arrow only for a move made this week by a recruit still in play for you", () => {
  assert(["contact", "top", "visited"].includes(recruiting.stage(st2, ME, one)), "a cold recruit you called moved up");
  assert(rc2["stages"][one]["now"] === recruiting.stage(st2, ME, one));
  const b = prospects.board_row(st2, one, ME);
  assert([null, "up"].includes(b["stage_move"]));
  equal(b["home"], rc2["prospects"][one]["home"]);
  const wk = st2["current_week"];
  const move = (snap) => { rc2["stages"][one] = snap; return prospects.board_row(st2, one, ME)["stage_move"]; };
  assert(move({ week: wk, now: "top", prev: "contact" }) === "up");
  assert(move({ week: wk, now: "contact", prev: "top" }) === "down");
  assert(move({ week: wk, now: "top", prev: "top" }) === null);
  assert(move({ week: wk - 2, now: "top", prev: "contact" }) === null, "an old move shows no arrow");
  rc2["status"][one]["committed"] = "georgia";
  assert(move({ week: wk, now: "top", prev: "contact" }) === null, "committed elsewhere: no arrow");
  rc2["status"][one]["committed"] = ME;
  assert(move({ week: wk, now: "committed", prev: "visited" }) === "up");
  rc2["status"][one]["committed"] = null;
  // a stale entry (dropped from the board and added again later) gives no previous stage
  rc2["stages"][one] = { week: wk - 3, now: "visited", prev: null };
  recruiting._snapshot_ranks(st2, wk);
  assert(rc2["stages"][one]["prev"] === null && rc2["stages"][one]["week"] === wk);
  delete rc2["stages"];                                  // a save from before the snapshot shows no arrow
  assert(prospects.board_row(st2, one, ME)["stage_move"] === null);
});

test("a verbal commit starts firmer after a visit and firms up every week, faster when you keep in touch", () => {
  const st3 = season.new_season(ME, "full", 8, undefined, undefined, true);
  const rc3 = st3["recruiting"];
  const [a, b] = Object.keys(rc3["prospects"]).filter((q) => rc3["prospects"][q]["stars"] === 3 && !rc3["status"][q]["committed"]).slice(0, 2);
  for (const q of [a, b]) {
    rc3["board"].push(q);
    recruiting.act(st3, ME, q, "offer", null, 10);
  }
  (rc3["visits"][b] ||= {})[ME] = { week: 0, done: true };
  recruiting._commit(st3, a, ME);
  recruiting._commit(st3, b, ME);
  assert(rc3["status"][a]["firmness"] === 40 && rc3["status"][b]["firmness"] === 60, J([rc3["status"][a], rc3["status"][b]]));
  recruiting.act(st3, ME, a, "message");                 // in touch with a, not with b
  st3["career"]["settings"]["auto_recruit"] = "off";
  recruiting.weekly_step(st3, 0);
  const fa = rc3["status"][a]["firmness"], fb = rc3["status"][b]["firmness"];
  // a: +8 for the message and +3 for the NIL held, less rivals; b: the quiet drift (+3) and the NIL, less rivals
  assert(fa >= 40 + 11 - 18 && fa <= 40 + 11 && fb >= 60 + 3 - 18 && fb <= 60 + 11, J([fa, fb]));
  assert(prospects.recruiting_view(st3)["board"].filter((r) => r["committed"] === ME).every((r) => "firmness" in r));
  rc3["status"][a]["firmness"] = 100;
  assert(recruiting.flip_weekly(st3, a, 50.0) === 0.0 && recruiting.flip_weekly(st3, b, 50.0) > 0.0, "a locked commit cannot flip");
});

test("your own action is marked for the week you are in (live), a step's event is not, and another school pulling its offer to a recruit on your board is in his History", () => {
  const st4 = season.new_season(ME, "full", 4, undefined, undefined, true);
  const rc4 = st4["recruiting"];
  const pid = recruiting.prospect_list(st4).find((q) => !rc4["status"][q]["committed"] && recruiting.blocked(st4, ME, q) === null);
  recruiting.act(st4, ME, pid, "offer", null, 5);
  const mine = rc4["log"].filter((e) => e["pid"] === pid && e["school"] === ME && e["kind"] === "offer");
  assert(mine.length === 1 && mine[0]["live"] === true && mine[0]["week"] === st4["current_week"], J(mine));
  st4["career"]["settings"]["auto_recruit"] = "off";
  const n = rc4["log"].length;
  recruiting.weekly_step(st4, 0);
  assert(rc4["log"].slice(n).every((e) => !("live" in e)), "a step's event is marked live");
  // another school's pull, said to you alone and only for a recruit you are after
  const other = Object.keys(rc4["offers"]).find((s) => s !== ME);
  if (!rc4["board"].includes(pid)) rc4["board"].push(pid);
  const gone = recruiting._offer_gone(st4, other, pid, "group");
  assert(gone !== null && gone["kind"] === "offer_gone" && /pulled its offer: it is full at /.test(gone["line"]) && !("live" in gone), J(gone));
  assert(prospects.board_row(st4, pid, ME).history.some((e) => e["kind"] === "offer_gone" && e["line"] === gone["line"]), "his History does not hold the pull");
  assert(!prospects.board_row(st4, pid, other).history.some((e) => e["kind"] === "offer_gone"), "another school reads your line");
  assert(prospects.board_row(st4, pid, ME).history.some((e) => e["kind"] === "offer" && e["live"] === true), "the row's History drops the mark");
  const stranger = recruiting.prospect_list(st4).find((q) => !rc4["board"].includes(q) && !rc4["offers"][ME].includes(q) && !rc4["status"][q]["committed"]);
  equal(recruiting._offer_gone(st4, other, stranger, "money"), null);
});

test("taking a recruit off your board lets go of what you had ticked for him: the energy is yours again, at once and in a save made before", () => {
  const st5 = season.new_season(ME, "full", 4, undefined, undefined, true);
  const rc5 = st5["recruiting"];
  const [a, b] = recruiting.prospect_list(st5).filter((q) => !rc5["status"][q]["committed"] && recruiting.blocked(st5, ME, q) === null && !recruiting.would_pester(st5, ME, q)).slice(0, 2);
  for (const q of [a, b]) recruiting.set_board(st5, q, true);
  const free = recruiting.hours_free(st5, ME);
  recruiting.plan(st5, a, "message", true);
  recruiting.plan(st5, b, "call", true);
  equal(recruiting.hours_free(st5, ME), free - recruiting.HOURS["message"] - recruiting.HOURS["call"]);
  recruiting.set_board(st5, a, false);
  equal(recruiting.hours_free(st5, ME), free - recruiting.HOURS["call"]);
  assert(!(a in recruiting.planned(st5)) && b in recruiting.planned(st5));
  // a save from before: he is off the board, his plan still there
  remove_from(rc5["board"], b);
  rc5["dropped"].push(b);
  equal(recruiting.hours_free(st5, ME), free);
});

await run();
