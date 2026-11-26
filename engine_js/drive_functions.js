// The snap, the fourth-down decision, kicks, punts and the drive loop. The order of the random draws here is the
// game (engine_js/PORTING.md).
import { random, round, get, getattr, isNumber, truthy, sum, title, maxBy } from "./pyrt.js";
import { cfg } from "./game_config.js";
import { personnel } from "./personnel.js";
import { play_functions } from "./play_functions.js";
import { sit } from "./situation.js";
import { game_functions } from "./game_functions.js";
import { roster } from "./roster.js";

const RUN_PASS_TABLE = {
  1: [
    [3, 0.80],
    [6, 0.70],
    [10, 0.60],
    [Infinity, 0.45],
  ],
  2: [
    [3, 0.75],
    [6, 0.58],
    [10, 0.45],
    [Infinity, 0.30],
  ],
  3: [
    [2, 0.70],
    [5, 0.50],
    [9, 0.28],
    [Infinity, 0.12],
  ],
  4: [
    [1, 0.75],
    [2, 0.60],
    [3, 0.45],
    [6, 0.25],
    [Infinity, 0.08],
  ],
};

/** dict.clear() on a plain object: the same object, emptied in place. */
function _clear_dict(d) {
  for (const k of Object.keys(d)) delete d[k];
}

/** Lookup run% by down & distance. */
export function run_probability(down, to_go) {
  for (const [thresh, prob] of get(drive_functions.RUN_PASS_TABLE, down, [])) {
    if (to_go <= thresh) {
      return prob;
    }
  }
  return 0.25;
}

/**
 * Run or pass from the down-and-distance table, shifted by the coordinator's pass-rate
 * tendency (50 = the table as written; a flexbone team sits near 10).
 */
export function determine_offense_play(down, first_down, last_play_type = null, last_gain = 0, pass_rate = 50, run_shift = 0.0) {
  let run_chance = run_probability(down, first_down);
  if (last_play_type === "run" && last_gain >= 6) {
    run_chance += 0.1;
  } else if (last_play_type === "pass" && last_gain >= 10) {
    run_chance -= 0.05;
  }
  run_chance -= (pass_rate - 50) / 100 * cfg.PASS_RATE_EFFECT;
  run_chance -= cfg.PASS_LEAN;
  run_chance += run_shift;
  run_chance = Math.max(cfg.RUN_CHANCE_MIN, Math.min(pass_rate <= 5 ? cfg.RUN_CHANCE_MAX_OPTION : cfg.RUN_CHANCE_MAX, run_chance));
  return random.random() < run_chance ? "run" : "pass";
}

// The defensive call by down: (yards to go or fewer, the call the defense leans to, how often).
const DEFENSE_CALL_TABLE = {
  1: [
    [3, "defend_run", 0.75],
    [6, "defend_run", 0.60],
    [10, "defend_pass", 0.55],
    [Infinity, "defend_pass", 0.70],
  ],
  2: [
    [3, "defend_run", 0.65],
    [6, "defend_pass", 0.60],
    [10, "defend_pass", 0.70],
    [Infinity, "defend_pass", 0.80],
  ],
  3: [
    [3, "defend_run", 0.60],
    [6, "defend_pass", 0.70],
    [10, "defend_pass", 0.85],
    [Infinity, "defend_pass", 0.90],
  ],
};

/** Run or pass defense from the down-and-distance table; fourth down defends the pass. */
export function determine_defense_play(down, first_down) {
  for (const [limit, lean, chance] of get(drive_functions.DEFENSE_CALL_TABLE, down, [])) {
    if (first_down <= limit) {
      const other = lean === "defend_run" ? "defend_pass" : "defend_run";
      return random.random() < chance ? lean : other;
    }
  }
  return "defend_pass";
}

// Every snap, kick and punt of the game in order; game.js slices it into drives for the
// box score's play-by-play. Names come from play_functions.last_play. Nothing here draws
// a random number, so the log never changes a result.
// (`play_log` lives on the namespace object below: drive_functions.play_log.)

/** One line of the play log: the entry's fields are one object, in the order the caller wrote them. */
export function _log(entry) {
  Object.assign(entry, play_functions.last_play);
  drive_functions.play_log.push(entry);
  return entry;
}

/** Momentum after a snap (no random numbers; nothing happens unless cfg.MOMENTUM). */
export function _momentum_play(offense, defense, play_ran, result, yards, after, pre_down, fourth, safety) {
  if (!cfg.MOMENTUM) {
    return;
  }
  offense.momentum *= cfg.MOMENTUM_DECAY;
  defense.momentum *= cfg.MOMENTUM_DECAY;
  if (result === "defensive_touchdown") {
    offense.swing(-0.4); defense.swing(0.5);
  } else if (result === "interception" || result === "fumble") {
    offense.swing(-0.35); defense.swing(0.4);
  } else if (after === 6) {
    offense.swing(0.35); defense.swing(-0.25);
  } else if (truthy(safety)) {
    offense.swing(-0.3); defense.swing(0.3);
  } else if (result === "sack") {
    offense.swing(-0.06); defense.swing(0.1);
  } else if (result === "offensive penalty") {
    offense.swing(-0.03);
  } else if (result === "defensive penalty") {
    defense.swing(-0.03);
  } else if (result === "run" || result === "successful_pass" || result === "checkdown_pass") {
    if (isNumber(yards) && yards >= 20) {
      offense.swing(0.12); defense.swing(-0.06);
    } else if (play_ran === "run" && isNumber(yards) && yards < 0) {
      defense.swing(0.05);
    }
    if (after === 1 && pre_down === 3) {
      offense.swing(0.05);
    }
  }
  if (pre_down === 3 && after === 4) {
    defense.swing(0.05);
  }
  if (truthy(fourth)) {
    if (after === 1 || after === 6) {
      offense.swing(0.2); defense.swing(-0.15);
    } else if (after === 5) {
      offense.swing(-0.2); defense.swing(0.25);
    }
  }
}

