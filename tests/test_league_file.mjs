// The league as a file (career_js/league_file.js): the game's own league exported reads back as exactly the league
// the game builds; a custom file is checked field by field and every problem is a plain sentence (never a crash,
// never a stand-in's name); a file is merged over the built-in league, and what it changes decides whether the
// schedule is rebuilt.
// `node tests/test_league_file.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { json_dumps, sorted } from "../engine_js/pyrt.js";

const game = await start();
const league = game.modules.league, league_file = game.modules.league_file, league_fill = game.modules.league_fill;
const game_scale = game.modules.game_scale;

const copy = (v) => JSON.parse(JSON.stringify(v));
const show = (v) => JSON.stringify(v);
const range = (n) => Array.from({ length: n }, (_, i) => i);
const is_sentence = (e) => /^[A-Z]/.test(e) && e.endsWith(".");
const FORMAT = "cfp-league/1";

test("the exported league reads back into exactly the league the game builds", () => {
  const doc = league_file.export_document();
  const attrs = game_scale.keys();
  const base = league.from_base(2027);
  const rebuilt = {};
  for (const d of doc["teams"]) rebuilt[d["slug"]] = league_file.to_league_team(d, attrs);
  const part = (t) => json_dumps({ roster: t["roster"], coaches: t["coaches"], formation: t["formation"] }, { sort_keys: true });
  for (const [slug, entry] of Object.entries(base["teams"])) assert(part(rebuilt[slug]) === part(entry), slug);
  equal(new Set(Object.keys(rebuilt)), new Set(Object.keys(base["teams"])));
});

// the stand-in FCS opponents are the game's own: a league file never shows or names them
test("the export is the same bytes every time and never mentions an FCS stand-in", () => {
  const a = league_file.dumps(league_file.export_document());
  const text = new TextDecoder().decode(a);
  equal(Buffer.compare(a, league_file.dumps(JSON.parse(text))), 0);
  equal(Buffer.compare(a, league_file.builtin_bytes()), 0);
  const fictional = league.base_slugs().map((s) => league.base_meta(s)).filter((m) => m["fictional"]);
  assert(fictional.length);
  for (const m of fictional) {
    assert(!text.includes(`"${m["slug"]}"`) && !text.includes(m["short_name"]), m["slug"]);
    assert(!text.includes(m["conference"]), m["conference"]);
  }
  equal(JSON.parse(text)["format"], FORMAT);
});

test("the export's shape: conferences with their games, teams with coaches and full ratings", () => {
  const doc = league_file.export_document();
  assert(doc["name"] === "Built-in League" && doc["year"] === 2026);
  equal(league_file.conference_id("American Athletic Conference"), "american-athletic-conference");
  const ids = {};
  for (const c of doc["conferences"]) ids[c["id"]] = c;
  assert(ids["sec"]["games"] === 9 && ids["fbs-independent"]["games"] === 0);
  assert(doc["teams"].every((t) => t["conference"] in ids));
  const smu = doc["teams"].find((t) => t["slug"] === "smu");
  assert("lat" in smu && !("style" in smu));
  equal(new Set(Object.keys(smu["coaches"])), new Set(["head", "oc", "dc", "offense", "defense"]));
  const p = smu["roster"][0];
  equal(Object.keys(p["ratings"]).length, game_scale.keys().length);
  equal(Object.keys(p["ratings"]).length, 54);
  assert(doc["teams"].every((t) => t["roster"].every((q) => q["pos"] !== "HB")), "the file writes RB, never HB");
});


// ---- parse and validate ---------------------------------------------------------------------------

const JAY = { name: "Jay Smith", pos: "QB", class: "JR" };
const MAX = { name: "Max Lee", pos: "WR", class: "SO" };
const ALDER = { slug: "alder-tech", name: "Alder Tech", short_name: "Alder Tech", abbreviation: "ATU", mascot: "Owls",
  city: "Bend", state: "OR", lat: 44.05, lon: -121.31, conference: "big-sky-east", level: "FBS",
  colors: { primary: { name: "Green", hex: "#0B6E4F" } }, strength: "Average", prestige: 40,
  rivals: ["oregon-state"], roster: [{ ...JAY }, { ...MAX }], depth_chart: { QB: ["Jay Smith"] } };

