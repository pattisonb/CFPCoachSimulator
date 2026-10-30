"""The transfer portal recap (offseason.view through app/api.py): at Development, Staff and Ready
the view carries `portal_recap` (who you signed out of the portal, who you lost to it and where he
went, with his reason), your transfers are marked on `my_roster` and in the development report,
and every signed transfer is in `report.transfers` whatever the top-25 slice keeps. Your staff
recruit the portal on Auto so at least one offer lands. (Run as a file.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))
from app import api
from sim import season
from tests.test_portal_profile import G, to_portal

ME = "ohio-state"


def advance(sid: str) -> dict:
    return api.call("POST", f"/api/season/{sid}/offseason/advance", {})


def check_recap(sid: str, v: dict) -> dict:
    st = api.loaded_state()
    off = st["offseason"]
    players = off["portal"]["players"]
    roster = st["league"]["teams"][ME]["roster"]
    rec = v["portal_recap"]
    assert rec is not None, v["stage"]
    # who you got: every portal entrant now on your roster, marked with the school he came from
    signed_ids = {p["id"] for p in roster if p.get("transfer") and p["id"] in players}
    assert signed_ids, "seed 11 on Auto lands at least one portal signing"
    assert {r["id"] for r in rec["signed"]} == signed_ids
    by_id = {p["id"]: p for p in roster}
    for r in rec["signed"]:
        p = by_id[r["id"]]
        assert r["from"] == p["transfer"] == players[r["id"]]["from"]
        assert r["from_name"] and r["from_name"] != r["from"]
        assert r["name"] == p["n"] and r["pos"] == p["pos"] and r["cls"] == p["cls"] and r["overall"] > 0
        assert r["walk_on"] == bool(p.get("walk_on"))
    # who you lost: the departures' portal players, where each went and why he left
    lost_ids = {d["id"] for d in off["departures"] if d["team"] == ME and d["kind"] == "portal"}
    assert {r["id"] for r in rec["lost"]} == lost_ids
    reasons = {e["id"]: e["reason"] for e in (off.get("retention") or {}).get("players", [])}
    for r in rec["lost"]:
        e = players[r["id"]]
        assert r["to"] == e["signed"]
        assert r["to_name"] == ("out of FBS" if not e["signed"] else r["to_name"]) and r["to_name"]
        if e["signed"]:
            assert r["to_name"] != r["to"]
        assert r["reason"] == reasons.get(r["id"])
        assert r["reason"], "a leaver you met at Retention has his reason"
    assert rec["entrants"] == len(players)
    assert rec["signed_league"] == sum(1 for e in players.values() if e["signed"])
    # the development report: every transfer, marked, even past the top 25
    rep = v["report"]
    dev = {r["id"]: r for r in rep["transfers"]}
    assert signed_ids <= set(dev)
    for pid in signed_ids:
        assert dev[pid]["transfer"] == by_id[pid]["transfer"]
        assert "gain" in dev[pid] and "why" in dev[pid]
    for r in rep["mine"]:
        assert r.get("transfer") == by_id[r["id"]].get("transfer")
    # the roster rows the position-change picker reads
    rows = {r["id"]: r for r in v["my_roster"]}
    for pid in signed_ids:
        assert rows[pid]["transfer"] == by_id[pid]["transfer"]
    assert all(not rows[pid].get("transfer") for pid in rows if pid not in signed_ids and not by_id[pid].get("transfer"))
    return rec


if __name__ == "__main__":
    import shutil
    import tempfile
    season.SEASONS_DIR = _Path(tempfile.mkdtemp(prefix="cfp-portal-recap-"))
    try:
        sid = api.call("POST", "/api/season", {"team": ME, "mode": "full", "seed": 11, "career": True})["id"]
        to_portal(sid)
        v = G(sid, "offseason")
        assert v["stage"] == "portal_w1" and v["portal_recap"] is None, "no recap before the portal closes"
        api.call("POST", f"/api/season/{sid}/settings", {"auto_recruit": "season"})
        while api.loaded_state()["offseason"]["stage"] != "development":
            advance(sid)
        v = G(sid, "offseason")
        rec = check_recap(sid, v)
        advance(sid)
        v2 = G(sid, "offseason")
        assert v2["stage"] == "staff" and check_recap(sid, v2) == rec
        advance(sid)
        v3 = G(sid, "offseason")
        assert v3["stage"] == "ready" and check_recap(sid, v3) == rec
    finally:
        season.close_pool()
        shutil.rmtree(season.SEASONS_DIR, ignore_errors=True)
    print(f"ok: signed {len(rec['signed'])} of {rec['entrants']}, lost {len(rec['lost'])}")
