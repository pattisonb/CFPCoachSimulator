"""Commit Style (persona.py, spec section 3): the draw is seeded per prospect and never stored, each style is a
fifth of the class; Early Bird's odds and firmness, Signing Day's wait, a Hat Ceremony's finalists and date, a
Quiet Commit kept from the news and other schools (his interest in them stops climbing), Needs Attention's
softening without contact; your staff learns the style by an official visit or four weeks holding your offer.
Each rule is checked against the engine with the style forced on one prospect (p["persona"]), then over a
seeded season."""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))

from coach_career import persona, prospects, recruiting
from sim import news, season

ME = "ohio-state"
RIVALS = ("michigan", "texas", "georgia", "oregon")


class Always:
    """A stand-in for the week's stream: every roll comes up (a commit whenever the odds are above zero)."""

    def random(self):
        return 0.0


def fresh(seed=5):
    st = season.new_season(ME, "full", seed=seed, career=True)
    st["current_week"] = 1
    return st


def force(st, pid, style, personality="guarded"):
    st["recruiting"]["prospects"][pid]["persona"] = {"personality": personality, "decider": "self", "decider_topic": None,
                                                     "story": None, "story_data": {}, "commit_style": style}


def plain(st, used):
    rc = st["recruiting"]
    for pid in sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"]):
        p = rc["prospects"][pid]
        if pid in used or p.get("hidden") or rc["status"][pid]["committed"] or persona.story(st, pid)[0] or rc["lists"][pid]:
            continue
        if any(pid in pids for pids in rc["offers"].values()):
            continue
        used.add(pid)
        return pid
    raise AssertionError("no prospect fits")


def race(st, pid, leader=RIVALS[0], lead=30.0):
    """Four schools offer him; `leader` far ahead on his list (the others close together)."""
    rc = st["recruiting"]
    for i, s in enumerate(RIVALS):
        rc["offers"].setdefault(s, []).append(pid)
        rc["lists"][pid][s] = 10.0 - i
    rc["lists"][pid][leader] = lead


def draws(st, week):
    st["current_week"] = week
    recruiting._draws(st, week, Always())


def test_draw():
    assert persona.draw_style("p1", 7) == persona.draw_style("p1", 7)
    assert len({persona.draw_style(f"q{i}", 7) for i in range(40)}) == 5
    n = 6000
    got = [persona.draw_style(f"x{i}", 3) for i in range(n)]
    for k, want in persona.STYLES.items():
        share = got.count(k) / n
        assert abs(share - want) <= 0.025, (k, share)
    st = fresh(4)
    rc = st["recruiting"]
    pids = list(rc["prospects"])
    shares = {k: sum(persona.style(st, q) == k for q in pids) / len(pids) for k in persona.STYLES}
    assert all(0.17 <= v <= 0.23 for v in shares.values()), shares
    assert all(persona.style(st, q) == persona.draw_style(q, rc["seed"]) for q in pids[:200])
    assert not any("persona" in p for p in rc["prospects"].values()), "a commit style is a fixed draw: never stored"
    assert set(persona.STYLE_LABEL) == set(persona.STYLES)
    for label in persona.STYLE_LABEL.values():
        assert all(w[0].isupper() or w in ("a", "of", "to") for w in label.split()), label
    print("  draw ok", {k: round(v, 3) for k, v in shares.items()})


def test_early_bird(st, used):
    pid = plain(st, used)
    force(st, pid, "early_bird")
    assert [persona.commit_odds_mult(st, pid, w) for w in (3, 4, 8, 9)] == [1.0, persona.EARLY_ODDS, persona.EARLY_ODDS, 1.0]
    other = plain(st, used)
    force(st, other, "hat")
    assert persona.commit_odds_mult(st, other, 6) == 1.0
    rc = st["recruiting"]
    rc["offers"].setdefault(ME, []).append(pid)
    recruiting._commit(st, pid, ME)
    assert rc["status"][pid]["firmness"] == recruiting.HARD_AT - persona.EARLY_FIRM, rc["status"][pid]
    rc["offers"].setdefault(ME, []).append(other)
    recruiting._commit(st, other, ME)
    assert rc["status"][other]["firmness"] == recruiting.FIRM_START
    print("  early bird ok")


def test_signing_day(st, used):
    rc = st["recruiting"]
    pid = plain(st, used)
    force(st, pid, "signing_day")
    race(st, pid)
    for w in (4, 9, 15):
        draws(st, w)
        assert rc["status"][pid]["committed"] is None, (w, rc["status"][pid])
    draws(st, season.SELECTION_WEEK)
    assert rc["status"][pid]["committed"] == RIVALS[0], rc["status"][pid]
    # the same race for a prospect without the style commits at the first draw
    q = plain(st, used)
    force(st, q, "early_bird")
    race(st, q)
    draws(st, 5)
    assert rc["status"][q]["committed"] == RIVALS[0]
    print("  signing day ok")


