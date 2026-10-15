import random
from .play_functions import get_pass_yards, get_run_yards
from .game_functions import get_kick_attempt_range, get_punt_distance, apply_general_fatigue, fg_max_distance
from .game_config import sliders
from .roster import return_skill
from . import game_config as cfg
from . import situation as sit
RUN_PASS_TABLE = {
    1: [
        (3,  0.80),
        (6,  0.70),
        (10, 0.60),
        (float('inf'), 0.45),
    ],
    2: [
        (3,  0.75),
        (6,  0.58),
        (10, 0.45),
        (float('inf'), 0.30),
    ],
    3: [
        (2,  0.70),
        (5,  0.50),
        (9,  0.28),
        (float('inf'), 0.12),
    ],
    4: [
        (1,  0.75),
        (2,  0.60),
        (3,  0.45),
        (6,  0.25),
        (float('inf'), 0.08),
    ],
}


def run_probability(down, to_go):
    """Lookup run% by down & distance."""
    for thresh, prob in RUN_PASS_TABLE.get(down, []):
        if to_go <= thresh:
            return prob
    return 0.25

def determine_offense_play(down, first_down, last_play_type=None, last_gain=0, pass_rate=50, run_shift=0.0):
    """Run or pass from the down-and-distance table, shifted by the coordinator's pass-rate
    tendency (50 = the table as written; a flexbone team sits near 10)."""
    run_chance = run_probability(down, first_down)
    if last_play_type == "run" and last_gain >= 6:
        run_chance += 0.1
    elif last_play_type == "pass" and last_gain >= 10:
        run_chance -= 0.05
    run_chance -= (pass_rate - 50) / 100 * cfg.PASS_RATE_EFFECT
    run_chance += run_shift
    run_chance = max(cfg.RUN_CHANCE_MIN, min(cfg.RUN_CHANCE_MAX, run_chance))
    return "run" if random.random() < run_chance else "pass"

def determine_defense_play(down, first_down):
    if down == 1:
        if first_down <= 3:
            return "defend_run" if random.random() < 0.75 else "defend_pass"
        elif first_down <= 6:
            return "defend_run" if random.random() < 0.6 else "defend_pass"
        elif first_down <= 10:
            return "defend_pass" if random.random() < 0.55 else "defend_run"
        else:
            return "defend_pass" if random.random() < 0.7 else "defend_run"

    elif down == 2:
        if first_down <= 3:
            return "defend_run" if random.random() < 0.65 else "defend_pass"
        elif first_down <= 6:
            return "defend_pass" if random.random() < 0.6 else "defend_run"
        elif first_down <= 10:
            return "defend_pass" if random.random() < 0.7 else "defend_run"
        else:
            return "defend_pass" if random.random() < 0.8 else "defend_run"

    elif down == 3:
        if first_down <= 3:
            return "defend_run" if random.random() < 0.6 else "defend_pass"
        elif first_down <= 6:
            return "defend_pass" if random.random() < 0.7 else "defend_run"
        elif first_down <= 10:
            return "defend_pass" if random.random() < 0.85 else "defend_run"
        else:
            return "defend_pass" if random.random() < 0.9 else "defend_run"

    else:
        return "defend_pass"
    
def determine_line_advantage(offense, defense, offense_play, defense_play) :
    offense_blocking = 0
    for player in offense :
        if player.position == 'OL' or offense_play == "run" and player.position == 'TE':
            offense_blocking += player.strength
            if offense_play == "run" :
                offense_blocking += player.run_blocking
            elif offense_play == "pass" :
                offense_blocking += player.pass_blocking
    defense_rushing = 0
    for player in defense :
        if player.position == 'DL' or defense_play == "defend_run" and 'LB' in player.position:
            defense_rushing += player.strength
            if defense_play == "defend_run" :
                defense_rushing += player.rushing
            elif defense_play == "defend_pass" :
                defense_rushing += player.rushing
    return offense_blocking - defense_rushing
    
