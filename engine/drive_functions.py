import random

from . import game_config as cfg
from . import personnel
from . import play_functions
from . import situation as sit
from .game_config import sliders
from .game_functions import apply_general_fatigue, fg_max_distance, get_punt_distance
from .play_functions import get_pass_yards, get_run_yards
from .roster import return_skill

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
    run_chance -= cfg.PASS_LEAN
    run_chance += run_shift
    run_chance = max(cfg.RUN_CHANCE_MIN, min(cfg.RUN_CHANCE_MAX_OPTION if pass_rate <= 5 else cfg.RUN_CHANCE_MAX, run_chance))
    return "run" if random.random() < run_chance else "pass"


# The defensive call by down: (yards to go or fewer, the call the defense leans to, how often).
DEFENSE_CALL_TABLE = {
    1: [
        (3,  "defend_run", 0.75),
        (6,  "defend_run", 0.60),
        (10, "defend_pass", 0.55),
        (float('inf'), "defend_pass", 0.70),
    ],
    2: [
        (3,  "defend_run", 0.65),
        (6,  "defend_pass", 0.60),
        (10, "defend_pass", 0.70),
        (float('inf'), "defend_pass", 0.80),
    ],
    3: [
        (3,  "defend_run", 0.60),
        (6,  "defend_pass", 0.70),
        (10, "defend_pass", 0.85),
        (float('inf'), "defend_pass", 0.90),
    ],
}


def determine_defense_play(down, first_down):
    """Run or pass defense from the down-and-distance table; fourth down defends the pass."""
    for limit, lean, chance in DEFENSE_CALL_TABLE.get(down, []):
        if first_down <= limit:
            other = "defend_pass" if lean == "defend_run" else "defend_run"
            return lean if random.random() < chance else other
    return "defend_pass"


# Every snap, kick and punt of the game in order; game.py slices it into drives for the
# box score's play-by-play. Names come from play_functions.last_play. Nothing here draws
# a random number, so the log never changes a result.
play_log: list = []


def _log(**entry) -> dict:
    entry.update(play_functions.last_play)
    play_log.append(entry)
    return entry


def _momentum_play(offense, defense, play_ran, result, yards, after, pre_down, fourth, safety):
    """Momentum after a snap (no random numbers; nothing happens unless cfg.MOMENTUM)."""
    if not cfg.MOMENTUM:
        return
    offense.momentum *= cfg.MOMENTUM_DECAY
    defense.momentum *= cfg.MOMENTUM_DECAY
    if result == "defensive_touchdown":
        offense.swing(-0.4); defense.swing(0.5)
    elif result in ("interception", "fumble"):
        offense.swing(-0.35); defense.swing(0.4)
    elif after == 6:
        offense.swing(0.35); defense.swing(-0.25)
    elif safety:
        offense.swing(-0.3); defense.swing(0.3)
    elif result == "sack":
        offense.swing(-0.06); defense.swing(0.1)
    elif result == "offensive penalty":
        offense.swing(-0.03)
    elif result == "defensive penalty":
        defense.swing(-0.03)
    elif result in ("run", "successful_pass", "checkdown_pass"):
        if isinstance(yards, (int, float)) and yards >= 20:
            offense.swing(0.12); defense.swing(-0.06)
        elif play_ran == "run" and isinstance(yards, (int, float)) and yards < 0:
            defense.swing(0.05)
        if after == 1 and pre_down == 3:
            offense.swing(0.05)
    if pre_down == 3 and after == 4:
        defense.swing(0.05)
    if fourth:
        if after == 1 or after == 6:
            offense.swing(0.2); defense.swing(-0.15)
        elif after == 5:
            offense.swing(-0.2); defense.swing(0.25)


