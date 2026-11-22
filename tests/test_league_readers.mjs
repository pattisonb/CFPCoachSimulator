// Every page's read in a career from a league file: a new team (Alder Tech) in a new conference (Big Sky East), Kent
// State removed and the MAC renamed "Lake Erie League". Before the first game, two weeks in, at every offseason
// stage, after the next season starts and after the save is exported and imported back, each route answers, shows
// Alder Tech by name (with its colors and conference where the route carries them), shows the MAC only by its new
// name, and nothing in it says null, undefined or NaN, names Kent State, or carries an FCS stand-in's old name.
// `node tests/test_league_readers.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random, sorted } from "../engine_js/pyrt.js";

const game = await start({ env: { SIM_WORKERS: "1", CFP_SEASONS_DIR: "data/seasons-readers-test" } });
const { api, season, recruiting } = game;
const { league, league_file, fcs_names } = game.modules;

const show = (v) => JSON.stringify(v);
const ALDER_COLORS = { primary: { name: "Green", hex: "#0B6E4F" }, secondary: { name: "White", hex: "#FFFFFF" } };
const NEW_CONF = "Big Sky East", RENAMED = "Lake Erie League";
const BIG_SKY_EAST = ["alder-tech", "basalt-state", "cascade-tech", "deschutes", "elk-river", "fir-valley",
  "glacier-state", "high-desert", "ironwood", "juniper-state"];
const STATES = ["OR", "OR", "WA", "OR", "ID", "WA", "MT", "OR", "WA", "ID"];
const title = (slug) => slug.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

const FILE = { format: "cfp-league/1", name: "My League", remove: ["kent-state"],
  conferences: [{ id: "big-sky-east", name: NEW_CONF, level: "FBS", games: 8 }, { id: "mac", name: RENAMED, games: 8 }],
  teams: BIG_SKY_EAST.map((s, i) => ({ slug: s, name: title(s), state: STATES[i], conference: "big-sky-east",
    ...(s === "alder-tech" ? { rivals: ["oregon-state"], prestige: 40, colors: ALDER_COLORS } : {}) })) };

/** One call the way the page's worker makes it (api.call_js); a refusal is an error. */
function api_call(method, path, body = null, body_bytes = null) {
  const out = api.call_js(method, path, body !== null ? JSON.stringify(body) : null, body_bytes);
  if (out instanceof Uint8Array) return out;
  const r = JSON.parse(out);
  if (!r["ok"]) throw new Error(`${method} ${path}: ${r["status"]} ${r["message"]}`);
  return r["result"];
}

const BAD_WORD = /\b(null|undefined|NaN|None)\b/;
const OLD_MAC = /\bMAC\b/;

/** Every key, string and number in an answer, with where it sits. */
function* leaves(x, path = "$") {
  if (Array.isArray(x)) for (let i = 0; i < x.length; i++) yield* leaves(x[i], `${path}[${i}]`);
  else if (x !== null && typeof x === "object") for (const [k, v] of Object.entries(x)) { yield [`${path}.${k}`, k]; yield* leaves(v, `${path}.${k}`); }
  else yield [path, x];
}

let SEEN = 0;
/** The checks every answer passes; `alder` names what it must carry: "name", "colors", "conference". */
function check(route, body, alder = []) {
  const text = JSON.stringify(body);
  for (const [where, v] of leaves(body)) {
    if (typeof v === "number") assert(Number.isFinite(v), show([route, where, v]));
    if (typeof v !== "string") continue;
    assert(!BAD_WORD.test(v), show([route, where, v]));
    assert(!v.includes("Kent State") && v !== "kent-state", show([route, where, v]));
    assert(!OLD_MAC.test(v), show([route, where, v]));
  }
  assert(!fcs_names.has_old(text), route);
  if (alder.includes("name")) assert(text.includes("Alder Tech"), route);
  if (alder.includes("colors")) assert(text.includes(ALDER_COLORS["primary"]["hex"]), route);
  if (alder.includes("conference")) assert(text.includes(NEW_CONF), route);
  SEEN += 1;
}
function read(path, alder = []) {
  const out = api_call("GET", path);
  check(path, out, alder);
  return out;
}

