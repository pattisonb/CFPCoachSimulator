"""Python's answers for app_js/api/part2.js (app/api.py from _champion_name to the end):
python3 app_js/test/api_part2_reference.py OUTDIR, then node app_js/test/api_part2_compare.mjs OUTDIR.

What is written:
- routes.json: every route the range registers (method, pattern, handler name) in the file's order, and every
  module-level function the range defines.
- pure.json: _champion_name on real and made-up saves.
- A scripted run of API calls through api.call, each with its answer or its refusal (status, message), in two acts
  on real saves the compare script replays from copies of the same files:
    act 1: a real career (SMU, seed 11) two weeks in: the seasons list (with unreadable and odd files beside it),
           every season view and its refusals, the settings, recruiting reads and actions, Headquarters, the roster
           and stats pages, god-mode edits, depth chart moves, the coaches;
    act 2: that career with its season faked finished, walked through the whole offseason a stage at a time (every
           offseason action asked at every stage, so most are refusals), on to the next season, then the deletes.
About two and a half minutes (the two weeks are simulated)."""
import copy
import json
import os
import random
import shutil
import sys
import tempfile
from pathlib import Path

OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)
SEASONS = Path(tempfile.mkdtemp(prefix="seasons-"))
os.environ["CFP_SEASONS_DIR"] = str(SEASONS)
os.environ["SIM_WORKERS"] = "1"                 # the weeks are simulated in this process (no pool to spawn from a script)
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app import api                                              # noqa: E402
from coach_career import league as lg, recruiting                # noqa: E402
from sim import coaches, season                                  # noqa: E402

lg.CACHE_DIR = Path(tempfile.mkdtemp(prefix="leagues-"))         # the careers' teams files: never the repo's folder
coaches.COACHES_DIR = Path(tempfile.mkdtemp(prefix="coaches-"))
FIRST_LINE = 946                                                 # the range's first line in app/api.py

# ----- the routes and names of the range ---------------------------------------------------------------------------
mine = [[m, pattern, fn.__name__] for m, pattern, fn in api.ROUTES if fn.__code__.co_firstlineno >= FIRST_LINE]
names = sorted(n for n, v in vars(api).items() if callable(v) and getattr(v, "__module__", None) == api.__name__
               and hasattr(v, "__code__") and v.__code__.co_firstlineno >= FIRST_LINE)
(OUT / "routes.json").write_text(json.dumps({"routes": mine, "names": names}))

# ----- the pure helper ---------------------------------------------------------------------------------------------
saves = [{}, {"champion": None}, {"champion": ""}, {"champion": "smu"}, {"champion": "texas", "league": None},
         {"champion": "nope"}, {"champion": "smu", "league": {}}, {"champion": "smu", "league": {"teams": None}},
         {"champion": "smu", "league": {"teams": {"smu": None}}}, {"champion": "smu", "league": {"teams": {"smu": {"meta": None}}}},
         {"champion": "new-u", "league": {"teams": {"new-u": {"meta": {"short_name": "New U", "name": "New University"}}}}},
         {"champion": "new-u", "league": {"teams": {"new-u": {"meta": {"short_name": "", "name": "New University"}}}}},
         {"champion": "new-u", "league": {"teams": {"new-u": {"meta": {"name": "New University"}}}}},
         {"champion": "new-u", "league": {"teams": {"new-u": {"meta": {}}}}},
         {"champion": "smu", "league": {"teams": {"texas": {"meta": {"short_name": "T"}}}}}]
saves += [{"champion": s} for s in list(api._all_teams())[::7]]
(OUT / "pure.json").write_text(json.dumps([{"st": st, "out": api._champion_name(st)} for st in saves]))


