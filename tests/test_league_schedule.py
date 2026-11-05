"""Schedules for a merged league (sim/schedule_gen.py with rules_override, league_file.schedule_rules
and divisions): a new conference plays its own slate, listed rivals meet, divisions take added teams,
removed teams leave the rules, and the built-in generation is exactly what it was."""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root
import copy
import hashlib
import json
import random
from collections import Counter

from coach_career import league, league_file, league_fill
from sim import schedule_gen, season

BIG_SKY_EAST = ["alder-tech", "basalt-state", "cascade-tech", "deschutes", "elk-river", "fir-valley",
                "glacier-state", "high-desert", "ironwood", "juniper-state"]
_STATES = ["OR", "OR", "WA", "OR", "ID", "WA", "MT", "OR", "WA", "ID"]


def _new_team(slug: str, state: str, conference: str, **kw) -> dict:
    name = " ".join(w.capitalize() for w in slug.split("-"))
    return {"slug": slug, "name": name, "state": state, "conference": conference, **kw}


TEN_TEAM_BIG_SKY_EAST = {
    "format": "cfp-league/1", "name": "Big Sky East League",
    "conferences": [{"id": "big-sky-east", "name": "Big Sky East", "level": "FBS", "games": 8}],
    "teams": [_new_team(s, st, "big-sky-east", **({"rivals": ["oregon-state"]} if s == "alder-tech" else {}))
              for s, st in zip(BIG_SKY_EAST, _STATES)]}
file_adding_one_sun_belt_team = {"format": "cfp-league/1", "teams": [_new_team("gulf-coast-tech", "AL", "sun-belt")]}
ONE_TEAM_NO_GAMES = {"format": "cfp-league/1", "remove": ["kent-state"],
                     "conferences": [{"id": "big-sky-east", "name": "Big Sky East", "level": "FBS", "games": 0}],
                     "teams": [_new_team("alder-tech", "OR", "big-sky-east", rivals=["oregon-state"])]}

# the generator's output for the built-in league before rules_override existed (seed 5, 2027 then 2028)
BUILTIN_DIGESTS = {2027: "50b97395eaf19317120b8ba0dfdaa12a4940c87df3be27383323e991523b88e1",
                   2028: "fff172fe1395a07e0fbdb4883c71f1768429edba4fc9b21a68a262b702f1d68a"}


def built_teams(lgd: dict) -> dict:
    return league.build(lgd)["teams"]


def quick_teams(merged: dict) -> dict:
    """The engine's teams for a merged league without filling rosters: the built-in teams less the
    removed ones, plus each added team with what the generator reads."""
    base = season.load_teams()
    teams = {s: t for s, t in base.items() if s not in merged["removed"]}
    names = {cid: league_file.engine_name(merged, cid) for cid in merged["conferences"]}
    for s, t in merged["teams"].items():
        if s in merged["added"] or s in merged["changed"]:
            teams[s] = {**copy.deepcopy(base.get(s, {})), "name": t["name"], "state": t.get("state"), "fictional": False,
                        "conference": names[t["conference"]]}
    return teams


def _no_null(g: dict) -> bool:
    """No "null", "None", "undefined" or "NaN" in what a game shows (its scores are None until played)."""
    shown = json.dumps({k: v for k, v in g.items() if v is not None})
    return not any(w in shown for w in ("null", "None", "undefined", "NaN"))


def check_season(games: dict, teams: dict, rules: dict) -> None:
    count = Counter(s for g in games.values() for s in (g["home"], g["away"]) if not teams[s]["fictional"])
    assert set(count.values()) == {12}, sorted((n, s) for s, n in count.items() if n != 12)[:6]
    assert set(count) == {s for s, t in teams.items() if not t["fictional"]}
    weeks = Counter((s, g["week"]) for g in games.values() for s in (g["home"], g["away"]) if not teams[s]["fictional"])
    assert max(weeks.values()) == 1
    assert all(g["home_display"] and g["away_display"] and _no_null(g) for g in games.values())
    for name, rule in rules["conferences"].items():
        members = [s for s, t in teams.items() if t["conference"] == name and not t["fictional"]]
        for a, b in rule.get("protected", []):
            assert a in members and b in members, (name, a, b)
            assert any({g["home"], g["away"]} == {a, b} for g in games.values()), (name, a, b)


