"""A Coach Career's own league, from its second season on
(docs/superpowers/specs/2026-10-23-career-offseason-design.md, section 2).

The first season of a career plays the real 2026 rosters (data/engine_teams.json). At its first
offseason the career takes a copy of every FBS roster into `state["league"]`, and from then on
players leave, transfer, sign and develop there. Each season the league is turned back into the
source format (cfb_sim_data/teams/*.json) and built by the same pipeline as the real data
(build_teams.build), cached per career and year in data/leagues/ and rebuilt from the state
whenever the cache is missing (a save loaded on another machine).

    state["league"] = {"year": 2027, "attrs": [the game's 54 skills], "scale": "ours",
                       "teams": {slug: {"roster": [player], "coaches": {...}, "formation": {...}, "style": slug}}}

A player, compact, on our scale only (game_scale.py: 1-99, 50 the middle Power 4 starter at the
position; his overall is our formula on these):
    {"id": slug, "n": name, "pos": position (LT, MIKE, ...), "cls": FR..SRRS, "ht": inches, "wt": lbs, "j": jersey,
     "a": archetype, "dev": trait, "ab": ["name|tier"], "r": [ratings], "g": [room to potential], "c": coachability,
     "s": stars, "o": our overall (kept in step with the ratings), "home": state, "yrs": seasons in the program,
     "tm": target share (real receivers)}
The real 2026 players are converted once, when the career takes its league; nothing reads EA after that.
The FCS stand-ins (fictional teams) always play their base rosters.
"""
from __future__ import annotations

import json
import math
import os
import random
import statistics as st
from functools import lru_cache
from pathlib import Path
from typing import Optional

from teamdata import game_scale
from coach_career import recruits

ROOT = Path(__file__).resolve().parents[1]   # the project root
SOURCE_DIR = ROOT / "cfb_sim_data" / "teams"
CACHE_DIR = ROOT / "data" / "leagues"
FIRST_YEAR = 2026
# The coaches' own judgment in a depth chart, in overall points (one draw per player a year): real
# 2026 usage starts players well below the top overall at most positions (rotations, fits, what
# the ratings miss) but the best linemen up front. Set so that the real 2026 rosters' starters
# picked this way have the overall the real starters had, group by group.
DEPTH_EYE = {"QB": 8.0, "RB": 16.0, "WR": 13.0, "TE": 16.0, "OL": 1.5, "DL": 15.0, "LB": 12.0, "DB": 15.0, "K": 3.0, "P": 3.0}
DEPTH_EXPERIENCE = 0.0    # overall points a year in college is worth in a depth chart (real coaches start the veteran)
_EYE_GROUP = {"QB": "QB", "HB": "RB", "FB": "RB", "WR": "WR", "TE": "TE", "LT": "OL", "LG": "OL", "C": "OL", "RG": "OL", "RT": "OL",
              "LEDG": "DL", "REDG": "DL", "DT": "DL", "SAM": "LB", "MIKE": "LB", "WILL": "LB", "CB": "DB", "FS": "DB", "SS": "DB", "K": "K", "P": "P"}
TARGET_EYE = 0.32         # log target weight per standard deviation of the coaches' eye (real 2026 target weights: sd 0.32)
TARGET_SPREAD = 0.4       # log target weight off per 10 overall points above the team's receivers (the ratings' pull on targets is steep)
EXPERIENCE = {"FR": 0, "FRRS": 1, "SO": 1, "SORS": 2, "JR": 2, "JRRS": 3, "SR": 3, "SRRS": 4}

CLASSES = ("FR", "FRRS", "SO", "SORS", "JR", "JRRS", "SR", "SRRS")
CLASS_YEAR = {"FR": "Freshman", "FRRS": "Freshman (RS)", "SO": "Sophomore", "SORS": "Sophomore (RS)",
              "JR": "Junior", "JRRS": "Junior (RS)", "SR": "Senior", "SRRS": "Senior (RS)"}
