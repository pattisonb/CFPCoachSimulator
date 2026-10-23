"""Matching real-world team names (NCAA.com, ESPN, poll archives) to the engine's slugs.
Used by the season engine for the real 2026 polls and results, and by the data tools."""
from __future__ import annotations

import re

# names the automatic matcher cannot resolve on its own
ALIASES = {
    "southern california": "usc", "miami (fl)": "miami", "army west point": "army",
    "app state": "app-st", "middle tenn": "mtsu", "south fla": "usf", "south florida": "usf",
    "florida international": "fiu", "massachusetts": "umass",
    "kennesaw st": "kennesaw-st", "jacksonville st": "jax-state", "ulm": "ul-monroe",
    "western ky": "w-kentucky", "central mich": "c-michigan", "eastern mich": "e-michigan",
    "western mich": "w-michigan", "coastal carolina": "c-carolina", "ga southern": "ga-southern",
    "fla atlantic": "fla-atlantic", "hawaii": "hawai-i", "san jose st": "san-jose-state",
    "new mexico st": "new-mexico-st", "missouri st": "missouri-state", "southern miss": "southern-miss",
    "louisiana tech": "louisiana-tech", "texas st": "texas-state", "arkansas st": "arkansas-state",
    "georgia st": "georgia-state", "ohio st": "ohio-state", "michigan st": "michigan-state",
    "mississippi st": "mississippi-state", "oklahoma st": "oklahoma-state", "oregon st": "oregon-state",
    "penn st": "penn-state", "iowa st": "iowa-state", "kansas st": "kansas-state", "florida st": "florida-state",
    "boise st": "boise-state", "colorado st": "colorado-state", "fresno st": "fresno-state",
    "utah st": "utah-state", "san diego st": "san-diego-state", "ball st": "ball-state",
    "kent st": "kent-state", "arizona st": "arizona-state", "washington st": "washington-state",
    "nc state": "nc-state", "north carolina": "north-carolina", "south carolina": "south-carolina",
    "notre dame": "notre-dame", "ole miss": "ole-miss", "texas a&m": "texas-am", "texas tech": "texas-tech",
    "west virginia": "west-virginia", "virginia tech": "virginia-tech", "georgia tech": "georgia-tech",
    "boston college": "boston-college", "wake forest": "wake-forest", "east carolina": "east-carolina",
    "old dominion": "old-dominion", "james madison": "james-madison", "south alabama": "south-alabama",
    "north texas": "north-texas", "new mexico": "new-mexico", "air force": "air-force",
    "bowling green": "bowling-green", "sam houston": "sam-houston", "miami (oh)": "miami-oh",
}


def norm(name: str) -> str:
    """Lower case, no dots or apostrophes, single spaces."""
    s = name.lower().replace(".", "").replace("'", "")
    return re.sub(r"\s+", " ", s).strip()


def build_matcher(teams: dict) -> dict[str, str]:
    """A lookup from every spelling of a team (slug, name, school, abbreviation, alias) to its slug."""
    lookup: dict[str, str] = {}
    for slug, t in teams.items():
        for key in (slug, slug.replace("-", " "), t["name"], t["school"], t["abbreviation"]):
            lookup.setdefault(norm(key), slug)
    for k, v in ALIASES.items():
        if v in teams:
            lookup[norm(k)] = v
    return lookup


def match(name: str, lookup: dict[str, str]) -> str | None:
    """The slug for a real-world name, or None when nothing matches."""
    n = norm(name)
    if n in lookup:
        return lookup[n]
    n2 = n.replace(" st", " state") if n.endswith(" st") else n
    return lookup.get(n2)
