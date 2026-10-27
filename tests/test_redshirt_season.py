"""Redshirting during the season (sim/season.py redshirt_toggle): any of your players with four
games or fewer and his year unused can be sat down for the rest of the season; he plays no more
games, his page says so, and the Departures step takes him as redshirting by default."""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))

from coach_career import offseason
from sim import season
from test_offseason import finished

if __name__ == "__main__":
    st = season.new_season("ohio-state", "full", seed=6, career=True)
    season.advance_to(st, 2)
    me = st["team"]
    t = season.load_teams()[me]
    starter = next(p for p in t["offense"] if p.get("in_game") and p.get("class") in ("FR", "SO", "JR"))
    bench = next(p for p in t["offense"] + t["defense"] if not p.get("in_game") and p.get("class") == "FR"
                 and season.redshirt_status(st, me, p)["games"] <= 4)
    used = next(p for p in t["offense"] + t["defense"] if (p.get("class") or "").endswith("RS") or p.get("class") in ("SR", "SRRS"))
    r = season.redshirt_toggle(st, me, bench["slug"], True)
    assert r["on"] and st["redshirting"][me][bench["slug"]]["name"] == bench["name"]
    try:
        season.redshirt_toggle(st, me, used["slug"], True); raise AssertionError("a used year redshirted")
    except season.RedshirtError:
        pass
    assert (bench["name"], bench["position"]) in season._injured(st, me)          # kept out of games like an injury
    prof = season.player_profile(st, me, slug=bench["slug"])
    assert prof["redshirt"]["on"] and prof["redshirt"]["games"] <= 4
    games_before = prof["redshirt"]["games"]
    season.advance_to(st, 5)
    assert season.player_profile(st, me, slug=bench["slug"])["redshirt"]["games"] == games_before, "he played while redshirting"
    # the starter played five: too late for him
    s5 = season.redshirt_status(st, me, starter)
    if s5["games"] > 4:
        try:
            season.redshirt_toggle(st, me, starter["slug"], True); raise AssertionError("five games and still redshirted")
        except season.RedshirtError:
            pass
    # off the redshirt and back on, then the offseason takes it as the default
    season.redshirt_toggle(st, me, bench["slug"], False)
    assert bench["slug"] not in st["redshirting"][me]
    season.redshirt_toggle(st, me, bench["slug"], True)
    finished(st)
    off = offseason.start(st)
    cand = next(p for p in off["redshirts"]["players"] if p["id"] == bench["slug"])
    assert cand["redshirt"] is True and cand["games"] == games_before
    season.close_pool()
    print(f"redshirt in season ok: {bench['name']} ({bench['position']} FR) sat from week 2 with {games_before} games")
