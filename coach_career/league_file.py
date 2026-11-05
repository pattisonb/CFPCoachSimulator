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
    return v == v and v not in (float("inf"), float("-inf")) and float(v).is_integer() and lo <= v <= hi


def _is_num(v, lo: float, hi: float) -> bool:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return False
    return v == v and lo <= v <= hi


def _say(v) -> str:
    """A value to echo in a sentence: strings only, so nothing like None or NaN reaches the page."""
    return v if isinstance(v, str) else "that value"


def validate(doc: dict) -> list[str]:
    """Every problem in a parsed league file, as sentences (capped at MAX_ERRORS, then "And N more.")."""
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
                        add(f"{label}: the {k} coach must be an object with a name.")
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
        from coach_career import offseason
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

    if len(errs) > MAX_ERRORS:
        more = len(errs) - MAX_ERRORS
        errs = errs[:MAX_ERRORS] + [f"And {more} more."]
    return errs


def checks_label(checks: list[tuple], slug: str) -> str:
    return next((c[0] for c in checks if c[2] == slug), slug)
