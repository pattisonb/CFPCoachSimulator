// career_js/recruiting/part5.js held to the Python's answers (recruiting_part5_reference.py wrote them):
//   node career_js/test/recruiting_part5_compare.mjs OUTDIR
// The part is loaded alone, on the recruiting namespace, with the other parts' constants from setup.json. Every batch:
// a fresh copy of the state the Python had, the same calls, what each returned, and what the batch left changed,
// compared exactly (key order included). What the part asks the rest of the game (the other parts of recruiting.py,
// persona, news, prospects.find) is answered from what the Python recorded; a question the Python was never asked, or
// an answer the JavaScript never asked for, is a difference. _event, _unmark and _contact are written out here. The
// weekly step's calls are notes, the same notes the Python's made.
import fs from "fs";
import path from "path";
import { modules } from "../../engine_js/modules.js";
import { Random, odict } from "../../engine_js/pyrt.js";
import { use_repo_files, read, copy, tally } from "./compare_tools.mjs";

const out = process.argv[2];
use_repo_files();
const setup = read(out, "setup.json");

// ---- the rest of the game, answering from the record ------------------------------------------------------------
let table = {}, asked = {}, problems = [], took = [], rooms = [], notes = null, fakes = null, live = null;

class Room {
  constructor(state, flier = false) { rooms.push(!!flier); }
  why_not(...args) { return take("room.why_not", args); }
  took(slug, pid, n = 1) { took.push([slug, pid, n]); }
}

function key_of(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Random) return "<rng>";
  if (v instanceof Room) return "<room>";
  if (Array.isArray(v)) return v.map(key_of);
  if (typeof v === "object") {
    if ("recruiting" in v && "team" in v) return "<state>";
    if ("prospects" in v && "status" in v) return "<rc>";
    if ("id" in v && "name" in v) return `<p:${v.id}>`;
    if (Object.keys(v).length > 20) return "<dict>";
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, key_of(x)]));
  }
  return v;
}

function apply(obj, ops) {
  for (const [op, where, value] of ops) {
    let at = obj;
    for (const k of where.slice(0, -1)) { if (at[k] === undefined) at[k] = {}; at = at[k]; }
    const last = where[where.length - 1];
    if (op === "app") at[last].push(...copy(value));
    else if (op === "del") delete at[last];
    else if (Array.isArray(at[last]) && Array.isArray(value)) at[last].splice(0, at[last].length, ...copy(value));   // in place: the part may hold the list
    else at[last] = copy(value);
  }
}

function take(name, args) {
  const k = `${name}:${JSON.stringify(key_of(args))}`;
  const q = table[k];
  const i = asked[k] || 0;
  if (!q || i >= q.length) throw new Error(`the Python was never asked ${k}${q ? ` a ${i + 1}th time` : ""}`);
  asked[k] = i + 1;
  const ans = q[i];
  if (ans.o) apply(live, ans.o);
  if (ans.e) throw new RecruitingError(ans.e[0], ans.e[1]);
  return copy(ans.r);
}

class RecruitingError extends Error {
  constructor(code, message) { super(message); this.code = code; this.message = message; }
}

const { recruiting } = await import("../recruiting_ns.js");
Object.assign(recruiting, copy(setup.recruiting), { RecruitingError, _Room: Room, _STEP_WEEK: [null] });
const stub = (label, name) => (...args) => take(`${label}.${name}`, args);
const OTHER_PARTS = ("_team_model fbs_schools _home tilt_for _priorities nil_ask tier_of close_week early_signing_week signing_week is_portal "
  + "_group_of commits_by_group interest _winning best_evaluator scout_points_left look_cost _run_planned _carry_planned act "
  + "_flush _snapshot_ranks _report _forgive_pesters _commits auto_recruit _visits _offers_by_prospect _commit _promises "
  + "_firm_up _draws").split(" ");
const PERSONA = "mate _school_name goes_pro pro_line cool_quiet bloom twist_week learn_styles roll_twists read_mult learn_from_read draw".split(" ");
const STEP_FAKES = ("_run_planned _flush _visits scout_week spend_leftover _asks_for_more _commits auto_recruit _forgive_pesters _portal_draws "
  + "_promises _firm_up _draws _sign _snapshot_ranks _report _carry_planned").split(" ");
