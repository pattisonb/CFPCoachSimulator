// career_js/carousel.js against the Python it was ported from: node career_js/test/carousel_compare.mjs OUTDIR
// (after python3 career_js/test/carousel_reference.py OUTDIR). Every carousel the reference ran is run here on the
// same career, and its record, every team's coaches, AD and style, the market and a round of the module's other
// functions are compared exactly, key order included. The season is the JavaScript season; programs,
// recruiting._baseline and offseason.expiring answer what Python's answered, call by call, and a call made out of
// Python's order or with other arguments fails the case.
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { set_reader, set_store, env } from "../../engine_js/files.js";
import { modules } from "../../engine_js/modules.js";
import { Random, parse_ordered, get } from "../../engine_js/pyrt.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = process.argv[2];
const abs = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));
set_reader((p) => fs.readFileSync(abs(p), "utf8"));
set_store({
  write: (p, text) => { fs.mkdirSync(path.dirname(abs(p)), { recursive: true }); fs.writeFileSync(abs(p), text); },
  exists: (p) => fs.existsSync(abs(p)),
  remove: (p) => fs.rmSync(abs(p), { force: true }),
  remove_dir: (p) => fs.rmSync(abs(p), { recursive: true, force: true }),
  list: (p) => (fs.existsSync(abs(p)) ? fs.readdirSync(abs(p)).sort() : []),
  mtime: (p) => fs.statSync(abs(p)).mtimeMs,
});
env.CFP_SEASONS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "seasons-"));

const read = (name) => JSON.parse(fs.readFileSync(path.join(out, name), "utf8"));
const setup = read("setup.json");
const deep = (o) => JSON.parse(JSON.stringify(o));

// ----- the modules that are not ported: Python's answers, call by call -----------------------------------------------
let R = null;       // the case being replayed: { state, queues: {name: {items, head}}, loose }
const LOOSE = new Set(["programs.attract"]);     // asked over a set in Python (run's step 4): any order there
function norm(a) {
  if (a === R.state) return "<state>";
  if (a !== null && typeof a === "object" && !Array.isArray(a) && ("coaches" in a || "roster" in a)) return "<team>";
  return a === undefined ? null : a;
}
function start_replay(state, calls) {
  R = { state, queues: {}, loose: 0 };
  for (const [name, args, value] of calls) {
    (R.queues[name] ??= { items: [], head: 0 }).items.push({ key: JSON.stringify(args), value, used: false });
  }
}
function left_over() {
  let n = 0;
  for (const q of Object.values(R.queues)) n += q.items.filter((c) => !c.used).length;
  return n;
}
const replay = (name) => (...args) => {
  while (args.length && args[args.length - 1] === undefined) args.pop();
  const key = JSON.stringify(args.map(norm));
  const q = R.queues[name];
  if (!q) throw new Error(`${name}(${key.slice(0, 120)}): Python never called it`);
  while (q.head < q.items.length && q.items[q.head].used) q.head++;
  let c = q.items[q.head];
  if (!c || c.key !== key) {
    const later = LOOSE.has(name) ? q.items.find((x, i) => i > q.head && !x.used && x.key === key) : undefined;
    if (!later) throw new Error(`${name}: asked ${key.slice(0, 160)} where Python asked ${c ? c.key.slice(0, 160) : "nothing more"}`);
    R.loose++;
    c = later;
  }
  c.used = true;
  return deep(c.value);
};
const stub = (mod, names) => Object.fromEntries(names.map((n) => [n, replay(`${mod}.${n}`)]));
modules.league = { OFFENSE_ROLES: new Set(setup.OFFENSE_ROLES), TEAM_FIT: setup.TEAM_FIT, GROUP_OF: setup.GROUP_OF };
modules.clear = { on: () => setup.clear };
modules.promises = { snapshot_week: () => null };
modules.programs = { INDEPENDENTS: new Set(setup.INDEPENDENTS),
  ...stub("programs", ["get", "base", "goal_for", "attract", "z", "coach_level", "coach_ceiling", "update", "final_ranks", "nil_move"]) };
