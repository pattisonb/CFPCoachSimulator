"""Portal reasons fit the role (offseason._retention_entries): a starter never "has no starting role in
sight"; a starter gets deal / last_year / fresh_start; a benched player behind someone is "buried" and
names him. (Run as a file: multiprocessing on Windows.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))

from coach_career import offseason
from sim import season
from test_offseason import finished

TEXT = {"deal": "Chasing a bigger NIL deal", "last_year": "One year left and he wants a bigger stage", "fresh_start": "Wants a fresh start"}


def entry(st, p, use, **item):
    ev = {"id": p["id"], "name": p["n"], "pos": p["pos"], "cls": p["cls"], "kind": "portal"}
    base = {"ev": ev, "use": use, "losing": False, "winning": True, "p4": True}
    return offseason._retention_entries(st, st["league"], [{**base, **item}])[0]


def with_cls(p, cls):
    p["cls"] = cls                                  # entries read the roster row, whose class is already next year's
    return p


if __name__ == "__main__":
    st = season.new_season("ohio-state", "full", seed=5, career=True)
    finished(st)
    off = offseason.start(st)
    offseason.advance(st)
    # the real step: no starter is "restless"
    assert all(not (e["role_now"] == "starter" and e["reason_key"] == "restless") for e in off["retention"]["players"])
    roster = st["league"]["teams"][st["team"]]["roster"]
    guards = [q for q in roster if q["pos"] in ("G", "OG", "RG")] or [q for q in roster if q["pos"] in ("OL", "T", "OT", "C")] or roster
    p = max(guards, key=lambda q: q["o"])
    # a starter who leaves on the base portal chance, on a winning P4 team (the row's cls is next year's class)
    for cls, key in (("JR", "deal"), ("SO", "deal"), ("SR", "last_year"), ("SRRS", "last_year")):
        e = entry(st, with_cls(p, cls), "starter")
        assert e["role_now"] == "starter" and e["reason_key"] == key and e["reason"] == TEXT[key], (cls, e["reason_key"], e["reason"])
    e = entry(st, with_cls(p, "JR"), "starter", winning=False)          # .500: neither winning nor losing
    assert e["reason_key"] == "fresh_start" and e["reason"] == TEXT["fresh_start"], e["reason_key"]
    assert entry(st, with_cls(p, "JR"), "starter", losing=True, winning=False)["reason_key"] == "losing"
    # a bench player behind someone is buried, naming him
    ahead = max((q for q in roster if q["pos"] == p["pos"] and q["id"] != "x-bench"), key=lambda q: q["o"])
    low = dict(p, o=1, id="x-bench", n="Backup Guy")
    roster.append(low)
    try:
        e = entry(st, low, "bench")
        assert e["reason_key"] == "buried" and e["reason"] == f"Buried on the depth chart behind {ahead['n']}", e["reason"]
        # no one ahead of him (he is the best at the position) and benched: restless is still allowed, never for a starter
        best = dict(ahead, id="x-best", o=999)
        roster.append(best)
        e = entry(st, best, "bench")
        assert e["reason_key"] == "restless", e["reason_key"]
        roster.remove(best)
    finally:
        roster.remove(low)
    season.close_pool()
    print("ok")
