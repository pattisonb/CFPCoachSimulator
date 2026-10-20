import random
from .game_functions import apply_pass_fatigue, apply_run_fatigue
from .personnel import pass_rushers
from .game_config import sliders
from . import game_config as cfg

# Debug tracking for touchdown stat assignments
debug_td_stats = []

# Who was involved in the most recent snap (names only; read by the drive log, never by
# the simulation itself, so it changes no result).
last_play: dict = {}


def _note(**kw) -> None:
    last_play.clear()
    last_play.update(kw)

#{'pass_attempts': 0, 'completions': 0, 'pass_yards': 0, 'interceptions_thrown': 0, 'sacks_taken': 0, 'carries': 0, 
# 'rush_yards': 0, 'fumbles': 0, 'receptions': 0, 'receiving_yards': 0, 'targets': 0, 'passing_touchdowns': 0, 
# 'receiving_touchdowns': 0, 'rushing_touchdowns': 0}
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

# Who makes the tackle, by how far the play went: per player on the field, by position
# group (the middle linebacker is "lb", the outside linebackers "olb"). Calibrated so the
# defensive line makes about a fifth of a team's tackles, linebackers about two fifths and
# the secondary the rest, with the middle linebacker usually the team's leader.
TACKLE_GROUP = {"DL": "dl", "MLB": "lb", "ROLB": "olb", "LOLB": "olb", "OLB": "olb", "CB": "cb", "S": "s"}


def assign_tackles(defense, base_yards, verbose=False):
    # per-player weights by position group (a group's share also grows with how many are on the field)
    short_weights = {'dl': cfg.TACKLE_WEIGHTS_SHORT[0], 'lb': cfg.TACKLE_WEIGHTS_SHORT[1], 'olb': cfg.TACKLE_WEIGHTS_SHORT[2],
                     's': cfg.TACKLE_WEIGHTS_SHORT[3], 'cb': cfg.TACKLE_WEIGHTS_SHORT[4]}
    mid_weights = {'dl': cfg.TACKLE_WEIGHTS_MID[0], 'lb': cfg.TACKLE_WEIGHTS_MID[1], 'olb': cfg.TACKLE_WEIGHTS_MID[2],
                   's': cfg.TACKLE_WEIGHTS_MID[3], 'cb': cfg.TACKLE_WEIGHTS_MID[4]}
    long_weights = {'dl': cfg.TACKLE_WEIGHTS_LONG[0], 'lb': cfg.TACKLE_WEIGHTS_LONG[1], 'olb': cfg.TACKLE_WEIGHTS_LONG[2],
                    's': cfg.TACKLE_WEIGHTS_LONG[3], 'cb': cfg.TACKLE_WEIGHTS_LONG[4]}

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
        pos_group = TACKLE_GROUP.get(p.position, p.position.lower())

        if pos_group == 'cb':
            if cb_count >= 3:
                continue  # cap CB participation
            cb_count += 1

        if pos_group in weight_profile:
            # the better tackler at a spot gets clearly more of them (real leaders stand out)
            skill_weight = ((p.tackling + p.intelligence) / 2 / cfg.NEUTRAL) ** cfg.TACKLE_SKILL_POWER
            position_weight = weight_profile[pos_group]
            candidates.append(p)
            weights.append(position_weight * skill_weight)

    # Fallback if candidate pool is empty
    if not candidates:
        candidates = defense
        weights = [(p.tackling + p.intelligence) / 2 for p in defense]

    # Solo vs assisted: about 30% of tackles are shared (real leaders split theirs near half solo, half assisted)
    is_assisted = random.random() < cfg.TACKLE_ASSIST_CHANCE

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


def assign_sack(defense, guessed_play=False, rushers=None):
    # Sack candidates: the pass rushers (linemen, plus linebackers in a three-man front), and any
    # linebacker when the defense guessed the play
    candidates = list(rushers) if rushers else [p for p in defense if p.position == 'DL']
    if guessed_play:
        candidates += [p for p in defense if 'LB' in p.position and p not in candidates]
    if not candidates:
        return [], False

    # 25% chance to split sack
    is_half = random.random() < 0.25

    # Pick 1 or 2 players based on is_half
    selected = random.choices(candidates, weights=[(max(1, p.rushing) / cfg.NEUTRAL) ** cfg.SACK_SKILL_POWER for p in candidates], k=2 if is_half else 1)

    return selected, is_half


# ===================== award-stat helpers =====================

def _stat(player, key, n=1):
    """Add to a stat the roster template may not carry."""
    player.stats[key] = player.stats.get(key, 0) + n


