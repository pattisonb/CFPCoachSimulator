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
    pid = next(q for q in ranked(st)[:200] if 0 < recruiting.ask_from(st, "tulane", q) <= room(st, "tulane", q))
    assert recruiting.strengths(st, "tulane", pid)["nil"] == 1.0, "a small school that can cover him reads Strong"
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

def cares(st, pid, topic, personality="business"):
    """Make NIL (or not) one of his priorities for the test; an All Business recruit tells you on a call."""
    p = st["recruiting"]["prospects"][pid]
    p["persona"] = dict(recruiting.persona.of(st, pid), personality=personality)
    rest = [t for t in p["priorities"] if t != "nil"]
    p["priorities"] = (["nil"] + rest)[:3] if topic else [t for t in recruiting.PITCHES if t != "nil"][:3]
    p["persona"]["decider_topic"] = None


def money_pitch(st, pid):
    """A call: present, answer if he asks, then pitch NIL. The reaction. (A Shy recruit has had a call before: his
    first one tells nothing.)"""
    recruiting._contact(st, ME, pid).setdefault("calls", 1)
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
    assert r["reaction"]["text"] == "The money isn't what this is about for me.", r["reaction"]


def test_zero_ask_no_promise():
    st = fresh()
    pid = next(q for q in reversed(ranked(st)) if recruiting.ask_from(st, ME, q) == 0)
    cares(st, pid, True)
    recruiting.act(st, ME, pid, "offer", pitch="winning")
    money_pitch(st, pid)
    assert not promises(st, pid)


def test_money_promise_opens_with_a_line():
    st = fresh()
    pid = nil_target(st, None)
    money_pitch(st, pid)
    from coach_career import scenes
    assert any(e.get("line") == scenes.MONEY_OWED_LINE for e in st["recruiting"]["log"] if e["pid"] == pid), "the player is told he owes it"


def test_pitch_before_offer_is_still_owed():
    st = fresh()
    pid = next(q for q in ranked(st)[40:100] if recruiting.ask_from(st, ME, q) >= 15)
    cares(st, pid, True)
    recruiting.set_board(st, pid, True)                 # kept on your board, never offered, and still contacted: stringing him along
    money_pitch(st, pid)
    recruiting._contact(st, ME, pid)["n"] += 1          # another contact after the pitch (a message)
    wk = st["current_week"]
    for w in range(wk + 1, wk + 1 + recruiting.NIL_PROMISE_WEEKS):
        recruiting._promises(st, w)
    assert promises(st, pid)[0]["broken"] is not None, promises(st, pid)


def test_kept_at_his_ask_now():
    st = fresh()
    pid = nil_target(st, None)
    money_pitch(st, pid)
    pr = promises(st, pid)[0]
    pr["about"]["ask"] *= 2                       # he asked more when you pitched (you trailed); he wants less now
    recruiting._nil(st, ME)["held"][pid] = recruiting._five(recruiting.NIL_PROMISE_SHARE * recruiting.ask_from(st, ME, pid) + 2.4)
    recruiting._promises(st, st["current_week"] + 1)
    assert promises(st, pid)[0]["kept"] is not None, promises(st, pid)


def test_one_step_under_breaks():
    st = fresh()
    pid = nil_target(st, None)
    money_pitch(st, pid)
    ask = recruiting.ask_from(st, ME, pid)
    under = max(n for n in range(0, ask + 5, 5) if n < recruiting.NIL_PROMISE_SHARE * ask)   # one NIL step short
    recruiting._nil(st, ME)["held"][pid] = under
    wk = st["current_week"]
    for w in range(wk + 1, wk + 1 + recruiting.NIL_PROMISE_WEEKS):
        recruiting._promises(st, w)
    assert promises(st, pid)[0]["broken"] is not None, (under, ask, promises(st, pid))


def test_money_promise_closed_on_pull_or_sign():
    for how in ("pull", "sign"):
        st = fresh()
        pid = nil_target(st, None)
        money_pitch(st, pid)
        if how == "pull":
            st["recruiting"]["offers"][ME].remove(pid)
        else:
            st["recruiting"]["status"][pid]["signed"] = "ohio-state"
        recruiting._promises(st, st["current_week"] + 1)
        pr = promises(st, pid)[0]
        assert pr.get("closed") is not None and pr["broken"] is None, (how, pr)


def test_guarded_call_tells_nothing():
    st = fresh()
    pid = nil_target(st, None)
    cares(st, pid, True, personality="guarded")
    money_pitch(st, pid)
    assert not promises(st, pid) and "exact" not in recruiting.ask_view(st, ME, pid), "a guarded call gives nothing away"


def test_no_money_promise_in_the_portal():
    st = fresh()
    pid = nil_target(st, None)
    c = recruiting._contact(st, ME, pid)
    st["recruiting"]["portal"] = True
    try:
        recruiting._money_talk(st, ME, pid, c, st["current_week"])
    finally:
        st["recruiting"].pop("portal")
    assert not promises(st, pid)


def test_broken_line_fits_the_money_and_the_kid():
    """Nothing on the offer and some (short of the share) read differently, each in his personality's voice."""
    from coach_career import scenes
    for personality in ("business", "shy"):
        for held_some in (False, True):
            st = fresh()
            pid = nil_target(st, None)
            cares(st, pid, True, personality=personality)
            money_pitch(st, pid)
            ask = recruiting.ask_from(st, ME, pid)
            if held_some:
                recruiting._nil(st, ME)["held"][pid] = 5
            wk = st["current_week"]
            for w in range(wk + 1, wk + 1 + recruiting.NIL_PROMISE_WEEKS):
                recruiting._promises(st, w)
            ev = [e for e in st["recruiting"]["log"] if e["kind"] == "promise_broken" and e["pid"] == pid][-1]
            want = scenes.MONEY_BROKEN_LINES["short" if held_some else "none"][personality]
            assert ev["line"] == want, (personality, held_some, ev["line"], ask)


