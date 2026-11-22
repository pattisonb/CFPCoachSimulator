// career_js/recruiting/part3.js held to Python's answers (recruiting_part3_reference.py writes them):
//     node career_js/test/recruiting_part3_compare.mjs OUT
// The part is loaded alone on the recruiting namespace. Everything it calls outside itself (the rest of recruiting.py,
// persona, scenes, word, promises, prospects, season) is a stub that checks the call is the one Python made (the same
// function, the same arguments, in the same order), makes the changes Python's call made to the state, and answers
// as Python's did. Each case's result (or the RecruitingError), and the state afterwards, must match exactly.
import fs from "fs";
import path from "path";
import readline from "readline";
import { odict } from "../../engine_js/pyrt.js";
import { modules } from "../../engine_js/modules.js";
import { use_repo_files, read, differences } from "./compare_tools.mjs";

use_repo_files();
const out = process.argv[2];
const setup = read(out, "setup.json");
const { recruiting } = await import("../recruiting_ns.js");

const plain = (v) => {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(plain);
  if (Array.isArray(v.$set) && Object.keys(v).length === 1) return new Set(v.$set);
  const o = {};
  for (const [k, x] of Object.entries(v)) o[k] = plain(x);
  return o;
};
for (const [k, v] of Object.entries(setup.other_constants)) recruiting[k] = plain(v);
class RecruitingError extends Error {
  constructor(code, message) { super(message); this.code = code; this.message = message; }
}
recruiting.RecruitingError = RecruitingError;
await import("../recruiting/part3.js");

let bad = 0;
const say = (text) => { if (bad < 40) console.log(text); bad++; };

// the part's names and constants
for (const name of setup.mine) if (typeof recruiting[name] !== "function") say(`not on the namespace: ${name}`);
const jsonable = (v) => JSON.parse(JSON.stringify(v, (k, x) => (x instanceof Set ? { $set: [...x].sort() } : x)));
for (const [k, v] of Object.entries(setup.my_constants)) {
  const d = differences(v, jsonable(recruiting[k]));
  if (d.length) say(`constant ${k}: ${d.join("; ")}`);
}
if (!Array.isArray(recruiting._LAST_LOOK) || recruiting._LAST_LOOK[0] !== null) say("_LAST_LOOK is not [null]");
if (!(recruiting._MARKS instanceof Map)) say("_MARKS is not a Map");

// ----- the stubs ------------------------------------------------------------------------------------------------------
const CUR = { calls: null, used: null, i: 0, results: null, state: null, unordered: false, index: null, problems: null };
const at = (root, p) => p.reduce((o, k) => o[k], root);

function apply(ops) {
  for (const [op, p, v] of ops) {
    if (op === "set") at(CUR.state, p.slice(0, -1))[p[p.length - 1]] = plain_keep(v);
    else if (op === "del") delete at(CUR.state, p.slice(0, -1))[p[p.length - 1]];
    else if (op === "push") at(CUR.state, p).push(plain_keep(v));
    else if (op === "splice") { const xs = at(CUR.state, p); xs.length = 0; xs.push(...plain_keep(v)); }
    else if (op === "order") {
      const d = at(CUR.state, p);
      const kept = {};
      for (const k of v) { kept[k] = d[k]; delete d[k]; }
      for (const k of v) d[k] = kept[k];
    }
  }
}
const plain_keep = (v) => JSON.parse(JSON.stringify(v));

function same_arg(got, want) {
  if (want === "$default") return got === undefined;
  if (want === "$state") return got === CUR.state;
  if (want === "$fn") return typeof got === "function";
  if (want !== null && typeof want === "object" && !Array.isArray(want)) {
    if (want.$ref) return got === at(CUR.state, want.$ref);
    if (want.$res !== undefined && Object.keys(want).length === 1) return got === CUR.results[want.$res];
    if (want.$rng !== undefined) return got.random() === want.$rng;
  }
  return JSON.stringify(jsonable(got === undefined ? null : got)) === JSON.stringify(want);
}

function answer(res) {
  if (res === "$teams") return setup.teams;
  if (res !== null && typeof res === "object" && !Array.isArray(res)) {
    if (res.$ref) return at(CUR.state, res.$ref);
    if (res.$raise) throw new RecruitingError(res.$raise[0], res.$raise[1]);
  }
  return plain(plain_keep(res));
}

