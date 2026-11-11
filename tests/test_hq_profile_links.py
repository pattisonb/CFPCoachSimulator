"""Headquarters' Senior Impact and Retention replacement links during the offseason: the replacement is a recruit of
the signed high school class, which the portal weeks keep aside (prospects.class_rc); his Prospect Profile must
still open then, not 404 "unknown prospect". And every Headquarters player row carries his slug for his player page."""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))
_sys.path.insert(0, str(_Path(__file__).resolve().parent))

from coach_career import headquarters, offseason, prospects
from sim import season
from test_offseason import finished


def replacements(st):
    return [p["replacement"] for p in headquarters.outlook(st)["players"] if p.get("replacement")]


def test_replacement_profile_opens_in_the_portal(st):
    while not st["offseason"]["stage"].startswith("portal_w"):
        offseason.advance(st)
    reps = replacements(st)
    assert reps, "a replacement to open"
    for r in reps:
        prof = prospects.profile(st, r["pid"], st["team"])
        assert prof["public"]["name"] == r["name"], (prof["public"]["name"], r["name"])


def test_hq_players_carry_slugs(st):
    assert all(p.get("slug") for p in headquarters.outlook(st)["players"])
    rows = [p for g in headquarters.next_year(st)["groups"] for p in g["players"]]
    assert rows and all(p.get("slug") for p in rows), rows[:2]


if __name__ == "__main__":
    st = season.new_season("iowa", "full", seed=5, career=True)
    finished(st)
    offseason.start(st)
    test_hq_players_carry_slugs(st)
    test_replacement_profile_opens_in_the_portal(st)
    print("hq profile links ok: a replacement's Prospect Profile opens in the portal weeks; Headquarters players carry their slugs")
