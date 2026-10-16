"""Sim a season and print the awards: `python test_awards.py [team] [seed]`.
(Run as a file: multiprocessing on Windows cannot spawn workers from a piped script.)"""
import json
import sys
import time

import season

if __name__ == "__main__":
    slug = sys.argv[1] if len(sys.argv) > 1 else "ohio-state"
    seed = int(sys.argv[2]) if len(sys.argv) > 2 else 11
    t0 = time.perf_counter()
    st = season.new_season(slug, "full", seed=seed)
    season.advance_to(st, 10)
    race = season.awards_view(st)["race"]
    print(f"--- week 10 race ({time.perf_counter() - t0:.0f}s)")
    for c in race["heisman"]["candidates"][:6]:
        print(f"  {c['name']:<22} {c['position']:<3} {c['team_name']:<16} {c['record']:<5} #{c['rank']} pts {c['points']} | {c['line']}")
    season.advance_to(st, 20)
    aw = st["awards"]
    h = aw["national"]["heisman"]
    print(f"--- Heisman ({time.perf_counter() - t0:.0f}s): share {h['share']}% of {h['possible']}")
    for c in h["candidates"][:8]:
        print(f"  {c['name']:<22} {c['position']:<3} {c['team_name']:<16} {c['record']:<5} #{c['rank']} {c['first']}/{c['second']}/{c['third']} = {c['points']} | {c['line']}")
    print("--- national awards")
    for a in aw["national"]["awards"]:
        w = a["winner"]
        print(f"  {a['name']:<38} {w['name']:<22} {w['position']:<3} {w['team_name']:<16} | {w['line']}" if w else f"  {a['name']}: none")
    print("--- coach awards")
    for a in aw["national"]["coach_awards"] + aw["postseason"]["awards"][1:2]:
        w = a["winner"]
        print(f"  {a['name']:<34} {w.get('coach') or w.get('name'):<22} {w['team_name']:<16} " + (f"{w['wins']}-{w['losses']} exp {w['expected']} surprise {w['surprise']}" if "surprise" in w else f"{w.get('role', '')} unit rank {w.get('unit_rank')} (rating rank {w.get('rating_rank')})"))
    aa = aw["national"]["all_america"]
    print(f"--- All-America: {len(aa['consensus'])} consensus, {len(aa['unanimous'])} unanimous")
    for c in aa["consensus"]:
        print(f"  {c['slot']:<4} {c['name']:<22} {c['team_name']:<16} {c['selectors']}/5{' *' if c['unanimous'] else ''}")
    conf = st["conference"]
    print(f"--- {conf} awards")
    for a in aw["conference"][conf]["awards"]:
        w = a["winner"]
        print(f"  {a['name']:<44} {(w.get('name') or w.get('coach')) if w else 'none':<22} {w['team_name'] if w else ''}")
    teams = aw["conference"][conf]["teams"]["selectors"]
    first = next(iter(teams.values()))
    print(f"--- All-{conf} first team ({next(iter(teams))}):", ", ".join(f"{c['slot']} {c['name']} ({c['team_name']})" for c in first if c["level"] == 1))
    print("--- postseason:", [(a["name"], (a["winner"] or {}).get("name") or (a["winner"] or {}).get("coach") or (a["winner"] or {}).get("team_name")) for a in aw["postseason"]["awards"]])
    mine = season.awards_view(st)["mine"]
    print(f"--- my team ({st['team_name']}): {len(mine)} entries")
    for m in mine[:12]:
        print(f"  {m['stage']:<22} {m['award']:<44} {m['who']:<22} {m['place']}")
    print("state size", round(len(json.dumps(st)) / 1e6, 2), "MB")
    if len(sys.argv) > 3:
        json.dump(st, open(sys.argv[3], "w"))
