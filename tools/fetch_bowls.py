"""Build data/bowls.json: the 2026-27 bowl lineup with dates, sites, conference tie-ins
and each bowl's history, from Wikipedia.

Sources:
  * "2026–27 NCAA football bowl games": dates, kickoff times and sites for every bowl,
    and which New Year's Six bowls host the playoff quarterfinals and semifinals.
  * Each bowl's own article: the infobox "Conference tie-ins" and the game-by-game
    results table, from which all-time appearances, records and recent results come.

Usage:  python fetch_bowls.py
"""
from __future__ import annotations
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `import season` works from here

import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "bowls.json"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
WIKI = "https://en.wikipedia.org/wiki/"
SCHEDULE_PAGE = "2026–27 NCAA football bowl games"

# Bowl name on the schedule page -> its main Wikipedia article
ARTICLES = {
    "Rose Bowl": "Rose Bowl Game", "Orange Bowl": "Orange Bowl", "Sugar Bowl": "Sugar Bowl", "Cotton Bowl": "Cotton Bowl Classic",
    "Fiesta Bowl": "Fiesta Bowl", "Peach Bowl": "Peach Bowl", "College Football Playoff National Championship": "College Football Playoff National Championship",
    "Salute to Veterans Bowl": "Salute to Veterans Bowl", "Frisco Football Classic": "Frisco Football Classic", "Boca Raton Bowl": "Boca Raton Bowl",
    "Gasparilla Bowl": "Gasparilla Bowl", "Myrtle Beach Bowl": "Myrtle Beach Bowl", "Famous Idaho Potato Bowl": "Famous Idaho Potato Bowl",
    "Puerto Rico Bowl": "Puerto Rico Bowl", "Cure Bowl": "Cure Bowl", "Independence Bowl": "Independence Bowl", "New Orleans Bowl": "New Orleans Bowl",
    "Armed Forces Bowl": "Armed Forces Bowl", "Poinsettia Bowl": "Poinsettia Bowl", "Frisco Bowl": "Frisco Bowl", "New Mexico Bowl": "New Mexico Bowl",
    "Hawaii Bowl": "Hawaii Bowl", "Pinstripe Bowl": "Pinstripe Bowl", "Fenway Bowl": "Fenway Bowl", "Duke's Mayo Bowl": "Duke's Mayo Bowl",
    "68 Ventures Bowl": "68 Ventures Bowl", "Cactus Bowl": "Cactus Bowl", "Military Bowl": "Military Bowl", "Holiday Bowl": "Holiday Bowl",
    "Birmingham Bowl": "Birmingham Bowl", "Pop-Tarts Bowl": "Pop-Tarts Bowl", "Alamo Bowl": "Alamo Bowl", "Gator Bowl": "Gator Bowl",
    "Music City Bowl": "Music City Bowl", "ReliaQuest Bowl": "ReliaQuest Bowl", "Sun Bowl": "Sun Bowl", "Las Vegas Bowl": "Las Vegas Bowl",
    "Texas Bowl": "Texas Bowl", "Citrus Bowl": "Citrus Bowl", "First Responder Bowl": "First Responder Bowl", "Arizona Bowl": "Arizona Bowl",
    "Liberty Bowl": "Liberty Bowl",
}


def fetch(title: str) -> str:
    url = WIKI + urllib.parse.quote(title.replace(" ", "_"))
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=40) as resp:
        return resp.read().decode("utf-8", errors="replace")


def clean(s: str) -> str:
    s = re.sub(r"\[[^\]]*\]", "", s)         # footnotes
    return re.sub(r"\s+", " ", s).strip()


