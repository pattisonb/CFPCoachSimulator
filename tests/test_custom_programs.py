"""Custom Programs (docs/superpowers/specs/2026-11-11-custom-programs-design.md): the page builds the league file the
game already imports. The server side: the programs list for the page, a builder-shaped program passes the check, an
edit of a real program keeps its roster, and the summary says when the schedule is rebuilt."""
import json
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))

from app import api
from coach_career import league_file


def doc(*teams, conferences=()):
    return json.dumps({"format": "cfp-league/1", "name": "Custom Programs", "year": 2026, "conferences": list(conferences), "teams": list(teams)}).encode()


def test_programs_list():
    """The list is names only (a slug, the names, the conference) with the conferences and the game's playbooks: quick,
    and never the whole league file. A real team's full details come one team at a time when you edit it."""
    import time
    api._PROGRAMS.clear()
    league_file.release_caches()
    t0 = time.time()
    r = api.league_programs(api.Params())
    assert time.time() - t0 < 1.0, f"the list is quick: {time.time() - t0:.1f}s"
    assert len(r["teams"]) >= 130 and len(r["conferences"]) >= 10
    t = next(x for x in r["teams"] if x["slug"] == "akron")
    assert set(t) == {"slug", "name", "short_name", "abbreviation", "conference", "level"} and t["conference"] == "mac", t
    assert "Spread RPO" in r["playbooks"]["offense"] and "4-3" in r["playbooks"]["defense"], r["playbooks"]
    d = api.league_program(api.Params(path={"slug": "akron"}))
    assert {"name", "short_name", "abbreviation", "mascot", "city", "state", "conference", "colors", "prestige", "rivals", "offense", "defense"} <= set(d), d
    assert d["conference"] == "mac" and d["colors"]["primary"]["hex"] and d["offense"] == "Spread RPO", d
    try:
        api.league_program(api.Params(path={"slug": "no-such"}))
    except api.ApiError as e:
        assert e.status == 404 if hasattr(e, "status") else True
    else:
        raise AssertionError("an unknown team is refused")


def test_new_program_passes():
    team = {"slug": "alder-tech", "name": "Alder Tech", "conference": "mountain-west",
            "roster": [{"name": "Jay Smith", "pos": "QB", "class": "JR"}, {"name": "Max Lee", "pos": "WR", "class": "SO"},
                       {"name": "Al Cruz", "pos": "LT", "class": "SR"}]}
    r = league_file.check(doc(team), seed=3)
    assert r["ok"], r.get("errors")
    assert r["summary"]["added"] == 1 and r["summary"].get("structural") is True, r["summary"]


def test_edit_keeps_roster():
    r = league_file.check(doc({"slug": "akron", "name": "Akron Rubber", "colors": {"primary": {"name": "Gold", "hex": "#C9A227"}}}), seed=3)
    assert r["ok"], r.get("errors")
    assert r["summary"]["changed"] == 1 and not r["summary"].get("structural"), r["summary"]
    roster = r["league"]["teams"]["akron"]["roster"]
    assert len(roster) >= 80, len(roster)


def test_errors_are_sentences():
    r = league_file.check(doc({"slug": "alder-tech", "name": "Alder Tech", "conference": "big-sky-e"}), seed=3)
    assert not r["ok"] and any("big-sky-e" in e and e.endswith(".") for e in r["errors"]), r["errors"]


def test_coaches_playbooks_rivals_pass():
    team = {"slug": "alder-tech", "name": "Alder Tech", "conference": "mountain-west", "rivals": ["boise-state", "air-force"],
            "coaches": {"head": {"name": "Pat Doe"}, "oc": {"name": "Sam Roe"}, "dc": {"name": "Lee Poe"}, "offense": "Spread RPO", "defense": "4-3"}}
    r = league_file.check(doc(team), seed=3)
    assert r["ok"], r.get("errors")
    t = r["league"]["teams"]["alder-tech"]
    assert t["coaches"]["head_coach"]["name"] == "Pat Doe" and t["coaches"]["offensive_coordinator"]["name"] == "Sam Roe", t["coaches"].keys()
    assert set(t["meta"].get("rivals") or []) >= {"boise-state", "air-force"}, t["meta"].get("rivals")


def test_named_rivalry():
    """A rival may carry a name: {"slug", "name"}. The career's league keeps it, and the game's rivalry lookup reads it
    for that career (the Office's game card, the schedule)."""
    from sim import season
    team = {"slug": "alder-tech", "name": "Alder Tech", "conference": "mountain-west",
            "rivals": [{"slug": "boise-state", "name": "Battle for the Bell"}, "air-force"]}
    r = league_file.check(doc(team), seed=3)
    assert r["ok"], r.get("errors")
    named = {tuple(sorted(x["teams"])): x["name"] for x in r["league"].get("rivalries") or []}
    assert named == {("alder-tech", "boise-state"): "Battle for the Bell"}, named
    assert set(r["league"]["teams"]["alder-tech"]["meta"]["rivals"]) >= {"boise-state", "air-force"}
    st = {"league": r["league"]}
    riv = season.rivalry_for("boise-state", "alder-tech", st)
    assert riv and riv["name"] == "Battle for the Bell", riv
    assert season.rivalry_for("ohio-state", "michigan", st)["name"], "the game's own rivalries still read"


