""""OC likes him" / "DC likes him" (prospects.staff_likes): once his report is complete, your coordinator
vouches for a recruit whose READ (never the truth) says he would start on your returning roster at his
position group: his overall now as the read's midpoint sees it, against the returning players the way
recruiting.ahead_of counts them (seniors gone), fewer ahead of him than the group starts
(offseason.STARTERS). The OC speaks for the offense, the DC for the defense, one of them (fixed by the
seed) for a kicker or punter. Nothing in the portal, nothing once he signed elsewhere, nothing short
of three looks. Through app.api as the page calls it: board rows, the profile, the scouting queue, the
reports and the Flags list carry it. (Run as a file.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `from sim import season` works from here

import random

from app import api
from coach_career import offseason
from coach_career import prospects
from coach_career import recruiting
from sim import season

ME = "ohio-state"
TEXT = {"OC": "Your offensive coordinator thinks he starts for you next year",
        "DC": "Your defensive coordinator thinks he starts for you next year"}


def G(sid: str, path: str) -> dict:
    return api.call("GET", f"/api/season/{sid}/{path}")


def R(sid: str, path: str, body: dict) -> dict:
    return api.call("POST", f"/api/season/{sid}/{path}", body)


def force_read(st: dict, pid: str, off: float, looks: float = recruiting.FIND_LOOKS) -> None:
    """A read this sure has no width: every group's grade `off` points from his truth, `looks` looks in."""
    p = st["recruiting"]["prospects"][pid]
    st["recruiting"]["reads"][pid] = {"looks": float(looks), "area": 0.0, "by": {"95": float(looks)},
                                      "g": {g: [max(0.0, min(99.0, p["truth"][g] + off)), 1000.0] for g in recruiting.GROUPS}}


def ahead_by_truth(st: dict, pid: str) -> int:
    p = st["recruiting"]["prospects"][pid]
    return sum(1 for o in recruiting._returning(ME, recruiting._group_of(p)) if o >= p["ovr"])


def pick(st: dict, groups: tuple, starts: bool, skip: tuple = ()) -> str:
    """An open, visible recruit at one of these groups who would (or would not) start by his true overall."""
    rc = st["recruiting"]
    for pid in sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"]):
        p = rc["prospects"][pid]
        g = recruiting._group_of(p)
        if g not in groups or pid in skip or p.get("hidden") or rc["status"][pid]["signed"] or rc["status"][pid]["committed"]:
            continue
        if (ahead_by_truth(st, pid) < offseason.STARTERS[g]) == starts:
            return pid
    raise AssertionError(f"no recruit at {groups} who {'would' if starts else 'would not'} start")


