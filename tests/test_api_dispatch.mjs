// The game's API (app_js/api.js), the one door the page uses: routing and refusals, a career made, read, listed,
// deleted, exported and imported, coaches saved, a run of weeks played a step at a time (pause, a failure, game day),
// and every route the page calls registered. (The offseason rolling over year after year: tests/test_api_rollover.mjs.)
// `node tests/test_api_dispatch.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";

// a saves folder of the test's own: the list and delete-all routes must see only what this test made
const game = await start({ env: { SIM_WORKERS: "1", CFP_SEASONS_DIR: "data/seasons-api-test" } });
const { api, season, coaches, files } = game;

/** `fn` must be refused with this HTTP status. */
function refused(fn, code) {
  try { fn(); } catch (e) {
    if (!(e instanceof api.ApiError)) throw e;
    assert(e.status === code, `expected ${code}, got ${e.status}: ${e.message}`);
    return;
  }
  throw new Error(`expected ${code}`);
}

const career = (seed = 11) => api.call("POST", "/api/season", { team: "smu", seed, career: true });
const wipe = () => { api.call("DELETE", "/api/seasons"); api.changed(); };

test("an unknown path is a 404 and a known path with the wrong method a 405", () => {
  refused(() => api.call("GET", "/api/nothing"), 404);
  refused(() => api.call("DELETE", "/api/teams"), 405);
});

test("the team picker's routes and the coach page's option lists answer", () => {
  assert(api.call("GET", "/api/teams")["teams"].some((t) => t["slug"] === "smu"));
  equal(api.call("GET", "/api/teams/smu")["slug"], "smu");
  refused(() => api.call("GET", "/api/teams/nope"), 404);
  const opts = api.call("GET", "/api/coach-options");
  for (const k of ["archetypes", "offense_schemes", "defense_schemes"]) assert(Object.keys(opts[k]).length, k);
  assert(opts["blank"]);
});

test("a career is created, read, listed and deleted, and each write is reported once by changed()", () => {
  const s = career();
  assert(s["career"] && api.changed() && !api.changed());
  assert(api.loaded_state()["id"] === s["id"] && api.job()["status"] === "idle");
  equal(api.call("GET", `/api/season/${s["id"]}`)["id"], s["id"]);
  const cards = api.call("GET", "/api/seasons")["seasons"];
  equal(cards.map((c) => c["id"]), [s["id"]]);
  assert(api.call("DELETE", `/api/season/${s["id"]}`)["deleted"]);
  assert(api.changed());
  equal(api.call("GET", "/api/seasons")["seasons"], []);
  assert(api.loaded_state() === null);
  refused(() => api.call("GET", `/api/season/${s["id"]}`), 404);
  refused(() => api.call("DELETE", `/api/season/${s["id"]}`), 404);
});

test("a bad request to start a career is refused and writes nothing", () => {
  refused(() => api.call("POST", "/api/season", { team: "nope", career: true }), 404);
  refused(() => api.call("POST", "/api/season", { career: true }), 422);
  refused(() => api.call("POST", "/api/season", { team: "smu", mode: "remaining", career: true }), 400);
  refused(() => api.call("POST", "/api/season", { team: "smu", seed: "eleven" }), 422);
  refused(() => api.call("POST", "/api/season", { team: "smu", coach: "000000000000" }), 404);
  assert(!api.changed());
});

test("every season is a career, whatever the request's career flag says; delete-all removes them", () => {
  const s = api.call("POST", "/api/season", { team: "smu", seed: 11, career: false });
  assert(s["career"]);
  assert(api.call("DELETE", "/api/seasons")["removed"] === 1 && api.changed());
  equal(api.call("GET", "/api/seasons")["seasons"], []);
});

