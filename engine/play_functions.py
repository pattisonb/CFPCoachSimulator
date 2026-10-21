import random

from . import game_config as cfg
from .game_config import sliders
from .game_functions import apply_pass_fatigue, apply_run_fatigue
from .personnel import pass_rushers

# Every touchdown's scorer(s), in order; game.py reads the newest to describe the score.
debug_td_stats = []

# Who was involved in the most recent snap (names only; read by the drive log, never by
# the simulation itself, so it changes no result).
last_play: dict = {}


def _note(**kw) -> None:
    last_play.clear()
    last_play.update(kw)


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
    _stat(forced_by, 'forced_fumbles')

    if verbose:
        print(f"Fumble forced by {forced_by.name} ({forced_by.position})")

    return forced_by


# Who makes the tackle, by how far the play went: per player on the field, by position
# group (the middle linebacker is "lb", the outside linebackers "olb"). Calibrated so the
# defensive line makes about a fifth of a team's tackles, linebackers about two fifths and
# the secondary the rest, with the middle linebacker usually the team's leader.
TACKLE_GROUP = {"DL": "dl", "MLB": "lb", "ROLB": "olb", "LOLB": "olb", "OLB": "olb", "CB": "cb", "S": "s"}
TACKLE_WEIGHT_GROUPS = ("dl", "lb", "olb", "s", "cb")    # the order of cfg.TACKLE_WEIGHTS_*


def assign_tackles(defense, base_yards, verbose=False):
    # per-player weights by position group (a group's share also grows with how many are on the field)
    if base_yards <= 2:
        weight_table = cfg.TACKLE_WEIGHTS_SHORT
    elif base_yards <= 7:
        weight_table = cfg.TACKLE_WEIGHTS_MID
    else:
        weight_table = cfg.TACKLE_WEIGHTS_LONG
    weight_profile = dict(zip(TACKLE_WEIGHT_GROUPS, weight_table))

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

    if is_assisted and len(candidates) >= 2:
        # Weighted sampling without replacement: the first two different players of five draws
        tacklers = list(dict.fromkeys(random.choices(candidates, weights=weights, k=5)))[:2]
    else:
        tacklers = random.choices(candidates, weights=weights, k=1)

    if verbose:
        if is_assisted and len(tacklers) == 2:
            print(f"Tackle by {tacklers[0].name} (solo) and {tacklers[1].name} (assist)")
        else:
            print(f"Tackle by {tacklers[0].name} (solo)")

    return tacklers, is_assisted and len(tacklers) == 2


def assign_sack(defense, guessed_play=False, rushers=None, blitz_rate=50):
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

    # A blitzing corner or safety gets the credit now and then, more for a team that blitzes
    # a lot (the defense's blitz_rate tendency). Drawn from stat_rng: the game is unchanged.
    dbs = [p for p in defense if p.position in ("CB", "S")]
    if dbs and cfg.stat_rng.random() < cfg.DB_SACK_SHARE * blitz_rate / 50:
        selected[0] = cfg.stat_rng.choices(dbs, weights=[max(1, p.rushing or 1) for p in dbs], k=1)[0]

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


def _attr(player, key, default=50.0):
    """A ratings v2 attribute (house scale, 50 = an average Power 4 starter); 50 when he has none."""
    return (getattr(player, "attrs", None) or {}).get(key, default)


def _attr_mean(player, keys, weights=None):
    w = weights or [1.0] * len(keys)
    return sum(_attr(player, k) * x for k, x in zip(keys, w)) / sum(w)


DEPTHS = ("short", "mid", "deep")
QB_ACC = ("short_accuracy", "mid_accuracy", "deep_accuracy")
QB_ACC_WEIGHTS = (0.3, 0.35, 0.2)          # the composite's own weights (build_teams.map_player)


def _routes(player):
    """A receiver's route skill at each depth (a tight end's deep is his intermediate)."""
    short, mid = _attr(player, "short_routes"), _attr(player, "mid_routes")
    deep = _attr(player, "deep_routes", mid)
    return {"short": short, "mid": mid, "deep": deep}


