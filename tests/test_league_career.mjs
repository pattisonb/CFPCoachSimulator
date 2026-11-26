// A career from a league file, through the API: /api/league/check reads and checks the file, POST /api/season starts
// the career from the league checked, and that league carries the career through a season and an offseason into the
// next year. The game's own export imported back is simply the built-in career.
// `node tests/test_league_career.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random, json_dumps, sorted } from "../engine_js/pyrt.js";

const game = await start({ env: { SIM_WORKERS: "1", CFP_SEASONS_DIR: "data/seasons-league-test" } });
const { api, season, offseason, recruiting, files } = game;
const { league, league_file, league_fill, programs, schedule_gen, fcs_names } = game.modules;

const copy = (v) => JSON.parse(JSON.stringify(v));
const show = (v) => JSON.stringify(v);
const FCS_META = league.base_slugs().map((s) => league.base_meta(s)).filter((m) => m["fictional"]);
const BIG_SKY_EAST = ["alder-tech", "basalt-state", "cascade-tech", "deschutes", "elk-river", "fir-valley",
  "glacier-state", "high-desert", "ironwood", "juniper-state"];
const STATES = ["OR", "OR", "WA", "OR", "ID", "WA", "MT", "OR", "WA", "ID"];
const title = (slug) => slug.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

/** Alder Tech and nine more new teams in a new conference of eight league games. */
const NEW_TEN_TEAM_CONFERENCE = { format: "cfp-league/1", name: "My League",
  conferences: [{ id: "big-sky-east", name: "Big Sky East", level: "FBS", games: 8 }],
  teams: BIG_SKY_EAST.map((s, i) => ({ slug: s, name: title(s), state: STATES[i], conference: "big-sky-east",
    ...(s === "alder-tech" ? { rivals: ["oregon-state"], prestige: 40 } : {}) })) };

class Refused extends Error {
  constructor(status, message) { super(`${status}: ${message}`); this.status = status; this.reason = message; }
}
/** One call the way the page's worker makes it (api.call_js): the result, or Refused. */
function api_call(method, path, body = null, body_bytes = null) {
  const out = api.call_js(method, path, body !== null ? JSON.stringify(body) : null, body_bytes);
  if (out instanceof Uint8Array) return out;
  const r = JSON.parse(out);
  if (!r["ok"]) throw new Refused(r["status"], r["message"]);
  return r["result"];
}
function refused(fn, code) {
  try { fn(); } catch (e) {
    if (!(e instanceof Refused)) throw e;
    assert(e.status === code, `expected ${code}: ${e.message}`);
    return e.reason;
  }
  throw new Error(`expected ${code}`);
}
const sentence = (s) => Boolean(s) && /^[A-Z]/.test(s) && s.endsWith(".") && !["None", "null", "undefined", "NaN"].some((w) => s.includes(w));
const bytes = (text) => new TextEncoder().encode(text);

/** A file that only renames the first built-in conference. */
function rename_only(name, suffix) {
  const b = league_file._builtin();
  const cid = Object.keys(b["conf_names"])[0];
  return { format: "cfp-league/1", name, conferences: [{ id: cid, name: b["conf_names"][cid] + suffix, games: b["games"][cid] }] };
}

