// A career's offseason, step by step on one career (career_js/offseason.js, league.js): who leaves and how, the draft
// by position, the signed classes arriving, the transfer portal as four weeks of recruiting, development, your staff,
// the coaching carousel, and the next season on the career's own league. The finished season is made up (scores and
// signed classes) so the test runs in under a minute; the tests are one offseason in order, each from where the last
// left it.
// `node tests/test_offseason.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random, sorted, round } from "../engine_js/pyrt.js";
import { mean, pstdev } from "../engine_js/pystat.js";

const game = await start({ env: { SIM_WORKERS: "1", CFP_SEASONS_DIR: "data/seasons-offseason-test" } });
const { season, offseason, recruiting, files } = game;
const { league, prospects } = game.modules;

const show = (v) => JSON.stringify(v);
const count = (xs, key) => { const out = {}; for (const x of xs) { const k = key(x); out[k] = (out[k] || 0) + 1; } return out; };
const ME = "ohio-state";

/** Every game played (the better team usually wins), every school's class signed, the season over. */
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

const st = season.new_season(ME, "full", 5, undefined, undefined, true);
finished(st);
const before = {};                                  // every player's class before the offseason
for (const t of Object.values(season.load_teams())) for (const p of [...t["offense"], ...t["defense"]]) before[p["slug"]] = p["class"] ?? null;
const off = offseason.start(st);
const lg = st["league"];
const teams_n = Object.keys(lg["teams"]).length;
const rosters = () => Object.values(lg["teams"]).map((t) => t["roster"]);
const departures = (kind) => off["departures"].filter((d) => d["kind"] === kind);

// Keep Them Home comes first: nobody is drafted until your leavers have answered, so the draft runs on the final pool
test("the offseason opens at Keep Them Home, before anyone is drafted, with your early entrants waiting", () => {
  equal(off["stage"], "retention");
  assert(!off["departures"].some((d) => ["draft", "undrafted"].includes(d["kind"])));
  assert(off["retention"]["players"].some((e) => e["intent"] === "draft"), "no early entrant of yours waits at Keep Them Home");
});

test("then departures: seniors graduate, the draft takes its FBS share, and every early entrant is placed", () => {
  offseason.advance(st);
  equal(off["stage"], "departures");
  const kinds = count(off["departures"], (d) => d["kind"]);
  const left = (kinds["graduated"] || 0) + (kinds["draft"] || 0);
  assert(15 * teams_n <= left && left <= 24 * teams_n, show(kinds));
  equal(kinds["draft"], round(offseason.DRAFT_PICKS * offseason.DRAFT_FROM_FBS));
  assert(!kinds["declared"], "an early entrant was never placed by the draft");
});

// the draft by position matches the real drafts (data/draft_targets.json, five drafts' averages): one made-up draft
// is noisy, so each position group within 5 picks or half its target; round one within 4 a group and 15 over all
test("the draft takes each position about as often as real drafts do, in round one too", () => {
  const targets = JSON.parse(files.read_text("data/draft_targets.json"));
  const bucket = { QB: "QB", HB: "RB", FB: "RB", WR: "WR", TE: "TE", LT: "OT", RT: "OT", LG: "IOL", RG: "IOL", C: "IOL",
    LEDG: "EDGE", REDG: "EDGE", DT: "DL", SAM: "LB", MIKE: "LB", WILL: "LB", CB: "CB", FS: "S", SS: "S", K: "K", P: "P" };
  const drafted = departures("draft");
  const all = count(drafted, (d) => bucket[d["pos"]]);
  const r1 = count(drafted.filter((d) => d["pick"] <= 32), (d) => bucket[d["pos"]]);
  const k = offseason.DRAFT_PICKS * offseason.DRAFT_FROM_FBS / targets["picks_a_draft"];
  for (const [b, want] of Object.entries(targets["all"])) assert(Math.abs((all[b] || 0) - want * k) <= Math.max(5, 0.5 * want * k), show([b, all[b], want * k]));
  for (const [b, want] of Object.entries(targets["round1"])) assert(Math.abs((r1[b] || 0) - want) <= 4, show([b, r1[b], want]));
  const miss = Object.entries(targets["round1"]).reduce((a, [b, want]) => a + Math.abs((r1[b] || 0) - want), 0);
  assert(miss <= 15, show(r1));
});

