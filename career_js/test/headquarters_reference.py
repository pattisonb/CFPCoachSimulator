"""Python's answers for career_js/headquarters.js: python3 career_js/test/headquarters_reference.py OUTDIR, then
node career_js/test/headquarters_compare.mjs OUTDIR.

Three real careers: one before its first game, one three played weeks in with a board worked by hand (messages,
calls, scouting trips, offers, promises), and one in the transfer portal's second week (the offseason's real
steps). On each, a script of calls (written to the case file, so the compare script runs the very same ones):
every read, layouts and plans good and bad, tasks of every kind an older save or a newer page could hold.

The modules Headquarters asks that are not in JavaScript yet (recruiting, offseason, prospects' class functions,
promises, programs) are recorded call by call and replayed by the compare script; the season is the JavaScript
season there (its depth_roster_view is recorded too, for a host where it cannot run yet)."""
import inspect
import json
import random
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from coach_career import headquarters, offseason, programs, promises, prospects, recruiting    # noqa: E402
from sim import season                                                                             # noqa: E402

OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)


# ----- recording the modules that are not ported ----------------------------------------------------------------
class Rec:
    calls = None
    depth = 0
    state = None


def norm(a):
    """An argument as the compare script can check it: the state by a mark, a recruit by his id, the rest as it is."""
    if a is Rec.state:
        return "<state>"
    if isinstance(a, dict) and "id" in a and "composite" in a:
        return {"id": a["id"]}
    return json.loads(json.dumps(a))


def wrap(mod, name, trim=None):
    orig = getattr(mod, name)
    sig = inspect.signature(orig)

    def f(*a, **kw):
        if Rec.calls is None or Rec.depth:
            return orig(*a, **kw)
        args = [norm(x) for x in sig.bind(*a, **kw).arguments.values()]
        Rec.depth += 1
        try:
            out = orig(*a, **kw)
        finally:
            Rec.depth -= 1
        Rec.calls.append([f"{mod.__name__.split('.')[-1]}.{name}", args, json.loads(json.dumps(trim(out) if trim else out))])
        return out
    setattr(mod, name, f)


for fn in ("latest_report", "spot_of_player", "spot_of", "needs_by_spot", "money_owed", "open_spots", "spot_matches", "cooled"):
    wrap(recruiting, fn)
wrap(offseason, "player_next")
wrap(prospects, "class_rc", lambda rc: "recruiting" if rc is Rec.state["recruiting"] else "recruiting_last")    # which block, not the block
for fn in ("class_table", "class_points", "class_rank"):
    wrap(prospects, fn)
wrap(promises, "chips_now")
wrap(programs, "rows", lambda rows: [{"team": r["team"], "tier": r.get("tier")} for r in rows])
wrap(season, "depth_roster_view")


# ----- real careers ----------------------------------------------------------------------------------------------
def work_the_board(st: dict, week: int) -> None:
    """A week of recruiting by hand: recruits onto the board, then messages, calls, scouting trips, offers (one with
    the starting job promised), NIL raised, an offer pulled; whatever the game refuses that week is skipped."""
    me, rc = st["team"], st["recruiting"]
    rc["hours"][me] = 500
    rng = random.Random(f"hq-{week}")
    free = [q for q in recruiting.prospect_list(st) if not rc["prospects"][q].get("hidden") and not rc["status"][q]["committed"]
            and q not in rc["board"]]
    for pid in rng.sample(free[:400], 8) + free[:2]:
        if pid not in rc["board"]:
            rc["board"].append(pid)
    for i, pid in enumerate(list(rc["board"])):
        p = rc["prospects"][pid]
        tries = [("message", {"pitch": p["priorities"][0]}), ("call", {"answer": "quick"}), ("scout", {}),
                 ("offer", {"nil": recruiting.ask_from(st, me, pid, peek=True) or 0} if i % 3 else {"answer": "promise", "nil": 0}),
                 ("raise_nil", {"nil": (recruiting.ask_from(st, me, pid, peek=True) or 0) + 10}), ("hc_visit", {"answer": "quick"})]
        for j, (action, kw) in enumerate(tries):
            if (i + j + week) % 2 and action != "offer":
                continue
            try:
                recruiting.act(st, me, pid, action, **kw)
            except Exception as e:                       # refused this week (no energy, too early, already done): on to the next
                if not isinstance(e, (recruiting.RecruitingError, KeyError, TypeError)):
                    raise
    if week >= 2 and rc["offers"].get(me):
        try:
            recruiting.act(st, me, rc["offers"][me][0], "pull_offer")
        except recruiting.RecruitingError:
            pass


