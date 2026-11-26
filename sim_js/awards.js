// Season awards: the Heisman vote, the national player and coach awards, All-America teams,
// and every conference's awards and all-conference teams.
//
// The research behind the choices is docs/AWARDS_RESEARCH.md. Every award is scored from the
// season-long stats the engine keeps (state["season_stats"]), the records and polls in the
// season state, and the rosters (class, depth-chart role, ratings). Scores are standardized
// within the eligible position pool so a 1,700-yard back and a 45-touchdown quarterback can
// be compared, and a team term is added where the real award rewards team success.
//
// The same scoring powers the live "race" shown during the season and the final results.
// Calendar: conference awards after championship week (14), the Heisman and the national
// awards in selection week (16), the postseason awards after the title game (20).
import { Random, round, sum, cmp, sorted, get, truthy, fmt, floordiv, mod, range } from "../engine_js/pyrt.js";
import { fmean, pstdev } from "../engine_js/pystat.js";
import { modules } from "../engine_js/modules.js";

// ----- constants ---------------------------------------------------------------

const G5 = new Set(["American Athletic Conference", "Conference USA", "MAC", "Mountain West", "Pac-12", "Sun Belt"]);
const FRESHMAN = new Set(["FR", "FRRS"]);
const UPPERCLASS = new Set(["JR", "JRRS", "SR", "SRRS"]);
const EDGE_ROLES = new Set(["LEDG", "REDG"]);
const LB_POSITIONS = new Set(["MLB", "ROLB", "LOLB", "OLB"]);
const DB_POSITIONS = new Set(["CB", "S"]);

// Heisman regions by the school's state (870 media voters, 145 per region).
const REGIONS = {
  "Far West": new Set(["WA", "OR", "CA", "NV", "AZ", "UT", "ID", "MT", "WY", "CO", "AK", "HI", "NM"]),
  "Southwest": new Set(["TX", "OK", "AR", "LA"]),
  "Midwest": new Set(["OH", "MI", "IN", "IL", "WI", "MN", "IA", "MO", "KS", "NE", "ND", "SD"]),
  "South": new Set(["FL", "GA", "AL", "MS", "TN", "KY", "SC", "NC", "VA", "WV"]),
  "Mid-Atlantic": new Set(["PA", "NJ", "DE", "MD", "DC"]),
  "Northeast": new Set(["NY", "CT", "MA", "RI", "VT", "NH", "ME"]),
};

// How far each position's standardized production carries in a cross-position vote
// (nine of twelve Heisman winners were quarterbacks; no pure defender has won).
const POSITION_PRIOR = { QB: 1.0, RB: 0.52, WR: 0.6, TE: 0.38, EDGE: 0.42, DT: 0.32, LB: 0.36, DB: 0.34,
  OL: 0.2, K: 0.08, P: 0.05, RS: 0.25 };

// Starters per team by score group: the cross-position awards standardize each player
// against the league's starters at his position (138 QBs, 276 backs, ...), so "how far above
// the other starters" is what carries across positions.
const STARTERS_PER_TEAM = { QB: 1, RB: 2, WR: 3, TE: 1, EDGE: 2, DT: 2, LB: 3, DB: 4, OL: 5, K: 1, P: 1, RS: 1 };

// The five All-America selectors the NCAA counts toward consensus: (team weight, noise sd).
const SELECTORS = { AP: [0.25, 0.5], AFCA: [0.55, 0.55], FWAA: [0.1, 0.45], TSN: [0.3, 0.65], WCFF: [0.45, 0.55] };
const AA_SLOTS = [["QB", 1], ["RB", 2], ["WR", 3], ["TE", 1], ["C", 1], ["OL", 4], ["EDGE", 2], ["DT", 2], ["LB", 3],
  ["CB", 2], ["S", 2], ["K", 1], ["P", 1], ["RS", 1]];

// All-conference layouts (docs/AWARDS_RESEARCH.md Part 1C): selectors, number of teams, slots.
const CONF_LAYOUTS = {
  "SEC": [["Coaches", "AP"], 2, [["QB", 1], ["RB", 2], ["WR", 2], ["TE", 1], ["C", 1], ["OL", 4], ["EDGE", 2], ["DT", 2], ["LB", 3], ["DB", 4], ["K", 1], ["P", 1], ["RS", 1]]],
  "Big Ten": [["Coaches", "Media"], 3, [["QB", 1], ["RB", 2], ["WR", 2], ["TE", 1], ["C", 1], ["G", 2], ["T", 2], ["DL", 4], ["LB", 4], ["DB", 4], ["K", 1], ["P", 1], ["RS", 1]]],
  "Big 12": [["Coaches", "Media"], 2, [["QB", 1], ["RB", 2], ["WR", 3], ["TE", 1], ["C", 1], ["G", 2], ["T", 2], ["DL", 4], ["LB", 3], ["DB", 4], ["K", 1], ["P", 1], ["RS", 1]]],
  "ACC": [["ACSMA"], 3, [["QB", 1], ["RB", 2], ["WR", 3], ["TE", 1], ["AP", 1], ["T", 2], ["G", 2], ["C", 1], ["EDGE", 2], ["DT", 2], ["LB", 3], ["CB", 2], ["S", 2], ["K", 1], ["P", 1], ["RS", 1]]],
  "American Athletic Conference": [["Coaches"], 3, [["QB", 1], ["RB", 2], ["WR", 3], ["TE", 1], ["T", 2], ["G", 2], ["C", 1], ["DL", 4], ["LB", 4], ["CB", 2], ["S", 2], ["K", 1], ["P", 1], ["RS", 1]]],
  "Mountain West": [["Coaches"], 2, [["QB", 1], ["RB", 2], ["WR", 3], ["TE", 1], ["OL", 5], ["DL", 4], ["LB", 4], ["DB", 4], ["K", 1], ["P", 1], ["RS", 1]]],
  "Sun Belt": [["Coaches"], 3, [["QB", 1], ["RB", 2], ["WR", 3], ["TE", 1], ["OL", 5], ["DL", 4], ["LB", 3], ["DB", 5], ["K", 1], ["P", 1], ["RS", 1], ["AP", 1]]],
  "MAC": [["Media"], 3, [["QB", 1], ["RB", 2], ["WR", 4], ["TE", 1], ["OL", 5], ["DL", 4], ["LB", 4], ["DB", 4], ["K", 1], ["P", 1], ["RS", 2]]],
  "Conference USA": [["Coaches"], 2, [["QB", 1], ["RB", 2], ["WR", 3], ["TE", 1], ["OL", 5], ["EDGE", 2], ["DT", 2], ["LB", 3], ["DB", 4], ["K", 1], ["P", 1], ["RS", 1]]],
  "Pac-12": [["Coaches"], 2, [["QB", 1], ["RB", 2], ["WR", 3], ["TE", 1], ["OL", 5], ["DL", 4], ["LB", 4], ["DB", 4], ["K", 1], ["P", 1], ["RS", 1]]],
};

// Conference awards (Part 1F): (name, kind). Newcomer awards are left out: no transfer data.
const _OPOY = ["Offensive Player of the Year", "opoy"], _DPOY = ["Defensive Player of the Year", "dpoy"],
  _ST = ["Special Teams Player of the Year", "stpoy"], _COY = ["Coach of the Year", "coach"];