test("a career exported as a save file imports back as the same career", () => {
  const s = career();
  const blob = api.call("GET", `/api/season/${s["id"]}/export?full=true`);
  assert(blob instanceof Uint8Array && blob[0] === 0x1f && blob[1] === 0x8b, "the save file is gzip");
  refused(() => api.call("GET", `/api/season/${s["id"]}/export?full=maybe`), 422);
  api.call("DELETE", `/api/season/${s["id"]}`);
  api.changed();
  const back = api.call("POST", "/api/season/import", blob);
  assert(back["id"] === s["id"] && api.changed());
  equal(api.loaded_state()["id"], s["id"]);
  refused(() => api.call("POST", "/api/season/import", new TextEncoder().encode("not a save")), 400);
  refused(() => api.call("POST", "/api/season/import", new Uint8Array(api.MAX_SAVE_BYTES + 1)), 413);
  wipe();
});

// an id with an encoded slash or dots must never reach a file outside the saves folder
test("an id that points outside the saves folder is a 404 and touches nothing", () => {
  const outside = `${season.SEASONS_DIR}-outside`;
  const name = outside.split("/").pop();
  files.write_text(`${outside}/victim.json`, "{}");
  files.write_text(`${outside}/victim/box.json`, "{}");
  api.changed();
  try {
    const sneaky = `..%2F${name}%2Fvictim`;
    for (const [method, path] of [["GET", `/api/season/${sneaky}`], ["DELETE", `/api/season/${sneaky}`],
      ["GET", `/api/season/${sneaky}/export`], ["GET", "/api/season/.."], ["DELETE", "/api/season/%2E%2E"],
      ["GET", "/api/coaches/..%5Cx"]]) {
      refused(() => api.call(method, path), 404);
    }
    assert(files.exists(`${outside}/victim.json`) && files.exists(`${outside}/victim/box.json`) && !api.changed());
  } finally {
    files.remove_dir(outside);
  }
});

test("a custom coach is saved, read, listed and deleted", () => {
  const c = api.call("POST", "/api/coaches", { coach: { ...coaches.blank(), first_name: "Pat", last_name: "Day" } });
  assert(api.changed());
  equal(api.call("GET", `/api/coaches/${c["id"]}`)["last_name"], "Day");
  assert(api.call("GET", "/api/coaches")["coaches"].some((x) => x["id"] === c["id"]));
  refused(() => api.call("POST", "/api/coaches", { coach: { first_name: "Pat" } }), 400);
  refused(() => api.call("POST", "/api/coaches", {}), 422);
  assert(api.call("DELETE", `/api/coaches/${c["id"]}`)["deleted"]);
  assert(api.changed());
  refused(() => api.call("GET", `/api/coaches/${c["id"]}`), 404);
  refused(() => api.call("DELETE", "/api/coaches/not-an-id"), 404);
});

test("an advance is played a week per step, reports its stages, and a second advance is refused while it runs", () => {
  const s = career();
  const r = api.call("POST", `/api/season/${s["id"]}/advance`, { to: 2 });
  equal([r["status"], r["done"], r["total"]], ["running", 0, 2]);
  refused(() => api.call("POST", `/api/season/${s["id"]}/advance`, {}), 409);
  const seen = [];
  let st = api.step((m) => seen.push(m));
  assert(st["status"] === "running" && st["done"] === 1 && api.changed());
  assert(seen.some((m) => m.includes('"stage"')), "no progress report named a stage");
  st = api.step();
  assert(st["status"] === "idle" && st["done"] === 2 && api.loaded_state()["current_week"] === 2);
  assert(api.step() === null);
  assert(api.call("GET", `/api/season/${s["id"]}/status?since=0`)["results"].length);
  wipe();
});

// Pause lands between steps: week 1 is over, so week 2 never starts and the run ends at done == 1.
test("a pause stops the run before the next week", () => {
  const s = career();
  api.call("POST", `/api/season/${s["id"]}/advance`, { to: 4 });
  api.step();
  assert(api.call("POST", `/api/season/${s["id"]}/pause`)["stopping"]);
  const st = api.step();
  assert(st["status"] === "idle" && st["paused"] && st["done"] === 1);
  equal(api.loaded_state()["current_week"], 1);
  const again = api.call("POST", `/api/season/${s["id"]}/pause`);
  assert(again["status"] === "idle" && again["stopping"] === false);
  wipe();
});

