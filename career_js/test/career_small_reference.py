"""Python's answers for career_js/clear.js, ability_goals.js, promises.js, grades.js, word.js, office.js and career.js,
written as JSON for career_small_compare.mjs to hold the JavaScript to:

    python3 career_js/test/career_small_reference.py OUT [--weeks N] && node career_js/test/career_small_compare.mjs OUT

It plays one real career in Clear Mode for two seasons (Ohio State, seed 9: 2026, the offseason, 2027 with starting
roles promised), a few minutes in all, and writes:

- every `ability_goals.after_game` call of both seasons (the game, its players' lines, its moments, what it returned)
  and the state's ability dicts after every week (ag_<season>_<week>.json);
- cases for the other functions (cases_<group>.jsonl): the slice of the state a function reads, its arguments, the
  answer, and the answers of every call it made into a module that is not ported (the season, recruiting, persona,
  offseason, programs, carousel), in the order made, for the Node script to replay as stubs.

`--weeks N` stops each season after N weeks (a quick run).
"""
import base64
import copy
import gzip
import hashlib
import json
import os
import random
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))
out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
WEEKS = int(sys.argv[sys.argv.index("--weeks") + 1]) if "--weeks" in sys.argv else 99
os.environ["CFP_SEASONS_DIR"] = tempfile.mkdtemp()
os.environ["SIM_WORKERS"] = "1"
os.environ.pop("CFP_CLEAR", None)

from canon import canon                                                            # noqa: E402
from coach_career import (ability_goals, career, carousel, clear, coach_names, grades, office, offseason, persona,   # noqa: E402
                          programs, promises, prospects, recruiting, word)
from sim import season                                                             # noqa: E402

ME = "ohio-state"
SEED = 9

# ----- the recorder: what a function under test asked of the modules that are not ported ---------------------------------

BLOBS = {}          # big answers (the league's teams), kept once by their hash


class Rec:
    log = None      # {"module.function": [answers in the order asked]} while a function under test runs
    depth = 0       # inside a recorded function: what it asks in turn is its own business
    busy = False    # inside a captured call: a nested captured call is part of it


def keep(value):
    text = json.dumps(canon(value))
    if len(text) < 4000:
        return json.loads(text)
    h = hashlib.sha1(text.encode()).hexdigest()[:16]
    BLOBS.setdefault(h, json.loads(text))
    return {"$blob": h}


def patch(mod, name, slim=lambda r: r):
    orig = getattr(mod, name)
    label = f"{mod.__name__.split('.')[-1]}.{name}"

    def wrapped(*a, **k):
        Rec.depth += 1
        try:
            r = orig(*a, **k)
        finally:
            Rec.depth -= 1
        if Rec.log is not None and Rec.depth == 0:
            Rec.log.setdefault(label, []).append(keep(slim(r)))
        return r
    wrapped.__wrapped__ = orig
    setattr(mod, name, wrapped)


def slim_teams(teams):
    row = lambda p: {"name": p["name"], "position": p["position"], "slug": p.get("slug")}
    return {s: {"conference": t["conference"], "fictional": t["fictional"], "offense": [row(p) for p in t.get("offense", [])],
                "defense": [row(p) for p in t.get("defense", [])]} for s, t in teams.items()}


def slim_team_data(t):
    return {"coaches": {"head_coach": ((t.get("coaches") or {}).get("head_coach"))}} if isinstance(t, dict) else t


def slim_preview(t):
    row = lambda p: {"slug": p.get("slug"), "name": p.get("name"), "in_game": p.get("in_game")}
    return {"offense": [row(p) for p in t["offense"]], "defense": [row(p) for p in t["defense"]]}


patch(season, "load_teams", slim_teams)
patch(season, "team_data", slim_team_data)
patch(season, "_preview_team", slim_preview)
for n in ("team_display", "standings", "season_year", "rivalry_for", "rank_map"):
    patch(season, n)
for n in ("read_spread", "report_complete", "report_looks", "lost_reason", "_group_of", "start", "make_staff"):
    patch(recruiting, n)
for n in ("shown_to", "of", "draw"):
    patch(persona, n)
patch(offseason, "house")
patch(carousel, "goal")
patch(coach_names, "distinct", lambda r: None)


def run(fn, *args):
    """fn(*args) with what it asked recorded: (answer, calls). An exception is answered as {"$raise": its text}."""
    Rec.log, Rec.busy = {}, True
    try:
        try:
            r = fn(*args)
        except ValueError as exc:
            r = {"$raise": str(exc)}
        return r, Rec.log
    finally:
        Rec.log, Rec.busy = None, False


FILES = {}


def write(group, case):
    f = FILES.get(group) or FILES.setdefault(group, open(out / f"cases_{group}.jsonl", "w"))
    f.write(json.dumps(canon(case)) + "\n")


STATES = set()


def state_text(d):
    """A state's slice, kept once as its own JSON text in states.jsonl (the Node script reads `games` back in the text's
    order); a case names it by its hash."""
    text = json.dumps(canon(d))
    h = hashlib.sha1(text.encode()).hexdigest()[:16]
    if h not in STATES:
        STATES.add(h)
        f = FILES.get("$states") or FILES.setdefault("$states", open(out / "states.jsonl", "w"))
        f.write(json.dumps({"id": h, "text": text}) + "\n")
    return {"$state": h}


