// Filling a league file's teams (career_js/league_fill.js): a team of names lands on its target strength, ratings the
// file gives are kept exactly, empty and short rosters are filled the way real rosters look, a new team gets coaches,
// a program, a recruiting model and an identity, a built-in team keeps all the file does not change, and the same
// file and seed always give the same league. Then the league carries a career from season one.
// `node tests/test_league_fill.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random, json_dumps, sorted, round } from "../engine_js/pyrt.js";
import { mean, median } from "../engine_js/pystat.js";

const game = await start();
const { season, offseason, recruiting, files } = game;
const { league, league_file, league_fill, programs, game_scale } = game.modules;

const copy = (v) => JSON.parse(JSON.stringify(v));
const show = (v) => JSON.stringify(v);
const range = (n) => Array.from({ length: n }, (_, i) => i);
const times = (xs, n) => range(n).flatMap(() => xs);
const dumps = (v) => json_dumps(v, { sort_keys: true });
const same = (a, b) => dumps(a) === dumps(b);

const ATTRS = game_scale.keys();
const STR = league_fill.base_strengths();
const SLUG = "alder-tech";
const F = { offense: { QB: 1, HB: 1, WR: 3, TE: 1, LT: 1, LG: 1, C: 1, RG: 1, RT: 1 },
  defense: { LEDG: 1, REDG: 1, DT: 2, LB: 2, CB: 3, FS: 1, SS: 1 },
  special_teams: { K: 1, P: 1, KR: 1, PR: 1 } };
const M = { ...copy(league.base_meta("rice")), slug: SLUG, short_name: "Alder Tech", conference: "Big Sky East" };
const POSITIONS_85 = [...times(["QB"], 4), ...times(["RB"], 6), ...times(["WR"], 11), ...times(["TE"], 6), ...times(["LT", "LG", "C", "RG", "RT"], 3),
  ...times(["LEDG"], 4), ...times(["DT"], 7), ...times(["REDG"], 4), ...times(["SAM", "MIKE", "WILL"], 3), ...times(["CB"], 8), ...times(["FS"], 4),
  ...times(["SS"], 4), "K", "K", "P"];
const CONF = { id: "big-sky-east", name: "Big Sky East", level: "FBS", games: 8, members: [SLUG] };
const MWC_SLUGS = sorted(Object.entries(league_file._builtin()["team_conf"]).filter(([, c]) => c === "mountain-west").map(([s]) => s));
const MWC = { id: "mountain-west", name: "Mountain West", level: "FBS", games: 8, members: [...MWC_SLUGS, SLUG] };

const alder = (kw = {}) => ({ slug: SLUG, name: "Alder Tech", short_name: "Alder Tech", conference: "big-sky-east", state: "OR", formation: copy(F), ...kw });
const names = (positions) => positions.map((pos, i) => ({ name: `P${i}`, pos, class: "JR" }));
const without = (xs, ...drop) => { const out = [...xs]; for (const d of drop) out.splice(out.indexOf(d), 1); return out; };

const names_only = alder({ roster: names(POSITIONS_85) });
const names_only_rest = names(without(POSITIONS_85, "WR", "LT"));

/** The team overall the game gives a roster in Alder Tech's formation. */
function team_overall(roster) {
  const lgd = { year: 2026, attrs: ATTRS, teams: { [SLUG]: { roster, coaches: {}, formation: F, meta: M } } };
  return league.source_team(lgd, SLUG)["team_ratings"]["overall"];
}
const fill = (team, target, rng = null) => league_fill.fill_roster(team, target, rng || new Random("league-1-alder-tech"), ATTRS, new Set());
function group_counts(roster) {
  const out = {};
  for (const g of Object.keys(offseason.TARGET)) out[g] = 0;
  for (const c of roster) out[offseason.GROUP[c["pos"]]] += 1;
  return out;
}
const by_name = (roster) => Object.fromEntries(roster.map((c) => [c["n"], c]));
const rated = (c) => Object.fromEntries(ATTRS.map((k, i) => [k, c["r"][i]]));


// ---- one roster ----------------------------------------------------------------------------------

test("a roster of names only lands within two points of the strength asked for", () => {
  for (const grade of ["Elite", "Average", "Weak", 63]) {
    const team = { ...names_only, strength: grade };
    const tgt = league_fill.strength_target(team, CONF, STR);
    const [roster] = league_fill.fill_roster(team, tgt, new Random("league-1-alder-tech"), ATTRS, new Set());
    assert(Math.abs(team_overall(roster) - tgt) <= 2, show([grade, tgt, team_overall(roster)]));
  }
});