def sim_play(offense_team, defense_team, down, first_down_yardage, yardline, hurrying=False, last_play_type=None, last_gain=0, seconds_remaining=cfg.HALF_SECONDS, verbose=True, clock_stopped=True, situation=None, posture=None) :
    """One snap: fatigue and substitutions, a possible penalty, then a run or a pass.
    Returns (play_ran, result, yards, seconds_used, info) where info says whether the clock is
    stopped until the next snap and whether the carrier went out of bounds."""
    apply_general_fatigue(offense_team.get_offense(), defense_team.get_defense())
    offense_team.apply_fatigue_penalties()
    defense_team.apply_fatigue_penalties()
    offense_team.sub_skill_position_players(cfg.SKILL_SUB_FATIGUE)
    defense_team.sub_defensive_players(50)
    offense_team.recover_bench_players()
    defense_team.recover_bench_players()
    offense = offense_team.get_offense()
    defense = defense_team.get_defense()

    # Clock pace: higher game-speed slider means faster plays; plays drag late in a half.
    tendencies = getattr(offense_team, "tendencies", {}) or {}
    game_speed_mult = 2.0 - sliders.get_multiplier(sliders.game_speed)
    game_speed_mult *= 1.0 - (tendencies.get("tempo", 50) - 50) / 100 * cfg.TEMPO_EFFECT
    progress = max(0.0, min(1.0, 1.0 - seconds_remaining / cfg.HALF_SECONDS))
    drag = 1.0 + progress * cfg.LATE_GAME_DRAG
    situation = situation or sit.assess(offense_team, defense_team, seconds_remaining, down, first_down_yardage, yardline, clock_stopped)
    posture = posture or sit.defense_posture(offense_team, defense_team, seconds_remaining)

    # Score situation (set by the game loop): garbage time, comebacks, victory formation.
    lead = getattr(offense_team, "lead", 0)
    half = getattr(offense_team, "half", 1)
    overtime = getattr(offense_team, "in_overtime", False)
    run_shift = 0.0
    if not overtime:
        blowout = (half == 2 and lead >= cfg.GARBAGE_LEAD) or lead >= cfg.GARBAGE_LEAD_ANY
        hopeless = (half == 2 and -lead >= cfg.GARBAGE_LEAD) or -lead >= cfg.GARBAGE_LEAD_ANY
        if blowout:
            game_speed_mult *= cfg.GARBAGE_CLOCK
            run_shift += cfg.GARBAGE_RUN_SHIFT
            hurrying = False
            tendencies = {**tendencies, "conservative": True}
        elif hopeless:
            game_speed_mult *= 1 + (cfg.GARBAGE_CLOCK - 1) * 0.7
            run_shift += cfg.GARBAGE_RUN_SHIFT * 0.6
            hurrying = False
        elif half == 2 and -lead >= cfg.COMEBACK_LEAD and seconds_remaining <= cfg.QUARTER_SECONDS:
            run_shift -= 0.2
            hurrying = True
        # Starters sit once the game is decided (the trailing side keeps playing its starters).
        if lead >= cfg.BENCH_LEAD and (half == 2 or lead >= cfg.GARBAGE_LEAD_ANY):
            offense_team.rest_starters("offense")
        elif lead < cfg.BENCH_LEAD - 14:
            offense_team.restore_starters("offense")
        if -lead >= cfg.BENCH_LEAD and (half == 2 or -lead >= cfg.GARBAGE_LEAD_ANY):
            defense_team.rest_starters("defense")
        elif -lead < cfg.BENCH_LEAD - 14:
            defense_team.restore_starters("defense")

    pace_mult = game_speed_mult * drag

    def clock(result, oob=False, first_down=False):
        secs, stopped = sit.play_clock(result, oob, first_down, seconds_remaining, situation, posture,
                                       offense_team, defense_team, pace_mult)
        return max(1, secs), {"stopped": stopped, "oob": oob}

    off_penalty_chance = sliders.get_inverse_percentage_adjustment(sliders.offensive_penalties, cfg.OFF_PENALTY_CHANCE)
    if random.random() < off_penalty_chance:
        penalty_type = random.choices(
            ["false_start", "holding", "offensive_pass_interference", "delay_of_game"],
            weights=[0.3, 0.4, 0.15, 0.15], k=1)[0]
        penalty_yards = {"false_start": -5, "holding": -10, "offensive_pass_interference": -15, "delay_of_game": -5}[penalty_type]
        offense_team.team_stats["penalties"] += 1
        offense_team.team_stats["penalty_yards"] += abs(penalty_yards)
        if verbose:
            print(f"Penalty: {penalty_type.replace('_', ' ').title()} for {abs(penalty_yards)} yards")
        return "penalty", "offensive penalty", penalty_yards, *clock("offensive penalty")

    def_penalty_chance = sliders.get_inverse_percentage_adjustment(sliders.defensive_penalties, cfg.DEF_PENALTY_CHANCE)
    if random.random() < def_penalty_chance:
        penalty_type = random.choices(["offside", "pass_interference", "facemask"], weights=[0.4, 0.4, 0.2], k=1)[0]
        if penalty_type == "offside":
            penalty_yards = 5
        elif penalty_type == "pass_interference":
            penalty_yards = random.randint(10, 25)
        else:
            penalty_yards = 15
        defense_team.team_stats["penalties"] += 1
        defense_team.team_stats["penalty_yards"] += penalty_yards
        if verbose:
            print(f"Defensive Penalty: {penalty_type.replace('_', ' ').title()}")
        return "penalty", "defensive penalty", penalty_yards, *clock("defensive penalty")

    # Victory formation: kneel it out (the leader can burn the rest of the clock).
    if situation.get("kneel"):
        secs = cfg.KNEEL_PLAY_SECONDS + (0 if getattr(defense_team, "timeouts", 0) > 0 else cfg.KNEEL_RUNOFF)
        if getattr(defense_team, "timeouts", 0) > 0:
            defense_team.timeouts -= 1
        return "run", "run", -1, max(1, min(secs, max(1, seconds_remaining))), {"stopped": False, "oob": False, "kneel": True}
    # Spike: stop the clock at the cost of a down.
    if situation.get("spike"):
        qb = next((p for p in offense if p.position == "QB"), None)
        if qb is not None:
            qb.stats["pass_attempts"] += 1
        return "pass", "incomplete", 0, *clock("spike")
    run_shift -= situation.get("pass_shift", 0.0) * -1 if False else 0.0
    run_shift += situation.get("pass_shift", 0.0)
    tendencies = {**tendencies, "big_play_mult": situation.get("big_play_mult", 1.0), "prevent": posture.get("prevent", False)}
    offense_play = determine_offense_play(down, first_down_yardage, last_play_type, last_gain,
                                          tendencies.get("pass_rate", 50), run_shift)
    defense_play = determine_defense_play(down, first_down_yardage)
    # The better play caller tilts the guessing game.
    edge = (( (getattr(defense_team, "tendencies", {}) or {}).get("dc_play_calling", 50)
              - tendencies.get("oc_play_calling", 50)) / 100) * cfg.PLAY_CALLING_EFFECT
    if edge > 0 and random.random() < edge:
        defense_play = "defend_" + offense_play
    elif edge < 0 and random.random() < -edge:
        defense_play = "defend_pass" if offense_play == "run" else "defend_run"
    offense_line_advantage = determine_line_advantage(offense, defense, offense_play, defense_play)
    guessed_play = offense_play in defense_play
    if offense_play == "run":
        play_ran = "run"
        result, yards_gained = get_run_yards(offense, defense, down, first_down_yardage, guessed_play, offense_line_advantage, yardline, tendencies=tendencies)
    else:
        play_ran = "pass"
        result, yards_gained = get_pass_yards(offense, defense, down, first_down_yardage, guessed_play, offense_line_advantage, yardline, tendencies=tendencies)
    oob = sit.out_of_bounds(result, situation, posture)
    first_down = result in ("run", "successful_pass", "checkdown_pass") and isinstance(yards_gained, (int, float)) and yards_gained >= first_down_yardage
    return play_ran, result, yards_gained, *clock(result, oob, first_down)

