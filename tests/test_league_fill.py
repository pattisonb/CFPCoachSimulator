"""Filling a league file's rosters (coach_career/league_fill.py): a team of names lands on its target
strength, given ratings are kept exactly, empty and short rosters are filled, and the same file and
seed always give the same league."""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root
import copy
import json
import random
import shutil
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
TY_WEST_70_SP90 = {"name": "Ty West", "pos": "CB", "class": "JR", "overall": 70, "ratings": {"speed": 90}}


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
    roster, _ = fill(alder(roster=[MAX_LEE_74, AL_CRUZ_PB82_RB78, TY_WEST_70_SP90] + names_only_rest), 58.0)
    by = {c["n"]: c for c in roster}
    assert by["Max Lee"]["o"] == 74 and league.overall(by["Max Lee"], ATTRS) == 74
    r = dict(zip(ATTRS, by["Al Cruz"]["r"]))
    assert (r["pass_block"], r["run_block"]) == (82, 78)
    assert by["Al Cruz"]["o"] == league.overall(by["Al Cruz"], ATTRS)    # his filled skills hold his overall
    r = dict(zip(ATTRS, by["Ty West"]["r"]))
    assert r["speed"] == 90 and by["Ty West"]["o"] == 70 == league.overall(by["Ty West"], ATTRS)


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


CLASSES = ("FR", "FRRS", "SO", "SORS", "JR", "JRRS", "SR", "SRRS")
_BUILT = None


def _built_in_by_class() -> tuple[dict, dict]:
    """(class -> share of the built-in FBS players, class -> their mean room to potential per skill)."""
    global _BUILT
    if _BUILT is None:
        room = {k: [] for k in CLASSES}
        for t in league.from_base(league.FIRST_YEAR + 1)["teams"].values():
            for c in t["roster"]:
                room[c["cls"]].append(statistics.mean(c["g"]))
        n = sum(len(v) for v in room.values())
        _BUILT = ({k: len(v) / n for k, v in room.items()}, {k: statistics.mean(v) for k, v in room.items()})
    return _BUILT


_EMPTY = None


def _empty_rosters():
    global _EMPTY
    if _EMPTY is None:
        _EMPTY = [fill(alder(roster=[]), tgt, rng=random.Random(f"league-{seed}-alder-tech"))[0]
                  for seed, tgt in enumerate((52.0, 56.0, 60.0, 64.0, 68.0, 72.0), 1)]
    return _EMPTY


def test_room_by_class_matches_built_in():
    _, want = _built_in_by_class()
    got = {k: [] for k in CLASSES}
    for roster in _empty_rosters():
        for c in roster:
            got[c["cls"]].append(statistics.mean(c["g"]))
            if c["cls"] == "SRRS":
                assert not any(c["g"]), c
    for k in CLASSES:
        assert got[k] and abs(statistics.mean(got[k]) - want[k]) <= 1.5, (k, statistics.mean(got[k]), want[k])


def test_starters_mostly_upperclassmen_and_class_mix():
    share, _ = _built_in_by_class()
    starters, mix = [], {k: 0 for k in CLASSES}
    for roster in _empty_rosters():
        by_pos = {}
        for c in roster:
            by_pos.setdefault(c["pos"], []).append(c)
            mix[c["cls"]] += 1
        for pos, ps in by_pos.items():
            starters += sorted(ps, key=lambda c: -c["o"])[:league_fill._starters_at(F, pos)]
    young = sum(c["cls"] in ("FR", "FRRS") for c in starters)
    assert young <= len(starters) / 4, (young, len(starters))
    n = sum(mix.values())
    for k in CLASSES:
        assert abs(mix[k] / n - share[k]) <= 0.04, (k, mix[k] / n, share[k])


def test_team_meta():
    assert league.team_meta(None, "rice") is league.base_meta("rice")
    lgd = {"teams": {SLUG: {"meta": M}}}
    assert league.team_meta(lgd, SLUG) is M and league.team_meta(lgd, "rice") is league.base_meta("rice")


# ---- to_league: a new team's coaches, program, recruiting model and identity -------------------

