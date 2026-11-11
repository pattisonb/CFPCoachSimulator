"""The player page in the offseason (docs/superpowers/plans/2026-11-10-player-links-offseason.md, Task 1):
season.player_profile finds a player by slug on any team, and offseason.player_next reads where he is now
from the career's league (his team, position, class and overall, or where he went)."""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))
_sys.path.insert(0, str(_Path(__file__).resolve().parent))

from coach_career import offseason
from sim import season
from test_offseason import finished

ME = "iowa"


def offseason_state():
    st = season.new_season(ME, "full", seed=5, career=True)
    finished(st)
    offseason.start(st)
    return st


def an_iowa_player(st):
    """A last-season Iowa player still on next year's Iowa roster (and not a Keep Them Home leaver)."""
    leaving = {e["id"] for e in (st["offseason"].get("retention") or {}).get("players") or ()}
    ids = {c["id"] for c in st["league"]["teams"][ME]["roster"]} - leaving
    t = season.load_teams()[ME]
    return next(p for p in t["offense"] + t["defense"] if p["slug"] in ids)


def test_find_by_slug_on_any_team(st):
    p = an_iowa_player(st)
    prof = season.player_profile(st, None, slug=p["slug"])
    assert prof is not None and prof["team"]["slug"] == ME and prof["slug"] == p["slug"], prof and prof.get("team")


def test_next_season_returning(st):
    p = an_iowa_player(st)
    c = next(c for c in st["league"]["teams"][ME]["roster"] if c["id"] == p["slug"])
    n = offseason.player_next(st, p["slug"])
    assert n["status"] == "returning" and n["team"] == ME and n["overall"] == c["o"], n
    assert n["sentence"] == f"Returning to {n['team_name']} as a {n['class_name'].lower()}, {c['o']} overall.", n["sentence"]
    assert n["season"] == st["offseason"]["year"] - 1, n
    assert n["team_name"] and n["position"] == c["pos"] and n["class"] == c["cls"] and n["class_name"], n


def test_next_season_departed(st):
    ev = next(e for e in st["offseason"]["departures"] if e["kind"] == "graduated")
    n = offseason.player_next(st, ev["id"])
    assert n["status"] == "graduated" and n["team"] is None and n["team_name"] is None, n
    assert n["sentence"] == "Graduated.", n


def test_next_season_transfer(st):
    teams = st["league"]["teams"]
    other = next(s for s in sorted(teams) if s != ME and teams[s]["roster"])
    c = teams[other]["roster"].pop(0)
    teams[ME]["roster"].append(c)
    try:
        n = offseason.player_next(st, c["id"])
        assert n["status"] == "transfer_in" and n["team"] == ME, n
        assert n["sentence"].startswith("Transferred from ") and f"to {n['team_name']}" in n["sentence"], n["sentence"]
    finally:
        teams[ME]["roster"].remove(c)
        teams[other]["roster"].insert(0, c)


def test_next_season_pending_redshirt(st):
    """Before the redshirt calls land (they apply leaving Departures), a candidate reads the class he will have."""
    rs = st["offseason"]["redshirts"]
    assert not rs["decided"] and rs["players"], rs
    for r in rs["players"][:6]:
        want = r["cls"] + "RS" if r["redshirt"] else offseason.NEXT_CLASS.get(r["cls"], r["cls"])
        n = offseason.player_next(st, r["id"])
        assert n["class"] == want, (r["name"], r["cls"], r["redshirt"], n["class"])


def test_next_season_wants_to_leave(st):
    """At Keep Them Home a player who wants out reads that he wants to leave (where to), not Returning."""
    ret = st["offseason"].get("retention") or {}
    assert st["offseason"]["stage"] == "retention" and ret.get("players"), st["offseason"]["stage"]
    for e in ret["players"][:4]:
        n = offseason.player_next(st, e["id"])
        want = "Wants to Leave: NFL Draft" if e["intent"] == "draft" else "Wants to Leave: Transfer Portal"
        assert n["status"] == "leaving" and n["status_name"] == want and n["team"] is None, (e["name"], e["intent"], n)
        assert n["sentence"] == ("Wants to leave for the NFL Draft." if e["intent"] == "draft" else "Wants to leave for the transfer portal."), n


def test_next_season_outside_offseason():
    fresh = season.new_season(ME, "full", seed=5, career=True)
    p = season.load_teams()[ME]["offense"][0]
    assert offseason.player_next(fresh, p["slug"]) is None


def test_api_player_by_slug(st):
    from app import api
    p = an_iowa_player(st)
    api._hold(st)
    out = api.season_player(api.Params({"season_id": st["id"]}, {"slug": p["slug"]}, None))
    assert out["team"]["slug"] == ME and out["next"]["status"] == "returning", (out.get("team"), out.get("next"))


if __name__ == "__main__":
    st = offseason_state()
    test_next_season_wants_to_leave(st)
    test_find_by_slug_on_any_team(st)
    test_next_season_returning(st)
    test_next_season_departed(st)
    test_next_season_transfer(st)
    test_next_season_pending_redshirt(st)
    test_next_season_outside_offseason()
    test_api_player_by_slug(st)
    print("player next season ok: found by slug on any team; returning, transfer, departed; the API without a team")
