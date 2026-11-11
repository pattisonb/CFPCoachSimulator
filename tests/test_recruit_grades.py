"""School Grades Phase 2 (docs/superpowers/plans/2026-11-11-school-grades-phase-2.md): recruits want the grades. Five new
topics (Facilities, Location, Stability, Game Day, Exposure); Academics reads its grade; Location reads its tags against
his taste."""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))

from coach_career import programs, recruiting

ME = "iowa"
NEW = ("facilities", "location", "stability", "game_day", "exposure")


def fresh():
    from sim import season
    st = season.new_season(ME, "full", seed=5, career=True)
    st["current_week"] = 1
    return st


def a_pid(st, n=40):
    rc = st["recruiting"]
    return sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"])[n]


# ----- Task 1: the topics and the pulls -----

def test_thirteen_topics():
    st = fresh()
    assert len(recruiting.PITCHES) == 13 and recruiting.PITCHES[-5:] == NEW, recruiting.PITCHES
    assert set(recruiting.pull(st, ME, a_pid(st))) == set(recruiting.PITCHES)


def test_pull_reads_grades():
    st = fresh()
    pid = a_pid(st)
    pu, g = recruiting.pull(st, "stanford", pid, winning=False), programs.grades("stanford")
    for t in ("academics", "facilities", "stability", "game_day", "exposure"):
        assert abs(pu[t] - g[t] / 100) < 1e-9, (t, pu[t], g[t])


def test_location_taste():
    st = fresh()
    pid = a_pid(st)
    tags, grade = programs.tags("stanford"), programs.grades("stanford")["location"] / 100
    saved = recruiting.place_taste
    try:
        recruiting.place_taste = lambda p: {"setting": tags["setting"], "climate": tags["climate"]}
        assert abs(recruiting.pull(st, "stanford", pid, winning=False)["location"] - min(1.0, grade + 2 * recruiting.LOCATION_MATCH)) < 1e-9
        other = {"setting": "Small Town" if tags["setting"] != "Small Town" else "Big City", "climate": "Cold" if tags["climate"] != "Cold" else "Warm"}
        recruiting.place_taste = lambda p: other
        assert abs(recruiting.pull(st, "stanford", pid, winning=False)["location"] - max(0.0, grade - 2 * recruiting.LOCATION_CLASH)) < 1e-9
    finally:
        recruiting.place_taste = saved


def test_taste_stable():
    p = {"id": "t1", "hometown": {"state": "FL"}}
    assert recruiting.place_taste(p) == recruiting.place_taste(p)
    warm = sum(recruiting.place_taste({"id": f"t{i}", "hometown": {"state": "FL"}})["climate"] == "Warm" for i in range(100))
    assert warm >= 60, warm


def test_no_grades_neutral():
    st = fresh()
    pu = recruiting.pull(st, "ndsu", a_pid(st), winning=False)
    for t in NEW:
        assert pu[t] == recruiting.NEUTRAL_PULL, (t, pu[t])


def test_academic_reads_grade():
    assert recruiting.academic("stanford") and not recruiting.academic("akron")
    assert recruiting.academic("ndsu") == ("ndsu" in recruiting.ACADEMIC), "no grades: the old list"


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("recruit grades ok")