const STEP_PERSONA = "cool_quiet bloom twist_week learn_styles roll_twists".split(" ");
for (const name of OTHER_PARTS) recruiting[name] = stub("recruiting", name);
// three small functions of other parts, as the Python has them
recruiting._event = (state, kind, pid, school = null, extra = {}) => {
  const e = { week: state.current_week, kind, pid, school, ...extra };
  if (state.recruiting.portal) e.portal_week = state.recruiting.week ?? null;
  state.recruiting.log.push(e);
  return e;
};
recruiting._unmark = (state, slug, pid) => {
  if (slug === (state.team ?? null)) {
    const marks = state.recruiting.manual_offers;
    if (marks && marks.includes(pid)) marks.splice(marks.indexOf(pid), 1);
  }
};
recruiting._contact = (state, slug, pid) => {
  const c = state.recruiting.contacts;
  if (c[pid] === undefined) c[pid] = {};
  if (c[pid][slug] === undefined) c[pid][slug] = { n: 0, hc_week: null };
  return c[pid][slug];
};
const persona = { ...setup.persona };
for (const name of PERSONA) persona[name] = stub("persona", name);
modules.persona = persona;
modules.news = { _when: stub("news", "_when") };
modules.offseason = { GROUP: setup.offseason.GROUP };
await import("../league.js");                            // the season's teams ask it for their game ratings
const { season } = await import("../../sim_js/season.js");
const { prospects } = await import("../prospects.js");
const { clear } = await import("../clear.js");
prospects.find = stub("prospects", "find");
prospects.generational_seen = stub("prospects", "generational_seen");
const clear_real = clear.on;
let clear_force = null;
clear.on = () => (clear_force === null ? clear_real() : clear_force);

await import("../recruiting/part5.js");
const part = Object.fromEntries(setup.names.map((n) => [n, recruiting[n]]));      // the part's own functions, to put back after a step of notes
const t = tally();

// ---- what the part put on the namespace ---------------------------------------------------------------------------
t.same("the part's constants", setup.mine, Object.fromEntries(Object.keys(setup.mine).map((k) => [k, recruiting[k]])));
t.same("the part's functions", setup.names, setup.names.filter((n) => typeof recruiting[n] === "function"));

// ---- a batch ------------------------------------------------------------------------------------------------------
const norm = (v) => (v instanceof Set ? [...v].sort() : v === undefined ? null : v);

function install_fakes(st, opts) {
  const note = (owner, label, name) => {
    owner[name] = (...a) => {
      const row = [`${label}.${name}`, recruiting._STEP_WEEK[0]];
      for (const x of a) row.push(x === st ? "<state>" : x instanceof Random ? x.random() : x === undefined ? null : x);
      notes.push(row);
      if (opts.boom === name) throw new StepBoom();
      if (name === "_commits") return { marker: 7 };
      if (name === "_report") { st.recruiting.log.push({ week: st.current_week, kind: "report-note" }); return {}; }
      return null;
    };
  };
  for (const name of STEP_FAKES) note(recruiting, "recruiting", name);
  for (const name of STEP_PERSONA) note(persona, "persona", name);
}
class StepBoom extends Error {}
function remove_fakes() {
  for (const name of STEP_FAKES) recruiting[name] = part[name] || stub("recruiting", name);
  for (const name of STEP_PERSONA) persona[name] = stub("persona", name);
}

function run(tag, base, b) {
  const st = copy(b.state || base);
  apply(st, b.pre);
  const want = copy(st);
  apply(want, b.ops);
  table = b.rec; asked = {}; took = []; rooms = []; notes = []; live = st;
  clear_force = b.clear;
  const rngs = [];
  if (b.fakes) install_fakes(st, b.fakes);
  const arg = (a) => {
    if (a !== null && typeof a === "object" && !Array.isArray(a) && "$" in a) {
      if (a.$ === "state") return st;
      if (a.$ === "rng") { rngs.push(new Random(a.seed)); return rngs[rngs.length - 1]; }
      if (a.$ === "room") return new Room(st, a.flier);
      if (a.$ === "read") return st.recruiting.reads[a.pid] ?? null;
      if (a.$ === "offered") return recruiting._offers_by_prospect(st);
      if (a.$ === "win") return recruiting._winning(st);
    }
    return copy(a);
  };
  const results = [];
  let crashed = null;
  try {
    for (const [fn, args] of b.calls) {
      try {
        results.push({ r: norm(recruiting[fn](...args.map(arg))) });
      } catch (e) {
        if (e instanceof RecruitingError) results.push({ e: [e.code, e.message] });
        else if (e instanceof StepBoom) results.push({ boom: true });
        else throw e;
      }
    }
  } catch (e) {
    crashed = String(e.stack || e).split("\n").slice(0, 4).join(" | ");
  } finally {
    if (b.fakes) remove_fakes();
    clear_force = null;
  }
  const name = `${tag}: ${b.name}`;
  if (crashed) { t.same(`${name} (it stopped: ${crashed})`, 1, 0); return; }
  const unasked = Object.entries(table).filter(([k, q]) => (asked[k] || 0) !== q.length).map(([k, q]) => `${k} x${q.length - (asked[k] || 0)}`);
  const sort = (xs) => xs.map((x) => JSON.stringify(x)).sort();
  t.same(`${name}: returns`, b.results, results, { close: 1e-12 });
  t.same(`${name}: state`, want, st, { close: 1e-12 });
  t.same(`${name}: asked`, { unasked: [], took: sort(b.took), rooms: b.rooms, rngs: b.rngs, notes: b.notes, step_week: b.step_week },
    { unasked: unasked.slice(0, 5), took: sort(took), rooms, rngs: rngs.map((r) => r.random()), notes, step_week: recruiting._STEP_WEEK[0] });
}