const CONF_AWARDS = {
  "ACC": [["Player of the Year", "mvp"], _OPOY, _DPOY, ["Rookie of the Year", "freshman"], ["Offensive Rookie of the Year", "off_freshman"],
    ["Defensive Rookie of the Year", "def_freshman"], _COY, ["Jacobs Blocking Trophy", "blocker"]],
  "American Athletic Conference": [_OPOY, _DPOY, _ST, ["Rookie of the Year", "freshman"], _COY],
  "Big 12": [_OPOY, _DPOY, _ST, ["Offensive Freshman of the Year", "off_freshman"], ["Defensive Freshman of the Year", "def_freshman"],
    ["Offensive Lineman of the Year", "ol"], ["Defensive Lineman of the Year", "dl"], _COY],
  "Big Ten": [["Graham-George Offensive Player of the Year", "opoy"], ["Nagurski-Woodson Defensive Player of the Year", "dpoy"],
    ["Chicago Tribune Silver Football", "mvp"], ["Thompson-Randle El Freshman of the Year", "freshman"],
    ["Hayes-Schembechler Coach of the Year", "coach"], ["Griese-Brees Quarterback of the Year", "qb"],
    ["Ameche-Dayne Running Back of the Year", "rb"], ["Richter-Howard Receiver of the Year", "wr"],
    ["Kwalick-Clark Tight End of the Year", "te"], ["Rimington-Pace Offensive Lineman of the Year", "ol"],
    ["Smith-Brown Defensive Lineman of the Year", "dl"], ["Butkus-Fitzgerald Linebacker of the Year", "lb"],
    ["Tatum-Woodson Defensive Back of the Year", "db"], ["Bakken-Andersen Kicker of the Year", "k"],
    ["Eddleman-Fields Punter of the Year", "p"], ["Rodgers-Dwight Return Specialist of the Year", "rs"]],
  "Conference USA": [["Most Valuable Player", "mvp"], _OPOY, _DPOY, _ST, ["Freshman of the Year", "freshman"], _COY],
  "MAC": [_OPOY, _DPOY, _ST, ["Freshman Player of the Year", "freshman"], ["Vern Smith Leadership Award", "mvp"], _COY],
  "Mountain West": [_OPOY, _DPOY, _ST, ["Freshman of the Year", "freshman"], _COY],
  "Pac-12": [_OPOY, ["Pat Tillman Defensive Player of the Year", "dpoy"], ["Offensive Freshman of the Year", "off_freshman"],
    ["Defensive Freshman of the Year", "def_freshman"], ["Morris Trophy (Offense)", "ol"], ["Morris Trophy (Defense)", "dl"], _COY],
  "SEC": [_OPOY, _DPOY, _ST, ["Jacobs Blocking Trophy", "blocker"], ["Freshman of the Year", "freshman"], _COY],
  "Sun Belt": [["Player of the Year", "mvp"], _OPOY, _DPOY, ["Freshman of the Year", "freshman"], _COY],
};

// National awards: (name, kind, team weight for the final score, honors). Week 15 unless noted.
const NATIONAL_AWARDS = [
  ["Maxwell Award", "mvp", 0.9, "college player of the year"],
  ["Walter Camp Award", "mvp_team", 1.1, "player of the year, voted by coaches and sports information directors"],
  ["AP Player of the Year", "mvp", 0.9, "player of the year"],
  ["Sporting News Player of the Year", "mvp", 0.8, "player of the year"],
  ["Davey O'Brien Award", "qb", 0.6, "best quarterback"],
  ["Johnny Unitas Golden Arm Award", "qb_upper", 0.6, "best junior or senior quarterback"],
  ["Doak Walker Award", "rb", 0.3, "best running back"],
  ["Fred Biletnikoff Award", "wr", 0.3, "best receiver"],
  ["John Mackey Award", "te", 0.3, "best tight end"],
  ["Outland Trophy", "interior", 0.5, "best interior lineman, offense or defense"],
  ["Rimington Trophy", "c", 0.5, "best center"],
  ["Lombardi Award", "front", 0.5, "best lineman or linebacker"],
  ["Chuck Bednarik Award", "dpoy", 0.25, "defensive player of the year"],
  ["Bronko Nagurski Trophy", "dpoy_alt", 0.25, "defensive player of the year"],
  ["Lott IMPACT Trophy", "dpoy", 0.6, "defensive player, performance and leadership"],
  ["Butkus Award", "lb", 0.4, "best linebacker"],
  ["Jim Thorpe Award", "db", 0.3, "best defensive back"],
  ["Ted Hendricks Award", "edge", 0.3, "best defensive end"],
  ["Lou Groza Award", "k", 0.2, "best place-kicker"],
  ["Ray Guy Award", "p", 0.0, "best punter"],
  ["Jet Award", "rs", 0.0, "best return specialist"],
  ["Paul Hornung Award", "versatile", 0.2, "most versatile player"],
  ["Shaun Alexander Freshman of the Year", "freshman", 0.2, "top freshman"],
];
const COACH_AWARDS = [
  ["AP Coach of the Year", 0.35, 1.0], ["AFCA Coach of the Year", 0.5, 0.6], ["Eddie Robinson Coach of the Year", 0.25, 1.2],
  ["Bobby Dodd Coach of the Year", 0.6, 0.6], ["George Munger Award", 0.4, 0.9], ["Home Depot Coach of the Year", 0.4, 1.0],
  ["Walter Camp Coach of the Year", 0.5, 0.7],
];   // (name, weight on wins, weight on surprise)

// ----- small helpers -------------------------------------------------------------

const dict_get = get;      // the functions below name their own `get` (the stats' get)
const has = (d, k) => Object.prototype.hasOwnProperty.call(d, k);
const is_dict = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Set) && !(v instanceof Map);

/** d[k], throwing a KeyError for a missing key. */
function at(d, k, name) {
  if (!has(d, k)) throw new Error(`KeyError: ${name}[${JSON.stringify(k)}]`);
  return d[k];
}

/** f"{v:,}": thousands separators (the stats here are whole numbers; a fraction keeps its digits). */
function commas(v) {
  const s = String(Math.abs(v)), dot = s.indexOf(".");
  const whole = dot < 0 ? s : s.slice(0, dot), rest = dot < 0 ? "" : s.slice(dot);
  return (v < 0 ? "-" : "") + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + rest;
}

/** f"{v:g}": six significant digits, trailing zeros dropped (2.5, 12, 0). */
function g_format(v) {
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a < 1e-4 || a >= 1e6) {                       // Python goes to an exponent here: never a stat's size
    const [m, e] = v.toExponential(5).split("e");
    const mm = m.includes(".") ? m.replace(/0+$/, "").replace(/\.$/, "") : m;
    const n = Number(e);
    return `${mm}e${n < 0 ? "-" : "+"}${String(Math.abs(n)).padStart(2, "0")}`;
  }
  return String(Number(v.toPrecision(6)));
}

/** Python's == of two JSON values (a dict against a dict key by key, whatever their order). */
function equal(a, b) {
  if (a === b) return true;
  if (typeof a === "boolean") a = a ? 1 : 0;
  if (typeof b === "boolean") b = b ? 1 : 0;
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => equal(x, b[i]));
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => has(b, k) && equal(a[k], b[k]));
}

// ----- small helpers --------------------------------------------------------------

export function passer_rating(st) {
  const att = dict_get(st, "pass_attempts", 0);
  if (!att) return 0.0;
  return (8.4 * dict_get(st, "pass_yards", 0) + 330 * dict_get(st, "passing_touchdowns", 0) + 100 * dict_get(st, "completions", 0)
          - 200 * dict_get(st, "interceptions_thrown", 0)) / att;
}

export function _z(values) {
  if (values.length < 3) return [values.length ? values[0] : 0.0, 1.0];
  const mean = fmean(values);
  const sd = pstdev(values) || 1.0;
  return [mean, sd];
}

/** 1 -> '1st', 2 -> '2nd', 11 -> '11th'. */
export function _ordinal(n) {
  if (4 <= n && n <= 20) return `${n}th`;
  return `${n}${dict_get({ 1: "st", 2: "nd", 3: "rd" }, mod(n, 10), "th")}`;
}

/** An award's winner (None when nobody qualified) and its top three. */
export function _podium(race) {
  return { winner: race.length ? race[0] : null, finalists: race.slice(0, 3) };
}

