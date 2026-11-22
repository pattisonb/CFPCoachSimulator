"""Python's answers for career_js/offseason/part4.js (coach_career/offseason.py from _your_jobs to the end):
python3 career_js/test/offseason_part4_reference.py OUTDIR, then node career_js/test/offseason_part4_compare.mjs OUTDIR.

Real careers (a faked finished season with a playoff, then the real offseason walked stage by stage): one through
its first offseason and, from the season next_season made, its second (taking a job offer there); one fired at the
AD's meeting (Auto takes an opening); one from a save with no recruiting (the old two-round portal). At every stage
the career is written out as it stands and then, in order, every function of the part is asked on it: the views
(view, _view, portal_away, portal_board, _portal_recap, conferences_view, schedule_view, summary, player_next for a
spread of players, ...), what the stage lets you do (portal_offer, choose_job, move_conference, schedule_trade,
schedule_move, next_season), what it refuses, and last `advance` itself.

The other parts of offseason.py and the modules the part asks that the compare script does not run for real are
recorded call by call (name, arguments, answer, in order) and replayed there: a call out of Python's order or with
other arguments fails the case."""
import copy
import inspect
import json
import random
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from coach_career import carousel, league as lg, offseason, programs, prospects, recruiting    # noqa: E402
from sim import season                                                                            # noqa: E402

OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)
lg.CACHE_DIR = Path(tempfile.mkdtemp(prefix="leagues-"))        # the careers' teams files: never the repo's folder


# ----- recording what the compare script replays -----------------------------------------------------------------
class Rec:
    calls = None
    depth = 0


def norm(a):
    """An argument as the compare script can check it: the big things by a mark, the rest as it is."""
    if isinstance(a, dict):
        if "games" in a and "team" in a:
            return "<state>"
        if "teams" in a and "attrs" in a:
            return "<league>"
        if "coaches" in a or "roster" in a:
            return "<team>"
        if "players" in a and "moves" in a:
            return "<portal>"
    if isinstance(a, random.Random):
        return "<rng>"
    if callable(a):
        return "<fn>"
    return json.loads(json.dumps(a))


def wrap(mod, name, trim=None, effect=None):
    orig = getattr(mod, name)
    sig = inspect.signature(orig)

    def f(*a, **kw):
        if Rec.calls is None or Rec.depth:
            return orig(*a, **kw)
        args = [norm(x) for x in sig.bind(*a, **kw).arguments.values()]      # before the call: it may change them
        Rec.depth += 1
        try:
            out = orig(*a, **kw)
        finally:
            Rec.depth -= 1
        call = [f"{mod.__name__.split('.')[-1]}.{name}", args, json.loads(json.dumps(trim(out) if trim else out))]
        if effect:
            call.append(json.loads(json.dumps(effect(*a, **kw))))
        Rec.calls.append(call)
        return out
    f.__wrapped__ = orig
    setattr(mod, name, f)


OTHER_PARTS = ("_retention_view", "open_spots", "churn_left", "my_spots", "playing_time", "expiring", "term_of", "_record",
               "fill_roles", "review_decide", "_resolve_retention", "_run_draft", "_apply_redshirts", "_open_portal", "_close_portal",
               "_develop_all", "_fill_rosters", "_develop_coaches", "resolve_round", "_close_portal_rounds", "_staff_changes",
               "_apply_staff", "start")
for fn in OTHER_PARTS:
    wrap(offseason, fn)
for fn in ("is_portal", "weekly_step", "portal_spots", "offer_cap", "pool_record", "lost_line", "lost_reason", "shown_range", "no_room",
           "ask_from", "use_league_models", "_baseline"):
    wrap(recruiting, fn, trim=(lambda out: None) if fn == "weekly_step" else None)
wrap(recruiting, "act", trim=lambda out: None, effect=lambda state, slug, *a, **kw: list(state["recruiting"]["offers"].get(slug, [])))
wrap(recruiting, "start", trim=lambda out: None)
for fn in ("seen_status", "_schools", "standing", "class_rank"):
    wrap(prospects, fn)
