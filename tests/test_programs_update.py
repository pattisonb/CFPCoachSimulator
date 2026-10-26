"""The living program rating (coach_career/programs.py): every team in a career's league carries
its program metrics; each offseason the rating moves with results, slowly for prestige and the
market, by the AD's hand for NIL; a decade of winning lifts a program about a tier and no more."""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))
import json

from coach_career import carousel, league as lg, offseason, programs
from sim import season
from test_offseason import finished


def fake_results(lgd: dict, win: set, lose: set) -> dict:
    out = {}
    for s in lgd["teams"]:
        w = 12 if s in win else 2 if s in lose else 7
        out[s] = {"wins": w, "losses": 12 - w, "conference": s in win, "playoff": s in win, "title": False}
    return out


if __name__ == "__main__":
    st = season.new_season("ohio-state", "full", seed=3, career=True)
    # before the league exists the base values answer
    p = programs.get(st, "ohio-state")
    assert p["tier"] == 1 and p["rating"] > 80 and programs.z(st, "ohio-state") > 1.2 and programs.z(st, "akron") < -0.8
    finished(st)
    off = offseason.start(st)
    lgd = st["league"]
    keys = {"history", "prestige", "winning", "market", "market_base", "nil", "conference", "coach", "rating", "tier", "seasons"}
    assert all(keys <= set(t["program"]) for t in lgd["teams"].values()), "a team without its program"
    before = {s: dict(t["program"]) for s, t in lgd["teams"].items()}
    res = carousel._results(st)
    ranks = programs.final_ranks(st)
    assert ranks and 1 <= min(ranks.values()) and len(ranks) >= 25
    programs.update(st, res, ranks)
    champ = st.get("champion")
    for s, t in lgd["teams"].items():
        p, b = t["program"], before[s]
        assert abs(p["prestige"] - b["prestige"]) <= programs.PRESTIGE_STEP + 1e-9, (s, p["prestige"], b["prestige"])
        assert 0 <= p["winning"] <= 100 and len(p["seasons"]) == 1 and p["seasons"][-1][0] == off["year"] - 1
        assert abs(p["market"] - b["market"]) <= programs.MARKET_STEP + programs.NEW_COACH_LIFT + 1e-9
        assert abs(round(programs.mix(p), 1) - p["rating"]) < 0.11 and p["tier"] == programs.tier_of(p["rating"]) and p["year"] == off["year"]
    assert lgd["teams"][champ]["program"]["winning"] >= 60, lgd["teams"][champ]["program"]["winning"]
    programs.update(st, res, ranks)                                      # once a year
    assert len(lgd["teams"][champ]["program"]["seasons"]) == 1
    # NIL moves by the AD's hand: up after a goal met, down after a losing year
    t = lgd["teams"]["ohio-state"]["program"]
    n0 = t["nil"]
    programs.nil_move(lgd["teams"]["ohio-state"], met=True, losing=False)
    assert t["nil"] == min(100, n0 + programs.NIL_UP)
    programs.nil_move(lgd["teams"]["ohio-state"], met=False, losing=True)
    assert t["nil"] == min(100, n0 + programs.NIL_UP) - programs.NIL_DOWN
    # ten winning years at a mid program, ten losing years at a blue blood: about a tier each way, no more
    riser = min(("kansas-state", "iowa", "utah", "missouri", "tcu", "wisconsin"), key=lambda s: lgd["teams"][s]["program"]["winning"])
    faller = "alabama"
    r0, f0 = dict(lgd["teams"][riser]["program"]), dict(lgd["teams"][faller]["program"])
    for k in range(10):
        year = off["year"] + 1 + k
        for s in (riser, faller):
            lgd["teams"][s]["program"]["year"] = year - 1
        fr = fake_results(lgd, {riser}, {faller})
        rk = {riser: 3, faller: None}
        programs.update(st, fr, rk, year=year, only=(riser, faller))
        programs.nil_move(lgd["teams"][riser], met=True, losing=False)
        programs.nil_move(lgd["teams"][faller], met=False, losing=True)
    r1, f1 = lgd["teams"][riser]["program"], lgd["teams"][faller]["program"]
    assert 8 <= r1["prestige"] - r0["prestige"] <= 25 and 5 <= r1["market"] - r0["market"] <= 20, (r0["prestige"], r1["prestige"], r0["market"], r1["market"])
    assert -25 <= f1["prestige"] - f0["prestige"] <= -6 and -15 <= f1["market"] - f0["market"] <= -3, (f0["prestige"], f1["prestige"], f0["market"], f1["market"])
    assert r1["rating"] > r0["rating"] + 8 and f1["rating"] < f0["rating"] - 6 and f1["tier"] >= 2
    assert r1["tier"] <= r0["tier"] - 1 or r1["rating"] >= 65, (r0["tier"], r1["tier"], r1["rating"])
    # the whole offseason on Auto runs the update as part of the carousel
    st2 = season.new_season("georgia", "full", seed=4, career=True)
    finished(st2)
    offseason.run_all(st2)
    assert all(t["program"]["year"] == st2["offseason"]["year"] for t in st2["league"]["teams"].values())
    rows = programs.rows(st2)
    assert len(rows) >= 130 and rows[0]["rating"] >= rows[1]["rating"] and {"name", "tier", "tier_name", "goal"} <= set(rows[0])
    season.close_pool()
    print(f"programs update ok: {riser} {r0['rating']:.0f}->{r1['rating']:.0f} (tier {r0['tier']}->{r1['tier']}), {faller} {f0['rating']:.0f}->{f1['rating']:.0f} (tier {f0['tier']}->{f1['tier']})")
