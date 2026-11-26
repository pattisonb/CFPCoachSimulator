// The season, part 1: its constants and tables, the league's teams (load_teams, use_league),
// the house rating scale, the FCS stand-ins, the real 2026 polls, a new season (new_season and the schedule repairs
// under it), and the small helpers on one game (records, standings and their tiebreaks, the weekly polls).
//
// Week-by-week season simulation with polls, conference championships, the CFP bracket
// and the playoff. No injuries.
//
// A season is a JSON-serializable dict (data/seasons/<id>.json) that advances one week at
// a time. Weeks 1-13 are the regular season (2026 calendar: week 13 ends Nov 28), week 14
// is conference championship week, week 15 holds the games scheduled after it (Army-Navy)
// and the playoff selection, then weeks 16-19 are the playoff rounds (first round at the
// higher seed's home, quarterfinals, semifinals, championship on neutral fields).
//
// Polls: the AP poll starts from the real 2026 preseason poll and is updated after every
// week by the model in polls.js; the committee ranking appears after weeks 9-13 and the
// final one after week 14, matching the 2026 release schedule (Nov 3 through Dec 6).
//
// Every game is simulated from week 1.
//
// Games against FCS schools are played against the fictional FCS school from the same
// region (data/fcs_map.json).
//
// engine_js/PORTING.md ("Big Files in Parts") says how the parts share the `season` namespace.
import { Random, round, int, sum, sorted, minBy, get, isNumber, truthy, floordiv, mod, range, json_dumps, odict } from "../../engine_js/pyrt.js";
import { pstdev, median } from "../../engine_js/pystat.js";
import { read_text, read_json, write_text, exists, env } from "../../engine_js/files.js";
import { modules, has as module_loaded } from "../../engine_js/modules.js";
import { ratings as ratings_v2 } from "../../teamdata_js/ratings.js";
import { game_scale } from "../../teamdata_js/game_scale.js";
import "../../teamdata_js/rosters.js";                           // the roster file's reader (modules.rosters: load_teams)
import { polls } from "../polls.js";
import { fcs_names } from "../fcs_names.js";
import { teamnames } from "../teamnames.js";
import { prospects } from "../../career_js/prospects.js";
import { season } from "../season_ns.js";

// ---- small helpers ----
const own = (d, k) => Object.prototype.hasOwnProperty.call(d, k);       // `k in d` for a dict
/** `not d` for a dict (a plain object): whether it has no keys. */
function empty(d) {
  for (const k in d) if (own(d, k)) return false;
  return true;
}
/** `d.clear()` for a cache, whichever of a plain object, a Map or a Set its part made it. */
function clear(c) {
  if (c instanceof Map || c instanceof Set) c.clear();
  else for (const k of Object.keys(c)) delete c[k];
}
/** `path.exists()`. A host that can only read (no store: a browser helper, a test) is asked by reading. */
function file_exists(path) {
  try {
    return truthy(exists(path));
  } catch (err) {
    try {
      read_text(path);
      return true;
    } catch (err2) {
      return false;
    }
  }
}
/** `a == b` for two lists of names. */
const same_list = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

season.ROOT = ".";   // the project root (every path below is from it)
season.TEAMS_FILE = "data/engine_teams.json";
season.SCHEDULES_FILE = "data/schedules.json";
season.FCS_MAP_FILE = "data/fcs_map.json";
season.HISTORY_POLLS = "data/history/polls.json";
season.SEASONS_DIR = env.CFP_SEASONS_DIR || "data/seasons";   // CFP_SEASONS_DIR: tests/run_all.mjs gives its tests a folder of their own

season.LAST_REGULAR_WEEK = 14;   // Aug 29 through Nov 28, 2026: fourteen Saturdays, so every team has a bye or two
season.CCG_WEEK = 15;            // Dec 4-5
season.SELECTION_WEEK = 16;      // Dec 6 selection, Dec 12 Army-Navy
season.FINAL_WEEK = 20;          // Jan 25, 2027
// Weeks run Tuesday to Monday (Labor Day games belong to that weekend); week 1 starts Aug 25.
// (A wall-clock moment without a time zone, held as a Date in UTC.)
season.SEASON_EPOCH = new Date(Date.UTC(2026, 7, 25));
season.AP_OTHERS = 15;        // teams listed under "also receiving votes" below the top 25
// Conferences that still play divisions: the title game is division winner vs division winner.
season.DIVISIONS = {
  "Sun Belt": {
    East: ["app-st", "c-carolina", "ga-southern", "georgia-state", "james-madison", "marshall", "old-dominion"],
    West: ["arkansas-state", "louisiana", "louisiana-tech", "south-alabama", "southern-miss", "troy", "ul-monroe"],
  },
};
// Title games played at the higher seed's stadium rather than a neutral site.
season.HOSTED_CCG = new Set(["Sun Belt", "Mountain West", "American Athletic Conference", "Conference USA"]);
// (the next three are dicts by week number: a plain object's keys are the numbers as text, in rising order)
season.PLAYOFF_WEEKS = { 17: "First round", 18: "Quarterfinals", 19: "Semifinals", 20: "National championship" };
season.BOWL_WEEK_LABELS = { 17: "First Round & Bowls", 18: "Quarterfinals & Bowls", 19: "Semifinals & New Year Bowls", 20: "National Championship" };
season.CFP_WEEKS = new Set([10, 11, 12, 13, 14, 15]);   // committee rankings released after these weeks (Nov 3 ... Dec 6, 2026)
// Calendar of the postseason weeks (regular-season weeks take their dates from the schedule).
season.POSTSEASON_DATES = { [season.CCG_WEEK]: ["2026-12-04", "2026-12-05"], [season.SELECTION_WEEK]: ["2026-12-06", "2026-12-12"],
  17: ["2026-12-15", "2026-12-24"], 18: ["2026-12-26", "2027-01-01"], 19: ["2027-01-02", "2027-01-15"],
  20: ["2027-01-25", "2027-01-25"] };

// datetime.fromisoformat's texts as the schedules have them: a date, then optionally a time (hours, minutes, seconds,
// a fraction) and a UTC offset. The offset is read and dropped, as `.replace(tzinfo=None)` drops it.
const _ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2})(?::?(\d{2})(?::?(\d{2})(?:[.,](\d{1,6})\d*)?)?)?(?:[+-]\d{2}(?::?\d{2}(?::?\d{2}(?:\.\d+)?)?)?)?)?$/;

function week_of_date(date_iso) {
  // Calendar week of a game from its UTC kickoff (US evening games land on the next UTC day).
  if (!truthy(date_iso) || date_iso.length < 10) return null;
  const m = _ISO.exec(date_iso.replaceAll("Z", "+00:00"));
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4] || "0", m[5] || "0", m[6] || "0"].map(Number);
  const ms = m[7] ? Number(m[7].padEnd(6, "0")) / 1000 : 0;
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return null;
  const at = new Date(0);
  at.setUTCFullYear(y, mo - 1, d);
  if (at.getUTCMonth() !== mo - 1 || at.getUTCDate() !== d) return null;      // no such day (ValueError)
  const local = at.getTime() + ((h * 60 + mi) * 60 + s) * 1000 + ms - 6 * 3600 * 1000;
  const days = Math.floor((local - season.SEASON_EPOCH.getTime()) / 86400000);      // a timedelta's days
  return Math.max(1, floordiv(days, 7) + 1);
}

