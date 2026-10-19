"""In-season form: the fit points the right way, shifts ratings by the right amount, and a
remaining-mode season carries it into its sims. (Run as a file: multiprocessing on Windows.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `import season` works from here

import form  # noqa: E402
import season  # noqa: E402

if __name__ == "__main__":
    teams = season.load_teams()
    # a made-up slate: A beats everyone by 12 more than the ratings say, B loses by 12 more (under the 28-point cap)
    slugs = [s for s, t in teams.items() if not t["fictional"]][:12]
    a, b, rest = slugs[0], slugs[1], slugs[2:]
    games = []
    cid = 1
    for opp in rest[:5]:
        base = (teams[a]["team_ratings"]["overall"] - teams[opp]["team_ratings"]["overall"]) * form.PTS_PER_RATING + form.HFA
        games.append({"week": 1, "final": True, "neutral": False, "home_name": teams[a]["name"], "away_name": teams[opp]["name"],
                      "home_seo": a, "away_seo": opp, "home_score": 40, "away_score": int(round(40 - base - 12)), "contest_id": cid}); cid += 1
        base = (teams[opp]["team_ratings"]["overall"] - teams[b]["team_ratings"]["overall"]) * form.PTS_PER_RATING + form.HFA
        games.append({"week": 1, "final": True, "neutral": False, "home_name": teams[opp]["name"], "away_name": teams[b]["name"],
                      "home_seo": opp, "away_seo": b, "home_score": 40, "away_score": int(round(40 - base - 12)), "contest_id": cid}); cid += 1
    table = form.fit_form(games, teams)
    assert table[a]["points"] > 4 and table[b]["points"] < -4, (table[a], table[b])
    assert abs(table[a]["points"] - 12 * 5 / (5 + form.K)) < 3, table[a]   # ridge: 5 games keep 5/9 of the 12
    assert table[a]["games"] == 5 and abs(table[a]["rating"] - table[a]["points"] / form.PTS_PER_RATING) < 0.01
    print(f"synthetic: {teams[a]['name']} form {table[a]['points']:+.1f} pts ({table[a]['rating']:+.1f} rating), {teams[b]['name']} {table[b]['points']:+.1f}")

    # the shift moves every rating, clamped, and a zero shift returns the same object
    t = teams[a]
    up = form.with_form(t, 5)
    qb = next(p for p in t["offense"] if p["position"] == "QB")
    qb2 = next(p for p in up["offense"] if p["name"] == qb["name"])
    assert qb2["passing"] == min(99, qb["passing"] + 5) and qb2["speed"] == min(99, qb["speed"] + 5)
    assert form.with_form(t, 0.2) is t
    assert season.player_overall(qb2) > season.player_overall(qb)

    # the real results, if downloaded: every team's shift is bounded and the table is not trivial
    real = form.load_form(teams)
    if real:
        shifts = [f["rating"] for f in real.values()]
        assert max(abs(x) for x in shifts) <= form.MAX_SHIFT and max(shifts) > 1 and min(shifts) < -1
        print(f"real 2026 results: {len(real)} teams, shifts from {min(shifts):+.1f} to {max(shifts):+.1f} rating points")
        # a remaining-mode season carries the table and the preview sees the shifted team
        st = season.new_season("ohio-state", "remaining", seed=1)
        assert st["form"] and st["form"].get("ohio-state")
        shifted = season._preview_team(st, "ohio-state")
        base = season.load_teams()["ohio-state"]
        d = season.team_form_shift(st, "ohio-state")
        if abs(d) >= 0.5:
            p0 = next(p for p in base["offense"] if p["position"] == "QB" and p.get("in_game"))
            p1 = next(p for p in shifted["offense"] if p["name"] == p0["name"])
            assert p1["passing"] == max(1, min(99, int(round(p0["passing"] + d)))), (p0["passing"], p1["passing"], d)
        print(f"remaining mode: Ohio State form {st['form']['ohio-state']['points']:+.1f} pts, shift {d:+.1f}; week {st['current_week']}")
        full = season.new_season("ohio-state", "full", seed=1)
        assert full["form"] == {}, "a full season from preseason carries no form"
    print("form ok")
