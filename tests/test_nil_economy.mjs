// The NIL economy (career_js/recruiting/part2.js, career_js/offseason/): the portal runs on this season's money. Each
// school's portal pool is what it had left of the year's budget plus a reward for the season it had, never less than
// the collective's portal fund (PORTAL_FLOOR of the budget); keeping players home spends from that pool; what is
// unspent after the portal carries into next year's budget, capped by the program's tier, and is applied once. Saves
// from before the pool open the offseason and the portal all the same.
// `node tests/test_nil_economy.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random, get, sorted, floordiv } from "../engine_js/pyrt.js";

const game = await start();
const { season, recruiting, offseason } = game;
const { prospects, programs } = game.modules;

const ME = "ohio-state";
const J = (v) => () => JSON.stringify(v);
const five = recruiting._five;
const facts = (more = {}) => ({ wins: 7, losses: 5, conference: false, playoff: false, title: false, met: false, ...more });

/** Every game played, every school's class signed, the season over (as tests/test_portal_recap.mjs ends one). */
function finished(st) {
  const rng = new Random(1);
  const teams = season.load_teams();
  for (const g of Object.values(st["games"])) {
    const h = teams[g["home"]]["team_ratings"]["overall"], a = teams[g["away"]]["team_ratings"]["overall"];
    const hs = rng.randint(10, 45);
    const win = rng.random() < 1 / (1 + Math.pow(10, (a - h) / 12));
    Object.assign(g, { played: true, home_score: win ? hs : Math.max(0, hs - rng.randint(1, 20)), away_score: win ? hs - rng.randint(1, 20) : hs });
    if (g["home_score"] === g["away_score"]) g["home_score"] += 3;
  }
  const rc = st["recruiting"];
  const schools = Object.keys(teams).filter((s) => !teams[s]["fictional"]);
  sorted(Object.keys(rc["prospects"]), (p) => rc["prospects"][p]["rank"]).slice(0, schools.length * 21)
    .forEach((pid, i) => { rc["status"][pid]["signed"] = schools[i % schools.length]; });
  Object.assign(st, { done: true, current_week: season.FINAL_WEEK, champion: ME });
}

function refused(fn, words = "") {
  try {
    fn();
  } catch (e) {
    if (!(e instanceof offseason.RetentionError)) throw e;
    assert(e.code === 400 && e.message.includes(words), `${e.code} ${e.message}`);
    return;
  }
  throw new Error(`not refused: ${words}`);
}

test("the reward table: each line of a good season adds a share of the budget, capped, in fives", () => {
  const B = 200, reward = recruiting.reward;
  assert(reward(B, facts({ wins: 5, losses: 7 })) === 0);
  assert(reward(B, facts()) === 20, "a winning record: 10%");
  assert(reward(B, facts({ wins: 9, losses: 3 })) === 40, "nine wins is 20%, in place of the winning record's 10%");
  assert(reward(B, facts({ conference: true })) === 40 && reward(B, facts({ met: true })) === 40);
  assert(reward(B, facts({ wins: 5, losses: 7, met: true })) === 20, "a losing team keeps the lines that apply");
  assert(reward(135, facts()) === five(13.5), "rounded to fives");
  assert(recruiting.REWARD_CAP === 0.5 && recruiting.PORTAL_FLOOR === 0.3);
  equal(recruiting.CARRY_CAP, { 1: 0.15, 2: 0.20, 3: 0.25, 4: 0.30, 5: 0.30 });
  const why = recruiting.reward_why(facts({ wins: 9, losses: 3, conference: true, met: true }));
  assert(why.length === 3 && why.every((w) => typeof w === "string" && w), J(why));
  equal(recruiting.reward_why(facts({ wins: 5, losses: 7 })), []);
});

test("a playoff run pays a small collective real money: the flat points are the least it earns", () => {
  const B = 200, reward = recruiting.reward;
  equal(recruiting.REWARD_FLAT, { playoff: 75, host: 50, title: 100 });
  assert(reward(B, facts({ playoff: true })) === 75, "the playoff's share would be 20: its flat 75");
  assert(reward(B, facts({ title: true })) === 100);
  assert(reward(B, facts({ wins: 14, losses: 1, conference: true, playoff: true, title: true, met: true })) === 175, "the shares cap at 50%: the flat 75 + 100 win");
  assert(reward(B, facts({ playoff: true, host: true })) === 125 && reward(500, facts({ playoff: true, host: true })) === 150, "30% of 500: the shares win");
  assert(reward(60, facts({ wins: 10, losses: 3, conference: true, playoff: true, met: true })) === 75);
  assert(reward(60, facts({ wins: 11, losses: 3, conference: true, playoff: true, host: true, met: true })) === 125);
  assert(reward(60, facts({ wins: 13, losses: 1, conference: true, playoff: true, host: true, title: true, met: true })) === 225);
  assert(reward(60, facts({ wins: 10, losses: 3, conference: true, met: true })) === 25, "no playoff: the shares alone");
  assert(recruiting.reward_why(facts({ playoff: true, host: true })).some((w) => w.includes("hosted a playoff game")));
});

