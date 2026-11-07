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
        print("headquarters ok: empty on an old save; round trip; unknown ids kept; bad layouts refused; "
              "the season untouched; commits by week and movers")
    finally:
        shutil.rmtree(season.SEASONS_DIR, ignore_errors=True)
