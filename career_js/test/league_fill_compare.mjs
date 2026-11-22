// career_js/league_fill.js against Python's answers (league_fill_reference.py wrote them): every call the same, number
// for number and key for key in the same order, and every question it asks of the modules that are stood in for here
// (league, league_file, offseason, programs, carousel) the same question, in the same order, as Python asked.
//   python3 career_js/test/league_fill_reference.py OUTDIR && node career_js/test/league_fill_compare.mjs OUTDIR
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { set_reader } from "../../engine_js/files.js";
import { modules } from "../../engine_js/modules.js";
import { Random } from "../../engine_js/pyrt.js";
import { league_fill as lf } from "../league_fill.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = process.argv[2];
const abs = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));
set_reader((p) => fs.readFileSync(abs(p), "utf8"));

const K = JSON.parse(fs.readFileSync(path.join(out, "constants.json"), "utf8"));
const text = (v) => JSON.stringify(v === undefined ? "(undefined)" : v);
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

// ---- the modules stood in for: constants as Python has them, calls answered from the tape ------------------------------
let tape = [], at = 0, problems = [];
function next(fn, args) {
  const e = tape[at++];
  if (!e) { problems.push(`asked ${fn} when Python asked nothing more (call ${at})`); throw new Error("off the tape"); }
  if (e.fn !== fn) { problems.push(`call ${at}: asked ${fn}, Python asked ${e.fn}`); throw new Error("off the tape"); }
  if (text(e.args) !== text(clone(args))) {
    const found = [];
    diff(e.args, clone(args), "", found);
    problems.push(`call ${at}: ${fn} asked differently: ${found.slice(0, 3).join("; ") || "key order"}`);
  }
  return e;
}
const roster_digest = (roster) => crypto.createHash("sha256")
  .update(roster.map((c) => `${c.id}|${c.n}|${c.pos}|${c.cls}|${c.o}|${c.r.join(",")}|${c.g.join(",")}`).join("\n")).digest("hex");
const close = (a, b) => a === b || (typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a)));
function rng_differs(rng, s) {
  if (rng.index !== s.index) return `index ${rng.index}, Python ${s.index}`;
  for (let i = 0; i < 624; i++) if (rng.mt[i] !== s.mt[i]) return `state word ${i}`;
  if (!close(rng.gaussNext, s.gauss)) return `gauss ${rng.gaussNext}, Python ${s.gauss}`;
  return null;
}
function rng_set(rng, s) { rng.mt.set(s.mt); rng.index = s.index; rng.gaussNext = s.gauss; }

modules.league = {
  ...K.league,
  from_base: (year) => clone(K.from_base[String(year)]),             // a new league each time, as Python's
  base_slugs: () => K.base_slugs,
  base_meta: (slug) => K.base_meta[slug],
  source_team(lgd, slug) {
    const many = Object.keys(lgd.teams).length > 1;
    const t = lgd.teams[slug];
    const args = many ? { slug, base: lgd.year }
      : { slug, year: lgd.year, attrs: lgd.attrs.length, digest: roster_digest(t.roster), players: t.roster.length,
        coaches: t.coaches, formation: t.formation, meta: t.meta };
    return { team_ratings: { overall: next("league.source_team", args).result } };
  },
  compact: (p, attrs, home = null) => clone(next("league.compact", [p, attrs.length, home]).result),
};
modules.league_file = {
  ...K.league_file,
  _builtin_docs: () => K.builtin_docs,
  player_compact: (p, attrs) => clone(next("league_file.player_compact", [p, attrs.length]).result),
  engine_name: (merged, cid) => next("league_file.engine_name", [cid]).result,
  schedule_rules: () => clone(next("league_file.schedule_rules", []).result),
  divisions: () => clone(next("league_file.divisions", []).result),
  conference_names: () => clone(next("league_file.conference_names", []).result),
};
modules.offseason = { ...K.offseason };
modules.programs = {
  ...K.programs,
  mix: (p) => next("programs.mix", [p]).result,
  tier_of: (rating) => next("programs.tier_of", [rating]).result,
  empty_drafts: (year) => clone(next("programs.empty_drafts", [year]).result),
};
modules.carousel = {
  generated(rng, lgd, role, slug, year, like = null, level = 0.0) {
    const e = next("carousel.generated", [role, slug, year, like, level]);
    const d = rng_differs(rng, e.rng_before);
    if (d) problems.push(`call ${at}: the generator is not where Python's was before carousel.generated (${d})`);
    rng_set(rng, e.rng_after);
    return clone(e.result);
  },
  _taken_names: () => new Set(next("carousel._taken_names", []).result),
};

// ---- comparing ----------------------------------------------------------------------------------------------------------
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

