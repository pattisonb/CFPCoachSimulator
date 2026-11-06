"""Every team-reading API route in a career from a league file (the brief's Task 10): a new team, Alder
Tech, in a new conference (Big Sky East), Kent State removed and the MAC renamed "Lake Erie League". During
the season, at every offseason stage and after the next season starts, each route answers 200, shows
Alder Tech by name (with its colors and its conference where the route carries them), shows the MAC only by
its new name, and no string in it says null, undefined or NaN, names Kent State, or carries an FCS
stand-in's old name. Saves and league files go to temporary folders. Slow (a league fill, a season's weeks
and an offseason); in tests/run_all.py's SLOW."""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root
import copy
import json
import math
import re
import shutil
import tempfile

from app import api
from coach_career import league, league_file, recruiting
from sim import coaches, fcs_names, season
import test_league_career as lc
import test_offseason

ALDER_COLORS = {"primary": {"name": "Green", "hex": "#0B6E4F"}, "secondary": {"name": "White", "hex": "#FFFFFF"}}
NEW_CONF, RENAMED = "Big Sky East", "Lake Erie League"


def fixture() -> dict:
    """Task 8's league (Alder Tech in a new ten-team conference) with Kent State removed, the MAC renamed
    and Alder Tech's colors."""
    doc = copy.deepcopy(lc.ALDER_IN_NEW_TEN_TEAM_CONFERENCE)
    doc["remove"] = ["kent-state"]
    doc["conferences"].append({"id": "mac", "name": RENAMED, "games": 8})
    doc["teams"][0]["colors"] = ALDER_COLORS
    return doc


BAD_WORD = re.compile(r"\b(null|undefined|NaN|None)\b")
OLD_MAC = re.compile(r"\bMAC\b")


def strings(x, path="$"):
    """Every string (keys too) and number in a response, with where it sits."""
    if isinstance(x, dict):
        for k, v in x.items():
            yield f"{path}.{k}", k
            yield from strings(v, f"{path}.{k}")
    elif isinstance(x, list):
        for i, v in enumerate(x):
            yield from strings(v, f"{path}[{i}]")
    else:
        yield path, x


SEEN: list = []


def check(route: str, body, alder: tuple = ()) -> str:
    """The checks every response passes; `alder` names what it must carry: "name", "colors", "conference"."""
    text = json.dumps(body)
    for where, v in strings(body):
        if isinstance(v, float):
            assert math.isfinite(v), (route, where, v)
        if not isinstance(v, str):
            continue
        assert not BAD_WORD.search(v), (route, where, v)
        assert "Kent State" not in v and "kent-state" != v, (route, where, v)
        assert not OLD_MAC.search(v), (route, where, v)
    assert not fcs_names.has_old(text), route
    if "name" in alder:
        assert "Alder Tech" in text, route
    if "colors" in alder:
        assert ALDER_COLORS["primary"]["hex"] in text, route
    if "conference" in alder:
        assert NEW_CONF in text, route
    SEEN.append(route)
    return text


def get(path: str, alder: tuple = ()):
    out = lc.api_call("GET", path)
    check(path, out, alder)
    return out


def season_routes(sid: str, st: dict) -> None:
    """Every route a season's tabs read, for Alder Tech."""
    b = f"/api/season/{sid}"
    teams = get(f"{b}/teams", ("name", "colors", "conference"))["teams"]
    alder = next(t for t in teams if t["slug"] == "alder-tech")
    assert alder["conference"] == NEW_CONF and alder["colors"]["primary"] == "#0B6E4F", alder
    assert not any(t["slug"] == "kent-state" for t in teams)
    mac = {t["conference"] for t in teams if t["slug"] in ("toledo", "ohio", "miami-oh")}
    assert mac == {RENAMED}, mac
    summ = get(b, ("name", "conference"))
    assert summ["team_name"] == "Alder Tech" and summ.get("conference") == NEW_CONF, (summ["team_name"], summ.get("conference"))
    table = get(f"{b}/standings", ("name", "conference"))["standings"]
    assert NEW_CONF in table and RENAMED in table and "MAC" not in table, sorted(table)
    get(f"{b}/week/{max(1, st['current_week'])}")
    get(f"{b}/schedule/alder-tech", ("name", "conference"))
    get(f"{b}/schedule/toledo")
    get(f"{b}/stats/teams", ("name", "conference") if st["current_week"] > 1 else ())
    get(f"{b}/stats/leaders?n=5&team=alder-tech")
    get(f"{b}/stats/leaders?n=5&conference={NEW_CONF.replace(' ', '%20')}")
    lead = get(f"{b}/stats/leaders?n=5&conference={RENAMED.replace(' ', '%20')}")
    assert json.dumps(lead).count('"team"') > 0 or st["current_week"] <= 1, lead
    get(f"{b}/stats/players?cat=passing&team=alder-tech")
    get(f"{b}/depth/alder-tech", ())
    get(f"{b}/depth/alder-tech/formations")
    roster = get(f"{b}/depth/alder-tech/roster", ("name", "conference"))
    player = next(iter(roster.get("players") or roster.get("roster") or []), None)
    get(f"{b}/preview?team=alder-tech", ("name",))
    riv = get(f"{b}/rivalries?team=alder-tech", ("name",))["rivalries"]
    assert [r["opponent"] for r in riv] == ["oregon-state"], riv          # the file's listed rival
    assert any(r["opponent"] == "alder-tech" for r in get(f"{b}/rivalries?team=oregon-state", ("name",))["rivalries"])
    get(f"{b}/injuries?team=alder-tech")
    get(f"{b}/injuries")
    get(f"{b}/awards")
    get(f"{b}/news")
    get(f"{b}/settings")
    get(f"{b}/resume")
    get(f"{b}/programs", ("name",))
    get(f"{b}/office", ("conference",))
    get(f"{b}/recruiting")
    get(f"{b}/scouting")
    get(f"{b}/prospects")
    get(f"{b}/classes?school=alder-tech", ("name",))
    get(f"{b}/recruiting/report")
    rc = st["recruiting"]
    pid = min(rc["prospects"], key=lambda p: rc["prospects"][p]["rank"])
    get(f"{b}/prospect/{pid}")
    for g in st["games"].values():
        if "alder-tech" in (g["home"], g["away"]) and g.get("played") and g.get("event_id"):
            get(f"{b}/game/{g['event_id']}", ("name",))
            break
    if player:
        q = player.get("slug") or player.get("id")
        if q:
            get(f"{b}/player?team=alder-tech&slug={q}", ("name",))
    seasons = get("/api/seasons")["seasons"]
    assert any(s["id"] == sid and s["team_name"] == "Alder Tech" for s in seasons)


