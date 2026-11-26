// Kicks, conversions, fatigue and the team stat summary.
import { cfg } from "./game_config.js";
import { roster } from "./roster.js";
import { random, round, get, getattr, isNumber, truthy, int, sum } from "./pyrt.js";


export function _add_stat(player, key, n = 1) {
  // Add to a stat the roster template may not carry.
  player.stats[key] = get(player.stats, key, 0) + n;
}


// How tired a player gets, in the fatigue formulas' own units: TIRE_AVG for an average starter, TIRE_PER_POINT less a
// card point of endurance over him. *tune*
const TIRE_AVG = 45, TIRE_PER_POINT = 2.5;

export function _tired(player) {
  return game_functions.TIRE_AVG - game_functions.TIRE_PER_POINT * (player.endurance || 0);
}


export function sim_kickoff(kicker, return_team = null) {
  // Kickoff from the 35 under college rules: touchbacks and fair catches inside the 25
  // come out to the 25; otherwise the designated returner brings it out.
  // Returns: [receiving team's yardline, returner, return_yards, is_touchdown]
  const kick_power_mult = cfg.sliders.get_multiplier(cfg.sliders.kickoff_power);
  // (card points over the average kicker; the slider scales his leg read from REF_POINTS under the average)
  const kick_power = (kicker.kick_power || 0) * kick_power_mult + cfg.REF_POINTS * (kick_power_mult - 1);
  const kick_accuracy = kicker.kick_accuracy || 0;
  const returner = return_team ? return_team.get_kick_returner() : null;
  if (returner !== null) {
    return_team.refresh_ratings([returner]);
  }

  // Out of bounds: receiving team takes it at the 40.
  if (random.random() < Math.max(0.01, cfg.KICKOFF_OOB_CHANCE - kick_accuracy * 0.00125)) {
    return [40, null, 0, false];
  }

  // Where the ball comes down, measured from the receiving team's goal line.
  const distance = random.gauss(cfg.KICKOFF_DISTANCE, cfg.KICKOFF_DISTANCE_SD) + kick_power * cfg.KICKOFF_PER_POWER_POINT;
  const landing = 65 - distance;
  if (landing <= 0 && random.random() < cfg.KICKOFF_TOUCHBACK_FROM_END_ZONE) {
    return [25, null, 0, false];
  }
  if (0 < landing && landing < 25 && random.random() < cfg.KICKOFF_FAIR_CATCH_CHANCE) {
    return [25, null, 0, false];
  }

  // Return
  const return_mult = cfg.sliders.get_multiplier(cfg.sliders.kickoff_return);
  const skill = returner ? roster.return_skill(returner) : 0.5;
  const td_chance = cfg.KICKOFF_RETURN_TD_CHANCE * return_mult * (0.5 + skill);
  if (random.random() < td_chance) {
    if (returner) {
      _add_stat(returner, "kickoff_returns");
      _add_stat(returner, "kickoff_return_yards", 100);
      _add_stat(returner, "kickoff_return_touchdowns");
    }
    return [100, returner, 100, true];
  }
  const start = Math.max(landing, -8);  // a ball brought out of the end zone
  let return_yards = random.gauss(cfg.KICKOFF_RETURN_YARDS, cfg.KICKOFF_RETURN_SD) * return_mult + (skill - 0.5) * 12;
  if (random.random() < cfg.KICKOFF_BIG_RETURN_CHANCE * (0.5 + skill)) {
    return_yards += random.randint(15, 45);
  }
  return_yards = Math.max(5, round(return_yards));
  const end = Math.max(1, Math.min(99, round(start + return_yards)));
  if (returner) {
    _add_stat(returner, "kickoff_returns");
    _add_stat(returner, "kickoff_return_yards", return_yards);
    if (return_yards > get(returner.stats, "long_kickoff_return", 0)) {
      returner.stats["long_kickoff_return"] = return_yards;
    }
  }
  return [end, returner, return_yards, false];
}


