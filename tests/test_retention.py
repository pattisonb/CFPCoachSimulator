"""Keep them home (offseason.py): after departures, your players who mean to leave with eligibility
left (portal entrants, early draft entrants) wait on a retention step. You meet them (their ask),
promise a starting role (worth something only if your depth chart would start him), or offer NIL
from your portal pool; when you advance, each stays or goes, the leavers join the portal or the
draft, and the NIL you spent comes off the pool. AI schools keep a would-be entrant who
would start for them a third of the time. (Run as a file: multiprocessing on Windows.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))
import random

from coach_career import offseason, recruiting
from sim import season
from test_offseason import finished

if __name__ == "__main__":
    st = season.new_season("ohio-state", "full", seed=5, career=True)
    finished(st)
    off = offseason.start(st)
    me, lg = st["team"], st["league"]
    assert off["stage"] == "departures"
    offseason.advance(st)
    assert off["stage"] == "retention", off["stage"]
    ret = off["retention"]
    players = ret["players"]
    assert players, "no leavers to talk to"
    roster_ids = {p["id"] for p in lg["teams"][me]["roster"]}
    for e in players:
        assert e["intent"] in ("portal", "draft") and e["reason"] and e["reason_key"] and e["cls"] and e["role_next"] in ("starter", "rotation", "bench")
        assert e["id"] in roster_ids, "a player on the retention step is already off the roster"
        assert e["id"] not in off["portal"]["players"], "a player on the retention step is already in the portal"
        assert not e["ask"]["known"]
    assert any(e["intent"] == "portal" for e in players)
    # the league's other leavers went straight to the portal or the draft; nobody waited for an AI school
    assert all(d["team"] != me or d["kind"] not in ("portal",) for d in off["departures"]), "your portal leavers are already in the departures"
    # meet: his ask shows; a lowball or an offer past the budget is refused
    p0 = next(e for e in players if e["intent"] == "portal")
    v = offseason.retain(st, p0["id"], "meet")
    e0 = next(e for e in v["players"] if e["id"] == p0["id"])
    assert e0["ask"]["known"] and e0["ask"]["kind"] in ("playing_time", "nil") and e0["ask"]["nil"] >= 0
    budget = st["nil_pool"][me]["pool"]
    try:
        offseason.retain(st, p0["id"], "nil", nil=budget + 1); raise AssertionError("NIL past the portal pool")
    except offseason.RetentionError as ex:
        assert ex.code == 400
    # the chances: a met ask keeps him, a hollow promise does not, a first-round pick is gone
    base = {"intent": "portal", "role_next": "bench", "ask": {"kind": "nil", "nil": 40, "known": True}, "offers": {"nil": 0, "promise": False}, "reason_key": "buried", "draft_pick": None}
    assert offseason.stay_chance({**base, "offers": {"nil": 40, "promise": False}}) >= 0.7
    assert offseason.stay_chance({**base, "offers": {"nil": 10, "promise": False}}) <= 0.3        # a lowball
    assert offseason.stay_chance({**base, "ask": {"kind": "playing_time", "nil": 15, "known": True}, "offers": {"nil": 0, "promise": True}}) <= 0.3   # hollow: he would still sit
    assert offseason.stay_chance({**base, "role_next": "starter", "ask": {"kind": "playing_time", "nil": 15, "known": True}, "offers": {"nil": 0, "promise": True}}) >= 0.7
    assert offseason.stay_chance({**base, "intent": "draft", "draft_pick": 12, "offers": {"nil": 200, "promise": True}}) <= 0.12
    assert offseason.stay_chance(base) <= 0.25                                                # nothing offered
    # offers: NIL for one, a promise for another; the rest go
    offseason.retain(st, p0["id"], "nil", nil=e0["ask"]["nil"])
    p1 = next((e for e in players if e["id"] != p0["id"] and e["intent"] == "portal"), None)
    if p1:
        offseason.retain(st, p1["id"], "promise")
    spent = e0["ask"]["nil"]
    offseason.advance(st)
    assert off["stage"] == "portal_w1", off["stage"]
    results = {r["id"]: r for r in off["retention"]["results"]}
    assert set(results) == {e["id"] for e in players} and all(r["status"] in ("stayed", "left") for r in results.values())
    roster_ids = {p["id"] for p in lg["teams"][me]["roster"]}
    rc = st["recruiting"]
    for e in players:
        r = results[e["id"]]
        if r["status"] == "stayed":
            assert e["id"] in roster_ids and e["id"] not in off["portal"]["players"]
            assert next(p for p in lg["teams"][me]["roster"] if p["id"] == e["id"]).get("kept") == off["year"]
        else:
            assert e["id"] not in roster_ids
            if e["intent"] == "portal":
                assert e["id"] in off["portal"]["players"] and e["id"] in rc["prospects"], "a leaver is not in the portal"
            else:
                assert any(d["id"] == e["id"] and d["kind"] in ("draft", "undrafted") for d in off["departures"])
    assert all(e["id"] in roster_ids for e in players if results[e["id"]]["status"] == "stayed")
    # the portal pool carries the NIL you spent (a deal he turned down costs nothing); the portal
    # budget is the pool less that
    spent = spent if results[p0["id"]]["status"] == "stayed" else 0
    assert st["nil_pool"][me]["retained"] == spent
    assert recruiting._nil(st, me)["budget"] == budget - spent
    # on Auto nobody is talked to: every pending leaver goes
    st2 = season.new_season("ohio-state", "full", seed=6, career=True)
    finished(st2)
    off2 = offseason.start(st2)
    offseason.advance(st2)
    n = len(off2["retention"]["players"])
    off2["auto"] = True
    offseason.advance(st2)
    assert n == 0 or all(r["status"] == "left" for r in off2["retention"]["results"])
    # a save from before the step: no retention block at departures goes straight to the portal
    st3 = season.new_season("ohio-state", "full", seed=7, career=True)
    finished(st3)
    off3 = offseason.start(st3)
    off3.pop("retention")
    offseason.advance(st3)
    assert off3["stage"] == "portal_w1" and st3["recruiting"].get("portal")
    season.close_pool()
    print(f"retention ok: {len(players)} leavers to talk to, {sum(1 for r in results.values() if r['status'] == 'stayed')} stayed, {spent} NIL off the portal pool")