# ----- the slices of the state the functions read ------------------------------------------------------------------------

def league_slice(st):
    lgd = st.get("league")
    if not lgd:
        return None
    me = st.get("team")
    keep_row = lambda c: {k: c[k] for k in ("id", "persona", "promised", "pos", "n", "o", "s") if k in c}
    return {"teams": {s: {"roster": [keep_row(c) for c in t.get("roster") or () if s == me or (c.get("persona") or {}).get("personality")]}
                      for s, t in lgd["teams"].items()}}


def base_slice(st):
    me = st["team"]
    d = {k: st[k] for k in ("team", "year", "current_week", "conference", "champion", "champions", "mode", "id", "done", "polls",
                            "career", "games", "promises", "promise_strain") if k in st}
    d["injuries"] = {me: (st.get("injuries") or {}).get(me) or {}}
    lg = league_slice(st)
    if lg:
        d["league"] = lg
    return d


def office_slice(st):
    me, week = st["team"], st["current_week"]
    d = base_slice(st)
    rc = st.get("recruiting") or {}
    log = [e for e in rc.get("log") or [] if e["week"] > week - office.NEWS_WEEKS]
    pids = {e["pid"] for e in log}
    d["recruiting"] = {"board": rc.get("board") or [], "offers": {me: (rc.get("offers") or {}).get(me, [])}, "log": log,
                       "prospects": {pid: {k: p.get(k) for k in ("name", "position", "stars", "rank")}
                                     for pid, p in (rc.get("prospects") or {}).items() if pid in pids}}
    d["ability_events"] = [e for e in st.get("ability_events") or [] if e["team"] == me]
    return d


# ----- ability goals: every after_game call of the season ----------------------------------------------------------------

AG = {"calls": [], "base": {}, "label": None}
_after_game = ability_goals.after_game


def after_game(state, g, lines, moments, base_traits):
    for t, b in base_traits.items():
        text = json.dumps(b)
        assert AG["base"].setdefault(t, text) == text, f"{t}'s own abilities changed inside a season"
    call = json.loads(json.dumps({"g": g, "lines": {s: {"players": (lines.get(s) or {}).get("players")} for s in ("home", "away")},
                                  "moments": moments}))
    made = _after_game(state, g, lines, moments, base_traits)
    call["made"] = copy.deepcopy(made)
    AG["calls"].append(call)
    return made


ability_goals.after_game = after_game
AB_KEYS = ("ability_goals", "abilities_earned", "ability_upgrades", "ability_events")


def ag_start(label, st):
    AG.update(calls=[], base={}, label=label)
    (out / f"ag_{label}_start.json").write_text(json.dumps(canon({"year": st.get("year"), **{k: st[k] for k in AB_KEYS if k in st}})))


def ag_week(st, n):
    (out / f"ag_{AG['label']}_{n:02d}.json").write_text(json.dumps(canon({
        "calls": AG["calls"], "base": {t: json.loads(b) for t, b in AG["base"].items()},
        "after": {k: st.get(k) for k in AB_KEYS}})))
    AG["calls"] = []
    AG["base"] = {}        # sent once: the Node script keeps what it has seen


# ----- cases, a week at a time -------------------------------------------------------------------------------------------

def ability_views(st, label):
    teams = season.load_teams.__wrapped__()
    rng = random.Random(f"views-{label}")
    picks = [ME] + rng.sample([s for s in (st.get("ability_goals") or {}) if s != ME], 3)
    for team in picks:
        sl = {"year": st.get("year"), **{k: {team: (st.get(k) or {}).get(team) or {}} for k in AB_KEYS[:3]}}
        players = []
        for p in teams[team]["offense"] + teams[team]["defense"]:
            key = f"{p['name']}|{p['position']}"
            base = {x["key"]: x["tier"] for x in p.get("traits") or [] if isinstance(x, dict)}
            players.append({"key": key, "position": p["position"], "base": base, "traits": p.get("traits") or [],
                            "goal": ability_goals.goal_view(st, team, key, p["position"], base),
                            "ups": ability_goals.upgrades_view(st, team, key, base),
                            "merged": ability_goals.merged_traits(st, team, key, p.get("traits") or [])})
        write("ability", {"fn": "views", "label": label, "team": team, "state": sl, "players": players})
    sl = {"team": st["team"], "year": st.get("year"), "career": {"year": st["career"]["year"]},
          "ability_events": [e for e in st.get("ability_events") or [] if e["team"] == st["team"]]}
    r, calls = run(ability_goals.news, st)
    write("ability", {"fn": "news", "label": label, "state": sl, "calls": calls, "expect": r})


