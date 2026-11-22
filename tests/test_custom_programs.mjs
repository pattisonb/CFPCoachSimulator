// Custom Programs: the page builds the league file the game already imports. The game's side of it: the programs
// list for the page, a program shaped as the builder writes it passes the check, an edit of a built-in program keeps
// its roster, rivalries can be named, occasional or played in rivalry week, a program recruits from where it is, and
// a career at a custom program stays in the saves list.
// `node tests/test_custom_programs.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";

const game = await start({ env: { SIM_WORKERS: "1", CFP_SEASONS_DIR: "data/seasons-custom-test" } });
const { api, season } = game;
const { league_file, league_fill, schedule_gen } = game.modules;

const show = (v) => JSON.stringify(v);
const plain = (v) => JSON.parse(JSON.stringify(v));
const bytes = (doc) => new TextEncoder().encode(JSON.stringify(doc));
const file = (teams, conferences = []) => bytes({ format: "cfp-league/1", name: "Custom Programs", year: 2026, conferences, teams });
const ALDER = { slug: "alder-tech", name: "Alder Tech", conference: "mountain-west" };
/** The check's answer for a file of these teams, which must pass. */
function checked(...teams) {
  const r = league_file.check(file(teams), 3);
  assert(r["ok"], show(r["errors"]));
  return r;
}

// The list is names only, never the whole league file: the page asks for it on every visit. A built-in team's full
// details come one team at a time, when you edit it.
test("the programs list is names, conferences and playbooks; one program's details come on their own", () => {
  const r = api.call("GET", "/api/league/programs");
  assert(r["teams"].length >= 130 && r["conferences"].length >= 10);
  const t = r["teams"].find((x) => x["slug"] === "akron");
  equal(new Set(Object.keys(t)), new Set(["slug", "name", "short_name", "abbreviation", "conference", "level"]));
  equal(t["conference"], "mac");
  assert(r["playbooks"]["offense"].includes("Spread RPO") && r["playbooks"]["defense"].includes("4-3"), show(r["playbooks"]));
  const d = api.call("GET", "/api/league/programs/akron");
  for (const k of ["name", "short_name", "abbreviation", "mascot", "city", "state", "conference", "colors", "prestige", "rivals", "offense", "defense"]) assert(k in d, k);
  assert(d["conference"] === "mac" && d["colors"]["primary"]["hex"] && d["offense"]);
  let status = null;
  try { api.call("GET", "/api/league/programs/no-such"); } catch (e) { status = e.status; }
  equal(status, 404);
});

test("a new program with a few players passes the check and makes the schedule be rebuilt", () => {
  const r = checked({ ...ALDER, roster: [{ name: "Jay Smith", pos: "QB", class: "JR" }, { name: "Max Lee", pos: "WR", class: "SO" }, { name: "Al Cruz", pos: "LT", class: "SR" }] });
  assert(r["summary"]["added"] === 1 && r["summary"]["structural"] === true, show(r["summary"]));
});

test("an edit of a built-in program's name and colors keeps its roster and the real schedule", () => {
  const r = checked({ slug: "akron", name: "Akron Rubber", colors: { primary: { name: "Gold", hex: "#C9A227" } } });
  assert(r["summary"]["changed"] === 1 && !r["summary"]["structural"], show(r["summary"]));
  assert(r["league"]["teams"]["akron"]["roster"].length >= 80);
});

test("a problem with a program is a sentence that names what is wrong", () => {
  const r = league_file.check(file([{ ...ALDER, conference: "big-sky-e" }]), 3);
  assert(!r["ok"] && r["errors"].some((e) => e.includes("big-sky-e") && e.endsWith(".")), show(r["errors"]));
});

test("coaches, playbooks and rivals given by the builder reach the league", () => {
  const r = checked({ ...ALDER, rivals: ["boise-state", "air-force"],
    coaches: { head: { name: "Pat Doe" }, oc: { name: "Sam Roe" }, dc: { name: "Lee Poe" }, offense: "Spread RPO", defense: "4-3" } });
  const t = r["league"]["teams"]["alder-tech"];
  assert(t["coaches"]["head_coach"]["name"] === "Pat Doe" && t["coaches"]["offensive_coordinator"]["name"] === "Sam Roe");
  const rivals = t["meta"]["rivals"] || [];
  assert(rivals.includes("boise-state") && rivals.includes("air-force"), show(rivals));
});

// A rival may carry a name: {slug, name}. The career's league keeps it and the game's rivalry lookup reads it for
// that career (the Office's game card, the schedule).
test("a named rivalry is kept by the league and read for that career; the game's own rivalries still read", () => {
  const r = checked({ ...ALDER, rivals: [{ slug: "boise-state", name: "Battle for the Bell" }, "air-force"] });
  equal((r["league"]["rivalries"] || []).map((x) => [[...x["teams"]].sort(), x["name"]]), [[["alder-tech", "boise-state"], "Battle for the Bell"]]);
  const rivals = r["league"]["teams"]["alder-tech"]["meta"]["rivals"];
  assert(rivals.includes("boise-state") && rivals.includes("air-force"));
  const st = { league: r["league"] };
  equal(season.rivalry_for("boise-state", "alder-tech", st)["name"], "Battle for the Bell");
  assert(season.rivalry_for("ohio-state", "michigan", st)["name"]);
  const long = league_file.check(file([{ ...ALDER, rivals: [{ slug: "boise-state", name: "x".repeat(61) }] }]), 3);
  assert(!long["ok"] && long["errors"].some((e) => e.toLowerCase().includes("rivalry name")), show(long["errors"]));
});

