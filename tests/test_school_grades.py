"""School Grades, Phase 1 (docs/superpowers/plans/2026-11-11-school-grades-phase-1.md, Task 2): six grades and
Location's tags from the program profile, read on demand; the rating, tiers and market untouched."""
import math
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))

from coach_career import programs

SIX = ("academics", "facilities", "location", "stability", "game_day", "exposure")


def test_every_grade_in_range():
    slugs = list(programs.profile_rows())
    assert len(slugs) == 136
    for s in slugs:
        g = programs.grades(s)
        assert set(g) == set(SIX), (s, g)
        for k, v in g.items():
            assert isinstance(v, float) and not math.isnan(v) and 0 <= v <= 100, (s, k, v)


def test_anchors():
    g = programs.grades
    assert g("stanford")["academics"] > 85, g("stanford")
    assert g("akron")["exposure"] < g("ohio-state")["exposure"]
    assert programs.warmth(73.6) > programs.warmth(16.2)
    assert g("hawai-i")["location"] > g("minnesota")["location"]
    assert g("clemson")["stability"] == 100.0


def test_academies():
    for s in ("army", "navy", "air-force"):
        assert programs.grades(s)["academics"] >= 70, (s, programs.grades(s))


def test_fill_clamped():
    assert programs.fill_score(110_000, 100_000) == 100.0
    assert programs.fill_score(50_000, 100_000) == 20.0
    assert programs.fill_score(50_000, None) is not None, "no capacity: no crash"


def test_strings_and_ties():
    assert programs.facilities_score({"stadium_renovated": 2026, "football_building_year": "2026", "indoor_practice": "none"}) == 0.35 * 100 + 0.40 * 100 + 0.25 * 10
    a, b = programs.grades("ohio-state")["exposure"], programs.grades("alabama")["exposure"]
    assert 0 <= a <= 100 and 0 <= b <= 100, "the rounded 2M ties grade fine"


def test_tags():
    assert programs.tags("texas-state") == {"setting": "Big City", "climate": "Warm", "region": "South"}, programs.tags("texas-state")
    assert programs.tags("akron") == {"setting": "Mid-Size City", "climate": "Cold", "region": "Midwest"}, programs.tags("akron")


def test_unknown_program():
    from sim import season
    assert programs.grades("no-such") is None and programs.tags("no-such") is None
    st = season.new_season("iowa", "full", seed=5, career=True)
    rows = programs.rows(st)
    assert all("grades" in r and "tags" in r for r in rows)
    ungraded = {r["team"] for r in rows if r["grades"] is None}
    assert ungraded == {r["team"] for r in rows} - set(programs.profile_rows()), ungraded   # a program the research has no row for (a new FBS program): Not Graded


def test_rating_untouched():
    from sim import season
    st = season.new_season("iowa", "full", seed=5, career=True)
    for r in programs.rows(st):
        b = programs.base(r["team"])
        assert r["rating"] == b["rating"] and r["tier"] == b["tier"] and r["market"] == b["market"], (r["team"], r["rating"], b["rating"])


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("school grades ok: six grades in range for all 136, the anchors, the academies, fill clamped, tags; the rating untouched")
