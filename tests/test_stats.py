"""Quick check of season-long stats: sim a few weeks and print team and player leaders.
(Run as a file: multiprocessing on Windows cannot spawn workers from a piped script.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `import season` works from here
import json
import sys
import time

import season

if __name__ == "__main__":
    slug = sys.argv[1] if len(sys.argv) > 1 else "ohio-state"
    weeks = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    t0 = time.perf_counter()
    st = season.new_season(slug, "full", seed=5)
    season.advance_to(st, weeks)
    print(f"{weeks} weeks in {time.perf_counter() - t0:.1f}s; state {len(json.dumps(st)) / 1e6:.2f} MB; teams with stats {len(st['season_stats'])}")
    tv = season.team_stats_view(st)
    print("partial:", tv["partial"])
    for r in tv["teams"][:5]:
        print(f"  {r['name']:<16} {r['wins']}-{r['losses']} ppg {r['ppg']:.1f} opp {r['opp_ppg']:.1f} ypg {r['ypg']:.0f} ypp {r['ypp']:.2f} 3rd {r['third_pct']:.0f}% top {r['top']:.0f}s TO {r['turnovers']} opp ypg {r['opp_ypg']:.0f}")
    for cat in ("passing", "rushing", "receiving", "defense", "kicking", "returns"):
        pv = season.player_stats_view(st, None, cat, 3)
        print(cat, [(p["name"], p["team_name"], p["games"], p["stats"]) for p in pv["players"]])
    mine = season.player_stats_view(st, slug, "passing")
    print("my QBs:", [(p["name"], p["stats"]) for p in mine["players"]])