def promise_money(st: dict) -> None:
    """A money promise to a recruit on your board (tests/test_headquarters.py's), and the same promise twice to another."""
    me, rc = st["team"], st["recruiting"]
    pids = [q for q in rc["board"] if not rc["status"][q]["committed"]][:3]
    for k, pid in enumerate(pids):
        made = recruiting._contact(st, me, pid).setdefault("promises", [])
        made.append({"kind": "money", "about": {"ask": 60 + 20 * k}, "week": st["current_week"], "broken": None, "kept": None})
        if k == 1:
            made.append({"kind": "recruit", "about": {"name": "Somebody Else"}, "week": st["current_week"] - 1})
            made.append({"kind": "recruit", "about": {"name": "Somebody Else"}, "week": st["current_week"]})
            made.append({"kind": "package", "about": {}, "week": 1, "kept": True})
            made.append({"kind": "roster", "about": {"name": "The Starter"}, "week": 2, "broken": True})
            made.append({"kind": "roster", "about": {"name": "The Starter"}, "week": 2, "closed": 3})
            made.append({"kind": "visit", "about": {}, "week": 2})
    roster = (((st.get("league") or {}).get("teams") or {}).get(me) or {}).get("roster") or []
    for k, c in enumerate(roster[:6]):                    # (a career in its first season has no league roster yet)
        c["promised"] = season.season_year(st) + (k % 3) - 1


def commits(st: dict) -> None:
    """Your board decides (three weeks of the real game bring a school no commitment, so these are written in as the
    game writes them): five commit to you, one of them a flip, one backs out; one each goes to another school, to an
    FCS program and to pro baseball."""
    me, rc = st["team"], st["recruiting"]
    free = [q for q in rc["board"] if not rc["status"][q]["committed"] and not rc["status"][q].get("signed")]
    week = st["current_week"]

    def note(kind, pid, back):
        e = {"kind": kind, "pid": pid, "school": me, "week": max(0, week - back)}
        if rc.get("portal"):
            e["portal_week"] = max(1, rc["week"] - back % 2)
        rc["log"].append(e)
    for k, pid in enumerate(free[:5]):
        rc["status"][pid]["committed"] = me
        note("flip" if k == 1 else "commit", pid, k % 3)
    if len(free) > 4:
        rc["status"][free[4]]["committed"] = None
        note("decommit", free[4], 0)
    for pid, change in zip(free[5:8], ({"committed": "michigan"}, {"signed": "FCS", "fcs": True}, {"committed": "texas", "pro": True})):
        rc["status"][pid].update(change)


NO_STATE = ("_word",)        # the functions that do not take the state


def finished(st: dict) -> None:
    """tests/test_offseason.py's: every game played, every school's class signed, season over."""
    rng = random.Random(1)
    teams = season.load_teams()
    for g in st["games"].values():
        h, a = teams[g["home"]]["team_ratings"]["overall"], teams[g["away"]]["team_ratings"]["overall"]
        hs = rng.randint(10, 45)
        win = rng.random() < 1 / (1 + 10 ** ((a - h) / 12))
        g.update(played=True, home_score=hs if win else max(0, hs - rng.randint(1, 20)), away_score=hs - rng.randint(1, 20) if win else hs)
        if g["home_score"] == g["away_score"]:
            g["home_score"] += 3
    rc = st["recruiting"]
    schools = [s for s, t in teams.items() if not t["fictional"]]
    pids = sorted(rc["prospects"], key=lambda p: rc["prospects"][p]["rank"])
    for i, pid in enumerate(pids[:len(schools) * 21]):
        rc["status"][pid]["signed"] = schools[i % len(schools)]
    st.update(done=True, current_week=season.FINAL_WEEK, champion="ohio-state")


