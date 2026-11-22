// The yearly meeting with your athletic director (career_js/offseason.js review): at the
// Departures step the AD gives his verdict on your season; on the hot seat you can make your case,
// offer a change on your staff or ask for one more year, and the firing (only at the end of a
// season) is decided there. Fired, you walk the offseason on Auto and pick your next job at the
// Staff step.
// `node tests/test_ad_review.mjs`
import { start, test, run, assert, raises } from "./harness.mjs";
import { Random, sorted, floordiv } from "../engine_js/pyrt.js";

const game = await start();
const { season, offseason } = game;
const carousel = game.modules.carousel;
const lg = game.modules.league;
const show = (v) => () => JSON.stringify(v);

/** tests/test_offseason's `finished`, copied here (a test file runs its tests when it is imported):
 * every game played (the better team usually wins), every school's class signed, season over. */
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
  const schools = Object.entries(teams).filter(([s, t]) => !t["fictional"]).map(([s]) => s);
  const pids = sorted(Object.keys(rc["prospects"]), (p) => rc["prospects"][p]["rank"]);
  pids.slice(0, schools.length * 21).forEach((pid, i) => { rc["status"][pid]["signed"] = schools[i % schools.length]; });
  Object.assign(st, { done: true, current_week: season.FINAL_WEEK, champion: "ohio-state" });
}

function fresh(security) {
  const st = season.new_season("ohio-state", "full", 7, undefined, undefined, true);
  finished(st);
  st["league"] = lg.from_base(season.season_year(st) + 1);
  const t = st["league"]["teams"]["ohio-state"];
  t["ad"] = { patience: 3, security };
  t["coaches"]["head_coach"]["since"] = 2020;
  return st;
}

/** `fn` must throw one of `classes`; anything else it throws goes on up, and not throwing is `message`. */
function must_raise(fn, classes, message) {
  try {
    fn();
  } catch (e) {
    if (classes.some((k) => e instanceof k)) return;
    throw e;
  }
  throw new Error(message);
}

test("ad review", () => {
  // a champion: the review is a pat on the back, nothing to decide
  let st = fresh(70);
  let off = offseason.start(st);
  let rv = off["review"];
  assert(rv["security"] >= 70 && ["Secure", "Untouchable"].includes(rv["mood"]) && rv["risk"] === "none" && rv["decided"], show(rv));
  assert(rv["record"] && rv["goal"] && [true, false].includes(rv["met"]) && rv["outcome"]);
  // a coach deep on the hot seat (a title does not save a security that low): the AD decides,
  // and asking for one more year survives it with an ultimatum
  st = fresh(2);
  off = offseason.start(st);
  rv = off["review"];
  assert(rv["risk"] === "fire" && !rv["decided"] && ["case", "change", "year", "nothing"].every((o) => rv["options"].includes(o)), show(rv));
  must_raise(() => offseason.advance(st), [offseason.ReviewError], "advanced past an undecided review");
  offseason.review_decide(st, "year");
  assert(rv["decided"] && !rv["fired"] && rv["outcome"] && rv["outcome"].toLowerCase().includes("ultimatum"), show(rv));
  assert(st["league"]["teams"]["ohio-state"]["ad"]["ultimatum"] === off["year"] + 1);
  assert(carousel.status(st)["ultimatum"]);
  // offer a change: your coordinator goes (he joins the market, his job opens at the Staff step). The start is
  // chosen so the season's verdict lands mid-warning, whatever the season's real results add or take away
  const probe = offseason.start(fresh(50))["review"]["security"] - 50;
  const start_ = floordiv(carousel.FIRE_BELOW + offseason.WARNING_BELOW, 2) - probe;
  st = fresh(start_);
  off = offseason.start(st);
  rv = off["review"];
  assert(rv["risk"] === "warning" && !rv["decided"], show([start_, probe, rv["security"]]));
  const before = rv["security"];
  const n = carousel.market(st)["coaches"].length;
  offseason.review_decide(st, "change", "dc");
  assert(rv["decided"] && !rv["fired"] && rv["security"] === Math.min(100, before + offseason.CHANGE_GAIN), show(rv));
  assert(carousel.market(st)["coaches"].length === n + 1);
  st["offseason"]["auto"] = true;
  while (off["stage"] !== "staff") offseason.advance(st);
  assert(off["staff"]["leaving"].includes("dc") && off["staff"]["candidates"]["dc"].length >= 4);
  // fired at the review (a security that low leaves the AD no choice): the rest of the offseason
  // runs itself, the Staff step offers openings
  st = fresh(-10);
  off = offseason.start(st);
  offseason.review_decide(st, "nothing");
  rv = off["review"];
  assert(rv["decided"] && rv["fired"], show(rv));
  while (off["stage"] !== "staff") offseason.advance(st);
  const car = off["carousel"];
  assert(car["you"]["fired"] && car["openings"].length, show(car["you"]));
  must_raise(() => offseason.retain(st, "x", "meet"), [offseason.RetentionError, game.coaches.ValueError], "a fired coach can still act");
  offseason.choose_job(st, car["openings"][0]);
  offseason.advance(st);
  assert(off["stage"] === "conferences");            // then Change Conferences and Edit Schedule, before the recap
  offseason.advance(st);
  assert(off["stage"] === "schedule" && off["next_schedule"]["games"]);
  offseason.advance(st);
  assert(off["stage"] === "ready");
  const new_ = offseason.next_season(st);
  assert(new_["team"] === car["openings"][0]);
  assert(off["coaching_changes"].some((c) => c["team"] === "ohio-state" && c["reason"] === "fired"));
  season.close_pool();
  console.log("ad review ok");
});

await run();
