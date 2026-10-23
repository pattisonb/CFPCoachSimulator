"""Check that Army-Navy is played in selection week, after the bracket is set.
(Run as a file: multiprocessing on Windows cannot spawn workers from a piped script.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `from sim import season` works from here
from sim import season

if __name__ == "__main__":
    st = season.new_season("army", "full", seed=3)
    season.advance_to(st, 16)
    an = [g for g in st["games"].values() if {g["home"], g["away"]} == {"army", "navy"}]
    for g in an:
        print(f"week {g['week']} played={g['played']} {g['away_display']} {g['away_score']} at {g['home_display']} {g['home_score']} neutral={g['neutral']} site={g.get('site')}")
    print("bracket set before Army-Navy:", bool(st["bracket"]), "| Army in field:", any(x["team"] == "army" for x in st["bracket"]["seeds"]))
    print("week 15 games:", [(g["away_display"], g["home_display"]) for g in st["games"].values() if g["week"] == 16])
