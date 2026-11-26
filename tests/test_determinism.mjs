// The same seed gives the same offseason: departures, the players who want out, the coaching
// carousel. The random streams are seeded from the season's seed, so a test that fixes the seed
// sees the same numbers every run.
// `node tests/test_determinism.mjs`
import { start, test, run, assert } from "./harness.mjs";
import { Random, json_dumps, sorted } from "../engine_js/pyrt.js";

const game = await start();
const { season, offseason } = game;

/** Every game played (the better team usually wins), every school's class signed, season over (tests/test_offseason). */
function finished(st) {
  const rng = new Random(1);
  const teams = season.load_teams();
  for (const g of Object.values(st["games"])) {
    const h = teams[g["home"]]["team_ratings"]["overall"], a = teams[g["away"]]["team_ratings"]["overall"];
    const hs = rng.randint(10, 45);
    const win = rng.random() < 1 / (1 + Math.pow(10, (a - h) / 7));
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

function one() {
  const st = season.new_season("ohio-state", "full", 5, undefined, undefined, true);
  finished(st);
  offseason.start(st);
  const off = st["offseason"];
  const league = st["league"];
  const is_dict = league !== null && league !== undefined && typeof league === "object" && !Array.isArray(league);
  const picture = { departures: off["departures"] ?? null, retention: off["retention"] ?? null, fired: off["fired"] ?? null,
    coaching: is_dict ? [...(league["coaching_changes"] || [])] : null };
  return json_dumps(picture, { sort_keys: true });
}

test("determinism", () => {
  const a = one(), b = one();
  assert(a === b, "two offseasons from the same seed differ");
  console.log(`determinism ok: the same seed gives the same offseason (${a.length} bytes of departures, retention and carousel)`);
});

await run();
