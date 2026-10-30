"""Depth chart views: each row says how many players start there, the personnel view rates
everyone at a role with that role's attribute columns, a role can be put in a new order (Auto
reorder) only with the players it already holds, and the formations are filled exactly as the
engine fills them from the chart (an injured starter left out)."""
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
    # formations: the scheme's three most-used groupings, each filled as the engine fills it from the chart
    from engine import personnel
    from engine.game import GameSim
    forms = season.formations_view(st, "ohio-state")
    off = forms["offense"]["formations"]
    mix = personnel.SCHEME_MIX.get(forms["offense"]["scheme"], personnel.DEFAULT_MIX)
    assert [f["id"] for f in off] == sorted(mix, key=lambda g: -mix[g])[:3], [f["id"] for f in off]
    team = GameSim._make_team(season._preview_team(st, "ohio-state"))
    for f in off:
        team.set_grouping(f["id"], personnel.GROUPINGS[f["id"]])
        want = {p.slug for p in team._lineup["offense"] if p.position not in ("K", "P")}
        got = {s["player"]["slug"] for s in f["slots"] if s["player"]}
        assert got == want and len(f["slots"]) == 11, (f["id"], got ^ want)
    assert next(s for s in off[0]["slots"] if s["slot"] == "WR1")["player"]["slug"] == order[0]   # the new WR order is on the field
    dfn = forms["defense"]["formations"]
    assert 2 <= len(dfn) <= 3 and all(len(f["slots"]) == 11 for f in dfn)
    assert len({f["personnel"] for f in dfn}) == len(dfn), "each package a different shape"
    labels = [s["label"] for s in dfn[0]["slots"]]
    assert len(labels) == len(set(labels)), labels                                           # DT1 and DT2, not DT twice
    st_forms = {f["id"]: f for f in forms["special"]["formations"]}
    assert [s["slot"] for s in st_forms["return"]["slots"]] == ["KR", "PR"] and st_forms["fg"]["slots"][0]["player"]["position"] == "K"
    # an injured starter is left out of the formation, his backup takes the spot
    qb = next(s for s in off[0]["slots"] if s["slot"] == "QB")["player"]
    st.setdefault("injuries", {}).setdefault("ohio-state", {})[f"{qb['name']}|{qb['position']}"] = {"name": qb["name"], "position": qb["position"], "type": "Ankle", "weeks_left": 2}
    qb2 = next(s for s in season.formations_view(st, "ohio-state")["offense"]["formations"][0]["slots"] if s["slot"] == "QB")["player"]
    assert qb2["slug"] != qb["slug"], "the injured quarterback still starts"
    roster = season.depth_roster_view(st, "ohio-state")["players"]
    assert len(roster) == chart["roster_size"] and next(p for p in roster if p["slug"] == qb["slug"])["injury"]["weeks_left"] == 2
    del st["injuries"]["ohio-state"][f"{qb['name']}|{qb['position']}"]
    season.advance_to(st, 2)    # the season still sims with the new order
    print("depth views ok:", {r: rows[r]["starters"] for r in ("WR", "DT", "CB", "MIKE", "WILL") if r in rows}, "| formations", [f["id"] for f in off], [f["personnel"] for f in dfn])
