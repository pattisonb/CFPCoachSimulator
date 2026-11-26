// Schedules for a league from a file (sim_js/schedule_gen.js given a league's own rules; league_file.schedule_rules
// and divisions): a new conference plays its own slate, listed rivals meet, divisions take added teams, removed teams
// leave the rules, whatever sizes the file check allows can be scheduled, and the built-in league's schedule is
// exactly what it always was.
// `node tests/test_league_schedule.mjs`
import crypto from "node:crypto";
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random, json_dumps, sorted } from "../engine_js/pyrt.js";

const game = await start();
const { season } = game;
const { league, league_file, league_fill, schedule_gen } = game.modules;

const copy = (v) => JSON.parse(JSON.stringify(v));
const show = (v) => JSON.stringify(v);
const range = (n) => Array.from({ length: n }, (_, i) => i);
const plain = (v) => JSON.parse(JSON.stringify(v));           // (for comparing with a literal)
const FORMAT = "cfp-league/1";

const BIG_SKY_EAST = ["alder-tech", "basalt-state", "cascade-tech", "deschutes", "elk-river", "fir-valley",
  "glacier-state", "high-desert", "ironwood", "juniper-state"];
const STATES = ["OR", "OR", "WA", "OR", "ID", "WA", "MT", "OR", "WA", "ID"];
const title = (slug) => slug.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
const new_team = (slug, state, conference, kw = {}) => ({ slug, name: title(slug), state, conference, ...kw });

const TEN_TEAM_BIG_SKY_EAST = { format: FORMAT, name: "Big Sky East League",
  conferences: [{ id: "big-sky-east", name: "Big Sky East", level: "FBS", games: 8 }],
  teams: BIG_SKY_EAST.map((s, i) => new_team(s, STATES[i], "big-sky-east", s === "alder-tech" ? { rivals: ["oregon-state"] } : {})) };
const ONE_SUN_BELT_TEAM = { format: FORMAT, teams: [new_team("gulf-coast-tech", "AL", "sun-belt")] };
const ONE_TEAM_NO_GAMES = { format: FORMAT, remove: ["kent-state"],
  conferences: [{ id: "big-sky-east", name: "Big Sky East", level: "FBS", games: 0 }],
  teams: [new_team("alder-tech", "OR", "big-sky-east", { rivals: ["oregon-state"] })] };

// The generator's output for the built-in league, seed 5, 2027 then 2028 (sha256 of the games and the history as
// sorted JSON, a whole-number float written without its ".0": `"fcs_shift": 0`).
// Recorded again when the FCS stand-ins got their names: the text hashed differs only in the 90 and 88
// `away_display` values that name one ("FCS Plains" then, "Plains Thunderheads" now); with the old labels put back it
// gives the digests recorded before (a3e087e6... and cc83c7f7...), so not a game moved.
// Recorded again when the FCS stand-ins' shifts became card points (9, 3 and -7 then, 3.6, 1.2 and -2.8 now): with the
// old shifts put back it gives the digests before (a2475fef... and 214d7519...), so again not a game moved.
const BUILTIN_DIGESTS = { 2027: "52eed37b1a9cd1fe1088852eb1d605e1d2f703de9e82532d413d3c41a7236107",
  2028: "462b14231b6962bccd834d79a78b944df4f7f6dc98f0860db9ed56855cf195e3" };

const built_teams = (lgd) => league.build(lgd)["teams"];

/** The engine's teams for a merged league without filling rosters: the built-in teams less the removed ones, plus
 * each added or changed team with what the generator reads. */
function quick_teams(merged) {
  const base = season.load_teams();
  const teams = {};
  for (const [s, t] of Object.entries(base)) if (!merged["removed"].includes(s)) teams[s] = t;
  for (const [s, t] of Object.entries(merged["teams"])) {
    if (merged["added"].includes(s) || merged["changed"].includes(s)) {
      teams[s] = { ...copy(base[s] || {}), name: t["name"], state: t["state"] ?? null, fictional: false,
        conference: league_file.engine_name(merged, t["conference"]) };
    }
  }
  return teams;
}

