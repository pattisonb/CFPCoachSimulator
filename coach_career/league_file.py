"""The league as a file (docs/superpowers/specs/2026-11-05-league-file-design.md): the built-in league
exported losslessly in the "cfp-league/1" format, so an import that leaves a team alone keeps exactly
what the game has. The FCS stand-ins and their conference are never written (league.base_meta's
"fictional" flag says which they are)."""
from __future__ import annotations

import copy
import json
import logging
import random
import re
from functools import lru_cache
from pathlib import Path
from typing import Optional

from coach_career import league, offseason, recruiting, recruits
from teamdata import game_scale

MAX_LEAGUE_BYTES = 64 * 1024 * 1024  # *tune* the largest league file read (the built-in export is about 22 MB)
MAX_TEAMS = 256  # *tune* FBS teams in a merged league (138 built in)
MAX_ERRORS = 50  # errors listed before "And N more."
MAX_CONFERENCE_GAMES = 11  # *tune* the most conference games a conference may declare
POSITIONS = ("QB", "RB", "WR", "TE", "LT", "LG", "C", "RG", "RT", "LEDG", "DT", "REDG", "SAM", "MIKE", "WILL", "CB", "FS", "SS", "K", "P")
POS_IN = {**{p: p for p in POSITIONS}, "RB": "HB", "HB": "HB", "FB": "FB"}   # file position to league position
STRENGTH_WORDS = ("Elite", "Strong", "Average", "Weak")
FORMAT = "cfp-league/1"
NAME = "Built-in League"
YEAR = league.FIRST_YEAR
LEVEL = "FBS"
_COACH_ROLES = (("head", "head_coach"), ("oc", "offensive_coordinator"), ("dc", "defensive_coordinator"))
_FILE_POS = {"HB": "RB"}                       # the file's position words; the game calls a running back HB
_GAME_POS = {v: k for k, v in _FILE_POS.items()}
_log = logging.getLogger(__name__)


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


# ---- Parsing and validation -------------------------------------------------------------------

_SLUG = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
_HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")
_MB = 1024 * 1024


class LeagueFileError(Exception):
    """A league file that cannot be read; `.errors` holds one sentence per problem."""

    def __init__(self, errors: list[str]):
        super().__init__(errors[0] if errors else "The league file cannot be read.")
        self.errors = list(errors)


def _no_constant(name: str):
    raise ValueError("numbers must be finite")


def parse(blob: bytes) -> dict:
    """The file's bytes as a document; raises LeagueFileError for size, text, JSON, shape and format."""
    if len(blob) > MAX_LEAGUE_BYTES:
        raise LeagueFileError([f"The file is {len(blob) / _MB:.1f} MB; the game reads league files up to {MAX_LEAGUE_BYTES // _MB} MB."])
    try:
        text = bytes(blob).decode("utf-8-sig")
    except UnicodeDecodeError:
        raise LeagueFileError(["The file is not UTF-8 text."]) from None
    try:
        doc = json.loads(text, parse_constant=_no_constant)
    except json.JSONDecodeError as e:
        raise LeagueFileError([f"The file is not valid JSON: line {e.lineno}, column {e.colno}: {e.msg}."]) from None
    except (ValueError, RecursionError) as e:
        raise LeagueFileError([f"The file is not valid JSON: {str(e).rstrip('.') or 'it cannot be read'}."]) from None
    if not isinstance(doc, dict):
        raise LeagueFileError(["The file's top level must be an object."])
    fmt = doc.get("format")
    if fmt != FORMAT:
        if isinstance(fmt, str):
            raise LeagueFileError([f"The file's format is '{fmt}'; this game reads '{FORMAT}'."])
        raise LeagueFileError([f"The file has no format; this game reads '{FORMAT}'."])
    return doc


@lru_cache(maxsize=1)
def _builtin() -> dict:
    """What the game has: real (non-stand-in) slugs, short names, conference ids and names, FCS ids."""
    slugs = [s for s in league.base_slugs() if not league.base_meta(s)["fictional"]]
    fict = [league.base_meta(s) for s in league.base_slugs() if league.base_meta(s)["fictional"]]
    confs: dict[str, str] = {}
    team_conf = {}
    for s in slugs:
        name = league.base_meta(s)["conference"]
        confs[conference_id(name)] = name
        team_conf[s] = conference_id(name)
    return {"slugs": set(slugs), "short": {s: league.base_meta(s)["short_name"] for s in slugs}, "conf_names": confs,
            "team_conf": team_conf, "games": {c: _games(n) for c, n in confs.items()},
            "fict_slugs": {m["slug"] for m in fict},
            "fict_conf": {conference_id(m["conference"]) for m in fict} | {str(m["conference"]).lower() for m in fict}}


@lru_cache(maxsize=1)
def _builtin_rosters() -> dict:
    """slug -> [(player id, name)] of the built-in rosters (what a team that leaves its roster out keeps)."""
    lgd = league.from_base(YEAR + 1)
    return {s: [(p["id"], p["n"]) for p in e["roster"]] for s, e in lgd["teams"].items()}


def _is_int(v, lo: int, hi: int) -> bool:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return False
    return v == v and lo <= v <= hi and (isinstance(v, int) or v.is_integer())


def _is_num(v, lo: float, hi: float) -> bool:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return False
    return v == v and lo <= v <= hi


def _say(v) -> str:
    """A value to echo in a sentence: strings only, so nothing like None or NaN reaches the page."""
    return v if isinstance(v, str) else "that value"


# ---- the field table: every key the export writes, at team, coach and player level ---------------

HOME_FIELD_RANGE = (0, 100)          # a team's home_field, as the engine reads home_field_advantage (50 is neutral)
STADIUM_CAPACITY_MAX = 200000        # *tune* the largest stadium a file may give
SURFACES = ("grass", "turf")
YEARS_RANGE = (0, 6)                 # *tune* a player's years in college football (the export runs 0 to 4)
TARGET_SHARE_MIN = 0.3               # *tune* a receiver's smallest real-usage target weight (tools/tune_from_real's floor)
JERSEY_RANGE = (0, 99)
MAX_HOMETOWN = 40                    # *tune* the longest hometown text (the export writes a state code)
UNIT_PLAYERS = 11                    # the players on the field for the offense and for the defense
FORMATION_ROLES = {"offense": ("QB", "HB", "FB", "WR", "TE", "LT", "LG", "C", "RG", "RT"),
                   "defense": ("LEDG", "DT", "REDG", "LB", "SAM", "MIKE", "WILL", "CB", "FS", "SS"),
                   "special_teams": ("K", "P", "KR", "PR")}