export function _momentum_kick(offense, defense, kind, result) {
  if (!cfg.MOMENTUM) {
    return;
  }
  if (kind === "field_goal") {
    if (result === "good") {
      offense.swing(0.1);
    } else if (result === "blocked") {
      offense.swing(-0.25); defense.swing(0.25);
    } else {
      offense.swing(-0.15); defense.swing(0.1);
    }
  } else if (kind === "punt") {
    if (result === "blocked") {
      offense.swing(-0.25); defense.swing(0.25);
    } else if (result === "return_td") {
      offense.swing(-0.3); defense.swing(0.4);
    }
  }
}

/**
 * One snap: fatigue and substitutions, a possible penalty, then a run or a pass.
 * Returns [play_ran, result, yards, seconds_used, info] where info says whether the clock is
 * stopped until the next snap and whether the carrier went out of bounds.
 */
export function sim_play(offense_team, defense_team, down, first_down_yardage, yardline, hurrying = false, last_play_type = null, last_gain = 0, seconds_remaining = cfg.HALF_SECONDS, verbose = true, clock_stopped = true, situation = null, posture = null) {
  const sliders = cfg.sliders;
  // (both lineups are taken before the call that uses them, the offense's first)
  const _fatigue_offense = offense_team.get_offense();
  const _fatigue_defense = defense_team.get_defense();
  game_functions.apply_general_fatigue(_fatigue_offense, _fatigue_defense);
  offense_team.sub_skill_position_players(cfg.SKILL_SUB_FATIGUE);
  defense_team.sub_defensive_players(50);
  offense_team.recover_bench_players();
  defense_team.recover_bench_players();
  // Score situation (set by the game loop): garbage time, comebacks, victory formation.
  const lead = getattr(offense_team, "lead", 0);
  const half = getattr(offense_team, "half", 1);
  const overtime = getattr(offense_team, "in_overtime", false);
  const blowout = (half === 2 && lead >= cfg.GARBAGE_LEAD) || lead >= cfg.GARBAGE_LEAD_ANY;
  // Personnel for this snap: the offense's grouping from its scheme and the situation, the
  // defense's package in answer to it.
  const grouping = personnel.offense_grouping(getattr(offense_team, "offense_scheme", "Multiple"), down, first_down_yardage, yardline, blowout, hurrying);
  offense_team.set_grouping(grouping, personnel.GROUPINGS[grouping]);
  defense_team.set_front(personnel.defense_package(getattr(defense_team, "defense_scheme", "4-2-5"), grouping, down, first_down_yardage));
  const offense = offense_team.get_offense();
  const defense = defense_team.get_defense();
  for (const p of [...offense, ...defense]) {
    p.stats["snaps"] = get(p.stats, "snaps", 0) + 1;
  }

  const _off_t = getattr(offense_team, "tendencies", null);
  const off_tendencies = truthy(_off_t) ? _off_t : {};
  const _def_t = getattr(defense_team, "tendencies", null);
  const def_tendencies = truthy(_def_t) ? _def_t : {};
  let tendencies = off_tendencies;      // this snap's copy gains the situation's keys below

  // Clock pace: higher game-speed slider means faster plays; plays drag late in a half.
  let game_speed_mult = 2.0 - sliders.get_multiplier(sliders.game_speed);
  game_speed_mult *= 1.0 - (get(tendencies, "tempo", 50) - 50) / 100 * cfg.TEMPO_EFFECT;
  const progress = Math.max(0.0, Math.min(1.0, 1.0 - seconds_remaining / cfg.HALF_SECONDS));
  const drag = 1.0 + progress * cfg.LATE_GAME_DRAG;
  situation = truthy(situation) ? situation : sit.assess(offense_team, defense_team, seconds_remaining, down, first_down_yardage, yardline, clock_stopped);
  posture = truthy(posture) ? posture : sit.defense_posture(offense_team, defense_team, seconds_remaining);

  let run_shift = 0.0;
  if (!truthy(overtime)) {
    const hopeless = (half === 2 && -lead >= cfg.GARBAGE_LEAD) || -lead >= cfg.GARBAGE_LEAD_ANY;
    if (blowout) {
      game_speed_mult *= cfg.GARBAGE_CLOCK;
      run_shift += cfg.GARBAGE_RUN_SHIFT;
      hurrying = false;
      tendencies = { ...tendencies, conservative: true };
    } else if (hopeless) {
      game_speed_mult *= 1 + (cfg.GARBAGE_CLOCK - 1) * 0.7;
      run_shift += cfg.GARBAGE_RUN_SHIFT * 0.6;
      hurrying = false;
    } else if (half === 2 && -lead >= cfg.COMEBACK_LEAD && seconds_remaining <= cfg.QUARTER_SECONDS) {
      run_shift -= 0.2;
      hurrying = true;
    }
    // Starters sit once the game is decided, on both sides: the leader rests its stars
    // and the trailing team plays its backups too (as real teams do in a blowout).
    const decided = Math.abs(lead) >= cfg.BENCH_LEAD && (half === 2 || Math.abs(lead) >= cfg.GARBAGE_LEAD_ANY);
    if (decided) {
      offense_team.rest_starters("offense");
      defense_team.rest_starters("defense");
    } else if (Math.abs(lead) < cfg.BENCH_LEAD - 14) {
      offense_team.restore_starters("offense");
      defense_team.restore_starters("defense");
    }
  }

  const pace_mult = game_speed_mult * drag;

  function clock(result, oob = false, first_down = false) {
    const [secs, stopped] = sit.play_clock(result, oob, first_down, seconds_remaining, situation, posture,
      offense_team, defense_team, pace_mult);
    return [Math.max(1, secs), { stopped: stopped, oob: oob }];
  }

  _clear_dict(play_functions.last_play);
  let off_penalty_chance = sliders.get_inverse_percentage_adjustment(sliders.offensive_penalties, cfg.OFF_PENALTY_CHANCE);
  // ratings v2: a smart unit commits fewer penalties
  off_penalty_chance *= Math.max(0.5, 1 - _unit_iq(offense) * cfg.PENALTY_IQ_EFFECT);
  off_penalty_chance *= Math.max(0.5, 1 - (get(off_tendencies, "discipline", 50) - 50) * cfg.DISCIPLINE_EFFECT);
  if (random.random() < off_penalty_chance) {
    const penalty_type = random.choices(
      ["false_start", "holding", "offensive_pass_interference", "delay_of_game"],
      { weights: [0.3, 0.4, 0.15, 0.15], k: 1 })[0];
    const penalty_yards = { false_start: -5, holding: -10, offensive_pass_interference: -15, delay_of_game: -5 }[penalty_type];
    offense_team.team_stats["penalties"] += 1;
    offense_team.team_stats["penalty_yards"] += Math.abs(penalty_yards);
    if (verbose) {
      console.log(`Penalty: ${title(penalty_type.replaceAll("_", " "))} for ${Math.abs(penalty_yards)} yards`);
    }
    play_functions.last_play["penalty"] = penalty_type.replaceAll("_", " ");
    return ["penalty", "offensive penalty", penalty_yards, ...clock("offensive penalty")];
  }

  let def_penalty_chance = sliders.get_inverse_percentage_adjustment(sliders.defensive_penalties, cfg.DEF_PENALTY_CHANCE);
  def_penalty_chance *= Math.max(0.5, 1 - _unit_iq(defense) * cfg.PENALTY_IQ_EFFECT);
  def_penalty_chance *= Math.max(0.5, 1 - (get(def_tendencies, "discipline", 50) - 50) * cfg.DISCIPLINE_EFFECT);
  if (random.random() < def_penalty_chance) {
    const penalty_type = random.choices(["offside", "pass_interference", "facemask"], { weights: [0.4, 0.4, 0.2], k: 1 })[0];
    let penalty_yards;
    if (penalty_type === "offside") {
      penalty_yards = 5;
    } else if (penalty_type === "pass_interference") {
      penalty_yards = random.randint(10, 25);
    } else {
      penalty_yards = 15;
    }
    defense_team.team_stats["penalties"] += 1;
    defense_team.team_stats["penalty_yards"] += penalty_yards;
    if (verbose) {
      console.log(`Defensive Penalty: ${title(penalty_type.replaceAll("_", " "))}`);
    }
    play_functions.last_play["penalty"] = penalty_type.replaceAll("_", " ");
    return ["penalty", "defensive penalty", penalty_yards, ...clock("defensive penalty")];
  }

  // Victory formation: kneel it out (the leader can burn the rest of the clock).
  if (truthy(get(situation, "kneel"))) {
    let secs = cfg.KNEEL_PLAY_SECONDS;
    if (getattr(defense_team, "timeouts", 0) > 0) {
      defense_team.timeouts -= 1;       // the defense stops the clock after the kneel
    } else {
      secs += cfg.KNEEL_RUNOFF;
    }
    play_functions.last_play["kneel"] = true;
    return ["run", "run", -1, Math.max(1, Math.min(secs, Math.max(1, seconds_remaining))), { stopped: false, oob: false, kneel: true }];
  }
  // Spike: stop the clock at the cost of a down.
  if (truthy(get(situation, "spike"))) {
    let qb = null;
    for (const p of offense) {
      if (p.position === "QB") { qb = p; break; }
    }
    if (qb !== null) {
      qb.stats["pass_attempts"] += 1;
    }
    play_functions.last_play["spike"] = true;
    return ["pass", "incomplete", 0, ...clock("spike")];
  }
  run_shift += get(situation, "pass_shift", 0.0);
  tendencies = { ...tendencies, big_play_mult: get(situation, "big_play_mult", 1.0), prevent: get(posture, "prevent", false) };
  const offense_play = determine_offense_play(down, first_down_yardage, last_play_type, last_gain,
    get(tendencies, "pass_rate", 50), run_shift);
  let defense_play = determine_defense_play(down, first_down_yardage);
  // The better play caller tilts the guessing game.
  const edge = (get(def_tendencies, "dc_play_calling", 50) - get(tendencies, "oc_play_calling", 50)) / 100 * cfg.PLAY_CALLING_EFFECT;
  if (edge > 0 && random.random() < edge) {
    defense_play = "defend_" + offense_play;
  } else if (edge < 0 && random.random() < -edge) {
    defense_play = offense_play === "run" ? "defend_pass" : "defend_run";
  }
  const guessed_play = defense_play.includes(offense_play);
  let play_ran, result, yards_gained;
  if (offense_play === "run") {
    play_ran = "run";
    [result, yards_gained] = play_functions.get_run_yards(offense, defense, down, first_down_yardage, guessed_play, yardline, undefined, tendencies);
  } else {
    play_ran = "pass";
    [result, yards_gained] = play_functions.get_pass_yards(offense, defense, down, first_down_yardage, guessed_play, yardline, undefined, tendencies,
      get(def_tendencies, "blitz_rate", 50), def_tendencies);
  }
  const oob = sit.out_of_bounds(result, situation, posture);
  const first_down = (result === "run" || result === "successful_pass" || result === "checkdown_pass") && isNumber(yards_gained) && yards_gained >= first_down_yardage;
  if (truthy(cfg.INJURIES)) {
    roll_injuries(offense_team, offense);
    roll_injuries(defense_team, defense);
  }
  return [play_ran, result, yards_gained, ...clock(result, oob, first_down)];
}