def generate(year: int, teams: dict, rules: dict, seed: int = 1):
    return schedule_gen.generate(year, teams, schedule_gen.empty_history(), random.Random(f"league-schedule-{seed}"), rules)


# ---- the tests ---------------------------------------------------------------------------------

def test_empty_history():
    assert schedule_gen.empty_history() == {"pairs": {}, "home_conf": {}, "pending": [], "years": []}
    assert schedule_gen.empty_history() is not schedule_gen.empty_history()


def test_new_conference_season():
    merged = league_file.merge(TEN_TEAM_BIG_SKY_EAST)
    assert league_file.validate(TEN_TEAM_BIG_SKY_EAST) == []
    lgd, _ = league_fill.to_league(merged, 1)
    assert lgd["schedule_rules"] == league_file.schedule_rules(merged) and lgd["divisions"] == league_file.divisions(merged)
    teams = built_teams(lgd)
    games, hist = schedule_gen.generate(2026, teams, schedule_gen.empty_history(), random.Random("league-schedule-1"), lgd["schedule_rules"])
    count = Counter(s for g in games.values() for s in (g["home"], g["away"]) if not teams[s]["fictional"])
    assert set(count.values()) == {12}
    conf = [g for g in games.values() if teams[g["home"]]["conference"] == teams[g["away"]]["conference"] == "Big Sky East"]
    assert all(sum(1 for g in conf if s in (g["home"], g["away"])) == 8 for s in BIG_SKY_EAST)
    assert all(g["conference_game"] for g in conf)
    assert any({g["home"], g["away"]} == {"alder-tech", "oregon-state"} for g in games.values())   # listed rival, other conference
    assert all(g["home_display"] and _no_null(g) for g in games.values())
    check_season(games, teams, lgd["schedule_rules"])
    assert hist["years"] == [2026]
    # the next season runs from that history with the same rules
    games2, hist2 = schedule_gen.generate(2027, teams, hist, random.Random(7), lgd["schedule_rules"])
    check_season(games2, teams, lgd["schedule_rules"])
    assert hist2["years"] == [2026, 2027]


def test_new_conference_rule():
    r = league_file.schedule_rules(league_file.merge(TEN_TEAM_BIG_SKY_EAST))
    assert r["conferences"]["Big Sky East"] == {
        "games": 8, "cycle": 2, "home_split": "even", "protected": [], "finales": [],
        "non_conference": {"games": 4, "power_road": [1, 2], "fcs_max": 1}}
    assert r["annual"] == [{"teams": ["alder-tech", "oregon-state"], "name": ""}]
    assert "Big Sky East" not in schedule_gen.rules()["power"]
    nine = {**TEN_TEAM_BIG_SKY_EAST, "teams": TEN_TEAM_BIG_SKY_EAST["teams"][:9]}
    assert league_file.schedule_rules(league_file.merge(nine))["conferences"]["Big Sky East"]["cycle"] == 1


def test_same_conference_rival_is_protected():
    doc = copy.deepcopy(TEN_TEAM_BIG_SKY_EAST)
    doc["teams"][1]["rivals"] = ["alder-tech", "oregon-state"]
    r = league_file.schedule_rules(league_file.merge(doc))
    assert r["conferences"]["Big Sky East"]["protected"] == [["alder-tech", "basalt-state"]]
    assert r["annual"] == [{"teams": ["alder-tech", "oregon-state"], "name": ""},
                           {"teams": ["basalt-state", "oregon-state"], "name": ""}]
    merged = league_file.merge(doc)
    teams = quick_teams(merged)
    games, _ = generate(2026, teams, r)
    check_season(games, teams, r)


def test_sun_belt_add_rebalances_divisions():
    merged = league_file.merge(file_adding_one_sun_belt_team)
    d = league_file.divisions(merged)["Sun Belt"]
    assert sorted(len(v) for v in d.values()) == [7, 8]
    assert "gulf-coast-tech" in d["East"]                           # a tie goes to the first division in alphabetical order
    r = league_file.schedule_rules(merged)
    assert r["conferences"]["Sun Belt"]["divisions"] == d
    # the schedule fits: division round robins, and every team's twelve games
    teams = quick_teams(merged)
    for year, seed in ((2026, 1), (2026, 2), (2027, 3)):
        games, _ = generate(year, teams, r, seed)
        check_season(games, teams, r)
        conf = Counter(s for g in games.values() if g["conference_game"] for s in (g["home"], g["away"]))
        sb = [s for ms in d.values() for s in ms]
        assert all(7 <= conf[s] <= 8 for s in sb), {s: conf[s] for s in sb}   # at most one league game short
        for div in d.values():
            for i, a in enumerate(div):
                for b in div[i + 1:]:
                    assert any({g["home"], g["away"]} == {a, b} and g["conference_game"] for g in games.values()), (a, b)


