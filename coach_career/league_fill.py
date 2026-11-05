"""Filling a league file's rosters (docs/superpowers/specs/2026-11-05-league-file-design.md, "Filling a
Roster"): each team gets a target strength, given overalls and ratings are kept exactly, missing players
and skills are generated from the recruits' position templates, short rosters are topped up, and the
generated players are nudged together so the team lands on its target. Every draw comes from the rng
the caller passes (random.Random(f"league-{seed}-{slug}")), in a fixed order, so a file and a seed
always give the same league."""
from __future__ import annotations

import copy
import hashlib
import random
import re
import statistics as st
from collections import Counter
from functools import lru_cache
from typing import Iterable, Optional

from coach_career import carousel, league, league_file, offseason, programs, recruits
from teamdata import game_scale

STRENGTH_GRADE = {"Elite": 95, "Strong": 75, "Average": 50, "Weak": 20}  # *tune* each word's place among the FBS teams (percentile)
SLOT_STEP = {"starter": 0.0, "backup": -7.0, "depth": -12.0}  # *tune* generated overall by depth slot, against the team's starter level
CLASS_STEP = {"FR": -5.0, "FRRS": -4.0, "SO": -2.5, "SORS": -1.5, "JR": 0.0, "JRRS": 0.5, "SR": 1.0, "SRRS": 1.5}  # *tune* juniors and seniors above freshmen
STAR_STEP = {5: 6.0, 4: 3.0, 3: 0.0, 2: -3.0, 1: -5.0}  # *tune* given stars' lift
PLAYER_SD = 3.0  # *tune* spread of a generated overall around its slot
OVERALL_RANGE = (25, 95)            # a generated player's overall stays in this range
UNIT_WEIGHT = {"offense": 0.45, "defense": 0.45, "special_teams": 0.1}   # league.team_ratings' overall
NUDGE_RANGE = (-30.0, 30.0)         # the common shift of the generated players' overalls, searched by bisection
NUDGE_STEPS = 20
NUDGE_CLOSE = 0.5                   # team overall points from the target that end the search
CLASS_MIX = {"FR": 0.151, "FRRS": 0.122, "SO": 0.086, "SORS": 0.149, "JR": 0.086, "JRRS": 0.153, "SR": 0.069, "SRRS": 0.185}  # *tune* added players' classes (the built-in FBS rosters' mix)
CLASS_LEAD = {"SRRS": 0.0, "JRRS": 0.1, "SR": 0.15, "JR": 0.2, "SORS": 0.3, "SO": 0.4, "FRRS": 0.7, "FR": 0.85}  # *tune* how late in a group's order each class's first player comes (older first, so starters are mostly upperclassmen, as on the built-in rosters)
ROOM_BY_CLASS = {"FR": 0.89, "FRRS": 0.99, "SO": 0.91, "SORS": 0.89, "JR": 0.99, "JRRS": 0.72, "SR": 0.68, "SRRS": 0.0}  # *tune* a generated player's share of a recruit's room to potential, by class (fit to the built-in rosters)
_TEMPLATE_POS = {"FB": "HB"}        # positions with no recruit template borrow a neighbor's
_LB = ("MIKE", "WILL", "SAM")       # the order league.lineup fills the linebacker spots


@lru_cache(maxsize=1)
def _base_tables() -> tuple[dict, dict]:
    """(slug -> team overall, position -> (median height, median weight)) over the built-in FBS league."""
    lgd = league.from_base(league.FIRST_YEAR + 1)
    strengths = {s: league.source_team(lgd, s)["team_ratings"]["overall"] for s in sorted(lgd["teams"])}
    sizes: dict[str, tuple[list, list]] = {}
    for t in lgd["teams"].values():
        for c in t["roster"]:
            h, w = sizes.setdefault(c["pos"], ([], []))
            if c.get("ht"):
                h.append(c["ht"])
            if c.get("wt"):
                w.append(c["wt"])
    med = {p: (int(round(st.median(h))) if h else 74, int(round(st.median(w))) if w else 220) for p, (h, w) in sizes.items()}
    return strengths, med


@lru_cache(maxsize=1)
def base_strengths() -> dict[str, float]:
    """Each built-in FBS team's overall team rating."""
    return dict(_base_tables()[0])


def _percentile(vals: list[float], g: float) -> float:
    vals = sorted(vals)
    x = max(0.0, min(100.0, float(g))) / 100 * (len(vals) - 1)
    i = min(int(x), len(vals) - 2)
    return vals[i] + (x - i) * (vals[i + 1] - vals[i])


def strength_target(team: dict, conference: dict, strengths: dict) -> float:
    """The team overall a team should land on: its `strength` grade's place among the FBS teams, or
    without one its conference's built-in members' mean (the FBS median for a new conference)."""
    grade = team.get("strength")
    if grade is not None:
        g = STRENGTH_GRADE[grade] if isinstance(grade, str) else grade
        return _percentile(list(strengths.values()), g)
    mine = [strengths[s] for s in (conference or {}).get("members") or [] if s in strengths]
    return st.mean(mine) if mine else st.median(strengths.values())


