// career_js/clear.js, ability_goals.js, promises.js, grades.js, word.js, office.js and career.js held to the Python's
// answers (career_small_reference.py OUT, then: node career_js/test/career_small_compare.mjs OUT).
// Every case is compared exactly, key order included. The modules that are not ported (the season is not loaded here
// either) answer from the reference's recording, each function in the order the Python asked it; a case fails when the
// JavaScript asks for an answer that was not recorded, or leaves one unasked.
import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import readline from "readline";
import { fileURLToPath } from "url";
import { set_reader, set_store, env } from "../../engine_js/files.js";
import { modules } from "../../engine_js/modules.js";
import { parse_ordered, json_key_order } from "../../engine_js/pyrt.js";

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
const fresh_dir = () => fs.mkdtempSync(path.join(os.tmpdir(), "seasons-"));
env.CFP_SEASONS_DIR = fresh_dir();

const setup = JSON.parse(fs.readFileSync(path.join(out, "setup.json"), "utf8"));

// ---- the modules that are not ported: the recording, replayed ----
let queues = {};
const answer = (label) => (...args) => {
  const q = queues[label];
  if (!q || !q.length) throw new Error(`no recorded answer left for ${label}`);
  const v = q.shift();
  return v !== null && typeof v === "object" && "$blob" in v ? setup.blobs[v.$blob] : v;
};
const stubs = (mod, names, more = {}) => Object.assign(Object.fromEntries(names.map((n) => [n, answer(`${mod}.${n}`)])), more);
const { prospects } = await import("../prospects.js");      // ported: the real one (it registers itself)
const { clear } = await import("../clear.js");
const { ability_goals } = await import("../ability_goals.js");
const { promises } = await import("../promises.js");
const { grades } = await import("../grades.js");
const { word } = await import("../word.js");
const { office } = await import("../office.js");
const { career } = await import("../career.js");
const { coaches } = await import("../../sim_js/coaches.js");
const { fcs_names } = await import("../../sim_js/fcs_names.js");
// (after the imports: a ported module that came in with them is replaced by the recording, so this check stands alone)
modules.season = stubs("season", ["load_teams", "team_data", "_preview_team", "team_display", "standings", "season_year", "rivalry_for", "rank_map"], {
  SCALE_GROUP: setup.season.SCALE_GROUP,
  get SEASONS_DIR() { return env.CFP_SEASONS_DIR; },
  box_dir: (s) => `${env.CFP_SEASONS_DIR}/${typeof s === "string" ? s : s.id}/boxes`,
});
modules.recruiting = stubs("recruiting", ["read_spread", "report_complete", "report_looks", "lost_reason", "_group_of", "start", "make_staff"], setup.recruiting);
modules.persona = stubs("persona", ["shown_to", "of", "draw"]);
modules.offseason = stubs("offseason", ["house"], setup.offseason);
modules.carousel = stubs("carousel", ["goal"]);
modules.programs = setup.programs;
modules.coach_names = stubs("coach_names", ["distinct"]);

if (modules.prospects !== prospects) throw new Error("prospects is not registered");
career.zip = { gzip: (b) => zlib.gzipSync(b), gunzip: (b, most) => zlib.gunzipSync(b, { maxOutputLength: most }) };
for (const m of ["clear", "ability_goals", "promises", "grades", "word", "office", "career"]) {
  if (modules[m] !== { clear, ability_goals, promises, grades, word, office, career }[m]) throw new Error(`${m} is not registered on modules`);
}

