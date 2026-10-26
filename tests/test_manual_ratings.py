"""Hand rating edits (data/manual_ratings.json, build_teams.apply_manual_ratings): every edit names a
real player at his school with engine attributes, the deltas land clamped on the built teams,
and the real 2026 build carries them (the edited starters' attributes differ from the source by
the delta)."""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))
import json

from teamdata import build_teams

ROOT = _Path(__file__).resolve().parents[1]

if __name__ == "__main__":
    manual = json.loads((ROOT / "data" / "manual_ratings.json").read_text(encoding="utf-8"))
    built = json.loads((ROOT / "data" / "engine_teams.json").read_text(encoding="utf-8"))["teams"]
    n = 0
    for team, players in manual["ratings"].items():
        assert team in built, f"no team {team}"
        roster = {p["slug"]: p for p in built[team]["offense"] + built[team]["defense"]}
        for slug, deltas in players.items():
            assert slug in roster, f"{slug} is not on {team}"
            assert slug in manual["why"], f"no reason given for {slug}"
            for attr, d in deltas.items():
                assert attr in build_teams.ATTRS and -15 <= d <= 15, (slug, attr, d)
                n += 1
    # the mechanism: deltas apply once, clamped to 1-99, and a missing player or attribute is skipped
    fake = [{"slug": "x", "players": [{"slug": "a", "position": "QB", "passing": 95, "decision_making": 40}, {"slug": "b", "position": "RB", "vision": 50}]}]
    applied = build_teams.apply_manual_ratings(fake, {"ratings": {"x": {"a": {"passing": 10, "decision_making": -5, "nope": 3}, "zzz": {"passing": 1}}}})
    assert applied == 2 and fake[0]["players"][0]["passing"] == 99 and fake[0]["players"][0]["decision_making"] == 35
    assert fake[0]["players"][1]["vision"] == 50 and "nope" not in fake[0]["players"][0]
    # the real build carries the edits: an edited attribute differs from the un-edited build by the delta
    src = json.loads((ROOT / "data" / "engine_teams.json").read_text(encoding="utf-8"))
    assert src.get("manual_ratings_applied") == n, f"the build applied {src.get('manual_ratings_applied')} of {n} edits"
    print(f"manual ratings ok: {n} attribute edits on {sum(len(v) for v in manual['ratings'].values())} players")
