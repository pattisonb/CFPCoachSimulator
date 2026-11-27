// The browser's helper workers (ui/public/sim-worker.js) play a week's games through the engine's api.sim_one, which
// reads the league's teams file itself. It must read the roster file as the game does (rosters.derive): a game a
// helper plays is the game season._sim_one plays from the same job, every stat line and score.
import { start, test, run, assert } from "./harness.mjs";

const game = await start({ env: { SIM_WORKERS: "1" } });
const { season } = game;
const { api: engine } = await import("../engine_js/api.js");

test("a helper plays the roster file's game", () => {
  const st = season.new_season("smu", "full", 11, undefined, undefined, true);
  let jobs = null;
  const own = season.play_jobs;
  season.play_jobs = (js, on) => { jobs ??= js; own(js, on); };
  try { season.advance_to(st, 1); } finally { season.play_jobs = own; }
  const path = String(season._TEAMS_PATH || season._league_path);
  for (const job of jobs.slice(0, 3)) {
    const copy = () => JSON.parse(JSON.stringify(job));
    const here = season._sim_one(copy()), helper = engine.sim_one([path, "test"], copy());
    for (const r of [here, helper]) if (r.game) for (const k of ["id", "played_at", "duration_ms"]) delete r.game[k];
    assert(JSON.stringify(here) === JSON.stringify(helper),
      () => `game ${job[0]}: here ${here.home_score}-${here.away_score}, a helper ${helper.home_score}-${helper.away_score}, pass yards ${helper.stats.home.team["Pass Yards"]}`);
  }
});

await run();
