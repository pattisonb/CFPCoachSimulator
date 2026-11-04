"""Each personality and decider has its own voice in calls and in-home visits (persona.LINES,
persona.DECIDER_LINES, persona.NO_TOPIC; hooks in coach_career/scenes.py). Native; run as a file."""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))

from coach_career import persona, recruiting, scenes
from sim import season

ME = "ohio-state"


def fresh(seed=5):
    st = season.new_season(ME, "full", seed=seed, career=True)
    st["current_week"] = 1
    return st


def cold(st, used):
    rc = st["recruiting"]
    for pid in sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"]):
        p = rc["prospects"][pid]
        if pid in used or p.get("hidden") or rc["status"][pid]["committed"] or ME in rc["contacts"].get(pid, {}):
            continue
        used.add(pid)
        return pid
    raise AssertionError("no prospect")


def force(st, pid, personality, decider="self", topic=None):
    st["recruiting"]["prospects"][pid]["persona"] = {"personality": personality, "decider": decider, "decider_topic": topic}


def open_scene(st, pid, action="call"):
    st["recruiting"]["hours"][ME] = 1000
    return recruiting.act(st, ME, pid, action)["scene"]


def present(st, pid, sc, topics=None):
    p = st["recruiting"]["prospects"][pid]
    topics = topics or (list(p["priorities"]) + [t for t in recruiting.PITCHES if t not in p["priorities"]])[:3]
    return recruiting.act(st, ME, pid, "present", scene=sc["id"], topics=topics)["scene"]


def texts(sc, who="him"):
    return [t["text"] for t in sc["turns"] if t["who"] == who]


def test_every_line_fills():
    f = {k: "X" for k in scenes.FIELDS}
    tables = [persona.LINES, persona.DECIDER_LINES, persona.NO_TOPIC]
    n = 0
    for table in tables:
        for line in scenes_walk(table):
            out = line.format(**f)
            assert "{" not in out and "}" not in out and "null" not in out.lower() and "undefined" not in out and out.strip(), line
            assert not any(c.isdigit() for c in line), line
            n += 1
    for k in persona.PERSONALITIES:
        for key in ("open", "small_talk", "hit", "quiet"):
            assert len(persona.LINES[k][key]) >= 3, (k, key)
    for k in persona.DECIDERS:
        assert (k == "self") == (k not in persona.DECIDER_LINES), k
        if k != "self":
            assert len(persona.DECIDER_LINES[k]) >= 3, k
    assert n > 100


def scenes_walk(t):
    if isinstance(t, str):
        yield t
    elif isinstance(t, dict):
        for v in t.values():
            yield from scenes_walk(v)
    else:
        for v in t:
            yield from scenes_walk(v)


def test_cocky_scene_uses_cocky_lines():
    mine = set(scenes_walk(persona.LINES["cocky"]))
    f_hits = 0
    st, used = fresh(), set()
    for _ in range(20):
        pid = cold(st, used)
        force(st, pid, "cocky")
        sc = open_scene(st, pid)
        sc = present(st, pid, sc)
        said = texts(sc)
        if any(any(t == m.format(**scenes._fields(st, ME, st["recruiting"]["prospects"][pid]))
                   for m in mine) for t in said):
            f_hits += 1
    assert f_hits >= 1, "no cocky line in 20 scenes"


def test_business_skips_small_talk():
    st = fresh()
    used = set()
    banned = set(scenes_walk({k: v for k, v in scenes.CONTEXT.items() if k not in ("game", "won", "lost")})) | set(scenes_walk(persona.LINES["business"]["small_talk"]))
    for i in range(12):
        pid = cold(st, used)
        force(st, pid, "business")
        sc = open_scene(st, pid)
        f = scenes._fields(st, ME, st["recruiting"]["prospects"][pid])
        news = {l.format(**f) for k in ("game", "won", "lost") for l in scenes.CONTEXT[k]}     # last Saturday's game is news, not small talk
        for t in texts(sc):
            assert t not in {b.format(**f) for b in banned}, t
            assert t in {l.format(**f) for l in persona.LINES["business"]["open"]} | news or sc["tired"], (t, sc["turns"])


def test_guarded_call_cue_has_no_topic():
    st, used = fresh(), set()
    for personality in ("guarded", "shy"):
        for _ in range(5):
            pid = cold(st, used)
            force(st, pid, personality)
            sc = present(st, pid, open_scene(st, pid))
            assert sc["cue"]["topics"] == [], sc["cue"]
            f = scenes._fields(st, ME, st["recruiting"]["prospects"][pid])
            assert sc["cue"]["text"] in [l.format(**f) for l in persona.NO_TOPIC[personality]], sc["cue"]
            assert sc["cue"]["text"] in texts(sc)
            # a pitch in that scene reveals nothing
            p = st["recruiting"]["prospects"][pid]
            pri = p["priorities"][0]
            if sc["question"]:
                recruiting.act(st, ME, pid, "answer", scene=sc["id"], answer="straight")
            before = list((st["recruiting"]["revealed"].get(ME) or {}).get(pid, []))     # his question about a named player already tells playing time
            r = recruiting.act(st, ME, pid, "pitch", pitch=pri, scene=sc["id"])
            assert r["reaction"]["revealed"] is None, r
            assert list((st["recruiting"]["revealed"].get(ME) or {}).get(pid, [])) == before, "the pitch told nothing"
            mine = {l.format(**f) for k in persona.LINES[personality].values() for l in k}
            assert r["reaction"]["text"] in mine or r["reaction"]["kind"] in ("polite", "tired"), r["reaction"]
            for t in texts(sc) + [r["reaction"]["text"]]:
                assert not any(ph in t for ph in scenes.PHRASES.values()), t
    # a business recruit's cue still names his topic
    st = fresh()
    pid = cold(st, set())
    force(st, pid, "business")
    sc = present(st, pid, open_scene(st, pid))
    assert sc["cue"]["topics"]
    # a Shy recruit's second call reveals again
    st = fresh()
    pid = cold(st, set())
    force(st, pid, "shy")
    st["recruiting"]["contacts"].setdefault(pid, {}).setdefault(ME, {"n": 0, "calls": 1})["calls"] = 1
    sc = present(st, pid, open_scene(st, pid))
    assert sc["cue"]["topics"], "a second call from the school has a topic"


