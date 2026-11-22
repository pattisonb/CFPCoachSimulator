// sim_js/season/part4.js against Python's answers (season_part4_reference.py writes them):
//   node sim_js/test/season_part4_compare.mjs <ref.json>
// The part is loaded alone; what it asks of the rest of the season file and of modules not ported yet is answered
// from the tables Python wrote (records, box flags, unit ratings, program standings).
import { readFileSync } from "node:fs";
import { set_reader } from "../../engine_js/files.js";
import { modules } from "../../engine_js/modules.js";
import { season } from "../season_ns.js";
import "../season/part4.js";

set_reader((path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf-8"));
const ref = JSON.parse(readFileSync(process.argv[2], "utf-8"));

let T = null;                       // the case's tables
const clone = (x) => structuredClone(x);
Object.assign(season, {
  load_teams: () => T.teams,
  check_fbs: (slug) => { const t = T.teams[slug]; if (t && t.fictional) throw new Error("stand-in"); },
  _records: (state, through_week, include_playoff) => (include_playoff ? T.records_playoff : through_week === undefined || through_week === null ? T.records_none : T.records[String(through_week)]),
  _venue: (g, home) => (g.neutral ? "neutral" : home ? "home" : "away"),
  _record_str: (r) => `${r.wins}-${r.losses}`,
  _winner: (g) => (g.home_score > g.away_score ? g.home : g.away),
  _scores_for: (g, home) => (home ? [g.home_score, g.away_score] : [g.away_score, g.home_score]),
  has_box: (state, g) => T.has_box[g.event_id],
  fcs_label: (slug) => T.fcs_label[slug],
  team_display: (slug, teams) => { const t = teams[slug]; return t === undefined ? slug : t.fictional ? T.fcs_label[slug] : t.name; },
  _unit_overalls: (state, slug) => T.unit_overalls[slug],
});
if (!("programs" in modules === false)) { /* never registered here */ }
const stub = (name, value) => { try { modules[name]; } catch { modules[name] = value; } };
stub("programs", { attract: (state, slug) => T.attract[slug], get: (state, slug) => T.program[slug], get TIER_NAMES() { return T.TIER_NAMES; } });
stub("schedule_gen", { get FINALE_WEEK() { return T.FINALE_WEEK; } });
stub("league", { base_slugs: () => T.base_slugs, team_meta: () => ({}) });

let bad = 0, checked = 0, order = 0;
function same(a, b, path, strict_order = true) {
  if (a === b) return;
  if (typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b)) return;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) {
    if (bad++ < 25) console.log(`DIFFERENT ${path}: js ${JSON.stringify(a)} python ${JSON.stringify(b)}`);
    return;
  }
  if (Array.isArray(a)) {
    if (a.length !== b.length) { if (bad++ < 25) console.log(`DIFFERENT ${path}: lengths ${a.length} / ${b.length}`); return; }
    a.forEach((x, i) => same(x, b[i], `${path}[${i}]`, strict_order));
    return;
  }
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length || ka.some((k) => !(k in b))) { if (bad++ < 25) console.log(`DIFFERENT ${path}: keys ${ka} / ${kb}`); return; }
  if (strict_order && ka.join("\u0001") !== kb.join("\u0001")) { if (order++ < 10) console.log(`ORDER ${path}: js ${ka.slice(0, 12)} python ${kb.slice(0, 12)}`); }
  for (const k of ka) same(a[k], b[k], `${path}.${k}`, strict_order);
}
const check = (name, got, want, strict = true) => { checked++; same(JSON.parse(JSON.stringify(got)), want, name, strict); };
const tried = (fn) => { try { return { ok: fn() }; } catch (e) { if (e instanceof season.ScheduleError) return { error: [e.code, e.message] }; throw e; } };

