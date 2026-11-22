// career_js/recruiting/part2.js held to Python's answers (recruiting_part2_reference.py writes them):
//   node career_js/test/recruiting_part2_compare.mjs OUTDIR [moment]
// The part is loaded alone on the recruiting namespace. What it reaches outside itself is given as Python had it:
// the constants and the recruiting models whole, the teams whole (season.load_teams), and every call into the rest of
// recruiting.py, persona, offseason and season from the moment's table of recorded calls (a call the Python never
// made stops the run). programs is the real career_js/programs.js. Each moment runs in its own process (the caches
// and the teams are a process's own).
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { modules } from "../../engine_js/modules.js";
import { use_repo_files, read, differences } from "./compare_tools.mjs";

const out = process.argv[2];
const only = process.argv[3];

if (!only) {
  let bad = 0;
  for (const name of read(out, "moments.json")) {
    const r = spawnSync(process.execPath, ["--max-old-space-size=4096", fileURLToPath(import.meta.url), out, name], { stdio: "inherit" });
    if (r.status !== 0) bad++;
  }
  console.log(bad ? `${bad} moment(s) differ` : "every moment matches");
  process.exit(bad ? 1 : 0);
}

use_repo_files();
const folder = path.join(out, only);
const state = read(folder, "state.json");
const setup = read(folder, "setup.json");
const table = read(folder, "table.json");
const cases = read(folder, "cases.json");
const after = read(folder, "after.json");

// ----- values as the reference wrote them ----------------------------------------------------------------------

const dec = (v) => {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(dec);
  if ("$set" in v && Object.keys(v).length === 1) return new Set(v["$set"]);
  const o = {};
  for (const [k, x] of Object.entries(v)) o[k] = dec(x);
  return o;
};
const enc = (v) => {
  if (v instanceof Set) return { "$set": [...v].sort() };
  if (v === undefined) return null;
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(enc);
  const o = {};
  for (const [k, x] of Object.entries(v)) o[k] = enc(x);
  return o;
};

const buf = new DataView(new ArrayBuffer(8));
const num = (x) => {
  buf.setFloat64(0, Number(x));
  let s = "n";
  for (let i = 0; i < 8; i++) s += buf.getUint8(i).toString(16).padStart(2, "0");
  return s;
};
function canon(a) {
  if (a === undefined) return "U";
  if (a === null) return "null";
  if (a === true) return "true";
  if (a === false) return "false";
  if (typeof a === "number") return num(a);
  if (typeof a === "string") return JSON.stringify(a);
  if (Array.isArray(a)) return "[" + a.map(canon).join(",") + "]";
  if (typeof a.random === "function") return "RNG";
  if ("recruiting" in a && "team" in a) return "S";
  if ("prospects" in a && "status" in a) return "RC";
  if ("ea_position" in a && "id" in a) return "P:" + a["id"];
  if ("offense" in a && "defense" in a) return "T";
  const keys = Object.keys(a);
  if (keys.length > 40) return "BIG";
  return "{" + keys.sort().map((k) => JSON.stringify(k) + ":" + canon(a[k])).join(",") + "}";
}

let asked = 0;
const replay = (label) => (...args) => {
  while (args.length && args[args.length - 1] === undefined) args.pop();
  const key = `${label}(${args.map(canon).join(",")})`;
  if (!(key in table)) throw new Error(`a call the Python did not make: ${key}`);
  asked++;
  return JSON.parse(JSON.stringify(table[key]));       // a fresh copy each time, as a call makes a fresh answer
};

// ----- the namespace before the part loads: the other parts' constants and functions ----------------------------------

const { recruiting } = await import("../recruiting_ns.js");
for (const [k, v] of Object.entries(setup.consts)) recruiting[k] = dec(v);
recruiting._GROUP = {};
recruiting._ASKS = new Map();
recruiting._FITS = [null, {}, null, null, {}];
recruiting._LEAVER_CUT = [null, 0];
for (const name of ["_ck", "is_portal", "_early_leaver_cut", "_build_board", "_fits", "prospect_list", "tier_of", "_miles", "_group",
  "_ahead", "_logistic", "_interp", "fbs_schools", "ask_view", "ask_from", "pending", "_national_share"]) {
  recruiting[name] = replay(`recruiting.${name}`);
}
recruiting._team_model = (slug) => setup.models[slug] || {};
recruiting.model = () => ({ coaches: { current: setup.coaches_current } });
const before = new Set(Object.keys(recruiting));

