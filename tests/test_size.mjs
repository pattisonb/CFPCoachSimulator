// Height and weight in the play engine (game_config: RUN_WEIGHT_EFFECT, GOAL_LINE_*, SHORT_YARDAGE_WEIGHT_EFFECT,
// CARRIER_WEIGHT_EFFECT, RUSH_WEIGHT_EFFECT, CATCH_HEIGHT_EFFECT, RED_ZONE_HEIGHT_MULT, QB_SIGHT_EFFECT, TIRE_PER_POUND).
// Each is read against the man across from him and moves the play the way size should: the same snaps, with one
// side bigger. Nothing here touches a rating. `node tests/test_size.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { random } from "../engine_js/pyrt.js";
import { cfg } from "../engine_js/game_config.js";
import { roster } from "../engine_js/roster.js";
import { get_run_yards, get_pass_yards } from "../engine_js/play_functions.js";
import { _tired } from "../engine_js/game_functions.js";

const game = await start();
const { season } = game;
season.load_teams();
if (!Object.keys(season._TEAMS).length) season._init(String(season.TEAMS_FILE));
const slugs = Object.keys(season._TEAMS).sort();
const HOME = season._TEAMS[slugs[10]], AWAY = season._TEAMS[slugs[40]];

/** A team's data with `change(player)` applied to a copy of every player. */
function sized(data, change) {
  const out = structuredClone(data);
  for (const p of [...out["offense"], ...out["defense"]]) change(p);
  return out;
}
const team = (d) => new roster.Team(d["name"], d["offense"], d["defense"]);
const add = (positions, key, n) => (p) => { if (positions.includes(p["position"])) p[key] += n; };

/** `snaps` plays of `play(offense, defense)`, each from its own seed with everyone rested; the results. */
function plays(off, def, snaps, play) {
  const out = [], o = team(off), d = team(def);
  for (let s = 0; s < snaps; s++) {
    for (const p of [...o.offense, ...d.defense]) p.fatigue = 0;
    random.seed(9000 + s);
    out.push(play(o.get_offense(), d.get_defense()));
  }
  return out;
}
const run_yards = (down, to_go, yardline) => (o, d) => {
  const [result, yards] = get_run_yards(o, d, down, to_go, false, yardline);
  return result === "run" ? yards : 0;
};
const pass = (yardline) => (o, d) => get_pass_yards(o, d, 1, 10, false, yardline)[0];
const total = (xs) => xs.reduce((a, b) => a + b, 0);
const count = (xs, what) => xs.filter((x) => x === what).length;

test("a heavier line runs for more, and more again at the goal line", () => {
  const heavy = sized(HOME, add(["OL"], "weight", 30)), light = sized(HOME, add(["OL"], "weight", -30));
  const more = total(plays(heavy, AWAY, 1500, run_yards(1, 10, 40))), less = total(plays(light, AWAY, 1500, run_yards(1, 10, 40)));
  assert(more > less + 150, `${more} against ${less} yards`);
  // third and goal from the 2: the heavier line gets in more often
  const td = (xs) => xs.filter((y) => y >= 2).length;
  const in_heavy = td(plays(heavy, AWAY, 1500, run_yards(3, 2, 98))), in_light = td(plays(light, AWAY, 1500, run_yards(3, 2, 98)));
  assert(in_heavy > in_light + 20, `${in_heavy} against ${in_light} scores`);
});

test("a heavier front takes it back", () => {
  const front = ["DL", "MLB", "ROLB", "LOLB", "OLB"];
  const more = total(plays(HOME, sized(AWAY, add(front, "weight", -30)), 1500, run_yards(1, 10, 40)));
  const less = total(plays(HOME, sized(AWAY, add(front, "weight", 30)), 1500, run_yards(1, 10, 40)));
  assert(more > less + 150, `${more} against ${less} yards`);
});