test("a strength grade is a place among the game's FBS teams; no grade is the FBS median", () => {
  const vals = sorted(Object.values(STR));
  equal(vals.length, league.base_slugs().filter((s) => !league.base_meta(s)["fictional"]).length);
  assert(league_fill.strength_target({ strength: 100 }, CONF, STR) === vals[vals.length - 1]);
  assert(league_fill.strength_target({ strength: 1 }, CONF, STR) > vals[0]);
  assert(league_fill.strength_target({}, CONF, STR) === median(vals));
  const [e, s, a, w] = ["Elite", "Strong", "Average", "Weak"].map((g) => league_fill.strength_target({ strength: g }, CONF, STR));
  assert(e > s && s > a && a > w, show([e, s, a, w]));
  assert(a === league_fill.strength_target({ strength: 50 }, CONF, STR));
});

test("a new team with no grade in a built-in conference sits inside that conference's spread", () => {
  const conf = MWC_SLUGS.map((s) => STR[s]);
  const tgt = league_fill.strength_target({ ...names_only, conference: "mountain-west" }, MWC, STR);
  assert(Math.abs(tgt - mean(conf)) < 1e-9);
  const got = team_overall(fill(names_only, tgt)[0]);
  assert(Math.min(...conf) <= got && got <= Math.max(...conf), show([Math.min(...conf), got, Math.max(...conf)]));
});

// what the file says about a player is the player's: the fill only makes up what is missing
test("an overall or a rating the file gives is kept exactly, and the made-up skills hold his overall", () => {
  const given = [{ name: "Max Lee", pos: "WR", class: "SO", overall: 74, stars: 4 },
    { name: "Al Cruz", pos: "LT", class: "SR", ratings: { pass_block: 82, run_block: 78 } },
    { name: "Ty West", pos: "CB", class: "JR", overall: 70, ratings: { speed: 90 } }];
  const [roster] = fill(alder({ roster: [...given, ...names_only_rest] }), 78.0);
  const by = by_name(roster);
  assert(by["Max Lee"]["o"] === 74 && league.overall(by["Max Lee"], ATTRS) === 74);
  let r = rated(by["Al Cruz"]);
  equal([r["pass_block"], r["run_block"]], [82, 78]);
  assert(by["Al Cruz"]["o"] === league.overall(by["Al Cruz"], ATTRS));
  r = rated(by["Ty West"]);
  assert(r["speed"] === 90 && by["Ty West"]["o"] === 70 && league.overall(by["Ty West"], ATTRS) === 70);
});

test("a player given in full is kept as he is; one whose overall disagrees is moved to it, and the summary says so", () => {
  const c = league.from_base(2027)["teams"]["rice"]["roster"][0];
  const doc = league_file.player_doc(c, ATTRS);
  let [roster, lines] = fill(alder({ roster: [doc, ...names_only_rest] }), 76.0);
  assert(same(roster[0], c) && !lines.some((ln) => ln.includes("ratings were moved")));
  const off = { ...doc, name: "Max Lee", id: null, overall: Math.min(99, doc["overall"] + 9) };
  [roster, lines] = fill(alder({ roster: [off, ...names_only_rest] }), 76.0);
  assert(roster[0]["o"] === off["overall"] && league.overall(roster[0], ATTRS) === off["overall"]);
  assert(lines.includes(`Alder Tech: Max Lee's ratings were moved to match his overall ${off["overall"]}.`), show(lines));
});

test("fitting ratings to an overall hits it, moves only the skills allowed, and leaves a fit alone", () => {
  const ours = Object.fromEntries(ATTRS.map((k) => [k, 70]));
  for (const target of [60, 75, 90]) equal(game_scale.overall(league_fill.fit_overall(ours, "QB", target, ATTRS), "QB"), target);
  const keys = ["awareness", "throw_accuracy_deep"];
  const out = league_fill.fit_overall(ours, "QB", 80, keys);
  assert(ATTRS.every((k) => keys.includes(k) || out[k] === 70) && Math.abs(out[keys[0]] - out[keys[1]]) <= 1);
  assert(same(league_fill.fit_overall(ours, "QB", game_scale.overall(ours, "QB"), ATTRS), ours));
});

test("an empty roster becomes 85 players by the position targets, each with his own id and name", () => {
  const [roster, lines] = fill(alder({ roster: [] }), 76.0);
  equal(roster.length, 85);
  equal(group_counts(roster), { ...offseason.TARGET });
  assert(lines.includes("Alder Tech: 85 players generated (the roster was empty)."), show(lines));
  assert(new Set(roster.map((c) => c["id"])).size === 85 && new Set(roster.map((c) => c["n"])).size === 85);
  assert(roster.every((c) => c["id"].startsWith("alder-tech-")));
  assert(Math.abs(team_overall(roster) - 76.0) <= 2);
});

