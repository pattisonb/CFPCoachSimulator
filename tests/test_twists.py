"""Twists (persona.py, spec section 3): a weekly roll per uncommitted prospect on any board, its own seeded
stream, about one a recruit a season (more for the blue chips). Each of the seven is set off on one prospect
against the engine and its effect checked: Surprise Visit (into his top three, knocked back by a top-three
school's call), At Your Game (a win, a blowout, a loss), Hot Seat (Coach pitches against the school x2), Late
Offer (a blue blood near the top, his ask up), Family Move (proximity and a hero's state move), Grades Scare
(academic AI schools drop him, Academics pitches x2), Wants to See You Beat X (private to the school he told).
Then the weekly report, the save's size, determinism and the rate over a seeded season."""
import copy
import json
import random
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))

from coach_career import persona, prospects, recruiting
from sim import news, season

ME = "ohio-state"


def fresh(seed=5, week=3):
    st = season.new_season(ME, "full", seed=seed, career=True)
    st["current_week"] = week
    return st


def plain(st, used, near=None, stars=None):
    """An untouched prospect with no story (near `near` within persona.GAME_MILES, of `stars` real stars)."""
    rc = st["recruiting"]
    loc = recruiting._team_model(near).get("location") if near else None
    for pid in sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"]):
        p = rc["prospects"][pid]
        if pid in used or p.get("hidden") or rc["status"][pid]["committed"] or persona.story(st, pid)[0] or rc["lists"][pid]:
            continue
        if any(pid in pids for pids in rc["offers"].values()):
            continue
        if stars and p["stars"] != stars:
            continue
        if loc and recruiting._miles(tuple(p["home"]), tuple(loc)) > persona.GAME_MILES - 50:
            continue
        used.add(pid)
        rc["prospects"][pid]["persona"] = {"personality": "guarded", "decider": "self", "decider_topic": None,
                                           "story": None, "story_data": {}, "commit_style": "hat"}
        return pid
    raise AssertionError("no prospect fits")


def listed(st, pid, schools):
    """His list: the schools in order, a few points apart."""
    for i, s in enumerate(schools):
        st["recruiting"]["lists"][pid][s] = 30.0 - 4 * i


def setup(st, pid, kind, seed=1):
    got = persona._setup(st, persona._Week(st, st["current_week"]), pid, kind, random.Random(seed))
    assert got, kind
    tw, line = got
    st["recruiting"].setdefault("twists", {})[pid] = tw
    recruiting._event(st, "twist", pid, tw.get("s"), twist=kind, line=line, **({"private": True} if kind == "beat" else {}))
    assert line[0].isupper() and line.endswith(".") and "None" not in line and "null" not in line, line
    return tw


def order(st, pid):
    rc = st["recruiting"]
    schools = set(rc["lists"][pid]) | {s for s, pids in rc["offers"].items() if pid in pids}
    return sorted(schools, key=lambda s: -recruiting.interest(st, s, pid))


def pts(st, slug, pid, action, pitch):
    rc = st["recruiting"]
    rc["contacts"].get(pid, {}).pop(slug, None)
    rc["pending"], rc["why_week"], rc["scenes"] = {}, {}, {}
    rc["hours"][slug] = 1000
    recruiting._act(st, slug, pid, action, pitch)
    return recruiting.pending(st, slug, pid)


