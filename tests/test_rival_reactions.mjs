// Other schools answer your recruiting (career_js/recruiting/part7.js): only on recruits you offered by hand, from
// their own hours and NIL through the game's own action path, seeded, and never on a quiet, hard or signed commit;
// and the unpaid offer (a recruit does not commit to you on a standing lowball while another school pays him).
// `node tests/test_rival_reactions.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { sorted, json_dumps, parse_ordered } from "../engine_js/pyrt.js";

const game = await start();
const { season, recruiting } = game;
const { persona, prospects } = game.modules;

const ME = "iowa", SEED = 11;
const KNOBS = ["REACT_LEVEL", "REACT_BASE", "REACT_TIER", "REACT_TOP", "REACT_REACH", "REACT_RACE_MAX", "REACT_GIVE_UP", "REACT_MAX", "REACT_HC",
  "REACT_DROP_BEHIND", "REACT_CHAIN", "REACT_CHAIN_MIN", "REACT_PRESS", "UNPAID_HOLD", "UNPAID_RIVAL", "UNPAID_FIT", "UNPAID_STARS", "need_factor", "_react_week", "_react_map",
  "_pressing", "_act"];
const AT_LOAD = Object.fromEntries(KNOBS.map((k) => [k, recruiting[k]]));
const reset = () => { Object.assign(recruiting, AT_LOAD); };
const sure = () => {            // every school in reach answers: the roll always passes
  Object.assign(recruiting, { REACT_BASE: 100.0, REACT_TIER: { 5: 1.0, 4: 1.0, 3: 1.0, 2: 1.0 }, need_factor: () => 1.2 });
};

const fresh = (team = ME, seed = SEED) => season.new_season(team, "full", seed, undefined, undefined, true);
const step = (st, week) => { st["current_week"] = week; return recruiting.weekly_step(st, week); };
const blob = (st) => json_dumps(st["recruiting"], { sort_keys: true });
const pushes = (st, how = null) => st["recruiting"]["log"].filter((e) => e["kind"] === "rival_push" && (how === null || e["how"] === how));
const offering = (st, pid) => Object.entries(st["recruiting"]["offers"]).filter(([s, ps]) => s !== st["team"] && ps.includes(pid)).map(([s]) => s);
const by_rank = (st) => sorted(Object.keys(st["recruiting"]["prospects"]), (q) => st["recruiting"]["prospects"][q]["rank"]);

/** Recruits another school offers that you can work, best first: [prospect, the offering school he likes best]. */
function contested(st, { stars = [4, 5], n = 6 } = {}) {
  const rc = st["recruiting"], me = st["team"], out = [];
  for (const pid of by_rank(st)) {
    const s = rc["status"][pid];
    if (s["committed"] || s["signed"] || !stars.includes(rc["prospects"][pid]["stars"]) || persona.is_quiet(st, pid)) continue;
    if (recruiting.blocked(st, me, pid) !== null) continue;
    const schools = offering(st, pid).filter((x) => recruiting.blocked(st, x, pid) === null);
    if (!schools.length) continue;
    out.push([pid, sorted(schools, (x) => -recruiting.interest(st, x, pid))[0]]);
    if (out.length >= n) break;
  }
  return out;
}

/** Your offer by hand, paid in full, and your interest set `lead` points over the school's. */
function offer_and_lead(st, pid, school, lead, nil = null) {
  const rc = st["recruiting"], me = st["team"];
  if (!(rc["offers"][me] || []).includes(pid)) {
    const ask = recruiting.ask_from(st, me, pid);
    recruiting._nil(st, me)["budget"] = Math.max(recruiting._nil(st, me)["budget"], 100000);
    recruiting.act(st, me, pid, "offer", null, nil === null ? ask : nil);
  }
  rc["lists"][pid][me] = (rc["lists"][pid][me] || 0) + recruiting.interest(st, school, pid) - recruiting.interest(st, me, pid) + lead;
}

