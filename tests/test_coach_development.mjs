// Coaches develop like players (career_js/offseason `_develop_coaches`): every coach in the
// league closes part of the gap to a hidden level each offseason (the young have room, the old are
// over theirs), a top-third year adds points and a bottom-third year takes them, nobody climbs more
// than COACH_CLIMB over where he started, and past 63 he only drifts down; the pass is deterministic
// and the Staff step shows your staff's changes.
// `node tests/test_coach_development.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random, sorted, sum, truthy, json_dumps, is_odict, odict } from "../engine_js/pyrt.js";

const game = await start();
const { season, offseason } = game;
const league = game.modules.league;

const KEYS = ["play_calling", "player_development", "recruiting"];

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

/** tests/test_coach_market's: the offseason on Auto up to a stage. */
function to_stage(st, stage) {
  st["offseason"]["auto"] = true;
  while (st["offseason"]["stage"] !== stage) offseason.advance(st);
}

/** copy.deepcopy of a season's state (a dict that keeps number-like keys in order stays one). */
function deepcopy(v) {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(deepcopy);
  if (v instanceof Set) return new Set([...v].map(deepcopy));
  if (v instanceof Map) return new Map([...v].map(([k, x]) => [k, deepcopy(x)]));
  const out = is_odict(v) ? odict() : {};
  for (const k of Object.keys(v)) out[k] = deepcopy(v[k]);
  return out;
}

const fixed = (x) => (x >= 0 ? "+" : "-") + Math.abs(x).toFixed(1);
const fill = (v) => Object.fromEntries(KEYS.map((k) => [k, v]));

