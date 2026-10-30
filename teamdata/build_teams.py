"""Convert cfb_sim_data (EA-derived player ratings, coaches, stadiums) into the engine's
roster format and write data/engine_teams.json.

Why a build step: the source is 146 files of about 490 KB each (72 MB). The engine needs
about 20 attributes per player, so the converted league is a few megabytes and loads in
well under a second.

Rating map (source ratings are 0-99 with 50 = average FBS player):

    speed            0.7 speed + 0.3 acceleration
    strength         strength (RB: average with trucking and stiff arm)
    intelligence     awareness (defense: average of awareness and play recognition)
    endurance        stamina
    QB passing       0.3 short + 0.35 mid + 0.2 deep accuracy + 0.15 throw power
    QB decisions     0.6 awareness + 0.4 throw under pressure
    RB elusiveness   agility, juke, spin, break tackle, change of direction
    RB vision        ball carrier vision
    WR/TE hands      catching, catch in traffic, spectacular catch
    WR/TE routes     short, medium, deep route running, release
    OL run block     run block, run block power, run block finesse
    OL pass block    pass block, pass block power, pass block finesse
    DL/LB rushing    power moves, finesse moves, block shedding
    tackling         tackle, pursuit (LB: also hit power)
    coverage         man coverage, zone coverage
    K / P            kick power, kick accuracy

Every mapped attribute is then re-centred so that the league-average FBS starter at that
position group sits at NEUTRAL (the engine's reference point), with the spread scaled by
SPREAD_SCALE. The engine was calibrated on rating differences, so this keeps a league
of these teams playing like FBS football while preserving who is better than whom.

Usage:  python -m teamdata.build_teams [spread_scale]      # from the project root
"""
from __future__ import annotations

import json
import os
import statistics as st
import sys
from collections import defaultdict
from pathlib import Path
from typing import Optional

from teamdata import game_scale
from teamdata import ratings as rv2   # ratings v2: the player attributes (docs/RATINGS_V2.md)

ROOT = Path(__file__).resolve().parents[1]   # the project root
SRC = ROOT / "cfb_sim_data"
OUT = ROOT / "data" / "engine_teams.json"

NEUTRAL = 55          # engine reference rating (engine/game_config.py)
SPREAD_SCALE = 1.50   # rating points of spread kept per source point; tuned in calibrate_season.py and tools/realism.py
# Diminishing returns at the top (team_level): of a team's talent above the FBS starter average,
# only this share counts. Through week 8 of 2026 a point of rating gap was worth 1.4 real points
# of margin between Power 4 teams and 3.1 between Group of Five teams; the sim paid 2.0 in both,
# so Power 4 margins ran 1.5x too wide (real on sim margin slope 0.58-0.70) while Group of Five
# margins were right (0.95-1.02). BUILD_TOP_SCALE=1 builds without it (for before/after tests).
TEAM_LEVEL_TOP_SCALE = float(os.environ.get("BUILD_TOP_SCALE", "0.70"))

POSITION_MAP = {
    "QB": "QB", "HB": "RB", "FB": "RB", "WR": "WR", "TE": "TE",
    "LT": "OL", "LG": "OL", "C": "OL", "RG": "OL", "RT": "OL",
    "LEDG": "DL", "REDG": "DL", "DT": "DL",
    "MIKE": "MLB", "WILL": "ROLB", "SAM": "LOLB",
    "CB": "CB", "FS": "S", "SS": "S", "K": "K", "P": "P",
}
OFFENSE = {"QB", "RB", "WR", "TE", "OL", "K", "P"}

OFF_STATS = ["pass_attempts", "completions", "pass_yards", "interceptions_thrown", "sacks_taken",
             "carries", "rush_yards", "fumbles", "receptions", "receiving_yards", "targets",
             "passing_touchdowns", "receiving_touchdowns", "rushing_touchdowns", "solo_tackles",
             "assisted_tackles", "fg_attempted", "fg_made", "pat_attempts", "pat_made"]
DEF_STATS = ["solo_tackles", "assisted_tackles", "sacks", "interceptions", "forced_fumbles"]
SHARED_STATS = ["kickoff_returns", "kickoff_return_yards", "kickoff_return_touchdowns", "punt_returns",
                "punt_return_yards", "punt_return_touchdowns", "defensive_touchdowns", "fumble_recoveries",
                "fumble_return_yards", "interception_return_yards", "punts", "punt_yards"]


# the school's name as people say it, not its legal name ("University of Notre Dame du Lac", "The
# Ohio State University", "Virginia Polytechnic Institute and State University")
SCHOOL_DISPLAY = {
    "University of Notre Dame du Lac": "University of Notre Dame",
    "Rutgers, The State University of New Jersey": "Rutgers University",
    "Virginia Polytechnic Institute and State University": "Virginia Tech",
    "University of Illinois Urbana-Champaign": "University of Illinois",
    "The University of Tennessee, Knoxville": "University of Tennessee",
    "University of Maryland, College Park": "University of Maryland",
    "University of Massachusetts Amherst": "University of Massachusetts",
    "University of North Carolina at Chapel Hill": "University of North Carolina",
    "The University of Texas at Austin": "University of Texas",
    "California State University, Fresno": "Fresno State University",
    "California State University, Sacramento": "Sacramento State University",
}


def display_school(name: str) -> str:
    """A school's everyday name: the override table, else the legal name without a leading "The"."""
    out = SCHOOL_DISPLAY.get(name, name)
    return out[4:] if out.startswith("The ") else out


def avg(r: dict, *keys: str, default: float = 50.0) -> float:
    vals = [r[k] for k in keys if isinstance(r.get(k), (int, float))]
    return sum(vals) / len(vals) if vals else default