// the FCS stand-ins: one per region, each with a name and a mascot of its own ("Southeast Possums": fcs_names.TEAMS)
season.REGION_TEAM = Object.fromEntries(Object.entries(fcs_names.TEAMS).map(([region, b]) => [region, b.slug]));
season.STATE_REGION = {
  ...Object.fromEntries(["ME", "NH", "VT", "MA", "RI", "CT"].map((s) => [s, "New England"])),
  ...Object.fromEntries(["NY", "NJ", "PA", "DE", "MD", "DC", "VA", "WV"].map((s) => [s, "Mid-Atlantic"])),
  ...Object.fromEntries(["NC", "SC", "GA", "FL", "AL", "MS", "TN", "KY"].map((s) => [s, "Southeast"])),
  ...Object.fromEntries(["TX", "LA", "AR", "OK"].map((s) => [s, "Gulf Coast"])),
  ...Object.fromEntries(["MI", "OH", "IN", "IL", "WI", "MN"].map((s) => [s, "Great Lakes"])),
  ...Object.fromEntries(["ND", "SD", "NE", "KS", "IA", "MO"].map((s) => [s, "Plains"])),
  ...Object.fromEntries(["CO", "UT", "MT", "ID", "WY", "AZ", "NM", "NV"].map((s) => [s, "Mountain West"])),
  ...Object.fromEntries(["WA", "OR", "CA", "AK", "HI"].map((s) => [s, "Pacific Northwest"])),
};
season.FCS_STATES = {
  "Abilene Christian": "TX", "Alabama State": "AL", "Alcorn State": "MS", "Arkansas-Pine Bluff": "AR",
  "Austin Peay": "TN", "Bethune-Cookman": "FL", "Bryant": "RI", "Bucknell": "PA", "Cal Poly": "CA",
  "Campbell": "NC", "Central Arkansas": "AR", "Central Connecticut": "CT", "Charleston Southern": "SC",
  "Chattanooga": "TN", "Colgate": "NY", "Delaware State": "DE", "Duquesne": "PA",
  "East Tennessee State": "TN", "East Texas A&M": "TX", "Eastern Illinois": "IL", "Eastern Kentucky": "KY",
  "Eastern Washington": "WA", "Elon": "NC", "Florida A&M": "FL", "Fordham": "NY", "Furman": "SC",
  "Gardner-Webb": "NC", "Grambling": "LA", "Hampton": "VA", "Holy Cross": "MA", "Houston Christian": "TX",
  "Howard": "DC", "Idaho State": "ID", "Idaho": "ID", "Illinois State": "IL", "Incarnate Word": "TX",
  "Indiana State": "IN", "Lafayette": "PA", "Lamar": "TX", "Lindenwood": "MO", "Long Island University": "NY",
  "Maine": "ME", "McNeese": "LA", "Mercer": "GA", "Mercyhurst": "PA", "Merrimack": "MA",
  "Mississippi Valley State": "MS", "Monmouth": "NJ", "Montana": "MT", "Montana State": "MT",
  "Morgan State": "MD", "Murray State": "KY", "New Hampshire": "NH", "Nicholls": "LA", "Norfolk State": "VA",
  "North Alabama": "AL", "North Carolina A&T": "NC", "North Carolina Central": "NC", "North Dakota": "ND",
  "Northern Arizona": "AZ", "Northern Colorado": "CO", "Northern Iowa": "IA", "Northwestern State": "LA",
  "Portland State": "OR", "Prairie View A&M": "TX", "Rhode Island": "RI", "Richmond": "VA",
  "Robert Morris": "PA", "SE Louisiana": "LA", "Sacred Heart": "CT", "Samford": "AL", "South Dakota": "SD",
  "South Dakota State": "SD", "Southeast Missouri State": "MO", "Southern Illinois": "IL", "Southern": "LA",
  "Southern Utah": "UT", "Stonehill": "MA", "Stony Brook": "NY", "Tarleton State": "TX",
  "Tennessee State": "TN", "Tennessee Tech": "TN", "Texas Southern": "TX", "The Citadel": "SC",
  "Towson": "MD", "UAlbany": "NY", "UC Davis": "CA", "UT Martin": "TN", "UT Rio Grande Valley": "TX",
  "Utah Tech": "UT", "VMI": "VA", "Villanova": "PA", "Wagner": "NY", "Weber State": "UT",
  "West Georgia": "GA", "Western Carolina": "NC", "Western Illinois": "IL", "William & Mary": "VA",
  "Wofford": "SC", "Youngstown State": "OH",
};

season._teams_cache = {};
season._teams_meta = {};   // from the teams file: the attribute scale (ratings v2) and the engine's spread scale

season._league_path = season.TEAMS_FILE;   // the league every view and sim reads: the real 2026 one, or a career's later season

function load_teams() {
  if (empty(season._teams_cache)) {
    // (its own copy: the teams are changed below. The roster file holds each player's ratings and nothing worked out:
    // rosters.js works the rest out as it is read; a career's later season is read as it is)
    const data = modules.rosters.read(season._league_path);
    season._teams_cache = season.stand_in_names(data["teams"]);
    for (const t of Object.values(season._teams_cache)) {          // every team's ratings, by the one average every page shows
      if (truthy(get(t, "offense"))) t["team_ratings"] = season.game_ratings(t);
    }
    clear(season._teams_meta);
  }
  return season._teams_cache;
}

function use_league(path) {
  // Point every view and sim at a league's teams file (a career's later seasons, league.js);
  // None: the real 2026 league. Everything cached from the old league is dropped.
  path = truthy(path) ? String(path) : season.TEAMS_FILE;
  if (path === season._league_path) return;
  season._league_path = path;
  season._teams_cache = {};
  season._TEAMS = {};
  season._STAR_CUTS = null;
  for (const c of [season._teams_meta, season._race_cache, season._preview_cache]) clear(c);
  season.close_pool();                              // the workers hold the old league
  // (a module that is not loaded has cached nothing)
  if (module_loaded("recruiting")) modules.recruiting.reset_caches();
  if (typeof prospects.reset_caches === "function") prospects.reset_caches();
}

function activate(state) {
  // Make `state`'s league the one in play (a career past its first season, or one from a league
  // file, plays its own), with its recruiting models.
  const models = get(get(state, "league") || {}, "recruiting_models");
  modules.recruiting.use_league_models(truthy(models) ? models : {});
  season.use_league(modules.league.ensure_built(state));
}

function season_year(state) {
  return get(state, "year") || 2026;
}

function _is_p4(slug, team) {
  // A Power 4 school (Notre Dame counts as one).
  return polls.P4.has(team["conference"]) || slug === "notre-dame";
}

// ----- a player's numbers on the page: his card numbers -------------------------------------------------------------

season.POSITION_GROUP = { MLB: "LB", ROLB: "LB", LOLB: "LB" };    // linebackers share one group (the roles are small)

season.RETURN_POSITIONS_OUT = ["K", "P", "OL", "DL", "QB"];   // never returners, as the engine's best_returner has it

function card_of(p) {
  // His ratings by skill (game_scale.keys() order in "skills"), the card numbers everything on the page reads.
  const out = {}, keys = game_scale.keys(), v = get(p, "skills") || [];
  for (let i = 0; i < keys.length && i < v.length; i++) out[keys[i]] = v[i];
  return out;
}

function return_value(p) {
  // His Return Skill (a returner's own rating).
  return int(get(season.card_of(p), "kick_return", game_scale.MISSING));
}

function shown_overall(p, base = null) {
  // The overall on the card (game_scale.overall, built onto every player as "ovr", and worked out again from his
  // ratings when an edit changed them). `base` is unused (a god-mode edit changes his ratings themselves).
  if (isNumber(get(p, "ovr"))) return int(Math.max(1, Math.min(99, p["ovr"])));
  const card = season.card_of(p);
  return Object.keys(card).length ? game_scale.overall(card, game_scale.card_position(p), get(p, "dmv")) : game_scale.MISSING;
}

