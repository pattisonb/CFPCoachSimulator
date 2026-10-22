"""Coach Career recruiting (recruiting.py): the class and every school's pull on a prospect,
then actions, hours and points, then the weekly step. (Run as a file: multiprocessing on Windows.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `import season` works from here
import shutil

import recruiting
import season

if __name__ == "__main__":
    # the class, nobody committed, and the pulls
    st = season.new_season("ohio-state", "full", seed=4, career=True)
    rc = st["recruiting"]
    assert len(rc["prospects"]) == 4092 and all(s["committed"] is None for s in rc["status"].values())
    tx = next(p for p in rc["prospects"].values() if p["hometown"]["state"] == "TX" and p["stars"] == 3)
    assert len(tx["priorities"]) == 3 and set(tx["priorities"]) <= set(recruiting.PITCHES)
    assert recruiting.pull(st, "texas", tx["id"])["proximity"] > recruiting.pull(st, "oregon", tx["id"])["proximity"]
    assert recruiting.on_field(st, "ohio-state", 0) > recruiting.on_field(st, "kent-state", 0)
    # this season counts more every week: a 7-0 team off a 5-7 year is a hot program by week 7
    fake = dict(st, current_week=7, games={k: dict(v) for k, v in st["games"].items()})
    recruiting._set_record(fake, "kent-state", 7, 0)
    assert recruiting.on_field(fake, "kent-state", 7) > recruiting.on_field(st, "kent-state", 0) + 0.2
    # interest follows his priorities: the school strongest on his top priority leads the pull side
    assert recruiting.interest(st, "texas", tx["id"]) > 0
    # actions: hours, a call reveals a priority, one in-home visit a month, pitches on his priorities count 4x
    pid = tx["id"]; h0 = recruiting.weekly_hours(st, "ohio-state")
    day = season.load_teams()["ohio-state"]["coaches"]["head_coach"]["ratings"]["recruiting"]
    assert h0 == 50 + max(0, day - 50) // 4
    r = recruiting.act(st, "ohio-state", pid, "call", pitch=tx["priorities"][0])
    assert r["hours_left"] == h0 - 15 and r["revealed"] in tx["priorities"]
    recruiting.act(st, "ohio-state", pid, "hc_visit")
    try:
        recruiting.act(st, "ohio-state", pid, "hc_visit"); raise AssertionError("second in-home visit inside 4 weeks allowed")
    except recruiting.RecruitingError as e:
        assert e.code == 409
    off = next(t for t in recruiting.PITCHES if t not in tx["priorities"])
    assert recruiting._contact_points(tx, "call", tx["priorities"][0]) == 4 * recruiting._contact_points(tx, "call", off)
    assert sorted(s for v in recruiting.AREAS.values() for s in v) == sorted(set(s for v in recruiting.AREAS.values() for s in v))
    assert len(recruiting.AREAS) == 9 and "TX" in recruiting.AREAS["Texas"]
    # an offer with NIL points holds them; past the budget or a second official visit is refused
    before = recruiting.interest(st, "ohio-state", pid)
    r = recruiting.act(st, "ohio-state", pid, "offer", nil=20)
    assert r["interest"] > before and pid in st["recruiting"]["offers"]["ohio-state"]
    assert st["recruiting"]["nil"]["ohio-state"]["held"][pid] == 20
    try:
        recruiting.act(st, "ohio-state", tx["id"], "offer", nil=10 ** 6); raise AssertionError("NIL past the budget")
    except recruiting.RecruitingError as e:
        assert e.code in (400, 409)
    recruiting.act(st, "ohio-state", pid, "official_visit")
    try:
        recruiting.act(st, "ohio-state", pid, "official_visit"); raise AssertionError("second official visit allowed")
    except recruiting.RecruitingError as e:
        assert e.code == 409
    recruiting.act(st, "ohio-state", pid, "pull_offer")
    assert pid not in st["recruiting"]["offers"]["ohio-state"] and pid not in st["recruiting"]["nil"]["ohio-state"]["held"]
    # the week's hours run out
    while True:
        try:
            recruiting.act(st, "ohio-state", pid, "message")
        except recruiting.RecruitingError as e:
            assert e.code == 409 and st["recruiting"]["hours"]["ohio-state"] < 5
            break
    # at signing, every school's offers to prospects who signed elsewhere are dropped: your
    # offer cap is never held by them (you cannot pull an offer once he signs)
    other = next(q for q, p in rc["prospects"].items() if q != pid and rc["status"][q]["committed"] is None)
    recruiting.act(st, "ohio-state", other, "offer")
    rc["status"][other]["committed"] = "texas"
    recruiting._sign(st, final=False)
    assert rc["status"][other]["signed"] == "texas" and other not in rc["offers"]["ohio-state"]
    # offers are capped at 1.5x open spots
    cap = recruiting.offer_cap(st, "ohio-state")
    assert 15 <= cap <= 45, cap
    # real head coaches' recruiting ratings follow how they really recruit; your created coach keeps his
    teams = season.load_teams()
    rr = lambda slug: teams[slug]["coaches"]["head_coach"]["ratings"]["recruiting"]
    assert rr("oregon") > rr("oklahoma"), (rr("oregon"), rr("oklahoma"))
    mine = season.new_season("kent-state", "full", seed=6, career=True,
                             coach={"id": "c1", "first_name": "Pat", "last_name": "Test",
                                    "ratings": {"recruiting": 92, "offense": 70, "defense": 70}})
    assert recruiting.weekly_hours(mine, "kent-state") == 50 + (92 - 50) // 4
    # a whole season: everyone signs somewhere, nobody past their open spots, about a third to FCS
    import time
    from collections import Counter
    t0 = time.time()
    plain = season.new_season("georgia", "full", seed=5)
    season.advance_to(plain, season.FINAL_WEEK)
    t_plain = time.time() - t0
    t0 = time.time()
    st = season.new_season("georgia", "full", seed=5, career=True)
    season.advance_to(st, season.FINAL_WEEK)
    t_career = time.time() - t0
    rc = st["recruiting"]; signed = [s["signed"] for s in rc["status"].values()]
    assert all(signed), "a prospect never signed"
    per = Counter(s for s in signed if s != "FCS")
    assert all(per[t] <= recruiting.open_spots(st, t) for t in per), "a school signed past its open spots"
    with_fcs = sum(1 for s in signed if s == "FCS") / len(signed)
    assert 0.25 < with_fcs < 0.45, with_fcs
    assert recruiting.signed_class(st, "georgia") and len(recruiting.signed_class(st, "georgia")) == per["georgia"]
    try:
        recruiting.act(st, "georgia", next(iter(rc["prospects"])), "message", pitch="nil"); raise AssertionError
    except recruiting.RecruitingError as e:
        assert e.code == 409                               # acting on a signed prospect
    kinds = Counter(e["kind"] for e in rc["log"])
    print(f"season: {t_plain:.1f}s plain, {t_career:.1f}s career (+{t_career - t_plain:.1f}s); FCS {with_fcs:.0%}; "
          f"Georgia signed {per['georgia']}/{recruiting.open_spots(st, 'georgia')}; events {dict(kinds)}")
    for done in (plain, st):                               # the sims' box scores
        shutil.rmtree(season.box_dir(done).parent, ignore_errors=True)
    assert t_career - t_plain < 20, "recruiting adds more than 20 s to a season"
    print(f"recruiting ok: {len(rc['prospects'])} prospects; TX 3-star {tx['name']} priorities {tx['priorities']}")
