// career_js/offseason/part1.js against the Python it was ported from (coach_career/offseason.py, lines 1 to 811):
//   node career_js/test/offseason_part1_compare.mjs OUTDIR     (after offseason_part1_reference.py OUTDIR)
//
// The part is loaded alone on the offseason's namespace. The JavaScript season, league, carousel, programs, promises,
// word, persona, coach names and ability goals are the real ones; what part 1 asks of the file's other parts
// (_season_moves, _departures, _sign_classes, _redshirt_block, _would_start, life) and of recruiting (portal_pool,
// portal_rc) is replayed from Python's record, call by call: the state before each is checked against Python's (what
// part 1 did up to there), then made what Python's was after. recruiting's small ones (pool_record, is_portal, _five,
// reset_caches, its constants) are written out here.
import fs from "fs";
import os from "os";
import path from "path";
import { env } from "../../engine_js/files.js";
import { modules } from "../../engine_js/modules.js";
import { parse_ordered, int, round, get, truthy } from "../../engine_js/pyrt.js";
import { use_repo_files, read, copy, tally } from "./compare_tools.mjs";

const out = process.argv[2];
use_repo_files();
const setup = read(out, "setup.json");
env.CFP_CLEAR = setup.clear ? "1" : "0";             // before clear.js loads: it reads the switch then
env.CFP_SEASONS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "seasons-"));

const t = tally();
const play = { calls: [], state: null, base: null, tag: "", resets: 0 };

function next_call(fn) {
  const c = play.calls.shift();
  if (!c || c.fn !== fn) throw new Error(`${play.tag}: the JavaScript asked for ${fn} where Python asked for ${c ? c.fn : "nothing more"}`);
  return c;
}

/** state[k] becomes v; a dict keeps its identity (part 1 holds the league while the other parts change it). */
function put(state, k, v) {
  const old = state[k];
  if (k === "games" || k === "my_boxes") throw new Error(`a part's stub would replace ${k}`);
  if (old && v && typeof old === "object" && typeof v === "object" && !Array.isArray(old) && !Array.isArray(v)) {
    for (const key of Object.keys(old)) delete old[key];
    Object.assign(old, v);
  } else state[k] = v;
}

const recruiting = {
  ...setup.recruiting,
  use_league_models() {},
  reset_caches() { play.resets++; },
  is_portal: (state) => truthy(get(get(state, "recruiting") || {}, "portal")),
  _five: (x) => int(5 * round(x / 5)),
  pool_record(state, slug) {
    if (!state["nil_pool"] || !(slug in state["nil_pool"])) throw new Error("pool_record: no pool seeded");
    return state["nil_pool"][slug];
  },
  portal_pool(state, slug, facts) {
    const c = next_call("recruiting.portal_pool");
    t.same(`${play.tag} portal_pool's slug and facts (${slug})`, c.args, [slug, facts]);
    return copy(c.ret);
  },
  portal_rc(state, entrants, year) {
    const c = next_call("recruiting.portal_rc");
    t.same(`${play.tag} portal_rc's entrants and year`, c.args, [entrants, year]);
    return copy(c.ret);
  },
};
modules.recruiting = recruiting;

const { season } = await import("../../sim_js/season.js");
const { league: lg } = await import("../league.js");
await import("../persona.js");
const { offseason } = await import("../offseason_ns.js");
await import("../offseason/part1.js");
lg.CACHE_DIR = setup.leagues;                         // a career's own league (the second season), where Python wrote it

offseason.STAFF_ROLES = setup.STAFF_ROLES;            // (another part's constant)
function part_stub(name) {
  offseason[name] = (...args) => {
    const c = next_call(name), state = play.state;
    t.same(`${play.tag} the state's keys before ${name}`, c.before_keys, Object.keys(state));
    for (const k of new Set([...Object.keys(c.before), ...Object.keys(c.after)])) {
      t.same(`${play.tag} state.${k} before ${name}`, k in c.before ? c.before[k] : play.base[k], state[k]);
    }
    if (name === "_departures") {
      t.same(`${play.tag} _departures' usage`, c.usage, args[2]);
      if (args[3] !== undefined) throw new Error("_departures: shifts was given");
      Object.assign(args[4], copy(c.draft));
    }
    for (const [k, v] of Object.entries(c.after)) put(state, k, copy(v));
    for (const k of c.gone) delete state[k];
    return copy(c.ret);
  };
}
for (const name of ["_season_moves", "_departures", "_sign_classes", "_redshirt_block"]) part_stub(name);
offseason._would_start = (roster, starters) => {
  const c = next_call("_would_start");
  t.same(`${play.tag} _would_start's roster and starters`, [c.ids, c.starters], [roster.map((p) => p["id"]), starters]);
  return new Set(c.ret);
};
offseason.life = (p, season_year, kind, extra) => {
  const c = next_call("life");
  t.same(`${play.tag} life's arguments`, c.args, [p["id"], season_year, kind, extra]);
  p["life"] = copy(c.life);
};

