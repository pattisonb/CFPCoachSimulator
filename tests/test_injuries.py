"""Sim a few weeks and print the injury list, personnel usage and line rotation.
(Run as a file: multiprocessing on Windows cannot spawn workers from a piped script.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `from sim import season` works from here
import sys
import time

from sim import season

if __name__ == "__main__":
    weeks = int(sys.argv[1]) if len(sys.argv) > 1 else 4
    t0 = time.perf_counter()
    st = season.new_season("ohio-state", "full", seed=7)
    season.advance_to(st, weeks)
    print(f"{weeks} weeks in {time.perf_counter() - t0:.1f}s")
    rep = season.injury_report(st)
    print(f"league injuries now: {len(rep)} players out on {len(st['injuries'])} teams")
    for i in rep[:8]:
        print(f"  {i['team_name']:<16} {i['name']:<22} {i['position']:<4} {i['type']:<18} {i['weeks_left']} wks left (of {i['weeks']}), since wk {i['since_week']}")
    mine = season.injury_report(st, "ohio-state")
    print("my team:", [(i["name"], i["position"], i["weeks_left"]) for i in mine])
    ss = st["season_stats"]["ohio-state"]
    print("personnel:", ss.get("personnel"), ss.get("schemes"))
    ol = sorted(((p["name"], p["position"], p["stats"].get("snaps", 0), p["stats"].get("games_started", 0)) for p in ss["players"].values() if p["position"] in ("OL", "TE", "DL")), key=lambda x: (x[1], -x[2]))
    for row in ol:
        print("  ", row)
    tm = st["season_stats"]["texas-tech"]
    print("texas tech:", tm.get("schemes"), tm.get("personnel"))