export function _rank_bonus(rank) {
  if (rank === null || rank === undefined) return -1.0;
  if (rank <= 4) return 1.5;
  if (rank <= 10) return 0.8;
  if (rank <= 15) return 0.1;
  if (rank <= 25) return -0.2;
  return -0.6;
}

// ----- the player pool ------------------------------------------------------------

/** Every player with season stats, with team context and standardized position scores. */
export class Pool {
  constructor(state, teams, records, through_week = null) {
    this.state = state;
    this.teams = teams;
    this.records = records;
    this.week = through_week !== null && through_week !== undefined ? through_week : state["current_week"];
    this.ranks = this._ranks();
    this.players = [];
    this._eligible = {};    // by_group's cache: group -> players who played enough
    this._build();
    this._standardize();
  }

  // -- team context
  /** Latest poll positions: AP rank and CFP rank (the committee's when it exists). */
  _ranks() {
    const polls = dict_get(this.state, "polls", {});
    const weeks = sorted(Object.keys(polls).filter((w) => /^[0-9]+$/.test(w) && Number(w) <= this.week).map(Number), undefined, true);
    let ap = {};
    let cfp = {};
    const empty = (d) => Object.keys(d).length === 0;
    for (const w of weeks) {
      const p = polls[String(w)];
      if (empty(ap) && truthy(dict_get(p, "ap"))) {
        ap = {};
        for (const e of p["ap"]) ap[e["team"]] = e["rank"];
      }
      if (empty(cfp) && truthy(dict_get(p, "cfp_full"))) {
        cfp = {};
        p["cfp_full"].forEach((t, i) => { cfp[t] = i + 1; });
      } else if (empty(cfp) && truthy(dict_get(p, "cfp"))) {
        cfp = {};
        for (const e of p["cfp"]) cfp[e["team"]] = e["rank"];
      }
      if (!empty(ap) && !empty(cfp)) break;
    }
    return { ap, cfp };
  }

  /** How much a player's team helps him: wins, losses and the poll position. */
  team_term(slug) {
    const r = at(this.records, slug, "records");
    let t = 0.22 * r["wins"] - 0.55 * r["losses"] + _rank_bonus(this.rank_of(slug));
    if (G5.has(this.teams[slug]["conference"])) t -= r["losses"] > 0 ? 0.6 : 0.25;
    return t;
  }

  rank_of(slug) {
    return dict_get(this.ranks["cfp"], slug) || dict_get(this.ranks["ap"], slug);
  }

  // -- players
  _build() {
    const ss = dict_get(this.state, "season_stats", {});
    for (const [slug, ts] of Object.entries(ss)) {
      const team = dict_get(this.teams, slug);
      if (!truthy(team) || truthy(team["fictional"])) continue;
      const roster = new Map();      // (name, position) -> player: the last of two with one name and position, as a dict keeps
      for (const p of team["offense"].concat(team["defense"])) roster.set(`${p["name"]}\u0000${p["position"]}`, p);
      const team_games = Math.max(1, ts["games"]);
      for (const [key, p] of Object.entries(ts["players"])) {
        const found = roster.get(`${p["name"]}\u0000${p["position"]}`);
        const rp = truthy(found) ? found : {};
        const st = p["stats"];
        const role = dict_get(rp, "role");
        const group = Pool._group(p["position"], role, st);
        if (group === null) continue;
        this.players.push({
          key: `${slug}|${key}`, name: p["name"], position: p["position"], role, group,
          class: dict_get(rp, "class"), team: slug, team_name: team["name"], conference: team["conference"],
          games: p["games"], team_games, stats: st, ratings: rp,
          raw: {}, z: {},
        });
      }
    }
  }

  static _group(position, role, st) {
    if (["QB", "RB", "WR", "TE", "OL", "K", "P"].includes(position)) return position;
    if (position === "DL") return EDGE_ROLES.has(role) ? "EDGE" : "DT";
    if (LB_POSITIONS.has(position)) return "LB";
    if (DB_POSITIONS.has(position)) return "DB";
    return null;
  }

  // -- raw production scores, written as "points" so the numbers read like a box score
  _raw_scores(p) {
    const st = p["stats"], g = p["group"];
    const get = (k, d = null) => dict_get(st, k, d);
    const out = {};
    if (g === "QB") {
      const att = get("pass_attempts", 0);
      out["QB"] = (0.040 * get("pass_yards", 0) + 0.022 * get("rush_yards", 0)
                   + 3.0 * (get("passing_touchdowns", 0) + get("rushing_touchdowns", 0))
                   - 3.0 * get("interceptions_thrown", 0) - 0.4 * get("sacks_taken", 0) - 2.0 * get("fumbles", 0)
                   + (att >= 60 ? 0.15 * (passer_rating(st) - 120) : 0));
    } else if (g === "RB") {
      out["RB"] = (0.07 * get("rush_yards", 0) + 0.05 * get("receiving_yards", 0)
                   + 4.0 * (get("rushing_touchdowns", 0) + get("receiving_touchdowns", 0))
                   + 1.2 * get("explosive_runs", 0) + 0.4 * get("rushing_first_downs", 0) - 4.0 * get("fumbles", 0));
    } else if (g === "WR" || g === "TE") {
      out[g] = (0.08 * get("receiving_yards", 0) + 4.0 * get("receiving_touchdowns", 0) + 0.45 * get("receptions", 0)
                + 1.2 * get("explosive_catches", 0) + 0.04 * get("rush_yards", 0) + 3.0 * get("rushing_touchdowns", 0)
                - 3.0 * get("fumbles", 0));
      if (g === "TE") out[g] += 0.08 * (5 + 2.5 * Number(dict_get(p["ratings"], "run_blocking") || 0));   // (card points over the average tight end)
    } else if (g === "EDGE" || g === "DT") {
      out[g] = (1.0 * get("solo_tackles", 0) + 0.5 * get("assisted_tackles", 0) + 3.0 * get("tackles_for_loss", 0)
                + 5.0 * get("sacks", 0) + 1.2 * get("hurries", 0) + 4.0 * get("forced_fumbles", 0)
                + 3.0 * get("fumble_recoveries", 0) + 4.0 * get("interceptions", 0) + 1.5 * get("passes_defended", 0)
                + 10.0 * get("defensive_touchdowns", 0));
    } else if (g === "LB") {
      out[g] = (1.0 * get("solo_tackles", 0) + 0.5 * get("assisted_tackles", 0) + 2.5 * get("tackles_for_loss", 0)
                + 4.0 * get("sacks", 0) + 5.0 * get("interceptions", 0) + 2.0 * get("passes_defended", 0)
                + 4.0 * get("forced_fumbles", 0) + 3.0 * get("fumble_recoveries", 0) + 10.0 * get("defensive_touchdowns", 0));
    } else if (g === "DB") {
      out[g] = (0.45 * get("solo_tackles", 0) + 0.2 * get("assisted_tackles", 0) + 2.0 * get("tackles_for_loss", 0)
                + 3.0 * get("sacks", 0) + 9.0 * get("interceptions", 0) + 3.0 * get("passes_defended", 0)
                + 4.0 * get("forced_fumbles", 0) + 3.0 * get("fumble_recoveries", 0) + 10.0 * get("defensive_touchdowns", 0)
                + 0.05 * get("interception_return_yards", 0));
    } else if (g === "K") {
      const miss = get("fg_attempted", 0) - get("fg_made", 0);
      out[g] = (3.0 * get("fg_made", 0) + 1.0 * get("pat_made", 0) - 4.0 * miss
                - 3.0 * (get("pat_attempts", 0) - get("pat_made", 0)) + 2.0 * get("fg_40_made", 0)
                + 4.0 * get("fg_50_made", 0) + 0.3 * Math.max(0, get("long_fg", 0) - 40));
    } else if (g === "P") {
      const punts = get("punts", 0);
      if (punts >= 10) {
        const net = get("punt_net_yards", 0) / punts;
        const gross = get("punt_yards", 0) / punts;
        out[g] = 4.0 * (net - 38) + 2.0 * (gross - 40) + 1.5 * get("punts_inside_20", 0) - 1.0 * get("punt_touchbacks", 0)
            + 0.3 * Math.max(0, get("long_punt", 0) - 55);
      } else {
        out[g] = -50.0;
      }
    } else if (g === "OL") {
      const r = p["ratings"];
      const block = 0.5 * Number(dict_get(r, "run_blocking") || 0) + 0.5 * Number(dict_get(r, "pass_blocking") || 0);   // card points over the average lineman
      const snaps = get("snaps", 0);
      out[g] = ((5 + 2.5 * block) * 1.2 * Math.min(1.0, snaps / 650.0) + 2.0 * get("key_blocks", 0)
                - 3.0 * get("sacks_allowed", 0) - 0.8 * get("pressures_allowed", 0) - 1.0 * get("stuffs_allowed", 0)
                + 0.02 * snaps);
    }
    // returners: anyone with returns competes for the return slot
    const ret = get("kickoff_returns", 0) + get("punt_returns", 0);
    if (ret >= 8) {
      const ry = get("kickoff_return_yards", 0) + get("punt_return_yards", 0);
      out["RS"] = 0.06 * ry + 8.0 * (get("kickoff_return_touchdowns", 0) + get("punt_return_touchdowns", 0))
          + 0.5 * (ry / ret - 18) * Math.min(ret, 30);
    }
    return out;
  }

