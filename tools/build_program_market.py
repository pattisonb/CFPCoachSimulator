"""A program's market: how many people watch it. Home attendance for every FBS team from the
CFBD game list (data/market/games_attendance.json, three seasons, home games on campus, FBS
home teams) and the TV audience: the published Nielsen per-team averages for the teams that
have one (Nielsen only publishes the most-watched teams), and for the rest an estimate fitted
on those teams from attendance and conference. Writes data/program_market.json:

    {slug: {"attendance": mean home crowd, "attendance_games": n, "tv_millions": average viewers
            (published or estimated), "tv_known": bool, "market": 0-100}}

market = 60% attendance (against the biggest crowd, with a square-root curve so the middle of
FBS is not all 20s) + 40% TV (against 8 million).

    python tools/build_program_market.py
"""
from __future__ import annotations

import json
import statistics as st
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sim import season
from sim.teamnames import build_matcher, match

RAW = ROOT / "data" / "market" / "games_attendance.json"
OUT = ROOT / "data" / "program_market.json"
YEARS = ("2023", "2024", "2025")
ATTENDANCE_WEIGHT, TV_WEIGHT = 0.6, 0.4
TV_TOP = 8.0                       # million viewers a game: the most-watched team of a season
# published Nielsen per-team averages (million viewers a game): 2025 through week 10 (SI, Nielsen Big
# Data + Panel), the 2024 season list (SI) where 2025 is not published, Texas A&M and Miami from
# On3's 2025 tracker as quoted by SI
TV_KNOWN = {"alabama": 7.91, "georgia": 7.63, "tennessee": 7.03, "texas": 6.48, "ohio-state": 6.26, "lsu": 6.24,
            "oklahoma": 6.07, "florida": 5.67, "florida-state": 4.92, "ole-miss": 4.65, "texas-a-m": 4.99,
            "miami": 3.56, "michigan": 5.2, "kentucky": 4.5}
P4 = {"SEC", "Big Ten", "Big 12", "ACC"}


def attendance() -> dict[str, tuple[float, int]]:
    teams = season.load_teams()
    lookup = build_matcher(teams)
    raw = json.loads(RAW.read_text(encoding="utf-8"))
    crowds: dict[str, list[int]] = defaultdict(list)
    for y in YEARS:
        for g in raw.get(y, []):
            if not g.get("attendance") or g.get("neutral") or g.get("home_class") != "fbs":
                continue
            slug = match(g["home"], lookup)
            if slug and slug in teams:
                crowds[slug].append(int(g["attendance"]))
    return {s: (st.mean(v), len(v)) for s, v in crowds.items() if len(v) >= 6}


def fit_tv(att: dict[str, tuple[float, int]], conf: dict[str, str]) -> tuple[float, float, float]:
    """tv = a + b × attendance (thousands) + c × [Power 4 or Notre Dame], least squares on the
    published teams (every one is a big crowd in a Power 4 league, so c is set, not fitted:
    a Group of 5 crowd draws about a third of the audience of the same crowd in the Power 4)."""
    xs = [(att[s][0] / 1000, TV_KNOWN[s]) for s in TV_KNOWN if s in att]
    mx, my = st.mean(x for x, _ in xs), st.mean(y for _, y in xs)
    b = sum((x - mx) * (y - my) for x, y in xs) / sum((x - mx) ** 2 for x, _ in xs)
    a = my - b * mx
    return a, b, 0.0


def build() -> dict:
    teams = season.load_teams()
    att = attendance()
    conf = {s: t["conference"] for s, t in teams.items()}
    a, b, _ = fit_tv(att, conf)
    top_att = max(v[0] for v in att.values())
    out = {}
    for s, (mean_att, n) in att.items():
        p4 = conf.get(s) in P4 or s == "notre-dame"
        if s in TV_KNOWN:
            tv, known = TV_KNOWN[s], True
        else:
            tv, known = max(0.15, a + b * mean_att / 1000) * (1.0 if p4 else 0.35), False
        att_score = 100 * (mean_att / top_att) ** 0.5
        tv_score = 100 * min(1.0, tv / TV_TOP)
        out[s] = {"attendance": int(round(mean_att)), "attendance_games": n, "tv_millions": round(tv, 2), "tv_known": known,
                  "market": int(round(ATTENDANCE_WEIGHT * att_score + TV_WEIGHT * tv_score))}
    return {"source": "CFBD games 2023-2025 (home crowds); Nielsen per-team averages as published by SI/On3 for 14 teams, "
                      "the rest fitted on them from attendance (Group of 5 at 35%)",
            "fit": {"a": round(a, 3), "b_per_thousand": round(b, 4)}, "teams": out}


if __name__ == "__main__":
    d = build()
    OUT.write_text(json.dumps(d, indent=1, sort_keys=True), encoding="utf-8")
    t = d["teams"]
    rows = sorted(t.items(), key=lambda kv: -kv[1]["market"])
    print(f"{len(t)} programs; fit tv = {d['fit']['a']} + {d['fit']['b_per_thousand']} × crowd (thousands)")
    for s, v in rows[:12] + rows[-5:]:
        print(f"  {s:<18} market {v['market']:>3}  crowd {v['attendance']:>6}  tv {v['tv_millions']:.2f}{'' if v['tv_known'] else ' (est)'}")
    missing = [s for s, tm in season.load_teams().items() if s not in t and not tm.get("fictional")]
    print("no attendance:", missing)
