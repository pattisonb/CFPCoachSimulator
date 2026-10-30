"""What a player would be at another position (position_options / change_position, during the
season and in the offseason).

Why a plain `game_scale.overall(his ratings, new position)` was wrong: our ratings are kept on
each position group's own scale (50 is the middle Power 4 starter OF HIS GROUP, game_scale.to_ours),
so a safety whose run block is 21 on the source scale carries it as 48, the safeties' middle, and
the guards' formula, fit on guard-relative values (50 there is a source 61), read him as an
average blocker: a 197-pound free safety projected 67 at guard. `project` puts his ratings on the
new group's scale first (through the source scale), then discounts the position skills he has
never used and charges the size the new spot asks for.
"""
from __future__ import annotations

import json
import statistics as st
from functools import lru_cache
from pathlib import Path
from typing import Optional

from teamdata import game_scale

ROOT = Path(__file__).resolve().parents[1]
ENGINE_FILE = ROOT / "data" / "engine_teams.json"

SIZE_PENALTY = 5.0        # *tune* overall points lost per standard deviation light or short beyond the first
HEAVY_PENALTY = 3.0       # *tune* per standard deviation heavy beyond the first (speed positions pay SIZE_PENALTY)
SIZE_CAP = 30.0           # *tune* the most size can cost
NEAR_DISCOUNT = 0.85      # *tune* position skills kept on a move within the unit (S -> CB, WR -> TE, DT -> EDGE)
FAR_DISCOUNT = 0.6        # *tune* position skills kept on a move across units (S -> OL), above the position's floor
FLOOR = 20                # *tune* the lowest projection
SPEED_POSITIONS = ("WR", "CB", "HB", "FS", "SS")   # where extra weight costs as much as missing weight

# attributes every position uses the same way: they move with him untouched
ATHLETIC = frozenset({"speed", "acceleration", "agility", "strength", "jumping", "stamina", "injury", "toughness",
                      "change_of_direction", "awareness"})
# a raw athlete's position skills at a spot he has never played, on that group's scale  *tune*
POSITION_FLOOR = {"QB": 31, "HB": 38, "FB": 38, "WR": 36, "TE": 36, "LT": 34, "LG": 34, "C": 34, "RG": 34, "RT": 34,
                  "LEDG": 36, "REDG": 36, "DT": 36, "SAM": 38, "MIKE": 38, "WILL": 38, "CB": 36, "FS": 38, "SS": 38,
                  "K": 30, "P": 30}
# technique groups: a move inside one keeps every skill
SKILL_GROUP = {"QB": "QB", "HB": "RB", "FB": "RB", "WR": "WR", "TE": "TE", "LT": "OL", "LG": "OL", "C": "OL", "RG": "OL",
               "RT": "OL", "LEDG": "EDGE", "REDG": "EDGE", "DT": "DT", "SAM": "LB", "MIKE": "LB", "WILL": "LB",
               "CB": "CB", "FS": "S", "SS": "S", "K": "K", "P": "P"}
UNIT = {**{p: "offense" for p in ("QB", "HB", "FB", "WR", "TE", "LT", "LG", "C", "RG", "RT")},
        **{p: "defense" for p in ("LEDG", "REDG", "DT", "SAM", "MIKE", "WILL", "CB", "FS", "SS")}, "K": "special", "P": "special"}
