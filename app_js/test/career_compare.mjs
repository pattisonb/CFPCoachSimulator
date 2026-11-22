// A whole Coach Career played through the JavaScript API (app_js/game.js: every module real, nothing stubbed) and held,
// step by step, to the same career played by the Python (career_reference.py writes OUTDIR/<scenario>/):
//
//   PYTHONHASHSEED=0 python3 app_js/test/career_reference.py OUTDIR [scenario ...]
//   node app_js/test/career_compare.mjs OUTDIR [scenario ...] [--adopt] [--stop=N] [--quiet]
//
// The script below is career_reference.py's, call for call: a career started, every week of the season (your own
// recruiting moves or Auto-recruit, the advance stepped to its end, the views the page reads), the offseason stage by
// stage with the page's actions, and the first weeks of year two. After every step three things are compared with the
// Python's: every API call of the step (the request, and its answer or refusal), the whole career as its save holds
// it (season.load_season), and the new season's league file when the step wrote one. Everything must be identical
// (key order too for the games and box scores), but: the career's id, the clocks (created_at, saved_at, a box's
// played_at and duration_ms) and a box score's own random id; and a number may differ past its ninth digit (counted),
// which is what PORTING.md allows for a gauss/exp/pow result stored unrounded.
// `--adopt`: after a step whose state differs, go on from the Python's state (to see what else differs later).
// `--reload`: this side forgets the career after every step and reads it back from its save (the Python keeps its own
// in memory): a save and a load must change nothing, the order of a dict's number-like keys included.
// One scenario per process (Clear Mode is read when the game loads): with several, each runs in a child.
import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import { spawnSync } from "child_process";
import { createHash } from "crypto";
import { fileURLToPath } from "url";

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), "../..");
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flags = process.argv.slice(2).filter((a) => a.startsWith("--"));
const OUT = args[0];
const SCENARIOS = {
  blue: { team: "ohio-state", seed: 11, clear: true, auto: "off", manual: true, year2: 4 },
  g5: { team: "toledo", seed: 23, clear: false, auto: "season", manual: false, year2: 4 },
  word: { team: "smu", seed: 5, clear: false, auto: "off", manual: true, year2: 0, weeks: 6 },
};
const names = args.slice(1).length ? args.slice(1) : Object.keys(SCENARIOS);
if (names.length > 1) {
  let bad = 0;
  for (const nm of names) bad += spawnSync(process.execPath, [HERE, OUT, nm, ...flags], { stdio: "inherit" }).status ? 1 : 0;
  process.exit(bad ? 1 : 0);
}
const name = names[0];
const cfg = SCENARIOS[name];
const ADOPT = flags.includes("--adopt"), QUIET = flags.includes("--quiet"), RELOAD = flags.includes("--reload");
const STOP = Number((flags.find((f) => f.startsWith("--stop=")) || "--stop=9999").slice(7));
const dir = path.join(OUT, name);

// ----- the game, on this folder's files; saves and league files in temporary folders -----
const files = await import("../../engine_js/files.js");
files.env.CFP_SEASONS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "seasons-"));
files.env.CFP_CLEAR = cfg.clear ? "1" : "0";
const abs = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));
files.set_reader((p) => fs.readFileSync(abs(p), "utf8"));
files.set_store({
  write: (p, text) => { fs.mkdirSync(path.dirname(abs(p)), { recursive: true }); fs.writeFileSync(abs(p), text); },
  exists: (p) => fs.existsSync(abs(p)),
  remove: (p) => fs.rmSync(abs(p), { force: true }),
  remove_dir: (p) => fs.rmSync(abs(p), { recursive: true, force: true }),
  list: (p) => (fs.existsSync(abs(p)) ? fs.readdirSync(abs(p)).sort() : []),
  mtime: (p) => fs.statSync(abs(p)).mtimeMs,
});
const { api, season, career, modules } = await import("../game.js");
const { parse_ordered } = await import("../../engine_js/pyrt.js");
career.zip = { gzip: (b) => new Uint8Array(zlib.gzipSync(b)), gunzip: (b, most) => new Uint8Array(zlib.gunzipSync(b, { maxOutputLength: most })) };
const league = modules.league;
league.CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "leagues-"));

