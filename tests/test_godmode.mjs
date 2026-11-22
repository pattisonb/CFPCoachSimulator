// God mode: a player edit is validated, shows on the profile and the depth chart, and
// changes how the engine sees the player.
// `node tests/test_godmode.mjs`
import { start, test, run, assert, raises } from "./harness.mjs";

const game = await start();
const { season } = game;
const show = (v) => () => JSON.stringify(v);

test("god mode", () => {
  const st = season.new_season("ohio-state", "full", 2);
  assert(season.settings(st)["god_mode"] === false);
  season.update_settings(st, { god_mode: true });
  assert(season.settings(st)["god_mode"]);
  const team = season.load_teams()["ohio-state"];
  const qb = team["offense"].find((p) => p["position"] === "QB" && p["in_game"]);
  const before = season.player_profile(st, "ohio-state", undefined, undefined, qb["slug"]);
  const edits = season.edit_player(st, "ohio-state", qb["slug"], { passing: 99, speed: "88", jersey: "7", class: "SR", dev_trait: "Elite", weight: 230 });
  assert(edits["passing"] >= 90 && edits["speed"] > 0 && edits["jersey"] === "7" && edits["class"] === "SR");   // ratings are stored on the engine scale
  const after = season.player_profile(st, "ohio-state", undefined, undefined, qb["slug"]);
  assert(Object.fromEntries(after["ratings"].map((r) => [r["key"], r["value"]]))["passing"] >= season.house_value("QB", "passing", 99) - 1);   // typed 99: the top of the house scale for QB passing
  assert(after["jersey"] === "7" && after["class_name"] === "Senior" && after["dev_trait"] === "Elite" && after["weight"] === 230);
  assert(after["overall"] > before["overall"], show([before["overall"], after["overall"]]));
  assert(after["edited"].includes("passing"));
  // the edit flows into the depth chart and the sim's team data
  const chart = season.depth_chart_view(st, "ohio-state");
  const row = chart["units"].flatMap((u) => u["rows"]).find((r) => r["role"] === "QB");
  assert(row["players"][0]["jersey"] === "7", show(row["players"][0]));
  const t = season.team_data(st, "ohio-state");
  assert(t["offense"].find((p) => p["slug"] === qb["slug"])["passing"] === edits["passing"]);   // the engine-scale value
  // bad edits are refused; an edit back to the original clears itself
  for (const bad of [{ name: "Someone" }, { class: "XX" }, { passing: "lots" }, { dev_trait: "Legend" }]) {
    let accepted = false;
    try {
      season.edit_player(st, "ohio-state", qb["slug"], bad);
      accepted = true;
    } catch (e) {
      if (!(e instanceof game.coaches.ValueError)) throw e;
    }
    assert(!accepted, `accepted a bad edit: ${JSON.stringify(bad)}`);
  }
  season.edit_player(st, "ohio-state", qb["slug"], { passing: season.display_rating(qb, "passing") });
  const left = season.player_edits(st, "ohio-state")[qb["slug"]]["passing"] ?? qb["passing"];
  assert(Math.abs(left - qb["passing"]) <= 1, show([left, qb["passing"]]));   // typed back on the EA scale: within rounding of the original
  // clamped, and a season still sims with edits in place
  season.edit_player(st, "ohio-state", qb["slug"], { passing: 250 });
  assert(season.player_edits(st, "ohio-state")[qb["slug"]]["passing"] === season.engine_rating(qb, "passing", 99));   // clamped to 99 on the EA scale
  season.advance_to(st, 2);
  console.log("god mode ok:", qb["name"], "passing", qb["passing"], "->", 99, "| overall", before["overall"], "->", after["overall"]);
});

await run();
