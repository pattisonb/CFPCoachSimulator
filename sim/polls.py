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
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parents[1]   # the project root
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


def _saved_params() -> dict:
    """data/poll_params.json ({} before the first calibration)."""
    if PARAMS_FILE.exists():
        return json.loads(PARAMS_FILE.read_text(encoding="utf-8"))
    return {}


def load_params() -> tuple[dict, dict]:
    saved = _saved_params()
    return {**AP_PARAMS, **saved.get("ap", {})}, {**CFP_PARAMS, **saved.get("cfp", {})}


def load_next_params() -> dict:
    """The week-to-week model's fitted parameters (tools/backtest_polls.py)."""
    return {**NEXT_PARAMS, **_saved_params().get("next", {})}


def load_ballot_params() -> dict:
    """The ballot model's parameters: the week-to-week ones, with the ballot fit on top
    (tools/backtest_ballots.py fit)."""
    return {**load_next_params(), **_saved_params().get("ballots", {})}


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


# ----- AP week-to-week model ---------------------------------------------------
# How voters actually move a poll: last week's vote points (Top 25 and the others receiving
# votes) are the starting line, each team moves by its result, unbeaten teams get the
# benefit of the doubt, and a head-to-head winner goes above a close loser. Fit one week
# ahead (real poll + real results -> next real poll) over 2014-2023 by
# tools/backtest_polls.py; data/poll_params.json carries the fitted values under "next".
NEXT_PARAMS = {
    "win_base": 0.010,       # share of the maximum points gained for any win
    "win_opp": 0.10,         # extra x the opponent's share of the maximum (a win over No. 1 ~ +0.10)
    "win_margin": 0.010,     # extra for a 21-point win (scaled by margin, capped)
    "win_road": 0.005,
    "loss_base": 0.10,       # share lost for any loss
    "loss_bad": 0.15,        # extra x (1 - opponent's share): losing to an unranked team costs most
    "loss_margin": 0.06,     # extra for a 21-point loss
    "loss_home": 0.02,
    "loss_own": 0.0,         # extra x the loser's own share (top teams lose more points)
    "bye": 0.0,              # change for a team that did not play
    "unbeaten": 0.03,        # ranking edge for a team with no losses
    "loss_edge": 0.015,      # ranking drag per loss on the season
    "new_entry": 0.006,      # share per win minus 2 x losses for a team nobody voted for (P4)
    "g5_entry": 0.5,         # multiplier on new_entry for a Group of Five team
    "fcs_win": 0.3,          # a win over an FCS team counts this much of a normal win
    "h2h": 0.04,             # a head-to-head winner goes above the loser within this share
}


def _new_entry_value(p: dict, record: tuple[int, int], tier: Optional[str]) -> float:
    """What a team nobody voted for is worth: new_entry per win minus 2 x losses (scaled
    down for a Group of Five team), less one new_entry."""
    w, l = record
    entry = p["new_entry"] * max(0, w - 2 * l)
    return entry * (p["g5_entry"] if tier == "G5" else 1.0) - p["new_entry"]


def _win_gain(p: dict, opp_value: float, margin: float, at_home: bool, neutral: bool, opp_tier: Optional[str]) -> float:
    """A winner's gain: the base, the opponent's value, the margin (as a share of 21 points)
    and the road, cut to fcs_win against an FCS team."""
    gain = p["win_base"] + p["win_opp"] * opp_value + p["win_margin"] * margin + (0 if at_home or neutral else p["win_road"])
    if opp_tier == "FCS":
        gain *= p["fcs_win"]
    return gain


def _winners_over(games: list[dict]) -> list[tuple[str, str]]:
    """(winner, loser) for every game of the week that was not a tie."""
    return [(g["home"], g["away"]) if g["home_score"] > g["away_score"] else (g["away"], g["home"])
            for g in games if g["home_score"] != g["away_score"]]


def _head_to_head(order: list[str], key: dict[str, float], winners_over: list[tuple[str, str]], window: float) -> None:
    """Put each winner just above a loser it trails by less than `window` (in place)."""
    for w_, l_ in winners_over:
        if w_ in key and l_ in key and key[l_] > key[w_] and key[l_] - key[w_] < window:
            order.remove(w_)
            order.insert(order.index(l_), w_)


def _share_table(prev: list[dict]) -> tuple[dict[str, float], int]:
    """team -> share of the maximum points (0..1) from a published poll with its others."""
    voters = sum((e.get("first_place") or 0) for e in prev if (e.get("rank") or 99) <= 25) or AP_VOTERS
    top = 25.0 * voters
    return {e["team"]: (e.get("points") or 0.0) / top for e in prev}, voters


