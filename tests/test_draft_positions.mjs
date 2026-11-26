// The draft's first round by position. A prospect is graded against this year's draft-eligible players at his own
// position and then valued the way the NFL values positions, so the first round spreads over the positions as real
// ones do, in a career's first offseason and in later ones, and a position whose ratings drift up cannot take the
// round over (a played career's 2028 draft once had 24 quarterbacks and receivers in 32 picks). Who declares early is
// by projected pick, so linemen and defensive backs with the grades go too.
// `node tests/test_draft_positions.mjs`
import { start, test, run, assert } from "./harness.mjs";
import { Random, sorted, round } from "../engine_js/pyrt.js";

const game = await start({ env: { SIM_WORKERS: "1" } });
const { season, offseason } = game;
const league = game.modules.league;

const show = (v) => JSON.stringify(v);
const ELIGIBLE = new Set(["SR", "SRRS", ...offseason.UNDERCLASS_ELIGIBLE]);
const SPLIT = 2;          // card points inside which the scouts can take one prospect over another at his position
const n = (counts, g) => counts[g] || 0;

/** Every game played (the better team usually wins), every school's class signed, the season over. */
function finished(st) {
  const rng = new Random(1);
  const teams = season.load_teams();
  for (const g of Object.values(st["games"])) {
    const [h, a] = [teams[g["home"]]["team_ratings"]["overall"], teams[g["away"]]["team_ratings"]["overall"]];
    const hs = rng.randint(10, 45);
    const win = rng.random() < 1 / (1 + Math.pow(10, (a - h) / 7));
    g["played"] = true;
    g["home_score"] = win ? hs : Math.max(0, hs - rng.randint(1, 20));
    g["away_score"] = win ? hs - rng.randint(1, 20) : hs;
    if (g["home_score"] === g["away_score"]) g["home_score"] += 3;
  }
  const rc = st["recruiting"];
  const schools = Object.entries(teams).filter(([, t]) => !t["fictional"]).map(([s]) => s);
  const pids = sorted(Object.keys(rc["prospects"]), (p) => rc["prospects"][p]["rank"]);
  pids.slice(0, schools.length * 21).forEach((pid, i) => { rc["status"][pid]["signed"] = schools[i % schools.length]; });
  Object.assign(st, { done: true, current_week: season.FINAL_WEEK, champion: "ohio-state" });
}

/** A league's draft-eligible players only (what the draft reads), as copies. */
function pool_of(lgd) {
  const teams = {};
  for (const [slug, t] of Object.entries(lgd["teams"])) teams[slug] = { roster: t["roster"].filter((p) => ELIGIBLE.has(p["cls"])).map((p) => structuredClone(p)) };
  return { teams };
}

/** The draft pools of a career's first `seasons` offseasons (the seasons made up). */
function career_pools(seed, seasons) {
  const out = [];
  let st = season.new_season("ohio-state", "full", seed, undefined, undefined, true);
  for (let i = 0; i < seasons; i++) {
    finished(st);
    out.push(pool_of(st["league"] || league.from_base(season.season_year(st) + 1)));
    if (i < seasons - 1) { offseason.run_all(st); st = offseason.next_season(st); }
  }
  league.forget(st["id"]);
  return out;
}

/** One draft of a pool: [round one's picks by position group, id -> pick, id -> player, who declared early]. */
function first_round(pool, rng) {
  const [declared, drafted] = offseason.draft_board(pool, rng);
  const by_id = {};
  for (const t of Object.values(pool["teams"])) for (const p of t["roster"]) by_id[p["id"]] = p;
  const r1 = {};
  for (const [id, pick] of Object.entries(drafted)) if (pick <= 32) { const g = offseason.DRAFT_GROUP[by_id[id]["pos"]]; r1[g] = (r1[g] || 0) + 1; }
  return [r1, drafted, by_id, declared];
}

function check_round(r1, where) {
  const say = () => show([where, r1]);
  assert(n(r1, "QB") <= 5 && n(r1, "WR") <= 8, say);            // one draft can run a receiver past the real years' 7; the average holds the shape
  assert(n(r1, "QB") + n(r1, "WR") <= 12, () => `quarterbacks and receivers take the round: ${say()}`);
  assert(n(r1, "EDGE") >= 2 && n(r1, "OT") >= 2 && n(r1, "CB") >= 2, say);
  assert(n(r1, "DL") + n(r1, "EDGE") >= 3, () => `the defensive front in round one: ${say()}`);
  assert(!n(r1, "K") && !n(r1, "P"), () => `a specialist in round one: ${say()}`);
  assert(Object.values(r1).reduce((a, b) => a + b, 0) === 32 && Object.keys(r1).length >= 7, say);
}

