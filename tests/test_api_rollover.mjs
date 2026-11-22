// A career has no last season: through the API, the offseason hands over to the next year five times running (there
// was once a limit of five seasons).
// `node tests/test_api_rollover.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random, sorted } from "../engine_js/pyrt.js";

const game = await start({ env: { SIM_WORKERS: "1", CFP_SEASONS_DIR: "data/seasons-api-test" } });
const { api, season } = game;

/** Every game played (the better team usually wins), every school's class signed, the season over. */
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

test("the offseason rolls over to the next season five times running", () => {
  const s = api.call("POST", "/api/season", { team: "smu", seed: 11, career: true });
  finished(api.loaded_state()); api._save_loaded();
  for (let i = 0; i < 5; i++) {
    const r = api.call("POST", `/api/season/${s["id"]}/offseason/advance`, { to: "next_season" });
    assert(r["next_season"], `no next season after offseason ${i + 1}`);
    finished(api.loaded_state()); api._save_loaded();
  }
  equal(api.loaded_state()["year"], 2031);
});

await run();
