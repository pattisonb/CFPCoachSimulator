"""Recruit questions (docs/superpowers/specs/2026-10-29-recruit-questions-design.md): on a call or
in-home visit a recruit who cares about playing time asks about a named player (the one ahead of him
on your roster, or another recruit you offered at his position); you answer Straight, Promise or
Deflect; promises are remembered. Through app.api as the page asks. (Run as a file.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `from sim import season` works from here

from app import api
from coach_career import offseason
from coach_career import persona
from coach_career import recruiting
from coach_career import scenes
from coach_career import word
from sim import season
from tests.test_offseason import finished

ME = "smu"


def refused(fn, code: int, message: str) -> None:
    try:
        fn()
    except api.ApiError as e:
        assert e.status == code and e.message == message, (e.status, e.message)
        return
    raise AssertionError(f"expected {code} {message!r}")


def G(sid: str, path: str) -> dict:
    return api.call("GET", f"/api/season/{sid}/{path}")


def R(sid: str, path: str, body: dict) -> dict:
    return api.call("POST", f"/api/season/{sid}/{path}", body)


def call(sid: str, pid: str) -> dict:
    """A call, presented with three topics that are not his (his question comes after your opening;
    the opening earns nothing here, so the points under test are the answer's alone)."""
    st = api.loaded_state()
    st["recruiting"]["hours"][ME] = 100          # hours are not the point here
    sc = R(sid, "recruit", {"pid": pid, "action": "call"})["scene"]
    assert sc["question"] is None and sc["cue"] is None, "his question and the cue wait on your opening"
    misses = [t for t in recruiting.PITCHES if not persona.counts_as_priority(st, pid, t)][:3]      # his decider's topic counts as his
    r = R(sid, "recruit", {"pid": pid, "action": "present", "scene": sc["id"], "topics": misses})
    assert r["points"] == 0.0, r
    return r["scene"]


def answer(sid: str, pid: str, sc: dict, how: str) -> dict:
    return R(sid, "recruit", {"pid": pid, "action": "answer", "scene": sc["id"], "answer": how})


def cold(st: dict, want_pt: bool, used: set, group: str = None) -> str:
    """A visible prospect nobody has touched, with (or without) playing time among his priorities."""
    rc = st["recruiting"]
    for pid in recruiting.prospect_list(st):
        p = rc["prospects"][pid]
        if pid in used or pid in rc["contacts"] or rc["status"][pid]["committed"]:
            continue
        if ("playing_time" in p["priorities"]) != want_pt:
            continue
        if group and recruiting._group_of(p) != group:
            continue
        used.add(pid)
        return pid
    raise AssertionError("no such prospect")


def best_ahead(st: dict, pid: str) -> dict:
    """The test's own read of the roster: the best returning player at his group rated at least as high."""
    p = st["recruiting"]["prospects"][pid]
    group = recruiting._group_of(p)
    t = season.load_teams()[ME]
    cands = [q for q in t["offense"] + t["defense"]
             if ("LB" if q["position"] in ("MLB", "ROLB", "LOLB") else q["position"]) == group
             and q.get("class") not in recruiting.LEAVING and (q.get("ovr") or 0) >= p["ovr"]]
    return max(cands, key=lambda q: q.get("ovr") or 0) if cands else None


def events(st: dict, pid: str, kind: str) -> list[dict]:
    return [e for e in st["recruiting"]["log"] if e["pid"] == pid and e["kind"] == kind]


def package(st: dict, pid: str, mate: str, decider: str = "mom") -> None:
    """A Package Deal pair, set on both (his persona: the story and who decides at his visit)."""
    for a, b, lead in ((pid, mate, True), (mate, pid, False)):
        st["recruiting"]["prospects"][a]["persona"] = {"personality": "cocky", "decider": decider if lead else "self", "decider_topic": "proximity" if lead and decider != "self" else None,
                                                       "story": "package", "story_data": {"mate": b, "lead": lead}, "commit_style": "hat"}


def visit(sid: str, pid: str) -> dict:
    """An in-home visit, presented with three topics that are not his (as `call`)."""
    st = api.loaded_state()
    st["recruiting"]["hours"][ME] = 100
    sc = R(sid, "recruit", {"pid": pid, "action": "hc_visit"})["scene"]
    assert sc["question"] is None
    misses = [t for t in recruiting.PITCHES if not persona.counts_as_priority(st, pid, t)][:3]
    return R(sid, "recruit", {"pid": pid, "action": "present", "scene": sc["id"], "topics": misses})["scene"]


if __name__ == "__main__":
    import shutil
    import tempfile
    season.SEASONS_DIR = _Path(tempfile.mkdtemp(prefix="cfp-questions-"))
    scenes.QUESTION_RATE = 1.0
    try:
        sid = api.call("POST", "/api/season", {"team": ME, "mode": "full", "seed": 11, "career": True})["id"]
        st = api.loaded_state()
        rc = st["recruiting"]
        week = st["current_week"]
        used: set = set()
        # the constants, exactly
        assert (recruiting.ANSWER_STRAIGHT, recruiting.ANSWER_PROMISE, recruiting.ANSWER_HOLLOW, recruiting.PROMISE_RIVAL) == (1.0, 3.0, 2.0, 20)
        assert scenes.QUESTION_LINES["roster"][0] == "Is {ahead} still your {position} next year? I'm not coming to sit behind him."
        assert scenes.ANSWER_COPY["roster"]["promise"] == "The job's yours." and scenes.ANSWER_COPY["recruit"]["promise"] == "You're the one I want."
        assert scenes.ANSWER_COPY["roster"]["straight"] == "He's the starter today. You'd compete, and the best man plays."
        assert scenes.ANSWER_COPY["recruit"]["straight"] == "I offered him too. One of you starts; I want it to be you."
        assert scenes.ANSWER_COPY["roster"]["deflect"] == scenes.ANSWER_COPY["recruit"]["deflect"] == "Let's talk about what you'd bring."

        # ----- a roster question: the best returning player at his group rated at least as high -----
        pid = None
        while pid is None:
            cand = cold(st, True, used)
            if best_ahead(st, cand) is not None:
                pid = cand
        want = best_ahead(st, pid)
        ahead = recruiting.ahead_of(st, ME, pid)
        assert ahead["name"] == want["name"] and ahead["ovr"] == want["ovr"] and ahead["slug"] == want["slug"], (ahead, want)
        assert ahead["cls"] == want["class"] and ahead["position"] == want["position"]
        sc = call(sid, pid)
        q = sc["question"]
        assert q and q["kind"] == "roster" and q["about"]["name"] == want["name"] and q["about"]["id"] == want["slug"], q
        assert q["answer"] is None and q["reply"] is None and want["name"] in q["text"] and "None" not in q["text"]
        p = rc["prospects"][pid]
        f = {"ahead": want["name"], "ahead_cls": scenes.CLASS_WORDS[want["class"]], "position": want["position"]}
        assert q["text"] in [line.format(**f) for line in scenes.QUESTION_LINES["roster"]], q["text"]
        assert "ATH" not in q["text"], q["text"]     # the position is the roster player's, never the recruit's "ATH"
        # an athlete's question names the roster player's position, whichever line the draw picks
        ath = next(q2 for q2 in rc["prospects"] if rc["prospects"][q2]["position"] == "ATH" and recruiting.ahead_of(st, ME, q2))
        a = recruiting.ahead_of(st, ME, ath)
        lines = [line.format(ahead=a["name"], ahead_cls=scenes.CLASS_WORDS.get(a["cls"], "veteran"), position=a["position"]) for line in scenes.QUESTION_LINES["roster"]]
        assert all("ATH" not in ln and a["position"] in ln for ln in lines[:1]), lines
        assert q["text"] not in sc["lines"], "the question is its own field, not a line"
        # the pitch waits on the answer; a wrong or missing scene is refused
        refused(lambda: R(sid, "recruit", {"pid": pid, "action": "pitch", "scene": sc["id"], "pitch": "winning"}), 409, "answer him first")
        refused(lambda: R(sid, "recruit", {"pid": pid, "action": "answer", "scene": "nope", "answer": "straight"}), 409, "no call or visit open")
        refused(lambda: R(sid, "recruit", {"pid": pid, "action": "answer", "answer": "straight"}), 409, "no call or visit open")
        refused(lambda: R(sid, "recruit", {"pid": pid, "action": "answer", "scene": sc["id"], "answer": "shrug"}), 400, "unknown answer")
        refused(lambda: R(sid, "recruit", {"pid": pid, "action": "answer", "scene": sc["id"]}), 422, "answer is required")
        # hanging up keeps the question: the board row carries the same scene
        R(sid, "board", {"pid": pid, "on": True})
        row = next(r for r in G(sid, "recruiting")["board"] if r["id"] == pid)
        assert row["scene"]["id"] == sc["id"] and row["scene"]["question"] == q
        # straight: a point, his priority told, his reply
        known_before = list((rc["revealed"].get(ME) or {}).get(pid) or [])
        r = answer(sid, pid, sc, "straight")
        assert r["points"] == recruiting.ANSWER_STRAIGHT and r["truthful"] is None
        assert r["revealed"] == ([] if "playing_time" in known_before else ["playing_time"]), r
        assert "playing_time" in rc["revealed"][ME][pid]
        assert r["scene"]["question"]["answer"] == "straight" and r["scene"]["question"]["reply"] == "Fair. At least you're not blowing smoke."
        assert r["scene"]["question"]["reply"] == scenes.REPLY_LINES["straight"]
        assert abs(recruiting.pending(st, ME, pid) - recruiting.ANSWER_STRAIGHT) < 1e-9
        assert rc["why_week"][pid][ME] == {"call": recruiting.ANSWER_STRAIGHT}, "the points sit on the scene's action"
        e = events(st, pid, "answer")[-1]
        assert e["answer"] == "straight" and e["about"] == want["name"] and e["truthful"] is None and e["school"] == ME
        assert not rc["contacts"][pid][ME].get("promises"), "straight is not a promise"
        refused(lambda: answer(sid, pid, sc, "straight"), 409, "you already answered")
        # answered, the board row still shows it; the pitch goes out now
        row = next(r for r in G(sid, "recruiting")["board"] if r["id"] == pid)
        assert row["scene"]["question"]["answer"] == "straight"
        r = R(sid, "recruit", {"pid": pid, "action": "pitch", "scene": sc["id"], "pitch": "playing_time"})
        assert r["reaction"]["kind"] in ("hit", "polite", "quiet", "guarded") and pid not in (rc.get("scenes", {}).get(ME) or {})
        assert rc["contacts"][pid][ME]["n"] == 1
        hist = next(r_ for r_ in G(sid, "recruiting")["board"] if r_["id"] == pid)["history"]
        ans = next(h for h in hist if h["kind"] == "answer")
        assert ans["answer"] == "straight" and ans["about"] == want["name"] and "truthful" not in ans, ans

        # ----- deflect: nothing -----
        pid2 = None
        while pid2 is None:
            cand = cold(st, True, used)
            if best_ahead(st, cand) is not None:
                pid2 = cand
        sc2 = call(sid, pid2)
        assert sc2["question"] and sc2["question"]["kind"] == "roster"
        r = answer(sid, pid2, sc2, "deflect")
        assert r["points"] == 0.0 and r["truthful"] is None and r["revealed"] == [] and r["scene"]["question"]["reply"] == "...Okay."
        assert recruiting.pending(st, ME, pid2) == 0.0 and not rc["contacts"][pid2][ME].get("promises")
        assert events(st, pid2, "answer")[-1]["answer"] == "deflect"

        # ----- a hollow promise: the player ahead is back next year and well clear of him -----
        pid3 = None
        while pid3 is None:
            cand = cold(st, True, used)
            a = recruiting.ahead_of(st, ME, cand)
            if a and not a["last_year"] and rc["prospects"][cand]["ovr"] < a["ovr"] - recruiting.PROMISE_MARGIN:
                pid3 = cand
        sc3 = call(sid, pid3)
        assert sc3["question"]["kind"] == "roster" and sc3["question"]["about"]["last_year"] is False
        assert not recruiting.promise_holds(st, ME, pid3, sc3["question"])
        r = answer(sid, pid3, sc3, "promise")
        assert r["points"] == -recruiting.ANSWER_HOLLOW and r["truthful"] is False
        assert r["scene"]["question"]["reply"] == "I've heard that one before." == scenes.REPLY_LINES["hollow"]
        assert abs(recruiting.pending(st, ME, pid3) + recruiting.ANSWER_HOLLOW) < 1e-9
        c3 = rc["contacts"][pid3][ME]
        assert c3["cooled_until"] == week + 1 and recruiting.cooled(st, ME, pid3)
        assert events(st, pid3, "not_buying"), "a hollow promise: he isn't buying it"
        assert c3["promises"] == [{"kind": "roster", "about": sc3["question"]["about"], "week": week, "broken": None}]
        assert events(st, pid3, "answer")[-1]["truthful"] is False

        # ----- a true promise: the player ahead is in his last year next season -----
        pid4 = None
        while pid4 is None:
            cand = cold(st, True, used)
            a = recruiting.ahead_of(st, ME, cand)
            if a and a["last_year"]:
                pid4 = cand
        sc4 = call(sid, pid4)
        assert sc4["question"]["kind"] == "roster" and sc4["question"]["about"]["cls"] in recruiting.LAST_YEAR
        assert recruiting.promise_holds(st, ME, pid4, sc4["question"])
        r = answer(sid, pid4, sc4, "promise")
        worth = recruiting.ANSWER_PROMISE * word.promise_mult(st, pid4, recruiting._group_of(rc["prospects"][pid4]))   # Keeps His Word scales it
        assert abs(r["points"] - worth) < 1e-9 and r["truthful"] is True
        assert r["scene"]["question"]["reply"] == "That's what I needed to hear, Coach." == scenes.REPLY_LINES["promise"]
        assert abs(recruiting.pending(st, ME, pid4) - worth) < 1e-9
        c4 = rc["contacts"][pid4][ME]
        assert "cooled_until" not in c4 and c4["promises"][0]["kind"] == "roster" and c4["promises"][0]["broken"] is None
        assert not events(st, pid4, "not_buying")
        # the margin alone holds it too: within PROMISE_MARGIN of a returning player
        q_ = dict(sc4["question"], about=dict(sc4["question"]["about"], last_year=False, ovr=rc["prospects"][pid4]["ovr"] + recruiting.PROMISE_MARGIN))
        assert recruiting.promise_holds(st, ME, pid4, q_)
        q_["about"]["ovr"] += 1
        assert not recruiting.promise_holds(st, ME, pid4, q_)

        # ----- no question: no playing-time priority; or nobody ahead and nobody else offered -----
        pid5 = cold(st, False, used)
        assert call(sid, pid5)["question"] is None
        returning = recruiting._returning
        recruiting._returning = lambda slug, group: ()
        try:
            pid6 = cold(st, True, used)
            assert recruiting.ahead_of(st, ME, pid6) is None and recruiting.other_offered(st, ME, pid6) is None
            assert call(sid, pid6)["question"] is None

            # ----- a recruit question: the higher-ranked other recruit you offered at his group -----
            pid7 = cold(st, True, used)
            group = recruiting._group_of(rc["prospects"][pid7])
            others = [cold(st, False, used, group) for _ in range(2)]
            for o in others:
                rc["hours"][ME] = 100
                R(sid, "recruit", {"pid": o, "action": "offer", "pitch": "winning"})
            top = min(others, key=lambda q: rc["prospects"][q]["rank"])
            other = recruiting.other_offered(st, ME, pid7)
            assert other == {"pid": top, "name": rc["prospects"][top]["name"], "position": rc["prospects"][top]["position"],
                             "rank": rc["prospects"][top]["rank"]}, other
            sc7 = call(sid, pid7)
            q7 = sc7["question"]
            assert q7["kind"] == "recruit" and q7["about"]["pid"] == top and q7["about"]["name"] == rc["prospects"][top]["name"], q7
            assert q7["about"]["cls"] is None and "None" not in q7["text"]
            assert q7["text"] in [line.format(other=rc["prospects"][top]["name"]) for line in scenes.QUESTION_LINES["recruit"]]
            r = answer(sid, pid7, sc7, "promise")
            truthful = rc["prospects"][pid7]["ovr"] >= rc["prospects"][top]["ovr"]
            assert r["truthful"] is truthful and abs(r["points"] - (recruiting.ANSWER_PROMISE * word.promise_mult(st, pid7, recruiting._group_of(rc["prospects"][pid7])) if truthful else -recruiting.ANSWER_HOLLOW)) < 1e-9
            assert rc["contacts"][pid7][ME]["promises"][0]["kind"] == "recruit"
            # he commits to you, then the other kid does too: he remembers, once
            recruiting._commit(st, pid7, ME)
            firm0 = rc["status"][pid7]["firmness"]
            recruiting._promises(st, week)
            assert rc["status"][pid7]["firmness"] == firm0 and not events(st, pid7, "promise_broken"), "the other recruit has not committed"
            recruiting._commit(st, top, ME)
            recruiting._promises(st, week)
            assert rc["status"][pid7]["firmness"] == max(0, firm0 - recruiting.PROMISE_RIVAL)
            pb = events(st, pid7, "promise_broken")
            assert len(pb) == 1 and pb[0]["about"] == rc["prospects"][top]["name"] and pb[0]["school"] == ME, pb
            assert rc["contacts"][pid7][ME]["promises"][0]["broken"] == week
            recruiting._promises(st, week + 1)
            assert rc["status"][pid7]["firmness"] == max(0, firm0 - recruiting.PROMISE_RIVAL) and len(events(st, pid7, "promise_broken")) == 1
            # a recruit promise with him uncommitted: he cools on you instead
            pid8 = cold(st, True, used, group)
            sc8 = call(sid, pid8)
            assert sc8["question"]["kind"] == "recruit"
            about8 = sc8["question"]["about"]["pid"]
            answer(sid, pid8, sc8, "promise")
            rc["contacts"][pid8][ME].pop("cooled_until", None)       # a hollow one cooled him already: the rule's own cooling is the point
            if rc["status"][about8]["committed"] != ME:
                recruiting._commit(st, about8, ME)
            recruiting._promises(st, week)
            assert rc["contacts"][pid8][ME]["cooled_until"] == week + recruiting.COOL_WEEKS
            assert len(events(st, pid8, "promise_broken")) == 1
            # a hard commit is immune
            pid9 = cold(st, True, used, group)
            sc9 = call(sid, pid9)
            assert sc9["question"]["kind"] == "recruit"
            answer(sid, pid9, sc9, "promise")
            recruiting._commit(st, pid9, ME)
            rc["status"][pid9].update(hard=True, firmness=recruiting.HARD_AT)
            recruiting._promises(st, week)
            assert rc["status"][pid9]["firmness"] == recruiting.HARD_AT and not events(st, pid9, "promise_broken")
        finally:
            recruiting._returning = returning

        # ----- the Package Deal: his mate comes up, and the question is about him -----
        assert (recruiting.PACKAGE_OFFERED, recruiting.PACKAGE_PROMISE_WEEKS, recruiting.PACKAGE_KEPT) == (1.0, 2, 2.0)
        assert scenes.PACKAGE_ANSWERS[False]["straight"] == ("Tell Him Straight", "I can't promise {mate} a spot today. I'll look at him.")
        assert scenes.PACKAGE_ANSWERS[False]["promise"] == ("Promise Him an Offer", "{mate} gets an offer this week. You have my word.")
        assert scenes.PACKAGE_ANSWERS[True]["straight"] == ("Already Offered Him", "I offered {mate} already. Two spots, both yours.")
        assert scenes.PACKAGE_ANSWERS[True]["deflect"] == scenes.PACKAGE_ANSWERS[False]["deflect"] == ("Sidestep It", "Let's talk about what you'd bring.")
        pa, ma = cold(st, False, used), cold(st, False, used)            # no playing-time priority: the package question needs none
        package(st, pa, ma, "mom")
        mname = rc["prospects"][ma]["name"]
        f = scenes._fields(st, ME, rc["prospects"][pa], week)
        rc["hours"][ME] = 100
        sc_a = R(sid, "recruit", {"pid": pa, "action": "hc_visit"})["scene"]
        fam = [t for t in sc_a["turns"] if t["who"] == "family"]
        assert fam and fam[0]["text"] in [x.format(**f) for x in persona.STORY_LINES["package"]["family"]], fam
        assert sc_a["package"] == {"pid": ma, "name": mname, "offered": False}, sc_a["package"]
        misses = [t for t in recruiting.PITCHES if not persona.counts_as_priority(st, pa, t)][:3]
        sc_a = R(sid, "recruit", {"pid": pa, "action": "present", "scene": sc_a["id"], "topics": misses})["scene"]
        qa = sc_a["question"]
        assert qa["kind"] == "package" and qa["about"] == {"pid": ma, "name": mname, "offered": False}, qa
        assert qa["text"] in [x.format(mate=mname) for x in scenes.QUESTION_LINES["package"]], qa["text"]
        assert [qa["answers"][k]["label"] for k in scenes.ANSWERS] == ["Tell Him Straight", "Promise Him an Offer", "Sidestep It"]
        assert qa["answers"]["promise"]["text"] == f"{mname} gets an offer this week. You have my word."
        assert qa["answers"]["straight"]["text"] == f"I can't promise {mname} a spot today. I'll look at him."
        r = answer(sid, pa, sc_a, "promise")
        assert r["points"] == 0 and r["truthful"] is None and r["scene"]["question"]["reply"] == "Then we'll be watching for it."
        pr_a = rc["contacts"][pa][ME]["promises"][0]
        assert pr_a["kind"] == "package" and pr_a["about"]["pid"] == ma and pr_a["week"] == week and pr_a["kept"] is None and pr_a["broken"] is None
        ev = events(st, pa, "answer")[-1]
        assert ev["question"] == "package" and ev["offered"] is False and ev["answer"] == "promise" and ev["about"] == mname
        recruiting._promises(st, week)
        assert pr_a["kept"] is None and pr_a["broken"] is None and not events(st, pa, "promise_kept")
        # you offer his mate the next week: kept, a few points on his list, his line
        before = rc["lists"][pa].get(ME, 0.0)
        rc["hours"][ME] = 100
        R(sid, "recruit", {"pid": ma, "action": "offer", "pitch": "winning"})
        recruiting._promises(st, week + 1)
        assert pr_a["kept"] == week + 1 and pr_a["broken"] is None
        assert abs(rc["lists"][pa][ME] - before - recruiting.PACKAGE_KEPT) < 1e-9
        pk = events(st, pa, "promise_kept")
        assert len(pk) == 1 and pk[0]["about"] == mname and pk[0]["line"] == f"{mname} got his offer. You kept your word, Coach." and pk[0]["school"] == ME
        recruiting._promises(st, week + 5)
        assert len(events(st, pa, "promise_kept")) == 1 and not events(st, pa, "promise_broken"), "kept once, never broken"
        assert "promise_kept" in recruiting.REPORT_KINDS
        # a promise with no offer behind it: broken after PACKAGE_PROMISE_WEEKS, he cools on you
        pb_, mb = cold(st, False, used), cold(st, False, used)
        package(st, pb_, mb, "self")                                   # he decides himself: his own line brings his mate up
        sc_b = visit(sid, pb_)
        mb_name = rc["prospects"][mb]["name"]
        f = scenes._fields(st, ME, rc["prospects"][pb_], week)
        assert any(t in [x.format(**f) for x in persona.STORY_LINES["package"]["him"]] for t in sc_b["lines"]), sc_b["lines"]
        assert sc_b["question"]["kind"] == "package" and sc_b["question"]["about"]["pid"] == mb
        answer(sid, pb_, sc_b, "promise")
        for w in range(week, week + recruiting.PACKAGE_PROMISE_WEEKS):
            recruiting._promises(st, w)
            assert not events(st, pb_, "promise_broken") and "cooled_until" not in rc["contacts"][pb_][ME], w
        broke = week + recruiting.PACKAGE_PROMISE_WEEKS
        recruiting._promises(st, broke)
        pb_ev = events(st, pb_, "promise_broken")
        assert len(pb_ev) == 1 and pb_ev[0]["about"] == mb_name and pb_ev[0]["why"] == "package" and pb_ev[0]["other"] == mb, pb_ev
        assert rc["contacts"][pb_][ME]["cooled_until"] == broke + recruiting.COOL_WEEKS
        assert rc["contacts"][pb_][ME]["promises"][0]["broken"] == broke
        recruiting._promises(st, broke + 1)
        assert len(events(st, pb_, "promise_broken")) == 1
        # committed to you when it breaks: his firmness drops instead
        pc, mc = cold(st, False, used), cold(st, False, used)
        package(st, pc, mc, "dad")
        sc_c = visit(sid, pc)
        assert sc_c["question"]["kind"] == "package"
        answer(sid, pc, sc_c, "promise")
        recruiting._commit(st, pc, ME)
        firm0 = rc["status"][pc]["firmness"]
        recruiting._promises(st, week + recruiting.PACKAGE_PROMISE_WEEKS)
        assert rc["status"][pc]["firmness"] == max(0, firm0 - recruiting.PROMISE_RIVAL) and len(events(st, pc, "promise_broken")) == 1
        # his mate already holds your offer: the family's line says so, and Already Offered Him earns the bonus
        pd_, md = cold(st, False, used), cold(st, False, used)
        package(st, pd_, md, "mom")
        md_name = rc["prospects"][md]["name"]
        rc["hours"][ME] = 100
        R(sid, "recruit", {"pid": md, "action": "offer", "pitch": "winning"})
        rc["hours"][ME] = 100
        sc_d = R(sid, "recruit", {"pid": pd_, "action": "hc_visit"})["scene"]
        f = scenes._fields(st, ME, rc["prospects"][pd_], week)
        fam = [t for t in sc_d["turns"] if t["who"] == "family"]
        assert fam[0]["text"] in [x.format(**f) for x in persona.STORY_LINES_OFFERED["package"]["family"]], fam
        assert "You offered {mate} too. That means a lot in this house." in persona.STORY_LINES_OFFERED["package"]["family"]
        assert sc_d["package"]["offered"] is True
        misses = [t for t in recruiting.PITCHES if not persona.counts_as_priority(st, pd_, t)][:3]
        sc_d = R(sid, "recruit", {"pid": pd_, "action": "present", "scene": sc_d["id"], "topics": misses})["scene"]
        qd = sc_d["question"]
        assert qd["kind"] == "package" and qd["about"]["offered"] is True
        assert qd["text"] in [x.format(mate=md_name) for x in scenes.QUESTION_LINES["package_offered"]], qd["text"]
        assert qd["answers"]["straight"] == {"label": "Already Offered Him", "text": f"I offered {md_name} already. Two spots, both yours."}
        assert qd["answers"]["deflect"]["label"] == "Sidestep It"
        known_d = list((rc["revealed"].get(ME) or {}).get(pd_) or [])
        r = answer(sid, pd_, sc_d, "straight")
        assert r["points"] == recruiting.ANSWER_STRAIGHT + recruiting.PACKAGE_OFFERED and r["revealed"] == [] and r["truthful"] is None
        assert r["scene"]["question"]["reply"] == "That's all we needed to hear, Coach."
        assert list((rc["revealed"].get(ME) or {}).get(pd_) or []) == known_d, "about his mate, not playing time"
        ev = events(st, pd_, "answer")[-1]
        assert ev["question"] == "package" and ev["offered"] is True and ev["answer"] == "straight"
        assert not rc["contacts"][pd_][ME].get("promises")
        # not offered, told straight: nothing either way; a sidestep the same
        pe, me_ = cold(st, False, used), cold(st, False, used)
        package(st, pe, me_, "mom")
        sc_e = visit(sid, pe)
        r = answer(sid, pe, sc_e, "straight")
        assert r["points"] == 0 and r["scene"]["question"]["reply"] == scenes.REPLY_LINES["straight"] and not rc["contacts"][pe][ME].get("promises")
        # his mate signed elsewhere: no package question (his story line still plays)
        pf, mf = cold(st, False, used), cold(st, False, used)
        package(st, pf, mf, "mom")
        rc["status"][mf]["signed"] = "ohio-state"
        rc["hours"][ME] = 100
        sc_f = R(sid, "recruit", {"pid": pf, "action": "hc_visit"})["scene"]
        assert sc_f["package"] is None

        # ----- the week advancing with an open question: the scene goes, no promise is recorded -----
        pid10 = None
        while pid10 is None:
            cand = cold(st, True, used)
            if best_ahead(st, cand) is not None:
                pid10 = cand
        sc10 = call(sid, pid10)
        assert sc10["question"]
        recruiting._flush(st, week)
        assert not (rc.get("scenes") or {}).get(ME) and events(st, pid10, "hung_up")
        assert not rc["contacts"][pid10][ME].get("promises") and not events(st, pid10, "answer")
        # the recap and report carry the broken promise, not the answers
        view = G(sid, "recruiting")
        assert any(e["kind"] == "promise_broken" for e in view["recap"]) and not any(e["kind"] == "answer" for e in view["recap"])
        assert "promise_broken" in recruiting.REPORT_KINDS and "answer" in recruiting.CONTACT_KINDS

        # ----- a roster promise joins the roster as the retention step's promise -----
        finished(st)
        for q_ in rc["status"].values():
            if q_["signed"] == ME:
                q_["signed"] = None
        rc["status"][pid4]["signed"] = ME                 # the true roster promise
        rc["status"][pid2]["signed"] = ME                 # deflected: no promise
        off = offseason.start(st)
        roster = {c["id"]: c for c in st["league"]["teams"][ME]["roster"]}
        assert roster[pid4]["promised"] == off["year"] and "promised" not in roster[pid2]

        # ----- the portal: a transfer's roster question reads the career league's roster -----
        api._save_loaded()
        while api.loaded_state()["offseason"]["stage"] != "portal_w1":
            api.call("POST", f"/api/season/{sid}/offseason/advance", {})
        st = api.loaded_state()
        rc = st["recruiting"]
        assert recruiting.is_portal(st)
        league_roster = st["league"]["teams"][ME]["roster"]
        pid11 = None
        for cand in recruiting.prospect_list(st):
            p = rc["prospects"][cand]
            if "playing_time" in p["priorities"] and recruiting.ahead_of(st, ME, cand):
                pid11 = cand
                break
        assert pid11, "no transfer with a player ahead of him"
        ahead = recruiting.ahead_of(st, ME, pid11)
        group = recruiting._group_of(rc["prospects"][pid11])
        want = max((c for c in league_roster if offseason.GROUP.get(c["pos"]) == group and c["o"] >= rc["prospects"][pid11]["ovr"]), key=lambda c: c["o"])
        assert ahead["name"] == want["n"] and ahead["slug"] == want["id"] and ahead["ovr"] == want["o"] and ahead["cls"] == want["cls"], (ahead, want)
        sc11 = call(sid, pid11)
        assert sc11["question"]["kind"] == "roster" and sc11["question"]["about"]["name"] == want["n"], sc11["question"]
        r = answer(sid, pid11, sc11, "straight")
        assert r["points"] == recruiting.ANSWER_STRAIGHT and "playing_time" in rc["revealed"][ME][pid11]
        print("ok")
    finally:
        shutil.rmtree(season.SEASONS_DIR, ignore_errors=True)
