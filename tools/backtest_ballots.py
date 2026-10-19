"""The AP poll from the voters' own ballots: one week ahead, every week since 2014.

polls.next_poll moves each team's share of the vote. Here each voter's ballot moves
instead (data/ballots, tools/fetch_ballots.py): the week's results change the value the
voter gives each team, the voter re-ranks and names 25, and the ballots are added up the
way the AP adds them (25 points for first down to 1 for 25th). The same parameters drive
both, so the two can be compared head to head and fitted the same way.

Usage (from the project root):
    python tools/backtest_ballots.py check     # map ballot teams to ESPN ids; ballots vs the published points
    python tools/backtest_ballots.py           # both models with the saved parameters, season by season
    python tools/backtest_ballots.py fit       # fit the ballot model on 2014-2023, report 2024-2025
"""
from __future__ import annotations

import json
import statistics as st
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import polls  # noqa: E402
from backtest_polls import TRAIN, VALID, score_week, weeks_of  # noqa: E402
from calibrate_polls import load  # noqa: E402

BALLOTS = ROOT / "data" / "ballots"
PARAMS_FILE = ROOT / "data" / "poll_params.json"


# ----- the ballots, mapped to ESPN team ids --------------------------------------------------

def load_ballots(season: str) -> dict:
    path = BALLOTS / f"{season}.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"weeks": {}, "teams": {}}


def ballot_points(week: dict) -> tuple[Counter, Counter]:
    pts, first = Counter(), Counter()
    for v in week["voters"]:
        for i, t in enumerate(v["ballot"][:25]):
            pts[t] += 25 - i
        if v["ballot"]:
            first[v["ballot"][0]] += 1
    return pts, first


def _entries(p: dict, season: str, key: str) -> list[dict]:
    """The published poll (Top 25 plus others receiving votes) under polls.json's label."""
    if key == "preseason":
        return p[season].get("preseason", []) + p[season].get("preseason_others", [])
    if key == "final":
        return p[season].get("final", [])
    w = p[season]["weeks"].get(key) or {}
    return w.get("ap", []) + w.get("ap_others", [])


def _exact(pts: Counter, entries: list[dict]) -> int:
    published = Counter(float(e["points"]) for e in entries if e.get("points") is not None)
    return sum(1 for n in pts.values() if published.get(float(n)) == 1)


def align(season: str, p: dict, b: dict) -> dict[str, str]:
    """site week label -> polls.json label. The two number the weeks differently in some
    seasons (2026: the site's week 5 is ESPN's week 6), so each site poll goes to the
    published poll whose points it reproduces."""
    weeks = set(p[season]["weeks"])
    out = {}
    for wk, week in b["weeks"].items():
        pts, _ = ballot_points(week)
        keys = [wk] if not wk.isdigit() else [str(int(wk) + d) for d in (0, 1, -1, 2) if str(int(wk) + d) in weeks]
        if not keys:
            continue
        best = min(keys, key=lambda k: _gap(pts, _entries(p, season, k)))
        if _gap(pts, _entries(p, season, best)) < 0.03:       # the Top 25's points within 3% (a ballot may be missing)
            out[wk] = best
    return out


def _gap(pts: Counter, entries: list[dict]) -> float:
    """How far apart two polls' point totals are, team by team in rank order (relative)."""
    a = sorted(pts.values(), reverse=True)[:25]
    b = sorted((float(e["points"]) for e in entries if e.get("points") is not None), reverse=True)[:25]
    if len(a) < 20 or len(b) < 20:
        return 9.0
    return st.mean(abs(x - y) / max(y, 1.0) for x, y in zip(a, b))


def _norm(name: str) -> str:
    n = name.lower().replace("(fl)", "").replace("&", "and").replace("st.", "state")
    return "".join(ch for ch in n if ch.isalnum())


NAME_ALIASES = {"miamioh": "miamioh", "ucf": "ucf", "usc": "usc", "lsu": "lsu", "byu": "byu", "smu": "smu", "tcu": "tcu",
                "louisianalafayette": "louisiana", "ulmonroe": "ulmonroe", "hawaii": "hawaii"}


