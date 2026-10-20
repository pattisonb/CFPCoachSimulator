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
    """Every voter's next ballot from their last one, added up into the poll (polls.next_ballots,
    the same step season mode runs)."""
    _, points, _ = polls.next_ballots(ballots, prev, games, records, tiers, params)
    return [t for t, _ in Counter(points).most_common(n)]


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


ONE_WEEK_SLACK = 0.01     # the fit may give up this much one-week-ahead error (train), no more
REPLAY_SEEDS = (0, 1)     # voter seeds the season replay is averaged over (one seed's luck is not a fit)
FIXED = {"voter_noise"}   # left out of the fit: random by design (and the model's No. 1 is already less unanimous than real)
# Where the fit starts the ballot-only terms (BALLOT_PARAMS has them switched off, which a
# coordinate search could not leave: a cap of 1.0 or a zero weight changes nothing nearby).
FIT_STARTS = [{"close_win": 0.04, "close_own": 1.0, "entry_all": 1.0, "loss_edge_extra": 0.02, "loss_ranked_cap": 0.30},
              {"close_win": 0.15, "close_own": 2.0},
              {"close_win": 0.12, "close_own": 1.5, "loss_edge_extra": 0.02},
              {"close_win": 0.15, "close_own": 2.0, "entry_all": 1.0, "new_entry": 0.02}]
# The caps hold against the parameters before the behaviour terms (a3d8dd6), so a refit
# from fitted parameters cannot ratchet them: one week ahead 1.013 (train), season replay 3.114.
BASE_ONE_WEEK, BASE_SEASON = 1.013, 3.114
# Poll behaviours the season replay must reproduce (the 2026 realism review's list), each
# with the gap that counts as one unit. Rank error alone cannot see them: a model that is
# right on average about narrow wins (most real narrow winners still move up) is not
# punished for never dropping one.
BEHAVIOURS = {"close win: share dropped": 0.10, "3+ losses ranked, weeks 6-12 mean": 0.5,
              "21-25 lose: share out": 0.05, "16-25 lose to ranked: share out": 0.10,
              "ranked loser: mean drop": 1.0, "top-10 loser: mean drop": 1.0}
BEHAVIOUR_WEIGHT = 0.05   # rank-error points per unit of behaviour gap


def season_check(seasons: list[str], params: dict) -> tuple[float, float, dict]:
    """(season replay rank error, behaviour gap in units, the model's behaviour counts),
    averaged over REPLAY_SEEDS."""
    errs, gaps, counts = [], [], defaultdict(list)
    for s in REPLAY_SEEDS:
        real_seq, model_seq = season_replay(seasons, params, seed=s)
        errs.append(rolling_error(real_seq, model_seq)["all"])
        rb, mb = behaviour(real_seq), behaviour(model_seq)
        gaps.append(sum(abs(mb[k] - rb[k]) / u for k, u in BEHAVIOURS.items()))
        for k in BEHAVIOURS:
            counts[k].append(mb[k])
    return st.mean(errs), st.mean(gaps), {k: st.mean(v) for k, v in counts.items()}


def season_error(seasons: list[str], params: dict) -> float:
    return season_check(seasons, params)[0]


def objective(week_frames: list[dict], seasons: list[str], params: dict, one_week_cap: float,
              season_cap: float) -> tuple[float, float, float, float]:
    """(fit score, one week ahead MAE, season replay MAE, behaviour gap). The score is the
    season replay's rank error plus BEHAVIOUR_WEIGHT x the behaviour gap; going over either
    cap (one week ahead, or the season replay) counts ten times over."""
    one = evaluate(week_frames, params, "ballots")[0]
    roll, gap, _ = season_check(seasons, params)
    score = roll + BEHAVIOUR_WEIGHT * gap + 10.0 * max(0.0, one - one_week_cap) + 10.0 * max(0.0, roll - season_cap)
    return score, one, roll, gap


