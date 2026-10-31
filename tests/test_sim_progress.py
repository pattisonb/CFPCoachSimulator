"""Sim progress (app/api.py, sim/season.py week_work): a whole season advanced through the API
in one job, every status collected. The job's `progress` never goes back, ends at 1.0 and
follows the clock: at every report it is within MAX_DEVIATION of the share of the job's wall
time gone by. (Spearman's rank correlation would not catch the old bar: any non-decreasing bar
ranks perfectly against time, including one that sits at 85% through every recruiting week.
The largest gap between the bar and the clock is what the player sees, so that is the test.)
A one-bowl-game week takes a small share of the bar, not one week's even split. Saves go to a
temporary folder. (Run as a file: multiprocessing on Windows.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `from app import api` works from here

import json
import shutil
import tempfile
import time

from app import api
from sim import season

MAX_DEVIATION = 0.2      # the bar may lead or trail the clock by at most a fifth of the run


def run() -> None:
    season.SEASONS_DIR = _Path(tempfile.mkdtemp(prefix="cfp-progress-test-"))
    try:
        s = api.call("POST", "/api/season", {"team": "smu", "seed": 11})
        start = api.call("POST", f"/api/season/{s['id']}/advance", {"to": season.FINAL_WEEK})
        span = start["total"] - start["done"]
        plan = {w: sum(p.values()) for w, p in api.job()["_plan"].items()}
        # the title game week (one game) is planned as a small share, not 1/span
        assert plan[season.FINAL_WEEK] / sum(plan.values()) < 0.5 / span, plan
        pts = []
        t0 = time.perf_counter()
        while api.running():
            api.step(lambda x: pts.append((time.perf_counter() - t0, json.loads(x))))
        wall = pts[-1][0]
        prog = [j["progress"] for _, j in pts]
        assert all(p is not None and 0 <= p <= 1 for p in prog), prog
        assert all(a <= b for a, b in zip(prog, prog[1:])), "progress went back"
        assert prog[-1] == 1.0 and pts[-1][1]["status"] == "idle"
        assert all(p < 1 for p, (_, j) in zip(prog, pts) if j["status"] == "running"), "100% before the job was done"
        dev = max(abs(t / wall - p) for (t, _), p in zip(pts, prog))
        assert dev <= MAX_DEVIATION, f"progress strays {dev:.3f} from the clock"
        # the final week (one game) moved the bar by a small share
        final = [p for (_, j), p in zip(pts, prog) if j["week"] == season.FINAL_WEEK]
        assert final[-1] - final[0] < 0.5 / span, (final[0], final[-1])
        # the stage line names what is happening, in sentence case
        stages = {j["stage"] for _, j in pts if j["stage"]}
        assert "Playing Week 6 games" in stages and season.RECRUITING_STAGE in stages and season.SAVING_STAGE in stages, stages
        assert not any(st.startswith("Simming") for st in stages), stages
        print(f"sim progress ok: {len(pts)} reports over {wall:.0f} s, largest gap from the clock {dev:.3f}")
    finally:
        season.close_pool()
        shutil.rmtree(season.SEASONS_DIR, ignore_errors=True)


if __name__ == "__main__":
    run()