def test_surprise(st, used):
    pid = plain(st, used)
    schools = [ME, "michigan", "texas", "georgia", "oregon", "lsu"]
    listed(st, pid, schools)
    tw = setup(st, pid, "surprise")
    assert tw["s"] in schools[3:] and set(tw["r"]) == set(schools[:3]) and tw["w"] == persona.SURPRISE_WEEKS, tw
    assert order(st, pid).index(tw["s"]) <= 2, "the surprise school jumps into his top three"
    # a top-three school's call knocks it back (yours logs a line); a message does not
    rc = st["recruiting"]
    rc["hours"][ME] = 500
    recruiting.act(st, ME, pid, "message", "playing_time")
    assert pid in rc["twists"]
    recruiting._act(st, ME, pid, "call", "playing_time")
    assert pid not in rc["twists"] and order(st, pid).index(tw["s"]) >= 3
    assert any(e["kind"] == "twist" and e.get("end") and e["pid"] == pid for e in rc["log"])
    # an AI school plays by the same rule; the twist runs out in two weeks if nobody calls
    q = plain(st, used)
    listed(st, q, schools)
    tw = setup(st, q, "surprise", seed=3)
    recruiting._act(st, tw["r"][1], q, "call", "coach")
    assert q not in rc["twists"]
    q2 = plain(st, used)
    listed(st, q2, schools)
    setup(st, q2, "surprise", seed=4)
    persona.twist_week(st, 4)
    assert q2 in rc["twists"]
    persona.twist_week(st, 5)
    assert q2 not in rc["twists"]
    print("  surprise visit ok")


def home_week(st, slug):
    return min(g["week"] for g in st["games"].values() if g["home"] == slug and g["kind"] == "regular" and not g["played"] and g["week"] > 1)


def play(st, slug, opp_week, margin):
    g = next(g for g in st["games"].values() if g["week"] == opp_week and slug in (g["home"], g["away"]))
    home = g["home"] == slug
    g["played"] = True
    g["home_score"], g["away_score"] = (30 + margin, 30) if home else (30, 30 + margin)
    return g


def test_at_game(base, used):
    for margin, want in ((7, "beat"), (28, "blow out"), (-3, "lose to")):
        st = copy.deepcopy(base)
        w = home_week(st, ME)
        st["current_week"] = w - 1
        pid = plain(st, set(used), near=ME)
        listed(st, pid, [ME, "michigan", "texas"])
        tw = setup(st, pid, "at_game")
        assert tw["s"] == ME and tw["g"] == w, tw
        rc = st["recruiting"]
        before = rc["lists"][pid][ME]
        interest = recruiting.interest(st, ME, pid)
        play(st, ME, w, margin)
        st["current_week"] = w
        persona.twist_week(st, w)
        line = next(e["line"] for e in reversed(rc["log"]) if e["kind"] == "twist" and e["pid"] == pid)
        assert want in line, line
        if margin > 0:
            mult = persona.GAME_BLOWOUT if margin >= persona.BLOWOUT else persona.GAME_WIN
            gain = rc["lists"][pid][ME] - before
            assert abs(gain - min(persona.GAME_CAP, (mult - 1) * interest)) < 0.01, (gain, interest)
        else:
            assert recruiting.cooled(st, ME, pid) and persona.cooled_why(st, ME, pid) == "game"
            st["current_week"] = w + 1
            assert not recruiting.cooled(st, ME, pid), "a loss cools him one week"
        assert pid not in rc["twists"]
    # nothing to go to: a prospect far from every school on his list has no At Your Game
    st = copy.deepcopy(base)
    rc = st["recruiting"]
    far = next(q for q in sorted(rc["prospects"]) if rc["prospects"][q]["hometown"]["state"] in ("HI", "AK") and not rc["lists"][q]) \
        if any(rc["prospects"][q]["hometown"]["state"] in ("HI", "AK") for q in rc["prospects"]) else None
    if far:
        listed(st, far, [ME, "michigan"])
        assert persona._setup(st, persona._Week(st, 3), far, "at_game", random.Random(1)) is None
    print("  at your game ok")


