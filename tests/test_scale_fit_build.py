"""The scale fit's build sequence (game_scale.fit): one build without the frozen scale to measure
the card scale, then the real build. The second build must carry every card overall (the fit
once wrote data/engine_teams.json with all 12,427 overalls empty). Three teams' sources, in one
process, the way fit() does it."""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))
import json

from teamdata import build_teams, game_scale

ROOT = _Path(__file__).resolve().parents[1]

if __name__ == "__main__":
    src_dir = ROOT / "cfb_sim_data" / "teams"
    sources = [json.loads((src_dir / f"{s}.json").read_text(encoding="utf-8")) for s in ("ohio-state", "georgia", "boise-state")]
    with_ratings = sum(1 for t in sources for p in t["roster"] if p.get("ratings"))
    # `python -m teamdata.game_scale` loads the module twice: as __main__ (where fit() writes the scale
    # and clears its cache) and as teamdata.game_scale (the copy build_teams reads). The writer here
    # is a second copy loaded from the file, as __main__ is; the scale file is a temporary one.
    import importlib.util, tempfile
    spec = importlib.util.spec_from_file_location("game_scale_as_main", ROOT / "teamdata" / "game_scale.py")
    writer = importlib.util.module_from_spec(spec); spec.loader.exec_module(writer)
    good = json.loads(game_scale.FILE.read_text(encoding="utf-8"))
    tmp = _Path(tempfile.mkdtemp()) / "game_scale.json"
    writer.FILE = game_scale.FILE = tmp
    try:
        # step 1 of fit(): the scale without card scale or overall formulas, one build without the frozen scale
        writer.write_scale({"keys": good["keys"], "skills": good["skills"], "card_scale": {}, "overall": {}})
        build_teams.USE_FROZEN = False
        try:
            first = build_teams.build(sources, quiet=True)
        finally:
            build_teams.USE_FROZEN = True
        # step 2: the formulas written by the __main__ copy, then the real build through the package copy
        writer.write_scale({**good, "card_scale": first["attribute_scale"]})
        second = build_teams.build(sources, quiet=True)
    finally:
        writer.FILE = game_scale.FILE = ROOT / "data" / "game_scale.json"
        game_scale.data.cache_clear()
    def overalls(built):
        return sum(1 for t in built["teams"].values() for p in t["offense"] + t["defense"] if isinstance(p.get("ovr"), int))
    assert game_scale.has_overall(), "the frozen scale has no overall formulas"
    n = overalls(second)
    assert n >= with_ratings - 5, f"the second build carries {n} card overalls for {with_ratings} players with ratings"
    print(f"scale fit build ok: {overalls(first)} overalls without the frozen scale, {n} with it, {with_ratings} players with ratings")
