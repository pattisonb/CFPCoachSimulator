"""Where the time goes: profile one game in the engine and one week of the season
(`python tools/profile_sim.py [game|week]`). Run as a file: multiprocessing on Windows."""
import cProfile
import os
import pstats
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import season  # noqa: E402
from engine.game import simulate_game  # noqa: E402

if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "game"
    season._init(str(season.TEAMS_FILE))
    if what == "game":
        home, away = season._TEAMS["ohio-state"], season._TEAMS["michigan"]
        t0 = time.perf_counter()
        for i in range(20):
            simulate_game(home, away, seed=i)
        print(f"20 games: {(time.perf_counter() - t0) / 20 * 1000:.1f} ms per game")
        pr = cProfile.Profile()
        pr.enable()
        for i in range(20):
            simulate_game(home, away, seed=100 + i)
        pr.disable()
        pstats.Stats(pr).sort_stats("cumulative").print_stats(28)
        pstats.Stats(pr).sort_stats("tottime").print_stats(22)
    else:
        os.environ["SIM_WORKERS"] = "1"
        st = season.new_season("ohio-state", "full", seed=3)
        season.advance_to(st, 2)
        pr = cProfile.Profile()
        t0 = time.perf_counter()
        pr.enable()
        season.advance(st)
        pr.disable()
        print(f"week 3 in-process: {time.perf_counter() - t0:.2f}s")
        pstats.Stats(pr).sort_stats("cumulative").print_stats(30)
        pstats.Stats(pr).sort_stats("tottime").print_stats(20)
