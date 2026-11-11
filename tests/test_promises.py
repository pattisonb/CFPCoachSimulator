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


# ----- Task 3: the offseason reads the band -----

def _ctx(band=None, personality="business", benched=False, slug="pl"):
    return {"year": 2028, "losing": False, "p4": True, "tier": 2, "slipping": None, "rising": False,
            "promise": {} if band is None else {slug: {"band": band, "score": 0.3, "benched_big": benched, "personality": personality}}}


def _p(cls, pos="WR"):
    return {"id": "pl", "cls": cls, "pos": pos, "o": 60, "promised": 2027}


def _total(parts):
    return round(sum(v for _, v in parts), 4)


def test_broken_junior_all_but_gone():
    from coach_career import offseason
    assert _total(offseason.portal_odds(_p("JR"), "bench", _ctx("broken"))) == 0.92


def test_broken_freshman_may_wait():
    from coach_career import offseason
    assert _total(offseason.portal_odds(_p("FR"), "bench", _ctx("broken", personality="shy"))) == 0.50


def test_broken_big_qb_more():
    from coach_career import offseason
    assert _total(offseason.portal_odds(_p("JR", "QB"), "bench", _ctx("broken"))) == 0.95


def test_bent_adds_half():
    from coach_career import offseason
    parts = dict(offseason.portal_odds(_p("SO"), "bench", _ctx("bent")))
    assert abs(parts["promised"] - parts["role"] * (pr.BENT_MULT - 1)) < 1e-9, parts


def test_kept_stays_more():
    from coach_career import offseason
    kept = _total(offseason.portal_odds(_p("SO"), "bench", _ctx("kept")))
    plain = _total(offseason.portal_odds(dict(_p("SO"), promised=None), "bench", _ctx()))
    assert abs(kept - plain * offseason.KEPT_STAY) < 1e-4, (kept, plain)


def test_old_save_old_rule():
    from coach_career import offseason
    parts = dict(offseason.portal_odds(_p("SO"), "bench", _ctx()))
    assert abs(parts["promised"] - parts["role"] * (offseason.PROMISE_BROKEN - 1)) < 1e-9, parts


def test_promise_again_and_nil():
    from coach_career import offseason
    e = {"ask": {"kind": "nil", "nil": 100}, "offers": {"nil": 0, "promise": True}, "role_next": "starter", "intent": "portal",
         "broken_promise": True}
    assert offseason.stay_chance(e) == pr.PROMISE_AGAIN_STAY
    assert offseason.stay_chance(dict(e, offers={"nil": 0, "promise": False})) == 0.02
    assert offseason.stay_chance(dict(e, no_third=True)) == 0.02, "a third promise is worth nothing"
    for kind, mult in (("business", 0.8), ("cocky", 1.3), ("shy", 1.0)):
        assert pr.nil_mult(kind) == pr.PROMISE_NIL_MULT * mult


# ----- Task 4: the chip and the first "Slipping" line -----

def test_now_reads_so_far(st):
    """The second-season career: the starter promised reads On Track, the bench player Slipping or Broken; the depth
    chart's card and his player page carry the same word."""
    from sim import season
    qb, bench, _ = promise_two(st)
    if len([w for w in pr.record(st)[str(season.season_year(st))].get(bench, []) if not w["injured"]]) < 2:
        season.advance(st)
        season.advance(st)
    chips = pr.chips_now(st)
    assert chips.get(qb) == "On Track" and chips.get(bench) in ("Slipping", "Broken"), chips
    cards = {c["slug"]: c for c in season.depth_roster_view(st, st["team"])["players"]}
    assert cards[bench]["promise"] == chips[bench] and cards[qb]["promise"] == "On Track"
    assert season.player_profile(st, st["team"], slug=bench)["promise"] == chips[bench]


def test_news_once(st):
    from sim import season
    items = [n for n in pr.news(st)]
    mine = [n for n in items if n["slug"] == promise_two(st)[1]]
    assert len(mine) == 1 and mine[0]["line"] == pr.SLIPPING_LINE and mine[0]["kind"] == "promise", mine
    season.advance(st)
    assert len([n for n in pr.news(st) if n["slug"] == mine[0]["slug"]]) == 1, "said once"


# ----- review fixes -----

def test_game_day_snapshots_before_the_game(st):
    """Game day (play_my_game) plays your game before advance: the week is recorded then, from that lineup."""
    from sim import season
    qb, bench, _ = promise_two(st)
    while season.my_game_id(st, st["current_week"] + 1) is None:     # past any bye: a week with your game
        season.advance(st)
    week = st["current_week"] + 1
    assert season.play_my_game(st) is not None
    rec = (st.get("promises") or {}).get(str(season.season_year(st))) or {}
    assert any(w["week"] == week for w in rec.get(qb, [])), "game day recorded the week before the game"
    season.advance(st)


def test_two_promise_lines_in_one_week(st):
    """Program News keeps every promise line of a week (they carry a slug, no pid)."""
    from coach_career import office
    real = pr.news
    pr.news = lambda state: [{"week": state["current_week"], "kind": "promise", "slug": s, "name": n, "position": "WR", "line": pr.SLIPPING_LINE}
                             for s, n in (("a-one", "A One"), ("b-two", "B Two"))]
    try:
        names = {n.get("name") for n in office.program_news(st) if n.get("kind") == "promise"}
    finally:
        pr.news = real
    assert names == {"A One", "B Two"}, names


def test_promise_carries_the_recruit_personality():
    """The promised row keeps the personality the recruiting page showed (persona.of), so he is graded on it."""
    row = {"id": "x-guy"}
    pr.mark_promised(row, 2028, "cocky")
    assert row["promised"] == 2028 and row["persona"]["personality"] == "cocky"


def test_broken_band_is_broken_whatever_the_draw():
    """A Broken band reads broken at Keep Them Home even when the draw landed in his role segment."""
    from coach_career import offseason
    assert offseason._broken_promise("buried", {"band": "broken"}, "portal") is True
    assert offseason._broken_promise("promised", None, "portal") is True            # untracked: the old rule broke it
    assert offseason._broken_promise("promised", {"band": "bent"}, "portal") is False
    assert offseason._broken_promise("buried", {"band": "broken"}, "draft") is False   # a draft entrant is not the portal


def test_no_third_promise_writes_nothing():
    """A no-third leaver kept with NIL: your promise toggle does not promise him again."""
    from coach_career import offseason
    assert offseason._keeps_promise({"offers": {"promise": True}, "no_third": True}) is False
    assert offseason._keeps_promise({"offers": {"promise": True}}) is True


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
