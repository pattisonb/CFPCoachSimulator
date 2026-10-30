"""Play Coach Career seasons and hold their recruiting to the real classes it was learned from
(recruiting_model.json): class sizes by tier, how far from home prospects sign, where the blue
chips go, which programs land the best classes, and when prospects commit, sign and decommit.

Usage:  python tools/check_recruiting.py            # 1 season
        python tools/check_recruiting.py 3          # more seasons, steadier numbers
"""
from __future__ import annotations
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `from sim import season` works from here

import shutil
import statistics as st
import sys

from coach_career import recruiting
from sim import season

# (metric, low, high, real) — the tolerances tests/test_recruiting_realism.py holds
TOLERANCES = (
    ("p4_class", 19.5, 24.5, 21.7),
    ("g5_class", 16.5, 21.5, 18.9),
    ("in_state", 0.30, 0.42, 0.36),
    ("median_miles", 220, 340, 280),
    ("blue_chip_schools", 12, 24, 18),
    ("max_five_stars", 0, 8, 6),         # the most five-stars one school signs (real 2026: 6; Georgia and Alabama have signed 7 and 8)
    ("strength_rank_r", 0.75, 1.0, 1.0),
    ("committed_by_12", 0.50, 1.0, None),
    ("signed_early", 0.80, 0.90, None),
    ("top300_decommits", 0.07, 0.22, None),   # real: about 8-15% of the top 300 decommit; a seed can land just under
    ("pos_mae", 0.0, 0.5, None),          # the league's signed positions a class against the real mix, mean absolute error a group
    ("over_need", 0, 2, None),            # the most one school signs at a group past its room there (target minus returning)
    ("no_qb_share", 0.0, 0.10, None),     # schools signing no quarterback
    ("max_qb", 0, 3, None),               # the most quarterbacks one school signs
    ("top100_top25", 0.65, 0.95, 0.80),   # the top 100 prospects signing with the 25 strongest programs (real: about 80%)
)
GROUP_247 = {"OT": "OL", "IOL": "OL", "EDGE": "DL"}   # the real classes' positions to roster groups (ATH and LS are left out)
GROUPS = ("QB", "RB", "WR", "TE", "OL", "DL", "LB", "CB", "S")


def play(seed: int, team: str = "georgia") -> dict:
    state = season.new_season(team, "full", seed=seed, career=True)
    season.advance_to(state, season.FINAL_WEEK)
    shutil.rmtree(season.box_dir(state).parent, ignore_errors=True)   # the sim's box scores: not needed here
    return state


def _spearman(a: list[float], b: list[float]) -> float:
    def ranks(v):
        order = sorted(range(len(v)), key=lambda i: v[i])
        r = [0.0] * len(v)
        for k, i in enumerate(order):
            r[i] = k
        return r
    ra, rb = ranks(a), ranks(b)
    ma, mb = st.mean(ra), st.mean(rb)
    num = sum((x - ma) * (y - mb) for x, y in zip(ra, rb))
    return num / (sum((x - ma) ** 2 for x in ra) * sum((y - mb) ** 2 for y in rb)) ** 0.5


def measure(state: dict) -> dict:
    rc = state["recruiting"]
    teams, model = season.load_teams(), recruiting.model()["teams"]
    schools = recruiting.fbs_schools(state)
    classes = {s: recruiting.signed_class(state, s) for s in schools}
    fbs = [(pid, s) for s, pids in classes.items() for pid in pids]
    pros = rc["prospects"]
    tier = lambda t: [len(classes[s]) for s in schools if model[s].get("tier") == t]
    miles = [recruiting._miles(tuple(pros[pid]["home"]), tuple(model[s]["location"])) for pid, s in fbs if model[s].get("location")]
    blue = lambda s: sum(1 for pid in classes[s] if pros[pid]["stars"] >= 4) / max(1, len(classes[s]))
    strength = {s: st.mean(pros[pid]["composite"] for pid in classes[s]) if classes[s] else 0.0 for s in schools}
    first_commit, early, decommitted = {}, set(), set()
    for e in rc["log"]:
        if e["kind"] in ("commit", "flip") and e["pid"] not in first_commit:
            first_commit[e["pid"]] = e["week"]
        if e["kind"] == "signed" and e["school"] != "FCS" and e["week"] == season.SELECTION_WEEK:
            early.add(e["pid"])
        if e["kind"] == "decommit":
            decommitted.add(e["pid"])
    top300 = [pid for pid, p in pros.items() if p["rank"] <= 300]
    real_sum, got_sum = {g: 0.0 for g in GROUPS}, {g: 0 for g in GROUPS}
    qbs, over = [], 0
    for s_ in schools:
        room = recruiting.needs(state, s_)
        for g, n in recruiting.commits_by_group(state, s_).items():
            room[g] += n
        for pos, n in (model[s_].get("positions_per_class") or {}).items():
            g = GROUP_247.get(pos, pos)
            if g in real_sum:
                real_sum[g] += n
        got = {g: 0 for g in GROUPS}
        for pid in classes[s_]:
            g = recruiting._group_of(pros[pid])
            if g in got:
                got[g] += 1
        for g in GROUPS:
            got_sum[g] += got[g]
        qbs.append(got["QB"])
        over = max(over, max(got[g] - max(0, room[g]) for g in GROUPS))
    top25 = set(sorted(model, key=lambda s_: -model[s_]["strength"]["baseline"])[:25])
    top100 = [(pid, s_) for pid, s_ in fbs if pros[pid]["rank"] <= 100]
    actions = {a: round(v[1] / v[0], 2) for a, v in (rc.get("action_points") or {}).items() if v[0]}
    leader_changes = list((rc.get("leader_changes") or {}).values())
    return {
        "actions": actions, "leader_changes_per_week": round(st.mean(leader_changes), 1) if leader_changes else 0.0,
        "pos_mae": st.mean(abs(got_sum[g] - real_sum[g]) / len(schools) for g in GROUPS),
        "no_qb_share": sum(1 for q in qbs if q == 0) / len(qbs), "max_qb": max(qbs), "over_need": over,
        "p4_class": st.mean(tier("Power 4")),
        "g5_class": st.mean(tier("Group of 5")),
        "in_state": sum(1 for pid, s in fbs if pros[pid]["hometown"]["state"] == teams[s]["state"]) / len(fbs),
        "median_miles": st.median(miles),
        "blue_chip_schools": sum(1 for s in schools if classes[s] and blue(s) >= 0.5),
        "max_five_stars": max(sum(1 for pid in classes[s] if pros[pid]["stars"] == 5) for s in schools),
        "strength_rank_r": _spearman([strength[s] for s in schools], [model[s]["strength"]["baseline"] for s in schools]),
        "committed_by_12": sum(1 for pid, _ in fbs if first_commit.get(pid, 99) < 12) / len(fbs),
        "signed_early": len(early) / len(fbs),
        "top300_decommits": sum(1 for pid in top300 if pid in decommitted) / len(top300),
        "top100_top25": sum(1 for pid, s_ in top100 if s_ in top25) / max(1, len(top100)),
        "fcs_share": sum(1 for s in rc["status"].values() if s["signed"] == "FCS") / len(rc["status"]),
        "generational": len(rc.get("generational") or []),
        "generational_top25": sum(1 for pid in (rc.get("generational") or []) if rc["status"][pid]["signed"] in top25),
    }