const pair = (g, a, b) => (g["home"] === a && g["away"] === b) || (g["home"] === b && g["away"] === a);
const meet = (games, a, b) => Object.values(games).some((g) => pair(g, a, b));

/** No "null", "None", "undefined" or "NaN" in what a game shows (its scores are empty until played). */
function no_null(g) {
  const shown = JSON.stringify(Object.fromEntries(Object.entries(g).filter(([, v]) => v !== null && v !== undefined)));
  return !["null", "None", "undefined", "NaN"].some((w) => shown.includes(w));
}

/** How many games each FBS team plays (`only`: a filter on the games). */
function counts(games, teams, only = () => true) {
  const out = {};
  for (const g of Object.values(games)) if (only(g)) for (const s of [g["home"], g["away"]]) if (!teams[s]["fictional"]) out[s] = (out[s] || 0) + 1;
  return out;
}

/** What every season's schedule must hold: twelve games for every FBS team, never two in a week, every game with
 * both names to show, and each conference's protected pairs played. */
function check_season(games, teams, rules) {
  const count = counts(games, teams);
  const off = Object.entries(count).filter(([, n]) => n !== 12);
  assert(!off.length, `teams without 12 games: ${show(off.slice(0, 6))}`);
  equal(new Set(Object.keys(count)), new Set(Object.entries(teams).filter(([, t]) => !t["fictional"]).map(([s]) => s)));
  const weeks = new Set();
  for (const g of Object.values(games)) {
    for (const s of [g["home"], g["away"]]) {
      if (teams[s]["fictional"]) continue;
      assert(!weeks.has(`${s}|${g["week"]}`), `${s} plays twice in week ${g["week"]}`);
      weeks.add(`${s}|${g["week"]}`);
    }
    assert(g["home_display"] && g["away_display"] && no_null(g), show(g));
  }
  for (const [name, rule] of Object.entries(rules["conferences"])) {
    const members = Object.entries(teams).filter(([, t]) => t["conference"] === name && !t["fictional"]).map(([s]) => s);
    for (const [a, b] of rule["protected"] || []) {
      assert(members.includes(a) && members.includes(b), show([name, a, b]));
      assert(meet(games, a, b), show([name, a, b]));
    }
  }
}

const generate = (year, teams, rules, seed = 1) =>
  schedule_gen.generate(year, teams, schedule_gen.empty_history(), new Random(`league-schedule-${seed}`), rules);
const conference_counts = (games) => {
  const out = {};
  for (const g of Object.values(games)) if (g["conference_game"]) for (const s of [g["home"], g["away"]]) out[s] = (out[s] || 0) + 1;
  return out;
};


test("a league's first schedule starts from an empty history, a fresh one each time", () => {
  equal(plain(schedule_gen.empty_history()), { pairs: {}, home_conf: {}, pending: [], years: [] });
  assert(schedule_gen.empty_history() !== schedule_gen.empty_history());
});

test("a new ten-team conference plays eight league games each, its listed rival, and the next season follows on", () => {
  equal(league_file.validate(TEN_TEAM_BIG_SKY_EAST), []);
  const merged = league_file.merge(copy(TEN_TEAM_BIG_SKY_EAST));
  const [lgd] = league_fill.to_league(merged, 1);
  equal(plain(lgd["schedule_rules"]), plain(league_file.schedule_rules(merged)));
  equal(plain(lgd["divisions"]), plain(league_file.divisions(merged)));
  const teams = built_teams(lgd);
  const [games, hist] = schedule_gen.generate(2026, teams, schedule_gen.empty_history(), new Random("league-schedule-1"), lgd["schedule_rules"]);
  const conf = Object.values(games).filter((g) => teams[g["home"]]["conference"] === "Big Sky East" && teams[g["away"]]["conference"] === "Big Sky East");
  for (const s of BIG_SKY_EAST) equal(conf.filter((g) => g["home"] === s || g["away"] === s).length, 8);
  assert(conf.every((g) => g["conference_game"]));
  assert(meet(games, "alder-tech", "oregon-state"), "the listed rival from another conference is on the schedule");
  check_season(games, teams, lgd["schedule_rules"]);
  equal([...hist["years"]], [2026]);
  const [games2, hist2] = schedule_gen.generate(2027, teams, hist, new Random(7), lgd["schedule_rules"]);
  check_season(games2, teams, lgd["schedule_rules"]);
  equal([...hist2["years"]], [2026, 2027]);
});

