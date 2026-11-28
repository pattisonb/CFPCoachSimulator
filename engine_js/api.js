// What the rest of the game and its hosts ask of the engine: one game, the settings, how a team lines up, one game
// job in a named league. Every answer is plain JSON.
import { Random, get, sorted } from "./pyrt.js";
import { cfg } from "./game_config.js";
import { personnel } from "./personnel.js";
import { drive_functions } from "./drive_functions.js";
import { game, simulate_game } from "./game.js";
import * as game_job from "../sim_js/game_job.js";
import * as files from "./files.js";
import { modules } from "./modules.js";

/** One game. `want_log`: the game's play log rides along as `play_log` (the game job's big moments read it). */
export function play(home, away, sliders = null, seed = null, venue = "home", momentum = false, want_log = false) {
  const r = simulate_game(home, away, sliders, seed, venue, momentum);
  if (want_log) r.play_log = drive_functions.play_log.slice();
  return r;
}

/** The engine's settings and personnel tables, for a caller that reads a few of them. */
export function config() {
  const out = {};
  for (const [k, v] of Object.entries(cfg)) {
    if (typeof v === "function" || v instanceof Random) continue;
    if (v instanceof Set) out[k] = [...v];
    else if (v instanceof cfg.GameSliders) out[k] = { ...v };
    else out[k] = v;
  }
  const pairs = (mix) => personnel.MIX_NAMES.get(mix).map((g) => [g, mix[g]]);     // in the order they were written
  const mixes = {};
  for (const [scheme, mix] of Object.entries(personnel.SCHEME_MIX)) mixes[scheme] = pairs(mix);
  return {
    game_config: out,
    personnel: { GROUPINGS: personnel.GROUPINGS, SCHEME_MIX: mixes, DEFAULT_MIX: pairs(personnel.DEFAULT_MIX), FRONTS: personnel.FRONTS, SCHEME_FRONT: personnel.SCHEME_FRONT },
  };
}

/**
 * How a team lines up, for the Depth Chart's formations (season.formations_view): the three groupings its offense
 * uses most and the defense's packages, each filled as the next game would fill it, and the specialists.
 */
export function formations(team_data) {
  const team = game.GameSim._make_team(team_data);
  const who = (p) => ({ slug: p.slug, position: p.position, role: p.role });
  const mix = get(personnel.SCHEME_MIX, team.offense_scheme, personnel.DEFAULT_MIX);
  const top = sorted(personnel.MIX_NAMES.get(mix), (g) => -mix[g]).slice(0, 3);
  const offense = [];
  for (const g of top) {
    team.set_grouping(g, personnel.GROUPINGS[g]);
    offense.push({ id: g, counts: personnel.GROUPINGS[g], usage: mix[g], lineup: Array.from(team._lineup.offense, who) });
  }
  const scheme = team.defense_scheme;
  const packages = [
    ["base", personnel.defense_package(scheme, "12", 1, 10)],
    ["nickel", personnel.defense_package(scheme, "11", 1, 10, () => 0.0)],
    ["dime", personnel.defense_package(scheme, "10", 3, 10)],
    ["heavy", personnel.defense_package(scheme, "13", 1, 10)],
  ];
  const seen = new Set(), defense = [];
  for (const [id, counts] of packages) {
    const shape = ["EDGE", "DT", "LB", "CB", "S"].map((k) => counts[k]).join("-");
    if (seen.has(shape) || defense.length === 3) continue;
    seen.add(shape);
    team.set_front(counts);
    defense.push({ id, counts, lineup: Array.from(team._lineup.defense, who) });
  }
  // the kicker and punter the game would use (roster.js get_kicker, get_punter): with nobody at the spot, the other
  // specialist, then anyone (the chart showed an empty slot where the game played someone)
  const specialist = (pos) => {
    const p = pos === "K" ? team.get_kicker() : team.get_punter();
    return p ? p.slug : null;
  };
  const on_team = new Set([...team.offense, ...team.defense].map((x) => x.slug));
  const returner = (slug) => (on_team.has(slug) ? slug : null);
  return {
    offense_scheme: team.offense_scheme, defense_scheme: scheme, offense, defense,
    kicker: specialist("K"), punter: specialist("P"),
    kick_returner: returner(team.kick_returner), punt_returner: returner(team.punt_returner),
  };
}

// ---- whole game jobs (sim_js/game_job.js) ----
// The league a job is played in is a teams file the caller names by [path, signature] (the signature changes when
// the file does). Two are kept: the built-in league and a career's own.
const leagues = new Map();

/** How files are read here: `fn(path)` gives a file's text (engine_js/files.js). */
export function set_reader(fn) { files.set_reader(fn); }

function league_teams([path, sig]) {
  const key = `${path}|${sig}`;
  let teams = leagues.get(key);
  if (!teams) {
    // the roster file is worked out as the game reads it (rosters.derive: card ratings onto the engine's numbers, each
    // player's stat line), the same as season._sim_one's teams; a career's later league is the engine's already
    teams = modules.rosters.derive(JSON.parse(files.read_text(path)))["teams"];
    if (leagues.size >= 2) leagues.delete(leagues.keys().next().value);
    leagues.set(key, teams);
  }
  return teams;
}

/** One game job, as season._run_games builds it, in the league named. Throws NotHere for a job a helper cannot play (the caller plays it itself). */
export function sim_one(league, job) {
  return game_job._sim_one(league_teams(league), job);
}

export const api = { play, config, formations, sim_one, set_reader, NotHere: game_job.NotHere };
