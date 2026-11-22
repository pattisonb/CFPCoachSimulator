// teamdata_js/build_teams.js against Python's answers (build_teams_reference.py wrote them): every one the same, number
// for number and key for key in the same order.
//   python3 teamdata_js/test/build_teams_reference.py OUTDIR && node teamdata_js/test/build_teams_compare.mjs OUTDIR
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { set_reader, set_store } from "../../engine_js/files.js";
import { build_teams as bt } from "../build_teams.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = process.argv[2];
const abs = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));
set_reader((p) => fs.readFileSync(abs(p), "utf8"));
const written = {};
set_store({                                  // main() lists the source folder and writes two files: kept here, not on disk
  write: (p, text) => { written[p] = text; },
  exists: (p) => fs.existsSync(abs(p)),
  remove: () => null,
  remove_dir: () => null,
  list: (p) => (fs.existsSync(abs(p)) ? fs.readdirSync(abs(p)).sort() : []),
  mtime: (p) => fs.statSync(abs(p)).mtimeMs,
});

const load = (name) => JSON.parse(fs.readFileSync(path.join(out, name), "utf8"));
const text = (v) => JSON.stringify(v === undefined ? "(undefined)" : v);

// the first differences between Python's value and JavaScript's, key order included
function diff(a, b, where, found) {
  if (found.length >= 8) return;
  if (a === b) return;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) {
    found.push(`${where}: py ${text(a)?.slice(0, 90)} | js ${text(b)?.slice(0, 90)}`); return;
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

const counts = new Map();
let bad = 0;
function check(name, py, js) {
  const found = [];
  diff(py, js, "", found);
  const c = counts.get(name) || [0, 0];
  c[0] += 1;
  if (!found.length) c[1] += 1;
  else if (bad++ < 12) { console.log(`${name}:`); for (const f of found) console.log("   " + f); }
  counts.set(name, c);
}

const sources = () => fs.readdirSync(abs("cfb_sim_data/teams")).filter((n) => n.endsWith(".json")).sort()
  .map((n) => JSON.parse(fs.readFileSync(abs(`cfb_sim_data/teams/${n}`), "utf8")));

// ---- the small functions ------------------------------------------------------------------------------------------
{
  const ref = load("cases.json");
  for (const [fn, args, want] of ref.cases) {
    let got;
    const given = structuredClone(args);
    try {
      got = bt[fn](...given);
      if (got instanceof Set) got = [...got].sort();
      if (fn === "apply_manual_ratings") got = [got, given[0]];
    } catch (e) {
      got = `threw: ${e.message}`;
    }
    check(fn, want, JSON.parse(text(got)));
  }
}

// ---- whole builds ---------------------------------------------------------------------------------------------------
const logged = [];
const real_log = console.log;
function capture(fn) {
  logged.length = 0;
  console.log = (...a) => logged.push(a.join(" "));
  try { return fn(); } finally { console.log = real_log; }
}

for (const file of fs.readdirSync(out).filter((n) => /^build_.*\.json$/.test(n)).sort()) {
  const ref = load(file);
  const before = {};
  for (const [k, v] of Object.entries(ref.settings)) { before[k] = bt[k]; bt[k] = v; }
  const given = ref.sources === null ? sources() : structuredClone(ref.sources);
  let got;
  try {
    got = capture(() => bt.build(given, ref.real, ref.observed === null ? null : new Set(ref.observed), ref.quiet, ref.styles));
  } catch (e) {
    got = `threw: ${e.stack}`;
  }
  for (const [k, v] of Object.entries(before)) bt[k] = v;
  if (typeof got === "object") {
    // "source" is the folder's own path on the computer that built it in Python, the path from the project's root here
    if (!ref.out.source.replaceAll("\\", "/").endsWith("/" + got.source)) check(`${file} source`, ref.out.source, got.source);
    got = JSON.parse(JSON.stringify(got));
    got.source = ref.out.source;
  }
  check(`build ${file}`, ref.out, got);
  check(`build ${file} printed`, ref.printed, logged.map((l) => l + "\n").join(""));
  if (ref.sources !== null) check(`build ${file} sources after`, ref.sources_after, JSON.parse(JSON.stringify(given)));
}

// ---- the steps, one at a time ---------------------------------------------------------------------------------------
{
  const ref = load("steps.json").steps;
  const strip = (teams) => JSON.parse(JSON.stringify(teams, (k, v) => (k === "_src" ? true : v)));
  const teams = sources().map((t) => bt.team_from_source(t));
  let means;
  const run = {
    team_from_source: () => null,
    normalize: () => (means = bt.normalize(teams)),
    team_level: () => bt.team_level(teams),
    house_attributes: () => { bt.house_attributes(teams); return { ...bt.ATTR_SCALE }; },
    apply_real_adjustments: () => bt.apply_real_adjustments(teams, means),
    apply_manual_ratings: () => bt.apply_manual_ratings(teams),
    depth_sort: () => { for (const t of teams) bt.depth_sort(t); return null; },
    ratings_at_every_position: () => { bt.ratings_at_every_position(teams, means); return null; },
    normalize_tendencies: () => bt.normalize_tendencies(teams),
    decouple_discipline: () => bt.decouple_discipline(teams),
    apply_observed_tendencies: () => bt.apply_observed_tendencies(teams),
    measured_recruiting: () => bt.measured_recruiting(teams),
    engine_roster: () => teams.slice(0, 12).map((t) => bt.engine_roster(t)),
  };
  for (const [name, answer, after] of ref) {
    const got = run[name]();
    check(`step ${name} answer`, answer, JSON.parse(text(got)));
    if (after !== null) check(`step ${name} teams after`, after, strip(teams));
  }
}

{
  const ref = load("measured.json");
  const few = structuredClone(ref.before);
  check("measured_recruiting (league.py's call) answer", ref.n, bt.measured_recruiting(few));
  check("measured_recruiting (league.py's call) teams", ref.after, few);
}

// ---- the command: main() writes the real build ------------------------------------------------------------------------
{
  const ref = load("build_real.json");
  capture(() => bt.main([]));
  const made = JSON.parse(written[bt.OUT]);
  made.source = ref.out.source;
  check("main: data/engine_teams.json", ref.out, made);
  check("main: its last lines", true, /^wrote data\/engine_teams\.json with 146 teams \(\d+\.\d MB\)$/.test(logged[logged.length - 2])
    && /^wrote player_potential\.json: potential and coachability for \d+ players$/.test(logged[logged.length - 1]));
  const potential = JSON.parse(fs.readFileSync(abs("data/player_potential.json"), "utf8"));
  check("main: data/player_potential.json (against the file Python wrote)", potential, JSON.parse(written["data/player_potential.json"]));
}
{
  const ref = load("build_real_spread.json");
  const before = bt.SPREAD_SCALE;
  capture(() => bt.main(["1.3"]));
  const made = JSON.parse(written[bt.OUT]);
  made.source = ref.out.source;
  check("main 1.3: data/engine_teams.json", ref.out, made);
  bt.SPREAD_SCALE = before;
}

let total = 0, same = 0;
for (const [name, [n, ok]] of counts) {
  total += n; same += ok;
  console.log(`${ok === n ? "same" : "DIFF"}  ${name}: ${ok} of ${n}`);
}
console.log(`${same} of ${total} the same`);
process.exit(same === total ? 0 : 1);