// ---- comparing ----
const tally = {};
let failures = 0;
function diff(a, b, where, found) {
  if (found.length >= 6) return;
  if (a === b) return;
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
  if (!found.length) { t.same++; return true; }
  t.different++; failures++;
  if (t.different <= 3) { console.log(`DIFFERENT ${kind} ${what}`); for (const f of found) console.log("   " + f); }
  return false;
}
/** fn() with a case's recorded answers; a ValueError is the case's answer, as the reference wrote it. */
function run(kind, c, fn) {
  queues = JSON.parse(JSON.stringify(c.calls || {}));
  let r;
  try {
    r = fn();
  } catch (e) {
    if (!(e instanceof coaches.ValueError)) { check(kind, `${c.fn} ${c.label || c.name || ""} threw ${e.stack}`, "no error", "an error"); return undefined; }
    r = { $raise: e.message };
  }
  const left = Object.entries(queues).filter(([, q]) => q.length).map(([k, q]) => `${k} x${q.length}`);
  check(`${kind} (answers asked for)`, `${c.fn} ${c.label || c.name || ""}`, [], left);
  return r === undefined ? null : r;
}
const copy = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
async function* cases(group) {
  const rl = readline.createInterface({ input: fs.createReadStream(path.join(out, `cases_${group}.jsonl`)), crlfDelay: Infinity });
  for await (const line of rl) if (line) yield JSON.parse(line);
}
const states = new Map();
for await (const line of readline.createInterface({ input: fs.createReadStream(path.join(out, "states.jsonl")), crlfDelay: Infinity })) {
  if (line) { const s = JSON.parse(line); states.set(s.id, s.text); }
}
const state_of = (c) => (c.state && c.state.$state ? parse_ordered(states.get(c.state.$state), [["games"], ["my_boxes"]]) : copy(c.state));

// ---- the constants ----
const sorted_keys = (o) => (Array.isArray(o) ? o.map(sorted_keys) : o instanceof RegExp ? o.source : o !== null && typeof o === "object"
  ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sorted_keys(o[k])])) : o);
for (const [name, ns] of Object.entries({ clear, ability_goals, promises, grades, word, office, career })) {
  for (const [k, v] of Object.entries(setup.constants[name])) {
    if (k === "BOX_NAME") check("constants", `${name}.${k}`, `^${v}$`, ns[k].source);
    else check("constants", `${name}.${k}`, sorted_keys(v), sorted_keys(ns[k]));
  }
}
check("constants", "clear.on", setup.clear, clear.on());

// ---- ability goals: a whole season's games, twice ----
for (const label of ["2026", "2027"]) {
  if (!fs.existsSync(path.join(out, `ag_${label}_start.json`))) continue;
  const state = JSON.parse(fs.readFileSync(path.join(out, `ag_${label}_start.json`), "utf8"));
  const base = {};
  let games = 0, events = 0;
  for (let n = 1; ; n++) {
    const file = path.join(out, `ag_${label}_${String(n).padStart(2, "0")}.json`);
    if (!fs.existsSync(file)) break;
    const wk = JSON.parse(fs.readFileSync(file, "utf8"));
    Object.assign(base, wk.base);
    for (const c of wk.calls) {
      const made = ability_goals.after_game(state, c.g, c.lines, c.moments, { [c.g.home]: base[c.g.home], [c.g.away]: base[c.g.away] });
      check(`after_game ${label}: what a game earned`, `week ${n} ${c.g.away} at ${c.g.home}`, c.made, made);
      games++; events += made.length;
    }
    const after = {};
    for (const k of Object.keys(wk.after)) after[k] = state[k] === undefined ? null : state[k];
    check(`after_game ${label}: the state's ability dicts after a week`, `week ${n}`, wk.after, after);
  }
  console.log(`  ${label}: ${games} games replayed, ${events} abilities earned`);
}

// ---- the cases ----
for await (const c of cases("ability")) {
  if (c.fn === "next_goal") check("ability_goals.next_goal", JSON.stringify(c.args), c.expect, ability_goals.next_goal(...c.args));
  else if (c.fn === "recruit_abilities") {
    check("ability_goals.recruit_abilities", JSON.stringify(c.args), c.expect, ability_goals.recruit_abilities(...copy(c.args)));
    check("ability_goals.recruit_ab_field", JSON.stringify(c.args), c.field, ability_goals.recruit_ab_field(...copy(c.args)));
  } else if (c.fn === "after_game") {
    const st = copy(c.state);
    check("ability_goals.after_game (made-up games)", "", c.expect, ability_goals.after_game(st, ...copy(c.args)));
    check("ability_goals.after_game (made-up games), the state after", "", c.after, st);
  } else if (c.fn === "clear_on") check("ability_goals.on", "", c.expect, ability_goals.on());
  else if (c.fn === "views") {
    for (const p of c.players) {
      const at = `${c.label} ${c.team} ${p.key}`;
      check("ability_goals.goal_view", at, p.goal, ability_goals.goal_view(c.state, c.team, p.key, p.position, p.base));
      check("ability_goals.upgrades_view", at, p.ups, ability_goals.upgrades_view(c.state, c.team, p.key, p.base));
      check("ability_goals.merged_traits", at, p.merged, ability_goals.merged_traits(c.state, c.team, p.key, p.traits));
    }
  } else if (c.fn === "news") check("ability_goals.news", c.label, c.expect, run("ability_goals.news", c, () => ability_goals.news(c.state)));
  else if (c.fn === "carry_over") {
    const st = copy(c.state);
    st.ability_events = [];
    const lgd = copy(c.lgd);
    check("ability_goals.carry_over", "how many written", c.expect, run("ability_goals.carry_over", c, () => ability_goals.carry_over(st, lgd)));
    check("ability_goals.carry_over", "the league's rosters after", c.after, lgd);
    check("ability_goals.carry_over", "the state's keys after", c.state_keys, Object.keys(st));
  } else throw new Error(`ability: ${c.fn}?`);
}

