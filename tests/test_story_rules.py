"""What his story changes on the engine side (persona.py story rules, hooks in recruiting.py): a legacy's
head start and its costs, a Hometown Hero's state pull and out-of-state pitches, a Package Deal's
commitment together, a Two-Sport recruit's draft risk and signing-day roll, an Injury Comeback's loyalty,
AI doubt and clouded reads, a Late Bloomer's jump. Each test forces the story on one prospect in a fresh
career (p["persona"]) and compares it to the same prospect with none."""
import random
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))

from coach_career import persona, prospects, recruiting
from sim import season

ME = "ohio-state"
NEUTRAL = {"personality": "guarded", "decider": "self", "decider_topic": None}


def fresh(seed=5):
    st = season.new_season(ME, "full", seed=seed, career=True)
    st["current_week"] = 1
    return st


def force(st, pid, kind=None, data=None):
    st["recruiting"]["prospects"][pid]["persona"] = dict(NEUTRAL, story=kind, story_data=data or {})


def reset(st, pid, slug=ME):
    rc = st["recruiting"]
    rc["contacts"].pop(pid, None)
    rc["pending"], rc["why_week"], rc["scenes"] = {}, {}, {}
    rc["hours"][slug] = 1000
    for s in rc["offers"]:
        if pid in rc["offers"][s]:
            rc["offers"][s].remove(pid)


def plain(st, used=(), state=None):
    """An untouched prospect with no story (optionally from `state`)."""
    rc = st["recruiting"]
    for pid in sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"]):
        p = rc["prospects"][pid]
        if pid in used or p.get("hidden") or rc["status"][pid]["committed"] or persona.story(st, pid)[0] or ME in rc["lists"][pid]:
            continue
        if state and p["hometown"]["state"] != state:
            continue
        return pid
    raise AssertionError("no prospect fits")


def pts(st, pid, slug, action, pitch):
    reset(st, pid, slug)
    recruiting.act(st, slug, pid, action, pitch)
    return recruiting.pending(st, slug, pid)


def approx(a, b, tol=1e-9):
    return abs(a - b) < tol


