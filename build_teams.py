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
"""
from __future__ import annotations

import json
import statistics as st
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "cfb_sim_data"
OUT = ROOT / "data" / "engine_teams.json"

NEUTRAL = 55          # engine reference rating (engine/game_config.py)
SPREAD_SCALE = 1.50   # rating points of spread kept per source point; tuned in calibrate_season.py and tools/realism.py

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


def avg(r: dict, *keys: str, default: float = 50.0) -> float:
    vals = [r[k] for k in keys if isinstance(r.get(k), (int, float))]
    return sum(vals) / len(vals) if vals else default


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
        # EA's own overall, before the source data's curve: the player card's overall comes
        # from it (season.ea_house). The engine never reads it.
        "ea_overall": p.get("overall_ea"),
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


def starter_slugs(team: dict) -> set[str]:
    out = set()
    for unit in ("offense", "defense"):
        for slugs in team["starters"][unit].values():
            out.update(slugs)
    return out


def load_team(path: Path) -> dict:
    t = json.loads(path.read_text(encoding="utf-8"))
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
        # the engine finds K and P among in-game offense players
        if m["position"] == "K":
            m["starter"] = p["slug"] in st_special.get("K", [])
        if m["position"] == "P":
            m["starter"] = p["slug"] in st_special.get("P", [])
        players.append(m)
    hc, oc, dc = t["coaches"]["head_coach"], t["coaches"]["offensive_coordinator"], t["coaches"]["defensive_coordinator"]
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
        },
        "slug": t["slug"],
        "name": t["short_name"],
        "school": t["school_name"],
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
            "head_coach": {"name": hc["name"], "ratings": hc["ratings"], "tendencies": hc["tendencies"], "scheme": hc["scheme"]},
            "offensive_coordinator": {"name": oc.get("name"), "ratings": oc["ratings"], "tendencies": oc["tendencies"], "scheme": oc["scheme"]},
            "defensive_coordinator": {"name": dc.get("name"), "ratings": dc["ratings"], "tendencies": dc["tendencies"], "scheme": dc["scheme"]},
        },
        "players": players,
    }


TENDENCY_KEYS = ("pass_rate", "tempo", "fourth_down_go_rate", "blitz_rate", "oc_play_calling", "dc_play_calling")


def normalize_tendencies(teams: list[dict]) -> dict:
    """Centre the generated coach tendencies so the FBS average is 50 (the engine's
    neutral), keeping each team's distance from the pack. Service academies stay run-heavy."""
    means = {}
    for key in TENDENCY_KEYS:
        vals = [t["tendencies"][key] for t in teams if not t["fictional"]]
        means[key] = st.mean(vals)
        for t in teams:
            t["tendencies"][key] = int(round(max(0, min(100, 50 + t["tendencies"][key] - means[key]))))
    return {k: round(v, 1) for k, v in means.items()}


OBSERVED = ROOT / "data" / "observed_tendencies.json"


def apply_observed_tendencies(teams: list[dict]) -> int:
    """Replace generated coach tendencies with what each team has actually done in 2026
    (derive_tendencies.py), scaled to the engine's tendency effects. Teams without box
    scores keep the generated values."""
    if not OBSERVED.exists():
        return 0
    obs = json.loads(OBSERVED.read_text(encoding="utf-8"))
    league, per_team = obs["league"], obs["teams"]
    n = 0
    for t in teams:
        o = per_team.get(t["slug"])
        if not o or o["games"] < 2:
            continue
        td = t["tendencies"]
        td["pass_rate"] = int(round(max(0, min(100, 50 + 1.67 * (o["pass_rate"] - league["pass_rate"])))))
        td["tempo"] = int(round(max(0, min(100, 50 + 3.0 * (o["plays_per_game"] - league["plays_per_game"])))))
        ratio = o["fourth_att_per_game"] / max(0.1, league["fourth_att_per_game"])
        td["fourth_down_go_rate"] = int(round(max(0, min(100, 50 + (ratio - 1) * 125))))
        # Observed QB rushes include sacks (college convention) and scrambles; designed runs are the rest.
        td["qb_run_share"] = round(max(0.0, o["qb_rush_share"] - 6.0 - 4.0), 1)
        td["observed"] = True
        n += 1
    return n


REAL_ADJUSTMENTS = ROOT / "data" / "real_adjustments.json"


LB_ROLES = ("SAM", "MIKE", "WILL")
LB_POOL = "LB_POOL"             # tools/tune_from_real.py: every linebacker by real usage, across the three roles
SPECIALISTS = "SPECIALISTS"     # tools/tune_from_real.py: {"K" or "P": slug} for a specialist listed at the other spot


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
                    p[attr] = int(round(max(1, min(99, p[attr] + d))))
            nudged += 1
        changes = (adj.get("depth") or {}).get(t["slug"], {})
        for role, order in changes.items():
            if role in (LB_POOL, SPECIALISTS):
                continue
            group = [p for p in t["players"] if p.get("role") == role]
            if not group:
                continue
            n_start = sum(1 for p in group if p["starter"])
            ranked = [by_slug[s] for s in order if s in by_slug and by_slug[s].get("role") == role]
            ranked += [p for p in sorted(group, key=lambda p: p.get("depth") or 99) if p not in ranked]
            for i, p in enumerate(ranked):
                p["depth"] = i + 1
                p["starter"] = i < n_start
            reordered += 1
        if changes.get(LB_POOL):
            reordered += pool_linebackers(t, changes[LB_POOL], by_slug)
        for pos, slug in (changes.get(SPECIALISTS) or {}).items():
            if slug in by_slug:
                reordered += move_specialist(t, by_slug[slug], pos, means)
    return nudged, reordered