let attrs = null;
for await (const c of cases("clear")) {
  if (c.fn === "attrs") attrs = c.attrs;
  else if (c.fn === "ceiling_drift") {
    const p = copy(c.p);
    check("clear.ceiling_drift", p.id, c.expect, clear.ceiling_drift(p, attrs, c.perf, c.year, new Set(c.physical)));
    check("clear.ceiling_drift, his room after", p.id, c.g_after, p.g);
    check("clear.struggled", p.id, c.struggled, clear.struggled(c.perf));
  } else if (c.fn === "ratings") check("clear.ratings", `${c.label} ${c.args[0]}`, c.expect, run("clear.ratings", c, () => clear.ratings(state_of(c), ...c.args)));
  else if (c.fn === "confidence") check("clear.confidence", c.args.join(" "), c.expect, run("clear.confidence", c, () => clear.confidence(state_of(c), ...c.args)));
  else if (c.fn === "_group_of_key") for (const [k, g] of Object.entries(c.keys)) check("clear._group_of_key", k, g, clear._group_of_key({}, k));
  else throw new Error(`clear: ${c.fn}?`);
}

let strain_state = {};
for await (const c of cases("promises")) {
  if (c.fn === "score") {
    const [ws, pos, kind, strain] = c.args;
    const s = promises.score(ws, pos, kind, strain);
    check("promises.score", JSON.stringify(c.args).slice(0, 200), c.expect, s);
    check("promises.score (no strain given)", "", c.plain, promises.score(ws, pos, kind));
    check("promises.band", "", c.band, promises.band(s, kind));
    check("promises.chip", "", c.chip, promises.chip(promises.band(s, kind)));
    check("promises.benched_big", "", c.benched_big, promises.benched_big(ws));
    check("promises.leave_chance", "", c.leave, promises.leave_chance(c.cls, pos, { benched_big: c.benched_big, personality: kind }));
    check("promises.nil_mult", "", c.nil, promises.nil_mult(kind));
    check("promises._group", "", c.group, promises._group(pos));
  } else if (c.fn === "band") check("promises.band", JSON.stringify(c.args), c.expect, promises.band(...c.args));
  else if (c.fn === "add_strain") {
    promises.add_strain(strain_state, ...c.args);
    check("promises.add_strain", "", c.after, strain_state);
    const got = {};
    for (const k of Object.keys(c.strain)) { const [y, s] = k.split("|"); got[k] = promises.strain(strain_state, Number(y), s); }
    check("promises.strain", "", c.strain, got);
  } else if (c.fn === "mark_promised") {
    const row = copy(c.row);
    promises.mark_promised(row, ...c.args);
    check("promises.mark_promised", "", c.after, row);
  } else if (c.fn === "record") {
    const st = {};
    check("promises._seen", "", c.seen, promises._seen(st));
    check("promises._seen writes nothing", "", [], Object.keys(st));
    check("promises.record", "", c.expect, promises.record(st));
    check("promises.record makes it", "", ["promises"], Object.keys(st));
  } else if (c.fn === "promised_now") {
    const r = run("promises.promised_now", c, () => promises.promised_now(state_of(c)));
    check("promises.promised_now (who, in order)", c.label, Object.keys(c.expect), Object.keys(r));
    check("promises.promised_now (their rows)", c.label, Object.values(c.expect).map((x) => [x.id, x.promised, x.pos]), Object.values(r).map((x) => [x.id, x.promised, x.pos]));
  } else if (["chips_now", "tags_now", "news", "bands", "is_big"].includes(c.fn)) {
    check(`promises.${c.fn}`, `${c.label} ${c.args}`, c.expect, run(`promises.${c.fn}`, c, () => promises[c.fn](state_of(c), ...c.args)));
  } else if (c.fn === "snapshot_week") {
    const st = state_of(c);
    check("promises.snapshot_week", `week ${c.args}`, c.expect, run("promises.snapshot_week", c, () => promises.snapshot_week(st, ...c.args) ?? null));
    check("promises.snapshot_week, the record after", `week ${c.args}`, c.after, st.promises);
  } else throw new Error(`promises: ${c.fn}?`);
}