def test_visit_has_decider_turn():
    st = fresh()
    used = set()
    pid = cold(st, used)
    force(st, pid, "business", "mom", "proximity")
    sc = open_scene(st, pid, "hc_visit")
    fam = [t for t in sc["turns"] if t["who"] == "family"]
    assert len(fam) == 1 and fam[0]["label"] == "Mom" and fam[0]["text"].strip(), sc["turns"]
    f = scenes._fields(st, ME, st["recruiting"]["prospects"][pid])
    assert fam[0]["text"] in [l.format(**f) for l in persona.DECIDER_LINES["mom"]]
    # he decides himself: no family turn; a call: none either
    pid2 = cold(st, used)
    force(st, pid2, "business", "self", None)
    sc2 = open_scene(st, pid2, "hc_visit")
    assert not [t for t in sc2["turns"] if t["who"] == "family"]
    pid3 = cold(st, used)
    force(st, pid3, "business", "dad", "nil")
    assert not [t for t in open_scene(st, pid3)["turns"] if t["who"] == "family"]


MEDIUM = ("call", "phone", "who is this")


def test_visit_lines_have_no_phone_words():
    for k, table in persona.LINES.items():
        for key in ("visit_open", "small_talk", "hit", "quiet"):
            assert len(persona.LINES[k]["visit_open"]) >= 3
            for line in table[key]:
                assert not any(w in line.lower() for w in MEDIUM), (k, key, line)
    used, st = set(), fresh()
    seen = 0
    for i in range(24):
        pid = cold(st, used)
        k = persona.PERSONALITIES[i % 5]
        force(st, pid, k, "self")
        sc = open_scene(st, pid, "hc_visit")
        sc = present(st, pid, sc)
        mine = {l.format(**scenes._fields(st, ME, st["recruiting"]["prospects"][pid])) for t in persona.LINES[k].values() for l in t}
        for t in texts(sc):
            if t in mine:
                seen += 1
                assert not any(w in t.lower() for w in MEDIUM), (k, t)
    assert seen >= 24


def test_visit_teaches_the_decider():
    st = fresh()
    pid = cold(st, set())
    force(st, pid, "business", "mom", "proximity")
    assert persona.view(st, ME, pid)["decider"] is None
    open_scene(st, pid, "hc_visit")
    assert persona.view(st, ME, pid)["decider"] == "Mom"
    pid2 = cold(st, {pid})
    force(st, pid2, "business", "self", None)
    open_scene(st, pid2, "hc_visit")
    assert persona.view(st, ME, pid2)["decider"] is None or persona.view(st, ME, pid2)["decider"] == "Himself"


def test_no_tell_call_hides_hits():
    st, used = fresh(), set()
    for personality in ("guarded", "shy"):
        pid = cold(st, used)
        force(st, pid, personality)
        p = st["recruiting"]["prospects"][pid]
        st["recruiting"]["hours"][ME] = 1000
        sc = recruiting.act(st, ME, pid, "call")["scene"]
        r = recruiting.act(st, ME, pid, "present", scene=sc["id"], topics=list(p["priorities"]) + [t for t in recruiting.PITCHES if t not in p["priorities"]][:3 - len(p["priorities"])])
        assert r["hit"] == [] and r["scene"]["present"]["hit"] == [], r
        assert r["scene"]["present"]["kind"] == "guarded", r["scene"]["present"]      # nothing of how it landed
        ev = [e for e in st["recruiting"]["log"] if e["kind"] == "present" and e["pid"] == pid][-1]
        assert ev["hit"] is None, ev                                                  # History: he gave nothing away, not "none landed"
    pid = cold(st, used)
    force(st, pid, "business")
    p = st["recruiting"]["prospects"][pid]
    st["recruiting"]["hours"][ME] = 1000
    sc = recruiting.act(st, ME, pid, "call")["scene"]
    r = recruiting.act(st, ME, pid, "present", scene=sc["id"], topics=list(p["priorities"]) + [t for t in recruiting.PITCHES if t not in p["priorities"]][:3 - len(p["priorities"])])
    assert r["hit"] == r["scene"]["present"]["hit"]


def test_visit_note_names_the_decider():
    """The room's note fits who decides: a grandmother-decided visit never mentions his dad, and so on for each."""
    words = {"mom": "mom", "dad": "dad", "grandma": "grandmother", "hs_coach": "high school coach", "trainer": "trainer"}
    st = fresh()
    used = set()
    for decider, word in words.items():
        pid = cold(st, used)
        force(st, pid, "business", decider, None)
        note = open_scene(st, pid, "hc_visit")["turns"][0]
        assert note["who"] == "note" and word in note["text"].lower(), (decider, note)
        for other, w in words.items():
            if other != decider:
                assert f"his {w}" not in note["text"].lower(), (decider, note)


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
    print("all passed")