// Your staff run your recruiting week for every week after the first of a multi-week advance (with Auto-Recruit
// off), never for the first: the first week is the one you just set up by hand.
test("a multi-week advance runs your recruiting from its second week, not its first", () => {
  const s = career();
  const rc = api.loaded_state()["recruiting"];
  assert(api.loaded_state()["career"]["settings"]["auto_recruit"] === false && !rc["board"].length);
  api.call("POST", `/api/season/${s["id"]}/advance`, { to: 3 });
  api.step();
  assert(!api.loaded_state()["recruiting"]["board"].length && !(api.loaded_state()["recruiting"]["offers"]["smu"] || []).length, "week 1 ran your recruiting");
  api.step();
  assert(api.loaded_state()["recruiting"]["board"].length, "week 2 of the advance did not run your recruiting");
  api.step();
  wipe();
});

test("while a run is in progress an import, another season and a new season are refused; status still answers", () => {
  const other = career(12);
  const s = career(11);
  const blob = api.call("GET", `/api/season/${s["id"]}/export`);
  api.call("POST", `/api/season/${s["id"]}/advance`, {});
  refused(() => api.call("POST", "/api/season/import", blob), 409);
  refused(() => api.call("GET", `/api/season/${other["id"]}`), 409);
  refused(() => api.call("POST", "/api/season", { team: "smu", seed: 13 }), 409);
  equal(api.call("GET", `/api/season/${s["id"]}/status`)["status"], "running");   // the page polls while running
  equal(api.loaded_state()["id"], s["id"]);
  api.step();
  equal(api.call("GET", `/api/season/${other["id"]}`)["id"], other["id"]);
  wipe();
});

// JSON.parse in the page rejects NaN: the reply says so instead of the page dying on it
test("a reply holding NaN is a 500 with a message, and the dispatcher carries on", () => {
  api.ROUTES.push(["GET", "/api/test-nan", () => ({ x: NaN })]);
  try {
    const r = JSON.parse(api.call_js("GET", "/api/test-nan", null));
    assert(r["ok"] === false && r["status"] === 500 && r["message"].includes("JSON"), JSON.stringify(r));
    assert(JSON.parse(api.call_js("GET", "/api/teams/smu", null))["ok"]);
  } finally {
    api.ROUTES.pop();
  }
  const bad = JSON.parse(api.call_js("POST", "/api/coaches", "{not json"));
  assert(bad["ok"] === false && bad["status"] === 400, "invalid JSON in a body is a 400");
  const missing = JSON.parse(api.call_js("GET", "/api/nothing", null));
  assert(missing["ok"] === false && missing["status"] === 404);
});

// advance throws mid-week: the job says "error" and where, the season in memory is the last save again (nothing
// half-advanced can be written by the next handler) and reads still answer
test("a week that breaks is dropped: the season goes back to its last save and the error says where", () => {
  const s = career();
  api.call("POST", `/api/season/${s["id"]}/advance`, { to: 2 });
  const real = game.modules.season.advance;
  game.modules.season.advance = function broken(state) {
    state["current_week"] = 7;            // half of a week, then the crash
    throw new Error("the sim broke");
  };
  let st;
  try { st = api.step(); } finally { game.modules.season.advance = real; }
  assert(st["status"] === "error" && st["stage"] === null, JSON.stringify([st["status"], st["stage"]]));
  assert(/^the sim broke \(.*broken.*, test_api_dispatch\.mjs:\d+\)$/.test(st["error"]), st["error"]);   // the toast says where
  assert(st["current_week"] === 0 && st["done"] === 0);
  assert(api.loaded_state()["current_week"] === 0 && api.job()["status"] === "error");
  assert(api.step() === null && !api.running());
  equal(api.call("GET", `/api/season/${s["id"]}`)["current_week"], 0);
  equal(api.call("GET", `/api/season/${s["id"]}/status`)["status"], "error");
  api.call("POST", `/api/season/${s["id"]}/settings`, { god_mode: true });     // a handler that saves writes the last save, not the broken week
  equal(season.load_season(s["id"])["current_week"], 0);
  wipe();
});

