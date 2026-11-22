// Redshirts and position changes (career_js/offseason): at the Departures step you decide
// who takes his redshirt among the players who played four games or fewer and still have it; a
// player can move to another position, his overall recomputed for it; both apply to the league.
// `node tests/test_roster_moves.mjs`
import { start, test, run, assert, raises } from "./harness.mjs";
import { Random, sorted } from "../engine_js/pyrt.js";

const game = await start();
const { season, offseason } = game;

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

const by_id = (roster) => Object.fromEntries(roster.map((c) => [c["id"], c]));

test("roster moves", () => {
  const st = season.new_season("ohio-state", "full", 4, undefined, undefined, true);
  season.advance_to(st, 2);
  finished(st);
  const off = offseason.start(st);
  const me = st["team"];
  offseason.advance(st);                     // Keep Them Home first; the redshirt calls are Departures'
  assert(off["stage"] === "departures");
  const rs = off["redshirts"];
  assert(rs["players"].length && rs["players"].every((p) => ["id", "name", "pos", "cls", "games", "team_games", "overall", "redshirt"].every((k) => k in p)));
  assert(rs["players"].every((p) => p["games"] <= offseason.REDSHIRT_GAMES && !p["cls"].endsWith("RS") && ["FR", "SO", "JR"].includes(p["cls"])), () => JSON.stringify(rs["players"].slice(0, 2)));
  let roster = by_id(st["league"]["teams"][me]["roster"]);
  assert(rs["players"].every((p) => roster[p["id"]]["cls"] === p["cls"]), "classes advanced before the decision");
  const p0 = rs["players"][0];
  offseason.redshirt(st, p0["id"], true);
  assert(rs["players"].find((p) => p["id"] === p0["id"])["redshirt"] === true);
  const p1 = rs["players"].find((p) => p["id"] !== p0["id"]) ?? null;
  if (p1) offseason.redshirt(st, p1["id"], false);
  raises(() => { offseason.redshirt(st, "nobody", true); assert(false, "an unknown player redshirted"); }, offseason.RosterError);
  // a position change: his overall is the formula at the new spot, and the preview says so
  const mover = st["league"]["teams"][me]["roster"].find((c) => c["pos"] === "FS");
  const opts = offseason.position_options(st, mover["id"]);
  assert("pos" in opts[0] && "overall" in opts[0] && opts.some((o) => o["pos"] === "CB") && opts.some((o) => o["pos"] === "SAM"));
  const cb = opts.find((o) => o["pos"] === "CB");
  offseason.change_position(st, mover["id"], "CB");
  const shown = game.modules.shown;          // the preview is on the shown scale; the roster keeps the stored one
  assert(mover["pos"] === "CB" && shown.overall(mover["o"]) === cb["overall"] && mover["moved_from"] === "FS");
  assert(off["position_changes"].some((m) => m["id"] === mover["id"] && m["to"] === "CB"));
  raises(() => { offseason.change_position(st, mover["id"], "XX"); assert(false, "a made-up position"); }, offseason.RosterError);
  // advancing applies the redshirts: the chosen one keeps his year, the other moves up
  offseason.advance(st);
  roster = by_id(st["league"]["teams"][me]["roster"]);
  assert(roster[p0["id"]]["cls"] === p0["cls"] + "RS", () => roster[p0["id"]]["cls"]);
  if (p1) assert(roster[p1["id"]]["cls"] === offseason.NEXT_CLASS[p1["cls"]]);
  raises(() => { offseason.redshirt(st, p0["id"], false); assert(false, "redshirts changed after the step"); }, offseason.RosterError);
  const v = offseason.view(st);
  assert(v["redshirts"]["decided"] && v["position_changes"][0]["to"] === "CB");
  // the AI follows the four-game rule too: nobody who played five games takes a redshirt
  for (const [slug, t] of Object.entries(st["league"]["teams"])) {
    if (slug === me) continue;
    for (const c of t["roster"]) {
      if (c["cls"].endsWith("RS") && c["rs_year"] === off["year"] - 1) {
        assert((c["rs_games"] ?? 0) <= offseason.REDSHIRT_GAMES, () => JSON.stringify([slug, c["n"], c["rs_games"] ?? null]));
      }
    }
  }
  // the move holds on the next season's team
  st["offseason"]["auto"] = true;
  offseason.run_all(st);
  offseason.next_season(st);
  const t = season.load_teams()[me];
  const moved = [...t["offense"], ...t["defense"]].find((p) => p["slug"] === mover["id"]);
  assert(moved["position"] === "CB", () => moved["position"]);
  season.close_pool();
  console.log(`roster moves ok: ${rs["players"].length} redshirt candidates, ${mover["n"]} FS->CB at ${cb["overall"]} OVR`);
});

await run();
