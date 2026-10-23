"""Coach Career recruiting (recruiting.py): the class and every school's pull on a prospect,
then actions, hours and points, then the weekly step. (Run as a file: multiprocessing on Windows.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `from sim import season` works from here
import shutil

from coach_career import prospects
from coach_career import recruiting
from sim import season

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
    # needs by group: a healthy 85-man make-up minus who comes back minus commits; a commit fills one
    from coach_career import offseason
    rc = st["recruiting"]
    nd = recruiting.needs(st, "ohio-state")
    assert set(nd) == set(offseason.TARGET) and all(isinstance(v, int) for v in nd.values()), nd
    roster = season.load_teams()["ohio-state"]["offense"] + season.load_teams()["ohio-state"]["defense"]
    back = sum(1 for q in roster if q["position"] == "QB" and q.get("class") not in recruiting.LEAVING)
    assert abs(nd["QB"] - (offseason.TARGET["QB"] - back)) <= 1, (nd["QB"], back)     # expected early leavers may count
    qb = next(q for q, p in rc["prospects"].items() if p["ea_position"] == "QB" and not rc["status"][q]["committed"])
    recruiting._commit(st, qb, "ohio-state")              # the game's path (it logs the event the counts key on)
    assert recruiting.needs(st, "ohio-state")["QB"] == nd["QB"] - 1
    rc["status"][qb]["committed"] = None; recruiting.reset_caches()
    assert recruiting.need_factor(2) > recruiting.need_factor(1) > recruiting.need_factor(0) > recruiting.need_factor(-1)
    v = prospects.recruiting_view(st)
    assert v["needs"] == nd and all("need" in b for b in v["board"]), list(v)[:5]
    # NIL asks: every prospect has one from his stars and position; what he wants from you grows when you trail him
    five = next(p for p in rc["prospects"].values() if p["stars"] == 5 and p["ea_position"] == "QB")
    assert five["nil_ask"] > 40 and tx["nil_ask"] <= 20 and all("nil_ask" in p for p in rc["prospects"].values()), (five["nil_ask"], tx["nil_ask"])
    ask = recruiting.ask_from(st, "ohio-state", five["id"])
    assert ask >= five["nil_ask"]
    # an offer needs a pitch; a lowball cools him (no points for the offer, contacts count half, no visit) until it reaches his ask
    try:
        recruiting.act(st, "ohio-state", five["id"], "offer", nil=0); raise AssertionError("an offer without a pitch went through")
    except recruiting.RecruitingError as e:
        assert e.code == 400
    before = rc["lists"][five["id"]].get("ohio-state", 0.0)
    recruiting.act(st, "ohio-state", five["id"], "offer", pitch=five["priorities"][0], nil=0)
    assert recruiting.cooled(st, "ohio-state", five["id"]) and rc["lists"][five["id"]].get("ohio-state", 0.0) == before
    try:
        recruiting.act(st, "ohio-state", five["id"], "official_visit"); raise AssertionError("a visit while he is cooled on you")
    except recruiting.RecruitingError as e:
        assert e.code == 409
    recruiting.act(st, "ohio-state", five["id"], "raise_nil", nil=ask)
    assert not recruiting.cooled(st, "ohio-state", five["id"]) and rc["nil"]["ohio-state"]["held"][five["id"]] == ask
    assert rc["lists"][five["id"]]["ohio-state"] > before
    row = next(b for b in prospects.recruiting_view(st)["board"] if b["id"] == five["id"]) if five["id"] in rc["board"] else None
    assert row is None or ("ask" in row and "cooled" in row)
    # a call and a message once a week each: spamming him is refused, next week is fine
    hours = st["recruiting"]["hours"]["ohio-state"]
    for action in ("call", "message"):
        if action == "message":
            recruiting.act(st, "ohio-state", pid, "message")
        try:
            recruiting.act(st, "ohio-state", pid, action); raise AssertionError(f"second {action} in a week allowed")
        except recruiting.RecruitingError as e:
            assert e.code == 409
    st["current_week"] += 1; st["recruiting"]["hours"]["ohio-state"] = 50
    recruiting.act(st, "ohio-state", pid, "message")
    st["current_week"] -= 1; st["recruiting"]["hours"]["ohio-state"] = hours
    off = next(t for t in recruiting.PITCHES if t not in tx["priorities"])
    assert recruiting._contact_points(tx, "call", tx["priorities"][0]) == 4 * recruiting._contact_points(tx, "call", off)
    assert sorted(s for v in recruiting.AREAS.values() for s in v) == sorted(set(s for v in recruiting.AREAS.values() for s in v))
    assert len(recruiting.AREAS) == 9 and "TX" in recruiting.AREAS["Texas"]
    # an offer with NIL points holds them; past the budget or a second official visit is refused
    before = recruiting.interest(st, "ohio-state", pid)
    r = recruiting.act(st, "ohio-state", pid, "offer", pitch=tx["priorities"][0], nil=20)
    assert r["interest"] > before and pid in st["recruiting"]["offers"]["ohio-state"]
    assert st["recruiting"]["nil"]["ohio-state"]["held"][pid] == 20
    try:
        recruiting.act(st, "ohio-state", tx["id"], "offer", pitch="winning", nil=10 ** 6); raise AssertionError("NIL past the budget")
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
    recruiting.act(st, "ohio-state", other, "offer", pitch="winning")
    rc["status"][other]["committed"] = "texas"
    recruiting._sign(st, final=False)
    assert rc["status"][other]["signed"] == "texas" and other not in rc["offers"]["ohio-state"]
    # the odds you see: each offering school's chance to land him plus the field's, a range that
    # narrows as signing day nears, the schools he likes more ahead
    target = next(q for q, p in rc["prospects"].items() if rc["status"][q]["committed"] is None and q not in (pid, other))
    for school in ("ohio-state", "michigan", "kent-state"):
        rc["offers"].setdefault(school, []).append(target)
    rc["lists"][target]["ohio-state"] = rc["lists"][target].get("ohio-state", 0) + 8
    early, late = prospects.odds(st, target, week=0), prospects.odds(st, target, week=13)
    assert abs(sum(o["pct"] for o in early["schools"]) + early["field"] - 1) < 1e-6
    assert early["schools"][0]["school"] == "ohio-state" and early["schools"][0]["pct"] > early["schools"][-1]["pct"]
    assert all(o["lo"] <= o["pct"] <= o["hi"] for o in early["schools"])
    width = lambda o: o["schools"][0]["hi"] - o["schools"][0]["lo"]
    assert width(early) > width(late) and early["certainty"] == "Early read" and late["certainty"] == "Solid read"
    assert late["field"] < early["field"]
    # a committed prospect: his school holds most of it, the rest is the chance he flips; signed is final
    rc["status"][target]["committed"] = "ohio-state"            # the school he likes most
    held = prospects.odds(st, target)
    assert held["committed"] == "ohio-state" and held["schools"][0]["school"] == "ohio-state", held
    late = prospects.odds(st, target, week=14)                 # fewer weeks to flip in
    assert late["schools"][0]["pct"] > held["schools"][0]["pct"]
    rc["status"][target]["committed"] = "kent-state"            # one he likes less: a real flip risk
    shaky = prospects.odds(st, target)
    assert shaky["schools"][0]["school"] != "kent-state" or shaky["schools"][0]["pct"] < held["schools"][0]["pct"]
    rc["status"][target]["committed"] = "michigan"
    held = prospects.odds(st, target)
    assert abs(sum(o["pct"] for o in held["schools"]) + held["field"] - 1) < 1e-6 and held["field"] == 0
    rc["status"][target]["signed"] = "michigan"
    done = prospects.odds(st, target)
    assert done["schools"][0]["pct"] == 1 and len(done["schools"]) == 1
    rc["status"][target].update(committed=None, signed=None)
    # evaluations: only a genuinely low grade reads as a weakness; a strong player's lowest is "solid"
    star = {"ea_position": "WR", "stars": 5}
    high = prospects._evaluation(star, {"athleticism": 88, "size_strength": 66, "technique": 82, "football_iq": 70, "potential": 86})   # the game's scale
    assert high["weaknesses"] == [] and len(high["solid"]) == 2, high
    low = prospects._evaluation(star, {"athleticism": 88, "size_strength": 40, "technique": 82, "football_iq": 70, "potential": 86})
    assert len(low["weaknesses"]) == 1 and "Size and strength" in low["weaknesses"][0], low
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
    nc = prospects.national_classes(st)
    assert nc["phase"] == "Signed" and sum(c["count"] for c in nc["schools"]) == sum(per.values())
    uga = next(c for c in nc["schools"] if c["school"] == "georgia")
    assert uga["rank"] == prospects.class_rank(st, "georgia") and uga["count"] == per["georgia"] and len(uga["top"]) == min(3, per["georgia"])
    ranks = {s: prospects.class_rank(st, s) for s in ("georgia", "kent-state")}
    assert all(1 <= r <= len(recruiting.fbs_schools(st)) for r in ranks.values()) and ranks["georgia"] < ranks["kent-state"], ranks
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