for await (const c of cases("grades")) {
  if (c.fn === "letter") check("grades.letter", c.args[0], c.expect, [grades.letter(c.args[0]), grades.letter(c.args[0], true)]);
  else if (c.fn === "order") {
    check("grades.ORDER", "", c.expect, grades.ORDER);
    check("grades.place", "", c.place, Object.fromEntries(Object.keys(c.place).map((g) => [g, grades.place(g)])));
  } else if (c.fn === "span") {
    const sp = grades.span(...c.args);
    check("grades.span", JSON.stringify(c.args), c.expect, sp);
    check("grades.sort_key", JSON.stringify(c.args), c.sort_key, grades.sort_key(sp));
  } else if (c.fn === "eye" || c.fn === "fine") check(`grades.${c.fn}`, c.label, c.expect, run(`grades.${c.fn}`, c, () => grades[c.fn](state_of(c))));
  else throw new Error(`grades: ${c.fn}?`);
}

for await (const c of cases("word")) {
  if (c.fn === "run") {
    const st = copy(c.state);
    c.steps.forEach((step, i) => {
      const at = `step ${i} ${step.op} ${JSON.stringify(step.args)}`;
      check(`word.${step.op}`, at, step.expect, run(`word.${step.op}`, { ...step, fn: step.op }, () => word[step.op](st, ...step.args) ?? null));
      const r = step.read;
      check("word.reading", at, [r.reading, r.reading_g], [word.reading(st), word.reading(st, r.g)]);
      check("word.believes", at, r.believes, word.believes(st, r.g));
      check("word.last_broken", at, r.last_broken, word.last_broken(st, r.g));
      check("word.view", at, r.view, word.view(st));
      check("word.promise_mult", at, r.promise_mult, word.promise_mult(st, ...r.pm_args));
      check("word._seen", at, r.seen, word._seen(st));
    });
    check("word: the state after a run", "", c.after, st);
  } else if (c.fn === "word_text") {
    check("word.word_text", c.args[0], c.expect, word.word_text(...c.args));
    check("word._clamp", c.args[0], c.clamp, [word._clamp(c.args[0] - 20), word._clamp(c.args[0] + 20)]);
  } else if (c.fn === "_line") check("word._line", JSON.stringify(c.args), c.expect, word._line(...c.args));
  else if (c.fn === "recruit_event") {
    const st = copy(c.state);
    check("word.recruit_event", c.args.join(" "), c.expect, run("word.recruit_event", c, () => word.recruit_event(st, ...c.args) ?? null));
    check("word.recruit_event, the word after", c.args.join(" "), c.after, st.career.word);
    check("word.promise_mult (a recruit)", c.pm.args.join(" "), c.pm.expect, run("word.promise_mult", { ...c.pm, fn: "promise_mult" }, () => word.promise_mult(st, ...c.pm.args)));
  } else if (c.fn === "view") check("word.view (the career's)", c.label, c.expect, run("word.view", c, () => word.view(state_of(c))));
  else if (c.fn === "apply_bands") {
    const st = state_of(c);
    check("word.apply_bands", c.label, c.expect, run("word.apply_bands", c, () => word.apply_bands(st, ...c.args) ?? null));
    check("word.apply_bands, the word after", c.label, c.after, st.career.word);
  } else throw new Error(`word: ${c.fn}?`);
}

for await (const c of cases("office")) {
  check(`office.${c.fn}`, c.label, c.expect, run(`office.${c.fn}`, c, () => office[c.fn](state_of(c))));
}

