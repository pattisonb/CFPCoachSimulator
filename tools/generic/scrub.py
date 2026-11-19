"""Swap every real name in a staged copy of the project for a lookalike, so the published site carries none.

    scrub.run(root)      # `root`: a copy made by tools/build_site.py (never the repository itself)

What changes (tables.py holds the hand-written names):
  - schools: short name, full name, mascot, stadium, the slug the address bar shows, colors where the shade or its
    name is a school's own
  - players and coaches: a drawn name with the same initials ("Julian Sayin" may become "Jalen Shaw"), the same
    for every build (seeded by the real name), and their slugs with it
  - bowls, conferences, rivalry games and trophies, FCS opponents, awards, leagues and networks
  - fields that only cite the real world (source links, notes) are dropped

How: the name-bearing data files are edited by field first, then every string in every staged file (JSON keys and
values, Python and TypeScript source) goes through one swap: a whole-string lookup, then a whole-word phrase
pattern, longest phrase first. `terms(root)` lists the real names a build must not contain (tests/test_generic_names.py).
"""
from __future__ import annotations

import hashlib
import json
import random
import re
from pathlib import Path

from tools.generic import tables

SUFFIXES = {"Jr.", "Jr", "Sr.", "Sr", "II", "III", "IV", "V"}
DONE = "\x00"     # marks a string a field edit already wrote: the swap passes it through (and takes the mark off)
GENERIC_STADIUMS = {"Memorial Stadium", "Alumni Stadium", "University Stadium", "Tiger Stadium", "Rose Bowl",
                    "Veterans Memorial Stadium", "War Memorial Stadium", "Williams Stadium", "Delaware Stadium"}
DROP_KEYS = frozenset({"verification", "url", "sources", "article", "notes"})     # fields that only cite the real world


def slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.lower().replace("'", "").replace(".", "")).strip("-")
    return s or "x"


def _seed(*parts: str) -> random.Random:
    return random.Random(hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest())


