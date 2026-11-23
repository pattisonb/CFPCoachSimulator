// Roster Cuts and the fixed class (career_js/offseason/part3.js _fill_rosters and _release, part4.js cuts_view, cut_mark,
// cuts_auto and _finish_cuts; career_js/recruiting/part2.js open_spots and portal_room), through the API as the page
// calls it: your class is 25 signees and 20 transfers every year whatever room the roster has, and after Progress the
// roster comes down to the limit by your own hand. This year's signees and transfers cannot be cut; a cut is free
// but for a player you promised a starting job; a cut player walks on at a school short at his position, or is out
// of football; and the page is told where each went.
// `node tests/test_roster_cuts.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random } from "../engine_js/pyrt.js";

const game = await start();
const { api, season, recruiting } = game;
const { offseason, word } = game.modules;

const ME = "ohio-state";
const J = (v) => () => JSON.stringify(v);
const sid = api.call("POST", "/api/season", { team: ME, mode: "full", seed: 11, career: true })["id"];
const G = (p) => api.call("GET", `/api/season/${sid}/${p}`);
const R = (p, body) => api.call("POST", `/api/season/${sid}/${p}`, body);
function refused(fn, status, words = "") {
  try {
    fn();
  } catch (e) {
    assert(e instanceof api.ApiError && e.status === status && e.message.includes(words), `${e.status} ${e.message}`);
    return e;
  }
  throw new Error(`not refused (${status} ${words})`);
}

/** Every game played, every school's class signed, the season over (as tests/test_portal_recap.mjs ends one). */
function finished(state) {
  const rng = new Random(1);
  const teams = season.load_teams();
  for (const g of Object.values(state["games"])) {
    const hs = rng.randint(10, 45);
    const win = rng.random() < 0.5;
    Object.assign(g, { played: true, home_score: win ? hs : Math.max(0, hs - rng.randint(1, 20)), away_score: win ? hs - rng.randint(1, 20) : hs });
    if (g["home_score"] === g["away_score"]) g["home_score"] += 3;
  }
  const schools = Object.keys(teams).filter((s) => !teams[s]["fictional"]);
  Object.keys(state["recruiting"]["prospects"]).sort((a, b) => state["recruiting"]["prospects"][a]["rank"] - state["recruiting"]["prospects"][b]["rank"])
    .slice(0, schools.length * 21).forEach((pid, i) => { state["recruiting"]["status"][pid]["signed"] = schools[i % schools.length]; });
  Object.assign(state, { done: true, current_week: season.FINAL_WEEK, champion: ME });
}

test("your class is the same size every year: 25 signees and 20 transfers, whatever room the roster has", () => {
  const st = api.loaded_state();
  equal([recruiting.CLASS_CAP, recruiting.TRANSFER_CAP], [25, 20]);
  assert(recruiting.open_spots(st, ME) === 25, String(recruiting.open_spots(st, ME)));
  const others = Object.keys(season.load_teams()).filter((s) => s !== ME && !season.load_teams()[s]["fictional"]).slice(0, 40);
  assert(others.every((s) => recruiting.open_spots(st, s) <= 25 && recruiting.open_spots(st, s) >= recruiting.MIN_OPEN), "another school: its usual size, under the cap");
  assert(prospects_view()["open_spots"] === 25);
});
function prospects_view() { return G("recruiting"); }

let v, year, mine;