/** The on-field unit's average Football IQ (card points over the average starter in each one's card group). */
export function _unit_iq(players) {
  const vals = [];
  for (const p of players) vals.push(p._iq);
  return vals.length ? sum(vals) / vals.length : 0.0;
}

/**
 * Each player on the field can go down on a snap; most injuries end only his day,
 * some cost weeks. Uses the injury RNG so results are unchanged when injuries are off.
 */
export function roll_injuries(team, on_field) {
  const rng = cfg.injury_rng;
  for (const p of on_field) {
    if (p.position === "K" || p.position === "P") {
      continue;
    }
    if (rng.random() < cfg.INJURY_PER_SNAP * get(cfg.INJURY_POSITION_MULT, p.position, 1.0) * p._durable) {
      const r = rng.random();
      let weeks, found = false;
      for (const [cum, w] of cfg.INJURY_SEVERITY) {
        if (r <= cum) { weeks = w; found = true; break; }
      }
      if (!found) throw new Error("StopIteration");
      team.injure(p, weeks, rng.choice(cfg.INJURY_TYPES));
    }
  }
}

/**
 * Apply a play result to down, distance and yardline. Returns
 * [down, first_down_yardage, yardline, safety_occurred]; down 5 = turnover, 6 = touchdown.
 */
export function process_play(result, play_type, yards, yardline, down, first_down_yardage) {
  let safety_occurred = false;
  if (result === "defensive_touchdown") {
    return [down, first_down_yardage, yardline, safety_occurred];
  }
  if (result === "fumble" || result === "interception") {
    // `yards` is the spot where the defense ended up, in the offense's direction.
    return [5, first_down_yardage, yards, safety_occurred];
  }
  if (result === "run" || result === "successful_pass" || result === "checkdown_pass") {
    yardline += yards;
    first_down_yardage -= yards;
    down += 1;
  } else if (result === "offensive penalty") {
    const pre_penalty_yardline = yardline;
    yardline = Math.max(1, yardline + yards);
    first_down_yardage += pre_penalty_yardline - yardline;
  } else if (result === "defensive penalty") {
    let actual_penalty;
    if (yardline + yards >= 100) {
      actual_penalty = 99 - yardline;   // half the distance: never a touchdown by penalty
      yardline = 99;
    } else {
      yardline += yards;
      actual_penalty = yards;
    }
    first_down_yardage = Math.max(0, first_down_yardage - actual_penalty);
  } else if (result === "sack") {
    if (yardline + yards <= 0) {
      safety_occurred = true;
      yardline = 0;
    } else {
      down += 1;
      yardline += yards;
      first_down_yardage -= yards;
    }
  } else if (result === "incomplete") {
    down += 1;
  }
  if (yardline >= 100) {
    down = 6;
  }
  if (first_down_yardage <= 0 && down !== 6) {
    down = 1;
    first_down_yardage = 10;
  }
  return [down, first_down_yardage, yardline, safety_occurred];
}

