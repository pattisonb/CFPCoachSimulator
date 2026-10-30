"""The scouting desk (docs/superpowers/specs/2026-10-30-scouting-desk-design.md): the look log
`rc["looks"]` (the looks that changed a grade word or gained a flag, with the groups that changed)
and the tally `rc["look_counts"]` that `look()` keeps for the current and previous week, and the
desk view `GET /api/season/{id}/scouting` built from them, through `app.api` as the page calls
it. Covers an old save without the log, a look that changes nothing, the queue's paging and
filters, and the portal. (Run as a file.)"""
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
FLAGS = {"gem", "bust", "generational", "likes"}      # "likes": prospects.staff_likes, the Flags list's fourth kind
VIEW_KEYS = {"hours", "hours_left", "scouts", "queue", "queue_total", "reports", "flags"}
SCOUT_KEYS = {"id", "name", "role", "evaluation_word", "area", "looking_at", "yield", "contract_until"}
QUEUE_KEYS = {"pid", "name", "position", "stars", "group", "need", "national_rank", "looks", "trips", "potential",
              "can_send", "why", "state", "likes"}
GROUP_KEYS = {"scout_id", "scout", "area", "looks", "changed", "items"}
ITEM_KEYS = {"pid", "name", "position", "stars", "change", "flags", "likes"}
FLAG_KEYS = {"pid", "name", "position", "stars", "flag", "looks", "standing_word", "likes"}


def G(sid: str, path: str) -> dict:
    return api.call("GET", f"/api/season/{sid}/{path}")


def R(sid: str, path: str, body: dict) -> dict:
    return api.call("POST", f"/api/season/{sid}/{path}", body)


def check_entry(e: dict, rc: dict) -> None:
    assert set(e) == ENTRY_KEYS, set(e)
    assert e["pid"] in rc["prospects"]
    assert set(e["flags"]) <= FLAGS
    assert set(e["before"]) <= set(e["after"]) <= set(recruiting.GROUPS), (e["before"], e["after"])   # only the groups that changed
    for g, after in e["after"].items():
        assert after != e["before"].get(g)
    for rng_ in list(e["after"].values()) + list(e["before"].values()):
        assert len(rng_) == 2 and all(w in recruiting.WORDS for w in rng_), rng_


def area_pids(st: dict, member: dict) -> set[str]:
    rc = st["recruiting"]
    codes = recruiting.AREAS.get(member.get("area"), [])
    return {pid for pid, p in rc["prospects"].items() if p["hometown"]["state"] in codes
            and not rc["status"][pid]["signed"] and rc["status"][pid]["committed"] != ME}


def trips_of(rc: dict, pid: str) -> int:
    return ((rc["contacts"].get(pid) or {}).get(ME) or {}).get("scouted", 0)


def scoutable(st: dict, pid: str) -> bool:
    rc = st["recruiting"]
    s = rc["status"][pid]
    return not s["signed"] and s["committed"] != ME and not recruiting.report_complete(rc["reads"].get(pid)) and pid in recruiting.visible(st)


def watching(st: dict, member: dict) -> set[str]:
    """The prospects in his area his weekly look still adds to (under AREA_CAP from the area, report not complete)."""
    return {pid for pid in area_pids(st, member) if recruiting.area_open(st["recruiting"]["reads"].get(pid))}


