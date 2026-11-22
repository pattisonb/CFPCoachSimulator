// career_js/offseason/part3.js against the Python it ports (coach_career/offseason.py lines 1668 to 2468):
// node career_js/test/offseason_part3_compare.mjs OUTDIR (after offseason_part3_reference.py OUTDIR).
//
// The part is loaded alone, on the offseason namespace. What it asks of the file's other parts is given here: their
// constants as the Python has them (setup.json), their small functions written out below as stand-ins (_rng, _attrs,
// house, life, _jersey, _group_counts, _depth_values, _new_transfer), and growth_terms and _compact_prospect replayed
// call by call from the Python's record. Outside the file: recruiting's pool numbers, the season's records, names and
// Power 4 flags, and prospects' class table and class rank are the Python's recorded answers; programs, carousel,
// coach_names, clear, league, recruits, game_scale and ratings are the real JavaScript ports.
import path from "path";
import { Random, int, get, truthy } from "../../engine_js/pyrt.js";
import { modules } from "../../engine_js/modules.js";
import { use_repo_files, read, copy, tally } from "./compare_tools.mjs";

use_repo_files();
const out = process.argv[2];
const setup = read(out, "setup.json");

const { offseason } = await import("../offseason_ns.js");
const { clear } = await import("../clear.js");
const { prospects } = await import("../prospects.js");
const { ValueError } = await import("../../sim_js/coaches.js");

// ----- the other parts: constants, then stand-ins for the functions this part calls ------------------------------
const MINE = ["COACH_NOTES", "REGRESS_Z", "REGRESS_STRUGGLE", "REGRESS_RUST", "REGRESS_YEARS", "REGRESS_RATINGS", "REGRESS_POINTS", "CEILING_NOTE",
  "REGRESS_NOTES", "STAFF_ROLES", "STAFF_CANDIDATES", "STAFF_MARK"];
for (const [k, v] of Object.entries(setup.constants)) {
  if (!MINE.includes(k)) offseason[k] = v !== null && typeof v === "object" && v.__set__ ? new Set(v.__set__) : v;
}
offseason.seed_key = (state) => (get(state, "seed") !== null ? state["seed"] : state["id"]);
offseason._rng = (state, what) => new Random(`offseason-${offseason.seed_key(state)}-${get(state, "year", 2026)}-${what}`);
offseason._attrs = (lgd) => lgd["attrs"];
offseason.house = (pos, ovr) => int(ovr);
offseason.life = (p, season_year, kind, extra = {}) => {
  if (!("life" in p)) p["life"] = [];
  const row = { year: season_year, kind: kind };
  for (const [k, v] of Object.entries(extra)) if (v !== null) row[k] = v;
  p["life"].push(row);
  if (p["life"].length > offseason.LIFE_KEEP) p["life"].splice(0, p["life"].length - offseason.LIFE_KEEP);
};
offseason._group_counts = (roster) => {
  const counts = {};
  for (const g of Object.keys(offseason.TARGET)) counts[g] = 0;
  for (const p of roster) counts[offseason.GROUP[p["pos"]]] += 1;
  return counts;
};
offseason._depth_values = (roster) => {
  const depth = {};
  for (const g of Object.keys(offseason.TARGET)) depth[g] = [];
  for (const p of roster) depth[offseason.GROUP[p["pos"]]].push(p["o"]);
  for (const v of Object.values(depth)) v.sort((a, b) => b - a);
  return depth;
};
const span = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
offseason._jersey = (roster, pos, rng) => {
  const used = new Set(roster.map((p) => String(get(p, "j"))));
  const ranges = { QB: span(1, 20), HB: span(1, 50), WR: span(1, 90), TE: span(80, 90), K: span(1, 50), P: span(1, 50), CB: span(1, 50),
    FS: span(1, 50), SS: span(1, 50) };
  const g = offseason.GROUP[pos];
  const nums = g === "OL" ? span(50, 80) : g === "DL" || g === "LB" ? span(1, 100) : ranges[pos] || span(1, 100);
  let free = nums.map(String).filter((n) => !used.has(n));
  if (!free.length) free = span(0, 100).map(String).filter((n) => !used.has(n));
  return free.length ? rng.choice(free) : null;
};
offseason._new_transfer = (off, c, me) => {
  if (!truthy(get(c, "transfer"))) return false;
  if ("transfer_year" in c) return c["transfer_year"] === get(off, "year");
  return (get(get(off, "portal") || {}, "moves") || []).some((m) => get(m, "id") === c["id"] && get(m, "to") === me);
};
const queue = { growth_terms: [], _compact_prospect: [], _records: [], class_table: [], class_rank: [] };
const next = (name) => {
  if (!queue[name].length) throw new Error(`nothing recorded for ${name}`);
  const v = queue[name].shift();
  if (v !== null && typeof v === "object" && v.__raised__) throw new Error(v.__raised__);
  return v;
};
const load = (rec) => { for (const k of Object.keys(queue)) queue[k] = copy(rec[`${k}[]`] || []); };
const leftover = () => Object.fromEntries(Object.entries(queue).map(([k, v]) => [k, v.length]));
const NONE_LEFT = { growth_terms: 0, _compact_prospect: 0, _records: 0, class_table: 0, class_rank: 0 };
offseason.growth_terms = () => next("growth_terms");
offseason._compact_prospect = (state, p) => {
  const row = next("_compact_prospect");
  if (row.pid !== p["id"]) throw new Error(`_compact_prospect: the Python took ${row.pid}, the JavaScript ${p["id"]}`);
  return row.out;
};