// a team must be able to line up: the fill adds what a short roster lacks and says how many
test("a short roster is topped up to the position floors, the file's players first", () => {
  const two = [{ name: "Jay Smith", pos: "QB", class: "JR" }, { name: "Bo Jones", pos: "QB", class: "SO" }];
  let [roster, lines] = fill(alder({ roster: two }), 76.0);
  const counts = group_counts(roster);
  assert(Object.entries(offseason.FLOOR).every(([g, n]) => counts[g] >= n), show(counts));
  equal(roster.slice(0, 2).map((c) => c["n"]), ["Jay Smith", "Bo Jones"]);
  const added = Object.values(offseason.FLOOR).reduce((a, b) => a + b, 0) - 2;
  assert(lines.includes(`Alder Tech: ${added} players added to reach the position floors (1 QB, 3 RB, 6 WR, 3 TE, 10 OL, 9 DL, 5 LB, 5 CB, 4 S, 1 K, 1 P).`), show(lines));
  [roster, lines] = fill(alder({ roster: names(POSITIONS_85.filter((p) => p !== "K")) }), 76.0);
  assert(lines.includes("Alder Tech: 1 player added to reach the position floors (1 K)."), show(lines));
  equal(group_counts(roster)["K"], 1);
});

test("a player's id is made from his team and name, a given id is kept, and none is used twice", () => {
  const taken = new Set(["alder-tech-p1"]);
  const team = alder({ roster: [{ name: "P1", pos: "QB", class: "JR" }, { name: "Zed", pos: "QB", class: "JR", id: "zed-9" }] });
  const [roster] = league_fill.fill_roster(team, 74.0, new Random(1), ATTRS, taken);
  assert(roster[0]["id"] === "alder-tech-p1-2" && roster[1]["id"] === "zed-9", show(roster.slice(0, 2).map((c) => c["id"])));
  equal(new Set(roster.map((c) => c["id"])).size, roster.length);
});

test("the file's depth chart decides who is made the best at a position", () => {
  const qbs = range(3).map((i) => ({ name: `Q${i}`, pos: "QB", class: "JR" }));
  const [roster] = fill(alder({ roster: [...qbs, ...names_only_rest.slice(4)], depth_chart: { QB: ["Q2"] } }), 76.0);
  const by = by_name(roster);
  assert(by["Q2"]["o"] > by["Q0"]["o"] && by["Q2"]["o"] > by["Q1"]["o"]);
});

test("the same roster and seed give the same players; another seed gives others", () => {
  const a = fill(names_only, 76.0, new Random("league-7-alder-tech"));
  const b = fill(names_only, 76.0, new Random("league-7-alder-tech"));
  assert(dumps(a) === dumps(b));
  assert(dumps(a) !== dumps(fill(names_only, 76.0, new Random("league-8-alder-tech"))));
});

// generated rosters must look like the game's own: the same class mix, the same room to grow by class, and
// upperclassmen starting, or a custom team would develop (and lose players) unlike every other team
const CLASSES = ["FR", "FRRS", "SO", "SORS", "JR", "JRRS", "SR", "SRRS"];
let BUILT = null, EMPTY = null;
/** [class -> share of the built-in FBS players, class -> their mean room to potential per skill]. */
function built_in_by_class() {
  if (BUILT === null) {
    const room = Object.fromEntries(CLASSES.map((k) => [k, []]));
    for (const t of Object.values(league.from_base(league.FIRST_YEAR + 1)["teams"])) for (const c of t["roster"]) room[c["cls"]].push(mean(c["g"]));
    const n = Object.values(room).reduce((a, v) => a + v.length, 0);
    BUILT = [Object.fromEntries(CLASSES.map((k) => [k, room[k].length / n])), Object.fromEntries(CLASSES.map((k) => [k, mean(room[k])]))];
  }
  return BUILT;
}
function empty_rosters() {
  if (EMPTY === null) EMPTY = [72.0, 74.0, 76.0, 78.0, 80.0, 82.0].map((tgt, i) => fill(alder({ roster: [] }), tgt, new Random(`league-${i + 1}-alder-tech`))[0]);
  return EMPTY;
}

test("generated players have the room to grow their class has in the game's rosters; a fifth-year senior has none", () => {
  const want = built_in_by_class()[1];
  const got = Object.fromEntries(CLASSES.map((k) => [k, []]));
  for (const roster of empty_rosters()) {
    for (const c of roster) {
      got[c["cls"]].push(mean(c["g"]));
      if (c["cls"] === "SRRS") assert(!c["g"].some((x) => x), show(c));
    }
  }
  for (const k of CLASSES) assert(got[k].length && Math.abs(mean(got[k]) - want[k]) <= 1.5, show([k, got[k].length && mean(got[k]), want[k]]));
});