def parse_schedule(html: str) -> tuple[list[dict], list[dict]]:
    soup = BeautifulSoup(html, "lxml")
    tabs = soup.select("table.wikitable")
    cfp, bowls = [], []
    last_date = None
    for tr in tabs[0].select("tr")[2:]:
        cells = [clean(c.get_text(" ", strip=True)) for c in tr.find_all(["th", "td"])]
        if not cells:
            continue
        # rows with a date start with it; continuation rows start with the time
        if re.match(r"^(December|January) \d+$", cells[0]):
            last_date = cells[0]
            cells = cells[1:]
        if not cells:
            continue
        time_txt = cells[0] if re.search(r"\d", cells[0]) and "Bowl" not in cells[0] and "Championship" not in cells[0] and "TBD" not in cells[0] else ""
        rest = cells[1:] if time_txt else cells
        game = rest[0] if rest else ""
        site = rest[1] if len(rest) > 1 else ""
        if "First round" in game or game == "TBD":
            continue
        cfp.append({"name": game, "date": last_date, "time": time_txt, "site": site})
    last_date = None
    for tr in tabs[1].select("tr")[2:]:
        tds = tr.find_all(["th", "td"])
        cells = [clean(c.get_text(" ", strip=True)) for c in tds]
        if len(cells) < 4:
            continue
        if re.match(r"^(Dec|Jan) \d+$", cells[0]):
            last_date = cells[0]
            cells = cells[1:]
        bowls.append({"name": cells[1], "date": last_date, "time": cells[0], "site": cells[2]})
    return cfp, bowls


# Conference wording on Wikipedia -> the names used in cfb_sim_data (most specific first).
CONF_PATTERNS = [
    (r"\bmid-american\b|\bmac\b", "MAC"), (r"\bamerican\b|\baac\b", "American Athletic Conference"),
    (r"\bacc\b|\batlantic coast\b", "ACC"), (r"\bbig ten\b", "Big Ten"), (r"\bbig 12\b", "Big 12"),
    (r"\bsec\b|\bsoutheastern\b", "SEC"), (r"conference usa|c-usa|\bcusa\b", "Conference USA"),
    (r"mountain west|\bmwc\b", "Mountain West"), (r"pac-?12|pac–12", "Pac-12"), (r"sun belt", "Sun Belt"),
    (r"\bindependent", "Independent"), (r"notre dame", "Notre Dame"), (r"\barmy\b", "Army"), (r"\bnavy\b", "Navy"),
    (r"\bbyu\b", "BYU"), (r"at-large", "At-large"), (r"group of (five|5)", "Group of Five"),
]


def conf_name(text: str) -> str | None:
    t = text.lower()
    for pat, name in CONF_PATTERNS:
        if re.search(pat, t):
            return name
    return None


def clean_lines(s: str) -> str:
    s = re.sub(r"\[[^\]]*\]", "", s)
    s = re.sub(r"[ \t]+", " ", s)
    return re.sub(r"\n\s*\n+", "\n", s).strip()


def split_entries(td) -> list[tuple[str, str]]:
    """An infobox cell like 'MWC (2012–present)<br>American (2019–present)' or 'Big Ten, SEC'
    -> [(name, span)]. Splits on line breaks and on commas outside parentheses."""
    text = re.sub(r"<br\s*/?>", "\n", str(td))
    text = clean_lines(re.sub(r"<[^>]+>", " ", text))
    out = []
    # tokens: a name, then either a parenthesised span or a delimiter / end of line
    for m in re.finditer(r"\s*([^()\n,;]+?)\s*(?:\(([^)]*)\)|(?=[\n,;]|$))", text, flags=re.M):
        name = clean(m.group(1)).strip(" ,;")
        span = clean(m.group(2) or "")
        if name and name.lower() not in ("and", "or") and not name.lower().startswith("see "):
            out.append((name, span))
    return out


def span_active(span: str) -> bool:
    if not span:
        return True
    if "present" in span.lower():
        return True
    years = [int(y) for y in re.findall(r"(?<!\d)(?:19|20)\d{2}(?!\d)", span)]
    return bool(years) and years[-1] >= 2026


def team_name(raw: str) -> str:
    """'#25 Tennessee' / '18 Iowa State' / 'No. 5 USC' -> plain name; fix Hawaiʻi spellings."""
    s = clean(raw)
    s = re.sub(r"^(No\.\s?|#\s?)?\d{1,2}\s+(?=[A-Za-z(])", "", s)
    s = re.sub(r"\s*ʻ\s*", "'", s).replace("Hawai'i", "Hawaii")
    s = re.sub(r"\s*\((vacated|forfeit)[^)]*\)", "", s, flags=re.I)
    return s.strip()


def score_of(raw: str) -> int | None:
    m = re.match(r"^\s*(\d{1,3})", raw or "")
    return int(m.group(1)) if m else None


NON_TEAM_HEADERS = ("date", "attend", "note", "venue", "bowl", "game", "season", "no.", "year", "score", "sponsor", "tv", "mvp")


