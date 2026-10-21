"""Your coach: a coach is validated, his hired coordinators replace the team's, his discipline
moves relative to the coach he replaces, and a season started with him plays his staff.
(Run as a file: multiprocessing on Windows.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `import season` works from here
import coaches
import season

if __name__ == "__main__":
    c = coaches.blank()
    # validation: a name is required and the ratings budget holds
    try:
        coaches.clean(c)
        raise AssertionError("a coach without a name was accepted")
    except ValueError:
        pass
    c.update(first_name="Test", last_name="Coach")
    over = {**c, "ratings": {k: 99 for k in coaches.RATING_KEYS}}
    try:
        coaches.clean(over)
        raise AssertionError("ratings over the budget were accepted")
    except ValueError:
        pass
    # a hire only counts for a side he does not call
    c = coaches.clean({**c, "calls_offense": True, "oc": "kessler", "dc": "cole"})
    assert c["oc"] is None and c["dc"] == "cole", (c["oc"], c["dc"])
    c = coaches.clean({**c, "calls_offense": False, "oc": "dorsey"})
    assert c["oc"] == "dorsey"

    team = season.load_teams()["ohio-state"]
    t = coaches.apply_coach(team, c)
    assert t["coaches"]["offensive_coordinator"]["scheme"]["offensive_scheme"] == "Flexbone Triple Option"
    assert t["coaches"]["defensive_coordinator"]["scheme"]["defensive_scheme"] == "3-4"
    assert t["tendencies"]["pass_rate"] == coaches.OC_POOL["dorsey"]["style"]["pass_rate"]
    assert t["tendencies"]["blitz_rate"] == coaches.DC_POOL["cole"]["style"]["blitz_rate"]
    assert team["coaches"]["offensive_coordinator"]["scheme"]["offensive_scheme"] != "Flexbone Triple Option"   # the team itself is untouched
    # discipline moves by the difference from the coach he replaces
    old = team["coaches"]["head_coach"]["ratings"].get("discipline", 50)
    want = max(0, min(100, team["tendencies"].get("discipline", 50) + c["ratings"]["discipline"] - old))
    assert t["tendencies"]["discipline"] == want, (t["tendencies"]["discipline"], want)
    staff = coaches.staff(c)
    assert staff["offense"].startswith("OC Hank Dorsey") and staff["defense"].startswith("DC Reggie Cole"), staff

    # a season with him: his staff is in the summary and in the team the games use
    st = season.new_season("ohio-state", "full", seed=3, coach=c)
    summary = season.summary(st)
    assert summary["coach"]["staff"]["offense"].startswith("OC Hank Dorsey"), summary["coach"]
    played = season.with_edits(season.load_teams()["ohio-state"], season.team_edits(st, "ohio-state"))
    assert played["coaches"]["offensive_coordinator"]["name"] == "Hank Dorsey"
    print("coach ok:", staff)
