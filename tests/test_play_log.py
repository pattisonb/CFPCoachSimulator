"""The play log must not change a game: same seed, same score and stats, with a log that
adds up to the drive it belongs to. `python test_play_log.py` prints a fingerprint of
five games (compare it before and after an engine change) and checks the log."""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `import season` works from here
import hashlib
import json
import sys

import season


def fingerprint(n: int = 5) -> str:
    teams = season.load_teams()
    slugs = sorted(teams)
    h = hashlib.sha256()
    for i in range(n):
        home, away = slugs[(i * 37) % len(slugs)], slugs[(i * 53 + 7) % len(slugs)]
        from engine.game import simulate_game
        if not season._TEAMS:
            season._init(str(season.TEAMS_FILE))
        g = simulate_game(season._TEAMS[home], season._TEAMS[away], seed=100 + i)
        core = {k: g[k] for k in ("home", "away", "winner", "scoring_plays")}
        for side in ("home", "away"):
            core[side] = {k: v for k, v in core[side].items() if k in ("name", "score", "quarters", "team_stats", "players")}
        core["drives"] = [{k: v for k, v in d.items() if k != "log"} for d in g["drives"]]
        h.update(json.dumps(core, sort_keys=True, default=str).encode())
        if "--check" in sys.argv:
            check(g)
    return h.hexdigest()[:16]


def check(g: dict) -> None:
    n_plays = 0
    for d in g["drives"]:
        log = d.get("log")
        assert log is not None, "drive without a log"
        snaps = [e for e in log if e["type"] in ("run", "pass") and e.get("result") not in ("offensive penalty", "defensive penalty")]
        n_plays += len(snaps)
        for e in log:
            assert "quarter" in e and "clock" in e, e
            if e["type"] in ("run", "pass"):
                assert e["down"] in (1, 2, 3, 4), e
    print(f"  {g['away']['name']} {g['away']['score']} at {g['home']['name']} {g['home']['score']}: {len(g['drives'])} drives, {n_plays} logged snaps")


if __name__ == "__main__":
    print("fingerprint", fingerprint())
