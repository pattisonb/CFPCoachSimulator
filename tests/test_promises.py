"""Promises judged all season (docs/superpowers/plans/2026-11-11-promises-judged-all-season.md). Task 1: the score,
the bands and the chip on synthetic week lists."""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))

from coach_career import promises as pr


def weeks(started, big=(), injured=()):
    """12 weeks; `started` the week numbers (1-12) he started, `big` the big games, `injured` the weeks he was hurt."""
    return [{"week": w, "started": w in started, "injured": w in injured, "big": w in big} for w in range(1, 13)]


def weighted(ws, late=None):
    late = pr.LATE_WEIGHT if late is None else late
    counted = [w for w in ws if not w["injured"]]
    n = len(counted)
    wt = [1 + late * i / (n - 1) * 1 for i in range(n)]
    return round(sum(x for x, w in zip(wt, counted) if w["started"]) / sum(wt), 3)


def test_second_half_mostly_kept():
    ws = weeks(started=range(7, 13))
    s = pr.score(ws, "WR", "business")
    assert s == weighted(ws), (s, weighted(ws))
    assert pr.band(s, "business") == "kept", s


def test_lost_the_job_reads_worse():
    late = pr.score(weeks(started=range(7, 13)), "WR", "business")
    early = pr.score(weeks(started=range(1, 7)), "WR", "business")
    assert early < late and pr.band(early, "business") != "kept", (early, late)


def test_big_game_bench_hits():
    sat_big = weeks(started=range(1, 12), big=(12,))
    sat_plain = weeks(started=range(1, 12))
    assert pr.score(sat_big, "WR", "business") < pr.score(sat_plain, "WR", "business")
    assert pr.benched_big(sat_big) and not pr.benched_big(sat_plain)


def test_qb_bench_counts_more():
    ws = weeks(started=range(1, 12), big=(12,))
    assert pr.score(ws, "QB", "business") < pr.score(ws, "WR", "business")


def test_injured_weeks_do_not_count():
    ws = weeks(started=range(1, 5), injured=range(5, 13))
    assert pr.band(pr.score(ws, "WR", "business"), "business") == "kept"
    hurt = weeks(started=(), injured=range(1, 13))
    assert pr.score(hurt, "WR", "business") is None and pr.band(None, "business") == "none"


def test_personality_bars():
    assert pr.band(0.55, "shy") == "kept" and pr.band(0.55, "business") == "bent" and pr.band(0.55, "cocky") == "bent"
    assert pr.band(0.45, "cocky") == "broken" and pr.band(0.45, "business") == "bent"


def test_attention_big_games_count_double():
    ws = weeks(started=(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11), big=(6,))       # started the big game: it weighs more for him
    no = weeks(started=(1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12), big=(6,))      # sat the big game
    assert pr.score(no, "WR", "attention") < pr.score(no, "WR", "business"), "a missed big game costs the attention seeker more"


def test_chip_words():
    assert pr.chip("kept") == "On Track" and pr.chip("bent") == "Slipping" and pr.chip("broken") == "Broken" and pr.chip("none") is None


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("promises ok: late weeks weigh more, big games and a QB benching cost more, injured weeks do not count, personality sets the bar")
