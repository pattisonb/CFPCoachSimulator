"""The same seed gives the same offseason: departures, the players who want out, the coaching
carousel. The random streams are seeded from the season's seed, so a test that fixes the seed
sees the same numbers every run. (Run as a file: multiprocessing on Windows.)"""
import json
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))
_sys.path.insert(0, str(_Path(__file__).resolve().parent))

from coach_career import offseason
from sim import season
from test_offseason import finished


def one() -> str:
    st = season.new_season("ohio-state", "full", seed=5, career=True)
    finished(st)
    offseason.start(st)
    off = st["offseason"]
    picture = {"departures": off.get("departures"), "retention": off.get("retention"), "fired": off.get("fired"),
               "coaching": [c for c in (st["league"].get("coaching_changes") or [])] if isinstance(st.get("league"), dict) else None}
    return json.dumps(picture, sort_keys=True, default=str)


if __name__ == "__main__":
    a, b = one(), one()
    assert a == b, "two offseasons from the same seed differ"
    print(f"determinism ok: the same seed gives the same offseason ({len(a)} bytes of departures, retention and carousel)")