for fn in ("goal", "job_rows", "market_rows", "run"):
    wrap(carousel, fn)
for fn in ("goal_for", "attract", "z", "coach_level", "coach_ceiling", "update", "final_ranks", "nil_move"):
    wrap(programs, fn)
wrap(programs, "get", lambda p: {"tier": p["tier"], "rating": p["rating"]})
wrap(programs, "base", lambda p: {"tier": p["tier"]})


# ----- real careers ----------------------------------------------------------------------------------------------
def finished(st: dict) -> None:
    """Every game played (the better team usually wins), a playoff of twelve and each conference's champion,
    every school's class signed, season over (career_js/test/carousel_reference.py's)."""
    rng = random.Random(1)
    teams = season.load_teams()
    for g in st["games"].values():
        h, a = teams[g["home"]]["team_ratings"]["overall"], teams[g["away"]]["team_ratings"]["overall"]
        hs = rng.randint(10, 45)
        win = rng.random() < 1 / (1 + 10 ** ((a - h) / 12))
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


def snapshot(st: dict) -> dict:
    """The career as the compare script gets it: everything the part reads (not the boxes, not the class kept aside)."""
    return {k: v for k, v in st.items() if k not in ("my_boxes", "recruiting_last")}


def error_of(e: Exception) -> dict:
    return {"type": type(e).__name__, "message": e.args[0] if isinstance(e, KeyError) and e.args else str(e), "code": getattr(e, "code", None)}


class Cases:
    """One stage's cases, asked in order on the live career."""

    def __init__(self, st):
        self.st, self.rows = st, []

    def arg(self, a):
        if a is self.st:
            return "<state>"
        if a is self.st.get("offseason"):
            return {"@": ["offseason"]}
        return a

    def ask(self, fn, *args, after=None, show=None, label=None, real=None):
        """offseason.<fn>(*args): its answer (or what it raised), the calls it made, and `after` (a named reading of
        the career once it returned: compare script's AFTER table)."""
        st = self.st
        Rec.calls = []
        try:
            out = (real or getattr(offseason, fn))(*args)
            got = {"out": json.loads(json.dumps(show(out) if show else out))}
        except (ValueError, KeyError, OverflowError, offseason.ConferenceError, offseason.ReviewError, season.ScheduleError) as e:
            got = {"error": error_of(e)}
        calls, Rec.calls = Rec.calls, None
        row = {"fn": fn, "label": label or fn, "args": [self.arg(a) for a in args], "calls": calls, **got}
        if after:
            row["after"] = [after, json.loads(json.dumps(AFTER[after](st)))]
        self.rows.append(row)
        return got.get("out")


def _coach_side(st):
    off, lgd = st["offseason"], st["league"]
    slugs = [s for s in (st["team"], off.get("move_to")) if s]
    return {s: {"head_coach": lgd["teams"][s]["coaches"]["head_coach"], "style": lgd["teams"][s].get("style"),
                "security": (lgd["teams"][s].get("ad") or {}).get("security")} for s in slugs}


