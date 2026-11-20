"""The scale every rating is shown on (the player's ask): the shape of EA's, where the average player is about a 70.

Nothing is stored on it. The game keeps every rating as it always has (game_scale.py: 50 is the middle Power 4 starter
at the position), the sim reads those, and the rules that cut on a rating (the draft, a gem, how a player grows) cut on
those. A number is put on this scale as it leaves for the page, and a number typed on the page (a god-mode edit) is
taken back off it. So a save from before shows on this scale the moment it loads, and no game's result moves.

- An overall (and a potential, which is an overall he may reach): OVERALL_KNOTS, our overalls spread the way EA's are
  across every FBS player (the same share in the 90s, the 80s, the 70s...). The order of players is ours, untouched.
- A skill (Speed, Catching, Throw Power): the skill itself, not where he stands among his own position. A receiver's
  Throw Power reads low, as it is, where our stored scale grades it against other receivers.
- A card attribute (Hands, Pass Pro: Anchor): what it is built from, on the same footing as a skill.
- A team's overall, offense, defense and special teams: TEAM_KNOTS, each by where the team stands among FBS teams at
  it (the worst in the mid 60s, the middle one a 77, the top handful in the 90s). A unit's stored rating spreads wider
  than an overall's, so each has its own line: the ninth-best offense reads 87, not 91.
- A coach's or a staff member's rating: COACH_KNOTS, the average coach a 70.
"""
from __future__ import annotations

from bisect import bisect_right
from functools import lru_cache

# *tune* (our overall, the overall shown): the 2026 FBS players' overalls at the same share of players as EA's
# (the 0.1st, 1st, 5th, 10th, 25th, 50th, 75th, 90th, 95th, 99th and 99.9th percentiles, and the two ends). Straight
# lines between them. Fit once from data/engine_teams.json against cfb_sim_data's overalls.
OVERALL_KNOTS = ((0, 40), (3, 41), (9, 50), (15, 57), (22, 62), (25, 64), (30, 67), (36, 71), (43, 76), (54, 81),
                 (61, 84), (77, 89), (93, 94), (99, 99))
LOW, HIGH = 1, 99
# *tune* (a team rating of ours, the one shown), a line for each kind: the 2026 FBS teams' lowest, 5th, 25th, 50th, 75th,
# 90th and 97th percentile and highest land on 66, 69, 73, 77, 81, 85, 89 and 93-94 (about four teams at 90 or better)
TEAM_KNOTS = {
    "overall": ((35, 50), (49.8, 66), (50.5, 69), (53.9, 73), (57.8, 77), (63.5, 81), (68.1, 85), (73.4, 89), (75.7, 93), (90, 99)),
    "unit": ((35, 50), (48.5, 66), (50.4, 69), (54.0, 73), (58.7, 77), (64.4, 81), (70.7, 85), (74.8, 89), (79.7, 94), (92, 99)),
    "special_teams": ((25, 50), (39.0, 62), (45.0, 67), (48.5, 72), (53.0, 76), (57.5, 80), (62.5, 84), (68.0, 88), (77.5, 94), (90, 99)),
}
# *tune* (a coach's or staff member's rating, the one shown): the league's coaches run 15 to 99 with the middle at 49
COACH_KNOTS = ((15, 45), (30, 56), (40, 63), (50, 70), (60, 76), (70, 82), (80, 88), (90, 94), (99, 99))


def _line(knots: tuple, x: float) -> float:
    """`x` carried along the straight lines through `knots` (held at the ends)."""
    if x <= knots[0][0]:
        return knots[0][1]
    if x >= knots[-1][0]:
        return knots[-1][1]
    i = bisect_right([k[0] for k in knots], x)
    (x0, y0), (x1, y1) = knots[i - 1], knots[i]
    return y0 + (x - x0) * (y1 - y0) / (x1 - x0)


def overall_exact(ours: float) -> float:
    """An overall (or a potential) on the shown scale, unrounded: for a difference of two (a gain) or a range's ends."""
    return _line(OVERALL_KNOTS, float(ours))


