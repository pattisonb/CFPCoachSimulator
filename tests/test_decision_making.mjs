// A quarterback's Decision Making is a rating of its own in a career (the player's rule: no rating is worked out from
// others, and the sim plays the one he has): the league keeps it ("dmv", with its room "dmg"), an offseason grows it
// toward its own ceiling by a draw of its own, and nothing of his Football IQ or his Pocket Poise moves it.
// `node tests/test_decision_making.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random } from "../engine_js/pyrt.js";

const game = await start();
const { offseason } = game;
const { league: lg, build_teams, clear } = game.modules;

const lgd = lg.from_base();
const attrs = offseason._attrs(lgd);
const quarterbacks = Object.values(lgd["teams"]).flatMap((t) => t["roster"]).filter((p) => p["pos"] === "QB");
const at = (k) => attrs.indexOf(k);

test("every quarterback of a career's first league has a Decision Making of his own, and nobody else has one", () => {
  assert(quarterbacks.length > 400, `${quarterbacks.length} quarterbacks`);
  for (const p of quarterbacks) {
    assert(Number.isInteger(p["dmv"]) && p["dmv"] >= 1 && p["dmv"] <= 99 && Number.isInteger(p["dmg"]) && p["dmg"] >= 0 && p["dmv"] + p["dmg"] <= 99 && !("dm" in p),
      JSON.stringify([p["n"], p["dmv"], p["dmg"]]));
  }
  for (const t of Object.values(lgd["teams"])) for (const p of t["roster"]) assert(p["pos"] === "QB" || !("dmv" in p), `${p["n"]} ${p["pos"]}`);
});

test("an offseason grows it on its own: toward its own ceiling, by its own draw, whatever his Football IQ and Pocket Poise do", () => {
  let grew = 0, tried = 0;
  for (const p of quarterbacks) {
    if (p["dmg"] < 6 || tried >= 60) continue;
    tried += 1;
    const one = structuredClone(p), two = structuredClone(p), plain = structuredClone(p);
    // the same player with no room left in the two it was once worked out from, and with all the room there is
    one["g"][at("awareness")] = 0; one["g"][at("throw_under_pressure")] = 0;
    two["g"][at("awareness")] = 99 - two["r"][at("awareness")]; two["g"][at("throw_under_pressure")] = 99 - two["r"][at("throw_under_pressure")];
    for (const c of [one, two, plain]) offseason.develop(c, attrs, 1.0, new Random(7), false, 2027);
    equal([one["dmv"], one["dmg"]], [plain["dmv"], plain["dmg"]], p["n"]);
    equal([two["dmv"], two["dmg"]], [plain["dmv"], plain["dmg"]], p["n"]);
    assert(plain["dmv"] >= p["dmv"] && plain["dmv"] + plain["dmg"] === p["dmv"] + p["dmg"], `${p["n"]}: ${p["dmv"]}+${p["dmg"]} -> ${plain["dmv"]}+${plain["dmg"]}`);
    if (plain["dmv"] > p["dmv"]) grew += 1;
    // its draw is its own: his other ratings grow exactly as they would without it
    const without = structuredClone(p);
    delete without["dmv"]; delete without["dmg"];
    offseason.develop(without, attrs, 1.0, new Random(7), false, 2027);
    equal(without["r"], plain["r"], p["n"]);
    // ... and the same year gives the same growth, another year its own
    const again = structuredClone(p);
    offseason.develop(again, attrs, 1.0, new Random(99), false, 2027);
    equal(again["dmv"], plain["dmv"], p["n"]);
  }
  assert(tried >= 20 && grew >= tried * 0.6, `${grew} of ${tried} grew`);
});

test("the sim plays the number he has after it grew, and a year without growth leaves it", () => {
  const p = structuredClone(quarterbacks.find((q) => q["dmg"] >= 10));
  const team = { slug: "x", short_name: "X" };
  const before = build_teams.map_player(lg.expand(p, attrs, team))["decision_making"];
  const still = structuredClone(p);
  still["r"][at("awareness")] = 99; still["r"][at("throw_under_pressure")] = 99;        // (his Football IQ and Pocket Poise, as high as they go)
  equal(build_teams.map_player(lg.expand(still, attrs, team))["decision_making"], before);
  p["dmv"] += 10; p["dmg"] -= 10;
  assert(build_teams.map_player(lg.expand(p, attrs, team))["decision_making"] > before, "a better Decision Making plays no better");
  // his ceiling moves with the rest of his ceilings, and stays inside 0 and 99
  const c = structuredClone(p);
  for (const year of [2027, 2028, 2029, 2030, 2031, 2032]) {
    clear.ceiling_drift(c, attrs, { z: -3 }, year, new Set());
    assert(c["dmg"] >= 0 && c["dmv"] + c["dmg"] <= 99 && c["dmv"] === p["dmv"], JSON.stringify([year, c["dmv"], c["dmg"]]));
  }
  assert(c["dmg"] < p["dmg"], "a struggling starter's ceiling did not fall");
});

test("his overall reads the Decision Making he has, in the file and in a career, and nobody's skills stand in for it", () => {
  const { rosters, game_scale } = game.modules;
  const team = { slug: "x", short_name: "X" };
  const p = structuredClone(quarterbacks.find((q) => q["dmv"] >= 40 && q["dmv"] <= 70));
  const low = structuredClone(p), high = structuredClone(p);
  low["dmv"] = 1; high["dmv"] = 99;
  const [a, b, c] = [low, p, high].map((q) => lg.overall(q, attrs));
  assert(a <= b && b <= c && a < c, `overall at a Decision Making of 1, ${p["dmv"]}, 99: ${a}, ${b}, ${c}`);
  // every way an overall is asked gives the one answer
  for (const q of [low, p, high]) {
    equal([rosters.overall(q["r"], "QB", q["dmv"]), lg.expand(q, attrs, team)["ovr"]], [lg.overall(q, attrs), lg.overall(q, attrs)]);
  }
  // his Football IQ and Pocket Poise still count as themselves, and no longer a second time as his Decision Making:
  // with them moved, his overall is exactly what it is for those skills and the Decision Making he has
  const moved = structuredClone(p);
  moved["r"][at("awareness")] = 99; moved["r"][at("throw_under_pressure")] = 99;
  const ours = Object.fromEntries(attrs.map((k, i) => [k, moved["r"][i]]));
  equal(lg.overall(moved, attrs), game_scale.overall(ours, "QB", p["dmv"]));
  assert(game_scale.overall(ours, "QB", 1) < game_scale.overall(ours, "QB", 99), "his overall does not read his Decision Making");
  // the first league's overalls are the roster file's cards'
  const filed = rosters.read("data/engine_teams.json")["teams"];
  let n = 0;
  for (const [slug, t] of Object.entries(lgd["teams"])) {
    if (!filed[slug]) continue;
    const by = Object.fromEntries(filed[slug]["offense"].map((x) => [x["slug"], x]));
    for (const q of t["roster"]) {
      if (q["pos"] !== "QB" || !by[q["id"]]) continue;
      n += 1;
      equal([q["o"], lg.overall(q, attrs)], [by[q["id"]]["ovr"], by[q["id"]]["ovr"]], `${slug} ${q["n"]}`);
    }
  }
  assert(n > 400, `${n} quarterbacks`);
  // a player who is not a quarterback has none, and an overall asked with one for him does not read it
  const other = Object.values(lgd["teams"])[0]["roster"].find((q) => q["pos"] === "WR");
  equal(rosters.overall(other["r"], "WR", 99), rosters.overall(other["r"], "WR"));
});

await run();
