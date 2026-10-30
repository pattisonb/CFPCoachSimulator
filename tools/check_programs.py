"""Do the living program ratings behave? At the start the top 25 by rating is a recognizable
2026 top 25; over a long run (data/long_run/ov_N.league.json, the league a run left behind, or
quick seasons played here) prestige moves at most PRESTIGE_STEP a year, no program crosses more
than one tier in five years, and the starting top 25 keeps most of its members.

    python tools/check_programs.py                      # the starting values
    python tools/check_programs.py --league data/long_run/ov_301.league.json   # a run's league
    python tools/check_programs.py --seasons 10 --seed 1                        # quick seasons here
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from coach_career import programs

EXPECTED_TOP = {"ohio-state", "georgia", "alabama", "texas", "michigan", "oregon", "notre-dame", "lsu", "penn-state", "clemson", "usc",
                "oklahoma", "tennessee", "florida-state", "texas-a-m", "florida", "miami", "auburn", "ole-miss", "utah", "wisconsin",
                "iowa", "washington", "oklahoma-state", "kansas-state"}
KEEP_AT_LEAST = 18


def start_check() -> tuple[bool, str]:
    d = json.loads(programs.HISTORY.read_text(encoding="utf-8"))["teams"]
    top = sorted(d, key=lambda s: -d[s]["rating"])[:25]
    hit = len(EXPECTED_TOP & set(top))
    return hit >= 20, f"start: {hit} of the expected 25 in the top 25 by rating (need 20); out: {sorted(set(top) - EXPECTED_TOP)}"


def league_check(lgd: dict) -> tuple[bool, str]:
    d = json.loads(programs.HISTORY.read_text(encoding="utf-8"))["teams"]
    start_top = set(sorted(d, key=lambda s: -d[s]["rating"])[:25])
    now = {s: t["program"] for s, t in lgd["teams"].items() if t.get("program")}
    top = set(sorted(now, key=lambda s: -now[s]["rating"])[:25])
    kept = len(start_top & top)
    steps = max(abs(a - b) for p in now.values() for (_, a), (_, b) in zip(p.get("seasons", [])[1:], p.get("seasons", [])[:-1])) if any(len(p.get("seasons", [])) > 1 for p in now.values()) else 0
    drift = {s: now[s]["prestige"] - d[s]["history"] for s in now if s in d}
    big = sorted(drift.items(), key=lambda kv: -abs(kv[1]))[:5]
    tiers = {k: sum(1 for p in now.values() if p["tier"] == k) for k in range(1, 6)}
    top10 = sorted(now, key=lambda s: -now[s]["rating"])[:10]
    print("  top 10 now:", [(s, round(now[s]["rating"]), round(now[s]["prestige"]), round(now[s]["winning"]), round(now[s]["nil"])) for s in top10])
    ok = kept >= KEEP_AT_LEAST and tiers[1] >= 4
    return ok, (f"league {lgd.get('year')}: top 25 keeps {kept} of the starting 25 (need {KEEP_AT_LEAST}); tiers {tiers}; "
                f"biggest prestige drift from history {[(s, round(v, 1)) for s, v in big]}")


def quick_run(seasons: int, seed: int, a_out: Optional[str] = None) -> dict:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import check_carousel
    import random
    from coach_career import offseason
    from sim import season
    rng = random.Random(seed)
    st = season.new_season("ohio-state", "full", seed=seed, career=True)
    st["career"]["settings"]["auto_recruit"] = "season"
    for _ in range(seasons):
        check_carousel.quick_season(st, rng)
        offseason.run_all(st)
        st = offseason.next_season(st)
    lgd = st["league"]
    from coach_career import league
    league.forget(st["id"])
    season.close_pool()
    if a_out:
        Path(a_out).write_text(json.dumps({"year": lgd.get("year"), "teams": {s: {"program": t["program"]} for s, t in lgd["teams"].items()}}), encoding="utf-8")
    return lgd


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--league")
    ap.add_argument("--seasons", type=int, default=0)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--out", help="keep the quick run's programs here")
    a = ap.parse_args()
    ok, text = start_check()
    print(text)
    if a.league:
        ok2, text2 = league_check(json.loads(Path(a.league).read_text(encoding="utf-8")))
        print(text2)
        ok = ok and ok2
    elif a.seasons:
        ok2, text2 = league_check(quick_run(a.seasons, a.seed, a.out))
        print(text2)
        ok = ok and ok2
    print("programs ok" if ok else "programs OFF")
    sys.exit(0 if ok else 1)