HALF = recruiting.AREA_LOOK          # an area scout's week is half a look: the tallies count looks in trip units


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
        rc.pop("looks", None); rc.pop("look_counts", None); rc.pop("look_changes", None)
        v = G(sid, "scouting")
        assert set(v) == VIEW_KEYS, set(v)
        assert v["hours"] == v["hours_left"] > 0
        assert v["reports"] == {"this_week": [], "last_week": []}
        assert [s["id"] for s in v["scouts"]] == [m["id"] for m in staff]
        for s in v["scouts"]:
            assert set(s) == SCOUT_KEYS, set(s)
            assert s["role"] in ("Offensive Coordinator", "Defensive Coordinator", "Recruiter")
            assert s["evaluation_word"] in recruiting.WORDS
            assert s["area"] in recruiting.AREAS and s["looking_at"] > 0
            assert s["yield"] == {"looks": 0, "narrowed": 0, "flags": 0}
        assert len(v["queue"]) == prospects.QUEUE_LIMIT and v["queue_total"] > 3000 and all(set(r) == QUEUE_KEYS for r in v["queue"])
        assert all(r["can_send"] and r["why"] is None and r["looks"] == 0 and r["potential"] is None for r in v["queue"])
        assert "looks" not in rc and "look_counts" not in rc and "look_changes" not in rc, "a read of the desk does not create the log"

        # a week of scouting: every look counted (half a look each, in trip units); a first look changes his words, so
        # every one is a change and the log keeps each scout's LOOK_LOG_KEEP most notable (every look is a first read here)
        recruiting.scout_week(st)
        looks, counts, changes = rc["looks"], rc["look_counts"], rc["look_changes"]
        assert set(counts) == set(changes) == {"0"} and counts["0"] == {m["id"]: HALF * len(area_pids(st, m)) for m in staff}
        assert all(r["looks"] == r["area"] == HALF for r in rc["reads"].values())
        assert changes["0"] == {m["id"]: {"changed": len(area_pids(st, m)), "flags": 0} for m in staff}
        assert len(looks) == len(staff) * recruiting.LOOK_LOG_KEEP
        for e in looks:
            check_entry(e, rc)
            assert e["week"] == 0 and e["by"] in ids and e["before"] == {} and set(e["after"]) == set(recruiting.GROUPS)
        for m in staff:
            kept = [e for e in looks if e["by"] == m["id"]]
            assert len(kept) == recruiting.LOOK_LOG_KEEP and {e["pid"] for e in kept} <= area_pids(st, m)
        # entries and tallies older than last week are dropped at the start of a scouting week
        st["current_week"] = 1
        recruiting.scout_week(st)
        assert {e["week"] for e in rc["looks"]} == {0, 1} and set(rc["look_counts"]) == set(rc["look_changes"]) == {"0", "1"}
        st["current_week"] = 2
        recruiting.scout_week(st)
        assert {e["week"] for e in rc["looks"]} == {1, 2} and set(rc["look_counts"]) == set(rc["look_changes"]) == {"1", "2"}
        third = [e for e in rc["looks"] if e["week"] == 2]
        tally, moved = rc["look_counts"]["2"], rc["look_changes"]["2"]
        assert all(set(e["before"]) == set(e["after"]) and (e["after"] or e["flags"]) for e in third)
        quiet = sum(tally.values()) / HALF - sum(c["changed"] for c in moved.values())    # the tally is in looks, a week's look is half
        assert quiet > 0 and third, (quiet, len(third))
        for by, c in moved.items():       # the kept looks: flags first, so a scout's flagged looks are all there up to the cap
            kept = [e for e in third if e["by"] == by]
            assert len(kept) == min(recruiting.LOOK_LOG_KEEP, c["changed"])
            assert len([e for e in kept if e["flags"]]) == min(recruiting.LOOK_LOG_KEEP, c["flags"])

        # the view: this week's reports group by scout and list only the changed looks; yields count every look, in trip units
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
            mine = [e for e in reversed(third) if e["by"] == group["scout_id"]]
            assert group["looks"] == tally[group["scout_id"]] and group["changed"] == moved[group["scout_id"]]["changed"] >= len(mine)
            assert len(group["items"]) == min(prospects.REPORT_ITEMS, len(mine)) == len(mine)
            assert set(it["pid"] for it in group["items"]) == {e["pid"] for e in mine}
            kinds = [0 if it["flags"] else 1 if it["change"].startswith("potential") else 2 for it in group["items"]]
            assert kinds == sorted(kinds), "flags first, then potential, then the rest"
            for it in group["items"]:
                assert it["change"] or it["flags"], it
        # Review Focus 2: a look that changed nothing is not logged or reported but counts in the scout's yield
        for card in v["scouts"]:
            assert card["yield"]["looks"] == tally.get(card["id"], 0)
            assert card["yield"]["narrowed"] == moved.get(card["id"], {}).get("changed", 0)
            assert card["yield"]["flags"] == moved.get(card["id"], {}).get("flags", 0)
        assert any(c["yield"]["looks"] / HALF > c["yield"]["narrowed"] for c in v["scouts"])
        quiet_scout = next(c for c in v["scouts"] if c["yield"]["looks"] / HALF > c["yield"]["narrowed"])
        group = next(g for g in this_week if g["scout_id"] == quiet_scout["id"])
        assert group["looks"] / HALF > group["changed"] >= len(group["items"])
        assert all(r["looks"] == 1.5 and r["area"] == 1.5 for r in rc["reads"].values()), "three weeks in an area: 1.5 of 3"

        # the queue: a page of your board first, then the class by need then rank; looks and potential from the reads
        queue, total = v["queue"], v["queue_total"]
        first = queue[0]["pid"]
        R(sid, "board", {"pid": queue[5]["pid"], "on": True})
        v = G(sid, "scouting")
        assert v["queue"][0]["pid"] == queue[5]["pid"] and v["queue"][1]["pid"] == first and v["queue_total"] == total
        rest = v["queue"][1:]
        keys = [(-r["need"], r["national_rank"]) for r in rest]
        assert keys == sorted(keys)
        seen = next(r for r in rest if rc["reads"].get(r["pid"]))
        assert seen["looks"] == rc["reads"][seen["pid"]]["looks"] and seen["potential"] == list(recruiting.grade_range(st, seen["pid"], "potential"))
        assert all(r["state"] == rc["prospects"][r["pid"]]["hometown"]["state"] for r in rest)
        # paging and filters: offset and limit (capped), a name or state search, position, group
        page2 = G(sid, "scouting?offset=120&limit=10")
        assert len(page2["queue"]) == 10 and page2["queue_total"] == total
        whole = G(sid, "scouting?limit=1000")
        assert len(whole["queue"]) == prospects.QUEUE_MAX
        assert whole["queue"][:120] == v["queue"] and whole["queue"][120:130] == page2["queue"]
        tx = G(sid, "scouting?q=tx")
        assert 0 < tx["queue_total"] < total and all(r["state"] == "TX" for r in tx["queue"])
        assert tx["queue_total"] == sum(1 for pid in rc["prospects"] if scoutable(st, pid) and rc["prospects"][pid]["hometown"]["state"] == "TX")
        name = rest[3]["name"].split()[-1]
        named = G(sid, f"scouting?q={name.upper()}")
        assert rest[3]["pid"] in {r["pid"] for r in named["queue"]} and all(name.lower() in r["name"].lower() for r in named["queue"])
        qb = G(sid, "scouting?position=qb&limit=400")
        assert qb["queue"] and all(r["position"] == "QB" for r in qb["queue"])
        assert qb["queue_total"] == sum(1 for pid in rc["prospects"] if scoutable(st, pid) and rc["prospects"][pid]["position"] == "QB")
        ol = G(sid, "scouting?group=OL&limit=5")
        assert len(ol["queue"]) == 5 and all(r["group"] == "OL" for r in ol["queue"])
        assert G(sid, "scouting?q=zzzzzz")["queue"] == [] and G(sid, "scouting?q=zzzzzz")["queue_total"] == 0

        # a scouting trip: the action's response carries the look entry (by "trip"), logged when it changed something
        target = next(r for r in rest if r["can_send"])
        hours = v["hours_left"]
        out = R(sid, "recruit", {"pid": target["pid"], "action": "scout"})
        assert out["hours_left"] == hours - recruiting.HOURS["scout"]
        assert "likes" in out["look"], out["look"]      # a Send also returns the like a completed report earned (prospects.staff_likes)
        look = {k: v for k, v in out["look"].items() if k != "likes"}     # the logged entry itself
        check_entry(look, rc)
        assert look["by"] == "trip" and look["pid"] == target["pid"] and look["week"] == 2
        assert rc["look_counts"]["2"]["trip"] == 1
        assert (look in rc["looks"]) == bool(look["after"] or look["flags"]) == ("trip" in rc["look_changes"]["2"])
        v = G(sid, "scouting")
        trips = next(g for g in v["reports"]["this_week"] if g["scout_id"] == "trip")
        assert trips["looks"] == 1 and trips["area"] is None and trips["scout"] == "Your trips"
        assert trips["changed"] == len(trips["items"]) == (1 if look["after"] or look["flags"] else 0)
        row = next(r for r in v["queue"] if r["pid"] == target["pid"])
        assert row["trips"] == 1 and row["can_send"] and row["looks"] == rc["reads"][target["pid"]]["looks"] in (1, 2.5)
        # a complete report (a Send adds a look, or the half that is left) and a commitment to you leave the queue; short
        # hours gray every row with the reason
        while not recruiting.report_complete(rc["reads"][target["pid"]]):
            R(sid, "recruit", {"pid": target["pid"], "action": "scout"})
        assert rc["reads"][target["pid"]]["looks"] == 3 and trips_of(rc, target["pid"]) in (2, 3)
        try:
            R(sid, "recruit", {"pid": target["pid"], "action": "scout"}); raise AssertionError("a Send on a complete report")
        except Exception as e:  # noqa: BLE001
            assert "his report is complete: 3 of 3 looks" in str(e), str(e)
        yours = rest[1]["pid"]
        recruiting._commit(st, yours, ME)
        v = G(sid, "scouting?limit=400")
        pids = {r["pid"] for r in v["queue"]}
        assert target["pid"] not in pids and yours not in pids and v["queue_total"] == total - 2
        assert all(r["can_send"] for r in v["queue"])
        # on your board his complete report stays in the queue (nothing to send: the Complete tag's text as `why`), after
        # the board's open reports, his potential one final grade word; off the board again he is out
        R(sid, "board", {"pid": target["pid"], "on": True})
        v = G(sid, "scouting?limit=400")
        rows = v["queue"]
        assert v["queue_total"] == total - 1 and set(rows[0]) == QUEUE_KEYS
        i = next(i for i, r in enumerate(rows) if r["pid"] == target["pid"])
        assert all(r["pid"] in rc["board"] for r in rows[:i + 1]) and all(r["looks"] < 3 for r in rows[:i]), [r["pid"] for r in rows[:i + 1]]
        assert rows[i]["looks"] == 3 and rows[i]["can_send"] is False and rows[i]["why"] == prospects.REPORT_COMPLETE, rows[i]
        assert rows[i]["potential"][0] == rows[i]["potential"][1] in recruiting.WORDS, rows[i]["potential"]
        assert all(r["can_send"] and r["looks"] < 3 for r in rows[i + 1:])
        R(sid, "board", {"pid": target["pid"], "on": False})
        assert target["pid"] not in {r["pid"] for r in G(sid, "scouting?limit=400")["queue"]}
        rc["hours"][ME] = recruiting.HOURS["scout"] - 1
        v = G(sid, "scouting")
        assert v["hours_left"] == recruiting.HOURS["scout"] - 1
        assert all(not r["can_send"] and r["why"] == "Not enough hours" for r in v["queue"])
        home = rc["prospects"][yours]["hometown"]["state"]
        area = next(a for a, codes in recruiting.AREAS.items() if home in codes)
        for s in v["scouts"]:
            if s["area"] == area:
                assert s["looking_at"] == len(watching(st, {"area": area})) < len(area_pids(st, {"area": area}))

        # flags: your staff's finds this class, with his looks and where he stands with you; a flag waits for a complete report
        threes = [pid for pid, p in rc["prospects"].items() if p["stars"] == 3 and scoutable(st, pid) and pid in rc["reads"]]
        gem = threes[0]
        gem_cut = recruiting.flag_cuts(rc)[3][0]                     # the gem cut is relative to his star tier
        rc["reads"][gem]["g"]["potential"] = [gem_cut + 1.0, 1000.0]
        assert rc["reads"][gem]["looks"] == 1.5 and gem not in {f["pid"] for f in G(sid, "scouting")["flags"]}, "no flag before the report is complete"
        rc["reads"][gem]["looks"] = recruiting.FIND_LOOKS
        v = G(sid, "scouting")
        assert all(set(f) == FLAG_KEYS and f["flag"] in FLAGS for f in v["flags"])
        found = next(f for f in v["flags"] if f["pid"] == gem)
        assert found["flag"] == "gem" and found["looks"] == rc["reads"][gem]["looks"] == 3 and found["standing_word"]
        assert gem not in {r["pid"] for r in G(sid, "scouting?limit=400")["queue"]}, "a complete report is out of the queue"
        rc["hours"][ME] = 50
        rc["reads"][gem]["g"]["potential"] = [70.0, 1000.0]
        before_flag = threes[1]
        rc["reads"][before_flag]["g"]["potential"] = [gem_cut + 1.0, 1000.0]
        rc["reads"][before_flag]["looks"] = recruiting.FIND_LOOKS - 1       # the trip's look completes the report
        out = R(sid, "recruit", {"pid": before_flag, "action": "scout"})
        assert out["look"]["flags"] == ["gem"], out["look"]
        item = next(it for g in G(sid, "scouting")["reports"]["this_week"] if g["scout_id"] == "trip" for it in g["items"] if it["pid"] == before_flag)
        assert item["flags"] == ["gem"]

        # Review Focus 5: the portal's desk lists entrants in the queue and reads its reports the same way
        finished(api.loaded_state()); api._save_loaded()
        G(sid, "offseason")
        while api.loaded_state()["offseason"]["stage"] != "portal_w1":
            R(sid, "offseason/advance", {})
        st = api.loaded_state()
        rc = st["recruiting"]
        assert rc.get("portal") and "looks" not in rc and "look_counts" not in rc and "look_changes" not in rc
        v = G(sid, "scouting")
        assert v["queue"] and all(r["pid"] in rc["prospects"] and r["stars"] is None for r in v["queue"])
        assert v["reports"] == {"this_week": [], "last_week": []} and v["flags"] == []
        R(sid, "offseason/advance", {})                # portal week 1 steps: the scouts look at the entrants
        st = api.loaded_state()
        rc = st["recruiting"]
        assert rc["week"] == 2 and rc["looks"] and all(e["week"] == 2 for e in rc["looks"]) and set(rc["look_counts"]) == {"2"}
        assert len(rc["looks"]) <= len(staff) * recruiting.LOOK_LOG_KEEP
        for e in rc["looks"]:
            check_entry(e, rc)
        v = G(sid, "scouting")
        assert v["reports"]["this_week"] and v["reports"]["last_week"] == []
        assert all(it["pid"] in rc["prospects"] for g in v["reports"]["this_week"] for it in g["items"])
        assert sum(g["looks"] for g in v["reports"]["this_week"]) == sum(rc["look_counts"]["2"].values())
        entrant = next(r for r in v["queue"] if r["can_send"])
        out = R(sid, "recruit", {"pid": entrant["pid"], "action": "scout"})
        assert out["look"]["by"] == "trip" and out["look"]["week"] == 2 and out["look"]["flags"] == []
    finally:
        season.close_pool()
        shutil.rmtree(season.SEASONS_DIR, ignore_errors=True)
    print("ok")
