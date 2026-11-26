// Coachability moves (offseason.coachability_chances, offseason.coachability_roll): each case
// moves a player up one level at its own chance, at most one level a year, never above Coach's
// Dream; a struggling starter who lost his job can slip a level; a seed gives the same answers.
// `node tests/test_coachability_growth.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random } from "../engine_js/pyrt.js";

const game = await start();
const o = game.offseason;
const recruits = game.modules.recruits;

const LEVELS = recruits.COACHABILITY.map(([n]) => n);
const N = 6000;

function rate(level, chances, drop = 0.0, seed = 7) {
  const rng = new Random(seed);
  let up = 0, down = 0;
  const reasons = new Set();
  for (let i = 0; i < N; i++) {
    const [fresh, why] = o.coachability_roll(level, chances, drop, rng);
    const d = LEVELS.indexOf(fresh) - LEVELS.indexOf(level);
    assert(fresh !== undefined && LEVELS.includes(fresh) && Math.abs(d) <= 1, () => JSON.stringify([level, fresh]));    // one level a year at most
    up += d < 0 ? 1 : 0;
    down += d > 0 ? 1 : 0;
    if (why) reasons.add(why);
  }
  return [up / N, down / N, reasons];
}

function near(got, want, tol = 0.02) {
  assert(Math.abs(got - want) <= tol, () => JSON.stringify([got, want]));
}

// coachability_chances(level, cls, z, rated, redshirted, benched) from named arguments
const chances = (a) => o.coachability_chances(a.level, a.cls, a.z, a.rated, a.redshirted, a.benched);
const empty = (d) => Object.keys(d).length === 0;

test("check_each_case", () => {
  const base = { level: "Steady Grinder", cls: "SO", z: null, rated: 70, redshirted: false, benched: false };
  const cases = [["breakout", { z: 1.4 }, o.COACH_UP_BREAKOUT],
    ["developer", { rated: 90 }, o.COACH_UP_DEVELOPER[1][1]],
    ["developer", { rated: 95 }, o.COACH_UP_DEVELOPER[0][1]],
    ["maturity", { cls: "SRRS", z: 0.1 }, o.COACH_UP_MATURITY],
    ["redshirt", { cls: "SORS", redshirted: true, rated: 83 }, o.COACH_UP_REDSHIRT]];
  for (const [key, extra, want] of cases) {
    const [ch, drop] = chances({ ...base, ...extra });
    equal(Object.keys(ch), [key], JSON.stringify([key, ch, drop]));
    assert(!drop, () => JSON.stringify([key, ch, drop]));
    const [up, down, why] = rate("Steady Grinder", ch);
    near(up, want);
    assert(down === 0 && why.size === 1 && why.has(key), () => JSON.stringify([key, [...why]]));
  }
  near(o.COACH_UP_BREAKOUT, 0.20, 0);
  near(o.COACH_UP_MATURITY, 0.06, 0);
  near(o.COACH_UP_REDSHIRT, 0.10, 0);
  // no case: nobody moves
  const [ch, drop] = chances(base);
  assert(empty(ch) && !drop);
  equal(rate("Steady Grinder", ch).slice(0, 2), [0.0, 0.0]);
  // the conditions' edges
  assert(empty(chances({ ...base, rated: 79 })[0]));
  assert(empty(chances({ ...base, cls: "SR", z: null })[0]));                     // did not play
  assert(empty(chances({ ...base, level: "Film Junkie", cls: "SR", z: 0.0 })[0]));  // one level from the top
  assert(empty(chances({ ...base, redshirted: true, rated: 69 })[0]));
  console.log("each case fires at its chance: breakout, developer (88 and 94), maturity, redshirt");
});

test("check_one_level_and_cap", () => {
  const every = { breakout: 0.9, developer: 0.9, maturity: 0.9, redshirt: 0.9 };
  let [up, down] = rate("Slow to Click", every);                 // many cases at once still move one level
  near(up, 1 - Math.pow(0.1, 4), 0.01);
  assert(down === 0);
  [up, down] = rate("Coach's Dream", every, 0.9);                // the top never moves up
  assert(up === 0);
  const [ch] = o.coachability_chances("Coach's Dream", "SR", 2.0, 95, true, false);
  assert(empty(ch));
  [up, down] = rate("Set in His Ways", {}, 0.9);                 // nor the bottom down
  assert(down === 0);
  console.log("one level a year at most; Coach's Dream is the cap");
});

test("check_drop", () => {
  const [ch, drop] = o.coachability_chances("Quick Study", "SO", -1.0, 50, false, true);
  assert(empty(ch) && drop === o.COACH_DOWN_BENCHED && o.COACH_DOWN_BENCHED === 0.05);
  const [up, down, why] = rate("Quick Study", ch, drop);
  near(down, 0.05, 0.015);
  assert(up === 0 && why.size === 1 && why.has("benched"));
  assert(o.coachability_chances("Quick Study", "SO", -1.0, 50, false, false)[1] === 0);     // kept his job
  assert(o.coachability_chances("Quick Study", "SO", -0.5, 50, false, true)[1] === 0);      // did not struggle
  console.log("a struggling starter who lost his job slips a level 5% of the time");
});

test("check_seeded", () => {
  const ch = { breakout: 0.2, developer: 0.12 };
  const rolls = () => { const r = new Random(3); return Array.from({ length: 500 }, () => o.coachability_roll("Quick Study", ch, 0.05, r)); };
  const a = rolls(), b = rolls();
  equal(a, b);
  // every roll takes the same draws whatever applies, so one player's case never shifts another's roll
  const r1 = new Random(9), r2 = new Random(9);
  o.coachability_roll("Quick Study", {}, 0.0, r1);
  o.coachability_roll("Coach's Dream", ch, 0.05, r2);
  assert(r1.random() === r2.random());
  console.log("deterministic for a seed; a fixed number of draws a player");
});

test("check_reasons", () => {
  assert(o.coachability_note("Film Junkie", "breakout") === "Now a Film Junkie: A Breakout Year");
  assert(o.coachability_note("Film Junkie", "developer", "Coach Smith") === "Now a Film Junkie: Coach Smith's Development");
  assert(o.coachability_note("Film Junkie", "redshirt") === "Now a Film Junkie: A Redshirt Year Well Spent");
  assert(o.coachability_note("Film Junkie", "maturity") === "Now a Film Junkie: Growing Up");
  assert(o.coachability_note("Slow to Click", "benched").startsWith("Now Slow to Click: Benched"));   // no "a" before a level that is not a noun
  console.log("Who Improved reasons read right");
  console.log("coachability growth ok");
});

await run();