def _stat_max(player, key, value):
    if value > player.stats.get(key, 0):
        player.stats[key] = value


def _credit_lineman(offense, key, attr, worse=False, run=False):
    """Credit one blocker on the field: the weakest blocker is likeliest to allow a
    pressure or a stuff, the best to spring a long run. Tight ends and fullbacks count on
    runs (at a lower share) and tight ends in pass protection when two are in. Uses the
    stat RNG only."""
    line = [p for p in offense if p.position == 'OL']
    extra = [p for p in offense if p.position == 'TE' or (p.position == 'RB' and getattr(p, "role", None) == 'FB')]
    if not run:
        extra = [p for p in extra if p.position == 'TE'] if sum(1 for p in offense if p.position == 'TE') >= 2 else []
    if not line and not extra:
        return
    def w(p):
        r = getattr(p, attr, None) or cfg.NEUTRAL
        base = max(1.0, (101 - r) if worse else r)
        return base * (1.0 if p.position == 'OL' else cfg.TE_BLOCK_CREDIT_SHARE)
    pool = line + extra
    _stat(cfg.stat_rng.choices(pool, weights=[w(p) for p in pool], k=1)[0], key)


# ===================== rating helpers =====================

def _rating(player, keys, default=cfg.NEUTRAL):
    """Average of the given attributes that the player actually has."""
    vals = [v for k in keys if isinstance((v := getattr(player, k, None)), (int, float))]
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
    if yards > 3 and random.random() < cfg.NO_TACKLE_CHANCE:
        return                      # pushed out of bounds: no tackle in the box score
    tacklers, is_assisted = assign_tackles(defense, yards)
    tackle_mult = sliders.get_multiplier(sliders.tackling)
    if is_assisted and len(tacklers) == 2 and random.random() < tackle_mult:
        tacklers[0].stats['assisted_tackles'] += 1      # a shared tackle: an assist each (NCAA)
        tacklers[1].stats['assisted_tackles'] += 1
    elif tacklers:
        tacklers[0].stats['solo_tackles'] += 1
    if yards < 0 and tacklers:
        _stat(tacklers[0], 'tackles_for_loss')


COVERAGE_POSITIONS = {"MLB": 1.0, "ROLB": 1.0, "LOLB": 1.0, "OLB": 1.0, "S": 1.0, "CB": 0.8, "DL": 0.25}


def credit_coverage_tackle(team):
    """A returned kickoff or punt ends in a tackle by the kicking team's coverage unit:
    mostly backup linebackers and defensive backs (real box scores count these with the
    defense's tackles, about 3-4 a team-game, and they spread the totals off the starters)."""
    groups: dict = {}
    for p in team.defense:
        if p.position in COVERAGE_POSITIONS and not p.injured:
            groups.setdefault(p.position, []).append(p)
    cands, weights = [], []
    for pos, ps in groups.items():
        for i, p in enumerate(sorted(ps, key=lambda q: q.order)):
            cands.append(p)
            weights.append(COVERAGE_POSITIONS[pos] * cfg.COVERAGE_TACKLE_WEIGHTS[min(i, len(cfg.COVERAGE_TACKLE_WEIGHTS) - 1)])
    if not cands:
        return
    if len(cands) >= 2 and random.random() < cfg.TACKLE_ASSIST_CHANCE:
        a = random.choices(cands, weights=weights, k=1)[0]
        rest = [(c, w) for c, w in zip(cands, weights) if c is not a]
        b = random.choices([c for c, _ in rest], weights=[w for _, w in rest], k=1)[0]
        a.stats["assisted_tackles"] += 1
        b.stats["assisted_tackles"] += 1
    else:
        random.choices(cands, weights=weights, k=1)[0].stats["solo_tackles"] += 1


