import random
from .game_functions import apply_pass_fatigue, apply_run_fatigue
from .game_config import sliders
from . import game_config as cfg

# Debug tracking for touchdown stat assignments
debug_td_stats = []

#{'pass_attempts': 0, 'completions': 0, 'pass_yards': 0, 'interceptions_thrown': 0, 'sacks_taken': 0, 'carries': 0, 
# 'rush_yards': 0, 'fumbles': 0, 'receptions': 0, 'receiving_yards': 0, 'targets': 0, 'passing_touchdowns': 0, 
# 'receiving_touchdowns': 0, 'rushing_touchdowns': 0}
def handle_qb_scramble(qb, verbose=False):
    intelligence = qb.intelligence
    speed = qb.speed
    # Chance to scramble if no one is open
    scramble_chance = max(0.05, (100 - intelligence) / 150)
    if speed < 60:
        scramble_chance *= 0.5

    if random.random() > scramble_chance:
        return None  # No scramble

    # Scramble happens
    gain_odds = 0.5 + ((speed - 50) / 100)  # 50% base + bonus for speed > 50
    gain_odds = min(0.95, max(0.1, gain_odds))  # Clamp between 10% and 95%

    gain_yards = random.randint(1, 12)
    lose_yards = random.randint(-6, -1)

    yards = gain_yards if random.random() < gain_odds else lose_yards
    return yards

def assign_forced_fumble(defense, base_yards, verbose=False):
    # Map yardage to positional group
    if base_yards <= 2:
        valid_positions = ['rolb', 'olb', 'mlb']  # front seven - assume close to line
    elif base_yards <= 7:
        valid_positions = ['rolb', 'olb', 'mlb', 's']  # LBs and safeties
    else:
        valid_positions = ['cb', 's']  # defensive backs

    # Filter defense players matching valid positions
    candidates = [p for p in defense if p.position.lower() in valid_positions]
    if not candidates:
        candidates = defense  # fallback to anyone on defense

    # Weight by tackling and strength (or just tackling if you want it simpler)
    weights = [(p.tackling + p.strength) / 2 for p in candidates]

    # Choose one
    forced_by = random.choices(candidates, weights=weights, k=1)[0]
    forced_by.stats['forced_fumbles'] = forced_by.stats.get('forced_fumbles', 0) + 1

    if verbose:
        print(f"Fumble forced by {forced_by.name} ({forced_by.position})")

    return forced_by

import random

def assign_tackles(defense, base_yards, verbose=False):
    # Define tiered weights
    short_weights = {
        'dl': 0.35,
        'rolb': 0.2,
        'olb': 0.15,
        'lb': 0.2,
        's': 0.1
    }
    mid_weights = {
        'rolb': 0.25,
        'olb': 0.2,
        'lb': 0.25,
        's': 0.2,
        'dl': 0.1
    }
    long_weights = {
        's': 0.4,
        'cb': 0.4,
        'rolb': 0.08,
        'olb': 0.06,
        'lb': 0.06
    }

    # Determine blend weights
    if base_yards <= 2:
        weight_profile = short_weights
    elif base_yards <= 7:
        weight_profile = mid_weights
    else:
        weight_profile = long_weights

    # Build weighted candidate list
    candidates = []
    weights = []
    cb_count = 0

    for p in defense:
        pos = p.position.lower()
        pos_group = pos if pos in weight_profile else pos[:2]

        if pos_group == 'cb':
            if cb_count >= 3:
                continue  # cap CB participation
            cb_count += 1

        if pos_group in weight_profile:
            skill_weight = (p.tackling + p.intelligence) / 2
            position_weight = weight_profile[pos_group]
            candidates.append(p)
            weights.append(position_weight * skill_weight)

    # Fallback if candidate pool is empty
    if not candidates:
        candidates = defense
        weights = [(p.tackling + p.intelligence) / 2 for p in defense]

    # Solo vs assisted tackle (reduced to 20% to prevent double counting)
    is_assisted = random.random() < 0.20

    if is_assisted:
        # Weighted sampling without replacement
        if len(candidates) >= 2:
            tacklers = random.choices(candidates, weights=weights, k=5)
            seen = set()
            unique = []
            for t in tacklers:
                if t not in seen:
                    unique.append(t)
                    seen.add(t)
                if len(unique) == 2:
                    break
            tacklers = unique
        else:
            tacklers = random.choices(candidates, weights=weights, k=1)
    else:
        tacklers = random.choices(candidates, weights=weights, k=1)

    if verbose:
        if is_assisted and len(tacklers) == 2:
            print(f"Tackle by {tacklers[0].name} (solo) and {tacklers[1].name} (assist)")
        else:
            print(f"Tackle by {tacklers[0].name} (solo)")

    return tacklers, is_assisted and len(tacklers) == 2


