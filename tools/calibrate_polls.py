"""Fit the AP and committee models in polls.py to the real 2014-2025 polls.

For each season the model starts from the real preseason AP poll (week 1), is fed the
real results week by week, and its weekly top 25 is compared with the real AP top 25
(mean absolute rank error over the real top 25, with "unranked" counted as 26, plus the
share of the real top 25 the model also has ranked). Parameters are tuned one at a time
over a grid (coordinate descent) until the error stops improving. The committee model is
fit the same way against the real CFP rankings, using the model's own AP-style scores and
the real AP ranks of that week as inputs.

Usage:  python calibrate_polls.py            # fit and write data/poll_params.json
        python calibrate_polls.py --eval     # score the saved parameters only
"""
from __future__ import annotations
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `import season` works from here

import json
import statistics as st
import sys
from pathlib import Path

import polls

ROOT = Path(__file__).resolve().parents[1]
HIST = ROOT / "data" / "history"
P4_IDS = {"1", "4", "5", "8", "9"}
G5_IDS = {"151", "12", "15", "17", "37"}


def load():
    p = json.loads((HIST / "polls.json").read_text(encoding="utf-8"))
    r = json.loads((HIST / "results.json").read_text(encoding="utf-8"))
    seasons = sorted(s for s in p if s != "2026" and p[s]["weeks"] and "1" in p[s]["weeks"] and "ap" in p[s]["weeks"]["1"])
    return p, r, seasons


def season_frames(polls_s: dict, results_s: dict):
    """Per week: the games of that week in model form, the real AP poll before and after."""
    weeks = sorted(int(w) for w in polls_s["weeks"] if "ap" in polls_s["weeks"][w])
    tiers = {}
    fbs = set()
    for games in results_s.values():
        for g in games:
            for side in ("home", "away"):
                cid = str(g[side].get("conference_id"))
                tid = g[side]["id"]
                if cid in P4_IDS or tid == "87":
                    tiers[tid] = "P4"
                elif cid in G5_IDS:
                    tiers[tid] = "G5"
                elif cid == "18":
                    tiers[tid] = "P4"   # independents other than ND are rare; treat as P4
                else:
                    tiers.setdefault(tid, "FCS")
                if cid and cid != "None":
                    fbs.add(tid)
    frames = []
    for w in weeks:
        games = [{"home": g["home"]["id"], "away": g["away"]["id"], "home_score": g["home"]["score"],
                  "away_score": g["away"]["score"], "neutral": g["neutral"]} for g in results_s.get(str(w), [])]
        frames.append({"week": w, "games": games, "ap_before": polls_s["weeks"][str(w)]["ap"],
                       "ap_after": polls_s["weeks"].get(str(w + 1), {}).get("ap"),
                       "cfp_after": polls_s["weeks"].get(str(w + 1), {}).get("cfp")})
    return frames, tiers, weeks


def replay(polls_s, results_s, ap_params, cfp_params, want_cfp=False):
    frames, tiers, weeks = season_frames(polls_s, results_s)
    pre = [r["team"] for r in sorted(polls_s["weeks"]["1"]["ap"], key=lambda r: r["rank"])]
    scores = polls.preseason_scores(pre, {}, ap_params)
    records: dict[str, list[int]] = {}
    opponents: dict[str, list[dict]] = {}
    ap_errs, ap_hits, cfp_errs, cfp_hits = [], [], [], []
    last_week = weeks[-1]
    model_rank = {t: i + 1 for i, t in enumerate(pre)}
    for f in frames:
        if not f["ap_after"]:
            break
        for g in f["games"]:
            for side, opp in (("home", "away"), ("away", "home")):
                t, o = g[side], g[opp]
                won = g[f"{side}_score"] > g[f"{opp}_score"]
                records.setdefault(t, [0, 0])
                records[t][0 if won else 1] += 1
                opponents.setdefault(t, []).append({"opp": o, "won": won})
        rec_t = {t: tuple(v) for t, v in records.items()}
        scores = polls.update_scores(scores, f["games"], model_rank, rec_t, tiers, f["week"], last_week, ap_params)
        order = polls.rank(scores, rec_t, tiers, ap_params)
        model_rank = {t: i + 1 for i, t in enumerate(order)}
        real = {r["team"]: r["rank"] for r in f["ap_after"]}
        for t, rr in real.items():
            ap_errs.append(abs(model_rank.get(t, 26) - rr))
            ap_hits.append(1 if t in model_rank else 0)
        if want_cfp and f["cfp_after"]:
            opp_full = {t: [{"opp": o["opp"], "won": o["won"], "opp_record": rec_t.get(o["opp"], (0, 0))} for o in lst]
                        for t, lst in opponents.items()}
            real_ap_after = {r["team"]: r["rank"] for r in f["ap_after"]}
            corder = polls.committee_rank(scores, rec_t, tiers, opp_full, real_ap_after, None, cfp_params)
            crank = {t: i + 1 for i, t in enumerate(corder)}
            for r in f["cfp_after"]:
                cfp_errs.append(abs(crank.get(r["team"], 26) - r["rank"]))
                cfp_hits.append(1 if r["team"] in crank else 0)
    return ap_errs, ap_hits, cfp_errs, cfp_hits