function stub(mod, name) {
  return (...args) => {
    while (args.length && args[args.length - 1] === undefined) args.pop();
    if (CUR.calls === null) throw new Error(`${mod}.${name} called outside a case`);
    const matches = (c) => c[0] === mod && c[1] === name && c[2].length === args.length && c[2].every((w, i) => same_arg(args[i], w));
    let n = -1;
    if (CUR.unordered) {                       // (a walk over a Python set: the calls are the same, their order is not)
      const key = `${mod}.${name} ${JSON.stringify(args.map((a) => (a === CUR.state ? "$state" : typeof a === "object" && a !== null ? "$o" : a)))}`;
      const queue = CUR.index.get(key) || [];
      n = queue.length ? queue.shift() : -1;
      if (n !== -1 && !matches(CUR.calls[n])) n = -1;
    } else if (CUR.i < CUR.calls.length && matches(CUR.calls[CUR.i])) {
      n = CUR.i;
    }
    if (n === -1) {
      const want = CUR.calls[CUR.i];
      const shown = JSON.stringify(args.map((a) => (a === CUR.state ? "$state" : typeof a === "function" ? "$fn" : a)), (k, x) => (x instanceof Set ? [...x] : x));
      throw new Error(`call ${CUR.i}: js ${mod}.${name}${String(shown).slice(0, 300)} | py ${want ? `${want[0]}.${want[1]}${JSON.stringify(want[2]).slice(0, 300)}` : "nothing more"}`);
    }
    CUR.i++;
    CUR.used++;
    const c = CUR.calls[n];
    apply(c[4]);
    let res;
    try { res = answer(c[3]); } finally { CUR.results[n] = res; }
    return res;
  };
}
for (const name of setup.recruiting_deps) recruiting[name] = stub("recruiting", name);
for (const [mod, names] of Object.entries(setup.external)) {
  modules[mod] = { ...(mod === "scenes" ? plain(setup.scenes) : {}) };
  for (const name of names) modules[mod][name] = stub(mod, name);
}
modules.offseason = { GROUP: setup.offseason.GROUP };

// ----- the cases ------------------------------------------------------------------------------------------------------
function decode_arg(a, state) {
  if (a === "$state") return state;
  if (a !== null && typeof a === "object" && !Array.isArray(a) && a.$ref) return at(state, a.$ref);
  return plain(a);
}
function state_out(state) {
  const text = JSON.stringify({ ...state, games: Object.entries(state.games) });
  return JSON.parse(text);
}
const sort_keys = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));

const counts = {};
let cases = 0, calls = 0, refusals = 0;
const rl = readline.createInterface({ input: fs.createReadStream(path.join(out, "cases.jsonl")), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line) continue;
  const c = JSON.parse(line);
  cases++;
  let state = null;
  if (c.state !== null) {
    state = c.state;
    state.games = odict(state.games);
  }
  const args = c.args.map((a) => decode_arg(a, state));
  Object.assign(CUR, { calls: c.calls, used: 0, i: 0, results: [], state, unordered: c.unordered, index: null });
  if (c.unordered) {
    CUR.index = new Map();
    c.calls.forEach((k, n) => {
      const key = `${k[0]}.${k[1]} ${JSON.stringify(k[2].map((a) => (a === "$state" ? "$state" : typeof a === "object" && a !== null ? "$o" : a)))}`;
      if (!CUR.index.has(key)) CUR.index.set(key, []);
      CUR.index.get(key).push(n);
    });
  }
  let got = null, error = null, broke = null;
  try {
    got = recruiting[c.fn](...args);
  } catch (e) {
    if (e instanceof RecruitingError) error = [e.code, e.message];
    else broke = e;
  }
  const where = `case ${c.n} ${c.fn} (${c.tag})`;
  calls += CUR.used;
  CUR.calls = null;
  if (broke) { say(`${where}: ${broke.message}`); continue; }
  if (CUR.used !== c.calls.length) say(`${where}: made ${CUR.used} of Python's ${c.calls.length} calls out of the part`);
  let d = differences(c.error, error);
  if (d.length) say(`${where}: error ${d.join("; ")}`);
  if (error) refusals++;
  d = differences(c.out, jsonable(got === undefined ? null : got));
  if (d.length) say(`${where}: result ${d.join("; ")}`);
  if (state !== null) {
    const py = c.after, js = state_out(state);
    // (the board's stages are filled in a walk over a Python set: the same entries, in the set's order there)
    if (py.recruiting.stages && js.recruiting.stages) { py.recruiting.stages = sort_keys(py.recruiting.stages); js.recruiting.stages = sort_keys(js.recruiting.stages); }
    d = differences(py, js);
    if (d.length) say(`${where}: state afterwards ${d.join("; ")}`);
  }
  counts[c.fn] = (counts[c.fn] || 0) + 1;
}
console.log(`${cases} cases (${refusals} of them a RecruitingError), ${calls} calls out of the part replayed`);
console.log(Object.entries(counts).sort().map(([k, v]) => `${k} ${v}`).join(", "));
console.log(bad ? `${bad} DIFFERENCES` : "all the same as Python");
process.exit(bad ? 1 : 0);
