// career_js/programs.js held to coach_career/programs.py's answers: node career_js/test/programs_compare.mjs OUT
// (after python3 career_js/test/programs_reference.py OUT)
import path from "path";
import { use_repo_files, read, copy, tally } from "./compare_tools.mjs";
import { modules, has } from "../../engine_js/modules.js";

const out = path.resolve(process.argv[2]);
use_repo_files();
const setup = read(out, "setup.json");
await import("../league.js");                                    // the season reads league's constants
if (!has("clear")) modules.clear = { on: () => false };          // the reference runs with Clear Mode off
if (!has("promises")) modules.promises = { snapshot_week: () => null };
await import("../../sim_js/season.js");                          // update and rows ask the season for the 2026 teams
modules.offseason = { ...(has("offseason") ? modules.offseason : {}), DRAFT_GROUP: setup.DRAFT_GROUP };   // not part of this port: its table, as Python has it
const { programs } = await import("../programs.js");

const t = tally();
// Pro Pipeline and winning scores go through x ** k with a fractional k (PORTING.md: a last digit may differ);
// `pro` and `pro_groups` are stored as they come, so those numbers are given that room and counted
const CLOSE = { close: 1e-9 };

// ----- every program as the data has it -----
const fixed = read(out, "fixed.json");
for (const s of [...setup.slugs, ...setup.odd]) {
  t.same(`fixed ${s}`, fixed[s], {
    base: programs.base(s), market: programs.market(s), market_row: programs.market_row(s), grades: programs.grades(s), _grades: programs._grades(s),
    tags: programs.tags(s), _tags: programs._tags(s), z: programs.z({}, s), z_none: programs.z(null, s), get: programs.get({ league: null }, s),
    grades_now: programs.grades_now({}, s), attract: programs.attract({}, s), coach_level: programs.coach_level({}, s),
    coach_ceiling: programs.coach_ceiling({}, s) });
}
t.same("profile_rows", read(out, "profile_rows.json"), programs.profile_rows());

// ----- the small functions -----
const small = read(out, "small.json");
for (const [v, sc, py] of small.scaled) t.same(`scaled ${v} ${JSON.stringify(sc)}`, py, programs.scaled(v, sc), CLOSE);
for (const [r, py] of small.tier_of) t.same(`tier_of ${r}`, py, programs.tier_of(r));
for (const [r, py] of small.z_of) t.same(`z_of ${r}`, py, programs.z_of(r));
for (const [v, py] of small.word_of) t.same(`word_of ${v}`, py, programs.word_of(v));
for (const [tier, p4, r, ind, py] of small.goal_for) t.same(`goal_for ${tier} ${p4} ${r} ${ind}`, py, programs.goal_for(tier, p4, r, ind));
for (const [w, g, r, py] of small.season_score) t.same(`season_score ${w} ${g} ${r}`, py, programs.season_score(w, g, r));
for (const [r, py] of small.pick_points) t.same(`pick_points ${r}`, py, programs.pick_points(r));
for (const [y, py] of small.empty_drafts) t.same(`empty_drafts ${y}`, py, programs.empty_drafts(y));
for (const [y, picks, py] of small.draft_line) t.same(`draft_line ${y}`, py, programs.draft_line(y, picks));
for (const [s, now, score, group_scores, after, grade] of small.pro) {
  const b = programs.base(s);
  const p = { drafts: Object.keys(after).length && after.drafts.length ? copy(b.drafts) : [] };
  programs.pro_recompute(p, now);
  const grades = {};
  for (const g of Object.keys(grade)) grades[g] = programs.pro_group_grade(p, g === "null" ? null : g);
  t.same(`pro ${s} ${now}`, [score, group_scores, after, grade], [programs.pro_score(b.drafts, now), programs.pro_group_scores(b.drafts, now), p, grades], CLOSE);
}
const text = (x) => (x === null ? null : Number.isNaN(x) ? "nan" : x === Infinity ? "inf" : x === -Infinity ? "-inf" : x);
for (const [v, py] of small._num) t.same(`_num ${JSON.stringify(v)}`, py, text(programs._num(v === "NaN" ? NaN : v)));
for (const [r, s, py] of small.rank_score) t.same(`rank_score ${r} ${s}`, py, programs.rank_score(r, s), CLOSE);
for (const [y, py] of small.recency) t.same(`recency ${y}`, py, programs.recency(y));
for (const [v, py] of small.warmth) t.same(`warmth ${v}`, py, programs.warmth(v));
for (const [c, cap, py] of small.fill_score) t.same(`fill_score ${c} ${cap}`, py, programs.fill_score(c, cap));
for (const [x, sc, lg, py] of small._line) t.same(`_line ${x} ${JSON.stringify(sc)}`, py, programs._line(x, sc, lg), CLOSE);
for (const [c, target, s, py] of small._step) t.same(`_step ${c} ${target} ${s}`, py, programs._step(c, target, s));
for (const [p, py] of small.mix) t.same(`mix ${JSON.stringify(p)}`, py, programs.mix(p));