if __name__ == "__main__":
    st = fresh()
    rc = st["recruiting"]
    teams = season.load_teams()
    other = "michigan"

    # ----- Legacy -----
    pid = plain(st)
    win = recruiting._winning(st)
    force(st, pid, None)
    flat = recruiting.interest(st, ME, pid, win)
    force(st, pid, "legacy", {"school": ME})
    assert approx(recruiting.interest(st, ME, pid, win), flat + persona.LEGACY_HEAD, 1e-6), "the legacy school's head start"
    assert ME not in rc["lists"][pid], "a head start, not a place on his list"
    for t in ("coach", "prestige", "academics"):
        force(st, pid, None)
        base = pts(st, pid, other, "message", t)
        force(st, pid, "legacy", {"school": ME})
        got = pts(st, pid, other, "message", t)
        want = base * (persona.LEGACY_PITCH if t in ("coach", "prestige") else 1.0)
        assert approx(got, want), (t, got, want)
    force(st, pid, None)
    mine = pts(st, pid, ME, "message", "coach")
    force(st, pid, "legacy", {"school": ME})
    assert approx(pts(st, pid, ME, "message", "coach"), mine), "the legacy school's own Coach pitch is not raised"
    # the legacy school's lowball cools him twice as long; another school's as usual
    ask = recruiting.ask_from(st, ME, pid)
    assert ask >= 10, ask
    reset(st, pid)
    recruiting.act(st, ME, pid, "offer", "coach", nil=0)
    c = rc["contacts"][pid][ME]
    assert c["cooled_until"] == st["current_week"] + recruiting.COOL_WEEKS * persona.LEGACY_COST, c
    rc["offers"][ME].remove(pid)
    force(st, pid, "legacy", {"school": other})
    reset(st, pid)
    recruiting.act(st, ME, pid, "offer", "coach", nil=0)
    assert rc["contacts"][pid][ME]["cooled_until"] == st["current_week"] + recruiting.COOL_WEEKS
    rc["offers"][ME].remove(pid)
    # a hollow promise from the legacy school costs double
    force(st, pid, "legacy", {"school": ME})
    assert persona.hollow_mult(st, pid, ME) == persona.LEGACY_COST * persona.hollow_mult(st, pid, other)
    print("  legacy ok")

    # ----- Hometown Hero -----
    home = teams[ME]["state"]
    hpid = plain(st, used={pid}, state=home)
    force(st, hpid, None)
    win = recruiting._winning(st)
    pull_in = recruiting.interest(st, ME, hpid, win) - rc["lists"][hpid].get(ME, 0.0)
    pull_out = recruiting.interest(st, other, hpid, win) - rc["lists"][hpid].get(other, 0.0)
    force(st, hpid, "hero", {"state": home})
    assert approx(recruiting.interest(st, ME, hpid, win) - rc["lists"][hpid].get(ME, 0.0), pull_in * persona.HERO_STATE, 1e-6)
    assert approx(recruiting.interest(st, other, hpid, win) - rc["lists"][hpid].get(other, 0.0), pull_out, 1e-6), "an out-of-state school's pull is as usual"
    assert teams[other]["state"] != home
    for t in ("prestige", "coach", "playing_time", "nil"):
        force(st, hpid, None)
        base_out, base_in = pts(st, hpid, other, "message", t), pts(st, hpid, ME, "message", t)
        force(st, hpid, "hero", {"state": home})
        want = base_out * (1.0 if t in persona.HERO_FULL else persona.HERO_AWAY)
        assert approx(pts(st, hpid, other, "message", t), want), (t, want)
        assert approx(pts(st, hpid, ME, "message", t), base_in), "an in-state school's pitch is as usual"
    print("  hometown hero ok")

    # ----- Package Deal: he commits only where his mate holds an offer, and they commit together -----
    st = fresh(6)
    rc = st["recruiting"]
    st["current_week"] = 10
    a = plain(st)
    b = plain(st, used={a}, state=rc["prospects"][a]["hometown"]["state"])
    force(st, a, "package", {"mate": b, "lead": True})
    force(st, b, "package", {"mate": a, "lead": False})
    assert persona.mate(st, a) == b and persona.mate(st, b) == a
    x, y = "texas", "alabama"
    for s, pids in ((x, [a, b]), (y, [a])):
        rc["offers"].setdefault(s, [])
        for q in pids:
            if q not in rc["offers"][s]:
                rc["offers"][s].append(q)
    rc["lists"][a][y] = 80.0                   # he likes Alabama best, but Alabama has not offered his mate
    rc["lists"][a][x] = 40.0
    rc["lists"][b][x] = 40.0

    class Always(random.Random):
        def random(self):
            return 0.0
    recruiting._draws(st, 10, Always())
    assert rc["status"][a]["committed"] == x, rc["status"][a]
    assert rc["status"][b]["committed"] == x, "his mate commits with him, the same week"
    weeks = {e["pid"]: e["week"] for e in rc["log"] if e["kind"] == "commit" and e["pid"] in (a, b)}
    assert weeks[a] == weeks[b], weeks
    # Alabama offers the mate too: now he flips there, and his mate with him
    rc["offers"][y].append(b)
    rc["status"][a]["firmness"] = 0
    rc["status"][b]["firmness"] = 0
    rc["lists"][b][y] = 80.0
    recruiting._draws(st, 11, Always())
    assert rc["status"][a]["committed"] == y and rc["status"][b]["committed"] == y, (rc["status"][a], rc["status"][b])
    print("  package deal ok")

    # ----- Two-Sport: draft risk, lowered by Playing Time pitches and NIL over his ask; the signing-day roll -----
    st = fresh(7)
    rc = st["recruiting"]
    tpid = plain(st)
    force(st, tpid, "two_sport")
    assert approx(persona.draft_risk(st, ME, tpid), persona.DRAFT_RISK)
    assert persona.draft_word(persona.DRAFT_RISK) == "High"
    reset(st, tpid)
    recruiting._contact(st, ME, tpid)["pt"] = 2          # two Playing Time pitches (calls and visits pitch now; a message carries none)
    assert approx(persona.draft_risk(st, ME, tpid), persona.DRAFT_RISK - 2 * persona.DRAFT_PT), persona.draft_risk(st, ME, tpid)
    ask = recruiting.ask_from(st, ME, tpid)
    recruiting.act(st, ME, tpid, "offer", "playing_time", nil=int(ask * 1.4) + 5)
    held = rc["nil"][ME]["held"][tpid]
    over = max(0.0, held / max(ask, 5) - 1)
    want = max(persona.DRAFT_FLOOR, persona.DRAFT_RISK - 2 * persona.DRAFT_PT - persona.DRAFT_NIL * over)
    assert approx(persona.draft_risk(st, ME, tpid), want, 1e-6), (persona.draft_risk(st, ME, tpid), want)
    assert persona.draft_word(0.06) == "Some" and persona.draft_word(0.03) == "Low"
    # many pitches cannot take it under the floor
    rc["contacts"][tpid][ME]["pt"] = 50
    assert approx(persona.draft_risk(st, ME, tpid), persona.DRAFT_FLOOR)
    force(st, tpid, None)
    assert persona.draft_risk(st, ME, tpid) == 0.0, "no story, no draft risk"
    force(st, tpid, "two_sport")
    # signing: with a sure risk he goes pro; his school's NIL comes back and he signs nowhere
    recruiting._commit(st, tpid, ME)
    keep = (persona.DRAFT_RISK, persona.DRAFT_FLOOR)
    persona.DRAFT_RISK, persona.DRAFT_FLOOR = 1.0, 1.0
    budget = rc["nil"][ME]["budget"]
    recruiting._sign(st, final=False)
    persona.DRAFT_RISK, persona.DRAFT_FLOOR = keep
    s_ = rc["status"][tpid]
    assert s_.get("pro") and s_["signed"] == "FCS", s_
    assert rc["nil"][ME]["budget"] == budget and tpid not in rc["nil"][ME]["held"], "the package is not spent"
    ev = [e for e in rc["log"] if e["pid"] == tpid and e["kind"] == "pro"]
    assert ev and ev[0]["school"] == ME and ev[0]["line"].endswith("."), ev
    assert prospects.row(st, tpid, ME)["school_name"] == "Pro Baseball"
    # and with no risk he signs
    t2 = plain(st, used={tpid})
    force(st, t2, "two_sport")
    rc["offers"].setdefault(ME, []).append(t2)
    recruiting._commit(st, t2, ME)
    persona.DRAFT_RISK, persona.DRAFT_FLOOR = 0.0, 0.0
    recruiting._sign(st, final=False)
    persona.DRAFT_RISK, persona.DRAFT_FLOOR = keep
    assert rc["status"][t2]["signed"] == ME and not rc["status"][t2].get("pro")
    print("  two-sport ok")

    # ----- Injury Comeback: loyalty, AI doubt, public grades and clouded reads -----
    st = fresh(8)
    rc = st["recruiting"]
    cpid = plain(st)
    force(st, cpid, None)
    st["current_week"] = 7
    base = pts(st, cpid, ME, "call", "coach")
    force(st, cpid, "comeback")
    reset(st, cpid)
    st["current_week"] = 3
    recruiting.act(st, ME, cpid, "message", None)          # an early contact
    rc["pending"], rc["why_week"] = {}, {}
    st["current_week"] = 7
    rc["contacts"][cpid][ME]["n"] = 0                       # the same diminishing as the baseline
    recruiting.act(st, ME, cpid, "call", "coach")
    assert approx(recruiting.pending(st, ME, cpid), base * persona.LOYALTY, 1e-6), (recruiting.pending(st, ME, cpid), base)
    assert approx(pts(st, cpid, ME, "call", "coach"), base), "a school that first reached him in Week 6 or later has no loyalty"
    doubts = [s for s in recruiting.fbs_schools(st) if persona.ai_doubts(st, s, cpid)]
    share = len(doubts) / len(recruiting.fbs_schools(st))
    assert 0.25 <= share <= 0.55, share
    assert not persona.ai_doubts(st, ME, cpid), "your school is never doubted for him: that is your call"
    force(st, cpid, None)
    assert not any(persona.ai_doubts(st, s, cpid) for s in recruiting.fbs_schools(st))
    # a shown-low prospect's public grades understate him
    real_low = next(q for q, p in rc["prospects"].items() if p.get("real"))
    p = rc["prospects"][real_low]
    pub = prospects._public_grades(p)
    p2 = dict(p)
    del p2["real"]
    plain_pub = prospects._public_grades(p2)
    assert all(approx(pub[g], plain_pub[g] - persona.SHOWN_BAND) for g in recruiting.GROUPS), (pub, plain_pub)
    # his potential reads less certain: a look's error on it is larger
    force(st, cpid, "comeback")
    rc["reads"].pop(cpid, None)
    recruiting.look(st, cpid, 70, random.Random(1))
    wide = recruiting.read_spread(st, cpid, "potential")[1]
    force(st, cpid, None)
    rc["reads"].pop(cpid, None)
    recruiting.look(st, cpid, 70, random.Random(1))
    narrow = recruiting.read_spread(st, cpid, "potential")[1]
    assert wide > narrow, (wide, narrow)
    print("  injury comeback ok")

    # ----- Late Bloomer: the jump -----
    st = fresh(9)
    rc = st["recruiting"]
    blooms = [(q, s["story_data"]) for q, s in persona.stories(st).items() if s["story"] == "bloomer"]
    q, d = blooms[0]
    p = rc["prospects"][q]
    real = dict(p["real"])
    before_v = rc.get("class_v", 0)
    jumped = persona.bloom(st, d["week"])
    assert q in jumped
    assert p["stars"] == real["stars"] and p["composite"] == real["composite"] and "real" not in p, p
    assert p["nil_ask"] == recruiting.nil_ask(p, rc["year"], rc["seed"])
    assert rc["class_v"] == before_v + 1
    ranks = sorted(x["rank"] for x in rc["prospects"].values())
    assert ranks == list(range(1, len(rc["prospects"]) + 1))
    order = sorted(rc["prospects"], key=lambda z: rc["prospects"][z]["rank"])
    assert all(rc["prospects"][u]["composite"] >= rc["prospects"][v]["composite"] for u, v in zip(order, order[1:]))
    ev = [e for e in rc["log"] if e["pid"] == q and e["kind"] == "bloomed"]
    assert ev and ev[0]["line"] == f"He jumped to {persona.STAR_WORD[real['stars']]} stars.", ev
    on = [s for s, b in rc["boards"].items() if q in b and s != st["team"]]
    assert len(on) >= persona.BLOOM_BOARDS, on
    assert q not in persona.bloom(st, d["week"]), "he jumps once"
    assert recruiting.tier_of(p) == real["stars"]
    print("  late bloomer ok")
    print("test_story_rules: ok")