test("coach development", () => {
  // the expected change a year, per age and year cell: 400 seeded coaches a cell, ratings drawn from the
  // real league's coaches (those at or over the floor: a rating under it is held by design), the level
  // drawn as the league pass draws it, the same coaches across the three years. A staff member under 55
  // with an average year holds or climbs (0 to +1), a top-third year gains 2-4, a bottom-third year loses
  // 1-2; the young (under 40) gain 2-3 on average, the old (63+) lose 1-2.
  const pool = [];
  for (const t of Object.values(league.from_base()["teams"])) {
    for (const c of Object.values(t["coaches"])) {
      if (!(truthy(c) && truthy(c["ratings"]))) continue;
      for (const [k, v] of Object.entries(c["ratings"])) if (k !== "overall" && v >= offseason.COACH_FLOOR) pool.push(v);
    }
  }
  pool.sort((a, b) => a - b);
  const cells = {};
  for (const [lo, hi] of [[30, 39], [40, 54], [55, 62], [63, 70]]) {
    const coaches = [];
    for (let i = 0; i < 400; i++) {
      const rng = new Random(`${lo}-${i}`);
      const age = rng.randint(lo, hi);
      const r = { a: rng.choice(pool) }, c = {};
      coaches.push([age, r, c, offseason._pot(c, r, rng, age)]);
    }
    for (const mark of [offseason.STAFF_MARK, 0, -offseason.STAFF_MARK]) {
      const ds = [];
      coaches.forEach(([age, r0, c, pot], i) => {
        const r = { ...r0 };
        const d = offseason.grow_coach(r, pot, age, offseason.COACH_PERF[mark], new Random(`${mark}-${i}`), c["base"]);
        assert(r["a"] === r0["a"] + (d["a"] ?? 0) && Math.min(offseason.COACH_FLOOR, r0["a"]) <= r["a"] && r["a"] <= Math.min(offseason.COACH_CAP, r0["a"] + offseason.COACH_CLIMB),
          () => JSON.stringify([r0, r, d]));
        ds.push(r["a"] - r0["a"]);
      });
      cells[`${lo},${mark}`] = sum(ds) / ds.length;
    }
  }
  const top = offseason.STAFF_MARK, avg = 0, bot = -offseason.STAFF_MARK;
  const cell = (lo, mark) => cells[`${lo},${mark}`];
  const between = (a, x, b) => a <= x && x <= b;
  const shown = () => JSON.stringify(cells);
  assert(between(0.0, cell(40, avg), 1.0) && between(2.0, cell(40, top), 4.0) && between(-2.0, cell(40, bot), -1.0), shown);
  assert(between(2.0, cell(30, avg), 3.0) && between(3.0, cell(30, top), 5.0) && between(-1.0, cell(30, bot), 1.0), shown);
  assert(between(-1.0, cell(55, avg), 0.5) && cell(55, top) > 0.5 && between(-3.0, cell(55, bot), -1.0), shown);
  const old = sum([top, avg, bot].map((m) => cell(63, m))) / 3;
  assert(between(-2.0, old, -1.0) && cell(63, top) <= 0.0, () => `${old} ${shown()}`);
  // the climb cap: a young coach with room and a top-third year every year never passes where he started + COACH_CLIMB
  let r = fill(60);
  let c = {};
  const pot = offseason._pot(c, r, new Random(1), 30);
  assert(Object.values(pot).every((p) => between(60, p, 60 + offseason.COACH_CLIMB)), () => JSON.stringify(pot));
  for (let i = 0; i < 30; i++) {
    offseason.grow_coach(r, pot, 30 + i, offseason.COACH_PERF[offseason.STAFF_MARK], new Random(i), c["base"]);
  }
  assert(Object.values(r).every((v) => v === 60 + offseason.COACH_CLIMB), () => JSON.stringify(r));
  // a 66-year-old never gains, even after a top-third year, and loses a point or two a year on an average one
  const gains = [];
  for (let i = 0; i < 60; i++) {
    r = fill(60);
    const d = offseason.grow_coach(r, fill(72), 66, offseason.COACH_PERF[offseason.STAFF_MARK], new Random(i));
    for (const k of KEYS) gains.push(d[k] ?? 0);
  }
  assert(Math.max(...gains) <= 0 && Math.min(...gains) < 0, () => JSON.stringify([...new Set(gains)].sort((a, b) => a - b)));
  r = fill(60);
  offseason.grow_coach(r, fill(72), 66, 0.0, new Random(3));
  assert(Object.values(r).every((v) => between(58, v, 59)), () => JSON.stringify(r));
  // ... and never below the floor
  r = fill(offseason.COACH_FLOOR);
  for (let i = 0; i < 30; i++) offseason.grow_coach(r, fill(99), 70, 0.0, new Random(i));
  assert(Object.values(r).every((v) => v === offseason.COACH_FLOOR), () => JSON.stringify(r));
  // ... and no rating passes the cap
  r = fill(98);
  for (let i = 0; i < 30; i++) offseason.grow_coach(r, fill(99), 30, offseason.COACH_PERF[offseason.STAFF_MARK], new Random(i));
  assert(Object.values(r).every((v) => v <= offseason.COACH_CAP), () => JSON.stringify(r));
  // the whole league, at the Development stage: deterministic for a seed, bounded, the ceilings and ages kept
  const st = season.new_season("ohio-state", "full", 5, undefined, undefined, true);
  finished(st);
  offseason.start(st);
  to_stage(st, "development");
  const lg = st["league"];
  const a = deepcopy(st), b = deepcopy(st);
  const ra = offseason._develop_coaches(a), rb = offseason._develop_coaches(b);
  equal(ra, rb, "not deterministic");
  assert(json_dumps(a["league"]["teams"], { sort_keys: true }) === json_dumps(b["league"]["teams"], { sort_keys: true }), "not deterministic");
  assert(json_dumps(a["league"]["market"] ?? null, { sort_keys: true }) === json_dumps(b["league"]["market"] ?? null, { sort_keys: true }));
  let moved = 0;
  for (const [slug, t] of Object.entries(a["league"]["teams"])) {
    for (const [role, c] of Object.entries(t["coaches"])) {
      if (!(truthy(c) && truthy(c["name"]))) continue;
      assert(truthy(c["pot"]) && truthy(c["base"]) && truthy(c["age_at"]), () => JSON.stringify([slug, role]));
      for (const [k, v] of Object.entries(c["ratings"])) {
        if (k === "overall") continue;
        const was = lg["teams"][slug]["coaches"][role]["ratings"][k];       // the pass already ran once on the way to this stage
        assert(Math.min(offseason.COACH_FLOOR, was) <= v && v <= Math.min(offseason.COACH_CAP, c["base"][k] + offseason.COACH_CLIMB), () => JSON.stringify([slug, role, k, v, was]));
        moved += v !== lg["teams"][slug]["coaches"][role]["ratings"][k] ? 1 : 0;
      }
    }
  }
  assert(moved > 100, () => String(moved));
  assert((((a["league"]["market"] || {})["coaches"]) || []).every((e) => truthy(e["pot"])));      // the pool exists from the second offseason
  // your staff's rows: one per member (and you), with the changes and a reason
  const mine = ra["mine"];
  const ids = new Set(mine.map((r) => r["id"]));
  assert(a["career"]["staff"].every((s) => ids.has(s["id"])) && ids.has("hc"), () => JSON.stringify([...ids]));
  for (const row of mine) {
    assert(row["name"] && row["role"] && Array.isArray(row["changes"]) && Array.isArray(row["why"]), () => JSON.stringify(row));
    for (const ch of row["changes"]) assert(ch["to"] !== ch["from"] && ch["rating"], () => JSON.stringify(ch));
  }
  const staff_by = Object.fromEntries(a["career"]["staff"].map((s) => [s["id"], s]));
  for (const row of mine) {
    if (row["id"] in staff_by && (row["role"] === "OC" || row["role"] === "DC")) {        // the team's coordinator and your staff entry agree
      const key = offseason.STAFF_ROLES[row["role"]];
      const c = a["league"]["teams"]["ohio-state"]["coaches"][key];
      assert(staff_by[row["id"]]["evaluation"] === c["ratings"]["player_development"], () => JSON.stringify([staff_by[row["id"]], c["ratings"]]));
    }
  }
  // the Staff step view carries the rows, one per staff member (past Roster Cuts, where the staff decides here)
  while (a["offseason"]["stage"] !== "cuts") offseason.advance(a);
  offseason.cuts_auto(a);
  offseason.advance(a);                    // Roster Moves
  offseason.advance(a);                    // Staff
  const v = offseason.view(a);
  const developed = new Set(v["staff"]["developed"].map((r) => r["id"]));
  assert(truthy(v["staff"]) && a["career"]["staff"].every((s) => developed.has(s["id"])));
  season.close_pool();
  console.log("coach development ok: expected change a year "
    + [30, 40, 55, 63].map((lo) => `${lo}+ top ${fixed(cell(lo, top))} avg ${fixed(cell(lo, avg))} bottom ${fixed(cell(lo, bot))}`).join("; ")
    + `; ${moved} ratings moved around the league; your staff: `
    + mine.map((r) => `${r["role"]} ${r["changes"].map((c) => `${c["rating"]} ${c["from"]}→${c["to"]}`).join(", ")}`).join("; "));
});

await run();
