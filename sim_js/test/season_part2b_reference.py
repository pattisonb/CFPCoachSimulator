# Python's answers for sim_js/season/part2.js, held with the other parts stubbed (season_part2b_compare.mjs reads them):
#   python3 sim_js/test/season_part2b_reference.py OUTDIR   then   node sim_js/test/season_part2b_compare.mjs OUTDIR
import copy, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
os.environ["SIM_WORKERS"] = "1"
here = sys.argv[1]
os.environ["CFP_SEASONS_DIR"] = os.path.join(here, "seasons")
from sim import season
state = season.new_season("ohio-state", seed=3)
season.advance(state); season.advance(state)
keys = ("injuries", "morale", "redshirting", "depth", "position_changes", "current_week", "team", "career", "done", "league")
def slim(st):
    d = {k: copy.deepcopy(st[k]) for k in keys if k in st}
    d["season_stats"] = {"ohio-state": copy.deepcopy(st["season_stats"]["ohio-state"])}
    return d
t = season.team_data(state, "ohio-state")
cases = []
picks = [(p, to) for p in t["offense"] + t["defense"] for to in (("CB", "WR", "P") if p["position"] in ("WR", "CB", "K") else ()) ][:40:3]
for p, to in picks:
    st = copy.deepcopy(state)
    key = f"{p['name']}|{p['position']}"
    st.setdefault("injuries", {}).setdefault("ohio-state", {})[key] = {"name": p["name"], "position": p["position"], "type": "x", "weeks": 2, "weeks_left": 2, "since_week": 1, "event_id": "e"}
    st.setdefault("redshirting", {}).setdefault("ohio-state", {})[p["slug"]] = {"name": p["name"], "position": p["position"], "week": 1}
    st.setdefault("depth", {}).setdefault("ohio-state", {}).update({p.get("role") or "WR": [p["slug"]], to: [p["slug"], "zz"], "KR": [p["slug"]]})
    rec = {"before": slim(st), "slug": p["slug"], "to": to, "p": copy.deepcopy(season._roster_player(st, "ohio-state", p["slug"])),
           "options": None}
    try:
        rec["options"] = season.position_options(st, "ohio-state", p["slug"])
        rec["skills"] = season._skills(p)
    except Exception as e:
        rec["options_error"] = repr(e)
    try:
        rec["result"] = season.change_position(st, "ohio-state", p["slug"], to)
        q = season._roster_player(st, "ohio-state", p["slug"])
        rec["q"] = copy.deepcopy(q); rec["q_overall"] = season.page_overall(q)
        rec["toggle"] = season.redshirt_toggle(st, "ohio-state", p["slug"], False)
    except season.PositionError as e:
        rec["error"] = [e.code, str(e)]
    rec["after"] = slim(st)
    cases.append(rec)
from coach_career import league as lg
json.dump({"cases": cases, "GROUP_OF": lg.GROUP_OF}, open(os.path.join(here, "ref2.json"), "w"))
print(len(cases), sum("error" in c for c in cases), sum(c["options"] is not None for c in cases))