/** A career three weeks in (no games: the recruiting week alone), so boards and offers exist. Made once (with the
 *  constants as shipped: no offer by hand, so no reaction) and copied for each test. */
let OPENED = null;
function opened() {
  if (OPENED === null) {
    const st = fresh();
    for (const w of [1, 2, 3]) step(st, w);
    OPENED = JSON.stringify(st);
  }
  return parse_ordered(OPENED, [["games"], ["my_boxes"]]);
}

test("nothing fires without an offer by hand: the same career with reactions on and off", () => {
  const states = [];
  for (const level of [1.0, 0.0]) {
    reset();
    recruiting.REACT_LEVEL = level;
    sure();
    const st = fresh();
    st["id"] = "same";
    for (const w of [1, 2, 3, 4]) step(st, w);
    states.push(st);
  }
  reset();
  const [on, off] = states;
  assert(blob(on) === blob(off), "the recruiting state differs with reactions on and no offer by hand");
  for (const k of ["races", "races_out", "mapped"]) assert(!(k in on["recruiting"]), `${k} was written`);
  assert(!pushes(on).length);
  assert(!json_dumps(on["recruiting"]["contacts"]).includes("react_"), "a reaction field was written");
});

test("REACT_LEVEL 0 is the game without reactions; the same seed and actions give the same reactions", () => {
  const play = (setup) => {
    reset();
    sure();
    setup();
    const st = opened();
    st["id"] = "same";
    for (const [i, [pid, school]] of contested(st).entries()) offer_and_lead(st, pid, school, 2 + i);
    for (const w of [4, 5, 6]) step(st, w);
    return st;
  };
  const off = play(() => { recruiting.REACT_LEVEL = 0.0; });
  const none = play(() => { Object.assign(recruiting, { _react_week: () => {}, _react_map: () => {}, _pressing: () => null }); });
  assert(blob(off) === blob(none), "REACT_LEVEL 0 differs from the game with the reactions taken out");
  assert(!pushes(off).length && !("races" in off["recruiting"]));
  const a = play(() => {}), b = play(() => {});
  reset();
  assert(pushes(a).length > 0, "no school answered six by-hand offers it was passed on");
  assert(blob(a) === blob(b), "the same seed and actions gave different reactions");
  assert(blob(a) !== blob(off));
});

test("a school answers, stays on him with no new roll, and gives up past the limit; the event and the flag land the same week", () => {
  reset();
  sure();
  const st = opened();
  const rc = st["recruiting"], me = st["team"];
  const [pid, school] = contested(st, { n: 1 })[0];
  offer_and_lead(st, pid, school, 3);
  const before = rc["log"].length;
  step(st, 4);
  assert(recruiting.racing(st, school).includes(pid), "the school it passed did not answer");
  const said = rc["log"].slice(before).filter((e) => e["kind"] === "rival_push" && e["pid"] === pid && e["school"] === school);
  assert(said.length >= 1 && said.every((e) => e["week"] === 4 && e["line"].endsWith(".")), () => JSON.stringify(said));
  assert(said[0]["line"].startsWith(recruiting.school_name(school)), said[0]["line"]);
  const row = prospects.board_row(st, pid, me);
  assert(row.rival_push.some((x) => x["school"] === school && x["name"] === recruiting.school_name(school) && !x["pressing"]), () => JSON.stringify(row.rival_push));
  assert(row.history.some((e) => e["kind"] === "rival_push" && e["line"] === said[0]["line"]), "his History does not hold the line");
  assert(recruiting.latest_report(st)["rows"].some((r) => r["pid"] === pid && r["events"].some((e) => e["kind"] === "rival_push")), "the week's report does not hold it");
  assert(game.modules.office.program_news(st).some((n) => n["kind"] === "rival_push" && n["pid"] === pid), "the Office's news does not hold it");
  assert(prospects.board_row(st, pid, school).rival_push.length === 0, "another school's view shows your race");
  // it stays: with the chance at zero it still works him the next week (he heard from it that week)
  recruiting.REACT_BASE = 0.0;
  offer_and_lead(st, pid, school, 3);
  step(st, 5);
  assert(recruiting.racing(st, school).includes(pid) && rc["contacts"][pid][school]["last_contact"] === 5, "it did not stay on him");
  // past the limit it gives up: out of the race, its offer pulled, you are told, and it does not offer him again
  offer_and_lead(st, pid, school, recruiting.REACT_GIVE_UP + 5);
  step(st, 6);
  assert(!recruiting.racing(st, school).includes(pid) && recruiting.gave_up(st, school, pid));
  assert(!rc["offers"][school].includes(pid), "its offer still stands");
  assert(pushes(st, "gave_up").some((e) => e["pid"] === pid && e["school"] === school && e["week"] === 6 && /has stopped calling him\.$/.test(e["line"])));
  assert(!prospects.board_row(st, pid, me).rival_push.some((x) => x["school"] === school));
  step(st, 7);
  assert(!rc["offers"][school].includes(pid) && !recruiting.racing(st, school).includes(pid), "it came back after giving up");
  reset();
});