# ----- the script: the same calls for both languages ------------------------------------------------------------
def card(i, widget="top-targets", size="M", **more):
    return {"id": f"c{i}", "widget": widget, "size": size, **more}


def script(st: dict) -> list:
    """[function, arguments after the state] ("put" changes the state at a path of keys)."""
    me, rc = st["team"], st["recruiting"]
    crc = prospects.class_rc(st)
    log = [e for e in rc.get("log") or [] if e.get("school") == me and e.get("pid")]
    week, pweek = headquarters._clock(st)
    by_kind = {}
    for e in log:
        by_kind.setdefault((e["kind"], e.get("action")), e["pid"])
    pick = lambda *keys: next((by_kind[k] for k in keys if k in by_kind), None)
    board = list(rc.get("board") or [])
    offered = list(rc["offers"].get(me, []))
    gone = [q for q, s in rc["status"].items() if (s.get("signed") or s.get("committed")) not in (None, me)]
    fcs = [q for q, s in rc["status"].items() if "FCS" in (s.get("signed"), s.get("committed"))]
    pro = [q for q, s in rc["status"].items() if s.get("pro")]
    mine = [q for q, s in crc["status"].items() if (s["signed"] or s["committed"]) == me]
    others = [q for q, s in crc["status"].items() if not (s["signed"] or s["committed"])]
    reads = [["layout"], ["commits_by_week"], ["movers"], ["last_contacts"], ["outlook"], ["next_year"], ["promises_tracker"],
             ["goals"], ["tasks"], ["_clock"], ["_tier"], ["_committed_now", me]]
    steps = list(reads)
    steps += [["_word", c] for c in (0.0, 0.069, 0.07, 0.1, 0.15, 0.4)]
    for pid in mine[:3] + others[:6] + others[400::300] + board[:4] + gone[:2] + ["no-such-recruit", ""]:
        steps.append(["what_if", pid])
    # layouts: good ones, then each way to be wrong
    steps += [["set_layout", [card(1), card(2, "class-needs", "S"), card(3, "program-compare", "L")]],
              ["set_layout", [card(1, h=640), card(2, "flags", "S", h=120), card(9, "future-thing", "L", h=1600), card(4, h=None)]],
              ["set_layout", [card(i) for i in range(40)]], ["set_layout", []],
              ["set_layout", [card(1, size="XL")]], ["set_layout", [{"id": "Bad Id", "widget": "top-targets", "size": "M"}]],
              ["set_layout", [{"id": "c1", "widget": "", "size": "M"}]], ["set_layout", [card(i) for i in range(41)]],
              ["set_layout", [card(1), card(1, "flags")]], ["set_layout", "top-targets"], ["set_layout", None], ["set_layout", {"cards": []}],
              ["set_layout", [["c1", "top-targets", "M"]]], ["set_layout", [None]], ["set_layout", [card(1, h=40)]],
              ["set_layout", [card(1, h=5000)]], ["set_layout", [card(1, h="tall")]], ["set_layout", [card(1, h=True)]],
              ["set_layout", [card(1, h=300.5)]], ["set_layout", [{"id": 7, "widget": "flags", "size": "M"}]],
              ["set_layout", [{"id": "c1\n", "widget": "flags", "size": "M"}]], ["set_layout", [{"id": "c1\n\n", "widget": "flags", "size": "M"}]],
              ["set_layout", [{"id": "c" * 41, "widget": "flags", "size": "M"}]], ["set_layout", [{"id": "c1", "widget": "flags"}]],
              ["set_layout", [{"id": "c1", "widget": "flags", "size": 1}]], ["set_layout", [card(1, extra="dropped")]],
              ["set_layout", [card(1, "flags", "S"), card(2, "top-targets", "L", h=400)]], ["layout"]]
    # plans: plain tasks and goals, then each way to be wrong
    plain = [{"id": "t1", "text": "  Call the top corner.  ", "done": False}, {"id": "t2", "text": "Book a visit.", "done": True, "auto": True},
             {"id": "t3", "text": "x" * 120, "done": False, "auto": True, "manual": True, "note": "kept only for a suggestion"}]
    steps += [["set_plan", {"tasks": plain}], ["set_plan", {"goals": {"commits": 22}}], ["set_plan", {"goals": {"rank": 1, "top100": 200}}],
              ["set_plan", {}], ["goals"]]
    for body in ({"tasks": [{"id": "t1", "text": "", "done": False}]}, {"tasks": [{"id": "t1", "text": " \t \n", "done": False}]},
                 {"tasks": [{"id": "T 1", "text": "x", "done": False}]}, {"tasks": [{"id": "t1", "text": "x" * 121, "done": False}]},
                 {"tasks": [{"id": "t1", "text": "\U0001F3C8" * 120, "done": False}]}, {"tasks": [{"id": "t1", "text": "\U0001F3C8" * 121, "done": False}]},
                 {"tasks": [{"id": "t1", "text": "x", "done": "no"}]}, {"tasks": [{"id": "t1", "text": "x", "done": 1}]},
                 {"tasks": [{"id": f"t{i}", "text": "x", "done": False} for i in range(61)]},
                 {"tasks": [{"id": "t1", "text": "x", "done": False}, {"id": "t1", "text": "y", "done": False}]},
                 {"tasks": "all"}, {"tasks": ["t1"]}, {"tasks": [{"id": "t1", "text": 5, "done": False}]},
                 {"tasks": [{"id": "t1", "text": "x", "done": False, "note": "n" * 121}]},
                 {"tasks": [{"id": "t1", "text": "x", "done": False, "do": "call"}]},
                 {"tasks": [{"id": "t1", "text": "x", "done": False, "do": {"kind": "dance", "pid": "a"}}]},
                 {"tasks": [{"id": "t1", "text": "x", "done": False, "do": {"kind": "need"}}]},
                 {"tasks": [{"id": "t1", "text": "x", "done": False, "do": {"kind": "need", "group": "g" * 21}}]},
                 {"tasks": [{"id": "t1", "text": "x", "done": False, "do": {"kind": "call"}}]},
                 {"tasks": [{"id": "t1", "text": "x", "done": False, "do": {"kind": "call", "pid": ""}}]},
                 {"tasks": [{"id": "t1", "text": "x", "done": False, "do": {"kind": "call", "pid": "p" * 81}}]},
                 {"tasks": [{"id": "t1", "text": "x", "done": False, "do": {"kind": "nil", "pid": "a", "nil": 1001}}]},
                 {"tasks": [{"id": "t1", "text": "x", "done": False, "do": {"kind": "nil", "pid": "a", "nil": -5}}]},
                 {"tasks": [{"id": "t1", "text": "x", "done": False, "do": {"kind": "nil", "pid": "a", "nil": True}}]},
                 {"tasks": [{"id": "t1", "text": "x", "done": False, "do": {"kind": "nil", "pid": "a", "nil": "50"}}]},
                 {"tasks": [{"id": "t1", "text": "x", "done": False, "do": {"kind": "call", "pid": "a"}, "since": "3"}]},
                 {"tasks": [{"id": "t1", "text": "x", "done": False, "do": {"kind": "call", "pid": "a"}, "since": False}]},
                 {"goals": {"commits": 0}}, {"goals": {"rank": 500}}, {"goals": {"wins": 9}}, {"goals": "all"}, {"goals": {"rank": True}},
                 {"goals": {"rank": "9"}}, {"tasks": plain, "goals": {"rank": 201}}, "plan", None, [1]):
        steps.append(["set_plan", body])
    steps += [["tasks"], ["goals"]]
    # suggested tasks, as the page adds them (the server stamps when), one of every kind
    asks = [("call", pick(("contact", "call"), ("contact", "hc_visit"))), ("call", pick(("contact", "message"), ("offer", None))),
            ("scout", pick(("contact", "scout"))), ("scout", pick(("contact", "call"))), ("raise", pick(("offer", None), ("raise_nil", None))),
            ("raise", board[-1] if board else None), ("wait", board[0] if board else None), ("leave", board[1] if len(board) > 1 else None),
            ("leave", pick(("contact", "scout"))), ("pull", offered[0] if offered else None), ("pull", board[-2] if len(board) > 1 else None),
            ("nil", offered[-1] if offered else None), ("call", gone[0] if gone else None), ("wait", fcs[0] if fcs else None),
            ("raise", pro[0] if pro else None), ("call", "no-such-recruit")]
    suggested = []
    for i, (kind, pid) in enumerate(asks):
        if pid is None:
            continue
        do = {"kind": kind, "pid": pid, **({"nil": 0 if i % 2 else 900} if kind == "nil" else {}), "ignored": 1}
        suggested.append({"id": f"s{i}", "text": f"{kind} him", "done": False, "do": do, "since": 2})
    spots = sorted({recruiting.spot_of(rc["prospects"][q]) for q in board if q in rc["prospects"]})
    for i, g in enumerate(spots[:2] + ["XX", "QB"]):
        suggested.append({"id": f"n{i}", "text": f"Find a {g}", "done": False, "do": {"kind": "need", "group": g}})
    steps += [["set_plan", {"tasks": plain + suggested}], ["tasks"], ["set_plan", {"tasks": suggested + plain}]]
    # the same tasks as an older save holds them: added in week 0 (so everything since counts), with and without the log's length
    old = []
    for i, t in enumerate(suggested):
        for j, stamp in enumerate(({"since": 0, "since_p": 0}, {"since": 0, "since_p": 0, "since_n": 0}, {"since": week, "since_p": pweek, "since_n": len(rc.get("log") or [])},
                                   {"since_n": 10 ** 6, "since": max(0, week - 1)}, {"since_n": True})):
            old.append({**t, "id": f"{t['id']}-{j}", "do": {k: v for k, v in t["do"].items() if k != "ignored"}, **stamp,
                        **({"note": "No longer needed: he signed with Nobody."} if i % 2 else {}), **({"manual": True} if (i + j) % 7 == 6 else {})})
    steps += [["put", ["career", "headquarters", "tasks"], old], ["tasks"], ["tasks"],
              ["set_plan", {"tasks": [{**t, "done": False, "text": t["text"] + "."} for t in old[:60]]}], ["tasks"]]
    steps += [["put", ["career", "headquarters"], "__del__"], ["layout"], ["tasks"], ["goals"], ["put", ["career"], {}], ["layout"]]
    return steps


