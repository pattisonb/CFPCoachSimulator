// app_js/api/part1.js (app/api.py lines 1-945) held to the Python's answers:
//   python3 app_js/test/api_part1_reference.py OUT     then     node app_js/test/api_part1_compare.mjs OUT [--part1]
// The pure helpers and the team and league-file pages are compared exactly, key order included; then the same scripted
// run of API calls is made here (a career started with the same seed, a game day, an advance, every progress report)
// and compared with the Python's, the season's own id aside. `--part1` loads the part alone (with the namespace file):
// the calls that need part 2 (a failed call's cleanup of nothing, the import) are then skipped.
import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import { env } from "../../engine_js/files.js";
import { modules } from "../../engine_js/modules.js";
import { use_repo_files, differences } from "../../career_js/test/compare_tools.mjs";

const out = process.argv[2];
const alone = process.argv.includes("--part1");
use_repo_files();
env.CFP_SEASONS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "seasons-"));
const ref = JSON.parse(fs.readFileSync(path.join(out, "ref.json"), "utf8"));

const { season } = await import("../../sim_js/season.js");
// every ported module, so each is on `modules` when another asks for it by name
for (const m of ["sim_js/schedule_gen", "sim_js/news", "sim_js/form", "sim_js/grade", "sim_js/awards", "sim_js/bowls", "sim_js/polls",
  "career_js/persona", "career_js/scenes", "career_js/league_file", "career_js/league_fill", "career_js/programs", "career_js/carousel",
  "career_js/headquarters", "career_js/clear", "career_js/ability_goals", "career_js/promises", "career_js/grades", "career_js/word",
  "career_js/office", "career_js/coach_names", "career_js/prospects", "career_js/recruits", "career_js/position_fit",
  "teamdata_js/build_teams", "teamdata_js/ratings", "teamdata_js/shown", "teamdata_js/game_scale"]) await import(`../../${m}.js`);
await import("../../career_js/recruiting.js");
await import("../../career_js/offseason.js");
const { career } = await import("../../career_js/career.js");
const { league } = await import("../../career_js/league.js");
const { coaches } = await import("../../sim_js/coaches.js");
let api;
if (alone) {
  ({ api } = await import("../api_ns.js"));
  await import("../api/part1.js");
} else {
  ({ api } = await import("../api.js"));
}
career.zip = { gzip: (b) => zlib.gzipSync(b), gunzip: (b, most) => zlib.gunzipSync(b, { maxOutputLength: most }) };
league.CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "leagues-"));
const coach_dir = fs.mkdtempSync(path.join(os.tmpdir(), "coaches-"));      // the saved coaches: none
coaches.store = {
  read: (id) => (fs.existsSync(path.join(coach_dir, `${id}.json`)) ? fs.readFileSync(path.join(coach_dir, `${id}.json`), "utf8") : null),
  write: (id, text) => fs.writeFileSync(path.join(coach_dir, `${id}.json`), text),
  remove: (id) => fs.rmSync(path.join(coach_dir, `${id}.json`), { force: true }),
  list: () => fs.readdirSync(coach_dir).filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -5)),
};

let cases = 0, bad = 0;
const groups = {};
function check(group, what, py, js, opts) {
  cases++;
  groups[group] = groups[group] || [0, 0];
  groups[group][0]++;
  const found = differences(py, js === undefined ? null : js, opts);
  if (found.length) {
    bad++;
    groups[group][1]++;
    if (bad <= 40) console.log(`DIFF ${group} ${what}\n   ${found.slice(0, 6).join("\n   ")}`);
  }
}
/** An answer, or the ApiError (or other error) it was refused with, as the reference writes it. */
function attempt(fn) {
  try {
    return { ok: fn() };
  } catch (e) {
    if (e instanceof api.ApiError) return { api_error: [e.status, e.message] };
    if (!(e instanceof coaches.ValueError) && process.env.SHOW_ERRORS) console.log(e.stack.split("\n").slice(0, 5).join("\n"));
    return { error: e instanceof coaches.ValueError ? "ValueError" : e.constructor.name, message: e.message };
  }
}
const same_error = (py, js) => ("error" in py ? { error: py.error } : py);       // an error's class only
const strip = (js) => ("error" in js ? { error: js.error } : js);

