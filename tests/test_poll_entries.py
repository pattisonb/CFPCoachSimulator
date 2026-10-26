"""Who gets into the AP Top 25 from outside (sim/polls.next_poll): voters rank a team's whole
resume, so a team nobody voted for with three losses does not jump in on one big win (3 of 456
real entries since 2014 came from zero votes with three or more losses), while a team already
receiving votes that wins enters ahead of it."""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))
from sim import polls


def frame():
    prev = [{"team": f"t{i}", "rank": i, "points": 1700 - 62 * (i - 1), "first_place": 0} for i in range(1, 26)]
    prev += [{"team": "votes", "rank": None, "points": 128, "first_place": 0}, {"team": "fewvotes", "rank": None, "points": 30, "first_place": 0}]
    tiers = {e["team"]: "P4" for e in prev} | {"nobody": "P4", "unranked_a": "P4", "unranked_b": "P4"}
    records = {e["team"]: (6, 1) for e in prev} | {"t1": (7, 0), "t2": (6, 1), "nobody": (4, 3), "votes": (5, 2), "fewvotes": (5, 2), "unranked_a": (3, 4), "unranked_b": (3, 4)}
    games = [{"home": "nobody", "away": "t2", "home_score": 39, "away_score": 31, "neutral": False},         # a 4-3 team nobody voted for beats No. 2
             {"home": "votes", "away": "unranked_a", "home_score": 57, "away_score": 24, "neutral": False},  # first in line last week wins big
             {"home": "t25", "away": "unranked_b", "home_score": 10, "away_score": 13, "neutral": False}]    # No. 25 loses at home to a 3-4 team
    return prev, games, records, tiers


if __name__ == "__main__":
    prev, games, records, tiers = frame()
    order, key = polls.next_poll(prev, games, records, tiers)
    assert "nobody" not in order, f"a 4-3 team with no votes entered at #{order.index('nobody') + 1}"
    assert "votes" in order, "the team first in line with a win did not enter"
    assert "t25" not in order, "No. 25 stayed after losing at home to a 3-4 team"
    assert order.index("t2") >= 5, f"No. 2 only fell to #{order.index('t2') + 1} after losing to an unranked team"
    # a team with no votes can still enter unbeaten: 7-0 beating No. 2 goes in
    records2 = dict(records) | {"nobody": (7, 0)}
    order2, _ = polls.next_poll(prev, games, records2, tiers)
    assert "nobody" in order2, "a 7-0 team beating No. 2 did not enter"
    # the same through the voters' ballots (the game's path): each voter moves their own ballot
    seeded = polls.seed_ballots(prev, seed=3)
    ballots, points, _ = polls.next_ballots(seeded, prev, games, records, tiers, polls.load_ballot_params(), seed=3)
    top = sorted((t for t in points), key=lambda t: -points[t])[:25]
    assert "nobody" not in top, f"ballots: a 4-3 team with no votes entered at #{top.index('nobody') + 1} with {points['nobody']} points"
    assert "votes" in top, "ballots: the team first in line with a win did not enter"
    ballots2, points2, _ = polls.next_ballots(seeded, prev, games, records2, tiers, polls.load_ballot_params(), seed=3)
    top2 = sorted((t for t in points2), key=lambda t: -points2[t])[:25]
    assert "nobody" in top2, "ballots: a 7-0 team beating No. 2 did not enter"
    print(f"poll entries ok: nobody out, votes in at #{order.index('votes') + 1}, No. 2 to #{order.index('t2') + 1}, a 7-0 upset winner in at #{order2.index('nobody') + 1}")