ABILITY_TIERS = ("Locked", "Bronze", "Silver", "Gold", "Platinum")   # Locked: named but not yet earned
_ROLE_WORD = {"head": "head coach", "oc": "offensive coordinator", "dc": "defensive coordinator"}
_COACH_RATINGS = {
    "head": ("overall", "offense", "defense", "recruiting", "player_development", "game_management", "motivation", "discipline"),
    "oc": ("overall", "play_calling", "player_development", "qb_development", "ol_development", "recruiting"),
    "dc": ("overall", "play_calling", "player_development", "pass_rush_development", "secondary_development", "recruiting")}
_COACH_TENDENCIES = {
    "head": ("aggressiveness", "fourth_down_go_rate", "two_point_tendency", "clock_management"),
    "oc": ("aggressiveness", "deep_shot_rate", "pass_rate", "play_action_rate", "tempo"),
    "dc": ("aggressiveness", "blitz_rate", "man_coverage_rate", "press_rate")}
_COACH_SCHEMES = {"head": (("offensive_philosophy", "offense"), ("defensive_philosophy", "defense")),
                  "oc": (("offensive_scheme", "offense"),), "dc": (("defensive_scheme", "defense"),)}
_COACH_TEXT = ("coach_id", "team_slug", "previous_job", "alma_mater", "co_coordinator", "notes")
_COACH_FLAGS = ("is_interim", "ratings_generated", "vacant", "plays_called_by_hc")


@lru_cache(maxsize=1)
def _words() -> dict:
    """The game's own words a file's fields must use (small; read once)."""
    from engine import game_config
    from sim import coaches as sim_coaches, season
    from teamdata import ratings as rv
    return {"offense": tuple(sim_coaches.OFFENSE_SCHEMES), "defense": tuple(sim_coaches.DEFENSE_SCHEMES),
            "dev": tuple(season.DEV_TRAITS), "coachability": tuple(n for n, _, _ in recruits.COACHABILITY),
            "archetype": frozenset(rv.ARCHETYPES), "ability": frozenset(rv.TRAITS),
            "target_max": float(game_config.TARGET_MULT_MAX)}


def _or(words) -> str:
    """Words as a list in a sentence: "A, B or C"."""
    words = list(words)
    return words[0] if len(words) == 1 else ", ".join(words[:-1]) + " or " + words[-1]


def _num_text(x: float) -> str:
    return f"{x:g}"


def _check_team_fields(label: str, t: dict, b: dict, add) -> None:
    """A team's identity and setup fields beyond the core ones: home field, stadium, style, formation and coaches."""
    hf = t.get("home_field")
    if hf is not None and not _is_num(hf, *HOME_FIELD_RANGE):
        add(f"{label}: home field must be a number from {HOME_FIELD_RANGE[0]} to {HOME_FIELD_RANGE[1]}.")
    sd = t.get("stadium")
    if sd is not None:
        if not isinstance(sd, dict):
            add(f"{label}: the stadium must list its name, capacity and surface.")
        else:
            if sd.get("name") is not None and (not isinstance(sd["name"], str) or not sd["name"].strip()):
                add(f"{label}: the stadium's name must be text.")
            if sd.get("capacity") is not None and not _is_int(sd["capacity"], 0, STADIUM_CAPACITY_MAX):
                add(f"{label}: the stadium's capacity must be a whole number from 0 to {STADIUM_CAPACITY_MAX}.")
            if sd.get("surface") is not None and sd["surface"] not in SURFACES:
                add(f"{label}: the stadium's surface must be {_or(SURFACES)}.")
    style = t.get("style")
    if style is not None:
        if not isinstance(style, str):
            add(f"{label}: style must be a built-in team's slug.")
        elif style not in b["slugs"]:
            add(f"{label}: style '{style}' is not a team in the game; use a built-in team's slug.")
    fm = t.get("formation")
    if fm is not None:
        _check_formation(label, fm, add)
    colors = t.get("colors")
    if isinstance(colors, dict):
        for k in ("primary", "secondary", "accent"):
            cv = colors.get(k)
            if isinstance(cv, dict) and cv.get("name") is not None and not isinstance(cv["name"], str):
                add(f"{label}: the {k} color's name must be text.")
    coaches = t.get("coaches")
    if isinstance(coaches, dict):
        w = _words()
        for side in ("offense", "defense"):
            v = coaches.get(side)
            if v is None:
                continue
            if not isinstance(v, str):
                add(f"{label}: {side} must be a scheme word such as {w[side][0]}.")
            elif v not in w[side]:
                add(f"{label}: {side} '{v}' is not a scheme in the game; use {_or(w[side])}.")
        for key in ("head", "oc", "dc"):
            if isinstance(coaches.get(key), dict):
                _check_coach(label, key, coaches[key], add)


def _check_formation(label: str, fm, add) -> None:
    if not isinstance(fm, dict) or not isinstance(fm.get("offense"), dict) or not isinstance(fm.get("defense"), dict) \
            or (fm.get("special_teams") is not None and not isinstance(fm["special_teams"], dict)):
        add(f"{label}: the formation must list the offense, defense and special teams roles and their counts.")
        return
    for unit, roles in FORMATION_ROLES.items():
        counts = fm.get(unit) or {}
        ok = True
        for role, n in counts.items():
            if role not in roles:
                add(f"{label}: the formation's {unit.replace('_', ' ')} role '{role}' is not a role in the game; use {_or(roles)}.")
                ok = False
            elif not _is_int(n, 0, UNIT_PLAYERS):
                add(f"{label}: the formation's {unit.replace('_', ' ')} {role} count must be a whole number from 0 to {UNIT_PLAYERS}.")
                ok = False
        if ok and unit != "special_teams":
            total = sum(int(n) for n in counts.values())
            if total != UNIT_PLAYERS:
                add(f"{label}: the formation's {unit} must have {UNIT_PLAYERS} players; it has {total}.")


