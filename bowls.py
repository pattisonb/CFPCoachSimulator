"""Bowl season: the 2026-27 lineup (data/bowls.json, built by fetch_bowls.py), bowl
selection by conference tie-ins, and the names and sites of the playoff games.

Selection follows how the real process works in practice: once the 12-team playoff field
is set, every remaining team with six wins is bowl-eligible (five-win teams fill empty
spots, as the NCAA allows). Bowls pick in order of payout; each bowl fills its two slots
from its contracted conferences, taking the best remaining team there (by the committee's
final order, then record and rating), and falls back to the best remaining team from
anywhere when a conference's pool is empty. Two teams from the same conference are not
paired. Sites are the real ones; dates place each bowl in the playoff weeks.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parent
BOWLS_FILE = ROOT / "data" / "bowls.json"

# Selection order when the article's payout is missing (roughly by payout and prestige).
PRIORITY = ["Citrus Bowl", "ReliaQuest Bowl", "Alamo Bowl", "Holiday Bowl", "Pop-Tarts Bowl", "Gator Bowl", "Music City Bowl",
            "Texas Bowl", "Las Vegas Bowl", "Sun Bowl", "Liberty Bowl", "Duke's Mayo Bowl", "Pinstripe Bowl", "Military Bowl",
            "Fenway Bowl", "Independence Bowl", "Birmingham Bowl", "Armed Forces Bowl", "First Responder Bowl", "Cactus Bowl",
            "Arizona Bowl", "Hawaii Bowl", "New Mexico Bowl", "Frisco Bowl", "Boca Raton Bowl", "Gasparilla Bowl", "Cure Bowl",
            "Myrtle Beach Bowl", "Famous Idaho Potato Bowl", "New Orleans Bowl", "68 Ventures Bowl", "Poinsettia Bowl",
            "Puerto Rico Bowl", "Frisco Football Classic", "Salute to Veterans Bowl"]
# Fallback tie-ins when the article has none (2026-27 contracts as reported on each bowl's page or the conference's).
DEFAULT_TIE_INS = {
    "Citrus Bowl": ["SEC", "Big Ten"], "ReliaQuest Bowl": ["SEC", "Big Ten"], "Alamo Bowl": ["Big 12", "Pac-12"],
    "Holiday Bowl": ["ACC", "Pac-12"], "Pop-Tarts Bowl": ["ACC", "Big 12"], "Gator Bowl": ["ACC", "SEC"],
    "Music City Bowl": ["SEC", "Big Ten"], "Texas Bowl": ["Big 12", "SEC"], "Las Vegas Bowl": ["Big Ten", "Pac-12"],
    "Sun Bowl": ["ACC", "Pac-12"], "Liberty Bowl": ["Big 12", "SEC"], "Duke's Mayo Bowl": ["ACC", "SEC"],
    "Pinstripe Bowl": ["ACC", "Big Ten"], "Military Bowl": ["ACC", "American Athletic Conference"], "Fenway Bowl": ["ACC", "American Athletic Conference"],
    "Independence Bowl": ["Pac-12", "American Athletic Conference"], "Birmingham Bowl": ["SEC", "American Athletic Conference"],
    "Armed Forces Bowl": ["Big 12", "American Athletic Conference"], "First Responder Bowl": ["Big 12", "American Athletic Conference"],
    "Cactus Bowl": ["Big 12", "Big Ten"], "Arizona Bowl": ["Mountain West", "MAC"], "Hawaii Bowl": ["Mountain West", "American Athletic Conference"],
    "New Mexico Bowl": ["Mountain West", "Conference USA"], "Frisco Bowl": ["American Athletic Conference", "Mountain West"],
    "Boca Raton Bowl": ["American Athletic Conference", "MAC"], "Gasparilla Bowl": ["ACC", "American Athletic Conference"],
    "Cure Bowl": ["Sun Belt", "American Athletic Conference"], "Myrtle Beach Bowl": ["Sun Belt", "MAC"],
    "Famous Idaho Potato Bowl": ["Mountain West", "MAC"], "New Orleans Bowl": ["Sun Belt", "Conference USA"],
    "68 Ventures Bowl": ["Sun Belt", "MAC"], "Poinsettia Bowl": ["Mountain West", "Pac-12"], "Puerto Rico Bowl": ["Conference USA", "MAC"],
    "Frisco Football Classic": ["Conference USA", "Mountain West"], "Salute to Veterans Bowl": ["Conference USA", "Sun Belt"],
}
G5 = {"American Athletic Conference", "Conference USA", "MAC", "Mountain West", "Pac-12", "Sun Belt"}
INDEPENDENT = {"FBS Independents", "Independent", "Independents"}


def load_bowls() -> dict:
    if not BOWLS_FILE.exists():
        return {"playoff": [], "bowls": []}
    return json.loads(BOWLS_FILE.read_text(encoding="utf-8"))


def bowl_week(date: Optional[str]) -> int:
    """Place a bowl date in the season's playoff weeks: 16 (through Dec 24, with the first
    round), 17 (Dec 26-31, with the quarterfinals), 18 (January bowls, with the semifinals)."""
    if not date:
        return 17
    m = re.match(r"(Dec|Jan)\w*\s+(\d+)", date)
    if not m:
        return 17
    month, day = m.group(1), int(m.group(2))
    if month == "Jan":
        return 18
    return 16 if day <= 24 else 17


def _payout(b: dict) -> float:
    m = re.search(r"\$([\d,.]+)\s*(million|M)?", b.get("payout") or "", re.I)
    if not m:
        return 0.0
    v = float(m.group(1).replace(",", ""))
    return v * 1e6 if m.group(2) else v


def ordered_bowls(data: dict) -> list[dict]:
    pri = {name: i for i, name in enumerate(PRIORITY)}
    return sorted(data["bowls"], key=lambda b: (pri.get(b["bowl"], 99), -_payout(b)))


def tie_ins_for(b: dict) -> list[str]:
    """The two conference slots used for selection: the curated current-cycle table
    (Wikipedia's infobox mixes in historical tie-ins), else whatever the article gave."""
    ties = list(DEFAULT_TIE_INS.get(b["bowl"], []))
    if len(ties) < 2:
        ties += [t for t in (b.get("tie_ins") or []) if t and t not in ties]
    return ties[:2] if len(ties) >= 2 else ties + ["At-large"] * (2 - len(ties))


def select_bowls(records: dict, teams: dict, playoff_field: set, order: list[str], ratings: dict) -> list[dict]:
    """Return bowl matchups: [{"bowl", "name", "date", "time", "site", "week", "home", "away", "tie_ins"}]."""
    data = load_bowls()
    pos = {t: i for i, t in enumerate(order)}

    def quality(slug: str):
        r = records[slug]
        g = r["wins"] + r["losses"]
        return (pos.get(slug, 999), -(r["wins"] / g if g else 0), -ratings.get(slug, 0))

    eligible = {}
    for slug, t in teams.items():
        if t["fictional"] or slug in playoff_field:
            continue
        r = records[slug]
        if r["wins"] >= 6:
            eligible[slug] = 6
        elif r["wins"] == 5:
            eligible[slug] = 5
    pools: dict[str, list[str]] = {}
    for slug in sorted(eligible, key=quality):
        conf = teams[slug]["conference"]
        pools.setdefault(conf, []).append(slug)
    taken: set[str] = set()

    def best_from(conf: str, exclude_conf: Optional[str], min_wins: int) -> Optional[str]:
        candidates: list[str]
        if conf in ("At-large", "Group of Five"):
            confs = [c for c in pools if (conf == "At-large" or c in G5) and c != exclude_conf]
            candidates = sorted((s for c in confs for s in pools[c]), key=quality)
        elif conf in ("Notre Dame", "Army", "Navy", "BYU"):
            slug = conf.lower().replace(" ", "-")
            candidates = [slug] if slug in eligible else []
        elif conf == "Independent":
            candidates = [s for c in pools if c in INDEPENDENT for s in pools[c]]
        else:
            candidates = list(pools.get(conf, []))
        for s in candidates:
            if s not in taken and eligible[s] >= min_wins and teams[s]["conference"] != exclude_conf:
                return s
        return None

    out = []
    for b in ordered_bowls(data):
        ties = tie_ins_for(b)
        picks: list[str] = []
        for min_wins in (6, 5):
            picks = []
            for conf in ties:
                other_conf = teams[picks[0]]["conference"] if picks else None
                # a missing tie-in is filled from the same tier first (a Group of Five bowl takes
                # another Group of Five team before a leftover power-conference team)
                fallback = "Group of Five" if conf in G5 else "At-large"
                s = best_from(conf, other_conf, min_wins) or best_from(fallback, other_conf, min_wins) or best_from("At-large", other_conf, min_wins)
                if s:
                    picks.append(s)
                    taken.add(s)
            if len(picks) == 2:
                break
            for s in picks:
                taken.discard(s)
        if len(picks) < 2:
            out.append({"bowl": b["bowl"], "name": b["name"], "date": b.get("date"), "time": b.get("time"), "site": b.get("site"),
                        "week": bowl_week(b.get("date")), "home": None, "away": None, "tie_ins": ties, "unfilled": True})
            continue
        home, away = picks[0], picks[1]
        out.append({"bowl": b["bowl"], "name": b["name"], "date": b.get("date"), "time": b.get("time"), "site": b.get("site"),
                    "week": bowl_week(b.get("date")), "home": home, "away": away, "tie_ins": ties, "unfilled": False})
    return out


def playoff_sites(seeds: dict[int, str], conference_of: dict[str, str]) -> dict[str, dict]:
    """Which New Year's Six bowl hosts each quarterfinal, the semifinal bowls, and the
    championship site, from data/bowls.json. Quarterfinal bowls go to the top four seeds
    by traditional affinity (Rose: Big Ten/Pac-12, Peach: SEC/ACC, Cotton: Big 12/SEC,
    Fiesta: the rest), seed 1 choosing first."""
    data = load_bowls()
    qf = [p for p in data["playoff"] if p.get("round") == "quarterfinal"]
    sf = [p for p in data["playoff"] if p.get("round") == "semifinal"]
    champ = next((p for p in data["playoff"] if p.get("round") == "championship"), None)
    affinity = {"Rose Bowl": ["Big Ten", "Pac-12"], "Peach Bowl": ["SEC", "ACC"], "Cotton Bowl": ["Big 12", "SEC"],
                "Fiesta Bowl": ["Big 12", "Mountain West"], "Sugar Bowl": ["SEC", "Big 12"], "Orange Bowl": ["ACC", "SEC"]}
    remaining = list(qf)
    sites = {}
    for seed in (1, 2, 3, 4):
        team = seeds.get(seed)
        conf = conference_of.get(team)
        pick = next((p for p in remaining if conf in affinity.get(p["bowl"], [])), None) or (remaining[0] if remaining else None)
        if pick:
            remaining.remove(pick)
            sites[f"qf-{seed}"] = pick
    for key, p in zip(("sf-1", "sf-2"), sf):
        sites[key] = p
    if champ:
        sites["final"] = champ
    return sites


def short_site(site: Optional[str]) -> str:
    """'State Farm Stadium Glendale, Arizona' -> 'State Farm Stadium, Glendale, AZ'-ish: keep the city part."""
    if not site:
        return ""
    m = re.match(r"^(.*?)\s+([A-Z][\w.' ]+?, [A-Z][\w ]+)$", site)
    return f"{m.group(1)} · {m.group(2)}" if m else site
