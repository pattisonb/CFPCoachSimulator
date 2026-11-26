// The offseason of a Coach Career and the step to the next season
// (docs/superpowers/specs/2026-10-23-career-offseason-design.md).
//
// After national signing day `start` opens the offseason: the career's league is taken for next
// year (league.js), players leave (graduation, the NFL draft, the transfer portal, quitting) and
// the signed classes arrive. Then `advance` walks the stages: Keep Them Home (your leavers answer,
// then the draft runs), Departures (what happened), the portal's four weeks, player development,
// staff changes, and `next_season` hands back the new season's state.
//
//     state["offseason"] = {"stage": one of STAGES, "year": next season, "departures": [event],
//                           "portal": {"players": {id: entrant}, "round": 1}, "staff": {...}, "report": {...}}
//
// The offseason, part 1: the constants, the start of the offseason, the
// yearly meeting with your athletic director, Keep Them Home, and the season's production and honors for development.
//
// Every name of the offseason is reached through the `offseason` namespace, whichever part defines it
// (engine_js/PORTING.md, "Big Files in Parts"). Modules reached through `modules`: season, recruiting.
// Notes on standing quirks are at the end of this file.
import { Random, round, int, sum, floordiv, sorted, get, truthy } from "../../engine_js/pyrt.js";
import { modules } from "../../engine_js/modules.js";
import { awards } from "../../sim_js/awards.js";
import { league as lg } from "../league.js";
import { coach_names } from "../coach_names.js";
import { ability_goals } from "../ability_goals.js";
import { word } from "../word.js";
import { carousel } from "../carousel.js";
import { programs } from "../programs.js";
import { promises } from "../promises.js";
import { offseason } from "../offseason_ns.js";

// ----- small helpers (local to this part) --------------------------------------------------------------------

const has = (d, k) => Object.prototype.hasOwnProperty.call(d, k);
/** A value inside seed, key or sentence text, for the ones that can be null or a boolean ("None", "True": as the seeds have always had them). */
const pystr = (v) => (v === null || v === undefined ? "None" : v === true ? "True" : v === false ? "False" : String(v));
/** `x in coll` for a set, tuple or list another part or module may hold as a Set or an array. */
const _in = (x, coll) => (coll instanceof Set ? coll.has(x) : Array.from(coll).includes(x));
/** d.setdefault(k, default) */
const setdefault = (d, k, v) => { if (d[k] === undefined) d[k] = v; return d[k]; };
/** A tuple of plain values as a dict's or a set's key. */
const _key = (...xs) => JSON.stringify(xs.map((x) => (x === undefined ? null : x)));
/** template.format(**values) for the "{name}" fields of this file's own templates. */
const _format = (template, values) => template.replace(/\{(\w+)\}/g, (_, name) => pystr(values[name]));

// Keep Them Home first, then Departures: who wants out is decided at the start, the draft runs after your
// answers (and the AI schools'), so Departures shows only what happened. Saves from the older order: migrate()
offseason.STAGES = ["retention", "departures", "portal_w1", "portal_w2", "portal_w3", "portal_w4", "portal_recap", "development", "athletes", "cuts", "cuts_recap", "staff", "conferences", "schedule", "ready"];
offseason.PORTAL_STAGES = ["portal_w1", "portal_w2", "portal_w3", "portal_w4"];
offseason.OLD_PORTAL = { "portal_1": "portal_w1", "portal_2": "portal_w2" };     // saves from the two-round portal
offseason.STAGE_NAMES = { "departures": "Departures", "athletes": "Place Your Athletes", "cuts_recap": "Roster Moves", "retention": "Keep Them Home", "portal_w1": "Transfer Portal, Week 1", "portal_w2": "Transfer Portal, Week 2",
  "portal_w3": "Transfer Portal, Week 3", "portal_w4": "Transfer Portal, Week 4",
  "portal_recap": "Portal Recap", "portal_1": "Transfer Portal, Round 1", "portal_2": "Transfer Portal, Round 2",
  "development": "Progression", "cuts": "Roster Cuts", "staff": "Staff", "conferences": "Change Conferences", "schedule": "Edit Schedule",
  "ready": "Ready for Next Season" };
offseason.ROSTER_LIMIT = 85;          // EA's roster limit (the real 2026 rosters; the NCAA's has been 105 since 2025)
offseason.FILL_TO = 80;               // walk-ons and lower-level transfers top a roster up to this
offseason.GROUP = { "QB": "QB", "HB": "RB", "FB": "RB", "WR": "WR", "TE": "TE", "LT": "OL", "LG": "OL", "C": "OL", "RG": "OL", "RT": "OL",
  "LEDG": "DL", "REDG": "DL", "DT": "DL", "SAM": "LB", "MIKE": "LB", "WILL": "LB", "CB": "CB", "FS": "S", "SS": "S",
  "K": "K", "P": "P" };
// a healthy roster's players per group (the real 2026 FBS mean) and the floor walk-ons top up to
offseason.TARGET = { "QB": 4, "RB": 6, "WR": 11, "TE": 6, "OL": 15, "DL": 15, "LB": 9, "CB": 8, "S": 8, "K": 2, "P": 1 };
offseason.LOWER_LEVEL = 0.3;          // the share of roster top-ups who come from FCS or junior college (three-stars, a year or two in), not walk-ons
offseason.LOWER_LEVEL_P4 = 0.15;     // ... at a Power 4 school (mostly walk-ons there)
offseason.FLOOR = { "QB": 3, "RB": 3, "WR": 6, "TE": 3, "OL": 10, "DL": 9, "LB": 5, "CB": 5, "S": 4, "K": 1, "P": 1 };

// ----- departures *tune* -----
offseason.NEXT_CLASS = { "FR": "SO", "FRRS": "SORS", "SO": "JR", "SORS": "JRRS", "JR": "SR", "JRRS": "SRRS" };
offseason.REDSHIRT = { "FR": 0.78, "SO": 0.35, "JR": 0.25 };   // chance a player off the depth chart's top takes his redshirt year
offseason.REDSHIRT_GAMES = 4;                                 // the four-game rule: more games than this and the year is used
offseason.REDSHIRT_CLASSES = ["FR", "SO", "JR"];              // classes with a redshirt year still to take
offseason.FIFTH_YEAR = 0.60;                                  // a senior with his redshirt unused who barely played comes back
offseason.DRAFT_PICKS = 257;
offseason.DRAFT_FROM_FBS = 0.97;                              // the share of picks from FBS (the rest from lower levels)
// the draft by position. A prospect's grade is his card overall against this year's top draft-eligible
// players at his position (a z-score on their mean and spread; DRAFT_ABS_SHARE of it against every
// position's), so a position whose overalls run high, or drift up over a career, cannot take the first
// round over (before, a score per raw overall point, steepest for QB and WR, did). His draft score is
// DRAFT_VALUE[group] * grade + DRAFT_SHIFT[group] + noise: the NFL's positional value, quarterbacks,
// tackles, edge rushers and corners early, backs, guards, linebackers, safeties and tight ends later,
// specialists last. Fitted to data/draft_targets.json (the 2021-2025 NFL
// drafts' round-one and all-pick counts by position) *tune*
offseason.DRAFT_GROUP = { "QB": "QB", "HB": "RB", "FB": "RB", "WR": "WR", "TE": "TE", "LT": "OT", "RT": "OT", "LG": "IOL", "RG": "IOL", "C": "IOL",
  "LEDG": "EDGE", "REDG": "EDGE", "DT": "DL", "SAM": "LB", "MIKE": "LB", "WILL": "LB", "CB": "CB", "FS": "S", "SS": "S",
  "K": "K", "P": "P" };
