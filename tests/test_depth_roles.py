"""Every roster keeps a center, and a SAM where its scheme has one (offseason.fill_roles): two
offseasons into a career (finished seasons faked as in test_offseason.py) no team ends an
offseason without a natural C, and every team without a SAM plays a defense with two
linebackers in its base front (a 4-2-5: the nickel back plays where the SAM would). Your own
team's move shows in Position Changes and Undo takes it back. (Run as a file: multiprocessing
on Windows.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))

import collections

from coach_career import league
from coach_career import offseason
from sim import season
from test_offseason import finished


def missing(lgd: dict) -> dict[str, list[str]]:
    """The teams with no natural C, and the ones with no SAM whose scheme has one."""
    out = {"C": [], "SAM": []}
    for slug, t in lgd["teams"].items():
        held = {c["pos"] for c in t["roster"]}
        if "C" not in held:
            out["C"].append(slug)
        if "SAM" not in held and offseason.has_sam(offseason.defense_scheme(t)):
            out["SAM"].append(slug)
    return out


if __name__ == "__main__":
    st = season.new_season("georgia", "full", seed=3, career=True)
    me = st["team"]
    filled, no_sam_schemes = collections.Counter(), collections.Counter()
    for year in range(2):
        finished(st)
        offseason.start(st)
        st["offseason"]["auto"] = True
        while st["offseason"]["stage"] != "staff":
            offseason.advance(st)
        if year == 0:          # your centers all gone: your staff moves a lineman there, and you can take it back
            roster = st["league"]["teams"][me]["roster"]
            roster[:] = [c for c in roster if c["pos"] != "C"]
        offseason.advance(st)
        off, lgd = st["offseason"], st["league"]
        assert off["stage"] == "ready"
        gaps = missing(lgd)
        assert not gaps["C"] and not gaps["SAM"], f"offseason {year + 1}: teams missing a role: {gaps}"
        for slug, t in lgd["teams"].items():
            if not any(c["pos"] == "SAM" for c in t["roster"]):
                scheme = offseason.defense_scheme(t)
                assert not offseason.has_sam(scheme), (slug, scheme)
                no_sam_schemes[scheme] += 1
        filled.update(f"{m['from']}->{m['to']}" for m in off["roles_filled"])
        for m in off["roles_filled"]:
            t = lgd["teams"][m["team"]]
            c = next(c for c in t["roster"] if c["id"] == m["id"])
            assert c["pos"] == m["to"] and c.get("moved_from"), m
            assert offseason.GROUP[m["from"]] == offseason.GROUP[m["to"]], m          # a lineman to center, a linebacker to SAM
            same = [x for x in t["roster"] if x["pos"] == m["from"]]
            assert same, f"{m['team']}: the move emptied {m['from']}"
        if year == 0:
            mine = [m for m in off["position_changes"] if m["to"] == "C"]
            assert len(mine) == 1, off["position_changes"]
            undo = offseason.change_position(st, mine[0]["id"], mine[0]["from"])
            assert undo["pos"] == mine[0]["from"] and not any(m["id"] == mine[0]["id"] for m in off["position_changes"])
            assert offseason.empty_roles(lgd["teams"][me]) == ["C"]
            st = offseason.next_season(st)
            assert not any(c["pos"] == "C" for c in st["league"]["teams"][me]["roster"]), "Undo was overruled at the next season"
        else:
            st = offseason.next_season(st)
    assert filled, "no staff filled a role in two offseasons (the check would prove nothing)"
    league.forget(st["id"])
    season.close_pool()
    print(f"depth roles ok: after two offseasons 0 teams without a C, 0 without a SAM their scheme has; "
          f"moves {dict(filled)}; no SAM, by scheme (two-linebacker fronts): {dict(no_sam_schemes)}")
