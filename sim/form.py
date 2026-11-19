"""A rating shift for a whole team: every player's ratings moved by the same number of points. The sim uses it for an
FCS stand-in, which plays as the real FCS school it stands for that week (season.fcs_strength)."""
from __future__ import annotations

ATTRS = ("speed", "strength", "intelligence", "passing", "decision_making", "elusiveness", "vision", "hands",
         "route_running", "run_blocking", "pass_blocking", "rushing", "tackling", "coverage", "kick_power",
         "kick_accuracy", "punt_power", "punt_accuracy", "return_rating")


def _moved(p: dict, keys, shift: float) -> dict:
    """A copy of the player with the ratings in `keys` moved by `shift` (held to 1-99)."""
    q = dict(p)
    for k in keys:
        v = p.get(k)
        if isinstance(v, (int, float)):
            q[k] = max(1, min(99, int(round(v + shift))))
    return q


def with_form(team: dict, shift: float) -> dict:
    """A copy of the team with every player's ratings moved by `shift` rating points
    (nothing when the shift rounds to zero)."""
    if abs(shift) < 0.5:
        return team
    out = {**team}
    for unit in ("offense", "defense"):
        out[unit] = [_moved(p, ATTRS, shift) for p in team[unit]]
    return out
