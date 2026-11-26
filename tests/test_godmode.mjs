// God mode: a player edit is validated, shows on the profile and the depth chart, and
// changes how the engine sees the player. Ratings are edited by the names his card prints, in card numbers.
// `node tests/test_godmode.mjs`
import { start, test, run, assert } from "./harness.mjs";

const game = await start();
const { season } = game;
const show = (v) => () => JSON.stringify(v);
const rating = (profile, label) => profile["skills"].flatMap((g) => g["rows"]).find((r) => r["label"] === label)["value"];

test("god mode", () => {
  const st = season.new_season("ohio-state", "full", 2);
  assert(season.settings(st)["god_mode"] === false);
  season.update_settings(st, { god_mode: true });
  assert(season.settings(st)["god_mode"]);
  const team = season.load_teams()["ohio-state"];
  const qb = team["offense"].find((p) => p["position"] === "QB" && p["in_game"]);
  const before = season.player_profile(st, "ohio-state", undefined, undefined, qb["slug"]);
  const ratings = { "Arm Strength": 99, "Short Accuracy": 99, "Deep Accuracy": "99", "Decision Making": 99 };
  const edits = season.edit_player(st, "ohio-state", qb["slug"], { ratings, jersey: "7", class: "SR", dev_trait: "Elite", weight: 230 });
  assert(edits["dmv"] === 99 && edits["jersey"] === "7" && edits["class"] === "SR", show(edits));
  const after = season.player_profile(st, "ohio-state", undefined, undefined, qb["slug"]);
  for (const label of Object.keys(ratings)) assert(rating(after, label) === 99, show([label, rating(after, label)]));   // typed 99: his card shows 99
  assert(after["jersey"] === "7" && after["class_name"] === "Senior" && after["dev_trait"] === "Elite" && after["weight"] === 230);
  assert(after["overall"] > before["overall"], show([before["overall"], after["overall"]]));
  assert(after["edited"].includes("skills"), show(after["edited"]));
  // the edit flows into the depth chart and the sim's team data
  const chart = season.depth_chart_view(st, "ohio-state");
  const row = chart["units"].flatMap((u) => u["rows"]).find((r) => r["role"] === "QB");
  assert(row["players"][0]["jersey"] === "7", show(row["players"][0]));
  const t = season.team_data(st, "ohio-state");
  const played = t["offense"].find((p) => p["slug"] === qb["slug"]);
  assert(played["passing"] > qb["passing"] && played["dmv"] === 99, show([qb["passing"], played["passing"], played["dmv"]]));
  // bad edits are refused; an edit back to the original clears itself
  for (const bad of [{ name: "Someone" }, { class: "XX" }, { ratings: { "Arm Strength": "lots" } }, { ratings: { "Charisma": 90 } }, { dev_trait: "Legend" }]) {
    let accepted = false;
    try {
      season.edit_player(st, "ohio-state", qb["slug"], bad);
      accepted = true;
    } catch (e) {
      if (!(e instanceof game.coaches.ValueError)) throw e;
    }
    assert(!accepted, `accepted a bad edit: ${JSON.stringify(bad)}`);
  }
  const back = Object.fromEntries(Object.keys(ratings).map((label) => [label, rating(before, label)]));
  season.edit_player(st, "ohio-state", qb["slug"], { ratings: back });
  const left = season.player_edits(st, "ohio-state")[qb["slug"]];
  assert(!("skills" in left) && !("dmv" in left), show(left));      // every rating as it was: no rating edit left
  // clamped, and a season still sims with edits in place
  season.edit_player(st, "ohio-state", qb["slug"], { ratings: { "Arm Strength": 250 } });
  assert(rating(season.player_profile(st, "ohio-state", undefined, undefined, qb["slug"]), "Arm Strength") === 99);   // clamped to 99
  season.advance_to(st, 2);
  console.log("god mode ok:", qb["name"], "| overall", before["overall"], "->", after["overall"]);
});

await run();
