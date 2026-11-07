"""A kept "roster" promise follows him onto your roster: a recruit (high school or portal) you told
the job was his carries `promised` when he signs with you (offseason._sign_classes, _close_portal),
and the next offseason a season off the starting lineup costs PROMISE_BROKEN times (portal_odds), his
Keep Them Home card saying so; a season as the starter costs nothing. (Run as a file.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))
_sys.path.insert(0, str(_Path(__file__).resolve().parent))

from app import api
from coach_career import offseason
from coach_career import recruiting
from coach_career import scenes
from sim import season
from test_offseason import finished
from test_portal_drivers import TOP, YEAR, mini_league, mini_state, usage_for
from test_recruit_questions import ME, answer, best_ahead, call, cold


def odds(p: dict, use: str, **ctx) -> float:
    c = {"losing": False, "p4": True, "year": YEAR, "tier": 1, "slipping": None, "rising": False, **ctx}
    return sum(v for _, v in offseason.portal_odds(p, use, c))


if __name__ == "__main__":
    import shutil
    import tempfile
    # ----- the rule: a promise he was given the year before, and a season off the lineup -----
    plain = {"id": "x", "n": "Khalil Telfair", "pos": "WR", "cls": "SO", "o": 60, "s": 4, "r": []}
    promised = dict(plain, promised=YEAR - 1)
    assert offseason.PROMISE_BROKEN == 3.0
    for use in ("bench", "rotation"):
        assert abs(odds(promised, use) - offseason.PROMISE_BROKEN * odds(plain, use)) < 1e-9, use
        assert dict(offseason.portal_odds(promised, use, {"losing": False, "p4": True, "year": YEAR, "tier": 5, "slipping": None, "rising": False})).get("promised", 0) > 0
    assert odds(promised, "starter") == odds(plain, "starter"), "he started: the promise was kept"
    assert "promised" not in dict(offseason.portal_odds(promised, "starter", {"losing": False, "p4": True, "year": YEAR, "tier": 1, "slipping": None, "rising": False}))
    assert odds(dict(plain, promised=YEAR - 2), "bench") == odds(plain, "bench"), "an older promise is forgotten"
    assert abs(odds(dict(promised, kept=YEAR - 1), "bench") - offseason.PROMISE_BROKEN * odds(plain, "bench")) < 1e-9, "a keep does not soften a broken promise"
    assert offseason.REASONS["promised"] == "Was promised a starting role and did not get it"

    # ----- the departures say so: the segment the draw lands in is why he goes, and his card reads it -----
    saw = False
    for seed in range(40):
        lgd = mini_league()
        st = mini_state(seed)
        st["team"] = TOP
        qb = lgd["teams"][TOP]["roster"][0]
        qb["promised"] = YEAR - 1
        usage = usage_for(lgd)
        usage[TOP][qb["id"]] = "bench"                       # judged by the role he really played
        events, entrants, pending = offseason._departures(st, lgd, usage, shifts={})
        item = next((x for x in pending if x["ev"]["id"] == qb["id"]), None)
        if item and item.get("driver") == "promised":
            rows = offseason._retention_entries(st, lgd, pending)
            row = next(r for r in rows if r["id"] == qb["id"])
            assert row["reason"] == "Was promised a starting role and did not get it" and row["reason_key"] == "promised", row
            saw = True
            break
    assert saw, "no seed where the promise drove him out"
    for seed in range(40):                                    # the starter he was promised to be: never the promise
        lgd = mini_league()
        st = mini_state(seed)
        st["team"] = TOP
        lgd["teams"][TOP]["roster"][0]["promised"] = YEAR - 1
        events, entrants, pending = offseason._departures(st, lgd, usage_for(lgd), shifts={})
        assert all(x.get("driver") != "promised" for x in pending)

    # ----- through the game: a recruit promised the job signs, and the promise is on his roster record -----
    season.SEASONS_DIR = _Path(tempfile.mkdtemp(prefix="cfp-promise-follows-"))
    scenes.QUESTION_RATE = 1.0
    try:
        sid = api.call("POST", "/api/season", {"team": ME, "mode": "full", "seed": 11, "career": True})["id"]
        st = api.loaded_state()
        rc = st["recruiting"]
        used: set = set()
        pid = None
        while pid is None:
            cand = cold(st, True, used)
            if best_ahead(st, cand) is not None:
                pid = cand
        sc = call(sid, pid)
        assert sc["question"]["kind"] == "roster"
        r = answer(sid, pid, sc, "promise")                   # believable or not: he was told the job was his
        assert rc["contacts"][pid][ME]["promises"][0]["kind"] == "roster"
        hollow = r["truthful"] is False
        finished(st)
        for q_ in rc["status"].values():
            if q_["signed"] == ME:
                q_["signed"] = None
        rc["status"][pid]["signed"] = ME
        off = offseason.start(st)
        roster = {c["id"]: c for c in st["league"]["teams"][ME]["roster"]}
        assert roster[pid]["promised"] == off["year"], (hollow, roster[pid])
        assert roster[pid]["cls"] == "FR" and roster[pid].get("signed")
        # the portal: a transfer promised the job carries it too
        api._save_loaded()
        while api.loaded_state()["offseason"]["stage"] != "portal_w1":
            api.call("POST", f"/api/season/{sid}/offseason/advance", {})
        st = api.loaded_state()
        rc = st["recruiting"]
        assert recruiting.is_portal(st)
        pid2 = next(c for c in recruiting.prospect_list(st)
                    if "playing_time" in rc["prospects"][c]["priorities"] and recruiting.ahead_of(st, ME, c) and not rc["status"][c]["committed"])
        sc2 = call(sid, pid2)
        assert sc2["question"]["kind"] == "roster"
        answer(sid, pid2, sc2, "promise")
        pid3 = next(c for c in recruiting.prospect_list(st) if c != pid2 and not rc["status"][c]["committed"])     # signs with no promise
        for pid_ in (pid2, pid3):
            rc["status"][pid_].update(committed=ME, signed=ME)
        offseason._close_portal(st)
        roster = {c["id"]: c for c in st["league"]["teams"][ME]["roster"]}
        assert roster[pid2]["promised"] == st["offseason"]["year"] and roster[pid2].get("transfer"), roster[pid2]
        assert "promised" not in roster[pid3]
        print("ok")
    finally:
        shutil.rmtree(season.SEASONS_DIR, ignore_errors=True)
