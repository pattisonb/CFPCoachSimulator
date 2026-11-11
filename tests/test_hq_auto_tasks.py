"""Recruiting Tasks that tick themselves off (docs/superpowers/plans/2026-11-11-auto-tasks.md): a task added from a
suggestion carries what it asks (`do`); the Headquarters checks it against the recruiting log and ticks it done
(`auto`), keeps a moot one with a note, and never drops a task from your list."""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))

from coach_career import headquarters as hq
from coach_career import recruiting
from sim import season

ME = "iowa"


def fresh():
    st = season.new_season(ME, "full", seed=5, career=True)
    st["current_week"] = 1
    st["recruiting"]["hours"][ME] = 1000
    return st


def open_pids(st, n=5, start=40):
    rc = st["recruiting"]
    out = []
    for pid in sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"])[start:]:
        if not rc["prospects"][pid].get("hidden") and not rc["status"][pid]["committed"]:
            out.append(pid)
        if len(out) == n:
            break
    return out


def add(st, tid, kind, pid, **extra):
    task = {"id": tid, "text": f"Do {kind} for {pid}.", "done": False, "do": {"kind": kind, "pid": pid, **extra}, "since": st["current_week"]}
    hq.set_plan(st, {"tasks": [dict(t) for t in hq.tasks(st)] + [task]})


def task(st, tid):
    return next(t for t in hq.tasks(st) if t["id"] == tid)


def call(st, pid):
    sc = recruiting.act(st, ME, pid, "call")["scene"]
    sc = recruiting.act(st, ME, pid, "present", scene=sc["id"], topics=list(recruiting.PITCHES)[:3])["scene"]
    if sc.get("question"):
        recruiting.act(st, ME, pid, "answer", scene=sc["id"], answer="straight")
    recruiting.act(st, ME, pid, "pitch", pitch="winning", scene=sc["id"])


def test_call_ticks():
    st = fresh()
    pid = open_pids(st, 1)[0]
    add(st, "t1", "call", pid)
    assert not task(st, "t1")["done"]
    call(st, pid)
    t = task(st, "t1")
    assert t["done"] and t["auto"], t


def test_nil_ticks():
    st = fresh()
    pid = next(q for q in open_pids(st, 20) if recruiting.ask_from(st, ME, q) >= 15)
    add(st, "t1", "nil", pid, nil=10)
    recruiting.act(st, ME, pid, "offer", pitch="winning", nil=5)
    assert not task(st, "t1")["done"], "5 of 10 is not done"
    recruiting.act(st, ME, pid, "raise_nil", nil=10)
    assert task(st, "t1")["done"]


def test_scout_ticks():
    st = fresh()
    pid = open_pids(st, 1)[0]
    add(st, "t1", "scout", pid)
    recruiting.act(st, ME, pid, "scout")
    assert task(st, "t1")["done"]


def test_pull_ticks():
    st = fresh()
    pid = open_pids(st, 1)[0]
    recruiting.act(st, ME, pid, "offer", pitch="winning")
    add(st, "t1", "pull", pid)
    assert not task(st, "t1")["done"]
    recruiting.act(st, ME, pid, "pull_offer")
    assert task(st, "t1")["done"]


def test_leave_after_quiet_week():
    st = fresh()
    a, b = open_pids(st, 2)
    add(st, "t1", "leave", a)
    add(st, "t2", "leave", b)
    call(st, b)                                          # you did not leave him alone
    st["current_week"] += 1
    assert task(st, "t1")["done"] and not task(st, "t2")["done"], (task(st, "t1"), task(st, "t2"))


def test_moot_note_keeps_task():
    st = fresh()
    pid = open_pids(st, 1)[0]
    add(st, "t1", "call", pid)
    st["recruiting"]["status"][pid]["committed"] = "ohio-state"
    t = task(st, "t1")
    assert not t["done"] and t["note"].startswith("No longer needed: he committed to") and "Ohio State" in t["note"], t
    assert any(x["id"] == "t1" for x in hq.tasks(st)), "your task never vanishes"


def test_untick_holds():
    st = fresh()
    pid = open_pids(st, 1)[0]
    add(st, "t1", "scout", pid)
    recruiting.act(st, ME, pid, "scout")
    ts = [dict(t) for t in hq.tasks(st)]
    ts[0]["done"] = False
    ts[0]["manual"] = True
    hq.set_plan(st, {"tasks": ts})
    assert not task(st, "t1")["done"], "your untick holds"


def test_plain_task_manual():
    st = fresh()
    hq.set_plan(st, {"tasks": [{"id": "t1", "text": "Watch film.", "done": False}]})
    assert not task(st, "t1")["done"]


def test_bad_do_refused():
    st = fresh()
    try:
        hq.set_plan(st, {"tasks": [{"id": "t1", "text": "x", "done": False, "do": {"kind": "teleport", "pid": "x"}}]})
    except hq.LayoutError:
        return
    raise AssertionError("an unknown kind is refused")


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("hq auto tasks ok: call, NIL, scout, pull and leave tick themselves; a moot task keeps its place with a note; your untick holds")
