// career_js/league_file.js against coach_career/league_file.py's answers:
// node career_js/test/league_file_compare.mjs OUTDIR   (after: python3 career_js/test/league_file_reference.py OUTDIR)
// Every answer is compared exactly, the order of a dict's keys included. The modules league_file asks that are not
// ported yet (league, recruiting, offseason, schedule_gen, league_fill, coach_names) are stand-ins here that answer
// with what the Python recorded; the season is the real sim_js/season.js.
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { set_reader, set_store, env, read_json } from "../../engine_js/files.js";
import { modules } from "../../engine_js/modules.js";

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

const text_of_file = (name) => fs.readFileSync(path.join(out, name), "utf8");
const setup = JSON.parse(text_of_file("setup.json"));
const base_league_text = text_of_file("base_league.json");

// ---- the stand-ins ------------------------------------------------------------------------------------------------
class TeamBuildError extends Error {
  constructor(slug, label) { super(`${label}: the team could not be built`); this.slug = slug; this.label = label; }
}
class ScheduleError extends Error {}
let replay = null;                       // a check's recorded answers, in the order asked
const replay_problems = [];
function answer(fn, args) {
  const e = replay.shift();
  if (!e || e.fn !== fn) { replay_problems.push(`asked ${fn}, the Python asked ${e ? e.fn : "nothing more"}`); throw new Error("replay out of step"); }
  const found = [];
  diff(e.args, JSON.parse(JSON.stringify(args)), `${fn} args`, found);
  if (found.length) replay_problems.push(...found);
  if (e.raise) {
    if (e.raise.type === "TeamBuildError") throw new TeamBuildError(e.raise.slug, e.raise.label);
    if (e.raise.type === "ScheduleError") throw new ScheduleError(e.raise.message);
    throw new Error(e.raise.message);
  }
  return e.result;
}
const TEAM_KEYS = ["name", "school", "abbreviation", "mascot", "city", "conference", "fictional"];
const slim_teams = (teams) => Object.fromEntries(Object.entries(teams).map(([s, t]) => [s, Object.fromEntries(TEAM_KEYS.filter((k) => k in t).map((k) => [k, t[k]]))]));

modules.league = {
  FIRST_YEAR: setup.FIRST_YEAR, CLASSES: setup.CLASSES,
  OFFENSE_ROLES: new Set(setup.OFFENSE_ROLES), TEAM_FIT: setup.TEAM_FIT, GROUP_OF: setup.GROUP_OF,
  base_slugs: () => setup.base_slugs,
  base_meta: (slug) => { if (!Object.hasOwn(setup.base_meta, slug)) throw new Error(`KeyError: ${slug}`); return setup.base_meta[slug]; },
  from_base: (year) => { const lgd = JSON.parse(base_league_text); if (lgd.year !== year) throw new Error("from_base: another year"); return lgd; },
  ratings: (c, attrs) => Object.fromEntries(attrs.slice(0, c.r.length).map((k, i) => [k, c.r[i]])),
  potential: (c, attrs) => Object.fromEntries(attrs.slice(0, Math.min(c.r.length, c.g.length)).map((k, i) => [k, c.r[i] + c.g[i]])),
  build: (lgd) => answer("build", [Object.keys(lgd.teams).sort()]),
};
modules.offseason = { ROSTER_LIMIT: setup.ROSTER_LIMIT };
modules.clear = { on: () => false };
modules.promises = { snapshot_week: () => null };
modules.schedule_gen = {
  ScheduleError,
  rules: () => read_json("data/schedule_rules.json"),
  series: () => read_json("data/series.json"),
  _league_games: (rule, year) => { let n = rule.games; for (const [y, k] of Object.entries(rule.games_from || {})) if (year >= Number(y)) n = k; return n; },
  empty_history: () => answer("empty_history", []),
  generate: (year, teams, hist, rng, rules) => answer("generate", [year, slim_teams(teams), hist, rng.random(), rules === undefined ? null : rules]),
};
let base_league_cleared = 0;
modules.league_fill = {
  TeamBuildError,
  _base_league: { cache_clear: () => { base_league_cleared++; } },
  league_seed: (blob, seed) => answer("league_seed", [seed]),
  to_league: (merged, seed) => answer("to_league", [slim_merged(merged), seed]),
};
modules.coach_names = { distinct: (state) => answer("distinct", [Object.keys(state).sort()]) };

