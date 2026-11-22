// career_js/offseason/part2.js (coach_career/offseason.py, lines 812 to 1667) held to the Python's answers:
//
//     python3 career_js/test/offseason_part2_reference.py OUT [--quick] && node career_js/test/offseason_part2_compare.mjs OUT
//
// The part is loaded alone, on the offseason's namespace. What it needs of the file's other parts is given here: their
// constants (from the Python, setup.json), `house`, `_attrs`, `seed_key` and `_rng` written out (a line each), and
// `_record` and `_carry_over` replayed from the Python's answers, as are the season, recruiting, persona and the
// stateful functions of programs, carousel, promises, word, prospects and league. Every replayed call must come in
// the Python's order with the Python's arguments.
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { use_repo_files, differences } from "./compare_tools.mjs";
import { Random, int, get } from "../../engine_js/pyrt.js";
import { modules } from "../../engine_js/modules.js";

const out = process.argv[2];
use_repo_files();
const setup = JSON.parse(fs.readFileSync(path.join(out, "setup.json"), "utf8"));

const { offseason } = await import("../offseason_ns.js");
const shape = (v) => (v !== null && typeof v === "object" && !Array.isArray(v) && "$set" in v ? new Set(v["$set"]) : v);
for (const [k, v] of Object.entries(setup.offseason)) offseason[k] = shape(v);
offseason.seed_key = (state) => (get(state, "seed") !== null ? state["seed"] : state["id"]);
offseason._rng = (state, what) => new Random(`offseason-${offseason.seed_key(state)}-${get(state, "year", 2026)}-${what}`);
offseason._attrs = (lgd) => lgd["attrs"];
offseason.house = (pos, ovr) => int(ovr);
await import("../offseason/part2.js");
const { programs } = await import("../programs.js");
const { carousel } = await import("../carousel.js");
const { promises } = await import("../promises.js");
const { word } = await import("../word.js");
const { prospects } = await import("../prospects.js");
const { league } = await import("../league.js");
const { clear } = await import("../clear.js");

// ----- values kept in their own files -----------------------------------------------------------------------------------

const TEXT = new Map(), PARSED = new Map();
const is_file = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && typeof v["$file"] === "string";
function text_of(name) {
  if (!TEXT.has(name)) {
    if (TEXT.size > 40) TEXT.clear();
    TEXT.set(name, zlib.gunzipSync(fs.readFileSync(path.join(out, name))).toString("utf8"));
  }
  return TEXT.get(name);
}
/** A value of a case, read from its file when it has one (a new copy each time). */
const val = (v) => (is_file(v) ? JSON.parse(text_of(v["$file"])) : v);
/** ... the same object each time (what a stub hands back, never changed by the part). */
function shared(v) {
  if (!is_file(v)) return v;
  if (!PARSED.has(v["$file"])) {
    if (PARSED.size > 60) PARSED.clear();
    PARSED.set(v["$file"], JSON.parse(text_of(v["$file"])));
  }
  return PARSED.get(v["$file"]);
}

// ----- the stubs: the Python's answers, in the Python's order ------------------------------------------------------------

const S = { state: null, calls: null, i: 0, problems: [] };
const mark = (v) => (v === S.state ? "$state" : v !== null && v !== undefined && S.state !== null && v === S.state["league"] ? "$lgd" : v);
const jsonable = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

function ext(label, norm = (a) => a.map(mark), effect = null) {
  return (...a) => {
    const e = S.calls[S.i++];
    if (!e || e.fn !== label) throw new Error(`a call out of order: the JavaScript asks ${label}, the Python asked ${e ? e.fn : "nothing more"} (call ${S.i})`);
    const found = differences(val(e.args), jsonable(norm(a)));
    if (found.length) S.problems.push(`${label} (call ${S.i}) asked differently: ${found.slice(0, 3).join("; ")}`);
    if (e.raise) throw new TypeError(`${e.raise} (the Python's)`);
    const ret = shared(e.ret);
    if (effect) effect(a, e, ret);
    return ret === undefined ? null : ret;
  };
}

