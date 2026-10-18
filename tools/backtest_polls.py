"""One week ahead, every week since 2014: the real AP poll (Top 25 and the others
receiving votes) plus that week's real results go into polls.next_poll, and its Top 25 is
scored against the next real poll. This is the job the poll model does every week of a
season, and the job of tools/ap_forecast.py.

Usage (from the project root):
    python tools/backtest_polls.py           # score the saved parameters, season by season
    python tools/backtest_polls.py fit       # fit on 2014-2023, report 2024-2026, save to data/poll_params.json
Needs data/history/polls.json with the others receiving votes (python tools/fetch_polls.py --others).
"""
from __future__ import annotations

import json
import statistics as st
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import polls  # noqa: E402
from calibrate_polls import load, season_frames  # noqa: E402

TRAIN = [str(y) for y in range(2014, 2024)]
VALID = ["2024", "2025"]
LIVE = ["2026"]


def weeks_of(p: dict, r: dict, season: str) -> list[dict]:
    """Per week: last week's poll with its others, the week's games, records after them, the next poll."""
    frames, tiers, _ = season_frames(p[season], r[season])
    records: dict[str, list[int]] = {}
    out = []
    for f in frames:
        for g in f["games"]:
            if g["home_score"] == g["away_score"]:
                continue
            for side, opp in (("home", "away"), ("away", "home")):
                won = g[f"{side}_score"] > g[f"{opp}_score"]
                records.setdefault(g[side], [0, 0])[0 if won else 1] += 1
        if not f["ap_after"]:
            continue
        others = p[season]["weeks"][str(f["week"])].get("ap_others") or []
        out.append({"season": season, "week": f["week"], "prev": f["ap_before"] + others, "games": f["games"],
                    "records": {t: tuple(v) for t, v in records.items()}, "tiers": tiers,
                    "real": {e["team"]: e["rank"] for e in f["ap_after"]}})
    return out


def score_week(order: list[str], real: dict[str, int]) -> tuple[float, int]:
    mine = {t: i + 1 for i, t in enumerate(order[:25])}
    errs = [abs(mine.get(t, 26) - rr) for t, rr in real.items()]
    return st.mean(errs), sum(1 for t in real if t in mine)


def evaluate(frames: list[dict], params: dict) -> tuple[float, float]:
    maes, hits = [], []
    for f in frames:
        order, _ = polls.next_poll(f["prev"], f["games"], f["records"], f["tiers"], params)
        m, h = score_week(order, f["real"])
        maes.append(m)
        hits.append(h)
    return st.mean(maes), st.mean(hits)


def baseline(frames: list[dict]) -> tuple[float, float]:
    maes, hits = [], []
    for f in frames:
        order = [e["team"] for e in sorted(f["prev"], key=lambda e: e["rank"])]
        m, h = score_week(order, f["real"])
        maes.append(m)
        hits.append(h)
    return st.mean(maes), st.mean(hits)


def fit(frames: list[dict], params: dict, rounds: int = 4) -> dict:
    """Coordinate descent: each parameter tried at several multiples of its value (and a few
    small absolute values when it is zero) until a full round brings no improvement."""
    best, _ = evaluate(frames, params)
    print(f"start: {best:.3f}")
    for rnd in range(rounds):
        improved = False
        for name in polls.NEXT_PARAMS:
            cur = params[name]
            cands = [cur * k for k in (0.0, 0.5, 0.7, 0.85, 1.15, 1.4, 2.0, 3.0)] if cur else [0.002, 0.005, 0.01, 0.02, 0.05, 0.1]
            for v in cands:
                trial = {**params, name: round(v, 5)}
                e, _ = evaluate(frames, trial)
                if e < best - 1e-4:
                    best, params, improved = e, trial, True
            print(f"  round {rnd + 1} {name:<12} -> {params[name]:<8} error {best:.3f}")
        if not improved:
            break
    return params


def report(p, r, params) -> None:
    rows = []
    for season in TRAIN + VALID + LIVE:
        if season not in p:
            continue
        frames = weeks_of(p, r, season)
        if not frames:
            continue
        m, h = evaluate(frames, params)
        bm, bh = baseline(frames)
        rows.append((season, len(frames), m, h, bm, bh))
    print(f"\n{'season':<8}{'weeks':>6}{'model MAE':>11}{'in 25':>7}{'last-week MAE':>15}{'in 25':>7}")
    for season, n, m, h, bm, bh in rows:
        tag = " (fit)" if season in TRAIN else " (held out)" if season in VALID else " (live)"
        print(f"{season:<8}{n:>6}{m:>11.2f}{h:>7.1f}{bm:>15.2f}{bh:>7.1f}{tag}")
    for label, group in (("fit 2014-2023", TRAIN), ("held out 2024-2025", VALID), ("2026", LIVE)):
        g = [x for x in rows if x[0] in group]
        if g:
            w = sum(x[1] for x in g)
            print(f"{label:<20} model {sum(x[2] * x[1] for x in g) / w:.2f}  last week unchanged {sum(x[4] * x[1] for x in g) / w:.2f}")


if __name__ == "__main__":
    p, r, _ = load()
    params = polls.load_next_params()
    if sys.argv[1:2] == ["fit"]:
        t0 = time.time()
        train = [f for s in TRAIN if s in p for f in weeks_of(p, r, s)]
        missing = sum(1 for f in train if not any((e.get("rank") or 0) > 25 for e in f["prev"]))
        print(f"{len(train)} training weeks ({missing} without others receiving votes)")
        params = fit(train, dict(params))
        saved = json.loads(polls.PARAMS_FILE.read_text(encoding="utf-8")) if polls.PARAMS_FILE.exists() else {}
        saved["next"] = params
        polls.PARAMS_FILE.write_text(json.dumps(saved, indent=1), encoding="utf-8")
        print(f"fit in {time.time() - t0:.0f}s, saved to {polls.PARAMS_FILE}")
    report(p, r, params)
