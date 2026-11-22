// career_js/persona.js held to the Python's answers (persona_reference.py wrote them):
//   node career_js/test/persona_compare.mjs OUTDIR
// Every case: the state the Python had, the same calls, what it answered and what it left changed, compared exactly
// (key order included). What persona asks the modules that are not ported (recruiting, programs, carousel, clear,
// season's teams) is answered from what the Python recorded; a question the Python was never asked, or an answer the
// JavaScript never asked for, is a difference.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { set_reader } from "../../engine_js/files.js";
import { modules } from "../../engine_js/modules.js";
import { Random, parse_ordered } from "../../engine_js/pyrt.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = process.argv[2];
const abs = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));
set_reader((p) => fs.readFileSync(abs(p), "utf8"));

const { persona } = await import("../persona.js");
const stat = JSON.parse(fs.readFileSync(path.join(out, "static.json"), "utf8"));

// ---- the modules that are not ported, answering from the record ------------------------------------------------
let table = {}, asked = new Set(), flags = { clear: false }, problems = [];
const _bits = new DataView(new ArrayBuffer(8));
const bits = (x) => { _bits.setFloat64(0, x); return _bits.getBigUint64(0).toString(16).padStart(16, "0"); };
const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
function take(name, key) {
  const k = `${name}:${JSON.stringify(key)}`;
  const q = table[k];
  if (!q) throw new Error(`the Python was never asked ${k}`);
  asked.add(k);
  return clone(q.length > 1 ? q.shift() : q[0]);
}
function apply(obj, ops) {
  for (const [op, where, value] of ops) {
    let at = obj;
    for (const k of where.slice(0, -1)) at = at[k];
    const last = where[where.length - 1];
    if (op === "app") (where.length ? at[last] : at).push(...clone(value));
    else if (op === "del") delete at[last];
    else at[last] = clone(value);
  }
}

class RecruitingError extends Error {}
/** _nil and nil_left: the answer, and the school's NIL record the Python opened for it when it had none. */
function nil_record(name, state, slug) {
  const got = take(`recruiting.${name}`, [slug]);
  if (got.made !== null && state.recruiting.nil[slug] === undefined) state.recruiting.nil[slug] = got.made;
  return got.ret;
}
const given = (win) => win !== undefined && win !== null;
const recruiting = {
  ...stat.recruiting,
  RecruitingError,
  _ASKS: {},
  report_looks: (read) => take("recruiting.report_looks", [read === null || read === undefined ? null : read._pid]),
  interest: (state, slug, pid, win) => take("recruiting.interest", [slug, pid, given(win)]),
  ask_from(state, slug, pid, win) {                      // (it opens the school's contact record with him, as the Python's does)
    recruiting._contact(state, slug, pid);
    return take("recruiting.ask_from", [slug, pid, given(win)]);
  },
  _fits: (state, slug) => take("recruiting._fits", [slug]),
  _winning: () => take("recruiting._winning", []),
  _commits: () => take("recruiting._commits", []),
  open_spots: (state, slug) => take("recruiting.open_spots", [slug]),
  offer_cap: (state, slug) => take("recruiting.offer_cap", [slug]),
  nil_left: (state, slug) => nil_record("nil_left", state, slug),
  _nil: (state, slug) => nil_record("_nil", state, slug),
  best_pitch: (state, slug, pid, required = false) => take("recruiting.best_pitch", [slug, pid, !!required]),
  tier_of: (p) => take("recruiting.tier_of", [p.id, p.stars]),
  nil_ask: (p, year, seed) => take("recruiting.nil_ask", [p.id, p.stars, bits(p.composite), year, seed]),
  fbs_schools: () => take("recruiting.fbs_schools", []),
  _baseline: (slug) => take("recruiting._baseline", [slug]),
  _team_model: (slug) => take("recruiting._team_model", [slug]),
  _national_share: (stars) => take("recruiting._national_share", [stars]),
  _group_of: (p) => take("recruiting._group_of", [p.ea_position ?? null]),
  academic: (slug) => take("recruiting.academic", [slug]),
  academic_schools: () => take("recruiting.academic_schools", []),
  early_signing_week: () => take("recruiting.early_signing_week", []),
  _miles: (a, b) => take("recruiting._miles", [bits(a[0]), bits(a[1]), bits(b[0]), bits(b[1])]),
  // the three that are a line or two of their own (coach_career/recruiting.py), written out as they are there
  _rng: (state, what) => new Random(`${what}-${state.recruiting.seed}-${state.recruiting.portal ? "portal-" : ""}${state.current_week}`),
  _event(state, kind, pid, school = null, extra = {}) {
    const e = { week: state.current_week, kind, pid, school, ...extra };
    if (state.recruiting.portal) e.portal_week = state.recruiting.week ?? null;
    state.recruiting.log.push(e);
    return e;
  },
  _contact(state, slug, pid) {
    const c = state.recruiting.contacts;
    if (c[pid] === undefined) c[pid] = {};
    if (c[pid][slug] === undefined) c[pid][slug] = { n: 0, hc_week: null };
    return c[pid][slug];
  },
  _unmark(state, slug, pid) {
    if (slug === (state.team ?? null)) {
      const marks = state.recruiting.manual_offers;
      if (marks && marks.includes(pid)) marks.splice(marks.indexOf(pid), 1);
    }
  },
  // the one action path: what the Python's left changed
  _act(state, slug, pid, action, pitch = null, nil = 0) {
    const got = take("recruiting._act", [slug, pid, action, pitch, nil]);
    apply(state, got.diff);
    if (got.raise !== null) throw new RecruitingError(got.raise);
    return got.ret;
  },
};
modules.recruiting = recruiting;
modules.season = {
  load_teams: () => stat.teams,
  team_display: (slug) => stat.display[slug],
  FINAL_WEEK: stat.FINAL_WEEK,
  season_year: () => take("season.season_year", []),
};
modules.clear = { on: () => flags.clear };
modules.programs = { get: (state, slug) => take("programs.get", [slug]) };
modules.carousel = { ad: (team, slug) => take("carousel.ad", [slug]) };