test("a new conference's rule: its games, an even home split, four non-conference games, and it is not a power conference", () => {
  const r = league_file.schedule_rules(league_file.merge(copy(TEN_TEAM_BIG_SKY_EAST)));
  equal(plain(r["conferences"]["Big Sky East"]), { games: 8, cycle: 2, home_split: "even", protected: [], finales: [],
    non_conference: { games: 4, power_road: [1, 2], fcs_max: 1 } });
  equal(plain(r["annual"]), [{ teams: ["alder-tech", "oregon-state"], name: "" }]);
  assert(!schedule_gen.rules()["power"].includes("Big Sky East"));
  const nine = { ...copy(TEN_TEAM_BIG_SKY_EAST), teams: copy(TEN_TEAM_BIG_SKY_EAST["teams"]).slice(0, 9) };
  equal(league_file.schedule_rules(league_file.merge(nine))["conferences"]["Big Sky East"]["cycle"], 1);   // nine teams, eight games: everyone every year
});

test("a rival in the same conference is a protected league game; one in another conference is played every year", () => {
  const doc = copy(TEN_TEAM_BIG_SKY_EAST);
  doc["teams"][1]["rivals"] = ["alder-tech", "oregon-state"];
  const merged = league_file.merge(doc);
  const r = league_file.schedule_rules(merged);
  equal(plain(r["conferences"]["Big Sky East"]["protected"]), [["alder-tech", "basalt-state"]]);
  equal(plain(r["annual"]), [{ teams: ["alder-tech", "oregon-state"], name: "" }, { teams: ["basalt-state", "oregon-state"], name: "" }]);
  const teams = quick_teams(merged);
  check_season(generate(2026, teams, r)[0], teams, r);
});

test("a team added to a conference with divisions joins the smaller one, and the division round robins still fit", () => {
  const merged = league_file.merge(copy(ONE_SUN_BELT_TEAM));
  const d = league_file.divisions(merged)["Sun Belt"];
  equal(sorted(Object.values(d).map((v) => v.length)), [7, 8]);
  assert(d["East"].includes("gulf-coast-tech"), "a tie goes to the first division in alphabetical order");
  const r = league_file.schedule_rules(merged);
  equal(plain(r["conferences"]["Sun Belt"]["divisions"]), plain(d));
  const teams = quick_teams(merged);
  for (const [year, seed] of [[2026, 1], [2026, 2], [2027, 3]]) {
    const [games] = generate(year, teams, r, seed);
    check_season(games, teams, r);
    const conf = conference_counts(games);
    const sb = Object.values(d).flat();
    assert(sb.every((s) => conf[s] >= 7 && conf[s] <= 8), show(sb.map((s) => [s, conf[s]])));   // at most one league game short
    for (const div of Object.values(d)) {
      div.forEach((a, i) => { for (const b of div.slice(i + 1)) assert(Object.values(games).some((g) => pair(g, a, b) && g["conference_game"]), show([a, b])); });
    }
  }
});

test("a removed team leaves its division; a division emptied ends the conference's divisions", () => {
  const sb = season.DIVISIONS["Sun Belt"];
  const d = league_file.divisions(league_file.merge({ format: FORMAT, remove: ["troy"] }))["Sun Belt"];
  equal(plain(d), { East: [...sb["East"]], West: sb["West"].filter((s) => s !== "troy") });
  const gone = league_file.merge({ format: FORMAT, remove: [...sb["West"]] });
  equal(plain(league_file.divisions(gone)), { "Sun Belt": {} });
  const r = league_file.schedule_rules(gone)["conferences"]["Sun Belt"];
  assert(!("divisions" in r) && !("cross_division" in r));
  equal(plain(league_file.divisions(league_file.merge({ format: FORMAT, remove: ["kent-state"] }))), {});
});

