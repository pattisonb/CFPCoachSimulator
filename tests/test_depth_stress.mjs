// The depth chart and position changes under stress (the player: "the formation stuff gets kinda messed up when moving
// around the depth chart, like when I recruit a SAM and don't need one"). A career in its second season, a SAM signed
// into a class whose defense starts no SAM, then hundreds of random moves through the API the page calls (up, down, to
// the top, into another role, a position change, a reset) and after every one: each player on the chart once, every
// role starting the formation's number with nobody missing, the formations filled with no one twice, and a game played.
// `node tests/test_depth_stress.mjs [moves] [team]`
import { start, test, run, assert as hard } from "./harness.mjs";
import { Random, sorted } from "../engine_js/pyrt.js";
import { api as engine } from "../engine_js/api.js";

const game = await start({ env: { SIM_WORKERS: "1" } });
const { api, season } = game;
const ME = process.argv[3] || "baylor";
const MOVES = Number(process.argv[2]) || 300;
const J = (v) => JSON.stringify(v);

// ---- a career in its second season, with a SAM in the class ------------------------------------------------------
const sid = api.call("POST", "/api/season", { team: ME, mode: "full", seed: 23, career: true })["id"];
let st = api.loaded_state();
{
  const rng = new Random(2);
  for (const g of Object.values(st["games"])) Object.assign(g, { played: true, home_score: rng.randint(10, 40) + 3, away_score: rng.randint(3, 30) });
  const teams = season.load_teams();
  const schools = Object.keys(teams).filter((s) => !teams[s]["fictional"]);
  const rc = st["recruiting"];
  const pids = sorted(Object.keys(rc["prospects"]), (p) => rc["prospects"][p]["rank"]);
  pids.slice(0, schools.length * 20).forEach((pid, i) => { rc["status"][pid]["signed"] = schools[i % schools.length]; });
  // linebackers and athletes the class would not need: outside linebackers (a SAM), an ATH, a second QB
  const want = ["SAM", "LOLB", "ROLB", "OLB", "ATH", "QB"];
  for (const pos of want) {
    const pid = pids.find((q) => [rc["prospects"][q]["position"], rc["prospects"][q]["ea_position"]].includes(pos) && rc["status"][q]["signed"] !== ME);
    if (pid) rc["status"][pid]["signed"] = ME;
  }
  Object.assign(st, { done: true, current_week: season.FINAL_WEEK, champion: "georgia" });
  api._save_loaded();
  api.call("GET", `/api/season/${sid}/offseason`);
  api.call("POST", `/api/season/${sid}/offseason/advance`, { to: "next_season" });
  st = api.loaded_state();
}

// ---- what must hold after every move -----------------------------------------------------------------------------
const chart = () => api.call("GET", `/api/season/${sid}/depth/${ME}`);
const rowsOf = (c) => c["units"].flatMap((u) => u["rows"]).filter((r) => r["role"] !== "KR" && r["role"] !== "PR");
const base = rowsOf(chart());
const BASE_STARTERS = Object.fromEntries(base.map((r) => [r["role"], r["starters"]]));
const ROSTER = new Set(base.flatMap((r) => r["players"].map((p) => p["slug"])));

