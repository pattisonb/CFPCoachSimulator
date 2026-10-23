"""Quick engine check: run a batch of games and report scores and verification."""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `from sim import season` works from here
import json
import sys
import time

from engine.game import simulate_game

N = int(sys.argv[1]) if len(sys.argv) > 1 else 30

with open("engine/rosters.json", encoding="utf-8") as f:
    data = json.load(f)
home, away = data["teams"][0], data["teams"][1]

t0 = time.perf_counter()
bad = 0
ots = 0
for i in range(N):
    r = simulate_game(home, away)
    ok = r["home"]["verification"]["ok"] and r["away"]["verification"]["ok"]
    if not ok:
        bad += 1
    if r["overtime_periods"]:
        ots += 1
    if i < 5 or not ok:
        print(
            i, r["home"]["name"], r["home"]["score"], "-", r["away"]["name"], r["away"]["score"],
            "| OT", r["overtime_periods"], "| drives", len(r["drives"]),
            "| verify", r["home"]["verification"], r["away"]["verification"],
        )
print(f"{N} games in {time.perf_counter() - t0:.2f}s, verification mismatches: {bad}, OT games: {ots}")

r = simulate_game(home, away, {"qb_accuracy": 70}, seed=1)
print(json.dumps(r["scoring_plays"][:3], indent=1))
print("quarters", r["home"]["quarters"], r["away"]["quarters"], "sliders", r["sliders"])
print("QB", [p for p in r["home"]["players"] if p["position"] == "QB"][0])
print("drives", r["drives"][:3])