// ---- the cases that need no saved state, or their own ---------------------------------------------------------------
{
  const big = read(out, "big_stateless.json");
  const name = (slug) => `<${slug === null || slug === undefined ? "None" : slug}>`;
  const results = big.calls.map(([fn, args]) => {
    const real = args.map((a) => (a !== null && typeof a === "object" && a.$ === "name" ? name : copy(a)));
    const r = recruiting[fn](...real);
    return { r: norm(r), arg: fn === "_normalize_read" ? real[0] : null };
  });
  big.calls.forEach((c, i) => t.same(`stateless ${c[0]}(${JSON.stringify(c[1]).slice(0, 80)})`, big.results[i], results[i]));
}
{
  const big = read(out, "big_set_record.json");
  for (const c of big.cases) {
    const games = odict(copy(big.games));              // keyed by event id, in the Python's order
    recruiting._set_record({ games }, c.slug, c.wins, c.losses);
    t.same(`_set_record ${c.slug} ${c.wins}-${c.losses}`, c.after, Object.entries(games));
  }
}
{
  const big = read(out, "big_make_staff.json");
  for (const c of big.cases) {
    table = c.rec; asked = {}; live = null;
    const state = { ...copy(c.state), recruiting: { prospects: big.names } };
    let got;
    try { got = recruiting.make_staff(state); } catch (e) { got = String(e.stack || e).slice(0, 300); }
    t.same(`make_staff ${c.state.team}`, c.ret, got);
  }
}
for (const [team] of setup.careers) {
  let big = read(out, `big_truths_${team}.json`);
  recruiting._truths(big.prospects, big.attrs);
  t.same(`_truths ${team} (${Object.keys(big.truth).length} prospects)`, big.truth, Object.fromEntries(Object.entries(big.prospects).map(([q, p]) => [q, p.truth])));
  big = read(out, `big_portal_rc_${team}.json`);
  for (const r of big.runs) {
    table = r.rec; asked = {}; live = null;
    const state = copy(big.state);
    if (!r.has_seed) delete state.rng_state;
    const entrants = Object.fromEntries(Object.entries(big.entrants).slice(0, r.n));
    let got;
    try { got = recruiting.portal_rc(state, copy(entrants), r.year); } catch (e) { got = String(e.stack || e).slice(0, 400); }
    t.same(`portal_rc ${team} ${r.year} (${r.n} entrants)`, r.ret, got, { close: 1e-12 });
    const unasked = Object.entries(table).filter(([k, q]) => (asked[k] || 0) !== q.length).length;
    t.same(`portal_rc ${team} ${r.year}: asked`, 0, unasked);
  }
  t.same(`_season_line ${team} (${big.lines.length} lines)`, big.lines.map((l) => l[3]),
    big.lines.map(([slug, name, group], i) => recruiting._season_line(i === big.lines.length - 1 ? {} : big.state, slug, name, group)));
}

// ---- the saved states ---------------------------------------------------------------------------------------------------
const only = process.argv.slice(3);
for (const [team, seed] of setup.careers) {
  for (const tag of setup.tags) {
    const full = `${team}_${seed}_${tag}`;
    const file = path.join(out, `snap_${full}.jsonl`);
    if (only.length && !only.includes(full)) continue;
    if (!fs.existsSync(file)) { t.same(`${full}: no ${file}`, 1, 0); continue; }
    const lines = fs.readFileSync(file, "utf8").split("\n").filter((l) => l.length);
    const base = JSON.parse(lines[0]).state;
    const before = t.cases, bad = t.bad;
    for (const line of lines.slice(1)) run(full, base, JSON.parse(line));
    console.log(`${full}: ${lines.length - 1} batches, ${t.cases - before} checks, ${t.bad - bad} different`);
  }
}
void season;
t.done("recruiting part 5");
