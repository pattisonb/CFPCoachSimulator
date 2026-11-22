// career_js/headquarters.js against the Python it was ported from: node career_js/test/headquarters_compare.mjs OUTDIR
// (after python3 career_js/test/headquarters_reference.py OUTDIR). The reference's script of calls is run here on the
// same saved careers, in the same order, and every answer (or the LayoutError's words) and the Headquarters block
// left in the save are compared exactly, key order included. The season is the JavaScript season; recruiting,
// offseason, prospects' class functions, promises and programs answer what Python's answered, call by call, and a
// call made out of Python's order or with other arguments fails the step.
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { set_reader, set_store, env } from "../../engine_js/files.js";
import { modules } from "../../engine_js/modules.js";
import { parse_ordered } from "../../engine_js/pyrt.js";

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
let R = null;       // the career being replayed: { state, queues: {name: {items, head}} }
function norm(a) {
  if (a === R.state) return "<state>";
  if (a !== null && typeof a === "object" && !Array.isArray(a) && "id" in a && "composite" in a) return { id: a.id };
  return a === undefined ? null : a;
}
function start_replay(state, calls) {
  R = { state, queues: {} };
  for (const [name, args, value] of calls) (R.queues[name] ??= { items: [], head: 0 }).items.push({ key: JSON.stringify(args), value });
}
const left_over = () => Object.values(R.queues).reduce((n, q) => n + q.items.length - q.head, 0);
const replay = (name) => (...args) => {
  while (args.length && args[args.length - 1] === undefined) args.pop();
  const key = JSON.stringify(args.map(norm));
  const q = R.queues[name];
  const c = q && q.items[q.head];
  if (!c || c.key !== key) throw new Error(`${name}: asked ${key.slice(0, 160)} where Python asked ${c ? c.key.slice(0, 160) : "nothing more"}`);
  q.head++;
  return deep(c.value);
};
const stub = (mod, names) => Object.fromEntries(names.map((n) => [n, replay(`${mod}.${n}`)]));
modules.league = { OFFENSE_ROLES: new Set(setup.OFFENSE_ROLES), TEAM_FIT: setup.TEAM_FIT, GROUP_OF: setup.GROUP_OF };
modules.clear = { on: () => setup.clear };
modules.promises = { snapshot_week: () => null, ...stub("promises", ["chips_now"]) };
modules.programs = stub("programs", ["rows"]);
modules.recruiting = { CONTACT_KINDS: setup.CONTACT_KINDS, reset_caches: () => null,
  ...stub("recruiting", ["latest_report", "spot_of_player", "spot_of", "needs_by_spot", "money_owed", "open_spots", "spot_matches", "cooled"]) };
modules.offseason = { PORTAL_BASE: setup.PORTAL_BASE, PORTAL_USAGE: setup.PORTAL_USAGE, PORTAL_LOSING: setup.PORTAL_LOSING,
  UNDERCLASS_ELIGIBLE: new Set(setup.UNDERCLASS_ELIGIBLE), GROUP: setup.GROUP, NEXT_CLASS: setup.NEXT_CLASS, ...stub("offseason", ["player_next"]) };
const { season } = await import("../../sim_js/season.js");
const { headquarters } = await import("../headquarters.js");
// prospects is ported in part (its namespace is the one the season loaded): the class functions answer from Python
const class_rc = replay("prospects.class_rc");
Object.assign(modules.prospects, stub("prospects", ["class_table", "class_points", "class_rank"]),
  { class_rc: (state) => state[class_rc(state)] });      // (Python's answer says which block: the object itself is the state's)
// the season's depth_roster_view: Python's view is what Headquarters is given; the JavaScript season's own is run
// beside it where it can run, and counted
const real_view = season.depth_roster_view;
const view = { same: 0, different: 0, unable: 0, why: null };
const told_view = replay("season.depth_roster_view");
season.depth_roster_view = (state, slug) => {
  const want = told_view(state, slug);
  try {
    const got = deep(real_view(state, slug));
    if (JSON.stringify(got) === JSON.stringify(want)) view.same++; else view.different++;
  } catch (e) {
    view.unable++;
    view.why = e.message;
  }
  return want;
};

// ----- comparing ------------------------------------------------------------------------------------------------------
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
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.join("\u0000") !== kb.join("\u0000")) {
    const sa = new Set(ka), sb = new Set(kb);
    const only_py = ka.filter((k) => !sb.has(k)), only_js = kb.filter((k) => !sa.has(k));
    found.push(only_py.length || only_js.length ? `${where}: keys only py [${only_py.slice(0, 6)}] only js [${only_js.slice(0, 6)}]`
      : `${where}: key order differs (${ka.findIndex((k, i) => k !== kb[i])} of ${ka.length})`);
  }
  for (const k of ka) if (k in b) diff(a[k], b[k], `${where}/${k}`, found);
}
const json = (v) => deep(v === undefined ? null : v);
function put(st, keys, value) {
  let d = st;
  for (const k of keys.slice(0, -1)) d = d[k];
  if (value === "__del__") delete d[keys[keys.length - 1]];
  else d[keys[keys.length - 1]] = deep(value);
}

let bad = 0, steps = 0, good = 0, values = 0, errors = 0, crashes = 0;
const by_fn = {};
for (const name of setup.careers) {
  const c = read(`${name}_case.json`);
  const st = parse_ordered(fs.readFileSync(path.join(out, `${name}_state.json`), "utf8"), [["games"], ["my_boxes"]]);
  season.use_league(c.league_file ? path.join(out, c.league_file) : null);
  start_replay(st, c.calls);
  for (const [i, [fn, ...args]] of c.steps.entries()) {
    const want = c.answers[i];
    if (fn === "put") { put(st, ...args); continue; }
    steps++;
    let got;
    try {
      got = { value: json(setup.NO_STATE.includes(fn) ? headquarters[fn](...args) : headquarters[fn](st, ...args)) };
    } catch (e) {
      got = e instanceof headquarters.LayoutError ? { error: e.message } : { crash: e.message };
    }
    const found = [];
    if ("crash" in want) {                      // Python fell over (not a LayoutError): nothing to hold the port to
      crashes++;
      console.log(`(Python crashed at ${name} step ${i} ${fn}: ${want.crash}; here: ${JSON.stringify(got).slice(0, 100)})`);
    } else {
      diff(want, got, "", found);
      if ("value" in want) values++; else errors++;
    }
    if (found.length) {
      bad++;
      console.log(`DIFFERENT ${name} step ${i} ${fn}(${JSON.stringify(args).slice(0, 100)})`);
      for (const f of found) console.log("   " + f);
    } else {
      good++;
      by_fn[fn] = (by_fn[fn] || 0) + 1;
    }
  }
  const found = [];
  diff(c.after, json((st.career || {}).headquarters), "career/headquarters", found);
  if (left_over()) found.push(`${left_over()} of Python's calls were never made`);
  if (found.length) { bad++; console.log(`DIFFERENT ${name} at the end`); for (const f of found) console.log("   " + f); }
}
console.log(`headquarters: ${good} of ${steps} calls the same (${values} answers, ${errors} refusals with the same words, ${crashes} where Python itself crashed)`);
console.log("   " + Object.entries(by_fn).map(([k, n]) => `${k} ${n}`).join(", "));
console.log(`the JavaScript season's depth_roster_view beside Python's: the same ${view.same} times, different ${view.different}, could not run ${view.unable}${view.why ? ` (${view.why})` : ""}`);
process.exit(bad ? 1 : 0);
