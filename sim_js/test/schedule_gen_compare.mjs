// sim_js/schedule_gen.js held to the Python's schedules (schedule_gen_reference.py's): every case generated here from
// the same teams, history, rules and seed, and compared whole: every game, in order, every key in order, the history
// carried forward, and the generator's next number. node sim_js/test/schedule_gen_compare.mjs OUTDIR
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { set_reader, set_store, env } from "../../engine_js/files.js";
import { modules } from "../../engine_js/modules.js";
import { Random, is_odict } from "../../engine_js/pyrt.js";

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

const setup = JSON.parse(fs.readFileSync(path.join(out, "setup.json"), "utf8"));
modules.league = { OFFENSE_ROLES: new Set(setup.OFFENSE_ROLES), TEAM_FIT: setup.TEAM_FIT, GROUP_OF: setup.GROUP_OF };
modules.clear = { on: () => setup.clear };
const { season } = await import("../season.js");
const { schedule_gen } = await import("../schedule_gen.js");
if (modules.schedule_gen !== schedule_gen) throw new Error("schedule_gen is not registered on modules");

/** A value as the reference wrote it: every dict as its [key, value] pairs, in the order the keys are listed here. */
function ordered(o) {
  if (Array.isArray(o)) return o.map(ordered);
  if (o !== null && typeof o === "object") return { __d: Object.keys(o).map((k) => [k, ordered(o[k])]) };
  return o === undefined ? "undefined!" : o;
}
/** And back: a plain object, keys added in the reference's order (none of these dicts has a key that is a whole number... the teams). */
function plain(o) {
  if (Array.isArray(o)) return o.map(plain);
  if (o !== null && typeof o === "object") { const d = {}; for (const [k, v] of o.__d) d[k] = plain(v); return d; }
  return o;
}
/** Where two ordered values first differ. */
function first_diff(a, b, where = "") {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${where}: length py ${a.length} | js ${b.length}`;
    for (let i = 0; i < a.length; i++) { const d = first_diff(a[i], b[i], `${where}[${i}]`); if (d) return d; }
  }
  if (a && b && a.__d && b.__d) {
    const ka = a.__d.map((p) => p[0]), kb = b.__d.map((p) => p[0]);
    if (ka.join("\u0000") !== kb.join("\u0000")) return `${where}: keys py [${ka.slice(0, 8)}] | js [${kb.slice(0, 8)}] (${ka.length} | ${kb.length})`;
    for (let i = 0; i < ka.length; i++) { const d = first_diff(a.__d[i][1], b.__d[i][1], `${where}/${ka[i]}`); if (d) return d; }
  }
  return `${where}: py ${JSON.stringify(a)?.slice(0, 120)} | js ${JSON.stringify(b)?.slice(0, 120)}`;
}

let bad = 0, same = 0;
const check = (name, py, js) => {
  const d = first_diff(py, js);
  if (d) { bad++; if (bad <= 15) console.log(`DIFFERENT ${name}: ${d}`); } else same++;
};

// the constants and the small functions
for (const [k, v] of Object.entries(setup.constants)) check(`constant ${k}`, v, schedule_gen[k]);
for (const [a, b, want] of setup.small.pair_key) check(`pair_key ${a} ${b}`, want, schedule_gen.pair_key(a, b));
for (const [kind, want] of Object.entries(setup.small.prefs)) check(`_prefs ${kind}`, want, schedule_gen._prefs({ kind }));
for (const [conf, year, want] of setup.small.league_games) check(`_league_games ${conf} ${year}`, want, schedule_gen._league_games(schedule_gen.rules()["conferences"][conf], year));

// the 2026 history: through the JavaScript season's own teams and FCS map, and from the schedule file alone
const team_sets = {};
for (const [k, v] of Object.entries(setup.team_sets)) team_sets[k] = plain(v);
check("seed_history(season.load_teams())", setup.seeded.default, ordered(schedule_gen.seed_history(season.load_teams())));
check("seed_history(teams, schedules)", setup.seeded.explicit,
  ordered(schedule_gen.seed_history(team_sets.builtin, JSON.parse(fs.readFileSync(abs(setup.schedules), "utf8")))));
check("empty_history()", setup.seeded.empty, ordered(schedule_gen.empty_history()));
if (schedule_gen.empty_history() === schedule_gen.empty_history()) { bad++; console.log("empty_history gives the same object twice"); }

// every generated season
const t0 = Date.now();
let rng = null, carried = null, games_total = 0, errors = 0, odicts = 0;
const by_name = {};
for (const c of setup.cases) {
  const py = JSON.parse(fs.readFileSync(path.join(out, c.file), "utf8"));
  if (c.seed !== null) rng = new Random(c.seed);                       // (a chain's later years go on with its generator)
  const history = c.chained && c.history === null ? carried : c.history === null ? null : setup.histories[c.history];
  const before = JSON.stringify(history);
  let js = {};
  try {
    const [games, hist] = schedule_gen.generate(c.year, team_sets[c.teams], history, rng, c.rules ? setup.rule_sets[c.rules] : null);
    js = { games: Object.entries(games).map(([eid, g]) => [eid, ordered(g)]), hist: ordered(hist) };
    carried = hist;
    games_total += js.games.length;
    if (is_odict(games)) odicts++;
  } catch (err) {
    // (a slate so odd the generator itself trips, as Python's does with an IndexError: only that it does is compared)
    js = { error: err instanceof schedule_gen.ScheduleError ? err.message : "(not a ScheduleError)" };
    if (!(err instanceof schedule_gen.ScheduleError)) js.thrown = String(err);
    carried = null;
    errors++;
  }
  js.next_random = rng.random();
  if (JSON.stringify(history) !== before) { bad++; console.log(`${c.name} ${c.year}: generate changed the history it was given`); }
  const n = bad;
  const label = `${c.name} ${c.year} (seed ${c.seed}, ${c.file})`;
  check(`${label} error`, py.error ?? null, js.error ?? null);
  if (js.thrown && py.error !== js.error) console.log(`  (thrown here: ${js.thrown})`);
  check(`${label} games`, py.games ?? null, js.games ?? null);
  check(`${label} history`, py.hist ?? null, js.hist ?? null);
  check(`${label} next random number`, py.next_random, js.next_random);
  const key = c.name.replace(/ .*/, "");
  by_name[key] = by_name[key] || [0, 0];
  by_name[key][bad === n ? 0 : 1]++;
}
for (const [k, [ok, no]] of Object.entries(by_name)) console.log(`  ${k}: ${ok} seasons the same${no ? `, ${no} DIFFERENT` : ""}`);
console.log(`${setup.cases.length} seasons generated (${games_total} games, ${errors} errors, ${odicts} returned as odicts), ${Date.now() - t0} ms`);
console.log(bad ? `DIFFERENT: ${bad} checks failed, ${same} the same` : `the same: all ${same} checks`);
process.exit(bad ? 1 : 0);
