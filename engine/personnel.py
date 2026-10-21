"""Personnel: who is on the field for a snap.

Offense picks a grouping (11, 12, 10, 21, 13, jumbo) from the coordinator's scheme and the
situation; defense answers with its base front (4-3, 3-4, 4-2-5, 3-3-5) or a nickel, dime
or heavy package. The lineup builder in roster.Team fills each grouping from the depth
chart, honouring the fatigue rotation (in_game flags) and injuries. All the probabilities
here are in game_config so they can be tuned with the rest of the engine.
"""
from __future__ import annotations

import random

from . import game_config as cfg

# Offensive groupings: RB, TE, WR, OL counts (the QB is always one).
GROUPINGS = {
    "10": {"RB": 1, "TE": 0, "WR": 4, "OL": 5},
    "11": {"RB": 1, "TE": 1, "WR": 3, "OL": 5},
    "12": {"RB": 1, "TE": 2, "WR": 2, "OL": 5},
    "21": {"RB": 2, "TE": 1, "WR": 2, "OL": 5},
    "13": {"RB": 1, "TE": 3, "WR": 1, "OL": 5},
    "22": {"RB": 2, "TE": 2, "WR": 1, "OL": 5},
    "jumbo": {"RB": 1, "TE": 2, "WR": 1, "OL": 6},
    "option": {"RB": 3, "TE": 1, "WR": 1, "OL": 5},   # flexbone: fullback and two slotbacks
}

# How often each scheme lines up in each grouping on a normal down (weights).
SCHEME_MIX = {
    "Air Raid": {"10": 0.45, "11": 0.50, "12": 0.05},
    "Spread RPO": {"11": 0.68, "10": 0.22, "12": 0.10},
    "Spread Option": {"11": 0.55, "10": 0.15, "12": 0.20, "21": 0.10},
    "Power Spread": {"11": 0.55, "12": 0.30, "10": 0.05, "21": 0.10},
    "West Coast": {"11": 0.55, "12": 0.25, "21": 0.15, "13": 0.05},
    "Pro Style": {"11": 0.40, "12": 0.35, "21": 0.15, "13": 0.10},
    "Multiple": {"11": 0.50, "12": 0.25, "10": 0.10, "21": 0.10, "13": 0.05},
    "Flexbone Triple Option": {"option": 0.80, "21": 0.10, "12": 0.10},
}
DEFAULT_MIX = SCHEME_MIX["Multiple"]

# Defensive fronts: EDGE, DT, LB, CB, S counts (11 players).
FRONTS = {
    "4-3": {"EDGE": 2, "DT": 2, "LB": 3, "CB": 2, "S": 2},
    "3-4": {"EDGE": 2, "DT": 1, "LB": 4, "CB": 2, "S": 2},
    "4-2-5": {"EDGE": 2, "DT": 2, "LB": 2, "CB": 3, "S": 2},
    "3-3-5": {"EDGE": 2, "DT": 1, "LB": 3, "CB": 2, "S": 3},   # three safeties (Wake Forest, Troy, Tulsa, UAB)
}
SCHEME_FRONT = {"4-3": "4-3", "3-4": "3-4", "Tite Front 3-4": "3-4", "4-2-5": "4-2-5", "Multiple 4-2-5": "4-2-5", "3-3-5": "3-3-5"}


def offense_grouping(scheme: str, down: int, distance: int, yardline: int, conservative: bool, hurrying: bool) -> str:
    """The grouping for this snap. Normal downs follow the scheme's mix; passing downs go
    light, short yardage and the goal line go heavy, a leader milking the clock goes heavy."""
    goal_line = yardline >= 95
    short = distance <= 2 and down >= 3
    passing_down = (down >= 3 and distance >= 7) or hurrying
    flexbone = scheme == "Flexbone Triple Option"
    if goal_line or short:
        if flexbone:
            return "option"
        r = random.random()
        if r < cfg.HEAVY_JUMBO_SHARE:
            return "jumbo"
        if r < cfg.HEAVY_JUMBO_SHARE + cfg.HEAVY_13_SHARE:
            return "13"
        if r < 0.8:
            return "22"
        return "12"
    if passing_down and not flexbone:
        if random.random() < cfg.PASSING_DOWN_10_SHARE * (1.6 if scheme == "Air Raid" else 1.0):
            return "10"
        return "11"
    if conservative and not flexbone and random.random() < cfg.CONSERVATIVE_HEAVY_SHARE:
        return "12" if random.random() < 0.6 else "21"
    mix = SCHEME_MIX.get(scheme, DEFAULT_MIX)
    names = list(mix)
    return random.choices(names, weights=[mix[n] for n in names], k=1)[0]


def defense_package(scheme: str, grouping: str, down: int, distance: int) -> dict:
    """The defensive counts for this snap. The base front answers 12 and 21 personnel; three
    receivers bring a fifth defensive back (always for a 4-2-5 or 3-3-5, often for a 4-3 or
    3-4); four receivers or third-and-long bring a sixth; extra tight ends take a back off
    the field for a linebacker. Linebackers trade one-for-one with the backs."""
    base = dict(FRONTS[SCHEME_FRONT.get(scheme, "4-2-5")])
    receivers = GROUPINGS[grouping]["WR"]
    passing_down = down >= 3 and distance >= 7
    dbs = base["CB"] + base["S"]
    target = dbs
    if receivers >= 4:
        target = 6
    elif receivers == 3:
        if passing_down:
            target = 6 if random.random() < cfg.DIME_ON_PASSING_DOWN else 5
        elif dbs >= 5 or random.random() < cfg.NICKEL_VS_11:
            target = 5
    elif receivers <= 1:
        target = max(4, dbs - 1)
    while dbs < target and base["LB"] > 1:
        base["LB"] -= 1
        if base["CB"] < 4:
            base["CB"] += 1
        else:
            base["S"] += 1
        dbs += 1
    while dbs > target and dbs > 4:
        if base["CB"] > 2:
            base["CB"] -= 1
        else:
            base["S"] -= 1
        base["LB"] += 1
        dbs -= 1
    return base


def pass_rushers(defense: list) -> list:
    """Who rushes the passer: every lineman on the field, plus the best-rushing linebackers
    up to four rushers (a 3-4 sends an outside linebacker)."""
    line = [p for p in defense if p.position == "DL"]
    if len(line) >= 4:
        return line
    backers = sorted((p for p in defense if "LB" in p.position), key=lambda p: -(p.rushing or 0))
    return line + backers[: 4 - len(line)]