// underclassmen three years out of high school may declare: juniors, redshirt juniors and redshirt sophomores
test("early entrants are a real draft's number and only from the classes that may declare", () => {
  const early = off["departures"].filter((d) => d["early"]);
  assert(early.length >= 40 && early.length <= 140, String(early.length));
  const cls = count(early, (d) => d["cls"]);
  assert(Object.keys(cls).every((c) => offseason.UNDERCLASS_ELIGIBLE.has(c)), show(cls));
  assert(cls["JR"] > 0 && cls["SORS"] > 0, show(cls));
});

test("some 6 to 22 percent of returning players enter the portal, and few quit", () => {
  const entrants = Object.keys(off["portal"]["players"]).length;
  const returning = rosters().reduce((a, r) => a + r.length, 0) + entrants;
  const share = entrants / returning;
  assert(share >= 0.06 && share <= 0.22, String(share));
  assert(departures("quit").length < 0.03 * returning);
});

test("every school's signed class has arrived, and every returning player moved up a class or took his redshirt", () => {
  equal(Object.values(off["signed"]).reduce((a, b) => a + b, 0), 21 * teams_n);
  const waiting = new Set(off["redshirts"]["players"].map((p) => p["id"]));      // your redshirt calls wait on the Departures step
  let checked = 0;
  for (const roster of rosters()) {
    for (const p of roster) {
      if (!(p["id"] in before) || p["signed"] || waiting.has(p["id"])) continue;
      const was = before[p["id"]];
      assert(p["cls"] === offseason.NEXT_CLASS[was] || p["cls"] === `${was}RS` || (was === "SR" && p["cls"] === "SRRS"), show([was, p["cls"]]));
      checked++;
    }
  }
  assert(checked > 5000, String(checked));
  const mine = offseason.view(st)["departures"]["mine"];
  assert(mine.length && mine.every((d) => d["team"] === ME));
});

// the portal is recruiting again: four weeks, no stars, your offer with a pitch and a campus visit
test("the portal opens as a recruiting class of the entrants, with an empty board and last year's class kept", () => {
  offseason.advance(st);
  const rc = st["recruiting"];
  assert(off["stage"] === "portal_w1" && rc["portal"] && rc["week"] === 1);
  assert(st["recruiting_last"] && !st["recruiting_last"]["portal"]);
  equal(Object.keys(rc["prospects"]).length, Object.keys(off["portal"]["players"]).length);
  for (const p of Object.values(rc["prospects"])) {
    assert(p["stars"] === null && p["portal_rank"] && p["from_name"] && "line" in p && p["nil_ask"] != null, show([p["name"], p["stars"], p["portal_rank"], p["nil_ask"]]));
  }
  const view = prospects.recruiting_view(st);
  assert(view["portal"]["week"] === 1 && view["open_spots"] >= 0 && view["board"].length === 0);
});

test("you can offer a transfer with a pitch and host him this week; the portal runs four weeks and signs some", () => {
  const rc = st["recruiting"];
  const entrants = Object.keys(rc["prospects"]).length;
  const pick = sorted(Object.keys(rc["prospects"]), (q) => rc["prospects"][q]["rank"]).find((q) => rc["prospects"][q]["from"] !== ME);
  rc["board"].push(pick);
  recruiting.act(st, ME, pick, "offer", rc["prospects"][pick]["priorities"][0], recruiting.ask_from(st, ME, pick));
  recruiting.act(st, ME, pick, "official_visit");        // a campus visit: this week, no home game needed
  assert((rc["visits"][pick][ME] || {})["done"]);
  for (const w of [2, 3, 4]) {
    offseason.advance(st);
    assert(off["stage"] === `portal_w${w}` && rc["week"] === w, show([off["stage"], rc["week"]]));
  }
  const signed = Object.values(rc["status"]).filter((s) => s["signed"]).length;
  assert(signed > 0 && signed < entrants, String(signed));
});