def clear_cases(st, label, pids):
    rc = st["recruiting"]
    for pid in pids:
        sl = {"team": st["team"], "career": {"staff": st["career"].get("staff")},
              "recruiting": {"attrs": rc.get("attrs"), "prospects": {pid: rc["prospects"].get(pid)}, "reads": {pid: rc["reads"].get(pid)}}}
        r, calls = run(clear.ratings, st, pid)
        write("clear", {"fn": "ratings", "label": label, "state": sl, "args": [pid], "calls": calls, "expect": r})
        p = rc["prospects"].get(pid)
        if not p:
            continue
        for group in ("athleticism", "potential", "coachability"):
            r, calls = run(clear.confidence, st, pid, group)
            write("clear", {"fn": "confidence", "state": sl, "args": [pid, group], "calls": calls, "expect": r})
    if pids and rc["prospects"].get(pids[0]):
        p = rc["prospects"][pids[0]]
        write("clear", {"fn": "_group_of_key", "keys": {k: clear._group_of_key(p, k) for ks in clear.KEYS.values() for k in ks}})


def weekly(st, label):
    """The read-only views after a week: the Office, grades' eye, the promises' chips."""
    for fn in (office.program_news, office.conference_view, office.office_view):
        r, calls = run(fn, st)
        write("office", {"fn": fn.__name__, "label": label, "state": state_text(office_slice(st)), "calls": calls, "expect": r})
    for fn in (grades.eye, grades.fine):
        r, calls = run(fn, st)
        write("grades", {"fn": fn.__name__, "label": label, "state": {"team": st["team"], "career": {"staff": st["career"].get("staff")}},
                         "calls": calls, "expect": r})
    if st.get("league"):
        year = season.season_year.__wrapped__(st)
        sl = state_text(base_slice(st))
        for fn, args in ((promises.promised_now, ()), (promises.chips_now, ()), (promises.tags_now, ()), (promises.news, ()),
                         (promises.bands, (year,)), (promises.is_big, (st["team"], st["current_week"])),
                         (promises.is_big, (st["team"], st["current_week"] + 1)), (word.view, ()), (word.apply_bands, (year,))):
            before = copy.deepcopy(st.get("career"))
            r, calls = run(fn, st, *args)
            case = {"fn": fn.__name__, "label": label, "state": sl, "args": list(args), "calls": calls, "expect": r}
            if fn is word.apply_bands:
                case["after"] = copy.deepcopy(st["career"].get("word"))
                st["career"] = before                     # a look at what the year would do to the word, not the year's own
            write("word" if fn.__module__.endswith("word") else "promises", case)


# ----- promises: the weekly snapshot, as the season makes it -------------------------------------------------------------

_snapshot_week = promises.snapshot_week


def snapshot_week(state, week):
    if Rec.busy:
        return _snapshot_week(state, week)
    sl = state_text(base_slice(state))
    r, calls = run(_snapshot_week, state, week)
    write("promises", {"fn": "snapshot_week", "state": sl, "args": [week], "calls": calls, "expect": r,
                       "after": copy.deepcopy(state.get("promises"))})
    # and the same week again: nothing new
    sl = state_text(base_slice(state))
    r, calls = run(_snapshot_week, state, week)
    write("promises", {"fn": "snapshot_week", "state": sl, "args": [week], "calls": calls, "expect": r,
                       "after": copy.deepcopy(state.get("promises"))})


promises.snapshot_week = snapshot_week


# ----- the offseason's own calls: carry_over, ceiling_drift ---------------------------------------------------------------

_carry_over = ability_goals.carry_over


def carry_over(state, lgd):
    sl = {k: copy.deepcopy(state.get(k)) for k in AB_KEYS[:3] if k in state}
    rows = lambda: {s: {"roster": [{"id": c.get("id"), **({"ab": list(c["ab"])} if "ab" in c else {})} for c in t.get("roster") or []]}
                    for s, t in (lgd.get("teams") or {}).items()}
    before = rows()
    r, calls = run(_carry_over, state, lgd)
    write("ability", {"fn": "carry_over", "state": sl, "lgd": {"teams": before}, "calls": calls, "expect": r,
                      "after": {"teams": rows()}, "state_keys": [k for k in AB_KEYS if k in state]})
    return r


ability_goals.carry_over = carry_over
_ceiling_drift = clear.ceiling_drift
DRIFT = {"n": 0}


def ceiling_drift(p, attrs, perf, year, physical):
    DRIFT["n"] += 1
    if DRIFT["n"] > 6000:
        return _ceiling_drift(p, attrs, perf, year, physical)
    case = {"fn": "ceiling_drift", "p": {"id": p["id"], "c": p.get("c"), "g": list(p["g"]), "r": list(p["r"])}, "perf": copy.deepcopy(perf),
            "year": year, "physical": sorted(physical)}
    if DRIFT["n"] == 1:
        write("clear", {"fn": "attrs", "attrs": list(attrs)})
    r = _ceiling_drift(p, attrs, perf, year, physical)
    case.update(expect=r, g_after=list(p["g"]), struggled=clear.struggled(perf))
    write("clear", case)
    return r


clear.ceiling_drift = ceiling_drift


# ----- cases that need no season ------------------------------------------------------------------------------------------