def _throw_depth(target, tendencies, play_action=False):
    """short, mid or deep for a throw to this target (backs catch short). The offensive
    scheme, the OC's deep-shot rate and a play-action fake move the shares."""
    shares = cfg.PASS_DEPTH_SHARE.get(target.position)
    if not shares:
        return "short"
    style = cfg.SCHEME_STYLE.get(tendencies.get("offense_scheme"), {})
    r = _routes(target)
    tilt = (target.speed / cfg.NEUTRAL) ** cfg.PASS_DEEP_SPEED_TILT \
        * max(0.3, 1 + cfg.PASS_DEEP_ROUTE_TILT * (r["deep"] - sum(r.values()) / 3))
    if tendencies.get("conservative"):
        tilt *= cfg.GARBAGE_BIG_PLAY
    if tendencies.get("prevent"):
        tilt *= cfg.PREVENT_BIG_PLAY
    tilt *= tendencies.get("big_play_mult", 1.0)
    tilt *= style.get("deep", 1.0) * max(0.4, 1 + (tendencies.get("deep_shot_rate", 50) - 50) * cfg.DEEP_SHOT_EFFECT)
    if play_action:
        tilt *= cfg.PLAY_ACTION_DEEP
    short, mid, deep = shares
    short *= style.get("short", 1.0)
    deep *= tilt
    rest = (1 - deep) / (short + mid)
    return random.choices(DEPTHS, weights=[short * rest, mid * rest, deep], k=1)[0]


def _tr(player, *keys):
    """The player's tier (0-4) summed over the given traits."""
    t = getattr(player, "traits", None) or {}
    return sum(t.get(k, 0) for k in keys)


def _tr_points(players, keys):
    return sum(_tr(p, *keys) for p in players)


def _fumble_mult(carrier, tacklers):
    """Ball Security against the tacklers' Hit Power (ratings v2): about 1 on average."""
    hit = sum(_attr(p, "hit_power") for p in tacklers) / len(tacklers) if tacklers else 50.0
    return max(0.3, 1 - (_attr(carrier, "ball_security") - cfg.ATTR_LEAGUE_AVG) * cfg.FUMBLE_SECURITY_EFFECT) \
        * max(0.5, 1 + (hit - cfg.ATTR_LEAGUE_AVG) * cfg.FUMBLE_HIT_EFFECT) \
        * max(0.2, 1 - _tr(carrier, "ball_protector") * cfg.TRAIT_FX["ball_protector"]) \
        * (1 + _tr_points(tacklers, cfg.HIT_TRAITS) * cfg.TRAIT_FX["hitter"])


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
    _stat(recoverer, "fumble_recoveries")
    last_play["recovered_by"] = recoverer.name
    if spot < 60 and random.random() < cfg.FUMBLE_RETURN_TD_CHANCE:
        _stat(recoverer, "defensive_touchdowns")
        _stat(recoverer, "fumble_return_yards", spot)    # the spot is the yards the defense must return it
        debug_td_stats.append({'type': 'defensive_fumble', 'player': recoverer.name, 'position': recoverer.position})
        return "defensive_touchdown", 100
    return_yards = random.randint(0, 8)
    _stat(recoverer, "fumble_return_yards", return_yards)
    # The defense runs toward the offense's goal line (yardline 0 in the offense's direction).
    return "fumble", max(1, min(99, spot - return_yards))


# ===================== rushing =====================

def _carry_weight(player, lead_depth, fb_weight):
    """The lead back (the halfback highest on the depth chart) is the main carrier; a second
    halfback on the field with him carries less, a fullback rarely, a receiver almost never."""
    if player.position == 'RB':
        if getattr(player, "role", None) == 'FB':
            return fb_weight
        if player.depth == lead_depth:
            return 0.80
        return cfg.RB_SECOND_BACK_CARRY_WEIGHT
    if player.position == 'WR':
        return 0.012
    return 0.02