const member = (i) => ({ slug: `bse-${i}`, name: `Big Sky ${i}`, conference: "big-sky-east" });

/** A valid file: Alder Tech plus nine more members of a new conference, Big Sky East (8 games). */
function base_file(over = {}) {
  return { format: FORMAT, conferences: [{ id: "big-sky-east", name: "Big Sky East", level: "FBS", games: 8 }],
    teams: [copy(ALDER), ...range(9).map(member)], ...over };
}

/** The problems of the valid file with Alder Tech changed (`roster` replaces its roster, `pos` its first player's position). */
function errs(team_over = {}) {
  const doc = base_file();
  const { roster, pos, ...rest } = team_over;
  if (roster !== undefined) doc["teams"][0]["roster"] = roster;
  if (pos !== undefined) doc["teams"][0]["roster"][0]["pos"] = pos;
  Object.assign(doc["teams"][0], rest);
  return league_file.validate(doc);
}
const any = (out, part) => out.some((e) => e.includes(part));

function parse_fails(blob, text) {
  try { league_file.parse(blob); } catch (e) {
    if (!(e instanceof league_file.LeagueFileError)) throw e;
    assert(e.errors.some((m) => m.includes(text)), show(e.errors));
    return;
  }
  throw new Error("no LeagueFileError");
}
const bytes = (s) => new TextEncoder().encode(s);
const fcs_slug = () => league.base_slugs().find((s) => league.base_meta(s)["fictional"]);

test("a well-formed custom file has no problems", () => {
  equal(league_file.validate(base_file()), []);
  equal(league_file.validate(league_file.parse(league_file.builtin_bytes())), []);
});

test("a wrong position, class or conference is named with what to use instead", () => {
  assert(errs({ pos: "WRR" }).includes("Alder Tech, player 1 (Jay Smith): position 'WRR' is not a position; use QB, RB, WR, TE, LT, LG, C, RG, RT, LEDG, DT, REDG, SAM, MIKE, WILL, CB, FS, SS, K, P or FB."));
  const out = errs({ roster: [{ ...JAY, class: "GR" }, MAX], depth_chart: null });
  assert(out.includes("Alder Tech, player 1 (Jay Smith): class 'GR' is not a class; use FR, FRRS, SO, SORS, JR, JRRS, SR or SRRS."), show(out));
  assert(errs({ conference: "big-sky-e" }).includes("Alder Tech: conference 'big-sky-e' is not in the file or the game."));
});

test("two teams with one slug, two players with one name, and a team both removed and listed are refused", () => {
  const doc = base_file();
  doc["teams"].push(copy(ALDER));
  assert(any(league_file.validate(doc), "is used by two teams"));
  assert(errs({ roster: [JAY, MAX, { ...JAY, name: "jay smith" }], depth_chart: null })
    .includes("Alder Tech: players 1 and 3 are both named Jay Smith; give each a different name."));
  const f = { format: FORMAT, remove: ["kent-state"], teams: [{ slug: "kent-state" }] };
  assert(league_file.validate(f).includes("Kent State: the file removes it and also lists it; do one or the other."));
});

test("a file that is not JSON, not UTF-8, not an object, the wrong format or too big is refused with a sentence", () => {
  parse_fails(bytes('{"format": "cfp-league/1",'), "The file is not valid JSON");
  parse_fails(bytes('{"format": "cfp-league/1", "year": NaN}'), "The file is not valid JSON");
  parse_fails(new Uint8Array([0xff, 0xfe]), "not UTF-8");
  parse_fails(bytes("[1]"), "top level must be an object");
  parse_fails(bytes('{"format": "cfp-league/2"}'), "The file's format is 'cfp-league/2'; this game reads 'cfp-league/1'.");
  parse_fails(new Uint8Array(league_file.MAX_LEAGUE_BYTES + 1).fill(32), "The file is 64.0 MB; the game reads league files up to 64 MB.");
});

