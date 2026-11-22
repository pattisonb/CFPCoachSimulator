// The Game Log's season tabs: a career keeps who played in each of your games when a season ends, so a returning
// player's page still has last year's log (and opens on it before the new season's first game); a player who is gone
// has none, only the last few seasons are kept, and a save from before this simply shows what it did.
// `node tests/test_game_log_seasons.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random, sorted } from "../engine_js/pyrt.js";

const game = await start({ env: { SIM_WORKERS: "1", CFP_SEASONS_DIR: "data/seasons-gamelog-test" } });
const { api, season, offseason } = game;
const show = (v) => JSON.stringify(v);
const ME = "iowa";

/** Every game not yet played is given a score (the better team usually wins), every class signed, the season over. */
function finished(st) {
  const rng = new Random(1);
  const teams = season.load_teams();
  for (const g of Object.values(st["games"])) {
    if (g["played"]) continue;
    const [h, a] = [teams[g["home"]]["team_ratings"]["overall"], teams[g["away"]]["team_ratings"]["overall"]];
    const hs = rng.randint(10, 45);
    const win = rng.random() < 1 / (1 + Math.pow(10, (a - h) / 12));
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

/** Really play weeks until your team has `n` box scores this season (a bye week gives none). */
function play_games(id, n) {
  while (Object.keys(api.loaded_state()["my_boxes"]).length < n) {
    api.call("POST", `/api/season/${id}/advance`, {});
    while (api.step() !== null) { /* the week's games */ }
  }
}
const rollover = (id) => api.call("POST", `/api/season/${id}/offseason/advance`, { to: "next_season" });
const profile = (slug) => season.player_profile(api.loaded_state(), ME, null, null, slug);

const s = api.call("POST", "/api/season", { team: ME, seed: 5, career: true });
const ID = s["id"];
const YEAR = api.loaded_state()["year"];
play_games(ID, 2);
const first = api.loaded_state();
const roster_then = [...season.load_teams()[ME]["offense"], ...season.load_teams()[ME]["defense"]];
// each player's log as his page had it in the season itself
const then = Object.fromEntries(roster_then.map((p) => [p["slug"], season.player_game_log(first, ME, p["name"], p["position"])]));
const played = roster_then.filter((p) => then[p["slug"]].length);

test("in a first season the seasons are this season's log alone, and none before a game", () => {
  assert(played.length > 30 && Object.keys(first["my_boxes"]).length === 2, show([played.length, Object.keys(first["my_boxes"])]));
  const pr = profile(played[0]["slug"]);
  equal(pr["game_logs"], [{ year: YEAR, rows: pr["game_log"] }]);
  const fresh = season.new_season(ME, "full", 5, undefined, undefined, true);          // no game yet: nothing to show
  equal(season.player_profile(fresh, ME, null, null, played[0]["slug"])["game_logs"], []);
  // another team's player: no box scores, no seasons
  const other = season.load_teams()["ohio-state"]["offense"][0];
  const theirs = season.player_profile(first, "ohio-state", null, null, other["slug"]);
  assert(theirs["game_log"] === null && theirs["game_logs"].length === 0);
});

let gone = null, back = null;
test("after the rollover a returning player has last season's rows, before any game this season", () => {
  finished(first); api._save_loaded();
  const size_before = JSON.stringify(first).length;
  assert(rollover(ID)["next_season"]);
  const st = api.loaded_state();
  equal(st["year"], YEAR + 1);
  equal(Object.keys(st["my_boxes"]).length, 0);
  const here = new Set(st["league"]["teams"][ME]["roster"].map((c) => c["id"]));
  back = played.filter((p) => here.has(p["slug"]));
  gone = played.filter((p) => !here.has(p["slug"]));
  assert(back.length > 10 && gone.length > 3, show([back.length, gone.length]));
  const kept = st["career"]["game_logs"];
  assert(kept.length === 1 && kept[0]["year"] === YEAR && kept[0]["team"] === ME && kept[0]["games"].length === 2, show(kept));
  console.log(`     (a season of ${kept[0]["games"].length} games adds ${JSON.stringify(kept).length} bytes to the save; `
    + `the season before the rollover was ${size_before} bytes)`);
  for (const p of back) {
    const pr = profile(p["slug"]);
    equal(pr["game_log"], []);                                   // this season's, as it always was
    equal(pr["game_logs"].length, 1);
    equal(pr["game_logs"][0]["year"], YEAR);
    // the rows are the ones his page showed last season (what the page reads of them)
    const want = then[p["slug"]].map((r) => ({ week: r["week"], opponent_name: r["opponent_name"], venue: r["venue"], won: r["won"],
      points_for: r["points_for"], points_against: r["points_against"], started: r["started"] }));
    equal(pr["game_logs"][0]["rows"], want);
  }
});

test("a player who graduated or left has no log kept", () => {
  const kept = api.loaded_state()["career"]["game_logs"][0]["players"];
  const grads = new Set(first["offseason"]["departures"].filter((e) => e["kind"] === "graduated" && e["team"] === ME).map((e) => e["id"]));
  assert(gone.some((p) => grads.has(p["slug"])), "the seed graduates someone who played");
  for (const p of gone) assert(!(p["slug"] in kept), p["slug"]);
  equal(sorted(Object.keys(kept)), sorted(back.map((p) => p["slug"])));
});

test("an FCS stand-in in a kept season reads as its region, never a school", () => {
  const st = api.loaded_state();
  const teams = season.load_teams();
  // every kept opponent is the name the schedule showed: a team's name, or a stand-in's region label
  const names = new Set(Object.values(first["games"]).flatMap((g) => [g["home_display"], g["away_display"]]));
  for (const g of st["career"]["game_logs"][0]["games"]) assert(names.has(g["opponent_name"]), g["opponent_name"]);
  const fcs = Object.values(first["games"]).find((g) => (g["home"] === ME || g["away"] === ME) && teams[g["home"] === ME ? g["away"] : g["home"]]?.["fictional"]);
  assert(fcs, "the seed's schedule has an FCS stand-in");
  {
    // a made-up box for that game: the row kept for it carries the label
    const box = Object.values(first["my_boxes"])[0];
    const side = Object.values(first["games"]).find((g) => g["event_id"] === Object.keys(first["my_boxes"])[0])["home"] === ME ? "home" : "away";
    const fake = { ...first, my_boxes: { [fcs["event_id"]]: { [fcs["home"] === ME ? "home" : "away"]: box[side] } } };
    const kept = season.team_game_logs(fake, ME);
    assert(/^FCS /.test(kept["games"][0]["opponent_name"]), kept["games"][0]["opponent_name"]);
  }
});

test("once he plays this season, this season comes first", () => {
  play_games(ID, 1);
  const st = api.loaded_state();
  const now = back.map((p) => profile(p["slug"])).filter((pr) => pr && pr["game_log"].length);
  assert(now.length > 10, String(now.length));
  for (const pr of now) {
    equal(pr["game_logs"].map((x) => x["year"]), [YEAR + 1, YEAR]);
    equal(pr["game_logs"][0]["rows"], pr["game_log"]);
  }
  // one who did not play this week still opens on last year
  const sat = back.map((p) => profile(p["slug"])).find((pr) => pr && !pr["game_log"].length);
  if (sat) equal(sat["game_logs"].map((x) => x["year"]), [YEAR]);
  assert(st["year"] === YEAR + 1);
});

test("an old save without the block loads and shows what it did; the next rollover starts one", () => {
  const st = api.loaded_state();
  const kept = st["career"]["game_logs"];
  delete st["career"]["game_logs"];
  api._save_loaded();
  const again = api.call("GET", `/api/season/${ID}`);
  assert(again && !("game_logs" in api.loaded_state()["career"]));
  const pr = profile(back[0]["slug"]);
  equal(pr["game_logs"], pr["game_log"].length ? [{ year: YEAR + 1, rows: pr["game_log"] }] : []);
  st["career"]["game_logs"] = kept;
});

test("only the last few seasons are kept, and none of a school you left", () => {
  const st = api.loaded_state();
  const car = st["career"];
  const one = car["game_logs"][0];
  // seven made-up seasons before this one, oldest first
  car["game_logs"] = [];
  for (let y = YEAR - 6; y <= YEAR; y++) car["game_logs"].push({ ...one, year: y });
  finished(st); api._save_loaded();
  assert(rollover(ID)["next_season"]);
  const next = api.loaded_state();
  const years = next["career"]["game_logs"].map((x) => x["year"]);
  equal(years.length, offseason.GAME_LOG_SEASONS);
  equal(years, [YEAR - 3, YEAR - 2, YEAR - 1, YEAR, YEAR + 1]);
  const here = new Set(next["league"]["teams"][ME]["roster"].map((c) => c["id"]));
  for (const x of next["career"]["game_logs"]) for (const id of Object.keys(x["players"])) assert(here.has(id), id);
  const pr = season.player_profile(next, ME, null, null, Object.keys(next["career"]["game_logs"][4]["players"])[0]);
  equal(pr["game_logs"][0]["year"], YEAR + 1);
  assert(pr["game_logs"].length >= 1 && pr["game_logs"].length <= offseason.GAME_LOG_SEASONS);
  // leaving for another school drops them
  offseason.keep_game_logs({ ...next, career: next["career"] }, YEAR + 2, "ohio-state");
  assert(!("game_logs" in next["career"]));
});

await run();
