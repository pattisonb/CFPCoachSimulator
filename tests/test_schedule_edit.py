"""Customising your schedule before the season (sim/season.py schedule_options, schedule_swap):
in a career, before week 1, each of your non-conference games can be traded for another FBS
team's non-conference game the same week (the two displaced opponents play each other), the
other school agreeing when it gets the home game or you are the bigger draw; an FCS opponent can
be swapped for another FCS team. Conference games and played weeks stay as they are."""
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))
import collections

from sim import season

if __name__ == "__main__":
    st = season.new_season("smu", "full", seed=1, career=True)
    me = st["team"]
    teams = season.load_teams()
    before = collections.Counter()
    for g in st["games"].values():
        if g["kind"] == "regular":
            before[g["home"]] += 1
            before[g["away"]] += 1
    mine = season.schedule_editable(st)
    assert mine and all(not g["conference_game"] and g["kind"] == "regular" and me in (g["home"], g["away"]) for g in mine)
    fbs_game = next(g for g in mine if not teams[g["home"] if g["away"] == me else g["away"]].get("fictional"))
    old_opp = fbs_game["home"] if fbs_game["away"] == me else fbs_game["away"]
    opts = season.schedule_options(st, fbs_game["event_id"])
    assert len(opts) >= 10 and all({"slug", "name", "accepts", "why", "venue", "standing"} <= set(o) for o in opts), opts[:1]
    assert all(not teams[o["slug"]].get("fictional") for o in opts), "an FCS team offered for an FBS game"
    assert all(o["slug"] not in (me, old_opp) for o in opts)
    pick = next(o for o in opts if o["accepts"])
    g2 = season.schedule_swap(st, fbs_game["event_id"], pick["slug"])
    g = st["games"][fbs_game["event_id"]]
    assert pick["slug"] in (g["home"], g["away"]) and me in (g["home"], g["away"]) and g["week"] == fbs_game["week"]
    assert (g["home"] == me) == (pick["venue"] == "home")
    # the displaced opponents play each other that week; every team keeps its game count; nobody plays twice
    after = collections.Counter()
    weeks = collections.Counter()
    for x in st["games"].values():
        if x["kind"] == "regular":
            after[x["home"]] += 1
            after[x["away"]] += 1
            for side in (x["home"], x["away"]):
                if not teams[side].get("fictional"):              # an FCS team can host several dates a week
                    weeks[(x["week"], side)] += 1
    assert after == before, [(s, before[s], after[s]) for s in set(before) | set(after) if before[s] != after[s]]
    assert max(weeks.values()) == 1, [k for k, v in weeks.items() if v > 1][:3]
    other = next(x for x in st["games"].values() if x["kind"] == "regular" and x["week"] == g["week"] and old_opp in (x["home"], x["away"]))
    assert pick["slug"] not in (other["home"], other["away"]) and me not in (other["home"], other["away"])
    assert st["schedule_changes"][-1]["to"] == pick["slug"] and st["schedule_changes"][-1]["from"] == old_opp
    # a refusal, a conference game and a played week are refused
    refused = next((o for o in opts if not o["accepts"]), None)
    if refused:
        try:
            season.schedule_swap(st, fbs_game["event_id"], refused["slug"]); raise AssertionError("a school that said no")
        except season.ScheduleError:
            pass
    conf = next(x for x in st["games"].values() if x["kind"] == "regular" and x["conference_game"] and me in (x["home"], x["away"]))
    try:
        season.schedule_swap(st, conf["event_id"], pick["slug"]); raise AssertionError("a conference game swapped")
    except season.ScheduleError:
        pass
    # an FCS opponent can only be traded for another FCS team
    fcs_game = next((x for x in mine if teams[x["home"] if x["away"] == me else x["away"]].get("fictional")), None)
    if fcs_game:
        fopts = season.schedule_options(st, fcs_game["event_id"])
        assert fopts and all(teams[o["slug"]].get("fictional") and o["accepts"] and o["venue"] == "home" for o in fopts)
        season.schedule_swap(st, fcs_game["event_id"], fopts[0]["slug"])
        assert st["games"][fcs_game["event_id"]]["away"] == fopts[0]["slug"]
    season.advance_to(st, 1)
    try:
        season.schedule_swap(st, fbs_game["event_id"], pick["slug"]); raise AssertionError("swapped after the season began")
    except season.ScheduleError:
        pass
    season.close_pool()
    print(f"schedule edit ok: {len(mine)} non-conference games, {len(opts)} options for week {fbs_game['week']}, swapped {old_opp} for {pick['slug']} ({pick['why']})")