test("a depth chart may only name players on the roster (the built-in roster when the file gives none)", () => {
  assert(errs({ depth_chart: { QB: ["Jay Smyth"] } }).includes("Alder Tech: the depth chart's QB list names Jay Smyth, who is not on the roster."));
  const out = league_file.validate({ format: FORMAT, teams: [{ slug: "kent-state", depth_chart: { QB: ["Nobody Here"] } }] });
  assert(out.includes("Kent State: the depth chart's QB list names Nobody Here, who is not on the roster."), show(out));
});

test("a conference needs enough teams for its games, and the league has a limit of FBS teams", () => {
  const doc = base_file();
  doc["teams"] = doc["teams"].slice(0, 3);
  assert(league_file.validate(doc).includes("Big Sky East: 3 teams can't play 8 conference games each; it needs at least 9."));
  const mwc = league.base_slugs().filter((s) => !league.base_meta(s)["fictional"] && league.base_meta(s)["conference"] === "Mountain West");
  const out = league_file.validate({ format: FORMAT, remove: mwc.slice(0, 5) });
  assert(out.some((e) => e.includes("Mountain West: ") && e.includes("it needs at least")), show(out));
  const wide = { format: FORMAT, teams: range(300).map((i) => ({ slug: `new-${i}`, name: `New ${i}`, conference: "sec" })) };
  assert(league_file.validate(wide).some((e) => e.includes("FBS teams") && e.includes("256")));
});

test("the FCS stand-ins are reserved, and no error ever names one", () => {
  const fcs = fcs_slug();
  const m = league.base_meta(fcs);
  const out = league_file.validate({ format: FORMAT, remove: [fcs],
    teams: [{ slug: fcs, name: "X", conference: m["conference"] }, { slug: "zed", name: "Zed", conference: m["conference"], rivals: [fcs] }],
    conferences: [{ id: "x", name: m["conference"] }] }).join(" ");
  assert(out.includes("reserved for the game's FCS opponents"), out);
  // the fixed sentence says "FCS opponents" in general and the stand-ins' conference is just "FCS": take the
  // sentence out before looking for any stand-in's own names
  const rest = out.replaceAll("reserved for the game's FCS opponents", "");
  for (const word of [fcs, m["short_name"], m["conference"], m["school_name"]]) assert(!rest.includes(word), word);
});

test("a long list of problems is cut off with a count of the rest, and check() says how many in all", () => {
  const doc = base_file();
  doc["teams"][0]["roster"] = range(80).map((i) => ({ name: `P ${i}`, pos: "WRR", class: "FR" }));
  delete doc["teams"][0]["depth_chart"];
  const e = league_file.validate(doc);
  assert(e.length === league_file.MAX_ERRORS + 1 && e[e.length - 1] === "And 30 more.", show(e.slice(-2)));
  const r = league_file.check(league_file.dumps(doc));
  equal(r["errors"], e);
  equal(r["errors_total"], 80);
});

test("a rating, potential, overall or star value must be a whole number in range; a missing skill is fine", () => {
  for (const bad of ["high", 120, 0, 75.5, "NoneType", true]) {
    const out = errs({ roster: [{ ...JAY, ratings: { speed: bad } }, MAX], depth_chart: null });
    assert(out.some((e) => e.startsWith("Alder Tech, player 1 (Jay Smith): rating 'speed'")), show([bad, out]));
  }
  const out = errs({ roster: [{ ...JAY, ratings: { nonsense: 50 }, potential: { speed: 100 }, overall: 0 }, MAX], depth_chart: null });
  assert(any(out, "rating 'nonsense' is not a skill"));
  assert(any(out, "potential 'speed' must be a whole number"));
  assert(any(out, "overall must be"));
  equal(errs({ roster: [{ ...JAY, ratings: { speed: 80 } }, MAX], depth_chart: null }), []);
});

