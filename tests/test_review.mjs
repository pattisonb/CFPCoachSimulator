// Sim a full season and print the Summary tab's data (national leaders, surprises, your leaders).
// `node tests/test_review.mjs [team]`
import { start, test, run } from "./harness.mjs";

const game = await start();
const { season } = game;

test("season review", () => {
  const slug = process.argv.length > 2 ? process.argv[2] : "ohio-state";
  const t0 = performance.now();
  const st = season.new_season(slug, "full", 5);
  season.advance_to(st, 19);
  season.save_season(st);
  const r = season.season_review(st);
  console.log(`${st["team_name"]} season ${st["id"]} in ${((performance.now() - t0) / 1000).toFixed(1)}s; champion ${r["champion_name"]}`);
  for (const [k, v] of Object.entries(r["national_leaders"])) {
    const stats = Object.fromEntries(Object.entries(v["stats"]).filter(([, x]) => x));
    console.log(`  ${k.padEnd(14)} ${v["name"]} (${v["position"]}, ${v["team_name"]}, ${v["games"]} g) ${JSON.stringify(stats)}`);
  }
  const row = (x) => [x["name"], x["record"], x["preseason_rank"], x["rating_rank"], x["final_rank"], x["swing"]];
  console.log("surprises:", JSON.stringify(r["surprises"].map(row)));
  console.log("disappointments:", JSON.stringify(r["disappointments"].map(row)));
  const m = r["mine"];
  const leaders = Object.fromEntries(Object.entries(m["leaders"]).map(([k, v]) => [k, v !== null && typeof v === "object" && !Array.isArray(v) ? v["name"] : v]));
  console.log("mine:", m["wins"], m["losses"], m["finish"], JSON.stringify(leaders));
});

await run();