offseason.DRAFT_VALUE = { "QB": 1.634, "RB": 0.619, "WR": 1.548, "TE": 0.884, "OT": 1.374, "IOL": 1.041, "EDGE": 1.248, "DL": 0.856,   // draft score per standard deviation of grade *tune*
  "LB": 1.183, "CB": 0.969, "S": 0.866, "K": 0.5, "P": 0.5 };
offseason.DRAFT_SHIFT = { "QB": 0.161, "RB": -0.159, "WR": -0.41, "TE": -0.876, "OT": -0.035, "IOL": -0.813, "EDGE": -0.408, "DL": -0.507,   // a position's step up or down the board *tune*
  "LB": -0.972, "CB": -0.214, "S": -0.938, "K": -1.575, "P": -1.506 };
offseason.DRAFT_NOISE = 0.25;                                 // the scouts' disagreement, in standard deviations of grade *tune*
offseason.DRAFT_REF_SHARE = 0.08;                             // a grade is against the top this share of a position's draft-eligible players ... *tune*
offseason.DRAFT_REF_MIN = 12;                                 // ... at least this many of them *tune*
offseason.DRAFT_MIN_SD = 1.5;                                 // ... and their spread taken as at least this (overall points) *tune*
offseason.DRAFT_ABS_SHARE = 0.33;                             // the share of a grade against every position's prospects, not his own (a 99 is a 99): slow physical growth leaves a year's best QB near 76, and the first pick should still be a top player *tune*
offseason.DRAFT_RUN = 0.12;                                   // the board steps the n-th player at a position down this much a place ... *tune*
offseason.DRAFT_RUN_CAP = 6;                                  // ... for at most this many places (needs spread a first round) *tune*
// projected first-rounders almost always go (the real drafts: a handful of first-round underclassmen stay a year) *tune*
offseason.DECLARE = [[16, 0.99], [32, 0.97], [64, 0.88], [100, 0.65], [160, 0.35], [257, 0.12], [10 ** 9, 0.004]];   // projected pick -> an underclassman declares
offseason.UNDERCLASS_ELIGIBLE = new Set(["JR", "JRRS", "SORS"]);       // three years out of high school
offseason.ELITE_DECLARE = 96;                                 // an eligible underclassman rated this (overall) or better always declares ... *tune*
offseason.ELITE_MIN_GAMES = 6;                                // ... after a decent season: at least this many games played (half a regular season) *tune*
offseason.ELITE_STAY = 0.02;                                  // such a player stays this often, whatever you offer at Keep Them Home *tune*
offseason.AI_KEEP_DRAFT = [[32, 0.03], [100, 0.08], [10 ** 9, 0.2]];   // an AI school talks an early entrant projected at this pick into staying (your odds offering nothing) *tune*
offseason.PORTAL_BASE = { "FR": 0.05, "FRRS": 0.09, "SO": 0.10, "SORS": 0.12, "JR": 0.10, "JRRS": 0.12, "SR": 0.18 };
offseason.PORTAL_USAGE = { "starter": 0.12, "rotation": 0.65, "bench": 1.3 };
offseason.PORTAL_LOSING = 1.25;                               // a losing season pushes players out
offseason.TRANSFER_UP_FROM = 79; offseason.TRANSFER_UP = 0.40;              // a Group of 5 player this good (overall) enters this often
offseason.QUIT = 0.012;                                       // quitting or a medical retirement, a year
offseason.PROMISE_BROKEN = 3.0;                               // a player promised a starting role who did not get it: his portal chance next year
offseason.KEPT_STAY = 0.7;                                    // a player you kept home: his portal chance the year after
offseason.AI_KEEP = 0.33;                                     // an AI school keeps a would-be portal entrant who would start for it this often
// why starters leave (every school): NIL under his market, a slipping program, a weak or new coach *tune*
offseason.NIL_TIER_PAY = { 1: 60, 2: 40, 3: 20, 4: 8, 5: 2 };    // what a starter can expect in NIL points at a program of this tier (recruiting.market_value is his market)
offseason.NIL_PULL = 0.25;                                    // a starter's or rotation player's portal chance adds this times his shortfall's share of his market ...
offseason.NIL_PULL_CAP = 0.30;                                // ... at most this (a kept player was paid: exempt the next year)
offseason.PROGRAM_PULL = 0.10;                                // ... and this when the program is slipping: a tier lost this year, a new head coach's first year,
offseason.PROGRAM_FLOOR = 77;                                 // or a losing year under a weak developer (WEAK_COACH); for players rated at least this (overall)
offseason.WEAK_COACH = 70;                                    // a head coach's player development under this, after a losing year: players want a better coach
offseason.RISING_STAY = 0.5;                                  // a program that rose a tier this year: its starters' portal chances, times this
offseason.RETAIN_ASK = [25, 1.8, 79];                         // what a leaver wants to stay: this plus this per overall point over the third, times his position
offseason.RETAIN_PLAYING_TIME = 1.5;                          // ... times this when what he really wants is snaps (NIL can still buy him)
offseason.RETAIN_DRAFT = 2.5;                                 // ... times this for a draft entrant (and 1.5 more for a top-100 projection)
offseason.RETAIN_LOWBALL = 0.5;                               // under this share of his ask an offer is worth nothing
offseason.QUIT_LOW = 2.5;                                     // ... this much likelier in the team's bottom 15%

// ----- the portal *tune* -----
offseason.PORTAL_OFFER_FACTOR = 2.0;                          // a school's offers a round, times its open spots
offseason.PORTAL_PASSES = 3;                                  // offer-and-sign passes in a portal round (schools with spots left offer again)
offseason.PORTAL_TAKE = 4;                                    // transfers an AI school takes in a round from its open spots (real: 5-15 a year with churn)
offseason.CHURN = 8;                                          // portal spots a Power 4 school makes by releasing its weakest players
offseason.OPEN_TAKE_ANY = 4;                                  // with this many open spots a school takes good players at any position

// ----- roles a roster keeps filled *tune* -----
offseason.ROLE_FILL = { "C": ["LG", "RG", "LT", "RT"], "SAM": ["WILL", "MIKE"] };   // a role no one plays at the offseason's end: the positions a staff moves a player from
offseason.SAM_FRONT_LBS = 3;                                  // a base front with this many linebackers has a SAM (has_sam)
// an entrant's choice: playing time, the program (its recruiting pull and team rating), winning, home
offseason.PT_WEIGHT = 1.0; offseason.PRESTIGE_WEIGHT = 0.8; offseason.RATING_WEIGHT = 0.3; offseason.WIN_WEIGHT = 0.6; offseason.HOME_WEIGHT = 0.4; offseason.PICK_NOISE = 0.5;

// ----- development and staff *tune* -----
offseason.DEV_RATE = 0.75;                                    // coachability's pace: a class tracks the real players by stars and
                                                              // years, three- and two-stars a little under the survivors
