// career_js/recruiting/part1.js held to the Python's answers (recruiting_part1_reference.py wrote them):
//   node career_js/test/recruiting_part1_compare.mjs OUTDIR
// The part is loaded alone on the recruiting namespace. What it asks the other parts of recruiting.py (interest,
// pending, _winning, _five, _returning, _group_of, _truths, reset_caches) and the modules it reaches through `modules`
// (season's teams and weeks, persona, offseason's tables) is answered from what the Python recorded, question by
// question in order; a question the Python was never asked, or an answer the JavaScript never asked for, is a difference.
import fs from "fs";
import path from "path";
import { modules } from "../../engine_js/modules.js";
import { round } from "../../engine_js/pyrt.js";
import { use_repo_files, read, copy, tally } from "./compare_tools.mjs";

use_repo_files();
const out = process.argv[2];
const { recruiting } = await import("../recruiting_ns.js");
await import("../recruiting/part1.js");

const _bits = new DataView(new ArrayBuffer(8));
const bits = (x) => { _bits.setFloat64(0, x); return _bits.getBigUint64(0).toString(16).padStart(16, "0"); };
const unbits = (h) => { _bits.setBigUint64(0, BigInt("0x" + h)); return _bits.getFloat64(0); };
/** A constant as the reference wrote it: a set as its sorted members. */
const plain = (v) => (v instanceof Set ? { __set__: [...v].sort() } : v === Infinity ? "inf" : Array.isArray(v) ? v.map(plain)
  : v !== null && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)])) : v);

// ---- the other parts and modules, answering from the record ----------------------------------------------------
let table = {}, problems = [], teams = {};
function take(name, key) {
  const k = `${name}:${JSON.stringify(key)}`;
  const q = table[k];
  if (!q || !q.length) { problems.push(`the Python was never asked ${k} (again)`); throw new Error(`no answer for ${k}`); }
  return copy(q.shift());
}
function leftovers() {
  const left = Object.entries(table).filter(([, q]) => q.length).map(([k, q]) => `${k} x${q.length}`);
  return left;
}
let resets = 0;
Object.assign(recruiting, {
  interest: (state, slug, pid) => take("recruiting.interest", [slug, pid]),
  pending: (state, slug, pid) => take("recruiting.pending", [slug, pid]),
  _winning: () => { take("recruiting._winning", []); return { winning: true }; },
  _five: (x) => take("recruiting._five", [bits(x)]),
  _returning: (slug, group) => take("recruiting._returning", [slug, group]),
  _group_of(p) {
    const g = take("recruiting._group_of", [p.id === undefined ? null : p.id]);
    if (p.group === undefined || p.group === null) p.group = g;       // (the Python's keeps his group on him)
    return g;
  },
  _truths(prospects) {
    const truths = take("recruiting._truths", []);
    for (const [pid, p] of Object.entries(prospects)) p.truth = truths[pid];
  },
  reset_caches: () => { take("recruiting.reset_caches", []); resets++; },
});
const stories = [];
modules.persona = {
  draw: (pid, seed) => take("persona.draw", [pid, seed]),
  nil_over: (state, pid) => take("persona.nil_over", [pid]).map((v) => (v === "inf" ? Infinity : v)),
  offer_mult: (state, pid) => take("persona.offer_mult", [pid]),
  pester_free: (state, pid) => take("persona.pester_free", [pid]),
  apply_stories: (state) => { stories.push(state); },
};
modules.season = { load_teams: () => teams, CCG_WEEK: null, FINAL_WEEK: null };
modules.offseason = {};

const t = tally();
const exact = (name, py_bits, js) => t.same(name, py_bits, bits(js));