  _standardize() {
    for (const p of this.players) p["raw"] = this._raw_scores(p);
    const by_group = {};
    for (const p of this.players) {
      for (const [g, v] of Object.entries(p["raw"])) {
        if (!has(by_group, g)) by_group[g] = [];
        by_group[g].push(v);
      }
    }
    // the reference is the top of each pool (the players who actually play), so a long
    // bench does not drag the mean down
    const params = {};
    for (const [g, vals] of Object.entries(by_group)) {
      const top = sorted(vals, undefined, true).slice(0, Math.max(5, Math.min(80, floordiv(vals.length, 4))));
      params[g] = _z(top);
    }
    const n_teams = Math.max(1, sum(Object.values(this.teams).map((t) => (!truthy(t["fictional"]) ? 1 : 0))));
    const starters = {};
    for (const [g, vals] of Object.entries(by_group)) {
      const top = sorted(vals, undefined, true).slice(0, Math.max(5, dict_get(STARTERS_PER_TEAM, g, 1) * n_teams));
      starters[g] = _z(top);
    }
    for (const p of this.players) {
      p["zb"] = {};
      for (const [g, v] of Object.entries(p["raw"])) {
        const [mean, sd] = params[g];
        p["z"][g] = (v - mean) / sd;
        const [bm, bs] = starters[g];
        p["zb"][g] = (v - bm) / bs;
      }
    }
    this.params = params;
  }

  // -- eligibility and lookups
  played_enough(p, share = 0.5) {
    return p["games"] >= share * p["team_games"] && p["team_games"] >= 3;
  }

  /** `cond` is the conditions as one object: {conference, roles (a Set), classes (a Set), unit}. */
  by_group(group, cond = {}) {
    // the players with a score in the group who played enough, listed once per group
    if (!has(this._eligible, group)) {
      this._eligible[group] = this.players.filter((p) => has(p["z"], group) && this.played_enough(p));
    }
    const out = [];
    for (const p of this._eligible[group]) {
      if (truthy(dict_get(cond, "conference")) && p["conference"] !== cond["conference"]) continue;
      if (truthy(dict_get(cond, "roles")) && !cond["roles"].has(p["role"])) continue;
      if (truthy(dict_get(cond, "classes")) && !cond["classes"].has(p["class"])) continue;
      if (dict_get(cond, "unit") === "offense" && !["QB", "RB", "WR", "TE", "OL"].includes(p["group"])) continue;
      if (dict_get(cond, "unit") === "defense" && !["EDGE", "DT", "LB", "DB"].includes(p["group"])) continue;
      out.push(p);
    }
    return out;
  }

  /** Standardized production times the position prior, plus the team term. */
  heisman_score(p) {
    let best = -9, any = false;
    for (const g of Object.keys(p["zb"])) {
      const v = p["zb"][g] * dict_get(POSITION_PRIOR, g, 0.3);
      if (!any || v > best) { best = v; any = true; }
    }
    if (G5.has(this.teams[p["team"]]["conference"])) best *= 0.85;
    return best + 0.45 * this.team_term(p["team"]);
  }

  card(p, group = null) {
    const g = group || p["group"];
    return { name: p["name"], position: p["position"], role: p["role"], class: p["class"], team: p["team"],
      team_name: p["team_name"], conference: p["conference"], games: p["games"],
      line: stat_line(p, g), headline: headline(p, g), score: round(dict_get(p["z"], g, 0), 2) };
  }
}

/** A count with its noun: "1 sack", "2.5 sacks", "0 key blocks". */
export function _n(v, one) {
  return `${g_format(v)} ${v === 1 ? one : one + "s"}`;
}

/** The one number that sums up the season, for the award cards. */
export function headline(p, group) {
  const st = p["stats"];
  const get = (k, d = null) => dict_get(st, k, d);
  if (group === "QB") return `${commas(get("pass_yards", 0))} Yds · ${get("passing_touchdowns", 0) + get("rushing_touchdowns", 0)} TD`;
  if (group === "RB") return `${commas(get("rush_yards", 0))} Yds · ${get("rushing_touchdowns", 0) + get("receiving_touchdowns", 0)} TD`;
  if (group === "WR" || group === "TE") return `${commas(get("receiving_yards", 0))} Yds · ${get("receiving_touchdowns", 0)} TD`;
  if (group === "EDGE" || group === "DT") return `${_n(get("sacks", 0), "Sack")} · ${g_format(get("tackles_for_loss", 0))} TFL`;
  if (group === "LB") return `${get("solo_tackles", 0) + get("assisted_tackles", 0)} Tkl · ${g_format(get("tackles_for_loss", 0))} TFL`;
  if (group === "DB") return `${get("interceptions", 0)} INT · ${get("passes_defended", 0)} PBU`;
  if (group === "K") return `${get("fg_made", 0)}/${get("fg_attempted", 0)} FG`;
  if (group === "P") {
    const n = Math.max(1, get("punts", 0));
    return `${fmt(get("punt_net_yards", 0) / n, 1)} Net`;
  }
  if (group === "OL") return `${_n(get("sacks_allowed", 0), "Sack")} Allowed`;
  if (group === "RS") return `${commas(get("kickoff_return_yards", 0) + get("punt_return_yards", 0))} Ret Yds`;
  return "";
}

