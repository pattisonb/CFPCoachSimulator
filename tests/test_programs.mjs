// The living program rating (career_js/programs.js). Every team in a career's league carries its program; each
// offseason the rating moves with results, slowly for prestige and the market, by the AD's hand for NIL; a decade of
// winning lifts a program about a tier and no more. Everything that asks how good a program is reads it: the AD's
// goal, the NIL budget, recruiting's prestige pull, development, and which jobs a sitting head coach will leave for.
// `node tests/test_programs.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random, round, sorted } from "../engine_js/pyrt.js";

const game = await start();
const { season, offseason, recruiting } = game;
const { programs, carousel } = game.modules;

const show = (v) => JSON.stringify(v);

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

const career = (seed) => season.new_season("ohio-state", "full", seed, undefined, undefined, true);

// ----- who reads the rating ---------------------------------------------------------------------------------------

const reader = career(5);

test("in a first season, before the league exists, the base values answer", () => {
  const p = programs.get(reader, "ohio-state");
  assert(p["tier"] === 1 && p["rating"] > 80 && programs.z(reader, "ohio-state") > 1.2 && programs.z(reader, "akron") < -0.8, () => show(p));
});

test("the AD's goal follows the program's tier", () => {
  assert(carousel.goal("ohio-state", reader)["kind"] === "playoff" && carousel.goal("akron", reader)["wins"] === 6);
  assert(carousel.goal("boise-state", reader)["kind"] === "conference", () => show(carousel.goal("boise-state", reader)));
});

test("the NIL budget, recruiting's prestige pull and development follow the program", () => {
  const [osu, akron] = [recruiting.nil_budget(reader, "ohio-state"), recruiting.nil_budget(reader, "akron")];
  assert(osu === Math.max(recruiting.NIL_FLOOR, round(recruiting.NIL_PER_TIER * programs.get(reader, "ohio-state")["nil"])) && osu > 2 * akron, () => show([osu, akron]));
  const pid = Object.keys(reader["recruiting"]["prospects"])[0];
  assert(recruiting.pull(reader, "ohio-state", pid)["prestige"] > 0.85 && recruiting.pull(reader, "akron", pid)["prestige"] < 0.35);
  const [top, low] = [offseason.program_factor(reader, "ohio-state"), offseason.program_factor(reader, "akron")];
  assert(top > 1.3 && 1.3 > low && low > 0.6, () => show([top, low]));
});

test("once the league exists the goal and the budget read its living values", () => {
  finished(reader);
  offseason.start(reader);
  const p = reader["league"]["teams"]["ohio-state"]["program"];
  const kept = { tier: p["tier"], rating: p["rating"], nil: p["nil"] };
  Object.assign(p, { tier: 3, rating: 55.0, nil: 40.0 });
  try {
    assert(carousel.goal("ohio-state", reader)["wins"] === 8, () => show(carousel.goal("ohio-state", reader)));
    assert(recruiting.nil_budget(reader, "ohio-state") === Math.max(recruiting.NIL_FLOOR, round(recruiting.NIL_PER_TIER * 40.0)));
  } finally {
    Object.assign(p, kept);
  }
});

test("a sitting head coach leaves only for a clearly better job, and the carousel moves every program a year on", () => {
  const off = reader["offseason"];
  // as the jobs stood before anyone moved: read when the carousel first weighs a job, once this year's program update
  // and the ADs' NIL moves have run
  let attract = null;
  const weigh = carousel.attract;
  carousel.attract = (st, slug) => {
    attract ??= Object.fromEntries(Object.keys(reader["league"]["teams"]).map((s) => [s, weigh(st, s)]));
    return weigh(st, slug);
  };
  off["auto"] = true;
  try {
    while (off["stage"] !== "staff") offseason.advance(reader);
  } finally {
    carousel.attract = weigh;
  }
  assert(attract !== null, "the carousel did not update the programs");
  const changes = off["carousel"]["changes"];
  const names = Object.fromEntries(Object.entries(season.load_teams()).map(([s, t]) => [t["name"], s]));
  const moves = changes.filter((c) => c["role"] === "head_coach" && c["reason"].startsWith("left for ") && c["reason"] !== "left for the NFL");
  assert(moves.length, "no sitting head coach moved");
  for (const c of moves) {
    const to = names[c["reason"].slice("left for ".length)];
    assert(to, c["reason"]);
    assert(attract[to] >= attract[c["team"]] + carousel.MOVE_UP, () => show([c["team"], to, attract[c["team"]], attract[to]]));
  }
  assert(changes.filter((c) => c["reason"] === "hired" && c["role"] === "head_coach").every((c) => c["tier"]));
  // the update ran as part of the carousel
  assert(Object.values(reader["league"]["teams"]).every((t) => t["program"]["year"] === off["year"]));
});

test("the program list is every FBS program, best first, with its tier, goal and Pro Pipeline", () => {
  const rows = programs.rows(reader);
  assert(rows.length >= 130 && rows.every((r, i) => i === 0 || r["rating"] <= rows[i - 1]["rating"]));
  for (const r of rows) {
    for (const k of ["name", "tier", "tier_name", "goal", "pro"]) assert(k in r, k);
    assert(r["pro_groups"] !== null && typeof r["pro_groups"] === "object");
  }
});