ALDER_FILE = {"format": "cfp-league/1", "name": "My League", "remove": ["kent-state"],
              "conferences": [{"id": "big-sky-east", "name": "Big Sky East", "level": "FBS", "games": 0}],
              "teams": [{"slug": SLUG, "name": "Alder Tech", "short_name": "Alder Tech", "abbreviation": "ATU", "mascot": "Owls",
                         "city": "Bend", "state": "OR", "lat": 44.05, "lon": -121.31, "conference": "big-sky-east",
                         "colors": {"primary": {"name": "Green", "hex": "#0B6E4F"}, "secondary": {"name": "White", "hex": "#FFFFFF"}},
                         "strength": "Average", "prestige": 40, "rivals": ["oregon-state"],
                         "coaches": {"head": {"name": "Pat Doe", "rating": 60}, "oc": {"name": "Sam Roe"}, "offense": "Air Raid"},
                         "roster": [{"name": "Jay Smith", "pos": "QB", "class": "JR"}, {"name": "Max Lee", "pos": "WR", "class": "SO"}],
                         "depth_chart": {"QB": ["Jay Smith"]}}]}
minimal_new_team_file = {"format": "cfp-league/1",
                         "teams": [{"slug": "owl-state", "name": "Owl State", "state": "OR", "conference": "mountain-west"}]}
_TL = {}


def _to_league(name, doc, seed=1):
    if (name, seed) not in _TL:
        assert league_file.validate(doc) == [], league_file.validate(doc)
        _TL[name, seed] = league_fill.to_league(league_file.merge(doc), seed)
    return _TL[name, seed]


def test_new_team_complete():
    lgd, lines = _to_league("alder", ALDER_FILE)
    t = lgd["teams"]["alder-tech"]
    assert {"roster", "coaches", "formation", "program", "meta", "style"} <= set(t)
    assert t["coaches"]["head_coach"]["name"] == "Pat Doe" and t["coaches"]["head_coach"]["ratings"]["overall"] == 60
    assert t["coaches"]["offensive_coordinator"]["name"] == "Sam Roe" and t["coaches"]["defensive_coordinator"]["name"]
    assert t["coaches"]["head_coach"]["scheme"]["offensive_philosophy"] == "Air Raid"
    assert t["coaches"]["offensive_coordinator"]["scheme"]["offensive_scheme"] == "Air Raid"
    assert all(c["team_slug"] == "alder-tech" for c in t["coaches"].values())
    assert t["meta"]["colors"]["primary"]["hex"] == "#0B6E4F" and t["meta"]["conference"] == "Big Sky East"
    assert t["meta"]["colors"]["accent"] is None and t["meta"]["rivals"] == ["oregon-state"]
    assert t["program"]["prestige"] == 40 == t["program"]["history"] and 1 <= t["program"]["tier"] <= 5
    assert t["program"]["year"] == 2025 and t["program"]["coach"] == 60 and t["program"]["seasons"] == []
    assert t["meta"]["program"]["prestige"] == 3 and t["meta"]["program"]["generated"] is True
    assert lgd["recruiting_models"]["alder-tech"]["location"] == [44.05, -121.31]
    assert lgd["recruiting_models"]["alder-tech"]["top_states"][0][0] == "OR"
    assert lgd["source"]["name"] == "My League" and "kent-state" not in lgd["teams"]
    assert lgd["year"] == 2026
    assert lines[0] == "1 team added, 0 changed and 1 removed."
    assert any(ln.startswith("Alder Tech: ") and "added to reach the position floors" in ln for ln in lines[1:])
    ids = {c["n"]: c["id"] for c in t["roster"]}
    assert t["depth"] == {"QB": [ids["Jay Smith"]]}
    assert league.source_team(lgd, "alder-tech")["short_name"] == "Alder Tech"


def test_new_team_style_matches_offense():
    lgd, _ = _to_league("alder", ALDER_FILE)
    t = lgd["teams"]["alder-tech"]
    base = league.from_base(2026)["teams"]
    assert base[t["style"]]["coaches"]["head_coach"]["scheme"]["offensive_philosophy"] == "Air Raid"
    assert t["formation"] == base[t["style"]]["formation"]


