// A league's teams as the play engine reads them: each team in the source format (a career's league.js makes it from
// the league: every player's card numbers) converted to the engine's roster format. The first season's teams are not
// built: they are the roster file, read by rosters.js with these same formulas.
//
// What the engine plays with, from a player's card numbers:
//
//     speed            0.7 speed + 0.3 acceleration
//     strength         strength (RB: average with trucking and stiff arm)
//     intelligence     awareness (defense: average of awareness and play recognition)
//     endurance        stamina
//     QB passing       0.3 short + 0.35 mid + 0.2 deep accuracy + 0.15 throw power
//     QB decisions     his own Decision Making
//     RB elusiveness   agility, juke, spin, break tackle, change of direction
//     RB vision        ball carrier vision
//     WR/TE hands      catching, catch in traffic, spectacular catch
//     WR/TE routes     short, medium, deep route running, release
//     OL run block     run block, run block power, run block finesse
//     OL pass block    pass block, pass block power, pass block finesse
//     DL/LB rushing    power moves, finesse moves, block shedding
//     tackling         tackle, pursuit (LB: also hit power)
//     coverage         man coverage, zone coverage
//     K / P            kick power, kick accuracy
//
// Each is put against the average FBS starter at his position (card numbers, frozen: game_scale's starter_means):
// the engine reads card points over that average, so a 0 is an average starter wherever he plays and a point is a
// card point. His card's attributes go the same way (game_scale's attribute_means).
import { round, int, sum, sorted, minBy, maxBy, get, isNumber, truthy, cmp, fmt, pyfloat } from "../engine_js/pyrt.js";
import { mean, median, pstdev } from "../engine_js/pystat.js";
import { read_json, env } from "../engine_js/files.js";
import { modules } from "../engine_js/modules.js";
import { game_scale } from "./game_scale.js";
import { ratings as rv2 } from "./ratings.js";   // ratings v2: the player attributes (docs/RATINGS_V2.md)
import { recruits, pypow } from "../career_js/recruits.js";

const ROOT = ".";   // the project root: files.js reads paths from it

// What the play engine reads for a player: card points over the average FBS starter at his position (each position's
// averages are card numbers, game_scale's starter_means), so a 0 is an average starter wherever he plays and a point
// is a card point.
// Diminishing returns at the top (team_level): of a team's talent above the FBS starter average,
// only this share counts. Through week 8 of 2026 a point of rating gap was worth 1.4 real points
// of margin between Power 4 teams and 3.1 between Group of Five teams; the sim paid 2.0 in both,
// so Power 4 margins ran 1.5x too wide (real on sim margin slope 0.58-0.70) while Group of Five
// margins were right (0.95-1.02). BUILD_TOP_SCALE=1 builds without it (for before/after tests).
const TEAM_LEVEL_TOP_SCALE = Number(env.BUILD_TOP_SCALE !== undefined ? env.BUILD_TOP_SCALE : "0.70");

// EA position -> the engine's position
const POSITION_MAP = {
  QB: "QB", HB: "RB", FB: "RB", WR: "WR", TE: "TE",
  LT: "OL", LG: "OL", C: "OL", RG: "OL", RT: "OL",
  LEDG: "DL", REDG: "DL", DT: "DL",
  MIKE: "MLB", WILL: "ROLB", SAM: "LOLB",
  CB: "CB", FS: "S", SS: "S", K: "K", P: "P",
};
const OFFENSE = new Set(["QB", "RB", "WR", "TE", "OL", "K", "P"]);

const OFF_STATS = ["pass_attempts", "completions", "pass_yards", "interceptions_thrown", "sacks_taken",
  "carries", "rush_yards", "fumbles", "receptions", "receiving_yards", "targets",
  "passing_touchdowns", "receiving_touchdowns", "rushing_touchdowns", "solo_tackles",
  "assisted_tackles", "fg_attempted", "fg_made", "pat_attempts", "pat_made"];
const DEF_STATS = ["solo_tackles", "assisted_tackles", "sacks", "interceptions", "forced_fumbles"];
const SHARED_STATS = ["kickoff_returns", "kickoff_return_yards", "kickoff_return_touchdowns", "punt_returns",
  "punt_return_yards", "punt_return_touchdowns", "defensive_touchdowns", "fumble_recoveries",
  "fumble_return_yards", "interception_return_yards", "punts", "punt_yards"];

// the school's name as people say it, not its legal name ("University of Notre Dame du Lac", "The
// Ohio State University", "Virginia Polytechnic Institute and State University")
const SCHOOL_DISPLAY = {
  "University of Notre Dame du Lac": "University of Notre Dame",
  "Rutgers, The State University of New Jersey": "Rutgers University",
  "Virginia Polytechnic Institute and State University": "Virginia Tech",
  "University of Illinois Urbana-Champaign": "University of Illinois",
  "The University of Tennessee, Knoxville": "University of Tennessee",
  "University of Maryland, College Park": "University of Maryland",
  "University of Massachusetts Amherst": "University of Massachusetts",
  "University of North Carolina at Chapel Hill": "University of North Carolina",
  "The University of Texas at Austin": "University of Texas",
  "California State University, Fresno": "Fresno State University",
  "California State University, Sacramento": "Sacramento State University",
};

