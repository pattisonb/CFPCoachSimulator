"""Keeps His Word (docs/superpowers/plans/2026-11-11-keeps-his-word.md): your reputation for keeping promises, kept on
the coach, moved by kept and broken promises (most at the broken player's position), recovering each offseason, read
by recruits when you promise."""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))

from coach_career import word


def bare():
    return {"career": {}, "team": "iowa", "season_year": 2026}


def test_fresh_reads_start():
    st = bare()
    assert word.reading(st) == word.WORD_START
    assert word.reading(st, "QB") == word.WORD_START, "a position with no history reads the overall"
    assert word.word_text(70) == "Strong"
    assert "word" not in st["career"], "reading writes nothing"


def test_broken_hits_position_harder():
    st = bare()
    word.apply(st, "broken", "QB", "Jalen Moss")
    assert word.reading(st) == 62
    assert word.reading(st, "QB") == 54
    assert word.reading(st, "WR") == 62


def test_kept_gains_less_than_broken_costs():
    st = bare()
    word.apply(st, "kept", "WR", "A")
    word.apply(st, "broken", "WR", "B")
    assert word.reading(st) < word.WORD_START


def test_star_and_guarded_cost_more():
    st = bare()
    assert word.apply(st, "broken", "QB", "A", star=True) == -12
    assert word.apply(st, "broken", "QB", "B", star=True, personality="guarded") == -18


def test_recover():
    st = bare()
    b = word.book(st)
    b["overall"] = 50
    b["by_group"]["QB"] = -8
    word.recover(st)
    assert word.reading(st) == 55 and b["by_group"]["QB"] == -4


def test_clamped():
    st = bare()
    for i in range(20):
        word.apply(st, "broken", "QB", f"P{i}")
    assert word.reading(st) == 0 and word.reading(st, "QB") == 0
    st = bare()
    for i in range(50):
        word.apply(st, "kept", "QB", f"P{i}")
    assert word.reading(st) == 100 and word.reading(st, "QB") == 100


def test_last_broken():
    st = bare()
    word.apply(st, "broken", "QB", "First Guy")
    word.apply(st, "kept", "QB", "Kept Guy")
    word.apply(st, "broken", "QB", "Second Guy")
    assert word.last_broken(st, "QB") == "Second Guy"
    assert word.last_broken(st, "WR") is None


def test_bands_feed_once():
    import test_promises
    from coach_career import offseason
    from sim import season
    st = test_promises.second_season()
    me, year = st["team"], season.season_year(st)
    roster = st["league"]["teams"][me]["roster"]
    qb = next(c for c in roster if c["pos"] == "QB")
    wr = next(c for c in roster if c["pos"] == "WR")
    for c in (qb, wr):
        c["persona"] = {"personality": "business"}
        c["o"] = 40                                      # not a star: the plain costs
        c["s"] = 2
    bands = {qb["id"]: {"band": "broken", "score": 0.1, "benched_big": False, "personality": "business"},
             wr["id"]: {"band": "kept", "score": 0.9, "benched_big": False, "personality": "business"}}
    word.apply_bands(st, year, bands)
    word.apply_bands(st, year, bands)
    assert word.reading(st) == word.WORD_START - 8 + 3, word.book(st)
    assert word.reading(st, offseason.GROUP["QB"]) == word.WORD_START - 8 + 3 - 8
    assert word.last_broken(st, "QB") == qb["n"]


def _star(st, pid):
    from coach_career import persona
    p = st["recruiting"]["prospects"][pid]
    return (word.STAR_COST if (p.get("stars") or 0) >= 4 else 1.0) * (word.GUARDED_COST if persona.of(st, pid)["personality"] == "guarded" else 1.0)


def test_money_and_package_feed():
    import test_nil_pitch as n
    from coach_career import recruiting
    st = n.fresh()
    pid = n.nil_target(st, None)
    n.money_pitch(st, pid)
    ask = recruiting.ask_from(st, n.ME, pid)
    recruiting._nil(st, n.ME)["held"][pid] = recruiting._five(recruiting.NIL_PROMISE_SHARE * ask + 2.4)
    recruiting._promises(st, st["current_week"] + 1)
    assert word.reading(st) == word.WORD_START + word.GAIN["money_kept"], word.book(st)
    st = n.fresh()
    pid = n.nil_target(st, None)
    n.money_pitch(st, pid)
    wk = st["current_week"]
    for w in range(wk + 1, wk + 1 + recruiting.NIL_PROMISE_WEEKS):
        recruiting._promises(st, w)
    assert word.reading(st) == word.WORD_START - word.COST["money_broken"] * _star(st, pid), word.book(st)
    assert word.last_broken(st, recruiting._group_of(st["recruiting"]["prospects"][pid])) == st["recruiting"]["prospects"][pid]["name"]