def test_rivalry_name_errors():
    team = {"slug": "alder-tech", "name": "Alder Tech", "conference": "mountain-west", "rivals": [{"slug": "boise-state", "name": "x" * 61}]}
    r = league_file.check(doc(team), seed=3)
    assert not r["ok"] and any("rivalry name" in e.lower() for e in r["errors"]), r["errors"]


def test_sometimes_rivalry():
    """A rival marked every_year false is a named rivalry with no reserved week: it is not in the team's scheduled rivals,
    and the career still knows it (its name, unnamed ones read "Alder Tech vs. Boise State")."""
    from sim import season
    team = {"slug": "alder-tech", "name": "Alder Tech", "short_name": "Alder Tech", "conference": "mountain-west",
            "rivals": [{"slug": "boise-state", "name": "Battle for the Bell", "every_year": False}, {"slug": "air-force", "every_year": False}, "nevada"]}
    r = league_file.check(doc(team), seed=3)
    assert r["ok"], r.get("errors")
    assert r["league"]["teams"]["alder-tech"]["meta"]["rivals"] == ["nevada"], r["league"]["teams"]["alder-tech"]["meta"]["rivals"]
    st = {"league": r["league"]}
    assert season.rivalry_for("alder-tech", "boise-state", st)["name"] == "Battle for the Bell"
    assert season.rivalry_for("air-force", "alder-tech", st)["name"] == "Alder Tech vs. Air Force"


def test_rivalry_week():
    """A yearly rival marked rivalry_week is played in rivalry week (the schedule's finale week), every year; only one."""
    from sim import schedule_gen
    team = {"slug": "alder-tech", "name": "Alder Tech", "conference": "mountain-west",
            "rivals": [{"slug": "oregon-state", "name": "Cascade Clash", "rivalry_week": True}]}
    r = league_file.check(doc(team), seed=3)
    assert r["ok"], r.get("errors")
    games = [g for g in r["games"].values() if {g["home"], g["away"]} == {"alder-tech", "oregon-state"}]
    assert games and all(g["week"] == schedule_gen.FINALE_WEEK for g in games), [(g["week"], g["home"], g["away"]) for g in games]
    assert any(a.get("finale") and sorted(a["teams"]) == ["alder-tech", "oregon-state"] for a in r["league"]["schedule_rules"]["annual"]), "later seasons keep it"
    team["rivals"].append({"slug": "boise-state", "rivalry_week": True})
    r = league_file.check(doc(team), seed=3)
    assert not r["ok"] and any("only one rival" in e for e in r["errors"]), r["errors"]


def test_home_spot():
    """Close to Home measures from the program's spot: a set lat/lon, else its city found in the game's town list, else
    the state's center. An edited real team that changes city moves too."""
    from coach_career import league_fill
    def spot(team):
        r = league_file.check(doc(team), seed=3)
        assert r["ok"], r.get("errors")
        return r["league"]["recruiting_models"][team["slug"]]["location"]
    base = {"slug": "alder-tech", "name": "Alder Tech", "conference": "mountain-west"}
    assert spot({**base, "city": "Bend", "state": "OR"}) == [44.058, -121.315]
    assert spot({**base, "city": "Nowhere Junction", "state": "OR"}) == list(league_fill.STATE_CENTER["OR"])
    assert spot({**base, "city": "Bend", "state": "OR", "lat": 45.0, "lon": -120.0}) == [45.0, -120.0]
    assert spot({**base, "city": "el paso", "state": "TX"}) == [31.775, -106.465], "case does not matter"
    assert spot({"slug": "akron", "city": "Cleveland"}) == [41.505, -81.693], "an edit that changes city moves"


def test_custom_career_stays_listed():
    """A career at a new custom program stays in the seasons list (the player's report: it vanished after editing the
    program). Its card's record came from season._records, built on whatever league was in play, so with the card cache
    cold (a restart, or another league checked) the card failed and the career was skipped. It also opens and plays."""
    import json as _json
    doc = {"format": "cfp-league/1", "name": "t", "year": 2026, "conferences": [],
           "teams": [{"slug": "alder-tech", "name": "Alder Tech", "conference": "mountain-west", "state": "OR", "level": "FBS"}]}
    r = api.call("POST", "/api/league/check", _json.dumps(doc).encode())
    sid = api.call("POST", "/api/season", {"team": "alder-tech", "league": r["key"], "seed": 3})["id"]
    ids = lambda: [c["id"] for c in api.call("GET", "/api/seasons")["seasons"]]
    api.call("POST", "/api/season", {"team": "iowa", "seed": 4})
    doc["teams"][0]["name"] = "Alder Tech Owls"                                   # the program edited and checked again
    api.call("POST", "/api/league/check", _json.dumps(doc).encode())
    api._cards.clear()                                                             # a cold card cache (a restart)
    assert sid in ids(), "the custom career is listed"
    card = next(c for c in api.call("GET", "/api/seasons")["seasons"] if c["id"] == sid)
    assert card["team_name"] and card["wins"] == 0 and card["losses"] == 0, card
    assert api.call("GET", f"/api/season/{sid}")["team"] == "alder-tech", "and it opens"


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("custom programs ok: the programs list; a new program passes; an edit keeps its roster; errors are sentences")
