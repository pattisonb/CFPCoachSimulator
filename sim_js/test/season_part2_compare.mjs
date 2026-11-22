// Holds sim_js/season/part2.js to Python's answers (season_part2_reference.py writes them), the other parts stubbed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = path.resolve(process.argv[2]);
const { set_reader } = await import(`${ROOT}/engine_js/files.js`);
const { season } = await import(`${ROOT}/sim_js/season_ns.js`);
await import(`${ROOT}/sim_js/season/part2.js`);
set_reader((p) => fs.readFileSync(path.isAbsolute(p) ? p : path.join(ROOT, p), "utf8"));
const { read_json } = await import(`${ROOT}/engine_js/files.js`);
const ref = JSON.parse(fs.readFileSync(path.join(DIR, "ref.json"), "utf8"));
console.log("names:", Object.keys(season).join(" "));

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

Object.assign(season, { LAST_REGULAR_WEEK: 14, CCG_WEEK: 15, SELECTION_WEEK: 16, FINAL_WEEK: 20,
  PLAYOFF_WEEKS: { 17: "First round", 18: "Quarterfinals", 19: "Semifinals", 20: "National championship" },
  BOWL_WEEK_LABELS: { 17: "First Round & Bowls", 18: "Quarterfinals & Bowls", 19: "Semifinals & New Year Bowls", 20: "National Championship" },
  HOSTED_CCG: new Set(["Sun Belt", "Mountain West", "American Athletic Conference", "Conference USA"]),
  CFP_WEEKS: new Set([10, 11, 12, 13, 14, 15]), _league_path: "data/engine_teams.json",
  load_teams: () => read_json("data/engine_teams.json")["teams"],
  _ccg_event_id: (c) => `ccg-${c.toLowerCase().replaceAll(" ", "-")}`,
  rank_map: () => ({}), _accumulate_stats() {}, _update_morale() {}, save_box() {} });
const { modules } = await import(`${ROOT}/engine_js/modules.js`);
modules.ability_goals = { after_game() {} };
const tr = JSON.parse(fs.readFileSync(path.join(DIR, "tr.json"), "utf8"));
const loaded = Object.fromEntries(Object.entries(read_json("data/engine_teams.json")["teams"]).map(([s, t]) => [s, { ...t, ...tr[s] }]));
season.load_teams = () => loaded;
const teams = season.load_teams();
const state_of = (b) => { const s = { ...structuredClone(b), games: Object.fromEntries(structuredClone(b.games)), my_boxes: {} }; for (const k of Object.keys(s)) if (s[k] === null) delete s[k]; return s; };
const pairs = (o) => Object.entries(o);

for (const [w, [label, name]] of Object.entries(ref.labels)) { check(`label ${w}`, season.week_label(Number(w)), label); check(`name ${w}`, season.week_name(Number(w)), name); }
check("fictional", Object.keys(teams).filter((s) => season.state_fictional(s)).sort(), ref.fictional);
for (const r of ref.redshirt) check("redshirt", season.redshirt_status(r.state, "ohio-state", r.p), r.result);
for (const r of ref.injured) check("injured", season._injured(r.state, r.slug), r.result);
{ const m = ref.misc.my_game_id; const st = { games: Object.fromEntries(m.games), team: m.team, current_week: m.current_week };
  check("my_game_id", [season.my_game_id(st), season.my_game_id(st, 9), season.my_game_id(st, 30)], m.result); }
let order_bad = 0;
for (const r of ref.week_seeds) {
  const st = { seeds: r.before.seeds === null ? undefined : structuredClone(r.before.seeds), rng_state: r.before.rng_state, games: Object.fromEntries(r.before.games) };
  if (st.seeds === undefined) delete st.seeds;
  const got = season._week_seeds(st, r.week);
  const d = differ(Object.fromEntries(Object.entries(got).sort()), Object.fromEntries(Object.entries(r.result).sort()));
  if (d || st.rng_state !== r.rng_after) { order_bad++; console.log("week_seeds DIFF week", r.week, d, st.rng_state, r.rng_after,
    "| python order numeric-ascending?", JSON.stringify(r.order) === JSON.stringify(Object.keys(Object.fromEntries(r.order.map((e) => [e, 1]))))); }
}
console.log("week_seeds weeks differing:", order_bad, "of", ref.week_seeds.length);
for (const r of ref.run_games) {
  const st = state_of(r.before);
  { // the week's seeds as Python drew them (a plain object cannot keep the games in Python's order: see the report)
    const wk = st.games[r.ids[0]].week, ws = ref.week_seeds.find((x) => x.week === wk);
    if (!(String(wk) in (st.seeds ?? {}))) { st.seeds = { ...(st.seeds ?? {}), [wk]: ws.result }; st.rng_state = ws.rng_after; } }
  Object.assign(season, { team_edits: (s, slug) => r.team_edits[slug], morale_payload: (s, slug) => r.morale_payload[slug], morale_on: () => r.morale_on, _clear_on: () => r.clear_on });
  const jobs = [], reports = [];
  const real = season._sim_one;
  const results = {};
  season._sim_one = (job) => { jobs.push(JSON.parse(JSON.stringify(job))); const x = real(job); const { game, ...rest } = x; results[x.event_id] = JSON.parse(JSON.stringify(rest)); return x; };
  season._run_games(st, r.ids, null, (s, a, b) => reports.push([s, a, b]), r.stage);
  season._sim_one = real;
  check(`run_games ${r.stage} jobs`, jobs, r.jobs);
  check(`run_games ${r.stage} reports`, reports, r.reports);
  for (const eid of r.ids) check(`result ${eid}`, results[eid], r.results[eid]);
  for (const [eid, g] of r.after.games) check(`game ${eid}`, st.games[eid], g);
  check(`run_games ${r.stage} injuries`, st.injuries ?? null, r.after.injuries);
  check(`run_games ${r.stage} rng`, st.rng_state, r.after.rng_state);
  check(`boxes`, Object.keys(st.my_boxes).length, r.ids.filter((e) => [st.games[e].home, st.games[e].away].includes(st.team)).length);
}
for (const r of ref.ccg) {
  season.standings = () => r.standings; season.divisions = () => r.divisions;
  check("ccg", season._ccg_matchups(state_of(r.before), teams), r.result);
}
for (const r of ref.playoff) {
  const st = state_of(r.before); if (st.playoff_sites === null) delete st.playoff_sites;
  check(`playoff ${r.args[0]}`, season._playoff_round(st, r.args[0], teams), r.result);
  check(`playoff sites ${r.args[0]}`, st.playoff_sites, r.after.playoff_sites);
}
for (const r of ref.bowls) {
  season._records = () => r._records;
  const st = state_of(r.before);
  check("bowls", season._bowl_games(st, teams), r.result);
  check("bowls state", st.bowls, r.after.bowls);
}
console.log(bad ? `${bad} differences` : "all the same");