def fit() -> None:
    """Coordinate search on 2014-2023 over every ballot parameter. The score is the rank
    error of whole seasons rolled forward from seeded voters (the way season mode runs)
    plus the gap to the real polls' behaviours (BEHAVIOURS), with the one-week-ahead error
    (from the real ballots) held within ONE_WEEK_SLACK of the saved parameters' and the
    season replay no worse than theirs. One week ahead alone cannot see a poll that
    drifts over a season, because it starts from the real ballots every week."""
    nxt, bal = saved_params()
    train, valid = frames_with_ballots(TRAIN), frames_with_ballots(VALID)
    saved = {**polls.NEXT_PARAMS, **polls.BALLOT_PARAMS, **nxt, **bal}
    one_cap, season_cap = BASE_ONE_WEEK + ONE_WEEK_SLACK, BASE_SEASON
    line = lambda e: f"score {e[0]:.3f} (one week {e[1]:.3f}, season {e[2]:.3f}, behaviour gap {e[3]:.2f})"  # noqa: E731
    start = objective(train, TRAIN, saved, one_cap, season_cap)
    print(f"saved params: {line(start)}")
    best, params = start, saved
    for extra in FIT_STARTS:                 # the search starts from the best of these
        trial = {**saved, **extra}
        e = objective(train, TRAIN, trial, one_cap, season_cap)
        print(f"  start {extra}: {line(e)}", flush=True)
        if e[0] < best[0]:
            best, params = e, trial
    steps = {k: abs(v) * 0.25 + 0.005 for k, v in params.items()}
    t0 = time.time()
    for rnd in range(3):
        for k in sorted(set(params) - FIXED):
            for sign in (1, -1):
                trial = {**params, k: max(0.0, params[k] + sign * steps[k])}
                e = objective(train, TRAIN, trial, one_cap, season_cap)
                if e[0] < best[0] - 1e-4:
                    best, params = e, trial
                    print(f"  round {rnd + 1}: {k} -> {params[k]:.4f}  {line(best)}  ({time.time() - t0:.0f}s)", flush=True)
                    break
        steps = {k: v * 0.5 for k, v in steps.items()}
    v = evaluate(valid, params, "ballots")
    vs = season_check(VALID, params)
    v0 = evaluate(valid, saved, "ballots")[0], season_check(VALID, saved)
    print(f"validation 2024-2025: one week {v0[0]:.3f} -> {v[0]:.3f}, season {v0[1][0]:.3f} -> {vs[0]:.3f}, "
          f"behaviour gap {v0[1][1]:.2f} -> {vs[1]:.2f}")
    d = json.loads(PARAMS_FILE.read_text(encoding="utf-8")) if PARAMS_FILE.exists() else {}
    d["ballots"] = {k: round(params[k], 4) for k in params}
    d["ballots_note"] = (f"tools/backtest_ballots.py fit (season replay + {BEHAVIOUR_WEIGHT} x behaviour gap; one week "
                         f"within {ONE_WEEK_SLACK}): train one week {best[1]:.3f}, season {best[2]:.3f}, gap {best[3]:.2f}; "
                         f"validation one week {v[0]:.3f}, season {vs[0]:.3f}, gap {vs[1]:.2f}")
    PARAMS_FILE.write_text(json.dumps(d, indent=1), encoding="utf-8")
    print("saved under 'ballots' in", PARAMS_FILE)


# ----- the season replay: rolling the poll forward with no real poll to lean on ----------------

OTHERS = 15          # teams receiving votes carried into the next week's consensus (season mode keeps about this many)


def _entries_from(points: dict[str, int], first: dict[str, int], tiers: dict, n: int = 25 + OTHERS) -> list[dict]:
    ranked = sorted((t for t in points if tiers.get(t) != "FCS"), key=lambda t: (-points[t], -first.get(t, 0), t))[:n]
    return [{"team": t, "rank": i + 1, "points": points[t], "first_place": first.get(t, 0)} for i, t in enumerate(ranked)]


_REPLAY: dict[str, tuple[list[dict], list[dict]]] = {}


def _replay_frames(season: str) -> tuple[list[dict], list[dict]]:
    """(the season's weekly frames, the real weeks in behaviour form), built once per run."""
    if season not in _REPLAY:
        p, r, _ = load()
        frames = weeks_of(p, r, season)
        real = []
        for i, f in enumerate(frames):
            label = f["week"] + 1
            real_after = (p[season]["weeks"].get(str(label)) or {}).get("ap") or []
            real.append({"season": season, "week": f["week"], "label": label, "games": f["games"], "records": f["records"],
                         "tiers": f["tiers"], "since": i + 1,
                         "before": {e["team"]: e["rank"] for e in f["prev"] if (e.get("rank") or 99) <= 25},
                         "after": f["real"], "first": {e["team"]: e.get("first_place") or 0 for e in real_after}})
        _REPLAY[season] = frames, real
    return _REPLAY[season]


def season_replay(seasons: list[str], params: dict, seed: int = 0) -> tuple[list[dict], list[dict]]:
    """Each season from its first poll, seeded the way the game seeds its voters
    (polls.seed_ballots from the poll's vote points), then rolled forward through the real
    results without ever resetting to the real poll: the job season mode does. Returns two
    lists of weeks, real and model, each {season, week, label, before, after, first, games,
    records, tiers, since} so the same behaviour counts run on both."""
    real_seq, model_seq = [], []
    for s in seasons:
        frames, real = _replay_frames(s)
        if not frames:
            continue
        prev = frames[0]["prev"]
        ballots = polls.seed_ballots(prev, seed=seed * 1000 + int(s))
        for f, rw in zip(frames, real):
            ballots, points, first = polls.next_ballots(ballots, prev, f["games"], f["records"], f["tiers"], params,
                                                        seed=seed * 100000 + int(s) * 100 + f["week"])
            after = _entries_from(points, first, f["tiers"])
            model_seq.append({**rw, "before": {e["team"]: e["rank"] for e in prev if e["rank"] <= 25},
                              "after": {e["team"]: e["rank"] for e in after[:25]},
                              "first": {e["team"]: e["first_place"] for e in after[:25]}})
            real_seq.append(rw)
            prev = after
    return real_seq, model_seq