function page_attribute(p, key, value = null) {
  // One of his card's attributes as the page shows it: the card number of the rating it is (his own Decision Making
  // for a quarterback who has one).
  const card = season.card_of(p);
  return Object.keys(card).length ? int(round(game_scale.card_value(card, key, get(p, "dmv")))) : value;
}

function page_overall(p, base = null) {
  // His overall as the page shows it: shown_overall, the number the rules read too.
  return season.shown_overall(p, base);
}

function same_group(a, b) {
  return get(season.POSITION_GROUP, a, a) === get(season.POSITION_GROUP, b, b);
}

function tier_of(team) {
  if (truthy(team["fictional"])) return "FCS";
  if (season._is_p4(team["slug"], team)) return "P4";
  return "G5";
}

function _tiers(teams) {
  // slug -> tier ("P4", "G5" or "FCS") for every team.
  const out = {};
  for (const [slug, t] of Object.entries(teams)) out[slug] = season.tier_of(t);
  return out;
}

season.TEAM_REGION = Object.fromEntries(Object.entries(season.REGION_TEAM).map(([region, slug]) => [slug, region]));

// How strong the real FCS school a stand-in replaces is, as a rating shift for that game
// (form.with_form). The regional stand-ins are one team each; without this every FCS opponent
// would play like the same average FCS team. Tiers by recent FCS results; schools not listed
// play at the stand-in's own level. Matched on the start of the ESPN name.
season.FCS_TIERS = {
  strong: ["South Dakota State", "North Dakota State", "Montana State", "Montana Grizzlies", "South Dakota Coyotes",
    "Idaho Vandals", "UC Davis", "Villanova", "Incarnate Word", "Mercer", "Tarleton State",
    "Illinois State", "North Dakota Fighting", "Southern Illinois", "Abilene Christian", "Rhode Island"],
  good: ["Youngstown State", "Northern Iowa", "Chattanooga", "Furman", "Richmond", "New Hampshire",
    "Central Arkansas", "Austin Peay", "Lamar", "SE Louisiana", "Idaho State", "Eastern Washington",
    "Weber State", "Northern Arizona", "Southern Utah", "UT Martin", "Tennessee Tech", "Western Carolina",
    "William & Mary", "Monmouth", "Elon", "Holy Cross", "Lafayette", "Jackson State", "Southern Jaguars",
    "Florida A&M", "North Carolina Central", "UT Rio Grande Valley", "Nicholls", "McNeese",
    "East Tennessee State", "Eastern Kentucky", "Campbell", "Towson", "UAlbany", "Samford"],
  weak: ["Duquesne", "Robert Morris", "Wagner", "Stonehill", "Long Island", "Central Connecticut", "Mercyhurst",
    "Merrimack", "Sacred Heart", "Mississippi Valley State", "Arkansas-Pine Bluff", "Delaware State",
    "Norfolk State", "Morgan State", "Texas Southern", "Bethune-Cookman", "Houston Christian",
    "Charleston Southern", "Gardner-Webb", "Western Illinois", "VMI", "Lindenwood", "Eastern Illinois",
    "Indiana State", "Murray State", "Utah Tech", "Northern Colorado", "East Texas A&M", "Bucknell",
    "Fordham", "Stony Brook", "Bryant", "Prairie View", "Alcorn State", "Grambling", "Alabama State",
    "Hampton", "Howard", "Tennessee State", "Portland State", "Southeast Missouri", "Colgate"],
};
season.FCS_TIER_SHIFT = { strong: 3.6, good: 1.2, weak: -2.8 };   // card points

function fcs_strength(name) {
  // Rating shift for the real FCS school `name` (ESPN display name); 0 when unlisted.
  for (const [tier, schools] of Object.entries(season.FCS_TIERS)) {
    if (schools.some((school) => (name || "").startsWith(school))) return season.FCS_TIER_SHIFT[tier];
  }
  return 0.0;
}

function fcs_label(slug) {
  // How a fictional FCS stand-in is shown on a schedule: its own name ('Southeast Possums'), never the
  // real school it replaces.
  const b = fcs_names.brand(slug);
  return b !== null ? b.name : "FCS";
}

function stand_in_names(teams) {
  // `teams` with every FCS stand-in as itself, whatever its file (or a league cached by an older save) says:
  // name and school "Southeast Possums", its mascot, abbreviation and colors (fcs_names.TEAMS), no town.
  // Every page that shows a team's name reads these, so a stand-in can never show anything else.
  for (const [slug, t] of Object.entries(teams)) {
    if (truthy(get(t, "fictional"))) {
      const b = fcs_names.brand(slug);
      const name = season.fcs_label(slug);
      Object.assign(t, { name, school: name, abbreviation: b !== null ? b.abbreviation : "FCS", mascot: b !== null ? b.mascot : "" });
      if (b !== null) {
        t["colors"] = fcs_names.hex_colors(season.TEAM_REGION[slug]);
        if (truthy(get(t, "stadium"))) t["stadium"] = { ...t["stadium"], name: b.stadium };
      }
      delete t["city"];
    }
  }
  return teams;
}

function team_display(slug, teams) {
  // A team's name on a game line: an FCS stand-in by its own name (fcs_label).
  const t = get(teams, slug);
  if (t === null) return slug;
  return truthy(get(t, "fictional")) ? season.fcs_label(slug) : t["name"];
}

function team_in_line(slug, teams) {
  // A team's name inside a sentence: "Iowa State", but "the Plains Thunderheads" (a stand-in's name ends in its mascot).
  const t = get(teams, slug);
  const name = season.team_display(slug, teams);
  return t !== null && truthy(get(t, "fictional")) && fcs_names.brand(slug) !== null ? `the ${name}` : name;
}

/** A hash of a text that is the same in every run: a number from the text alone. */
function _text_hash(text) {
  let h = 0;
  for (const ch of String(text)) h = (Math.imul(h, 31) + ch.codePointAt(0)) >>> 0;
  return h;
}

function fcs_map(schedules, teams) {
  const saved = file_exists(season.FCS_MAP_FILE) ? JSON.parse(read_text(season.FCS_MAP_FILE)) : {};
  const fictional = sorted(Object.keys(teams).filter((slug) => truthy(teams[slug]["fictional"])));
  let changed = false;
  for (const [espn_id, info] of Object.entries(schedules["fcs"])) {
    if (own(saved, espn_id)) continue;
    const state = get(season.FCS_STATES, get(info, "location") || "");
    let slug;
    if (truthy(state) && own(season.STATE_REGION, state) && own(season.REGION_TEAM, season.STATE_REGION[state])) {
      slug = season.REGION_TEAM[season.STATE_REGION[state]];
    } else {
      slug = fictional[mod(_text_hash(get(info, "name", espn_id)), fictional.length)];
    }
    saved[espn_id] = { name: get(info, "name"), state, counterpart: slug };
    changed = true;
  }
  if (changed) write_text(season.FCS_MAP_FILE, json_dumps(saved, { indent: 1 }));
  const out = {};
  for (const [k, v] of Object.entries(saved)) out[k] = v["counterpart"];
  return out;
}

// ----- the real 2026 preseason polls ----