def test_defaults_derived():
    lgd, lines = _to_league("owl", minimal_new_team_file)
    m = lgd["teams"]["owl-state"]["meta"]
    assert m["short_name"] == "Owl State" and m["abbreviation"] == "OS" and m["mascot"] == "State"
    assert m["colors"]["accent"] is None and m["colors"] == league_fill.NEUTRAL_COLORS
    assert m["rivals"] == [] and isinstance(m["program"]["home_field_advantage"], int) and m["conference"] == "Mountain West" and m["stadium"]["name"] == "Owl State Stadium"
    assert lgd["recruiting_models"]["owl-state"]["location"] == list(league_fill.STATE_CENTER["OR"])
    mwc = [s for s, c in league_file._builtin()["team_conf"].items() if c == "mountain-west"]
    base = league.from_base(2026)["teams"]
    want = statistics.mean(base[s]["program"]["prestige"] for s in mwc)
    assert abs(lgd["teams"]["owl-state"]["program"]["prestige"] - want) < 1e-6
    heads = [base[s]["coaches"]["head_coach"]["scheme"]["offensive_philosophy"] for s in mwc]
    common = max(sorted(set(heads)), key=heads.count)
    c = lgd["teams"]["owl-state"]["coaches"]
    assert set(c) == {"head_coach", "offensive_coordinator", "defensive_coordinator"}
    assert c["head_coach"]["scheme"]["offensive_philosophy"] == common
    assert len(lgd["teams"]["owl-state"]["roster"]) == 85
    assert lines[0] == "1 team added, 0 changed and 0 removed."
    assert "source" in lgd and lgd["source"]["format"] == "cfp-league/1"


def test_state_center():
    lat, lon = league_fill.STATE_CENTER["OR"]
    assert 42 < lat < 46.5 and -124.6 < lon < -116.5


def test_to_league_deterministic():
    doc = copy.deepcopy(ALDER_FILE)
    a = league_fill.to_league(league_file.merge(doc), 3)
    b = league_fill.to_league(league_file.merge(doc), 3)
    assert json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)
    c = league_fill.to_league(league_file.merge(doc), 4)
    assert json.dumps(a[0]["teams"]["alder-tech"], sort_keys=True) != json.dumps(c[0]["teams"]["alder-tech"], sort_keys=True)


def test_player_ids_unique_across_league():
    doc = copy.deepcopy(ALDER_FILE)
    doc["teams"][0]["roster"] = [{"name": "P0", "pos": "QB", "class": "JR"}]
    doc["teams"][0].pop("depth_chart")
    # a second new team claims the id the first one would generate for its P0
    doc["teams"].append({"slug": "zeta-u", "name": "Zeta U", "state": "WA", "conference": "big-sky-east",
                         "roster": [{"name": "Zed", "pos": "QB", "class": "JR", "id": "alder-tech-p0"}]})
    assert league_file.validate(doc) == []
    lgd, _ = league_fill.to_league(league_file.merge(doc), 1)
    ids = [c["id"] for t in lgd["teams"].values() for c in t["roster"]]
    assert len(ids) == len(set(ids))
    assert {c["n"]: c["id"] for c in lgd["teams"]["zeta-u"]["roster"]}["Zed"] == "alder-tech-p0"
    assert {c["n"]: c["id"] for c in lgd["teams"]["alder-tech"]["roster"]}["P0"] != "alder-tech-p0"


def test_changed_builtin_team():
    doc = {"format": "cfp-league/1", "name": "Rice Edit",
           "teams": [{"slug": "rice", "prestige": 70, "colors": {"primary": {"name": "Red", "hex": "#AA0000"},
                                                                  "secondary": {"name": "White", "hex": "#FFFFFF"}}}]}
    lgd, lines = league_fill.to_league(league_file.merge(doc), 1)
    base = league.from_base(2026)["teams"]
    t = lgd["teams"]["rice"]
    assert lines[0] == "0 teams added, 1 changed and 0 removed."
    assert t["program"]["prestige"] == 70 == t["program"]["history"]
    assert t["meta"]["colors"]["primary"]["hex"] == "#AA0000" and t["meta"]["colors"]["accent"] is None
    assert t["meta"]["short_name"] == "Rice" and t["meta"]["rivals"] == league.base_meta("rice")["rivals"]
    assert t["roster"] == base["rice"]["roster"] and t["coaches"] == base["rice"]["coaches"]
    assert "rice" not in lgd.get("recruiting_models", {})
    assert lgd["teams"]["smu"] == base["smu"]