test("Roster Cuts comes after Progress; a roster over the limit cannot move on until it is cut down", () => {
  finished(api.loaded_state());
  api._save_loaded();
  v = G("offseason");
  const order = v["stages"].map((s) => s["key"] ?? s["stage"] ?? s);
  assert(JSON.stringify(order).includes("development") && JSON.stringify(order).indexOf('"cuts"') > JSON.stringify(order).indexOf('"development"')
    && JSON.stringify(order).indexOf('"cuts"') < JSON.stringify(order).indexOf('"staff"'), J(order));
  equal(offseason.STAGE_NAMES["cuts"], "Roster Cuts");
  assert(v["cuts"] === null, "nothing to cut before the stage");
  let guard = 0;
  while ((v = G("offseason"))["stage"] !== "cuts" && guard++ < 20) {
    try { R("offseason/review", { choice: "nothing" }); } catch { /* no meeting to answer */ }
    R("offseason/advance", {});
  }
  assert(v["stage"] === "cuts" && v["cuts"] && !v["cuts"]["done"]);
  const st = api.loaded_state();
  year = st["offseason"]["year"];
  // the transfer portal's room is 20 for you, whatever the roster holds
  assert(recruiting.portal_room({ ...st, recruiting: { ...st["recruiting"], portal: true } }, ME) === 20);
  // eight more returning players than the roster can carry: copies of your weakest juniors under new names
  const roster = st["league"]["teams"][ME]["roster"];
  const extra = 85 + 8 - roster.length;
  const back = roster.filter((c) => offseason._cut_protected(st, c) === null && !["SR", "SRRS"].includes(c["cls"])).sort((a, b) => a["o"] - b["o"]);
  for (let i = 0; i < extra; i++) roster.push({ ...JSON.parse(JSON.stringify(back[i % back.length])), id: `extra-${i}`, n: `Extra Player ${i}` });
  api._save_loaded();
  v = G("offseason");
  mine = v["cuts"];
  equal([mine["limit"], mine["roster"], mine["left"], mine["over"], mine["marked"].length], [85, 93, 93, 8, 0]);
  assert(mine["players"].length === 93 && mine["players"].every((p, i) => i === 0 || mine["players"][i - 1]["overall"] <= p["overall"]), "every player, weakest first");
  refused(() => R("offseason/advance", {}), 409, "8 over the limit of 85");
  assert(G("offseason")["stage"] === "cuts", "the stage holds");
});

test("this year's signees and transfers cannot be cut; anyone else is marked and unmarked", () => {
  const safe = mine["players"].filter((p) => p["protected"]);
  assert(safe.length >= 15 && safe.every((p) => ["signee", "transfer"].includes(p["protected"])), J(safe.length));
  assert(safe.filter((p) => p["protected"] === "signee").every((p) => p["cls"] === "FR" && p["gain"] === null), "a signee arrived as he is");
  refused(() => R("offseason/cut", { pid: safe[0]["id"], on: true }), 409, "this year and cannot be cut");
  refused(() => R("offseason/cut", { pid: "nobody", on: true }), 404, "not on your roster");
  const open = mine["players"].filter((p) => !p["protected"]);
  assert(open.some((p) => p["gain"] !== null), "a returning player shows what he gained");
  v = R("offseason/cut", { pid: open[0]["id"], on: true });
  equal([v["cuts"]["marked"], v["cuts"]["left"], v["cuts"]["over"]], [[open[0]["id"]], 92, 7]);
  assert(v["cuts"]["players"].find((p) => p["id"] === open[0]["id"])["marked"] === true);
  v = R("offseason/cut", { pid: open[0]["id"], on: false });
  equal([v["cuts"]["marked"], v["cuts"]["over"]], [[], 8]);
});

let promised;