def fit_overall(ours: dict[str, int], pos: str, target: int, keys: Iterable[str]) -> dict[str, int]:
    """`ours` with only `keys` shifted, all by the same amount (each clamped 1 to 99), so that his
    overall is `target` when it can be; otherwise as close as it gets. Ratings are whole numbers and a
    common one-point shift moves the overall about 1.5, so the shift is searched in steps of one point
    on one skill at a time (the heaviest in the overall first): every key moves by the same amount, or
    by one more. The smallest such shift that reaches the target."""
    keys = [k for k in keys if k in ours]
    have = game_scale.overall(ours, pos)
    if have == target or not keys:
        return dict(ours)
    w = (game_scale.data()["overall"].get(pos) or {}).get("w") or {}
    keys.sort(key=lambda k: -w.get(k, 0.0))
    n = len(keys)

    def at(level: int) -> dict[str, int]:
        s, m = divmod(level, n)
        out = dict(ours)
        for i, k in enumerate(keys):
            out[k] = int(max(1, min(99, ours[k] + s + (1 if i < m else 0))))
        return out

    up = have < target
    lo, hi = (0, 99 * n) if up else (-99 * n, 0)
    while hi - lo > 1:                     # up: the first level at or above the target; down: the last at or below
        mid = (lo + hi) // 2
        o = game_scale.overall(at(mid), pos)
        if (o < target) if up else (o <= target):
            lo = mid
        else:
            hi = mid
    cands = [at(hi), at(lo)] if up else [at(lo), at(hi)]
    return min(cands, key=lambda r: abs(game_scale.overall(r, pos) - target))


def starter_level(target: float) -> float:
    """The starters' overall that gives this team overall through league.TEAM_FIT."""
    a = sum(w * league.TEAM_FIT[u][0] for u, w in UNIT_WEIGHT.items())
    b = sum(w * league.TEAM_FIT[u][1] for u, w in UNIT_WEIGHT.items())
    return (target - b) / a


def _slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(name).lower()).strip("-") or "player"


def _unique_id(base: str, taken: set[str]) -> str:
    pid, n = base, 2
    while pid in taken:
        pid, n = f"{base}-{n}", n + 1
    taken.add(pid)
    return pid


def _starters_at(formation: dict, pos: str) -> int:
    """How many starters the formation has at a league position."""
    off, de, sp = (formation.get(u) or {} for u in ("offense", "defense", "special_teams"))
    if pos in _LB:
        return 1 if pos in _LB[:de.get("LB", 0)] else 0
    return off.get(pos) or de.get(pos) or (sp.get(pos) if pos in ("K", "P") else 0) or 0


def _group_positions(formation: dict) -> dict[str, list[tuple[str, float]]]:
    """group -> [(league position, its share of the group)] from the formation (linebackers evenly)."""
    out: dict[str, list] = {}
    for pos, grp in offseason.GROUP.items():
        if pos == "FB" and not (formation.get("offense") or {}).get("FB"):
            continue
        w = 1.0 if pos in _LB else float(_starters_at(formation, pos))
        out.setdefault(grp, []).append((pos, w))
    for grp, lst in out.items():
        if not any(w for _, w in lst):
            out[grp] = [(p, 1.0) for p, _ in lst]
    return out


def _home(p: dict, state) -> str | None:
    h = p.get("hometown")
    if isinstance(h, str) and h.strip():
        tail = h.split(",")[-1].strip()
        return tail if len(tail) == 2 and tail.isalpha() else state
    return state


def _default_formation() -> dict:
    return {"offense": {"QB": 1, "HB": 1, "WR": 3, "TE": 1, "LT": 1, "LG": 1, "C": 1, "RG": 1, "RT": 1},
            "defense": {"LEDG": 1, "REDG": 1, "DT": 2, "LB": 2, "CB": 3, "FS": 1, "SS": 1},
            "special_teams": {"K": 1, "P": 1, "KR": 1, "PR": 1}}


def _team_overall(slug: str, meta: dict, formation: dict, roster: list[dict], attrs: list[str]) -> float:
    lgd = {"year": league_file.YEAR, "attrs": attrs,
           "teams": {slug: {"roster": roster, "coaches": {}, "formation": formation, "meta": meta}}}
    return league.source_team(lgd, slug)["team_ratings"]["overall"]


