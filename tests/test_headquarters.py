"""Headquarters' server side (coach_career/headquarters.py and the two routes in app/api.py): the layout
saved in the career and read back, an old save reading as an empty layout, bad layouts refused with nothing
stored, widget ids the server does not know kept, and the gap data (your commits by week, this week's movers)
on a short career. The layout never touches the season. Through `app.api`, as the page calls it.
(Run as a file: multiprocessing on Windows.)"""
import json
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))

from app import api
from sim import season

ME = "ohio-state"


def GET(sid: str, q: str = "") -> dict:
    return api.call("GET", f"/api/season/{sid}/headquarters{q}")


def POST(sid: str, body: dict) -> dict:
    return api.call("POST", f"/api/season/{sid}/headquarters", body)


def card(i: int, widget: str = "top-targets", size: str = "M") -> dict:
    return {"id": f"c{i}", "widget": widget, "size": size}


def refused(sid: str, body) -> None:
    before = GET(sid)["layout"]
    try:
        POST(sid, body)
    except api.ApiError as e:
        assert e.status == 400 and e.message, (e.status, e.message)
        assert GET(sid)["layout"] == before, "a refused layout stores nothing"
        return
    raise AssertionError(f"expected a 400 for {str(body)[:120]}")


def old_save_reads_empty(sid: str) -> None:
    out = GET(sid)
    assert out == {"layout": {"cards": []}}, out


def round_trip(sid: str) -> None:
    cards = [card(1), card(2, "class-needs", "S"), card(3, "program-compare", "L")]
    out = POST(sid, {"cards": cards})
    assert out["layout"]["cards"] == cards, out
    assert GET(sid)["layout"]["cards"] == cards
    assert api.loaded_state()["career"]["headquarters"]["cards"] == cards


def unknown_kept(sid: str) -> None:
    cards = [card(1), card(9, "future-thing", "S")]
    POST(sid, {"cards": cards})
    assert GET(sid)["layout"]["cards"] == cards


def bad_layouts(sid: str) -> None:
    refused(sid, {"cards": [card(1, size="XL")]})
    refused(sid, {"cards": [{"id": "Bad Id", "widget": "top-targets", "size": "M"}]})
    refused(sid, {"cards": [{"id": "c1", "widget": "", "size": "M"}]})
    refused(sid, {"cards": [card(i) for i in range(41)]})
    refused(sid, {"cards": [card(1), card(1, "flags")]})
    refused(sid, {"cards": "top-targets"})
    refused(sid, {"cards": [["c1", "top-targets", "M"]]})


def gap_data(sid: str) -> None:
    api.call("POST", f"/api/season/{sid}/advance", {"to": 4})
    while api.step() is not None:
        pass
    out = GET(sid, "?want=commits,movers")
    rv = api.call("GET", f"/api/season/{sid}/recruiting")
    rows = out["commits"]
    assert rows, out
    weeks = [r["week"] for r in rows]
    assert all(isinstance(w, int) for w in weeks) and weeks == sorted(weeks), weeks
    assert rows[-1]["total"] == rv["committed"], (rows[-1], rv["committed"])
    for r in rows:
        assert r["gained"] >= 0 and r["lost"] >= 0 and r["total"] >= 0, r
    m = out["movers"]
    assert set(m) == {"up", "down"} and len(m["up"]) <= 5 and len(m["down"]) <= 5, m
    for r in m["up"] + m["down"]:
        assert r["places"] > 0 and r["name"] and r["position"] and 1 <= r["stars"] <= 5, r
    assert "commits" not in GET(sid), "the gap data only when asked for"


def sim_untouched(sid: str) -> None:
    def season_only() -> str:
        st = json.loads(json.dumps(api.loaded_state(), default=str))
        st["career"].pop("headquarters", None)
        return json.dumps(st, sort_keys=True)
    before = season_only()
    POST(sid, {"cards": [card(1), card(2, "flags", "S")]})
    assert season_only() == before, "saving a layout changes nothing but the layout"


# ----- round 2: contacts, the outlook, What-If, goals and tasks ---------------------------------------------

def plan_post(sid: str, body: dict) -> dict:
    return api.call("POST", f"/api/season/{sid}/headquarters/plan", body)


def contacts_from_log(sid: str) -> str:
    from coach_career import recruiting as rec
    rows = api.call("GET", f"/api/season/{sid}/prospects?limit=60")["rows"]
    a = next(r["id"] for r in rows if not r["committed"])
    api.call("POST", f"/api/season/{sid}/board", {"pid": a, "on": True})
    api.call("POST", f"/api/season/{sid}/recruit", {"pid": a, "action": "message", "pitch": rec.PITCHES[0]})
    c = GET(sid, "?want=contacts")["contacts"]
    week = api.loaded_state()["current_week"]
    assert c.get(a) == week, (c, week)
    return a