const EMPTY = new Set();
// every kind of trouble seen (its first sentence, with the move that showed it first, and how often)
const FOUND = new Map();
let NOW = "";
function assert(ok, msg) {
  if (ok) return;
  const text = typeof msg === "function" ? msg() : msg;
  const kind = text.replace(/^[^:]*: /, "").replace(/[A-Z][a-z]+(?: [A-Z][a-zA-Z.']+)+/g, "<name>").replace(/\d+/g, "#");
  const f = FOUND.get(kind) || { first: text, n: 0, before: NOW };
  f.n += 1;
  FOUND.set(kind, f);
}
function check(what) {
  const c = chart();
  const rows = rowsOf(c);
  const seen = new Map();
  for (const r of rows) {
    for (const p of r["players"]) {
      assert(!seen.has(p["slug"]), () => `${what}: ${p["name"]} at ${seen.get(p["slug"])} and ${r["role"]}`);
      seen.set(p["slug"], r["role"]);
    }
    // a role keeps the formation's starters (a role the formation leaves out starts nobody)
    const want = BASE_STARTERS[r["role"]] ?? 0;
    assert(r["starters"] === want, () => `${what}: ${r["role"]} starts ${r["starters"]}, the formation ${want}`);
    const healthy = r["players"].filter((p) => !p["injury"]).length;
    const on = r["players"].filter((p) => p["starter"]).length;
    assert(on === Math.min(want, r["players"].length), () => `${what}: ${r["role"]} has ${on} starters of ${want} (${healthy} healthy, ${r["players"].length} there)`);
  }
  for (const s of ROSTER) assert(seen.has(s), () => `${what}: ${s} is on no role`);
  // every role the formation starts has someone there
  for (const [role, n] of Object.entries(BASE_STARTERS)) {
    if (!n) continue;
    const r = rows.find((x) => x["role"] === role);
    if (!(r && r["players"].length >= 1)) EMPTY.add(role);
  }
  // the formations the next game lines up in: every slot filled, nobody twice in one
  const f = api.call("GET", `/api/season/${sid}/depth/${ME}/formations`);
  for (const unit of ["offense", "defense", "special"]) {
    for (const form of (f[unit] || {})["formations"] || []) {
      const slugs = form["slots"].map((s) => s["player"] && s["player"]["slug"]);
      const empty = form["slots"].filter((s) => !s["player"]).map((s) => s["slot"]);
      assert(!empty.length, () => `${what}: ${unit} ${form["name"]} has empty slots ${J(empty)}`);
      const dup = slugs.filter((s, i) => s && slugs.indexOf(s) !== i);
      assert(!dup.length, () => `${what}: ${unit} ${form["name"]} has ${J(dup)} twice`);
    }
  }
}

function play(what) {
  // a game with this lineup: the engine takes it, eleven a side on every snap
  const opp = Object.values(st["games"]).find((g) => (g["home"] === ME || g["away"] === ME) && !g["played"]);
  const other = opp ? (opp["home"] === ME ? opp["away"] : opp["home"]) : "tcu";
  const mine = season._game_team(ME, 0, season.team_edits(st, ME), season.morale_payload(st, ME), (st["depth"] || {})[ME] || null, season._injured(st, ME));
  const theirs = season._game_team(other, 0, season.team_edits(st, other), season.morale_payload(st, other), null, season._injured(st, other));
  let r;
  try {
    r = engine.play(mine, theirs, null, 7, "home", false, true);
  } catch (e) {
    throw new Error(`${what}: the game would not play: ${e.stack || e}`);
  }
  assert(r && r["home"] && r["away"], `${what}: no result`);
  const short = (r["play_log"] || []).filter((e) => Array.isArray(e["lineup"]) && e["lineup"].length !== 11).length;
  assert(!short, `${what}: ${short} snaps without eleven`);
}

// ---- the moves ---------------------------------------------------------------------------------------------------
test("the second season starts with a sound depth chart, its SAM and all", () => {
  const sam = rowsOf(chart()).find((r) => ["SAM", "LOLB", "ROLB"].includes(r["role"]));
  console.log("  defense roles:", rowsOf(chart()).filter((r) => r["players"][0] && !["QB", "HB", "FB", "WR", "TE", "LT", "LG", "C", "RG", "RT", "K", "P"].includes(r["role"])).map((r) => `${r["role"]} ${r["starters"]}/${r["players"].length}`).join(", "));
  check("start");
  play("start");
});

test(`${MOVES} random moves keep the chart, the formations and the game sound`, () => {
  const rng = new Random(11);
  const roles = Object.keys(BASE_STARTERS);
  const log = [];
  for (let i = 0; i < MOVES; i++) {
    const c = chart();
    const rows = rowsOf(c);
    const all = rows.flatMap((r) => r["players"].map((p) => [p, r["role"]]));
    const [p, at] = rng.choice(all);
    const kind = rng.random();
    let did;
    try {
      if (kind < 0.35) {
        const move = rng.choice(["up", "down", "top"]);
        api.call("POST", `/api/season/${sid}/depth/${ME}`, { role: at, player: p["slug"], move });
        did = `${p["name"]} ${move} at ${at}`;
      } else if (kind < 0.65) {
        const role = rng.choice(roles);
        api.call("POST", `/api/season/${sid}/depth/${ME}`, { role, player: p["slug"], move: rng.choice(["top", "up", "down"]) });
        did = `${p["name"]} (${at}) played at ${role}`;
      } else if (kind < 0.92) {
        const opts = api.call("GET", `/api/season/${sid}/position_options/${ME}/${p["slug"]}`);
        const list = (opts["options"] || opts).filter((o) => !o["current"]);
        if (!list.length) continue;
        const o = rng.choice(list);
        api.call("POST", `/api/season/${sid}/position`, { team: ME, player: p["slug"], pos: o["pos"] });
        did = `${p["name"]} (${p["position"]}) position ${o["pos"]}`;
      } else if (kind < 0.97) {
        const order = rows.find((r) => r["role"] === at)["players"].map((x) => x["slug"]);
        api.call("POST", `/api/season/${sid}/depth/${ME}`, { role: at, order: [...order].reverse() });
        did = `${at} reversed`;
      } else {
        api.call("POST", `/api/season/${sid}/depth/${ME}`, { reset: true });
        did = "reset";
      }
    } catch (e) {
      if (e && e.status && e.status < 500) { did = `refused (${e.status}): ${e.message}`; log.push(did); continue; }
      throw new Error(`move ${i} (${did ?? kind}): ${e.stack || e}\n  after: ${log.slice(-6).join(" | ")}`);
    }
    log.push(did);
    st = api.loaded_state();
    NOW = log.slice(-5).join(" | ");
    try {
      check(`move ${i} (${did})`);
      if (i % 25 === 0 || EMPTY.size) play(`move ${i}${EMPTY.size ? ` (empty: ${[...EMPTY].join(", ")})` : ""}`);
    } catch (e) {
      throw new Error(`${e.message}\n  the moves before: ${log.slice(-8).join(" | ")}`);
    }
  }
  console.log(`  ${log.length} moves, ${log.filter((x) => x.startsWith("refused")).length} refused`);
  for (const [kind, f] of FOUND) console.log(`  [${f.n}x] ${f.first}\n        after: ${f.before}`);
  hard(!FOUND.size, `${FOUND.size} kinds of trouble`);
});

await run();