def overall(ours) -> int:
    """An overall as the page shows it. None stays None (a view that has no overall to show says so itself)."""
    if not isinstance(ours, (int, float)):
        return ours
    return int(round(max(LOW, min(HIGH, overall_exact(ours)))))


def overall_back(shown: float) -> float:
    """The inverse: a shown overall (one typed on the page) on our scale."""
    return _line(tuple((y, x) for x, y in OVERALL_KNOTS), float(shown))


def team(ours, kind: str = "overall") -> int:
    """A team rating as the page shows it: `kind` is "overall", "offense", "defense" or "special_teams"."""
    if not isinstance(ours, (int, float)) or isinstance(ours, bool):
        return ours
    return int(round(_line(TEAM_KNOTS.get(kind) or TEAM_KNOTS["unit"], float(ours))))


def team_ratings(r: dict) -> dict:
    """A team's ratings for the page: its units on the team line, its roster and position-group averages (averages of
    players' overalls) on the players' line."""
    out = dict(r or {})
    for k in ("overall", "offense", "defense", "special_teams"):
        if k in out:
            out[k] = team(out[k], k)
    if "roster_avg" in out:
        out["roster_avg"] = overall(out["roster_avg"])
    if isinstance(out.get("position_groups"), dict):
        out["position_groups"] = {k: overall(v) for k, v in out["position_groups"].items()}
    return out


def coach(ours) -> int:
    """A coach's or staff member's rating as the page shows it. The game's rules keep reading the stored one."""
    if not isinstance(ours, (int, float)) or isinstance(ours, bool):
        return ours
    return int(round(_line(COACH_KNOTS, float(ours))))


def gain(before, after) -> int:
    """A change in overall as the page shows it: the shown overall after less the shown overall before (a point of
    ours is worth more or less of a shown point at different places on the scale)."""
    return overall(after) - overall(before)


@lru_cache(maxsize=1)
def _curve() -> tuple:
    """EA's scale to the source scale the sim's ratings sit on (cfb_sim_data/league.json), as its points."""
    from coach_career import recruits
    return tuple((float(x), float(y)) for x, y in recruits.model()["players"]["curve"])


def from_base(base: float) -> int:
    """A source-scale rating (the sim's own) on the shown scale: back through the source's curve."""
    return int(round(max(LOW, min(HIGH, _line(tuple((y, x) for x, y in _curve()), float(base))))))


def to_base(shown: float) -> float:
    """The inverse: a shown rating on the source scale."""
    return _line(_curve(), float(shown))


def skill(ours, group: str, key: str) -> int:
    """One of a player's stored skills (our scale, at his position group) as the page shows it."""
    from teamdata import game_scale
    if not isinstance(ours, (int, float)):
        return ours
    return from_base(game_scale.to_base(ours, group, key))


def skill_back(shown: float, group: str, key: str) -> int:
    """The inverse: a shown skill as the stored one at his position group."""
    from teamdata import game_scale
    return game_scale.to_ours(to_base(shown), group, key)


def _card(group: str, key: str):
    from teamdata import game_scale
    return game_scale.card_scale().get(f"{'RB' if group == 'FB' else group}|{key}")


def attribute(value, group: str, key: str) -> int:
    """A player card attribute (the card's own scale, at his card group: QB, RB, WR, TE, OL, DL, LB, CB, S, K, P) as the
    page shows it: back to what it is built from, then onto the shown scale. One the card scale does not know (an
    older file) goes by the overall's line, so it still lands on the scale."""
    if not isinstance(value, (int, float)):
        return value
    s = _card(group, key)
    if not s:
        return overall(value)
    m, hi, lo = s
    return from_base(m + (value - 50) / ((hi if value >= 50 else lo) or 1.0))


def attribute_back(shown: float, group: str, key: str) -> int:
    """The inverse: a shown card attribute on the card's own scale."""
    s = _card(group, key)
    if not s:
        return int(round(overall_back(shown)))
    m, hi, lo = s
    raw = to_base(shown)
    return int(round(max(LOW, min(HIGH, 50 + (raw - m) * (hi if raw >= m else lo)))))
