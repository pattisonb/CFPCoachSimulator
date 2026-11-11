"""One official visit a weekend: a school books his first free home weekend, never one another
school already has (the player saw a recruit 'visiting' three schools in Week 2). With a week
picked (`act(..., week=N)`, your Official Visit picker) the visit goes on that home weekend; a weekend
he has elsewhere, a week with no home game and a rebooking are refused; the picker's read
(`visit_weekends`) lists your home games with who has each weekend and the first free one."""
from __future__ import annotations
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))
from coach_career import recruiting
from sim import season

ME = "ohio-state"


def main() -> None:
    st = season.new_season(ME, "full", seed=11, career=True)
    rc = st["recruiting"]
    pid = recruiting.prospect_list(st)[0]
    homes = sorted({g["week"] for g in st["games"].values() if g["home"] == ME and g["kind"] == "regular" and g["week"] > st["current_week"]})
    assert len(homes) >= 2, homes
    recruiting.top_group = lambda state, p, *a, **k: [ME]          # he is considering us
    rc["visits"][pid] = {"michigan": {"week": homes[0], "done": False}}   # another school has our first home weekend
    rc["hours"][ME] = 1000
    recruiting._act(st, ME, pid, "official_visit")
    assert rc["visits"][pid][ME]["week"] == homes[1], (rc["visits"][pid], homes)
    # every home weekend taken: refused with the reason
    pid2 = recruiting.prospect_list(st)[1]
    rc["visits"][pid2] = {f"s{i}": {"week": w, "done": False} for i, w in enumerate(homes)}
    try:
        recruiting._act(st, ME, pid2, "official_visit")
    except recruiting.RecruitingError as e:
        assert e.code == 409 and "every home game" in e.message, (e.code, e.message)
    else:
        raise AssertionError("a visit was booked on a weekend he already has")
    # the picker's read: every home game left, the first free one marked, the taken weekend named
    rows = recruiting.visit_weekends(st, ME, pid)
    assert [r["week"] for r in rows] == homes, (rows, homes)
    assert rows[0]["taken_by"] == "Michigan" and not rows[0]["first"], rows[0]
    assert rows[1]["first"] and all(not r["first"] for r in rows[2:]), rows
    assert all(r["label"] == season.week_label(r["week"]) and r["opponent_name"] and "opponent_rank" in r for r in rows), rows
    assert all(r["taken_by"] is None for r in rows[1:]), rows
    # a chosen later weekend is stored as picked (through `act`, as the page's request goes)
    pid3 = recruiting.prospect_list(st)[2]
    rc["visits"][pid3] = {"michigan": {"week": homes[0], "done": False}}
    assert len(homes) >= 3, homes
    recruiting.act(st, ME, pid3, "official_visit", week=homes[2])
    assert rc["visits"][pid3][ME] == {"week": homes[2], "done": False}, rc["visits"][pid3]
    # no rebooking: one official visit per school
    try:
        recruiting.act(st, ME, pid3, "official_visit", week=homes[1])
    except recruiting.RecruitingError as e:
        assert e.code == 409 and "one official visit per school" in e.message, (e.code, e.message)
    else:
        raise AssertionError("a visit was rebooked")
    # a weekend he has elsewhere is refused with the school's name
    pid4 = recruiting.prospect_list(st)[3]
    rc["visits"][pid4] = {"michigan": {"week": homes[1], "done": False}}
    try:
        recruiting.act(st, ME, pid4, "official_visit", week=homes[1])
    except recruiting.RecruitingError as e:
        assert e.code == 409 and e.message == "He is visiting Michigan that weekend.", (e.code, e.message)
    else:
        raise AssertionError("a visit was booked on a weekend he already has")
    # a week with no home game of yours (an away week, a played week, a week past the season) is refused
    aways = sorted({g["week"] for g in st["games"].values() if g["away"] == ME and g["kind"] == "regular" and g["week"] > st["current_week"]})
    for bad in (aways[0], st["current_week"], 99):
        try:
            recruiting.act(st, ME, pid4, "official_visit", week=bad)
        except recruiting.RecruitingError as e:
            assert e.code == 409 and e.message == "That is not a home weekend you have left.", (bad, e.code, e.message)
        else:
            raise AssertionError(f"a visit was booked on week {bad}, not a home weekend")
    assert ME not in rc["visits"][pid4]
    # no week picked: his first free weekend, as before
    recruiting.act(st, ME, pid4, "official_visit")
    assert rc["visits"][pid4][ME]["week"] == homes[0], (rc["visits"][pid4], homes)
    print("visit weekends ok: one official visit a weekend, the picked weekend stored, the taken and away weekends refused")


if __name__ == "__main__":
    main()
