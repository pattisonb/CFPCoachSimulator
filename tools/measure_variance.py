"""The engine's game-to-game spread: simulate a few matchups many times and report the
standard deviation of the margin and the total, against real college football (margins
about 16-17 points around the line). `python tools/measure_variance.py [sims]`."""
import statistics as st
import sys
from multiprocessing import Pool
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sim import season  # noqa: E402

MATCHUPS = [("ohio-state", "michigan"), ("alabama", "auburn"), ("texas", "oklahoma"), ("boise-state", "fresno-state"),
            ("mtsu", "delaware"), ("georgia", "vanderbilt"), ("iowa", "minnesota"), ("ucf", "usf"), ("notre-dame", "usc"), ("akron", "kent-state")]


def one(args):
    from engine.game import simulate_game
    home, away, n = args
    margins, totals = [], []
    for i in range(n):
        r = simulate_game(season._TEAMS[home], season._TEAMS[away], seed=i)
        margins.append(r["home"]["score"] - r["away"]["score"])
        totals.append(r["home"]["score"] + r["away"]["score"])
    return home, away, st.mean(margins), st.pstdev(margins), st.mean(totals), st.pstdev(totals)


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 200
    with Pool(initializer=season._init, initargs=(str(season.TEAMS_FILE),)) as pool:
        rows = pool.map(one, [(h, a, n) for h, a in MATCHUPS])
    print(f"{n} sims per matchup")
    print(f"{'matchup':<32}{'margin':>8}{'sd':>7}{'total':>8}{'sd':>7}")
    for h, a, m, sd, t, tsd in rows:
        print(f"{a + ' at ' + h:<32}{m:>+8.1f}{sd:>7.1f}{t:>8.1f}{tsd:>7.1f}")
    print(f"mean margin sd {st.mean(r[3] for r in rows):.1f} (real college football about 16-17)   mean total sd {st.mean(r[5] for r in rows):.1f}")