/**
 * Fourth-down decision. FBS teams go for it about 2.1 times a game and convert
 * about 53%: mostly short yardage in plus territory, plus desperation tries when
 * trailing late in the game.
 */
export function should_go_for_it(distance, yardline, seconds_remaining = cfg.HALF_SECONDS, trailing_late = false, go_rate = 50, lead = 0) {
  const late = seconds_remaining < 300;
  const one_score_early = truthy(trailing_late) && -lead <= 8 && seconds_remaining > cfg.TRAILING_DESPERATE_SECONDS;
  if (one_score_early) {
    // down one score with time left: still mostly normal football, a bit bolder
    trailing_late = false;
  }
  let table;
  if (truthy(trailing_late)) {
    table = yardline >= 35 ? [[2, 0.95], [5, 0.80], [10, 0.60], [99, 0.35]] : [[2, 0.6], [99, 0.3]];
  } else if (yardline >= 80) {
    table = [[1, 0.90], [2, 0.65], [3, 0.50], [5, 0.40], [99, 0.12]];
  } else if (yardline >= 60) {
    table = [[1, 0.90], [2, 0.72], [3, 0.58], [5, 0.45], [8, 0.22], [99, 0.08]];
  } else if (yardline >= 50) {
    table = [[1, 0.85], [2, 0.68], [3, 0.55], [6, 0.40], [99, 0.10]];
  } else if (yardline >= 40) {
    table = [[1, 0.55], [2, 0.38], [3, 0.18], [6, 0.10], [99, 0.0]];
  } else {
    table = [[1, late ? 0.50 : 0.18], [3, late ? 0.15 : 0.02], [99, 0.0]];
  }
  let chance, found = false;
  for (const [limit, p] of table) {
    if (distance <= limit) { chance = p; found = true; break; }
  }
  if (!found) throw new Error("StopIteration");
  if (!truthy(trailing_late) && (yardline < 60 || distance <= 2)) {
    // more tries around midfield and on short yardage; in field-goal range they kick
    chance = Math.min(0.95, chance * cfg.FOURTH_DOWN_AGGRESSION);
  }
  chance *= 1.0 + (go_rate - 50) / 100 * cfg.FOURTH_DOWN_TENDENCY_EFFECT;
  if (one_score_early) {
    chance = Math.min(0.95, chance * cfg.TRAILING_ONE_SCORE_BOLDNESS);
  }
  if (lead >= cfg.BENCH_LEAD) {
    chance = 0.0;
  } else if (lead >= 17) {
    chance *= 0.25;
  }
  return random.random() < chance;
}