def _momentum_kick(offense, defense, kind, result):
    if not cfg.MOMENTUM:
        return
    if kind == "field_goal":
        if result == "good":
            offense.swing(0.1)
        elif result == "blocked":
            offense.swing(-0.25); defense.swing(0.25)
        else:
            offense.swing(-0.15); defense.swing(0.1)
    elif kind == "punt":
        if result == "blocked":
            offense.swing(-0.25); defense.swing(0.25)
        elif result == "return_td":
            offense.swing(-0.3); defense.swing(0.4)


def sim_play(offense_team, defense_team, down, first_down_yardage, yardline, hurrying=False, last_play_type=None, last_gain=0, seconds_remaining=cfg.HALF_SECONDS, verbose=True, clock_stopped=True, situation=None, posture=None):
    """One snap: fatigue and substitutions, a possible penalty, then a run or a pass.
    Returns (play_ran, result, yards, seconds_used, info) where info says whether the clock is
    stopped until the next snap and whether the carrier went out of bounds."""
    apply_general_fatigue(offense_team.get_offense(), defense_team.get_defense())
    offense_team.sub_skill_position_players(cfg.SKILL_SUB_FATIGUE)
    defense_team.sub_defensive_players(50)
    offense_team.recover_bench_players()
    defense_team.recover_bench_players()
    # Score situation (set by the game loop): garbage time, comebacks, victory formation.
    lead = getattr(offense_team, "lead", 0)
    half = getattr(offense_team, "half", 1)
    overtime = getattr(offense_team, "in_overtime", False)
    blowout = (half == 2 and lead >= cfg.GARBAGE_LEAD) or lead >= cfg.GARBAGE_LEAD_ANY
    # Personnel for this snap: the offense's grouping from its scheme and the situation, the
    # defense's package in answer to it.
    grouping = personnel.offense_grouping(getattr(offense_team, "offense_scheme", "Multiple"), down, first_down_yardage, yardline, blowout, hurrying)
    offense_team.set_grouping(grouping, personnel.GROUPINGS[grouping])
    defense_team.set_front(personnel.defense_package(getattr(defense_team, "defense_scheme", "4-2-5"), grouping, down, first_down_yardage))
    offense = offense_team.get_offense()
    defense = defense_team.get_defense()
    for p in offense + defense:
        p.stats["snaps"] = p.stats.get("snaps", 0) + 1

    off_tendencies = getattr(offense_team, "tendencies", None) or {}
    def_tendencies = getattr(defense_team, "tendencies", None) or {}
    tendencies = off_tendencies      # this snap's copy gains the situation's keys below

    # Clock pace: higher game-speed slider means faster plays; plays drag late in a half.
    game_speed_mult = 2.0 - sliders.get_multiplier(sliders.game_speed)
    game_speed_mult *= 1.0 - (tendencies.get("tempo", 50) - 50) / 100 * cfg.TEMPO_EFFECT
    progress = max(0.0, min(1.0, 1.0 - seconds_remaining / cfg.HALF_SECONDS))
    drag = 1.0 + progress * cfg.LATE_GAME_DRAG
    situation = situation or sit.assess(offense_team, defense_team, seconds_remaining, down, first_down_yardage, yardline, clock_stopped)
    posture = posture or sit.defense_posture(offense_team, defense_team, seconds_remaining)

    run_shift = 0.0
    if not overtime:
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
        # Starters sit once the game is decided, on both sides: the leader rests its stars
        # and the trailing team plays its backups too (as real teams do in a blowout).
        decided = abs(lead) >= cfg.BENCH_LEAD and (half == 2 or abs(lead) >= cfg.GARBAGE_LEAD_ANY)
        if decided:
            offense_team.rest_starters("offense")
            defense_team.rest_starters("defense")
        elif abs(lead) < cfg.BENCH_LEAD - 14:
            offense_team.restore_starters("offense")
            defense_team.restore_starters("defense")

    pace_mult = game_speed_mult * drag

    def clock(result, oob=False, first_down=False):
        secs, stopped = sit.play_clock(result, oob, first_down, seconds_remaining, situation, posture,
                                       offense_team, defense_team, pace_mult)
        return max(1, secs), {"stopped": stopped, "oob": oob}

    play_functions.last_play.clear()
    off_penalty_chance = sliders.get_inverse_percentage_adjustment(sliders.offensive_penalties, cfg.OFF_PENALTY_CHANCE)
    # ratings v2: a smart unit commits fewer penalties
    off_penalty_chance *= max(0.5, 1 - (_unit_iq(offense) - cfg.ATTR_LEAGUE_AVG) * cfg.PENALTY_IQ_EFFECT)
    off_penalty_chance *= max(0.5, 1 - (off_tendencies.get("discipline", 50) - 50) * cfg.DISCIPLINE_EFFECT)
    if random.random() < off_penalty_chance:
        penalty_type = random.choices(
            ["false_start", "holding", "offensive_pass_interference", "delay_of_game"],
            weights=[0.3, 0.4, 0.15, 0.15], k=1)[0]
        penalty_yards = {"false_start": -5, "holding": -10, "offensive_pass_interference": -15, "delay_of_game": -5}[penalty_type]
        offense_team.team_stats["penalties"] += 1
        offense_team.team_stats["penalty_yards"] += abs(penalty_yards)
        if verbose:
            print(f"Penalty: {penalty_type.replace('_', ' ').title()} for {abs(penalty_yards)} yards")
        play_functions.last_play["penalty"] = penalty_type.replace("_", " ")
        return "penalty", "offensive penalty", penalty_yards, *clock("offensive penalty")

    def_penalty_chance = sliders.get_inverse_percentage_adjustment(sliders.defensive_penalties, cfg.DEF_PENALTY_CHANCE)
    def_penalty_chance *= max(0.5, 1 - (_unit_iq(defense) - cfg.ATTR_LEAGUE_AVG) * cfg.PENALTY_IQ_EFFECT)
    def_penalty_chance *= max(0.5, 1 - (def_tendencies.get("discipline", 50) - 50) * cfg.DISCIPLINE_EFFECT)
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
        play_functions.last_play["penalty"] = penalty_type.replace("_", " ")
        return "penalty", "defensive penalty", penalty_yards, *clock("defensive penalty")

    # Victory formation: kneel it out (the leader can burn the rest of the clock).
    if situation.get("kneel"):
        secs = cfg.KNEEL_PLAY_SECONDS
        if getattr(defense_team, "timeouts", 0) > 0:
            defense_team.timeouts -= 1       # the defense stops the clock after the kneel
        else:
            secs += cfg.KNEEL_RUNOFF
        play_functions.last_play["kneel"] = True
        return "run", "run", -1, max(1, min(secs, max(1, seconds_remaining))), {"stopped": False, "oob": False, "kneel": True}
    # Spike: stop the clock at the cost of a down.
    if situation.get("spike"):
        qb = next((p for p in offense if p.position == "QB"), None)
        if qb is not None:
            qb.stats["pass_attempts"] += 1
        play_functions.last_play["spike"] = True
        return "pass", "incomplete", 0, *clock("spike")
    run_shift += situation.get("pass_shift", 0.0)
    tendencies = {**tendencies, "big_play_mult": situation.get("big_play_mult", 1.0), "prevent": posture.get("prevent", False)}
    offense_play = determine_offense_play(down, first_down_yardage, last_play_type, last_gain,
                                          tendencies.get("pass_rate", 50), run_shift)
    defense_play = determine_defense_play(down, first_down_yardage)
    # The better play caller tilts the guessing game.
    edge = (def_tendencies.get("dc_play_calling", 50) - tendencies.get("oc_play_calling", 50)) / 100 * cfg.PLAY_CALLING_EFFECT
    if edge > 0 and random.random() < edge:
        defense_play = "defend_" + offense_play
    elif edge < 0 and random.random() < -edge:
        defense_play = "defend_pass" if offense_play == "run" else "defend_run"
    guessed_play = offense_play in defense_play
    if offense_play == "run":
        play_ran = "run"
        result, yards_gained = get_run_yards(offense, defense, down, first_down_yardage, guessed_play, yardline, tendencies=tendencies)
    else:
        play_ran = "pass"
        result, yards_gained = get_pass_yards(offense, defense, down, first_down_yardage, guessed_play, yardline, tendencies=tendencies,
                                              blitz_rate=def_tendencies.get("blitz_rate", 50), def_tendencies=def_tendencies)
    oob = sit.out_of_bounds(result, situation, posture)
    first_down = result in ("run", "successful_pass", "checkdown_pass") and isinstance(yards_gained, (int, float)) and yards_gained >= first_down_yardage
    if cfg.INJURIES:
        roll_injuries(offense_team, offense)
        roll_injuries(defense_team, defense)
    return play_ran, result, yards_gained, *clock(result, oob, first_down)