def clamp_rating(x: float) -> int:
    """A rating held to 1-99 and rounded."""
    return int(round(max(1, min(99, x))))


def clamp_tendency(x: float) -> int:
    """A coach tendency held to 0-100 and rounded."""
    return int(round(max(0, min(100, x))))


def to_engine(v: float, mean: float) -> float:
    """A source value on the engine scale: `mean` lands on NEUTRAL, the spread is scaled by SPREAD_SCALE."""
    return NEUTRAL + (v - mean) * SPREAD_SCALE


def depth_key(p: dict) -> int:
    """Sort key for depth-chart order (a player without a depth goes last)."""
    return p.get("depth") or 99


def map_player(p: dict, pos: str | None = None) -> dict:
    """Raw engine attributes (before normalization) for one source player, at his own
    position or, with `pos`, as if he played another engine position."""
    r = p["ratings"]
    pos = pos or POSITION_MAP.get(p["position"])
    if pos is None:
        return {}
    out = {
        "name": p["name"],
        "slug": p["slug"],
        "position": pos,
        "source_position": p["position"],
        "overall": p["overall"],
        # our overall (game_scale.py: the game's own 1-99 scale, 50 the middle Power 4 starter):
        # the player card's overall. The engine never reads it.
        "ovr": p["ovr"] if p.get("ovr") is not None else (game_scale.overall(game_scale.ours_from_base(r, p["position"]), p["position"])
                                                          if game_scale.has_overall() else None),
        # identity for awards and the roster view: FR, FRRS, SO, SORS, JR, JRRS, SR, SRRS
        "class": p.get("class"),
        "height": p.get("height"),
        "weight": p.get("weight_lbs"),
        "jersey": p.get("jersey"),
        "dev_trait": p.get("dev_trait"),
        "speed": 0.7 * r.get("speed", 50) + 0.3 * r.get("acceleration", 50),
        "strength": r.get("strength", 50),
        "intelligence": r.get("awareness", 50),
        "endurance": r.get("stamina", 50),
        # Return rating: the EA kick-return skill plus the traits a returner uses.
        "return_rating": (0.35 * r.get("kick_return", 50) + 0.20 * r.get("speed", 50)
                          + 0.15 * r.get("acceleration", 50)
                          + 0.15 * avg(r, "agility", "juke_move", "change_of_direction")
                          + 0.10 * r.get("bc_vision", 50) + 0.05 * r.get("carrying", 50)),
    }
    if pos == "QB":
        out["passing"] = (0.3 * r.get("throw_accuracy_short", 50) + 0.35 * r.get("throw_accuracy_mid", 50)
                          + 0.2 * r.get("throw_accuracy_deep", 50) + 0.15 * r.get("throw_power", 50))
        out["decision_making"] = 0.6 * r.get("awareness", 50) + 0.4 * r.get("throw_under_pressure", 50)
        out["elusiveness"] = avg(r, "agility", "juke_move", "break_sack")
        out["vision"] = r.get("bc_vision", 50)
        out["hands"] = r.get("carrying", 50)
    elif pos == "RB":
        out["strength"] = avg(r, "strength", "trucking", "stiff_arm")
        out["elusiveness"] = avg(r, "agility", "juke_move", "spin_move", "break_tackle", "change_of_direction")
        out["vision"] = r.get("bc_vision", 50)
        out["hands"] = r.get("catching", 50)
        out["route_running"] = avg(r, "short_route_running", "medium_route_running")
        out["run_blocking"] = r.get("run_block", 50)
        out["pass_blocking"] = r.get("pass_block", 50)
    elif pos in ("WR", "TE"):
        out["hands"] = avg(r, "catching", "catch_in_traffic", "spectacular_catch")
        out["route_running"] = avg(r, "short_route_running", "medium_route_running", "deep_route_running", "release")
        out["elusiveness"] = avg(r, "agility", "juke_move", "change_of_direction")
        out["vision"] = r.get("bc_vision", 50)
        out["run_blocking"] = avg(r, "run_block", "impact_blocking")
        out["pass_blocking"] = r.get("pass_block", 50)
    elif pos == "OL":
        out["run_blocking"] = avg(r, "run_block", "run_block_power", "run_block_finesse")
        out["pass_blocking"] = avg(r, "pass_block", "pass_block_power", "pass_block_finesse")
    elif pos == "DL":
        out["intelligence"] = avg(r, "awareness", "play_recognition")
        out["rushing"] = avg(r, "power_moves", "finesse_moves", "block_shedding")
        out["tackling"] = avg(r, "tackle", "pursuit")
        out["coverage"] = avg(r, "zone_coverage", "man_coverage")
    elif pos in ("MLB", "ROLB", "LOLB"):
        out["intelligence"] = avg(r, "awareness", "play_recognition")
        out["rushing"] = avg(r, "power_moves", "finesse_moves", "block_shedding")
        out["tackling"] = avg(r, "tackle", "pursuit", "hit_power")
        out["coverage"] = avg(r, "man_coverage", "zone_coverage")
    elif pos in ("CB", "S"):
        out["intelligence"] = avg(r, "awareness", "play_recognition")
        out["coverage"] = avg(r, "man_coverage", "zone_coverage")
        out["tackling"] = avg(r, "tackle", "pursuit")
        out["hands"] = r.get("catching", 50)
        out["rushing"] = avg(r, "power_moves", "finesse_moves", "block_shedding")
    elif pos == "K":
        out["kick_power"] = r.get("kick_power", 50)
        out["kick_accuracy"] = r.get("kick_accuracy", 50)
    elif pos == "P":
        out["punt_power"] = r.get("kick_power", 50)
        out["punt_accuracy"] = r.get("kick_accuracy", 50)
    return out