def test_moved_builtin_team_gets_a_recruiting_model():
    doc = {"format": "cfp-league/1", "teams": [{"slug": "rice", "state": "OR"}, {"slug": "smu", "lat": 40.0, "lon": -100.0}]}
    lgd, _ = league_fill.to_league(league_file.merge(doc), 1)
    rm = lgd["recruiting_models"]
    assert rm["rice"]["location"] == list(league_fill.STATE_CENTER["OR"]) and rm["rice"]["top_states"][0][0] == "OR"
    assert rm["smu"]["location"] == [40.0, -100.0] and lgd["teams"]["rice"]["meta"]["state"] == "OR"


def _rice_with(coaches):
    doc = {"format": "cfp-league/1", "teams": [{"slug": "rice", "coaches": coaches}]}
    assert league_file.validate(doc) == []
    merged = league_file.merge(doc)
    return merged, league_fill.to_league(merged, 1)[0]


def test_offense_word_keeps_builtin_staff():
    base = league.from_base(2026)["teams"]["rice"]["coaches"]
    merged, lgd = _rice_with({"offense": "Air Raid"})
    c = lgd["teams"]["rice"]["coaches"]
    assert merged["changed"] == ["rice"]
    for role in ("head_coach", "offensive_coordinator", "defensive_coordinator"):
        assert c[role]["name"] == base[role]["name"] and c[role]["ratings"] == base[role]["ratings"]
        assert c[role]["tendencies"] == base[role]["tendencies"]
    assert c["defensive_coordinator"] == base["defensive_coordinator"]
    assert c["head_coach"]["scheme"] == {**base["head_coach"]["scheme"], "offensive_philosophy": "Air Raid"}
    assert c["offensive_coordinator"]["scheme"] == {**base["offensive_coordinator"]["scheme"], "offensive_scheme": "Air Raid"}
    assert {k: v for k, v in c["head_coach"].items() if k != "scheme"} == {k: v for k, v in base["head_coach"].items() if k != "scheme"}


def test_head_name_renames_builtin_coach():
    base = league.from_base(2026)["teams"]["rice"]["coaches"]
    _, lgd = _rice_with({"head": {"name": "Joe Q"}})
    c = lgd["teams"]["rice"]["coaches"]
    assert c["head_coach"] == {**base["head_coach"], "name": "Joe Q"}
    assert c["offensive_coordinator"] == base["offensive_coordinator"] and c["defensive_coordinator"] == base["defensive_coordinator"]


def test_head_rating_sets_builtin_coach():
    lg0 = league.from_base(2026)["teams"]["rice"]
    base = lg0["coaches"]
    _, lgd = _rice_with({"head": {"rating": 80}})
    t = lgd["teams"]["rice"]
    hc = t["coaches"]["head_coach"]
    assert hc["name"] == base["head_coach"]["name"] and hc["ratings"]["overall"] == 80 and "rating" not in hc
    shift = 80 - base["head_coach"]["ratings"]["overall"]
    assert all(hc["ratings"][k] == max(1, min(99, v + shift)) for k, v in base["head_coach"]["ratings"].items() if k != "overall")
    assert t["coaches"]["offensive_coordinator"] == base["offensive_coordinator"]
    assert t["coaches"]["defensive_coordinator"] == base["defensive_coordinator"]
    assert t["program"]["coach"] == 80 and t["program"]["rating"] > lg0["program"]["rating"]


def test_unchanged_coaches_collapse_to_builtin():
    doc = {"format": "cfp-league/1", "teams": [{"slug": "rice", "coaches": copy.deepcopy(league_file._builtin_docs()["rice"]["coaches"])}]}
    assert league_file.merge(doc)["builtin"] is True


def test_prestige_edit_sets_meta_stars():
    doc = {"format": "cfp-league/1", "teams": [{"slug": "rice", "prestige": 90}]}
    lgd, _ = league_fill.to_league(league_file.merge(doc), 1)
    m = lgd["teams"]["rice"]["meta"]
    assert m["program"]["prestige"] == 1 + round(5 * 90 / 100) and m["short_name"] == "Rice"


