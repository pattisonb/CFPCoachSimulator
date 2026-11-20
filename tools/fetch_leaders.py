"""Real FBS season-end stat distributions from cfbstats.com, for tools/realism.py.

For each season: the national top 100 by season total in passing, rushing and
receiving yards, tackles, sacks and interceptions (with the attempts, catches and games
that go with them), and every FBS team's per-game scoring and total offense (games,
plays, yards). Totals include bowl and playoff games. Only numbers are kept (no names),
in data/history/fbs_leaders.json.

Usage (from the project root): python tools/fetch_leaders.py [2023 2024 2025]
One request every 1.5 seconds; pages are cached in data/history/cfbstats_cache/ (ignored).
"""
from __future__ import annotations

import json
import re
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "history" / "fbs_leaders.json"
CACHE = ROOT / "data" / "history" / "cfbstats_cache"
UA = {"User-Agent": "Mozilla/5.0 (CFPCoachSimulator stat check)"}

# cfbstats category number, our name, the column the table is sorted by, the columns kept
PLAYER = [("02", "pass_yards", "Yards", ["G", "Att", "Comp", "Yards", "TD", "Int"]),
          ("01", "rush_yards", "Yards", ["G", "Att", "Yards", "TD"]),
          ("03", "rec_yards", "Yards", ["G", "Rec.", "Yards", "TD"]),
          ("19", "tackles", "Total", ["G", "Solo", "Assisted", "Total"]),
          ("20", "sacks", "Sacks", ["G", "Sacks"]),
          ("16", "interceptions", "Int.", ["G", "Int."])]
TEAM = [("09", "scoring", ["G", "Points"]), ("10", "total_offense", ["G", "Rush Yards", "Pass Yards", "Plays", "Total Yards"])]


def get(url: str) -> str:
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / (re.sub(r"[^\w]+", "_", url.split("cfbstats.com/")[1]) + ".html")
    if f.exists():
        return f.read_text(encoding="utf-8", errors="replace")
    time.sleep(1.5)
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        s = r.read().decode("utf-8", errors="replace")
    f.write_text(s, encoding="utf-8")
    return s


def table(s: str) -> tuple[list[str], list[list[str]]]:
    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", s, re.S)
    head = [re.sub(r"<[^>]+>", "", c).strip() for c in re.findall(r"<th[^>]*>(.*?)</th>", rows[0], re.S)]
    body = [[re.sub(r"<[^>]+>", "", c).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", r, re.S)] for r in rows[1:]]
    return head, [b for b in body if b]


def num(x: str) -> float:
    try:
        return float(x.replace(",", ""))
    except ValueError:
        return 0.0


def season_data(season: str) -> dict:
    out: dict = {}
    for cat, name, sort_col, keep in PLAYER:
        base = f"https://cfbstats.com/{season}/leader/national/player/split01/category{cat}/sort01.html"
        s = get(base)
        m = re.search(r'sort(\d\d)\.html">' + re.escape(sort_col) + "<", s)
        if m and m.group(1) != "01":        # the column's link sorts the table by season total
            s = get(base.replace("sort01", f"sort{m.group(1)}"))
        head, body = table(s)
        idx = [head.index(k) for k in keep]
        rows = [[num(r[i]) for i in idx] for r in body if len(r) > max(idx)]
        rows.sort(key=lambda r: -r[keep.index(sort_col)])
        out[name] = {"columns": keep, "rows": rows}
        print(season, name, len(rows), rows[0] if rows else None, flush=True)
    for cat, name, keep in TEAM:
        head, body = table(get(f"https://cfbstats.com/{season}/leader/national/team/offense/split01/category{cat}/sort01.html"))
        idx = [head.index(k) for k in keep]
        out["team_" + name] = {"columns": keep, "rows": [[num(r[i]) for i in idx] for r in body if len(r) > max(idx)]}
        print(season, "team", name, len(body), flush=True)
    return out


if __name__ == "__main__":
    seasons = sys.argv[1:] or ["2023", "2024", "2025"]
    data = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    for s in seasons:
        data[s] = season_data(s)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, indent=1), encoding="utf-8")
    print("wrote", OUT)
