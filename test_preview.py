"""This week: a bye says so, the next game carries a prediction that adds up and the
injury report, a game already played (game day) shows its result, and a finished season
has no game. (Run as a file: multiprocessing on Windows.)"""
import time

import season

if __name__ == "__main__":
    st = season.new_season("ohio-state", "full", seed=5)
    pv = season.game_preview(st, "ohio-state")
    assert pv["game"] is None and pv["reason"] == "bye" and pv["week"] == 1, "Ohio State's week 1 is a bye in 2026"
    season.advance_to(st, 1)
    t0 = time.perf_counter()
    pv = season.game_preview(st, "ohio-state")
    dt = time.perf_counter() - t0
    g, p = pv["game"], pv["prediction"]
    assert g["week"] == 2 and g["opponent"] == "ball-state" and not g.get("played"), g
    assert 0.02 <= p["win_prob"] <= 0.98 and p["sims"] == 20, "never a sure thing"
    assert abs(p["points_for"] - p["points_against"] - p["margin"]) < 0.01
    assert abs(p["points_for"] + p["points_against"] - p["total"]) < 0.01
    assert p["watch"]["passer"] and p["watch"]["passer"]["position"] == "QB"
    print(f"week 2 {g['venue']} vs {g['opponent_name']}: {p['points_for']}-{p['points_against']}, win {p['win_prob']:.0%}, {dt:.1f}s for {p['sims']} sims")
    pv2 = season.game_preview(st, "ohio-state")
    assert pv2["prediction"] == p, "cached on the second call"
    season.advance_to(st, 5)
    pv = season.game_preview(st, "ohio-state")
    g, p = pv["game"], pv["prediction"]
    assert g["week"] == 6, g
    print(f"week 6 {g['venue']} vs {g['opponent_name']} (#{g['opponent_rank']}, {g['opponent_record']}): {p['points_for']}-{p['points_against']}, win {p['win_prob']:.0%}; "
          f"injuries out: {len(pv['injuries'])}; rivalry: {g['rivalry'] and g['rivalry']['trophy']}")
    # game day: your game is in, the rest of the week is not; the card shows the result
    eid = season.play_my_game(st)
    assert eid and st["current_week"] == 5
    pv = season.game_preview(st, "ohio-state")
    g = pv["game"]
    assert pv["played"] and g["played"] and g["event_id"] == eid and pv["prediction"] is None
    assert g["points_for"] is not None and g["has_box"] and ("W" if g["won"] else "L")
    print(f"after game day: {'W' if g['won'] else 'L'} {g['points_for']}-{g['points_against']} vs {g['opponent_name']}, record {g['my_record']}")
    season.advance(st)
    assert st["current_week"] == 6
    season.advance_to(st, 20)
    assert season.game_preview(st, "ohio-state")["game"] is None
    print("preview ok")
