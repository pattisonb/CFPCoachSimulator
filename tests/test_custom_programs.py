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
    r = api.league_programs(api.Params())
    assert len(r["teams"]) >= 130 and len(r["conferences"]) >= 10
    t = next(x for x in r["teams"] if x["slug"] == "akron")
    assert {"slug", "name", "short_name", "abbreviation", "mascot", "city", "state", "conference", "colors", "prestige"} <= set(t), t
    assert "roster" not in t, "the page needs no rosters"


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


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("custom programs ok: the programs list; a new program passes; an edit keeps its roster; errors are sentences")
