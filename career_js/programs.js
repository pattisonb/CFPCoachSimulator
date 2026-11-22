// Program ratings (docs/superpowers/specs/2026-10-26-program-ratings-design.md). This first
// piece is the market: how many people watch a program, from real home crowds (CFBD, 2023-2025)
// and TV audiences (Nielsen's published per-team averages, estimated from the crowd where none is
// published), kept in data/program_market.json.
//
// Every constant, variable and function is on the `programs` namespace and is reached through it, here too. The
// module's own `get` (a program's metrics) is
// `programs.get`; the `get` used bare in this file is pyrt.js's dict.get.
import { round, int, sum, sorted, get, truthy, range } from "../engine_js/pyrt.js";
import { read_text, exists } from "../engine_js/files.js";
import { modules } from "../engine_js/modules.js";
import { pypow } from "./recruits.js";

export const programs = {};

const is_dict = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
/** x ** y as Python's: exact for a whole-number power (recruits.js pypow), the engine's own Math.pow otherwise. */
const power = (x, y) => (Number.isInteger(y) && y >= 0 && y <= 64 ? pypow(x, y) : Math.pow(x, y));

programs.MARKET = "data/program_market.json";
programs.HISTORY = "data/program_history.json";
programs.WEIGHTS = { prestige: 0.30, winning: 0.15, nil: 0.15, market: 0.10, conference: 0.10, coach: 0.10, pro: 0.10 };
programs.TIERS = [[76, 1], [65, 2], [50, 3], [35, 4]];         // rating floors; below the last is tier 5
programs.WORD_FLOORS = [["Elite", 90], ["Excellent", 80], ["Strong", 70], ["Good", 60], ["Solid", 50], ["Fair", 40], ["Thin", 30], ["Weak", 0]];   // a metric's grade words, by floor *tune*
programs.PRO_GROUP_ORDER = ["QB", "RB", "WR", "TE", "OT", "IOL", "EDGE", "DL", "LB", "CB", "S", "K", "P"];   // offseason.DRAFT_GROUP's groups, in its order
programs.TIER_NAMES = { 1: "Blue Blood", 2: "Power", 3: "Solid", 4: "Modest", 5: "Bottom" };   // a standing, never a conference label: a Group of 6 program can be Solid or better
programs.BASE_DEFAULT = { history: 15.0, prestige: 15.0, winning: 20.0, market: 25, nil: 15.0, conference: 10.0, coach: 55.0, pro: 0 };
programs.RANK_BONUS = [[1, 0.8], [5, 0.5], [10, 0.35], [25, 0.35]];     // a season's score: win share plus these (cumulative), max 3.0
programs.PRESTIGE_STEP = 3.0;              // prestige moves at most this much a year toward its target *tune*
programs.PRESTIGE_HISTORY = 0.7;           // the target: history's share (the rest a ten-season mean of winning)
programs.WINNING_WEIGHTS = [3, 2, 1];      // the last three seasons
programs.MARKET_STEP = 3.0;                // the market's live part moves at most this much a year
programs.MARKET_LIVE = 0.3;                // the live part's target: this much of (winning - 40); a decade of 100-winning +18
programs.MARKET_FULL = 85;                 // a base market this big has a full building: the crowd side is capped
programs.MARKET_CAP_FULL = 8.0;
programs.MARKET_CAP = 18.0;
programs.NEW_COACH_LIFT = 1.5;             // a new head coach's first year
programs.NIL_UP = 4.0;                     // the AD's biggest move a year: up after a year that met the goal, down after a losing year
programs.NIL_DOWN = 3.0;
programs.NIL_TARGET = { prestige: 0.55, winning: 0.30, market: 0.15 };   // the collective follows these from where the program started
programs.NIL_PUSH = 6.0;                   // the AD's push above (goal met) or below (losing year) that target
programs.NIL_PLAYOFF_PUSH = 12.0;          // *tune* a playoff the AD did not ask for (his goal is not the playoff) pushes the target this much further
programs.NIL_PLAYOFF_UP = 10.0;            // *tune* ... and the collective may rise this much that year: the boosters open their wallets
programs.NIL_FLOOR_TIER = 10.0;
programs.COACH_TENURE = 3.0;               // coach appeal: overall + this a year of tenure (up to five) - 5
programs.COACH_TIER_MEAN = { 1: 77, 2: 65, 3: 60, 4: 48, 5: 40 };   // real 2026 head coaches' overall by tier: what a program of that tier can hire
programs.COACH_LEAGUE_MEAN = 52;           // the real 2026 head coaches' mean overall
programs.GOALS = { 1: ["playoff", 10, "Make the College Football Playoff"], 2: ["wins", 9, "Win Nine Games"],
  3: ["wins", 8, "Win Eight Games"], 4: ["wins", 7, "Win Seven Games and Go Bowling"], 5: ["wins", 6, "Reach a Bowl Game"] };
