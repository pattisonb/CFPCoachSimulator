"""Filling a league file's rosters (docs/superpowers/specs/2026-11-05-league-file-design.md, "Filling a
Roster"): each team gets a target strength, given overalls and ratings are kept exactly, missing players
and skills are generated from the recruits' position templates, short rosters are topped up, and the
generated players are nudged together so the team lands on its target. Every draw comes from the rng
the caller passes (random.Random(f"league-{seed}-{slug}")), in a fixed order, so a file and a seed
always give the same league."""
from __future__ import annotations

import random
import re
import statistics as st
from functools import lru_cache
from typing import Iterable

from coach_career import league, league_file, offseason, recruits
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