def next_poll(prev: list[dict], games: list[dict], records: dict[str, tuple[int, int]], tiers: dict[str, str],
              params: Optional[dict] = None, n: int = 25) -> tuple[list[str], dict[str, float]]:
    """The next AP poll from the last one. prev: [{team, rank, points, first_place}] for the
    Top 25 and the others receiving votes; games: this week's results; records: (wins, losses)
    after the games. Returns the order (n teams) and each listed team's share."""
    p = {**NEXT_PARAMS, **(params or {})}
    share, _ = _share_table(prev)
    val = dict(share)
    played = set()
    for g in games:
        for side, opp in (("home", "away"), ("away", "home")):
            t, o = g[side], g[opp]
            played.add(t)
            if tiers.get(t) == "FCS":
                continue
            if t not in val:
                val[t] = _new_entry_value(p, records.get(t, (0, 0)), tiers.get(t))
            ts, os_ = g[f"{side}_score"], g[f"{opp}_score"]
            m = min(abs(ts - os_), 21) / 21.0
            ov = share.get(o, 0.0)
            at_home = side == "home" and not g.get("neutral")
            if ts > os_:
                val[t] += _win_gain(p, ov, m, at_home, bool(g.get("neutral")), tiers.get(o))
            else:
                bad = 1.0 if tiers.get(o) == "FCS" else (1.0 - min(1.0, ov))
                val[t] -= (p["loss_base"] + p["loss_bad"] * bad + p["loss_margin"] * m + (p["loss_home"] if at_home else 0.0)
                           + p["loss_own"] * share.get(t, 0.0))
    for t in val:
        if t not in played:
            val[t] += p["bye"]
    key = {}
    for t, v in val.items():
        if tiers.get(t) == "FCS":
            continue
        w, l = records.get(t, (0, 0))
        key[t] = v + (p["unbeaten"] if l == 0 and w > 0 else 0.0) - p["loss_edge"] * l
    order = sorted(key, key=lambda t: -key[t])
    # head to head: this week's winner goes just above a loser it trails by less than h2h
    _head_to_head(order, key, _winners_over(games), p["h2h"])
    return order[:n], key


AP_VOTERS = 62          # ballots on the AP panel (62 in 2024, 66 in 2025)
VOTER_NOISE = 28.0      # fit to 2014-2025 AP polls: No.1 first-place share and 25th-place points


def ballots(order: list[str], scores: dict[str, float], tiers: dict[str, str], params: dict,
            n_voters: int = AP_VOTERS, seed: int = 0, noise: Optional[float] = None) -> dict[str, dict]:
    """First-place votes and points the way the AP publishes them. Each voter ranks the
    listed teams by the model score plus their own noise and names 25; a first place is
    25 points down to 1 for 25th. The totals are then handed down the published order so
    the numbers always agree with the ranking (a close race at the top splits the
    first-place votes; a runaway number one takes nearly all of them)."""
    rng = random.Random(seed)
    eff = {t: scores.get(t, 0.0) - (params["g5_discount"] if tiers.get(t) == "G5" else 0.0) for t in order}
    first: dict[str, int] = {}
    points: dict[str, int] = {}
    sigma = VOTER_NOISE if noise is None else noise
    for _ in range(n_voters):
        ballot = sorted(order, key=lambda t: -(eff[t] + rng.gauss(0.0, sigma)))
        first[ballot[0]] = first.get(ballot[0], 0) + 1
        for i, t in enumerate(ballot[:25]):
            points[t] = points.get(t, 0) + 25 - i
    pts_sorted = sorted(points.values(), reverse=True)
    first_sorted = sorted(first.values(), reverse=True)
    return {t: {"first_place": first_sorted[i] if i < len(first_sorted) else 0,
                "points": pts_sorted[i] if i < len(pts_sorted) else 0}
            for i, t in enumerate(order)}


COACHES_VOTERS = 65        # AFCA panel (53-67 ballots a week in 2014-2025)
COACHES_NOISE = 22.0       # coaches are more unanimous: No.1 takes a median 93% of first places (AP 87%)
COACHES_RECORD = 0.2       # spots per game of record margin, relative to the AP order
COACHES_INERTIA = 0.2      # weight on last week's coaches spot
COACHES_OPINION = 0.9      # spots: each team's standing opinion among the coaches for the season
COACHES_JITTER = 0.5       # spots: week-to-week disagreement


