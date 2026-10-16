"""Every rivalry names two real teams and a series; the series moves when the game is
played; Army-Navy (selection week) counts. (Run as a file: multiprocessing on Windows.)"""
import season

if __name__ == "__main__":
    teams = season.load_teams()
    rivs = [r for k, r in season.load_rivalries().items() if isinstance(k, frozenset)]
    for r in rivs:
        a, b = r["teams"]
        assert a in teams and b in teams and not teams[a]["fictional"] and not teams[b]["fictional"], r["name"]
        assert a in r["series"] and b in r["series"], r["name"]
    print(f"{len(rivs)} rivalries, every slug resolves")

    st = season.new_season("michigan", "full", seed=11)
    riv = season.rivalry_for("michigan", "ohio-state")
    before = season.rivalry_series(st, riv)
    g = next(g for g in st["games"].values() if {g["home"], g["away"]} == {"michigan", "ohio-state"})
    assert g["week"] == 14, g["week"]
    season.advance_to(st, 14)
    after = season.rivalry_series(st, riv)
    winner = g["home"] if g["home_score"] > g["away_score"] else g["away"]
    assert after["wins"][winner] == before["wins"][winner] + 1, (before, after)
    assert after["last"]["winner"] == winner
    line = season.game_rivalry(st, g, after=True)
    print("The Game:", before["text"], "->", after["text"], "|", line["headline"])
    sched = season.team_schedule(st, "michigan")
    row = next(x for x in sched if x["opponent"] == "ohio-state")
    assert row["rivalry"] and row["rivalry"]["series"] == before["text"], row["rivalry"]
    view = season.rivalries_view(st, "michigan")
    names = [r["name"] for r in view["rivalries"]]
    assert "The Game" in names and "Paul Bunyan Trophy" in [r["trophy"] for r in view["rivalries"]]
    print("Michigan rivalries:", [(r["name"], r["series"], r["game"] and (r["game"]["week"], r["game"]["won"])) for r in view["rivalries"]])

    st2 = season.new_season("army", "full", seed=4)
    season.advance_to(st2, 16)
    an = season.rivalry_series(st2, season.rivalry_for("army", "navy"))
    assert an["last"] and an["last"]["week"] == 16, an
    print("Army-Navy:", an["text"], "| last:", an["last"])
    print("rivalries ok")