def process_play(result, play_type, yards, yardline, down, first_down_yardage) :
    """Apply a play result to down, distance and yardline. Returns
    (down, first_down_yardage, yardline, safety_occurred); down 5 = turnover, 6 = touchdown."""
    safety_occurred = False
    if result == "defensive_touchdown":
        return down, first_down_yardage, yardline, safety_occurred
    if result == "fumble" or result == "interception" :
        # `yards` is the spot where the defense ended up, in the offense's direction.
        return 5, first_down_yardage, yards, safety_occurred
    if result in ('run', 'successful_pass', 'checkdown_pass'):
        yardline += yards
        first_down_yardage -= yards
        down += 1
    if result == 'offensive penalty':
        pre_penalty_yardline = yardline
        yardline = max(1, yardline + yards)
        actual_penalty = pre_penalty_yardline - yardline
        first_down_yardage += actual_penalty
    if result == 'defensive penalty':
        pre_penalty_yardline = yardline
        new_yardline = yardline + yards
        if new_yardline >= 100:
            yardline = 99  # half the distance: never a touchdown by penalty
            actual_penalty = 99 - pre_penalty_yardline
        else:
            yardline = new_yardline
            actual_penalty = yards
        first_down_yardage = max(0, first_down_yardage - actual_penalty)
    if result == 'sack' :
        if yardline + yards <= 0:
            safety_occurred = True
            yardline = 0
        else:
            down += 1
            yardline += yards
            first_down_yardage -= yards
    if result == 'incomplete' :
        down += 1
    if yardline >= 100 :
        down = 6
    if first_down_yardage <= 0 and down != 6:
        down = 1
        first_down_yardage = 10
    return down, first_down_yardage, yardline, safety_occurred

