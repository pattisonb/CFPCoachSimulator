"""The persona review's fixes, through the API as the page calls it (app/api.py):
- what your staff learned stays in his History, never the week's news;
- a call that keeps his priority to himself (Guarded, a Shy recruit's first call) says nothing of how the pitch or
  the opening landed: the reaction kind is "guarded", the opening's History says he gave nothing away (hit None);
- the opening (present) scores with his personality and his decider as a pitch does: a Shy recruit's visit 1.5x,
  his decider's topic a hit;
- a pitch on his decider's topic lights him up (the words match the score);
- the profile carries the week's scouting points left;
- why he cooled (a lowball, silence for a Loves the Attention recruit) reaches the board;
- a transfer in the portal never draws a High School Coach or Grandmother decider, and the class draw stays put.
Saves go to a temporary folder. Run as a file."""
import shutil
import sys
import tempfile
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import api   # noqa: E402
from coach_career import persona, prospects, recruiting   # noqa: E402
from sim import season   # noqa: E402

ME = "ohio-state"


def G(sid, path):
    return api.call("GET", f"/api/season/{sid}/{path}")


def R(sid, body):
    return api.call("POST", f"/api/season/{sid}/recruit", body)


def new_career(seed=11, team=ME):
    sid = api.call("POST", "/api/season", {"team": team, "mode": "full", "seed": seed, "career": True})["id"]
    G(sid, "recruiting")
    return sid, api.loaded_state()


def force(st, pid, personality, decider="self", topic=None):
    st["recruiting"]["prospects"][pid]["persona"] = {"personality": personality, "decider": decider, "decider_topic": topic}


def cold(st, used, ok=lambda pid: True):
    rc = st["recruiting"]
    for pid in sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"]):
        if pid in used or rc["prospects"][pid].get("hidden") or rc["status"][pid]["committed"] or ME in rc["contacts"].get(pid, {}):
            continue
        if pid not in recruiting.visible(st) or not ok(pid):
            continue
        used.add(pid)
        return pid
    raise AssertionError("no prospect")


def strong_priority(st, pid):
    st_ = recruiting.strengths(st, ME, pid)
    return next((t for t in st["recruiting"]["prospects"][pid]["priorities"] if st_[t] >= recruiting.BACKFIRE), None)


def test_learned_not_news():
    sid, st = new_career(seed=23, team="smu")
    season.advance_to(st, 3)
    rc, me = st["recruiting"], st["team"]
    board = [q for q in recruiting.prospect_list(st) if not rc["prospects"][q].get("hidden")][:5]
    rc["board"] = board
    persona.learn(st, me, board[0], "personality")            # one learned this week, for sure
    week = st["current_week"]
    learned = [e for e in rc["log"] if e["kind"] == "learned" and e["week"] == week and e["pid"] in board]
    assert learned, "a learned line this week to keep out of the news"
    v = G(sid, "recruiting")
    assert v["recap"], "the week has other news"
    assert not [e for e in v["recap"] if e["kind"] == "learned"], [e for e in v["recap"] if e["kind"] == "learned"][:3]
    prof = G(sid, f"prospect/{board[0]}")
    hist = prof.get("history") or next(b for b in v["board"] if b["id"] == board[0]).get("history") or []
    assert any(e["kind"] == "learned" for e in hist), "it stays in his History"
    print("ok learned lines stay out of the news")


