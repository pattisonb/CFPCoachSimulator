"""The draft by position against the real drafts: which positions go in round one and how many of
each go at all. Plays three careers to their first offseason, keeps every draft-eligible player
(position, card overall, class), and fits coach_career.offseason's DRAFT_VALUE and DRAFT_SHIFT (a
position group's draft score per standard deviation of grade, and its step up or down the board)
so the sim's drafts match the targets in data/draft_targets.json (the 2021-2025 NFL drafts'
averages, round one and all picks, by position bucket).

A grade is a player's card overall against this year's draft-eligible players at his position
(offseason.draft_grades), so the fit holds when a career's overalls drift: pass later seasons'
pools with --extra (a JSON list of {"teams": {slug: {"roster": [{id, pos, o, cls}]}}}) to fit
over them too.

Usage:  python tools/calibrate_draft.py                      # measure, fit, print the constants to paste
        python tools/calibrate_draft.py --measure            # the sim's current numbers only
        python tools/calibrate_draft.py --extra pools.json   # ... with more leagues' pools
"""
from __future__ import annotations

import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))
_sys.path.insert(0, str(_Path(__file__).resolve().parents[1] / "tests"))

import json
import random

ROOT = _Path(__file__).resolve().parents[1]
TARGETS = ROOT / "data" / "draft_targets.json"
POOLS = _Path("/tmp/draft_pools.json") if not (ROOT / "data" / "long_run").exists() else ROOT / "data" / "long_run" / "draft_pools.json"
BUCKETS = ("QB", "RB", "WR", "TE", "OT", "IOL", "EDGE", "DL", "LB", "CB", "S", "K", "P")
SEEDS = (5, 6, 7)
SPECIALIST_VALUE = 0.5          # kickers and punters: a flat value per standard deviation (the real drafts take two of each, late)


def bucket_of(pos: str) -> str:
    from coach_career import offseason
    return offseason.DRAFT_GROUP[pos]


def pools() -> list[dict]:
    """Three first-offseason leagues' draft-eligible players, kept on disk for refits."""
    if POOLS.exists():
        return json.loads(POOLS.read_text(encoding="utf-8"))
    from sim import season
    from coach_career import offseason
    from test_offseason import finished
    out = []
    for seed in SEEDS:
        state = season.new_season("ohio-state", "full", seed=seed, career=True)
        finished(state)
        year = season.season_year(state) + 1
        lgd = state.get("league") or __import__("coach_career.league", fromlist=["from_base"]).from_base(year)
        out.append({"teams": {slug: {"roster": [{"id": p["id"], "pos": p["pos"], "o": p["o"], "cls": p["cls"]} for p in t["roster"]
                                                 if p["cls"] in ("SR", "SRRS") or p["cls"] in offseason.UNDERCLASS_ELIGIBLE]}
                              for slug, t in lgd["teams"].items()}})
    season.close_pool()
    POOLS.parent.mkdir(parents=True, exist_ok=True)
    POOLS.write_text(json.dumps(out), encoding="utf-8")
    return out


def measure(leagues: list[dict], reps: int = 3) -> tuple[dict, dict]:
    """The sim's drafts over the pools, several noise draws each: picks per draft by bucket, round one and all."""
    from coach_career import offseason
    r1, allp, n = {b: 0.0 for b in BUCKETS}, {b: 0.0 for b in BUCKETS}, 0
    for lgd in leagues:
        by_id = {p["id"]: p for t in lgd["teams"].values() for p in t["roster"]}
        for rep in range(reps):
            _, drafted = offseason.draft_board(lgd, random.Random(f"draft-cal-{rep}"))
            n += 1
            for pid, pick in drafted.items():
                b = bucket_of(by_id[pid]["pos"])
                allp[b] += 1
                if pick <= 32:
                    r1[b] += 1
    return {b: v / n for b, v in r1.items()}, {b: v / n for b, v in allp.items()}


def _kth(weighted: list[tuple[float, float]], k: float) -> float:
    """The k-th best value of (value, weight) pairs (a weight is a share of a player)."""
    vs = sorted(weighted, key=lambda x: -x[0])
    acc = 0.0
    for v, w in vs:
        acc += w
        if acc >= k:
            return v
    return vs[-1][0] - (k - acc) * 0.05 if vs else 0.0


