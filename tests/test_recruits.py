"""Generated recruiting classes: a class is the same for the same year and seed, holds the real
star counts, ranks every prospect once with a unique fictional name, keeps ratings on the scale
with potential at or above them, develops toward potential and never past it, and joins a roster
in the source format build_teams reads. (Run as a file: multiprocessing on Windows.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `from sim import season` works from here
import json
import random
import statistics as st
from collections import Counter

from teamdata import build_teams
from coach_career import recruits

if __name__ == "__main__":
    real = set()
    for path in (_Path(recruits.ROOT) / "cfb_sim_data" / "teams").glob("*.json"):
        real |= {p["name"].lower() for p in json.loads(path.read_text(encoding="utf-8"))["roster"]}
    cls = recruits.generate_class(2027, 7, taken=set(real))
    again = recruits.generate_class(2027, 7, taken=set(real))
    assert [p["name"] for p in cls] == [p["name"] for p in again] and cls[0]["ratings_ea"] == again[0]["ratings_ea"], "same seed, different class"
    assert recruits.generate_class(2027, 8)[0]["name"] != cls[0]["name"] or recruits.generate_class(2027, 8)[1]["name"] != cls[1]["name"]

    counts = Counter(str(p["stars"]) for p in cls)
    assert counts == Counter(recruits.model()["generation"]["prospects_per_class"]), counts
    assert [p["rank"] for p in cls] == list(range(1, len(cls) + 1))
    assert all(a["composite"] >= b["composite"] for a, b in zip(cls, cls[1:]))
    names = [p["name"].lower() for p in cls]
    assert len(set(names)) == len(names), "two prospects share a name"
    assert not set(names) & real, "a prospect has a real player's name"
    assert {p["coachability"] for p in cls} == set(recruits.RATE)

    for p in cls:
        assert all(0 <= v <= 99 for v in p["ratings_ea"].values()), p["name"]
        assert all(p["potential_ea"][k] >= v for k, v in p["ratings_ea"].items()), p["name"]
        assert 1 <= p["overall_ea"] <= 99 and p["hometown"]["state"]

    # athleticism first: speed has little room, football IQ a lot
    wr = [p for p in cls if p["ea_position"] == "WR"]
    room = lambda k: st.mean(p["potential_ea"][k] - p["ratings_ea"][k] for p in wr)
    assert room("speed") < 2 < room("awareness") - 5, (room("speed"), room("awareness"))
    # higher stars start higher
    by = {s: st.mean(p["overall"] for p in cls if p["stars"] == s) for s in (5, 4, 3, 2)}
    assert by[5] > by[4] > by[3] > by[2], by

    # development: toward potential, never past it, faster for the coachable
    rng = random.Random(1)
    fast = next(p for p in cls if p["coachability"] == "Coach's Dream" and p["stars"] == 3)
    slow = next(p for p in cls if p["coachability"] == "Set in His Ways" and p["stars"] == 3)
    gap0 = {id(p): sum(p["potential_ea"][k] - v for k, v in p["ratings_ea"].items()) for p in (fast, slow)}
    for _ in range(3):
        for p in (fast, slow):
            recruits.develop(p, rng)
    for p in (fast, slow):
        assert all(v <= p["potential_ea"][k] for k, v in p["ratings_ea"].items())
    closed = {id(p): 1 - sum(p["potential_ea"][k] - v for k, v in p["ratings_ea"].items()) / max(1, gap0[id(p)]) for p in (fast, slow)}
    assert closed[id(fast)] > closed[id(slow)] + 0.3, closed

    # a signed recruit joins a roster in the source format
    team = json.loads((_Path(recruits.ROOT) / "cfb_sim_data" / "teams" / "ohio-state.json").read_text(encoding="utf-8"))
    for i, p in enumerate(cls[:200]):
        m = build_teams.map_player(recruits.as_roster_player(p, team, f"gen-{i}"))
        assert m and isinstance(m.get("speed"), (int, float)), p["name"]
    # the real players: every one seeded the same way twice, the coachability shares exact, the best
    # development traits on top, and no room left for a fifth-year player
    roster = []
    for path in (_Path(recruits.ROOT) / "cfb_sim_data" / "teams").glob("*.json"):
        roster += json.loads(path.read_text(encoding="utf-8"))["roster"]
    seeded = recruits.seed_real_players(roster)
    assert seeded == recruits.seed_real_players(roster), "seeding is not deterministic"
    levels = Counter(v["coachability"] for v in seeded.values())
    for name, _, share in recruits.COACHABILITY:
        assert abs(levels[name] / len(seeded) - share) < 0.001, (name, levels[name])
    by_slug = {p["slug"]: p for p in roster}
    assert all(v["coachability"] == "Coach's Dream" for s, v in seeded.items() if by_slug[s].get("dev_trait") == "Elite")
    fifth = [v for s, v in seeded.items() if by_slug[s].get("class_year") == "Senior (RS)"]
    assert fifth and all(not v["potential_ea"] for v in fifth), "a fifth-year player has room to grow"
    young = [v for s, v in seeded.items() if by_slug[s].get("class_year") == "Freshman"]
    assert st.mean(len(v["potential_ea"]) for v in young) > 10

    top = cls[0]
    print(f"recruits ok: {len(cls)} prospects, #1 {top['name']} ({top['stars']}* {top['position']}, "
          f"{top['hometown']['city']}, {top['hometown']['state']}), freshman overall by stars {({s: round(v, 1) for s, v in by.items()})}")