let before_dev = null;
test("the portal's recap has the screen before development", () => {
  before_dev = {};
  for (const roster of rosters()) for (const p of roster) before_dev[p["id"]] = p["o"];
  offseason.advance(st);
  equal(off["stage"], "portal_recap");
  offseason.advance(st);
  equal(off["stage"], "development");
});

// development is not cookie-cutter: teams have good and bad years on top of their program and coaches, and players
// boom and bust
test("development varies by team and by player, and players improve on the whole", () => {
  const gain = (roster) => roster.filter((p) => p["id"] in before_dev).map((p) => p["o"] - before_dev[p["id"]]);
  const team_gain = rosters().map((r) => mean(gain(r)));
  assert(pstdev(team_gain) >= 0.4, show([mean(team_gain), pstdev(team_gain)]));
  const eras = Object.values(lg["teams"]).map((t) => t["era"]);
  assert(eras.every((e) => e != null) && pstdev(eras) >= 0.1);
  const sophomores = rosters().flatMap((r) => gain(r.filter((p) => ["SO", "SORS"].includes(p["cls"]))));
  assert(pstdev(sophomores) >= 2.5, String(pstdev(sophomores)));
  assert(off["report"]["development"]["mean_gain_ea"] > 0);
});

// real: about 70% of the top 50 transfers land at top-25 programs; one offseason is noisy, so 30% here
test("most transfers find a school, the best mostly at strong programs, and smaller schools get their share", () => {
  const entries = Object.values(off["portal"]["players"]);
  const placed = entries.filter((e) => e["signed"]).length / entries.length;
  assert(placed >= 0.55 && placed <= 0.95, String(placed));
  const model = recruiting.model()["teams"];
  const top25 = new Set(sorted(Object.keys(model), (s) => -model[s]["strength"]["baseline"]).slice(0, 25));
  const best = sorted(entries, (e) => -e["player"]["o"]).slice(0, 50);
  const top_share = best.filter((e) => top25.has(e["signed"])).length / best.length;
  assert(top_share >= 0.30, String(top_share));
  const g5 = Object.keys(lg["teams"]).filter((s) => !offseason.p4_school(s));
  const per_g5 = entries.filter((e) => g5.includes(e["signed"])).length / g5.length;
  assert(per_g5 >= 1.0 && per_g5 <= 5.5, String(per_g5));
});

// a team must be able to line up next year whatever it lost
test("after Roster Cuts every roster ends between 70 and the limit with every position floor met, preferred walk-ons filling in", () => {
  // Progress is done: Roster Cuts is next, and the rosters are filled once it is settled (here the staff decides)
  // (Place Your Athletes comes first in a year you signed one)
  offseason.advance(st);
  if (off["stage"] === "athletes") offseason.advance(st);
  equal(off["stage"], "cuts");
  offseason.cuts_auto(st);
  offseason.advance(st);
  equal(off["stage"], "cuts_recap");                       // Roster Moves: where everyone went, a stage of its own
  assert(off["cuts"]["done"] === true);
  offseason.advance(st);
  equal(off["stage"], "staff");
  assert(rosters().some((r) => r.some((p) => p["walk_on"] && p["preferred"])), "no preferred walk-ons");
  const sizes = rosters().map((r) => r.length);
  assert(Math.min(...sizes) >= 70 && Math.max(...sizes) <= offseason.ROSTER_LIMIT, show([Math.min(...sizes), Math.max(...sizes)]));
  for (const r of rosters()) {
    const counts = offseason._group_counts(r);
    assert(Object.entries(offseason.FLOOR).every(([g, f]) => counts[g] >= f), show(counts));
  }
});