test("reactions spend the school's own hours and NIL, once a week and once a month, through the game's action path", () => {
  reset();
  sure();
  recruiting.REACT_LEVEL = 2.0;
  const st = opened();
  const rc = st["recruiting"], me = st["team"];
  const real = AT_LOAD["_act"];
  const seen = {}, hc = {};
  let acts = 0;
  recruiting._act = function (state, slug, pid, action, ...rest) {
    const out = real.call(recruiting, state, slug, pid, action, ...rest);     // (a refused action throws before it counts)
    if (slug !== me) {
      acts += 1;
      const week = state["current_week"];
      assert(rc["hours"][slug] === undefined || rc["hours"][slug] >= 0, `${slug} overspent its hours`);
      assert(recruiting.nil_left(state, slug) >= 0, `${slug} overspent its NIL`);
      if (recruiting.WEEKLY_ONCE.includes(action)) {
        const k = `${slug}|${pid}|${action}|${week}`;
        assert(!seen[k], `${k}: twice in a week`);
        seen[k] = true;
      }
      if (action === "hc_visit") {
        const k = `${slug}|${pid}`;
        assert(hc[k] === undefined || week - hc[k] >= recruiting.HC_VISIT_GAP, `${k}: two in-home visits inside a month`);
        hc[k] = week;
      }
    }
    return out;
  };
  for (let w = 4; w <= 9; w++) {
    for (const [i, [pid, school]] of contested(st, { n: 8 }).entries()) offer_and_lead(st, pid, school, 2 + i);
    step(st, w);
    const racers = {};
    for (const [slug, pids] of Object.entries(rc["races"] || {})) {
      assert(pids.length > 0 && slug !== me);
      for (const pid of pids) {
        assert((rc["manual_offers"] || []).includes(pid), "a race for a recruit you did not offer by hand");
        racers[pid] = (racers[pid] || 0) + 1;
        assert(racers[pid] <= recruiting.REACT_RACE_MAX, "more schools in one race than REACT_RACE_MAX");
      }
    }
  }
  assert(acts > 0 && pushes(st).length > 0 && Object.keys(hc).length > 0, "nothing reacted");
  for (const e of pushes(st)) assert((rc["manual_offers"] || []).includes(e["pid"]) || rc["status"][e["pid"]]["signed"], "a reaction on a recruit you did not offer by hand");
  reset();
});

