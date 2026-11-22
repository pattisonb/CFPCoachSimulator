"""A whole season played by the Python (sim/season.py), its state written after the start and after every week, for
season_whole_compare.mjs to hold the JavaScript season to: python3 sim_js/test/season_whole_reference.py OUT [team] [seed]"""
import json, os, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))
out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
team = sys.argv[2] if len(sys.argv) > 2 else "ohio-state"
seed = int(sys.argv[3]) if len(sys.argv) > 3 else 7
os.environ["CFP_SEASONS_DIR"] = tempfile.mkdtemp()
os.environ["SIM_WORKERS"] = "1"

from canon import canon
from sim import season
from coach_career import clear, league

state = season.new_season(team, seed=seed)
(out / "setup.json").write_text(json.dumps({
    "team": team, "seed": seed, "clear": clear.on(), "OFFENSE_ROLES": sorted(league.OFFENSE_ROLES),
    "TEAM_FIT": league.TEAM_FIT, "GROUP_OF": league.GROUP_OF}))


def dump(n):
    (out / f"py_{n:02d}.json").write_text(json.dumps(canon(state)))


dump(0)
n = 0
while not state["done"]:
    state = season.advance(state)
    n += 1
    dump(n)
print(n, "weeks")