// ----- comparing -----
const CLOCKS = new Set(["created_at", "saved_at", "played_at", "duration_ms"]);
// dicts whose key order is the order Python walked a set of strings in (its hash order: PYTHONHASHSEED): the keys and
// values are compared, their order is not
const HASH_ORDER = [/^\/recruiting(_last)?\/stages$/];
const total = { values: 0, close: 0, steps: 0, bad_steps: 0, calls: 0, bad_calls: 0, close_at: {} };
/** The differences between the Python's value and this side's (at most `most`), leaves counted. */
function differences(py, js, most = 8) {
  const found = [];
  const walk = (a, b, where, key) => {
    if (found.length >= most) return;
    if (CLOCKS.has(key)) return;
    if (a === null || typeof a !== "object") total.values++;
    if (a === b) return;
    if (typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))) {
      total.close++;
      const at = where.replace(/\[\d+\]/g, "").split("/").slice(-2).join("/").replace(/r?\d{4}-\d+|[a-z]+-[a-z-]+/g, "*");
      total.close_at[at] = (total.close_at[at] || 0) + 1;
      return;
    }
    if (a === null || b === null || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) {
      found.push(`${where}: py ${String(JSON.stringify(a)).slice(0, 110)} | js ${String(JSON.stringify(b)).slice(0, 110)}`); return;
    }
    if (Array.isArray(a)) {
      if (a.length !== b.length) found.push(`${where}: length py ${a.length} | js ${b.length}`);
      for (let i = 0; i < Math.min(a.length, b.length); i++) walk(a[i], b[i], `${where}[${i}]`, null);
      return;
    }
    const box = "played_at" in a;                       // a box score: its own id is random
    const ka = Object.keys(a), kb = Object.keys(b);
    if (HASH_ORDER.some((re) => re.test(where))) { ka.sort(); kb.sort(); total.hash_order = (total.hash_order || 0) + 1; }
    if (ka.join("\u0000") !== kb.join("\u0000")) {
      const sa = new Set(ka), sb = new Set(kb);
      const only_py = ka.filter((k) => !sb.has(k)), only_js = kb.filter((k) => !sa.has(k));
      found.push(only_py.length || only_js.length ? `${where}: keys only py [${only_py.slice(0, 6)}] only js [${only_js.slice(0, 6)}]`
        : `${where}: key order differs (${ka.findIndex((k, i) => k !== kb[i])} of ${ka.length}: py ${ka.find((k, i) => k !== kb[i])} | js ${kb.find((k, i) => k !== ka[i])})`);
    }
    for (const k of ka) if (k in b && !(box && k === "id")) walk(a[k], b[k], `${where}/${k}`, k);
  };
  walk(py, js, "", null);
  return found;
}

// ----- the run's own tools (as career_reference.py's) -----
const run = { sid: null, notes: [], step: 0, times: [] };
const memo = { targets: [], fav: null, planned: null, offered: null };

function call(method, p, body = null) {
  let res;
  try {
    res = { ok: api.call(method, p.replace("{sid}", run.sid || ""), body) };
  } catch (e) {
    if (e instanceof api.ApiError) res = { api_error: [e.status, e.message] };
    else {                                            // what the API does not catch: the same error on both sides
      res = { error: e.constructor.name, message: e.message };
      run.thrown = e;
    }
  }
  if (res.ok instanceof Uint8Array) res = { ok: `<${res.ok.length > 0} bytes>` };
  // (the answer as the page gets it: written out now, since a later call may change what it holds)
  run.notes.push({ req: [method, p, body], res: JSON.parse(JSON.stringify(res)) });
  return res.ok === undefined ? null : run.notes[run.notes.length - 1].res.ok;
}
const G = (p) => call("GET", "/api/season/{sid}/" + p);
const R = (p, body) => call("POST", "/api/season/{sid}/" + p, body);
const note = (what, value) => run.notes.push({ what, value: JSON.parse(JSON.stringify(value === undefined ? null : value)) });
const pick = (xs, i) => (xs && i < xs.length ? xs[i] : null);
const now = () => Number(process.hrtime.bigint()) / 1e9;