# ----- the scripted run --------------------------------------------------------------------------------------------
class Act:
    def __init__(self):
        self.steps = []

    def ask(self, method, path, body=None):
        """One call: its answer, or its refusal."""
        sent = copy.deepcopy(body)
        try:
            out = api.call(method, path, body)
            got = {"result": json.loads(json.dumps(out))}
        except api.ApiError as e:
            got = {"status": e.status, "message": e.message}
        except Exception as e:  # noqa: BLE001 - a handler that breaks (the page's 500): the compare script must break the same way
            got = {"crash": type(e).__name__, "message": str(e)}
        self.steps.append({"method": method, "path": path, "body": sent, **got})
        return got.get("result")


def ids(x, n=1):
    """The first ids of a list of rows or a dict keyed by id."""
    if isinstance(x, dict):
        return list(x)[:n]
    return [(r["id"] if isinstance(r, dict) else r) for r in (x or [])][:n]


# act 1: the career, two weeks in
sid = api.call("POST", "/api/season", {"team": "smu", "seed": 11})["id"]
api.call("POST", f"/api/season/{sid}/advance", {"to": 2})
while api.step() is not None:
    pass
assert api.job()["status"] == "idle" and api.job()["error"] is None, api.job()
api._drop(sid)                                   # the compare script starts from the file too
odd = {
    "aaa_not_json": "{ not json",
    "aaa_list": "[1, 2]",
    "aaa_number": "7",
    "aaa_no_week": json.dumps({"id": "aaa_no_week", "team": "smu"}),
    "aaa_real": json.dumps({"id": "aaa_real", "team": "smu", "current_week": 3, "mode": "real"}),
    "aaa_thin": json.dumps({"id": "aaa_thin", "team": "smu", "current_week": 4}),                     # a card that trips: listed plainly
    "aaa_thin2": json.dumps({"id": "aaa_thin2", "team": "texas", "current_week": 4, "team_name": "", "done": 1, "career": {"x": 1},
                             "offseason": {"stage": "portal_w1"}, "year": 2031, "mode": "full"}),
    "aaa_no_id": json.dumps({"team": "smu", "current_week": 4}),
    "aaa_whole": json.dumps({"id": "aaa_whole", "team": "new-u", "team_name": "New U", "mode": "full", "created_at": "2026-01-01T00:00:00+00:00",
                             "current_week": 20, "done": True, "champion": "new-u", "year": 2029, "career": {},
                             "league": {"teams": {"new-u": {"meta": {"short_name": "New U"}}}},
                             "games": {"1": {"played": True, "home": "new-u", "away": "smu", "home_score": 30, "away_score": 10},
                                       "2": {"played": True, "home": "smu", "away": "new-u", "home_score": 30, "away_score": 10},
                                       "3": {"played": True, "home": "smu", "away": "new-u", "home_score": 20, "away_score": 20},
                                       "4": {"played": False, "home": "smu", "away": "new-u", "home_score": None, "away_score": None},
                                       "5": {"played": True, "home": "smu", "away": "texas", "home_score": 3, "away_score": 2}}}),
}
for i, (name, text) in enumerate(odd.items()):
    f = SEASONS / f"{name}.json"
    f.write_text(text, encoding="utf-8")
    os.utime(f, (1700000000 + i * 10, 1700000000 + i * 10))
shutil.copytree(SEASONS, OUT / "act1_seasons", dirs_exist_ok=True)

a = Act()
S = f"/api/season/{sid}"
a.ask("GET", "/api/seasons")
a.ask("GET", "/api/seasons")                      # the cards from the cache
a.ask("GET", S)
st = api.loaded_state()
teams = season.load_teams()
me = st["team"]
roster = teams[me]["offense"] + teams[me]["defense"]
qbs = [p["slug"] for p in teams[me]["offense"] if p["position"] == "QB"]
wr = next(p["slug"] for p in teams[me]["offense"] if p["position"] == "WR")
fr = next((p["slug"] for p in roster if p.get("class") == "FR"), roster[-1]["slug"])
other = next(s for s, t in teams.items() if not t["fictional"] and s != me)
fcs = next(s for s, t in teams.items() if t["fictional"])
my_played = [e for e, g in st["games"].items() if g["played"] and me in (g["home"], g["away"])]
others_played = [e for e, g in st["games"].items() if g["played"] and me not in (g["home"], g["away"])]
unplayed = [e for e, g in st["games"].items() if not g["played"]]
rc = st["recruiting"]
seen = sorted(recruiting.visible(st), key=lambda pid: rc["prospects"][pid]["rank"])
hidden = [pid for pid in rc["prospects"] if pid not in set(seen)]
board = list(rc["board"])
off_board = [pid for pid in seen if pid not in set(board)]
staff = [s["id"] for s in st["career"]["staff"]]

