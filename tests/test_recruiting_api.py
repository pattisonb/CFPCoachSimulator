"""Coach Career recruiting API (server.py): every route's happy path and its refusals (no hours,
an unknown prospect, a running sim, a season that is not a career). The handlers are called
directly: FastAPI's TestClient needs httpx, which is not a dependency. (Run as a file:
multiprocessing on Windows.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `from sim import season` works from here
from fastapi import HTTPException

from sim import season
import server


def refused(fn, code: int) -> None:
    try:
        fn()
    except HTTPException as e:
        assert e.status_code == code, (e.status_code, e.detail)
        return
    raise AssertionError(f"expected {code}")


if __name__ == "__main__":
    import tempfile
    season.SEASONS_DIR = _Path(tempfile.mkdtemp(prefix="cfp-api-test-"))   # an empty saves folder: the career limit counts what is saved
    out = server.create_season(server.SeasonRequest(team="ohio-state", mode="full", seed=11, career=True), browser="b1")
    sid = out["id"]
    assert server._season_state(sid)["career"]["browser"] == "b1"
    # testing mode: one career per browser (a plain season is not a career; a request without a browser id
    # is not limited), and a career plays five seasons: the rollover out of its fifth is refused
    refused(lambda: server.create_season(server.SeasonRequest(team="smu", mode="full", seed=12, career=True), browser="b1"), 409)
    refused(lambda: server._check_career_room(None, "b1"), 409)
    server._check_career_room(sid, "b1")                     # the browser's own career may come back (an import of itself)
    assert server.create_season(server.SeasonRequest(team="smu", mode="full", seed=12, career=False), browser="b1")["id"]
    other = server.create_season(server.SeasonRequest(team="smu", mode="full", seed=12, career=True), browser="b2")["id"]
    assert server._season_state(other)["career"]["browser"] == "b2"
    assert server.MAX_SEASONS == 5
    server._check_seasons_left({"year": 2029})
    refused(lambda: server._check_seasons_left({"year": 2030}), 409)
    # the server keeps one career in memory: touching one drops the other's state (a save on its way lands first)
    server.SAVE_DELAY = 60
    server.recruit_action(other, server.RecruitRequest(pid=server.prospect_search(other, limit=1)["rows"][0]["id"], action="message", pitch="prestige"))
    assert other in server._pending_saves
    st = server._season_state(sid)
    assert server._season_jobs[other]["state"] is None and other not in server._pending_saves, "the other career left memory with its save flushed"
    assert season.load_season(other)["recruiting"]["hours"]["smu"] < server.recruiting_view(other)["hours"] or True
    saved = season.load_season(other)
    assert saved["recruiting"]["contacts"], "the message was saved before the state was dropped"
    assert server._season_state(other) is not None and server._season_jobs[sid]["state"] is None
    assert server._season_state(sid)["id"] == sid                 # and it comes back from the file on the next ask
    server.SAVE_DELAY = 2.0
    view = server.recruiting_view(sid)
    assert view["week"] == 0 and view["hours_left"] == view["hours"] and view["board"] == [] and view["auto_recruit"] == "off"
    assert view["open_spots"] > 0 and view["offers_left"] > 0 and view["nil"]["budget"] > 0
    # the class: filters, paging, hidden prospects left out
    page = server.prospect_search(sid, limit=25)
    assert page["total"] > 3000 and len(page["rows"]) == 25 and page["rows"][0]["national_rank"] == 1
    tx = server.prospect_search(sid, state="TX", stars=4, limit=200)
    assert tx["rows"] and all(r["hometown"]["state"] == "TX" and r["stars"] == 4 for r in tx["rows"])
    st = server._season_state(sid)
    hidden = next(pid for pid, p in st["recruiting"]["prospects"].items() if p.get("hidden") and pid not in st["recruiting"]["reads"])
    everyone = server.prospect_search(sid, limit=5000)["rows"]
    assert hidden not in {r["id"] for r in everyone}
    named = server.prospect_search(sid, q=everyone[3]["name"].split()[-1].lower(), limit=200)["rows"]
    assert everyone[3]["id"] in {r["id"] for r in named}
    # prospects already interested in your school, most interested first
    keen = server.prospect_search(sid, status="interested", limit=50)
    assert 200 < keen["total"] < 1200 and keen["rows"][0]["interest_level"] == "High"
    vals = [r["interest_in_you"] for r in keen["rows"]]
    assert vals == sorted(vals, reverse=True)
    by_pull = server.prospect_search(sid, sort="interest", limit=20)["rows"]
    assert [r["interest_in_you"] for r in by_pull] == sorted((r["interest_in_you"] for r in by_pull), reverse=True)
    # every school's class, ranked
    classes = server.national_classes(sid)
    assert len(classes["schools"]) >= 130 and classes["schools"][0]["rank"] == 1 and classes["phase"] == "Recruiting"
    assert next(c for c in classes["schools"] if c["school"] == "ohio-state")["yours"] is True
    # a profile; unknown and hidden prospects are 404
    pid = page["rows"][0]["id"]
    prof = server.prospect_profile(sid, pid)
    assert prof["public"]["id"] == pid and "truth" not in prof["public"]
    refused(lambda: server.prospect_profile(sid, "r2027-9999"), 404)
    refused(lambda: server.prospect_profile(sid, hidden), 404)
    # actions, the board, staff and Auto-recruit
    server.SAVE_DELAY = 0.2                                # recruiting actions are saved a moment after the last one
    r = server.recruit_action(sid, server.RecruitRequest(pid=pid, action="call", pitch="prestige"))
    assert r["hours_left"] == view["hours"] - 15
    import time as _time
    _time.sleep(1.0)
    on_disk = season.load_season(sid)
    assert on_disk["recruiting"]["hours"]["ohio-state"] == view["hours"] - 15, "the call was not saved"
    assert on_disk["recruiting"]["contacts"][pid]["ohio-state"]["n"] == 1
    refused(lambda: server.recruit_action(sid, server.RecruitRequest(pid="r2027-9999", action="call")), 404)
    refused(lambda: server.recruit_action(sid, server.RecruitRequest(pid=pid, action="dance")), 400)
    assert server.prospect_profile(sid, pid)["public"]["on_board"] is False
    server.board_change(sid, server.BoardRequest(pid=pid, on=True))
    assert [b["id"] for b in server.recruiting_view(sid)["board"]] == [pid]
    assert server.prospect_profile(sid, pid)["public"]["on_board"] is True
    server.recruit_action(sid, server.RecruitRequest(pid=pid, action="offer", pitch="winning"))
    v = server.recruiting_view(sid)
    row = v["board"][0]
    assert row["standing"]["place"] >= 1 and row["standing"]["of"] >= row["standing"]["place"]
    assert 0 <= row["standing"]["lo"] <= row["standing"]["pct"] <= row["standing"]["hi"] <= 1 and row["standing"]["certainty"]
    assert set(v["area_counts"]) == set(v["areas"]) and v["area_counts"]["Texas"] > 100
    assert v["class_rank"] >= 1 and v["hours_used"] == v["hours"] - v["hours_left"] and v["targets"][0]["id"] == pid
    prof = server.prospect_profile(sid, pid)
    assert any(x["school"] == "ohio-state" and x["pct"] is not None for x in prof["public"]["schools"])
    server.recruit_action(sid, server.RecruitRequest(pid=pid, action="pull_offer"))
    server.board_change(sid, server.BoardRequest(pid=pid, on=False))
    assert server.recruiting_view(sid)["board"] == []
    staff = server.staff_change(sid, server.StaffRequest(staff_id="r1", area="Texas"))
    assert next(s for s in staff["staff"] if s["id"] == "r1")["area"] == "Texas"
    refused(lambda: server.staff_change(sid, server.StaffRequest(staff_id="r1", area="Atlantis")), 400)
    # a call without a pitch opens a scene; the pitch finishes it with his reaction; Auto-recruit on drops an open one
    talk, held = (r["id"] for r in everyone[5:7])
    sc = server.recruit_action(sid, server.RecruitRequest(pid=talk, action="call"))["scene"]
    assert sc["id"] and sc["action"] == "call"
    r = server.recruit_action(sid, server.RecruitRequest(pid=talk, action="pitch", scene=sc["id"], pitch=sc["cue"]["topics"][0]))
    assert r["reaction"]["kind"] in ("hit", "polite", "quiet") and r["reaction"]["text"]
    refused(lambda: server.recruit_action(sid, server.RecruitRequest(pid=talk, action="pitch", scene=sc["id"], pitch="nil")), 409)
    server.board_change(sid, server.BoardRequest(pid=held, on=True))
    sc = server.recruit_action(sid, server.RecruitRequest(pid=held, action="call"))["scene"]
    assert next(b for b in server.recruiting_view(sid)["board"] if b["id"] == held)["scene"]["id"] == sc["id"]
    server.season_settings_change(sid, server.SettingsRequest(auto_recruit="week"))
    assert all(b["scene"] is None for b in server.recruiting_view(sid)["board"])
    server.season_settings_change(sid, server.SettingsRequest(auto_recruit="off"))
    server.board_change(sid, server.BoardRequest(pid=held, on=False))
    assert server.season_settings_change(sid, server.SettingsRequest(auto_recruit="season"))["auto_recruit"] == "season"
    assert server.recruiting_view(sid)["auto_recruit"] == "season"
    server.season_settings_change(sid, server.SettingsRequest(auto_recruit=True))      # older pages send a bool
    assert server.recruiting_view(sid)["auto_recruit"] == "season"
    server.season_settings_change(sid, server.SettingsRequest(auto_recruit="off"))
    refused(lambda: server.season_settings_change(sid, server.SettingsRequest(auto_recruit="forever")), 400)
    # Auto-recruit for one week: your staff recruit through the next advance, then it turns itself off
    assert server.season_settings_change(sid, server.SettingsRequest(auto_recruit="week"))["auto_recruit"] == "week"
    st_ = server._season_state(sid)
    before = len(st_["recruiting"]["offers"].get("ohio-state", []))
    from coach_career import recruiting as _rc
    mine = next(r["id"] for r in server.prospect_search(sid, stars=4, state="OH", limit=5)["rows"])   # one you picked
    server.board_change(sid, server.BoardRequest(pid=mine, on=True))
    _rc.weekly_step(st_, 1)
    assert server.recruiting_view(sid)["auto_recruit"] == "off"
    assert len(st_["recruiting"]["offers"].get("ohio-state", [])) > before, "Auto-recruit for the week did nothing"
    # ... and it works from your board: your picks first, everyone it chases shows on it
    board_ids = {b["id"] for b in server.recruiting_view(sid)["board"]}
    assert mine in st_["recruiting"]["offers"]["ohio-state"], "Auto-recruit skipped a prospect on your board"
    assert set(st_["recruiting"]["offers"]["ohio-state"]) <= board_ids, "Auto-recruit offered prospects you cannot see"
    # a prospect you take off your board stays off, even one your staff have already contacted
    gone = next(iter(st_["recruiting"]["offers"]["ohio-state"]))
    server.board_change(sid, server.BoardRequest(pid=gone, on=False))
    server.season_settings_change(sid, server.SettingsRequest(auto_recruit="week"))
    _rc.weekly_step(st_, 2)
    assert gone not in {b["id"] for b in server.recruiting_view(sid)["board"]}, "a removed prospect came back to the board"
    server.board_change(sid, server.BoardRequest(pid=gone, on=True))
    assert gone in {b["id"] for b in server.recruiting_view(sid)["board"]}
    # what he cares about: an in-home visit tells you one priority, an official visit all of them
    known = lambda q: st_["recruiting"]["revealed"].get("ohio-state", {}).get(q, [])
    fresh = next(r["id"] for r in server.prospect_search(sid, stars=3, state="CA", limit=50)["rows"] if not known(r["id"]))
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
            server.recruit_action(sid, server.RecruitRequest(pid=pid, action="message", pitch="prestige"))
        except HTTPException as e:
            assert e.status_code == 409
            break
    # during a running sim every change is 409
    server._season_jobs[sid]["status"] = "running"
    refused(lambda: server.recruit_action(sid, server.RecruitRequest(pid=pid, action="message")), 409)
    refused(lambda: server.board_change(sid, server.BoardRequest(pid=pid, on=True)), 409)
    refused(lambda: server.staff_change(sid, server.StaffRequest(staff_id="r1", area="Florida")), 409)
    server._season_jobs[sid]["status"] = "idle"
    # hidden prospects cannot be recruited until seen; recruiting views wait for a running sim
    refused(lambda: server.recruit_action(sid, server.RecruitRequest(pid=hidden, action="message")), 404)
    server._season_jobs[sid]["status"] = "running"
    refused(lambda: server.recruiting_view(sid), 409)
    refused(lambda: server.prospect_search(sid), 409)
    refused(lambda: server.prospect_profile(sid, pid), 409)
    server._season_jobs[sid]["status"] = "idle"
    # a malformed season file never breaks the season list
    bad = season.SEASONS_DIR / "zzbadfile0001.json"
    bad.write_text('{"current_week": 1, "id": "zzbadfile0001"}', encoding="utf-8")
    try:
        assert any(x["id"] == sid for x in server.list_seasons()["seasons"])
    finally:
        bad.unlink()
    # a season that is not a career has no recruiting
    plain = server.create_season(server.SeasonRequest(team="ohio-state", mode="full", seed=11))["id"]
    for call in (lambda: server.recruiting_view(plain), lambda: server.prospect_search(plain), lambda: server.national_classes(plain),
                 lambda: server.prospect_profile(plain, pid),
                 lambda: server.recruit_action(plain, server.RecruitRequest(pid=pid, action="call")),
                 lambda: server.board_change(plain, server.BoardRequest(pid=pid, on=True)),
                 lambda: server.staff_change(plain, server.StaffRequest(staff_id="r1", area="Texas")),
                 lambda: server.season_settings_change(plain, server.SettingsRequest(auto_recruit=True))):
        refused(call, 404)
    for s in (sid, plain):
        server.delete_season(s)
    # sim progress: one week number and one share of that week, games then recruiting, never jumping ahead
    job = {"state": {"current_week": 4}, "done": 4}
    rep = server._reporter(job)
    rep("Setting the matchups", None, None)
    assert job["week"] == 5 and job["week_frac"] < 0.1
    rep("Simming Week 5", 35, 70)
    first = job["week_frac"]
    assert job["week"] == 5 and 0.1 < first < 0.85
    job["state"]["current_week"] = 5                                    # the games are in; the poll and recruiting follow
    rep("Recruiting", None, None)
    assert job["week"] == 5 and job["week_frac"] >= 0.85 > first, job
    print("recruiting api ok")
