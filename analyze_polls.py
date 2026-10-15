"""Measure how the AP poll and the CFP committee actually behave, 2014-2025.

Reads data/history/polls.json and data/history/results.json (fetch_polls.py) and prints
the statistics the poll model in polls.py is built on:

  * after a loss: average spots dropped and share that fall out, by the loser's rank and
    whether the winner was ranked, at home or away, and by margin;
  * after a win: average spots gained by own rank and opponent rank, and the ceiling
    created by the teams above;
  * bye weeks;
  * how unranked teams enter: record and what they beat;
  * end-of-season rank by number of losses (what the voters allow);
  * committee vs AP: average rank difference by conference tier and record, and how
    often the committee's top 12 differs from the AP's;
  * preseason persistence: how much of the final poll is explained by the preseason poll.

Usage:  python analyze_polls.py [--json data/history/poll_stats.json]
"""
from __future__ import annotations

import json
import statistics as st
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
HIST = ROOT / "data" / "history"

P4_IDS = {"1", "4", "5", "8", "9", "151", "12", "17"}   # ACC, Big 12, Big Ten, SEC, Pac-12 (ESPN conference ids), plus ND handled by id
P4_CONFERENCES = {"ACC", "Big 12", "Big Ten", "SEC", "Pac-12"}


def load():
    polls = json.loads((HIST / "polls.json").read_text(encoding="utf-8"))
    results = json.loads((HIST / "results.json").read_text(encoding="utf-8"))
    return polls, results


def rank_map(ranking: list[dict]) -> dict[str, int]:
    return {r["team"]: r["rank"] for r in ranking}


def week_games(results: dict, season: str, week: int) -> list[dict]:
    return results.get(season, {}).get(str(week), [])


def bucket_rank(r: int) -> str:
    if r <= 5: return "1-5"
    if r <= 10: return "6-10"
    if r <= 15: return "11-15"
    if r <= 20: return "16-20"
    return "21-25"


def mean(xs):
    return st.mean(xs) if xs else float("nan")