def test_hot_seat(st, used):
    pid = plain(st, used)
    listed(st, pid, ["michigan", ME, "texas"])
    from coach_career import league
    assert persona.security(st, "michigan") >= persona.HOT_SEAT, "a first season's coaches start off the hot seat (carousel.STANDING)"
    st["league"] = league.from_base(season.season_year(st) + 1)       # a second season: the career's league and its ADs
    recruiting.reset_caches()
    lg = st["league"]["teams"]["michigan"]
    lg["ad"] = {"patience": 3, "security": persona.HOT_SEAT + 10}
    assert persona._setup(st, persona._Week(st, 3), pid, "hot_seat", random.Random(1)) is None, "a safe coach is no hot seat"
    base_coach = pts(st, ME, pid, "message", "coach")
    base_pt = pts(st, ME, pid, "message", "playing_time")
    base_theirs = pts(st, "michigan", pid, "message", "coach")
    lg["ad"]["security"] = persona.HOT_SEAT - 5
    tw = setup(st, pid, "hot_seat")
    assert tw["s"] == "michigan" and tw["w"] == persona.HOT_SEAT_WEEKS
    assert abs(pts(st, ME, pid, "message", "coach") - base_coach * persona.HOT_SEAT_PITCH) < 1e-9
    assert abs(pts(st, ME, pid, "message", "playing_time") - base_pt) < 1e-9
    assert abs(pts(st, "michigan", pid, "message", "coach") - base_theirs) < 1e-9, "the hot-seat school's own pitch is as usual"
    print("  hot seat ok")


def test_late_offer(st, used):
    from coach_career import programs
    pid = plain(st, used, stars=4)
    listed(st, pid, ["michigan", "texas", "georgia", "oregon"])
    rc = st["recruiting"]
    ask = rc["prospects"][pid]["nil_ask"]
    tw = setup(st, pid, "late_offer")
    school = tw["s"]
    assert programs.get(st, school)["tier"] == 1 and school != ME and pid in rc["offers"][school], school
    assert order(st, pid).index(school) <= 1, (order(st, pid), school)
    assert rc["prospects"][pid]["nil_ask"] == int(round(ask * persona.LATE_ASK))
    assert any(e["kind"] == "offer" and e["pid"] == pid and e["school"] == school for e in rc["log"])
    # the news, for a blue chip
    items = [x for x in news._recruiting(st, season.load_teams(), st["current_week"]) if x["link"].get("pid") == pid]
    assert items and "jumps in late" in items[0]["text"], items
    # a two-star never gets one
    two = plain(st, used, stars=2)
    assert persona._setup(st, persona._Week(st, 3), two, "late_offer", random.Random(1)) is None
    print("  late offer ok")


def test_family_move(st, used):
    pid = plain(st, used)
    rc = st["recruiting"]
    p = rc["prospects"][pid]
    home = p["hometown"]["state"]
    prox = {s: recruiting.pull(st, s, pid)["proximity"] for s in ("michigan", "texas", "usc", "georgia")}
    tw = setup(st, pid, "family_move")
    m = rc["moved"][pid]
    assert m["state"] != home and tw["s"] is None
    after = {s: recruiting.pull(st, s, pid)["proximity"] for s in prox}
    assert after != prox, "his proximity moved with his family"
    near = min(after, key=lambda s: recruiting._miles(tuple(m["home"]), tuple(recruiting._team_model(s)["location"])))
    assert after[near] == max(after.values())
    assert p["hometown"]["state"] == home, "his hometown (his high school) is kept; the move is its own record"
    # a Hometown Hero's state moves too
    p["persona"] = dict(p["persona"], story="hero", story_data={"state": home})
    new_state = next(s for s in recruiting.fbs_schools(st) if persona.school_state(s) == m["state"]) if any(
        persona.school_state(s) == m["state"] for s in recruiting.fbs_schools(st)) else None
    old_state = next(s for s in recruiting.fbs_schools(st) if persona.school_state(s) == home) if any(
        persona.school_state(s) == home for s in recruiting.fbs_schools(st)) else None
    if new_state:
        raw = recruiting.PULL_SCALE * 0 + persona.story_interest(st, new_state, pid, 10.0)
        assert raw == 10.0 * persona.HERO_STATE, raw
    if old_state:
        assert persona.story_interest(st, old_state, pid, 10.0) == 10.0
    print("  family move ok")