// ---- comparing ------------------------------------------------------------------------------------------------------
const numberlike = (k) => /^(0|[1-9]\d*)$/.test(k);
function diff(a, b, where, found) {
  if (found.length >= 8) return;
  if (a === b) return;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) {
    found.push(`${where}: py ${JSON.stringify(a)?.slice(0, 90)} | js ${JSON.stringify(b)?.slice(0, 90)}`); return;
  }
  if (Array.isArray(a)) {
    if (a.length !== b.length) { found.push(`${where}: length py ${a.length} | js ${b.length}`); return; }
    a.forEach((v, i) => diff(v, b[i], `${where}[${i}]`, found));
    return;
  }
  let ka = Object.keys(a), kb = Object.keys(b);
  if (ka.every(numberlike) && kb.every(numberlike)) { ka = ka.slice().sort(); kb = kb.slice().sort(); }      // (a dict keyed by stars: looked up, never walked)
  if (ka.join("\u0000") !== kb.join("\u0000")) {
    const sa = new Set(ka), sb = new Set(kb);
    const only_py = ka.filter((k) => !sb.has(k)), only_js = kb.filter((k) => !sa.has(k));
    found.push(only_py.length || only_js.length ? `${where}: keys only py [${only_py.slice(0, 6)}] only js [${only_js.slice(0, 6)}]`
      : `${where}: key order differs (py ${ka.slice(0, 8)} | js ${kb.slice(0, 8)})`);
  }
  for (const k of ka) if (k in b) diff(a[k], b[k], `${where}/${k}`, found);
}
/** What Python's JSON cannot hold, written as the reference wrote it. */
function norm(v) {
  if (v === Infinity) return "Infinity";
  if (v === -Infinity) return "-Infinity";
  if (v === undefined) return null;
  if (Array.isArray(v)) return v.map(norm);
  if (v !== null && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, norm(x)]));
  return v;
}

// ---- the calls --------------------------------------------------------------------------------------------------------
function resolve(arg, state) {
  if (arg === "$state") return state;
  if (arg !== null && typeof arg === "object" && !Array.isArray(arg)) {
    const rc = state.recruiting;
    if ("$p" in arg) return rc.prospects[arg.$p];
    if ("$tw" in arg) return rc.twists[arg.$tw];
    if ("$contact" in arg) return rc.contacts[arg.$contact[0]][arg.$contact[1]];
    if ("$sd" in arg) return persona.story(state, arg.$sd)[1];
    if ("$e" in arg) return arg.$e;
  }
  return arg;
}
function call(state, fn, args, week) {
  if (fn === "$setup") {
    const [pid, kind, seed] = args;
    const rng = new Random(seed);
    const got = persona._setup(state, new persona._Week(state, week), pid, kind, rng);
    return [got, rng.random()];
  }
  if (fn === "$rerank") { persona.rerank(state.recruiting); return null; }
  if (fn === "$week_games") {
    return Object.fromEntries(Object.entries(new persona._Week(state, args[0]).games()).map(([s, gs]) => [s, gs.map((g) => g.event_id)]));
  }
  if (fn === "$week_homes") return new persona._Week(state, args[0]).homes();
  if (fn === "$week_security") { const wk = new persona._Week(state, args[0]); return [wk.security(args[1]), wk.security(args[1])]; }
  const got = persona[fn](...args.map((a) => resolve(a, state)));
  if (fn === "_his_schools") return [got[0], Object.keys(got[1]).sort().map((k) => [k, got[1][k]])];
  return got;
}
function begin(group) {
  persona._STORIES = [null, null, {}];
  persona._FRONT = [null, new Map()];
  persona._SCHOOL_STATE = {};
  recruiting._ASKS = { kept: 1 };
  table = clone(group.stubs);
  asked = new Set();
  flags.clear = group.clear;
}

