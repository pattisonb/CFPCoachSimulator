// Holds sim_js/season/part6.js (sim/season.py from "player profiles" to the end) to Python's answers
// (season_part6_reference.py writes them): node sim_js/test/season_part6_compare.mjs out.json
// The part is loaded alone: what it asks the rest of the season file and the modules not ported yet is answered from
// what Python answered (the reference records every such call), or by the one-line Python written out here.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { set_reader, set_store } from "../../engine_js/files.js";
import { modules } from "../../engine_js/modules.js";
import { season } from "../season_ns.js";
import "../season/part6.js";
import { coaches } from "../coaches.js";
import { shown } from "../../teamdata_js/shown.js";
import { ratings } from "../../teamdata_js/ratings.js";
import * as game_job from "../game_job.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const abs = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));
set_reader((p) => fs.readFileSync(abs(p), "utf8"));
set_store({
  write() { throw new Error("nothing is written here"); },
  exists: (p) => fs.existsSync(abs(p)),
  remove() {}, remove_dir() {},
  list: (d) => (fs.existsSync(abs(d)) ? fs.readdirSync(abs(d), { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort() : []),
  mtime: () => null,
});

const ref = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));

// exactly the same: every number the same double, every key, and the keys in the same order
function same(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && same(a[k], b[k]));
}
const short = (v) => (JSON.stringify(v) ?? String(v)).slice(0, 400);
function where(a, b, at = "") {
  if (same(a, b)) return "";
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return `${at}: got ${short(a)} want ${short(b)}`;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.join("\u0001") !== kb.join("\u0001")) return `${at}: keys got ${short(ka)} want ${short(kb)}`;
  for (const k of ka) { const w = where(a[k], b[k], `${at}.${k}`); if (w) return w; }
  return `${at}: ?`;
}

const counts = {};
const wrong = [];
function check(what, got, want, note = "") {
  const c = (counts[what] ??= { n: 0, bad: 0 });
  c.n++;
  if (got === undefined) got = null;
  if (!same(got, want)) {
    c.bad++;
    if (wrong.length < 30) wrong.push(`${what} ${note} ${where(got, want)}`);
  }
}

// ---- the rest of the season file, as Python answered ----
let record = {}, common = {};
function recorded(name, key) {
  const k = `${name}:${JSON.stringify(key)}`;
  if (k in record) return structuredClone(record[k]);
  if (k in common) return structuredClone(common[k]);
  throw new Error(`Python never asked for ${k}`);
}
const slug_of = (p) => (p && typeof p === "object" ? p.slug ?? null : p);
season.load_teams = () => ref.teams;
season._teams_meta = ref.teams_meta;
season.RATING_KEY = ref.RATING_KEY;
season.check_fbs = () => {};
season.page_attribute = (p, key, value) => shown.attribute(value, ratings.card_group(p["position"], p["role"] ?? null), key);
season.page_overall = (p, base) => shown.overall(season.shown_overall(p, base));
season._scores_for = (g, home) => (home ? [g["home_score"], g["away_score"]] : [g["away_score"], g["home_score"]]);
season._venue = (g, home) => (g["neutral"] ? "neutral" : home ? "home" : "away");
season.display_rating = (p, key, value) => recorded("display_rating", [slug_of(p), key, value ?? null]);
season.shown_overall = (p, base) => recorded("shown_overall", [slug_of(p), base !== null && base !== undefined]);
season.house_value = (pos, key, v) => recorded("house_value", [pos, key, v]);
season.same_group = (a, b) => recorded("same_group", [a, b]);
season.redshirt_status = (state, slug, p) => recorded("redshirt_status", [slug, slug_of(p)]);
season._records = (state, through_week, include_playoff) => recorded("_records", [through_week ?? null, include_playoff ?? false]);
season.position_changes = (state, slug) => (state["position_changes"] || {})[slug] || {};
season._clear_on = () => recorded("_clear_on", []);
season.season_year = () => recorded("season_year", []);
season.engine_rating = (p, key, ours) => recorded("engine_rating", [slug_of(p), key, ours]);
modules.ability_goals = {
  on: () => recorded("on", []),
  merged_traits: (state, team, key) => recorded("merged_traits", [team, key]),
  upgrades_view: (state, team, key) => recorded("upgrades_view", [team, key]),
  goal_view: (state, team, key) => recorded("goal_view", [team, key]),
};
modules.promises = { tags_now: () => recorded("tags_now", []) };
modules.recruiting = { word: (points) => recorded("word", [points]) };
modules.league = {
  base_development: () => recorded("base_development", []),
  from_base: () => recorded("from_base", []),
  potential: (c, attrs) => Object.fromEntries(attrs.slice(0, Math.min(c["r"].length, c["g"].length)).map((k, i) => [k, c["r"][i] + c["g"][i]])),
};
modules.grades = { letter: (value, fine) => recorded("letter", [value, fine ?? false]) };

// ---- constants ----
const tuples = (v) => v;
for (const [k, want] of Object.entries(ref.constants)) check("constants", tuples(season[k]), want, k);
check("constants", [...season.LOWER_IS_BETTER].sort(), ref.LOWER_IS_BETTER, "LOWER_IS_BETTER");
check("constants", game_job.RATING_KEYS, season.EDITABLE_RATINGS, "game_job.RATING_KEYS");

