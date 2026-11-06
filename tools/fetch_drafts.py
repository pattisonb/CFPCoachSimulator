"""Build data/nfl_drafts.json: every pick of the last ten NFL drafts (2016-2025) with his round,
position and college, from Wikipedia's player-selection tables, mapped to our team slugs; and
each program's picks by position group, the raw material of the Pro Pipeline grades.

Positions fold into the draft groups offseason.DRAFT_GROUP uses (DE and OLB as EDGE, DT and NT as
DL, G and C as IOL, FB with RB, a two-way player by his first listed position; long snappers out).
A college that is not an FBS team of ours (an FCS school, a Division II one, a Canadian one) is
kept under "other" so the counts still add up.

Usage:  python tools/fetch_drafts.py [first_year] [last_year]
"""
from __future__ import annotations
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root

import collections
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "nfl_drafts.json"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
WIKI = "https://en.wikipedia.org/wiki/"
YEARS = (2016, 2025)

GROUP_OF = {"QB": "QB", "RB": "RB", "HB": "RB", "FB": "RB", "WR": "WR", "TE": "TE", "OT": "OT", "T": "OT", "OL": "OT",
            "G": "IOL", "OG": "IOL", "C": "IOL", "IOL": "IOL", "DE": "EDGE", "EDGE": "EDGE", "OLB": "EDGE", "DT": "DL",
            "NT": "DL", "DL": "DL", "LB": "LB", "ILB": "LB", "MLB": "LB", "CB": "CB", "DB": "CB", "S": "S", "FS": "S",
            "SS": "S", "K": "K", "PK": "K", "P": "P"}
SKIP = {"LS", "ATH"}
# Wikipedia's college names that are not a team's name or alternate name of ours
ALIASES = {"Miami (FL)": "Miami", "Miami (Fla.)": "Miami", "Appalachian State": "App State", "Southern California": "USC",
           "Pittsburgh": "Pitt", "Mississippi": "Ole Miss", "Central Florida": "UCF", "Hawaii": "Hawaiʻi", "Hawai'i": "Hawaiʻi",
           "Texas–San Antonio": "UTSA", "Texas-San Antonio": "UTSA", "Texas–El Paso": "UTEP", "Louisiana–Lafayette": "Louisiana",
           "Louisiana-Lafayette": "Louisiana", "Louisiana–Monroe": "UL Monroe", "Louisiana-Monroe": "UL Monroe", "Massachusetts": "UMass",
           "Nevada–Las Vegas": "UNLV", "Connecticut": "UConn", "Brigham Young": "BYU", "Florida International": "FIU",
           "Southern Miss": "Southern Miss", "Southern Mississippi": "Southern Miss", "Middle Tennessee State": "Middle Tennessee",
           "Western Kentucky": "Western Kentucky", "Bowling Green": "Bowling Green", "San Jose State": "San José State",
           "San José State": "San José State", "Sam Houston State": "Sam Houston", "Jacksonville State": "Jacksonville State",
           "Kennesaw State": "Kennesaw State", "Texas A&M": "Texas A&M", "North Carolina State": "NC State", "South Florida": "USF"}


CACHE = ROOT / "data" / "cache" / "drafts"          # the fetched pages (gitignored), so a mapping fix does not refetch


def fetch(url: str) -> str:
    CACHE.mkdir(parents=True, exist_ok=True)
    cached = CACHE / (re.sub(r"\W", "_", url.rsplit("/", 1)[-1]) + ".html")
    if cached.exists():
        return cached.read_text()
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(3):
        try:
            html = urllib.request.urlopen(req, timeout=60).read().decode("utf-8", "replace")
            cached.write_text(html)
            return html
        except Exception as e:                      # noqa: BLE001 (a retry on any transport error)
            if attempt == 2:
                raise
            print(f"  retry after {e}", file=sys.stderr)
            time.sleep(2 * (attempt + 1))
    raise RuntimeError("unreachable")