function end_step(what, seconds = null) {
  const n = run.step;
  const tag = String(n).padStart(3, "0");
  const mine = JSON.stringify({ what, memo, notes: run.notes }).split(run.sid).join("{sid}");
  const state_text = JSON.stringify(season.load_season(run.sid)).split(run.sid).join("{sid}");
  run.times.push([n, what, seconds]);
  run.notes = [];
  run.step = n + 1;
  total.steps++;
  const file = path.join(dir, `${tag}.notes.json`);
  if (!fs.existsSync(file)) { console.log(`  ${tag} ${what}: the Python has no such step`); finish(1); }
  const py = JSON.parse(fs.readFileSync(file, "utf8")), js = JSON.parse(mine);
  let bad = 0;
  const say = (head, found) => { bad++; if (!QUIET || bad <= 3) { console.log(`  DIFF ${tag} ${what}: ${head}`); for (const f of found) console.log(`       ${f}`); } };
  if (py.what !== js.what) say(`the step is py "${py.what}" | js "${js.what}"`, []);
  if (py.notes.length !== js.notes.length) say(`${py.notes.length} notes in the Python's step, ${js.notes.length} here`, []);
  let shown = 0;
  for (let i = 0; i < Math.min(py.notes.length, js.notes.length); i++) {
    total.calls++;
    const found = differences(py.notes[i], js.notes[i], 5);
    if (found.length) {
      total.bad_calls++;
      const r = py.notes[i].req || [py.notes[i].what];
      if (js.notes[i].res && js.notes[i].res.error && !(py.notes[i].res || {}).error && run.thrown) console.log(run.thrown.stack.split("\n").slice(0, 8).join("\n"));
      if (shown++ < 6) say(`call ${i} ${r[0]} ${String(r[1] || "").replace("/api/season/{sid}", "")} ${r[2] ? JSON.stringify(r[2]) : ""}`, found);
      else bad++;
    }
  }
  const found_memo = differences(py.memo, js.memo);
  if (found_memo.length) say("the script's own memory", found_memo);
  // the whole career, as each side's save holds it
  const py_text = fs.readFileSync(path.join(dir, `${tag}.state.json`), "utf8");
  const ORDERED = [["games"], ["my_boxes"]];
  const found = differences(parse_ordered(py_text, ORDERED), parse_ordered(state_text, ORDERED), 12);
  const state_bad = found.length > 0;
  if (state_bad) say("the saved state", found);
  // the season's league file, when this step wrote one
  const py_league = path.join(dir, `${tag}.league.json`);
  const year = api.loaded_state()["year"];
  const lg = league.path(run.sid, year);
  const have = fs.existsSync(abs(lg)) && run.league_year !== year;
  if (have) run.league_year = year;
  if (fs.existsSync(py_league) !== have) say(`a league file: py ${fs.existsSync(py_league)} | js ${have}`, []);
  else if (have) {
    const theirs = JSON.parse(fs.readFileSync(py_league, "utf8"));
    // (the build's "source" is a label nothing reads: the Python writes the data folder's full path on its machine,
    // the JavaScript its path from the project's root, teamdata_js/build_teams.js)
    if (typeof theirs.source === "string" && path.isAbsolute(theirs.source)) theirs.source = path.relative(ROOT, theirs.source);
    const f2 = differences(theirs, JSON.parse(fs.readFileSync(abs(lg), "utf8").split(run.sid).join("{sid}")), 12);
    if (f2.length) say("the league file", f2);
  }
  if (bad) total.bad_steps++;
  console.log(`  ${bad ? "DIFF" : "ok  "} ${tag} ${what}${seconds !== null ? `: ${seconds.toFixed(1)} s` : ""}${bad ? ` (${bad} differences)` : ""}`);
  if (state_bad && ADOPT) {                              // go on from the Python's state
    const theirs = parse_ordered(py_text.split("{sid}").join(run.sid), ORDERED);
    api._drop(run.sid);
    if (fs.existsSync(py_league)) fs.writeFileSync(abs(lg), fs.readFileSync(py_league, "utf8").split("{sid}").join(run.sid));
    season.save_season(theirs);
    Object.assign(memo, py.memo);
    api.call("GET", `/api/season/${run.sid}/status`);
    console.log("       (going on from the Python's state)");
  } else if (bad && !ADOPT) finish(1);
  if (run.step > STOP) finish(total.bad_steps ? 1 : 0);
  if (RELOAD) {                                           // the career is read back from its save
    api._drop(run.sid);
    api.call("GET", `/api/season/${run.sid}/status`);
  }
}