modules.recruiting = { reset_caches: () => null, ...stub("recruiting", ["_baseline"]) };
modules.offseason = { seed_key: (state) => (get(state, "seed") !== null ? state["seed"] : state["id"]),
  STAFF_ROLES: setup.STAFF_ROLES, UNDER_CONTRACT: setup.UNDER_CONTRACT, ...stub("offseason", ["expiring"]) };
const { season } = await import("../../sim_js/season.js");
const { carousel } = await import("../carousel.js");
const { ValueError } = await import("../../sim_js/coaches.js");

// ----- comparing ------------------------------------------------------------------------------------------------------
function diff(a, b, where, found) {
  if (found.length >= 8) return;
  if (a === b) return;
  if (typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))) { found.close = (found.close || 0) + 1; return; }
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) {
    found.push(`${where}: py ${JSON.stringify(a)?.slice(0, 90)} | js ${JSON.stringify(b)?.slice(0, 90)}`); return;
  }
  if (Array.isArray(a)) {
    if (a.length !== b.length) { found.push(`${where}: length py ${a.length} | js ${b.length}`); return; }
    a.forEach((v, i) => diff(v, b[i], `${where}[${i}]`, found));
    return;
  }
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.join("\u0000") !== kb.join("\u0000")) {
    const sa = new Set(ka), sb = new Set(kb);
    const only_py = ka.filter((k) => !sb.has(k)), only_js = kb.filter((k) => !sa.has(k));
    found.push(only_py.length || only_js.length ? `${where}: keys only py [${only_py.slice(0, 6)}] only js [${only_js.slice(0, 6)}]`
      : `${where}: key order differs (${ka.findIndex((k, i) => k !== kb[i])} of ${ka.length})`);
  }
  for (const k of ka) if (k in b) diff(a[k], b[k], `${where}/${k}`, found);
}
const json = (v) => deep(v === undefined ? null : v);      // as json.dumps leaves it (undefined values dropped)

function put(st, keys, value) {
  let d = st;
  for (const k of keys.slice(0, -1)) d = d[k];
  if (value === "__del__") delete d[keys[keys.length - 1]];
  else d[keys[keys.length - 1]] = value;
}
const left = (st) => ({
  teams: Object.fromEntries(Object.entries(st.league.teams).map(([s, t]) => [s, Object.fromEntries(["coaches", "ad", "style"].filter((k) => k in t).map((k) => [k, t[k]]))])),
  market: st.league.market });

function extras(st, res) {
  const me = st.team, year = st.offseason.year, lgd = st.league;
  const got = [];
  const add = (label, value) => got.push([label, json(value)]);
  add("_results", carousel._results(st));
  add("market_rows", carousel.market_rows(st));
  add("market_rows hc", carousel.market_rows(st, "head_coach"));
  add("status", carousel.status(st));
  const slugs = [...new Set([...res.offers, ...res.openings, ...Object.keys(lgd.teams).slice(0, 6)])];
  add("job_rows", carousel.job_rows(st, slugs));
  for (const role of ["head_coach", ...carousel.COORD_ROLES]) {
    add(`market_candidates ${role}`, carousel.market_candidates(st, me, role, 5).map(([s, e]) => [s, e.id]));
  }
  const cands = carousel.market_candidates(st, me, "offensive_coordinator", 2, new Random("take"), year);
  add("market_take", cands.length ? carousel.market_take(st, cands[0][1].id, "offensive_coordinator", me, year) : null);
  try {
    carousel.market_take(st, "m-nobody", "head_coach", me, year);
    add("market_take gone", null);
  } catch (e) {
    if (!(e instanceof ValueError)) throw e;
    add("market_take gone", e.message);
  }
  for (const role of carousel.COORD_ROLES) add(`contract_holds ${role}`, carousel.contract_holds(st, role, year));
  const some = Object.keys(lgd.teams).filter((_, i) => i % 9 === 0);
  add("goal", some.map((s) => carousel.goal(s, st)));
  add("goal bare", some.slice(0, 4).map((s) => carousel.goal(s)));
  add("attract", some.map((s) => carousel.attract(st, s)));
  add("baseline", some.slice(0, 4).map((s) => carousel.baseline(s)));
  const other = some[3];
  add("market_add", carousel.market_add(st, lgd.teams[other].coaches.defensive_coordinator, "defensive_coordinator", other, "Left to test the market", year));
  add("market_add roles", carousel.market_add(st, lgd.teams[other].coaches.head_coach, "head_coach", other, "Stepped away", year, ["head_coach"]));
  add("_pick_coordinator", carousel._pick_coordinator(st, some[5], "offensive_coordinator", new Random("pc"), year));
  const kept = lgd.market.coaches;
  lgd.market.coaches = [];
  add("_pick_coordinator generated", carousel._pick_coordinator(st, some[6], "defensive_coordinator", new Random("pg"), year));
  lgd.market.coaches = kept;
  const verdicts = Object.fromEntries(Object.keys(lgd.teams).map((s) => [s, { tenure: 3 }]));
  add("_pick_head_coach", carousel._pick_head_coach(st, some[7], verdicts, carousel._results(st), {}, new Random("ph"), year));
  return got;
}

