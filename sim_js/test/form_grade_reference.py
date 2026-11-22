"""Python's answers for sim_js/form.js and sim_js/grade.js, written as JSON for form_grade_compare.mjs to hold the
JavaScript to:

    python3 sim_js/test/form_grade_reference.py OUT [--weeks N] && node sim_js/test/form_grade_compare.mjs OUT

form: every team of the league moved by a range of shifts (each player's moved ratings), and made-up players.
grade: one real career season (SMU, seed 11), the Season Grade after every week for your team, and from week 13 on for
every team of the league in your seat; what it asks of the season and the carousel is recorded for the Node script
to replay (neither is loaded there).
"""
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

from canon import canon                      # noqa: E402
from coach_career import carousel            # noqa: E402
from sim import form, grade, season          # noqa: E402

# ----- form -----------------------------------------------------------------------------------------------------------
rng = random.Random("form")
teams = season.load_teams()
SHIFTS = [-12, -7.3, -3, -0.5, -0.49, 0, 0.3, 0.5, 1.5, 2.5, 4.49, 9.75]
cases = []
for slug, t in teams.items():
    for shift in SHIFTS:
        moved = form.with_form(t, shift)
        cases.append({"team": slug, "shift": shift, "same_team": moved is t, "keys": list(moved),
                      "rows": [[p.get(k) for k in form.ATTRS] for unit in ("offense", "defense") for p in moved[unit]],
                      "others_kept": all({k: v for k, v in p.items() if k not in form.ATTRS} == {k: v for k, v in q.items() if k not in form.ATTRS}
                                         for unit in ("offense", "defense") for p, q in zip(t[unit], moved[unit]))})
made = []
for i in range(3000):
    p = {"name": f"P{i}", "position": "QB"}
    for k in rng.sample(form.ATTRS, rng.randint(0, len(form.ATTRS))):
        p[k] = rng.choice([rng.randint(1, 99), rng.randint(1, 99) + 0.5, rng.uniform(0, 110), None, "70", True, False, 1, 99, 98.5, 0])
    shift = rng.choice([rng.uniform(-15, 15), 0.5, -0.5, 1.5, 2.5, -2.5, 0, 3])
    keys = rng.sample(form.ATTRS, rng.randint(1, len(form.ATTRS)))
    made.append({"p": p, "keys": keys, "shift": shift, "expect": form._moved(p, keys, shift)})
from coach_career import league      # noqa: E402  (what the JavaScript season asks of it to read the teams)
(out / "form.json").write_text(json.dumps(canon({
    "ATTRS": list(form.ATTRS), "cases": cases, "made": made,
    "league": {"OFFENSE_ROLES": sorted(league.OFFENSE_ROLES), "TEAM_FIT": league.TEAM_FIT, "GROUP_OF": league.GROUP_OF}})))
print("form:", len(cases), "teams moved,", len(made), "made-up players", flush=True)

# ----- grade ----------------------------------------------------------------------------------------------------------
BLOBS, STATES = {}, {}
LOG = None


def keep(value):
    text = json.dumps(canon(value))
    if len(text) < 2000:
        return json.loads(text)
    h = hashlib.sha1(text.encode()).hexdigest()[:16]
    BLOBS.setdefault(h, json.loads(text))
    return {"$blob": h}


def patch(mod, name):
    orig = getattr(mod, name)
    label = f"{mod.__name__.split('.')[-1]}.{name}"

    def wrapped(*a, **k):
        global LOG
        log, LOG = LOG, None                    # what it asks in turn is its own business
        try:
            r = orig(*a, **k)
        finally:
            LOG = log
        if LOG is not None:
            LOG.setdefault(label, []).append(keep(r))
        return r
    setattr(mod, name, wrapped)


patch(season, "_records")
patch(carousel, "goal")
lines = []


def graded(st, label):
    global LOG
    text = json.dumps(canon({k: st.get(k) for k in ("games", "champion", "champions", "polls") if k in st}))
    h = hashlib.sha1(text.encode()).hexdigest()[:16]
    STATES.setdefault(h, text)
    LOG = {}
    try:
        r = grade.season_grade(st)
    finally:
        calls, LOG = LOG, None
    lines.append({"label": label, "state": h, "team": st["team"], "conference": st["conference"], "calls": calls, "expect": r})


st = season.new_season("smu", "full", seed=11, career=True)
all_teams = season.load_teams()
n = 0
while not st["done"] and n < WEEKS:
    st = season.advance(st, auto_recruit=True)
    n += 1
    graded(st, f"week {n}")
    if n >= 13 or n == WEEKS:
        mine = st["team"], st["conference"]
        for slug, t in all_teams.items():
            if t["fictional"]:
                continue
            st["team"], st["conference"] = slug, t["conference"]
            graded(st, f"week {n} as {slug}")
        st["team"], st["conference"] = mine
    print("week", n, flush=True)
import collections      # noqa: E402
print(collections.Counter(x["expect"]["band"] for x in lines), collections.Counter(x["expect"]["grade"] for x in lines))
(out / "grade.json").write_text(json.dumps(canon({
    "blobs": BLOBS, "states": STATES, "cases": lines,
    "constants": {k: getattr(grade, k) for k in ("GRADE_BASE", "GRADE_PER_WIN", "GRADE_CONFERENCE", "GRADE_PLAYOFF", "GRADE_BOWL_WIN", "GRADE_RANK",
                                                 "GRADE_MISSED_KIND", "GRADE_LOSING", "GRADE_CAP", "GRADE_LETTERS", "ROUND_WORDS", "GRADE_LINES")},
    "letters": {str(s): grade._letter(s) for s in [x / 2 for x in range(-20, 260)]}})))
print("grade:", len(lines), "cases")