def test_small_school_kind_kid_forgives():
    """A kind kid (recruiting.MONEY_FORGIVING) at a small school (tier MONEY_FORGIVE_TIER or below) lets a broken money
    promise go: his line says so and he does not cool. The same kid at Iowa (tier 3) cools as usual."""
    from coach_career import scenes
    saved = recruiting.MONEY_FORGIVE_CHANCE["shy"]
    recruiting.MONEY_FORGIVE_CHANCE["shy"] = 1.0           # a sure thing, so the test reads the rule, not the draw
    try:
        _forgives(scenes)
    finally:
        recruiting.MONEY_FORGIVE_CHANCE["shy"] = saved


def _forgives(scenes):
    for school, forgives in (("tulane", True), (ME, False)):
        st = fresh(school)
        pid = None
        for q in ranked(st)[40:100]:
            if recruiting.ask_from(st, school, q) >= 15:
                pid = q
                break
        cares(st, pid, True, personality="shy")
        recruiting.act(st, school, pid, "offer", pitch="winning")
        recruiting._contact(st, school, pid).setdefault("calls", 1)        # not his first call: a Shy recruit tells you
        sc = recruiting.act(st, school, pid, "call")["scene"]
        sc = recruiting.act(st, school, pid, "present", scene=sc["id"], topics=list(recruiting.PITCHES)[:3])["scene"]
        if sc.get("question"):
            recruiting.act(st, school, pid, "answer", scene=sc["id"], answer="straight")
        recruiting.act(st, school, pid, "pitch", pitch="nil", scene=sc["id"])
        wk = st["current_week"]
        for w in range(wk + 1, wk + 1 + recruiting.NIL_PROMISE_WEEKS):
            recruiting._promises(st, w)
        ev = [e for e in st["recruiting"]["log"] if e["kind"] == "promise_broken" and e["pid"] == pid][-1]
        cooled = st["recruiting"]["contacts"][pid][school].get("cooled_until") == wk + recruiting.NIL_PROMISE_WEEKS + recruiting.COOL_WEEKS   # the break's cooling, not the lowball's
        assert (ev["line"] == scenes.MONEY_FORGIVEN_LINES["shy"]) == forgives and cooled != forgives, (school, ev, cooled)


def test_walking_away_closes_it():
    """Pitch NIL with no offer, then take him off your board: you walked away, no penalty. Kept on the board with no
    offer, it still breaks (test_pitch_before_offer_is_still_owed)."""
    st = fresh()
    pid = next(q for q in ranked(st)[40:100] if recruiting.ask_from(st, ME, q) >= 15)
    cares(st, pid, True)
    recruiting.set_board(st, pid, True)
    money_pitch(st, pid)
    recruiting.set_board(st, pid, False)
    wk = st["current_week"]
    for w in range(wk + 1, wk + 2 + recruiting.NIL_PROMISE_WEEKS):
        recruiting._promises(st, w)
    pr = promises(st, pid)[0]
    assert pr["broken"] is None and pr.get("closed") is not None, pr
    assert not [e for e in st["recruiting"]["log"] if e["kind"] == "promise_broken" and e["pid"] == pid]


def test_going_quiet_fades_it():
    """Pitch NIL, then no offer and no more contact: it fades at the deadline, no penalty."""
    st = fresh()
    pid = next(q for q in ranked(st)[40:100] if recruiting.ask_from(st, ME, q) >= 15)
    cares(st, pid, True)
    recruiting.set_board(st, pid, True)
    money_pitch(st, pid)
    wk = st["current_week"]
    for w in range(wk + 1, wk + 2 + recruiting.NIL_PROMISE_WEEKS):
        recruiting._promises(st, w)
    pr = promises(st, pid)[0]
    assert pr["broken"] is None and pr.get("closed") is not None, pr


def test_every_kind_can_forgive_at_a_small_school():
    """At a small school each personality forgives some of the time, in its own line; a big school never."""
    from coach_career import scenes
    assert set(recruiting.MONEY_FORGIVE_CHANCE) == set(scenes.MONEY_FORGIVEN_LINES) >= {"cocky", "shy", "guarded", "attention", "business"}
    assert all(0 < c < 1 for c in recruiting.MONEY_FORGIVE_CHANCE.values())
    assert recruiting.MONEY_FORGIVE_CHANCE["shy"] == max(recruiting.MONEY_FORGIVE_CHANCE.values())
    assert recruiting.MONEY_FORGIVE_CHANCE["cocky"] == min(recruiting.MONEY_FORGIVE_CHANCE.values())


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
    test_money_promise_opens_with_a_line()
    test_pitch_before_offer_is_still_owed()
    test_kept_at_his_ask_now()
    test_one_step_under_breaks()
    test_money_promise_closed_on_pull_or_sign()
    test_guarded_call_tells_nothing()
    test_no_money_promise_in_the_portal()
    test_broken_line_fits_the_money_and_the_kid()
    test_small_school_kind_kid_forgives()
    test_walking_away_closes_it()
    test_going_quiet_fades_it()
    test_every_kind_can_forgive_at_a_small_school()
    print("nil pitch ok: unattached NIL reads the room against his ask; attached reads the deal; the page reads the ask you know; talking money is a promise, kept, broken or closed")
