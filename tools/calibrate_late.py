"""Late-game realism: compare how simulated games end with how real FBS games ended,
2014-2025 (data/history/linescores.json from fetch_linescores.py).

Measures, per game: points by quarter, share of one-score games, overtime rate, and
comeback rates by the deficit entering the fourth quarter (the trailing team's chance to
win), plus fourth-quarter points by the team trailing or leading at the time.

Usage:  python calibrate_late.py [games=400]
"""
from __future__ import annotations
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `import season` works from here

import json
import random
import statistics as st
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LINES = ROOT / "data" / "history" / "linescores.json"
TEAMS_FILE = ROOT / "data" / "engine_teams.json"
FBS_CONF_IDS = {"1", "4", "5", "8", "9", "151", "12", "15", "17", "37", "18"}


def bucket(d: int) -> str:
    d = abs(d)
    return "tied" if d == 0 else "1-3" if d <= 3 else "4-8" if d <= 8 else "9-16" if d <= 16 else "17+"


def measure(games: list[dict]) -> dict:
    q = [0, 0, 0, 0]
    one_score = ot = 0
    comeback = defaultdict(lambda: [0, 0])
    q4_trailer = []
    q4_leader = []
    totals = []
    for g in games:
        hq, aq = g["home_q"], g["away_q"]
        if len(hq) < 4 or len(aq) < 4:
            continue
        for k in range(4):
            q[k] += hq[k] + aq[k]
        hs, as_ = g["home_score"], g["away_score"]
        totals.append(hs + as_)
        one_score += abs(hs - as_) <= 8
        ot += len(hq) > 4
        d3 = sum(hq[:3]) - sum(aq[:3])
        b = bucket(d3)
        comeback[b][0] += 1
        if d3 != 0:
            trailer_won = (hs > as_) != (d3 > 0)
            comeback[b][1] += trailer_won
            q4_trailer.append(aq[3] if d3 > 0 else hq[3])
            q4_leader.append(hq[3] if d3 > 0 else aq[3])
    n = len(totals)
    tot = sum(q) or 1
    return {"n": n, "quarters": [100 * x / tot for x in q], "one_score": 100 * one_score / n, "ot": 100 * ot / n,
            "comeback": {b: (v[0], 100 * v[1] / max(1, v[0])) for b, v in comeback.items()},
            "q4_trailer": st.mean(q4_trailer), "q4_leader": st.mean(q4_leader), "total": st.mean(totals)}


def real_games() -> list[dict]:
    data = json.loads(LINES.read_text(encoding="utf-8"))
    out = []
    for season, games in data.items():
        for g in games:
            # FBS vs FBS, regular season only
            if str(g["home"].get("conference_id")) not in FBS_CONF_IDS or str(g["away"].get("conference_id")) not in FBS_CONF_IDS:
                continue
            if g.get("type") != 2:
                continue
            out.append({"home_q": g["home"]["q"], "away_q": g["away"]["q"], "home_score": g["home"]["score"], "away_score": g["away"]["score"]})
    return out


def sim_games(n: int) -> list[dict]:
    from engine.game import simulate_game
    teams = json.loads(TEAMS_FILE.read_text(encoding="utf-8"))["teams"]
    fbs = [t for t in teams.values() if not t["fictional"]]
    rng = random.Random(11)
    out = []
    for i in range(n):
        h, a = rng.sample(fbs, 2)
        r = simulate_game(h, a, seed=9000 + i)
        hq = list(r["home"]["quarters"]) + list(r["home"]["overtime"])
        aq = list(r["away"]["quarters"]) + list(r["away"]["overtime"])
        out.append({"home_q": hq, "away_q": aq, "home_score": r["home"]["score"], "away_score": r["away"]["score"]})
    return out


def main() -> None:
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 400
    real = measure(real_games())
    sim = measure(sim_games(n))
    print(f"real: {real['n']} FBS games 2014-2025 regular season; sim: {sim['n']} random matchups")
    print(f"{'measure':<42}{'real':>9}{'sim':>9}")
    for k in range(4):
        print(f"{'points in quarter ' + str(k + 1) + ' (%)':<42}{real['quarters'][k]:>9.1f}{sim['quarters'][k]:>9.1f}")
    print(f"{'combined points':<42}{real['total']:>9.1f}{sim['total']:>9.1f}")
    print(f"{'one-score games, 8 or fewer (%)':<42}{real['one_score']:>9.1f}{sim['one_score']:>9.1f}")
    print(f"{'overtime (%)':<42}{real['ot']:>9.1f}{sim['ot']:>9.1f}")
    print(f"{'4th-quarter points, team trailing after 3':<42}{real['q4_trailer']:>9.2f}{sim['q4_trailer']:>9.2f}")
    print(f"{'4th-quarter points, team leading after 3':<42}{real['q4_leader']:>9.2f}{sim['q4_leader']:>9.2f}")
    print("\ntrailing entering the 4th quarter: share of games the trailer won")
    for b in ("1-3", "4-8", "9-16", "17+"):
        rn, rp = real["comeback"].get(b, (0, 0))
        sn, sp = sim["comeback"].get(b, (0, 0))
        print(f"  down {b:<5} real {rp:5.1f}% (n={rn})   sim {sp:5.1f}% (n={sn})")


if __name__ == "__main__":
    main()
