"""Your weekly contacts and your hand on an offer are yours (recruiting.contact_week, manual_offers):
- you may Message and Call each recruit once a week, in the week you are playing; Auto-recruit's
  contacts in a week step count against the week that step closes, never the one you are about to play
  (mode "week" and "season"), and the board's done_this_week agrees with the server;
- a second call in one week is refused, and next week it is allowed; a call you open and never finish
  closes at the week step and does not block the next week's call;
- in the transfer portal the season's week stands still, so the rule runs on the portal's own week:
  a recruit you called in portal week 1 can be called again in week 2;
- an offer you raise by hand (one Auto-recruit made, or your own) keeps your NIL through Auto's weeks,
  even in a group at its cap, where Auto pulls its own offers (and in the portal re-offers at its number);
- an old save with a call left open from an earlier week, or portal marks from the season's frozen
  week, heals on load.
Through `app.api`, as the page calls it. (Run as a file: multiprocessing on Windows.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))
_sys.path.insert(0, str(_Path(__file__).resolve().parent))

from app import api
from coach_career import offseason
from coach_career import recruiting as rec
from sim import season

ME = "ohio-state"


def G(sid: str, path: str) -> dict:
    return api.call("GET", f"/api/season/{sid}/{path}")


def R(sid: str, path: str, body: dict) -> dict:
    return api.call("POST", f"/api/season/{sid}/{path}", body)


def refused(fn, code: int, words: str) -> None:
    try:
        fn()
    except api.ApiError as e:
        assert e.status == code and words in e.message, (e.status, e.message)
        return
    raise AssertionError(f"expected {code} {words}")


def advance_one(sid: str) -> None:
    """One week through the dispatcher, as the page plays it (Advance, then step())."""
    R(sid, "advance", {"to": api.loaded_state()["current_week"] + 1})
    while api.step() is not None and api.running():
        pass


def row(sid: str, pid: str) -> dict:
    return next(b for b in G(sid, "recruiting")["board"] if b["id"] == pid)


def contact(sid: str, pid: str, action: str, **kw) -> dict:
    return R(sid, "recruit", {"pid": pid, "action": action, **kw})


def staff_contacted(st: dict) -> list[str]:
    """Your recruits Auto-recruit called or messaged in the step just run (uncommitted, unsigned)."""
    rc = st["recruiting"]
    return [pid for pid, by in rc["contacts"].items() if (by.get(ME) or {}).get("week")
            and not rc["status"][pid]["signed"] and rc["status"][pid]["committed"] in (None, ME)]


def cap_group(st: dict, group: str, skip: set) -> None:
    """Commit uncommitted prospects of `group` to you until your commits there reach its cap."""
    rc = st["recruiting"]
    pool = [q for q, p in sorted(rc["prospects"].items(), key=lambda kv: kv[1]["rank"])
            if rec._group_of(p) == group and q not in skip and rc["status"][q]["committed"] is None
            and not any(q in pids for pids in rc["offers"].values())]
    while rec.commits_by_group(st, ME)[group] < rec.group_cap(rec.needs(st, ME), group):
        q = pool.pop(0)
        rc["status"][q].update(committed=ME, firmness=rec.FIRM_START, hard=False)
        rc["commits_v"] = rc.get("commits_v", 0) + 1


def season_part(sid: str) -> None:
    st = api.loaded_state()
    rc = st["recruiting"]
    pitch = rec.PITCHES[0]
    # ----- Auto-recruit "season" and then "week" works your recruits in the step: your new week is still yours -----
    for mode in ("season", "week"):
        assert R(sid, "settings", {"auto_recruit": mode})["auto_recruit"] == mode
        advance_one(sid)
        st = api.loaded_state()
        rc = st["recruiting"]
        assert rec.auto_mode(st) == ("season" if mode == "season" else "off")
        worked = staff_contacted(st)
        assert worked, f"Auto-recruit ({mode}) called or messaged nobody"
        R(sid, "settings", {"auto_recruit": "off"})
        pid = worked[0]
        assert row(sid, pid)["done_this_week"] == [], f"Auto ({mode}): the board says this week's contacts are used up"
        contact(sid, pid, "message", pitch=pitch)
        contact(sid, pid, "call", pitch=pitch)
        assert sorted(row(sid, pid)["done_this_week"]) == ["call", "message"]
        refused(lambda: contact(sid, pid, "message", pitch=pitch), 409, "already messaged")
        refused(lambda: contact(sid, pid, "call", pitch=pitch), 409, "already called")
    # ----- your contact and Auto's in the same week: Auto does not contact him a second time -----
    pid = worked[1] if len(worked) > 1 else worked[0]
    st, rc = api.loaded_state(), api.loaded_state()["recruiting"]
    if (rc["contacts"][pid][ME].get("week") or {}).get("message") != rec.contact_week(st):
        contact(sid, pid, "message", pitch=pitch)
    marks = dict(rc["contacts"][pid][ME]["week"])
    R(sid, "settings", {"auto_recruit": "week"})
    advance_one(sid)
    rc = api.loaded_state()["recruiting"]
    assert rc["contacts"][pid][ME]["week"].get("message") == marks["message"], "Auto messaged him again the week you did"
    # ----- a call twice in one week is refused; one opened and left alone closes at the step -----
    st = api.loaded_state()
    rc = st["recruiting"]
    fresh = [q for q in rec.prospect_list(st) if not rc["status"][q]["committed"] and not rc["status"][q]["signed"]
             and ME not in rc["contacts"].get(q, {}) and not rec.would_pester(st, ME, q)]
    a, b = fresh[0], fresh[1]
    rc["hours"][ME] = 200
    R(sid, "board", {"pid": a, "on": True})
    R(sid, "board", {"pid": b, "on": True})
    contact(sid, a, "call", pitch=pitch)
    refused(lambda: contact(sid, a, "call", pitch=pitch), 409, "already called")
    opened = contact(sid, b, "call")
    assert opened.get("scene") and row(sid, b)["scene"], "a call with no pitch opens a scene"
    refused(lambda: contact(sid, b, "call"), 409, "already called")
    advance_one(sid)                           # Auto is off: only the step runs
    st = api.loaded_state()
    rc = st["recruiting"]
    assert not (rc.get("scenes") or {}).get(ME, {}).get(b), "the abandoned call outlived the week"
    assert row(sid, b)["scene"] is None and row(sid, b)["done_this_week"] == []
    rc["hours"][ME] = 200
    contact(sid, a, "call", pitch=pitch)
    assert contact(sid, b, "call").get("scene"), "next week's call to the one you hung up on"
    # ----- NIL you set by hand stays: an Auto offer you raised, and an offer of your own -----
    rc["hours"][ME] = 200
    kept = set(rc.get("manual_offers") or ())
    auto_offer = next(q for q in rc["offers"][ME] if q not in kept and rc["status"][q]["committed"] is None
                      and not rc["status"][q]["signed"])
    rc["nil"][ME]["held"].pop(auto_offer, None)     # Auto's offer at 0 NIL, as the player saw it
    group = rec._group_of(rc["prospects"][auto_offer])
    own = next(q for q in rec.prospect_list(st) if rc["status"][q]["committed"] is None and not rc["status"][q]["signed"]
               and q not in rc["offers"][ME] and rec._group_of(rc["prospects"][q]) == group)
    R(sid, "board", {"pid": own, "on": True})
    rc["nil"][ME]["budget"] += 80 + max(0, -rec.nil_left(st, ME))
    contact(sid, own, "offer", pitch=pitch, nil=0)
    contact(sid, auto_offer, "raise_nil", nil=40)
    contact(sid, own, "raise_nil", nil=40)
    assert {auto_offer, own} <= set(rc["manual_offers"]), "a raise by hand marks the offer as yours"
    cap_group(st, group, {auto_offer, own})          # a group at its cap: Auto pulls the offers it made there
    for mode in ("season", "week"):
        R(sid, "settings", {"auto_recruit": mode})
        advance_one(sid)
        rc = api.loaded_state()["recruiting"]
        for q in (auto_offer, own):
            if rc["status"][q]["signed"] or rc["status"][q]["committed"] not in (None, ME):
                continue                             # a signing or a commitment elsewhere still ends it
            assert q in rc["offers"][ME], f"Auto ({mode}) pulled the offer you raised to {q}"
            assert rc["nil"][ME]["held"].get(q) == 40, f"Auto ({mode}) reset the NIL you set on {q}: {rc['nil'][ME]['held'].get(q)}"
    R(sid, "settings", {"auto_recruit": "off"})


def heal_part(sid: str) -> None:
    """An old save: a call left open from an earlier week, and a mark the old code stamped with the
    week you are playing (Auto's, in the step), load as a fresh week."""
    st = api.loaded_state()
    rc = st["recruiting"]
    pid = next(q for q in rec.prospect_list(st) if not rc["status"][q]["signed"] and rc["status"][q]["committed"] in (None, ME))
    R(sid, "board", {"pid": pid, "on": True})
    c = rc["contacts"].setdefault(pid, {}).setdefault(ME, {"n": 1, "hc_week": None})
    c["week"] = {"message": st["current_week"], "call": st["current_week"]}      # the old stamp: the week you are playing
    rc.setdefault("scenes", {}).setdefault(ME, {})[pid] = {"id": "old", "action": "call", "week": st["current_week"] - 1,
                                                             "turns": [], "lines": []}
    season.save_season(st)
    healed = season.load_season(sid)
    assert pid not in (healed["recruiting"].get("scenes") or {}).get(ME, {}), "the call left open from an earlier week survived the load"
    api._loaded = None                                  # the page reloads the career from its file
    assert row(sid, pid)["scene"] is None and row(sid, pid)["done_this_week"] == []
    api.loaded_state()["recruiting"]["hours"][ME] = 200
    contact(sid, pid, "message", pitch=rec.PITCHES[0])
    assert contact(sid, pid, "call").get("scene")


def portal_part(sid: str) -> None:
    from test_offseason import finished
    st = api.loaded_state()
    finished(st)
    offseason.start(st)
    api._save_loaded()
    while api.loaded_state()["offseason"]["stage"] != "portal_w1":
        api.call("POST", f"/api/season/{sid}/offseason/advance", {})
    st = api.loaded_state()
    rc = st["recruiting"]
    assert rec.is_portal(st) and rc["week"] == 1
    pid = next(q for q in rec.prospect_list(st) if not rec.would_pester(st, ME, q))
    R(sid, "board", {"pid": pid, "on": True})
    contact(sid, pid, "message", pitch=rec.PITCHES[0])
    assert contact(sid, pid, "call").get("scene")               # opened and left
    refused(lambda: contact(sid, pid, "call"), 409, "already called")
    assert sorted(row(sid, pid)["done_this_week"]) == ["call", "message"]
    R(sid, "settings", {"auto_recruit": "season"})
    api.call("POST", f"/api/season/{sid}/offseason/advance", {})
    R(sid, "settings", {"auto_recruit": "off"})
    st = api.loaded_state()
    rc = st["recruiting"]
    assert rc["week"] == 2 and st["current_week"] == season.FINAL_WEEK
    assert row(sid, pid)["done_this_week"] == [], "portal week 2: last week's contacts still count"
    rc["hours"][ME] = 200
    contact(sid, pid, "message", pitch=rec.PITCHES[0])
    assert contact(sid, pid, "call").get("scene"), "portal week 2: you could not call him again"
    # an old portal save: marks from the season's frozen week heal on load
    other = next(q for q in rec.prospect_list(st) if q != pid)
    rc["contacts"].setdefault(other, {}).setdefault(ME, {"n": 1, "hc_week": None})["week"] = {"call": season.FINAL_WEEK}
    season.save_season(st)
    healed = season.load_season(sid)
    assert "call" not in healed["recruiting"]["contacts"][other][ME]["week"]


if __name__ == "__main__":
    import shutil
    import tempfile
    season.SEASONS_DIR = _Path(tempfile.mkdtemp(prefix="cfp-contact-limits-test-"))
    try:
        sid = api.call("POST", "/api/season", {"team": ME, "mode": "full", "seed": 11, "career": True})["id"]
        season_part(sid)
        heal_part(sid)
        portal_part(sid)
        print("test_contact_limits: ok")
    finally:
        shutil.rmtree(season.SEASONS_DIR, ignore_errors=True)