// A data file that is read only when it exists: its parsed JSON, or null when the host has no such file.
function _file_or_null(path) {
  try {
    return read_json(path);
  } catch (e) {
    return null;
  }
}

export function display_school(name) {
  // A school's everyday name: the override table, else the legal name without a leading "The".
  const out = get(build_teams.SCHOOL_DISPLAY, name, name);
  return out.startsWith("The ") ? out.slice(4) : out;
}

// avg(r, *keys, default=50.0): `keys` is an array here, the default after it.
export function avg(r, keys, default_ = game_scale.MISSING) {
  const vals = [];
  for (const k of keys) if (isNumber(get(r, k))) vals.push(r[k]);
  return vals.length ? sum(vals) / vals.length : default_;
}

export function clamp_rating(x) {
  // A rating held to 1-99 and rounded.
  return int(round(Math.max(1, Math.min(99, x))));
}

export function clamp_tendency(x) {
  // A coach tendency held to 0-100 and rounded.
  return int(round(Math.max(0, Math.min(100, x))));
}

export function edge(v, mean_) {
  // Card points over the average starter (`mean_`, a card number), to a tenth.
  return round(v - mean_, 1);
}

export function depth_key(p) {
  // Sort key for depth-chart order (a player without a depth goes last).
  return get(p, "depth") || 99;
}

export function _skills_at(r, pos, out) {
  // The attributes engine position `pos` plays with, from card numbers `r`, written into `out` (over the ones
  // every position shares). Its own function so rating a player at every position (ratings_at_every_position) does
  // not rebuild his whole card eleven times.
  if (pos === "QB") {
    out["passing"] = (0.3 * get(r, "throw_accuracy_short", game_scale.MISSING) + 0.35 * get(r, "throw_accuracy_mid", game_scale.MISSING)
                      + 0.2 * get(r, "throw_accuracy_deep", game_scale.MISSING) + 0.15 * get(r, "throw_power", game_scale.MISSING));
    out["decision_making"] = 0.6 * get(r, "awareness", game_scale.MISSING) + 0.4 * get(r, "throw_under_pressure", game_scale.MISSING);
    out["elusiveness"] = avg(r, ["agility", "juke_move", "break_sack"]);
    out["vision"] = get(r, "bc_vision", game_scale.MISSING);
    out["hands"] = get(r, "carrying", game_scale.MISSING);
  } else if (pos === "RB") {
    out["strength"] = avg(r, ["strength", "trucking", "stiff_arm"]);
    out["elusiveness"] = avg(r, ["agility", "juke_move", "spin_move", "break_tackle", "change_of_direction"]);
    out["vision"] = get(r, "bc_vision", game_scale.MISSING);
    out["hands"] = get(r, "catching", game_scale.MISSING);
    out["route_running"] = avg(r, ["short_route_running", "medium_route_running"]);
    out["run_blocking"] = get(r, "run_block", game_scale.MISSING);
    out["pass_blocking"] = get(r, "pass_block", game_scale.MISSING);
  } else if (pos === "WR" || pos === "TE") {
    out["hands"] = avg(r, ["catching", "catch_in_traffic", "spectacular_catch"]);
    out["route_running"] = avg(r, ["short_route_running", "medium_route_running", "deep_route_running", "release"]);
    out["elusiveness"] = avg(r, ["agility", "juke_move", "change_of_direction"]);
    out["vision"] = get(r, "bc_vision", game_scale.MISSING);
    out["run_blocking"] = avg(r, ["run_block", "impact_blocking"]);
    out["pass_blocking"] = get(r, "pass_block", game_scale.MISSING);
  } else if (pos === "OL") {
    out["run_blocking"] = avg(r, ["run_block", "run_block_power", "run_block_finesse"]);
    out["pass_blocking"] = avg(r, ["pass_block", "pass_block_power", "pass_block_finesse"]);
  } else if (pos === "DL") {
    out["intelligence"] = avg(r, ["awareness", "play_recognition"]);
    out["rushing"] = avg(r, ["power_moves", "finesse_moves", "block_shedding"]);
    out["tackling"] = avg(r, ["tackle", "pursuit"]);
    out["coverage"] = avg(r, ["zone_coverage", "man_coverage"]);
  } else if (pos === "MLB" || pos === "ROLB" || pos === "LOLB") {
    out["intelligence"] = avg(r, ["awareness", "play_recognition"]);
    out["rushing"] = avg(r, ["power_moves", "finesse_moves", "block_shedding"]);
    out["tackling"] = avg(r, ["tackle", "pursuit", "hit_power"]);
    out["coverage"] = avg(r, ["man_coverage", "zone_coverage"]);
  } else if (pos === "CB" || pos === "S") {
    out["intelligence"] = avg(r, ["awareness", "play_recognition"]);
    out["coverage"] = avg(r, ["man_coverage", "zone_coverage"]);
    out["tackling"] = avg(r, ["tackle", "pursuit"]);
    out["hands"] = get(r, "catching", game_scale.MISSING);
    out["rushing"] = avg(r, ["power_moves", "finesse_moves", "block_shedding"]);
  } else if (pos === "K") {
    out["kick_power"] = get(r, "kick_power", game_scale.MISSING);
    out["kick_accuracy"] = get(r, "kick_accuracy", game_scale.MISSING);
  } else if (pos === "P") {
    out["punt_power"] = get(r, "kick_power", game_scale.MISSING);
    out["punt_accuracy"] = get(r, "kick_accuracy", game_scale.MISSING);
  }
}