function play() {
  const t0 = now();
  let n = 0;
  while (api.running()) {
    const reports = [];
    const o = api.step((r) => reports.push(r));
    const job = Object.fromEntries(Object.entries(api.job()).filter(([k]) => !k.startsWith("_")));
    note(`step ${n}`, { out: o, reports: reports.length, last: reports.length ? JSON.parse(reports[reports.length - 1]) : null, job, changed: api.changed() });
    n++;
  }
  return now() - t0;
}

// ----- the script's own recruiting week -----
function scene_call(pid, action, w, pitches) {
  const r = R("recruit", { pid, action });
  const sc = (r || {}).scene;
  if (!sc) return;
  const topics = [0, 1, 2].map((j) => pitches[(w + j * 4) % pitches.length]);
  const r2 = R("recruit", { pid, action: "present", scene: sc.id, topics });
  const sc2 = (r2 || {}).scene || sc;
  if (sc2.question) R("recruit", { pid, action: "answer", scene: sc.id, answer: ["straight", "promise", "deflect"][w % 3] });
  if (w % 4 === 3) R("recruit", { pid, action: "promise_job", scene: sc.id });
  R("recruit", { pid, action: "pitch", scene: sc.id, pitch: pitches[(w * 3 + 1) % pitches.length] });
}

