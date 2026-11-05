"""The built-in league as a file (coach_career/league_file.py): the export reads back into exactly
the league from_base builds, is byte-stable, and never mentions the FCS stand-ins."""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root
import json

from coach_career import league, league_file
from teamdata import game_scale


def test_export_round_trips_to_from_base():
    doc = league_file.export_document()
    attrs = game_scale.keys()
    base = league.from_base(2027)
    rebuilt = {d["slug"]: league_file.to_league_team(d, attrs) for d in doc["teams"]}
    for slug, entry in base["teams"].items():
        want = {k: entry[k] for k in ("roster", "coaches", "formation")}
        got = {k: rebuilt[slug][k] for k in ("roster", "coaches", "formation")}
        assert json.dumps(got, sort_keys=True) == json.dumps(want, sort_keys=True), slug
    assert set(rebuilt) == set(base["teams"])


def test_export_is_byte_stable_and_fcs_free():
    a = league_file.dumps(league_file.export_document())
    assert a == league_file.dumps(json.loads(a)) == league_file.builtin_bytes()
    fictional = [league.base_meta(s) for s in league.base_slugs() if league.base_meta(s)["fictional"]]
    assert fictional
    text = a.decode("utf-8")
    for m in fictional:
        assert f'"{m["slug"]}"' not in text and m["short_name"] not in text
        assert m["conference"] not in text
    assert json.loads(a)["format"] == "cfp-league/1"


def test_shape_and_conferences():
    doc = league_file.export_document()
    assert doc["name"] == "Built-in League" and doc["year"] == 2026
    assert league_file.conference_id("American Athletic Conference") == "american-athletic-conference"
    ids = {c["id"]: c for c in doc["conferences"]}
    assert ids["sec"]["games"] == 9 and ids["fbs-independent"]["games"] == 0
    assert all(t["conference"] in ids for t in doc["teams"])
    smu = next(t for t in doc["teams"] if t["slug"] == "smu")
    assert smu["name"] == "Southern Methodist University" and "lat" in smu and "style" not in smu
    assert set(smu["coaches"]) == {"head", "oc", "dc", "offense", "defense"}
    p = smu["roster"][0]
    assert len(p["ratings"]) == 54 and p["hometown"] == "TX"
    assert all(q["pos"] != "HB" for t in doc["teams"] for q in t["roster"])


# ---- parse and validate ---------------------------------------------------------------------------

import copy

JAY = {"name": "Jay Smith", "pos": "QB", "class": "JR"}
MAX_ = {"name": "Max Lee", "pos": "WR", "class": "SO"}
ALDER = {"slug": "alder-tech", "name": "Alder Tech", "short_name": "Alder Tech", "abbreviation": "ATU", "mascot": "Owls",
         "city": "Bend", "state": "OR", "lat": 44.05, "lon": -121.31, "conference": "big-sky-east", "level": "FBS",
         "colors": {"primary": {"name": "Green", "hex": "#0B6E4F"}}, "strength": "Average", "prestige": 40,
         "rivals": ["oregon-state"], "roster": [dict(JAY), dict(MAX_)], "depth_chart": {"QB": ["Jay Smith"]}}


def member(i):
    return {"slug": f"bse-{i}", "name": f"Big Sky {i}", "conference": "big-sky-east"}


def base_file(**over):
    """A valid one-team file: Alder Tech plus nine more members of Big Sky East (8 games)."""
    doc = {"format": "cfp-league/1", "conferences": [{"id": "big-sky-east", "name": "Big Sky East", "level": "FBS", "games": 8}],
           "teams": [copy.deepcopy(ALDER)] + [member(i) for i in range(9)]}
    doc.update(over)
    return doc


def errs(**team_over):
    doc = base_file()
    roster = team_over.pop("roster", None)
    if roster is not None:
        doc["teams"][0]["roster"] = roster
    if "pos" in team_over:
        doc["teams"][0]["roster"][0]["pos"] = team_over.pop("pos")
    doc["teams"][0].update(team_over)
    return league_file.validate(doc)


def raises(fn, text):
    try:
        fn()
    except league_file.LeagueFileError as e:
        assert any(text in m for m in e.errors), e.errors
        return
    raise AssertionError("no LeagueFileError")


def test_valid_base_file():
    assert league_file.validate(base_file()) == []


def test_bad_position():
    assert "Alder Tech, player 1 (Jay Smith): position 'WRR' is not a position." in errs(pos="WRR")


def test_unknown_conference():
    assert "Alder Tech: conference 'big-sky-e' is not in the file or the game." in errs(conference="big-sky-e")


def test_duplicate_slug():
    doc = base_file()
    doc["teams"].append(copy.deepcopy(ALDER))
    assert any("is used by two teams" in e for e in league_file.validate(doc))


