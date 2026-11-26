// Why players enter the transfer portal (career_js/offseason: portal_odds, _departures, _retention_entries). A
// starter paid under his market at his program's NIL tier chases a deal; a slipping program (a tier lost this year,
// a new head coach, a weak developer after a losing year) loses starters; a rising one keeps them. The reason Keep
// Them Home and the portal recap give is the one that really drove him, and it fits his role: a starter is never
// "tired of waiting his turn", and a benched player behind someone is "buried" and names him.
// `node tests/test_portal_drivers.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random, sorted } from "../engine_js/pyrt.js";

const game = await start();
const { season, offseason, recruiting } = game;
const { programs } = game.modules;

const show = (v) => JSON.stringify(v);
const TOP = "ohio-state", LOW = "purdue";          // both Power 4: no Group of 5 move-up rule in the way
const YEAR = 2027;
const POSITIONS = ["QB", "HB", "WR", "WR", "WR", "TE", "LT", "LG", "C", "RG", "RT", "LEDG", "REDG", "DT", "DT", "SAM", "MIKE", "WILL", "CB", "CB", "FS", "SS"];
const N = 300;                                      // seeded offseasons per case

/** Two schools of sophomores (no draft, no graduation): a lineup of mid-rated players and one QB rated like a
 * five-star (the player under test) on each, with a bench behind them. */
function mini_league({ tier_top = 1, tier_low = 5, dev = 70, since = 2019 } = {}) {
  const teams = {};
  for (const [slug, tier] of [[TOP, tier_top], [LOW, tier_low]]) {
    const roster = [];
    POSITIONS.forEach((pos, i) => roster.push({ id: `${slug}-${i}`, n: `Player ${i}`, pos, cls: "SO", o: pos === "QB" ? 70 : 40, s: 3, r: [] }));
    POSITIONS.forEach((pos, i) => roster.push({ id: `${slug}-${i + POSITIONS.length}`, n: `Backup ${i + POSITIONS.length}`, pos, cls: "SO", o: 30, s: 2, r: [] }));
    teams[slug] = { roster, program: { tier, nil: tier === 1 ? 90.0 : 20.0, rating: tier === 1 ? 80.0 : 20.0 },
      coaches: { head_coach: { name: "Coach", since, ratings: { overall: 60, player_development: dev } } } };
  }
  return { teams, attrs: [], year: YEAR };
}

const usage_for = (lgd) => Object.fromEntries(Object.entries(lgd["teams"]).map(([slug, t]) =>
  [slug, Object.fromEntries(t["roster"].map((p, i) => [p["id"], i < POSITIONS.length ? "starter" : "bench"]))]));

function mini_state(seed, losing = []) {
  const games = {};
  for (let i = 0; i < 6; i++) {
    for (const slug of losing) {
      games[`${slug}-${i}`] = { home: slug, away: "rutgers", played: true, home_score: 3, away_score: 24, week: i + 1, kind: "regular", conference_game: false };
    }
  }
  return { seed, id: "drivers", year: YEAR - 1, team: "nobody", games, season_stats: {} };
}

/** Over N seeded offseasons: how often each school's test QB enters the portal, by what drove him. */
function entries({ shifts = {}, losing = [], kept = false, ...league } = {}) {
  const out = { [TOP]: {}, [LOW]: {} };
  for (let seed = 0; seed < N; seed++) {
    const lgd = mini_league(league);
    if (kept) for (const t of Object.values(lgd["teams"])) t["roster"][0]["kept"] = YEAR - 1;
    const [, entrants] = offseason._departures(mini_state(seed, losing), lgd, usage_for(lgd), shifts);
    for (const slug of [TOP, LOW]) {
      const e = entrants[`${slug}-0`];
      if (e) out[slug][e["driver"] || "role"] = (out[slug][e["driver"] || "role"] || 0) + 1;
    }
  }
  return out;
}
const total = (counts) => Object.values(counts).reduce((a, b) => a + b, 0);
const QB = { id: "x", pos: "QB", cls: "SO", o: 70 };
const CTX = { losing: false, p4: true, year: YEAR, tier: 5, slipping: null, rising: false };
const odds = (p, use, ctx) => Object.fromEntries(offseason.portal_odds(p, use, ctx));

/** tests/test_offseason's `finished`: every game played (the better team usually wins), every school's class signed, season over. */
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

// ----- the odds -------------------------------------------------------------------------------------------------

test("a five-star-level QB has a five-star's market; a bench-level player has none", () => {
  assert(recruiting.market_value("QB", 70) === recruiting.ASK[5] * recruiting.ASK_POS["QB"]);
  assert(recruiting.market_value("C", 40) === 0);
});

const same = entries({ tier_top: 3, tier_low: 3 });      // two level programs, nothing moving: the baseline

