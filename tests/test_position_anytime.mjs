// A position change at any time. In week 3 of a career a receiver becomes a tight end at once: the depth chart, his
// profile, the next game's box score and the season stats show him at TE with where he came from, his overall is his
// projection at TE, a reloaded save keeps the change, and moving him back clears it. The offseason's own change works
// at the last stage too.
// `node tests/test_position_anytime.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random, sorted } from "../engine_js/pyrt.js";

const game = await start({ env: { SIM_WORKERS: "1", CFP_SEASONS_DIR: "data/seasons-position-test" } });
const { api, season, offseason } = game;
const show = (v) => JSON.stringify(v);
const ME = "ohio-state";

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

function refused(fn, code) {
  try { fn(); } catch (e) {
    if (!(e instanceof api.ApiError)) throw e;
    assert(e.status === code, `expected ${code}, got ${e.status}: ${e.message}`);
    return;
  }
  throw new Error(`expected ${code}`);
}
const drain = () => { while (api.step() !== null) { /* the next week */ } };
const SID = api.call("POST", "/api/season", { team: ME, seed: 7, career: true })["id"];
const base = `/api/season/${SID}`;
/** The depth chart's rows by role. */
function chart_rows(team = ME) {
  const out = {};
  for (const u of api.call("GET", `${base}/depth/${team}`)["units"]) for (const r of u["rows"]) out[r["role"]] = r["players"];
  return out;
}
const slugs = (rows) => rows.map((c) => c["slug"]);
const move = (player, pos, team = ME) => api.call("POST", `${base}/position`, { team, player, pos });

let wr = null, te = null, opts = null;
test("a player's options list his own position first and every spot he could move to, never kicker or punter", () => {
  api.call("POST", `${base}/advance`, { to: 3 });
  drain();
  equal(api.loaded_state()["current_week"], 3);
  wr = chart_rows()["WR"][1];                                   // a receiver in the rotation
  opts = api.call("GET", `${base}/position_options/${ME}/${wr["slug"]}`)["options"];
  assert(opts[0]["pos"] === "WR" && opts[0]["current"] && opts.every((o) => ["pos", "group", "overall", "current"].every((k) => k in o)));
  assert(!opts.some((o) => o["pos"] === "K" || o["pos"] === "P"), "a receiver is offered the kicker's spot");
  te = opts.find((o) => o["pos"] === "TE");
});

test("the change takes effect at once: off the receivers' rows, on the tight ends', placed by his overall there", () => {
  const r = move(wr["slug"], "TE");
  equal({ ...r }, { slug: wr["slug"], position: "TE", overall: te["overall"], moved_from: "WR" });
  api.flush();
  assert(api.changed());
  const rows = chart_rows();
  assert(!slugs(rows["WR"]).includes(wr["slug"]));
  const mine = rows["TE"].find((c) => c["slug"] === wr["slug"]);
  assert(mine["position"] === "TE" && mine["moved_from"] === "WR" && mine["overall"] === te["overall"], show(mine));
  assert(rows["TE"].every((c) => "moved_from" in c) && rows["QB"].every((c) => c["moved_from"] === null));
  const st = api.loaded_state();
  const order = season.depth_order(st, ME, "TE");
  const tes = Object.fromEntries(rows["TE"].map((c) => [c["slug"], c]));
  const ahead = order.slice(0, order.indexOf(wr["slug"])).filter((x) => x in tes).map((x) => tes[x]["overall"]);
  assert(ahead.every((o) => o >= te["overall"]), "he is not placed by his overall at tight end");
  assert(!season.depth_order(st, ME, "WR").includes(wr["slug"]));
  const prof = api.call("GET", `${base}/player?team=${ME}&slug=${wr["slug"]}`);
  assert(prof["position"] === "TE" && prof["role"] === "TE" && prof["overall"] === te["overall"], show([prof["position"], prof["overall"]]));
});

