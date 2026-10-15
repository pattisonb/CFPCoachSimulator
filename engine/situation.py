"""Game situation: the college clock rules and what teams do late in a half or a game.

Clock rules (NCAA, 2023 onward): the game clock stops on an incomplete pass, when the ball
carrier goes out of bounds, on a penalty, a score, a change of possession and a timeout.
After a first down or an out-of-bounds play it restarts on the referee's ready-for-play
signal, except inside the last two minutes of either half, where it stays stopped until
the snap. Each team has three timeouts per half. The play clock is 40 seconds.

Behavior by situation:
  hurry      trailing or tied and short on time: snap fast, throw more, get out of bounds,
             use timeouts after in-bounds plays, spike with no timeouts, kick a field goal
             as soon as the clock demands it, throw a Hail Mary with seconds left
  milk       leading in the second half with the game close: run more, stay in bounds,
             snap late in the play clock, kneel when the clock allows it
  run_out    deep in own territory at the end of the first half: run it out
  prevent    the defense of a team leading late: keep the ball in front, keep the carrier
             in bounds, call timeouts to stop the clock when it trails or is tied
  garbage    big lead or deficit: conservative play, starters rest (drive_functions)
"""
from __future__ import annotations

import random

from . import game_config as cfg

TWO_MINUTES = 120


def lead_of(team) -> int:
    return getattr(team, "lead", 0)


def assess(offense, defense, seconds: int, down: int, distance: int, yardline: int, clock_stopped: bool) -> dict:
    """What the offense (and the defense) are trying to do on this snap."""
    lead = lead_of(offense)
    half = getattr(offense, "half", 1)
    overtime = getattr(offense, "in_overtime", False)
    off_timeouts = getattr(offense, "timeouts", 3)
    def_timeouts = getattr(defense, "timeouts", 3)
    s = {"mode": "normal", "pass_shift": 0.0, "oob_want": cfg.OOB_BASE, "big_play_mult": 1.0, "prevent": False,
         "kneel": False, "fg_now": False, "hail_mary": False, "spike": False, "use_timeout": False,
         "def_timeout": False, "run_out": False, "snap_fast": False, "snap_late": False}
    if overtime:
        return s

    # --- End of the first half -------------------------------------------------
    if half == 1:
        if seconds <= cfg.H1_RUN_OUT_SECONDS and yardline < cfg.H1_RUN_OUT_YARDLINE and lead >= -cfg.H1_RUN_OUT_MAX_DEFICIT:
            s.update(mode="run_out", run_out=True, pass_shift=0.6, oob_want=0.02, snap_late=True)
            return s
        if seconds <= cfg.H1_HURRY_SECONDS and yardline >= cfg.H1_RUN_OUT_YARDLINE:
            s.update(mode="hurry", snap_fast=True, pass_shift=-cfg.HURRY_PASS_SHIFT, oob_want=cfg.OOB_HURRY)
        _end_of_half_kicks(s, seconds, yardline, down, clock_stopped, off_timeouts, lead, half)
        return s

    # --- Second half --------------------------------------------------------------
    close = abs(lead) <= cfg.CLOSE_GAME
    fourth_quarter = seconds <= cfg.QUARTER_SECONDS
    if lead > 0 and fourth_quarter:
        # How hard the leader runs clock grows with the lead and as time runs down.
        if seconds <= cfg.MILK_SECONDS or lead >= 17 or (lead >= 9 and seconds <= cfg.MILK_LIGHT_SECONDS):
            s.update(mode="milk", snap_late=True, pass_shift=cfg.MILK_RUN_SHIFT, oob_want=cfg.OOB_STAY_IN, big_play_mult=cfg.MILK_BIG_PLAY)
            if close and seconds <= kneel_window(down, def_timeouts):
                s["kneel"] = True
            elif lead > cfg.CLOSE_GAME and seconds <= kneel_window(down, def_timeouts):
                s["kneel"] = True
            return s
        if lead >= 9:
            s.update(mode="milk", snap_late=True, pass_shift=cfg.MILK_RUN_SHIFT * 0.5, oob_want=cfg.OOB_STAY_IN)
            return s
    if lead <= 0 and (seconds <= cfg.HURRY_SECONDS_TRAILING or (lead < 0 and -lead >= cfg.COMEBACK_LEAD and seconds <= cfg.QUARTER_SECONDS)):
        deficit = -lead
        s.update(mode="hurry", snap_fast=True, pass_shift=-cfg.HURRY_PASS_SHIFT, oob_want=cfg.OOB_HURRY)
        if deficit > cfg.CLOSE_GAME:
            s["mode"] = "desperate"
        _end_of_half_kicks(s, seconds, yardline, down, clock_stopped, off_timeouts, lead, half)
        return s
    return s


def defense_posture(offense, defense, seconds: int) -> dict:
    """Prevent defense and defensive timeouts (second half, close game)."""
    lead = lead_of(defense)     # the defense's own lead
    half = getattr(defense, "half", 1)
    overtime = getattr(defense, "in_overtime", False)
    out = {"prevent": False, "def_timeout": False, "keep_in_bounds": False}
    if overtime or half != 2:
        if half == 1 and lead <= 0 and seconds <= cfg.H1_DEF_TIMEOUT_SECONDS:
            out["def_timeout"] = True
        return out
    if lead > 0 and lead <= cfg.CLOSE_GAME and seconds <= cfg.PREVENT_SECONDS:
        out.update(prevent=True, keep_in_bounds=True)
    if lead <= 0 and seconds <= cfg.DEF_TIMEOUT_SECONDS:
        out["def_timeout"] = True
    return out


