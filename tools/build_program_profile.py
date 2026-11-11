"""The program profile: the School Grades research (research_notes/school_grades/, one batch file per conference group,
plus the player's Instagram sheet) as one file for every program, each fact with its source and the estimates marked.
Home attendance and the TV audience come from data/program_market.json, the state from the teams file. A facility
year or a U.S. News rank the research could not find takes its conference's median, listed in `estimates` with a
note. Writes data/program_profile.json:

    {"source": str, "built": "2026-11-11", "teams": {slug: {"facts": {field: value}, "sources": {field: url},
                                                           "estimates": [field, ...], "notes": {field: str}}}}

    python tools/build_program_profile.py
"""
from __future__ import annotations

import csv
import json
import re
import statistics as st
import sys
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

RESEARCH = ROOT / "research_notes" / "school_grades"
MARKET = ROOT / "data" / "program_market.json"
OUT = ROOT / "data" / "program_profile.json"
BUILT = "2026-11-11"
FIELDS = ("us_news_rank", "football_gsr", "football_apr", "stadium_name", "stadium_capacity", "stadium_renovated",
          "football_building_year", "indoor_practice", "metro_population", "jan_avg_temp_f", "setting",
          "head_coaches_since_2010", "current_hc_since")
MEDIAN_FILL = ("stadium_renovated", "football_building_year", "indoor_practice", "us_news_rank")   # a gap takes the conference median
_NUM = re.compile(r"^\s*([0-9][0-9,]*\.?[0-9]*)\s*([kKmM])?\b")


def parse_number(v) -> Optional[float]:
    """A number the research may have written as text: "120,000", "2M", "307K", "36,500 seats". Words ("unranked",
    "none") and empties are None."""
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return v
    m = _NUM.match(str(v))
    if not m:
        return None
    n = float(m.group(1).replace(",", ""))
    n *= {"k": 1e3, "m": 1e6}.get((m.group(2) or "").lower(), 1)
    return int(n) if n == int(n) else n


def _research() -> dict:
    out = {}
    for f in sorted(RESEARCH.glob("*.json")):
        if f.name == "schools.json":
            continue
        out.update(json.loads(f.read_text()))
    return out


def _conferences() -> dict:
    groups = json.loads((RESEARCH / "schools.json").read_text())
    return {line.split("|")[0]: conf for conf, lines in groups.items() for line in lines}


def _instagram() -> dict:
    with open(RESEARCH / "instagram_handles.csv", newline="") as fh:
        return {r["slug"]: r for r in csv.DictReader(fh)}


def build() -> dict:
    from sim import season
    research, confs, insta = _research(), _conferences(), _instagram()
    market = json.loads(MARKET.read_text())["teams"]
    teams = season.load_teams()
    out = {}
    for slug in sorted(market):
        row = research.get(slug) or {}
        facts, sources, estimates, notes = {}, {}, [], {}
        for f in FIELDS:
            cell = row.get(f) or {}
            v = cell.get("value") if isinstance(cell, dict) else cell
            if isinstance(v, str) and f not in ("stadium_name", "setting") and v.strip().lower() not in ("none", "unranked"):
                v = parse_number(v)
            facts[f] = v
            if isinstance(cell, dict):
                if cell.get("source"):
                    sources[f] = cell["source"]
                if cell.get("estimate"):
                    estimates.append(f)
                if cell.get("note"):
                    notes[f] = cell["note"]
        ig = insta.get(slug) or {}
        facts["instagram_followers"] = parse_number(ig.get("followers_num")) or parse_number(ig.get("followers"))
        if ig.get("instagram_page"):
            sources["instagram_followers"] = ig["instagram_page"]
        notes["instagram_followers"] = f"Counted by the player on {ig.get('as_of_date') or '2026-11-10'}" + (" (rounded on the page)." if (ig.get("followers") or "").upper().endswith("M") else ".")
        m = market[slug]
        facts["attendance"], facts["tv_millions"] = m.get("attendance"), m.get("tv_millions")
        sources["attendance"] = sources["tv_millions"] = "data/program_market.json"
        if not m.get("tv_known"):
            estimates.append("tv_millions")
            notes["tv_millions"] = "Fitted from attendance and conference (data/program_market.json): Nielsen publishes only the most-watched teams."
        t = teams.get(slug) or {}
        facts["state"] = t.get("state")
        facts["conference"] = confs.get(slug) or t.get("conference")
        out[slug] = {"facts": facts, "sources": sources, "estimates": estimates, "notes": notes}
    # the gaps: the conference's median of the programs that have it
    for f in MEDIAN_FILL:
        for slug, r in out.items():
            if r["facts"][f] is not None:
                continue
            conf = r["facts"]["conference"]
            have = [parse_number(o["facts"][f]) for o in out.values() if o["facts"]["conference"] == conf and parse_number(o["facts"][f]) is not None]
            have = have or [parse_number(o["facts"][f]) for o in out.values() if parse_number(o["facts"][f]) is not None]
            r["facts"][f] = int(round(st.median(have)))
            if f not in r["estimates"]:
                r["estimates"].append(f)
            r["notes"][f] = (r["notes"].get(f, "") + f" Not found; the {conf} median ({r['facts'][f]}).").strip()
    return {"source": "research_notes/school_grades (seven batch files, the player's Instagram sheet), data/program_market.json",
            "built": BUILT, "teams": out}


def main() -> None:
    data = build()
    OUT.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n")
    est = sum(len(r["estimates"]) for r in data["teams"].values())
    print(f"wrote {OUT.relative_to(ROOT)}: {len(data['teams'])} programs, {est} estimated facts")


if __name__ == "__main__":
    main()