def parse_results_table(t) -> list[dict]:
    """Game rows from one wikitable: 'Winning team / Losing team' tables (name and score in
    neighbouring cells under a two-column header, or 'Alabama 31' in one cell) and the
    Rose Bowl's 'West / East' layout where the winner is the side with the higher score."""
    rows = t.select("tr")
    if len(rows) < 3:
        return []
    raw_hdr = [(clean(c.get_text(" ", strip=True)).lower(), int(c.get("colspan", 1) or 1)) for c in rows[0].find_all(["th", "td"])]
    joined = " ".join(h for h, _ in raw_hdr)
    if any(w in joined for w in ("mvp", "player", "mascot", "appearances", "coach", "most valuable")):
        return []
    hdr: list[str] = []
    for h, span in raw_hdr:
        hdr.extend([h] * span)
    groups: list[tuple[int, int | None, str]] = []   # (name column, score column, role)
    i = 0
    while i < len(hdr):
        h = hdr[i]
        run = 1
        while i + run < len(hdr) and hdr[i + run] == h:
            run += 1
        if h.startswith("winn"):
            role = "winner"
        elif h.startswith("los"):
            role = "loser"
        else:
            role = ""
        if role or (run == 2 and not any(w in h for w in NON_TEAM_HEADERS)):
            groups.append((i, i + 1 if run >= 2 else None, role))
        i += run
    if len(groups) != 2:
        return []
    roles = {g[2] for g in groups}
    if roles != {"winner", "loser"} and roles != {""}:
        return []
    date_i = next((i for i, h in enumerate(hdr) if any(h.startswith(k) for k in ("date", "season", "year", "played"))), 0)
    score_i = next((i for i, h in enumerate(hdr) if h.startswith("score") or h.startswith("result")), None)
    games = []
    for tr in rows[1:]:
        cells = [clean(c.get_text(" ", strip=True)) for c in tr.find_all(["th", "td"])]
        if len(cells) < len(hdr) - 1 or len(cells) <= max(g[0] for g in groups):
            continue
        date_txt = cells[date_i] if date_i < len(cells) else ""
        m_year = re.search(r"(?<!\d)(19|20)\d{2}(?!\d)", date_txt)
        if not m_year:
            continue
        year = int(m_year.group(0))
        season = year - 1 if re.match(r"^\s*jan", date_txt, re.I) else year
        sides = []
        for name_i, sc_i, role in groups:
            raw = cells[name_i]
            if not raw or any(w in raw.lower() for w in ("no game", "cancel", "not played")):
                sides = []
                break
            name, sc = raw, None
            m = re.match(r"^(.*?)[\s]+(\d{1,3})(?:\s*\(.*\))?$", raw)
            if m and not re.match(r"^(No\. ?|#)?\d{1,2}$", m.group(1).strip()):
                name, sc = m.group(1), int(m.group(2))
            if sc is None and sc_i is not None and sc_i < len(cells):
                sc = score_of(cells[sc_i])
            sides.append([team_name(name), sc, role])
        if len(sides) != 2 or not sides[0][0] or not sides[1][0]:
            continue
        if score_i is not None and score_i < len(cells) and (sides[0][1] is None or sides[1][1] is None):
            nums = re.findall(r"\d{1,3}", cells[score_i])
            if len(nums) >= 2:
                sides[0][1], sides[1][1] = int(nums[0]), int(nums[1])
        if sides[0][2] == "loser" or (not sides[0][2] and sides[0][1] is not None and sides[1][1] is not None and sides[1][1] > sides[0][1]):
            sides.reverse()
        if not sides[0][2] and (sides[0][1] is None or sides[1][1] is None or sides[0][1] == sides[1][1]):
            continue   # tie or unknown winner in a two-sided table
        games.append({"year": year, "season": season, "date": clean(re.sub(r"\b(QF|SF)\b", "", date_txt)),
                      "winner": sides[0][0], "winner_score": sides[0][1], "loser": sides[1][0], "loser_score": sides[1][1]})
    return games


