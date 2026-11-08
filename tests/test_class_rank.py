"""Class rank (coach_career/prospects.py class_table): the Recruiting tab's `class_rank` (also the Office's and
Headquarters' Class at a Glance) is your row's `rank` on the Classes tab (Headquarters' Recruiting Rankings).
Both rank the classes as you see them: another school's Quiet Commit is left out, your own counts. Checked
through the API on an Ohio State career, seed 9, six weeks in with Auto-recruit on. Saves go to a temporary
folder. (Run as a file: multiprocessing on Windows.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `from sim import season` works from here

from app import api
from coach_career import persona, prospects
from sim import season

ME = "ohio-state"


def G(sid: str, path: str) -> dict:
    return api.call("GET", f"/api/season/{sid}/{path}")


if __name__ == "__main__":
    import shutil
    import tempfile
    season.SEASONS_DIR = _Path(tempfile.mkdtemp(prefix="cfp-class-rank-test-"))
    try:
        sid = api.call("POST", "/api/season", {"team": ME, "mode": "full", "seed": 9, "career": True})["id"]
        api.call("POST", f"/api/season/{sid}/settings", {"auto_recruit": "season"})
        st = api.loaded_state()
        season.advance_to(st, 6)
        assert st["current_week"] == 6, st["current_week"]
        rc = st["recruiting"]
        quiet = [pid for pid in rc["status"] if persona.hidden_from(st, ME, pid)]
        assert quiet, "the career has other schools' Quiet Commits to leave out"
        # the two views of the same moment agree
        view = G(sid, "recruiting")
        classes = G(sid, "classes")
        mine = next(r for r in classes["schools"] if r["school"] == ME)
        assert mine["yours"] and view["class_rank"] == mine["rank"], (view["class_rank"], mine["rank"])
        assert prospects.class_rank(st, ME) == mine["rank"]
        # no row counts a commit hidden from you
        hidden_schools = {rc["status"][pid]["committed"] for pid in quiet}
        seen = prospects.class_table(st, ME)
        everyone = prospects.class_table(st)
        for s in hidden_schools:
            if s in seen:
                assert seen[s]["points"] < everyone[s]["points"] and not set(seen[s]["pids"]) & set(quiet), s
        # a school ranks its own Quiet Commits: each school's rank is its own row on its own Classes tab
        for s in sorted(hidden_schools)[:3]:
            own = next(r for r in prospects.national_classes(st, s)["schools"] if r["school"] == s)
            assert prospects.class_rank(st, s) == own["rank"] and own["count"] == len(everyone[s]["pids"]), s
        print(f"  class rank ok (#{mine['rank']}, {len(quiet)} Quiet Commits hidden from you)")
    finally:
        shutil.rmtree(season.SEASONS_DIR, ignore_errors=True)