// ----- the modules outside the file, as recorded ------------------------------------------------------------------
const pools = { budget: {}, left: {}, carry: {} };
modules.recruiting = {
  pool_record: (state, slug) => { if (!(slug in state["nil_pool"])) throw new Error(`no pool for ${slug}`); return state["nil_pool"][slug]; },
  portal_budget: (state, slug) => pools.budget[slug],
  nil_left: (state, slug) => pools.left[slug],
  carry_over: (state, slug, unspent) => {
    if (pools.carry[slug][0] !== unspent) throw new Error(`carry_over(${slug}): unspent py ${pools.carry[slug][0]} | js ${unspent}`);
    return pools.carry[slug][1];
  },
  _group_of: (p) => {
    if (get(p, "group") === null) p["group"] = get(offseason.GROUP, p["ea_position"], "S");
    return p["group"];
  },
};
const season_teams = Object.fromEntries(Object.entries(setup.names).map(([s, name]) => [s, { name }]));
let p4 = setup.p4;
modules.season = { load_teams: () => season_teams, _is_p4: (slug) => p4[slug], _records: () => next("_records") };
prospects.class_table = () => next("class_table");
prospects.class_rank = () => next("class_rank");

await import("../offseason/part3.js");
const { carousel } = await import("../carousel.js");

const t = tally();
const CLOSE = { close: 1e-12 };     // a gauss or an exp can differ in its last digit (PORTING.md): a program's era is kept as drawn

// the part's own constants, and the squares it takes
for (const k of MINE) t.same(`constant ${k}`, setup.constants[k], offseason[k]);
{
  const { pypow } = await import("../recruits.js");
  t.same("squares", setup.squares, [offseason.ERA_PERSIST, offseason.ERA_SD, offseason.TEAM_YEAR_SD, offseason.PLAYER_YEAR_SD].map((x) => pypow(x, 2)));
}

const thrown = (f) => {
  try { f(); } catch (e) {
    if (e instanceof ValueError) return e.message;
    throw e;
  }
  return null;
};