test("the other rules of a team and its players each give their own sentence", () => {
  const taken = league.from_base(2027)["teams"]["smu"]["roster"][0]["id"];          // a built-in player's id
  assert(any(errs({ level: "FCS" }), "level 'FCS' is not supported; FCS games use the game's own opponents."));
  assert(league_file.validate(base_file({ year: 2027 })).includes("The file's year is 2027; careers start in 2026, so use 2026 or leave it out."));
  assert(any(errs({ strength: "Huge" }), "strength must be"));
  equal(errs({ strength: 55 }), []);
  assert(any(errs({ colors: { primary: { hex: "green" } } }), "hex"));
  assert(any(errs({ lat: 91 }), "lat must be"));
  assert(any(errs({ state: "ZZ" }), "state must be"));
  assert(any(errs({ rivals: ["nowhere"] }), "rival 'nowhere' is not a team"));
  assert(league_file.validate(base_file({ remove: ["nowhere"] })).some((e) => e.includes("remove") && e.includes("not a team in the game")));
  assert(any(league_file.validate(base_file({ conferences: [{ id: "x", name: league.base_meta(fcs_slug())["conference"] }] })), "reserved"));
  assert(any(league_file.validate(base_file({ conferences: [{ id: "big-sky-east", name: "B", games: 12 }] })), "games must be"));
  assert(any(errs({ roster: range(86).map((i) => ({ ...JAY, name: `P${i}` })), depth_chart: null }), "limit is 85"));
  assert(any(errs({ roster: [{ ...JAY, stars: 6 }], depth_chart: null }), "stars must be"));
  assert(any(errs({ roster: [{ ...JAY, height: 20 }], depth_chart: null }), "height must be"));
  assert(any(errs({ roster: [{ ...JAY, weight: 999 }], depth_chart: null }), "weight must be"));
  assert(any(errs({ roster: [{ ...JAY, id: taken }], depth_chart: null }), `id '${taken}' is already used`));
  assert(any(league_file.validate({ format: FORMAT, teams: [{ slug: "Bad Slug" }] }), "slug 'Bad Slug' must be"));
});

test("a number far too large is a sentence like any other wrong value", () => {
  const big = 1e300;
  let out = errs({ roster: [{ ...JAY, ratings: { speed: big }, potential: { speed: big }, overall: big, stars: big }, MAX], depth_chart: null });
  for (const part of ["rating 'speed' must be", "potential 'speed' must be", "overall must be", "stars must be"]) assert(any(out, part), show([part, out]));
  out = league_file.validate(base_file({ conferences: [{ id: "big-sky-east", name: "Big Sky East", games: big }] }));
  assert(any(out, "games must be"), show(out));
  assert(out.every(is_sentence));
});

// the page prints these as they are: house style is a sentence, and no programmer's word for "nothing"
test("every problem is a sentence, with no None, null, undefined or NaN in it", () => {
  const fcs = fcs_slug();
  const docs = [base_file({ year: 2027, remove: ["nowhere", fcs] }),
    base_file({ conferences: [{ id: "x", name: league.base_meta(fcs)["conference"] }, { id: "q" }, 5] }),
    { format: FORMAT, teams: [{ slug: "Bad Slug" }, 7, { name: "No Slug" }, { slug: "kent-state", remove: 1, level: "FCS",
      conference: 5, strength: [], roster: [3, { pos: 5, class: "X", ratings: { speed: NaN } }], depth_chart: { ZZ: 4 } }] }];
  const last = base_file();
  last["teams"][0]["roster"] = [{ ...JAY, pos: "WRR", ratings: { speed: 500, foo: 1 }, stars: 9 }, { ...MAX, class: "ZZ" }];
  docs.push(last);
  const out = docs.flatMap((d) => league_file.validate(d));
  assert(out.length && out.every(is_sentence), show(out.filter((e) => !is_sentence(e))));
  for (const w of ["None", "null", "undefined", "NaN"]) assert(!out.some((e) => e.includes(w)), show(out.filter((e) => e.includes(w))));
});