// A rival marked every_year false is a rivalry with no reserved game: not among the team's scheduled rivals, but the
// career still knows it by name (an unnamed one reads "Alder Tech vs. Air Force").
test("a rivalry played only some years is known by name but not scheduled every year", () => {
  const r = checked({ ...ALDER, short_name: "Alder Tech",
    rivals: [{ slug: "boise-state", name: "Battle for the Bell", every_year: false }, { slug: "air-force", every_year: false }, "nevada"] });
  equal([...r["league"]["teams"]["alder-tech"]["meta"]["rivals"]], ["nevada"]);
  const st = { league: r["league"] };
  equal(season.rivalry_for("alder-tech", "boise-state", st)["name"], "Battle for the Bell");
  equal(season.rivalry_for("air-force", "alder-tech", st)["name"], "Alder Tech vs. Air Force");
});

test("a rival marked for rivalry week is played in the season's last week, every year; a team has only one", () => {
  const team = { ...ALDER, rivals: [{ slug: "oregon-state", name: "Cascade Clash", rivalry_week: true }] };
  const r = checked(team);
  const games = Object.values(r["games"]).filter((g) => [g["home"], g["away"]].sort().join() === "alder-tech,oregon-state");
  assert(games.length && games.every((g) => g["week"] === schedule_gen.FINALE_WEEK), show(games.map((g) => g["week"])));
  assert(r["league"]["schedule_rules"]["annual"].some((a) => a["finale"] && [...a["teams"]].sort().join() === "alder-tech,oregon-state"), "later seasons keep it");
  team["rivals"].push({ slug: "boise-state", rivalry_week: true });
  const two = league_file.check(file([team]), 3);
  assert(!two["ok"] && two["errors"].some((e) => e.includes("only one rival")), show(two["errors"]));
});

// Close to Home measures from the program's spot: a lat/lon given, else its city found in the game's town list, else
// the state's center. A built-in team that changes city moves too.
test("a program recruits from where it is: its coordinates, else its city, else its state's center", () => {
  // (the league without its engine teams or schedule, which the spot does not need: a check takes ten times as long)
  const spot = (team) => {
    const doc = { format: "cfp-league/1", teams: [team] };
    equal(league_file.validate(doc), []);
    return plain(league_fill.to_league(league_file.merge(doc), 3)[0]["recruiting_models"][team["slug"]]["location"]);
  };
  equal(spot({ ...ALDER, city: "Bend", state: "OR" }), [44.058, -121.315]);
  equal(spot({ ...ALDER, city: "Nowhere Junction", state: "OR" }), [...league_fill.STATE_CENTER["OR"]]);
  equal(spot({ ...ALDER, city: "Bend", state: "OR", lat: 45.0, lon: -120.0 }), [45.0, -120.0]);
  equal(spot({ ...ALDER, city: "el paso", state: "TX" }), [31.775, -106.465]);          // case does not matter
  equal(spot({ slug: "akron", city: "Cleveland" }), [41.505, -81.693]);                  // an edit that changes city moves
});

// The player's report: a career at a custom program vanished from the list after the program was edited and checked
// again (its card was built on whatever league was in play). It must stay listed, and open.
test("a career at a custom program stays in the saves list after another league is checked", () => {
  const doc = { format: "cfp-league/1", name: "t", year: 2026, conferences: [],
    teams: [{ slug: "alder-tech", name: "Alder Tech", conference: "mountain-west", state: "OR", level: "FBS" }] };
  const r = api.call("POST", "/api/league/check", bytes(doc));
  const sid = api.call("POST", "/api/season", { team: "alder-tech", league: r["key"], seed: 3 })["id"];
  api.call("POST", "/api/season", { team: "iowa", seed: 4 });
  doc["teams"][0]["name"] = "Alder Tech Owls";                                  // the program edited and checked again
  api.call("POST", "/api/league/check", bytes(doc));
  for (const k of Object.keys(api._cards)) delete api._cards[k];                // a cold card cache (a restart)
  const card = api.call("GET", "/api/seasons")["seasons"].find((c) => c["id"] === sid);
  assert(card, "the custom career is listed");
  assert(card["team_name"] && card["wins"] === 0 && card["losses"] === 0, show(card));
  equal(api.call("GET", `/api/season/${sid}`)["team"], "alder-tech");
  api.call("DELETE", "/api/seasons");
});

// The campus map's towns: the state's major cities first (always drawn and named: Boise, not only Meridian), then the
// recruits' hometowns, none twice.
test("a state's towns for the campus map list its major cities first and no town twice", () => {
  const d = api.call("GET", "/api/league/towns/ID");
  const names = d["towns"].map((t) => t["name"]);
  const majors = d["towns"].filter((t) => t["major"]).map((t) => t["name"]);
  assert(majors[0] === "Boise", show(names.slice(0, 8)));
  equal(names.slice(0, majors.length), majors);
  equal(names.length, new Set(names.map((n) => n.toLowerCase())).size);
  equal(api.call("GET", "/api/league/towns/ZZ")["towns"], []);
});

await run();
