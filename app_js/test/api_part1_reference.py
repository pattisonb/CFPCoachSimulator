"""app/api.py lines 1-945 (app_js/api/part1.js): Python's answers, for api_part1_compare.mjs.

    python3 app_js/test/api_part1_reference.py OUTDIR      then      node app_js/test/api_part1_compare.mjs OUTDIR

Writes OUTDIR/ref.json (the pure helpers on real data, the team and league-file pages, and a scripted run of API
calls: a career started, a game day, an advance with every progress report) and OUTDIR/seasons_w1 (the career's save
after its first week, which the JavaScript reads to answer the same views from the same state)."""
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)
os.environ["CFP_SEASONS_DIR"] = tempfile.mkdtemp(prefix="seasons-")
os.environ["SIM_WORKERS"] = "1"          # the games in this process (a worker process would run this script again)
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app import api                       # noqa: E402
from coach_career import league, league_file   # noqa: E402
from sim import season                    # noqa: E402

league.CACHE_DIR = Path(tempfile.mkdtemp(prefix="leagues-"))     # a league file's career writes its teams file here
ref = {}


def attempt(fn):
    """An answer, or the ApiError (or other error) it was refused with."""
    try:
        return {"ok": fn()}
    except api.ApiError as e:
        return {"api_error": [e.status, e.message]}
    except Exception as e:          # noqa: BLE001
        return {"error": type(e).__name__}


# ----- the pure helpers ----------------------------------------------------------------------------------------
texts = ["true", "TRUE", " yes ", "1", "0", "no", "False", "maybe", "", "2", "y", " 1\n", "tRuE"]
ref["boolean"] = [[t, attempt(lambda t=t: api.boolean(t))] for t in texts]

queries = [{"a": "12"}, {"a": " 7 "}, {"a": "-3"}, {"a": "+4"}, {"a": "1_000"}, {"a": "1.5"}, {"a": "x"}, {"a": ""}, {"b": "1"},
           {"a": "true"}, {"a": "no"}, {"a": "0012"}, {"a": "1__0"}, {"a": "_1"}, {"a": "0x10"}, {"a": "1e3"}]
casts = {"str": str, "int": int, "boolean": api.boolean}
ref["q"] = [[q, cast, default, attempt(lambda: api.Params(query=q).q("a", casts[cast], default))]
            for q in queries for cast in casts for default in (None, 5)]

bodies = [None, {}, {"x": "s"}, {"x": 3}, {"x": True}, {"x": False}, {"x": 0}, {"x": ""}, {"x": None}, {"x": [1]}, {"x": []},
          {"x": {"k": 1}}, {"x": {}}, {"x": 2.5}, {"x": -1}, {"y": 1}, [1, 2], "text"]
kinds = {"str": str, "int": int, "bool": bool, "list": list, "dict": dict}
ref["field"] = []
for b in bodies:
    for kind in kinds:
        for d in ("<missing>", None, "dflt", 0):
            args = () if d == "<missing>" else (d,)
            ref["field"].append([b, kind, d, attempt(lambda: api._field(api.Params(body=b), "x", kinds[kind], *args))])

patterns = sorted({pattern for _, pattern, _ in api.ROUTES})
paths = ["/api/teams", "/api/teams/smu", "/api/teams/smu/", "api/teams/texas%20a%26m", "/api/teams/..", "/api/teams/.", "/api/teams/%2E%2E",
         "/api/teams/a%2Fb", "/api/teams/a%5Cb", "/api/teams/", "/api/season/abc123/status", "/api/season/abc/week/3",
         "/api/season/abc/depth/smu", "/api/league/towns/tx", "/api/season/caf%C3%A9/news", "/api/season/%E2%82/news",
         "/api/season/%zz/news", "/api/season/100%/news", "/api/season/a+b/news", "/api/coaches/x", "/api/nothing", "/",
         "", "/api/season", "/api/seasons", "/api/season/import", "/api/season/x/export"]
ref["match"] = []
for path in paths:
    parts = path.strip("/").split("/")
    ref["match"].append([path, [[pt, api._match(pt, parts)] for pt in patterns if api._match(pt, parts) is not None]])

