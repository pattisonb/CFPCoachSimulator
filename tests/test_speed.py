"""Time a season advance: `python test_speed.py [weeks]`. Set SIM_WORKERS=1 to time the
in-process path used on Render. (Run as a file: multiprocessing on Windows cannot spawn
workers from a piped script.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `from sim import season` works from here
import sys
import time

from sim import season

if __name__ == "__main__":
    weeks = int(sys.argv[1]) if len(sys.argv) > 1 else 2
    t0 = time.perf_counter()
    st = season.new_season("ohio-state", "full", seed=9)
    t1 = time.perf_counter()
    season.advance_to(st, weeks)
    t2 = time.perf_counter()
    games = sum(1 for g in st["games"].values() if g["played"] and not g["real"])
    print(f"workers {season.sim_workers()}: new_season {t1 - t0:.2f}s, {weeks} weeks ({games} games) in {t2 - t1:.2f}s = {(t2 - t1) / weeks:.2f}s per week")
