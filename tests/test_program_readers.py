"""Everything that asks how good a program is reads the living rating (coach_career/programs.py):
the AD's goal follows the tier, a sitting head coach moves only to a clearly better job, recruiting's
prestige and NIL pulls and the NIL budget follow the program, development favors the top programs
by rating."""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))
import collections

from coach_career import carousel, offseason, programs, recruiting
from sim import season
from test_offseason import finished

if __name__ == "__main__":
    st = season.new_season("ohio-state", "full", seed=5, career=True)
    # the goal follows the tier, before and after the league exists
    assert carousel.goal("ohio-state", st)["kind"] == "playoff" and carousel.goal("akron", st)["wins"] == 6
    assert carousel.goal("boise-state", st)["kind"] == "conference", carousel.goal("boise-state", st)
    # the NIL budget and the pulls follow the program's NIL tier and prestige
    b_osu, b_akr = recruiting.nil_budget(st, "ohio-state"), recruiting.nil_budget(st, "akron")
    assert b_osu == max(recruiting.NIL_FLOOR, round(recruiting.NIL_PER_TIER * programs.get(st, "ohio-state")["nil"])) and b_osu > 2 * b_akr, (b_osu, b_akr)
    pid = next(iter(st["recruiting"]["prospects"]))
    pull = recruiting.pull(st, "ohio-state", pid)
    assert pull["prestige"] > 0.85 and recruiting.pull(st, "akron", pid)["prestige"] < 0.35
    assert offseason.program_factor(st, "ohio-state") > 1.3 > offseason.program_factor(st, "akron") > 0.6
    finished(st)
    off = offseason.start(st)
    lgd = st["league"]
    # the goal and the budget read the league's living values once it exists
    lgd["teams"]["ohio-state"]["program"].update(tier=3, rating=55.0, nil=40.0)
    assert carousel.goal("ohio-state", st)["wins"] == 8 and recruiting.nil_budget(st, "ohio-state") == 120
    lgd["teams"]["ohio-state"]["program"].update(tier=1, rating=89.0, nil=92.0)
    # job attractiveness and the move rule: a sitting coach moves up, never sideways or down
    st["offseason"]["auto"] = True
    while off["stage"] != "staff":
        offseason.advance(st)
    changes = off["carousel"]["changes"]
    moves = [(c["team"], c["reason"]) for c in changes if c["role"] == "head_coach" and c["reason"].startswith("left for ") and c["reason"] != "left for the NFL"]
    names = {t["name"]: s for s, t in season.load_teams().items()}
    up = 0
    for frm, reason in moves:
        to = names.get(reason[len("left for "):])
        assert to, reason
        if programs.attract(st, to) >= programs.attract(st, frm) + carousel.MOVE_UP:
            up += 1
    assert moves and up == len(moves), (up, len(moves), moves[:3])
    assert all(c.get("tier") for c in changes if c["reason"] == "hired" and c["role"] == "head_coach")
    season.close_pool()
    print(f"program readers ok: {len(moves)} head coaches moved, all up; Ohio State budget {b_osu}, Akron {b_akr}")
