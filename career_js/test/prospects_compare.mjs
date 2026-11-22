// Holds career_js/prospects.js to Python's answers (prospects_reference.py writes them):
//   node career_js/test/prospects_compare.mjs OUTDIR
// Each moment of the career is a folder: the state, the league's teams, the cases (a function, its arguments, what
// Python answered) and the table of every call prospects.py made into a module that is not in JavaScript yet
// (recruiting, persona, clear, grades, ability_goals), which is replayed here as those modules. Everything is
// compared exactly, key order included; a case marked `close` by the reference may differ past the ninth digit
// (it rests on the C library's exp, cos or pow) and those are counted apart.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { set_reader, set_store } from "../../engine_js/files.js";
import { modules } from "../../engine_js/modules.js";
import { odict, pyfloat } from "../../engine_js/pyrt.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = process.argv[2];
const abs = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));
set_reader((p) => fs.readFileSync(abs(p), "utf8"));
set_store({
  write: () => { throw new Error("nothing here writes a file"); },
  exists: (p) => fs.existsSync(abs(p)),
  remove: () => {}, remove_dir: () => {},
  list: (p) => (fs.existsSync(abs(p)) ? fs.readdirSync(abs(p)).sort() : []),
  mtime: (p) => fs.statSync(abs(p)).mtimeMs,
});

// ---- the reference's values back as the game holds them ----------------------------------------------------------
function decode(v) {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) v[i] = decode(v[i]); return v; }
  if (v.__od__ !== undefined) return odict(v.__od__.map(([k, x]) => [k, decode(x)]));
  if (v.__set__ !== undefined) return new Set(v.__set__);
  for (const k in v) v[k] = decode(v[k]);
  return v;
}

const ck = (rc) => String(rc.cache_key || rc.year);
function canon(a) {
  if (a === null || a === undefined) return "null";
  if (a === true) return "true";
  if (a === false) return "false";
  if (typeof a === "number") return Number.isInteger(a) ? String(a) : pyfloat(a);
  if (typeof a === "string") return JSON.stringify(a);
  if (typeof a === "function") return "FN";
  if (Array.isArray(a)) return a.length > 40 ? "BIG" : "[" + a.map(canon).join(",") + "]";
  if ("games" in a && "recruiting" in a) return "S:" + ck(a.recruiting);
  if ("prospects" in a && "status" in a) return "RC:" + ck(a);
  if ("truth" in a && "ea_position" in a) return "P:" + a.id;
  const keys = Object.keys(a);
  if (keys.length > 40) return "BIG";
  return "{" + keys.sort().map((k) => JSON.stringify(k) + ":" + canon(a[k])).join(",") + "}";
}

class RecruitingError extends Error {
  constructor(code, message) { super(message); this.code = code; this.message = message; }
}

let table = {}, decoded = new Map(), missing = [];
function stub(name, consts) {
  const fns = {};
  return new Proxy({}, {
    get(_, attr) {
      if (typeof attr === "symbol") return undefined;
      if (attr in consts) return consts[attr];
      if (name === "recruiting" && attr === "RecruitingError") return RecruitingError;
      return (fns[attr] ??= (...args) => {
        const key = `${name}.${attr}(${args.map(canon).join(",")})`;
        if (decoded.has(key)) return decoded.get(key);
        if (!(key in table)) {
          if (missing.length < 12) missing.push(key.slice(0, 260));
          throw new Error(`Python never made this call: ${key.slice(0, 260)}`);
        }
        const v = decode(table[key]);
        decoded.set(key, v);
        return v;
      });
    },
  });
}

// ---- comparing ------------------------------------------------------------------------------------------------------
const tally = {};
const wrong = [];
let close_n = 0;
function diff(want, got, where, close, found) {
  if (found.length >= 3) return;
  if (want === got) return;
  if (typeof want === "number" && typeof got === "number" && close && Math.abs(want - got) <= 1e-9 * Math.max(1, Math.abs(want), Math.abs(got))) { found.close = (found.close || 0) + 1; return; }
  if (want === null || got === null || got === undefined || typeof want !== "object" || typeof got !== "object" || Array.isArray(want) !== Array.isArray(got)) {
    found.push(`${where}: py ${JSON.stringify(want)?.slice(0, 140)} | js ${JSON.stringify(got)?.slice(0, 140)}`); return;
  }
  if (Array.isArray(want)) {
    if (want.length !== got.length) { found.push(`${where}: length py ${want.length} | js ${got.length}`); return; }
    for (let i = 0; i < want.length; i++) diff(want[i], got[i], `${where}[${i}]`, close, found);
    return;
  }
  const ka = Object.keys(want), kb = Object.keys(got);
  if (ka.join("\u0000") !== kb.join("\u0000")) {
    const sa = new Set(ka), sb = new Set(kb);
    const only_py = ka.filter((k) => !sb.has(k)), only_js = kb.filter((k) => !sa.has(k));
    found.push(only_py.length || only_js.length ? `${where}: keys only py [${only_py.slice(0, 6)}] only js [${only_js.slice(0, 6)}]`
      : `${where}: key order py [${ka.slice(0, 8)}] | js [${kb.slice(0, 8)}]`);
  }
  for (const k of ka) if (k in got) diff(want[k], got[k], `${where}/${k}`, close, found);
}
function check(what, want, got, where, close = false) {
  const c = (tally[what] ??= { n: 0, bad: 0, close: 0 });
  c.n++;
  const found = [];
  diff(want, got === undefined ? null : got, "", close, found);
  if (found.close) { c.close++; close_n += found.close; }
  if (found.length) {
    c.bad++;
    if (wrong.length < 40) wrong.push(`${where} ${what}${found.map((f) => "\n      " + f).join("")}`);
  }
}

