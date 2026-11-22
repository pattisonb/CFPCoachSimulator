// Your depth chart defaults to overall every season (coach_career/league.py lineup with
// by_overall for your team, built into the season's teams file at next_season): two seasons into
// a career every role of your chart is in overall order (ties by name), the season's overrides
// and redshirts did not carry over, a stale override naming a departed player is ignored, and a
// move you make still pins the player.
// `node tests/test_depth_default.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random, sorted, cmp, get, truthy } from "../engine_js/pyrt.js";

const game = await start();
const { season, recruiting, offseason } = game;

/** Every game played (the better team usually wins), every school's class signed, season over (tests/test_offseason's). */
function finished(st) {
  const rng = new Random(1);
  const teams = season.load_teams();
  for (const g of Object.values(st["games"])) {
    const h = teams[g["home"]]["team_ratings"]["overall"], a = teams[g["away"]]["team_ratings"]["overall"];
    const hs = rng.randint(10, 45);
    const win = rng.random() < 1 / (1 + Math.pow(10, (a - h) / 12));
    const home_score = win ? hs : Math.max(0, hs - rng.randint(1, 20));
    const away_score = win ? hs - rng.randint(1, 20) : hs;
    Object.assign(g, { played: true, home_score, away_score });
    if (g["home_score"] === g["away_score"]) g["home_score"] += 3;
  }
  const rc = st["recruiting"];
  const schools = Object.keys(teams).filter((s) => !teams[s]["fictional"]);
  const pids = sorted(Object.keys(rc["prospects"]), (p) => rc["prospects"][p]["rank"]);
  pids.slice(0, schools.length * 21).forEach((pid, i) => { rc["status"][pid]["signed"] = schools[i % schools.length]; });
  Object.assign(st, { done: true, current_week: season.FINAL_WEEK, champion: "ohio-state" });
}

/** finished(), with each school's 21 signed by need as real recruiting does: the best prospect
 *  left goes to the next school (in turn) with an open spot at his roster group, then to any
 *  school with room once no school needs him. */
function finished_by_need(st) {
  finished(st);
  const rc = st["recruiting"];
  const teams = season.load_teams();
  const schools = Object.keys(teams).filter((s) => !teams[s]["fictional"]);
  for (const s_ of Object.values(rc["status"])) s_["signed"] = null;
  recruiting.reset_caches();                  // signings set by hand: the cached counts are stale
  const need = Object.fromEntries(schools.map((s) => [s, recruiting.needs(st, s)]));
  const room = Object.fromEntries(schools.map((s) => [s, 21]));
  let turn = 0;
  for (const pid of sorted(Object.keys(rc["prospects"]), (p) => rc["prospects"][p]["rank"])) {
    if (!schools.some((s) => room[s])) break;
    const g = recruiting._group_of(rc["prospects"][pid]);
    const order = [...schools.slice(turn), ...schools.slice(0, turn)];
    const to = order.find((s) => room[s] && get(need[s], g, 0) > 0) || order.find((s) => room[s]);
    rc["status"][pid]["signed"] = to;
    room[to] -= 1;
    need[to][g] = get(need[to], g, 0) - 1;
    turn = (schools.indexOf(to) + 1) % schools.length;
  }
  recruiting.reset_caches();
}

function roll(st) {
  finished_by_need(st);
  offseason.start(st);
  st["offseason"]["auto"] = true;
  offseason.run_all(st);
  return offseason.next_season(st);
}

function role_orders(team) {
  const out = {};
  for (const p of [...team["offense"], ...team["defense"]]) {
    if (truthy(get(p, "role"))) (out[p["role"]] ??= []).push(p);
  }
  for (const [role, ps] of Object.entries(out)) out[role] = sorted(ps, (p) => p["depth"]);
  return out;
}

