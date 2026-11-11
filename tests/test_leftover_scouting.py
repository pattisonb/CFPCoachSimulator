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


def test_untouched_week_spends_the_full_points():
    """A week you never opened the board (Sim to Signing Day, Auto-recruit): all the week's points were left over."""
    st, pids = fresh()
    st["recruiting"]["scout_points"] = {}
    spent = recruiting.spend_leftover(st, 2)
    assert spent > 0 and all(looks(st, q) == recruiting.LEFTOVER_LOOK for q in pids), (spent, [looks(st, q) for q in pids])


def test_marks_index_once():
    """Pitch marks for a whole board read the log once (an index), not once per row."""
    st, pids = fresh()
    rc = st["recruiting"]
    rc["log"].append({"week": 1, "kind": "pitch", "pid": pids[0], "school": ME, "action": "call", "pitch": "nil", "reaction": "polite"})
    calls = []
    real = recruiting._marks_index
    recruiting._marks_index = lambda *a: calls.append(1) or real(*a)
    try:
        for q in pids:
            recruiting.pitch_marks(st, ME, q)
    finally:
        recruiting._marks_index = real
    assert len(calls) == 1, f"the log is read once for the board, not {len(calls)} times"
    assert recruiting.pitch_marks(st, ME, pids[0])["nil"]["mark"] == "not_his"
    rc["log"].append({"week": 1, "kind": "pitch", "pid": pids[1], "school": ME, "action": "call", "pitch": "coach", "reaction": "hit"})
    assert recruiting.pitch_marks(st, ME, pids[1])["coach"]["mark"] == "hit", "a new log line is read"


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("leftover scouting ok: unspent points become half looks on your board, least-scouted first, one each a week")