a.ask("GET", f"{S}/teams")
a.ask("GET", "/api/season/nope")
a.ask("GET", "/api/season/nope/teams")
for w in ("0", "1", "2", "3", "15", "abc", "%202", "1.5", "+2", "-1"):
    a.ask("GET", f"{S}/week/{w}")
for slug in (me, other, "nope", fcs):
    a.ask("GET", f"{S}/schedule/{slug}")
edit = a.ask("GET", f"{S}/schedule_edit")
a.ask("POST", f"{S}/schedule_edit", {})
a.ask("POST", f"{S}/schedule_edit", {"event_id": "nope", "slug": other})
a.ask("POST", f"{S}/schedule_edit", {"event_id": unplayed[0], "slug": 5})
a.ask("POST", f"{S}/schedule_edit", {"event_id": unplayed[0], "slug": other})
for body in ({}, {"team": me}, {"team": other, "player": fr}, {"team": "nope", "player": fr}, {"team": fcs, "player": fr},
             {"team": me, "player": "nope"}, {"team": me, "player": fr}, {"team": me, "player": fr, "on": True},
             {"team": me, "player": fr, "on": False}, {"team": me, "player": fr, "on": "yes"}, {"team": me, "player": qbs[0], "on": True},
             {"team": me, "player": qbs[0], "on": False}):
    a.ask("POST", f"{S}/redshirt", body)
for path in (f"{me}/{wr}", f"{me}/{qbs[0]}", f"{me}/nope", f"{other}/{wr}", f"nope/{wr}", f"{fcs}/{wr}"):
    a.ask("GET", f"{S}/position_options/{path}")
for body in ({}, {"team": me, "player": wr}, {"team": other, "player": wr, "pos": "TE"}, {"team": me, "player": wr, "pos": "XX"},
             {"team": me, "player": wr, "pos": "WR"}, {"team": me, "player": wr, "pos": "K"}, {"team": me, "player": "nope", "pos": "TE"},
             {"team": me, "player": wr, "pos": "TE"}, {"team": me, "player": wr, "pos": "TE"}, {"team": me, "player": wr, "pos": "WR"}):
    a.ask("POST", f"{S}/position", body)
for view in ("standings", "review", "resume", "resume?week=1", f"resume?team={me}", f"resume?week=2&team={other}", "resume?week=x",
             "settings", "recruiting", "scouting", "scouting?q=a&position=QB&offset=-3&limit=10&scouted=1&sort=potential&on_board=true",
             "scouting?group=OL&offset=5&limit=7&scouted=true&sort=", "scouting?on_board=1&sort=board", "scouting?limit=x",
             "scouting?offset=1.5", "programs", "office", "headquarters",
             "headquarters?want=commits,movers,contacts,outlook,next_year,goals,tasks,promises", "headquarters?want=,commits,,nope",
             f"headquarters?want=whatif&pid={board[0] if board else seen[0]}", f"headquarters?want=whatif&pid={seen[0]}",
             "headquarters?want=whatif", "headquarters?want=whatif&pid=nope", "recruiting/report", "prospects",
             "prospects?position=QB&stars=4&state=TX&sort=-rank&limit=5&offset=2&ht_min=70&commit=open",
             "prospects?status=interested&limit=8&group=DB&interest=High&scouted=none&pot=A&wt_max=250&offers_min=1&ask_max=500",
             "prospects?q=jo&offset=-4&limit=6&sort=interest", "prospects?stars=x", "prospects?wt_min=big", "prospects?limit=",
             "classes", f"classes?school={me}", f"classes?school={other}", "classes?school=nope", f"classes?school={fcs}",
             f"prospect/{seen[0]}", f"prospect/{board[0] if board else seen[1]}", "prospect/nope",
             *([f"prospect/{hidden[0]}"] if hidden else []),
             "offseason", "offseason?position=QB", "offseason/conferences", "offseason/schedule", "offseason/position_options",
             "offseason/position_options?pid=x"):
    a.ask("GET", f"{S}/{view}")
