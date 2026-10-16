"""Quick check of the bowl season: run one full season and print the bowls and playoff sites.
(Run as a file: multiprocessing on Windows cannot spawn workers from a piped script.)"""
import collections
import sys
import time

import season

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
