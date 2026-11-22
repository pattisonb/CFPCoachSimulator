"""The Python engine's answers, for the JavaScript engine to be held to (engine_js/, tests/test_engine_js.py).

    python3 tools/engine_reference.py out.json [games] [first seed]

Plays `games` games between teams of data/engine_teams.json (pairs and venue drawn from the seed, every other game
with momentum on) and writes each one's inputs and its whole result, less the three fields that are not the game's
(its id, when it was played, how long the sim took)."""
from __future__ import annotations

import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

NOT_THE_GAME = ("id", "played_at", "duration_ms")


def main() -> None:
    from engine.game import simulate_game
    out = Path(sys.argv[1])
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 40
    first = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    teams = json.loads((ROOT / "data" / "engine_teams.json").read_text(encoding="utf-8"))["teams"]
    slugs = sorted(teams)
    games = []
    for seed in range(first, first + n):
        pick = random.Random(f"engine-reference-{seed}")
        home, away = pick.sample(slugs, 2)
        venue = "neutral" if pick.random() < 0.2 else "home"
        momentum = seed % 2 == 0
        r = simulate_game(teams[home], teams[away], None, seed, venue=venue, momentum=momentum)
        for k in NOT_THE_GAME:
            r.pop(k, None)
        games.append({"home": home, "away": away, "seed": seed, "venue": venue, "momentum": momentum, "result": r})
    out.write_text(json.dumps({"teams_file": "data/engine_teams.json", "games": games}), encoding="utf-8")
    print(f"{len(games)} games written to {out}")


if __name__ == "__main__":
    main()
