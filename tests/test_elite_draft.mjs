// Elite underclassmen go to the draft. A draft-eligible underclassman rated ELITE_DECLARE (95) or better who played
// at least ELITE_MIN_GAMES games always declares and is picked; projected first-rounders almost always go. On your
// own team he still shows at Keep Them Home, where he stays only ELITE_STAY of the time whatever you offer. The
// regression: in a played career the best player in the country, a junior rated 99, drew the one-in-twenty roll not
// to declare and stayed a senior.
// `node tests/test_elite_draft.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random, sorted } from "../engine_js/pyrt.js";

const game = await start({ env: { SIM_WORKERS: "1" } });
const { season, offseason } = game;
const league = game.modules.league;

const show = (v) => JSON.stringify(v);

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

const base = league.from_base(2027);
/** Every eligible underclassman of the built-in league rated elite. */
const stars = Object.values(base["teams"]).flatMap((t) => t["roster"])
  .filter((p) => offseason.UNDERCLASS_ELIGIBLE.has(p["cls"]) && offseason.house(p["pos"], p["o"]) >= offseason.ELITE_DECLARE).map((p) => p["id"]);
/** The star of the tests: Ohio State's best eligible underclassman, the best prospect in the built-in league. */
const STAR = sorted(base["teams"]["ohio-state"]["roster"].filter((p) => stars.includes(p["id"])), (p) => -p["o"])[0]["id"];

test("the rule: 95 or better, a draft-eligible underclassman, and a season of at least the minimum games", () => {
  const p = { id: "x", pos: "WR", o: 96, cls: "JR" };
  const n = offseason.ELITE_MIN_GAMES;
  assert(offseason.elite(p, { x: n }) && offseason.elite(p, null));
  assert(!offseason.elite(p, { x: n - 1 }), "a season too short to count");
  assert(!offseason.elite({ ...p, o: offseason.ELITE_DECLARE - 1 }, { x: 12 }));
  assert(offseason.elite({ ...p, cls: "SORS" }, { x: 12 }) && offseason.elite({ ...p, cls: "JRRS" }, { x: 12 }));
  assert(!offseason.elite({ ...p, cls: "SO" }, { x: 12 }) && !offseason.elite({ ...p, cls: "SR" }, { x: 12 }), "only draft-eligible underclassmen");
  assert(offseason.DECLARE[0][1] >= 0.97 && offseason.DECLARE.find(([cut]) => 32 <= cut)[1] >= 0.95, "projected first-rounders almost always go");
});

test("over thirty drafts every elite underclassman who played declares and is picked, the best in the top three", () => {
  assert(stars.length >= 2 && stars.includes(STAR), show(stars));
  const played = {};
  for (const [slug, t] of Object.entries(base["teams"])) played[slug] = Object.fromEntries(t["roster"].map((p) => [p["id"], 12]));
  for (let seed = 0; seed < 30; seed++) {
    const [declared, drafted] = offseason.draft_board(base, new Random(`elite-${seed}`), played);
    for (const id of stars) assert(declared.has(id) && id in drafted, show([seed, id]));
    assert(drafted[STAR] <= 3, String(drafted[STAR]));
  }
  // a star who barely played is not forced, and the rule moves nobody else's decision (the same draws, the same board)
  const benched = structuredClone(played);
  for (const slug of Object.keys(benched)) for (const id of stars) delete benched[slug][id];
  const a = offseason.draft_board(base, new Random("elite-x"), benched)[0];
  const b = offseason.draft_board(base, new Random("elite-x"), played)[0];
  assert([...b].filter((id) => !a.has(id)).every((id) => stars.includes(id)), "the elite rule moved someone else's declaration");
});

test("your own elite entrant waits at Keep Them Home, nearly impossible to keep, and goes in the top three", () => {
  const st = season.new_season("ohio-state", "full", 5, undefined, undefined, true);
  finished(st);
  const off = offseason.start(st);
  const e = off["retention"]["players"].find((x) => x["id"] === STAR);
  assert(e && e["intent"] === "draft" && e["elite"] && e["draft_pick"] <= 3, show(e));
  const big = { ...e, offers: { nil: 10 ** 5, promise: true }, ask: { ...e["ask"], known: true } };
  equal(offseason.stay_chance(big), offseason.ELITE_STAY);
  equal(offseason.view(st)["retention"]["elite_stay"], offseason.ELITE_STAY);
  offseason.advance(st);
  const d = off["departures"].find((x) => x["id"] === STAR);
  assert(d["kind"] === "draft" && d["pick"] <= 3 && d["early"], show(d));
});

test("as another school's player he declares and goes too", () => {
  const st = season.new_season("smu", "full", 5, undefined, undefined, true);
  finished(st);
  const off = offseason.start(st);
  assert(!off["draft"]["ai_kept"].includes(STAR));
  off["auto"] = true;
  offseason.advance(st);
  const d = off["departures"].find((x) => x["id"] === STAR);
  assert(d["kind"] === "draft" && d["pick"] <= 3, show(d));
});

// The regression, on its seed (31). The offseason's first random draws are the draft board's, so the seed alone
// decided it: he ranked first and drew the no-declare roll. The first half of the season is played for real, so his
// games come from real box scores; the rest is made up.
test("seed 31: the old odds kept the country's best player in school; now he declares and goes first", () => {
  const st = season.new_season("smu", "full", 31, undefined, undefined, true);
  st["career"]["settings"]["auto_recruit"] = "season";
  while (((offseason._games_played(st)["ohio-state"] || {})[STAR] || 0) < offseason.ELITE_MIN_GAMES) {
    assert(st["current_week"] < 12, "he has not played the minimum by week 12");
    season.advance(st);
  }
  // the old rule on this seed: rank 1, and the roll says stay
  const lgd = structuredClone(st["league"] || league.from_base(season.season_year(st) + 1));
  const old = [offseason.DECLARE, offseason.ELITE_DECLARE];
  offseason.DECLARE = [[32, 0.95], [64, 0.88], [100, 0.65], [160, 0.35], [257, 0.12], [10 ** 9, 0.004]];
  offseason.ELITE_DECLARE = 10 ** 6;                                                         // the elite rule off
  let pool, declared;
  try { [pool, declared] = offseason.draft_scores(lgd, offseason._rng(st, "departures")); } finally { [offseason.DECLARE, offseason.ELITE_DECLARE] = old; }
  assert(pool[0][2]["id"] === STAR && !declared.has(STAR), "seed 31 no longer reproduces the old miss");
  finished(st);
  const off = offseason.start(st);
  off["auto"] = true;
  offseason.advance(st);
  const d = off["departures"].find((x) => x["id"] === STAR);
  assert(d["kind"] === "draft" && d["pick"] === 1 && d["early"], show(d));
  league.forget(st["id"]);
});

test("seed 31 as his own coach: he waits at Keep Them Home as an elite entrant and still goes first", () => {
  const st = season.new_season("ohio-state", "full", 31, undefined, undefined, true);
  finished(st);
  const off = offseason.start(st);
  const e = off["retention"]["players"].find((x) => x["id"] === STAR);
  assert(e["elite"] && e["draft_pick"] === 1, show(e));
  off["auto"] = true;
  offseason.advance(st);
  equal(off["departures"].find((x) => x["id"] === STAR)["pick"], 1);
});

await run();