/** `getattr(player, "traits", None) or {}`. */
function _traits_of(player) {
  const t = getattr(player, "traits", null);
  return truthy(t) ? t : {};
}

/** Field goal try. Returns [made, blocked]. */
export function attempt_kick(yardline, kicker, defense_team = null) {
  const sliders = cfg.sliders;
  kicker.stats["fg_attempted"] += 1;
  if (random.random() < 0.01) {
    if (defense_team) {
      defense_team.team_stats["blocked_kicks"] += 1;
    }
    return [false, true];
  }
  const distance = (100 - yardline) + 17;
  let make, found = false;
  for (const [limit, prob] of cfg.FG_MAKE) {
    if (distance <= limit) { make = prob; found = true; break; }
  }
  if (!found) throw new Error("StopIteration");
  make *= sliders.get_multiplier(sliders.kicking_accuracy);
  make += (kicker.kick_accuracy || 0) * cfg.FG_PER_ACCURACY_POINT;
  if (distance < 40) {
    make += get(_traits_of(kicker), "automatic", 0) * cfg.TRAIT_FX["automatic"];
  }
  if (kicker !== null && truthy(play_functions.CLUTCH_NOW[0])) {   // nerves of steel late
    const t = _traits_of(kicker);
    make += (get(t, "ice_water", 0) + get(t, "clutch_leg", 0)) * cfg.TRAIT_FX["ice_water"];
  }
  make = Math.max(0.03, Math.min(0.98, make));
  const made = random.random() < make;
  let bucket;
  if (distance >= 50) {
    bucket = "fg_50";
  } else if (distance >= 40) {
    bucket = "fg_40";
  } else {
    bucket = "fg_short";
  }
  kicker.stats[bucket + "_att"] = get(kicker.stats, bucket + "_att", 0) + 1;
  if (made) {
    kicker.stats["fg_made"] += 1;
    kicker.stats[bucket + "_made"] = get(kicker.stats, bucket + "_made", 0) + 1;
    if (distance > get(kicker.stats, "long_fg", 0)) {
      kicker.stats["long_fg"] = distance;
    }
  }
  return [made, false];
}

/** The field goal as the play log and momentum name it. */
export function _fg_result(made, blocked) {
  if (blocked) {
    return "blocked";
  }
  return made ? "good" : "missed";
}

/**
 * Punt and return. Returns [final_yardline, punt_yards, is_blocked, returner, return_yards,
 * is_return_td, how] and records the punter's stats (gross and net yards, inside the 20,
 * touchbacks, long) and the returner's. `how` is how the punt ended: returned, fair_catch,
 * downed, out_of_bounds, touchback, blocked or fake. punt_yards is the gross (official)
 * distance; net is the gross less the return, and 20 yards less on a touchback.
 */
export function attempt_punt(yardline, punter, defense_team = null, return_team = null) {
  const [final_spot, gross, blocked, returner, return_yards, td, how] = _attempt_punt(yardline, punter, defense_team, return_team);
  const st = punter.stats;
  st["punts"] += 1;
  if (!blocked && how !== "fake") {
    st["punt_yards"] += gross;
    st["punt_net_yards"] = get(st, "punt_net_yards", 0) + gross - return_yards - (how === "touchback" ? 20 : 0);
    if (gross > get(st, "long_punt", 0)) {
      st["long_punt"] = gross;
    }
    if (how === "touchback") {
      st["punt_touchbacks"] = get(st, "punt_touchbacks", 0) + 1;
    } else if (!td && final_spot >= 80) {
      st["punts_inside_20"] = get(st, "punts_inside_20", 0) + 1;
    }
  }
  if (returner !== null && how === "returned") {
    const rs = returner.stats;
    rs["punt_returns"] = get(rs, "punt_returns", 0) + 1;
    rs["punt_return_yards"] = get(rs, "punt_return_yards", 0) + return_yards;
    if (td) {
      rs["punt_return_touchdowns"] = get(rs, "punt_return_touchdowns", 0) + 1;
    }
    if (return_yards > get(rs, "long_punt_return", 0)) {
      rs["long_punt_return"] = return_yards;
    }
  }
  return [final_spot, gross, blocked, returner, return_yards, td, how];
}

/**
 * Yards on a punt that is returned: mostly short (a typical return is 4-7 yards, a few
 * lose yards), with the odd breakaway that pulls the average up to about 8-9.
 */
export function _punt_return_yards(returner) {
  const sliders = cfg.sliders;
  let mult = sliders.get_multiplier(sliders.kickoff_return);   // the return slider covers both kicks
  mult *= 1 + (roster.return_skill(returner) - cfg.PUNT_RETURNER_TYPICAL) * cfg.PUNT_RETURN_SKILL;
  const [chance, mean, sd] = cfg.PUNT_BREAKAWAY;
  if (random.random() < chance * mult) {
    return Math.max(15, round(random.gauss(mean, sd)));
  }
  const [shape, scale] = cfg.PUNT_RETURN_YARDS;
  return round(random.gammavariate(shape, scale) * mult) - 2;
}

/**
 * The kick and what happens to it. Returns [final_yardline, gross_yards, is_blocked,
 * returner, return_yards, is_return_td, how]; attempt_punt keeps the stats.
 */
