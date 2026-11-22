"""A whole Coach Career played through the API by the Python (app/api.py, every module real), for career_compare.mjs,
which plays the same career through the JavaScript API (app_js/api.js) and holds it to this one step by step.

    PYTHONHASHSEED=0 python3 app_js/test/career_reference.py OUTDIR [scenario ...]     (scenarios: see SCENARIOS)
    node app_js/test/career_compare.mjs OUTDIR [scenario ...]

For each scenario OUTDIR/<name>/ gets, for every step of the run (the start, every week, every offseason stage, the
weeks of year two): NNN.notes.json (every API call made in the step: the request and its answer or refusal),
NNN.state.json (the career read back from its own save with season.load_season) and, where the step wrote one, the
league file of the new season. The script itself is written twice (here and in career_compare.mjs), call for call: a
request that differs shows as a difference too. Outputs are large (about 1 GB a scenario): keep OUTDIR out of the repo.

Python's own hash order decides a few exact ties (sets of strings walked in recruiting, the carousel, the portal), so
this runs under PYTHONHASHSEED=0 (it restarts itself with it when it is not set)."""
import json
import os
import sys
import tempfile
import time
from pathlib import Path

if os.environ.get("PYTHONHASHSEED") != "0":
    os.environ["PYTHONHASHSEED"] = "0"
    os.execv(sys.executable, [sys.executable] + sys.argv)

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

# name: team, seed, Clear Mode, Auto-recruit ("off", "season"), the script's own recruiting moves, weeks of year two
SCENARIOS = {
    "blue": {"team": "ohio-state", "seed": 11, "clear": True, "auto": "off", "manual": True, "year2": 4},
    "g5": {"team": "toledo", "seed": 23, "clear": False, "auto": "season", "manual": False, "year2": 4},
    "word": {"team": "smu", "seed": 5, "clear": False, "auto": "off", "manual": True, "year2": 0, "weeks": 6},
}