// ----- the careers: each stage function as the offseason called it ------------------------------------------------
let preferred = 0, lower = 0, stepped_back = 0;
for (const info of setup.cases) {
  const dir = path.join(out, info.tag);
  const name = (what) => `${info.tag} ${info.team} ${what}`;
  clear.CLEAR = info.clear;
  p4 = setup.p4;

  // the portal closes
  {
    const state = read(dir, "_carry_over.before.json"), r = read(dir, "_carry_over.json");
    pools.budget = r.rec.portal_budget; pools.left = r.rec.nil_left || {}; pools.carry = r.rec.carry_over;
    offseason._carry_over(state);
    t.same(name("_carry_over"), r.after, { nil_carry: state["nil_carry"], nil_pool: state["nil_pool"], portal_nil: state["offseason"]["portal_nil"] });
  }

  // development: players, then the rosters filled, then the coaches, on one state
  const state = read(dir, "_develop_all.before.json");
  {
    const r = read(dir, "_develop_all.json");
    load(r.rec);
    const res = offseason._develop_all(state);
    t.same(name("_develop_all result"), r.out, res, CLOSE);
    t.same(name("_develop_all teams"), r.after, { teams: state["league"]["teams"] }, CLOSE);
    t.same(name("_develop_all asked"), NONE_LEFT, leftover());
    stepped_back += res.mine.filter((m) => m.why.some((w) => w.startsWith("Lost a step") || w.startsWith("Went backward"))).length;
  }
  {
    const r = read(dir, "_fill_rosters.json");
    load(r.rec);
    p4 = r.rec._is_p4;
    const res = offseason._fill_rosters(state);
    t.same(name("_fill_rosters result"), r.out, res);
    t.same(name("_fill_rosters teams"), r.after, { teams: state["league"]["teams"] }, CLOSE);
    t.same(name("_fill_rosters asked"), NONE_LEFT, leftover());
    for (const team of Object.values(state["league"]["teams"])) {
      for (const p of team["roster"]) { if (p["preferred"]) preferred++; if (p["transfer"] === "FCS" && p["transfer_year"] === state["offseason"]["year"]) lower++; }
    }
    p4 = setup.p4;
  }
  const coaches_after = (s) => ({ teams: Object.fromEntries(Object.entries(s["league"]["teams"]).map(([slug, team]) => [slug, { coaches: team["coaches"] }])),
    market: get(s["league"], "market"), staff: s["career"]["staff"] });
  const again = copy(state);
  for (const [s, file, what] of [[state, "_develop_coaches.json", "_develop_coaches"], [again, "_develop_coaches.again.json", "_develop_coaches (a second year)"]]) {
    const r = read(dir, file);
    load(r.rec);
    const res = offseason._develop_coaches(s);
    t.same(name(`${what} result`), r.out, res);
    t.same(name(`${what} coaches`), r.after, coaches_after(s));
    t.same(name(`${what} asked`), NONE_LEFT, leftover());
  }

  // the Staff step
  {
    const s = read(dir, "_staff_changes.before.json"), r = read(dir, "_staff_changes.json");
    const res = offseason._staff_changes(s, ...r.args);
    t.same(name("_staff_changes result"), r.out, res);
    t.same(name("_staff_changes staff"), r.after, { staff: s["career"]["staff"] });
    s["offseason"]["staff"] = res;
    s["offseason"]["stage"] = "staff";
    const ops = read(dir, "staff_ops.json");
    for (const op of ops.ops) {
      const call = op.op === "open_role" ? () => offseason.open_role(s, op.id) : () => offseason.hire(s, op.id, op.index);
      if (op.error !== null) t.same(name(`${op.op} ${op.id} refused`), op.error, thrown(call));
      else t.same(name(`${op.op} ${op.id}`), op.out, call());
    }
    const off = s["offseason"];
    t.same(name("staff step state"), ops.offseason, { coaching_changes: get(off, "coaching_changes"), staff_open: get(off, "staff_open"), staff: get(off, "staff") });
    t.same(name("staff step market"), ops.market, get(s["league"], "market"));
    const r2 = read(dir, "_apply_staff.json");
    const hires = offseason._apply_staff(s);
    t.same(name("_apply_staff result"), r2.out, hires);
    t.same(name("_apply_staff after"), r2.after, { coaches: s["league"]["teams"][s["team"]]["coaches"], market: get(s["league"], "market"), staff: s["career"]["staff"] });
  }
}
console.log(`in the careers: ${preferred} preferred walk-ons, ${lower} lower-level transfers, ${stepped_back} of your players stepped back`);

// ----- _staff_changes many ways -----------------------------------------------------------------------------------
clear.CLEAR = setup.clear;
{
  const base = read(out, "variants.state.json");
  let left = 0, openings = 0;
  for (const [i, v] of read(out, "variants.json").entries()) {
    const s = copy(base);                 // its own league: the coaching market is made from the seed
    s["seed"] = v.seed; s["career"]["staff"] = copy(v.staff);
    const res = offseason._staff_changes(s, v.poached, v.why, v.declined);
    t.same(`_staff_changes variant ${i}`, { out: v.out, staff: v.staff_after }, { out: res, staff: s["career"]["staff"] });
    left += res.leaving.length; openings += Object.values(res.candidates).length;
  }
  console.log(`in the variants: ${left} staff members left, ${openings} openings with candidates`);
}

