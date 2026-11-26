// The offseason's order: Keep Them Home comes first, then Departures. Who wants out (graduating, declaring early,
// entering the portal) is decided when the offseason opens; the draft runs only after your answers at Keep Them Home
// and the other schools' own, so a player you kept is never drafted and The First Round is the final pool's. A save
// from the older order (Departures first, the draft already shown) still loads and carries on.
// `node tests/test_offseason_order.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random, sorted, round, json_dumps, parse_ordered } from "../engine_js/pyrt.js";

const game = await start({ env: { SIM_WORKERS: "1" } });
const { season, offseason } = game;

const show = (v) => JSON.stringify(v);
/** A copy of a season's state as a save would give it back (the games keep their order). */
const copy = (st) => parse_ordered(JSON.stringify(st), [["games"], ["my_boxes"]]);
const same = (a, b) => json_dumps(a, { sort_keys: true }) === json_dumps(b, { sort_keys: true });
const FBS_PICKS = round(offseason.DRAFT_PICKS * offseason.DRAFT_FROM_FBS);

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

function fresh(team = "ohio-state", seed = 5) {
  const st = season.new_season(team, "full", seed, undefined, undefined, true);
  finished(st);
  offseason.start(st);
  return st;
}
const stayed_ids = (st) => new Set(st["offseason"]["retention"]["results"].filter((r) => r["status"] === "stayed").map((r) => r["id"]));

/** The draft as it ran: picks 1..N once each, in draft-score order over the final pool, nobody you kept in it. */
function check_draft(st, kept) {
  const off = st["offseason"], deps = off["departures"], scores = off["draft"]["scores"];
  const drafted = sorted(deps.filter((d) => d["kind"] === "draft"), (d) => d["pick"]);
  equal(drafted.map((d) => d["pick"]), drafted.map((_, i) => i + 1), "the picks skip or repeat");
  equal(drafted.length, FBS_PICKS);
  assert(drafted.every((d) => d["round"] === Math.min(7, Math.floor((d["pick"] - 1) / 32) + 1)));
  assert(!deps.some((d) => d["kind"] === "declared"), "an early entrant was left waiting for the draft");
  assert(!deps.some((d) => ["draft", "undrafted"].includes(d["kind"]) && kept.has(d["id"])), "a player you kept was drafted");
  const ss = drafted.map((d) => scores[d["id"]]);
  assert(ss.every((x, i) => i === 0 || ss[i - 1] >= x), "the picks are not in draft-score order");
  const last = ss[ss.length - 1];
  for (const d of deps) {                          // everyone left in the pool undrafted scores under the last pick
    if (d["id"] in scores && ["undrafted", "graduated"].includes(d["kind"])) assert(scores[d["id"]] <= last, show([d["name"], d["kind"]]));
  }
  const v = offseason.view(st);
  // (the page shows each player's rating on its own scale, so the rows are compared by who and which pick)
  equal(v["departures"]["first_round"].map((d) => [d["id"], d["pick"]]), drafted.slice(0, 32).map((d) => [d["id"], d["pick"]]), "The First Round is not the final draft");
  equal(v["departures"]["league"]["draft"], FBS_PICKS);
  equal(v["departures"]["early_entrants"], deps.filter((d) => d["early"]).length);
}

test("Keep Them Home is the first step and Departures the second; nothing is drafted before your answers", () => {
  equal([...offseason.STAGES].slice(0, 2), ["retention", "departures"]);
  const st = fresh();
  const off = st["offseason"], me = st["team"];
  equal(off["stage"], "retention");
  let v = offseason.view(st);
  equal(v["stages"].slice(0, 2).map((s) => s["key"]), ["retention", "departures"]);
  assert(v["stages"][0]["current"] && v["review_open"], "the AD's meeting is open at the first step");
  assert(!off["departures"].some((d) => ["draft", "undrafted"].includes(d["kind"])), "drafted before Keep Them Home");
  assert(v["departures"]["first_round"].length === 0 && !off["draft"]["done"]);
  assert(off["departures"].some((d) => d["kind"] === "declared"));
  // your early entrants wait at Keep Them Home, each with a projected pick
  const entrants = off["retention"]["players"].filter((e) => e["intent"] === "draft");
  assert(entrants.length && entrants.every((e) => e["draft_pick"] || e["draft_kind"] === "undrafted"), show(entrants));

  // keep one early entrant (forced: the odds are tests/test_retention.mjs's) and let the rest go
  const keep = entrants[entrants.length - 1]["id"];
  const real = offseason.stay_chance;
  offseason.stay_chance = (e) => (e["id"] === keep ? 1.0 : 0.0);
  try { offseason.advance(st); } finally { offseason.stay_chance = real; }
  equal(off["stage"], "departures");
  assert(st["league"]["teams"][me]["roster"].some((p) => p["id"] === keep), "the kept player is off the roster");
  check_draft(st, new Set([keep]));
  v = offseason.view(st);
  const stayed = v["departures"]["stayed"];
  equal(stayed.map((s) => s["id"]), [keep]);
  equal(stayed[0]["kind_name"], "Stayed: You Kept Him Home");
  assert(v["departures"]["mine"].every((d) => d["id"] !== keep));
  const in_draft = new Set(v["departures"]["mine"].filter((d) => ["draft", "undrafted"].includes(d["kind"])).map((d) => d["id"]));
  assert(entrants.every((e) => e["id"] === keep || in_draft.has(e["id"])), "an early entrant who left is not in the draft");
  // redshirts are still decided at Departures
  const rs = off["redshirts"];
  if (rs["players"].length) offseason.redshirt(st, rs["players"][0]["id"], !rs["players"][0]["redshirt"]);
  offseason.advance(st);
  equal(off["stage"], "portal_w1");
  assert(off["redshirts"]["decided"]);
});