test("your by-hand offer to a blue chip puts him on one more program's board", () => {
  reset();
  const st = opened();
  const rc = st["recruiting"], me = st["team"];
  const signs = (x, tier) => (recruiting._team_model(x)["star_share"] || {})[recruiting.STAR_KEY[tier]] / recruiting._national_share(tier) >= 1;
  const pid = by_rank(st).find((q) => {
    const p = rc["prospects"][q], s = rc["status"][q];
    return p["stars"] >= 4 && !s["committed"] && !s["signed"] && recruiting.blocked(st, me, q) === null
      && offering(st, q).filter((x) => signs(x, p["stars"])).length < recruiting.REACT_CHAIN_MIN;
  });
  assert(pid, "no blue chip with fewer than REACT_CHAIN_MIN programs on him");
  const ask = recruiting.ask_from(st, me, pid);
  recruiting._nil(st, me)["budget"] = 100000;
  recruiting.act(st, me, pid, "offer", null, ask);
  const boards = Object.fromEntries(Object.entries(rc["boards"]).map(([s, b]) => [s, b.includes(pid)]));
  step(st, 4);
  const added = rc["mapped"][pid];
  assert(added && added.length === recruiting.REACT_CHAIN, () => JSON.stringify(rc["mapped"]));
  const x = added[0];
  assert(x !== me && !boards[x] && signs(x, rc["prospects"][pid]["stars"]), `${x} was on him already or does not sign his level`);
  assert(rc["contacts"][pid][x]["n"] >= 1, "the program's staff has not spoken to him");
  step(st, 5);
  assert(rc["mapped"][pid].length === recruiting.REACT_CHAIN, "a second program was added past REACT_CHAIN");
  // a three-star puts nobody on the map
  const three = by_rank(st).find((q) => rc["prospects"][q]["stars"] === 3 && !rc["status"][q]["committed"] && recruiting.blocked(st, me, q) === null && !offering(st, q).length);
  recruiting.act(st, me, three, "offer", null, recruiting.ask_from(st, me, three));
  step(st, 6);
  assert(!(three in rc["mapped"]));
  reset();
});

test("a school pressing your commit costs firmness only in a week it reached him and you did not", () => {
  reset();
  const st = opened();
  const rc = st["recruiting"], me = st["team"];
  const [pid, school] = contested(st, { n: 8 }).find(([q]) => persona.style(st, q) !== "quiet" && !persona.needs_attention(st, q));
  offer_and_lead(st, pid, school, 3);
  recruiting._commit(st, pid, me);
  rc["races"] = { [school]: [pid] };
  const week = 6;
  st["current_week"] = week;
  const run_week = (theirs, mine, key = "last_contact") => {
    rc["status"][pid]["firmness"] = 40;
    rc["status"][pid]["hard"] = false;
    rc["contacts"][pid][school]["last_contact"] = theirs;
    const c = rc["contacts"][pid][me];
    delete c["touch_week"];
    c["last_contact"] = null;
    if (mine !== null) c[key] = mine;
    const n = rc["log"].length;
    recruiting._firm_up(st, week);
    return [rc["status"][pid]["firmness"] - 40, rc["log"].slice(n).filter((e) => e["kind"] === "rival_push" && e["how"] === "cost").length];
  };
  const quiet = run_week(null, null)[0];                    // nobody reached him
  const [pressed, told] = run_week(week, null);             // it reached him, you did not
  equal(pressed, quiet - recruiting.REACT_PRESS);
  equal(told, 1);
  const [both, told_both] = run_week(week, week);           // you both did: your ticked message landed in the step
  equal(both, quiet - recruiting.FIRM_DRIFT + recruiting.FIRM_TOUCH);
  equal(told_both, 0);
  equal(run_week(week, week, "touch_week")[0], both);       // your call by hand, made before the step, counts the same
  equal(run_week(week - 1, null)[0], quiet);                // it reached him last week, not this one
  recruiting.REACT_LEVEL = 0.0;
  equal(run_week(week, null)[0], quiet);
  reset();
  // a call or a visit by hand is marked for the week it lands
  const st2 = opened();
  const [q2, s2] = contested(st2, { n: 1 })[0];
  offer_and_lead(st2, q2, s2, 3);
  recruiting.act(st2, st2["team"], q2, "call", null, 0, null, "quick");
  equal(st2["recruiting"]["contacts"][q2][st2["team"]]["touch_week"], st2["current_week"] + 1);
});