OUT = 30             # a team that drops out counts as rank 30 (as in the realism review)


def behaviour(seq: list[dict]) -> dict[str, float]:
    """The poll behaviours the 2026 realism review measured, over a run of weeks."""
    close, close_drop, win_drop, n_wins = [], 0, 0, 0
    ranked_loss, top10_loss = [], []
    lr_16, lr_16_out, l21, l21_out, lu_16, lu_16_out = 0, 0, 0, 0, 0, 0
    three_loss_w8, three_loss_mid, n1_share, n1_unanimous, n1_weeks = 0, [], [], 0, 0
    for wk in seq:
        b, a, tiers = wk["before"], wk["after"], wk["tiers"]
        for g in wk["games"]:
            if g["home_score"] is None or g["away_score"] is None or g["home_score"] == g["away_score"]:
                continue
            hw = g["home_score"] > g["away_score"]
            w_, l_ = (g["home"], g["away"]) if hw else (g["away"], g["home"])
            margin = abs(g["home_score"] - g["away_score"])
            if w_ in b:
                n_wins += 1
                win_drop += a.get(w_, OUT) > b[w_]
                if l_ not in b and tiers.get(l_) != "FCS" and margin <= 7:
                    close.append(b[w_] - a.get(w_, OUT))
                    close_drop += a.get(w_, OUT) > b[w_]
            if l_ in b:
                rk = b[l_]
                ranked_loss.append(a.get(l_, OUT) - rk)
                if rk <= 10:
                    top10_loss.append(a.get(l_, OUT) - rk)
                if rk >= 16:
                    if w_ in b:
                        lr_16 += 1
                        lr_16_out += l_ not in a
                    else:
                        lu_16 += 1
                        lu_16_out += l_ not in a
                if rk >= 21:
                    l21 += 1
                    l21_out += l_ not in a
        three = sum(1 for t in a if wk["records"].get(t, (0, 0))[1] >= 3)
        if wk["label"] == 8:
            three_loss_w8 += three
        if 6 <= wk["label"] <= 12:
            three_loss_mid.append(three)
        fp = wk["first"]
        total = sum(fp.values())
        no1 = min(a, key=a.get) if a else None
        if total and no1:
            n1_weeks += 1
            n1_share.append(fp.get(no1, 0) / total)
            n1_unanimous += fp.get(no1, 0) / total >= 0.97
    m = lambda xs: st.mean(xs) if xs else float("nan")  # noqa: E731
    seasons = len({wk["season"] for wk in seq}) or 1
    return {"close win: games": len(close), "close win: mean change": m(close),
            "close win: share dropped": close_drop / max(1, len(close)),
            "ranked winners: share dropped": win_drop / max(1, n_wins),
            "ranked loser: mean drop": m(ranked_loss), "top-10 loser: mean drop": m(top10_loss),
            "16-25 lose to ranked: n": lr_16, "16-25 lose to ranked: share out": lr_16_out / max(1, lr_16),
            "16-25 lose to unranked: share out": lu_16_out / max(1, lu_16),
            "21-25 lose: n": l21, "21-25 lose: share out": l21_out / max(1, l21),
            "3+ losses ranked in week 8, per season": three_loss_w8 / seasons,
            "3+ losses ranked, weeks 6-12 mean": m(three_loss_mid),
            "No. 1 first-place share": m(n1_share), "No. 1 unanimous (97%+) weeks": n1_unanimous / max(1, n1_weeks)}


def rolling_error(real_seq: list[dict], model_seq: list[dict]) -> dict[str, float]:
    """Rank error of the rolled-forward poll against the real one, by weeks since the start."""
    buckets: dict[str, list[float]] = defaultdict(list)
    for rw, mw in zip(real_seq, model_seq):
        order = sorted(mw["after"], key=mw["after"].get)
        e, _ = score_week(order, rw["after"])
        k = "1-4" if mw["since"] <= 4 else "5-8" if mw["since"] <= 8 else "9-12" if mw["since"] <= 12 else "13+"
        buckets[k].append(e)
        buckets["all"].append(e)
    return {k: st.mean(v) for k, v in buckets.items()}


def season_report(params: dict, label: str = "saved", seasons: list[str] = TRAIN + VALID) -> None:
    real_seq, model_seq = season_replay(seasons, params)
    err = rolling_error(real_seq, model_seq)
    print(f"season replay {seasons[0]}-{seasons[-1]} ({len(model_seq)} weeks), params: {label}")
    print("  rank error by weeks since the start: " + ", ".join(f"{k} {err[k]:.2f}" for k in ("1-4", "5-8", "9-12", "13+", "all") if k in err))
    rb, mb = behaviour(real_seq), behaviour(model_seq)
    print(f"  {'behaviour':<42}{'real':>8}{'model':>8}")
    for k in rb:
        print(f"  {k:<42}{rb[k]:>8.2f}{mb[k]:>8.2f}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "report"
    if cmd == "check":
        check()
    elif cmd == "fit":
        fit()
    elif cmd == "season":
        season_report(polls.load_ballot_params())
    else:
        report(*saved_params())
