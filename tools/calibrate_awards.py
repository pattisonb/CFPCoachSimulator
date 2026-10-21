"""Run several full seasons and summarize the award results against the research targets
in docs/AWARDS_RESEARCH.md: `python calibrate_awards.py [seasons] [seed]`.
(Run as a file: multiprocessing on Windows cannot spawn workers from a piped script.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `import season` works from here
import collections
import sys
import time

import season

G5_CONFERENCES = {"American Athletic Conference", "Conference USA", "MAC", "Mountain West", "Pac-12", "Sun Belt"}
DEFENSIVE_POSITIONS = ("DL", "MLB", "ROLB", "LOLB", "CB", "S")

if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 8
    seed0 = int(sys.argv[2]) if len(sys.argv) > 2 else 100
    teams = season.load_teams()
    pos = collections.Counter()
    top5_pos = collections.Counter()
    winner_rank = []
    winner_losses = []
    shares = []
    g5_top5 = 0
    def_top5 = 0
    unanimous = []
    consensus = []
    coach_pre_unranked = 0
    coach_wins = []
    bednarik_outside10 = 0
    award_pos = collections.defaultdict(collections.Counter)
    t0 = time.perf_counter()
    for i in range(n):
        st = season.new_season("ohio-state", "full", seed=seed0 + i)
        season.advance_to(st, 20)
        nat = st["awards"]["national"]
        h = nat["heisman"]
        w = h["winner"]
        pos[w["position"]] += 1
        winner_rank.append(w["rank"] or 99)
        winner_losses.append(int(w["record"].split("-")[1]))
        shares.append(h["share"])
        for c in h["candidates"][:5]:
            top5_pos[c["position"]] += 1
            if teams[c["team"]]["conference"] in G5_CONFERENCES:
                g5_top5 += 1
            if c["position"] in DEFENSIVE_POSITIONS:
                def_top5 += 1
        aa = nat["all_america"]
        unanimous.append(len(aa["unanimous"]))
        consensus.append(len(aa["consensus"]))
        for a in nat["awards"]:
            if a["winner"]:
                award_pos[a["name"]][a["winner"]["position"]] += 1
            if a["name"] == "Chuck Bednarik Award" and a["winner"] and (a["winner"].get("rank") or 99) > 10:
                bednarik_outside10 += 1
        ap = next(a for a in nat["coach_awards"] if a["name"] == "AP Coach of the Year")["winner"]
        if ap["preseason_rank"] is None:
            coach_pre_unranked += 1
        coach_wins.append(ap["wins"])
        print(f"season {i + 1}: Heisman {w['name']} {w['position']} {w['team_name']} {w['record']} #{w['rank']} share {h['share']}% | "
              f"AP COY {ap['coach']} {ap['team_name']} {ap['wins']}-{ap['losses']} (pre #{ap['preseason_rank']}) | {time.perf_counter() - t0:.0f}s")
    print("\nHeisman winner positions:", dict(pos))
    print("top-5 positions:", dict(top5_pos), "| G5 in top 5 per season:", round(g5_top5 / n, 2), "| defenders in top 5 per season:", round(def_top5 / n, 2))
    print("winner final rank:", winner_rank, "| losses:", winner_losses, "| share %:", shares)
    print("All-America consensus:", consensus, "unanimous:", unanimous)
    print("AP coach of the year: preseason unranked", coach_pre_unranked, "of", n, "| wins:", coach_wins)
    for name, c in award_pos.items():
        print(f"  {name:<38} {dict(c)}")