# EA position groups a depth-chart role borrows from when its own position runs short
FALLBACK = {"LT": ("RT", "LG", "RG", "C"), "RT": ("LT", "RG", "LG", "C"), "LG": ("RG", "C", "LT", "RT"),
            "RG": ("LG", "C", "RT", "LT"), "C": ("LG", "RG", "LT", "RT"), "LEDG": ("REDG", "DT"), "REDG": ("LEDG", "DT"),
            "DT": ("LEDG", "REDG"), "LB": ("MIKE", "WILL", "SAM"), "CB": ("FS", "SS"), "FS": ("SS", "CB"), "SS": ("FS", "CB"),
            "HB": ("FB", "WR"), "FB": ("HB", "TE"), "WR": ("TE", "HB"), "TE": ("WR", "FB"), "QB": (), "K": ("P",), "P": ("K",)}
LB_ROLES = ("SAM", "MIKE", "WILL")
OFFENSE_ROLES = {"QB", "HB", "FB", "WR", "TE", "LT", "LG", "C", "RG", "RT"}
# team ratings from the starters' overall (ours), fit once to the 2026 team ratings (r 0.98 offense, 0.997 defense)
TEAM_FIT = {"offense": (0.8936, 16.227), "defense": (0.9095, 12.899), "special_teams": (0.8058, 15.1)}
GROUP_OF = {"QB": "QB", "HB": "RB", "FB": "RB", "WR": "WR", "TE": "TE", "LT": "OL", "LG": "OL", "C": "OL", "RG": "OL",
            "RT": "OL", "LEDG": "DL", "REDG": "DL", "DT": "DL", "SAM": "LB", "MIKE": "LB", "WILL": "LB", "CB": "DB",
            "FS": "DB", "SS": "DB", "K": "K", "P": "P"}