function recruit_week(w, portal = false) {
  const v = G("recruiting");
  if (!v) return;
  const pitches = v.pitches;
  const hot = ((G(`prospects?limit=12&offset=${portal ? 0 : w * 4}&sort=interest`) || {}).rows || []).map((r) => r.id);
  const top = ((G(`prospects?limit=6&offset=${portal ? 0 : w * 6}&stars=4`) || {}).rows || []).map((r) => r.id);
  if (pick(hot, 10)) R("recruit/plan", { pid: hot[10], action: "message", on: true });
  if (pick(hot, 11)) R("recruit/plan", { pid: hot[11], action: "call_recruit", on: true });
  if (memo.planned && w % 3 === 2) R("recruit/plan", { pid: memo.planned, action: "message", on: false });
  if (w % 3 === 1 && pick(hot, 10)) R("recruit/plan", { pid: hot[10], action: "message", on: false });
  memo.planned = pick(hot, 10);
  const first = !memo.targets.length || (portal && w === 1);
  let T = memo.targets;
  if (!first && (w === 2 || portal)) {
    if (pick(T, 0)) R("recruit", { pid: T[0], action: "official_visit" });
    if (pick(T, 1) && !portal) R("recruit", { pid: T[1], action: "official_visit", week: w + 3 });
  }
  if (first) {
    memo.targets = hot.slice(0, 6);
    memo.targets.forEach((pid) => R("board", { pid, on: true }));
    memo.targets.slice(0, 4).forEach((pid, i) => {
      const body = { pid, action: "offer", pitch: pitches[i], nil: [0, 5, 0, 10][i] };
      if (i === 0) body.answer = "promise";
      R("recruit", body);
    });
    if (pick(memo.targets, 4)) R("recruit", { pid: memo.targets[4], action: "message", pitch: "prestige" });
    if (pick(memo.targets, 5)) scene_call(memo.targets[5], "call", w, pitches);
  } else {
    memo.targets.forEach((pid, i) => {
      const k = (w + i) % 5;
      if (k === 0) R("recruit", { pid, action: "message" });
      else if (k === 1) R("recruit", { pid, action: "call", answer: "quick" });
      else if (k === 2) R("recruit", { pid, action: "call_recruit", pitch: pitches[(w + i) % pitches.length] });
      else if (k === 3) R("recruit", { pid, action: "hc_visit", pitch: pitches[(w + 2 * i) % pitches.length] });
      else scene_call(pid, (w + i) % 2 ? "hc_visit" : "call", w, pitches);
    });
  }
  T = memo.targets;
  if (w === 3) {
    if (pick(T, 1)) R("recruit", { pid: T[1], action: "promise_role" });
    if (pick(T, 2)) R("recruit", { pid: T[2], action: "raise_nil", nil: 10 });
    if (pick(T, 4)) R("recruit", { pid: T[4], action: "offer" });
    if (pick(T, 5)) R("recruit", { pid: T[5], action: "offer", nil: 3 });
  }
  if (w === 5 && pick(T, 3)) {
    R("recruit", { pid: T[3], action: "pull_offer" });
    R("board", { pid: T[3], on: false });
  }
  // this week's new faces: the board, a favorite, scouting trips, planned quick actions, an offer
  if (pick(hot, 6)) R("board", { pid: hot[6], on: true });
  if (memo.fav) R("favorite", { pid: memo.fav, on: false });
  if (pick(hot, 7)) {
    R("favorite", { pid: hot[7], on: true });
    memo.fav = w % 2 ? hot[7] : null;
  }
  for (const pid of [pick(hot, 8), pick(hot, 9), pick(top, 0), pick(T, w % 6), pick(T, (w + 1) % 6)]) {
    if (pid) R("recruit", { pid, action: "scout" });
  }
  if (memo.offered && w % 2 === 0) R("recruit", { pid: memo.offered, action: "pull_offer" });
  if (pick(top, 1)) {
    R("recruit", { pid: top[1], action: "offer", pitch: pitches[w % pitches.length] });
    memo.offered = top[1];
  }
  if (w % 4 === 1 && !portal) R("staff", { staff_id: "r1", area: Object.keys(v.areas)[Math.floor(w / 4) % Object.keys(v.areas).length] });
  if (w === 1) {
    R("recruit", { pid: "r2027-99999", action: "call" });
    R("recruit", { pid: T[0], action: "dance" });
    R("recruit", { pid: T[0] });
  }
  G("recruiting");
}

// ----- the views the page reads in a week -----
function views(w, me, light = false) {
  const st = G(`status?since=${Math.max(0, w - 1)}`);
  G(`week/${w}`);
  G(`week/${w + 1}`);
  G("standings");
  const v = G("recruiting");
  G("recruiting/report");
  G("scouting");
  G("scouting?sort=need&limit=40&offset=20");
  G("scouting?scouted=1&sort=potential");
  G("scouting?on_board=true&sort=board");
  G(`scouting?sort=looks&position=${["QB", "WR", "CB", "OT"][w % 4]}`);
  const page = G(`prospects?limit=30&offset=${w * 30}`) || {};
  G(`prospects?limit=20&sort=interest&status=interested&position=${["QB", "WR", "CB", "EDGE"][w % 4]}`);
  G(`prospects?limit=20&stars=${3 + (w % 3)}&state=${["TX", "FL", "OH", "CA", "GA"][w % 5]}`);
  G("prospects?limit=20&status=committed");
  G("prospects?limit=15&commit=1&scouted=1&offers_min=1");
  const ids = (page.rows || []).map((r) => r.id);
  const board = ((v || {}).board || []).map((b) => b.id);
  for (const pid of new Set([pick(ids, 0), pick(ids, 7), pick(board, 0), pick(board, w % 5), pick(memo.targets, w % 6)])) {
    if (pid) G(`prospect/${pid}`);
  }
  G("classes");
  if (w % 3 === 0) G(`classes?school=${me}`);
  G("office");
  G("headquarters?want=commits,movers,contacts,outlook,next_year,goals,tasks,promises");
  if (pick(board, 0)) G(`headquarters?want=whatif&pid=${board[0]}`);
  G(`news?since_week=${Math.max(0, w - 2)}`);
  G(`depth/${me}`);
  const roster = (G(`depth/${me}/roster`) || {}).players || [];
  for (const i of [w, w + 20, w + 50]) {
    const p = pick(roster, i % Math.max(1, roster.length));
    if (p) G(`player?team=${me}&slug=${p.slug}`);
  }
  G("programs");
  G(`schedule/${me}`);
  G("preview");
  G("injuries");
  G("settings");
  if (light) return st;
  G("awards");
  G("stats/leaders");
  G(`stats/leaders?team=${me}&n=3`);
  G("stats/teams");
  G(`stats/players?cat=${["passing", "rushing", "receiving", "defense"][w % 4]}`);
  G("resume");
  G(`resume?team=${me}`);
  G("rivalries");
  if (w % 4 === 0) G("review");
  const last = (st || {}).results || [];
  if (last.length && last[last.length - 1].event_id) G(`game/${last[last.length - 1].event_id}`);
  return st;
}

