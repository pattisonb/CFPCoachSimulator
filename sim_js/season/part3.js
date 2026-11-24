// The season, part 3: a week's work for the progress bar, injuries healing
// and the injury report, the awards step, the depth chart (its orders, cards and views), the formations view, the
// awards view, the shared pool, the week-by-week advance to a target, box-score files, and saving and loading a
// season (with the class file beside it). engine_js/PORTING.md ("Big Files in Parts") says how the parts share the namespace.
import { round, int, sorted, cmp, get, isNumber, truthy, json_dumps, parse_ordered } from "../../engine_js/pyrt.js";
import { read_text, write_text, exists, list_dir, mtime } from "../../engine_js/files.js";
import { modules } from "../../engine_js/modules.js";
import { formations } from "../../engine_js/api.js";
import * as game_job from "../game_job.js";
import { awards } from "../awards.js";
import { fcs_names } from "../fcs_names.js";
import { ValueError } from "../coaches.js";
import { ratings as ratings_v2 } from "../../teamdata_js/ratings.js";
import { shown as _shown } from "../../teamdata_js/shown.js";
import { game_scale } from "../../teamdata_js/game_scale.js";
import { season } from "../season_ns.js";

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const is_dict = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
/** str(v) inside an f-string for a value that may be None ("None", as the seeds and keys built from it have always had it). */
const pystr = (v) => (v === null || v === undefined ? "None" : v === true ? "True" : v === false ? "False" : String(v));
/** dict.clear(): in place, so whoever holds the dict sees it empty. */
const clear = (d) => { for (const k of Object.keys(d)) delete d[k]; };

// ----- sim progress ----------------------------------------------------------------------------
// A week's work by part, so the progress bar moves with the clock: a 90-game week is long, a
// one-game bowl week short, and the recruiting week after the games counts too. One unit is one
// simulated game (about 65 ms in one process); measured on a seeded career, one process and four.
season.PROGRESS_SETUP = 5;            // *tune* before the games: matchups, seeds, the games' payloads (~0.3 s)
season.PROGRESS_GAME = 1.0;           // *tune* one game with its box score and stats (~65 ms)
season.PROGRESS_POLLS = 2;            // *tune* the AP poll, the CFP rankings and the bracket (~0.05 s)
season.PROGRESS_AWARDS = 8;           // *tune* a week that hands out awards (~0.1-0.9 s)
season.PROGRESS_RECRUIT = 15;         // *tune* a recruiting week (~0.6-1.5 s)
season.PROGRESS_RECRUIT_FIRST = 40;   // *tune* week 1's recruiting week, which builds the boards (~2.6-3.5 s)
season.PROGRESS_RECRUIT_LATE = 25;    // *tune* championship and selection weeks' recruiting (~1.3-2.8 s)
season.PROGRESS_AHEAD = 1;            // *tune* setting the next postseason games after the week
season.PROGRESS_SAVE = 6;             // *tune* writing the season (~0.2-0.7 s)
season.PROGRESS_POSTSEASON_GAMES = { [season.CCG_WEEK]: 10, 17: 19, 18: 20, 19: 6, [season.FINAL_WEEK]: 1 };   // *tune* games a postseason week has before its matchups are set
season.PROGRESS_PARTS = ["setup", "games", "polls", "awards", "recruiting", "ahead", "save"];   // the order a week runs them
season.RECRUITING_STAGE = "Recruiting week";
season.SAVING_STAGE = "Saving";

function week_work(state, week, only_mine = false) {
  // The planned work of `week` by part (PROGRESS_PARTS), from the schedule as it stands:
  // the unplayed games (a postseason week not yet set counts the games it will have), the
  // polls, the awards, the recruiting week and the save. `only_mine`: game day (your game).
  let games = 0;
  for (const g of Object.values(state["games"])) if (g["week"] === week && !truthy(g["played"])) games += 1;
  if (truthy(only_mine)) return { setup: season.PROGRESS_SETUP, games: season.PROGRESS_GAME, save: season.PROGRESS_SAVE };
  if (has(season.PROGRESS_POSTSEASON_GAMES, week) && !(get(state, "matchups_set") || []).includes(week)) {
    games = Math.max(games, season.PROGRESS_POSTSEASON_GAMES[week]);
  }
  const out = { setup: games ? season.PROGRESS_SETUP : 1.0, games: games * season.PROGRESS_GAME };
  if (week <= season.CCG_WEEK || week === season.FINAL_WEEK) out["polls"] = season.PROGRESS_POLLS;
  if (has(season._AWARD_STAGES, week)) out["awards"] = season.PROGRESS_AWARDS;
  if (truthy(get(state, "recruiting"))) {
    out["recruiting"] = week === 1 ? season.PROGRESS_RECRUIT_FIRST
      : (week === season.CCG_WEEK || week === season.SELECTION_WEEK) ? season.PROGRESS_RECRUIT_LATE
        : season.PROGRESS_RECRUIT;
  }
  out["ahead"] = season.PROGRESS_AHEAD;
  out["save"] = season.PROGRESS_SAVE;
  return out;
}

function progress_part(stage, games_total) {
  // Which part of the week (PROGRESS_PARTS) a progress report's stage is. A matchup stage
  // after the games is the next week's games being set ("ahead"; the caller knows the order).
  if (games_total !== null && games_total !== undefined) return "games";
  if (stage === season.RECRUITING_STAGE) return "recruiting";
  if (stage === season.SAVING_STAGE) return "save";
  if (Object.values(season._AWARD_STAGES).includes(stage)) return "awards";
  if (truthy(stage) && ["Updating the", "Building the playoff", "Final AP poll"].some((s) => stage.startsWith(s))) return "polls";
  return "setup";
}

function _heal(state) {
  // One week passes: everyone on the injury list gets a week closer to returning.
  for (const [slug, lst] of Object.entries(get(state, "injuries", {}))) {
    for (const [key, inj] of Object.entries(lst)) {
      inj["weeks_left"] -= 1;
      if (inj["weeks_left"] <= 0) delete lst[key];
    }
    if (!Object.keys(lst).length) delete state["injuries"][slug];
  }
}

function injury_report(state, team = null) {
  // Current injuries, longest absences first; one team or the whole league (FBS only:
  // the FCS stand-ins' injuries are never listed).
  const teams = season.load_teams();
  if (truthy(team)) season.check_fbs(team);
  const fbs = season.fbs_only(teams);
  const out = [];
  for (const [slug, lst] of Object.entries(get(state, "injuries", {}))) {
    if ((truthy(team) && slug !== team) || !fbs.has(slug)) continue;
    for (const inj of Object.values(lst)) {
      out.push({ ...inj, team: slug, team_name: teams[slug]["name"], conference: teams[slug]["conference"],
        returns_week: state["current_week"] + inj["weeks_left"] });
    }
  }
  out.sort((a, b) => cmp([-a["weeks_left"], a["team_name"], a["name"]], [-b["weeks_left"], b["team_name"], b["name"]]));
  return out;
}

// the weeks awards are given, with the progress line shown while they are worked out
season._AWARD_STAGES = { [season.CCG_WEEK]: "Handing out the conference awards",
  [season.SELECTION_WEEK]: "Counting the Heisman vote and the national awards",
  [season.FINAL_WEEK]: "Handing out the postseason awards" };

function _award_step(state, teams, week) {
  // Conference awards after championship week, the Heisman and national awards in
  // selection week, the postseason awards after the title game.
  if (!has(state, "awards")) state["awards"] = {};
  const aw = state["awards"];
  const pool = new awards.Pool(state, teams, season._records(state, undefined, week === season.FINAL_WEEK));
  if (week === season.CCG_WEEK) aw["conference"] = awards.conference_awards(pool, state);
  else if (week === season.SELECTION_WEEK) aw["national"] = awards.national_awards(pool, state);
  else if (week === season.FINAL_WEEK) aw["postseason"] = awards.postseason_awards(pool, state);
  aw["given_through"] = week;
}