/** A one-line box score for the award cards. */
export function stat_line(p, group) {
  const st = p["stats"];
  const get = (k, d = null) => dict_get(st, k, d);
  if (group === "QB") {
    return (`${get("completions", 0)}/${get("pass_attempts", 0)}, ${commas(get("pass_yards", 0))} Yds, ${get("passing_touchdowns", 0)} TD, `
            + `${get("interceptions_thrown", 0)} INT, ${fmt(passer_rating(st), 1)} Rtg; ${commas(get("rush_yards", 0))} Rush Yds, ${get("rushing_touchdowns", 0)} Rush TD`);
  }
  if (group === "RB") {
    return (`${get("carries", 0)} Car, ${commas(get("rush_yards", 0))} Yds, ${get("rushing_touchdowns", 0)} TD; `
            + `${get("receptions", 0)} Rec, ${commas(get("receiving_yards", 0))} Yds, ${get("receiving_touchdowns", 0)} TD`);
  }
  if (group === "WR" || group === "TE") {
    const line = `${get("receptions", 0)} Rec, ${commas(get("receiving_yards", 0))} Yds, ${get("receiving_touchdowns", 0)} TD`;
    return line + (truthy(get("explosive_catches", 0)) ? `, ${_n(get("explosive_catches", 0), "Play")} of 25+` : "");   // real box scores carry no play lengths
  }
  if (["EDGE", "DT", "LB", "DB"].includes(group)) {
    const tk = get("solo_tackles", 0) + get("assisted_tackles", 0);
    return (`${_n(tk, "Tackle")}, ${g_format(get("tackles_for_loss", 0))} TFL, ${_n(get("sacks", 0), "Sack")}, ${get("interceptions", 0)} INT, `
            + `${get("passes_defended", 0)} PBU, ${get("forced_fumbles", 0)} FF`);
  }
  if (group === "K") {
    return `${get("fg_made", 0)}/${get("fg_attempted", 0)} FG, ${get("fg_50_made", 0)}/${get("fg_50_att", 0)} From 50+, Long ${get("long_fg", 0)}, ${get("pat_made", 0)}/${get("pat_attempts", 0)} PAT`;
  }
  if (group === "P") {
    const n = Math.max(1, get("punts", 0));
    return `${get("punts", 0)} Punts, ${fmt(get("punt_yards", 0) / n, 1)} Avg, ${fmt(get("punt_net_yards", 0) / n, 1)} Net, ${get("punts_inside_20", 0)} Inside 20`;
  }
  if (group === "OL") {
    return (`${commas(get("snaps", 0))} ${get("snaps", 0) === 1 ? "Snap" : "Snaps"}, ${_n(get("sacks_allowed", 0), "Sack")} Allowed, `
            + `${_n(get("pressures_allowed", 0), "Pressure")}, ${_n(get("key_blocks", 0), "Key Block")}`);
  }
  if (group === "RS") {
    const ret = get("kickoff_returns", 0) + get("punt_returns", 0);
    const ry = get("kickoff_return_yards", 0) + get("punt_return_yards", 0);
    return `${ret} Returns, ${commas(ry)} Yds, ${fmt(ry / Math.max(1, ret), 1)} Avg, ${get("kickoff_return_touchdowns", 0) + get("punt_return_touchdowns", 0)} TD`;
  }
  return "";
}

// ----- award selection ----------------------------------------------------------------

/** The (players, score group) pairs an award kind draws from. */
export function _candidates(pool, kind, conference = null) {
  const conf = truthy(conference) ? { conference } : {};
  if (["mvp", "mvp_team", "opoy", "versatile", "freshman", "off_freshman"].includes(kind)) {
    const groups = ["QB", "RB", "WR", "TE"];
    const classes = ["freshman", "off_freshman"].includes(kind) ? { classes: FRESHMAN } : {};
    let pairs = groups.map((g) => [pool.by_group(g, { ...conf, ...classes }), g]);
    if (["mvp", "mvp_team", "freshman"].includes(kind)) {
      pairs = pairs.concat(["EDGE", "DT", "LB", "DB"].map((g) => [pool.by_group(g, { ...conf, ...classes }), g]));
    }
    return pairs;
  }
  if (["dpoy", "dpoy_alt", "def_freshman"].includes(kind)) {
    const classes = kind === "def_freshman" ? { classes: FRESHMAN } : {};
    return ["EDGE", "DT", "LB", "DB"].map((g) => [pool.by_group(g, { ...conf, ...classes }), g]);
  }
  if (["qb", "rb", "wr", "te", "lb", "db", "k", "p", "rs"].includes(kind)) {
    const g = kind.toUpperCase();
    if (kind === "wr") return [[pool.by_group("WR", { ...conf }), "WR"], [pool.by_group("TE", { ...conf }), "TE"]];
    return [[pool.by_group(g, { ...conf }), g]];
  }
  if (kind === "qb_upper") return [[pool.by_group("QB", { ...conf, classes: UPPERCLASS }), "QB"]];
  if (kind === "edge") return [[pool.by_group("EDGE", { ...conf }), "EDGE"]];
  if (kind === "dl") return [[pool.by_group("EDGE", { ...conf }), "EDGE"], [pool.by_group("DT", { ...conf }), "DT"]];
  if (kind === "ol" || kind === "blocker") return [[pool.by_group("OL", { ...conf }), "OL"]];
  if (kind === "c") return [[pool.by_group("OL", { ...conf, roles: new Set(["C"]) }), "OL"]];
  if (kind === "interior") return [[pool.by_group("OL", { ...conf }), "OL"], [pool.by_group("DT", { ...conf }), "DT"]];
  if (kind === "front") return ["OL", "EDGE", "DT", "LB"].map((g) => [pool.by_group(g, { ...conf }), g]);
  if (kind === "stpoy") return ["K", "P", "RS"].map((g) => [pool.by_group(g, { ...conf }), g]);
  return [];
}

/**
 * Ranked hopefuls for one award: production z within each eligible group (scaled by the
 * position prior for cross-position awards), plus the team term.
 */
export function award_race(pool, kind, team_weight, rng, conference = null, n = 5, noise = 0.0) {
  const cross = ["mvp", "mvp_team", "opoy", "dpoy", "dpoy_alt", "versatile", "freshman", "off_freshman", "def_freshman",
    "interior", "front", "stpoy", "dl", "wr"].includes(kind);
  const rows = [];
  for (const [players, g] of _candidates(pool, kind, conference)) {
    let prior;
    if (["dpoy", "dpoy_alt", "def_freshman"].includes(kind)) {
      prior = at({ EDGE: 1.3, LB: 1.0, DB: 0.78, DT: 1.0 }, g, "prior");   // history: LB and DE dominate, DTs win sometimes
    } else if (kind === "front") {
      prior = at({ OL: 0.85, EDGE: 1.05, DT: 0.95, LB: 0.8 }, g, "prior");   // Lombardi: linemen first
    } else if (kind === "wr") {
      prior = at({ WR: 1.0, TE: 0.7 }, g, "prior");   // the Biletnikoff has always gone to a wide receiver
    } else if (kind === "interior") {
      prior = at({ OL: 1.0, DT: 0.95 }, g, "prior");
    } else if (kind === "versatile") {
      prior = 0.6;
    } else if (cross && kind !== "dl") {
      prior = dict_get(POSITION_PRIOR, g, 0.5);
    } else {
      prior = 1.0;
    }
    for (const p of players) {
      let s = (cross ? p["zb"][g] : p["z"][g]) * prior + team_weight * pool.team_term(p["team"]);
      if (kind === "versatile") s += 0.8 * dict_get(p["z"], "RS", -1.0) + (has(p["z"], "RS") ? 0.5 : -1.5);
      if (kind === "stpoy" && g === "RS") s += 0.3;
      if (noise) s += rng.gauss(0, noise);
      rows.push([s, p, g]);
    }
  }
  rows.sort((a, b) => cmp(-a[0], -b[0]));
  const seen = new Set();
  const out = [];
  for (const [s, p, g] of rows) {
    if (seen.has(p["key"])) continue;
    seen.add(p["key"]);
    const c = pool.card(p, g);
    c["score"] = round(s, 2);
    out.push(c);
    if (out.length >= n) break;
  }
  return out;
}

// ----- the Heisman vote ----------------------------------------------------------------

/**
 * 870 media voters in six regions, the past winners and a fan vote, each ranking three.
 * A straw poll (in season) uses a tenth of the voters.
 */
