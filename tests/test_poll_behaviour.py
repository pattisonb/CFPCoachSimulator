"""Season-long AP behaviour in a simulated season against the real 2014-2025 polls
(data/history/poll_stats.json): how far a ranked team drops after a loss, by where it was
ranked, and how many teams the poll turns over in a week. Also checks the rest-of-season
mode starts from the real poll with its real vote points.
(Run as a file: multiprocessing on Windows cannot spawn workers from a piped script.)"""
import json
import statistics as st
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from sim import season  # noqa: E402


def rank_band(rank: int) -> str:
    """The AP rank band poll_stats.json groups losses by."""
    if rank <= 5:
        return "1-5"
    if rank <= 10:
        return "6-10"
    if rank <= 15:
        return "11-15"
    if rank <= 20:
        return "16-20"
    return "21-25"


if __name__ == "__main__":
    real = json.loads((ROOT / "data" / "history" / "poll_stats.json").read_text(encoding="utf-8"))["loss_drop"]
    drops: dict[str, list[int]] = {}
    turnover = []
    for seed in (3, 4):
        st_ = season.new_season("ohio-state", "full", seed=seed)
        season.advance_to(st_, 14)
        for w in range(1, 15):
            before = {e["team"]: e["rank"] for e in st_["polls"][str(w - 1)]["ap"]}
            after = {e["team"]: e["rank"] for e in st_["polls"][str(w)]["ap"]}
            assert all(e.get("points") for e in st_["polls"][str(w)]["ap"]), "every poll carries vote points"
            turnover.append(len(set(after) - set(before)))
            for g in st_["games"].values():
                if g["week"] != w or not g["played"] or g["home_score"] == g["away_score"]:
                    continue
                loser = g["away"] if g["home_score"] > g["away_score"] else g["home"]
                winner = g["home"] if loser == g["away"] else g["away"]
                r = before.get(loser)
                if not r:
                    continue
                kind = "vs ranked" if before.get(winner) else "vs unranked"
                drops.setdefault(f"{rank_band(r)}|{kind}", []).append(after.get(loser, 26) - r)
    print(f"{'band':<22}{'sim drop':>10}{'n':>5}{'real drop':>11}")
    for k in sorted(drops, key=lambda k: (int(k.split('|')[0].split('-')[0]), k)):
        rv = real.get(k, {}).get("mean")
        print(f"{k:<22}{st.mean(drops[k]):>10.1f}{len(drops[k]):>5}{(f'{rv:.1f}' if rv else '-'):>11}")
    print(f"new teams per week: sim {st.mean(turnover):.1f} (real polls 2014-2025 turn over about 3 a week)")

    rem = season.new_season("ohio-state", "remaining")
    w = rem["current_week"]
    real_last = season._real_ap_votes_2026(w, season.load_teams())
    if real_last:
        shown = rem["polls"][str(w)]["ap"]
        assert [e["team"] for e in shown] == real_last[0], "a real week shows the real poll"
        assert shown[0]["points"] == real_last[2][shown[0]["team"]]["points"], "with its real vote points"
        print(f"rest of season: week {w} shows the real poll with real points ({shown[0]['name']} {shown[0]['points']})")
    print("poll behaviour ok")