// ---- the run ------------------------------------------------------------------------------------------------------
modules.league = new Proxy({}, { get: (_, k) => { throw new Error(`league.${String(k)} is not part of this check`); } });
const { season } = await import("../../sim_js/season.js");
const { prospects, correlation } = await import("../prospects.js");
check("registered", true, modules.prospects === prospects, "");

const teams_files = new Map();
const t0 = Date.now();
for (const mode of ["clear", "words"]) {
  const base = path.join(out, mode);
  if (!fs.existsSync(base)) { console.log(`no ${base}`); continue; }
  for (const stage of fs.readdirSync(base).filter((d) => fs.existsSync(path.join(base, d, "cases.json"))).sort()) {
    const dir = path.join(base, stage), where = `${mode}/${stage}`;
    const setup = JSON.parse(fs.readFileSync(path.join(dir, "setup.json"), "utf8"));
    if (!teams_files.has(setup.teams)) {
      teams_files.clear();
      teams_files.set(setup.teams, JSON.parse(fs.readFileSync(path.join(base, setup.teams), "utf8")));
    }
    const teams = teams_files.get(setup.teams);
    const state = decode(JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8")));
    table = JSON.parse(fs.readFileSync(path.join(dir, "table.json"), "utf8"));
    decoded = new Map();
    for (const name of ["recruiting", "persona", "clear", "grades", "ability_goals", "offseason"]) modules[name] = stub(name, decode(setup.consts[name]));
    season.load_teams = () => teams;           // the league in play, as Python had it
    prospects.reset_caches();
    prospects._card.cache_clear();

    // the namespace: every name the Python module has, and every constant the same
    for (const name of setup.names) check("names", true, name in prospects, `${where} ${name}`);
    for (const [name, want] of Object.entries(decode(setup.prospects))) {
      if (["_LIKES", "_RANKS", "_POS_RANKS", "_LEAGUE"].includes(name)) continue;       // caches, kept another way here
      check("constants", want, prospects[name], `${where} ${name}`);
    }

    const { cases, extra } = JSON.parse(fs.readFileSync(path.join(dir, "cases.json"), "utf8"));
    const real = (a) => {
      if (a !== null && typeof a === "object" && !Array.isArray(a) && a["@"] !== undefined) {
        const rc = state.recruiting;
        return { state: () => state, rc: () => rc, pool: () => prospects.player_pool(), p: () => rc.prospects[a.id], read: () => rc.reads[a.id] ?? null }[a["@"]]();
      }
      return decode(a);
    };
    for (const c of cases) {
      const label = `${where} ${JSON.stringify(c.args).slice(0, 110)}`;
      let got;
      const block = c.block ? new prospects.class_block(state) : null;
      try {
        if (block) block.__enter__();
        got = prospects[c.fn](...c.args.map(real));
      } catch (e) {
        if (block) block.__exit__();
        if (e instanceof RecruitingError) { check(c.fn, c.error ?? "no error", [e.code, e.message], label); continue; }
        check(c.fn, "an answer", `threw ${String(e.stack || e).slice(0, 500)}`, label);
        continue;
      }
      if (block) block.__exit__();
      if (c.error) { check(c.fn, c.error, "no error", label); continue; }
      check(c.fn, decode(c.want), got, label, c.close === true);
    }
    for (const [x, y, r] of extra.correlation) check("correlation (statistics)", r, correlation(x, y), where);
    const block = new prospects.class_block(state);
    const before = ck(state.recruiting);
    const inside = block.__enter__();
    const during = ck(inside.recruiting);
    block.__exit__();
    check("class_block", extra.class_block, [before, during, ck(state.recruiting)], where);
    check("class_rc", extra.class_rc, ck(prospects.class_rc(state)), where);
    console.log(`${where}: ${cases.length} cases, Clear Mode ${setup.clear ? "on" : "off"}${setup.state_changed ? ", the views changed the state in Python" : ""}`
      + `${setup.conflicts.length ? `, ${setup.conflicts.length} recorded answers changed during the run: ${setup.conflicts.slice(0, 3).join(" ; ").slice(0, 300)}` : ""}`);
  }
}

let n = 0, bad = 0;
for (const [what, c] of Object.entries(tally)) {
  n += c.n; bad += c.bad;
  console.log(`${c.bad ? "DIFFERENT" : "same     "} ${what}: ${c.n}${c.bad ? `, ${c.bad} differ` : ""}${c.close ? ` (${c.close} with a number off past the ninth digit)` : ""}`);
}
for (const w of wrong) console.log("  " + w);
if (missing.length) console.log("calls Python never made:\n  " + missing.join("\n  "));
console.log(bad ? `DIFFERENT: ${bad} of ${n}` : `all ${n} the same (${close_n} numbers differ only past the ninth digit)`, `${Date.now() - t0} ms`);
process.exit(bad ? 1 : 0);
