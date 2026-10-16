import random
from collections import defaultdict

from .game_config import sliders
from .roster import return_skill
from . import game_config as cfg

def sim_kickoff(kicker, return_team=None):
    """Kickoff from the 35 under college rules: touchbacks and fair catches inside the 25
    come out to the 25; otherwise the designated returner brings it out.
    Returns: (receiving team's yardline, returner, return_yards, is_touchdown)"""
    kick_power_mult = sliders.get_multiplier(sliders.kickoff_power)
    kick_power = (kicker.kick_power or cfg.NEUTRAL) * kick_power_mult
    kick_accuracy = kicker.kick_accuracy or cfg.NEUTRAL
    returner = return_team.get_kick_returner() if return_team else None
    if returner is not None:
        return_team.refresh_ratings([returner])

    # Out of bounds: receiving team takes it at the 40.
    if random.random() < max(0.01, cfg.KICKOFF_OOB_CHANCE - (kick_accuracy - cfg.NEUTRAL) * 0.0005):
        return 40, None, 0, False

    # Where the ball comes down, measured from the receiving team's goal line.
    distance = random.gauss(cfg.KICKOFF_DISTANCE, cfg.KICKOFF_DISTANCE_SD) + (kick_power - cfg.NEUTRAL) * cfg.KICKOFF_PER_POWER_POINT
    landing = 65 - distance
    if landing <= 0 and random.random() < cfg.KICKOFF_TOUCHBACK_FROM_END_ZONE:
        return 25, None, 0, False
    if 0 < landing < 25 and random.random() < cfg.KICKOFF_FAIR_CATCH_CHANCE:
        return 25, None, 0, False

    # Return
    return_mult = sliders.get_multiplier(sliders.kickoff_return)
    skill = return_skill(returner) if returner else 0.5
    td_chance = cfg.KICKOFF_RETURN_TD_CHANCE * return_mult * (0.5 + skill)
    if random.random() < td_chance:
        if returner:
            returner.stats["kickoff_returns"] = returner.stats.get("kickoff_returns", 0) + 1
            returner.stats["kickoff_return_yards"] = returner.stats.get("kickoff_return_yards", 0) + 100
            returner.stats["kickoff_return_touchdowns"] = returner.stats.get("kickoff_return_touchdowns", 0) + 1
        return 100, returner, 100, True
    start = max(landing, -8)  # a ball brought out of the end zone
    return_yards = random.gauss(cfg.KICKOFF_RETURN_YARDS, cfg.KICKOFF_RETURN_SD) * return_mult + (skill - 0.5) * 12
    if random.random() < cfg.KICKOFF_BIG_RETURN_CHANCE * (0.5 + skill):
        return_yards += random.randint(15, 45)
    return_yards = max(5, round(return_yards))
    end = max(1, min(99, round(start + return_yards)))
    if returner:
        returner.stats["kickoff_returns"] = returner.stats.get("kickoff_returns", 0) + 1
        returner.stats["kickoff_return_yards"] = returner.stats.get("kickoff_return_yards", 0) + return_yards
        if return_yards > returner.stats.get("long_kickoff_return", 0):
            returner.stats["long_kickoff_return"] = return_yards
    return end, returner, return_yards, False

def sim_pat(kicker, verbose=False):
    # Adjust base chance by kicking accuracy slider
    kick_acc_mult = sliders.get_multiplier(sliders.kicking_accuracy)
    base_chance = 0.975 * kick_acc_mult  # College PAT success rate ~97-98%
    
    # Adjust based on kicker accuracy (scale 50 = avg, 100 = elite)
    accuracy_adjustment = ((kicker.kick_accuracy - 50) * 0.003) * kick_acc_mult
    make_chance = max(0.94, min(0.995, base_chance + accuracy_adjustment))  # Tight range for college PATs
    
    # College chaos: occasional botched snap/hold (1% chance)
    if random.random() < 0.01:
        if verbose:
            print("PAT botched! Bad snap/hold!")
        kicker.stats["pat_attempts"] += 1
        return False
    
    kicker.stats["pat_attempts"] += 1
    made = random.random() < make_chance
    if made :
        kicker.stats["pat_made"] += 1
    if verbose:
        if made:
            print(f"PAT is good! ({int(make_chance*100)}% chance)")
        else:
            print(f"PAT missed! ({int(make_chance*100)}% chance)")

    return made