const st = season.new_season(ME, "full", 5, undefined, undefined, true);
finished(st);
const base = Object.fromEntries(Object.keys(season.load_teams()).map((s) => [s, recruiting.nil_budget(st, s)]));
let off, pools, pool_me, carry, tiers, t1, t5, small;

test("the offseason seeds every school's pool: what was left plus the reward, never under the floor", () => {
  const sf = offseason.season_facts(st);
  // a school that spent everything on its class and lost enters the portal with exactly the floor
  const loser = Object.keys(base).find((s) => s !== ME && s in sf && sf[s]["wins"] < sf[s]["losses"] && !["conference", "playoff", "title", "met"].some((k) => sf[s][k]));
  st["recruiting"]["nil"][loser] = { budget: 0, held: {} };
  const pp = recruiting.portal_pool(st, loser, facts({ wins: 3, losses: 9 }));
  assert(pp["left"] === 0 && pp["reward"] === 0 && pp["floor"] === five(0.3 * base[loser]) && pp["pool"] === pp["floor"], J(pp));
  off = offseason.start(st);
  pools = st["nil_pool"];
  equal(new Set(Object.keys(pools)), new Set(Object.keys(st["league"]["teams"])), "every school has a pool");
  const flat = Object.values(recruiting.REWARD_FLAT).reduce((a, b) => a + b, 0);
  for (const [s, p] of Object.entries(pools)) {
    for (const k of ["left", "reward", "reward_why", "floor", "pool", "retained", "record"]) assert(k in p, `${s} ${k}`);
    assert(p["floor"] === five(recruiting.PORTAL_FLOOR * base[s]) && p["pool"] === Math.max(p["floor"], p["left"] + p["reward"]), J([s, p]));
    assert(p["pool"] % 5 === 0 && p["retained"] === 0 && p["reward"] >= 0 && p["reward"] <= Math.max(five(recruiting.REWARD_CAP * base[s]), flat));
    assert(!sf[s]["host"] || sf[s]["playoff"], "only a playoff team hosts");
  }
  assert(pools[loser]["pool"] === pools[loser]["floor"] && pools[loser]["reward"] === 0);
  // the review shows your pool's math, and the class budget is the tier's number with nothing taken off it
  const rv = offseason.view(st)["review"], mine = offseason.season_facts(st)[ME];
  equal(rv["nil_portal"], pools[ME]);
  assert(pools[ME]["reward"] === recruiting.reward(base[ME], facts({
    wins: rv["record"][0], losses: rv["record"][1], conference: mine["conference"], playoff: mine["playoff"], host: mine["host"],
    title: st["champion"] === ME, met: rv["met"],
  })));
  assert(recruiting.nil_budget(st, ME) === Math.max(recruiting.NIL_FLOOR, five(recruiting.NIL_PER_TIER * programs.get(st, ME)["nil"])));
});

test("keeping players home spends from the pool; an ask past it, or a negative one, is refused", () => {
  assert(off["stage"] === "retention");
  pool_me = pools[ME]["pool"];
  const view = offseason.view(st)["retention"];
  assert(view["budget"] === pool_me && view["left"] === pool_me);
  const p0 = off["retention"]["players"].find((e) => e["intent"] === "portal");
  offseason.retain(st, p0["id"], "meet");
  refused(() => offseason.retain(st, p0["id"], "nil", pool_me + 5), "not enough NIL");
  refused(() => offseason.retain(st, p0["id"], "nil", -5));
  const offer = Math.min(pool_me, Math.max(5, p0["ask"]["nil"]));
  offseason.retain(st, p0["id"], "nil", offer);
  assert(offseason.view(st)["retention"]["left"] === pool_me - offer);
  offseason.advance(st);
  assert(off["stage"] === "departures");
  offseason.advance(st);
  assert(off["stage"] === "portal_w1");
  const stayed = off["retention"]["results"].find((r) => r["id"] === p0["id"])["status"] === "stayed";
  assert(pools[ME]["retained"] === (stayed ? offer : 0) && off["retention"]["spent"] === pools[ME]["retained"], "you pay only for a player who stays");
});

test("the portal's budget is the pool less what retention spent, for you and every other school", () => {
  assert(recruiting.is_portal(st));
  const mine = recruiting._nil(st, ME);
  assert(mine["budget"] === pool_me - pools[ME]["retained"] && mine["budget"] >= 0);
  equal(mine["held"], {});
  for (const s of Object.keys(pools).slice(0, 5)) assert(recruiting._nil(st, s)["budget"] === pools[s]["pool"] - pools[s]["retained"], s);
  const nil = prospects.recruiting_view(st)["nil"];
  assert(nil["pool"] === mine["budget"] && nil["budget"] === mine["budget"] && nil["carry"] === null, J(nil));
});

