"""Every FBS program's starting program rating (docs/superpowers/specs/2026-10-26-program-ratings-design.md):

    history     1995-2025 from data/recruiting/coaches.json (every head coach's seasons: wins, games,
                final AP rank): each season scores win share + AP top-25 / top-10 / top-5 / number one
                bonuses, weighted by recency (half-life HALF_LIFE years), blended with the recruiting
                baseline (class strength 2005-2026); scaled so the best program is 100 and the median
                about 40
    winning     the last three seasons (2025 weighted 3, 2024 2, 2023 1): win share and the AP finish
    market      data/program_market.json (crowds and TV)
    nil         the NIL tier: from the recruiting baseline (the same budget nil_budget gave) and the market
    conference  the conference's strength: the mean engine rating of its members
    coach       the head coach's overall rating and tenure
    rating      the mix; tier 1-5

Writes data/program_history.json.    python tools/build_program_history.py
"""
from __future__ import annotations

import json
import math
import statistics as st
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from coach_career import programs
from sim import season
from sim.teamnames import build_matcher, match

COACHES = ROOT / "data" / "recruiting" / "coaches.json"
OUT = ROOT / "data" / "program_history.json"
FIRST, LAST = 1995, 2025
HALF_LIFE = 12.0
RANK_BONUS = ((1, 0.8), (5, 0.5), (10, 0.35), (25, 0.35))     # cumulative: a number one season scores 1 + 2.0
HISTORY_BASELINE = 0.35                                       # the recruiting baseline's share of history
MEDIAN_TARGET = 40.0


def seasons_by_school() -> dict[str, dict[int, dict]]:
    teams = season.load_teams()
    lookup = build_matcher(teams)
    out: dict[str, dict[int, dict]] = defaultdict(dict)
    for c in json.loads(COACHES.read_text(encoding="utf-8")):
        for s in c.get("seasons") or []:
            slug = match(s["school"], lookup)
            if slug in teams and s.get("games") and FIRST <= s["year"] <= LAST:
                d = out[slug].setdefault(s["year"], {"w": 0, "g": 0, "rank": None})
                d["w"] += s.get("wins") or 0
                d["g"] += s["games"]
                d["rank"] = d["rank"] or s.get("postseasonRank")
    return out


def season_score(d: dict) -> float:
    s = d["w"] / d["g"]
    r = d.get("rank")
    if r:
        s += sum(b for top, b in RANK_BONUS if r <= top)
    return s


def scale(values: dict[str, float], median: float = MEDIAN_TARGET) -> dict[str, float]:
    """0-100 with the best at 100 and the median near `median` (a power curve on the share of the best)."""
    hi, lo = max(values.values()), min(values.values())
    share = {s: (v - lo) / (hi - lo) for s, v in values.items()}
    med = st.median(share.values())
    k = math.log(median / 100) / math.log(med) if 0 < med < 1 else 1.0
    return {s: 100 * v ** k for s, v in share.items()}


def build() -> dict:
    from coach_career import recruiting
    teams = season.load_teams()
    fbs = [s for s, t in teams.items() if not t.get("fictional")]
    hist_raw = {}
    by = seasons_by_school()
    for s in fbs:
        ys = by.get(s, {})
        if len(ys) < 8:
            continue
        ws = [(0.5 ** ((LAST - y) / HALF_LIFE), season_score(d)) for y, d in ys.items()]
        hist_raw[s] = sum(w * v for w, v in ws) / sum(w for w, _ in ws)
    results = scale(hist_raw)
    base_z = {s: recruiting._baseline(s) for s in fbs}
    classes = scale({s: z for s, z in base_z.items() if s in results})
    history = {s: (1 - HISTORY_BASELINE) * results[s] + HISTORY_BASELINE * classes[s] for s in results}
    history = scale(history)
    # winning: the last three seasons, 3-2-1
    winning = {}
    for s in fbs:
        ys = by.get(s, {})
        parts = [(w, season_score(ys[y]) / 3.0) for y, w in ((2025, 3), (2024, 2), (2023, 1)) if y in ys]
        winning[s] = sum(w * v for w, v in parts) / sum(w for w, _ in parts) if parts else 0.1
    winning = scale(winning, 40.0)
    # conference strength: the mean engine rating of its members
    conf_members = defaultdict(list)
    for s in fbs:
        conf_members[teams[s]["conference"]].append(teams[s]["team_ratings"]["overall"])
    conf_raw = {c: st.mean(v) for c, v in conf_members.items()}
    hi, lo = max(conf_raw.values()), min(conf_raw.values())
    conference = {c: 100 * (v - lo) / (hi - lo) for c, v in conf_raw.items()}
    out = {}
    for s in fbs:
        hc = (teams[s].get("coaches") or {}).get("head_coach") or {}
        tenure = 2026 - (hc.get("since") or 2026)
        coach = max(0.0, min(100.0, (hc.get("ratings") or {}).get("overall", 60) + 3 * min(5, tenure) - 5))
        nil = max(10.0, min(100.0, 50 + 25 * base_z[s] * 0.7 + 0.3 * (programs.market(s) - 50)))
        p = {"history": round(history.get(s, 15.0), 1), "winning": round(winning[s], 1), "market": programs.market(s),
             "nil": round(nil, 1), "conference": round(conference[teams[s]["conference"]], 1), "coach": round(coach, 1)}
        p["prestige"] = p["history"]
        p["rating"] = round(programs.mix(p), 1)
        p["tier"] = programs.tier_of(p["rating"])
        out[s] = p
    zs = [(out[s]["rating"], base_z[s]) for s in fbs]
    mx, my = st.mean(r for r, _ in zs), st.mean(z for _, z in zs)
    b = sum((r - mx) * (z - my) for r, z in zs) / sum((r - mx) ** 2 for r, _ in zs)
    return {"source": f"coaches.json seasons {FIRST}-{LAST}, recruiting baseline, program_market.json, engine ratings",
            "z_fit": {"a": round(my - b * mx, 4), "b": round(b, 5)}, "teams": out}


if __name__ == "__main__":
    d = build()
    OUT.write_text(json.dumps(d, indent=1, sort_keys=True), encoding="utf-8")
    t = d["teams"]
    rows = sorted(t.items(), key=lambda kv: -kv[1]["rating"])
    print(f"{len(t)} programs; z = {d['z_fit']['a']} + {d['z_fit']['b']} × rating")
    for s, v in rows[:30]:
        print(f"  {s:<16} rating {v['rating']:>5}  tier {v['tier']}  hist {v['history']:>5}  win {v['winning']:>5}  mkt {v['market']:>3}  nil {v['nil']:>5}  conf {v['conference']:>5}  coach {v['coach']:>5}")
    counts = {k: sum(1 for v in t.values() if v["tier"] == k) for k in range(1, 6)}
    print("tiers", counts, "history median", round(st.median(v["history"] for v in t.values()), 1))