offseason._record = ext("offseason._record");
offseason._carry_over = ext("offseason._carry_over");
modules.season = {
  season_year: ext("season.season_year"), load_teams: ext("season.load_teams"),
  _is_p4: ext("season._is_p4", (a) => [a[0]]),
};
modules.recruiting = {
  PORTAL_STARTERS: setup.recruiting.PORTAL_STARTERS, PORTAL_WALK_ON: setup.recruiting.PORTAL_WALK_ON,
  market_value: ext("recruiting.market_value"),
  attributes: ext("recruiting.attributes", (a) => ["$state", a[1]["id"], a[2] === undefined ? "potential" : a[2]]),
  early_signing_week: ext("recruiting.early_signing_week"), auto_mode: ext("recruiting.auto_mode"),
  top_group: ext("recruiting.top_group"), portal_spots: ext("recruiting.portal_spots"), needs: ext("recruiting.needs"),
  // the log's line is made here as recruiting._event makes it (the part reads the log afterwards), and held to the Python's
  _event: ext("recruiting._event", (a) => ["$state", a[1], a[2], a[3] === undefined ? null : a[3], a[4] === undefined ? {} : a[4]], (a, e, ret) => {
    const [state, kind, pid, school, extra] = a;
    const line = { "week": state["current_week"], "kind": kind, "pid": pid, "school": school === undefined ? null : school, ...(extra || {}) };
    if (get(state["recruiting"], "portal")) line["portal_week"] = get(state["recruiting"], "week");
    state["recruiting"]["log"].push(line);
    const found = differences(ret, line);
    if (found.length) S.problems.push(`recruiting._event's line: ${found.slice(0, 3).join("; ")}`);
  }),
  reset_caches: ext("recruiting.reset_caches"),
};
modules.persona = { of: ext("persona.of") };
word.apply_bands = ext("word.apply_bands");
carousel._results = ext("carousel._results");
programs.final_ranks = ext("programs.final_ranks");
programs.z = ext("programs.z");
programs.update = ext("programs.update", (a) => [a[0], a[1], a[2], a[3] === undefined ? null : a[3]], (a, e) => {
  for (const [s, tier] of Object.entries(e.effect)) a[0]["league"]["teams"][s]["program"]["tier"] = tier;
});
prospects.history_index = ext("prospects.history_index");
league.team_meta = ext("league.team_meta");
promises.bands = ext("promises.bands");

// ----- what a function gives back, as JSON (as the reference script writes it) -------------------------------------------

const RET = {
  _would_start: (r) => [...r].sort(),
  draft_scores: (r) => [r[0].map(([s, slug, p]) => [s, slug, p["id"]]), [...r[1]].sort()],
  draft_board: (r) => [[...r[0]].sort(), r[1]],
};

const at = (root, p) => p.reduce((o, k) => o[k], root);
function resolve(v, st, rngs) {
  if (v === "$state") return st;
  if (v === "$lgd") return st["league"];
  if (v !== null && typeof v === "object" && !Array.isArray(v) && "$path" in v) return at(st, v["$path"]);
  if (v !== null && typeof v === "object" && !Array.isArray(v) && "$rng" in v) { rngs.push(new Random(v["$rng"])); return rngs[rngs.length - 1]; }
  return jsonable(v);
}
function watched(st, p) {
  try {
    const v = at(st, p.split("/").map((k) => (/^\d+$/.test(k) ? Number(k) : k)));
    return v === undefined ? "$missing" : v;
  } catch (exc) {
    return "$missing";
  }
}

// ----- the cases ---------------------------------------------------------------------------------------------------------

if (differences(setup.mine, { STORY_OTHERS: offseason.STORY_OTHERS, LIFE_KEEP: offseason.LIFE_KEEP, STARTERS: offseason.STARTERS,
  PORTAL_WEEKS_DONE: offseason.PORTAL_WEEKS_DONE }).length) throw new Error("the part's constants differ from the Python's");
