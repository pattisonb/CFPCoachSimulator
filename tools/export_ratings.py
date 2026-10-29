"""Every real 2026 FBS player's ratings on the game's own scale, as one JSON file.

    python tools/export_ratings.py            # writes data/player_ratings.json
    python tools/export_ratings.py out.json   # or anywhere you like

The scale is the player cards': 50 is an average Power 4 starter at the position, 65 / 80 / 95 one,
two and three steps above, about 40 a Power 4 backup or a Group of 5 starter (docs/HOW_IT_WORKS.md,
"Player ratings"). Each record carries his 54 attributes now (`ratings`), where each can end up
(`potential`, from data/player_potential.json where a player was seeded; otherwise his ratings),
both overalls, and who he is. Fictional stand-in teams are left out.
"""
from __future__ import annotations
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root

import json
import sys

from coach_career import league
from teamdata import game_scale

ROOT = _Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "player_ratings.json"


def export() -> dict:
    attrs = game_scale.keys()
    potentials = league._potentials()
    players = []
    for slug in league.base_slugs():
        t = league.base_team(slug)
        if t["fictional"]:
            continue
        for p in t["roster"]:
            if not p.get("ratings"):
                continue
            pos = p["position"]
            ours = game_scale.ours_from_base(p["ratings"], pos)
            seeded = potentials.get(p["slug"], {})
            pot = game_scale.potential_from_ea({**p.get("ratings_ea", {}), **seeded["potential_ea"]}, ours, pos) if seeded.get("potential_ea") else ours
            players.append({
                "slug": p["slug"], "name": p["name"], "team": slug, "team_name": t["short_name"], "conference": t.get("conference"),
                "position": pos, "class": p.get("class"), "height": p.get("height"), "weight": p.get("weight_lbs"), "jersey": p.get("jersey"),
                "archetype": p.get("archetype"), "dev_trait": p.get("dev_trait"), "stars": seeded.get("stars"),
                "coachability": seeded.get("coachability"), "hometown_state": (p.get("hometown") or {}).get("state") or t.get("state"),
                "overall": game_scale.overall(ours, pos), "potential_overall": game_scale.overall(pot, pos),
                "ratings": {k: int(ours.get(k, 50)) for k in attrs},
                "potential": {k: int(pot.get(k, 50)) for k in attrs},
            })
    return {
        "scale": "The game's scale, 1 to 99: 50 is an average Power 4 starter at the position, 65 / 80 / 95 one, two and three steps above, about 40 a Power 4 backup or a Group of 5 starter.",
        "source": "The real 2026 rosters (cfb_sim_data/teams), converted once through teamdata/game_scale.py; potential from data/player_potential.json where seeded.",
        "attributes": attrs, "players": players,
    }


if __name__ == "__main__":
    out = _Path(sys.argv[1]) if len(sys.argv) > 1 else OUT
    data = export()
    out.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {out} ({out.stat().st_size / 1e6:.1f} MB): {len(data['players'])} players, {len(data['attributes'])} attributes each")
