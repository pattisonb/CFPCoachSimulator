"""Everything the pages read from a season (sim/season.py's public functions that app/api.py calls), asked of a real
seeded season at several points, with the changes a page can make in between (depth chart, god-mode edits, faces,
positions, redshirts, settings, game day, save and load), for season_views_compare.mjs to hold the JavaScript season to:
CFP_CLEAR=0 python3 sim_js/test/season_views_reference.py OUT [team] [seed]

Each checkpoint file is a list of steps. A step is {"fn", "args", "ret"} or {"fn", "args", "err"}; "state" steps hold the
whole state. Arguments that are not plain values are written as markers the compare script fills in from its own
season: "$state", "$teams", ["$player", team, slug], ["$team", slug], ["$game", event id], ["$box", event id]."""
import json, os, random, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
team = sys.argv[2] if len(sys.argv) > 2 else "ohio-state"
seed = int(sys.argv[3]) if len(sys.argv) > 3 else 7
os.environ["CFP_SEASONS_DIR"] = tempfile.mkdtemp()
os.environ["SIM_WORKERS"] = "1"

from sim import season
from coach_career import clear, league, recruiting
from sim import grade, schedule_gen

CHECKPOINTS = (0, 2, 6, 11, 15, 16, 18)        # weeks played when everything is asked; and once more when the season is done
GAME_DAYS = (2, 11, 16, 18)                    # checkpoints that then play your game alone before the rest of the week
pick = random.Random(f"views-{team}-{seed}")   # which players and teams are asked about (never the season's own draws)


def enc(o):
    """A value as JSON that keeps a dict's key order whatever its keys look like, and 4.0 as 4 (one kind of number)."""
    if isinstance(o, bool) or o is None or isinstance(o, str):
        return o
    if isinstance(o, float):
        return int(o) if o.is_integer() else o
    if isinstance(o, int):
        return o
    if isinstance(o, dict):
        return {"$d": [[k if isinstance(k, str) else json.loads(json.dumps({k: 0}).split(":")[0][1:]), enc(v)] for k, v in o.items()]}
    if isinstance(o, (list, tuple)):
        return [enc(v) for v in o]
    if isinstance(o, (set, frozenset)):
        return {"$set": sorted(enc(v) for v in o)}
    if isinstance(o, Path):
        return {"$path": True}
    if callable(o):
        return {"$fn": True}
    raise TypeError(f"cannot write {type(o)}")


# what the unported modules answered, in the order asked (the compare script replays them)
stubs = {"recruiting.word": [], "grade.season_grade": [], "ability_goals.merged_traits": [], "league.base_development": None}
from coach_career import ability_goals
_word, _grade, _merged, _base_dev = recruiting.word, grade.season_grade, ability_goals.merged_traits, league.base_development


def _rec_word(*a, **k):
    r = _word(*a, **k); stubs["recruiting.word"].append([enc(list(a)), enc(r)]); return r


def _rec_grade(*a, **k):
    r = _grade(*a, **k); stubs["grade.season_grade"].append(enc(r)); return r


def _rec_merged(state, team, key, base):
    r = _merged(state, team, key, base); stubs["ability_goals.merged_traits"].append([team, key, enc(r)]); return r


def _rec_base_dev():
    r = _base_dev(); stubs["league.base_development"] = enc(r); return r


recruiting.word, grade.season_grade, ability_goals.merged_traits, league.base_development = _rec_word, _rec_grade, _rec_merged, _rec_base_dev
assert not ability_goals.on(), "run with CFP_CLEAR=0: Clear Mode's modules are not ported yet"

state = season.new_season(team, seed=seed)
teams = season.load_teams()
steps = []


def resolve(a):
    if a == "$state":
        return state
    if a == "$teams":
        return teams
    if isinstance(a, list) and a and a[0] == "$player":
        t = season.team_data(state, a[1])
        return next(p for p in t["offense"] + t["defense"] if p.get("slug") == a[2])
    if isinstance(a, list) and a and a[0] == "$team":
        return season.team_data(state, a[1])
    if isinstance(a, list) and a and a[0] == "$game":
        return state["games"][a[1]]
    if isinstance(a, list) and a and a[0] == "$box":
        return season.load_box(state, a[1])
    return a


