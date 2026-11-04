"""Where a portal entrant you recruited went, and why not you (the player's report: "I offered a
guy in the transfer portal and was his clear favorite, but then I guess I didn't get him and I
don't know where he went").

The cause: an entrant picks among the offering schools with room (recruiting._Room), and your
room there counted each transfer you signed twice (your portal spots already take them off, and
the room's commits counted them again), so with half your spots filled you had no room while the
page still showed open spots; he signed with the next school. Nothing said so, and once the
portal closed nothing showed where he went.

Checked through the API the page reads, in two careers (seed 11, Ohio State, the portal open):
1. Half your portal spots filled, the page shows spots left: he has room with you, no "No Room"
   chip, and as his clear favorite he signs with you.
2. Your roster full: the board, his pane and his profile say "No Room on Your Roster" with a
   sentence; he signs elsewhere and his History, the week's news and the What Changed report say
   where and why; after the portal closes the recap's Who Got Away lists him. An entrant you
   offered whom nobody with room offered goes unsigned, and the recap says so. (Run as a file.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))
from app import api
from coach_career import recruiting
from sim import season
from tests.test_portal_profile import G, to_portal

ME = "ohio-state"


def start() -> str:
    sid = api.call("POST", "/api/season", {"team": ME, "mode": "full", "seed": 11, "career": True})["id"]
    to_portal(sid)
    return sid


def recruit(sid: str, pid: str) -> None:
    """On your board, offered, and his clear favorite: far ahead of every school on his list."""
    api.call("POST", f"/api/season/{sid}/board", {"pid": pid, "on": True})
    api.call("POST", f"/api/season/{sid}/recruit", {"pid": pid, "action": "offer", "pitch": "playing_time", "nil": 0})
    st = api.loaded_state()
    st["recruiting"]["lists"][pid][ME] = 1000.0
    api._save_loaded()


def sign_to_me(sid: str, n: int, skip: set) -> None:
    """Fill n of your portal spots with entrants nobody is chasing (signed with you outright)."""
    st = api.loaded_state()
    rc = st["recruiting"]
    free = [q for q in sorted(rc["prospects"], key=lambda q: -rc["prospects"][q]["rank"])
            if q not in skip and not rc["status"][q]["signed"] and rc["prospects"][q]["from"] != ME]
    for q in free[:n]:
        rc["status"][q].update(committed=ME, signed=ME)
    rc["commits_v"] = rc.get("commits_v", 0) + 1
    api._save_loaded()


def advance(sid: str) -> dict:
    return api.call("POST", f"/api/season/{sid}/offseason/advance", {})


def board_row(sid: str, pid: str) -> dict:
    return next(b for b in G(sid, "recruiting")["board"] if b["id"] == pid)


def target(sid: str) -> str:
    """The best entrant not from your school."""
    rc = api.loaded_state()["recruiting"]
    return next(q for q in sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"]) if rc["prospects"][q]["from"] != ME)


def until_signed(sid: str, pid: str) -> tuple[str, int]:
    """Advance portal weeks until he signs: (school, the portal week he decided at)."""
    for _ in range(4):
        week = api.loaded_state()["recruiting"]["week"]
        v = advance(sid)
        if v["stage"] == "development":
            return api.loaded_state()["offseason"]["portal"]["players"][pid]["signed"], week
        signed = api.loaded_state()["recruiting"]["status"][pid]["signed"]
        if signed:
            return signed, week
    raise AssertionError("the portal never closed")


def case_room(sid: str) -> None:
    pid = target(sid)
    recruit(sid, pid)
    room = G(sid, "recruiting")["open_spots"]          # nothing signed yet: all your portal room
    sign_to_me(sid, (room + 1) // 2, {pid})
    v = G(sid, "recruiting")
    assert v["open_spots"] > 0, v["open_spots"]
    assert recruiting._Room(api.loaded_state())(ME, pid), "the page shows spots left: he must have room with you"
    assert board_row(sid, pid)["no_room"] is None
    assert G(sid, f"prospect/{pid}")["public"]["no_room"] is None
    school, week = until_signed(sid, pid)
    assert school == ME, f"his clear favorite with {v['open_spots']} spots showing, he signed with {school} in week {week}"


def case_no_room(sid: str) -> None:
    pid = target(sid)
    recruit(sid, pid)
    # an entrant nobody offered, offered by you too: if nobody with room offers him he goes unsigned (or walks on) at the close
    rc = api.loaded_state()["recruiting"]
    offered = {q for pids in rc["offers"].values() for q in pids}
    lone = next(q for q in sorted(rc["prospects"], key=lambda q: -rc["prospects"][q]["rank"])
                if q not in offered and rc["prospects"][q]["from"] != ME)
    api.call("POST", f"/api/season/{sid}/board", {"pid": lone, "on": True})
    api.call("POST", f"/api/season/{sid}/recruit", {"pid": lone, "action": "offer", "pitch": "playing_time", "nil": 0})
    sign_to_me(sid, G(sid, "recruiting")["open_spots"], {pid, lone})
    v = G(sid, "recruiting")
    assert v["open_spots"] == 0, v["open_spots"]
    # before: the board row, his pane (the same row) and his profile say there is no room, Title Case, with a sentence
    b = board_row(sid, pid)
    assert b["no_room"] and b["no_room"]["label"] == "No Room on Your Roster", b["no_room"]
    tip = b["no_room"]["tip"]
    assert tip[0].isupper() and tip.endswith("."), tip
    assert G(sid, f"prospect/{pid}")["public"]["no_room"] == b["no_room"]
    school, week = until_signed(sid, pid)
    assert school and school != ME, school
    name = recruiting.school_name(school)
    want = f"He signed with {name}: you had no roster spot left for him."
    st = api.loaded_state()
    if st["recruiting"].get("portal"):
        # the week's step: his History, the news and the What Changed report say where he went and why
        b = board_row(sid, pid)
        assert any(h.get("line") == want and h.get("portal_week") == week for h in b["history"]), b["history"][:3]
        news = [e for e in G(sid, "recruiting")["recap"] if e["pid"] == pid and e["kind"] == "signed"]
        assert news and news[-1]["school"] == school and news[-1]["reason"] == "You had no roster spot left for him.", news
        rep = G(sid, "recruiting/report")["reports"][-1]
        assert rep["week"] == week
        row = next(r for r in rep["rows"] if r["pid"] == pid)
        ev = next(e for e in row["events"] if e["kind"] == "signed")
        assert ev["school_name"] == name and ev["reason"] == "You had no roster spot left for him.", ev
        # the toast's source: the portal view's Who Got Away, this week
        away = api.call("GET", f"/api/season/{sid}/offseason")["portal"]["away"]
        assert any(r["id"] == pid and r["week"] == week and r["line"] == want for r in away), away
        while api.loaded_state()["offseason"]["stage"] != "development":
            advance(sid)
    # after the portal closes: the recap's Who Got Away keeps where he went and why
    v = api.call("GET", f"/api/season/{sid}/offseason")
    away = {r["id"]: r for r in v["portal_recap"]["away"]}
    assert pid in away and away[pid]["to"] == school and away[pid]["line"] == want, away.get(pid)
    e = api.loaded_state()["offseason"]["portal"]["players"][lone]
    r = away.get(lone)
    assert e["signed"] != ME, "your roster was full"
    assert r, "an entrant you offered who went elsewhere is in Who Got Away"
    if not e["signed"]:
        assert r["to"] is None and r["to_name"] == "out of FBS" and r["line"] == "He went unsigned and is leaving FBS.", r
    elif r["walk_on"]:
        assert r["line"] == f"He went unsigned and took a walk-on spot at {recruiting.school_name(e['signed'])}.", r
    else:
        assert r["line"].startswith(f"He signed with {recruiting.school_name(e['signed'])}"), r
    print(f"week {week}: {want} Lone entrant: {r['line']}")
    for r in away.values():
        assert r["line"] and r["line"][0].isupper() and r["line"].endswith("."), r
        assert all(w not in r["line"] for w in ("None", "null", "undefined", "NaN")), r


if __name__ == "__main__":
    import shutil
    import tempfile
    season.SEASONS_DIR = _Path(tempfile.mkdtemp(prefix="cfp-portal-outcome-"))
    try:
        case_room(start())
        case_no_room(start())
    finally:
        season.close_pool()
        shutil.rmtree(season.SEASONS_DIR, ignore_errors=True)
    print("ok")
