"""A call's lines agree with the facts (coach_career/scenes.py `facts`, `truth`): at two and five, leading with
Winning Now gets an honest line from you and a skeptical one from him, and your opening says "building a
winner", never "winning right away"; at six and one the confident lines come back. A topic you cannot claim
(a long way from his home) is said honestly in your opening and your lead. An in-home visit's note on his
family's NIL ask uses numerals and the game's NIL words and says where your NIL stands. Native; the engine's `act`
path, a North Texas career with its record forced. (Run as a file.)"""
import shutil
import sys as _sys
import tempfile
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `from sim import season` works from here

from coach_career import persona, recruiting, scenes
from sim import season

ME = "north-texas"
CLAIMS = ("built to win now", "not slowing down", "You guys win", "{school} wins".replace("{school}", "North Texas"),
          "winning right away", "title every year", "you've been good")


def played(st: dict) -> list[dict]:
    return sorted((g for g in st["games"].values() if g.get("played") and ME in (g["home"], g["away"])), key=lambda g: g["week"])


def force_record(st: dict, results: list[bool]) -> None:
    """His school's played games, in week order, won or lost as `results` says (the scores rewritten)."""
    games = played(st)
    assert len(games) == len(results), (len(games), len(results))
    for g, won in zip(games, results):
        mine, theirs = (31, 10) if won else (10, 31)
        g["home_score"], g["away_score"] = (mine, theirs) if g["home"] == ME else (theirs, mine)
    recruiting.reset_caches()                       # this week's on-field standing is read again


def career(seed: int = 3) -> dict:
    st = season.new_season(ME, "full", seed=seed, career=True)
    season.advance_to(st, 1)
    while len(played(st)) < 7:
        season.advance_to(st, st["current_week"] + 1)
    return st


def recruits(st: dict, n: int) -> list[str]:
    """`n` fresh prospects, each made a plain one (All Business, decides himself) who cares about winning first."""
    rc = st["recruiting"]
    out = []
    for pid in sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"]):
        p = rc["prospects"][pid]
        if p.get("hidden") or rc["status"][pid]["committed"] or ME in rc["contacts"].get(pid, {}) or recruiting.would_pester(st, ME, pid):
            continue
        p["persona"] = {"personality": "business", "decider": "self", "decider_topic": None, "story": None}
        p["priorities"] = ["winning"] + [t for t in p["priorities"] if t != "winning"][:2]
        (rc.get("twists") or {}).pop(pid, None)
        out.append(pid)
        if len(out) == n:
            return out
    raise AssertionError("not enough prospects")


def call(st: dict, pid: str, topics: list[str], winning: float = 0.45) -> tuple[dict, dict]:
    """A call: open, present `topics`, lead with Winning Now (his strength there forced, a Fair case). The scene and his reaction."""
    st["recruiting"]["hours"][ME] = 1000
    with recruiting.forced_strength(st, ME, pid, "winning", winning):
        sc = recruiting.act(st, ME, pid, "call")["scene"]
        sc = recruiting.act(st, ME, pid, "present", scene=sc["id"], topics=topics)["scene"]
        if sc["question"]:
            recruiting.act(st, ME, pid, "answer", scene=sc["id"], answer="straight")
        r = recruiting.act(st, ME, pid, "pitch", pitch="winning", scene=sc["id"])
    return sc, r["reaction"]


def said(sc: dict) -> str:
    """Your opening: the three things."""
    return next(t["text"] for t in sc["turns"] if t["who"] == "you" and any(s in t["text"] for s in ("nutshell", "what we're about", "Three things")))


