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


# ----- Task 2: the weekly snapshot (a career in its second season, with its league) -----

def second_season():
    """A career in 2027 with its own league (offseason run through): promises can exist."""
    from coach_career import offseason
    from sim import season
    import test_offseason
    st = season.new_season("iowa", "full", seed=5, career=True)
    test_offseason.finished(st)
    offseason.start(st)
    offseason.run_all(st)
    return offseason.next_season(st)


def promise_two(st):
    """Promise the starting QB and a bench player this season; return their slugs."""
    from sim import season
    me, year = st["team"], season.season_year(st)
    t = season._preview_team(st, me)
    rows = t["offense"] + t["defense"]
    qb = next(p for p in rows if p["position"] == "QB" and p.get("in_game"))
    bench = next(p for p in rows if not p.get("in_game") and p["position"] not in ("K", "P"))
    roster = {c["id"]: c for c in st["league"]["teams"][me]["roster"]}
    for slug in (qb["slug"], bench["slug"]):
        roster[slug]["promised"] = year
    return qb["slug"], bench["slug"], bench


def test_snapshot_records_each_week(st):
    from sim import season
    qb, bench, _ = promise_two(st)
    season.advance(st)
    season.advance(st)
    year = str(season.season_year(st))
    rec = pr.record(st)[year]
    played = [w for w in rec[qb]]
    assert len(rec[qb]) == len(rec[bench]) >= 1, rec
    assert all(w["started"] for w in rec[qb] if not w["injured"]) and not any(w["started"] for w in rec[bench]), rec
    assert [w["week"] for w in rec[qb]] == sorted({w["week"] for w in rec[qb]}), "one entry per week"


def test_snapshot_once_per_week(st):
    from sim import season
    year = str(season.season_year(st))
    before = {k: len(v) for k, v in pr.record(st)[year].items()}
    pr.snapshot_week(st, st["current_week"])          # that week again: nothing new
    assert {k: len(v) for k, v in pr.record(st)[year].items()} == before


def test_injured_is_marked(st):
    from sim import season
    qb, bench, row = promise_two(st)
    me = st["team"]
    st.setdefault("injuries", {}).setdefault(me, {})["test-hurt"] = {"name": row["name"], "position": row["position"], "weeks": 3}
    week = st["current_week"] + 1
    pr.snapshot_week(st, week)
    last = pr.record(st)[str(season.season_year(st))][bench][-1]
    assert last["week"] == week and last["injured"] is True, last
    st["injuries"][me].pop("test-hurt")


def test_first_season_records_nothing():
    from sim import season
    st = season.new_season("iowa", "full", seed=5, career=True)
    season.advance(st)
    assert not st.get("promises"), st.get("promises")


if __name__ == "__main__":
    import inspect
    _sys.path.insert(0, str(_Path(__file__).resolve().parent))
    later = None
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            if inspect.signature(fn).parameters:
                later = later or second_season()
                fn(later)
            else:
                fn()
    print("promises ok: late weeks weigh more, big games and a QB benching cost more, injured weeks do not count, personality sets the bar")