def synthetic():
    rng = random.Random("career-small")
    # next_goal: positions, what he holds, his key
    positions = sorted(ability_goals.POS_GROUP) + ["ATH", "LS"]
    for i in range(1500):
        pos = rng.choice(positions)
        fits = list(ability_goals.FITS.get(ability_goals.POS_GROUP.get(pos, pos), ())) + ["natural_talent", "made_up"]
        held = {t: rng.randint(0, 4) for t in rng.sample(fits, rng.randint(0, min(6, len(fits))))}
        key = f"Player {rng.randint(1, 400)}|{pos}"
        write("ability", {"fn": "next_goal", "args": [pos, held, key], "expect": ability_goals.next_goal(pos, held, key)})
    write("ability", {"fn": "next_goal", "args": ["QB", {}], "expect": ability_goals.next_goal("QB", {})})
    for i in range(3000):
        p = {"id": f"r{rng.randint(2027, 2030)}-{i:04d}", "stars": rng.choice([1, 2, 3, 4, 5, None, 0]), "ea_position": rng.choice(positions + [None]),
             "position": rng.choice(positions)}
        if rng.random() < 0.1:
            del p["stars"]
        write("ability", {"fn": "recruit_abilities", "args": [p], "expect": ability_goals.recruit_abilities(p),
                          "field": ability_goals.recruit_ab_field(p)})
    # the unit test's own cases (tests/test_ability_goals.py)
    g = {"home": "ohio-state", "away": "michigan", "week": 3, "event_id": "e1"}
    for st, lines, moments in (
            ({"year": 2026, "ability_goals": {"ohio-state": {"A B|S": {"trait": "route_jumper", "tier": 1, "have": 1, "since": [2026, 1]}}}},
             {"home": {"players": [{"name": "A B", "position": "S", "stats": {"interceptions": 1}}]}, "away": {"players": []}}, {}),
            ({"year": 2026, "ability_goals": {"ohio-state": {"K K|K": {"trait": "ice_water", "tier": 1, "have": 0, "since": [2026, 1]}}}},
             {"home": {"players": [{"name": "K K", "position": "K", "stats": {}}]}}, {"home": {"K K|K": {"clutch_kick": 1}}}),
            ({}, {"home": {"players": [{"name": "O L", "position": "LT", "stats": {"games_started": 1, "pressures_allowed": 1, "snaps": 70}}]},
                  "away": {"players": [{"name": "X Y", "position": "ATH", "stats": {"games_started": 1}}]}}, None)):
        for neutral in (False, True):
            s2 = copy.deepcopy(st)
            gg = dict(g, neutral=neutral)
            base = {"ohio-state": {"O L|LT": {"road_grader": 3, "iron_horse": 4, "pocket_protector": 1}}}
            made = _after_game(s2, gg, lines, moments, base)
            write("ability", {"fn": "after_game", "state": st, "args": [gg, lines, moments, base], "expect": made, "after": s2})

    # promises: the score, the band, the chip, the leave chance on made-up seasons
    kinds = ["default", "cocky", "shy", "attention", "business", "guarded", "homebody"]
    spots = sorted(offseason.GROUP) + ["ATH"]
    for i in range(3000):
        n = rng.choice([0, 1, 2, 3, 5, 8, 12, 13, 15])
        ws = [{"week": w + 1, "started": rng.random() < rng.choice([0.2, 0.6, 0.9]), "injured": rng.random() < 0.12, "big": rng.random() < 0.3}
              for w in range(n)]
        pos, kind, strain = rng.choice(spots), rng.choice(kinds), rng.choice([0, 0, 0, 1, 2])
        s = promises.score(ws, pos, kind, strain)
        b = promises.band(s, kind)
        info = {"benched_big": promises.benched_big(ws), "personality": kind}
        cls = rng.choice(sorted(promises.LEAVE) + ["GR"])
        write("promises", {"fn": "score", "args": [ws, pos, kind, strain], "expect": s, "band": b, "chip": promises.chip(b),
                           "benched_big": info["benched_big"], "cls": cls, "leave": promises.leave_chance(cls, pos, info),
                           "nil": promises.nil_mult(kind), "group": promises._group(pos),
                           "plain": promises.score(ws, pos, kind)})
    for s in (None, 0.0, 0.25, 0.35, 0.3499, 0.5, 0.6, 0.75, 1.0):
        for kind in kinds:
            write("promises", {"fn": "band", "args": [s, kind], "expect": promises.band(s, kind)})
    st = {}
    for i in range(40):
        year, slug = rng.choice([2027, 2028]), rng.choice(["a-b", "c-d", "e-f"])
        promises.add_strain(st, year, slug)
        write("promises", {"fn": "add_strain", "args": [year, slug], "after": copy.deepcopy(st),
                           "strain": {f"{y}|{s}": promises.strain(st, y, s) for y in (2027, 2028) for s in ("a-b", "c-d", "e-f", "g-h")}})
    for i in range(30):
        row = rng.choice([{}, {"persona": {"decider": "mom"}}, {"persona": None}, {"promised": 2026, "persona": {"personality": "shy"}}])
        row = copy.deepcopy(row)
        year, kind = rng.choice([2027, 2028]), rng.choice([None, "", "cocky", "guarded"])
        before = copy.deepcopy(row)
        promises.mark_promised(row, year, kind)
        write("promises", {"fn": "mark_promised", "row": before, "args": [year, kind], "after": row})
    write("promises", {"fn": "record", "state": {}, "expect": promises.record({}), "seen": promises._seen({})})

    # grades: every potential, plain and fine; the order; a read's two ends
    for i in range(0, 400):
        v = i / 4
        write("grades", {"fn": "letter", "args": [v], "expect": [grades.letter(v), grades.letter(v, True)]})
    for v in (-5, 0, 99, 99.5, 120, 45.5, 61.49999):
        write("grades", {"fn": "letter", "args": [v], "expect": [grades.letter(v), grades.letter(v, True)]})
    write("grades", {"fn": "order", "expect": list(grades.ORDER), "place": {g: grades.place(g) for g in list(grades.ORDER) + ["E", "A++", ""]}})
    for i in range(600):
        lo, hi, fine = rng.uniform(0, 99), rng.uniform(0, 99), rng.random() < 0.5
        sp = grades.span(lo, hi, fine)
        write("grades", {"fn": "span", "args": [lo, hi, fine], "expect": sp, "sort_key": grades.sort_key(sp)})

    # the word: runs of kept and broken promises, offseasons, and what is read off it
    events = sorted(word.GAIN) + sorted(word.COST)
    groups = sorted(word.GROUP_NAMES) + ["", "ATH"]
    for i in range(400):
        st = rng.choice([{}, {"career": {}}, {"career": {"word": {"overall": rng.choice([70, 12.5, 96]), "by_group": {}, "log": []}}},
                         {"career": {"word": {"overall": 40.0}}}, {"season_year": 2031}])
        st = copy.deepcopy(st)
        st["year"] = rng.choice([2027, 2028, 2030])
        steps = []
        start = copy.deepcopy(st)
        for j in range(rng.randint(1, 30)):
            op = rng.choice(["apply"] * 6 + ["recover", "recover_year", "bad"])
            if op == "apply":
                args = [rng.choice(events), rng.choice(groups), rng.choice(["A Player", "", "Bo O'Neil"]), rng.random() < 0.3,
                        rng.choice(["", "guarded", "cocky"])]
                r, calls = run(word.apply, st, *args)
            elif op == "bad":
                args = [rng.choice(["nothing", "it's", 'say "no"', "a\\b"]), "QB", "X"]
                r, calls = run(word.apply, st, *args)
                op = "apply"
            elif op == "recover":
                args = []
                r, calls = run(word.recover, st)
            else:
                args = [rng.choice([2027, 2028])]
                r, calls = run(word.recover, st, *args)
                op = "recover"
            g = rng.choice(groups)
            pm_args = [None, g, rng.choice([None, "guarded", "cocky"]), rng.choice([None, "playing_time", "nil"])]
            read = {"reading": word.reading(st), "reading_g": word.reading(st, g), "g": g, "believes": word.believes(st, g),
                    "last_broken": word.last_broken(st, g), "view": word.view(st), "pm_args": pm_args, "promise_mult": word.promise_mult(st, *pm_args),
                    "seen": copy.deepcopy(word._seen(st))}
            steps.append({"op": op, "args": args, "calls": calls, "expect": r, "read": read})
        write("word", {"fn": "run", "state": start, "steps": steps, "after": st})
    for v in [x / 2 for x in range(0, 201)]:
        write("word", {"fn": "word_text", "args": [v], "expect": word.word_text(v), "clamp": [word._clamp(v - 20), word._clamp(v + 20)]})
    for e in ({"kind": "kept", "name": "A", "group": "QB"}, {"kind": "bent", "name": "", "group": "QB"}, {"kind": "broken", "group": ""},
              {"kind": "money_broken", "name": None}, {"kind": "package_kept", "name": "Z", "group": None}):
        write("word", {"fn": "_line", "args": [e], "expect": word._line(e)})

    # a career's shape, and which of two copies is the newer
    for i in range(300):
        a = {"id": "x", "career": {"saved_week": rng.choice([0, 3, 3, 9]), "saved_at": rng.choice(["2026-11-01T10:00:00+00:00", "2026-11-02T08:30:00+00:00"])}}
        b = {"id": "x", "career": {"saved_week": rng.choice([0, 3, 3, 9]), "saved_at": rng.choice(["2026-11-01T10:00:00+00:00", "2026-11-02T08:30:00+00:00"])}}
        if rng.random() < 0.15:
            del b["career"][rng.choice(["saved_week", "saved_at"])]
        write("career", {"fn": "newer", "args": [a, b], "expect": "b" if career.newer(a, b) is b else "a"})
    for coach in (None, {}, {"id": "c1", "first_name": "  Ann ", "last_name": "Lee"}, {"id": 4, "first_name": "Bo"}, {"last_name": "Diaz "},
                  {"id": "c2", "first_name": None, "last_name": "Ng"}, {"id": "c3", "first_name": "", "last_name": ""}):
        o_start, o_staff = recruiting.start, recruiting.make_staff
        recruiting.start, recruiting.make_staff = (lambda s: None), (lambda s: [{"role": "OC", "name": "Staff One", "evaluation": 61}])
        patch(recruiting, "start")
        patch(recruiting, "make_staff")
        st = {"id": "abc", "team": ME}
        r, calls = run(career.new_career, st, coach)
        recruiting.start, recruiting.make_staff = o_start, o_staff
        write("career", {"fn": "new_career", "args": [coach], "calls": calls, "expect": r, "after": st, "is_career": career.is_career(st),
                         "is_career_plain": career.is_career({"id": "abc"})})