test("game day plays only your game as a step of its own; it is refused in a bye week", () => {
  const s = career();
  refused(() => api.call("POST", `/api/season/${s["id"]}/gameday`), 409);   // SMU has a bye in week 1
  api.call("POST", `/api/season/${s["id"]}/advance`, {});
  api.step();
  const r = api.call("POST", `/api/season/${s["id"]}/gameday`);
  equal([r["status"], r["done"], r["total"]], ["running", 1, 2]);
  const st = api.step();
  assert(st["status"] === "idle" && st["gameday_event"] && st["current_week"] === 1);
  assert(api.loaded_state()["games"][st["gameday_event"]]["played"] && api.step() === null);
  wipe();
});

// what ui/src calls: a route dropped or renamed breaks a page silently, so the list is held here
const EXPECTED = [
  ["GET", "/api/season/{season_id}/week/{week}"], ["GET", "/api/season/{season_id}/schedule/{slug}"],
  ["GET", "/api/season/{season_id}/schedule_edit"], ["POST", "/api/season/{season_id}/schedule_edit"],
  ["POST", "/api/season/{season_id}/redshirt"], ["GET", "/api/season/{season_id}/standings"],
  ["GET", "/api/season/{season_id}/position_options/{slug}/{player}"], ["POST", "/api/season/{season_id}/position"],
  ["GET", "/api/season/{season_id}/review"], ["GET", "/api/season/{season_id}/resume"],
  ["GET", "/api/season/{season_id}/game/{event_id}"], ["GET", "/api/season/{season_id}/settings"],
  ["POST", "/api/season/{season_id}/settings"], ["GET", "/api/season/{season_id}/recruiting"],
  ["GET", "/api/season/{season_id}/programs"], ["GET", "/api/season/{season_id}/recruiting/report"],
  ["GET", "/api/season/{season_id}/prospects"], ["GET", "/api/season/{season_id}/classes"],
  ["GET", "/api/season/{season_id}/prospect/{pid}"], ["POST", "/api/season/{season_id}/recruit"],
  ["POST", "/api/season/{season_id}/board"], ["POST", "/api/season/{season_id}/staff"],
  ["GET", "/api/season/{season_id}/scouting"],
  ["GET", "/api/season/{season_id}/offseason"], ["POST", "/api/season/{season_id}/offseason/advance"],
  ["POST", "/api/season/{season_id}/offseason/portal"], ["POST", "/api/season/{season_id}/offseason/redshirt"],
  ["GET", "/api/season/{season_id}/offseason/position_options"], ["POST", "/api/season/{season_id}/offseason/position"],
  ["POST", "/api/season/{season_id}/offseason/retain"], ["POST", "/api/season/{season_id}/offseason/review"],
  ["POST", "/api/season/{season_id}/offseason/job"], ["POST", "/api/season/{season_id}/offseason/hire"],
  ["POST", "/api/season/{season_id}/offseason/open_role"], ["POST", "/api/season/{season_id}/player/edit"],
  ["GET", "/api/season/{season_id}/preview"], ["GET", "/api/season/{season_id}/rivalries"],
  ["GET", "/api/season/{season_id}/stats/teams"], ["GET", "/api/season/{season_id}/stats/leaders"],
  ["GET", "/api/season/{season_id}/stats/players"], ["GET", "/api/season/{season_id}/depth/{slug}"],
  ["POST", "/api/season/{season_id}/depth/{slug}"], ["GET", "/api/season/{season_id}/depth/{slug}/position/{role}"],
  ["GET", "/api/season/{season_id}/depth/{slug}/formations"], ["GET", "/api/season/{season_id}/depth/{slug}/roster"],
  ["GET", "/api/season/{season_id}/injuries"], ["GET", "/api/season/{season_id}/awards"],
  ["GET", "/api/season/{season_id}/player"],
  ["POST", "/api/league/check"], ["POST", "/api/season"], ["GET", "/api/season/{season_id}/teams"],
];

