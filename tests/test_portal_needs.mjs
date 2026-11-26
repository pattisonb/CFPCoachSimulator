// Your Needs in the transfer portal (the player's report: the hover said "0 committed" with a high school class
// signed). In the portal your signed class sits on next year's roster, so the needs name them apart: each group says
// how many signed from high school, how many return, and the transfer commits.
// `node tests/test_portal_needs.mjs`
import { start, test, run, assert } from "./harness.mjs";
import { Random, sorted } from "../engine_js/pyrt.js";

const game = await start();
const { api, season, recruiting } = game;

const ME = "ohio-state";

/** Every game played (the better team usually wins), every school's class signed, season over (tests/test_offseason's). */
function finished(st) {
  const rng = new Random(1);
  const teams = season.load_teams();
  for (const g of Object.values(st["games"])) {
    const h = teams[g["home"]]["team_ratings"]["overall"], a = teams[g["away"]]["team_ratings"]["overall"];
    const hs = rng.randint(10, 45);
    const win = rng.random() < 1 / (1 + Math.pow(10, (a - h) / 7));
    const home_score = win ? hs : Math.max(0, hs - rng.randint(1, 20));
    const away_score = win ? hs - rng.randint(1, 20) : hs;
    Object.assign(g, { played: true, home_score, away_score });
    if (g["home_score"] === g["away_score"]) g["home_score"] += 3;
  }
  const rc = st["recruiting"];
  const schools = Object.keys(teams).filter((s) => !teams[s]["fictional"]);
  const pids = sorted(Object.keys(rc["prospects"]), (p) => rc["prospects"][p]["rank"]);
  pids.slice(0, schools.length * 21).forEach((pid, i) => { rc["status"][pid]["signed"] = schools[i % schools.length]; });
  Object.assign(st, { done: true, current_week: season.FINAL_WEEK, champion: "ohio-state" });
}

const G = (sid, path) => api.call("GET", `/api/season/${sid}/${path}`);

/** The season finished and the offseason walked to the portal's first week (tests/test_portal_profile's). */
function to_portal(sid) {
  finished(api.loaded_state()); api._save_loaded();
  G(sid, "offseason");
  while (api.loaded_state()["offseason"]["stage"] !== "portal_w1") api.call("POST", `/api/season/${sid}/offseason/advance`, {});
}

test("test_signees_named_in_the_portal", () => {
  const sid = api.call("POST", "/api/season", { team: ME, mode: "full", seed: 11, career: true })["id"];
  to_portal(sid);
  const st = api.loaded_state();
  assert(recruiting.is_portal(st));
  const last = st["recruiting_last"];
  const signed = Object.entries(last["status"]).filter(([, s]) => (s["signed"] ?? null) === ME).map(([pid]) => pid);
  assert(signed.length, "the class signed someone");
  const nd = recruiting.needs_detail(st, ME);
  const total = Object.values(nd).reduce((n, r) => n + r["signees"], 0);
  assert(Object.values(nd).every((r) => r["portal"]));
  assert(total > 0 && total <= signed.length, () => JSON.stringify([total, signed.length]));
  for (const [g, r] of Object.entries(nd)) assert(0 <= r["signees"] && r["signees"] <= r["back"], () => JSON.stringify([g, r]));
});

test("test_season_needs_unchanged", () => {
  api.call("POST", "/api/season", { team: ME, mode: "full", seed: 11, career: true });
  const st = api.loaded_state();
  const nd = recruiting.needs_detail(st, ME);
  assert(Object.values(nd).every((r) => !("signees" in r) && !("portal" in r)), "the season's needs read as before");
});

process.on("exit", (code) => { if (code === 0) console.log("portal needs ok: the portal's needs name your signed high school class apart from who returns"); });
await run();
