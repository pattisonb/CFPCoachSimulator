// Holds sim_js/awards.js to Python's answers (awards_reference.py writes them):
//   python3 sim_js/test/awards_reference.py out.json && node sim_js/test/awards_compare.mjs out.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { set_reader } from "../../engine_js/files.js";
import { Random } from "../../engine_js/pyrt.js";
import { modules } from "../../engine_js/modules.js";
import { awards as A } from "../awards.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
set_reader((p) => fs.readFileSync(path.isAbsolute(p) ? p : path.join(ROOT, p), "utf8"));

const ref = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const SPEC = ref.spec;

// exactly the same: every number the same double, every key, and the keys in the same order
function same(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && same(a[k], b[k]));
}
function first_difference(a, b, where = "") {
  if (same(a, b)) return null;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) {
    return `${where}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`;
  }
  if (Array.isArray(a)) {
    if (a.length !== b.length) return `${where}: ${a.length} items, want ${b.length}`;
    for (let i = 0; i < a.length; i++) { const d = first_difference(a[i], b[i], `${where}[${i}]`); if (d) return d; }
  }
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.join("\n") !== kb.join("\n")) return `${where}: keys ${ka} want ${kb}`;
  for (const k of ka) { const d = first_difference(a[k], b[k], `${where}.${k}`); if (d) return d; }
  return `${where}: different`;
}

const counts = {};
const wrong = [];
const notes = [];
function check(what, got, want, where) {
  const c = (counts[what] ??= { n: 0, bad: 0 });
  c.n++;
  if (got === undefined) got = "(undefined)";
  if (!same(got, want)) {
    c.bad++;
    if (wrong.length < 25) wrong.push(`${what} ${where} ${String(first_difference(got, want)).slice(0, 500)}`);
  }
}
/** Each item of a list checked on its own, so the counts are of answers. */
function check_each(what, got, want, where) {
  if (!Array.isArray(got) || !Array.isArray(want) || got.length !== want.length) return check(what, got, want, where);
  want.forEach((w, i) => check(what, got[i], w, `${where} #${i}`));
}
const plain = (v) => JSON.parse(JSON.stringify(v, (k, x) => (x instanceof Set ? [...x].sort() : x)));
const keys_of = (players) => players.map((p) => p.key);
const as_cond = (c) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, k === "roles" || k === "classes" ? new Set(v) : v]));
const fresh = (v) => structuredClone(v);

// ----- the module is where the rest of the game will look for it ---------------------------
check("modules.awards is the namespace", modules.awards === A, true, "");

// ----- the helpers that need no season --------------------------------------------------------
{
  const s = ref.small;
  check_each("_z", s.lists.map((v) => A._z(v)), s._z, "");
  check_each("_ordinal", s._ordinal.map((_, n) => A._ordinal(n)), s._ordinal, "");
  check_each("_rank_bonus", s.ranks.map((r) => A._rank_bonus(r)), s._rank_bonus, "");
  check_each("_n", s.counts.map((v) => [A._n(v, "sack"), A._n(v, "key block")]), s._n, "");
  check_each("Pool._group", s.positions.flatMap((pos) => s.roles.map((role) => A.Pool._group(pos, role, {}))), s._group.flat(), "");
  check_each("passer_rating (made-up lines)", s.stats.map((st) => A.passer_rating(st)), s.passer_rating, "");
  // a raw gauss draw can be off in the last place (Math.cos and Math.log against Python's C library: tests/test_engine_js.py
  // counts the same in pyrt.js itself), so the stream is held to that; a wrong seed text would be a different number
  let last_place = 0;
  s.states.forEach((st, i) => ["conference", "national", "postseason"].forEach((salt, j) => {
    const got = A._rng(st, salt).gauss(0, 1), want = s._rng[i][j];
    if (got !== want && Math.abs(got - want) < 1e-12 * Math.max(1, Math.abs(want))) last_place++;
    check("_rng (the first draw of each stream)", got !== want && Math.abs(got - want) < 1e-12 * Math.max(1, Math.abs(want)) ? want : got, want, `${JSON.stringify(st)} ${salt}`);
  }));
  check("_rng (a state without a seed or an id is an error, as Python's KeyError)", (() => { try { A._rng({ year: 2026 }, "x"); return false; } catch { return true; } })(), true, "");
  notes.push(`_rng: ${last_place} of ${s._rng.flat().length} first draws off in the last place (the runtime's gauss, not the seed)`);
  check_each("_podium", s.races.map((r) => A._podium(r)), s._podium, "");
  for (const [name, want] of Object.entries(s.tables)) check("tables", plain(A[name]), want, name);
  for (const [name, want] of Object.entries(s.table_pairs)) check("tables (their order)", Object.entries(plain(A[name])), want, name);
}