def fill_roster(team: dict, target: float, rng: random.Random, attrs: list[str], taken: set[str]) -> tuple[list[dict], list[str]]:
    """A file team's roster in the league's form (league.compact's players) and the import summary's
    sentences about it. `taken`: names (lower case) and player ids already used; this team's are added."""
    slug = team["slug"]
    label = team.get("short_name") or team.get("name") or slug
    formation = team.get("formation") or _default_formation()
    state = team.get("state")
    sizes = _base_tables()[1]
    quantiles = recruits.model()["generation"]["rating_quantiles"]
    level = starter_level(target)
    lines: list[str] = []
    roster_in = [p for p in team.get("roster") or [] if isinstance(p, dict)]
    for p in roster_in:
        taken.add(str(p["name"]).strip().lower())

    # 1. depth slots: the depth chart's order first, then roster order, at each position
    charted: dict[str, list[str]] = {}
    for k, names in (team.get("depth_chart") or {}).items():
        charted.setdefault(league_file.POS_IN.get(k, k), []).extend(str(n).strip().lower() for n in names or [])
    by_pos: dict[str, list[int]] = {}
    for i, p in enumerate(roster_in):
        by_pos.setdefault(league_file.POS_IN[p["pos"]], []).append(i)
    place: dict[int, int] = {}
    for pos, idx in by_pos.items():
        order = charted.get(pos, [])
        ranked = sorted(idx, key=lambda i: (order.index(roster_in[i]["name"].strip().lower())
                                            if roster_in[i]["name"].strip().lower() in order else len(order), i))
        for n, i in enumerate(ranked):
            place[i] = n

    def slot(pos: str, n: int) -> str:
        k = _starters_at(formation, pos)
        return "starter" if n < k else "backup" if n < 2 * k else "depth"

    def generate(pos: str, cls: str, stars, n: int) -> tuple[dict, str, float, dict]:
        """(template ratings on our scale, archetype, raw overall target, room to potential): steps 5 and 6's draws."""
        tpos = _TEMPLATE_POS.get(pos, pos)
        s = max(2, min(5, int(stars or 3)))
        band = str(s)
        ea, arche = recruits._attributes(rng, tpos, band, quantiles[band][3])
        ours = game_scale.from_ea(ea, pos)
        ours = {k: ours.get(k, 50) for k in attrs}
        raw = level + SLOT_STEP[slot(pos, n)] + CLASS_STEP.get(cls, 0.0) + STAR_STEP.get(stars, 0.0) + rng.gauss(0, PLAYER_SD)
        tmpl = fit_overall(ours, pos, _clamp_overall(raw), attrs)
        pot = game_scale.potential_from_ea(recruits._potential(rng, tpos, s, ea), ours, pos)
        share = ROOM_BY_CLASS.get(cls, 1.0)
        room = {k: int(round(share * max(0, pot.get(k, ours[k]) - ours[k]))) for k in attrs}
        return tmpl, arche, raw, room

    def coach(p: dict) -> str:
        return p.get("coachability") or recruits.weighted(rng, ((nm, sh) for nm, _, sh in recruits.COACHABILITY))

    out: list[dict] = []
    gen: list[tuple[int, dict, float, dict, dict]] = []   # (index in out, template, raw target, room, given potential)
    for i, p in enumerate(roster_in):
        pos = league_file.POS_IN[p["pos"]]
        cls = p["class"]
        given_r = {k: int(v) for k, v in (p.get("ratings") or {}).items() if k in attrs}
        given_o = p.get("overall")
        pid = p.get("id")
        if pid:
            taken.add(pid)
        else:
            pid = _unique_id(f"{slug}-{_slugify(p['name'])}", taken)
        if len(given_r) == len(attrs):
            ours = {k: given_r[k] for k in attrs}
            formula = game_scale.overall(ours, pos)
            o = formula if given_o is None else int(given_o)
            if abs(o - formula) > 1:
                ours = fit_overall(ours, pos, o, attrs)
                lines.append(f"{label}: {p['name']}'s ratings were moved to match his overall {o}.")
            q = {**p, "id": pid, "pos": league_file._FILE_POS.get(pos, pos), "overall": o, "ratings": ours}
            if p.get("potential") is None:
                _, _, _, room = generate(pos, cls, p.get("stars"), place[i])
                q["potential"] = {k: min(99, ours[k] + room[k]) for k in attrs if room[k] > 0}
            c = league_file.player_compact(q, attrs)
            c["c"] = coach(p)
            if c["dev"] is None:
                c["dev"] = "Normal"
            if c["yrs"] is None:
                c["yrs"] = league.EXPERIENCE.get(cls, 0)
            if c["home"] is None:
                c["home"] = state
            out.append(c)
            continue
        tmpl, arche, raw, room = generate(pos, cls, p.get("stars"), place[i])
        if given_r:
            ours = {**tmpl, **given_r}
            missing = [k for k in attrs if k not in given_r]
            ours = fit_overall(ours, pos, int(given_o) if given_o is not None else game_scale.overall(tmpl, pos), missing)
        elif given_o is not None:
            ours = fit_overall(tmpl, pos, int(given_o), attrs)
        else:
            ours = tmpl
        c = _compact(p, pid, pos, cls, ours, room, arche, coach(p), attrs, sizes, state)
        if given_o is not None:
            c["o"] = int(given_o)
        out.append(c)
        if not given_r and given_o is None:
            gen.append((len(out) - 1, tmpl, raw, room, p.get("potential") or {}))

    # 7. short rosters: an empty one to the healthy counts, a short group to its floor
    counts = {g: 0 for g in offseason.FLOOR}
    at_pos: dict[str, int] = {}
    for c in out:
        counts[offseason.GROUP[c["pos"]]] += 1
        at_pos[c["pos"]] = at_pos.get(c["pos"], 0) + 1
    want = offseason.TARGET if not out else offseason.FLOOR
    groups = _group_positions(formation)
    added: list[tuple[int, str]] = []
    for grp in offseason.FLOOR:
        for cls in _class_order(max(0, want[grp] - counts[grp])):
            pos = min(groups[grp], key=lambda pw: (at_pos.get(pw[0], 0) / pw[1] if pw[1] else float("inf")))[0]
            tmpl, arche, raw, room = generate(pos, cls, None, at_pos.get(pos, 0))
            at_pos[pos] = at_pos.get(pos, 0) + 1
            p = {"class": cls}
            c = _compact(p, "", pos, cls, tmpl, room, arche, coach(p), attrs, sizes, state)
            out.append(c)
            gen.append((len(out) - 1, tmpl, raw, room, {}))
            added.append((len(out) - 1, grp))
    for j, _ in added:
        name = recruits._name(rng, taken)
        out[j]["n"] = name
        out[j]["id"] = _unique_id(f"{slug}-{_slugify(name)}", taken)
    if added:
        if not roster_in:
            lines.append(f"{label}: {len(added)} players generated (the roster was empty).")
        else:
            per = {}
            for _, grp in added:
                per[grp] = per.get(grp, 0) + 1
            parts = ", ".join(f"{n} {g}" for g, n in per.items())
            word = "player" if len(added) == 1 else "players"
            lines.append(f"{label}: {len(added)} {word} added to reach the position floors ({parts}).")

    # 8. the nudge: one common shift of the generated players' overalls lands the team on its target
    if gen:
        meta = {"slug": slug, "short_name": label, "state": state}

        def shifted(d: float) -> list[dict]:
            res = list(out)
            for j, tmpl, raw, room, gpot in gen:
                ours = fit_overall(tmpl, res[j]["pos"], _clamp_overall(raw + d), attrs)
                res[j] = _with_ratings(res[j], ours, room, gpot, attrs)
            return res

        lo, hi = NUDGE_RANGE
        best = None
        for _ in range(NUDGE_STEPS):
            mid = (lo + hi) / 2
            cand = shifted(mid)
            got = _team_overall(slug, meta, formation, cand, attrs)
            if best is None or abs(got - target) < best[0]:
                best = (abs(got - target), cand)
            if abs(got - target) <= NUDGE_CLOSE:
                break
            if got < target:
                lo = mid
            else:
                hi = mid
        out = best[1]
    return out, lines


