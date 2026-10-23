"""Development on our scale against the real rosters: a generated class, converted to our ratings
as a career does it, developed offseason by offseason (offseason.develop at an average coach and
program, offseason.DEV_RATE included), its median overall by stars and years in college next to the real 2026 players' (their
stars from the recruiting record, our overall from game_scale). The real players are the
survivors: the ones who stalled had often left, so they run a little high for three- and two-stars.

Usage:  python tools/check_development.py [classes]
"""
from __future__ import annotations

import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))

import json
import random
import statistics as st
import sys
from collections import defaultdict

from teamdata import game_scale
from coach_career import offseason
from coach_career import recruits

YEARS = {"FR": 0, "FRRS": 1, "SO": 1, "SORS": 2, "JR": 2, "JRRS": 3, "SR": 3, "SRRS": 4}


def real_table() -> dict:
    stars = recruits.model()["players"]["real_stars"]
    out = defaultdict(list)
    for path in sorted((_Path(game_scale.ROOT) / "cfb_sim_data" / "teams").glob("*.json")):
        t = json.loads(path.read_text(encoding="utf-8"))
        if t["fictional"]:
            continue
        for p in t["roster"]:
            s = stars.get(p["slug"])
            if s and p.get("class") in YEARS:
                out[(s, YEARS[p["class"]])].append(game_scale.overall(game_scale.ours_from_base(p["ratings"], p["position"]), p["position"]))
    return out


def generated_table(classes: int, factor: float = 1.0) -> dict:
    out = defaultdict(list)
    keys = game_scale.keys()
    rng = random.Random(5)
    for c in range(classes):
        for r in recruits.generate_class(2027 + c, seed=c):
            p = offseason._newcomer(r, r["id"])
            ours, pot = p["ours"], p["potential_ours"]
            comp = {"pos": r["ea_position"], "a": r["archetype"], "c": r["coachability"],
                    "r": [ours.get(k, 50) for k in keys], "g": [max(0, pot.get(k, 50) - ours.get(k, 50)) for k in keys]}
            comp["o"] = game_scale.overall(ours, comp["pos"])
            for y in range(5):
                out[(r["stars"], y)].append(comp["o"])
                comp["yrs"] = y
                offseason.develop(comp, keys, factor, rng)
    return out


def main() -> None:
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    factor = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0
    real, gen = real_table(), generated_table(n, factor)
    print("our overall by stars and years in college: generated (median) / real (median, n)")
    print("star   " + "".join(f"     year {y}     " for y in range(5)))
    for s in (5, 4, 3, 2):
        cells = []
        for y in range(5):
            g, r = gen.get((s, y), []), real.get((s, y), [])
            cells.append(f"{st.median(g) if g else float('nan'):5.1f} / {st.median(r) if r else float('nan'):5.1f} ({len(r):>3})")
        print(f"{s}*  " + "  ".join(cells))


if __name__ == "__main__":
    main()