def shapes(st):
    """_looks_like_career on the real career and on copies broken one way each."""
    rng = random.Random("shapes")
    small = {k: st[k] for k in ("id", "team", "mode", "current_week", "career")}
    small.update(games={"1": {}}, recruiting={"seed": 1})
    breaks = [lambda s: None, lambda s: s.pop("career"), lambda s: s.update(career=[]), lambda s: s["career"].pop("saved_at"),
              lambda s: s["career"].pop("year"), lambda s: s.update(mode="remaining"), lambda s: s.update(team="nowhere-state"),
              lambda s: s.update(team=None), lambda s: s.update(games=[]), lambda s: s.update(recruiting=None),
              lambda s: s.update(current_week="3"), lambda s: s.update(current_week=True), lambda s: s.update(id="../x"),
              lambda s: s.update(id=""), lambda s: s.pop("id"), lambda s: s.update(id=12), lambda s: s.update(id=None),
              lambda s: s.update(id="a b"), lambda s: s.update(id="été٣"), lambda s: s.update(team="nowhere-state", league={"teams": {"nowhere-state": {}}}),
              lambda s: s.update(team="nowhere-state", league={"teams": ["nowhere-state"]}), lambda s: s.update(league="x"),
              lambda s: s.update(team="constructor"), lambda s: s.update(current_week=None)]
    for brk in breaks:
        s = copy.deepcopy(small)
        brk(s)
        r, calls = run(career._looks_like_career, s)
        write("career", {"fn": "_looks_like_career", "state": s, "calls": calls, "expect": r, "own_teams": sorted(career._own_teams(s))})
    for s in (None, [], "x", 5):
        r, calls = run(career._looks_like_career, s)
        write("career", {"fn": "_looks_like_career", "state": s, "calls": calls, "expect": r})