ATTRS = ["speed", "strength", "intelligence", "endurance", "passing", "decision_making", "elusiveness",
         "vision", "hands", "route_running", "run_blocking", "pass_blocking", "rushing", "tackling",
         "coverage", "kick_power", "kick_accuracy", "punt_power", "punt_accuracy"]
# Return rating is centred on the league's designated returners rather than per position.
RETURN_ATTR = "return_rating"

# After normalization (overnight review, bug 8). Re-centring on the starter mean and
# stretching by SPREAD_SCALE turns an ordinary raw value into an extreme one when the
# position's starters bunch: linemen got coverage of 90-99 and a few starting receivers
# route running of 1. A skill a position does not use is held to OFF_SKILL_RANGE; a core
# skill (CORE_SKILLS, below) of an established player (our overall CORE_FLOOR_OVR or more)
# keeps CORE_FLOOR. Speed, strength, intelligence and endurance are left alone.
PHYSICAL = ("speed", "strength", "intelligence", "endurance")   # every position uses these
OFF_SKILL_RANGE = (25, 85)
CORE_FLOOR, CORE_FLOOR_OVR = 20, 9    # 9: every player EA rated 60 or more (the rule as first set) is over it
CLAMP_EXTREMES = not os.environ.get("BUILD_NO_CLAMP")   # BUILD_NO_CLAMP=1 builds without it (for before/after tests)


def starter_slugs(team: dict) -> set[str]:
    out = set()
    for unit in ("offense", "defense"):
        for slugs in team["starters"][unit].values():
            out.update(slugs)
    return out


def load_team(path: Path) -> dict:
    return team_from_source(json.loads(path.read_text(encoding="utf-8")))


def team_from_source(t: dict) -> dict:
    """One team in the source format (cfb_sim_data/teams/*.json, or a career's league.py
    rebuild of it) converted for the build."""
    starters = starter_slugs(t)
    st_special = t["starters"]["special_teams"]
    # depth-chart role (LT, LG, C, RG, RT, LEDG, DT, REDG, SAM, MIKE, WILL, CB, FS, SS, HB, ...)
    # and depth order, for awards that go by sub-position (center, edge, interior, tackle)
    roles = {}
    for role, slugs in (t.get("depth_chart") or {}).items():
        for i, slug in enumerate(slugs or []):
            roles.setdefault(slug, (role, i + 1))
    players = []
    for p in t["roster"]:
        m = map_player(p)
        if not m:
            continue
        m["starter"] = p["slug"] in starters
        m["role"], m["depth"] = roles.get(p["slug"], (None, None))
        m["_src"] = p
        # his skills on our scale (game_scale.py), what comps and the card overall read
        m["skills"] = p.get("skills") or [v for v in game_scale.ours_from_base(p["ratings"], p["position"]).values()]
        if p.get("target_mult") is not None:          # a career's league: his share of targets, kept with him
            m["target_mult"] = p["target_mult"]
        # ratings v2: the attributes on the source scale (house_attributes puts them on ours),
        # the measurables, the earned traits and the play style
        m["_attr_raw"] = rv2.raw_attributes(p["ratings"], m["position"], m["role"])
        m["height_in"] = rv2.height_inches(p.get("height"))
        m["traits"] = rv2.traits_of(p.get("abilities") or [])
        m["archetype"] = rv2.ARCHETYPES.get(p.get("archetype") or "", p.get("archetype"))
        # the engine finds K and P among in-game offense players
        if m["position"] in ("K", "P"):
            m["starter"] = p["slug"] in st_special.get(m["position"], [])
        players.append(m)
    hc, oc, dc = t["coaches"]["head_coach"], t["coaches"]["offensive_coordinator"], t["coaches"]["defensive_coordinator"]
    fix = SCHEME_OVERRIDES.get(t["slug"]) or {}
    if fix.get("offense"):
        hc["scheme"] = {**hc["scheme"], "offensive_philosophy": fix["offense"]}
        oc["scheme"] = {**oc["scheme"], "offensive_scheme": fix["offense"]}
    if fix.get("defense"):
        hc["scheme"] = {**hc["scheme"], "defensive_philosophy": fix["defense"]}
        dc["scheme"] = {**dc["scheme"], "defensive_scheme": fix["defense"]}
    # Returners are roles, not roster slots: a starter can also return kicks.
    kr = (st_special.get("KR") or [None])[0]
    pr = (st_special.get("PR") or [None])[0]
    return {
        "kick_returner": kr,
        "punt_returner": pr,
        "tendencies": {
            "pass_rate": oc["tendencies"].get("pass_rate", 50),
            "tempo": oc["tendencies"].get("tempo", 50),
            "fourth_down_go_rate": hc["tendencies"].get("fourth_down_go_rate", 50),
            "blitz_rate": dc["tendencies"].get("blitz_rate", 50),
            "oc_play_calling": oc["ratings"].get("play_calling", 50),
            "dc_play_calling": dc["ratings"].get("play_calling", 50),
            # coach styles: what the coordinators like to call and the head coach's discipline
            "deep_shot_rate": oc["tendencies"].get("deep_shot_rate", 50),
            "play_action_rate": oc["tendencies"].get("play_action_rate", 50),
            "man_coverage_rate": dc["tendencies"].get("man_coverage_rate", 50),
            "press_rate": dc["tendencies"].get("press_rate", 50),
            "discipline": hc["ratings"].get("discipline", 50),
            **({"rb_lead_feature": t["rb_lead_feature"]} if t.get("rb_lead_feature") is not None else {}),
        },
        "slug": t["slug"],
        "name": t["short_name"],
        "school": display_school(t["school_name"]),
        "abbreviation": t["abbreviation"],
        "mascot": t["mascot"],
        "conference": t["conference"],
        "subdivision": t["subdivision"],
        "city": t.get("city"),
        "state": t.get("state"),
        "fictional": t["fictional"],
        "colors": {k: (v["hex"] if v else None) for k, v in t["colors"].items()},
        "stadium": t["stadium"],
        "home_field_advantage": t["program"]["home_field_advantage"],
        "prestige": t["program"]["prestige"],
        "team_ratings": t["team_ratings"],
        "coaches": {
            "head_coach": {"name": hc["name"], "ratings": hc["ratings"], "tendencies": hc["tendencies"], "scheme": hc["scheme"],
                           "since": hc.get("since")},
            "offensive_coordinator": {"name": oc.get("name"), "ratings": oc["ratings"], "tendencies": oc["tendencies"], "scheme": oc["scheme"]},
            "defensive_coordinator": {"name": dc.get("name"), "ratings": dc["ratings"], "tendencies": dc["tendencies"], "scheme": dc["scheme"]},
        },
        "players": players,
    }