for body in ({"god_mode": "yes"}, {"auto_recruit": 5}, {"auto_recruit": "bad"}, {"auto_recruit": "week"}, {"auto_recruit": False},
             {"auto_recruit": True}, {"auto_recruit": "off", "morale": False}, {"morale": True}, {}, None):
    a.ask("POST", f"{S}/settings", body)
pid, pid2 = off_board[0], off_board[1]
for body in ({}, {"pid": pid}, {"pid": "nope", "action": "offer"}, {"pid": pid, "action": "nope"}, {"pid": pid, "action": "offer"},
             {"pid": pid, "action": "offer"}, {"pid": pid, "action": "call"}, {"pid": pid, "action": "call", "answer": "quick"},
             {"pid": pid, "action": "promise_role"}, {"pid": pid, "action": "text", "nil": "5"}, {"pid": pid, "action": "text", "nil": 5},
             {"pid": pid2, "action": "visit", "week": 6}, {"pid": pid2, "action": "official", "week": 6}, {"pid": pid2, "action": "pitch", "pitch": "nil", "scene": "x"},
             {"pid": pid2, "action": "present", "topics": ["a"], "scene": "x"}, {"pid": pid2, "action": "answer", "answer": "x", "scene": "x"},
             *([{"pid": hidden[0], "action": "offer"}] if hidden else [])):
    a.ask("POST", f"{S}/recruit", body)
for body in ({}, {"pid": "nope", "action": "call"}, {"pid": pid2, "action": "call"}, {"pid": pid2, "action": "call", "on": False},
             {"pid": pid2, "action": "nope", "on": True}, {"pid": pid2, "action": "text", "on": True}):
    a.ask("POST", f"{S}/recruit/plan", body)
for route in ("favorite", "board"):
    for body in ({}, {"pid": "nope"}, {"pid": pid2}, {"pid": pid2, "on": True}, {"pid": pid2, "on": False}, {"pid": pid, "on": False},
                 {"pid": pid2, "on": 1}):
        a.ask("POST", f"{S}/{route}", body)
for body in ({}, {"staff_id": staff[0]}, {"staff_id": staff[0], "area": "Florida"}, {"staff_id": staff[0], "area": "Nowhere"},
             {"staff_id": "nope", "area": "Florida"}, {"staff_id": staff[-1], "area": "Texas"}):
    a.ask("POST", f"{S}/staff", body)
for body in (None, {}, {"tasks": "bad"}, {"goals": []}, {"tasks": []}, {"goals": {}}, {"tasks": [{"id": "t1", "text": "Call the QB", "done": False}]}):
    a.ask("POST", f"{S}/headquarters/plan", body)
for body in (None, {}, {"cards": "x"}, {"cards": []}, {"cards": [{"id": "a", "widget": "nope", "size": "m"}]},
             {"cards": [{"id": "a1", "widget": "news", "size": "m"}]}):
    a.ask("POST", f"{S}/headquarters", body)
