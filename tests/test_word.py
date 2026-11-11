"""Keeps His Word (docs/superpowers/plans/2026-11-11-keeps-his-word.md): your reputation for keeping promises, kept on
the coach, moved by kept and broken promises (most at the broken player's position), recovering each offseason, read
by recruits when you promise."""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))

from coach_career import word


def bare():
    return {"career": {}, "team": "iowa", "season_year": 2026}


def test_fresh_reads_start():
    st = bare()
    assert word.reading(st) == word.WORD_START
    assert word.reading(st, "QB") == word.WORD_START, "a position with no history reads the overall"
    assert word.word_text(70) == "Strong"
    assert "word" not in st["career"], "reading writes nothing"


def test_broken_hits_position_harder():
    st = bare()
    word.apply(st, "broken", "QB", "Jalen Moss")
    assert word.reading(st) == 62
    assert word.reading(st, "QB") == 54
    assert word.reading(st, "WR") == 62


def test_kept_gains_less_than_broken_costs():
    st = bare()
    word.apply(st, "kept", "WR", "A")
    word.apply(st, "broken", "WR", "B")
    assert word.reading(st) < word.WORD_START


def test_star_and_guarded_cost_more():
    st = bare()
    assert word.apply(st, "broken", "QB", "A", star=True) == -12
    assert word.apply(st, "broken", "QB", "B", star=True, personality="guarded") == -18


def test_recover():
    st = bare()
    b = word.book(st)
    b["overall"] = 50
    b["by_group"]["QB"] = -8
    word.recover(st)
    assert word.reading(st) == 55 and b["by_group"]["QB"] == -4


def test_clamped():
    st = bare()
    for i in range(20):
        word.apply(st, "broken", "QB", f"P{i}")
    assert word.reading(st) == 0 and word.reading(st, "QB") == 0
    st = bare()
    for i in range(50):
        word.apply(st, "kept", "QB", f"P{i}")
    assert word.reading(st) == 100 and word.reading(st, "QB") == 100


def test_last_broken():
    st = bare()
    word.apply(st, "broken", "QB", "First Guy")
    word.apply(st, "kept", "QB", "Kept Guy")
    word.apply(st, "broken", "QB", "Second Guy")
    assert word.last_broken(st, "QB") == "Second Guy"
    assert word.last_broken(st, "WR") is None


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("word ok")