AFTER = {
    "draft": lambda st: {"draft": st["offseason"].get("draft"), "stage": st["offseason"].get("stage"), "departures": st["offseason"].get("departures")},
    "choice": lambda st: st["offseason"]["carousel"],
    "moves": lambda st: {"league": st["league"].get("conference_moves"), "log": st["offseason"].get("conference_moves")},
    "schedule": lambda st: {"changes": st["offseason"]["next_schedule"]["changes"],
                            "games": [[e, g["home"], g["away"], g["week"]] for e, g in st["offseason"]["next_schedule"]["games"].items()]},
    "legacy_offers": lambda st: st["offseason"]["portal"]["offers"].get(st["team"]),
    "retention": lambda st: {"stage": st["offseason"]["stage"]},
    "departures": lambda st: {"stage": st["offseason"]["stage"]},
    "portal_week": lambda st: {"stage": st["offseason"]["stage"], "week": st["recruiting"]["week"]},
    "portal_last": lambda st: {"stage": st["offseason"]["stage"]},
    "portal_round": lambda st: {"stage": st["offseason"]["stage"], "round": st["offseason"]["portal"]["round"]},
    "report": lambda st: {"stage": st["offseason"]["stage"], "report": st["offseason"]["report"]},
    "development": lambda st: {"stage": st["offseason"]["stage"], "carousel": st["offseason"]["carousel"], "staff": st["offseason"]["staff"],
                               "coaching_changes": st["offseason"]["coaching_changes"]},
    "staff": lambda st: {"stage": st["offseason"]["stage"], "changes": st["offseason"]["staff"]["changes"], "roles_filled": st["offseason"]["roles_filled"],
                         "move_to": st["offseason"].get("move_to"), "coaching_changes": st["offseason"]["coaching_changes"], "sides": _coach_side(st)},
    "conferences": lambda st: {"stage": st["offseason"]["stage"], "next_schedule": st["offseason"]["next_schedule"]},
    "stage": lambda st: {"stage": st["offseason"]["stage"]},
    "career": lambda st: {"career": {k: v for k, v in st["career"].items() if k != "saved_at"}, "year": st["league"]["year"],
                          "schedule_history": len(json.dumps(st["league"].get("schedule_history")))},
}
ADVANCE_AFTER = {"retention": "retention", "departures": "departures", "portal_w1": "portal_week", "portal_w2": "portal_week",
                 "portal_w3": "portal_week", "portal_w4": "portal_last", "portal_recap": "report", "portal_1": "portal_round", "portal_2": "report",
                 "development": "development", "staff": "staff", "conferences": "conferences", "schedule": "stage"}

PAGE_CASES = [
    None, 3, "text", True, [], {},
    {"pos": "QB", "overall": 81, "gain": 3, "grew": [{"key": "throw_power", "from": 70, "to": 74}, "x", {"from": 1, "to": 2}]},
    {"position": "WR", "overall": 64.5, "gain": -2, "grew": None},
    {"pos": "CB", "overall": True, "gain": 1},
    {"pos": "CB", "overall": 70, "gain": True},
    {"pos": "", "overall": 70, "evaluation": 61, "recruiting": 77},
    {"overall": 70, "evaluation": 55},
    {"rating": "evaluation", "from": 60, "to": 66, "name": "A Coach"},
    {"rating": 4, "from": 60, "to": 66},
    {"rating": "recruiting", "from": 60},
    {"rows": [{"pos": "K", "overall": 55}, [{"pos": "P", "overall": 99, "gain": 0}]], "staff": [{"id": "oc", "evaluation": 40, "recruiting": 90}]},
    {"pos": "HB", "overall": None}, {"pos": "HB", "overall": "70"},
]


def sample_players(st: dict) -> list:
    off, lgd, me = st["offseason"], st["league"], st["team"]
    ids = [c["id"] for c in lgd["teams"][me]["roster"]][::5]
    for s in list(lgd["teams"])[::17]:
        ids += [c["id"] for c in lgd["teams"][s]["roster"]][:3]
    by_kind: dict = {}
    for d in off.get("departures") or []:
        by_kind.setdefault((d["kind"], d["team"] == me), []).append(d["id"])
    for v in by_kind.values():
        ids += v[:2]
    ids += [e["id"] for e in (off.get("retention") or {}).get("players") or []][:5]
    ids += [r["id"] for r in (off.get("redshirts") or {}).get("players") or []][:6]
    ids += [m["id"] for m in off["portal"].get("moves") or []][:4]
    rc = st.get("recruiting") or {}
    if rc.get("portal"):
        ids += [pid for pid, s in rc["status"].items() if s.get("signed")][:6]
    ids += [pid for pid, e in off["portal"]["players"].items()][:3]
    ids += [c["id"] for c in lgd["teams"][me]["roster"] if c.get("transfer")][:4]
    ids += [c["id"] for c in lgd["teams"][me]["roster"] if c["cls"] == "FR"][:4]
    return list(dict.fromkeys(ids)) + ["nobody-at-all"]


