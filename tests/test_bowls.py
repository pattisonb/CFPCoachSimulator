"""Quick check of the bowl season: run one full season and print the bowls and playoff sites.
(Run as a file: multiprocessing on Windows cannot spawn workers from a piped script.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `from sim import season` works from here
import collections
import sys
import time

from sim import season

if __name__ == "__main__":
    slug = sys.argv[1] if len(sys.argv) > 1 else "michigan"
    t0 = time.perf_counter()
    st = season.new_season(slug, "full", seed=3)
    season.advance_to(st, 20)
    s = season.summary(st)
    print(f"{s['team_name']} {s['record']['wins']}-{s['record']['losses']} in {time.perf_counter() - t0:.1f}s; champion {s['champion_name']}")
    for g in s["schedule"]:
        if g["week"] >= 14:
            print(f"  wk{g['week']} {g['title'] or ''}: {'W' if g['won'] else 'L'} {g['points_for']}-{g['points_against']} vs {g['opponent_name']} @ {g.get('site')}")
    bowls = s["bowls"]
    print(f"bowls: {len(bowls)}, filled {sum(1 for b in bowls if not b['unfilled'])}, unfilled {[b['bowl'] for b in bowls if b['unfilled']]}")
    for b in bowls[:5] + bowls[-3:]:
        print(f"  wk{b['week']} {b['date']:<7} {b['name']:<26} {b['tie_ins']}  {b['away_name']} {b['away_score']} - {b['home_name']} {b['home_score']}")
    print("playoff games:")
    for g in st["games"].values():
        if g["kind"] == "playoff":
            print(f"  wk{g['week']} {g['title']} @ {g.get('site')}: {g['away_display']} {g['away_score']} - {g['home_display']} {g['home_score']}")
    print("bowl weeks:", dict(collections.Counter(b["week"] for b in bowls)))

    # a six-win team is never left home while a five-win team plays, unless the no-same-conference rule forced it (the
    # player's report: a 6-win UConn sat while a 5-win Missouri State played); UConn's "FBS Independent" is independent
    import random as _random
    from sim import bowls as _bowls
    teams = season.load_teams()
    real = [x for x, t in teams.items() if not t["fictional"]]
    assert teams["uconn"]["conference"] in _bowls.INDEPENDENT
    ratings = {x: t["team_ratings"]["overall"] for x, t in teams.items()}
    for seed in range(30):
        rng = _random.Random(seed)
        rec = {x: {"wins": 0, "losses": 0} for x in teams}
        for x in real:
            w = rng.choice(range(3, 12))
            rec[x] = {"wins": w, "losses": 12 - w}
        field = set(sorted(real, key=lambda x: -rec[x]["wins"])[:12])
        out = _bowls.select_bowls(rec, teams, field, [], ratings)
        picked = {x for b in out if not b["unfilled"] for x in (b["home"], b["away"])}
        six_out = {x for x in real if x not in field and x not in picked and rec[x]["wins"] >= 6}
        for b in out:
            if b["unfilled"]:
                continue
            for x, partner in ((b["home"], b["away"]), (b["away"], b["home"])):
                if rec[x]["wins"] == 5:
                    left = {teams[y]["conference"] for y in six_out}
                    assert left <= {teams[partner]["conference"]}, (seed, b["bowl"], x, sorted(six_out))
    print("bowl selection ok: no six-win team sits while a five-win team plays, but for the same-conference rule")
