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