def _check_coach(label: str, key: str, c: dict, add) -> None:
    """One coach as the file gives him (all of him, or the fields a built-in coach changes)."""
    w, role = _words(), _ROLE_WORD[key]
    who = f"{label}: the {role}'s"
    if c.get("name") is not None and (not isinstance(c["name"], str) or not c["name"].strip()):
        add(f"{who} name must be text.")
    if c.get("rating") is not None and not _is_int(c["rating"], 1, 99):
        add(f"{who} rating must be a whole number from 1 to 99.")
    for field, keys, lo, hi, word, whole in (("ratings", _COACH_RATINGS[key], 1, 99, "rating", True),
                                             ("tendencies", _COACH_TENDENCIES[key], 0, 100, "tendency", False)):
        vals = c.get(field)
        if vals is None:
            continue
        if not isinstance(vals, dict):
            add(f"{who} {field} must list {field} and their values.")
            continue
        for k, v in vals.items():
            if k not in keys:
                add(f"{who} {word} '{k}' is not a {role} {word}; use {_or(keys)}.")
            elif not (_is_int(v, lo, hi) if whole else _is_num(v, lo, hi)):
                add(f"{who} {word} '{k}' must be a {'whole number' if whole else 'number'} from {lo} to {hi}.")
    sc = c.get("scheme")
    if sc is not None:
        if not isinstance(sc, dict):
            add(f"{who} scheme must list his {_or([k.replace('_', ' ') for k, _ in _COACH_SCHEMES[key]])}.")
        else:
            for k, side in _COACH_SCHEMES[key]:
                v = sc.get(k)
                if v is None:
                    continue
                if not isinstance(v, str):
                    add(f"{who} {k.replace('_', ' ')} must be a scheme word such as {w[side][0]}.")
                elif v not in w[side]:
                    add(f"{who} {k.replace('_', ' ')} '{v}' is not a scheme in the game; use {_or(w[side])}.")
    if c.get("since") is not None and not _is_int(c["since"], 1900, YEAR):
        add(f"{who} 'since' must be a year such as {YEAR - 2}.")
    for k in _COACH_FLAGS:
        if c.get(k) is not None and not isinstance(c[k], bool):
            add(f"{who} '{k}' must be true or false.")
    for k in _COACH_TEXT:
        if c.get(k) is not None and not isinstance(c[k], str):
            add(f"{who} '{k}' must be text.")
    want = dict(_COACH_ROLES)[key]
    if c.get("role") is not None and c["role"] != want:
        add(f"{who} 'role' must be {want} or left out.")


def _check_player_fields(who: str, p: dict, add) -> None:
    """A player's fields beyond name, position, class and the numbers checked with them."""
    w = _words()
    j = p.get("jersey")
    if j is not None:
        n = int(j) if isinstance(j, str) and j.isascii() and j.isdigit() and len(j) <= 2 else j
        if not _is_int(n, *JERSEY_RANGE):
            add(f"{who}: jersey must be a whole number from {JERSEY_RANGE[0]} to {JERSEY_RANGE[1]}.")
    a = p.get("archetype")
    if a is not None and (not isinstance(a, str) or a not in w["archetype"]):
        add(f"{who}: archetype '{_say(a)}' is not an archetype in the game.")
    for field in ("dev", "coachability"):
        v = p.get(field)
        if v is not None and v not in w[field]:
            add(f"{who}: {field} '{_say(v)}' must be {_or(w[field])}.")
    ab = p.get("abilities")
    if ab is not None:
        if not isinstance(ab, list):
            add(f"{who}: abilities must be a list of names and tiers.")
        else:
            for i, x in enumerate(ab, 1):
                if not isinstance(x, dict) or not isinstance(x.get("name"), str) or not isinstance(x.get("tier"), str):
                    add(f"{who}: ability {i} needs a name and a tier.")
                elif x["name"] not in w["ability"]:
                    add(f"{who}: ability '{x['name']}' is not an ability in the game.")
                elif x["tier"] not in ABILITY_TIERS:
                    add(f"{who}: ability tier '{x['tier']}' must be {_or(ABILITY_TIERS)}.")
    h = p.get("hometown")
    if h is not None and (not isinstance(h, str) or len(h) > MAX_HOMETOWN):
        add(f"{who}: hometown must be text of at most {MAX_HOMETOWN} characters.")
    y = p.get("years")
    if y is not None and not _is_int(y, *YEARS_RANGE):
        add(f"{who}: years must be a whole number from {YEARS_RANGE[0]} to {YEARS_RANGE[1]}.")
    ts = p.get("target_share")
    if ts is not None and not _is_num(ts, TARGET_SHARE_MIN, w["target_max"]):
        add(f"{who}: target share must be a number from {_num_text(TARGET_SHARE_MIN)} to {_num_text(w['target_max'])}.")


def validate(doc: dict) -> list[str]:
    """Every problem in a parsed league file, as sentences (capped at MAX_ERRORS, then "And N more.")."""
    return _capped(problems(doc))


def _capped(errs: list[str]) -> list[str]:
    if len(errs) > MAX_ERRORS:
        return errs[:MAX_ERRORS] + [f"And {len(errs) - MAX_ERRORS} more."]
    return errs


