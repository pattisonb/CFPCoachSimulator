// Promises judged all season (docs/superpowers/plans/2026-11-11-promises-judged-all-season.md). Task 1: the score,
// the bands and the chip on synthetic week lists.
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random, round, sum, sorted, get, json_dumps } from "../engine_js/pyrt.js";

const game = await start();
const { season, offseason } = game;
const pr = game.modules.promises;

const same = (a, b) => { try { equal(a, b); return true; } catch { return false; } };
const show = (v) => JSON.stringify(v);
const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);

/** 12 weeks; `started` the week numbers (1-12) he started, `big` the big games, `injured` the weeks he was hurt. */
function weeks(started, big = [], injured = []) {
  return range(1, 13).map((w) => ({ week: w, started: started.includes(w), injured: injured.includes(w), big: big.includes(w) }));
}

function weighted(ws, late = null) {
  late = late === null ? pr.LATE_WEIGHT : late;
  const counted = ws.filter((w) => !w["injured"]);
  const n = counted.length;
  const wt = range(0, n).map((i) => 1 + late * i / (n - 1) * 1);
  return round(sum(wt.filter((x, i) => counted[i]["started"])) / sum(wt), 3);
}

function test_second_half_mostly_kept() {
  const ws = weeks(range(7, 13));
  const s = pr.score(ws, "WR", "business");
  assert(s === weighted(ws), show([s, weighted(ws)]));
  assert(pr.band(s, "business") === "kept", s);
}

function test_lost_the_job_reads_worse() {
  const late = pr.score(weeks(range(7, 13)), "WR", "business");
  const early = pr.score(weeks(range(1, 7)), "WR", "business");
  assert(early < late && pr.band(early, "business") !== "kept", show([early, late]));
}

function test_big_game_bench_hits() {
  const sat_big = weeks(range(1, 12), [12]);
  const sat_plain = weeks(range(1, 12));
  assert(pr.score(sat_big, "WR", "business") < pr.score(sat_plain, "WR", "business"));
  assert(pr.benched_big(sat_big) && !pr.benched_big(sat_plain));
}

function test_qb_bench_counts_more() {
  const ws = weeks(range(1, 12), [12]);
  assert(pr.score(ws, "QB", "business") < pr.score(ws, "WR", "business"));
}

function test_injured_weeks_do_not_count() {
  const ws = weeks(range(1, 5), [], range(5, 13));
  assert(pr.band(pr.score(ws, "WR", "business"), "business") === "kept");
  const hurt = weeks([], [], range(1, 13));
  assert(pr.score(hurt, "WR", "business") === null && pr.band(null, "business") === "none");
}

function test_personality_bars() {
  assert(pr.band(0.55, "shy") === "kept" && pr.band(0.55, "business") === "bent" && pr.band(0.55, "cocky") === "bent");
  assert(pr.band(0.45, "cocky") === "broken" && pr.band(0.45, "business") === "bent");
}

function test_attention_big_games_count_double() {
  const ws = weeks([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], [6]);       // started the big game: it weighs more for him
  const no = weeks([1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12], [6]);      // sat the big game
  assert(pr.score(no, "WR", "attention") < pr.score(no, "WR", "business"), "a missed big game costs the attention seeker more");
}

function test_chip_words() {
  assert(pr.chip("kept") === "On Track" && pr.chip("bent") === "Slipping" && pr.chip("broken") === "Broken" && pr.chip("none") === null);
}


// ----- Task 2: the weekly snapshot (a career in its second season, with its league) -----

