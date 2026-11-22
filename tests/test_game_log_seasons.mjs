// The Game Log's season tabs: a career keeps every player's part in each of your games when a season ends, stat lines
// and all, so a returning player's page still has last year's log (and opens on it before the new season's first
// game). A log follows the player until he leaves college: one who transfers away keeps his (and his page shows it),
// one who graduates has none; changing schools keeps the old players' logs. Only the last few seasons are kept, and
// a save from before this simply shows what it did.
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

let gone = null, back = null, left = null;
/** A season's rows as the page had them in the season itself: all but what only the live season knows. */
const kept_rows = (rows) => rows.map(({ event_id: _e, title: _t, opponent: _o, ...rest }) => rest);
test("after the rollover a returning player has last season's rows, before any game this season", () => {
  finished(first); api._save_loaded();
  const size_before = JSON.stringify(first).length;
  assert(rollover(ID)["next_season"]);
  const st = api.loaded_state();
  equal(st["year"], YEAR + 1);
  equal(Object.keys(st["my_boxes"]).length, 0);
  const here = new Set(st["league"]["teams"][ME]["roster"].map((c) => c["id"]));
  back = played.filter((p) => here.has(p["slug"]));
  const anywhere = new Set(Object.values(st["league"]["teams"]).flatMap((t) => t["roster"].map((c) => c["id"])));
  left = played.filter((p) => !here.has(p["slug"]) && anywhere.has(p["slug"]));          // transferred away
  gone = played.filter((p) => !anywhere.has(p["slug"]));                                 // out of college
  assert(back.length > 10 && gone.length > 3, show([back.length, gone.length, left.length]));
  const kept = st["career"]["game_logs"];
  assert(kept.length === 1 && kept[0]["year"] === YEAR && kept[0]["team"] === ME && kept[0]["games"].length === 2, show(kept));
  console.log(`     (a season of ${kept[0]["games"].length} games adds ${JSON.stringify(kept).length} bytes to the save; `
    + `the season before the rollover was ${size_before} bytes)`);
  for (const p of back) {
    const pr = profile(p["slug"]);
    equal(pr["game_log"], []);                                   // this season's, as it always was
    // this season leads with nothing in it yet (the page opens on the newest season with games: last year's)
    equal(pr["game_logs"].map((x) => [x["year"], x["rows"].length > 0]), [[YEAR + 1, false], [YEAR, true]]);
    // the rows are the ones his page showed last season, his stat line in each game with them
    equal(pr["game_logs"][1]["rows"], kept_rows(then[p["slug"]]));
    assert(!("team_name" in pr["game_logs"][1]));
  }
});

test("a kept row's stat line is the box score's, and reads as the game's own line for his position", () => {
  const side = (eid) => (first["games"][eid]["home"] === ME ? "home" : "away");
  const boxes = sorted(Object.keys(first["my_boxes"]), (eid) => first["games"][eid]["week"]);
  let lines = 0;
  for (const p of back) {
    const rows = profile(p["slug"])["game_logs"][1]["rows"];
    const mine = boxes.map((eid) => first["my_boxes"][eid][side(eid)]["players"].find((x) => x["name"] === p["name"] && x["position"] === p["position"]))
      .filter(Boolean);
    equal(rows.map((r) => r["stats"]), mine.map((x) => x["stats"]));
    for (const r of rows) if (r["line"]) { lines++; assert(typeof r["line_full"] === "string" && r["line_full"].length >= r["line"].length, show(r)); }
  }
  assert(lines > 20, String(lines));
  const qb = back.map((p) => [p, profile(p["slug"])["game_logs"][1]["rows"]]).find(([p, rows]) => p["position"] === "QB" && rows.some((r) => r["stats"]["pass_attempts"]));
  if (qb) {
    const r = qb[1].find((x) => x["stats"]["pass_attempts"]);
    equal(r["line"], game.modules.awards.headline({ stats: r["stats"] }, "QB"));
    assert(/ Yds · \d+ TD$/.test(r["line"]), r["line"]);
  }
});

