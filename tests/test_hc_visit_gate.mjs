// The once-a-month in-home visit counts only visits that happened (the player's report: a Legacy recruit's visit
// broke before it opened, and the next try said he had been visited this month, though he never had a visit). And an
// action that breaks partway leaves no half-done change: the season in memory is dropped and the saved file read again.
// `node tests/test_hc_visit_gate.mjs`
import { start, test, run, assert, raises } from "./harness.mjs";

const game = await start();
const { api, recruiting } = game;
const prospects = game.modules.prospects;

const ME = "smu";

function fresh() {
  const sid = api.call("POST", "/api/season", { team: ME, seed: 23 })["id"];
  const st = api.loaded_state();
  const rc = st["recruiting"];
  rc["hours"][ME] = 500;
  const pid = recruiting.prospect_list(st).find((q) => !rc["prospects"][q]["hidden"] && !(ME in (rc["contacts"][q] || {}))
    && !recruiting.would_pester(st, ME, q));
  return [sid, st, pid];
}

test("test_broken_visit_does_not_count", () => {
  const [sid, st, pid] = fresh();
  const rc = st["recruiting"], week = st["current_week"];
  // what a visit that broke before its scene opened left behind: the mark and a bare contact line
  recruiting._contact(st, ME, pid)["hc_week"] = week;
  recruiting._event(st, "contact", pid, ME, { action: "hc_visit" });
  assert(recruiting.hc_visit_week(st, ME, pid) === null);
  assert(prospects.board_row(st, pid, ME)["hc_week"] === null, "the menu offers the visit");
  const sc = recruiting.act(st, ME, pid, "hc_visit")["scene"];          // it opens now
  assert(sc && sc["action"] === "hc_visit");
  assert(recruiting.hc_visit_week(st, ME, pid) === week, "an open visit counts");
});

test("test_real_visits_count", () => {
  const [sid, st, pid] = fresh();
  const week = st["current_week"];
  recruiting._contact(st, ME, pid)["hc_week"] = week;
  recruiting._event(st, "present", pid, ME, { action: "hc_visit", topics: ["nil", "coach", "winning"], hit: 0 });
  assert(recruiting.hc_visit_week(st, ME, pid) === week);
  let e;
  try {
    e = raises(() => recruiting.act(st, ME, pid, "hc_visit"), recruiting.RecruitingError);
  } catch (err) {
    if (err.message === "expected an error") throw new Error("a second visit this month is refused");
    throw err;
  }
  assert(e.code === 409);
  // an AI school's mark stands (its visits log nothing)
  const other = recruiting.fbs_schools(st).find((s) => s !== ME);
  recruiting._contact(st, other, pid)["hc_week"] = week;
  assert(recruiting.hc_visit_week(st, other, pid) === week);
});

test("test_broken_action_leaves_no_change", () => {
  const [sid, st, pid] = fresh();
  api._save_loaded();

  class RuntimeError extends Error {}
  function boom(p) {
    api.loaded_state()["recruiting"]["hours"][ME] = 1;      // a change made, then a bug
    throw new RuntimeError("a bug partway through");
  }
  api.ROUTES.unshift(["POST", "/api/season/{season_id}/boom", boom]);
  try {
    try {
      api.call("POST", `/api/season/${sid}/boom`, {});
    } catch (e) {
      if (!(e instanceof RuntimeError)) throw e;
    }
    const st2 = api._season_state(sid);
    assert(st2["recruiting"]["hours"][ME] === 500, "the half-done change is gone: the saved file was read again");
  } finally {
    api.ROUTES.shift();
  }
});

await run();
