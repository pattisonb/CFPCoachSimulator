"""Calls and in-home visits read as a conversation (coach_career/scenes.py): you open, he answers with
small talk that knows the week, you present your program (three things), he reacts, you ask, he
answers with the cue; a visit adds the room and his dad's ask; his question is introduced. Every
line in every table formats with the full field set. Native; the engine's `act` path. (Run as a file.)"""
import random
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `from sim import season` works from here

from coach_career import recruiting
from coach_career import scenes
from sim import season

ME = "smu"
WON_MARKS = ("beat", "win")
LOST_MARKS = ("lost to", "Tough", "got you")


def refused(fn, code: int, message: str = None) -> None:
    try:
        fn()
    except recruiting.RecruitingError as e:
        assert e.code == code and (message is None or e.message == message), (e.code, e.message)
        return
    raise AssertionError(f"expected {code} {message!r}")


def walk(table):
    """Every string in a table (lists and dicts nested any way)."""
    if isinstance(table, str):
        yield table
    elif isinstance(table, dict):
        for v in table.values():
            yield from walk(v)
    else:
        for v in table:
            yield from walk(v)


def cold(st: dict, used: set, want=None) -> str:
    """A visible uncommitted prospect your school has not touched, passing `want(pid)`."""
    rc = st["recruiting"]
    for pid in recruiting.prospect_list(st):
        if pid in used or ME in rc["contacts"].get(pid, {}) or rc["status"][pid]["committed"] or rc["prospects"][pid].get("hidden"):
            continue
        if want and not want(pid):
            continue
        used.add(pid)
        return pid
    raise AssertionError("no such prospect")


def act(st: dict, pid: str, action: str, **kw) -> dict:
    st["recruiting"]["hours"][ME] = 1000
    return recruiting.act(st, ME, pid, action, **kw)


def whos(sc: dict) -> list[str]:
    return [t["who"] for t in sc["turns"]]


def test_tables() -> None:
    f = {k: "X" for k in scenes.FIELDS}
    for name, table in scenes.TABLES.items():
        for line in walk(table):
            out = line.format(**f)
            assert "{" not in out and "}" not in out, (name, line)
            assert out.strip(), (name, line)
    qf = {"ahead": "X", "ahead_cls": "X", "position": "X", "other": "X"}
    for line in walk(scenes.QUESTION_LINES):
        assert "{" not in line.format(**qf), line
    for line in scenes.LINES["_two_sided"]["cue"]:
        assert line.rstrip().endswith("."), line
        assert "{a}" in line and "{b}" in line and line[:line.index("{a}")].strip(), f"a two-sided cue needs a lead-in before {{a}}: {line}"
    # American spelling in his lines
    for name, table in scenes.TABLES.items():
        for line in walk(table):
            assert "favourite" not in line.lower() and "colour" not in line.lower(), (name, line)
    assert set(scenes.LEAD_LINES) == set(recruiting.PITCHES) and set(scenes.PHRASES) == set(recruiting.PITCHES)


