"""Coach Career over many seasons, every step on Auto: does the league stay realistic?
(docs/superpowers/specs/2026-10-23-career-offseason-design.md, section 8)

Plays one career season after season (the games, recruiting on Auto, the offseason on Auto) and
records each season: the league's talent (starters' EA overall by position group, team ratings
and their spread), the balance of power (champions, how much the final top ten turns over),
rosters (sizes, class make-up), departures (draft, early entrants, portal, quitting), the
portal, development, coaching changes, recruiting, and the season's stats against real seasons
(tools/realism.py's scores). The 2026 season is the baseline.

Usage (from the project root):
    python tools/long_run.py --seasons 30 --seed 1 --out data/long_run/seed1.json
    python tools/long_run.py --report data/long_run/*.json      # the summary over finished runs
"""
from __future__ import annotations

import argparse
import collections
import glob
import json
import statistics as st
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools"))

# the 25 strongest programs by recruiting baseline (fixed: the tiers the long run follows). Not the
# 2026 top 25 by team rating: a team at its peak in 2026 (Indiana) regresses to its program over
# the years, which read as "the top getting weaker" when the tier followed the 2026 teams.
def _top25() -> set:
    from coach_career import recruiting
    model = recruiting.model()["teams"]
    return set(sorted(model, key=lambda s: -model[s]["strength"]["baseline"])[:25])


TOP25 = _top25()
GROUP = {"QB": "QB", "RB": "RB", "WR": "WR", "TE": "TE", "OL": "OL", "DL": "DL", "MLB": "LB", "ROLB": "LB", "LOLB": "LB",
         "CB": "CB", "S": "S", "K": "K", "P": "P"}


def season_metrics(state: dict) -> dict:
    import realism
    from sim import season
    teams = season.load_teams()
    fbs = {s: t for s, t in teams.items() if not t["fictional"]}
    ovr = [t["team_ratings"]["overall"] for t in fbs.values()]
    p4 = [t["team_ratings"]["overall"] for s, t in fbs.items() if season._is_p4(s, t)]
    g5 = [t["team_ratings"]["overall"] for s, t in fbs.items() if not season._is_p4(s, t)]
    starters, everyone = collections.defaultdict(list), []
    for t in fbs.values():
        for p in t["offense"] + t["defense"]:
            if p.get("ovr") is not None:
                everyone.append(p["ovr"])
                if p.get("in_game"):
                    starters[GROUP.get(p["position"], p["position"])].append(p["ovr"])
    # by tier: the 25 best programs by 2026 team rating, the rest of the Power 4, the Group of 5
    tiers = {}
    for s_, t in fbs.items():
        tier = "top25" if s_ in TOP25 else "p4" if season._is_p4(s_, t) else "g5"
        st_ = [p["ovr"] for p in t["offense"] + t["defense"] if p.get("in_game") and p.get("ovr") is not None]
        tiers.setdefault(tier, {"starters": [], "rating": [], "recruits": []})
        tiers[tier]["starters"].append(st.mean(st_))
        tiers[tier]["rating"].append(t["team_ratings"]["overall"])
    # who starts, by tier: young players, transfers, players from FCS or junior college (the league's own records)
    lg = state.get("league") or {}
    info = {c["id"]: c for t in (lg.get("teams") or {}).values() for c in t["roster"]}
    for s_, t in fbs.items():
        tier = "top25" if s_ in TOP25 else "p4" if season._is_p4(s_, t) else "g5"
        for p in t["offense"] + t["defense"]:
            if p.get("in_game"):
                c = info.get(p["slug"], {})
                tiers[tier].setdefault("young", []).append(1 if (p.get("class") or "")[:2] in ("FR", "SO") else 0)
                tiers[tier].setdefault("transfer", []).append(1 if c.get("transfer") and c.get("transfer") != "FCS" else 0)
                tiers[tier].setdefault("lower", []).append(1 if c.get("transfer") == "FCS" else 0)
                tiers[tier].setdefault("walkon", []).append(1 if c.get("walk_on") else 0)
    rc = state.get("recruiting") or {}
    for pid, s_ in (rc.get("status") or {}).items():
        school = s_.get("signed")
        if school in fbs:
            tier = "top25" if school in TOP25 else "p4" if season._is_p4(school, fbs[school]) else "g5"
            tiers[tier]["recruits"].append(rc["prospects"][pid]["composite"])
    tier_out = {k: {"starters": round(st.mean(v["starters"]), 2), "rating": round(st.mean(v["rating"]), 2),
                    "recruit_composite": round(st.mean(v["recruits"]), 4) if v["recruits"] else None,
                    "signed_per_team": round(len(v["recruits"]) / len(v["rating"]), 1),
                    **{k2: round(st.mean(v[k2]), 3) for k2 in ("young", "transfer", "lower", "walkon") if v.get(k2)}} for k, v in tiers.items()}
    final = state["polls"][str(max(int(w) for w, v in state["polls"].items() if v.get("ap")))]   # the final poll
    rec = season._records(state, include_playoff=True)[state["team"]]
    data: dict = {}
    realism.report([state["season_stats"]], [], teams, data)
    return {
        "year": season.season_year(state), "record": [rec["wins"], rec["losses"]], "champion": state.get("champion"),
        "top10": [e["team"] for e in final.get("ap", [])[:10]],
        "team_rating": {"mean": round(st.mean(ovr), 2), "sd": round(st.pstdev(ovr), 2), "max": max(ovr), "min": min(ovr),
                        "p4": round(st.mean(p4), 2), "g5": round(st.mean(g5), 2)},
        "starters_ovr": {g: round(st.mean(v), 2) for g, v in sorted(starters.items())},
        "players_ovr": round(st.mean(everyone), 2),
        "stats_off": {k: round(v, 4) for k, v in data["area_off"].items()}, "tiers": tier_out,
        "ppg": round(data["teams"]["ppg"]["sim_mean"], 2), "ypg": round(data["teams"]["ypg"]["sim_mean"], 1),
        "team_spots": {k: {"sim": [round(x, 1) for x in v["sim"]], "real": [round(x, 1) for x in v["real"]]} for k, v in data["teams"].items()},
        "leaders": {k: {"sim": [round(x) for x in v["sim"]], "real": [round(x) for x in v["real"]]} for k, v in data["leaders"].items()},
    }


