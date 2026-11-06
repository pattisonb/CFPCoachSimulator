"""Path to the League: a school's pull on a recruit is its Pro Pipeline grade at his position group,
one recruit in ten has it first, and the deciders who care about it carry it."""
import sys as _sys
from pathlib import Path as _Path
_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))
from coach_career import persona, programs, recruiting
from sim import season

if __name__ == "__main__":
    assert "pro" in recruiting.PITCHES and recruiting.PITCHES.index("pro") == len(recruiting.PITCHES) - 2
    for table in (recruiting.PRIORITY_ODDS, recruiting.PORTAL_PRIORITY_ODDS, recruiting.PORTAL_TOP_PRIORITY_ODDS):
        assert abs(sum(table.values()) - 1.0) < 1e-9 and table["pro"] > 0, table
    p = {"pro": 40, "pro_groups": {"OT": 80, "IOL": 40, "WR": 95, "EDGE": 70}}
    assert programs.pro_group_grade(p, "OL") == 60 and programs.pro_group_grade(p, "WR") == 95
    assert programs.pro_group_grade(p, "DL") == 35 and programs.pro_group_grade(p, "QB") == 0 and programs.pro_group_grade(p, "ATH") == 40
    assert programs.pro_group_grade({}, "WR") == 0
    assert "pro" in persona.DECIDER_TOPICS["dad"] and "pro" in persona.DECIDER_TOPICS["trainer"] and "pro" in persona.DECIDER_TOPICS["hs_coach"]
    st = season.new_season("ohio-state", "full", seed=11, career=True)
    rc = st["recruiting"]
    wr = next(pid for pid, pr in rc["prospects"].items() if pr["ea_position"] == "WR")
    k = next(pid for pid, pr in rc["prospects"].items() if pr["ea_position"] in ("K", "P"))
    osu, sjsu = recruiting.strengths(st, "ohio-state", wr), recruiting.strengths(st, "san-jose-state", wr)
    assert osu["pro"] > 0.85 and sjsu["pro"] < 0.2, (osu["pro"], sjsu["pro"])
    assert 0.0 <= recruiting.strengths(st, "army", wr)["pro"] <= 0.1, "no picks in ten years: the floor"
    assert abs(recruiting.strengths(st, "ohio-state", k)["pro"] - recruiting._logistic(recruiting.PRO_PULL_K * (programs.get(st, "ohio-state")["pro"] - 50) / 25)) < 0.01
    share = sum(1 for pr in rc["prospects"].values() if "pro" in pr["priorities"]) / len(rc["prospects"])
    assert 0.22 <= share <= 0.38, share
    first = sum(1 for pr in rc["prospects"].values() if pr["priorities"][0] == "pro") / len(rc["prospects"])
    assert 0.07 <= first <= 0.13, first
    from coach_career import scenes
    assert scenes.PHRASES["pro"] == "getting to the league" and scenes.SAID_HONEST["pro"] == "a path to Sundays"
    assert all(k in scenes.LINES["pro"] and len(scenes.LINES["pro"][k]) == 3 for k in ("cue", "hit", "polite", "quiet"))
    assert all(scenes.NEEDS.get(line) == "pro" for line in scenes.LINES["pro"]["hit"])
    assert "{position}" in scenes.LEAD_LINES["pro"] and "Sundays" in scenes.LEAD_HONEST["pro"] and len(scenes.HONEST_HIT["pro"]) == 2
    assert scenes.truth(st, "ohio-state", wr)["pro"] is True and scenes.truth(st, "army", wr)["pro"] is False
    js = (_Path(__file__).resolve().parents[1] / "web" / "recruiting.js").read_text()
    assert 'pro: "Path to the League"' in js
    print(f"pro pitch ok: Ohio State WR {osu['pro']:.2f} vs San José State {sjsu['pro']:.2f}; {share:.0%} of the class carry it, {first:.0%} first")