def saves(st, label):
    """A real save, packed by Python, for the JavaScript to read; what Python reads back from it; and blobs that are
    not saves."""
    box_dir = season.box_dir(st)
    names = sorted(p.name for p in box_dir.glob("*.json"))[:25] if box_dir.exists() else []
    keep_dir = tempfile.mkdtemp()
    # a save of a few box scores (a whole season's is 900 files): the others set aside for the moment
    moved = []
    if box_dir.exists():
        for p in sorted(box_dir.glob("*.json")):
            if p.name not in names:
                p.rename(Path(keep_dir) / p.name)
                moved.append(p.name)
    try:
        for boxes in ((True,) if label == "2026" else (False,)):
            blob = career.export_save(st, boxes)
            (state, files), calls = run(career.read_save, blob)
            write("career", {"fn": "save", "label": label, "boxes": boxes, "blob": base64.b64encode(blob).decode(),
                             "calls": calls,
                             "box_files": {n: (box_dir / n).read_text(encoding="utf-8") for n in names} if boxes else {},
                             "state_id": state["id"], "box_names": sorted(files)})
    finally:
        for n in moved:
            (Path(keep_dir) / n).rename(box_dir / n)
    small = {k: st[k] for k in ("id", "team", "mode", "current_week", "career")}
    small.update(games={"401856682": {"week": 1}, "12": {"week": 2}, "b": {"week": 3}}, recruiting={"seed": 1}, my_boxes={"9": 1, "3": 2})
    pack = lambda o: gzip.compress(json.dumps(o).encode("utf-8"))
    bad = {"not gzip": b"hello", "empty": b"", "not json": gzip.compress(b"{nope"), "a list": pack([1, 2]), "no state": pack({"boxes": {}}),
           "not a career": pack({"state": dict(small, mode="remaining")}), "boxes a list": pack({"state": small, "boxes": [1]}),
           "too many boxes": pack({"state": small, "boxes": {f"b{i}.json": "{}" for i in range(career.MAX_BOXES + 1)}}),
           "not utf-8": gzip.compress(b'{"state": "\xff"}'), "null": pack(None), "state null": pack({"state": None}),
           "fine": pack({"state": small, "boxes": {"401.json": "{}", "../x.json": "{}", "a b.json": "{}", "n.json": 5, "ok_1-2.json": "{\"a\": 1}", "x.txt": "t"}}),
           "fine, no boxes": pack({"state": small}), "fine, boxes null": pack({"state": small, "boxes": None})}
    for name, blob in bad.items():
        r, calls = run(career.read_save, blob)
        write("career", {"fn": "read_save", "name": name, "blob": base64.b64encode(blob).decode(), "calls": calls,
                         "expect": r if isinstance(r, dict) else [r[0], r[1]],
                         **({} if isinstance(r, dict) else {"order": [list(r[0]["games"]), list(r[0].get("my_boxes") or {})]})})
    # restore: the upload against the server's copy
    older = copy.deepcopy(small)
    older["career"] = dict(older["career"], saved_week=small["career"].get("saved_week", 0) - 1)
    later = copy.deepcopy(small)
    later["career"] = dict(later["career"], saved_week=small["career"].get("saved_week", 0) + 1)
    plain = {k: v for k, v in small.items() if k != "career"}
    other = dict(copy.deepcopy(later), id="zzz")
    blob = pack({"state": small, "boxes": {"77.json": "{\"box\": 1}"}})
    for name, current in (("forgotten", None), ("server older", older), ("server later", later), ("the same", copy.deepcopy(small)),
                          ("a plain season", plain), ("another id", other)):
        store = tempfile.mkdtemp()
        old = season.SEASONS_DIR
        season.SEASONS_DIR = Path(store)
        try:
            r, calls = run(career.restore, blob, current)
            files = {str(p.relative_to(store)): json.loads(p.read_text()) for p in sorted(Path(store).rglob("*")) if p.is_file()}
        finally:
            season.SEASONS_DIR = old
        write("career", {"fn": "restore", "name": name, "blob": base64.b64encode(blob).decode(), "current": current, "calls": calls,
                         "expect": r if isinstance(r, dict) and "$raise" in r else {"kept": "current" if r is current else "upload", "state": r},
                         "files": files})
    store = tempfile.mkdtemp()
    old, season.SEASONS_DIR = season.SEASONS_DIR, Path(store)
    try:
        r, calls = run(career.import_save, blob)
        files = {str(p.relative_to(store)): json.loads(p.read_text()) for p in sorted(Path(store).rglob("*")) if p.is_file()}
    finally:
        season.SEASONS_DIR = old
    write("career", {"fn": "import_save", "blob": base64.b64encode(blob).decode(), "calls": calls, "expect": r, "files": files})