def test_no_tell_reaction_is_neutral():
    sid, st = new_career()
    used = set()
    for personality in ("guarded", "shy"):
        pid = cold(st, used, lambda q: strong_priority(st, q) is not None)
        force(st, pid, personality)
        st["recruiting"]["hours"][ME] = 1000
        top = strong_priority(st, pid)
        sc = R(sid, {"pid": pid, "action": "call"})["scene"]
        p = st["recruiting"]["prospects"][pid]
        topics = [top] + [t for t in recruiting.PITCHES if t != top][:2]
        pr = R(sid, {"pid": pid, "action": "present", "scene": sc["id"], "topics": topics})
        assert pr["scene"]["present"]["kind"] == "guarded" and pr["hit"] == [], pr["scene"]["present"]
        if pr["scene"]["question"]:
            R(sid, {"pid": pid, "action": "answer", "scene": sc["id"], "answer": "deflect"})
        r = R(sid, {"pid": pid, "action": "pitch", "scene": sc["id"], "pitch": top})
        assert r["reaction"]["kind"] == "guarded", (personality, r["reaction"])
        assert r["reaction"]["text"] and "{" not in r["reaction"]["text"]
        log = [e for e in st["recruiting"]["log"] if e["pid"] == pid and e.get("school") == ME]
        assert next(e for e in log if e["kind"] == "pitch")["reaction"] == "guarded", log
        assert next(e for e in log if e["kind"] == "present")["hit"] is None, log
        assert top in p["priorities"] and recruiting.pending(st, ME, pid) > 0, "he still weighs it: the points are unchanged"
    # a pitch that is none of his on a no-tell call: no topic's polite line (it would say it is not his)
    pid = cold(st, used)
    force(st, pid, "guarded")
    st["recruiting"]["hours"][ME] = 1000
    p = st["recruiting"]["prospects"][pid]
    miss = next(t for t in recruiting.PITCHES if t not in p["priorities"])
    sc = R(sid, {"pid": pid, "action": "call"})["scene"]
    R(sid, {"pid": pid, "action": "present", "scene": sc["id"], "topics": [t for t in recruiting.PITCHES if t not in p["priorities"]][:3]})
    if st["recruiting"]["scenes"][ME][pid]["question"]:
        R(sid, {"pid": pid, "action": "answer", "scene": sc["id"], "answer": "deflect"})
    r = R(sid, {"pid": pid, "action": "pitch", "scene": sc["id"], "pitch": miss})
    from coach_career import scenes
    f = scenes._fields(st, ME, p)
    assert r["reaction"]["kind"] == "guarded" and r["reaction"]["text"] not in [x.format(**f) for x in scenes.LINES[miss]["polite"]], r
    # a telling call still says how it landed
    pid = cold(st, used, lambda q: strong_priority(st, q) is not None)
    force(st, pid, "business")
    st["recruiting"]["hours"][ME] = 1000
    top = strong_priority(st, pid)
    sc = R(sid, {"pid": pid, "action": "call"})["scene"]
    pr = R(sid, {"pid": pid, "action": "present", "scene": sc["id"], "topics": [top] + [t for t in recruiting.PITCHES if t != top][:2]})
    assert pr["scene"]["present"]["kind"] == "hit" and top in pr["hit"], pr["scene"]["present"]
    if pr["scene"]["question"]:
        R(sid, {"pid": pid, "action": "answer", "scene": sc["id"], "answer": "deflect"})
    assert R(sid, {"pid": pid, "action": "pitch", "scene": sc["id"], "pitch": top})["reaction"]["kind"] == "hit"
    assert next(e for e in st["recruiting"]["log"] if e["pid"] == pid and e["kind"] == "present")["hit"] == 1
    print("ok a no-tell call gives nothing away")


def _present_points(personality, decider, topic, topics_of, action="hc_visit"):
    """A fresh career, one prospect forced to this persona, a visit (or call) and an opening: its points."""
    sid, st = new_career(seed=11)
    pid = cold(st, set(), lambda q: strong_priority(st, q) is not None and recruiting.strengths(st, ME, q)["academics"] >= recruiting.BACKFIRE
               and "academics" not in st["recruiting"]["prospects"][q]["priorities"])
    force(st, pid, personality, decider, topic)
    st["recruiting"]["hours"][ME] = 1000
    sc = R(sid, {"pid": pid, "action": action})["scene"]
    return R(sid, {"pid": pid, "action": "present", "scene": sc["id"], "topics": topics_of(st, pid)}), st, pid


def test_present_persona_points():
    prio = lambda st, pid: list(st["recruiting"]["prospects"][pid]["priorities"])
    shy, _, _ = _present_points("shy", "self", None, prio)
    plain, _, _ = _present_points("business", "self", None, prio)
    assert plain["points"] > 0 and abs(shy["points"] - recruiting.persona.SHY_VISIT * plain["points"]) < 1e-9, (shy["points"], plain["points"])
    # Mom cares about academics: academics counts as a hit in the opening (a call that tells)
    others = lambda st, pid: ["academics"] + [t for t in recruiting.PITCHES if t not in st["recruiting"]["prospects"][pid]["priorities"] and t != "academics"][:2]
    mom, st, pid = _present_points("business", "mom", "academics", others, action="call")
    assert mom["hit"] == ["academics"] and mom["points"] > 0 and mom["scene"]["present"]["kind"] == "hit", (mom["hit"], mom["points"])
    selfs, _, _ = _present_points("business", "self", None, others, action="call")
    assert selfs["hit"] == [] and selfs["points"] == 0 and selfs["scene"]["present"]["kind"] == "polite", selfs["hit"]
    print("ok the opening scores with his personality and decider")


def test_decider_topic_pitch_lights_him_up():
    for decider, topic, want in (("mom", "academics", "hit"), ("self", None, "polite")):
        sid, st = new_career(seed=11)
        pid = cold(st, set(), lambda q: recruiting.strengths(st, ME, q)["academics"] >= recruiting.BACKFIRE
                   and "academics" not in st["recruiting"]["prospects"][q]["priorities"])
        force(st, pid, "business", decider, topic)
        st["recruiting"]["hours"][ME] = 1000
        sc = R(sid, {"pid": pid, "action": "call"})["scene"]
        pr = R(sid, {"pid": pid, "action": "present", "scene": sc["id"], "topics": [t for t in recruiting.PITCHES if t != "academics"][:3]})
        if pr["scene"]["question"]:
            R(sid, {"pid": pid, "action": "answer", "scene": sc["id"], "answer": "deflect"})
        r = R(sid, {"pid": pid, "action": "pitch", "scene": sc["id"], "pitch": "academics"})
        assert r["reaction"]["kind"] == want, (decider, r["reaction"])
    print("ok a pitch on his decider's topic reads as it scores")