function weeks(me, limit, year2 = false) {
  let played = 0;
  while (played < limit) {
    const st = G("status");
    if (!st || api.loaded_state()["done"]) break;
    const w = st.current_week;
    if (cfg.manual) recruit_week(w);
    if (!year2) {
      if (w === 0) {
        const ed = G("schedule_edit") || {};
        const g = pick(ed.games, 0);
        if (g && g.options && g.options.length) R("schedule_edit", { event_id: g.event_id, slug: g.options[0].slug });
        G("schedule_edit");
        R("settings", { auto_recruit: cfg.auto });
        R("headquarters", { cards: [{ id: "a1", widget: "commits", size: "M" }, { id: "a2", widget: "tasks", size: "S" }] });
        R("headquarters/plan", { tasks: [{ id: "t1", text: "Call the quarterback", done: false }], goals: { commits: 20, top100: 3, rank: 10 } });
      }
      const roster = (G(`depth/${me}/roster`) || {}).players || [];
      if (w === 1 && roster.length) {
        const units = (G(`depth/${me}`) || {}).units || [];
        note("depth units", units.map((u) => [u.name === undefined ? null : u.name, (u.positions || u.roles || []).length]));
        R(`depth/${me}`, { role: "QB", player: roster[1].slug, move: "up" });
        G(`depth/${me}/position/QB`);
        G(`depth/${me}/formations`);
      }
      if (w === 2 && roster.length) {
        const fr = roster.filter((p) => p.class === "FR");
        for (const p of fr.slice(-2)) R("redshirt", { team: me, player: p.slug, on: true });
        if (fr.length) R("redshirt", { team: me, player: fr[fr.length - 1].slug, on: false });
      }
      if (w === 3 && roster.length) {
        const p = roster[Math.floor(roster.length / 2)];
        const opts = (G(`position_options/${me}/${p.slug}`) || {}).options || [];
        if (opts.length > 1) R("position", { team: me, player: p.slug, pos: opts[1].pos || opts[1].position });
      }
    }
    let t = 0.0;
    if (w % 5 === 4) {                              // game day: your game alone, then the rest of the week
      if (R("gameday", null)) t += play();
    }
    const two = !cfg.manual && w % 6 === 2;         // a two-week run: Auto-recruit plays the second week's recruiting
    R("advance", two ? { to: w + 2 } : {});
    t += play();
    played += two ? 2 : 1;
    views(api.loaded_state()["current_week"], me);
    end_step(`week ${api.loaded_state()["current_week"]}` + (year2 ? " (year two)" : ""), t);
  }
}