def _espn_names(season: str) -> dict[str, str]:
    """normalized team name -> ESPN id, from every game of the season."""
    r = json.loads((ROOT / "data" / "history" / "results.json").read_text(encoding="utf-8")).get(season, {})
    out = {}
    for games in r.values():
        for g in games:
            for side in ("home", "away"):
                out.setdefault(_norm(g[side]["name"]), g[side]["id"])
    return out


def team_map(season: str, p: dict, b: dict) -> tuple[dict[str, str], dict]:
    """site team slug -> ESPN id, by matching each team's ballot points to the published
    points in polls.json (equal totals in the same week are a fingerprint)."""
    votes: dict[str, Counter] = defaultdict(Counter)
    report = {"weeks": 0, "teams": 0, "exact": 0, "aligned": align(season, p, b)}
    for wk, key in report["aligned"].items():
        pts, _ = ballot_points(b["weeks"][wk])
        by_pts: dict[float, list[str]] = defaultdict(list)
        for e in _entries(p, season, key):
            if e.get("points") is not None:
                by_pts[float(e["points"])].append(e["team"])
        report["weeks"] += 1
        for slug, n in pts.items():
            ids = by_pts.get(float(n), [])
            report["teams"] += 1
            if len(ids) == 1:
                votes[slug][ids[0]] += 1
                report["exact"] += 1
    mapping = {slug: c.most_common(1)[0][0] for slug, c in votes.items()}
    # teams whose points never matched exactly (a handful of votes, ties): by name
    names = _espn_names(season)
    taken = set(mapping.values())
    for slug, display in b["teams"].items():
        if slug in mapping:
            continue
        key = NAME_ALIASES.get(_norm(display), _norm(display))
        tid = names.get(key)
        if tid and tid not in taken:
            mapping[slug] = tid
            taken.add(tid)
            report.setdefault("by_name", []).append(display)
    return mapping, report


def ballots_by_week(season: str, p: dict) -> dict[int, list[list[str]]]:
    """{poll week: [ballot as ESPN ids]} for the weekly polls (the frames' 'prev' weeks)."""
    b = load_ballots(season)
    mapping, rep = team_map(season, p, b)
    out = {}
    for wk, key in rep["aligned"].items():
        if key.isdigit():
            out[int(key)] = [[mapping[t] for t in v["ballot"] if t in mapping] for v in b["weeks"][wk]["voters"]]
    return out


# ----- the ballot model -----------------------------------------------------------------------

