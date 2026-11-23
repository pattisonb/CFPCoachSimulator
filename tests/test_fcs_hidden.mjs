// The fictional FCS stand-ins and their players never show in a league-wide view: the injury report, team and player
// stats, leaders, awards, standings, the review, the resume, the recruiting pages. A view of a stand-in itself (its
// depth chart, a player page, its stats, injuries, rivalries, schedule) is refused, and a career cannot start there.
// They show only as an opponent, by their own names ("Plains Thunderheads"), and in the box score of a game they played.
// `node tests/test_fcs_hidden.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { sorted } from "../engine_js/pyrt.js";

const game = await start({ env: { SIM_WORKERS: "1", CFP_SEASONS_DIR: "data/seasons-fcs-test" } });
const { api, season } = game;
const fcs_names = game.modules.fcs_names;
const show = (v) => JSON.stringify(v);

const FICT = Object.fromEntries(Object.entries(season.load_teams()).filter(([, t]) => t["fictional"]));
// the placeholder slugs, school names, towns, mascots and stadiums the stand-ins once had: none may show anywhere
const OLD_NAMES = Object.keys(fcs_names._table()[1]);
// a game line may point at the stand-in it played (by slug, shown by its name)
const GAME_LINE_KEYS = new Set(["opponent", "opp", "home", "away"]);

/** No stand-in as a row of its own (a slug outside a game line), and none of the old placeholder names anywhere. */
function clean(label, payload, allow = []) {
  const walk = (x, key, path) => {
    if (Array.isArray(x)) x.forEach((v, i) => walk(v, key, `${path}[${i}]`));
    else if (x !== null && typeof x === "object") {
      for (const [k, v] of Object.entries(x)) {
        assert(!(k in FICT), `${label} keys a row by ${k} at ${path}`);
        walk(v, k, `${path}.${k}`);
      }
    } else if (typeof x === "string") {
      assert(!(x in FICT && !GAME_LINE_KEYS.has(key) && !allow.includes(key)), `${label} shows ${x} at ${path}`);
      const hit = OLD_NAMES.find((n) => x.includes(n));
      assert(hit === undefined, `${label} names ${hit} at ${path}: ${x.slice(0, 120)}`);
    }
  };
  walk(payload, null, "");
}
function refused(fn) {
  try { fn(); } catch (e) {
    if (!(e instanceof api.ApiError)) throw e;
    assert([400, 404].includes(e.status), `${e.status}: ${e.message}`);
    return e.message;
  }
  throw new Error("expected a refusal");
}

assert(OLD_NAMES.length > 20 && Object.keys(FICT).length >= 4, "the stand-ins and their old names were not read");
const sid = api.call("POST", "/api/season", { team: "smu", seed: 11 })["id"];
const base = `/api/season/${sid}`;
const first = sorted(Object.values(api.loaded_state()["games"]).filter((g) => g["home"] in FICT || g["away"] in FICT), (g) => [g["week"], g["event_id"]])[0];
let fslug = null;

// before week 1 a game can be traded: an FCS date's picker offers the other stand-ins, each by its own name
test("the schedule editor names a stand-in only by its own name, each stand-in once", () => {
  const edit = api.call("GET", `${base}/schedule_edit`);
  clean("schedule edit", edit, ["slug"]);                     // a swap option's value, shown by its name
  const options = edit["games"].flatMap((g) => g["options"]).filter((o) => o["slug"] in FICT);
  assert(options.length, "the FCS date offers no other stand-in");
  for (const o of options) equal(o["name"], season.fcs_label(o["slug"]));
  equal(new Set(options.map((o) => o["name"])).size, new Set(options.map((o) => o["slug"])).size, "two stand-ins share a picker name");
});

test("after a week with FCS games, no league-wide page lists a stand-in or one of its players", () => {
  api.call("POST", `${base}/advance`, { to: first["week"] });
  while (api.step() !== null) { /* the next week */ }
  const state = api.loaded_state();
  const g = state["games"][first["event_id"]];
  assert(g["played"], "the FCS game was not played");
  fslug = g["home"] in FICT ? g["home"] : g["away"];
  // an injury on the stand-in's roster, as the sim writes one, so the injury report has something to leak
  if (!Object.keys((state["injuries"] || {})[fslug] || {}).length) {
    const p = season.load_teams()[fslug]["offense"][0];
    ((state["injuries"] ||= {})[fslug] ||= {})[`${p["name"]}|${p["position"]}`] = { name: p["name"], position: p["position"], type: "Ankle",
      weeks: 3, weeks_left: 3, since_week: first["week"], event_id: g["event_id"] };
    api._save_loaded();
  }
  assert(state["season_stats"][fslug], "the stand-in kept no season stats, so the pages could not leak them");
  for (const path of ["injuries", "stats/teams", "stats/leaders?n=25", "awards", "standings", "resume", "review", "recruiting", "classes",
    `week/${first["week"]}`, "schedule/smu", "news", "programs", "preview"]) {
    clean(path, api.call("GET", `${base}/${path}`));
  }
  for (const cat of Object.keys(season.PLAYER_CATEGORIES)) clean(`player stats ${cat}`, api.call("GET", `${base}/stats/players?cat=${cat}&limit=10000`));
  const view = api.call("GET", base);
  clean("season", view);
  equal(view["injury_count"], api.call("GET", `${base}/injuries`)["injuries"].length);       // the league's count is FBS players only
});

test("the team list flags the stand-ins, so every picker can leave them out", () => {
  for (const c of api.call("GET", "/api/teams")["teams"]) equal(Boolean(c["fictional"]), c["slug"] in FICT, c["slug"]);
});

test("a page of a stand-in itself is refused, and a career cannot start at one", () => {
  const pname = season.load_teams()[fslug]["offense"][0]["name"];
  assert(refused(() => api.call("GET", `${base}/depth/${fslug}`)).includes("FCS stand-in"));
  for (const path of [`player?team=${fslug}&name=${encodeURIComponent(pname)}`, `depth/${fslug}/position/QB`, `stats/players?team=${fslug}&cat=passing`,
    `stats/leaders?team=${fslug}`, `injuries?team=${fslug}`, `rivalries?team=${fslug}`, `resume?team=${fslug}`, `schedule/${fslug}`, `preview?team=${fslug}`]) {
    try { refused(() => api.call("GET", `${base}/${path}`)); } catch (e) { throw new Error(`${path}: ${e.message}`); }
  }
  refused(() => api.call("POST", "/api/season", { team: fslug, seed: 1 }));
  // FBS teams still answer
  assert(api.call("GET", `${base}/depth/smu`));
  assert(api.call("GET", `${base}/stats/players?team=smu&cat=passing`)["players"].length);
});

test("the box score of a game against a stand-in still has both sides", () => {
  const box = JSON.stringify(api.call("GET", `${base}/game/${first["event_id"]}`));
  const t = season.load_teams()[fslug];
  assert([...t["offense"], ...t["defense"]].some((p) => box.includes(p["name"])), "the box score lost the stand-in's players");
});

await run();