test("the same QB leaves a bottom-tier program far more often than a top one, chasing a deal", () => {
  const r = entries();
  const [top, low] = [total(r[TOP]), total(r[LOW])];
  assert(low > 0 && low / Math.max(1, top) > 1.5, () => show(r));
  assert((r[LOW]["deal"] || 0) >= 0.6 * low, () => show(r[LOW]));
  // the deal's share of his chance: his shortfall's share of his market, NIL_PULL times, capped
  const mv = recruiting.market_value("QB", 70);
  const want = Math.min(offseason.NIL_PULL_CAP, offseason.NIL_PULL * (mv - offseason.NIL_TIER_PAY[5]) / mv);
  assert(Math.abs(odds(QB, "starter", CTX)["deal"] - want) < 1e-9, () => show(odds(QB, "starter", CTX)));
  assert(!("deal" in odds(QB, "bench", CTX)), "a bench player has no market to chase");
});

test("a player you kept with NIL last offseason was paid: no deal pulls him this year", () => {
  assert(!("deal" in odds({ ...QB, kept: YEAR - 1 }, "starter", CTX)));
  const kept = entries({ kept: true }), plain = entries();
  assert(!kept[LOW]["deal"] && total(kept[LOW]) < total(plain[LOW]), () => show([kept[LOW], plain[LOW]]));
});

test("a program that lost a tier this year loses more starters, for slipping", () => {
  const drop = entries({ tier_top: 3, tier_low: 3, shifts: { [LOW]: 1 } });
  assert(total(drop[LOW]) > total(same[LOW]) && drop[LOW]["slipping"] > 0, () => show([same[LOW], drop[LOW]]));
  assert(!drop[TOP]["slipping"], "the school that held its tier is not slipping");
});

test("a new head coach's first year reads as slipping too", () => {
  const fresh = entries({ tier_top: 3, tier_low: 3, since: YEAR - 1 });
  assert(fresh[LOW]["slipping"] > 0 && fresh[TOP]["slipping"] > 0, () => show(fresh));
});

test("a weak developer after a losing year loses starters who want a better coach", () => {
  const weak = entries({ tier_top: 3, tier_low: 3, dev: 35, losing: [LOW] });
  assert(weak[LOW]["better_coach"] > 0 && !weak[TOP]["better_coach"], () => show(weak));
  const strong = entries({ tier_top: 3, tier_low: 3, dev: 70, losing: [LOW] });
  assert(!strong[LOW]["better_coach"] && total(weak[LOW]) > total(strong[LOW]), () => show([weak[LOW], strong[LOW]]));
});

test("a program that rose a tier keeps its starters: every portal chance is cut", () => {
  const rose = entries({ tier_top: 3, tier_low: 3, shifts: { [LOW]: -1 } });
  assert(total(rose[LOW]) < total(same[LOW]), () => show([same[LOW], rose[LOW]]));
  const [flat, up] = [odds(QB, "starter", { ...CTX, tier: 3 }), odds(QB, "starter", { ...CTX, tier: 3, rising: true })];
  for (const k of Object.keys(flat)) assert(Math.abs(up[k] - offseason.RISING_STAY * flat[k]) < 1e-9, () => show([k, up, flat]));
});

// ----- the reason given, on a real league ------------------------------------------------------------------------

const st = season.new_season("ohio-state", "full", 7, undefined, undefined, true);
finished(st);
const off = offseason.start(st);
const lgd = st["league"];
const roster = lgd["teams"][st["team"]]["roster"];
const entrants = off["portal"]["players"];
const returning = Object.values(lgd["teams"]).reduce((a, t) => a + t["roster"].length, 0) + Object.keys(entrants).length;

/** The Keep Them Home entry of one of your players leaving through the portal. */
function entry(p, use, item = {}) {
  const ev = { id: p["id"], name: p["n"], pos: p["pos"], cls: p["cls"], kind: "portal" };
  return offseason._retention_entries(st, lgd, [{ ev, use, losing: false, winning: true, p4: true, ...item }])[0];
}
/** (the entry reads the roster row, whose class is already next year's) */
const with_cls = (p, cls) => { p["cls"] = cls; return p; };

test("across a real league the portal takes six to nine percent of returning players, and every driver shows up", () => {
  const share = Object.keys(entrants).length / returning;
  assert(share >= 0.06 && share <= 0.09, () => String(share));
  const drivers = {};
  for (const e of Object.values(entrants)) drivers[e["driver"] || "role"] = (drivers[e["driver"] || "role"] || 0) + 1;
  assert(drivers["deal"] > 0 && (drivers["slipping"] || 0) + (drivers["better_coach"] || 0) > 0, () => show(drivers));
  // the bottom tier loses more starters a school than the top
  const lost = {}, schools = {};
  for (const e of Object.values(entrants)) {
    if (e["usage"] === "starter") { const t = programs.get(st, e["from"])["tier"]; lost[t] = (lost[t] || 0) + 1; }
  }
  for (const t of Object.values(lgd["teams"])) schools[t["program"]["tier"]] = (schools[t["program"]["tier"]] || 0) + 1;
  assert((lost[5] || 0) / schools[5] > (lost[1] || 0) / schools[1], () => show([lost, schools]));
});