def should_go_for_it(distance, yardline, seconds_remaining=cfg.HALF_SECONDS, trailing_late=False, go_rate=50, lead=0):
    """Fourth-down decision. FBS teams go for it about 2.1 times a game and convert
    about 53%: mostly short yardage in plus territory, plus desperation tries when
    trailing late in the game."""
    late = seconds_remaining < 300
    if trailing_late:
        table = [(2, 0.95), (5, 0.80), (10, 0.60), (99, 0.35)] if yardline >= 35 else [(2, 0.6), (99, 0.3)]
    elif yardline >= 80:
        table = [(1, 0.90), (2, 0.65), (3, 0.50), (5, 0.40), (99, 0.12)]
    elif yardline >= 60:
        table = [(1, 0.90), (2, 0.72), (3, 0.58), (5, 0.45), (8, 0.22), (99, 0.08)]
    elif yardline >= 50:
        table = [(1, 0.85), (2, 0.68), (3, 0.55), (6, 0.40), (99, 0.10)]
    elif yardline >= 40:
        table = [(1, 0.55), (2, 0.38), (3, 0.18), (6, 0.10), (99, 0.0)]
    else:
        table = [(1, 0.50 if late else 0.18), (3, 0.15 if late else 0.02), (99, 0.0)]
    chance = next(p for limit, p in table if distance <= limit)
    chance *= 1.0 + (go_rate - 50) / 100 * cfg.FOURTH_DOWN_TENDENCY_EFFECT
    if lead >= cfg.BENCH_LEAD:
        chance = 0.0
    elif lead >= 17:
        chance *= 0.25
    return random.random() < chance

def attempt_kick(yardline, kicker, defense_team=None) :
    """Field goal try. Returns (made, blocked)."""
    kicker.stats["fg_attempted"] += 1
    if random.random() < 0.01:
        if defense_team:
            defense_team.team_stats["blocked_kicks"] += 1
        return False, True
    distance = (100 - yardline) + 17
    make = next(prob for limit, prob in cfg.FG_MAKE if distance <= limit)
    make *= sliders.get_multiplier(sliders.kicking_accuracy)
    make += ((kicker.kick_accuracy or cfg.NEUTRAL) - cfg.NEUTRAL) * cfg.FG_PER_ACCURACY_POINT
    make = max(0.03, min(0.98, make))
    made = random.random() < make
    if made:
        kicker.stats["fg_made"] += 1
    return made, False

