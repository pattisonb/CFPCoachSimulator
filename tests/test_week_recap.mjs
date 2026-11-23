// The Weekly Recap and the Players of the Week (sim_js/news.js week_recap and week_awards, GET
// /api/season/{id}/week_recap and /week_awards): a seeded career simmed four weeks tells each finished week (your game
// and your standouts, the game of the week, the upsets, the biggest lines, the poll's risers and fallers, the top
// 25's scores) and names its honors (national and a conference's Offensive, Defensive and Special Teams Player of
// the Week); a week asked for is the week told, the latest without one; nothing is told of a stand-in's game; and
// reading either never changes the season.
// `node tests/test_week_recap.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { json_dumps } from "../engine_js/pyrt.js";

const game = await start({ env: { SIM_WORKERS: "1", CFP_SEASONS_DIR: "data/seasons-week-recap-test" } });
const { api, season } = game;
const news = game.modules.news;
const show = (v) => JSON.stringify(v);
const WEEKS = 4;
const ME = "smu";

const sid = api.call("POST", "/api/season", { team: ME, seed: 23, career: true })["id"];
const empty = api.call("GET", `/api/season/${sid}/week_recap`);
api.call("POST", `/api/season/${sid}/advance`, { to: WEEKS });
while (api.step() !== null) { /* the next week */ }
const st = api.loaded_state();
const teams = season.load_teams();
const fbs = season.fbs_only(teams);
const G = (p) => api.call("GET", `/api/season/${sid}/${p}`);

test("before a game is played there is no week to tell", () => {
  equal([empty["week"], empty["weeks"], empty["latest"]], [null, [], null]);
  const a = news.week_awards({ ...st, games: {} });
  equal([a["week"], a["national"], a["conferences"]], [null, null, []]);
});

test("the latest week is told without asking, and a week asked for is the week told", () => {
  const v = G("week_recap");
  assert(v["weeks"].length >= WEEKS - 1 && v["week"] === v["latest"] && v["latest"] === v["weeks"][v["weeks"].length - 1], show(v["weeks"]));
  const w = v["weeks"][0];
  equal(G(`week_recap?week=${w}`)["week"], w);
  equal(G("week_recap?week=99")["week"], v["latest"]);
  equal(G(`week_awards?week=${w}`)["week"], w);
});

test("a week's recap: your game, the upsets, the Booms, the movers and the top 25's scores are the season's own", () => {
  for (const w of G("week_recap")["weeks"]) {
    const v = G(`week_recap?week=${w}`);
    const games = Object.values(st["games"]).filter((g) => g["week"] === w && g["played"]);
    const by_id = Object.fromEntries(games.map((g) => [g["event_id"], g]));
    const mg = games.find((g) => g["home"] === ME || g["away"] === ME);
    if (mg) {
      const home = mg["home"] === ME;
      equal([v["mine"]["game"]["points_for"], v["mine"]["game"]["points_against"]], home ? [mg["home_score"], mg["away_score"]] : [mg["away_score"], mg["home_score"]]);
      assert(v["mine"]["standouts"].length <= news.RECAP_STANDOUTS && v["mine"]["standouts"].every((p) => p["team"] === ME && p["line"]), show(v["mine"]["standouts"]));
    } else assert(v["mine"]["game"] === null && v["mine"]["standouts"].length === 0, "a bye week has no game");
    assert(/^\d+-\d+$/.test(v["mine"]["record"]), v["mine"]["record"]);
    if (v["game_of_week"]) assert(![v["game_of_week"]["winner"], v["game_of_week"]["loser"]].includes(ME), "your own game has its own banner");
    for (const u of v["upsets"]) {
      const g = by_id[u["event_id"]];
      assert(g && fbs.has(u["winner"]) && fbs.has(u["loser"]) && u["winner_score"] > u["loser_score"], show(u));
      assert((u["winner_rank"] === null && u["loser_rank"] !== null) || u["stunner"], show(u));
      assert(u["chance"] >= 5 && u["chance"] <= 95);
    }
    assert(v["upsets"].length <= news.RECAP_UPSETS && v["booms"].length <= news.RECAP_BOOMS);
    for (const p of v["booms"]) assert(fbs.has(p["team"]) && fbs.has(p["opponent"]) && p["line"] && p["name"] && !("_score" in p), show(p));
    for (const r of v["risers"]) assert(r["move"] > 0 && r["rank"] < r["previous"], show(r));
    for (const r of v["fallers"]) assert(r["move"] < 0 && r["rank"] > r["previous"], show(r));
    for (const r of v["entered"]) assert(r["previous"] === null && r["rank"] >= 1, show(r));
    for (const r of v["dropped"]) assert(r["rank"] === null && r["previous"] >= 1, show(r));
    assert(v["scores"].every((s, i) => i === 0 || v["scores"][i - 1]["rank"] <= s["rank"]), "the top 25 in order");
    for (const s of v["scores"]) assert(by_id[s["event_id"]] && s["won"] === (s["points_for"] > s["points_against"]), show(s));
    assert(!/undefined|NaN|null/.test(v["booms"].map((p) => p["line"]).join(" ")));
  }
});

test("the Players of the Week: three national honors and three a conference, each the best line of its kind", () => {
  const a = G("week_awards");
  for (const kind of news.POTW_KINDS) {
    const w = a["national"][kind]["winner"];
    assert(w && w["line"] && fbs.has(w["team"]) && fbs.has(w["opponent"]) && !("_score" in w), `${kind}: ${show(w)}`);
    assert(a["national"][kind]["also"].length <= news.POTW_ALSO);
  }
  assert(a["conferences"].length >= 8, String(a["conferences"].length));
  assert(a["conferences"][0]["mine"] === true && a["conferences"][0]["conference"] === st["conference"], "your conference first");
  for (const c of a["conferences"]) {
    for (const kind of news.POTW_KINDS) {
      const p = c[kind];
      if (p) assert(p["conference"] === c["conference"] && teams[p["team"]]["conference"] === c["conference"] && p["line"], show(p));
    }
  }
  // a national winner is his own conference's winner too
  for (const kind of news.POTW_KINDS) {
    const w = a["national"][kind]["winner"];
    const c = a["conferences"].find((x) => x["conference"] === w["conference"]);
    if (c) equal([c[kind]["name"], c[kind]["team"]], [w["name"], w["team"]]);
  }
  // a kicker's, a punter's and a returner's game each read as their own
  equal(news._special_line({ fg_made: 3, fg_attempted: 3, long_fg: 51, pat_made: 4, pat_attempts: 4 }), "3/3 FG, Long 51, 4/4 PAT");
  equal(news._special_line({ punts: 4, punt_yards: 180, punts_inside_20: 2 }), "4 Punts, 45.0 Avg, 2 Inside 20");
  equal(news._special_line({ kickoff_returns: 2, kickoff_return_yards: 120, kickoff_return_touchdowns: 1 }), "2 Returns, 120 Yds, 1 TD");
  equal(news._game_stat_line("QB", { pass_attempts: 30, completions: 20, pass_yards: 300, passing_touchdowns: 3 }), "20/30, 300 Yds, 3 TD, 0 INT");
});

test("reading the recap and the honors never changes the season", () => {
  const before = json_dumps(st);
  G("week_recap"); G("week_awards"); G(`week_recap?week=1`);
  equal(json_dumps(api.loaded_state()) === before, true);
});

await run();
