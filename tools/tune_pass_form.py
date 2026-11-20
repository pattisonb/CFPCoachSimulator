"""Each team's passing form: how much better or worse it really throws than its ratings say.

Real teams' passing efficiency spreads about twice as wide as the sim's, and ratings do not say who is where (the real
yards an attempt against the sim's: r 0.18). So each team gets two numbers from its real 2026 season (cfbstats.com,
data/history/team_players_2026.json): points of completion chance, and a multiplier on the yards of a completion. They
sit in data/real_adjustments.json under usage.<team>.pass_form and reach the engine as the tendencies
pass_form_completion and pass_form_yards (play_functions.get_pass_yards). Like the target shares there, they are the
real 2026 season's: a career's later seasons are built without them.

    python tools/tune_pass_form.py            # fit: simulate without form, set it, simulate again and correct once
    python tools/tune_pass_form.py --clear    # take the form out and rebuild

The fit: simulate SEASONS seasons, compare each team's completion rate and yards a completion (as its distance from the
league's) with its real ones shrunk toward the league's for the sample, and move the form by the difference; then once
more from a simulation with the form in, because a team that completes more also plays from ahead.
"""
from __future__ import annotations

import json
import statistics as st
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools"))

import tune_from_stats as stats_tool  # noqa: E402

OUT = stats_tool.OUT
SEASONS = 4                     # *tune* simulated seasons a pass of the fit reads
PASSES = 2                      # *tune* fit, then correct this many times less one
COMPLETION_SHRINK = 150         # *tune* real attempts at which a team's completion rate counts half
YARDS_SHRINK = 125              # *tune* real completions at which its yards a completion count half
COMPLETION_MAX = 0.08           # *tune* the form moves a completion chance at most this far
YARDS_RANGE = (0.82, 1.20)      # *tune* ... and a completion's yards within this


def real_passing(teams: dict) -> dict:
    """team slug -> (attempts, completions, yards) this real season."""
    data = json.loads(stats_tool.STATS.read_text(encoding="utf-8"))
    slugs = {**{t["name"]: s for s, t in teams.items() if not t["fictional"]}, **stats_tool.TEAM_ALIAS}
    out = {}
    for name, e in data["teams"].items():
        rows = e["passing"]["rows"]         # Name, Yr, Pos, G, Att, Comp, Pct., Yards, ...
        out[slugs[name]] = tuple(sum(stats_tool.num(r[i]) for r in rows) for i in (4, 5, 7))
    return out


def sim_passing(seeds: list[int]) -> dict:
    """team slug -> (attempts, completions, yards) over simulated seasons."""
    import realism
    from sim import season
    season._teams_cache = {}            # the teams file was just rebuilt
    ends, _ = realism.simulate(seeds, None)
    out: dict = {}
    for e in ends:
        for slug, t in e.items():
            a = out.setdefault(slug, [0, 0, 0])
            for i, k in enumerate(("Pass Attempts", "Completions", "Pass Yards")):
                a[i] += t["team"].get(k, 0)
    return out


def rates(p: dict) -> tuple[dict, dict]:
    """(completion rate, yards a completion) by team, each as its distance from the mean of the teams."""
    comp = {s: c / a for s, (a, c, y) in p.items() if a and c}
    ypc = {s: y / c for s, (a, c, y) in p.items() if a and c}
    mc, my = st.mean(comp.values()), st.mean(ypc.values())
    return {s: v - mc for s, v in comp.items()}, {s: v / my for s, v in ypc.items()}


def write(form: dict) -> None:
    adj = json.loads(OUT.read_text(encoding="utf-8"))
    for slug, u in adj.setdefault("usage", {}).items():
        u.pop("pass_form", None)
    for slug, f in form.items():
        adj["usage"].setdefault(slug, {})["pass_form"] = f
    OUT.write_text(json.dumps(adj, indent=1), encoding="utf-8")
    subprocess.run([sys.executable, "-m", "teamdata.build_teams"], cwd=ROOT, check=True, capture_output=True)


def main() -> None:
    if "--clear" in sys.argv:
        write({})
        print("pass form cleared; teams rebuilt")
        return
    teams = json.loads(stats_tool.TEAMS.read_text(encoding="utf-8"))["teams"]
    real = real_passing(teams)
    rc, ry = rates(real)
    form = {s: {"completion": 0.0, "yards": 1.0} for s in real}
    write({})
    for n in range(PASSES):
        sim = {s: v for s, v in sim_passing([901 + 101 * k for k in range(SEASONS)]).items() if s in real}
        sc, sy = rates(sim)
        for s in real:
            att, comp, _ = real[s]
            want_c = rc[s] * att / (att + COMPLETION_SHRINK)
            want_y = 1 + (ry[s] - 1) * comp / (comp + YARDS_SHRINK)
            f = form[s]
            f["completion"] = round(max(-COMPLETION_MAX, min(COMPLETION_MAX, f["completion"] + want_c - sc[s])), 4)
            f["yards"] = round(max(YARDS_RANGE[0], min(YARDS_RANGE[1], f["yards"] * want_y / sy[s])), 4)
        gap_c = st.mean(abs(rc[s] * real[s][0] / (real[s][0] + COMPLETION_SHRINK) - sc[s]) for s in real)
        print(f"pass {n + 1}: the sim's completion rate was {100 * gap_c:.1f} points from the target on an average team; "
              f"form now {min(f['completion'] for f in form.values()):+.3f} to {max(f['completion'] for f in form.values()):+.3f} completion, "
              f"x{min(f['yards'] for f in form.values()):.2f} to x{max(f['yards'] for f in form.values()):.2f} yards", flush=True)
        write(form)
    print(f"written to {OUT} for {len(form)} teams; build_teams.py applied it")


if __name__ == "__main__":
    main()