// ---- morale after every game, and the weekly fade ----
for (const row of ref.morale) {
  const state = { settings: { morale: true }, morale: structuredClone(row.before), season_stats: row.season_stats };
  season._update_morale(state, row.g, row.lines, {});
  const m = state.morale;
  const note = `${row.g.home} v ${row.g.away} wk ${row.g.week}`;
  check("_update_morale teams", m.teams, row.after.teams, note);
  check("_update_morale players", m.players, row.after.players, note);
  check("_update_morale fcs_lines", m.fcs_lines, row.after.fcs_lines ?? null, note);
  check("_update_morale z_mean", m.z_mean, row.after.z_mean ?? null, note);
}
for (const row of ref.decay) {
  const state = { settings: { morale: true }, morale: structuredClone(row.before) };
  if (row.before === null) delete state.morale;
  season._decay_morale(state);
  check("_decay_morale", state.morale, row.after);
}

// ---- the views ----
function run(state, name, args) {
  try {
    return { ok: season[name](state, ...args) ?? null };
  } catch (e) {
    if (e instanceof coaches.ValueError) return { error: e.message };
    throw e;
  }
}
function replay(what, c) {
  record = c.record;
  const st = structuredClone(c.state);
  for (const call of c.calls) {
    const note = `${call.name}(${short(call.args).slice(0, 120)})`;
    const got = run(st, call.name, call.args);
    check(`${what} ${call.name}`, got, call.result, note);
    check(`${what} state after`, st.player_edits ?? null, call.player_edits, note);
    check(`${what} state after`, st.player_faces ?? null, call.player_faces, note);
    check(`${what} state after`, st.settings ?? null, call.settings, note);
  }
  record = {};
}

for (const c of ref.cases) {
  common = c.common;
  season._STAR_CUTS = null;
  season._CEILINGS = {};
  replay("profiles", c.profiles);
  replay("edits", c.edits);

  const state = c.profiles.state, teams = ref.teams, P = c.pure;
  const ss = state.season_stats || {};
  for (const [slug, ts] of Object.entries(ss)) {
    const rows = Object.values(ts.players);
    check("_perf_score", rows.map((p) => season._perf_score(p.position, p.stats)), P.perf[slug], slug);
    check("derived_stat", rows.map((p) => P.derived_keys.map((k) => season.derived_stat(p.stats, k))), P.derived[slug], slug);
  }
  for (const slug of Object.keys(P.skills)) {
    const roster = [...teams[slug].offense, ...teams[slug].defense];
    roster.forEach((p, i) => check("all_skills", season.all_skills(p), P.skills[slug][i], `${slug} ${p.name}`));
    const five = ["speed", "agility", "strength", "awareness", "kick_power"];
    roster.slice(0, 12).forEach((p, i) => {
      const sk = Object.fromEntries(five.slice(0, (p.skills || []).length).map((k, j) => [k, p.skills[j]]));
      check("our_rating", Object.keys(season.OUR_RATINGS).map((k) => season.our_rating(k, sk, p.slug ?? null, null)), P.ours[slug][i], `${slug} ${p.name}`);
    });
    check("recruit_stars", roster.map((p) => season.recruit_stars(p)), P.stars[slug], slug);
    roster.forEach((p, i) => check("morale_view", [season.morale_view(state, slug, p.name, p.position), season.morale_factor(state, slug, p.name, p.position),
      season.player_form(state, slug, p.name, p.position)], P.morale[slug][i], `${slug} ${p.name}`));
    const edits = season.team_edits(state, slug);
    check("morale_payload, team_morale, team_edits, player_faces", [season.morale_payload(state, slug), season.team_morale(state, slug), edits,
      season.player_faces(state, slug)], P.payload[slug], slug);
  }
  check("_STAR_CUTS", season._STAR_CUTS, P.star_cuts);
  check("our_rating", Object.keys(season.OUR_RATINGS).map((k) => season.our_rating(k, {}, null)), P.ours_none, "no slug");
  for (const [s, want] of Object.entries(P.faces)) check("preset_faces", season.preset_faces(s), want, s);
  check("all_preset_faces", season.all_preset_faces(), P.all_faces);
  check("settings", [season.settings(state), season.settings({}), season.morale_on(state), season.morale_on({})], P.settings);

  const V = c.views;
  for (const [team, name, want] of V.honors) check("player_honors", season.player_honors(state, team, name), want, `${team} ${name}`);
  for (const [team, name, pos, want] of V.ranks) check("player_ranks", season.player_ranks(state, teams, team, name, pos), want, `${team} ${name}`);
  for (const [team, name, pos, want] of V.log) check("player_game_log", season.player_game_log(state, team, name, pos), want, `${team} ${name}`);

  // team_data: the edited players as a game gets them
  record = c.edits.record;
  const s2 = c.team_data_state;
  const td = season.team_data(s2, s2.team);
  const edited = new Set(c.team_data.map((p) => p.slug));
  check("team_data", [...td.offense, ...td.defense].filter((p) => edited.has(p.slug)), c.team_data);
  record = {};
}

let bad = 0;
for (const [what, c] of Object.entries(counts)) { console.log(`${c.bad ? "WRONG" : "ok   "} ${what}: ${c.n - c.bad}/${c.n}`); bad += c.bad; }
for (const w of wrong) console.log("  " + w);
process.exit(bad ? 1 : 0);