/** Every route a season's tabs read, for Alder Tech. */
function season_routes(sid, st) {
  const b = `/api/season/${sid}`;
  const teams = read(`${b}/teams`, ["name", "colors", "conference"])["teams"];
  const alder = teams.find((t) => t["slug"] === "alder-tech");
  assert(alder["conference"] === NEW_CONF && alder["colors"]["primary"] === "#0B6E4F", show(alder));
  assert(!teams.some((t) => t["slug"] === "kent-state"));
  equal(new Set(teams.filter((t) => ["toledo", "ohio", "miami-oh"].includes(t["slug"])).map((t) => t["conference"])), new Set([RENAMED]));
  const summ = read(b, ["name", "conference"]);
  assert(summ["team_name"] === "Alder Tech" && summ["conference"] === NEW_CONF, show([summ["team_name"], summ["conference"]]));
  const table = read(`${b}/standings`, ["name", "conference"])["standings"];
  assert(NEW_CONF in table && RENAMED in table && !("MAC" in table), show(Object.keys(table)));
  read(`${b}/week/${Math.max(1, st["current_week"])}`);
  read(`${b}/schedule/alder-tech`, ["name", "conference"]);
  read(`${b}/schedule/toledo`);
  read(`${b}/stats/teams`, st["current_week"] > 1 ? ["name", "conference"] : []);
  read(`${b}/stats/leaders?n=5&team=alder-tech`);
  read(`${b}/stats/leaders?n=5&conference=${encodeURIComponent(NEW_CONF)}`);
  read(`${b}/stats/leaders?n=5&conference=${encodeURIComponent(RENAMED)}`);
  read(`${b}/stats/players?cat=passing&team=alder-tech`);
  read(`${b}/depth/alder-tech`);
  read(`${b}/depth/alder-tech/formations`);
  const roster = read(`${b}/depth/alder-tech/roster`, ["name", "conference"]);
  const player = (roster["players"] || roster["roster"] || [])[0];
  read(`${b}/preview?team=alder-tech`, ["name"]);
  const riv = read(`${b}/rivalries?team=alder-tech`, ["name"])["rivalries"];
  equal(riv.map((r) => r["opponent"]), ["oregon-state"]);          // the file's listed rival
  assert(read(`${b}/rivalries?team=oregon-state`, ["name"])["rivalries"].some((r) => r["opponent"] === "alder-tech"));
  for (const path of ["injuries?team=alder-tech", "injuries", "awards", "news", "settings", "resume", "recruiting", "scouting", "prospects", "recruiting/report"]) read(`${b}/${path}`);
  read(`${b}/programs`, ["name"]);
  read(`${b}/office`, ["conference"]);
  read(`${b}/classes?school=alder-tech`, ["name"]);
  const rc = st["recruiting"];
  read(`${b}/prospect/${sorted(Object.keys(rc["prospects"]), (p) => rc["prospects"][p]["rank"])[0]}`);
  const played = Object.values(st["games"]).find((g) => (g["home"] === "alder-tech" || g["away"] === "alder-tech") && g["played"] && g["event_id"]);
  if (played) read(`${b}/game/${played["event_id"]}`, ["name"]);
  const q = player && (player["slug"] || player["id"]);
  if (q) read(`${b}/player?team=alder-tech&slug=${q}`, ["name"]);
  const seasons = read("/api/seasons")["seasons"];
  assert(seasons.some((s) => s["id"] === sid && s["team_name"] === "Alder Tech"));
}

/** Every game played (the better team usually wins), every school's class signed, the season over. */
function finished(st) {
  const rng = new Random(1);
  const teams = season.load_teams();
  for (const g of Object.values(st["games"])) {
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

// A league that only nudges a built-in team's prestige gives that team an identity of its own; its rivalries, and its
// listed rivals', must stay the game's: no trophyless pair appears between two of the game's teams.
test("a built-in team a league file edits keeps the game's rivalries", () => {
  const meta = JSON.parse(JSON.stringify(league.base_meta("alabama")));
  meta["prestige"] = (meta["prestige"] || 50) + 5;
  const plain = { games: {} }, edited = { games: {}, league: { teams: { alabama: { meta } } } };
  for (const slug of ["alabama", ...(meta["rivals"] || [])]) equal(season.rivalries_view(edited, slug), season.rivalries_view(plain, slug), slug);
});

let SID = null;
const B = () => `/api/season/${SID}`;

test("before the first game every page reads the league as the file made it", () => {
  const r = api_call("POST", "/api/league/check", null, league_file.dumps(FILE));
  assert(r["ok"], show(r["errors"]));
  SID = api_call("POST", "/api/season", { team: "alder-tech", mode: "full", seed: 7, league: r["key"] })["id"];
  equal(api.loaded_state()["league"]["conference_names"]["MAC"], RENAMED);
  season_routes(SID, api.loaded_state());
});

test("two weeks into the season every page still does", () => {
  const st = api.loaded_state();
  season.advance(st); season.advance(st);
  api._save_loaded();
  season_routes(SID, st);
});

test("at every stage of the offseason the pages show the file's names", () => {
  finished(api.loaded_state());
  api._save_loaded();
  const stages = [];
  for (;;) {
    const off = read(`${B()}/offseason`, ["name"]);
    stages.push(off["stage"]);
    read(`${B()}/programs`, ["name"]);
    read(`${B()}/office`, ["conference"]);
    read(`${B()}/standings`, ["name", "conference"]);
    read(B(), ["name"]);
    if (off["stage"] === "ready") break;
    check("advance", api_call("POST", `${B()}/offseason/advance`, {}));
    assert(stages.length < 40, `the offseason never got ready: ${show(stages)}`);
  }
  assert(stages.length >= 5, show(stages));
});

test("the next season keeps the league, its new team and its renamed conference", () => {
  const nxt = api_call("POST", `${B()}/offseason/advance`, {});
  check("next_season", nxt, ["name"]);
  assert(nxt["year"] === 2027 && api.loaded_state()["league"]["conference_names"]["MAC"] === RENAMED);
  season_routes(api.loaded_state()["id"], api.loaded_state());
});

// a save carries its own league: loaded while the built-in league is in play, the career's league comes back with it
test("the save exported, deleted and imported back brings its own league with it", () => {
  const blob = api_call("GET", `${B()}/export`);
  api_call("DELETE", B());
  season.use_league(season.TEAMS_FILE);
  recruiting.use_league_models({});
  const back = api_call("POST", "/api/season/import", null, blob);
  check("import", back, ["name"]);
  assert(back["team_name"] === "Alder Tech" && back["year"] === 2027, show([back["team_name"], back["year"]]));
  season_routes(SID, api.loaded_state());
  assert(SEEN > 150, `only ${SEEN} answers were checked`);
});

await run();