test("a career reads its league's divisions, the game's own otherwise", () => {
  equal(plain(season.divisions({})), plain(season.DIVISIONS));
  equal(plain(season.divisions({ league: { divisions: { "Sun Belt": {} } } })), {});
  const mine = { East: ["a"], West: ["b"] };
  equal(plain(season.divisions({ league: { divisions: { "Sun Belt": mine } } })), { "Sun Belt": mine });
  equal(season.division_of("Sun Belt", "troy"), "West");
  equal(season.division_of("Sun Belt", "a", { "Sun Belt": mine }), "East");
  assert(season.division_of("Sun Belt", "troy", {}) == null);
});

test("a removed team drops out of its conference's protected games and finales; untouched conferences keep their rule", () => {
  let r = league_file.schedule_rules(league_file.merge({ format: FORMAT, remove: ["kent-state"] }));
  assert(r["conferences"]["MAC"]["protected"].every((p) => !p.includes("kent-state")));
  r = league_file.schedule_rules(league_file.merge({ format: FORMAT, remove: ["toledo", "clemson", "usc"] }));
  const has = (pairs, a, b) => pairs.some((p) => p[0] === a && p[1] === b);
  assert(!has(r["conferences"]["MAC"]["protected"], "toledo", "bowling-green") && !has(r["conferences"]["MAC"]["finales"], "toledo", "bowling-green"));
  assert(!Object.values(r["conferences"]["ACC"]["eight_game_team"]).includes("clemson"));
  assert([...r["conferences"]["Big Ten"]["protected"], ...r["conferences"]["Big Ten"]["finales"]].every((p) => !p.includes("usc")));
  assert(!("SEC" in r["conferences"]));
  const pac = league_file.schedule_rules(league_file.merge({ format: FORMAT, remove: ["oregon-state"] }));
  assert(!("round_robin" in pac["conferences"]["Pac-12"]), "seven teams cannot play seven games each");
  equal(pac["conferences"]["Pac-12"]["games"], 7);
});

test("a file that changes no conference gives no rules of its own", () => {
  const r = league_file.schedule_rules(league_file.merge({ format: FORMAT, teams: [{ slug: "rice", prestige: 55 }] }));
  equal(plain(r), { conferences: {}, annual: [] });
  equal(plain(league_file.divisions(league_file.merge({ format: FORMAT }))), {});
});

test("a one-team conference with no league games still gets twelve games and its rival", () => {
  const merged = league_file.merge(copy(ONE_TEAM_NO_GAMES));
  const r = league_file.schedule_rules(merged);
  equal(r["conferences"]["Big Sky East"]["games"], 0);
  const teams = quick_teams(merged);
  const [games] = generate(2026, teams, r);
  check_season(games, teams, r);
  assert(meet(games, "alder-tech", "oregon-state"));
});

// the file check and the generator must agree: a file that passes the check and then cannot be scheduled is a
// career that fails at Start
test("every conference size and games count the file check allows can be scheduled, two seasons running", () => {
  for (const [n, g] of [[9, 8], [8, 7], [9, 7], [11, 9], [12, 11], [6, 4], [5, 3], [2, 1], [3, 2]]) {
    const doc = { format: FORMAT, conferences: [{ id: "big-sky-east", name: "Big Sky East", level: "FBS", games: g }],
      teams: range(n).map((i) => new_team(`new-school-${i}`, ["OR", "WA", "ID", "TX", "OH"][i % 5], "big-sky-east")) };
    equal(league_file.validate(doc), [], show([n, g]));
    const merged = league_file.merge(doc);
    const r = league_file.schedule_rules(merged);
    const teams = quick_teams(merged);
    let [games, hist] = generate(2026, teams, r, n * 100 + g);
    check_season(games, teams, r);
    const conf = Object.entries(conference_counts(games)).filter(([s]) => s.startsWith("new-school")).map(([, c]) => c);
    // everyone plays `g` league games, except one team one short when the count is odd
    assert(conf.reduce((a, b) => a + b, 0) === n * g - (n * g) % 2 && Math.max(...conf) === g, show([n, g, conf]));
    [games] = schedule_gen.generate(2027, teams, hist, new Random(n), r);
    check_season(games, teams, r);
  }
  const too_many = { format: FORMAT, conferences: [{ id: "big-sky-east", name: "Big Sky East", level: "FBS", games: 8 }],
    teams: range(8).map((i) => new_team(`new-school-${i}`, "OR", "big-sky-east")) };
  assert(league_file.validate(too_many).length, "eight teams cannot play eight each");
});

