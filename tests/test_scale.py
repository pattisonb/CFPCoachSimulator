"""The one rating scale: on every card, the middle Power 4 starter at a position reads 50, for
the overall and for each attribute (the starters being today's, after the real depth charts).
(Run as a file: multiprocessing on Windows.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `from sim import season` works from here
import statistics

from sim import season

if __name__ == "__main__":
    overall, attrs = {}, {}
    for slug, t in season.load_teams().items():
        if t.get("fictional") or not season._is_p4(slug, t):
            continue
        for q in t["offense"] + t["defense"]:
            if not q.get("in_game"):
                continue
            g = season.SCALE_GROUP.get(q["position"], q["position"])
            overall.setdefault(g, []).append(season.shown_overall(q))
            for k, v in (q.get("attributes") or {}).items():
                attrs.setdefault((g, k), []).append(v)
    off = {g: statistics.median(v) for g, v in overall.items() if abs(statistics.median(v) - 50) > 1}
    assert not off, f"the middle Power 4 starter's overall is not 50: {off}"
    off = {f"{g} {k}": statistics.median(v) for (g, k), v in attrs.items() if len(v) >= 20 and abs(statistics.median(v) - 50) > 1.5}
    assert not off, f"the middle Power 4 starter's attribute is not 50: {off}"
    print(f"scale ok: {len(overall)} positions, {sum(len(v) >= 20 for v in attrs.values())} attributes centered on 50")
