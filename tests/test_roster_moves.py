"""Redshirts and position changes (coach_career/offseason.py): at the Departures step you decide
who takes his redshirt among the players who played four games or fewer and still have it; a
player can move to another position, his overall recomputed for it; both apply to the league."""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))

from coach_career import league as lg, offseason
from sim import season
from test_offseason import finished

if __name__ == "__main__":
    st = season.new_season("ohio-state", "full", seed=4, career=True)
    season.advance_to(st, 2)
    finished(st)
    off = offseason.start(st)
    me = st["team"]
    rs = off["redshirts"]
    assert rs["players"] and all({"id", "name", "pos", "cls", "games", "team_games", "overall", "redshirt"} <= set(p) for p in rs["players"])
    assert all(p["games"] <= offseason.REDSHIRT_GAMES and not p["cls"].endswith("RS") and p["cls"] in ("FR", "SO", "JR") for p in rs["players"]), rs["players"][:2]
    roster = {c["id"]: c for c in st["league"]["teams"][me]["roster"]}
    assert all(roster[p["id"]]["cls"] == p["cls"] for p in rs["players"]), "classes advanced before the decision"
    p0 = rs["players"][0]
    offseason.redshirt(st, p0["id"], True)
    assert next(p for p in rs["players"] if p["id"] == p0["id"])["redshirt"] is True
    p1 = next((p for p in rs["players"] if p["id"] != p0["id"]), None)
    if p1:
        offseason.redshirt(st, p1["id"], False)
    try:
        offseason.redshirt(st, "nobody", True); raise AssertionError("an unknown player redshirted")
    except offseason.RosterError:
        pass
    # a position change: his overall is the formula at the new spot, and the preview says so
    mover = next(c for c in st["league"]["teams"][me]["roster"] if c["pos"] == "FS")
    opts = offseason.position_options(st, mover["id"])
    assert {"pos", "overall"} <= set(opts[0]) and any(o["pos"] == "CB" for o in opts) and any(o["pos"] == "SAM" for o in opts)
    cb = next(o for o in opts if o["pos"] == "CB")
    offseason.change_position(st, mover["id"], "CB")
    assert mover["pos"] == "CB" and mover["o"] == cb["overall"] and mover.get("moved_from") == "FS"
    assert any(m["id"] == mover["id"] and m["to"] == "CB" for m in off["position_changes"])
    try:
        offseason.change_position(st, mover["id"], "XX"); raise AssertionError("a made-up position")
    except offseason.RosterError:
        pass
    # advancing applies the redshirts: the chosen one keeps his year, the other moves up
    offseason.advance(st)
    roster = {c["id"]: c for c in st["league"]["teams"][me]["roster"]}
    assert roster[p0["id"]]["cls"] == p0["cls"] + "RS", roster[p0["id"]]["cls"]
    if p1:
        assert roster[p1["id"]]["cls"] == offseason.NEXT_CLASS[p1["cls"]]
    try:
        offseason.redshirt(st, p0["id"], False); raise AssertionError("redshirts changed after the step")
    except offseason.RosterError:
        pass
    v = offseason.view(st)
    assert v["redshirts"]["decided"] and v["position_changes"][0]["to"] == "CB"
    # the AI follows the four-game rule too: nobody who played five games takes a redshirt
    for slug, t in st["league"]["teams"].items():
        if slug == me:
            continue
        for c in t["roster"]:
            if c["cls"].endswith("RS") and c.get("rs_year") == off["year"] - 1:
                assert c.get("rs_games", 0) <= offseason.REDSHIRT_GAMES, (slug, c["n"], c.get("rs_games"))
    # the move holds on the next season's team
    st["offseason"]["auto"] = True
    offseason.run_all(st)
    new = offseason.next_season(st)
    t = season.load_teams()[me]
    moved = next(p for p in t["offense"] + t["defense"] if p["slug"] == mover["id"])
    assert moved["position"] == "CB", moved["position"]
    season.close_pool()
    print(f"roster moves ok: {len(rs['players'])} redshirt candidates, {mover['n']} FS->CB at {cb['overall']} OVR")
