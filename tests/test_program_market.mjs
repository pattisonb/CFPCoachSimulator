// A program's market (career_js/programs.js, data/program_market.json): real home crowds and
// TV audiences give every FBS program a market score 0-100 that the living program rating reads.
// `node tests/test_program_market.mjs`
import { start, test, run, assert } from "./harness.mjs";
import { median } from "../engine_js/pystat.js";

const game = await start();
const { season } = game;
const programs = game.modules.programs;
const show = (v) => () => JSON.stringify(v);

test("program market", () => {
  const d = JSON.parse(game.files.read_text(programs.MARKET))["teams"];
  assert(Object.keys(d).length >= 130, show(Object.keys(d).length));
  assert(Object.values(d).every((v) => 0 <= v["market"] && v["market"] <= 100 && v["attendance"] > 3000 && v["tv_millions"] > 0));
  const top = Object.keys(d).sort((a, b) => d[b]["market"] - d[a]["market"]).slice(0, 12);     // (a stable sort, as Python's)
  assert(["alabama", "georgia", "ohio-state", "michigan", "texas", "penn-state"].every((s) => top.includes(s)), show(top));
  assert(Object.values(d).filter((v) => v["tv_known"]).length >= 10);
  const teams = season.load_teams();
  const p4 = Object.entries(teams).filter(([s, t]) => programs.P4.has(t["conference"])).map(([s]) => programs.market(s));
  const g5 = Object.entries(teams).filter(([s, t]) => !t["fictional"] && !programs.P4.has(t["conference"]) && s !== "notre-dame").map(([s]) => programs.market(s));
  assert(median(p4) > median(g5) + 20, show([median(p4), median(g5)]));
  assert(programs.market("ndsu") === programs.MARKET_DEFAULT && programs.market("alabama") >= 95);
  const row = programs.market_row("ohio-state");
  assert(row["attendance"] > 100000 && row["tv_known"] && row["market"] >= 85, show(row));
  console.log(`program market ok: ${Object.keys(d).length} programs, top ${JSON.stringify(top.slice(0, 5))}, P4 median ${median(p4)} vs G5 ${median(g5)}`);
});

await run();
