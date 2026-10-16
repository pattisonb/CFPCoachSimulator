"""AP poll, CFP committee rankings and the 12-team bracket.

The AP model keeps a "poll score" per team. Each week every team's score moves by its
result: a win adds points scaled by the opponent's standing, the venue and the margin; a
loss subtracts points, more for losing to an unranked team or at home and less for losing
to a top team. The 25 highest scores are the poll. The parameters in AP_PARAMS were fit
to every weekly AP poll from 2014 to 2025 (calibrate_polls.py replays those seasons with
the real results and minimises the rank error against the real polls).

The committee model re-ranks the AP-style scores with the things the committee is known
to weigh differently: strength of schedule, wins over ranked teams, a discount for Group
of Five schedules, head-to-head among close teams, and conference titles at the end.
CFP_PARAMS were fit the same way against the committee's weekly rankings (2014-2025).

The bracket follows the 2026 rules (NCAA.com, Aug 27 2026; CFP management committee,
May 22 2025): 12 teams; the ACC, Big Ten, Big 12 and SEC champions and the highest-ranked
team from the American, CUSA, MAC, Mountain West, Pac-12 or Sun Belt get in automatically
(Notre Dame too if ranked in the top 12); seven at-large by ranking; seeds 1-4 are the
four highest-ranked teams regardless of titles and get byes; an automatic qualifier ranked
outside the top 12 takes the lowest seed(s); first round 5v12, 6v11, 7v10, 8v9 at the
higher seed's home; quarterfinals 1v8/9, 2v7/10, 3v6/11, 4v5/12; no reseeding.
"""
from __future__ import annotations

import json
import random
import math
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parent
PARAMS_FILE = ROOT / "data" / "poll_params.json"

P4 = {"ACC", "Big Ten", "Big 12", "SEC"}
G6 = {"American Athletic Conference", "Conference USA", "MAC", "Mountain West", "Pac-12", "Sun Belt"}
INDEPENDENT = {"FBS Independents", "Independent", "Independents"}

# Defaults; calibrate_polls.py overwrites them in data/poll_params.json.
AP_PARAMS = {
    "rank_points": 40.0,        # preseason: score gap per poll spot
    "unranked_floor": -60.0,    # preseason score of the best unranked team relative to No. 25
    "rating_weight": 6.0,       # preseason: points per rating point above the league (sim only)
    "win_base": 14.0,
    "win_ranked_bonus": 1.2,    # x (26 - opponent rank) / 25
    "win_road_bonus": 0.15,
    "win_margin": 0.25,         # per point of margin, capped
    "win_margin_cap": 21,
    "loss_base": 55.0,
    "loss_unranked_extra": 0.7,  # fraction extra for losing to an unranked team
    "loss_top_discount": 0.6,    # fraction removed when losing to a top-5 team
    "loss_home_extra": 0.25,
    "loss_margin": 0.6,          # per point of margin, capped
    "loss_margin_cap": 21,
    "decay": 0.0,                # weekly pull of scores toward the record line
    "record_weight": 30.0,       # points per win minus loss in the running record (season-long)
    "late_record_weight": 1.5,   # multiplier for record_weight in the last 4 weeks
    "g5_discount": 10.0,         # points taken from Group of Five teams
}
CFP_PARAMS = {
    "sos_weight": 90.0,          # points per unit of opponents' win % above .500
    "quality_win_weight": 12.0,  # per win over an AP top-25 team (scaled by opponent rank)
    "bad_loss_weight": 20.0,     # per loss to a team with a losing record
    "g5_discount": 25.0,
    "loss_weight": 18.0,         # per loss beyond the AP score's own loss handling
    "head_to_head": 1.0,         # swap close teams (within this many score units x 10) by head-to-head
    "champ_bonus": 12.0,         # conference champion bonus in the final ranking
}


def load_params() -> tuple[dict, dict]:
    if PARAMS_FILE.exists():
        d = json.loads(PARAMS_FILE.read_text(encoding="utf-8"))
        return {**AP_PARAMS, **d.get("ap", {})}, {**CFP_PARAMS, **d.get("cfp", {})}
    return dict(AP_PARAMS), dict(CFP_PARAMS)


# ----- AP model ------------------------------------------------------------

def preseason_scores(preseason_poll: list[str], ratings: dict[str, float], params: dict) -> dict[str, float]:
    """Initial poll scores. `preseason_poll` is the ordered list of team keys (top 25);
    `ratings` is a team -> overall rating (any scale; only differences matter) for everyone."""
    scores = {}
    n = len(preseason_poll)
    for i, t in enumerate(preseason_poll):
        scores[t] = (n - i) * params["rank_points"]
    if ratings:
        rated = sorted(ratings.items(), key=lambda kv: -kv[1])
        ranked_avg = (sum(ratings.get(t, 0) for t in preseason_poll) / max(1, n)) if n else 0
        for t, r in rated:
            if t in scores:
                scores[t] += (r - ranked_avg) * params["rating_weight"] * 0.25   # ratings nudge inside the poll too
            else:
                scores[t] = params["unranked_floor"] + (r - ranked_avg) * params["rating_weight"]
    return scores


