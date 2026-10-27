"""The engine's results are pinned: two weeks of one career from a fixed seed, simulated in
this process, must score every game and count every stat exactly as the golden file says.
Any change to the play-by-play code that moves a single random draw or a single rounded
rating fails this, so a speed-up that passes it has not changed what the game does.

Re-record on purpose (a deliberate realism change) with: python tests/test_sim_golden.py --record"""
import hashlib
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ["SIM_WORKERS"] = "1"          # in this process: the pool's order does not matter, but one process is simplest

GOLDEN = ROOT / "tests" / "golden" / "sim_seed11_two_weeks.json"
TEAM, SEED, WEEKS = "smu", 11, 2


def digest(state: dict) -> dict:
    scores = {e: [g["home_score"], g["away_score"], g.get("overtime") or 0] for e, g in sorted(state["games"].items()) if g.get("played")}
    stats = state.get("season_stats") or {}
    blob = json.dumps(stats, sort_keys=True, default=str)
    return {"games": len(scores), "scores": scores, "stats_sha256": hashlib.sha256(blob.encode()).hexdigest()}


if __name__ == "__main__":
    from sim import season
    st = season.new_season(TEAM, "full", seed=SEED, career=True)
    season.advance_to(st, WEEKS)
    now = digest(st)
    if "--record" in sys.argv or not GOLDEN.exists():
        GOLDEN.parent.mkdir(parents=True, exist_ok=True)
        GOLDEN.write_text(json.dumps(now, indent=1, sort_keys=True))
        print(f"golden recorded: {now['games']} games, stats {now['stats_sha256'][:12]}")
        raise SystemExit(0)
    want = json.loads(GOLDEN.read_text())
    moved = [e for e in want["scores"] if want["scores"][e] != now["scores"].get(e)]
    assert not moved, f"{len(moved)} of {want['games']} games changed score, e.g. {moved[:3]}: {[(want['scores'][e], now['scores'].get(e)) for e in moved[:3]]}"
    assert now["games"] == want["games"], (now["games"], want["games"])
    assert now["stats_sha256"] == want["stats_sha256"], "every score matches but the season stats differ: a stat line or a rounding moved"
    print(f"sim golden ok: {now['games']} games and every stat line identical to the golden file")