def offseason_metrics(state: dict) -> dict:
    off = state["offseason"]
    lg = state["league"]
    kinds = collections.Counter(d["kind"] for d in off["departures"])
    portal = off["portal"]["players"]
    sizes = [len(t["roster"]) for t in lg["teams"].values()]
    classes = collections.Counter(p["cls"] for t in lg["teams"].values() for p in t["roster"])
    total = sum(classes.values())
    from sim import season
    teams = season.load_teams()
    draft = [d for d in off["departures"] if d["kind"] == "draft"]
    p4_picks = sum(1 for d in draft if season._is_p4(d["team"], teams[d["team"]]))
    signed = off.get("signed", {})
    return {
        "departures": dict(kinds), "early_entrants": sum(1 for d in off["departures"] if d.get("early")),
        "draft_p4_share": round(p4_picks / max(1, len(draft)), 3),
        "portal_entrants": len(portal), "portal_signed": sum(1 for e in portal.values() if e["signed"]),
        "walk_ons": off["report"]["walk_ons"], "released": off["report"]["released"],
        "dev_gain_ea": off["report"]["development"]["mean_gain_ea"],
        "class_sizes": {"mean": round(st.mean(signed.values()), 1) if signed else 0, "min": min(signed.values(), default=0),
                        "max": max(signed.values(), default=0)},
        "roster": {"min": min(sizes), "max": max(sizes)},
        "classes": {k: round(v / total, 3) for k, v in sorted(classes.items())},
        "coaching_changes": collections.Counter(c["role"] for c in off.get("coaching_changes", []) if c.get("reason") != "hired"),
        "hc_departures": collections.Counter(c["reason"] if not c["reason"].startswith("left for ") or "NFL" in c["reason"] else "left for another job"
                                             for c in off.get("coaching_changes", []) if c["role"] == "head_coach" and c.get("reason") != "hired"),
        "you": {k: v for k, v in ((off.get("carousel") or {}).get("you") or {}).items() if k in ("security", "met", "fired")},
        "moved_to": off.get("move_to"),
        "staff_changes": len((off.get("staff") or {}).get("changes", [])),
    }