def kneel_window(down: int, def_timeouts: int) -> int:
    """Seconds the leader can burn by kneeling from this down, given the defense's timeouts."""
    kneels = max(0, 4 - down)     # downs left that end the game before 4th-down trouble
    runoffs = max(0, kneels - def_timeouts)
    return kneels * cfg.KNEEL_PLAY_SECONDS + runoffs * cfg.KNEEL_RUNOFF


def _end_of_half_kicks(s: dict, seconds: int, yardline: int, down: int, clock_stopped: bool, timeouts: int, lead: int, half: int) -> None:
    """Field goal now, spike, or Hail Mary when the clock leaves no other choice."""
    fg_distance = (100 - yardline) + 17
    in_range = fg_distance <= cfg.FG_CLUTCH_MAX_DISTANCE
    needs_points = half == 1 or lead <= 0
    time_for_one_play = seconds <= cfg.FG_NOW_SECONDS if clock_stopped else seconds <= cfg.FG_NOW_SECONDS + cfg.PLAY_SECONDS_SNAP
    if in_range and needs_points and time_for_one_play and (half == 1 or lead >= -3):
        s["fg_now"] = True
        return
    if needs_points and not in_range and seconds <= cfg.HAIL_MARY_SECONDS and yardline >= cfg.HAIL_MARY_MIN_YARDLINE:
        s["hail_mary"] = True
        return
    if not clock_stopped and seconds <= cfg.SPIKE_SECONDS and timeouts == 0 and down < 4:
        s["spike"] = True
    elif not clock_stopped and seconds <= TWO_MINUTES and timeouts > 0:
        s["use_timeout"] = True


def play_clock(result: str, oob: bool, first_down: bool, seconds: int, situation: dict, posture: dict,
               offense, defense, pace_mult: float) -> tuple[int, bool]:
    """Seconds the play takes off the clock and whether the clock is stopped until the next snap.

    pace_mult scales the between-play runoff (tempo, game speed, garbage time)."""
    stops_until_snap = result in ("incomplete", "offensive penalty", "defensive penalty", "fumble", "interception",
                                  "defensive_touchdown", "spike")
    last_two = seconds <= TWO_MINUTES
    if (oob or first_down) and last_two:
        stops_until_snap = True
    play_seconds = random.randint(*cfg.PLAY_SECONDS_SNAP_RANGE)
    if result in ("incomplete", "spike"):
        play_seconds = random.randint(*cfg.INCOMPLETE_SECONDS)
    if stops_until_snap:
        return play_seconds, True
    # Clock keeps running (or restarts on the ready-for-play signal): who controls the runoff?
    if situation.get("snap_fast"):
        lo, hi = cfg.RUNOFF_HURRY
    elif situation.get("snap_late"):
        lo, hi = cfg.RUNOFF_MILK
    else:
        lo, hi = cfg.RUNOFF_NORMAL
    runoff = random.randint(lo, hi) * pace_mult
    if oob or first_down:
        runoff *= cfg.READY_FOR_PLAY_FRACTION   # restarted on the signal, so part of the gap passes stopped
    # Timeouts: the offense saves clock in a hurry, the trailing defense saves clock against a milking offense.
    if situation.get("use_timeout") and getattr(offense, "timeouts", 0) > 0 and seconds - play_seconds > 0:
        offense.timeouts -= 1
        offense.team_stats["timeouts_used"] = offense.team_stats.get("timeouts_used", 0) + 1
        return play_seconds, True
    if posture.get("def_timeout") and getattr(defense, "timeouts", 0) > 0 and seconds - play_seconds > 0 and seconds - play_seconds <= cfg.DEF_TIMEOUT_SECONDS:
        defense.timeouts -= 1
        defense.team_stats["timeouts_used"] = defense.team_stats.get("timeouts_used", 0) + 1
        return play_seconds, True
    runoff = min(runoff, max(0, seconds - play_seconds))
    return play_seconds + int(runoff), False


def out_of_bounds(result: str, situation: dict, posture: dict) -> bool:
    """Did the ball carrier end the play out of bounds?"""
    if result not in ("run", "successful_pass", "checkdown_pass"):
        return False
    p = situation.get("oob_want", cfg.OOB_BASE)
    if posture.get("keep_in_bounds"):
        p *= cfg.OOB_DEFENSE_KEEPS_IN
    return random.random() < p


def wants_onside(kicking_lead: int, seconds: int, half: int, overtime: bool) -> bool:
    if overtime or half != 2 or kicking_lead >= 0:
        return False
    deficit = -kicking_lead
    if deficit <= 8:
        return seconds <= cfg.ONSIDE_ONE_SCORE_SECONDS
    if deficit <= 16:
        return seconds <= cfg.ONSIDE_TWO_SCORE_SECONDS
    return seconds <= cfg.ONSIDE_TWO_SCORE_SECONDS and deficit <= 24


def go_for_two(lead_after_six: int, seconds: int, half: int, overtime: bool) -> bool:
    """The standard chart, used in the fourth quarter (and late third)."""
    if overtime or half != 2 or seconds > cfg.TWO_POINT_CHART_SECONDS:
        return False
    if lead_after_six < 0:
        return -lead_after_six in cfg.TWO_POINT_TRAILING
    return lead_after_six in cfg.TWO_POINT_LEADING