programs.G5_TITLE_FROM = 42.0;             // a Group of 5 program rated this high expects to win its conference
programs.INDEPENDENT_GOAL = ["wins", 10, "Win Ten Games"];   // the same program with no conference to win (UConn): ten wins instead *tune*
programs.INDEPENDENTS = new Set(["FBS Independents", "FBS Independent", "Independent", "Independents"]);
programs.MARKET_DEFAULT = 25;              // a program without three seasons of FBS crowds (new to FBS)
programs.P4 = new Set(["SEC", "Big Ten", "Big 12", "ACC"]);
programs.PRO_ROUND_POINTS = { 1: 4, 2: 3, 3: 2 };   // a pick's points by round; every later round is 1 *tune*
programs.PRO_RECENT_YEARS = 5;             // the newest drafts that count extra *tune*
programs.PRO_RECENT_WEIGHT = 2.0;          // a recent draft's weight against an older one's 1 *tune*
programs.PRO_YEARS = 10;                   // drafts kept per program *tune*
programs._cache = {};


export function _market() {
  if (!("teams" in programs._cache)) {
    programs._cache["teams"] = exists(programs.MARKET) ? JSON.parse(read_text(programs.MARKET))["teams"] : {};
  }
  return programs._cache["teams"];
}


export function market(slug) {
  // The program's market, 0-100 (60% crowd, 40% TV).
  return int(Number(get(get(programs._market(), slug, {}), "market", programs.MARKET_DEFAULT)));
}


export function market_row(slug) {
  // The market with its parts: attendance, games counted, TV millions and whether published.
  const row = get(programs._market(), slug);
  if (!truthy(row)) return { attendance: null, attendance_games: 0, tv_millions: null, tv_known: false, market: programs.MARKET_DEFAULT };
  return { ...row };
}


export function mix(p) {
  // The rating: the weighted mix of the seven metrics.
  return sum(Object.entries(programs.WEIGHTS).map(([k, w]) => w * Number(get(p, k, 0))));
}


export function tier_of(rating) {
  for (const [floor, t] of programs.TIERS) {
    if (rating >= floor) return t;
  }
  return 5;
}


export function _history() {
  if (!("history" in programs._cache)) {
    programs._cache["history"] = exists(programs.HISTORY) ? JSON.parse(read_text(programs.HISTORY)) : { teams: {}, z_fit: { a: -3.0, b: 0.05 } };
  }
  return programs._cache["history"];
}


export function empty_drafts(year_before) {
  // Ten draft lines with no picks, the newest being `year_before`'s.
  return range(year_before - programs.PRO_YEARS + 1, year_before + 1).map((y) => [y, 0, {}]);
}


export function base(slug) {
  // A program's starting values (data/program_history.json), a new FBS program's floor when unknown.
  let p = get(programs._history()["teams"], slug);
  if (truthy(p)) return { ...p };
  p = { ...programs.BASE_DEFAULT, market: programs.market(slug), pro_groups: {}, drafts: programs.empty_drafts(2025) };
  p["rating"] = round(programs.mix(p), 1);
  p["tier"] = programs.tier_of(p["rating"]);
  return p;
}


export function z_of(rating) {
  // The rating on the recruiting baseline's scale (about -2 to +2), for the readers that grew up on it.
  const f = programs._history()["z_fit"];
  return f["a"] + f["b"] * Number(rating);
}


export function scaled(v, sc) {
  const share = sc["hi"] > sc["lo"] ? Math.max(0.0, Math.min(1.0, (v - sc["lo"]) / (sc["hi"] - sc["lo"]))) : 0.0;
  return 100 * power(share, get(sc, "k", 1.0));
}


export function pick_points(round_) {
  // What a draft pick is worth by its round.
  return get(programs.PRO_ROUND_POINTS, round_, 1);
}


export function draft_line(year, picks) {
  // One draft's line for a program: [year, points, {position group: points}] from (round, group) pairs.
  const groups = {};
  for (const [r, g] of picks) groups[g] = get(groups, g, 0) + programs.pick_points(r);
  return [year, sum(Object.values(groups)), groups];
}


// -> [[weight, points, groups], ...] (nothing is drawn or changed while it runs)
export function _pro_lines(lines, year_now) {
  return lines.slice(-programs.PRO_YEARS).map(([y, pts, groups]) =>
    [y > year_now - programs.PRO_RECENT_YEARS ? programs.PRO_RECENT_WEIGHT : 1.0, pts, groups]);
}


export function pro_score(lines, year_now) {
  // The raw Pro Pipeline score: the last ten drafts' points, the newest five counting double.
  return sum(programs._pro_lines(lines, year_now).map(([w, pts]) => w * pts));
}


export function pro_group_scores(lines, year_now) {
  // The raw score per position group, the same weights.
  const out = {};
  for (const [w, , groups] of programs._pro_lines(lines, year_now)) {
    for (const [g, pts] of Object.entries(groups)) out[g] = get(out, g, 0) + w * pts;
  }
  return out;
}


export function pro_recompute(p, year_now) {
  // Set a program's pro and pro_groups (0-100) from its draft lines on the fixed scales.
  const sc = get(programs._history(), "scales", {});
  const lines = get(p, "drafts") || [];
  p["pro"] = lines.length && has(sc, "pro") ? programs.scaled(programs.pro_score(lines, year_now), sc["pro"]) : 0;
  const gs = get(sc, "pro_group", {});
  const groups = {};
  for (const [g, v] of Object.entries(programs.pro_group_scores(lines, year_now))) groups[g] = has(gs, g) ? programs.scaled(v, gs[g]) : 0;
  p["pro_groups"] = groups;
}


