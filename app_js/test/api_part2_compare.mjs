// app_js/api/part2.js against the Python it was ported from: node app_js/test/api_part2_compare.mjs OUTDIR
// (after python3 app_js/test/api_part2_reference.py OUTDIR).
//  1. The part loaded alone on the api namespace (a stub api.route): the routes it registers (method, pattern,
//     handler, order) and the names it puts on the namespace are the Python range's. Run in a process of its own.
//  2. _champion_name on the reference's saves.
//  3. The reference's scripted runs replayed through api.call on copies of the same save files (the whole api
//     loaded: part 1 and every game module for real), each answer or refusal compared exactly, key order included.
//     Not compared: the clocks (saved_at, updated_at, created_at, played_at, duration_ms).
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { use_repo_files, tally, read } from "../../career_js/test/compare_tools.mjs";
import { env } from "../../engine_js/files.js";
import { modules } from "../../engine_js/modules.js";

const out = process.argv[2];
const self = fileURLToPath(import.meta.url);
const t = tally();

if (process.argv[3] === "alone") {
  // ----- 1. the part alone -------------------------------------------------------------------------------------
  const { api } = await import("../api_ns.js");
  const got = [];
  api.route = (method, pattern, fn) => { got.push([method, pattern, fn.name]); };
  const before = new Set(Object.keys(api));
  await import("../api/part2.js");
  const want = read(out, "routes.json");
  t.same("routes", want.routes, got);
  t.same("names", want.names, Object.keys(api).filter((k) => !before.has(k) && typeof api[k] === "function").sort());
  for (const [, , name] of got) if (typeof api[name] !== "function") { t.bad++; console.log(`no api.${name}`); }
  console.log(`alone: ${got.length} routes, ${want.names.length} names, ${t.bad} different`);
  process.exit(t.bad ? 1 : 0);
}

const alone = spawnSync(process.execPath, [self, out, "alone"], { encoding: "utf8" });
process.stdout.write(alone.stdout + alone.stderr);
let bad = alone.status ? 1 : 0;

// ----- the whole api, on folders of its own ----------------------------------------------------------------------
use_repo_files();
const SEASONS = fs.mkdtempSync(path.join(os.tmpdir(), "seasons-"));
env.CFP_SEASONS_DIR = SEASONS;
// every game module, as a host loads them (the api reaches most through `modules`)
for (const f of ["sim_js/season.js", "career_js/recruiting.js", "career_js/offseason.js", "career_js/persona.js", "career_js/scenes.js",
  "career_js/league_file.js", "career_js/league_fill.js", "career_js/headquarters.js", "career_js/office.js", "career_js/programs.js",
  "career_js/promises.js", "career_js/clear.js", "career_js/ability_goals.js", "career_js/grades.js", "career_js/word.js",
  "career_js/career.js", "career_js/carousel.js", "career_js/coach_names.js", "sim_js/news.js", "sim_js/schedule_gen.js",
  "sim_js/form.js", "sim_js/grade.js"]) await import(`../../${f}`);
const { api } = await import("../api.js");
if (process.env.API2_PATCH_RECORDS) {
  // career_js/offseason/part3.js (_league_marks) asks season._records(state, true): `true` lands on through_week, where
  // Python passes include_playoff=True. With this set, that call is read as Python's, to see what else differs.
  const records = modules.season._records;
  modules.season._records = (state, through_week = null, include_playoff = false) =>
    (through_week === true ? records(state, null, true) : records(state, through_week, include_playoff));
}
modules.league.CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "leagues-"));
const COACHES = fs.mkdtempSync(path.join(os.tmpdir(), "coaches-"));
modules.coaches.store = {
  read: (id) => (fs.existsSync(path.join(COACHES, `${id}.json`)) ? fs.readFileSync(path.join(COACHES, `${id}.json`), "utf8") : null),
  write: (id, text) => fs.writeFileSync(path.join(COACHES, `${id}.json`), text),
  remove: (id) => fs.rmSync(path.join(COACHES, `${id}.json`), { force: true }),
  list: () => fs.readdirSync(COACHES).filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -5)).sort(),
};

