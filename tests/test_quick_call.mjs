// Quick calls and the one head coach visit (the player's ask: calling and pitching over and over gets old). After a
// recruit's first call, Call is a quick check-in: it spends the hours for a slight boost (QUICK_CALL of a call's base) and
// opens no conversation (the menu offers only this call after the first). Your head coach visits a recruit once.
// `node tests/test_quick_call.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { get } from "../engine_js/pyrt.js";

const game = await start();
const { api, recruiting } = game;
const { prospects } = game.modules;

const ME = "smu";

function fresh() {
  api.call("POST", "/api/season", { team: ME, seed: 29 });
  const st = api.loaded_state();
  const rc = st["recruiting"];
  rc["hours"][ME] = 500;
  const pid = recruiting.prospect_list(st).find((q) => !get(rc["prospects"][q], "hidden") && !(ME in get(rc["contacts"], q, {}))
    && !recruiting.would_pester(st, ME, q));
  assert(pid !== undefined, "StopIteration");
  return [st, pid];
}

function refused(fn, words) {
  try {
    fn();
  } catch (e) {
    if (!(e instanceof recruiting.RecruitingError)) throw e;
    assert(e.code === 409 && e.message.includes(words), e.message);
    return;
  }
  throw new Error(`not refused: ${words}`);
}

test("quick call", () => {
  let [st, pid] = fresh();
  const rc = st["recruiting"];
  // a quick call needs no first conversation (the player's November 20 ask: it is the call to his high school coach)
  assert(prospects.board_row(st, pid, ME)["calls"] === 0);
  // no scene, the hours spent, a slight boost
  recruiting._contact(st, ME, pid)["calls"] = 1;
  const hours = rc["hours"][ME];
  const before = recruiting.pending(st, ME, pid);
  const r = recruiting.act(st, ME, pid, "call", undefined, undefined, undefined, "quick");
  assert(!("scene" in r) && !(pid in (get(get(rc, "scenes") || {}, ME) || {})), "a quick call opens no conversation");
  assert(rc["hours"][ME] === hours - recruiting.HOURS["call"], "it spends the call's hours");
  const gained = recruiting.pending(st, ME, pid) - before;
  assert(0 < gained && gained <= recruiting.BASE_POINTS["call"] * recruiting.QUICK_CALL * 2, () => String(gained));
  assert(prospects.board_row(st, pid, ME)["calls"] === 2);
  // once a week still
  refused(() => recruiting.act(st, ME, pid, "call", undefined, undefined, undefined, "quick"), "Done this week");

  // the head coach visits once a month (the player's November 20 ask; it was once a recruit)
  [st, pid] = fresh();
  const week = st["current_week"];
  recruiting._contact(st, ME, pid)["hc_week"] = week - 1;
  recruiting._event(st, "present", pid, ME, { action: "hc_visit", topics: ["nil", "coach", "winning"], hit: 0 });
  st["recruiting"]["log"][st["recruiting"]["log"].length - 1]["week"] = week - 1;
  assert(recruiting.hc_visit_week(st, ME, pid) === week - 1);
  refused(() => recruiting.act(st, ME, pid, "hc_visit"), "One in-home visit a month");
  // a planned quick action is sent at the week step and stays ticked for the next week (the player's ask), with its
  // energy held again; a recruit who commits is let go
  [st, pid] = fresh();
  assert(ME in st["recruiting"]["hours"]);                 // the key must be there for the delete below to mean anything
  delete st["recruiting"]["hours"][ME];
  recruiting.plan(st, pid, "message", true);
  recruiting.plan(st, pid, "call", true);
  const free = recruiting.hours_free(st, ME);
  recruiting._run_planned(st);
  assert(!(pid in recruiting.planned(st)));
  st["recruiting"]["hours"] = {};
  recruiting._carry_planned(st);
  equal([...recruiting.planned(st)[pid]].sort(), ["call", "message"], JSON.stringify(recruiting.planned(st)));
  assert(recruiting.hours_free(st, ME) === free, "the carried plans hold the new week's energy");
  recruiting._run_planned(st);
  st["recruiting"]["status"][pid]["committed"] = "texas";
  st["recruiting"]["hours"] = {};
  recruiting._carry_planned(st);
  assert(!(pid in recruiting.planned(st)), "a commit ends the carry");
  console.log("quick call ok: after a first call, Call spends the hours for a slight boost with no conversation; the head coach visits once a month");
});

await run();
