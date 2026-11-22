// This week: a bye says so, the next game carries a prediction that adds up and the
// injury report, a game already played (game day) shows its result, and a finished season
// has no game.
// `node tests/test_preview.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { round } from "../engine_js/pyrt.js";

const game = await start();
const { season } = game;

const pct = (x) => `${round(x * 100)}%`;   // Python's f"{x:.0%}"

test("preview", () => {
  const st = season.new_season("ohio-state", "full", 5);
  let pv = season.game_preview(st, "ohio-state");
  assert(pv["game"] === null && pv["reason"] === "bye" && pv["week"] === 1, "Ohio State's week 1 is a bye in 2026");
  season.advance_to(st, 1);
  const t0 = performance.now();
  pv = season.game_preview(st, "ohio-state");
  const dt = (performance.now() - t0) / 1000;
  let g = pv["game"], p = pv["prediction"];
  assert(g["week"] === 2 && g["opponent"] === "ball-state" && !g["played"], () => JSON.stringify(g));
  assert(0.02 <= p["win_prob"] && p["win_prob"] <= 0.98 && p["sims"] === 20, "never a sure thing");
  assert(Math.abs(p["points_for"] - p["points_against"] - p["margin"]) < 0.01);
  assert(Math.abs(p["points_for"] + p["points_against"] - p["total"]) < 0.01);
  assert(p["watch"]["passer"] && p["watch"]["passer"]["position"] === "QB");
  console.log(`week 2 ${g["venue"]} vs ${g["opponent_name"]}: ${p["points_for"]}-${p["points_against"]}, win ${pct(p["win_prob"])}, ${dt.toFixed(1)}s for ${p["sims"]} sims`);
  const pv2 = season.game_preview(st, "ohio-state");
  equal(pv2["prediction"], p, "cached on the second call");
  season.advance_to(st, 5);
  pv = season.game_preview(st, "ohio-state");
  g = pv["game"]; p = pv["prediction"];
  assert(g["week"] === 6, () => JSON.stringify(g));
  console.log(`week 6 ${g["venue"]} vs ${g["opponent_name"]} (#${g["opponent_rank"]}, ${g["opponent_record"]}): ${p["points_for"]}-${p["points_against"]}, win ${pct(p["win_prob"])}; `
    + `injuries out: ${pv["injuries"].length}; rivalry: ${g["rivalry"] && g["rivalry"]["trophy"]}`);
  // game day: your game is in, the rest of the week is not; the card shows the result
  const eid = season.play_my_game(st);
  assert(eid && st["current_week"] === 5);
  pv = season.game_preview(st, "ohio-state");
  g = pv["game"];
  assert(pv["played"] && g["played"] && g["event_id"] === eid && pv["prediction"] === null);
  assert(g["points_for"] !== null && g["points_for"] !== undefined && g["has_box"] && (g["won"] ? "W" : "L"));
  console.log(`after game day: ${g["won"] ? "W" : "L"} ${g["points_for"]}-${g["points_against"]} vs ${g["opponent_name"]}, record ${g["my_record"]}`);
  season.advance(st);
  assert(st["current_week"] === 6);
  season.advance_to(st, 20);
  assert(season.game_preview(st, "ohio-state")["game"] === null);
  console.log("preview ok");
});

await run();
