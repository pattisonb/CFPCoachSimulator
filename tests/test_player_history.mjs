// Players keep their seasons (career_js/offseason record_seasons): when the offseason opens,
// every player's season line and honors go onto his entry in the career's league, follow him
// through the rollover (and a transfer), and his page lists them.
// `node tests/test_player_history.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random, sorted } from "../engine_js/pyrt.js";

const game = await start();
const { season, offseason } = game;

/** Every game played (the better team usually wins), every school's class signed, season over (tests/test_offseason's). */
function finished(st) {
  const rng = new Random(1);
  const teams = season.load_teams();
  for (const g of Object.values(st["games"])) {
    const h = teams[g["home"]]["team_ratings"]["overall"], a = teams[g["away"]]["team_ratings"]["overall"];
    const hs = rng.randint(10, 45);
    const win = rng.random() < 1 / (1 + Math.pow(10, (a - h) / 12));
    const home_score = win ? hs : Math.max(0, hs - rng.randint(1, 20));
    const away_score = win ? hs - rng.randint(1, 20) : hs;
    Object.assign(g, { played: true, home_score, away_score });
    if (g["home_score"] === g["away_score"]) g["home_score"] += 3;
  }
  const rc = st["recruiting"];
  const schools = Object.keys(teams).filter((s) => !teams[s]["fictional"]);
  const pids = sorted(Object.keys(rc["prospects"]), (p) => rc["prospects"][p]["rank"]);
  pids.slice(0, schools.length * 21).forEach((pid, i) => { rc["status"][pid]["signed"] = schools[i % schools.length]; });
  Object.assign(st, { done: true, current_week: season.FINAL_WEEK, champion: "ohio-state" });
}

test("player history", () => {
  const st = season.new_season("ohio-state", "full", 2, undefined, undefined, true);
  season.advance_to(st, 2);                        // two real weeks of stats
  finished(st);                                    // the rest decided without lines
  equal(season.player_profile(st, "ohio-state", undefined, undefined, "julian-sayin")["history"], []);
  offseason.start(st);
  const lgd = st["league"];
  const c = lgd["teams"]["ohio-state"]["roster"].find((c) => c["id"] === "julian-sayin");
  assert(c !== undefined, "StopIteration");
  const h = c["hist"] ?? null;
  assert(h && h.length === 1 && h[0]["year"] === 2026 && h[0]["team"] === "ohio-state" && h[0]["games"] >= 1 && (h[0]["stats"]["pass_yards"] ?? 0) > 0, () => JSON.stringify(h));
  assert("honors" in h[0] && Array.isArray(h[0]["honors"]));
  let n = 0;
  for (const t of Object.values(lgd["teams"])) for (const c of t["roster"]) if (c["hist"] && c["hist"].length) n += 1;
  assert(n >= 2000, () => String(n));
  offseason.run_all(st);
  const fresh = offseason.next_season(st);
  // a returning player's page lists last season (Sayin may have left early: take anyone who came back)
  const back = fresh["league"]["teams"]["ohio-state"]["roster"].find((c) => c["hist"] && c["hist"].length && Object.keys(c["hist"][0]["stats"]).length);
  assert(back !== undefined, "StopIteration");
  const prof = season.player_profile(fresh, "ohio-state", undefined, undefined, back["id"]);
  assert(prof && prof["history"] && prof["history"].length && prof["history"][0]["year"] === 2026, () => JSON.stringify(prof && prof["history"]));
  equal(prof["history"][0]["stats"], back["hist"][0]["stats"]);
  assert(prof["history"][0]["team_name"] === "Ohio State" && prof["history"][0]["class"]);
  // a transfer carries his seasons with him
  const ptl = [];
  for (const [s, t] of Object.entries(fresh["league"]["teams"])) {
    for (const c of t["roster"]) if (c["hist"] && c["hist"].length && c["hist"][c["hist"].length - 1]["team"] !== s) ptl.push([s, c]);
  }
  assert(ptl.length, "no transfer carried his seasons");
  season.close_pool();
  console.log(`player history ok: ${n} players with a season on record; ${ptl.length} carried theirs to a new team`);
});

await run();