test("a grade is a letter by its number, A+ to F, and every row carries its own", () => {
  equal([programs.word_of(97), programs.word_of(92), programs.word_of(80), programs.word_of(69.9), programs.word_of(60), programs.word_of(29), programs.word_of(24.9)],
    ["A+", "A", "A-", "B", "B-", "D-", "F"]);
  const row = programs.rows(career(1))[0];
  for (const k of ["prestige", "winning", "nil", "market", "conference", "coach", "pro"]) equal(row["letters"][k], programs.word_of(row[k]));
  for (const [k, v] of Object.entries(row["grades"] || {})) equal(row["letters"][k], programs.word_of(v));
  equal(Object.keys(row["letters"]["pro_groups"]), programs.PRO_GROUP_ORDER, "every draft position has its letter (one never sent: an F)");
});

// ----- how it moves -----------------------------------------------------------------------------------------------

const st = career(3);
finished(st);
const off = offseason.start(st);
const lgd = st["league"];
const before = Object.fromEntries(Object.entries(lgd["teams"]).map(([s, t]) => [s, { ...t["program"] }]));
offseason._run_draft(st);                                      // the draft has run by the Staff step
const res = carousel._results(st);
const ranks = programs.final_ranks(st);

test("every team in the league carries its program", () => {
  const keys = ["history", "prestige", "winning", "market", "market_base", "nil", "conference", "coach", "rating", "tier", "seasons"];
  for (const [s, p] of Object.entries(before)) for (const k of keys) assert(k in p, `${s} has no ${k}`);
  assert(Object.keys(ranks).length >= 25 && Math.min(...Object.values(ranks).filter((r) => r !== null)) >= 1);
});

test("a year's results move prestige and the market by a step at most, and the rating is the mix of its parts", () => {
  programs.update(st, res, ranks);
  for (const [s, t] of Object.entries(lgd["teams"])) {
    const [p, b] = [t["program"], before[s]];
    assert(Math.abs(p["prestige"] - b["prestige"]) <= programs.PRESTIGE_STEP + 1e-9, () => show([s, p["prestige"], b["prestige"]]));
    assert(Math.abs(p["market"] - b["market"]) <= programs.MARKET_STEP + programs.NEW_COACH_LIFT + 1e-9, s);
    assert(p["winning"] >= 0 && p["winning"] <= 100 && p["seasons"].length === 1 && p["seasons"].at(-1)[0] === off["year"] - 1, s);
    assert(Math.abs(round(programs.mix(p), 1) - p["rating"]) < 0.11 && p["tier"] === programs.tier_of(p["rating"]) && p["year"] === off["year"], s);
  }
  assert(lgd["teams"][st["champion"]]["program"]["winning"] >= 60);
});

test("the update runs once a year: a second run adds nothing", () => {
  const snap = JSON.stringify(Object.fromEntries(Object.entries(lgd["teams"]).map(([s, t]) => [s, t["program"]])));
  programs.update(st, res, ranks);
  programs.update(st, res, ranks, off["year"]);
  assert(JSON.stringify(Object.fromEntries(Object.entries(lgd["teams"]).map(([s, t]) => [s, t["program"]]))) === snap);
});

test("the Pro Pipeline counts the draft's picks over a rolling decade", () => {
  const picks = programs.draft_picks(st);
  assert(Object.values(picks).reduce((a, v) => a + v.length, 0) >= 150);
  for (const [s, t] of Object.entries(lgd["teams"])) {
    const p = t["program"];
    assert(p["drafts"].length === programs.PRO_YEARS && p["drafts"].at(-1)[0] === off["year"] - 1 && p["drafts"][0][0] === off["year"] - programs.PRO_YEARS, s);
    assert(p["drafts"].at(-1)[1] === (picks[s] || []).reduce((a, [r]) => a + programs.pick_points(r), 0), s);
    assert(p["pro"] >= 0 && p["pro"] <= 100 && Object.values(p["pro_groups"]).every((v) => v >= 0 && v <= 100), s);
  }
  // ten empty drafts take a factory to the floor
  const p = structuredClone(lgd["teams"]["alabama"]["program"]);
  for (let y = off["year"]; y < off["year"] + programs.PRO_YEARS; y++) p["drafts"] = [...p["drafts"].slice(1), [y, 0, {}]];
  programs.pro_recompute(p, off["year"] + programs.PRO_YEARS);
  equal([p["pro"], p["pro_groups"]], [0, {}]);
  // a pick at a position the game does not know is skipped, not a crash
  const n = (programs.draft_picks(st)["akron"] || []).length;
  st["offseason"]["departures"].push({ id: "x", team: "akron", kind: "draft", pos: "???", round: 1 });
  assert((programs.draft_picks(st)["akron"] || []).length === n);
  st["offseason"]["departures"].pop();
});