export function heisman_vote(pool, rng, n_candidates = 12, straw = false) {
  const players = pool.players.filter((p) => pool.played_enough(p, 0.4));
  const scored = sorted(players.map((p) => [pool.heisman_score(p), p]), (x) => -x[0]).slice(0, n_candidates);
  if (!scored.length) return { candidates: [], winner: null, finalists: [], ballots: 0 };
  const cands = scored.map(([, p]) => p);
  const base = {};
  for (const [s, p] of scored) base[p["key"]] = s;
  const region_of = {};
  for (const p of cands) {
    const st = dict_get(pool.teams[p["team"]], "state");
    let found = "South";
    for (const [r, states] of Object.entries(REGIONS)) {
      if (states.has(st)) { found = r; break; }
    }
    region_of[p["key"]] = found;
  }
  const voters = [];
  const per_region = straw ? 15 : 145;
  for (const region of Object.keys(REGIONS)) {
    for (const _ of range(per_region)) voters.push([region, rng.gauss(0, 0.3)]);
  }
  for (const _ of range(straw ? 6 : 57)) voters.push([null, rng.gauss(0.1, 0.3)]);   // past winners
  voters.push([null, 0.0]);                                                          // the fan vote
  const tally = {};
  for (const p of cands) tally[p["key"]] = [0, 0, 0];
  for (const [region, bias] of voters) {
    const utility = [];
    for (const p of cands) {
      let u = base[p["key"]] + rng.gauss(0, 0.6) + bias * pool.team_term(p["team"]) * 0.4;
      if (region && region_of[p["key"]] === region) u += 0.35;
      utility.push([u, p["key"]]);
    }
    utility.sort((a, b) => cmp(-a[0], -b[0]));
    utility.slice(0, 3).forEach(([, key], place) => { tally[key][place] += 1; });
  }
  const rows = [];
  for (const p of cands) {
    const [f, s, t] = tally[p["key"]];
    const pts = 3 * f + 2 * s + t;
    const c = pool.card(p);
    Object.assign(c, { first: f, second: s, third: t, points: pts, region: region_of[p["key"]],
      record: `${pool.records[p["team"]]["wins"]}-${pool.records[p["team"]]["losses"]}`, rank: pool.rank_of(p["team"]) });
    rows.push(c);
  }
  rows.sort((a, b) => cmp([-a["points"], -a["first"]], [-b["points"], -b["first"]]));
  const total_ballots = voters.length;
  let finalists = rows.slice(0, 4);
  if (rows.length > 4 && rows[4]["points"] >= 0.9 * rows[3]["points"]) finalists = rows.slice(0, 5);
  return { candidates: rows, winner: rows[0], finalists, ballots: total_ballots,
    possible: 3 * total_ballots, share: round(100 * rows[0]["points"] / (3 * total_ballots), 1) };
}

// ----- coaches ----------------------------------------------------------------------

/**
 * Every head coach with wins over expectation. Expectation comes from the roster's
 * rating rank and the preseason poll, so a surprise season is what the award sees.
 */
export function coach_table(pool, include_playoff = false) {
  const teams = pool.teams;
  const fbs = Object.keys(teams).filter((s) => !truthy(teams[s]["fictional"]));
  const by_rating = sorted(fbs, (s) => -teams[s]["team_ratings"]["overall"]);
  const rating_rank = {};
  by_rating.forEach((s, i) => { rating_rank[s] = i; });
  const pre = {};
  for (const e of dict_get(dict_get(dict_get(pool.state, "polls", {}), "0", {}), "ap", [])) pre[e["team"]] = e["rank"];
  const champions = dict_get(pool.state, "champions", {});
  const bracket = truthy(dict_get(pool.state, "bracket")) ? pool.state["bracket"] : {};
  const seed_list = is_dict(bracket) ? dict_get(bracket, "seeds") : null;
  const seeds = {};
  for (const s of Array.isArray(seed_list) ? seed_list : []) {
    if (is_dict(s) && has(s, "team")) seeds[s["team"]] = dict_get(s, "seed");
  }
  const rows = [];
  for (const slug of fbs) {
    const r = at(pool.records, slug, "records");
    const g = r["wins"] + r["losses"];
    if (g < 6) continue;
    let exp_pct = 0.88 - 0.55 * rating_rank[slug] / Math.max(1, fbs.length - 1);
    if (has(pre, slug)) exp_pct = Math.max(exp_pct, 0.9 - 0.012 * pre[slug]);
    const expected = exp_pct * g;
    const surprise = Math.max(-4.0, Math.min(4.0, r["wins"] - expected));
    const coaches = truthy(dict_get(teams[slug], "coaches")) ? teams[slug]["coaches"] : {};
    const hc = truthy(dict_get(coaches, "head_coach")) ? coaches["head_coach"] : {};
    const champ = Object.values(champions).some((v) => v === slug);
    const rank = pool.rank_of(slug);
    rows.push({ team: slug, team_name: teams[slug]["name"], conference: teams[slug]["conference"], coach: dict_get(hc, "name"),
      g5: G5.has(teams[slug]["conference"]),
      wins: r["wins"], losses: r["losses"], expected: round(expected, 1), surprise: round(surprise, 2),
      champion: champ, rank, preseason_rank: dict_get(pre, slug), seed: dict_get(seeds, slug),
      national_champion: dict_get(pool.state, "champion") === slug });
  }
  return rows;
}

export function coach_award(rows, win_weight, surprise_weight, rng, title = false) {
  const scored = [];
  for (const c of rows) {
    let s = surprise_weight * c["surprise"] + win_weight * (c["wins"] - 8) + (truthy(c["champion"]) ? 0.8 : 0) + _rank_bonus(c["rank"]) * 1.2;
    if (c["losses"] >= 4) s -= 1.0 * (c["losses"] - 3);
    if (truthy(dict_get(c, "g5")) && c["losses"] > 1) s -= 1.8;
    if (c["preseason_rank"] === null) s += 0.4 * surprise_weight;
    else if (c["preseason_rank"] <= 5) s -= 1.2 * surprise_weight;
    if (title) s += truthy(c["national_champion"]) ? 3.0 : 0;
    s += rng.gauss(0, 0.35);
    scored.push([s, c]);
  }
  scored.sort((a, b) => cmp(-a[0], -b[0]));
  return scored.slice(0, 5).map(([s, c]) => ({ ...c, score: round(s, 2) }));
}

/** Coordinators: the unit's scoring rank against its rating rank, plus wins. */
export function broyles_table(pool) {
  const teams = pool.teams, ss = dict_get(pool.state, "season_stats", {});
  const fbs = Object.keys(ss).filter((s) => has(teams, s) && !truthy(teams[s]["fictional"]) && ss[s]["games"] >= 6);
  const off = sorted(fbs, (s) => -ss[s]["points"] / ss[s]["games"]);
  const dfn = sorted(fbs, (s) => ss[s]["opp_points"] / ss[s]["games"]);
  const ranked = (xs) => { const d = {}; xs.forEach((s, i) => { d[s] = i; }); return d; };
  const off_rank = ranked(off);
  const def_rank = ranked(dfn);
  const off_rating = ranked(sorted(fbs, (s) => -teams[s]["team_ratings"]["offense"]));
  const def_rating = ranked(sorted(fbs, (s) => -teams[s]["team_ratings"]["defense"]));
  const rows = [];
  for (const slug of fbs) {
    const coaches = truthy(dict_get(teams[slug], "coaches")) ? teams[slug]["coaches"] : {};
    const wins = pool.records[slug]["wins"];
    for (const [role, key, rank, rrank] of [["Offensive Coordinator", "offensive_coordinator", off_rank, off_rating],
      ["Defensive Coordinator", "defensive_coordinator", def_rank, def_rating]]) {
      const c = truthy(dict_get(coaches, key)) ? coaches[key] : {};
      if (!truthy(dict_get(c, "name"))) continue;
      const gain = (rrank[slug] - rank[slug]) / Math.max(1, fbs.length) * 6;
      let unit_bonus;
      if (rank[slug] < 10) unit_bonus = 2.0;
      else if (rank[slug] < 25) unit_bonus = 0.8;
      else unit_bonus = 0;
      const s = gain + 0.6 * (wins - 8) + unit_bonus + 0.8 * _rank_bonus(pool.rank_of(slug));
      rows.push({ coach: c["name"], role, team: slug, team_name: teams[slug]["name"], unit_rank: rank[slug] + 1,
        rating_rank: rrank[slug] + 1, wins, score: round(s, 2) });
    }
  }
  rows.sort((a, b) => cmp(-a["score"], -b["score"]));
  return rows.slice(0, 5);
}

