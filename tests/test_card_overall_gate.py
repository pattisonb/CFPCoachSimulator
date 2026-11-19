"""The card's overall never reaches an engine rating: the real 2026 build with every card_overall constant moved
(data/game_scale.json, what tools/refit_card_overall.py refits and recenters) differs from the build as it stands in
the players' "ovr" and nowhere else (build_teams.clamp_extremes gates its core-skill floor on
game_scale.legacy_overall). And every built player's card is scored at the position his skills were made for
(game_scale.card_position), so the tool's overalls are the build's.
`python3 tests/test_card_overall_gate.py`"""
import copy
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from teamdata import build_teams, game_scale   # noqa: E402


def without_ovr(built: dict) -> str:
    out = copy.deepcopy(built)
    for t in out["teams"].values():
        for p in t["offense"] + t["defense"]:
            p.pop("ovr", None)
    return json.dumps(out, sort_keys=True)


if __name__ == "__main__":
    sources = [json.loads(p.read_text(encoding="utf-8")) for p in sorted((build_teams.SRC / "teams").glob("*.json"))]
    position = {(t["slug"], p["slug"]): p["position"] for t in sources for p in t["roster"]}
    as_is = build_teams.build(copy.deepcopy(sources), quiet=True)
    scale = copy.deepcopy(game_scale.data())
    for i, f in enumerate(scale["card_overall"].values()):
        f["const"] += 4 if i % 2 else -4
    real = game_scale.data
    try:                                       # the scale file itself is not touched
        game_scale.data = lambda: scale
        game_scale._card_overall.cache_clear()
        moved = build_teams.build(copy.deepcopy(sources), quiet=True)
    finally:
        game_scale.data = real
        game_scale._card_overall.cache_clear()
    players = [(s, p) for s, t in as_is["teams"].items() for p in t["offense"] + t["defense"]]
    theirs = {(s, p["slug"]): p for s, t in moved["teams"].items() for p in t["offense"] + t["defense"]}
    changed = sum(1 for s, p in players if p.get("ovr") != theirs[(s, p["slug"])].get("ovr"))
    assert changed > len(players) / 2, ("moving the constants moved few overalls: the test is not testing", changed)
    assert without_ovr(as_is) == without_ovr(moved), "a card_overall constant changed something besides the card overall"
    keys, n = game_scale.keys(), 0
    for s, p in players:
        if (s, p["slug"]) in position and p["position"] not in ("K", "P"):   # a specialist the build moved keeps the overall of the spot he came from
            assert game_scale.card_position(p) == position[(s, p["slug"])], (s, p["slug"], game_scale.card_position(p))
        if isinstance(p.get("ovr"), (int, float)) and p.get("skills"):
            assert game_scale.overall(dict(zip(keys, p["skills"])), game_scale.card_position(p)) == p["ovr"], (s, p["slug"])
            n += 1
    print(f"card overall gate ok: {changed} overalls moved with the constants and no engine rating did; {n} overalls are the build's")