// ----- the small functions ----------------------------------------------------------------------------------------
{
  const u = read(out, "unit.json"), state = read(out, "unit.state.json");
  const attrs = state["league"]["attrs"];
  for (const [a, py] of u.coachability_chances) t.same(`coachability_chances ${JSON.stringify(a)}`, py, offseason.coachability_chances(...a));
  for (const [[level, chances, drop, seed], py] of u.coachability_roll) {
    t.same(`coachability_roll ${seed}`, py, offseason.coachability_roll(level, chances, drop, new Random(seed)));
  }
  for (const [[level, case_, coach], py] of u.coachability_note) {
    t.same(`coachability_note ${level} ${case_}`, py, coach === null ? offseason.coachability_note(level, case_) : offseason.coachability_note(level, case_, coach));
  }
  for (const [[coaches, pos], py] of u.coaches) {
    t.same(`coaches ${pos}`, py, [offseason._dev_side(pos), offseason.dev_rating(coaches, pos), offseason.coach_factor(coaches, pos), offseason._coach_title(coaches, pos)]);
  }
  for (const [[coaches, pos], py] of u._coach_title) t.same("_coach_title", py, offseason._coach_title(coaches, pos));
  for (const [[p, starter], py] of u.year_pace) t.same(`year_pace ${JSON.stringify(p)}`, py, starter ? offseason.year_pace(p, true) : offseason.year_pace(p));
  for (const [ab, py] of u.rv2_tier) t.same(`rv2_tier ${ab}`, py, offseason.rv2_tier(ab));
  for (const [slug, py] of Object.entries(u.program_factor)) t.same(`program_factor ${slug}`, py, offseason.program_factor(state, slug));
  for (const [age, f, m] of u.ages) t.same(`age ${age}`, [f, m], [offseason.age_factor(age), offseason.pot_mean(age)]);
  for (const [x, seed, py] of u._round) t.same(`_round ${x}`, py, offseason._round(x, new Random(seed)));
  for (const [role, py] of u.term_of) t.same(`term_of ${role}`, py, offseason.term_of(role));
  for (const [[s, y], py] of u.expiring) t.same(`expiring ${JSON.stringify(s)} ${y}`, py, offseason.expiring(s, y));
  for (const [a, py] of u._why) t.same(`_why ${JSON.stringify(a)}`, py, offseason._why(...a));
  for (const c of u.develop) {
    clear.CLEAR = c.clear;
    const p = copy(c.p);
    const gain = c.two ? offseason.develop(p, attrs, c.factor, new Random(c.seed)) : offseason.develop(p, attrs, c.factor, new Random(c.seed), c.starter);
    t.same(`develop ${c.seed}`, { gain: c.gain, r: c.r, g: c.g, o: c.o }, { gain, r: p["r"], g: p["g"], o: p["o"] });
  }
  clear.CLEAR = setup.clear;
  for (const [i, c] of u._card_growth.entries()) t.same(`_card_growth ${i}`, c.out, offseason._card_growth(c.was, c.now, attrs, c.pos));
  let slipped = 0;
  for (const [i, c] of u.regress.entries()) {
    const p = copy(c.p);
    const note = offseason.regress(p, attrs, c.perf, c.benched, c.year);
    if (note) slipped++;
    t.same(`regress ${i}`, { note: c.note, r: c.r, g: c.g, o: c.o }, { note, r: p["r"], g: p["g"], o: p["o"] });
  }
  for (const c of u.coach_growth) {
    const ratings = copy(c.ratings), holder = copy(c.holder), rng = new Random(c.seed);
    const pot = offseason._pot(holder, ratings, rng, c.age);
    t.same(`_pot ${c.seed}`, { pot: c.pot, holder: c.holder_after }, { pot, holder });
    const changes = offseason.grow_coach(ratings, pot, c.age, c.perf, rng, c.base ? holder["base"] : null, c.pace);
    t.same(`grow_coach ${c.seed}`, { changes: c.changes, after: c.after }, { changes, after: ratings });
  }
  for (const c of u._newcomer) t.same(`_newcomer ${c.slug}`, c.out, offseason._newcomer(c.r, c.slug));
  for (const c of u._candidate) {
    const taken = new Set(c.taken);
    const made = offseason._candidate(new Random(c.seed), c.s, taken);
    t.same(`_candidate ${c.seed}`, { out: c.out, taken: c.taken_after }, { out: made, taken: [...taken].sort() });
  }
  t.same("_staff_taken", u._staff_taken, [...offseason._staff_taken(state)].sort());
  const taken = new Set();
  let named = 0;
  for (const [[slug, g], py] of u._preferred_walk_on) {
    const best = offseason._preferred_walk_on(state, slug, g, taken);
    if (best) named++;
    t.same(`_preferred_walk_on ${slug} ${g}`, py, best ? best["id"] : null);
  }
  t.same("_preferred_walk_on taken", u._preferred_walk_on_taken, [...taken].sort());
  load(u.marks_rec);
  t.same("_staff_marks", u._staff_marks, offseason._staff_marks(state));
  t.same("_league_marks", u._league_marks, offseason._league_marks(state));
  t.same("marks asked", NONE_LEFT, leftover());
  // a state with no recruiting: the class rank cannot be had (nothing is recorded for it, so the stand-in throws)
  const bare = { team: state["team"], league: { teams: Object.fromEntries(Object.keys(state["league"]["teams"]).map((s) => [s, {}])) }, games: {}, career: true };
  t.same("_staff_marks with no class", u.marks_bare[0], offseason._staff_marks(bare));
  console.log(`in the small functions: ${slipped} of ${u.regress.length} players stepped back, ${named} named walk-ons`);
  void carousel;
}

t.done("offseason part 3");