test("no reaction on a quiet, hard or signed commit, or from a school he has shut out", () => {
  for (const kind of ["quiet", "hard", "signed", "locked"]) {
    reset();
    sure();
    const st = opened();
    const rc = st["recruiting"], me = st["team"];
    const [pid, school] = contested(st, { n: 8 }).find(([q]) => !persona.needs_attention(st, q));      // (a Needs Attention commit left alone softens: not this test's)
    offer_and_lead(st, pid, school, 3);
    if (kind === "quiet") rc["prospects"][pid]["persona"] = { ...persona.of(st, pid), commit_style: "quiet" };
    if (kind !== "locked") recruiting._commit(st, pid, me);
    if (kind === "hard") Object.assign(rc["status"][pid], { hard: true, firmness: 95 });
    if (kind === "signed") rc["status"][pid]["signed"] = me;
    if (kind === "quiet") assert(persona.is_quiet(st, pid));
    const real_blocked = recruiting.blocked;
    if (kind === "locked") recruiting.blocked = (state, slug, q, ...rest) => (slug === school && q === pid ? { why: "locked", text: recruiting.LOCKED_TEXT } : real_blocked.call(recruiting, state, slug, q, ...rest));
    const n = (rc["contacts"][pid][school] || {})["n"] || 0;
    try {
      step(st, 4);
      step(st, 5);
    } finally {
      recruiting.blocked = real_blocked;
    }
    assert(!recruiting.racing(st, school).includes(pid), `${kind}: the school is in a race`);
    assert(!pushes(st).some((e) => e["pid"] === pid && e["school"] === school), `${kind}: the school answered`);
    assert(!rc["contacts"][pid][school]["react_nil"], `${kind}: a reaction's raise`);
    if (kind === "locked") assert(((rc["contacts"][pid][school] || {})["n"] || 0) === n, "a school he shut out reached him");
  }
  reset();
});