def main(out: Path, name: str) -> None:
    cfg = SCENARIOS[name]
    os.environ["CFP_SEASONS_DIR"] = tempfile.mkdtemp(prefix="seasons-")
    os.environ["CFP_CLEAR"] = "1" if cfg["clear"] else "0"
    os.environ.setdefault("SIM_WORKERS", "1")     # the games in this process (through the one Node child)

    from canon import canon
    from app import api
    from coach_career import league
    from sim import season

    league.CACHE_DIR = Path(tempfile.mkdtemp(prefix="leagues-"))     # a later season's league file: not in the repo's data/
    out = out / name
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*.json"):
        old.unlink()

    run = {"sid": None, "notes": [], "step": 0, "times": []}

    def call(method, path, body=None):
        """One API call, noted with its request: the answer, or the refusal it got."""
        try:
            res = {"ok": api.call(method, path.replace("{sid}", run["sid"] or ""), body)}
        except api.ApiError as e:
            res = {"api_error": [e.status, e.message]}
        except Exception as e:  # noqa: BLE001 - what the API does not catch (the page gets a 500): the same error on both sides
            res = {"error": type(e).__name__, "message": getattr(e, "message", None) or str(e)}
        if isinstance(res.get("ok"), (bytes, bytearray)):
            res = {"ok": f"<{len(res['ok']) > 0} bytes>"}
        res = json.loads(json.dumps(canon(res)))      # as it is now: a later call may change what the answer holds
        run["notes"].append({"req": [method, path, body], "res": res})
        return res.get("ok")

    def G(path):
        return call("GET", "/api/season/{sid}/" + path)

    def R(path, body):
        return call("POST", "/api/season/{sid}/" + path, body)

    def note(what, value):
        run["notes"].append({"what": what, "value": json.loads(json.dumps(canon(value)))})

    def end_step(what, seconds=None):
        """The step is over: its calls, the career as its save holds it, and how long the sim took."""
        n = run["step"]
        state = season.load_season(run["sid"])
        text = json.dumps({"what": what, "memo": memo, "notes": run["notes"]}).replace(run["sid"], "{sid}")
        (out / f"{n:03d}.notes.json").write_text(text)
        (out / f"{n:03d}.state.json").write_text(json.dumps(canon(state)).replace(run["sid"], "{sid}"))
        lg = league.path(run["sid"], state["year"])
        if lg.exists() and run.get("league_year") != state["year"]:
            run["league_year"] = state["year"]
            (out / f"{n:03d}.league.json").write_text(lg.read_text().replace(run["sid"], "{sid}"))
        run["times"].append([n, what, seconds])
        print(f"  {n:03d} {what}" + (f": {seconds:.1f} s" if seconds is not None else ""), flush=True)
        run["notes"] = []
        run["step"] = n + 1
        if os.environ.get("CAREER_RELOAD"):       # forget the career and read it back from its save (the compare's --reload)
            api._drop(run["sid"])
            api.call("GET", f"/api/season/{run['sid']}/status")

    def play():
        """Step the running job to its end; the seconds it took."""
        t0 = time.perf_counter()
        n = 0
        while api.running():
            reports = []
            o = api.step(reports.append)
            note(f"step {n}", {"out": o, "reports": len(reports), "last": json.loads(reports[-1]) if reports else None,
                               "job": {k: v for k, v in api.job().items() if not k.startswith("_")}, "changed": api.changed()})
            n += 1
        return time.perf_counter() - t0

    def pick(xs, i):
        return xs[i] if xs and i < len(xs) else None

    # ----- the script's own recruiting week (every call is the page's; a refusal is noted like an answer) -----
    memo = {"targets": [], "fav": None, "planned": None, "offered": None}

    def scene_call(pid, action, w, pitches):
        r = R("recruit", {"pid": pid, "action": action})
        sc = (r or {}).get("scene")
        if not sc:
            return
        topics = [pitches[(w + j * 4) % len(pitches)] for j in range(3)]
        r2 = R("recruit", {"pid": pid, "action": "present", "scene": sc["id"], "topics": topics})
        sc2 = (r2 or {}).get("scene") or sc
        if sc2.get("question"):
            R("recruit", {"pid": pid, "action": "answer", "scene": sc["id"], "answer": ["straight", "promise", "deflect"][w % 3]})
        if w % 4 == 3:
            R("recruit", {"pid": pid, "action": "promise_job", "scene": sc["id"]})
        R("recruit", {"pid": pid, "action": "pitch", "scene": sc["id"], "pitch": pitches[(w * 3 + 1) % len(pitches)]})

    def recruit_week(w, portal=False):
        v = G("recruiting")
        if not v:
            return
        pitches = v["pitches"]
        hot = [r["id"] for r in (G(f"prospects?limit=12&offset={0 if portal else w * 4}&sort=interest") or {}).get("rows", [])]
        top = [r["id"] for r in (G(f"prospects?limit=6&offset={0 if portal else w * 6}&stars=4") or {}).get("rows", [])]
        if pick(hot, 10):
            R("recruit/plan", {"pid": hot[10], "action": "message", "on": True})
        if pick(hot, 11):
            R("recruit/plan", {"pid": hot[11], "action": "call_recruit", "on": True})
        if memo["planned"] and w % 3 == 2:
            R("recruit/plan", {"pid": memo["planned"], "action": "message", "on": False})
        if w % 3 == 1 and pick(hot, 10):
            R("recruit/plan", {"pid": hot[10], "action": "message", "on": False})
        memo["planned"] = pick(hot, 10)
        first = not memo["targets"] or portal and w == 1
        T = memo["targets"]
        if not first and (w == 2 or portal):
            if pick(T, 0):
                R("recruit", {"pid": T[0], "action": "official_visit"})
            if pick(T, 1) and not portal:
                R("recruit", {"pid": T[1], "action": "official_visit", "week": w + 3})
        if first:
            memo["targets"] = hot[:6]
            for i, pid in enumerate(memo["targets"]):
                R("board", {"pid": pid, "on": True})
            for i, pid in enumerate(memo["targets"][:4]):
                body = {"pid": pid, "action": "offer", "pitch": pitches[i], "nil": [0, 5, 0, 10][i]}
                if i == 0:
                    body["answer"] = "promise"
                R("recruit", body)
            if pick(memo["targets"], 4):
                R("recruit", {"pid": memo["targets"][4], "action": "message", "pitch": "prestige"})
            if pick(memo["targets"], 5):
                scene_call(memo["targets"][5], "call", w, pitches)
        else:
            for i, pid in enumerate(memo["targets"]):
                k = (w + i) % 5
                if k == 0:
                    R("recruit", {"pid": pid, "action": "message"})
                elif k == 1:
                    R("recruit", {"pid": pid, "action": "call", "answer": "quick"})
                elif k == 2:
                    R("recruit", {"pid": pid, "action": "call_recruit", "pitch": pitches[(w + i) % len(pitches)]})
                elif k == 3:
                    R("recruit", {"pid": pid, "action": "hc_visit", "pitch": pitches[(w + 2 * i) % len(pitches)]})
                else:
                    scene_call(pid, "hc_visit" if (w + i) % 2 else "call", w, pitches)
        T = memo["targets"]
        if w == 3:
            if pick(T, 1):
                R("recruit", {"pid": T[1], "action": "promise_role"})
            if pick(T, 2):
                R("recruit", {"pid": T[2], "action": "raise_nil", "nil": 10})
            if pick(T, 4):
                R("recruit", {"pid": T[4], "action": "offer"})
            if pick(T, 5):
                R("recruit", {"pid": T[5], "action": "offer", "nil": 3})
        if w == 5 and pick(T, 3):
            R("recruit", {"pid": T[3], "action": "pull_offer"})
            R("board", {"pid": T[3], "on": False})
        # this week's new faces: the board, a favorite, scouting trips, planned quick actions, an offer
        if pick(hot, 6):
            R("board", {"pid": hot[6], "on": True})
        if memo["fav"]:
            R("favorite", {"pid": memo["fav"], "on": False})
        if pick(hot, 7):
            R("favorite", {"pid": hot[7], "on": True})
            memo["fav"] = hot[7] if w % 2 else None
        for pid in (pick(hot, 8), pick(hot, 9), pick(top, 0), pick(T, w % 6), pick(T, (w + 1) % 6)):
            if pid:
                R("recruit", {"pid": pid, "action": "scout"})
        if memo["offered"] and w % 2 == 0:
            R("recruit", {"pid": memo["offered"], "action": "pull_offer"})
        if pick(top, 1):
            R("recruit", {"pid": top[1], "action": "offer", "pitch": pitches[w % len(pitches)]})
            memo["offered"] = top[1]
        if w % 4 == 1 and not portal:
            R("staff", {"staff_id": "r1", "area": list(v["areas"])[(w // 4) % len(v["areas"])]})
        if w == 1:
            R("recruit", {"pid": "r2027-99999", "action": "call"})
            R("recruit", {"pid": T[0], "action": "dance"})
            R("recruit", {"pid": T[0]})
        G("recruiting")

    # ----- the views the page reads in a week -----
    def views(w, me, light=False):
        st = G(f"status?since={max(0, w - 1)}")
        G(f"week/{w}")
        G(f"week/{w + 1}")
        G("standings")
        v = G("recruiting")
        G("recruiting/report")
        G("scouting")
        G("scouting?sort=need&limit=40&offset=20")
        G("scouting?scouted=1&sort=potential")
        G("scouting?on_board=true&sort=board")
        G(f"scouting?sort=looks&position={['QB', 'WR', 'CB', 'OT'][w % 4]}")
        page = G(f"prospects?limit=30&offset={w * 30}") or {}
        G(f"prospects?limit=20&sort=interest&status=interested&position={['QB', 'WR', 'CB', 'EDGE'][w % 4]}")
        G(f"prospects?limit=20&stars={3 + w % 3}&state={['TX', 'FL', 'OH', 'CA', 'GA'][w % 5]}")
        G("prospects?limit=20&status=committed")
        G("prospects?limit=15&commit=1&scouted=1&offers_min=1")
        ids = [r["id"] for r in page.get("rows", [])]
        board = [b["id"] for b in (v or {}).get("board", [])]
        for pid in dict.fromkeys([pick(ids, 0), pick(ids, 7), pick(board, 0), pick(board, w % 5), pick(memo["targets"], w % 6)]):
            if pid:
                G(f"prospect/{pid}")
        G("classes")
        if w % 3 == 0:
            G(f"classes?school={me}")
        G("office")
        G("headquarters?want=commits,movers,contacts,outlook,next_year,goals,tasks,promises")
        if pick(board, 0):
            G(f"headquarters?want=whatif&pid={board[0]}")
        G(f"news?since_week={max(0, w - 2)}")
        G(f"depth/{me}")
        roster = (G(f"depth/{me}/roster") or {}).get("players", [])
        for i in (w, w + 20, w + 50):
            p = pick(roster, i % max(1, len(roster)))
            if p:
                G(f"player?team={me}&slug={p['slug']}")
        G("programs")
        G(f"schedule/{me}")
        G("preview")
        G("injuries")
        G("settings")
        if light:
            return st
        G("awards")
        G("stats/leaders")
        G(f"stats/leaders?team={me}&n=3")
        G("stats/teams")
        G(f"stats/players?cat={['passing', 'rushing', 'receiving', 'defense'][w % 4]}")
        G("resume")
        G(f"resume?team={me}")
        G("rivalries")
        if w % 4 == 0:
            G("review")
        last = (st or {}).get("results") or []
        if last and last[-1].get("event_id"):
            G(f"game/{last[-1]['event_id']}")
        return st

    def weeks(me, limit, year2=False):
        """Week by week until the season is over (or `limit` weeks): the moves, the advance, the views."""
        played = 0
        while played < limit:
            st = G("status")
            if not st or api.loaded_state()["done"]:
                break
            w = st["current_week"]
            if cfg["manual"]:
                recruit_week(w)
            if not year2:
                if w == 0:
                    ed = G("schedule_edit") or {}
                    g = pick(ed.get("games"), 0)
                    if g and g.get("options"):
                        R("schedule_edit", {"event_id": g["event_id"], "slug": g["options"][0]["slug"]})
                    G("schedule_edit")
                    R("settings", {"auto_recruit": cfg["auto"]})
                    R("headquarters", {"cards": [{"id": "a1", "widget": "commits", "size": "M"}, {"id": "a2", "widget": "tasks", "size": "S"}]})
                    R("headquarters/plan", {"tasks": [{"id": "t1", "text": "Call the quarterback", "done": False}], "goals": {"commits": 20, "top100": 3, "rank": 10}})
                roster = (G(f"depth/{me}/roster") or {}).get("players", [])
                if w == 1 and roster:
                    units = (G(f"depth/{me}") or {}).get("units") or []
                    note("depth units", [[u.get("name"), len(u.get("positions") or u.get("roles") or [])] for u in units])
                    R(f"depth/{me}", {"role": "QB", "player": roster[1]["slug"], "move": "up"})
                    G(f"depth/{me}/position/QB")
                    G(f"depth/{me}/formations")
                if w == 2 and roster:
                    fr = [p for p in roster if p.get("class") == "FR"]
                    for p in fr[-2:]:
                        R("redshirt", {"team": me, "player": p["slug"], "on": True})
                    if fr:
                        R("redshirt", {"team": me, "player": fr[-1]["slug"], "on": False})
                if w == 3 and roster:
                    p = roster[len(roster) // 2]
                    opts = (G(f"position_options/{me}/{p['slug']}") or {}).get("options") or []
                    if len(opts) > 1:
                        R("position", {"team": me, "player": p["slug"], "pos": opts[1].get("pos") or opts[1].get("position")})
            t = 0.0
            if w % 5 == 4:                              # game day: your game alone, then the rest of the week
                if R("gameday", None):
                    t += play()
            two = (not cfg["manual"]) and w % 6 == 2     # a two-week run: Auto-recruit plays the second week's recruiting
            R("advance", {"to": w + 2} if two else {})
            t += play()
            played += 2 if two else 1
            views(api.loaded_state()["current_week"], me)
            end_step(f"week {api.loaded_state()['current_week']}" + (" (year two)" if year2 else ""), t)

    def offseason(me):
        """Stage by stage through the offseason, a few of the page's actions at each; into the next season."""
        for _ in range(40):
            t0 = time.perf_counter()
            v = G("offseason")
            if not v:
                break
            stage = v["stage"]
            G("recruiting")
            G(f"depth/{me}/roster")
            if v.get("job") and not v["job"].get("choice"):
                rows = v["job"].get("offers") or v["job"].get("openings") or []
                R("offseason/job", {"team": rows[0]["team"] if rows and not cfg["manual"] else None, "stage": stage})
            if stage == "retention":
                if v.get("review") and not v["review"].get("decided"):
                    opts = v["review"].get("options") or []
                    R("offseason/review", {"action": "case" if "case" in opts else pick(opts, 0), "stage": stage})
                rp = (v.get("retention") or {}).get("players") or []
                for i, e in enumerate(rp[:4]):
                    R("offseason/retain", {"pid": e["id"], "action": "meet", "stage": stage})
                if pick(rp, 0):
                    R("offseason/retain", {"pid": rp[0]["id"], "action": "promise"})
                if pick(rp, 1):
                    R("offseason/retain", {"pid": rp[1]["id"], "action": "nil", "nil": 10})
                    R("offseason/retain", {"pid": rp[1]["id"], "action": "nil", "nil": 100000})
                if pick(rp, 2):
                    R("offseason/retain", {"pid": rp[2]["id"], "action": "release"})
                R("offseason/retain", {"pid": "nobody", "action": "meet"})
            if stage == "departures":
                mine = v.get("my_roster") or []
                under = (v.get("redshirts") or {}).get("players") or []
                for p in under[:3]:
                    R("offseason/redshirt", {"pid": p["id"], "on": not p["redshirt"], "stage": stage})
                if under:
                    R("offseason/redshirt", {"pid": under[0]["id"], "on": bool(under[0]["redshirt"])})
                R("offseason/redshirt", {"pid": "nobody", "on": True})
                p = pick(mine, len(mine) // 3)
                if p:
                    opts = (G(f"offseason/position_options?pid={p['id']}") or {}).get("options") or []
                    if len(opts) > 1:
                        R("offseason/position", {"pid": p["id"], "pos": opts[1].get("pos") or opts[1].get("position"), "stage": stage})
                R("offseason/advance", {"stage": "retention"})          # a click drawn on an earlier stage: refused
            if stage.startswith("portal_w"):
                wk = int(stage[-1])
                board = (v.get("portal") or {}).get("board") or []
                note("portal board", len(board) if isinstance(board, list) else sorted(board)[:8])
                rows = (G("prospects?limit=10&sort=interest") or {}).get("rows", [])
                for r in rows[wk:wk + 2]:
                    R("offseason/portal", {"pid": r["id"], "on": True, "stage": stage})
                if wk == 2 and pick(rows, 2):
                    R("offseason/portal", {"pid": rows[2]["id"], "on": False})
                if cfg["manual"]:
                    recruit_week(wk, portal=True)
                G("scouting")
                for r in rows[:2]:
                    G(f"prospect/{r['id']}")
                G("classes")
            if stage == "staff":
                stf = v.get("staff") or {}
                cands = stf.get("candidates") or {}
                for sid_ in list(cands)[:8]:
                    R("offseason/hire", {"staff_id": sid_, "index": 1 if len(cands[sid_]) > 1 else 0, "stage": stage})
                if cfg["manual"]:
                    ys = v.get("your_staff") or []
                    if pick(ys, 1):
                        R("offseason/open_role", {"staff_id": ys[1]["id"], "stage": stage})
                        v2 = G("offseason") or {}
                        c2 = ((v2.get("staff") or {}).get("candidates") or {}).get(ys[1]["id"])
                        if c2:
                            R("offseason/hire", {"staff_id": ys[1]["id"], "index": 0, "stage": stage})
                R("offseason/hire", {"staff_id": "nobody", "index": 0})
            if stage == "conferences":
                cv = G("offseason/conferences") or {}
                confs = cv.get("conferences") or []
                if not cfg["manual"] and len(confs) > 4:
                    R("offseason/conference", {"team": confs[0]["teams"][-1]["team"], "conference": confs[4]["name"], "stage": stage})
                    R("offseason/conference", {"team": confs[6]["teams"][0]["team"], "conference": confs[1]["name"], "stage": stage})
                    R("offseason/conference", {"team": "nobody", "conference": confs[1]["name"]})
                    G("offseason/conferences")
            if stage == "schedule":
                sv = G("offseason/schedule") or {}
                g = next((x for x in sv.get("editable") or [] if x.get("options")), None)
                opt = next((o for o in g["options"] if o.get("accepts")), None) if g else None
                if opt:
                    R("offseason/schedule", {"event_id": g["event_id"], "slug": opt["slug"], "stage": stage})
                moves = (G("offseason/schedule") or {}).get("moves") or {}
                eid = next((k for k, v_ in moves.items() if v_), None)
                if eid:
                    R("offseason/schedule/move", {"event_id": eid, "week": moves[eid][-1]["week"], "stage": stage})
                R("offseason/schedule/move", {"event_id": "nothing", "week": 3})
                G("offseason/schedule")
            out = R("offseason/advance", {"stage": stage})
            G("offseason") if not (out or {}).get("next_season") else None
            G("status")
            end_step(f"offseason after {stage}", time.perf_counter() - t0)
            if (out or {}).get("next_season"):
                return True
        return False

    # ----- the run -----
    t0 = time.perf_counter()
    # the career's id is random, and two reads are seeded from it (your next game's Win Chance, the staff's
    # recommendations): both sides give this career the same id, made from the scenario's name
    import hashlib
    import uuid
    real_uuid4 = uuid.uuid4
    uuid.uuid4 = lambda: type("U", (), {"hex": hashlib.md5(name.encode()).hexdigest()})()
    s = call("POST", "/api/season", {"team": cfg["team"], "seed": cfg["seed"], "career": True})
    uuid.uuid4 = real_uuid4
    run["sid"] = s["id"]
    run["notes"][-1]["res"] = json.loads(json.dumps(run["notes"][-1]["res"]).replace(s["id"], "{sid}"))
    me = cfg["team"]
    views(0, me, light=True)
    end_step("start", time.perf_counter() - t0)
    weeks(me, cfg.get("weeks", 99))
    if cfg["year2"]:
        if offseason(me):
            me = api.loaded_state()["team"]
            memo.update(targets=[], fav=None, planned=None, offered=None)
            views(0, me, light=True)
            end_step("year two start")
            weeks(me, cfg["year2"], year2=True)
    (out / "times.json").write_text(json.dumps({"scenario": name, "cfg": cfg, "workers": os.environ.get("SIM_WORKERS"),
                                                 "steps": run["times"], "total": time.perf_counter() - t0}))
    (out / "steps.json").write_text(json.dumps(run["step"]))
    print(f"{name}: {run['step']} steps in {time.perf_counter() - t0:.0f} s")
    import shutil
    season.close_pool()
    shutil.rmtree(os.environ["CFP_SEASONS_DIR"], ignore_errors=True)       # the run's own saves and league files
    shutil.rmtree(league.CACHE_DIR, ignore_errors=True)


if __name__ == "__main__":
    names = sys.argv[2:] or list(SCENARIOS)
    for nm in names:              # Clear Mode is read when the game is imported: one process per scenario
        if len(names) == 1:
            main(Path(sys.argv[1]), nm)
        else:
            import subprocess
            subprocess.run([sys.executable, __file__, sys.argv[1], nm], check=True)