// ----- the pure helpers -----
for (const [t, want] of ref.boolean) check("boolean", JSON.stringify(t), same_error(want), strip(attempt(() => api.boolean(t))));
const casts = { str: api.str, int: api.int, boolean: api.boolean };
for (const [q, cast, d, want] of ref.q) {
  check("Params.q", `${JSON.stringify(q)} ${cast} ${d}`, want, attempt(() => new api.Params({}, q).q("a", casts[cast], d)));
}
check("Params.q", "default cast", { ok: "12" }, attempt(() => new api.Params({}, { a: "12" }).q("a")));
check("Params.q", "pyrt int", { ok: 12 }, attempt(() => new api.Params({}, { a: "12" }).q("a", Number, null)));
for (const [b, kind, d, want] of ref.field) {
  const args = d === "<missing>" ? [] : [d];
  check("_field", `${JSON.stringify(b)} ${kind} ${JSON.stringify(d)}`, want, attempt(() => api._field(new api.Params({}, {}, b), "x", api[kind], ...args)));
  check("_field", `by name ${JSON.stringify(b)} ${kind}`, want, attempt(() => api._field(new api.Params({}, {}, b), "x", kind, ...args)));
}
const py_patterns = [...new Set(ref.routes_in_order.map(([, pt]) => pt))].sort();
for (const [p, want] of ref.match) {
  const parts = p.replace(/^\/+|\/+$/g, "").split("/");
  const got = py_patterns.map((pt) => [pt, api._match(pt, parts)]).filter(([, v]) => v !== null);
  check("_match", p, want, got);
}
const mine = api.ROUTES.map(([m, pt]) => [m, pt]);
check("routes", "the table's order", alone ? ref.routes_in_order.slice(0, mine.length) : ref.routes_in_order, mine);
if (!alone) check("routes", "routes()", ref.routes, api.routes().map((r) => r.slice()).sort((a, b) => (a.join(" ") < b.join(" ") ? -1 : 1)));

api.route("GET", "/api/_echo/{a}/x/{b}", (p) => ({ path: p.path, query: p.query, body: p.body }));
api.route("POST", "/api/_echo/{a}/x/{b}", (p) => ({ path: p.path, query: p.query, body: p.body }));
for (const [m, p, body, want] of ref.calls) {
  const b = body === "<bytes:notgzip>" ? new TextEncoder().encode("not a gzip file") : body;
  check("call", `${m} ${p} ${JSON.stringify(body)}`, want, attempt(() => api.call(m, p, b)));
}
for (const [c, want] of ref.call_js) check("call_js", JSON.stringify(c), want, JSON.parse(api.call_js(...c)));
api.route("GET", "/api/_nan", () => ({ a: [1, { b: NaN }] }));
api.route("GET", "/api/_inf", () => ({ a: -Infinity }));
check("call_js", "nan", ref.call_js_nan, [JSON.parse(api.call_js("GET", "/api/_nan", null)), JSON.parse(api.call_js("GET", "/api/_inf", null))]);
check("call_js", "bytes body", { ok: false, status: 400 }, (({ ok, status }) => ({ ok, status }))(JSON.parse(api.call_js("POST", "/api/season/import", '{"x": 1}', new TextEncoder().encode("not gzip")))));

// ----- conference names -----
for (const [s, want] of ref.conference_names) check("_conference_names", JSON.stringify(s), want, api._conference_names(s));
for (const [s, n, want] of ref.engine_conference) check("_engine_conference", `${JSON.stringify(s)} ${n}`, want, api._engine_conference(s, n));
for (const [r, x, want] of ref.show_conferences) {
  const names = Object.fromEntries(Object.entries(r).filter(([k, v]) => k !== v));
  check("_show_conferences", `${JSON.stringify(r).slice(0, 60)} ${JSON.stringify(x).slice(0, 40)}`, want, api._show_conferences(x, names));
}

// ----- teams and the league file's pages -----
const teams_out = api.call("GET", "/api/teams");
check("list_teams", "GET /api/teams", ref.list_teams, teams_out);
for (const [s, want] of ref.get_team) check("get_team", s, want, api.call("GET", `/api/teams/${s}`));
check("_fbs_cards", "the built-in teams", ref.fbs_cards, api._fbs_cards(api._all_teams()));
check("league_programs", "GET /api/league/programs", ref.league_programs, api.call("GET", "/api/league/programs"));
for (const [s, want] of ref.league_program) check("league_program", s, want, attempt(() => api.call("GET", `/api/league/programs/${s}`)));
for (const [c, want] of ref.league_towns) check("league_towns", c, want, api.call("GET", `/api/league/towns/${c}`));
for (const [t, want] of ref.scheme) check("_scheme", JSON.stringify(t), want, api._scheme(t));