a.ask("GET", f"{S}/headquarters?want=tasks,goals")
# the roster and stats pages
a.ask("POST", f"{S}/player/edit", {"team": me, "player": qbs[0], "changes": {"speed": 80}})                 # god mode is off
a.ask("POST", f"{S}/depth/{other}", {"role": "QB", "player": "x"})                                           # another team's: god mode
for path in ("preview", f"preview?team={other}", "preview?team=nope", f"preview?team={fcs}", "rivalries", f"rivalries?team={other}",
             "stats/teams", f"depth/{me}", f"depth/{other}", "depth/nope", f"depth/{fcs}", f"playlink/{me}", f"playlink/{fcs}", "playlink/nope",
             f"depth/{me}/formations", f"depth/{fcs}/formations", f"depth/{me}/roster", f"depth/{other}/roster", f"depth/{fcs}/roster",
             f"depth/{me}/position/QB", f"depth/{me}/position/KR", f"depth/{me}/position/PR", f"depth/{me}/position/XX",
             f"depth/nope/position/QB", "injuries", f"injuries?team={me}", "injuries?team=", "awards", "player", "player?team=",
             f"player?team={me}", f"player?team={me}&slug={qbs[0]}", f"player?slug={qbs[0]}", f"player?team={other}&slug={qbs[0]}",
             f"player?team={me}&slug=nope", "player?slug=nope", f"player?team=nope&slug={qbs[0]}", "player?team=nope",
             f"player?team={me}&name={roster[3]['name'].replace(' ', '+')}&position={roster[3]['position']}",
             f"player?team={me}&name=Nobody", "stats/leaders", f"stats/leaders?team={me}&n=99", "stats/leaders?n=0",
             "stats/leaders?conference=ACC", "stats/leaders?team=nope", "stats/leaders?n=x", "stats/players",
             "stats/players?cat=rushing&limit=5", f"stats/players?team={me}&cat=receiving", "stats/players?conference=SEC&cat=defense",
             "stats/players?cat=bad", "stats/players?limit=x", f"stats/players?team={fcs}",
             f"game/{my_played[0]}", f"game/{my_played[-1]}", f"game/{others_played[0]}", f"game/{unplayed[0]}", "game/nope"):
    a.ask("GET", f"{S}/{path}")
order = [r["slug"] if isinstance(r, dict) else r for r in season.depth_order(st, me, "QB")]
for body in ({}, {"role": "QB"}, {"role": "QB", "player": "nope"}, {"role": "QB", "player": qbs[-1], "move": "top"},
             {"role": "QB", "player": qbs[-1], "move": "down"}, {"role": "QB", "player": qbs[-1]}, {"order": order},
             {"role": "QB", "order": order[::-1]}, {"role": "QB", "order": order[:1]}, {"role": "KR", "player": wr},
             {"role": "QB", "order": "x"}, {"reset": True}, {"reset": "yes"}):
    a.ask("POST", f"{S}/depth/{me}", body)
a.ask("POST", f"{S}/depth/nope", {"reset": True})
a.ask("POST", f"{S}/depth/{fcs}", {"reset": True})
a.ask("POST", f"{S}/settings", {"god_mode": True})
a.ask("POST", f"{S}/depth/{other}", {"reset": True})
for body in ({}, {"team": me, "player": qbs[0], "changes": []}, {"team": me, "player": qbs[0], "changes": {"speed": 80, "class": "SR"}},
             {"team": me, "player": qbs[0], "changes": {"name": "X"}}, {"team": me, "player": qbs[0], "changes": {"speed": "fast"}},
             {"team": me, "player": "nope", "changes": {"speed": 80}}, {"team": "nope", "player": qbs[0], "changes": {"speed": 80}},
             {"team": other, "player": qbs[0], "changes": {"speed": 80}}, {"team": me, "player": qbs[0], "changes": {"class": "XX"}},
             {"team": me, "player": qbs[0], "changes": {"weight": 222, "jersey": 7, "dev_trait": "nope"}}):
    a.ask("POST", f"{S}/player/edit", body)
