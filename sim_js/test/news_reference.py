"""The league news by the Python (sim/news.py), for news_compare.mjs to hold sim_js/news.js to. A seeded career is
simmed as far as it goes; the news of every finished week is written (each maker's own items, with their importance,
and the week's final list), for the season as it is and for changed copies of it that reach what a plain season rarely
does: forced upsets, shuffled polls, big stat lines, quarterback injuries, long winning streaks, every kind of
recruiting line. What the news asks of modules not in JavaScript yet (persona.story, persona.hero_state) is recorded
for the compare script to replay.
python3 sim_js/test/news_reference.py OUTDIR [team] [seed] [weeks]"""
import copy, json, os, random, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
team = sys.argv[2] if len(sys.argv) > 2 else "smu"
seed = int(sys.argv[3]) if len(sys.argv) > 3 else 23
weeks = int(sys.argv[4]) if len(sys.argv) > 4 else 20
os.environ["CFP_SEASONS_DIR"] = tempfile.mkdtemp()
os.environ["SIM_WORKERS"] = "1"

from app import api
from sim import news, season
from coach_career import clear, league, persona

s = api.call("POST", "/api/season", {"team": team, "seed": seed, "career": True})
for to in range(1, weeks + 1):
    try:
        api.call("POST", f"/api/season/{s['id']}/advance", {"to": to})
        while api.step() is not None:
            pass
    except Exception as e:                       # the career stops where it needs its coach: the weeks so far are the test
        print("stopped:", type(e).__name__, str(e)[:100])
        break
    if api.loaded_state()["current_week"] < to:
        break
real = api.loaded_state()
print("simmed to week", real["current_week"], "phase", real.get("phase"))
teams = season.load_teams()
fbs = season.fbs_only(teams)

# ---- what the JavaScript is given ---------------------------------------------------------------------------------
def slim_box(b):
    """What the news reads of a box score: each side's players (name, position, starter, stats) and injuries."""
    o = {}
    for side in ("home", "away"):
        if side in b:
            sd = b[side] or {}
            o[side] = {k: sd[k] for k in ("injuries",) if k in sd}
            if "players" in sd:
                o[side]["players"] = [{k: p[k] for k in ("name", "position", "starter", "stats") if k in p} for p in sd["players"] or []]
    return o


def slim_polls(polls):
    return {w: ({"ap": [{"team": e["team"], "rank": e["rank"]} for e in p["ap"]]} if "ap" in p else {}) for w, p in polls.items()}


def slim_prospects(pr):
    return {pid: {k: p[k] for k in ("name", "position", "stars") if k in p} for pid, p in pr.items()}


boxes0 = {}
for g in real["games"].values():
    if g.get("played") and g["home"] in fbs and g["away"] in fbs:
        b = season.load_box(real, g["event_id"], shared=True)
        if b is not None:
            boxes0[g["event_id"]] = slim_box(b)
BOXES = boxes0                                   # the boxes the news is reading now (a scenario swaps its own in)
season.load_box = lambda state, event_id, shared=False: copy.deepcopy(BOXES.get(event_id))

# persona's answers, by scenario
asked = {"story": {}, "hero_state": {}}
_story, _hero = persona.story, persona.hero_state


def story(state, pid):
    r = _story(state, pid)
    asked["story"][pid] = [r[0], r[1]]
    return r


def hero_state(state, pid, d):
    r = _hero(state, pid, d)
    asked["hero_state"][pid] = r
    return r


persona.story, persona.hero_state = story, hero_state