def assign_sack(defense, guessed_play=False):
    # Sack candidates: DL always, LB only if not guessed correctly
    candidates = [p for p in defense if p.position == 'DL' or (guessed_play and 'LB' in p.position)]
    if not candidates:
        return [], False

    # 25% chance to split sack
    is_half = random.random() < 0.25

    # Pick 1 or 2 players based on is_half
    selected = random.choices(candidates, weights=[p.rushing for p in candidates], k=2 if is_half else 1)

    return selected, is_half


# ===================== rating helpers =====================

def _rating(player, keys, default=cfg.NEUTRAL):
    """Average of the given attributes that the player actually has."""
    vals = [getattr(player, k, None) for k in keys]
    vals = [v for v in vals if isinstance(v, (int, float))]
    return sum(vals) / len(vals) if vals else default


def _group_rating(players, positions, keys, default=cfg.NEUTRAL):
    """Average rating of the players at the given positions (on-field players only)."""
    group = [p for p in players if p.position in positions]
    if not group:
        return default
    return sum(_rating(p, keys) for p in group) / len(group)


def _slider_points(slider_value, scale=20.0):
    """Turn a 0-100 slider into rating points: 50 = 0, 100 = +scale, 0 = -scale."""
    return (sliders.get_multiplier(slider_value) - 1.0) * 2 * scale


def _credit_tackle(defense, yards):
    tacklers, is_assisted = assign_tackles(defense, yards)
    tackle_mult = sliders.get_multiplier(sliders.tackling)
    if is_assisted and len(tacklers) == 2 and random.random() < tackle_mult:
        tacklers[0].stats['solo_tackles'] += 1
        tacklers[1].stats['assisted_tackles'] += 1
    elif tacklers:
        tacklers[0].stats['solo_tackles'] += 1


def _lose_fumble(offense, defense, fumbler, spot, forcer_positions, yards_for_forcer):
    """A fumble by `fumbler` at `spot`. Returns (result, yardline) for the drive logic
    and records the stats. The offense recovers half of them."""
    fumbler.stats["fumbles"] += 1
    if random.random() < sliders.get_percentage_adjustment(sliders.forced_fumbles, 1.0):
        assign_forced_fumble(defense, yards_for_forcer)   # increments forced_fumbles itself
    if random.random() < cfg.FUMBLE_OFFENSE_RECOVERY:
        return None, spot                                  # offense keeps it, play stands
    candidates = [p for p in defense if p.position in forcer_positions] or defense
    weights = [(p.speed + p.intelligence) / 2 for p in candidates]
    recoverer = random.choices(candidates, weights=weights, k=1)[0]
    recoverer.stats["fumble_recoveries"] = recoverer.stats.get("fumble_recoveries", 0) + 1
    distance_to_goal = spot   # yards the defense must return it
    if spot < 60 and random.random() < cfg.FUMBLE_RETURN_TD_CHANCE:
        recoverer.stats["defensive_touchdowns"] = recoverer.stats.get("defensive_touchdowns", 0) + 1
        recoverer.stats["fumble_return_yards"] = recoverer.stats.get("fumble_return_yards", 0) + distance_to_goal
        debug_td_stats.append({'type': 'defensive_fumble', 'player': recoverer.name, 'position': recoverer.position})
        return "defensive_touchdown", 100
    return_yards = random.randint(0, 8)
    recoverer.stats["fumble_return_yards"] = recoverer.stats.get("fumble_return_yards", 0) + return_yards
    # The defense runs toward the offense's goal line (yardline 0 in the offense's direction).
    return "fumble", max(1, min(99, spot - return_yards))