for body in ({}, {"team": me, "player": qbs[0], "face": "x"}, {"team": me, "player": qbs[0], "face": {"hair": 3, "skin": "a"}},
             {"team": me, "player": qbs[0]}, {"team": me, "player": "nope", "face": {"hair": 3}}, {"team": "nope", "player": qbs[0]},
             {"team": me, "player": qbs[0], "face": {"x": "y" * 20000}}):
    a.ask("POST", f"{S}/player/face", body)
for route in ("offseason/advance", "offseason/portal", "offseason/redshirt", "offseason/position", "offseason/retain", "offseason/review",
              "offseason/job", "offseason/hire", "offseason/conference", "offseason/schedule", "offseason/schedule/move", "offseason/open_role"):
    a.ask("POST", f"{S}/{route}", {"stage": "portal_w1"})
    a.ask("POST", f"{S}/{route}", {})
a.ask("GET", S)
# the coaches
a.ask("GET", "/api/coach-options")
a.ask("GET", "/api/coaches")
blank = api.call("GET", "/api/coach-options")["blank"]
for body in (None, {}, {"coach": "x"}, {"coach": dict(blank, id="abcdef000001", name="Pat Tester")}, {"coach": dict(blank, id="../up", name="Bad Id")},
             {"coach": dict(blank, id="abcdef000002", name="Sam Second")}):
    a.ask("POST", "/api/coaches", body)
for path in ("/api/coaches", "/api/coaches/abcdef000001", "/api/coaches/nope", "/api/coaches/bad%20id"):
    a.ask("GET", path)
for path in ("/api/coaches/abcdef000001", "/api/coaches/abcdef000001", "/api/coaches/bad%20id", "/api/coaches/nope"):
    a.ask("DELETE", path)
a.ask("GET", "/api/coaches")
a.ask("GET", "/api/seasons")
(OUT / "act1.json").write_text(json.dumps({"sid": sid, "steps": a.steps}))
print(f"act 1: {len(a.steps)} calls, {sum('status' in s for s in a.steps)} refused, {sum('crash' in s for s in a.steps)} broke")


# act 2: the offseason
def finished(st: dict) -> None:
    """Every game played (the better team usually wins), a playoff of twelve and each conference's champion,
    every school's class signed, season over (career_js/test/carousel_reference.py's)."""
    rng = random.Random(1)
    teams = season.load_teams()
    for g in st["games"].values():
        h, aw = teams[g["home"]]["team_ratings"]["overall"], teams[g["away"]]["team_ratings"]["overall"]
        hs = rng.randint(10, 45)
        win = rng.random() < 1 / (1 + 10 ** ((aw - h) / 12))
        g.update(played=True, home_score=hs if win else max(0, hs - rng.randint(1, 20)), away_score=hs - rng.randint(1, 20) if win else hs)
        if g["home_score"] == g["away_score"]:
            g["home_score"] += 3
    recs = season._records(st)
    fbs = [s for s, t in teams.items() if not t["fictional"]]
    best = sorted(fbs, key=lambda s: (-recs[s]["wins"], s))
    st["champions"] = {}
    for s in best:
        st["champions"].setdefault(teams[s]["conference"], s)
    field = best[:12]
    model = next(g for g in st["games"].values() if g["kind"] == "regular")
    pairs = [(field[4 + i], field[11 - i], False) for i in range(4)] + [(field[i], field[4 + i], True) for i in range(4)] \
        + [(field[0], field[1], True), (field[2], field[3], True), (field[0], field[2], True)]
    for i, (home, away, neutral) in enumerate(pairs):
        st["games"][f"99000{i:02d}"] = dict(model, home=home, away=away, kind="playoff", neutral=neutral, played=True, conference_game=False,
                                            home_score=31, away_score=17 + i, week=season.FINAL_WEEK, event_id=f"99000{i:02d}")
    rc = st.get("recruiting")
    if rc:
        pids = sorted(rc["prospects"], key=lambda p: rc["prospects"][p]["rank"])
        for i, pid in enumerate(pids[:len(fbs) * 21]):
            rc["status"][pid]["signed"] = fbs[i % len(fbs)]
    st.update(done=True, current_week=season.FINAL_WEEK, champion=field[0])