def _unit_iq(players):
    """The on-field unit's average Football IQ (ratings v2, house scale)."""
    vals = [p._iq for p in players]
    return sum(vals) / len(vals) if vals else 50.0


def roll_injuries(team, on_field):
    """Each player on the field can go down on a snap; most injuries end only his day,
    some cost weeks. Uses the injury RNG so results are unchanged when injuries are off."""
    rng = cfg.injury_rng
    for p in on_field:
        if p.position in ("K", "P"):
            continue
        if rng.random() < cfg.INJURY_PER_SNAP * cfg.INJURY_POSITION_MULT.get(p.position, 1.0) * p._durable:
            r = rng.random()
            weeks = next(w for cum, w in cfg.INJURY_SEVERITY if r <= cum)
            team.injure(p, weeks, rng.choice(cfg.INJURY_TYPES))


def process_play(result, play_type, yards, yardline, down, first_down_yardage):
    """Apply a play result to down, distance and yardline. Returns
    (down, first_down_yardage, yardline, safety_occurred); down 5 = turnover, 6 = touchdown."""
    safety_occurred = False
    if result == "defensive_touchdown":
        return down, first_down_yardage, yardline, safety_occurred
    if result in ("fumble", "interception"):
        # `yards` is the spot where the defense ended up, in the offense's direction.
        return 5, first_down_yardage, yards, safety_occurred
    if result in ('run', 'successful_pass', 'checkdown_pass'):
        yardline += yards
        first_down_yardage -= yards
        down += 1
    elif result == 'offensive penalty':
        pre_penalty_yardline = yardline
        yardline = max(1, yardline + yards)
        first_down_yardage += pre_penalty_yardline - yardline
    elif result == 'defensive penalty':
        if yardline + yards >= 100:
            actual_penalty = 99 - yardline   # half the distance: never a touchdown by penalty
            yardline = 99
        else:
            yardline += yards
            actual_penalty = yards
        first_down_yardage = max(0, first_down_yardage - actual_penalty)
    elif result == 'sack':
        if yardline + yards <= 0:
            safety_occurred = True
            yardline = 0
        else:
            down += 1
            yardline += yards
            first_down_yardage -= yards
    elif result == 'incomplete':
        down += 1
    if yardline >= 100:
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
    one_score_early = trailing_late and -lead <= 8 and seconds_remaining > cfg.TRAILING_DESPERATE_SECONDS
    if one_score_early:
        # down one score with time left: still mostly normal football, a bit bolder
        trailing_late = False
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
    if not trailing_late and (yardline < 60 or distance <= 2):
        # more tries around midfield and on short yardage; in field-goal range they kick
        chance = min(0.95, chance * cfg.FOURTH_DOWN_AGGRESSION)
    chance *= 1.0 + (go_rate - 50) / 100 * cfg.FOURTH_DOWN_TENDENCY_EFFECT
    if one_score_early:
        chance = min(0.95, chance * cfg.TRAILING_ONE_SCORE_BOLDNESS)
    if lead >= cfg.BENCH_LEAD:
        chance = 0.0
    elif lead >= 17:
        chance *= 0.25
    return random.random() < chance