test("depth default", () => {
  const st = season.new_season("ohio-state", "full", 5, undefined, undefined, true);
  const me = st["team"];
  let t = season.load_teams()[me];
  const wrs = t["offense"].filter((p) => get(p, "role") === "WR");
  season.move_depth(st, me, "WR", wrs.at(-1)["slug"], "top");           // a season-one override, with a slug that may leave
  season.redshirt_toggle(st, me, [...t["offense"], ...t["defense"]].find((p) => get(p, "class") === "FR" && !truthy(get(p, "in_game")))["slug"], true);
  const fresh = roll(st);
  const new2 = roll(fresh);
  assert(new2["year"] === st["year"] + 2);
  assert(!truthy(get(new2, "depth")) && !truthy(get(new2, "redshirting")), "last season's overrides or redshirts carried into the new season");
  // every role by overall, ties by name, and the starters are the top of each role
  t = season.load_teams()[me];
  const orders = role_orders(t);
  assert(Object.keys(orders).length >= 19, () => JSON.stringify(Object.keys(orders).sort()));
  for (const [role, ps] of Object.entries(orders)) {
    const keys = ps.map((p) => [-season.shown_overall(p), p["name"]]);
    equal(keys, sorted(keys), JSON.stringify([role, ps.map((p) => [p["name"], season.shown_overall(p)])]));
    const n = ps.filter((p) => truthy(get(p, "in_game"))).length;
    assert(ps.slice(0, n).every((p) => truthy(get(p, "in_game"))) && !ps.slice(n).some((p) => truthy(get(p, "in_game"))), role);
  }
  const view = season.depth_chart_view(new2, me);
  for (const u of view["units"]) {
    for (const r of u["rows"]) {
      if (r["role"] === "KR" || r["role"] === "PR") continue;
      const ovr = r["players"].map((c) => c["overall"]);
      equal(ovr, [...ovr].sort((a, b) => cmp(b, a)), JSON.stringify([r["role"], ovr]));
    }
  }
  assert(!truthy(view["overridden"]));
  // a stale override (a player who left) is ignored; the one still here is pinned where you put him
  const wr = orders["WR"];
  new2["depth"] = { [me]: { WR: ["someone-who-graduated", wr[2]["slug"]] } };
  let order = season.depth_order(new2, me, "WR");
  assert(order[0] === wr[2]["slug"] && !order.includes("someone-who-graduated"), () => JSON.stringify(order));
  equal(order.slice(1), wr.filter((p) => p["slug"] !== wr[2]["slug"]).map((p) => p["slug"]), "the rest fall in by overall");
  new2["depth"] = {};
  // a move you make still pins, everyone else by overall
  const qb = orders["QB"];
  season.move_depth(new2, me, "QB", qb.at(-1)["slug"], "top");
  order = season.depth_order(new2, me, "QB");
  assert(order[0] === qb.at(-1)["slug"], () => JSON.stringify(order));
  equal(order.slice(1), qb.slice(0, -1).map((p) => p["slug"]));
  const chart = Object.fromEntries(season.depth_chart_view(new2, me)["units"].flatMap((u) => u["rows"].map((r) => [r["role"], r["players"]])));
  assert(chart["QB"][0]["slug"] === qb.at(-1)["slug"] && chart["QB"][0]["starter"]);
  // the CPU staffs still pick by their own eye (overall, experience and what the numbers miss)
  const other = role_orders(season.load_teams()["georgia"]);
  const eye = Object.values(other).filter((ps) => {
    const o = ps.map((p) => season.shown_overall(p));
    return JSON.stringify(o) !== JSON.stringify([...o].sort((a, b) => cmp(b, a)));
  }).length;
  assert(eye > 0, "a CPU team's chart is a plain overall sort");
  season.close_pool();
  console.log(`depth default ok: ${new2["year"]} ${me} every role by overall (${Object.keys(orders).length} roles), overrides and redshirts cleared, pins hold; georgia's eye differs in ${eye} roles`);
});

await run();