function _real_polls_2026(teams) {
  // {week_after: [slugs]} for the AP polls in data/history/polls.json; week 0 = preseason.
  if (!file_exists(season.HISTORY_POLLS)) return {};
  const hist = get(read_json(season.HISTORY_POLLS), "2026");
  if (!truthy(hist)) return {};
  const lookup = teamnames.build_matcher(teams);
  const out = {};
  const pre = get(hist, "preseason") || [];
  if (pre.length) out[0] = sorted(pre, (r) => r["rank"]).map((r) => teamnames.match(r["name"] || "", lookup));
  for (const [w, v] of Object.entries(get(hist, "weeks", {}))) {
    if (own(v, "ap")) {
      // ESPN's "week N" poll is released after our week N: ESPN's week 1 spans our weeks 1 and
      // 2 (the Labor Day weekend), so from week 2 on the numbers line up
      out[int(Number(w))] = sorted(v["ap"], (r) => r["rank"]).map((r) => teamnames.match(r["name"] || "", lookup));
    }
  }
  for (const w of Object.keys(out)) out[w] = out[w].filter((s) => truthy(s));
  return out;
}

function _real_ap_votes_2026(week, teams) {
  // The real AP poll after our week `week` (0 = preseason) with its vote points: [top 25,
  // others receiving votes, slug -> {points, first_place}]; null when it is not in the archive.
  if (!file_exists(season.HISTORY_POLLS)) return null;
  const hist = get(read_json(season.HISTORY_POLLS), "2026") || {};
  let top, others;
  if (week === 0) {
    top = get(hist, "preseason") || [];
    others = get(hist, "preseason_others") || [];
  } else {
    const entry = get(get(hist, "weeks") || {}, String(week)) || {};
    top = get(entry, "ap") || [];
    others = get(entry, "ap_others") || [];
  }
  if (!top.length) return null;
  const lookup = teamnames.build_matcher(teams);
  const votes = {}, order = [], rest = [];
  for (const [rows, dest] of [[sorted(top, (r) => r["rank"]), order], [sorted(others, (r) => r["rank"]), rest]]) {
    for (const r of rows) {
      const slug = teamnames.match(get(r, "name") || "", lookup);
      if (truthy(slug) && !own(votes, slug) && !truthy(teams[slug]["fictional"])) {
        votes[slug] = { points: int(get(r, "points") || 0), first_place: int(get(r, "first_place") || 0) };
        dest.push(slug);
      }
    }
  }
  return [order.slice(0, 25), rest.slice(0, season.AP_OTHERS), votes];
}

function _poll_seed(state, week) {
  // The random seed of the voters' ballots for a week of this season.
  return (get(state, "seed") || 0) * 1000 + week;
}

function _ballot_poll(state, prev_full, games, rec_t, tiers, week, pinned = []) {
  // The AP poll from the voters' ballots (polls.next_ballots): each simulated voter moves
  // their own ballot with the week's results, and the poll is the ballots added up, so the
  // points and first-place votes are the voters' own. The ballots are kept in the season;
  // the first simulated week seeds them from the last poll's vote points. `pinned` (the
  // champion, then the runner-up) go first and second on every ballot for the final poll.
  const seed = season._poll_seed(state, week);
  let ballots = get(state, "ap_ballots");
  if (!truthy(ballots)) ballots = polls.seed_ballots(prev_full, undefined, seed);
  ballots = polls.next_ballots(ballots, prev_full, games, rec_t, tiers, polls.load_ballot_params(), seed)[0];
  const top = pinned.filter((t) => truthy(t));
  if (top.length) ballots = ballots.map((b) => [...top, ...b.filter((t) => !top.includes(t))].slice(0, 25));
  state["ap_ballots"] = ballots;
  const [points, first] = polls.tally(ballots);
  const ranked = sorted(Object.keys(points).filter((t) => get(tiers, t) !== "FCS"), (t) => [-points[t], -get(first, t, 0), t]);
  const order = ranked.slice(0, 25), others = ranked.slice(25, 25 + season.AP_OTHERS);
  const votes = {};
  for (const t of [...order, ...others]) votes[t] = { points: get(points, t, 0), first_place: get(first, t, 0) };
  return [order, others, votes];
}

// ----- season state --------------------------------------------------------

function _spread_double_bookings(games, teams) {
  // No FBS team plays twice in one week. A few real games land in the same sim week as
  // another game of the same team (MAC Tuesday nights, or a game whose kickoff time is not
  // set yet and so sits at midnight Eastern); the later unplayed game moves to the nearest
  // regular-season week where both teams are free. Returns the number of games moved.
  const busy = (team, week) => Object.values(games).some((g) => g["week"] === week && (team === g["home"] || team === g["away"]));

  let moved = 0;
  for (const week of range(1, season.LAST_REGULAR_WEEK + 1)) {
    const playing = new Set();
    for (const g of Object.values(games)) {
      if (g["week"] === week) {
        playing.add(g["home"]);
        playing.add(g["away"]);
      }
    }
    for (const team of sorted(playing)) {
      if (truthy(teams[team]["fictional"])) continue;      // one FCS stand-in covers several real FCS schools
      const mine = sorted(Object.values(games).filter((g) => g["week"] === week && (team === g["home"] || team === g["away"])),
        (g) => [g["played"], get(g, "date") || ""]);
      for (const g of mine.slice(1).filter((x) => !truthy(x["played"]))) {
        const other = g["home"] === team ? g["away"] : g["home"];
        const free = range(1, season.LAST_REGULAR_WEEK + 1).filter((w) => w !== week && !busy(team, w) && !busy(other, w));
        if (!free.length) continue;
        g["week"] = minBy(free, (w) => [Math.abs(w - week), w < week]);
        moved += 1;
      }
    }
  }
  return moved;
}

function _saturday(week) {
  // The Saturday of a regular-season week, as an afternoon kickoff in UTC.
  const day = new Date(season.SEASON_EPOCH.getTime() + ((week - 1) * 7 + 4) * 86400000);
  return `${day.toISOString().slice(0, 10)}T19:30Z`;
}

function _fill_open_dates(games, teams) {
  // Give FBS teams with only 11 regular-season games a 12th. Some games are announced
  // late (the Pac-12's Nov. 28 "flex" games name their opponents a week before), so the
  // schedule data has holes. Teams with a hole are paired to avoid recent rematches (then
  // to keep conference mates together) and play in the latest week both have open.
  // Returns the number of games added.
  const count = {};
  const homes = {};
  for (const g of Object.values(games)) {
    for (const t of [g["home"], g["away"]]) count[t] = get(count, t, 0) + 1;
    homes[g["home"]] = get(homes, g["home"], 0) + 1;
  }
  const short = sorted(Object.keys(teams).filter((t) => !truthy(teams[t]["fictional"]) && get(count, t, 0) < 12));

  const open_weeks = (team) => {
    const out = new Set();
    for (const w of range(1, season.LAST_REGULAR_WEEK + 1)) {
      if (!Object.values(games).some((g) => g["week"] === w && (team === g["home"] || team === g["away"]))) out.add(w);
    }
    return out;
  };
  const both_open = (a, b) => {          // open_weeks(a) & open_weeks(b)
    const theirs = open_weeks(b);
    return [...open_weeks(a)].filter((w) => theirs.has(w));
  };

  const last_met = (a, b) => {
    // The latest week a and b already meet (0 if they do not).
    let latest = 0, any = false;
    for (const g of Object.values(games)) {
      if ((g["home"] === a && g["away"] === b) || (g["home"] === b && g["away"] === a)) {
        latest = any ? Math.max(latest, g["week"]) : g["week"];
        any = true;
      }
    }
    return latest;
  };

  const cost = (a, b) => {
    // How poor a pairing is: a rematch costs more the more recent the first meeting,
    // a different conference a little; null if they share no open week.
    if (!both_open(a, b).length) return null;
    const met = last_met(a, b);
    return (met ? 100 - (season.LAST_REGULAR_WEEK - met) : 0) + (teams[a]["conference"] !== teams[b]["conference"] ? 10 : 0);
  };

  const best = (pool) => {
    // The cheapest set of pairs from `pool` (every pairing is tried: the pool is a handful
    // of teams); a team left without a partner adds a large cost.
    if (pool.length < 2) return [1000.0 * pool.length, []];
    const a = pool[0], rest = pool.slice(1);
    const [unpaired_cost, unpaired_pairs] = best(rest);      // `a` sits out
    const options = [[1000 + unpaired_cost, unpaired_pairs]];
    rest.forEach((b, i) => {
      const c = cost(a, b);
      if (c !== null) {
        const sub = best([...rest.slice(0, i), ...rest.slice(i + 1)]);
        options.push([c + sub[0], [[a, b], ...sub[1]]]);
      }
    });
    return minBy(options, (o) => o[0]);
  };

  const pairs = short.length <= 10 ? best(short.slice())[1] : [];
  let added = 0;
  for (const [a, b] of pairs) {
    const w = Math.max(...both_open(a, b));
    const [home, away] = get(homes, a, 0) <= get(homes, b, 0) ? [a, b] : [b, a];
    const same = teams[a]["conference"] === teams[b]["conference"];
    const eid = `flex-${w}-${home}-${away}`;
    games[eid] = { event_id: eid, week: w, date: season._saturday(w), neutral: false, home, away,
      home_display: teams[home]["name"], away_display: teams[away]["name"],
      conference_game: false, played: false, home_score: null, away_score: null,
      overtime: 0, real: false, kind: "regular",
      title: same ? `${teams[a]["conference"]} Flex Game` : "Open-Date Game" };
    homes[home] = get(homes, home, 0) + 1;
    added += 1;
  }
  return added;
}