def call(fn, *args, career=False):
    """Ask season.<fn>(*args) and write the answer down. `career`: the season says it is a career for this one call
    (a redshirt is a career's; nothing else of a career is ported yet)."""
    step = {"fn": fn, "args": list(args)}
    if career:
        step["career"] = True
        state["career"] = {"views_test": True}
    try:
        r = getattr(season, fn)(*[resolve(a) for a in args])
        step["ret"] = "$state" if r is state else enc(r)
    except Exception as e:                                            # the page shows the message: it is part of the answer
        step["err"] = [type(e).__name__, str(e), getattr(e, "code", None)]
    finally:
        if career:
            state["career"] = None
    steps.append(step)
    return None if "err" in step else r


def dump_state():
    steps.append({"fn": "state", "ret": enc(state)})


def roster(slug):
    t = season.team_data(state, slug)
    return t["offense"] + t["defense"]


FBS = sorted(season.fbs_only(teams))
OTHERS = pick.sample([s for s in FBS if s != team], 10)
FCS = sorted(s for s in teams if s not in set(FBS))[:1]
CONFS = sorted({teams[s]["conference"] for s in FBS})
ROLES = [r for _, rows in season.DEPTH_ROWS for r, _ in rows]
FACE = {"fat": 0.31, "teamColors": ["#bb0000", "#666666", "#ffffff"], "hairBg": {"id": "none"}, "body": {"id": "body2", "color": "#c68642", "size": 1.02},
        "head": {"id": "head3", "shave": "rgba(0,0,0,0.12)"}, "eye": {"id": "eye7", "angle": -3}, "hair": {"id": "short-fade", "color": "#272421", "flip": False}}


