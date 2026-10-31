"""A stale offseason click (app/api.py): every offseason POST takes an optional `stage`, the stage the
page drew. When it is not the offseason's stage any more (an Advance landed first, or the season
rolled over) the call is a 409 "The offseason has moved on: this was for {stage}." and changes
nothing; without `stage` old callers work as before. (Run as a file.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))
import copy
import json

from app import api
from sim import season
from tests.test_offseason import finished

ME = "ohio-state"


def post(sid: str, what: str, body: dict) -> dict:
    return api.call("POST", f"/api/season/{sid}/offseason/{what}", body)


def refused(sid: str, what: str, body: dict, stage_name: str) -> None:
    """The call is a 409 naming the stage it was for, and the offseason is byte-for-byte as it was."""
    st = api.loaded_state()
    before = json.dumps(st.get("offseason"), sort_keys=True, default=str)
    roster = json.dumps(st["league"]["teams"][ME]["roster"], sort_keys=True, default=str)
    try:
        post(sid, what, body)
        raise AssertionError(f"{what} with stage {body.get('stage')} went through")
    except api.ApiError as e:
        assert e.status == 409, (what, e.status, e.message)
        assert e.message == f"The offseason has moved on: this was for {stage_name}.", e.message
    st = api.loaded_state()
    assert json.dumps(st.get("offseason"), sort_keys=True, default=str) == before, f"a refused {what} changed the offseason"
    assert json.dumps(st["league"]["teams"][ME]["roster"], sort_keys=True, default=str) == roster, f"a refused {what} changed the roster"


if __name__ == "__main__":
    import shutil
    import tempfile
    season.SEASONS_DIR = _Path(tempfile.mkdtemp(prefix="cfp-offseason-stale-"))
    try:
        sid = api.call("POST", "/api/season", {"team": ME, "mode": "full", "seed": 5, "career": True})["id"]
        finished(api.loaded_state()); api._save_loaded()
        v = api.call("GET", f"/api/season/{sid}/offseason")
        assert v["stage"] == "departures"
        rs = v["redshirts"]["players"]
        assert rs, "seed 5 has a redshirt call to make"
        p0 = dict(rs[0])                        # a copy: the native view shares its dicts with the state
        # the current stage: the action works
        v = post(sid, "redshirt", {"pid": p0["id"], "on": not p0["redshirt"], "stage": "departures"})
        now = next(p for p in v["redshirts"]["players"] if p["id"] == p0["id"])["redshirt"]
        assert now == (not p0["redshirt"])
        # no stage: an old caller still works
        v = post(sid, "redshirt", {"pid": p0["id"], "on": p0["redshirt"]})
        assert next(p for p in v["redshirts"]["players"] if p["id"] == p0["id"])["redshirt"] == p0["redshirt"]
        # a stage the offseason is not at (a page a step behind or ahead): refused, nothing changes
        refused(sid, "redshirt", {"pid": p0["id"], "on": not p0["redshirt"], "stage": "retention"}, "Keep Them Home")
        refused(sid, "redshirt", {"pid": p0["id"], "on": True, "stage": "nonsense"}, "an earlier stage")

        # a double-clicked Advance: the first moves on, the second (drawn on Departures) is refused
        v = post(sid, "advance", {"stage": "departures"})
        nxt = v["stage"]
        assert nxt in ("retention", "portal_w1"), nxt
        refused(sid, "advance", {"stage": "departures"}, "Departures")
        assert api.loaded_state()["offseason"]["stage"] == nxt, "the stale Advance skipped a stage"
        # a Departures action queued behind the advance lands nowhere
        refused(sid, "redshirt", {"pid": p0["id"], "on": not p0["redshirt"], "stage": "departures"}, "Departures")
        refused(sid, "position", {"pid": p0["id"], "pos": "QB", "stage": "departures"}, "Departures")
        if nxt == "retention":
            ret = api.loaded_state()["offseason"]["retention"]["players"]
            e0 = ret[0]
            v = post(sid, "retain", {"pid": e0["id"], "action": "meet", "stage": "retention"})       # the current stage works
            assert next(e for e in v["retention"]["players"] if e["id"] == e0["id"])["ask"]["known"]
            post(sid, "advance", {"stage": "retention"})
            refused(sid, "retain", {"pid": e0["id"], "action": "promise", "stage": "retention"}, "Keep Them Home")
        assert api.loaded_state()["offseason"]["stage"] == "portal_w1"
        # every other offseason POST checks the stage too
        for what, body in (("portal", {"pid": "x", "on": True}), ("review", {"action": "accept"}), ("job", {"team": None}),
                           ("hire", {"staff_id": "x", "index": 0}), ("open_role", {"staff_id": "x"})):
            refused(sid, what, {**body, "stage": "departures"}, "Departures")

        # Sim to Next Season, then a click left over from the offseason: refused cleanly, no crash,
        # and the new season is untouched (no offseason opened on it)
        r = post(sid, "advance", {"to": "next_season", "stage": "portal_w1"})
        assert r["next_season"] is True
        st = api.loaded_state()
        assert not st.get("done") and not st.get("offseason")
        snapshot = copy.deepcopy(st["league"]["teams"][ME]["roster"])
        for what, body in (("redshirt", {"pid": p0["id"], "on": True, "stage": "portal_w1"}), ("advance", {"stage": "portal_w1"}),
                           ("advance", {"to": "next_season", "stage": "ready"})):
            try:
                post(sid, what, body)
                raise AssertionError(f"{what} after the season rolled over went through")
            except api.ApiError as e:
                assert e.status in (404, 409), (what, e.status)
                assert "moved on" in e.message, e.message
        # an old caller (no stage) gets the old answer: the season is not over
        try:
            post(sid, "advance", {})
            raise AssertionError("advance during the season went through")
        except api.ApiError as e:
            assert e.status == 409 and e.message == "the season is not over", e.message
        st = api.loaded_state()
        assert not st.get("offseason") and st["league"]["teams"][ME]["roster"] == snapshot
        print("offseason stale: ok")
    finally:
        shutil.rmtree(season.SEASONS_DIR, ignore_errors=True)