def _class_order(n: int) -> list[str]:
    """The classes of n players added to a group, in the order they are added: CLASS_MIX's counts
    (largest remainders), each class spread evenly through the order with the older ones first."""
    if n <= 0:
        return []
    exact = {c: n * w / sum(CLASS_MIX.values()) for c, w in CLASS_MIX.items()}
    count = {c: int(x) for c, x in exact.items()}
    for c in sorted(exact, key=lambda c: (-(exact[c] - count[c]), CLASS_LEAD[c]))[:n - sum(count.values())]:
        count[c] += 1
    keys = [((i + CLASS_LEAD[c]) / count[c], CLASS_LEAD[c], c) for c in count for i in range(count[c])]
    return [c for _, _, c in sorted(keys)]


def _clamp_overall(x: float) -> int:
    return int(round(max(OVERALL_RANGE[0], min(OVERALL_RANGE[1], x))))


def _with_ratings(c: dict, ours: dict, room: dict, gpot: dict, attrs: list[str]) -> dict:
    """The compact player `c` with these ratings, his room carried over (a given potential kept)."""
    c = dict(c)
    c["r"] = [int(ours[k]) for k in attrs]
    c["g"] = [max(0, int(gpot[k]) - ours[k]) if k in gpot else max(0, min(99, ours[k] + room[k]) - ours[k]) for k in attrs]
    c["o"] = game_scale.overall(ours, c["pos"])
    return c


def _compact(p: dict, pid: str, pos: str, cls: str, ours: dict, room: dict, arche: str, coachability: str,
             attrs: list[str], sizes: dict, state) -> dict:
    """A generated or partly given player in league.compact's form."""
    ht, wt = sizes.get(pos, (74, 220))
    pot = {k: min(99, ours[k] + room[k]) for k in attrs}
    src = {"slug": pid, "name": p.get("name", ""), "position": pos, "class": cls, "height": p.get("height") or ht,
           "weight_lbs": p.get("weight") or wt, "jersey": p.get("jersey"), "archetype": p.get("archetype") or arche,
           "dev_trait": p.get("dev") or "Normal", "coachability": coachability, "stars": p.get("stars"),
           "ours": ours, "potential_ours": pot, "yrs": p.get("years"), "abilities": p.get("abilities"),
           "target_mult": p.get("target_share")}
    c = league.compact(src, attrs, _home(p, state))
    gpot = p.get("potential") or {}
    if gpot:
        c["g"] = [max(0, int(gpot[k]) - ours[k]) if k in gpot else g for k, g in zip(attrs, c["g"])]
    return c



# ---- A new team's coaches, program, recruiting model and identity; the career league ----------

NEUTRAL_COLORS = {"primary": {"name": "Gray", "hex": "#5A6270"}, "secondary": {"name": "White", "hex": "#FFFFFF"}, "accent": None}  # *tune* a team without colors (no accent: the neutral pill border)
NEW_STADIUM_CAPACITY = 30000  # *tune* a new team's stadium when the file gives none
COACH_YEAR = league.FIRST_YEAR  # a generated coach's first season
NEW_TEAM_TIER = "Group of 5"  # a new team's recruiting tier
US_CENTER = (39.8283, -98.5795)  # a new team with no state or location
_COACH_ROLES = league_file._COACH_ROLES
_IDENTITY = ("name", "short_name", "abbreviation", "mascot", "city", "state", "conference", "colors", "stadium", "home_field", "rivals")