// real players gain little in their first offseasons and most in their third and fourth (the real rosters
// by years in college: four-stars +1, +1, +5.5): the pace by seasons already played in the program *tune*
offseason.YEAR_CURVE = [0.45, 0.7, 1.35, 1.35, 1.0];
// ... but a season as a starter is a full year of learning whatever his class: a freshman or sophomore who
// played at least half his team's games (production rated against the average starter: _performance's z)
// develops at this pace or his year's, whichever is more (a true freshman quarterback who threw for 3,400
// yards gained one point on 0.45) *tune*
offseason.STARTER_YEAR = 1.0;
// the best get better slowest: above DEV_TOP (overall) a player's pace is divided by 1 + his points over
// it / DEV_TOP_SPAN, so the real rosters' top juniors (fast learners with big rooms and big seasons) do not
// all become 85+ seniors: a career's senior classes keep the real 2026 seniors' top end (tests/test_progression_realism.mjs) *tune*
offseason.DEV_TOP = 81;
offseason.DEV_TOP_SPAN = 4;
// the most of his room an offseason closes: the pace's factors (his year, his program, his staff, his
// production, his position, his third year) compound to 2-4 for a few players a year, a rate past 1,
// and a real junior rated 49 with a 1,300-point room became a 99 in one offseason (a career's first
// senior class had 10-12 linebackers rated 85+ where the real 2026 seniors have 2). Half his room a
// year keeps the real seniors' top end (tests/test_progression_realism.mjs) and leaves the medians by
// stars and years where they were *tune*
offseason.DEV_YEAR_CAP = 0.5;
// a position group's pace against the league's: the real rosters' backs, quarterbacks and receivers peak
// early and their senior classes sit lowest, linemen come on late (the real 2026 seniors by position),
// where one pace for everyone left a career's skill-position seniors 2-5 points high and its linemen low.
// Fitted with faked seasons (tests/test_progression_realism.mjs checks a played one) *tune*
offseason.DEV_PACE = { "QB": 0.75, "RB": 0.5, "WR": 0.75, "TE": 1.28, "OT": 1.32, "IOL": 1.07, "EDGE": 1.16, "DL": 0.9, "LB": 1.19, "CB": 1.1,
  "S": 0.94, "K": 0.51, "P": 0.84 };
offseason.PROGRAM_DEV = 0.35;                                 // development rate per point of the program's recruiting baseline (the blue bloods' facilities and staffs: the top stays the top)
offseason.PROGRAM_DEV_BELOW = 0.15;                           // ... below the average program (the Group of 5 develops less, not half as much)
offseason.TEAM_YEAR_SD = 0.15;                                // a team's year: its strength program, culture and luck, one lognormal factor on everyone's growth
offseason.ERA_SD = 0.30;                                      // a program's era: a slow-moving factor on its development (a staff that develops, or does not),
offseason.ERA_PERSIST = 0.75;                                 // ... carried year to year at this rate (stationary spread ERA_SD); programs' paths part and cross
offseason.PLAYER_YEAR_SD = 0.35;                              // a player's year: booms and busts, a lognormal factor on his growth (mean-preserving)
offseason.COORD_SHARE = 0.4;                                  // the coordinator's part of a player's coach factor
offseason.RECRUITER_LEAVE = 0.12;                             // a recruiter's base chance of moving on in a year
// ----- staff contracts *tune* (money is not in yet: contract["ask"] is None; asked raise on renewal: not yet) -----
offseason.UNDER_CONTRACT = 0.35;                              // signed for the coming season: his leaving odds, times this (a coordinator the
                                                              // carousel wanted goes through this often; the rest turn the job down)
offseason.SHOPPING = 2.0;                                     // his contract up: a recruiter's leaving odds, times this ...
offseason.SHOP_CAP = 0.9;                                     // ... capped here
offseason.COORD_SHOP = 0.25;                                  // a coordinator whose contract is up and whom no program wanted still leaves this often
offseason.TERM = { "coordinator": [2, 4], "recruiter": [1, 3] };   // the years a new contract runs (candidates ask the same ranges)
// ----- coach development *tune*: every coach in the league (head coaches, coordinators, your recruiters, the market) -----
offseason.COACH_RATE = 0.33;                                  // the share of the gap to his hidden level a rating closes in a year
offseason.COACH_POT = [[40, 4.2], [55, 0.6], [63, -3.0], [null, -4.8]];   // his level against his rating when first seen: N(mean by age, COACH_POT_SD):
                                                              // the young have room, the old are rated over where they are heading (a mean-zero or
                                                              // ceiling-only draw inflated the league's head coaches in ten seasons: the carousel's
                                                              // hiring harvests the spread)
offseason.COACH_POT_SD = 3.6;
offseason.COACH_CLIMB = 7;                                   // a rating never climbs more than this over where he was first seen (the level is capped there too)
offseason.COACH_AGE = [[40, 1.3], [55, 1.0], [63, 0.6]];      // the pace under 40, 40-54 and 55-62; from 63 he gains nothing ...
offseason.COACH_DECLINE = 0.9;                                // ... each rating drops this many points a year (a point this often)
offseason.COACH_WOBBLE = [-1, 0, 0, 0, 0, 0, 0, 1];          // a rating's point of noise a year (one picked)
offseason.COACH_PERF = { 2: 1.2, 0: 0.0, "-1": -0.6, "-2": -1.2 };  // the points his year's verdict adds to each rating, on the _staff_marks scale (+2 top third,
offseason.COACH_PERF_OLD = 0.5;                               // -2 bottom third, -1 a weak class); from 63 it counts this much
offseason.COACH_IDLE = 0.5;                                   // a coach for hire (the market) develops at this pace, his year neither good nor bad
offseason.CLASS_MARK_MIN = 70;                                // the class verdict needs this many schools with a class (none: no school ranked "first" on nothing)
offseason.COACH_FLOOR = 60; offseason.COACH_CAP = 99;
offseason.COACH_AGE_UNKNOWN = [32, 58];                       // a recruiter's age when first seen (the league's coaches: carousel._age)
offseason.RATING_WORDS = { "player_development": "Evaluation", "recruiting": "Recruiting", "play_calling": "Play Calling", "offense": "Offense",
  "defense": "Defense", "discipline": "Discipline", "game_management": "Game Management", "motivation": "Motivation",
  "qb_development": "QB Development", "ol_development": "OL Development", "pass_rush_development": "Pass Rush Development",
  "secondary_development": "Secondary Development", "evaluation": "Evaluation" };


function seed_key(state) {
  // What a career's random streams are seeded from: its seed when it has one (the same seed
  // gives the same offseason, so tests repeat), else its id.
  return get(state, "seed") !== null ? state["seed"] : state["id"];
}


function _rng(state, what) {
  return new Random(`offseason-${pystr(offseason.seed_key(state))}-${pystr(get(state, "year", 2026))}-${what}`);
}


function _attrs(lgd) {
  return lgd["attrs"];
}


function house(pos, ovr) {
  // A league player's overall ("o", game_scale.overall of his ratings).
  return int(ovr);
}


function _record(state, slug) {
  const season = modules.season;
  const r = get(season._records(state, undefined, true), slug) || {};
  return [get(r, "wins", 0), get(r, "losses", 0)];
}


function _usage(state = null) {
  // team -> player slug -> starter / rotation (next on his role's depth) / bench, from the season's teams, with the
  // depth chart each team played (`state`'s depth-chart changes: the starter you set all season is your starter).
  const season = modules.season;
  const out = {};
  const depth = get(truthy(state) ? state : {}, "depth") || {};
  for (let [slug, t] of Object.entries(season.load_teams())) {
    if (truthy(get(t, "fictional"))) continue;
    if (truthy(get(depth, slug))) t = season.apply_depth(season.team_data(state, slug), depth[slug]);
    const u = {}, starts = new Map();
    const players = t["offense"].concat(t["defense"]);
    for (const p of players) {
      if (truthy(get(p, "in_game"))) starts.set(get(p, "role"), (starts.has(get(p, "role")) ? starts.get(get(p, "role")) : 0) + 1);
    }
    for (const p of players) {
      if (truthy(get(p, "in_game"))) u[p["slug"]] = "starter";
      else if ((get(p, "depth") || 99) <= (starts.has(get(p, "role")) ? starts.get(get(p, "role")) : 1) + 1) u[p["slug"]] = "rotation";
      else u[p["slug"]] = "bench";
    }
    out[slug] = u;
  }
  return out;
}