function player_overall(p) {
  // A display rating from the engine attributes that matter at the position.
  const pos = p["position"];
  let primary, secondary;
  if (pos === "K") [primary, secondary] = [["kick_power", "kick_accuracy"], []];
  else if (pos === "P") [primary, secondary] = [["punt_power", "punt_accuracy"], []];
  else if (pos === "QB") [primary, secondary] = [["passing", "decision_making", "intelligence"], ["speed", "elusiveness"]];
  else if (pos === "RB") [primary, secondary] = [["speed", "elusiveness", "vision", "strength"], ["hands", "pass_blocking"]];
  else if (pos === "WR" || pos === "TE") [primary, secondary] = [["hands", "route_running", "speed"], ["run_blocking", "elusiveness"]];
  else if (pos === "OL") [primary, secondary] = [["run_blocking", "pass_blocking", "strength"], ["intelligence"]];
  else if (pos === "DL") [primary, secondary] = [["rushing", "tackling", "strength"], ["intelligence", "speed"]];
  else if (pos === "MLB" || pos === "ROLB" || pos === "LOLB") [primary, secondary] = [["tackling", "rushing", "coverage", "speed"], ["intelligence"]];
  else [primary, secondary] = [["coverage", "speed", "tackling"], ["intelligence", "hands"]];
  let total = 0, count = 0;
  for (const k of primary) {
    if (isNumber(get(p, k))) {
      total += p[k] * 3;
      count += 3;
    }
  }
  for (const k of secondary) {
    if (isNumber(get(p, k))) {
      total += p[k];
      count += 1;
    }
  }
  return count ? round(total / count) : 0;
}

season.DEPTH_ROWS = [
  ["Offense", [["QB", "Quarterback"], ["HB", "Running Back"], ["FB", "Fullback"], ["WR", "Wide Receiver"], ["TE", "Tight End"],
    ["LT", "Left Tackle"], ["LG", "Left Guard"], ["C", "Center"], ["RG", "Right Guard"], ["RT", "Right Tackle"]]],
  ["Defense", [["LEDG", "Left Edge"], ["DT", "Defensive Tackle"], ["REDG", "Right Edge"], ["SAM", "Strongside LB"], ["MIKE", "Middle LB"],
    ["WILL", "Weakside LB"], ["CB", "Cornerback"], ["FS", "Free Safety"], ["SS", "Strong Safety"]]],
  ["Special Teams", [["K", "Kicker"], ["P", "Punter"], ["KR", "Kick Returner"], ["PR", "Punt Returner"]]],
];

// (sim_js/game_job.js has these two tables and apply_depth: one copy)
season.ROLE_POSITION = game_job.ROLE_POSITION;
season.OFFENSE_POSITIONS = game_job.OFFENSE_POSITIONS;
season.RATING_KEY = { MLB: "MLB", ROLB: "MLB", LOLB: "MLB" };   // linebacker roles share one rating

function overall_at(p, pos) {
  // A player's rating at an engine position (his own, or another one he could be moved to).
  const ra = get(p, "ratings_at") || {};
  const key = get(season.RATING_KEY, pos, pos);
  if (has(ra, key)) return int(ra[key]);
  return pos === p["position"] ? season.player_overall(p) : 0;
}

// A copy of the team with the season's depth-chart changes applied. Players named in an
// overridden role take that role (and its position, even from another position group),
// in the saved order; every role then starts its usual number of players (three
// receivers, two tackles, one everywhere else). KR and PR overrides pick the returner.
const apply_depth = game_job.apply_depth;

// the attributes the depth chart's list view shows for each role, most telling first
season._OL_COLUMNS = ["strength", "drive_block", "reach_block", "pass_anchor", "pass_footwork", "football_iq"];
season._DL_COLUMNS = ["strength", "burst", "power_rush", "speed_rush", "block_shedding", "tackling", "pursuit"];
season._LB_COLUMNS = ["top_speed", "tackling", "pursuit", "diagnosis", "block_shedding", "zone_coverage", "man_coverage"];
season._S_COLUMNS = ["top_speed", "zone_coverage", "man_coverage", "diagnosis", "tackling", "hit_power", "ball_skills"];
season._RET_COLUMNS = ["return_skill", "top_speed", "burst", "agility", "elusiveness"];
season.DEPTH_COLUMNS = {
  QB: ["arm_strength", "short_accuracy", "mid_accuracy", "deep_accuracy", "pocket_poise", "decision_making", "top_speed"],
  HB: ["top_speed", "burst", "agility", "run_vision", "elusiveness", "power_running", "ball_security"],
  FB: ["lead_block", "drive_block", "power_running", "strength", "hands", "ball_security"],
  WR: ["top_speed", "burst", "hands", "contested_catch", "short_routes", "mid_routes", "deep_routes", "release"],
  TE: ["hands", "contested_catch", "short_routes", "release", "drive_block", "reach_block", "top_speed"],
  LT: season._OL_COLUMNS, LG: season._OL_COLUMNS, C: season._OL_COLUMNS, RG: season._OL_COLUMNS, RT: season._OL_COLUMNS,
  LEDG: season._DL_COLUMNS, DT: season._DL_COLUMNS, REDG: season._DL_COLUMNS,
  SAM: season._LB_COLUMNS, MIKE: season._LB_COLUMNS, WILL: season._LB_COLUMNS,
  CB: ["top_speed", "burst", "man_coverage", "zone_coverage", "press", "ball_skills", "tackling"],
  FS: season._S_COLUMNS, SS: season._S_COLUMNS,
  K: ["kick_power", "kick_accuracy", "football_iq"], P: ["punt_power", "punt_accuracy", "football_iq"],
  KR: season._RET_COLUMNS, PR: season._RET_COLUMNS,
};
season.COLUMN_SHORT = { top_speed: "SPD", burst: "ACC", agility: "AGI", strength: "STR", football_iq: "IQ",
  arm_strength: "THP", short_accuracy: "SAC", mid_accuracy: "MAC", deep_accuracy: "DAC",
  pocket_poise: "POI", decision_making: "DEC", run_vision: "VIS", elusiveness: "JUK",
  power_running: "POW", ball_security: "CAR", hands: "CTH", contested_catch: "CIT",
  short_routes: "SRR", mid_routes: "MRR", deep_routes: "DRR", release: "REL",
  drive_block: "RBP", reach_block: "RBF", pass_anchor: "PBP", pass_footwork: "PBF",
  lead_block: "LBK", power_rush: "PMV", speed_rush: "FMV", block_shedding: "BSH",
  tackling: "TAK", pursuit: "PUR", diagnosis: "PRC", man_coverage: "MCV",
  zone_coverage: "ZCV", press: "PRS", ball_skills: "BSK", hit_power: "POW",
  kick_power: "KPW", kick_accuracy: "KAC", punt_power: "KPW", punt_accuracy: "KAC",
  return_skill: "RET" };

function role_starters(team, role) {
  // How many players start at a role in the team's base formation (three receivers, two
  // tackles, none at a linebacker spot the scheme leaves out). Kickers and returners: one.
  if (["K", "P", "KR", "PR"].includes(role)) return 1;
  let n = 0;
  for (const p of [...team["offense"], ...team["defense"]]) if (get(p, "role") === role && truthy(get(p, "in_game"))) n += 1;
  return n;
}