test("the unpaid offer: a recruit with another offer does not commit to you on a standing lowball, and the switches", () => {
  reset();
  recruiting.UNPAID_FIT = 99;                               // (whatever your program is to him: the fit's own case is below)
  const st = opened();
  const rc = st["recruiting"], me = st["team"];
  const pick = contested(st, { n: 40 }).find(([q, s]) => {
    const theirs = (rc["nil"][s]["held"] || {})[q] || 0;
    return rc["prospects"][q]["nil_ask"] >= recruiting.LOWBALL_MIN && theirs > 0
      && !recruiting.is_lowball(theirs, recruiting.ask_from(st, s, q, undefined, true), persona.lowball_share(st, q));
  });
  assert(pick, "no recruit another school is paying");
  const [pid, school] = pick;
  offer_and_lead(st, pid, school, 30, 0);                    // your offer by hand, no NIL, and you lead his list by a mile
  const payer = recruiting.unpaid_hold(st, pid);              // the best-paying school on him
  assert(offering(st, pid).includes(payer) && rc["nil"][payer]["held"][pid] >= rc["nil"][school]["held"][pid], () => String(payer));
  assert(recruiting._unpaid(st).has(pid));
  equal(prospects.board_row(st, pid, me).unpaid, { school: payer, name: recruiting.school_name(payer), flip: false });
  const sign = (hold) => {
    const copy = JSON.parse(JSON.stringify(st));
    recruiting.UNPAID_HOLD = hold;
    copy["current_week"] = recruiting.signing_week();
    recruiting._sign(copy, true);
    recruiting.UNPAID_HOLD = true;
    return copy["recruiting"]["status"][pid]["signed"];
  };
  assert(sign(true) !== me, "he signed with you on an unpaid offer");
  equal(sign(false), me);
  recruiting.UNPAID_HOLD = false;
  equal(recruiting.unpaid_hold(st, pid), null);
  equal(recruiting._unpaid(st), null);
  recruiting.UNPAID_HOLD = true;
  // committed elsewhere he is held the same way (no flip to you unpaid): the page says so, but never of a Quiet Commit
  const away = JSON.parse(JSON.stringify(st));
  recruiting._commit(away, pid, payer);
  assert(recruiting._unpaid(away).has(pid));
  equal(prospects.board_row(away, pid, me).unpaid.flip, true);
  away["recruiting"]["prospects"][pid]["persona"] = { ...persona.of(away, pid), commit_style: "quiet" };
  assert(persona.hidden_from(away, me, pid) && recruiting._unpaid(away).has(pid));
  equal(prospects.board_row(away, pid, me).unpaid, null);
  // paid to his line, he can: the hold is gone
  const share = persona.lowball_share(st, pid);
  recruiting.act(st, me, pid, "raise_nil", null, Math.ceil(share * recruiting.ask_from(st, me, pid)) + 1);
  equal(recruiting.unpaid_hold(st, pid), null);
  equal(sign(true), me);
  // a lowball to a recruit nobody else offers: a blue chip still holds out (UNPAID_STARS), a recruit under that does not
  const free = (q) => rc["prospects"][q]["nil_ask"] > 0 && !rc["status"][q]["committed"] && recruiting.blocked(st, me, q) === null
    && !(rc["offers"][me] || []).includes(q);
  const lone = by_rank(st).find((q) => free(q) && rc["prospects"][q]["stars"] === 3 && !offering(st, q).length);
  recruiting.act(st, me, lone, "offer", null, 0);
  equal(recruiting.unpaid_hold(st, lone), null);
  recruiting.UNPAID_STARS = 3;
  equal(recruiting.unpaid_hold(st, lone), true);
  equal(prospects.board_row(st, lone, me).unpaid, { school: null, name: null, flip: false });
  recruiting.UNPAID_STARS = 4;
  // one another school offers and does not pay: a hold, unless only real money counts (UNPAID_RIVAL "paid")
  const cheap = by_rank(st).find((q) => free(q) && offering(st, q).length > 0
    && offering(st, q).every((x) => !((rc["nil"][x]["held"] || {})[q] > 0)));
  recruiting.act(st, me, cheap, "offer", null, 0);
  assert(offering(st, cheap).includes(recruiting.unpaid_hold(st, cheap)));
  recruiting.UNPAID_RIVAL = "paid";
  equal(recruiting.unpaid_hold(st, cheap), null);
  recruiting.UNPAID_RIVAL = "offer";
  // and a program well over what he wants can lowball him: no hold at or past UNPAID_FIT
  recruiting.UNPAID_FIT = recruiting.fit(st, me, cheap);
  equal(recruiting.unpaid_hold(st, cheap), null);
  recruiting.UNPAID_FIT = recruiting.fit(st, me, cheap) + 0.01;
  assert(recruiting.unpaid_hold(st, cheap) !== null);
  reset();
});

test("a save from before the reactions loads and plays on", () => {
  reset();
  sure();
  const st = opened();
  for (const [i, [pid, school]] of contested(st).entries()) offer_and_lead(st, pid, school, 2 + i);
  const rc = st["recruiting"];
  for (const k of ["races", "races_out", "mapped"]) assert(!(k in rc));       // as an older save: none of the new fields
  for (const by of Object.values(rc["contacts"])) for (const c of Object.values(by)) for (const k of ["react_nil", "react_press", "mapped", "touch_week"]) delete c[k];
  season.save_season(st);
  const back = season.load_season(st["id"]);
  for (const w of [4, 5, 6]) step(back, w);
  assert(pushes(back).length > 0 && Object.keys(back["recruiting"]["races"] || {}).length > 0, "the loaded career saw no reactions");
  for (const pid of back["recruiting"]["board"]) prospects.board_row(back, pid, back["team"]);
  reset();
});

await run();
