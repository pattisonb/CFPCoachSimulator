"""Building a career's league from the base teams must not keep the 136 source files in memory:
the server on a 512 MB instance was pushed over the line by exactly that (the first offseason of a
played career peaked at 530 MB). The league keeps its compact rosters; the raw files are read and
dropped, and the identity fields every other caller needs come from a small cached projection."""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root
import gc
import tracemalloc

from coach_career import league

if __name__ == "__main__":
    gc.collect()
    tracemalloc.start()
    before = tracemalloc.get_traced_memory()[0]
    lgd = league.from_base(2027)
    gc.collect()
    held = (tracemalloc.get_traced_memory()[0] - before) / 1e6
    peak = (tracemalloc.get_traced_memory()[1] - before) / 1e6
    tracemalloc.stop()
    assert len(lgd["teams"]) > 100
    assert held < 90, f"building the league holds {held:.0f} MB; the base files must not stay cached"
    assert peak < 140, f"building the league peaks at {peak:.0f} MB over the start"
    # the identity a team keeps for the engine and the offseason's names comes from a small projection
    meta = league.base_meta("ohio-state")
    assert meta["short_name"] == "Ohio State" and meta["slug"] == "ohio-state" and "roster" not in meta and "depth_chart" not in meta
    # a league team in the source format still carries the base identity and the league's roster
    t = league.source_team(lgd, "ohio-state")
    assert t["short_name"] == "Ohio State" and len(t["roster"]) >= 70 and t["coaches"] and t["starters"]
    # the full base file is still there for a fictional stand-in (never in the league)
    fict = next(s for s in league.base_slugs() if league.base_meta(s)["fictional"])
    assert league.base_team(fict)["roster"]
    print(f"league memory ok: building from the base files holds {held:.0f} MB, peaks {peak:.0f} MB")