/** The first pick is a top-graded player: one of the two best at his position or within SPLIT of them (the scouts
 * disagree by about a point), rated 80 or better less the same split, in the top 2% of the eligible players, and not
 * at a position the NFL takes later (a year's best quarterback can go first over a 99 at a position valued less). */
function top_pick(drafted, by_id, where) {
  const first = Object.keys(drafted).find((id) => drafted[id] === 1);
  const p = by_id[first];
  const group = offseason.DRAFT_GROUP[p["pos"]];
  const same = sorted(Object.values(by_id).filter((q) => offseason.DRAFT_GROUP[q["pos"]] === group).map((q) => -q["o"])).map((x) => -x);
  const everyone = sorted(Object.values(by_id).map((q) => -q["o"])).map((x) => -x);
  assert(p["o"] >= same[1] - SPLIT, () => `the first pick is not among his position's best two: ${show([where, p["pos"], p["o"], same.slice(0, 5)])}`);
  assert(p["o"] >= 80 - SPLIT && p["o"] >= everyone[Math.floor(everyone.length / 50)], () => `the first pick is not a top player: ${show([where, p["o"], everyone.slice(0, 5)])}`);
  assert(!["K", "P", "RB", "S", "IOL", "TE"].includes(group), () => `the first pick at a position the NFL takes later: ${show([where, p["pos"]])}`);
}

test("round one has a real draft's spread of positions, in a career's first three offseasons, and its first pick is a top player", () => {
  const pools = [...career_pools(5, 3), ...career_pools(9, 3).slice(1)];
  const totals = {};
  let rounds = 0;
  pools.forEach((pool, i) => {
    for (const rep of [0, 1]) {
      const [r1, drafted, by_id] = first_round(pool, new Random(`positions-${i}-${rep}`));
      check_round(r1, `pool ${i} draw ${rep}`);
      top_pick(drafted, by_id, `pool ${i} draw ${rep}`);
      for (const [g, c] of Object.entries(r1)) totals[g] = (totals[g] || 0) + c;
      rounds++;
    }
  });
  // on average the shape of the real 2021-2025 first rounds
  const avg = Object.fromEntries(Object.entries(totals).map(([g, c]) => [g, round(c / rounds, 1)]));
  for (const [g, [lo, hi]] of Object.entries({ QB: [1.5, 5], WR: [3, 7], OT: [3, 7], EDGE: [3, 7], DL: [1, 4], CB: [2.5, 6] })) {
    assert(lo <= n(avg, g) && n(avg, g) <= hi, show([g, avg]));
  }
});

// quarterbacks' and receivers' ratings up 10 across the pool: the round moves by a few picks, where a score per raw
// rating point gave them two thirds of it
test("a position whose ratings drift up gains a few first-round picks, not the round", () => {
  const base = league.from_base(2027);
  const before = {}, after = {};
  const add = (into, r1) => { for (const [g, c] of Object.entries(r1)) into[g] = (into[g] || 0) + c; };
  for (let seed = 0; seed < 4; seed++) {
    const pool = pool_of(base);
    add(before, first_round(pool, new Random(`drift-${seed}`))[0]);
    for (const t of Object.values(pool["teams"])) for (const p of t["roster"]) if (p["pos"] === "QB" || p["pos"] === "WR") p["o"] = Math.min(99, p["o"] + 10);
    const r1 = first_round(pool, new Random(`drift-${seed}`))[0];
    assert(n(r1, "QB") + n(r1, "WR") <= 13 && n(r1, "EDGE") + n(r1, "OT") + n(r1, "CB") + n(r1, "DL") >= 10, show(r1));
    add(after, r1);
  }
  assert((n(after, "QB") + n(after, "WR")) / 4 <= (n(before, "QB") + n(before, "WR")) / 4 + 5, show([before, after]));
});

test("early entrants in the first two rounds come from both lines and the secondary, not mostly quarterbacks and receivers", () => {
  const base = league.from_base(2027);
  const counts = {};
  for (let seed = 0; seed < 4; seed++) {
    const [, drafted, by_id, declared] = first_round(pool_of(base), new Random(`declare-${seed}`));
    for (const id of declared) if ((drafted[id] ?? 999) <= 64) { const g = offseason.DRAFT_GROUP[by_id[id]["pos"]]; counts[g] = (counts[g] || 0) + 1; }
  }
  for (const g of ["OT", "EDGE", "DL", "CB"]) assert(n(counts, g) >= 2, () => `no early entrants in the first two rounds at ${g}: ${show(counts)}`);
  assert(n(counts, "QB") + n(counts, "WR") <= 0.45 * Object.values(counts).reduce((a, b) => a + b, 0), show(counts));
});

await run();