// ---- merge ----------------------------------------------------------------------------------------

/** A built-in conference: [id, name, games]. */
function a_conference() {
  const b = league_file._builtin();
  const cid = Object.keys(b["conf_names"])[0];
  return [cid, b["conf_names"][cid], b["games"][cid]];
}

test("the game's own export imported back is the built-in league: nothing added, changed or rebuilt", () => {
  const m = league_file.merge(league_file.parse(league_file.builtin_bytes()));
  assert(m["builtin"] && !m["added"].length && !m["changed"].length && !m["removed"].length && !m["structural"]);
});

test("a one-team file changes that team and keeps everything else, its roster included", () => {
  const m = league_file.merge({ format: FORMAT, teams: [{ slug: "rice", prestige: 55 }] });
  equal(m["changed"], ["rice"]);
  assert(!m["structural"] && !m["builtin"]);
  equal(Object.keys(m["teams"]).length, league.base_slugs().filter((s) => !league.base_meta(s)["fictional"]).length);
  equal(m["teams"]["rice"]["roster"], league_file.team_doc(league.from_base(2027), "rice")["roster"]);
  equal(m["name"], "Imported League");
});

// "structural" is what makes the game build a new schedule instead of playing the real 2026 one
test("adding or removing a team changes the league's shape", () => {
  const m = league_file.merge(base_file({ remove: ["kent-state"] }));
  equal(m["added"], sorted(["alder-tech", ...range(9).map((i) => `bse-${i}`)]));
  equal(m["removed"], ["kent-state"]);
  assert(m["structural"]);
  assert(!("kent-state" in m["teams"]) && m["conferences"]["big-sky-east"]["members"].includes("alder-tech"));
  equal(m["conferences"]["big-sky-east"]["games"], 8);
});

test("renaming a conference keeps the schedule; changing its games or moving a team into it does not", () => {
  const [cid, name, games] = a_conference();
  let m = league_file.merge({ format: FORMAT, conferences: [{ id: cid, name: `${name} Plus`, games }] });
  assert(!m["builtin"] && !m["structural"]);
  equal(m["conferences_changed"], [cid]);
  equal(m["conferences"][cid]["name"], `${name} Plus`);
  m = league_file.merge({ format: FORMAT, conferences: [{ id: cid, name, games: games + 1 }] });
  assert(m["structural"] && !m["builtin"]);
  // a team may name its conference by the conference's name as well as its id
  const slug = Object.entries(league_file._builtin()["team_conf"]).find(([, c]) => c !== cid)[0];
  m = league_file.merge({ format: FORMAT, teams: [{ slug, conference: name }] });
  assert(m["teams"][slug]["conference"] === cid && m["conferences"][cid]["members"].includes(slug) && m["structural"]);
});

test("a built-in conference given without games keeps its own games", () => {
  const doc = { format: FORMAT, conferences: [{ id: "mac", name: "Mid-American" }] };
  equal(league_file.validate(doc), []);
  const m = league_file.merge(doc);
  assert(m["conferences"]["mac"]["games"] === league_file._builtin()["games"]["mac"] && !m["structural"]);
  const r = league_file.check(league_file.dumps(doc), 3);
  assert(r["ok"] && r["games"] === null, show(r["errors"]));
  // games 0 given outright is still 0 (and the conference's shape has then changed)
  assert(league_file.merge({ format: FORMAT, conferences: [{ id: "mac", name: "MAC", games: 0 }] })["structural"]);
});