function pure(st) {
  const lgd = st.league, year = st.offseason.year, me = st.team;
  const got = [];
  const add = (label, value) => got.push([label, json(value)]);
  const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
  const roles = ["head_coach", ...carousel.COORD_ROLES];
  add("mood", range(0, 101).map((s) => carousel.mood(s)));
  add("_seasons", range(0, 4).map((n) => carousel._seasons(n)));
  add("_why_generated", carousel.SUPPLY.map((s) => [carousel._why_generated(s[1], true), carousel._why_generated(s[1], false)]));
  const names = Object.values(lgd.teams).map((t) => t.coaches.head_coach.name);
  add("hometown", [...names, null, "Nobody At All"].map((n) => carousel.hometown(n)));
  add("_rng", ["run", "x"].map((w) => carousel._rng(st, w).random()));
  add("_taken_names", [...carousel._taken_names(lgd)].sort());
  const ads = [];
  for (const y of [year, null, year + 4]) {
    for (const [slug, t] of Object.entries(lgd.teams)) {
      const t2 = { ...t };
      delete t2.ad;
      ads.push(carousel.ad(t2, slug, y));
    }
  }
  add("ad", ads);
  const ages = [], ratings = [];
  for (const t of Object.values(lgd.teams)) {
    for (const c of Object.values(t.coaches)) {
      if (c && Object.keys(c).length) {
        const c2 = { ...c };
        delete c2.age_at;
        ages.push([carousel._age(c2, year), c2.age_at, carousel._age({ ...c }, year + 3)]);
        ratings.push(carousel._rating(c));
      }
    }
  }
  add("_age", ages);
  add("_rating", [...ratings, carousel._rating({}), carousel._rating({ ratings: { play_calling: 71, recruiting: 44 } })]);
  const res = carousel._results(st);
  add("judge", Object.entries(lgd.teams).map(([slug, t]) => carousel.judge(deep(Object.fromEntries(["coaches", "ad"].filter((k) => k in t).map((k) => [k, t[k]]))), slug,
    get(res, slug, { wins: 0, losses: 0, playoff: false, conference: false }), year, st)));
  const slugs = Object.keys(lgd.teams);
  add("new_style", slugs.slice(0, 40).map((s, i) => carousel.new_style(new Random(`ns${i}`), lgd, s)));
  add("generated", slugs.slice(0, 30).map((s, i) => carousel.generated(new Random(`g${i}`), lgd, roles[i % 3], s, year,
    i % 2 ? get(lgd.teams[s].coaches, roles[i % 3]) : null, (i % 7) - 3.5)));
  add("_ratings_for", slugs.slice(0, 30).map((s, i) => {
    const c = lgd.teams[s].coaches.offensive_coordinator || lgd.teams[s].coaches.head_coach;
    const rng = new Random(`rf${i}`);
    return roles.map((r) => carousel._ratings_for(lgd, r, { ratings: c.ratings, role: "offensive_coordinator" }, rng, i - 10.0));
  }));
  const ent = [];
  slugs.slice(0, 30).forEach((s, i) => {
    for (const [role, c] of Object.entries(lgd.teams[s].coaches)) {
      if (c && c.name) {
        const e = carousel._entry(deep(c), role, i % 3 ? s : null, "Looking", year, [role], new Random(`e${i}${role}`));
        ent.push([e, carousel._previous_job(e), carousel._fired_why(s, get(res, s, {}))]);
      }
    }
  });
  add("_entry", ent);
  const later = deep({ id: st.id, seed: get(st, "seed"), year: get(st, "year"), team: me, offseason: { year },
    league: { teams: Object.fromEntries(Object.entries(lgd.teams).map(([s, t]) => [s, { coaches: t.coaches }])) } });
  const mk = carousel.market(later);
  add("market", mk);
  for (const e of mk.coaches.slice(0, 40)) e.year -= 1;
  later.offseason.year = year + 2;
  carousel.market_refresh(later);
  add("market_refresh", later.league.market);
  return got;
}

