"""Calibration harness: compare simulated averages with real FBS numbers, and sweep
the talent gap between two teams to see how win rates and margins respond.

Usage:
    python calibrate.py              # 400 games with the rosters as they are
    python calibrate.py 1000         # more games
    python calibrate.py gap          # talent-gap sweep with identical base rosters
    python calibrate.py gap 300      # sweep with 300 games per step
"""
from __future__ import annotations
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `import season` works from here

import copy
import json
import random
import statistics as st
import sys
from collections import Counter
from collections.abc import Iterable, Iterator

from engine.game import simulate_game

ROSTERS = "engine/rosters.json"

SACK_LOSS = 7.5      # yards lost on an average sack (engine/game_config.SACK_YARDS)

# Per-team, per-game FBS averages: the mean across all 137 FBS teams for the 2025 season,
# read from teamrankings.com team stat tables on 2026-10-15, with an acceptable band of
# roughly one tenth either side. Entries marked (est.) had no table and are estimates.
BENCHMARKS = {
    "pts":         (25.9, 23.5, 28.5, "Points"),
    "plays":       (68.7, 64.0, 73.5, "Offensive plays (no penalties)"),
    "tot":         (374.7, 345.0, 405.0, "Total yards"),
    "ypp":         (5.46, 5.1, 5.85, "Yards per play"),
    "att":         (30.8, 27.5, 34.0, "Pass attempts"),
    "cmp_pct":     (61.7, 58.5, 65.0, "Completion %"),
    "ypa":         (7.24, 6.6, 7.9, "Yards per attempt"),
    "pass_yds":    (223.0, 200.0, 248.0, "Pass yards (att x Y/A)"),
    "off_td":      (3.02, 2.6, 3.45, "Offensive TD (pass + rush)"),
    "int_pct":     (2.6, 2.1, 3.2, "INT % of attempts"),
    "sacks_taken": (2.03, 1.6, 2.5, "Sacks taken"),
    "car":         (35.9, 32.0, 40.0, "Carries (incl. scrambles)"),
    "ypc":         (4.23, 3.9, 4.6, "Yards per carry"),
    "rush_yds":    (152.0, 135.0, 170.0, "Rush yards (car x YPC)"),
    "fum":         (1.07, 0.85, 1.3, "Fumbles"),
    "fum_lost":    (0.51, 0.38, 0.65, "Fumbles lost"),
    "turnovers":   (1.32, 1.1, 1.55, "Giveaways (INT + fumbles lost)"),
    "punts":       (4.11, 3.5, 4.7, "Punts"),
    "punt_gross":  (43.0, 41.5, 44.5, "Punt gross average"),
    "punt_net":    (39.5, 38.0, 41.0, "Punt net average"),   # gross less returns, 20 a touchback
    "fga":         (1.59, 1.25, 1.95, "FG attempts"),
    "fg_pct":      (75.4, 69.0, 82.0, "FG %"),
    "penalties":   (6.03, 5.0, 7.1, "Penalties (flags)"),
    "first_downs": (20.0, 18.0, 22.0, "First downs"),
    "third_downs": (13.69, 12.3, 15.1, "Third downs faced"),
    "third_pct":   (39.05, 35.0, 43.0, "Third down conversion %"),
    "rz_trips":    (3.49, 3.0, 4.0, "Red zone trips"),
    "rz_pct":      (82.79, 76.0, 90.0, "Red zone scoring % (TD + FG)"),
    "fourth_att":  (2.1, 1.6, 2.6, "Fourth down attempts"),
    "fourth_pct":  (53.1, 46.0, 60.0, "Fourth down conversion %"),
    "drives":      (12.0, 10.5, 13.5, "Drives (est.)"),
    "tackles":     (66.0, 56.0, 76.0, "Tackles (est.)"),
}

GAME_BENCHMARKS = {
    "total_pts":   (51.7, 47.0, 57.0, "Combined points"),
    "margin_sd":   (15.5, 13.0, 18.0, "Margin std dev (equal teams)"),
    "ot_pct":      (5.0, 2.0, 9.0, "Overtime %"),
}