export function sim_pat(kicker, verbose = false) {
  // Adjust base chance by kicking accuracy slider
  const kick_acc_mult = cfg.sliders.get_multiplier(cfg.sliders.kicking_accuracy);
  const base_chance = 0.975 * kick_acc_mult;  // College PAT success rate ~97-98%

  // Adjust based on kicker accuracy: card points over the average kicker (a little over the average is the line)
  const accuracy_adjustment = (((kicker.kick_accuracy || 0) + 2) * 0.0075) * kick_acc_mult;
  const make_chance = Math.max(0.94, Math.min(0.995, base_chance + accuracy_adjustment));  // Tight range for college PATs

  kicker.stats["pat_attempts"] += 1;
  // College chaos: occasional botched snap/hold (1% chance)
  if (random.random() < 0.01) {
    if (verbose) {
      console.log("PAT botched! Bad snap/hold!");
    }
    return false;
  }

  const made = random.random() < make_chance;
  if (made) {
    kicker.stats["pat_made"] += 1;
  }
  if (verbose) {
    console.log(`PAT ${made ? "is good" : "missed"}! (${int(make_chance * 100)}% chance)`);
  }
  return made;
}


export function sim_two_point_conversion(offense_list, defense_list, verbose = false, team_name = "") {
  // Simulate a 2-point conversion attempt from the 3-yard line
  // 2-point conversion success rate in college is ~40-45%
  // Slightly favor pass plays (55% pass, 45% run)
  const is_pass = random.random() < 0.55;

  let success_chance;
  if (is_pass) {
    // Pass attempt from 3-yard line
    let qb = null;
    for (const p of offense_list) {
      if (p.position === "QB") { qb = p; break; }
    }
    if (!qb) {
      // Fallback if no QB found
      return random.random() < 0.40;
    }

    // High completion chance due to short distance
    const base_completion = 0.50;  // Base 50% completion rate for 2-pt conversion
    // (card points over the average starter: an average quarterback's skill is 0.55, a defensive back's coverage 0.0275)
    const qb_skill = 0.55 + ((qb.passing || 0) + (qb.decision_making || 0) + (qb.intelligence || 0)) / 120;
    const dbs = defense_list.filter((p) => p.position === "CB" || p.position === "S");
    const defense_coverage = 0.0275 * dbs.length + sum(dbs.map((p) => p.coverage || 0)) / 800;
    success_chance = Math.max(0.25, Math.min(0.75, base_completion + qb_skill - defense_coverage));
  } else {
    // Run attempt from 3-yard line
    // Higher success rate for runs in short yardage
    const base_success = 0.45;  // Base 45% success rate
    const line = offense_list.filter((p) => p.position === "OL");
    const front = defense_list.filter((p) => ["DL", "OLB", "MLB", "ROLB"].includes(p.position));
    const offense_line = 0.11 * line.length + sum(line.map((p) => p.run_blocking || 0)) / 200;
    const defense_line = 0.06875 * front.length + sum(front.map((p) => p.tackling || 0)) / 320;
    success_chance = Math.max(0.30, Math.min(0.70, base_success + offense_line - defense_line));
  }

  const good = random.random() < success_chance;
  if (verbose) {
    console.log(`${team_name} 2-point conversion ${is_pass ? "PASS" : "RUN"} is ${good ? "GOOD" : "NO GOOD"}!`);
  }
  return good;
}


export function fg_max_distance(kicker) {
  // Longest field goal this kicker will attempt, in yards.
  const power_mult = cfg.sliders.get_multiplier(cfg.sliders.kicking_power);
  let long_range = get(getattr(kicker, "traits", null) || {}, "long_range", 0) * cfg.TRAIT_FX["long_range"];
  // a cannon leg kicks from farther
  long_range += get(getattr(kicker, "traits", null) || {}, "cannon_leg", 0) * cfg.TRAIT_FX["cannon_leg"];
  return round(cfg.FG_MAX_DISTANCE * power_mult + ((kicker.kick_power || 0) * power_mult + cfg.REF_POINTS * (power_mult - 1) + 2) / 3.2 + long_range);
}