def test_grades(st, used):
    rc = st["recruiting"]
    pid = plain(st, used)
    rc["boards"].setdefault("stanford", []).append(pid)
    rc["offers"].setdefault("stanford", []).append(pid)
    rc["boards"].setdefault("duke", []).append(pid)
    base_out = pts(st, "texas", pid, "message", "academics")
    base_in = pts(st, "stanford", pid, "message", "academics")
    base_other = pts(st, "texas", pid, "message", "coach")
    tw = setup(st, pid, "grades")
    assert tw["w"] == persona.GRADES_WEEKS
    assert pid not in rc["boards"]["stanford"] and pid not in rc["offers"]["stanford"] and pid not in rc["boards"]["duke"]
    assert abs(pts(st, "texas", pid, "message", "academics") - base_out * persona.GRADES_PITCH) < 1e-9
    assert abs(pts(st, "stanford", pid, "message", "academics") - base_in) < 1e-9, "an academic school's own Academics pitch is as usual"
    assert abs(pts(st, "texas", pid, "message", "coach") - base_other) < 1e-9
    # while it lasts the academic AI schools keep him off their boards
    rc["boards"]["stanford"].insert(0, pid)
    recruiting.auto_recruit(st, "stanford", random.Random(1))
    assert pid not in rc["boards"]["stanford"] and pid not in rc["offers"]["stanford"]
    # nobody academic after him: no scare
    q = plain(st, used)
    for s in recruiting.ACADEMIC:
        assert q not in (rc["boards"].get(s) or ()) or s == ME
    if not any(q in (rc["boards"].get(s) or ()) for s in recruiting.ACADEMIC):
        assert persona._setup(st, persona._Week(st, 3), q, "grades", random.Random(1)) is None
    print("  grades scare ok")


def test_beat(base, used):
    for margin in (10, -10):
        st = copy.deepcopy(base)
        st["current_week"] = 3
        pid = plain(st, set(used))
        listed(st, pid, [ME, "michigan", "texas"])
        rc = st["recruiting"]
        tw = None
        for seed in range(40):
            got = persona._setup(st, persona._Week(st, 3), pid, "beat", random.Random(seed))
            if got and got[0]["s"] == ME:
                tw, line = got
                break
        assert tw, "he names one of your next opponents"
        rc.setdefault("twists", {})[pid] = tw
        recruiting._event(st, "twist", pid, ME, twist="beat", line=line, private=True)
        assert 3 < tw["g"] <= 3 + persona.BEAT_AHEAD and tw["o"] in season.load_teams()
        v = persona.twist_view(st, ME, pid)
        assert v["label"].startswith("Wants to See You Beat ") and v["line"] == line, v
        assert persona.twist_view(st, "michigan", pid) is None, "only the school he told"
        assert not [h for h in prospects.history_index(st, "michigan").get(pid, []) if h["kind"] == "twist"]
        before = rc["lists"][pid][ME]
        play(st, ME, tw["g"], margin)
        for w in range(4, tw["g"] + 1):
            st["current_week"] = w
            persona.twist_week(st, w)
        delta = rc["lists"][pid][ME] - before
        assert abs(delta - (persona.BEAT_WIN if margin > 0 else -persona.BEAT_LOSS)) < 1e-9, delta
        assert pid not in rc["twists"]
    print("  wants to see you beat ok")