def put(st: dict, path: list, value) -> None:
    d = st
    for k in path[:-1]:
        d = d[k]
    if value == "__del__":
        d.pop(path[-1], None)
    else:
        d[path[-1]] = json.loads(json.dumps(value))


def cases(name: str, st: dict) -> None:
    text = json.dumps(st)
    path = Path(str(season._league_path))
    league_file = None
    if path.resolve() != Path(str(season.TEAMS_FILE)).resolve():
        league_file = f"{name}_league.json"
        shutil.copyfile(path, OUT / league_file)
    (OUT / f"{name}_state.json").write_text(text)
    st = json.loads(text)                                # as a save comes back
    steps = json.loads(json.dumps(script(st)))
    Rec.state, Rec.calls = st, []
    answers = []
    for fn, *args in steps:
        if fn == "put":
            put(st, *args)
            answers.append(None)
            continue
        try:
            got = getattr(headquarters, fn)(*args) if fn in NO_STATE else getattr(headquarters, fn)(st, *args)
            answers.append({"value": json.loads(json.dumps(got))})
        except headquarters.LayoutError as e:
            answers.append({"error": e.message})
        except Exception as e:                           # anything else is Python falling over (a missing key): the port need not match it
            answers.append({"crash": f"{type(e).__name__}: {e}"})
    (OUT / f"{name}_case.json").write_text(json.dumps({
        "league_file": league_file, "steps": steps, "answers": answers, "calls": Rec.calls,
        "after": st["career"].get("headquarters")}))
    Rec.calls = None
    kinds = {}
    for (fn, *_), a in zip(steps, answers):
        k = (fn, "value" if a and "value" in a else "error" if a and "error" in a else "crash" if a else "put")
        kinds[k] = kinds.get(k, 0) + 1
    print(name, len(steps), "steps;", ", ".join(f"{fn} {how} {n}" for (fn, how), n in sorted(kinds.items())), flush=True)
    rc = st["recruiting"]
    log = [e for e in rc.get("log") or [] if e.get("school") == st["team"]]
    seen = {}
    for e in log:
        seen[(e["kind"], e.get("action"))] = seen.get((e["kind"], e.get("action")), 0) + 1
    print("   your log:", seen, "board", len(rc.get("board") or []), "offers", len(rc["offers"].get(st["team"], [])), flush=True)