test("Let the Staff Decide marks exactly enough, keeps your own marks, and never a newcomer", () => {
  const open = mine["players"].filter((p) => !p["protected"]);
  // your own mark first: a good player you promised a starting job
  promised = open[open.length - 1];
  const st = api.loaded_state();
  st["league"]["teams"][ME]["roster"].find((c) => c["id"] === promised["id"])["promised"] = year;
  api._save_loaded();
  v = R("offseason/cut", { pid: promised["id"], on: true });
  assert(v["cuts"]["players"].find((p) => p["id"] === promised["id"])["promised"] === true, "the page says he holds your promise");
  v = R("offseason/cut", { auto: true });
  const c = v["cuts"];
  equal([c["marked"].length, c["left"], c["over"]], [8, 85, 0]);
  assert(c["marked"].includes(promised["id"]), "your mark is kept");
  const by_id = Object.fromEntries(c["players"].map((p) => [p["id"], p]));
  assert(c["marked"].every((id) => by_id[id]["protected"] === null), "a newcomer was marked");
  const staff = c["marked"].filter((id) => id !== promised["id"]).map((id) => by_id[id]);
  assert(staff.every((p) => !["SR", "SRRS"].includes(p["cls"])), "the staff never lets a senior go");
  const kept = c["players"].filter((p) => !p["marked"] && !p["protected"] && !["SR", "SRRS"].includes(p["cls"]));
  assert(Math.max(...staff.map((p) => p["overall"])) <= Math.max(...kept.map((p) => p["overall"])), "the staff lets the weakest go");
});

test("the cuts are made: the roster is at the limit, a broken promise costs your word, and each cut player is told where he went", () => {
  const before = word.reading(api.loaded_state());
  const marked = [...v["cuts"]["marked"]];
  v = R("offseason/advance", {});
  assert(v["stage"] === "staff", v["stage"]);
  const st = api.loaded_state();
  const teams = st["league"]["teams"];
  const roster = teams[ME]["roster"];
  assert(roster.length <= 85 && marked.every((id) => !roster.some((c) => c["id"] === id)), String(roster.length));
  assert(Object.values(teams).every((t) => t["roster"].length <= 85), "every roster is at the limit or under");
  const c = v["cuts"];
  assert(c["done"] && c["marked"].length === 0 && c["players"].length === 0);
  equal(c["out"].map((x) => x["id"]).sort(), [...marked].sort());
  for (const x of c["out"]) {
    assert(x["name"] && x["pos"] && x["overall"] > 0 && x["promised"] === (x["id"] === promised["id"]), J(x));
    if (x["to"] === null) {                              // out of football: on no roster
      assert(x["to_name"] === null && !Object.values(teams).some((t) => t["roster"].some((p) => p["id"] === x["id"])), J(x));
      continue;
    }
    assert(x["to"] !== ME && x["to_name"] && x["to_name"] !== x["to"], J(x));
    const p = teams[x["to"]]["roster"].find((q) => q["id"] === x["id"]);
    assert(p && p["walk_on"] === true && p["cut_from"] === ME && !("promised" in p), "he walked on there");
    const last = p["life"][p["life"].length - 1];
    equal([last["kind"], last["from"], last["to"]], ["cut", ME, x["to"]]);
  }
  assert(c["out"].some((x) => x["to"] !== null), "somebody picked one of them up");
  // the one cut that costs you
  assert(word.reading(st) < before, `${word.reading(st)} against ${before}`);
  // a player another school let go may walk on with you
  for (const x of c["joined"]) assert(roster.some((p) => p["id"] === x["id"] && p["cut_from"] === x["from"]) && x["from_name"]);
  assert(v["report"]["walk_ons"] >= 0);
  // read back from a later stage, the stage says where they went
  assert(G("offseason")["cuts"]["out"].length === marked.length);
});

test("on Auto the staff makes the cuts, and a past season keeps no game logs", () => {
  const id2 = api.call("POST", "/api/season", { team: "kent-state", mode: "full", seed: 5, career: true })["id"];
  const st = api.loaded_state();
  finished(st);
  st["champion"] = "kent-state";
  st["career"]["game_logs"] = [{ year: st["year"] - 1, team: "kent-state", games: [], stat_keys: [], players: {} }];
  api._save_loaded();
  const out = api.call("POST", `/api/season/${id2}/offseason/advance`, { to: "next_season" });
  assert(out["next_season"] === true);
  const next = api.loaded_state();
  assert(Object.values(next["league"]["teams"]).every((t) => t["roster"].length <= 85 && t["roster"].length >= 70));
  equal(offseason.GAME_LOG_SEASONS, 0);
  equal(next["career"]["game_logs"], []);
});

await run();