// ----- start: departures and the arriving classes ----------------------------------------------

function start(state) {
  // Open the offseason after national signing day: next year's league, every program's
  // departures and the signed classes on the rosters, the portal open for round 1.
  const season = modules.season;
  if (truthy(get(state, "offseason"))) return state["offseason"];
  const year = season.season_year(state) + 1;
  const built = !truthy(get(state, "league"));
  const lgd = truthy(get(state, "league")) ? state["league"] : lg.from_base(year);
  lgd["year"] = year;
  state["league"] = lgd;
  for (const t of Object.values(lgd["teams"])) {         // a league file's depth chart is its first season's only
    delete t["depth"];
  }
  coach_names.distinct(state, built);     // one coach, one name: your coach's record is yours, no one doubles up
  offseason._season_moves(state, lgd);
  offseason.record_seasons(state, lgd);
  ability_goals.carry_over(state, lgd);         // abilities earned in games stay with the player
  const usage = offseason._usage(state);
  const draft = {};
  word.recover(state, year);                    // Keeps His Word drifts back toward neutral, before this year's promises land
  const [deps, entrants, pending] = offseason._departures(state, lgd, usage, undefined, draft);
  const signed = offseason._sign_classes(state, lgd);
  const performance = offseason._performance(state);
  state["offseason"] = { "stage": offseason.STAGES[0], "year": year, "departures": deps, "draft": draft,
    "portal": { "players": entrants, "round": 1, "offers": {}, "moves": [] },
    "signed": signed, "staff": null, "report": null, "performance": performance,
    "retention": { "players": offseason._retention_entries(state, lgd, pending), "results": null, "spent": 0 } };
  state["offseason"]["review"] = offseason._review(state, lgd);
  offseason._seed_pools(state);
  state["offseason"]["redshirts"] = offseason._redshirt_block(state, lgd, usage);
  state["offseason"]["position_changes"] = [];
  return state["offseason"];
}


function season_facts(state) {
  // What each program's season earns NIL for: wins, losses, the conference title, the playoff,
  // the national title and whether the AD's goal was met (yours from the review's verdict, an AI
  // school's by the same rule the carousel judges it by, without moving its AD).
  const me = get(state, "team");
  const rv = get(get(state, "offseason") || {}, "review") || {};
  const out = {};
  for (const [slug, res] of Object.entries(carousel._results(state))) {
    let met;
    if (slug === me && has(rv, "met")) {
      met = truthy(rv["met"]);
    } else {
      const g = carousel.goal(slug, state);
      met = res["wins"] >= g["wins"] && (g["kind"] !== "playoff" || res["playoff"]) && (g["kind"] !== "conference" || res["conference"]);
    }
    out[slug] = { ...res, "met": met };
  }
  return out;
}


function _seed_pools(state) {
  // Every school's NIL for the portal (recruiting.portal_pool), from the class it just signed
  // and the season it just played.
  const recruiting = modules.recruiting;
  const facts = offseason.season_facts(state);
  const pools = {};
  for (const slug of Object.keys(state["league"]["teams"])) pools[slug] = recruiting.portal_pool(state, slug, get(facts, slug) || {});
  state["nil_pool"] = pools;
}


// ----- the yearly meeting with your athletic director -------------------------------------------

class ReviewError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
offseason.ReviewError = ReviewError;


offseason.WARNING_BELOW = 40;               // security under this: a warning from the AD
offseason.CASE_GAIN = [2, 10];              // security a good case earns *tune*
offseason.CHANGE_GAIN = 10;                 // security for letting a coordinator go *tune*
offseason.REVIEW_STAGES = ["retention", "departures"];   // the AD's meeting is open until the portal does (the Overview shows it)
offseason.REVIEW_OPTIONS = { "case": "Make Your Case", "change": "Offer a Change on Your Staff", "year": "Ask for One More Year",
  "nothing": "Say Nothing" };


function _review(state, lgd) {
  // The AD's verdict on your season, decided here (the carousel reads it): the goal, your
  // record against it, where your security stands and what you can do about it.
  const me = state["team"];
  const year = state["offseason"]["year"];
  const t = lgd["teams"][me];
  carousel.ad(t, me);                                   // you start on solid ground
  const res = get(carousel._results(state), me, { "wins": 0, "losses": 0 });
  const v = carousel.judge(t, me, res, year);
  const a = t["ad"];
  const sec = v["security"];
  const must = sec < carousel.MUST_FIRE || (get(a, "ultimatum") === year && !truthy(v["met"]));
  const at_risk = must || (sec < carousel.FIRE_BELOW && v["tenure"] >= 2);
  const risk = at_risk ? "fire" : sec < offseason.WARNING_BELOW ? "warning" : "none";
  let options = risk !== "none" ? ["case", "change", "year", "nothing"] : [];
  if (must || !state["career"]["staff"].some((x) => has(offseason.STAFF_ROLES, x["role"]))) {
    options = options.filter((o) => o !== (must ? "year" : "change"));
  }
  if (must && options.includes("year")) {
    options.splice(options.indexOf("year"), 1);
  }
  let words = (`You went ${res["wins"]}-${res["losses"]}. ` + (truthy(v["met"]) ? "You met the goal. " : "You fell short of the goal. ")
    + { "fire": "The AD is deciding whether to make a change.", "warning": "The AD wants to see more next year.",
      "none": truthy(v["met"]) ? "The AD is pleased." : "The AD is patient." }[risk]);
  const nil_now = truthy(get(t, "program")) ? t["program"]["nil"] : null;
  let budgets = {};                                          // next year's NIL budget against this year's, for the recap
  if (nil_now !== null) {                                    // the collective: where the AD's hand takes it (programs.nil_move, at the carousel)
    const recruiting = modules.recruiting;
    const probe = { "program": { ...t["program"] } };
    programs.nil_move(probe, v["met"], res["wins"] < res["losses"],
      truthy(get(res, "playoff")) && carousel.goal(me, state)["kind"] !== "playoff");
    const nil_next = probe["program"]["nil"];
    const budget_next = Math.max(recruiting.NIL_FLOOR, recruiting._five(recruiting.NIL_PER_TIER * nil_next));
    budgets = { "nil_now": Math.max(recruiting.NIL_FLOOR, recruiting._five(recruiting.NIL_PER_TIER * nil_now)), "nil_next": budget_next };
    words += (` The collective ${nil_next > nil_now + 0.5 ? "grows" : nil_next < nil_now - 0.5 ? "shrinks" : "holds"}: `
      + `about ${budget_next} NIL points next year` + (Math.abs(nil_next - nil_now) > 0.5 ? ` (${nil_next > nil_now ? "up" : "down"} from ${Math.max(recruiting.NIL_FLOOR, recruiting._five(recruiting.NIL_PER_TIER * nil_now))}).` : "."));
  }
  if (get(a, "ultimatum") === year) {
    words += !truthy(v["met"]) ? " This was the year he gave you." : " You answered his ultimatum.";
  }
  const option_names = {};
  for (const o of options) option_names[o] = offseason.REVIEW_OPTIONS[o];
  return { "verdict": v, "goal": v["goal"]["text"], "met": v["met"], "record": [res["wins"], res["losses"]], "security": sec,
    "delta": v["delta"], "patience": v["patience"], "tenure": v["tenure"], "mood": carousel.mood(sec), "risk": risk,
    "must": must, "options": options, "option_names": option_names,
    "decided": risk === "none", "fired": false, "action": null, "outcome": risk !== "none" ? null : words, "words": words, ...budgets };
}