def report(m: dict) -> list[str]:
    """Lines comparing a season with the real numbers; a failing metric is marked."""
    out = []
    for key, lo, hi, real in TOLERANCES:
        ok = lo <= m[key] <= hi
        out.append(f"{'  ' if ok else '! '}{key:18s} {m[key]:8.3f}   want {lo}-{hi}" + (f" (real {real})" if real is not None else ""))
    out.append(f"  {'fcs_share':18s} {m['fcs_share']:8.3f}")
    out.append(f"  generational {m['generational']} (signed with top-25 classes: {m['generational_top25']} of {m['generational']})")
    # the weight of each action: mean interest points one earns (pitches, strengths, cooling and diminishing returns in)
    out.append("  interest a go by action: " + ", ".join(f"{a} {v}" for a, v in sorted((m.get("actions") or {}).items(), key=lambda kv: -kv[1]))
               + f"; a week's leader changes {m.get('leader_changes_per_week', 0)} prospects")
    return out


def reveal_rate(seed: int, team: str = "georgia") -> float:
    """How often your call scene's cue leads you to one of his priorities: a fresh career, the first
    100 prospects you can see, each a call, pitching the first topic the cue names (the band: 0.55-0.75,
    set by scenes.CUE_TWO_SIDED)."""
    state = season.new_season(team, "full", seed=seed, career=True)
    rc = state["recruiting"]
    pids = [q for q in recruiting.prospect_list(state) if not rc["prospects"][q].get("hidden")][:100]
    found = 0
    for pid in pids:
        rc["hours"][team] = 100
        sc = recruiting.act(state, team, pid, "call")["scene"]
        if sc["question"]:                        # he asked about a named player: the pitch waits on an answer
            recruiting.act(state, team, pid, "answer", scene=sc["id"], answer="deflect")
        r = recruiting.act(state, team, pid, "pitch", pitch=sc["cue"]["topics"][0], scene=sc["id"])
        found += r["reaction"]["kind"] in ("hit", "quiet")
    return found / len(pids)


def question_mix(seed: int, team: str = "georgia") -> dict:
    """How often a call brings a question about a named player (scenes.QUESTION_RATE of the calls to
    recruits who care about playing time), the roster/recruit split, and how often a promise would be
    hollow: a fresh career, the first 300 prospects you can see, each a call, every question promised."""
    from coach_career import scenes
    state = season.new_season(team, "full", seed=seed, career=True)
    rc = state["recruiting"]
    pids = [q for q in recruiting.prospect_list(state) if not rc["prospects"][q].get("hidden")][:300]
    out = {"calls": len(pids), "playing_time": 0, "questions": 0, "roster": 0, "recruit": 0, "promises": 0, "hollow": 0}
    for pid in pids:
        rc["hours"][team] = 100
        out["playing_time"] += "playing_time" in rc["prospects"][pid]["priorities"]
        sc = recruiting.act(state, team, pid, "call")["scene"]
        q = sc["question"]
        if not q:
            continue
        out["questions"] += 1
        out[q["kind"]] += 1
        r = recruiting.act(state, team, pid, "answer", scene=sc["id"], answer="promise")
        out["promises"] += 1
        out["hollow"] += r["truthful"] is False
    out["rate"] = scenes.QUESTION_RATE
    return out


def main() -> None:
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    print(f"  player reveal rate {reveal_rate(1):.3f}   want 0.55-0.75")
    qm = question_mix(1)
    print(f"  recruit questions: {qm['questions']} on {qm['calls']} calls ({qm['playing_time']} care about playing time; "
          f"want about {qm['rate']:.2f} of those), roster {qm['roster']} / recruit {qm['recruit']}; "
          f"promises hollow {qm['hollow']} of {qm['promises']}")
    for seed in range(1, n + 1):
        print(f"season seed {seed}")
        print("\n".join(report(measure(play(seed)))))


if __name__ == "__main__":
    main()
