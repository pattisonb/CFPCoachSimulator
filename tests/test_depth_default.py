"""Your depth chart defaults to overall every season (coach_career/league.py lineup with
by_overall for your team, built into the season's teams file at next_season): two seasons into
a career every role of your chart is in overall order (ties by name), the season's overrides
and redshirts did not carry over, a stale override naming a departed player is ignored, and a
move you make still pins the player. (Run as a file: multiprocessing on Windows.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))

from coach_career import offseason
from sim import season
from test_offseason import finished


def roll(st: dict) -> dict:
    finished(st)
    offseason.start(st)
    st["offseason"]["auto"] = True
    offseason.run_all(st)
    return offseason.next_season(st)


def role_orders(team: dict) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for p in team["offense"] + team["defense"]:
        if p.get("role"):
            out.setdefault(p["role"], []).append(p)
    for ps in out.values():
        ps.sort(key=lambda p: p["depth"])
    return out


if __name__ == "__main__":
    st = season.new_season("ohio-state", "full", seed=5, career=True)
    me = st["team"]
    t = season.load_teams()[me]
    wrs = [p for p in t["offense"] if p.get("role") == "WR"]
    season.move_depth(st, me, "WR", wrs[-1]["slug"], "top")           # a season-one override, with a slug that may leave
    season.redshirt_toggle(st, me, next(p["slug"] for p in t["offense"] + t["defense"] if p.get("class") == "FR" and not p.get("in_game")), True)
    new = roll(st)
    new2 = roll(new)
    assert new2["year"] == st["year"] + 2
    assert not new2.get("depth") and not new2.get("redshirting"), "last season's overrides or redshirts carried into the new season"
    # every role by overall, ties by name, and the starters are the top of each role
    t = season.load_teams()[me]
    orders = role_orders(t)
    assert len(orders) >= 19, sorted(orders)
    for role, ps in orders.items():
        keys = [(-season.shown_overall(p), p["name"]) for p in ps]
        assert keys == sorted(keys), (role, [(p["name"], season.shown_overall(p)) for p in ps])
        n = sum(1 for p in ps if p.get("in_game"))
        assert all(p.get("in_game") for p in ps[:n]) and not any(p.get("in_game") for p in ps[n:]), role
    view = season.depth_chart_view(new2, me)
    for u in view["units"]:
        for r in u["rows"]:
            if r["role"] in ("KR", "PR"):
                continue
            ovr = [c["overall"] for c in r["players"]]
            assert ovr == sorted(ovr, reverse=True), (r["role"], ovr)
    assert not view["overridden"]
    # a stale override (a player who left) is ignored; the one still here is pinned where you put him
    wr = orders["WR"]
    new2["depth"] = {me: {"WR": ["someone-who-graduated", wr[2]["slug"]]}}
    order = season.depth_order(new2, me, "WR")
    assert order[0] == wr[2]["slug"] and "someone-who-graduated" not in order, order
    assert order[1:] == [p["slug"] for p in wr if p["slug"] != wr[2]["slug"]], "the rest fall in by overall"
    new2["depth"] = {}
    # a move you make still pins, everyone else by overall
    qb = orders["QB"]
    season.move_depth(new2, me, "QB", qb[-1]["slug"], "top")
    order = season.depth_order(new2, me, "QB")
    assert order[0] == qb[-1]["slug"] and order[1:] == [p["slug"] for p in qb[:-1]], order
    chart = {r["role"]: r["players"] for u in season.depth_chart_view(new2, me)["units"] for r in u["rows"]}
    assert chart["QB"][0]["slug"] == qb[-1]["slug"] and chart["QB"][0]["starter"]
    # the CPU staffs still pick by their own eye (overall, experience and what the numbers miss)
    other = role_orders(season.load_teams()["georgia"])
    eye = sum(1 for ps in other.values() if [season.shown_overall(p) for p in ps] != sorted((season.shown_overall(p) for p in ps), reverse=True))
    assert eye > 0, "a CPU team's chart is a plain overall sort"
    season.close_pool()
    print(f"depth default ok: {new2['year']} {me} every role by overall ({len(orders)} roles), overrides and redshirts cleared, pins hold; georgia's eye differs in {eye} roles")