function review_decide(state, action, staff_id = null) {
  // What you say in the meeting; then the AD decides. Making your case earns a little; offering
  // a change lets a coordinator go (he joins the market, his job opens at the Staff step) and earns
  // more; asking for one more year always survives, with an ultimatum for next season; saying
  // nothing leaves it to him. Firing happens only here, at the end of a season.
  const off = get(state, "offseason") || {};
  const rv = get(off, "review");
  if (!_in(get(off, "stage"), offseason.REVIEW_STAGES) || !truthy(rv)) {
    throw new offseason.ReviewError(409, "the meeting with the AD closes once the transfer portal opens");
  }
  if (truthy(rv["decided"])) {
    throw new offseason.ReviewError(409, "the AD has already decided");
  }
  if (!rv["options"].includes(action)) {
    throw new offseason.ReviewError(400, "that is not on the table");
  }
  const me = state["team"], year = off["year"];
  const t = state["league"]["teams"][me];
  const a = t["ad"];
  const rng = new Random(`review-${pystr(offseason.seed_key(state))}-${pystr(year)}-${pystr(action)}`);
  let fired = rv["must"];
  let said;
  if (action === "case") {
    const gain = rng.randint(offseason.CASE_GAIN[0], offseason.CASE_GAIN[1]);
    a["security"] = Math.min(100, a["security"] + gain);
    said = "You made your case, and the AD heard you out.";
  } else if (action === "change") {
    const s = state["career"]["staff"].find((x) => x["id"] === staff_id && has(offseason.STAFF_ROLES, x["role"])) ?? null;
    if (s === null) {
      throw new offseason.ReviewError(400, "pick the coordinator you would let go");
    }
    const key = offseason.STAFF_ROLES[s["role"]];
    if (truthy(get(t["coaches"], key)) && get(t["coaches"][key], "name") === s["name"]) {
      carousel.market_add(state, t["coaches"][key], key, me, `Let go by ${carousel._name(me)} after the season`, year);
    }
    setdefault(off, "staff_open", {})[s["id"]] = "was let go after the season";
    a["security"] = Math.min(100, a["security"] + offseason.CHANGE_GAIN);
    said = `You let ${s["role"]} ${s["name"]} go.`;
  } else if (action === "year") {
    a["ultimatum"] = year + 1;
    said = "He gives you one more year, with an ultimatum: meet the goal next season.";
  } else {
    said = "You said nothing.";
  }
  if (!truthy(fired) && action !== "year" && a["security"] < carousel.FIRE_BELOW && rv["verdict"]["tenure"] >= 2) {
    fired = rng.random() < carousel.FIRE_CHANCE;
  }
  rv["decided"] = true;
  rv["fired"] = truthy(fired);
  rv["action"] = action;
  rv["security"] = a["security"];
  rv["mood"] = carousel.mood(a["security"]);
  rv["outcome"] = said + (truthy(fired) ? " The AD lets you go." : rv["risk"] === "fire" ? " You keep your job." : "");
  // the page shows `words`: once it is decided they say how it came out, not that the AD is still deciding
  rv["words"] = rv["words"].split(". ")[0] + ". " + (truthy(rv["verdict"]["met"]) ? "You met the goal. " : "You fell short of the goal. ") + rv["outcome"];
  if (truthy(fired)) {
    off["fired"] = true;
    off["auto"] = true;
  }
  return rv;
}


function _open_portal(state) {
  // The portal is recruited like a class: the signed class is kept aside, the entrants become the
  // class, your staff's first look goes on your board.
  const recruiting = modules.recruiting;
  const off = state["offseason"];
  if (truthy(get(state, "recruiting")) && !truthy(recruiting.is_portal(state))) {
    state["recruiting_last"] = state["recruiting"];
    state["recruiting"] = recruiting.portal_rc(state, off["portal"]["players"], off["year"]);
    recruiting.reset_caches();
    state["recruiting"]["board"] = [];       // your board starts empty: you pick from the entrants (Auto-recruit's staff add theirs week by week)
  }
}


// ----- keep them home: your leavers with eligibility left ------------------------------------------

class RetentionError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
offseason.RetentionError = RetentionError;


offseason.REASONS = { "buried": "Buried on the depth chart behind {ahead}", "snaps": "Wants more than a rotation role",
  "losing": "A losing year", "move_up": "A Power 4 program is calling", "restless": "Tired of waiting his turn",
  "deal": "Chasing a bigger NIL deal", "last_year": "One year left and he wants a change", "fresh_start": "Wants a fresh start",
  "draft": "Projects as a round {round} pick", "declared": "Believes he is ready for the NFL",
  "better_coach": "Wants a better coach", "slipping": "The program is slipping",
  "promised": "Was promised a starting role and did not get it" };


function _broken_promise(key, info, intent) {
  // A Keep Them Home leaver whose promised start broke: a Broken band whatever segment his draw landed in, or (an
  // untracked promise) the old rule's `promised` driver. A draft entrant is not leaving over it.
  if (intent !== "portal") return false;
  if (info !== null && info !== undefined) return get(info, "band") === "broken";
  return key === "promised";
}


function _keeps_promise(e) {
  // Your promise to a leaver who stays counts: not to one with no third chance (he won't believe it).
  return truthy(get(e["offers"], "promise")) && !truthy(get(e, "no_third"));
}


