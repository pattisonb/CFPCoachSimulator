"""Discovery (persona.py): his personality and decider start Not Known Yet and are learned by scouting
(the decider, at 2 looks) and talking (the personality, at the school's first call; Guarded: first in-home visit)."""
import os
os.environ["CFP_CLEAR"] = "0"     # the word-mode screens and conversations Clear Mode replaces (tests/test_clear_mode.py covers Clear Mode)
import random
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))

from coach_career import persona, prospects, recruiting
from sim import season

ME = "ohio-state"


def fresh(seed=5):
    st = season.new_season(ME, "full", seed=seed, career=True)
    st["current_week"] = 1
    st["recruiting"]["hours"][ME] = 1000
    return st


def pick(st):
    rc = st["recruiting"]
    for pid in sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"]):
        p = rc["prospects"][pid]
        if not p.get("hidden") and not rc["status"][pid]["committed"] and ME not in rc["lists"][pid]:
            return pid
    raise AssertionError("no prospect")


def force(st, pid, personality, decider="mom", topic="proximity"):
    st["recruiting"]["prospects"][pid]["persona"] = {"personality": personality, "decider": decider, "decider_topic": topic}


def test_unknown_at_start():
    st = fresh()
    pid = pick(st)
    v = persona.view(st, ME, pid)
    assert {k: v[k] for k in ("personality", "decider", "decider_topic")} == {"personality": None, "decider": None, "decider_topic": None}
    assert prospects.profile(st, pid, ME)["traits"]["personality"] is None
    assert prospects.board_row(st, pid, ME)["traits"]["decider"] is None


def test_decider_after_two_looks():
    st = fresh()
    pid = pick(st)
    force(st, pid, "business", "mom", "academics")
    rng = random.Random(1)
    recruiting.look(st, pid, 70, rng, weight=1.0)
    assert persona.view(st, ME, pid)["decider"] is None
    recruiting.look(st, pid, 70, rng, by="scout-1", weight=1.0)
    v = persona.view(st, ME, pid)
    assert {k: v[k] for k in ("personality", "decider", "decider_topic")} == {"personality": None, "decider": "Mom", "decider_topic": "academics"}, v


def test_personality_after_first_call():
    st = fresh()
    pid = pick(st)
    force(st, pid, "cocky")
    recruiting.act(st, ME, pid, "message")
    assert persona.view(st, ME, pid)["personality"] is None
    recruiting.act(st, ME, pid, "call")                  # the call opens a scene: still the first call
    assert persona.view(st, ME, pid)["personality"] == "Cocky"
    shy = pick_other(st, pid)
    force(st, shy, "shy")
    recruiting.act(st, ME, shy, "call")
    assert persona.view(st, ME, shy)["personality"] == "Shy"


def pick_other(st, not_pid):
    rc = st["recruiting"]
    for pid in sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"]):
        p = rc["prospects"][pid]
        if pid != not_pid and not p.get("hidden") and not rc["status"][pid]["committed"] and ME not in rc["lists"][pid]:
            return pid
    raise AssertionError("no prospect")


def test_guarded_needs_visit():
    st = fresh()
    pid = pick(st)
    force(st, pid, "guarded")
    recruiting.act(st, ME, pid, "call", "prestige")
    assert persona.view(st, ME, pid)["personality"] is None
    st["current_week"] = 2
    recruiting.act(st, ME, pid, "hc_visit")
    assert persona.view(st, ME, pid)["personality"] == "Guarded"


def test_first_visit_reveals_anyone():
    st = fresh()
    pid = pick(st)
    force(st, pid, "cocky")
    recruiting.act(st, ME, pid, "hc_visit", "prestige")
    assert persona.view(st, ME, pid)["personality"] == "Cocky"


def test_area_half_looks_reach_decider():
    st = fresh()
    pid = pick(st)
    force(st, pid, "business", "dad", "nil")
    rng = random.Random(3)
    for i in range(3):
        recruiting.look(st, pid, 70, rng, by="scout-1", weight=0.5)
    assert persona.view(st, ME, pid)["decider"] is None
    recruiting.look(st, pid, 70, rng, by="scout-1", weight=0.5)
    assert persona.view(st, ME, pid)["decider"] == "Dad"


def test_reveals_are_per_school():
    st = fresh()
    pid = pick(st)
    force(st, pid, "cocky")
    other = "alabama"
    st["recruiting"]["hours"][other] = 1000
    recruiting._act(st, other, pid, "call")
    assert persona.view(st, ME, pid)["personality"] is None
    assert not persona.known(st, ME, pid)["personality"]
    assert not persona.learn(st, other, pid, "decider")
    k = persona.known(st, ME, pid)
    assert (k["personality"], k["decider"]) == (False, False), k


def test_history_logs_learned():
    st = fresh()
    pid = pick(st)
    force(st, pid, "business", "mom")
    recruiting.act(st, ME, pid, "call")
    rng = random.Random(2)
    recruiting.look(st, pid, 70, rng, weight=1.0)
    recruiting.look(st, pid, 70, rng, weight=1.0)
    recruiting.look(st, pid, 70, rng, weight=1.0)       # a third look learns nothing new
    lines = [e["line"] for e in prospects.board_row(st, pid, ME)["history"] if e["kind"] == "learned"]
    assert sorted(lines) == ["Your staff learned he's all business.", "Your staff learned his mom has the final say."], lines
    for ln in lines:
        assert ln[0].isupper() and ln.endswith(".")


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
    print("persona discovery tests passed")
