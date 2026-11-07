"""His Story found out (persona.py, spec section 1's Discovery table): a Hometown Hero and an Injury Comeback
are public at once, a Late Bloomer's jump is public; a Legacy, a Two-Sport recruit and a bloomer before
his jump show at a complete report (3 looks); a Package Deal at the report or his first call. Until then
"Not Known Yet" (story None); a complete report with none says No Story. A learned story is a sentence
in his History only (a "learned" event, never the week's news). Each story has its lines: the decider
brings it up at an in-home visit (he does, when he decides himself), and a call's small talk sometimes
does once the school knows it. A hero's commitment makes the league news, as do a blue-chip bloomer's
jump and a blue-chip two-sport star going pro."""
import random
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))

from coach_career import persona, prospects, recruiting, scenes
from sim import news, season

ME = "ohio-state"


def fresh(seed=5):
    st = season.new_season(ME, "full", seed=seed, career=True)
    st["current_week"] = 1
    st["recruiting"]["hours"][ME] = 1000
    return st


def pick(st, used=()):
    rc = st["recruiting"]
    for pid in sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"]):
        p = rc["prospects"][pid]
        if pid not in used and not p.get("hidden") and not rc["status"][pid]["committed"] and ME not in rc["lists"][pid] \
                and not persona.story(st, pid)[0]:
            return pid
    raise AssertionError("no prospect")


def force(st, pid, kind, data=None, personality="business", decider="self", topic=None):
    st["recruiting"]["prospects"][pid]["persona"] = {"personality": personality, "decider": decider, "decider_topic": topic,
                                                     "story": kind, "story_data": data or {}, "commit_style": "hat"}   # a style that announces and drifts as usual


def report(st, pid):
    rng = random.Random(1)
    for _ in range(3):
        recruiting.look(st, pid, 70, rng, weight=1.0)
    assert recruiting.report_complete(st["recruiting"]["reads"][pid])


def learned(st, pid):
    return [e for e in st["recruiting"]["log"] if e["pid"] == pid and e["kind"] == "learned" and e.get("trait") == "story"]


