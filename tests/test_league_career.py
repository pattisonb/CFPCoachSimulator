"""A career from a league file, through the API (app/api.py): /api/league/check reads and checks the
file, POST /api/season starts the career from it, and the imported league carries the career through
a season and an offseason. An unchanged export collapses to the built-in path. Saves and league files
go to temporary folders. Slow (a league fill and two seasons' rosters); in tests/run_all.py's SLOW."""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root
import copy
import json
import shutil
import tempfile

from app import api
from coach_career import league, league_file, league_fill, offseason, programs, recruiting
from sim import coaches, fcs_names, schedule_gen, season
import test_offseason

FCS_META = [league.base_meta(s) for s in league.base_slugs() if league.base_meta(s)["fictional"]]
BIG_SKY_EAST = ["alder-tech", "basalt-state", "cascade-tech", "deschutes", "elk-river", "fir-valley",
                "glacier-state", "high-desert", "ironwood", "juniper-state"]
_STATES = ["OR", "OR", "WA", "OR", "ID", "WA", "MT", "OR", "WA", "ID"]


def _new_team(slug: str, state: str, **kw) -> dict:
    return {"slug": slug, "name": " ".join(w.capitalize() for w in slug.split("-")), "state": state,
            "conference": "big-sky-east", **kw}


ALDER_IN_NEW_TEN_TEAM_CONFERENCE = {
    "format": "cfp-league/1", "name": "My League",
    "conferences": [{"id": "big-sky-east", "name": "Big Sky East", "level": "FBS", "games": 8}],
    "teams": [_new_team(s, st, **({"rivals": ["oregon-state"], "prestige": 40} if s == "alder-tech" else {}))
              for s, st in zip(BIG_SKY_EAST, _STATES)]}