export function get_punt_distance(punter) {
  const punt_power_mult = cfg.sliders.get_multiplier(cfg.sliders.kicking_power);
  const [mean, sd] = cfg.PUNT_DISTANCE;
  let punt_distance = int(random.gauss(mean * punt_power_mult, sd));
  // a cannon leg punts farther
  punt_distance += get(getattr(punter, "traits", null) || {}, "cannon_leg", 0) * cfg.TRAIT_FX["cannon_leg"];
  return round(punt_distance + ((punter.punt_power || 0) * punt_power_mult + cfg.REF_POINTS * (punt_power_mult - 1) + 2) / 2);
}


export function apply_baseline_fatigue(team) {
  for (const player of [...team.offense, ...team.defense]) {
    const base_chance = game_functions._tired(player) / 10;  // chance out of 100
    if (random.random() < base_chance / 100) {
      const max_fatigue = Math.max(1, round(base_chance));  // capped by the same amount, at least 1
      player.fatigue = random.randint(1, max_fatigue);
    } else {
      player.fatigue = 0;
    }
  }
}


export function apply_general_fatigue(offense, defense) {
  const skill_positions = new Set(["RB", "TE", "WR", "CB", "OLB", "MLB", "ROLB", "S"]);

  for (const player of [...offense, ...defense]) {
    let base_fatigue;
    if (skill_positions.has(player.position)) {
      base_fatigue = 1.8;  // skill players exert more per play
    } else {
      base_fatigue = 0.1;  // linemen/special teams, etc.
    }

    const endurance_factor = game_functions._tired(player) / 100;  // 0.0–1.0
    const fatigue = base_fatigue + (endurance_factor * base_fatigue);
    player.fatigue = Math.min(100, player.fatigue + fatigue);
  }
}


export function apply_pass_fatigue(offense, defense, receiver = null, yards = 0) {
  // Apply fatigue to offensive skill players
  for (const player of offense) {
    if (!(player.position === "WR" || player.position === "RB" || player.position === "TE")) {
      continue;
    }

    const base_fatigue = 1 + game_functions._tired(player) / 80;

    let fatigue;
    if (receiver !== null && player === receiver) {
      const effort = 1 + (yards / 10);
      fatigue = base_fatigue + effort * (1 + game_functions._tired(player) / 100);
    } else {
      fatigue = base_fatigue;
    }

    player.fatigue = Math.min(100, player.fatigue + round(fatigue));
  }

  // Apply lighter fatigue to defensive coverage players
  for (const player of defense) {
    if (!["CB", "S", "OLB", "MLB", "ROLB", "LOLB"].includes(player.position)) {
      continue;
    }

    const fatigue = 0.5 + game_functions._tired(player) / 120;  // ~0.5–1.3 range
    player.fatigue = Math.min(100, player.fatigue + round(fatigue, 1));
  }
}


export function apply_run_fatigue(offense, defense, rusher = null, yards = 0) {
  // Apply fatigue to offensive skill players
  for (const player of offense) {
    if (!(player.position === "RB" || player.position === "WR" || player.position === "TE")) {
      continue;
    }

    const base_fatigue = 1 + game_functions._tired(player) / 80;  // ~1–2.25

    let fatigue;
    if (rusher !== null && player === rusher) {
      const effort = 1 + (yards / 7);  // Runs are more tiring per yard than catches
      fatigue = base_fatigue + effort * (1 + game_functions._tired(player) / 100);
    } else {
      fatigue = base_fatigue * 0.75;  // lighter if just blocking/running a decoy route
    }

    player.fatigue = Math.min(100, player.fatigue + round(fatigue));
  }

  // Apply fatigue to front-seven defenders
  for (const player of defense) {
    if (["DL", "OLB", "MLB", "ROLB", "LOLB", "S"].includes(player.position)) {
      const fatigue = 0.6 + game_functions._tired(player) / 110;  // slightly higher than pass D
      player.fatigue = Math.min(100, player.fatigue + round(fatigue, 1));
    }
  }
}


