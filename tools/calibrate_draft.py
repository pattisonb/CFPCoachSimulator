"""The draft by position against the real drafts: which positions go in round one and how many of
each go at all. Plays three careers to their first offseason, keeps every draft-eligible player
(position, card overall, class), and fits coach_career.offseason's POSITION_VALUE and
POSITION_SCALE (a position's draft score per overall point) so the sim's drafts match the
targets in data/draft_targets.json (the 2021-2025 NFL drafts' averages, round one and all picks,
by position bucket).

Usage:  python tools/calibrate_draft.py            # measure, fit, print the constants to paste
        python tools/calibrate_draft.py --measure  # the sim's current numbers only
"""
from __future__ import annotations

import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))
_sys.path.insert(0, str(_Path(__file__).resolve().parents[1] / "tests"))

import json
import random
import statistics as st

ROOT = _Path(__file__).resolve().parents[1]
TARGETS = ROOT / "data" / "draft_targets.json"
POOLS = _Path("/tmp/draft_pools.json") if not (ROOT / "data" / "long_run").exists() else ROOT / "data" / "long_run" / "draft_pools.json"
BUCKETS = ("QB", "RB", "WR", "TE", "OT", "IOL", "EDGE", "DL", "LB", "CB", "S", "K", "P")
BUCKET_OF = {"QB": "QB", "HB": "RB", "FB": "RB", "WR": "WR", "TE": "TE", "LT": "OT", "RT": "OT", "LG": "IOL", "RG": "IOL", "C": "IOL",
             "LEDG": "EDGE", "REDG": "EDGE", "DT": "DL", "SAM": "LB", "MIKE": "LB", "WILL": "LB", "CB": "CB", "FS": "S", "SS": "S",
             "K": "K", "P": "P"}
SEEDS = (5, 6, 7)


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
        for rep in range(reps):
            by_id = {p["id"]: p for t in lgd["teams"].values() for p in t["roster"]}
            _, drafted = offseason.draft_board(lgd, random.Random(f"draft-cal-{rep}"))
            n += 1
            for pid, pick in drafted.items():
                b = BUCKET_OF[by_id[pid]["pos"]]
                allp[b] += 1
                if pick <= 32:
                    r1[b] += 1
    return {b: v / n for b, v in r1.items()}, {b: v / n for b, v in allp.items()}


def _anchor(values: list[float], k: float) -> float:
    """The k-th best of `values` (fractional k interpolates); past the end, the last less a point a place."""
    if not values:
        return 0.0
    vs = sorted(values, reverse=True)
    if k <= 1:
        return vs[0] + (1 - k) * 2.0
    if k >= len(vs):
        return vs[-1] - (k - len(vs)) * 1.0
    lo, frac = int(k) - 1, k - int(k)
    return vs[lo] * (1 - frac) + vs[min(lo + 1, len(vs) - 1)] * frac


def fit(leagues: list[dict], targets: dict, rounds: int = 16) -> tuple[dict, dict]:
    """Solve, then refine. For each bucket the T_all-th best card overall (seniors in full,
    underclassmen at the declare rate near pick 257) must score at the last pick's line and the
    T_r1-th best (underclassmen near the top declare rate) at pick 32's, which sets the
    position's scale and bonus; then a few damped corrections on the measured drafts (noise and
    the declarations by projected pick move things a little)."""
    from coach_career import offseason
    pos_of = {b: [p for p, bb in BUCKET_OF.items() if bb == b] for b in BUCKETS}
    LINE_R1, LINE_ALL = 100.0, 60.0
    top_rate, late_rate = 0.9, 0.2
    value, scale = {}, {}
    for b in BUCKETS:
        all_v, r1_v = [], []
        for lgd in leagues:
            for t in lgd["teams"].values():
                for p in t["roster"]:
                    if BUCKET_OF[p["pos"]] != b:
                        continue
                    h = offseason.house(p["pos"], p["o"])
                    senior = p["cls"] in ("SR", "SRRS")
                    all_v.append((h, 1.0 if senior else late_rate))
                    r1_v.append((h, 1.0 if senior else top_rate))
        n = len(leagues)
        # weighted order statistics: expand by weight (a declare rate is a share of a player)
        def kth(weighted, k):
            vs = sorted(weighted, key=lambda x: -x[0])
            acc = 0.0
            for h, w in vs:
                acc += w
                if acc >= k:
                    return h
            return vs[-1][0] - (k - acc) * 1.0 if vs else 0.0
        h_all = kth(all_v, targets["all"][b] * n)
        h_r1 = kth(r1_v, max(0.5, targets["round1"][b]) * n)
        if h_r1 - h_all < 2.0:
            h_r1 = h_all + 2.0
        sc = (LINE_R1 - LINE_ALL) / (h_r1 - h_all)
        sc = max(0.5, min(5.0, sc))
        scale[b] = sc
        value[b] = LINE_ALL - sc * h_all

    def apply() -> None:
        offseason.POSITION_VALUE = {p: round(value[b], 2) for b in BUCKETS for p in pos_of[b]}
        offseason.POSITION_SCALE = {p: round(scale[b], 3) for b in BUCKETS for p in pos_of[b]}

    best, best_err = (dict(value), dict(scale)), float("inf")
    for it in range(rounds):
        apply()
        r1, allp = measure(leagues, reps=5)
        err = sum(abs(targets["all"][b] - allp[b]) + 2 * abs(targets["round1"][b] - r1[b]) for b in BUCKETS)
        if err < best_err:
            best, best_err = (dict(value), dict(scale)), err
        if it % 4 == 0 or it == rounds - 1:
            print(f"  round {it:2d}  error {err:6.1f}")
        step = 1.0 / (1 + it / 4)                                  # smaller corrections as it settles
        for b in BUCKETS:
            gap_all = targets["all"][b] - allp[b]
            gap_r1 = targets["round1"][b] - r1[b]
            value[b] += step * 0.15 * gap_all * scale[b]            # a pick short: a little more score for the whole bucket
            if targets["round1"][b] > 0 or r1[b] > 0:
                scale[b] = max(0.5, min(5.0, scale[b] * (1 + step * 0.012 * gap_r1)))   # round one short: steeper
                value[b] -= 0.0
    value, scale = best
    apply()
    return offseason.POSITION_VALUE, offseason.POSITION_SCALE


def table(r1: dict, allp: dict, targets: dict) -> str:
    rows = ["bucket   R1 sim/real    all sim/real"]
    for b in BUCKETS:
        rows.append(f"{b:6s} {r1[b]:6.1f} / {targets['round1'][b]:4.1f}   {allp[b]:6.1f} / {targets['all'][b]:5.1f}")
    return "\n".join(rows)


def main() -> None:
    targets = json.loads(TARGETS.read_text(encoding="utf-8"))
    leagues = pools()
    r1, allp = measure(leagues)
    print("before:\n" + table(r1, allp, targets))
    if "--measure" in _sys.argv:
        return
    value, scale = fit(leagues, targets)
    r1, allp = measure(leagues)
    print("after:\n" + table(r1, allp, targets))
    print("POSITION_VALUE =", json.dumps(value))
    print("POSITION_SCALE =", json.dumps(scale))


if __name__ == "__main__":
    main()