// a conference shows by its name everywhere, so two conferences may never share one (in any case)
test("a conference's name must be its own: not another's in the game, nor another's in the file", () => {
  const [cid, name, games] = a_conference();
  for (const given of [name, name.toUpperCase()]) {
    const doc = base_file({ conferences: [{ id: "big-sky-east", name: given, level: "FBS", games: 8 }] });
    assert(league_file.validate(doc).includes(`Conference 1 (${given}): that name belongs to a conference in the game; give the new conference its own name, or use the id '${cid}' to change that one.`), given);
  }
  const two = base_file({ conferences: [{ id: "big-sky-east", name: "Big Sky East", games: 8 }, { id: "bse-2", name: "big sky east", games: 0 }] });
  assert(league_file.validate(two).includes("Conference 2 (big sky east): another conference in the file is named Big Sky East; give each its own name."));
  equal(league_file.validate({ format: FORMAT, conferences: [{ id: cid, name, games }] }), []);
  // a renamed built-in conference
  const g = league_file._builtin()["games"];
  const conf = (id, n) => ({ id, name: n, games: g[id] ?? 8 });
  let out = league_file.validate({ format: FORMAT, conferences: [conf("pac-12", "mac")] });
  assert(out.includes("Conference 1 (mac): that name belongs to another conference in the game; give it its own name."), show(out));
  out = league_file.validate({ format: FORMAT, conferences: [conf("big-sky-east", "Big Sky East"), conf("pac-12", "Big Sky East")] });
  assert(out.includes("Conference 2 (Big Sky East): another conference in the file is named Big Sky East; give each its own name."), show(out));
  out = league_file.validate({ format: FORMAT, conferences: [conf("mac", "Lake Erie League"), conf("pac-12", "lake erie league")] });
  assert(out.includes("Conference 2 (lake erie league): another conference in the file is named Lake Erie League; give each its own name."), show(out));
  equal(league_file.validate({ format: FORMAT, conferences: [conf("mac", "Lake Erie League")] }), []);
});

// a merged league is the caller's to change: the built-in league it was merged over must not change with it
test("changing a merged league does not change the built-in league behind it", () => {
  const m = league_file.merge({ format: FORMAT, teams: [{ slug: "rice", prestige: 55 }] });
  m["teams"]["rice"]["roster"].length = 0;
  m["teams"]["kent-state"]["roster"].push({ x: 1 });
  const m2 = league_file.merge(league_file.parse(league_file.builtin_bytes()));
  assert(m2["builtin"]);
  equal(copy(m2["teams"]["rice"]), copy(league_file.team_doc(league.from_base(2027), "rice")));
});


// ---- every exported field is checked: a wrong type or value is a sentence, never a crash --------------

let EXPORT = null;
/** A built-in team as the export writes it (a fresh copy). */
function exported(slug = "rice") {
  if (EXPORT === null) {
    EXPORT = {};
    for (const t of JSON.parse(new TextDecoder().decode(league_file.builtin_bytes()))["teams"]) EXPORT[t["slug"]] = t;
  }
  return copy(EXPORT[slug]);
}

function set_at(d, path, value) {
  const keys = path.split(".");
  for (const k of keys.slice(0, -1)) d = d[k];
  d[keys[keys.length - 1]] = value;
}

