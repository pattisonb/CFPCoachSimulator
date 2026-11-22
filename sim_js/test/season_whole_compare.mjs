// The JavaScript season (sim_js/season.js) played beside the Python's, the whole state compared after the start and
// after every week, key order included: node sim_js/test/season_whole_compare.mjs OUT (after season_whole_reference.py)
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { set_reader, set_store, env } from "../../engine_js/files.js";
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

const setup = JSON.parse(fs.readFileSync(path.join(out, "setup.json"), "utf8"));
// the two modules the season asks that are not ported yet: only their constants are read in a plain season
modules.league = { OFFENSE_ROLES: new Set(setup.OFFENSE_ROLES), TEAM_FIT: setup.TEAM_FIT, GROUP_OF: setup.GROUP_OF };
modules.clear = { on: () => setup.clear };
modules.promises = { snapshot_week: () => null };      // a plain season has no promises to record
const { season } = await import("../season.js");

const SKIP = new Set(["id", "created_at", "saved_at"]);                 // the season's own id and clock
const BOX_SKIP = /^\/my_boxes\/[^/]+\/(id|played_at|duration_ms)$/;      // a box's own id, clock and how long it took
function diff(a, b, where, found) {
  if (found.length >= 12) return;
  if (a === b || BOX_SKIP.test(where)) return;
  if (typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))) { found.close = (found.close || 0) + 1; return; }
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) {
    found.push(`${where}: py ${JSON.stringify(a)?.slice(0, 80)} | js ${JSON.stringify(b)?.slice(0, 80)}`); return;
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
  for (const k of ka) if (k in b && !(where === "" && SKIP.has(k))) diff(a[k], b[k], `${where}/${k}`, found);
}

let state = season.new_season(setup.team, "full", setup.seed);
let bad = 0, close = 0;
const t0 = Date.now();
for (let n = 0; ; n++) {
  const file = path.join(out, `py_${String(n).padStart(2, "0")}.json`);
  if (!fs.existsSync(file)) { console.log(`no ${file}`); bad++; break; }
  const text = fs.readFileSync(file, "utf8");
  const { parse_ordered } = await import("../../engine_js/pyrt.js");
  const py = parse_ordered(text, [["games"], ["my_boxes"]]);
  const found = [];
  diff(py, state, "", found);
  close += found.close || 0;
  if (found.length) { bad++; console.log(`after ${n} weeks:`); for (const f of found) console.log("  " + f); if (bad >= 2) break; }
  if (state.done) break;
  state = season.advance(state);
}
console.log(bad ? "DIFFERENT" : `the same through the season (${close} numbers differ only past the ninth digit)`, `${Date.now() - t0} ms`);
process.exit(bad ? 1 : 0);
