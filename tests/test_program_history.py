"""Program ratings' starting values (tools/build_program_history.py -> data/program_history.json,
read by coach_career/programs.py): every FBS program's history, winning, market, NIL, conference
and coach scores (0-100), the mixed rating and its tier, with the top of the list recognizable."""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))
import json
import statistics as st

from coach_career import programs
from sim import season

if __name__ == "__main__":
    d = json.loads(programs.HISTORY.read_text(encoding="utf-8"))["teams"]
    teams = season.load_teams()
    fbs = [s for s, t in teams.items() if not t.get("fictional")]
    assert all(s in d for s in fbs), [s for s in fbs if s not in d][:5]
    keys = {"history", "prestige", "winning", "market", "nil", "conference", "coach", "rating", "tier"}
    for s in fbs:
        p = d[s]
        assert keys <= set(p) and all(0 <= p[k] <= 100 for k in keys - {"tier"}) and 1 <= p["tier"] <= 5, (s, p)
    top = sorted(fbs, key=lambda s: -d[s]["rating"])
    blue = {"ohio-state", "georgia", "alabama", "texas", "michigan", "oregon", "notre-dame", "lsu", "penn-state", "clemson", "usc", "oklahoma"}
    assert len(blue & set(top[:25])) >= 11, [s for s in blue if s not in top[:25]]
    assert len({"florida-state", "texas-a-m", "florida", "miami", "tennessee", "auburn", "ole-miss", "wisconsin", "iowa", "washington"} & set(top[:30])) >= 7, top[:30]
    assert d["ohio-state"]["tier"] == 1 and d["alabama"]["tier"] == 1 and d["akron"]["tier"] == 5 and d["ohio-state"]["history"] >= 90
    hist = [d[s]["history"] for s in fbs]
    assert 100 >= max(hist) and 32 <= st.median(hist) <= 48, (max(hist), st.median(hist))
    tiers = st.Counter if False else None
    counts = {k: sum(1 for s in fbs if d[s]["tier"] == k) for k in range(1, 6)}
    assert 6 <= counts[1] <= 16 and counts[2] >= 10 and counts[5] >= 15, counts
    # the base loader and the z the old readers expect (about -2 to +2, in step with the recruiting baseline)
    b = programs.base("ohio-state")
    assert b["tier"] == 1 and programs.z_of(b["rating"]) > 1.2 and programs.z_of(programs.base("akron")["rating"]) < -0.8
    assert programs.base("ndsu")["tier"] == 5
    from coach_career import programs
    assert programs.pick_points(1) == 4 and programs.pick_points(3) == 2 and programs.pick_points(7) == 1
    line = programs.draft_line(2025, [(1, "WR"), (2, "CB"), (7, "WR")])
    assert line == [2025, 8, {"WR": 5, "CB": 3}]
    lines = [[y, 1, {"QB": 1}] for y in range(2016, 2026)]
    assert programs.pro_score(lines, 2025) == 15 and programs.pro_group_scores(lines, 2025) == {"QB": 15}   # five old at 1, five new at 2
    assert programs.pro_score([[2010, 50, {"QB": 50}]] + lines, 2025) == 15, "only the last ten lines count"
    for s in fbs:
        p = d[s]
        assert 0 <= p["pro"] <= 100 and len(p["drafts"]) == 10 and p["drafts"][0][0] == 2016 and p["drafts"][-1][0] == 2025, (s, p.get("pro"))
        assert all(0 <= v <= 100 for v in p["pro_groups"].values())
    assert d["alabama"]["pro"] == 100 and d["ohio-state"]["pro"] >= 85 and d["georgia"]["pro"] >= 85
    assert d["army"]["pro"] == 0 and d["army"]["pro_groups"] == {} and d["kent-state"]["pro"] == 0
    pro = [d[s]["pro"] for s in fbs]
    assert 32 <= st.median(pro) <= 48, st.median(pro)
    assert d["ohio-state"]["pro_groups"]["WR"] >= 80 and d["alabama"]["pro_groups"].get("OT", 0) >= 60
    sc = json.loads(programs.HISTORY.read_text(encoding="utf-8"))["scales"]
    assert sc["pro"]["lo"] == 0 and sc["pro"]["hi"] > 0 and set(sc["pro_group"]) >= {"QB", "WR", "OT", "EDGE", "CB"}
    assert abs(sum(programs.WEIGHTS.values()) - 1.0) < 1e-9 and programs.WEIGHTS["pro"] == 0.10
    print(f"program history ok: top {top[:8]}, tiers {counts}, history median {st.median(hist):.0f}")
