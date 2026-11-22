// A transfer-portal entrant's Prospect Profile (prospects.profile through app_js/api.js). The portal's
// recruiting block shares its year with the class it replaces, so a cache keyed by the year alone
// served the class's ranks to the portal and the profile failed with a KeyError on the entrant's id.
// Also checks the next class's profile after the portal, and a former recruit (r20xx id) in the
// second offseason's portal.
// `node tests/test_portal_profile.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random, sorted } from "../engine_js/pyrt.js";

const game = await start();
const { season, api } = game;
const { prospects } = game.modules;

/** Every game played (the better team usually wins), every school's class signed, season over (tests/test_offseason). */
function finished(st) {
  const rng = new Random(1);
  const teams = season.load_teams();
  for (const g of Object.values(st["games"])) {
    const h = teams[g["home"]]["team_ratings"]["overall"], a = teams[g["away"]]["team_ratings"]["overall"];
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

const G = (sid, path) => api.call("GET", `/api/season/${sid}/${path}`);

function to_portal(sid) {
  finished(api.loaded_state()); api._save_loaded();
  G(sid, "offseason");
  while (api.loaded_state()["offseason"]["stage"] !== "portal_w1") api.call("POST", `/api/season/${sid}/offseason/advance`, {});
}

function fresh_ranks(pid) {
  prospects._RANKS = [null, {}];
  return prospects._ranks(api.loaded_state())[pid];
}

/** His profile opens, and its ranks are those of the block he is in (not a cached one). */
function check(sid, pid) {
  const pub = G(sid, `prospect/${pid}`)["public"];
  assert(pub["id"] === pid);
  equal([pub["position_rank"], pub["state_rank"]], [...fresh_ranks(pid)], pid);
}

test("portal profile", () => {
  try {
    const sid = api.call("POST", "/api/season", { team: "ohio-state", mode: "full", seed: 11, career: true })["id"];
    const first = G(sid, "prospects?limit=1")["rows"][0]["id"];
    G(sid, `prospect/${first}`);                    // the class's ranks are worked out (and cached)
    to_portal(sid);
    const rows = G(sid, "prospects?limit=50")["rows"];
    assert(rows.length && rows.every((r) => r["id"] in api.loaded_state()["recruiting"]["prospects"]));
    check(sid, rows[0]["id"]);                      // was KeyError: the class's cached ranks
    // past the portal: the next class's profile works and carries its own ranks
    const r = api.call("POST", `/api/season/${sid}/offseason/advance`, { to: "next_season" });
    assert(r["next_season"]);
    const nxt = G(sid, "prospects?limit=1")["rows"][0]["id"];
    assert(nxt !== first);
    G(sid, `prospect/${nxt}`);
    check(sid, nxt);
    // the next offseason's portal: a former recruit (his player id is his recruit id)
    to_portal(sid);
    const ids = G(sid, "prospects?limit=1000")["rows"].map((x) => x["id"]);
    const former = ids.filter((p) => p.startsWith("r20"));
    assert(former.length, "seed 11 puts former recruits in the second portal");
    for (const pid of former.slice(0, 3)) check(sid, pid);
  } finally {
    season.close_pool();
  }
  console.log("ok");
});

await run();