def test_losing(st: dict) -> None:
    force_record(st, [True, True, False, False, False, False, False])
    fx = scenes.facts(st, ME)
    assert (fx["w"], fx["l"]) == (2, 5) and fx["form"] == "losing" and fx["last_won"] is False and fx["streak"] == -5, fx
    for pid in recruits(st, 6):
        sc, re = call(st, pid, ["winning", "nil", "coach"])
        assert re["kind"] == "hit", re                                  # a Fair case on his priority still lands
        f = scenes._fields(st, ME, st["recruiting"]["prospects"][pid])
        doubt = {x.format(**f) for v in scenes.WIN_DOUBT.values() for x in v}
        assert scenes.bare_reaction(re["text"]) in doubt, re   # the skeptical variant, every time (he may note you said it already)
        assert "two and five" in re["text"].lower() or "won before" in re["text"], re
        honest = {x.format(**f) for k, x in scenes.LEAD_WINNING.items() if k.startswith("losing")}
        assert re["you"] in honest, re
        assert "not where we want to be" in re["you"], re
        opening = said(sc)
        assert "building a winner" in opening and "winning right away" not in opening, opening
        for line in [t["text"] for t in sc["turns"] if t["text"] != sc["cue"]["text"]] + [re["you"], re["text"]]:    # his cue is what he wants, not a claim
            assert not any(c in line for c in CLAIMS), line
            assert "None" not in line and "{" not in line and "undefined" not in line, line
        # a long way from home: your opening and your lead say so honestly
        with recruiting.forced_strength(st, ME, pid, "proximity", 0.1):
            tr = scenes.truth(st, ME, pid)
            assert not tr["proximity"] and scenes.said_phrase(tr, "proximity") == "a home away from home"
            assert scenes.lead_line(tr, "proximity") == scenes.LEAD_HONEST["proximity"]
        with recruiting.forced_strength(st, ME, pid, "proximity", 0.9):
            tr = scenes.truth(st, ME, pid)
            assert scenes.said_phrase(tr, "proximity") == "staying close to home" and scenes.lead_line(tr, "proximity") == scenes.LEAD_LINES["proximity"]


def test_opening_names_only_strengths(st: dict) -> None:
    """The opening's three things: a strength you have in its own words, one you lack in honest ones."""
    pid = recruits(st, 1)[0]
    rc = st["recruiting"]
    s = recruiting.strengths(st, ME, pid)
    topics = ["winning", "proximity", "prestige"]
    st["recruiting"]["hours"][ME] = 1000
    sc = recruiting.act(st, ME, pid, "call")["scene"]
    sc = recruiting.act(st, ME, pid, "present", scene=sc["id"], topics=topics)["scene"]
    text = said(sc)
    tr = scenes.truth(st, ME, pid)
    for t in topics:
        claim = t != "winning" and s[t] >= scenes.CLAIM_FROM or t == "winning" and tr["winning"]
        assert (scenes.PHRASES[t] in text) == claim, (t, s[t], text)
        if not claim:
            assert scenes.SAID_HONEST[t] in text, (t, text)
    assert rc["scenes"][ME][pid]


SPELLED = ("one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "twenty", "thirty", "forty", "fifty",
           "sixty", "seventy", "eighty", "ninety", "hundred")


def test_ask_note(st: dict) -> None:
    """An in-home visit's note on his family's NIL ask: the ask His Ask shows, in numerals and NIL words, never
    "points" or a spelled-out number; your NIL left, and when the ask is more than you can put up, it says so."""
    import re
    pid = recruits(st, 1)[0]
    rc = st["recruiting"]
    st["recruiting"]["hours"][ME] = 1000
    sc = recruiting.act(st, ME, pid, "hc_visit")["scene"]
    sc = recruiting.act(st, ME, pid, "present", scene=sc["id"], topics=["winning", "nil", "coach"])["scene"]
    ask = recruiting.ask_view(st, ME, pid)
    assert sc["ask"] == ask and ask.get("exact") is not None, (sc["ask"], ask)    # the scene's ask is the profile's
    note = next(t["text"] for t in sc["turns"] if t["who"] == "note" and ("NIL" in t["text"] or "money" in t["text"]))
    n = ask["exact"]

    def plain(text):
        assert re.search(r"\d", text) and "points" not in text and "collective" not in text, text
        assert not any(re.search(rf"\b{w}\b", text.lower()) for w in SPELLED), text
        assert text[0].isupper() and text.endswith("."), text

    if n:
        plain(note)
        assert str(n) in note, note
        assert str(recruiting.nil_left(st, ME)) in note, note
    # more than you have left: it says so, with what you have
    nil = recruiting._nil(st, ME)
    keep = nil["budget"]
    nil["budget"] = sum(nil["held"].values()) + 40
    try:
        big = scenes.ask_note(st, ME, pid, {"exact": 115})
        plain(big)
        who = scenes.ASK_WHO[persona.of(st, pid)["decider"]]          # the one who decides speaks to the money
        assert big == f"{who} wants 115 in NIL, more than you have left (40).", big
        small = scenes.ask_note(st, ME, pid, {"exact": 30})
        plain(small)
        assert "30" in small and "You have 40 NIL left." in small, small
        rng = scenes.ask_note(st, ME, pid, {"lo": 90, "hi": 140})     # before a number: the middle of the range His Ask shows
        plain(rng)
        assert "about 115" in rng, rng
        assert scenes.ask_note(st, ME, pid, {"exact": 0}) == f"{who} says the money isn't the point."
    finally:
        nil["budget"] = keep
    assert rc["scenes"][ME].get(pid) is not None


