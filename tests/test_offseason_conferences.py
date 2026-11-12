"""The offseason's last two steps (offseason.py): Change Conferences moves a program to a conference that
already exists (none can be made; one the conferences cannot schedule is refused), and the move is the
league's; Edit Schedule draws next season's schedule from the stream next_season drew it from (the same
schedule when nothing is traded), trades your non-conference games, and the new season plays it.
`python3 tests/test_offseason_conferences.py`"""
import copy
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from coach_career import offseason   # noqa: E402
from sim import schedule_gen, season   # noqa: E402
from test_offseason import finished   # noqa: E402


def refused(fn, words):
    try:
        fn()
    except (offseason.ConferenceError, season.ScheduleError) as e:
        assert words in str(e), str(e)
        return
    raise AssertionError(f"not refused: {words}")


def to_stage(st, stage):
    st["offseason"]["auto"] = True
    while st["offseason"]["stage"] != stage:
        offseason.advance(st)


def main():
    st = season.new_season("smu", "full", seed=7, career=True)
    finished(st)
    offseason.start(st)
    to_stage(st, "staff")
    base = copy.deepcopy(st)
    refused(lambda: offseason.move_conference(st, "memphis", "ACC"), "only at the Change Conferences step")
    offseason.advance(st)
    assert st["offseason"]["stage"] == "conferences"
    names = [c["name"] for c in offseason.conferences_view(st)["conferences"]]
    assert "ACC" in names and any("American" in n for n in names), names
    refused(lambda: offseason.move_conference(st, "memphis", "Made Up Conference"), "already exists")
    v = offseason.move_conference(st, "memphis", "ACC")
    acc = next(c for c in v["conferences"] if c["name"] == "ACC")
    assert any(t["team"] == "memphis" and t["moved_from"] for t in acc["teams"]), "Memphis is in the ACC"
    assert v["moves"] == [{"team": "memphis", "name": acc_name(acc), "from": v["moves"][0]["from"], "to": "ACC"}]
    assert st["league"]["conference_moves"] == {"memphis": "ACC"}
    back = v["moves"][0]["from"]
    offseason.move_conference(st, "memphis", back)        # moved back: no move
    assert not st["league"]["conference_moves"] and not offseason.conferences_view(st)["moves"]
    offseason.move_conference(st, "memphis", "ACC")
    offseason.advance(st)
    assert st["offseason"]["stage"] == "schedule"
    sv = offseason.schedule_view(st)
    assert len(sv["games"]) == schedule_gen.GAMES and sv["open"], len(sv["games"])
    mem = [g for g in st["offseason"]["next_schedule"]["games"].values() if "memphis" in (g["home"], g["away"]) and g["conference_game"]]
    acc_teams = {s for s, t in offseason.next_teams(st).items() if t["conference"] == "ACC"}
    assert mem and all({g["home"], g["away"]} - {"memphis"} <= acc_teams for g in mem), "Memphis plays an ACC slate"
    # a trade, if one is open
    tr = next(((g, o) for g in sv["editable"] for o in g["options"] if o["accepts"]), None)
    if tr:
        g, o = tr
        sv = offseason.schedule_trade(st, g["event_id"], o["slug"])
        assert sv["changes"] and sv["changes"][-1]["to"] == o["slug"]
    offseason.advance(st)
    assert st["offseason"]["stage"] == "ready"
    refused(lambda: offseason.schedule_trade(st, "x", "y"), "only at the Edit Schedule step")
    drawn = copy.deepcopy(st["offseason"]["next_schedule"]["games"])
    new = offseason.next_season(st)
    assert {k: (g["home"], g["away"], g["week"]) for k, g in new["games"].items() if g["kind"] == "regular"} == \
        {k: (g["home"], g["away"], g["week"]) for k, g in drawn.items()}, "the new season plays the schedule drawn and edited"
    assert season.load_teams()["memphis"]["conference"] == "ACC"

    # nothing moved, nothing traded: the same schedule next_season always drew
    a, old = copy.deepcopy(base), copy.deepcopy(base)
    a["id"], old["id"] = base["id"] + "-a", base["id"] + "-b"      # each its own next-year teams file (the first run cached Memphis in the ACC)
    offseason.run_all(a)
    old["offseason"]["auto"] = True
    offseason.advance(old)                               # staff -> conferences
    old["offseason"]["stage"] = "ready"                  # skip the new steps: next_season draws as it did
    na, nb = offseason.next_season(a), offseason.next_season(old)
    key = lambda s: sorted((g["home"], g["away"], g["week"]) for g in s["games"].values() if g["kind"] == "regular")
    assert key(na) == key(nb), "drawing the schedule a step early changed it"
    for c in (a, old, base):
        from coach_career import league as lg
        lg.forget(c["id"])
    print("offseason conferences ok: moves only to existing conferences, undone by moving back, an ACC slate for Memphis; "
          "the schedule drawn at Edit Schedule, traded, and played; untouched it is the schedule next_season drew")


def acc_name(acc):
    return next(t["name"] for t in acc["teams"] if t["team"] == "memphis")


if __name__ == "__main__":
    main()