# Percentage and per-attempt stats are computed from batch totals, not averaged per game.
RATIOS = {
    "ypp": ("tot", "plays", 1), "cmp_pct": ("completions", "att", 100), "ypa": ("pass_yds", "att", 1),
    "int_pct": ("ints", "att", 100), "ypc": ("rush_yds", "car", 1), "punt_gross": ("punt_yds", "punts", 1),
    "punt_net": ("punt_net_yds", "punts", 1),
    "fg_pct": ("fgm", "fga", 100), "third_pct": ("third_conv", "third_downs", 100),
    "rz_pct": ("rz_scores", "rz_trips", 100), "fourth_pct": ("fourth_conv", "fourth_att", 100),
}


def team_line(r: dict, side: str) -> dict:
    t = r[side]
    s = t["team_stats"]
    own = [d for d in r["drives"] if d["offense"] == side and d["quarter"] <= 4]
    plays = sum(d["plays"] for d in own)
    att = s["Pass Attempts"]
    # Official stats (and these benchmarks) count a sack as a rushing play for the yards it
    # lost; the engine keeps sacks apart, so they join the carries here and their loss
    # (engine/game_config.SACK_YARDS, 7.5 on average) comes off rushing and total yards.
    sacked = s["Sacks Taken"]
    car = s["Carries"] + sacked
    rush = s["Rush Yards"] - SACK_LOSS * sacked
    ev = t["team_events"]
    lost = ev.get("fumbles_lost", 0)
    return dict(
        pts=t["score"], plays=plays, tot=s["Pass Yards"] + rush,
        ypp=(s["Pass Yards"] + rush) / max(1, plays),
        att=att, cmp_pct=100 * s["Completions"] / max(1, att), ypa=s["Pass Yards"] / max(1, att),
        pass_yds=s["Pass Yards"], off_td=s["Passing Touchdowns"] + s["Rushing Touchdowns"],
        int_pct=100 * s["Interceptions Thrown"] / max(1, att), sacks_taken=s["Sacks Taken"],
        car=car, ypc=rush / max(1, car), rush_yds=rush,
        fum=s["Fumbles"], fum_lost=lost, turnovers=s["Interceptions Thrown"] + lost,
        punts=s["Punts"], punt_gross=s["Punt Yards"] / max(1, s["Punts"]),
        punt_net=s.get("Punt Net Yards", 0) / max(1, s["Punts"]),
        fga=s["Field Goals Attempted"], fg_pct=100 * s["Field Goals Made"] / max(1, s["Field Goals Attempted"]),
        penalties=ev.get("penalties", 0),
        first_downs=ev.get("first_downs", 0),
        third_downs=ev.get("third_downs", 0),
        third_pct=100 * ev.get("third_down_conversions", 0) / max(1, ev.get("third_downs", 0)),
        rz_trips=ev.get("red_zone_trips", 0),
        fourth_att=ev.get("fourth_down_attempts", 0),
        fourth_pct=100 * ev.get("fourth_down_conversions", 0) / max(1, ev.get("fourth_down_attempts", 0)),
        rz_pct=100 * ev.get("red_zone_scores", 0) / max(1, ev.get("red_zone_trips", 0)),
        drives=len(own), tackles=s["Solo Tackles"] + s["Assisted Tackles"],
        completions=s["Completions"], ints=s["Interceptions Thrown"], punt_yds=s["Punt Yards"], punt_net_yds=s.get("Punt Net Yards", 0), fgm=s["Field Goals Made"],
        third_conv=ev.get("third_down_conversions", 0), rz_scores=ev.get("red_zone_scores", 0),
        fourth_conv=ev.get("fourth_down_conversions", 0),
    )