def get_run_yards(offense, defense, down, first_down, guessed_play, yardline, verbose=False, tendencies=None):
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
        lead_depth = min((p.depth for p in candidates if p.position == 'RB' and getattr(p, "role", None) != 'FB'), default=None)
        fb_weight = tendencies.get("fb_carry_weight", cfg.FB_CARRY_WEIGHT)
        weights = [_carry_weight(p, lead_depth, fb_weight) for p in candidates]
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

    # ratings v2: inside or outside, and the attributes that read differently in each
    power_style = (_attr(carrier, "power_running") + _attr(carrier, "tackle_breaking") + _attr(carrier, "strength")) / 3
    speed_style = (_attr(carrier, "burst") + _attr(carrier, "agility") + _attr(carrier, "elusiveness")) / 3
    outside_share = max(0.15, min(0.75, cfg.RUN_OUTSIDE_SHARE + (speed_style - power_style) * cfg.RUN_STYLE_TILT
                                  + cfg.SCHEME_STYLE.get(tendencies.get("offense_scheme"), {}).get("outside", 0.0)))
    outside = random.random() < outside_share
    last_play["direction"] = "outside" if outside else "inside"
    line = [p for p in offense if p.position in ('OL', 'TE')]
    front_players = [p for p in defense if p.position in front_positions]
    line_lean = sum((_attr(p, "drive_block") - _attr(p, "reach_block")) / 2 for p in line) / len(line) if line else 0.0
    front_lean = sum((_attr(p, "block_shedding") - _attr(p, "pursuit")) / 2 for p in front_players) / len(front_players) if front_players else 0.0
    style = (power_style - speed_style) / 2               # + a power runner, - a speed runner
    sign = -1 if outside else 1                           # inside rewards drive, shedding and power; outside the opposite
    yards_style = sign * line_lean * cfg.RUN_LINE_STYLE_EFFECT - sign * front_lean * cfg.RUN_FRONT_STYLE_EFFECT \
        + sign * style * cfg.RUN_CARRIER_STYLE_EFFECT
    if not outside and line and front_players:
        line_w = sum(p.weight for p in line) / len(line)
        front_w = sum(p.weight for p in front_players) / len(front_players)
        yards_style += (line_w - front_w - cfg.LINE_WEIGHT_GAP) * cfg.RUN_WEIGHT_EFFECT
    fx = cfg.TRAIT_FX
    if outside:
        yards_style += _tr(carrier, "quick_feet", "slippery", "spin_artist", "stiff_arm_specialist") * fx["open_field"]
    else:
        yards_style += _tr(carrier, "tough_runner", "downhill_runner", "bulldozer", "balance") * fx["power_run"]
    yards_style += _tr(carrier, "extra_effort") * fx["extra_effort"]
    yards_style += _tr_points(line, cfg.LINE_RUN_TRAITS) * fx["line_run"] - _tr_points(front_players, cfg.TACKLE_TRAITS) * fx["tackle"]
    carry_keys = ("run_vision", "elusiveness", "power_running", "tackle_breaking", "ball_security")
    yards_style += (_attr(carrier, "run_vision") - _attr_mean(carrier, carry_keys)) * cfg.RUN_VISION_EFFECT

    yards = random.gauss(*cfg.RUSH_BASE_YARDS)
    yards += yards_style
    yards += (blockers - front) * cfg.RUSH_PER_LINE_POINT
    # the carrier against the defenders who chase him, not against an average defense
    pursuit = _group_rating(defense, front_positions, ('speed', 'tackling'))
    yards += (carrier_rating - pursuit) * cfg.RUSH_PER_CARRIER_POINT
    yards += cfg.RUSH_GUESSED if guessed_play else cfg.RUSH_NOT_GUESSED

    big_play_chance = cfg.RUSH_BIG_PLAY_CHANCE * (carrier.speed / cfg.NEUTRAL) * (1 + _tr(carrier, "breakaway_speed") * cfg.TRAIT_FX["breakaway"])
    if not guessed_play:
        big_play_chance *= 1.3
    if tendencies.get("conservative"):
        big_play_chance *= cfg.GARBAGE_BIG_PLAY
    big_play_chance *= tendencies.get("big_play_mult", 1.0)
    if yards > 0 and random.random() < big_play_chance:
        yards += random.randint(*cfg.RUSH_BIG_PLAY_YARDS)

    # Short yardage: a push for the line often gets there.
    push = (_attr(carrier, "power_running") - cfg.ATTR_LEAGUE_AVG + line_lean - front_lean) * cfg.SHORT_YARDAGE_STYLE_EFFECT \
        + _tr(carrier, "bulldozer") * cfg.TRAIT_FX["bulldozer_push"]
    if first_down <= 2 and down >= 3 and yards < first_down and random.random() < cfg.RUSH_SHORT_YARDAGE_CONVERT + push:
        yards = first_down + random.uniform(0, 1.5)

    yards = max(cfg.RUSH_MIN_YARDS, round(yards))
    is_touchdown = yardline + yards >= 100
    if is_touchdown:
        yards = 100 - yardline

    # Fumble (checked before the touchdown is awarded)
    fumble_chance = sliders.get_inverse_percentage_adjustment(sliders.fumble_frequency, cfg.RUSH_FUMBLE_CHANCE)
    fumble_chance *= 1 + (cfg.NEUTRAL - carrier.strength) / 150 + (cfg.NEUTRAL - carrier.intelligence) / 150
    fumble_chance *= _fumble_mult(carrier, front_players)
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
        w *= 1 + _tr(p, "qbs_favorite", "checkdown_target") * cfg.TRAIT_FX["target_pull"]
        weights.append(w * p.target_mult)
    total = sum(weights) or 1.0
    if backs and receivers:
        rb_each = total * cfg.RB_TARGET_SHARE / (1 - cfg.RB_TARGET_SHARE) / len(backs)
        weights.extend([rb_each] * len(backs))
    elif backs:
        weights = [1.0] * len(backs)
    return random.choices(receivers + backs, weights=weights, k=1)[0]