// ---- static.json ------------------------------------------------------------------------------------------------
{
  const s = read(out, "static.json");
  for (const f of s.functions) t.same(`function ${f}`, "function", typeof recruiting[f]);
  for (const [name, v] of Object.entries(s.constants)) {
    if (name === "ROOT") { t.same("ROOT", "string", typeof recruiting.ROOT); continue; }
    if (name === "_ASKS") { t.same("_ASKS", true, recruiting._ASKS instanceof Map && recruiting._ASKS.size === 0); continue; }
    if (name === "_GROUP") { t.same("_GROUP", {}, recruiting._GROUP); continue; }      // (the Python's had been filled by the time it was read)
    t.same(`constant ${name}`, v, plain(recruiting[name]));
    // the order of a dict's keys, where its keys are names (a number-keyed table is only ever looked up)
    if (v !== null && typeof v === "object" && !Array.isArray(v) && !v.__set__ && !Object.keys(v).some((k) => /^\d+$/.test(k))) {
      t.same(`key order ${name}`, Object.keys(v), Object.keys(recruiting[name]));
    }
  }
  let off = 0;
  for (const [a, b, want] of s.miles) {
    const got = recruiting._miles(a, b);
    if (bits(got) === want) t.cases++;
    else if (Math.abs(got - unbits(want)) <= 4e-16 * Math.abs(got) + 1e-12) { t.cases++; off++; }      // the machine's sin/cos/asin: a last digit
    else t.same(`_miles ${a} ${b}`, unbits(want), got);
  }
  console.log(`_miles: ${s.miles.length} pairs, ${off} a last digit off (sin, cos and asin are the machine's)`);
  off = 0;
  for (const [x, want] of s.logistic) {
    const got = recruiting._logistic(x);
    if (bits(got) === want) t.cases++;
    else if (Math.abs(got - unbits(want)) <= 4e-16 * Math.abs(got)) { t.cases++; off++; }
    else t.same(`_logistic ${x}`, unbits(want), got);
  }
  console.log(`_logistic: ${s.logistic.length} values, ${off} a last digit off (exp is the machine's)`);
  for (const [name, x, want] of s.interp) t.same(`_interp ${name} ${x}`, want, recruiting._interp(recruiting[name], x));
  for (const [vals, q, want] of s.percentile) t.same(`_percentile ${q} of ${vals.length}`, want, recruiting._percentile(vals, q));
  for (const [pos, ovr, want] of s.market_value) t.same(`market_value ${pos} ${ovr}`, want, recruiting.market_value(pos, ovr));
  for (const [nil, ask, share, want] of s.is_lowball) {
    t.same(`is_lowball ${nil} ${ask} ${share}`, want, share === null ? recruiting.is_lowball(nil, ask) : recruiting.is_lowball(nil, ask, share));
  }
  for (const [ea, want] of s.group) t.same(`_group ${ea}`, want, recruiting._group(ea));

  table = { "recruiting.reset_caches:[]": Array(50).fill(null) };
  recruiting.use_league_models({});
  for (const step of s.models) {
    const before = resets;
    recruiting.use_league_models(step.models);
    t.same(`use_league_models ${step.what}: resets`, step.resets, resets - before);
    for (const [slug, want] of Object.entries(step.team_model)) t.same(`_team_model ${slug} (${step.what})`, want, recruiting._team_model(slug));
    for (const [slug, want] of Object.entries(step.baseline)) t.same(`_baseline ${slug} (${step.what})`, want, recruiting._baseline(slug));
  }
  t.same("the built-in model is the one object", true, recruiting.model() === recruiting.model()
    && recruiting._team_model("ohio-state") === recruiting.model().teams["ohio-state"]);

  for (const [pid, tname, tilt, want] of s.priorities) {
    t.same(`_priorities ${pid} ${tname}`, want, tname === null && tilt === null ? recruiting._priorities(pid)
      : recruiting._priorities(pid, tname === null ? null : recruiting[tname], tilt));
  }
  table = s.tilt_rec;
  for (const [p, d, want, after] of s.tilt_for) {
    const got = recruiting.tilt_for(p, d);
    t.same(`tilt_for ${JSON.stringify(p)} ${JSON.stringify(d)}`, want, Object.entries(got));
    if (after !== null) t.same(`tilt_for left him ${p.id}`, after, p);
  }
  for (const [p, year, seed, want] of s.nil_ask) t.same(`nil_ask ${p.id} ${year} ${seed}`, want, recruiting.nil_ask(p, year, seed));
  for (const [h, want] of s.home) t.same(`_home ${JSON.stringify(h)}`, want, recruiting._home(h));
  console.log(`static: ${t.cases} checks so far, ${t.bad} different`);
}