def selections(year: int) -> list[dict]:
    """The year's picks: round, pick, player, position (first listed), college (as written)."""
    soup = BeautifulSoup(fetch(f"{WIKI}{year}_NFL_draft"), "html.parser")
    for tbl in soup.find_all("table", class_="wikitable"):
        first = tbl.find("tr")
        hdr = [th.get_text(" ", strip=True) for th in first.find_all(["th", "td"])]
        if not ("College" in hdr and any(h.startswith("Pick") for h in hdr) and any(h.startswith("Pos") for h in hdr)):
            continue
        ix = {re.sub(r"\W", "", h).lower(): i for i, h in enumerate(hdr)}
        col = lambda key: next(i for k, i in ix.items() if k.startswith(key))   # noqa: E731
        i_rnd, i_pick, i_player, i_pos, i_col = col("rnd"), col("pick"), col("player"), col("pos"), col("college")
        out = []
        for tr in tbl.find_all("tr")[1:]:
            cells = [c.get_text(" ", strip=True) for c in tr.find_all(["th", "td"])]
            if len(cells) <= max(i_rnd, i_pick, i_player, i_pos, i_col):
                continue
            m_r, m_p = re.search(r"\d+", cells[i_rnd]), re.search(r"\d+", cells[i_pick])
            if not (m_r and m_p):
                continue
            pos = re.split(r"\s*/\s*", cells[i_pos].strip())[0].strip().upper()
            out.append({"year": year, "round": int(m_r.group()), "pick": int(m_p.group()), "player": re.sub(r"\s*[†‡*]+$", "", cells[i_player]),
                        "position": pos, "college": re.sub(r"\s*\[.*?\]", "", cells[i_col]).strip()})
        if len(out) >= 200:
            return out
    raise RuntimeError(f"{year}: no selections table found")


def slug_map() -> dict[str, str]:
    """A college name as Wikipedia writes it -> our team slug (names, alternate names, aliases)."""
    from sim import season
    teams = season.load_teams()
    by_name: dict[str, str] = {}
    for slug, t in teams.items():
        if t.get("name") and t["name"] != "FCS":
            by_name[t["name"].lower()] = slug
    fbs = json.loads((ROOT / "data" / "recruiting" / "fbs_teams.json").read_text())
    for t in fbs:
        slug = by_name.get(t["school"].lower())
        if slug is None:
            continue
        for alt in (t.get("alternateNames") or []):
            by_name.setdefault(alt.lower(), slug)
    out = dict(by_name)
    for wiki, ours in ALIASES.items():
        if ours.lower() in by_name:
            out[wiki.lower()] = by_name[ours.lower()]
    return out


def main() -> None:
    first, last = (int(a) for a in sys.argv[1:3]) if len(sys.argv) >= 3 else YEARS
    picks = []
    for year in range(first, last + 1):
        rows = selections(year)
        print(f"{year}: {len(rows)} picks")
        picks += rows
        time.sleep(1)
    names = slug_map()
    unmapped: collections.Counter = collections.Counter()
    by_team: dict[str, dict] = {}
    for p in picks:
        g = GROUP_OF.get(p["position"])
        if g is None and p["position"] not in SKIP:
            print(f"  unknown position {p['position']!r}: {p['player']} ({p['year']})", file=sys.stderr)
        p["group"] = g
        slug = names.get(p["college"].lower())
        if slug is None:
            unmapped[p["college"]] += 1
            slug = "other"
        p["team"] = slug
        if g:
            t = by_team.setdefault(slug, {"picks": 0, "round1": 0, "by_group": {}, "by_year": {}})
            t["picks"] += 1
            t["round1"] += p["round"] == 1
            t["by_group"][g] = t["by_group"].get(g, 0) + 1
            t["by_year"][str(p["year"])] = t["by_year"].get(str(p["year"]), 0) + 1
    print(f"{len(picks)} picks; {sum(unmapped.values())} from schools that are not FBS teams of ours ({len(unmapped)} names), the most common:")
    for name, n in unmapped.most_common(25):
        print(f"   {n:3} {name}")
    out = {"source": f"Wikipedia's player-selection tables, the {first}-{last} NFL drafts (tools/fetch_drafts.py)",
           "years": [first, last], "picks": picks, "teams": by_team, "unmapped": dict(unmapped.most_common())}
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    print(f"wrote {OUT} ({len(by_team)} programs)")


if __name__ == "__main__":
    main()