def attempt_punt(yardline, punter, defense_team=None, return_team=None):
    """
    Simulate punt and return
    Returns: (final_yardline, punt_yards, is_blocked, returner_player, return_yards, is_return_td)
    """
    # College chaos: occasional fake punt attempt (0.3% chance when in own territory)
    if yardline < 50 and random.random() < 0.003:
        # Fake punt - treat as turnover for now (could add fake punt logic later)
        punter.stats["punts"] += 1
        return yardline, 0, False, None, 0, False  # No yards gained, turnover, not blocked
    
    punt_distance = get_punt_distance(punter)
    punt_accuracy = punter.punt_accuracy  # default to 50 if missing

    landing_spot = yardline + punt_distance
    punter.stats["punts"] += 1
    
    # College chaos: occasional blocked punt (0.5% chance)
    if random.random() < 0.005:
        if defense_team:
            defense_team.team_stats["blocked_punts"] += 1
        return yardline, 0, True, None, 0, False  # Punt blocked, no yards
    
    # Get returner
    returner = return_team.get_punt_returner() if return_team else None
    
    # If far from end zone, max power punt is safe
    if landing_spot + 10 < 100:
        punter.stats["punt_yards"] += (punt_distance)
        # Check for punt return
        if returner and landing_spot < 90:
            # Punt return chance
            return_mult = sliders.get_multiplier(sliders.kickoff_return)  # Reuse kickoff return slider
            if returner:
                returner_skill = return_skill(returner)
                return_td_chance = (0.003 * return_mult) * (1 + returner_skill * 0.5)  # Slightly lower than kickoff
            else:
                return_td_chance = 0.003 * return_mult
            
            if random.random() < return_td_chance:
                # Punt return TD
                if returner:
                    returner.stats["punt_returns"] = returner.stats.get("punt_returns", 0) + 1
                    returner.stats["punt_return_yards"] = returner.stats.get("punt_return_yards", 0) + (100 - landing_spot)
                    returner.stats["punt_return_touchdowns"] = returner.stats.get("punt_return_touchdowns", 0) + 1
                return 100, punt_distance, False, returner, (100 - landing_spot), True
            
            # Regular punt return
            base_return = 5 + (return_mult - 1.0) * 10
            if returner:
                returner_boost = return_skill(returner)
                base_return += returner_boost * 8
            return_yards = random.randint(int(base_return), int(base_return + 10))
            final_spot = max(landing_spot - return_yards, 1)
            if returner:
                returner.stats["punt_returns"] = returner.stats.get("punt_returns", 0) + 1
                returner.stats["punt_return_yards"] = returner.stats.get("punt_return_yards", 0) + return_yards
            return final_spot, punt_distance, False, returner, return_yards, False
        return landing_spot, punt_distance, False, None, 0, False

    # Placement needed – evaluate touchback or pin inside 5
    accuracy_factor = (punt_accuracy - 50) / 100  # range: -0.5 to +0.5

    # Base chance to pin inside the 5 is 25%, modulated by accuracy
    pin_chance = 0.25 + accuracy_factor

    if landing_spot >= 95:  # Ball lands inside the 5
        if random.random() < pin_chance:
            pinned_spot = random.randint(1, 4)  # Stick inside the 5
            punter.stats["punt_yards"] += (100 - pinned_spot - yardline)
            return 100 - pinned_spot, 100 - pinned_spot - yardline, False, None, 0, False
        else:
            punter.stats["punt_yards"] += (100 - yardline - 20)
            return 80, 100 - yardline - 20, False, None, 0, False  # Ball placed at 20

    # Else: standard returnable punt
    if returner and landing_spot < 90:
        return_mult = sliders.get_multiplier(sliders.kickoff_return)
        if returner:
            returner_skill = return_skill(returner)
            return_td_chance = (0.003 * return_mult) * (1 + returner_skill * 0.5)
        else:
            return_td_chance = 0.003 * return_mult
        
        if random.random() < return_td_chance:
            # Punt return TD
            if returner:
                returner.stats["punt_returns"] = returner.stats.get("punt_returns", 0) + 1
                returner.stats["punt_return_yards"] = returner.stats.get("punt_return_yards", 0) + (100 - landing_spot)
                returner.stats["punt_return_touchdowns"] = returner.stats.get("punt_return_touchdowns", 0) + 1
            return 100, (100 - yardline), False, returner, (100 - landing_spot), True
        
        # Regular punt return
        base_return = 5 + (return_mult - 1.0) * 10
        if returner:
            returner_boost = return_skill(returner)
            base_return += returner_boost * 8
        return_yards = random.randint(int(base_return), int(base_return + 10))
        final_spot = max(landing_spot - return_yards, 1)
        if returner:
            returner.stats["punt_returns"] = returner.stats.get("punt_returns", 0) + 1
            returner.stats["punt_return_yards"] = returner.stats.get("punt_return_yards", 0) + return_yards
        punter.stats["punt_yards"] += (final_spot - yardline)
        return final_spot, final_spot - yardline, False, returner, return_yards, False
    
    return_yards = 0
    final_spot = max(landing_spot - return_yards, 1)
    punter.stats["punt_yards"] += (final_spot - yardline)
    return final_spot, final_spot - yardline, False, None, 0, False

def _clutch_kick(offense, defense, kicker, yardline, seconds_remaining, in_red_zone, play_ran):
    """Field goal with the clock about to run out, on any down."""
    seconds_remaining -= random.randint(4, 6)
    kick_made, kick_blocked = attempt_kick(yardline, kicker, defense)
    result = "field goal" if kick_made and not kick_blocked else "missed kick"
    if in_red_zone and result == "field goal":
        offense.team_stats["red_zone_scores"] += 1
    return play_ran, result, yardline, seconds_remaining


