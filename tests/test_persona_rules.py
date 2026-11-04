"""What a recruit's personality and decider change on the engine side (persona.py rules): Cocky, Shy,
Guarded, Loves the Attention, All Business, and the decider's topic and the Trainer's NIL. Each test forces
the persona on one prospect in a fresh career and compares it to a neutral baseline on the same prospect."""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))

from coach_career import persona, recruiting
from sim import season

ME = "ohio-state"
NEUTRAL = {"personality": "business", "decider": "self", "decider_topic": None}


def fresh(seed=5):
    st = season.new_season(ME, "full", seed=seed, career=True)
    st["current_week"] = 1
    return st


def force(st, pid, personality, decider="self", topic=None):
    st["recruiting"]["prospects"][pid]["persona"] = {"personality": personality, "decider": decider, "decider_topic": topic}


def reset(st, pid):
    rc = st["recruiting"]
    rc["contacts"].pop(pid, None)
    rc["pending"], rc["why_week"], rc["scenes"] = {}, {}, {}
    rc["hours"][ME] = 1000
    rc["revealed"].pop(ME, None)
    rc["offers"].get(ME, []) and rc["offers"][ME].clear()


def prospect(st, pitch_in_priorities=True, want=None):
    """An untouched prospect and a pitch you are strong enough on not to backfire."""
    rc = st["recruiting"]
    for pid in sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"]):
        p = rc["prospects"][pid]
        if p.get("hidden") or rc["status"][pid]["committed"] or ME in rc["lists"][pid]:
            continue
        s = recruiting.strengths(st, ME, pid)
        for t in (want or recruiting.PITCHES):
            if (t in p["priorities"]) == pitch_in_priorities and s[t] >= recruiting.BACKFIRE:
                return pid, t
    raise AssertionError("no prospect fits")


def pts(st, pid, action, pitch, personality, **kw):
    force(st, pid, personality, **kw)
    reset(st, pid)
    recruiting.act(st, ME, pid, action, pitch)
    return recruiting.pending(st, ME, pid)


def approx(a, b):
    return abs(a - b) < 1e-9