export function _attempt_punt(yardline, punter, defense_team = null, return_team = null) {
  const sliders = cfg.sliders;
  // College chaos: an occasional fake from the punter's own side of the field, treated as
  // a failed one (the ball goes over where it was snapped).
  if (yardline < 50 && random.random() < 0.003) {
    return [yardline, 0, false, null, 0, false, "fake"];
  }
  if (random.random() < 0.005) {
    if (defense_team) {
      defense_team.team_stats["blocked_punts"] += 1;
    }
    return [yardline, 0, true, null, 0, false, "blocked"];
  }

  const landing = yardline + game_functions.get_punt_distance(punter);

  // Would carry inside the 10: the punter aims short of the goal line (a pooch or a
  // coffin-corner kick) and either pins the receiving team or loses it into the end zone.
  if (landing >= 90) {
    let pin = cfg.PUNT_PIN_CHANCE + (punter.punt_accuracy || 0) * cfg.PUNT_PIN_PER_POINT;
    pin += get(_traits_of(punter), "pin_artist", 0) * cfg.TRAIT_FX["pin_artist"];   // a pin artist pins more
    if (random.random() < pin) {
      const spot = Math.min(landing, random.randint(88, 99));
      return [spot, spot - yardline, false, null, 0, false, random.choice(["fair_catch", "downed", "out_of_bounds"])];
    }
    return [80, 100 - yardline, false, null, 0, false, "touchback"];
  }

  let returner = return_team ? return_team.get_punt_returner() : null;
  if (returner === undefined) returner = null;
  if (returner !== null) {
    return_team.refresh_ratings([returner]);
  }
  const [deep, short] = cfg.PUNT_RETURN_CHANCE;
  if (returner !== null && random.random() < (landing >= 80 ? short : deep)) {
    const gross = landing - yardline;
    const td_chance = cfg.PUNT_RETURN_TD * sliders.get_multiplier(sliders.kickoff_return)
      * (1 + (roster.return_skill(returner) - cfg.PUNT_RETURNER_TYPICAL) * cfg.PUNT_RETURN_SKILL);
    if (random.random() < td_chance) {
      return [100, gross, false, returner, landing, true, "returned"];
    }
    const ret = Math.min(_punt_return_yards(returner), landing - 1);
    return [landing - ret, gross, false, returner, ret, false, "returned"];
  }

  // Not returned: a fair catch where it comes down, downed after it rolls on, or out of bounds.
  const [fair, downed, _] = cfg.PUNT_UNRETURNED;
  const r = random.random();
  let spot, how;
  if (r < fair) {
    [spot, how] = [landing, "fair_catch"];
  } else if (r < fair + downed) {
    [spot, how] = [landing + round(random.gauss(...cfg.PUNT_ROLL)), "downed"];
  } else {
    [spot, how] = [landing - random.randint(0, 4), "out_of_bounds"];
  }
  if (spot >= 100) {
    return [80, 100 - yardline, false, null, 0, false, "touchback"];
  }
  spot = Math.min(spot, 99);
  return [spot, spot - yardline, false, null, 0, false, how];
}

/** Field goal with the clock about to run out, on any down. */
export function _clutch_kick(offense, defense, kicker, yardline, seconds_remaining, in_red_zone, play_ran) {
  seconds_remaining -= random.randint(4, 6);
  play_functions.CLUTCH_NOW[0] = true;   // the kick with time running out
  const [kick_made, kick_blocked] = attempt_kick(yardline, kicker, defense);
  const result = kick_made && !kick_blocked ? "field goal" : "missed kick";
  if (in_red_zone && result === "field goal") {
    offense.team_stats["red_zone_scores"] += 1;
  }
  const fg_result = _fg_result(kick_made, kick_blocked);
  _clear_dict(play_functions.last_play);
  _log({
    type: "field_goal", result: fg_result, distance: (100 - yardline) + 17,
    down: null, dist: null, yl: yardline, kicker: kicker ? kicker.name : null, left: seconds_remaining, clutch: true,
  });
  _momentum_kick(offense, defense, "field_goal", fg_result);
  return [play_ran, result, yardline, seconds_remaining];
}

/** One deep throw with the clock at zero. */
export function _hail_mary(offense, defense, yardline, seconds_remaining) {
  const players = offense.get_offense();
  let qb = null;
  for (const p of players) {
    if (p.position === "QB") { qb = p; break; }
  }
  const targets = players.filter((p) => p.position === "WR" || p.position === "TE");
  seconds_remaining -= random.randint(5, 8);
  if (qb === null || !targets.length) {
    return ["pass", "end_of_half", yardline, seconds_remaining];
  }
  const target = maxBy(targets, (p) => (p.hands || 0) + (p.speed || 0));
  _clear_dict(play_functions.last_play);
  const hm = _log({ type: "pass", result: "incomplete", down: null, dist: null, yl: yardline, yards: 0, to: yardline, left: seconds_remaining, hail_mary: true, qb: qb.name, target: target.name, target_pos: target.position });
  qb.stats["pass_attempts"] += 1;
  target.stats["targets"] += 1;
  if (random.random() < cfg.HAIL_MARY_SUCCESS * (1 + getattr(qb, "passing", 0) * cfg.HAIL_MARY_PER_POINT)) {
    const yards = 100 - yardline;
    qb.stats["completions"] += 1;
    qb.stats["pass_yards"] += yards;
    qb.stats["passing_touchdowns"] += 1;
    target.stats["receptions"] += 1;
    target.stats["receiving_yards"] += yards;
    target.stats["receiving_touchdowns"] += 1;
    play_functions.debug_td_stats.push({ type: "passing", qb: qb.name, receiver: target.name, receiver_position: target.position });
    Object.assign(hm, { result: "successful_pass", yards: yards, to: 100, after: 6 });
    return ["pass", "touchdown", 100, seconds_remaining];
  }
  return ["pass", "end_of_half", yardline, seconds_remaining];
}