export function own_decision(p) {
  // A quarterback's own Decision Making, or null when he has none stored. It is a rating of its own (the player's
  // rule: every rating a card prints is one that is stored, and the sim plays that one): the roster file's "Decision
  // Making", and in a career the league's "dmv". Nothing of his Football IQ or his Pocket Poise is in it.
  const v = get(p, "dmv");
  return isNumber(v) ? Math.max(1, Math.min(99, v)) : null;
}

export function map_player(p, pos = null) {
  // A player's engine attributes in card numbers (before they are put against his position's average starters), at
  // his own position or, with `pos`, as if he played another engine position. `p["ratings"]`: his card numbers.
  const r = p["ratings"];
  pos = pos || get(build_teams.POSITION_MAP, p["position"]);
  if (pos === null) return {};
  const out = {
    "name": p["name"],
    "slug": p["slug"],
    "position": pos,
    "source_position": p["position"],
    "overall": p["overall"],
    // his overall (game_scale.overall on his card numbers): the player card's overall. The engine never reads it.
    "ovr": get(p, "ovr") !== null ? p["ovr"] : (game_scale.has_overall()
      ? game_scale.overall(r, p["position"], get(p, "dmv")) : null),
    // identity for awards and the roster view: FR, FRRS, SO, SORS, JR, JRRS, SR, SRRS
    "class": get(p, "class"),
    "height": get(p, "height"),
    "weight": get(p, "weight_lbs"),
    "jersey": get(p, "jersey"),
    "dev_trait": get(p, "dev_trait"),
    "speed": 0.7 * get(r, "speed", game_scale.MISSING) + 0.3 * get(r, "acceleration", game_scale.MISSING),
    "strength": get(r, "strength", game_scale.MISSING),
    "intelligence": get(r, "awareness", game_scale.MISSING),
    "endurance": get(r, "stamina", game_scale.MISSING),
    // Return rating: the EA kick-return skill plus the traits a returner uses.
    "return_rating": (0.35 * get(r, "kick_return", game_scale.MISSING) + 0.20 * get(r, "speed", game_scale.MISSING)
                      + 0.15 * get(r, "acceleration", game_scale.MISSING)
                      + 0.15 * avg(r, ["agility", "juke_move", "change_of_direction"])
                      + 0.10 * get(r, "bc_vision", game_scale.MISSING) + 0.05 * get(r, "carrying", game_scale.MISSING)),
  };
  _skills_at(r, pos, out);
  if (pos === "QB") {
    // his own Decision Making when he has one (every quarterback of the roster file and of a career's league); a
    // player who has none (another position's player rated as a quarterback, a save from before) keeps what
    // _skills_at gave him
    const own = own_decision(p);
    if (own !== null) out["decision_making"] = own;
  }
  return out;
}

const ATTRS = ["speed", "strength", "intelligence", "endurance", "passing", "decision_making", "elusiveness",
  "vision", "hands", "route_running", "run_blocking", "pass_blocking", "rushing", "tackling",
  "coverage", "kick_power", "kick_accuracy", "punt_power", "punt_accuracy"];
// Return rating is centred on the league's designated returners rather than per position.
const RETURN_ATTR = "return_rating";

// Held inside sensible bounds (overnight review, bug 8): against his position's average starters an ordinary value
// is an extreme one when the position's starters bunch (linemen far above average in coverage, a few starting
// receivers far below in route running). A skill a position does not use is held to OFF_SKILL_RANGE; a core
// skill (CORE_SKILLS, below) of an established player (his card's ratings averaging CORE_FLOOR_OVR or more) keeps
// CORE_FLOOR.
// Speed, strength, intelligence and endurance are left alone.
const PHYSICAL = ["speed", "strength", "intelligence", "endurance"];   // every position uses these
const OFF_SKILL_RANGE = [-12, 12];           // card points either side of the position's average starter
const CORE_FLOOR = -14, CORE_FLOOR_OVR = 60;  // *tune* card points under the average starter; his card's ratings averaging 60 or more
const CLAMP_EXTREMES = !env.BUILD_NO_CLAMP;   // BUILD_NO_CLAMP=1 builds without it (for before/after tests)

// -> a Set of slugs
export function starter_slugs(team) {
  const out = new Set();
  for (const unit of ["offense", "defense"]) {
    for (const slugs of Object.values(team["starters"][unit])) {
      for (const s of slugs) out.add(s);
    }
  }
  return out;
}