programs.GROUP_DRAFT = { QB: ["QB"], RB: ["RB"], WR: ["WR"], TE: ["TE"], OL: ["OT", "IOL"], DL: ["EDGE", "DL"],
  LB: ["LB"], CB: ["CB"], S: ["S"] };   // roster group -> the draft groups it reads (K and P read the overall grade; an athlete carries an engine position, so he reads that position's group)


export function pro_group_grade(p, group) {
  // A program's Pro Pipeline grade at a roster group (the mean of its draft groups; any other group, the overall grade).
  const keys = has(programs.GROUP_DRAFT, group) ? programs.GROUP_DRAFT[group] : null;
  if (!truthy(keys)) return get(p, "pro", 0);
  const pg = get(p, "pro_groups") || {};
  return sum(keys.map((k) => get(pg, k, 0))) / keys.length;
}


export function season_score(wins, games, rank = null) {
  // A season's score: win share plus the AP finish (top 25 and top 10 0.35 each, top 5 0.5, number one 0.8).
  let s = truthy(games) ? wins / games : 0.0;
  if (truthy(rank)) s += sum(programs.RANK_BONUS.filter(([top]) => rank <= top).map(([, b]) => b));
  return s;
}


export function init(lgd) {
  // Every team in a league carries its program (from the base values) the first time it is asked.
  for (const [slug, t] of Object.entries(lgd["teams"])) {
    if ("program" in t && !("drafts" in t["program"])) programs.upgrade(t["program"], slug);
    if (!("program" in t)) {
      const p = programs.base(slug);
      if (!("pro_groups" in p)) p["pro_groups"] = {};
      p["drafts"] = truthy(get(p, "drafts")) ? p["drafts"].map(([y, pts, g]) => [y, pts, { ...g }]) : programs.empty_drafts(get(lgd, "year", 2026) - 1);
      t["program"] = { ...p, market_base: p["market"], nil_base: p["nil"], winning_base: p["winning"], conference_base: p["conference"],
        live: 0.0, seasons: [], year: get(lgd, "year", 2026) - 1 };
    }
  }
}


export function upgrade(p, slug) {
  // A program from a save made before the Pro Pipeline: it takes the base's ten draft lines, pro and
  // pro_groups (copies), so the real decade is not lost, and its rating and tier follow.
  const b = programs.base(slug);
  p["drafts"] = b["drafts"].map(([y, pts, g]) => [y, pts, { ...g }]);
  p["pro"] = b["pro"];
  p["pro_groups"] = { ...(get(b, "pro_groups") || {}) };
  p["rating"] = round(programs.mix(p), 1);
  p["tier"] = programs.tier_of(p["rating"]);
}


// (`programs.get`: named apart here from pyrt.js's `get`)
export function program_get(state, slug) {
  // The program's metrics: from the career's league when it exists, else the base values.
  const lgd = is_dict(state) ? get(state, "league") : null;
  const t = get(get(lgd || {}, "teams", {}), slug);
  if (truthy(t)) {
    if (!("program" in t) || !("drafts" in t["program"])) programs.init(lgd);
    return t["program"];
  }
  return programs.base(slug);
}


export function z(state, slug) {
  return programs.z_of(programs.get(state, slug)["rating"]);
}


export function goal_for(tier, p4, rating = null, independent = false) {
  // What the AD expects of a program of this tier (a strong Group of 5 program: its conference; an independent one has
  // none to win, so ten wins).
  if (!truthy(p4) && (rating !== null ? rating : tier <= 3 ? 100 : 0) >= programs.G5_TITLE_FROM) {
    if (truthy(independent)) {
      const [kind, wins, text] = programs.INDEPENDENT_GOAL;
      return { kind: kind, wins: wins, text: text };
    }
    return { kind: "conference", wins: 10, text: "Win the Conference" };
  }
  const [kind, wins, text] = programs.GOALS[tier];
  return { kind: kind, wins: wins, text: text };
}


export function final_ranks(state) {
  // The season's final AP ranks (the last poll with an AP top 25).
  const polls = get(state, "polls") || {};
  const weeks = sorted(Object.entries(polls).filter(([, v]) => truthy(get(v, "ap"))).map(([w]) => int(Number(w))), (w) => w, true);
  if (!weeks.length) return {};
  const out = {};
  for (const e of polls[String(weeks[0])]["ap"]) out[e["team"]] = e["rank"];
  return out;
}


export function draft_picks(state) {
  // This offseason's draft by school: team slug -> [(round, position group)] from the departure
  // events that were drafted; a position with no draft group is skipped.
  const offseason = modules.offseason;
  const out = {};
  for (const ev of (get(get(state, "offseason") || {}, "departures") || [])) {
    if (get(ev, "kind") !== "draft") continue;
    const g = get(offseason.DRAFT_GROUP, get(ev, "pos"));
    if (truthy(g)) {
      if (!(ev["team"] in out)) out[ev["team"]] = [];
      out[ev["team"]].push([get(ev, "round", 7), g]);
    }
  }
  return out;
}

// `s not in only`, whatever `only` is (a set, a list or a dict of slugs)
const holds = (only, s) => (only instanceof Set || only instanceof Map ? only.has(s) : Array.isArray(only) ? only.includes(s) : has(only, s));