test("generated rosters have the game's class mix, and freshmen are at most a quarter of the starters", () => {
  const share = built_in_by_class()[0];
  const starters = [], mix = Object.fromEntries(CLASSES.map((k) => [k, 0]));
  for (const roster of empty_rosters()) {
    const by_pos = {};
    for (const c of roster) { (by_pos[c["pos"]] ||= []).push(c); mix[c["cls"]] += 1; }
    for (const [pos, ps] of Object.entries(by_pos)) starters.push(...sorted(ps, (c) => -c["o"]).slice(0, league_fill._starters_at(F, pos)));
  }
  const young = starters.filter((c) => ["FR", "FRRS"].includes(c["cls"])).length;
  assert(young <= starters.length / 4, show([young, starters.length]));
  const n = Object.values(mix).reduce((a, b) => a + b, 0);
  for (const k of CLASSES) assert(Math.abs(mix[k] / n - share[k]) <= 0.04, show([k, mix[k] / n, share[k]]));
});


// ---- to_league: a new team's coaches, program, recruiting model and identity -------------------

const ALDER_FILE = { format: "cfp-league/1", name: "My League", remove: ["kent-state"],
  conferences: [{ id: "big-sky-east", name: "Big Sky East", level: "FBS", games: 0 }],
  teams: [{ slug: SLUG, name: "Alder Tech", short_name: "Alder Tech", abbreviation: "ATU", mascot: "Owls",
    city: "Bend", state: "OR", lat: 44.05, lon: -121.31, conference: "big-sky-east",
    colors: { primary: { name: "Green", hex: "#0B6E4F" }, secondary: { name: "White", hex: "#FFFFFF" } },
    strength: "Average", prestige: 40, rivals: ["oregon-state"],
    coaches: { head: { name: "Pat Doe", rating: 60 }, oc: { name: "Sam Roe" }, offense: "Air Raid" },
    roster: [{ name: "Jay Smith", pos: "QB", class: "JR" }, { name: "Max Lee", pos: "WR", class: "SO" }],
    depth_chart: { QB: ["Jay Smith"] } }] };
const MINIMAL = { format: "cfp-league/1", teams: [{ slug: "owl-state", name: "Owl State", state: "OR", conference: "mountain-west" }] };

function to_league(doc, seed = 1) {
  equal(league_file.validate(doc), []);
  return league_fill.to_league(league_file.merge(copy(doc)), seed);
}
let ALDER_LEAGUE = null;
const alder_league = () => (ALDER_LEAGUE ||= to_league(ALDER_FILE));
const mwc_base = () => { const base = league.from_base(2026)["teams"]; return MWC_SLUGS.map((s) => base[s]); };

test("a new team comes out whole: staff, identity, program, recruiting model and depth chart from the file", () => {
  const [lgd, lines] = alder_league();
  const t = lgd["teams"][SLUG];
  for (const k of ["roster", "coaches", "formation", "program", "meta", "style"]) assert(k in t, k);
  const c = t["coaches"];
  assert(c["head_coach"]["name"] === "Pat Doe" && c["head_coach"]["ratings"]["overall"] === 60);
  assert(c["offensive_coordinator"]["name"] === "Sam Roe" && c["defensive_coordinator"]["name"]);
  equal(c["head_coach"]["scheme"]["offensive_philosophy"], "Air Raid");
  equal(c["offensive_coordinator"]["scheme"]["offensive_scheme"], "Air Raid");
  assert(Object.values(c).every((x) => x["team_slug"] === SLUG));
  assert(t["meta"]["colors"]["primary"]["hex"] === "#0B6E4F" && t["meta"]["conference"] === "Big Sky East");
  assert(t["meta"]["colors"]["accent"] === null);
  equal([...t["meta"]["rivals"]], ["oregon-state"]);
  const pg = t["program"];
  assert(pg["prestige"] === 40 && pg["history"] === 40 && pg["tier"] >= 1 && pg["tier"] <= 5);
  assert(pg["year"] === 2025 && pg["coach"] === 60 && pg["seasons"].length === 0);
  // a new program has sent nobody to the pros, and working it out again says the same
  assert(pg["pro"] === 0 && Object.keys(pg["pro_groups"]).length === 0 && pg["drafts"].length === 10 && pg["drafts"][9][0] === league.FIRST_YEAR - 1);
  programs.pro_recompute(pg, league.FIRST_YEAR - 1);
  assert(pg["pro"] === 0 && Object.keys(pg["pro_groups"]).length === 0);
  assert(t["meta"]["program"]["prestige"] === 3 && t["meta"]["program"]["generated"] === true);
  const rm = lgd["recruiting_models"][SLUG];
  equal([...rm["location"]], [44.05, -121.31]);
  equal(rm["top_states"][0][0], "OR");
  assert(lgd["source"]["name"] === "My League" && !("kent-state" in lgd["teams"]) && lgd["year"] === 2026);
  equal(lines[0], "Added 1 team, changed 0 and removed 1.");
  assert(lines.slice(1).some((ln) => ln.startsWith("Alder Tech: ") && ln.includes("added to reach the position floors")), show(lines));
  const jay = t["roster"].find((p) => p["n"] === "Jay Smith")["id"];
  equal(copy(t["depth"]), { QB: [jay] });
  const src = league.source_team(lgd, SLUG);
  equal(src["short_name"], "Alder Tech");
  assert(src["depth_chart"]["QB"][0] === jay && src["starters"]["offense"]["QB"][0] === jay, "the file's starter starts");
});