def _state_center() -> dict[str, tuple[float, float]]:
    out = {}
    for state, towns in recruits.model()["generation"]["towns"].items():
        pts = [(float(t[1]), float(t[2]), float(t[3])) for t in towns
               if len(t) >= 4 and isinstance(t[2], (int, float)) and isinstance(t[3], (int, float))]
        w = sum(n for n, _, _ in pts)
        if pts and w > 0:
            out[state] = (round(sum(n * a for n, a, _ in pts) / w, 4), round(sum(n * b for n, _, b in pts) / w, 4))
    return out


STATE_CENTER: dict[str, tuple[float, float]] = _state_center()   # each state's town-weighted center (recruits' towns)


@lru_cache(maxsize=1)
def _base_league() -> dict:
    """The built-in league (read only): what new teams borrow coaches, styles and programs from."""
    return league.from_base(league.FIRST_YEAR)


def _members(conf: Optional[dict], lgd: dict) -> list[str]:
    """The conference's built-in members (sorted); every built-in team for a new conference."""
    mine = sorted(s for s in (conf or {}).get("members") or [] if s in lgd["teams"])
    return mine or sorted(lgd["teams"])


def _common(words: list) -> Optional[str]:
    words = [w for w in words if w]
    return min(set(words), key=lambda w: (-words.count(w), w)) if words else None


def _median(vals: list, default=None):
    vals = [v for v in vals if isinstance(v, (int, float)) and not isinstance(v, bool)]
    return st.median(vals) if vals else default


def _head(team: dict) -> dict:
    c = team.get("coaches") or {}
    return c.get("head_coach") or (c.get("head") if isinstance(c.get("head"), dict) else None) or {}


def _schemes(conf: Optional[dict], lgd: dict) -> tuple[str, str, str]:
    """(most common offensive philosophy, defensive philosophy, the first member carrying both) among the
    conference's built-in head coaches (FBS-wide for a new conference)."""
    mem = _members(conf, lgd)
    sc = {s: lgd["teams"][s]["coaches"]["head_coach"].get("scheme") or {} for s in mem}
    off = _common([v.get("offensive_philosophy") for v in sc.values()])
    de = _common([v.get("defensive_philosophy") for v in sc.values() if v.get("offensive_philosophy") == off])
    carrier = next(s for s in mem if sc[s].get("offensive_philosophy") == off and sc[s].get("defensive_philosophy") == de)
    return off, de, carrier


def _initials(name: str) -> str:
    words = re.findall(r"[A-Za-z0-9]+", name)
    return "".join(w[0] for w in words[:4]).upper() or name[:4].upper()


def team_meta_doc(team: dict, conf_name: str) -> dict:
    """A new team's identity in the source format (league.base_meta's shape), with the defaults filled in."""
    name = team["name"].strip()
    short = team.get("short_name") or name
    hf = team.get("home_field")
    if hf is None:
        same = [league.base_meta(s) for s in league.base_slugs()
                if not league.base_meta(s)["fictional"] and league.base_meta(s)["conference"] == conf_name]
        if not same:
            same = [league.base_meta(s) for s in league.base_slugs() if not league.base_meta(s)["fictional"]]
        hf = int(round(_median([m["program"]["home_field_advantage"] for m in same], 50)))
    prestige = team.get("prestige")
    if prestige is None:
        prestige = programs.BASE_DEFAULT["prestige"]
    colors = dict(NEUTRAL_COLORS)
    if isinstance(team.get("colors"), dict):
        colors = {k: copy.deepcopy(team["colors"].get(k)) or (NEUTRAL_COLORS[k] if k != "accent" else None)
                  for k in ("primary", "secondary", "accent")}
    return {"slug": team["slug"], "school_name": name, "short_name": short,
            "abbreviation": team.get("abbreviation") or _initials(name),
            "mascot": team.get("mascot") or name.split()[-1], "city": team.get("city"), "state": team.get("state"),
            "conference": conf_name, "subdivision": "FBS",
            "stadium": copy.deepcopy(team.get("stadium")) or {"name": f"{short} Stadium", "capacity": NEW_STADIUM_CAPACITY, "surface": "turf"},
            "colors": colors, "rivals": list(team.get("rivals") or []), "fictional": False,
            "program": {"prestige": 1 + round(5 * prestige / 100), "home_field_advantage": hf, "generated": True},
            "roster_size": len(team.get("roster") or []) or sum(offseason.TARGET.values())}


def _set_rating(c: dict, rating) -> None:
    """The coach's overall set to `rating`, his other ratings shifted by the same amount."""
    shift = int(round(rating)) - c["ratings"]["overall"]
    c["ratings"] = {k: int(max(1, min(99, v + shift))) for k, v in c["ratings"].items()}
    c["ratings"]["overall"] = int(round(rating))