let hired_id = null, hired_name = null, target = null;
test("a staff opening has candidates to choose from and your pick is hired", () => {
  equal(off["stage"], "staff");
  const staff = off["staff"];
  if (!staff["leaving"].length) {                      // nobody left on this seed: open a job
    const sid = st["career"]["staff"][2]["id"];
    staff["leaving"].push(sid);
    staff["candidates"][sid] = [0, 1, 2].map((i) => offseason._candidate(new Random(i), st["career"]["staff"][2], new Set()));
  }
  hired_id = staff["leaving"][0];
  assert(staff["candidates"][hired_id].length >= 3, "fewer than three candidates for the opening");
  hired_name = staff["candidates"][hired_id][1]["name"];
  offseason.hire(st, hired_id, 1);
});

// athletic directors judge their coaches: some are fired, retire or leave, and every opening is filled. You won the
// title (the made-up season says so), so you are safe
test("the carousel moves head coaches, leaves no team without one, and a champion's job is safe", () => {
  const car = off["carousel"];
  const gone = car["changes"].filter((c) => c["role"] === "head_coach" && ["fired", "retired", "left for the NFL"].includes(c["reason"]));
  assert(gone.length >= 1 && gone.length <= 45, String(gone.length));
  assert(Object.values(lg["teams"]).every((t) => (t["coaches"]["head_coach"] || {})["name"]));
  assert(car["you"]["security"] >= 70 && !car["you"]["fired"], show(car["you"]));
  if (!car["offers"].length) car["offers"] = ["alabama"];
  target = car["offers"][0];
  offseason.choose_job(st, target);
});

test("the offseason ends with Change Conferences, Edit Schedule (next year's games drawn) and Ready", () => {
  offseason.advance(st);
  equal(off["stage"], "conferences");
  offseason.advance(st);
  assert(off["stage"] === "schedule" && Object.keys(off["next_schedule"]["games"]).length);
  offseason.advance(st);
  equal(off["stage"], "ready");
  equal(st["career"]["staff"].find((s) => s["id"] === hired_id)["name"], hired_name);
});

let next = null;
test("the next season is the same career a year on: the job you took, your history, and a schedule of its own", () => {
  next = offseason.next_season(st);
  assert(next["id"] === st["id"] && next["year"] === 2027 && next["recruiting"]["year"] === 2028);
  const history = next["career"]["history"];
  assert(next["team"] === target && history[history.length - 1]["moved_to"] === target, "taking the job did not move you");
  assert(history[0]["year"] === 2026 && history[0]["won_title"]);
  assert(files.exists(league.path(next["id"], 2027)) && season._league_path === league.path(next["id"], 2027));
  // twelve games for your old team, nine in the Big Ten, its protected rival among them
  const games = Object.values(next["games"]).filter((g) => g["kind"] === "regular" && (g["home"] === ME || g["away"] === ME));
  assert(games.length === 12 && games.filter((g) => g["conference_game"]).length === 9 && games.every((g) => g["event_id"].startsWith("2027-")), String(games.length));
  assert(games.some((g) => g["home"] === "michigan" || g["away"] === "michigan"), "the protected rival is on the slate");
  const years = next["league"]["schedule_history"]["years"];
  equal(years[years.length - 1], 2027);
  assert(next["polls"]["0"]["ap"].length && !next["done"] && next["current_week"] === 0);
  const t = season.load_teams()[ME];
  const players = [...t["offense"], ...t["defense"]];
  assert(new Set(players.map((p) => p["name"])).size >= 70 && players.some((p) => p["class"] === "FR"), "a new class is on the roster");
});

test("the new season plays, and a saved career comes back on its own league even when the league's file is gone", () => {
  const name = season.load_teams()[ME]["name"];
  season.advance(next);
  assert(Object.values(next["games"]).filter((g) => g["week"] === 1).every((g) => g["played"]));
  season.save_season(next);
  season.use_league(null);
  files.remove(league.path(next["id"], 2027));
  const back = season.load_season(next["id"]);
  season.activate(back);
  assert(files.exists(league.path(next["id"], 2027)), "the league's teams file was not rebuilt from the save");
  equal(season.load_teams()[ME]["name"], name);
  league.forget(next["id"]);
  season.use_league(null);
});

await run();