// ----- the careers -------------------------------------------------------------------------------------------------------
let bad = 0, cases = 0, good = 0, close = 0, loose = 0, small = 0, small_good = 0, ties = 0;
const report = (label, found) => {
  close += found.close || 0;
  if (found.length) { bad++; console.log(`DIFFERENT ${label}`); for (const f of found) console.log("   " + f); }
  return !found.length;
};
for (const name of setup.careers) {
  const base = read(`${name}_base.json`);
  const games_text = fs.readFileSync(path.join(out, `${name}_games.json`), "utf8");
  const fresh = () => {
    const st = deep(base.state);
    st.games = parse_ordered(games_text, [["games"]]).games;
    return st;
  };
  season.use_league(base.league_file ? path.join(out, base.league_file) : null);
  {
    const st = fresh();
    start_replay(st, base.calls);
    let got;
    try { got = pure(st); } catch (e) { bad++; console.log(`FAILED ${name} small functions: ${e.message}`); got = []; }
    for (const [i, [label, want]] of base.pure.entries()) {
      small++;
      const found = [];
      if (!got[i] || got[i][0] !== label) found.push(`no answer for ${label}`);
      else diff(want, got[i][1], "", found);
      if (report(`${name} ${label}`, found)) small_good++;
    }
    if (left_over()) { bad++; console.log(`${name} small functions: ${left_over()} of Python's calls were never made`); }
  }
  const files = fs.readdirSync(out).filter((f) => f.startsWith(`${name}_case_`)).sort();
  for (const f of files) {
    const c = read(f);
    cases++;
    const st = fresh();
    for (const [keys, value] of c.changes) put(st, keys, value);
    start_replay(st, c.calls);
    const found = [];
    try {
      const res = json(carousel.run(st));
      // offers and openings are sorted from a set in Python: programs exactly as attractive come out in the order of
      // their hashes there (another order each run of Python), in the order they opened here. Where the two lists
      // differ only so (the same attraction at every place), Python's order is taken for the rest of the case.
      const worth = {};
      for (const [name, args, value] of c.calls) if (name === "programs.attract") worth[args[1]] = value;
      for (const k of ["offers", "openings"]) {
        const py = c.result[k], js = res[k];
        if (JSON.stringify(py) !== JSON.stringify(js) && py.length === js.length && py.every((s, i) => worth[s] === worth[js[i]])) {
          ties++;
          res[k] = py;
        }
      }
      diff(c.result, res, "result", found);
      diff(c.after, json(left(st)), "after", found);
      const more = extras(st, res);
      for (const [i, [label, want]] of c.extras.entries()) {
        if (!more[i] || more[i][0] !== label) found.push(`no answer for ${label}`);
        else diff(want, more[i][1], `extras ${label}`, found);
      }
      if (left_over()) found.push(`${left_over()} of Python's calls were never made`);
    } catch (e) {
      found.push(`threw: ${e.stack.split("\n").slice(0, 4).join(" | ")}`);
    }
    loose += R.loose;
    if (report(c.label, found)) good++;
  }
}
console.log(`carousel.run: ${good} of ${cases} cases the same (record, every team's coaches, AD and style, the market, ${read(`${setup.careers[0]}_case_00.json`).extras.length} more reads each)`);
console.log(`small functions: ${small_good} of ${small} groups the same`);
console.log(`numbers within 1e-9 but not equal: ${close}; programs.attract asked in another order than Python's (a set walked): ${loose}; `
  + `offers or openings in another order among equally attractive programs: ${ties}`);
process.exit(bad ? 1 : 0);