/** Joe Moore Award: the line as a unit. */
export function ol_units(pool) {
  const teams = pool.teams, ss = dict_get(pool.state, "season_stats", {});
  const rows = [];
  for (const [slug, ts] of Object.entries(ss)) {
    if (!has(teams, slug) || truthy(teams[slug]["fictional"]) || ts["games"] < 8) continue;
    const t = ts["team"];
    const att = dict_get(t, "Pass Attempts", 0) + dict_get(t, "Sacks Taken", 0);
    const sack_rate = att ? dict_get(t, "Sacks Taken", 0) / att : 0.1;
    if (dict_get(t, "Carries", 1) === 0) throw new Error("ZeroDivisionError: division by zero");
    const ypc = dict_get(t, "Rush Yards", 0) / dict_get(t, "Carries", 1);
    rows.push({ team: slug, team_name: teams[slug]["name"], conference: teams[slug]["conference"],
      sack_rate: round(100 * sack_rate, 1), ypc: round(ypc, 2), rush_ypg: round(dict_get(t, "Rush Yards", 0) / ts["games"], 1),
      wins: pool.records[slug]["wins"] });
  }
  if (!rows.length) return [];
  const [m_s, sd_s] = _z(rows.map((r) => r["sack_rate"]));
  const [m_y, sd_y] = _z(rows.map((r) => r["ypc"]));
  for (const r of rows) {
    r["score"] = round(-(r["sack_rate"] - m_s) / sd_s + (r["ypc"] - m_y) / sd_y + 0.12 * (r["wins"] - 8), 2);
  }
  rows.sort((a, b) => cmp(-a["score"], -b["score"]));
  return rows.slice(0, 5);
}

// ----- All-America and all-conference teams ---------------------------------------------

export function _slot_pool(pool, slot, conference) {
  const conf = truthy(conference) ? { conference } : {};
  if (["QB", "RB", "WR", "TE", "K", "P", "LB", "DB", "EDGE", "DT", "OL", "RS"].includes(slot)) return [pool.by_group(slot, { ...conf }), slot];
  if (slot === "C") return [pool.by_group("OL", { ...conf, roles: new Set(["C"]) }), "OL"];
  if (slot === "G") return [pool.by_group("OL", { ...conf, roles: new Set(["LG", "RG"]) }), "OL"];
  if (slot === "T") return [pool.by_group("OL", { ...conf, roles: new Set(["LT", "RT"]) }), "OL"];
  if (slot === "CB") return [pool.by_group("DB", { ...conf, roles: new Set(["CB"]) }), "DB"];
  if (slot === "S") return [pool.by_group("DB", { ...conf, roles: new Set(["FS", "SS"]) }), "DB"];
  if (slot === "DL") return [pool.by_group("EDGE", { ...conf }).concat(pool.by_group("DT", { ...conf })), null];
  if (slot === "AP") return [pool.by_group("RB", { ...conf }).concat(pool.by_group("WR", { ...conf })).filter((p) => has(p["z"], "RS")), null];
  return [[], slot];
}

/**
 * Fill the slots for `levels` teams (first, second, ...), specific sub-positions first so
 * the generic slots (OL, DL, DB) take what is left. Returns [{"slot", "level", card}].
 */
export function select_team(pool, slots, team_weight, noise, rng, conference = null, levels = 1) {
  const order = sorted(range(slots.length), (i) => (["C", "G", "T", "CB", "S", "EDGE", "DT"].includes(slots[i][0]) ? 0 : 1));
  const taken = new Set();
  const out = [];
  const utilities = new Map();      // (player key, group or None) -> utility

  const utility = (p, g) => {
    const key = `${p["key"]}\u0000${g === null ? "\u0001" : g}`;
    if (!utilities.has(key)) {
      const gg = g || p["group"];
      let u = p["z"][gg] + team_weight * pool.team_term(p["team"]) + rng.gauss(0, noise);
      if (gg === "RS") {
        // a return slot ignores the team; the first draw above is still taken so the
        // random stream (and every later pick) stays the same
        u = p["z"]["RS"] + rng.gauss(0, noise);
      }
      utilities.set(key, u);
    }
    return utilities.get(key);
  };

  for (const level of range(1, levels + 1)) {
    for (const i of order) {
      const [slot, n] = slots[i];
      const [players, g] = _slot_pool(pool, slot, conference);
      let ranked;
      if (slot === "AP") {
        ranked = sorted(players, (p) => -(p["z"][p["group"]] * 0.6 + p["z"]["RS"] * 0.6 + rng.gauss(0, noise)));
      } else {
        ranked = sorted(players, (p) => -utility(p, g));
      }
      let picked = 0;
      for (const p of ranked) {
        if (taken.has(p["key"])) continue;
        taken.add(p["key"]);
        const c = pool.card(p, g || p["group"]);   // the all-purpose and generic DL slots score each player at his own group
        out.push({ slot, level, ...c });
        picked += 1;
        if (picked >= n) break;
      }
    }
  }
  return out;
}

/**
 * Five selectors, each with first and second teams; consensus is first team on three of
 * the five, unanimous on all five.
 */
export function all_america(pool, rng) {
  const teams = {};
  for (const [name, [tw, noise]] of Object.entries(SELECTORS)) teams[name] = select_team(pool, AA_SLOTS, tw, noise, rng, undefined, 2);
  const counts = {};
  for (const [name, picks] of Object.entries(teams)) {
    for (const c of picks) {
      const key = `${c["team"]}|${c["name"]}|${c["position"]}`;
      if (!has(counts, key)) counts[key] = { ...c, first_teams: [], second_teams: [] };
      const rec = counts[key];
      (c["level"] === 1 ? rec["first_teams"] : rec["second_teams"]).push(name);
    }
  }
  const consensus = [];
  for (let rec of Object.values(counts)) {
    const n1 = rec["first_teams"].length;
    if (n1 >= 3) {
      rec = { ...rec };
      rec["unanimous"] = n1 === 5;
      rec["selectors"] = n1;
      consensus.push(rec);
    }
  }
  const slot_order = {};
  AA_SLOTS.forEach(([s], i) => { slot_order[s] = i; });
  const key = (r) => [dict_get(slot_order, r["slot"], 99), -r["selectors"], -r["score"]];
  consensus.sort((a, b) => cmp(key(a), key(b)));
  return { selectors: teams, consensus, unanimous: consensus.filter((r) => r["unanimous"]) };
}

export function all_conference(pool, conference, rng) {
  const layout = dict_get(CONF_LAYOUTS, conference);
  if (!truthy(layout)) return {};
  const [selectors, levels, slots] = layout;
  const out = {};
  for (const sel of selectors) {
    const tw = sel === "Coaches" ? 0.45 : 0.25;
    out[sel] = select_team(pool, slots, tw, 0.35, rng, conference, levels);
  }
  return { selectors: out, levels };
}

// ----- the season steps -------------------------------------------------------------------

/**
 * The voters' noise for a season's honors: seeded from the season's seed and year, so a
 * seeded season gives the same finalists and teams every run (a season without a seed draws
 * from its id). The honors feed development (offseason.growth_terms), so a stream seeded from
 * the id made a seeded career's development differ run to run.
 */