if (promises.BENT_MULT !== setup.BENT_MULT) throw new Error("promises.BENT_MULT differs");

const lines = fs.readFileSync(path.join(out, "cases.jsonl"), "utf8").split("\n").filter(Boolean);
const tally = {}, bad = [];
let cases = 0, steps_run = 0, close = 0, asked = 0;
const close_at = {};
let ro_key = null, ro_state = null;

for (const line of lines) {
  const c = JSON.parse(line);
  cases++;
  let st;
  if (c.fresh) st = val(c.state);
  else {
    if (ro_key !== c.state["$file"]) { ro_key = c.state["$file"]; ro_state = val(c.state); }
    st = ro_state;
  }
  for (const [p, value] of c.patch || []) at(st, p.slice(0, -1))[p[p.length - 1]] = jsonable(value);
  S.state = st; S.calls = val(c.calls); S.i = 0; S.problems = [];
  clear.CLEAR = c.clear;
  const opts = c.close ? { close: 1e-12 } : {};
  const found = [];
  const same = (what, py, js) => {
    const d = differences(py, js, opts);
    close += d.close;
    if (d.close) close_at[what.trim()] = (close_at[what.trim()] || 0) + d.close;
    for (const f of d.slice(0, 4)) found.push(`${what}${f}`);
  };
  try {
    c.steps.forEach((s, n) => {
      if ("set" in s) { const [p, value] = s.set; at(st, p.slice(0, -1))[p[p.length - 1]] = jsonable(value); return; }
      steps_run++;
      tally[s.fn] = (tally[s.fn] || 0) + 1;
      const rngs = [];
      const args = s.args.map((v) => resolve(v, st, rngs));
      const where = `step ${n + 1} ${s.fn}: `;
      let r, raised = null;
      try {
        r = offseason[s.fn](...args);
      } catch (exc) {
        if (!(exc instanceof offseason.RosterError)) throw exc;
        raised = [exc.code, exc.message];
      }
      if (raised || s.raise) same(`${where}raised `, s.raise || null, raised);
      else same(`${where}returned `, val(s.ret) ?? null, r === undefined ? null : (RET[s.fn] || ((x) => x))(r));
      for (const [i, v] of Object.entries(s.after || {})) same(`${where}argument ${i} afterwards `, val(v), args[Number(i)]);
      if (s.rng_next) same(`${where}the next random number `, s.rng_next, rngs.map((g) => g.random()));
    });
    if (S.i !== S.calls.length) found.push(`the Python made ${S.calls.length} calls out of the part, the JavaScript ${S.i}`);
    for (const [p, value] of c.watch || []) same(`afterwards ${p} `, val(value), watched(st, p));
  } catch (exc) {
    found.push(`threw ${exc && exc.stack ? exc.stack.split("\n").slice(0, 3).join(" | ") : exc}`);
  }
  asked += S.i;
  found.push(...S.problems.slice(0, 4));
  if (found.length) {
    bad.push(c.name);
    if (bad.length <= 25) { console.log(`DIFFERENT ${c.name}`); for (const f of found.slice(0, 6)) console.log("   " + f); }
  }
}

console.log(Object.entries(tally).map(([k, n]) => `${k} ${n}`).join(", "));
const missing = Object.keys(setup.count).filter((k) => tally[k] !== setup.count[k]);
if (missing.length) console.log(`NOT RUN as often as the Python: ${missing.join(", ")}`);
console.log(`${cases} cases, ${steps_run} calls of ${Object.keys(tally).length} functions, ${asked} calls out of the part replayed; ` +
  `${cases - bad.length} cases the same, ${bad.length} different` +
  (close ? `; ${close} numbers a last digit apart (${Object.entries(close_at).map(([k, n]) => `${k}: ${n}`).join(", ")})` : ""));
process.exit(bad.length || missing.length ? 1 : 0);