test("a new team plays the formation of a built-in team that runs its offense", () => {
  const t = alder_league()[0]["teams"][SLUG];
  const base = league.from_base(2026)["teams"];
  equal(base[t["style"]]["coaches"]["head_coach"]["scheme"]["offensive_philosophy"], "Air Raid");
  assert(same(t["formation"], base[t["style"]]["formation"]));
});

test("a new team given only a name, a state and a conference gets sensible defaults from them", () => {
  const [lgd, lines] = to_league(MINIMAL);
  const t = lgd["teams"]["owl-state"], m = t["meta"];
  assert(m["short_name"] === "Owl State" && m["abbreviation"] === "OS" && m["mascot"] === "State", show([m["short_name"], m["abbreviation"], m["mascot"]]));
  assert(m["colors"]["accent"] === null && same(m["colors"], league_fill.NEUTRAL_COLORS));
  assert(m["rivals"].length === 0 && Number.isInteger(m["program"]["home_field_advantage"]) && m["conference"] === "Mountain West");
  equal(m["stadium"]["name"], "Owl State Stadium");
  const [lat, lon] = league_fill.STATE_CENTER["OR"];
  assert(lat > 42 && lat < 46.5 && lon > -124.6 && lon < -116.5, "the state's center is inside the state");
  equal([...lgd["recruiting_models"]["owl-state"]["location"]], [lat, lon]);
  // its prestige is its conference's mean, its offense the conference's most common one
  const want = mean(mwc_base().map((b) => b["program"]["prestige"]));
  assert(Math.abs(t["program"]["prestige"] - want) < 1e-6);
  const heads = mwc_base().map((b) => b["coaches"]["head_coach"]["scheme"]["offensive_philosophy"]);
  const count = (w) => heads.filter((h) => h === w).length;
  const common = sorted([...new Set(heads)]).reduce((best, w) => (count(w) > count(best) ? w : best));
  equal(new Set(Object.keys(t["coaches"])), new Set(["head_coach", "offensive_coordinator", "defensive_coordinator"]));
  equal(t["coaches"]["head_coach"]["scheme"]["offensive_philosophy"], common);
  equal(t["roster"].length, 85);
  equal(lines[0], "Added 1 team, changed 0 and removed 0.");
  equal(lgd["source"]["format"], "cfp-league/1");
});

// Start plays exactly the league the check showed: that only holds if a seed fixes everything
test("the same file and seed give the same league; another seed gives the new team other players", () => {
  const a = league_fill.to_league(league_file.merge(copy(ALDER_FILE)), 3);
  const b = league_fill.to_league(league_file.merge(copy(ALDER_FILE)), 3);
  assert(dumps(a) === dumps(b));
  const c = league_fill.to_league(league_file.merge(copy(ALDER_FILE)), 4);
  assert(dumps(a[0]["teams"][SLUG]) !== dumps(c[0]["teams"][SLUG]));
  equal(league_fill.league_seed(new TextEncoder().encode("abc"), 7), 7);
  const s = league_fill.league_seed(new TextEncoder().encode("abc"), null);
  assert(Number.isInteger(s) && s === league_fill.league_seed(new TextEncoder().encode("abc"), null)
    && s !== league_fill.league_seed(new TextEncoder().encode("abd"), null), "with no seed asked for, the file's bytes are the seed");
});

test("no two players in the league share an id, even when a file gives one the fill would have made", () => {
  const doc = copy(ALDER_FILE);
  doc["teams"][0]["roster"] = [{ name: "P0", pos: "QB", class: "JR" }];
  delete doc["teams"][0]["depth_chart"];
  doc["teams"].push({ slug: "zeta-u", name: "Zeta U", state: "WA", conference: "big-sky-east",
    roster: [{ name: "Zed", pos: "QB", class: "JR", id: "alder-tech-p0" }] });
  const [lgd] = to_league(doc);
  const ids = Object.values(lgd["teams"]).flatMap((t) => t["roster"].map((c) => c["id"]));
  equal(ids.length, new Set(ids).size);
  equal(by_name(lgd["teams"]["zeta-u"]["roster"])["Zed"]["id"], "alder-tech-p0");
  assert(by_name(lgd["teams"][SLUG]["roster"])["P0"]["id"] !== "alder-tech-p0");
});

