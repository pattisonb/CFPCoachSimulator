// Quick check of season-long stats: sim a few weeks and print team and player leaders.
// `node tests/test_stats.mjs [team] [weeks]`
import { start, test, run } from "./harness.mjs";
import { fmt, json_dumps } from "../engine_js/pyrt.js";

const game = await start();
const season = game.season;

/** Python's `repr` of a list of tuples would differ; the leaders are printed as JSON. */
const show = (rows) => JSON.stringify(rows);

test("stats", () => {
  const slug = process.argv.length > 2 ? process.argv[2] : "ohio-state";
  const weeks = process.argv.length > 3 ? parseInt(process.argv[3], 10) : 3;
  const t0 = performance.now();
  const st = season.new_season(slug, "full", 5);
  season.advance_to(st, weeks);
  console.log(`${weeks} weeks in ${((performance.now() - t0) / 1000).toFixed(1)}s; state ${(json_dumps(st).length / 1e6).toFixed(2)} MB; teams with stats ${Object.keys(st["season_stats"]).length}`);
  const tv = season.team_stats_view(st);
  console.log("partial:", tv["partial"]);
  for (const r of tv["teams"].slice(0, 5)) {
    console.log(`  ${r["name"].padEnd(16)} ${r["wins"]}-${r["losses"]} ppg ${fmt(r["ppg"], 1)} opp ${fmt(r["opp_ppg"], 1)} ypg ${fmt(r["ypg"], 0)} ypp ${fmt(r["ypp"], 2)} 3rd ${fmt(r["third_pct"], 0)}% top ${fmt(r["top"], 0)}s TO ${r["turnovers"]} opp ypg ${fmt(r["opp_ypg"], 0)}`);
  }
  for (const cat of ["passing", "rushing", "receiving", "defense", "kicking", "returns"]) {
    const pv = season.player_stats_view(st, null, cat, 3);
    console.log(cat, show(pv["players"].map((p) => [p["name"], p["team_name"], p["games"], p["stats"]])));
  }
  const mine = season.player_stats_view(st, slug, "passing");
  console.log("my QBs:", show(mine["players"].map((p) => [p["name"], p["stats"]])));
});

await run();
