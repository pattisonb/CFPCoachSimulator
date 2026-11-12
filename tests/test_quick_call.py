"""Quick calls and the one head coach visit (the player's ask: calling and pitching over and over gets old). After a
recruit's first call, Call is a quick check-in: it spends the hours for a slight boost (QUICK_CALL of a call's base) and
opens no conversation (the menu offers only this call after the first). Your head coach visits a recruit once. (Run as a file.)"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import api                              # noqa: E402
from coach_career import prospects, recruiting   # noqa: E402

ME = "smu"


def fresh():
    api.call("POST", "/api/season", {"team": ME, "seed": 29})
    st = api.loaded_state()
    rc = st["recruiting"]
    rc["hours"][ME] = 500
    pid = next(q for q in recruiting.prospect_list(st) if not rc["prospects"][q].get("hidden") and ME not in rc["contacts"].get(q, {})
               and not recruiting.would_pester(st, ME, q))
    return st, pid


def refused(fn, words):
    try:
        fn()
    except recruiting.RecruitingError as e:
        assert e.code == 409 and words in e.message, e.message
        return
    raise AssertionError(f"not refused: {words}")


if __name__ == "__main__":
    st, pid = fresh()
    rc = st["recruiting"]
    # no quick call before a first conversation
    refused(lambda: recruiting.act(st, ME, pid, "call", answer="quick"), "Call and pitch him first")
    assert prospects.board_row(st, pid, ME)["calls"] == 0
    # after one: no scene, the hours spent, a slight boost
    recruiting._contact(st, ME, pid)["calls"] = 1
    hours = rc["hours"][ME]
    before = recruiting.pending(st, ME, pid)
    r = recruiting.act(st, ME, pid, "call", answer="quick")
    assert "scene" not in r and pid not in ((rc.get("scenes") or {}).get(ME) or {}), "a quick call opens no conversation"
    assert rc["hours"][ME] == hours - recruiting.HOURS["call"], "it spends the call's hours"
    gained = recruiting.pending(st, ME, pid) - before
    assert 0 < gained <= recruiting.BASE_POINTS["call"] * recruiting.QUICK_CALL * 2, gained
    assert prospects.board_row(st, pid, ME)["calls"] == 2
    # once a week still
    refused(lambda: recruiting.act(st, ME, pid, "call", answer="quick"), "already called")

    # the head coach visits once: a visit that happened months ago still counts
    st, pid = fresh()
    week = st["current_week"]
    recruiting._contact(st, ME, pid)["hc_week"] = week - 10
    recruiting._event(st, "present", pid, ME, action="hc_visit", topics=["nil", "coach", "winning"], hit=0)
    st["recruiting"]["log"][-1]["week"] = week - 10
    assert recruiting.hc_visit_week(st, ME, pid) == week - 10
    refused(lambda: recruiting.act(st, ME, pid, "hc_visit"), "visits a recruit once")
    print("quick call ok: after a first call, Call spends the hours for a slight boost with no conversation; the head coach visits once")
