"""One official visit a weekend: a school books his first free home weekend, never one another
school already has (the player saw a recruit 'visiting' three schools in Week 2)."""
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
    print("visit weekends ok: one official visit a weekend")


if __name__ == "__main__":
    main()