ref["routes_in_order"] = [[m, pt] for m, pt, _ in api.ROUTES]
ref["routes"] = sorted([m, pt] for m, pt in api.routes())

api.route("GET", "/api/_echo/{a}/x/{b}")(lambda p: {"path": p.path, "query": p.query, "body": p.body})
api.route("POST", "/api/_echo/{a}/x/{b}")(lambda p: {"path": p.path, "query": p.query, "body": p.body})
calls = [["GET", "/api/_echo/one/x/two", None], ["get", "api/_echo/one/x/two/?a=1&b=two&a=3", None],
         ["GET", "/api/_echo/o%20ne/x/t%2Bwo?q=a+b%26c&empty=&bare&=novalue&x=%E2%9C%93&y=%ff&z=1=2#frag", None],
         ["GET", "/api/_echo/1/x/2?&&a=1&", None], ["POST", "/api/_echo/1/x/2?seed=4", {"k": [1, {"z": None}]}],
         ["DELETE", "/api/_echo/1/x/2", None], ["PUT", "/api/teams", None], ["GET", "/api/_echo/1/y/2", None],
         ["GET", "/api/_echo/../x/2", None], ["GET", "/api/nothing", None], ["DELETE", "/api/teams", None],
         ["GET", "/api/teams/nope", None], ["GET", "/api/season/nosuchseason/status", None],
         ["GET", "/api/league/programs/no-such", None], ["POST", "/api/league/check", {"not": "bytes"}],
         ["POST", "/api/season/import", None], ["POST", "/api/season/import", "<bytes:notgzip>"],
         ["POST", "/api/season", {"team": "nope", "career": True}], ["POST", "/api/season", {"career": True}],
         ["POST", "/api/season", {"team": "smu", "mode": "remaining"}], ["POST", "/api/season", {"team": "smu", "seed": "eleven"}],
         ["POST", "/api/season", {"team": "smu", "coach": "000000000000"}], ["POST", "/api/season", {"team": "smu", "league": "nokey"}],
         ["POST", "/api/season", {"team": "fcs-southeast"}]]
fcs = next((s for s, t in api._all_teams().items() if t["fictional"]), None)
calls.append(["POST", "/api/season", {"team": fcs}])
calls.append(["GET", f"/api/teams/{fcs}", None])
ref["calls"] = []
for m, path, body in calls:
    b = b"not a gzip file" if body == "<bytes:notgzip>" else body
    ref["calls"].append([m, path, body, attempt(lambda: api.call(m, path, b))])

js_calls = [["GET", "/api/_echo/1/x/2?a=b", None, None], ["POST", "/api/_echo/1/x/2", '{"a": [1, 2.5, null, true]}', None],
            ["POST", "/api/_echo/1/x/2", "{not json", None], ["GET", "/api/nothing", None, None], ["DELETE", "/api/teams", None, None],
            ["GET", "/api/teams/nope", None, None], ["POST", "/api/season", '{"team": "smu", "mode": "x"}', None],
            ["POST", "/api/season", '[1, 2]', None], ["POST", "/api/season", '"text"', None]]
ref["call_js"] = [[c, json.loads(api.call_js(*c))] for c in js_calls]
api.route("GET", "/api/_nan")(lambda p: {"a": [1, {"b": float("nan")}]})
api.route("GET", "/api/_inf")(lambda p: {"a": -float("inf")})
ref["call_js_nan"] = [json.loads(api.call_js("GET", "/api/_nan", None)), json.loads(api.call_js("GET", "/api/_inf", None))]

# ----- conference names ------------------------------------------------------------------------------------------
renames = [{}, {"SEC": "SEC"}, {"SEC": "Southern League", "Big Ten": "Great Lakes Ten", "ACC": "Atlantic", "Pac-12": "Pacific 12", "Big 12": "Big 12"},
           {"American Athletic Conference": "The American", "MAC": "Mid-America", "Sun Belt": "Sun Belt East", "Mountain West": "MW (West)", "Conference USA": "C-USA"},
           {"ACC": "A.C.C. [east]", "Big 12": "Big $12", "SEC": "Big Ten", "Big Ten": "B1G"}]