const bin = (name) => new Uint8Array(fs.readFileSync(path.join(out, name)));
check("league_check", "the built-in league's own file", ref.league_check_builtin, api.call("POST", "/api/league/check?seed=7", bin("builtin_league.bin")));
check("league_check", "pending after it", ref.pending_after_builtin, api._pending_league);
check("league_check", "an edited team", ref.league_check_custom, api.call("POST", "/api/league/check?seed=3", bin("custom_league.bin")));
const pend = api._pending_league;
check("league_check", "pending after it", ref.pending_after_custom, pend && { key: pend.key, seed: pend.seed, real_polls: pend.real_polls, games: pend.games === null });
check("league_check", "a file with errors", ref.league_check_bad, api.call("POST", "/api/league/check", bin("bad_league.bin")));
check("league_check", "pending after it", ref.pending_after_bad, api._pending_league);
check("league_check", "a seed that is no number", ref.league_check_seed, attempt(() => api.call("POST", "/api/league/check?seed=abc", bin("custom_league.bin"))));

// ----- the scripted run -----
const run = [];
const plain = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
const note = (what, value) => run.push([what, plain(value)]);
const job = () => ({ ...api.job() });
function play(label) {
  let n = 0;
  while (api.running()) {
    const reports = [];
    const o = api.step((r) => reports.push(r));
    note(`${label} step ${n}`, { out: o, reports: reports.map((r) => JSON.parse(r)), job: job(), changed: api.changed() });
    n++;
  }
  note(`${label} step after`, api.step());
}

const t0 = Date.now();
const s = api.call("POST", "/api/season", { team: "smu", seed: 11, career: true });
const sid = s.id;
note("create", s);
note("create changed", [api.changed(), api.changed(), api.dirty()]);
note("job idle", job());
note("status", api.call("GET", `/api/season/${sid}/status`));
note("status since", api.call("GET", `/api/season/${sid}/status?since=0`));
note("status bad since", attempt(() => api.call("GET", `/api/season/${sid}/status?since=x`)));
note("pause idle", api.call("POST", `/api/season/${sid}/pause`));
note("card record 0", api._card_record(api.loaded_state()));
note("gameday", attempt(() => api.call("POST", `/api/season/${sid}/gameday`)));
note("gameday job", job());
note("gameday again", attempt(() => api.call("POST", `/api/season/${sid}/gameday`)));
note("advance while running", attempt(() => api.call("POST", `/api/season/${sid}/advance`, {})));
note("create while running", attempt(() => api.call("POST", "/api/season", { team: "smu" })));
play("gameday");
note("advance bad to", attempt(() => api.call("POST", `/api/season/${sid}/advance`, { to: "x" })));
note("advance 1", api.call("POST", `/api/season/${sid}/advance`, {}));
note("advance job", job());
play("advance 1");
note("status since 0", api.call("GET", `/api/season/${sid}/status?since=0`));
note("news", api.call("GET", `/api/season/${sid}/news?since_week=0`));
note("card record 1", api._card_record(api.loaded_state()));
note("feed 1", api._feed(api.loaded_state()));

// the Python's save after week 1, read here: the views from the same state, and a scripted progress run
{
  fs.cpSync(path.join(out, "seasons_w1"), env.CFP_SEASONS_DIR, { recursive: true });
  const pid = ref.py_id;
  api.call("GET", `/api/season/${pid}/status`);
  const state = api.loaded_state();
  const view = { status: api._status(state, 0), idle_job: api._idle_job(state), card_record: api._card_record(state), feed: api._feed(state),
    news: api.call("GET", `/api/season/${pid}/news`), export_is_bytes: api.call("GET", `/api/season/${pid}/export`) instanceof Uint8Array };
  api.call("POST", `/api/season/${pid}/advance`, { to: 4 });
  const steps = [];
  const on = api._reporter(state, null);
  const script = ref.view_w1.progress_script;
  for (const [stage, gd, gt] of script) { on(stage, gd, gt); steps.push(plain(job())); }
  api._finish_week(2);
  steps.push(plain(job()));
  api.job()["done"] = 2;
  for (const [stage, gd, gt] of script.slice(0, 4)) { on(stage, gd, gt); steps.push(plain(job())); }
  view.progress_script = script;
  view.progress = steps;
  for (const k of Object.keys(ref.view_w1)) {
    if (k === "progress") steps.forEach((st, i) => check("python's save: progress", `after report ${i}`, ref.view_w1.progress[i], st));
    else check("python's save: views", k, ref.view_w1[k], plain(view[k]));
  }
  api._drop(pid);
}

note("advance to 3", api.call("POST", `/api/season/${sid}/advance`, { to: 3 }));
note("pause running", api.call("POST", `/api/season/${sid}/pause`));
play("paused advance");
note("job after pause", job());
note("advance to 3 again", api.call("POST", `/api/season/${sid}/advance`, { to: 3 }));
play("advance 3");
note("status end", api.call("GET", `/api/season/${sid}/status?since=1`));
note("card record 3", api._card_record(api.loaded_state()));

