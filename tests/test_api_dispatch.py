"""The Coach Career dispatcher (app/api.py): routing, the season routes (create, get, list,
delete, export, import), the teams and the coach routes, and advance / game day run as steps. Saves go to temporary folders, so
nothing is left in data/seasons or data/coaches. (Run as a file: multiprocessing on Windows.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `from app import api` works from here

from app import api
from sim import coaches
from sim import season


def refused(fn, code: int) -> None:
    try:
        fn()
    except api.ApiError as e:
        assert e.status == code, (e.status, e.message)
        return
    raise AssertionError(f"expected {code}")


def test_unknown_route():
    refused(lambda: api.call("GET", "/api/nothing"), 404)
    refused(lambda: api.call("DELETE", "/api/teams"), 405)


def test_teams_and_coach_options():
    assert any(t["slug"] == "smu" for t in api.call("GET", "/api/teams")["teams"])
    assert api.call("GET", "/api/teams/smu")["slug"] == "smu"
    refused(lambda: api.call("GET", "/api/teams/nope"), 404)
    opts = api.call("GET", "/api/coach-options")          # the coach page's option lists
    assert opts["archetypes"] and opts["offense_schemes"] and opts["defense_schemes"] and opts["blank"]


def test_create_get_list_delete_career():
    s = api.call("POST", "/api/season", {"team": "smu", "seed": 11, "career": True})
    assert s["career"] and api.changed() and not api.changed()
    assert api.loaded_state()["id"] == s["id"] and api.job()["status"] == "idle"
    assert api.call("GET", f"/api/season/{s['id']}")["id"] == s["id"]
    cards = api.call("GET", "/api/seasons")["seasons"]
    assert [c["id"] for c in cards] == [s["id"]] and "browser" not in cards[0]
    assert api.call("DELETE", f"/api/season/{s['id']}")["deleted"]
    assert api.changed() and api.call("GET", "/api/seasons")["seasons"] == []
    assert api.loaded_state() is None
    refused(lambda: api.call("GET", f"/api/season/{s['id']}"), 404)
    refused(lambda: api.call("DELETE", f"/api/season/{s['id']}"), 404)


def test_create_refusals():
    refused(lambda: api.call("POST", "/api/season", {"team": "nope", "career": True}), 404)
    refused(lambda: api.call("POST", "/api/season", {"career": True}), 422)
    refused(lambda: api.call("POST", "/api/season", {"team": "smu", "mode": "remaining", "career": True}), 400)
    refused(lambda: api.call("POST", "/api/season", {"team": "smu", "seed": "eleven"}), 422)
    refused(lambda: api.call("POST", "/api/season", {"team": "smu", "coach": "000000000000"}), 404)
    assert not api.changed()


def test_create_ignores_career_flag():
    s = api.call("POST", "/api/season", {"team": "smu", "seed": 11, "career": False})
    assert s["career"]
    assert api.call("DELETE", "/api/seasons")["removed"] == 1 and api.changed()
    assert api.call("GET", "/api/seasons")["seasons"] == []


def test_export_import_roundtrip():
    s = api.call("POST", "/api/season", {"team": "smu", "seed": 11, "career": True})
    blob = api.call("GET", f"/api/season/{s['id']}/export?full=true")
    assert isinstance(blob, bytes) and blob[:2] == b"\x1f\x8b"
    refused(lambda: api.call("GET", f"/api/season/{s['id']}/export?full=maybe"), 422)
    api.call("DELETE", f"/api/season/{s['id']}")
    api.changed()
    back = api.call("POST", "/api/season/import", blob)
    assert back["id"] == s["id"] and api.changed()
    assert api.loaded_state()["id"] == s["id"]
    refused(lambda: api.call("POST", "/api/season/import", b"not a save"), 400)
    refused(lambda: api.call("POST", "/api/season/import", b"x" * (api.MAX_SAVE_BYTES + 1)), 413)
    api.call("DELETE", f"/api/season/{s['id']}")


def test_path_traversal_refused():
    # an id with an encoded slash must not reach a file outside the seasons folder
    outside = season.SEASONS_DIR.parent / f"{season.SEASONS_DIR.name}-outside"
    (outside / "victim").mkdir(parents=True, exist_ok=True)
    victim = outside / "victim.json"
    victim.write_text("{}", encoding="utf-8")
    api.changed()                                   # clear what earlier tests left
    try:
        sneaky = f"..%2F{outside.name}%2Fvictim"
        for method, path in (("GET", f"/api/season/{sneaky}"), ("DELETE", f"/api/season/{sneaky}"),
                             ("GET", f"/api/season/{sneaky}/export"), ("GET", "/api/season/.."),
                             ("DELETE", "/api/season/%2E%2E"), ("GET", "/api/coaches/..%5Cx")):
            refused(lambda: api.call(method, path), 404)
        assert victim.exists() and (outside / "victim").is_dir() and not api.changed()
    finally:
        import shutil
        shutil.rmtree(outside, ignore_errors=True)


def test_coaches_crud():
    c = api.call("POST", "/api/coaches", {"coach": {**coaches.blank(), "first_name": "Pat", "last_name": "Day"}})
    assert api.changed() and api.call("GET", f"/api/coaches/{c['id']}")["last_name"] == "Day"
    assert c["id"] in [x["id"] for x in api.call("GET", "/api/coaches")["coaches"]]
    refused(lambda: api.call("POST", "/api/coaches", {"coach": {"first_name": "Pat"}}), 400)
    refused(lambda: api.call("POST", "/api/coaches", {}), 422)
    assert api.call("DELETE", f"/api/coaches/{c['id']}")["deleted"]
    assert api.changed()
    refused(lambda: api.call("GET", f"/api/coaches/{c['id']}"), 404)
    refused(lambda: api.call("DELETE", "/api/coaches/not-an-id"), 404)


def test_advance_runs_in_steps():
    s = api.call("POST", "/api/season", {"team": "smu", "seed": 11, "career": True})
    r = api.call("POST", f"/api/season/{s['id']}/advance", {"to": 2})
    assert r == {"status": "running", "done": 0, "total": 2}
    refused(lambda: api.call("POST", f"/api/season/{s['id']}/advance", {}), 409)   # test_advance_while_running_refused
    seen = []
    st = api.step(seen.append)
    assert st["status"] == "running" and st["done"] == 1 and api.changed()
    assert any('"stage"' in m for m in seen)
    st = api.step()
    assert st["status"] == "idle" and st["done"] == 2 and api.loaded_state()["current_week"] == 2
    assert api.step() is None
    assert api.call("GET", f"/api/season/{s['id']}/status?since=0")["results"]


def test_pause_between_weeks():
    # Pause lands between steps: week 1 is over, so week 2 never starts (advance_to checks
    # should_stop before each week) and the run ends at done == 1.
    s = api.call("POST", "/api/season", {"team": "smu", "seed": 11, "career": True})
    api.call("POST", f"/api/season/{s['id']}/advance", {"to": 4})
    api.step()
    assert api.call("POST", f"/api/season/{s['id']}/pause")["stopping"]
    st = api.step()
    assert st["status"] == "idle" and st["paused"] and st["done"] == 1
    assert api.loaded_state()["current_week"] == 1
    assert api.call("POST", f"/api/season/{s['id']}/pause") == {"status": "idle", "stopping": False}


def test_stepped_advance_auto_recruits_after_first_week():
    # As one advance_to call did: your staff run your recruiting week for every week after the
    # first of a multi-week advance (with Auto-recruit off), never for the first.
    s = api.call("POST", "/api/season", {"team": "smu", "seed": 11, "career": True})
    rc = api.loaded_state()["recruiting"]
    assert api.loaded_state()["career"]["settings"]["auto_recruit"] is False and not rc["board"]
    api.call("POST", f"/api/season/{s['id']}/advance", {"to": 3})
    api.step()
    assert not rc["board"] and not rc["offers"].get("smu"), "week 1 ran your recruiting"
    api.step()
    assert rc["board"], "week 2 of the advance did not run your recruiting"
    api.step()


def test_import_refused_while_running():
    s = api.call("POST", "/api/season", {"team": "smu", "seed": 11, "career": True})
    blob = api.call("GET", f"/api/season/{s['id']}/export")
    api.call("POST", f"/api/season/{s['id']}/advance", {})
    refused(lambda: api.call("POST", "/api/season/import", blob), 409)
    api.step()


def test_other_season_refused_while_running():
    other = api.call("POST", "/api/season", {"team": "smu", "seed": 12, "career": True})
    s = api.call("POST", "/api/season", {"team": "smu", "seed": 11, "career": True})
    api.call("POST", f"/api/season/{s['id']}/advance", {})
    refused(lambda: api.call("GET", f"/api/season/{other['id']}"), 409)
    refused(lambda: api.call("POST", "/api/season", {"team": "smu", "seed": 13}), 409)
    assert api.call("GET", f"/api/season/{s['id']}/status")["status"] == "running"   # the page polls while running
    assert api.loaded_state()["id"] == s["id"]
    api.step()
    assert api.call("GET", f"/api/season/{other['id']}")["id"] == other["id"]


def test_gameday_step():
    s = api.call("POST", "/api/season", {"team": "smu", "seed": 11, "career": True})
    refused(lambda: api.call("POST", f"/api/season/{s['id']}/gameday"), 409)   # SMU has a bye in week 1
    api.call("POST", f"/api/season/{s['id']}/advance", {})
    api.step()
    r = api.call("POST", f"/api/season/{s['id']}/gameday")
    assert r == {"status": "running", "done": 1, "total": 2}
    st = api.step()
    assert st["status"] == "idle" and st["gameday_event"] and st["current_week"] == 1
    assert api.loaded_state()["games"][st["gameday_event"]]["played"] and api.step() is None


if __name__ == "__main__":
    import shutil
    import tempfile
    seasons_dir = _Path(tempfile.mkdtemp(prefix="cfp-api-seasons-"))
    coaches_dir = _Path(tempfile.mkdtemp(prefix="cfp-api-coaches-"))
    season.SEASONS_DIR, coaches.COACHES_DIR = seasons_dir, coaches_dir
    try:
        test_unknown_route()
        test_teams_and_coach_options()
        test_create_get_list_delete_career()
        test_create_refusals()
        test_create_ignores_career_flag()
        test_export_import_roundtrip()
        test_path_traversal_refused()
        test_coaches_crud()
        test_advance_runs_in_steps()
        test_pause_between_weeks()
        test_stepped_advance_auto_recruits_after_first_week()
        test_import_refused_while_running()
        test_other_season_refused_while_running()
        test_gameday_step()
    finally:
        season.close_pool()
        shutil.rmtree(seasons_dir, ignore_errors=True)
        shutil.rmtree(coaches_dir, ignore_errors=True)
    print("ok")