def word_recruits(st):
    """A recruiting promise kept or broken, on the real class (your school's, and another's: nothing)."""
    rng = random.Random("word-recruits")
    rc = st["recruiting"]
    pids = rng.sample(sorted(rc["prospects"]), 120)
    kinds = ["money_kept", "package_kept", "money_broken", "package_broken", "recruit_broken"]
    keep_word = copy.deepcopy(st["career"].get("word"))
    for pid in pids + ["nobody"]:
        p = rc["prospects"].get(pid)
        sl = {"team": st["team"], "year": st.get("year"), "career": {"word": copy.deepcopy(st["career"].get("word"))} if st["career"].get("word") else {},
              "recruiting": {"prospects": {pid: {k: p.get(k) for k in ("stars", "portal", "tier", "name")}} if p else {}}}
        slug = st["team"] if rng.random() < 0.85 else "michigan"
        kind = rng.choice(kinds)
        r, calls = run(word.recruit_event, st, slug, pid, kind)
        g = rng.choice(sorted(word.GROUP_NAMES))
        r2, calls2 = run(word.promise_mult, st, pid, g)
        write("word", {"fn": "recruit_event", "state": sl, "args": [slug, pid, kind], "calls": calls, "expect": r,
                       "after": copy.deepcopy(st["career"].get("word")), "pm": {"args": [pid, g], "calls": calls2, "expect": r2}})
    if keep_word is None:
        st["career"].pop("word", None)
    else:
        st["career"]["word"] = keep_word


# ----- the career --------------------------------------------------------------------------------------------------------

def play(st, label):
    ag_start(label, st)
    n = 0
    while not st["done"] and n < WEEKS:
        st = season.advance(st, auto_recruit=True)
        n += 1
        ag_week(st, n)
        weekly(st, f"{label} week {n}")
        if n in (2, 7, 13):
            ability_views(st, f"{label} week {n}")
        if n in (1, 4, 9):
            rc = st["recruiting"]
            rng = random.Random(f"clear-{label}-{n}")
            pids = rng.sample(sorted(rc["reads"]), min(60, len(rc["reads"])))
            clear_cases(st, f"{label} week {n}", pids)
            # more looks at a few (the test's way: hours and points to spare), a case after each
            fresh = [q for q in sorted(rc["prospects"], key=lambda q: rc["prospects"][q]["rank"])[40:400]
                     if not rc["prospects"][q].get("hidden") and q in recruiting.visible(st)][:12]
            for pid in fresh:
                for _ in range(4):
                    rc["hours"][ME] = 100
                    rc["scout_points"] = {ME: 100}
                    try:
                        recruiting.act(st, ME, pid, "scout")
                    except Exception:
                        break
                    clear_cases(st, f"{label} week {n} scouted", [pid])
            clear_cases(st, f"{label} week {n} unread", [q for q in sorted(rc["prospects"]) if q not in rc["reads"]][:3] + ["nobody"])
        print(label, "week", n, flush=True)
    return st


synthetic()
st = season.new_season(ME, "full", seed=SEED, career=True)
write("ability", {"fn": "clear_on", "expect": clear.on()})
# every prospect of the real class: the abilities he arrives with
for pid, p in st["recruiting"]["prospects"].items():
    q = {k: p.get(k) for k in ("id", "stars", "ea_position", "position")}
    write("ability", {"fn": "recruit_abilities", "args": [q], "expect": ability_goals.recruit_abilities(p), "field": ability_goals.recruit_ab_field(p)})
shapes(st)
st = play(st, "2026")
saves(st, "2026")
word_recruits(st)