ENGINE_TO_EA = {"RB": "HB", "OL": "LG", "DL": "DT", "MLB": "MIKE", "ROLB": "SAM", "LOLB": "WILL", "S": "FS"}   # an engine position without a role
# height (inches) and weight (pounds) by position, mean and standard deviation, when the engine file is missing
HAND_SIZES = {"QB": ((74.1, 1.8), (207.6, 14.6)), "HB": ((70.5, 1.7), (203.7, 15.4)), "FB": ((72.1, 1.5), (228.3, 14.0)),
              "WR": ((72.5, 2.4), (190.3, 14.5)), "TE": ((75.8, 1.9), (238.2, 16.9)), "LT": ((77.7, 1.4), (305.6, 18.5)),
              "LG": ((76.0, 1.4), (310.1, 19.6)), "C": ((75.2, 1.4), (299.9, 21.9)), "RG": ((76.0, 1.4), (310.4, 17.7)),
              "RT": ((77.6, 1.4), (305.4, 17.8)), "LEDG": ((75.7, 1.4), (254.4, 19.5)), "REDG": ((75.5, 1.4), (250.0, 18.0)),
              "DT": ((74.7, 1.5), (295.5, 21.5)), "SAM": ((73.9, 1.5), (227.7, 16.4)), "MIKE": ((73.5, 1.4), (226.9, 11.4)),
              "WILL": ((73.6, 1.4), (224.9, 11.5)), "CB": ((72.1, 1.6), (185.2, 10.4)), "FS": ((72.2, 1.6), (194.0, 10.9)),
              "SS": ((72.7, 1.6), (197.1, 11.4)), "K": ((71.6, 2.2), (191.0, 16.5)), "P": ((74.0, 2.0), (205.7, 17.0))}


@lru_cache(maxsize=1)
def sizes() -> dict[str, tuple[tuple[float, float], tuple[float, float]]]:
    """Position -> ((height mean, sd), (weight mean, sd)) from the real rosters (data/engine_teams.json),
    the hand table where the file is missing or a position has too few players."""
    out = dict(HAND_SIZES)
    if not ENGINE_FILE.exists():
        return out
    try:
        teams = json.loads(ENGINE_FILE.read_text(encoding="utf-8"))["teams"]
    except (OSError, ValueError, KeyError):
        return out
    by_pos: dict[str, list[tuple[int, int]]] = {}
    for t in teams.values():
        for p in t.get("offense", []) + t.get("defense", []):
            role, h, w = p.get("role"), p.get("height_in"), p.get("weight")
            if role in out and isinstance(h, (int, float)) and isinstance(w, (int, float)) and h > 0 and w > 0:
                by_pos.setdefault(role, []).append((h, w))
    for pos, v in by_pos.items():
        if len(v) >= 30:
            hs, ws = [x[0] for x in v], [x[1] for x in v]
            out[pos] = ((st.mean(hs), max(1.0, st.pstdev(hs))), (st.mean(ws), max(5.0, st.pstdev(ws))))
    return out


def size_penalty(height_in: Optional[int], weight_lbs: Optional[int], pos: str) -> float:
    """What his build costs at `pos`: SIZE_PENALTY per standard deviation light or short beyond the
    first, HEAVY_PENALTY per sd heavy beyond the first (as much as light at the speed positions),
    SIZE_CAP at most. An unknown height or weight costs nothing."""
    (hm, hsd), (wm, wsd) = sizes().get(pos, HAND_SIZES["WR"])
    cost = 0.0
    if isinstance(height_in, (int, float)) and height_in > 0:
        z = (hm - height_in) / hsd
        if z > 1:
            cost += SIZE_PENALTY * (z - 1)
    if isinstance(weight_lbs, (int, float)) and weight_lbs > 0:
        z = (wm - weight_lbs) / wsd
        if z > 1:
            cost += SIZE_PENALTY * (z - 1)
        elif z < -1:
            cost += (SIZE_PENALTY if pos in SPEED_POSITIONS else HEAVY_PENALTY) * (-z - 1)
    return min(SIZE_CAP, cost)