def test_divisions_lose_removed_and_empty():
    sb = season.DIVISIONS["Sun Belt"]
    d = league_file.divisions(league_file.merge({"format": "cfp-league/1", "remove": ["troy"]}))["Sun Belt"]
    assert d == {"East": sb["East"], "West": [s for s in sb["West"] if s != "troy"]}
    gone = league_file.merge({"format": "cfp-league/1", "remove": list(sb["West"])})
    assert league_file.divisions(gone) == {"Sun Belt": {}}
    r = league_file.schedule_rules(gone)["conferences"]["Sun Belt"]
    assert "divisions" not in r and "cross_division" not in r
    assert league_file.divisions(league_file.merge({"format": "cfp-league/1", "remove": ["kent-state"]})) == {}


def test_season_divisions():
    assert season.divisions({}) == season.DIVISIONS
    assert season.divisions({"league": {"divisions": {"Sun Belt": {}}}}) == {}
    mine = {"East": ["a"], "West": ["b"]}
    assert season.divisions({"league": {"divisions": {"Sun Belt": mine}}}) == {"Sun Belt": mine}
    assert season.division_of("Sun Belt", "troy") == "West"
    assert season.division_of("Sun Belt", "a", {"Sun Belt": mine}) == "East"
    assert season.division_of("Sun Belt", "troy", {}) is None


def test_removed_team_drops_from_rules():
    r = league_file.schedule_rules(league_file.merge({"format": "cfp-league/1", "remove": ["kent-state"]}))
    assert all("kent-state" not in p for p in r["conferences"]["MAC"]["protected"])
    r = league_file.schedule_rules(league_file.merge({"format": "cfp-league/1", "remove": ["toledo", "clemson", "usc"]}))
    assert ["toledo", "bowling-green"] not in r["conferences"]["MAC"]["protected"]
    assert ["toledo", "bowling-green"] not in r["conferences"]["MAC"]["finales"]
    assert "clemson" not in r["conferences"]["ACC"]["eight_game_team"].values()
    assert all("usc" not in p for p in r["conferences"]["Big Ten"]["protected"] + r["conferences"]["Big Ten"]["finales"])
    assert "SEC" not in r["conferences"]                                       # untouched conferences keep the built-in rule
    pac = league_file.schedule_rules(league_file.merge({"format": "cfp-league/1", "remove": ["oregon-state"]}))
    assert "round_robin" not in pac["conferences"]["Pac-12"]                   # seven teams can't play seven games each
    assert pac["conferences"]["Pac-12"]["games"] == 7


def test_unchanged_import_has_no_rules():
    r = league_file.schedule_rules(league_file.merge({"format": "cfp-league/1", "teams": [{"slug": "rice", "prestige": 55}]}))
    assert r == {"conferences": {}, "annual": []}
    assert league_file.divisions(league_file.merge({"format": "cfp-league/1"})) == {}


def test_one_team_conference_without_league_games():
    merged = league_file.merge(ONE_TEAM_NO_GAMES)
    r = league_file.schedule_rules(merged)
    assert r["conferences"]["Big Sky East"]["games"] == 0
    teams = quick_teams(merged)
    games, _ = generate(2026, teams, r)
    check_season(games, teams, r)
    assert any({g["home"], g["away"]} == {"alder-tech", "oregon-state"} for g in games.values())