def test_first_call(st: dict, used: set) -> dict:
    """A first call: you open (his first name, your last name), he answers about Saturday's game, the
    cue and his question wait on your opening; `lines` is his turns' texts."""
    rc = st["recruiting"]
    week = st["current_week"]
    game = scenes.last_game(st, ME, week)
    assert game and game["week"] >= week - 1, "one week in: a game this past Saturday"
    coach = scenes.coach_name(st, ME)
    seen_game = 0
    out = None
    for _ in range(12):
        pid = cold(st, used, lambda q: not recruiting.would_pester(st, ME, q))
        p = rc["prospects"][pid]
        sc = act(st, pid, "call")["scene"]
        assert whos(sc) == ["you", "him"], whos(sc)
        assert sc["cue"] is None and sc["question"] is None and sc["presented"] is None and sc["tired"] is False
        you, him = sc["turns"]
        assert p["name"].split()[0] in you["text"] and coach in you["text"], you
        first = {line.format(**scenes._fields(st, ME, p, week)) for line in scenes.OPEN["first"]}
        assert you["text"] in first, you
        assert sc["lines"] == [him["text"]]
        if game["opponent"] in him["text"]:
            seen_game += 1
            marks = WON_MARKS if game["won"] else LOST_MARKS
            assert any(m in him["text"] for m in marks), (him, game)
            wrong = LOST_MARKS if game["won"] else WON_MARKS
            assert not any(m in him["text"] for m in wrong), (him, game)
        assert "{" not in you["text"] + him["text"] and "None" not in you["text"] + him["text"]
        # before the opening: no pitch
        refused(lambda: act(st, pid, "pitch", pitch="winning", scene=sc["id"]), 409, "present your program first")
        refused(lambda: act(st, pid, "present", scene=sc["id"], topics=["winning", "nil"]), 400)
        refused(lambda: act(st, pid, "present", scene=sc["id"], topics=["winning", "nil", "nil"]), 400)
        refused(lambda: act(st, pid, "present", scene=sc["id"], topics=["winning", "nil", "hats"]), 400)
        refused(lambda: act(st, pid, "present", scene="nope", topics=["winning", "nil", "coach"]), 409, "no call or visit open")
        out = out or (pid, sc)
    assert seen_game == 12, f"the Saturday after a game, his small talk is about it ({seen_game} of 12)"
    return out


def test_present(st: dict, pid: str, sc: dict) -> None:
    """Your opening: your turn, his reaction, your question, his cue (the fourth turn after the opening,
    `cue.text`); presenting twice is refused; the lead-with then goes out and his reaction carries your line."""
    rc = st["recruiting"]
    p = rc["prospects"][pid]
    topics = [t for t in recruiting.PITCHES if t not in p["priorities"]][:3]
    r = act(st, pid, "present", scene=sc["id"], topics=topics)
    sc2 = r["scene"]
    assert sc2 is rc["scenes"][ME][pid] and sc2["presented"] == topics and sc2["present"]["kind"] == "polite" and r["points"] == 0.0 and r["hit"] == []
    kinds = whos(sc2)
    assert kinds[:6] == ["you", "him", "you", "him", "you", "him"], kinds
    said, react, ask, cue = sc2["turns"][2:6]
    for t in topics:
        assert scenes.PHRASES[t] in said["text"], (t, said)
    assert react["text"] in scenes.PRESENT_LINES["polite"], react
    assert ask["text"] in {line.format(first=p["name"].split()[0]) for line in scenes.ASK["one"] + scenes.ASK["two"]}, ask
    assert (ask["text"] in {line.format(first=p["name"].split()[0]) for line in scenes.ASK["two"]}) == (len(sc2["cue"]["topics"]) == 2)
    assert cue["text"] == sc2["cue"]["text"] and cue["who"] == "him"
    assert sc2["lines"] == [t["text"] for t in sc2["turns"] if t["who"] == "him"]
    if sc2["question"]:
        assert sc2["turns"][-1]["text"] == scenes.QUESTION_INTRO and sc2["turns"][-1]["who"] == "him"
        act(st, pid, "answer", scene=sc["id"], answer="deflect")
    refused(lambda: act(st, pid, "present", scene=sc["id"], topics=topics), 409, "you already presented")
    e = [x for x in rc["log"] if x["kind"] == "present" and x["pid"] == pid][-1]
    assert e["topics"] == topics and e["hit"] == 0 and e["action"] == "call" and e["school"] == ME
    r = act(st, pid, "pitch", pitch=sc2["cue"]["topics"][0], scene=sc["id"])
    re = r["reaction"]
    assert re["kind"] in ("hit", "polite", "quiet") and re["you"] == scenes.LEAD_LINES[sc2["cue"]["topics"][0]].format(**scenes._fields(st, ME, p))
    assert pid not in rc["scenes"][ME]