st2 = season.load_season(sid)
season.activate(st2)
finished(st2)
sid2 = "offseason0002"
st2["id"] = sid2
season.save_season(st2)
api._drop(sid)
(OUT / "act2_seasons").mkdir(exist_ok=True)
shutil.copy2(SEASONS / f"{sid2}.json", OUT / "act2_seasons" / f"{sid2}.json")

b = Act()
S = f"/api/season/{sid2}"
b.ask("GET", "/api/seasons")
b.ask("GET", f"{S}/review")
b.ask("POST", f"{S}/offseason/advance", {"stage": "departures"})          # asked before the offseason is open
view = b.ask("GET", f"{S}/offseason")
for n in range(40):
    api.call("GET", S)                           # (a call that broke dropped the season from memory: read again)
    st = api.loaded_state()
    off = st.get("offseason") if st["id"] == sid2 else None
    if not off:
        break
    stage = off["stage"]
    b.ask("GET", f"{S}/offseason?position=QB&status=open")
    b.ask("GET", f"{S}/offseason/conferences")
    b.ask("GET", f"{S}/offseason/schedule")
    b.ask("GET", f"{S}/player?slug={view['my_roster'][0]['slug'] if view.get('my_roster') and isinstance(view['my_roster'][0], dict) and view['my_roster'][0].get('slug') else 'nope'}")
    red = ids((off.get("redshirts") or {}).get("players"))
    mine_ = ids(st["league"]["teams"][st["team"]].get("roster") or [], 3) if st.get("league") else []
    leavers = ids((off.get("retention") or {}).get("players"))
    portal = ids((off.get("portal") or {}).get("players"), 2)
    options = [o["id"] if isinstance(o, dict) else o for o in ((off.get("review") or {}).get("options") or [])]
    car = off.get("carousel") or {}
    job_slugs = [(o.get("team") or o.get("slug")) if isinstance(o, dict) else o for o in ((car.get("offers") or []) + (car.get("openings") or []))]
    cands = ids((off.get("staff") or {}).get("candidates"))
    my_staff = [s["id"] for s in st["career"]["staff"]]
    games = [(e, g) for e, g in ((off.get("next_schedule") or {}).get("games") or {}).items() if st["team"] in (g["home"], g["away"])]
    nonconf = [e for e, g in games if not g.get("conference_game")]
    for pid in (red + mine_)[:2] + ["nope"]:
        b.ask("POST", f"{S}/offseason/redshirt", {"pid": pid, "on": True, "stage": stage})
        b.ask("GET", f"{S}/offseason/position_options?pid={pid}")
        b.ask("POST", f"{S}/offseason/position", {"pid": pid, "pos": "TE", "stage": stage})
    for pid in leavers + ["nope"]:
        b.ask("POST", f"{S}/offseason/retain", {"pid": pid, "action": "meet", "stage": stage})
        b.ask("POST", f"{S}/offseason/retain", {"pid": pid, "action": "nil", "nil": 20})
        b.ask("POST", f"{S}/offseason/retain", {"pid": pid, "action": "nope"})
    for pid in portal + ["nope"]:
        b.ask("POST", f"{S}/offseason/portal", {"pid": pid, "stage": stage})
    for pid in portal[:1]:
        b.ask("POST", f"{S}/offseason/portal", {"pid": pid, "on": False})
        b.ask("POST", f"{S}/offseason/portal", {"pid": pid, "on": True})
    for action in options[:1] + ["nope"]:
        b.ask("POST", f"{S}/offseason/review", {"action": action, "staff_id": my_staff[0], "stage": stage})
    b.ask("POST", f"{S}/offseason/review", {"action": options[0] if options else "case"})
    for team in job_slugs[:1] + ["nope", None]:
        b.ask("POST", f"{S}/offseason/job", {"team": team})
    for sidx in cands + ["nope"]:
        b.ask("POST", f"{S}/offseason/hire", {"staff_id": sidx, "index": 99})
        b.ask("POST", f"{S}/offseason/hire", {"staff_id": sidx, "index": 0})
    b.ask("POST", f"{S}/offseason/open_role", {"staff_id": my_staff[-1]})
    b.ask("POST", f"{S}/offseason/open_role", {"staff_id": "nope"})
    for team, conf in ((st["team"], "SEC"), (st["team"], "Nowhere"), ("nope", "SEC"), ("texas", "Big Ten")):
        b.ask("POST", f"{S}/offseason/conference", {"team": team, "conference": conf})
    for e in nonconf[:1] + ["nope"]:
        b.ask("POST", f"{S}/offseason/schedule", {"event_id": e, "slug": "texas"})
        b.ask("POST", f"{S}/offseason/schedule", {"event_id": e, "slug": "nope"})
        for week in (5, 9, 99):
            b.ask("POST", f"{S}/offseason/schedule/move", {"event_id": e, "week": week})
    b.ask("POST", f"{S}/offseason/advance", {"stage": "nope"})
    b.ask("POST", f"{S}/offseason/advance", {"stage": "departures" if stage != "departures" else "ready"})
    b.ask("GET", S)
    if stage == "ready":
        break
    view = b.ask("POST", f"{S}/offseason/advance", {"stage": stage})
    print(f"  {stage}: {len(b.steps)} calls so far")