@lru_cache(maxsize=None)
def base_team(slug: str) -> dict:
    """The real 2026 source team (read once; never changed)."""
    return json.loads((SOURCE_DIR / f"{slug}.json").read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def base_slugs() -> tuple[str, ...]:
    return tuple(sorted(p.stem for p in SOURCE_DIR.glob("*.json")))


@lru_cache(maxsize=1)
def _potentials() -> dict:
    return json.loads(recruits.POTENTIAL_FILE.read_text(encoding="utf-8")) if recruits.POTENTIAL_FILE.exists() else {}


def height_in(h) -> Optional[int]:
    if isinstance(h, int):
        return h
    try:
        ft, inch = str(h).replace('"', "").split("'")
        return int(ft) * 12 + int(inch or 0)
    except (ValueError, AttributeError):
        return None


def compact(p: dict, attrs: list[str], home: Optional[str] = None) -> dict:
    """A player in the league's form. `p` is a real 2026 source player (his base ratings are
    converted to ours once; his seeded potential likewise), or carries our ratings already as
    "ours" and "potential_ours" (signees, walk-ons, transfers from lower levels)."""
    pos = p["position"]
    if p.get("ours") is not None:
        ours, pot = p["ours"], p.get("potential_ours") or p["ours"]
    else:
        ours = game_scale.ours_from_base(p["ratings"], pos)
        seeded = _potentials().get(p["slug"], {}).get("potential_ea") or {}
        pot = game_scale.from_ea({**p["ratings_ea"], **seeded}, pos) if seeded else ours
    seeded = _potentials().get(p["slug"], {})
    out = {"id": p["slug"], "n": p["name"], "pos": pos, "cls": p.get("class") or "FR", "ht": height_in(p.get("height")),
           "wt": p.get("weight_lbs"), "j": p.get("jersey"), "a": p.get("archetype"), "dev": p.get("dev_trait") or "Normal",
           "r": [int(ours.get(k, 50)) for k in attrs],
           "g": [int(max(0, pot.get(k, 50) - ours.get(k, 50))) for k in attrs],
           "c": p.get("coachability") or seeded.get("coachability") or "Steady Grinder",
           "s": p.get("stars") or seeded.get("stars"), "o": game_scale.overall(ours, pos),
           "home": (p.get("hometown") or {}).get("state") or home, "yrs": int(p.get("yrs") or 0)}
    if p.get("abilities"):
        out["ab"] = [f"{a.get('name')}|{a.get('tier')}" for a in p["abilities"]]
    if p.get("target_mult"):
        out["tm"] = p["target_mult"]
    return out


def ratings(c: dict, attrs: list[str]) -> dict[str, int]:
    return dict(zip(attrs, c["r"]))


def potential(c: dict, attrs: list[str]) -> dict[str, int]:
    return {k: v + g for k, v, g in zip(attrs, c["r"], c["g"])}


def overall(c: dict, attrs: list[str]) -> int:
    """His overall: our formula on his ratings (game_scale.overall)."""
    return game_scale.overall(ratings(c, attrs), c["pos"])


def expand(c: dict, attrs: list[str], team: dict) -> dict:
    """A league player in the source roster format build_teams reads: our ratings back through the
    frozen scale into the base values the engine's formulas were tuned on, and our overall."""
    ours = ratings(c, attrs)
    h = c.get("ht") or 72
    ovr = game_scale.overall(ours, c["pos"])
    return {
        "slug": c["id"], "name": c["n"], "position": c["pos"], "class": c["cls"], "class_year": CLASS_YEAR.get(c["cls"], "Freshman"),
        "team_slug": team["slug"], "team": team.get("short_name"), "jersey": c.get("j"),
        "height": f"{h // 12}'{h % 12}\"", "weight_lbs": c.get("wt"), "archetype": c.get("a"), "dev_trait": c.get("dev") or "Normal",
        "ovr": ovr, "overall": ovr, "ratings": game_scale.base_from_ours(ours, c["pos"]), "skills": list(c["r"]),
        "abilities": [dict(zip(("name", "tier"), a.split("|"))) for a in c.get("ab") or []],
        "coachability": c.get("c"), "stars": c.get("s"),
        **({"target_mult": c["tm"]} if c.get("tm") else {}),
    }


def formation(t: dict) -> dict:
    """How many starters each role has in a source team's lineup (its scheme), e.g. WR 3, LB 2, CB 3."""
    return {unit: {role: len(slugs or []) for role, slugs in roles.items()} for unit, roles in t["starters"].items()}


def from_base(year: int = FIRST_YEAR + 1) -> dict:
    """Every FBS team's real 2026 roster, coaches and lineup shape as a league (before the first
    offseason's departures). Head coaches keep the recruiting ratings the build measured."""
    from teamdata import build_teams
    attrs = game_scale.keys()
    usage = _real_usage()            # receivers' real target shares (the lead-back use goes with the style, source_team)
    teams = {}
    for slug in base_slugs():
        t = base_team(slug)
        if t["fictional"]:
            continue
        coaches = json.loads(json.dumps(t["coaches"]))
        tm = (usage.get(slug) or {}).get("targets") or {}
        teams[slug] = {"roster": [compact({**p, "target_mult": tm.get(p["slug"])}, attrs, t.get("state")) for p in t["roster"] if p.get("ratings")],
                       "coaches": coaches, "formation": formation(t)}
    build_teams.measured_recruiting([{"slug": s, "coaches": v["coaches"]} for s, v in teams.items()])
    return {"year": year, "attrs": attrs, "scale": "ours", "teams": teams}


def _real_usage() -> dict:
    """The real 2026 usage (data/real_adjustments.json): receivers' target shares, each team's lead-back use."""
    f = ROOT / "data" / "real_adjustments.json"
    return json.loads(f.read_text(encoding="utf-8")).get("usage", {}) if f.exists() else {}


def _role_players(by_pos: dict, role: str, taken: set, n: int) -> list[dict]:
    """A role's starters: its own position's best first (linebackers: the best MIKE, WILL and SAM
    in that order, then the best of the rest), then a neighbouring position's."""
    if role == "LB":
        picks = []
        for r in ("MIKE", "WILL", "SAM")[:n]:
            best = next((p for p in by_pos.get(r, []) if p["slug"] not in taken and p not in picks), None)
            if best:
                picks.append(best)
        rest = sorted((p for r in LB_ROLES for p in by_pos.get(r, []) if p["slug"] not in taken and p not in picks), key=lambda p: -p["_depth"])
        picks += rest
    else:
        picks = [p for p in by_pos.get(role, []) if p["slug"] not in taken]
    for r in FALLBACK.get(role, ()):
        picks += [p for p in by_pos.get(r, []) if p["slug"] not in taken and p not in picks]
    return picks[:n]


def lineup(roster: list[dict], shape: dict, year: int = FIRST_YEAR + 1) -> tuple[dict, dict]:
    """(starters, depth chart) in the source format: each role's best by EA overall (the
    linebacker spots from SAM, MIKE and WILL together), borrowing a neighbouring position when
    a role runs short; kick and punt returners by return ability."""
    by_pos: dict[str, list] = {}
    for p in roster:            # the coaches' eye: overall plus a little of what the numbers miss, fixed for the year
        p["_depth"] = (p["ovr"] + DEPTH_EXPERIENCE * EXPERIENCE.get(p.get("class"), 0)
                       + random.Random(f"depth-{p['slug']}-{year}").gauss(0, DEPTH_EYE.get(_EYE_GROUP.get(p["position"], "K"), 3.0)))
    for p in sorted(roster, key=lambda q: -q["_depth"]):
        by_pos.setdefault(p["position"], []).append(p)
    depth = {role: [p["slug"] for p in by_pos.get(role, [])] for role in
             ("QB", "HB", "FB", "WR", "TE", "LT", "LG", "C", "RG", "RT", "LEDG", "DT", "REDG", "SAM", "MIKE", "WILL", "CB", "FS", "SS", "K", "P")}
    starters, taken = {}, set()
    for unit in ("offense", "defense"):
        starters[unit] = {}
        for role, n in shape.get(unit, {}).items():
            picks = _role_players(by_pos, role, taken, n)
            taken.update(p["slug"] for p in picks)
            starters[unit][role] = [p["slug"] for p in picks]
    special = {}
    for role in ("K", "P"):
        if shape.get("special_teams", {}).get(role):
            pick = (by_pos.get(role) or by_pos.get("P" if role == "K" else "K") or [None])[0]
            special[role] = [pick["slug"]] if pick else []
    ret = sorted((p for p in roster if p["position"] in ("HB", "WR", "CB", "FS", "SS")),
                 key=lambda p: -(0.5 * p["ratings"].get("kick_return", 40) + 0.3 * p["ratings"].get("speed", 60)
                                 + 0.2 * p["ratings"].get("agility", 60)))
    special["KR"] = [ret[0]["slug"]] if ret else []
    special["PR"] = [ret[1]["slug"] if len(ret) > 1 else ret[0]["slug"]] if ret else []
    starters["special_teams"] = special
    for p in roster:
        p.pop("_depth", None)
    return starters, depth


def team_ratings(roster: list[dict], starters: dict) -> dict:
    """Team ratings from the starters' overall (TEAM_FIT), with the position groups' starters' mean overall."""
    by = {p["slug"]: p for p in roster}
    out = {}
    for unit, key in (("offense", "offense"), ("defense", "defense"), ("special_teams", "special_teams")):
        vals = [by[s]["ovr"] for role, slugs in starters[unit].items() if role not in ("KR", "PR") for s in slugs if s in by]
        a, b = TEAM_FIT[key]
        out[key] = round(max(1.0, min(99.0, a * st.mean(vals) + b)) if vals else 40.0, 1)
    out["overall"] = round(0.45 * out["offense"] + 0.45 * out["defense"] + 0.1 * out["special_teams"], 1)
    out["roster_avg"] = round(st.mean(p["ovr"] for p in roster), 1) if roster else 0.0
    groups: dict[str, list] = {}
    for unit in ("offense", "defense"):
        for role, slugs in starters[unit].items():
            for s in slugs:
                if s in by:
                    groups.setdefault(GROUP_OF.get(by[s]["position"], "DB"), []).append(by[s]["ovr"])
    for role in ("K", "P"):
        for s in starters["special_teams"].get(role, []):
            groups.setdefault(role, []).append(by[s]["ovr"])
    out["position_groups"] = {g: round(st.mean(v), 1) for g, v in groups.items()}
    return out


def source_team(league: dict, slug: str) -> dict:
    """One league team in the source format: the base team's identity, the league's roster,
    coaches and a lineup picked from the roster."""
    base = base_team(slug)
    entry = league["teams"][slug]
    roster = [expand(c, league["attrs"], base) for c in entry["roster"]]
    starters, depth = lineup(roster, entry["formation"], league["year"])
    on_field = {s for role in ("WR", "TE") for s in starters["offense"].get(role, [])}
    mean = st.mean([p["ovr"] for p in roster if p["slug"] in on_field] or [50])
    for p in roster:            # what the coaches see in a receiver they also throw him the ball for (real 2026 usage's spread),
        if p["position"] in ("WR", "TE") and "target_mult" not in p:     # and the ball spread around (TARGET_SPREAD)
            z = random.Random(f"depth-{p['slug']}-{league['year']}").gauss(0, 1)
            p["target_mult"] = round(min(2.0, max(0.5, math.exp(TARGET_EYE * z - TARGET_SPREAD * (p["ovr"] - mean) / 10))), 3)
    out = {k: v for k, v in base.items() if k not in ("roster", "starters", "depth_chart", "coaches", "team_ratings", "verification")}
    style = entry.get("style", slug)                                 # the real program whose 2026 style the staff plays
    lead = (_real_usage().get(style) or {}).get("rb_lead_feature")
    if lead is not None:
        out["rb_lead_feature"] = lead
    out.update(roster=roster, starters=starters, depth_chart=depth, coaches=entry["coaches"],
               team_ratings=team_ratings(roster, starters), roster_size=len(roster))
    return out


def source_teams(league: dict) -> list[dict]:
    return [source_team(league, s) if s in league["teams"] else base_team(s) for s in base_slugs()]


def build(league: dict) -> dict:
    """The league as the engine's teams file (build_teams.build, without the real 2026 adjustments)."""
    from teamdata import build_teams
    styles = {s: t.get("style", s) for s, t in league["teams"].items()}
    return build_teams.build(source_teams(league), real=False, quiet=True, styles=styles)


def path(career_id: str, year: int) -> Path:
    return CACHE_DIR / f"{career_id}-{year}.json"


def ensure_built(state: dict) -> Optional[Path]:
    """The teams file a career's current season plays (None: the real 2026 one), built if missing.
    In the offseason the league already holds next year's rosters; a missing file for the season
    just played is then rebuilt from them (only a save moved to another machine gets there)."""
    lg = state.get("league")
    year = state.get("year") or FIRST_YEAR
    if not lg or year <= FIRST_YEAR:
        return None
    out = path(state["id"], year)
    if not out.exists():
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        tmp = out.with_suffix(f".{os.getpid()}.tmp")
        tmp.write_text(json.dumps(build(lg)), encoding="utf-8")
        os.replace(tmp, out)
    return out


def forget(career_id: str) -> None:
    """Remove a career's cached teams files (the career was deleted)."""
    for f in CACHE_DIR.glob(f"{career_id}-*.json"):
        try:
            f.unlink()
        except OSError:
            pass