export function update(state, results, ranks, year = null, only = null) {
  // The offseason's move of every program's metrics (once a year): the season joins the last
  // ten, winning is the last three (3-2-1), prestige and the market's live part step toward their
  // targets, conference strength and the coach's appeal are read again, the rating and tier follow.
  // NIL moves separately by the AD's hand (nil_move).
  const season = modules.season;
  const lgd = state["league"];
  programs.init(lgd);
  year = year || get(get(state, "offseason") || {}, "year") || get(lgd, "year", 2026);
  const sc = get(programs._history(), "scales") || {};
  const wsc = get(sc, "winning") || { lo: 0.0, hi: 3.0, k: 1.0 };
  const csc = get(sc, "conference") || { lo: 40.0, hi: 70.0, k: 1.0 };
  const teams = season.load_teams();
  const picks = programs.draft_picks(state);
  const conf_members = {};
  for (const s of Object.keys(lgd["teams"])) {
    const bt = get(teams, s);
    if (truthy(bt)) {
      if (!(bt["conference"] in conf_members)) conf_members[bt["conference"]] = [];
      conf_members[bt["conference"]].push(bt["team_ratings"]["overall"]);
    }
  }
  let conf_score = {};
  for (const [c, v] of Object.entries(conf_members)) conf_score[c] = programs.scaled(sum(v) / v.length, csc);
  const conf_start = {};                                                     // the start is the fixed point: a league that plays like 2026 keeps its score
  for (const [s, t] of Object.entries(lgd["teams"])) {
    const bt = get(teams, s);
    if (truthy(bt) && "conference_base" in t["program"]) {
      if (!(bt["conference"] in conf_start)) conf_start[bt["conference"]] = [];
      conf_start[bt["conference"]].push(t["program"]["conference_base"]);
    }
  }
  if (!("conference_start" in lgd)) {
    lgd["conference_start"] = {};
    for (const [c, v] of Object.entries(conf_score)) lgd["conference_start"][c] = round(v, 2);
  }
  const moved = {};
  for (const [c, v] of Object.entries(conf_score)) {
    moved[c] = (truthy(get(conf_start, c)) ? sum(conf_start[c]) / conf_start[c].length : v) + (v - get(lgd["conference_start"], c, v)) * 0.5;
  }
  conf_score = moved;
  for (const [s, t] of Object.entries(lgd["teams"])) {
    if (truthy(only) && !holds(only, s)) continue;
    const p = t["program"];
    if (get(p, "year") === year) continue;
    const r = get(results, s) || { wins: 0, losses: 12 };
    const games = r["wins"] + r["losses"];
    const value = programs.scaled(programs.season_score(r["wins"], games, get(ranks, s)), wsc);
    p["seasons"] = (get(p, "seasons") || []).slice(-9).concat([[year - 1, round(value, 1)]]);
    const recent = p["seasons"].slice(-3).map(([, v]) => v).reverse();                     // latest first
    const ws = programs.WINNING_WEIGHTS.slice(0, recent.length);
    p["winning"] = round(sum(ws.map((w, i) => w * recent[i])) / sum(ws), 1);
    const ten = p["seasons"].map(([, v]) => v);
    const wb = get(p, "winning_base", 40.0);                                    // the start is the fixed point: results like the real ones move nothing
    const target = p["history"] + (1 - programs.PRESTIGE_HISTORY) * (sum(ten) / ten.length - wb);
    p["prestige"] = round(Math.max(0.0, Math.min(100.0, p["prestige"] + Math.max(-programs.PRESTIGE_STEP, Math.min(programs.PRESTIGE_STEP, target - p["prestige"])))), 1);
    const cap = p["market_base"] >= programs.MARKET_FULL ? programs.MARKET_CAP_FULL : programs.MARKET_CAP;
    const live_target = Math.max(-cap, Math.min(cap, programs.MARKET_LIVE * (p["winning"] - wb)));
    let live = get(p, "live", 0.0) + Math.max(-programs.MARKET_STEP, Math.min(programs.MARKET_STEP, live_target - get(p, "live", 0.0)));
    const hc = get(get(t, "coaches") || {}, "head_coach") || {};
    if (get(hc, "since") === year) live += programs.NEW_COACH_LIFT;
    p["live"] = round(Math.max(-cap, Math.min(cap, live)), 1);
    p["market"] = int(round(Math.max(0, Math.min(100, p["market_base"] + p["live"]))));
    const tenure = Math.max(0, year - (get(hc, "since") || year));
    p["coach"] = round(Math.max(0.0, Math.min(100.0, get(get(hc, "ratings") || {}, "overall", 60) + programs.COACH_TENURE * Math.min(5, tenure) - 5)), 1);
    const bt = get(teams, s);
    if (truthy(bt) && has(conf_score, bt["conference"])) p["conference"] = round(conf_score[bt["conference"]], 1);
    if (!("drafts" in p)) p["drafts"] = programs.empty_drafts(year - 2);
    const churn = (get(get(state, "offseason") || {}, "departures") || []).filter((d) => get(d, "team") === s && get(d, "kind") === "portal").length;
    programs._move_grades(p, s, year, get(ranks, s), get(hc, "since"), churn);     // School Grades Phase 3: the moving grades
    p["drafts"] = p["drafts"].concat([programs.draft_line(year - 1, get(picks, s, []))]).slice(-programs.PRO_YEARS);    // a new list: a probe's copy never writes back
    programs.pro_recompute(p, year - 1);
    p["rating"] = round(programs.mix(p), 1);
    p["tier"] = programs.tier_of(p["rating"]);
    p["year"] = year;
  }
}


