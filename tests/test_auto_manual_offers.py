"""Auto-recruit leaves your own offers alone: an offer you make by hand (and a prospect you put on
your board by hand) stays through Auto-recruit's weeks, even in a group at its cap or after he
commits elsewhere, while the offers Auto-recruit made itself are still pulled by its rules. A
pull by hand clears the mark; a hand offer still counts toward the offer limit. Through `app.api`,
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


def refused(fn, code: int) -> None:
    try:
        fn()
    except api.ApiError as e:
        assert e.status == code, (e.status, e.message)
        return
    raise AssertionError(f"expected {code}")


def advance_one(sid: str) -> None:
    """One week through the dispatcher, as the page plays it (Advance, then step())."""
    R(sid, "advance", {"to": api.loaded_state()["current_week"] + 1})
    while api.step() is not None and api.running():
        pass


def cap_group(st: dict, group: str, skip: set) -> None:
    """Commit uncommitted prospects of `group` to you until your commits there reach its cap."""
    rc = st["recruiting"]
    pool = [q for q, p in sorted(rc["prospects"].items(), key=lambda kv: kv[1]["rank"])
            if rec._group_of(p) == group and q not in skip and rc["status"][q]["committed"] is None
            and not any(q in pids for pids in rc["offers"].values())]
    while True:
        need, commits = rec.needs(st, ME), rec.commits_by_group(st, ME)
        if commits[group] >= rec.group_cap(need, group):
            return
        q = pool.pop(0)
        rc["status"][q].update(committed=ME, firmness=rec.FIRM_START, hard=False)
        rc["commits_v"] = rc.get("commits_v", 0) + 1


if __name__ == "__main__":
    import shutil
    import tempfile
    season.SEASONS_DIR = _Path(tempfile.mkdtemp(prefix="cfp-auto-offers-test-"))
    try:
        sid = api.call("POST", "/api/season", {"team": ME, "mode": "full", "seed": 11, "career": True})["id"]
        st = api.loaded_state()
        rc = st["recruiting"]
        rows = api.call("GET", f"/api/season/{sid}/prospects?stars=3&limit=5000")["rows"]
        rows = [r for r in rows if r["national_rank"] > rec.RIVAL_RANK + 500]
        # the player's case: a low-ranked 3-star, on the board and offered by hand
        mine = rows[-1]["id"]
        group = rec._group_of(rc["prospects"][mine])
        R(sid, "board", {"pid": mine, "on": True})
        R(sid, "recruit", {"pid": mine, "action": "offer", "pitch": "prestige", "nil": 0})
        assert mine in rc["offers"][ME]
        # a second hand offer, to one who then commits elsewhere (ranked past RIVAL_RANK: Auto would let him go)
        gone = next(r["id"] for r in rows[:-1] if rec._group_of(rc["prospects"][r["id"]]) != group)
        R(sid, "board", {"pid": gone, "on": True})
        R(sid, "recruit", {"pid": gone, "action": "offer", "pitch": "prestige", "nil": 0})
        # and offers Auto-recruit made itself (unmarked): one in the same group, one to a prospect committed elsewhere
        auto_same = next(r["id"] for r in rows[:-1] if rec._group_of(rc["prospects"][r["id"]]) == group and r["id"] != gone)
        auto_gone = next(r["id"] for r in rows[:-1] if r["id"] not in (gone, auto_same)
                         and rec._group_of(rc["prospects"][r["id"]]) != group)
        rc["offers"][ME] += [auto_same, auto_gone]
        for q in (gone, auto_gone):
            rc["status"][q].update(committed="michigan", firmness=rec.FIRM_START, hard=False)
        rc["commits_v"] = rc.get("commits_v", 0) + 1
        cap_group(st, group, {mine, auto_same, gone, auto_gone})
        assert rec.group_full(st, ME, group)
        assert R(sid, "settings", {"auto_recruit": "season"})["auto_recruit"] == "season"
        for wk in range(3):
            advance_one(sid)
            st = api.loaded_state()
            rc = st["recruiting"]
            assert st["current_week"] == wk + 1
            offers = rc["offers"][ME]
            assert mine in offers, f"week {wk + 1}: Auto-recruit pulled your offer to {mine}"
            assert mine in rc["board"], f"week {wk + 1}: Auto-recruit took {mine} off your board"
            if not rc["status"][gone]["signed"]:
                assert gone in offers, f"week {wk + 1}: Auto-recruit pulled your offer to one committed elsewhere"
            assert gone in rc["board"]
            if wk == 0:     # Auto-recruit's own offers still go by its rules
                assert auto_same not in offers or rc["status"][auto_same]["committed"] == ME, "an Auto offer in a capped group was kept"
                assert auto_gone not in offers or rc["status"][auto_gone]["committed"] in (None, ME), "an Auto offer to one gone elsewhere was kept"
        assert {mine, gone} <= set(rc["manual_offers"])
        assert not set(rc["manual_offers"]) - set(rc["offers"][ME]), "a mark outlived its offer"
        # a pull by hand clears the mark
        R(sid, "settings", {"auto_recruit": "off"})
        R(sid, "recruit", {"pid": mine, "action": "pull_offer"})
        assert mine not in rc["offers"][ME] and mine not in rc["manual_offers"]
        # a hand offer counts toward the offer limit: full, the next offer is refused
        cap = rec.offer_cap(st, ME)
        spare = [r["id"] for r in rows if r["id"] not in rc["offers"][ME] and not rc["status"][r["id"]]["committed"]
                 and not rc["status"][r["id"]]["signed"]]
        rc["offers"][ME] += spare[:max(0, cap - 1 - len(rc["offers"][ME]))]
        assert len(rc["offers"][ME]) == cap - 1
        last, extra = spare[-1], spare[-2]
        R(sid, "recruit", {"pid": last, "action": "offer", "pitch": "prestige", "nil": 0})
        assert last in rc["manual_offers"] and len(rc["offers"][ME]) == cap
        refused(lambda: R(sid, "recruit", {"pid": extra, "action": "offer", "pitch": "prestige", "nil": 0}), 409)
        # an old save (no mark list) loads and plays: Auto-recruit makes the list lazily
        rc.pop("manual_offers")
        R(sid, "settings", {"auto_recruit": "week"})
        advance_one(sid)
        assert api.loaded_state()["current_week"] == 4
        print("test_auto_manual_offers: ok")
    finally:
        shutil.rmtree(season.SEASONS_DIR, ignore_errors=True)