test("generated coaches never share a name with each other or with a coach in the league", () => {
  const doc = copy(ALDER_FILE);
  doc["teams"][0]["coaches"] = {};
  doc["teams"].push({ slug: "zeta-u", name: "Zeta U", state: "WA", conference: "big-sky-east", roster: [] });
  const [lgd] = league_fill.to_league(league_file.merge(doc), 1);
  const made = [SLUG, "zeta-u"].flatMap((s) => Object.values(lgd["teams"][s]["coaches"]).map((c) => c["name"].toLowerCase()));
  const others = new Set(Object.entries(lgd["teams"]).filter(([s]) => s !== SLUG && s !== "zeta-u")
    .flatMap(([, t]) => Object.values(t["coaches"]).filter((c) => c && c["name"]).map((c) => c["name"].toLowerCase())));
  assert(made.length === 6 && new Set(made).size === 6 && !made.some((n) => others.has(n)), show(made));
  const base = league.from_base(2026), team = { slug: "x" };
  const first = league_fill.coaches_for(team, { members: [] }, base, new Random(5), new Set());
  const taken = new Set(Object.values(first).map((c) => c["name"].toLowerCase()));
  const again = league_fill.coaches_for(team, { members: [] }, base, new Random(5), new Set(taken));   // the same draws, those names taken
  assert(!Object.values(again).some((c) => taken.has(c["name"].toLowerCase())));
});


// ---- a built-in team the file edits keeps everything the file does not change ---------------------

test("a built-in team with new prestige and colors keeps its roster, coaches and rivals; other teams are untouched", () => {
  const doc = { format: "cfp-league/1", name: "Rice Edit",
    teams: [{ slug: "rice", prestige: 70, colors: { primary: { name: "Red", hex: "#AA0000" }, secondary: { name: "White", hex: "#FFFFFF" } } }] };
  const [lgd, lines] = league_fill.to_league(league_file.merge(doc), 1);
  const base = league.from_base(2026)["teams"];
  const t = lgd["teams"]["rice"];
  equal(lines[0], "Added 0 teams, changed 1 and removed 0.");
  assert(t["program"]["prestige"] === 70 && t["program"]["history"] === 70);
  assert(t["meta"]["colors"]["primary"]["hex"] === "#AA0000" && t["meta"]["colors"]["accent"] === null);
  assert(t["meta"]["short_name"] === "Rice" && same(t["meta"]["rivals"], league.base_meta("rice")["rivals"]));
  assert(same(t["roster"], base["rice"]["roster"]) && same(t["coaches"], base["rice"]["coaches"]));
  assert(!("rice" in (lgd["recruiting_models"] || {})), "a team that has not moved recruits as it did");
  assert(same(lgd["teams"]["smu"], base["smu"]));
  // the stars the page shows follow the prestige given
  const m = league_fill.to_league(league_file.merge({ format: "cfp-league/1", teams: [{ slug: "rice", prestige: 90 }] }), 1)[0]["teams"]["rice"]["meta"];
  assert(m["program"]["prestige"] === 1 + round(5 * 90 / 100) && m["short_name"] === "Rice");
});

// Close to Home is measured from where the program is: a team moved to another state recruits from there
test("a built-in team moved to another state or spot gets a recruiting model for its new home", () => {
  const doc = { format: "cfp-league/1", teams: [{ slug: "rice", state: "OR" }, { slug: "smu", lat: 40.0, lon: -100.0 }] };
  const [lgd] = league_fill.to_league(league_file.merge(doc), 1);
  const rm = lgd["recruiting_models"];
  equal([...rm["rice"]["location"]], [...league_fill.STATE_CENTER["OR"]]);
  equal(rm["rice"]["top_states"][0][0], "OR");
  equal([...rm["smu"]["location"]], [40.0, -100.0]);
  equal(lgd["teams"]["rice"]["meta"]["state"], "OR");
});

function rice_with(coaches) {
  const doc = { format: "cfp-league/1", teams: [{ slug: "rice", coaches }] };
  equal(league_file.validate(doc), []);
  const merged = league_file.merge(doc);
  return [merged, league_fill.to_league(merged, 1)[0]];
}
const minus = (d, k) => { const out = { ...d }; delete out[k]; return out; };