export function nil_move(team, met, losing, playoff = false) {
  // The collective settles where the program's prestige, winning and market put it; the AD
  // pushes it above that after a year that met his goal and it sinks below after a losing year,
  // at most NIL_UP up or NIL_DOWN down a year. `playoff`: the program made a playoff its AD did not
  // ask for: the target is NIL_PLAYOFF_PUSH higher and the year's rise may reach NIL_PLAYOFF_UP.
  const p = team["program"];
  const bases = { prestige: p["history"], winning: get(p, "winning_base", 40.0), market: get(p, "market_base", p["market"]) };
  const target = get(p, "nil_base", p["nil"]) + sum(Object.entries(programs.NIL_TARGET).map(([k, w]) => w * (Number(p[k]) - bases[k])))
    + (truthy(met) ? programs.NIL_PUSH : truthy(losing) ? -programs.NIL_PUSH : 0.0) + (truthy(playoff) ? programs.NIL_PLAYOFF_PUSH : 0.0);
  const step = Math.max(-programs.NIL_DOWN, Math.min(truthy(playoff) ? programs.NIL_PLAYOFF_UP : programs.NIL_UP, target - p["nil"]));
  p["nil"] = round(Math.max(programs.NIL_FLOOR_TIER, Math.min(100.0, p["nil"] + step)), 1);
  p["rating"] = round(programs.mix(p), 1);
  p["tier"] = programs.tier_of(p["rating"]);
}


// ----- School Grades, Phase 1 (docs/superpowers/specs/2026-11-10-school-grades-expansion-design.md): six grades graded
// on read from data/program_profile.json. Fixed in Phase 1, so nothing goes into a
// save; the rating, tiers and market do not read them.

programs.PROFILE = "data/program_profile.json";
programs.ACADEMICS_W = [0.60, 0.25, 0.15];          // *tune* Academics: U.S. News rank, football GSR, football APR
programs.RANK_ZERO = 400;                           // *tune* the U.S. News rank that scores 0 (log; rank 1 scores 100)
programs.RANK_CURVE = 2.0;                          // *tune* how the log rank bends: 1 is the plan's straight log; 2 keeps the top 10 Elite
programs.UNRANKED = 25.0;                           // *tune* an unranked school's rank score
programs.ACADEMY_RANK = 85.0;                       // *tune* a service academy's rank score (ranked among the top liberal arts colleges)
programs.ACADEMIES = ["army", "navy", "air-force"];
programs.GSR_SCALE = [60, 100];                     // *tune* GSR scoring 0 and 100
programs.APR_SCALE = [930, 1000];                   // *tune* APR scoring 0 and 100
programs.FACILITIES_W = [0.35, 0.40, 0.25];         // *tune* Facilities: stadium, football building, indoor practice
programs.FACILITY_NOW = 2026;                       // *tune* a facility built or renovated this year scores 100 ...
programs.FACILITY_PER_YEAR = 4;                     // *tune* ... minus this a year ...
programs.FACILITY_FLOOR = 10;                       // *tune* ... never under this (and no indoor facility scores this)
programs.LOCATION_W = [0.6, 0.4];                   // *tune* Location: metro size, January warmth
programs.SIZE_SCALE = [[50_000, 20], [5_000_000, 100]];   // *tune* metro population to score (log)
programs.WARMTH_SCALE = [[20, 20], [65, 100]];      // *tune* January average °F to score
programs.COACH_STEP = 15;                           // *tune* Stability: 100 less this for each head coach after the first, never under the floor
programs.COACH_FLOOR = 10;
programs.GAME_DAY_W = [0.6, 0.4];                   // *tune* Game Day: the crowd, how full the stadium is
programs.CROWD_SCALE = [[15_000, 15], [105_000, 100]];   // *tune* the home crowd to score
programs.FILL_SCALE = [[0.5, 20], [1.0, 100]];      // *tune* crowd over capacity to score
programs.EXPOSURE_W = [0.5, 0.5];                   // *tune* Exposure: TV, Instagram
programs.TV_SCALE = [[0.3, 10], [8.0, 100]];        // *tune* TV millions to score (log)
programs.INSTAGRAM_SCALE = [[20_000, 10], [2_000_000, 100]];   // *tune* Instagram followers to score (log)
programs.BIG_CITY = 1_000_000;                      // *tune* the metro a Big City and a Mid-Size City start at
programs.MID_CITY = 500_000;
programs.WARM_AT = 50;                              // *tune* January °F a Warm and a Mild climate start at
programs.MILD_AT = 35;
programs.REGIONS = { South: "AL AR DE FL GA KY LA MD MS NC OK SC TN TX VA WV", Midwest: "IA IL IN KS MI MN MO ND NE OH SD WI",
  West: "AK AZ CA CO HI ID MT NM NV OR UT WA WY", Northeast: "CT MA ME NH NJ NY PA RI VT" };


export function _profile() {
  if (!("profile" in programs._cache)) {
    programs._cache["profile"] = exists(programs.PROFILE) ? JSON.parse(read_text(programs.PROFILE))["teams"] : {};
  }
  return programs._cache["profile"];
}