// [path into the exported Rice, a wrong value, the start of the sentence that must come back]; "P1" is its first
// player (the top of a target share's range is read from the rosters, so that sentence is held only to its start)
const FIELD_CASES = [
  ["home_field", "70", "Rice: home field must be a number from 0 to 100."],
  ["home_field", 150, "Rice: home field must be a number from 0 to 100."],
  ["stadium", "Rice Stadium", "Rice: the stadium must list its name, capacity and surface."],
  ["stadium.capacity", "lots", "Rice: the stadium's capacity must be a whole number from 0 to 200000."],
  ["stadium.surface", "ice", "Rice: the stadium's surface must be grass or turf."],
  ["stadium.name", 5, "Rice: the stadium's name must be text."],
  ["style", "nowhere", "Rice: style 'nowhere' is not a team in the game; use a built-in team's slug."],
  ["style", 5, "Rice: style must be a built-in team's slug."],
  ["formation", "4-3", "Rice: the formation must list the offense, defense and special teams roles and their counts."],
  ["formation.offense.QB", "1", "Rice: the formation's offense QB count must be a whole number from 0 to 11."],
  ["formation.offense.QB", 2, "Rice: the formation's offense must have 11 players; it has 12."],
  ["formation.defense.XX", 1, "Rice: the formation's defense role 'XX' is not a role in the game; use LEDG,"],
  ["coaches.offense", "Wishbone", "Rice: offense 'Wishbone' is not a scheme in the game; use Air Raid,"],
  ["coaches.defense", 5, "Rice: defense must be a scheme word"],
  ["coaches.head.rating", "60", "Rice: the head coach's rating must be a whole number from 1 to 99."],
  ["coaches.head.ratings.overall", "x", "Rice: the head coach's rating 'overall' must be a whole number from 1 to 99."],
  ["coaches.head.ratings.speed", 50, "Rice: the head coach's rating 'speed' is not a head coach rating; use overall,"],
  ["coaches.oc.ratings", [1, 2], "Rice: the offensive coordinator's ratings must list ratings and their values."],
  ["coaches.head.scheme.offensive_philosophy", "Wishbone", "Rice: the head coach's offensive philosophy 'Wishbone' is not a scheme in the game; use Air Raid,"],
  ["coaches.dc.scheme.defensive_scheme", 4, "Rice: the defensive coordinator's defensive scheme must be a scheme word"],
  ["coaches.head.tendencies.aggressiveness", 300, "Rice: the head coach's tendency 'aggressiveness' must be a number from 0 to 100."],
  ["coaches.head.name", 5, "Rice: the head coach's name must be text."],
  ["coaches.head.since", "x", "Rice: the head coach's 'since' must be a year such as 2024."],
  ["coaches.head.is_interim", "no", "Rice: the head coach's 'is_interim' must be true or false."],
  ["coaches.oc.role", "head_coach", "Rice: the offensive coordinator's 'role' must be offensive_coordinator or left out."],
  ["roster.0.abilities", [{ name: "Workhorse" }], "P1: ability 1 needs a name and a tier."],
  ["roster.0.abilities", "Workhorse", "P1: abilities must be a list of names and tiers."],
  ["roster.0.abilities", [{ name: "Speed", tier: "Gold" }], "P1: ability 'Speed' is not an ability in the game."],
  ["roster.0.abilities", [{ name: "Workhorse", tier: "Mega" }], "P1: ability tier 'Mega' must be Locked, Bronze, Silver, Gold or Platinum."],
  ["roster.0.target_share", "lots", "P1: target share must be a number from 0.3 to "],
  ["roster.0.target_share", 5, "P1: target share must be a number from 0.3 to "],
  ["roster.0.years", "two", "P1: years must be a whole number from 0 to 6."],
  ["roster.0.years", 9, "P1: years must be a whole number from 0 to 6."],
  ["roster.0.dev", "Super", "P1: dev 'Super' must be Normal, Impact, Star or Elite."],
  ["roster.0.coachability", "Lazy", "P1: coachability 'Lazy' must be Coach's Dream, Film Junkie, Quick Study, Steady Grinder, Slow to Click or Set in His Ways."],
  ["roster.0.archetype", "Wizard", "P1: archetype 'Wizard' is not an archetype in the game."],
  ["roster.0.jersey", "AB", "P1: jersey must be a whole number from 0 to 99."],
  ["roster.0.jersey", 120, "P1: jersey must be a whole number from 0 to 99."],
  ["roster.0.hometown", 5, "P1: hometown must be text of at most 40 characters."],
  ["roster.0.hometown", "x".repeat(41), "P1: hometown must be text of at most 40 characters."],
  ["colors.primary.name", 5, "Rice: the primary color's name must be text."],
];