test("changing a built-in team's offense keeps its coaches and changes only their scheme", () => {
  const base = league.from_base(2026)["teams"]["rice"]["coaches"];
  const [merged, lgd] = rice_with({ offense: "Air Raid" });
  const c = lgd["teams"]["rice"]["coaches"];
  equal(merged["changed"], ["rice"]);
  assert(same(c["defensive_coordinator"], base["defensive_coordinator"]));
  assert(same(c["head_coach"]["scheme"], { ...base["head_coach"]["scheme"], offensive_philosophy: "Air Raid" }));
  assert(same(c["offensive_coordinator"]["scheme"], { ...base["offensive_coordinator"]["scheme"], offensive_scheme: "Air Raid" }));
  assert(same(minus(c["head_coach"], "scheme"), minus(base["head_coach"], "scheme")));
  assert(same(minus(c["offensive_coordinator"], "scheme"), minus(base["offensive_coordinator"], "scheme")));
});

test("a head coach's name or rating given for a built-in team changes that and nothing else about the staff", () => {
  const lg0 = league.from_base(2026)["teams"]["rice"], base = lg0["coaches"];
  let c = rice_with({ head: { name: "Joe Q" } })[1]["teams"]["rice"]["coaches"];
  assert(same(c["head_coach"], { ...base["head_coach"], name: "Joe Q" }));
  assert(same(c["offensive_coordinator"], base["offensive_coordinator"]) && same(c["defensive_coordinator"], base["defensive_coordinator"]));
  const t = rice_with({ head: { rating: 80 } })[1]["teams"]["rice"];
  const hc = t["coaches"]["head_coach"];
  assert(hc["name"] === base["head_coach"]["name"] && hc["ratings"]["overall"] === 80 && !("rating" in hc));
  // his other ratings move with his overall
  const shift = 80 - base["head_coach"]["ratings"]["overall"];
  for (const [k, v] of Object.entries(base["head_coach"]["ratings"])) if (k !== "overall") equal(hc["ratings"][k], Math.max(1, Math.min(99, v + shift)));
  assert(same(t["coaches"]["offensive_coordinator"], base["offensive_coordinator"]) && same(t["coaches"]["defensive_coordinator"], base["defensive_coordinator"]));
  assert(t["program"]["coach"] === 80 && t["program"]["rating"] > lg0["program"]["rating"], "a better coach is a better program");
  // the staff written back as it is changes nothing: the file is still the built-in league
  const as_is = { format: "cfp-league/1", teams: [{ slug: "rice", coaches: copy(league_file._builtin_docs()["rice"]["coaches"]) }] };
  assert(league_file.merge(as_is)["builtin"] === true);
});


// ---- the career league from season one ---------------------------------------------------------

test("a league from a file is told from the built-in one, and lists its teams with the FCS stand-ins", () => {
  const base = league.from_base(2027);
  equal([...league.league_slugs(base)], [...league.base_slugs()]);
  assert(!league.is_imported(base) && !league.is_imported(null) && !league.is_imported({}));
  const lgd = alder_league()[0];
  const slugs = [...league.league_slugs(lgd)];
  assert(league.is_imported(lgd) && slugs.includes(SLUG) && !slugs.includes("kent-state"));
  assert(league.base_slugs().filter((s) => league.base_meta(s)["fictional"]).every((s) => slugs.includes(s)));
  equal(slugs, sorted(slugs));
  // a team's identity: the league's own for a team from the file, the game's for the rest
  assert(league.team_meta(null, "rice") === league.base_meta("rice"));
  const own = { teams: { [SLUG]: { meta: M } } };
  assert(league.team_meta(own, SLUG) === M && league.team_meta(own, "rice") === league.base_meta("rice"));
});

test("a preferred depth chart puts the named players first, in order, and changes nothing else", () => {
  const lgd = league.from_base(2026), e = lgd["teams"]["rice"];
  const roster = e["roster"].map((c) => league.expand(c, lgd["attrs"], league.base_meta("rice")));
  const shape = e["formation"];
  const [starters, depth] = league.lineup(roster, shape, 2026);
  assert(same(league.lineup(roster, shape, 2026, false, null), [starters, depth]));
  const backup = depth["QB"][1];
  const [s2, d2] = league.lineup(roster, shape, 2026, false, { QB: [backup] });
  assert(d2["QB"][0] === backup && same(s2["offense"]["QB"], [backup]));
  equal([...d2["QB"]].slice(1), depth["QB"].filter((s) => s !== backup));
  assert(same(d2["WR"], depth["WR"]));
  const two = [depth["QB"][2], depth["QB"][1]];
  equal(league.lineup(roster, shape, 2026, false, { QB: two })[1]["QB"].slice(0, 2), two);
  assert(same(league.lineup(roster, shape, 2026, false, { QB: ["nobody"] })[1]["QB"], depth["QB"]), "an unknown name is ignored");
});