TENDENCY_KEYS = ("pass_rate", "tempo", "fourth_down_go_rate", "blitz_rate", "oc_play_calling", "dc_play_calling",
                 "deep_shot_rate", "play_action_rate", "man_coverage_rate", "press_rate", "discipline")


def normalize_tendencies(teams: list[dict]) -> dict:
    """Centre the generated coach tendencies so the FBS average is 50 (the engine's
    neutral), keeping each team's distance from the pack. Service academies stay run-heavy."""
    means = {}
    for key in TENDENCY_KEYS:
        vals = [t["tendencies"][key] for t in teams if not t["fictional"]]
        means[key] = st.mean(vals)
        for t in teams:
            t["tendencies"][key] = clamp_tendency(50 + t["tendencies"][key] - means[key])
    return {k: round(v, 1) for k, v in means.items()}


def decouple_discipline(teams: list[dict]) -> float:
    """Keep only the part of the head coach's discipline that the team's talent does not
    already explain. The source ratings give better programs more disciplined coaches
    (r about 0.7 with team overall), and the players' Football IQ already lowers penalties
    for those teams; using the raw rating counted that edge twice and spread margins too far.
    Returns the slope taken out (discipline points per overall point)."""
    fbs = [t for t in teams if not t["fictional"]]
    xs = [t["team_ratings"]["overall"] for t in fbs]
    ys = [t["tendencies"]["discipline"] for t in fbs]
    mx, my = st.mean(xs), st.mean(ys)
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sum((x - mx) ** 2 for x in xs)
    for t in teams:
        fit = my + slope * (t["team_ratings"]["overall"] - mx)
        t["tendencies"]["discipline"] = clamp_tendency(50 + t["tendencies"]["discipline"] - fit)
    return round(slope, 3)


OBSERVED = ROOT / "data" / "observed_tendencies.json"


GAME_SCRIPT_PASS = 0.10   # points of pass share credited back per point of a team's average margin
FOURTH_PER_MARGIN = 0.013 # fourth-down tries a game added back per point of average margin (trailing teams try
                          # more: the slope across FBS teams in 2026)
SCRAMBLE_SHARE = 4.0      # points of a team's rushes that are QB scrambles (the engine adds its own)


def apply_observed_tendencies(teams: list[dict], only: Optional[set] = None, styles: Optional[dict] = None) -> int:
    """Replace generated coach tendencies with what each team has actually done in 2026
    (derive_tendencies.py), scaled to the engine's tendency effects. Teams without box
    scores keep the generated values; so do teams not in `only` (when given). `styles`: a
    team plays another real team's observed style (a career's new head coach brings one)."""
    if not OBSERVED.exists():
        return 0
    obs = json.loads(OBSERVED.read_text(encoding="utf-8"))
    league, per_team = obs["league"], obs["teams"]
    n = 0
    for t in teams:
        o = per_team.get((styles or {}).get(t["slug"], t["slug"]))
        if not o or o["games"] < 2 or (only is not None and t["slug"] not in only):
            continue
        td = t["tendencies"]
        # Game script: a team that leads a lot runs to protect leads, and the engine already
        # plays that out (it runs more when ahead), so the observed rate is credited back
        # GAME_SCRIPT_PASS points of pass share per point of average margin.
        margin = o.get("margin_per_game", 0.0)
        td["pass_rate"] = clamp_tendency(50 + 1.67 * (o["pass_rate"] - league["pass_rate"] + GAME_SCRIPT_PASS * margin))
        td["tempo"] = clamp_tendency(50 + 3.0 * (o["plays_per_game"] - league["plays_per_game"]))
        # Fourth-down tries: a team that trails a lot tries more out of need, not choice
        # (Sac State 99, Texas A&M 100), so the attempts expected from its margin come off.
        ratio = (o["fourth_att_per_game"] + FOURTH_PER_MARGIN * margin) / max(0.1, league["fourth_att_per_game"])
        td["fourth_down_go_rate"] = clamp_tendency(50 + (ratio - 1) * 125)
        # Observed QB rushes include sacks (college convention) and scrambles; designed runs are the
        # rest: every quarterback's carries less the team's own sacks and about 4 points of scrambles
        # (the engine plays scrambles itself). A flat 10 points used to come off QB1's carries alone,
        # which left low-sack teams and run-package QB2s with almost no designed runs.
        if "qb_all_rush_share" in o:
            td["qb_run_share"] = round(max(0.0, o["qb_all_rush_share"] - o["sack_share"] - SCRAMBLE_SHARE), 1)
        else:
            td["qb_run_share"] = round(max(0.0, o["qb_rush_share"] - 6.0 - SCRAMBLE_SHARE), 1)
        # Backfield split: the top back's average share of the team's running back carries in a
        # game (and the second back's). roster.Team._lead_profile turns rb1_share into the lead
        # back's feature score, so a team that rides one back does so in the sim.
        td["rb1_share"] = o["rb1_share"]
        td["rb2_share"] = o["rb2_share"]
        td["observed"] = True
        n += 1
    return n


