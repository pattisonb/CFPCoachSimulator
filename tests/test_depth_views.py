"""Depth chart views: each row says how many players start there (the formation view lays
them out), the list view rates everyone at a role with that role's attribute columns, and a
role can be put in a new order (Auto reorder) only with the players it already holds."""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `from sim import season` works from here
from sim import season

if __name__ == "__main__":
    st = season.new_season("ohio-state", "full", seed=3)
    chart = season.depth_chart_view(st, "ohio-state")
    rows = {r["role"]: r for u in chart["units"] for r in u["rows"]}
    for role, row in rows.items():
        assert row["starters"] == sum(1 for p in row["players"] if p["starter"]) or role in ("KR", "PR"), (role, row["starters"])
    assert rows["WR"]["starters"] >= 2 and rows["QB"]["starters"] == 1 and rows["KR"]["starters"] == 1

    wr = season.position_candidates(st, "ohio-state", "WR")
    assert wr["starters"] == rows["WR"]["starters"]
    assert [c["key"] for c in wr["columns"]] == season.DEPTH_COLUMNS["WR"] and all(c["short"] and c["label"] for c in wr["columns"])
    smith = next(p for p in wr["players"] if p["in_role"])
    assert all(isinstance(smith["attrs"][k], int) for k in season.DEPTH_COLUMNS["WR"]), smith["attrs"]

    # a new order: the same players only
    order = list(reversed(wr["current"]))
    season.set_depth_order(st, "ohio-state", "WR", order)
    assert season.depth_order(st, "ohio-state", "WR") == order
    for bad in (order[:-1], order + ["nobody"], order[:-1] + [order[0]]):
        try:
            season.set_depth_order(st, "ohio-state", "WR", bad)
            raise SystemExit(f"accepted a bad order: {bad}")
        except ValueError:
            pass
    try:
        season.set_depth_order(st, "ohio-state", "KR", wr["current"][:1])
        raise SystemExit("accepted an order for the returner")
    except ValueError:
        pass
    after = {r["role"]: r for u in season.depth_chart_view(st, "ohio-state")["units"] for r in u["rows"]}
    assert after["WR"]["players"][0]["slug"] == order[0] and after["WR"]["starters"] == rows["WR"]["starters"]
    season.advance_to(st, 2)    # the season still sims with the new order
    print("depth views ok:", {r: rows[r]["starters"] for r in ("WR", "DT", "CB", "MIKE", "WILL") if r in rows})