// ----- the game's own calls -------------------------------------------------------------------
function replay(c) {
  if (c.fn === "my_awards") return A.my_awards(fresh(c.state), fresh(c.awards));
  const state = fresh(c.state), teams = fresh(ref.teams[c.teams]), records = fresh(c.records);
  if (c.fn === "race_view") return A.race_view(state, teams, records);
  const pool = new A.Pool(state, teams, records, c.through_week);
  if (c.fn === "postseason_awards") return A.postseason_awards(pool, state);
  return A[c.fn](pool, state, c.final);
}

function battery(c, tag) {
  const b = c.battery;
  const state = fresh(c.state), teams = fresh(ref.teams[c.teams]), records = fresh(c.records);
  const pool = new A.Pool(state, teams, records, c.through_week);
  const GROUPS = SPEC.groups, KINDS = SPEC.kinds;
  const w = c.label;
  check("Pool (week, ranks, params)", { week: pool.week, ranks: pool.ranks, params: pool.params, n: pool.players.length },
    { week: b.pool.week, ranks: b.pool.ranks, params: b.pool.params, n: b.pool.n }, w);
  check_each("Pool.players (key, name, position, role, group, class, team, games, raw, z, zb)",
    pool.players.map((p) => [p.key, p.name, p.position, p.role, p.group, p.class, p.team, p.team_name, p.conference, p.games, p.team_games, p.raw, p.z, p.zb]),
    b.pool.players, w);
  for (const s of Object.keys(b.rank_of)) check("Pool.rank_of", pool.rank_of(s), b.rank_of[s], `${w} ${s}`);
  for (const s of Object.keys(b.team_term)) check("Pool.team_term", pool.team_term(s), b.team_term[s], `${w} ${s}`);
  check_each("Pool.heisman_score", pool.players.map((p) => pool.heisman_score(p)), b.heisman_score, w);
  check_each("Pool.played_enough", pool.players.map((p) => [pool.played_enough(p), pool.played_enough(p, 0.4)]), b.played_enough, w);
  check_each("passer_rating", pool.players.map((p) => A.passer_rating(p.stats)), b.passer_rating, w);
  check_each("Pool.card", pool.players.map((p) => pool.card(p)), b.cards, w);
  check_each("Pool.card (as a returner)", pool.players.filter((p) => p.z.RS !== undefined).map((p) => pool.card(p, "RS")), b.cards_rs, w);
  check_each("headline, stat_line (every group's line on a player)",
    pool.players.filter((_, i) => i % SPEC.line_step === 0).flatMap((p) => GROUPS.concat(["XX"]).map((g) => [A.headline(p, g), A.stat_line(p, g)])),
    b.lines.flat(), w);
  check_each("Pool.by_group", GROUPS.concat(["XX"]).flatMap((g) => SPEC.conds.map((cond) => keys_of(pool.by_group(g, as_cond(cond))))), b.by_group.flat(), w);
  check_each("_candidates", KINDS.flatMap((kind) => SPEC.confs.map((conf) => A._candidates(pool, kind, conf).map(([ps, g]) => [keys_of(ps), g]))),
    b.candidates.flat(), w);
  check_each("award_race", KINDS.flatMap((kind, i) => SPEC.race.map(([conf, n, noise], j) =>
    A.award_race(pool, kind, 0.1 + 0.07 * i, new Random(`${tag}|race|${kind}|${j}`), conf, n, noise))), b.award_race.flat(), w);
  check("award_race (defaults)", A.award_race(pool, "mvp", 0.9, new Random(`${tag}|race`)), b.award_race_defaults, w);
  check_each("heisman_vote", SPEC.heisman.map(([n, straw], j) => A.heisman_vote(pool, new Random(`${tag}|heisman|${j}`), n, straw)), b.heisman_vote, w);
  check("heisman_vote (defaults)", A.heisman_vote(pool, new Random(`${tag}|heisman`)), b.heisman_vote_defaults, w);
  const table = A.coach_table(pool);
  check_each("coach_table", [table, A.coach_table(pool, true)], b.coach_table, w);
  check_each("coach_award", SPEC.coach_weights.flatMap(([ww, sw], j) => [false, true].map((title) =>
    A.coach_award(table, ww, sw, new Random(`${tag}|coach|${j}|${title ? "True" : "False"}`), title))), b.coach_award.flat(), w);
  check_each("coach_award (a conference's coaches)", Object.keys(A.CONF_AWARDS).map((conf) =>
    A.coach_award(table.filter((x) => x.conference === conf), 0.5, 1.0, new Random(`${tag}|coach|${conf}`))), b.coach_award_conference, w);
  check("broyles_table", A.broyles_table(pool), b.broyles_table, w);
  check("ol_units", A.ol_units(pool), b.ol_units, w);
  check_each("_slot_pool", SPEC.slots.flatMap((slot) => SPEC.confs.map((conf) => { const [ps, g] = A._slot_pool(pool, slot, conf); return [keys_of(ps), g]; })), b.slot_pool, w);
  check_each("select_team", Object.entries(A.SELECTORS).map(([name, [tw, noise]]) =>
    A.select_team(pool, A.AA_SLOTS, tw, noise, new Random(`${tag}|team|${name}`), undefined, 2)), b.select_team, w);
  check("select_team (defaults)", A.select_team(pool, A.AA_SLOTS, 0.3, 0.4, new Random(`${tag}|team`)), b.select_team_defaults, w);
  check("all_america", A.all_america(pool, new Random(`${tag}|aa`)), b.all_america, w);
  check_each("all_conference", SPEC.all_conference.map((conf) => A.all_conference(pool, conf, new Random(`${tag}|ac|${conf}`))), b.all_conference, w);
  const conference = [A.conference_awards(pool, state), A.conference_awards(pool, state, false)];
  const national = [A.national_awards(pool, state), A.national_awards(pool, state, false)];
  const postseason = A.postseason_awards(pool, state);
  check_each("conference_awards (final, live)", conference, b.conference_awards, w);
  check_each("national_awards (final, live)", national, b.national_awards, w);
  check("postseason_awards", postseason, b.postseason_awards, w);
  check("race_view", A.race_view(state, teams, records), b.race_view, w);
  // my_awards on the JavaScript's own answers as they are (one object in the candidates and the finalists) and read back
  const live = { conference: conference[0], national: national[0], postseason, given_through: 20 };
  const shapes = [plain(live)].concat(b.my_awards_shapes);
  for (const [team, want] of b.my_awards) {
    check_each("my_awards", shapes.map((shape) => A.my_awards({ team }, fresh(shape))), want, `${w} ${team}`);
    check("my_awards (before a save)", A.my_awards({ team }, live), want[0], `${w} ${team}`);
  }
  // nothing above changed what it was given
  check("arguments left as they were", [state, teams, records], [c.state, ref.teams[c.teams], c.records], w);
}

let n_battery = 0;
ref.calls.forEach((c, i) => {
  const before = c.fn === "my_awards" ? null : JSON.stringify([c.state, c.records]);
  check(`the game's call: ${c.fn}`, plain(replay(c)), c.result, c.label);
  if (before !== null) check("arguments left as they were", JSON.stringify([c.state, c.records]) === before, true, c.label);
  if (c.battery) { battery(c, c.tag); n_battery++; }
});

let bad = 0, total = 0;
for (const [what, c] of Object.entries(counts)) {
  bad += c.bad; total += c.n;
  console.log(`${c.bad ? "MISMATCH" : "ok      "} ${what}: ${c.n} compared, ${c.n - c.bad} identical${c.bad ? `, ${c.bad} different` : ""}`);
}
for (const w of wrong) console.log(w);
for (const n of notes) console.log(n);
console.log(`${ref.calls.length} recorded calls, ${n_battery} with every function; ${total} answers compared, ${total - bad} identical, ${bad} different`
  + ` (Python reproduced ${ref.python_checks} recorded answers from the written arguments)`);
process.exit(bad ? 1 : 0);