class Refused(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(f"{status}: {message}")
        self.status, self.message = status, message


def api_call(method: str, path: str, body: dict | None = None, body_bytes: bytes | None = None):
    """One call the way the browser worker makes it (api.call_js): the result, or Refused."""
    out = api.call_js(method, path, json.dumps(body) if body is not None else None, body_bytes)
    if isinstance(out, (bytes, bytearray)):
        return out
    r = json.loads(out)
    if not r["ok"]:
        raise Refused(r["status"], r["message"])
    return r["result"]


def refused(fn, code: int) -> str:
    try:
        fn()
    except Refused as e:
        assert e.status == code, (e.status, e.message)
        return e.message
    raise AssertionError(f"expected {code}")


def sentence(s: str) -> bool:
    return bool(s) and s[0].isupper() and s.endswith(".") and not any(w in s for w in ("None", "null", "undefined", "NaN"))


# ---- league_file.check ---------------------------------------------------------------------------

def test_check_errors():
    r = league_file.check(b'{"format": "cfp-league/2"}')
    assert r == {"ok": False, "errors": ["The file's format is 'cfp-league/2'; this game reads 'cfp-league/1'."]}
    bad = {"format": "cfp-league/1", "teams": [{"slug": "alder-tech", "name": "Alder Tech", "conference": "big-sky-e"}]}
    r = league_file.check(league_file.dumps(bad))
    assert not r["ok"] and "Alder Tech: conference 'big-sky-e' is not in the file or the game." in r["errors"]


def test_check_schedule_error_names_no_stand_in():
    fcs = FCS_META[0]["slug"]
    real = schedule_gen.generate

    def fails(*a, **k):
        raise schedule_gen.ScheduleError(f"{fcs} cannot fill its 2026 schedule; alder-tech too")
    schedule_gen.generate = fails
    try:
        r = league_file.check(league_file.dumps(ALDER_IN_NEW_TEN_TEAM_CONFERENCE), seed=4)
    finally:
        schedule_gen.generate = real
    assert r == {"ok": False, "errors": ["The 2026 schedule could not be built for this league: "
                                         "an FCS opponent cannot fill its 2026 schedule; Alder Tech too."]}, r


def test_plain_reasons():
    fcs = FCS_META[0]["slug"]
    teams = {fcs: {"fictional": True, "name": "x"}, "alder-tech": {"fictional": False, "name": "Alder Tech"}}
    got = league_file._plain(f"2 teams without 12 games in 2026: ['{fcs}', 'alder-tech']; can't fit", teams)
    assert got == "2 teams without 12 games in 2026: an FCS opponent, Alder Tech; can't fit", got
    assert league_file._plain("no Big Ten slate for 2026", {}, {"Big Ten": "Big Ten Plus"}) == "no Big Ten Plus slate for 2026"


def _rename_only(name: str, suffix: str) -> dict:
    b = league_file._builtin()
    cid = next(iter(b["conf_names"]))
    return {"format": "cfp-league/1", "name": name,
            "conferences": [{"id": cid, "name": b["conf_names"][cid] + suffix, "games": b["games"][cid]}]}


def test_check_rename_only_keeps_the_real_schedule():
    b = league_file._builtin()
    cid = next(iter(b["conf_names"]))
    doc = {"format": "cfp-league/1", "name": "Renamed",
           "conferences": [{"id": cid, "name": b["conf_names"][cid] + " Plus", "games": b["games"][cid]}]}
    r = league_file.check(league_file.dumps(doc), seed=2)
    assert r["ok"] and not r["builtin"] and r["games"] is None and "schedule_history" not in r["league"]
    s = r["summary"]
    assert s["name"] == "Renamed" and (s["added"], s["changed"], s["removed"], s["generated"]) == (0, 0, 0, 0)
    assert all(sentence(x) for x in s["lines"]), s["lines"]


# ---- the API ---------------------------------------------------------------------------------------

def test_collapsed_import_is_the_builtin_career():
    r = api_call("POST", "/api/league/check", body_bytes=league_file.builtin_bytes())
    assert r["ok"] and r["key"] == "builtin" and not r["errors"]
    assert [t["slug"] for t in r["teams"]] == [t["slug"] for t in sorted(r["teams"], key=lambda t: t["name"].casefold())]
    assert any(t["slug"] == "smu" for t in r["teams"]) and not any(t["fictional"] for t in r["teams"])
    assert all(sentence(x) for x in r["summary"]["lines"]), r["summary"]["lines"]
    s = api_call("POST", "/api/season", {"team": "smu", "mode": "full", "seed": 11, "league": r["key"]})
    st = season.load_season(s["id"])
    assert "league" not in st and s["league"] is None
    season.use_league(season.TEAMS_FILE)
    recruiting.use_league_models({})
    ref = season.new_season("smu", "full", seed=11, career=True)
    assert st["games"] == ref["games"] and st["polls"] == ref["polls"]


def test_refusals():
    refused(lambda: api_call("POST", "/api/season", {"team": "smu", "seed": 1, "league": "0" * 64}), 409)
    assert "no longer loaded" in refused(lambda: api_call("POST", "/api/season", {"team": "smu", "league": "abc"}), 409)
    r = api_call("POST", "/api/league/check", body_bytes=b"{")
    assert not r["ok"] and r["errors"] and r["key"] is None and r["teams"] == []


def test_stale_key_and_failed_check():
    """Only the league checked last is pending: an older key is refused, and a failed check clears it."""
    a = api_call("POST", "/api/league/check", body_bytes=league_file.dumps(_rename_only("League A", " A")))
    b = api_call("POST", "/api/league/check", body_bytes=league_file.dumps(_rename_only("League B", " B")))
    assert a["ok"] and b["ok"] and a["key"] != b["key"] and api._pending_league["key"] == b["key"]
    assert "no longer loaded" in refused(lambda: api_call("POST", "/api/season", {"team": "smu", "seed": 1, "league": a["key"]}), 409)
    assert not api_call("POST", "/api/league/check", body_bytes=b"{")["ok"]
    assert api._pending_league is None
    refused(lambda: api_call("POST", "/api/season", {"team": "smu", "seed": 1, "league": b["key"]}), 409)


def _check_new_team_program_values(st: dict):
    """A new team in a new conference: its base program values from its prestige and its conference
    (a conference of new teams has no built-in members, so the game's defaults)."""
    alder, basalt = programs.get(st, "alder-tech"), programs.get(st, "basalt-state")
    assert alder["prestige"] == alder["history"] == 40.0
    assert basalt["prestige"] == programs.BASE_DEFAULT["prestige"]
    for k in ("winning", "nil", "conference"):
        assert alder[k] == basalt[k] == programs.BASE_DEFAULT[k], k
    assert alder["market"] == programs.MARKET_DEFAULT
    assert alder["rating"] > basalt["rating"]


FILLS: list = []


def _count_fills():
    real = league_fill.to_league

    def counted(*a, **k):
        FILLS[0] += 1
        return real(*a, **k)
    league_fill.to_league = counted
    FILLS[:] = [0]


def _check_failed_starts_clean_up(key: str):
    """A Start that fails in the season or in its save leaves no league file and no save, puts the
    built-in league back, and keeps the pending league for another try."""
    def files() -> set:
        return set(league.CACHE_DIR.glob("*")) | set(season.SEASONS_DIR.glob("*"))
    before = files()
    for name in ("new_season", "save_season"):
        real = getattr(season, name)

        def boom(*a, _real=real, _name=name, **k):
            if _name == "save_season":
                _real(*a, **k)                     # a save written, then the failure
            raise RuntimeError("disk full")
        setattr(season, name, boom)
        try:
            refused(lambda: api_call("POST", "/api/season", {"team": "alder-tech", "seed": 4, "league": key}), 500)
        finally:
            setattr(season, name, real)
        assert files() == before, (name, files() - before)
        assert season._league_path == season.TEAMS_FILE and api._pending_league["key"] == key, name


def full_career():
    _count_fills()
    blob = league_file.dumps(ALDER_IN_NEW_TEN_TEAM_CONFERENCE)
    r = api_call("POST", "/api/league/check", body_bytes=blob)
    assert r["ok"] and not r["errors"] and any(t["slug"] == "alder-tech" for t in r["teams"]), r.get("errors")
    assert r["summary"]["added"] == 10 and r["summary"]["generated"] == 850 and all(sentence(x) for x in r["summary"]["lines"])
    checked = copy.deepcopy({slug: t["roster"] for slug, t in api._pending_league["lgd"]["teams"].items()})
    refused(lambda: api_call("POST", "/api/season", {"team": "nowhere-u", "seed": 4, "league": r["key"]}), 404)
    fcs = FCS_META[0]["slug"]
    refused(lambda: api_call("POST", "/api/season", {"team": fcs, "seed": 4, "league": r["key"]}), 404)
    _check_failed_starts_clean_up(r["key"])
    s = api_call("POST", "/api/season", {"team": "alder-tech", "mode": "full", "seed": 4, "league": r["key"]})
    assert FILLS == [1], FILLS                       # checked without a seed, started with seed 4: one fill
    st = season.load_season(s["id"])
    assert {slug: t["roster"] for slug, t in st["league"]["teams"].items()} == checked   # the league checked, exactly
    # the 2026 teams file Start wrote is what ensure_built rebuilds (the browser keeps no data/leagues)
    path = league.path(s["id"], 2026)
    written = path.read_bytes()
    path.unlink()
    assert league.ensure_built(st) == path and path.read_bytes() == written
    assert st["league"]["source"]["name"] == "My League" and s["league"] == "My League"
    assert sum(1 for g in st["games"].values() if "alder-tech" in (g["home"], g["away"])) == 12
    assert any({g["home"], g["away"]} == {"alder-tech", "oregon-state"} for g in st["games"].values())
    assert [e["team"] for e in st["polls"]["0"]["ap"]] == season._rating_poll(season.load_teams())   # no real 2026 AP poll
    assert st["league"]["schedule_history"]["years"] == [2026]       # 2027 is scheduled from season one's games
    teams = api_call("GET", f"/api/season/{s['id']}/teams")["teams"]
    assert any(t["slug"] == "alder-tech" and t["conference"] == "Big Sky East" for t in teams)
    refused(lambda: api_call("POST", "/api/season", {"team": "alder-tech", "seed": 4, "league": r["key"]}), 409)  # used up
    _check_new_team_program_values(st)
    season.advance_to(st, 2)                                          # real games, weeks 1-2
    assert all(g["played"] for g in st["games"].values() if g["week"] <= 2)
    test_offseason.finished(st)                                       # the rest of the season, faked
    table = season.standings(st)
    assert "Big Sky East" in table and len(table["Big Sky East"]) == 10
    assert recruiting.fbs_schools(st).count("alder-tech") == 1
    assert recruiting.nil_budget(st, "alder-tech") >= recruiting.NIL_FLOOR
    offseason.start(st)
    while st["offseason"]["stage"] != "ready":
        offseason.advance(st)
    nxt = offseason.next_season(st)
    assert "alder-tech" in nxt["league"]["teams"] and nxt["year"] == 2027
    assert sum(1 for g in nxt["games"].values() if "alder-tech" in (g["home"], g["away"])) == 12
    # the FCS stand-ins show only their region labels (the brief's "short_name not in the page" predates
    # the rename: a stand-in's short name is now its label), and nothing of the names they once had
    view = api_call("GET", f"/api/season/{s['id']}")
    text = json.dumps(view)
    assert not fcs_names.has_old(text)
    fict = {f["slug"] for f in FCS_META}
    for g in view["schedule"]:
        if g.get("opponent") in fict:
            assert g["opponent_name"] == season.fcs_label(g["opponent"]), g
    for g in st["games"].values():
        for side in ("home", "away"):
            if g[side] in fict:
                assert g[f"{side}_display"] == season.fcs_label(g[side]), g
    print("league career ok")


if __name__ == "__main__":
    seasons_dir = _Path(tempfile.mkdtemp(prefix="cfp-league-seasons-"))
    coaches_dir = _Path(tempfile.mkdtemp(prefix="cfp-league-coaches-"))
    leagues_dir = _Path(tempfile.mkdtemp(prefix="cfp-league-leagues-"))
    season.SEASONS_DIR, coaches.COACHES_DIR, league.CACHE_DIR = seasons_dir, coaches_dir, leagues_dir
    try:
        test_check_errors()
        test_check_schedule_error_names_no_stand_in()
        test_plain_reasons()
        test_check_rename_only_keeps_the_real_schedule()
        test_refusals()
        test_stale_key_and_failed_check()
        test_collapsed_import_is_the_builtin_career()
        full_career()
    finally:
        season.close_pool()
        season.use_league(season.TEAMS_FILE)
        for d in (seasons_dir, coaches_dir, leagues_dir):
            shutil.rmtree(d, ignore_errors=True)
    print("ok")
