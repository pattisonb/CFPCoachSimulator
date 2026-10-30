"""Betting lines from scoresandodds.com for the forward test: the spread and total for every
FBS game on the board, with the score once a game is final.

`python tools/fetch_lines.py [YYYY-MM-DD]` prints the board for that day's week; the
forward test imports `lines_for_dates()` to attach the line at freeze time and the closing
line at scoring time. One request per distinct date; a page shows its whole week."""
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))   # the project root, so `from sim import teamnames` works from here

from sim import teamnames  # noqa: E402

URL = "https://www.scoresandodds.com/ncaaf"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) CFPCoachSimulator forward test"}
# names the board spells differently from the engine's matcher
EXTRA_ALIASES = {
    "appalachian state": "app-st", "ul monroe": "ul-monroe", "louisiana-monroe": "ul-monroe", "middle tennessee": "mtsu",
    "southern mississippi": "southern-miss", "miami florida": "miami", "miami ohio": "miami-oh", "jacksonville state": "jax-state",
    "kennesaw state": "kennesaw-st", "florida international": "fiu", "south florida": "usf", "central florida": "ucf",
    "connecticut": "uconn", "hawaii": "hawai-i", "san jose state": "san-jose-state", "texas san antonio": "utsa",
    "texas el paso": "utep", "nevada las vegas": "unlv", "louisiana lafayette": "louisiana", "coastal carolina": "c-carolina",
    "georgia southern": "ga-southern", "western kentucky": "w-kentucky", "western michigan": "w-michigan",
    "central michigan": "c-michigan", "eastern michigan": "e-michigan", "northern illinois": "niu", "sam houston state": "sam-houston",
    "north dakota state": "ndsu", "sacramento state": "sac-state", "florida atlantic": "fla-atlantic", "texas a&m": "texas-a-m",
}


def _num(text: str) -> float | None:
    """'-7', '+1.5', 'pk', 'o49.5', 'u48.5', 'even' -> a number (pick = 0), else None."""
    t = text.strip().lower().replace("½", ".5")
    if t in ("pk", "pick", "even", "ev"):
        return 0.0
    try:
        value = float(t.lstrip("ou"))
    except ValueError:
        return None
    return value if value != 0 else 0.0   # no -0.0 for a pick


def parse_board(html: str) -> list[dict]:
    """Every event card on a page: teams, kickoff, score if final, spread and total.
    The spread is the home team's number (negative = home favored)."""
    starts = [m.start() for m in re.finditer(r'<div[^>]*class="event-card"', html)]
    out = []
    for a, b in zip(starts, starts[1:] + [len(html)]):
        card = html[a:b]
        kickoff = re.search(r'data-time="(\d+)"', card[:400])
        final = bool(re.search(r'data-field="state">\s*FINAL', card))
        rows = {}
        for side in ("away", "home"):
            m = re.search(rf'<tr class="event-card-row[^"]*"\s+data-side="{side}">(.*?)</tr>', card, re.S)
            if not m:
                break
            row = m.group(1)
            name = re.search(r'class="team-name">\s*<a[^>]*>\s*<span>([^<]+)</span>', row)
            score = re.search(r'class="event-card-score[^"]*">\s*([0-9]+)', row)
            spread = re.search(rf'data-field="(?:live|current)-spread"\s+data-side="{side}">.*?<span class="data-value">\s*([^<]+?)\s*</span>', row, re.S)
            total = re.search(r'data-field="(?:live|current)-total"[^>]*>.*?<span class="data-value">\s*([^<]+?)\s*</span>', row, re.S)
            opener = re.search(r'class="event-card-open[^"]*">.*?<span class="data-value">\s*([^<]+?)\s*</span>', row, re.S)
            rows[side] = {"name": re.sub(r"\s*\(\d+\)\s*$", "", name.group(1)).strip() if name else None,   # 'Ohio State (4)' -> 'Ohio State'
                          "score": int(score.group(1)) if score else None,
                          "spread": _num(spread.group(1)) if spread else None, "total": _num(total.group(1)) if total else None,
                          "open": opener.group(1).strip() if opener else None}
        if len(rows) < 2 or not rows["home"]["name"] or not rows["away"]["name"]:
            continue
        home, away = rows["home"], rows["away"]
        if home["spread"] is not None:
            spread_home = home["spread"]
        elif away["spread"] is not None:
            spread_home = -away["spread"]
        else:
            spread_home = None
        total = home["total"] if home["total"] is not None else away["total"]
        # the opening cells hold the spread on one row and the total (o/u) on the other, in either order
        open_spread_home = open_total = None
        for side, row in (("home", home), ("away", away)):
            txt = (row["open"] or "").strip().lower()
            if not txt:
                continue
            if txt[0] in "ou":
                open_total = _num(txt)
            elif _num(txt) is not None:
                open_spread_home = _num(txt) if side == "home" else -_num(txt)
        out.append({"home_name": home["name"], "away_name": away["name"],
                    "kickoff": datetime.fromtimestamp(int(kickoff.group(1)), tz=timezone.utc).isoformat() if kickoff else None,
                    "final": final, "home_score": home["score"], "away_score": away["score"],
                    "spread_home": spread_home, "total": total, "open_spread_home": open_spread_home, "open_total": open_total})
    return out


def fetch_board(date: str | None = None) -> list[dict]:
    url = URL + (f"?date={date}" if date else "")
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=60) as r:
        html = r.read().decode("utf-8", errors="replace")
    return parse_board(html)


def lines_for_dates(dates: list[str], teams: dict) -> dict[tuple[str, str], dict]:
    """(home slug, away slug) -> line, over one request per distinct date (ISO YYYY-MM-DD).
    Games the matcher cannot place are skipped."""
    lookup = teamnames.build_matcher(teams)
    for k, v in EXTRA_ALIASES.items():
        if v in teams:
            lookup[teamnames.norm(k)] = v
    out: dict[tuple[str, str], dict] = {}
    seen_pages = set()
    for d in sorted(set(dates)):
        try:
            board = fetch_board(d)
        except Exception as exc:  # noqa: BLE001
            print(f"  lines: could not fetch {d}: {exc}")
            continue
        key = tuple(g["home_name"] + g["away_name"] for g in board[:5])
        if key in seen_pages:
            continue
        seen_pages.add(key)
        for g in board:
            h, a = teamnames.match(g["home_name"], lookup), teamnames.match(g["away_name"], lookup)
            if h and a:
                out[(h, a)] = g
    return out


if __name__ == "__main__":
    date = sys.argv[1] if len(sys.argv) > 1 else None
    board = fetch_board(date)
    print(f"{len(board)} games on the board{' for ' + date if date else ''}")
    for g in board:
        sp = g["spread_home"]
        line = f"{g['home_name']} {sp:+.1f}" if sp is not None else "no line"
        res = f"  FINAL {g['away_name']} {g['away_score']} at {g['home_name']} {g['home_score']}" if g["final"] else f"  {g['away_name']} at {g['home_name']}"
        print(f"{res:<58} {line:<24} total {g['total']}  (open {g['open_spread_home']} / {g['open_total']})")
    if "--json" in sys.argv:
        print(json.dumps(board, indent=1))