def answers(state):
    """Every finished week's news: each maker's items as it made them, the week's list, and league_news from several weeks."""
    news._cache.clear()
    asked["story"], asked["hero_state"] = {}, {}
    cw = state["current_week"]
    by_week = {}
    for w in range(0, cw + 2):
        games = [g for g in state["games"].values() if g["week"] == w and g.get("played")]
        boxes = {g["event_id"]: BOXES[g["event_id"]] for g in games if g["home"] in fbs and g["away"] in fbs and g["event_id"] in BOXES}
        by_week[str(w)] = {
            "upsets": news._upsets(state, teams, fbs, w, games), "rankings": news._rankings(state, teams, w),
            "big_games": news._big_games(state, teams, fbs, games, boxes), "streaks": news._streaks(state, teams, fbs, w, games),
            "recruiting": news._recruiting(state, teams, w), "injuries": news._injuries(state, teams, fbs, w, games, boxes),
            "week_news": news.week_news(state, w)}
    league = {str(n): news.league_news(state, n) for n in (-3, 0, 1, cw // 2, cw - 1, cw, cw + 3)}
    return {"weeks": by_week, "league_news": league, "story": asked["story"], "hero_state": asked["hero_state"]}


n_scen = 0
index = []


def scenario(name, state, boxes=None, base=None):
    """Write one scenario: what differs from the season as simmed, and Python's news for it."""
    global BOXES, n_scen
    BOXES = {**boxes0, **(boxes or {})}
    before = json.dumps(state, sort_keys=True)
    a = answers(state)
    assert json.dumps(state, sort_keys=True) == before, "reading the news changed the season"
    rec = {"name": name, "answers": a, "boxes": boxes or {}, "set": {}}
    if base is not None:
        if state["team"] != base["team"]:
            rec["set"]["team"] = state["team"]
        if state["polls"] != base["polls"]:
            rec["set"]["polls"] = slim_polls(state["polls"])
        if state["games"] != base["games"]:
            rec["set"]["games"] = [[eid, g] for eid, g in state["games"].items()]
        if state["recruiting"]["log"] != base["recruiting"]["log"]:
            rec["set"]["log"] = state["recruiting"]["log"]
        if slim_prospects(state["recruiting"]["prospects"]) != slim_prospects(base["recruiting"]["prospects"]):
            rec["set"]["prospects"] = slim_prospects(state["recruiting"]["prospects"])
        for k in ("year", "id", "current_week"):
            if state.get(k) != base.get(k):
                rec["set"][k] = state.get(k)
        if "recruiting_none" in state:
            rec["set"]["recruiting_none"] = True
    n_scen += 1
    f = f"scenario_{n_scen:02d}.json"
    (out / f).write_text(json.dumps(rec))
    items = sum(len(v) for w in a["weeks"].values() for k, v in w.items() if k != "week_news")
    kinds = {}
    for w in a["weeks"].values():
        for k, v in w.items():
            if k != "week_news":
                kinds[k] = kinds.get(k, 0) + len(v)
    index.append({"name": name, "file": f, "items": items})
    print(f"{name}: {items} items made {kinds}, {sum(len(w['week_news']) for w in a['weeks'].values())} shown")


(out / "base.json").write_text(json.dumps({
    "clear": clear.on(), "OFFENSE_ROLES": sorted(league.OFFENSE_ROLES), "TEAM_FIT": league.TEAM_FIT, "GROUP_OF": league.GROUP_OF,
    "teams": {s: {k: (t[k] if k != "team_ratings" else {"overall": t[k]["overall"]}) for k in ("name", "conference", "state", "fictional", "team_ratings") if k in t}
              for s, t in teams.items()},
    "state": {"id": real["id"], "team": real["team"], "year": real.get("year"), "current_week": real["current_week"],
              "polls": slim_polls(real["polls"]), "games": [[eid, g] for eid, g in real["games"].items()],
              "recruiting": {"log": real["recruiting"]["log"], "prospects": slim_prospects(real["recruiting"]["prospects"])}},
    "boxes": boxes0,
    "constants": {k: getattr(news, k) for k in ("NEWS_PER_WEEK", "UPSET_CHANCE", "UPSET_TOP", "TOP_N", "BIG_PASS", "BIG_RUSH", "BIG_TDS", "BIG_SACKS",
                                                 "STREAK", "KIND_MAX", "KINDS", "_BASE", "LATE_FROM_WEEK")} | {"STAR_WORDS": {str(k): v for k, v in news.STAR_WORDS.items()}},
    "small": {"with": [[t, news._with(t)] for t in ("back spasms", "ankle sprain", "concussion", "high ankle sprain", "illness", "stress", "torn ACL", "s", "upper-body injury")],
              "when": [[d, news._when(d)] for d in range(0, 23)],
              "ranked": [[n, r, news._ranked(n, r)] for n, r in (("Texas", 3), ("SMU", None), ("Rice", 0), ("Ohio State", 25))],
              "score": [[g, h, news._score(g, h)] for g, h in (({"home_score": 31, "away_score": 28, "overtime": 0}, True), ({"home_score": 17, "away_score": 20, "overtime": 2}, False),
                                                              ({"home_score": 3, "away_score": 0}, True), ({"home_score": 10, "away_score": 44, "overtime": None}, False))],
              "chance": [[t, g, sd, news._pregame_chance(t, g, sd)] for t, g, sd in (
                  ({"a": {"team_ratings": {"overall": 88}}, "b": {"team_ratings": {"overall": 71.5}}}, {"home": "a", "away": "b", "neutral": False}, "home"),
                  ({"a": {"team_ratings": {"overall": 88}}, "b": {"team_ratings": {"overall": 71.5}}}, {"home": "a", "away": "b", "neutral": True}, "away"),
                  ({"a": {"team_ratings": {"overall": 60}}, "b": {"team_ratings": {"overall": 99}}}, {"home": "a", "away": "b", "neutral": False}, "home"),
                  ({"a": {"team_ratings": {"overall": 60}}, "b": {"team_ratings": {"overall": 99}}}, {"home": "a", "away": "b", "neutral": False}, "away"),
                  ({"a": {"team_ratings": {"overall": 60}}}, {"home": "a", "away": "b", "neutral": False}, "home"),
                  ({"a": {"team_ratings": {}}, "b": {"team_ratings": {"overall": 70}}}, {"home": "a", "away": "b", "neutral": False}, "away"),
                  ({"a": {"team_ratings": {"overall": None}}, "b": {"team_ratings": {"overall": 70}}}, {"home": "a", "away": "b", "neutral": False}, "home"),
                  ({"a": {"team_ratings": None}, "b": {"team_ratings": {"overall": 70}}}, {"home": "a", "away": "b", "neutral": False}, "home"),
                  ({"a": {"team_ratings": {"overall": 70}}, "b": {"team_ratings": {"overall": 70}}}, {"home": "a", "away": "b"}, "home"),
                  ({"a": {"team_ratings": {"overall": 80}}, "b": {}}, {"home": "a", "away": "b", "neutral": False}, "home"))]}}))

cw = real["current_week"]
played = [g for g in real["games"].values() if g.get("played")]
fbs_played = [g for g in played if g["home"] in fbs and g["away"] in fbs]

# 1. the season as it was simmed
scenario("as simmed", real, base=real)

# 2. from other teams' chairs (your own team's items are left out, but for upsets)
for n, slug in enumerate([e["team"] for e in real["polls"][str(min(cw, 14))]["ap"][:3]] + ["usc", "texas"]):
    st = copy.deepcopy(real); st["team"] = slug
    scenario(f"as {slug}", st, base=real)


# 3. results turned over: every third game between FBS teams goes to the loser, some in overtime
def flipped(k, off):
    st = copy.deepcopy(real)
    for i, g in enumerate(fbs_played):
        if i % k == off:
            cg = st["games"][g["event_id"]]
            cg["home_score"], cg["away_score"] = cg["away_score"], cg["home_score"]
            if i % 2:
                cg["overtime"] = 1 + i % 3
    return st


for k, off in ((3, 0), (3, 1), (2, 0), (5, 2)):
    scenario(f"results turned over {k}/{off}", flipped(k, off), base=real)


# 4. the polls shuffled: the top teams trade places, a poll goes missing, a top-5 team falls out of the poll
def shuffled(seed, top):
    rng = random.Random(f"news-polls-{seed}")
    st = copy.deepcopy(real)
    for w, p in st["polls"].items():
        ap = p.get("ap") or []
        if w == "0" or not ap:
            continue
        names = [e["team"] for e in ap[:top]]
        rng.shuffle(names)
        for e, t in zip(ap[:top], names):
            e["team"] = t
        if rng.random() < 0.3:
            del ap[rng.randrange(0, 5)]          # a top-5 team out of the poll altogether (a rank is skipped)
    gone = [w for w in st["polls"] if w not in ("0", "1")]
    if len(gone) > 5:
        del st["polls"][gone[2]]["ap"]           # a week with no AP poll
        st["polls"][gone[4]] = {}                # and one with no poll at all
    return st


for sd, top in ((1, 8), (2, 3), (3, 12), (4, 25)):
    scenario(f"polls shuffled {sd}", shuffled(sd, top), base=real)


# 5. big stat lines written into the boxes
def stat_boxes(seed, chance):
    rng = random.Random(f"news-stats-{seed}")
    out_ = {}
    for eid, b in boxes0.items():
        b = copy.deepcopy(b)
        hit = False
        for side in ("home", "away"):
            players = (b.get(side) or {}).get("players") or []
            for _ in range(2):
                if not players or rng.random() > chance:
                    continue
                p = rng.choice(players)
                if p.get("stats") is None:
                    p["stats"] = {}
                st = p["stats"]
                what = rng.choice(("pass", "rush", "tds", "sacks", "half", "mix", "none"))
                if what == "pass":
                    st["pass_yards"] = rng.randint(380, 560)
                elif what == "rush":
                    st["rush_yards"] = rng.randint(190, 330)
                elif what == "tds":
                    st["passing_touchdowns"] = rng.randint(0, 4); st["rushing_touchdowns"] = rng.randint(0, 3); st["receiving_touchdowns"] = rng.randint(0, 2)
                elif what == "sacks":
                    st["sacks"] = rng.choice((3, 4, 5, 2))
                elif what == "half":
                    st["sacks"] = rng.choice((2.5, 3.5, 4.5, 3.0, 5.0))
                elif what == "mix":
                    st["pass_yards"] = rng.randint(300, 480); st["rush_yards"] = rng.randint(150, 260); st["sacks"] = None
                else:
                    p["stats"] = None
                hit = True
        if hit:
            out_[eid] = b
    return out_


for sd, ch in ((1, 0.5), (2, 0.9), (3, 0.2)):
    scenario(f"big stat lines {sd}", real, boxes=stat_boxes(sd, ch), base=real)


# 6. quarterbacks hurt: starters and backups, a week to a season, every kind of injury word
def hurt_boxes(seed):
    rng = random.Random(f"news-hurt-{seed}")
    out_ = {}
    for eid, b in boxes0.items():
        if rng.random() > 0.6:
            continue
        b = copy.deepcopy(b)
        for side in ("home", "away"):
            sd = b.get(side)
            if not sd:
                continue
            qbs = [p for p in sd.get("players") or [] if p.get("position") == "QB"]
            others = [p for p in sd.get("players") or [] if p.get("position") != "QB"]
            inj = list(sd.get("injuries") or [])
            for p in qbs:
                if rng.random() < 0.7:
                    e = {"name": p["name"], "position": "QB", "weeks": rng.choice((0, 1, 1, 2, 3, 5, 9, 10, 14, None)),
                         "type": rng.choice(("ankle sprain", "back spasms", "concussion", "torn ACL", "illness", "stress", "upper-body injury", "", None, "shoulder strain"))}
                    if rng.random() < 0.15:
                        del e["type"]
                    inj.append(e)
            if others and rng.random() < 0.5:
                inj.append({"name": rng.choice(others)["name"], "position": "WR", "weeks": 4, "type": "hamstring strain"})
            if rng.random() < 0.2:
                inj.append({"name": "Nobody Here", "position": "QB", "weeks": 3, "type": "knee sprain"})
            sd["injuries"] = inj if rng.random() < 0.95 else None
        out_[eid] = b
    return out_


for sd in (1, 2, 3):
    scenario(f"quarterbacks hurt {sd}", real, boxes=hurt_boxes(sd), base=real)


# 7. winning streaks: a few teams win every game up to a week, then lose
def streaks(seed, how_many):
    rng = random.Random(f"news-streak-{seed}")
    st = copy.deepcopy(real)
    for slug in rng.sample(sorted(fbs), how_many):
        mine = sorted((g for g in st["games"].values() if g.get("played") and slug in (g["home"], g["away"])), key=lambda g: g["week"])
        stop = rng.randint(7, 12)
        for i, g in enumerate(mine):
            won = (g["home_score"] > g["away_score"]) == (g["home"] == slug)
            if (i < stop) != won:
                g["home_score"], g["away_score"] = g["away_score"], g["home_score"]
            if i == stop and rng.random() < 0.5:
                g["overtime"] = 1
    return st


for sd, k in ((1, 12), (2, 30), (3, 60)):
    scenario(f"winning streaks {sd}", streaks(sd, k), base=real)


# 8. recruiting lines of every kind, written into the log
def recruiting(seed, per_week):
    rng = random.Random(f"news-recruits-{seed}")
    st = copy.deepcopy(real)
    rc = st["recruiting"]
    pids = sorted(rc["prospects"])
    by_stars = {n: [p for p in pids if rc["prospects"][p].get("stars") == n] for n in (2, 3, 4, 5)}
    schools = sorted(fbs)
    fict = sorted(s for s in teams if s not in fbs)
    states = sorted({t.get("state") for t in teams.values() if t.get("state")})
    log = rc["log"]
    for w in range(1, cw + 2):
        for _ in range(per_week):
            stars = rng.choice((5, 5, 5, 4, 4, 3, 2))
            pid = rng.choice(by_stars[stars] or pids)
            p = rc["prospects"][pid]
            school = rng.choice(schools)
            kind = rng.choice(("commit", "commit", "flip", "bloomed", "pro", "twist", "twist", "hat", "hat", "offer", "decommit"))
            e = {"week": w, "kind": kind, "pid": pid, "school": school}
            r = rng.random()
            if r < 0.08:
                e["school"] = rng.choice(fict)
            elif r < 0.12:
                e["school"] = None
            elif r < 0.15:
                e["school"] = "not-a-school"
            if kind == "hat":
                e["school"] = None
                e["finalists"] = rng.sample(schools, rng.choice((1, 2, 2, 3, 3, 4))) + (["not-a-school"] if rng.random() < 0.2 else []) + ([rng.choice(fict)] if rng.random() < 0.2 else [])
                if rng.random() < 0.1:
                    e["finalists"] = None
                e["day"] = rng.choice((w + 1, 5, 9, 14, 15, 16, 17, 18, 19, 20, 21))
            elif kind == "twist":
                e["twist"] = rng.choice(("late_offer", "late_offer", "surprise", "surprise", "cooled", None))
                if rng.random() < 0.15:
                    e["end"] = True
                if rng.random() < 0.1:
                    del e["twist"]
            elif kind == "flip":
                e["from"] = rng.choice(schools + fict[:1] + ["not-a-school", None])
            elif kind == "commit":
                if rng.random() < 0.25:
                    e["hat"] = True
                if rng.random() < 0.5:           # a hometown hero, his home state the school's or another
                    home = teams[school].get("state") if rng.random() < 0.5 else rng.choice(states)
                    p["persona"] = {**(p.get("persona") or {}), "story": "hero", "story_data": {"state": home}}
                elif rng.random() < 0.3:
                    p["persona"] = {**(p.get("persona") or {}), "story": rng.choice(("legacy", "package", "bloomer", None)), "story_data": {}}
            r = rng.random()
            if r < 0.06:
                e["quiet"] = True
            elif r < 0.12:
                e["private"] = True
            elif r < 0.15:
                e["pid"] = "r-nobody"
            elif r < 0.17:
                del e["pid"]
            log.append(e)
    if seed == 3:                                # a late bloomer who has jumped: his stars changed since the class was drawn
        for pid in by_stars[3][:40]:
            rc["prospects"][pid]["stars"] = rng.choice((4, 5, 3, None))
    return st


for sd, k in ((1, 12), (2, 30), (3, 30), (4, 6)):
    scenario(f"recruiting lines {sd}", recruiting(sd, k), base=real)

# 9. everything at once, from another chair; and a season with no recruiting at all
st = recruiting(9, 20)
f = flipped(4, 1); st["games"] = streaks(9, 20)["games"]
for eid, g in f["games"].items():
    if g["home_score"] != real["games"][eid]["home_score"]:
        st["games"][eid] = g
st["polls"] = shuffled(9, 10)["polls"]
st["team"] = "georgia"
scenario("everything at once", st, boxes={**stat_boxes(9, 0.6), **hurt_boxes(9)}, base=real)
st = copy.deepcopy(real); st["recruiting"] = None; st["recruiting_none"] = True
BOXES = boxes0
news._cache.clear()
rec = {"name": "no recruiting", "set": {"recruiting_none": True}, "boxes": {}}
del st["recruiting_none"]
rec["answers"] = answers(st)
n_scen += 1
(out / f"scenario_{n_scen:02d}.json").write_text(json.dumps(rec))
index.append({"name": "no recruiting", "file": f"scenario_{n_scen:02d}.json", "items": 0})
st = copy.deepcopy(real); st["year"] = 2031; st["id"] = "another-id"; st["current_week"] = max(1, cw // 2)
scenario("a later year, half the weeks", st, base=real)

(out / "index.json").write_text(json.dumps({"scenarios": index, "current_week": cw, "team": team, "seed": seed}))
print(len(index), "scenarios")