test("the game builds a career's teams from its league file in season one; the built-in league needs no build", () => {
  const lgd = to_league(ALDER_FILE)[0];
  const st = { id: "lf-test", league: lgd, year: 2026, team: SLUG };
  try {
    const p = league.ensure_built(st);
    const teams = JSON.parse(files.read_text(p))["teams"];
    assert(SLUG in teams && !("kent-state" in teams));
    assert(teams[SLUG]["name"] === "Alder Tech" && teams[SLUG]["conference"] === "Big Sky East");
    assert(Object.values(teams).some((t) => t["fictional"]), "the FCS stand-ins are still there to fill schedules");
    assert(teams[SLUG]["offense"][0]["slug"].startsWith("alder-tech-"));
  } finally {
    league.forget("lf-test");
  }
  assert(league.ensure_built({ id: "x", league: league.from_base(2027), year: 2026 }) == null);
});

test("a new team's recruiting model has all a built-in one has, and is in play only while its league is", () => {
  const models = alder_league()[0]["recruiting_models"];
  const have = new Set(Object.keys(models[SLUG]));
  assert(Object.keys(recruiting.model()["teams"]["rice"]).every((k) => have.has(k)));
  assert(models[SLUG]["signees"] === 0 && models[SLUG]["avg_rating"] > 0 && models[SLUG]["avg_rating"] < 1);
  try {
    recruiting.use_league_models(models);
    assert(recruiting._team_model(SLUG) === models[SLUG]);
    assert(recruiting._team_model("ohio-state") === recruiting.model()["teams"]["ohio-state"]);
    recruiting.reset_caches();
    assert(recruiting._team_model(SLUG) === models[SLUG], "clearing the caches keeps the league's models");
    recruiting.use_league_models({});
    assert(Object.keys(recruiting._team_model(SLUG) || {}).length === 0, "the built-in league knows no Alder Tech");
  } finally {
    recruiting.use_league_models({});
  }
});

test("a new team recruits through a week like any other school", () => {
  const lgd = to_league(ALDER_FILE)[0];
  let st = { id: "lf-rec", league: lgd, year: 2026, team: SLUG };
  try {
    season.activate(st);
    assert(Object.keys(recruiting._team_model(SLUG)).length && SLUG in season.load_teams() && !("kent-state" in season.load_teams()));
    st = { ...season.new_season(SLUG, "full", 3, undefined, undefined, true), id: "lf-rec", league: lgd };
    season.activate(st);
    assert(recruiting.fbs_schools(st).includes(SLUG));
    st["career"]["settings"]["auto_recruit"] = true;
    recruiting.weekly_step(st, 1, true);
    const rc = st["recruiting"];
    const pid = Object.keys(rc["prospects"])[0];
    assert(recruiting.interest(st, SLUG, pid) >= 0 && recruiting.open_spots(st, SLUG) > 0);
    assert((rc["offers"][SLUG] || []).length && Object.keys(rc["lists"]).length && recruiting.weekly_hours(st, SLUG) > 0);
  } finally {
    season.use_league(null);
    recruiting.use_league_models({});
    league.forget("lf-rec");
  }
});

// the file's depth chart is who starts on day one; after a year of growth and departures the staff pick again
test("the file's depth chart lasts one season: the offseason drops it and keeps the league the file made", () => {
  const lgd = to_league(ALDER_FILE)[0];
  assert(lgd["teams"][SLUG]["depth"]);
  let st = { id: "lf-off", league: lgd, year: 2026, team: SLUG };
  try {
    season.activate(st);
    st = { ...season.new_season(SLUG, "full", 2, undefined, undefined, true), id: "lf-off", league: lgd };
    const teams = season.load_teams();
    for (const g of Object.values(st["games"])) Object.assign(g, { played: true, home_score: 24, away_score: 17 });
    const rc = st["recruiting"];
    const schools = Object.entries(teams).filter(([, t]) => !t["fictional"]).map(([s]) => s);
    sorted(Object.keys(rc["prospects"]), (q) => rc["prospects"][q]["rank"]).slice(0, schools.length * 21)
      .forEach((pid, i) => { rc["status"][pid]["signed"] = schools[i % schools.length]; });
    Object.assign(st, { done: true, current_week: season.FINAL_WEEK, champion: "ohio-state" });
    const off = offseason.start(st);
    assert(!Object.values(st["league"]["teams"]).some((t) => "depth" in t));
    assert(st["league"]["year"] === 2027 && SLUG in st["league"]["teams"] && league.is_imported(st["league"]));
    const mine = off["departures"].filter((d) => d["team"] === SLUG);
    assert(mine.every((d) => d["team_name"] === "Alder Tech"), show(mine.slice(0, 2)));
  } finally {
    season.use_league(null);
    recruiting.use_league_models({});
    league.forget("lf-off");
  }
});

await run();