def coaches_for(team: dict, conf: dict, lgd: dict, rng: random.Random, taken: Optional[set[str]] = None) -> dict:
    """A file team's staff in the league's form: each role the file leaves out is generated like the
    coach market's hires (carousel.generated), carrying the conference's most common scheme; a given
    name or rating replaces the generated one; a role given with full ratings (a built-in coach, the
    file's edits merged over him) is kept, with a given `rating` applied. `taken`: coach names (lower
    case) already in the league; a generated name never repeats one, and this staff's are added."""
    taken = set() if taken is None else taken
    slug = team["slug"]
    given = team.get("coaches") or {}
    off_c, def_c, carrier = _schemes(conf, lgd)
    off = given.get("offense") if isinstance(given.get("offense"), str) else None
    de = given.get("defense") if isinstance(given.get("defense"), str) else None
    out = {}
    for key, role in _COACH_ROLES:
        g = given.get(key) if isinstance(given.get(key), dict) else {}
        model_keys = set(lgd["teams"][carrier]["coaches"][role]["ratings"])
        gr = g.get("ratings") if isinstance(g.get("ratings"), dict) else {}
        if gr and model_keys <= set(gr):
            c = copy.deepcopy(g)
            rating = c.pop("rating", None)
            if rating is not None:
                _set_rating(c, rating)
        else:
            c = carousel.generated(rng, lgd, role, slug, COACH_YEAR, like=lgd["teams"][carrier]["coaches"][role])
            c.pop("alma_mater", None)
            c.update(team_slug=slug, role=role, is_interim=False)
            if g.get("name"):
                c["name"] = str(g["name"]).strip()
            elif c["name"].lower() in taken:
                c["name"] = recruits._name(rng, taken)
            c["ratings"].update({k: int(v) for k, v in gr.items() if k in c["ratings"]})
            if g.get("rating") is not None:
                _set_rating(c, g["rating"])
            c.setdefault("scheme", {})
            if role == "head_coach":
                c["scheme"]["offensive_philosophy"] = off_c
                c["scheme"]["defensive_philosophy"] = def_c
            elif role == "offensive_coordinator":
                c["scheme"]["offensive_scheme"] = off_c
            else:
                c["scheme"]["defensive_scheme"] = def_c
        sc = c.setdefault("scheme", {})
        if off and role in ("head_coach", "offensive_coordinator"):
            sc["offensive_philosophy" if role == "head_coach" else "offensive_scheme"] = off
        if de and role in ("head_coach", "defensive_coordinator"):
            sc["defensive_philosophy" if role == "head_coach" else "defensive_scheme"] = de
        if c.get("name"):
            taken.add(str(c["name"]).lower())
        out[role] = c
    return out


def style_and_formation(team: dict, conf: dict, lgd: dict) -> tuple[str, dict]:
    """(style, formation): the alphabetically first built-in conference member whose head coach plays the
    team's head coach's offense (FBS-wide when none in the conference does); the conference's most common
    scheme's carrier when no team plays it."""
    want = (_head(team).get("scheme") or {}).get("offensive_philosophy") or (team.get("coaches") or {}).get("offense")
    if not want:
        want = _schemes(conf, lgd)[0]

    def plays(s):
        return (lgd["teams"][s]["coaches"]["head_coach"].get("scheme") or {}).get("offensive_philosophy") == want

    mine = sorted(s for s in (conf or {}).get("members") or [] if s in lgd["teams"])
    style = next((s for s in mine if plays(s)), None) or next((s for s in sorted(lgd["teams"]) if plays(s)), None)
    style = style or _schemes(conf, lgd)[2]
    return style, copy.deepcopy(lgd["teams"][style]["formation"])


def program_for(team: dict, conf: dict, lgd: dict) -> dict:
    """A new team's program (programs.init's shape): prestige from the file or the conference's mean,
    winning, NIL and conference strength the conference's medians, a new program's market."""
    mine = sorted(s for s in (conf or {}).get("members") or [] if s in lgd["teams"])
    progs = [lgd["teams"][s]["program"] for s in mine]
    pr = team.get("prestige")
    if pr is None:
        pr = st.mean(p["prestige"] for p in progs) if progs else programs.BASE_DEFAULT["prestige"]
    p = {"history": float(pr), "prestige": float(pr)}
    for k in ("winning", "nil", "conference"):
        p[k] = float(_median([q[k] for q in progs], programs.BASE_DEFAULT[k]))
    p["market"] = programs.MARKET_DEFAULT
    hc = _head(team)
    overall = (hc.get("ratings") or {}).get("overall", hc.get("rating"))
    p["coach"] = float(overall) if overall is not None else programs.BASE_DEFAULT["coach"]
    p["rating"] = round(programs.mix(p), 1)
    p["tier"] = programs.tier_of(p["rating"])
    return dict(p, market_base=p["market"], nil_base=p["nil"], winning_base=p["winning"], conference_base=p["conference"],
                live=0.0, seasons=[], year=league.FIRST_YEAR - 1)


def _tree_median(vals: list, missing_zero: bool = False):
    """Per-key medians of number dicts (missing keys count as 0 when `missing_zero`)."""
    keys = sorted({k for v in vals if isinstance(v, dict) for k in v})
    out = {}
    for k in keys:
        col = [v.get(k, 0 if missing_zero else None) for v in vals if isinstance(v, dict)]
        m = _median(col)
        if m is not None:
            out[k] = round(m, 3)
    return out