modules.persona = {};
for (const name of ["home_of", "story_interest", "pitch_mult", "story_mult", "twist_mult", "offer_mult", "counts_as_priority"]) {
  modules.persona[name] = replay(`persona.${name}`);
}
// story_interest's last argument (the pulls' sum) carries Math.exp's last digit: it is checked close, not keyed, and the
// answer moves by the same last digit
modules.persona.story_interest = (state_, slug, pid, base) => {
  const key = `persona.story_interest(${[state_, slug, pid].map(canon).join(",")})`;
  if (!(key in table)) throw new Error(`a call the Python did not make: ${key}`);
  const [py_base, py_out] = table[key];
  if (Math.abs(py_base - base) > 1e-13 * Math.max(1, Math.abs(py_base))) throw new Error(`story_interest's base: py ${py_base} | js ${base}`);
  asked++;
  return py_out + (base - py_base);
};
modules.offseason = { GROUP: setup.offseason.GROUP, TARGET: setup.offseason.TARGET, UNDERCLASS_ELIGIBLE: dec(setup.offseason.UNDERCLASS_ELIGIBLE),
  season_facts: replay("offseason.season_facts") };
modules.season = { load_teams: () => setup.teams, _records: replay("season._records"), rank_map: replay("season.rank_map"), _is_p4: replay("season._is_p4") };

await import("../recruiting/part2.js");

const problems = [];
const note = (text) => { if (problems.length < 30) problems.push(text); };

// the part's names: every one on the namespace, none of them there before it loaded; its constants as Python's
for (const name of setup.mine) {
  if (!(name in recruiting)) note(`not on the namespace: ${name}`);
  if (before.has(name)) note(`on the namespace before the part loaded (the test's own setup): ${name}`);
}
for (const [k, v] of Object.entries(setup.mine_constants)) {
  const d = differences(v, enc(recruiting[k]));
  if (d.length) note(`constant ${k}: ${d[0]}`);
}

// ----- the cases --------------------------------------------------------------------------------------------------

const real = (a) => {
  if (a === "$S") return state;
  if (a === "$W") return recruiting._winning(state);
  if (a !== null && typeof a === "object" && !Array.isArray(a) && "$p" in a) return state["recruiting"]["prospects"][a["$p"]];
  return a;
};

let same = 0, close = 0, n = 0;
const close_at = {};
const per = {};
for (const [fn, args, want, may_be_close] of cases) {
  n++;
  let got;
  try {
    if (fn === "$forced") {
      const [slug, pid, topic, value] = args;
      const p = state["recruiting"]["prospects"][pid];
      const f = new recruiting.forced_strength(state, slug, pid, topic, value);
      f.__enter__();
      let inside;
      try {
        inside = [recruiting.strengths(state, slug, pid), recruiting.best_pitch(state, slug, pid, true), recruiting._contact_points(state, slug, p, "call", topic)];
      } finally {
        f.__exit__();
      }
      got = [inside, recruiting.strengths(state, slug, pid)];
    } else {
      got = recruiting[fn](...args.map(real));
    }
  } catch (e) {
    note(`${fn}(${JSON.stringify(args).slice(0, 120)}) threw: ${e.message.slice(0, 160)}`);
    continue;
  }
  const d = differences(want, enc(got), may_be_close ? { close: 1e-13 } : {});
  if (d.length) note(`${fn}(${JSON.stringify(args).slice(0, 120)}): ${d[0]}`);
  else {
    same++;
    per[fn] = (per[fn] || 0) + 1;
    if (d.close) { close += d.close; for (const [k, c] of Object.entries(d.close_at)) close_at[`${fn}: ${k}`] = (close_at[`${fn}: ${k}`] || 0) + c; }
  }
}

// what the cases left in the state
const rc = state["recruiting"];
const groups = {};
for (const [pid, p] of Object.entries(rc["prospects"])) groups[pid] = p["group"] === undefined ? null : p["group"];
const left = { scout_points: rc["scout_points"] ?? null, hours: rc["hours"] ?? null, nil_pool: state["nil_pool"] ?? null, groups };
const d_after = differences(after, enc(left));
if (d_after.length) note(`the state after the cases: ${d_after.slice(0, 3).join(" ; ")}`);

// the error class
const err = new recruiting.RecruitingError(409, "No room.");
if (!(err instanceof Error) || err.code !== 409 || err.message !== "No room.") note("RecruitingError does not carry its code and message");

const fns = Object.keys(per).length;
console.log(`${only}: ${same} of ${n} cases the same (${fns} functions), ${asked} recorded calls replayed`
  + (close ? `, ${close} numbers a last digit apart (${JSON.stringify(close_at)})` : "")
  + `, state after: ${d_after.length ? "DIFFERS" : "the same"}`);
for (const p of problems) console.log("  " + p);
process.exit(problems.length ? 1 : 0);