function position_candidates(state, slug, role) {
  // Every player on the roster rated at one depth-chart role, best first, with where he
  // sits now, so anyone can be moved into that spot.
  season.check_fbs(slug);
  const team = season.apply_depth(season.team_data(state, slug), get(get(state, "depth") || {}, slug));
  const ss = get(get(get(state, "season_stats") || {}, slug, {}), "players", {});
  const injured = get(get(state, "injuries") || {}, slug, {});
  const yours = truthy(get(state, "career")) && slug === get(state, "team") && !truthy(get(state, "done"));
  const dev = season.development_reads(state, slug);
  const pos = (role === "KR" || role === "PR") ? "KR" : get(season.ROLE_POSITION, role, role);
  const current = season.depth_order(state, slug, role);
  const columns = get(season.DEPTH_COLUMNS, role, []);
  const moves = season.position_changes(state, slug);
  const rows = [];
  for (const p of [...team["offense"], ...team["defense"]]) {
    if (pos === "KR" && season.RETURN_POSITIONS_OUT.includes(p["position"]) && !current.includes(p["slug"])) {
      continue;                                  // linemen, quarterbacks and kickers never return (the engine agrees)
    }
    const rating = _shown.overall(pos === "KR" ? season.house_value("KR", "return_rating", season.return_value(p))
      : season.same_group(pos, p["position"]) ? season.shown_overall(p) : season.house_value(pos, "overall", season.overall_at(p, pos)));
    const rec = get(ss, `${p["name"]}|${p["position"]}`);
    const st = truthy(rec) ? rec["stats"] : {};
    const group = awards.Pool._group(p["position"], get(p, "role"), st) || p["position"];
    const row = { name: p["name"], slug: p["slug"], position: p["position"], role: get(p, "role"), depth: get(p, "depth"),
      class: get(p, "class"), height: get(p, "height"), weight: get(p, "weight"), jersey: get(p, "jersey"),
      rating, natural: season.page_overall(p), starter: truthy(get(p, "in_game")),
      in_role: current.includes(p["slug"]), spot: current.includes(p["slug"]) ? current.indexOf(p["slug"]) + 1 : null,
      games: truthy(rec) ? rec["games"] : 0, headline: truthy(st) ? awards.headline({ stats: st }, group) : "",
      ...get(dev, p["slug"], {}), archetype: get(p, "archetype"),
      moved_from: get(get(moves, get(p, "slug")) || {}, "from") };
    row["attrs"] = Object.fromEntries(columns.map((k) => [k, season.page_attribute(p, k, get(get(p, "attributes") || {}, k))]));
    const inj = get(injured, `${p["name"]}|${p["position"]}`);
    row["injury"] = truthy(inj) ? { type: inj["type"], weeks_left: inj["weeks_left"] } : null;
    if (yours) row["redshirt"] = season.redshirt_status(state, slug, p);
    rows.push(row);
  }
  rows.sort((a, b) => cmp([-a["rating"], a["name"]], [-b["rating"], b["name"]]));
  return { role, position: pos, players: rows, current, starters: season.role_starters(team, role),
    columns: columns.map((k) => ({ key: k, short: get(season.COLUMN_SHORT, k, k.slice(0, 3).toUpperCase()), label: ratings_v2.ATTRIBUTES[k][0] })) };
}

function depth_order(state, slug, role) {
  // The current order of a role, overrides applied.
  const team = season.apply_depth(season.team_data(state, slug), get(get(state, "depth") || {}, slug));
  if (role === "KR" || role === "PR") {
    const pick = get(team, role === "KR" ? "kick_returner" : "punt_returner");
    return truthy(pick) ? [pick] : [];
  }
  return sorted([...team["offense"], ...team["defense"]].filter((p) => get(p, "role") === role), (p) => get(p, "depth") || 99).map((p) => p["slug"]);
}

function set_depth_order(state, slug, role, order) {
  // Put a role's players in a new order (an auto reorder, or a swap of two spots): the
  // same players the role has now, nobody added or dropped.
  const current = season.depth_order(state, slug, role);
  const a = sorted(order), b = sorted(current);
  if (role === "KR" || role === "PR" || a.length !== b.length || a.some((s, i) => s !== b[i])) {
    throw new ValueError("the order must hold exactly the players at this role");
  }
  if (!has(state, "depth")) state["depth"] = {};
  if (!has(state["depth"], slug)) state["depth"][slug] = {};
  state["depth"][slug][role] = [...order];
}

function move_depth(state, slug, role, player, move) {
  // Move a player within his role: up, down, or to the top (the starter spot). KR and
  // PR take the named player as the returner.
  season.check_fbs(slug);
  const team = season.team_data(state, slug);
  const by_slug = {};
  for (const p of [...team["offense"], ...team["defense"]]) by_slug[p["slug"]] = p;
  if (!has(by_slug, player)) throw new ValueError("unknown player");
  if (!has(state, "depth")) state["depth"] = {};
  if (!has(state["depth"], slug)) state["depth"][slug] = {};
  const overrides = state["depth"][slug];
  if (role === "KR" || role === "PR") {
    overrides[role] = [player];
    return;
  }
  const order = season.depth_order(state, slug, role);
  if (!order.includes(player)) {
    // a player from any position group can be moved into the role; he leaves his old one
    for (const [other, lst] of Object.entries(overrides)) {
      if (other !== role && lst.includes(player)) lst.splice(lst.indexOf(player), 1);
    }
    order.push(player);
  }
  const i = order.indexOf(player);
  if (move === "top") order.unshift(order.splice(i, 1)[0]);
  else if (move === "up" && i > 0) [order[i - 1], order[i]] = [order[i], order[i - 1]];
  else if (move === "down" && i < order.length - 1) [order[i + 1], order[i]] = [order[i], order[i + 1]];
  overrides[role] = order;
}

function reset_depth(state, slug) {
  season.check_fbs(slug);
  delete (get(state, "depth") || {})[slug];
}

function _depth_card(state, slug) {
  // The depth chart's player card for one team: card(player, role) -> his class, size,
  // rating, season headline, form, injury, where he moved from this season and (your own
  // roster in a career) redshirt.
  season.check_fbs(slug);
  const teams = season.load_teams();
  const ss = get(get(get(state, "season_stats") || {}, slug, {}), "players", {});
  const base_by_slug = {};
  for (const x of [...teams[slug]["offense"], ...teams[slug]["defense"]]) base_by_slug[get(x, "slug")] = x;
  const injured = get(get(state, "injuries") || {}, slug, {});
  const yours = truthy(get(state, "career")) && slug === get(state, "team") && !truthy(get(state, "done"));   // your roster: redshirt in place
  const moves = season.position_changes(state, slug);
  const dev = season.development_reads(state, slug);                     // your roster: coachability and potential
  const looks = season.player_faces(state, slug);                        // faces drawn this season (Edit Player Look)

  // (career_js/promises.js, reached only for your own team in a career)
  const chips = truthy(get(state, "career")) && slug === get(state, "team") ? modules.promises.tags_now(state) : {};   // a promised start: On Track, Slipping, Broken, Not Judged Yet, Next Season
  function card(p, role) {
    const inj = get(injured, `${p["name"]}|${p["position"]}`);
    const rec = get(ss, `${p["name"]}|${p["position"]}`);
    const st = truthy(rec) ? rec["stats"] : {};
    let group = awards.Pool._group(p["position"], get(p, "role"), st) || p["position"];
    if (role === "KR" || role === "PR") group = "RS";
    const out = { name: p["name"], slug: get(p, "slug"), position: p["position"], role: get(p, "role"), depth: get(p, "depth"), class: get(p, "class"),
      promise: get(chips, get(p, "slug")),
      height: get(p, "height"), weight: get(p, "weight"), jersey: get(p, "jersey"), overall: season.page_overall(p, get(base_by_slug, get(p, "slug"))),
      starter: truthy(get(p, "in_game")), games: truthy(rec) ? rec["games"] : 0,
      ...get(dev, get(p, "slug"), {}), archetype: get(p, "archetype") };
    out["form"] = season.morale_on(state) ? round(season.player_form(state, slug, p["name"], p["position"]), 2) : 0.0;
    out["headline"] = truthy(st) ? awards.headline({ stats: st }, group) : "";
    out["injury"] = truthy(inj) ? { type: inj["type"], weeks_left: inj["weeks_left"], returns_week: state["current_week"] + inj["weeks_left"] } : null;
    out["moved_from"] = get(get(moves, get(p, "slug")) || {}, "from");
    out["face"] = get(looks, get(p, "slug"));
    if (yours) out["redshirt"] = season.redshirt_status(state, slug, p);
    return out;
  }
  return card;
}