export function team_from_source(t) {
  // One team in the source format (cfb_sim_data/teams/*.json, or a career's league.js
  // rebuild of it) converted for the build.
  const starters = starter_slugs(t);
  const st_special = t["starters"]["special_teams"];
  // depth-chart role (LT, LG, C, RG, RT, LEDG, DT, REDG, SAM, MIKE, WILL, CB, FS, SS, HB, ...)
  // and depth order, for awards that go by sub-position (center, edge, interior, tackle)
  const roles = new Map();
  for (const [role, slugs] of Object.entries(get(t, "depth_chart") || {})) {
    (slugs || []).forEach((slug, i) => {
      if (!roles.has(slug)) roles.set(slug, [role, i + 1]);
    });
  }
  const players = [];
  for (const p of t["roster"]) {
    const m = map_player(p);
    if (!Object.keys(m).length) continue;
    m["starter"] = starters.has(p["slug"]);
    [m["role"], m["depth"]] = roles.has(p["slug"]) ? roles.get(p["slug"]) : [null, null];
    m["_src"] = p;
    // his ratings as card numbers (game_scale.keys() order), what comps and the card overall read
    m["skills"] = truthy(get(p, "skills")) ? p["skills"] : game_scale.keys().map((k) => get(p["ratings"], k, game_scale.MISSING));
    if (get(p, "target_mult") !== null) {          // a career's league: his share of targets, kept with him
      m["target_mult"] = p["target_mult"];
    }
    // ratings v2: his card's attributes in card numbers (set_attributes puts them against his group's average
    // starters), the measurables, the earned traits and the play style
    m["_attr_raw"] = rv2.raw_attributes(p["ratings"], m["position"], m["role"]);
    if (isNumber(get(m["_attr_raw"], "decision_making"))) {       // his own Decision Making (own_decision above)
      const own = own_decision(p);
      if (own !== null) {
        m["_attr_raw"]["decision_making"] = own;
        m["dmv"] = own;
      }
    }
    m["height_in"] = rv2.height_inches(get(p, "height"));
    m["traits"] = rv2.traits_of(get(p, "abilities") || []);
    m["archetype"] = get(rv2.ARCHETYPES, get(p, "archetype") || "", get(p, "archetype"));
    // the engine finds K and P among in-game offense players
    if (m["position"] === "K" || m["position"] === "P") {
      m["starter"] = get(st_special, m["position"], []).includes(p["slug"]);
    }
    players.push(m);
  }
  const hc = t["coaches"]["head_coach"], oc = t["coaches"]["offensive_coordinator"], dc = t["coaches"]["defensive_coordinator"];
  // Returners are roles, not roster slots: a starter can also return kicks.
  const kr_list = get(st_special, "KR"), pr_list = get(st_special, "PR");
  const kr = (truthy(kr_list) ? kr_list : [null])[0];
  const pr = (truthy(pr_list) ? pr_list : [null])[0];
  const colors = {};
  for (const [k, v] of Object.entries(t["colors"])) colors[k] = truthy(v) ? v["hex"] : null;
  return {
    "kick_returner": kr,
    "punt_returner": pr,
    "tendencies": {
      "pass_rate": get(oc["tendencies"], "pass_rate", 50),
      "tempo": get(oc["tendencies"], "tempo", 50),
      "fourth_down_go_rate": get(hc["tendencies"], "fourth_down_go_rate", 50),
      "blitz_rate": get(dc["tendencies"], "blitz_rate", 50),
      "oc_play_calling": get(oc["ratings"], "play_calling", 70),
      "dc_play_calling": get(dc["ratings"], "play_calling", 70),
      // coach styles: what the coordinators like to call and the head coach's discipline
      "deep_shot_rate": get(oc["tendencies"], "deep_shot_rate", 50),
      "play_action_rate": get(oc["tendencies"], "play_action_rate", 50),
      "man_coverage_rate": get(dc["tendencies"], "man_coverage_rate", 50),
      "press_rate": get(dc["tendencies"], "press_rate", 50),
      "discipline": get(hc["ratings"], "discipline", 70),
      ...(get(t, "rb_lead_feature") !== null ? { "rb_lead_feature": t["rb_lead_feature"] } : {}),
    },
    "slug": t["slug"],
    "name": t["short_name"],
    "school": display_school(t["school_name"]),
    "abbreviation": t["abbreviation"],
    "mascot": get(t, "mascot") || "",          // the FCS stand-ins have none
    "conference": t["conference"],
    "subdivision": t["subdivision"],
    "city": get(t, "city"),
    "state": get(t, "state"),
    "fictional": t["fictional"],
    "colors": colors,
    "stadium": t["stadium"],
    "home_field_advantage": t["program"]["home_field_advantage"],
    "prestige": t["program"]["prestige"],
    "team_ratings": t["team_ratings"],
    "coaches": {
      "head_coach": { "name": hc["name"], "ratings": hc["ratings"], "tendencies": hc["tendencies"], "scheme": hc["scheme"],
        "since": get(hc, "since") },
      "offensive_coordinator": { "name": get(oc, "name"), "ratings": oc["ratings"], "tendencies": oc["tendencies"], "scheme": oc["scheme"] },
      "defensive_coordinator": { "name": get(dc, "name"), "ratings": dc["ratings"], "tendencies": dc["tendencies"], "scheme": dc["scheme"] },
    },
    "players": players,
  };
}