/** Every game played (the better team usually wins), every school's class signed, the season over. */
function finished(st) {
  const rng = new Random(1);
  const teams = season.load_teams();
  for (const g of Object.values(st["games"])) {
    const [h, a] = [teams[g["home"]]["team_ratings"]["overall"], teams[g["away"]]["team_ratings"]["overall"]];
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


// ---- the check ------------------------------------------------------------------------------------

test("a file the game cannot read or that breaks a rule is answered with sentences", () => {
  equal(league_file.check(bytes('{"format": "cfp-league/2"}')),
    { ok: false, errors: ["The file's format is 'cfp-league/2'; this game reads 'cfp-league/1'."], errors_total: 1 });
  const bad = { format: "cfp-league/1", teams: [{ slug: "alder-tech", name: "Alder Tech", conference: "big-sky-e" }] };
  const r = league_file.check(league_file.dumps(bad));
  assert(!r["ok"] && r["errors"].includes("Alder Tech: conference 'big-sky-e' is not in the file or the game."));
});

// the generator speaks in slugs and engine names: the page gets team names, a renamed conference's new name, and an
// FCS stand-in only as "an FCS opponent"
test("a schedule that cannot be built is one sentence in the page's names, never naming an FCS stand-in", () => {
  const fcs = FCS_META[0]["slug"];
  const real = schedule_gen.generate;
  schedule_gen.generate = () => { throw new schedule_gen.ScheduleError(`${fcs} cannot fill its 2026 schedule; alder-tech too`); };
  let r;
  try { r = league_file.check(league_file.dumps(NEW_TEN_TEAM_CONFERENCE), 4); } finally { schedule_gen.generate = real; }
  equal(r, { ok: false, errors: ["The 2026 schedule could not be built for this league: an FCS opponent cannot fill its 2026 schedule; Alder Tech too."], errors_total: 1 });
  const teams = { [fcs]: { fictional: true, name: "x" }, "alder-tech": { fictional: false, name: "Alder Tech" } };
  equal(league_file._plain(`2 teams without 12 games in 2026: ['${fcs}', 'alder-tech']; can't fit`, teams),
    "2 teams without 12 games in 2026: an FCS opponent, Alder Tech; can't fit");
  equal(league_file._plain("no Big Ten slate for 2026", {}, { "Big Ten": "Big Ten Plus" }), "no Big Ten Plus slate for 2026");
});

test("a file that only renames a conference keeps the real 2026 schedule, and its summary says what the league loses", () => {
  const doc = rename_only("Renamed", " Plus");
  const r = league_file.check(league_file.dumps(doc), 2);
  assert(r["ok"] && !r["builtin"] && r["games"] === null && !("schedule_history" in r["league"]));
  const s = r["summary"];
  equal([s["name"], s["added"], s["changed"], s["removed"], s["generated"]], ["Renamed", 0, 0, 0, 0]);
  assert(s["lines"].every(sentence), show(s["lines"]));
  equal(s["lines"][1], "Teams the file leaves alone play without the real 2026 depth charts and adjustments.");
  // a conference the file lists with no teams is left out, and the summary says so
  doc["conferences"].push({ id: "lone-star", name: "Lone Star", games: 0 });
  const lone = league_file.check(league_file.dumps(doc), 2);
  assert(lone["ok"] && lone["summary"]["lines"].includes("Lone Star has no teams, so the league leaves it out."), show(lone["summary"]["lines"]));
  // Start builds the teams file again from the league alone: it must be the one the check built
  assert(json_dumps(league.build(r["league"])) === json_dumps(r["engine"]));
  // the game's own export says nothing of the kind (it is the built-in league, adjustments and all)
  const lines = league_file.check(league_file.builtin_bytes())["summary"]["lines"];
  assert(!lines.some((x) => x.includes("leaves alone")), show(lines));
});


// ---- the API ---------------------------------------------------------------------------------------

test("starting from a league that was never checked is refused; a bad file's check lists its problems and their count", () => {
  refused(() => api_call("POST", "/api/season", { team: "smu", seed: 1, league: "0".repeat(64) }), 409);
  assert(refused(() => api_call("POST", "/api/season", { team: "smu", league: "abc" }), 409).includes("no longer loaded"));
  let r = api_call("POST", "/api/league/check", null, bytes("{"));
  assert(!r["ok"] && r["errors"].length && r["key"] === null && r["teams"].length === 0 && r["errors_total"] === 1);
  const many = { format: "cfp-league/1", teams: Array.from({ length: 100 }, (_, i) => ({ slug: `bad-${i}`, name: `Bad ${i}`, conference: "nowhere" })) };
  r = api_call("POST", "/api/league/check", null, league_file.dumps(many));
  assert(r["errors_total"] === 100 && r["errors"].length === league_file.MAX_ERRORS + 1 && r["errors"][r["errors"].length - 1] === "And 50 more.", show(r["errors_total"]));
});

// Only the league checked last can be started: the page shows one league's summary, and Start must play that one.
test("only the league checked last can be started: an older key is refused and a failed check clears it", () => {
  const a = api_call("POST", "/api/league/check", null, league_file.dumps(rename_only("League A", " A")));
  const b = api_call("POST", "/api/league/check", null, league_file.dumps(rename_only("League B", " B")));
  assert(a["ok"] && b["ok"] && a["key"] !== b["key"]);
  // the picker shows a renamed conference by its new name (the engine keeps the old one)
  const old = Object.values(league_file._builtin()["conf_names"])[0];
  const confs = new Set(a["teams"].map((t) => t["conference"]));
  assert(confs.has(`${old} A`) && !confs.has(old), show([...confs]));
  assert(refused(() => api_call("POST", "/api/season", { team: "smu", seed: 1, league: a["key"] }), 409).includes("no longer loaded"));
  assert(!api_call("POST", "/api/league/check", null, bytes("{"))["ok"]);
  refused(() => api_call("POST", "/api/season", { team: "smu", seed: 1, league: b["key"] }), 409);
});

test("the game's own export imported back starts the built-in career, game for game", () => {
  const r = api_call("POST", "/api/league/check", null, league_file.builtin_bytes());
  assert(r["ok"] && r["key"] === "builtin" && !r["errors"].length);
  equal(r["teams"].map((t) => t["slug"]), sorted(r["teams"], (t) => t["name"].toLowerCase()).map((t) => t["slug"]));
  assert(r["teams"].some((t) => t["slug"] === "smu") && !r["teams"].some((t) => t["fictional"]));
  assert(r["summary"]["lines"].every(sentence), show(r["summary"]["lines"]));
  const s = api_call("POST", "/api/season", { team: "smu", mode: "full", seed: 11, league: r["key"] });
  const st = season.load_season(s["id"]);
  assert(!("league" in st) && s["league"] === null);
  season.use_league(season.TEAMS_FILE);
  recruiting.use_league_models({});
  const ref = season.new_season("smu", "full", 11, undefined, undefined, true);
  assert(json_dumps(st["games"]) === json_dumps(ref["games"]) && json_dumps(st["polls"]) === json_dumps(ref["polls"]));
  api_call("DELETE", `/api/season/${s["id"]}`);
});


// ---- a whole career from a file ------------------------------------------------------------------

let KEY = null, CHECKED = null, FILLS = 0, SID = null, ST = null;

test("a new ten-team conference passes the check: ten teams added, 850 players generated", () => {
  const real = league_fill.to_league;
  league_fill.to_league = (...a) => { FILLS += 1; return real(...a); };      // (stays counted for the next tests)
  const r = api_call("POST", "/api/league/check", null, league_file.dumps(NEW_TEN_TEAM_CONFERENCE));
  assert(r["ok"] && !r["errors"].length && r["teams"].some((t) => t["slug"] === "alder-tech"), show(r["errors"]));
  assert(r["summary"]["added"] === 10 && r["summary"]["generated"] === 850 && r["summary"]["lines"].every(sentence), show(r["summary"]));
  KEY = r["key"];
  CHECKED = {};
  for (const [slug, t] of Object.entries(api._pending_league["lgd"]["teams"])) CHECKED[slug] = copy(t["roster"]);
});

test("a career cannot start at a team the league does not have, nor at an FCS stand-in", () => {
  refused(() => api_call("POST", "/api/season", { team: "nowhere-u", seed: 4, league: KEY }), 404);
  refused(() => api_call("POST", "/api/season", { team: FCS_META[0]["slug"], seed: 4, league: KEY }), 404);
});

// A Start that fails in the season or in its save leaves no league file and no save, puts the built-in league back,
// and keeps the checked league for another try.
test("a Start that fails leaves nothing behind and can be tried again", () => {
  const listing = () => new Set([...files.list_dir(league.CACHE_DIR), ...files.list_dir(season.SEASONS_DIR)]);
  const before = listing();
  for (const name of ["new_season", "save_season"]) {
    const real = season[name];
    season[name] = (...a) => {
      if (name === "save_season") real(...a);                     // a save written, then the failure
      throw new Error("disk full");
    };
    try {
      refused(() => api_call("POST", "/api/season", { team: "alder-tech", seed: 4, league: KEY }), 500);
    } finally { season[name] = real; }
    equal(listing(), before, name);
    assert(season._league_path === season.TEAMS_FILE && api._pending_league["key"] === KEY, name);
  }
});

test("Start plays exactly the league that was checked, with its own schedule and no real 2026 poll", () => {
  const s = api_call("POST", "/api/season", { team: "alder-tech", mode: "full", seed: 4, league: KEY });
  equal(FILLS, 1);                                  // checked without a seed, started with seed 4: the league is filled once
  SID = s["id"];
  const st = season.load_season(SID);
  for (const [slug, t] of Object.entries(st["league"]["teams"])) assert(json_dumps(t["roster"]) === json_dumps(CHECKED[slug]), slug);
  // the 2026 teams file Start wrote is what a rebuild gives (the browser keeps no built leagues between visits)
  const path = league.path(SID, 2026);
  const written = files.read_text(path);
  files.remove(path);
  assert(league.ensure_built(st) === path && files.read_text(path) === written);
  assert(st["league"]["source"]["name"] === "My League" && s["league"] === "My League");
  const mine = (games) => Object.values(games).filter((g) => g["home"] === "alder-tech" || g["away"] === "alder-tech");
  equal(mine(st["games"]).length, 12);
  assert(mine(st["games"]).some((g) => g["home"] === "oregon-state" || g["away"] === "oregon-state"), "the listed rival is on the schedule");
  equal(st["polls"]["0"]["ap"].map((e) => e["team"]), [...season._rating_poll(season.load_teams())]);
  equal([...st["league"]["schedule_history"]["years"]], [2026]);       // 2027 is scheduled from season one's games
  const teams = api_call("GET", `/api/season/${SID}/teams`)["teams"];
  assert(teams.some((t) => t["slug"] === "alder-tech" && t["conference"] === "Big Sky East"));
  refused(() => api_call("POST", "/api/season", { team: "alder-tech", seed: 4, league: KEY }), 409);      // used up
});

// a conference of new teams has no built-in members to take values from, so the game's defaults
test("a new program's values come from its prestige and the game's defaults", () => {
  const st = api.loaded_state();
  const [alder, basalt] = [programs.get(st, "alder-tech"), programs.get(st, "basalt-state")];
  assert(alder["prestige"] === 40 && alder["history"] === 40);
  equal(basalt["prestige"], programs.BASE_DEFAULT["prestige"]);
  for (const k of ["winning", "nil", "conference"]) assert(alder[k] === basalt[k] && alder[k] === programs.BASE_DEFAULT[k], k);
  equal(alder["market"], programs.MARKET_DEFAULT);
  assert(alder["rating"] > basalt["rating"]);
});

test("the league from the file plays its games, has its standings, and goes through the offseason into 2027", () => {
  const st = api.loaded_state();
  season.advance(st); season.advance(st);                          // real games, weeks 1 and 2
  assert(Object.values(st["games"]).filter((g) => g["week"] <= 2).every((g) => g["played"]));
  finished(st);                                                     // the rest of the season, made up
  const table = season.standings(st);
  assert("Big Sky East" in table && table["Big Sky East"].length === 10);
  equal(recruiting.fbs_schools(st).filter((s) => s === "alder-tech").length, 1);
  assert(recruiting.nil_budget(st, "alder-tech") >= recruiting.NIL_FLOOR);
  offseason.start(st);
  while (st["offseason"]["stage"] !== "ready") offseason.advance(st);
  const nxt = offseason.next_season(st);
  assert("alder-tech" in nxt["league"]["teams"] && nxt["year"] === 2027);
  equal(Object.values(nxt["games"]).filter((g) => g["home"] === "alder-tech" || g["away"] === "alder-tech").length, 12);
  ST = st;
});

// the stand-ins show only as the teams they are today, and nothing of the names they once had
test("FCS stand-ins on a custom league's schedule show only by their own names", () => {
  const view = api_call("GET", `/api/season/${SID}`);
  assert(!fcs_names.has_old(JSON.stringify(view)));
  const fict = new Set(FCS_META.map((f) => f["slug"]));
  let seen = 0;
  for (const g of view["schedule"]) if (fict.has(g["opponent"])) { equal(g["opponent_name"], season.fcs_label(g["opponent"])); seen++; }
  for (const g of Object.values(ST["games"])) {
    for (const side of ["home", "away"]) if (fict.has(g[side])) { equal(g[`${side}_display`], season.fcs_label(g[side])); seen++; }
  }
  assert(seen > 0, "no game against a stand-in was looked at");
});

await run();
