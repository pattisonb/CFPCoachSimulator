"""Coach Career: a season started as a career carries the career layer; a plain season, a
"remaining" season and older saves stay exactly as they were. (Run as a file: multiprocessing
on Windows.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `import season` works from here
import career
import season

if __name__ == "__main__":
    st = season.new_season("ohio-state", "full", seed=3, career=True)
    assert career.is_career(st) and st["career"]["year"] == 2026
    assert st["career"]["settings"]["auto_recruit"] is False and st["career"]["saved_week"] == 0

    plain = season.new_season("ohio-state", "full", seed=3)
    assert not career.is_career(plain) and "recruiting" not in plain
    season.advance(plain)
    assert plain["current_week"] == 1                      # older-style seasons play on unchanged

    try:
        season.new_season("ohio-state", "remaining", career=True)
        raise AssertionError("a career started from today")
    except ValueError:
        pass
    print("career ok")
