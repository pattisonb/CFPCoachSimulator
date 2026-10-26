"""A program's market (coach_career/programs.py, data/program_market.json): real home crowds and
TV audiences give every FBS program a market score 0-100 that the living program rating reads."""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))
import json
import statistics as st

from coach_career import programs
from sim import season

if __name__ == "__main__":
    d = json.loads(programs.MARKET.read_text(encoding="utf-8"))["teams"]
    assert len(d) >= 130, len(d)
    assert all(0 <= v["market"] <= 100 and v["attendance"] > 3000 and v["tv_millions"] > 0 for v in d.values())
    top = sorted(d, key=lambda s: -d[s]["market"])[:12]
    assert {"alabama", "georgia", "ohio-state", "michigan", "texas", "penn-state"} <= set(top), top
    assert sum(1 for v in d.values() if v["tv_known"]) >= 10
    teams = season.load_teams()
    p4 = [programs.market(s) for s, t in teams.items() if t["conference"] in programs.P4]
    g5 = [programs.market(s) for s, t in teams.items() if not t.get("fictional") and t["conference"] not in programs.P4 and s != "notre-dame"]
    assert st.median(p4) > st.median(g5) + 20, (st.median(p4), st.median(g5))
    assert programs.market("ndsu") == programs.MARKET_DEFAULT and programs.market("alabama") >= 95
    row = programs.market_row("ohio-state")
    assert row["attendance"] > 100000 and row["tv_known"] and row["market"] >= 85, row
    print(f"program market ok: {len(d)} programs, top {top[:5]}, P4 median {st.median(p4)} vs G5 {st.median(g5)}")
