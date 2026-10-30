"""Coaches develop like players (coach_career/offseason.py `_develop_coaches`): every coach in the
league closes part of the gap to a hidden ceiling each offseason, faster young and after a good
year, not at all past 63 (he drifts down); the pass is deterministic and the Staff step shows
your staff's changes. (Run as a file: multiprocessing on Windows.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))
_sys.path.insert(0, str(_Path(__file__).resolve().parents[1] / "tests"))
import copy
import json
import random

from coach_career import offseason
from sim import season
from test_coach_market import to_stage
from test_offseason import finished

KEYS = ("play_calling", "player_development", "recruiting")

if __name__ == "__main__":
    # a 33-year-old coordinator with a top-third unit gains 2-6 a rating in a year
    gains = []
    for i in range(60):
        r = {k: 60 for k in KEYS}
        d = offseason.grow_coach(r, {k: 72 for k in KEYS}, 33, offseason.COACH_PERF[offseason.STAFF_MARK], random.Random(i))
        gains += [d.get(k, 0) for k in KEYS]
        assert all(r[k] == 60 + d.get(k, 0) for k in KEYS), (r, d)
    assert all(2 <= g <= 6 for g in gains), sorted(set(gains))
    # a 66-year-old never gains and sometimes loses, and never below the floor
    gains = []
    for i in range(60):
        r = {k: 60 for k in KEYS}
        d = offseason.grow_coach(r, {k: 72 for k in KEYS}, 66, 1.3, random.Random(i))
        gains += [d.get(k, 0) for k in KEYS]
    assert max(gains) <= 0 and min(gains) < 0, sorted(set(gains))
    r = {k: offseason.COACH_FLOOR for k in KEYS}
    for i in range(30):
        offseason.grow_coach(r, {k: 99 for k in KEYS}, 70, 1.0, random.Random(i))
    assert all(v == offseason.COACH_FLOOR for v in r.values()), r
    # ... and no rating passes the cap
    r = {k: 98 for k in KEYS}
    for i in range(30):
        offseason.grow_coach(r, {k: 99 for k in KEYS}, 30, 1.3, random.Random(i))
    assert all(v <= offseason.COACH_CAP for v in r.values()), r
    # the whole league, at the Development stage: deterministic for a seed, bounded, the ceilings and ages kept
    st = season.new_season("ohio-state", "full", seed=5, career=True)
    finished(st)
    offseason.start(st)
    to_stage(st, "development")
    lg = st["league"]
    a, b = copy.deepcopy(st), copy.deepcopy(st)
    ra, rb = offseason._develop_coaches(a), offseason._develop_coaches(b)
    assert ra == rb and json.dumps(a["league"]["teams"], sort_keys=True) == json.dumps(b["league"]["teams"], sort_keys=True), "not deterministic"
    assert json.dumps(a["league"].get("market"), sort_keys=True) == json.dumps(b["league"].get("market"), sort_keys=True)
    moved = 0
    for slug, t in a["league"]["teams"].items():
        for role, c in t["coaches"].items():
            if not (c and c.get("name")):
                continue
            assert c.get("pot") and c.get("age_at"), (slug, role)
            for k, v in c["ratings"].items():
                if k == "overall":
                    continue
                was = lg["teams"][slug]["coaches"][role]["ratings"][k]       # the pass already ran once on the way to this stage
                assert min(offseason.COACH_FLOOR, was) <= v <= offseason.COACH_CAP and v <= max(c["pot"][k], was), (slug, role, k, v, was)
                moved += v != lg["teams"][slug]["coaches"][role]["ratings"][k]
    assert moved > 100, moved
    assert all(e.get("pot") for e in (a["league"].get("market") or {}).get("coaches", []))      # the pool exists from the second offseason
    # your staff's rows: one per member (and you), with the changes and a reason
    mine = ra["mine"]
    ids = {r["id"] for r in mine}
    assert {s["id"] for s in a["career"]["staff"]} <= ids and "hc" in ids, ids
    for row in mine:
        assert row["name"] and row["role"] and isinstance(row["changes"], list) and isinstance(row["why"], list), row
        for ch in row["changes"]:
            assert ch["to"] != ch["from"] and ch["rating"], ch
    staff_by = {s["id"]: s for s in a["career"]["staff"]}
    for row in mine:
        if row["id"] in staff_by and row["role"] in ("OC", "DC"):        # the team's coordinator and your staff entry agree
            key = offseason.STAFF_ROLES[row["role"]]
            c = a["league"]["teams"]["ohio-state"]["coaches"][key]
            assert staff_by[row["id"]]["evaluation"] == c["ratings"]["player_development"], (staff_by[row["id"]], c["ratings"])
    # the Staff step view carries the rows, one per staff member
    offseason.advance(a)
    v = offseason.view(a)
    assert v["staff"] and {r["id"] for r in v["staff"]["developed"]} >= {s["id"] for s in a["career"]["staff"]}
    season.close_pool()
    print(f"coach development ok: {moved} ratings moved around the league; your staff: " +
          "; ".join(f"{r['role']} {', '.join(f'{c['rating']} {c['from']}→{c['to']}' for c in r['changes'])}" for r in mine))
