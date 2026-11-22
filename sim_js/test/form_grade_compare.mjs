// sim_js/form.js and sim_js/grade.js held to the Python's answers (form_grade_reference.py OUT, then:
// node sim_js/test/form_grade_compare.mjs OUT). form runs on the league's own teams as the JavaScript season reads
// them; grade's questions to the season and the carousel are answered from the reference's recording, in the order asked.
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

const { season } = await import("../season.js");
const { form } = await import("../form.js");
const { grade } = await import("../grade.js");
if (modules.form !== form || modules.grade !== grade) throw new Error("form and grade are not registered on modules");

const tally = {};
let failures = 0;
function diff(a, b, where, found) {
  if (found.length >= 6 || a === b) return;
  if (a === undefined) a = null;
  if (b === undefined) b = null;
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
  if (ka.join("\u0000") !== kb.join("\u0000")) { found.push(`${where}: keys py [${ka.slice(0, 12)}] | js [${kb.slice(0, 12)}]`); return; }
  for (const k of ka) diff(a[k], b[k], `${where}/${k}`, found);
}
function check(kind, what, py, js) {
  const t = tally[kind] || (tally[kind] = { same: 0, different: 0 });
  const found = [];
  diff(py, js, "", found);
  if (!found.length) { t.same++; return; }
  t.different++; failures++;
  if (t.different <= 3) { console.log(`DIFFERENT ${kind} ${what}`); for (const f of found) console.log("   " + f); }
}

// ---- form ----
const f = JSON.parse(fs.readFileSync(path.join(out, "form.json"), "utf8"));
check("form.ATTRS", "", f.ATTRS, form.ATTRS);
// the one module the season asks to read the teams: its constants, as season_whole_compare.mjs gives them
modules.league = { OFFENSE_ROLES: new Set(f.league.OFFENSE_ROLES), TEAM_FIT: f.league.TEAM_FIT, GROUP_OF: f.league.GROUP_OF };
const teams = season.load_teams();
const rest = (p) => Object.fromEntries(Object.entries(p).filter(([k]) => !form.ATTRS.includes(k)));
for (const c of f.cases) {
  const t = teams[c.team];
  const moved = form.with_form(t, c.shift);
  const at = `${c.team} ${c.shift}`;
  check("form.with_form: the team itself when the shift rounds to nothing", at, c.same_team, moved === t);
  check("form.with_form: the team's keys", at, c.keys, Object.keys(moved));
  check("form.with_form: every player's moved ratings", at, c.rows, [...moved.offense, ...moved.defense].map((p) => form.ATTRS.map((k) => p[k] ?? null)));
  const kept = ["offense", "defense"].every((u) => moved[u].every((q, i) => JSON.stringify(rest(q)) === JSON.stringify(rest(t[u][i]))));
  check("form.with_form: everything else of a player kept", at, c.others_kept, kept);
}
for (const c of f.made) check("form._moved", JSON.stringify(c).slice(0, 200), c.expect, form._moved(c.p, c.keys, c.shift));

// ---- grade ----
const g = JSON.parse(fs.readFileSync(path.join(out, "grade.json"), "utf8"));
let queues = {};
const answer = (label) => () => {
  const q = queues[label];
  if (!q || !q.length) throw new Error(`no recorded answer left for ${label}`);
  const v = q.shift();
  return v !== null && typeof v === "object" && "$blob" in v ? g.blobs[v.$blob] : v;
};
modules.season = { _records: answer("season._records") };        // (after the imports: grade asks at the call)
modules.carousel = { goal: answer("carousel.goal") };
const sorted_keys = (o) => (Array.isArray(o) ? o.map(sorted_keys) : o !== null && typeof o === "object"
  ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sorted_keys(o[k])])) : o);
for (const [k, v] of Object.entries(g.constants)) check("grade's constants", k, sorted_keys(v), sorted_keys(grade[k]));
for (const [s, letter] of Object.entries(g.letters)) check("grade._letter", s, letter, grade._letter(Number(s)));
const bands = {};
for (const c of g.cases) {
  const state = parse_ordered(g.states[c.state], [["games"]]);
  state.team = c.team;
  state.conference = c.conference;
  queues = JSON.parse(JSON.stringify(c.calls));
  const r = grade.season_grade(state);
  check("grade.season_grade", `${c.label}`, c.expect, r);
  check("grade.season_grade (answers asked for)", c.label, [], Object.entries(queues).filter(([, q]) => q.length).map(([k]) => k));
  bands[r.band] = (bands[r.band] || 0) + 1;
}
console.log("  bands seen:", JSON.stringify(bands));
for (const [kind, t] of Object.entries(tally)) console.log(`${t.different ? "DIFFERENT" : "same     "} ${String(t.same).padStart(6)} of ${String(t.same + t.different).padStart(6)}  ${kind}`);
console.log(failures ? `${failures} DIFFERENT` : "all the same");
process.exit(failures ? 1 : 0);
