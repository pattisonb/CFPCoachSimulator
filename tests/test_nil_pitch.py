"""The NIL pitch before money is on the table (docs/superpowers/plans/2026-11-10-nil-pitch-before-money.md):
until NIL is attached, the NIL strength reads what the school could pay him (its NIL room against his ask), not
0 after an offer and not the program's tier before one; the page's grade reads the ask as the player knows it.
Task 2: pitching NIL with nothing attached is a money promise, kept or broken at the week step."""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))

from coach_career import recruiting
from sim import season

ME = "iowa"


def fresh(team=ME, seed=5):
    st = season.new_season(team, "full", seed=seed, career=True)
    st["current_week"] = 1
    st["recruiting"]["hours"][team] = 1000
    return st


def ranked(st):
    rc = st["recruiting"]
    return [pid for pid in sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"])
            if not rc["prospects"][pid].get("hidden") and not rc["status"][pid]["committed"]]


def room(st, slug, pid):
    held = st["recruiting"]["nil"].get(slug, {}).get("held", {}).get(pid, 0)
    return recruiting.nil_left(st, slug) + held


def test_offer_without_nil_reads_room():
    st = fresh()
    pid = ranked(st)[60]
    recruiting.act(st, ME, pid, "offer", pitch="winning")
    ask = recruiting.ask_from(st, ME, pid)
    want = round(min(1.0, room(st, ME, pid) / ask), 3) if ask else 1.0
    got = recruiting.strengths(st, ME, pid)["nil"]
    assert got == want and got > 0, (got, want, ask)


def test_before_offer_reads_room_not_tier():
    st = fresh("tulane")
    pid = ranked(st)[0]
    ask = recruiting.ask_from(st, "tulane", pid)
    if room(st, "tulane", pid) >= ask:
        assert recruiting.strengths(st, "tulane", pid)["nil"] == 1.0
    # spend the room elsewhere: the same school, nothing left, reads Weak for him
    rec = recruiting._nil(st, "tulane")
    rec["held"]["__elsewhere__"] = recruiting.nil_left(st, "tulane")
    assert recruiting.strengths(st, "tulane", pid)["nil"] < 0.25


def test_attached_reads_the_deal():
    st = fresh()
    pid = ranked(st)[60]
    ask = recruiting.ask_from(st, ME, pid)
    nil = recruiting._five(ask / 2)
    recruiting.act(st, ME, pid, "offer", pitch="winning", nil=nil)
    assert abs(recruiting.strengths(st, ME, pid)["nil"] - min(1.0, nil / ask)) < 0.01


def test_spent_budget_is_weak():
    st = fresh()
    pid = ranked(st)[60]
    rec = recruiting._nil(st, ME)
    rec["held"]["__elsewhere__"] = recruiting.nil_left(st, ME)
    assert recruiting.strengths(st, ME, pid)["nil"] == 0.0


def test_known_hides_the_ask():
    st = fresh()
    rc = st["recruiting"]
    by_range = {}
    for pid in ranked(st)[:400]:
        v = recruiting.ask_view(st, ME, pid)
        by_range.setdefault((v.get("lo"), v.get("hi")), []).append(pid)
    pair = next((ps for ps in by_range.values() if len({recruiting.ask_from(st, ME, q) for q in ps}) > 1), None)
    assert pair, "two prospects sharing a range with different asks"
    words = {recruiting.strengths(st, ME, q, known=True)["nil"] for q in pair}
    assert len(words) == 1, words


if __name__ == "__main__":
    test_offer_without_nil_reads_room()
    test_before_offer_reads_room_not_tier()
    test_attached_reads_the_deal()
    test_spent_budget_is_weak()
    test_known_hides_the_ask()
    print("nil pitch ok: unattached NIL reads the room against his ask; attached reads the deal; the page reads the ask you know")