def sim_two_point_conversion(offense_list, defense_list, verbose=False, team_name=""):
    """Simulate a 2-point conversion attempt from the 3-yard line"""
    # 2-point conversion success rate in college is ~40-45%
    # Slightly favor pass plays (55% pass, 45% run)
    is_pass = random.random() < 0.55
    
    if is_pass:
        # Pass attempt from 3-yard line
        qb = next((p for p in offense_list if p.position == "QB"), None)
        if not qb:
            # Fallback if no QB found
            return random.random() < 0.40
        
        # High completion chance due to short distance
        base_completion = 0.50  # Base 50% completion rate for 2-pt conversion
        qb_skill = (qb.passing + qb.decision_making + qb.intelligence) / 300
        defense_coverage = sum(p.coverage for p in defense_list if p.position in ('CB', 'S')) / 2000
        
        completion_chance = base_completion + qb_skill - defense_coverage
        completion_chance = max(0.25, min(0.75, completion_chance))
        
        if random.random() < completion_chance:
            if verbose:
                print(f"{team_name} 2-point conversion PASS is GOOD!")
            return True
        else:
            if verbose:
                print(f"{team_name} 2-point conversion PASS is NO GOOD!")
            return False
    else:
        # Run attempt from 3-yard line
        # Higher success rate for runs in short yardage
        base_success = 0.45  # Base 45% success rate
        offense_line = sum(p.run_blocking for p in offense_list if p.position == 'OL') / 500
        defense_line = sum(p.tackling for p in defense_list if p.position in ('DL', 'OLB', 'MLB', 'ROLB')) / 800
        
        success_chance = base_success + offense_line - defense_line
        success_chance = max(0.30, min(0.70, success_chance))
        
        if random.random() < success_chance:
            if verbose:
                print(f"{team_name} 2-point conversion RUN is GOOD!")
            return True
        else:
            if verbose:
                print(f"{team_name} 2-point conversion RUN is NO GOOD!")
            return False

def fg_max_distance(kicker):
    """Longest field goal this kicker will attempt, in yards."""
    power_mult = sliders.get_multiplier(sliders.kicking_power)
    return round(cfg.FG_MAX_DISTANCE * power_mult + ((kicker.kick_power or 50) * power_mult - 50) / 8)

def get_kick_attempt_range(kicker) :
    """Yardline (0-100, offense's direction) from which a field goal is in range."""
    return 100 - (fg_max_distance(kicker) - 17)

def get_punt_distance(punter) :
    punt_power_mult = sliders.get_multiplier(sliders.kicking_power)
    mean, sd = cfg.PUNT_DISTANCE
    punt_distance = int(random.gauss(mean * punt_power_mult, sd))
    return (round(punt_distance + (((punter.punt_power or 50) * punt_power_mult) - 50) / 5))

def apply_baseline_fatigue(team):
    for player in team.offense + team.defense:
        base_chance = (100 - player.endurance) / 10  # chance out of 100
        if random.random() < base_chance / 100:
            max_fatigue = base_chance  # cap fatigue by same amount
            max_fatigue = max(1, round(max_fatigue))  # Ensure at least 1
            player.fatigue = random.randint(1, max_fatigue)
        else:
            player.fatigue = 0

def apply_general_fatigue(offense, defense):
    skill_positions = {'RB', 'TE', 'WR', 'CB', 'OLB', 'MLB', 'ROLB', 'S'}
    
    for player in offense + defense:
        if player.position in skill_positions:
            base_fatigue = 1.8  # skill players exert more per play
        else:
            base_fatigue = 0.1  # linemen/special teams, etc.

        endurance_factor = (100 - player.endurance) / 100  # 0.0–1.0
        fatigue = base_fatigue + (endurance_factor * base_fatigue)
        player.fatigue = min(100, player.fatigue + fatigue)

def apply_pass_fatigue(offense, defense, receiver=None, yards=0):
    # Apply fatigue to offensive skill players
    for player in offense:
        if player.position not in ("WR", "RB", "TE"):
            continue

        base_fatigue = 1 + (100 - player.endurance) / 80

        if receiver is not None and player == receiver:
            effort = 1 + (yards / 10)
            fatigue = base_fatigue + effort * (1 + (100 - player.endurance) / 100)
        else:
            fatigue = base_fatigue

        player.fatigue = min(100, player.fatigue + round(fatigue))

    # Apply lighter fatigue to defensive coverage players
    for player in defense:
        if player.position not in ("CB", "S", "OLB", "MLB", "ROLB", "LOLB"):
            continue

        fatigue = 0.5 + (100 - player.endurance) / 120  # ~0.5–1.3 range
        player.fatigue = min(100, player.fatigue + round(fatigue, 1))

