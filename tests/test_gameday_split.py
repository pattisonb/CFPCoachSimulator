"""Game day plays only your game; the week's other games wait for Advance, and the
results are the same as simulating the whole week at once. Also the title-game week:
the matchups are set before your game. (Run as a file: multiprocessing on Windows.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `import season` works from here
import copy

import season

if __name__ == "__main__":
    base = season.new_season("ohio-state", "full", seed=21)
    season.advance_to(base, 2)
    whole = copy.deepcopy(base)
    split = copy.deepcopy(base)
    season.advance(whole)                       # week 3 at once
    eid = season.play_my_game(split)            # game day: only your game
    g = split["games"][eid]
    assert g["played"] and split["current_week"] == 2, (g["played"], split["current_week"])
    others = [x for k, x in split["games"].items() if x["week"] == 3 and k != eid]
    assert others and not any(x["played"] for x in others), "only your game should be played"
    assert season.my_game_id(split) is None, "your game should count as played"
    season.advance(split)                       # the rest of the week
    assert split["current_week"] == 3
    for k, x in whole["games"].items():
        if x["week"] == 3:
            y = split["games"][k]
            assert (x["home_score"], x["away_score"]) == (y["home_score"], y["away_score"]), (k, x["home_score"], x["away_score"], y["home_score"], y["away_score"])
    assert whole["rng_state"] == split["rng_state"]
    print(f"week 3 identical either way: {g['away_display']} {g['away_score']} at {g['home_display']} {g['home_score']}")
    # a bye: no game to play
    bye = copy.deepcopy(base)
    bye["games"] = {k: v for k, v in bye["games"].items() if not (v["week"] == 3 and "ohio-state" in (v["home"], v["away"]))}
    assert season.play_my_game(bye) is None
    # championship week: the title game is set before game day, and the rest follows
    cc = season.new_season("ohio-state", "full", seed=21)
    season.advance_to(cc, season.CCG_WEEK - 1)
    eid = season.play_my_game(cc)
    if eid:
        print("CCG week game day:", cc["games"][eid]["title"])
    season.advance(cc)
    assert cc["current_week"] == season.CCG_WEEK and cc["bracket"], "the bracket is built after the full week"
    print("gameday split ok")