def update_scores(scores: dict[str, float], games: list[dict], prev_rank: dict[str, int], records: dict[str, tuple[int, int]],
                  tiers: dict[str, str], week: int, last_week: int, params: dict) -> dict[str, float]:
    """One week of results. games: {"home","away","home_score","away_score","neutral"}; prev_rank: team -> AP rank
    before the games; records: team -> (wins, losses) after the games; tiers: team -> "P4"/"G5"/"FCS"."""
    new = dict(scores)
    for g in games:
        for side, opp in (("home", "away"), ("away", "home")):
            t, o = g[side], g[opp]
            if t not in new:
                new[t] = params["unranked_floor"] - 40
            ts, os_ = g[f"{side}_score"], g[f"{opp}_score"]
            margin = abs(ts - os_)
            opp_rank = prev_rank.get(o)
            at_home = side == "home" and not g.get("neutral")
            if tiers.get(o) == "FCS":
                opp_rank = None
            if ts > os_:
                gain = params["win_base"]
                if opp_rank:
                    gain *= 1 + params["win_ranked_bonus"] * (26 - opp_rank) / 25
                if not at_home and not g.get("neutral"):
                    gain *= 1 + params["win_road_bonus"]
                gain += params["win_margin"] * min(margin, params["win_margin_cap"])
                if tiers.get(o) == "FCS":
                    gain *= 0.4
                new[t] += gain
            else:
                loss = params["loss_base"]
                if opp_rank is None:
                    loss *= 1 + params["loss_unranked_extra"]
                elif opp_rank <= 5:
                    loss *= 1 - params["loss_top_discount"]
                elif opp_rank <= 15:
                    loss *= 1 - params["loss_top_discount"] * 0.5
                if at_home:
                    loss *= 1 + params["loss_home_extra"]
                loss += params["loss_margin"] * min(margin, params["loss_margin_cap"])
                new[t] -= loss
    # Record line: as the season goes on, voters sort more and more by record.
    late = params["late_record_weight"] if week >= last_week - 3 else 1.0
    for t in list(new):
        w, l = records.get(t, (0, 0))
        new[t] = new[t] * (1 - params["decay"]) + params["record_weight"] * late * (w - l) * params["decay"]
    for t in new:
        if tiers.get(t) == "G5":
            new[t] -= params["g5_discount"] * 0.05   # a small weekly drag; the main discount sits in rank()
    return new


def rank(scores: dict[str, float], records: dict[str, tuple[int, int]], tiers: dict[str, str], params: dict, n: int = 25) -> list[str]:
    def key(t):
        s = scores[t]
        if tiers.get(t) == "G5":
            s -= params["g5_discount"]
        w, l = records.get(t, (0, 0))
        return (-(s + params["record_weight"] * (w - l) * 0.0), -w, l)
    eligible = [t for t in scores if tiers.get(t) != "FCS"]
    return sorted(eligible, key=key)[:n]


AP_VOTERS = 62          # ballots on the AP panel (62 in 2024, 66 in 2025)
VOTER_NOISE = 28.0      # fit to 2014-2025 AP polls: No.1 first-place share and 25th-place points


def ballots(order: list[str], scores: dict[str, float], tiers: dict[str, str], params: dict,
            n_voters: int = AP_VOTERS, seed: int = 0) -> dict[str, dict]:
    """First-place votes and points the way the AP publishes them. Each voter ranks the
    listed teams by the model score plus their own noise and names 25; a first place is
    25 points down to 1 for 25th. The totals are then handed down the published order so
    the numbers always agree with the ranking (a close race at the top splits the
    first-place votes; a runaway number one takes nearly all of them)."""
    rng = random.Random(seed)
    eff = {t: scores.get(t, 0.0) - (params["g5_discount"] if tiers.get(t) == "G5" else 0.0) for t in order}
    first: dict[str, int] = {}
    points: dict[str, int] = {}
    for _ in range(n_voters):
        ballot = sorted(order, key=lambda t: -(eff[t] + rng.gauss(0.0, VOTER_NOISE)))
        first[ballot[0]] = first.get(ballot[0], 0) + 1
        for i, t in enumerate(ballot[:25]):
            points[t] = points.get(t, 0) + 25 - i
    pts_sorted = sorted(points.values(), reverse=True)
    first_sorted = sorted(first.values(), reverse=True)
    out = {}
    for i, t in enumerate(order):
        out[t] = {"first_place": first_sorted[i] if i < len(first_sorted) else 0,
                  "points": pts_sorted[i] if i < len(pts_sorted) else 0}
    return out


# ----- CFP committee model -------------------------------------------------

