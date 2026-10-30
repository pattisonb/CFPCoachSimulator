"""The overnight realism report as a PDF: accuracy charts from tools/team_reality.py's data
(real 2026 season through the current week vs the simulated seasons), followed by the
written report (REPORT.md) and the per-team realism scores if they exist.

Usage (from the project root):
    python tools/realism_pdf.py [--dir data/analysis/overnight] [--scores scores.json] [--out report.pdf]
                                [--fullseason fullseason.json] [--report-title "Where things stand"]
"""
from __future__ import annotations

import argparse
import json
import math
import re
import statistics as st
import textwrap
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.backends.backend_pdf import PdfPages  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
INK, MUTED, GRID = "#1d2433", "#6b7385", "#e3e6ee"
TIER_COLOR = {"P4": "#c8102e", "G5": "#2f6db3", "FCS": "#888888"}
REAL, SIM = "#1d2433", "#e0802b"
PAGE = (8.5, 11)

plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 9, "axes.edgecolor": MUTED, "axes.labelcolor": INK,
                     "xtick.color": MUTED, "ytick.color": MUTED, "axes.titleweight": "bold", "axes.titlesize": 11,
                     "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.6, "axes.spines.top": False, "axes.spines.right": False})


def load(dir_: Path):
    teams = {p.stem: json.loads(p.read_text(encoding="utf-8")) for p in sorted((dir_ / "teams").glob("*.json"))}
    league = json.loads((dir_ / "league.json").read_text(encoding="utf-8"))
    return teams, league


def corr(xs, ys):
    if len(xs) < 3:
        return float("nan")
    mx, my = st.mean(xs), st.mean(ys)
    sx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    sy = math.sqrt(sum((y - my) ** 2 for y in ys))
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / (sx * sy) if sx and sy else float("nan")


def scatter(ax, pts, title, xlabel, ylabel, label_top=0):
    """pts: [(real, sim, tier, name)]; real on x, sim on y, with the y = x line."""
    pts = [p for p in pts if p[0] is not None and p[1] is not None]
    if not pts:
        ax.set_title(title)
        return
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    for tier, color in TIER_COLOR.items():
        sel = [p for p in pts if p[2] == tier]
        if sel:
            ax.scatter([p[0] for p in sel], [p[1] for p in sel], s=14, color=color, alpha=0.75, label=tier, linewidths=0)
    lo, hi = min(xs + ys), max(xs + ys)
    pad = (hi - lo) * 0.05 or 1
    ax.plot([lo - pad, hi + pad], [lo - pad, hi + pad], color=MUTED, linewidth=0.8, linestyle="--")
    ax.set_xlim(lo - pad, hi + pad)
    ax.set_ylim(lo - pad, hi + pad)
    bias = st.mean(y - x for x, y in zip(xs, ys))
    mae = st.mean(abs(y - x) for x, y in zip(xs, ys))
    ax.set_title(title)
    ax.set_xlabel(xlabel)
    ax.set_ylabel(ylabel)
    ax.text(0.02, 0.97, f"r = {corr(xs, ys):.2f}   avg gap {bias:+.1f}   avg miss {mae:.1f}", transform=ax.transAxes, va="top", fontsize=8, color=INK,
            bbox={"facecolor": "white", "edgecolor": GRID, "boxstyle": "round,pad=0.3"})
    if label_top:
        for p in sorted(pts, key=lambda p: -abs(p[1] - p[0]))[:label_top]:
            ax.annotate(p[3], (p[0], p[1]), fontsize=6.5, color=MUTED, xytext=(3, 3), textcoords="offset points")