def attempt_kick(yardline, kicker, defense_team=None):
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
    if distance < 40:
        make += (getattr(kicker, "traits", None) or {}).get("automatic", 0) * cfg.TRAIT_FX["automatic"]
    make = max(0.03, min(0.98, make))
    made = random.random() < make
    if distance >= 50:
        bucket = "fg_50"
    elif distance >= 40:
        bucket = "fg_40"
    else:
        bucket = "fg_short"
    kicker.stats[bucket + "_att"] = kicker.stats.get(bucket + "_att", 0) + 1
    if made:
        kicker.stats["fg_made"] += 1
        kicker.stats[bucket + "_made"] = kicker.stats.get(bucket + "_made", 0) + 1
        if distance > kicker.stats.get("long_fg", 0):
            kicker.stats["long_fg"] = distance
    return made, False


def _fg_result(made, blocked):
    """The field goal as the play log and momentum name it."""
    if blocked:
        return "blocked"
    return "good" if made else "missed"


def attempt_punt(yardline, punter, defense_team=None, return_team=None):
    """Punt and return. Returns (final_yardline, punt_yards, is_blocked, returner, return_yards,
    is_return_td, how) and records the punter's stats (gross and net yards, inside the 20,
    touchbacks, long) and the returner's. `how` is how the punt ended: returned, fair_catch,
    downed, out_of_bounds, touchback, blocked or fake. punt_yards is the gross (official)
    distance; net is the gross less the return, and 20 yards less on a touchback."""
    final_spot, gross, blocked, returner, return_yards, td, how = _attempt_punt(yardline, punter, defense_team, return_team)
    st = punter.stats
    st["punts"] += 1
    if not blocked and how != "fake":
        st["punt_yards"] += gross
        st["punt_net_yards"] = st.get("punt_net_yards", 0) + gross - return_yards - (20 if how == "touchback" else 0)
        if gross > st.get("long_punt", 0):
            st["long_punt"] = gross
        if how == "touchback":
            st["punt_touchbacks"] = st.get("punt_touchbacks", 0) + 1
        elif not td and final_spot >= 80:
            st["punts_inside_20"] = st.get("punts_inside_20", 0) + 1
    if returner is not None and how == "returned":
        rs = returner.stats
        rs["punt_returns"] = rs.get("punt_returns", 0) + 1
        rs["punt_return_yards"] = rs.get("punt_return_yards", 0) + return_yards
        if td:
            rs["punt_return_touchdowns"] = rs.get("punt_return_touchdowns", 0) + 1
        if return_yards > rs.get("long_punt_return", 0):
            rs["long_punt_return"] = return_yards
    return final_spot, gross, blocked, returner, return_yards, td, how