if __name__ == "__main__":
    st = fresh()
    rc = st["recruiting"]
    teams = season.load_teams()

    # public at once: Hometown Hero and Injury Comeback
    a = pick(st)
    force(st, a, "hero", {"state": rc["prospects"][a]["hometown"]["state"]})
    v = persona.view(st, ME, a)
    assert v["story"] == "Hometown Hero" and v["story_key"] == "hero" and v["story_detail"] is None, v
    force(st, a, "comeback")
    assert persona.view(st, ME, a)["story"] == "Injury Comeback"
    assert not learned(st, a), "a public story is never news to your staff"

    # Legacy: Not Known Yet, then the complete report tells it, with his school; a History line
    b = pick(st, {a})
    force(st, b, "legacy", {"school": "michigan"})
    v = persona.view(st, ME, b)
    assert v["story"] is None and v["story_detail"] is None, v
    rng = random.Random(1)
    recruiting.look(st, b, 70, rng, weight=1.0)
    recruiting.look(st, b, 70, rng, weight=1.0)
    assert persona.view(st, ME, b)["story"] is None, "two looks tell who decides, not his story"
    recruiting.look(st, b, 70, rng, weight=1.0)
    v = persona.view(st, ME, b)
    assert v["story"] == "Legacy" and v["story_detail"] == teams["michigan"]["name"], v
    ev = learned(st, b)
    assert len(ev) == 1 and ev[0]["line"] == f"Your staff learned he is a legacy at {teams['michigan']['name']}.", ev
    assert "learned" in recruiting.HISTORY_ONLY and "learned" not in recruiting.REPORT_KINDS
    assert prospects.profile(st, b, ME)["traits"]["story"] == "Legacy"
    assert prospects.board_row(st, b, ME)["traits"]["story"] == "Legacy"

    # no story: a complete report says so
    c = pick(st, {a, b})
    assert persona.view(st, ME, c)["story"] is None
    report(st, c)
    assert persona.view(st, ME, c)["story"] == persona.NO_STORY and not learned(st, c)

    # Two-Sport: the report, then his Draft Risk from you in words
    d = pick(st, {a, b, c})
    force(st, d, "two_sport")
    assert persona.view(st, ME, d)["story"] is None
    report(st, d)
    v = persona.view(st, ME, d)
    assert v["story"] == "Two-Sport" and v["story_detail"] == "Draft Risk: High", v
    assert learned(st, d)[0]["line"] == "Your staff learned he could go pro in baseball."

    # Package Deal: his first call tells it, naming his mate
    e = pick(st, {a, b, c, d})
    m = pick(st, {a, b, c, d, e})
    force(st, e, "package", {"mate": m, "lead": True})
    force(st, m, "package", {"mate": e, "lead": False})
    recruiting.act(st, ME, e, "message")
    assert persona.view(st, ME, e)["story"] is None, "a message tells nothing"
    sc = recruiting.act(st, ME, e, "call")["scene"]
    mname = rc["prospects"][m]["name"]
    v = persona.view(st, ME, e)
    assert v["story"] == "Package Deal" and v["story_detail"] == f"With {mname}", v
    assert learned(st, e)[0]["line"] == f"Your staff learned he and {mname} want to go together."
    his = [t["text"] for t in sc["turns"] if t["who"] == "him"]
    assert any(mname in t or mname.split()[0] in t for t in his), ("his first call brings up his mate", his)

    # Late Bloomer: the report finds him early; the jump is public to everyone
    blooms = [(q, s["story_data"]) for q, s in persona.stories(st).items() if s["story"] == "bloomer"
              and not rc["prospects"][q].get("hidden")]
    q, data = blooms[0]
    assert persona.view(st, ME, q)["story"] is None
    persona.bloom(st, data["week"])
    assert persona.view(st, ME, q)["story"] == "Late Bloomer"
    q2, data2 = blooms[1]
    report(st, q2)
    assert persona.view(st, ME, q2)["story"] == "Late Bloomer" and learned(st, q2)[0]["line"] == "Your staff learned he is a late bloomer."

    # the decider brings his story up at an in-home visit (and you learn it); he does when he decides himself
    st = fresh(6)
    rc = st["recruiting"]
    f = pick(st)
    force(st, f, "legacy", {"school": "michigan"}, decider="dad", topic="nil")
    sc = recruiting.act(st, ME, f, "hc_visit")["scene"]
    fam = [t["text"] for t in sc["turns"] if t["who"] == "family"]
    want = {x.format(**scenes._fields(st, ME, rc["prospects"][f])) for x in persona.STORY_LINES["legacy"]["family"]}
    assert fam and fam[0] in want, (fam, want)
    assert persona.view(st, ME, f)["story"] == "Legacy", "a visit where it comes up tells you"
    g = pick(st, {f})
    force(st, g, "two_sport", decider="self")
    sc = recruiting.act(st, ME, g, "hc_visit")["scene"]
    his = [t["text"] for t in sc["turns"] if t["who"] == "him"]
    want = {x.format(**scenes._fields(st, ME, rc["prospects"][g])) for x in persona.STORY_LINES["two_sport"]["him"]}
    assert any(t in want for t in his), (his, want)
    # a call's small talk is his known story some of the time, never one the school does not know
    seen_known = seen_hidden = 0
    st["current_week"] = 2
    for i in range(40):
        rc["hours"][ME] = 1000
        h = pick(st, {f, g})
        force(st, h, "comeback", personality="attention")
        sc = recruiting.act(st, ME, h, "call")["scene"]
        pool = {x.format(**scenes._fields(st, ME, rc["prospects"][h])) for x in persona.STORY_LINES["comeback"]["him"]}
        seen_known += any(t["text"] in pool for t in sc["turns"] if t["who"] == "him")
        rc["scenes"] = {}
        k = pick(st, {f, g, h})
        force(st, k, "legacy", {"school": "michigan"}, personality="attention")
        sc = recruiting.act(st, ME, k, "call")["scene"]
        pool = {x.format(**scenes._fields(st, ME, rc["prospects"][k])) for x in persona.STORY_LINES["legacy"]["him"]}
        seen_hidden += any(t["text"] in pool for t in sc["turns"] if t["who"] == "him")
        rc["scenes"] = {}
        for q_ in (h, k):
            del rc["prospects"][q_]["persona"]
            rc["lists"][q_][ME] = rc["lists"][q_].get(ME, 0.0) + 0.001     # pick() skips him next time
    assert 4 <= seen_known <= 30, seen_known
    assert seen_hidden == 0, seen_hidden

    # every story line fills, has no digits, ends a sentence
    fill = {x: "X" for x in scenes.FIELDS}
    for kind, table in persona.STORY_LINES.items():
        assert set(table) == {"him", "family"} and kind in persona.STORIES, kind
        for who, lines in table.items():
            assert len(lines) >= 3, (kind, who)
            for line in lines:
                out = line.format(**fill)
                assert out[0].isupper() and out.rstrip()[-1] in ".!?" and not any(ch.isdigit() for ch in line), line
    for kind, table in persona.STORY_LINES_OFFERED.items():          # the Package Deal once his mate holds your offer: the same shape
        assert set(table) == {"him", "family"} and kind in persona.STORIES, kind
        for who, lines in table.items():
            assert len(lines) >= 3, (kind, who)
            for line in lines:
                out = line.format(**fill)
                assert "{mate}" in line and out[0].isupper() and out.rstrip()[-1] in ".!?" and not any(ch.isdigit() for ch in line), line
    for kind, line in persona.STORY_LEARNED.items():
        assert line.format(school="X", mate="Y").startswith("Your staff learned he ") and line.endswith("."), line

    # the news: a hero's commitment, a blue-chip bloomer's jump, a blue-chip two-sport star going pro
    st = fresh(7)
    rc = st["recruiting"]
    hero = pick(st)
    force(st, hero, "hero", {"state": rc["prospects"][hero]["hometown"]["state"]})
    st["current_week"] = 4
    rc["offers"].setdefault("texas", []).append(hero)
    recruiting._commit(st, hero, "texas")
    items = news._recruiting(st, teams, 4)
    mine = [x for x in items if x["link"].get("pid") == hero]
    assert mine and "Hometown hero" in mine[0]["text"] and mine[0]["text"].endswith("."), items
    print("test_story_discovery: ok")
