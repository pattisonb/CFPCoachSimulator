"""Filling a league file's rosters (coach_career/league_fill.py): a team of names lands on its target
strength, given ratings are kept exactly, empty and short rosters are filled, and the same file and
seed always give the same league."""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root
import copy
import json
import random
import statistics

from coach_career import league, league_file, league_fill, offseason
from teamdata import game_scale

ATTRS = game_scale.keys()
STR = league_fill.base_strengths()
SLUG = "alder-tech"
F = {"offense": {"QB": 1, "HB": 1, "WR": 3, "TE": 1, "LT": 1, "LG": 1, "C": 1, "RG": 1, "RT": 1},
     "defense": {"LEDG": 1, "REDG": 1, "DT": 2, "LB": 2, "CB": 3, "FS": 1, "SS": 1},
     "special_teams": {"K": 1, "P": 1, "KR": 1, "PR": 1}}
C = {}
M = {**copy.deepcopy(league.base_meta("rice")), "slug": SLUG, "short_name": "Alder Tech", "conference": "Big Sky East"}
POSITIONS_85 = (["QB"] * 4 + ["RB"] * 6 + ["WR"] * 11 + ["TE"] * 6 + ["LT", "LG", "C", "RG", "RT"] * 3
                + ["LEDG"] * 4 + ["DT"] * 7 + ["REDG"] * 4 + ["SAM", "MIKE", "WILL"] * 3 + ["CB"] * 8 + ["FS"] * 4 + ["SS"] * 4
                + ["K"] * 2 + ["P"])
CONF = {"id": "big-sky-east", "name": "Big Sky East", "level": "FBS", "games": 8, "members": [SLUG]}
MWC_SLUGS = sorted(s for s, c in league_file._builtin()["team_conf"].items() if c == "mountain-west")
MWC = {"id": "mountain-west", "name": "Mountain West", "level": "FBS", "games": 8, "members": MWC_SLUGS + [SLUG]}
MAX_LEE_74 = {"name": "Max Lee", "pos": "WR", "class": "SO", "overall": 74, "stars": 4}
AL_CRUZ_PB82_RB78 = {"name": "Al Cruz", "pos": "LT", "class": "SR", "ratings": {"pass_block": 82, "run_block": 78}}


def alder(**kw) -> dict:
    return {"slug": SLUG, "name": "Alder Tech", "short_name": "Alder Tech", "conference": "big-sky-east", "state": "OR",
            "formation": copy.deepcopy(F), **kw}


def _names(positions):
    return [{"name": f"P{i}", "pos": pos, "class": "JR"} for i, pos in enumerate(positions)]


names_only = alder(roster=_names(POSITIONS_85))
_rest = list(POSITIONS_85)
_rest.remove("WR")
_rest.remove("LT")
names_only_rest = _names(_rest)
two_qbs_only = [{"name": "Jay Smith", "pos": "QB", "class": "JR"}, {"name": "Bo Jones", "pos": "QB", "class": "SO"}]


def team_overall(roster, team) -> float:
    lgd = {"year": 2026, "attrs": ATTRS, "teams": {SLUG: {"roster": roster, "coaches": C, "formation": F, "meta": M}}}
    return league.source_team(lgd, SLUG)["team_ratings"]["overall"]


def fill(team, target, rng=None):
    return league_fill.fill_roster(team, target, rng or random.Random("league-1-alder-tech"), ATTRS, set())


def group_counts(roster) -> dict:
    out = {g: 0 for g in offseason.TARGET}
    for c in roster:
        out[offseason.GROUP[c["pos"]]] += 1
    return out


def test_names_only_lands_on_target():
    team = names_only
    for grade in ("Elite", "Average", "Weak", 63):
        tgt = league_fill.strength_target({**team, "strength": grade}, CONF, STR)
        roster, _ = league_fill.fill_roster({**team, "strength": grade}, tgt, random.Random("league-1-alder-tech"), ATTRS, set())
        assert abs(team_overall(roster, team) - tgt) <= 2, (grade, tgt, team_overall(roster, team))


def test_strength_grades():
    vals = sorted(STR.values())
    assert len(vals) == 138
    assert league_fill.strength_target({"strength": 100}, CONF, STR) == vals[-1]
    assert league_fill.strength_target({"strength": 1}, CONF, STR) > vals[0]
    assert league_fill.strength_target({}, CONF, STR) == statistics.median(vals)
    e, s, a, w = (league_fill.strength_target({"strength": g}, CONF, STR) for g in ("Elite", "Strong", "Average", "Weak"))
    assert e > s > a > w
    assert a == league_fill.strength_target({"strength": 50}, CONF, STR)


def test_no_grade_sits_in_conference_spread():
    conf = [STR[s] for s in MWC_SLUGS]
    tgt = league_fill.strength_target({**names_only, "conference": "mountain-west"}, MWC, STR)
    assert abs(tgt - statistics.mean(conf)) < 1e-9
    assert min(conf) <= team_overall(fill(names_only, tgt)[0], names_only) <= max(conf)


