// What the rest of the game asks of the engine while that rest is still Python (sim/engine.py calls these: in the
// browser straight from Python, on a computer through engine_js/bridge.mjs). Every answer is plain JSON.
import { Random, get, sorted } from "./pyrt.js";
import { cfg } from "./game_config.js";
import { personnel } from "./personnel.js";
import { drive_functions } from "./drive_functions.js";
import { game, simulate_game } from "./game.js";

/** One game. `want_log`: the game's play log rides along as `play_log` (Clear Mode's big moments read it). */
export function play(home, away, sliders = null, seed = null, venue = "home", momentum = false, want_log = false) {
  const r = simulate_game(home, away, sliders, seed, venue, momentum);
  if (want_log) r.play_log = drive_functions.play_log.slice();
  return r;
}

/** The engine's settings and personnel tables, for the Python that reads a few of them. */
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
  const specialist = (pos) => {
    let p = team.offense.find((x) => x.position === pos && x.in_game && !x.injured);
    if (!p) p = sorted(team.offense, (x) => x.depth).find((x) => x.position === pos && !x.injured);
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

export const api = { play, config, formations };
