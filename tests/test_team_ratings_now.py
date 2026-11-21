"""A team's ratings follow its depth chart and its injuries (season.team_ratings_now): untouched and healthy they are
the ratings built with the team; sit the starting quarterback, by injury or on the chart, and the offense drops."""
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("CFP_SEASONS_DIR", tempfile.mkdtemp(prefix="cfp-ratings-now-"))

from sim import season  # noqa: E402

state = season.new_season("ohio-state", "full", seed=3)
me = "ohio-state"
built = season.load_teams()[me]["team_ratings"]
now = season.team_ratings_now(state, me)
# a career's teams are built by the same sum (exact); the 2026 teams file was rated before its depth charts were put in
# real order, so its starters differ by a few men
assert all(abs(now[k] - built[k]) < 3.5 for k in ("overall", "offense", "defense")), (now, built)
page = season._unit_overalls(state, me)
assert set(page) == {"overall", "offense", "defense"} and all(isinstance(v, int) for v in page.values()), page

t = season.apply_depth(season.team_data(state, me), (state.get("depth") or {}).get(me))
qbs = season._players_by_role(t, t["offense"] + t["defense"])["QB"]
assert len(qbs) >= 2 and season.shown_overall(qbs[0]) > season.shown_overall(qbs[-1])
qb = qbs[0]

# hurt: the next man starts, the offense is worse, the defense is the same
state.setdefault("injuries", {}).setdefault(me, {})[f"{qb['name']}|{qb['position']}"] = {
    "name": qb["name"], "position": qb["position"], "type": "ankle sprain", "weeks": 2, "weeks_left": 2, "since_week": 0, "event_id": "x"}
hurt = season.team_ratings_now(state, me)
assert hurt["offense"] < now["offense"] and hurt["defense"] == now["defense"] and hurt["overall"] < now["overall"], (hurt, now)
state["injuries"][me].clear()
assert season.team_ratings_now(state, me) == now, "healed, the ratings come back"

# the chart: start the last quarterback
order = [p["slug"] for p in qbs]
state.setdefault("depth", {}).setdefault(me, {})["QB"] = [order[-1]] + order[:-1]
moved = season.team_ratings_now(state, me)
assert moved["offense"] < now["offense"], (moved, now)

# the chart knows when it is back as it started (the Reset Chart button), whatever is stored
state["depth"].pop(me)
assert not season.depth_changed(state, me)
season.move_depth(state, me, "QB", order[1], "up")
assert season.depth_changed(state, me)
season.move_depth(state, me, "QB", order[0], "up")
assert state["depth"][me] and not season.depth_changed(state, me), "moved back: no change to reset"

# an FCS stand-in has none
fcs = next(s for s, x in season.load_teams().items() if x["fictional"])
assert season.team_ratings_now(state, fcs) is None and season.team_overall(state, fcs) is None
print(f"team ratings now ok: offense {now['offense']} healthy, {hurt['offense']} with the quarterback hurt, {moved['offense']} with the last one starting")