def _punt_return_yards(returner):
    """Yards on a punt that is returned: mostly short (a typical return is 4-7 yards, a few
    lose yards), with the odd breakaway that pulls the average up to about 8-9."""
    mult = sliders.get_multiplier(sliders.kickoff_return)   # the return slider covers both kicks
    mult *= 1 + (return_skill(returner) - cfg.PUNT_RETURNER_TYPICAL) * cfg.PUNT_RETURN_SKILL
    chance, mean, sd = cfg.PUNT_BREAKAWAY
    if random.random() < chance * mult:
        return max(15, round(random.gauss(mean, sd)))
    shape, scale = cfg.PUNT_RETURN_YARDS
    return round(random.gammavariate(shape, scale) * mult) - 2


def _attempt_punt(yardline, punter, defense_team=None, return_team=None):
    """The kick and what happens to it. Returns (final_yardline, gross_yards, is_blocked,
    returner, return_yards, is_return_td, how); attempt_punt keeps the stats."""
    # College chaos: an occasional fake from the punter's own side of the field, treated as
    # a failed one (the ball goes over where it was snapped).
    if yardline < 50 and random.random() < 0.003:
        return yardline, 0, False, None, 0, False, "fake"
    if random.random() < 0.005:
        if defense_team:
            defense_team.team_stats["blocked_punts"] += 1
        return yardline, 0, True, None, 0, False, "blocked"

    landing = yardline + get_punt_distance(punter)

    # Would carry inside the 10: the punter aims short of the goal line (a pooch or a
    # coffin-corner kick) and either pins the receiving team or loses it into the end zone.
    if landing >= 90:
        pin = cfg.PUNT_PIN_CHANCE + ((punter.punt_accuracy or cfg.NEUTRAL) - cfg.NEUTRAL) / 100
        if random.random() < pin:
            spot = min(landing, random.randint(88, 99))
            return spot, spot - yardline, False, None, 0, False, random.choice(("fair_catch", "downed", "out_of_bounds"))
        return 80, 100 - yardline, False, None, 0, False, "touchback"

    returner = return_team.get_punt_returner() if return_team else None
    if returner is not None:
        return_team.refresh_ratings([returner])
    deep, short = cfg.PUNT_RETURN_CHANCE
    if returner is not None and random.random() < (short if landing >= 80 else deep):
        gross = landing - yardline
        td_chance = cfg.PUNT_RETURN_TD * sliders.get_multiplier(sliders.kickoff_return) \
            * (1 + (return_skill(returner) - cfg.PUNT_RETURNER_TYPICAL) * cfg.PUNT_RETURN_SKILL)
        if random.random() < td_chance:
            return 100, gross, False, returner, landing, True, "returned"
        ret = min(_punt_return_yards(returner), landing - 1)
        return landing - ret, gross, False, returner, ret, False, "returned"

    # Not returned: a fair catch where it comes down, downed after it rolls on, or out of bounds.
    fair, downed, _ = cfg.PUNT_UNRETURNED
    r = random.random()
    if r < fair:
        spot, how = landing, "fair_catch"
    elif r < fair + downed:
        spot, how = landing + round(random.gauss(*cfg.PUNT_ROLL)), "downed"
    else:
        spot, how = landing - random.randint(0, 4), "out_of_bounds"
    if spot >= 100:
        return 80, 100 - yardline, False, None, 0, False, "touchback"
    spot = min(spot, 99)
    return spot, spot - yardline, False, None, 0, False, how