/** tests/test_offseason's `finished`: every game played (the better team usually wins), every school's class signed, season over. */
function finished(st) {
  const rng = new Random(1);
  const teams = season.load_teams();
  for (const g of Object.values(st["games"])) {
    const [h, a] = [teams[g["home"]]["team_ratings"]["overall"], teams[g["away"]]["team_ratings"]["overall"]];
    const hs = rng.randint(10, 45);
    const win = rng.random() < 1 / (1 + Math.pow(10, (a - h) / 12));
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

/** A career in 2027 with its own league (offseason run through): promises can exist. */
function second_season() {
  const st = season.new_season("iowa", "full", 5, undefined, undefined, true);
  finished(st);
  offseason.start(st);
  offseason.run_all(st);
  return offseason.next_season(st);
}

/** Promise the starting QB and a bench player this season; return their slugs. The same pair test to test (a later
 * test reads the record an earlier one built, and injuries move who is in the game). */
function promise_two(st) {
  const [me, year] = [st["team"], season.season_year(st)];
  if (get(st, "_test_two")) return st["_test_two"];
  const t = season._preview_team(st, me);
  const rows = [...t["offense"], ...t["defense"]];
  const roster = {};
  for (const c of st["league"]["teams"][me]["roster"]) roster[c["id"]] = c;
  const starters = rows.filter((p) => get(p, "in_game"));
  // the starting QB; while he is hurt, a starter already promised (the same one test to test), else any starter
  const qb = starters.find((p) => p["position"] === "QB")
    || starters.find((p) => get(get(roster, p["slug"]) || {}, "promised") === year) || starters[0];
  const bench = rows.find((p) => !get(p, "in_game") && !["K", "P"].includes(p["position"]));
  if (bench === undefined) throw new Error("StopIteration");
  for (const slug of [qb["slug"], bench["slug"]]) roster[slug]["promised"] = year;
  st["_test_two"] = [qb["slug"], bench["slug"], bench];
  return st["_test_two"];
}

function test_snapshot_records_each_week(st) {
  const [qb, bench] = promise_two(st);
  season.advance(st);
  season.advance(st);
  const year = String(season.season_year(st));
  const rec = pr.record(st)[year];
  assert(rec[qb].length === rec[bench].length && rec[bench].length >= 1, show(rec));
  assert(rec[qb].filter((w) => !w["injured"]).every((w) => w["started"]) && !rec[bench].some((w) => w["started"]), show(rec));
  assert(same(rec[qb].map((w) => w["week"]), sorted([...new Set(rec[qb].map((w) => w["week"]))])), "one entry per week");
}

function test_snapshot_once_per_week(st) {
  const year = String(season.season_year(st));
  const counts = () => Object.fromEntries(Object.entries(pr.record(st)[year]).map(([k, v]) => [k, v.length]));
  const before = counts();
  pr.snapshot_week(st, st["current_week"]);          // that week again: nothing new
  assert(same(counts(), before));
}

function test_injured_is_marked(st) {
  const [, bench, row] = promise_two(st);
  const me = st["team"];
  if (st["injuries"] === undefined) st["injuries"] = {};
  if (st["injuries"][me] === undefined) st["injuries"][me] = {};
  st["injuries"][me]["test-hurt"] = { name: row["name"], position: row["position"], weeks: 3 };
  const week = st["current_week"] + 1;
  pr.snapshot_week(st, week);
  const last = pr.record(st)[String(season.season_year(st))][bench].at(-1);
  assert(last["week"] === week && last["injured"] === true, show(last));
  delete st["injuries"][me]["test-hurt"];
}

function test_first_season_records_nothing() {
  const st = season.new_season("iowa", "full", 5, undefined, undefined, true);
  season.advance(st);
  assert(!get(st, "promises") || !Object.keys(st["promises"]).length, show(get(st, "promises")));
}


// ----- Task 3: the offseason reads the band -----

function _ctx(band = null, personality = "business", benched = false, slug = "pl") {
  return { year: 2028, losing: false, p4: true, tier: 2, slipping: null, rising: false,
           promise: band === null ? {} : { [slug]: { band: band, score: 0.3, benched_big: benched, personality: personality } } };
}

function _p(cls, pos = "WR") {
  return { id: "pl", cls: cls, pos: pos, o: 60, promised: 2027 };
}

function _total(parts) {
  return round(sum(parts.map(([, v]) => v)), 4);
}

function test_broken_junior_all_but_gone() {
  assert(_total(offseason.portal_odds(_p("JR"), "bench", _ctx("broken"))) === 0.92);
}

function test_broken_freshman_may_wait() {
  assert(_total(offseason.portal_odds(_p("FR"), "bench", _ctx("broken", "shy"))) === 0.50);
}

function test_broken_big_qb_more() {
  assert(_total(offseason.portal_odds(_p("JR", "QB"), "bench", _ctx("broken"))) === 0.95);
}

function test_bent_adds_half() {
  const parts = Object.fromEntries(offseason.portal_odds(_p("SO"), "bench", _ctx("bent")));
  assert(Math.abs(parts["promised"] - parts["role"] * (pr.BENT_MULT - 1)) < 1e-9, show(parts));
}

function test_kept_stays_more() {
  const kept = _total(offseason.portal_odds(_p("SO"), "bench", _ctx("kept")));
  const plain = _total(offseason.portal_odds({ ..._p("SO"), promised: null }, "bench", _ctx()));
  assert(Math.abs(kept - plain * offseason.KEPT_STAY) < 1e-4, show([kept, plain]));
}

function test_old_save_old_rule() {
  const parts = Object.fromEntries(offseason.portal_odds(_p("SO"), "bench", _ctx()));
  assert(Math.abs(parts["promised"] - parts["role"] * (offseason.PROMISE_BROKEN - 1)) < 1e-9, show(parts));
}

function test_promise_again_and_nil() {
  const e = { ask: { kind: "nil", nil: 100 }, offers: { nil: 0, promise: true }, role_next: "starter", intent: "portal",
              broken_promise: true };
  assert(offseason.stay_chance(e) === pr.PROMISE_AGAIN_STAY);
  assert(offseason.stay_chance({ ...e, offers: { nil: 0, promise: false } }) === 0.02);
  assert(offseason.stay_chance({ ...e, no_third: true }) === 0.02, "a third promise is worth nothing");
  for (const [kind, mult] of [["business", 0.8], ["cocky", 1.3], ["shy", 1.0]]) {
    assert(pr.nil_mult(kind) === pr.PROMISE_NIL_MULT * mult);
  }
}


// ----- Task 4: the chip and the first "Slipping" line -----

/** The second-season career: the starter promised reads On Track, the bench player Slipping or Broken; the depth
 * chart's card and his player page carry the same word. */
function test_now_reads_so_far(st) {
  const [qb, bench] = promise_two(st);
  if (get(pr.record(st)[String(season.season_year(st))], bench, []).filter((w) => !w["injured"]).length < 2) {
    season.advance(st);
    season.advance(st);
  }
  const chips = pr.chips_now(st);
  assert(get(chips, qb) === "On Track" && ["Slipping", "Broken"].includes(get(chips, bench)), show(chips));
  const cards = {};
  for (const c of season.depth_roster_view(st, st["team"])["players"]) cards[c["slug"]] = c;
  assert(cards[bench]["promise"] === chips[bench] && cards[qb]["promise"] === "On Track");
  assert(season.player_profile(st, st["team"], undefined, undefined, bench)["promise"] === chips[bench]);
}

function test_news_once(st) {
  const items = [...pr.news(st)];
  const mine = items.filter((n) => n["slug"] === promise_two(st)[1]);
  assert(mine.length === 1 && mine[0]["line"] === pr.SLIPPING_LINE && mine[0]["kind"] === "promise", show(mine));
  season.advance(st);
  assert(pr.news(st).filter((n) => n["slug"] === mine[0]["slug"]).length === 1, "said once");
}


// ----- review fixes -----

/** Game day (play_my_game) plays your game before advance: the week is recorded then, from that lineup. */
function test_game_day_snapshots_before_the_game(st) {
  const [qb] = promise_two(st);
  while (season.my_game_id(st, st["current_week"] + 1) === null) season.advance(st);     // past any bye: a week with your game
  const week = st["current_week"] + 1;
  assert(season.play_my_game(st) !== null);
  const rec = get(get(st, "promises") || {}, String(season.season_year(st))) || {};
  assert(get(rec, qb, []).some((w) => w["week"] === week), "game day recorded the week before the game");
  season.advance(st);
}

/** Program News keeps every promise line of a week (they carry a slug, no pid). */
function test_two_promise_lines_in_one_week(st) {
  const office = game.modules.office;
  const real = pr.news;
  pr.news = (state) => [["a-one", "A One"], ["b-two", "B Two"]].map(([s, n]) => (
    { week: state["current_week"], kind: "promise", slug: s, name: n, position: "WR", line: pr.SLIPPING_LINE }));
  let names;
  try {
    names = new Set(office.program_news(st).filter((n) => get(n, "kind") === "promise").map((n) => get(n, "name")));
  } finally {
    pr.news = real;
  }
  assert(same(names, new Set(["A One", "B Two"])), show([...names]));
}

/** The promised row keeps the personality the recruiting page showed (persona.of), so he is graded on it. */
function test_promise_carries_the_recruit_personality() {
  const row = { id: "x-guy" };
  pr.mark_promised(row, 2028, "cocky");
  assert(row["promised"] === 2028 && row["persona"]["personality"] === "cocky");
}

/** A Broken band reads broken at Keep Them Home even when the draw landed in his role segment. */
function test_broken_band_is_broken_whatever_the_draw() {
  assert(offseason._broken_promise("buried", { band: "broken" }, "portal") === true);
  assert(offseason._broken_promise("promised", null, "portal") === true);            // untracked: the old rule broke it
  assert(offseason._broken_promise("promised", { band: "bent" }, "portal") === false);
  assert(offseason._broken_promise("buried", { band: "broken" }, "draft") === false);   // a draft entrant is not the portal
}

/** A no-third leaver kept with NIL: your promise toggle does not promise him again. */
function test_no_third_promise_writes_nothing() {
  assert(offseason._keeps_promise({ offers: { promise: true }, no_third: true }) === false);
  assert(offseason._keeps_promise({ offers: { promise: true } }) === true);
}

/** Reading the chips, the news and the bands writes nothing into the save (the Office's read must change nothing). */
function test_reads_change_nothing() {
  const st = season.new_season("iowa", "full", 5, undefined, undefined, true);
  const before = json_dumps(st, { sort_keys: true });
  pr.chips_now(st); pr.news(st); pr.bands(st, season.season_year(st));
  assert(json_dumps(st, { sort_keys: true }) === before, "a read wrote into the save");
}

// in the Python file's order; a test that takes the second-season career gets the one made for the first of them
let later = null;
const with_later = (fn) => () => { later = later || second_season(); fn(later); };
test("test_second_half_mostly_kept", test_second_half_mostly_kept);
test("test_lost_the_job_reads_worse", test_lost_the_job_reads_worse);
test("test_big_game_bench_hits", test_big_game_bench_hits);
test("test_qb_bench_counts_more", test_qb_bench_counts_more);
test("test_injured_weeks_do_not_count", test_injured_weeks_do_not_count);
test("test_personality_bars", test_personality_bars);
test("test_attention_big_games_count_double", test_attention_big_games_count_double);
test("test_chip_words", test_chip_words);
test("test_snapshot_records_each_week", with_later(test_snapshot_records_each_week));
test("test_snapshot_once_per_week", with_later(test_snapshot_once_per_week));
test("test_injured_is_marked", with_later(test_injured_is_marked));
test("test_first_season_records_nothing", test_first_season_records_nothing);
test("test_broken_junior_all_but_gone", test_broken_junior_all_but_gone);
test("test_broken_freshman_may_wait", test_broken_freshman_may_wait);
test("test_broken_big_qb_more", test_broken_big_qb_more);
test("test_bent_adds_half", test_bent_adds_half);
test("test_kept_stays_more", test_kept_stays_more);
test("test_old_save_old_rule", test_old_save_old_rule);
test("test_promise_again_and_nil", test_promise_again_and_nil);
test("test_now_reads_so_far", with_later(test_now_reads_so_far));
test("test_news_once", with_later(test_news_once));
test("test_game_day_snapshots_before_the_game", with_later(test_game_day_snapshots_before_the_game));
test("test_two_promise_lines_in_one_week", with_later(test_two_promise_lines_in_one_week));
test("test_promise_carries_the_recruit_personality", test_promise_carries_the_recruit_personality);
test("test_broken_band_is_broken_whatever_the_draw", test_broken_band_is_broken_whatever_the_draw);
test("test_no_third_promise_writes_nothing", test_no_third_promise_writes_nothing);
test("test_reads_change_nothing", test_reads_change_nothing);
await run();