// an argument as the reference wrote it -> the value handed to the function
function build(a) {
  if (a !== null && typeof a === "object" && !Array.isArray(a)) {
    if ("$rng" in a) return new Random(a.$rng);
    if ("$set" in a) return new Set(a.$set);
    if ("$base" in a) return K.from_base[a.$base];
    if ("$merged" in a) {
      const m = clone(a.$merged);
      for (const [s, t] of Object.entries(m.teams)) if (t === "$same") m.teams[s] = clone(K.builtin_docs[s]);
      return m;
    }
  }
  return clone(a);
}
// a value after the call (or an answer) -> as the reference writes it
function enc(a, given) {
  if (a instanceof Set) return { $set: [...a].sort() };
  if (a instanceof Random) return { $rngstate: { mt: Array.from(a.mt), index: a.index, gauss: a.gaussNext } };
  if (given !== undefined && given !== null && typeof given === "object" && ("$base" in given || "$merged" in given)) return given;
  if (Array.isArray(a)) return a.map((x) => enc(x));
  return a;
}
function slim_league(lgd) {
  const base = K.from_base[String(lgd.year)].teams;
  const teams = {};
  for (const [s, t] of Object.entries(lgd.teams)) teams[s] = base[s] !== undefined && text(t) === text(base[s]) ? "$same" : t;
  return { ...lgd, teams };
}

const counts = new Map();
let bad = 0, calls = 0;
function report(row, found) {
  const c = counts.get(row.fn) || [0, 0];
  c[0] += 1;
  if (!found.length) c[1] += 1;
  else if (bad++ < 15) { console.log(`${row.fn} (${row.name}):`); for (const f of found.slice(0, 8)) console.log("   " + f); }
  counts.set(row.fn, c);
}

const rl = readline.createInterface({ input: fs.createReadStream(path.join(out, "scenarios.jsonl")), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line) continue;
  const row = JSON.parse(line);
  const found = [];
  tape = row.tape; at = 0; problems = [];
  calls += tape.length;
  if (row.fn === "$STATE_CENTER") { diff(row.result, clone(lf.STATE_CENTER), "", found); report(row, found); continue; }
  if (row.fn === "$_set_rating") {
    const c = clone(row.args[0]);
    lf._set_rating(c, row.args[1]);
    diff(row.result, c, "", found); report(row, found); continue;
  }
  if (row.fn === "$league_seed") {
    const bytes = new TextEncoder().encode(row.args[0]);
    diff(row.result, lf.league_seed(bytes, row.args[1]), "", found);
    diff(row.result, lf.league_seed(row.args[0], row.args[1]), " (text)", found);
    report(row, found); continue;
  }
  const args = row.args.map(build);
  const was = lf.fill_roster;
  if (row.breaking === "fill_roster") lf.fill_roster = () => { throw new Error("boom"); };
  let got, error = null;
  try {
    got = lf[row.fn](...args);
    if (row.fn === "to_league") got = [slim_league(got[0]), got[1]];
  } catch (e) {
    if (e instanceof lf.TeamBuildError) error = { slug: e.slug, label: e.label, message: e.message };
    else found.push(`threw: ${e.stack.split("\n").slice(0, 4).join(" | ")}`);
  } finally {
    lf.fill_roster = was;
  }
  for (const p of problems) found.push(p);
  if (at !== tape.length) found.push(`asked ${at} things of the other modules, Python asked ${tape.length}`);
  if (row.error || error) diff(row.error || null, error, " error", found);
  else if (!found.length || got !== undefined) diff(row.result, clone(enc(got)), "", found);
  // what the call left in its arguments (the names taken, the generator's place)
  const after = clone(args.map((a, i) => enc(a, row.args[i])));
  for (let i = 0; i < after.length; i++) {
    const py = row.after[i], js = after[i];
    if (py && py.$rngstate) {
      const d = rng_differs(args[i], py.$rngstate);
      if (d) found.push(`the generator after the call: ${d}`);
    } else if (py && py.$base) {
      continue;                                    // the built-in league, read only (too big to write out twice)
    } else if (py && py.$merged) {
      const m = clone(args[i]);
      for (const [s, t] of Object.entries(py.$merged.teams)) if (t === "$same" && text(m.teams[s]) === text(K.builtin_docs[s])) m.teams[s] = "$same";
      diff(py.$merged, m, ` argument ${i} after`, found);
    } else diff(py, js, ` argument ${i} after`, found);
  }
  report(row, found);
}

// what the tests of the Python ask of the namespace besides
{
  const extra = [];
  const check = (name, ok) => { const c = counts.get(name) || [0, 0]; c[0] += 1; if (ok) c[1] += 1; else console.log(`${name}: not so`); counts.set(name, c); };
  check("namespace: COACH_YEAR is league.FIRST_YEAR", lf.COACH_YEAR === K.league.FIRST_YEAR);
  check("namespace: _COACH_ROLES is league_file's", text(lf._COACH_ROLES) === text(K.league_file._COACH_ROLES));
  check("namespace: base_strengths is one answer kept", lf.base_strengths() === lf.base_strengths());
  check("namespace: a TeamBuildError is an Error with its slug and label",
    new lf.TeamBuildError("a-b", "A B") instanceof Error && new lf.TeamBuildError("a-b", "A B").message === "A B: the team could not be built");
  void extra;
}

let total = 0, same = 0;
for (const [name, [n, ok]] of counts) {
  total += n; same += ok;
  console.log(`${ok === n ? "same" : "DIFF"}  ${name}: ${ok} of ${n}`);
}
console.log(`${same} of ${total} the same (${calls} calls into the other modules replayed)`);
process.exit(same === total ? 0 : 1);