def _clutch_kick(offense, defense, kicker, yardline, seconds_remaining, in_red_zone, play_ran):
    """Field goal with the clock about to run out, on any down."""
    seconds_remaining -= random.randint(4, 6)
    kick_made, kick_blocked = attempt_kick(yardline, kicker, defense)
    result = "field goal" if kick_made and not kick_blocked else "missed kick"
    if in_red_zone and result == "field goal":
        offense.team_stats["red_zone_scores"] += 1
    fg_result = _fg_result(kick_made, kick_blocked)
    play_functions.last_play.clear()
    _log(type="field_goal", result=fg_result, distance=(100 - yardline) + 17,
         down=None, dist=None, yl=yardline, kicker=kicker.name if kicker else None, left=seconds_remaining, clutch=True)
    _momentum_kick(offense, defense, "field_goal", fg_result)
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
    play_functions.last_play.clear()
    hm = _log(type="pass", result="incomplete", down=None, dist=None, yl=yardline, yards=0, to=yardline, left=seconds_remaining, hail_mary=True, qb=qb.name, target=target.name, target_pos=target.position)
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
        play_functions.debug_td_stats.append({"type": "passing", "qb": qb.name, "receiver": target.name, "receiver_position": target.position})
        hm.update(result="successful_pass", yards=yards, to=100, after=6)
        return "pass", "touchdown", 100, seconds_remaining
    return "pass", "end_of_half", yardline, seconds_remaining