def test_hat(st, used):
    rc = st["recruiting"]
    pid = plain(st, used)
    force(st, pid, "hat")
    race(st, pid)
    draws(st, 6)
    assert rc["status"][pid]["committed"] is None
    day, fin = rc["hats"][pid]
    assert day == 6 + persona.HAT_LEAD and len(fin) == persona.HAT_FINALISTS and RIVALS[0] in fin and set(fin) <= set(RIVALS), rc["hats"][pid]
    e = next(e for e in rc["log"] if e["kind"] == "hat" and e["pid"] == pid)
    assert e["line"].startswith("He will pick from ") and f"Week {day}" in e["line"] and e["line"].endswith("."), e
    # only his finalists can win: the fourth school jumps ahead of them all and still loses
    out = next(s for s in RIVALS if s not in fin)
    rc["lists"][pid][out] = 80.0
    rc["lists"][pid][fin[1]] = 60.0
    draws(st, 7)
    assert rc["status"][pid]["committed"] is None, "nobody wins before the day he named"
    draws(st, day)
    assert rc["status"][pid]["committed"] == fin[1], (rc["status"][pid], fin)
    c = next(e for e in reversed(rc["log"]) if e["kind"] == "commit" and e["pid"] == pid)
    assert c.get("hat") is True and pid not in rc["hats"]
    # the news says so for a five-star
    rc["prospects"][pid]["stars"], keep = 5, rc["prospects"][pid]["stars"]
    items = [x for x in news._recruiting(st, season.load_teams(), day) if x["link"].get("pid") == pid]
    assert items and "hat ceremony" in items[0]["text"], items
    rc["prospects"][pid]["stars"] = keep
    # a ceremony named late lands on the early signing day at the latest
    q = plain(st, used)
    force(st, q, "hat")
    race(st, q)
    draws(st, season.SELECTION_WEEK - 1)
    assert rc["hats"][q][0] == season.SELECTION_WEEK
    print("  hat ceremony ok")


def test_quiet(st, used):
    rc = st["recruiting"]
    pid = plain(st, used)
    force(st, pid, "quiet")
    rc["prospects"][pid]["stars"] = 5
    race(st, pid, leader="michigan")
    rc["offers"].setdefault(ME, []).append(pid)
    draws(st, 5)
    assert rc["status"][pid]["committed"] == "michigan"
    e = next(e for e in reversed(rc["log"]) if e["kind"] == "commit" and e["pid"] == pid)
    assert e.get("quiet") is True
    assert not [x for x in news._recruiting(st, season.load_teams(), 5) if x["link"].get("pid") == pid], "a quiet commit is not news"
    # you see "Quiet", not where; Michigan sees its commit
    row = prospects.row(st, pid, ME)
    assert row["committed"] is None and row["quiet"] is True and row["school_name"] is None, row
    prof = prospects.profile(st, pid, ME)
    assert prof["public"]["committed"] is None and prof["public"]["quiet"] and prof["flip"] is None
    assert prospects.row(st, pid, "michigan")["committed"] == "michigan" and not prospects.row(st, pid, "michigan")["quiet"]
    assert not [h for h in prospects.history_index(st, ME).get(pid, []) if h["kind"] == "commit"]
    assert [h for h in prospects.history_index(st, "michigan").get(pid, []) if h["kind"] == "commit"]
    top = [r["school"] for r in prospects.national_classes(st, ME)["schools"] if r["school"] == "michigan"]
    mich = next(r for r in prospects.national_classes(st, ME)["schools"] if r["school"] == "michigan")
    assert pid not in [t["id"] for t in mich["top"]] and top
    # his interest in you stops climbing; Michigan's still does; a loss still lands
    rc["hours"][ME] = rc["hours"]["michigan"] = 500
    before = recruiting.pending(st, ME, pid)
    recruiting.act(st, ME, pid, "message", "playing_time")
    assert recruiting.pending(st, ME, pid) == before, "a quiet commit's interest in another school does not climb"
    recruiting._act(st, "michigan", pid, "message", "playing_time")
    assert recruiting.pending(st, "michigan", pid) > 0
    assert persona.climbs(st, ME, pid, -2.0) == -2.0
    print("  quiet commit ok")