const { recruits } = await import("../recruits.js");
modules.recruiting = { model: () => recruits.model() };          // (the Python's recruiting.model is recruits.model)
const { season } = await import("../../sim_js/season.js");
const { game_scale } = await import("../../teamdata_js/game_scale.js");
const { league_file } = await import("../league_file.js");
const logged = [];
league_file._log = { error: (...a) => logged.push(a), exception: (...a) => logged.push(a) };

const read = (name) => league_file.json_loads(text_of_file(name));       // keeps a number-like key in its place, as the Python wrote it
const decoder = new TextDecoder();
const text_of = (v) => league_file.json_text(v);

// ---- comparing ------------------------------------------------------------------------------------------------------
function diff(a, b, where, found) {
  if (found.length >= 6) return;
  if (a === b) return;
  if (a === undefined || b === undefined || a === null || b === null || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) {
    found.push(`${where}: py ${JSON.stringify(a)?.slice(0, 160)} | js ${JSON.stringify(b)?.slice(0, 160)}`); return;
  }
  if (Array.isArray(a)) {
    if (a.length !== b.length) { found.push(`${where}: length py ${a.length} | js ${b.length}: py ${JSON.stringify(a).slice(0, 300)} | js ${JSON.stringify(b).slice(0, 300)}`); return; }
    a.forEach((v, i) => diff(v, b[i], `${where}[${i}]`, found));
    return;
  }
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.join("\u0000") !== kb.join("\u0000")) {
    const sa = new Set(ka), sb = new Set(kb);
    const only_py = ka.filter((k) => !sb.has(k)), only_js = kb.filter((k) => !sa.has(k));
    found.push(only_py.length || only_js.length ? `${where}: keys only py [${only_py.slice(0, 6)}] only js [${only_js.slice(0, 6)}]`
      : `${where}: key order differs: py [${ka.slice(0, 12)}] js [${kb.slice(0, 12)}]`);
  }
  for (const k of ka) if (Object.hasOwn(b, k)) diff(a[k], b[k], `${where}/${k}`, found);
}
const totals = {};
let failures = 0;
function same(section, note, py, js) {
  totals[section] ??= [0, 0];
  totals[section][1]++;
  const found = [];
  diff(py, js, "", found);
  if (found.length) {
    failures++;
    if (failures <= 40) console.log(`MISMATCH ${section} (${note}):\n  ${found.join("\n  ")}`);
  } else totals[section][0]++;
}

// Python's == on JSON data (dicts whatever their order), for telling a built-in team's doc
function eq(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => eq(x, b[i]));
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k) && eq(a[k], b[k]));
}
const BASE = JSON.parse(JSON.stringify(league_file._builtin_docs()));       // our own copy (a check drops the module's)
const is_dict = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const slim_team = (t) => (is_dict(t) && typeof t.slug === "string" && Object.hasOwn(BASE, t.slug) && eq(BASE[t.slug], t) ? { "=base": t.slug } : t);
function slim_doc(doc) {
  if (is_dict(doc) && Array.isArray(doc.teams)) { const o = {}; for (const k of Object.keys(doc)) o[k] = k === "teams" ? doc.teams.map(slim_team) : doc[k]; return o; }
  return doc;
}
function slim_merged(m) {
  if (!is_dict(m) || !is_dict(m.teams)) return m;
  const o = {};
  for (const k of Object.keys(m)) o[k] = k === "teams" ? Object.fromEntries(Object.keys(m.teams).sort().map((s) => [s, slim_team(m.teams[s])])) : m[k];
  return o;
}
/** A recorded input with each built-in team's marker filled in from the JavaScript's own built-in docs. */
function fill(v) {
  if (Array.isArray(v)) return v.map(fill);
  if (!is_dict(v)) return v;
  const keys = Object.keys(v);
  if (keys.length === 1 && keys[0] === "=base") return JSON.parse(JSON.stringify(BASE[v["=base"]]));
  for (const k of keys) v[k] = fill(v[k]);
  return v;
}
const plain = (v) => (v === undefined ? null : v);