function _players_by_role(t, players) {
  // A team's players at each role in depth order (his depth, then the better player first), and its kick and punt
  // returner as the KR and PR roles. The Depth Chart and the practice field's roster link read the same order.
  const by_role = {};
  for (const p of players) {
    if (truthy(get(p, "role"))) {
      if (!has(by_role, p["role"])) by_role[p["role"]] = [];
      by_role[p["role"]].push(p);
    }
  }
  for (const [role, group] of Object.entries(by_role)) {
    by_role[role] = sorted(group, (p) => [get(p, "depth") || 99, -season.player_overall(p)]);
  }
  for (const [role, key] of [["KR", "kick_returner"], ["PR", "punt_returner"]]) {
    by_role[role] = players.filter((p) => get(p, "slug") === get(t, key));
  }
  return by_role;
}

function depth_changed(state, slug) {
  // Whether the team's depth chart differs from the one it started with (the Reset Chart button): moves that put
  // everyone back where he was leave it unchanged, whatever is stored.
  const overrides = get(get(state, "depth") || {}, slug);
  if (!truthy(overrides)) return false;

  function chart(t) {
    const out = {};
    for (const [role, group] of Object.entries(season._players_by_role(t, [...t["offense"], ...t["defense"]]))) {
      if (group.length) out[role] = group.map((p) => p["slug"]);
    }
    return out;
  }

  const base = season.team_data(state, slug);
  const a = chart(season.apply_depth(base, overrides)), b = chart(base);
  // (two dicts of lists are equal: the same roles, whatever their order, each with the same slugs in the same order)
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return true;
  for (const role of ka) {
    if (!has(b, role) || a[role].length !== b[role].length || a[role].some((s, i) => s !== b[role][i])) return true;
  }
  return false;
}

function depth_chart_view(state, slug) {
  // A team's depth chart: every role in formation order, every player at it in depth order, with
  // class, size, rating and the player's season headline.
  season.check_fbs(slug);
  const overrides = get(get(state, "depth") || {}, slug);
  const t = season.apply_depth(season.team_data(state, slug), overrides);
  const players = [...t["offense"], ...t["defense"]];
  const card = season._depth_card(state, slug);
  const by_role = season._players_by_role(t, players);

  const units = [];
  for (const [unit, rows] of season.DEPTH_ROWS) {
    const out_rows = [];
    for (const [role, label] of rows) {
      const group = get(by_role, role, []);
      if (!group.length) continue;
      out_rows.push({ role, label, starters: season.role_starters(t, role), players: group.map((p) => card(p, role)) });     // everyone at the role: a cap of six hid a seventh receiver, and a player moved back to a deep room
    }
    units.push({ name: unit, rows: out_rows });
  }
  const hc = get(get(t, "coaches") || {}, "head_coach") || {};
  const unit_ratings = season._unit_overalls(state, slug);
  return { team: slug, name: t["name"], conference: t["conference"], head_coach: get(hc, "name"),
    ratings: truthy(unit_ratings) ? unit_ratings : {}, roster_size: players.length, units,
    overridden: season.depth_changed(state, slug), editable: true };
}

// the trait tiers by name, for a roster link's abilities (teamdata_js/ratings.js TRAIT_TIERS)
season._TIER_NAMES = Object.fromEntries(Object.entries(ratings_v2.TRAIT_TIERS).map(([k, v]) => [v, k]));

const _WHOLE = /^\s*[+-]?\d+(?:_\d+)*\s*$/;      // what Python's int(text) takes

function _playlink_playbook(state, slug) {
  // A team's formations for a roster link (formations_view, each slot as the player's slug): {"offense", "defense",
  // "special": {"scheme", "formations": [{id, name, personnel, note, usage, slots: [{slot, label, slug}]}]}}. null
  // when the view cannot be made for the team.
  let view;
  try {
    view = season.formations_view(state, slug);
  } catch (err) {
    return null;
  }
  const out = {};
  for (const unit of ["offense", "defense", "special"]) {
    const u = get(view, unit) || {};
    out[unit] = { scheme: get(u, "scheme"), formations: (get(u, "formations") || []).map((f) => ({
      id: f["id"], name: f["name"], personnel: get(f, "personnel"), note: get(f, "note"),
      ...(get(f, "usage") !== null ? { usage: f["usage"] } : {}),
      slots: (get(f, "slots") || []).map((s) => ({ slot: s["slot"], label: s["label"], slug: get(get(s, "player") || {}, "slug") })) })) };
  }
  return out;
}