def problems(doc: dict) -> list[str]:
    """Every problem in a parsed league file, as sentences, uncapped (validate caps them)."""
    errs: list[str] = []
    add = errs.append
    b = _builtin()
    if not isinstance(doc, dict):
        return ["The file's top level must be an object."]

    year = doc.get("year")
    if year is not None and year != YEAR:
        if isinstance(year, int) and not isinstance(year, bool):
            add(f"The file's year is {year}; careers start in {YEAR}, so use {YEAR} or leave it out.")
        else:
            add(f"The file's year is not a whole number; careers start in {YEAR}, so use {YEAR} or leave it out.")

    # -- remove ---------------------------------------------------------------------------------
    raw_remove = doc.get("remove")
    remove: list = []
    if raw_remove is not None:
        if not isinstance(raw_remove, list):
            add("The file's remove list must be a list of team slugs.")
        else:
            remove = raw_remove
    removed: set[str] = set()
    for i, slug in enumerate(remove, 1):
        if not isinstance(slug, str):
            add(f"Team {i}: a remove entry must be a team slug.")
        elif slug in b["fict_slugs"]:
            add(f"Team {i}: that slug is reserved for the game's FCS opponents; pick another.")
        elif slug not in b["slugs"]:
            add(f"Team {i}: the file removes '{slug}', which is not a team in the game.")
        else:
            removed.add(slug)

    # -- conferences ----------------------------------------------------------------------------
    raw_confs = doc.get("conferences")
    conferences: list = []
    if raw_confs is not None:
        if isinstance(raw_confs, list):
            conferences = raw_confs
        else:
            add("The file's conferences must be a list.")
    file_confs: dict[str, dict] = {}     # id -> {"name", "games"}
    for i, c in enumerate(conferences, 1):
        if not isinstance(c, dict):
            add(f"Conference {i}: it must be an object.")
            continue
        cid, cname = c.get("id"), c.get("name")
        label = cname if isinstance(cname, str) and cname.strip() else f"Conference {i}"
        if not isinstance(cid, str) or not isinstance(cname, str) or not cname.strip():
            add(f"Conference {i}: it needs an id and a name.")
            continue
        if cid in b["fict_conf"] or cname.lower() in b["fict_conf"] or conference_id(cname) in b["fict_conf"]:
            add(f"Conference {i}: that conference is reserved for the game's FCS opponents.")
            continue
        if not _SLUG.match(cid):
            add(f"{label}: the conference id '{cid}' must be lowercase letters, numbers and single dashes.")
            continue
        if cid in file_confs:
            add(f"{label}: the conference id '{cid}' is used by two conferences; give each its own id.")
            continue
        # every conference's name is its own: a new one's name is its engine name, and the page shows a renamed
        # built-in one by its new name, so no name may be another conference's name in the game or in the file
        key = cname.strip().casefold()
        bid = next((k for k, n in b["conf_names"].items() if k != cid and n.casefold() == key), None)
        if bid is not None:
            if cid not in b["conf_names"]:
                add(f"Conference {i} ({cname}): that name belongs to a conference in the game; give the new conference "
                    f"its own name, or use the id '{bid}' to change that one.")
            else:
                add(f"Conference {i} ({cname}): that name belongs to another conference in the game; give it its own name.")
            continue
        twin = next((c["name"] for c in file_confs.values() if c["name"].strip().casefold() == key), None)
        if twin is not None:
            add(f"Conference {i} ({cname}): another conference in the file is named {twin}; give each its own name.")
            continue
        lvl = c.get("level")
        if lvl is not None and lvl != LEVEL:
            add(f"{label}: level '{_say(lvl)}' is not supported; FCS games use the game's own opponents.")
        games = c.get("games", 0)
        if games is None:
            games = 0
        if not _is_int(games, 0, MAX_CONFERENCE_GAMES):
            add(f"{label}: games must be a whole number from 0 to {MAX_CONFERENCE_GAMES}.")
            games = 0
        file_confs[cid] = {"name": cname, "games": int(games)}

    def resolve(ref) -> str | None:
        """A team's `conference` value as a conference id, or None when nothing matches."""
        if not isinstance(ref, str):
            return None
        if ref in file_confs:
            return ref
        if ref in b["conf_names"]:
            return ref
        for cid, name in b["conf_names"].items():
            if ref == name:
                return cid
        return None

    # -- teams ----------------------------------------------------------------------------------
    raw_teams = doc.get("teams")
    teams: list = []
    if raw_teams is not None:
        if isinstance(raw_teams, list):
            teams = raw_teams
        else:
            add("The file's teams must be a list.")
    seen_slugs: dict[str, int] = {}
    file_slugs: set[str] = set()
    replaced_roster: set[str] = set()      # built-in slugs whose roster the file replaces
    player_ids: dict[str, str] = {}        # file player id -> team label (for the whole merged league)
    merged_conf: dict[str, str | None] = {s: c for s, c in b["team_conf"].items() if s not in removed}
    checks: list[tuple] = []               # (label, doc) for the depth-chart pass after rosters are known
    rosters: dict[str, set[str]] = {}      # slug -> lowercase names on the roster as it will be

    for i, t in enumerate(teams, 1):
        if not isinstance(t, dict):
            add(f"Team {i}: it must be an object.")
            continue
        slug = t.get("slug")
        if not isinstance(slug, str):
            add(f"Team {i}: it needs a slug.")
            continue
        if slug in b["fict_slugs"]:
            add(f"Team {i}: that slug is reserved for the game's FCS opponents; pick another.")
            continue
        is_builtin = slug in b["slugs"]
        sn, nm = t.get("short_name"), t.get("name")
        label = (sn if isinstance(sn, str) and sn.strip() else nm if isinstance(nm, str) and nm.strip()
                 else b["short"].get(slug) or f"Team {i}")
        if not _SLUG.match(slug):
            add(f"{label}: the slug '{slug}' must be lowercase letters, numbers and single dashes.")
            continue
        if slug in seen_slugs:
            add(f"{label}: the slug '{slug}' is used by two teams; give each its own slug.")
            continue
        seen_slugs[slug] = i
        file_slugs.add(slug)
        if slug in removed:
            add(f"{label}: the file removes it and also lists it; do one or the other.")
        if not is_builtin:
            if not isinstance(nm, str) or not nm.strip():
                add(f"{label}: a new team needs a name.")
            if t.get("conference") is None:
                add(f"{label}: a new team needs a conference.")
        for key in ("name", "short_name", "abbreviation", "mascot", "city"):
            if t.get(key) is not None and (not isinstance(t[key], str) or not t[key].strip()):
                add(f"{label}: {key.replace('_', ' ')} must be text.")
        lvl = t.get("level")
        if lvl is not None and lvl != LEVEL:
            add(f"{label}: level '{_say(lvl)}' is not supported; FCS games use the game's own opponents.")

        conf = t.get("conference")
        if conf is not None:
            cid = resolve(conf)
            if isinstance(conf, str) and (conf.lower() in b["fict_conf"] or conference_id(conf) in b["fict_conf"]):
                add(f"{label}: that conference is reserved for the game's FCS opponents.")
                cid = None
            elif cid is None:
                add(f"{label}: conference '{_say(conf)}' is not in the file or the game.")
            merged_conf[slug] = cid
        else:
            merged_conf.setdefault(slug, merged_conf.get(slug))
        if slug in removed:
            merged_conf.pop(slug, None)

        st = t.get("strength")
        if st is not None and not (st in STRENGTH_WORDS if isinstance(st, str) else _is_num(st, 1, 100)):
            add(f"{label}: strength must be Elite, Strong, Average or Weak, or a number from 1 to 100.")
        pr = t.get("prestige")
        if pr is not None and not _is_num(pr, 0, 100):
            add(f"{label}: prestige must be a number from 0 to 100.")
        colors = t.get("colors")
        if colors is not None:
            if not isinstance(colors, dict):
                add(f"{label}: colors must list a primary, a secondary and an accent color.")
            else:
                for k in ("primary", "secondary", "accent"):
                    cv = colors.get(k)
                    if cv is None:
                        continue
                    hx = cv.get("hex") if isinstance(cv, dict) else None
                    if not isinstance(hx, str) or not _HEX.match(hx):
                        add(f"{label}: the {k} color needs a hex value like #0B6E4F.")
        lat, lon = t.get("lat"), t.get("lon")
        if lat is not None and not _is_num(lat, -90, 90):
            add(f"{label}: lat must be a number from -90 to 90.")
        if lon is not None and not _is_num(lon, -180, 180):
            add(f"{label}: lon must be a number from -180 to 180.")
        state = t.get("state")
        if state is not None:
            if not (isinstance(state, str) and len(state) == 2 and state in recruiting.model()["generation"]["towns"]):
                add(f"{label}: state must be a two-letter code the game knows, such as OR.")
        elif not is_builtin:
            pass   # the state is optional; location defaults are generated later
        coaches = t.get("coaches")
        if coaches is not None:
            if not isinstance(coaches, dict):
                add(f"{label}: coaches must list a head coach, an offensive coordinator and a defensive coordinator.")
            else:
                for k in ("head", "oc", "dc"):
                    if coaches.get(k) is not None and not isinstance(coaches[k], dict):
                        add(f"{label}: the {_ROLE_WORD[k]} must be an object with a name.")
        _check_team_fields(label, t, b, add)
        checks.append((label, t, slug, is_builtin))

        # -- roster -----------------------------------------------------------------------------
        roster = t.get("roster")
        if roster is None:
            continue
        if not isinstance(roster, list):
            add(f"{label}: the roster must be a list of players.")
            continue
        if is_builtin:
            replaced_roster.add(slug)
        if len(roster) > offseason.ROSTER_LIMIT:
            add(f"{label}: the roster has {len(roster)} players; the limit is {offseason.ROSTER_LIMIT}.")
        names: dict[str, tuple[int, str]] = {}
        known = set()
        attrs = set(game_scale.keys())
        for n, p in enumerate(roster, 1):
            if not isinstance(p, dict):
                add(f"{label}, player {n}: it must be an object.")
                continue
            pname = p.get("name")
            who = f"{label}, player {n} ({pname})" if isinstance(pname, str) and pname.strip() else f"{label}, player {n}"
            if not isinstance(pname, str) or not pname.strip():
                add(f"{who}: the name is required.")
            else:
                key = pname.strip().lower()
                known.add(key)
                if key in names:
                    add(f"{label}: players {names[key][0]} and {n} are both named {names[key][1]}; give each a different name.")
                else:
                    names[key] = (n, pname.strip())
            pos = p.get("pos")
            if pos is None:
                add(f"{who}: the position is required.")
            elif not isinstance(pos, str) or pos not in POS_IN:
                add(f"{who}: position '{_say(pos)}' is not a position.")
            cls = p.get("class")
            if cls is None:
                add(f"{who}: the class is required.")
            elif not isinstance(cls, str) or cls not in league.CLASSES:
                add(f"{who}: class '{_say(cls)}' is not a class.")
            if p.get("overall") is not None and not _is_int(p["overall"], 1, 99):
                add(f"{who}: overall must be a whole number from 1 to 99.")
            for field in ("ratings", "potential"):
                vals = p.get(field)
                if vals is None:
                    continue
                if not isinstance(vals, dict):
                    add(f"{who}: {field} must list skills and their values.")
                    continue
                word = "rating" if field == "ratings" else "potential"
                for k, v in vals.items():
                    if k not in attrs:
                        add(f"{who}: {word} '{k}' is not a skill in the game.")
                    elif isinstance(v, bool) or not isinstance(v, (int, float)) or v != v:
                        add(f"{who}: {word} '{k}' is not a number.")
                    elif not _is_int(v, 1, 99):
                        add(f"{who}: {word} '{k}' must be a whole number from 1 to 99.")
            if p.get("stars") is not None and not _is_int(p["stars"], 1, 5):
                add(f"{who}: stars must be a whole number from 1 to 5.")
            if p.get("height") is not None and not _is_num(p["height"], 60, 90):
                add(f"{who}: height must be from 60 to 90 inches.")
            if p.get("weight") is not None and not _is_num(p["weight"], 140, 420):
                add(f"{who}: weight must be from 140 to 420 pounds.")
            _check_player_fields(who, p, add)
            pid = p.get("id")
            if pid is not None:
                if not isinstance(pid, str) or not _SLUG.match(pid):
                    add(f"{who}: id must be lowercase letters, numbers and single dashes.")
                elif pid in player_ids:
                    add(f"{who}: id '{pid}' is already used by another player.")
                else:
                    player_ids[pid] = slug
        rosters[slug] = known

    # -- depth charts, rivals, ids against the kept built-in rosters -----------------------------
    kept_ids: dict[str, str] = {}
    if player_ids or any(isinstance(t, dict) and t.get("depth_chart") for t in teams):
        for s, plist in _builtin_rosters().items():
            if s in removed or s in replaced_roster:
                continue
            for pid, _ in plist:
                kept_ids[pid] = s
    for pid, slug in player_ids.items():
        if pid in kept_ids:
            add(f"{checks_label(checks, slug)}: player id '{pid}' is already used by another player in the league.")

    for label, t, slug, is_builtin in checks:
        dc = t.get("depth_chart")
        if dc is not None:
            if not isinstance(dc, dict):
                add(f"{label}: the depth chart must list player names for each position.")
            else:
                if slug in rosters:
                    on = rosters[slug]
                elif is_builtin and slug not in removed:
                    on = {n.strip().lower() for _, n in _builtin_rosters().get(slug, [])}
                else:
                    on = set()
                for k, lst in dc.items():
                    if k not in POSITIONS and k not in ("HB", "FB"):
                        add(f"{label}: the depth chart's '{k}' is not a position.")
                    elif not isinstance(lst, list):
                        add(f"{label}: the depth chart's {k} list must be a list of names.")
                    else:
                        for nm in lst:
                            if not isinstance(nm, str) or nm.strip().lower() not in on:
                                add(f"{label}: the depth chart's {k} list names {_say(nm)}, who is not on the roster.")
        rv = t.get("rivals")
        if rv is not None:
            if not isinstance(rv, list):
                add(f"{label}: rivals must be a list of team slugs.")
            else:
                for r in rv:
                    ok = isinstance(r, str) and r not in removed and (r in b["slugs"] or r in file_slugs)
                    if not ok:
                        if isinstance(r, str) and r not in b["fict_slugs"]:
                            add(f"{label}: rival '{r}' is not a team in the file or the game.")
                        else:
                            add(f"{label}: a rival is not a team in the file or the game.")

    # -- merged league: size and conference widths ---------------------------------------------
    fbs = {s for s in merged_conf} | file_slugs
    fbs -= removed - file_slugs
    if len(fbs) > MAX_TEAMS:
        add(f"The merged league has {len(fbs)} FBS teams; the limit is {MAX_TEAMS}.")
    members: dict[str, int] = {}
    for s in fbs:
        c = merged_conf.get(s)
        if c is not None:
            members[c] = members.get(c, 0) + 1
    for cid, n in sorted(members.items()):
        if cid in file_confs:
            games, name = file_confs[cid]["games"], file_confs[cid]["name"]
        else:
            games, name = b["games"].get(cid, 0), b["conf_names"].get(cid, cid)
        if games > 0 and n - 1 < games:
            add(f"{name}: {n} team{'s' if n != 1 else ''} can't play {games} conference games each; it needs at least {games + 1}.")

    return errs