def test_report_and_save(st, used):
    rc = st["recruiting"]
    pid = plain(st, used)
    listed(st, pid, ["michigan", "texas", "georgia", "oregon", ME])
    rc["board"].append(pid)
    setup(st, pid, "surprise")
    report = recruiting._report(st, st["current_week"])
    row = next(r for r in report["rows"] if r["pid"] == pid)
    assert any(e["kind"] == "twist" and e["line"] for e in row["events"]), row["events"]
    prof = prospects.profile(st, pid, ME)
    assert prof["twist"]["label"] == "Surprise Visit" and prof["twist"]["weeks_left"] == persona.SURPRISE_WEEKS and prof["twist"]["line"]
    board = prospects.board_row(st, pid, ME)
    assert board["twist"]["key"] == "surprise"
    hist = prospects.history_index(st, ME)[pid]
    assert any(h["kind"] == "twist" and h["line"] for h in hist)
    for tw in rc["twists"].values():
        assert set(tw) <= {"k", "s", "w", "b", "r", "g", "o"}, tw
    size = len(json.dumps(rc["twists"])) / max(1, len(rc["twists"]))
    assert size < 120, size
    print("  report, profile and save ok")


def test_determinism_and_rate():
    st = season.new_season("georgia", "full", seed=2, career=True)
    season.advance_to(st, 5)
    a, b = copy.deepcopy(st), copy.deepcopy(st)
    ea = persona.roll_twists(a, 5)
    eb = persona.roll_twists(b, 5)
    assert ea and [(e["pid"], e["twist"], e["line"]) for e in ea] == [(e["pid"], e["twist"], e["line"]) for e in eb]
    assert a["recruiting"]["twists"] == b["recruiting"]["twists"]
    season.advance_to(st, season.SELECTION_WEEK)
    rc = st["recruiting"]
    starts = [e for e in rc["log"] if e["kind"] == "twist" and not e.get("end")]      # a twist's start (not its game or a knock-back)
    kinds = {k: sum(1 for e in starts if e["twist"] == k) for k in persona.TWISTS}
    assert all(kinds[k] for k in persona.TWISTS if k != "hot_seat"), kinds          # a first season has no coach on the hot seat
    top = {q for q, p in rc["prospects"].items() if p["rank"] <= 1000}
    per = sum(1 for e in starts if e["pid"] in top) / len(top)
    blue = {q for q in top if (rc["prospects"][q].get("real") or rc["prospects"][q])["stars"] >= 4}
    per_blue = sum(1 for e in starts if e["pid"] in blue) / max(1, len(blue))
    assert 0.5 <= per <= 1.5, per
    assert per_blue >= per, (per_blue, per)
    # an FCS stand-in's placeholder name never reaches a line: it is only ever its region label ("FCS Gulf Coast"),
    # and no recruit asks a school to beat an FCS team
    from sim import fcs_names
    texts = [e.get("line") or "" for e in rc["log"]] + [persona.twist_label(t) for t in (rc.get("twists") or {}).values()]
    leaked = [x for x in texts if fcs_names.has_old(x)]
    assert not leaked, f"FCS stand-in placeholder names in twist lines: {leaked[:3]}"
    labels = {t["name"] for t in season.load_teams().values() if t.get("fictional")}
    assert labels and all(n.startswith("FCS ") for n in labels), labels
    fbs_only = [e for e in starts if e["twist"] == "beat"]
    assert all(not (season.load_teams().get(rc["twists"].get(e["pid"], {}).get("o")) or {}).get("fictional") for e in fbs_only if e["pid"] in (rc.get("twists") or {}))
    print(f"  determinism and rate ok: {per:.2f} twists a top-1000 recruit, {per_blue:.2f} a blue chip; {kinds}; no stand-in names")


if __name__ == "__main__":
    base = fresh()
    used: set = set()
    st = copy.deepcopy(base)
    test_surprise(st, used)
    test_at_game(base, used)
    test_hot_seat(copy.deepcopy(base), used)
    test_late_offer(copy.deepcopy(base), used)
    test_family_move(copy.deepcopy(base), used)
    test_grades(copy.deepcopy(base), used)
    test_beat(base, used)
    test_report_and_save(copy.deepcopy(base), used)
    test_determinism_and_rate()
    print("test_twists: ok")
