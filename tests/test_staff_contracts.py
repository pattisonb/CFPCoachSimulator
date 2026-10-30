"""Staff contracts (coach_career/offseason.py, carousel.py, recruiting.make_staff): every member of
your staff is signed through a year; under contract he rarely leaves, at expiry he shops and the
stayers re-sign. (Run as a file: multiprocessing on Windows.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))
_sys.path.insert(0, str(_Path(__file__).resolve().parents[1] / "tests"))
import copy
import random

from coach_career import carousel, offseason
from sim import season
from test_coach_market import to_stage
from test_offseason import finished


def leave_rate(st: dict, until: int, n: int = 200, poached=()) -> tuple[float, list[dict]]:
    """Over n seeded offseasons: how often a recruiter signed through `until` leaves, and the
    Staff-step records (for the re-sign checks). The carousel's wants are `poached`."""
    gone, outs = 0, []
    base = copy.deepcopy(st["career"]["staff"])
    for i in range(n):
        st["seed"] = 1000 + i
        st["career"]["staff"] = copy.deepcopy(base)
        for s in st["career"]["staff"]:
            s["contract_until"] = until
        out = offseason._staff_changes(st, list(poached), {})
        outs.append(out)
        gone += sum(1 for s in st["career"]["staff"] if s["role"] == "Recruiter" and s["id"] in out["leaving"])
    return gone / (3 * n), outs


if __name__ == "__main__":
    # make_staff: everyone signed through a year 1-3 seasons out from the first season
    st = season.new_season("ohio-state", "full", seed=7, career=True)
    staff = st["career"]["staff"]
    assert all(2026 <= s["contract_until"] <= 2028 for s in staff), [(s["role"], s.get("contract_until")) for s in staff]
    # the constants: under contract a third of today's leaving, shopping twice it
    assert offseason.UNDER_CONTRACT < 0.5 < offseason.SHOPPING and offseason.RECRUITER_LEAVE * offseason.UNDER_CONTRACT < 0.06
    # a finished season into the Staff step
    st = season.new_season("ohio-state", "full", seed=5, career=True)
    finished(st)
    offseason.start(st)
    to_stage(st, "staff")
    off = st["offseason"]
    year = off["year"]
    # candidates say how long they want; hire signs the candidate for that long from the coming season
    cands = off["staff"]["candidates"]
    if not off["staff"]["leaving"]:
        off["staff"].update(offseason.open_role(st, "r1"))
        cands = off["staff"]["candidates"]
    sid = off["staff"]["leaving"][0]
    for c in cands[sid]:
        lo, hi = (2, 4) if c["role"] in ("OC", "DC") else (1, 3)
        assert lo <= c["years"] <= hi, (c["role"], c.get("years"))
    offseason.hire(st, sid, 1)
    snap = copy.deepcopy(st)
    offseason.advance(st)
    hired = next(s for s in st["career"]["staff"] if s["id"] == sid)
    assert hired["contract_until"] == year + cands[sid][1]["years"] - 1, (hired, cands[sid][1])
    st = snap
    off = st["offseason"]
    # recruiters: under contract about a third of the expiring rate (0.35 vs 2.0 of RECRUITER_LEAVE)
    held, _ = leave_rate(st, year)            # signed through the coming season
    shop, outs = leave_rate(st, year - 1)     # the contract ran out
    assert 0.02 <= held <= 0.08 and 0.17 <= shop <= 0.31, (held, shop)
    ratio = held / shop                       # the constants put it at 0.175 (0.35 / 2.0): well under half
    assert 0.1 <= ratio <= 0.3, (held, shop, ratio)
    # whoever stays at expiry re-signs 1-3 years (recruiters) or 2-4 (coordinators) and the step says so
    for out in outs:
        for r in out["renewed"]:
            lo, hi = (2, 4) if r["role"] in ("OC", "DC") else (1, 3)
            assert year + lo - 1 <= r["through"] <= year + hi - 1 and r["id"] not in out["leaving"], r
    for r in outs[-1]["renewed"]:             # the staff holds the last run's state
        assert next(s for s in st["career"]["staff"] if s["id"] == r["id"])["contract_until"] == r["through"]
    assert all(s["contract_until"] >= year for s in st["career"]["staff"] if s["id"] not in outs[-1]["leaving"])
    assert any(out["renewed"] for out in outs)
    # an expiring coordinator the carousel wanted always leaves; one it did not want shops at COORD_SHOP
    _, outs = leave_rate(st, year - 1, 100, poached=["offensive_coordinator"])
    assert all("oc" in out["leaving"] for out in outs)
    dc_shop = sum(1 for out in outs if "dc" in out["leaving"]) / len(outs)
    assert 0.12 <= dc_shop <= 0.4, dc_shop
    assert all(out["reasons"].get("dc") == "took a coordinator job elsewhere" for out in outs if "dc" in out["leaving"])
    # a coordinator under contract turns a head coaching job down about two thirds of the time
    for s in st["career"]["staff"]:
        s["contract_until"] = year + 1
    went = sum(1 for i in range(200) if not carousel.contract_holds(dict(st, seed=2000 + i), "offensive_coordinator", year))
    assert 0.2 <= went / 200 <= 0.5, went / 200
    for s in st["career"]["staff"]:
        s["contract_until"] = year - 1
    assert not any(carousel.contract_holds(dict(st, seed=2000 + i), "offensive_coordinator", year) for i in range(50))
    # the Staff step view: the contract on every member, expiring flagged, renewals and the candidates' asks
    st["career"]["staff"] = copy.deepcopy(snap["career"]["staff"])
    for s in st["career"]["staff"]:
        s["contract_until"] = year + 1
    st["career"]["staff"][1]["contract_until"] = year - 1
    off["staff"] = offseason._staff_changes(st, [], {})
    v = offseason.view(st)
    rows = {r["id"]: r for r in v["your_staff"]}
    assert all("contract_until" in r for r in rows.values())
    assert v["staff"]["renewed"] == off["staff"]["renewed"] and "expiring" in v["staff"] and "contract" in v["staff"]
    # the DC's contract was up: he left shopping (still expiring) or re-signed (a new term, no longer expiring)
    if "dc" in off["staff"]["leaving"]:
        assert v["staff"]["contract"]["dc"]["expiring"] and "dc" in v["staff"]["expiring"]
    else:
        assert "dc" in {r["id"] for r in v["staff"]["renewed"]} and v["staff"]["contract"]["dc"]["until"] >= year + 1
    assert not v["staff"]["contract"]["oc"]["expiring"] and v["staff"]["contract"]["oc"]["until"] == year + 1
    if off["staff"]["leaving"]:
        assert all("years" in c for c in off["staff"]["candidates"][off["staff"]["leaving"][0]])
    # the Scouting tab's scout rows carry the through year
    from coach_career import prospects
    sv = prospects.scouting_view(snap)
    assert all(m.get("contract_until") for m in sv["scouts"]), sv["scouts"][0]
    # an old save without contracts: the Staff step runs, every member ends with a contract
    for s in st["career"]["staff"]:
        s.pop("contract_until", None)
    out = offseason._staff_changes(st, [], {})
    assert all(s.get("contract_until") for s in st["career"]["staff"] if s["id"] not in out["leaving"])
    assert not carousel.contract_holds(st, "offensive_coordinator", year)
    season.close_pool()
    print(f"staff contracts ok: recruiters leave {held:.2f} under contract vs {shop:.2f} shopping (ratio {ratio:.2f}); "
          f"a coordinator under contract takes a head job {went / 200:.2f} of the time; expiring DC shops {dc_shop:.2f}")