def apply_run_fatigue(offense, defense, rusher=None, yards=0):
    # Apply fatigue to offensive skill players
    for player in offense:
        if player.position not in ("RB", "WR", "TE"):
            continue

        base_fatigue = 1 + (100 - player.endurance) / 80  # ~1–2.25

        if rusher is not None and player == rusher:
            effort = 1 + (yards / 7)  # Runs are more tiring per yard than catches
            fatigue = base_fatigue + effort * (1 + (100 - player.endurance) / 100)
        else:
            fatigue = base_fatigue * 0.75  # lighter if just blocking/running a decoy route

        player.fatigue = min(100, player.fatigue + round(fatigue))

    # Apply fatigue to front-seven defenders
    for player in defense:
        if player.position in ("DL", "OLB", "MLB", "ROLB", "LOLB", "S"):
            fatigue = 0.6 + (100 - player.endurance) / 110  # slightly higher than pass D
            player.fatigue = min(100, player.fatigue + round(fatigue, 1))

def summarize_stats(team):
    stat_totals = defaultdict(int)

    for player in team.offense + team.defense:
        for stat, value in player.stats.items():
            if isinstance(value, (int, float)):
                stat_totals[stat] += value
    
    # Add team-level stats
    stat_totals["kickoff_return_touchdowns"] = team.team_stats.get("kickoff_return_touchdowns", 0)
    stat_totals["blocked_kicks"] = team.team_stats.get("blocked_kicks", 0)
    stat_totals["blocked_punts"] = team.team_stats.get("blocked_punts", 0)

    return {
        "Pass Attempts": stat_totals.get("pass_attempts", 0),
        "Completions": stat_totals.get("completions", 0),
        "Pass Yards": stat_totals.get("pass_yards", 0),
        "Interceptions Thrown": stat_totals.get("interceptions_thrown", 0),
        "Sacks Taken": stat_totals.get("sacks_taken", 0),
        "Carries": stat_totals.get("carries", 0),
        "Rush Yards": stat_totals.get("rush_yards", 0),
        "Fumbles": stat_totals.get("fumbles", 0),
        "Receptions": stat_totals.get("receptions", 0),
        "Receiving Yards": stat_totals.get("receiving_yards", 0),
        "Targets": stat_totals.get("targets", 0),
        "Passing Touchdowns": stat_totals.get("passing_touchdowns", 0),
        "Receiving Touchdowns": stat_totals.get("receiving_touchdowns", 0),
        "Rushing Touchdowns": stat_totals.get("rushing_touchdowns", 0),
        "Solo Tackles": stat_totals.get("solo_tackles", 0),
        "Assisted Tackles": stat_totals.get("assisted_tackles", 0),
        "Sacks": stat_totals.get("sacks", 0),
        "Interceptions": stat_totals.get("interceptions", 0),
        "Forced Fumbles": stat_totals.get("forced_fumbles", 0),
        "PATs Made": stat_totals.get("pat_made", 0),
        "PATS Attempted" : stat_totals.get("pat_attempts", 0),
        "Field Goals Made": stat_totals.get("fg_made", 0),
        "Field Goals Attempted": stat_totals.get("fg_attempted", 0),
        "Punts": stat_totals.get("punts", 0),
        "Punt Yards": stat_totals.get("punt_yards", 0),
        "Kickoff Returns": stat_totals.get("kickoff_returns", 0),
        "Kickoff Return Yards": stat_totals.get("kickoff_return_yards", 0),
        "Kickoff Return Touchdowns": stat_totals.get("kickoff_return_touchdowns", 0),
        "Punt Returns": stat_totals.get("punt_returns", 0),
        "Punt Return Yards": stat_totals.get("punt_return_yards", 0),
        "Punt Return Touchdowns": stat_totals.get("punt_return_touchdowns", 0),
        "Defensive Touchdowns": stat_totals.get("defensive_touchdowns", 0),
        "Fumble Recoveries": stat_totals.get("fumble_recoveries", 0),
        "Fumble Return Yards": stat_totals.get("fumble_return_yards", 0),
        "Interception Return Yards": stat_totals.get("interception_return_yards", 0),
        "Blocked Kicks": stat_totals.get("blocked_kicks", 0),
        "Blocked Punts": stat_totals.get("blocked_punts", 0),
        "Safeties": team.team_stats.get("safeties", 0)
    }