def test_generated_coach_names_never_clash():
    doc = copy.deepcopy(ALDER_FILE)
    doc["teams"][0]["coaches"] = {}
    doc["teams"].append({"slug": "zeta-u", "name": "Zeta U", "state": "WA", "conference": "big-sky-east", "roster": []})
    lgd, _ = league_fill.to_league(league_file.merge(doc), 1)
    new = [c["name"].lower() for s in ("alder-tech", "zeta-u") for c in lgd["teams"][s]["coaches"].values()]
    others = {c["name"].lower() for s, t in lgd["teams"].items() if s not in ("alder-tech", "zeta-u")
              for c in t["coaches"].values() if c and c.get("name")}
    assert len(new) == 6 == len(set(new)) and not set(new) & others
    base, team = league.from_base(2026), {"slug": "x"}
    first = league_fill.coaches_for(team, {"members": []}, base, random.Random(5), set())
    taken = {c["name"].lower() for c in first.values()}
    again = league_fill.coaches_for(team, {"members": []}, base, random.Random(5), set(taken))   # the same draws, those names taken
    assert not {c["name"].lower() for c in again.values()} & taken


def test_league_seed():
    assert league_fill.league_seed(b"abc", 7) == 7
    s = league_fill.league_seed(b"abc", None)
    assert isinstance(s, int) and s == league_fill.league_seed(b"abc", None) != league_fill.league_seed(b"abd", None)


# ---- the career league from season one ---------------------------------------------------------

def test_imported_league_builds_from_season_one():
    lgd, _ = league_fill.to_league(league_file.merge(ALDER_FILE), 1)
    st = {"id": "lf-test", "league": lgd, "year": 2026, "team": "alder-tech"}
    try:
        p = league.ensure_built(st)
        teams = json.loads(p.read_text())["teams"]
        assert "alder-tech" in teams and "kent-state" not in teams
        assert teams["alder-tech"]["name"] == "Alder Tech" and teams["alder-tech"]["conference"] == "Big Sky East"
        assert any(t["fictional"] for t in teams.values())                     # the stand-ins are still there as fill
        assert teams["alder-tech"]["offense"][0]["slug"].startswith("alder-tech-")
    finally:
        league.forget("lf-test")
    assert league.ensure_built({"id": "x", "league": league.from_base(2027), "year": 2026}) is None   # built-in: unchanged


def test_league_slugs_and_is_imported():
    base = league.from_base(2027)
    assert league.league_slugs(base) == league.base_slugs()
    assert not league.is_imported(base) and not league.is_imported(None) and not league.is_imported({})
    lgd, _ = _to_league("alder", ALDER_FILE)
    slugs = league.league_slugs(lgd)
    assert league.is_imported(lgd) and "alder-tech" in slugs and "kent-state" not in slugs
    assert all(s in slugs for s in league.base_slugs() if league.base_meta(s)["fictional"])
    assert list(slugs) == sorted(slugs)


def _rice_roster():
    lgd = league.from_base(2026)
    e = lgd["teams"]["rice"]
    return [league.expand(c, lgd["attrs"], league.base_meta("rice")) for c in e["roster"]], e["formation"]


def test_depth_chart_preferred():
    roster, shape = _rice_roster()
    starters, depth = league.lineup(roster, shape, 2026)
    assert league.lineup(roster, shape, 2026, preferred=None) == (starters, depth)
    backup_slug = depth["QB"][1]
    s2, d2 = league.lineup(roster, shape, 2026, preferred={"QB": [backup_slug]})
    assert d2["QB"][0] == backup_slug and s2["offense"]["QB"] == [backup_slug]
    assert sorted(d2["QB"]) == sorted(depth["QB"]) and d2["QB"][1:] == [s for s in depth["QB"] if s != backup_slug]
    assert d2["WR"] == depth["WR"]                                              # other roles as before
    two = depth["QB"][2], depth["QB"][1]
    assert league.lineup(roster, shape, 2026, preferred={"QB": list(two)})[1]["QB"][:2] == list(two)   # in the given order
    assert league.lineup(roster, shape, 2026, preferred={"QB": ["nobody"]})[1]["QB"] == depth["QB"]  # unknown names ignored


def test_source_team_uses_file_depth():
    lgd, _ = _to_league("alder", ALDER_FILE)
    jay = next(c["id"] for c in lgd["teams"]["alder-tech"]["roster"] if c["n"] == "Jay Smith")
    assert lgd["teams"]["alder-tech"]["depth"]["QB"] == [jay]
    t = league.source_team(lgd, "alder-tech")
    assert t["depth_chart"]["QB"][0] == jay and t["starters"]["offense"]["QB"] == [jay]


