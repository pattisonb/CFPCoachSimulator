// School Grades Phase 3 (docs/superpowers/plans/2026-11-11-school-grades-phase-3.md): Game Day, Exposure and Stability
// move each offseason with results, each held to its floor; Location, Facilities and Academics stay; recruits and the
// Programs tab read the live grades. Player Development and Culture start from the head coach and move each offseason
// with how the program's players grew and who it kept (the transfers that once moved Academics are Culture's).
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
    const win = rng.random() < 1 / (1 + Math.pow(10, (a - h) / 7));
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
  const base = { ...P.grades(SLUG), ...P.people_base({}, SLUG) };       // the record's six, and the two that start from the head coach
  equal(P.grades_now(st, SLUG), base);
  equal(P.grades_now({}, SLUG), base, "no league: the base");
  assert(base["development"] >= 5 && base["development"] <= 98 && base["culture"] >= 5 && base["culture"] <= 98, JSON.stringify(base));
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

test("Academics no longer moves with who transfers: that is Culture's", () => {
  const base = P.grades(SLUG)["academics"];
  const p = prog();
  for (let y = 2027; y < 2047; y++) P._move_grades(p, SLUG, y, null, 2020, P.CHURN_MEAN * 4, { base: P.people_base({}, SLUG), gain: 0, kept: 0, broken: 0 });
  equal(live(p)["academics"], base);
});

test("Culture falls with players transferring out and promises broken, rises with players kept home, inside its band", () => {
  const start_ = P.people_base({}, SLUG)["culture"];
  const people = (more) => ({ base: P.people_base({}, SLUG), gain: 0, kept: 0, broken: 0, ...more });
  let p = prog();
  P._move_grades(p, SLUG, 2027, null, 2020, P.CHURN_MEAN + 4, people());
  const lost = live(p)["culture"];
  assert(lost < start_ && start_ - lost <= P.CULTURE_STEP + 0.05, JSON.stringify([start_, lost]));
  assert(p["grades_moved"]["culture"] < 0, JSON.stringify(p["grades_moved"]));
  p = prog();
  P._move_grades(p, SLUG, 2027, null, 2020, P.CHURN_MEAN, people({ kept: 2 }));
  assert(live(p)["culture"] > start_, "keeping players home did not lift it");
  p = prog();
  P._move_grades(p, SLUG, 2027, null, 2020, P.CHURN_MEAN, people({ broken: 1 }));
  assert(live(p)["culture"] < start_, "a broken promise did not cost it");
  p = prog();
  for (let y = 2027; y < 2060; y++) P._move_grades(p, SLUG, y, null, 2020, P.CHURN_MEAN * 5, people());
  assert(live(p)["culture"] >= Math.max(0, start_ - P.CULTURE_BAND) - 0.05, "under its band");
  // a quiet year drifts back toward where the head coach starts it
  const low = live(p)["culture"];
  P._move_grades(p, SLUG, 2061, null, 2020, P.CHURN_MEAN, people());
  assert(live(p)["culture"] > low, "a quiet year did not let it recover");
});

test("Player Development follows how much the program's players grew against the league's, a step a year, inside its band", () => {
  const start_ = P.people_base({}, SLUG)["development"];
  const people = (gain) => ({ base: P.people_base({}, SLUG), gain, kept: 0, broken: 0 });
  let p = prog();
  P._move_grades(p, SLUG, 2027, null, 2020, P.CHURN_MEAN, people(1.0));
  const up = live(p)["development"];
  assert(up > start_ && up - start_ <= P.DEVELOPMENT_STEP + 0.05, JSON.stringify([start_, up]));
  p = prog();
  P._move_grades(p, SLUG, 2027, null, 2020, P.CHURN_MEAN, people(-1.0));
  assert(live(p)["development"] < start_);
  p = prog();
  for (let y = 2027; y < 2060; y++) P._move_grades(p, SLUG, y, null, 2020, P.CHURN_MEAN, people(5.0));
  assert(live(p)["development"] <= Math.min(100, start_ + P.DEVELOPMENT_BAND) + 0.05, "over its band");
  // it starts from the head coach: a better developer of players starts higher
  const of = (pd) => P.people_base({ league: { teams: { [SLUG]: { coaches: { head_coach: { ratings: { player_development: pd } } } } } } }, SLUG)["development"];
  assert(of(90) > of(50) && of(50) > of(20));
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
  // year - 1) is this year's change, the way offseason.js reads a new coach.
  const base = P.grades(SLUG)["stability"];
  const p = prog();
  P._move_grades(p, SLUG, 2028, null, 2027, P.CHURN_MEAN);
  assert(Math.abs(live(p)["stability"] - Math.max(10, base - P.STABILITY_CHANGE)) < 1e-9, () => String(live(p)["stability"]));
});

await run();
