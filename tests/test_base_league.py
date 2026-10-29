"""The precomputed base league (league.write_base_files): data/base_league.json is from_base()'s
output and data/base_meta.json every team's identity, so the browser bundle never reads the 146
source rosters. With the files, from_base, base_meta and base_slugs answer from them, the same as
the source files would. The files go to a temporary folder, never into data/."""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root
import json
import shutil
import tempfile

from coach_career import league


def test_precomputed_league_matches_live(tmp_dir):
    live = league.from_base(2027)
    league.BASE_LEAGUE_FILE, league.BASE_META_FILE = tmp_dir / "bl.json", tmp_dir / "bm.json"
    league.write_base_files()
    league.base_meta.cache_clear(); league.base_slugs.cache_clear()
    assert league.from_base(2028)["year"] == 2028
    assert {t["program"]["year"] for t in league.from_base(2028)["teams"].values()} == {2027}   # as programs.init sets it
    assert json.dumps(league.from_base(2027), sort_keys=True) == json.dumps(live, sort_keys=True)
    assert league.base_slugs() == tuple(sorted(json.loads(league.BASE_META_FILE.read_text())))
    assert league.base_meta("smu")["conference"] and "roster" not in league.base_meta("smu")


if __name__ == "__main__":
    tmp = _Path(tempfile.mkdtemp(prefix="cfp-base-league-"))
    try:
        test_precomputed_league_matches_live(tmp)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print("ok")
