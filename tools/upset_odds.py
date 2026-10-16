"""How often does the underdog win? Simulates a few mismatches N times each and prints the
upset rate and typical margin: `python tools/upset_odds.py [n]`."""
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import season  # noqa: E402
from engine.game import simulate_game  # noqa: E402

MATCHUPS = [("niu", "notre-dame"), ("app-st", "michigan"), ("toledo", "alabama"), ("james-madison", "georgia"),
            ("memphis", "ohio-state"), ("boise-state", "oregon"), ("iowa", "ohio-state")]

if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 200
    season._init(str(season.TEAMS_FILE))
    teams = season.load_teams()
    t0 = time.perf_counter()
    for away, home in MATCHUPS:
        wins = 0
        margins = []
        for i in range(n):
            g = simulate_game(season._TEAMS[home], season._TEAMS[away], seed=i)
            margins.append(g["away"]["score"] - g["home"]["score"])
            wins += g["winner"] == "away"
        ovr = lambda s: teams[s]["team_ratings"]["overall"] if "team_ratings" in teams[s] else "?"
        print(f"{teams[away]['name']:<16} ({ovr(away)}) at {teams[home]['name']:<12} ({ovr(home)}): upset {100 * wins / n:4.1f}%  "
              f"median margin {statistics.median(margins):+.0f}, closest {max(margins):+d}, worst {min(margins):+d}")
    print(f"{len(MATCHUPS) * n} games in {time.perf_counter() - t0:.0f}s")