test("a heavier back gains more inside than a light one, against the same defense", () => {
  const more = total(plays(sized(HOME, add(["RB"], "weight", 30)), AWAY, 2000, run_yards(1, 10, 40)));
  const less = total(plays(sized(HOME, add(["RB"], "weight", -30)), AWAY, 2000, run_yards(1, 10, 40)));
  assert(more > less + 100, `${more} against ${less} yards`);
});

test("heavier rushers get home more against the same line, and a heavier line holds them off", () => {
  const sacks = (off, def) => count(plays(off, def, 4000, pass(40)), "sack");
  const big_rush = sacks(HOME, sized(AWAY, add(["DL"], "weight", 40))), small_rush = sacks(HOME, sized(AWAY, add(["DL"], "weight", -40)));
  assert(big_rush > small_rush + 10, `${big_rush} against ${small_rush} sacks`);
  const big_line = sacks(sized(HOME, add(["OL"], "weight", 40)), AWAY), small_line = sacks(sized(HOME, add(["OL"], "weight", -40)), AWAY);
  assert(big_line < small_line - 10, `${big_line} against ${small_line} sacks`);
});

test("taller targets catch more, and the edge is bigger in the red zone", () => {
  const caught = (off, yardline) => {
    const xs = plays(off, AWAY, 4000, pass(yardline));
    return count(xs, "successful_pass") + count(xs, "touchdown");
  };
  const tall = sized(HOME, add(["WR", "TE"], "height_in", 4)), short = sized(HOME, add(["WR", "TE"], "height_in", -4));
  const field = caught(tall, 40) - caught(short, 40), red = caught(tall, 88) - caught(short, 88);
  assert(field > 40, `${field} more catches at midfield`);
  assert(red > field, `${red} more in the red zone against ${field} at midfield`);
});

test("a short quarterback has throws tipped; a tall one loses nothing, however tall", () => {
  const results = (inches) => plays(sized(HOME, (p) => { if (p["position"] === "QB") p["height_in"] = inches; }), AWAY, 4000, pass(40));
  const done = (xs) => count(xs, "successful_pass") + count(xs, "touchdown");
  const short = results(69), tall = results(78), taller = results(81);
  assert(done(tall) > done(short) + 20, `${done(tall)} against ${done(short)} completions`);
  equal(taller, tall);
});

test("a lineman over the usual weight at his spot tires faster, one under it slower, and nobody else's weight tires him", () => {
  const p = (role, position, weight) => new roster.Player({ name: "x", position, role, weight, endurance: 0 });
  const usual = cfg.TIRE_WEIGHT_USUAL["LG"];
  equal(_tired(p("LG", "OL", usual)), _tired(p("WR", "WR", 190)));
  equal(_tired(p("LG", "OL", usual + 20)) - _tired(p("LG", "OL", usual)), 20 * cfg.TIRE_PER_POUND);
  assert(_tired(p("DT", "DL", 340)) > _tired(p("DT", "DL", 300)) && _tired(p("DT", "DL", 270)) < _tired(p("DT", "DL", 300)), "a defensive tackle's weight");
  equal(_tired(p("LG", "OL", 500)), _tired(p("LG", "OL", usual + cfg.TIRE_WEIGHT_CAP)));        // capped
  equal(_tired(p("HB", "RB", 250)), _tired(p("HB", "RB", 190)));
  equal(_tired(new roster.Player({ name: "x", position: "OL", role: "LG" })), _tired(p("WR", "WR", 190)));   // a weight not given
});

test("every starter in the roster file reaches the engine with his own height and weight", () => {
  let n = 0;
  for (const slug of slugs.slice(0, 30)) {
    const t = season._TEAMS[slug];
    for (const p of [...t["offense"], ...t["defense"]]) {
      if (!p["in_game"]) continue;
      n += 1;
      assert(p["height_in"] >= 60 && p["height_in"] <= 90 && p["weight"] >= 140 && p["weight"] <= 420, `${slug} ${p["name"]}: ${p["height_in"]} in, ${p["weight"]} lb`);
    }
  }
  assert(n > 600, `${n} starters`);
});

await run();
