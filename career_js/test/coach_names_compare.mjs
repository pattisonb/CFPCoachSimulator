// career_js/coach_names.js held to coach_career/coach_names.py's answers: node career_js/test/coach_names_compare.mjs OUT
// (after python3 career_js/test/coach_names_reference.py OUT)
import path from "path";
import { use_repo_files, read, copy, tally } from "./compare_tools.mjs";
import { modules, has } from "../../engine_js/modules.js";

const out = path.resolve(process.argv[2]);
use_repo_files();
await import("../league.js");                                    // the season reads league's constants
if (!has("clear")) modules.clear = { on: () => false };          // the reference runs with Clear Mode off
if (!has("promises")) modules.promises = { snapshot_week: () => null };
const { season } = await import("../../sim_js/season.js");       // the real coaches' names come from the season's teams
const { coach_names } = await import("../coach_names.js");

// carousel is not part of this port: _age gives a coach the age Python's gave him (by his name and the year)
const ages = read(out, "ages.json");
let asked = 0;
modules.carousel = {
  ...(has("carousel") ? modules.carousel : {}),
  _age(c, year) {
    asked++;
    const at = ages[`${c.name ?? "None"}|${year}`];
    if (!at) throw new Error(`no recorded age for ${c.name} in ${year}`);
    if (!c.age_at || !c.age_at.length) c.age_at = [...at];
    return c.age_at[1] + (year - c.age_at[0]);
  },
};

const t = tally();
const names = read(out, "base_names.json");
t.same("the season has no teams loaded yet", true, Object.keys(season._teams_cache).length === 0);
t.same("base_names from the file", names.from_file, [...coach_names.base_names()].sort());
t.same("base_names from the file again (kept by path)", names.from_file, [...coach_names.base_names()].sort());
season.load_teams();
t.same("base_names from the loaded teams", names.from_teams, [...coach_names.base_names()].sort());

const small = read(out, "small.json");
for (const [s, r, res, py] of small.own_name) t.same(`own_name ${s} ${r} [${res}]`, py, coach_names.own_name(s, r, new Set(res)));
for (const [s, py] of small.own_name_default) t.same(`own_name ${s} (nothing reserved)`, py, coach_names.own_name(s, "offensive_coordinator"));
for (const [name, taken, where, py] of small.with_initial) t.same(`with_initial ${name} (${taken.length} taken) ${where}`, py, coach_names.with_initial(name, new Set(taken), where));
for (const [s, role, a, b, created, py] of small.coordinator_name) t.same(`coordinator_name ${s} ${role} ${a} ${b} ${created}`, py, coach_names.coordinator_name(s, role, a, b, created));

const cases = read(out, "cases.json");
cases.forEach((c, i) => {
  const state = copy(c.state);
  t.same(`career ${i}: _you_slug, your_record, player_name`, c.reads, [coach_names._you_slug(state), coach_names.your_record(state), coach_names.player_name(state)]);
  t.same(`career ${i}: reading changed nothing`, c.state, state);
  const first = coach_names.distinct(state, c.built);
  t.same(`career ${i}: distinct's renames`, c.renames, first);
  t.same(`career ${i}: the career after`, c.after, state);
  const second = coach_names.distinct(state);
  t.same(`career ${i}: distinct again, renames`, c.renames_again, second);
  t.same(`career ${i}: the career after that`, c.after_again, state);
});
t.same("ages asked of the carousel", Object.keys(ages).length > 0, asked > 0);

t.done("coach_names.js against coach_names.py");
