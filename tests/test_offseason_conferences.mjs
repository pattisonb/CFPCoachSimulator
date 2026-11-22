// The offseason's last two steps. Change Conferences moves a program to a conference that already exists (none can
// be made up), and the move is the league's from then on. Edit Schedule draws next season's schedule from the same
// random stream the next season always drew it from (so with nothing traded it is the same schedule), lets you trade
// your non-conference games, and the new season plays exactly what was drawn and traded.
// `node tests/test_offseason_conferences.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random, sorted, parse_ordered } from "../engine_js/pyrt.js";

const game = await start({ env: { SIM_WORKERS: "1" } });
const { season, offseason } = game;
const { league, schedule_gen } = game.modules;

const show = (v) => JSON.stringify(v);
/** A copy of a season's state as a save would give it back (the games keep their order). */
const copy = (st) => parse_ordered(JSON.stringify(st), [["games"], ["my_boxes"]]);

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

function refused(fn, words) {
  try { fn(); } catch (e) {
    if (!(e instanceof offseason.ConferenceError || e instanceof season.ScheduleError)) throw e;
    assert(e.message.includes(words), e.message);
    return;
  }
  throw new Error(`not refused: ${words}`);
}
function to_stage(st, stage) {
  st["offseason"]["auto"] = true;
  while (st["offseason"]["stage"] !== stage) offseason.advance(st);
}

const st = season.new_season("smu", "full", 7, undefined, undefined, true);
finished(st);
offseason.start(st);
to_stage(st, "staff");
const base = copy(st);

test("a program can change conferences only at the Change Conferences step, and only to one that exists", () => {
  refused(() => offseason.move_conference(st, "memphis", "ACC"), "only at the Change Conferences step");
  offseason.advance(st);
  equal(st["offseason"]["stage"], "conferences");
  const names = offseason.conferences_view(st)["conferences"].map((c) => c["name"]);
  assert(names.includes("ACC") && names.some((n) => n.includes("American")), show(names));
  refused(() => offseason.move_conference(st, "memphis", "Made Up Conference"), "already exists");
});

test("a move shows in the new conference and in the list of moves; moving back undoes it", () => {
  const v = offseason.move_conference(st, "memphis", "ACC");
  const acc = v["conferences"].find((c) => c["name"] === "ACC");
  const row = acc["teams"].find((t) => t["team"] === "memphis");
  assert(row && row["moved_from"], "Memphis is not shown in the ACC");
  equal(v["moves"].length, 1);
  const from = v["moves"][0]["from"];
  equal({ ...v["moves"][0] }, { team: "memphis", name: row["name"], from, to: "ACC" });
  equal({ ...st["league"]["conference_moves"] }, { memphis: "ACC" });
  offseason.move_conference(st, "memphis", from);
  assert(!Object.keys(st["league"]["conference_moves"]).length && !offseason.conferences_view(st)["moves"].length);
  offseason.move_conference(st, "memphis", "ACC");
});

test("next season's schedule is drawn at Edit Schedule, with the moved program on its new conference's slate", () => {
  offseason.advance(st);
  equal(st["offseason"]["stage"], "schedule");
  const sv = offseason.schedule_view(st);
  assert(sv["games"].length === schedule_gen.GAMES && sv["open"], String(sv["games"].length));
  const teams = offseason.next_teams(st);
  const mem = Object.values(st["offseason"]["next_schedule"]["games"]).filter((g) => (g["home"] === "memphis" || g["away"] === "memphis") && g["conference_game"]);
  assert(mem.length && mem.every((g) => teams[g["home"] === "memphis" ? g["away"] : g["home"]]["conference"] === "ACC"), "Memphis does not play an ACC slate");
});

test("a non-conference game can be traded for one an opponent accepts; after the step it cannot", () => {
  const sv = offseason.schedule_view(st);
  let traded = null;
  for (const g of sv["editable"]) { const o = g["options"].find((x) => x["accepts"]); if (o) { traded = [g, o]; break; } }
  assert(traded, "no trade was open on this seed");
  const after = offseason.schedule_trade(st, traded[0]["event_id"], traded[1]["slug"]);
  assert(after["changes"].length && after["changes"][after["changes"].length - 1]["to"] === traded[1]["slug"]);
  offseason.advance(st);
  equal(st["offseason"]["stage"], "ready");
  refused(() => offseason.schedule_trade(st, "x", "y"), "only at the Edit Schedule step");
});

const regular = (games) => Object.entries(games).filter(([, g]) => (g["kind"] ?? "regular") === "regular").map(([k, g]) => [k, g["home"], g["away"], g["week"]]);

test("the new season plays the schedule as drawn and traded, in the league with the move made", () => {
  const drawn = regular(st["offseason"]["next_schedule"]["games"]);
  const next = offseason.next_season(st);
  equal(sorted(regular(next["games"])), sorted(drawn));
  equal(season.load_teams()["memphis"]["conference"], "ACC");
});

// drawing the schedule a step before the season starts must not change which schedule it is: an offseason that moves
// and trades nothing gets the schedule it always got
test("with nothing moved or traded, the schedule is the one the next season drew before these steps existed", () => {
  const a = copy(base), old = copy(base);
  a["id"] = `${base["id"]}-a`; old["id"] = `${base["id"]}-b`;       // each its own next-year teams file
  offseason.run_all(a);
  old["offseason"]["auto"] = true;
  offseason.advance(old);                               // staff -> conferences
  old["offseason"]["stage"] = "ready";                  // skip the two steps: next_season draws as it did
  const key = (s) => sorted(Object.values(s["games"]).filter((g) => g["kind"] === "regular").map((g) => [g["home"], g["away"], g["week"]]));
  equal(key(offseason.next_season(a)), key(offseason.next_season(old)));
  for (const c of [a, old, base]) league.forget(c["id"]);
});

await run();