REAL_ADJUSTMENTS = ROOT / "data" / "real_adjustments.json"
SCHEME_FILE = ROOT / "data" / "scheme_overrides.json"     # schemes the source codes wrong (section 6 of the review)
SCHEME_OVERRIDES = json.loads(SCHEME_FILE.read_text(encoding="utf-8")) if SCHEME_FILE.exists() else {}


LB_ROLES = ("SAM", "MIKE", "WILL")
LB_POOL = "LB_POOL"             # tools/tune_from_real.py: every linebacker by real usage, across the three roles
SPECIALISTS = "SPECIALISTS"     # tools/tune_from_real.py: {"K" or "P": slug} for a specialist listed at the other spot


MANUAL_RATINGS = ROOT / "data" / "manual_ratings.json"


def apply_manual_ratings(teams: list[dict], manual: Optional[dict] = None) -> int:
    """Hand edits from data/manual_ratings.json ({"ratings": {team: {player: {attr: delta}}}}), in
    engine points on the normalized scale, applied after the real adjustments so the tuning tool
    never overwrites them. A player or attribute that is not there is skipped. Returns the
    number of attribute edits applied."""
    if manual is None:
        if not MANUAL_RATINGS.exists():
            return 0
        manual = json.loads(MANUAL_RATINGS.read_text(encoding="utf-8"))
    applied = 0
    for t in teams:
        edits = (manual.get("ratings") or {}).get(t["slug"]) or {}
        if not edits:
            continue
        by_slug = {p["slug"]: p for p in t["players"]}
        for ps, deltas in edits.items():
            p = by_slug.get(ps)
            if not p:
                continue
            for attr, d in deltas.items():
                if attr in ATTRS and isinstance(p.get(attr), (int, float)):
                    p[attr] = clamp_rating(p[attr] + d)
                    applied += 1
    return applied


def apply_real_adjustments(teams: list[dict], means: dict) -> tuple[int, int]:
    """Apply data/real_adjustments.json (tools/tune_from_real.py): rating nudges in engine
    points, then depth orders by real usage, keeping each role's number of starters.
    Linebacker starters are picked across SAM, MIKE and WILL from one usage order (the
    engine plays them in that order), and a real kicker or punter listed at the other
    spot is moved there. Returns (players nudged, roles reordered)."""
    if not REAL_ADJUSTMENTS.exists():
        return 0, 0
    adj = json.loads(REAL_ADJUSTMENTS.read_text(encoding="utf-8"))
    nudged = reordered = 0
    for t in teams:
        for a in (adj.get("added") or {}).get(t["slug"], []):
            add_real_player(t, a)
        by_slug = {p["slug"]: p for p in t["players"]}
        usage = (adj.get("usage") or {}).get(t["slug"]) or {}
        if usage.get("rb_lead_feature") is not None:
            t["tendencies"]["rb_lead_feature"] = usage["rb_lead_feature"]
        for ps, m in (usage.get("targets") or {}).items():
            if ps in by_slug:
                by_slug[ps]["target_mult"] = m
        for ps, deltas in (adj.get("ratings") or {}).get(t["slug"], {}).items():
            p = by_slug.get(ps)
            if not p:
                continue
            for attr, d in deltas.items():
                if isinstance(p.get(attr), (int, float)):
                    p[attr] = clamp_rating(p[attr] + d)
            nudged += 1
        changes = (adj.get("depth") or {}).get(t["slug"], {})
        for role, order in changes.items():
            if role in (LB_POOL, SPECIALISTS):
                continue
            group = [p for p in t["players"] if p.get("role") == role]
            if not group:
                continue
            n_start = sum(1 for p in group if p["starter"])
            for i, p in enumerate(usage_ranked(group, order, by_slug, (role,))):
                p["depth"] = i + 1
                p["starter"] = i < n_start
            reordered += 1
        if changes.get(LB_POOL):
            reordered += pool_linebackers(t, changes[LB_POOL], by_slug)
        for pos, slug in (changes.get(SPECIALISTS) or {}).items():
            if slug in by_slug:
                reordered += move_specialist(t, by_slug[slug], pos, means)
    return nudged, reordered


def usage_ranked(group: list[dict], order: list[str], by_slug: dict, roles: tuple[str, ...]) -> list[dict]:
    """`group` in real-usage order: the players `order` names (at one of `roles`) first, then
    the rest of the group in depth order."""
    ranked = [by_slug[s] for s in order if s in by_slug and by_slug[s].get("role") in roles]
    ranked += [p for p in sorted(group, key=depth_key) if p not in ranked]
    return ranked


def add_real_player(t: dict, a: dict) -> None:
    """A real 2026 player the source rosters lack (data/real_adjustments.json "added"), listed
    last at his role; the depth order by real usage then puts him where he plays."""
    slug = "real-" + "".join(ch if ch.isalnum() else "-" for ch in a["name"].lower()).strip("-")
    if any(p["slug"] == slug or (p["name"] == a["name"] and p["position"] == a["position"]) for p in t["players"]):
        return
    group = sorted((p for p in t["players"] if p.get("role") == a["role"]), key=depth_key)
    template = group[0] if group else next((p for p in t["players"] if p["position"] == a["position"]), None)
    # His ratings are the ones of the player at the top of his role: the team plays as
    # strong as it did, and the real player's line goes to the right name. (Rated as an
    # average FBS starter instead, the added quarterbacks lifted NIU from 1.5 to 2.1 sim
    # wins at week 8 against a real 0-6, and picks got worse.)
    attrs = {k: template[k] for k in ATTRS if template and isinstance(template.get(k), (int, float))} or {k: NEUTRAL for k in ATTRS}
    attrs["attributes"] = dict((template or {}).get("attributes") or {})   # ratings v2, from the same template
    p = {"name": a["name"], "slug": slug, "position": a["position"], "source_position": a["position"],
         "ovr": None, "class": None, "height": None, "weight": None, "jersey": None, "dev_trait": "Normal",
         **attrs, RETURN_ATTR: 30, "role": a["role"],
         "depth": max((q.get("depth") or 0 for q in group), default=0) + 1, "starter": False, "added": True}
    p["overall"] = player_overall(p)
    t["players"].append(p)


