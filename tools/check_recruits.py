"""Generate fictional classes and hold them to the real numbers they were learned from:
overall by stars as true freshmen and after each offseason (real 2026 roster players matched to
their recruiting record), young players' athleticism by stars, the star counts, the coachability
mix, positions and sizes.

Usage:  python tools/check_recruits.py            # 2 classes
        python tools/check_recruits.py 4          # more classes, steadier numbers
"""
from __future__ import annotations
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `import recruits` works from here

import random
import statistics as st
import sys
from collections import Counter, defaultdict

import recruits

YEARS = 4


def main() -> None:
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 2
    pl = recruits.model()["players"]
    target = pl["targets"]["overall_by_stars_and_years"]
    ath_target = pl["targets"]["young_athletic_by_stars"]
    by = defaultdict(lambda: defaultdict(list))
    ath = defaultdict(lambda: defaultdict(list))
    coach, pos, sizes, stars = Counter(), Counter(), defaultdict(list), Counter()
    for seed in range(n):
        cls = recruits.generate_class(2027, seed)
        rng = random.Random(seed)
        for p in cls:
            s = str(p["stars"])
            stars[s] += 1
            coach[p["coachability"]] += 1
            pos[p["ea_position"]] += 1
            sizes[p["position"]].append((p["height"], p["weight"]))
            for k in ("speed", "acceleration", "agility", "jumping"):
                ath[f"{p['ea_position']}|{k}"][s].append(p["ratings_ea"].get(k, 0))
            by[s][0].append(p["overall"])
            for y in range(1, YEARS + 1):
                recruits.develop(p, rng)
                by[s][y].append(p["overall"])

    print(f"{n} classes: stars per class {({k: v // n for k, v in sorted(stars.items(), reverse=True)})}")
    print("\noverall (source scale) by stars and offseasons: generated / real")
    print("star " + "".join(f"{f'year {y}':>16}" for y in range(YEARS + 1)))
    for s in ("5", "4", "3", "2"):
        cells = []
        for y in range(YEARS + 1):
            g = st.mean(by[s][y]) if by[s][y] else float("nan")
            r = target.get(s, {}).get(str(y))
            cells.append(f"{g:6.1f} / {r[0]:5.1f}" if r else f"{g:6.1f} /   -  ")
        print(f"{s}*   " + "".join(f"{c:>16}" for c in cells))
    print("\nyoung athleticism (EA scale), generated / real, by stars")
    for key in ("WR|speed", "WR|jumping", "CB|agility", "CB|speed", "HB|speed", "LEDG|acceleration"):
        row = []
        for s in ("5", "4", "3", "2"):
            g = ath[key].get(s)
            r = ath_target.get(key, {}).get(s)
            row.append(f"{s}* {st.mean(g):5.1f}/{r[0]:5.1f}" if g and r else f"{s}*      -    ")
        print(f"  {key:<18} " + "  ".join(row))
    print("\ncoachability:", {k: f"{v / sum(coach.values()):.0%}" for k, v in coach.most_common()})
    print("EA positions:", {k: v // n for k, v in pos.most_common()})
    body = recruits.model()["generation"]["body"]
    print("size (in, lb) generated vs real:")
    for k in ("QB", "WR", "CB", "OT", "DL", "EDGE", "LB"):
        hs, ws = zip(*sizes[k])
        print(f"  {k:<5} {st.mean(hs):5.1f} {st.mean(ws):6.1f}  (real {body[k]['height_in'][0]} {body[k]['weight_lb'][0]};"
              f" generated lightest {min(ws)}, real sd {body[k]['weight_lb'][1]})")


if __name__ == "__main__":
    main()