def views(c: Cases, first: bool) -> None:
    st = c.st
    off, lgd, me = st["offseason"], st["league"], st["team"]
    stage = off["stage"]
    c.ask("view", st)
    c.ask("_view", st)
    if stage in ("portal_1", "portal_2"):
        for position, status in (("QB", None), ("OL", "available"), (None, "offered"), (None, "signed"), ("LT", None)):
            c.ask("view", st, position, status, label=f"view {position} {status}")
            c.ask("portal_rows", st, position, status, label=f"portal_rows {position} {status}")
        c.ask("portal_rows", st, None, None, 10, label="portal_rows limit 10")
        c.ask("portal_rows", st)
    c.ask("_your_jobs", off, show=sorted)
    c.ask("portal_away", st)
    c.ask("_portal_recap", st)
    if (st.get("recruiting") or {}).get("portal") and stage in offseason.PORTAL_STAGES:
        c.ask("portal_board", st)
    c.ask("summary", st)
    c.ask("conferences_view", st)
    c.ask("schedule_view", st)
    if first or stage == "conferences":
        c.ask("next_teams", st)
    slugs = [me] + list(lgd["teams"])[::29]
    c.ask("_stayed", slugs, label="_stayed (teams)", real=lambda ss: [offseason._stayed(off, lgd["teams"][s]["roster"]) for s in ss])
    c.ask("_new_transfer", slugs, label="_new_transfer (teams)",
          real=lambda ss: [[offseason._new_transfer(off, p, s) for p in lgd["teams"][s]["roster"]] for s in ss])
    ids = sample_players(st)
    c.ask("player_next", ids, label="player_next (players)", real=lambda xs: [offseason.player_next(st, x) for x in xs])
    c.ask("_player_next", ids, label="_player_next (players)", real=lambda xs: [offseason._player_next(st, x) for x in xs])
    c.ask("_school_name", [me, None, "", "no-such-school", list(lgd["teams"])[3]], label="_school_name (slugs)",
          real=lambda xs: [offseason._school_name(st, x) for x in xs])
    for s in (me, list(lgd["teams"])[5]):
        if (st.get("recruiting") or {}).get("portal"):
            c.ask("recruiting_spots", st, s)
            c.ask("recruiting_offer_cap", st, s)
    # what the stage does not let you do
    if stage != "staff":
        c.ask("choose_job", st, None, label="choose_job refused")
    if stage != "conferences":
        c.ask("move_conference", st, "memphis", "ACC", label="move_conference refused")
    if stage != "schedule":
        c.ask("schedule_move", st, "1", 3, label="schedule_move refused")
        c.ask("schedule_trade", st, "1", "memphis", label="schedule_trade refused")
    if stage not in offseason.PORTAL_STAGES and stage not in ("portal_1", "portal_2"):
        c.ask("portal_offer", st, "nobody", True, label="portal_offer refused")
    if stage != "ready":
        c.ask("next_season", st, label="next_season refused")
    c.ask("migrate", st, after="draft", label="migrate (nothing to do)")


