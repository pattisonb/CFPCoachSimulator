"""Refit the overall formula onto the player card's attributes (game_scale.fit_card_overall) and bring every stored
overall onto it: data/game_scale.json ("card_overall"), data/base_league.json when there is one (each player's "o") and
data/engine_teams.json (each player's "ovr"). Nothing the engine reads changes. A career already saved is brought over
when it is next opened (game_scale.upgrade_overalls).

Usage:  python tools/refit_card_overall.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from coach_career import league as lg          # noqa: E402
from teamdata import game_scale               # noqa: E402


def recenter() -> dict:
    """Hold the scale's promise for the overall: the middle Power 4 starter at a position reads 50. The fit matches the
    old overalls player by player, which can leave a group's middle a point or two off; each group that is off by more than
    half a point has its positions' constants moved by the difference. Returns {group: shift}."""
    import statistics
    from sim import season
    scale = dict(game_scale.data())
    keys = game_scale.keys()
    by: dict = {}
    for slug, t in season.load_teams().items():
        if t.get("fictional") or not season._is_p4(slug, t):
            continue
        for q in t["offense"] + t["defense"]:
            if q.get("in_game") and q.get("skills"):
                pos = q.get("source_position") or q["position"]
                by.setdefault(game_scale.group(pos), []).append(game_scale.overall(dict(zip(keys, q["skills"])), pos))
    moved = {}
    for grp, vals in by.items():
        d = 50 - statistics.median(vals)
        if abs(d) > 0.5:          # exactly half a point is a rounding flip: moving it only moves it back
            moved[grp] = round(d, 2)
            for pos, f in scale["card_overall"].items():
                if game_scale.group(pos) == grp:
                    f["const"] = round(f["const"] + d, 4)
    if moved:
        game_scale.write_scale(scale)
    return moved


def main() -> None:
    scale = dict(game_scale.data())
    if not scale.get("card_overall"):          # fit to the overalls the game had (refitting to its own output would drift)
        base = lg.from_base()
        attrs = base.get("attrs") or game_scale.keys()
        players = [(dict(zip(attrs, c["r"])), c["pos"], c["o"]) for t in base["teams"].values() for c in t["roster"]]
        scale["card_overall"] = game_scale.fit_card_overall(players)
        game_scale.write_scale(scale)
        now = [game_scale.overall(ours, pos) - o for ours, pos, o in players]
        print(f"fit on {len(players)} players: overall moved {sum(map(abs, now)) / len(now):.2f} on average, {max(map(abs, now))} at most")
    moved = recenter()
    if moved:
        print(f"recentered so the middle Power 4 starter reads 50: {moved}")
    if lg.BASE_LEAGUE_FILE.exists():           # the base league as a file (a built site): its stored overalls too
        base = json.loads(lg.BASE_LEAGUE_FILE.read_text(encoding="utf-8"))
        attrs = base.get("attrs") or game_scale.keys()
        for t in base["teams"].values():
            for c in t["roster"]:
                c["o"] = game_scale.overall(dict(zip(attrs, c["r"])), c["pos"])
        lg.BASE_LEAGUE_FILE.write_text(json.dumps(base, separators=(",", ":")), encoding="utf-8")
    path = ROOT / "data" / "engine_teams.json"
    built = json.loads(path.read_text(encoding="utf-8"))
    keys, m = game_scale.keys(), 0
    for t in built["teams"].values():
        for p in t["offense"] + t["defense"]:
            if isinstance(p.get("ovr"), (int, float)) and p.get("skills"):
                p["ovr"] = game_scale.overall(dict(zip(keys, p["skills"])), p.get("source_position") or p["position"])
                m += 1
    path.write_text(json.dumps(built), encoding="utf-8")
    print(f"engine teams: {m} players' overall rewritten")


if __name__ == "__main__":
    main()