def next_from_ballots(ballots: list[list[str]], prev: list[dict], games: list[dict], records: dict, tiers: dict,
                      params: dict, n: int = 25) -> list[str]:
    """Every voter's next ballot from their last one, added up into the poll."""
    p = {**polls.NEXT_PARAMS, **params}
    share, _ = polls._share_table(prev)                     # the consensus: everyone's share of the vote
    off = p.get("off_ballot", 0.5)
    # one week's game facts, computed once
    facts = []
    played = set()
    for g in games:
        if g["home_score"] == g["away_score"]:
            continue
        for side, opp in (("home", "away"), ("away", "home")):
            t, o = g[side], g[opp]
            played.add(t)
            if tiers.get(t) == "FCS":
                continue
            ts, os_ = g[f"{side}_score"], g[f"{opp}_score"]
            facts.append((t, o, ts > os_, min(abs(ts - os_), 21) / 21.0, side == "home" and not g.get("neutral"), bool(g.get("neutral"))))
    winners_over = [(g["home"], g["away"]) if g["home_score"] > g["away_score"] else (g["away"], g["home"])
                    for g in games if g["home_score"] != g["away_score"]]
    points: Counter = Counter()
    for ballot in ballots:
        mine = {t: (25 - i) / 25.0 for i, t in enumerate(ballot[:25])}
        # off the ballot: the consensus share, scaled down (the voter left them off for a reason)
        val = {t: mine.get(t, share.get(t, 0.0) * off) for t in set(share) | set(mine)}
        for t, o, won, m, at_home, neutral in facts:
            if t not in val:
                w, l = records.get(t, (0, 0))
                entry = p["new_entry"] * max(0, w - 2 * l)
                val[t] = entry * (p["g5_entry"] if tiers.get(t) == "G5" else 1.0) - p["new_entry"]
            ov = mine.get(o, share.get(o, 0.0) * off)
            own = mine.get(t, share.get(t, 0.0) * off)
            if won:
                gain = p["win_base"] + p["win_opp"] * ov + p["win_margin"] * m + (0 if at_home or neutral else p["win_road"])
                if tiers.get(o) == "FCS":
                    gain *= p["fcs_win"]
                val[t] += gain
            else:
                bad = 1.0 if tiers.get(o) == "FCS" else (1.0 - min(1.0, ov))
                val[t] -= p["loss_base"] + p["loss_bad"] * bad + p["loss_margin"] * m + (p["loss_home"] if at_home else 0.0) + p["loss_own"] * own
        key = {}
        for t, v in val.items():
            if tiers.get(t) == "FCS":
                continue
            w, l = records.get(t, (0, 0))
            key[t] = v + (p["bye"] if t not in played else 0.0) + (p["unbeaten"] if l == 0 and w > 0 else 0.0) - p["loss_edge"] * l
        order = sorted(key, key=lambda t: -key[t])
        for w_, l_ in winners_over:
            if w_ in key and l_ in key and key[l_] > key[w_] and key[l_] - key[w_] < p["h2h"]:
                order.remove(w_)
                order.insert(order.index(l_), w_)
        for i, t in enumerate(order[:25]):
            points[t] += 25 - i
    return [t for t, _ in points.most_common(n)]


def forecast_order(season: str, week: int, n: int = 25) -> tuple[list[str], dict[str, str]] | None:
    """The ballot model's next poll from the published poll for `week` (polls.json label),
    its voters' ballots and that week's results, for a week whose next poll is not out yet.
    Returns (order as ESPN ids, {ESPN id: name}), or None if the ballots are missing."""
    from calibrate_polls import season_frames
    p, r, _ = load()
    by_week = ballots_by_week(season, p)
    if week not in by_week or str(week) not in p[season]["weeks"]:
        return None
    frames, tiers, _ = season_frames(p[season], r[season])
    records: dict[str, list[int]] = {}
    for f in frames:
        for g in f["games"]:
            if g["home_score"] is None or g["away_score"] is None or g["home_score"] == g["away_score"]:
                continue
            for side, opp in (("home", "away"), ("away", "home")):
                records.setdefault(g[side], [0, 0])[0 if g[f"{side}_score"] > g[f"{opp}_score"] else 1] += 1
        if f["week"] == week:
            games = [g for g in f["games"] if g["home_score"] is not None and g["away_score"] is not None]
            if not games:
                return None                        # the week's games are not played (or fetched) yet
            prev = f["ap_before"] + (p[season]["weeks"][str(week)].get("ap_others") or [])
            _, bal = saved_params()
            params = {**polls.NEXT_PARAMS, **(json.loads(PARAMS_FILE.read_text(encoding="utf-8")).get("next") or {}), **bal}
            order = next_from_ballots(by_week[week], prev, games, {t: tuple(v) for t, v in records.items()}, tiers, params, n=n)
            names = {e["team"]: e["name"] for e in prev}
            for games_w in r[season].values():
                for g in games_w:
                    for side in ("home", "away"):
                        names.setdefault(g[side]["id"], g[side]["name"])
            return order, names
    return None


# ----- backtests ------------------------------------------------------------------------------

def frames_with_ballots(seasons: list[str]) -> list[dict]:
    p, r, _ = load()
    out = []
    for s in seasons:
        by_week = ballots_by_week(s, p)
        for f in weeks_of(p, r, s):
            if f["week"] in by_week and by_week[f["week"]]:
                out.append({**f, "ballots": by_week[f["week"]]})
    return out


