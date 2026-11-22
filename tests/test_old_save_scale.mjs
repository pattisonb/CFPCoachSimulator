// A career saved while its recruits were kept in the other game's numbers (before the game's own 1-99 scale) is
// converted when it loads (teamdata_js/game_scale.js `upgrade`, called by season.load_season): each prospect gets our
// ratings, overall and projected overall, his true grades on our scale, and each scouting read stays as far off the
// truth as it was.
// `node tests/test_old_save_scale.mjs`
import { start, test, run, assert } from "./harness.mjs";

const game = await start();
const { recruiting } = game;
const { game_scale, recruits } = game.modules;

test("a save from when recruits were kept in the other game's numbers converts to our ratings, each read still as far off", () => {
  const cls = recruits.generate_class(2027, 3);
  const attrs = Object.keys(cls[0]["ratings_ea"]).sort();
  const old = { id: "old-save", recruiting: { attrs, prospects: {}, reads: {} } };
  for (const q of cls.slice(0, 5)) {
    q["ratings_ea"] = attrs.map((k) => q["ratings_ea"][k]);
    q["potential_ea"] = attrs.map((k) => q["potential_ea"][k]);
    q["truth"] = Object.fromEntries(recruiting.GROUPS.map((g) => [g, 70.0]));
    q["coachability"] ||= "Steady Grinder";
    old["recruiting"]["prospects"][q["id"]] = q;
  }
  const first = Object.keys(old["recruiting"]["prospects"])[0];
  old["recruiting"]["reads"][first] = { looks: 2, by: { 60: 2 }, g: Object.fromEntries(recruiting.GROUPS.map((g) => [g, [73.0, 0.05]])) };
  assert(game_scale.upgrade(old) && old["recruiting"]["scale"] === "ours");
  const q = old["recruiting"]["prospects"][first];
  assert(!("ratings_ea" in q) && q["ratings"].length === game_scale.keys().length && q["ovr"] >= 1 && q["ovr"] <= q["pot_ovr"] && q["pot_ovr"] <= 99);
  assert(recruiting.GROUPS.every((g) => Math.abs(old["recruiting"]["reads"][first]["g"][g][0] - (q["truth"][g] + 3.0)) < 0.01));
});

await run();
