"""School Grades Phase 3 (docs/superpowers/plans/2026-11-11-school-grades-phase-3.md): Game Day, Exposure, Stability
and Academics move each offseason with results, each held to its floor; Location and Facilities stay; recruits and the
Programs tab read the live grades."""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))

from coach_career import programs as P

SLUG = "iowa"


def prog(**kw):
    p = {"winning": 40.0, "winning_base": 40.0, "grades_live": {}}
    p.update(kw)
    return p


def live(p, slug=SLUG):
    st = {"league": {"teams": {slug: {"program": p}}}}
    return P.grades_now(st, slug)


def test_old_save_reads_base():
    st = {"league": {"teams": {SLUG: {"program": {"winning": 40.0}}}}}
    assert P.grades_now(st, SLUG) == P.grades(SLUG)
    assert P.grades_now({}, SLUG) == P.grades(SLUG), "no league: the base"


def test_winning_raises_game_day_and_exposure():
    p = prog(winning=70.0)
    base = P.grades(SLUG)
    prev = dict(base)
    for y in range(2027, 2030):
        P._move_grades(p, SLUG, y, rank=None, coach_since=2020, churn=P.CHURN_MEAN)
        now = live(p)
        assert 0 < now["game_day"] - prev["game_day"] <= P.GAME_DAY_STEP + 1e-9 or now["game_day"] == 100, (prev, now)
        assert now["exposure"] > prev["exposure"] or now["exposure"] == 100
        prev = now
    assert now["location"] == base["location"] and now["facilities"] == base["facilities"], "Location and Facilities stay"


def test_floors():
    base = P.grades(SLUG)
    p = prog(winning=0.0)
    for y in range(2027, 2047):
        P._move_grades(p, SLUG, y, rank=None, coach_since=2020, churn=P.CHURN_MEAN)
    now = live(p)
    assert abs(now["game_day"] - round(base["game_day"] * 0.70, 1)) <= 0.1, (now["game_day"], base["game_day"])
    assert abs(now["exposure"] - round(base["exposure"] * 0.75, 1)) <= 0.1, (now["exposure"], base["exposure"])
    p = prog(winning=100.0)
    for y in range(2027, 2067):
        P._move_grades(p, SLUG, y, rank=1, coach_since=2020, churn=P.CHURN_MEAN)
    now = live(p)
    assert now["game_day"] <= 100 and now["exposure"] <= 100


def test_stability():
    base = P.grades(SLUG)["stability"]
    p = prog()
    P._move_grades(p, SLUG, 2027, rank=None, coach_since=2026, churn=P.CHURN_MEAN)
    assert abs(live(p)["stability"] - max(10, base - P.STABILITY_CHANGE)) < 1e-9
    for y in (2028, 2029, 2030):
        P._move_grades(p, SLUG, y, rank=None, coach_since=2026, churn=P.CHURN_MEAN)
    assert abs(live(p)["stability"] - base) < 1e-9, "three years rebuild 15, never above the base"
    for y in range(2031, 2045):
        P._move_grades(p, SLUG, y, rank=None, coach_since=y - 1, churn=P.CHURN_MEAN)
    assert live(p)["stability"] == 10.0, "never under 10"


def test_academics_band():
    base = P.grades(SLUG)["academics"]
    p = prog()
    for y in range(2027, 2047):
        P._move_grades(p, SLUG, y, rank=None, coach_since=2020, churn=P.CHURN_MEAN * 4)
    assert abs(live(p)["academics"] - max(0.0, base - 10)) <= 0.1, (live(p)["academics"], base)


def test_moved_recorded():
    p = prog(winning=70.0)
    P._move_grades(p, SLUG, 2027, rank=5, coach_since=2020, churn=P.CHURN_MEAN)
    assert p["grades_moved"]["game_day"] > 0 and p["grades_moved"]["exposure"] > 0, p["grades_moved"]


def test_rating_untouched_and_pulls_live():
    import test_offseason
    from coach_career import offseason, recruiting
    from sim import season
    st = season.new_season(SLUG, "full", seed=5, career=True)
    test_offseason.finished(st)
    offseason.start(st)
    offseason.run_all(st)
    st = offseason.next_season(st)
    p = P.get(st, SLUG)
    assert "grades_live" in p and p["rating"] == round(P.mix(p), 1)
    p["grades_live"]["game_day"] = -20.0
    recruiting.reset_caches()
    pid = next(iter(st["recruiting"]["prospects"]))
    want = P.grades_now(st, SLUG)["game_day"] / 100
    assert abs(recruiting.pull(st, SLUG, pid, winning=False)["game_day"] - want) < 1e-9


def test_a_copy_never_writes_back():
    """offseason.program_shifts runs update on a shallow copy of each program (a probe): moving the copy's grades must
    leave the real program's grades_live untouched."""
    real = prog(winning=70.0, grades_live={"game_day": 2.0, "exposure": 1.0, "stability": 0.0, "academics": 0.0})
    copy = dict(real)
    P._move_grades(copy, SLUG, 2028, rank=None, coach_since=2020, churn=0)
    assert real["grades_live"] == {"game_day": 2.0, "exposure": 1.0, "stability": 0.0, "academics": 0.0}, real["grades_live"]


def test_change_read_at_the_carousel():
    """programs.update runs at the carousel, before that offseason's hires: a coach hired last offseason (since ==
    year - 1) is this year's change, the way offseason.py reads a new coach."""
    base = P.grades(SLUG)["stability"]
    p = prog()
    P._move_grades(p, SLUG, 2028, rank=None, coach_since=2027, churn=P.CHURN_MEAN)
    assert abs(live(p)["stability"] - max(10, base - P.STABILITY_CHANGE)) < 1e-9, live(p)["stability"]


if __name__ == "__main__":
    _sys.path.insert(0, str(_Path(__file__).resolve().parent))
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("grades move ok: winning lifts Game Day and Exposure, floors hold, Stability drops at a change and rebuilds, Academics stays within 10; recruits read the live grades")