// ---- start_<seed>.json ------------------------------------------------------------------------------------------
teams = read(out, "teams_start.json");
for (const file of fs.readdirSync(out).filter((f) => /^start_.*\.json$/.test(f)).sort()) {
  const s = read(out, file);
  table = s.rec;
  problems = [];
  stories.length = 0;
  recruiting.use_league_models({});
  const state = s.seed === null ? {} : { rng_state: s.seed };
  if (s.year === null) recruiting.start(state); else recruiting.start(state, s.year);
  t.same(`${file}: the state start left`, s.state, state);
  t.same(`${file}: the key order of the class`, Object.keys(s.state.recruiting.prospects), Object.keys(state.recruiting.prospects));
  t.same(`${file}: the stories were asked for once, last`, true, stories.length === 1 && stories[0] === state);
  t.same(`${file}: every answer was asked for`, [], leftovers().slice(0, 5));
  console.log(`${file}: a class of ${Object.keys(state.recruiting.prospects).length}, ${t.bad} different so far`);
}

// ---- snap_<name>.json -------------------------------------------------------------------------------------------
for (const file of fs.readdirSync(out).filter((f) => /^snap_.*\.json$/.test(f)).sort()) {
  const s = read(out, file);
  const before = t.bad, start = t.cases;
  table = s.rec;
  problems = [];
  teams = s.teams;
  Object.assign(modules.season, s.season);
  modules.offseason = { GROUP: s.offseason.GROUP, UNDERCLASS_ELIGIBLE: new Set(s.offseason.UNDERCLASS_ELIGIBLE) };
  recruiting.POS_247_OF = s.POS_247_OF;
  recruiting._ASKS.clear();
  recruiting._TIERS = [null, {}];
  recruiting._CUTS = [null, {}];
  recruiting._LEAVER_CUT = [null, 0];
  recruiting._STEP_WEEK[0] = null;
  const state = s.state, rc = state.recruiting;
  const SHOW = {
    _tiers: (r, n) => (n === 0 ? Object.entries(r) : Object.keys(r).length),
    flag_cuts: (r) => Object.entries(r).map(([k, v]) => [Number(k), v]),
    attributes: (r) => Object.entries(r),
  };
  const seen = {};
  let ties = 0;
  for (const c of s.cases) {
    if (c.op === "step_week") { recruiting._STEP_WEEK[0] = c.week; continue; }
    if (c.op === "del_nil_ask") { for (const pid of c.pids) delete rc.prospects[pid].nil_ask; continue; }
    if (c.op === "del_generational") { delete rc.generational; continue; }
    if (c.op === "move_truths") {
      for (const pid of c.pids) for (const g of Object.keys(rc.prospects[pid].truth)) rc.prospects[pid].truth[g] = round(rc.prospects[pid].truth[g] * 0.5 + 3.3, 1);
      continue;
    }
    const args = c.args.map((a) => (a === "$state" ? state : a === "$rc" ? rc : typeof a === "string" && a.startsWith("$p:") ? rc.prospects[a.slice(3)] : a));
    const n = seen[c.fn] = (seen[c.fn] || 0) + 1;
    let got;
    try {
      got = recruiting[c.fn](...args.map((a) => (a === null ? undefined : a)));
    } catch (e) {
      got = `raised ${e.message}`;
    }
    if (c.fn === "upgrade_grades") got = null;
    if (SHOW[c.fn]) got = SHOW[c.fn](got, n - 1);
    t.same(`${file} ${c.fn}(${JSON.stringify(c.args).slice(0, 90)})`, c.ret, got);
  }
  const after = { contacts: rc.contacts, scenes: rc.scenes === undefined ? null : rc.scenes, generational: rc.generational === undefined ? null : rc.generational,
    grades: rc.grades === undefined ? null : rc.grades, reads: rc.reads,
    prospects: Object.fromEntries(Object.entries(rc.prospects).map(([pid, p]) => [pid, { nil_ask: p.nil_ask ?? null, group: p.group ?? null, truth: p.truth ?? null }])),
    keys: Object.keys(rc) };
  t.same(`${file}: what the calls left in the state`, s.after, after);
  t.same(`${file}: every answer was asked for`, [], leftovers().slice(0, 5));
  t.same(`${file}: no question without an answer`, [], problems.slice(0, 5));
  console.log(`${file}: ${t.cases - start} checks, ${t.bad - before} different${ties ? `, ${ties} ties` : ""}`);
}

console.log(`${t.cases} checks, ${t.bad} different`);
process.exit(t.bad ? 1 : 0);
