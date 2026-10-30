"""A transfer-portal entrant's Prospect Profile (prospects.profile through app/api.py). The portal's
recruiting block shares its year with the class it replaces, so a cache keyed by the year alone
served the class's ranks to the portal and the profile failed with a KeyError on the entrant's id.
Also checks the next class's profile after the portal, and a former recruit (r20xx id) in the
second offseason's portal. (Run as a file.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))
from app import api
from coach_career import prospects
from sim import season
from tests.test_offseason import finished


def G(sid: str, path: str) -> dict:
    return api.call("GET", f"/api/season/{sid}/{path}")


def to_portal(sid: str) -> None:
    finished(api.loaded_state()); api._save_loaded()
    G(sid, "offseason")
    while api.loaded_state()["offseason"]["stage"] != "portal_w1":
        api.call("POST", f"/api/season/{sid}/offseason/advance", {})


def fresh_ranks(pid: str) -> tuple:
    prospects._RANKS = (None, {})
    return prospects._ranks(api.loaded_state())[pid]


def check(sid: str, pid: str) -> None:
    """His profile opens, and its ranks are those of the block he is in (not a cached one)."""
    pub = G(sid, f"prospect/{pid}")["public"]
    assert pub["id"] == pid
    assert (pub["position_rank"], pub["state_rank"]) == fresh_ranks(pid), pid


if __name__ == "__main__":
    import shutil
    import tempfile
    season.SEASONS_DIR = _Path(tempfile.mkdtemp(prefix="cfp-portal-profile-"))
    try:
        sid = api.call("POST", "/api/season", {"team": "ohio-state", "mode": "full", "seed": 11, "career": True})["id"]
        first = G(sid, "prospects?limit=1")["rows"][0]["id"]
        G(sid, f"prospect/{first}")                    # the class's ranks are worked out (and cached)
        to_portal(sid)
        rows = G(sid, "prospects?limit=50")["rows"]
        assert rows and all(r["id"] in api.loaded_state()["recruiting"]["prospects"] for r in rows)
        check(sid, rows[0]["id"])                      # was KeyError: the class's cached ranks
        # past the portal: the next class's profile works and carries its own ranks
        r = api.call("POST", f"/api/season/{sid}/offseason/advance", {"to": "next_season"})
        assert r["next_season"]
        nxt = G(sid, "prospects?limit=1")["rows"][0]["id"]
        assert nxt != first
        G(sid, f"prospect/{nxt}")
        check(sid, nxt)
        # the next offseason's portal: a former recruit (his player id is his recruit id)
        to_portal(sid)
        ids = [r["id"] for r in G(sid, "prospects?limit=1000")["rows"]]
        former = [p for p in ids if p.startswith("r20")]
        assert former, "seed 11 puts former recruits in the second portal"
        for pid in former[:3]:
            check(sid, pid)
    finally:
        season.close_pool()
        shutil.rmtree(season.SEASONS_DIR, ignore_errors=True)
    print("ok")
