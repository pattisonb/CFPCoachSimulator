"""Coaches develop like players (coach_career/offseason.py `_develop_coaches`): every coach in the
league closes part of the gap to a hidden level each offseason (the young have room, the old are
over theirs), a top-third year adds points and a bottom-third year takes them, nobody climbs more
than COACH_CLIMB over where he started, and past 63 he only drifts down; the pass is deterministic
and the Staff step shows your staff's changes. (Run as a file: multiprocessing on Windows.)"""
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
    # the expected change a year, per age and year cell: 400 seeded coaches a cell, ratings drawn from the
    # real league's coaches (those at or over the floor: a rating under it is held by design), the level
    # drawn as the league pass draws it, the same coaches across the three years. A staff member under 55
    # with an average year holds or climbs (0 to +1), a top-third year gains 2-4, a bottom-third year loses
    # 1-2; the young (under 40) gain 2-3 on average, the old (63+) lose 1-2.
    from coach_career import league
    pool = sorted(v for t in league.from_base()["teams"].values() for c in t["coaches"].values() if c and c.get("ratings")
                  for k, v in c["ratings"].items() if k != "overall" and v >= offseason.COACH_FLOOR)
    cells = {}
    for lo, hi in ((30, 39), (40, 54), (55, 62), (63, 70)):
        coaches = []
        for i in range(400):
            rng = random.Random(f"{lo}-{i}")
            age = rng.randint(lo, hi)
            r, c = {"a": rng.choice(pool)}, {}
            coaches.append((age, r, c, offseason._pot(c, r, rng, age)))
        for mark in (offseason.STAFF_MARK, 0, -offseason.STAFF_MARK):
            ds = []
            for i, (age, r0, c, pot) in enumerate(coaches):
                r = dict(r0)
                d = offseason.grow_coach(r, pot, age, offseason.COACH_PERF[mark], random.Random(f"{mark}-{i}"), c["base"])
                assert r["a"] == r0["a"] + d.get("a", 0) and min(offseason.COACH_FLOOR, r0["a"]) <= r["a"] <= min(offseason.COACH_CAP, r0["a"] + offseason.COACH_CLIMB), (r0, r, d)
                ds.append(r["a"] - r0["a"])
            cells[lo, mark] = sum(ds) / len(ds)
    top, avg, bot = offseason.STAFF_MARK, 0, -offseason.STAFF_MARK
    assert 0.0 <= cells[40, avg] <= 1.0 and 2.0 <= cells[40, top] <= 4.0 and -2.0 <= cells[40, bot] <= -1.0, cells
    assert 2.0 <= cells[30, avg] <= 3.0 and 3.0 <= cells[30, top] <= 5.0 and -1.0 <= cells[30, bot] <= 1.0, cells
    assert -1.0 <= cells[55, avg] <= 0.5 and cells[55, top] > 0.5 and -3.0 <= cells[55, bot] <= -1.0, cells
    old = sum(cells[63, m] for m in (top, avg, bot)) / 3
    assert -2.0 <= old <= -1.0 and cells[63, top] <= 0.0, (old, cells)
    # the climb cap: a young coach with room and a top-third year every year never passes where he started + COACH_CLIMB
    r = {k: 60 for k in KEYS}
    c = {}
    pot = offseason._pot(c, r, random.Random(1), 30)
    assert all(60 <= p <= 60 + offseason.COACH_CLIMB for p in pot.values()), pot
    for i in range(30):
        offseason.grow_coach(r, pot, 30 + i, offseason.COACH_PERF[offseason.STAFF_MARK], random.Random(i), c["base"])
    assert all(v == 60 + offseason.COACH_CLIMB for v in r.values()), r
    # a 66-year-old never gains, even after a top-third year, and loses a point or two a year on an average one
    gains = []
    for i in range(60):
        r = {k: 60 for k in KEYS}
        d = offseason.grow_coach(r, {k: 72 for k in KEYS}, 66, offseason.COACH_PERF[offseason.STAFF_MARK], random.Random(i))
        gains += [d.get(k, 0) for k in KEYS]
    assert max(gains) <= 0 and min(gains) < 0, sorted(set(gains))
    r = {k: 60 for k in KEYS}
    offseason.grow_coach(r, {k: 72 for k in KEYS}, 66, 0.0, random.Random(3))
    assert all(58 <= v <= 59 for v in r.values()), r
    # ... and never below the floor
    r = {k: offseason.COACH_FLOOR for k in KEYS}
    for i in range(30):
        offseason.grow_coach(r, {k: 99 for k in KEYS}, 70, 0.0, random.Random(i))
    assert all(v == offseason.COACH_FLOOR for v in r.values()), r
    # ... and no rating passes the cap
    r = {k: 98 for k in KEYS}
    for i in range(30):
        offseason.grow_coach(r, {k: 99 for k in KEYS}, 30, offseason.COACH_PERF[offseason.STAFF_MARK], random.Random(i))
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
            assert c.get("pot") and c.get("base") and c.get("age_at"), (slug, role)
            for k, v in c["ratings"].items():
                if k == "overall":
                    continue
                was = lg["teams"][slug]["coaches"][role]["ratings"][k]       # the pass already ran once on the way to this stage
                assert min(offseason.COACH_FLOOR, was) <= v <= min(offseason.COACH_CAP, c["base"][k] + offseason.COACH_CLIMB), (slug, role, k, v, was)
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
    print("coach development ok: expected change a year " + "; ".join(f"{lo}+ top {cells[lo, top]:+.1f} avg {cells[lo, avg]:+.1f} bottom {cells[lo, bot]:+.1f}" for lo in (30, 40, 55, 63)) +
          f"; {moved} ratings moved around the league; your staff: " +
          "; ".join(f"{r['role']} {', '.join(f'{c['rating']} {c['from']}→{c['to']}' for c in r['changes'])}" for r in mine))