test("the next game's box score and the season's stats list him at his new position", () => {
  api.call("POST", `${base}/advance`, {});
  drain();
  const st = api.loaded_state();
  equal(st["current_week"], 4);
  const g = Object.values(st["games"]).find((x) => x["week"] === 4 && (x["home"] === ME || x["away"] === ME) && x["played"]);
  const box = api.call("GET", `${base}/game/${g["event_id"]}`);
  const lines = (g["home"] === ME ? box["home"] : box["away"])["players"].filter((p) => p["name"] === wr["name"]);
  assert(lines.length && lines.every((p) => p["position"] === "TE"), show(lines));
  const ss = st["season_stats"][ME]["players"];
  assert(`${wr["name"]}|TE` in ss && !(`${wr["name"]}|WR` in ss), show(Object.keys(ss).filter((k) => k.startsWith(wr["name"]))));
  assert(ss[`${wr["name"]}|TE`]["games"] >= 1);
});

test("a change to the same spot, of another team's player, to a made-up position or to kicker is refused", () => {
  refused(() => move(wr["slug"], "TE"), 409);
  const other = chart_rows("georgia")["QB"][0]["slug"];
  refused(() => move(other, "WR", "georgia"), 403);
  refused(() => api.call("GET", `${base}/position_options/georgia/${other}`), 403);
  refused(() => move(wr["slug"], "XX"), 400);
  refused(() => move("nobody", "WR"), 404);
  refused(() => move(wr["slug"], "K"), 400);
});

test("a reloaded save keeps the change, and moving him back clears it everywhere", () => {
  api.flush();
  const again = season.load_season(SID);
  equal(season.position_changes(again, ME)[wr["slug"]]["to"], "TE");
  const rows2 = {};
  for (const u of season.depth_chart_view(again, ME)["units"]) for (const r of u["rows"]) rows2[r["role"]] = r["players"];
  assert(rows2["TE"].some((c) => c["slug"] === wr["slug"] && c["moved_from"] === "WR"));
  const r = move(wr["slug"], "WR");
  assert(r["position"] === "WR" && r["moved_from"] === null && r["overall"] === opts[0]["overall"], show(r));
  assert(!Object.keys(season.position_changes(api.loaded_state(), ME)).length);
  assert(`${wr["name"]}|WR` in api.loaded_state()["season_stats"][ME]["players"], "his stats did not come back with him");
  const rows = chart_rows();
  assert(slugs(rows["WR"]).includes(wr["slug"]) && !slugs(rows["TE"]).includes(wr["slug"]));
});

let fs = null;
test("a redshirting player who changes position stays out of games at his new spot", () => {
  fs = chart_rows()["FS"].find((c) => c["redshirt"]["can"]);
  api.call("POST", `${base}/redshirt`, { team: ME, player: fs["slug"], on: true });
  const r = move(fs["slug"], "WR");
  assert(r["position"] === "WR" && r["moved_from"] === "FS");
  const st = api.loaded_state();
  equal(st["redshirting"][ME][fs["slug"]]["position"], "WR");
  assert(season._injured(st, ME).some(([name, pos]) => name === fs["name"] && pos === "WR"), "he is not held out at WR");
});

test("the season's change carries into the offseason's league, and a change still works at the offseason's last stage", () => {
  const st = api.loaded_state();
  finished(st); api._save_loaded();
  const off = offseason.start(st);
  const roster = st["league"]["teams"][ME]["roster"];
  assert(roster.some((c) => c["id"] === fs["slug"] && c["pos"] === "WR" && c["moved_from"] === "FS"), "the season's change did not reach the league");
  off["stage"] = "ready";
  api._save_loaded();
  const mover = roster.find((c) => c["pos"] === "CB");
  const v = api.call("POST", `${base}/offseason/position`, { pid: mover["id"], pos: "SS" });
  assert(mover["pos"] === "SS" && mover["moved_from"] === "CB");
  assert(v["position_changes"].some((m) => m["id"] === mover["id"] && m["to"] === "SS"));
  api.call("POST", `${base}/offseason/position`, { pid: mover["id"], pos: "CB" });
  assert(mover["pos"] === "CB" && !("moved_from" in mover) && !st["offseason"]["position_changes"].some((m) => m["id"] === mover["id"]));
});

await run();