def _hail_mary(offense, defense, yardline, seconds_remaining):
    """One deep throw with the clock at zero."""
    players = offense.get_offense()
    qb = next((p for p in players if p.position == "QB"), None)
    targets = [p for p in players if p.position in ("WR", "TE")]
    seconds_remaining -= random.randint(5, 8)
    if qb is None or not targets:
        return "pass", "end_of_half", yardline, seconds_remaining
    target = max(targets, key=lambda p: (p.hands or 50) + (p.speed or 50))
    qb.stats["pass_attempts"] += 1
    target.stats["targets"] += 1
    if random.random() < cfg.HAIL_MARY_SUCCESS * (1 + (getattr(qb, "passing", 50) - cfg.NEUTRAL) / 100):
        yards = 100 - yardline
        qb.stats["completions"] += 1
        qb.stats["pass_yards"] += yards
        qb.stats["passing_touchdowns"] += 1
        target.stats["receptions"] += 1
        target.stats["receiving_yards"] += yards
        target.stats["receiving_touchdowns"] += 1
        from .play_functions import debug_td_stats
        debug_td_stats.append({"type": "passing", "qb": qb.name, "receiver": target.name, "receiver_position": target.position})
        return "pass", "touchdown", 100, seconds_remaining
    return "pass", "end_of_half", yardline, seconds_remaining