test("an offseason run on Auto keeps the same order: the draft is over the pool left after Keep Them Home", () => {
  const st = season.new_season("smu", "full", 6, undefined, undefined, true);
  finished(st);
  offseason.run_all(st);
  check_draft(st, stayed_ids(st));
});

/** A save as the older order wrote it: the draft already run at the start (everyone who declared in it, your early
 * entrants waiting with their projected pick), no draft block, the stage given. */
function legacy(base, stage) {
  const st = copy(base);
  const off = st["offseason"], scores = off["draft"]["scores"];
  const pool = off["departures"].filter((d) => d["id"] in scores && ["graduated", "declared"].includes(d["kind"]));
  const mine = off["retention"]["players"].filter((e) => e["intent"] === "draft");
  const order = sorted([...pool.map((d) => [scores[d["id"]], "dep", d]), ...mine.map((e) => [scores[e["id"]], "ret", e])], (x) => -x[0]);
  order.forEach(([, kind, x], i) => {
    const pick = i + 1, drafted = pick <= FBS_PICKS;
    if (kind === "dep") {
      delete x["proj"];
      if (drafted) Object.assign(x, { kind: "draft", pick, round: Math.min(7, Math.floor((pick - 1) / 32) + 1) });
      else if (x["kind"] === "declared") x["kind"] = "undrafted";
    } else {
      Object.assign(x, { draft_pick: drafted ? pick : null, draft_kind: drafted ? "draft" : "undrafted" });
      delete x["elite"];
    }
  });
  delete off["draft"];
  off["stage"] = stage;
  if (stage === "retention") { off["review"]["decided"] = true; off["redshirts"]["decided"] = true; }   // the older order had decided these at Departures
  return st;
}

// a player's save must never be stranded by a change of rules: an older save loads into the new order
test("a save from the older order loads into the new one: back to Keep Them Home, then the draft again", () => {
  const base = fresh("georgia", 8);
  // an old save at Departures (the draft on screen, Keep Them Home still to come)
  let st = legacy(base, "departures");
  assert(st["offseason"]["departures"].some((d) => d["kind"] === "draft"));
  const v = offseason.view(st);                           // loading it migrates it
  let off = st["offseason"];
  assert(off["stage"] === "retention" && v["stage"] === "retention", off["stage"]);
  assert(off["draft"]["legacy"] && !off["draft"]["done"]);
  assert(!off["departures"].some((d) => ["draft", "undrafted"].includes(d["kind"])), "the old draft still shows before Keep Them Home");
  assert(same(offseason.view(st), v), "migrating twice changed the save");
  offseason.advance(st);
  equal(off["stage"], "departures");
  check_draft(st, stayed_ids(st));
  offseason.advance(st);
  equal(off["stage"], "portal_w1");
  // an old save at Keep Them Home (Departures done, the draft shown): it resolves, the draft reruns, Departures next
  st = legacy(base, "retention");
  offseason.view(st);
  off = st["offseason"];
  equal(off["stage"], "retention");
  offseason.advance(st);
  equal(off["stage"], "departures");
  check_draft(st, stayed_ids(st));
  assert(off["redshirts"]["decided"]);
  offseason.advance(st);
  equal(off["stage"], "portal_w1");
  // an old save past both steps: nothing to redo
  st = legacy(base, "retention");
  st["offseason"]["stage"] = "portal_w2";
  const before = json_dumps(st["offseason"]["departures"]);
  offseason.view(st);
  assert(json_dumps(st["offseason"]["departures"]) === before && st["offseason"]["draft"]["done"]);
});

await run();