function new_season(team_slug, mode = "full", seed = null, fill_open_dates = true, coach = null, career = false, year = 2026,
  schedule = null, league = null, career_id = null, real_polls = true) {
  // A new season from the 2026 schedule, or from `schedule` (a generated later year's games,
  // sim_js/schedule_gen.js, keyed by event id). `fill_open_dates` adds a game for teams whose
  // schedule has an unannounced date (the real 2026 page turns it off: it shows only real games).
  // `career`: a Coach Career (career.js), which starts from week 1. `year`: a career's later
  // season (the active league's rosters, offseason.js), which gets no real polls; without a
  // generated `schedule` it replays the 2026 games with home and away swapped every other year.
  // `league`: a career from a league file (league_file.check's, already in play through use_league),
  // stored with id `career_id` before the career starts. `real_polls=False`: the preseason poll comes
  // from the ratings (_rating_poll), not the real 2026 AP poll (a league whose shape the file changed).
  if (mode !== "full") throw new Error("a season starts from week 1");
  const teams = season.load_teams();
  if (!own(teams, team_slug)) throw new Error(`unknown team ${team_slug}`);
  const schedules = read_json(season.SCHEDULES_FILE);
  const counterparts = season.fcs_map(schedules, teams);
  const fcs_names = {};
  for (const [k, v] of Object.entries(read_json(season.FCS_MAP_FILE))) fcs_names[k] = v["name"];
  // (no seed: seeded from the computer's own randomness)
  const rng = new Random(seed === null || seed === undefined ? crypto.getRandomValues(new Uint32Array(1))[0] : seed);
  let games = odict();
  if (schedule !== null && schedule !== undefined) {
    games = odict();
    for (const [eid, g] of Object.entries(schedule)) games[eid] = { ...g };
    fill_open_dates = false;                      // a generated schedule is complete
  }
  for (let g of (schedule === null || schedule === undefined ? schedules["games"] : [])) {
    let home = g["home_slug"] || get(counterparts, g["home_espn"]);
    let away = g["away_slug"] || get(counterparts, g["away_espn"]);
    if (mod(year - 2026, 2) && !truthy(g["neutral"])) {
      [home, away] = [away, home];              // the return game
      g = { ...g, home_slug: g["away_slug"], away_slug: g["home_slug"], home_espn: g["away_espn"], away_espn: g["home_espn"] };
    }
    if (!truthy(home) || !truthy(away) || home === away || !own(teams, home) || !own(teams, away)) continue;
    let week = season.week_of_date(g["date"]) || season.SELECTION_WEEK;
    if (week > season.LAST_REGULAR_WEEK) week = season.SELECTION_WEEK;  // games after championship week (Army-Navy) sit in selection week
    const rec = { event_id: g["event_id"], week, date: g["date"], neutral: g["neutral"],
      home, away,
      fcs_shift: (!truthy(g["home_slug"]) ? season.fcs_strength(get(fcs_names, g["home_espn"], ""))
        : !truthy(g["away_slug"]) ? season.fcs_strength(get(fcs_names, g["away_espn"], "")) : 0.0),
      home_display: truthy(g["home_slug"]) ? teams[home]["name"] : season.fcs_label(home),
      away_display: truthy(g["away_slug"]) ? teams[away]["name"] : season.fcs_label(away),
      conference_game: teams[home]["conference"] === teams[away]["conference"] && !truthy(teams[home]["fictional"]),
      played: false, home_score: null, away_score: null, overtime: 0, real: false, kind: "regular" };
    games[rec["event_id"]] = rec;
  }
  season._spread_double_bookings(games, teams);
  if (truthy(fill_open_dates)) season._fill_open_dates(games, teams);

  const state = {
    coach,
    id: crypto.randomUUID().replace(/-/g, "").slice(0, 12), created_at: new Date().toISOString().slice(0, 19) + "+00:00",
    team: team_slug, team_name: teams[team_slug]["name"], conference: teams[team_slug]["conference"],
    mode, seed, current_week: 0, phase: "regular", done: false,
    games, polls: {}, scores: {}, champions: {}, runners_up: {}, bracket: null, playoff: {}, my_boxes: odict(),
    settings: { god_mode: false, morale: true },
    rng_state: rng.randrange(1 << 30), year,
  };
  if (league !== null && league !== undefined) {
    state["league"] = league;
    if (truthy(career_id)) state["id"] = career_id;
  }
  const use_real = truthy(real_polls) && year === 2026;
  real_polls = use_real ? season._real_polls_2026(teams) : {};
  let preseason = get(real_polls, 0);
  if (!truthy(preseason)) preseason = season._rating_poll(teams);
  const [ap_params] = polls.load_params();
  const ratings = {};
  for (const [slug, t] of Object.entries(teams)) if (!truthy(t["fictional"])) ratings[slug] = t["team_ratings"]["overall"];
  state["scores"] = polls.preseason_scores(preseason.slice(0, 25), ratings, ap_params);
  const tiers = season._tiers(teams);
  const pre_full = polls.rank(state["scores"], {}, tiers, ap_params, 25 + season.AP_OTHERS);
  const pre_top = new Set(preseason.slice(0, 25));
  let pre_others = pre_full.filter((t) => !pre_top.has(t)).slice(0, season.AP_OTHERS);
  let pre_votes = season._ap_votes(state, [...preseason.slice(0, 25), ...pre_others], tiers, ap_params, 0);
  const real_pre = use_real ? season._real_ap_votes_2026(0, teams) : null;
  if (truthy(real_pre) && same_list(real_pre[0].slice(0, 25), preseason.slice(0, 25))) {
    preseason = real_pre[0];
    pre_others = real_pre[1].length ? real_pre[1] : pre_others;
    pre_votes = { ...pre_votes, ...real_pre[2] };
  }
  state["polls"]["0"] = { ap: season._poll_entries(preseason.slice(0, 25), {}, state, teams, 0, undefined, pre_votes),
    ap_others: season._poll_entries(pre_others, {}, state, teams, 0, 26, pre_votes) };
  Object.assign(state["polls"]["0"], season._coaches_entries(state, teams, preseason.slice(0, 25), pre_others, {}, tiers, ap_params, 0, null));
  if (truthy(career)) modules.career.new_career(state, coach);
  return state;
}