def evaluate(p, r, seasons, ap_params, cfp_params, want_cfp=False):
    ap_e, ap_h, cfp_e, cfp_h = [], [], [], []
    for s in seasons:
        a, b, c, d = replay(p[s], r[s], ap_params, cfp_params, want_cfp)
        ap_e += a; ap_h += b; cfp_e += c; cfp_h += d
    return (st.mean(ap_e) if ap_e else 99, st.mean(ap_h) if ap_h else 0,
            st.mean(cfp_e) if cfp_e else 99, st.mean(cfp_h) if cfp_h else 0)


GRID = {
    "rank_points": [8, 12, 16, 20, 26, 34], "unranked_floor": [-120, -60, -30, -15, 0, 15],
    "win_base": [20, 28, 38, 50, 65], "win_ranked_bonus": [1.5, 2.5, 3.5, 5.0, 7.0], "win_road_bonus": [0, 0.15, 0.35],
    "win_margin": [0, 0.15, 0.3, 0.5, 0.8], "loss_base": [50, 75, 100, 130, 170], "loss_unranked_extra": [0, 0.4, 0.7, 1.2, 1.8],
    "loss_top_discount": [0.2, 0.4, 0.6, 0.8], "loss_home_extra": [0, 0.25, 0.5, 0.8], "loss_margin": [0.4, 0.8, 1.2, 1.8, 2.5],
    "decay": [0.05, 0.12, 0.2, 0.3, 0.45], "record_weight": [30, 50, 75, 110, 160], "late_record_weight": [1, 1.5, 2.5],
    "g5_discount": [25, 45, 70, 100, 140],
}
CFP_GRID = {
    "sos_weight": [160, 250, 350, 500, 700], "quality_win_weight": [12, 24, 36, 50], "bad_loss_weight": [0, 10, 20, 40],
    "g5_discount": [45, 70, 100, 140], "loss_weight": [0, 10, 18, 30], "head_to_head": [0, 1, 2, 4],
    "champ_bonus": [0, 12, 25, 45],
}


def coordinate_descent(p, r, seasons, params, grid, score_fn, rounds=3):
    best = score_fn(params)
    for _ in range(rounds):
        improved = False
        for name, values in grid.items():
            current = params[name]
            for v in values:
                if v == current:
                    continue
                trial = {**params, name: v}
                s = score_fn(trial)
                if s < best - 1e-6:
                    best, params, improved = s, trial, True
            print(f"  {name:<22} -> {params[name]:<8} score {best:.3f}")
        if not improved:
            break
    return params, best


def main() -> None:
    p, r, seasons = load()
    ap_params, cfp_params = polls.load_params()
    print(f"seasons: {seasons}")
    if "--eval" in sys.argv:
        ae, ah, ce, ch = evaluate(p, r, seasons, ap_params, cfp_params, want_cfp=True)
        print(f"AP: mean abs rank error {ae:.2f}, real top-25 teams the model ranks {100 * ah:.0f}%")
        print(f"CFP: mean abs rank error {ce:.2f}, real top-25 teams the model ranks {100 * ch:.0f}%")
        return
    print("\nfitting the AP model")
    ap_params, ap_best = coordinate_descent(p, r, seasons, ap_params, GRID, lambda prm: evaluate(p, r, seasons, prm, cfp_params)[0])
    print("\nfitting the committee model")
    cfp_params, cfp_best = coordinate_descent(p, r, seasons, cfp_params, CFP_GRID,
                                              lambda prm: evaluate(p, r, seasons, ap_params, prm, want_cfp=True)[2], rounds=2)
    ae, ah, ce, ch = evaluate(p, r, seasons, ap_params, cfp_params, want_cfp=True)
    print(f"\nAP: mean abs rank error {ae:.2f}, real top-25 teams the model ranks {100 * ah:.0f}%")
    print(f"CFP: mean abs rank error {ce:.2f}, real top-25 teams the model ranks {100 * ch:.0f}%")
    polls.PARAMS_FILE.write_text(json.dumps({"ap": ap_params, "cfp": cfp_params, "ap_error": ae, "cfp_error": ce,
                                             "seasons": seasons}, indent=1), encoding="utf-8")
    print(f"wrote {polls.PARAMS_FILE}")


if __name__ == "__main__":
    main()
