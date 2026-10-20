"""Run one full game and return a JSON-ready result.

This replaces the original `start_game.py`, which kept the teams as module globals and
printed everything. The half, overtime, kickoff and scoring logic here follow the
original; the differences are listed in docs/HOW_IT_WORKS.md.
"""
from __future__ import annotations

import copy
import random
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from . import drive_functions
from . import play_functions
from . import situation as sit
from .drive_functions import sim_drive
from . import game_config as cfg
from .game_config import GameSliders, sliders
from .game_functions import (
    apply_baseline_fatigue,
    sim_kickoff,
    sim_pat,
    sim_two_point_conversion,
    summarize_stats,
)
from .roster import Team

HALF_SECONDS = cfg.HALF_SECONDS
QUARTER_MARK = cfg.QUARTER_SECONDS
OT_START_YARDLINE = 75  # the opponent 25-yard line

SLIDER_NAMES = [name for name in vars(GameSliders()) if not name.startswith("_")]


def default_sliders() -> dict[str, int]:
    """Every slider at its default value."""
    fresh = GameSliders()
    return {name: getattr(fresh, name) for name in SLIDER_NAMES}


def apply_sliders(overrides: Optional[dict[str, Any]]) -> dict[str, int]:
    """Set the engine's global sliders from `overrides` (unknown names ignored).

    Returns the full slider set that is now active.
    """
    defaults = default_sliders()
    active = dict(defaults)
    for name, value in (overrides or {}).items():
        if name in defaults:
            try:
                active[name] = int(max(0, min(100, float(value))))
            except (TypeError, ValueError):
                pass
    for name, value in active.items():
        setattr(sliders, name, value)
    return active


