"""Pitch marks: what he said about each topic you pitched him, so you don't keep pitching a dud. He Lit Up (a priority,
your case strong), Weak Case (he cares, your case weak), Not His Thing (polite: not a priority), No Read (guarded or tired,
or presented in your opening with no read on the topic). No mark: never pitched. The latest real read wins; a No Read
never hides one."""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))

from coach_career import prospects, recruiting

ME = "iowa"


def fresh():
    from sim import season
    st = season.new_season(ME, "full", seed=5, career=True)
    st["current_week"] = 1
    return st


def log(st, pid, kind, **kw):
    st["recruiting"]["log"].append({"week": kw.pop("week", st["current_week"]), "kind": kind, "pid": pid, "school": kw.pop("school", ME), **kw})


def test_marks_from_the_log():
    st = fresh()
    pid = next(iter(st["recruiting"]["prospects"]))
    assert recruiting.pitch_marks(st, ME, pid) == {}, "never pitched: no marks"
    log(st, pid, "pitch", action="call", pitch="nil", reaction="polite", week=2)
    log(st, pid, "pitch", action="call", pitch="coach", reaction="quiet", week=3)
    log(st, pid, "pitch", action="call", pitch="winning", reaction="guarded", week=3)
    log(st, pid, "pitch", action="call", pitch="winning", reaction="hit", week=4)
    log(st, pid, "pitch", action="call", pitch="prestige", reaction="hit", week=4)
    log(st, pid, "pitch", action="call", pitch="prestige", reaction="tired", week=5)
    log(st, pid, "present", action="call", topics=["proximity", "nil", "pro"], week=5)
    log(st, pid, "pitch", action="call", pitch="academics", reaction="polite", school="ohio-state")   # another school's: not yours
    m = recruiting.pitch_marks(st, ME, pid)
    assert {t: v["mark"] for t, v in m.items()} == {"nil": "not_his", "coach": "weak", "winning": "hit", "prestige": "hit",
                                                    "proximity": "no_read", "pro": "no_read"}, m
    assert m["nil"]["week"] == 2 and m["coach"]["action"] == "call"


def test_latest_real_read_wins():
    st = fresh()
    pid = next(iter(st["recruiting"]["prospects"]))
    log(st, pid, "pitch", action="call", pitch="coach", reaction="quiet", week=2)
    log(st, pid, "pitch", action="hc_visit", pitch="coach", reaction="hit", week=6)
    assert recruiting.pitch_marks(st, ME, pid)["coach"]["mark"] == "hit"


def test_on_the_payload():
    st = fresh()
    pid = next(iter(st["recruiting"]["prospects"]))
    log(st, pid, "pitch", action="call", pitch="nil", reaction="polite")
    assert prospects.profile(st, pid, ME)["public"]["pitch_marks"]["nil"]["mark"] == "not_his"
    assert prospects.board_row(st, pid, ME)["pitch_marks"]["nil"]["mark"] == "not_his"


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("pitch marks ok: hit, weak case, not his thing, no read; the latest real read wins; on the payload")