function blob_of(spec) {
  if (spec.b64 !== undefined) return new Uint8Array(Buffer.from(spec.b64, "base64"));
  const enc = new TextEncoder();
  const parts = spec.parts.map(([s, n]) => [enc.encode(s), n]);
  const total = parts.reduce((t, [b, n]) => t + b.length * n, 0);
  const blob = new Uint8Array(total);
  let at = 0;
  for (const [b, n] of parts) {
    if (b.length === 1) { blob.fill(b[0], at, at + n); at += n; } else for (let i = 0; i < n; i++) { blob.set(b, at); at += b.length; }
  }
  return blob;
}

const t0 = Date.now();
const lap = (what) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${what}`);

// ---- the game's own words and league, as league_file reads them ---------------------------------------------------
{
  const w = league_file._words(), b = league_file._builtin();
  const sets = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v instanceof Set ? [...v].sort() : v]));
  same("setup", "_words", setup.words, sets(w));
  same("setup", "_builtin", setup.builtin, sets(b));
  same("setup", "_builtin_rosters", setup.builtin_rosters, league_file._builtin_rosters());
  same("setup", "_base_members", setup.base_members, league_file._base_members());
  same("setup", "YEAR", setup.YEAR, league_file.YEAR);
  same("setup", "UNTOUCHED_LINE", setup.UNTOUCHED_LINE, league_file.UNTOUCHED_LINE);
}

// ---- the export -----------------------------------------------------------------------------------------------------
{
  const js = league_file.builtin_bytes(), py = fs.readFileSync(path.join(out, "export_norm.txt"));
  same("export", "builtin_bytes, byte for byte", [py.length, Buffer.compare(py, Buffer.from(js))], [js.length, 0]);
  if (Buffer.compare(py, Buffer.from(js)) !== 0) {
    const a = py.toString("utf8"), c = decoder.decode(js);
    let i = 0; while (i < a.length && a[i] === c[i]) i++;
    console.log(`  first difference at ${i}: py ${JSON.stringify(a.slice(i - 60, i + 60))} | js ${JSON.stringify(c.slice(i - 60, i + 60))}`);
  }
  const as_python = fs.readFileSync(path.join(out, "export_py.txt"));
  console.log(`  (Python's own bytes are ${as_python.length - py.length} longer: its whole floats end ".0")`);
  // the Python's own file read here: every team as the built-in league has it
  const doc = league_file.parse(new Uint8Array(as_python));
  same("export", "Python's export parsed and written again", py.toString("utf8"), text_of(doc) + "\n");
  same("export", "its problems", [], league_file.problems(doc));
  const merged = league_file.merge(doc);
  same("export", "its merge is the built-in league", [true, [], [], [], false], [merged.builtin, merged.added, merged.changed, merged.removed, merged.structural]);
  const attrs = game_scale.keys(), lgd = modules.league.from_base(setup.YEAR + 1);
  let round = 0;
  for (const d of doc.teams) {
    const entry = lgd.teams[d.slug], got = league_file.to_league_team(d, attrs);
    const want = { roster: entry.roster, coaches: entry.coaches, formation: entry.formation };
    if (eq(want, { roster: got.roster, coaches: got.coaches, formation: got.formation })) round++;
  }
  same("export", "to_league_team gives every team back", doc.teams.length, round);
  lap("export");
}