def edited_builtin_rivalries() -> None:
    """A league that only nudges a game team's prestige gives it a "meta" (league_fill); its rivalries, and its
    listed rivals', stay the game's: no trophyless pair is added between two of the game's teams."""
    meta = copy.deepcopy(league.base_meta("alabama"))
    meta["prestige"] = (meta.get("prestige") or 50) + 5
    plain, edited = {"games": {}}, {"games": {}, "league": {"teams": {"alabama": {"meta": meta}}}}
    for slug in ["alabama", *(meta.get("rivals") or [])]:
        assert season.rivalries_view(edited, slug) == season.rivalries_view(plain, slug), slug


def run() -> None:
    blob = league_file.dumps(fixture())
    r = lc.api_call("POST", "/api/league/check", body_bytes=blob)
    assert r["ok"], r["errors"]
    s = lc.api_call("POST", "/api/season", {"team": "alder-tech", "mode": "full", "seed": 7, "league": r["key"]})
    sid = s["id"]
    st = api._loaded
    assert st["league"]["conference_names"].get("MAC") == RENAMED
    season_routes(sid, st)                                   # week 0
    season.advance_to(st, 2)
    api._save_loaded()
    season_routes(sid, st)                                   # in season, two weeks played
    test_offseason.finished(st)
    api._save_loaded()
    b = f"/api/season/{sid}"
    stages = []
    while True:
        off = get(f"{b}/offseason", ("name",))
        stages.append(off.get("stage"))
        get(f"{b}/programs", ("name",))
        get(f"{b}/office", ("conference",))
        get(f"{b}/standings", ("name", "conference"))
        get(b, ("name",))
        if off.get("stage") == "ready":
            break
        check("advance", lc.api_call("POST", f"{b}/offseason/advance", {}), ())
    assert stages[-1] == "ready" and len(stages) >= 5, stages
    nxt = lc.api_call("POST", f"{b}/offseason/advance", {})
    check("next_season", nxt, ("name",))
    assert nxt["year"] == 2027 and api._loaded["league"]["conference_names"].get("MAC") == RENAMED
    season_routes(api._loaded["id"], api._loaded)            # 2027
    # downloaded, deleted, and loaded back with the built-in league in play: the save's own league comes back
    blob = lc.api_call("GET", f"{b}/export")
    lc.api_call("DELETE", b)
    season.use_league(season.TEAMS_FILE)
    recruiting.use_league_models({})
    back = lc.api_call("POST", "/api/season/import", body_bytes=bytes(blob))
    check("import", back, ("name",))
    assert back["team_name"] == "Alder Tech" and back["year"] == 2027, (back["team_name"], back["year"])
    season_routes(sid, api._loaded)
    print(f"league readers ok ({len(SEEN)} responses)")


if __name__ == "__main__":
    seasons_dir = _Path(tempfile.mkdtemp(prefix="cfp-readers-seasons-"))
    coaches_dir = _Path(tempfile.mkdtemp(prefix="cfp-readers-coaches-"))
    leagues_dir = _Path(tempfile.mkdtemp(prefix="cfp-readers-leagues-"))
    season.SEASONS_DIR, coaches.COACHES_DIR, league.CACHE_DIR = seasons_dir, coaches_dir, leagues_dir
    try:
        edited_builtin_rivalries()
        run()
    finally:
        season.close_pool()
        season.use_league(season.TEAMS_FILE)
        recruiting.use_league_models({})
        for d in (seasons_dir, coaches_dir, leagues_dir):
            shutil.rmtree(d, ignore_errors=True)
    print("ok")
