"""God mode: a player edit is validated, shows on the profile and the depth chart, and
changes how the engine sees the player. (Run as a file: multiprocessing on Windows.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `import season` works from here
import season

if __name__ == "__main__":
    st = season.new_season("ohio-state", "full", seed=2)
    assert season.settings(st)["god_mode"] is False
    season.update_settings(st, {"god_mode": True})
    assert season.settings(st)["god_mode"]
    team = season.load_teams()["ohio-state"]
    qb = next(p for p in team["offense"] if p["position"] == "QB" and p.get("in_game"))
    before = season.player_profile(st, "ohio-state", slug=qb["slug"])
    edits = season.edit_player(st, "ohio-state", qb["slug"], {"passing": 99, "speed": "88", "jersey": "7", "class": "SR", "dev_trait": "Elite", "weight": 230})
    assert edits["passing"] == 99 and edits["speed"] == 88 and edits["jersey"] == "7" and edits["class"] == "SR"
    after = season.player_profile(st, "ohio-state", slug=qb["slug"])
    assert {r["key"]: r["value"] for r in after["ratings"]}["passing"] == 99
    assert after["jersey"] == "7" and after["class_name"] == "Senior" and after["dev_trait"] == "Elite" and after["weight"] == 230
    assert after["overall"] > before["overall"], (before["overall"], after["overall"])
    assert "passing" in after["edited"]
    # the edit flows into the depth chart and the sim's team data
    chart = season.depth_chart_view(st, "ohio-state")
    row = next(r for u in chart["units"] for r in u["rows"] if r["role"] == "QB")
    assert row["players"][0]["jersey"] == "7", row["players"][0]
    t = season.team_data(st, "ohio-state")
    assert next(p for p in t["offense"] if p["slug"] == qb["slug"])["passing"] == 99
    # bad edits are refused; an edit back to the original clears itself
    for bad in ({"name": "Someone"}, {"class": "XX"}, {"passing": "lots"}, {"dev_trait": "Legend"}):
        try:
            season.edit_player(st, "ohio-state", qb["slug"], bad)
            raise SystemExit(f"accepted a bad edit: {bad}")
        except ValueError:
            pass
    season.edit_player(st, "ohio-state", qb["slug"], {"passing": qb["passing"]})
    assert "passing" not in season.player_edits(st, "ohio-state")[qb["slug"]]
    # clamped, and a season still sims with edits in place
    season.edit_player(st, "ohio-state", qb["slug"], {"passing": 250})
    assert season.player_edits(st, "ohio-state")[qb["slug"]]["passing"] == 99
    season.advance_to(st, 2)
    print("god mode ok:", qb["name"], "passing", qb["passing"], "->", 99, "| overall", before["overall"], "->", after["overall"])