def checks_label(checks: list[tuple], slug: str) -> str:
    return next((c[0] for c in checks if c[2] == slug), slug)


# ---- Merge ------------------------------------------------------------------------------------

DEFAULT_NAME = "Imported League"


@lru_cache(maxsize=1)
def _builtin_docs() -> dict:
    """slug -> the built-in team's file form (what an import is compared with)."""
    lgd = league.from_base(YEAR + 1)
    return {s: team_doc(lgd, s) for s in _builtin()["slugs"] if s in lgd["teams"]}


def _deep_merge(base: dict, over: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in over.items():
        out[k] = _deep_merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else copy.deepcopy(v)
    return out


def _merge_coaches(base: dict, given: dict) -> dict:
    """A built-in team's staff with the file's coaches over it, role by role: a given role edits the
    built-in coach (deep-merged), a role left out stays as built in, the offense/defense words replace."""
    out = copy.deepcopy(base)
    for k, v in given.items():
        if v is None:
            continue
        out[k] = _deep_merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else copy.deepcopy(v)
    return out


def merge(doc: dict) -> dict:
    """A validated file merged into the built-in league by slug. An imported team equal to its built-in
    export is not "changed", so a round-tripped export is the built-in league (`builtin` is true)."""
    b, base = _builtin(), _builtin_docs()
    remove = {s for s in (doc.get("remove") or []) if isinstance(s, str) and s in base}
    file_confs = {c["id"]: c for c in doc.get("conferences") or [] if isinstance(c, dict) and isinstance(c.get("id"), str)}

    def resolve(ref):
        if ref in file_confs or ref in b["conf_names"]:
            return ref
        return next((cid for cid, name in b["conf_names"].items() if ref == name), ref)

    teams = {s: copy.deepcopy(d) for s, d in base.items() if s not in remove}
    added, changed = [], []
    for t in doc.get("teams") or []:
        if not isinstance(t, dict) or not isinstance(t.get("slug"), str):
            continue
        slug = t["slug"]
        given = {k: v for k, v in t.items() if v is not None}
        if given.get("conference") is not None:
            given["conference"] = resolve(given["conference"])
        if slug in base:
            if isinstance(given.get("coaches"), dict):
                given["coaches"] = _merge_coaches(base[slug].get("coaches") or {}, given["coaches"])
            merged = {**copy.deepcopy(base[slug]), **given}
            if merged != base[slug]:
                changed.append(slug)
        else:
            merged, _ = given, added.append(slug)
        teams[slug] = merged
    removed = sorted(remove)

    members: dict[str, list[str]] = {}
    for slug in sorted(teams):
        members.setdefault(teams[slug].get("conference"), []).append(slug)
    confs = {}
    for cid, mem in members.items():
        fc = file_confs.get(cid)
        if fc is not None:
            games = fc.get("games") or 0
            name, level = fc["name"], fc.get("level") or LEVEL
        else:
            name, games, level = b["conf_names"].get(cid, cid), b["games"].get(cid, 0), LEVEL
        confs[cid] = {"id": cid, "name": name, "level": level, "games": int(games), "members": mem}
    base_members: dict[str, list[str]] = {}
    for slug in sorted(base):
        base_members.setdefault(b["team_conf"][slug], []).append(slug)
    structural = bool(added or removed) or set(confs) != set(base_members) or any(
        confs[c]["members"] != base_members[c] or confs[c]["games"] != b["games"].get(c, 0) for c in confs)
    conf_changed = sorted(c for c in confs if c in b["conf_names"]
                          and (confs[c]["name"] != b["conf_names"][c] or confs[c]["level"] != LEVEL))
    added, changed = sorted(added), sorted(changed)
    name = doc.get("name") if isinstance(doc.get("name"), str) and doc["name"].strip() else DEFAULT_NAME
    return {"teams": teams, "added": added, "changed": changed, "removed": removed, "conferences": confs,
            "structural": structural, "conferences_changed": conf_changed,
            "builtin": not (added or changed or removed or structural or conf_changed), "name": name}


# ---- Schedules ----------------------------------------------------------------------------------

NEW_CONFERENCE_POWER_ROAD = [1, 2]   # *tune* a new conference team's Power pay games a year (fewest, most)
NEW_CONFERENCE_FCS_MAX = 1           # *tune* a new conference team's FCS games a year, at most


def _base_members() -> dict[str, list[str]]:
    """Built-in conference id -> its teams, sorted."""
    b = _builtin()
    out: dict[str, list[str]] = {}
    for s in sorted(b["slugs"]):
        out.setdefault(b["team_conf"][s], []).append(s)
    return out


def engine_name(merged: dict, cid: str) -> str:
    """The conference name the engine and the schedule rules use: a built-in conference keeps its
    built-in name even when the file renames it (only its display name changes, conference_names);
    a new conference's is its name in the file."""
    builtin = _builtin()["conf_names"].get(cid)
    if builtin is not None:
        return builtin
    c = merged["conferences"].get(cid)
    return c["name"] if c else str(cid)


def conference_names(merged: dict) -> dict:
    """{engine name: display name} for each new or renamed conference (lgd["conference_names"])."""
    b = _builtin()["conf_names"]
    return {engine_name(merged, cid): c["name"] for cid, c in sorted(merged["conferences"].items())
            if cid not in b or c["name"] != b[cid]}


def _conf_changed(merged: dict, cid: str) -> bool:
    """A built-in conference whose members or games the file changed (a rename alone changes only its display name)."""
    b, c = _builtin(), merged["conferences"].get(cid)
    return c is None or sorted(c["members"]) != _base_members().get(cid, []) or c["games"] != b["games"].get(cid, 0)


def divisions(merged: dict) -> dict:
    """{engine conference name: {division: [slugs]}} for each conference that plays divisions
    (season.DIVISIONS) and whose membership (or games) the file changed: the built-in divisions less
    the teams gone, each added member in the smaller division (a tie to the first alphabetically).
    {} (no divisions) when a division would be empty or too big for the conference's games."""
    from sim import season
    out = {}
    for conf_name, divs in season.DIVISIONS.items():
        cid = conference_id(conf_name)
        if not _conf_changed(merged, cid):
            continue
        c = merged["conferences"].get(cid)
        members = list(c["members"]) if c else []
        keep = set(members)
        new = {d: [s for s in ms if s in keep] for d, ms in divs.items()}
        placed = {s for ms in new.values() for s in ms}
        for s in sorted(keep - placed):
            d = min(sorted(new), key=lambda d: len(new[d]))
            new[d].append(s)
        if not c or any(not ms for ms in new.values()) or max(len(ms) for ms in new.values()) - 1 > c["games"]:
            new = {}
        out[conf_name] = new
    return out


def _new_rule(n: int, games: int) -> dict:
    return {"games": games, "cycle": 1 if n - 1 == games else 2, "home_split": "even", "protected": [], "finales": [],
            "non_conference": {"games": 12 - games, "power_road": list(NEW_CONFERENCE_POWER_ROAD), "fcs_max": NEW_CONFERENCE_FCS_MAX}}


def _trimmed_rule(base: dict, c: dict, divs: dict, name: str) -> dict:
    """A built-in conference's rule for its merged members and games: the pairs, eight-game turns and
    round robin its teams no longer allow are dropped; its divisions are divisions()'s."""
    rule = copy.deepcopy(base)
    mem, n, games = set(c["members"]), len(c["members"]), c["games"]
    for k in ("protected", "finales", "neutral"):
        if k in rule:
            rule[k] = [p for p in rule[k] if p[0] in mem and p[1] in mem]
    if "eight_game_team" in rule:
        rule["eight_game_team"] = {y: s for y, s in rule["eight_game_team"].items() if s in mem}
        if not rule["eight_game_team"]:
            del rule["eight_game_team"]
    from sim import schedule_gen
    if games != schedule_gen._league_games(base, YEAR):  # the file set the conference's games: every year
        rule["games"] = games
        rule.pop("games_from", None)
        rule.setdefault("non_conference", {})["games"] = 12 - games
    if "games_from" in rule:
        rule["games_from"] = {y: k for y, k in rule["games_from"].items() if k <= n - 1}
        if not rule["games_from"]:
            del rule["games_from"]
    if rule.get("round_robin") and n - 1 != games:
        del rule["round_robin"]
    if name in divs:
        d = divs[name]
        if d:
            rule["divisions"] = d
            rule["cross_division"] = max(0, games - (min(len(ms) for ms in d.values()) - 1))
        else:
            rule.pop("divisions", None)
            rule.pop("cross_division", None)
    return rule


def _protect_fits(rule: dict, games: int, pair: list) -> bool:
    """A listed rivalry can be a protected pair: each team keeps a league game free beyond its
    protected games and division, and a cross-division pair fits the cross-division games."""
    divs = rule.get("divisions") or {}
    div_of = {s: d for d, ms in divs.items() for s in ms}
    a, b = pair
    if divs and div_of.get(a) is not None and div_of.get(a) == div_of.get(b):
        return False                                    # division mates meet every year already
    for s in pair:
        cross = [p for p in rule.get("protected", []) if s in p and not (div_of and div_of.get(p[0]) == div_of.get(p[1]))]
        load = len(cross) + (len(divs.get(div_of[s], [])) - 1 if s in div_of else 0)
        if load + 1 >= games:
            return False
        if divs and rule.get("cross_division") is not None and len(cross) + 1 >= rule["cross_division"]:
            return False
    return True


def schedule_rules(merged: dict) -> dict:
    """The schedule generator's rules_override for a merged league: {"conferences": {name: rule}} for
    each new conference and each built-in one whose members, games or name changed (or that gains a
    protected pair), and {"annual": [...]} for listed rivalries across conferences. A rival in the
    same conference is a protected pair; new conferences are never Power conferences."""
    from sim import schedule_gen
    R = schedule_gen.rules()["conferences"]
    b, docs = _builtin(), _builtin_docs()
    confs, teams = merged["conferences"], merged["teams"]
    divs = divisions(merged)
    work: dict[str, dict | None] = {}
    out_ids: set[str] = set()

    def rule_for(cid: str):
        if cid not in work:
            c = confs[cid]
            if cid not in b["conf_names"]:
                work[cid] = _new_rule(len(c["members"]), c["games"])
                out_ids.add(cid)
            elif R.get(b["conf_names"][cid]) is None:
                work[cid] = None                        # the independents: scheduled team by team
            elif _conf_changed(merged, cid):
                work[cid] = _trimmed_rule(R[b["conf_names"][cid]], c, divs, b["conf_names"][cid])
                out_ids.add(cid)
            else:
                work[cid] = copy.deepcopy(R[b["conf_names"][cid]])
        return work[cid]

    for cid in confs:
        rule_for(cid)

    def listed(slug: str) -> list:
        """The rivals a team's schedule follows from the file: an added team's, a changed list, and for a
        team that moved conference its built-in rivalries too (both ways), now perhaps across conferences."""
        rv = teams[slug].get("rivals") or []
        out = list(rv) if slug in merged["added"] or rv != (docs.get(slug) or {}).get("rivals") else []
        if slug in b["team_conf"] and teams[slug].get("conference") != b["team_conf"][slug]:
            out += (docs.get(slug) or {}).get("rivals") or []
            out += sorted(t for t, d in docs.items() if slug in (d.get("rivals") or []))
        return [r for r in dict.fromkeys(out) if isinstance(r, str)]

    seen = {tuple(sorted(s["teams"])) for s in schedule_gen.series()["annual"]}
    annual = []
    for slug in sorted(set(merged["added"]) | set(merged["changed"])):
        if slug not in teams:
            continue
        for r in listed(slug):
            if r == slug or r not in teams:
                continue
            pair = sorted((slug, r))
            ca, cr = teams[slug].get("conference"), teams[r].get("conference")
            rule = rule_for(ca) if ca == cr and ca in confs else None
            if rule is not None and confs[ca]["games"] > 0:
                prot = rule.setdefault("protected", [])
                if not rule.get("round_robin") and pair not in [sorted(p) for p in prot] \
                        and _protect_fits(rule, confs[ca]["games"], pair):
                    prot.append(pair)
                    out_ids.add(ca)
                continue
            if tuple(pair) not in seen:
                seen.add(tuple(pair))
                annual.append({"teams": pair, "name": ""})
    return {"conferences": {engine_name(merged, cid): work[cid] for cid in sorted(out_ids)}, "annual": annual}


# ---- Check: a file as the career it would start --------------------------------------------------

def _plain(reason: str, teams: dict, conference_names: Optional[dict] = None) -> str:
    """A ScheduleError's reason for the page: each team slug as its name, an FCS stand-in as "an FCS
    opponent" (never its slug or a real school), a list without its brackets and quotes, and a
    conference by its display name (lgd["conference_names"])."""
    from sim import season
    names = conference_names or {}

    def word(m: re.Match) -> str:
        t = teams.get(m.group(0))
        if t is None:
            return m.group(0)
        return "an FCS opponent" if t.get("fictional") else season.team_display(m.group(0), teams)
    text = re.sub(r"\[([^\]]*)\]", lambda m: m.group(1).replace("'", "").replace('"', ""), str(reason))  # a list of slugs
    text = re.sub(r"\bno (.+?) slate\b", lambda m: f"no {names.get(m.group(1), m.group(1))} slate", text)
    text = re.sub(r"(?<![A-Za-z])[a-z0-9]+(?:-[a-z0-9]+)*", word, text)
    return text.strip().rstrip(".") or "no schedule fits its conferences"


def _count(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def _failed(errors: list[str], total: Optional[int] = None) -> dict:
    """A check that cannot start a career: its sentences (capped) and how many problems there are in all."""
    return {"ok": False, "errors": _capped(errors), "errors_total": len(errors) if total is None else total}


def check(blob: bytes, seed: Optional[int] = None) -> dict:
    """A league file read, checked, merged and filled: what Start Career needs. Errors as sentences
    ({"ok": False, "errors", "errors_total"}: at most MAX_ERRORS and "And N more.", and the full count); an
    import that changes nothing collapses to the built-in league ({"ok": True, "builtin": True, "summary"});
    otherwise the career league (`league`), its engine teams file (`engine`, league.build's), season one's
    games (`games`: generated from the file's conferences with random.Random(f"league-schedule-{seed}") when
    the file changes the league's shape, else None for the real 2026 schedule), `structural` (merge's: no
    real 2026 AP poll then) and the summary ({"name", "added", "changed", "removed", "generated", "lines"};
    `generated`: players the fill made). Anything the fill or the build still throws is one sentence (the
    team's, when it is one team's), with the traceback in the server's log: a check never fails outright."""
    from coach_career import league_fill
    try:
        doc = parse(blob)
    except LeagueFileError as e:
        return _failed(e.errors)
    errs = problems(doc)
    if errs:
        return _failed(errs)
    try:
        return _check_merged(doc, blob, seed)
    except league_fill.TeamBuildError as e:
        _log.error("league check: building %s failed", e.slug, exc_info=e.__cause__ or e)
        return _failed([f"{e.label}: the game could not build this team from the file; compare it with an exported league file."])
    except Exception:  # noqa: BLE001 - the page shows a sentence; the traceback goes to the log
        _log.exception("league check failed")
        return _failed(["The game could not build a league from this file; compare it with an exported league file."])


def _check_merged(doc: dict, blob: bytes, seed: Optional[int]) -> dict:
    """check() after validation: merge, fill, build and schedule."""
    from coach_career import league_fill
    from sim import schedule_gen, season
    merged = merge(doc)
    counts = {"added": len(merged["added"]), "changed": len(merged["changed"]), "removed": len(merged["removed"])}
    if merged["builtin"]:
        return {"ok": True, "builtin": True,
                "summary": {"name": merged["name"], **counts, "generated": 0,
                            "lines": ["The file matches the game's own league, so the career starts from it."]}}
    seed = league_fill.league_seed(blob, seed)          # the fill seed, fixed here: Start plays exactly this league
    lgd, lines = league_fill.to_league(merged, seed)
    generated = sum(max(0, len(lgd["teams"][s]["roster"]) - len(merged["teams"][s].get("roster") or []))
                    for s in set(merged["added"]) | set(merged["changed"]) if s in lgd["teams"])
    engine = league.build(lgd)
    games = None
    if merged["structural"]:
        # the teams as season.load_teams shows them (the stand-ins by region), as offseason.next_season passes them
        teams = {s: (season.stand_in_names({s: dict(t)})[s] if t.get("fictional") else t) for s, t in engine["teams"].items()}
        try:
            games, lgd["schedule_history"] = schedule_gen.generate(
                YEAR, teams, schedule_gen.empty_history(), random.Random(f"league-schedule-{seed}"), lgd["schedule_rules"])
        except schedule_gen.ScheduleError as e:
            return _failed([f"The {YEAR} schedule could not be built for this league: {_plain(str(e), teams, lgd.get("conference_names"))}."])
    lines.append(f"Generated {_count(generated, 'player', 'players')} in all." if generated else "Generated no players.")
    lines.append(f"The {YEAR} schedule is built from the file's conferences." if merged["structural"]
                 else f"The real {YEAR} schedule is kept.")
    return {"ok": True, "builtin": False, "league": lgd, "engine": engine, "games": games, "structural": merged["structural"],
            "seed": seed,
            "summary": {"name": merged["name"], **counts, "generated": generated, "lines": lines}}