function _retention_entries(state, lgd, pending) {
  // Each of your pending leavers: why he is going, his role now and next year, and what it would
  // take (his ask stays hidden until you meet him).
  const recruiting = modules.recruiting;
  const me = get(state, "team");
  if (!truthy(pending) || me === null || !has(lgd["teams"], me)) return [];
  const roster = lgd["teams"][me]["roster"];
  const by_id = new Map(roster.map((p) => [p["id"], p]));
  const would_start = offseason._would_start(roster, recruiting.PORTAL_STARTERS);
  const _season = modules.season;
  const judged = promises.bands(state, _season.season_year(state));     // your promises this season, judged week by week
  const out = [];
  for (const item of pending) {
    const ev = item["ev"], use = item["use"];
    const p = by_id.get(ev["id"]);
    if (!truthy(p)) continue;
    const g = get(offseason.GROUP, p["pos"], "S");
    const peers = sorted(roster.filter((q) => get(offseason.GROUP, q["pos"], "S") === g), (q) => -q["o"]);
    const n = get(recruiting.PORTAL_STARTERS, g, 1);
    const role_next = _in(p["id"], would_start) ? "starter" : peers.slice(0, n + 2).includes(p) ? "rotation" : "bench";
    let over = null;
    if (role_next !== "starter") {
      const first = peers.find((q) => q["id"] !== p["id"] && _in(q["id"], would_start));
      over = first === undefined ? null : first["n"];
    }
    const intent = ev["kind"] === "declared" ? "draft" : "portal";
    const proj = get(ev, "proj");                                   // his projected pick (None: projected to go undrafted)
    let key, ahead;
    if (intent === "draft") {
      key = truthy(proj) ? "draft" : "declared";
      ahead = null;
    } else if (get(item, "driver") === "promised") {
      [key, ahead] = ["promised", null];                          // the promise he was given is why he goes, before his role
    } else if (use === "bench" && peers.length && peers[0]["id"] !== p["id"]) {
      [key, ahead] = ["buried", peers[0]["n"]];
    } else if (use === "rotation") {
      [key, ahead] = ["snaps", null];
    } else if (truthy(item["losing"])) {
      [key, ahead] = ["losing", null];
    } else if (["deal", "better_coach", "slipping"].includes(get(item, "driver"))) {
      [key, ahead] = [item["driver"], null];                      // what really drove him (portal_odds), not a guess
    } else if (!truthy(item["p4"]) && offseason.house(p["pos"], p["o"]) >= offseason.TRANSFER_UP_FROM) {
      [key, ahead] = ["move_up", null];
    } else if (use !== "starter") {
      [key, ahead] = ["restless", null];
    } else if (["SR", "SRRS"].includes(p["cls"])) {                     // p["cls"] is already next year's class
      [key, ahead] = ["last_year", null];
    } else if (truthy(get(item, "winning"))) {
      [key, ahead] = ["deal", null];
    } else {
      [key, ahead] = ["fresh_start", null];
    }
    const ovr = offseason.house(p["pos"], p["o"]);
    const base = Math.max(10, offseason.RETAIN_ASK[0] + offseason.RETAIN_ASK[1] * (ovr - offseason.RETAIN_ASK[2])) * get(recruiting.ASK_POS, p["pos"], 1.0);
    let kind, ask;
    if (intent === "draft") {
      kind = "nil";
      ask = base * offseason.RETAIN_DRAFT * ((truthy(proj) ? proj : 10 ** 6) <= 100 ? 1.5 : 1.0);
    } else if (role_next === "starter") {
      [kind, ask] = ["nil", base];
    } else {
      [kind, ask] = ["playing_time", base * offseason.RETAIN_PLAYING_TIME];
    }
    const shortfall = int(get(item, "shortfall") || 0);
    if (key === "deal" && shortfall) {
      ask = Math.max(ask, shortfall);                                // he wants at least what the market pays over your tier
    }
    const info = get(judged, p["id"]);
    const broken_promise = offseason._broken_promise(key, info, intent);          // judged Broken (whatever the draw), or the old rule's driver
    const no_third = broken_promise && get(p, "promised_again") !== null && get(p, "promised_again") === get(p, "promised");
    if (broken_promise) {                                           // it takes a lot of money now, more for some than others
      [kind, ask] = ["nil", base * promises.nil_mult(promises.personality_of(state, p["id"]))];
    }
    out.push({ "id": p["id"], "name": p["n"], "pos": p["pos"], "cls": p["cls"], "overall": ovr, "stars": get(p, "s"),
      "role_now": use, "role_next": role_next, "start_over": over, "intent": intent, "reason_key": key,
      "reason": _format(offseason.REASONS[key], { ahead, round: truthy(proj) ? Math.min(7, floordiv(proj - 1, 32) + 1) : null })
                + (no_third ? ". He won't believe another promise" : ""),
      "broken_promise": broken_promise, "no_third": no_third,
      "driver": get(item, "driver"), "shortfall": shortfall || null,
      "draft_pick": proj, "draft_kind": intent === "draft" ? (truthy(proj) ? "draft" : "undrafted") : null,
      "elite": intent === "draft" && truthy(get(item, "elite")), "cls_now": ev["cls"],
      "ask": { "kind": kind, "nil": int(5 * round(ask / 5)), "known": false },
      "offers": { "nil": 0, "promise": false, "released": false }, "met": false });
  }
  return out;
}


function _retention_view(state) {
  const recruiting = modules.recruiting;
  const off = get(state, "offseason") || {};
  const ret = get(off, "retention");
  if (ret === null) return null;
  const me = state["team"];
  const budget = recruiting.pool_record(state, me)["pool"];           // keep them home spends from the portal pool
  const players = [];
  for (const e of ret["players"]) {
    const row = {};
    for (const [k, v] of Object.entries(e)) if (k !== "ask") row[k] = v;
    row["ask"] = truthy(e["ask"]["known"]) ? { ...e["ask"] } : { "kind": null, "nil": null, "known": false };
    row["chance"] = truthy(e["ask"]["known"]) ? round(offseason.stay_chance(e, state), 2) : null;
    row["chance_word"] = (truthy(e["met"]) || truthy(get(e["offers"], "nil")) || truthy(get(e["offers"], "promise")))
      ? offseason._chance_word(offseason.stay_chance(e, state)) : null;
    row["role_now_name"] = offseason.ROLE_NAMES[e["role_now"]];
    row["role_next_name"] = offseason.ROLE_NAMES[e["role_next"]];
    players.push(row);
  }
  players.sort((a, b) => (-a["overall"]) - (-b["overall"]));     // the page's order: your best players first (the stored list keeps its own)
  return { "players": players, "results": get(ret, "results"), "spent": get(ret, "spent", 0), "budget": budget,
    "left": budget - get(ret, "spent", 0), "elite_stay": offseason.ELITE_STAY };
}


offseason.ROLE_NAMES = { "starter": "Starter", "rotation": "Rotation", "bench": "Bench" };


function _chance_word(c) {
  return c >= 0.65 ? "Likely to Stay" : c >= 0.4 ? "Could Go Either Way" : c >= 0.2 ? "Leaning Out" : "As Good As Gone";
}


function stay_chance(e, state = null) {
  // His chance to stay from what you offered against what he wants: NIL at his ask, or your promise of a starting
  // role (the player's ask: your word counts whoever rates higher today, and next season judges whether you start him,
  // promises.js); a draft entrant projected in the first round is gone whatever you say.
  const ask = e["ask"], offers = e["offers"];
  let nil_share = truthy(ask["nil"]) ? Math.min(1.0, get(offers, "nil", 0) / ask["nil"]) : (truthy(get(offers, "nil", 0)) ? 1.0 : 0.0);
  if (nil_share < offseason.RETAIN_LOWBALL) nil_share = 0.0;
  const honored = truthy(get(offers, "promise"));
  const hollow = truthy(get(offers, "promise")) && !honored;
  if (truthy(get(e, "broken_promise"))) {                  // promised a start and did not get it: one more promise, if it is real, or a lot of money
    let chance = honored && !truthy(get(e, "no_third")) ? promises.PROMISE_AGAIN_STAY : 0.02;
    if (state !== null && state !== undefined && chance > 0.02) {      // Keeps His Word: he reads your word at his position, or doesn't believe you
      const group = get(offseason.GROUP, get(e, "pos"), get(e, "pos"));
      const pers = truthy(get(e, "personality")) ? e["personality"] : promises.personality_of(state, e["id"]);
      chance = word.believes(state, group) ? Math.min(0.9, chance * word.promise_mult(state, null, group, pers)) : 0.02;
    }
    return Math.min(0.92, chance + 0.65 * nil_share);
  }
  if (e["intent"] === "draft") {
    const pick = get(e, "draft_pick") || 10 ** 6;
    if (truthy(get(e, "elite"))) {                       // rated ELITE_DECLARE or better after a decent season: a top pick, all but gone
      return offseason.ELITE_STAY;
    }
    if (pick <= 32) return Math.min(0.08, 0.03 + 0.05 * nil_share);
    const base = pick <= 100 ? 0.08 : 0.2;
    return Math.min(0.9, base + (pick <= 100 ? 0.5 : 0.6) * nil_share + (honored ? 0.1 : 0.0));
  }
  let chance = 0.1;
  chance += (ask["kind"] === "nil" ? 0.65 : 0.52) * nil_share;
  chance += honored ? 0.6 : hollow ? 0.05 : 0.0;
  return Math.min(0.92, chance);
}


function _retention_spent(off) {
  return sum(get(get(off, "retention") || {}, "players", []).map((e) => get(e["offers"], "nil", 0)));
}


