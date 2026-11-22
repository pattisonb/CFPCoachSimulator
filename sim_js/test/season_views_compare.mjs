// Everything the pages read from a season, asked of the JavaScript season (sim_js/season.js) at the points and in the
// order season_views_reference.py asked the Python, the changes a page can make made the same way in between, and
// every answer compared, key order included: node sim_js/test/season_views_compare.mjs OUT [--all]
// (after CFP_CLEAR=0 python3 sim_js/test/season_views_reference.py OUT [team] [seed]). --all: do not stop at a
// checkpoint with differences.
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { set_reader, set_store, env } from "../../engine_js/files.js";
import { modules } from "../../engine_js/modules.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = process.argv[2];
const ALL = process.argv.includes("--all");
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

const setup = JSON.parse(fs.readFileSync(path.join(out, "setup.json"), "utf8"));
// the modules the season asks that are not ported yet: constants, and Python's own answers replayed in the order asked
const stubs = JSON.parse(fs.readFileSync(path.join(out, "stubs.json"), "utf8"));
const plain = (v) => (v && typeof v === "object" && !Array.isArray(v) && "$d" in v ? Object.fromEntries(v.$d.map(([k, x]) => [k, plain(x)]))
  : Array.isArray(v) ? v.map(plain) : v);
const replay = { grade: stubs["grade.season_grade"], word: stubs["recruiting.word"], merged: stubs["ability_goals.merged_traits"] };
const at = { grade: 0, word: 0, merged: 0 };
const next = (name) => { if (at[name] >= replay[name].length) throw new Error(`${name} asked more often than Python asked`); return replay[name][at[name]++]; };
const base_development = plain(stubs["league.base_development"]);
modules.league = { OFFENSE_ROLES: new Set(setup.OFFENSE_ROLES), TEAM_FIT: setup.TEAM_FIT, GROUP_OF: setup.GROUP_OF, base_development: () => base_development };
modules.clear = { on: () => setup.clear };
modules.promises = { snapshot_week: () => null, tags_now: () => ({}) };      // a plain season has no promises
modules.schedule_gen = { FINALE_WEEK: setup.FINALE_WEEK };
modules.grade = { season_grade: () => plain(next("grade")) };
modules.recruiting = { word: () => plain(next("word")[1]) };
modules.ability_goals = {
  on: () => setup.clear,
  merged_traits: (state, team, key) => {
    const [t, k, r] = next("merged");
    if (t !== team || k !== key) throw new Error(`merged_traits asked for ${team} ${key} where Python asked for ${t} ${k}`);
    return plain(r);
  },
};
const { season } = await import("../season.js");

const BOX_SKIP = /\/(played_at|duration_ms|created_at|saved_at)$|^\/my_boxes\/[^/]+\/id$/;        // clocks, and a box's own drawn id
let py_id = null;                                                         // the Python season's own id, where the JavaScript season has its own
const numkeys = {};              // a box's own id, clock and how long it took
const show = (v) => { const s = JSON.stringify(v); return s === undefined ? String(v) : s.slice(0, 90); };
// py: Python's answer as season_views_reference.py's enc wrote it ({"$d": [[key, value], ...]} for a dict); js: the value itself
function diff(py, js, where, found, top) {
  if (found.length >= 8) return;
  if (js === undefined) { found.push(`${where}: py ${show(py)} | js undefined`); return; }
  if (typeof js === "number" && Number.isNaN(js)) { found.push(`${where}: py ${show(py)} | js NaN`); return; }
  if (py === js) return;
  if (typeof py === "number" && typeof js === "number") {
    if (Math.abs(py - js) <= 1e-9 * Math.max(1, Math.abs(py), Math.abs(js))) { found.close = (found.close || 0) + 1; return; }
    found.push(`${where}: py ${py} | js ${js}`); return;
  }
  if (py !== null && typeof py === "object" && "$fn" in py) { if (typeof js !== "function") found.push(`${where}: py a function | js ${show(js)}`); return; }
  if (py !== null && typeof py === "object" && "$path" in py) { if (typeof js !== "string") found.push(`${where}: py a path | js ${show(js)}`); return; }
  if (py === null || js === null || typeof py !== "object" || typeof js !== "object") { found.push(`${where}: py ${show(py)} | js ${show(js)}`); return; }
  if (Array.isArray(py)) {
    if (!Array.isArray(js)) { found.push(`${where}: py a list ${show(py)} | js ${show(js)}`); return; }
    if (py.length !== js.length) { found.push(`${where}: length py ${py.length} | js ${js.length}: py ${show(py)} | js ${show(js)}`); return; }
    py.forEach((v, i) => diff(v, js[i], `${where}[${i}]`, found));
    return;
  }
  if ("$set" in py) {
    if (!(js instanceof Set)) { found.push(`${where}: py a set | js ${show(js)}`); return; }
    diff(py.$set, [...js].sort(), where, found); return;
  }
  if (Array.isArray(js) || js instanceof Set || typeof js === "function") { found.push(`${where}: py a dict | js ${show(js)}`); return; }
  const ka = py.$d.map(([k]) => k), kb = Object.keys(js);
  if (ka.join("\u0000") !== kb.join("\u0000") && Object.keys(Object.fromEntries(ka.map((k) => [k, 0]))).join("\u0000") === kb.join("\u0000")) {
    // the same keys, and the only difference is that the JavaScript object lists its whole-number keys first, in
    // order: what any page gets from JSON anyway. Counted apart and named, since it matters where the season walks one.
    numkeys[`${found.fn} ${where.replace(/\[\d+\]/g, "[]")}`] = (numkeys[`${found.fn} ${where.replace(/\[\d+\]/g, "[]")}`] || 0) + 1;
  } else if (ka.join("\u0000") !== kb.join("\u0000")) {
    const sa = new Set(ka), sb = new Set(kb);
    const only_py = ka.filter((k) => !sb.has(k)), only_js = kb.filter((k) => !sa.has(k));
    found.push(only_py.length || only_js.length ? `${where}: keys only py [${only_py.slice(0, 6)}] only js [${only_js.slice(0, 6)}]`
      : `${where}: key order differs (at ${ka.findIndex((k, i) => k !== kb[i])} of ${ka.length}: py ${ka.slice(0, 8)} | js ${kb.slice(0, 8)})`);
  }
  for (const [k, v] of py.$d) {
    if (!(k in js) || BOX_SKIP.test(`${where}/${k}`)) continue;
    diff(v, js[k], `${where}/${k}`, found);
  }
}