def parse_article(html: str) -> dict:
    soup = BeautifulSoup(html, "lxml")
    info: dict = {}
    box = soup.select_one("table.infobox")
    tie_ins: list[str] = []
    previous: list[str] = []
    if box:
        for tr in box.select("tr"):
            th, td = tr.find("th"), tr.find("td")
            if not th or not td:
                continue
            key = clean(th.get_text(" ", strip=True)).lower()
            val = clean(td.get_text(" ", strip=True))
            if "tie-in" in key:
                for name, span in split_entries(td):
                    label = f"{name} ({span})" if span else name
                    if key.startswith(("previous", "former")):
                        previous.append(label)
                        if span and span_active(span):   # a contract that still runs in 2026 (the Rose Bowl's Big Ten deal)
                            c = conf_name(name)
                            if c and c not in tie_ins:
                                tie_ins.append(c)
                    elif span_active(span):
                        c = conf_name(name)
                        if c and c not in tie_ins:
                            tie_ins.append(c)
                        elif not c and name not in tie_ins:
                            tie_ins.append(name)
            elif key.startswith("stadium"):
                info["stadium"] = val
            elif key.startswith("location"):
                info["location"] = val
            elif key.startswith("operated") or ("first" in key and ("game" in key or "played" in key)):
                m = re.search(r"(?<!\d)(19|20)\d{2}(?!\d)", val)
                if m and "first_played" not in info:
                    info["first_played"] = int(m.group(0))
                if key.startswith("operated"):
                    info["operated"] = val
            elif key.startswith("payout"):
                info["payout"] = val
            elif key.startswith("sponsor") or key.startswith("title sponsor"):
                info["sponsor"] = val
            elif key.startswith("championship affiliation"):
                info["championship_affiliation"] = val
    games: list[dict] = []
    for t in soup.select("table.wikitable"):
        games = parse_results_table(t)
        if len(games) >= 3:
            break
        games = []
    appearances: dict[str, dict] = {}
    for g in games:
        for team, won in ((g["winner"], True), (g["loser"], False)):
            a = appearances.setdefault(team, {"team": team, "games": 0, "wins": 0})
            a["games"] += 1
            a["wins"] += 1 if won else 0
    top = sorted(appearances.values(), key=lambda a: (-a["games"], -a["wins"], a["team"]))[:6]
    recent = sorted(games, key=lambda g: (-g["season"], -g["year"]))[:5]
    if games and "first_played" not in info:
        info["first_played"] = min(g["year"] for g in games)
    return {**info, "tie_ins": tie_ins, "previous_tie_ins": previous, "games_played": len(games),
            "most_appearances": top, "recent": recent}


def main() -> None:
    cfp, others = parse_schedule(fetch(SCHEDULE_PAGE))
    print(f"schedule: {len(cfp)} playoff games, {len(others)} other bowls")
    out = {"season": "2026-27", "source": SCHEDULE_PAGE, "playoff": [], "bowls": []}
    cache: dict[str, dict] = {}
    for entry, kind in [(e, "playoff") for e in cfp] + [(e, "bowl") for e in others]:
        base = re.sub(r"\s*\((Quarterfinal|Semifinal)\)", "", entry["name"]).strip()
        article = ARTICLES.get(base)
        hist = {}
        if article:
            if article not in cache:
                try:
                    cache[article] = parse_article(fetch(article))
                except Exception as exc:  # noqa: BLE001
                    print(f"  {article}: failed ({exc})")
                    cache[article] = {}
                time.sleep(0.4)
            hist = cache[article]
            if not hist.get("games_played"):
                for alt in (f"List of {article} games", f"List of {base} games", f"{article} game results"):
                    try:
                        alt_hist = parse_article(fetch(alt))
                    except Exception:  # noqa: BLE001
                        continue
                    if alt_hist.get("games_played"):
                        hist = {**hist, **{k: v for k, v in alt_hist.items() if k in ("games_played", "most_appearances", "recent")}}
                        break
                    time.sleep(0.3)
        rec = {**entry, "bowl": base, "article": article, **hist}
        m = re.search(r"\((Quarterfinal|Semifinal)\)", entry["name"])
        if kind == "playoff":
            if "Championship" in base:
                rec["round"] = "championship"
            else:
                rec["round"] = m.group(1).lower() if m else ""
            out["playoff"].append(rec)
        else:
            out["bowls"].append(rec)
        print(f"  {rec['name']:<48} {rec.get('date') or '':<12} tie-ins: {rec.get('tie_ins')} games: {rec.get('games_played')}")
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