const TENDENCY_KEYS = ["pass_rate", "tempo", "fourth_down_go_rate", "blitz_rate", "oc_play_calling", "dc_play_calling",
  "deep_shot_rate", "play_action_rate", "man_coverage_rate", "press_rate", "discipline"];

export function normalize_tendencies(teams) {
  // Centre the generated coach tendencies so the FBS average is 50 (the engine's
  // neutral), keeping each team's distance from the pack. Service academies stay run-heavy.
  const means = {};
  for (const key of build_teams.TENDENCY_KEYS) {
    const vals = teams.filter((t) => !t["fictional"]).map((t) => t["tendencies"][key]);
    means[key] = mean(vals);
    for (const t of teams) {
      t["tendencies"][key] = clamp_tendency(50 + t["tendencies"][key] - means[key]);
    }
  }
  const out = {};
  for (const [k, v] of Object.entries(means)) out[k] = round(v, 1);
  return out;
}

export function decouple_discipline(teams) {
  // Keep only the part of the head coach's discipline that the team's talent does not
  // already explain. The source ratings give better programs more disciplined coaches
  // (r about 0.7 with team overall), and the players' Football IQ already lowers penalties
  // for those teams; using the raw rating counted that edge twice and spread margins too far.
  // Returns the slope taken out (discipline points per overall point).
  const fbs = teams.filter((t) => !t["fictional"]);
  const xs = fbs.map((t) => t["team_ratings"]["overall"]);
  const ys = fbs.map((t) => t["tendencies"]["discipline"]);
  const mx = mean(xs), my = mean(ys);
  // ((x - mx) ** 2: the square worked out exactly, as recruits.pypow does; Math.pow can be a digit off the exact square)
  const slope = sum(xs.map((x, i) => (x - mx) * (ys[i] - my))) / sum(xs.map((x) => pypow(x - mx, 2)));
  for (const t of teams) {
    const fit = my + slope * (t["team_ratings"]["overall"] - mx);
    t["tendencies"]["discipline"] = clamp_tendency(50 + t["tendencies"]["discipline"] - fit);
  }
  return round(slope, 3);
}

const OBSERVED = "data/observed_tendencies.json";

const GAME_SCRIPT_PASS = 0.10;   // points of pass share credited back per point of a team's average margin
const FOURTH_PER_MARGIN = 0.013; // fourth-down tries a game added back per point of average margin (trailing teams try
                                 // more: the slope across FBS teams in 2026)
const PASS_RATE_SLOPE = 2.0;     // *tune* tendency points per point of observed pass share over the league's (1.67 left the sim's
                                 // pass share moving 0.82 for each real point: the pass-heaviest teams threw 3 a game too few)
const TEMPO_SLOPE = 3.8;         // *tune* tendency points per play a game over the league's (3.0: the sim's plays moved 0.68 a real one)
const SCRAMBLE_SHARE = 4.0;      // points of a team's rushes that are QB scrambles (the engine adds its own)

// `only`: a Set of slugs, or an array of them, or null.
export function apply_observed_tendencies(teams, only = null, styles = null) {
  // Replace generated coach tendencies with what each team has actually done in 2026
  // (derived from the real box scores), scaled to the engine's tendency effects. Teams without box
  // scores keep the generated values; so do teams not in `only` (when given). `styles`: a
  // team plays another real team's observed style (a career's new head coach brings one).
  const obs = _file_or_null(build_teams.OBSERVED);
  if (obs === null) return 0;
  const league = obs["league"], per_team = obs["teams"];
  const only_has = only === null || only === undefined ? null
    : (only instanceof Set ? (s) => only.has(s) : (s) => only.includes(s));
  let n = 0;
  for (const t of teams) {
    const o = get(per_team, get(styles || {}, t["slug"], t["slug"]));
    if (!truthy(o) || o["games"] < 2 || (only_has !== null && !only_has(t["slug"]))) continue;
    const td = t["tendencies"];
    // Game script: a team that leads a lot runs to protect leads, and the engine already
    // plays that out (it runs more when ahead), so the observed rate is credited back
    // GAME_SCRIPT_PASS points of pass share per point of average margin.
    const margin = get(o, "margin_per_game", 0.0);
    td["pass_rate"] = clamp_tendency(50 + build_teams.PASS_RATE_SLOPE * (o["pass_rate"] - league["pass_rate"] + build_teams.GAME_SCRIPT_PASS * margin));
    td["tempo"] = clamp_tendency(50 + build_teams.TEMPO_SLOPE * (o["plays_per_game"] - league["plays_per_game"]));
    // Fourth-down tries: a team that trails a lot tries more out of need, not choice
    // (Sac State 99, Texas A&M 100), so the attempts expected from its margin come off.
    const ratio = (o["fourth_att_per_game"] + build_teams.FOURTH_PER_MARGIN * margin) / Math.max(0.1, league["fourth_att_per_game"]);
    td["fourth_down_go_rate"] = clamp_tendency(50 + (ratio - 1) * 125);
    // Observed QB rushes include sacks (college convention) and scrambles; designed runs are the
    // rest: every quarterback's carries less the team's own sacks and about 4 points of scrambles
    // (the engine plays scrambles itself). A flat 10 points used to come off QB1's carries alone,
    // which left low-sack teams and run-package QB2s with almost no designed runs.
    if (o["qb_all_rush_share"] !== undefined) {
      td["qb_run_share"] = round(Math.max(0.0, o["qb_all_rush_share"] - o["sack_share"] - build_teams.SCRAMBLE_SHARE), 1);
    } else {
      td["qb_run_share"] = round(Math.max(0.0, o["qb_rush_share"] - 6.0 - build_teams.SCRAMBLE_SHARE), 1);
    }
    // Backfield split: the top back's average share of the team's running back carries in a
    // game (and the second back's). roster.Team._lead_profile turns rb1_share into the lead
    // back's feature score, so a team that rides one back does so in the sim.
    td["rb1_share"] = o["rb1_share"];
    td["rb2_share"] = o["rb2_share"];
    td["observed"] = true;
    n += 1;
  }
  return n;
}

