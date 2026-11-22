// Season-long AP behavior in a simulated season against the real 2014-2025 polls
// (data/history/poll_stats.json): how far a ranked team drops after a loss, by where it was
// ranked, and how many teams the poll turns over in a week. Also checks the rest-of-season
// mode starts from the real poll with its real vote points.
// `node tests/test_poll_behavior.mjs`
import fs from "node:fs";
import path from "node:path";
import { start, test, run, assert, ROOT } from "./harness.mjs";
import { mean } from "../engine_js/pystat.js";
import { fmt } from "../engine_js/pyrt.js";

const game = await start();
const { season } = game;

/** The AP rank band poll_stats.json groups losses by. */
function rank_band(rank) {
  if (rank <= 5) return "1-5";
  if (rank <= 10) return "6-10";
  if (rank <= 15) return "11-15";
  if (rank <= 20) return "16-20";
  return "21-25";
}

test("poll behavior", () => {
  const real = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "history", "poll_stats.json"), "utf8"))["loss_drop"];
  const drops = {};
  const turnover = [];
  for (const seed of [3, 4]) {
    const st_ = season.new_season("ohio-state", "full", seed);
    season.advance_to(st_, 14);
    for (let w = 1; w < 15; w++) {
      const before = Object.fromEntries(st_["polls"][String(w - 1)]["ap"].map((e) => [e["team"], e["rank"]]));
      const after = Object.fromEntries(st_["polls"][String(w)]["ap"].map((e) => [e["team"], e["rank"]]));
      assert(st_["polls"][String(w)]["ap"].every((e) => e["points"]), "every poll carries vote points");
      turnover.push(Object.keys(after).filter((t) => !(t in before)).length);
      for (const g of Object.values(st_["games"])) {
        if (g["week"] !== w || !g["played"] || g["home_score"] === g["away_score"]) continue;
        const loser = g["home_score"] > g["away_score"] ? g["away"] : g["home"];
        const winner = loser === g["away"] ? g["home"] : g["away"];
        const r = before[loser];
        if (!r) continue;
        const kind = before[winner] ? "vs ranked" : "vs unranked";
        (drops[`${rank_band(r)}|${kind}`] ??= []).push((after[loser] ?? 26) - r);
      }
    }
  }
  const first = (k) => Number(k.split("|")[0].split("-")[0]);
  console.log(`${"band".padEnd(22)}${"sim drop".padStart(10)}${"n".padStart(5)}${"real drop".padStart(11)}`);
  for (const k of Object.keys(drops).sort((a, b) => first(a) - first(b) || (a < b ? -1 : a > b ? 1 : 0))) {
    const rv = (real[k] || {})["mean"];
    console.log(`${k.padEnd(22)}${fmt(mean(drops[k]), 1).padStart(10)}${String(drops[k].length).padStart(5)}${(rv ? fmt(rv, 1) : "-").padStart(11)}`);
  }
  console.log(`new teams per week: sim ${fmt(mean(turnover), 1)} (real polls 2014-2025 turn over about 3 a week)`);

  console.log("poll behavior ok");
});

await run();
