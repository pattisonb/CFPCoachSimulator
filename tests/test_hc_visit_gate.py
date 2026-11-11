"""The once-a-month in-home visit counts only visits that happened (the player's report: a Legacy recruit's visit
broke before it opened, and the next try said he had been visited this month, though he never had a visit). And an
action that breaks partway leaves no half-done change: the season in memory is dropped and the saved file read again.
(Run as a file.)"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import api                              # noqa: E402
from coach_career import prospects, recruiting   # noqa: E402

ME = "smu"


def fresh():
    sid = api.call("POST", "/api/season", {"team": ME, "seed": 23})["id"]
    st = api.loaded_state()
    rc = st["recruiting"]
    rc["hours"][ME] = 500
    pid = next(q for q in recruiting.prospect_list(st) if not rc["prospects"][q].get("hidden") and ME not in rc["contacts"].get(q, {})
               and not recruiting.would_pester(st, ME, q))
    return sid, st, pid


def test_broken_visit_does_not_count():
    sid, st, pid = fresh()
    rc, week = st["recruiting"], st["current_week"]
    # what a visit that broke before its scene opened left behind: the mark and a bare contact line
    recruiting._contact(st, ME, pid)["hc_week"] = week
    recruiting._event(st, "contact", pid, ME, action="hc_visit")
    assert recruiting.hc_visit_week(st, ME, pid) is None
    assert prospects.board_row(st, pid, ME)["hc_week"] is None, "the menu offers the visit"
    sc = recruiting.act(st, ME, pid, "hc_visit")["scene"]          # it opens now
    assert sc and sc["action"] == "hc_visit"
    assert recruiting.hc_visit_week(st, ME, pid) == week, "an open visit counts"


def test_real_visits_count():
    sid, st, pid = fresh()
    week = st["current_week"]
    recruiting._contact(st, ME, pid)["hc_week"] = week
    recruiting._event(st, "present", pid, ME, action="hc_visit", topics=["nil", "coach", "winning"], hit=0)
    assert recruiting.hc_visit_week(st, ME, pid) == week
    try:
        recruiting.act(st, ME, pid, "hc_visit")
        raise AssertionError("a second visit this month is refused")
    except recruiting.RecruitingError as e:
        assert e.code == 409
    # an AI school's mark stands (its visits log nothing)
    other = next(s for s in recruiting.fbs_schools(st) if s != ME)
    recruiting._contact(st, other, pid)["hc_week"] = week
    assert recruiting.hc_visit_week(st, other, pid) == week


def test_broken_action_leaves_no_change():
    sid, st, pid = fresh()
    api._save_loaded()

    def boom(p):
        api.loaded_state()["recruiting"]["hours"][ME] = 1      # a change made, then a bug
        raise RuntimeError("a bug partway through")
    api.ROUTES.insert(0, ("POST", "/api/season/{season_id}/boom", boom))
    try:
        try:
            api.call("POST", f"/api/season/{sid}/boom", {})
        except RuntimeError:
            pass
        st2 = api._season_state(sid)
        assert st2["recruiting"]["hours"][ME] == 500, "the half-done change is gone: the saved file was read again"
    finally:
        api.ROUTES.pop(0)


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