new = b.ask("POST", f"{S}/offseason/advance", {"stage": "ready"})
b.ask("GET", S)
b.ask("GET", f"{S}/offseason")                   # the new season is not over
b.ask("GET", f"{S}/recruiting")
b.ask("GET", f"{S}/programs")
b.ask("GET", f"{S}/week/0")
b.ask("GET", "/api/seasons")
b.ask("DELETE", "/api/season/aaa_thin")
b.ask("DELETE", "/api/season/aaa_thin")
b.ask("DELETE", "/api/season/nope")
b.ask("GET", "/api/seasons")
b.ask("DELETE", "/api/seasons")
b.ask("GET", "/api/seasons")
b.ask("GET", S)
(OUT / "act2.json").write_text(json.dumps({"sid": sid2, "steps": b.steps}))
print(f"act 2: {len(b.steps)} calls, {sum('status' in s for s in b.steps)} refused, {sum('crash' in s for s in b.steps)} broke")

# act 3: straight to the next season from the first stage (to="next_season": offseason.run_all)
st3 = season.load_season(sid) if (SEASONS / f"{sid}.json").exists() else None
shutil.copytree(OUT / "act1_seasons", SEASONS, dirs_exist_ok=True)
st3 = season.load_season(sid)
season.activate(st3)
finished(st3)
sid3 = "offseason0003"
st3["id"] = sid3
season.save_season(st3)
(OUT / "act3_seasons").mkdir(exist_ok=True)
shutil.copy2(SEASONS / f"{sid3}.json", OUT / "act3_seasons" / f"{sid3}.json")
c = Act()
S = f"/api/season/{sid3}"
c.ask("POST", f"{S}/offseason/advance", {"to": 5})
c.ask("POST", f"{S}/offseason/advance", {"to": "next_season", "stage": "departures"})
c.ask("GET", S)
c.ask("GET", f"{S}/teams")
c.ask("GET", f"{S}/standings")
(OUT / "act3.json").write_text(json.dumps({"sid": sid3, "steps": c.steps}))
print(f"act 3: {len(c.steps)} calls, {sum('status' in s for s in c.steps)} refused, {sum('crash' in s for s in c.steps)} broke")
