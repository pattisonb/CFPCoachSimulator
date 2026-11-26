// Redshirting during the season (sim_js/season.js redshirt_toggle): any of your players with four
// games or fewer and his year unused can be sat down for the rest of the season; he plays no more
// games, his page says so, and the Departures step takes him as redshirting by default.
// `node tests/test_redshirt_season.mjs`
import { start, test, run, assert, raises } from "./harness.mjs";
import { Random, sorted } from "../engine_js/pyrt.js";

const game = await start();
const { season, offseason } = game;

/** Every game played (the better team usually wins), every school's class signed, season over (tests/test_offseason). */
function finished(st) {
  const rng = new Random(1);
  const teams = season.load_teams();
  for (const g of Object.values(st["games"])) {
    const h = teams[g["home"]]["team_ratings"]["overall"], a = teams[g["away"]]["team_ratings"]["overall"];
    const hs = rng.randint(10, 45);
    const win = rng.random() < 1 / (1 + Math.pow(10, (a - h) / 7));
    g["played"] = true;
    g["home_score"] = win ? hs : Math.max(0, hs - rng.randint(1, 20));
    g["away_score"] = win ? hs - rng.randint(1, 20) : hs;
    if (g["home_score"] === g["away_score"]) g["home_score"] += 3;
  }
  const rc = st["recruiting"];
  const schools = Object.entries(teams).filter(([, t]) => !t["fictional"]).map(([s]) => s);
  const pids = sorted(Object.keys(rc["prospects"]), (p) => rc["prospects"][p]["rank"]);
  pids.slice(0, schools.length * 21).forEach((pid, i) => { rc["status"][pid]["signed"] = schools[i % schools.length]; });
  Object.assign(st, { done: true, current_week: season.FINAL_WEEK, champion: "ohio-state" });
}

test("redshirt in season", () => {
  const st = season.new_season("ohio-state", "full", 6, undefined, undefined, true);
  season.advance_to(st, 2);
  const me = st["team"];
  const t = season.load_teams()[me];
  const all = [...t["offense"], ...t["defense"]];
  const starter = t["offense"].find((p) => p["in_game"] && ["FR", "SO", "JR"].includes(p["class"]));
  const bench = all.find((p) => !p["in_game"] && p["class"] === "FR" && season.redshirt_status(st, me, p)["games"] <= 4);
  const used = all.find((p) => (p["class"] || "").endsWith("RS") || ["SR", "SRRS"].includes(p["class"]));
  const r = season.redshirt_toggle(st, me, bench["slug"], true);
  assert(r["on"] && st["redshirting"][me][bench["slug"]]["name"] === bench["name"]);
  raises(() => { season.redshirt_toggle(st, me, used["slug"], true); throw new Error("a used year redshirted"); }, season.RedshirtError);
  assert(season._injured(st, me).some(([n, p]) => n === bench["name"] && p === bench["position"]));          // kept out of games like an injury
  const prof = season.player_profile(st, me, undefined, undefined, bench["slug"]);
  assert(prof["redshirt"]["on"] && prof["redshirt"]["games"] <= 4);
  const games_before = prof["redshirt"]["games"];
  season.advance_to(st, 5);
  assert(season.player_profile(st, me, undefined, undefined, bench["slug"])["redshirt"]["games"] === games_before, "he played while redshirting");
  // the starter played five: too late for him
  const s5 = season.redshirt_status(st, me, starter);
  if (s5["games"] > 4) {
    raises(() => { season.redshirt_toggle(st, me, starter["slug"], true); throw new Error("five games and still redshirted"); }, season.RedshirtError);
  }
  // the depth chart carries each of your players' redshirt standing, so the roster can redshirt him in place
  const rows = season.depth_chart_view(st, me)["units"].flatMap((u) => u["rows"].flatMap((r_) => r_["players"]));
  const mine = rows.find((c) => c["slug"] === bench["slug"]);
  assert(mine["redshirt"]["on"] === true && mine["redshirt"]["games"] === games_before && mine["redshirt"]["limit"] === 4);
  assert(rows.every((c) => "redshirt" in c && ["on", "can", "games", "limit"].every((k) => k in c["redshirt"])));
  assert(rows.some((c) => c["redshirt"]["can"] && !c["redshirt"]["on"]), "someone else is still eligible");
  const other = season.depth_chart_view(st, "georgia")["units"][0]["rows"][0]["players"][0];
  assert(!("redshirt" in other), "another team's chart has no redshirt control");
  // off the redshirt and back on, then the offseason takes it as the default
  season.redshirt_toggle(st, me, bench["slug"], false);
  assert(!(bench["slug"] in st["redshirting"][me]));
  season.redshirt_toggle(st, me, bench["slug"], true);
  finished(st);
  const off = offseason.start(st);
  const cand = off["redshirts"]["players"].find((p) => p["id"] === bench["slug"]);
  assert(cand["redshirt"] === true && cand["games"] === games_before);
  season.close_pool();
  console.log(`redshirt in season ok: ${bench["name"]} (${bench["position"]} FR) sat from week 2 with ${games_before} games`);
});

await run();