function playlink_team(state, slug) {
  // One team in the shape of a Pocket Franchise roster link (the reader is pocket-franchise lib/game/roster-link.ts,
  // which keeps the fields it knows and drops the rest): the depth chart as this season has it, starter first, and
  // every player with his current skills (the 54, after development, on the scale the game shows: the roster file's
  // and the card's numbers, never the kept ones) and what his card shows. `_position`
  // and `_look` (a face from Edit Player Look) are for the page, which draws his face from them. A read only: no sim.
  // An FCS stand-in has a full roster too (the sim plays it), so it can be played against on the field.
  //
  // Beside the roster, what the sim itself takes into a game (the player's ask: the field gets what the sim gets):
  //   the team:   "morale" (its mood, -1 to 1; null with the setting off), "home_field" (its stadium's advantage, 50
  //               ordinary) and "stadium", "coaches" (the three: name, ratings, tendencies, scheme; your own coach
  //               when it is your team), "tendencies" (how it calls a game: pass rate, tempo, fourth downs, blitz...),
  //               "playbook" (its schemes and the formations it lines up in most, each slot a player), "out" (who is
  //               unavailable: the injured and the redshirting);
  //   a player:   "card" (his card's ratings by the names the card prints, the numbers it shows),
  //               "form" (his hot or cold streak, -1 to 1) and "factor" (what the sim multiplies his ratings by
  //               entering the game: his form and his team's mood together, 0.9 to 1.1; the skills sent are his plain
  //               ones, without it), "injury" ({type, weeks_left}) or "redshirting", and "fatigue" (the season
  //               carries none between games: every player starts a game fresh, so it is 0).
  const t = season.apply_depth(season.team_data(state, slug), get(get(state, "depth") || {}, slug));
  const players = [...t["offense"], ...t["defense"]];
  const depth = {};
  for (const [role, group] of Object.entries(season._players_by_role(t, players))) {
    if (group.length) depth[role] = group.map((p) => p["slug"]);
  }

  const looks = season.player_faces(state, slug);
  const mood = season.morale_payload(state, slug);                        // null with the setting off
  const hurt = get(get(state, "injuries") || {}, slug) || {};             // "Name|POS" -> the injury
  const sitting = get(get(state, "redshirting") || {}, slug) || {};
  const sits = new Set(Object.values(sitting).map((v) => `${v["name"]}|${v["position"]}`));

  function player(p) {
    // his 54 skills as the game shows them (the one scale: the roster file's numbers, the card's numbers), in
    // game_scale.keys() order: the file's own number while his skill is still the one the file gave him, as the page
    // shows it (season.all_skills)
    const ks = game_scale.keys(), grp = game_scale.group(get(p, "role") || p["position"]);
    const from_file = truthy(get(p, "filed"));
    const skills = (get(p, "skills") || []).map((v, i) => {
      const filed = from_file ? modules.rosters.shown_skill(p, ks[i], v) : null;
      return filed !== null ? filed : _shown.skill(v, grp, ks[i]);
    });
    const out = { slug: p["slug"], name: p["name"], pos: get(p, "role") || p["position"], skills };
    const who = `${p["name"]}|${p["position"]}`;
    out["form"] = mood === null ? 0 : round(get(mood["players"], who, 0.0), 3);
    out["factor"] = round(season.morale_factor(state, slug, p["name"], p["position"]), 3);
    out["fatigue"] = get(p, "fatigue", 0) || 0;
    const inj = get(hurt, who);
    if (truthy(inj)) out["injury"] = { type: get(inj, "type"), weeks_left: get(inj, "weeks_left") };
    if (sits.has(who)) out["redshirting"] = true;
    // for the page to draw his face from (lookOf: a saved look, else rolled from slug and position); it puts the
    // pocket-faces face and skin on the link and drops these two
    out["_position"] = p["position"];
    if (truthy(get(looks, p["slug"]))) out["_look"] = looks[p["slug"]];
    // int(p.get("jersey")), skipped when it is not a number (Python's TypeError or ValueError)
    const jersey = get(p, "jersey");
    if (typeof jersey === "number" && Number.isFinite(jersey)) out["jersey"] = int(jersey);
    else if (typeof jersey === "boolean") out["jersey"] = jersey ? 1 : 0;
    else if (typeof jersey === "string" && _WHOLE.test(jersey)) out["jersey"] = Number(jersey.replace(/_/g, ""));
    if (truthy(get(p, "height_in"))) out["h"] = p["height_in"];
    if (truthy(get(p, "weight"))) out["w"] = p["weight"];
    for (const [key, field] of [["cls", "class"], ["arch", "archetype"], ["dev", "dev_trait"]]) {
      if (truthy(get(p, field))) out[key] = p[field];
    }
    out["ovr"] = season.page_overall(p);          // what his card shows
    // his card's ratings as the card prints them, name and number ("Pocket Poise": 82), a quarterback's Decision
    // Making among them (a rating of its own in the roster file): the field need not work any of them out
    const card = {};
    for (const [k, v] of Object.entries(get(p, "attributes") || {})) {
      if (has(ratings_v2.ATTRIBUTES, k)) card[ratings_v2.ATTRIBUTES[k][0]] = season.page_attribute(p, k, v);
    }
    if (Object.keys(card).length) out["card"] = card;
    const earned = [];
    for (const x of get(p, "traits") || []) {
      const key = get(x, "key"), tier = get(x, "tier");
      if (typeof key === "string" && has(ratings_v2.TRAIT_INFO, key) && isNumber(tier) && has(season._TIER_NAMES, Number(tier))) {
        earned.push([ratings_v2.TRAIT_INFO[key][0], season._TIER_NAMES[Number(tier)]]);
      }
    }
    if (earned.length) out["abilities"] = earned;
    return out;
  }

  const by_name = {};
  for (const p of players) by_name[`${p["name"]}|${p["position"]}`] = p["slug"];
  const out_list = [];
  for (const [who, inj] of Object.entries(hurt)) {
    out_list.push({ slug: get(by_name, who), name: inj["name"], pos: inj["position"], why: "injury", type: get(inj, "type"), weeks_left: get(inj, "weeks_left") });
  }
  for (const v of Object.values(sitting)) {
    out_list.push({ slug: get(by_name, `${v["name"]}|${v["position"]}`), name: v["name"], pos: v["position"], why: "redshirt" });
  }
  const coaches = {};
  for (const [role, c] of Object.entries(get(t, "coaches") || {})) {
    if (!truthy(c)) continue;
    coaches[role] = { name: get(c, "name"), ratings: get(c, "ratings") || {}, tendencies: get(c, "tendencies") || {}, scheme: get(c, "scheme") || {},
      ...(get(c, "since") !== null ? { since: c["since"] } : {}) };
  }
  return { slug, name: t["name"], abbr: get(t, "abbreviation"), colors: get(t, "colors") || {},
    depth, players: players.filter((p) => truthy(get(p, "slug")) && truthy(get(p, "skills"))).map((p) => player(p)),
    morale: mood === null ? null : round(mood["team"], 3),
    home_field: get(t, "home_field_advantage"), stadium: get(t, "stadium") || null,
    coaches, tendencies: { ...(get(t, "tendencies") || {}) }, playbook: _playlink_playbook(state, slug), out: out_list };
}

function playlink_game(state, offense, defense) {
  // The game a roster link is for (the player's ask: the field gets the game itself): the season's year and coming
  // week, each side's record, rank and unit ratings, and, when the two teams have a game still to play this season,
  // that game: when and where it is, who is at home, what kind it is (regular, a title game, a bowl, the playoff),
  // whether it is a conference game or a rivalry, and the home field's advantage (0 on a neutral field). Any two
  // teams can be taken to the field: without a game between them "scheduled" is false and there is no home side.
  const teams = season.load_teams();
  const ranks = season.rank_map(state, state["current_week"]);
  const rec = season._records(state, undefined, true);
  const side = (slug) => (truthy(slug) && has(teams, slug) ? { slug, name: teams[slug]["name"], rank: get(ranks, slug),
    record: rec[slug] !== undefined && !truthy(get(teams[slug], "fictional")) ? season._record_str(rec[slug]) : "",
    ratings: truthy(get(teams[slug], "fictional")) ? null : season._unit_overalls(state, slug) } : null);
  const out = { year: season.season_year(state), week: state["current_week"] + 1, done: truthy(state["done"]),
    offense: side(offense), defense: side(defense), scheduled: false };
  if (!truthy(offense) || !truthy(defense)) return out;
  let g = null;
  for (const x of Object.values(state["games"])) {
    const these = (x["home"] === offense && x["away"] === defense) || (x["home"] === defense && x["away"] === offense);
    if (these && !truthy(x["played"]) && (g === null || x["week"] < g["week"])) g = x;
  }
  if (g === null) return out;
  const neutral = truthy(g["neutral"]);
  Object.assign(out, { scheduled: true, event_id: g["event_id"], game_week: g["week"], date: get(g, "date"), kind: g["kind"],
    title: get(g, "title"), site: get(g, "site"), neutral, home: g["home"], away: g["away"],
    conference_game: truthy(get(g, "conference_game")), rivalry: season.game_rivalry(state, g, false),
    stadium: neutral ? null : get(teams[g["home"]], "stadium") || null,
    home_field: neutral ? 0 : get(teams[g["home"]], "home_field_advantage") });
  return out;
}

function depth_roster_view(state, slug) {
  // Every player on a team's roster as a depth-chart card (the chart itself shows six a role):
  // the redshirt and availability screens read it.
  const t = season.apply_depth(season.team_data(state, slug), get(get(state, "depth") || {}, slug));
  const card = season._depth_card(state, slug);
  return { team: slug, players: [...t["offense"], ...t["defense"]].map((p) => card(p, get(p, "role") || p["position"])) };
}

// the offensive groupings by name, and the line of how many backs, tight ends and receivers
season.GROUPING_NAMES = { 10: "Four Wide", 11: "Spread", 12: "Two Tight Ends", 21: "I-Formation", 13: "Three Tight Ends",
  22: "Heavy I", jumbo: "Jumbo", option: "Flexbone" };

function _number_labels(slots) {
  // Two at one spot read DT1 and DT2 (MIKE1, MIKE2...); a spot held once keeps its plain label.
  const counts = {};
  for (const s of slots) counts[s["label"]] = get(counts, s["label"], 0) + 1;
  const seen = {};
  for (const s of slots) {
    if (counts[s["label"]] > 1) {
      seen[s["label"]] = get(seen, s["label"], 0) + 1;
      s["label"] = `${s["label"]}${seen[s["label"]]}`;
    }
  }
  return slots;
}