states = [{"league": None}, {}] + [{"league": {"conference_names": r}} for r in renames]
ref["conference_names"] = [[s, api._conference_names(s)] for s in states]
names_back = ["Southern League", "SEC", "Great Lakes Ten", "The American", "Big 12", "", None, "B1G", "Big Ten", "nothing"]
ref["engine_conference"] = [[s, n, api._engine_conference(s, n)] for s in states for n in names_back]
teams_out = api.call("GET", "/api/teams")
samples = [teams_out["teams"][:40], {t["conference"]: t["name"] for t in teams_out["teams"]},
           ["SEC", "the SEC race", "SECOND", "non-SEC", "SEC-bound", "SEC.", "(SEC)", "SEC/ACC", "Big Tenth", "Big 12s", "Big 12's", "éSEC", "SECé",
            "ACC ACC ACC", "MACtion in the MAC", "Pac-12 and Pac-120", "_ACC", "ACC_", "9ACC", "Sun Belt\nMountain West", 5, 2.5, None, True,
            {"Big Ten": {"SEC": ["ACC", {"Big 12": "Big 12"}]}}, "American Athletic Conference title", "Conference USA's", ""]]
ref["show_conferences"] = [[r, x, api._show_conferences(x, {k: v for k, v in r.items() if k != v})] for r in renames for x in samples]

# ----- teams and the league file's pages ---------------------------------------------------------------------------
ref["list_teams"] = teams_out
slugs = sorted(api._all_teams())
ref["get_team"] = [[s, api.call("GET", f"/api/teams/{s}")] for s in slugs[::17]]
ref["fbs_cards"] = api._fbs_cards(api._all_teams())
ref["league_programs"] = api.call("GET", "/api/league/programs")
ref["league_program"] = [[s, attempt(lambda: api.call("GET", f"/api/league/programs/{s}"))] for s in slugs[::9]]
ref["league_towns"] = [[c, api.call("GET", f"/api/league/towns/{c}")] for c in ["tx", "TX", "oh", "CA", "hi", "ZZ", "dc", "ak"]]
ref["scheme"] = [[t, list(api._scheme(t))] for t in ({}, {"coaches": None}, {"coaches": {"head_coach": {}}},
                                                     {"coaches": {"head_coach": {"scheme": {"offensive_philosophy": "Air Raid"}}}})]

(OUT / "builtin_league.bin").write_bytes(league_file.builtin_bytes())
ref["league_check_builtin"] = api.call("POST", "/api/league/check?seed=7", league_file.builtin_bytes())
ref["pending_after_builtin"] = api._pending_league
custom = json.dumps({"format": "cfp-league/1", "name": "t", "year": 2026, "conferences": [], "teams": [
    {"slug": "akron", "name": "Akron Rubber", "colors": {"primary": {"name": "Gold", "hex": "#C9A227"}}}]}).encode()
(OUT / "custom_league.bin").write_bytes(custom)
ref["league_check_custom"] = api.call("POST", "/api/league/check?seed=3", custom)
pend = api._pending_league
ref["pending_after_custom"] = {"key": pend["key"], "seed": pend["seed"], "real_polls": pend["real_polls"], "games": pend["games"] is None}
bad = json.dumps({"format": "cfp-league/1", "name": "t", "year": 2026, "conferences": [], "teams": [{"slug": "akron", "prestige": "high", "nope": 1}]}).encode()
(OUT / "bad_league.bin").write_bytes(bad)
ref["league_check_bad"] = api.call("POST", "/api/league/check", bad)
ref["pending_after_bad"] = api._pending_league
ref["league_check_seed"] = attempt(lambda: api.call("POST", "/api/league/check?seed=abc", custom))

# ----- a scripted run: a career, a game day, an advance ------------------------------------------------------------
run = []


def note(what, value):
    run.append([what, json.loads(json.dumps(value))])


def job():
    return {k: v for k, v in api.job().items()}


def play(label):
    """step() until the run is over, every report kept."""
    n = 0
    while api.running():
        reports = []
        out = api.step(reports.append)
        note(f"{label} step {n}", {"out": out, "reports": [json.loads(r) for r in reports], "job": job(), "changed": api.changed()})
        n += 1
    note(f"{label} step after", api.step())