def test_winning(st: dict) -> None:
    force_record(st, [False, True, True, True, True, True, True])
    fx = scenes.facts(st, ME)
    assert (fx["w"], fx["l"]) == (6, 1) and fx["form"] == "hot" and fx["streak"] == 6, fx
    confident = {scenes.LEAD_LINES["winning"], scenes.LEAD_WINNING["ranked"]}
    generic = 0
    for pid in recruits(st, 6):
        sc, re = call(st, pid, ["winning", "nil", "coach"], winning=0.8)
        f = scenes._fields(st, ME, st["recruiting"]["prospects"][pid])
        assert re["kind"] == "hit" and re["you"] in confident, re
        hits = {x.format(**f) for x in scenes.LINES["winning"]["hit"] if scenes._holds(x, scenes.truth(st, ME, pid))}
        mine = {x.format(**f) for x in persona.LINES["business"]["hit"]}
        assert scenes.bare_reaction(re["text"]) in hits | mine, re
        generic += scenes.bare_reaction(re["text"]) in hits
        assert "winning right away" in said(sc), said(sc)
    assert generic, "the confident hit lines appear"


def test_preseason_and_even() -> None:
    """The form in words without a career: before a game (last season), and an even record."""
    tr = {"form": "even", "history": False, "facts": {"cw": 2, "cl": 1, "rank": None}, "winning": False}
    assert scenes.lead_line(tr, "winning") == scenes.LEAD_WINNING["even_conf"]
    tr["facts"]["cw"] = 0
    assert scenes.lead_line(tr, "winning") == scenes.LEAD_WINNING["even"]
    tr = {"form": "pre_down", "history": False, "facts": {"cw": 0, "cl": 0, "rank": None}, "winning": False}
    assert scenes.lead_line(tr, "winning") == scenes.LEAD_WINNING["pre_down"]
    line, fixed = scenes.true_line(tr, "winning", "hit", "You guys win. I notice that, Coach.", "x")
    assert fixed and line in scenes.WIN_DOUBT["pre_down"], line
    tr = {"form": "hot", "history": False, "facts": {"cw": 3, "cl": 0, "rank": 9}, "winning": True}
    assert scenes.lead_line(tr, "winning") == scenes.LEAD_WINNING["ranked"]
    line, fixed = scenes.true_line(tr, "winning", "hit", "Playing for a title every year? Yes sir.", "x")
    assert fixed and line in scenes.LINES["winning"]["hit"] and "every year" not in line, line
    # every claim names a real line and a real truth
    every = {x for k in scenes.LINES.values() for v in k.values() for x in v}
    for line, need in scenes.NEEDS.items():
        for k in (need,) if isinstance(need, str) else need:
            assert line in every and k.lstrip("!") in ("proximity", "playing_time", "prestige", "nil", "academics", "winning", "history", "pro", "pro_spot", "pro_any") + scenes.GRADE_TOPICS, line
    for line in [scenes.LEAD_HONEST_PRO_SOME, scenes.LEAD_PRO_PROGRAM] + [x for v in scenes.WIN_DOUBT.values() for x in v] + [x for v in scenes.HONEST_HIT.values() for x in v] \
            + list(scenes.LEAD_WINNING.values()) + list(scenes.LEAD_HONEST.values()):
        text = line.format(**dict({k: "x" for k in scenes.FIELDS}, record="Two and five", school="North Texas", town="Spring"))
        assert text[0].isupper() and text.rstrip()[-1] in ".?!", line


if __name__ == "__main__":
    season.SEASONS_DIR = _Path(tempfile.mkdtemp(prefix="cfp-truth-"))
    try:
        test_preseason_and_even()
        st = career()
        test_losing(st)
        test_opening_names_only_strengths(st)
        test_ask_note(st)
        test_winning(st)
        print("scene truth ok")
    finally:
        shutil.rmtree(season.SEASONS_DIR, ignore_errors=True)