def coaches_order(ap_order: list[str], records: dict[str, tuple[int, int]], prev_coaches: dict[str, int],
                  opinion: Optional[dict[str, float]] = None) -> list[str]:
    """The Coaches Poll order from the AP order. Over 2014-2025 the two polls agree on
    No.1 in 95% of weeks and share 24 of 25 teams, with the coaches leaning a little
    more on the record and on their own previous poll; this nudge reproduces that
    (0.80 spots off the real coaches poll versus 0.84 for the AP order alone)."""
    cand = {}
    for i, t in enumerate(ap_order, 1):
        w, l = records.get(t, (0, 0))
        prev = prev_coaches.get(t, 30)
        # opinions matter less at the top: the two polls agree on No.1 in 95% of weeks
        damp = min(1.0, (i - 1) / 4.0)
        cand[t] = (26 - i) + COACHES_RECORD * (w - l) + COACHES_INERTIA * (26 - prev) + damp * (opinion or {}).get(t, 0.0)
    return sorted(ap_order, key=lambda t: (-cand[t], ap_order.index(t)))


def coaches_opinion(teams: list[str], season_seed: int, week: int) -> dict[str, float]:
    """A separate panel has its own view of each team: a standing offset for the season
    plus a little week-to-week movement, in spots. Sized so the two polls differ by about
    0.8 spots per team and share 24 of 25, as they did in 2014-2025."""
    out = {}
    for t in teams:
        standing = random.Random(f"{season_seed}:{t}").gauss(0.0, COACHES_OPINION)
        weekly = random.Random(f"{season_seed}:{t}:{week}").gauss(0.0, COACHES_JITTER)
        out[t] = standing + weekly
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
    names = names or {}
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
    reason = dict(autos)
    seeds = [{"seed": i, "team": t, "name": names.get(t, t), "rank": pos.get(t),
              "conference": conference_of.get(t), "bid": reason.get(t, "at-large"), "bye": i <= 4}
             for i, t in enumerate(seeded, 1)]
    full = len(seeds) == 12
    first_round = [{"home": seeds[4], "away": seeds[11]}, {"home": seeds[5], "away": seeds[10]},
                   {"home": seeds[6], "away": seeds[9]}, {"home": seeds[7], "away": seeds[8]}] if full else []
    quarterfinals = [{"bye": seeds[0], "winner_of": "5 vs 12"}, {"bye": seeds[3], "winner_of": "8 vs 9"},
                     {"bye": seeds[1], "winner_of": "7 vs 10"}, {"bye": seeds[2], "winner_of": "6 vs 11"}] if full else []
    first_four_out = [t for t in ranking if t not in auto_set and t not in field][:4]
    return {"seeds": seeds, "first_round": first_round, "quarterfinals": quarterfinals,
            "first_four_out": [{"team": t, "name": names.get(t, t), "rank": pos.get(t)} for t in first_four_out],
            "autos": [{"team": t, "bid": b, "name": names.get(t, t)} for t, b in autos]}


# ----- the AP poll from the voters' ballots ----------------------------------------------
# Each voter's ballot moves with the week's results and the voter names a new 25; the poll
# is the ballots added up (25 points for first down to 1 for 25th). One week ahead this is
# about 2% closer to the real poll than moving the vote shares; across a whole season with
# no real poll to lean on (season mode) it is 9% closer, and 26% by the last weeks, because
# each voter keeps their own view instead of the consensus drifting
# (tools/backtest_ballots.py; the season replay is in docs/HOW_IT_WORKS.md).

BALLOT_SEED_NOISE = 0.06     # a voter's spread around the consensus when ballots are made from a poll's points

# Terms only the ballot model has (on top of NEXT_PARAMS); the values here leave them off,
# data/poll_params.json "ballots" carries the fitted ones.
BALLOT_PARAMS = {
    "off_ballot": 0.5,         # a team off the voter's ballot is worth its consensus share x this
    "close_win": 0.0,          # taken from a narrow winner: x (1 - opponent's value) x how narrow
    "close_margin": 8.0,       # points: a win by this much or more is not narrow
    "close_own": 0.0,          # the narrow-win cost x the winner's own value ** this (0: the same for everyone)
    "loss_bad_pow": 1.0,       # the bad-loss term is loss_bad x (1 - opponent's value) ** this
    "loss_ranked_cap": 1.0,    # most a loss can cost when the winner is on the voter's ballot
    "loss_edge_extra": 0.0,    # extra ranking drag per loss beyond the second
    "voter_noise": 0.0,        # each voter's own week-to-week wobble (sd, share of the maximum)
    "entry_all": 0.0,          # an off-ballot team with votes elsewhere is worth at least this x its record value
}