export function summarize_stats(team) {
  const stat_totals = {};      // a defaultdict(int): a missing stat starts at 0

  for (const player of [...team.offense, ...team.defense]) {
    for (const stat of Object.keys(player.stats)) {
      const value = player.stats[stat];
      if (isNumber(value)) {
        stat_totals[stat] = get(stat_totals, stat, 0) + value;
      }
    }
  }

  // Add team-level stats
  stat_totals["kickoff_return_touchdowns"] = get(team.team_stats, "kickoff_return_touchdowns", 0);
  stat_totals["blocked_kicks"] = get(team.team_stats, "blocked_kicks", 0);
  stat_totals["blocked_punts"] = get(team.team_stats, "blocked_punts", 0);

  return {
    "Pass Attempts": get(stat_totals, "pass_attempts", 0),
    "Completions": get(stat_totals, "completions", 0),
    "Pass Yards": get(stat_totals, "pass_yards", 0),
    "Interceptions Thrown": get(stat_totals, "interceptions_thrown", 0),
    "Sacks Taken": get(stat_totals, "sacks_taken", 0),
    "Carries": get(stat_totals, "carries", 0),
    "Rush Yards": get(stat_totals, "rush_yards", 0),
    "Fumbles": get(stat_totals, "fumbles", 0),
    "Receptions": get(stat_totals, "receptions", 0),
    "Receiving Yards": get(stat_totals, "receiving_yards", 0),
    "Targets": get(stat_totals, "targets", 0),
    "Passing Touchdowns": get(stat_totals, "passing_touchdowns", 0),
    "Receiving Touchdowns": get(stat_totals, "receiving_touchdowns", 0),
    "Rushing Touchdowns": get(stat_totals, "rushing_touchdowns", 0),
    "Solo Tackles": get(stat_totals, "solo_tackles", 0),
    "Assisted Tackles": get(stat_totals, "assisted_tackles", 0),
    "Sacks": get(stat_totals, "sacks", 0),
    "Interceptions": get(stat_totals, "interceptions", 0),
    "Forced Fumbles": get(stat_totals, "forced_fumbles", 0),
    "PATs Made": get(stat_totals, "pat_made", 0),
    "PATS Attempted": get(stat_totals, "pat_attempts", 0),
    "Field Goals Made": get(stat_totals, "fg_made", 0),
    "Field Goals Attempted": get(stat_totals, "fg_attempted", 0),
    "Punts": get(stat_totals, "punts", 0),
    "Punt Yards": get(stat_totals, "punt_yards", 0),
    "Punt Net Yards": get(stat_totals, "punt_net_yards", 0),
    "Kickoff Returns": get(stat_totals, "kickoff_returns", 0),
    "Kickoff Return Yards": get(stat_totals, "kickoff_return_yards", 0),
    "Kickoff Return Touchdowns": get(stat_totals, "kickoff_return_touchdowns", 0),
    "Punt Returns": get(stat_totals, "punt_returns", 0),
    "Punt Return Yards": get(stat_totals, "punt_return_yards", 0),
    "Punt Return Touchdowns": get(stat_totals, "punt_return_touchdowns", 0),
    "Defensive Touchdowns": get(stat_totals, "defensive_touchdowns", 0),
    "Fumble Recoveries": get(stat_totals, "fumble_recoveries", 0),
    "Fumble Return Yards": get(stat_totals, "fumble_return_yards", 0),
    "Interception Return Yards": get(stat_totals, "interception_return_yards", 0),
    "Blocked Kicks": get(stat_totals, "blocked_kicks", 0),
    "Blocked Punts": get(stat_totals, "blocked_punts", 0),
    "Safeties": get(team.team_stats, "safeties", 0),
  };
}

export const game_functions = {
  TIRE_AVG, TIRE_PER_POINT, _tired,
  _add_stat,
  sim_kickoff,
  sim_pat,
  sim_two_point_conversion,
  fg_max_distance,
  get_punt_distance,
  apply_baseline_fatigue,
  apply_general_fatigue,
  apply_pass_fatigue,
  apply_run_fatigue,
  summarize_stats,
};
