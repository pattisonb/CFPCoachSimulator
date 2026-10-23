"""Fast roster-dynamics check for the offseason: fake seasons (the better team usually wins),
every school signs its open spots from the class in rank order, then the real offseason runs.
Prints the roster make-up by class and who starts (freshmen and sophomores) after each
offseason against the real 2026 rosters. Usage: python tools/tune_rosters.py [offseasons] [KEY=value ...]
(KEY=value overrides an offseason.py constant for the run, e.g. FIFTH_YEAR=0.7)."""
from __future__ import annotations

import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))
_sys.path.insert(0, str(_Path(__file__).resolve().parents[1] / "tests"))

import ast
import collections
import random
import statistics as st
import sys

REAL = {"FR": .151, "FRRS": .122, "SO": .086, "SORS": .149, "JR": .086, "JRRS": .153, "SR": .069, "SRRS": .185}


def fake_season(s: dict) -> None:
    import recruiting
    import season
    from test_offseason import finished
    rc = s["recruiting"]
    teams = season.load_teams()
    schools = [x for x, t in teams.items() if not t["fictional"]]
    spots = {x: recruiting.open_spots(s, x) for x in schools}
    finished(s)
    for st_ in rc["status"].values():
        st_["signed"] = None
    order = sorted(rc["prospects"], key=lambda p: rc["prospects"][p]["rank"])
    rng = random.Random(1)
    ranked = sorted(schools, key=lambda x: -teams[x]["team_ratings"]["overall"])
    i = 0
    for pid in order:                     # the best schools pick first, each up to its open spots
        while ranked and spots[ranked[i % len(ranked)]] <= 0:
            ranked.pop(i % len(ranked))
        if not ranked:
            break
        x = ranked[i % len(ranked)] if rng.random() < 0.8 else rng.choice(ranked)
        rc["status"][pid]["signed"] = x
        spots[x] -= 1
        i += 1


def report(label: str) -> None:
    import season
    cls, young, n = collections.Counter(), 0, 0
    sizes = []
    for t in season.load_teams().values():
        if t["fictional"]:
            continue
        players = t["offense"] + t["defense"]
        sizes.append(len(players))
        for p in sorted(players, key=lambda q: -(q.get("ovr") or 0))[:85]:     # EA's rosters: each team's best 85
            cls[p.get("class")] += 1
        for p in players:
            if p.get("in_game"):
                n += 1
                young += (p.get("class") or "")[:2] in ("FR", "SO")
    tot = sum(cls.values())
    print(f"{label}: roster {st.mean(sizes):.0f} young starters {young / n:.2f} (real .28) | best 85: " + " ".join(f"{k} {cls[k] / tot:.3f}/{REAL[k]:.3f}" for k in REAL), flush=True)


def main() -> None:
    import league
    import offseason
    import season
    n = int(sys.argv[1]) if len(sys.argv) > 1 and "=" not in sys.argv[1] else 4
    for arg in sys.argv[1:]:
        if "=" in arg:
            k, v = arg.split("=", 1)
            setattr(offseason, k, ast.literal_eval(v))
    s = season.new_season("ohio-state", "full", seed=5, career=True)
    report("2026")
    for _ in range(n):
        fake_season(s)
        offseason.run_all(s)
        s = offseason.next_season(s)
        report(str(s["year"]))
    league.forget(s["id"])
    season.close_pool()


if __name__ == "__main__":
    main()