def seed_ballots(prev: list[dict], n_voters: Optional[int] = None, seed: int = 0, noise: float = BALLOT_SEED_NOISE) -> list[list[str]]:
    """Ballots that add up to about the given poll (its Top 25 and others receiving votes,
    with vote points): each voter ranks the teams by their share of the vote plus their own
    noise. Used where no real ballots exist: the preseason of a simulated season, or the
    first simulated week after a real poll."""
    share, voters = _share_table(prev)
    n = n_voters or voters or AP_VOTERS
    rng = random.Random(seed)
    teams = list(share)
    return [sorted(teams, key=lambda t: -(share[t] + rng.gauss(0.0, noise)))[:25] for _ in range(n)]


def next_ballots(ballots: list[list[str]], prev: list[dict], games: list[dict], records: dict[str, tuple[int, int]],
                 tiers: dict[str, str], params: Optional[dict] = None, seed: int = 0) -> tuple[list[list[str]], dict[str, int], dict[str, int]]:
    """Every voter's next ballot from their last one and the week's results. prev is last
    week's published poll with vote points (the consensus a voter falls back on for a team
    not on their ballot). `seed` drives each voter's own wobble (voter_noise). Returns
    (the new ballots, points, first-place votes)."""
    p = {**NEXT_PARAMS, **BALLOT_PARAMS, **(params or {})}
    share, _ = _share_table(prev)
    off = p["off_ballot"]
    rng = random.Random(seed)
    facts = []
    played = set()
    for g in games:
        if g["home_score"] == g["away_score"]:
            continue
        for side, opp in (("home", "away"), ("away", "home")):
            t, o = g[side], g[opp]
            played.add(t)
            if tiers.get(t) == "FCS":
                continue
            ts, os_ = g[f"{side}_score"], g[f"{opp}_score"]
            facts.append((t, o, ts > os_, min(abs(ts - os_), 21) / 21.0, side == "home" and not g.get("neutral"), bool(g.get("neutral"))))
    winners_over = _winners_over(games)
    new: list[list[str]] = []
    for ballot in ballots:
        mine = {t: (25 - i) / 25.0 for i, t in enumerate(ballot[:25])}
        # off the ballot: the consensus share, scaled down (the voter left them off for a reason)
        val = {t: mine.get(t, share.get(t, 0.0) * off) for t in set(share) | set(mine)}
        for t, o, won, m, at_home, neutral in facts:
            if t not in mine:
                # a team the voter does not rank is worth at least what its record says
                # (entry_all: also when others vote for it), so a 6-0 team can climb past a 3-3 one
                entry = _new_entry_value(p, records.get(t, (0, 0)), tiers.get(t))
                if t not in val:
                    val[t] = entry
                elif p["entry_all"]:
                    val[t] = max(val[t], p["entry_all"] * entry)
            ov = mine.get(o, share.get(o, 0.0) * off)
            own = mine.get(t, share.get(t, 0.0) * off)
            bad = 1.0 if tiers.get(o) == "FCS" else (1.0 - min(1.0, ov))
            if won:
                gain = _win_gain(p, ov, m, at_home, neutral, tiers.get(o))
                # a narrow escape against a weak team costs the winner (m is the margin / 21)
                gain -= p["close_win"] * bad * max(0.0, 1.0 - m * 21.0 / p["close_margin"]) * own ** p["close_own"]
                val[t] += gain
            else:
                loss = p["loss_base"] + p["loss_bad"] * bad ** p["loss_bad_pow"] + p["loss_margin"] * m \
                    + (p["loss_home"] if at_home else 0.0) + p["loss_own"] * own
                if o in mine:                  # losing to a team the voter ranks costs less
                    loss = min(loss, p["loss_ranked_cap"])
                val[t] -= loss
        key = {}
        noise = p["voter_noise"]
        for t in sorted(val):                  # sorted: the same team draws the same noise every run
            if tiers.get(t) == "FCS":
                continue
            w, l = records.get(t, (0, 0))
            key[t] = val[t] + (p["bye"] if t not in played else 0.0) + (p["unbeaten"] if l == 0 and w > 0 else 0.0) \
                - p["loss_edge"] * l - p["loss_edge_extra"] * max(0, l - 2)
            if noise:
                key[t] += rng.gauss(0.0, noise)
        order = sorted(key, key=lambda t: -key[t])
        _head_to_head(order, key, winners_over, p["h2h"])    # a close call goes to the team that won the game
        new.append(order[:25])
    points, first = tally(new)
    return new, points, first


def tally(ballots: list[list[str]]) -> tuple[dict[str, int], dict[str, int]]:
    """(points, first-place votes) of a set of ballots."""
    points: dict[str, int] = {}
    first: dict[str, int] = {}
    for b in ballots:
        if b:
            first[b[0]] = first.get(b[0], 0) + 1
        for i, t in enumerate(b[:25]):
            points[t] = points.get(t, 0) + 25 - i
    return points, first