s = api.call("POST", "/api/season", {"team": "smu", "seed": 11, "career": True})
sid = s["id"]
note("create", s)
note("create changed", [api.changed(), api.changed(), api.dirty()])
note("job idle", job())
note("status", api.call("GET", f"/api/season/{sid}/status"))
note("status since", api.call("GET", f"/api/season/{sid}/status?since=0"))
note("status bad since", attempt(lambda: api.call("GET", f"/api/season/{sid}/status?since=x")))
note("pause idle", api.call("POST", f"/api/season/{sid}/pause"))
note("card record 0", api._card_record(api.loaded_state()))
note("gameday", attempt(lambda: api.call("POST", f"/api/season/{sid}/gameday")))
note("gameday job", job())
note("gameday again", attempt(lambda: api.call("POST", f"/api/season/{sid}/gameday")))
note("advance while running", attempt(lambda: api.call("POST", f"/api/season/{sid}/advance", {})))
note("create while running", attempt(lambda: api.call("POST", "/api/season", {"team": "smu"})))
play("gameday")
note("advance bad to", attempt(lambda: api.call("POST", f"/api/season/{sid}/advance", {"to": "x"})))
note("advance 1", api.call("POST", f"/api/season/{sid}/advance", {}))
note("advance job", job())
play("advance 1")
note("status since 0", api.call("GET", f"/api/season/{sid}/status?since=0"))
note("news", api.call("GET", f"/api/season/{sid}/news?since_week=0"))
note("card record 1", api._card_record(api.loaded_state()))
note("feed 1", api._feed(api.loaded_state()))

# the save after week 1, for the JavaScript to read: the views from the same state, and a scripted progress run
shutil.copytree(season.SEASONS_DIR, OUT / "seasons_w1", dirs_exist_ok=True)
ref["py_id"] = sid
state = api.loaded_state()
view = {"status": api._status(state, 0), "idle_job": api._idle_job(state), "card_record": api._card_record(state), "feed": api._feed(state),
        "news": api.call("GET", f"/api/season/{sid}/news"), "export_is_bytes": isinstance(api.call("GET", f"/api/season/{sid}/export"), bytes)}
api.call("POST", f"/api/season/{sid}/advance", {"to": 4})
script = [["Setting the matchups", None, None], ["Playing the games", 0, 61], ["Playing the games", 20, 61], ["Playing the games", 61, 61],
          ["Setting the matchups", None, None], ["Polls", None, None], [season.RECRUITING_STAGE, None, None], ["Playing the games", 3, 7],
          [season.SAVING_STAGE, None, None]]
steps = []
on = api._reporter(state, None)
for stage, gd, gt in script:
    on(stage, gd, gt)
    steps.append(json.loads(json.dumps(job())))
api._finish_week(2)
steps.append(json.loads(json.dumps(job())))
api.job()["done"] = 2
for stage, gd, gt in script[:4]:
    on(stage, gd, gt)
    steps.append(json.loads(json.dumps(job())))
view["progress_script"] = script
view["progress"] = steps
ref["view_w1"] = json.loads(json.dumps(view))
api._drop(sid)                                   # the scripted job is gone: the season is read from its save again

note("advance to 3", api.call("POST", f"/api/season/{sid}/advance", {"to": 3}))
note("pause running", api.call("POST", f"/api/season/{sid}/pause"))
play("paused advance")
note("job after pause", job())
note("advance to 3 again", api.call("POST", f"/api/season/{sid}/advance", {"to": 3}))
play("advance 3")
note("status end", api.call("GET", f"/api/season/{sid}/status?since=1"))
note("card record 3", api._card_record(api.loaded_state()))
blob = api.call("GET", f"/api/season/{sid}/export?full=true")
(OUT / "export.bin").write_bytes(blob)
note("import same", api.call("POST", "/api/season/import", blob))
note("import changed", api.changed())
ref["run"] = run

(OUT / "ref.json").write_text(json.dumps(ref), encoding="utf-8")
print(f"wrote {OUT / 'ref.json'}: {len(run)} run notes")