# ===================== rushing =====================

def get_run_yards(offense, defense, down, first_down, guessed_play, offense_line_advantage, yardline, verbose=False, tendencies=None):
    """One running play. Returns (result, yards) where result is 'run', 'fumble' or
    'defensive_touchdown'. On a fumble the second value is the new yardline."""
    tendencies = tendencies or {}
    qb = next((p for p in offense if p.position == 'QB'), None)
    qb_share = tendencies.get("qb_run_share", cfg.QB_DESIGNED_RUN_SHARE * 100) / 100
    if qb is not None and random.random() < qb_share:
        carrier = qb                                     # designed quarterback run
    else:
        candidates = [p for p in offense if p.position in ('RB', 'WR')]
        if not candidates:
            candidates = [p for p in offense if p.position in ('RB', 'WR', 'QB', 'TE')]
        weights = [0.80 if p.position == 'RB' else 0.012 if p.position == 'WR' else 0.02 for p in candidates]
        carrier = random.choices(candidates, weights=weights, k=1)[0]

    # Line battle: blockers vs. the front seven (plus whoever the defense committed).
    blockers = _group_rating(offense, ('OL', 'TE'), ('strength', 'run_blocking'))
    blockers += _slider_points(sliders.run_blocking)
    front_positions = ('DL', 'MLB', 'ROLB', 'LOLB', 'OLB')
    front = _group_rating(defense, front_positions, ('strength', 'tackling'))
    front += _slider_points(sliders.run_defense)

    if carrier.position == 'RB':
        carrier_rating = _rating(carrier, ('speed', 'strength', 'elusiveness', 'vision'))
    else:
        carrier_rating = _rating(carrier, ('speed', 'strength'))
    carrier_rating += _slider_points(sliders.running_ability)

    yards = random.gauss(*cfg.RUSH_BASE_YARDS)
    yards += (blockers - front) * cfg.RUSH_PER_LINE_POINT
    yards += (carrier_rating - cfg.NEUTRAL) * cfg.RUSH_PER_CARRIER_POINT
    yards += cfg.RUSH_GUESSED if guessed_play else cfg.RUSH_NOT_GUESSED

    big_play_chance = cfg.RUSH_BIG_PLAY_CHANCE * (carrier.speed / cfg.NEUTRAL)
    if not guessed_play:
        big_play_chance *= 1.3
    if yards > 0 and random.random() < big_play_chance:
        yards += random.randint(*cfg.RUSH_BIG_PLAY_YARDS)

    # Short yardage: a push for the line often gets there.
    if first_down <= 2 and down >= 3 and yards < first_down and random.random() < cfg.RUSH_SHORT_YARDAGE_CONVERT:
        yards = first_down + random.uniform(0, 1.5)

    yards = max(cfg.RUSH_MIN_YARDS, round(yards))
    is_touchdown = yardline + yards >= 100
    if is_touchdown:
        yards = 100 - yardline

    # Fumble (checked before the touchdown is awarded)
    fumble_chance = sliders.get_inverse_percentage_adjustment(sliders.fumble_frequency, cfg.RUSH_FUMBLE_CHANCE)
    fumble_chance *= 1 + (cfg.NEUTRAL - carrier.strength) / 150 + (cfg.NEUTRAL - carrier.intelligence) / 150
    if random.random() < max(0.002, fumble_chance):
        spot = max(1, min(99, yardline + max(0, yards)))
        carrier.stats["carries"] += 1
        carrier.stats["rush_yards"] += max(0, min(yards, 99 - yardline))
        apply_run_fatigue(offense, defense, carrier, yards)
        result, new_spot = _lose_fumble(offense, defense, carrier, spot, ('DL', 'MLB', 'ROLB', 'LOLB', 'S', 'CB'), yards)
        if result is not None:
            return result, new_spot
        # Offense recovered: the play stands where the ball was fumbled, no touchdown.
        return "run", max(0, min(yards, 99 - yardline))

    if is_touchdown:
        carrier.stats["rushing_touchdowns"] += 1
        debug_td_stats.append({'type': 'rushing', 'player': carrier.name, 'position': carrier.position})
    if verbose:
        print("Rush for", yards, "yards by", carrier.name)
    carrier.stats["carries"] += 1
    carrier.stats["rush_yards"] += yards
    apply_run_fatigue(offense, defense, carrier, yards)
    if not is_touchdown:
        _credit_tackle(defense, yards)
    return "run", yards