export function _rng(state, salt) {
  const key = dict_get(state, "seed") !== null ? state["seed"] : at(state, "id", "state");
  return new Random(`${key}|${dict_get(state, "year") || 2026}|${salt}`);
}

/** Every conference's awards and all-conference teams (week 14). */
export function conference_awards(pool, state, final = true) {
  const rng = _rng(state, "conference");
  const coaches = coach_table(pool);
  const out = {};
  for (const [conf, conf_awards] of Object.entries(CONF_AWARDS)) {
    if (!Object.values(pool.teams).some((t) => t["conference"] === conf && !truthy(t["fictional"]))) continue;
    const entry = { awards: [], teams: final ? all_conference(pool, conf, rng) : {} };
    for (const [name, kind] of conf_awards) {
      let race;
      if (kind === "coach") {
        const rows = coaches.filter((c) => c["conference"] === conf);
        race = coach_award(rows, 0.5, 1.0, rng);
      } else {
        const tw = dict_get({ mvp: 0.5, opoy: 0.35, dpoy: 0.2 }, kind, 0.3);
        race = award_race(pool, kind, tw, rng, conf, 5, final ? 0.15 : 0.0);
      }
      entry["awards"].push({ name, kind, ..._podium(race) });
    }
    out[conf] = entry;
  }
  return out;
}

/** The Heisman vote, the national player awards, coach awards and All-America (week 15). */
export function national_awards(pool, state, final = true) {
  const rng = _rng(state, "national");
  const heisman = heisman_vote(pool, rng, undefined, !final);
  const noise = final ? 0.2 : 0.0;
  const player_awards = [];
  for (const [name, kind, tw, honors] of NATIONAL_AWARDS) {
    // the Walter Camp is scored like the other player of the year awards, with its own team weight
    const race = award_race(pool, kind === "mvp_team" ? "mvp" : kind, tw, rng, undefined, 5, noise);
    player_awards.push({ name, kind, honors, ..._podium(race), race });
  }
  const coaches = coach_table(pool);
  const coach_awards = [];
  for (const [name, ww, sw] of COACH_AWARDS) {
    const race = coach_award(coaches, ww, sw, rng);
    coach_awards.push({ name, ..._podium(race) });
  }
  const broyles = broyles_table(pool);
  coach_awards.push({ name: "Broyles Award", ..._podium(broyles), assistant: true });
  const out = { heisman, awards: player_awards, coach_awards };
  if (final) out["all_america"] = all_america(pool, rng);
  return out;
}

/** After the national championship (week 20): Manning, Bear Bryant, Joe Moore. */
export function postseason_awards(pool, state) {
  const rng = _rng(state, "postseason");
  const out = [];
  const manning = award_race(pool, "qb", 0.7, rng, undefined, 5, 0.2);
  out.push({ name: "Manning Award", kind: "qb", honors: "best quarterback, bowls and playoff included", ..._podium(manning) });
  const bryant = coach_award(coach_table(pool, true), 0.6, 0.6, rng, true);
  out.push({ name: "Paul \"Bear\" Bryant Award", kind: "coach", honors: "coach of the year, after the playoff", ..._podium(bryant) });
  const moore = ol_units(pool);
  out.push({ name: "Joe Moore Award", kind: "ol_unit", honors: "best offensive line", ..._podium(moore) });
  return { awards: out };
}

// ----- views ---------------------------------------------------------------------------------

/** Everything your team won or placed in, across every stage, as flat cards. */
export function my_awards(state, awards_) {
  const me = state["team"];
  const out = [];

  const add = (stage, award, c, place) => {
    if (truthy(c) && dict_get(c, "team") === me) {
      // a unit award (the Joe Moore Award goes to an offensive line) has no one person
      const unit = !(truthy(dict_get(c, "name")) || truthy(dict_get(c, "coach")));
      out.push({ stage, award, place,
        who: dict_get(c, "name") || dict_get(c, "coach") || `${dict_get(c, "team_name", "Your")} offensive line`,
        position: unit ? "OL" : dict_get(c, "position"), line: dict_get(c, "line", "") });
    }
  };

  /** The winner and the other finalists of one award. */
  const add_award = (stage, a) => {
    add(stage, a["name"], dict_get(a, "winner"), "winner");
    for (const c of dict_get(a, "finalists", []).slice(1)) add(stage, a["name"], c, "finalist");
  };

  const or_dict = (v) => (truthy(v) ? v : {});
  const nat = or_dict(dict_get(awards_, "national"));
  const h = or_dict(dict_get(nat, "heisman"));
  dict_get(h, "candidates", []).slice(0, 10).forEach((c, i) => {
    let place;
    if (i === 0) place = "winner";
    else {
      place = `${_ordinal(i + 1)} in the vote, ${c["points"]} points`
        + (dict_get(h, "finalists", []).some((f) => f === c || equal(f, c)) ? " (finalist)" : "");
    }
    add("Heisman Trophy", "Heisman Trophy", c, place);
  });
  for (const a of dict_get(nat, "awards", []).concat(dict_get(or_dict(dict_get(awards_, "postseason")), "awards", []))) {
    add_award("National awards", a);
  }
  for (const a of dict_get(nat, "coach_awards", [])) add_award("Coach awards", a);
  const aa = or_dict(dict_get(nat, "all_america"));
  for (const c of dict_get(aa, "consensus", [])) {
    add("All-America", "Consensus All-American" + (truthy(dict_get(c, "unanimous")) ? " (unanimous)" : ""), c, c["slot"]);
  }
  for (const [sel, picks] of Object.entries(or_dict(dict_get(aa, "selectors")))) {
    for (const c of picks) add("All-America", `${sel} All-America ${c["level"] === 1 ? "first" : "second"} team`, c, c["slot"]);
  }
  for (const [conf, entry] of Object.entries(or_dict(dict_get(awards_, "conference")))) {
    for (const a of dict_get(entry, "awards", [])) add_award(`${conf} awards`, a);
    for (const [sel, picks] of Object.entries(dict_get(or_dict(dict_get(entry, "teams")), "selectors", {}))) {
      for (const c of picks) {
        const word = ["first", "second", "third"][c["level"] - 1];
        if (word === undefined) throw new Error("IndexError: list index out of range");
        add(`All-${conf}`, `${sel} ${word} team`, c, c["slot"]);
      }
    }
  }
  return out;
}

/**
 * The live picture during the season: Heisman straw poll, every national award's
 * hopefuls, and your conference's award races.
 */
export function race_view(state, teams, records) {
  const pool = new Pool(state, teams, records);
  if (!pool.players.length) return { live: true, heisman: null, awards: [], coach_awards: [], conference: {} };
  const nat = national_awards(pool, state, false);
  const conf = teams[state["team"]]["conference"];
  let conf_entry = {};
  if (has(CONF_AWARDS, conf)) conf_entry = dict_get(conference_awards(pool, state, false), conf, {});
  return { live: true, heisman: nat["heisman"], awards: nat["awards"], coach_awards: nat["coach_awards"],
    conference: truthy(conf_entry) ? { [conf]: conf_entry } : {} };
}

export const awards = {
  G5, FRESHMAN, UPPERCLASS, EDGE_ROLES, LB_POSITIONS, DB_POSITIONS, REGIONS, POSITION_PRIOR, STARTERS_PER_TEAM,
  SELECTORS, AA_SLOTS, CONF_LAYOUTS, _OPOY, _DPOY, _ST, _COY, CONF_AWARDS, NATIONAL_AWARDS, COACH_AWARDS,
  passer_rating, _z, _ordinal, _podium, _rank_bonus, Pool, _n, headline, stat_line, _candidates, award_race,
  heisman_vote, coach_table, coach_award, broyles_table, ol_units, _slot_pool, select_team, all_america,
  all_conference, _rng, conference_awards, national_awards, postseason_awards, my_awards, race_view,
};

modules.awards = awards;
