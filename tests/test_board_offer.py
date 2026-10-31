"""Taking a prospect off your board pulls your offer to him: the NIL comes back, the offer slot frees,
a verbal commit of yours decommits, his History logs the pull; a hard commit cannot come off (his
offer stands until he signs). A prospect you never offered just leaves the board. Through `app.api`,
as the page calls it. (Run as a file: multiprocessing on Windows.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))

from app import api
from coach_career import recruiting as rec
from sim import season

ME = "ohio-state"


def R(sid: str, path: str, body: dict) -> dict:
    return api.call("POST", f"/api/season/{sid}/{path}", body)


def refused(fn, code: int, words: str) -> None:
    try:
        fn()
    except api.ApiError as e:
        assert e.status == code and words in e.message, (e.status, e.message)
        return
    raise AssertionError(f"expected {code}")


if __name__ == "__main__":
    import shutil
    import tempfile
    season.SEASONS_DIR = _Path(tempfile.mkdtemp(prefix="cfp-board-offer-test-"))
    try:
        sid = api.call("POST", "/api/season", {"team": ME, "mode": "full", "seed": 11, "career": True})["id"]
        rows = api.call("GET", f"/api/season/{sid}/prospects?stars=3&limit=5000")["rows"]
        a, b, c = rows[40]["id"], rows[41]["id"], rows[42]["id"]
        st = api.loaded_state()
        rc = st["recruiting"]
        for pid in (a, b, c):
            R(sid, "board", {"pid": pid, "on": True})
        pitch = rec.PITCHES[0]
        left0 = rec.nil_left(st, ME)
        R(sid, "recruit", {"pid": a, "action": "offer", "pitch": pitch, "nil": 10})
        assert a in rc["offers"][ME] and rec.nil_left(st, ME) == left0 - 10

        # off the board: the offer goes with him, the NIL comes back, his History says so
        R(sid, "board", {"pid": a, "on": False})
        assert a not in rc["board"] and a not in rc["offers"][ME], "taking him off the board pulls the offer"
        assert rec.nil_left(st, ME) == left0, "the NIL on the offer comes back"
        assert any(e["kind"] == "pull_offer" and e["pid"] == a and e["school"] == ME for e in rc["log"]), "the pull is logged"

        # never offered: he just leaves the board
        R(sid, "board", {"pid": b, "on": False})
        assert b not in rc["board"]

        # your verbal commit decommits when you take him off
        R(sid, "recruit", {"pid": c, "action": "offer", "pitch": pitch, "nil": 0})
        rc["status"][c].update(committed=ME, firmness=60, hard=False)
        R(sid, "board", {"pid": c, "on": False})
        assert rc["status"][c]["committed"] is None and c not in rc["offers"][ME], "a verbal commit of yours decommits"

        # a hard commit cannot come off: his offer stands
        R(sid, "board", {"pid": c, "on": True})
        R(sid, "recruit", {"pid": c, "action": "offer", "pitch": pitch, "nil": 0})
        rc["status"][c].update(committed=ME, firmness=95, hard=True)
        refused(lambda: R(sid, "board", {"pid": c, "on": False}), 409, "hard commit")
        assert c in rc["board"] and c in rc["offers"][ME]
        print("board offer ok: off the board pulls the offer and returns its NIL; a verbal commit decommits; a hard commit stays")
    finally:
        shutil.rmtree(season.SEASONS_DIR, ignore_errors=True)