test("every route the page calls is registered", () => {
  const have = new Set([...api.routes()].map((r) => `${r[0]} ${r[1]}`));
  const missing = EXPECTED.map((r) => `${r[0]} ${r[1]}`).filter((r) => !have.has(r));
  equal(missing, []);
});

test("every read the season page makes answers on a new career, and bad parameters are refused", () => {
  const s = career();
  const base = `/api/season/${s["id"]}`;
  equal(api.call("GET", `${base}/week/1`)["week"], 1);
  refused(() => api.call("GET", `${base}/week/one`), 422);
  assert(api.call("GET", `${base}/schedule/smu`));
  refused(() => api.call("GET", `${base}/schedule/nope`), 404);
  assert("games" in api.call("GET", `${base}/schedule_edit`));
  assert(api.call("GET", `${base}/standings`)["standings"]);
  for (const path of ["review", "resume", "resume?team=smu", "programs", "recruiting/report", "scouting", "classes?school=smu", "preview",
    "rivalries", "stats/teams", "stats/leaders?n=99", "stats/players?cat=rushing&limit=10", "depth/smu",
    "depth/smu/position/QB", "depth/smu/formations", "depth/smu/roster", "injuries", "awards", "recruiting", "settings", "teams", "news"]) {
    const out = api.call("GET", `${base}/${path}`);
    assert(out !== null && typeof out === "object" && !Array.isArray(out), path);
  }
  refused(() => api.call("GET", `${base}/stats/players?cat=nothing`), 400);
  refused(() => api.call("GET", `${base}/depth/smu/position/XX`), 404);
  refused(() => api.call("GET", `${base}/game/nope`), 404);
  refused(() => api.call("GET", `${base}/player`), 422);
  refused(() => api.call("GET", `${base}/offseason`), 409);         // the season is not over
  wipe();
});

test("a player edit needs God Mode; a depth chart change needs a role and every player at it", () => {
  const s = career();
  const base = `/api/season/${s["id"]}`;
  const slug = api.call("GET", "/api/teams/smu")["players"].find((pl) => pl["slug"])["slug"];
  assert(api.call("GET", `${base}/player?team=smu&slug=${slug}`));
  refused(() => api.call("POST", `${base}/player/edit`, { team: "smu", player: slug, changes: { jersey: 99 } }), 403);
  api.changed();
  assert(api.call("POST", `${base}/settings`, { god_mode: true })["settings"]["god_mode"] && api.changed());
  refused(() => api.call("POST", `${base}/player/edit`, { team: "smu", player: slug }), 422);
  api.call("POST", `${base}/player/edit`, { team: "smu", player: slug, changes: { jersey: 99 } });
  api.flush();
  assert(api.changed() && season.load_season(s["id"])["settings"]["god_mode"]);
  refused(() => api.call("POST", `${base}/depth/smu`, { move: "up" }), 400);
  const wr = api.call("GET", `${base}/depth/smu/position/WR`)["current"];
  refused(() => api.call("POST", `${base}/depth/smu`, { order: wr }), 400);                           // no role
  refused(() => api.call("POST", `${base}/depth/smu`, { role: "WR", order: wr.slice(0, -1) }), 400);  // a player missing
  assert(api.call("POST", `${base}/depth/smu`, { role: "WR", order: [...wr].reverse() })["overridden"]);
  assert(api.call("POST", `${base}/depth/smu`, { reset: true }));
  api.flush();
  assert(api.changed());
  wipe();
});

await run();
