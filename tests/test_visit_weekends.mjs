// One official visit a weekend: a school books his first free home weekend, never one another
// school already has (the player saw a recruit 'visiting' three schools in Week 2). With a week
// picked (`act(..., week=N)`, your Official Visit picker) the visit goes on that home weekend; a weekend
// he has elsewhere, a week with no home game and a rebooking are refused; the picker's read
// (`visit_weekends`) lists your home games with who has each weekend and the first free one.
// `node tests/test_visit_weekends.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { truthy } from "../engine_js/pyrt.js";

const game = await start();
const { season, recruiting } = game;

const ME = "ohio-state";
const U = undefined;
/** recruiting.act(st, ME, pid, "official_visit", week=N) */
const visit = (st, pid, week) => recruiting.act(st, ME, pid, "official_visit", U, U, U, U, U, week);
/** The RecruitingError `fn` raises, or null when it raises nothing (anything else is thrown on). */
function refused(fn) {
  try { fn(); } catch (e) { if (!(e instanceof recruiting.RecruitingError)) throw e; return e; }
  return null;
}

test("main", () => {
  const st = season.new_season(ME, "full", 11, U, U, true);
  const rc = st["recruiting"];
  const pid = recruiting.prospect_list(st)[0];
  const home_weeks = (side) => [...new Set(Object.values(st["games"]).filter((g) => g[side] === ME && g["kind"] === "regular" && g["week"] > st["current_week"]).map((g) => g["week"]))].sort((a, b) => a - b);
  const homes = home_weeks("home");
  assert(homes.length >= 2, () => JSON.stringify(homes));
  const kept = recruiting.top_group;
  try {
    recruiting.top_group = () => [ME];          // he is considering us
    rc["visits"][pid] = { michigan: { week: homes[0], done: false } };   // another school has our first home weekend
    rc["hours"][ME] = 1000;
    recruiting._act(st, ME, pid, "official_visit");
    assert(rc["visits"][pid][ME]["week"] === homes[1], () => JSON.stringify([rc["visits"][pid], homes]));
    // every home weekend taken: refused with the reason
    const pid2 = recruiting.prospect_list(st)[1];
    rc["visits"][pid2] = Object.fromEntries(homes.map((w, i) => [`s${i}`, { week: w, done: false }]));
    let e = refused(() => recruiting._act(st, ME, pid2, "official_visit"));
    assert(e !== null, "a visit was booked on a weekend he already has");
    assert(e.code === 409 && e.message.includes("every home game"), () => JSON.stringify([e.code, e.message]));
    // the picker's read: every home game left, the first free one marked, the taken weekend named
    const rows = recruiting.visit_weekends(st, ME, pid);
    equal(rows.map((r) => r["week"]), homes);
    assert(rows[0]["taken_by"] === "Michigan" && !rows[0]["first"], () => JSON.stringify(rows[0]));
    assert(rows[1]["first"] && rows.slice(2).every((r) => !r["first"]), () => JSON.stringify(rows));
    assert(rows.every((r) => r["label"] === season.week_label(r["week"]) && truthy(r["opponent_name"]) && "opponent_rank" in r), () => JSON.stringify(rows));
    assert(rows.slice(1).every((r) => r["taken_by"] === null), () => JSON.stringify(rows));
    // a chosen later weekend is stored as picked (through `act`, as the page's request goes)
    const pid3 = recruiting.prospect_list(st)[2];
    rc["visits"][pid3] = { michigan: { week: homes[0], done: false } };
    assert(homes.length >= 3, () => JSON.stringify(homes));
    visit(st, pid3, homes[2]);
    equal(rc["visits"][pid3][ME], { week: homes[2], done: false });
    // no rebooking: one official visit per school
    e = refused(() => visit(st, pid3, homes[1]));
    assert(e !== null, "a visit was rebooked");
    assert(e.code === 409 && e.message.includes("one official visit per school"), () => JSON.stringify([e.code, e.message]));
    // a weekend he has elsewhere is refused with the school's name
    const pid4 = recruiting.prospect_list(st)[3];
    rc["visits"][pid4] = { michigan: { week: homes[1], done: false } };
    e = refused(() => visit(st, pid4, homes[1]));
    assert(e !== null, "a visit was booked on a weekend he already has");
    assert(e.code === 409 && e.message === "He is visiting Michigan that weekend.", () => JSON.stringify([e.code, e.message]));
    // a week with no home game of yours (an away week, a played week, a week past the season) is refused
    const aways = home_weeks("away");
    for (const bad of [aways[0], st["current_week"], 99]) {
      e = refused(() => visit(st, pid4, bad));
      assert(e !== null, `a visit was booked on week ${bad}, not a home weekend`);
      assert(e.code === 409 && e.message === "That is not a home weekend you have left.", () => JSON.stringify([bad, e.code, e.message]));
    }
    assert(!(ME in rc["visits"][pid4]));
    // no week picked: his first free weekend, as before
    recruiting.act(st, ME, pid4, "official_visit");
    assert(rc["visits"][pid4][ME]["week"] === homes[0], () => JSON.stringify([rc["visits"][pid4], homes]));
    console.log("visit weekends ok: one official visit a weekend, the picked weekend stored, the taken and away weekends refused");
  } finally {
    recruiting.top_group = kept;
  }
});

await run();