def test_every_width_validate_passes_schedules():
    """Review Focus: whatever conference size and games count validate lets through, the generator builds."""
    for n, g in ((9, 8), (8, 7), (9, 7), (11, 9), (12, 11), (6, 4), (5, 3), (2, 1), (3, 2)):
        doc = {"format": "cfp-league/1",
               "conferences": [{"id": "big-sky-east", "name": "Big Sky East", "level": "FBS", "games": g}],
               "teams": [_new_team(f"new-school-{i}", ["OR", "WA", "ID", "TX", "OH"][i % 5], "big-sky-east") for i in range(n)]}
        assert league_file.validate(doc) == [], (n, g)
        merged = league_file.merge(doc)
        r = league_file.schedule_rules(merged)
        teams = quick_teams(merged)
        games, hist = generate(2026, teams, r, n * 100 + g)
        check_season(games, teams, r)
        conf = Counter(s for x in games.values() if x["conference_game"] for s in (x["home"], x["away"]) if s.startswith("new-school"))
        want = Counter({f"new-school-{i}": g for i in range(n)})
        assert sum(conf.values()) == sum(want.values()) - (n * g) % 2 and max(conf.values()) == g, (n, g, conf)
        games, _ = schedule_gen.generate(2027, teams, hist, random.Random(n), r)
        check_season(games, teams, r)
    too_many = {"format": "cfp-league/1",
                "conferences": [{"id": "big-sky-east", "name": "Big Sky East", "level": "FBS", "games": 8}],
                "teams": [_new_team(f"new-school-{i}", "OR", "big-sky-east") for i in range(8)]}
    assert league_file.validate(too_many)                                      # eight teams can't play eight each


def test_builtin_conference_widths_validate_passes():
    """A built-in conference grown or shrunk (and its games changed) still schedules."""
    files = [
        {"format": "cfp-league/1", "remove": ["kent-state", "akron", "ohio"]},
        {"format": "cfp-league/1", "conferences": [{"id": "mac", "name": "MAC", "level": "FBS", "games": 10}]},
        {"format": "cfp-league/1", "conferences": [{"id": "sun-belt", "name": "Sun Belt", "level": "FBS", "games": 10}],
         "teams": [_new_team(f"bayou-{i}", "LA", "sun-belt") for i in range(3)]},
        {"format": "cfp-league/1", "conferences": [{"id": "sun-belt", "name": "Sun Belt", "level": "FBS", "games": 5}]},
        {"format": "cfp-league/1", "teams": [_new_team("owl-state", "OR", "pac-12"), _new_team("hawk-tech", "TX", "sec"),
                                             {"slug": "toledo", "conference": "mountain-west"}]},
    ]
    for i, doc in enumerate(files):
        assert league_file.validate(doc) == [], (i, league_file.validate(doc))
        merged = league_file.merge(doc)
        r = league_file.schedule_rules(merged)
        teams = quick_teams(merged)
        for year in (2026, 2028):
            games, _ = generate(year, teams, r, i)
            check_season(games, teams, r)


RENAMED_SUN_BELT = {"format": "cfp-league/1",
                    "conferences": [{"id": "sun-belt", "name": "Southern Belt", "level": "FBS", "games": 9}],
                    "teams": [_new_team("gulf-coast-tech", "AL", "sun-belt")]}


def test_renamed_conference_keeps_engine_name():
    assert league_file.validate(RENAMED_SUN_BELT) == []
    merged = league_file.merge(RENAMED_SUN_BELT)
    lgd, _ = league_fill.to_league(merged, 1)
    assert lgd["conference_names"] == {"Sun Belt": "Southern Belt"}
    assert set(lgd["schedule_rules"]["conferences"]) == {"Sun Belt"} and set(lgd["divisions"]) == {"Sun Belt"}
    assert lgd["schedule_rules"]["conferences"]["Sun Belt"]["games"] == 9
    teams = built_teams(lgd)
    members = sorted(s for s, t in teams.items() if t["conference"] == "Sun Belt")
    assert members == sorted(merged["conferences"]["sun-belt"]["members"]) and "gulf-coast-tech" in members
    assert not any(t["conference"] == "Southern Belt" for t in teams.values())
    games, _ = generate(2026, teams, lgd["schedule_rules"])
    check_season(games, teams, lgd["schedule_rules"])
    conf = Counter(s for g in games.values() if g["conference_game"] for s in (g["home"], g["away"]))
    assert all(8 <= conf[s] <= 9 for s in members) and max(conf[s] for s in members) == 9


