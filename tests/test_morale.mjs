// Momentum and morale: off, the engine is unchanged (same fingerprint); on, moods and
// form move with results, scale the ratings entering a game, and the in-game momentum
// runs.
// `node tests/test_morale.mjs`
import crypto from "node:crypto";
import { start, test, run, assert, equal } from "./harness.mjs";
import { get, json_dumps, round, sorted, sum } from "../engine_js/pyrt.js";
import { simulate_game } from "../engine_js/index.js";

const game = await start();
const season = game.season;

// tests/test_play_log's fingerprint (that file runs its own tests when it is loaded, so it is written out here):
// five games' scores, stats and drives as Python's json.dumps(sort_keys=True) text, hashed. Whole floats count as
// whole numbers there (tests/canon.py); a JavaScript number is one kind, so there is nothing to fold.
function fingerprint(n = 5) {
  const teams = season.load_teams();
  const slugs = Object.keys(teams).sort();
  const h = crypto.createHash("sha256");
  for (let i = 0; i < n; i++) {
    const home = slugs[(i * 37) % slugs.length], away = slugs[(i * 53 + 7) % slugs.length];
    if (!Object.keys(season._TEAMS).length) season._init(String(season.TEAMS_FILE));
    const g = simulate_game(season._TEAMS[home], season._TEAMS[away], null, 100 + i);
    const core = Object.fromEntries(["home", "away", "winner", "scoring_plays"].map((k) => [k, g[k]]));
    for (const side of ["home", "away"]) {
      core[side] = Object.fromEntries(Object.entries(core[side]).filter(([k]) => ["name", "score", "quarters", "team_stats", "players"].includes(k)));
    }
    core["drives"] = g["drives"].map((d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== "log")));
    h.update(Buffer.from(json_dumps(core, { sort_keys: true }), "utf8"));
  }
  return h.digest("hex").slice(0, 16);
}

function record_trend(r) {
  if (r["wins"] > r["losses"]) return "up";
  if (r["wins"] < r["losses"]) return "down";
  return "even";
}

const signed2 = (x) => (x < 0 ? "-" : "+") + round(Math.abs(x), 2).toFixed(2);       // Python's {x:+.2f}

test("morale", () => {
  const base = fingerprint();
  console.log("fingerprint with momentum off:", base, "(must match the engine's current fingerprint: aa5c3b71cb79a711)");
  // re-recorded when the engine became JavaScript, from the Python engine's own games with whole floats counted as
  // whole numbers (tests/canon.py: 4.0 sacks is 4); the JavaScript engine gives the same. It is Clear Mode's
  // engine (game_config EXTRA_TRAITS on: the abilities the engine never read now act)
  assert(base === "aa5c3b71cb79a711");

  // in-game momentum changes a game and leaves the flag off afterwards
  season._init(String(season.TEAMS_FILE));
  const a = simulate_game(season._TEAMS["ohio-state"], season._TEAMS["michigan"], null, 5);
  const b = simulate_game(season._TEAMS["ohio-state"], season._TEAMS["michigan"], null, 5, undefined, true);
  const c = simulate_game(season._TEAMS["ohio-state"], season._TEAMS["michigan"], null, 5);
  equal([c["home"]["score"], c["away"]["score"]], [a["home"]["score"], a["away"]["score"]], "momentum stayed on after a game");
  console.log("momentum off:", a["home"]["score"], "-", a["away"]["score"], "| on:", b["home"]["score"], "-", b["away"]["score"]);

  const st = season.new_season("ohio-state", "full", 9);
  assert(season.settings(st)["morale"] === true);
  season.advance_to(st, 4);
  const m = st["morale"];
  assert(Object.keys(m["teams"]).length && Object.keys(m["players"]).length, "no morale after four weeks");
  const tm = get(m["teams"], "ohio-state", 0.0);
  const rec = season._records(st)["ohio-state"];
  console.log(`Ohio State ${rec["wins"]}-${rec["losses"]}: team mood ${signed2(tm)}`);
  // moods move with the result against expectation (a favorite's loss costs more than its
  // wins add), so one team's sign need not follow its record; across the league they do
  const recs = season._records(st);
  const by = {};
  for (const [slug, r] of Object.entries(recs)) {
    if (r["wins"] + r["losses"]) (by[record_trend(r)] ??= []).push(get(m["teams"], slug, 0.0));
  }
  const mean = Object.fromEntries(Object.entries(by).map(([k, v]) => [k, sum(v) / v.length]));
  console.log("mean mood by record:", JSON.stringify(Object.fromEntries(Object.entries(mean).map(([k, v]) => [k, round(v, 2)]))));
  assert(mean["up"] > 0 && 0 > mean["down"]);
  const forms = get(m["players"], "ohio-state", {});
  const hot = sorted(Object.entries(forms), (kv) => -kv[1]).slice(0, 3);
  const cold = sorted(Object.entries(forms), (kv) => kv[1]).slice(0, 3);
  console.log("hot:", JSON.stringify(hot), "| cold:", JSON.stringify(cold));
  assert(Object.values(forms).every((v) => -1 <= v && v <= 1));
  // the card shows the boost and the sim data carries it
  const [name, pos] = hot[0][0].split("|");
  const prof = season.player_profile(st, "ohio-state", name, pos);
  const f = prof["morale"]["factor"];
  console.log(name, pos, "form", prof["morale"]["form"], "factor", f, "label", prof["morale"]["label"], "boosts", JSON.stringify(prof["ratings"].filter((r) => r["boost"]).map((r) => [r["key"], r["boost"]]).slice(0, 4)));
  assert(prof["morale"]["enabled"] && 0.9 <= f && f <= 1.1);
  if (f > 1.0) assert(prof["ratings"].some((r) => r["boost"] > 0));
  const data = season.with_morale(season.team_data(st, "ohio-state"), season.morale_payload(st, "ohio-state"));
  const raw_team = season.team_data(st, "ohio-state");
  const raw = [...raw_team["offense"], ...raw_team["defense"]].find((p) => p["name"] === name);
  const adj = [...data["offense"], ...data["defense"]].find((p) => p["name"] === name);
  assert(raw !== undefined && adj !== undefined, "StopIteration");
  if (f >= 1.01) assert(adj["speed"] >= raw["speed"]);
  // with the setting off nothing applies
  season.update_settings(st, { morale: false });
  assert(season.morale_factor(st, "ohio-state", name, pos) === 1.0 && season.morale_payload(st, "ohio-state") === null);
  season.advance_to(st, 5);
  console.log("morale ok");
});

await run();
