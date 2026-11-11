"""Leftover scouting points (the player's November 11 ask): what you don't spend by the week step your staff spends on
your board, at a Send's price, each a half look (LEFTOVER_LOOK), the least-scouted first, one per prospect a week."""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))

from coach_career import recruiting

ME = "iowa"


def fresh(n=3):
    from sim import season
    st = season.new_season(ME, "full", seed=5, career=True)
    st["current_week"] = 1
    rc = st["recruiting"]
    pids = [q for q in sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"])[60:] if not rc["prospects"][q].get("hidden")][:n]
    rc["board"] = list(pids)
    return st, pids


def looks(st, pid):
    return (st["recruiting"]["reads"].get(pid) or {}).get("looks", 0) or 0


def test_leftover_buys_half_looks():
    st, pids = fresh()
    cost = sum(recruiting.look_cost(st, ME, q) for q in pids)
    st["recruiting"]["scout_points"][ME] = cost
    spent = recruiting.spend_leftover(st, 2)
    assert spent == cost and all(looks(st, q) == recruiting.LEFTOVER_LOOK for q in pids), [looks(st, q) for q in pids]


def test_short_points_least_scouted_first():
    st, (a, b, c) = fresh()
    st["recruiting"]["reads"][a] = {"looks": 1.0, "area": 0.0, "by": {}, "g": {}}
    st["recruiting"]["scout_points"][ME] = recruiting.look_cost(st, ME, b)
    recruiting.spend_leftover(st, 2)
    assert looks(st, b) == recruiting.LEFTOVER_LOOK and looks(st, a) == 1.0 and looks(st, c) == 0, "one Send's worth: the least-scouted, by rank"


def test_nothing_left_nothing_done():
    st, pids = fresh()
    st["recruiting"]["scout_points"][ME] = 0
    assert recruiting.spend_leftover(st, 2) == 0 and all(looks(st, q) == 0 for q in pids)


def test_complete_report_skipped():
    st, (a, b, c) = fresh()
    st["recruiting"]["reads"][a] = {"looks": float(recruiting.REPORT_LOOKS), "area": 0.0, "by": {}, "g": {}}
    st["recruiting"]["scout_points"][ME] = 1000
    recruiting.spend_leftover(st, 2)
    assert looks(st, a) == recruiting.REPORT_LOOKS and looks(st, b) == looks(st, c) == recruiting.LEFTOVER_LOOK, "one per prospect a week; a full report needs none"


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("leftover scouting ok: unspent points become half looks on your board, least-scouted first, one each a week")