export function profile_rows() {
  // Every profiled program's facts, by slug.
  const out = {};
  for (const [s, r] of Object.entries(programs._profile())) out[s] = r["facts"];
  return out;
}


// float("...") of the first word of a text: the number, or null when it is not one
const _FLOAT = /^[+-]?(\d+(_\d+)*\.?(\d+(_\d+)*)?|\.\d+(_\d+)*)([eE][+-]?\d+(_\d+)*)?$/;
function _float_text(t) {
  if (_FLOAT.test(t)) return Number(t.replaceAll("_", ""));
  const m = /^([+-]?)(inf|infinity|nan)$/i.exec(t);
  if (!m) return null;
  return m[2].toLowerCase() === "nan" ? NaN : m[1] === "-" ? -Infinity : Infinity;
}

export function _num(v) {
  if (v === null || v === undefined || typeof v === "boolean") return null;
  if (typeof v === "number") return Number.isNaN(v) ? null : v;
  if (typeof v !== "string") return null;       // (the text of a list or a dict never reads as a number)
  const words = v.replaceAll(",", "").split(/\s+/).filter((w) => w !== "");
  if (!words.length) return null;
  return _float_text(words[0]);
}


export function _line(x, scale, log = false) {
  let [[x0, y0], [x1, y1]] = scale;
  if (log) {
    x = Math.log(Math.max(x, 1e-9));
    x0 = Math.log(x0);
    x1 = Math.log(x1);
  }
  return Math.max(0.0, Math.min(100.0, y0 + (y1 - y0) * (x - x0) / (x1 - x0)));
}


export function rank_score(rank, slug = "") {
  const r = programs._num(rank);
  if (r === null) return programs.ACADEMIES.includes(slug) ? programs.ACADEMY_RANK : programs.UNRANKED;
  const share = Math.min(1.0, Math.log(Math.max(1.0, r)) / Math.log(programs.RANK_ZERO));
  return Math.max(0.0, Math.min(100.0, 100.0 * (1 - power(share, programs.RANK_CURVE))));
}


export function recency(year) {
  const y = programs._num(year);
  if (y === null) return programs.FACILITY_FLOOR;
  return Math.max(programs.FACILITY_FLOOR, Math.min(100, 100 - programs.FACILITY_PER_YEAR * (programs.FACILITY_NOW - y)));
}


export function facilities_score(f) {
  const [a, b, c] = programs.FACILITIES_W;
  return a * programs.recency(get(f, "stadium_renovated")) + b * programs.recency(get(f, "football_building_year")) + c * programs.recency(get(f, "indoor_practice"));
}


export function warmth(temp_f) {
  const t = programs._num(temp_f);
  return t !== null ? programs._line(t, programs.WARMTH_SCALE) : 50.0;
}


export function fill_score(crowd, capacity) {
  const c = programs._num(crowd), cap = programs._num(capacity);
  if (c === null || !truthy(cap)) return 50.0;
  return programs._line(Math.min(1.0, c / cap), programs.FILL_SCALE);
}


export function grades(slug) {
  // The six grades (cached: Phase 1's grades are fixed, read from the profile file); None with no profile row.
  if (!has(programs._GRADES, slug)) programs._GRADES[slug] = programs._grades(slug);
  const g = programs._GRADES[slug];
  return g !== null ? { ...g } : null;
}


programs._GRADES = {};


export function _grades(slug) {
  // The six grades, 0-100 (0.1), from the profile; None for a program with no profile row (a fictional or new one).
  const rows_ = programs.profile_rows();
  const f = has(rows_, slug) ? rows_[slug] : null;
  if (f === null) return null;
  const gw = programs.ACADEMICS_W;
  const gsr = programs._num(get(f, "football_gsr")), apr = programs._num(get(f, "football_apr"));
  const academics = gw[0] * programs.rank_score(get(f, "us_news_rank"), slug) + gw[1] * (gsr !== null ? programs._line(gsr, [[programs.GSR_SCALE[0], 0], [programs.GSR_SCALE[1], 100]]) : 50.0)
    + gw[2] * (apr !== null ? programs._line(apr, [[programs.APR_SCALE[0], 0], [programs.APR_SCALE[1], 100]]) : 50.0);
  const metro = programs._num(get(f, "metro_population"));
  const location = programs.LOCATION_W[0] * (truthy(metro) ? programs._line(metro, programs.SIZE_SCALE, true) : 20.0) + programs.LOCATION_W[1] * programs.warmth(get(f, "jan_avg_temp_f"));
  const coaches = programs._num(get(f, "head_coaches_since_2010"));
  const stability = Math.max(programs.COACH_FLOOR, 100 - programs.COACH_STEP * ((coaches || 1) - 1));
  const crowd = programs._num(get(f, "attendance"));
  const game_day = programs.GAME_DAY_W[0] * (truthy(crowd) ? programs._line(crowd, programs.CROWD_SCALE) : 15.0) + programs.GAME_DAY_W[1] * programs.fill_score(crowd, get(f, "stadium_capacity"));
  const tv = programs._num(get(f, "tv_millions")), ig = programs._num(get(f, "instagram_followers"));
  const exposure = programs.EXPOSURE_W[0] * (truthy(tv) ? programs._line(tv, programs.TV_SCALE, true) : 10.0) + programs.EXPOSURE_W[1] * (truthy(ig) ? programs._line(ig, programs.INSTAGRAM_SCALE, true) : 10.0);
  const out = { academics: academics, facilities: programs.facilities_score(f), location: location, stability: stability,
    game_day: game_day, exposure: exposure };
  for (const [k, v] of Object.entries(out)) out[k] = round(Math.max(0.0, Math.min(100.0, v)), 1);
  return out;
}