const LB_ROLES = ["SAM", "MIKE", "WILL"];

export function depth_sort(t) {
  // Put a team's roster in depth-chart order (the source lists are not), so the engine's
  // list-order tie-breaks follow the depth chart: depth, then linebacker pool order, then the
  // better player first.
  const key = (p) => [get(p, "depth") || 99, get(p, "order") || 99, -(get(p, "overall") || 0)];
  t["players"].sort((a, b) => cmp(key(a), key(b)));
}

export function established(p) {
  // Whether the core-skill floor is his (CORE_FLOOR_OVR): the mean of the ratings his position's card shows, at the
  // position they were made for (never his overall: its formula can be refit without moving an engine number).
  if (!truthy(get(p, "skills"))) return false;
  const keys = game_scale.keys(), on_card = game_scale.position_skills(p["source_position"]);
  const vals = [];
  for (let i = 0; i < Math.min(keys.length, p["skills"].length); i++) if (on_card.has(keys[i])) vals.push(p["skills"][i]);
  return vals.length > 0 && mean(vals) >= build_teams.CORE_FLOOR_OVR;
}

export function clamp_extremes(p) {
  // Hold normalized attributes inside sensible bounds (see CORE_SKILLS).
  if (!build_teams.CLAMP_EXTREMES) return;
  const core = get(build_teams.CORE_SKILLS, get(p, "position"), []);
  const [lo, hi] = build_teams.OFF_SKILL_RANGE;
  let floored = null;                    // asked once, and only of a player with a core skill under the floor
  for (const a of build_teams.ATTRS) {
    const v = get(p, a);
    if (!isNumber(v) || (build_teams.PHYSICAL.includes(a) && !core.includes(a))) continue;
    if (core.includes(a)) {
      if (v < build_teams.CORE_FLOOR) {
        floored = floored === null ? established(p) : floored;
        if (floored) p[a] = build_teams.CORE_FLOOR;
      }
    } else {
      p[a] = Math.max(lo, Math.min(hi, v));
    }
  }
}

const P4_CONFERENCES = new Set(["ACC", "Big Ten", "Big 12", "SEC"]);
export function _attr_group(p) {
  // The group a player's card attributes are put against (fullbacks against the backs).
  const g = rv2.card_group(p["position"], get(p, "role"));
  return g === "FB" ? "RB" : g;
}

export function attributes_of(p) {
  // One player's card attributes as the engine reads them: card points over the average FBS starter in his card group
  // (game_scale's attribute_means), a tenth at a time.
  const out = {};
  const g = _attr_group(p), means = get(game_scale.data(), "attribute_means") || {};
  for (const [k, v] of Object.entries(get(p, "_attr_raw") || {})) out[k] = edge(v, get(means, `${g}|${k}`, v));
  return out;
}

export function set_attributes(teams) {
  for (const t of teams) for (const p of t["players"]) p["attributes"] = attributes_of(p);
}

