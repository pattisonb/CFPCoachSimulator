// The play log must not change a game: same seed, same score and stats, with a log that
// adds up to the drive it belongs to. `node tests/test_play_log.mjs` prints a fingerprint of
// five games (compare it before and after an engine change) and checks the log with `--check`.
import crypto from "node:crypto";
import { start, test, run, assert } from "./harness.mjs";
import { json_dumps } from "../engine_js/pyrt.js";
import { simulate_game } from "../engine_js/index.js";

const game = await start();
const { season } = game;

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
    // 4.0 and 4 are one result: a JavaScript number is one kind, so there is nothing to fold here
    h.update(Buffer.from(json_dumps(core, { sort_keys: true }), "utf8"));
    if (process.argv.includes("--check")) check(g);
  }
  return h.digest("hex").slice(0, 16);
}

function check(g) {
  let n_plays = 0;
  for (const d of g["drives"]) {
    const log = d["log"] ?? null;
    assert(log !== null, "drive without a log");
    const snaps = log.filter((e) => (e["type"] === "run" || e["type"] === "pass") && !["offensive penalty", "defensive penalty"].includes(e["result"]));
    n_plays += snaps.length;
    for (const e of log) {
      assert("quarter" in e && "clock" in e, () => JSON.stringify(e));
      if ((e["type"] === "run" || e["type"] === "pass") && !e["hail_mary"]) {   // a hail mary logs no down (drive_functions._hail_mary)
        assert([1, 2, 3, 4].includes(e["down"]), () => JSON.stringify(e));
      }
    }
  }
  console.log(`  ${g["away"]["name"]} ${g["away"]["score"]} at ${g["home"]["name"]} ${g["home"]["score"]}: ${g["drives"].length} drives, ${n_plays} logged snaps`);
}

test("fingerprint", () => {
  console.log("fingerprint", fingerprint());
});

await run();