function formations_view(state, slug) {
  // The formations a team lines up in most, each filled the way the next game fills it (the
  // engine's own lineup from the depth chart, the injured and redshirting left out): the three
  // groupings its offensive scheme uses most, its defense's base front and the two packages it
  // turns to, and the special teams' kicking and return units.
  const t = season.apply_depth(season.team_data(state, slug), get(get(state, "depth") || {}, slug));
  const by_slug = {};
  for (const p of [...t["offense"], ...t["defense"]]) by_slug[p["slug"]] = p;
  const card = season._depth_card(state, slug);
  const team = formations(season._preview_team(state, slug));      // the engine's own lineups: {slug, position, role} a man

  function slot(sid, label, p) {
    const src = p !== null && p !== undefined ? get(by_slug, p["slug"]) : null;
    return { slot: sid, label, player: truthy(src) ? card(src, get(src, "role") || label) : null };
  }

  function offense(name, lineup) {
    const of = (pos) => lineup.filter((p) => p["position"] === pos);
    const line = of("OL");
    const roles = ["LT", "LG", "C", "RG", "RT"];
    const placed = {};
    for (const p of line) {                              // each lineman at his own spot where it is free
      if (roles.includes(p["role"]) && !has(placed, p["role"])) placed[p["role"]] = p;
    }
    const rest = line.filter((p) => !Object.values(placed).some((q) => p === q));
    for (const r of roles) {
      if (!has(placed, r) && rest.length) placed[r] = rest.shift();
    }
    let out = [...roles.filter((r) => has(placed, r)).map((r) => slot(r, r, get(placed, r))), ...rest.slice(0, 1).map((p) => slot("OL6", "OL", p))];
    out = out.concat(of("QB").slice(0, 1).map((p) => slot("QB", "QB", p)));
    const backs = name === "option" ? ["FB", "SB", "SB"] : ["HB", "FB", "HB"];
    out = out.concat(of("RB").slice(0, 3).map((p, i) => slot(`RB${i + 1}`, backs[i], p)));
    const tes = of("TE");
    out = out.concat(tes.slice(0, 3).map((p, i) => slot(`TE${i + 1}`, tes.length === 1 ? "TE" : `TE${i + 1}`, p)));
    out = out.concat(of("WR").slice(0, 4).map((p, i) => slot(`WR${i + 1}`, `WR${i + 1}`, p)));
    return out;
  }

  function defense(counts, lineup) {
    const n_edge = counts["EDGE"], n_dt = counts["DT"], n_lb = counts["LB"], n_cb = counts["CB"];
    let edges = lineup.slice(0, n_edge);
    const tackles = lineup.slice(n_edge, n_edge + n_dt);
    const backers = lineup.slice(n_edge + n_dt, n_edge + n_dt + n_lb);
    const corners = lineup.slice(n_edge + n_dt + n_lb, n_edge + n_dt + n_lb + n_cb);
    const safeties = lineup.slice(n_edge + n_dt + n_lb + n_cb);
    edges = sorted(edges, (p) => (p["role"] === "LEDG" ? 0 : p["role"] === "REDG" ? 1 : 2));
    let out = edges.slice(0, 2).map((p, i) => slot(i === 0 ? "LE" : "RE", i === 0 ? "LE" : "RE", p));
    out = out.concat(tackles.map((p, i) => slot(`DT${i + 1}`, tackles.length === 1 ? "NT" : "DT", p)));
    out = out.concat(backers.map((p, i) => slot(`LB${i + 1}`, ["SAM", "MIKE", "WILL"].includes(p["role"]) ? p["role"] : "LB", p)));
    out = out.concat(corners.map((p, i) => slot(`CB${i + 1}`, i < 2 ? "CB" : "NB", p)));
    out = out.concat(safeties.map((p, i) => slot(`S${i + 1}`, ["FS", "SS"].includes(p["role"]) ? p["role"] : "S", p)));
    return season._number_labels(out);
  }

  const off = [];
  for (const f of team["offense"]) {
    const g = f["id"], c = f["counts"];
    off.push({ id: g, name: get(season.GROUPING_NAMES, g, g), personnel: g === "option" ? "Flexbone" : `${g} personnel`,
      note: `${c["RB"]} RB · ${c["TE"]} TE · ${c["WR"]} WR` + (c["OL"] > 5 ? " · 6 OL" : ""),
      usage: round(f["usage"], 2), slots: offense(g, f["lineup"]) });
  }

  const scheme = team["defense_scheme"];
  const package_ = { base: ["Base", "Against two backs or two tight ends"], nickel: ["Nickel", "Against three receivers"],
    dime: ["Dime", "Against four receivers and on third and long"], heavy: ["Heavy", "Against three tight ends and at the goal line"] };
  const dfn = [];
  for (const f of team["defense"]) {
    const counts = f["counts"];
    const [name, when] = package_[f["id"]];
    const front = `${counts["EDGE"] + counts["DT"]}-${counts["LB"]}-${counts["CB"] + counts["S"]}`;
    dfn.push({ id: f["id"], name, personnel: front, note: when, slots: defense(counts, f["lineup"]) });
  }

  function specialist(sid, label, pos) {
    const who = pos === "K" ? team["kicker"] : team["punter"];
    return slot(sid, label, truthy(who) ? { slug: who } : null);
  }

  function returner(sid, label, who) {
    return slot(sid, label, truthy(who) ? { slug: who } : null);
  }

  const st = [
    { id: "fg", name: "Field goal", personnel: "Field goal & PAT", note: "The kicker; the rest of the unit is not on the depth chart",
      slots: [specialist("K", "K", "K")] },
    { id: "punt", name: "Punt", personnel: "Punt", note: "The punter; the rest of the unit is not on the depth chart",
      slots: [specialist("P", "P", "P")] },
    { id: "return", name: "Returns", personnel: "Kick & punt return", note: "Who fields kickoffs and punts",
      slots: [returner("KR", "KR", team["kick_returner"]), returner("PR", "PR", team["punt_returner"])] },
  ];
  return { team: slug, offense: { scheme: team["offense_scheme"], formations: off },
    defense: { scheme, formations: dfn }, special: { scheme: null, formations: st } };
}

// (keyed by the text of: season id, week, games played, the length of the player edits' JSON)
season._race_cache = {};

function awards_view(state) {
  // The Awards tab: the live race until the awards are given, then the results.
  const teams = season.load_teams();
  const aw = get(state, "awards") || {};
  const out = { given_through: get(aw, "given_through", 0), conference: get(aw, "conference", {}), national: get(aw, "national"),
    postseason: get(aw, "postseason"), mine: truthy(aw) ? awards.my_awards(state, aw) : [],
    my_conference: teams[state["team"]]["conference"], team: state["team"] };
  const nat = get(aw, "national");
  if (truthy(nat) && truthy(get(nat, "heisman")) && state["current_week"] > season.SELECTION_WEEK) {
    out["national"] = { ...nat, heisman: season._heisman_with_final_lines(state, nat["heisman"]) };
  }
  if (!truthy(get(aw, "national"))) {
    // the race only moves when games are played (or god mode edits a player)
    let played = 0;
    for (const g of Object.values(state["games"])) if (truthy(g["played"])) played += 1;
    const key = [state["id"], state["current_week"], played, json_dumps(get(state, "player_edits") || {}).length].join("|");
    let race = get(season._race_cache, key);
    if (race === null) {
      race = awards.race_view(state, teams, season._records(state));
      if (Object.keys(season._race_cache).length > 16) clear(season._race_cache);
      season._race_cache[key] = race;
    }
    // before the race has a shape (the first weeks, or nobody has played enough): the preseason favorites
    const thin = !truthy(get(get(race, "heisman") || {}, "candidates"));
    if (state["current_week"] < season.AWARDS_RACE_WEEK || thin) race = season.awards_outlook(state, teams);
    out["race"] = race;
  }
  return season._with_player_ids(state, teams, out);
}