/** fn() with Python's record of the calls it makes of the other parts replayed; every one must be asked for. */
function recorded(state, calls, fn) {
  play.state = state;
  play.calls = copy(calls);
  const got = fn();
  if (play.calls.length) throw new Error(`${play.tag}: Python asked for ${play.calls[0].fn} and the JavaScript did not`);
  return got;
}

function attempt(fn) {
  try {
    return copy(fn());
  } catch (e) {
    if (e instanceof offseason.ReviewError || e instanceof offseason.RetentionError) return { error: [e.constructor.name, e.code, e.message] };
    throw e;
  }
}

/** The reference's list of [label, value], walked in step. */
function stepper(tag, rows) {
  let i = 0;
  return (label, value) => {
    const row = rows[i++];
    if (!row || row[0] !== label) throw new Error(`${tag}: check ${i} is "${label}" here and "${row && row[0]}" in the reference`);
    t.same(`${tag} ${label}`, row[1], value);
  };
}

function section_a(st, ref, add) {
  const me = st["team"];
  const teams = season.load_teams();
  add("seed_key", [offseason.seed_key(st), offseason.seed_key({ id: "abc123", seed: null }), offseason.seed_key({ id: "x", seed: 0 }),
    offseason.seed_key({ id: "only-id" })]);
  for (const [what, s] of [["retention", st], ["x", { id: "abc", year: 2031 }], ["y", { seed: 7 }], ["z", { seed: 7, year: null }]]) {
    const r = offseason._rng(s, what);
    add(`_rng ${what}`, [r.random(), r.random(), r.randint(1, 1000)]);
  }
  add("house", [["QB", 71], ["K", 0], ["WR", 99], ["CB", 64.9], ["DT", 12.2]].map(([p, o]) => offseason.house(p, o)));
  add("_attrs", offseason._attrs({ attrs: ["a", "b"] }));
  add("_record", Object.keys(teams).concat(["no-such-team"]).map((s) => offseason._record(st, s)));
  add("_usage", offseason._usage(st));
  add("_usage none", JSON.stringify(offseason._usage(null)) === JSON.stringify(offseason._usage({})) && JSON.stringify(offseason._usage()) === JSON.stringify(offseason._usage({})));
  const depth = ref.A.find((r) => r[0] === "depth")[1];
  add("depth", depth);
  const used = offseason._usage({ ...st, depth });
  add("_usage depth", Object.fromEntries(Object.keys(depth).map((s) => [s, used[s]])));
  const perf = offseason._performance(st);
  add("_performance", perf);
  add("_performance order", Object.keys(perf));
  const made = ref.A.find((r) => r[0] === "growth made")[1];
  add("growth made", made);
  add("growth_terms made", made.map((p) => offseason.growth_terms(p)));
  add("growth_terms real", Object.values(perf).map((p) => offseason.growth_terms(p)));
  const year = season.season_year(st);
  const lgd = truthy(get(st, "league")) ? copy(st["league"]) : lg.from_base(year + 1);
  const rows = Object.values(lgd["teams"]).flatMap((x) => x["roster"]);
  rows.filter((_, i) => i % 7 === 0).forEach((c, i) => {
    c["hist"] = Array.from({ length: i % 11 }, (_, k) => ({ year: year - 9 + k, team: "old" })).concat(i % 5 === 0 ? [{ year, team: "now" }] : []);
  });
  add("record_seasons n", offseason.record_seasons(st, lgd));
  add("record_seasons hist", rows.map((c) => [c["id"], get(c, "hist")]));
  add("record_seasons again", offseason.record_seasons(st, lgd));
  const bare = { ...st };
  delete bare["season_stats"];
  add("record_seasons no stats", truthy(get(st, "league")) ? null : offseason.record_seasons(bare, lg.from_base(year + 1)));
}

function with_setup(st, row_setup, fn) {
  if (!row_setup) return fn();
  const me = st["team"];
  const by_id = new Map(st["league"]["teams"][me]["roster"].map((p) => [p["id"], p]));
  const had = ["promises" in st, st["promises"]];
  const old = [];
  for (const [pid, marks] of Object.entries(row_setup.rows)) {
    if (!by_id.has(pid)) continue;
    const p = by_id.get(pid);
    for (const k of Object.keys(marks)) old.push([p, k, k in p, p[k]]);
    Object.assign(p, copy(marks));
  }
  st["promises"] = copy(row_setup.promises);
  try {
    return fn();
  } finally {
    for (const [p, k, was, v] of old) { if (was) p[k] = v; else delete p[k]; }
    if (had[0]) st["promises"] = had[1]; else delete st["promises"];
  }
}