def main() -> None:
    polls, results = load()
    seasons = [s for s in polls if s != "2026" and polls[s]["weeks"]]
    print(f"seasons: {seasons}")

    # ---- transitions: poll at week w (before games of week w) -> poll at week w+1
    loss_drop = defaultdict(list)      # (rank bucket, opp ranked?) -> drop (positive = fell), 26 = out
    loss_out = defaultdict(list)
    win_gain = defaultdict(list)       # (rank bucket, opp ranked?) -> gain (positive = rose)
    bye_change = []
    margin_effect = defaultdict(list)  # (result, margin bucket) -> change
    entries = []                       # unranked -> ranked: (record, beat ranked?)
    for s in seasons:
        weeks = sorted(int(w) for w in polls[s]["weeks"] if "ap" in polls[s]["weeks"][w])
        for w in weeks:
            if w + 1 not in weeks:
                continue
            before = rank_map(polls[s]["weeks"][str(w)]["ap"])
            after = rank_map(polls[s]["weeks"][str(w + 1)]["ap"])
            played = {}
            for g in week_games(results, s, w):
                for side, opp in (("home", "away"), ("away", "home")):
                    t = g[side]
                    o = g[opp]
                    won = t["score"] > o["score"]
                    played[t["id"]] = {"won": won, "opp_rank": before.get(o["id"]), "margin": abs(t["score"] - o["score"]),
                                       "home": side == "home" and not g["neutral"], "opp_id": o["id"]}
            for tid, r in before.items():
                new = after.get(tid, 26)
                change = new - r                       # positive = dropped
                if tid not in played:
                    bye_change.append(change)
                    continue
                p = played[tid]
                opp_ranked = p["opp_rank"] is not None
                key = (bucket_rank(r), "vs ranked" if opp_ranked else "vs unranked")
                if p["won"]:
                    win_gain[key].append(-change)
                    margin_effect[("win", "by 1-7" if p["margin"] <= 7 else "by 8-20" if p["margin"] <= 20 else "by 21+")].append(-change)
                else:
                    loss_drop[key].append(min(change, 26 - r))
                    loss_out[key].append(1 if new == 26 else 0)
                    margin_effect[("loss", "by 1-7" if p["margin"] <= 7 else "by 8-20" if p["margin"] <= 20 else "by 21+")].append(change)
                    loss_drop[(bucket_rank(r), "at home" if p["home"] else "away/neutral")].append(min(change, 26 - r))
            for tid, r in after.items():
                if tid in before or tid not in played:
                    continue
                p = played[tid]
                entries.append({"rank": r, "beat_ranked": p["opp_rank"] is not None and p["won"]})

    print("\n== After a LOSS: average spots dropped (26 = fell out), share that fell out ==")
    print(f"{'own rank':<10}{'opponent':<16}{'n':>5}{'avg drop':>10}{'median':>8}{'out %':>7}")
    for key in sorted(loss_drop, key=lambda k: (k[1], k[0])):
        xs = loss_drop[key]
        out = loss_out.get(key)
        print(f"{key[0]:<10}{key[1]:<16}{len(xs):>5}{mean(xs):>10.1f}{st.median(xs):>8.0f}{(100 * mean(out)) if out else float('nan'):>7.0f}")

    print("\n== After a WIN: average spots gained ==")
    print(f"{'own rank':<10}{'opponent':<16}{'n':>5}{'avg gain':>10}{'median':>8}")
    for key in sorted(win_gain, key=lambda k: (k[1], k[0])):
        xs = win_gain[key]
        print(f"{key[0]:<10}{key[1]:<16}{len(xs):>5}{mean(xs):>10.2f}{st.median(xs):>8.0f}")

    print("\n== Margin effect on rank change (positive = dropped) ==")
    for key in sorted(margin_effect):
        xs = margin_effect[key]
        print(f"  {key[0]:<5}{key[1]:<9} n={len(xs):<5} avg change {mean(xs):+.2f}")
    print(f"\n== Bye week: avg change {mean(bye_change):+.2f} over {len(bye_change)} team-weeks (positive = dropped)")

    print(f"\n== Entries from unranked: {len(entries)}; avg entry rank {mean([e['rank'] for e in entries]):.1f}; "
          f"{100 * mean([1 if e['beat_ranked'] else 0 for e in entries]):.0f}% entered by beating a ranked team")

    # ---- end of season: final AP rank by losses (regular season record at final CFP ranking week)
    print("\n== Final regular-season AP poll (week before bowls): best rank and median rank by losses ==")
    by_losses = defaultdict(list)
    for s in seasons:
        weeks = sorted(int(w) for w in polls[s]["weeks"] if "ap" in polls[s]["weeks"][w])
        last = polls[s]["weeks"][str(weeks[-1])]["ap"]
        for r in last:
            rec = r.get("record") or ""
            if "-" in rec:
                losses = int(rec.split("-")[1])
                by_losses[losses].append(r["rank"])
    for losses in sorted(by_losses):
        xs = by_losses[losses]
        print(f"  {losses} losses: n={len(xs):<4} best {min(xs):>2}  median {st.median(xs):>4.0f}  worst {max(xs)}")

    # ---- committee vs AP
    print("\n== CFP committee vs AP (same week): committee rank minus AP rank ==")
    diffs_all, diffs_conf, top12_diff = [], defaultdict(list), []
    conf_of = {}
    for s in seasons:
        for wk, games in results[s].items():
            for g in games:
                for side in ("home", "away"):
                    conf_of[(s, g[side]["id"])] = g[side].get("conference_id")
    for s in seasons:
        for w, v in polls[s]["weeks"].items():
            if "cfp" not in v or "ap" not in v:
                continue
            ap, cfp = rank_map(v["ap"]), rank_map(v["cfp"])
            for tid, cr in cfp.items():
                ar = ap.get(tid, 26)
                diffs_all.append(cr - ar)
                tier = "P4" if conf_of.get((s, tid)) in P4_IDS or tid == "87" else "G5/other"
                diffs_conf[tier].append(cr - ar)
            ap12 = {t for t, r in ap.items() if r <= 12}
            cfp12 = {t for t, r in cfp.items() if r <= 12}
            top12_diff.append(len(cfp12 - ap12))
    print(f"  all ranked teams: avg {mean(diffs_all):+.2f}, mean abs {mean([abs(x) for x in diffs_all]):.2f} over {len(diffs_all)} team-weeks")
    for tier, xs in diffs_conf.items():
        print(f"  {tier}: committee ranks them {mean(xs):+.2f} spots vs AP (positive = lower), n={len(xs)}")
    print(f"  top-12 membership: committee top 12 differs from AP top 12 by {mean(top12_diff):.2f} teams per week")

    # ---- preseason persistence
    print("\n== Preseason -> final (regular season) AP: ==")
    stay, pre_n, final_pre = [], 0, []
    for s in seasons:
        pre = rank_map(polls[s]["weeks"]["1"]["ap"]) if "1" in polls[s]["weeks"] else {}
        weeks = sorted(int(w) for w in polls[s]["weeks"] if "ap" in polls[s]["weeks"][w])
        last = rank_map(polls[s]["weeks"][str(weeks[-1])]["ap"])
        if not pre:
            continue
        pre_n += len(pre)
        stay.append(len(set(pre) & set(last)))
        final_pre.append(sum(1 for t in last if last[t] <= 10 and t in pre and pre[t] <= 10))
    print(f"  of the 25 preseason teams, {mean(stay):.1f} are still ranked at season's end; "
          f"{mean(final_pre):.1f} of the final top 10 were preseason top 10")

    if "--json" in sys.argv:
        out = {
            "loss_drop": {f"{k[0]}|{k[1]}": {"n": len(v), "mean": mean(v), "median": st.median(v)} for k, v in loss_drop.items()},
            "loss_out": {f"{k[0]}|{k[1]}": mean(v) for k, v in loss_out.items()},
            "win_gain": {f"{k[0]}|{k[1]}": {"n": len(v), "mean": mean(v)} for k, v in win_gain.items()},
            "margin": {f"{k[0]}|{k[1]}": mean(v) for k, v in margin_effect.items()},
            "bye": mean(bye_change),
            "final_by_losses": {str(k): {"best": min(v), "median": st.median(v), "worst": max(v), "n": len(v)} for k, v in by_losses.items()},
            "cfp_vs_ap": {"all": mean(diffs_all), **{k: mean(v) for k, v in diffs_conf.items()}, "top12_diff": mean(top12_diff)},
        }
        path = Path(sys.argv[sys.argv.index("--json") + 1])
        path.write_text(json.dumps(out, indent=1), encoding="utf-8")
        print(f"\nwrote {path}")


if __name__ == "__main__":
    main()