function _rating_poll(teams) {
  return sorted(Object.entries(teams), (kv) => -kv[1]["team_ratings"]["overall"]).filter(([, t]) => !truthy(t["fictional"]))
    .map(([slug]) => slug).slice(0, 25);
}

// ----- small helpers on one game ----------------------------------------------------

function _winner(g) {
  // The winner of a played game (the away team when the scores are level).
  return g["home_score"] > g["away_score"] ? g["home"] : g["away"];
}

function _scores_for(g, home) {
  // [points for, points against] from one side's point of view.
  return truthy(home) ? [g["home_score"], g["away_score"]] : [g["away_score"], g["home_score"]];
}

function _venue(g, home) {
  // Where a game is played for one side: "neutral", "home" or "away".
  if (truthy(g["neutral"])) return "neutral";
  return truthy(home) ? "home" : "away";
}

function _record_str(r) {
  // A won-lost record as text, e.g. "9-3".
  return `${r["wins"]}-${r["losses"]}`;
}

function _poll_game(g) {
  // The part of a played game the poll models read.
  return { home: g["home"], away: g["away"], home_score: g["home_score"], away_score: g["away_score"],
    neutral: g["neutral"] };
}

function _ccg_event_id(conference) {
  // The event id of a conference's title game.
  return `ccg-${conference.toLowerCase().replaceAll(" ", "-")}`;
}

function _records(state, through_week = null, include_playoff = false) {
  // Won-lost records. Playoff games are left out by default (bowl selection, the
  // committee and the weekly polls work on the season before the playoff); every record
  // shown on the page (header, standings, schedules, summary) and the final AP poll pass
  // include_playoff.
  const teams = season.load_teams();
  const rec = {};
  for (const slug of Object.keys(teams)) rec[slug] = { wins: 0, losses: 0, conf_wins: 0, conf_losses: 0, points_for: 0, points_against: 0 };
  const through = through_week !== null && through_week !== undefined;
  for (const g of Object.values(state["games"])) {
    if (!truthy(g["played"]) || (through && g["week"] > through_week) || (g["kind"] === "playoff" && !truthy(include_playoff))) continue;
    const hs = g["home_score"], as_ = g["away_score"];
    for (const [slug, pf, pa] of [[g["home"], hs, as_], [g["away"], as_, hs]]) {
      const r = rec[slug];
      r["points_for"] += pf;
      r["points_against"] += pa;
      const won = pf > pa;
      r[won ? "wins" : "losses"] += 1;
      if (truthy(g["conference_game"]) && g["kind"] === "regular") r[won ? "conf_wins" : "conf_losses"] += 1;
    }
  }
  return rec;
}

function _opponents(state) {
  const out = {};
  for (const g of Object.values(state["games"])) {
    if (!truthy(g["played"]) || g["kind"] === "playoff") continue;
    for (const [side, opp] of [["home", "away"], ["away", "home"]]) {
      (out[g[side]] ??= []).push({ opp: g[opp], won: g[`${side}_score`] > g[`${opp}_score`], week: g["week"],
        kind: g["kind"], conference_game: g["conference_game"] });
    }
  }
  return out;
}

function divisions(state) {
  // The conferences that play divisions in this state's league: the built-in ones with a league
  // file's over them (league_file.divisions); a conference mapped to {} plays without.
  const out = { ...season.DIVISIONS, ...(get(get(state || {}, "league") || {}, "divisions") || {}) };
  return Object.fromEntries(Object.entries(out).filter(([, d]) => truthy(d)));
}

function division_of(conference, slug, divs = null) {
  for (const [name, members] of Object.entries(get(divs === null || divs === undefined ? season.DIVISIONS : divs, conference, {}))) {
    if (members.includes(slug)) return name;
  }
  return null;
}

season.TIEBREAK_STEPS = ["head-to-head", "record against common opponents", "record against the highest-placed common opponent",
  "conference strength of schedule", "latest ranking", "point margin"];

function _ranking_positions(state) {
  // Position of every team in the most recent ranking: the committee's full order when
  // it exists, else the AP poll (top 25 plus others receiving votes).
  for (const w of sorted(Object.keys(state["polls"]).map((k) => int(Number(k))), undefined, true)) {
    const p = state["polls"][String(w)];
    let order = get(p, "cfp_full");
    if (!truthy(order)) order = get(p, "cfp", []).map((e) => e["team"]);
    if (!order.length) order = [...get(p, "ap", []).map((e) => e["team"]), ...get(p, "ap_others", []).map((e) => e["team"])];
    if (order.length) {
      const out = {};
      order.forEach((t, i) => {
        out[t] = i;
      });
      return out;
    }
  }
  return {};
}

function _pct(wins, games) {
  return games ? wins / games : 0.0;
}

function _order_rows(rows, conf_rows, opp, rank_pos) {
  // Order a conference (or division) table the way the conferences do it.
  //
  // Teams sort by conference winning percentage. Tied teams go through the ladder the
  // Power Four and most Group of Five conferences use for seeding the title game:
  //   1. head-to-head among the tied teams (combined record when more than two are tied);
  //   2. record against the conference opponents common to all tied teams;
  //   3. record against the highest-placed common opponent, then the next one down;
  //   4. conference strength of schedule (conference winning percentage of each team's
  //      conference opponents);
  //   5. the latest ranking (the committee's, else the AP poll), which the SEC, Big Ten and
  //      ACC use directly and the Big 12 approximates with an analytics ranking;
  //   6. point margin, standing in for the conferences' draw.
  // When a step separates some of the tied teams from the rest, each smaller group restarts
  // at step 1, as the written procedures do once a tie is reduced. Rows that needed the
  // ladder get `tiebreak`, the step that placed them.
  const conf_slugs = new Set(conf_rows.map((r) => r["slug"]));
  const by_slug = {};
  for (const r of conf_rows) by_slug[r["slug"]] = r;
  const conf_games = {};
  for (const sl of Object.keys(by_slug)) {
    conf_games[sl] = get(opp, sl, []).filter((o) => conf_slugs.has(o["opp"]) && get(o, "kind", "regular") === "regular"
      && truthy(get(o, "conference_game", true)));
  }
  const provisional = sorted(conf_rows, (r) => [-season._pct(r["conf_wins"], r["conf_wins"] + r["conf_losses"]),
    -season._pct(r["wins"], r["wins"] + r["losses"]), -(r["points_for"] - r["points_against"])]);
  const place = {};
  provisional.forEach((r, i) => {
    place[r["slug"]] = i;
  });

  const vs = (team, opponents) => {
    const gs = conf_games[team].filter((o) => opponents.has(o["opp"]));
    return [sum(gs.filter((o) => truthy(o["won"])).map(() => 1)), gs.length];
  };

  // (The group's slugs come in the group's order. Nothing depends on it: every step answers with a value per slug,
  // or with null whoever is asked first.)
  const metric = (step, group) => {
    const slugs = new Set(group.map((r) => r["slug"]));
    if (step === 0) {
      const vals = {};
      for (const sl of slugs) {
        const others = new Set(slugs);
        others.delete(sl);
        const [w, g] = vs(sl, others);
        if (g === 0) return null;
        vals[sl] = w / g;
      }
      return vals;
    }
    if (step === 1 || step === 2) {
      let common = null;                          // set.intersection of every tied team's conference opponents
      for (const sl of slugs) {
        const theirs = new Set(conf_games[sl].map((o) => o["opp"]));
        common = common === null ? theirs : new Set([...common].filter((x) => theirs.has(x)));
      }
      common = new Set([...common].filter((x) => !slugs.has(x)));
      if (!common.size) return null;
      if (step === 1) {
        const vals = {};
        for (const sl of slugs) vals[sl] = season._pct(...vs(sl, common));
        return vals;
      }
      for (const c of sorted(common, (sl) => place[sl])) {
        const vals = {};
        for (const sl of slugs) vals[sl] = season._pct(...vs(sl, new Set([c])));
        if (new Set(Object.values(vals)).size > 1) return vals;
      }
      return null;
    }
    if (step === 3) {
      const vals = {};
      for (const sl of slugs) {
        const gs = conf_games[sl];
        if (!gs.length) return null;
        vals[sl] = sum(gs.map((o) => season._pct(by_slug[o["opp"]]["conf_wins"], by_slug[o["opp"]]["conf_wins"] + by_slug[o["opp"]]["conf_losses"])))
          / gs.length;
      }
      return vals;
    }
    if (step === 4) {
      const vals = {};
      for (const sl of slugs) vals[sl] = -get(rank_pos, sl, 10000);
      return vals;
    }
    const vals = {};
    for (const sl of slugs) vals[sl] = by_slug[sl]["points_for"] - by_slug[sl]["points_against"];
    return vals;
  };

  const resolve = (group) => {
    if (group.length <= 1) return group.slice();
    for (const step of range(season.TIEBREAK_STEPS.length)) {
      const vals = metric(step, group);
      if (vals === null) continue;
      const best = Math.max(...Object.values(vals));
      const top = group.filter((r) => vals[r["slug"]] === best);
      if (top.length === group.length) continue;
      const rest = group.filter((r) => vals[r["slug"]] !== best);
      for (const r of group) if (!own(r, "tiebreak")) r["tiebreak"] = season.TIEBREAK_STEPS[step];
      return [...resolve(top), ...resolve(rest)];
    }
    return group.slice();
  };

  for (const r of rows) delete r["tiebreak"];
  const groups = new Map();                       // by conference winning percentage (a number: a Map keeps it one)
  for (const r of rows) {
    const pct = season._pct(r["conf_wins"], r["conf_wins"] + r["conf_losses"]);
    if (!groups.has(pct)) groups.set(pct, []);
    groups.get(pct).push(r);
  }
  const ordered = [];
  for (const pct of sorted(groups.keys(), undefined, true)) ordered.push(...resolve(groups.get(pct)));
  return ordered;
}

