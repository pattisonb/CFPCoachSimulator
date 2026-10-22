"""Play Coach Career seasons and hold their recruiting to the real classes it was learned from
(recruiting_model.json): class sizes by tier, how far from home prospects sign, where the blue
chips go, which programs land the best classes, and when prospects commit, sign and decommit.

Usage:  python tools/check_recruiting.py            # 1 season
        python tools/check_recruiting.py 3          # more seasons, steadier numbers
"""
from __future__ import annotations
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `import season` works from here

import statistics as st
import sys

import recruiting
import season

# (metric, low, high, real) — the tolerances tests/test_recruiting_realism.py holds
TOLERANCES = (
    ("p4_class", 19.5, 24.5, 21.7),
    ("g5_class", 16.5, 21.5, 18.9),
    ("in_state", 0.30, 0.42, 0.36),
    ("median_miles", 220, 340, 280),
    ("blue_chip_schools", 12, 24, 18),
    ("max_five_stars", 0, 6, 6),
    ("strength_rank_r", 0.75, 1.0, 1.0),
    ("committed_by_12", 0.50, 1.0, None),
    ("signed_early", 0.80, 0.90, None),
    ("top300_decommits", 0.08, 0.22, None),
)


def play(seed: int, team: str = "georgia") -> dict:
    state = season.new_season(team, "full", seed=seed, career=True)
    season.advance_to(state, season.FINAL_WEEK)
    return state


def _spearman(a: list[float], b: list[float]) -> float:
    def ranks(v):
        order = sorted(range(len(v)), key=lambda i: v[i])
        r = [0.0] * len(v)
        for k, i in enumerate(order):
            r[i] = k
        return r
    ra, rb = ranks(a), ranks(b)
    ma, mb = st.mean(ra), st.mean(rb)
    num = sum((x - ma) * (y - mb) for x, y in zip(ra, rb))
    return num / (sum((x - ma) ** 2 for x in ra) * sum((y - mb) ** 2 for y in rb)) ** 0.5


def measure(state: dict) -> dict:
    rc = state["recruiting"]
    teams, model = season.load_teams(), recruiting.model()["teams"]
    schools = recruiting.fbs_schools(state)
    classes = {s: recruiting.signed_class(state, s) for s in schools}
    fbs = [(pid, s) for s, pids in classes.items() for pid in pids]
    pros = rc["prospects"]
    tier = lambda t: [len(classes[s]) for s in schools if model[s].get("tier") == t]
    miles = [recruiting._miles(tuple(pros[pid]["home"]), tuple(model[s]["location"])) for pid, s in fbs if model[s].get("location")]
    blue = lambda s: sum(1 for pid in classes[s] if pros[pid]["stars"] >= 4) / max(1, len(classes[s]))
    strength = {s: st.mean(pros[pid]["composite"] for pid in classes[s]) if classes[s] else 0.0 for s in schools}
    first_commit, early, decommitted = {}, set(), set()
    for e in rc["log"]:
        if e["kind"] in ("commit", "flip") and e["pid"] not in first_commit:
            first_commit[e["pid"]] = e["week"]
        if e["kind"] == "signed" and e["school"] != "FCS" and e["week"] == season.SELECTION_WEEK:
            early.add(e["pid"])
        if e["kind"] == "decommit":
            decommitted.add(e["pid"])
    top300 = [pid for pid, p in pros.items() if p["rank"] <= 300]
    return {
        "p4_class": st.mean(tier("Power 4")),
        "g5_class": st.mean(tier("Group of 5")),
        "in_state": sum(1 for pid, s in fbs if pros[pid]["hometown"]["state"] == teams[s]["state"]) / len(fbs),
        "median_miles": st.median(miles),
        "blue_chip_schools": sum(1 for s in schools if classes[s] and blue(s) >= 0.5),
        "max_five_stars": max(sum(1 for pid in classes[s] if pros[pid]["stars"] == 5) for s in schools),
        "strength_rank_r": _spearman([strength[s] for s in schools], [model[s]["strength"]["baseline"] for s in schools]),
        "committed_by_12": sum(1 for pid, _ in fbs if first_commit.get(pid, 99) < 12) / len(fbs),
        "signed_early": len(early) / len(fbs),
        "top300_decommits": sum(1 for pid in top300 if pid in decommitted) / len(top300),
        "fcs_share": sum(1 for s in rc["status"].values() if s["signed"] == "FCS") / len(rc["status"]),
    }


def report(m: dict) -> list[str]:
    """Lines comparing a season with the real numbers; a failing metric is marked."""
    out = []
    for key, lo, hi, real in TOLERANCES:
        ok = lo <= m[key] <= hi
        out.append(f"{'  ' if ok else '! '}{key:18s} {m[key]:8.3f}   want {lo}-{hi}" + (f" (real {real})" if real is not None else ""))
    out.append(f"  {'fcs_share':18s} {m['fcs_share']:8.3f}")
    return out


def main() -> None:
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    for seed in range(1, n + 1):
        print(f"season seed {seed}")
        print("\n".join(report(measure(play(seed)))))


if __name__ == "__main__":
    main()