function put_market(lgd, market) {
  if (market === null || market === undefined) delete lgd["market"];
  else lgd["market"] = copy(market);
}

function section_c(st, ref, add, tag) {
  const me = st["team"], lgd = st["league"];
  let off = st["offseason"];
  const year = off["year"];
  let team = lgd["teams"][me];
  const pending = ref.entries[0].pending;
  add("start again", offseason.start(st) === off);
  add("season_facts", offseason.season_facts(st));
  const rv0 = off["review"];
  off["review"] = Object.fromEntries(Object.entries(rv0).filter(([k]) => k !== "met"));
  add("season_facts no met", offseason.season_facts(st)[me]);
  off["review"] = { ...rv0, met: !rv0["met"] };
  add("season_facts flipped", offseason.season_facts(st)[me]);
  off["review"] = rv0;
  add("_retention_view", offseason._retention_view(st));
  add("_retention_view none", offseason._retention_view({ team: me, offseason: {} }));
  add("_retention_entries no team", offseason._retention_entries({ ...st, team: "no-such-team" }, lgd, pending.length ? pending : [{ ev: {} }]));

  ref.entries.forEach((row, i) => {
    const got = recorded(st, row.calls, () => with_setup(st, row.setup, () => copy(offseason._retention_entries(st, lgd, copy(row.pending)))));
    t.same(`${tag} _retention_entries, list ${i} (${row.pending.length} leavers)`, row.out, got);
  });

  const had = get(st["career"], "word");
  ref.stay.cases.forEach(([x, mode], i) => {
    if (mode in ref.stay.words) st["career"]["word"] = copy(ref.stay.words[mode]);
    const got = mode === "none" ? offseason.stay_chance(copy(x)) : offseason.stay_chance(copy(x), st);
    if (mode in ref.stay.words) { if (had === null) delete st["career"]["word"]; else st["career"]["word"] = had; }
    t.same(`${tag} stay_chance ${i} (${mode})`, ref.stay.answers[i], got);
  });
  const grid = Array.from({ length: 41 }, (_, i) => i / 40).concat([0.65, 0.4, 0.2, 0.6499999, 0.39999, 0.19999]);
  add("_chance_word", grid.map((c) => offseason._chance_word(c)));
  const bp = [];
  for (const k of ["promised", "deal", "buried"]) for (const info of [null, { band: "broken" }, { band: "kept" }, {}]) for (const intent of ["portal", "draft"]) bp.push(offseason._broken_promise(k, info, intent));
  add("_broken_promise", bp);
  const kp = [];
  for (const o of [{ promise: true }, { promise: false }, {}]) for (const x of [{}, { no_third: true }, { no_third: false }, { no_third: null }]) kp.push(offseason._keeps_promise({ offers: o, ...x }));
  add("_keeps_promise", kp);

  const ids = off["retention"]["players"].map((e) => e["id"]);
  add("retain", ref.moves.map(([pid, action, nil]) => attempt(() => offseason.retain(st, pid, action, nil))));
  add("retain default nil", ids.length ? attempt(() => offseason.retain(st, ids[0], "nil")) : null);
  off["stage"] = "departures";
  add("retain wrong stage", attempt(() => offseason.retain(st, "x", "meet")));
  off["stage"] = "retention";
  off["fired"] = true;
  add("retain fired", attempt(() => offseason.retain(st, "x", "meet")));
  delete off["fired"];
  add("retain no offseason", attempt(() => offseason.retain({}, "x", "meet")));
  add("_retention_spent", [offseason._retention_spent(off), offseason._retention_spent({}), offseason._retention_spent({ retention: null })]);
  add("_retention_view after", offseason._retention_view(st));

  // the meeting with the AD
  const saved = { ad: copy(team["ad"]), market: copy(get(lgd, "market")), review: off["review"], staff: copy(st["career"]["staff"]),
    seed: get(st, "seed"), coaches: copy(team["coaches"]) };
  ref.reviews.forEach((r, n) => {
    const name = `${tag} review ${n} (security ${r.ad.security}, since ${r.since}, ultimatum ${r.ad.ultimatum}${r.bare ? ", no coordinators" : ""})`;
    team["ad"] = { patience: saved.ad["patience"], security: r.ad.security, ...(r.ad.ultimatum ? { ultimatum: r.ad.ultimatum } : {}) };
    team["coaches"]["head_coach"]["since"] = r.since;
    if (r.bare) st["career"]["staff"] = saved.staff.filter((s) => !(s["role"] in offseason.STAFF_ROLES));
    const rv = copy(offseason._review(st, lgd));
    t.same(`${name} _review`, r.review, rv);
    const after = copy(team["ad"]);
    t.same(`${name} the AD after`, r.ad_after, after);
    for (const d of r.decides) {
      team["ad"] = copy(after);
      team["coaches"] = copy(saved.coaches);
      team["coaches"]["head_coach"]["since"] = r.since;
      put_market(lgd, saved.market);
      off["review"] = copy(rv);
      for (const key of ["staff_open", "fired", "auto"]) delete off[key];
      st["seed"] = d.seed;
      const ans = attempt(() => (d.staff_id !== null ? offseason.review_decide(st, d.action, d.staff_id) : offseason.review_decide(st, d.action)));
      const market = get(get(lgd, "market") || {}, "coaches") || [];
      t.same(`${name} review_decide ${d.action} ${d.staff_id}`, { answer: d.answer, ad: d.ad, review: d.review, off: d.off, market: d.market },
        { answer: ans, ad: team["ad"], review: off["review"], off: Object.fromEntries(["staff_open", "fired", "auto"].map((key) => [key, get(off, key)])),
          market: [market.length, market.length ? market[market.length - 1] : null] });
    }
    st["career"]["staff"] = copy(saved.staff);
  });
  team["ad"] = copy(saved.ad);
  team["coaches"] = copy(saved.coaches);
  off["review"] = saved.review;
  st["seed"] = saved.seed;
  put_market(lgd, saved.market);
  for (const key of ["staff_open", "fired", "auto"]) delete off[key];
  off["review"] = copy(saved.review);
  off["stage"] = "portal_w1";
  add("review closed", attempt(() => offseason.review_decide(st, "case")));
  off["stage"] = "retention";
  off["review"]["decided"] = true;
  add("review decided", attempt(() => offseason.review_decide(st, "case")));
  off["review"] = saved.review;
  add("review none", attempt(() => offseason.review_decide({}, "case")));

  // _resolve_retention
  const keep = { team: copy(team), off: copy(off), pool: copy(st["nil_pool"][me]), seed: get(st, "seed") };
  ref.resolves.forEach((run, k) => {
    lgd["teams"][me] = team = copy(run.setup.team);
    st["offseason"] = off = copy(run.setup.off);
    st["nil_pool"][me] = copy(keep.pool);
    st["seed"] = run.setup.seed;
    const resets = play.resets;
    recorded(st, run.calls, () => offseason._resolve_retention(st));
    t.same(`${tag} _resolve_retention ${k}: your team`, run.team, lgd["teams"][me]);
    t.same(`${tag} _resolve_retention ${k}: the offseason`, run.off, st["offseason"]);
    t.same(`${tag} _resolve_retention ${k}: the pool, caches reset once`, [run.pool, 1], [st["nil_pool"][me], play.resets - resets]);
  });
  lgd["teams"][me] = copy(keep.team);
  st["offseason"] = off = copy(keep.off);
  st["nil_pool"][me] = copy(keep.pool);
  st["seed"] = keep.seed;

  // the portal opens
  const before = st["recruiting"];
  recorded(st, ref.open_portal.calls, () => offseason._open_portal(st));
  t.same(`${tag} _open_portal keeps the signed class aside`, ref.open_portal.same_last, st["recruiting_last"] === before);
  add("_open_portal recruiting", st["recruiting"]);
  offseason._open_portal(st);
  add("_open_portal again", [st["recruiting_last"] === before, st["recruiting"]["board"], Object.keys(st)]);
}

for (const tag of setup.cases) {
  const dir = path.join(out, tag);
  const ref = read(dir, "ref.json");
  const text0 = fs.readFileSync(path.join(dir, "state0.json"), "utf8");
  const st = parse_ordered(text0, [["games"], ["my_boxes"]]);
  play.tag = tag;
  play.base = JSON.parse(text0);
  season.activate(st);
  const a = stepper(tag, ref.A);
  section_a(st, ref, a);
  t.same(`${tag} the state untouched before the offseason`, play.base, st);
  const off = recorded(st, ref.start_calls, () => offseason.start(st));
  t.same(`${tag} start returns the offseason`, true, off === st["offseason"]);
  t.same(`${tag} the whole state after start`, read(dir, "state1.json"), st);
  const c = stepper(tag, ref.C);
  section_c(st, ref, c, tag);
  t.same(`${tag} the whole state at the end`, read(dir, "state2.json"), st);
  console.log(`${tag}: ${t.cases} cases so far, ${t.bad} different`);
}
t.done("offseason part 1");