def _lose_fumble(offense, defense, fumbler, spot, forcer_positions, yards_for_forcer):
    """A fumble by `fumbler` at `spot`. Returns (result, yardline) for the drive logic
    and records the stats. The offense recovers half of them."""
    fumbler.stats["fumbles"] += 1
    if random.random() < sliders.get_percentage_adjustment(sliders.forced_fumbles, cfg.FORCED_FUMBLE_SHARE):
        assign_forced_fumble(defense, yards_for_forcer)   # increments forced_fumbles itself
    last_play["fumble"] = fumbler.name
    if random.random() < cfg.FUMBLE_OFFENSE_RECOVERY:
        last_play["fumble_kept"] = True
        return None, spot                                  # offense keeps it, play stands
    candidates = [p for p in defense if p.position in forcer_positions] or defense
    weights = [(p.speed + p.intelligence) / 2 for p in candidates]
    recoverer = random.choices(candidates, weights=weights, k=1)[0]
    recoverer.stats["fumble_recoveries"] = recoverer.stats.get("fumble_recoveries", 0) + 1
    last_play["recovered_by"] = recoverer.name
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
        # The lead back (the halfback highest on the depth chart) is the main carrier; a second
        # halfback on the field with him carries less, a fullback rarely, a receiver almost never.
        lead_depth = min((p.depth for p in candidates if p.position == 'RB' and getattr(p, "role", None) != 'FB'), default=None)
        weights = [((cfg.FB_CARRY_WEIGHT if getattr(p, "role", None) == 'FB' else 0.80 if p.depth == lead_depth else cfg.RB_SECOND_BACK_CARRY_WEIGHT)
                    if p.position == 'RB' else 0.012 if p.position == 'WR' else 0.02) for p in candidates]
        carrier = random.choices(candidates, weights=weights, k=1)[0]

    _note(who=carrier.name, pos=carrier.position)

    # Line battle: blockers vs. the front seven (plus whoever the defense committed).
    blockers = _group_rating(offense, ('OL', 'TE'), ('strength', 'run_blocking'))
    blockers += _slider_points(sliders.run_blocking)
    front_positions = ('DL', 'MLB', 'ROLB', 'LOLB', 'OLB')
    front = _group_rating(defense, front_positions, ('strength', 'tackling'))
    front += _slider_points(sliders.run_defense)

    if carrier.position in ('RB', 'QB'):
        # a designed QB run reads the runner the way a back's carry does (it used speed and
        # strength only, so elusive, patient runners such as Kansas State's QB gained too little)
        carrier_rating = _rating(carrier, ('speed', 'strength', 'elusiveness', 'vision'))
    else:
        carrier_rating = _rating(carrier, ('speed', 'strength'))
    carrier_rating += _slider_points(sliders.running_ability)

    yards = random.gauss(*cfg.RUSH_BASE_YARDS)
    yards += (blockers - front) * cfg.RUSH_PER_LINE_POINT
    # the carrier against the defenders who chase him, not against an average defense
    pursuit = _group_rating(defense, front_positions, ('speed', 'tackling'))
    yards += (carrier_rating - pursuit) * cfg.RUSH_PER_CARRIER_POINT
    yards += cfg.RUSH_GUESSED if guessed_play else cfg.RUSH_NOT_GUESSED

    big_play_chance = cfg.RUSH_BIG_PLAY_CHANCE * (carrier.speed / cfg.NEUTRAL)
    if not guessed_play:
        big_play_chance *= 1.3
    if tendencies.get("conservative"):
        big_play_chance *= cfg.GARBAGE_BIG_PLAY
    big_play_chance *= tendencies.get("big_play_mult", 1.0)
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
    _stat_max(carrier, "long_rush", yards)
    if yards >= 20:
        _stat(carrier, "explosive_runs")
        _credit_lineman(offense, "key_blocks", "run_blocking", run=True)
    elif yards <= 0:
        _credit_lineman(offense, "stuffs_allowed", "run_blocking", worse=True, run=True)
    if yards >= first_down:
        _stat(carrier, "rushing_first_downs")
        if down >= 3:
            _stat(carrier, "rushing_conversions")
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
        weights.append(w * p.target_mult)
    total = sum(weights) or 1.0
    if backs and receivers:
        rb_each = total * cfg.RB_TARGET_SHARE / (1 - cfg.RB_TARGET_SHARE) / len(backs)
        weights.extend([rb_each] * len(backs))
    elif backs:
        weights = [1.0] * len(backs)
    return random.choices(receivers + backs, weights=weights, k=1)[0]