def title_page(pdf, teams, league, scores, contents):
    fig = plt.figure(figsize=PAGE)
    fig.text(0.08, 0.90, "How real is the sim?", fontsize=26, fontweight="bold", color=INK)
    fig.text(0.08, 0.865, f"{league['sim_seasons']} simulated 2026 seasons against the real season through week {league['through_week']}, all {len(teams)} FBS teams",
             fontsize=11, color=MUTED)
    # headline numbers
    games, right, brier = 0, 0, []
    for t in teams.values():
        for w in t["weeks"]:
            r, s = w.get("real"), w.get("sim") or {}
            if r and s.get("win_pct") is not None and r["opponent"] in teams and t["team"] < r["opponent"]:
                games += 1
                p = s["win_pct"]
                right += (p > 0.5) == r["won"] if p != 0.5 else 0.5
                brier.append((p - (1 if r["won"] else 0)) ** 2)
    rw = [int(t["record"]["real"].split("-")[0]) for t in teams.values()]
    sw = [t["record"]["sim_mean_wins"] for t in teams.values()]
    pts_r = [matched(t, "offense")[0].get("points") for t in teams.values()]
    pts_s = [matched(t, "offense")[1].get("points") for t in teams.values()]
    pp = [(a, b) for a, b in zip(pts_r, pts_s) if a is not None and b is not None]
    tiles = [(f"{100 * right / games:.0f}%", f"of {games} FBS-vs-FBS games picked right\n(the sims' favorite won)"),
             (f"{st.mean(brier):.3f}", "Brier score of the sims' win odds\n(0.25 = coin flip; Vegas is about 0.18)"),
             (f"{corr(rw, sw):.2f}", "correlation of real wins with\nsimulated wins, team by team"),
             (f"{st.mean(abs(a - b) for a, b in pp):.1f}", "points per game: average miss\nbetween a team's real and sim offense")]
    if scores:
        vals = [s["score"] for s in scores]
        tiles.append((f"{st.mean(vals):.1f}/10", f"average realism score from\n{len(vals)} team analysts"))
    for i, (big, small) in enumerate(tiles):
        x = 0.08 + (i % 2) * 0.43
        y = 0.76 - (i // 2) * 0.135
        fig.text(x, y, big, fontsize=28, fontweight="bold", color="#c8102e")
        fig.text(x, y - 0.045, small, fontsize=9.5, color=INK, va="top")
    fig.text(0.08, 0.36, "In this report", fontsize=12, fontweight="bold", color=INK)
    for i, c in enumerate(contents):
        fig.text(0.08, 0.33 - i * 0.022, f"{i + 1}. {c}", fontsize=9.5, color=INK)
    fig.text(0.08, 0.16, "\n".join(textwrap.wrap(
        f"The week-by-week charts compare the real 2026 season (box scores and AP polls through week {league['through_week']}) with the average of the simulated seasons, "
        "which play the same schedule from week 1. Points on a scatter are teams (red Power 4, blue Group of 5); the dashed line is a "
        "perfect match. 'Avg gap' is sim minus real, 'avg miss' the average distance. Rushing counts sacks as rushes, as official stats do.", 100)),
        fontsize=8.5, color=MUTED, va="top")
    pdf.savefig(fig)
    plt.close(fig)


def records_and_games(pdf, teams):
    fig, axes = plt.subplots(2, 1, figsize=PAGE)
    pts = [(int(t["record"]["real"].split("-")[0]), t["record"]["sim_mean_wins"], t["tier"], t["name"]) for t in teams.values()]
    scatter(axes[0], pts, "Wins through week 8: real vs simulated", "real wins", "simulated wins (average of the seasons)", label_top=10)
    axes[0].legend(loc="lower right", fontsize=8)
    # calibration of game win odds
    bins = [(i / 10, (i + 1) / 10) for i in range(10)]
    agg = {b: [0, 0] for b in bins}
    for t in teams.values():
        for w in t["weeks"]:
            r, s = w.get("real"), w.get("sim") or {}
            if not r or s.get("win_pct") is None or r["opponent"] not in teams or t["team"] > r["opponent"]:
                continue
            p = s["win_pct"]
            b = next(b for b in bins if b[0] <= p < b[1] or (p == 1.0 and b[1] == 1.0))
            agg[b][0] += 1
            agg[b][1] += r["won"]
    xs = [(b[0] + b[1]) / 2 for b in bins if agg[b][0]]
    ys = [agg[b][1] / agg[b][0] for b in bins if agg[b][0]]
    ns = [agg[b][0] for b in bins if agg[b][0]]
    ax = axes[1]
    ax.plot([0, 1], [0, 1], color=MUTED, linestyle="--", linewidth=0.8)
    ax.plot(xs, ys, color="#c8102e", marker="o")
    for x, y, n in zip(xs, ys, ns):
        ax.annotate(f"{n}", (x, y), fontsize=7, color=MUTED, xytext=(4, -10), textcoords="offset points")
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.set_title("Game odds: when the sims gave a team X% to win, how often it won for real")
    ax.set_xlabel("simulated win share in that game (10 seasons)")
    ax.set_ylabel("real win rate")
    ax.text(0.02, 0.97, "numbers = games in the bin; on the dashed line = well calibrated", transform=ax.transAxes, va="top", fontsize=8, color=MUTED)
    fig.tight_layout(pad=2.0)
    pdf.savefig(fig)
    plt.close(fig)


def average_lines(lines: list[dict]) -> dict:
    """Key by key mean of per-game lines, over the lines where the value is a number (None if none is)."""
    keys = set().union(*[line.keys() for line in lines]) if lines else set()
    out = {}
    for k in keys:
        vals = [line[k] for line in lines if isinstance(line.get(k), (int, float))]
        out[k] = st.mean(vals) if vals else None
    return out


def matched(t: dict, side: str) -> tuple[dict, dict]:
    """Per-game averages over the same games only: weeks where the real game has a box score
    (real games against FCS teams usually do not) and the sims played it. Returns (real, sim).
    `side` "offense" averages the team's own lines; anything else the lines it allowed."""
    key = "line" if side == "offense" else "allowed"
    pairs = [(w["real"][key], w["sim"][key]) for w in t["weeks"]
             if (w.get("real") or {}).get(key) and (w.get("sim") or {}).get(key)]
    return average_lines([a for a, _ in pairs]), average_lines([b for _, b in pairs])


def pass_share(line: dict, sacks_in_carries: bool) -> float | None:
    """Dropbacks (passes and sacks) as a percentage of plays. Official carries already
    include the sacks; the sim's do not."""
    a, c, sk = line.get("pass_att") or 0, line.get("carries") or 0, line.get("sacks_taken") or 0
    plays = a + c + (0 if sacks_in_carries else sk)
    return 100 * (a + sk) / plays if plays else None


def team_stats(pdf, teams):
    fig, axes = plt.subplots(3, 2, figsize=PAGE)

    def pts(side, key):
        out = []
        for t in teams.values():
            r, s = matched(t, side)
            out.append((r.get(key), s.get(key), t["tier"], t["name"]))
        return out

    scatter(axes[0][0], pts("offense", "points"), "Points per game", "real", "simulated", 6)
    scatter(axes[0][1], pts("allowed", "points"), "Points allowed per game", "real", "simulated", 6)
    scatter(axes[1][0], pts("offense", "pass_yds"), "Passing yards per game", "real", "simulated", 6)
    scatter(axes[1][1], pts("offense", "rush_yds"), "Rushing yards per game (sacks as rushes)", "real", "simulated", 6)
    scatter(axes[2][0], pts("offense", "plays"), "Offensive plays per game", "real", "simulated", 6)
    share = []
    for t in teams.values():
        r, s = matched(t, "offense")
        share.append((pass_share(r, sacks_in_carries=True), pass_share(s, sacks_in_carries=False), t["tier"], t["name"]))
    scatter(axes[2][1], share, "Pass play share % (dropbacks / plays)", "real", "simulated", 6)
    fig.suptitle("Team offense and defense per game, same games only: real vs simulated", fontsize=13, fontweight="bold", color=INK)
    fig.tight_layout(pad=1.6, rect=(0, 0, 1, 0.97))
    pdf.savefig(fig)
    plt.close(fig)


def players(pdf, teams):
    fig, axes = plt.subplots(3, 2, figsize=PAGE)
    groups = [("QB", "pass_yards", "QB passing yards", lambda p: p["real"].get("pass_attempts", 0) >= 60),
              ("RB", "rush_yards", "RB rushing yards", lambda p: p["real"].get("carries", 0) >= 40),
              (("WR", "TE"), "receiving_yards", "WR/TE receiving yards", lambda p: p["real"].get("receptions", 0) >= 15),
              (("MLB", "ROLB", "LOLB", "S", "CB", "DL"), "tackles", "Tackles (solo + assisted)",
               lambda p: p["real"].get("solo_tackles", 0) + p["real"].get("assisted_tackles", 0) >= 25),
              (("DL", "ROLB", "LOLB", "MLB"), "sacks", "Sacks", lambda p: p["real"].get("sacks", 0) >= 3),
              ("RB", "carries", "RB carries (usage)", lambda p: p["real"].get("carries", 0) >= 40)]
    for ax, (pos, key, title, keep) in zip(axes.flat, groups):
        pts = []
        for t in teams.values():
            for p in t["players"]:
                if p["position"] not in (pos if isinstance(pos, tuple) else (pos,)) or not p["in_real_box_scores"] or not keep(p):
                    continue
                if key == "tackles":
                    r = p["real"].get("solo_tackles", 0) + p["real"].get("assisted_tackles", 0)
                    s = p["sim_mean"].get("solo_tackles", 0) + p["sim_mean"].get("assisted_tackles", 0)
                else:
                    r, s = p["real"].get(key, 0), p["sim_mean"].get(key, 0)
                pts.append((r, s, t["tier"], p["name"]))
        scatter(ax, pts, f"{title}, {len(pts)} players", "real, season to date", "simulated (average)", 5)
    fig.suptitle("Players: real season-to-date totals vs the simulated seasons' average", fontsize=13, fontweight="bold", color=INK)
    fig.tight_layout(pad=1.6, rect=(0, 0, 1, 0.97))
    pdf.savefig(fig)
    plt.close(fig)


def ap_and_league(pdf, teams, league):
    fig, axes = plt.subplots(3, 1, figsize=PAGE)
    W = league["through_week"]
    last = league["weeks"][-1]
    # AP points by rank: real vs each sim
    ax = axes[0]
    rp = [e.get("points") or 0 for e in last["real_ap"]]
    ax.plot(range(1, len(rp) + 1), rp, color=REAL, linewidth=2, label=f"real, week {W}")
    sims = last["sim_ap"]
    for i, s in enumerate(sims):
        pts = [e.get("points") or 0 for e in s]
        ax.plot(range(1, len(pts) + 1), pts, color=SIM, alpha=0.35, linewidth=1, label="simulated seasons" if i == 0 else None)
    ax.set_title(f"AP poll points by rank after week {W}")
    ax.set_xlabel("rank")
    ax.set_ylabel("points")
    ax.legend(fontsize=8)
    # real rank vs sim mean rank for the real top 25
    ax = axes[1]
    pts = []
    for e in last["real_ap"]:
        t = teams.get(e["team"])
        if not t:
            continue
        wk = next((w for w in t["weeks"] if w["week"] == W), None) or {}
        ranks = [r if r else 30 for r in ((wk.get("ap") or {}).get("sim_ranks") or [])]
        if ranks:
            pts.append((e["rank"], st.mean(ranks), t["tier"], t["name"]))
    scatter(ax, pts, f"AP rank after week {W}: real top 25 vs their simulated rank (unranked = 30)", "real rank", "simulated rank (average)", 8)
    ax.invert_xaxis()
    ax.invert_yaxis()
    # league by week: scoring and upsets
    ax = axes[2]
    wks = [w["week"] for w in league["weeks"]]
    real_tot = [w["real_mean_total_points"] for w in league["weeks"]]
    ax.plot(wks, real_tot, color=REAL, marker="o", label="real: points per game (both teams)")
    sim_tot = []
    for w in wks:
        vals = []
        for t in teams.values():
            wk = next((x for x in t["weeks"] if x["week"] == w), None) or {}
            s = wk.get("sim") or {}
            if s.get("points") is not None and s.get("opp_points") is not None:
                vals.append(s["points"] + s["opp_points"])
        sim_tot.append(st.mean(vals) if vals else None)
    ax.plot(wks, sim_tot, color=SIM, marker="o", label="simulated")
    ax.set_title("Scoring by week, every game")
    ax.set_xlabel("week")
    ax.set_ylabel("combined points per game")
    ax2 = ax.twinx()
    ru = [w.get("real_upset_rate_vs_ranked") for w in league["weeks"]]
    su = [st.mean([x for x in w.get("sim_upset_rate_vs_ranked") or [] if x is not None] or [0]) for w in league["weeks"]]
    ax2.bar([w - 0.18 for w in wks], [100 * (x or 0) for x in ru], width=0.35, color=REAL, alpha=0.18, label="real upset %")
    ax2.bar([w + 0.18 for w in wks], [100 * (x or 0) for x in su], width=0.35, color=SIM, alpha=0.25, label="sim upset %")
    ax2.set_ylabel("ranked teams beaten by lower/unranked (%)", color=MUTED)
    ax2.grid(False)
    lines, labels = ax.get_legend_handles_labels()
    l2, lb2 = ax2.get_legend_handles_labels()
    vals = [v for v in real_tot + sim_tot if v is not None]
    ax.set_ylim(min(vals) - 3, max(vals) + 2)
    ax.legend(lines + l2, labels + lb2, fontsize=7, loc="upper left", ncol=2, framealpha=0.9)
    fig.suptitle("AP poll and the league week by week", fontsize=13, fontweight="bold", color=INK)
    fig.tight_layout(pad=1.6, rect=(0, 0, 1, 0.97))
    pdf.savefig(fig)
    plt.close(fig)


def scores_page(pdf, teams, scores):
    if not scores:
        return
    fig, axes = plt.subplots(2, 1, figsize=PAGE, gridspec_kw={"height_ratios": [1, 2.2]})
    vals = [s["score"] for s in scores]
    ax = axes[0]
    ax.hist(vals, bins=range(1, 12), color="#c8102e", alpha=0.8, align="left", rwidth=0.85)
    ax.set_xticks(range(1, 11))
    ax.set_title(f"Realism score per team from the analysts (1-10), average {st.mean(vals):.1f}")
    ax.set_xlabel("score")
    ax.set_ylabel("teams")
    ax = axes[1]
    ordered = sorted(scores, key=lambda s: s["score"])
    pick = ordered[:15] + ordered[-15:]
    names = [teams[s["team"]]["name"] if s["team"] in teams else s["team"] for s in pick]
    colors = [TIER_COLOR.get((teams.get(s["team"]) or {}).get("tier"), MUTED) for s in pick]
    ax.barh(range(len(pick)), [s["score"] for s in pick], color=colors)
    ax.set_yticks(range(len(pick)))
    ax.set_yticklabels(names, fontsize=7)
    ax.axhline(14.5, color=MUTED, linewidth=0.8, linestyle="--")
    ax.set_xlim(0, 10)
    ax.set_title("The 15 teams the sim models worst (bottom) and best (top)")
    ax.grid(axis="y", visible=False)
    fig.tight_layout(pad=2.0)
    pdf.savefig(fig)
    plt.close(fig)


RANK_LABELS = {"pass_yards": "Passing yards", "pass_att": "Pass attempts", "rush_yards": "Rushing yards", "rush_att": "Carries",
               "rec_yards": "Receiving yards", "receptions": "Receptions", "tackles": "Tackles", "sacks": "Sacks", "interceptions": "Interceptions"}
TEAM_KEYS = [("ppg", "Points per game"), ("ypg", "Yards per game"), ("plays", "Plays per game"), ("ypp", "Yards per play"),
             ("pass_ypg", "Passing yards per game"), ("rush_ypg", "Rushing yards per game")]
REAL_TACKLE_SHARE = {"DL": 0.20, "LB": 0.40, "CB": 0.18, "S": 0.22}   # approximate real FBS split


def fullseason_pages(pdf, fs: dict):
    """Full simulated seasons (bowls and playoff included) against real 2023-2025 FBS seasons
    (tools/realism.py --json): national leaders by rank, then team per-game spreads and marks."""
    years = f"{fs['years'][0]}-{fs['years'][-1]}"
    ranks = fs["ranks"]
    fig, axes = plt.subplots(3, 3, figsize=PAGE)
    fig.suptitle(f"End of season: national leaders at each rank,\n{fs['seasons']} simulated seasons vs real {years}", fontsize=13, fontweight="bold", color=INK)
    for ax, (key, label) in zip(axes.flat, RANK_LABELS.items()):
        d = fs["leaders"].get(key)
        if not d:
            ax.set_visible(False)
            continue
        ax.plot(ranks, d["real"], color=REAL, marker="o", markersize=3.5, linewidth=1.6, label=f"real {years}")
        ax.plot(ranks, d["sim"], color=SIM, marker="o", markersize=3.5, linewidth=1.6, label="simulated")
        ax.set_xscale("log")
        ax.set_xticks(ranks)
        ax.set_xticklabels([f"#{r}" for r in ranks], fontsize=7)
        ax.minorticks_off()
        off = 100 * fs["area_off"].get(key, 0)
        ax.set_title(f"{label}  (off {off:.0f}%)", fontsize=9.5)
        ax.set_ylim(0, max(d["real"][0], d["sim"][0]) * 1.12)
    axes.flat[0].legend(loc="upper right", fontsize=7, frameon=False)
    fig.text(0.5, 0.015, "'Off' is the average gap between the simulated and real value at ranks 1-50. Real values average the 2023, 2024 and 2025 FBS leaders.",
             ha="center", fontsize=8, color=MUTED)
    fig.tight_layout(rect=(0, 0.03, 1, 0.95), pad=1.6)
    pdf.savefig(fig)
    plt.close(fig)

    fig = plt.figure(figsize=PAGE)
    fig.suptitle("End of season: team averages from best to worst,\nplayers over the usual marks, and who makes the tackles", fontsize=13, fontweight="bold", color=INK)
    gs = fig.add_gridspec(4, 3, height_ratios=[1, 1, 1.15, 0.9], hspace=0.75, wspace=0.35, top=0.88, bottom=0.05)
    spots = fs["team_ranks"]
    for i, (key, label) in enumerate(TEAM_KEYS):
        ax = fig.add_subplot(gs[i // 3, i % 3])
        d = fs["teams"].get(key)
        if not d:
            continue
        x = list(range(len(spots)))
        ax.plot(x, d["real"], color=REAL, marker="o", markersize=3.5, linewidth=1.6, label="real")
        ax.plot(x, d["sim"], color=SIM, marker="o", markersize=3.5, linewidth=1.6, label="sim")
        ax.set_xticks(x)
        ax.set_xticklabels(spots, fontsize=6.5, rotation=30)
        fmt = "{:.2f}" if key == "ypp" else "{:.1f}"
        ax.set_title(f"{label}\nmean {fmt.format(d['sim_mean'])} sim, {fmt.format(d['real_mean'])} real", fontsize=8.5)
        if i == 0:
            ax.legend(fontsize=7, frameon=False)
    ax = fig.add_subplot(gs[2, :])
    marks = fs["marks"]
    short = {"pass_yards": "passing yds", "rush_yards": "rushing yds", "rec_yards": "receiving yds", "sacks": "sacks", "tackles": "tackles", "interceptions": "INTs"}
    xs = list(range(len(marks)))
    ax.bar([x - 0.2 for x in xs], [st.mean(m["real"]) for m in marks], width=0.4, color=REAL, label=f"real {years} (average)")
    ax.bar([x + 0.2 for x in xs], [m["sim"] for m in marks], width=0.4, color=SIM, label="simulated")
    for x, m in zip(xs, marks):
        ax.plot([x - 0.2] * len(m["real"]), m["real"], linestyle="none", marker="_", color="#9aa3b5", markersize=9)
    ax.set_xticks(xs)
    ax.set_xticklabels([f"{m['mark']:,}+\n{short.get(m['stat'], m['stat'])}" for m in marks], fontsize=8)
    ax.set_title("Players over a season mark (gray ticks: each real season)", fontsize=10)
    ax.legend(fontsize=7.5, frameon=False)
    ax = fig.add_subplot(gs[3, :])
    sh = fs.get("tackle_shares") or {}
    groups = [g for g in REAL_TACKLE_SHARE if g in sh]
    xs = list(range(len(groups)))
    ax.bar([x - 0.2 for x in xs], [100 * REAL_TACKLE_SHARE[g] for g in groups], width=0.4, color=REAL, label="real FBS (approximate)")
    ax.bar([x + 0.2 for x in xs], [100 * sh[g] for g in groups], width=0.4, color=SIM, label="simulated")
    ax.set_xticks(xs)
    ax.set_xticklabels(groups)
    ax.set_ylabel("% of tackles")
    ax.set_title("Who makes the tackles", fontsize=10)
    ax.legend(fontsize=7.5, frameon=False)
    pdf.savefig(fig)
    plt.close(fig)


def text_pages(pdf, md: str, heading: str):
    """Render markdown as text pages: headings bold, tables and code in monospace."""
    lines = []
    for raw in md.splitlines():
        line = raw.rstrip()
        if line.startswith("#"):
            for w in textwrap.wrap(re.sub(r"^#+\s*", "", line), 82):
                lines.append(("h", w))
        elif line.startswith("|") or line.startswith("    ") or line.startswith("```"):
            if not set(line.replace("|", "").strip()) <= set("-: "):
                lines.append(("m", line[:118]))
        elif not line.strip():
            lines.append(("b", ""))
        else:
            text = re.sub(r"\*\*(.+?)\*\*", r"\1", line)
            text = re.sub(r"`(.+?)`", r"\1", text)
            indent = "    " if re.match(r"^\s*[-*\d]", text) else ""
            for w in textwrap.wrap(text, 98, subsequent_indent=indent) or [""]:
                lines.append(("t", w))
    per_page = 62
    first = True
    while lines:
        fig = plt.figure(figsize=PAGE)
        y = 0.95
        if first:
            fig.text(0.07, y, heading, fontsize=16, fontweight="bold", color=INK)
            y -= 0.04
            first = False
        count = 0
        while lines and count < per_page and y > 0.04:
            kind, text = lines.pop(0)
            if kind == "h":
                more = bool(lines) and lines[0][0] == "h"   # a long heading wrapped onto the next line
                y -= 0.006
                fig.text(0.07, y, text, fontsize=11.5, fontweight="bold", color="#c8102e")
                y -= 0.012 if more else 0.02
            elif kind == "m":
                fig.text(0.07, y, text, fontsize=6.6, family="DejaVu Sans Mono", color=INK)
                y -= 0.0125
            elif kind == "b":
                y -= 0.008
            else:
                fig.text(0.07, y, text, fontsize=8.6, color=INK)
                y -= 0.0145
            count += 1
        pdf.savefig(fig)
        plt.close(fig)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dir", default="data/analysis/overnight")
    ap.add_argument("--scores", default=None, help="JSON list of {team, score} (the workflow's realism scores)")
    ap.add_argument("--out", default=None)
    ap.add_argument("--fullseason", default=None, help="tools/realism.py --json output: adds the end-of-season pages")
    ap.add_argument("--report-title", default="The analysts' report", help="heading for REPORT.md's pages")
    a = ap.parse_args()
    d = ROOT / a.dir
    teams, league = load(d)
    scores = json.loads(Path(a.scores).read_text(encoding="utf-8")) if a.scores and Path(a.scores).exists() else None
    out = Path(a.out) if a.out else d / "Sim realism report.pdf"
    fs = json.loads(Path(a.fullseason).read_text(encoding="utf-8")) if a.fullseason else None
    rep = d / "REPORT.md"
    notes = [n for n in ("_league.md", "_ap.md", "_bugs.md") if (d / "findings" / n).exists()]
    contents = ["Wins and game odds", "Team offense and defense per game", "Players: real vs simulated totals",
                "AP poll and the league week by week"]
    if fs:
        contents += ["End of season: national leaders vs real 2023-2025", "End of season: team averages, season marks, tackles"]
    if scores:
        contents.append("Realism score per team (from the analysts)")
    if rep.exists():
        contents.append(a.report_title)
    if notes:
        contents.append("League, AP and bug analysts' notes")
    with PdfPages(out) as pdf:
        title_page(pdf, teams, league, scores, contents)
        records_and_games(pdf, teams)
        team_stats(pdf, teams)
        players(pdf, teams)
        ap_and_league(pdf, teams, league)
        if fs:
            fullseason_pages(pdf, fs)
        scores_page(pdf, teams, scores)
        if rep.exists():
            text_pages(pdf, rep.read_text(encoding="utf-8"), a.report_title)
        for name, title in (("_league.md", "League analyst"), ("_ap.md", "AP poll analyst"), ("_bugs.md", "Bug sweep")):
            f = d / "findings" / name
            if f.exists():
                text_pages(pdf, f.read_text(encoding="utf-8"), title)
    print("wrote", out)


if __name__ == "__main__":
    main()