# ===================== passing =====================

def _pick_target(offense):
    receivers = [p for p in offense if p.position in ('WR', 'TE')]
    backs = [p for p in offense if p.position == 'RB']
    if not receivers and not backs:
        return None
    weights = []
    for p in receivers:
        # Steep in rating so a real number-one receiver gets a number-one share of targets.
        w = (max(1.0, _rating(p, ('route_running', 'hands')) + p.speed / 2) / 100) ** cfg.TARGET_WEIGHT_POWER
        if p.position == 'TE':
            w *= cfg.TE_TARGET_WEIGHT
        weights.append(w)
    total = sum(weights) or 1.0
    if backs and receivers:
        rb_each = total * cfg.RB_TARGET_SHARE / (1 - cfg.RB_TARGET_SHARE) / len(backs)
        weights.extend([rb_each] * len(backs))
    elif backs:
        weights = [1.0] * len(backs)
    return random.choices(receivers + backs, weights=weights, k=1)[0]


def get_pass_yards(offense, defense, down, first_down, guessed_play, offense_line_advantage, yardline, verbose=False):
    """One dropback. Returns (result, yards or new yardline):
    'successful_pass' / 'checkdown_pass' (yards), 'incomplete' (0), 'sack' (negative yards),
    'interception' / 'fumble' (new yardline), 'defensive_touchdown' (100), 'run' (scramble yards)."""
    qb = next((p for p in offense if p.position == "QB"), None)
    if qb is None:
        return "incomplete", 0
    qb_accuracy = 0.6 * (qb.passing or cfg.NEUTRAL) + 0.25 * (qb.decision_making or cfg.NEUTRAL) + 0.15 * qb.intelligence
    qb_accuracy += _slider_points(sliders.qb_accuracy)
    qb_decisions = (qb.decision_making or cfg.NEUTRAL)

    # --- Throwaway ---
    if random.random() < cfg.THROWAWAY_CHANCE:
        qb.stats["pass_attempts"] += 1
        apply_pass_fatigue(offense, defense)
        return "incomplete", 0

    # --- Pass rush vs. protection ---
    protection = _group_rating(offense, ('OL',), ('strength', 'pass_blocking')) + _slider_points(sliders.pass_blocking)
    rush = _group_rating(defense, ('DL',), ('strength', 'rushing')) + _slider_points(sliders.pass_rush)
    sack_rate = cfg.SACK_BASE + (rush - protection) * cfg.SACK_PER_LINE_POINT
    sack_rate -= (qb_decisions - cfg.NEUTRAL) * cfg.SACK_PER_QB_POINT
    if guessed_play:
        sack_rate += cfg.SACK_GUESSED_BONUS
    sack_rate = max(0.01, min(0.25, sack_rate))
    if random.random() < sack_rate:
        sack_yards = -max(1, int(round(random.gauss(*cfg.SACK_YARDS))))
        sackers, is_half = assign_sack(defense, guessed_play=guessed_play)
        for sacker in sackers:
            sacker.stats['sacks'] += 0.5 if is_half else 1
            sacker.stats['solo_tackles'] += 1
        qb.stats["sacks_taken"] += 1
        apply_pass_fatigue(offense, defense)
        strip_chance = sliders.get_inverse_percentage_adjustment(sliders.fumble_frequency, cfg.SACK_FUMBLE_CHANCE)
        strip_chance *= 1 + (cfg.NEUTRAL - qb.strength) / 150
        if random.random() < strip_chance:
            spot = max(1, yardline + sack_yards)
            result, new_spot = _lose_fumble(offense, defense, qb, spot, ('DL', 'MLB', 'ROLB', 'LOLB'), 0)
            if result is not None:
                return result, new_spot
        return "sack", sack_yards

    # --- Target and coverage ---
    target = _pick_target(offense)
    if target is None:
        qb.stats["pass_attempts"] += 1
        return "incomplete", 0
    db_positions = ('CB', 'S') if target.position == 'WR' else ('CB', 'S', 'MLB', 'ROLB', 'LOLB', 'OLB')
    coverage = _group_rating(defense, db_positions, ('coverage',)) + _slider_points(sliders.pass_defense)
    db_speed = _group_rating(defense, ('CB', 'S'), ('speed',))

    if target.position == 'RB':
        receiver_skill = _rating(target, ('hands', 'elusiveness'))
    else:
        receiver_skill = _rating(target, ('route_running', 'hands'))
    receiver_skill += _slider_points(sliders.wr_catching)

    completion = cfg.COMPLETION_BASE
    completion += (qb_accuracy - cfg.NEUTRAL) * cfg.COMPLETION_PER_QB_POINT
    completion += (receiver_skill - cfg.NEUTRAL) * cfg.COMPLETION_PER_RECV_POINT
    completion -= (coverage - cfg.NEUTRAL) * cfg.COMPLETION_PER_COV_POINT
    completion += cfg.COMPLETION_GUESSED if guessed_play else cfg.COMPLETION_NOT_GUESSED
    if down >= 3 and first_down >= 7:
        completion += cfg.COMPLETION_LONG_3RD
    if target.position == 'RB':
        completion += cfg.COMPLETION_CHECKDOWN_BONUS
    completion = max(cfg.COMPLETION_MIN, min(cfg.COMPLETION_MAX, completion))

    qb.stats["pass_attempts"] += 1
    target.stats["targets"] += 1

    if random.random() < completion:
        if target.position == 'WR':
            yards = random.gauss(*cfg.PASS_YARDS_WR)
        elif target.position == 'TE':
            yards = random.gauss(*cfg.PASS_YARDS_TE)
        else:
            yards = random.gauss(*cfg.PASS_YARDS_RB)
        yards *= 1 + (target.speed - db_speed) * cfg.PASS_SPEED_EFFECT
        if target.position != 'RB' and random.random() < cfg.PASS_BIG_PLAY_CHANCE * (target.speed / cfg.NEUTRAL):
            yards = random.randint(*cfg.PASS_BIG_PLAY_YARDS)
        yards = max(cfg.PASS_MIN_YARDS, round(yards))
        is_touchdown = yardline + yards >= 100
        if is_touchdown:
            yards = 100 - yardline

        # Fumble after the catch
        fumble_chance = sliders.get_inverse_percentage_adjustment(sliders.fumble_frequency, cfg.RECEPTION_FUMBLE_CHANCE)
        if not is_touchdown and yards > 0 and random.random() < fumble_chance:
            qb.stats["completions"] += 1
            qb.stats["pass_yards"] += yards
            target.stats["receptions"] += 1
            target.stats["receiving_yards"] += yards
            apply_pass_fatigue(offense, defense, target, yards)
            result, new_spot = _lose_fumble(offense, defense, target, yardline + yards, ('CB', 'S', 'MLB', 'ROLB', 'LOLB'), yards)
            if result is not None:
                return result, new_spot
            return "successful_pass", yards

        if is_touchdown:
            qb.stats["passing_touchdowns"] += 1
            target.stats["receiving_touchdowns"] += 1
            debug_td_stats.append({'type': 'passing' if target.position != 'RB' else 'passing_checkdown',
                                   'qb': qb.name, 'receiver': target.name, 'receiver_position': target.position})
        else:
            _credit_tackle(defense, yards)
        if verbose:
            print("Pass for", yards, "yards to", target.name)
        qb.stats["completions"] += 1
        qb.stats["pass_yards"] += yards
        target.stats["receptions"] += 1
        target.stats["receiving_yards"] += yards
        apply_pass_fatigue(offense, defense, target, yards)
        return ("checkdown_pass" if target.position == 'RB' else "successful_pass"), yards

    # --- Incomplete: interception? ---
    int_mult = sliders.get_multiplier(sliders.interceptions)
    int_chance = cfg.INT_BASE + (coverage - cfg.NEUTRAL) * cfg.INT_PER_COV_POINT
    int_chance -= (qb_decisions - cfg.NEUTRAL) * cfg.INT_PER_QB_POINT
    if guessed_play:
        int_chance += cfg.INT_GUESSED_BONUS
    int_chance = max(cfg.INT_MIN, min(cfg.INT_MAX, int_chance)) * int_mult
    defenders = [p for p in defense if p.position in db_positions]
    if defenders and random.random() < int_chance:
        picker = random.choices(defenders, weights=[max(1, p.coverage or 1) for p in defenders], k=1)[0]
        qb.stats["interceptions_thrown"] += 1
        picker.stats["interceptions"] += 1
        apply_pass_fatigue(offense, defense)
        spot = max(1, min(99, yardline + random.randint(5, 25)))   # where the ball was caught
        distance_to_goal = spot   # yards the defense must return it
        if spot < 60 and random.random() < cfg.PICK_SIX_CHANCE * (picker.speed / cfg.NEUTRAL):
            picker.stats["defensive_touchdowns"] = picker.stats.get("defensive_touchdowns", 0) + 1
            picker.stats["interception_return_yards"] = picker.stats.get("interception_return_yards", 0) + distance_to_goal
            debug_td_stats.append({'type': 'defensive_interception', 'player': picker.name, 'position': picker.position})
            return "defensive_touchdown", 100
        return_yards = random.randint(0, 15) + int(picker.speed / 10)
        picker.stats["interception_return_yards"] = picker.stats.get("interception_return_yards", 0) + return_yards
        if verbose:
            print("Intercepted by", picker.name)
        # Spot in the old offense's direction; the drive loop flips it for the new offense.
        return "interception", max(1, min(99, spot - return_yards))

    # --- Scramble instead of a throw ---
    if random.random() < cfg.SCRAMBLE_CHANCE * (qb.speed / cfg.NEUTRAL):
        qb.stats["pass_attempts"] -= 1
        target.stats["targets"] -= 1
        yards = random.randint(1, 12) if random.random() < 0.5 + (qb.speed - 50) / 100 else -random.randint(1, 5)
        if yardline + yards >= 100:
            yards = 100 - yardline
            qb.stats['rushing_touchdowns'] += 1
            debug_td_stats.append({'type': 'rushing_scramble', 'player': qb.name, 'position': qb.position})
        else:
            _credit_tackle(defense, yards)
        qb.stats['carries'] += 1
        qb.stats['rush_yards'] += yards
        apply_run_fatigue(offense, defense, qb, yards)
        return "run", yards

    apply_pass_fatigue(offense, defense)
    return "incomplete", 0
