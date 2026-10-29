"""The site bundle (tools/build_site.py): game.zip unpacked on its own carries everything a career
reads through a season, its offseason and the next season's first week, the way Pyodide runs it in
the browser. The script below runs from inside the unpacked bundle (isolated mode, the bundle
folder first on sys.path), so any data file missing from the zip fails it with its name. Slow: a
week, the rest of the season faked (test_offseason.finished), an offseason and a week."""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile

from tools import build_site

SCRIPT = r'''
import os, random, sys
sys.path.insert(0, os.getcwd())
from app import api
from sim import season


def finished(st):
    """Every game played (the better team usually wins), every school's class signed, season over."""
    rng = random.Random(1)
    teams = season.load_teams()
    for g in st["games"].values():
        h, a = teams[g["home"]]["team_ratings"]["overall"], teams[g["away"]]["team_ratings"]["overall"]
        hs = rng.randint(10, 45)
        win = rng.random() < 1 / (1 + 10 ** ((a - h) / 12))
        g.update(played=True, home_score=hs if win else max(0, hs - rng.randint(1, 20)), away_score=hs - rng.randint(1, 20) if win else hs)
        if g["home_score"] == g["away_score"]:
            g["home_score"] += 3
    rc = st["recruiting"]
    schools = [s for s, t in teams.items() if not t["fictional"]]
    pids = sorted(rc["prospects"], key=lambda p: rc["prospects"][p]["rank"])
    for i, pid in enumerate(pids[:len(schools) * 21]):
        rc["status"][pid]["signed"] = schools[i % len(schools)]
    st.update(done=True, current_week=season.FINAL_WEEK, champion="ohio-state")


def play_week(sid):
    api.call("POST", f"/api/season/{sid}/advance", {"to": 1})
    while api.step() is not None:
        pass
    assert api.job()["status"] != "error", api.job()["error"]


s = api.call("POST", "/api/season", {"team": "smu", "seed": 11})
play_week(s["id"])
assert api.loaded_state()["current_week"] >= 1
finished(api.loaded_state()); api._save_loaded()
r = api.call("POST", f"/api/season/{s['id']}/offseason/advance", {"to": "next_season"})
assert r["next_season"] and r["year"] == 2027, r
st = api.loaded_state()
assert st["year"] == 2027 and st["league"]["year"] == 2027
play_week(st["id"])
assert api.loaded_state()["current_week"] >= 1
print("week 1 of 2027 ok")
'''


def test_bundle_plays_a_season_and_its_offseason(tmp_dir):
    info = build_site.build(tmp_dir / "dist")
    assert info["zip_bytes"] < 12_000_000
    zipfile.ZipFile(tmp_dir / "dist" / "game.zip").extractall(tmp_dir / "game")
    assert not (tmp_dir / "game" / "data" / "seasons").exists()
    assert len(list((tmp_dir / "game" / "cfb_sim_data" / "teams").glob("*.json"))) == 8
    r = subprocess.run([sys.executable, "-I", "-c", SCRIPT], cwd=tmp_dir / "game", capture_output=True, text=True,
                       env={**os.environ, "SIM_WORKERS": "1"})
    assert r.returncode == 0, r.stderr[-2000:]
    assert r.stdout.strip().endswith("week 1 of 2027 ok")


if __name__ == "__main__":
    from coach_career import league
    written = [f for f in (league.BASE_LEAGUE_FILE, league.BASE_META_FILE) if not f.exists()]   # the build writes these into data/
    tmp = _Path(tempfile.mkdtemp(prefix="cfp-site-bundle-"))
    try:
        test_bundle_plays_a_season_and_its_offseason(tmp)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
        for f in written:      # left behind, they would put every later test on the precomputed league
            f.unlink(missing_ok=True)
    print("ok")
