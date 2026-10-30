"""The fictional FCS stand-ins (and their players) never show in a league-wide view: the
injury report, team and player stats, leaders, awards, standings, rankings, the review, the
resume, the recruiting recap, the offseason lists. A team-scoped view of a stand-in (its
depth chart, a player page, its stats, injuries, rivalries) is refused. They show only in the
box score of a game they played. (Run as a file: saves go to a temporary folder.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))

import json

from app import api
from sim import coaches
from sim import season


def refused(fn, codes=(400, 404)) -> str:
    try:
        out = fn()
    except api.ApiError as e:
        assert e.status in codes, (e.status, e.message)
        return e.message
    raise AssertionError(f"expected one of {codes}, got {str(out)[:200]}")


def _fictional() -> dict[str, dict]:
    return {s: t for s, t in season.load_teams().items() if t["fictional"]}


# a game line may point at the stand-in it played (by slug, shown as "FCS <region>")
GAME_LINE_KEYS = {"opponent", "opp", "home", "away"}


def _assert_clean(label: str, payload, fict: dict[str, dict], allow: frozenset = frozenset()) -> None:
    """No stand-in as a row of its own (a slug outside a game line), and its name and
    conference nowhere at all."""
    names = {t["name"] for t in fict.values()} | {t["conference"] for t in fict.values()}

    def walk(x, key, path):
        if isinstance(x, dict):
            for k, v in x.items():
                assert k not in fict, f"{label} keys a row by {k} at {path}"
                walk(v, k, f"{path}.{k}")
        elif isinstance(x, list):
            for i, v in enumerate(x):
                walk(v, key, f"{path}[{i}]")
        elif isinstance(x, str):
            assert not (x in fict and key not in GAME_LINE_KEYS | allow), f"{label} shows {x} at {path}"
            hit = next((n for n in names if n in x), None)
            assert hit is None, f"{label} names {hit} at {path}: {x[:120]}"
    walk(payload, None, "")


def _first_fcs_week(state: dict, fict: dict) -> tuple[int, dict]:
    games = sorted((g for g in state["games"].values() if g["home"] in fict or g["away"] in fict),
                   key=lambda g: (g["week"], g["event_id"]))
    assert games, "no game against an FCS stand-in"
    return games[0]["week"], games[0]


def test_fcs_hidden():
    fict = _fictional()
    s = api.call("POST", "/api/season", {"team": "smu", "seed": 11})
    sid = s["id"]
    week, game = _first_fcs_week(api.loaded_state(), fict)
    base = f"/api/season/{sid}"
    # before week 1: the schedule trades; an FCS date's swap picker names regions, never a stand-in
    edit = api.call("GET", f"{base}/schedule_edit")
    _assert_clean("schedule edit", edit, fict, allow=frozenset({"slug"}))   # a swap option's value, shown by its region
    fcs_options = [o for g in edit["games"] for o in g["options"] if o["slug"] in fict]
    assert fcs_options, "SMU's FCS date offers the other stand-ins"
    for o in fcs_options:
        assert not any(t["name"] in json.dumps(o) for t in fict.values()), o
    assert len({o["name"] for o in fcs_options}) == len(fcs_options), "two stand-ins share a picker name"
    api.call("POST", f"/api/season/{sid}/advance", {"to": week})
    while api.step() is not None:
        pass
    state = api.loaded_state()
    assert state["current_week"] == week
    g = state["games"][game["event_id"]]
    assert g["played"], "the FCS game was not played"
    fslug = g["home"] if g["home"] in fict else g["away"]

    # an injury on the stand-in's roster, shaped as the sim writes it
    if not state.get("injuries", {}).get(fslug):
        p = season.load_teams()[fslug]["offense"][0]
        state.setdefault("injuries", {}).setdefault(fslug, {})[f"{p['name']}|{p['position']}"] = {
            "name": p["name"], "position": p["position"], "type": "Ankle", "weeks": 3, "weeks_left": 3,
            "since_week": week, "event_id": g["event_id"]}
        api._save_loaded()
    assert state["season_stats"].get(fslug), "the stand-in kept no season stats (the views could not leak them)"

    _assert_clean("injuries", api.call("GET", f"{base}/injuries"), fict)
    _assert_clean("team stats", api.call("GET", f"{base}/stats/teams"), fict)
    for cat in season.PLAYER_CATEGORIES:
        _assert_clean(f"player stats {cat}", api.call("GET", f"{base}/stats/players?cat={cat}&limit=10000"), fict)
    _assert_clean("leaders", api.call("GET", f"{base}/stats/leaders?n=25"), fict)
    _assert_clean("awards", api.call("GET", f"{base}/awards"), fict)
    _assert_clean("standings", api.call("GET", f"{base}/standings"), fict)
    _assert_clean("resume", api.call("GET", f"{base}/resume"), fict)
    _assert_clean("review", api.call("GET", f"{base}/review"), fict)
    _assert_clean("recruiting", api.call("GET", f"{base}/recruiting"), fict)
    _assert_clean("classes", api.call("GET", f"{base}/classes"), fict)
    _assert_clean("week", api.call("GET", f"{base}/week/{week}"), fict)
    _assert_clean("schedule", api.call("GET", f"{base}/schedule/smu"), fict)

    # the team list flags them, so every picker can leave them out
    cards = {c["slug"]: c for c in api.call("GET", "/api/teams")["teams"]}
    assert all(cards[f]["fictional"] for f in fict)
    assert not any(c["fictional"] for slug, c in cards.items() if slug not in fict)

    # team-scoped views of a stand-in are refused
    pname = season.load_teams()[fslug]["offense"][0]["name"]
    refused(lambda: api.call("GET", f"{base}/player?team={fslug}&name={pname}"))
    msg = refused(lambda: api.call("GET", f"{base}/depth/{fslug}"))
    assert "FCS stand-in" in msg, msg
    refused(lambda: api.call("GET", f"{base}/depth/{fslug}/position/QB"))
    refused(lambda: api.call("GET", f"{base}/stats/players?team={fslug}&cat=passing"))
    refused(lambda: api.call("GET", f"{base}/stats/leaders?team={fslug}"))
    refused(lambda: api.call("GET", f"{base}/injuries?team={fslug}"))
    refused(lambda: api.call("GET", f"{base}/rivalries?team={fslug}"))
    refused(lambda: api.call("GET", f"{base}/resume?team={fslug}"))
    refused(lambda: api.call("GET", f"{base}/schedule/{fslug}"))
    refused(lambda: api.call("GET", f"{base}/preview?team={fslug}"))
    refused(lambda: api.call("POST", "/api/season", {"team": fslug, "seed": 1}))
    # the "around the league" count counts FBS players only
    view = api.call("GET", base)
    assert view["injury_count"] == len(api.call("GET", f"{base}/injuries")["injuries"])
    _assert_clean("season", view, fict)
    # FBS teams still answer
    assert api.call("GET", f"{base}/depth/smu")
    assert api.call("GET", f"{base}/stats/players?team=smu&cat=passing")["players"]

    # the box score of the FCS game still has both sides, the stand-in's players included
    box = api.call("GET", f"{base}/game/{g['event_id']}")
    text = json.dumps(box)
    froster = {p["name"] for p in season.load_teams()[fslug]["offense"] + season.load_teams()[fslug]["defense"]}
    assert any(n in text for n in froster), "the box score lost the stand-in's players"


if __name__ == "__main__":
    import shutil
    import tempfile
    seasons_dir = _Path(tempfile.mkdtemp(prefix="cfp-fcs-seasons-"))
    coaches_dir = _Path(tempfile.mkdtemp(prefix="cfp-fcs-coaches-"))
    season.SEASONS_DIR, coaches.COACHES_DIR = seasons_dir, coaches_dir
    try:
        test_fcs_hidden()
    finally:
        season.close_pool()
        shutil.rmtree(seasons_dir, ignore_errors=True)
        shutil.rmtree(coaches_dir, ignore_errors=True)
    print("ok")
