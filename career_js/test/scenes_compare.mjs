// career_js/scenes.js held to coach_career/scenes.py: every constant, and every recorded call of every function, fed the
// same state and arguments and compared exactly (key order included):
//   python3 career_js/test/scenes_reference.py OUT && node career_js/test/scenes_compare.mjs OUT
// The modules scenes asks that are not ported yet (recruiting, persona, programs, clear) answer from Python's own
// recorded answers, in the order Python asked them; a call out of order or with other arguments is a failure.
// The season (records, ranks, team names) is the JavaScript one, on the same games.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { set_reader, set_store } from "../../engine_js/files.js";
import { modules } from "../../engine_js/modules.js";
import { Random, parse_ordered } from "../../engine_js/pyrt.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = process.argv[2];
if (!out) { console.error("usage: node career_js/test/scenes_compare.mjs OUT"); process.exit(2); }
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

const setup = JSON.parse(fs.readFileSync(path.join(out, "setup.json"), "utf8"));
const pool = fs.readFileSync(path.join(out, "pool.jsonl"), "utf8").split("\n").filter((x) => x);   // Python's answers, each once

// ---- the modules not ported yet: Python's recorded answers, in order ------------------------------------------------
let replay = null;                                   // { calls, at, state } for the case being run
const text_of = (v) => JSON.stringify(v, (k, x) => (x === undefined ? "$undefined" : x));
function stub(mod, name) {
  return (...args) => {
    const c = replay.calls[replay.at];
    if (!c) throw new Error(`python made ${replay.calls.length} calls; javascript asks one more: ${mod}.${name}`);
    if (c[0] !== mod || c[1] !== name) throw new Error(`call ${replay.at + 1}: python asked ${c[0]}.${c[1]}, javascript asks ${mod}.${name}`);
    while (args.length && args[args.length - 1] === undefined) args.pop();
    const mine = text_of(args.map((a) => (a === replay.state ? "$state" : a)));
    if (mine !== JSON.stringify(c[2])) throw new Error(`call ${replay.at + 1} ${mod}.${name}: arguments differ\n    py ${JSON.stringify(c[2]).slice(0, 600)}\n    js ${mine.slice(0, 600)}`);
    replay.at++;
    return JSON.parse(pool[c[3]]);
  };
}
function stubs(mod) {
  const o = { ...setup.constants[mod] };
  for (const name of setup.wrapped[mod]) o[name] = stub(mod, name);
  return o;
}
modules.recruiting = stubs("recruiting");
modules.persona = stubs("persona");
modules.programs = stubs("programs");
modules.clear = stubs("clear");
const { season } = await import("../../sim_js/season.js");
const { scenes } = await import("../scenes.js");

// ---- exact comparison, key order included -------------------------------------------------------------------------
function diff(a, b, where, found) {
  if (found.length >= 6) return;
  if (a === b) return;
  if (a === null || b === null || a === undefined || b === undefined || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) {
    found.push(`${where}: py ${JSON.stringify(a)?.slice(0, 200)} | js ${b === undefined ? "undefined" : JSON.stringify(b)?.slice(0, 200)}`); return;
  }
  if (Array.isArray(a)) {
    if (a.length !== b.length) { found.push(`${where}: length py ${a.length} | js ${b.length}: py ${JSON.stringify(a).slice(0, 300)} | js ${JSON.stringify(b).slice(0, 300)}`); return; }
    a.forEach((v, i) => diff(v, b[i], `${where}[${i}]`, found));
    return;
  }
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.join("\u0000") !== kb.join("\u0000")) { found.push(`${where}: keys py [${ka}] | js [${kb}]`); return; }
  for (const k of ka) diff(a[k], b[k], `${where}/${k}`, found);
}

let bad = 0;
const fail = (what, lines) => { bad++; if (bad <= 25) console.log(`DIFFERS ${what}\n  ${lines.join("\n  ")}`); };

