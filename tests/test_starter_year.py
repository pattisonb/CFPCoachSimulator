"""A freshman or sophomore who played a starter's season develops at a full year's pace
(offseason.STARTER_YEAR, year_pace): the same player, the same draws, gains more after starting
than after a year on the bench; a junior's pace is already past it and does not move. His skills
always gain more points; his overall (a rounded sum of his card's attributes, teamdata/game_scale.py
card_formula) never gains fewer, and gains more for all but the slowest developer or two, whose few
extra skill points can round to the same overall."""
import copy
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from coach_career import league as lg      # noqa: E402
from coach_career import offseason         # noqa: E402

if __name__ == "__main__":
    lgd = lg.from_base()
    attrs = offseason._attrs(lgd)
    assert offseason.year_pace({"yrs": 0}) == offseason.YEAR_CURVE[0] < offseason.year_pace({"yrs": 0}, True) == offseason.STARTER_YEAR
    assert offseason.year_pace({"yrs": 1}, True) == offseason.STARTER_YEAR
    assert offseason.year_pace({"yrs": 2}, True) == offseason.year_pace({"yrs": 2}) == offseason.YEAR_CURVE[2], "a junior's pace stays his"
    picked = level = bench_total = start_total = 0
    for t in lgd["teams"].values():
        for p in t["roster"]:
            if p["cls"] == "FR" and p["pos"] in ("QB", "HB") and sum(p["g"]) >= 400 and p["o"] < 55:
                bench, start = copy.deepcopy(p), copy.deepcopy(p)
                g_bench = offseason.develop(bench, attrs, 1.0, random.Random(7))
                g_start = offseason.develop(start, attrs, 1.0, random.Random(7), starter=True)
                assert g_start >= g_bench, (p["n"], p["pos"], p.get("c"), g_bench, g_start)
                assert all(a <= b for a, b in zip(bench["r"], start["r"])) and max(start["r"]) <= 99
                assert sum(start["r"]) > sum(bench["r"]), (p["n"], p["pos"], p.get("c"), sum(bench["r"]), sum(start["r"]))
                level += g_start == g_bench
                bench_total, start_total = bench_total + g_bench, start_total + g_start
                picked += 1
                if picked == 1:
                    print(f"{p['n']} ({p['pos']}, {p.get('c')}, {p['o']} overall): +{g_bench} off the bench, +{g_start} after a starter's season")
                if picked >= 25:
                    break
        if picked >= 25:
            break
    assert picked >= 10, picked
    assert level <= 2, f"{level} of {picked} gained the same overall after starting as off the bench"
    assert start_total >= 1.5 * bench_total, (bench_total, start_total)      # 2.2 times in the base league
    print(f"starter year ok: {picked} freshman quarterbacks and backs gain more after starting than after a year on the bench")
