// A stale offseason click. Every offseason action the page sends carries the stage the page had drawn. When that is
// not the offseason's stage any more (an Advance landed first, a double click, or the season rolled over) the call is
// refused with "The offseason has moved on: this was for {stage}." and changes nothing; without a stage an older
// caller works as before. Without this, a slow page's second click advanced two stages or acted on the wrong step.
// `node tests/test_offseason_stale.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random, sorted, json_dumps } from "../engine_js/pyrt.js";

const game = await start({ env: { SIM_WORKERS: "1", CFP_SEASONS_DIR: "data/seasons-stale-test" } });
const { api, season } = game;
const ME = "ohio-state";

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

let SID = null;
const post = (what, body) => api.call("POST", `/api/season/${SID}/offseason/${what}`, body);
const snapshot = () => { const st = api.loaded_state(); return json_dumps([st["offseason"] ?? null, st["league"]["teams"][ME]["roster"]], { sort_keys: true }); };

/** The call is a 409 naming the stage it was for, and the offseason and your roster are exactly as they were. */
function refused(what, body, stage_name) {
  const before = snapshot();
  let err = null;
  try { post(what, body); } catch (e) { if (!(e instanceof api.ApiError)) throw e; err = e; }
  assert(err, `${what} with stage ${body["stage"]} went through`);
  equal([err.status, err.message], [409, `The offseason has moved on: this was for ${stage_name}.`]);
  assert(snapshot() === before, `a refused ${what} changed the offseason or the roster`);
}

let e0 = null, p0 = null;
test("an action sent with the stage the offseason is at works", () => {
  SID = api.call("POST", "/api/season", { team: ME, mode: "full", seed: 5, career: true })["id"];
  finished(api.loaded_state()); api._save_loaded();
  equal(api.call("GET", `/api/season/${SID}/offseason`)["stage"], "retention");
  const ret = api.loaded_state()["offseason"]["retention"]["players"];
  assert(ret.length, "this seed has a leaver to talk to");
  e0 = ret[0];
  const v = post("retain", { pid: e0["id"], action: "meet", stage: "retention" });
  assert(v["retention"]["players"].find((e) => e["id"] === e0["id"])["ask"]["known"]);
  // a redshirt call for a player who is not leaving (one who leaves at Keep Them Home drops off the redshirt list)
  const talks = new Set(ret.map((e) => e["id"]));
  p0 = { ...v["redshirts"]["players"].find((p) => !talks.has(p["id"])) };
  assert(p0["id"], "this seed has a redshirt call for a player who is not leaving");
});

test("an action for a stage the offseason is not at is refused and changes nothing", () => {
  refused("redshirt", { pid: p0["id"], on: !p0["redshirt"], stage: "departures" }, "Departures");
  refused("redshirt", { pid: p0["id"], on: true, stage: "nonsense" }, "an earlier stage");
});

test("a double-clicked Advance moves one stage: the second click is refused", () => {
  const v = post("advance", { stage: "retention" });
  equal(v["stage"], "departures");
  const here = new Set(api.loaded_state()["league"]["teams"][ME]["roster"].map((c) => c["id"]));
  const calls = v["redshirts"]["players"].map((p) => p["id"]);
  assert(calls.includes(p0["id"]) && calls.every((id) => here.has(id)), "a redshirt call is left for a player who went at Keep Them Home");
  refused("advance", { stage: "retention" }, "Keep Them Home");
  refused("retain", { pid: e0["id"], action: "promise", stage: "retention" }, "Keep Them Home");
  equal(api.loaded_state()["offseason"]["stage"], "departures");
});

test("at the right stage an action works with its stage and, for an older caller, without one", () => {
  const flag = (v) => v["redshirts"]["players"].find((p) => p["id"] === p0["id"])["redshirt"];
  equal(flag(post("redshirt", { pid: p0["id"], on: !p0["redshirt"], stage: "departures" })), !p0["redshirt"]);
  equal(flag(post("redshirt", { pid: p0["id"], on: p0["redshirt"] })), p0["redshirt"]);
  refused("redshirt", { pid: p0["id"], on: !p0["redshirt"], stage: "retention" }, "Keep Them Home");
});

test("after the next Advance every kind of offseason action left over from the old stage is refused", () => {
  equal(post("advance", { stage: "departures" })["stage"], "portal_w1");
  refused("advance", { stage: "departures" }, "Departures");
  refused("redshirt", { pid: p0["id"], on: !p0["redshirt"], stage: "departures" }, "Departures");
  refused("position", { pid: p0["id"], pos: "QB", stage: "departures" }, "Departures");
  for (const [what, body] of [["portal", { pid: "x", on: true }], ["review", { action: "accept" }], ["job", { team: null }],
    ["hire", { staff_id: "x", index: 0 }], ["open_role", { staff_id: "x" }]]) {
    refused(what, { ...body, stage: "departures" }, "Departures");
  }
  equal(api.loaded_state()["offseason"]["stage"], "portal_w1");
});

// Sim to Next Season, then a click left over from the offseason: refused cleanly, and no offseason opens on the new season
test("once the season has rolled over, a click from the offseason is refused and the new season is untouched", () => {
  const r = post("advance", { to: "next_season", stage: "portal_w1" });
  equal(r["next_season"], true);
  let st = api.loaded_state();
  assert(!st["done"] && !st["offseason"]);
  const roster = json_dumps(st["league"]["teams"][ME]["roster"]);
  for (const [what, body] of [["redshirt", { pid: p0["id"], on: true, stage: "portal_w1" }], ["advance", { stage: "portal_w1" }],
    ["advance", { to: "next_season", stage: "ready" }]]) {
    let err = null;
    try { post(what, body); } catch (e) { if (!(e instanceof api.ApiError)) throw e; err = e; }
    assert(err && [404, 409].includes(err.status) && err.message.includes("moved on"), `${what}: ${err && err.message}`);
  }
  // an older caller (no stage) gets the old answer
  let err = null;
  try { post("advance", {}); } catch (e) { err = e; }
  assert(err instanceof api.ApiError && err.status === 409 && err.message === "the season is not over", err && err.message);
  st = api.loaded_state();
  assert(!st["offseason"] && json_dumps(st["league"]["teams"][ME]["roster"]) === roster);
});

await run();
