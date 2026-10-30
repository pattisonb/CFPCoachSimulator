"""Looks in trip units: a full scouting report is REPORT_LOOKS = 3 looks and nothing goes past it.
A Send (a scouting trip, 5 hours) adds one look; an area scout's weekly look adds AREA_LOOK = 0.5,
up to AREA_CAP = 2.0 from his area, so four weeks in an area leave one trip to finish him. Old
saves with a read past 3 and no area tally read as complete without error. (Run as a file.)"""
import copy
import random
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `from sim import season` works from here

from coach_career import prospects
from coach_career import recruiting
from sim import season

ME = "ohio-state"


def area_of(st: dict, pid: str):
    home = st["recruiting"]["prospects"][pid]["hometown"]["state"]
    return next((a for a, codes in recruiting.AREAS.items() if home in codes), None)


def week_of_looks(st: dict, week: int) -> None:
    st["current_week"] = week
    recruiting.scout_week(st)


def send(st: dict, pid: str):
    st["recruiting"]["hours"][ME] = 100
    return recruiting.act(st, ME, pid, "scout")


if __name__ == "__main__":
    assert recruiting.REPORT_LOOKS == 3 and recruiting.AREA_LOOK == 0.5 and recruiting.AREA_CAP == 2.0
    assert recruiting.FIND_LOOKS == prospects.OUR_COMP_LOOKS == recruiting.REPORT_LOOKS, "every scouting badge waits for a complete report"
    st = season.new_season(ME, "full", seed=7, career=True)
    rc = st["recruiting"]
    staff = st["career"]["staff"]
    for p in rc["prospects"].values():
        p["hidden"] = False
    staffed = {m["area"] for m in staff}
    live = lambda pid: not rc["status"][pid]["signed"] and rc["status"][pid]["committed"] != ME
    inside = next(pid for pid in rc["prospects"] if live(pid) and area_of(st, pid) in staffed)
    outside = next(pid for pid in rc["prospects"] if live(pid) and area_of(st, pid) not in staffed)
    scout = next(m for m in staff if m["area"] == area_of(st, inside))

    # a week in a scout's area is half a look, in both the read and his tally; the queue shows the half
    week_of_looks(st, 0)
    read = rc["reads"][inside]
    assert read["looks"] == 0.5 and read["area"] == 0.5, read
    assert outside not in rc["reads"]
    assert rc["look_counts"]["0"][scout["id"]] == 0.5 * sum(1 for pid in rc["prospects"] if live(pid) and area_of(st, pid) == scout["area"])
    rc["board"] = [inside]                      # the board heads the queue, so his row is on the first page
    v = prospects.scouting_view(st)
    row_in = v["queue"][0]
    assert row_in["pid"] == inside and row_in["looks"] == 0.5 and row_in["can_send"], row_in
    assert next(s for s in v["scouts"] if s["id"] == scout["id"])["yield"]["looks"] == rc["look_counts"]["0"][scout["id"]]
    assert prospects.row(st, inside, ME)["looks"] == 0.5 and prospects.profile(st, inside, ME)["looks"] == 0.5

    # a half look moves the read half as far: the same draws, half the precision gained
    full, half = copy.deepcopy(st), copy.deepcopy(st)
    recruiting.look(full, inside, 80, random.Random(5))
    recruiting.look(half, inside, 80, random.Random(5), weight=recruiting.AREA_LOOK)
    before = rc["reads"][inside]["g"]["potential"]
    gf, gh = full["recruiting"]["reads"][inside]["g"]["potential"], half["recruiting"]["reads"][inside]["g"]["potential"]
    assert abs((gh[1] - before[1]) * 2 - (gf[1] - before[1])) < 1e-3, (before, gf, gh)
    assert abs(gh[0] - before[0]) < abs(gf[0] - before[0]), (before, gf, gh)
    assert full["recruiting"]["reads"][inside]["looks"] == 1.5 and half["recruiting"]["reads"][inside]["looks"] == 1.0

    # four weeks in an area: 2 of 3, the area's share capped; a fifth week adds nothing and is not counted
    for w in (1, 2, 3):
        week_of_looks(st, w)
    assert read["looks"] == 2.0 and read["area"] == 2.0, read
    assert not prospects.row(st, inside, ME)["scouted"] and prospects.find(st, inside) is None
    week_of_looks(st, 4)
    assert read["looks"] == 2.0 and read["area"] == 2.0, read
    assert rc["look_counts"].get("4", {}).get(scout["id"], 0) == 0, "a scout whose area is all read has nothing to count"
    assert scout["id"] not in rc["look_changes"].get("4", {})
    v = prospects.scouting_view(st, limit=prospects.QUEUE_MAX)
    assert next(s for s in v["scouts"] if s["id"] == scout["id"])["looking_at"] == 0, "his area is read: he is looking at nobody"

    # one Send then finishes his report: 3 of 3, scouted, complete, out of the queue; another Send is a 409
    assert prospects.can_scout(st, ME, inside) is True
    out = send(st, inside)
    assert out["look"]["by"] == "trip" and read["looks"] == 3.0 and read["area"] == 2.0, read
    assert prospects.row(st, inside, ME)["scouted"] is True and prospects.can_scout(st, ME, inside) is False
    assert prospects.profile(st, inside, ME)["can_scout"] is False and prospects.profile(st, inside, ME)["looks"] == 3
    # on your board his complete report stays in the queue: no Send (why: the 409 text), the looks full, one final grade word
    kept = next(r for r in prospects.scouting_view(st)["queue"] if r["pid"] == inside)
    assert kept["can_send"] is False and kept["why"] == prospects.REPORT_COMPLETE == "His report is complete: 3 of 3 looks", kept
    assert kept["looks"] == 3 and kept["potential"][0] == kept["potential"][1] in recruiting.WORDS, kept["potential"]
    assert kept["potential"] == list(recruiting.grade_range(st, inside, "potential"))
    assert all(lo == hi for lo, hi in (recruiting.read_interval(st, inside, g) for g in recruiting.GROUPS)), "a complete report's read is one point per group"
    rc["board"] = []
    assert inside not in {r["pid"] for r in prospects.scouting_view(st)["queue"]}, "a complete report off your board leaves the queue"
    rc["board"] = [inside]
    try:
        send(st, inside)
        raise AssertionError("a Send on a complete report")
    except recruiting.RecruitingError as e:
        assert e.code == 409 and str(e) == "his report is complete: 3 of 3 looks", str(e)
    assert read["looks"] == 3.0

    # outside every area: three Sends make the report; a half-finished one needs just the one
    for n in (1, 2, 3):
        send(st, outside)
        assert rc["reads"][outside]["looks"] == float(n) and rc["reads"][outside].get("area", 0) == 0
    assert prospects.row(st, outside, ME)["scouted"] is True
    try:
        send(st, outside)
        raise AssertionError("a fourth Send")
    except recruiting.RecruitingError as e:
        assert e.code == 409 and "complete" in str(e)
    half_done = next(pid for pid in rc["prospects"] if live(pid) and area_of(st, pid) == scout["area"] and pid != inside)
    rc["reads"][half_done]["looks"] = 2.5
    send(st, half_done)
    assert rc["reads"][half_done]["looks"] == 3.0, "a Send adds only what is left"

    # the queue: your board's prospects one Send from complete come first, then the board, then the class
    far = next(pid for pid in rc["prospects"] if live(pid) and area_of(st, pid) not in staffed and pid not in rc["reads"])
    near = next(pid for pid in rc["prospects"] if live(pid) and pid not in (inside, far) and rc["reads"].get(pid, {}).get("looks") == 2.0)
    rc["board"] = [far, near, inside]           # the board's complete report sorts after its open ones
    queue = prospects.scouting_view(st)["queue"]
    assert [r["pid"] for r in queue[:3]] == [near, far, inside], [r["pid"] for r in queue[:4]]
    assert queue[0]["looks"] == 2.0 and queue[1]["looks"] == 0 and queue[2]["looks"] == 3
    assert queue[0]["can_send"] and queue[1]["can_send"] and not queue[2]["can_send"]
    assert all(r["looks"] < 3 for r in queue[3:]), "off the board, only open reports"

    # ten weeks with trips along the way: nothing anywhere past 3 looks or 2 from an area
    for w in range(5, 15):
        week_of_looks(st, w)
        for pid in list(rc["reads"])[w::40]:
            if prospects.can_scout(st, ME, pid):
                send(st, pid)
    assert all(0 < r["looks"] <= 3.0 and 0 <= r.get("area", 0) <= 2.0 for r in rc["reads"].values())
    assert any(r["looks"] == 3.0 for r in rc["reads"].values())
    assert all(r["looks"] * 2 == int(r["looks"] * 2) for r in rc["reads"].values()), "looks come in halves"

    # every flag waits for a complete report: a generational prospect shows no tag at 2 (or 2.5) looks, the tag at 3
    gen = next(iter(rc.get("generational") or []), None)
    if gen is None:                                 # some classes draw none: make one for the test
        gen = max(rc["prospects"], key=lambda q: rc["prospects"][q]["truth"]["potential"])
        rc["generational"] = [gen]
    rc["status"][gen].update(committed=None, signed=None)
    rc["reads"][gen] = {"looks": 2.0, "area": 2.0, "by": {"95": 2}, "g": {g: [95.0, 100.0] for g in recruiting.GROUPS}}
    assert not prospects.generational_seen(rc, gen, ME) and not prospects.row(st, gen, ME)["generational"]
    assert "generational" not in recruiting._flags(st, gen) and not prospects.profile(st, gen, ME)["public"]["generational"]
    rc["reads"][gen]["looks"] = 2.5
    assert not prospects.generational_seen(rc, gen, ME), "two and a half looks are not a complete report"
    rc["reads"][gen]["looks"] = 3.0
    assert prospects.generational_seen(rc, gen, ME) and prospects.row(st, gen, ME)["generational"] and "generational" in recruiting._flags(st, gen)
    two_star = next(pid for pid, q in rc["prospects"].items() if q["stars"] == 2 and live(pid))
    rc["reads"][two_star] = {"looks": 2.5, "area": 2.0, "by": {"95": 2.5}, "g": {g: [95.0, 100.0] for g in recruiting.GROUPS}}
    assert prospects.find(st, two_star) is None, "a gem waits for the complete report too"
    rc["reads"][two_star]["looks"] = 3.0
    assert prospects.find(st, two_star) == "gem"

    # an old save: a read of 7 looks with no area tally reads as complete, costs nothing and crashes nowhere
    old = next(pid for pid in rc["prospects"] if live(pid) and area_of(st, pid) == scout["area"] and pid not in (inside, half_done))
    rc["reads"][old] = {"looks": 7, "by": {"60": 7}, "g": {g: [70.0, 0.5] for g in recruiting.GROUPS}}
    assert prospects.row(st, old, ME)["scouted"] is True and prospects.row(st, old, ME)["looks"] == 3
    assert prospects.profile(st, old, ME)["looks"] == 3 and prospects.can_scout(st, ME, old) is False
    assert prospects.find(st, old) in (None, "gem", "bust")
    week_of_looks(st, 15)
    assert rc["reads"][old]["looks"] in (7, 3) and rc["reads"][old]["g"]["potential"] == [70.0, 0.5], "no re-look at a complete report"
    try:
        send(st, old)
        raise AssertionError("a Send on an old complete report")
    except recruiting.RecruitingError as e:
        assert e.code == 409 and "complete" in str(e)
    rc["board"] = [old]
    v = prospects.scouting_view(st)
    kept = next(r for r in v["queue"] if r["pid"] == old)
    assert kept["looks"] == 3 and kept["can_send"] is False and kept["why"] == prospects.REPORT_COMPLETE, kept
    assert all(f["looks"] <= 3 for f in v["flags"])
    print("look units ok: an area week is half a look up to two, a Send is one, a report is three and never more")