def test_forgiven_costs_nothing():
    import test_nil_pitch as n
    from coach_career import recruiting
    saved = recruiting.MONEY_FORGIVE_CHANCE["shy"]
    recruiting.MONEY_FORGIVE_CHANCE["shy"] = 1.0
    try:
        st = n.fresh("tulane")
        school = "tulane"
        pid = next(q for q in n.ranked(st)[40:100] if recruiting.ask_from(st, school, q) >= 15)
        n.cares(st, pid, True, personality="shy")
        recruiting.act(st, school, pid, "offer", pitch="winning")
        recruiting._contact(st, school, pid).setdefault("calls", 1)
        sc = recruiting.act(st, school, pid, "call")["scene"]
        sc = recruiting.act(st, school, pid, "present", scene=sc["id"], topics=list(recruiting.PITCHES)[:3])["scene"]
        if sc.get("question"):
            recruiting.act(st, school, pid, "answer", scene=sc["id"], answer="straight")
        recruiting.act(st, school, pid, "pitch", pitch="nil", scene=sc["id"])
        wk = st["current_week"]
        for w in range(wk + 1, wk + 1 + recruiting.NIL_PROMISE_WEEKS):
            recruiting._promises(st, w)
        assert any(e["kind"] == "promise_broken" and e.get("forgiven") for e in st["recruiting"]["log"] if e["pid"] == pid)
        assert word.reading(st) == word.WORD_START and not (st["career"].get("word") or {}).get("log"), word.book(st)
    finally:
        recruiting.MONEY_FORGIVE_CHANCE["shy"] = saved


def test_ai_schools_have_no_word():
    import test_nil_pitch as n
    from coach_career import recruiting
    st = n.fresh()
    pid = n.ranked(st)[50]
    rc = st["recruiting"]
    c = recruiting._contact(st, "ohio-state", pid)
    c.setdefault("promises", []).append({"kind": "money", "week": 1, "about": {"ask": 30}, "n": c.get("n", 0)})
    rc["nil"].setdefault("ohio-state", {"held": {}})["held"][pid] = 30
    recruiting._promises(st, 2)
    assert "word" not in st["career"], "only your coach has a word"


def test_word_follows_the_coach():
    import test_offseason
    from coach_career import offseason
    from sim import season
    st = season.new_season("iowa", "full", seed=5, career=True)
    word.book(st)["overall"] = 40
    test_offseason.finished(st)
    offseason.start(st)
    offseason.start(st)
    offseason.run_all(st)
    st2 = offseason.next_season(st)
    assert word.reading(st2) == 47.5, word.book(st2)


def _recruit(personality="business", decider=None):
    import test_nil_pitch as n
    from coach_career import recruiting
    st = n.fresh()
    pid = n.ranked(st)[60]
    p = st["recruiting"]["prospects"][pid]
    p["persona"] = dict(recruiting.persona.of(st, pid), personality=personality, decider_topic=decider)
    return st, pid


def _promise(st, pid):
    """A roster question he can believe (the player ahead is in his last year), answered with a promise."""
    from coach_career import recruiting
    sc = {"id": "s1", "action": "call", "week": st["current_week"],
          "question": {"kind": "roster", "text": "Is he still your starter?", "about": {"name": "Old Guy", "ovr": 0, "last_year": True, "cls": "SR"}, "answer": None, "reply": None}}
    st["recruiting"].setdefault("scenes", {}).setdefault(st["team"], {})[pid] = sc
    return recruiting._answer(st, st["team"], pid, "s1", "promise")


def test_promise_mult_scale():
    from coach_career import recruiting
    st, pid = _recruit()
    group = recruiting._group_of(st["recruiting"]["prospects"][pid])
    assert abs(word.promise_mult(st, pid, group) - 1.2) < 1e-9
    word.book(st)["overall"] = 30
    assert abs(word.promise_mult(st, pid, group) - 0.8) < 1e-9
    st, pid = _recruit("guarded")
    assert abs(word.promise_mult(st, pid, group) - 1.3) < 1e-9
    st, pid = _recruit(decider="playing_time")
    assert abs(word.promise_mult(st, pid, group) - 1.3) < 1e-9


def test_doubted_promise_earns_nothing():
    from coach_career import recruiting, scenes
    st, pid = _recruit()
    group = recruiting._group_of(st["recruiting"]["prospects"][pid])
    word.book(st)["overall"] = 30
    word.apply(st, "broken", group, "Jalen Moss")
    word.book(st)["overall"] = 30                        # still under the floor at his position
    r = _promise(st, pid)
    assert r["points"] == 0, r
    assert r["scene"]["question"]["reply"] == scenes.WORD_DOUBT.format(name="Jalen Moss"), r["scene"]["question"]
    ev = [e for e in st["recruiting"]["log"] if e["kind"] == "answer" and e["pid"] == pid][-1]
    assert ev.get("doubted") is True, ev
    st, pid = _recruit()
    word.book(st)["overall"] = 20
    r = _promise(st, pid)
    assert r["points"] == 0 and r["scene"]["question"]["reply"] == scenes.WORD_DOUBT_ANY


def test_strong_word_earns_more():
    from coach_career import recruiting
    st, pid = _recruit()
    word.book(st)["overall"] = 90
    r = _promise(st, pid)
    assert abs(r["points"] - recruiting.ANSWER_PROMISE * 1.4) < 1e-9, r["points"]


def test_keep_them_home_reads_word():
    from coach_career import offseason, promises
    st = bare()
    e = {"id": "x", "pos": "QB", "personality": "business", "ask": {"nil": 0, "kind": "role", "known": True},
         "offers": {"promise": True}, "role_next": "starter", "broken_promise": True, "intent": "stay"}
    word.book(st)["overall"] = 90
    assert abs(offseason.stay_chance(e, st) - min(0.9, promises.PROMISE_AGAIN_STAY * 1.4)) < 1e-9
    word.book(st)["overall"] = 20
    assert offseason.stay_chance(e, st) == 0.02
    assert abs(offseason.stay_chance(e) - promises.PROMISE_AGAIN_STAY) < 1e-9, "no state: the old rule"


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("word ok")