def _credit_completion(qb, target, yards):
    qb.stats["completions"] += 1
    qb.stats["pass_yards"] += yards
    target.stats["receptions"] += 1
    target.stats["receiving_yards"] += yards


def get_pass_yards(offense, defense, down, first_down, guessed_play, yardline, verbose=False, tendencies=None,
                   blitz_rate=50, def_tendencies=None):
    """One dropback. Returns (result, yards or new yardline):
    'successful_pass' / 'checkdown_pass' (yards), 'incomplete' (0), 'sack' (negative yards),
    'interception' / 'fumble' (new yardline), 'defensive_touchdown' (100), 'run' (scramble yards)."""
    tendencies = tendencies or {}
    def_tendencies = def_tendencies or {}
    qb = next((p for p in offense if p.position == "QB"), None)
    if qb is None:
        _note()
        return "incomplete", 0
    _note(qb=qb.name)
    qb_accuracy = 0.6 * (qb.passing or cfg.NEUTRAL) + 0.25 * (qb.decision_making or cfg.NEUTRAL) + 0.15 * qb.intelligence
    qb_accuracy += _slider_points(sliders.qb_accuracy)
    qb_decisions = qb.decision_making or cfg.NEUTRAL

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
    # ratings v2: power rush against anchor or speed rush against footwork, then sack escape
    linemen = [p for p in offense if p.position == 'OL']
    if rushers and linemen:
        rush_lean = sum((_attr(p, "power_rush") - _attr(p, "speed_rush")) / 2 for p in rushers) / len(rushers)
        line_lean = sum((_attr(p, "pass_anchor") - _attr(p, "pass_footwork")) / 2 for p in linemen) / len(linemen)
        power = random.random() < max(0.15, min(0.85, cfg.RUSH_POWER_SHARE + rush_lean * cfg.RUSH_STYLE_TILT))
        sign = 1 if power else -1
        sack_rate += sign * (rush_lean - line_lean) * cfg.RUSH_MATCHUP_EFFECT
        last_play["rush"] = "power" if power else "speed"
    sack_rate *= max(0.5, 1 - (_attr(qb, "sack_escape") - cfg.ATTR_LEAGUE_AVG) * cfg.SACK_ESCAPE_EFFECT)
    sack_rate *= max(0.4, 1 - _tr(qb, "steps_up", "escape_artist", "play_extender") * cfg.TRAIT_FX["sack_avoid"])
    # coach styles: the DC's blitz (more sacks, more big plays behind it) and the OC's play-action
    blitz = random.random() < min(0.7, cfg.BLITZ_BASE * blitz_rate / 50)
    sack_rate *= cfg.BLITZ_SACK[0] if blitz else cfg.BLITZ_SACK[1]
    last_play["blitz"] = blitz
    pa_share = cfg.PLAY_ACTION_BASE * cfg.SCHEME_STYLE.get(tendencies.get("offense_scheme"), {}).get("pa", 1.0) \
        * max(0.2, 1 + (tendencies.get("play_action_rate", 50) - 50) * cfg.PLAY_ACTION_RATE_EFFECT)
    play_action = down <= 2 and random.random() < min(0.6, pa_share)
    if play_action:
        sack_rate *= cfg.PLAY_ACTION_SACK
        last_play["play_action"] = True
    sack_rate *= max(0.5, 1 - _tr_points(linemen, cfg.LINE_PASS_TRAITS) * cfg.TRAIT_FX["line_pass"])
    sack_rate *= 1 + _tr_points(rushers, cfg.RUSH_TRAITS) * cfg.TRAIT_FX["rush"]
    if guessed_play:
        sack_rate += cfg.SACK_GUESSED_BONUS
    sack_rate = max(0.01, min(0.25, sack_rate))
    if random.random() < sack_rate:
        sack_yards = -max(1, int(round(random.gauss(*cfg.SACK_YARDS))))
        sackers, is_half = assign_sack(defense, guessed_play=guessed_play, rushers=rushers, blitz_rate=blitz_rate)
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

    # A pressure that did not become a sack: the throw is hurried (completion falls, less for a
    # poised quarterback) and a rusher gets the hurry.
    pressured = random.random() < min(0.6, sack_rate * cfg.PRESSURE_PER_SACK_RATE)
    if pressured:
        last_play["pressured"] = True
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

    # ratings v2: the throw's depth, the coverage call, and the attributes for both
    depth = _throw_depth(target, tendencies, play_action) if target.position != 'RB' else "short"
    last_play["depth"] = depth
    man_share = cfg.MAN_COVERAGE_SHARE + (def_tendencies.get("man_coverage_rate", 50) - 50) * cfg.MAN_RATE_EFFECT
    man = random.random() < max(0.1, min(0.85, man_share))
    covers = [p for p in defense if p.position in db_positions]

    completion = cfg.COMPLETION_BASE
    completion += cfg.DEPTH_COMPLETION[depth]
    acc_mean = _attr_mean(qb, QB_ACC, QB_ACC_WEIGHTS)
    completion += (_attr(qb, QB_ACC[DEPTHS.index(depth)]) - acc_mean) * cfg.DEPTH_ACCURACY_EFFECT
    if depth == "deep":
        completion += (_attr(qb, "arm_strength") - acc_mean) * cfg.ARM_DEEP_EFFECT
    if target.position != 'RB':
        r = _routes(target)
        completion += (r[depth] - sum(r.values()) / 3) * cfg.ROUTE_DEPTH_EFFECT
    if covers:
        # the coverage players' strength in this call over their average of man and zone
        lean = sum((_attr(p, "man_coverage") - _attr(p, "zone_coverage")) / 2 for p in covers) / len(covers)
        completion -= (lean if man else -lean) * cfg.COVERAGE_TYPE_EFFECT
    if covers and random.random() < cfg.CONTESTED_SHARE[depth]:
        # a defender on him at the catch point: hands in traffic, leaping and height against his
        defender = random.choices(covers, weights=[max(1, p.coverage or 1) for p in covers], k=1)[0]
        edge = (_attr(target, "contested_catch") - _attr(defender, "ball_skills")) / 2 \
            + (_attr(target, "leaping") - _attr(defender, "leaping")) / 2 \
            + (target.height_in - defender.height_in) * cfg.CONTESTED_HEIGHT_POINTS
        completion += edge * cfg.CONTESTED_EFFECT
        last_play["contested"] = True
    if pressured:
        completion += cfg.PRESSURE_COMPLETION + (_attr(qb, "pocket_poise") - cfg.ATTR_LEAGUE_AVG) * cfg.POISE_EFFECT
        completion += _tr(qb, "unflappable") * cfg.TRAIT_FX["unflappable"] \
            + _tr(qb, "accurate_on_the_run", "poised_on_the_run", "off_platform") * cfg.TRAIT_FX["on_the_move"]
    else:
        completion += _tr(qb, "pinpoint") * cfg.TRAIT_FX["pinpoint"]
    fx = cfg.TRAIT_FX
    completion += _tr(target, "glue_hands") * fx["glue_hands"]
    if depth == "short":
        completion += _tr(qb, "timing_passer") * fx["timing_passer"]
    if depth != "deep":
        completion += _tr(target, "sharp_cutter") * fx["sharp_cutter"]
    else:
        completion += _tr(target, "double_move") * fx["double_move"]
    if last_play.get("contested"):
        completion += _tr(target, "jump_ball_winner") * fx["jump_ball"]
    if man and depth != "deep" and covers and random.random() < cfg.PRESS_RATE * def_tendencies.get("press_rate", 50) / 50:
        press = sum(_attr(p, "press") for p in covers) / len(covers)
        completion += (_attr(target, "release") - press) * cfg.PRESS_EFFECT
        last_play["press"] = True
    if play_action and depth != "short":
        front_iq = [p for p in defense if p.position in ('MLB', 'ROLB', 'LOLB', 'S')]
        diag = sum(_attr(p, "diagnosis") for p in front_iq) / len(front_iq) if front_iq else cfg.ATTR_LEAGUE_AVG
        completion += cfg.PLAY_ACTION_COMPLETION + (_attr(qb, "play_action") - diag) * cfg.PLAY_ACTION_SKILL
    if man:
        completion += _tr(target, "press_beater") * fx["press_beater"]
        completion -= _tr_points(covers, ("shadow", "jam_artist")) * fx["cover"]
    elif depth != "deep":
        completion -= _tr_points(covers, ("route_jumper",)) * fx["cover"]
    completion += (qb_accuracy - cfg.NEUTRAL) * cfg.COMPLETION_PER_QB_POINT
    completion += (receiver_skill - cfg.NEUTRAL) * cfg.COMPLETION_PER_RECV_POINT
    completion -= (coverage - cfg.NEUTRAL) * cfg.COMPLETION_PER_COV_POINT
    completion += cfg.COMPLETION_GUESSED if guessed_play else cfg.COMPLETION_NOT_GUESSED
    if down >= 3 and first_down >= 7:
        completion += cfg.COMPLETION_LONG_3RD
    if target.position == 'RB':
        completion += cfg.COMPLETION_CHECKDOWN_BONUS
    if tendencies.get("prevent"):
        completion += cfg.PREVENT_COMPLETION
    # red zone: a short field squeezes the coverage
    to_goal = 100 - yardline
    completion += next((adj for inside, adj in cfg.REDZONE_COMPLETION if to_goal <= inside), 0.0)
    completion = max(cfg.COMPLETION_MIN, min(cfg.COMPLETION_MAX, completion))

    qb.stats["pass_attempts"] += 1
    target.stats["targets"] += 1

    if random.random() < completion:
        if target.position == 'RB':
            yards = random.gauss(*cfg.PASS_YARDS_RB)
        elif depth == "deep":
            yards = random.randint(*cfg.PASS_YARDS_DEEP)
        else:
            yards = random.gauss(*(cfg.PASS_YARDS_SHORT if depth == "short" else cfg.PASS_YARDS_MID))
        yards *= 1 + (target.speed - db_speed) * cfg.PASS_SPEED_EFFECT \
            - (_group_rating(defense, db_positions, ('tackling',)) - cfg.NEUTRAL) * cfg.PASS_TACKLE_EFFECT
        # a short or intermediate catch broken for a long gain (deep throws have their own yards)
        big_play_chance = cfg.PASS_BREAKAWAY_CHANCE * (target.speed / cfg.NEUTRAL) \
            * (1 + _tr(target, "breakaway_speed") * cfg.TRAIT_FX["breakaway"]) \
            * (cfg.BLITZ_BIG_PLAY[0] if blitz else cfg.BLITZ_BIG_PLAY[1])
        if tendencies.get("conservative"):
            big_play_chance *= cfg.GARBAGE_BIG_PLAY
        big_play_chance *= tendencies.get("big_play_mult", 1.0)
        if tendencies.get("prevent"):
            big_play_chance *= cfg.PREVENT_BIG_PLAY
        if target.position != 'RB' and depth != "deep" and random.random() < big_play_chance:
            yards = random.randint(*cfg.PASS_BIG_PLAY_YARDS)
        yards = max(cfg.PASS_MIN_YARDS, round(yards))
        is_touchdown = yardline + yards >= 100
        if is_touchdown:
            yards = 100 - yardline

        # Fumble after the catch
        fumble_chance = sliders.get_inverse_percentage_adjustment(sliders.fumble_frequency, cfg.RECEPTION_FUMBLE_CHANCE)
        fumble_chance *= _fumble_mult(target, covers)
        if not is_touchdown and yards > 0 and random.random() < fumble_chance:
            _credit_completion(qb, target, yards)
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
        _credit_completion(qb, target, yards)
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
    # ratings v2: deep and hurried throws are picked off more, ball-hawking defenders pick more
    int_chance *= cfg.INT_DEPTH_MULT[depth]
    if pressured:
        int_chance *= max(1.0, cfg.INT_PRESSURE_MULT - (_attr(qb, "pocket_poise") - cfg.ATTR_LEAGUE_AVG) * cfg.INT_POISE_EFFECT)
    int_chance *= 1 + _tr_points(covers, ("turnover_magnet", "pick_six")) * cfg.TRAIT_FX["ballhawk"]
    if covers:
        skills = sum(_attr(p, "ball_skills") for p in covers) / len(covers)
        int_chance *= max(0.5, 1 + (skills - cfg.ATTR_LEAGUE_AVG) * cfg.INT_BALL_SKILLS_EFFECT)
    if covers and random.random() < int_chance:
        picker = random.choices(covers, weights=[(max(1, p.coverage or 1) / cfg.NEUTRAL) ** cfg.INT_SKILL_POWER for p in covers], k=1)[0]
        last_play["picked_by"] = picker.name
        qb.stats["interceptions_thrown"] += 1
        picker.stats["interceptions"] += 1
        _stat(picker, "passes_defended")
        apply_pass_fatigue(offense, defense)
        spot = max(1, min(99, yardline + random.randint(5, 25)))   # where the ball was caught
        if spot < 60 and random.random() < cfg.PICK_SIX_CHANCE * (picker.speed / cfg.NEUTRAL):
            _stat(picker, "defensive_touchdowns")
            _stat(picker, "interception_return_yards", spot)    # the spot is the yards the defense must return it
            debug_td_stats.append({'type': 'defensive_interception', 'player': picker.name, 'position': picker.position})
            return "defensive_touchdown", 100
        return_yards = random.randint(0, 15) + int(picker.speed / 10)
        _stat(picker, "interception_return_yards", return_yards)
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
    if covers and cfg.stat_rng.random() < 0.35:
        _stat(cfg.stat_rng.choices(covers, weights=[max(1, p.coverage or 1) for p in covers], k=1)[0], "passes_defended")
    return "incomplete", 0