function _with_player_ids(state, teams, view) {
  // The awards view with each player in it given his roster `slug` and, when you drew him one (Edit Player Look),
  // his `face`: a copy, so the stored awards and the race cache stay as they were. A player is any dict with a team,
  // a name and a position; coaches and line units (no position) are left alone.
  const rosters = {};

  function ids(team, name, position) {
    if (!has(rosters, team)) {
      const t = get(teams, team) || {};
      const by = new Map();                 // (name, position) -> slug
      for (const p of [...(get(t, "offense") || []), ...(get(t, "defense") || [])]) by.set(`${p["name"]}\u0000${p["position"]}`, get(p, "slug"));
      rosters[team] = { by, looks: season.player_faces(state, team) };
    }
    const r = rosters[team];
    const k = `${name}\u0000${position}`;
    const slug = r["by"].has(k) ? r["by"].get(k) : null;
    return [slug, truthy(slug) ? get(r["looks"], slug) : null];
  }

  function walk(x) {
    if (Array.isArray(x)) return x.map((v) => walk(v));
    if (!is_dict(x)) return x;
    const out = {};
    for (const [k, v] of Object.entries(x)) out[k] = walk(v);
    if (typeof get(out, "team") === "string" && typeof get(out, "name") === "string" && typeof get(out, "position") === "string") {
      const [slug, face] = ids(out["team"], out["name"], out["position"]);
      if (truthy(slug)) out["slug"] = slug;
      if (truthy(face)) out["face"] = face;
    }
    return out;
  }

  return walk(view);
}

// the award-card stat line for a position (awards.stat_line groups)
season._LINE_GROUP = { QB: "QB", RB: "RB", WR: "WR", TE: "TE", DL: "EDGE", MLB: "LB", ROLB: "LB", LOLB: "LB",
  CB: "DB", S: "DB", K: "K", P: "P" };

function _heisman_with_final_lines(state, h) {
  // The Heisman vote with each candidate's season line as it stands now ("final_line"),
  // beside the line the voters saw ("line", through championship week). Bowl and playoff
  // games come after the vote, so the two differ for anyone who played in them.
  function final(c) {
    const rec = get(get(get(get(state, "season_stats") || {}, c["team"], {}), "players") || {}, `${c["name"]}|${c["position"]}`);
    const group = get(season._LINE_GROUP, c["position"]);
    if (!truthy(rec) || !truthy(group)) return null;
    const line = awards.stat_line({ stats: rec["stats"] }, group);
    return line.toLowerCase() !== (get(c, "line") || "").toLowerCase() ? line : null;   // (a line kept by an older save differs only in its capitals)
  }
  const out = { ...h, candidates: get(h, "candidates", []).map((c) => ({ ...c, final_line: final(c) })) };
  if (truthy(get(h, "winner"))) out["winner"] = { ...h["winner"], final_line: final(h["winner"]) };
  return out;
}

season._SHARED_POOL = null;

function shared_pool() {
  // One worker pool for the life of the process: spawning the workers and loading the
  // league into each costs a few seconds, which should not be paid on every click.
  // (There are no worker processes here: _make_pool remembers the league's path and gives null.)
  if (season._SHARED_POOL === null) season._SHARED_POOL = season._make_pool();
  if (season._SHARED_POOL === undefined) season._SHARED_POOL = null;
  return season._SHARED_POOL;
}

function close_pool() {
  // Stop the workers (called when the server shuts down, so Ctrl-C exits at once).
  if (season._SHARED_POOL !== null) {
    // (a host that did put a pool here has it stopped: terminate, then join)
    if (typeof season._SHARED_POOL.terminate === "function") season._SHARED_POOL.terminate();
    if (typeof season._SHARED_POOL.join === "function") season._SHARED_POOL.join();
    season._SHARED_POOL = null;
  }
}

function advance_to(state, target_week, progress = null, report = null, should_stop = null) {
  // Play weeks up to target_week; `should_stop` is checked between weeks (the Pause button).
  const target = Math.min(target_week, season.FINAL_WEEK);
  const pool = season.shared_pool();
  const first = state["current_week"];
  while (state["current_week"] < target && !truthy(state["done"])) {
    if (should_stop && truthy(should_stop())) break;
    season.advance(state, pool, report, state["current_week"] > first);
    if (progress) progress(state["current_week"], target);
  }
  return state;
}

function my_results(state, since_week) {
  // Your team's played games after `since_week`, for the live ticker while simming.
  const me = state["team"];
  const out = [];
  for (const [eid, g] of Object.entries(state["games"])) {
    if (!truthy(g["played"]) || g["week"] <= since_week || !(me === g["home"] || me === g["away"])) continue;
    const home = g["home"] === me;
    const [pf, pa] = season._scores_for(g, home);
    out.push({ week: g["week"], title: get(g, "title"), kind: g["kind"], won: pf > pa, points_for: pf, points_against: pa,
      opponent: home ? g["away"] : g["home"], opponent_name: home ? g["away_display"] : g["home_display"],
      venue: season._venue(g, home), overtime: get(g, "overtime") || 0,
      event_id: eid, has_box: has(get(state, "my_boxes", {}), eid) || exists(`${season.box_dir(state)}/${eid}.json`) });
  }
  out.sort((a, b) => cmp(a["week"], b["week"]));
  return out;
}

function box_dir(state_or_id) {
  const sid = typeof state_or_id === "string" ? state_or_id : state_or_id["id"];
  return `${season.SEASONS_DIR}/${sid}/boxes`;
}

// The boxes just written, by (season id, event id): the news reads every box of the week the moment the week ends,
// and read each one back from its file (a parse of four megabytes a week). Kept for one week's games; a reader that
// only reads asks for them with `shared` (load_box).
// (the key is `${season id}|${event id}`; _fresh_week[0] is the [season id, year, week] the boxes belong to)
season._fresh_boxes = {};
season._fresh_week = [null];

function save_box(state, event_id, game) {
  // Every simulated game's box score, one small file each, so any game can be opened.
  const d = season.box_dir(state);
  write_text(`${d}/${event_id}.json`, JSON.stringify(game));
  const week = [state["id"], season.season_year(state), get(get(state["games"], event_id) || {}, "week")];
  const held = season._fresh_week[0];
  if (held === null || held.some((v, i) => v !== week[i])) {
    clear(season._fresh_boxes);
    season._fresh_week[0] = week;
  }
  season._fresh_boxes[`${state["id"]}|${event_id}`] = game;
}

function forget_fresh_boxes() {
  // The week's boxes have been read: their memory goes (each is on disk).
  clear(season._fresh_boxes);
  season._fresh_week[0] = null;
}

function load_box(state, event_id, shared = false) {
  // A game's box score. `shared`: the caller only reads it, so the one just written may be handed over as it is
  // (it is what its file holds: a box is the same after a trip through JSON) instead of read back and parsed.
  let box = get(get(state, "my_boxes", {}), event_id);
  if (box === null && truthy(shared)) box = get(season._fresh_boxes, `${state["id"]}|${event_id}`);
  if (box === null) {
    const path = `${season.box_dir(state)}/${event_id}.json`;
    if (!exists(path)) return null;
    box = JSON.parse(fcs_names.rewrite_text(read_text(path)));   // a box saved before the rename
  }
  return season.box_names(box);
}

function box_names(box) {
  // A box score with each side's name as every page shows it: an FCS stand-in as its region
  // label (team_display), in the header, the line score, the injuries and the scoring plays.
  const teams = season.load_teams();
  for (const side of ["home", "away"]) {
    const slug = get(box, `${side}_slug`);
    const t = get(box, side);
    if (!is_dict(t) || !truthy(get(get(teams, slug) || {}, "fictional"))) continue;
    const shown = season.team_display(slug, teams);
    if (get(t, "name") !== shown) {
      t["name"] = shown;
      for (const s of get(box, "scoring_plays") || []) {
        if (get(s, "team") === side) s["team_name"] = shown;
      }
    }
  }
  return box;
}

function _rename_stand_ins_files(season_id) {
  // A season saved before the FCS stand-ins were renamed: its box scores and its cached
  // leagues get today's slugs and names too (fcs_names), once.
  const league = modules.league;
  const boxes = `${season.SEASONS_DIR}/${season_id}/boxes`;
  const files = [
    ...list_dir(boxes).filter((n) => n.endsWith(".json")).map((n) => `${boxes}/${n}`),
    ...list_dir(league.CACHE_DIR).filter((n) => n.startsWith(`${season_id}-`) && n.endsWith(".json")).map((n) => `${league.CACHE_DIR}/${n}`),
  ];
  for (const f of files) {
    try {
      const text = read_text(f);
      const renamed = fcs_names.rewrite_text(text);
      if (renamed !== text) write_text(f, renamed);
    } catch (e) {
      continue;                           // (passed over: a file that cannot be read or is not JSON)
    }
  }
}

