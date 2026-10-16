"""This week: the next game, a prediction that adds up, the injury report; a bye points
to the game after it; a finished season has no game. (Run as a file: multiprocessing.)"""
import time

import season

if __name__ == "__main__":
    st = season.new_season("ohio-state", "full", seed=5)
    t0 = time.perf_counter()
    pv = season.game_preview(st, "ohio-state")
    dt = time.perf_counter() - t0
    g, p = pv["game"], pv["prediction"]
    assert g["bye_first"], "Ohio State's week 1 is a bye in 2026"
    assert g["week"] == 2 and g["opponent"] == "ball-state", g
    assert 0 <= p["win_prob"] <= 1 and p["sims"] == 20
    assert abs(p["points_for"] - p["points_against"] - p["margin"]) < 0.01
    assert abs(p["points_for"] + p["points_against"] - p["total"]) < 0.01
    assert p["watch"]["passer"] and p["watch"]["passer"]["position"] == "QB"
    print(f"week 2 {g['venue']} vs {g['opponent_name']}: {p['points_for']}-{p['points_against']}, win {p['win_prob']:.0%}, {dt:.1f}s for {p['sims']} sims")
    pv2 = season.game_preview(st, "ohio-state")
    assert pv2["prediction"] == p, "cached on the second call"
    season.advance_to(st, 5)
    pv = season.game_preview(st, "ohio-state")
    g, p = pv["game"], pv["prediction"]
    assert not g["bye_first"] and g["week"] == 6, g
    print(f"week 6 {g['venue']} vs {g['opponent_name']} (#{g['opponent_rank']}, {g['opponent_record']}): {p['points_for']}-{p['points_against']}, win {p['win_prob']:.0%}; "
          f"injuries out: {len(pv['injuries'])}; rivalry: {g['rivalry'] and g['rivalry']['trophy']}")
    season.advance_to(st, 20)
    assert season.game_preview(st, "ohio-state")["game"] is None
    print("preview ok")