def test_present_points(st: dict, used: set) -> None:
    """A presented priority you are strong on earns points and a warm line naming it; a weak one costs;
    nothing of his earns nothing."""
    rc = st["recruiting"]
    week = st["current_week"]

    def fit(kind):
        def ok(q):
            if recruiting.would_pester(st, ME, q):
                return False
            p, s = rc["prospects"][q], recruiting.strengths(st, ME, q)
            strong = [t for t in p["priorities"] if s[t] >= recruiting.BACKFIRE]
            weak = [t for t in p["priorities"] if s[t] < recruiting.BACKFIRE]
            return bool(strong) if kind == "hit" else bool(weak) and len(recruiting.PITCHES) - len(p["priorities"]) >= 2
        return ok

    # a hit: the strongest presented priority is the one he names
    pid = cold(st, used, fit("hit"))
    p, s = rc["prospects"][pid], recruiting.strengths(st, ME, pid)
    strong = max((t for t in p["priorities"] if s[t] >= recruiting.BACKFIRE), key=lambda t: s[t])
    others = [t for t in recruiting.PITCHES if t not in p["priorities"]][:2]
    sc = act(st, pid, "call")["scene"]
    before = recruiting.pending(st, ME, pid)
    r = act(st, pid, "present", scene=sc["id"], topics=[strong] + others)
    want = recruiting.PRESENT_HIT * recruiting.BASE_POINTS["call"] * (1 + s[strong])
    assert abs(r["points"] - want) < 1e-9 and r["hit"] == [strong], (r["points"], want)
    assert abs(recruiting.pending(st, ME, pid) - before - want) < 1e-9
    assert rc["why_week"][pid][ME] == {"call": want}, "the points sit on the scene's action"
    react = r["scene"]["turns"][3]
    phrase = scenes.PHRASES[strong]
    assert react["who"] == "him" and (phrase in react["text"] or phrase[0].upper() + phrase[1:] in react["text"]), (react, strong)
    assert r["scene"]["present"] == {"kind": "hit", "hit": [strong]}
    assert strong not in (rc["revealed"].get(ME) or {}).get(pid, []), "a hit does not mark the priority known"
    # the cap: three strong priorities never pass the action's base
    assert recruiting.PRESENT_HIT * 3 * 2 > 1.0, "the cap matters: three strong hits would pass the base"
    # a weak one: the quiet line for that topic, negative points
    pid = cold(st, used, fit("quiet"))
    p, s = rc["prospects"][pid], recruiting.strengths(st, ME, pid)
    weak = next(t for t in p["priorities"] if s[t] < recruiting.BACKFIRE)
    others = [t for t in recruiting.PITCHES if t not in p["priorities"]][:2]
    sc = act(st, pid, "call")["scene"]
    r = act(st, pid, "present", scene=sc["id"], topics=others[:1] + [weak] + others[1:])
    want = -recruiting.BACKFIRE_COST * recruiting.PRESENT_HIT * recruiting.BASE_POINTS["call"]
    assert abs(r["points"] - want) < 1e-9 and r["hit"] == [] and r["scene"]["present"]["kind"] == "quiet", (r["points"], want)
    f = scenes._fields(st, ME, p, week)
    assert r["scene"]["turns"][3]["text"] in {line.format(**f) for line in scenes.LINES[weak]["quiet"]}, r["scene"]["turns"][3]
    assert any(e["kind"] == "not_buying" and e["pid"] == pid and e["topic"] == weak for e in rc["log"])


