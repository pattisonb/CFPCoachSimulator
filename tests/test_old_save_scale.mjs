// A save from before the game kept every number as the card's is turned into card numbers once, as it loads
// (teamdata_js/old_saves.js, called by season.load_season): recruits kept in the recruiting model's numbers (card numbers
// already) get their ratings, overall and projected overall worked out again with each scouting read as far off the
// truth as it was; a league kept on the earlier numbers gets every rating, room and coach as the card numbers they
// showed as. Either is stamped as card numbers and never converted twice.
// `node tests/test_old_save_scale.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { old_saves } from "../teamdata_js/old_saves.js";

const game = await start();
const { recruiting } = game;
const { game_scale, recruits, league } = game.modules;

test("a save from when recruits were kept in the recruiting model's numbers: card numbers, each read still as far off", () => {
  const cls = recruits.generate_class(2027, 3);
  const attrs = Object.keys(cls[0]["ratings"]).sort();
  const old = { id: "old-save", recruiting: { attrs, prospects: {}, reads: {} } };
  const want = {};
  for (const q of cls.slice(0, 5)) {
    want[q["id"]] = attrs.map((k) => game_scale.whole(q["ratings"][k]));
    q["ratings_ea"] = attrs.map((k) => q["ratings"][k]);
    q["potential_ea"] = attrs.map((k) => q["potential"][k]);
    delete q["ratings"];
    delete q["potential"];
    q["truth"] = Object.fromEntries(recruiting.GROUPS.map((g) => [g, 70.0]));
    q["coachability"] ||= "Steady Grinder";
    old["recruiting"]["prospects"][q["id"]] = q;
  }
  const first = Object.keys(old["recruiting"]["prospects"])[0];
  old["recruiting"]["reads"][first] = { looks: 2, by: { 60: 2 }, g: Object.fromEntries(recruiting.GROUPS.map((g) => [g, [73.0, 0.05]])) };
  assert(old_saves.upgrade(old) && old["recruiting"]["scale"] === "card");
  const q = old["recruiting"]["prospects"][first];
  assert(!("ratings_ea" in q) && !("potential_ea" in q));
  equal(q["ratings"], want[first]);                                         // the model's numbers are card numbers
  assert(q["ovr"] >= 1 && q["ovr"] <= q["pot_ovr"] && q["pot_ovr"] <= 99, JSON.stringify([q["ovr"], q["pot_ovr"]]));
  equal(q["ovr"], game_scale.overall(Object.fromEntries(attrs.map((k, i) => [k, q["ratings"][i]])), q["ea_position"]));
  assert(recruiting.GROUPS.every((g) => Math.abs(old["recruiting"]["reads"][first]["g"][g][0] - (q["truth"][g] + 3.0)) < 0.01));
  assert(!old_saves.upgrade(old), "converted twice");
});

test("a league kept on the earlier numbers: every rating, room and coach as the card number it showed as, stamped once", () => {
  const lg = league.from_base(2028);
  const attrs = lg["attrs"];
  const t = lg["teams"]["texas"], c = t["roster"][0];
  const grp = game_scale.group(c["pos"]);
  // as an old save held him: his earlier numbers, which show as these card numbers
  c["r"] = attrs.map(() => 50);
  c["g"] = attrs.map(() => 10);
  t["coaches"]["head_coach"]["ratings"] = { recruiting: 50, offense: 80 };
  lg["scale"] = "ours";
  const st = { id: "old-league", league: lg };
  assert(old_saves.upgrade(st) && lg["scale"] === "card" && lg["overall_v"] === game_scale.overall_version());
  const now = attrs.map((k) => game_scale.whole(old_saves.shown.skill(50, grp, k)));
  const top = attrs.map((k) => game_scale.whole(old_saves.shown.skill(60, grp, k)));
  equal(c["r"], now);
  equal(c["g"], now.map((v, i) => Math.max(0, top[i] - v)));
  equal(c["o"], game_scale.overall(Object.fromEntries(attrs.map((k, i) => [k, c["r"][i]])), c["pos"], c["dmv"]));
  equal(t["coaches"]["head_coach"]["ratings"], { recruiting: 70, offense: 88 });   // the average coach a 70
  // every other player is as the roster file has him: a later load changes nothing
  const before = JSON.stringify(lg);
  assert(!old_saves.upgrade(st) && JSON.stringify(lg) === before, "converted twice");
});

await run();
