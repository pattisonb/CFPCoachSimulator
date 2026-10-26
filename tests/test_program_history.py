"""Program ratings' starting values (tools/build_program_history.py -> data/program_history.json,
read by coach_career/programs.py): every FBS program's history, winning, market, NIL, conference
and coach scores (0-100), the mixed rating and its tier, with the top of the list recognisable."""
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
    print(f"program history ok: top {top[:8]}, tiers {counts}, history median {st.median(hist):.0f}")