def _location(team: dict, members: list[dict]) -> list[float]:
    if isinstance(team.get("lat"), (int, float)) and isinstance(team.get("lon"), (int, float)):
        return [team["lat"], team["lon"]]
    if team.get("state") in STATE_CENTER:
        return list(STATE_CENTER[team["state"]])
    locs = [m["location"] for m in members if m.get("location")]
    return [round(st.mean(a for a, _ in locs), 4), round(st.mean(b for _, b in locs), 4)] if locs else list(US_CENTER)


def recruiting_model_for(team: dict, conf: dict, strength: float) -> dict:
    """A new team's recruiting model (recruiting_model.json's per-team shape): the conference members'
    medians (FBS-wide for a new conference), the baseline of the built-in team nearest in strength."""
    tms = recruits.model()["teams"]
    strengths = {s: v for s, v in base_strengths().items() if s in tms}
    mine = sorted(s for s in (conf or {}).get("members") or [] if s in strengths) or sorted(strengths)
    rows = [tms[s] for s in mine]
    in_state = round(_median([r.get("in_state_share") for r in rows], 0.0), 3)
    nearest = min(sorted(strengths), key=lambda s: abs(strengths[s] - strength))
    return {"tier": NEW_TEAM_TIER,
            "class_size": {"mean": round(_median([(r.get("class_size") or {}).get("mean") for r in rows], 20.0), 1), "by_year": {}},
            "star_share": _tree_median([r.get("star_share") or {} for r in rows], True),
            "blue_chip_share": round(_median([r.get("blue_chip_share") for r in rows], 0.0), 3),
            "avg_rating": round(_median([r.get("avg_rating") for r in rows], 0.0), 4), "signees": 0,   # no signing history of its own
            "positions_per_class": _tree_median([r.get("positions_per_class") or {} for r in rows], True),
            "in_state_share": in_state,
            "top_states": [[team["state"], in_state]] if team.get("state") else [],
            "distance_miles": _tree_median([r.get("distance_miles") or {} for r in rows]),
            "location": _location(team, rows), "last_season": None,
            "strength": {"baseline": (tms[nearest].get("strength") or {}).get("baseline"), "by_class": {}}}


def _meta_edit(slug: str, doc: dict, base_doc: dict, conf_name: str) -> dict:
    """A built-in team's identity with the file's changes over it."""
    m = copy.deepcopy(league.base_meta(slug))
    for k_doc, k_meta in (("name", "school_name"), ("short_name", "short_name"), ("abbreviation", "abbreviation"),
                          ("mascot", "mascot"), ("city", "city"), ("state", "state")):
        if doc.get(k_doc) != base_doc.get(k_doc) and doc.get(k_doc) is not None:
            m[k_meta] = doc[k_doc]
    m["conference"] = conf_name
    if doc.get("colors") != base_doc.get("colors") and isinstance(doc.get("colors"), dict):
        m["colors"] = {k: copy.deepcopy(doc["colors"].get(k)) or (NEUTRAL_COLORS[k] if k != "accent" else None)
                       for k in ("primary", "secondary", "accent")}
    if doc.get("stadium") != base_doc.get("stadium") and isinstance(doc.get("stadium"), dict):
        m["stadium"] = {**m.get("stadium", {}), **doc["stadium"]}
    if doc.get("home_field") != base_doc.get("home_field") and doc.get("home_field") is not None:
        m["program"] = {**m["program"], "home_field_advantage": doc["home_field"]}
    if doc.get("rivals") != base_doc.get("rivals"):
        stand_ins = [r for r in m.get("rivals") or [] if r in league.base_slugs() and league.base_meta(r)["fictional"]]
        m["rivals"] = list(doc.get("rivals") or []) + stand_ins
    return m


def _depth(doc: dict, roster: list[dict]) -> dict:
    by_name = {c["n"].strip().lower(): c["id"] for c in roster}
    out = {}
    for k, names in (doc.get("depth_chart") or {}).items():
        role = league_file.POS_IN.get(k, k)
        out.setdefault(role, []).extend(by_name[n.strip().lower()] for n in names or []
                                        if isinstance(n, str) and n.strip().lower() in by_name)
    return out


