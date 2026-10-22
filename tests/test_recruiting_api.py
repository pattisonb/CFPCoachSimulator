"""Coach Career recruiting API (server.py): every route's happy path and its refusals (no hours,
an unknown prospect, a running sim, a season that is not a career). The handlers are called
directly: FastAPI's TestClient needs httpx, which is not a dependency. (Run as a file:
multiprocessing on Windows.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `import season` works from here
from fastapi import HTTPException

import season
import server


def refused(fn, code: int) -> None:
    try:
        fn()
    except HTTPException as e:
        assert e.status_code == code, (e.status_code, e.detail)
        return
    raise AssertionError(f"expected {code}")


if __name__ == "__main__":
    out = server.create_season(server.SeasonRequest(team="ohio-state", mode="full", seed=11, career=True))
    sid = out["id"]
    view = server.recruiting_view(sid)
    assert view["week"] == 0 and view["hours_left"] == view["hours"] and view["board"] == [] and view["auto_recruit"] is False
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
    # a profile; unknown and hidden prospects are 404
    pid = page["rows"][0]["id"]
    prof = server.prospect_profile(sid, pid)
    assert prof["public"]["id"] == pid and "truth" not in prof["public"]
    refused(lambda: server.prospect_profile(sid, "r2027-9999"), 404)
    refused(lambda: server.prospect_profile(sid, hidden), 404)
    # actions, the board, staff and Auto-recruit
    r = server.recruit_action(sid, server.RecruitRequest(pid=pid, action="call", pitch="prestige"))
    assert r["hours_left"] == view["hours"] - 15
    refused(lambda: server.recruit_action(sid, server.RecruitRequest(pid="r2027-9999", action="call")), 404)
    refused(lambda: server.recruit_action(sid, server.RecruitRequest(pid=pid, action="dance")), 400)
    assert server.prospect_profile(sid, pid)["public"]["on_board"] is False
    server.board_change(sid, server.BoardRequest(pid=pid, on=True))
    assert [b["id"] for b in server.recruiting_view(sid)["board"]] == [pid]
    assert server.prospect_profile(sid, pid)["public"]["on_board"] is True
    server.board_change(sid, server.BoardRequest(pid=pid, on=False))
    assert server.recruiting_view(sid)["board"] == []
    staff = server.staff_change(sid, server.StaffRequest(staff_id="r1", area="Texas"))
    assert next(s for s in staff["staff"] if s["id"] == "r1")["area"] == "Texas"
    refused(lambda: server.staff_change(sid, server.StaffRequest(staff_id="r1", area="Atlantis")), 400)
    assert server.season_settings_change(sid, server.SettingsRequest(auto_recruit=True))["auto_recruit"] is True
    assert server.recruiting_view(sid)["auto_recruit"] is True
    server.season_settings_change(sid, server.SettingsRequest(auto_recruit=False))
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
    for call in (lambda: server.recruiting_view(plain), lambda: server.prospect_search(plain),
                 lambda: server.prospect_profile(plain, pid),
                 lambda: server.recruit_action(plain, server.RecruitRequest(pid=pid, action="call")),
                 lambda: server.board_change(plain, server.BoardRequest(pid=pid, on=True)),
                 lambda: server.staff_change(plain, server.StaffRequest(staff_id="r1", area="Texas")),
                 lambda: server.season_settings_change(plain, server.SettingsRequest(auto_recruit=True))):
        refused(call, 404)
    for s in (sid, plain):
        server.delete_season(s)
    print("recruiting api ok")
