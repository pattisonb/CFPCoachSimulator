// The card's overall never reaches an engine rating (teamdata_js/build_teams.js, teamdata_js/game_scale.js): the real
// 2026 build with every card-overall constant moved (data/game_scale.json `card_overall`) differs from the build as it
// stands in the players' "ovr" and nowhere else, so refitting how an overall is shown can never change how a game plays.
// And every built player's card is scored at the position his skills were made for (game_scale.card_position).
// `node tests/test_card_overall_gate.mjs`
import fs from "node:fs";
import path from "node:path";
import { start, test, run, assert, ROOT } from "./harness.mjs";

const game = await start();
const { build_teams, game_scale } = game.modules;

const clone = (v) => JSON.parse(JSON.stringify(v));
// every team in the source format the build reads (a league's teams: career_js/league.js), each player's overall
// left for the build to score
const sources = game.modules.league.source_teams(game.modules.league.from_base(2027));
for (const t of sources) for (const p of t["roster"]) { delete p["ovr"]; delete p["overall"]; }
const players_of = (built) => Object.entries(built["teams"]).flatMap(([s, t]) => [...t["offense"], ...t["defense"]].map((p) => [s, p]));
/** A build as text with every player's "ovr" taken out, its keys in one order. */
function without_ovr(built) {
  const out = clone(built);
  for (const [, p] of players_of(out)) delete p["ovr"];
  const ordered = (v) => (Array.isArray(v) ? v.map(ordered) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordered(v[k])])) : v);
  return JSON.stringify(ordered(out));
}

const as_is = build_teams.build(clone(sources), true, null, true);

test("moving the card-overall constants moves the overalls shown and nothing else in the build", () => {
  const scale = clone(game_scale.data());
  Object.values(scale["card_overall"]).forEach((f, i) => { f["const"] += i % 2 ? 4 : -4; });
  const real = game_scale.data;
  let moved;
  try {                                                   // the scale file itself is not touched
    game_scale.data = () => scale;
    game_scale._card_overall.cache_clear();
    moved = build_teams.build(clone(sources), true, null, true);
  } finally {
    game_scale.data = real;
    game_scale._card_overall.cache_clear();
  }
  const theirs = Object.fromEntries(players_of(moved).map(([s, p]) => [`${s}/${p["slug"]}`, p]));
  const players = players_of(as_is);
  const changed = players.filter(([s, p]) => p["ovr"] !== theirs[`${s}/${p["slug"]}`]["ovr"]).length;
  assert(changed > players.length / 2, `moving the constants moved only ${changed} overalls: the test is not testing`);
  assert(without_ovr(as_is) === without_ovr(moved), "a card-overall constant changed something besides the card overall");
});

test("every built player's overall is his card's, scored at the position his skills were made for", () => {
  const position = {};
  for (const t of sources) for (const p of t["roster"]) position[`${t["slug"]}/${p["slug"]}`] = p["position"];
  const keys = game_scale.keys();
  let n = 0;
  for (const [s, p] of players_of(as_is)) {
    const at = `${s}/${p["slug"]}`;
    // (a specialist the build moved keeps the overall of the spot he came from)
    if (at in position && !["K", "P"].includes(p["position"])) assert(game_scale.card_position(p) === position[at], `${at} is scored at ${game_scale.card_position(p)}`);
    if (typeof p["ovr"] === "number" && p["skills"]) {
      const ours = Object.fromEntries(keys.map((k, i) => [k, p["skills"][i]]).filter(([, v]) => v !== undefined));
      // (a quarterback's Decision Making is a rating of its own, not one of his skills: his overall reads the one he has)
      assert(game_scale.overall(ours, game_scale.card_position(p), p["dmv"] ?? null) === p["ovr"], at);
      n++;
    }
  }
  assert(n > 10000, `only ${n} overalls were checked`);
});

await run();
