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


def test_strength_reads_open_nothing():
    """A strength read (the page's or a school's that never touched him) opens no contact and no NIL record."""
    st = fresh()
    rc = st["recruiting"]
    pid = ranked(st)[90]
    before = (pid in rc["contacts"] and "tulane" in rc["contacts"][pid], "tulane" in rc["nil"])
    recruiting.strengths(st, "tulane", pid)
    recruiting.strengths(st, "tulane", pid, known=True)
    assert (pid in rc["contacts"] and "tulane" in rc["contacts"][pid], "tulane" in rc["nil"]) == before == (False, False)


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


# ----- Task 2: talking money is a promise -----

def cares(st, pid, topic):
    """Make NIL (or not) one of his priorities for the test."""
    p = st["recruiting"]["prospects"][pid]
    rest = [t for t in p["priorities"] if t != "nil"]
    p["priorities"] = (["nil"] + rest)[:3] if topic else [t for t in recruiting.PITCHES if t != "nil"][:3]
    from coach_career import persona
    persona.of(st, pid)["decider_topic"] = None


def money_pitch(st, pid):
    """A call: present, answer if he asks, then pitch NIL. The reaction."""
    sc = recruiting.act(st, ME, pid, "call")["scene"]
    sc = recruiting.act(st, ME, pid, "present", scene=sc["id"], topics=list(recruiting.PITCHES)[:3])["scene"]
    if sc.get("question"):
        recruiting.act(st, ME, pid, "answer", scene=sc["id"], answer="straight")
    return recruiting.act(st, ME, pid, "pitch", pitch="nil", scene=sc["id"])


def promises(st, pid):
    return [pr for pr in (st["recruiting"]["contacts"][pid][ME].get("promises") or []) if pr["kind"] == "money"]


def nil_target(st, pid, n=40):
    """A prospect with a real ask, NIL his priority, offered with nothing held."""
    for q in ranked(st)[n:n + 60]:
        if recruiting.ask_from(st, ME, q) >= 15:
            cares(st, q, True)
            recruiting.act(st, ME, q, "offer", pitch="winning")
            return q
    raise AssertionError("no prospect with an ask")


def test_nil_pitch_opens_money_promise():
    st = fresh()
    pid = nil_target(st, None)
    before = sum(st["recruiting"]["lists"][pid].values())
    r = money_pitch(st, pid)
    assert len(promises(st, pid)) == 1, promises(st, pid)
    assert "exact" in recruiting.ask_view(st, ME, pid), "he named his number"
    assert r["reaction"]["kind"] != "quiet", r["reaction"]
    ask = recruiting.ask_from(st, ME, pid)
    assert any(e.get("line") == f"He told you he's looking for {ask} in NIL." for e in st["recruiting"]["log"] if e["pid"] == pid), "the History line"


def test_money_promise_kept():
    st = fresh()
    pid = nil_target(st, None)
    money_pitch(st, pid)
    ask = recruiting.ask_from(st, ME, pid)
    need = recruiting._five(recruiting.NIL_PROMISE_SHARE * ask + 2.4)
    rec = recruiting._nil(st, ME)
    rec["held"][pid] = need
    recruiting._promises(st, st["current_week"] + 1)
    pr = promises(st, pid)[0]
    assert pr["kept"] is not None and pr["broken"] is None, pr
    assert any(e["kind"] == "promise_kept" and e["pid"] == pid for e in st["recruiting"]["log"])


def test_money_promise_broken():
    st = fresh()
    pid = nil_target(st, None)
    money_pitch(st, pid)
    wk = st["current_week"]
    for w in range(wk + 1, wk + 1 + recruiting.NIL_PROMISE_WEEKS):
        recruiting._promises(st, w)
    pr = promises(st, pid)[0]
    assert pr["broken"] is not None, pr
    assert st["recruiting"]["contacts"][pid][ME].get("cooled_until"), "he cools on you"
    ev = [e for e in st["recruiting"]["log"] if e["kind"] == "promise_broken" and e["pid"] == pid]
    assert ev and ev[-1].get("why") == "money", ev


def test_money_promise_closed_on_commit_elsewhere():
    st = fresh()
    pid = nil_target(st, None)
    money_pitch(st, pid)
    st["recruiting"]["status"][pid]["committed"] = "ohio-state"
    wk = st["current_week"]
    for w in range(wk + 1, wk + 2 + recruiting.NIL_PROMISE_WEEKS):
        recruiting._promises(st, w)
    pr = promises(st, pid)[0]
    assert pr["broken"] is None and pr["kept"] is None and pr.get("closed") is not None, pr
    assert not [e for e in st["recruiting"]["log"] if e["kind"] == "promise_broken" and e["pid"] == pid]


def test_non_nil_prospect_says_so():
    st = fresh()
    pid = nil_target(st, None)
    cares(st, pid, False)
    r = money_pitch(st, pid)
    assert not promises(st, pid)
    assert r["reaction"]["text"] == "The money isn't what this is about for me." or r["reaction"]["kind"] == "guarded", r["reaction"]


def test_zero_ask_no_promise():
    st = fresh()
    pid = next(q for q in reversed(ranked(st)) if recruiting.ask_from(st, ME, q) == 0)
    cares(st, pid, True)
    recruiting.act(st, ME, pid, "offer", pitch="winning")
    money_pitch(st, pid)
    assert not promises(st, pid)


if __name__ == "__main__":
    test_offer_without_nil_reads_room()
    test_before_offer_reads_room_not_tier()
    test_attached_reads_the_deal()
    test_spent_budget_is_weak()
    test_strength_reads_open_nothing()
    test_known_hides_the_ask()
    test_nil_pitch_opens_money_promise()
    test_money_promise_kept()
    test_money_promise_broken()
    test_money_promise_closed_on_commit_elsewhere()
    test_non_nil_prospect_says_so()
    test_zero_ask_no_promise()
    print("nil pitch ok: unattached NIL reads the room against his ask; attached reads the deal; the page reads the ask you know; talking money is a promise, kept, broken or closed")