def test_bad_json():
    raises(lambda: league_file.parse(b'{"format": "cfp-league/1",'), "The file is not valid JSON")
    raises(lambda: league_file.parse(b'{"format": "cfp-league/1", "year": NaN}'), "The file is not valid JSON")
    raises(lambda: league_file.parse(b"\xff\xfe"), "not UTF-8")
    raises(lambda: league_file.parse(b"[1]"), "top level must be an object")


def test_wrong_format():
    raises(lambda: league_file.parse(b'{"format": "cfp-league/2"}'), "The file's format is 'cfp-league/2'; this game reads 'cfp-league/1'.")


def test_depth_chart_unknown_player():
    assert "Alder Tech: the depth chart's QB list names Jay Smyth, who is not on the roster." in errs(depth_chart={"QB": ["Jay Smyth"]})
    # a team that keeps its built-in roster is checked against that roster
    out = league_file.validate({"format": "cfp-league/1", "teams": [{"slug": "kent-state", "depth_chart": {"QB": ["Nobody Here"]}}]})
    assert "Kent State: the depth chart's QB list names Nobody Here, who is not on the roster." in out


def test_duplicate_player_names():
    assert "Alder Tech: players 1 and 3 are both named Jay Smith; give each a different name." in errs(roster=[JAY, MAX_, dict(JAY, name="jay smith")], depth_chart=None)


def test_remove_and_list():
    f = {"format": "cfp-league/1", "remove": ["kent-state"], "teams": [{"slug": "kent-state"}]}
    assert "Kent State: the file removes it and also lists it; do one or the other." in league_file.validate(f)


def test_conference_too_small():
    doc = base_file()
    doc["teams"] = doc["teams"][:3]
    assert "Big Sky East: 3 teams can't play 8 conference games each; it needs at least 9." in league_file.validate(doc)
    mwc = [s for s in league.base_slugs() if not league.base_meta(s)["fictional"] and league.base_meta(s)["conference"] == "Mountain West"]
    f = {"format": "cfp-league/1", "remove": mwc[:5]}
    assert any("Mountain West: " in e and "it needs at least" in e for e in league_file.validate(f))


def test_size_and_width():
    raises(lambda: league_file.parse(b" " * (league_file.MAX_LEAGUE_BYTES + 1)), "The file is 64.0 MB; the game reads league files up to 64 MB.")
    doc = {"format": "cfp-league/1", "teams": [{"slug": f"new-{i}", "name": f"New {i}", "conference": "sec"} for i in range(300)]}
    assert any("FBS teams" in e and "256" in e for e in league_file.validate(doc))
    assert league_file.validate(league_file.parse(league_file.builtin_bytes())) == []


def test_fcs_never_named():
    fcs = next(s for s in league.base_slugs() if league.base_meta(s)["fictional"])
    m = league.base_meta(fcs)
    out = " ".join(league_file.validate({"format": "cfp-league/1", "remove": [fcs], "teams": [{"slug": fcs, "name": "X", "conference": m["conference"]},
                   {"slug": "zed", "name": "Zed", "conference": m["conference"], "rivals": [fcs]}],
                   "conferences": [{"id": "x", "name": m["conference"]}]}))
    assert "reserved for the game's FCS opponents" in out
    for word in (fcs, m["short_name"], m["conference"], m["school_name"]):
        assert word not in out, word


def test_errors_capped():
    doc = base_file()
    doc["teams"][0]["roster"] = [{"name": f"P {i}", "pos": "WRR", "class": "FR"} for i in range(80)]
    doc["teams"][0].pop("depth_chart")
    e = league_file.validate(doc)
    assert len(e) == league_file.MAX_ERRORS + 1 and e[-1] == "And 30 more."


def test_bad_rating_values():
    for bad in ("high", 120, 0, 75.5, None.__class__.__name__, True):
        out = errs(roster=[dict(JAY, ratings={"speed": bad}), MAX_], depth_chart=None)
        assert any(e.startswith("Alder Tech, player 1 (Jay Smith): rating 'speed'") for e in out), (bad, out)
    out = errs(roster=[dict(JAY, ratings={"nonsense": 50}, potential={"speed": 100}, overall=0), MAX_], depth_chart=None)
    assert any("rating 'nonsense' is not a skill" in e for e in out)
    assert any("potential 'speed' must be a whole number" in e for e in out)
    assert any("overall must be" in e for e in out)
    assert errs(roster=[dict(JAY, ratings={"speed": 80}), MAX_], depth_chart=None) == []   # missing skills are legal