// ----- School Grades, Phase 3: four grades move each offseason, each held to its floor (spec "Decided" 6) -----------------
programs.GAME_DAY_LIVE = 0.8;           // *tune* Game Day's live target: this much of (winning - winning_base) ...
programs.GAME_DAY_STEP = 4.0;           // *tune* ... moving at most this much a year
programs.GAME_DAY_FLOOR = 0.70;         // Game Day never under this share of its researched value
programs.EXPOSURE_LIVE = 0.7;           // *tune* Exposure's live target: this much of (winning - winning_base) ...
programs.EXPOSURE_STEP = 4.0;           // *tune* ... at most this much a year ...
programs.EXPOSURE_RANKED = [[10, 4.0], [25, 2.0]];   // *tune* ... plus this for a final rank this good that year
programs.EXPOSURE_FLOOR = 0.75;         // Exposure never under this share of its researched value
programs.STABILITY_CHANGE = 15.0;       // *tune* a new head coach this year costs this ...
programs.STABILITY_REBUILD = 5.0;       // *tune* ... and each year he stays rebuilds this, up to the researched value
programs.STABILITY_FLOOR = 10.0;        // Stability never under this
programs.ACADEMICS_STEP = 1.0;          // *tune* churn above or below CHURN_MEAN moves Academics this much a year ...
programs.ACADEMICS_BAND = 10.0;         // ... never more than this from its researched value
programs.CHURN_MEAN = 6;                // *tune* the portal entrants a program loses in a typical offseason
programs.MOVING = ["game_day", "exposure", "stability", "academics"];


export function _held(base_, gl) {
  // The base grades plus their live parts, each held to its floor (and 100).
  const out = { ...base_ };
  const gd = base_["game_day"] + get(gl, "game_day", 0.0), ex = base_["exposure"] + get(gl, "exposure", 0.0);
  out["game_day"] = Math.min(100.0, Math.max(base_["game_day"] * programs.GAME_DAY_FLOOR, gd));
  out["exposure"] = Math.min(100.0, Math.max(base_["exposure"] * programs.EXPOSURE_FLOOR, ex));
  out["stability"] = Math.min(base_["stability"], Math.max(programs.STABILITY_FLOOR, base_["stability"] + get(gl, "stability", 0.0)));
  out["academics"] = Math.max(0.0, Math.min(100.0, base_["academics"] + Math.max(-programs.ACADEMICS_BAND, Math.min(programs.ACADEMICS_BAND, get(gl, "academics", 0.0)))));
  for (const [k, v] of Object.entries(out)) out[k] = round(v, 1);
  return out;
}


export function grades_now(state, slug) {
  // The grades as they stand in this career: the researched base (grades) plus each moving grade's live part
  // (program["grades_live"], from programs.update), held to its floor. No league, or an old save: the base. Read only.
  const base_ = programs.grades(slug);
  if (base_ === null) return null;
  const lgd = is_dict(state) ? get(state, "league") : null;
  const prog = get(get(get(lgd || {}, "teams") || {}, slug) || {}, "program") || {};
  return programs._held(base_, get(prog, "grades_live") || {});
}


export function _step(cur, target, step) {
  return cur + Math.max(-step, Math.min(step, target - cur));
}


export function _move_grades(p, slug, year, rank, coach_since, churn) {
  // One offseason's move of a program's live grades (p["grades_live"]); p["grades_moved"] keeps each grade's change.
  const base_ = programs.grades(slug);
  if (base_ === null) return;
  const gl = p["grades_live"] = { ...(get(p, "grades_live") || {}) };     // a new dict: a probe's shallow copy never writes back (as drafts)
  const before = programs._held(base_, gl);
  const lead = get(p, "winning", 40.0) - get(p, "winning_base", 40.0);
  gl["game_day"] = programs._step(get(gl, "game_day", 0.0), programs.GAME_DAY_LIVE * lead, programs.GAME_DAY_STEP);
  const ranked = programs.EXPOSURE_RANKED.find(([top]) => truthy(rank) && rank <= top);
  const bonus = ranked ? ranked[1] : 0.0;
  gl["exposure"] = programs._step(get(gl, "exposure", 0.0), programs.EXPOSURE_LIVE * lead + bonus, programs.EXPOSURE_STEP);
  if (coach_since === year - 1) {          // update runs at the carousel, before this offseason's hires: last offseason's hire is this year's change
    gl["stability"] = get(gl, "stability", 0.0) - programs.STABILITY_CHANGE;
  } else {
    gl["stability"] = Math.min(0.0, get(gl, "stability", 0.0) + programs.STABILITY_REBUILD);
  }
  if (churn !== programs.CHURN_MEAN) {
    gl["academics"] = get(gl, "academics", 0.0) + (churn < programs.CHURN_MEAN ? programs.ACADEMICS_STEP : -programs.ACADEMICS_STEP);
  }
  // a live part never runs past what its floor or cap holds (so a floor reached is left by the first good year)
  gl["game_day"] = Math.max(base_["game_day"] * (programs.GAME_DAY_FLOOR - 1), Math.min(100 - base_["game_day"], gl["game_day"]));
  gl["exposure"] = Math.max(base_["exposure"] * (programs.EXPOSURE_FLOOR - 1), Math.min(100 - base_["exposure"], gl["exposure"]));
  gl["stability"] = Math.max(programs.STABILITY_FLOOR - base_["stability"], gl["stability"]);
  gl["academics"] = Math.max(-programs.ACADEMICS_BAND, Math.min(programs.ACADEMICS_BAND, get(gl, "academics", 0.0)));
  for (const k of programs.MOVING) gl[k] = round(get(gl, k, 0.0), 2);
  const after = programs._held(base_, gl);
  p["grades_moved"] = {};
  for (const k of programs.MOVING) p["grades_moved"][k] = round(after[k] - before[k], 1);
}