def pool_linebackers(t: dict, order: list[str], by_slug: dict) -> int:
    """Pick a team's linebacker starters from one usage order across SAM, MIKE and WILL
    (EA's starter count per role can leave its real leading tackler on the bench). Each
    linebacker's `order` is his place in that pool, which the engine plays by."""
    lbs = [p for p in t["players"] if p.get("role") in LB_ROLES]
    if not lbs:
        return 0
    n_start = sum(1 for p in lbs if p["starter"])
    for i, p in enumerate(usage_ranked(lbs, order, by_slug, LB_ROLES)):
        p["order"] = i + 1
        p["starter"] = i < n_start
    return 1


def move_specialist(t: dict, p: dict, pos: str, means: dict) -> int:
    """Make `p` the starting kicker (pos "K") or punter ("P"): his attributes are rebuilt for
    that spot from the source ratings, and both spots' depth charts close up behind the move."""
    old_role = p.get("role")
    if p["position"] == pos or "_src" not in p:
        return 0
    raw = map_player(p["_src"], pos)
    for a in ATTRS:
        p.pop(a, None)
    for a, v in raw.items():
        if a in ATTRS and isinstance(v, (int, float)):
            p[a] = clamp_rating(to_engine(v, means.get(f"{pos}:{a}", 50.0)))
    p["position"], p["role"] = pos, pos
    p["_attr_raw"] = rv2.raw_attributes(p["_src"]["ratings"], pos, pos)
    p["attributes"] = house_attributes_of(p)
    for role, first in ((pos, p), (old_role, None)):
        if role is None:
            continue
        rest = sorted((q for q in t["players"] if q.get("role") == role and q is not first), key=depth_key)
        for i, q in enumerate(([first] if first else []) + rest):
            q["depth"] = i + 1
            q["starter"] = i == 0
    return 1


def depth_sort(t: dict) -> None:
    """Put a team's roster in depth-chart order (the source lists are not), so the engine's
    list-order tie-breaks follow the depth chart: depth, then linebacker pool order, then the
    better player first."""
    t["players"].sort(key=lambda p: (p.get("depth") or 99, p.get("order") or 99, -(p.get("overall") or 0)))


def clamp_extremes(p: dict) -> None:
    """Hold normalized attributes inside sensible bounds (see CORE_SKILLS)."""
    if not CLAMP_EXTREMES:
        return
    core = CORE_SKILLS.get(p.get("position"), ())
    lo, hi = OFF_SKILL_RANGE
    for a in ATTRS:
        v = p.get(a)
        if not isinstance(v, (int, float)) or a in PHYSICAL and a not in core:
            continue
        if a in core:
            if (p.get("ovr") or 0) >= CORE_FLOOR_OVR and v < CORE_FLOOR:
                p[a] = CORE_FLOOR
        else:
            p[a] = max(lo, min(hi, v))


P4_CONFERENCES = {"ACC", "Big Ten", "Big 12", "SEC"}
ATTR_BELOW = 0.6          # below the Power 4 starter mean a standard deviation is worth 60% as much (season.BELOW)
USE_FROZEN = True         # game_scale.fit() builds once without the frozen scale, to measure it
ATTR_SCALE: dict[str, list[float]] = {}   # "group|attribute" -> [Power 4 starter mean, slope above, slope below]


def _attr_group(p: dict) -> str:
    """The scale group for a player's attributes (fullbacks are measured against the backs)."""
    g = rv2.card_group(p["position"], p.get("role"))
    return "RB" if g == "FB" else g


def attribute_scale(teams: list[dict]) -> dict:
    """Ratings v2: the house scale for every attribute at every position group, from the
    Power 4 starters (50 at the middle one, 15 a standard deviation above, 9 below)."""
    vals, p4 = defaultdict(list), defaultdict(list)
    for t in teams:
        if t["fictional"]:
            continue
        top = t["conference"] in P4_CONFERENCES or t["slug"] == "notre-dame"
        for p in t["players"]:
            for k, v in (p.get("_attr_raw") or {}).items():
                key = f"{_attr_group(p)}|{k}"
                vals[key].append(v)
                if top and p["starter"]:
                    p4[key].append(v)
    ATTR_SCALE.clear()
    if USE_FROZEN and game_scale.FILE.exists():   # the game's scale is frozen (game_scale.py): every season reads it the same
        ATTR_SCALE.update(game_scale.card_scale())
        return ATTR_SCALE
    for key, v in vals.items():
        ref = p4.get(key) if len(p4.get(key, [])) >= 10 else v
        sd = max(2.0, st.pstdev(ref)) if len(ref) > 1 else 6.0
        ATTR_SCALE[key] = [round(st.median(ref), 2), round(15 / sd, 4), round(15 / sd * ATTR_BELOW, 4)]
    return ATTR_SCALE


def house_attributes_of(p: dict) -> dict:
    """One player's attributes on the house scale (1-99)."""
    out = {}
    for k, v in (p.get("_attr_raw") or {}).items():
        m, hi, lo = ATTR_SCALE.get(f"{_attr_group(p)}|{k}", (v, 1.5, 0.9))
        out[k] = clamp_rating(50 + (v - m) * (hi if v >= m else lo))
    return out