def pool_linebackers(t: dict, order: list[str], by_slug: dict) -> int:
    """Pick a team's linebacker starters from one usage order across SAM, MIKE and WILL
    (EA's starter count per role can leave its real leading tackler on the bench). Each
    linebacker's `order` is his place in that pool, which the engine plays by."""
    lbs = [p for p in t["players"] if p.get("role") in LB_ROLES]
    if not lbs:
        return 0
    n_start = sum(1 for p in lbs if p["starter"])
    ranked = [by_slug[s] for s in order if s in by_slug and by_slug[s].get("role") in LB_ROLES]
    ranked += [p for p in sorted(lbs, key=lambda p: p.get("depth") or 99) if p not in ranked]
    for i, p in enumerate(ranked):
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
            p[a] = int(round(max(1, min(99, NEUTRAL + (v - means.get(f"{pos}:{a}", 50.0)) * SPREAD_SCALE))))
    p["position"], p["role"] = pos, pos
    for role, first in ((pos, p), (old_role, None)):
        if role is None:
            continue
        rest = sorted((q for q in t["players"] if q.get("role") == role and q is not first), key=lambda q: q.get("depth") or 99)
        for i, q in enumerate(([first] if first else []) + rest):
            q["depth"] = i + 1
            q["starter"] = i == 0
    return 1


def depth_sort(t: dict) -> None:
    """Put a team's roster in depth-chart order (the source lists are not), so the engine's
    list-order tie-breaks follow the depth chart: depth, then linebacker pool order, then the
    better player first."""
    t["players"].sort(key=lambda p: (p.get("depth") or 99, p.get("order") or 99, -(p.get("overall") or 0)))


def normalize(teams: list[dict]) -> dict:
    """Re-centre every attribute per position group on the FBS starter mean."""
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
                    m = means.get((p["position"], a), 50.0)
                    p[a] = int(round(max(1, min(99, NEUTRAL + (p[a] - m) * SPREAD_SCALE))))
            p[RETURN_ATTR] = int(round(max(1, min(99, NEUTRAL + (p[RETURN_ATTR] - return_mean) * SPREAD_SCALE))))
    means[("returners", RETURN_ATTR)] = return_mean
    return {f"{pos}:{a}": round(m, 1) for (pos, a), m in sorted(means.items())}


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
            src = m.pop("_src")
            out = {}
            for pos in ENGINE_POSITIONS:
                raw = map_player(src, pos)
                attrs = {}
                for a, v in raw.items():
                    if a in ATTRS and isinstance(v, (int, float)):
                        mean = means.get(f"{pos}:{a}", 50.0)
                        attrs[a] = int(round(max(1, min(99, NEUTRAL + (v - mean) * SPREAD_SCALE))))
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


def engine_roster(t: dict) -> tuple[list[dict], list[dict]]:
    """Split a converted team into the engine's offense and defense player lists."""
    offense, defense = [], []
    for p in t["players"]:
        d = {k: v for k, v in p.items() if k not in ("starter", "overall", "source_position")}
        d["in_game"] = p["starter"]
        d["fatigue"] = 0
        if p["position"] in OFFENSE:
            d["stats"] = {k: 0 for k in OFF_STATS + SHARED_STATS}
            offense.append(d)
        else:
            d["stats"] = {k: 0 for k in DEF_STATS + SHARED_STATS}
            defense.append(d)
    return offense, defense


def main() -> None:
    paths = sorted((SRC / "teams").glob("*.json"))
    teams = [load_team(p) for p in paths]
    means = normalize(teams)
    nudged, reordered = apply_real_adjustments(teams, means)
    for t in teams:
        depth_sort(t)
    if nudged or reordered:
        print(f"real 2026 adjustments: {reordered} depth-chart roles reordered" + (f", {nudged} players' ratings nudged" if nudged else ""))
    ratings_at_every_position(teams, means)
    tendency_means = normalize_tendencies(teams)
    print("league tendency means before centring:", tendency_means)
    print("teams with observed 2026 tendencies:", apply_observed_tendencies(teams))
    out = {"source": str(SRC), "neutral": NEUTRAL, "spread_scale": SPREAD_SCALE,
           "starter_means_before_normalization": means, "tendency_means": tendency_means, "teams": {}}
    for t in teams:
        offense, defense = engine_roster(t)
        rec = {k: v for k, v in t.items() if k != "players"}
        rec["offense"] = offense
        rec["defense"] = defense
        out["teams"][t["slug"]] = rec
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(out), encoding="utf-8")
    print(f"wrote {OUT} with {len(teams)} teams ({OUT.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    if len(sys.argv) > 1:
        SPREAD_SCALE = float(sys.argv[1])
    main()
