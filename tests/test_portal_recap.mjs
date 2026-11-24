// The transfer portal recap (offseason.view through app_js/api): at Development, Staff and Ready
// the view carries `portal_recap` (who you signed out of the portal, who you lost to it and where he
// went, with his reason), your transfers are marked on `my_roster` and in the development report,
// and every signed transfer is in `report.transfers` whatever the top-25 slice keeps. Your staff
// recruit the portal on Auto so at least one offer lands.
// `node tests/test_portal_recap.mjs`
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random, sorted, truthy } from "../engine_js/pyrt.js";

const game = await start();
const { season, api } = game;

const ME = "ohio-state";

/** Every game played (the better team usually wins), every school's class signed, season over (tests/test_offseason's). */
function finished(st) {
  const rng = new Random(1);
  const teams = season.load_teams();
  for (const g of Object.values(st["games"])) {
    const h = teams[g["home"]]["team_ratings"]["overall"], a = teams[g["away"]]["team_ratings"]["overall"];
    const hs = rng.randint(10, 45);
    const win = rng.random() < 1 / (1 + Math.pow(10, (a - h) / 12));
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

// tests/test_portal_profile's two helpers
const G = (sid, p) => api.call("GET", `/api/season/${sid}/${p}`);

function to_portal(sid) {
  finished(api.loaded_state()); api._save_loaded();
  G(sid, "offseason");
  while (api.loaded_state()["offseason"]["stage"] !== "portal_w1") api.call("POST", `/api/season/${sid}/offseason/advance`, {});
}

const advance = (sid) => api.call("POST", `/api/season/${sid}/offseason/advance`, {});

const same_set = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

function check_recap(sid, v) {
  const st = api.loaded_state();
  const off = st["offseason"];
  const players = off["portal"]["players"];
  const roster = st["league"]["teams"][ME]["roster"];
  const rec = v["portal_recap"];
  assert(rec !== null && rec !== undefined, v["stage"]);
  // who you got: every portal entrant now on your roster, marked with the school he came from
  const signed_ids = new Set(roster.filter((p) => truthy(p["transfer"]) && p["id"] in players).map((p) => p["id"]));
  assert(signed_ids.size, "seed 11 on Auto lands at least one portal signing");
  // (the recap lists every transfer you signed; one the roster limit then let go is no longer on the roster)
  const listed = new Set(rec["signed"].map((r) => r["id"]));
  assert([...signed_ids].every((id) => listed.has(id)) && listed.size - signed_ids.size <= 2, `${listed.size} listed, ${signed_ids.size} on the roster`);
  const by_id = Object.fromEntries(roster.map((p) => [p["id"], p]));
  for (const r of rec["signed"]) {
    const p = by_id[r["id"]];
    if (!p) continue;                                     // (signed, then let go at the roster limit)
    assert(r["from"] === p["transfer"] && p["transfer"] === players[r["id"]]["from"]);
    assert(r["from_name"] && r["from_name"] !== r["from"]);
    assert(r["name"] === p["n"] && r["pos"] === p["pos"] && r["cls"] === p["cls"] && r["overall"] > 0);
    assert(r["walk_on"] === truthy(p["walk_on"]));
  }
  // who you lost: the departures' portal players, where each went and why he left
  const lost_ids = new Set(off["departures"].filter((d) => d["team"] === ME && d["kind"] === "portal").map((d) => d["id"]));
  assert(same_set(new Set(rec["lost"].map((r) => r["id"])), lost_ids));
  const reasons = Object.fromEntries((((off["retention"] || {})["players"]) || []).map((e) => [e["id"], e["reason"]]));
  for (const r of rec["lost"]) {
    const e = players[r["id"]];
    assert((r["to"] ?? null) === (e["signed"] ?? null));
    assert(r["to_name"] === (!truthy(e["signed"]) ? "out of FBS" : r["to_name"]) && r["to_name"]);
    if (truthy(e["signed"])) assert(r["to_name"] !== r["to"]);
    assert((r["reason"] ?? null) === (reasons[r["id"]] ?? null));
    assert(r["reason"], "a leaver you met at Retention has his reason");
  }
  assert(rec["entrants"] === Object.keys(players).length);
  assert(rec["signed_league"] === Object.values(players).filter((e) => truthy(e["signed"])).length);
  // the development report: every transfer, marked
  const rep = v["report"];
  const dev = Object.fromEntries(rep["transfers"].map((r) => [r["id"], r]));
  assert([...signed_ids].every((pid) => pid in dev));
  for (const pid of signed_ids) {
    assert(dev[pid]["transfer"] === by_id[pid]["transfer"]);
    assert("gain" in dev[pid] && "why" in dev[pid]);
  }
  // (the report is every returning player now; one the roster limit then let go developed and is no longer on the roster)
  for (const r of rep["mine"]) if (by_id[r["id"]]) assert((r["transfer"] ?? null) === (by_id[r["id"]]["transfer"] ?? null));
  assert(rep["mine"].length > 40, "every returning player, not the 25 biggest gains");
  // the roster rows the position-change picker reads
  const rows = Object.fromEntries(v["my_roster"].map((r) => [r["id"], r]));
  for (const pid of signed_ids) assert(rows[pid]["transfer"] === by_id[pid]["transfer"]);
  assert(Object.keys(rows).filter((pid) => !signed_ids.has(pid) && !truthy(by_id[pid]["transfer"])).every((pid) => !truthy(rows[pid]["transfer"])));
  return rec;
}

test("portal recap", () => {
  season.SEASONS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cfp-portal-recap-"));
  let rec;
  try {
    const sid = api.call("POST", "/api/season", { team: ME, mode: "full", seed: 11, career: true })["id"];
    to_portal(sid);
    let v = G(sid, "offseason");
    assert(v["stage"] === "portal_w1" && v["portal_recap"] === null, "no recap before the portal closes");
    api.call("POST", `/api/season/${sid}/settings`, { auto_recruit: "season" });
    while (api.loaded_state()["offseason"]["stage"] !== "development") advance(sid);
    v = G(sid, "offseason");
    rec = check_recap(sid, v);
    // Roster Cuts (past Place Your Athletes, in a year you signed one): the staff decides, then Roster Moves, then Staff
    while (api.loaded_state()["offseason"]["stage"] !== "cuts") advance(sid);
    api.call("POST", `/api/season/${sid}/offseason/cut`, { auto: true });
    advance(sid);
    advance(sid);
    const v2 = G(sid, "offseason");
    assert(v2["stage"] === "staff");
    // (the rosters are filled after Roster Cuts now, so the groups still short have moved: the rest is as it was)
    const but_short = (r) => ({ ...r, short: null });
    equal(but_short(check_recap(sid, v2)), but_short(rec));
    rec = check_recap(sid, v2);
    let v3;
    for (let i = 0; i < 3; i++) {             // Change Conferences, Edit Schedule, the recap
      advance(sid);
      v3 = G(sid, "offseason");
      equal(check_recap(sid, v3), rec, v3["stage"]);
    }
    assert(v3["stage"] === "ready");
  } finally {
    season.close_pool();
    fs.rmSync(season.SEASONS_DIR, { recursive: true, force: true });
  }
  console.log(`ok: signed ${rec["signed"].length} of ${rec["entrants"]}, lost ${rec["lost"].length}`);
});

await run();