let state = season.new_season(setup.team, "full", setup.seed);
py_id = JSON.parse(fs.readFileSync(path.join(out, "views_00.json"), "utf8"))[0].ret.$d.find(([k]) => k === "id")[1];
state.id = py_id;                  // the season's id is drawn from the clock's dice: Python's, so a preview's seed (made from it) is the same
const teams = season.load_teams();
function resolve(a) {
  if (a === "$state") return state;
  if (a === "$teams") return teams;
  if (Array.isArray(a) && a[0] === "$player") { const t = season.team_data(state, a[1]); return [...t.offense, ...t.defense].find((p) => p.slug === a[2]); }
  if (Array.isArray(a) && a[0] === "$team") return season.team_data(state, a[1]);
  if (Array.isArray(a) && a[0] === "$game") return state.games[a[1]];
  if (Array.isArray(a) && a[0] === "$box") return season.load_box(state, a[1]);
  return a;
}

let asked = 0, same = 0, close = 0, bad = 0;
const wrong = {};                                 // function -> how many of its answers differed
function note(fn, found, label) {
  asked++;
  close += found.close || 0;
  if (!found.length) { same++; return; }
  wrong[fn] = (wrong[fn] || 0) + 1;
  if (wrong[fn] <= 3) { console.log(`  ${label}`); for (const f of found) console.log("      " + f); }
}

function run(file) {
  const steps = JSON.parse(fs.readFileSync(path.join(out, file), "utf8"));
  const before = asked - same;
  steps.forEach((step, i) => {
    const label = `${file} #${i} ${step.fn}(${(step.args || []).map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(", ").slice(0, 110)})`;
    const found = [];
    found.fn = step.fn === "const" ? `const ${step.args[0]}` : step.fn;
    if (step.fn === "state") { diff(step.ret, state, "", found, true); note("state", found, label); return; }
    if (step.fn === "const") { diff(step.ret, season[step.args[0]], "", found); note("const", found, label); return; }
    if (step.fn === "load_season") { state = season.load_season(state.id); return; }
    if (step.career) state.career = { views_test: true };
    let r, err = null;
    try {
      if (typeof season[step.fn] !== "function") throw new Error(`season.${step.fn} is not a function`);
      r = season[step.fn](...step.args.map(resolve));
    } catch (e) { err = e; }
    if (step.career) state.career = null;
    if (err) {
      const got = [err.name === "Error" ? err.constructor.name : err.name, err.message, err.code ?? null];
      if (!("err" in step)) found.push(`py answered ${show(step.ret)} | js threw ${got[0]}: ${err.message}${got[0].endsWith("Error") && err instanceof TypeError ? "\n" + err.stack.split("\n").slice(1, 4).join("\n") : ""}`);
      else if (step.err[1] !== got[1] || step.err[2] !== got[2] || (step.err[0] !== got[0] && step.err[0] !== err.constructor.name)) found.push(`py raised ${show(step.err)} | js threw ${show(got)}`);
    } else if ("err" in step) found.push(`py raised ${show(step.err)} | js answered ${show(r)}`);
    else if (step.ret === "$state") { if (r !== state) found.push("py returned the state | js did not"); }
    else {
      if ((step.fn === "load_box" || step.fn === "box_names") && r && step.ret && step.ret.$d) step.ret.$d.find(([k]) => k === "id")[1] = r.id;   // a box's own drawn id
      diff(step.ret, r === undefined ? null : r, "", found);
    }
    note(step.fn, found, label);
  });
  return asked - same - before;
}

const t0 = Date.now();
bad += run("views_once.json") ? 1 : 0;
for (let n = 0; n < setup.checkpoints; n++) {
  const file = `views_${String(n).padStart(2, "0")}.json`;
  const steps = JSON.parse(fs.readFileSync(path.join(out, file), "utf8"));
  const week = plain(steps[0].ret).current_week;
  while (state.current_week < week && !state.done) state = season.advance(state);
  const d = run(file);
  console.log(`${file} (after week ${state.current_week}${state.done ? ", done" : ""}): ${d ? d + " answers differ" : "all the same"}`);
  if (d) { bad++; if (!ALL) break; }
}
for (const name of Object.keys(at)) if (at[name] !== replay[name].length) { bad++; console.log(`${name}: Python asked ${replay[name].length} times, JavaScript ${at[name]}`); }
if (Object.keys(numkeys).length) console.log("whole-number keys listed in JavaScript's order (same keys, same values):", JSON.stringify(numkeys, null, 1));
console.log(`${asked} answers asked, ${same} the same, ${asked - same} different (${close} numbers differ only past the ninth digit)`, `${Date.now() - t0} ms`);
if (Object.keys(wrong).length) console.log("different by function:", JSON.stringify(wrong));
process.exit(bad ? 1 : 0);