if __name__ == "__main__":
    import shutil
    import tempfile
    season.SEASONS_DIR = _Path(tempfile.mkdtemp(prefix="cfp-likes-test-"))
    try:
        sid = api.call("POST", "/api/season", {"team": ME, "mode": "full", "seed": 11, "career": True})["id"]
        st = api.loaded_state()
        rc = st["recruiting"]
        staff = {m["role"]: m["name"] for m in st["career"]["staff"]}

        # a QB whose read, after three Sends, beats your returning quarterbacks: the OC likes him
        qb = pick(st, ("QB",), starts=False)                   # by the truth he would not start: the read says he does
        force_read(st, qb, +40.0)
        assert prospects.read_overall(st, qb) > max(recruiting._returning(ME, "QB")), prospects.read_overall(st, qb)
        like = prospects.staff_likes(st, qb, ME)
        assert like == {"who": "OC", "name": staff["OC"], "text": TEXT["OC"]}, like
        # not at two looks, nor at two and a half: the same gate as the flags
        force_read(st, qb, +40.0, looks=2.0)
        assert prospects.staff_likes(st, qb, ME) is None, "no like short of a complete report"
        force_read(st, qb, +40.0, looks=2.5)
        assert prospects.staff_likes(st, qb, ME) is None
        force_read(st, qb, +40.0)
        assert prospects.staff_likes(st, qb, ME) is not None and prospects.staff_likes(st, qb, ME) is prospects.staff_likes(st, qb, ME), "cached per read"

        # a defensive recruit: the DC
        d = pick(st, ("DL", "LB", "CB", "S"), starts=False)
        force_read(st, d, +40.0)
        like = prospects.staff_likes(st, d, ME)
        assert like == {"who": "DC", "name": staff["DC"], "text": TEXT["DC"]}, like

        # a kicker or punter: one of the two, fixed by the seed
        k = pick(st, ("K", "P"), starts=False)
        force_read(st, k, +40.0)
        like = prospects.staff_likes(st, k, ME)
        who = random.Random(f"likes-{rc['seed']}-{k}").choice(("OC", "DC"))
        assert like == {"who": who, "name": staff[who], "text": TEXT[who]}, (like, who)

        # the read, not the truth: a recruit who WOULD start by his true overall is not liked when the read sits under the starter
        t = pick(st, ("QB", "RB", "WR", "TE", "OL", "DL", "LB", "CB", "S"), starts=True)
        force_read(st, t, -40.0)
        assert ahead_by_truth(st, t) < offseason.STARTERS[recruiting._group_of(rc["prospects"][t])]
        assert prospects.read_overall(st, t) < rc["prospects"][t]["ovr"]
        assert prospects.staff_likes(st, t, ME) is None, "the truth would start him; the read does not"
        # the plain rule: fewer returning players at or above his read overall than the group starts
        g = recruiting._group_of(rc["prospects"][t])
        ahead = sum(1 for o in recruiting._returning(ME, g) if o >= prospects.read_overall(st, t))
        assert ahead >= offseason.STARTERS[g], (ahead, g)

        # signed elsewhere: gone
        rc["status"][d]["signed"] = "michigan"
        assert prospects.staff_likes(st, d, ME) is None
        rc["status"][d]["signed"] = None
        assert prospects.staff_likes(st, d, ME) is not None

        # the views carry it: board rows, the profile, the queue (a complete report stays in the queue only on your board, with the
        # like; an open report has none yet), the Flags list
        for pid in (qb, d, k):
            R(sid, "board", {"pid": pid, "on": True})
        rows = {b["id"]: b for b in G(sid, "recruiting")["board"]}
        assert rows[qb]["likes"]["who"] == "OC" and rows[d]["likes"]["who"] == "DC" and rows[k]["likes"]["who"] == who
        assert rows[qb]["likes"]["text"] == TEXT["OC"]
        assert all("likes" in b for b in rows.values())
        prof = G(sid, f"prospect/{qb}")
        assert prof["likes"] == {"who": "OC", "name": staff["OC"], "text": TEXT["OC"]}, prof["likes"]
        assert prospects.staff_likes(st, t, ME) is None and G(sid, f"prospect/{t}")["likes"] is None
        v = G(sid, "scouting")
        assert all("likes" in r for r in v["queue"])
        assert all(r["likes"] is None for r in v["queue"] if r["looks"] < 3), "an open report has no like yet"
        kept = {r["pid"]: r for r in v["queue"] if r["looks"] >= 3}
        assert set(kept) >= {qb, d, k} and all(kept[pid]["likes"]["who"] for pid in (qb, d, k)), "the board's complete reports stay in the queue with the like"
        assert all(r["pid"] in rc["board"] for r in kept.values()), "a complete report off the board is out of the queue"
        liked = {f["pid"]: f for f in v["flags"] if f["flag"] == "likes"}
        assert set(liked) >= {qb, d, k}, (set(liked), qb, d, k)
        assert liked[qb]["likes"]["who"] == "OC" and liked[qb]["looks"] == 3
        kinds = [f["flag"] for f in v["flags"]]
        assert kinds.index("likes") > max((i for i, f in enumerate(kinds) if f == "gem"), default=-1), "liked recruits sort after the gems"
        assert all(k != "bust" or i > kinds.index("likes") for i, k in enumerate(kinds)), kinds
        # a Send that completes a report returns the like with the look, so the queue row can show it at once
        two = pick(st, ("QB",), starts=False, skip=(qb,))
        force_read(st, two, +40.0, looks=2.0)
        res = R(sid, "recruit", {"pid": two, "action": "scout"})
        assert res["look"]["likes"] is not None and res["look"]["likes"]["who"] == "OC", res["look"]
        assert rc["reads"][two]["looks"] == 3

        # the portal: never
        from tests.test_offseason import finished
        liked_names = (rc["prospects"][qb]["name"], rc["prospects"][d]["name"], rc["prospects"][d]["position"],
                       rc["prospects"][k]["name"], rc["prospects"][k]["position"])
        finished(api.loaded_state()); api._save_loaded()
        G(sid, "offseason")
        while api.loaded_state()["offseason"]["stage"] != "portal_w1":
            R(sid, "offseason/advance", {})
        pst = api.loaded_state()
        prc = pst["recruiting"]
        assert recruiting.is_portal(pst)
        ppid = next(pid for pid in prc["prospects"] if prc["prospects"][pid].get("portal"))
        force_read(pst, ppid, +40.0)
        assert prospects.staff_likes(pst, ppid, ME) is None
        assert all(f["flag"] != "likes" for f in G(sid, "scouting")["flags"])
        print(f"staff likes ok: {liked_names[0]} (QB, OC), {liked_names[1]} ({liked_names[2]}, DC),"
              f" {liked_names[3]} ({liked_names[4]}, {who}); {len(liked)} liked in the Flags list; none in the portal")
    finally:
        shutil.rmtree(season.SEASONS_DIR, ignore_errors=True)