def test_profile_points_left():
    sid, st = new_career()
    pid = cold(st, set())
    prof = G(sid, f"prospect/{pid}")
    assert prof["points_left"] == recruiting.scout_points_left(st, ME) and prof["scout_cost"] is not None, prof["points_left"]
    print("ok the profile carries the scouting points left")


def test_cooled_why():
    sid, st = new_career()
    used = set()
    rc = st["recruiting"]
    # Loves the Attention, gone quiet two weeks: cooled for silence
    pid = cold(st, used)
    force(st, pid, "attention")
    rc["hours"][ME] = 1000
    R(sid, {"pid": pid, "action": "message", "pitch": "prestige"})
    rc["board"] = [pid]
    st["current_week"] += persona.ATTENTION_GAP
    persona.cool_quiet(st, st["current_week"])
    assert recruiting.cooled(st, ME, pid)
    b = next(x for x in G(sid, "recruiting")["board"] if x["id"] == pid)
    assert b["cooled"] and b["cooled_why"] == "quiet", (b["cooled"], b["cooled_why"])
    assert G(sid, f"prospect/{pid}")["cooled_why"] == "quiet"
    # a lowball: cooled for the offer
    pid2 = cold(st, used, lambda q: recruiting.ask_from(st, ME, q) >= recruiting.LOWBALL_MIN)
    force(st, pid2, "business")
    rc["board"] = [pid, pid2]
    R(sid, {"pid": pid2, "action": "offer", "pitch": "prestige", "nil": 0})
    b = next(x for x in G(sid, "recruiting")["board"] if x["id"] == pid2)
    assert b["cooled"] and b["cooled_why"] == "lowball", (b["cooled"], b["cooled_why"])
    # not cooled: no reason
    pid3 = cold(st, used)
    rc["board"].append(pid3)
    assert next(x for x in G(sid, "recruiting")["board"] if x["id"] == pid3)["cooled_why"] is None
    # an old save with no record: the lowball words
    rc.pop("cooled_why", None)
    assert persona.cooled_why(st, ME, pid) == "lowball"
    # the visit refusal says why
    rc["cooled_why"] = {ME: {pid: "quiet"}}
    try:
        recruiting.act(st, ME, pid, "official_visit")
        raise AssertionError("a visit while he is cooled")
    except recruiting.RecruitingError as e:
        assert e.code == 409 and "went quiet" in str(e), str(e)
    js = (ROOT / "web" / "recruiting.js").read_text()
    for words in ("He felt ignored: call or visit to warm him back up", "Cooled: he wants to hear from you", "Cooled: raise your offer first"):
        assert words in js, words
    print("ok why he cooled reaches the board")


def test_portal_deciders():
    seed = 7
    pids = [f"r2027-{i:04d}" for i in range(1, 4001)]
    portal = Counter(persona.draw(pid, seed, portal=True)["decider"] for pid in pids)
    assert set(portal) <= set(persona.PORTAL_DECIDERS) and len(portal) == 4, portal
    total = sum(persona.DECIDERS[d] for d in persona.PORTAL_DECIDERS)
    for d in persona.PORTAL_DECIDERS:
        assert abs(portal[d] / len(pids) - persona.DECIDERS[d] / total) < 0.03, (d, portal[d], persona.DECIDERS[d] / total)
    for pid in pids[:500]:
        a, b = persona.draw(pid, seed), persona.draw(pid, seed, portal=True)
        assert a["personality"] == b["personality"], "a transfer keeps his personality"
        assert a == persona.draw(pid, seed), "the class draw is unchanged"
    cls = Counter(persona.draw(pid, seed)["decider"] for pid in pids)
    assert cls["hs_coach"] and cls["grandma"], cls
    # through `of`: the portal flag picks the portal draw
    st = {"recruiting": {"seed": seed, "portal": True, "prospects": {pid: {"id": pid} for pid in pids[:400]}}}
    assert not {persona.of(st, pid)["decider"] for pid in pids[:400]} & {"hs_coach", "grandma"}
    print("ok a transfer's decider is Himself, Mom, Dad or Trainer")


if __name__ == "__main__":
    season.SEASONS_DIR = Path(tempfile.mkdtemp(prefix="cfp-persona-fixes-"))
    try:
        for name, fn in list(globals().items()):
            if name.startswith("test_") and callable(fn):
                fn()
        print("persona fixes: all passed")
    finally:
        shutil.rmtree(season.SEASONS_DIR, ignore_errors=True)