def test_offseason_drops_file_depth():
    from sim import season
    lgd, _ = league_fill.to_league(league_file.merge(ALDER_FILE), 1)
    assert lgd["teams"][SLUG].get("depth")
    st = {"id": "lf-off", "league": lgd, "year": 2026, "team": SLUG}
    try:
        season.activate(st)
        st = {**season.new_season(SLUG, "full", seed=2, career=True), "id": "lf-off", "league": lgd}
        teams = season.load_teams()
        for g in st["games"].values():
            g.update(played=True, home_score=24, away_score=17)
        rc = st["recruiting"]
        schools = [s for s, t in teams.items() if not t["fictional"]]
        for i, pid in enumerate(sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"])[:len(schools) * 21]):
            rc["status"][pid]["signed"] = schools[i % len(schools)]
        st.update(done=True, current_week=season.FINAL_WEEK, champion="ohio-state")
        off = offseason.start(st)
        assert not any("depth" in t for t in st["league"]["teams"].values())        # the file's depth chart: season one only
        assert st["league"]["year"] == 2027 and SLUG in st["league"]["teams"] and league.is_imported(st["league"])
        mine = [d for d in off["departures"] if d.get("team") == SLUG]
        assert all(d.get("team_name") == "Alder Tech" for d in mine)
    finally:
        season.use_league(None)
        from coach_career import recruiting
        recruiting.use_league_models({})
        league.forget("lf-off")
        shutil.rmtree(season.box_dir({"id": "lf-off"}).parent, ignore_errors=True)


def test_recruiting_league_models():
    from coach_career import recruiting
    lgd, _ = _to_league("alder", ALDER_FILE)
    models = lgd["recruiting_models"]
    assert set(recruiting.model()["teams"]["rice"]) <= set(models["alder-tech"])   # every key a built-in model has
    assert models["alder-tech"]["signees"] == 0 and 0 < models["alder-tech"]["avg_rating"] < 1
    try:
        recruiting.use_league_models(models)
        assert recruiting._team_model("alder-tech") is models["alder-tech"]
        assert recruiting._team_model("ohio-state") is recruiting.model()["teams"]["ohio-state"]
        recruiting._STATIC["x"] = 1
        recruiting.use_league_models(models)                                  # the same models: the caches stay
        assert recruiting._STATIC.get("x") == 1
        recruiting.reset_caches()
        assert recruiting._team_model("alder-tech") is models["alder-tech"]  # reset_caches keeps the league's models
        recruiting._STATIC["x"] = 1
        recruiting.use_league_models({})
        assert "x" not in recruiting._STATIC and recruiting._team_model("alder-tech") == {}
    finally:
        recruiting.use_league_models({})


def test_new_team_through_a_recruiting_week():
    from coach_career import career, recruiting
    from sim import season
    lgd, _ = league_fill.to_league(league_file.merge(ALDER_FILE), 1)
    st = {"id": "lf-rec", "league": lgd, "year": 2026, "team": SLUG}
    try:
        season.activate(st)
        assert recruiting._team_model(SLUG) and SLUG in season.load_teams() and "kent-state" not in season.load_teams()
        st = {**season.new_season(SLUG, "full", seed=3, career=True), "id": "lf-rec", "league": lgd}
        season.activate(st)
        assert SLUG in recruiting.fbs_schools(st)
        st["career"]["settings"]["auto_recruit"] = True
        recruiting.weekly_step(st, 1, auto_user=True)
        rc = st["recruiting"]
        pid = next(iter(rc["prospects"]))
        assert recruiting.interest(st, SLUG, pid) >= 0 and recruiting.open_spots(st, SLUG) > 0
        assert rc["offers"].get(SLUG) and rc["lists"] and recruiting.weekly_hours(st, SLUG) > 0   # the new team recruits like the rest
    finally:
        season.use_league(None)
        recruiting.use_league_models({})
        league.forget("lf-rec")
        shutil.rmtree(season.box_dir({"id": "lf-rec"}).parent, ignore_errors=True)


if __name__ == "__main__":
    for _n, _f in sorted(globals().items()):
        if _n.startswith("test_"):
            _f()
    print("ok")