test("a built-in conference grown, shrunk or given other games still schedules", () => {
  const docs = [
    { format: FORMAT, remove: ["kent-state", "akron", "ohio"] },
    { format: FORMAT, conferences: [{ id: "mac", name: "MAC", level: "FBS", games: 10 }] },
    { format: FORMAT, conferences: [{ id: "sun-belt", name: "Sun Belt", level: "FBS", games: 10 }],
      teams: range(3).map((i) => new_team(`bayou-${i}`, "LA", "sun-belt")) },
    { format: FORMAT, conferences: [{ id: "sun-belt", name: "Sun Belt", level: "FBS", games: 5 }] },
    { format: FORMAT, teams: [new_team("owl-state", "OR", "pac-12"), new_team("hawk-tech", "TX", "sec"), { slug: "toledo", conference: "mountain-west" }] },
  ];
  docs.forEach((doc, i) => {
    equal(league_file.validate(doc), [], String(i));
    const merged = league_file.merge(doc);
    const r = league_file.schedule_rules(merged);
    const teams = quick_teams(merged);
    for (const year of [2026, 2028]) check_season(generate(year, teams, r, i)[0], teams, r);
  });
});

// the engine keeps a built-in conference's own name (its rules, bowls and polls hang on it); the new name is for the page
test("a renamed built-in conference keeps its engine name, with its new games and its added team", () => {
  const doc = { format: FORMAT, conferences: [{ id: "sun-belt", name: "Southern Belt", level: "FBS", games: 9 }],
    teams: [new_team("gulf-coast-tech", "AL", "sun-belt")] };
  equal(league_file.validate(doc), []);
  const merged = league_file.merge(doc);
  const [lgd] = league_fill.to_league(merged, 1);
  equal(plain(lgd["conference_names"]), { "Sun Belt": "Southern Belt" });
  equal(Object.keys(lgd["schedule_rules"]["conferences"]), ["Sun Belt"]);
  equal(Object.keys(lgd["divisions"]), ["Sun Belt"]);
  equal(lgd["schedule_rules"]["conferences"]["Sun Belt"]["games"], 9);
  const teams = built_teams(lgd);
  const members = sorted(Object.entries(teams).filter(([, t]) => t["conference"] === "Sun Belt").map(([s]) => s));
  equal(members, sorted(merged["conferences"]["sun-belt"]["members"]));
  assert(members.includes("gulf-coast-tech") && !Object.values(teams).some((t) => t["conference"] === "Southern Belt"));
  const [games] = generate(2026, teams, lgd["schedule_rules"]);
  check_season(games, teams, lgd["schedule_rules"]);
  const conf = conference_counts(games);
  assert(members.every((s) => conf[s] >= 8 && conf[s] <= 9) && Math.max(...members.map((s) => conf[s])) === 9);
});

test("a rename with a new games count applies the games; a rename alone changes no rule", () => {
  const merged = league_file.merge({ format: FORMAT, conferences: [{ id: "mac", name: "Mid-American", level: "FBS", games: 9 }] });
  const r = league_file.schedule_rules(merged);
  equal(Object.keys(r["conferences"]), ["MAC"]);
  assert(r["conferences"]["MAC"]["games"] === 9 && !("games_from" in r["conferences"]["MAC"]));
  equal(plain(league_file.conference_names(merged)), { MAC: "Mid-American" });
  const teams = quick_teams(merged);
  const [games] = generate(2026, teams, r);
  check_season(games, teams, r);
  const mac = Object.entries(teams).filter(([, t]) => t["conference"] === "MAC").map(([s]) => s);
  const conf = conference_counts(games);
  const n = mac.length;
  assert(mac.reduce((a, s) => a + conf[s], 0) === n * 9 - (n * 9) % 2 && Math.max(...mac.map((s) => conf[s])) === 9);
  const only_rename = league_file.merge({ format: FORMAT, conferences: [{ id: "mac", name: "Mid-American", games: league_file._builtin()["games"]["mac"] }] });
  equal(plain(league_file.schedule_rules(only_rename)), { conferences: {}, annual: [] });
});

