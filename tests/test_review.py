"""Sim a full season and print the Summary tab's data (national leaders, surprises, your leaders).
(Run as a file: multiprocessing on Windows cannot spawn workers from a piped script.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `from sim import season` works from here
import sys
import time

from sim import season

if __name__ == "__main__":
    slug = sys.argv[1] if len(sys.argv) > 1 else "ohio-state"
    t0 = time.perf_counter()
    st = season.new_season(slug, "full", seed=5)
    season.advance_to(st, 19)
    season.save_season(st)
    r = season.season_review(st)
    print(f"{st['team_name']} season {st['id']} in {time.perf_counter() - t0:.1f}s; champion {r['champion_name']}")
    for k, v in r["national_leaders"].items():
        print(f"  {k:<14} {v['name']} ({v['position']}, {v['team_name']}, {v['games']} g) {{k: x for k, x in v['stats'].items() if x}}")
    print("surprises:", [(x["name"], x["record"], x["preseason_rank"], x["rating_rank"], x["final_rank"], x["swing"]) for x in r["surprises"]])
    print("disappointments:", [(x["name"], x["record"], x["preseason_rank"], x["rating_rank"], x["final_rank"], x["swing"]) for x in r["disappointments"]])
    m = r["mine"]
    print("mine:", m["wins"], m["losses"], m["finish"], {k: (v["name"] if isinstance(v, dict) else v) for k, v in m["leaders"].items()})