def summarize(games: Iterable[dict]) -> dict:
    """Batch averages over simulated games (taken one at a time, so a big batch is never
    held in memory): per-team lines with ratio stats from batch totals, win rate, margin
    and total spread, overtime rate and the team points distribution."""
    rows = {"home": [], "away": []}
    margins, totals, ot = [], [], 0
    for r in games:
        if r["overtime_periods"]:
            ot += 1
        margins.append(r["home"]["score"] - r["away"]["score"])
        totals.append(r["home"]["score"] + r["away"]["score"])
        for side in ("home", "away"):
            rows[side].append(team_line(r, side))
    n = len(margins)
    avg = {}
    for side in rows:
        avg[side] = {k: st.mean(x[k] for x in rows[side]) for k in BENCHMARKS}
        for k, (num, den, scale) in RATIOS.items():
            total_den = sum(x[den] for x in rows[side])
            avg[side][k] = scale * sum(x[num] for x in rows[side]) / max(1, total_den)
    both = {k: (avg["home"][k] + avg["away"][k]) / 2 for k in BENCHMARKS}
    return {
        "n": n, "avg": avg, "both": both,
        "home_win_pct": 100 * sum(m > 0 for m in margins) / n,
        "margin_mean": st.mean(margins), "margin_sd": st.pstdev(margins),
        "total_mean": st.mean(totals), "total_sd": st.pstdev(totals),
        "ot_pct": 100 * ot / n,
        "pts_dist": Counter(min(x["pts"] // 10 * 10, 60) for s in rows for x in rows[s]),
    }


def run_batch(home: dict, away: dict, n: int, seed: int = 10_000, sliders: dict | None = None) -> dict:
    return summarize(simulate_game(home, away, sliders, seed=seed + i) for i in range(n))


# League mode plays random FBS matchups, so its margins spread with the gap between the
# teams as well: real FBS-vs-FBS margins had a standard deviation of 21.8-22.2 in 2023-2025.
LEAGUE_MARGIN_SD = (22.0, 19.5, 24.5, "Margin std dev (FBS matchups)")


def print_report(res: dict, home_name: str, away_name: str, league: bool = False) -> None:
    n = res["n"]
    print(f"\n{n} games: {home_name} {res['home_win_pct']:.0f}% wins, margin {res['margin_mean']:+.1f} "
          f"(sd {res['margin_sd']:.1f}), total {res['total_mean']:.1f} (sd {res['total_sd']:.1f}), OT {res['ot_pct']:.1f}%")
    game_vals = {"total_pts": res["total_mean"], "margin_sd": res["margin_sd"], "ot_pct": res["ot_pct"]}
    print(f"{'stat':<32}{'sim':>8}{'target':>8}{'band':>14}  ok")
    for k, (target, lo, hi, label) in {**GAME_BENCHMARKS, **({"margin_sd": LEAGUE_MARGIN_SD} if league else {})}.items():
        v = game_vals[k]
        print(f"{label:<32}{v:>8.1f}{target:>8.1f}{f'{lo}-{hi}':>14}  {'ok' if lo <= v <= hi else 'OUT'}")
    print(f"\n{'stat (per team per game)':<32}{'home':>8}{'away':>8}{'target':>8}{'band':>14}  ok")
    bad = 0
    for k, (target, lo, hi, label) in BENCHMARKS.items():
        h, a = res["avg"]["home"][k], res["avg"]["away"][k]
        ok = lo <= res["both"][k] <= hi
        if not ok:
            bad += 1
        print(f"{label:<32}{h:>8.1f}{a:>8.1f}{target:>8.1f}{f'{lo}-{hi}':>14}  {'ok' if ok else 'OUT'}")
    total = sum(res["pts_dist"].values())
    dist = " ".join(f"{k}s:{100 * v / total:.0f}%" for k, v in sorted(res["pts_dist"].items()))
    print(f"\nteam points distribution: {dist}")
    print(f"benchmarks outside band: {bad} of {len(BENCHMARKS)}")


NUMERIC = {"speed", "strength", "intelligence", "endurance", "passing", "decision_making", "elusiveness",
           "vision", "hands", "route_running", "run_blocking", "pass_blocking", "rushing", "tackling",
           "coverage", "kick_power", "kick_accuracy", "punt_power", "punt_accuracy"}


def shifted(team: dict, delta: float, name: str) -> dict:
    """Copy of a roster with every rating moved by `delta` (clamped 1..99)."""
    t = copy.deepcopy(team)
    t["team_name"] = name
    for unit in ("offense", "defense"):
        for p in t[unit]:
            for k in NUMERIC:
                if isinstance(p.get(k), (int, float)):
                    p[k] = int(max(1, min(99, round(p[k] + delta))))
    return t


def gap_sweep(base: dict, n: int) -> None:
    """Home is the base roster; away is the same roster shifted by each delta."""
    print(f"\nTalent gap sweep, {n} games per step (home = base roster, away = base shifted by delta)")
    print(f"{'delta':>6}{'home win%':>11}{'margin':>9}{'sd':>7}{'home pts':>10}{'away pts':>10}{'home yds':>10}{'away yds':>10}{'OT%':>6}")
    for delta in (-20, -15, -10, -5, 0, 5, 10, 15, 20):
        home = shifted(base, 0, "Base")
        away = shifted(base, delta, f"Base{delta:+d}")
        res = run_batch(home, away, n, seed=20_000)
        a = res["avg"]
        print(f"{delta:>+6}{res['home_win_pct']:>10.0f}%{res['margin_mean']:>+9.1f}{res['margin_sd']:>7.1f}"
              f"{a['home']['pts']:>10.1f}{a['away']['pts']:>10.1f}{a['home']['tot']:>10.0f}{a['away']['tot']:>10.0f}{res['ot_pct']:>6.1f}")
    print("\nReference (FBS): spread 7 ~ 70% favorite, 14 ~ 84%, 21 ~ 93%, 28 ~ 97%, 35 ~ 99%.")


def absolute_sweep(base: dict, n: int) -> None:
    """Both teams shifted together: does a league of weak or strong teams still look like football?"""
    print(f"\nAbsolute level sweep, {n} games per step (both teams shifted by delta)")
    print(f"{'delta':>6}{'pts':>7}{'yds':>7}{'cmp%':>7}{'ypa':>6}{'ypc':>6}{'sacks':>7}{'TO':>6}{'punts':>7}{'fga':>6}")
    for delta in (-15, -8, 0, 8, 15):
        home = shifted(base, delta, "Base")
        away = shifted(base, delta, "Base2")
        res = run_batch(home, away, n, seed=30_000)
        b = res["both"]
        print(f"{delta:>+6}{b['pts']:>7.1f}{b['tot']:>7.0f}{b['cmp_pct']:>7.1f}{b['ypa']:>6.1f}{b['ypc']:>6.1f}"
              f"{b['sacks_taken']:>7.1f}{b['turnovers']:>6.1f}{b['punts']:>7.1f}{b['fga']:>6.1f}")


def league_report(n: int) -> None:
    """Random FBS matchups from data/engine_teams.json, home venue, benchmark report."""
    with open("data/engine_teams.json", encoding="utf-8") as f:
        teams = json.load(f)["teams"]
    fbs = [t for t in teams.values() if not t["fictional"]]
    rng = random.Random(99)

    def games() -> Iterator[dict]:
        for i in range(n):
            h, a = rng.sample(fbs, 2)
            yield simulate_game(h, a, None, seed=50_000 + i, venue="home")

    print_report(summarize(games()), "random home team", "random away team", league=True)


def main() -> None:
    args = sys.argv[1:]
    if args and args[0] == "league":
        league_report(int(args[1]) if len(args) > 1 else 300)
        return
    with open(ROSTERS, encoding="utf-8") as f:
        data = json.load(f)
    home, away = data["teams"][0], data["teams"][1]
    if args and args[0] == "gap":
        n = int(args[1]) if len(args) > 1 else 200
        gap_sweep(home, n)
        absolute_sweep(home, n)
        return
    n = int(args[0]) if args else 400
    res = run_batch(home, away, n)
    print_report(res, home["team_name"], away["team_name"])
    # equal-team check: the base roster against itself
    mirror = run_batch(shifted(home, 0, "Base"), shifted(home, 0, "Mirror"), n)
    print(f"\nBase roster vs itself: home {mirror['home_win_pct']:.0f}% wins, margin sd {mirror['margin_sd']:.1f}, "
          f"total {mirror['total_mean']:.1f}, OT {mirror['ot_pct']:.1f}%")


if __name__ == "__main__":
    main()
