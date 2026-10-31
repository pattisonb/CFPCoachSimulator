"""League news while simming (sim/news.py, GET /api/season/{id}/news): a seeded career simmed four
weeks answers with items of the known kinds, at most six a week, oldest week first, FBS teams only;
a forced upset makes an upset item and a top-5 change a rankings item; your own team shows only in
upsets; the news never changes the season. Saves go to a temporary folder. (Run as a file:
multiprocessing on Windows.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `from app import api` works from here

import copy
import json
import re

from app import api
from sim import coaches
from sim import news
from sim import season

WEEKS = 4


def sim_career() -> dict:
    s = api.call("POST", "/api/season", {"team": "smu", "seed": 23, "career": True})
    api.call("POST", f"/api/season/{s['id']}/advance", {"to": WEEKS})
    while api.step() is not None:
        pass
    st = api.loaded_state()
    assert st["current_week"] == WEEKS, st["current_week"]
    return st


def check_items(st: dict, items: list) -> None:
    teams = season.load_teams()
    fbs = season.fbs_only(teams)
    weeks = [i["week"] for i in items]
    assert weeks == sorted(weeks), weeks
    for w in set(weeks):
        assert weeks.count(w) <= news.NEWS_PER_WEEK, (w, weeks.count(w))
    for i in items:
        assert i["kind"] in news.KINDS, i
        assert 1 <= i["week"] <= st["current_week"], i
        t = i["text"]
        assert t and t[0].isupper() and t.endswith("."), t
        assert not re.search(r"\b(None|null|undefined|NaN)\b", t), t
        assert "FCS" not in t, t
        if "team" in i:
            assert i["team"] in fbs, i
        link = i.get("link")
        if link:
            assert link["type"] in ("game", "team", "recruit"), link
            if link["type"] == "game":
                assert link["event_id"] in st["games"], link
            elif link["type"] == "team":
                assert link["slug"] in fbs, link
            else:
                assert link["pid"] in st["recruiting"]["prospects"], link
        if i["kind"] != "upset":
            assert i.get("team") != st["team"], i


def test_endpoint(st: dict) -> list:
    before = json.dumps(st, sort_keys=True)
    out = api.call("GET", f"/api/season/{st['id']}/news?since_week=0")
    items = out["items"]
    assert items, "four weeks of a season made no news at all"
    check_items(st, items)
    assert json.dumps(st, sort_keys=True) == before, "reading the news changed the season"
    later = api.call("GET", f"/api/season/{st['id']}/news?since_week={WEEKS - 1}")["items"]
    assert later == [i for i in items if i["week"] == WEEKS]
    assert api.call("GET", f"/api/season/{st['id']}/news?since_week={WEEKS}")["items"] == []
    try:
        api.call("GET", f"/api/season/{st['id']}/news?since_week=x")
        raise AssertionError("expected 422")
    except api.ApiError as e:
        assert e.status == 422
    return items


def test_forced_upset(st: dict) -> None:
    """An unranked FBS team beating a top-10 team is an upset item that links its game."""
    w = WEEKS
    rank = news._ap_rank(st, w - 1)
    fbs = season.fbs_only(season.load_teams())
    g = next(g for g in st["games"].values()
             if g["week"] == w and g["played"] and g["home"] in fbs and g["away"] in fbs
             and ((rank.get(g["home"], 99) <= 10) != (rank.get(g["away"], 99) <= 10))
             and (rank.get(g["home"]) is None or rank.get(g["away"]) is None))
    fav_home = rank.get(g["home"], 99) <= 10
    cp = copy.deepcopy(st)
    cg = cp["games"][g["event_id"]]
    cg["home_score"], cg["away_score"] = (24, 27) if fav_home else (27, 24)
    news._cache.clear()
    items = news.week_news(cp, w)
    up = [i for i in items if i["kind"] == "upset" and i.get("link", {}).get("event_id") == g["event_id"]]
    assert up, items
    assert up[0]["text"].startswith("Unranked ") and " stuns No. " in up[0]["text"] and "27-24" in up[0]["text"], up[0]
    check_items(cp, items)
    news._cache.clear()


def test_top5_change(st: dict) -> None:
    """A team climbing into the top 5 (and the one it pushes out) makes rankings items."""
    w = WEEKS
    cp = copy.deepcopy(st)
    ap = cp["polls"][str(w)]["ap"]
    before = news._ap_rank(cp, w - 1)
    me = cp["team"]
    # a team outside the top 5 before and after, swapped with this week's No. 5
    five = next(e for e in ap if e["rank"] == 5)
    climber = next(e for e in ap if e["rank"] > 7 and before.get(e["team"], 99) > 5 and e["team"] != me)
    if five["team"] == me:
        return
    five["team"], climber["team"] = climber["team"], five["team"]
    news._cache.clear()
    found = news._rankings(cp, season.load_teams(), w)
    assert any(i["team"] == five["team"] and "into the top 5 at No. 5" in i["text"] for i in found), found
    if before.get(climber["team"], 99) <= 5:
        assert any(i["team"] == climber["team"] and "drops out of the top 5" in i["text"] for i in found), found
    # a new No. 1
    cp2 = copy.deepcopy(st)
    ap2 = cp2["polls"][str(w)]["ap"]
    one = next(e for e in ap2 if e["rank"] == 1)
    two = next(e for e in ap2 if e["rank"] == 2)
    if before.get(two["team"]) != 1:
        one["team"], two["team"] = two["team"], one["team"]
        found = news._rankings(cp2, season.load_teams(), w)
        assert any("takes over at No. 1" in i["text"] for i in found), found
    news._cache.clear()


def test_own_team_only_in_upsets(st: dict) -> None:
    me = st["team"]
    news._cache.clear()
    for w in range(1, WEEKS + 1):
        for i in news.week_news(st, w):
            assert i["kind"] == "upset" or i.get("team") != me, i


if __name__ == "__main__":
    import shutil
    import tempfile
    seasons_dir = _Path(tempfile.mkdtemp(prefix="cfp-news-seasons-"))
    coaches_dir = _Path(tempfile.mkdtemp(prefix="cfp-news-coaches-"))
    season.SEASONS_DIR, coaches.COACHES_DIR = seasons_dir, coaches_dir
    try:
        st = sim_career()
        items = test_endpoint(st)
        test_forced_upset(st)
        test_top5_change(st)
        test_own_team_only_in_upsets(st)
        for i in items:
            print(f"  wk {i['week']} {i['kind']:<10} {i['text']}")
    finally:
        season.close_pool()
        shutil.rmtree(seasons_dir, ignore_errors=True)
        shutil.rmtree(coaches_dir, ignore_errors=True)
    print("ok")