def transfer(attrs: dict, from_pos: str, to_pos: str) -> dict[str, int]:
    """His ratings as a player at `to_pos`: every rating put on the new group's scale (the same
    source value, read against the new group's middle starter), the position skills kept whole
    inside his technique group, within his unit the position's floor plus NEAR_DISCOUNT of what he
    has above it, and across units replaced by max(the position's floor, FAR_DISCOUNT x his value)."""
    from_pos, to_pos = ENGINE_TO_EA.get(from_pos, from_pos), ENGINE_TO_EA.get(to_pos, to_pos)
    if from_pos == to_pos:
        return {k: int(v) for k, v in attrs.items()}
    gf, gt = game_scale.group(from_pos), game_scale.group(to_pos)
    out = {}
    for k, v in attrs.items():
        x = v if gf == gt else game_scale.to_ours(game_scale.to_base(v, gf, k), gt, k)
        fl = POSITION_FLOOR.get(to_pos, 35)
        if k not in ATHLETIC:
            if SKILL_GROUP[from_pos] != SKILL_GROUP[to_pos]:
                if UNIT[from_pos] == UNIT[to_pos]:    # a raw athlete's level there, plus most of what he knows beyond it
                    x = fl + max(0.0, x - fl) * NEAR_DISCOUNT
                else:
                    x = max(fl, FAR_DISCOUNT * x)
        out[k] = int(round(max(1, min(99, x))))
    return out


def project(attrs: dict, height_in: Optional[int], weight_lbs: Optional[int], from_pos: str, to_pos: str) -> int:
    """His overall at `to_pos`: our formula there on his transferred ratings, less what his size
    costs, FLOOR at least. At his own position it is exactly his overall."""
    from_pos, to_pos = ENGINE_TO_EA.get(from_pos, from_pos), ENGINE_TO_EA.get(to_pos, to_pos)
    if from_pos == to_pos:
        return game_scale.overall(attrs, to_pos)
    raw = game_scale.overall(transfer(attrs, from_pos, to_pos), to_pos)
    return int(round(max(FLOOR, raw - size_penalty(height_in, weight_lbs, to_pos))))


def options(attrs: dict, height_in: Optional[int], weight_lbs: Optional[int], origin: str, cur: str, groups: dict) -> list[dict]:
    """The position_options rows: every position on his side of the kicking line, projected from
    his ratings at `origin` (where the league file has him, before this season's change; `cur` is
    where he plays now), where he is now first, then best first."""
    special = cur in ("K", "P")
    out = [{"pos": pos, "group": groups[pos], "overall": project(attrs, height_in, weight_lbs, origin, pos), "current": pos == cur}
           for pos in groups if (pos in ("K", "P")) == special]
    out.sort(key=lambda o: (-o["current"], -o["overall"]))
    return out


def move_row(c: dict, pos: str, attrs: list[str]) -> None:
    """A league roster row moved to `pos`: his ratings become the transferred ones and his overall
    the projection; "moved_from" keeps where he came from and "moved_attrs" his ratings there, so
    moving him back the same season restores both. Once the offseason ends the change is his."""
    cur = c["pos"]
    if cur == pos:
        return
    if pos == c.get("moved_from") and c.get("moved_attrs"):
        c["r"] = list(c.pop("moved_attrs"))
        c.pop("moved_from", None)
        c["pos"] = pos
        c["o"] = game_scale.overall(dict(zip(attrs, c["r"])), pos)
        return
    if not c.get("moved_from"):
        c["moved_from"], c["moved_attrs"] = cur, list(c["r"])
    # a second move the same season starts again from where he began, not from the first move's ratings
    origin, ours = c["moved_from"], dict(zip(attrs, c["moved_attrs"] or c["r"]))
    new = transfer(ours, origin, pos)
    c["r"] = [new.get(k, 50) for k in attrs]
    c["pos"] = pos
    c["o"] = project(ours, c.get("ht"), c.get("wt"), origin, pos)


def season_move(p: dict, origin: str, pos: str) -> tuple[int, list[int]]:
    """An engine player (data/engine_teams.json form) moved to `pos` during the season: his
    overall there and his skills as they transfer (what the card and comps read)."""
    attrs = dict(zip(game_scale.keys(), p.get("skills") or []))
    new = transfer(attrs, origin, pos)
    return project(attrs, p.get("height_in"), p.get("weight"), origin, pos), [new.get(k, 50) for k in game_scale.keys()]


def settle(roster: list[dict]) -> None:
    """At a season's end the changes are his: the snapshots go."""
    for c in roster:
        c.pop("moved_attrs", None)