export function tags(slug) {
  // Location's tags (cached, like grades).
  if (!has(programs._TAGS, slug)) programs._TAGS[slug] = programs._tags(slug);
  const t = programs._TAGS[slug];
  return t !== null ? { ...t } : null;
}


programs._TAGS = {};


export function _tags(slug) {
  // Location's tags: the setting (Big City, Mid-Size City, College Town, Small Town), the climate (Warm, Mild, Cold) and
  // the region (South, Midwest, West, Northeast); None for a program with no profile row.
  const rows_ = programs.profile_rows();
  const f = has(rows_, slug) ? rows_[slug] : null;
  if (f === null) return null;
  const metro = programs._num(get(f, "metro_population")) || 0, temp = programs._num(get(f, "jan_avg_temp_f")), said = get(f, "setting");
  let setting;
  if (metro >= programs.BIG_CITY) {
    setting = "Big City";
  } else if (metro >= programs.MID_CITY && said !== "College Town") {
    setting = "Mid-Size City";
  } else {
    setting = said === "College Town" || said === "Small Town" ? said : "Small Town";
  }
  const climate = temp === null ? null : temp >= programs.WARM_AT ? "Warm" : temp >= programs.MILD_AT ? "Mild" : "Cold";
  const found = Object.entries(programs.REGIONS).find(([, states]) => states.split(/\s+/).includes(get(f, "state") || ""));
  const region = found ? found[0] : null;
  return { setting: setting, climate: climate, region: region };
}


export function word_of(v) {
  // The grade word for a 0-100 metric.
  const found = programs.WORD_FLOORS.find(([, f]) => v >= f);
  if (!found) throw new Error("StopIteration");      // (a value under every floor)
  return found[0];
}


export function rows(state) {
  // Every program for the page, by rating: the metrics, the tier and the AD's goal.
  const season = modules.season;
  const teams = season.load_teams();
  const out = [];
  for (const [s, bt] of Object.entries(teams)) {
    if (truthy(get(bt, "fictional"))) continue;
    const p = programs.get(state, s);
    const p4 = season._is_p4(s, bt);
    const row = { team: s, name: bt["name"], conference: bt["conference"], tier: p["tier"], tier_name: programs.TIER_NAMES[p["tier"]],
      rating: p["rating"], goal: programs.goal_for(p["tier"], p4, p["rating"], programs.INDEPENDENTS.has(get(bt, "conference")))["text"] };
    for (const k of ["prestige", "winning", "nil", "market", "conference", "coach", "history", "pro", "pro_groups"]) row[k] = p[k];
    Object.assign(row, { grades: programs.grades_now(state, s), tags: programs.tags(s), grades_moved: truthy(get(p, "grades_moved")) ? p["grades_moved"] : null });
    out.push(row);
  }
  out.sort((a, b) => (-a["rating"]) - (-b["rating"]));
  out.forEach((r, i) => { r["rank"] = i + 1; });
  return out;
}


export function attract(state, slug) {
  // How attractive the job is to a coach: the rating, a little more where the AD is patient.
  const p = programs.get(state, slug);
  const t = get(get(get(state, "league") || {}, "teams") || {}, slug) || {};
  const patience = get(get(t, "ad") || {}, "patience") || 3;
  return p["rating"] + (patience >= 4 ? 5 : 0);
}


export function coach_level(state, slug) {
  // How far above or below the league's mean a coach this program can hire sits (the tier's real mean).
  return programs.COACH_TIER_MEAN[programs.get(state, slug)["tier"]] - programs.COACH_LEAGUE_MEAN;
}


export function coach_ceiling(state, slug) {
  // A coach rated this far above the program's tier is not interested in the job.
  return programs.COACH_TIER_MEAN[programs.get(state, slug)["tier"]] + 12;
}

Object.assign(programs, {
  _market, market, market_row, mix, tier_of, _history, empty_drafts, base, z_of, scaled, pick_points, draft_line,
  _pro_lines, pro_score, pro_group_scores, pro_recompute, pro_group_grade, season_score, init, upgrade,
  get: program_get, z, goal_for, final_ranks, draft_picks, update, nil_move,
  _profile, profile_rows, _num, _line, rank_score, recency, facilities_score, warmth, fill_score, grades, _grades,
  _held, grades_now, _step, _move_grades, tags, _tags, word_of, rows, attract, coach_level, coach_ceiling,
});

modules.programs = programs;
