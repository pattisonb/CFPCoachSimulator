"""The program profile (docs/superpowers/plans/2026-11-11-school-grades-phase-1.md, Task 1): the School Grades research
for all 136 programs as one file, every fact with its source, the estimates marked."""
import json
import sys as _sys
from pathlib import Path as _Path

ROOT = _Path(__file__).resolve().parents[1]
_sys.path.insert(0, str(ROOT))
_sys.path.insert(0, str(ROOT / "tools"))

import build_program_profile as bp

FIELDS = ("us_news_rank", "football_gsr", "football_apr", "stadium_name", "stadium_capacity", "stadium_renovated",
          "football_building_year", "indoor_practice", "metro_population", "jan_avg_temp_f", "setting",
          "head_coaches_since_2010", "current_hc_since", "instagram_followers", "attendance", "tv_millions", "state", "conference")


def profile():
    return json.loads((ROOT / "data" / "program_profile.json").read_text())


def test_all_programs():
    market = json.loads((ROOT / "data" / "program_market.json").read_text())["teams"]
    teams = profile()["teams"]
    assert len(teams) == 136 and set(teams) == set(market), set(teams) ^ set(market)


def test_fields():
    for slug, row in profile()["teams"].items():
        for f in FIELDS:
            assert row["facts"].get(f) is not None or f in row["estimates"], (slug, f)


def test_parse_number():
    assert bp.parse_number("120,000") == 120000
    assert bp.parse_number("2M") == 2_000_000
    assert bp.parse_number("307K") == 307_000
    assert bp.parse_number("36,500 seats") == 36500
    assert bp.parse_number(41.5) == 41.5 and bp.parse_number(7) == 7
    for v in ("unranked", "none", None, "", "n/a"):
        assert bp.parse_number(v) is None, v


def test_instagram():
    teams = profile()["teams"]
    assert teams["ohio-state"]["facts"]["instagram_followers"] == 2_000_000
    assert teams["akron"]["facts"]["instagram_followers"] == 22_000


def test_facility_gap_estimated():
    teams = profile()["teams"]
    gaps = [s for s, r in teams.items() if "football_building_year" in r["estimates"]]
    assert gaps, "some building years are conference medians"
    r = teams[gaps[0]]
    assert isinstance(r["facts"]["football_building_year"], int) and r["notes"].get("football_building_year"), r


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("program profile ok: 136 programs, every field filled or estimated, numbers parsed, Instagram from the sheet")
