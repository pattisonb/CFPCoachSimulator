"""The committee resume adds up: records match the standings, ranked wins and losses
match the games, strength of schedule ranks run 1..N, the best win is a win.
(Run as a file: multiprocessing on Windows cannot spawn workers from a piped script.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `import season` works from here
import season

if __name__ == "__main__":
    st = season.new_season("ohio-state", "full", seed=7)
    season.advance_to(st, 12)
    for w in (10, 12):
        data = season.resume(st, w)
        rows = data["rows"]
        rec = season._records(st, w)
        now = season.rank_map(st, w)
        n = len(rows)
        assert sorted(r["sos_rank"] for r in rows) == list(range(1, n + 1)), "SOS ranks must run 1..N"
        for r in rows:
            assert r["record"] == f"{rec[r['team']]['wins']}-{rec[r['team']]['losses']}", (r["team"], r["record"])
            assert r["rank"] == now.get(r["team"])
            if r["best_win"]:
                assert r["best_win"]["won"]
            if r["worst_loss"]:
                assert not r["worst_loss"]["won"]
        me = season.resume(st, w, "ohio-state")["rows"][0]
        games = me["games"]
        assert len(games) == rec["ohio-state"]["wins"] + rec["ohio-state"]["losses"]
        top_w = sum(1 for g in games if g["won"] and g["rank_now"])
        top_l = sum(1 for g in games if not g["won"] and g["rank_now"])
        assert me["top25"] == f"{top_w}-{top_l}", (me["top25"], top_w, top_l)
        # a hand count of the opponents' record
        opps = [g["opp"] for g in games if not g["fcs"]]
        ow = sum(rec[o]["wins"] for o in opps)
        ol = sum(rec[o]["losses"] for o in opps)
        assert abs(me["opp_pct"] - ow / (ow + ol)) < 0.001
        print(f"week {w}: {data['kind']} ranking · Ohio State {me['record']} · SOS #{me['sos_rank']} ({me['opp_pct']:.3f}/{me['oo_pct']:.3f}) · vs top 25 {me['top25']} · "
              f"best win {me['best_win'] and me['best_win']['opp_name']} · worst loss {me['worst_loss'] and me['worst_loss']['opp_name']}")
        top = rows[:5]
        print("  top of the table:", [(r["rank"], r["name"], r["record"], f"SOS {r['sos_rank']}", r["top25"]) for r in top])
    print("resume ok")