const b64 = (t) => new Uint8Array(Buffer.from(t, "base64"));
function files_under(dir, rel = "") {
  const found = {};
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const at = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) Object.assign(found, files_under(dir, at));
    else found[at] = JSON.parse(fs.readFileSync(path.join(dir, at), "utf8"));
  }
  return found;
}
const by_name = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
for await (const c of cases("career")) {
  if (c.fn === "newer") check("career.newer", JSON.stringify(c.args), c.expect, career.newer(...c.args) === c.args[1] ? "b" : "a");
  else if (c.fn === "new_career") {
    const st = { id: "abc", team: "ohio-state" };
    const r = run("career.new_career", c, () => career.new_career(st, c.args[0]));
    check("career.new_career returns the state's block", "", true, r === st.career);
    check("career._now", "", true, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+00:00$/.test(st.career.saved_at));
    st.career.saved_at = c.after.career.saved_at;                      // the clock
    check("career.new_career", JSON.stringify(c.args), c.after, st);
    check("career.is_career", "", [c.is_career, c.is_career_plain], [career.is_career(st), career.is_career({ id: "abc" })]);
  } else if (c.fn === "_looks_like_career") {
    check("career._looks_like_career", JSON.stringify(c.state).slice(0, 150), c.expect, run("career._looks_like_career", c, () => career._looks_like_career(copy(c.state))));
    if (c.own_teams) check("career._own_teams", "", c.own_teams, Object.keys(career._own_teams(c.state)).sort());
  } else if (c.fn === "save") {
    // Python's save, read here
    const blob = b64(c.blob);
    const r = run("career.read_save", c, () => career.read_save(blob));
    const py_text = zlib.gunzipSync(blob).toString("utf8");
    const py = parse_ordered(fcs_names.rewrite_text(py_text), [["state", "games"], ["state", "my_boxes"]]);
    check("career.read_save (Python's save): the state", c.label, py.state, r[0]);
    check("career.read_save (Python's save): the games in the saved order", c.label, json_key_order(py_text, ["state", "games"]), Object.keys(r[0].games));
    check("career.read_save (Python's save): the box scores", c.label, [c.state_id, c.box_names], [r[0].id, Object.keys(r[1]).sort()]);
    check("career.read_save (Python's save): each box score's text", c.label, by_name(py.boxes), by_name(r[1]));
    // and the same career saved here: the text Python's save holds
    env.CFP_SEASONS_DIR = fresh_dir();
    const dir = `${env.CFP_SEASONS_DIR}/${r[0].id}/boxes`;
    if (c.boxes) {
      fs.mkdirSync(dir, { recursive: true });
      for (const [n, t] of Object.entries(c.box_files)) fs.writeFileSync(path.join(dir, n), t);
      fs.writeFileSync(path.join(dir, "notes.txt"), "not a box score");
    }
    const mine = zlib.gunzipSync(career.export_save(r[0], c.boxes)).toString("utf8");
    const again = parse_ordered(mine, [["state", "games"], ["state", "my_boxes"]]);
    check("career.export_save: what the save holds, in Python's order", c.label, py, again);
    const plain = (t) => t.replace(/(\d)\.0(?=[,}\]])/g, "$1");      // Python writes a whole float as 4.0, JavaScript as 4
    console.log(`  export_save ${c.label}: ${mine.length} characters; the text itself ${mine === py_text ? "is" : plain(py_text) === mine ? "is (whole floats aside)" : "is not"} Python's`);
  } else if (c.fn === "read_save") {
    const r = run("career.read_save", c, () => career.read_save(b64(c.blob)));
    check("career.read_save", c.name, c.expect, r);
  } else if (c.fn === "restore" || c.fn === "import_save") {
    env.CFP_SEASONS_DIR = fresh_dir();
    const current = copy(c.current) ?? null;
    const r = run(`career.${c.fn}`, c, () => (c.fn === "restore" ? career.restore(b64(c.blob), current) : career.import_save(b64(c.blob))));
    if (c.fn === "import_save") check("career.import_save", "", c.expect, r);
    else if (c.expect.$raise) check("career.restore", c.name, c.expect, r);
    else check("career.restore", c.name, c.expect, { kept: r === current ? "current" : "upload", state: r });
    check(`career.${c.fn}: the files written`, c.name || "", by_name(c.files), files_under(env.CFP_SEASONS_DIR));
  } else throw new Error(`career: ${c.fn}?`);
}

for (const [kind, t] of Object.entries(tally)) console.log(`${t.different ? "DIFFERENT" : "same     "} ${String(t.same).padStart(6)} of ${String(t.same + t.different).padStart(6)}  ${kind}`);
console.log(failures ? `${failures} DIFFERENT` : "all the same");
process.exit(failures ? 1 : 0);