def reads(n):
    me = state["team"]
    cw = state["current_week"]
    call("summary", "$state")
    call("settings", "$state")
    call("standings", "$state")
    call("divisions", "$state")
    call("current_rank", "$state")
    call("my_game_id", "$state")
    call("my_game_id", "$state", cw)
    call("my_results", "$state", 0)
    call("my_results", "$state", max(0, cw - 2))
    call("week_dates", "$state")
    call("season_year", "$state")
    for w in sorted({0, 1, cw, cw + 1, 14, 15, 16, 17, 20}):
        call("week_label", w)
        call("week_name", w)
        call("week_work", "$state", w)
        call("week_work", "$state", w, True)
        call("rank_map", "$state", w)
        if 1 <= w <= 20:
            call("week_view", "$state", w)
    call("_records", "$state", None, True)
    call("_records", "$state", max(0, cw - 1))
    for s in [me] + OTHERS[:5] + FCS:
        call("team_schedule_view", "$state", s)
        call("team_schedule", "$state", s)
        call("rivalries_view", "$state", s)
        call("game_preview", "$state", s) if s in (me, OTHERS[0]) else None
        call("check_fbs", s)
        call("team_overall", "$state", s)
        call("_unit_overalls", "$state", s)
        call("team_ratings_now", "$state", s)
        call("page_ratings", ["$team", s])
        call("game_ratings", ["$team", s])
        call("team_display", s, "$teams")
        call("tier_of", ["$team", s])
    for s in [me] + OTHERS[:3] + FCS:
        call("depth_chart_view", "$state", s)
        call("depth_roster_view", "$state", s)
        call("formations_view", "$state", s)
        call("depth_changed", "$state", s)
        call("player_faces", "$state", s)
        call("injury_report", "$state", s)
        call("development_reads", "$state", s)
        call("attribute_ceilings", "$state", s)
        call("redshirting" if False else "position_changes", "$state", s)
        call("morale_payload", "$state", s)
        call("team_morale", "$state", s)
    for s in [me, OTHERS[0]]:
        call("playlink_team", "$state", s)
        call("team_data", "$state", s)
        for r in ROLES:
            call("position_candidates", "$state", s, r)
            call("depth_order", "$state", s, r)
        call("position_candidates", "$state", s, "XX")
    call("injury_report", "$state")
    call("injury_report", "$state", None)
    call("resume", "$state")
    call("resume", "$state", None, me)
    call("resume", "$state", max(0, cw - 1), OTHERS[1])
    call("team_stats_view", "$state")
    for cat in list(season.PLAYER_CATEGORIES) + ["nonsense"]:
        call("player_stats_view", "$state", None, cat)
        call("player_stats_view", "$state", me, cat, 100)
        call("player_stats_view", "$state", None, cat, 20, CONFS[n % len(CONFS)])
    call("player_leaders_view", "$state")
    call("player_leaders_view", "$state", me, 5)
    call("player_leaders_view", "$state", None, 10, CONFS[(n + 3) % len(CONFS)])
    call("awards_view", "$state")
    call("awards_outlook", "$state", "$teams")
    call("bracket_projection", "$state")
    call("bowl_projection", "$state")
    call("bowl_projection", "$state", True)
    call("bowl_view", "$state")
    call("season_review", "$state")
    call("schedule_editable", "$state")
    call("schedule_moves", "$state")
    first = next(g["event_id"] for g in state["games"].values() if me in (g["home"], g["away"]))
    call("schedule_options", "$state", first)              # a career's, before its first week: refused here
    call("schedule_swap", "$state", first, OTHERS[0])
    call("schedule_move", "$state", first, 99)
    # players: your whole roster, and a few from other teams, as their pages read them
    mine = roster(me)
    asked = [(me, p) for p in mine] + [(s, p) for s in OTHERS for p in pick.sample(roster(s), 3)]
    for s, p in asked:
        call("player_profile", "$state", s, None, None, p["slug"])
    for s, p in pick.sample(asked, 12):
        call("player_profile", "$state", s, p["name"], p["position"])
        call("player_profile", "$state", None, None, None, p["slug"])
        call("morale_view", "$state", s, p["name"], p["position"])
        call("morale_factor", "$state", s, p["name"], p["position"])
        call("player_form", "$state", s, p["name"], p["position"])
        call("position_options", "$state", s, p["slug"])
        call("redshirt_status", "$state", s, ["$player", s, p["slug"]])
        call("redshirt_status", "$state", s, ["$player", s, p["slug"]], career=True)
        call("page_overall", ["$player", s, p["slug"]])
        call("shown_overall", ["$player", s, p["slug"]])
        call("player_overall", ["$player", s, p["slug"]])
        call("all_skills", ["$player", s, p["slug"]])
        call("recruit_stars", ["$player", s, p["slug"]])
        call("return_value", ["$player", s, p["slug"]])
        call("player_ranks", "$state", "$teams", s, p["name"], p["position"])
        call("player_honors", "$state", s, p["name"])
        call("player_game_log", "$state", s, p["name"], p["position"])
    call("player_profile", "$state", me, None, None, "nobody-at-all")
    call("player_profile", "$state", me, "Nobody At All", "QB")
    call("position_options", "$state", me, "nobody-at-all")
    # box scores and rivalry lines: yours and a few of everyone else's
    played = [g for g in state["games"].values() if g.get("played")]
    mine_played = [g for g in played if me in (g["home"], g["away"])]
    for g in mine_played[-4:] + pick.sample(played, min(6, len(played))):
        call("load_box", "$state", g["event_id"])
        call("box_names", ["$box", g["event_id"]])
        call("has_box", "$state", ["$game", g["event_id"]])
        call("game_rivalry", "$state", ["$game", g["event_id"]], True)
    ahead = [g for g in state["games"].values() if not g.get("played")]
    for g in ahead[:40]:
        call("game_rivalry", "$state", ["$game", g["event_id"]])
    call("load_box", "$state", "no-such-game")