def test_needs_attention(st, used):
    rc = st["recruiting"]
    pid = plain(st, used)
    force(st, pid, "needs_attention")
    rc["offers"].setdefault(ME, []).append(pid)
    recruiting._commit(st, pid, ME)
    c = recruiting._contact(st, ME, pid)
    c["last_contact"] = 5
    rc["status"][pid]["firmness"] = 50
    st["current_week"] = 6
    recruiting._firm_up(st, 6)                       # in touch the week before: he firms up
    assert rc["status"][pid]["firmness"] > 50
    f = rc["status"][pid]["firmness"]
    st["current_week"] = 7
    recruiting._firm_up(st, 7)                       # a quiet week: he slips
    assert rc["status"][pid]["firmness"] == f - persona.NEEDS_DROP, rc["status"][pid]
    # a hard commit softens: three quiet weeks (his last contact landed at Week 6's step) and he can flip again
    rc["status"][pid].update(firmness=99, hard=True)
    for w in (8,):
        st["current_week"] = w
        recruiting._firm_up(st, w)
        assert rc["status"][pid]["hard"] and recruiting.flip_weekly(st, pid, 10.0) == 0.0
    st["current_week"] = 9
    recruiting._firm_up(st, 9)
    assert not rc["status"][pid]["hard"] and rc["status"][pid]["firmness"] < recruiting.HARD_AT
    assert recruiting.flip_weekly(st, pid, 10.0) > 0
    e = next(e for e in reversed(rc["log"]) if e["kind"] == "softened" and e["pid"] == pid)
    assert e["line"].startswith("He has not heard from ") and e["line"].endswith(".")
    # another style holds a hard commit through any silence
    q = plain(st, used)
    force(st, q, "early_bird")
    rc["offers"][ME].append(q)
    recruiting._commit(st, q, ME)
    rc["status"][q].update(firmness=99, hard=True)
    recruiting._firm_up(st, 14)
    assert rc["status"][q]["hard"] and rc["status"][q]["firmness"] == 99
    print("  needs attention ok")


def test_discovery(st, used):
    rc = st["recruiting"]
    pid = plain(st, used)
    force(st, pid, "hat")
    assert persona.view(st, ME, pid)["commit_style"] is None and persona.view(st, ME, pid)["has_style"]
    rc["hours"][ME] = 500
    st["current_week"] = 2
    recruiting.act(st, ME, pid, "offer", "playing_time", nil=0)
    for w in (3, 4, 5):
        persona.learn_styles(st, w)
        assert persona.view(st, ME, pid)["commit_style"] is None, w
    persona.learn_styles(st, 2 + persona.STYLE_OFFER_WEEKS)
    v = persona.view(st, ME, pid)
    assert v["commit_style"] == "Hat Ceremony" and v["style_key"] == "hat", v
    lines = [h["line"] for h in prospects.history_index(st, ME).get(pid, []) if h["kind"] == "learned"]
    assert persona.STYLE_LEARNED["hat"] in lines, lines
    # an official visit tells you at once
    q = plain(st, used)
    force(st, q, "quiet")
    rc["visits"].setdefault(q, {})[ME] = {"week": 3, "done": True}
    persona.learn_styles(st, 3)
    assert persona.view(st, ME, q)["commit_style"] == "Quiet Commit"
    # another school's offer or visit tells you nothing
    r = plain(st, used)
    rc["visits"].setdefault(r, {})["michigan"] = {"week": 3, "done": True}
    persona.learn_styles(st, 9)
    assert persona.view(st, ME, r)["commit_style"] is None
    print("  discovery ok")


def test_season():
    """A seeded season to the early signing period: every rule holds for every school."""
    st = season.new_season("georgia", "full", seed=2, career=True)
    season.advance_to(st, season.SELECTION_WEEK)
    rc = st["recruiting"]
    first = {}
    for e in rc["log"]:
        if e["kind"] in ("commit", "flip") and e["pid"] not in first and e["school"] != "FCS":
            first[e["pid"]] = e
    by = {k: [q for q in first if persona.style(st, q) == k] for k in persona.STYLES}
    pairs = {q for q in rc["prospects"] if persona.mate(st, q)}          # a Package Deal's mate commits with him, whatever his style
    early = [q for q in by["signing_day"] if q not in pairs and first[q]["week"] < season.SELECTION_WEEK]
    assert not early, early[:5]
    assert by["signing_day"], "signing day recruits commit on signing day"
    for q in by["hat"]:
        if q in pairs:
            continue
        hat = next((e for e in reversed(rc["log"]) if e["kind"] == "hat" and e["pid"] == q and e["week"] <= first[q]["week"]), None)   # his last one
        assert hat and first[q]["school"] in hat["finalists"] and first[q]["week"] >= hat["day"], (q, hat, first[q])
    for q in by["quiet"]:
        assert first[q].get("quiet"), first[q]
    assert all(persona.style(st, e["pid"]) == "needs_attention" for e in rc["log"] if e["kind"] == "softened")
    by8 = lambda k: sum(1 for q in by[k] if first[q]["week"] <= 8) / max(1, len(by[k]))
    assert by8("early_bird") > 1.5 * by8("needs_attention"), (by8("early_bird"), by8("needs_attention"))
    print(f"  season ok: committed by Week 8, Early Bird {by8('early_bird'):.2f} vs Needs Attention {by8('needs_attention'):.2f}; "
          f"{sum(1 for e in rc['log'] if e['kind'] == 'hat')} hat ceremonies, {sum(1 for e in rc['log'] if e['kind'] == 'softened')} softened")


if __name__ == "__main__":
    test_draw()
    st, used = fresh(), set()
    test_early_bird(st, used)
    test_signing_day(st, used)
    test_hat(st, used)
    test_quiet(st, used)
    test_needs_attention(st, used)
    test_discovery(st, used)
    test_season()
    print("test_commit_style: ok")
