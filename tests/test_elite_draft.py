"""Elite underclassmen go to the draft (offseason.py): a draft-eligible underclassman rated ELITE_DECLARE
(95) or better who played at least ELITE_MIN_GAMES games always declares and is picked; projected
first-rounders almost always go (DECLARE). On your own team he still shows at Keep Them Home, where he
stays only ELITE_STAY of the time whatever you offer. A played career's Jeremiah Smith (Ohio State's
WR, a junior rated 99) is the regression. `python3 tests/test_elite_draft.py`"""
import copy
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from coach_career import league as lg   # noqa: E402
from coach_career import offseason   # noqa: E402
from sim import season   # noqa: E402
from test_offseason import finished   # noqa: E402

JS = "jeremiah-smith"


def rule() -> None:
    p = {"id": "x", "pos": "WR", "o": 96, "cls": "JR"}
    n = offseason.ELITE_MIN_GAMES
    assert offseason.elite(p, {"x": n}) and offseason.elite(p, None)
    assert not offseason.elite(p, {"x": n - 1}), "a season too short to count"
    assert not offseason.elite(dict(p, o=offseason.ELITE_DECLARE - 1), {"x": 12})
    assert offseason.elite(dict(p, cls="SORS"), {"x": 12}) and offseason.elite(dict(p, cls="JRRS"), {"x": 12})
    assert not offseason.elite(dict(p, cls="SO"), {"x": 12}) and not offseason.elite(dict(p, cls="SR"), {"x": 12}), "only draft-eligible underclassmen"
    assert offseason.DECLARE[0][1] >= 0.97 and next(c for cut, c in offseason.DECLARE if 32 <= cut) >= 0.95, "projected first-rounders almost always go"


def board() -> None:
    """Thirty draws of the draft board on the base league: every eligible 95+ who played declares and is picked."""
    base = lg.from_base(2027)
    played = {slug: {p["id"]: 12 for p in t["roster"]} for slug, t in base["teams"].items()}
    stars = [p["id"] for t in base["teams"].values() for p in t["roster"]
             if p["cls"] in offseason.UNDERCLASS_ELIGIBLE and offseason.house(p["pos"], p["o"]) >= offseason.ELITE_DECLARE]
    assert JS in stars, stars
    for seed in range(30):
        declared, drafted = offseason.draft_board(base, random.Random(f"elite-{seed}"), played)
        for i in stars:
            assert i in declared and i in drafted, (seed, i)
        assert drafted[JS] <= 3, drafted[JS]
    # a star who barely played is not forced: the elite rule leaves the declare roll alone (same draws, same board)
    benched = copy.deepcopy(played)
    for slug in benched:
        for i in stars:
            benched[slug].pop(i, None)
    a = offseason.draft_board(base, random.Random("elite-x"), benched)
    b = offseason.draft_board(base, random.Random("elite-x"), played)
    assert set(b[0]) - set(a[0]) <= set(stars), "the elite rule moved someone else's declaration"


def your_star() -> None:
    """Ohio State's Jeremiah Smith waits at Keep Them Home; he is nearly impossible to keep."""
    st = season.new_season("ohio-state", "full", seed=5, career=True)
    finished(st)
    off = offseason.start(st)
    e = next(x for x in off["retention"]["players"] if x["id"] == JS)
    assert e["intent"] == "draft" and e["elite"] and e["draft_pick"] <= 3, e
    big = dict(e, offers={"nil": 10 ** 5, "promise": True}, ask=dict(e["ask"], known=True))
    assert offseason.stay_chance(big) == offseason.ELITE_STAY, offseason.stay_chance(big)
    v = offseason.view(st)
    assert v["retention"]["elite_stay"] == offseason.ELITE_STAY
    offseason.advance(st)
    d = next(x for x in off["departures"] if x["id"] == JS)
    assert d["kind"] == "draft" and d["pick"] <= 3 and d["early"], d
    # as another school's player he declares and goes too (SMU's career)
    st = season.new_season("smu", "full", seed=5, career=True)
    finished(st)
    off = offseason.start(st)
    assert JS not in off["draft"]["ai_kept"]
    off["auto"] = True
    offseason.advance(st)
    d = next(x for x in off["departures"] if x["id"] == JS)
    assert d["kind"] == "draft" and d["pick"] <= 3, d


def played_career() -> None:
    """The regression: seed 13's career, its season played for real (SMU). The departures stream's first
    draws are the draft board's, and the board is the same in every first offseason, so the seed alone
    decided it: Jeremiah Smith ranked first and drew the 5% no-declare roll (DECLARE's 95% then), and
    stayed a senior. Now a 99 who played the whole season declares and goes first. As Ohio State
    (a faked season, same seed) he waits at Keep Them Home as an elite entrant and is still picked."""
    st = season.new_season("smu", "full", seed=13, career=True)
    st["career"]["settings"]["auto_recruit"] = "season"
    season.advance_to(st, season.FINAL_WEEK)
    games = offseason._games_played(st)["ohio-state"]
    assert games[JS] >= offseason.ELITE_MIN_GAMES, games[JS]
    # the old rule on this seed: rank 1, and the roll says stay
    year = season.season_year(st) + 1
    lgd = copy.deepcopy(st.get("league") or lg.from_base(year))
    old = offseason.DECLARE, offseason.ELITE_DECLARE
    offseason.DECLARE = ((32, 0.95), (64, 0.88), (100, 0.65), (160, 0.35), (257, 0.12), (10 ** 9, 0.004))
    offseason.ELITE_DECLARE = 10 ** 6                                                         # the elite rule off
    try:
        pool, declared = offseason.draft_scores(lgd, offseason._rng(st, "departures"))
    finally:
        offseason.DECLARE, offseason.ELITE_DECLARE = old
    assert pool[0][2]["id"] == JS and JS not in declared, "seed 13 no longer reproduces the old miss"
    off = offseason.start(st)
    off["auto"] = True
    offseason.advance(st)
    d = next(x for x in off["departures"] if x["id"] == JS)
    assert d["kind"] == "draft" and d["pick"] == 1 and d["early"], d
    lg.forget(st["id"])
    st = season.new_season("ohio-state", "full", seed=13, career=True)
    finished(st)
    off = offseason.start(st)
    e = next(x for x in off["retention"]["players"] if x["id"] == JS)
    assert e["elite"] and e["draft_pick"] == 1, e
    off["auto"] = True
    offseason.advance(st)
    assert next(x for x in off["departures"] if x["id"] == JS)["pick"] == 1


if __name__ == "__main__":
    rule()
    board()
    your_star()
    played_career()
    season.close_pool()
    print("elite draft ok: a 95+ eligible underclassman after a decent season declares and is picked; nearly impossible to keep")
