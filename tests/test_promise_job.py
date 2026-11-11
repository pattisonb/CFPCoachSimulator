"""Promise Him the Job (docs/superpowers/plans/2026-11-11-promise-the-job.md): on any call or visit you can promise a
recruit the starting job, asked or not. It helps land him and is a real promise. Two promises at one position are both
judged on who starts; the second may not be believed, and it strains the first."""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))
_sys.path.insert(0, str(_Path(__file__).resolve().parent))

from coach_career import persona, promises, recruiting, scenes, word

ME = "iowa"


def fresh():
    from sim import season
    st = season.new_season(ME, "full", seed=5, career=True)
    st["current_week"] = 1
    st["recruiting"]["hours"][ME] = 1000
    return st


def ranked(st, start=40):
    rc = st["recruiting"]
    return [q for q in sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"])[start:]
            if not rc["prospects"][q].get("hidden") and not rc["status"][q]["committed"]]


def setup(st, pid, pt=True, personality="business"):
    p = st["recruiting"]["prospects"][pid]
    p["persona"] = dict(persona.of(st, pid), personality=personality, decider_topic=None)
    rest = [t for t in p["priorities"] if t != "playing_time"]
    p["priorities"] = (["playing_time"] + rest)[:3] if pt else [t for t in recruiting.PITCHES if t != "playing_time"][:3]


def open_call(st, pid):
    recruiting._contact(st, ME, pid).setdefault("calls", 1)
    return recruiting.act(st, ME, pid, "call")["scene"]


def nobody_ahead(st, n=1, group=None):
    out = []
    for q in ranked(st):
        if recruiting.ahead_of(st, ME, q) is None and (group is None or recruiting._group_of(st["recruiting"]["prospects"][q]) == group):
            out.append(q)
        if len(out) == n:
            return out
    raise AssertionError("no prospect with nobody ahead")


def roster_promises(st, pid):
    return [pr for pr in (st["recruiting"]["contacts"].get(pid, {}).get(ME, {}).get("promises") or []) if pr["kind"] == "roster"]


def worth(st, pid, mult):
    return recruiting.ANSWER_PROMISE * word.promise_mult(st, pid, recruiting._group_of(st["recruiting"]["prospects"][pid])) * mult


def test_promise_job_helps():
    st = fresh()
    pid = nobody_ahead(st)[0]
    setup(st, pid)
    sc = open_call(st, pid)
    r = recruiting.act(st, ME, pid, "promise_job", scene=sc["id"])
    assert abs(r["points"] - worth(st, pid, recruiting.JOB_PRIORITY)) < 1e-9 and r["truthful"], r
    prs = roster_promises(st, pid)
    assert len(prs) == 1 and prs[0].get("job"), prs
    assert any(e.get("line") == "You told him the job is his." for e in st["recruiting"]["log"] if e["pid"] == pid)


def test_not_his_priority_counts_less():
    st = fresh()
    pid = nobody_ahead(st)[0]
    setup(st, pid, pt=False)
    sc = open_call(st, pid)
    r = recruiting.act(st, ME, pid, "promise_job", scene=sc["id"])
    assert abs(r["points"] - worth(st, pid, recruiting.JOB_NOT_PRIORITY)) < 1e-9, r


def test_one_per_recruit():
    st = fresh()
    pid = nobody_ahead(st)[0]
    setup(st, pid)
    sc = open_call(st, pid)
    recruiting.act(st, ME, pid, "promise_job", scene=sc["id"])
    try:
        recruiting.act(st, ME, pid, "promise_job", scene=sc["id"])
    except recruiting.RecruitingError as e:
        assert e.code == 409 and "already promised" in str(e).lower(), e
    else:
        raise AssertionError("a second job promise is refused")
    assert len(roster_promises(st, pid)) == 1


def test_hollow_costs():
    st = fresh()
    pid = None
    for q in ranked(st):
        a = recruiting.ahead_of(st, ME, q)
        if a and not a["last_year"] and st["recruiting"]["prospects"][q]["ovr"] < a["ovr"] - recruiting.PROMISE_MARGIN:
            pid = q
            break
    setup(st, pid)
    sc = open_call(st, pid)
    r = recruiting.act(st, ME, pid, "promise_job", scene=sc["id"])
    assert not r["truthful"] and abs(r["points"] + recruiting.ANSWER_HOLLOW * persona.hollow_mult(st, pid, ME)) < 1e-9, r
    assert recruiting.cooled(st, ME, pid)


