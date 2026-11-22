// Check that Army-Navy is played in selection week, after the bracket is set.
// `node tests/test_army_navy.mjs`
import { start, test, run } from "./harness.mjs";
import { get } from "../engine_js/pyrt.js";

const game = await start();
const season = game.season;

test("army_navy", () => {
  const st = season.new_season("army", "full", 3);
  season.advance_to(st, 16);
  const an = Object.values(st["games"]).filter((g) => new Set([g["home"], g["away"]]).size === 2 && [g["home"], g["away"]].every((t) => t === "army" || t === "navy"));
  for (const g of an) {
    console.log(`week ${g["week"]} played=${g["played"]} ${g["away_display"]} ${g["away_score"]} at ${g["home_display"]} ${g["home_score"]} neutral=${g["neutral"]} site=${get(g, "site")}`);
  }
  console.log("bracket set before Army-Navy:", Boolean(st["bracket"]), "| Army in field:", st["bracket"]["seeds"].some((x) => x["team"] === "army"));
  console.log("week 15 games:", JSON.stringify(Object.values(st["games"]).filter((g) => g["week"] === 16).map((g) => [g["away_display"], g["home_display"]])));
});

await run();
