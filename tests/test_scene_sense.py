"""A call that makes sense (the player's November 11 ask): his answer to "where's your head at" starts from what you
already know; decoys (a topic that is not his) only while he is sizing you up, never once he trusts you (CUE_TRUST_CONTACTS
contacts, or your offer); his personality's line still names what landed; a lead you already made in your opening is
noticed."""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))

from coach_career import recruiting, scenes

ME = "iowa"


def fresh():
    from sim import season
    st = season.new_season(ME, "full", seed=5, career=True)
    st["current_week"] = 1
    return st


def pid_of(st, n=40):
    rc = st["recruiting"]
    return [q for q in sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"]) if not rc["prospects"][q].get("hidden")][n]


def fields(st, pid):
    return scenes._fields(st, ME, st["recruiting"]["prospects"][pid])


def cues(st, pid):
    return [scenes.cue(st, ME, pid, w, fields(st, pid)) for w in range(1, 41)]


def test_decoys_early():
    st = fresh()
    pid = pid_of(st)
    recruiting._contact(st, ME, pid)["n"] = 1
    pri = st["recruiting"]["prospects"][pid]["priorities"]
    assert any(t not in pri for c in cues(st, pid) for t in c["topics"]), "early on he may toss in a topic that isn't his"


def test_no_decoys_once_trusted():
    st = fresh()
    pid = pid_of(st)
    pri = st["recruiting"]["prospects"][pid]["priorities"]
    recruiting._contact(st, ME, pid)["n"] = scenes.CUE_TRUST_CONTACTS
    assert all(t in pri for c in cues(st, pid) for t in c["topics"]), "after enough contacts he's straight with you"
    st = fresh()
    recruiting._contact(st, ME, pid)["n"] = 1
    st["recruiting"]["offers"].setdefault(ME, []).append(pid)
    assert all(t in pri for c in cues(st, pid) for t in c["topics"]), "your offer earns a straight answer"


def test_cue_starts_from_known():
    st = fresh()
    pid = pid_of(st)
    pri = st["recruiting"]["prospects"][pid]["priorities"]
    st["recruiting"]["revealed"].setdefault(ME, {})[pid] = [pri[0]]
    c = scenes.cue(st, ME, pid, 3, fields(st, pid))
    assert scenes.PHRASES[pri[0]] in c["text"] and c["text"].index(scenes.PHRASES[pri[0]]) < 40, c
    assert pri[0] not in c["topics"], "the new part names something you haven't heard"
    st["recruiting"]["revealed"][ME][pid] = list(pri)
    c = scenes.cue(st, ME, pid, 3, fields(st, pid))
    assert all(scenes.PHRASES[t] in c["text"] for t in pri), "all three known: he sums them up"


def test_persona_hit_names_what_landed():
    st = fresh()
    pid = pid_of(st)
    p = st["recruiting"]["prospects"][pid]
    top = p["priorities"][0]
    saved = scenes.PERSONA_LINE
    scenes.PERSONA_LINE = 1.0
    try:
        with recruiting.forced_strength(st, ME, pid, top, 0.95):
            r = scenes.reaction(st, ME, pid, "hc_visit", top, p)
    finally:
        scenes.PERSONA_LINE = saved
    phrase = scenes.PHRASES[top]
    assert r["kind"] == "hit" and r["text"].lower().startswith(phrase.lower()), r


def test_repeat_noticed():
    st = fresh()
    pid = pid_of(st)
    p = st["recruiting"]["prospects"][pid]
    r = scenes.reaction(st, ME, pid, "hc_visit", p["priorities"][0], p, repeat=True)
    assert r["text"].startswith(scenes.REPEAT_LINE), r


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("scene sense ok: decoys only early; the cue starts from what you know; a persona hit names what landed; a repeat is noticed")
