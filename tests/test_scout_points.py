"""Budgets: about 150 recruiting hours a week, and scouting on its own points (a Send spends points, not hours)."""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))

from coach_career import recruiting
from sim import season

ME = "ohio-state"


def fresh(seed=7, recruiting_rating=None):
    coach = {"id": "c1", "first_name": "Pat", "last_name": "Test",
             "ratings": {"recruiting": recruiting_rating if recruiting_rating is not None else 50,
                         "evaluation": 60, "offense": 70, "defense": 70}}
    return season.new_season(ME, "full", seed=seed, career=True, coach=coach)


def set_evaluator(st, rating):
    st["coach"]["ratings"]["evaluation"] = rating
    for m in st["career"]["staff"]:
        m["evaluation"] = min(m.get("evaluation", 50), rating)


def test_hours_range():
    assert recruiting.weekly_hours(fresh(recruiting_rating=50), ME) == 140
    assert recruiting.weekly_hours(fresh(recruiting_rating=100), ME) == 160
    assert recruiting.weekly_hours(fresh(recruiting_rating=30), ME) == 140
    assert recruiting.weekly_hours(fresh(recruiting_rating=63), ME) == 145


def test_points_range():
    st = fresh()
    set_evaluator(st, 50)
    assert recruiting.best_evaluator(st) == 50 and recruiting.scout_points(st, ME) == 150
    st["coach"]["ratings"]["evaluation"] = 100
    assert recruiting.best_evaluator(st) == 100 and recruiting.scout_points(st, ME) == 250
    for rating, want in ((63, 175), (77, 205)):         # in fives
        st["coach"]["ratings"]["evaluation"] = rating
        for m in st["career"]["staff"]:
            m["evaluation"] = min(m.get("evaluation", 50), rating)
        assert recruiting.best_evaluator(st) == rating and recruiting.scout_points(st, ME) == want and want % 5 == 0


def pick(st, in_area, home=False):
    """An unscouted, unsigned prospect: in your state (`home`), else in or out of a staffed area but not close to home."""
    rc = st["recruiting"]
    codes = {c for m in st["career"]["staff"] for c in recruiting.AREAS.get(m.get("area"), [])}
    return next(q for q, p in rc["prospects"].items() if q not in rc["reads"] and not rc["status"][q]["signed"]
                and (p["hometown"]["state"] == "OH") == home
                and (home or ((p["hometown"]["state"] in codes) == in_area and not recruiting.near_home(st, ME, q))))


def test_look_costs():
    st = fresh()
    st["career"]["staff"][0]["area"] = "Midwest"
    home, near, far = pick(st, True, home=True), pick(st, True), pick(st, False)
    assert recruiting.look_cost(st, ME, home) == recruiting.LOOK_COST["home"] == 5
    assert recruiting.look_cost(st, ME, near) == recruiting.LOOK_COST["area"] == 10
    assert recruiting.look_cost(st, ME, far) == recruiting.LOOK_COST["away"] == 15
    # close to home without the state: a prospect within HOME_MILES of the campus costs the home price too
    rc = st["recruiting"]
    close = next(q for q, p in rc["prospects"].items() if p["hometown"]["state"] != "OH" and recruiting.near_home(st, ME, q))
    assert recruiting.look_cost(st, ME, close) == recruiting.LOOK_COST["home"]
    port = dict(st, recruiting=dict(st["recruiting"], portal=True))
    assert recruiting.look_cost(port, ME, near) == recruiting.LOOK_COST["portal"] == 5
    # half a look finishes his report: half the tier, rounded up to a multiple of 5
    for q, full, half in ((home, 5, 5), (near, 10, 5), (far, 15, 10)):
        rc["reads"][q] = {"looks": recruiting.REPORT_LOOKS - 1, "by": {}, "g": {grp: [40.0, 60.0] for grp in recruiting.GROUPS}}
        assert recruiting.look_cost(st, ME, q) == full, (q, full)          # a whole look still needed: the full tier
        rc["reads"][q]["looks"] = recruiting.REPORT_LOOKS - 0.5
        assert recruiting.look_cost(st, ME, q) == half, (q, half)
        del rc["reads"][q]


def test_send_spends_points_not_hours():
    st = fresh()
    st["career"]["staff"][0]["area"] = "Midwest"
    pid = pick(st, False)
    h0, p0 = recruiting._hours(st, ME), recruiting.scout_points_left(st, ME)
    recruiting.act(st, ME, pid, "scout")
    assert recruiting._hours(st, ME) == h0
    assert recruiting.scout_points_left(st, ME) == p0 - 15


def test_short_points_409():
    st = fresh()
    pid = pick(st, False)
    st["recruiting"]["scout_points"] = {ME: 14}
    try:
        recruiting.act(st, ME, pid, "scout")
        raise AssertionError("a Send with 14 points")
    except recruiting.RecruitingError as e:
        assert e.code == 409 and e.message == "Not enough scouting points left this week.", e.message
    st["recruiting"]["scout_points"] = {ME: 15}
    recruiting.act(st, ME, pid, "scout")
    assert recruiting.scout_points_left(st, ME) == 0


def test_old_save_without_key():
    st = fresh()
    st["recruiting"].pop("scout_points", None)
    assert recruiting.scout_points_left(st, ME) == recruiting.scout_points(st, ME)


def test_points_refill_next_week():
    st = fresh()
    pid = pick(st, False)
    recruiting.act(st, ME, pid, "scout")
    assert recruiting.scout_points_left(st, ME) < recruiting.scout_points(st, ME)
    recruiting.weekly_step(st, st["current_week"])
    assert recruiting.scout_points_left(st, ME) == recruiting.scout_points(st, ME)


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
    print("test_scout_points: all passed")
