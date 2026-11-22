# Python's answers for sim_js/season/part2.js, held with the other parts stubbed (season_part2_compare.mjs reads them):
#   python3 sim_js/test/season_part2_reference.py OUTDIR   then   node sim_js/test/season_part2_compare.mjs OUTDIR
import copy, json, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)
os.environ["SIM_WORKERS"] = "1"
os.environ["CFP_SEASONS_DIR"] = os.path.join(sys.argv[1], "seasons")
from sim import season

out = {"run_games": [], "week_seeds": [], "ccg": [], "playoff": [], "bowls": [], "labels": {}, "redshirt": [], "injured": [], "misc": {}}
state = season.new_season("ohio-state", seed=11)
teams = season.load_teams()
out["fictional"] = sorted(s for s in teams if season.state_fictional(s))
out["labels"] = {str(w): [season.week_label(w), season.week_name(w)] for w in range(0, 21)}

def slim(state):
    return {k: copy.deepcopy(state.get(k)) for k in ("seeds", "rng_state", "depth", "injuries", "redshirting", "team", "current_week", "bracket", "polls", "playoff_sites", "league", "week_setup", "matchups_set", "champions", "career", "done", "bowls", "abilities_earned")} | {
        "games": [[eid, dict(g)] for eid, g in state["games"].items()]}

orig_seeds = season._week_seeds
def week_seeds(state, week):
    before = {"seeds": copy.deepcopy(state.get("seeds")), "rng_state": state["rng_state"], "games": [[eid, {"week": g["week"], "played": g["played"]}] for eid, g in state["games"].items()]}
    r = orig_seeds(state, week)
    out["week_seeds"].append({"before": before, "week": week, "result": copy.deepcopy(r), "rng_after": state["rng_state"], "order": list(r)})
    return r
season._week_seeds = week_seeds

orig_run = season._run_games
orig_sim = season._sim_one
def run_games(state, ids, pool=None, report=None, stage="Simulating"):
    rec = {"before": slim(state), "ids": list(ids), "stage": stage, "jobs": [], "results": {}, "reports": []}
    slugs = sorted({state["games"][e][s] for e in ids for s in ("home", "away")})
    rec["team_edits"] = {s: season.team_edits(state, s) for s in slugs}
    rec["morale_payload"] = {s: season.morale_payload(state, s) for s in slugs}
    rec["morale_on"] = season.morale_on(state)
    rec["clear_on"] = season._clear_on()
    def sim(job):
        rec["jobs"].append(json.loads(json.dumps(job)))
        r = orig_sim(job)
        slimr = {k: v for k, v in r.items() if k != "game"}
        rec["results"][r["event_id"]] = json.loads(json.dumps(slimr))
        return r
    season._sim_one = sim
    def rep(stage, a, b):
        rec["reports"].append([stage, a, b])
        if report: report(stage, a, b)
    orig_run(state, ids, pool, rep, stage)
    season._sim_one = orig_sim
    rec["after"] = {"games": [[eid, dict(g)] for eid, g in state["games"].items()], "injuries": copy.deepcopy(state.get("injuries")), "rng_state": state["rng_state"]}
    if state["current_week"] + 1 in (1, 15, 17, 20):
        out["run_games"].append(rec)
season._run_games = run_games

def wrap(name, key, stubs):
    orig = getattr(season, name)
    def f(state, *a):
        rec = {"before": slim(state), "args": [x for x in a if not isinstance(x, dict)]}
        for s in stubs:
            rec[s] = copy.deepcopy(getattr(season, s)(state))
        r = orig(state, *a)
        rec["result"] = copy.deepcopy(r)
        rec["after"] = {"bowls": copy.deepcopy(state.get("bowls")), "playoff_sites": copy.deepcopy(state.get("playoff_sites"))}
        out[key].append(rec)
        return r
    setattr(season, name, f)
wrap("_ccg_matchups", "ccg", ["standings", "divisions"])
wrap("_playoff_round", "playoff", [])
wrap("_bowl_games", "bowls", ["_records"])

stages = []
while not state["done"]:
    if state["current_week"] == 5:
        # redshirts and injuries mid-season
        t = season.team_data(state, "ohio-state")
        ps = (t["offense"] + t["defense"])[::9]
        state2 = copy.deepcopy(state); state2["career"] = True
        state2.setdefault("redshirting", {}).setdefault("ohio-state", {})[ps[1].get("slug")] = {"name": ps[1]["name"], "position": ps[1]["position"], "week": 3}
        for st in (state, state2):
            for p in ps:
                out["redshirt"].append(copy.deepcopy({"state": {k: st.get(k) for k in ("redshirting", "career", "team", "done")} | {"season_stats": {"ohio-state": {"players": st["season_stats"]["ohio-state"]["players"]}}},
                                        "p": {k: p.get(k) for k in ("name", "position", "class", "slug")}, "result": season.redshirt_status(st, "ohio-state", p)}))
        for slug in list(state.get("injuries") or {})[:20] + ["ohio-state"]:
            out["injured"].append(copy.deepcopy({"state": {"injuries": state.get("injuries"), "redshirting": state2.get("redshirting")}, "slug": slug, "result": [list(x) for x in season._injured({"injuries": state.get("injuries"), "redshirting": state2.get("redshirting")}, slug)]}))
        out["misc"]["my_game_id"] = {"games": [[eid, {k: g[k] for k in ("week", "played", "home", "away")}] for eid, g in state["games"].items()], "team": state["team"], "current_week": 5, "result": [season.my_game_id(state), season.my_game_id(state, 9), season.my_game_id(state, 30)]}
    season.advance(state, report=lambda s, a, b: stages.append([state["current_week"], s]) if a is None else None)
out["stages"] = stages
out["final"] = {"champion": state["champion"], "playoff": state["playoff"], "phase": state["phase"]}
json.dump({s: {"team_ratings": x.get("team_ratings"), "name": x["name"]} for s, x in teams.items()}, open(os.path.join(sys.argv[1], "tr.json"), "w"))
json.dump(out, open(os.path.join(sys.argv[1], "ref.json"), "w"))
print("done", len(out["run_games"]), len(out["week_seeds"]), len(out["ccg"]), len(out["playoff"]), len(out["bowls"]), state["champion"])