function _team_form(state, teams) {
  // Per team: home and away records, streak (+n wins / -n losses), the last game, and
  // the current AP and CFP ranks. Playoff games are left out like the records.
  const latest = get(state["polls"], String(state["current_week"])) || {};
  const ap = {}, cfp = {};
  for (const e of get(latest, "ap", [])) ap[e["team"]] = e["rank"];
  for (const e of get(latest, "cfp", [])) cfp[e["team"]] = e["rank"];
  const out = {};
  for (const slug of Object.keys(teams)) {
    out[slug] = { home_wins: 0, home_losses: 0, away_wins: 0, away_losses: 0, streak: 0, last: null,
      ap_rank: get(ap, slug), cfp_rank: get(cfp, slug) };
  }
  const played = sorted(Object.values(state["games"]).filter((g) => truthy(g["played"]) && g["kind"] !== "playoff"),
    (g) => [g["week"], get(g, "date") || ""]);
  for (const g of played) {
    const hs = g["home_score"], as_ = g["away_score"];
    for (const [slug, opp, pf, pa, side] of [[g["home"], g["away"], hs, as_, "home"], [g["away"], g["home"], as_, hs, "away"]]) {
      const f = get(out, slug);
      if (f === null) continue;
      const won = pf > pa;
      const venue = truthy(g["neutral"]) ? "neutral" : side;
      if (venue !== "neutral") f[`${venue}_${won ? "wins" : "losses"}`] += 1;
      f["streak"] = won ? (f["streak"] > 0 ? f["streak"] + 1 : 1) : (f["streak"] < 0 ? f["streak"] - 1 : -1);
      f["last"] = { won, score: `${pf}-${pa}`, opponent: opp,
        opponent_name: season.team_display(opp, teams), venue, week: g["week"] };
    }
  }
  return out;
}

function standings(state) {
  // Conference tables. Rows carry `division` (None where the conference has none),
  // `conf_rank` (counted within the division when there is one), `champion` and
  // `runner_up` once the title game is played, and `tiebreak` when the ladder placed them.
  const teams = season.load_teams();
  const rec = season._records(state, undefined, true);
  const opp = season._opponents(state);
  const rank_pos = season._ranking_positions(state);
  const form = season._team_form(state, teams);
  const divs = season.divisions(state);
  const table = {};
  for (const [slug, t] of Object.entries(teams)) {
    if (truthy(t["fictional"])) continue;
    const r = { slug, name: t["name"], division: season.division_of(t["conference"], slug, divs), ...rec[slug], ...form[slug] };
    (table[t["conference"]] ??= []).push(r);
  }

  for (const [conf, rows] of Object.entries(table)) {
    if (own(divs, conf)) {
      const ordered = [];
      for (const div of Object.keys(divs[conf])) {
        const group = season._order_rows(rows.filter((r) => r["division"] === div), rows, opp, rank_pos);
        group.forEach((r, i) => {
          r["conf_rank"] = i + 1;
        });
        ordered.push(...group);
      }
      rows.splice(0, rows.length, ...ordered);
    } else {
      rows.splice(0, rows.length, ...season._order_rows(rows, rows, opp, rank_pos));
      rows.forEach((r, i) => {
        r["conf_rank"] = i + 1;
      });
    }
    const champ = get(state["champions"], conf);
    const second = get(get(state, "runners_up", {}), conf);
    for (const r of rows) {
      r["champion"] = truthy(champ) && r["slug"] === champ;
      r["runner_up"] = truthy(second) && r["slug"] === second;
      if (polls.INDEPENDENT.has(conf)) delete r["tiebreak"];   // independents have no conference table to break
    }
  }
  return table;
}

function _poll_entries(order, prev_rank, state, teams, week = null, start = 1, votes = null, records = null) {
  const rec = records !== null && records !== undefined ? records : season._records(state, week);
  const out = [];
  order.forEach((slug, i0) => {
    const i = i0 + start;
    const r = get(rec, slug, { wins: 0, losses: 0 });
    const e = { rank: i, team: slug, name: teams[slug]["name"], previous: get(prev_rank, slug),
      record: season._record_str(r), conference: teams[slug]["conference"] };
    if (votes !== null && votes !== undefined) {
      const v = get(votes, slug, { first_place: 0, points: 0 });
      e["first_place"] = v["first_place"];
      e["points"] = v["points"];
    }
    out.push(e);
  });
  return out;
}

function _ap_votes(state, order, tiers, params, week) {
  return polls.ballots(order, state["scores"], tiers, params, undefined, season._poll_seed(state, week));
}