// ----- old saves: programs with no draft lines, teams with no program -----
const old = read(out, "old.json");
const lg_old = copy(old.in);
const got = {};
for (const s of Object.keys(old.get)) got[s] = copy(programs.get({ league: lg_old }, s));
t.same("get on an old league", old.get, got);
programs.init(lg_old);
for (const s of Object.keys(old.out.teams)) t.same(`init ${s}`, old.out.teams[s].program, lg_old.teams[s].program);

// ----- a career's league through six offseasons -----
const lgd = read(out, "league.json");
const state = { league: lgd, team: "ohio-state", year: 2026 };
const of = () => { const o = {}; for (const [s, team] of Object.entries(lgd.teams)) o[s] = team.program; return o; };
const each = (name, py, js, opts) => { for (const s of Object.keys(py)) t.same(`${name} ${s}`, py[s], js[s], opts); t.same(`${name}: the teams`, Object.keys(py), Object.keys(js)); };
for (const step of read(out, "years.json")) {
  const y = step.year;
  state.offseason = { year: y, departures: step.departures };
  state.polls = step.polls;
  for (const [s, hc] of Object.entries(step.coaches)) if (hc !== null) lgd.teams[s].coaches.head_coach = hc;
  for (const [s, ad] of Object.entries(step.ad)) lgd.teams[s].ad = ad;
  t.same(`${y} final_ranks`, step.final_ranks, programs.final_ranks(state));
  t.same(`${y} draft_picks`, step.draft_picks, programs.draft_picks(state));
  if (step.only) {
    programs.update(state, step.results, step.ranks, undefined, new Set(step.only));
    each(`${y} update (only)`, step.after_only, of(), CLOSE);
  }
  if (y === 2030) programs.update(state, step.results, step.ranks, y);
  else programs.update(state, step.results, step.ranks);
  each(`${y} update`, step.after_update, of(), CLOSE);
  const before = JSON.stringify(of());
  programs.update(state, step.results, step.ranks);
  t.same(`${y} update again moves nothing`, step.again_same, JSON.stringify(of()) === before);
  t.same(`${y} conference_start`, step.conference_start, lgd.conference_start);
  for (const [s, flags] of Object.entries(step.nil)) programs.nil_move(lgd.teams[s], ...flags);
  each(`${y} nil_move`, step.after_nil, of(), CLOSE);
  const rows = programs.rows(state);
  t.same(`${y} rows: their order`, step.rows.map((r) => r.team), rows.map((r) => r.team));
  step.rows.forEach((r, i) => t.same(`${y} rows ${r.team}`, r, rows[i], CLOSE));
  for (const [s, py] of Object.entries(step.reads)) {
    t.same(`${y} reads ${s}`, py, [programs.z(state, s), programs.attract(state, s), programs.coach_level(state, s), programs.coach_ceiling(state, s), programs.grades_now(state, s)]);
  }
  lgd.year = y + 1;
}

t.done("programs.js against programs.py");