test("a player who transferred away keeps his log, and his page at his new school shows it as his games with you", () => {
  const st = api.loaded_state();
  if (!left.length) {                                   // the seed sent nobody who played to another school: send one
    const teams = st["league"]["teams"];
    const other = sorted(Object.keys(teams)).find((s) => s !== ME);
    const c = teams[ME]["roster"].find((x) => x["id"] === back[back.length - 1]["slug"]);
    teams[ME]["roster"].splice(teams[ME]["roster"].indexOf(c), 1);
    teams[other]["roster"].push(c);
    left = [back.pop()];
  }
  const kept = st["career"]["game_logs"][0]["players"];
  let seen = 0;
  for (const p of left) {
    assert(p["slug"] in kept, p["slug"]);
    const pr = season.player_profile(st, null, null, null, p["slug"]);
    if (!pr || pr["team"]["slug"] === ME) continue;                    // (the built teams file has him where the league does)
    seen++;
    assert(pr["game_log"] === null);
    equal(pr["game_logs"].map((x) => [x["year"], x["team_name"]]), [[YEAR, season.load_teams()[ME]["name"]]]);
    equal(pr["game_logs"][0]["rows"], kept_rows(then[p["slug"]]));
  }
  console.log(`     (${left.length} who played transferred away; ${seen} read on their new team's page)`);
});

test("a player who graduated or left college has no log kept", () => {
  const kept = api.loaded_state()["career"]["game_logs"][0]["players"];
  const grads = new Set(first["offseason"]["departures"].filter((e) => e["kind"] === "graduated" && e["team"] === ME).map((e) => e["id"]));
  assert(gone.some((p) => grads.has(p["slug"])), "the seed graduates someone who played");
  for (const p of gone) assert(!(p["slug"] in kept), p["slug"]);
  equal(sorted(Object.keys(kept)), sorted([...back, ...left].map((p) => p["slug"])));
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
  // one who did not play this week still has last year's to open on
  const sat = back.map((p) => profile(p["slug"])).find((pr) => pr && !pr["game_log"].length);
  if (sat) equal(sat["game_logs"].map((x) => [x["year"], x["rows"].length > 0]), [[YEAR + 1, false], [YEAR, true]]);
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
  // a save from when only who played was kept (a character a game, no lines): the rows, without a line
  const full = profile(back[0]["slug"]);
  st["career"]["game_logs"] = kept.map(({ stat_keys: _k, ...x }) => ({ ...x, players: Object.fromEntries(Object.entries(x["players"]).map(([id, e]) => [id, e["m"]])) }));
  const bare = profile(back[0]["slug"])["game_logs"].at(-1);
  st["career"]["game_logs"] = kept;
  const whole = profile(back[0]["slug"])["game_logs"].at(-1);
  equal(bare["rows"], whole["rows"].map(({ stats: _s, line: _l, line_full: _f, ...rest }) => rest));
  assert(full && whole["rows"].some((r) => r["line"]));
});

test("only the last few seasons are kept, and changing schools keeps the old players' logs", () => {
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
  const here = new Set(Object.values(next["league"]["teams"]).flatMap((t) => t["roster"].map((c) => c["id"])));
  for (const x of next["career"]["game_logs"]) for (const id of Object.keys(x["players"])) assert(here.has(id), id);
  const pr = season.player_profile(next, ME, null, null, Object.keys(next["career"]["game_logs"][4]["players"])[0]);
  equal(pr["game_logs"].slice(0, 2).map((x) => [x["year"], x["rows"].length > 0]), [[YEAR + 2, false], [YEAR + 1, true]]);
  assert(pr["game_logs"].length <= offseason.GAME_LOG_SEASONS + 1);                  // this season and the kept ones
  // you take another job: the season is kept as any other, and at the new school the old one's players still have
  // their seasons with you, while the new school's start fresh
  const before = JSON.stringify(next["career"]["game_logs"]);
  const moved = { ...next, team: "ohio-state", year: YEAR + 3, my_boxes: {} };
  const stayed = Object.keys(next["career"]["game_logs"][4]["players"]).find((id) => next["league"]["teams"][ME]["roster"].some((c) => c["id"] === id));
  offseason.keep_game_logs(next, YEAR + 2);
  equal(JSON.stringify(next["career"]["game_logs"]), before);
  const old = season.player_profile(moved, ME, null, null, stayed);
  assert(old["game_log"] === null && old["game_logs"].length >= 1, show(old["game_logs"].map((x) => x["year"])));
  assert(old["game_logs"][0]["year"] === YEAR + 1 && old["game_logs"].every((x) => !("team_name" in x) && x["rows"].length));
  const fresh = season.load_teams()["ohio-state"]["offense"][0];
  equal(season.player_profile(moved, "ohio-state", null, null, fresh["slug"])["game_logs"], []);
});

await run();