const totals = { files: 0, sweeps: 0, sweep_calls: 0, cases: 0, case_calls: 0, bad: 0, by_fn: {} };
const count = (fn) => { totals.by_fn[fn] = (totals.by_fn[fn] || 0) + 1; };
function fail(text) {
  totals.bad++;
  if (problems.length < 40) problems.push(text);
}

// the constants and the fixed draws
{
  const found = [];
  for (const [name, want] of Object.entries(stat.constants)) {
    if (!(name in persona)) { found.push(`constant ${name} is not on the namespace`); continue; }
    diff(want, norm(clone(norm(persona[name]))), `constant ${name}`, found);
  }
  for (const [fn, args, want] of stat.draws) {
    diff(want, persona[fn](...args), `${fn}(${JSON.stringify(args)})`, found);
    count(fn);
  }
  for (const f of found) fail(f);
  console.log(`constants: ${Object.keys(stat.constants).length}; fixed draws: ${stat.draws.length}; ${found.length ? "DIFFERENT" : "the same"}`);
}

const files = fs.readdirSync(out).filter((f) => /^(apply|step|snap)_.*\.json$/.test(f)).sort();
for (const file of files) {
  const text = fs.readFileSync(path.join(out, file), "utf8");
  const data = parse_ordered(text, [["state", "games"]]);        // (the games in the order the Python walks them)
  const state_text = JSON.stringify(data.state);
  const fresh = (pre) => { const s = parse_ordered(state_text, [["games"]]); apply(s, pre); return s; };
  totals.files++;
  const bad_before = totals.bad;
  for (const [gi, group] of data.groups.entries()) {
    const label = `${file} #${gi} ${group.kind}${group.name ? ` "${group.name}"` : ""}`;
    begin(group);
    if (group.kind === "sweep") {
      totals.sweeps++;
      const state = fresh(group.pre);
      for (const [fn, args, want] of group.entries) {
        totals.sweep_calls++;
        count(fn);
        let got;
        try { got = norm(clone(norm(call(state, fn, args, data.week)))); } catch (e) { fail(`${label} ${fn}(${JSON.stringify(args).slice(0, 100)}): ${e.message}`); continue; }
        const found = [];
        diff(want, got, "", found);
        if (found.length) fail(`${label} ${fn}(${JSON.stringify(args).slice(0, 100)}) ${found[0]}`);
      }
      const found = [], want = fresh([]);
      apply(want, group.diff);
      diff(want, state, "state", found);
      if (found.length) fail(`${label}: the state after the reads: ${found[0]}`);
    } else {
      totals.cases++;
      const state = fresh(group.pre);
      const rets = [];
      let threw = null;
      for (const [fn, args] of group.calls) {
        totals.case_calls++;
        count(fn === "$setup" ? `_setup:${args[1]}` : fn);
        try { rets.push(norm(clone(norm(call(state, fn, args, data.week))))); } catch (e) { threw = `${fn}: ${e.stack.split("\n").slice(0, 3).join(" ")}`; break; }
      }
      const name = `${label} ${group.calls.map((c) => c[0] + (c[0] === "$setup" ? `:${c[1][1]}:${c[1][0]}` : "")).slice(0, 2).join(",")}`;
      if (threw) { fail(`${name}: ${threw}`); continue; }
      const found = [];
      diff(group.rets, rets, "returned", found);
      const want = fresh([]);                  // (the Python's diff is from the file's state, `pre` included)
      apply(want, group.diff);
      diff(want, state, "state", found);
      for (const [k, q] of Object.entries(table)) {
        if (!asked.has(k)) found.push(`the JavaScript never asked ${k}`);
        else if (q.length > 1) found.push(`${q.length - 1} answers left for ${k}`);
        if (found.length > 10) break;
      }
      if (group.calls.some((c) => c[0] === "bloom") && group.rets.some((r) => Array.isArray(r) && r.length) && Object.keys(recruiting._ASKS).length) {
        found.push("recruiting._ASKS was not cleared");
      }
      for (const f of found.slice(0, 3)) fail(`${name}: ${f}`);
    }
  }
  const bad_here = totals.bad - bad_before;
  console.log(`${file}: ${data.groups.length} groups, ${bad_here ? `${bad_here} DIFFERENT` : "the same"}`);
}

console.log(`\n${totals.files} files; ${totals.sweeps} read-only sweeps (${totals.sweep_calls} calls); ${totals.cases} cases that change the state (${totals.case_calls} calls)`);
console.log(`calls by function: ${Object.entries(totals.by_fn).sort().map(([k, n]) => `${k} ${n}`).join(", ")}`);
const never = Object.keys(persona).filter((k) => typeof persona[k] === "function" && !(k in totals.by_fn) && !Object.keys(totals.by_fn).some((f) => f.startsWith(`${k}:`)));
console.log(`functions never called directly: ${never.join(", ") || "none"}`);
if (problems.length) {
  console.log(`\n${totals.bad} DIFFERENCES`);
  for (const p of problems) console.log(`  ${p}`);
  process.exit(1);
}
console.log("\neverything the same");