def test_given_ratings_kept_exactly():
    roster, _ = fill(alder(roster=[MAX_LEE_74, AL_CRUZ_PB82_RB78] + names_only_rest), 58.0)
    by = {c["n"]: c for c in roster}
    assert by["Max Lee"]["o"] == 74 and league.overall(by["Max Lee"], ATTRS) == 74
    r = dict(zip(ATTRS, by["Al Cruz"]["r"]))
    assert (r["pass_block"], r["run_block"]) == (82, 78)


def test_complete_player_kept_and_moved_to_his_overall():
    lgd = league.from_base(2027)
    c = lgd["teams"]["rice"]["roster"][0]
    doc = league_file.player_doc(c, ATTRS)
    roster, lines = fill(alder(roster=[doc] + names_only_rest), 55.0)
    assert roster[0] == c and not any("ratings were moved" in ln for ln in lines)
    off = {**doc, "name": "Max Lee", "id": None, "overall": min(99, doc["overall"] + 9)}
    roster, lines = fill(alder(roster=[off] + names_only_rest), 55.0)
    assert roster[0]["o"] == off["overall"] == league.overall(roster[0], ATTRS)
    assert f"Alder Tech: Max Lee's ratings were moved to match his overall {off['overall']}." in lines


def test_fit_overall():
    ours = {k: 50 for k in ATTRS}
    for target in (30, 50, 77):
        out = league_fill.fit_overall(ours, "QB", target, ATTRS)
        assert game_scale.overall(out, "QB") == target
    keys = ["awareness", "throw_accuracy_deep"]
    out = league_fill.fit_overall(ours, "QB", 60, keys)
    assert all(out[k] == 50 for k in ATTRS if k not in keys) and abs(out[keys[0]] - out[keys[1]]) <= 1
    assert league_fill.fit_overall(ours, "QB", game_scale.overall(ours, "QB"), ATTRS) == ours


def test_empty_roster_85_by_target():
    roster, lines = fill(alder(roster=[]), 55.0)
    assert len(roster) == 85 and group_counts(roster) == offseason.TARGET
    assert "Alder Tech: 85 players generated (the roster was empty)." in lines
    assert len({c["id"] for c in roster}) == 85 and len({c["n"] for c in roster}) == 85
    assert all(c["id"].startswith("alder-tech-") for c in roster)
    assert abs(team_overall(roster, names_only) - 55.0) <= 2


def test_short_roster_topped_to_floor():
    roster, lines = fill(alder(roster=two_qbs_only), 55.0)
    assert all(group_counts(roster)[g] >= n for g, n in offseason.FLOOR.items())
    assert [c["n"] for c in roster[:2]] == ["Jay Smith", "Bo Jones"]
    added = sum(offseason.FLOOR.values()) - 2
    assert f"Alder Tech: {added} players added to reach the position floors (1 QB, 3 RB, 6 WR, 3 TE, 10 OL, 9 DL, 5 LB, 5 CB, 4 S, 1 K, 1 P)." in lines


def test_one_short_says_player():
    roster, lines = fill(alder(roster=_names([p for p in POSITIONS_85 if p != "K"])), 55.0)
    assert "Alder Tech: 1 player added to reach the position floors (1 K)." in lines
    assert group_counts(roster)["K"] == 1


def test_ids_given_and_unique():
    taken = {"alder-tech-p1"}
    team = alder(roster=[{"name": "P1", "pos": "QB", "class": "JR"}, {"name": "Zed", "pos": "QB", "class": "JR", "id": "zed-9"}])
    roster, _ = league_fill.fill_roster(team, 50.0, random.Random(1), ATTRS, taken)
    assert roster[0]["id"] == "alder-tech-p1-2" and roster[1]["id"] == "zed-9"
    assert len({c["id"] for c in roster}) == len(roster)


def test_depth_chart_sets_slots():
    qbs = [{"name": f"Q{i}", "pos": "QB", "class": "JR"} for i in range(3)]
    team = alder(roster=qbs + names_only_rest[4:], depth_chart={"QB": ["Q2"]})
    roster, _ = fill(team, 55.0)
    by = {c["n"]: c["o"] for c in roster}
    assert by["Q2"] > by["Q0"] and by["Q2"] > by["Q1"]


def test_same_file_and_seed_same_league():
    a = fill(names_only, 55.0, rng=random.Random("league-7-alder-tech"))
    b = fill(names_only, 55.0, rng=random.Random("league-7-alder-tech"))
    assert json.dumps(a) == json.dumps(b)
    assert json.dumps(a) != json.dumps(fill(names_only, 55.0, rng=random.Random("league-8-alder-tech")))


def test_team_meta():
    assert league.team_meta(None, "rice") is league.base_meta("rice")
    lgd = {"teams": {SLUG: {"meta": M}}}
    assert league.team_meta(lgd, SLUG) is M and league.team_meta(lgd, "rice") is league.base_meta("rice")


if __name__ == "__main__":
    for _n, _f in sorted(globals().items()):
        if _n.startswith("test_"):
            _f()
    print("ok")
