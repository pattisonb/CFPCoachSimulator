"""Pestering an uninterested recruit costs you (recruiting.py PESTER_*): after PESTER_FREE contacts
to a prospect who is not considering your school, each further message, call or in-home visit
lands negative on his list, costs more than the last and raises his ask; a prospect with you in
his top group never pesters, and Auto-recruit for your school never does it. Native, through the
API as tests/test_recruiting_api.py. (Run as a file: multiprocessing on Windows.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `from sim import season` works from here

from app import api
from coach_career import prospects
from coach_career import recruiting
from sim import season

ME = "ohio-state"


def G(sid: str, path: str) -> dict:
    return api.call("GET", f"/api/season/{sid}/{path}")


def R(sid: str, path: str, body: dict) -> dict:
    return api.call("POST", f"/api/season/{sid}/{path}", body)


def board_of(sid: str, pid: str) -> dict:
    return next(b for b in G(sid, "recruiting")["board"] if b["id"] == pid)


def far_prospect(st: dict) -> str:
    """A four-star far from Ohio, uncommitted, whom your school has not touched, with eight other
    schools' points on his list so that your school sits well outside his top group (early in a
    season few prospects have eight suitors, so the test crowds his list itself)."""
    rc = st["recruiting"]
    for pid in sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"]):
        p = rc["prospects"][pid]
        if p["stars"] != 4 or p["hometown"]["state"] not in ("CA", "WA", "OR", "AZ") or p.get("hidden"):
            continue
        if ME in rc["lists"][pid] or pid in rc["offers"].get(ME, []) or rc["status"][pid]["committed"] is not None:
            continue
        if recruiting.ask_from(st, ME, pid) < 30:
            continue
        others = sorted((s for s in recruiting.fbs_schools(st) if s != ME), key=lambda s: -recruiting.interest(st, s, pid))
        for s in others[:recruiting.TOP_GROUP]:
            rc["lists"][pid][s] = rc["lists"][pid].get(s, 0.0) + 40.0
        recruiting.reset_caches()
        top = recruiting.top_group(st, pid)
        assert ME not in top and recruiting.interest(st, top[-1], pid) - recruiting.interest(st, ME, pid) > 15
        return pid
    raise AssertionError("no far prospect fits the test")


def near_prospect(st: dict) -> str:
    """An uncommitted Ohio four-star your school has not touched: once you contact him you are in
    his (small) top group."""
    rc = st["recruiting"]
    for pid in sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"]):
        p = rc["prospects"][pid]
        if p["hometown"]["state"] == "OH" and p["stars"] == 4 and not p.get("hidden") \
                and rc["status"][pid]["committed"] is None and ME not in rc["lists"][pid] and pid not in rc["offers"].get(ME, []):
            return pid
    raise AssertionError("no Ohio prospect fits the test")


if __name__ == "__main__":
    import shutil
    import tempfile
    season.SEASONS_DIR = _Path(tempfile.mkdtemp(prefix="cfp-pester-test-"))
    try:
        sid = api.call("POST", "/api/season", {"team": ME, "mode": "full", "seed": 11, "career": True})["id"]
        st = api.loaded_state()
        rc = st["recruiting"]
        recruiting.weekly_step(st, 0)                   # the AI schools' first week fills the lists
        pid = far_prospect(st)
        name = rc["prospects"][pid]["name"]
        R(sid, "board", {"pid": pid, "on": True})
        # week 1: three contacts are free; the board says the next one would pester
        st["current_week"] = 1
        R(sid, "recruit", {"pid": pid, "action": "message", "pitch": "prestige"})
        R(sid, "recruit", {"pid": pid, "action": "call", "pitch": "prestige"})
        assert board_of(sid, pid)["pestering"] is False, "two contacts are not pestering yet"
        R(sid, "recruit", {"pid": pid, "action": "hc_visit", "pitch": "prestige"})
        assert rc["contacts"][pid][ME]["n"] == recruiting.PESTER_FREE
        assert recruiting.pending(st, ME, pid) > 0, "the free contacts still count for you"
        assert ME not in recruiting.top_group(st, pid), "the test needs a prospect who is not considering you"
        b = board_of(sid, pid)
        assert b["pestering"] is True and b["pesters"] == 0, b
        assert not any(e["kind"] == "pester" for e in rc["log"]), "the free contacts logged a pester"
        recruiting.weekly_step(st, 1)
        landed1 = rc["lists"][pid][ME]
        assert landed1 > 0
        # week 2: the fourth contact pesters: negative points (the pitch ignored), a logged event, his ask up
        st["current_week"] = 2
        ask0 = recruiting.ask_from(st, ME, pid)
        R(sid, "recruit", {"pid": pid, "action": "message", "pitch": "prestige"})
        pester1 = recruiting.pending(st, ME, pid)
        assert pester1 == -recruiting.PESTER_COST * recruiting.BASE_POINTS["message"], pester1
        events = [e for e in rc["log"] if e["kind"] == "pester" and e["pid"] == pid]
        assert len(events) == 1 and events[0]["school"] == ME and events[0]["action"] == "message" and events[0]["n"] == 1, events
        assert rc["contacts"][pid][ME]["pester"] == 1
        assert recruiting.ask_from(st, ME, pid) > ask0, (ask0, recruiting.ask_from(st, ME, pid))
        b = board_of(sid, pid)
        assert b["pestering"] is True and b["pesters"] == 1
        prof = G(sid, f"prospect/{pid}")
        assert prof["pestering"] is True and prof["pesters"] == 1
        recruiting.weekly_step(st, 2)
        assert rc["lists"][pid][ME] < landed1, "the pester did not land negative on his list"
        # ... and the weekly report carries the line, once
        rep = recruiting.latest_report(st)
        row = next(r for r in rep["rows"] if r["pid"] == pid)
        lines = [e for e in row["events"] if e["kind"] == "pester"]
        assert len(lines) == 1 and lines[0]["line"] == f"{name} is tuning you out: he is not considering Ohio State, and more calls push him further away.", lines
        assert any(e["kind"] == "pester" and e.get("line") for r in G(sid, "recruiting")["report"]["rows"] for e in r["events"])
        # week 3: the second pester costs more than the first; a pestering call's scene ends "tired"
        st["current_week"] = 3
        R(sid, "recruit", {"pid": pid, "action": "message", "pitch": "prestige"})
        pester2 = recruiting.pending(st, ME, pid)
        assert pester2 < pester1 < 0, (pester1, pester2)
        assert pester2 == -recruiting.PESTER_COST * recruiting.BASE_POINTS["message"] * (1 + recruiting.PESTER_RAMP), pester2
        sc = R(sid, "recruit", {"pid": pid, "action": "call"})["scene"]
        r = R(sid, "recruit", {"pid": pid, "action": "pitch", "scene": sc["id"], "pitch": sc["cue"]["topics"][0]})
        assert r["reaction"]["kind"] == "tired" and r["reaction"]["text"], r["reaction"]
        assert recruiting.pending(st, ME, pid) < pester2, "the pestering call cost nothing"
        assert rc["contacts"][pid][ME]["pester"] == 3
        # a prospect who has you in his top group never pesters, however often you contact him
        near = near_prospect(st)
        R(sid, "board", {"pid": near, "on": True})
        rc["contacts"].setdefault(near, {}).setdefault(ME, {"n": 0, "hc_week": None})["n"] = recruiting.PESTER_FREE + 2
        rc["lists"][near][ME] = 5.0                     # as five landed contacts would have left him
        R(sid, "recruit", {"pid": near, "action": "message", "pitch": "prestige"})
        assert ME in recruiting.top_group(st, near)
        assert board_of(sid, near)["pestering"] is False
        assert recruiting.pending(st, ME, near) > 0, recruiting.pending(st, ME, near)
        assert not any(e["kind"] == "pester" and e["pid"] == near for e in rc["log"])
        # in his top group the count of pesters resets: a later slide does not carry the old ones
        rc["contacts"][near][ME]["pester"] = 2
        recruiting.weekly_step(st, 3)
        assert rc["contacts"][near][ME].get("pester", 0) == 0, rc["contacts"][near][ME]
        # Auto-recruit for your school never pesters: three weeks with a pestered prospect on the board, no event
        R(sid, "settings", {"auto_recruit": "season"})
        start = len(rc["log"])
        for week in (4, 5, 6):
            st["current_week"] = week
            recruiting.weekly_step(st, week)
        new = rc["log"][start:]
        assert any(e["kind"] == "contact" and e["school"] == ME for e in new), "Auto-recruit made no contact"
        assert not any(e["kind"] == "pester" for e in new), [e for e in new if e["kind"] == "pester"]
        print("pester ok")
    finally:
        shutil.rmtree(season.SEASONS_DIR, ignore_errors=True)