test("Keep Them Home is the offseason's first step, and no starter there is 'tired of waiting his turn'", () => {
  assert(off["stage"] === "retention");
  for (const e of off["retention"]["players"]) {
    assert(e["reason_key"] in offseason.REASONS && e["reason"], () => show(e));
    assert(!(e["role_now"] === "starter" && e["reason_key"] === "restless"), () => show(e));
    if (e["reason_key"] === "deal" && e["shortfall"]) assert(e["ask"]["nil"] >= e["shortfall"], "he asks at least what the market pays over your tier");
  }
});

test("a starter's reason fits a starter: a deal, his last year, or a fresh start; a losing year first", () => {
  const guards = roster.filter((q) => ["G", "OG", "RG", "LG"].includes(q["pos"]));
  const p = (guards.length ? guards : roster).reduce((a, b) => (b["o"] > a["o"] ? b : a));
  const was = p["cls"];
  try {
    for (const [cls, key, text] of [["JR", "deal", "Chasing a bigger NIL deal"], ["SO", "deal", "Chasing a bigger NIL deal"],
      ["SR", "last_year", "One year left and he wants a change"], ["SRRS", "last_year", "One year left and he wants a change"]]) {
      const e = entry(with_cls(p, cls), "starter");
      equal([e["role_now"], e["reason_key"], e["reason"]], ["starter", key, text], cls);
    }
    const even = entry(with_cls(p, "JR"), "starter", { winning: false });         // .500: neither winning nor losing
    equal([even["reason_key"], even["reason"]], ["fresh_start", "Wants a fresh start"]);
    assert(entry(with_cls(p, "JR"), "starter", { losing: true, winning: false })["reason_key"] === "losing");
  } finally {
    p["cls"] = was;
  }
});

test("what really drove him is the reason given, after the role and record stories", () => {
  const qb = roster.filter((q) => q["pos"] === "QB").reduce((a, b) => (b["o"] > a["o"] ? b : a));
  const was = qb["cls"];
  try {
    with_cls(qb, "JR");
    let e = entry(qb, "starter", { driver: "deal", shortfall: 40 });
    assert(e["reason_key"] === "deal" && e["ask"]["nil"] >= 40, () => show(e));
    e = entry(qb, "starter", { driver: "slipping" });
    equal([e["reason_key"], e["reason"]], ["slipping", "The program is slipping"]);
    e = entry(qb, "starter", { driver: "better_coach" });
    equal([e["reason_key"], e["reason"]], ["better_coach", "Wants a better coach"]);
    assert(entry(qb, "starter", { driver: "better_coach", losing: true, winning: false })["reason_key"] === "losing");
  } finally {
    qb["cls"] = was;
  }
});

test("a benched player behind someone is buried and names him; the best at his spot is only restless", () => {
  const p = roster.reduce((a, b) => (b["o"] > a["o"] ? b : a));
  const peers = roster.filter((q) => offseason.GROUP[q["pos"]] === offseason.GROUP[p["pos"]]);
  const ahead = peers.reduce((a, b) => (b["o"] > a["o"] ? b : a));
  const low = { ...p, o: 1, id: "x-bench", n: "Backup Guy" };
  const best = { ...ahead, id: "x-best", o: 999 };
  roster.push(low);
  try {
    const e = entry(low, "bench");
    equal([e["reason_key"], e["reason"]], ["buried", `Buried on the depth chart behind ${ahead["n"]}`]);
    roster.push(best);
    assert(entry(best, "bench")["reason_key"] === "restless");
  } finally {
    for (const x of [low, best]) if (roster.includes(x)) roster.splice(roster.indexOf(x), 1);
  }
});

test("the portal recap's lost players carry the reasons Keep Them Home gave", () => {
  const reasons = Object.fromEntries(off["retention"]["players"].map((x) => [x["id"], x["reason"]]));
  while (!offseason.RECAP_STAGES.includes(off["stage"])) offseason.advance(st);
  const rec = offseason._portal_recap(st);
  assert(rec !== null && rec["lost"].length > 0 && rec["lost"].every((r) => r["reason"] === (reasons[r["id"]] ?? null)), () => show(rec && rec["lost"].slice(0, 3)));
});

await run();