def test_other_rules():
    assert any("level 'FCS' is not supported; FCS games use the game's own opponents." in e for e in errs(level="FCS"))
    assert "The file's year is 2027; careers start in 2026, so use 2026 or leave it out." in league_file.validate(base_file(year=2027))
    assert any("strength must be" in e for e in errs(strength="Huge"))
    assert errs(strength=55) == []
    assert any("hex" in e for e in errs(colors={"primary": {"hex": "green"}}))
    assert any("lat must be" in e for e in errs(lat=91))
    assert any("state must be" in e for e in errs(state="ZZ"))
    assert any("rival 'nowhere' is not a team" in e for e in errs(rivals=["nowhere"]))
    assert any("remove" in e and "not a team in the game" in e for e in league_file.validate(base_file(remove=["nowhere"])))
    assert any("reserved" in e for e in league_file.validate(base_file(conferences=[{"id": "x", "name": "Eight Rivers Football Conference"}])))
    assert any("games must be" in e for e in league_file.validate(base_file(conferences=[{"id": "big-sky-east", "name": "B", "games": 12}])))
    assert any("limit is 85" in e for e in errs(roster=[dict(JAY, name=f"P{i}") for i in range(86)], depth_chart=None))
    assert any("stars must be" in e for e in errs(roster=[dict(JAY, stars=6)], depth_chart=None))
    assert any("height must be" in e for e in errs(roster=[dict(JAY, height=20)], depth_chart=None))
    assert any("weight must be" in e for e in errs(roster=[dict(JAY, weight=999)], depth_chart=None))
    assert any("id 'kevin-jennings' is already used" in e for e in errs(roster=[dict(JAY, id="kevin-jennings")], depth_chart=None))
    assert any("slug 'Bad Slug' must be" in e for e in league_file.validate({"format": "cfp-league/1", "teams": [{"slug": "Bad Slug"}]}))


def test_huge_integers_give_sentences():
    big = int("9" * 400)
    out = errs(roster=[dict(JAY, ratings={"speed": big}, potential={"speed": big}, overall=big, stars=big), MAX_], depth_chart=None)
    for part in ("rating 'speed' must be", "potential 'speed' must be", "overall must be", "stars must be"):
        assert any(part in e for e in out), (part, out)
    out = league_file.validate(base_file(conferences=[{"id": "big-sky-east", "name": "Big Sky East", "games": big}]))
    assert any("games must be" in e for e in out), out
    assert all(e[0].isupper() and e.endswith(".") for e in out)


def test_every_error_is_a_sentence():
    fcs = next(s for s in league.base_slugs() if league.base_meta(s)["fictional"])
    docs = [base_file(year=2027, remove=["nowhere", fcs]),
            base_file(conferences=[{"id": "x", "name": "Eight Rivers Football Conference"}, {"id": "q"}, 5]),
            {"format": "cfp-league/1", "teams": [{"slug": "Bad Slug"}, 7, {"name": "No Slug"}, {"slug": "kent-state", "remove": 1, "level": "FCS",
             "conference": 5, "strength": [], "roster": [3, {"pos": 5, "class": "X", "ratings": {"speed": float("nan")}}], "depth_chart": {"ZZ": 4}}]}]
    docs.append(base_file())
    docs[-1]["teams"][0]["roster"] = [dict(JAY, pos="WRR", ratings={"speed": 500, "foo": 1}, stars=9), dict(MAX_, **{"class": "ZZ"})]
    out = [e for d in docs for e in league_file.validate(d)]
    assert out and all(e[0].isupper() and e.endswith(".") for e in out), [e for e in out if not (e[0].isupper() and e.endswith("."))]
    assert not any(w in e for e in out for w in ("None", "null", "undefined", "NaN"))



# ---- merge ----------------------------------------------------------------------------------------

def test_unchanged_export_collapses():
    m = league_file.merge(league_file.parse(league_file.builtin_bytes()))
    assert m["builtin"] and not (m["added"] or m["changed"] or m["removed"] or m["structural"])


def test_one_team_file():
    m = league_file.merge({"format": "cfp-league/1", "teams": [{"slug": "rice", "prestige": 55}]})
    assert m["changed"] == ["rice"] and not m["structural"] and len(m["teams"]) == 138 and not m["builtin"]
    assert m["teams"]["rice"]["roster"] == league_file.team_doc(league.from_base(2027), "rice")["roster"]
    assert m["name"] == "Imported League"


def test_add_and_remove_are_structural():
    doc = base_file(remove=["kent-state"])
    m = league_file.merge(doc)
    assert m["added"] == sorted(["alder-tech"] + [f"bse-{i}" for i in range(9)])
    assert m["removed"] == ["kent-state"] and m["structural"]
    assert "kent-state" not in m["teams"] and "alder-tech" in m["conferences"]["big-sky-east"]["members"]
    assert m["conferences"]["big-sky-east"]["games"] == 8


if __name__ == "__main__":
    test_export_round_trips_to_from_base()
    test_export_is_byte_stable_and_fcs_free()
    test_shape_and_conferences()
    print("ok")

    for _n, _f in sorted(globals().items()):
        if _n.startswith("test_") and _n not in ("test_export_round_trips_to_from_base", "test_export_is_byte_stable_and_fcs_free", "test_shape_and_conferences"):
            _f()