def test_crowd_and_strain():
    st = fresh()
    a = nobody_ahead(st)[0]
    group = recruiting._group_of(st["recruiting"]["prospects"][a])
    b = next(q for q in nobody_ahead(st, 10, group) if q != a)
    for q in (a, b):
        setup(st, q)
    saved = recruiting.JOB_CROWD_DOUBT
    recruiting.JOB_CROWD_DOUBT = 0.0
    try:
        recruiting.act(st, ME, a, "promise_job", scene=open_call(st, a)["id"])
        r = recruiting.act(st, ME, b, "promise_job", scene=open_call(st, b)["id"])
    finally:
        recruiting.JOB_CROWD_DOUBT = saved
    assert abs(r["points"] - worth(st, b, recruiting.JOB_PRIORITY * recruiting.JOB_CROWD)) < 1e-9, r
    ca = st["recruiting"]["contacts"][a][ME]
    assert recruiting.cooled(st, ME, a) and ca.get("heard_rival") == st["current_week"], ca
    assert any(e["kind"] == "promise_strained" and e["pid"] == a and e.get("line") == scenes.HEARD_RIVAL for e in st["recruiting"]["log"])


def test_strain_on_roster_player():
    import test_promises
    from sim import season
    st = test_promises.second_season()
    st["current_week"] = 1
    st["recruiting"]["hours"][st["team"]] = 1000
    me, year = st["team"], season.season_year(st)
    roster = st["league"]["teams"][me]["roster"]
    rc = st["recruiting"]
    pid = next(q for q in sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"])[40:] if not rc["prospects"][q].get("hidden"))
    group = recruiting._group_of(rc["prospects"][pid])
    from coach_career import offseason
    pl = next(c for c in roster if offseason.GROUP.get(c["pos"]) == group)
    pl["promised"] = year
    weeks = [{"week": 1, "started": True, "injured": False, "big": False}, {"week": 2, "started": True, "injured": False, "big": False}]
    before = promises.score(weeks, pl["pos"], "business")
    setup(st, pid)
    recruiting._contact(st, me, pid).setdefault("calls", 1)
    sc = recruiting.act(st, me, pid, "call")["scene"]
    recruiting.act(st, me, pid, "promise_job", scene=sc["id"])
    assert promises.strain(st, year, pl["id"]) == 1
    assert abs(promises.score(weeks, pl["pos"], "business", strain=1) - (before - recruiting.JOB_STRAIN_SCORE)) < 1e-9


def test_ai_no_job_promise():
    st = fresh()
    pid = ranked(st)[0]
    try:
        recruiting.act(st, "ohio-state", pid, "promise_job", scene="x")
    except recruiting.RecruitingError:
        return
    raise AssertionError("an AI school makes no job promise")


def test_heard_rival_line():
    st = fresh()
    a = nobody_ahead(st)[0]
    group = recruiting._group_of(st["recruiting"]["prospects"][a])
    b = next(q for q in nobody_ahead(st, 10, group) if q != a)
    for q in (a, b):
        setup(st, q)
    sc = open_call(st, a)
    recruiting.act(st, ME, a, "promise_job", scene=sc["id"])
    recruiting.act(st, ME, a, "hang_up", scene=sc["id"]) if "hang_up" in getattr(recruiting, "SCENE_ACTIONS", ()) else st["recruiting"]["scenes"][ME].pop(a, None)
    recruiting.act(st, ME, b, "promise_job", scene=open_call(st, b)["id"])
    st["current_week"] += 1
    st["recruiting"]["scenes"].get(ME, {}).pop(a, None)
    sc2 = open_call(st, a)
    him = [t["text"] for t in sc2["turns"] if t["who"] == "him"]
    assert him and him[0] == scenes.HEARD_RIVAL, sc2["turns"]
    st["current_week"] += 1
    st["recruiting"]["scenes"][ME].pop(a, None)
    sc3 = open_call(st, a)
    assert all(t["text"] != scenes.HEARD_RIVAL for t in sc3["turns"] if t["who"] == "him"), "said once"


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("promise job ok: it helps (more on his priority), one per recruit, a hollow one costs, a second at the position is worth less and strains the first; a promised player's score takes the strain; his next call says so once")
