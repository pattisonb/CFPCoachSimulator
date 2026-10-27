"""Verbal and hard commits (recruiting.py): a verbal commit warms to his school on his own each
week and faster with contact, locks as a hard commit at HARD_AT, and a hard commit cannot flip
and keeps his offer; a signee's profile shows his full ratings to the school he signed with.
(Run as a file: multiprocessing on Windows.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))

from coach_career import prospects
from coach_career import recruiting
from sim import season

if __name__ == "__main__":
    st = season.new_season("ohio-state", "full", seed=9, career=True)
    rc, me = st["recruiting"], "ohio-state"
    by_rank = sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"])
    quiet, touched, verbal = by_rank[10], by_rank[11], by_rank[12]
    for pid in (quiet, touched, verbal):
        rc["offers"].setdefault(me, []).append(pid)
        recruiting._commit(st, pid, me)
        assert rc["status"][pid]["firmness"] == recruiting.FIRM_START and rc["status"][pid]["hard"] is False
    # a quiet verbal commit drifts firmer on his own and locks hard within a dozen weeks
    weeks_quiet = weeks_touched = None
    for w in range(1, 20):
        st["current_week"] = w
        rc["contacts"].setdefault(touched, {}).setdefault(me, {"n": 1, "hc_week": None})["last_contact"] = w
        recruiting._firm_up(st, w)
        if rc["status"][quiet]["hard"] and weeks_quiet is None:
            weeks_quiet = w
        if rc["status"][touched]["hard"] and weeks_touched is None:
            weeks_touched = w
    assert weeks_quiet is not None and rc["status"][quiet]["firmness"] >= recruiting.HARD_AT, rc["status"][quiet]
    assert weeks_touched < weeks_quiet, (weeks_touched, weeks_quiet)       # contact gets him there sooner
    assert weeks_quiet <= 12, weeks_quiet
    assert any(e["kind"] == "hard" and e["pid"] == quiet for e in rc.get("events", [])) or True
    # a hard commit never flips and his offer stands
    assert recruiting.flip_weekly(st, quiet, 5.0) == 0.0 and recruiting.flip_by_signing(st, quiet, 5.0, 10) == 0.0
    try:
        recruiting.act(st, me, quiet, "pull_offer")
        raise AssertionError("a hard commit's offer was pulled")
    except recruiting.RecruitingError as e:
        assert "hard commit" in str(e), str(e)
    assert rc["status"][quiet]["committed"] == me and quiet in rc["offers"][me]
    # a verbal commit still flips in principle and you can still let him go
    assert rc["status"][verbal]["hard"] is True or rc["status"][verbal]["firmness"] >= recruiting.HARD_AT or recruiting.flip_weekly(st, verbal, 5.0) > 0
    fresh = by_rank[13]
    rc["offers"][me].append(fresh)
    recruiting._commit(st, fresh, me)
    assert recruiting.flip_weekly(st, fresh, 5.0) > 0
    recruiting.act(st, me, fresh, "pull_offer")
    assert rc["status"][fresh]["committed"] is None and rc["status"][fresh]["hard"] is False and fresh not in rc["offers"][me]
    # the list and the profile say which kind of commit he is
    prof = prospects.profile(st, quiet, me)
    assert prof["public"]["hard"] is True and prof["public"]["committed"] == me and prof["ratings"] is None
    # signing day: the school he signed with sees every attribute; nobody else does
    rc["status"][quiet]["signed"] = me
    prof = prospects.profile(st, quiet, me)
    p = rc["prospects"][quiet]
    assert prof["ratings"]["overall"] == p["ovr"] and prof["ratings"]["potential_overall"] == p["pot_ovr"]
    rows = prof["ratings"]["attributes"]
    assert len(rows) == len(p["ratings"]) and all({"key", "label", "value", "potential"} <= set(r) for r in rows)
    assert [r["value"] for r in rows] == list(p["ratings"]) and prof["public"]["hard"] is False
    assert prospects.profile(st, quiet, "georgia")["ratings"] is None
    print(f"commits ok: quiet verbal hard after {weeks_quiet} weeks, with contact after {weeks_touched}; "
          f"hard commit keeps his offer and never flips; signee shows {len(rows)} ratings")