function offseason(me) {
  for (let turn = 0; turn < 40; turn++) {
    const t0 = now();
    const v = G("offseason");
    if (!v) break;
    const stage = v.stage;
    G("recruiting");
    G(`depth/${me}/roster`);
    if (v.job && !v.job.choice) {
      const rows = (v.job.offers && v.job.offers.length ? v.job.offers : v.job.openings) || [];
      R("offseason/job", { team: rows.length && !cfg.manual ? rows[0].team : null, stage });
    }
    if (stage === "retention") {
      if (v.review && !v.review.decided) {
        const opts = v.review.options || [];
        R("offseason/review", { action: opts.includes("case") ? "case" : pick(opts, 0), stage });
      }
      const rp = (v.retention || {}).players || [];
      rp.slice(0, 4).forEach((e) => R("offseason/retain", { pid: e.id, action: "meet", stage }));
      if (pick(rp, 0)) R("offseason/retain", { pid: rp[0].id, action: "promise" });
      if (pick(rp, 1)) {
        R("offseason/retain", { pid: rp[1].id, action: "nil", nil: 10 });
        R("offseason/retain", { pid: rp[1].id, action: "nil", nil: 100000 });
      }
      if (pick(rp, 2)) R("offseason/retain", { pid: rp[2].id, action: "release" });
      R("offseason/retain", { pid: "nobody", action: "meet" });
    }
    if (stage === "departures") {
      const mine = v.my_roster || [];
      const under = mine.filter((p) => p.cls === "FR" || p.cls === "SO");
      for (const p of under.slice(0, 2)) R("offseason/redshirt", { pid: p.id, on: true, stage });
      if (under.length) R("offseason/redshirt", { pid: under[0].id, on: false });
      const p = pick(mine, Math.floor(mine.length / 3));
      if (p) {
        const opts = (G(`offseason/position_options?pid=${p.id}`) || {}).options || [];
        if (opts.length > 1) R("offseason/position", { pid: p.id, pos: opts[1].pos || opts[1].position, stage });
      }
      R("offseason/advance", { stage: "retention" });          // a click drawn on an earlier stage: refused
    }
    if (stage.startsWith("portal_w")) {
      const wk = Number(stage[stage.length - 1]);
      const board = (v.portal || {}).board || [];
      note("portal board", Array.isArray(board) ? board.length : Object.keys(board).sort().slice(0, 8));
      const rows = (G("prospects?limit=10&sort=interest") || {}).rows || [];
      for (const r of rows.slice(wk, wk + 2)) R("offseason/portal", { pid: r.id, on: true, stage });
      if (wk === 2 && pick(rows, 2)) R("offseason/portal", { pid: rows[2].id, on: false });
      if (cfg.manual) recruit_week(wk, true);
      G("scouting");
      for (const r of rows.slice(0, 2)) G(`prospect/${r.id}`);
      G("classes");
    }
    if (stage === "staff") {
      const stf = v.staff || {};
      const cands = stf.candidates || {};
      for (const sid_ of Object.keys(cands).slice(0, 8)) R("offseason/hire", { staff_id: sid_, index: cands[sid_].length > 1 ? 1 : 0, stage });
      if (cfg.manual) {
        const ys = v.your_staff || [];
        if (pick(ys, 1)) {
          R("offseason/open_role", { staff_id: ys[1].id, stage });
          const v2 = G("offseason") || {};
          const c2 = ((v2.staff || {}).candidates || {})[ys[1].id];
          if (c2 && c2.length) R("offseason/hire", { staff_id: ys[1].id, index: 0, stage });
        }
      }
      R("offseason/hire", { staff_id: "nobody", index: 0 });
    }
    if (stage === "conferences") {
      const cv = G("offseason/conferences") || {};
      const confs = cv.conferences || [];
      if (!cfg.manual && confs.length > 4) {
        R("offseason/conference", { team: confs[0].teams[confs[0].teams.length - 1].team, conference: confs[4].name, stage });
        R("offseason/conference", { team: confs[6].teams[0].team, conference: confs[1].name, stage });
        R("offseason/conference", { team: "nobody", conference: confs[1].name });
        G("offseason/conferences");
      }
    }
    if (stage === "schedule") {
      const sv = G("offseason/schedule") || {};
      const g = (sv.editable || []).find((x) => x.options && x.options.length);
      const opt = g ? g.options.find((o) => o.accepts) : null;
      if (opt) R("offseason/schedule", { event_id: g.event_id, slug: opt.slug, stage });
      const moves = (G("offseason/schedule") || {}).moves || {};
      const eid = Object.keys(moves).find((k) => moves[k] && moves[k].length);
      if (eid) R("offseason/schedule/move", { event_id: eid, week: moves[eid][moves[eid].length - 1].week, stage });
      R("offseason/schedule/move", { event_id: "nothing", week: 3 });
      G("offseason/schedule");
    }
    const out = R("offseason/advance", { stage });
    if (!(out || {}).next_season) G("offseason");
    G("status");
    end_step(`offseason after ${stage}`, now() - t0);
    if ((out || {}).next_season) return true;
  }
  return false;
}