def test_rename_with_games_applies_games():
    doc = {"format": "cfp-league/1", "conferences": [{"id": "mac", "name": "Mid-American", "level": "FBS", "games": 9}]}
    merged = league_file.merge(doc)
    r = league_file.schedule_rules(merged)
    assert set(r["conferences"]) == {"MAC"} and r["conferences"]["MAC"]["games"] == 9 and "games_from" not in r["conferences"]["MAC"]
    assert league_file.conference_names(merged) == {"MAC": "Mid-American"}
    teams = quick_teams(merged)
    games, _ = generate(2026, teams, r)
    check_season(games, teams, r)
    mac = [s for s, t in teams.items() if t["conference"] == "MAC"]
    conf = Counter(s for g in games.values() if g["conference_game"] for s in (g["home"], g["away"]))
    assert len(mac) == 13 and sum(conf[s] for s in mac) == 13 * 9 - 1 and max(conf[s] for s in mac) == 9
    only_rename = league_file.merge({"format": "cfp-league/1", "conferences": [{"id": "mac", "name": "Mid-American", "games": 8}]})
    assert league_file.schedule_rules(only_rename) == {"conferences": {}, "annual": []}   # a rename alone: the display name


def test_renamed_power_conference_stays_power():
    doc = {"format": "cfp-league/1", "conferences": [{"id": "sec", "name": "Southeastern", "level": "FBS", "games": 9}],
           "teams": [_new_team("hawk-tech", "TX", "sec")]}
    assert league_file.validate(doc) == []
    merged = league_file.merge(doc)
    r = league_file.schedule_rules(merged)
    assert set(r["conferences"]) == {"SEC"} and "SEC" in schedule_gen.rules()["power"]
    assert league_file.conference_names(merged) == {"SEC": "Southeastern"}
    lgd, _ = league_fill.to_league(merged, 1)
    assert lgd["teams"]["hawk-tech"]["meta"]["conference"] == "SEC"
    teams = quick_teams(merged)
    assert teams["hawk-tech"]["conference"] == "SEC"
    games, hist = generate(2026, teams, r)
    check_season(games, teams, r)
    # Power status: a Group of Five team's game with an SEC team is a pay game at the SEC team's place, never returned
    sec = {s for s, t in teams.items() if t["conference"] == "SEC"}
    power = {s for s, t in teams.items() if t["conference"] in schedule_gen.rules()["power"]} | set(schedule_gen.rules()["power_independents"])
    g5 = {s for s, t in teams.items() if not t["fictional"] and s not in power}
    assert any(g["home"] in sec and g["away"] in g5 for g in games.values())
    assert not any(g["home"] in g5 and g["away"] in sec for g in games.values())
    assert not any({p["home"], p["away"]} & sec and {p["home"], p["away"]} & g5 for p in hist["pending"])


def test_moved_team_keeps_rivalry():
    doc = {"format": "cfp-league/1", "teams": [{"slug": "toledo", "conference": "mountain-west"}]}
    assert league_file.validate(doc) == []
    merged = league_file.merge(doc)
    r = league_file.schedule_rules(merged)
    assert {"teams": ["bowling-green", "toledo"], "name": ""} in r["annual"]
    teams = quick_teams(merged)
    assert teams["toledo"]["conference"] == "Mountain West"
    games, _ = generate(2026, teams, r)
    check_season(games, teams, r)
    g = [g for g in games.values() if {g["home"], g["away"]} == {"bowling-green", "toledo"}]
    assert len(g) == 1 and not g[0]["conference_game"]


def test_builtin_rules_unchanged():
    T = season.load_teams()
    H = schedule_gen.seed_history(T)
    assert schedule_gen.generate(2027, T, H, random.Random(5))[0] == schedule_gen.generate(2027, T, H, random.Random(5), None)[0]
    assert schedule_gen.generate(2027, T, H, random.Random(5))[0] == \
        schedule_gen.generate(2027, T, H, random.Random(5), {"conferences": {}, "annual": []})[0]
    rng, h = random.Random(5), H
    for year in (2027, 2028):
        g, h = schedule_gen.generate(year, T, h, rng, None)
        assert hashlib.sha256(json.dumps([g, h], sort_keys=True).encode()).hexdigest() == BUILTIN_DIGESTS[year], year


if __name__ == "__main__":
    for _n, _f in sorted(globals().items()):
        if _n.startswith("test_"):
            _f()
            print(_n, "ok")
    print("ok")