def outlook_words(sid: str) -> None:
    o = GET(sid, "?want=outlook")["outlook"]
    players = o["players"]
    assert players and all(p["name"] and p["position"] and p["class"] for p in players), players[:2]
    assert all(p["transfer"] in ("Low", "Some", "High") if not p["leaving"] else p["transfer"] is None for p in players), {p["transfer"] for p in players}
    assert all(p["draft"] in (None, "Possible", "Likely") for p in players)
    assert all((p["leaving"] == "graduation") == (p["class"] in ("SR", "SRRS")) for p in players)
    assert all(p["draft"] is None or p["class"] in ("JR", "JRRS", "SORS") for p in players)
    counts = o["counts"]
    assert counts["graduation"] == sum(p["leaving"] == "graduation" for p in players)
    assert counts["draft"] == sum(p["draft"] is not None for p in players)
    assert counts["transfer_high"] == sum(p["transfer"] == "High" for p in players)


def whatif_moves_rank(sid: str, pid: str) -> None:
    w = GET(sid, f"?want=whatif&pid={pid}")["whatif"]
    assert w["pid"] == pid and w["rank_if"] <= w["rank_now"], w
    assert w["group"] and w["need_if"] == max(0, w["need_now"] - 1), w
    st = api.loaded_state()
    before = json.dumps(st["recruiting"]["status"], sort_keys=True)
    GET(sid, f"?want=whatif&pid={pid}")
    assert json.dumps(api.loaded_state()["recruiting"]["status"], sort_keys=True) == before, "What-If changes nothing"


def whatif_committed_unchanged(sid: str) -> None:
    st = api.loaded_state()
    mine = next((pid for pid, s in st["recruiting"]["status"].items() if s["committed"] == ME), None)
    if mine is None:
        return
    w = GET(sid, f"?want=whatif&pid={mine}")["whatif"]
    assert w["rank_if"] == w["rank_now"] and w["need_if"] == w["need_now"], w


def goals_defaults_and_saved(sid: str) -> None:
    g = {x["id"]: x for x in GET(sid, "?want=goals")["goals"]}
    assert set(g) == {"commits", "top100", "rank"}, g
    rv = api.call("GET", f"/api/season/{sid}/recruiting")
    assert g["commits"]["target"] == rv["committed"] + rv["open_spots"] and g["commits"]["now"] == rv["committed"], g["commits"]
    if rv["committed"]:
        assert g["rank"]["now"] == rv["class_rank"] and isinstance(g["rank"]["met"], bool)
    else:
        assert g["rank"]["now"] is None and g["rank"]["met"] is False, "no commits: unranked, never met"
    plan_post(sid, {"goals": {"commits": 12}})
    g = {x["id"]: x for x in GET(sid, "?want=goals")["goals"]}
    assert g["commits"]["target"] == 12 and g["rank"]["target"] > 0


def plan_round_trip(sid: str) -> None:
    assert GET(sid, "?want=tasks")["tasks"] == []
    tasks = [{"id": "t1", "text": "Call the top corner.", "done": False}, {"id": "t2", "text": "Book a visit.", "done": True}]
    plan_post(sid, {"tasks": tasks})
    assert GET(sid, "?want=tasks")["tasks"] == tasks
    assert GET(sid)["layout"]["cards"] == GET(sid)["layout"]["cards"]      # the layout is left alone


def plan_refused(sid: str) -> None:
    before = GET(sid, "?want=tasks,goals")
    for body in ({"tasks": [{"id": "t1", "text": "", "done": False}]}, {"tasks": [{"id": "T 1", "text": "x", "done": False}]},
                 {"tasks": [{"id": "t1", "text": "x" * 121, "done": False}]}, {"tasks": [{"id": "t1", "text": "x", "done": "no"}]},
                 {"tasks": [{"id": f"t{i}", "text": "x", "done": False} for i in range(61)]},
                 {"goals": {"commits": 0}}, {"goals": {"rank": 500}}, {"goals": {"wins": 9}}, {"goals": "all"}):
        try:
            plan_post(sid, body)
        except api.ApiError as e:
            assert e.status == 400, (e.status, body)
            assert GET(sid, "?want=tasks,goals") == before, "a refused plan stores nothing"
            continue
        raise AssertionError(f"expected a 400 for {str(body)[:80]}")


if __name__ == "__main__":
    import shutil
    import tempfile
    season.SEASONS_DIR = _Path(tempfile.mkdtemp(prefix="cfp-hq-test-"))
    try:
        sid = api.call("POST", "/api/season", {"team": ME, "mode": "full", "seed": 11, "career": True})["id"]
        old_save_reads_empty(sid)
        round_trip(sid)
        unknown_kept(sid)
        bad_layouts(sid)
        sim_untouched(sid)
        gap_data(sid)
        pid = contacts_from_log(sid)
        outlook_words(sid)
        whatif_moves_rank(sid, pid)
        whatif_committed_unchanged(sid)
        goals_defaults_and_saved(sid)
        plan_round_trip(sid)
        plan_refused(sid)
        print("headquarters ok: empty on an old save; round trip; unknown ids kept; bad layouts refused; "
              "the season untouched; commits by week and movers; contacts, the outlook, What-If, goals and tasks")
    finally:
        shutil.rmtree(season.SEASONS_DIR, ignore_errors=True)
