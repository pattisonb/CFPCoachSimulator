"""Your coach: a coach is validated, the team's coordinators stay when he takes over (his own
scheme only on a side he calls), his discipline moves relative to the coach he replaces, and
a season started with him or with the team's own coach says who is coaching.
(Run as a file: multiprocessing on Windows.)"""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `from sim import season` works from here
from sim import coaches
from sim import season


def assert_refused(coach: dict, failure: str) -> None:
    """coaches.clean must reject this coach with a ValueError; `failure` says what went wrong if not."""
    try:
        coaches.clean(coach)
    except ValueError:
        return
    raise AssertionError(failure)


if __name__ == "__main__":
    c = coaches.blank()
    # validation: a name is required and the ratings budget holds
    assert_refused(c, "a coach without a name was accepted")
    c.update(first_name="Test", last_name="Coach")
    assert_refused({**c, "ratings": {k: 99 for k in coaches.RATING_KEYS}}, "ratings over the budget were accepted")
    c = coaches.clean({**c, "calls_offense": True, "calls_defense": False, "offense_scheme": "Air Raid"})
    assert "oc" not in c and "dc" not in c   # no in-season hiring

    team = season.load_teams()["ohio-state"]
    t = coaches.apply_coach(team, c)
    oc, dc = team["coaches"]["offensive_coordinator"], team["coaches"]["defensive_coordinator"]
    # the coordinators stay; his scheme is used on the side he calls
    assert t["coaches"]["offensive_coordinator"]["name"] == oc["name"]
    assert t["coaches"]["offensive_coordinator"]["scheme"]["offensive_scheme"] == "Air Raid"
    assert t["coaches"]["defensive_coordinator"] == dc
    assert t["tendencies"]["pass_rate"] == c["style"]["pass_rate"]
    assert t["tendencies"]["blitz_rate"] == team["tendencies"]["blitz_rate"]
    assert team["coaches"]["offensive_coordinator"]["scheme"]["offensive_scheme"] != "Air Raid"   # the team itself is untouched
    # discipline moves by the difference from the coach he replaces
    old = team["coaches"]["head_coach"]["ratings"].get("discipline", 50)
    want = max(0, min(100, team["tendencies"].get("discipline", 50) + c["ratings"]["discipline"] - old))
    assert t["tendencies"]["discipline"] == want, (t["tendencies"]["discipline"], want)
    staff = coaches.staff(c, team)
    assert staff["offense"] == "calls the Air Raid offense as head coach" and staff["defense"].startswith(f"DC {dc['name']}"), staff

    # a season with him: he is in the summary, and the team the games use has his offense
    st = season.new_season("ohio-state", "full", seed=3, coach=c)
    line = season.summary(st)["coach"]
    assert line["existing"] is False and line["staff"] == staff, line
    played = season.with_edits(season.load_teams()["ohio-state"], season.team_edits(st, "ohio-state"))
    assert played["coaches"]["offensive_coordinator"]["scheme"]["offensive_scheme"] == "Air Raid"
    # taking over the team's own coach: the summary names him and his staff
    st2 = season.new_season("ohio-state", "full", seed=3)
    line2 = season.summary(st2)["coach"]
    assert line2["existing"] is True and line2["name"] == team["coaches"]["head_coach"]["name"], line2
    assert line2["staff"]["offense"].startswith(f"OC {oc['name']}"), line2
    print("coach ok:", line2["name"], "|", staff)