function retain(state, pid, action, nil = 0) {
  // One move with a leaver: meet (his ask), promise (a starting role), nil (points from the portal
  // pool, replacing any earlier number), release (let him go). Returns the retention block.
  const recruiting = modules.recruiting;
  const off = get(state, "offseason") || {};
  if (get(off, "stage") !== "retention") {
    throw new offseason.RetentionError(409, "this is not the Keep Them Home step");
  }
  if (truthy(get(off, "fired"))) {
    throw new offseason.RetentionError(409, "you have been let go: the program's new coach decides");
  }
  const e = off["retention"]["players"].find((x) => x["id"] === pid) ?? null;
  if (e === null) {
    throw new offseason.RetentionError(404, "he is not one of the players thinking of leaving");
  }
  if (action === "meet") {
    e["met"] = true;
    e["ask"]["known"] = true;
  } else if (action === "promise") {
    e["offers"]["promise"] = true;
    e["offers"]["released"] = false;
  } else if (action === "nil") {
    if (nil < 0) {
      throw new offseason.RetentionError(400, "NIL points cannot be negative");
    }
    const others = offseason._retention_spent(off) - get(e["offers"], "nil", 0);
    if (others + nil > recruiting.pool_record(state, state["team"])["pool"]) {
      throw new offseason.RetentionError(400, "not enough NIL in the portal pool");
    }
    e["offers"]["nil"] = int(nil);
    e["offers"]["released"] = false;
  } else if (action === "release") {
    e["offers"]["nil"] = 0;
    e["offers"]["promise"] = false;
    e["offers"]["released"] = true;
  } else {
    throw new offseason.RetentionError(400, "unknown action");
  }
  off["retention"]["spent"] = offseason._retention_spent(off);
  return off["retention"];
}


function _resolve_retention(state) {
  // When you advance: each leaver stays or goes; the leavers join the portal or the draft, the
  // NIL you spent comes off your portal pool.
  const recruiting = modules.recruiting;
  const lgd = state["league"], off = state["offseason"];
  const ret = off["retention"];
  const me = state["team"], year = off["year"];
  const rng = offseason._rng(state, "retention");
  const auto = truthy(get(off, "auto"));
  const team = lgd["teams"][me];
  const by_id = new Map(team["roster"].map((p) => [p["id"], p]));
  const results = [], leaving = new Set();
  let spent = 0;
  for (const e of ret["players"]) {
    const p = by_id.has(e["id"]) ? by_id.get(e["id"]) : null;
    const chance = auto || truthy(get(e["offers"], "released")) || p === null ? 0.0 : offseason.stay_chance(e, state);
    const stayed = rng.random() < chance;
    if (stayed) {
      p["kept"] = year;
      if (offseason._keeps_promise(e)) {
        p["promised"] = year;
        if (truthy(get(e, "broken_promise"))) {
          p["promised_again"] = year;                // his second chance: break this one and there is no third
        }
      }
      spent += get(e["offers"], "nil", 0);
      offseason.life(p, year - 1, "stayed", { "intent": get(e, "intent"), "nil": get(e["offers"], "nil") || null,
        "promised": offseason._keeps_promise(e) ? true : null, "met": truthy(get(e, "met")) ? true : null });
    } else if (p !== null) {
      leaving.add(p["id"]);
      const ev = { "id": p["id"], "name": p["n"], "pos": p["pos"], "cls": e["cls"], "team": me, "team_name": lg.team_meta(get(state, "league"), me)["short_name"],
        "overall": e["overall"], "stars": get(p, "s") };
      if (e["intent"] === "draft") {
        ev["kind"] = "declared";                          // the draft (_run_draft) places him
        ev["early"] = true;
        ev["proj"] = get(e, "draft_pick");
        ev["cls"] = get(e, "cls_now") || ev["cls"];
      } else {
        ev["kind"] = "portal";
        off["portal"]["players"][p["id"]] = { "player": { ...p }, "from": me, "from_name": ev["team_name"],
          "offers": [], "signed": null, "usage": e["role_now"],
          "driver": get(e, "driver"), "shortfall": get(e, "shortfall") };
      }
      off["departures"].push(ev);
    }
    results.push({ "id": e["id"], "name": e["name"], "pos": e["pos"], "cls": e["cls"], "overall": e["overall"],
      "intent": e["intent"], "status": stayed ? "stayed" : "left",
      "chance": round(chance, 2), "nil": stayed ? get(e["offers"], "nil", 0) : 0, "promise": truthy(get(e["offers"], "promise")) && stayed });
  }
  team["roster"] = team["roster"].filter((p) => !leaving.has(p["id"]));
  const rs = get(off, "redshirts");
  if (truthy(rs) && !truthy(get(rs, "decided"))) {                 // Departures' redshirt calls: only for the players still here
    rs["players"] = rs["players"].filter((x) => !leaving.has(x["id"]));
  }
  ret["results"] = results;
  ret["spent"] = spent;
  recruiting.pool_record(state, me)["retained"] = spent;
  recruiting.reset_caches();
}


// ----- the season's production and honors, for development *tune* -----
offseason.PERF_RATE = 0.25;                 // development rate change per standard deviation of production over the average starter's
offseason.PERF_RANGE = [-1.0, 2.4];         // ... so a player develops 0.75 to 1.6 times as fast
offseason.BREAKOUT_FROM = 1.0;              // production this far over the average starter raises his ceiling ...
offseason.BREAKOUT_ROOM = 2.9;              // ... by this many rating points per standard deviation beyond half of one
offseason.HONOR_ROOM = { "heisman": 9, "national": 7, "all_america_1": 6, "national_finalist": 3, "all_america_2": 3,
  "conference_award": 3, "all_conference_1": 2, "all_conference_2": 1 };
offseason.HONOR_NAMES = { "heisman": "Heisman Trophy", "all_america_1": "All-America First Team", "all_america_2": "All-America Second Team",
  "all_conference_1": "All-Conference First Team", "all_conference_2": "All-Conference Second Team" };
offseason.ROOM_CAP = 12;                     // the most a year's honors and production add to his ceiling
offseason.LEVEL_UP = 0.4;                   // a national award winner or All-American moves up a coachability level this often
offseason.COACH_UP_BREAKOUT = 0.20;          // a breakout year (production BREAKOUT_FROM over the average starter) moves him up a level this often
offseason.COACH_UP_DEVELOPER = [[94, 0.12], [88, 0.08]];   // his coaches' player development (coach_factor's blend) at least this: a level up this often a year
offseason.COACH_UP_MATURITY = 0.06;          // a junior or senior who played, two or more levels from the top, grows up a level this often
offseason.COACH_UP_MATURITY_GAP = 2;         // ... the levels he must be below Coach's Dream
offseason.COACH_UP_REDSHIRT = 0.10;          // a redshirt year under a staff at REDSHIRT_STAFF or better player development moves him up this often
offseason.REDSHIRT_STAFF = 82;               // ... the staff's player development that makes the year one of learning
offseason.COACH_DOWN_BENCHED = 0.05;         // a starter who struggled and fell off the depth chart drops a level this often
offseason.COACH_CASES = ["breakout", "developer", "maturity", "redshirt"];   // the order a player's draws are taken in (fixed: one each, always)
offseason.PHYSICAL = new Set(["speed", "acceleration", "agility", "change_of_direction", "jumping", "stamina", "injury", "toughness", "strength",
  "kick_power", "throw_power"]);   // gifts and body: production does not raise these ceilings


offseason.HIST_KEEP = 8;                    // seasons kept on a player (a career is at most six)