// your game alone (game day), then the rest of the week
note("gameday 3", attempt(() => api.call("POST", `/api/season/${sid}/gameday`)));
note("gameday 3 job", job());
play("gameday 3");
note("advance the rest", api.call("POST", `/api/season/${sid}/advance`, {}));
play("the rest");

// a week that breaks: the job says so and the season in memory is the last save again
{
  const real_advance = season.advance;
  season.advance = () => { throw new Error("boom"); };
  note("advance to fail", api.call("POST", `/api/season/${sid}/advance`, { to: 9 }));
  const reports = [];
  const failed = api.step((r) => reports.push(r));
  season.advance = real_advance;
  const where = failed["error"];
  const j = job();
  console.log(`a failed week's error here: ${where}`);
  note("failed step", { out: { ...failed, error: where.split(" (")[0] }, reports: reports.map((r) => JSON.parse(r)), job: { ...j, error: j["error"].split(" (")[0] },
    where: where.includes(" (") && where.endsWith(")"), week: api.loaded_state()["current_week"], running: api.running(), changed: api.changed() });
  note("status after failure", { ...api.call("GET", `/api/season/${sid}/status`), error: null });
  note("advance after failure", api.call("POST", `/api/season/${sid}/advance`, {}));
  note("pause it", api.call("POST", `/api/season/${sid}/pause`));
  play("after failure");
}

const blob = api.call("GET", `/api/season/${sid}/export?full=true`);
note("import same", api.call("POST", "/api/season/import", blob));
note("import changed", api.changed());
console.log(`the run here: ${((Date.now() - t0) / 1000).toFixed(1)} s`);

// the season's own id, and the clock (when it was made and last saved)
const CLOCK = (k, v) => (k === "created_at" || k === "saved_at" ? "<clock>" : v);
const swap = (v) => JSON.parse(JSON.stringify(v, CLOCK).split(sid).join(ref.py_id));
if (run.length !== ref.run.length) { bad++; console.log(`DIFF the run has ${run.length} notes, the Python's ${ref.run.length}`); }
for (let i = 0; i < Math.min(run.length, ref.run.length); i++) {
  const [what, want] = ref.run[i];
  if (run[i][0] !== what) { bad++; console.log(`DIFF note ${i}: py ${what} | js ${run[i][0]}`); continue; }
  // (where a failed week broke is each language's own file and line: the message is compared)
  const WHERE = (k, v) => (k === "error" && typeof v === "string" ? v.split(" (")[0] : CLOCK(k, v));
  check("run", what, JSON.parse(JSON.stringify(want, WHERE)), JSON.parse(JSON.stringify(swap(run[i][1]), WHERE)));
}
// the Python's own export, imported here (a career this side has never seen)
{
  const theirs = attempt(() => api.call("POST", "/api/season/import", bin("export.bin")));
  check("import", "the Python's export file", { id: ref.py_id, changed: true }, "ok" in theirs ? { id: theirs.ok.id, changed: api.changed() } : theirs);
}

// a career from a league file: a conference renamed and a team edited
{
  const c = {};
  c["check"] = api.call("POST", "/api/league/check?seed=3", bin("custom2_league.bin"));
  c["stale key"] = attempt(() => api.call("POST", "/api/season", { team: "akron", league: "0".repeat(64) }));
  c["unknown team"] = attempt(() => api.call("POST", "/api/season", { team: "nope", league: c["check"]["key"] }));
  const made = api.call("POST", "/api/season", { team: "akron", league: c["check"]["key"], seed: 3 });
  c["create"] = made;
  c["pending after"] = api._pending_league;
  c["league file written"] = fs.existsSync(league.path(made["id"], league.FIRST_YEAR));
  c["conference names"] = api._conference_names(api.loaded_state());
  c["status"] = api.call("GET", `/api/season/${made["id"]}/status?since=0`);
  c["engine conference"] = ["Mid-America", "MAC", "SEC", null].map((n) => api._engine_conference(api.loaded_state(), n));
  c["key again"] = attempt(() => api.call("POST", "/api/season", { team: "akron", league: c["check"]["key"] }));
  for (const k of Object.keys(ref.custom)) {
    check("a league file's career", k, JSON.parse(JSON.stringify(ref.custom[k], CLOCK)),
      JSON.parse(JSON.stringify(plain(c[k]), CLOCK).split(made["id"]).join(ref.custom_id)));
  }
}

for (const [g, [n, b]] of Object.entries(groups)) console.log(`${b ? "FAIL" : "ok  "} ${g}: ${n - b} of ${n}`);
console.log(bad ? `${bad} of ${cases} cases differ` : `all ${cases} cases match`);
process.exit(bad ? 1 : 0);