def house_attributes(teams: list[dict]) -> None:
    attribute_scale(teams)
    for t in teams:
        for p in t["players"]:
            p["attributes"] = house_attributes_of(p)


def normalize(teams: list[dict], frozen: Optional[dict] = None) -> dict:
    """Re-centre every attribute per position group on the FBS starter mean: this build's own
    (the real 2026 rosters), or `frozen` ("POS:attr" -> mean; a career's later seasons read the
    real 2026 build's, so a league's talent and its depth charts show in the engine as they are)."""
    if frozen:
        means = {tuple(k.split(":", 1)): v for k, v in frozen.items()}
        return_mean = means.pop(("returners", RETURN_ATTR), 50.0)
        for t in teams:
            for p in t["players"]:
                for a in ATTRS:
                    if a in p:
                        p[a] = clamp_rating(to_engine(p[a], means.get((p["position"], a), 50.0)))
                p[RETURN_ATTR] = clamp_rating(to_engine(p[RETURN_ATTR], return_mean))
                clamp_extremes(p)
        return dict(frozen)
    groups = defaultdict(list)
    for t in teams:
        if t["fictional"]:
            continue
        for p in t["players"]:
            if p["starter"]:
                for a in ATTRS:
                    if a in p:
                        groups[(p["position"], a)].append(p[a])
    means = {k: st.mean(v) for k, v in groups.items()}
    returners = [p[RETURN_ATTR] for t in teams if not t["fictional"] for p in t["players"]
                 if p["slug"] in (t["kick_returner"], t["punt_returner"])]
    return_mean = st.mean(returners) if returners else 50.0
    for t in teams:
        for p in t["players"]:
            for a in ATTRS:
                if a in p:
                    p[a] = clamp_rating(to_engine(p[a], means.get((p["position"], a), 50.0)))
            p[RETURN_ATTR] = clamp_rating(to_engine(p[RETURN_ATTR], return_mean))
            clamp_extremes(p)
    means[("returners", RETURN_ATTR)] = return_mean
    return {f"{pos}:{a}": round(m, 1) for (pos, a), m in sorted(means.items())}


def team_level(teams: list[dict]) -> dict:
    """Diminishing returns at the top. A team's level is its starters' mean engine rating over
    NEUTRAL across the composites; above zero only TEAM_LEVEL_TOP_SCALE of it counts, and every
    player on the team moves down by the rest (the same amount, so who is better than whom on
    the roster does not change). Returns {slug: shift} in engine points."""
    shifts = {}
    for t in teams:
        vals = [p[a] - NEUTRAL for p in t["players"] if p["starter"] for a in ATTRS if isinstance(p.get(a), (int, float))]
        level = st.mean(vals) if vals else 0.0
        shift = -(1.0 - TEAM_LEVEL_TOP_SCALE) * level if level > 0 else 0.0
        t["level_shift"] = round(shift, 2)
        shifts[t["slug"]] = shift
        if shift:
            for p in t["players"]:
                for a in ATTRS:
                    if isinstance(p.get(a), (int, float)):
                        p[a] = clamp_rating(p[a] + shift)
    return shifts


ENGINE_POSITIONS = ["QB", "RB", "WR", "TE", "OL", "DL", "MLB", "CB", "S", "K", "P"]
CORE_SKILLS = {"QB": ("passing", "decision_making"), "RB": ("elusiveness", "vision"), "WR": ("hands", "route_running"), "TE": ("hands", "run_blocking"),
               "OL": ("run_blocking", "pass_blocking"), "DL": ("rushing", "tackling"), "MLB": ("tackling", "coverage"), "CB": ("coverage",),
               "S": ("coverage", "tackling"), "K": ("kick_power", "kick_accuracy"), "P": ("punt_power", "punt_accuracy")}


def player_overall(p: dict) -> int:
    """A display rating from the engine attributes that matter at the position (the same
    formula as season.player_overall)."""
    pos = p["position"]
    if pos == "K":
        primary, secondary = ["kick_power", "kick_accuracy"], []
    elif pos == "P":
        primary, secondary = ["punt_power", "punt_accuracy"], []
    elif pos == "QB":
        primary, secondary = ["passing", "decision_making", "intelligence"], ["speed", "elusiveness"]
    elif pos == "RB":
        primary, secondary = ["speed", "elusiveness", "vision", "strength"], ["hands", "pass_blocking"]
    elif pos in ("WR", "TE"):
        primary, secondary = ["hands", "route_running", "speed"], ["run_blocking", "elusiveness"]
    elif pos == "OL":
        primary, secondary = ["run_blocking", "pass_blocking", "strength"], ["intelligence"]
    elif pos == "DL":
        primary, secondary = ["rushing", "tackling", "strength"], ["intelligence", "speed"]
    elif pos in ("MLB", "ROLB", "LOLB"):
        primary, secondary = ["tackling", "rushing", "coverage", "speed"], ["intelligence"]
    else:
        primary, secondary = ["coverage", "speed", "tackling"], ["intelligence", "hands"]
    total = count = 0
    for k in primary:
        if isinstance(p.get(k), (int, float)):
            total += p[k] * 3
            count += 3
    for k in secondary:
        if isinstance(p.get(k), (int, float)):
            total += p[k]
            count += 1
    return round(total / count) if count else 0