function record_seasons(state, lgd) {
  // Every player's season (his line from the season's stats, his honors) goes onto his entry in
  // the league, `c["hist"]`, so his page keeps it through the rollover and a transfer. Returns how
  // many players got a line.
  const season = modules.season;
  const year = season.season_year(state);
  const teams = season.load_teams();
  const ss = get(state, "season_stats") || {};
  const perf = truthy(get(state, "season_stats")) ? offseason._performance(state) : {};
  let n = 0;
  for (const [slug, t] of Object.entries(lgd["teams"])) {
    const lines = get(get(ss, slug) || {}, "players") || {};
    const base = get(teams, slug) || {};
    const by_id = new Map((get(base, "offense") || []).concat(get(base, "defense") || []).map((p) => [get(p, "slug"), p]));
    for (const c of t["roster"]) {
      const hist = setdefault(c, "hist", []);
      if (hist.some((h) => h["year"] === year)) continue;
      const bp = by_id.has(c["id"]) ? by_id.get(c["id"]) : null;
      const line = truthy(bp) ? get(lines, `${c["n"]}|${bp["position"]}`) : null;
      if (!truthy(line) || !truthy(get(line, "games"))) continue;
      const honors = get(get(perf, c["id"]) || {}, "honors", []).map(([k, nm]) => ({ "kind": k, "name": nm }));
      const stats = {};
      for (const [k, v] of Object.entries(get(line, "stats") || {})) if (truthy(v)) stats[k] = v;
      hist.push({ "year": year, "team": slug, "class": get(c, "cls"), "position": bp["position"], "games": line["games"],
        "stats": stats, "honors": honors });
      if (hist.length > offseason.HIST_KEEP) hist.splice(0, hist.length - offseason.HIST_KEEP);
      n += 1;
    }
  }
  return n;
}


function _performance(state) {
  // player id -> {"z": production against the average starter at his group, "honors": [(kind, name)]}
  // from the season's stats (awards.Pool, the same scores the awards use) and its honors.
  const season = modules.season;
  const teams = season.load_teams();
  const ids = new Map();
  for (const [slug, t] of Object.entries(teams)) {
    for (const p of t["offense"].concat(t["defense"])) ids.set(_key(slug, p["name"], p["position"]), p["slug"]);
  }
  const ids_get = (team, name, position) => { const v = ids.get(_key(team, name, position)); return v === undefined ? null : v; };
  const out = {};
  if (truthy(get(state, "season_stats"))) {
    const pool = new awards.Pool(state, teams, season._records(state, undefined, true));
    for (const p of pool.players) {
      const sid = ids_get(p["team"], p["name"], p["position"]);
      const z = get(p["zb"], p["group"]);
      if (truthy(sid) && z !== null && pool.played_enough(p)) {
        out[sid] = { "z": round(z, 2), "honors": [] };
      }
    }
  }

  function honor(c, kind, name) {
    const sid = truthy(c) ? ids_get(get(c, "team"), get(c, "name"), get(c, "position")) : null;
    if (truthy(sid)) {
      setdefault(out, sid, { "z": null, "honors": [] })["honors"].push([kind, name]);
    }
  }

  const aw = get(state, "awards") || {};
  const nat = get(aw, "national") || {};
  const h = get(nat, "heisman") || {};
  (get(h, "finalists") || []).slice(0, 4).forEach((c, i) => {
    honor(c, i === 0 ? "heisman" : "national_finalist", i === 0 ? "Heisman Trophy" : "Heisman Finalist");
  });
  for (const a of (get(nat, "awards") || []).concat(get(get(aw, "postseason") || {}, "awards") || [])) {
    honor(get(a, "winner"), "national", a["name"]);
    for (const c of (get(a, "finalists") || []).slice(1)) {
      honor(c, "national_finalist", `${a["name"]} Finalist`);
    }
  }
  for (const row of (get(get(nat, "all_america") || {}, "consensus") || [])) {
    honor(row, `all_america_${Math.min(2, get(row, "level", 1))}`, offseason.HONOR_NAMES[`all_america_${Math.min(2, get(row, "level", 1))}`]);
  }
  for (const conf of Object.values(get(aw, "conference") || {})) {
    for (const a of get(conf, "awards") || []) {
      honor(get(a, "winner"), "conference_award", a["name"]);
    }
    const seen = new Set();
    for (const rows of Object.values(get(get(conf, "teams") || {}, "selectors") || {})) {
      for (const row of rows) {
        const key = _key(get(row, "team"), get(row, "name"));
        if (seen.has(key)) continue;
        seen.add(key);
        const kind = `all_conference_${Math.min(2, get(row, "level", 1))}`;
        honor(row, kind, offseason.HONOR_NAMES[kind]);
      }
    }
  }
  return out;
}


offseason.STRUGGLED_NOTE = "Struggled as a starter";
offseason.HARD_YEAR_NOTE = "Lost a step and some of his ceiling after a hard year as a starter";
offseason.STARTED_AS = { "SO": "freshman", "SORS": "redshirt freshman", "JR": "sophomore", "JRRS": "redshirt sophomore" };


function growth_terms(perf) {
  // (development rate multiplier, EA points added to his room in skill and football IQ, the
  // reasons, whether he may move up a coachability level) from a season's production and honors.
  if (!truthy(perf)) return [1.0, 0, [], false];
  let mult = 1.0, room = 0.0, why = [];
  const z = get(perf, "z");
  if (z !== null) {
    mult = 1 + offseason.PERF_RATE * Math.max(offseason.PERF_RANGE[0], Math.min(offseason.PERF_RANGE[1], z));
    if (z >= offseason.BREAKOUT_FROM) {
      room += offseason.BREAKOUT_ROOM * (z - 0.5);
      why.push("Breakout season");
    } else if (z <= -0.75) {
      why.push(offseason.STRUGGLED_NOTE);
    }
  }
  const kinds = get(perf, "honors", []).map(([k]) => k);
  const pts = sorted(kinds.map((k) => get(offseason.HONOR_ROOM, k, 0)), undefined, true);
  if (pts.length) {
    room += pts[0] + 0.5 * sum(pts.slice(1, 3));
  }
  const names = [...new Set(get(perf, "honors", []).map(([, n]) => n))];
  why = why.concat(names.slice(0, 3));
  const level_up = kinds.some((k) => ["heisman", "national", "all_america_1"].includes(k));
  return [mult, int(round(Math.min(offseason.ROOM_CAP, room))), why, level_up];
}


Object.assign(offseason, {
  seed_key, _rng, _attrs, house, _record, _usage, start, season_facts, _seed_pools, _review, review_decide, _open_portal,
  _broken_promise, _keeps_promise, _retention_entries, _retention_view, _chance_word, stay_chance, _retention_spent, retain,
  _resolve_retention, record_seasons, _performance, growth_terms,
});

// ----- Notes ----------------------------------------------------------------------------------------------------------
// - `offseason.life(p, season_year, kind, extra)` (another part's): `extra` is one object whose keys are written in
//   order; a null value is left out by `life`.
// - Dicts keyed by a player's id or a compound key and only looked up are a Map (`by_id`, `ids`, `starts`); a compound
//   key is its JSON text. `seen` is a Set of the same text; `leaving` is a Set (never walked).
// - `_retention_entries`: a peer is the same row by identity. `_would_start`'s answer may be a Set or an array.
// - `_retention_entries`, `_review`: a template's "{ahead}" and "{round}" would print "None" for a missing value.
// - `_performance`: the "all_america_<level>" key assumes a whole-number level; an honor is a list [kind, name].
// - `growth_terms`: the names come out in a Set's insertion order (each name once, first seen first).
// - `seed_key` / `_rng` / `review_decide`: the seed text is the seed (a whole number or the id), the year and the
//   name: a seed with a fraction would print differently (none is made by the game).
// - `COACH_PERF`'s whole-number keys (2, 0, -1, -2) are an object's text keys: looked up with `get(COACH_PERF, mark, 0.0)`,
//   never walked (an object would list "0" and "2" first).