def to_league(merged: dict, seed: int) -> tuple[dict, list[str]]:
    """A merged, checked league file as a career league (state["league"]; league.from_base's shape) and
    the import summary's sentences. Built-in teams the file leaves alone are the built-in league's."""
    base = _base_league()
    docs = league_file._builtin_docs()
    lgd = league.from_base(league.FIRST_YEAR)
    for s in merged["removed"]:
        lgd["teams"].pop(s, None)
    attrs = lgd["attrs"]
    strengths = base_strengths()
    conf_of = {s: c for c in merged["conferences"].values() for s in c["members"]}
    added = set(merged["added"])
    work = [s for s in sorted(set(merged["added"]) | set(merged["changed"])) if s in merged["teams"]]

    refill = {s for s in work if s in added or merged["teams"][s].get("roster") != docs[s].get("roster")}
    taken: set[str] = set()
    for s, t in lgd["teams"].items():                # every kept player's id and name, and every id the file gives
        if s not in refill:
            for c in t["roster"]:
                taken.add(c["id"])
                taken.add(c["n"].strip().lower())
    for s in refill:
        taken.update(p["id"] for p in merged["teams"][s].get("roster") or [] if isinstance(p, dict) and p.get("id"))

    models: dict[str, dict] = {}
    fill_lines: list[str] = []
    coach_names = carousel._taken_names(lgd)        # every coach name already in the league (lower case)
    for slug in work:
        doc = merged["teams"][slug]
        conf = merged["conferences"].get(doc.get("conference")) or {"members": []}
        conf_name = conf.get("name") or str(doc.get("conference"))
        rng = random.Random(f"league-{seed}-{slug}")
        new = slug in added
        bdoc = docs.get(slug, {})
        entry = lgd["teams"].setdefault(slug, {})
        if new or doc.get("coaches") != bdoc.get("coaches"):
            entry["coaches"] = coaches_for(doc, conf, base, rng, coach_names)
            if not new and entry["coaches"]["head_coach"] != base["teams"][slug]["coaches"]["head_coach"]:
                p = entry["program"]              # a new or edited head coach: the program's coach appeal follows him
                p["coach"] = float(entry["coaches"]["head_coach"]["ratings"]["overall"])
                p["rating"] = round(programs.mix(p), 1)
                p["tier"] = programs.tier_of(p["rating"])
        built = {**doc, "coaches": entry["coaches"]}
        if new:
            style, formation = style_and_formation(built, conf, base)
            entry["style"] = doc.get("style") or style
            entry["formation"] = copy.deepcopy(doc.get("formation")) or formation
            entry["program"] = program_for(built, conf, base)
            entry["meta"] = team_meta_doc({**doc, "prestige": entry["program"]["prestige"]}, conf_name)
        else:
            if doc.get("formation") != bdoc.get("formation") and doc.get("formation"):
                entry["formation"] = copy.deepcopy(doc["formation"])
            if doc.get("style") != bdoc.get("style") and doc.get("style"):
                entry["style"] = doc["style"]
            if any(doc.get(k) != bdoc.get(k) for k in _IDENTITY):
                entry["meta"] = _meta_edit(slug, doc, bdoc, conf_name)
            if doc.get("prestige") != bdoc.get("prestige") and doc.get("prestige") is not None:
                p = entry["program"]
                p["prestige"] = p["history"] = float(doc["prestige"])
                p["rating"] = round(programs.mix(p), 1)
                p["tier"] = programs.tier_of(p["rating"])
                entry.setdefault("meta", copy.deepcopy(league.base_meta(slug)))
                entry["meta"]["program"] = {**entry["meta"]["program"], "prestige": 1 + round(5 * float(doc["prestige"]) / 100)}
        if slug in refill:
            target = strength_target(doc, conf, strengths)
            team = {**doc, "formation": entry["formation"]}
            if not new:
                team.setdefault("short_name", league.base_meta(slug)["short_name"])
            entry["roster"], more = fill_roster(team, target, rng, attrs, taken)
            fill_lines += more
            if "meta" in entry:
                entry["meta"]["roster_size"] = len(entry["roster"])
        else:
            target = strengths.get(slug, st.median(strengths.values()))
        if doc.get("depth_chart"):
            entry["depth"] = _depth(doc, entry["roster"])
        if new:
            models[slug] = recruiting_model_for(doc, conf, target)
        elif any(doc.get(k) != bdoc.get(k) for k in ("lat", "lon", "state")):
            m = copy.deepcopy(recruits.model()["teams"].get(slug) or {})
            if (doc.get("lat"), doc.get("lon")) != (bdoc.get("lat"), bdoc.get("lon")) and _location(doc, []) != list(US_CENTER):
                m["location"] = _location(doc, [])
            elif doc.get("state") in STATE_CENTER:      # moved to another state, no new lat/lon: the state's center
                m["location"] = list(STATE_CENTER[doc["state"]])
            if doc.get("state") != bdoc.get("state") and doc.get("state"):
                share = m.get("in_state_share") or 0.0
                m["top_states"] = [[doc["state"], share]] + [r for r in m.get("top_states") or []
                                                             if r[0] not in (doc["state"], bdoc.get("state"))]
            models[slug] = m

    lgd["source"] = {"format": league_file.FORMAT, "name": merged["name"]}
    lgd["recruiting_models"] = models
    lgd["schedule_rules"] = league_file.schedule_rules(merged)   # the generator's rules_override (offseason.next_season)
    lgd["divisions"] = league_file.divisions(merged)             # season.divisions
    n_add, n_chg, n_rem = len(merged["added"]), len(merged["changed"]), len(merged["removed"])
    lines = [f"{n_add} {'team' if n_add == 1 else 'teams'} added, {n_chg} changed and {n_rem} removed."] + fill_lines
    return lgd, lines


def league_seed(blob: bytes, seed: Optional[int]) -> int:
    """The seed a league is filled with: the one asked for, else one read from the file's bytes."""
    if seed is not None:
        return int(seed)
    return int(hashlib.sha256(bytes(blob)).hexdigest()[:8], 16)