function finish(code) {
  fs.writeFileSync(path.join(dir, "times_js.json"), JSON.stringify({ scenario: name, steps: run.times, total: now() - T0 }));
  if (fs.existsSync(path.join(dir, "times.json"))) {
    const py = JSON.parse(fs.readFileSync(path.join(dir, "times.json"), "utf8"));
    const by = Object.fromEntries(py.steps.map(([, what, s]) => [what, s]));
    const kinds = { "the start": [0, 0, 0], "a week (the advance alone)": [0, 0, 0], "an offseason stage (views, moves and the advance)": [0, 0, 0], "a week of year two": [0, 0, 0] };
    for (const [, what, s] of run.times) {
      if (s === null || by[what] === undefined || by[what] === null) continue;
      const k = what === "start" ? "the start" : what.includes("year two") ? "a week of year two" : what.startsWith("week") ? "a week (the advance alone)" : "an offseason stage (views, moves and the advance)";
      kinds[k][0]++; kinds[k][1] += by[what]; kinds[k][2] += s;
    }
    console.log(`  seconds, Python (SIM_WORKERS=${py.workers}) against JavaScript:`);
    for (const [k, [n, a, b]] of Object.entries(kinds)) if (n) console.log(`    ${k}: ${n} steps, py ${a.toFixed(1)} (${(a / n).toFixed(2)} each) | js ${b.toFixed(1)} (${(b / n).toFixed(2)} each)`);
    console.log(`    the whole run with its views and comparisons: py ${py.total.toFixed(0)} | js ${(now() - T0).toFixed(0)}`);
  }
  const by_field = Object.entries(total.close_at).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, n]) => `${k} ${n}`).join(", ");
  console.log(`${name}: ${total.steps} steps, ${total.calls} calls and notes (${total.bad_calls} differ), ${total.values} values compared, `
    + `${total.close} numbers differ only past the ninth digit${by_field ? ` (${by_field})` : ""}: ${total.bad_steps ? `${total.bad_steps} STEPS DIFFER` : "all the same"}`);
  process.exit(code);
}

// ----- the run -----
const T0 = now();
console.log(`${name}: ${JSON.stringify(cfg)}`);
// the career's id is random, and two reads are seeded from it (your next game's Win Chance, the staff's
// recommendations): both sides give this career the same id, made from the scenario's name
const real_uuid = globalThis.crypto.randomUUID;
globalThis.crypto.randomUUID = () => createHash("md5").update(name).digest("hex");
const s = call("POST", "/api/season", { team: cfg.team, seed: cfg.seed, career: true });
globalThis.crypto.randomUUID = real_uuid;
run.sid = s.id;
run.notes[run.notes.length - 1].res = JSON.parse(JSON.stringify(run.notes[run.notes.length - 1].res).split(s.id).join("{sid}"));
let me = cfg.team;
views(0, me, true);
end_step("start", now() - T0);
weeks(me, cfg.weeks === undefined ? 99 : cfg.weeks);
if (cfg.year2) {
  if (offseason(me)) {
    me = api.loaded_state()["team"];
    Object.assign(memo, { targets: [], fav: null, planned: null, offered: null });
    views(0, me, true);
    end_step("year two start");
    weeks(me, cfg.year2, true);
  }
}
const want = JSON.parse(fs.readFileSync(path.join(dir, "steps.json"), "utf8"));
if (want !== run.step) { console.log(`  the Python played ${want} steps, this side ${run.step}`); total.bad_steps++; }
finish(total.bad_steps ? 1 : 0);
