// Program ratings' starting values (tools/build_program_history.py -> data/program_history.json,
// read by career_js/programs.js): every FBS program's history, winning, market, NIL, conference
// and coach scores (0-100), the mixed rating and its tier, with the top of the list recognizable.
// `node tests/test_program_history.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { fmt, get, sum, sorted } from "../engine_js/pyrt.js";
import { median } from "../engine_js/pystat.js";

const game = await start();
const { season } = game;
const { programs } = game.modules;
const J = (v) => () => JSON.stringify(v);

test("program history", () => {
  const d = JSON.parse(game.files.read_text(programs.HISTORY))["teams"];
  const teams = season.load_teams();
  const fbs = Object.keys(teams).filter((s) => !get(teams[s], "fictional"));
  assert(fbs.every((s) => s in d), J(fbs.filter((s) => !(s in d)).slice(0, 5)));
  const keys = ["history", "prestige", "winning", "market", "nil", "conference", "coach", "rating", "tier"];
  for (const s of fbs) {
    const p = d[s];
    assert(keys.every((k) => k in p) && keys.filter((k) => k !== "tier").every((k) => 0 <= p[k] && p[k] <= 100) && 1 <= p["tier"] && p["tier"] <= 5, J([s, p]));
  }
  const top = sorted(fbs, (s) => -d[s]["rating"]);
  const blue = ["ohio-state", "georgia", "alabama", "texas", "michigan", "oregon", "notre-dame", "lsu", "penn-state", "clemson", "usc", "oklahoma"];
  assert(blue.filter((s) => top.slice(0, 25).includes(s)).length >= 11, J(blue.filter((s) => !top.slice(0, 25).includes(s))));
  assert(["florida-state", "texas-a-m", "florida", "miami", "tennessee", "auburn", "ole-miss", "wisconsin", "iowa", "washington"].filter((s) => top.slice(0, 30).includes(s)).length >= 7, J(top.slice(0, 30)));
  assert(d["ohio-state"]["tier"] === 1 && d["alabama"]["tier"] === 1 && d["akron"]["tier"] === 5 && d["ohio-state"]["history"] >= 90);
  const hist = fbs.map((s) => d[s]["history"]);
  assert(100 >= Math.max(...hist) && 32 <= median(hist) && median(hist) <= 48, J([Math.max(...hist), median(hist)]));
  const counts = {};
  for (let k = 1; k < 6; k++) counts[k] = fbs.filter((s) => d[s]["tier"] === k).length;
  assert(6 <= counts[1] && counts[1] <= 16 && counts[2] >= 10 && counts[5] >= 15, J(counts));
  // the base loader and the z the old readers expect (about -2 to +2, in step with the recruiting baseline)
  const b = programs.base("ohio-state");
  assert(b["tier"] === 1 && programs.z_of(b["rating"]) > 1.2 && programs.z_of(programs.base("akron")["rating"]) < -0.8);
  assert(programs.base("ndsu")["tier"] === 5);
  assert(programs.pick_points(1) === 4 && programs.pick_points(3) === 2 && programs.pick_points(7) === 1);
  const line = programs.draft_line(2025, [[1, "WR"], [2, "CB"], [7, "WR"]]);
  equal(line, [2025, 8, { WR: 5, CB: 3 }]);
  const lines = [];
  for (let y = 2016; y < 2026; y++) lines.push([y, 1, { QB: 1 }]);
  assert(programs.pro_score(lines, 2025) === 15);
  equal(programs.pro_group_scores(lines, 2025), { QB: 15 });   // five old at 1, five new at 2
  assert(programs.pro_score([[2010, 50, { QB: 50 }], ...lines], 2025) === 15, "only the last ten lines count");
  for (const s of fbs) {
    const p = d[s];
    assert(0 <= p["pro"] && p["pro"] <= 100 && p["drafts"].length === 10 && p["drafts"][0][0] === 2016 && p["drafts"][p["drafts"].length - 1][0] === 2025, J([s, get(p, "pro")]));
    assert(Object.values(p["pro_groups"]).every((v) => 0 <= v && v <= 100));
  }
  assert(d["alabama"]["pro"] === 100 && d["ohio-state"]["pro"] >= 85 && d["georgia"]["pro"] >= 85);
  assert(d["army"]["pro"] === 0 && Object.keys(d["army"]["pro_groups"]).length === 0 && d["kent-state"]["pro"] === 0);
  const pro = fbs.map((s) => d[s]["pro"]);
  assert(32 <= median(pro) && median(pro) <= 48, J(median(pro)));
  assert(d["ohio-state"]["pro_groups"]["WR"] >= 80 && get(d["alabama"]["pro_groups"], "OT", 0) >= 60);
  const sc = JSON.parse(game.files.read_text(programs.HISTORY))["scales"];
  assert(sc["pro"]["lo"] === 0 && sc["pro"]["hi"] > 0 && ["QB", "WR", "OT", "EDGE", "CB"].every((g) => g in sc["pro_group"]));
  assert(Math.abs(sum(Object.values(programs.WEIGHTS)) - 1.0) < 1e-9 && programs.WEIGHTS["pro"] === 0.10);
  console.log(`program history ok: top ${JSON.stringify(top.slice(0, 8))}, tiers ${JSON.stringify(counts)}, history median ${fmt(median(hist), 0)}`);
});

await run();
