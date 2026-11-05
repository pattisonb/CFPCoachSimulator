"""The league as a file (docs/superpowers/specs/2026-11-05-league-file-design.md): the built-in league
exported losslessly in the "cfp-league/1" format, so an import that leaves a team alone keeps exactly
what the game has. The FCS stand-ins and their conference are never written (league.base_meta's
"fictional" flag says which they are)."""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

from coach_career import league, recruiting
from teamdata import game_scale

FORMAT = "cfp-league/1"
NAME = "Built-in League"
YEAR = league.FIRST_YEAR
LEVEL = "FBS"
_COACH_ROLES = (("head", "head_coach"), ("oc", "offensive_coordinator"), ("dc", "defensive_coordinator"))
_FILE_POS = {"HB": "RB"}                       # the file's position words; the game calls a running back HB
_GAME_POS = {v: k for k, v in _FILE_POS.items()}


def conference_id(name: str) -> str:
    """A conference's id: lowercase, runs of non-alphanumerics as one dash."""
    return re.sub(r"[^a-z0-9]+", "-", str(name).lower()).strip("-")


def player_doc(c: dict, attrs: list[str]) -> dict:
    """A league player (league.compact's form) in file form."""
    out = {"id": c["id"], "name": c["n"], "pos": _FILE_POS.get(c["pos"], c["pos"]), "class": c["cls"], "overall": c["o"]}
    if c.get("s") is not None:
        out["stars"] = c["s"]
    out["ratings"] = league.ratings(c, attrs)
    out["potential"] = {k: v for k, v, g in zip(attrs, league.potential(c, attrs).values(), c["g"]) if g > 0}
    out.update(height=c.get("ht"), weight=c.get("wt"), jersey=c.get("j"), archetype=c.get("a"), dev=c.get("dev"),
               abilities=[dict(zip(("name", "tier"), a.split("|"))) for a in c.get("ab") or []],
               coachability=c.get("c"), hometown=c.get("home"), years=c.get("yrs"))
    if c.get("tm"):
        out["target_share"] = c["tm"]
    return out


def player_compact(p: dict, attrs: list[str]) -> dict:
    """The inverse of player_doc: a complete file player back to league.compact's form."""
    r = [int(p["ratings"][k]) for k in attrs]
    pot = p.get("potential") or {}
    out = {"id": p["id"], "n": p["name"], "pos": _GAME_POS.get(p["pos"], p["pos"]), "cls": p["class"], "ht": p.get("height"),
           "wt": p.get("weight"), "j": p.get("jersey"), "a": p.get("archetype"), "dev": p.get("dev"), "r": r,
           "g": [max(0, int(pot[k]) - v) if k in pot else 0 for k, v in zip(attrs, r)],
           "c": p.get("coachability"), "s": p.get("stars"), "o": p["overall"], "home": p.get("hometown"), "yrs": p.get("years")}
    if p.get("abilities"):
        out["ab"] = [f"{a['name']}|{a['tier']}" for a in p["abilities"]]
    if p.get("target_share"):
        out["tm"] = p["target_share"]
    return out


def team_doc(lgd: dict, slug: str) -> dict:
    """One built-in team in file form; `lgd` is league.from_base()'s league."""
    meta, entry = league.base_meta(slug), lgd["teams"][slug]
    attrs = lgd["attrs"]
    loc = recruiting.model()["teams"].get(slug, {}).get("location") or [None, None]
    head = entry["coaches"]["head_coach"]
    coaches = {k: entry["coaches"][role] for k, role in _COACH_ROLES}
    coaches.update(offense=head["scheme"]["offensive_philosophy"], defense=head["scheme"]["defensive_philosophy"])
    fictional = {s for s in league.base_slugs() if league.base_meta(s)["fictional"]}
    out = {"slug": slug, "name": meta["school_name"], "short_name": meta["short_name"], "abbreviation": meta["abbreviation"],
           "mascot": meta["mascot"], "city": meta["city"], "state": meta["state"], "lat": loc[0], "lon": loc[1],
           "conference": conference_id(meta["conference"]), "level": meta["subdivision"], "colors": meta["colors"],
           "stadium": meta["stadium"], "home_field": meta["program"]["home_field_advantage"],
           "prestige": entry["program"]["prestige"], "rivals": [r for r in meta["rivals"] if r not in fictional],
           "coaches": coaches, "formation": entry["formation"]}
    if entry.get("style", slug) != slug:
        out["style"] = entry["style"]
    out["roster"] = [player_doc(c, attrs) for c in entry["roster"]]
    return out


def to_league_team(doc: dict, attrs: list[str]) -> dict:
    """A complete team doc as a league entry (what league.from_base holds per team, less the program)."""
    out = {"roster": [player_compact(p, attrs) for p in doc["roster"]],
           "coaches": {role: doc["coaches"][k] for k, role in _COACH_ROLES}, "formation": doc["formation"]}
    if doc.get("style"):
        out["style"] = doc["style"]
    return out


def _games(conference: str) -> int:
    from sim import schedule_gen
    rule = schedule_gen.rules()["conferences"].get(conference)
    return schedule_gen._league_games(rule, YEAR) if rule else 0


def export_document() -> dict:
    lgd = league.from_base(YEAR + 1)
    slugs = [s for s in league.base_slugs() if not league.base_meta(s)["fictional"] and s in lgd["teams"]]
    names = sorted({league.base_meta(s)["conference"] for s in slugs})
    return {"format": FORMAT, "name": NAME, "year": YEAR,
            "conferences": [{"id": conference_id(n), "name": n, "level": LEVEL, "games": _games(n)} for n in names],
            "teams": [team_doc(lgd, s) for s in slugs]}


def dumps(doc: dict) -> bytes:
    return (json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


@lru_cache(maxsize=1)
def builtin_bytes() -> bytes:
    return dumps(export_document())


def write_builtin(path: Path) -> int:
    data = builtin_bytes()
    Path(path).write_bytes(data)
    return len(data)