def run(seasons: int, seed: int, team: str, out: Path) -> None:
    from coach_career import offseason
    from sim import season
    rows = []
    st_ = season.new_season(team, "full", seed=seed, career=True)
    st_["career"]["settings"]["auto_recruit"] = "season"
    for i in range(seasons):
        t0 = time.perf_counter()
        season.advance_to(st_, season.FINAL_WEEK)
        t1 = time.perf_counter()
        row = season_metrics(st_)
        offseason.run_all(st_)
        row["offseason"] = offseason_metrics(st_)
        row["seconds"] = {"season": round(t1 - t0), "offseason": round(time.perf_counter() - t1)}
        st_ = offseason.next_season(st_)
        row["seconds"]["rollover"] = round(time.perf_counter() - t1) - row["seconds"]["offseason"]
        rows.append(row)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps({"seed": seed, "team": team, "seasons": rows}, indent=1), encoding="utf-8")
        out.with_suffix(".league.json").write_text(json.dumps(st_["league"]), encoding="utf-8")   # the latest league, to study
        o = row["offseason"]
        tr = row["tiers"]
        print(f"      carousel {dict(o.get('hc_departures', {}))}  you {o.get('you')}  moved {o.get('moved_to')}", flush=True)
        print("      tiers " + "  ".join(f"{k} st {v['starters']:.1f} rtg {v['rating']:.1f} rec {v['recruit_composite'] or 0:.3f} x{v['signed_per_team']}"
                                       f" young {v.get('young', 0):.2f} tr {v.get('transfer', 0):.2f} low {v.get('lower', 0):.2f} wo {v.get('walkon', 0):.2f}"
                                       for k, v in sorted(tr.items())), flush=True)
        print(f"{row['year']} champ {row['champion']:<14} {team} {row['record'][0]}-{row['record'][1]}  "
              f"team rtg {row['team_rating']['mean']:.1f}±{row['team_rating']['sd']:.1f}  QB {row['starters_ovr'].get('QB', 0):.1f} "
              f"OL {row['starters_ovr'].get('OL', 0):.1f}  ppg {row['ppg']:.1f}  stats off "
              f"{100 * st.mean(row['stats_off'].values()):.1f}%  draft early {o['early_entrants']}  portal {o['portal_entrants']}/"
              f"{o['portal_signed']}  walk-ons {o['walk_ons']}  ({row['seconds']['season']}s + {row['seconds']['offseason']}s)", flush=True)
    from coach_career import league
    league.forget(st_["id"])
    season.close_pool()