test("a save from before the Pro Pipeline keeps the program's real decade", () => {
  const q = lgd["teams"]["akron"]["program"], b0 = programs.base("akron");
  const kept = structuredClone(q);
  for (const k of ["drafts", "pro", "pro_groups"]) delete q[k];
  q["year"] = off["year"] - 1;
  programs.init(lgd);
  assert(q["drafts"].length === programs.PRO_YEARS && q["pro"] === b0["pro"]);
  equal(q["pro_groups"], b0["pro_groups"]);
  equal(q["drafts"], b0["drafts"]);
  assert(q["drafts"] !== b0["drafts"], "a copy: the league never writes into the base");
  for (const k of ["drafts", "pro", "pro_groups"]) delete q[k];
  programs.update(st, res, ranks, off["year"], ["akron"]);
  assert(q["drafts"].length === programs.PRO_YEARS && typeof q["pro_groups"] === "object");
  equal(q["drafts"].at(-2), b0["drafts"].at(-1));
  // the list reads a league whose programs lack the three keys
  const stripped = { ...st, league: { ...lgd, teams: Object.fromEntries(Object.entries(lgd["teams"]).map(([s, t]) => {
    const { drafts, pro, pro_groups, ...rest } = t["program"];
    return [s, { ...t, program: rest }];
  })) } };
  const rows = programs.rows(stripped);
  assert(rows.length && rows.every((r) => "pro" in r && typeof r["pro_groups"] === "object"));
  assert(rows.find((r) => r["team"] === "alabama")["pro"] === programs.base("alabama")["pro"]);
  lgd["teams"]["akron"]["program"] = kept;
});

test("the offseason's look ahead at tiers leaves every program as it was", () => {
  for (const t of Object.values(lgd["teams"])) t["program"]["year"] = off["year"] - 1;
  const snap = JSON.stringify(Object.fromEntries(Object.entries(lgd["teams"]).map(([s, t]) => [s, t["program"]])));
  const shifts = offseason.program_shifts(st, lgd);
  assert(JSON.stringify(Object.fromEntries(Object.entries(lgd["teams"]).map(([s, t]) => [s, t["program"]]))) === snap);
  assert(Object.keys(shifts).length === Object.keys(lgd["teams"]).length && Object.values(shifts).every(Number.isInteger));
  for (const t of Object.values(lgd["teams"])) t["program"]["year"] = off["year"];
});

test("NIL moves by the AD's hand: up after a goal met, more after a surprise playoff, down after a losing year", () => {
  const team = structuredClone(lgd["teams"]["ohio-state"]);
  team["program"]["nil"] = 60.0;
  programs.nil_move(team, true, false);
  assert(team["program"]["nil"] === 60.0 + programs.NIL_UP);
  team["program"]["nil"] = 60.0;
  programs.nil_move(team, true, false, true);
  assert(team["program"]["nil"] === 60.0 + programs.NIL_PLAYOFF_UP && programs.NIL_PLAYOFF_UP > programs.NIL_UP);
  team["program"]["nil"] = 95.0;
  programs.nil_move(team, false, true);
  assert(team["program"]["nil"] === 95.0 - programs.NIL_DOWN);
});

test("ten winning years lift a middling program about a tier, ten losing years drop a blue blood about one, no more", () => {
  const riser = ["kansas-state", "iowa", "utah", "missouri", "tcu", "wisconsin"].reduce((a, s) => (lgd["teams"][s]["program"]["winning"] < lgd["teams"][a]["program"]["winning"] ? s : a));
  const faller = "alabama";
  const [r0, f0] = [{ ...lgd["teams"][riser]["program"] }, { ...lgd["teams"][faller]["program"] }];
  for (let k = 0; k < 10; k++) {
    const year = off["year"] + 1 + k;
    for (const s of [riser, faller]) lgd["teams"][s]["program"]["year"] = year - 1;
    const results = Object.fromEntries(Object.keys(lgd["teams"]).map((s) => {
      const w = s === riser ? 12 : s === faller ? 2 : 7;
      return [s, { wins: w, losses: 12 - w, conference: s === riser, playoff: s === riser, title: false }];
    }));
    programs.update(st, results, { [riser]: 3, [faller]: null }, year, [riser, faller]);
    programs.nil_move(lgd["teams"][riser], true, false);
    programs.nil_move(lgd["teams"][faller], false, true);
  }
  const [r1, f1] = [lgd["teams"][riser]["program"], lgd["teams"][faller]["program"]];
  const d = (a, b, k) => a[k] - b[k];
  assert(d(r1, r0, "prestige") >= 8 && d(r1, r0, "prestige") <= 25 && d(r1, r0, "market") >= 5 && d(r1, r0, "market") <= 20, () => show([riser, r0, r1]));
  assert(d(f1, f0, "prestige") >= -25 && d(f1, f0, "prestige") <= -6 && d(f1, f0, "market") >= -15 && d(f1, f0, "market") <= -3, () => show([f0, f1]));
  assert(r1["rating"] > r0["rating"] + 8 && f1["rating"] < f0["rating"] - 6 && f1["tier"] >= 2);
  assert(r1["tier"] <= r0["tier"] - 1 || r1["rating"] >= 65, () => show([r0["tier"], r1["tier"], r1["rating"]]));
});

await run();