test("every field the export writes is checked: one wrong value gives that field's sentence, never a crash", () => {
  const p1 = `Rice, player 1 (${exported()["roster"][0]["name"]})`;
  for (const [path, value, start] of FIELD_CASES) {
    const want = start.replace(/^P1/, p1);
    const t = exported();
    set_at(t, path, value);
    const r = league_file.check(league_file.dumps({ format: FORMAT, teams: [t] }));
    assert(!r["ok"], show([path, value]));
    assert(r["errors"].some((e) => e.startsWith(want)), show([path, value, r["errors"]]));
    assert(r["errors"].every(is_sentence), show(r["errors"]));
  }
  // the export's own values all pass, and a valid edit of each kind of field passes too
  const t = exported();
  Object.assign(t, { home_field: 70, style: "smu" });
  t["stadium"]["capacity"] = 50000;
  t["coaches"]["head"]["rating"] = 60;
  Object.assign(t["roster"][0], { jersey: 7, years: 2, abilities: [{ name: "Workhorse", tier: "Gold" }] });
  equal(league_file.validate({ format: FORMAT, teams: [t] }), []);
});

test("a new team's coaches and players are checked by the same rules", () => {
  const out = errs({ coaches: { head: { name: "Pat Doe", rating: "60" }, offense: "Wishbone" },
    roster: [{ ...JAY, abilities: "Speed", years: "two" }, MAX], depth_chart: null });
  for (const want of ["Alder Tech: the head coach's rating must be", "Alder Tech: offense 'Wishbone' is not a scheme",
    "Alder Tech, player 1 (Jay Smith): abilities must be", "Alder Tech, player 1 (Jay Smith): years must be"]) {
    assert(out.some((e) => e.startsWith(want)), show([want, out]));
  }
  // a new team's stadium keeps the defaults for what the file leaves out
  const sd = league_fill.team_meta_doc({ slug: "alder-tech", name: "Alder Tech", stadium: { capacity: 40000 } }, "Big Sky East")["stadium"];
  equal(copy(sd), { name: "Alder Tech Stadium", capacity: 40000, surface: "turf" });
});

// whatever still escapes the checks is one sentence (naming the team when it is one team's), not a broken page
test("a team or a league the game fails to build is one sentence, never a crash", () => {
  const real = league_fill.fill_roster, log = league_file._log;
  league_file._log = { error() {}, exception() {} };          // the failure is logged for the developer: not here
  league_fill.fill_roster = () => { throw new TypeError("unsupported operand type(s)"); };
  let r;
  try {
    r = league_file.check(league_file.dumps({ format: FORMAT, teams: [{ ...exported("rice"), roster: [{ ...JAY }] }] }));
  } finally { league_fill.fill_roster = real; }
  equal(r, { ok: false, errors: ["Rice: the game could not build this team from the file; compare it with an exported league file."], errors_total: 1 });
  const real_build = league.build;
  league.build = () => { throw new Error("x"); };
  try {
    r = league_file.check(league_file.dumps({ format: FORMAT, teams: [{ slug: "rice", prestige: 55 }] }));
  } finally { league.build = real_build; league_file._log = log; }
  equal(r, { ok: false, errors: ["The game could not build a league from this file; compare it with an exported league file."], errors_total: 1 });
});

// a built-in team that keeps its real roster is never nudged up or down
test("strength applies only to a roster the file gives", () => {
  const want = "Rice: strength applies only to a roster the file gives; add a roster or remove strength.";
  assert(league_file.validate({ format: FORMAT, teams: [{ slug: "rice", strength: "Elite" }] }).includes(want));
  const same = exported("rice");
  same["strength"] = 60;
  assert(league_file.validate({ format: FORMAT, teams: [same] }).includes(want));
  const given = exported("rice");
  given["roster"] = given["roster"].slice(0, 60);
  given["strength"] = "Elite";
  equal(league_file.validate({ format: FORMAT, teams: [given] }), []);
  equal(errs({ strength: "Strong" }), []);                // a new team's strength is its fill target
});

await run();