def get_pass_yards(offense, defense, down, first_down, guessed_play, offense_line_advantage, yardline, verbose=False, tendencies=None):
    """One dropback. Returns (result, yards or new yardline):
    'successful_pass' / 'checkdown_pass' (yards), 'incomplete' (0), 'sack' (negative yards),
    'interception' / 'fumble' (new yardline), 'defensive_touchdown' (100), 'run' (scramble yards)."""
    qb = next((p for p in offense if p.position == "QB"), None)
    if qb is None:
        _note()
        return "incomplete", 0
    _note(qb=qb.name)
    qb_accuracy = 0.6 * (qb.passing or cfg.NEUTRAL) + 0.25 * (qb.decision_making or cfg.NEUTRAL) + 0.15 * qb.intelligence
    qb_accuracy += _slider_points(sliders.qb_accuracy)
    qb_decisions = (qb.decision_making or cfg.NEUTRAL)

    # --- Throwaway ---
    if random.random() < cfg.THROWAWAY_CHANCE:
        qb.stats["pass_attempts"] += 1
        apply_pass_fatigue(offense, defense)
        last_play["throwaway"] = True
        return "incomplete", 0

    # --- Pass rush vs. protection ---
    protection = _group_rating(offense, ('OL',), ('strength', 'pass_blocking')) + _slider_points(sliders.pass_blocking)
    rushers = pass_rushers(defense)
    rush = (sum(_rating(p, ('strength', 'rushing')) for p in rushers) / len(rushers) if rushers else cfg.NEUTRAL) + _slider_points(sliders.pass_rush)
    sack_rate = cfg.SACK_BASE + (rush - protection) * cfg.SACK_PER_LINE_POINT
    sack_rate -= (qb_decisions - cfg.NEUTRAL) * cfg.SACK_PER_QB_POINT
    if guessed_play:
        sack_rate += cfg.SACK_GUESSED_BONUS
    sack_rate = max(0.01, min(0.25, sack_rate))
    if random.random() < sack_rate:
        sack_yards = -max(1, int(round(random.gauss(*cfg.SACK_YARDS))))
        sackers, is_half = assign_sack(defense, guessed_play=guessed_play, rushers=rushers)
        last_play["sacked_by"] = " and ".join(s.name for s in sackers)
        for sacker in sackers:
            sacker.stats['sacks'] += 0.5 if is_half else 1
            sacker.stats['solo_tackles'] += 1
            _stat(sacker, 'tackles_for_loss', 0.5 if is_half else 1)
        _credit_lineman(offense, "sacks_allowed", "pass_blocking", worse=True)
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

    # A pressure that did not become a sack (stat only; the play goes on as before).
    if cfg.stat_rng.random() < min(0.6, sack_rate * 2.5):
        if rushers:
            _stat(cfg.stat_rng.choices(rushers, weights=[max(1, p.rushing or 1) for p in rushers], k=1)[0], 'hurries')
            _credit_lineman(offense, "pressures_allowed", "pass_blocking", worse=True)

    # --- Target and coverage ---
    target = _pick_target(offense)
    if target is None:
        qb.stats["pass_attempts"] += 1
        return "incomplete", 0
    last_play["target"] = target.name
    last_play["target_pos"] = target.position
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
    if (tendencies or {}).get("prevent"):
        completion += cfg.PREVENT_COMPLETION
    # red zone: a short field squeezes the coverage
    to_goal = 100 - yardline
    completion += next((adj for inside, adj in cfg.REDZONE_COMPLETION if to_goal <= inside), 0.0)
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
        yards *= 1 + (target.speed - db_speed) * cfg.PASS_SPEED_EFFECT             - (_group_rating(defense, db_positions, ('tackling',)) - cfg.NEUTRAL) * cfg.PASS_TACKLE_EFFECT
        big_play_chance = cfg.PASS_BIG_PLAY_CHANCE * (target.speed / cfg.NEUTRAL)
        if (tendencies or {}).get("conservative"):
            big_play_chance *= cfg.GARBAGE_BIG_PLAY
        big_play_chance *= (tendencies or {}).get("big_play_mult", 1.0)
        if (tendencies or {}).get("prevent"):
            big_play_chance *= cfg.PREVENT_BIG_PLAY
        if target.position != 'RB' and random.random() < big_play_chance:
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
        _stat_max(target, "long_reception", yards)
        _stat_max(qb, "long_pass", yards)
        if yards >= 25:
            _stat(target, "explosive_catches")
        if yards >= first_down:
            _stat(target, "receiving_first_downs")
            _stat(qb, "passing_first_downs")
            if down >= 3:
                _stat(qb, "passing_conversions")
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
        picker = random.choices(defenders, weights=[(max(1, p.coverage or 1) / cfg.NEUTRAL) ** cfg.INT_SKILL_POWER for p in defenders], k=1)[0]
        last_play["picked_by"] = picker.name
        qb.stats["interceptions_thrown"] += 1
        picker.stats["interceptions"] += 1
        _stat(picker, "passes_defended")
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
        last_play["scramble"] = True
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
    # About a third of incompletions are a defender's play on the ball (stat only).
    if defenders and cfg.stat_rng.random() < 0.35:
        _stat(cfg.stat_rng.choices(defenders, weights=[max(1, p.coverage or 1) for p in defenders], k=1)[0], "passes_defended")
    return "incomplete", 0