// ---- small helpers --------------------------------------------------------------------------------------------------
{
  const small = read("small.json");
  for (const [v, want] of small.conference_id) same("small", `conference_id ${JSON.stringify(v)}`, want, league_file.conference_id(v));
  for (const [w, want] of small._or) same("small", "_or", want, league_file._or(w));
  for (const [x, want] of small._num_text) same("small", `_num_text ${x}`, want, league_file._num_text(x));
  for (const [v, lo, hi, want] of small._is_int) same("small", `_is_int ${JSON.stringify(v)}`, want, league_file._is_int(v, lo, hi));
  for (const [v, lo, hi, want] of small._is_num) same("small", `_is_num ${JSON.stringify(v)}`, want, league_file._is_num(v, lo, hi));
  for (const [v, want] of small._say) same("small", "_say", want, league_file._say(v));
  for (const [n, want] of small._count) same("small", "_count", want, league_file._count(n, "player", "players"));
  for (const [n, want] of small._capped) same("small", "_capped", want, league_file._capped(Array.from({ length: n }, (_, i) => `Problem ${i}.`)));
  for (const [n, tot, want] of small._failed) same("small", "_failed", want, league_file._failed(Array.from({ length: n }, (_, i) => `Problem ${i}.`), tot));
  for (const [n, g, want] of small._new_rule) same("small", "_new_rule", want, league_file._new_rule(n, g));
  for (const [s, want] of small.checks_label) same("small", "checks_label", want, league_file.checks_label([["Alder Tech", {}, "alder-tech", false], ["Rice", {}, "rice", true]], s));
  for (const [k, want] of Object.entries(small.constants)) same("small", `constant ${k}`, want, JSON.parse(JSON.stringify(league_file[k])));
  for (const [s, want] of small.slug_re) same("small", `_SLUG ${JSON.stringify(s)}`, want, league_file._SLUG.test(s));
  for (const [s, want] of small.hex_re) same("small", `_HEX ${JSON.stringify(s)}`, want, league_file._HEX.test(s));
}

// ---- parse() -------------------------------------------------------------------------------------------------------
function parsed(blob) {
  let doc;
  try { doc = league_file.parse(blob); } catch (e) {
    if (!(e instanceof league_file.LeagueFileError)) throw e;
    return { errors: e.errors, message: e.message };
  }
  return { doc: text_of(doc) };
}
{
  const cases = read("json_fuzz.json");
  for (const c of cases) {
    let got = parsed(blob_of(c.blob));
    if (c.expect.doc_length !== undefined) got = got.doc !== undefined ? { doc_length: got.doc.length } : got;
    same("parse", JSON.stringify(c.blob).slice(0, 100), c.expect, got);
  }
  lap(`parse: ${cases.length}`);
}

// ---- the pipeline on changed league files --------------------------------------------------------------------------
function pipeline(blob, merge) {
  const o = {};
  let doc;
  try { doc = league_file.parse(blob); } catch (e) {
    if (!(e instanceof league_file.LeagueFileError)) throw e;
    return { parse_errors: e.errors };
  }
  let names, nerrs;
  try { [names, nerrs] = league_file.rivalry_names(doc); } catch (e) { return { rivalry_names_raise: true }; }
  o.names = names; o.name_errs = nerrs; o.finales = JSON.parse(JSON.stringify(plain(doc._finales)));
  o.rivals_after = Array.isArray(doc.teams) ? doc.teams.map((t) => (is_dict(t) ? plain(t.rivals) : null)) : null;
  let probs;
  try { probs = league_file.problems(doc); } catch (e) { o.problems_raise = true; return o; }
  o.problems = probs; o.validate = league_file.validate(doc);
  if (!probs.length && !nerrs.length && merge) {
    const m = league_file.merge(doc);
    m.finales = (doc._finales || []).map((f) => Array.from(f).sort());
    o.merged = slim_merged(m);
    o.divisions = league_file.divisions(m);
    o.conference_names = league_file.conference_names(m);
    o.schedule_rules = league_file.schedule_rules(m);
    o.engine_names = [...Object.keys(m.conferences), "nope", "12"].map((cid) => [cid, league_file.engine_name(m, cid)]);
    o.conf_changed = [...Object.keys(league_file._builtin().conf_names), "nope"].map((cid) => [cid, league_file._conf_changed(m, cid)]);
  }
  return o;
}
{
  const cases = read("fuzz.json");
  for (const c of cases) {
    const e = c.expect;
    if (e.rivalry_names_raise !== undefined) e.rivalry_names_raise = true;
    if (e.problems_raise !== undefined) e.problems_raise = true;
    same("pipeline", c.note, e, pipeline(blob_of(c.blob), c.merge));
  }
  lap(`pipeline: ${cases.length}`);
}

