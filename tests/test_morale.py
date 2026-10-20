"""Momentum and morale: off, the engine is unchanged (same fingerprint); on, moods and
form move with results, scale the ratings entering a game, and the in-game momentum
runs. (Run as a file: multiprocessing on Windows cannot spawn workers from a piped script.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `import season` works from here
import season
from engine import game_config as cfg
from engine.game import simulate_game
from test_play_log import fingerprint

if __name__ == "__main__":
    base = fingerprint()
    print("fingerprint with momentum off:", base, "(must match the engine's current fingerprint: dbc214023c433382)")
    assert base == "dbc214023c433382"

    # in-game momentum changes a game and leaves the flag off afterwards
    season._init(str(season.TEAMS_FILE))
    a = simulate_game(season._TEAMS["ohio-state"], season._TEAMS["michigan"], seed=5)
    b = simulate_game(season._TEAMS["ohio-state"], season._TEAMS["michigan"], seed=5, momentum=True)
    assert cfg.MOMENTUM is False
    print("momentum off:", a["home"]["score"], "-", a["away"]["score"], "| on:", b["home"]["score"], "-", b["away"]["score"])

    st = season.new_season("ohio-state", "full", seed=9)
    assert season.settings(st)["morale"] is True
    season.advance_to(st, 4)
    m = st["morale"]
    assert m["teams"] and m["players"], "no morale after four weeks"
    tm = m["teams"].get("ohio-state", 0.0)
    rec = season._records(st)["ohio-state"]
    print(f"Ohio State {rec['wins']}-{rec['losses']}: team mood {tm:+.2f}")
    assert (tm > 0) == (rec["wins"] > rec["losses"]) or rec["wins"] == rec["losses"]
    forms = m["players"].get("ohio-state", {})
    hot = sorted(forms.items(), key=lambda kv: -kv[1])[:3]
    cold = sorted(forms.items(), key=lambda kv: kv[1])[:3]
    print("hot:", hot, "| cold:", cold)
    assert all(-1 <= v <= 1 for v in forms.values())
    # the card shows the boost and the sim data carries it
    name, pos = hot[0][0].split("|")
    prof = season.player_profile(st, "ohio-state", name=name, position=pos)
    f = prof["morale"]["factor"]
    print(name, pos, "form", prof["morale"]["form"], "factor", f, "label", prof["morale"]["label"], "boosts", [(r["key"], r["boost"]) for r in prof["ratings"] if r["boost"]][:4])
    assert prof["morale"]["enabled"] and 0.9 <= f <= 1.1
    if f > 1.0:
        assert any(r["boost"] > 0 for r in prof["ratings"])
    data = season.with_morale(season.team_data(st, "ohio-state"), season.morale_payload(st, "ohio-state"))
    raw = next(p for p in season.team_data(st, "ohio-state")["offense"] + season.team_data(st, "ohio-state")["defense"] if p["name"] == name)
    adj = next(p for p in data["offense"] + data["defense"] if p["name"] == name)
    if f >= 1.01:
        assert adj["speed"] >= raw["speed"]
    # with the setting off nothing applies
    season.update_settings(st, {"morale": False})
    assert season.morale_factor(st, "ohio-state", name, pos) == 1.0 and season.morale_payload(st, "ohio-state") is None
    season.advance_to(st, 5)
    print("morale ok")