if __name__ == "__main__":
    season.SEASONS_DIR = Path(tempfile.mkdtemp(prefix="cfp-hq-ref-"))
    names = []
    st = season.new_season("ohio-state", "full", seed=11, career=True)
    cases("fresh", st)
    names.append("fresh")
    for week in range(0, 3):
        work_the_board(st, week)
        season.advance_to(st, week + 1)
    work_the_board(st, 3)
    promise_money(st)
    commits(st)
    cases("week3", st)
    names.append("week3")
    st = season.new_season("toledo", "full", seed=12, career=True)
    finished(st)
    off = offseason.start(st)
    while off["stage"] != "portal_w1":
        offseason.advance(st)
    for w in (1, 2):
        rc, me = st["recruiting"], st["team"]
        picks = [q for q in sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"]) if rc["prospects"][q]["from"] != me
                 and not rc["status"][q]["signed"] and not rc["status"][q]["committed"]][:6]
        for i, pid in enumerate(picks):
            if pid not in rc["board"]:
                rc["board"].append(pid)
            try:
                recruiting.act(st, me, pid, "offer", pitch=rc["prospects"][pid]["priorities"][0], nil=recruiting.ask_from(st, me, pid))
                if i % 2:
                    recruiting.act(st, me, pid, "official_visit")
            except recruiting.RecruitingError:
                pass
        if w == 1:
            offseason.advance(st)
    promise_money(st)
    commits(st)
    cases("portal", st)
    names.append("portal")
    from coach_career import clear, league
    (OUT / "setup.json").write_text(json.dumps({
        "careers": names, "NO_STATE": list(NO_STATE), "clear": clear.on(), "OFFENSE_ROLES": sorted(league.OFFENSE_ROLES), "TEAM_FIT": league.TEAM_FIT, "GROUP_OF": league.GROUP_OF,
        "CONTACT_KINDS": list(recruiting.CONTACT_KINDS), "PORTAL_BASE": offseason.PORTAL_BASE, "PORTAL_USAGE": offseason.PORTAL_USAGE,
        "PORTAL_LOSING": offseason.PORTAL_LOSING, "UNDERCLASS_ELIGIBLE": sorted(offseason.UNDERCLASS_ELIGIBLE), "GROUP": offseason.GROUP,
        "NEXT_CLASS": offseason.NEXT_CLASS}))
    print("wrote", OUT)