def ratings_at_every_position(teams: list[dict], means: dict) -> None:
    """Give every player a rating at every engine position: his source ratings run through
    that position's attribute formulas, normalized with that position's starter means,
    then scored like a native player. Linebacker roles share the MLB rating."""
    for t in teams:
        for m in t["players"]:
            src = m.pop("_src", None)
            if src is None:              # an added real player: no source card to convert
                m["ratings_at"] = {pos: (m["overall"] if pos == m["position"] else 16) for pos in ENGINE_POSITIONS}
                m["ratings_at"]["KR"] = m[RETURN_ATTR]
                continue
            out = {}
            for pos in ENGINE_POSITIONS:
                raw = map_player(src, pos)
                attrs = {}
                for a, v in raw.items():
                    if a in ATTRS and isinstance(v, (int, float)):
                        mean = means.get(f"{pos}:{a}", 50.0)
                        attrs[a] = clamp_rating(to_engine(v, mean) + t.get("level_shift", 0.0))
                attrs["position"] = pos
                rating = player_overall(attrs)
                if pos != m["position"]:
                    # away from his own position a player is no better than his weakest core skill allows
                    core = [attrs[a] for a in CORE_SKILLS.get(pos, ()) if a in attrs]
                    if core:
                        rating = min(rating, min(core) + 15)
                out[pos] = rating
            out["KR"] = m[RETURN_ATTR]
            m["ratings_at"] = out


def measured_recruiting(teams: list[dict]) -> int:
    """Rebuild each head coach's recruiting rating from how he has really recruited: his measured
    edge (recruiting_model.json coaches.current), shrunk toward average for coaches with few
    classes. The source ratings are generated and do not track it (r -0.02 across 78 coaches).
    Coaches with no measured edge keep theirs. Returns how many were rebuilt."""
    from coach_career import recruits
    current = recruits.model()["coaches"]["current"]
    n = 0
    for t in teams:
        c = current.get(t["slug"])
        if not c or c.get("edge") is None:
            continue
        shrunk = c["edge"] * c["classes"] / (c["classes"] + 3)
        t["coaches"]["head_coach"]["ratings"]["recruiting"] = max(30, min(95, round(50 + 40 * shrunk / 0.25)))
        n += 1
    return n


def engine_roster(t: dict) -> tuple[list[dict], list[dict]]:
    """Split a converted team into the engine's offense and defense player lists."""
    offense, defense = [], []
    for p in t["players"]:
        d = {k: v for k, v in p.items() if k not in ("starter", "overall", "source_position", "_attr_raw")}
        d["in_game"] = p["starter"]
        d["fatigue"] = 0
        if p["position"] in OFFENSE:
            d["stats"] = {k: 0 for k in OFF_STATS + SHARED_STATS}
            offense.append(d)
        else:
            d["stats"] = {k: 0 for k in DEF_STATS + SHARED_STATS}
            defense.append(d)
    return offense, defense


def build(sources: list[dict], real: bool = True, observed: Optional[set] = None, quiet: bool = False,
          styles: Optional[dict] = None) -> dict:
    """The engine's teams file from source-format teams. `real`: the real 2026 data's own
    adjustments (depth by real usage, rating nudges, coaches' measured recruiting); a career's
    later seasons build without them. `observed`: the teams whose observed 2026 tendencies still
    apply (None: all of them; a career drops a team's when its head coach changes)."""
    say = (lambda *a: None) if quiet else print
    teams = [team_from_source(t) for t in sources]
    means = normalize(teams, None if real else game_scale.engine_means())
    shifts = team_level(teams)
    moved = [v for v in shifts.values() if v]
    say(f"team level: {len(moved)} teams above the FBS starter average shifted "
        f"{min(shifts.values()):.1f} to {max(moved) if moved else 0:.1f} engine points (top scale {TEAM_LEVEL_TOP_SCALE})")
    house_attributes(teams)
    nudged, reordered = apply_real_adjustments(teams, means) if real else (0, 0)
    manual_applied = apply_manual_ratings(teams) if real else 0
    for t in teams:
        depth_sort(t)
    house_attributes(teams)                     # again, from today's starters (the real depth charts moved some)
    if nudged or reordered:
        say(f"real 2026 adjustments: {reordered} depth-chart roles reordered" + (f", {nudged} players' ratings nudged" if nudged else ""))
    ratings_at_every_position(teams, means)
    tendency_means = normalize_tendencies(teams)
    decouple_discipline(teams)
    say("league tendency means before centring:", tendency_means)
    say("teams with observed 2026 tendencies:", apply_observed_tendencies(teams, only=observed, styles=styles))
    if real:
        say("head coaches' recruiting ratings from their measured edge:", measured_recruiting(teams))
    out = {"source": str(SRC), "neutral": NEUTRAL, "spread_scale": SPREAD_SCALE, "team_level_top_scale": TEAM_LEVEL_TOP_SCALE,
           "manual_ratings_applied": manual_applied,
           "starter_means_before_normalization": means, "tendency_means": tendency_means,
           "attribute_scale": dict(ATTR_SCALE), "teams": {}}
    for t in teams:
        offense, defense = engine_roster(t)
        rec = {k: v for k, v in t.items() if k != "players"}
        rec["offense"] = offense
        rec["defense"] = defense
        out["teams"][t["slug"]] = rec
    return out


def main() -> None:
    paths = sorted((SRC / "teams").glob("*.json"))
    out = build([json.loads(p.read_text(encoding="utf-8")) for p in paths])
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(out), encoding="utf-8")
    print(f"wrote {OUT} with {len(out['teams'])} teams ({OUT.stat().st_size / 1e6:.1f} MB)")
    from coach_career import recruits                                  # potential and coachability (docs/PLAYER_DEVELOPMENT.md)
    print(f"wrote {recruits.POTENTIAL_FILE.name}: potential and coachability for {recruits.write_player_potential()} players")


if __name__ == "__main__":
    if len(sys.argv) > 1:
        SPREAD_SCALE = float(sys.argv[1])
    main()