def doings(c: Cases, plan: dict) -> None:
    """What the stage lets you do, before it is advanced."""
    st = c.st
    off, lgd, me = st["offseason"], st["league"], st["team"]
    stage = off["stage"]
    rc = st.get("recruiting") or {}
    if stage in offseason.PORTAL_STAGES:
        mine = set(rc["offers"].get(me, []))
        fresh = [pid for pid, s in rc["status"].items() if not s.get("signed") and pid not in mine][:3]
        for pid in fresh + list(mine)[:1]:
            for on in (True, False, True):
                keep = copy.deepcopy(rc)
                n = len(c.rows)
                Rec.calls = []
                try:
                    c.ask("portal_offer", st, pid, on, label=f"portal_offer {on}")
                except Exception:                    # recruiting.act refused it (no hours, no room...): not this part's doing
                    Rec.calls = None
                    del c.rows[n:]
                    st["recruiting"] = rc = keep
                    recruiting.reset_caches()
                    break
    if stage in ("portal_1", "portal_2"):
        portal = off["portal"]
        open_ = [pid for pid, e in portal["players"].items() if not e["signed"]]
        taken = [pid for pid, e in portal["players"].items() if e["signed"]]
        c.ask("portal_offer", st, "nobody-at-all", True, label="portal_offer unknown")
        for pid in taken[:1]:
            c.ask("portal_offer", st, pid, True, label="portal_offer signed")
        for pid in open_[:60]:                       # past your offers for the round: refused
            c.ask("portal_offer", st, pid, True, after="legacy_offers", label="portal_offer on")
        for pid in open_[:3] + open_[70:71]:
            c.ask("portal_offer", st, pid, False, after="legacy_offers", label="portal_offer off")
        c.ask("view", st, label="view after offers")
    if stage == "staff":
        car = off["carousel"]
        c.ask("choose_job", st, "no-such-school", label="choose_job unknown")
        c.ask("choose_job", st, None, after="choice", label="choose_job stay")
        if plan.get("take") and car["offers"]:
            c.ask("choose_job", st, car["offers"][0], after="choice", label="choose_job offer")
            c.ask("view", st, label="view with a choice")
        elif car["openings"] and plan.get("take"):
            c.ask("choose_job", st, car["openings"][-1], after="choice", label="choose_job opening")
    if stage == "conferences":
        v = offseason.conferences_view(st)
        confs = [x for x in v["conferences"]]
        fictional = next((s for s in lg.base_slugs() if lg.base_meta(s).get("fictional")), None)
        c.ask("move_conference", st, "no-such-school", "ACC", label="move_conference unknown")
        if fictional:
            c.ask("move_conference", st, fictional, "ACC", label="move_conference fictional")
        c.ask("move_conference", st, me, "A Conference Nobody Made", label="move_conference no such conference")
        c.ask("move_conference", st, me, st["conference"], after="moves", label="move_conference same")
        big = [x for x in confs if len(x["teams"]) >= 8]
        movers = [(big[i % len(big)]["teams"][i]["team"], big[(i + 1 + i % 3) % len(big)]["name"]) for i in range(plan.get("moves", 4))]
        movers += [(m[0], next(x["name"] for x in confs if any(t["team"] == m[0] for t in x["teams"]))) for m in movers[:1]]    # and one moved back
        indep = [x for x in confs if x["independent"]]
        if indep:
            movers.append((big[0]["teams"][-1]["team"], indep[0]["name"]))
            if indep[0]["teams"]:
                movers.append((indep[0]["teams"][0]["team"], big[1]["name"]))
        movers.append((me, big[2]["name"] if big[2]["name"] != st["conference"] else big[3]["name"]))
        for slug, conf in movers:
            c.ask("move_conference", st, slug, conf, after="moves", label=f"move_conference {slug} {conf}")
        c.ask("view", st, label="view after moves")
    if stage == "schedule":
        v = offseason.schedule_view(st)
        c.ask("schedule_trade", st, "no-such-game", me, label="schedule_trade unknown")
        c.ask("schedule_move", st, "no-such-game", 4, label="schedule_move unknown")
        tradable = [(g["event_id"], [o for o in g["options"] if o.get("ok", True)]) for g in v["editable"]]
        tradable = [(e, o) for e, o in tradable if o]
        for e, opts in tradable[:plan.get("trades", 2)]:
            slug = opts[len(opts) // 2].get("team") or opts[len(opts) // 2].get("slug")
            c.ask("schedule_trade", st, e, slug, after="schedule", label="schedule_trade")
        v = offseason.schedule_view(st)
        done = 0
        for e, rows in v["moves"].items():
            if rows and done < plan.get("game_moves", 2):
                c.ask("schedule_move", st, e, str(rows[-1]["week"]) if done else rows[0]["week"], after="schedule", label="schedule_move")
                done += 1
                v = offseason.schedule_view(st)
                if e not in v["moves"]:
                    break
        c.ask("schedule_move", st, next(iter(v["moves"]), "x"), "week nine", label="schedule_move not a week")
        c.ask("schedule_view", st, label="schedule_view after edits")
        c.ask("view", st, label="view after edits")


def walk(name: str, st: dict, plan: dict, stages: list) -> dict:
    """One offseason, stage by stage: a file a stage. Returns next season's state (Python's) when the plan asks."""
    league_file = None
    path = Path(str(season._league_path))
    if path.resolve() != Path(str(season.TEAMS_FILE)).resolve():
        league_file = f"{name}_league.json"
        shutil.copyfile(path, OUT / league_file)
    Rec.calls = None
    if plan.get("legacy_draft"):                      # a save from the older order: the draft run at the start, no "draft" block
        pass
    offseason.start(st)
    off = st["offseason"]
    off["auto"] = True
    if plan.get("fired"):
        if off.get("review"):
            off["review"].update(fired=True, security=4)
    if plan.get("wanted") and off.get("review"):
        off["review"].update(fired=False, security=96)
    new = None
    n = 0
    while True:
        stage = off["stage"]
        text = json.dumps(snapshot(st))
        c = Cases(st)
        if n == 0:
            c.ask("page", PAGE_CASES, label="page (odd values)", real=lambda xs: [offseason.page(x) for x in xs])
            if off.get("review") and not off["review"]["decided"]:
                off["auto"] = False
                c.ask("advance", st, label="advance refused: the AD is waiting")
                off["auto"] = True
        views(c, n == 0)
        doings(c, plan)
        if stage == "ready":
            if plan.get("next"):
                before = {}
                orig = recruiting.start.__wrapped__

                def start_(state, year=2027):
                    before["new"] = json.dumps({k: v for k, v in state.items() if k not in ("league", "career", "my_boxes")})
                    return orig(state, year)
                recruiting.start.__wrapped__ = start_
                wrapped = recruiting.start
                recruiting.start = lambda state, year=2027: (Rec.calls.append(["recruiting.start", ["<state>", year], None]), start_(state, year))[1]
                c.ask("next_season", st, after="career", show=lambda out: None)
                recruiting.start = wrapped
                recruiting.start.__wrapped__ = orig
                c.rows[-1]["new"] = json.loads(before["new"])
                new = c.rows[-1].pop("_new", None)
        else:
            c.ask("advance", st, after=ADVANCE_AFTER[stage], show=lambda out: out["stage"], label=f"advance from {stage}")
        file = f"{name}_{n:02d}_{stage}.json"
        (OUT / file).write_text('{"state": ' + text + ', "cases": ' + json.dumps(c.rows) + "}")
        stages.append({"career": name, "file": file, "stage": stage, "league_file": league_file, "cases": len(c.rows)})
        print(f"{file}: {len(c.rows)} cases", flush=True)
        if stage == "ready":
            break
        n += 1
    return st


def old_order(name: str, st: dict, stages: list) -> None:
    """migrate on saves from the older order, made from a career at Keep Them Home and at Departures after its
    draft: the "draft" block gone, the departures as the old draft left them."""
    for label, stage, retention in (("at-retention", "retention", True), ("at-departures", "departures", True), ("no-retention", "departures", False),
                                    ("past", "portal_recap", True), ("no-offseason", None, True)):
        old = json.loads(json.dumps({"team": st["team"], "games": {}, "offseason": {k: st["offseason"][k] for k in ("stage", "year", "departures", "retention")
                                                                                     if k in st["offseason"]}}))
        off = old["offseason"]
        off["stage"] = stage
        if not retention:
            off["retention"] = None
        for i, e in enumerate((off.get("retention") or {}).get("players") or []):
            if e["intent"] == "draft" and i % 2:
                e["draft_pick"] = 40 + i
        if stage is None:
            old.pop("offseason")
        text = json.dumps(old)
        c = Cases(old)
        AFTER["old"] = lambda s: s.get("offseason")
        c.ask("migrate", old, after="old", label=f"migrate {label}")
        c.ask("migrate", old, after="old", label=f"migrate {label} again")
        file = f"{name}_old_{label}.json"
        (OUT / file).write_text('{"state": ' + text + ', "cases": ' + json.dumps(c.rows) + "}")
        stages.append({"career": name, "file": file, "stage": stage, "league_file": None, "cases": len(c.rows)})


def main():
    stages: list = []
    setup = {"clear": __import__("coach_career.clear", fromlist=["x"]).on(),
             "offseason": {k: getattr(offseason, k) for k in ("STAGES", "PORTAL_STAGES", "OLD_PORTAL", "STAGE_NAMES", "ROSTER_LIMIT", "GROUP", "TARGET",
                                                               "NEXT_CLASS", "REVIEW_STAGES", "STAFF_ROLES", "PORTAL_OFFER_FACTOR")},
             "recruiting": {k: getattr(recruiting, k) for k in ("SPOTS", "SPOT_OF", "SPOT_ORDER")},
             "names": {k: getattr(offseason, k) for k in ("KIND_NAMES", "RECAP_MOVES", "RECAP_STAGES")},
             "PT_NAMES": [[k, v] for k, v in offseason.PT_NAMES.items()]}

    # 1. a first offseason, then the season next_season made and its offseason (a job offer taken there)
    season.use_league(None)
    st = season.new_season("smu", "full", seed=7, career=True)
    finished(st)
    walk("a1", st, {"next": True, "moves": 4, "trades": 2}, stages)
    # the next season as Python made it (the walk's last case ran next_season on `st`): do it again for the state itself
    # (next_season is not idempotent on the career's history, so the walk's own run is the one compared)
    st2 = PY_NEW["a1"]
    finished(st2)
    walk("a2", st2, {"next": True, "wanted": True, "take": True, "moves": 2, "trades": 1}, stages)

    # 2. fired at the AD's meeting: Auto takes the best opening
    season.use_league(None)
    recruiting.use_league_models({})
    st = season.new_season("akron", "full", seed=19, career=True)
    finished(st)
    walk("b1", st, {"next": True, "fired": True, "moves": 3, "trades": 3}, stages)

    # 3. a save with no recruiting: the old two-round portal
    season.use_league(None)
    recruiting.use_league_models({})
    st = season.new_season("georgia", "full", seed=3, career=True)
    finished(st)
    st.pop("recruiting", None)
    try:
        walk("c1", st, {"next": True, "moves": 1, "trades": 1}, stages)
    except Exception as e:                       # (the old portal is only reached by an old save: say so if this one cannot walk it)
        print("the save without recruiting did not walk:", type(e).__name__, e)
        setup["legacy_failed"] = f"{type(e).__name__}: {e}"

    # 4. saves from the older order
    season.use_league(None)
    st = season.new_season("smu", "full", seed=11, career=True)
    finished(st)
    Rec.calls = None
    offseason.start(st)
    st["offseason"]["auto"] = True
    old_order("d-retention", st, stages)
    offseason.advance(st)
    old_order("d-departures", st, stages)

    setup["stages"] = stages
    (OUT / "setup.json").write_text(json.dumps(setup))
    print(f"{sum(s['cases'] for s in stages)} cases in {len(stages)} files")


PY_NEW: dict = {}
_next_season = offseason.next_season


def _keeping(state):
    new = _next_season(state)
    PY_NEW[state.get("_name") or "a1"] = new
    return new


offseason.next_season = _keeping

if __name__ == "__main__":
    main()
