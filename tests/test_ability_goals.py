"""Clear Mode ability goals: every player works toward an ability that suits his position; reaching it in games earns
it (or its next tier) mid-season, your program's news says so, his page shows the goal and his progress, and the
offseason writes what he earned into the league's rosters."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def check_units():
    from coach_career import ability_goals as ag
    # pluralized goal words; a draw spreads goals past the first fit
    qb = {ag.next_goal("QB", {}, f"P{i}|QB")[0] for i in range(40)}
    assert len(qb) >= 3, qb
    assert ag.next_goal("QB", {t: 4 for t in ag.FITS["QB"]}, "x|QB") is None
    g = {"home": "ohio-state", "away": "michigan", "week": 3, "event_id": "e1"}
    st = {"year": 2026, "ability_goals": {"ohio-state": {"A B|S": {"trait": "route_jumper", "tier": 1, "have": 1, "since": [2026, 1]}}}}
    lines = {"home": {"players": [{"name": "A B", "position": "S", "stats": {"interceptions": 1}}]}, "away": {"players": []}}
    made = ag.after_game(st, g, lines, {}, {})
    need = ag.GOALS["route_jumper"][2][0]
    assert (len(made) == 1) == (need <= 2), (made, need)
    if made:
        assert made[0]["how"] == f"{need} interceptions", made[0]
        assert st["abilities_earned"]["ohio-state"]["A B|S"]["route_jumper"] == 1
    st2 = {"year": 2026, "ability_goals": {"ohio-state": {"K K|K": {"trait": "ice_water", "tier": 1, "have": 0, "since": [2026, 1]}}}}
    made = ag.after_game(st2, g, {"home": {"players": [{"name": "K K", "position": "K", "stats": {}}]}},
                         {"home": {"K K|K": {"clutch_kick": 1}}}, {})
    assert made and made[0]["how"] == "1 clutch kick made", made
    merged = ag.merged_traits(st2, "ohio-state", "K K|K", [{"key": "cannon_leg", "tier": 2}])
    assert {(t["key"], t.get("earned", False)) for t in merged} == {("cannon_leg", False), ("ice_water", True)}, merged


def check_season():
    from sim import season
    from coach_career import ability_goals as ag, office
    st = season.new_season("ohio-state", "full", seed=9, career=True)
    season.advance_to(st, 6)
    ev = st.get("ability_events") or []
    assert ev, "no abilities earned in six weeks"
    assert all(e["how"] and e["tier_name"] in ("Bronze", "Silver", "Gold", "Platinum") for e in ev)
    per_team = len(ev) / max(1, len({e["team"] for e in ev}))
    assert per_team < 8, f"too many abilities a team in six weeks: {per_team:.1f}"
    mine = [e for e in ev if e["team"] == "ohio-state"]
    news = office.program_news(st)
    items = [n for n in ag.news(st)]
    assert len(items) == len(mine)
    for n in items:
        assert n["line"][0].isupper() and n["line"].endswith(".") and "None" not in n["line"], n
    # his page: the goal and progress; an earned trait shows, marked earned
    teams = season.load_teams()
    p = teams["ohio-state"]["offense"][0]
    prof = season.player_profile(st, "ohio-state", p["name"], p["position"])
    goal = prof["ability_goal"]
    assert goal and 0 <= goal["have"] <= goal["need"] and goal["text"], goal
    if mine:
        e = mine[0]
        prof = season.player_profile(st, "ohio-state", e["player"], e["position"])
        assert any(t["key"] == e["trait"] and t["tier"] >= e["tier"] for t in prof["traits"]), prof["traits"]
    # carry over: earned abilities land in the league's rosters
    from coach_career import league as lg
    lgd = lg.from_base(2027)
    want = sum(len(v) for t in st["abilities_earned"].values() for v in t.values())
    n = ag.carry_over(st, lgd)
    assert n > 0 and n <= want, (n, want)
    assert "abilities_earned" not in st and "ability_goals" not in st
    print(f"ok: {len(ev)} abilities in six weeks ({per_team:.1f} a team), {len(mine)} yours, {n} carried over; news {len(news)} items")


def check_recruits():
    from coach_career import ability_goals as ag
    rows = [ag.recruit_abilities({"id": f"r{i}", "stars": s, "ea_position": "WR"}) for i in range(600) for s in (3, 5)]
    three = sum(1 for i, r in enumerate(rows) if i % 2 == 0 and r) / 600
    five = sum(1 for i, r in enumerate(rows) if i % 2 == 1 and r) / 600
    assert 0.15 < three < 0.35 and 0.6 < five < 0.9, (three, five)
    assert ag.recruit_abilities({"id": "r1", "stars": 5, "ea_position": "WR"}) == ag.recruit_abilities({"id": "r1", "stars": 5, "ea_position": "WR"})
    for r in rows:
        for a in r:
            assert a["tier"] in (1, 2, 3) and a["name"] and a["key"] in ag.FITS["WR"]
    assert all("|" in x for x in ag.recruit_ab_field({"id": "r3", "stars": 5, "ea_position": "WR"}))



def main():
    check_units()
    check_recruits()
    check_season()


if __name__ == "__main__":
    main()