// ---- the calls the repo's own tests made ---------------------------------------------------------------------------
{
  const calls = read("calls.json");
  const attrs_of = (a) => (a === "=attrs" ? game_scale.keys() : a);
  const run = {
    problems: ([doc]) => league_file.problems(doc),
    validate: ([doc]) => league_file.validate(doc),
    rivalry_names: ([doc]) => league_file.rivalry_names(doc),
    merge: ([doc]) => slim_merged(league_file.merge(doc)),
    divisions: ([m]) => league_file.divisions(m),
    conference_names: ([m]) => league_file.conference_names(m),
    schedule_rules: ([m]) => league_file.schedule_rules(m),
    engine_name: ([m, cid]) => league_file.engine_name(m, cid),
    _conf_changed: ([m, cid]) => league_file._conf_changed(m, cid),
    _trimmed_rule: ([base, c, divs, name]) => league_file._trimmed_rule(base, c, divs, name),
    _protect_fits: ([rule, games, pair]) => league_file._protect_fits(rule, games, pair),
    _deep_merge: ([base, over]) => league_file._deep_merge(base, over),
    _merge_coaches: ([base, given]) => league_file._merge_coaches(base, given),
    _plain: ([reason, teams, names]) => league_file._plain(reason, teams, names),
    player_doc: ([c, attrs]) => league_file.player_doc(c, attrs_of(attrs)),
    player_compact: ([p, attrs]) => league_file.player_compact(p, attrs_of(attrs)),
    to_league_team: ([d, attrs]) => league_file.to_league_team(d, attrs_of(attrs)),
    parse: ([spec]) => text_of(slim_doc(league_file.parse(blob_of(spec)))),
  };
  for (const [name, list] of Object.entries(calls)) {
    if (!run[name]) { console.log(`no replay for ${name}`); failures++; continue; }
    let n = 0;
    for (const c of list) {
      if (name === "parse" && c.in[0] === null) continue;
      const args = fill(c.in);
      let got;
      try {
        got = { result: run[name](args) };
        if (c.out.after !== undefined) got.after = slim_doc(args[0]);
      } catch (e) {
        got = { raise: true, errors: e.errors === undefined ? null : e.errors };
        if (c.out.raise !== undefined) c.out.raise = true;
      }
      same(`calls: ${name}`, `case ${n}`, c.out, JSON.parse(JSON.stringify(got)));
      n++;
    }
  }
  lap("calls");
}

// ---- check() ---------------------------------------------------------------------------------------------------------
{
  const checks = read("checks.json");
  const export_py = new Uint8Array(fs.readFileSync(path.join(out, "export_py.txt")));
  let n = 0;
  for (const c of checks) {
    replay = c.log;
    replay_problems.length = 0;
    const cleared = base_league_cleared;
    const got = league_file.check(c.blob === "=export" ? export_py : blob_of(c.blob), c.seed);
    same("check", `case ${n}`, c.expect, JSON.parse(JSON.stringify(got)));
    same("check: what it asked the other modules", `case ${n}`, [[], 0, 1], [replay_problems.slice(0, 6), replay.length, base_league_cleared - cleared]);
    n++;
  }
  lap(`check: ${checks.length} (${logged.length} logged errors)`);
}

console.log("");
for (const [section, [ok, n]] of Object.entries(totals)) console.log(`${ok === n ? "ok  " : "FAIL"} ${section}: ${ok} of ${n}`);
console.log(failures ? `\n${failures} MISMATCHES` : "\nall the same");
process.exit(failures ? 1 : 0);
