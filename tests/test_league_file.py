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


if __name__ == "__main__":
    test_export_round_trips_to_from_base()
    test_export_is_byte_stable_and_fcs_free()
    test_shape_and_conferences()
    print("ok")
