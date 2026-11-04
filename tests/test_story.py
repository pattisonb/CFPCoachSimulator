"""His Story (persona.py, spec section 2): the class's stories are a fixed draw from the seed, worked out
when asked and never stored; shares hold (about 35% of the class, half the four- and five-stars, at most
one each); a Package Deal pairs two prospects both ways; a Late Bloomer starts at two or three stars and an
Injury Comeback one star under his own, their real stars kept on the prospect; the class ranking stays one
order 1..N by the shown composite; a save from before stories has none."""
import sys as _sys
from collections import Counter
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))

from coach_career import persona, recruiting
from sim import season


def career(seed):
    return season.new_season("ohio-state", "full", seed=seed, career=True)


if __name__ == "__main__":
    st = career(4)
    rc = st["recruiting"]
    pros = rc["prospects"]
    drawn = persona.stories(st)

    # test_not_persisted: nothing story-shaped in the save but a shown prospect's real stars
    assert rc.get("stories") == 1, "a class drawn with stories is marked"
    assert not any("story" in p or "story_data" in p for p in pros.values()), "stories are a fixed draw, never stored on the prospect"
    assert "story_map" not in rc and not any(isinstance(v, dict) and "story" in v for v in rc.values() if isinstance(v, dict) and len(v) < 5)

    # test_deterministic: a fresh draw from the saved class is the same
    persona._STORIES = (None, None, {})
    assert persona.stories(st) == drawn
    st2 = career(4)
    assert persona.stories(st2) == drawn, "the same seed draws the same stories"

    # test_shares
    n = len(pros)
    share = len(drawn) / n
    assert 0.31 <= share <= 0.41, share
    real = lambda q: (pros[q].get("real") or pros[q])["stars"]
    blue = [q for q in pros if real(q) >= 4]
    blue_share = sum(1 for q in blue if q in drawn) / len(blue)
    assert 0.42 <= blue_share <= 0.60, blue_share
    kinds = Counter(s["story"] for s in drawn.values())
    total = sum(kinds.values())
    for k, want in persona.STORIES.items():
        got = kinds[k] / total
        assert abs(got - want) <= 0.06, (k, got, want, kinds)
    for s in drawn.values():
        assert s["story"] in persona.STORIES and isinstance(s["story_data"], dict), s

    # test_package_symmetric
    pairs = 0
    for pid, s in drawn.items():
        if s["story"] != "package":
            continue
        mate = s["story_data"]["mate"]
        assert drawn[mate]["story"] == "package" and drawn[mate]["story_data"]["mate"] == pid, (pid, mate)
        assert s["story_data"]["lead"] != drawn[mate]["story_data"]["lead"]
        lead, other = (pid, mate) if s["story_data"]["lead"] else (mate, pid)
        assert (pros[lead].get("real") or pros[lead])["composite"] > (pros[other].get("real") or pros[other])["composite"]
        assert pros[lead]["hometown"]["state"] == pros[other]["hometown"]["state"]
        assert persona.mate(st, pid) == mate
        pairs += 1
    assert pairs >= 40, pairs

    # test_legacy_and_hero
    teams = season.load_teams()
    for pid, s in drawn.items():
        if s["story"] == "legacy":
            assert s["story_data"]["school"] in recruiting.fbs_schools(st)
            school = s["story_data"]["school"]
            assert school not in rc["lists"][pid], "a head start, not a place on his list"
            pull = recruiting.interest(st, school, pid) - persona.LEGACY_HEAD
            assert abs(persona.story_interest(st, school, pid, pull) - pull - persona.LEGACY_HEAD) < 1e-9
        if s["story"] == "hero":
            assert s["story_data"]["state"] == pros[pid]["hometown"]["state"]
            assert any(teams[t].get("state") == s["story_data"]["state"] for t in recruiting.fbs_schools(st))
        if s["story"] == "two_sport":
            assert recruiting._group_of(pros[pid]) in persona.TWO_SPORT_GROUPS

    # test_bloomer_and_comeback_shown_low
    gen = set(rc.get("generational") or ())
    for pid, s in drawn.items():
        p = pros[pid]
        if s["story"] == "bloomer":
            d = s["story_data"]
            assert 5 <= d["week"] <= 9 and d["jump"] in (1, 2), d
            assert p["stars"] in (2, 3) and p["real"]["stars"] == p["stars"] + d["jump"], (p["stars"], p["real"], d)
            assert p["composite"] < p["real"]["composite"] and p["rank"] > 300, "a bloomer starts unranked: outside the top 300"
            assert pid not in gen
        elif s["story"] == "comeback":
            assert p["stars"] == max(2, p["real"]["stars"] - 1) and p["composite"] <= p["real"]["composite"], (p["stars"], p["real"])
            assert pid not in gen
        else:
            assert "real" not in p
    assert not any("real" in pros[q] for q in pros if q not in drawn)
    ranks = sorted(p["rank"] for p in pros.values())
    assert ranks == list(range(1, n + 1)), "the ranking is one order 1..N"
    order = sorted(pros, key=lambda q: pros[q]["rank"])
    assert all(pros[a]["composite"] >= pros[b]["composite"] for a, b in zip(order, order[1:])), "ranked by the shown composite"

    # test_old_save_has_none: a class from before stories (no marker) has no story at all
    del rc["stories"]
    persona._STORIES = (None, None, {})
    assert persona.stories(st) == {} and persona.story(st, next(iter(drawn))) == (None, {})
    rc["stories"] = 1
    # a test (or an old save) may set one on the prospect's persona
    pid = order[10]
    pros[pid]["persona"] = {"personality": "shy", "decider": "self", "decider_topic": None, "story": "two_sport", "story_data": {}}
    assert persona.story(st, pid) == ("two_sport", {})
    del pros[pid]["persona"]

    # test_portal_has_none
    assert persona.stories({"recruiting": {"portal": True, "prospects": {}}}) == {}
    print(f"test_story: ok ({len(drawn)} stories of {n}: {dict(kinds)}, blue chips {blue_share:.2f})")
