"""Recruit questions (docs/superpowers/specs/2026-10-29-recruit-questions-design.md): on a call or
in-home visit a recruit who cares about playing time asks about a named player (the one ahead of him
on your roster, or another recruit you offered at his position); you answer Straight, Promise or
Deflect; promises are remembered. Through app.api as the page asks. (Run as a file.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `from sim import season` works from here

from app import api
from coach_career import offseason
from coach_career import recruiting
from coach_career import scenes
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
    api.loaded_state()["recruiting"]["hours"][ME] = 100          # hours are not the point here
    return R(sid, "recruit", {"pid": pid, "action": "call"})["scene"]


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
        assert q["answer"] is None and q["reply"] is None and want["name"] in q["text"]
        p = rc["prospects"][pid]
        f = {"ahead": want["name"], "ahead_cls": scenes.CLASS_WORDS[want["class"]], "position": p["position"]}
        assert q["text"] in [line.format(**f) for line in scenes.QUESTION_LINES["roster"]], q["text"]
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
        assert r["reaction"]["kind"] in ("hit", "polite", "quiet") and pid not in (rc.get("scenes", {}).get(ME) or {})
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

        # ----- a hollow promise: he would wait, and you told him the job was his -----
        pid3 = None
        while pid3 is None:
            cand = cold(st, True, used)
            if best_ahead(st, cand) is not None:
                pid3 = cand
        sc3 = call(sid, pid3)
        assert sc3["question"]["kind"] == "roster"
        with recruiting.forced_strength(st, ME, pid3, "playing_time", 0.1):
            assert scenes._role(st, ME, pid3) == "wait"
            r = answer(sid, pid3, sc3, "promise")
        assert r["points"] == -recruiting.ANSWER_HOLLOW and r["truthful"] is False
        assert r["scene"]["question"]["reply"] == "I've heard that one before." == scenes.REPLY_LINES["hollow"]
        assert abs(recruiting.pending(st, ME, pid3) + recruiting.ANSWER_HOLLOW) < 1e-9
        c3 = rc["contacts"][pid3][ME]
        assert c3["cooled_until"] == week + 1 and recruiting.cooled(st, ME, pid3)
        assert events(st, pid3, "not_buying"), "a hollow promise: he isn't buying it"
        assert c3["promises"] == [{"kind": "roster", "about": sc3["question"]["about"], "week": week, "broken": None}]
        assert events(st, pid3, "answer")[-1]["truthful"] is False

        # ----- a true promise: he would start -----
        pid4 = None
        while pid4 is None:
            cand = cold(st, True, used)
            if best_ahead(st, cand) is not None:
                pid4 = cand
        sc4 = call(sid, pid4)
        assert sc4["question"]["kind"] == "roster"
        with recruiting.forced_strength(st, ME, pid4, "playing_time", 1.0):
            assert scenes._role(st, ME, pid4) == "start"
            r = answer(sid, pid4, sc4, "promise")
        assert r["points"] == recruiting.ANSWER_PROMISE and r["truthful"] is True
        assert r["scene"]["question"]["reply"] == "That's what I needed to hear, Coach." == scenes.REPLY_LINES["promise"]
        assert abs(recruiting.pending(st, ME, pid4) - recruiting.ANSWER_PROMISE) < 1e-9
        c4 = rc["contacts"][pid4][ME]
        assert "cooled_until" not in c4 and c4["promises"][0]["kind"] == "roster" and c4["promises"][0]["broken"] is None
        assert not events(st, pid4, "not_buying")

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
            assert q7["text"] in [line.format(other=rc["prospects"][top]["name"]) for line in scenes.QUESTION_LINES["recruit"]]
            r = answer(sid, pid7, sc7, "promise")
            truthful = rc["prospects"][pid7]["ovr"] >= rc["prospects"][top]["ovr"]
            assert r["truthful"] is truthful and r["points"] == (recruiting.ANSWER_PROMISE if truthful else -recruiting.ANSWER_HOLLOW)
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
