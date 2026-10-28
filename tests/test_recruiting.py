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
    gen = rc["generational"]
    assert gen == recruiting.draw_generational(rc), "the draw is seeded: drawing again gives the same list"
    assert len(gen) <= recruiting.GENERATIONAL_MAX
    assert all(rc["prospects"][q]["stars"] >= 4 and rc["prospects"][q]["truth"]["potential"] >= recruiting.GENERATIONAL_FROM for q in gen)
    assert all(rc["prospects"][gen[i]]["truth"]["potential"] >= rc["prospects"][gen[i + 1]]["truth"]["potential"] for i in range(len(gen) - 1))
    # a class with no qualifier has none; a class of only qualifiers stays under the cap
    fake = {"seed": 1, "prospects": {q: dict(p, truth=dict(p["truth"], potential=50.0)) for q, p in list(rc["prospects"].items())[:200]}}
    assert recruiting.draw_generational(fake) == []
    fake = {"seed": 1, "prospects": {q: dict(p, stars=5, truth=dict(p["truth"], potential=99.0)) for q, p in list(rc["prospects"].items())[:200]}}
    assert len(recruiting.draw_generational(fake)) == recruiting.GENERATIONAL_MAX
    # over many seeds the count is a few, often none: never a guaranteed number
    counts = [len(recruiting.draw_generational(dict(rc, seed=s))) for s in range(40)]
    assert min(counts) <= 1 and 1.0 <= sum(counts) / len(counts) <= 5.0, counts
    if gen:
        g = gen[0]
        assert recruiting.ask_from(st, "ohio-state", g) == int(round(recruiting.GENERATIONAL_ASK * recruiting.ask_from(dict(st, recruiting=dict(rc, generational=[])), "ohio-state", g)))
        assert prospects.row(st, g, "ohio-state")["generational"] and prospects.profile(st, g, "ohio-state")["public"]["generational"]
    # an old save draws on load
    rc.pop("generational")
    assert recruiting.upgrade_generational(st) and rc["generational"] == gen and not recruiting.upgrade_generational(st)
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
    assert h0 == 5 * round((50 + max(0, day - 50) / 4) / 5) and h0 % 5 == 0
    r = recruiting.act(st, "ohio-state", pid, "call", pitch=tx["priorities"][0])
    assert r["hours_left"] == h0 - 15 and (r["revealed"] is None or r["revealed"] in tx["priorities"])
    # a call is not a confession: it reveals a priority only CALL_REVEAL of the time (over the class, not
    # always and not never), and narrows his ask to a range; the in-home visit tells you one for sure and the number
    rc["hours"]["texas"] = 10 ** 6
    calls = [recruiting._act(st, "texas", q, "call", None, 0) for q in list(rc["prospects"])[:60]]
    assert 0.25 <= sum(1 for c in calls if c) / len(calls) <= 0.75, sum(1 for c in calls if c) / len(calls)
    av = recruiting.ask_view(st, "ohio-state", pid)
    ask_ = recruiting.ask_from(st, "ohio-state", pid)
    assert av.get("exact") is None and av["lo"] < ask_ < av["hi"] and av["hi"] - av["lo"] <= max(10, 0.6 * ask_), av
    r = recruiting.act(st, "ohio-state", pid, "hc_visit")
    assert r["revealed"] in tx["priorities"] and recruiting.ask_view(st, "ohio-state", pid).get("exact") == recruiting.ask_from(st, "ohio-state", pid)
    # scouting by hand: 5 hours a look by your best evaluator at one prospect, up to three looks, any week
    unseen = next(q for q in list(rc["prospects"]) if q not in rc["reads"] and q != pid)
    rc["hours"]["ohio-state"] = 100
    r = recruiting.act(st, "ohio-state", unseen, "scout")
    assert rc["reads"][unseen]["looks"] == recruiting.SCOUT_LOOKS and r["hours_left"] == 100 - recruiting.HOURS["scout"]
    for _ in range(recruiting.SCOUT_MAX - 1):
        recruiting.act(st, "ohio-state", unseen, "scout")
    assert rc["reads"][unseen]["looks"] == recruiting.SCOUT_MAX and rc["hours"]["ohio-state"] == 100 - recruiting.SCOUT_MAX * recruiting.HOURS["scout"]
    lo, hi = recruiting.read_interval(st, unseen, "athleticism")
    assert hi - lo < 25, (lo, hi)
    try:
        recruiting.act(st, "ohio-state", unseen, "scout"); raise AssertionError("a fourth scouting trip allowed")
    except recruiting.RecruitingError as e:
        assert e.code == 409
    st["current_week"] += 1
    try:
        recruiting.act(st, "ohio-state", unseen, "scout"); raise AssertionError("a scouted prospect can be scouted again next week")
    except recruiting.RecruitingError as e:
        assert e.code == 409
    st["current_week"] -= 1
    rc["hours"]["ohio-state"] = h0 - 15 - 30                 # back to the week as it was before the trip
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
    before = recruiting.points_now(st, "ohio-state", five["id"])
    recruiting.act(st, "ohio-state", five["id"], "offer", pitch=five["priorities"][0], nil=0)
    assert recruiting.cooled(st, "ohio-state", five["id"]) and recruiting.points_now(st, "ohio-state", five["id"]) == before
    try:
        recruiting.act(st, "ohio-state", five["id"], "official_visit"); raise AssertionError("a visit while he is cooled on you")
    except recruiting.RecruitingError as e:
        assert e.code == 409
    recruiting.act(st, "ohio-state", five["id"], "raise_nil", nil=ask)
    assert not recruiting.cooled(st, "ohio-state", five["id"]) and rc["nil"]["ohio-state"]["held"][five["id"]] == ask
    assert recruiting.points_now(st, "ohio-state", five["id"]) > before
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
    hours_before = st["recruiting"]["hours"]["ohio-state"]
    st["recruiting"]["hours"]["ohio-state"] = 100       # fresh hours for what follows
    # pitches are tied to your program: a priority where you are strong lands big, where you are weak it backfires
    off = next(t for t in recruiting.PITCHES if t not in tx["priorities"])
    strength = recruiting.strengths(st, "ohio-state", pid)
    assert set(strength) == set(recruiting.PITCHES) and all(0 <= v <= 1 for v in strength.values())
    strong = max(tx["priorities"], key=lambda t: strength[t])
    assert recruiting._contact_points(st, "ohio-state", tx, "call", strong) > recruiting._contact_points(st, "ohio-state", tx, "call", off)
    weak_t = next(t for t in tx["priorities"] if t != strong)
    saved = strength[weak_t]
    with recruiting.forced_strength(st, "ohio-state", pid, weak_t, 0.1):
        assert recruiting._contact_points(st, "ohio-state", tx, "message", weak_t) < 0        # he isn't buying it
    # stages: cold until a contact; an official visit needs his top group; a cold offer counts half
    rc = st["recruiting"]
    two = next(q for q, p in rc["prospects"].items() if p["stars"] == 2 and q != pid and not rc["status"][q]["committed"] and q not in rc["contacts"])
    assert recruiting.stage(st, "ohio-state", two) == "cold"
    recruiting.act(st, "ohio-state", two, "message")
    assert recruiting.stage(st, "ohio-state", two) == "contact"
    crowd = [x for x in recruiting.fbs_schools(st) if x != "ohio-state"][:8]
    for x in crowd:
        rc["lists"][two][x] = 10_000.0
    try:
        recruiting.act(st, "ohio-state", two, "official_visit"); raise AssertionError("a visit without his top group")
    except recruiting.RecruitingError as e:
        assert e.code == 409
    for x in crowd:
        rc["lists"][two].pop(x)
    cold = next(q for q, p in rc["prospects"].items() if p["stars"] == 2 and q not in (pid, two) and not rc["status"][q]["committed"] and q not in rc["contacts"])
    warm_pts = recruiting._contact_points(st, "ohio-state", rc["prospects"][cold], "offer", rc["prospects"][cold]["priorities"][0])
    recruiting.act(st, "ohio-state", cold, "offer", pitch=rc["prospects"][cold]["priorities"][0], nil=0)
    assert rc["status"][cold]["committed"] is None
    assert abs(recruiting.points_now(st, "ohio-state", cold) - warm_pts / 2) < 1e-6, (recruiting.points_now(st, "ohio-state", cold), warm_pts)
    st["recruiting"]["hours"]["ohio-state"] = hours_before
    assert sorted(s for v in recruiting.AREAS.values() for s in v) == sorted(set(s for v in recruiting.AREAS.values() for s in v))
    assert len(recruiting.AREAS) == 9 and "TX" in recruiting.AREAS["Texas"]
    # an offer with NIL points holds them; past the budget or a second official visit is refused
    before = recruiting.interest(st, "ohio-state", pid)
    r = recruiting.act(st, "ohio-state", pid, "offer", pitch=tx["priorities"][0], nil=20)
    assert recruiting.points_now(st, "ohio-state", pid) > before and pid in st["recruiting"]["offers"]["ohio-state"]
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
    assert recruiting.weekly_hours(mine, "kent-state") == 60 and recruiting.weekly_hours(mine, "kent-state") % 5 == 0
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
    # the guard scales with the machine: a plain season takes about 15 s here, 25 s on a slow box
    assert t_career - t_plain < max(25, 1.6 * t_plain), f"recruiting adds more than 1.6x a plain season ({t_plain:.1f}s plain, +{t_career - t_plain:.1f}s)"
    # feedback once a week: actions land at the week step; his list and the weekly report show the moves
    st2 = season.new_season("ohio-state", "full", seed=7, career=True)
    rc2 = st2["recruiting"]
    fresh = next(q for q, p in rc2["prospects"].items() if p["stars"] == 3 and q not in rc2["contacts"] and not rc2["status"][q]["committed"])
    rc2["board"].append(fresh)
    recruiting.act(st2, "ohio-state", fresh, "call")
    assert rc2["lists"][fresh].get("ohio-state", 0.0) == 0.0 and recruiting.pending(st2, "ohio-state", fresh) > 0
    assert recruiting.points_now(st2, "ohio-state", fresh) == recruiting.pending(st2, "ohio-state", fresh)
    assert "interest" not in recruiting.act(st2, "ohio-state", fresh, "message")
    recruiting.weekly_step(st2, 0)
    assert rc2["lists"][fresh]["ohio-state"] > 0 and recruiting.pending(st2, "ohio-state", fresh) == 0
    report = recruiting.latest_report(st2)
    row = next(r for r in report["rows"] if r["pid"] == fresh)
    assert report["week"] == 0 and {"rank", "prev_rank", "leader", "moves", "events"} <= set(row), row
    assert row["rank"] is not None and row["prev_rank"] is None          # his first list
    listed = prospects.profile(st2, fresh, "ohio-state")["public"]["schools"]
    assert listed and all({"move", "bar", "why"} <= set(x) for x in listed), listed[0]
    # the stage snapshot: a prospect who was cold and was called this week moved up at the week step
    assert recruiting.stage(st2, "ohio-state", fresh) in ("contact", "top", "visited")
    assert rc2["stages"][fresh]["now"] == recruiting.stage(st2, "ohio-state", fresh)
    b = prospects.board_row(st2, fresh, "ohio-state")
    assert b["stage_move"] in ("up", None) and b["home"] == rc2["prospects"][fresh]["home"]
    v = prospects.recruiting_view(st2)
    assert v["areas"]["Texas"] == ["TX"] and set(v["areas"]) == set(recruiting.AREAS)
    # an old save without the snapshot shows no move
    rc2.pop("stages")
    assert prospects.board_row(st2, fresh, "ohio-state")["stage_move"] is None
    # verbal commits: a commitment starts at 40 (60 after a visit) and firms up every week, faster with contact
    st3 = season.new_season("ohio-state", "full", seed=8, career=True)
    rc3 = st3["recruiting"]
    a, b = [q for q, p in rc3["prospects"].items() if p["stars"] == 3 and not rc3["status"][q]["committed"]][:2]
    for q in (a, b):
        rc3["board"].append(q)
        recruiting.act(st3, "ohio-state", q, "offer", pitch=rc3["prospects"][q]["priorities"][0], nil=10)
    rc3["visits"].setdefault(b, {})["ohio-state"] = {"week": 0, "done": True}
    recruiting._commit(st3, a, "ohio-state"); recruiting._commit(st3, b, "ohio-state")
    assert rc3["status"][a]["firmness"] == 40 and rc3["status"][b]["firmness"] == 60
    recruiting.act(st3, "ohio-state", a, "message")          # a kept in touch with, b not
    st3["career"]["settings"]["auto_recruit"] = "off"
    recruiting.weekly_step(st3, 0)
    fa, fb = rc3["status"][a]["firmness"], rc3["status"][b]["firmness"]
    # a: +8 for the message and +3 for the NIL held, less rivals; b: the quiet drift (+3) and the NIL, less rivals; neither softens
    assert 40 + 11 - 6 * 3 <= fa <= 40 + 11 and 60 + 3 - 6 * 3 <= fb <= 60 + 11 and fb > 60 - 18, (fa, fb)
    assert all("firmness" in r for r in prospects.recruiting_view(st3)["board"] if r["committed"] == "ohio-state")
    rc3["status"][a]["firmness"] = 100
    assert recruiting.flip_weekly(st3, a, 50.0) == 0.0 and recruiting.flip_weekly(st3, b, 50.0) > 0.0
    print(f"recruiting ok: {len(rc['prospects'])} prospects; TX 3-star {tx['name']} priorities {tx['priorities']}")