def sim_drive(offense, defense, down, first_down_yardage, yardline, seconds_remaining, hurrying=False, verbose=True, _red_zone_counted=False, trailing_late=False) :
    """Run one drive. Returns (last_play_type, result, yardline, seconds_remaining).

    Results: touchdown, field goal, missed kick, punt, turnover, safety,
    defensive_touchdown, punt_return_td, first_down (fallback).
    """
    kicker = next(p for p in offense.get_offense() if p.position == 'K')
    punter = next(p for p in offense.get_offense() if p.position == 'P')
    last_play_type =  None
    last_gain = 0
    result = ""
    play_ran = ""  # Initialize play_ran to track the type of play
    in_red_zone = yardline >= 80
    if in_red_zone and not _red_zone_counted:
        offense.team_stats["red_zone_trips"] += 1
    clock_stopped = True   # a drive starts after a change of possession: the clock starts on the snap
    while down < 4 :
        if verbose :
            print(down, "and", first_down_yardage, "at the", yardline)
        was_third = down == 3
        situation = sit.assess(offense, defense, seconds_remaining, down, first_down_yardage, yardline, clock_stopped)
        posture = sit.defense_posture(offense, defense, seconds_remaining)
        if situation.get("fg_now"):
            return _clutch_kick(offense, defense, kicker, yardline, seconds_remaining, in_red_zone, play_ran or "pass")
        if situation.get("hail_mary"):
            return _hail_mary(offense, defense, yardline, seconds_remaining)
        play_ran, result, yards_gained, time, info = sim_play(offense, defense, down, first_down_yardage, yardline, hurrying, last_play_type, last_gain, seconds_remaining, False, clock_stopped, situation, posture)
        clock_stopped = info.get("stopped", False)
        seconds_remaining -= time
        down, first_down_yardage, yardline, safety_occurred = process_play(result, play_ran, yards_gained, yardline, down, first_down_yardage)
        if down == 1 and result in ("run", "successful_pass", "checkdown_pass", "defensive penalty"):
            offense.team_stats["first_downs"] += 1
        if was_third and result != "offensive penalty" and result != "defensive penalty":
            offense.team_stats["third_downs"] += 1
            if down in (1, 6):
                offense.team_stats["third_down_conversions"] += 1
        if not in_red_zone and yardline >= 80 and down < 5:
            in_red_zone = True
            offense.team_stats["red_zone_trips"] += 1
        if safety_occurred:
            return play_ran, "safety", yardline, seconds_remaining
        if result == "defensive_touchdown":
            # Pick-six or fumble return: the drive is over and the defense scored.
            return play_ran, result, yardline, seconds_remaining
        if seconds_remaining <= 0 and down < 4:
            return play_ran, "end_of_half", yardline, seconds_remaining
    if down == 4 and seconds_remaining <= 0:
        return play_ran, "end_of_half", yardline, seconds_remaining
    if down == 4 :
        go_rate = (getattr(offense, "tendencies", {}) or {}).get("fourth_down_go_rate", 50)
        situation = sit.assess(offense, defense, seconds_remaining, down, first_down_yardage, yardline, clock_stopped)
        posture = sit.defense_posture(offense, defense, seconds_remaining)
        if situation.get("fg_now"):
            return _clutch_kick(offense, defense, kicker, yardline, seconds_remaining, in_red_zone, play_ran or "pass")
        if situation.get("hail_mary"):
            return _hail_mary(offense, defense, yardline, seconds_remaining)
        must_go = situation.get("mode") in ("hurry", "desperate") and getattr(offense, "lead", 0) < -3 and seconds_remaining <= cfg.HURRY_SECONDS_TRAILING / 2
        if must_go or should_go_for_it(first_down_yardage, yardline, seconds_remaining, trailing_late, go_rate, getattr(offense, "lead", 0)) :
            play_ran, result, yards_gained, time, info = sim_play(offense, defense, down, first_down_yardage, yardline, hurrying, last_play_type, last_gain, seconds_remaining, False, clock_stopped, situation, posture)
            clock_stopped = info.get("stopped", False)
            seconds_remaining -= time
            down, first_down_yardage, yardline, safety_occurred = process_play(result, play_ran, yards_gained, yardline, down, first_down_yardage)
            if result not in ("offensive penalty", "defensive penalty"):
                offense.team_stats["fourth_down_attempts"] += 1
                if down in (1, 6):
                    offense.team_stats["fourth_down_conversions"] += 1
            if down == 1 and result in ("run", "successful_pass", "checkdown_pass", "defensive penalty"):
                offense.team_stats["first_downs"] += 1
            if not in_red_zone and yardline >= 80 and down < 5:
                in_red_zone = True
                offense.team_stats["red_zone_trips"] += 1
            if safety_occurred:
                return play_ran, "safety", yardline, seconds_remaining
            if result == "defensive_touchdown":
                return play_ran, result, yardline, seconds_remaining
            if down in (1, 4):
                # Converted (fresh set of downs) or a penalty kept it 4th down: keep driving.
                return sim_drive(offense, defense, down, first_down_yardage, yardline, seconds_remaining, hurrying, verbose, _red_zone_counted=in_red_zone, trailing_late=trailing_late)
        else :
            fg_distance = (100 - yardline) + 17
            in_range = fg_distance <= fg_max_distance(kicker)
            if in_range and fg_distance >= 50 and random.random() > cfg.FG_LONG_ATTEMPT_CHANCE:
                in_range = False   # coach punts rather than try the long one
            if in_range:
                kick_time = random.randint(5, 7)
                seconds_remaining -= kick_time
                kick_made, kick_blocked = attempt_kick(yardline, kicker, defense)
                if kick_blocked:
                    if verbose:
                        print("Field goal BLOCKED!")
                    result = "missed kick"
                elif kick_made:
                    if verbose:
                        print((100 - yardline)+17, "yard kick is good!")
                    result = "field goal"
                else :
                    result = "missed kick"
            else:
                yardline, punt_distance, punt_blocked, returner, return_yards, is_return_td = attempt_punt(yardline, punter, defense, defense)  # the defense returns the punt
                punt_time = random.randint(6, 10)
                seconds_remaining -= punt_time
                if punt_blocked:
                    if verbose:
                        print("Punt BLOCKED!")
                    result = "turnover"  # Blocked punt is a turnover
                elif is_return_td:
                    if verbose:
                        print(f"PUNT RETURN TOUCHDOWN by {returner.name if returner else 'Unknown'}!")
                    result = "punt_return_td"
                else:
                    if verbose:
                        print(f"{punt_distance} yard punt.")
                    result = "punt"
    if in_red_zone and result == "field goal":
        offense.team_stats["red_zone_scores"] += 1
    if in_red_zone and down == 6 and result in ['run', 'successful_pass', 'checkdown_pass']:
        offense.team_stats["red_zone_scores"] += 1
        offense.team_stats["red_zone_touchdowns"] += 1
    if down == 5 :
        result = "turnover"
    if down == 6 :
        if result in ['run', 'successful_pass', 'checkdown_pass']:
            result = "touchdown"
        else:
            # Reached the goal line on a play that is not a scoring play (a penalty):
            # treat it as first and goal at the 1 rather than a touchdown.
            result = "first_down"
            yardline = 1
            down = 1
            first_down_yardage = 10
    return play_ran, result, yardline, seconds_remaining
