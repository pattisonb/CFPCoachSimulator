// Holds sim_js/season/part2.js to Python's answers (season_part2b_reference.py writes them), the other parts stubbed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = path.resolve(process.argv[2]);
const { set_reader, read_json } = await import(`${ROOT}/engine_js/files.js`);
const { modules } = await import(`${ROOT}/engine_js/modules.js`);
const { season } = await import(`${ROOT}/sim_js/season_ns.js`);
await import(`${ROOT}/sim_js/season/part2.js`);
const game_job = await import(`${ROOT}/sim_js/game_job.js`);
set_reader((p) => fs.readFileSync(path.isAbsolute(p) ? p : path.join(ROOT, p), "utf8"));
const ref = JSON.parse(fs.readFileSync(path.join(DIR, "ref2.json"), "utf8"));
function differ(a, b, at = "") {
  if (a === b) return null;
  if (a && b && typeof a === "object" && typeof b === "object" && Array.isArray(a) === Array.isArray(b)) {
    const ka = Object.keys(a), kb = Object.keys(b);
    for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
      if (ka[i] !== kb[i]) return `${at}: key ${i} is ${ka[i]}, want ${kb[i]}`;
      const d = differ(a[ka[i]], b[kb[i]], `${at}.${ka[i]}`);
      if (d) return d;
    }
    return null;
  }
  return `${at}: ${JSON.stringify(a)} want ${JSON.stringify(b)}`;
}
let bad = 0;
const check = (what, a, b) => { const d = differ(a, b); if (d) { bad++; console.log("DIFF", what, d); } };
const teams = read_json("data/engine_teams.json")["teams"];
modules.league = { GROUP_OF: ref.GROUP_OF };
modules.offseason = { move_row() { throw new Error("no league row expected"); } };
Object.assign(season, { ROLE_POSITION: game_job.ROLE_POSITION, OFFENSE_POSITIONS: game_job.OFFENSE_POSITIONS, load_teams: () => teams,
  _add_into(total, add) { for (const [k, v] of Object.entries(add)) total[k] = (total[k] ?? 0) + v; } });
for (const c of ref.cases) {
  const st = structuredClone(c.before);
  let calls = 0;
  season.team_data = () => ({ offense: [calls++ === 0 || !c.q ? c.p : c.q], defense: [] });
  season.page_overall = () => c.q_overall;
  if (c.options) { check("skills", season._skills(teams["ohio-state"].offense.concat(teams["ohio-state"].defense).find((x) => x.slug === c.slug)), c.skills);
    check("options", season.position_options(st, "ohio-state", c.slug), c.options); }
  calls = 0;
  try {
    const r = season.change_position(st, "ohio-state", c.slug, c.to);
    check("result", r, c.result);
    check("toggle", season.redshirt_toggle(st, "ohio-state", c.slug, false), c.toggle);
  } catch (e) {
    if (!(e instanceof season.PositionError)) throw e;
    check("error", [e.code, e.message], c.error ?? null);
  }
  check(`after keys`, Object.keys(st).sort(), Object.keys(c.after).sort());
  for (const k of Object.keys(c.after)) check(`after ${c.slug} ${c.to} ${k}`, st[k], c.after[k]);
}
console.log(ref.cases.length, "cases;", bad ? `${bad} differences` : "all the same");