// ---- the constants and the names ------------------------------------------------------------------------------------
let n_const = 0;
for (const [name, value] of Object.entries(setup.scenes_constants)) {
  const found = [];
  diff(value, scenes[name], name, found);
  if (found.length) fail(`constant ${name}`, found); else n_const++;
}
const js_functions = Object.keys(scenes).filter((k) => typeof Object.getOwnPropertyDescriptor(scenes, k).value === "function").sort();
const py_functions = setup.scenes_functions.slice().sort();
if (js_functions.join() !== py_functions.join()) {
  fail("the functions on the namespace", [`only python: ${py_functions.filter((x) => !js_functions.includes(x))}`, `only javascript: ${js_functions.filter((x) => !py_functions.includes(x))}`]);
}
const js_names = Object.keys(scenes).filter((k) => !js_functions.includes(k)).sort();
const py_names = Object.keys(setup.scenes_constants).sort();
if (js_names.join() !== py_names.join()) {
  fail("the constants on the namespace", [`only python: ${py_names.filter((x) => !js_names.includes(x))}`, `only javascript: ${js_names.filter((x) => !py_names.includes(x))}`]);
}
console.log(`constants: ${n_const} of ${Object.keys(setup.scenes_constants).length} the same; functions on the namespace: ${js_functions.length}`);

// ---- the cases ------------------------------------------------------------------------------------------------------
const epochs = new Map();
function epoch(id) {
  if (!epochs.has(id)) {
    if (epochs.size > 3) epochs.clear();
    epochs.set(id, parse_ordered(fs.readFileSync(path.join(out, "epochs", `${id}.json`), "utf8"), [["games"]]));
  }
  return epochs.get(id);
}
const decode = (a, state) => (a === "$state" ? state : a !== null && typeof a === "object" && "$rng" in a ? new Random(a["$rng"]) : a);
const encode = (a, state) => (a === state && state !== null ? "$state" : a instanceof Random ? "$rng" : a);

const counts = {}, matched = {};
const lines = fs.readFileSync(path.join(out, "cases.jsonl"), "utf8").split("\n");
const t0 = Date.now();
for (const text of lines) {
  if (!text) continue;
  const c = JSON.parse(text);
  counts[c.fn] = (counts[c.fn] || 0) + 1;
  let state = null;
  if (c.state !== null) {
    const e = epoch(c.epoch);
    season.use_league(e.league);
    state = c.state;
    state.games = e.games;
    state.polls = e.polls;
  }
  setup.constants.clear_on = c.clear;
  replay = { calls: c.calls, at: 0, state };
  const args = c.args.map((a) => decode(a, state));
  const found = [];
  let got;
  try {
    got = scenes[c.fn](...args);
    if (replay.at !== c.calls.length) found.push(`python made ${c.calls.length} calls to other modules, javascript ${replay.at} (next: ${c.calls[replay.at].slice(0, 2).join(".")})`);
  } catch (err) {
    found.push(String(err.stack || err).split("\n").slice(0, 4).join("\n    "));
  }
  if (!found.length) {
    diff(c.out, got === undefined ? null : got, "result", found);
    diff(c.args_after, args.map((a) => encode(a, state)).map((a, i) => (a === "$rng" ? c.args_after[i] : a)), "arguments after", found);
    if (state !== null && c.post) {
      const rc = state.recruiting;
      const contact = ((rc.contacts || {})[c.post.pid] || {})[c.post.slug] || {};
      diff(c.post.heard_rival, "heard_rival" in contact ? contact.heard_rival : "$absent", "contact heard_rival after", found);
      const seen = ((rc.revealed || {})[c.post.slug] || {})[c.post.pid];
      diff(c.post.revealed, seen === undefined ? "$absent" : seen, "revealed after", found);
    }
  }
  if (found.length) fail(`${c.fn} (case ${c.n}, ${c.tag})`, found); else matched[c.fn] = (matched[c.fn] || 0) + 1;
}

let total = 0, same = 0;
for (const fn of Object.keys(counts).sort()) {
  total += counts[fn]; same += matched[fn] || 0;
  console.log(`${fn.padEnd(18)} ${String(matched[fn] || 0).padStart(6)} of ${String(counts[fn]).padStart(6)} the same`);
}
const never = js_functions.filter((f) => !(f in counts));
console.log(`${same} of ${total} cases the same in ${((Date.now() - t0) / 1000).toFixed(1)}s; functions never called directly: ${never.join(", ") || "none"}`);
if (bad || same !== total) { console.log(`FAILED: ${bad} differences`); process.exit(1); }
console.log("scenes: the JavaScript gives Python's answers");