def fit(leagues: list[dict], targets: dict, rounds: int = 20) -> tuple[dict, dict]:
    """Solve, then refine. For each bucket the T_all-th best grade (seniors in full, underclassmen at
    the declare rate near pick 257) must score at the last pick's line and the T_r1-th best
    (underclassmen near the top declare rate) at pick 32's, which sets the group's value and shift;
    then damped corrections on the measured drafts (noise and the declarations move things a little)."""
    from coach_career import offseason
    LINE_R1, LINE_ALL = 1.5, -1.0
    top_rate, late_rate = 0.9, 0.2
    value, shift = {}, {}
    zs: dict[str, list[tuple[float, float, float]]] = {b: [] for b in BUCKETS}
    for lgd in leagues:
        players = [p for t in lgd["teams"].values() for p in t["roster"]
                   if p["cls"] in ("SR", "SRRS") or p["cls"] in offseason.UNDERCLASS_ELIGIBLE]
        grades = offseason.draft_grades(players)
        for p in players:
            b = bucket_of(p["pos"])
            mean, sd = grades[b]
            senior = p["cls"] in ("SR", "SRRS")
            zs[b].append(((offseason.house(p["pos"], p["o"]) - mean) / sd, 1.0 if senior else late_rate, 1.0 if senior else top_rate))
    n = len(leagues)
    z_all: dict[str, float] = {}
    for b in BUCKETS:
        z_all[b] = _kth([(z, w) for z, w, _ in zs[b]], targets["all"][b] * n)
        if targets["round1"][b] < 0.5:                  # specialists: a flat value, only their step fitted (never a first-rounder)
            value[b] = SPECIALIST_VALUE
        else:
            z_r1 = max(z_all[b] + 0.3, _kth([(z, w) for z, _, w in zs[b]], targets["round1"][b] * n))
            value[b] = max(0.2, min(3.0, (LINE_R1 - LINE_ALL) / (z_r1 - z_all[b])))
        shift[b] = LINE_ALL - value[b] * z_all[b]

    def apply() -> None:
        offseason.DRAFT_VALUE = {b: round(value[b], 3) for b in BUCKETS}
        offseason.DRAFT_SHIFT = {b: round(shift[b], 3) for b in BUCKETS}

    best, best_err = (dict(value), dict(shift)), float("inf")
    for it in range(rounds):
        apply()
        r1, allp = measure(leagues, reps=3)
        err = sum(abs(targets["all"][b] - allp[b]) + 2 * abs(targets["round1"][b] - r1[b]) for b in BUCKETS)
        if err < best_err:
            best, best_err = (dict(value), dict(shift)), err
        if it % 4 == 0 or it == rounds - 1:
            print(f"  round {it:2d}  error {err:6.1f}")
        step = 1.0 / (1 + it / 4)                                  # smaller corrections as it settles
        for b in BUCKETS:
            gap_all = targets["all"][b] - allp[b]
            gap_r1 = targets["round1"][b] - r1[b]
            shift[b] += step * 0.012 * gap_all                     # a pick short: a little more score for the whole group
            if targets["round1"][b] >= 0.5:
                old = value[b]
                value[b] = max(0.2, min(3.0, value[b] * (1 + step * 0.04 * gap_r1)))   # round one short: steeper
                shift[b] -= (value[b] - old) * z_all[b]             # ... about the last pick's grade, so the draft's total holds
    value, shift = best
    apply()
    return offseason.DRAFT_VALUE, offseason.DRAFT_SHIFT


def table(r1: dict, allp: dict, targets: dict) -> str:
    rows = ["bucket   R1 sim/real    all sim/real"]
    for b in BUCKETS:
        rows.append(f"{b:6s} {r1[b]:6.1f} / {targets['round1'][b]:4.1f}   {allp[b]:6.1f} / {targets['all'][b]:5.1f}")
    return "\n".join(rows)


def main() -> None:
    from coach_career import offseason
    targets = json.loads(TARGETS.read_text(encoding="utf-8"))
    k = offseason.DRAFT_PICKS * offseason.DRAFT_FROM_FBS / targets.get("picks_a_draft", 257)   # the sim's FBS picks a draft
    targets = {"round1": targets["round1"], "all": {b: v * k for b, v in targets["all"].items()}}
    leagues = pools()
    if "--extra" in _sys.argv:
        leagues += json.loads(_Path(_sys.argv[_sys.argv.index("--extra") + 1]).read_text(encoding="utf-8"))
    r1, allp = measure(leagues)
    print("before:\n" + table(r1, allp, targets))
    if "--measure" in _sys.argv:
        return
    value, shift = fit(leagues, targets)
    r1, allp = measure(leagues)
    print("after:\n" + table(r1, allp, targets))
    print("DRAFT_VALUE =", json.dumps(value))
    print("DRAFT_SHIFT =", json.dumps(shift))


if __name__ == "__main__":
    main()
