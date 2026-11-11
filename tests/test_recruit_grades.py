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


# ----- Task 2: who cares about what -----

HS = {"proximity": 0.13, "playing_time": 0.13, "prestige": 0.10, "winning": 0.10, "nil": 0.10, "pro": 0.08, "coach": 0.07,
      "academics": 0.06, "facilities": 0.06, "location": 0.05, "stability": 0.04, "game_day": 0.04, "exposure": 0.04}


def test_odds_tables():
    for t in (recruiting.PRIORITY_ODDS, recruiting.PORTAL_PRIORITY_ODDS, recruiting.PORTAL_TOP_PRIORITY_ODDS):
        assert abs(sum(t.values()) - 1.0) < 1e-9 and set(t) == set(recruiting.PITCHES), t
    assert recruiting.PRIORITY_ODDS == HS
    assert recruiting.PORTAL_PRIORITY_ODDS["playing_time"] == 0.34 and recruiting.PORTAL_TOP_PRIORITY_ODDS["nil"] == 0.25


def test_spread():
    n = 4000
    firsts = [recruiting._priorities(f"s{i}")[0] for i in range(n)]
    for t, odds in HS.items():
        share = firsts.count(t) / n
        assert abs(share - odds) <= 0.03, (t, share, odds)


def share(topic, tilt, n=3000):
    return sum(topic in recruiting._priorities(f"x{i}", None, tilt) for i in range(n)) / n


def test_tilts():
    mom = recruiting.tilt_for({"stars": 4, "ea_position": "K"}, {"decider": "mom", "personality": None})
    assert mom == {"proximity": recruiting.TILT, "academics": recruiting.TILT, "stability": recruiting.TILT}, mom
    assert share("stability", mom) > share("stability", None) + 0.01
    qb = recruiting.tilt_for({"stars": 4, "ea_position": "QB"}, {"decider": "hs_coach", "personality": None})
    assert share("coach", qb) > share("coach", None) + 0.01
    both = recruiting.tilt_for({"stars": 5, "ea_position": "QB"}, {"decider": "dad", "personality": "attention"})
    assert abs(both["exposure"] - recruiting.TILT ** 4) < 1e-9, both    # dad, attention, five-star and QB all lean Exposure


def test_old_priorities_kept():
    st = fresh()
    pid = a_pid(st)
    p = st["recruiting"]["prospects"][pid]
    p["priorities"] = ["nil", "coach", "academics"]
    w = recruiting.weights(p)
    assert abs(sum(w.values()) - 1.0) < 1e-9 and w["nil"] == recruiting.PRIORITY_WEIGHTS[0]
    assert abs(w["facilities"] - recruiting.OTHER_WEIGHT / 10) < 1e-9


def test_portal_tables():
    t = recruiting.tilt_for({"stars": None, "tier": 4, "portal": True, "group": "RB"}, {"decider": "self", "personality": "shy"})
    pri = recruiting._priorities("portal-x", recruiting.PORTAL_PRIORITY_ODDS, t)
    assert len(set(pri)) == 3 and set(pri) <= set(recruiting.PITCHES)


def test_decider_draw_kept():
    from coach_career import persona
    for i in range(200):
        d = persona.draw(f"d{i}", 7)
        if d["decider"] == "self":
            assert d["decider_topic"] is None
        if d["decider"] == "mom":
            assert d["decider_topic"] in ("proximity", "academics", "stability"), d
        if d["decider"] == "trainer":
            assert d["decider_topic"] in ("nil", "pro", "facilities", "exposure"), d
    assert any(persona.draw(f"d{i}", 7)["decider_topic"] == "stability" for i in range(400)), "the new topics get their share"


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("recruit grades ok")
