// Headquarters' Player Impact and Retention replacement links during the offseason: the replacement is a recruit of
// the signed high school class, which the portal weeks keep aside (prospects.class_rc); his Prospect Profile must
// still open then, not 404 "unknown prospect". And every Headquarters player row carries his slug for his player page.
// `node tests/test_hq_profile_links.mjs`
import { start, test, run, assert } from "./harness.mjs";
import { Random, sorted } from "../engine_js/pyrt.js";

const game = await start();
const { season, offseason } = game;
const { headquarters, prospects } = game.modules;

/** Every game played (the better team usually wins), every school's class signed, season over (tests/test_offseason). */
function finished(st) {
  const rng = new Random(1);
  const teams = season.load_teams();
  for (const g of Object.values(st["games"])) {
    const h = teams[g["home"]]["team_ratings"]["overall"], a = teams[g["away"]]["team_ratings"]["overall"];
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

function replacements(st) {
  return headquarters.outlook(st)["players"].filter((p) => p["replacement"]).map((p) => p["replacement"]);
}

function test_replacement_profile_opens_in_the_portal(st) {
  while (!st["offseason"]["stage"].startsWith("portal_w")) offseason.advance(st);
  const reps = replacements(st);
  assert(reps.length, "a replacement to open");
  for (const r of reps) {
    const prof = prospects.profile(st, r["pid"], st["team"]);
    assert(prof["public"]["name"] === r["name"], () => JSON.stringify([prof["public"]["name"], r["name"]]));
  }
}

function test_hq_players_carry_slugs(st) {
  assert(headquarters.outlook(st)["players"].every((p) => p["slug"]));
  const rows = headquarters.next_year(st)["groups"].flatMap((g) => g["players"]);
  assert(rows.length && rows.every((p) => p["slug"]), () => JSON.stringify(rows.slice(0, 2)));
}

/** In the offseason each of your players carries where he is now (offseason.player_next as `next`): a graduate
 *  reads Graduated, a portal entrant the portal or his new school. */
function test_outlook_shows_what_happened(st) {
  const players = headquarters.outlook(st)["players"];
  assert(players.length && players.every((p) => "next" in p));
  const kinds = new Set(players.filter((p) => p["next"]).map((p) => p["next"]["status"]));
  assert(kinds.has("graduated"), () => JSON.stringify([...kinds]));
}

const st = season.new_season("iowa", "full", 5, undefined, undefined, true);
finished(st);
offseason.start(st);
test("test_hq_players_carry_slugs", () => test_hq_players_carry_slugs(st));
test("test_outlook_shows_what_happened", () => {
  offseason.advance(st);                                  // past Keep Them Home: the departures are known
  test_outlook_shows_what_happened(st);
});
test("test_replacement_profile_opens_in_the_portal", () => {
  test_replacement_profile_opens_in_the_portal(st);
  console.log("hq profile links ok: a replacement's Prospect Profile opens in the portal weeks; Headquarters players carry their slugs");
});

await run();