/** First downs and red-zone trips after a snap. Returns whether the drive is now in the red zone. */
export function _count_progress(offense, result, down, yardline, in_red_zone) {
  if (down === 1 && (result === "run" || result === "successful_pass" || result === "checkdown_pass" || result === "defensive penalty")) {
    offense.team_stats["first_downs"] += 1;
  }
  if (!in_red_zone && yardline >= 80 && down < 5) {
    offense.team_stats["red_zone_trips"] += 1;
    return true;
  }
  return in_red_zone;
}

/**
 * Run one drive. Returns [last_play_type, result, yardline, seconds_remaining].
 *
 * Results: touchdown, field goal, missed kick, punt, turnover, safety,
 * defensive_touchdown, punt_return_td, first_down (fallback).
 */
export function sim_drive(offense, defense, down, first_down_yardage, yardline, seconds_remaining, hurrying = false, verbose = true, _red_zone_counted = false, trailing_late = false) {
  const kicker = offense.get_kicker();
  const punter = offense.get_punter();
  const last_play_type = null;
  const last_gain = 0;
  let result = "";
  let play_ran = "";  // Initialize play_ran to track the type of play
  let in_red_zone = yardline >= 80;
  if (in_red_zone && !_red_zone_counted) {
    offense.team_stats["red_zone_trips"] += 1;
  }
  let clock_stopped = true;   // a drive starts after a change of possession: the clock starts on the snap
  let yards_gained, time, info, safety_occurred;
  while (down < 4) {
    if (verbose) {
      console.log(down, "and", first_down_yardage, "at the", yardline);
    }
    const was_third = down === 3;
    const situation = sit.assess(offense, defense, seconds_remaining, down, first_down_yardage, yardline, clock_stopped);
    const posture = sit.defense_posture(offense, defense, seconds_remaining);
    if (truthy(get(situation, "fg_now"))) {
      return _clutch_kick(offense, defense, kicker, yardline, seconds_remaining, in_red_zone, play_ran || "pass");
    }
    if (truthy(get(situation, "hail_mary"))) {
      return _hail_mary(offense, defense, yardline, seconds_remaining);
    }
    const pre = [down, first_down_yardage, yardline];
    [play_ran, result, yards_gained, time, info] = sim_play(offense, defense, down, first_down_yardage, yardline, hurrying, last_play_type, last_gain, seconds_remaining, false, clock_stopped, situation, posture);
    clock_stopped = get(info, "stopped", false);
    seconds_remaining -= time;
    [down, first_down_yardage, yardline, safety_occurred] = process_play(result, play_ran, yards_gained, yardline, down, first_down_yardage);
    _log({ type: play_ran, result: result, down: pre[0], dist: pre[1], yl: pre[2], yards: yards_gained, to: yardline, after: down, secs: time, left: seconds_remaining, safety: safety_occurred });
    _momentum_play(offense, defense, play_ran, result, yards_gained, down, pre[0], false, safety_occurred);
    if (was_third && result !== "offensive penalty" && result !== "defensive penalty") {
      offense.team_stats["third_downs"] += 1;
      if (down === 1 || down === 6) {
        offense.team_stats["third_down_conversions"] += 1;
      }
    }
    in_red_zone = _count_progress(offense, result, down, yardline, in_red_zone);
    if (safety_occurred) {
      return [play_ran, "safety", yardline, seconds_remaining];
    }
    if (result === "defensive_touchdown") {
      // Pick-six or fumble return: the drive is over and the defense scored.
      return [play_ran, result, yardline, seconds_remaining];
    }
    if (seconds_remaining <= 0 && down < 4) {
      return [play_ran, "end_of_half", yardline, seconds_remaining];
    }
  }
  if (down === 4 && seconds_remaining <= 0) {
    return [play_ran, "end_of_half", yardline, seconds_remaining];
  }
  if (down === 4) {
    const _t = getattr(offense, "tendencies", {});
    const go_rate = get(truthy(_t) ? _t : {}, "fourth_down_go_rate", 50);
    const situation = sit.assess(offense, defense, seconds_remaining, down, first_down_yardage, yardline, clock_stopped);
    const posture = sit.defense_posture(offense, defense, seconds_remaining);
    if (truthy(get(situation, "fg_now"))) {
      return _clutch_kick(offense, defense, kicker, yardline, seconds_remaining, in_red_zone, play_ran || "pass");
    }
    if (truthy(get(situation, "hail_mary"))) {
      return _hail_mary(offense, defense, yardline, seconds_remaining);
    }
    const lead_now = getattr(offense, "lead", 0);
    const _mode = get(situation, "mode");
    const must_go = (_mode === "hurry" || _mode === "desperate") && lead_now < -3 && seconds_remaining <= cfg.HURRY_SECONDS_TRAILING / 2;
    // down 1-3 late with a makeable kick: take the points to tie or go ahead
    const tying_kick = (truthy(trailing_late) && (-3 <= lead_now && lead_now < 0)
      && (100 - yardline) + 17 <= Math.min(game_functions.fg_max_distance(kicker), cfg.TYING_KICK_MAX_DISTANCE));
    if (must_go || should_go_for_it(first_down_yardage, yardline, seconds_remaining, truthy(trailing_late) && !tying_kick, go_rate, lead_now)) {
      const pre = [down, first_down_yardage, yardline];
      [play_ran, result, yards_gained, time, info] = sim_play(offense, defense, down, first_down_yardage, yardline, hurrying, last_play_type, last_gain, seconds_remaining, false, clock_stopped, situation, posture);
      clock_stopped = get(info, "stopped", false);
      seconds_remaining -= time;
      [down, first_down_yardage, yardline, safety_occurred] = process_play(result, play_ran, yards_gained, yardline, down, first_down_yardage);
      _log({ type: play_ran, result: result, down: pre[0], dist: pre[1], yl: pre[2], yards: yards_gained, to: yardline, after: down, secs: time, left: seconds_remaining, safety: safety_occurred, fourth: true });
      _momentum_play(offense, defense, play_ran, result, yards_gained, down, pre[0], true, safety_occurred);
      if (result !== "offensive penalty" && result !== "defensive penalty") {
        offense.team_stats["fourth_down_attempts"] += 1;
        if (down === 1 || down === 6) {
          offense.team_stats["fourth_down_conversions"] += 1;
        }
      }
      in_red_zone = _count_progress(offense, result, down, yardline, in_red_zone);
      if (safety_occurred) {
        return [play_ran, "safety", yardline, seconds_remaining];
      }
      if (result === "defensive_touchdown") {
        return [play_ran, result, yardline, seconds_remaining];
      }
      if (down === 1 || down === 4) {
        // Converted (fresh set of downs) or a penalty kept it 4th down: keep driving.
        return sim_drive(offense, defense, down, first_down_yardage, yardline, seconds_remaining, hurrying, verbose, in_red_zone, trailing_late);
      }
    } else {
      const fg_distance = (100 - yardline) + 17;
      let in_range = fg_distance <= game_functions.fg_max_distance(kicker);
      if (in_range && fg_distance >= 50 && random.random() > cfg.FG_LONG_ATTEMPT_CHANCE) {
        in_range = false;   // coach punts rather than try the long one
      }
      if (in_range) {
        const kick_time = random.randint(5, 7);
        seconds_remaining -= kick_time;
        const [kick_made, kick_blocked] = attempt_kick(yardline, kicker, defense);
        if (kick_blocked) {
          if (verbose) {
            console.log("Field goal BLOCKED!");
          }
          result = "missed kick";
        } else if (kick_made) {
          if (verbose) {
            console.log((100 - yardline) + 17, "yard kick is good!");
          }
          result = "field goal";
        } else {
          result = "missed kick";
        }
        const fg_result = _fg_result(kick_made, kick_blocked);
        _clear_dict(play_functions.last_play);
        _log({
          type: "field_goal", result: fg_result, distance: fg_distance,
          down: 4, dist: first_down_yardage, yl: yardline, kicker: kicker ? kicker.name : null, secs: kick_time, left: seconds_remaining,
        });
        _momentum_kick(offense, defense, "field_goal", fg_result);
      } else {
        const punt_from = yardline;
        let punt_distance, punt_blocked, returner, return_yards, is_return_td, punt_how;
        [yardline, punt_distance, punt_blocked, returner, return_yards, is_return_td, punt_how] = attempt_punt(yardline, punter, defense, defense);  // the defense returns the punt
        if (punt_how === "returned" && !is_return_td) {
          play_functions.credit_coverage_tackle(offense);
        }
        const punt_time = random.randint(6, 10);
        seconds_remaining -= punt_time;
        let punt_result;
        if (punt_blocked) {
          punt_result = "blocked";
        } else if (is_return_td) {
          punt_result = "return_td";
        } else {
          punt_result = "punt";
        }
        _clear_dict(play_functions.last_play);
        _log({
          type: "punt", result: punt_result, yards: punt_distance,
          down: 4, dist: first_down_yardage, yl: punt_from, to: yardline, punter: punter ? punter.name : null,
          returner: returner ? returner.name : null, return_yards: return_yards, how: punt_how,
          secs: punt_time, left: seconds_remaining,
        });
        _momentum_kick(offense, defense, "punt", punt_result);
        if (punt_blocked) {
          if (verbose) {
            console.log("Punt BLOCKED!");
          }
          result = "turnover";  // Blocked punt is a turnover
        } else if (is_return_td) {
          if (verbose) {
            console.log(`PUNT RETURN TOUCHDOWN by ${returner ? returner.name : "Unknown"}!`);
          }
          result = "punt_return_td";
        } else {
          if (verbose) {
            console.log(`${punt_distance} yard punt.`);
          }
          result = "punt";
        }
      }
    }
  }
  const _scrimmage = result === "run" || result === "successful_pass" || result === "checkdown_pass";
  if (in_red_zone && result === "field goal") {
    offense.team_stats["red_zone_scores"] += 1;
  }
  if (in_red_zone && down === 6 && _scrimmage) {
    offense.team_stats["red_zone_scores"] += 1;
    offense.team_stats["red_zone_touchdowns"] += 1;
  }
  if (down === 5) {
    result = "turnover";
  }
  if (down === 6) {
    if (result === "run" || result === "successful_pass" || result === "checkdown_pass") {
      result = "touchdown";
    } else {
      // Reached the goal line on a play that is not a scoring play (a penalty):
      // treat it as first and goal at the 1 rather than a touchdown.
      result = "first_down";
      yardline = 1;
      down = 1;
      first_down_yardage = 10;
    }
  }
  return [play_ran, result, yardline, seconds_remaining];
}

export const drive_functions = {
  RUN_PASS_TABLE,
  run_probability,
  determine_offense_play,
  DEFENSE_CALL_TABLE,
  determine_defense_play,
  play_log: [],
  _log,
  _momentum_play,
  _momentum_kick,
  sim_play,
  _unit_iq,
  roll_injuries,
  process_play,
  should_go_for_it,
  attempt_kick,
  _fg_result,
  attempt_punt,
  _punt_return_yards,
  _attempt_punt,
  _clutch_kick,
  _hail_mary,
  _count_progress,
  sim_drive,
};
