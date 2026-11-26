// Keep Them Home, the offseason's first step: your players who mean to leave with eligibility left (portal entrants,
// early draft entrants) wait on it. You meet them (their ask shows), promise a starting role, or offer NIL from your
// portal pool; when you advance, each stays or goes, the leavers join the portal or the draft, and the NIL you spent
// comes off the pool.
// `node tests/test_retention.mjs`
import { start, test, run, assert, equal, raises } from "./harness.mjs";
import { Random, sorted } from "../engine_js/pyrt.js";

const game = await start({ env: { SIM_WORKERS: "1" } });
const { season, offseason, recruiting } = game;

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

function opened(seed) {
  const st = season.new_season("ohio-state", "full", seed, undefined, undefined, true);
  finished(st);
  return [st, offseason.start(st)];
}

const [st, off] = opened(7);
const me = st["team"], lg = st["league"];
const players = off["retention"]["players"];
const roster_ids = () => new Set(lg["teams"][me]["roster"].map((p) => p["id"]));

test("your leavers wait at Keep Them Home: still on the roster, not yet in the portal, their ask not yet known", () => {
  equal(off["stage"], "retention");
  assert(players.length, "no leavers to talk to");
  const on = roster_ids();
  for (const e of players) {
    assert(["portal", "draft"].includes(e["intent"]) && e["reason"] && e["reason_key"] && e["cls"] && ["starter", "rotation", "bench"].includes(e["role_next"]), show(e));
    assert(on.has(e["id"]), "a player on the retention step is already off the roster");
    assert(!(e["id"] in off["portal"]["players"]), "a player on the retention step is already in the portal");
    assert(!e["ask"]["known"]);
  }
  assert(players.some((e) => e["intent"] === "portal"));
  assert(!off["departures"].some((d) => d["team"] === me && d["kind"] === "portal"), "your portal leavers are already in the departures");
});

let p0 = null, ask0 = null, budget = null;
test("meeting a leaver shows what he wants; NIL past your portal pool is refused", () => {
  p0 = players.find((e) => e["intent"] === "portal");
  const v = offseason.retain(st, p0["id"], "meet");
  const e0 = v["players"].find((e) => e["id"] === p0["id"]);
  assert(e0["ask"]["known"] && ["playing_time", "nil"].includes(e0["ask"]["kind"]) && e0["ask"]["nil"] >= 0, show(e0["ask"]));
  ask0 = e0["ask"]["nil"];
  budget = st["nil_pool"][me]["pool"];
  const e = raises(() => offseason.retain(st, p0["id"], "nil", budget + 1), offseason.RetentionError);
  equal(e.code, 400);
});

// the odds the page's words stand on: his ask met keeps him, so does your promise of a start (next season judges
// whether you play him), a lowball does not, and a first-round pick is gone whatever you say
test("the chance he stays follows what you offer against what he wants", () => {
  const base = { intent: "portal", role_next: "bench", ask: { kind: "nil", nil: 40, known: true }, offers: { nil: 0, promise: false }, reason_key: "buried", draft_pick: null };
  const time = { kind: "playing_time", nil: 15, known: true };
  assert(offseason.stay_chance({ ...base, offers: { nil: 40, promise: false } }) >= 0.7);
  assert(offseason.stay_chance({ ...base, offers: { nil: 10, promise: false } }) <= 0.3);
  assert(offseason.stay_chance({ ...base, ask: time, offers: { nil: 0, promise: true } }) >= 0.7);
  assert(offseason.stay_chance({ ...base, role_next: "starter", ask: time, offers: { nil: 0, promise: true } }) >= 0.7);
  assert(offseason.stay_chance({ ...base, intent: "draft", draft_pick: 12, offers: { nil: 200, promise: true } }) <= 0.12);
  const elite = offseason.stay_chance({ ...base, intent: "draft", draft_pick: 1, elite: true, offers: { nil: 10 ** 4, promise: true } });
  assert(elite === offseason.ELITE_STAY && elite <= 0.02);
  assert(offseason.stay_chance(base) <= 0.25, "nothing offered");
});

let results = null;
test("when you advance, everyone has answered: a player who stayed is not among the departures", () => {
  offseason.retain(st, p0["id"], "nil", ask0);
  const p1 = players.find((e) => e["id"] !== p0["id"] && e["intent"] === "portal");
  if (p1) offseason.retain(st, p1["id"], "promise");
  offseason.advance(st);
  equal(off["stage"], "departures");
  results = Object.fromEntries(off["retention"]["results"].map((r) => [r["id"], r]));
  equal(new Set(Object.keys(results)), new Set(players.map((e) => e["id"])));
  assert(Object.values(results).every((r) => ["stayed", "left"].includes(r["status"])));
  const stayed = new Set(Object.keys(results).filter((id) => results[id]["status"] === "stayed"));
  assert(!off["departures"].some((d) => stayed.has(d["id"])), "a player who stayed is in the departures");
  equal(new Set(offseason.view(st)["departures"]["stayed"].map((s) => s["id"])), stayed);
});

test("those who stayed are on your roster and marked as kept; those who left are in the portal or the draft", () => {
  offseason.advance(st);
  equal(off["stage"], "portal_w1");
  const on = roster_ids(), rc = st["recruiting"];
  for (const e of players) {
    if (results[e["id"]]["status"] === "stayed") {
      assert(on.has(e["id"]) && !(e["id"] in off["portal"]["players"]));
      equal(lg["teams"][me]["roster"].find((p) => p["id"] === e["id"])["kept"], off["year"]);
    } else {
      assert(!on.has(e["id"]));
      if (e["intent"] === "portal") assert(e["id"] in off["portal"]["players"] && e["id"] in rc["prospects"], "a leaver is not in the portal");
      else assert(off["departures"].some((d) => d["id"] === e["id"] && ["draft", "undrafted"].includes(d["kind"])));
    }
  }
});

// a deal he turned down costs nothing
test("the NIL a player accepted comes off your portal budget; a refused offer costs nothing", () => {
  const spent = results[p0["id"]]["status"] === "stayed" ? ask0 : 0;
  equal(st["nil_pool"][me]["retained"], spent);
  equal(recruiting._nil(st, me)["budget"], budget - spent);
});

test("on Auto nobody is talked to, so every leaver goes", () => {
  const [st2, off2] = opened(6);
  assert(off2["retention"]["players"].length, "no leavers on this seed");
  off2["auto"] = true;
  offseason.advance(st2);
  assert(off2["retention"]["results"].every((r) => r["status"] === "left"));
});

test("a save from before this step existed (at Departures, with no Keep Them Home) goes straight on to the portal", () => {
  const [st3, off3] = opened(8);
  delete off3["retention"];
  delete off3["draft"];
  off3["stage"] = "departures";
  offseason.advance(st3);
  assert(off3["stage"] === "portal_w1" && st3["recruiting"]["portal"]);
});

await run();
