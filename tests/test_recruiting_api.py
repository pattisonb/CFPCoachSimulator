"""Coach Career recruiting API (app/api.py): every route's happy path and its refusals (no hours,
an unknown prospect, a running sim). The routes are called through `api.call`, as the page's
requests are. Saves go to a temporary folder. (Run as a file: multiprocessing on Windows.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `from sim import season` works from here

from app import api
from coach_career import recruiting as _rc
from sim import season


def refused(fn, code: int) -> None:
    try:
        fn()
    except api.ApiError as e:
        assert e.status == code, (e.status, e.message)
        return
    raise AssertionError(f"expected {code}")


def search(sid: str, **query) -> dict:
    """GET /prospects with these query parameters."""
    qs = "&".join(f"{k}={v}" for k, v in query.items())
    return api.call("GET", f"/api/season/{sid}/prospects" + (f"?{qs}" if qs else ""))


def G(sid: str, path: str) -> dict:
    return api.call("GET", f"/api/season/{sid}/{path}")


def R(sid: str, path: str, body: dict) -> dict:
    return api.call("POST", f"/api/season/{sid}/{path}", body)


if __name__ == "__main__":
    import shutil
    import tempfile
    season.SEASONS_DIR = _Path(tempfile.mkdtemp(prefix="cfp-api-test-"))
    try:
        sid = api.call("POST", "/api/season", {"team": "ohio-state", "mode": "full", "seed": 11, "career": True})["id"]
        other = api.call("POST", "/api/season", {"team": "smu", "mode": "full", "seed": 12, "career": True})["id"]
        # one career in memory: a recruiting action is saved at once, and touching the other career
        # replaces it in memory; it comes back from its file on the next ask
        R(other, "recruit", {"pid": search(other, limit=1)["rows"][0]["id"], "action": "message", "pitch": "prestige"})
        assert api.loaded_state()["id"] == other
        assert api.call("GET", f"/api/season/{sid}")["id"] == sid
        assert api.loaded_state()["id"] == sid, "the other career left memory"
        assert season.load_season(other)["recruiting"]["contacts"], "the message was saved before the state was dropped"
        assert api.call("GET", f"/api/season/{other}")["id"] == other and api.loaded_state()["id"] == other
        assert api.call("GET", f"/api/season/{sid}")["id"] == sid    # and it comes back from the file on the next ask
        view = G(sid, "recruiting")
        assert view["week"] == 0 and view["hours_left"] == view["hours"] and view["board"] == [] and view["auto_recruit"] == "off"
        assert view["open_spots"] > 0 and view["offers_left"] > 0 and view["nil"]["budget"] > 0
        # the class: filters, paging, hidden prospects left out
        page = search(sid, limit=25)
        assert page["total"] > 3000 and len(page["rows"]) == 25 and page["rows"][0]["national_rank"] == 1
        tx = search(sid, state="TX", stars=4, limit=200)
        assert tx["rows"] and all(r["hometown"]["state"] == "TX" and r["stars"] == 4 for r in tx["rows"])
        refused(lambda: search(sid, stars="four"), 422)
        st = api.loaded_state()
        hidden = next(pid for pid, p in st["recruiting"]["prospects"].items() if p.get("hidden") and pid not in st["recruiting"]["reads"])
        everyone = search(sid, limit=5000)["rows"]
        assert hidden not in {r["id"] for r in everyone}
        named = search(sid, q=everyone[3]["name"].split()[-1].lower(), limit=200)["rows"]
        assert everyone[3]["id"] in {r["id"] for r in named}
        # prospects already interested in your school, most interested first
        keen = search(sid, status="interested", limit=50)
        assert 200 < keen["total"] < 1200 and keen["rows"][0]["interest_level"] == "High"
        vals = [r["interest_in_you"] for r in keen["rows"]]
        assert vals == sorted(vals, reverse=True)
        by_pull = search(sid, sort="interest", limit=20)["rows"]
        assert [r["interest_in_you"] for r in by_pull] == sorted((r["interest_in_you"] for r in by_pull), reverse=True)
        # every school's class, ranked
        classes = G(sid, "classes")
        assert len(classes["schools"]) >= 130 and classes["schools"][0]["rank"] == 1 and classes["phase"] == "Recruiting"
        assert next(c for c in classes["schools"] if c["school"] == "ohio-state")["yours"] is True
        refused(lambda: G(sid, "classes?school=nope"), 404)
        # a profile; unknown and hidden prospects are 404
        pid = page["rows"][0]["id"]
        prof = G(sid, f"prospect/{pid}")
        assert prof["public"]["id"] == pid and "truth" not in prof["public"]
        refused(lambda: G(sid, "prospect/r2027-9999"), 404)
        refused(lambda: G(sid, f"prospect/{hidden}"), 404)
        # actions, the board, staff and Auto-recruit; a recruiting action is saved before the call returns
        api.changed()
        r = R(sid, "recruit", {"pid": pid, "action": "call", "pitch": "prestige"})
        assert r["hours_left"] == view["hours"] - 15 and api.changed()
        on_disk = season.load_season(sid)
        assert on_disk["recruiting"]["hours"]["ohio-state"] == view["hours"] - 15, "the call was not saved"
        assert on_disk["recruiting"]["contacts"][pid]["ohio-state"]["n"] == 1
        refused(lambda: R(sid, "recruit", {"pid": "r2027-9999", "action": "call"}), 404)
        refused(lambda: R(sid, "recruit", {"pid": pid, "action": "dance"}), 400)
        refused(lambda: R(sid, "recruit", {"pid": pid}), 422)
        assert G(sid, f"prospect/{pid}")["public"]["on_board"] is False
        R(sid, "board", {"pid": pid, "on": True})
        assert [b["id"] for b in G(sid, "recruiting")["board"]] == [pid]
        assert G(sid, f"prospect/{pid}")["public"]["on_board"] is True
        R(sid, "recruit", {"pid": pid, "action": "offer", "pitch": "winning"})
        v = G(sid, "recruiting")
        row = v["board"][0]
        assert row["standing"]["place"] >= 1 and row["standing"]["of"] >= row["standing"]["place"]
        assert 0 <= row["standing"]["lo"] <= row["standing"]["pct"] <= row["standing"]["hi"] <= 1 and row["standing"]["certainty"]
        assert set(v["area_counts"]) == set(v["areas"]) and v["area_counts"]["Texas"] > 100
        assert v["class_rank"] >= 1 and v["hours_used"] == v["hours"] - v["hours_left"] and v["targets"][0]["id"] == pid
        prof = G(sid, f"prospect/{pid}")
        assert any(x["school"] == "ohio-state" and x["pct"] is not None for x in prof["public"]["schools"])
        R(sid, "recruit", {"pid": pid, "action": "pull_offer"})
        R(sid, "board", {"pid": pid, "on": False})
        assert G(sid, "recruiting")["board"] == []
        staff = R(sid, "staff", {"staff_id": "r1", "area": "Texas"})
        assert next(s for s in staff["staff"] if s["id"] == "r1")["area"] == "Texas"
        refused(lambda: R(sid, "staff", {"staff_id": "r1", "area": "Atlantis"}), 400)
        refused(lambda: R(sid, "staff", {"staff_id": "r1"}), 422)
        # a call without a pitch opens a scene; the pitch finishes it with his reaction; Auto-recruit on drops an open one
        talk, held = (r["id"] for r in everyone[5:7])
        sc = R(sid, "recruit", {"pid": talk, "action": "call"})["scene"]
        assert sc["id"] and sc["action"] == "call" and "question" in sc
        # the conversation opens with you and his small talk; the cue and his question wait on your opening (three topics)
        assert [t["who"] for t in sc["turns"]] == ["you", "him"] and sc["cue"] is None and sc["presented"] is None
        refused(lambda: R(sid, "recruit", {"pid": talk, "action": "pitch", "scene": sc["id"], "pitch": "winning"}), 409)
        refused(lambda: R(sid, "recruit", {"pid": talk, "action": "present", "scene": sc["id"], "topics": ["winning", "nil"]}), 400)
        refused(lambda: R(sid, "recruit", {"pid": talk, "action": "present", "scene": sc["id"], "topics": ["winning", "nil", "nil"]}), 400)
        refused(lambda: R(sid, "recruit", {"pid": talk, "action": "present", "scene": sc["id"], "topics": "winning"}), 422)
        refused(lambda: R(sid, "recruit", {"pid": talk, "action": "present", "scene": "nope", "topics": ["winning", "nil", "coach"]}), 409)
        st_ = api.loaded_state()
        pri = st_["recruiting"]["prospects"][talk]["priorities"]
        str_ = _rc.strengths(st_, "ohio-state", talk)
        strong = [t for t in pri if str_[t] >= _rc.BACKFIRE]
        weak = [t for t in pri if str_[t] < _rc.BACKFIRE]
        misses = [t for t in _rc.PITCHES if t not in pri]
        three = (strong[:1] or weak[:1]) + misses[:2]
        pr = R(sid, "recruit", {"pid": talk, "action": "present", "scene": sc["id"], "topics": three})
        sc = pr["scene"]
        assert sc["presented"] == three and sc["cue"]["topics"] and [t["who"] for t in sc["turns"][:6]] == ["you", "him", "you", "him", "you", "him"]
        if strong:
            assert pr["points"] > 0 and pr["hit"] == strong[:1] and sc["present"]["kind"] == "hit", pr
        elif weak:
            assert pr["points"] < 0 and pr["hit"] == [] and sc["present"]["kind"] == "quiet", pr
        assert abs(_rc.pending(st_, "ohio-state", talk) - pr["points"]) < 1e-9
        refused(lambda: R(sid, "recruit", {"pid": talk, "action": "present", "scene": sc["id"], "topics": three}), 409)
        assert st_["recruiting"]["scenes"]["ohio-state"][talk]["presented"] == three, "the scene remembers your opening (Finish resumes it)"
        if sc["question"]:                                   # he asked about a named player: the pitch waits on an answer
            refused(lambda: R(sid, "recruit", {"pid": talk, "action": "pitch", "scene": sc["id"], "pitch": sc["cue"]["topics"][0]}), 409)
            assert R(sid, "recruit", {"pid": talk, "action": "answer", "scene": sc["id"], "answer": "deflect"})["points"] == 0.0
        r = R(sid, "recruit", {"pid": talk, "action": "pitch", "scene": sc["id"], "pitch": sc["cue"]["topics"][0]})
        assert r["reaction"]["kind"] in ("hit", "polite", "quiet") and r["reaction"]["text"]
        refused(lambda: R(sid, "recruit", {"pid": talk, "action": "pitch", "scene": sc["id"], "pitch": "nil"}), 409)
        R(sid, "board", {"pid": held, "on": True})
        sc = R(sid, "recruit", {"pid": held, "action": "call"})["scene"]
        assert next(b for b in G(sid, "recruiting")["board"] if b["id"] == held)["scene"]["id"] == sc["id"]
        R(sid, "settings", {"auto_recruit": "week"})
        assert all(b["scene"] is None for b in G(sid, "recruiting")["board"])
        R(sid, "settings", {"auto_recruit": "off"})
        R(sid, "board", {"pid": held, "on": False})
        assert R(sid, "settings", {"auto_recruit": "season"})["auto_recruit"] == "season"
        assert G(sid, "recruiting")["auto_recruit"] == "season"
        R(sid, "settings", {"auto_recruit": True})      # older pages send a bool
        assert G(sid, "recruiting")["auto_recruit"] == "season"
        R(sid, "settings", {"auto_recruit": "off"})
        refused(lambda: R(sid, "settings", {"auto_recruit": "forever"}), 400)
        refused(lambda: R(sid, "settings", {"auto_recruit": 3}), 422)
        # Auto-recruit for one week: your staff recruit through the next advance, then it turns itself off
        assert R(sid, "settings", {"auto_recruit": "week"})["auto_recruit"] == "week"
        st_ = api.loaded_state()
        before = len(st_["recruiting"]["offers"].get("ohio-state", []))
        mine = next(r["id"] for r in search(sid, stars=4, state="OH", limit=5)["rows"])   # one you picked
        R(sid, "board", {"pid": mine, "on": True})
        _rc.weekly_step(st_, 1)
        assert G(sid, "recruiting")["auto_recruit"] == "off"
        assert len(st_["recruiting"]["offers"].get("ohio-state", [])) > before, "Auto-recruit for the week did nothing"
        # the contact log: your staff's actions on Auto are logged as yours; the other schools' contacts are not logged at all
        mine_kinds = ("contact", "pitch", "raise_nil", "pull_offer")
        assert any(e["kind"] == "contact" and e["school"] == "ohio-state" for e in st_["recruiting"]["log"]), "Auto-recruit's contacts not logged"
        assert all(e["school"] == "ohio-state" for e in st_["recruiting"]["log"] if e["kind"] in mine_kinds), "another school's contact was logged"
        # ... and it works from your board: your picks first, everyone it chases shows on it
        board_ids = {b["id"] for b in G(sid, "recruiting")["board"]}
        assert mine in st_["recruiting"]["offers"]["ohio-state"], "Auto-recruit skipped a prospect on your board"
        assert set(st_["recruiting"]["offers"]["ohio-state"]) <= board_ids, "Auto-recruit offered prospects you cannot see"
        # a prospect you take off your board stays off, even one your staff have already contacted
        gone = next(iter(st_["recruiting"]["offers"]["ohio-state"]))
        R(sid, "board", {"pid": gone, "on": False})
        R(sid, "settings", {"auto_recruit": "week"})
        _rc.weekly_step(st_, 2)
        assert gone not in {b["id"] for b in G(sid, "recruiting")["board"]}, "a removed prospect came back to the board"
        R(sid, "board", {"pid": gone, "on": True})
        assert gone in {b["id"] for b in G(sid, "recruiting")["board"]}
        # what he cares about: an in-home visit tells you one priority, an official visit all of them
        known = lambda q: st_["recruiting"]["revealed"].get("ohio-state", {}).get(q, [])
        fresh = next(r["id"] for r in search(sid, stars=3, state="CA", limit=50)["rows"] if not known(r["id"]))
        _rc._act(st_, "ohio-state", fresh, "hc_visit")
        assert len(known(fresh)) == 1, known(fresh)
        _rc._act(st_, "ohio-state", fresh, "official_visit")
        vw = st_["recruiting"]["visits"][fresh]["ohio-state"]["week"]
        game = next(g for g in st_["games"].values() if g["week"] == vw and g["home"] == "ohio-state")
        game.update(played=True, home_score=31, away_score=10)          # the visit's home game, as if just played
        _rc._visits(st_, vw)
        game.update(played=False)
        assert len(known(fresh)) == 3, known(fresh)
        # out of hours: 409
        while True:
            try:
                R(sid, "recruit", {"pid": pid, "action": "message", "pitch": "prestige"})
            except api.ApiError as e:
                assert e.status == 409
                break
        # during a running sim every change is 409
        api.job()["status"] = "running"
        refused(lambda: R(sid, "recruit", {"pid": pid, "action": "message"}), 409)
        refused(lambda: R(sid, "board", {"pid": pid, "on": True}), 409)
        refused(lambda: R(sid, "staff", {"staff_id": "r1", "area": "Florida"}), 409)
        api.job()["status"] = "idle"
        # hidden prospects cannot be recruited until seen; recruiting views wait for a running sim
        refused(lambda: R(sid, "recruit", {"pid": hidden, "action": "message"}), 404)
        api.job()["status"] = "running"
        refused(lambda: G(sid, "recruiting"), 409)
        refused(lambda: search(sid), 409)
        refused(lambda: G(sid, f"prospect/{pid}"), 409)
        api.job()["status"] = "idle"
        # a malformed season file never breaks the season list
        bad = season.SEASONS_DIR / "zzbadfile0001.json"
        bad.write_text('{"current_week": 1, "id": "zzbadfile0001"}', encoding="utf-8")
        try:
            assert any(x["id"] == sid for x in api.call("GET", "/api/seasons")["seasons"])
        finally:
            bad.unlink()
        # History: every action you take on him, newest first, with what you pitched, his reaction and the NIL
        logc = api.call("POST", "/api/season", {"team": "ohio-state", "mode": "full", "seed": 13, "career": True})["id"]
        two = [r["id"] for r in search(logc, limit=40)["rows"][20:22]]
        a, b = two
        for q in two:
            R(logc, "board", {"pid": q, "on": True})
        hist = lambda q: next(x for x in G(logc, "recruiting")["board"] if x["id"] == q)["history"]
        assert hist(a) == [] and hist(b) == [], "an untouched recruit has an empty history"
        R(logc, "recruit", {"pid": a, "action": "message", "pitch": "prestige"})
        sc = R(logc, "recruit", {"pid": a, "action": "call"})["scene"]
        sc = R(logc, "recruit", {"pid": a, "action": "present", "scene": sc["id"], "topics": ["winning", "nil", "coach"]})["scene"]
        topic = sc["cue"]["topics"][0]
        if sc["question"]:
            R(logc, "recruit", {"pid": a, "action": "answer", "scene": sc["id"], "answer": "deflect"})
        said = R(logc, "recruit", {"pid": a, "action": "pitch", "scene": sc["id"], "pitch": topic})["reaction"]["kind"]
        R(logc, "recruit", {"pid": a, "action": "offer", "pitch": "winning", "nil": 120})
        R(logc, "recruit", {"pid": a, "action": "raise_nil", "nil": 150})
        h = [x for x in hist(a) if x["kind"] not in ("not_buying", "answer")]   # a backfiring pitch may add a not_buying line; his question an answer
        got = [(x["kind"], x.get("action"), x.get("pitch"), x.get("reaction"), x.get("nil")) for x in h]
        assert got == [("raise_nil", None, None, None, 150), ("offer", None, None, None, 120),
                       ("pitch", "call", topic, said, None), ("present", "call", None, None, None), ("contact", "call", None, None, None),
                       ("contact", "message", "prestige", None, None)], got
        assert all(x["week"] == 0 and x["school"] == "ohio-state" for x in h), h
        pres = next(x for x in h if x["kind"] == "present")
        assert pres["topics"] == ["winning", "nil", "coach"] and isinstance(pres["hit"], int), pres
        assert hist(b) == [], "his history is his alone"
        st_ = api.loaded_state()
        _rc._act(st_, "michigan", a, "offer", pitch="winning")        # another school's offer shows; its contacts do not
        _rc._act(st_, "michigan", a, "message", pitch="winning")
        assert [(x["kind"], x["school"]) for x in hist(a)[:2]] == [("offer", "michigan"), ("raise_nil", "ohio-state")], hist(a)[:2]
        # a long career: the last 40 entries for him, newest first
        for w in range(1, 51):
            st_["current_week"] = w
            st_["recruiting"]["hours"] = {}
            R(logc, "recruit", {"pid": a, "action": "message", "pitch": "coach"})
        h = hist(a)
        assert len(h) == 40 and h[0]["week"] == 50 and h[-1]["week"] >= 11, (len(h), h[0], h[-1])
        assert [x["week"] for x in h] == sorted((x["week"] for x in h), reverse=True)
        api.call("DELETE", f"/api/season/{logc}")
        for s in (sid, other):
            api.call("DELETE", f"/api/season/{s}")
        # sim progress: one week number and one share of that week, games then recruiting, never jumping ahead
        api.job().update(done=4)
        state = {"current_week": 4}
        rep = api._reporter(state, None)
        rep("Setting the matchups", None, None)
        assert api.job()["week"] == 5 and api.job()["week_frac"] < 0.1
        rep("Simming Week 5", 35, 70)
        first = api.job()["week_frac"]
        assert api.job()["week"] == 5 and 0.1 < first < 0.85
        state["current_week"] = 5                                    # the games are in; the poll and recruiting follow
        rep("Recruiting", None, None)
        assert api.job()["week"] == 5 and api.job()["week_frac"] >= 0.85 > first, api.job()
    finally:
        season.close_pool()
        shutil.rmtree(season.SEASONS_DIR, ignore_errors=True)
    print("recruiting api ok")