if st["done"]:
    offseason.start(st)
    offseason.run_all(st)
    st = offseason.next_season(st)
else:                                   # a quick run: the 2026 season made over, as the offseason's tests do
    import test_offseason
    test_offseason.finished(st)
    offseason.start(st)
    offseason.run_all(st)
    st = offseason.next_season(st)
print("2027", flush=True)

# starting roles promised for 2027: starters and bench players of every kind of personality, one with his job promised away twice
team = season._preview_team.__wrapped__(st, ME)
rows = team["offense"] + team["defense"]
roster = {c["id"]: c for c in st["league"]["teams"][ME]["roster"]}
starters = [p for p in rows if p.get("in_game") and p.get("slug") in roster]
bench = [p for p in rows if not p.get("in_game") and p.get("slug") in roster and p["position"] not in ("K", "P")]
qb = next((p for p in starters if p["position"] == "QB"), starters[0])
picks = [qb] + [p for p in starters if p is not qb][3:25:3] + bench[:5]
kinds = ["cocky", "shy", "attention", None, "guarded", "business"]
for i, p in enumerate(picks):
    promises.mark_promised(roster[p["slug"]], 2027, kinds[i % len(kinds)])
promises.mark_promised(roster[bench[6]["slug"]], 2028, "shy")             # one for next season
promises.add_strain(st, 2027, picks[1]["slug"])
promises.add_strain(st, 2027, picks[1]["slug"])
promises.add_strain(st, 2027, picks[-1]["slug"])
for other in ("michigan", "texas"):                                        # a promised player elsewhere: never yours to judge
    c = st["league"]["teams"][other]["roster"][0]
    promises.mark_promised(c, 2027, "cocky")
weekly(st, "2027 preseason")
st = play(st, "2027")
saves(st, "2027")
word_recruits(st)

(out / "setup.json").write_text(json.dumps(canon({
    "clear": clear.on(), "blobs": BLOBS,
    "recruiting": {"WORD_SLACK": recruiting.WORD_SLACK, "HISTORY_ONLY": list(recruiting.HISTORY_ONLY),
                   "JOB_STRAIN_SCORE": recruiting.JOB_STRAIN_SCORE, "PORTAL_TOP_TIER": recruiting.PORTAL_TOP_TIER},
    "offseason": {"GROUP": offseason.GROUP}, "programs": {"WORD_FLOORS": [list(x) for x in programs.WORD_FLOORS]},
    "prospects": {"GAME_GROUPS": {k: list(v) for k, v in prospects.GAME_GROUPS.items()}, "DISPLAY_POS": prospects.DISPLAY_POS},
    "season": {"SCALE_GROUP": season.SCALE_GROUP},
    "constants": {
        "clear": {k: getattr(clear, k) for k in ("CLEAR_CONFIDENCE", "KEYS", "PHYS_RATE", "SKILL_RATE", "CEIL_STRUGGLE", "CEIL_SOLID", "CEIL_SOLID_Z",
                                                 "CEIL_STRUGGLE_Z", "CEIL_SLOW", "CEIL_DRIFT_SD", "SLOW_LEVELS", "FAST_LEVELS")},
        "ability_goals": {k: getattr(ability_goals, k) for k in ("TIER_NAMES", "UPGRADES_ALONGSIDE", "GOALS", "FITS", "POS_GROUP", "RECRUIT_AB_CHANCE",
                                                                 "RECRUIT_AB_SECOND", "RECRUIT_AB_TIERS")},
        "promises": {k: getattr(promises, k) for k in ("LATE_WEIGHT", "BIG_WEIGHT", "BENCH_HIT", "POSITION_HIT", "BANDS", "ATTENTION_BIG", "COCKY_HIT",
                                                       "CHIPS", "LEAVE", "LEAVE_BIG", "LEAVE_SHY", "LEAVE_CAP", "BENT_MULT", "PROMISE_NIL_MULT", "NIL_MULT_BY",
                                                       "PROMISE_AGAIN_STAY", "SLIPPING_LINE", "NEWS_AFTER")},
        "grades": {k: getattr(grades, k) for k in ("BANDS", "PLUS_FROM", "MINUS_UNDER", "NO_FINE", "PLUS_MINUS_EYE", "ORDER")},
        "word": {k: getattr(word, k) for k in ("WORD_START", "GAIN", "COST", "STAR_COST", "GUARDED_COST", "GROUP_EXTRA", "RECOVER", "GROUP_DECAY", "FLOOR",
                                               "PROMISE_MULT", "CARES_MORE", "STAR_OVR", "LOG_KEEP", "BAND_KIND", "GROUP_NAMES", "RECENT")},
        "office": {k: getattr(office, k) for k in ("NEWS_ITEMS", "CONF_GAMES", "NEWS_WEEKS", "_NEWS_ORDER")},
        "career": {"FIRST_YEAR": career.FIRST_YEAR, "MAX_UNPACKED": career.MAX_UNPACKED, "MAX_BOXES": career.MAX_BOXES, "BOX_NAME": career.BOX_NAME.pattern},
    }})))
for f in FILES.values():
    f.close()
print("written", sorted(p.name for p in out.iterdir())[:8], "...")