def test_repeat_and_visit(st: dict, used: set, talked: str) -> None:
    """The week after a call, you open with 'Good talking last week'; a visit opens with the room, your
    thanks in the living room, and after the cue his dad's ask."""
    rc = st["recruiting"]
    week = st["current_week"]
    p = rc["prospects"][talked]
    assert scenes.last_talk(st, ME, talked, week) == week - 1
    sc = act(st, talked, "call")["scene"]
    f = scenes._fields(st, ME, p, week)
    assert sc["turns"][0]["text"] in {line.format(**f) for line in scenes.OPEN["last_week"]}, sc["turns"][0]
    act(st, talked, "present", scene=sc["id"], topics=list(recruiting.PITCHES)[:3])
    # a visit
    pid = cold(st, used, lambda q: not recruiting.would_pester(st, ME, q))
    p = rc["prospects"][pid]
    sc = act(st, pid, "hc_visit")["scene"]
    assert whos(sc) == ["note", "you", "him"], whos(sc)
    f = scenes._fields(st, ME, p, week)
    assert sc["turns"][0]["text"] in {line.format(**f) for line in scenes.FAMILY}
    assert sc["turns"][1]["text"] in {line.format(**f) for line in scenes.VISIT_OPEN}
    assert sc["lines"] == [sc["turns"][2]["text"]], "the room is not his line"
    r = act(st, pid, "present", scene=sc["id"], topics=list(recruiting.PITCHES)[:3])
    sc = r["scene"]
    kinds = whos(sc)
    assert kinds[:7] == ["note", "you", "him", "you", "him", "you", "him"], kinds
    assert sc["turns"][6]["text"] == sc["cue"]["text"]
    assert sc["turns"][7]["who"] == "note" and sc["turns"][7]["text"].startswith("His dad"), sc["turns"][7]
    assert "{" not in " ".join(t["text"] for t in sc["turns"])
    # the visit's points land on the visit
    if r["points"]:
        assert set(rc["why_week"][pid][ME]) == {"hc_visit"}


def test_question_intro(st: dict, used: set) -> None:
    """His question comes introduced: 'Can I ask you something?' is the last turn, after the cue."""
    rate = scenes.QUESTION_RATE
    scenes.QUESTION_RATE = 1.0
    try:
        pid = cold(st, used, lambda q: "playing_time" in st["recruiting"]["prospects"][q]["priorities"]
                   and not recruiting.would_pester(st, ME, q) and (recruiting.ahead_of(st, ME, q) or recruiting.other_offered(st, ME, q)))
        sc = act(st, pid, "call")["scene"]
        assert sc["question"] is None
        sc = act(st, pid, "present", scene=sc["id"], topics=list(recruiting.PITCHES)[:3])["scene"]
        assert sc["question"] and sc["turns"][-1] == {"who": "him", "text": scenes.QUESTION_INTRO}
        assert sc["turns"][-2]["text"] == sc["cue"]["text"]
        assert sc["question"]["text"] not in sc["lines"], "the question is its own field, not a line"
    finally:
        scenes.QUESTION_RATE = rate


def test_tired(st: dict, used: set) -> None:
    """A call that pesters him: he is short on the phone, your opening earns nothing."""
    rc = st["recruiting"]
    pid = cold(st, used, lambda q: rc["lists"][q] and recruiting.not_considering(st, ME, q) and not recruiting._pester_exempt(st, ME, q))
    rc["contacts"].setdefault(pid, {})[ME] = {"n": recruiting.PESTER_FREE, "hc_week": None}
    assert recruiting.would_pester(st, ME, pid)
    sc = act(st, pid, "call")["scene"]
    assert sc["tired"] is True and sc["turns"][1]["text"] in scenes.CONTEXT["tired"], sc["turns"]
    p = rc["prospects"][pid]
    r = act(st, pid, "present", scene=sc["id"], topics=list(p["priorities"])[:3] if len(p["priorities"]) >= 3 else list(recruiting.PITCHES)[:3])
    assert r["points"] == 0.0 and r["scene"]["present"]["kind"] == "tired" and r["scene"]["turns"][3]["text"] in scenes.PRESENT_LINES["tired"]


if __name__ == "__main__":
    import shutil
    import tempfile
    season.SEASONS_DIR = _Path(tempfile.mkdtemp(prefix="cfp-scenes-"))
    try:
        test_tables()
        st = season.new_season(ME, "full", seed=11, career=True)
        season.advance_to(st, 2)
        used: set = set()
        talked, sc = test_first_call(st, used)
        test_present(st, talked, sc)
        test_present_points(st, used)
        test_question_intro(st, used)
        test_tired(st, used)
        season.advance_to(st, st["current_week"] + 1)
        test_repeat_and_visit(st, used, talked)
        print("scenes ok")
    finally:
        shutil.rmtree(season.SEASONS_DIR, ignore_errors=True)
