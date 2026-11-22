// School Grades Phase 3 (docs/superpowers/plans/2026-11-11-school-grades-phase-3.md): Game Day, Exposure, Stability
// and Academics move each offseason with results, each held to its floor; Location and Facilities stay; recruits and the
// Programs tab read the live grades.
// `node tests/test_grades_move.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random, round, sorted } from "../engine_js/pyrt.js";

const game = await start();
const { season, recruiting, offseason } = game;
const P = game.modules.programs;

const SLUG = "iowa";

function prog(kw = {}) {
  return { winning: 40.0, winning_base: 40.0, grades_live: {}, ...kw };
}

function live(p, slug = SLUG) {
  const st = { league: { teams: { [slug]: { program: p } } } };
  return P.grades_now(st, slug);
}

/** tests/test_offseason's helper: every game played (the better team usually wins), every school's class signed, season over. */
function finished(st) {
  const rng = new Random(1);
  const teams = season.load_teams();
  for (const g of Object.values(st["games"])) {
    const h = teams[g["home"]]["team_ratings"]["overall"], a = teams[g["away"]]["team_ratings"]["overall"];
    const hs = rng.randint(10, 45);
    const win = rng.random() < 1 / (1 + Math.pow(10, (a - h) / 12));
    const home_score = win ? hs : Math.max(0, hs - rng.randint(1, 20));
    const away_score = win ? hs - rng.randint(1, 20) : hs;
    Object.assign(g, { played: true, home_score, away_score });
    if (g["home_score"] === g["away_score"]) g["home_score"] += 3;
  }
  const rc = st["recruiting"];
  const schools = Object.keys(teams).filter((s) => !teams[s]["fictional"]);
  const pids = sorted(Object.keys(rc["prospects"]), (p) => rc["prospects"][p]["rank"]);
  pids.slice(0, schools.length * 21).forEach((pid, i) => { rc["status"][pid]["signed"] = schools[i % schools.length]; });
  Object.assign(st, { done: true, current_week: season.FINAL_WEEK, champion: "ohio-state" });
}

test("test_old_save_reads_base", () => {
  const st = { league: { teams: { [SLUG]: { program: { winning: 40.0 } } } } };
  equal(P.grades_now(st, SLUG), P.grades(SLUG));
  equal(P.grades_now({}, SLUG), P.grades(SLUG), "no league: the base");
});

test("test_winning_raises_game_day_and_exposure", () => {
  const p = prog({ winning: 70.0 });
  const base = P.grades(SLUG);
  let prev = { ...base };
  let now;
  for (let y = 2027; y < 2030; y++) {
    P._move_grades(p, SLUG, y, null, 2020, P.CHURN_MEAN);
    now = live(p);
    const up = now["game_day"] - prev["game_day"];
    assert((0 < up && up <= P.GAME_DAY_STEP + 1e-9) || now["game_day"] === 100, () => JSON.stringify([prev, now]));
    assert(now["exposure"] > prev["exposure"] || now["exposure"] === 100);
    prev = now;
  }
  assert(now["location"] === base["location"] && now["facilities"] === base["facilities"], "Location and Facilities stay");
});

test("test_floors", () => {
  const base = P.grades(SLUG);
  let p = prog({ winning: 0.0 });
  for (let y = 2027; y < 2047; y++) P._move_grades(p, SLUG, y, null, 2020, P.CHURN_MEAN);
  let now = live(p);
  assert(Math.abs(now["game_day"] - round(base["game_day"] * 0.70, 1)) <= 0.1, () => JSON.stringify([now["game_day"], base["game_day"]]));
  assert(Math.abs(now["exposure"] - round(base["exposure"] * 0.75, 1)) <= 0.1, () => JSON.stringify([now["exposure"], base["exposure"]]));
  p = prog({ winning: 100.0 });
  for (let y = 2027; y < 2067; y++) P._move_grades(p, SLUG, y, 1, 2020, P.CHURN_MEAN);
  now = live(p);
  assert(now["game_day"] <= 100 && now["exposure"] <= 100);
});

test("test_stability", () => {
  const base = P.grades(SLUG)["stability"];
  const p = prog();
  P._move_grades(p, SLUG, 2027, null, 2026, P.CHURN_MEAN);
  assert(Math.abs(live(p)["stability"] - Math.max(10, base - P.STABILITY_CHANGE)) < 1e-9);
  for (const y of [2028, 2029, 2030]) P._move_grades(p, SLUG, y, null, 2026, P.CHURN_MEAN);
  assert(Math.abs(live(p)["stability"] - base) < 1e-9, "three years rebuild 15, never above the base");
  for (let y = 2031; y < 2045; y++) P._move_grades(p, SLUG, y, null, y - 1, P.CHURN_MEAN);
  assert(live(p)["stability"] === 10.0, "never under 10");
});

test("test_academics_band", () => {
  const base = P.grades(SLUG)["academics"];
  const p = prog();
  for (let y = 2027; y < 2047; y++) P._move_grades(p, SLUG, y, null, 2020, P.CHURN_MEAN * 4);
  assert(Math.abs(live(p)["academics"] - Math.max(0.0, base - 10)) <= 0.1, () => JSON.stringify([live(p)["academics"], base]));
});

test("test_moved_recorded", () => {
  const p = prog({ winning: 70.0 });
  P._move_grades(p, SLUG, 2027, 5, 2020, P.CHURN_MEAN);
  assert(p["grades_moved"]["game_day"] > 0 && p["grades_moved"]["exposure"] > 0, () => JSON.stringify(p["grades_moved"]));
});

test("test_rating_untouched_and_pulls_live", () => {
  let st = season.new_season(SLUG, "full", 5, undefined, undefined, true);
  finished(st);
  offseason.start(st);
  offseason.run_all(st);
  st = offseason.next_season(st);
  const p = P.get(st, SLUG);
  assert("grades_live" in p && p["rating"] === round(P.mix(p), 1));
  p["grades_live"]["game_day"] = -20.0;
  recruiting.reset_caches();
  const pid = Object.keys(st["recruiting"]["prospects"])[0];
  const want = P.grades_now(st, SLUG)["game_day"] / 100;
  assert(Math.abs(recruiting.pull(st, SLUG, pid, false)["game_day"] - want) < 1e-9);
});

test("test_a_copy_never_writes_back", () => {
  // offseason.program_shifts runs update on a shallow copy of each program (a probe): moving the copy's grades must
  // leave the real program's grades_live untouched.
  const real = prog({ winning: 70.0, grades_live: { game_day: 2.0, exposure: 1.0, stability: 0.0, academics: 0.0 } });
  const copy = { ...real };
  P._move_grades(copy, SLUG, 2028, null, 2020, 0);
  equal(real["grades_live"], { game_day: 2.0, exposure: 1.0, stability: 0.0, academics: 0.0 });
});

test("test_change_read_at_the_carousel", () => {
  // programs.update runs at the carousel, before that offseason's hires: a coach hired last offseason (since ==
  // year - 1) is this year's change, the way offseason.py reads a new coach.
  const base = P.grades(SLUG)["stability"];
  const p = prog();
  P._move_grades(p, SLUG, 2028, null, 2027, P.CHURN_MEAN);
  assert(Math.abs(live(p)["stability"] - Math.max(10, base - P.STABILITY_CHANGE)) < 1e-9, () => String(live(p)["stability"]));
});

await run();
