"""Position changes any time (sim/season.py position_options / change_position and the
/position routes; coach_career/offseason.py change_position at every stage): in week 3 of a
career a receiver becomes a tight end at once: the depth chart, his profile, the next game's
box score and the season stats show him at TE with where he came from, his overall is the
formula's at TE, moving him back clears the change, a reloaded save keeps it, and the offseason's
own change works at the "ready" stage too. Saves go to a temporary folder. (Run as a file:
multiprocessing on Windows.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))

from app import api
from coach_career import offseason
from sim import coaches
from sim import season
from test_api_dispatch import refused
from test_offseason import finished


def drain() -> None:
    while api.step() is not None:
        pass


def chart_rows(sid: str, me: str) -> dict:
    v = api.call("GET", f"/api/season/{sid}/depth/{me}")
    return {r["role"]: r["players"] for u in v["units"] for r in u["rows"]}


if __name__ == "__main__":
    import shutil
    import tempfile
    seasons_dir = _Path(tempfile.mkdtemp(prefix="cfp-pos-seasons-"))
    coaches_dir = _Path(tempfile.mkdtemp(prefix="cfp-pos-coaches-"))
    season.SEASONS_DIR, coaches.COACHES_DIR = seasons_dir, coaches_dir
    try:
        s = api.call("POST", "/api/season", {"team": "ohio-state", "seed": 7, "career": True})
        sid, me = s["id"], "ohio-state"
        base = f"/api/season/{sid}"
        api.call("POST", f"{base}/advance", {"to": 3})
        drain()
        st = api.loaded_state()
        assert st["current_week"] == 3
        rows = chart_rows(sid, me)
        wr = rows["WR"][1]                                   # a receiver in the rotation
        opts = api.call("GET", f"{base}/position_options/{me}/{wr['slug']}")["options"]
        assert opts[0]["pos"] == "WR" and opts[0]["current"] and all({"pos", "group", "overall", "current"} <= set(o) for o in opts)
        assert not any(o["pos"] in ("K", "P") for o in opts), "a receiver is offered the kicker's spot"
        te = next(o for o in opts if o["pos"] == "TE")
        # the change: the depth chart has him at TE, out of every WR slot, with where he came from
        r = api.call("POST", f"{base}/position", {"team": me, "player": wr["slug"], "pos": "TE"})
        assert r == {"slug": wr["slug"], "position": "TE", "overall": te["overall"], "moved_from": "WR"}, r
        assert api.changed()
        rows = chart_rows(sid, me)
        assert wr["slug"] not in [c["slug"] for c in rows["WR"]]
        mine = next(c for c in rows["TE"] if c["slug"] == wr["slug"])
        assert mine["position"] == "TE" and mine["moved_from"] == "WR" and mine["overall"] == te["overall"], mine
        assert all("moved_from" in c for c in rows["TE"]) and all(c["moved_from"] is None for c in rows["QB"])
        order = season.depth_order(st, me, "TE")
        tes = {c["slug"]: c for c in rows["TE"]}
        ahead = [tes[x]["overall"] for x in order[:order.index(wr["slug"])] if x in tes]
        assert all(o >= te["overall"] for o in ahead), "he is placed by his overall at tight end"
        assert wr["slug"] not in season.depth_order(st, me, "WR")
        prof = api.call("GET", f"{base}/player?team={me}&slug={wr['slug']}")
        assert prof["position"] == "TE" and prof["role"] == "TE" and prof["overall"] == te["overall"], (prof["position"], prof["overall"])
        # a sim week: the box score and the season stats list him at TE
        api.call("POST", f"{base}/advance", {})
        drain()
        st = api.loaded_state()
        assert st["current_week"] == 4
        game = next(g for g in st["games"].values() if g["week"] == 4 and me in (g["home"], g["away"]) and g["played"])
        box = api.call("GET", f"{base}/game/{game['event_id']}")
        side = box["home"] if game["home"] == me else box["away"]
        lines = [p for p in side["players"] if p["name"] == wr["name"]]
        assert lines and all(p["position"] == "TE" for p in lines), lines
        ss = st["season_stats"][me]["players"]
        assert f"{wr['name']}|TE" in ss and f"{wr['name']}|WR" not in ss, [k for k in ss if k.startswith(wr["name"])]
        assert ss[f"{wr['name']}|TE"]["games"] >= 1
        stats = api.call("GET", f"{base}/stats/players?team={me}&category=receiving")["players"]
        line = next((p for p in stats if p["name"] == wr["name"]), None)
        assert line is None or line["position"] == "TE"
        # refusals: the same spot, another team's player, a made-up position, nobody
        refused(lambda: api.call("POST", f"{base}/position", {"team": me, "player": wr["slug"], "pos": "TE"}), 409)
        other = chart_rows(sid, "georgia")["QB"][0]["slug"]
        refused(lambda: api.call("POST", f"{base}/position", {"team": "georgia", "player": other, "pos": "WR"}), 403)
        refused(lambda: api.call("GET", f"{base}/position_options/georgia/{other}"), 403)
        refused(lambda: api.call("POST", f"{base}/position", {"team": me, "player": wr["slug"], "pos": "XX"}), 400)
        refused(lambda: api.call("POST", f"{base}/position", {"team": me, "player": "nobody", "pos": "WR"}), 404)
        refused(lambda: api.call("POST", f"{base}/position", {"team": me, "player": wr["slug"], "pos": "K"}), 400)
        # a reloaded save keeps the change
        again = season.load_season(sid)
        assert season.position_changes(again, me)[wr["slug"]]["to"] == "TE"
        rows2 = {r["role"]: r["players"] for u in season.depth_chart_view(again, me)["units"] for r in u["rows"]}
        assert any(c["slug"] == wr["slug"] and c["moved_from"] == "WR" for c in rows2["TE"])
        # back to receiver: the change is gone
        r = api.call("POST", f"{base}/position", {"team": me, "player": wr["slug"], "pos": "WR"})
        assert r["position"] == "WR" and r["moved_from"] is None and r["overall"] == opts[0]["overall"], r
        assert not season.position_changes(api.loaded_state(), me)
        assert f"{wr['name']}|WR" in api.loaded_state()["season_stats"][me]["players"]
        rows = chart_rows(sid, me)
        assert wr["slug"] in [c["slug"] for c in rows["WR"]] and wr["slug"] not in [c["slug"] for c in rows["TE"]]
        # a defender crossing units, while redshirting: he stays out of the games at his new spot
        fs = next(c for c in rows["FS"] if c["redshirt"]["can"])
        api.call("POST", f"{base}/redshirt", {"team": me, "player": fs["slug"], "on": True})
        r = api.call("POST", f"{base}/position", {"team": me, "player": fs["slug"], "pos": "WR"})
        assert r["position"] == "WR" and r["moved_from"] == "FS"
        st = api.loaded_state()
        assert st["redshirting"][me][fs["slug"]]["position"] == "WR" and (fs["name"], "WR") in season._injured(st, me)
        # the offseason's own change at the "ready" stage (it refused there before)
        finished(st); api._save_loaded()
        off = offseason.start(st)
        assert any(c["id"] == fs["slug"] and c["pos"] == "WR" and c["moved_from"] == "FS" for c in st["league"]["teams"][me]["roster"]), \
            "the season's change did not reach the league"
        off["stage"] = "ready"
        api._save_loaded()
        mover = next(c for c in st["league"]["teams"][me]["roster"] if c["pos"] == "CB")
        v = api.call("POST", f"{base}/offseason/position", {"pid": mover["id"], "pos": "SS"})
        assert mover["pos"] == "SS" and mover["moved_from"] == "CB"
        assert any(m["id"] == mover["id"] and m["to"] == "SS" for m in v["position_changes"])
        api.call("POST", f"{base}/offseason/position", {"pid": mover["id"], "pos": "CB"})
        assert mover["pos"] == "CB" and "moved_from" not in mover and not any(m["id"] == mover["id"] for m in st["offseason"]["position_changes"])
        print(f"position changes any time ok: {wr['name']} WR -> TE at {te['overall']} OVR in week 3, {fs['name']} FS -> WR while redshirting")
    finally:
        season.close_pool()
        shutil.rmtree(seasons_dir, ignore_errors=True)
        shutil.rmtree(coaches_dir, ignore_errors=True)
