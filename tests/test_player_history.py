"""Players keep their seasons (coach_career/offseason.py record_seasons): when the offseason opens,
every player's season line and honors go onto his entry in the career's league, follow him
through the rollover (and a transfer), and his page lists them."""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))

from coach_career import offseason
from sim import season
from test_offseason import finished

if __name__ == "__main__":
    st = season.new_season("ohio-state", "full", seed=2, career=True)
    season.advance_to(st, 2)                         # two real weeks of stats
    finished(st)                                     # the rest decided without lines
    assert season.player_profile(st, "ohio-state", slug="julian-sayin")["history"] == []
    offseason.start(st)
    lgd = st["league"]
    c = next(c for c in lgd["teams"]["ohio-state"]["roster"] if c["id"] == "julian-sayin")
    h = c.get("hist")
    assert h and len(h) == 1 and h[0]["year"] == 2026 and h[0]["team"] == "ohio-state" and h[0]["games"] >= 1 and h[0]["stats"].get("pass_yards", 0) > 0, h
    assert "honors" in h[0] and isinstance(h[0]["honors"], list)
    n = sum(1 for t in lgd["teams"].values() for c in t["roster"] if c.get("hist"))
    assert n >= 2000, n
    offseason.run_all(st)
    new = offseason.next_season(st)
    # a returning player's page lists last season (Sayin may have left early: take anyone who came back)
    back = next(c for c in new["league"]["teams"]["ohio-state"]["roster"] if c.get("hist") and c["hist"][0]["stats"])
    prof = season.player_profile(new, "ohio-state", slug=back["id"])
    assert prof and prof["history"] and prof["history"][0]["year"] == 2026 and prof["history"][0]["stats"] == back["hist"][0]["stats"], prof["history"]
    assert prof["history"][0]["team_name"] == "Ohio State" and prof["history"][0]["class"]
    # a transfer carries his seasons with him
    ptl = [(s, c) for s, t in new["league"]["teams"].items() for c in t["roster"] if c.get("hist") and c["hist"][-1]["team"] != s]
    assert ptl, "no transfer carried his seasons"
    season.close_pool()
    print(f"player history ok: {n} players with a season on record; {len(ptl)} carried theirs to a new team")