def evaluate(frames: list[dict], params: dict, model: str) -> tuple[float, float]:
    maes, hits = [], []
    for f in frames:
        if model == "ballots":
            order = next_from_ballots(f["ballots"], f["prev"], f["games"], f["records"], f["tiers"], params)
        else:
            order, _ = polls.next_poll(f["prev"], f["games"], f["records"], f["tiers"], params)
        mae, hit = score_week(order, f["real"])
        maes.append(mae)
        hits.append(hit)
    return st.mean(maes), st.mean(hits)


def saved_params() -> dict:
    d = json.loads(PARAMS_FILE.read_text(encoding="utf-8")) if PARAMS_FILE.exists() else {}
    return d.get("next") or {}, d.get("ballots") or {}


def check() -> None:
    p, _, _ = load()
    for s in sorted(p):
        b = load_ballots(s)
        if not b["weeks"]:
            print(f"{s}: no ballots")
            continue
        mapping, rep = team_map(s, p, b)
        unmapped = sorted(set(b["teams"]) - set(mapping))
        shifts = Counter((int(k) - int(w)) for w, k in rep["aligned"].items() if w.isdigit() and k.isdigit())
        print(f"{s}: {len(b['weeks'])} polls, {len(rep['aligned'])} aligned (site week -> ours: {dict(shifts)}), "
              f"{sum(len(w['voters']) for w in b['weeks'].values())} ballots; points match the published totals for "
              f"{rep['exact']} of {rep['teams']} team-weeks; {len(mapping)} of {len(b['teams'])} teams mapped"
              + (f", unmapped: {unmapped[:6]}" if unmapped else ""))


def report(params_next: dict, params_ballots: dict) -> None:
    for label, seasons in (("train 2014-2023", TRAIN), ("validation 2024-2025", VALID)):
        fr = frames_with_ballots(seasons)
        if not fr:
            print(f"{label:<22} no ballots yet")
            continue
        a = evaluate(fr, params_next, "share")
        b = evaluate(fr, {**params_next, **params_ballots}, "ballots")
        print(f"{label:<22} {len(fr):>4} weeks | vote-share model MAE {a[0]:.3f}, {a[1]:.2f}/25 | ballot model MAE {b[0]:.3f}, {b[1]:.2f}/25")


def fit() -> None:
    nxt, _ = saved_params()
    train, valid = frames_with_ballots(TRAIN), frames_with_ballots(VALID)
    params = {**polls.NEXT_PARAMS, **nxt, "off_ballot": 0.5}
    best = evaluate(train, params, "ballots")[0]
    print(f"start: train MAE {best:.3f}")
    steps = {k: abs(v) * 0.25 + 0.005 for k, v in params.items()}
    t0 = time.time()
    for rnd in range(3):
        for k in sorted(params):
            for sign in (1, -1):
                trial = {**params, k: max(0.0, params[k] + sign * steps[k])}
                e = evaluate(train, trial, "ballots")[0]
                if e < best - 1e-4:
                    best, params = e, trial
                    print(f"  round {rnd + 1}: {k} -> {params[k]:.4f}  train MAE {best:.3f}  ({time.time() - t0:.0f}s)", flush=True)
                    break
        steps = {k: v * 0.5 for k, v in steps.items()}
    v = evaluate(valid, params, "ballots")
    vn = evaluate(valid, {**polls.NEXT_PARAMS, **nxt}, "share")
    print(f"validation 2024-2025: ballot model MAE {v[0]:.3f} ({v[1]:.2f}/25) vs vote-share model {vn[0]:.3f} ({vn[1]:.2f}/25)")
    extra = {k: round(params[k], 4) for k in params}
    d = json.loads(PARAMS_FILE.read_text(encoding="utf-8")) if PARAMS_FILE.exists() else {}
    d["ballots"] = extra
    d["ballots_note"] = f"tools/backtest_ballots.py fit: train {best:.3f}, validation {v[0]:.3f} (vote-share model {vn[0]:.3f})"
    PARAMS_FILE.write_text(json.dumps(d, indent=1), encoding="utf-8")
    print("saved under 'ballots' in", PARAMS_FILE)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "report"
    if cmd == "check":
        check()
    elif cmd == "fit":
        fit()
    else:
        report(*saved_params())