test("what is unspent after the portal carries over, capped by the program's tier, in fives", () => {
  while (off["stage"] !== "portal_w4") offseason.advance(st);
  tiers = Object.fromEntries(Object.keys(pools).map((s) => [s, programs.get(st, s)["tier"]]));
  t1 = Object.keys(pools).find((s) => tiers[s] === 1 && s !== ME);
  t5 = Object.keys(pools).find((s) => tiers[s] === 5);
  small = Object.keys(pools).find((s) => ![t1, t5, ME].includes(s));
  for (const s of [t1, t5]) Object.assign(recruiting._nil(st, s), { budget: 10000, held: {} });      // a champion's pool, nothing spent: the cap holds
  Object.assign(recruiting._nil(st, small), { budget: 5, held: {} });
  offseason.advance(st);
  assert(off["stage"] === "portal_recap", "the portal is shut: its recap has the screen first");
  offseason.advance(st);
  assert(off["stage"] === "development");
  carry = st["nil_carry"];
  equal(new Set(Object.keys(carry)), new Set(Object.keys(pools)));
  for (const [s, c] of Object.entries(carry)) {
    const cap = five(recruiting.CARRY_CAP[tiers[s]] * recruiting.nil_budget(st, s));
    assert(c === Math.max(0, Math.min(5 * floordiv(pools[s]["unspent"], 5), cap)) && c % 5 === 0, J([s, c, pools[s]]));
  }
  assert(carry[t1] === five(0.15 * recruiting.nil_budget(st, t1)) && carry[t1] < 10000);
  assert(carry[t5] === five(0.30 * recruiting.nil_budget(st, t5)) && carry[t5] < 10000);
  assert(carry[small] === 5 && pools[small]["unspent"] === 5 && pools[t1]["carry"] === carry[t1]);
  assert(["spent", "signed", "ai_spent"].every((k) => k in off["portal_nil"]));
  // the class's own NIL records are back, not the portal's
  assert(!recruiting.is_portal(st) && recruiting._nil(st, t1)["budget"] !== 10000);
});

test("the carry is added to next year's budget once; a save reloaded mid-offseason does not double it", () => {
  const saved = JSON.parse(JSON.stringify(st));
  for (const s of [st, saved]) while (s["offseason"]["stage"] !== "ready") offseason.advance(s);
  const next = offseason.next_season(st), next2 = offseason.next_season(saved);
  assert(!("nil_pool" in next));
  const mine = carry[ME];
  for (const s of [t1, t5, small]) {
    const budget = recruiting.nil_budget(next, s), rec = recruiting._nil(next, s);
    assert(rec["budget"] === budget + carry[s] && rec["carry"] === carry[s], J([s, rec, budget, carry[s]]));
    assert(recruiting._nil(next, s)["budget"] === budget + carry[s], "applied twice");
    assert(!(s in next["nil_carry"]), "the carry was not cleared when it was used");
    assert(recruiting._nil(next2, s)["budget"] === budget + carry[s], "the reloaded save differs");
  }
  assert(recruiting.nil_left(next, t1) === recruiting.nil_budget(next, t1) + carry[t1]);
  const nil = prospects.recruiting_view(next)["nil"];
  assert(nil["carry"] === mine && nil["pool"] === null && nil["base"] === recruiting.nil_budget(next, ME) && nil["budget"] === nil["base"] + mine, J(nil));
});

test("a save from before the pool opens the offseason and the portal", () => {
  const st2 = season.new_season(ME, "full", 6, undefined, undefined, true);
  finished(st2);
  const off2 = offseason.start(st2);
  delete st2["nil_pool"];
  delete st2["nil_carry"];
  assert(offseason.view(st2)["retention"]["budget"] > 0);
  assert(st2["nil_pool"][ME]["pool"] >= st2["nil_pool"][ME]["floor"], "the pool is worked out when it is first asked for");
  offseason.advance(st2);
  offseason.advance(st2);
  assert(off2["stage"] === "portal_w1" && recruiting._nil(st2, ME)["budget"] > 0);
  delete st2["nil_pool"];
  st2["recruiting"]["nil"] = {};
  const b = recruiting._nil(st2, "akron")["budget"];
  assert(b > 0 && b === st2["nil_pool"]["akron"]["pool"] - st2["nil_pool"]["akron"]["retained"]);
  assert(offseason.view(st2)["review"]["nil_portal"]["pool"] === st2["nil_pool"][ME]["pool"]);
  offseason.run_all(st2);
  const next = offseason.next_season(st2);
  assert(recruiting._nil(next, ME)["budget"] >= recruiting.nil_budget(next, ME));
});

await run();