def _read(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _write(path: Path, data) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


# ---- people ---------------------------------------------------------------------------------------------------

class Names:
    """Draws a lookalike for a real person's name: same initials, seeded by the real name, never a real name."""

    def __init__(self, root: Path, real: set[str], blocked: set[str]):
        pools = _read(root / "data" / "recruiting_model.json")["players"]["names"]
        self.pool = {"first": {}, "last": {}}
        for kind in ("first", "last"):
            for name, count in pools[kind]:
                if name and name[0].isalpha() and count >= 3 and name not in blocked:
                    self.pool[kind].setdefault(name[0].upper(), []).append(name)
            for letter, spare in tables.SPARE_NAMES[kind].items():
                self.pool[kind].setdefault(letter, []).extend(spare)
        self.real = {self._base(n) for n in real}       # without "Jr." and the like: "Duke Watson II" is Duke Watson
        self.made: dict[str, str] = {}
        self.taken: set[str] = set()

    @classmethod
    def _base(cls, name: str) -> str:
        first, last, _ = cls._parts(name)
        return f"{first} {last}".strip()

    @staticmethod
    def _parts(name: str) -> tuple[str, str, str]:
        words = name.replace(",", " ").split()
        suffix = ""
        while len(words) > 1 and words[-1] in SUFFIXES:
            suffix = words.pop()
        return words[0], (words[-1] if len(words) > 1 else ""), suffix

    def _pick(self, kind: str, word: str, rng: random.Random) -> str:
        letter = next((ch.upper() for ch in word if ch.isalpha()), "A")
        pool = self.pool[kind].get(letter) or self.pool[kind]["A"]
        choices = [n for n in pool if n.lower() != word.lower()] or pool
        return rng.choice(choices)

    def of(self, name: str) -> str:
        if name in self.made:
            return self.made[name]
        first, last, suffix = self._parts(name)
        for attempt in range(200):
            rng = _seed("person", name, str(attempt))
            new = self._pick("first", first, rng)
            if last:
                new += " " + self._pick("last", last, rng)
            base = new
            if suffix:
                new += " " + suffix
            if base not in self.real and new not in self.taken:
                break
        self.taken.add(new)
        self.made[name] = new
        return new


# ---- the maps -------------------------------------------------------------------------------------------------

class Maps:
    """Every swap a build makes, read from the staged project before anything is changed."""

    def __init__(self, root: Path):
        self.root = root
        self.teams = {p.stem: _read(p) for p in sorted((root / "cfb_sim_data" / "teams").glob("*.json"))}
        self.real_teams = {s: t for s, t in self.teams.items() if not t.get("fictional")}
        missing = sorted(set(self.real_teams) - set(tables.TEAMS))
        if missing:
            raise KeyError(f"tools/generic/tables.py TEAMS has no lookalike for: {', '.join(missing)}")
        sched = _read(root / "data" / "schedules.json")
        self.espn_names = {s: (v.get("espn_name") or "") for s, v in sched["teams"].items()}

        self.team: dict[str, dict] = {}      # slug -> the lookalike identity
        for slug, t in self.real_teams.items():
            new_short, abbr, mascot = tables.TEAMS[slug]
            self.team[slug] = {
                "slug": slugify(new_short), "short": new_short, "abbr": abbr,
                "school": f"{new_short} University", "mascot": mascot,
                "stadium": self._stadium(slug, t, mascot),
            }
        new_slugs = [v["slug"] for v in self.team.values()]
        assert len(set(new_slugs)) == len(new_slugs), "two schools share a lookalike slug"
        self.slug = {s: v["slug"] for s, v in self.team.items() if v["slug"] != s}

        # people
        players: dict[str, str] = {}         # real slug -> real name
        coaches: set[str] = set()
        for t in self.real_teams.values():
            for p in t.get("roster", []):
                players[p["slug"]] = p["name"]
            for c in (t.get("coaches") or {}).values():
                if c and c.get("name"):
                    coaches.add(c["name"])
                if c and c.get("co_coordinator"):
                    coaches.add(c["co_coordinator"])
        for c in _read(root / "cfb_sim_data" / "coaches.json"):
            coaches.add(c["name"])
        coaches |= set(_read(root / "data" / "coach_birth_years.json").get("birth_years", {}))
        model = _read(root / "data" / "recruiting_model.json")
        coaches |= {v["coach"] for v in model.get("coaches", {}).get("current", {}).values() if v.get("coach")}
        coaches = {c for c in coaches if c and " " in c}
        self.real_people = set(players.values()) | coaches
        blocked = set(tables.MARKS) | tables.DISTINCT_MASCOTS | {t["short_name"] for t in self.real_teams.values()}
        names = Names(root, self.real_people, blocked)
        self.person = {n: names.of(n) for n in sorted(self.real_people)}
        self.coaches = coaches
        self.player_slug: dict[str, str] = {}
        used: set[str] = set()
        for slug in sorted(players):
            base = slugify(self.person[players[slug]])
            new, n = base, 2
            while new in used or new in players:
                new, n = f"{base}-{n}", n + 1
            used.add(new)
            self.player_slug[slug] = new

        self.fcs = self._fcs(sched)

        # whole strings, swapped only when a string is exactly this
        self.exact: dict[str, str] = {}
        self.exact.update(self.person)
        self.exact.update(self.player_slug)
        self.exact.update(self.slug)
        self.exact.update(tables.CONFERENCES_EXACT)
        self.team_exact = {t["short_name"]: self.team[s]["short"] for s, t in self.real_teams.items()}
        for old, new in self.team_exact.items():
            if old in tables.LOOSE:
                self.exact[old] = new
        # phrases, swapped wherever they stand as whole words
        ph: dict[str, str] = {}
        ph.update(tables.MARKS)
        ph.update(tables.CONFERENCES)
        ph.update(tables.BOWLS)
        ph.update({k: v for k, v in tables.RIVALRIES.items() if len(k.split()) > 1 and k not in ("The Game", "Big Game", "Border War", "Holy War")})
        ph.update({k: v for k, v in tables.TROPHIES.items() if k not in ("The Belt", "Victory Bell", "Milk Can", "Wagon Wheel", "Golden Egg", "Golden Boot", "Golden Hat")})
        stadium_count: dict[str, int] = {}
        for t in self.real_teams.values():
            stadium_count[t["stadium"]["name"]] = stadium_count.get(t["stadium"]["name"], 0) + 1
        for slug, t in self.real_teams.items():
            new = self.team[slug]
            full = f"{new['short']} {new['mascot']}"
            ph[t["school_name"]] = new["school"]
            if t["school_name"].startswith("The "):
                ph[t["school_name"][4:]] = new["school"]
            ph[f"{t['short_name']} {t['mascot']}"] = full
            if self.espn_names.get(slug):
                ph[self.espn_names[slug]] = full
            stadium = t["stadium"]["name"]
            if stadium_count[stadium] == 1 and stadium not in GENERIC_STADIUMS:
                ph[stadium] = new["stadium"]
                ph[stadium.replace("-", "–")] = new["stadium"]
            if t["mascot"] in tables.DISTINCT_MASCOTS:
                ph[t["mascot"]] = new["mascot"]
            if t["short_name"] in tables.LOOSE:
                ph[t["short_name"]] = new["short"]
        for old, new in self.fcs_names.items():
            ph[old] = new
        # the FCS schools the game's own code lists by their bare name ("Duquesne"), unless that name opens a real
        # team's ("North Dakota" and North Dakota State)
        real_names = [t["short_name"] for t in self.real_teams.values()] + [t["school_name"] for t in self.real_teams.values()]
        self.fcs_places = {old: new for old, new in self.fcs_locations.items()
                           if old not in ph and len(old) > 4 and not any(n == old or n.startswith(old + " ") for n in real_names)}
        ph.update({k: v for k, v in self.fcs_places.items() if " " in k})
        for c in coaches:
            ph[c] = self.person[c]
        ph.pop("", None)
        self.phrases = ph
        src = {**ph, **self.fcs_places}
        src.pop("", None)
        self.source_phrases = src
        self._source_re = re.compile(r"(?<![A-Za-z0-9_])(?:" + "|".join(re.escape(k) for k in sorted(src, key=len, reverse=True)) + r")(?![A-Za-z0-9_])")
        keys = sorted(ph, key=len, reverse=True)
        self._phrase_re = re.compile(r"(?<![A-Za-z0-9_])(?:" + "|".join(re.escape(k) for k in keys) + r")(?![A-Za-z0-9_])")
        slugs = sorted(self.slug, key=len, reverse=True)
        self._slug_re = re.compile(r"(?<![a-z0-9-])(" + "|".join(re.escape(s) for s in slugs) + r")(?=:)")
        self._cache: dict[str, str] = {}

    def _stadium(self, slug: str, t: dict, mascot: str) -> str:
        kinds = ("{m} Stadium", "{m} Field", "{m} Memorial Stadium", "{m} Bowl")
        m = mascot if not mascot.endswith("s") or mascot.endswith("ss") else mascot[:-1]
        real = {x["stadium"]["name"] for x in self.real_teams.values()}
        order = list(kinds[:3])
        _seed("stadium", slug).shuffle(order)
        return next((k.format(m=m) for k in order if k.format(m=m) not in real), f"{m} Grounds")

    def _fcs(self, sched: dict) -> dict[str, dict]:
        """espn id -> {"name", "location"} for the FCS schools, drawn from the cities of each school's state."""
        fmap = _read(self.root / "data" / "fcs_map.json")
        cities = _read(self.root / "data" / "major_cities.json")
        out: dict[str, dict] = {}
        self.fcs_names: dict[str, str] = {}
        taken: set[str] = set()
        ids = sorted(set(sched.get("fcs", {})) | set(fmap), key=str)
        self.fcs_locations = {v["location"]: "" for v in sched.get("fcs", {}).values() if v.get("location")}
        real_places = {t["short_name"] for t in self.real_teams.values()} | {t.get("city") or "" for t in self.real_teams.values()}
        real_places |= {x for v in self.fcs_locations for x in v.split()}
        real_names = {t["short_name"] for t in self.real_teams.values()} | set(self.fcs_locations)
        for i in ids:
            old = (sched.get("fcs", {}).get(i) or {}).get("name") or (fmap.get(i) or {}).get("name") or ""
            state = (fmap.get(i) or {}).get("state") or ""
            avoid = real_places | set(self.fcs_locations)
            places = [c[0] for c in cities.get(state, []) if isinstance(c, list) and c[0] not in avoid] or ["Riverside", "Fairview", "Lakewood"]
            for attempt in range(100):
                rng = _seed("fcs", str(i), old, str(attempt))
                location = rng.choice(places) + rng.choice(tables.FCS_SUFFIXES)
                if location not in taken and location not in real_names:
                    break
            taken.add(location)
            name = f"{location} {rng.choice(tables.FCS_MASCOTS)}"
            out[i] = {"name": name, "location": location}
            if old:
                self.fcs_names[old] = name
            old_loc = (sched.get("fcs", {}).get(i) or {}).get("location")
            if old_loc:
                self.fcs_locations[old_loc] = location
        return out

    # ---- the swap ----
    def text(self, s: str) -> str:
        """One string, swapped: a whole-string match first, then slugs before a colon, then phrases."""
        if s[:1] == DONE:
            return s[1:]
        hit = self.exact.get(s)
        if hit is not None:
            return hit
        if len(s) < 3:
            return s
        out = self._cache.get(s)
        if out is None:
            out = self._slug_re.sub(lambda m: self.slug[m.group(1)], s)
            if any(ch.isupper() for ch in out):
                out = self._phrase_re.sub(lambda m: self.phrases[m.group(0)], out)
            if len(self._cache) < 500_000:
                self._cache[s] = out
        return out

    def walk(self, node, drop: frozenset = frozenset(), key: str | None = None):
        if isinstance(node, dict):
            return {self.text(k): self.walk(v, drop, k) for k, v in node.items() if k not in drop}
        if isinstance(node, list):
            return [self.walk(v, drop, key) for v in node]
        if isinstance(node, str):
            if key in tables.TEAM_KEYS and node in self.team_exact:
                return self.team_exact[node]
            return self.text(node)
        return node

    _QUOTED = re.compile(r"""(["'`])((?:(?!\1)[^\\\n]){1,80})\1""")

    def source(self, code: str, sample: bool = False) -> str:
        """Python or TypeScript source: quoted strings by the whole-string lookup, then phrases across the text.
        `sample`: the app's stand-in data, where a quoted place name is a team."""
        def quoted(m: re.Match) -> str:
            inner = m.group(2)
            hit = self.exact.get(inner) or (self.team_exact.get(inner) if sample else None)
            if hit is None or m.group(1) in hit:
                return self._slug_re.sub(lambda s: self.slug[s.group(1)], m.group(0))
            return f"{m.group(1)}{hit}{m.group(1)}"
        code = self._QUOTED.sub(quoted, code)
        return self._source_re.sub(lambda m: self.source_phrases[m.group(0)], code)


# ---- by field -------------------------------------------------------------------------------------------------

def _nudge(hex_color: str, slug: str) -> str:
    """A protected shade moved a hair: every channel COLOR_NUDGE toward the middle (black and white stay)."""
    h = hex_color.lstrip("#")
    if len(h) != 6 or h.lower() in ("000000", "ffffff"):
        return hex_color
    out = []
    for i in (0, 2, 4):
        v = int(h[i:i + 2], 16)
        out.append(max(0, min(255, v + (tables.COLOR_NUDGE if v < 128 else -tables.COLOR_NUDGE))))
    return "#" + "".join(f"{v:02X}" for v in out)


def _previous_job(text: str | None, m: Maps, shorts: list[str]) -> str | None:
    """A coach's last job: kept when it names a school of this league, else said without the employer."""
    if not text or text == "Unverified":
        return text
    text = m.text(text)
    if any(text.startswith(s) for s in shorts):
        return text
    low = text.lower()
    if "head coach" in low:
        return "Head coach elsewhere"
    if "coordinator" in low:
        return "Coordinator elsewhere"
    return "Assistant coach elsewhere"


def _coach(c: dict, m: Maps, shorts: list[str], old_shorts: dict[str, str]) -> None:
    if "previous_job" in c:
        job = _previous_job(c.get("previous_job"), m, shorts)
        c["previous_job"] = DONE + job if job else job
    if c.get("alma_mater"):
        school = old_shorts.get(c["alma_mater"])               # a school outside the league: left blank
        c["alma_mater"] = DONE + school if school else None


def _fields(root: Path, m: Maps) -> None:
    """The edits a lookup cannot make: identities, colors, stadiums, coaches' histories, bowl sites, FCS names."""
    old_shorts = dict(m.team_exact)
    shorts = sorted(set(old_shorts.values()), key=len, reverse=True)
    teams_dir = root / "cfb_sim_data" / "teams"
    for slug, t in m.real_teams.items():
        new = m.team[slug]
        for c in (t.get("coaches") or {}).values():
            if c:
                _coach(c, m, shorts, old_shorts)
        for p in t.get("roster", []):
            p["team"] = DONE + new["short"]
        t["short_name"], t["school_name"], t["mascot"] = DONE + new["short"], DONE + new["school"], DONE + new["mascot"]
        t["stadium"]["name"], t["abbreviation"] = DONE + new["stadium"], DONE + new["abbr"]
        if slug in tables.CITIES:
            t["city"] = DONE + tables.CITIES[slug]
        for c in t["colors"].values():
            c["name"] = tables.COLOR_NAMES.get(c["name"], c["name"])
            if slug in tables.NUDGE_COLORS:
                c["hex"] = _nudge(c["hex"], slug)
        (teams_dir / f"{slug}.json").unlink()
        _write(teams_dir / f"{new['slug']}.json", t)
    path = root / "cfb_sim_data" / "coaches.json"
    coaches = _read(path)
    for c in coaches:
        _coach(c, m, shorts, old_shorts)
    _write(path, coaches)

    path = root / "data" / "rivalries.json"
    riv = _read(path)
    named: dict[str, str] = {}
    for r in riv["rivalries"]:
        a, b = (m.team[s]["short"] if s in m.team else s for s in r["teams"])
        new = tables.RIVALRIES.get(r["name"]) or "-".join(sorted((a, b)))
        named[r["name"]] = new
        r["name"], r["trophy"] = DONE + new, DONE + tables.TROPHIES.get(r["trophy"], "")
    _write(path, riv)
    path = root / "data" / "series.json"
    series = _read(path)
    for g in series.get("annual", []):
        if g.get("name"):
            a, b = (m.team[s]["short"] if s in m.team else s for s in g["teams"])
            g["name"] = DONE + (named.get(g["name"]) or tables.RIVALRIES.get(g["name"]) or "-".join(sorted((a, b))))
    _write(path, series)

    path = root / "data" / "bowls.json"
    bowls = _read(path)
    for g in bowls.get("playoff", []) + bowls.get("bowls", []):
        city = (g.get("location") or "").split(",")[0].strip() or "Neutral Site"
        capacity = re.search(r"\(([\d,]+)\)", g.get("stadium") or "")
        g["stadium"] = f"{city} Stadium" + (f" ({capacity.group(1)})" if capacity else "")
        g["site"] = f"{city} Stadium {g.get('location') or ''}".strip()
    _write(path, bowls)

    path = root / "data" / "fcs_map.json"
    fmap = _read(path)
    for i, v in fmap.items():
        if i in m.fcs:
            v["name"] = DONE + m.fcs[i]["name"]
    _write(path, fmap)
    path = root / "data" / "schedules.json"
    sched = _read(path)
    for i, v in sched.get("fcs", {}).items():
        if i in m.fcs:
            v["name"], v["location"] = DONE + m.fcs[i]["name"], DONE + m.fcs[i]["location"]
        if "conference" in v:
            v["conference"] = "FCS"
    for slug, v in sched["teams"].items():
        if slug in m.team and "espn_name" in v:
            v["espn_name"] = DONE + f"{m.team[slug]['short']} {m.team[slug]['mascot']}"
    _write(path, sched)

    path = root / "data" / "program_profile.json"
    prof = _read(path)
    for slug, v in prof.get("teams", {}).items():
        v.pop("sources", None)
        if slug in m.team and isinstance(v.get("facts"), dict) and "stadium_name" in v["facts"]:
            v["facts"]["stadium_name"] = DONE + m.team[slug]["stadium"]
    _write(path, prof)


TEXT_SUFFIXES = {".py", ".ts", ".tsx", ".html", ".css", ".md"}


def run(root: Path) -> Maps:
    """Swap the names in the staged project at `root`. Returns the maps (for the build's report and the tests)."""
    root = Path(root)
    if (root / ".git").exists():
        raise RuntimeError("scrub.run works on a staged copy (tools/build_site.py), never on the repository")
    m = Maps(root)
    _fields(root, m)
    for path in sorted(root.rglob("*.json")):
        if "node_modules" in path.parts or "ui" in path.relative_to(root).parts[:1]:
            continue                                       # the app's own files (package.json, tsconfig)
        _write(path, m.walk(_read(path), DROP_KEYS))
    for path in sorted(root.rglob("*")):
        if path.suffix in TEXT_SUFFIXES and path.is_file() and "node_modules" not in path.parts:
            old = path.read_text(encoding="utf-8")
            new = m.source(old, sample=path.stem in ("sample", "samples"))
            if new != old:
                path.write_text(new, encoding="utf-8")
    return m


def terms(root: Path) -> dict[str, set[str]]:
    """The real names a generic build must not contain, read from the real project at `root`:
    {"people": full names, "phrases": schools, mascots, stadiums, bowls, conferences, marks, "slugs": ...}."""
    m = Maps(Path(root))
    phrases = {k for k, v in m.phrases.items() if k != v and k not in m.coaches}
    phrases |= {t["city"] for s, t in m.real_teams.items() if s in tables.CITIES}
    phrases |= {t["school_name"] for t in m.real_teams.values()}
    phrases |= {k for k in m.fcs_places if " " in k}
    phrases -= {"AP", "MAC", "SEC", "ACC", "CFP", "NFL", "ESPN", "NCAA", "CUSA", "Nielsen"}      # checked as whole words below
    return {
        "people": {n for n in m.real_people if n not in set(m.person.values())},
        "phrases": phrases,
        "words": {"AP", "MAC", "SEC", "ACC", "CFP", "NFL", "ESPN", "NCAA", "Heisman"},
        "slugs": set(m.slug),
        "player_slugs": {s for s in m.player_slug if s not in set(m.player_slug.values()) and "-" in s},
    }