class GameSim:
    """One game between two teams built from raw roster dicts."""

    def __init__(self, home_data: dict, away_data: dict, venue: str = "home"):
        home_data = self._copy_roster(home_data)
        away_data = self._copy_roster(away_data)
        self.venue = venue if venue in ("home", "neutral") else "home"
        self.home_advantage = 0.0
        if self.venue == "home":
            stadium = home_data.get("home_field_advantage", 50)
            self.home_advantage = (cfg.HFA_BASE_POINTS + (stadium - 50) / 50 * cfg.HFA_STADIUM_POINTS)
            self.home_advantage *= sliders.get_multiplier(sliders.home_field_advantage)
            self._shift_ratings(home_data, self.home_advantage / 2)
            self._shift_ratings(away_data, -self.home_advantage / 2)
        # the day's form: each side a little above or below itself (see cfg.GAME_FORM_SD)
        self.form = {"home": 0.0, "away": 0.0}
        if cfg.GAME_FORM_SD:
            self.form = {"home": random.gauss(0, cfg.GAME_FORM_SD), "away": random.gauss(0, cfg.GAME_FORM_SD)}
            self._shift_ratings(home_data, self.form["home"])
            self._shift_ratings(away_data, self.form["away"])
        self.home = self._make_team(home_data)
        self.away = self._make_team(away_data)
        self.key = {id(self.home): "home", id(self.away): "away"}
        self.score = {"home": 0, "away": 0}
        self.quarter_scores = {"home": [0, 0, 0, 0], "away": [0, 0, 0, 0]}
        self.ot_periods: list[dict] = []
        self.scoring_plays: list[dict] = []
        self.drives: list[dict] = []
        self.half = 1
        self.seconds = HALF_SECONDS
        self.in_overtime = False
        self.ot_number = 0
        self._td_stats_seen = 0

    @staticmethod
    def _copy_roster(data: dict) -> dict:
        """A private copy of what the game mutates: the player dicts (ratings are shifted
        for home field) and, inside Player, each stats dict. Everything else is read-only."""
        return {**data, "offense": [dict(p) for p in data["offense"]], "defense": [dict(p) for p in data["defense"]]}

    @staticmethod
    def _shift_ratings(data: dict, delta: float) -> None:
        """Move every rating by `delta` (home crowd, travel). Applied before the teams are built."""
        for p in data["offense"] + data["defense"]:
            for attr in cfg.HFA_ATTRS:
                if isinstance(p.get(attr), (int, float)):
                    p[attr] = max(1, min(99, p[attr] + delta))

    @staticmethod
    def _make_team(data: dict) -> Team:
        team = Team(data.get("team_name") or data.get("name"), data["offense"], data["defense"],
                    kick_returner=data.get("kick_returner"), punt_returner=data.get("punt_returner"))
        team.tendencies = data.get("tendencies", {})
        team.home_field_advantage = data.get("home_field_advantage", 50)
        coaches = data.get("coaches") or {}
        team.offense_scheme = ((coaches.get("offensive_coordinator") or {}).get("scheme") or {}).get("offensive_scheme") \
            or ((coaches.get("head_coach") or {}).get("scheme") or {}).get("offensive_philosophy") or "Multiple"
        team.defense_scheme = ((coaches.get("defensive_coordinator") or {}).get("scheme") or {}).get("defensive_scheme") \
            or ((coaches.get("head_coach") or {}).get("scheme") or {}).get("defensive_philosophy") or "4-2-5"
        if team.offense_scheme == "Flexbone Triple Option":
            team.tendencies = {**team.tendencies, "fb_carry_weight": cfg.FLEXBONE_FB_CARRY_WEIGHT}
        return team

    # ----- helpers -------------------------------------------------------

    def side(self, team: Team) -> str:
        return self.key[id(team)]

    def other(self, team: Team) -> Team:
        return self.away if team is self.home else self.home

    def quarter(self) -> int:
        if self.in_overtime:
            return 4 + self.ot_number
        return (self.half - 1) * 2 + (1 if self.seconds > QUARTER_MARK else 2)

    def clock(self) -> str:
        if self.in_overtime:
            return f"OT{self.ot_number}"
        secs = self.seconds - QUARTER_MARK if self.seconds > QUARTER_MARK else self.seconds
        secs = max(0, secs)
        return f"{secs // 60}:{secs % 60:02d}"

    def _add_points(self, team: Team, points: int) -> None:
        side = self.side(team)
        self.score[side] += points
        if self.in_overtime:
            self.ot_periods[-1][side] += points
        else:
            self.quarter_scores[side][self.quarter() - 1] += points

    def _record(self, team: Team, kind: str, points: int, description: str) -> dict:
        entry = {
            "quarter": self.quarter(),
            "clock": self.clock(),
            "team": self.side(team),
            "team_name": team.name,
            "kind": kind,
            "points": points,
            "description": description,
            "home_score": 0,
            "away_score": 0,
        }
        self.scoring_plays.append(entry)
        return entry

    def _finish_record(self, entry: dict) -> None:
        entry["home_score"] = self.score["home"]
        entry["away_score"] = self.score["away"]

    def _td_scorer(self) -> str:
        """Describe the player(s) credited with the most recent touchdown."""
        entries = play_functions.debug_td_stats[self._td_stats_seen:]
        self._td_stats_seen = len(play_functions.debug_td_stats)
        if not entries:
            return ""
        td = entries[-1]
        kind = td.get("type", "")
        if kind.startswith("passing"):
            return f"{td.get('qb')} pass to {td.get('receiver')} ({td.get('receiver_position')})"
        if kind == "rushing_scramble":
            return f"{td.get('player')} ({td.get('position')}) scramble"
        if kind == "rushing":
            return f"{td.get('player')} ({td.get('position')}) run"
        if kind == "defensive_interception":
            return f"{td.get('player')} ({td.get('position')}) interception return"
        if kind == "defensive_fumble":
            return f"{td.get('player')} ({td.get('position')}) fumble return"
        return f"{td.get('player', '')} ({td.get('position', '')})"

    # ----- scoring -------------------------------------------------------

    def _touchdown(self, team: Team, kind: str, description: str) -> None:
        """Six points plus the try (PAT, or a two-point attempt from the 2nd OT on)."""
        entry = self._record(team, kind, 6, description)
        self._add_points(team, 6)
        lead_after_six = self.score[self.side(team)] - self.score[self.side(self.other(team))]
        chart = sit.go_for_two(lead_after_six, self.seconds, self.half, self.in_overtime)
        if (self.in_overtime and self.ot_number >= 2) or chart:
            good = sim_two_point_conversion(team.get_offense(), self.other(team).get_defense(), False, team.name)
            if good:
                self._add_points(team, 2)
                entry["points"] = 8
            entry["try"] = "two-point good" if good else "two-point failed"
        else:
            good = sim_pat(team.get_kicker())
            if good:
                self._add_points(team, 1)
                entry["points"] = 7
            entry["try"] = "PAT good" if good else "PAT missed"
        self._finish_record(entry)

    def _field_goal(self, team: Team, yardline: int) -> None:
        distance = (100 - yardline) + 17
        entry = self._record(team, "field_goal", 3, f"{distance} yard field goal")
        self._add_points(team, 3)
        self._finish_record(entry)

    def _safety(self, team: Team) -> None:
        team.team_stats["safeties"] = team.team_stats.get("safeties", 0) + 1
        entry = self._record(team, "safety", 2, "Safety")
        self._add_points(team, 2)
        self._finish_record(entry)

    def _kickoff(self, kicking: Team) -> tuple[Team, int]:
        """Kick off; keep kicking while returns go for touchdowns.

        Returns (team now on offense, its starting yardline).
        """
        receiving = self.other(kicking)
        self._log_mark = len(drive_functions.play_log)
        kicking_lead = self.score[self.side(kicking)] - self.score[self.side(receiving)]
        if sit.wants_onside(kicking_lead, self.seconds, self.half, self.in_overtime):
            self.seconds -= random.randint(3, 6)
            kicking.team_stats["onside_kicks"] = kicking.team_stats.get("onside_kicks", 0) + 1
            if random.random() < cfg.ONSIDE_RECOVERY:
                kicking.team_stats["onside_recoveries"] = kicking.team_stats.get("onside_recoveries", 0) + 1
                spot = random.randint(44, 49)
                play_functions.last_play.clear()
                drive_functions._log(type="kickoff", result="onside_recovered", kicking=kicking.name, to=spot, left=self.seconds)
                return kicking, spot      # the kicking team keeps it near midfield
            spot = random.randint(50, 56)
            play_functions.last_play.clear()
            drive_functions._log(type="kickoff", result="onside_failed", kicking=kicking.name, to=spot, left=self.seconds)
            return receiving, spot        # the receiving team takes over in plus territory
        while True:
            yardline, returner, _return_yards, is_td = sim_kickoff(kicking.get_kicker(), receiving)
            self.seconds -= random.randint(4, 12)
            play_functions.last_play.clear()
            drive_functions._log(type="kickoff", result="return_td" if is_td else "kickoff", kicking=kicking.name, to=yardline,
                                 returner=returner.name if returner else None, return_yards=_return_yards, left=self.seconds)
            if not is_td:
                if returner is not None:
                    play_functions.credit_coverage_tackle(kicking)
                return receiving, yardline
            receiving.team_stats["kickoff_return_touchdowns"] += 1
            receiving.swing(0.4)
            kicking.swing(-0.3)
            who = f"{returner.name} ({returner.position})" if returner else "Unknown"
            self._touchdown(receiving, "kickoff_return", f"{who} kickoff return")
            kicking, receiving = receiving, kicking

    # ----- drives --------------------------------------------------------

    def _play_count(self, team: Team) -> int:
        n = 0
        for p in team.offense:
            n += p.stats.get("pass_attempts", 0) + p.stats.get("carries", 0) + p.stats.get("sacks_taken", 0)
        return n

    def _stamp(self, entry: dict) -> dict:
        """Quarter and clock for a log entry, from the seconds left in the half."""
        left = entry.get("left")
        if self.in_overtime or left is None:
            entry["quarter"] = 4 + self.ot_number if self.in_overtime else self.quarter()
            entry["clock"] = f"OT{self.ot_number}" if self.in_overtime else self.clock()
            return entry
        q = (self.half - 1) * 2 + (1 if left > QUARTER_MARK else 2)
        secs = max(0, left - QUARTER_MARK if left > QUARTER_MARK else left)
        entry["quarter"] = q
        entry["clock"] = f"{secs // 60}:{secs % 60:02d}"
        return entry

    def _run_drive(self, offense: Team, start_yardline: int, hurrying: bool, seconds: int):
        defense = self.other(offense)
        plays_before = self._play_count(offense)
        log_from = self._log_mark if getattr(self, "_log_mark", None) is not None else len(drive_functions.play_log)
        self._log_mark = None
        trailing_late = (
            not self.in_overtime and self.half == 2 and seconds <= cfg.TRAILING_LATE_SECONDS
            and self.score[self.side(offense)] < self.score[self.side(defense)]
        )
        lead = self.score[self.side(offense)] - self.score[self.side(defense)]
        for team, team_lead in ((offense, lead), (defense, -lead)):
            team.lead, team.half, team.in_overtime = team_lead, self.half, self.in_overtime
        play_ran, result, yardline, seconds_left = sim_drive(
            offense, defense, 1, 10, start_yardline, seconds, hurrying, verbose=False,
            trailing_late=trailing_late,
        )
        drive = {
            "quarter": self.quarter(),
            "offense": self.side(offense),
            "offense_name": offense.name,
            "start_yardline": start_yardline,
            "end_yardline": min(100, max(0, yardline)),
            "result": result,
            "plays": self._play_count(offense) - plays_before,
            "seconds": max(0, seconds - seconds_left),
            "log": [self._stamp(e) for e in drive_functions.play_log[log_from:]],
        }
        return play_ran, result, yardline, seconds_left, drive

    def _play_half(self, receiving: Team) -> None:
        self.seconds = HALF_SECONDS
        for team in (self.home, self.away):
            team.timeouts = 3
            team.momentum *= cfg.MOMENTUM_HALF
            team.lead, team.half, team.in_overtime = self.score[self.side(team)] - self.score[self.side(self.other(team))], self.half, False
        driving, start_yardline = self._kickoff(self.other(receiving))

        while self.seconds > 0:
            offense, defense = driving, self.other(driving)
            hurrying = False   # pace is decided per snap by engine/situation.py
            play_ran, result, yardline, self.seconds, drive = self._run_drive(
                offense, start_yardline, hurrying, self.seconds
            )
            drive["quarter"] = self.quarter()
            self.drives.append(drive)

            if result == "defensive_touchdown":
                self._touchdown(defense, "defensive", self._td_scorer())
                driving, start_yardline = self._kickoff(defense)
            elif result == "safety":
                self._safety(defense)
                # The team that gave up the safety free-kicks; the defense takes over at its 20.
                driving, start_yardline = defense, 20
            elif result == "punt_return_td":
                returner = defense.get_punt_returner()
                who = f"{returner.name} ({returner.position})" if returner else "Unknown"
                self._touchdown(defense, "punt_return", f"{who} punt return")
                driving, start_yardline = self._kickoff(defense)
            elif result == "touchdown":
                self._touchdown(offense, play_ran or "run", self._td_scorer())
                driving, start_yardline = self._kickoff(offense)
            elif result == "field goal":
                self._field_goal(offense, yardline)
                driving, start_yardline = self._kickoff(offense)
            else:
                # punt, missed kick, turnover, first_down fallback: other team takes over
                driving, start_yardline = defense, max(1, min(99, 100 - yardline))

    # ----- overtime ------------------------------------------------------

    def _ot_possession(self, offense: Team) -> None:
        defense = self.other(offense)
        play_ran, result, yardline, _secs, drive = self._run_drive(offense, OT_START_YARDLINE, False, 9999)
        self.drives.append(drive)
        if result == "touchdown":
            self._touchdown(offense, play_ran or "run", self._td_scorer())
        elif result == "field goal":
            self._field_goal(offense, yardline)
        elif result == "defensive_touchdown":
            self._touchdown(defense, "defensive", self._td_scorer())
        elif result == "safety":
            self._safety(defense)
        elif result == "punt_return_td":
            returner = defense.get_punt_returner()
            who = f"{returner.name} ({returner.position})" if returner else "Unknown"
            self._touchdown(defense, "punt_return", f"{who} punt return")

    def _play_overtime(self) -> None:
        """College rules: alternating possessions from the 25; two-point tries from the
        2nd OT; from the 3rd OT on, alternating two-point attempts only."""
        self.in_overtime = True
        while self.score["home"] == self.score["away"]:
            self.ot_number += 1
            self.ot_periods.append({"period": self.ot_number, "home": 0, "away": 0})
            if self.ot_number >= 3:
                for team in (self.home, self.away):
                    good = sim_two_point_conversion(
                        team.get_offense(), self.other(team).get_defense(), False, team.name
                    )
                    entry = self._record(
                        team, "two_point", 2 if good else 0,
                        "Two-point attempt good" if good else "Two-point attempt failed",
                    )
                    if good:
                        self._add_points(team, 2)
                    self._finish_record(entry)
                continue
            self._ot_possession(self.home)
            self._ot_possession(self.away)

    # ----- result --------------------------------------------------------

    def _players(self, team: Team) -> list[dict]:
        out = []
        for unit, players in (("offense", team.offense), ("defense", team.defense)):
            for p in players:
                stats = {k: v for k, v in p.stats.items() if isinstance(v, (int, float)) and v}
                out.append({
                    "name": p.name,
                    "position": p.position,
                    "unit": unit,
                    "starter": bool(p.in_game) or bool(p.injury),
                    "fatigue": round(p.fatigue, 1),
                    "stats": stats,
                    "injury": p.injury,
                })
        return out

    def _verify(self, team: Team) -> dict:
        """Port of the original scoring check: points implied by stats vs. actual."""
        totals: dict[str, float] = {}
        for p in team.offense + team.defense:
            for stat, value in p.stats.items():
                if isinstance(value, (int, float)):
                    totals[stat] = totals.get(stat, 0) + value
        tds = (
            max(totals.get("passing_touchdowns", 0), totals.get("receiving_touchdowns", 0))
            + totals.get("rushing_touchdowns", 0)
            + team.team_stats.get("kickoff_return_touchdowns", 0)
            + totals.get("punt_return_touchdowns", 0)
            + totals.get("defensive_touchdowns", 0)
        )
        side = self.side(team)
        two_points = sum(
            1 for s in self.scoring_plays
            if s["team"] == side and (
                s.get("try") == "two-point good" or (s["kind"] == "two_point" and s["points"] == 2)
            )
        )
        expected = (
            tds * 6
            + totals.get("pat_made", 0)
            + totals.get("fg_made", 0) * 3
            + team.team_stats.get("safeties", 0) * 2
            + two_points * 2
        )
        actual = self.score[side]
        return {"expected": int(expected), "actual": actual, "ok": int(expected) == actual}

    def _team_result(self, team: Team) -> dict:
        side = self.side(team)
        events = dict(team.team_stats)
        events["fumbles_lost"] = summarize_stats(self.other(team))["Fumble Recoveries"]
        return {
            "name": team.name,
            "score": self.score[side],
            "quarters": self.quarter_scores[side],
            "overtime": [p[side] for p in self.ot_periods],
            "team_stats": summarize_stats(team),
            "team_events": events,
            "players": self._players(team),
            "injuries": list(team.injuries),
            "personnel": dict(team.grouping_snaps),
            "schemes": {"offense": team.offense_scheme, "defense": team.defense_scheme},
            "verification": self._verify(team),
        }

    def run(self) -> dict:
        play_functions.debug_td_stats.clear()
        drive_functions.play_log.clear()
        self._log_mark = None
        self._td_stats_seen = 0
        apply_baseline_fatigue(self.home)
        apply_baseline_fatigue(self.away)
        for team in (self.home, self.away):
            team._active.update(p for p in team.offense + team.defense if p.fatigue)   # they recover from kickoff
        for team in (self.home, self.away):
            for p in team.offense + team.defense:
                if p.in_game:
                    p.stats["games_started"] = p.stats.get("games_started", 0) + 1

        toss_winner = random.choice(["home", "away"])
        if random.random() < 0.8:
            receives_first = toss_winner
        else:
            receives_first = "away" if toss_winner == "home" else "home"
        first = self.home if receives_first == "home" else self.away

        self.half = 1
        self._play_half(first)
        self.half = 2
        self._play_half(self.other(first))
        if self.score["home"] == self.score["away"]:
            self._play_overtime()

        winner = "home" if self.score["home"] > self.score["away"] else "away"
        return {
            "home": self._team_result(self.home),
            "away": self._team_result(self.away),
            "winner": winner,
            "venue": self.venue,
            "home_advantage_points": round(self.home_advantage, 2),
            "form": {k: round(v, 1) for k, v in self.form.items()},
            "received_first": receives_first,
            "overtime_periods": len(self.ot_periods),
            "scoring_plays": self.scoring_plays,
            "drives": self.drives,
        }


def simulate_game(
    home_data: dict,
    away_data: dict,
    slider_overrides: Optional[dict] = None,
    seed: Optional[int] = None,
    venue: str = "home",
    momentum: bool = False,
) -> dict:
    """Simulate one game and return the result dict (see GameSim.run).

    `venue` is "home" (the first team hosts) or "neutral". With `momentum`, big plays
    swing each team's momentum and nudge its ratings play by play."""
    cfg.MOMENTUM = bool(momentum)
    if seed is not None:
        random.seed(seed)
        cfg.stat_rng.seed(seed)
        cfg.injury_rng.seed(seed + 7919)
    else:
        cfg.stat_rng.seed()
        cfg.injury_rng.seed()
    active = apply_sliders(slider_overrides)
    defaults = default_sliders()
    started = time.perf_counter()
    try:
        result = GameSim(home_data, away_data, venue).run()
    finally:
        cfg.MOMENTUM = False
    result.update({
        "id": uuid.uuid4().hex[:12],
        "played_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "duration_ms": round((time.perf_counter() - started) * 1000),
        "seed": seed,
        "sliders": {k: v for k, v in active.items() if v != defaults[k]},
    })
    return result