def _count_progress(offense, result, down, yardline, in_red_zone):
    """First downs and red-zone trips after a snap. Returns whether the drive is now in the red zone."""
    if down == 1 and result in ("run", "successful_pass", "checkdown_pass", "defensive penalty"):
        offense.team_stats["first_downs"] += 1
    if not in_red_zone and yardline >= 80 and down < 5:
        offense.team_stats["red_zone_trips"] += 1
        return True
    return in_red_zone


def sim_drive(offense, defense, down, first_down_yardage, yardline, seconds_remaining, hurrying=False, verbose=True, _red_zone_counted=False, trailing_late=False):
    """Run one drive. Returns (last_play_type, result, yardline, seconds_remaining).

    Results: touchdown, field goal, missed kick, punt, turnover, safety,
    defensive_touchdown, punt_return_td, first_down (fallback).
    """
    kicker = offense.get_kicker()
    punter = offense.get_punter()
    last_play_type = None
    last_gain = 0
    result = ""
    play_ran = ""  # Initialize play_ran to track the type of play
    in_red_zone = yardline >= 80
    if in_red_zone and not _red_zone_counted:
        offense.team_stats["red_zone_trips"] += 1
    clock_stopped = True   # a drive starts after a change of possession: the clock starts on the snap
    while down < 4:
        if verbose:
            print(down, "and", first_down_yardage, "at the", yardline)
        was_third = down == 3
        situation = sit.assess(offense, defense, seconds_remaining, down, first_down_yardage, yardline, clock_stopped)
        posture = sit.defense_posture(offense, defense, seconds_remaining)
        if situation.get("fg_now"):
            return _clutch_kick(offense, defense, kicker, yardline, seconds_remaining, in_red_zone, play_ran or "pass")
        if situation.get("hail_mary"):
            return _hail_mary(offense, defense, yardline, seconds_remaining)
        pre = (down, first_down_yardage, yardline)
        play_ran, result, yards_gained, time, info = sim_play(offense, defense, down, first_down_yardage, yardline, hurrying, last_play_type, last_gain, seconds_remaining, False, clock_stopped, situation, posture)
        clock_stopped = info.get("stopped", False)
        seconds_remaining -= time
        down, first_down_yardage, yardline, safety_occurred = process_play(result, play_ran, yards_gained, yardline, down, first_down_yardage)
        _log(type=play_ran, result=result, down=pre[0], dist=pre[1], yl=pre[2], yards=yards_gained, to=yardline, after=down, secs=time, left=seconds_remaining, safety=safety_occurred)
        _momentum_play(offense, defense, play_ran, result, yards_gained, down, pre[0], False, safety_occurred)
        if was_third and result not in ("offensive penalty", "defensive penalty"):
            offense.team_stats["third_downs"] += 1
            if down in (1, 6):
                offense.team_stats["third_down_conversions"] += 1
        in_red_zone = _count_progress(offense, result, down, yardline, in_red_zone)
        if safety_occurred:
            return play_ran, "safety", yardline, seconds_remaining
        if result == "defensive_touchdown":
            # Pick-six or fumble return: the drive is over and the defense scored.
            return play_ran, result, yardline, seconds_remaining
        if seconds_remaining <= 0 and down < 4:
            return play_ran, "end_of_half", yardline, seconds_remaining
    if down == 4 and seconds_remaining <= 0:
        return play_ran, "end_of_half", yardline, seconds_remaining
    if down == 4:
        go_rate = (getattr(offense, "tendencies", {}) or {}).get("fourth_down_go_rate", 50)
        situation = sit.assess(offense, defense, seconds_remaining, down, first_down_yardage, yardline, clock_stopped)
        posture = sit.defense_posture(offense, defense, seconds_remaining)
        if situation.get("fg_now"):
            return _clutch_kick(offense, defense, kicker, yardline, seconds_remaining, in_red_zone, play_ran or "pass")
        if situation.get("hail_mary"):
            return _hail_mary(offense, defense, yardline, seconds_remaining)
        lead_now = getattr(offense, "lead", 0)
        must_go = situation.get("mode") in ("hurry", "desperate") and lead_now < -3 and seconds_remaining <= cfg.HURRY_SECONDS_TRAILING / 2
        # down 1-3 late with a makeable kick: take the points to tie or go ahead
        tying_kick = (trailing_late and -3 <= lead_now < 0
                      and (100 - yardline) + 17 <= min(fg_max_distance(kicker), cfg.TYING_KICK_MAX_DISTANCE))
        if must_go or should_go_for_it(first_down_yardage, yardline, seconds_remaining, trailing_late and not tying_kick, go_rate, lead_now):
            pre = (down, first_down_yardage, yardline)
            play_ran, result, yards_gained, time, info = sim_play(offense, defense, down, first_down_yardage, yardline, hurrying, last_play_type, last_gain, seconds_remaining, False, clock_stopped, situation, posture)
            clock_stopped = info.get("stopped", False)
            seconds_remaining -= time
            down, first_down_yardage, yardline, safety_occurred = process_play(result, play_ran, yards_gained, yardline, down, first_down_yardage)
            _log(type=play_ran, result=result, down=pre[0], dist=pre[1], yl=pre[2], yards=yards_gained, to=yardline, after=down, secs=time, left=seconds_remaining, safety=safety_occurred, fourth=True)
            _momentum_play(offense, defense, play_ran, result, yards_gained, down, pre[0], True, safety_occurred)
            if result not in ("offensive penalty", "defensive penalty"):
                offense.team_stats["fourth_down_attempts"] += 1
                if down in (1, 6):
                    offense.team_stats["fourth_down_conversions"] += 1
            in_red_zone = _count_progress(offense, result, down, yardline, in_red_zone)
            if safety_occurred:
                return play_ran, "safety", yardline, seconds_remaining
            if result == "defensive_touchdown":
                return play_ran, result, yardline, seconds_remaining
            if down in (1, 4):
                # Converted (fresh set of downs) or a penalty kept it 4th down: keep driving.
                return sim_drive(offense, defense, down, first_down_yardage, yardline, seconds_remaining, hurrying, verbose, _red_zone_counted=in_red_zone, trailing_late=trailing_late)
        else:
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
                else:
                    result = "missed kick"
                fg_result = _fg_result(kick_made, kick_blocked)
                play_functions.last_play.clear()
                _log(type="field_goal", result=fg_result, distance=fg_distance,
                     down=4, dist=first_down_yardage, yl=yardline, kicker=kicker.name if kicker else None, secs=kick_time, left=seconds_remaining)
                _momentum_kick(offense, defense, "field_goal", fg_result)
            else:
                punt_from = yardline
                yardline, punt_distance, punt_blocked, returner, return_yards, is_return_td, punt_how = attempt_punt(yardline, punter, defense, defense)  # the defense returns the punt
                if punt_how == "returned" and not is_return_td:
                    play_functions.credit_coverage_tackle(offense)
                punt_time = random.randint(6, 10)
                seconds_remaining -= punt_time
                if punt_blocked:
                    punt_result = "blocked"
                elif is_return_td:
                    punt_result = "return_td"
                else:
                    punt_result = "punt"
                play_functions.last_play.clear()
                _log(type="punt", result=punt_result, yards=punt_distance,
                     down=4, dist=first_down_yardage, yl=punt_from, to=yardline, punter=punter.name if punter else None,
                     returner=returner.name if returner else None, return_yards=return_yards, how=punt_how,
                     secs=punt_time, left=seconds_remaining)
                _momentum_kick(offense, defense, "punt", punt_result)
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
    if down == 5:
        result = "turnover"
    if down == 6:
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