// a Group of Five team's game with a power-conference team is a pay game at the power team's place, never returned
test("a renamed power conference is still a power conference", () => {
  const doc = { format: FORMAT, conferences: [{ id: "sec", name: "Southeastern", level: "FBS", games: 9 }], teams: [new_team("hawk-tech", "TX", "sec")] };
  equal(league_file.validate(doc), []);
  const merged = league_file.merge(doc);
  const r = league_file.schedule_rules(merged);
  equal(Object.keys(r["conferences"]), ["SEC"]);
  assert(schedule_gen.rules()["power"].includes("SEC"));
  equal(plain(league_file.conference_names(merged)), { SEC: "Southeastern" });
  equal(league_fill.to_league(merged, 1)[0]["teams"]["hawk-tech"]["meta"]["conference"], "SEC");
  const teams = quick_teams(merged);
  equal(teams["hawk-tech"]["conference"], "SEC");
  const [games, hist] = generate(2026, teams, r);
  check_season(games, teams, r);
  const rules = schedule_gen.rules();
  const sec = new Set(Object.entries(teams).filter(([, t]) => t["conference"] === "SEC").map(([s]) => s));
  const power = new Set([...Object.entries(teams).filter(([, t]) => rules["power"].includes(t["conference"])).map(([s]) => s), ...rules["power_independents"]]);
  const g5 = new Set(Object.entries(teams).filter(([s, t]) => !t["fictional"] && !power.has(s)).map(([s]) => s));
  assert(Object.values(games).some((g) => sec.has(g["home"]) && g5.has(g["away"])));
  assert(!Object.values(games).some((g) => g5.has(g["home"]) && sec.has(g["away"])));
  assert(!hist["pending"].some((p) => [p["home"], p["away"]].some((s) => sec.has(s)) && [p["home"], p["away"]].some((s) => g5.has(s))));
});

test("a team moved to another conference still plays its old rival, as a non-conference game", () => {
  const doc = { format: FORMAT, teams: [{ slug: "toledo", conference: "mountain-west" }] };
  equal(league_file.validate(doc), []);
  const merged = league_file.merge(doc);
  const r = league_file.schedule_rules(merged);
  assert(plain(r["annual"]).some((a) => a["teams"][0] === "bowling-green" && a["teams"][1] === "toledo" && a["name"] === ""), show(r["annual"]));
  const teams = quick_teams(merged);
  equal(teams["toledo"]["conference"], "Mountain West");
  const [games] = generate(2026, teams, r);
  check_season(games, teams, r);
  const g = Object.values(games).filter((x) => pair(x, "bowling-green", "toledo"));
  assert(g.length === 1 && !g[0]["conference_game"]);
});

// a league's own rules are an addition: with none, the generator must not move a single game of the built-in league
test("the built-in league's schedule is unchanged: empty rules give the same games, and 2027 and 2028 match their recorded digests", () => {
  const T = season.load_teams();
  const H = schedule_gen.seed_history(T);
  const text = (v) => json_dumps(v, { sort_keys: true });
  const a = text(schedule_gen.generate(2027, T, H, new Random(5))[0]);
  assert(a === text(schedule_gen.generate(2027, T, H, new Random(5), null)[0]));
  assert(a === text(schedule_gen.generate(2027, T, H, new Random(5), { conferences: {}, annual: [] })[0]));
  const rng = new Random(5);
  let h = H, g;
  for (const year of [2027, 2028]) {
    [g, h] = schedule_gen.generate(year, T, h, rng, null);
    equal(crypto.createHash("sha256").update(text([g, h]), "utf8").digest("hex"), BUILTIN_DIGESTS[year], String(year));
  }
});

await run();