export function normalize(teams, frozen = null) {
  // Every engine attribute as card points over the average FBS starter at his position: the frozen averages
  // (game_scale's starter_means, "POS:attr" -> a card number), or with `frozen` false this build's own starters'
  // (the roster file's, to measure them). The return rating is put against the league's designated returners.
  const ATTRS_ = build_teams.ATTRS, RETURN = build_teams.RETURN_ATTR;
  let means = frozen === false ? null : { ...(truthy(frozen) ? frozen : game_scale.starter_means()) };
  if (means === null) {
    const groups = new Map();
    for (const t of teams) {
      if (t["fictional"]) continue;
      for (const p of t["players"]) {
        if (!p["starter"]) continue;
        for (const a of ATTRS_) if (p[a] !== undefined) {
          const k = `${p["position"]}:${a}`;
          if (!groups.has(k)) groups.set(k, []);
          groups.get(k).push(p[a]);
        }
      }
    }
    means = {};
    for (const [k, v] of sorted([...groups.entries()], (e) => e[0])) means[k] = round(mean(v), 1);
    const returners = [];
    for (const t of teams) {
      if (t["fictional"]) continue;
      for (const p of t["players"]) if (p["slug"] === t["kick_returner"] || p["slug"] === t["punt_returner"]) returners.push(p[RETURN]);
    }
    means[`returners:${RETURN}`] = returners.length ? round(mean(returners), 1) : game_scale.MISSING;
  }
  const return_mean = get(means, `returners:${RETURN}`, game_scale.MISSING);
  for (const t of teams) {
    for (const p of t["players"]) {
      for (const a of ATTRS_) if (p[a] !== undefined) p[a] = edge(p[a], get(means, `${p["position"]}:${a}`, p[a]));
      p[RETURN] = edge(p[RETURN], return_mean);
      clamp_extremes(p);
    }
  }
  return means;
}

export function team_level(teams) {
  // Diminishing returns at the top. A team's level is its starters' mean edge over their positions' average starters
  // across the engine attributes; above zero only TEAM_LEVEL_TOP_SCALE of it counts, and every player on the team
  // moves down by the rest (the same amount, so who is better than whom on the roster does not change). Returns
  // {slug: shift} in card points.
  const shifts = {};
  for (const t of teams) {
    const vals = [];
    for (const p of t["players"]) {
      if (!p["starter"]) continue;
      for (const a of build_teams.ATTRS) if (isNumber(get(p, a))) vals.push(p[a]);
    }
    const level = vals.length ? mean(vals) : 0.0;
    const shift = level > 0 ? -(1.0 - build_teams.TEAM_LEVEL_TOP_SCALE) * level : 0.0;
    t["level_shift"] = round(shift, 2);
    shifts[t["slug"]] = shift;
    if (shift) {
      for (const p of t["players"]) {
        for (const a of build_teams.ATTRS) if (isNumber(get(p, a))) p[a] = round(p[a] + shift, 1);
      }
    }
  }
  return shifts;
}

const ENGINE_POSITIONS = ["QB", "RB", "WR", "TE", "OL", "DL", "MLB", "CB", "S", "K", "P"];
const CORE_SKILLS = { QB: ["passing", "decision_making"], RB: ["elusiveness", "vision"], WR: ["hands", "route_running"], TE: ["hands", "run_blocking"],
  OL: ["run_blocking", "pass_blocking"], DL: ["rushing", "tackling"], MLB: ["tackling", "coverage"], CB: ["coverage"],
  S: ["coverage", "tackling"], K: ["kick_power", "kick_accuracy"], P: ["punt_power", "punt_accuracy"] };

// the EA position a player is rated at for each engine position (linebackers share the middle one's)
const RATED_AS = { QB: "QB", RB: "HB", WR: "WR", TE: "TE", OL: "LG", DL: "DT", MLB: "MIKE", CB: "CB", S: "FS", K: "K", P: "P" };

export function rated_at(m, pos) {
  // A player's overall at engine position `pos` (what he would be moved there: position_fit.project on his card
  // numbers, his build against the spot's); "KR" his Return Skill. At his own position it is his overall.
  const keys = game_scale.keys(), card = {};
  (get(m, "skills") || []).forEach((v, i) => { if (i < keys.length) card[keys[i]] = v; });
  if (pos === "KR") return get(card, "kick_return", game_scale.MISSING);
  if (pos === m["position"] && isNumber(get(m, "ovr"))) return m["ovr"];
  const to = get(build_teams.RATED_AS, pos, pos), pf = modules.position_fit;
  const own_pos = get(m, "source_position") || get(m, "role") || m["position"];
  return pf ? pf.project(card, get(m, "height_in"), get(m, "weight"), own_pos, to) : game_scale.overall(card, to);
}

export function ratings_at_every_position(teams) {
  // (A player's overall at another position is worked out when a page asks: rated_at.)
  for (const t of teams) for (const m of t["players"]) delete m["_src"];
}

export function measured_recruiting(teams) {
  // Rebuild each head coach's recruiting rating from how he has really recruited: his measured
  // edge (recruiting_model.json coaches.current), shrunk toward average for coaches with few
  // classes. The source ratings are generated and do not track it (r -0.02 across 78 coaches).
  // Coaches with no measured edge keep theirs. Returns how many were rebuilt.
  const current = recruits.model()["coaches"]["current"];
  let n = 0;
  for (const t of teams) {
    const c = get(current, t["slug"]);
    if (!truthy(c) || get(c, "edge") === null) continue;
    const shrunk = c["edge"] * c["classes"] / (c["classes"] + 3);
    t["coaches"]["head_coach"]["ratings"]["recruiting"] = Math.max(56, Math.min(97, round(70 + 24 * shrunk / 0.25)));
    n += 1;
  }
  return n;
}

