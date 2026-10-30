"""The scouting desk (docs/superpowers/specs/2026-10-30-scouting-desk-design.md): the look log
`rc["looks"]` that `look()` keeps for the current and previous week, and the desk view
`GET /api/season/{id}/scouting` built from it, through `app.api` as the page calls it. Covers an
old save without the log, a look that changes nothing, and the portal. (Run as a file.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `from sim import season` works from here

from app import api
from coach_career import prospects
from coach_career import recruiting
from sim import season
from tests.test_offseason import finished

ME = "ohio-state"
ENTRY_KEYS = {"week", "pid", "by", "before", "after", "flags"}
FLAGS = {"gem", "bust", "generational"}
VIEW_KEYS = {"hours", "hours_left", "scouts", "queue", "reports", "flags"}
SCOUT_KEYS = {"id", "name", "role", "evaluation_word", "area", "looking_at", "yield"}
QUEUE_KEYS = {"pid", "name", "position", "stars", "group", "need", "national_rank", "looks", "trips", "potential",
              "can_send", "why", "state"}
GROUP_KEYS = {"scout_id", "scout", "area", "looks", "changed", "items"}
ITEM_KEYS = {"pid", "name", "position", "stars", "change", "flags"}
FLAG_KEYS = {"pid", "name", "position", "stars", "flag", "looks", "standing_word"}


def G(sid: str, path: str) -> dict:
    return api.call("GET", f"/api/season/{sid}/{path}")


def R(sid: str, path: str, body: dict) -> dict:
    return api.call("POST", f"/api/season/{sid}/{path}", body)


def changed(e: dict) -> bool:
    return e["before"] != e["after"] or bool(e["flags"])


def check_entry(e: dict, rc: dict) -> None:
    assert set(e) == ENTRY_KEYS, set(e)
    assert e["pid"] in rc["prospects"]
    assert set(e["flags"]) <= FLAGS
    assert set(e["after"]) == set(recruiting.GROUPS)
    assert set(e["before"]) in (set(), set(recruiting.GROUPS))     # empty before his first look
    for rng_ in list(e["after"].values()) + list(e["before"].values()):
        assert len(rng_) == 2 and all(w in recruiting.WORDS for w in rng_), rng_


def area_pids(st: dict, member: dict) -> set[str]:
    rc = st["recruiting"]
    codes = recruiting.AREAS.get(member.get("area"), [])
    return {pid for pid, p in rc["prospects"].items() if p["hometown"]["state"] in codes
            and not rc["status"][pid]["signed"] and rc["status"][pid]["committed"] != ME}


if __name__ == "__main__":
    import shutil
    import tempfile
    season.SEASONS_DIR = _Path(tempfile.mkdtemp(prefix="cfp-scouting-desk-"))
    try:
        sid = api.call("POST", "/api/season", {"team": ME, "mode": "full", "seed": 11, "career": True})["id"]
        st = api.loaded_state()
        rc = st["recruiting"]
        staff = st["career"]["staff"]
        ids = {m["id"] for m in staff}

        # Review Focus 1: an old save has no log; the desk renders with empty reports
        rc.pop("looks", None)
        v = G(sid, "scouting")
        assert set(v) == VIEW_KEYS, set(v)
        assert v["hours"] == v["hours_left"] > 0
        assert v["reports"] == {"this_week": [], "last_week": []}
        assert [s["id"] for s in v["scouts"]] == [m["id"] for m in staff]
        for s in v["scouts"]:
            assert set(s) == SCOUT_KEYS, set(s)
            assert s["role"] in ("Offensive coordinator", "Defensive coordinator", "Recruiter")
            assert s["evaluation_word"] in recruiting.WORDS
            assert s["area"] in recruiting.AREAS and s["looking_at"] > 0
            assert s["yield"] == {"looks": 0, "narrowed": 0, "flags": 0}
        assert v["queue"] and all(set(r) == QUEUE_KEYS for r in v["queue"])
        assert all(r["can_send"] and r["why"] is None and r["looks"] == 0 and r["potential"] is None for r in v["queue"])
        assert "looks" not in rc, "a read of the desk does not create the log"

        # a week of scouting: one entry per prospect per staffed area, with before (empty: his first look) and after
        recruiting.scout_week(st)
        looks = rc["looks"]
        expected = sum(len(area_pids(st, m)) for m in staff)
        assert len(looks) == expected, (len(looks), expected)
        for e in looks:
            check_entry(e, rc)
            assert e["week"] == 0 and e["by"] in ids and e["before"] == {}
        for m in staff:
            assert {e["pid"] for e in looks if e["by"] == m["id"]} == area_pids(st, m)
        # entries older than last week are dropped at the start of a scouting week
        st["current_week"] = 1
        recruiting.scout_week(st)
        assert {e["week"] for e in rc["looks"]} == {0, 1}
        st["current_week"] = 2
        recruiting.scout_week(st)
        assert {e["week"] for e in rc["looks"]} == {1, 2}
        third = [e for e in rc["looks"] if e["week"] == 2]
        assert all(e["before"] != {} for e in third)
        still = [e for e in third if not changed(e)]
        moved = [e for e in third if changed(e)]
        assert still and moved, (len(still), len(moved))

        # the view: this week's reports group by scout and list only the changed looks; yields count every look
        v = G(sid, "scouting")
        this_week, last_week = v["reports"]["this_week"], v["reports"]["last_week"]
        assert this_week and last_week
        for group in this_week + last_week:
            assert set(group) == GROUP_KEYS, set(group)
            assert group["scout_id"] in ids and group["area"] in recruiting.AREAS
            for it in group["items"]:
                assert set(it) == ITEM_KEYS, set(it)
        assert [g["scout_id"] for g in this_week] == [m["id"] for m in reversed(staff) if any(e["by"] == m["id"] for e in third)]   # newest looks first
        for group in this_week:
            mine = [e for e in third if e["by"] == group["scout_id"]]
            moved_here = [e for e in reversed(mine) if changed(e)]
            assert group["looks"] == len(mine) and group["changed"] == len(moved_here)
            assert len(group["items"]) == min(prospects.REPORT_ITEMS, len(moved_here))
            assert set(it["pid"] for it in group["items"]) <= {e["pid"] for e in moved_here}
            kinds = [0 if it["flags"] else 1 if it["change"].startswith("potential") else 2 for it in group["items"]]
            assert kinds == sorted(kinds), "flags first, then potential, then the rest"
            for it in group["items"]:
                assert it["change"] or it["flags"], it
        assert {e["week"] for g in last_week for e in rc["looks"] if e["pid"] in {it["pid"] for it in g["items"]}} >= {1}
        # Review Focus 2: a look that changed nothing is not reported but counts in the scout's yield
        quiet = still[0]
        group = next(g for g in this_week if g["scout_id"] == quiet["by"])
        assert quiet["pid"] not in {it["pid"] for it in group["items"]}
        card = next(s for s in v["scouts"] if s["id"] == quiet["by"])
        assert card["yield"]["looks"] == group["looks"] == len([e for e in third if e["by"] == quiet["by"]])
        assert card["yield"]["narrowed"] == len([e for e in third if e["by"] == quiet["by"] and e["before"] != e["after"]])
        assert card["yield"]["flags"] == len([e for e in third if e["by"] == quiet["by"] and e["flags"]])
        # the queue: your board first, then the class by need then rank; looks and potential from the reads
        queue = v["queue"]
        first = queue[0]["pid"]
        R(sid, "board", {"pid": queue[5]["pid"], "on": True})
        v = G(sid, "scouting")
        assert v["queue"][0]["pid"] == queue[5]["pid"] and v["queue"][1]["pid"] == first
        rest = v["queue"][1:]
        keys = [(-r["need"], r["national_rank"]) for r in rest]
        assert keys == sorted(keys)
        seen = next(r for r in rest if rc["reads"].get(r["pid"]))
        assert seen["looks"] == rc["reads"][seen["pid"]]["looks"] and seen["potential"] == list(recruiting.grade_range(st, seen["pid"], "potential"))
        assert all(r["state"] == rc["prospects"][r["pid"]]["hometown"]["state"] for r in rest[:50])

        # a scouting trip: the action's response carries the look entry (by "trip"), the log's last
        target = next(r for r in rest if r["can_send"])
        hours = v["hours_left"]
        out = R(sid, "recruit", {"pid": target["pid"], "action": "scout"})
        assert out["hours_left"] == hours - recruiting.HOURS["scout"]
        look = out["look"]
        check_entry(look, rc)
        assert look == rc["looks"][-1] and look["by"] == "trip" and look["pid"] == target["pid"] and look["week"] == 2
        v = G(sid, "scouting")
        trips = next(g for g in v["reports"]["this_week"] if g["scout_id"] == "trip")
        assert trips["looks"] == 1 and trips["area"] is None and (not changed(look) or trips["items"][0]["pid"] == target["pid"])
        row = next(r for r in v["queue"] if r["pid"] == target["pid"])
        assert row["trips"] == 1 and row["can_send"]
        # three trips and a commitment to you leave the queue; short hours gray every row with the reason
        R(sid, "recruit", {"pid": target["pid"], "action": "scout"})
        R(sid, "recruit", {"pid": target["pid"], "action": "scout"})
        yours = rest[1]["pid"]
        recruiting._commit(st, yours, ME)
        v = G(sid, "scouting")
        pids = {r["pid"] for r in v["queue"]}
        assert target["pid"] not in pids and yours not in pids
        assert all(r["can_send"] for r in v["queue"])
        rc["hours"][ME] = recruiting.HOURS["scout"] - 1
        v = G(sid, "scouting")
        assert v["hours_left"] == recruiting.HOURS["scout"] - 1
        assert all(not r["can_send"] and r["why"] == "Not enough hours" for r in v["queue"])
        home = rc["prospects"][yours]["hometown"]["state"]
        area = next(a for a, codes in recruiting.AREAS.items() if home in codes)
        for s in v["scouts"]:
            if s["area"] == area:
                assert s["looking_at"] == len(area_pids(st, {"area": area}))

        # flags: your staff's finds this class, with his looks and where he stands with you
        gem = next(r for r in rest if rc["prospects"][r["pid"]]["stars"] == 3 and rc["reads"].get(r["pid"], {}).get("looks", 0) >= recruiting.FIND_LOOKS)
        rc["reads"][gem["pid"]]["g"]["potential"] = [95.0, 1000.0]
        v = G(sid, "scouting")
        assert all(set(f) == FLAG_KEYS and f["flag"] in FLAGS for f in v["flags"])
        found = next(f for f in v["flags"] if f["pid"] == gem["pid"])
        assert found["flag"] == "gem" and found["looks"] == rc["reads"][gem["pid"]]["looks"] and found["standing_word"]
        # the next look at him reports the gem as a flag gained
        rc["hours"][ME] = 50
        out = R(sid, "recruit", {"pid": gem["pid"], "action": "scout"})
        assert "gem" not in out["look"]["flags"], "a flag already found is not gained again"
        rc["reads"][gem["pid"]]["g"]["potential"] = [70.0, 1000.0]
        before_flag = next(r for r in rest if rc["prospects"][r["pid"]]["stars"] == 3 and r["pid"] != gem["pid"]
                           and rc["reads"].get(r["pid"], {}).get("looks", 0) >= recruiting.FIND_LOOKS and r["can_send"])
        rc["reads"][before_flag["pid"]]["g"]["potential"] = [95.0, 1000.0]
        rc["reads"][before_flag["pid"]]["looks"] = recruiting.FIND_LOOKS - 1       # the trip's look completes the set
        out = R(sid, "recruit", {"pid": before_flag["pid"], "action": "scout"})
        assert out["look"]["flags"] == ["gem"], out["look"]
        item = next(it for g in G(sid, "scouting")["reports"]["this_week"] if g["scout_id"] == "trip" for it in g["items"] if it["pid"] == before_flag["pid"])
        assert item["flags"] == ["gem"]

        # Review Focus 5: the portal's desk lists entrants in the queue and reads its reports the same way
        finished(api.loaded_state()); api._save_loaded()
        G(sid, "offseason")
        while api.loaded_state()["offseason"]["stage"] != "portal_w1":
            R(sid, "offseason/advance", {})
        st = api.loaded_state()
        rc = st["recruiting"]
        assert rc.get("portal") and "looks" not in rc
        v = G(sid, "scouting")
        assert v["queue"] and all(r["pid"] in rc["prospects"] and r["stars"] is None for r in v["queue"])
        assert v["reports"] == {"this_week": [], "last_week": []} and v["flags"] == []
        R(sid, "offseason/advance", {})                # portal week 1 steps: the scouts look at the entrants
        st = api.loaded_state()
        rc = st["recruiting"]
        assert rc["week"] == 2 and rc["looks"] and all(e["week"] == 2 for e in rc["looks"])
        for e in rc["looks"]:
            check_entry(e, rc)
        v = G(sid, "scouting")
        assert v["reports"]["this_week"] and v["reports"]["last_week"] == []
        assert all(it["pid"] in rc["prospects"] for g in v["reports"]["this_week"] for it in g["items"])
        assert sum(g["looks"] for g in v["reports"]["this_week"]) == len(rc["looks"])
        entrant = next(r for r in v["queue"] if r["can_send"])
        out = R(sid, "recruit", {"pid": entrant["pid"], "action": "scout"})
        assert out["look"]["by"] == "trip" and out["look"]["week"] == 2 and out["look"]["flags"] == []
    finally:
        season.close_pool()
        shutil.rmtree(season.SEASONS_DIR, ignore_errors=True)
    print("ok")