def report(paths: list[str]) -> str:
    runs = [json.loads(Path(p).read_text(encoding="utf-8")) for p in paths]
    lines = [f"{len(runs)} run(s), {sum(len(r['seasons']) for r in runs)} seasons"]
    base = [r["seasons"][0] for r in runs]
    later = [s for r in runs for s in r["seasons"][1:]]
    if not later:
        return "\n".join(lines + ["no seasons past 2026 yet"])

    def m(rows, f):
        vals = [f(s) for s in rows]
        return st.mean(vals) if vals else float("nan")

    lines.append("                         2026     later (mean; first five / last five later seasons)")
    def row(label, f, fmt="{:.2f}"):
        first = [s for r in runs for s in r["seasons"][1:6]]
        last = [s for r in runs for s in r["seasons"][-5:]] if all(len(r["seasons"]) > 6 for r in runs) else []
        lines.append(f"  {label:<22} {fmt.format(m(base, f)):>8} {fmt.format(m(later, f)):>8}   "
                     f"{fmt.format(m(first, f))} / {fmt.format(m(last, f)) if last else '-'}")
    row("team rating mean", lambda s: s["team_rating"]["mean"])
    row("team rating sd", lambda s: s["team_rating"]["sd"])
    row("P4 - G5", lambda s: s["team_rating"]["p4"] - s["team_rating"]["g5"])
    row("players overall", lambda s: s["players_ovr"])
    for g in ("QB", "RB", "WR", "TE", "OL", "DL", "LB", "CB", "S", "K", "P"):
        row(f"starters overall {g}", lambda s, g=g: s["starters_ovr"].get(g, float("nan")))
    row("points a game", lambda s: s["ppg"])
    row("yards a game", lambda s: s["ypg"], "{:.1f}")
    row("stats off (mean %)", lambda s: 100 * st.mean(s["stats_off"].values()), "{:.1f}")
    for k in ("pass_yards", "rush_yards", "rec_yards", "tackles", "sacks", "interceptions", "team_ppg", "team_ypp"):
        row(f"  {k} off %", lambda s, k=k: 100 * s["stats_off"].get(k, float("nan")), "{:.1f}")
    off = [s["offseason"] for s in base + later]
    lines.append("  offseason (every season):")
    for label, f in (("graduated", lambda o: o["departures"].get("graduated", 0)), ("drafted", lambda o: o["departures"].get("draft", 0)),
                     ("early entrants", lambda o: o["early_entrants"]), ("draft P4 share", lambda o: o["draft_p4_share"]),
                     ("portal entrants", lambda o: o["portal_entrants"]), ("portal signed", lambda o: o["portal_signed"]),
                     ("quit", lambda o: o["departures"].get("quit", 0)), ("walk-ons", lambda o: o["walk_ons"]),
                     ("class size mean", lambda o: o["class_sizes"]["mean"]), ("dev gain EA", lambda o: o["dev_gain_ea"]),
                     ("HC changes", lambda o: o["coaching_changes"].get("head_coach", 0)),
                     ("HC fired", lambda o: o.get("hc_departures", {}).get("fired", 0)),
                     ("HC retired", lambda o: o.get("hc_departures", {}).get("retired", 0)),
                     ("HC to NFL", lambda o: o.get("hc_departures", {}).get("left for the NFL", 0)),
                     ("HC to other jobs", lambda o: o.get("hc_departures", {}).get("left for another job", 0))):
        vals = [f(o) for o in off]
        lines.append(f"    {label:<20} mean {st.mean(vals):8.2f}  min {min(vals):8.2f}  max {max(vals):8.2f}")
    # balance of power: champions and top-ten turnover
    champs = collections.Counter(s["champion"] for s in base + later)
    turnover = []
    for r in runs:
        for a, b in zip(r["seasons"], r["seasons"][1:]):
            turnover.append(len(set(b["top10"]) - set(a["top10"])))
    lines.append(f"  champions: {len(champs)} different in {sum(champs.values())} seasons; most: "
                 + ", ".join(f"{k} {v}" for k, v in champs.most_common(5)))
    lines.append(f"  new teams in the final top ten a year: mean {st.mean(turnover):.1f} (real 2015-2025: about 4)")
    cls = collections.defaultdict(list)
    for s in later:
        for k, v in s["offseason"]["classes"].items():
            cls[k].append(v)
    lines.append("  roster class make-up (later): " + ", ".join(f"{k} {st.mean(v):.3f}" for k, v in sorted(cls.items()))
                 + "   (2026 real: FR .151 FRRS .122 SO .086 SORS .149 JR .086 JRRS .153 SR .069 SRRS .185)")
    return "\n".join(lines)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--seasons", type=int, default=10)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--team", default="ohio-state")
    ap.add_argument("--out", default=None)
    ap.add_argument("--report", nargs="*")
    a = ap.parse_args()
    if a.report is not None:
        print(report(sorted(set(p for pat in a.report for p in glob.glob(pat)))))
    else:
        run(a.seasons, a.seed, a.team, Path(a.out or ROOT / "data" / "long_run" / f"seed{a.seed}.json"))
