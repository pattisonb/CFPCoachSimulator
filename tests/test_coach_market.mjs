// The coaching market (career_js/carousel.js): the league keeps a pool of named coaches for hire
// (fired and let-go coaches, plus a generated supply), every opening around the league is filled from
// it or from sitting coaches, nobody holds two jobs, a coach fired this offseason sits in the pool,
// and your own openings offer the market's coaches with why each is available.
// `node tests/test_coach_market.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random, get, sorted, truthy } from "../engine_js/pyrt.js";

const game = await start();
const { season, offseason } = game;
const carousel = game.modules.carousel;

/** Every game played (the better team usually wins), every school's class signed, season over (tests/test_offseason's). */
function finished(st) {
  const rng = new Random(1);
  const teams = season.load_teams();
  for (const g of Object.values(st["games"])) {
    const h = teams[g["home"]]["team_ratings"]["overall"], a = teams[g["away"]]["team_ratings"]["overall"];
    const hs = rng.randint(10, 45);
    const win = rng.random() < 1 / (1 + Math.pow(10, (a - h) / 7));
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

function to_stage(st, stage) {
  st["offseason"]["auto"] = true;
  while (st["offseason"]["stage"] !== stage) offseason.advance(st);
}

const show = (v) => () => JSON.stringify(v);

// Your staff is in the carousel like everyone else's: a coordinator can move on for a bigger
// job (COORD_MOVE), and a strong program can hire him as its head coach; either way his job
// opens at your Staff step with the reason and five candidates.
function test_your_coordinators_can_leave() {
  // 1. moving on: with the roll certain, both your coordinators leave and the Staff step says why
  let saved = carousel.COORD_MOVE;
  carousel.COORD_MOVE = 1.0;
  let st;
  try {
    st = season.new_season("ohio-state", "full", 5, undefined, undefined, true);
    finished(st);
    offseason.start(st);
    for (const s of st["career"]["staff"]) {        // their contracts are up, so neither holds to one (test_staff_contracts has the under-contract case)
      s["contract_until"] = st["offseason"]["year"] - 1;
    }
    to_stage(st, "staff");
    const car = st["offseason"]["carousel"];
    equal([...car["poached"]].sort(), ["defensive_coordinator", "offensive_coordinator"], JSON.stringify(car["poached"]));
    const mine = car["changes"].filter((c) => c["team"] === "ohio-state" && c["role"] !== "head_coach");
    assert(mine.length && mine.every((c) => c["reason"] === "moved on" || c["reason"].startsWith("left for")), show(mine));
    const view = offseason.view(st)["staff"];
    const left = new Set(view["leaving"].map((w) => w["role"]));
    assert(left.has("OC") && left.has("DC"), show([...left]));
    for (const w of view["leaving"]) {
      if (w["role"] === "OC" || w["role"] === "DC") {
        assert(view["reasons"][w["id"]].includes("bigger job") || view["reasons"][w["id"]].includes("hired away as the head coach at"), show(view["reasons"]));
        assert(view["candidates"][w["id"]].length === offseason.STAFF_CANDIDATES);
      }
    }
  } finally {
    carousel.COORD_MOVE = saved;
  }
  // 2. hired away: your coordinator is in the candidate pool for another program's head coaching job
  st = season.new_season("ohio-state", "full", 5, undefined, undefined, true);
  finished(st);
  offseason.start(st);
  const lg = st["league"];
  const me = st["team"], year = st["offseason"]["year"];
  const res = carousel._results(st);
  Object.assign(res[me], { wins: 13, losses: 1 });
  const verdicts = {};
  for (const [slug, t] of Object.entries(lg["teams"])) verdicts[slug] = carousel.judge(t, slug, get(res, slug, { wins: 0, losses: 0 }), year, st);
  const oc = lg["teams"][me]["coaches"]["offensive_coordinator"];
  oc["ratings"] = Object.fromEntries(Object.keys(oc["ratings"]).map((k) => [k, 99]));
  saved = [carousel.HC_MOVE_PCT, carousel.COORD_UP];
  carousel.HC_MOVE_PCT = 2.0; carousel.COORD_UP = -999;          // no sitting head coach qualifies; any program may call
  let hire, src;
  try {
    [hire, src] = carousel._pick_head_coach(st, "akron", verdicts, res, {}, new Random(1), year, new Set());
  } finally {
    [carousel.HC_MOVE_PCT, carousel.COORD_UP] = saved;
  }
  assert(get(src, "kind") === "coordinator" && get(src, "team") === me && hire["name"] === oc["name"], show([hire["name"], src]));
  assert(!truthy(get(lg["teams"][me]["coaches"]["offensive_coordinator"], "vacant")));      // the pool check mutates nothing
  console.log("your coordinators can leave: gone at the Staff step with the reason; a 99 coordinator of yours is hired away");
}

test("coach_market", () => {
  const st = season.new_season("ohio-state", "full", 5, undefined, undefined, true);
  finished(st);
  const off = offseason.start(st);
  const lg = st["league"];
  // each coach's name -> the teams he is on
  const teams_of = () => {
    const out = {};
    for (const [slug, t] of Object.entries(lg["teams"])) {
      for (const c of Object.values(t["coaches"])) if (truthy(c)) (out[c["name"]] ??= new Set()).add(slug);
    }
    return out;
  };
  const two_before = new Set(Object.entries(teams_of()).filter(([, k]) => k.size > 1).map(([n]) => n));       // the real data's own doubles
  const market = carousel.market(st);
  assert(100 <= market["coaches"].length && market["coaches"].length <= 260, String(market["coaches"].length));
  for (const c of market["coaches"].slice(0, 20)) {
    assert(truthy(c["name"]) && truthy(c["roles"]) && truthy(c["ratings"]) && truthy(c["why"]) && "history" in c && c["age"] >= 30, show(c));
  }
  to_stage(st, "staff");
  const car = off["carousel"];
  const changes = car["changes"];
  const fired = changes.filter((c) => c["role"] === "head_coach" && c["reason"] === "fired").map((c) => c["old"]);
  const coord_let_go = changes.filter((c) => c["role"] !== "head_coach" && ["fired", "moved on", "let go"].includes(c["reason"])).map((c) => c["old"]);
  const names_in_market = new Set(market["coaches"].map((c) => c["name"]));
  assert(fired.length && fired.every((n) => names_in_market.has(n)), show(fired.filter((n) => !names_in_market.has(n))));
  const placed = new Set(changes.filter((c) => c["reason"] === "hired").map((c) => c["new"]));          // a let-go coordinator can land at once
  assert(coord_let_go.filter((n) => truthy(n)).every((n) => names_in_market.has(n) || placed.has(n)), show(coord_let_go.filter((n) => truthy(n) && !names_in_market.has(n) && !placed.has(n))));
  // nobody is on two staffs (a head coach calling his own plays is one job); a coach hired this
  // offseason is out of the pool
  const jobs = teams_of();
  const doubles = Object.entries(jobs).filter(([n, k]) => k.size > 1 && !two_before.has(n)).map(([n]) => n);
  assert(!doubles.length, show(doubles));
  const both = Object.keys(jobs).filter((n) => names_in_market.has(n) && !two_before.has(n));
  assert(!both.length, show(both.slice(0, 5)));
  const hires = changes.filter((c) => c["reason"] === "hired");
  assert(hires.length && hires.every((c) => truthy(get(c, "from"))), "a hire without where he came from");
  assert(hires.some((c) => c["role"] !== "head_coach" && truthy(get(c, "from_market"))), "no coordinator hired from the market");
  assert(fired.length >= 3, String(fired.length));
  // your openings offer the market: each candidate says why he is available and what he did
  const staff = off["staff"];
  if (!staff["leaving"].some((i) => i === "oc" || i === "dc")) {
    const before = carousel.market(st)["coaches"].length;
    Object.assign(staff, offseason.open_role(st, "oc"));
    assert(carousel.market(st)["coaches"].length === before + 1, "the coordinator you let go is not in the market");
  }
  const sid = staff["leaving"].find((i) => i === "oc" || i === "dc");
  const cands = staff["candidates"][sid];
  assert(cands.length >= 4 && cands.every((c) => truthy(get(c, "why")) && truthy(get(c, "previous_job"))), show(cands[0]));
  assert(cands.some((c) => truthy(get(c, "from_market"))));
  const pick = cands.findIndex((c) => truthy(get(c, "from_market")));
  offseason.hire(st, sid, pick);
  offseason.advance(st);
  const key = { oc: "offensive_coordinator", dc: "defensive_coordinator" }[sid];
  const mine = lg["teams"][st["team"]]["coaches"][key];
  assert(mine["name"] === cands[pick]["name"] && mine["since"] === off["year"] && "play_calling" in mine["ratings"], show(mine));
  assert(!carousel.market(st)["coaches"].some((c) => c["name"] === cands[pick]["name"]), "hired, still for hire");
  season.close_pool();
  console.log(`coach market ok: ${market["coaches"].length} coaches for hire, ${fired.length} head coaches fired, ${hires.length} hires`);
});

test("test_your_coordinators_can_leave", test_your_coordinators_can_leave);

await run();