if __name__ == "__main__":
    st = fresh()
    rc = st["recruiting"]

    # test_cocky_pitch: x1.3 on playing time and prestige, not on academics
    pid, t = prospect(st, True, ("playing_time", "prestige"))
    assert approx(pts(st, pid, "message", t, "cocky"), 1.3 * pts(st, pid, "message", t, "shy"))
    pid2, t2 = prospect(st, True, ("academics",))
    assert approx(pts(st, pid2, "message", t2, "cocky"), pts(st, pid2, "message", t2, "shy"))

    # test_cocky_lowball_at_70: 0.6 x ask is a lowball for Cocky, not for Shy
    pid, _ = prospect(st)
    ask = recruiting.ask_from(st, ME, pid)
    assert ask >= 20, ask
    nil = int(0.6 * ask) + 1
    force(st, pid, "cocky")
    assert recruiting.is_lowball(nil, ask, persona.lowball_share(st, pid))
    force(st, pid, "shy")
    assert not recruiting.is_lowball(nil, ask, persona.lowball_share(st, pid))
    assert persona.lowball_share(st, pid) == recruiting.LOWBALL

    # test_zero_ask_never_lowball
    assert not recruiting.is_lowball(0, 0) and not recruiting.is_lowball(0, 0, 0.8)

    # test_shy_first_call_half_and_no_reveal
    pid, t = prospect(st)
    full = pts(st, pid, "call", t, "business")
    half = pts(st, pid, "call", t, "shy")
    assert approx(half, 0.5 * full), (half, full)
    assert not rc["revealed"].get(ME, {}).get(pid), "a first call reveals nothing to a Shy recruit"
    force(st, pid, "shy")
    reset(st, pid)
    rc["contacts"].setdefault(pid, {})[ME] = {"n": 1, "hc_week": None, "calls": 1}
    assert persona.call_reveals(st, ME, pid, roll=False), "a second call may reveal"
    rc["contacts"][pid][ME]["calls"] = 0
    assert not persona.call_reveals(st, ME, pid, roll=False)

    # test_shy_visit_1_5
    pid, t = prospect(st)
    assert approx(pts(st, pid, "hc_visit", t, "shy"), 1.5 * pts(st, pid, "hc_visit", t, "business"))

    # test_guarded_call_never_reveals_visit_does
    pid, t = prospect(st)
    for wk in range(1, 40):                       # never, however the roll falls
        st["current_week"] = wk
        force(st, pid, "guarded")
        reset(st, pid)
        recruiting.act(st, ME, pid, "call", t)
        assert not rc["revealed"].get(ME, {}).get(pid), wk
    st["current_week"] = 1
    force(st, pid, "guarded")
    reset(st, pid)
    recruiting.act(st, ME, pid, "hc_visit", t)
    assert rc["revealed"][ME][pid], "an in-home visit always tells"
    # ... and a scene's pitch hit on a call keeps it to himself
    pid3, t3 = prospect(st, True)
    force(st, pid3, "guarded")
    reset(st, pid3)
    sc = recruiting.act(st, ME, pid3, "call")["scene"]
    recruiting.act(st, ME, pid3, "present", scene=sc["id"], topics=[t3] + [x for x in recruiting.PITCHES if x != t3][:2])
    sc = rc["scenes"][ME][pid3]
    if sc.get("question") and not sc["question"].get("answer"):
        recruiting.act(st, ME, pid3, "answer", scene=sc["id"], answer="deflect")
    recruiting.act(st, ME, pid3, "pitch", t3, scene=sc["id"])
    assert t3 not in (rc["revealed"].get(ME, {}).get(pid3) or []), "Guarded does not give it up on a call"

    # test_guarded_decommit_half
    pid, _ = prospect(st)
    force(st, pid, "guarded")
    g = recruiting.flip_weekly(st, pid, 10.0, 20)
    force(st, pid, "cocky")
    n = recruiting.flip_weekly(st, pid, 10.0, 20)
    assert g > 0 and approx(g, 0.5 * n), (g, n)

    # test_attention_pester_free_5
    pid, _ = prospect(st)
    force(st, pid, "attention")
    assert persona.pester_free(st, pid) == 5
    force(st, pid, "shy")
    assert persona.pester_free(st, pid) == recruiting.PESTER_FREE == 3
    force(st, pid, "attention")
    reset(st, pid)
    rc["contacts"].setdefault(pid, {})[ME] = {"n": 3, "hc_week": None}
    rc["lists"][pid] = {s: 30.0 for s in ("michigan", "alabama", "georgia", "texas")} | {ME: 0.0}
    assert recruiting.not_considering(st, ME, pid)
    assert not recruiting.would_pester(st, ME, pid), "three contacts are still free to a recruit who loves the attention"
    rc["contacts"][pid][ME]["n"] = 5
    assert recruiting.would_pester(st, ME, pid)
    force(st, pid, "shy")
    rc["contacts"][pid][ME]["n"] = 3
    assert recruiting.would_pester(st, ME, pid)

    # test_attention_cools_after_two_quiet_weeks
    st = fresh(6)
    rc = st["recruiting"]
    pid, t = prospect(st)
    force(st, pid, "attention")
    reset(st, pid)
    recruiting.act(st, ME, pid, "message", t)
    assert rc["contacts"][pid][ME]["last_contact"] == 1
    persona.cool_quiet(st, 2)
    assert not recruiting.cooled(st, ME, pid) and not rc["contacts"][pid][ME].get("cooled_until")
    persona.cool_quiet(st, 3)
    assert rc["contacts"][pid][ME]["cooled_until"] == 4
    force(st, pid, "shy")
    rc["contacts"][pid][ME].pop("cooled_until")
    persona.cool_quiet(st, 3)
    assert not rc["contacts"][pid][ME].get("cooled_until"), "only Attention recruits cool"

    # test_attention_skips_committed_school
    pid2 = next(q for q in rc["prospects"] if q != pid and not rc["status"][q]["committed"] and not rc["status"][q]["signed"])
    force(st, pid2, "attention")
    rc["contacts"][pid2] = {ME: {"n": 1, "hc_week": None, "last_contact": 1}, "michigan": {"n": 1, "hc_week": None, "last_contact": 1}}
    rc["status"][pid2]["committed"] = ME
    persona.cool_quiet(st, 4)
    assert not rc["contacts"][pid2][ME].get("cooled_until"), "the school he committed to is not cooled"
    assert rc["contacts"][pid2]["michigan"]["cooled_until"] == 5
    rc["status"][pid2]["committed"] = None

    # test_business_message_0_3
    st = fresh()
    rc = st["recruiting"]
    pid, t = prospect(st)
    assert approx(pts(st, pid, "message", t, "business"), 0.3 * pts(st, pid, "message", t, "shy"))

    # test_decider_topic_counts_as_priority: a pitch on Mom's topic scores like a priority
    pid, t = prospect(st, False, ("proximity", "academics"))
    other = pts(st, pid, "message", t, "shy")
    as_topic = pts(st, pid, "message", t, "shy", decider="mom", topic=t)
    assert as_topic > other and approx(as_topic, recruiting.BASE_POINTS["message"] * (recruiting.PITCH_PRIORITY[0] + recruiting.PITCH_PRIORITY[1] * recruiting.strengths(st, ME, pid)[t]))
    assert persona.counts_as_priority(st, pid, t)
    force(st, pid, "shy", "dad", "nil")
    assert not persona.counts_as_priority(st, pid, t)
    visit_plain = pts(st, pid, "hc_visit", t, "shy", decider="mom", topic=t)
    visit_other = pts(st, pid, "hc_visit", t, "shy", decider="dad", topic="nil")
    assert visit_plain > visit_other

    # test_trainer_lowball_at_80_and_nil_to_1_2x
    pid, _ = prospect(st)
    p = rc["prospects"][pid]
    force(st, pid, "shy", "trainer", "nil")
    assert persona.lowball_share(st, pid) == 0.8
    ask = 100
    assert recruiting.is_lowball(75, ask, persona.lowball_share(st, pid)) and not recruiting.is_lowball(85, ask, persona.lowball_share(st, pid))
    k = recruiting.NIL_VALUE.get(recruiting.tier_of(p), 0.1)
    assert approx(recruiting.nil_value(p, 120, ask, st), k * 120)
    assert approx(recruiting.nil_value(p, 150, ask, st), k * (120 + recruiting.NIL_OVER * 30))
    force(st, pid, "shy")
    assert approx(recruiting.nil_value(p, 120, ask, st), k * (100 + recruiting.NIL_OVER * 20))
    assert approx(recruiting.nil_value(p, 120, ask), recruiting.nil_value(p, 120, ask, st))
    force(st, pid, "business")
    assert approx(recruiting.nil_value(p, 100, ask, st), 1.3 * k * 100)
    print("test_persona_rules: ok")
