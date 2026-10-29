"""The coaching market (coach_career/carousel.py): the league keeps a pool of named coaches for hire
(fired and let-go coaches, plus a generated supply), every opening around the league is filled from
it or from sitting coaches, nobody holds two jobs, a coach fired this offseason sits in the pool,
and your own openings offer the market's coaches with why each is available. (Run as a file:
multiprocessing on Windows.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))
import collections

from coach_career import carousel, offseason
from sim import season
from test_offseason import finished


def to_stage(st, stage):
    st["offseason"]["auto"] = True
    while st["offseason"]["stage"] != stage:
        offseason.advance(st)


def test_your_coordinators_can_leave():
    """Your staff is in the carousel like everyone else's: a coordinator can move on for a bigger
    job (COORD_MOVE), and a strong program can hire him as its head coach; either way his job
    opens at your Staff step with the reason and five candidates."""
    import random
    # 1. moving on: with the roll certain, both your coordinators leave and the Staff step says why
    saved = carousel.COORD_MOVE
    carousel.COORD_MOVE = 1.0
    try:
        st = season.new_season("ohio-state", "full", seed=5, career=True)
        finished(st)
        offseason.start(st)
        to_stage(st, "staff")
        car = st["offseason"]["carousel"]
        assert sorted(car["poached"]) == ["defensive_coordinator", "offensive_coordinator"], car["poached"]
        mine = [c for c in car["changes"] if c["team"] == "ohio-state" and c["role"] != "head_coach"]
        assert mine and all(c["reason"] == "moved on" or c["reason"].startswith("left for") for c in mine), mine
        view = offseason.view(st)["staff"]
        left = {w["role"] for w in view["leaving"]}
        assert {"OC", "DC"} <= left, left
        for w in view["leaving"]:
            if w["role"] in ("OC", "DC"):
                assert "bigger job" in view["reasons"][w["id"]] or "hired away as the head coach at" in view["reasons"][w["id"]], view["reasons"]
                assert len(view["candidates"][w["id"]]) == offseason.STAFF_CANDIDATES
    finally:
        carousel.COORD_MOVE = saved
    # 2. hired away: your coordinator is in the candidate pool for another program's head coaching job
    st = season.new_season("ohio-state", "full", seed=5, career=True)
    finished(st)
    offseason.start(st)
    lg = st["league"]
    me, year = st["team"], st["offseason"]["year"]
    res = carousel._results(st)
    res[me].update(wins=13, losses=1)
    verdicts = {slug: carousel.judge(t, slug, res.get(slug, {"wins": 0, "losses": 0}), year, st) for slug, t in lg["teams"].items()}
    oc = lg["teams"][me]["coaches"]["offensive_coordinator"]
    oc["ratings"] = {k: 99 for k in oc["ratings"]}
    saved = carousel.HC_MOVE_PCT, carousel.COORD_UP
    carousel.HC_MOVE_PCT, carousel.COORD_UP = 2.0, -999          # no sitting head coach qualifies; any program may call
    try:
        hire, src = carousel._pick_head_coach(st, "akron", verdicts, res, {}, random.Random(1), year, set())
    finally:
        carousel.HC_MOVE_PCT, carousel.COORD_UP = saved
    assert src.get("kind") == "coordinator" and src.get("team") == me and hire["name"] == oc["name"], (hire["name"], src)
    assert not lg["teams"][me]["coaches"]["offensive_coordinator"].get("vacant")      # the pool check mutates nothing
    print("your coordinators can leave: gone at the Staff step with the reason; a 99 coordinator of yours is hired away")


if __name__ == "__main__":
    st = season.new_season("ohio-state", "full", seed=5, career=True)
    finished(st)
    off = offseason.start(st)
    lg = st["league"]
    teams_of = lambda: {n: {s_ for s_, t in lg["teams"].items() for c in t["coaches"].values() if c and c["name"] == n}
                        for t in lg["teams"].values() for c in t["coaches"].values() if c for n in [c["name"]]}
    two_before = {n for n, k in teams_of().items() if len(k) > 1}       # the real data's own doubles
    market = carousel.market(st)
    assert 100 <= len(market["coaches"]) <= 260, len(market["coaches"])
    for c in market["coaches"][:20]:
        assert c["name"] and c["roles"] and c["ratings"] and c["why"] and "history" in c and c["age"] >= 30, c
    to_stage(st, "staff")
    car = off["carousel"]
    changes = car["changes"]
    fired = [c["old"] for c in changes if c["role"] == "head_coach" and c["reason"] == "fired"]
    coord_let_go = [c["old"] for c in changes if c["role"] != "head_coach" and c["reason"] in ("fired", "moved on", "let go")]
    names_in_market = {c["name"] for c in market["coaches"]}
    assert fired and all(n in names_in_market for n in fired), [n for n in fired if n not in names_in_market]
    placed = {c["new"] for c in changes if c["reason"] == "hired"}          # a let-go coordinator can land at once
    assert all(n in names_in_market or n in placed for n in coord_let_go if n), [n for n in coord_let_go if n and n not in names_in_market | placed]
    # nobody is on two staffs (a head coach calling his own plays is one job); a coach hired this
    # offseason is out of the pool
    jobs = teams_of()
    assert not [n for n, k in jobs.items() if len(k) > 1 and n not in two_before], [n for n, k in jobs.items() if len(k) > 1 and n not in two_before]
    assert not (set(jobs) & names_in_market - two_before), list(set(jobs) & names_in_market - two_before)[:5]
    hires = [c for c in changes if c["reason"] == "hired"]
    assert hires and all(c.get("from") for c in hires), "a hire without where he came from"
    assert any(c["role"] != "head_coach" and c.get("from_market") for c in hires), "no coordinator hired from the market"
    assert len(fired) >= 3, len(fired)
    # your openings offer the market: each candidate says why he is available and what he did
    staff = off["staff"]
    if not any(i in ("oc", "dc") for i in staff["leaving"]):
        before = len(carousel.market(st)["coaches"])
        staff.update(offseason.open_role(st, "oc"))
        assert len(carousel.market(st)["coaches"]) == before + 1, "the coordinator you let go is not in the market"
    sid = next(i for i in staff["leaving"] if i in ("oc", "dc"))
    cands = staff["candidates"][sid]
    assert len(cands) >= 4 and all(c.get("why") and c.get("previous_job") for c in cands), cands[0]
    assert any(c.get("from_market") for c in cands)
    pick = next(i for i, c in enumerate(cands) if c.get("from_market"))
    offseason.hire(st, sid, pick)
    offseason.advance(st)
    key = {"oc": "offensive_coordinator", "dc": "defensive_coordinator"}[sid]
    mine = lg["teams"][st["team"]]["coaches"][key]
    assert mine["name"] == cands[pick]["name"] and mine["since"] == off["year"] and "play_calling" in mine["ratings"], mine
    assert cands[pick]["name"] not in {c["name"] for c in carousel.market(st)["coaches"]}, "hired, still for hire"
    season.close_pool()
    print(f"coach market ok: {len(market['coaches'])} coaches for hire, {len(fired)} head coaches fired, {len(hires)} hires")
    test_your_coordinators_can_leave()
