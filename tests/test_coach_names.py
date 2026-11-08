"""One coach, one name, one job (coach_career/coach_names.py). The 2026 data lists a head coach who
calls his own plays twice (North Texas: Neal Brown as head coach and as offensive coordinator), so
a career at North Texas once showed "HC Neal Brown" and "OC Neal Brown" on your staff. Now the
coordinator is his own man, your coach's name is yours alone, every generated hire avoids every
name in use, and an older save heals on load. (Run as a file: multiprocessing on Windows.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))
import collections
import copy

from coach_career import carousel, coach_names, offseason
from sim import coaches, season
from test_offseason import finished

TEAM = "north-texas"


def _created(first: str, last: str) -> dict:
    c = coaches.blank()
    c.update(first_name=first, last_name=last, id="0123456789ab", age=44)
    return c


def _league_names(st: dict) -> list[str]:
    lgd = st["league"]
    names = [c["name"] for t in lgd["teams"].values() for c in t["coaches"].values() if c and c.get("name")]
    return names + [e["name"] for e in (lgd.get("market") or {}).get("coaches", [])]


def _dupes(names) -> dict:
    return {n: k for n, k in collections.Counter(n.lower() for n in names).items() if k > 1}


def _assert_staff(st: dict) -> None:
    staff = st["career"]["staff"]
    you = coach_names.player_name(st)
    names = [s["name"] for s in staff] + [you]
    assert not _dupes(names), (_dupes(names), names)
    ids = [s["id"] for s in staff]
    assert len(set(ids)) == len(ids), ids


def test_new_career_named_like_real_staff():
    """North Texas, your coach named Neal Brown (the data's head coach and OC there): you are Neal
    Brown, the real Neal Brown stays on as your OC under his own record with a middle initial, and
    every name and id on the staff and in the league is distinct. As the team's own head coach the
    data's OC slot (Neal Brown again) is a different man, the same one in season one and after."""
    st = season.new_season(TEAM, "full", seed=3, coach=_created("Neal", "Brown"), career=True)
    oc = next(s for s in st["career"]["staff"] if s["role"] == "OC")
    assert oc["name"] != "Neal Brown" and oc["name"].startswith("Neal ") and oc["name"].endswith(" Brown"), oc
    _assert_staff(st)
    finished(st)
    offseason.start(st)
    cs = st["league"]["teams"][TEAM]["coaches"]
    hc, lg_oc = cs["head_coach"], cs["offensive_coordinator"]
    assert hc["name"] == "Neal Brown" and hc.get("you") and hc["coach_id"].endswith(":you"), hc
    assert lg_oc["name"] == oc["name"] and lg_oc["coach_id"] != hc["coach_id"] and lg_oc is not hc, (lg_oc, hc)
    assert lg_oc["ratings"] != hc["ratings"], "the OC keeps his own record"
    assert not _dupes(_league_names(st)), _dupes(_league_names(st))
    ids = [c["coach_id"] for t in st["league"]["teams"].values() for c in t["coaches"].values() if c]
    assert len(set(ids)) == len(ids), collections.Counter(ids).most_common(3)
    _assert_staff(st)

    st = season.new_season(TEAM, "full", seed=3, career=True)
    oc1 = next(s for s in st["career"]["staff"] if s["role"] == "OC")["name"]
    assert oc1.lower() != "neal brown" and oc1 == coach_names.own_name(TEAM, "offensive_coordinator", {"Neal Brown"}), oc1
    line = season._coach_line(st, season.load_teams()[TEAM])
    assert line["name"] == "Neal Brown" and "Neal Brown" not in line["staff"]["offense"], line
    finished(st)
    offseason.start(st)
    cs = st["league"]["teams"][TEAM]["coaches"]
    assert cs["head_coach"]["name"] == "Neal Brown" and cs["offensive_coordinator"]["name"] == oc1, cs["offensive_coordinator"]["name"]
    assert cs["offensive_coordinator"]["previous_job"] == coach_names.OWN_STAFF_JOB
    assert not _dupes(_league_names(st)), _dupes(_league_names(st))
    beck = sorted(n for n in _league_names(st) if n.startswith("Tim") and n.endswith("Beck"))
    assert beck[0] == "Tim Beck" and len(beck) == 2 and beck[1] != "Tim Beck", beck    # two programs' Tim Beck in the data
    _assert_staff(st)


def test_offseason_keeps_names_unique():
    """A whole offseason (carousel, coach market, your staff's openings) with every coordinator on
    the move: no two coaches in the league or the market share a full name, nor anyone on your
    staff with you or each other."""
    saved = carousel.COORD_MOVE
    carousel.COORD_MOVE = 0.6
    try:
        st = season.new_season(TEAM, "full", seed=8, coach=_created("Neal", "Brown"), career=True)
        finished(st)
        offseason.start(st)
        for s in st["career"]["staff"]:
            s["contract_until"] = st["offseason"]["year"] - 1
        st["offseason"]["auto"] = True
        while st["offseason"]["stage"] != "ready":
            offseason.advance(st)
        names = _league_names(st)
        assert not _dupes(names), _dupes(names)
        hires = [c for c in st["offseason"]["carousel"]["changes"] if c["reason"] == "hired"]
        assert len(hires) >= 20, len(hires)
        _assert_staff(st)
        mine = st["league"]["teams"][TEAM]["coaches"]
        for s in st["career"]["staff"]:
            key = offseason.STAFF_ROLES.get(s["role"])
            if key:
                assert mine[key]["name"] == s["name"], (mine[key]["name"], s)
    finally:
        carousel.COORD_MOVE = saved
        season.close_pool()


def test_old_save_heals_on_load():
    """A save from before: the league's OC and your staff's OC both Neal Brown under head coach Neal
    Brown, two recruiters on one id, a recruiter named like a coach, one name at two programs and in
    the market. On load every one heals, the same way each time, and loading again changes nothing."""
    st = season.new_season(TEAM, "full", seed=3, career=True)
    finished(st)
    offseason.start(st)
    lgd = st["league"]
    cs = lgd["teams"][TEAM]["coaches"]
    cs["offensive_coordinator"]["name"] = "Neal Brown"        # as the data has it, and as older careers kept it
    cs["head_coach"].pop("you", None)
    staff = st["career"]["staff"]
    oc = next(s for s in staff if s["role"] == "OC")
    oc["name"] = "Neal Brown"
    staff[3]["id"] = staff[2]["id"]
    staff[4]["name"] = lgd["teams"]["texas"]["coaches"]["head_coach"]["name"]
    lgd["teams"]["usf"]["coaches"]["offensive_coordinator"]["name"] = "Tim Beck"
    lgd["teams"]["vanderbilt"]["coaches"]["offensive_coordinator"]["name"] = "Tim Beck"
    carousel.market(st)
    mk = lgd["market"]["coaches"]
    mk[0]["name"] = mk[1]["name"]
    old = copy.deepcopy(st)
    season.save_season(st)
    path = season.SEASONS_DIR / f"{st['id']}.json"
    try:
        back = season.load_season(st["id"])
        again = season.load_season(st["id"])
        bcs = back["league"]["teams"][TEAM]["coaches"]
        boc = next(s for s in back["career"]["staff"] if s["role"] == "OC")
        assert bcs["head_coach"]["name"] == "Neal Brown" and bcs["offensive_coordinator"]["name"] != "Neal Brown"
        assert boc["name"] == bcs["offensive_coordinator"]["name"], (boc, bcs["offensive_coordinator"]["name"])
        assert not _dupes(_league_names(back)), _dupes(_league_names(back))
        _assert_staff(back)
        assert back["league"] == again["league"] and back["career"]["staff"] == again["career"]["staff"], "not deterministic"
        before = copy.deepcopy(back)
        coach_names.distinct(back)
        assert back == before, "healing twice changed something"
        # an uploaded save heals the same way
        from coach_career import career
        up, _ = career.read_save(career.export_save(old, boxes=False))
        assert up["league"] == back["league"] and up["career"]["staff"] == back["career"]["staff"]
    finally:
        path.unlink(missing_ok=True)
        season.close_pool()
    # a first-season save (no league yet) with the data's OC on your staff
    st = season.new_season(TEAM, "full", seed=3, career=True)
    want = next(s for s in st["career"]["staff"] if s["role"] == "OC")["name"]
    next(s for s in st["career"]["staff"] if s["role"] == "OC")["name"] = "Neal Brown"
    coach_names.distinct(st)
    assert next(s for s in st["career"]["staff"] if s["role"] == "OC")["name"] == want


if __name__ == "__main__":
    test_new_career_named_like_real_staff()
    test_offseason_keeps_names_unique()
    test_old_save_heals_on_load()
    print("coach names ok: one coach, one name, one job; old saves heal")