def after_reads():
    """What a change shows on the page afterwards."""
    me = state["team"]
    for s in (me, OTHERS[0]):
        call("depth_chart_view", "$state", s)
        call("depth_roster_view", "$state", s)
        call("formations_view", "$state", s)
        call("depth_changed", "$state", s)
        call("_unit_overalls", "$state", s)
        call("team_ratings_now", "$state", s)
        call("player_faces", "$state", s)
        call("position_changes", "$state", s)
    call("summary", "$state")
    call("game_preview", "$state", me)
    call("settings", "$state")


def changes(n):
    """The things a page can change, each answered and then read back; a few that must be refused."""
    me = state["team"]
    other = OTHERS[0]
    call("update_settings", "$state", {"god_mode": True, "morale": None, "nonsense": 3})
    call("update_settings", "$state", {"morale": n % 4 != 3})                     # morale off for a stretch, then on again
    for s in (me, other):
        t = season.apply_depth(season.team_data(state, s), (state.get("depth") or {}).get(s))
        # the depth chart: swap two at a role, walk a man up, down and to the top, name returners, bring in a man from another role
        for role in pick.sample(["QB", "HB", "WR", "TE", "CB", "DT", "FS", "K"], 4):
            order = season.depth_order(state, s, role)
            call("depth_order", "$state", s, role)
            if len(order) >= 2:
                new = list(order); new[0], new[1] = new[1], new[0]
                call("set_depth_order", "$state", s, role, new)
                call("move_depth", "$state", s, role, order[-1], "up")
                call("move_depth", "$state", s, role, new[0], "down")
            if len(order) >= 3:
                call("move_depth", "$state", s, role, order[2], "top")
            call("depth_order", "$state", s, role)
        wr = season.depth_order(state, s, "WR")
        cb = season.depth_order(state, s, "CB")
        if wr and cb:
            call("move_depth", "$state", s, "KR", wr[-1], "top")
            call("move_depth", "$state", s, "PR", cb[0], "top")
            call("move_depth", "$state", s, "CB", wr[-1], "top" if n % 2 else "up")       # a receiver tried at corner
        call("set_depth_order", "$state", s, "QB", ["nobody"])
        call("set_depth_order", "$state", s, "KR", [])
        call("move_depth", "$state", s, "QB", "nobody", "up")
        # god mode: a player's ratings, size, class and attributes
        ps = pick.sample(roster(s), 4)
        base = {p["slug"]: p for p in teams[s]["offense"] + teams[s]["defense"]}
        for i, p in enumerate(ps):
            b = base[p["slug"]]
            attrs = sorted(b.get("attributes") or {})
            ch = {"speed": 99 - 7 * i, "strength": 61.5 + i, "jersey": f" {i + 1}{n} ", "class": ["JR", "SORS", "FR", "SR"][i],
                  "weight": 198 + 31 * i, "dev_trait": season.DEV_TRAITS[(i + n) % 4]}
            if attrs:
                ch["attributes"] = {attrs[(3 * i + n) % len(attrs)]: 97 - i, attrs[(5 * i + n + 1) % len(attrs)]: 44 + 3 * i}
            if i == 1:
                ch["height"] = "6'5\""
            call("edit_player", "$state", s, p["slug"], ch)
            call("player_profile", "$state", s, None, None, p["slug"])
            call("player_edits", "$state", s)
            if i == 2:                                                       # and one edit undone
                call("edit_player", "$state", s, p["slug"], {"speed": season.display_rating(b, "speed"), "class": b["class"],
                                                              "weight": b["weight"], "jersey": b["jersey"], "dev_trait": b["dev_trait"]})
                if attrs:
                    call("edit_player", "$state", s, p["slug"], {"attributes": {a: b["attributes"][a] for a in ch["attributes"]}})
                call("player_profile", "$state", s, None, None, p["slug"])
        p = ps[0]
        call("edit_player", "$state", s, p["slug"], {"name": "Somebody Else"})
        call("edit_player", "$state", s, p["slug"], {"speed": "fast"})
        call("edit_player", "$state", s, p["slug"], {"class": "GRAD"})
        call("edit_player", "$state", s, p["slug"], {"dev_trait": "Generational"})
        call("edit_player", "$state", s, p["slug"], {"weight": "heavy"})
        call("edit_player", "$state", s, p["slug"], {"attributes": [1, 2]})
        call("edit_player", "$state", s, p["slug"], {"attributes": {"no_such_attribute": 50}})
        call("edit_player", "$state", s, "nobody-at-all", {"speed": 80})
        # faces
        call("set_player_face", "$state", s, ps[1]["slug"], dict(FACE, fat=round(0.1 * n + 0.05, 2)))
        call("set_player_face", "$state", s, ps[2]["slug"], FACE)
        call("set_player_face", "$state", s, ps[2]["slug"], None)
        call("set_player_face", "$state", s, ps[3]["slug"], {"junk": "x" * 5000})
        call("set_player_face", "$state", s, ps[3]["slug"], "a face")
        call("set_player_face", "$state", s, "nobody-at-all", FACE)
        call("player_faces", "$state", s)
        # a position change: the best other spot he has, and for one man, back again
        for j, p in enumerate(pick.sample(roster(s), 3)):
            opts = season.position_options(state, s, p["slug"])
            call("position_options", "$state", s, p["slug"])
            cur = p.get("role") or p["position"]
            to = next((o["pos"] for o in opts if o["pos"] != cur), None) if opts else None
            if to:
                call("change_position", "$state", s, p["slug"], to)
                call("change_position", "$state", s, p["slug"], to)             # he plays there already
                call("player_profile", "$state", s, None, None, p["slug"])
                call("position_options", "$state", s, p["slug"])
                if j == 2:
                    call("change_position", "$state", s, p["slug"], cur)
            call("change_position", "$state", s, p["slug"], "K" if cur not in ("K", "P") else "QB")
            call("change_position", "$state", s, p["slug"], "XX")
        call("change_position", "$state", s, "nobody-at-all", "QB")
        # redshirts: a career's, so the season says it is one for the call
        young = [p for p in roster(s) if (p.get("class") or "") in season.REDSHIRT_CLASSES and (p.get("depth") or 9) >= 3]
        for p in pick.sample(young, min(3, len(young))):
            call("redshirt_toggle", "$state", s, p["slug"], True)
            call("redshirt_toggle", "$state", s, p["slug"], True, career=True)
            call("redshirt_status", "$state", s, ["$player", s, p["slug"]], career=True)
        on = sorted(((state.get("redshirting") or {}).get(s) or {}))
        if len(on) > 2:
            call("redshirt_toggle", "$state", s, on[0], False, career=True)
        old = [p for p in roster(s) if (p.get("class") or "") in ("SR", "SRRS", "JRRS")][:2]
        for p in old:
            call("redshirt_toggle", "$state", s, p["slug"], True, career=True)
        call("redshirt_toggle", "$state", s, "nobody-at-all", True, career=True)
    call("redshirt_toggle", "$state", "no-such-team", "nobody", True, career=True)
    call("move_depth", "$state", (FCS or ["x"])[0], "QB", "nobody", "up")
    call("reset_depth", "$state", (FCS or ["x"])[0])
    call("edit_player", "$state", (FCS or ["x"])[0], "nobody", {"speed": 80})
    call("set_player_face", "$state", "no-such-team", "nobody", FACE)
    moves = season.schedule_moves(state)
    if n == 0 and moves:                              # before the season: one of your games moved to another Saturday
        eid = sorted(moves)[len(moves) // 2]
        call("schedule_move", "$state", eid, moves[eid][-1]["week"])
        call("schedule_moves", "$state")
        call("team_schedule_view", "$state", me)
    after_reads()
    if n % 3 == 2:                                    # every third checkpoint the charts go back to where they started
        for s in (me, other):
            call("reset_depth", "$state", s)
            call("depth_changed", "$state", s)
            call("depth_chart_view", "$state", s)


def round_trip():
    """Save, load, and carry on with what was loaded."""
    global state
    call("save_season", "$state")
    state = season.load_season(state["id"])
    steps.append({"fn": "load_season"})
    dump_state()
    call("summary", "$state")
    call("depth_chart_view", "$state", state["team"])


def checkpoint(n, label):
    global steps
    steps = []
    dump_state()
    reads(n)
    changes(n)
    dump_state()
    round_trip()
    if not state["done"] and state["current_week"] in GAME_DAYS:
        call("play_my_game", "$state")
        dump_state()
        me = state["team"]
        call("summary", "$state")
        call("my_results", "$state", state["current_week"])
        call("my_game_id", "$state")
        call("week_view", "$state", state["current_week"] + 1)
        call("week_work", "$state", state["current_week"] + 1)
        call("team_schedule_view", "$state", me)
        call("standings", "$state")
        call("team_stats_view", "$state")
        call("player_stats_view", "$state", me, "passing")
        eid = next((g["event_id"] for g in state["games"].values() if g.get("played") and g["week"] == state["current_week"] + 1
                    and me in (g["home"], g["away"])), None)
        if eid:
            call("load_box", "$state", eid)
            call("box_names", ["$box", eid])
        for p in roster(me)[:30]:
            call("player_profile", "$state", me, None, None, p["slug"])
        round_trip()
        call("forget_fresh_boxes")
    (out / f"views_{n:02d}.json").write_text(json.dumps(steps))
    print(label, len(steps), "steps", sum(1 for s in steps if "err" in s), "refused", flush=True)


once = []
call("all_preset_faces")
for s in [team] + OTHERS[:3]:
    call("preset_faces", s)
call("stand_in_names", "$teams")
call("fbs_only", "$teams")
for name in ("LAST_REGULAR_WEEK", "CCG_WEEK", "SELECTION_WEEK", "FINAL_WEEK", "PROGRESS_PARTS", "SAVING_STAGE", "PROGRESS_GAME",
             "ROLE_POSITION", "DEPTH_ROWS", "PLAYER_CATEGORIES", "LEADER_KEYS", "DEFAULT_SETTINGS", "CLASS_NAMES", "DEV_TRAITS",
             "EDITABLE_FIELDS", "RATING_LABELS", "POSITION_RATINGS", "DEPTH_COLUMNS", "COLUMN_SHORT", "GROUPING_NAMES", "PLAYOFF_WEEKS",
             "BOWL_WEEK_LABELS", "TIEBREAK_STEPS", "PAGE_POS_VALUE", "RANK_STATS", "DIVISIONS", "PROGRESS_POSTSEASON_GAMES"):
    steps.append({"fn": "const", "args": [name], "ret": enc(getattr(season, name))})
for stage, total in (("Saving", None), ("Recruiting week", None), ("Playing the games", 60), ("AP poll", None), (None, None),
                     ("Handing out the conference awards", None), ("Setting the bowls", None), ("Getting Week 3 ready", None)):
    call("progress_part", stage, total)
(out / "views_once.json").write_text(json.dumps(steps))

n = 0
done_at = None
while True:
    if state["done"] or state["current_week"] in CHECKPOINTS:
        checkpoint(n, "done" if state["done"] else f"week {state['current_week']}")
        n += 1
    if state["done"]:
        break
    state = season.advance(state)
(out / "setup.json").write_text(json.dumps({
    "team": team, "seed": seed, "clear": clear.on(), "OFFENSE_ROLES": sorted(league.OFFENSE_ROLES),
    "TEAM_FIT": league.TEAM_FIT, "GROUP_OF": league.GROUP_OF, "FINALE_WEEK": schedule_gen.FINALE_WEEK, "checkpoints": n}))
(out / "stubs.json").write_text(json.dumps(stubs))
print(n, "checkpoints")