// -> [offense, defense]
export function engine_roster(t) {
  // Split a converted team into the engine's offense and defense player lists.
  const offense = [], defense = [];
  for (const p of t["players"]) {
    const d = {};
    for (const [k, v] of Object.entries(p)) {
      if (k !== "starter" && k !== "overall" && k !== "_attr_raw") d[k] = v;   // "source_position" stays: game_scale.card_position
    }
    d["in_game"] = p["starter"];
    d["fatigue"] = 0;
    if (build_teams.OFFENSE.has(p["position"])) {
      d["stats"] = {};
      for (const k of build_teams.OFF_STATS.concat(build_teams.SHARED_STATS)) d["stats"][k] = 0;
      offense.push(d);
    } else {
      d["stats"] = {};
      for (const k of build_teams.DEF_STATS.concat(build_teams.SHARED_STATS)) d["stats"][k] = 0;
      defense.push(d);
    }
  }
  return [offense, defense];
}

// f"{x:.1f}": pyrt's fmt, with the minus sign Python keeps on a small negative number that rounds to zero ("-0.0").
const _fmt1 = (x) => { const t = fmt(x, 1); return (x < 0 || Object.is(x, -0)) && !t.startsWith("-") ? "-" + t : t; };
// Python's text of a float (repr): a whole one keeps its ".0".
const _float_text = (x) => (Number.isInteger(x) ? `${x}.0` : pyfloat(x));
// Python's text of a dict of floats, as print shows it: {'pass_rate': 50.3, 'tempo': 49.8}
const _dict_text = (d) => "{" + Object.entries(d).map(([k, v]) => `'${k}': ${_float_text(v)}`).join(", ") + "}";

// `observed`: a Set (or an array) of slugs, or null.
export function build(sources, real = true, observed = null, quiet = false, styles = null) {
  // The engine's teams file from source-format teams. `real`: centred on this league's own starter means and the
  // head coaches' recruiting ratings measured again; a career's seasons build without it (the frozen means).
  // `observed`: the teams whose observed 2026 tendencies still apply (None: all of them; a career drops a team's
  // when its head coach changes).
  const say = quiet ? () => null : (...a) => console.log(...a);
  const teams = sources.map((t) => team_from_source(t));
  const means = normalize(teams, real ? false : null);
  const shifts = team_level(teams);
  const moved = Object.values(shifts).filter((v) => v);
  if (!quiet) {
    say(`team level: ${moved.length} teams above the FBS starter average shifted `
      + `${_fmt1(minBy(Object.values(shifts)))} to ${_fmt1(moved.length ? maxBy(moved) : 0)} card points (top scale ${_float_text(build_teams.TEAM_LEVEL_TOP_SCALE)})`);
  }
  set_attributes(teams);
  for (const t of teams) depth_sort(t);
  ratings_at_every_position(teams);
  const tendency_means = normalize_tendencies(teams);
  decouple_discipline(teams);
  if (!quiet) say("league tendency means before centring:", _dict_text(tendency_means));
  const n_observed = apply_observed_tendencies(teams, observed, styles);
  say("teams with observed 2026 tendencies:", n_observed);
  if (real) {
    say("head coaches' recruiting ratings from their measured edge:", measured_recruiting(teams));
  }
  const out = { "team_level_top_scale": build_teams.TEAM_LEVEL_TOP_SCALE, "starter_means": means,
    "tendency_means": tendency_means, "teams": {} };
  for (const t of teams) {
    const [offense, defense] = engine_roster(t);
    const rec = {};
    for (const [k, v] of Object.entries(t)) if (k !== "players") rec[k] = v;
    rec["offense"] = offense;
    rec["defense"] = defense;
    out["teams"][t["slug"]] = rec;
  }
  return out;
}

export const build_teams = {
  ROOT, TEAM_LEVEL_TOP_SCALE, POSITION_MAP, OFFENSE, OFF_STATS, DEF_STATS, SHARED_STATS,
  SCHOOL_DISPLAY, display_school, avg, clamp_rating, clamp_tendency, edge, depth_key, _skills_at, own_decision, map_player,
  ATTRS, RETURN_ATTR, PHYSICAL, OFF_SKILL_RANGE, CORE_FLOOR, CORE_FLOOR_OVR, CLAMP_EXTREMES,
  starter_slugs, team_from_source, TENDENCY_KEYS, normalize_tendencies, decouple_discipline,
  OBSERVED, GAME_SCRIPT_PASS, FOURTH_PER_MARGIN, PASS_RATE_SLOPE, TEMPO_SLOPE, SCRAMBLE_SHARE, apply_observed_tendencies,
  LB_ROLES,
  depth_sort, established, clamp_extremes,
  P4_CONFERENCES, _attr_group, attributes_of, set_attributes,
  normalize, team_level, ENGINE_POSITIONS, CORE_SKILLS, RATED_AS, rated_at, ratings_at_every_position, measured_recruiting,
  engine_roster, build,
};

modules.build_teams = build_teams;