function _coaches_entries(state, teams, ap_order, others, rec_t, tiers, params, week, prev_week, records = null, pinned = []) {
  // The Coaches Poll for a week: the AP order nudged by record and the previous
  // coaches poll, then its own 65 ballots. `pinned` teams (the champion and runner-up
  // in the final poll) stay on top.
  const prev = prev_week !== null && prev_week !== undefined ? get(get(state["polls"], String(prev_week), {}), "coaches", []) : [];
  const prev_rank = {};
  for (const e of prev) prev_rank[e["team"]] = e["rank"];
  const opinion = polls.coaches_opinion([...ap_order, ...others], get(state, "seed") || 0, week);
  let order = polls.coaches_order([...ap_order, ...others], rec_t, prev_rank, opinion);
  order = [...pinned.filter((t) => truthy(t)), ...order.filter((t) => !pinned.includes(t))];
  const top = order.slice(0, 25), rest = order.slice(25, 25 + season.AP_OTHERS);
  const votes = polls.ballots([...top, ...rest], state["scores"], tiers, params, polls.COACHES_VOTERS,
    season._poll_seed(state, week) + 500, polls.COACHES_NOISE);
  return { coaches: season._poll_entries(top, prev_rank, state, teams, week, undefined, votes, records),
    coaches_others: season._poll_entries(rest, prev_rank, state, teams, week, 26, votes, records) };
}

function _final_ap_poll(state, teams) {
  // The AP's last poll, released after the national championship: every bowl and
  // playoff result counts, the champion is first and the runner-up second (true of every
  // final poll of the playoff era), and the rest fall in by the model.
  const [ap_params] = polls.load_params();
  const tiers = season._tiers(teams);
  const with_ap = Object.entries(state["polls"]).filter(([, v]) => truthy(get(v, "ap"))).map(([k]) => int(Number(k)));
  const last_week = with_ap.length ? Math.max(...with_ap) : season.CCG_WEEK;
  const prev = state["polls"][String(last_week)]["ap"];
  const prev_rank = {};
  for (const e of prev) prev_rank[e["team"]] = e["rank"];
  const post_games = Object.values(state["games"]).filter((g) => truthy(g["played"]) && g["week"] > season.SELECTION_WEEK).map((g) => season._poll_game(g));
  const rec = season._records(state, undefined, true);
  const rec_t = {};
  for (const [s, r] of Object.entries(rec)) rec_t[s] = [r["wins"], r["losses"]];
  const scores = polls.update_scores(state["scores"], post_games, prev_rank, rec_t, tiers, season.CCG_WEEK, season.CCG_WEEK, ap_params);
  const final = get(state["games"], "cfp-final");
  const champion = get(state, "champion");
  let runner_up = null;
  if (truthy(final) && truthy(champion)) {
    runner_up = final["home"] === champion ? final["away"] : final["home"];
    const top = Math.max(...Object.values(scores));
    scores[champion] = top + 120.0;          // the title settles the top of the poll
    scores[runner_up] = Math.max(get(scores, runner_up, 0.0), top + 40.0);
  }
  state["scores"] = scores;
  const prev_full = [...prev, ...get(state["polls"][String(last_week)], "ap_others", [])];
  let order, others, votes;
  if (prev_full.some((e) => truthy(get(e, "points")))) {
    [order, others, votes] = season._ballot_poll(state, prev_full, post_games, rec_t, tiers, season.FINAL_WEEK, [champion, runner_up]);
  } else {
    const full = polls.rank(scores, rec_t, tiers, ap_params, 25 + season.AP_OTHERS);
    order = [...[champion, runner_up].filter((t) => truthy(t)), ...full.filter((t) => t !== champion && t !== runner_up)];
    others = order.slice(25, 25 + season.AP_OTHERS);
    order = order.slice(0, 25);
    votes = season._ap_votes(state, [...order, ...others], tiers, ap_params, season.FINAL_WEEK);
  }
  state["polls"]["19"] = { ap: season._poll_entries(order, prev_rank, state, teams, undefined, undefined, votes, rec),
    ap_others: season._poll_entries(others, prev_rank, state, teams, undefined, 26, votes, rec),
    final: true };
  Object.assign(state["polls"]["19"], season._coaches_entries(state, teams, order, others, rec_t, tiers, ap_params, 19, last_week,
    rec, [champion, runner_up]));
}

function _update_polls_after_week(state, teams, week) {
  const [ap_params, cfp_params] = polls.load_params();
  const tiers = season._tiers(teams);
  const prev = get(get(state["polls"], String(week - 1), {}), "ap", []);
  const prev_rank = {};
  for (const e of prev) prev_rank[e["team"]] = e["rank"];
  const week_games = Object.values(state["games"]).filter((g) => truthy(g["played"]) && g["week"] === week && g["kind"] !== "playoff")
    .map((g) => season._poll_game(g));
  const rec = season._records(state, week);
  const rec_t = {};
  for (const [s, r] of Object.entries(rec)) rec_t[s] = [r["wins"], r["losses"]];
  // the season-long scores still move (the committee model reads them) ...
  state["scores"] = polls.update_scores(state["scores"], week_games, prev_rank, rec_t, tiers, week, season.CCG_WEEK, ap_params);
  // ... but the AP poll moves from last week's poll and its vote points, the way voters do
  const prev_full = [...prev, ...get(get(state["polls"], String(week - 1), {}), "ap_others", [])];
  let order, others, votes;
  if (prev_full.some((e) => truthy(get(e, "points")))) {
    [order, others, votes] = season._ballot_poll(state, prev_full, week_games, rec_t, tiers, week);
  } else {                                  // an old saved season without vote points
    const full = polls.rank(state["scores"], rec_t, tiers, ap_params, 25 + season.AP_OTHERS);
    order = full.slice(0, 25);
    const in_order = new Set(order);
    others = full.filter((t) => !in_order.has(t)).slice(0, season.AP_OTHERS);
    votes = season._ap_votes(state, [...order, ...others], tiers, ap_params, week);
  }
  const entry = { ap: season._poll_entries(order, prev_rank, state, teams, week, undefined, votes),
    ap_others: season._poll_entries(others, prev_rank, state, teams, week, 26, votes) };
  Object.assign(entry, season._coaches_entries(state, teams, order, others, rec_t, tiers, ap_params, week, week - 1));
  if (season.CFP_WEEKS.has(week)) {
    const opp = season._opponents(state);
    const opp_full = {};
    for (const [t, lst] of Object.entries(opp)) {
      opp_full[t] = lst.map((o) => ({ opp: o["opp"], won: o["won"], opp_record: get(rec_t, o["opp"], [0, 0]) }));
    }
    const ap_rank = {};
    for (const e of entry["ap"]) ap_rank[e["team"]] = e["rank"];
    const champions = week >= season.CCG_WEEK ? state["champions"] : null;
    const corder = polls.committee_rank(state["scores"], rec_t, tiers, opp_full, ap_rank, champions, cfp_params, 60);
    const prev_cfp = {};
    for (const e of get(get(state["polls"], String(week - 1), {}), "cfp", [])) prev_cfp[e["team"]] = e["rank"];
    entry["cfp"] = season._poll_entries(corder.slice(0, 25), prev_cfp, state, teams, week);
    entry["cfp_full"] = corder;   // the committee's full order, used for the bracket's auto bids
  }
  state["polls"][String(week)] = entry;
}

Object.assign(season, {
  week_of_date, load_teams, use_league, activate, season_year, _is_p4,
  card_of, return_value, shown_overall,
  page_attribute, page_overall, same_group, tier_of, _tiers,
  fcs_strength, fcs_label, stand_in_names, team_display, team_in_line, fcs_map,
  _real_polls_2026, _real_ap_votes_2026, _poll_seed, _ballot_poll,
  _spread_double_bookings, _saturday, _fill_open_dates, new_season, _rating_poll,
  _winner, _scores_for, _venue, _record_str, _poll_game, _ccg_event_id, _records, _opponents,
  divisions, division_of, _ranking_positions, _pct, _order_rows, _team_form, standings,
  _poll_entries, _ap_votes, _coaches_entries, _final_ap_poll, _update_polls_after_week,
});
