// Player progression over a career keeps each position's senior class where the real 2026 rosters'
// was (offseason.develop, recruits.seed_real_players): one season played for real (production and
// honors feed development) and two faked, then each position's seniors at the end of the second and
// third seasons against the real 2026 seniors: the mean, the 90th percentile and how many are rated 91
// or better. Before DEV_TOP and the real players' room at their own pace, the real top juniors (fast
// learners with big rooms) gained 8-12 points in an offseason and a career's 2027 seniors had about
// 125 players rated 91+ where the real 2026 seniors had 25. `node tests/test_progression_realism.mjs`
import { start, test, run, assert } from "./harness.mjs";
import { Random, sorted } from "../engine_js/pyrt.js";
import * as st from "../engine_js/pystat.js";
import { f, repr } from "../tools/pytext.mjs";

const game = await start();
const { season, offseason } = game;
const lg = game.modules.league;

const SENIORS = ["SR", "SRRS"];
const ELITE = 91;
const MEAN_TOL = 3.5;          // a position's senior mean within this of the real seniors' (overall points)
const P90_TOL = 5;             // ... its 90th percentile within this
const ELITE_TOL = [2.5, 6];    // ... its 91+ seniors at most this times the real count plus this
const ELITE_TOTAL = 2.0;       // ... and all positions' 91+ seniors at most this times the real total

/** tests/test_offseason's `finished`, copied here (a test file runs its tests when it is imported):
 * every game played (the better team usually wins), every school's class signed, season over. */
function finished(state) {
  const rng = new Random(1);
  const teams = season.load_teams();
  for (const g of Object.values(state["games"])) {
    const h = teams[g["home"]]["team_ratings"]["overall"], a = teams[g["away"]]["team_ratings"]["overall"];
    const hs = rng.randint(10, 45);
    const win = rng.random() < 1 / (1 + Math.pow(10, (a - h) / 7));
    g["played"] = true;
    g["home_score"] = win ? hs : Math.max(0, hs - rng.randint(1, 20));
    g["away_score"] = win ? hs - rng.randint(1, 20) : hs;
    if (g["home_score"] === g["away_score"]) g["home_score"] += 3;
  }
  const rc = state["recruiting"];
  const schools = Object.entries(teams).filter(([, t]) => !t["fictional"]).map(([s]) => s);
  const pids = sorted(Object.keys(rc["prospects"]), (p) => rc["prospects"][p]["rank"]);
  pids.slice(0, schools.length * 21).forEach((pid, i) => { rc["status"][pid]["signed"] = schools[i % schools.length]; });
  Object.assign(state, { done: true, current_week: season.FINAL_WEEK, champion: "ohio-state" });
}

function seniors(lgd) {
  const out = {};
  for (const t of Object.values(lgd["teams"])) {
    for (const p of t["roster"]) {
      if (SENIORS.includes(p["cls"])) (out[offseason.DRAFT_GROUP[p["pos"]]] ??= []).push(p["o"]);
    }
  }
  return out;
}

function p90(v) {
  v = sorted(v);
  return v[Math.trunc(0.9 * (v.length - 1))];
}

function table(by) {
  return Object.fromEntries(Object.entries(by).filter(([, v]) => v.length).map(([g, v]) => [g, [st.mean(v), p90(v), v.filter((x) => x >= ELITE).length]]));
}

function compare(real, sim, year) {
  const bad = [];
  for (const [g, [mean, top, elite]] of Object.entries(real)) {
    if (g === "K" || g === "P") continue;
    const [m, t, e] = sim[g];
    if (Math.abs(m - mean) > MEAN_TOL) bad.push(`${year} ${g} mean ${f(m, 1)} vs real ${f(mean, 1)}`);
    if (Math.abs(t - top) > P90_TOL) bad.push(`${year} ${g} 90th percentile ${t} vs real ${top}`);
    if (e > ELITE_TOL[0] * elite + ELITE_TOL[1]) bad.push(`${year} ${g} ${e} seniors 91+ vs real ${elite}`);
  }
  const skip = (g) => g === "K" || g === "P";
  const total_real = Object.entries(real).filter(([g]) => !skip(g)).reduce((n, [, v]) => n + v[2], 0);
  const total = Object.entries(sim).filter(([g]) => !skip(g)).reduce((n, [, v]) => n + v[2], 0);
  if (total > ELITE_TOTAL * total_real) bad.push(`${year} ${total} seniors 91+ in all vs real ${total_real}`);
  return bad;
}

test("progression realism", () => {
  const real = table(seniors(lg.from_base()));                    // the real 2026 rosters
  let st_ = season.new_season("ohio-state", "full", 21, undefined, undefined, true);
  st_["career"]["settings"]["auto_recruit"] = "season";
  season.advance_to(st_, season.FINAL_WEEK);                   // a real season: its production and honors feed development
  const rows = [];
  let bad = [];
  try {
    for (let i = 0; i < 2; i++) {
      offseason.run_all(st_);
      st_ = offseason.next_season(st_);
      finished(st_);                                       // the next season faked (scores and classes only)
      const year = season.season_year(st_);
      const sim = table(seniors(st_["league"]));
      rows.push([year, sim]);
      bad = bad.concat(compare(real, sim, year));
    }
  } finally {
    lg.forget(st_["id"]);                                    // a failed run leaves no league file behind for a retry
    season.close_pool();
  }
  for (const [year, sim] of rows) {
    console.log(`seniors ${year} (real 2026 in brackets): ` + Object.keys(real).map((g) =>
      `${g} ${f(sim[g][0])}/${sim[g][1]}/${sim[g][2]} (${f(real[g][0])}/${real[g][1]}/${real[g][2]})`).join("  "));
  }
  assert(!bad.length, repr(bad));
  console.log("progression realism ok: each position's seniors stay near the real 2026 seniors (mean, 90th percentile, 91+)");
});

await run();
