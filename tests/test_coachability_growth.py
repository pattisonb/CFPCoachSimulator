"""Coachability moves (offseason.coachability_chances, offseason.coachability_roll): each case
moves a player up one level at its own chance, at most one level a year, never above Coach's
Dream; a struggling starter who lost his job can slip a level; a seed gives the same answers."""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))
import random

from coach_career import offseason as o
from coach_career import recruits

LEVELS = [n for n, _, _ in recruits.COACHABILITY]
N = 6000


def rate(level: str, chances: dict, drop: float = 0.0, seed: int = 7) -> tuple[float, float, set]:
    rng = random.Random(seed)
    up = down = 0
    reasons = set()
    for _ in range(N):
        new, why = o.coachability_roll(level, chances, drop, rng)
        d = LEVELS.index(new) - LEVELS.index(level)
        assert abs(d) <= 1, (level, new)                    # one level a year at most
        up += d < 0
        down += d > 0
        if why:
            reasons.add(why)
    return up / N, down / N, reasons


def near(got: float, want: float, tol: float = 0.02) -> None:
    assert abs(got - want) <= tol, (got, want)


def check_each_case() -> None:
    base = dict(level="Steady Grinder", cls="SO", z=None, rated=50, redshirted=False, benched=False)
    cases = [("breakout", dict(z=1.4), o.COACH_UP_BREAKOUT),
             ("developer", dict(rated=84), o.COACH_UP_DEVELOPER[1][1]),
             ("developer", dict(rated=93), o.COACH_UP_DEVELOPER[0][1]),
             ("maturity", dict(cls="SRRS", z=0.1), o.COACH_UP_MATURITY),
             ("redshirt", dict(cls="SORS", redshirted=True, rated=72), o.COACH_UP_REDSHIRT)]
    for key, extra, want in cases:
        ch, drop = o.coachability_chances(**{**base, **extra})
        assert set(ch) == {key} and not drop, (key, ch, drop)
        up, down, why = rate("Steady Grinder", ch)
        near(up, want)
        assert down == 0 and why == {key}, (key, why)
    near(o.COACH_UP_BREAKOUT, 0.20, 0)
    near(o.COACH_UP_MATURITY, 0.06, 0)
    near(o.COACH_UP_REDSHIRT, 0.10, 0)
    # no case: nobody moves
    ch, drop = o.coachability_chances(**base)
    assert not ch and not drop
    assert rate("Steady Grinder", ch)[:2] == (0.0, 0.0)
    # the conditions' edges
    assert not o.coachability_chances(**{**base, "rated": 79})[0]
    assert not o.coachability_chances(**{**base, "cls": "SR", "z": None})[0]                     # did not play
    assert not o.coachability_chances(**{**base, "level": "Film Junkie", "cls": "SR", "z": 0.0})[0]  # one level from the top
    assert not o.coachability_chances(**{**base, "redshirted": True, "rated": 69})[0]
    print("each case fires at its chance: breakout, developer (80 and 90), maturity, redshirt")


def check_one_level_and_cap() -> None:
    every = {"breakout": 0.9, "developer": 0.9, "maturity": 0.9, "redshirt": 0.9}
    up, down, _ = rate("Slow to Click", every)                 # many cases at once still move one level
    near(up, 1 - 0.1 ** 4, 0.01)
    assert down == 0
    up, down, _ = rate("Coach's Dream", every, drop=0.9)       # the top never moves up
    assert up == 0
    ch, _ = o.coachability_chances("Coach's Dream", "SR", 2.0, 95, True, False)
    assert not ch
    up, down, _ = rate("Set in His Ways", {}, drop=0.9)       # nor the bottom down
    assert down == 0
    print("one level a year at most; Coach's Dream is the cap")


def check_drop() -> None:
    ch, drop = o.coachability_chances("Quick Study", "SO", -1.0, 50, False, True)
    assert not ch and drop == o.COACH_DOWN_BENCHED == 0.05
    up, down, why = rate("Quick Study", ch, drop)
    near(down, 0.05, 0.015)
    assert up == 0 and why == {"benched"}
    assert o.coachability_chances("Quick Study", "SO", -1.0, 50, False, False)[1] == 0     # kept his job
    assert o.coachability_chances("Quick Study", "SO", -0.5, 50, False, True)[1] == 0      # did not struggle
    print("a struggling starter who lost his job slips a level 5% of the time")


def check_seeded() -> None:
    ch = {"breakout": 0.2, "developer": 0.12}
    a = [o.coachability_roll("Quick Study", ch, 0.05, r) for r in [random.Random(3)] for _ in range(500)]
    b = [o.coachability_roll("Quick Study", ch, 0.05, r) for r in [random.Random(3)] for _ in range(500)]
    assert a == b
    # every roll takes the same draws whatever applies, so one player's case never shifts another's roll
    r1, r2 = random.Random(9), random.Random(9)
    o.coachability_roll("Quick Study", {}, 0.0, r1)
    o.coachability_roll("Coach's Dream", ch, 0.05, r2)
    assert r1.random() == r2.random()
    print("deterministic for a seed; a fixed number of draws a player")


def check_reasons() -> None:
    assert o.coachability_note("Film Junkie", "breakout") == "Now a Film Junkie: A Breakout Year"
    assert o.coachability_note("Film Junkie", "developer", "Coach Smith") == "Now a Film Junkie: Coach Smith's Development"
    assert o.coachability_note("Film Junkie", "redshirt") == "Now a Film Junkie: A Redshirt Year Well Spent"
    assert o.coachability_note("Film Junkie", "maturity") == "Now a Film Junkie: Growing Up"
    assert o.coachability_note("Slow to Click", "benched").startswith("Now a Slow to Click: Benched")
    print("Who Improved reasons read right")


if __name__ == "__main__":
    check_each_case()
    check_one_level_and_cap()
    check_drop()
    check_seeded()
    check_reasons()
    print("coachability growth ok")