for (const c of ref.cases) {
  T = c.tables;
  season.LAST_REGULAR_WEEK = T.LAST_REGULAR_WEEK; season.POSTSEASON_DATES = T.POSTSEASON_DATES; season.NO_ARTICLE_TROPHIES = T.NO_ARTICLE_TROPHIES;
  const state = c.state, v = c.views, n = c.name;
  const slugs = Object.keys(v.resume_team), confs = Object.keys(v.player_stats.passing).filter((k) => k.startsWith("conf:")).map((k) => k.slice(5));
  for (const w of Object.keys(v.rank_map)) check(`${n} rank_map ${w}`, season.rank_map(state, Number(w)), v.rank_map[w]);
  check(`${n} resume`, season.resume(state), v.resume);
  for (const w of Object.keys(v.resume_w)) check(`${n} resume ${w}`, season.resume(state, Number(w)), v.resume_w[w]);
  for (const s of slugs) {
    check(`${n} resume ${s}`, season.resume(state, null, s), v.resume_team[s]);
    check(`${n} resume 4 ${s}`, season.resume(state, 4, s), v.resume_team_w[s]);
    check(`${n} rivalries_view ${s}`, season.rivalries_view(state, s), v.rivalries_view[s]);
    check(`${n} team_schedule ${s}`, season.team_schedule(state, s), v.team_schedule[s]);
  }
  check(`${n} current_rank`, season.current_rank(state), v.current_rank);
  for (const w of Object.keys(v.week_view)) check(`${n} week_view ${w}`, season.week_view(state, Number(w)), v.week_view[w]);
  check(`${n} team_stats_view`, season.team_stats_view(state), v.team_stats_view);
  const wd = season.week_dates(state);
  check(`${n} week_dates`, wd, v.week_dates, false);
  if (Object.keys(wd).join() !== v.week_dates_order.join()) console.log(`(${n}: week_dates' keys run ${Object.keys(wd)} here, ${v.week_dates_order} in Python)`);
  for (const cat of Object.keys(v.player_stats)) {
    check(`${n} player_stats ${cat}`, season.player_stats_view(state, null, cat), v.player_stats[cat].league);
    check(`${n} player_stats ${cat} 7`, season.player_stats_view(state, null, cat, 7), v.player_stats[cat].limit7);
    for (const s of slugs) check(`${n} player_stats ${cat} ${s}`, season.player_stats_view(state, s, cat), v.player_stats[cat][`team:${s}`]);
    for (const k of confs) check(`${n} player_stats ${cat} ${k}`, season.player_stats_view(state, null, cat, 40, k), v.player_stats[cat][`conf:${k}`]);
  }
  check(`${n} leaders`, season.player_leaders_view(state), v.player_leaders.league);
  check(`${n} leaders 3`, season.player_leaders_view(state, null, 3), v.player_leaders.n3);
  for (const s of slugs) check(`${n} leaders ${s}`, season.player_leaders_view(state, s), v.player_leaders[`team:${s}`]);
  for (const k of confs) check(`${n} leaders ${k}`, season.player_leaders_view(state, null, 5, k), v.player_leaders[`conf:${k}`]);
  for (const [eid, g] of Object.entries(state.games)) {
    check(`${n} game_rivalry ${eid}`, [season.game_rivalry(state, g), season.game_rivalry(state, g, true)], v.game_rivalry[eid]);
  }
  check(`${n} fcs_picker_names`, season._fcs_picker_names(T.teams), v.fcs_picker_names);
  for (const [teams, w, want] of v.rivalry_series) check(`${n} rivalry_series ${teams} ${w}`, season.rivalry_series(state, season.rivalry_for(teams[0], teams[1]), w), want);
  check(`${n} first meeting`, [null, 1].map((w) => season.rivalry_series(state, { teams: ["michigan", "ohio-state"], name: "M vs. O", trophy: "", series: {} }, w).text), v.fresh);
  const s2 = { my_boxes: state.my_boxes, games: state.games };
  season._season_stats(s2);
  // the personnel counts' key order is compared apart: groupings named by a number ("11") sort first in JavaScript
  check(`${n} rebuilt stats`, { season_stats: s2.season_stats, partial: s2.season_stats_partial }, { season_stats: v.rebuilt.season_stats, partial: v.rebuilt.partial }, false);
  const strip = (ss) => Object.fromEntries(Object.entries(clone(ss)).map(([k, t]) => { delete t.personnel; return [k, t]; }));
  check(`${n} rebuilt stats, key order`, strip(s2.season_stats), strip(v.rebuilt.season_stats));
  let moved = 0;
  for (const [t, keys] of Object.entries(v.rebuilt.personnel_order)) if (Object.keys(s2.season_stats[t].personnel).join() !== keys.join()) moved++;
  if (moved) console.log(`(${n}: ${moved} teams' personnel counts list their groupings in another order than Python's)`);

  if (c.schedule) {
    const sc = c.schedule, st = sc.state;
    check(`${n} schedule_editable`, season.schedule_editable(st), sc.editable);
    for (const [eid, want] of Object.entries(sc.options)) check(`${n} schedule_options ${eid}`, season.schedule_options(st, eid), want);
    for (const sw of sc.swaps) {
      const x = clone(st);
      check(`${n} schedule_swap ${sw.event_id} ${sw.slug}`, { result: tried(() => season.schedule_swap(x, sw.event_id, sw.slug)), games: x.games, changes: x.schedule_changes ?? null },
        { result: sw.result, games: sw.games, changes: sw.changes });
    }
    check(`${n} schedule_moves`, season.schedule_moves(st), sc.moves);
    for (const mv of sc.move) {
      const x = clone(st);
      check(`${n} schedule_move ${mv.event_id} ${mv.week}`, { result: tried(() => season.schedule_move(x, mv.event_id, mv.week)), games: x.games }, { result: mv.result, games: mv.games });
    }
    check(`${n} schedule_options of no game`, tried(() => season.schedule_options(st, "nope")), sc.bad_option);
    console.log(`${n}: ${sc.editable.length} tradable games, ${sc.swaps.length} swaps, ${sc.move.length} moves`);
  }
}
console.log(`${checked} answers compared; ${bad} different, ${order} with keys in another order`);
process.exit(bad || order ? 1 : 0);