// ----- 2. the pure helper ----------------------------------------------------------------------------------------
{
  const cases = read(out, "pure.json");
  const n0 = t.bad;
  for (const [i, c] of cases.entries()) t.same(`_champion_name #${i} ${JSON.stringify(c.st).slice(0, 80)}`, c.out, api._champion_name(c.st));
  console.log(`_champion_name: ${cases.length} cases, ${t.bad - n0} different`);
}

// ----- 3. the scripted runs --------------------------------------------------------------------------------------
const CLOCKS = new Set(["saved_at", "updated_at", "created_at", "played_at", "duration_ms"]);
const no_clocks = (v) => {
  if (Array.isArray(v)) return v.map(no_clocks);
  if (v !== null && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([k]) => !CLOCKS.has(k)).map(([k, x]) => [k, no_clocks(x)]));
  return v;
};
function copy_in(dir) {
  const from = path.join(out, dir);
  for (const name of fs.readdirSync(from)) fs.cpSync(path.join(from, name), path.join(SEASONS, name), { recursive: true, preserveTimestamps: true });
}
const only = process.argv[3] ? process.argv[3].split(",") : ["act0", "act1", "act2", "act3"];
const not_run = new Set(api.ROUTES.map((r) => r[2].name));
const by_handler = {};
function handler_of(method, url) {
  const parts = url.split("?")[0].replace(/^\/+|\/+$/g, "").split("/");
  for (const [m, pattern, fn] of api.ROUTES) if (m === method && api._match(pattern, parts) !== null) return fn.name;
  return "(no route)";
}
for (const act of only) {
  if (!fs.existsSync(path.join(out, `${act}.json`))) { console.log(`no ${act}.json`); bad++; continue; }
  if (act === "act2" || act === "act3") copy_in("act1_seasons");      // (the other saves beside it, as Python's folder had them)
  copy_in(`${act}_seasons`);
  const { steps } = read(out, `${act}.json`);
  const n0 = t.bad, t0 = Date.now();
  let refused = 0, crashed = 0;
  for (const [i, s] of steps.entries()) {
    const name = handler_of(s.method, s.path);
    let got;
    // a coach's updated_at is to the second, and the coaches are listed by it: the reference waited here too
    if (s.method === "POST" && s.path === "/api/coaches") Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1100);
    try {
      const result = api.call(s.method, s.path, s.body === null ? null : structuredClone(s.body));
      got = { result: JSON.parse(JSON.stringify(result)) };
    } catch (e) {
      if (e instanceof api.ApiError) got = { status: e.status, message: e.message };
      else if ("crash" in s) got = { crash: true };       // Python's handler broke here too (which error is not compared)
      else {
        got = { crashed: String(e && e.stack ? e.stack.split("\n").slice(0, 4).join(" | ") : e) };
        if (crashed++ < 8) console.log(`BROKE ${act} #${i} ${s.method} ${s.path}: ${got.crashed.slice(0, 500)}`);
      }
    }
    if ("status" in s) refused++;
    const want = "crash" in s ? { crash: true } : "status" in s ? { status: s.status, message: s.message } : { result: s.result };
    const ok = t.same(`${act} #${i} ${s.method} ${s.path} ${JSON.stringify(s.body) ?? ""}`.slice(0, 220), no_clocks(want), no_clocks(got));
    const h = (by_handler[name] ||= { asked: 0, same: 0, answered: 0 });
    h.asked++; if (ok) h.same++; if (ok && "result" in want) h.answered++;
    not_run.delete(name);
  }
  console.log(`${act}: ${steps.length} calls (${refused} refusals in Python), ${t.bad - n0} different, ${crashed} crashed here, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
const part2 = read(out, "routes.json").routes.map((r) => r[2]);
console.log("handlers of the part never asked: " + (part2.filter((n) => not_run.has(n)).join(", ") || "none"));
console.log("asked but never answered the same with a result (refusals only, or different): "
  + (part2.filter((n) => by_handler[n] && !by_handler[n].answered).map((n) => `${n} ${by_handler[n].same}/${by_handler[n].asked}`).join(", ") || "none"));
console.log("handlers with a difference: "
  + (Object.entries(by_handler).filter(([, h]) => h.same < h.asked).map(([n, h]) => `${n} ${h.asked - h.same}/${h.asked}`).join(", ") || "none"));
console.log(`${t.cases} cases, ${t.bad + bad} different`);
process.exit(t.bad + bad ? 1 : 0);