function has_box(state, g) {
  return truthy(get(g, "played")) && (has(get(state, "my_boxes", {}), g["event_id"]) || exists(`${season.box_dir(state)}/${g["event_id"]}.json`));
}

function save_season(state) {
  if (truthy(get(state, "career"))) {                       // a career's copies are compared by these (career.newer)
    state["career"]["saved_week"] = state["current_week"];
    state["career"]["saved_at"] = new Date().toISOString().slice(0, 19) + "+00:00";
  }
  const path = `${season.SEASONS_DIR}/${state["id"]}.json`;
  const text = JSON.stringify(season._without_class(state));
  write_text(path, text);
  season._note_current(path, text);
  return path;
}

// ----- the class's fixed half: written once, not with every save -----------------------------------
// A recruiting class's ratings, potential, true grades, hometowns and priorities are drawn when the class is made and
// never change, and they were a fifth of the save, written again with every week and every click that saves. They are
// kept in a file of their own beside the career's box scores (seasons/<id>/class.json), written when the class is new,
// and put back into the prospects when the career is loaded. A save without the marker (rc["class_file"]) holds
// everything itself, as an imported career's does.
season.CLASS_KEYS = ["ratings", "potential", "truth", "hometown", "priorities"];
season._class_written = {};      // season id -> the class its file is known to hold

function _class_path(season_id) {
  return `${season.SEASONS_DIR}/${season_id}/class.json`;
}

function _class_key(rc) {
  return `${pystr(get(rc, "year"))}-${truthy(get(rc, "portal")) ? "portal" : "class"}-${Object.keys(rc["prospects"]).length}`;
}

function _without_class(state) {
  // The state as its save file holds it: the prospects without their fixed half, which goes to the class file
  // when that does not hold this class yet. The state itself is not touched (a copy of what changes).
  const rc = get(state, "recruiting");
  if (!truthy(rc) || !truthy(get(rc, "prospects"))) return state;
  const sid = state["id"], key = season._class_key(rc);
  const cpath = season._class_path(sid);
  if (get(season._class_written, sid) !== key || !exists(cpath)) {
    const fixed = {};
    for (const [pid, p] of Object.entries(rc["prospects"])) {
      fixed[pid] = Object.fromEntries(season.CLASS_KEYS.filter((k) => has(p, k)).map((k) => [k, p[k]]));
    }
    write_text(cpath, JSON.stringify({ key, prospects: fixed }));
    season._class_written[sid] = key;
  }
  const lean = {};
  for (const [pid, p] of Object.entries(rc["prospects"])) {
    lean[pid] = Object.fromEntries(Object.entries(p).filter(([k]) => !season.CLASS_KEYS.includes(k)));
  }
  return { ...state, recruiting: { ...rc, prospects: lean, class_file: key } };
}

function _with_class(state) {
  // A loaded save's prospects made whole again from its class file.
  const rc = get(state, "recruiting");
  const sid = get(state, "id");
  let key = null;
  if (truthy(rc)) {
    key = get(rc, "class_file");
    delete rc["class_file"];
  }
  if (key === null) {
    delete season._class_written[sid];        // the save held everything: the next save writes the class file anew
    return;
  }
  const cpath = season._class_path(sid);
  const held = exists(cpath) ? JSON.parse(read_text(cpath)) : {};
  if (get(held, "key") !== key) {
    throw new Error(`career ${pystr(sid)}: its class file is missing or belongs to another class (${pystr(get(held, "key"))} for ${pystr(key)})`);
  }
  const fixed = held["prospects"];
  for (const [pid, p] of Object.entries(rc["prospects"])) {
    if (!has(fixed, pid)) throw new Error(`KeyError: ${JSON.stringify(pid)}`);
    Object.assign(p, fixed[pid]);
  }
  season._class_written[sid] = key;
}

// season file -> (its mtime_ns, size) when it was last known to hold today's FCS names: written here from
// a loaded (so renamed) season, or scanned by load_season. A file seen unchanged since is not scanned again,
// so switching between saved seasons does not re-run the rename's regex over megabytes of save each time.
// (Here: [when the store says the file was last written, in milliseconds, the length of its text]. The store has no
// size to ask for, so the text's length stands in; both callers have the text in hand and pass it.)
season._names_current = {};

function _file_key(path, text) {
  const m = mtime(path);
  if (m === null || m === undefined) return null;
  return [m, (text === undefined || text === null ? read_text(path) : text).length];
}

function _note_current(path, text) {
  const key = season._file_key(path, text);
  if (key !== null) season._names_current[path] = key;
}

function load_season(season_id) {
  const path = `${season.SEASONS_DIR}/${season_id}.json`;
  if (!exists(path)) return null;
  const seen = get(season._names_current, path);
  const text = read_text(path);
  const now = seen !== null ? season._file_key(path, text) : null;
  let renamed;
  if (seen !== null && now !== null && seen[0] === now[0] && seen[1] === now[1]) {
    renamed = text;
  } else {
    renamed = fcs_names.rewrite_text(text);
    if (renamed !== text) {               // saved before the FCS stand-ins were named for their regions
      write_text(path, renamed);
      season._rename_stand_ins_files(season_id);
    }
    season._note_current(path, renamed);
  }
  const state = parse_ordered(renamed, [["games"], ["my_boxes"]]);     // event ids look like numbers: keep the saved order
  season._with_class(state);
  // seasons saved before the FCS stand-ins were anonymised still carry "Duquesne (as ...)"; a stand-in's side of a
  // game is its name today, whatever the save shows it as (a bare "FCS", a label rewrite_text does not know)
  for (const g of Object.values(state["games"])) {
    for (const side of ["home", "away"]) {
      const shown = get(g, `${side}_display`) || "";
      if (shown.includes(" (as ") || (has(season.TEAM_REGION, g[side]) && shown !== season.fcs_label(g[side]))) g[`${side}_display`] = season.fcs_label(g[side]);
    }
  }
  season.schedule_ahead(state);             // seasons saved before the postseason was set a week early
  if (game_scale.upgrade(state)) {          // careers saved while their league and recruits were in EA numbers
    // (nothing more to do)
  } else if (truthy(get(state, "recruiting")) && get(state["recruiting"], "grades") !== "game") {
    modules.recruiting.upgrade_grades(state);   // careers saved when grades were class percentiles
  }
  game_scale.upgrade_overalls(state);     // careers saved before the overall was built on the card's attributes
  if (truthy(get(state, "recruiting"))) {
    modules.recruiting.upgrade_asks(state);     // careers saved before prospects had NIL asks
    modules.recruiting.upgrade_generational(state);   // careers saved before generational prospects
    modules.recruiting.heal_contacts(state);    // careers saved with a call left open, or portal contact marks that never cleared
  }
  if (truthy(get(state, "career"))) {
    modules.coach_names.distinct(state);        // careers saved with one coach in two jobs or two coaches under one name
  }
  return state;
}

Object.assign(season, {
  week_work, progress_part, _heal, injury_report, _award_step, player_overall, overall_at, apply_depth, role_starters,
  position_candidates, depth_order, set_depth_order, move_depth, reset_depth, _depth_card, _players_by_role,
  depth_changed, depth_chart_view, playlink_team, playlink_game, depth_roster_view, _number_labels, formations_view, awards_view,
  _with_player_ids, _heisman_with_final_lines, shared_pool, close_pool, advance_to, my_results, box_dir, save_box,
  forget_fresh_boxes, load_box, box_names, _rename_stand_ins_files, has_box, save_season, _class_path, _class_key,
  _without_class, _with_class, _file_key, _note_current, load_season,
});
