"""Needs on the Prospects and Recruiting screens (recruiting.needs_detail): per roster group the
healthy make-up, who comes back, your commits (firm and soft), your board and offers, and what
is left; and a recommended list (recruiting.recommended): the prospects the Auto-recruit rules
would put on your board, ranked, with why, to build a board from."""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))

from coach_career import offseason, prospects, recruiting
from sim import season

if __name__ == "__main__":
    st = season.new_season("ohio-state", "full", seed=9, career=True)
    me = st["team"]
    rc = st["recruiting"]
    d = recruiting.needs_detail(st, me)
    assert set(d) == set(offseason.TARGET), d.keys()
    for g, row in d.items():
        assert {"target", "back", "commits", "firm", "soft", "board", "offers", "need"} <= set(row), row
        assert row["target"] == offseason.TARGET[g] and row["need"] == recruiting.needs(st, me)[g] and row["commits"] == row["firm"] + row["soft"]
    # a commit and a board entry show up where they should
    pid = next(p for p in rc["prospects"] if recruiting._group_of(rc["prospects"][p]) == "WR" and not rc["status"][p]["committed"])
    rc["board"].append(pid)
    rc["status"][pid].update(committed=me, firmness=recruiting.FIRM_START)
    recruiting._GROUP_COUNTS = (None, {})
    d2 = recruiting.needs_detail(st, me)
    assert d2["WR"]["board"] == d["WR"]["board"] + 1 and d2["WR"]["soft"] == d["WR"]["soft"] + 1 and d2["WR"]["need"] == d["WR"]["need"] - 1
    rc["status"][pid].update(firmness=recruiting.HARD_AT, hard=True)      # a hard commit counts as firm
    d3 = recruiting.needs_detail(st, me)
    assert d3["WR"]["firm"] == d["WR"]["firm"] + 1 and d3["WR"]["soft"] == d["WR"]["soft"]
    # recommended: the AI's board for you, not already on your board, each with why
    recs = recruiting.recommended(st, me)
    assert 20 <= len(recs) <= 120, len(recs)
    assert pid not in [r["pid"] for r in recs]
    assert all(r["why"] and r["fit"] > 0 for r in recs[:10]), recs[0]
    groups = {recruiting._group_of(rc["prospects"][r["pid"]]) for r in recs}
    assert len(groups) >= 6, groups
    needed = [g for g, row in d3.items() if row["need"] >= 2]
    if needed:
        assert any(recruiting._group_of(rc["prospects"][r["pid"]]) in needed for r in recs[:15])
    # the same list twice in a week; the Prospects search can show it and filter by group
    assert [r["pid"] for r in recs] == [r["pid"] for r in recruiting.recommended(st, me)]
    found = prospects.search(st, me, status="recommended", limit=200)
    assert found["total"] == len(recs) and all(r.get("why") for r in found["rows"][:5]) and "needs" in found
    wr = prospects.search(st, me, group="WR", limit=20)
    assert wr["rows"] and all(recruiting._group_of(rc["prospects"][r["id"]]) == "WR" for r in wr["rows"])
    season.close_pool()
    print(f"needs and recommendations ok: {len(recs)} recommended, needs {[(g, r['need']) for g, r in d3.items() if r['need'] > 0]}")