def committee_rank(scores: dict[str, float], records: dict[str, tuple[int, int]], tiers: dict[str, str],
                   opponents: dict[str, list[dict]], ap_rank: dict[str, int], champions: Optional[dict[str, str]],
                   params: dict, n: int = 25) -> list[str]:
    """opponents: team -> [{"opp", "won", "opp_record": (w, l)}]. champions: conference -> team (final week only)."""
    adj = {}
    for t in scores:
        if tiers.get(t) == "FCS":
            continue
        opps = opponents.get(t, [])
        s = scores[t]
        if opps:
            sos = sum((ow / max(1, ow + ol)) for ow, ol in (o["opp_record"] for o in opps)) / len(opps) - 0.5
            s += params["sos_weight"] * sos
        for o in opps:
            orank = ap_rank.get(o["opp"])
            if o["won"] and orank:
                s += params["quality_win_weight"] * (26 - orank) / 25 * 2
            ow, ol = o["opp_record"]
            if not o["won"] and ol > ow:
                s -= params["bad_loss_weight"]
        w, l = records.get(t, (0, 0))
        s -= params["loss_weight"] * l
        if tiers.get(t) == "G5":
            s -= params["g5_discount"]
        if champions and t in champions.values():
            s += params["champ_bonus"]
        adj[t] = s
    order = sorted(adj, key=lambda t: (-adj[t], -records.get(t, (0, 0))[0]))
    # head-to-head: a team ranked just below a team it beat moves above it when scores are close
    window = params["head_to_head"] * 10
    changed = True
    passes = 0
    while changed and passes < 5:
        changed = False
        passes += 1
        for i in range(1, min(len(order), n + 5)):
            lower, upper = order[i], order[i - 1]
            beat = any(o["opp"] == upper and o["won"] for o in opponents.get(lower, []))
            lost = any(o["opp"] == lower and o["won"] for o in opponents.get(upper, []))
            same_losses = records.get(lower, (0, 0))[1] <= records.get(upper, (0, 0))[1]
            if beat and not lost and same_losses and adj[upper] - adj[lower] < window:
                order[i - 1], order[i] = lower, upper
                changed = True
    return order[:n]


# ----- bracket -------------------------------------------------------------

def build_bracket(ranking: list[str], champions: dict[str, str], conference_of: dict[str, str],
                  names: Optional[dict[str, str]] = None) -> dict:
    """12-team field and seeds under the 2026 rules. `ranking` is the final committee
    ranking (team keys, best first, at least 12 long); `champions` maps conference -> champion."""
    pos = {t: i + 1 for i, t in enumerate(ranking)}
    autos = []
    for conf in ("ACC", "Big Ten", "Big 12", "SEC"):
        champ = champions.get(conf)
        if champ:
            autos.append((champ, f"{conf} champion"))
    g6 = [t for t in ranking if conference_of.get(t) in G6]
    if g6:
        best = g6[0]
        label = "Group of Six auto bid (highest ranked)"
        for conf, champ in champions.items():
            if champ == best:
                label = f"{conf} champion, Group of Six auto bid"
        autos.append((best, label))
    nd = "notre-dame"
    if nd in pos and pos[nd] <= 12 and nd not in {a for a, _ in autos}:
        autos.append((nd, "Notre Dame (top 12)"))
    auto_set = {a for a, _ in autos}
    field = [a for a, _ in autos]
    for t in ranking:
        if len(field) >= 12:
            break
        if t not in auto_set:
            field.append(t)
    # Seeding: straight by ranking; auto qualifiers ranked outside the top 12 take the lowest seeds.
    inside = sorted([t for t in field if pos.get(t, 99) <= 12], key=lambda t: pos[t])
    outside = sorted([t for t in field if pos.get(t, 99) > 12], key=lambda t: pos.get(t, 99))
    seeded = inside + outside
    seeds = []
    reason = dict(autos)
    for i, t in enumerate(seeded, 1):
        seeds.append({"seed": i, "team": t, "name": (names or {}).get(t, t), "rank": pos.get(t),
                      "conference": conference_of.get(t), "bid": reason.get(t, "at-large"), "bye": i <= 4})
    first_round = [{"home": seeds[4], "away": seeds[11]}, {"home": seeds[5], "away": seeds[10]},
                   {"home": seeds[6], "away": seeds[9]}, {"home": seeds[7], "away": seeds[8]}] if len(seeds) == 12 else []
    first_four_out = [t for t in ranking if t not in auto_set and t not in field][:4]
    return {"seeds": seeds, "first_round": first_round,
            "quarterfinals": [{"bye": seeds[0], "winner_of": "5 vs 12"}, {"bye": seeds[3], "winner_of": "8 vs 9"},
                              {"bye": seeds[1], "winner_of": "7 vs 10"}, {"bye": seeds[2], "winner_of": "6 vs 11"}] if len(seeds) == 12 else [],
            "first_four_out": [{"team": t, "name": (names or {}).get(t, t), "rank": pos.get(t)} for t in first_four_out],
            "autos": [{"team": t, "bid": b, "name": (names or {}).get(t, t)} for t, b in autos]}
