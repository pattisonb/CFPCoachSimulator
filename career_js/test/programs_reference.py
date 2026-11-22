"""coach_career/programs.py's answers on the real data, for programs_compare.mjs to hold career_js/programs.js to:
python3 career_js/test/programs_reference.py OUT   (then: node career_js/test/programs_compare.mjs OUT)

Every program's base values, market, grades and tags; the small functions over grids of inputs; and a career's league
(the real 2026 one, league.from_base) moved through six offseasons of seeded results, ranks, drafts, portal losses,
coaching changes and NIL moves, its programs and the Programs page written after each."""
import copy, json, os, random, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("CFP_CLEAR", "0")
out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)

from coach_career import league, offseason, programs
from sim import season


def write(name, data):
    (out / name).write_text(json.dumps(data), encoding="utf-8")


rng = random.Random("programs-reference")
teams = season.load_teams()
slugs = sorted(teams)                                   # every team, the FCS stand-ins too
fbs = [s for s in slugs if not teams[s].get("fictional")]
odd = ["no-such-program", "new-team-0", ""]
write("setup.json", {"DRAFT_GROUP": offseason.DRAFT_GROUP, "slugs": slugs, "odd": odd})

# ----- every program as the data has it -----
write("fixed.json", {s: {"base": programs.base(s), "market": programs.market(s), "market_row": programs.market_row(s),
                         "grades": programs.grades(s), "_grades": programs._grades(s), "tags": programs.tags(s), "_tags": programs._tags(s),
                         "z": programs.z({}, s), "z_none": programs.z(None, s), "get": programs.get({"league": None}, s),
                         "grades_now": programs.grades_now({}, s), "attract": programs.attract({}, s),
                         "coach_level": programs.coach_level({}, s), "coach_ceiling": programs.coach_ceiling({}, s)}
                     for s in slugs + odd})
write("profile_rows.json", programs.profile_rows())

# ----- the small functions -----
hist = programs._history()
scales = [hist["scales"]["winning"], hist["scales"]["conference"], hist["scales"]["pro"], *hist["scales"]["pro_group"].values(),
          {"lo": 0.0, "hi": 3.0, "k": 1.0}, {"lo": 40.0, "hi": 70.0}, {"lo": 5, "hi": 5, "k": 2}, {"lo": 0, "hi": 10, "k": 2}, {"lo": 0, "hi": 10, "k": 3.0},
          {"lo": 2.5, "hi": 1.0, "k": 0.5}]
values = [-1, 0, 0.0, 0.1, 0.25, 1 / 3, 0.5, 1, 1.5, 2, 2.75, 3, 3.3, 5, 9, 10, 17.5, 24, 35, 41.2, 52.3, 55.55, 60, 68.45, 70, 100, 353, 400]
values += [rng.uniform(0, 80) for _ in range(60)]
small = {"scaled": [[v, sc, programs.scaled(v, sc)] for sc in scales for v in values],
         "tier_of": [[r / 10, programs.tier_of(r / 10)] for r in range(0, 1001, 5)],
         "z_of": [[r / 10, programs.z_of(r / 10)] for r in range(0, 1001, 7)] + [["61.5", programs.z_of("61.5")], [40, programs.z_of(40)]],
         "word_of": [[r / 4, programs.word_of(r / 4)] for r in range(0, 401)],
         "goal_for": [[t, p4, r, ind, programs.goal_for(t, p4, r, ind)] for t in (1, 2, 3, 4, 5) for p4 in (True, False)
                      for r in (None, 0, 41.9, 42.0, 42, 60.5) for ind in (False, True)],
         "season_score": [[w, g, r, programs.season_score(w, g, r)] for g in (0, 1, 12, 13, 15) for w in range(0, g + 1)
                          for r in (None, 0, 1, 2, 5, 6, 10, 11, 25, 26)],
         "pick_points": [[r, programs.pick_points(r)] for r in (1, 2, 3, 4, 5, 6, 7, 8, 0, None, 2.0)],
         "empty_drafts": [[y, programs.empty_drafts(y)] for y in (2025, 2026, 2031)]}
groups = programs.PRO_GROUP_ORDER
lines = []
for i in range(300):
    picks = [[rng.choice((1, 1, 2, 3, 4, 5, 6, 7)), rng.choice(groups)] for _ in range(rng.choice((0, 0, 1, 2, 3, 5, 9, 14)))]
    lines.append([2020 + i % 9, picks, programs.draft_line(2020 + i % 9, picks)])
small["draft_line"] = lines
pro = []
for s in fbs:
    b = programs.base(s)
    for now in (2025, 2027, 2030):
        p = {"drafts": copy.deepcopy(b["drafts"]) if (s, now) != (fbs[0], 2030) else []}
        programs.pro_recompute(p, now)
        pro.append([s, now, programs.pro_score(b["drafts"], now), programs.pro_group_scores(b["drafts"], now), p,
                    {g: programs.pro_group_grade(p, g) for g in ("QB", "RB", "WR", "TE", "OL", "DL", "LB", "CB", "S", "K", "P", "ATH", None)}])
small["pro"] = pro
nums = [None, True, False, 0, 3, 3.5, -2, float("nan"), "12", " 12 ", "1,234", "1,234.5 people", "unranked", "", "   ", "#12", "12th", "1e3", ".5", "5.",
        "-0.0", "+7", "1_000", "_1", "1__0", "inf", "-Infinity", "nan", "0x10", "12 13", "N/A", "T-45", "45 (tie)", [1], {"a": 1}, "１２"]
small["_num"] = [[v if v == v else "NaN", programs._num(v)] for v in nums[:-1]]
small["_num"] = [[a, (b if b is None or (b == b and abs(b) != float("inf")) else str(b))] for a, b in small["_num"]]
ranks = [None, "unranked", 1, 2, 5, 10, 25, 51, 100, 127, "150", 250, 399, 400, 401, 1000, 0, -3, 0.5]
small["rank_score"] = [[r, s, programs.rank_score(r, s)] for r in ranks for s in ("", "army", "texas")]
small["recency"] = [[y, programs.recency(y)] for y in (None, 2026, 2030, 2025, 2020, 2011.5, 2004, 2003, 1990, "2018", "soon", 1923)]
small["warmth"] = [[v, programs.warmth(v)] for v in (None, -5, 20, 31.8, 42, 50, 64.9, 65, 80, "45.5", "warm")]
small["fill_score"] = [[c, cap, programs.fill_score(c, cap)] for c in (None, 0, 26038, 61000, 107000, "88,000") for cap in (None, 0, 39441, 61000, 107601, "100,000")]
small["_line"] = [[x, sc, lg, programs._line(x, sc, lg)] for sc, lg in ((programs.SIZE_SCALE, True), (programs.WARMTH_SCALE, False), (programs.CROWD_SCALE, False),
                                                                     (programs.FILL_SCALE, False), (programs.TV_SCALE, True), (programs.INSTAGRAM_SCALE, True))
                  for x in [0, 0.2, 0.31, 0.75, 1, 8, 9, 37.5, 755105, 61000, 2_000_000, 6e6] + [rng.uniform(0.1, 3e6) for _ in range(25)]]
small["_step"] = [[c, t, s, programs._step(c, t, s)] for c in (-3.5, 0.0, 2.2) for t in (-9.0, 0.0, 1.1, 30) for s in (4.0, 1.5)]
small["mix"] = [[p, programs.mix(p)] for p in ({}, {"prestige": "50", "winning": 20}, {"prestige": 99.9, "winning": 100, "nil": 87.3, "market": 91, "conference": 100.0, "coach": 77, "pro": 96.4})]
write("small.json", small)

# ----- a career's league through six offseasons -----
lgd = league.from_base(2027)
write("league.json", lgd)
old = copy.deepcopy(lgd)                       # a save from before the Pro Pipeline, and one with no programs at all
for i, (s, t) in enumerate(old["teams"].items()):
    if i % 3 == 0:
        for k in ("drafts", "pro", "pro_groups"):
            t["program"].pop(k, None)
    elif i % 3 == 1:
        del t["program"]
old_in = copy.deepcopy(old)
got = {s: copy.deepcopy(programs.get({"league": old}, s)) for s in list(old["teams"])[::7]}
programs.init(old)
write("old.json", {"in": old_in, "get": got, "out": old})

state = {"league": lgd, "team": "ohio-state", "year": 2026}
names = sorted(lgd["teams"])
positions = list(offseason.DRAFT_GROUP) + ["ATH", "LS", None]
years = []
for year in range(2027, 2033):
    results = {s: {"wins": (w := rng.randint(0, 13)), "losses": rng.randint(0, 13 - w) + (1 if w == 0 else 0)} for s in names if rng.random() < 0.97}
    if year == 2029:
        results[names[3]] = {"wins": 0, "losses": 0}
    ranked = rng.sample(names, 25)
    ranks = {s: i + 1 for i, s in enumerate(ranked)}
    departures = []
    for _ in range(rng.randint(180, 260)):
        ev = {"kind": "draft", "team": rng.choice(names), "pos": rng.choice(positions)}
        if rng.random() < 0.9:
            ev["round"] = rng.randint(1, 7)
        departures.append(ev)
    for _ in range(rng.randint(500, 1100)):
        departures.append({"kind": rng.choice(("portal", "portal", "portal", "graduate", "cut")), "team": rng.choice(names + ["nowhere"]), "pos": rng.choice(positions)})
    rng.shuffle(departures)
    state["offseason"] = {"year": year, "departures": departures}
    hires = rng.sample(names, 14)
    for s in hires:                              # head coaches hired this offseason, some with no ratings on record
        hc = lgd["teams"][s]["coaches"].setdefault("head_coach", {})
        hc["since"] = year
        if rng.random() < 0.3:
            hc.pop("ratings", None)
        elif hc.get("ratings"):
            hc["ratings"]["overall"] = rng.randint(35, 92)
    for s in rng.sample(names, 20):
        lgd["teams"][s]["ad"] = {"patience": rng.choice((1, 2, 3, 4, 5, None))}
    state["polls"] = {str(w): ({"ap": [{"team": s, "rank": ranks[s] if w == 16 else (i * 7 + w) % 25 + 1} for i, s in enumerate(ranked)]}
                               if w not in (17, 9) else {"ap": [], "coaches": [1]}) for w in (1, 2, 9, 10, 16, 17)}
    step = {"year": year, "results": results, "ranks": ranks, "departures": departures, "hires": hires,
            "ad": copy.deepcopy({s: t.get("ad") for s, t in lgd["teams"].items() if "ad" in t}), "polls": state["polls"],
            "coaches": copy.deepcopy({s: t["coaches"].get("head_coach") for s, t in lgd["teams"].items()})}
    step["final_ranks"] = programs.final_ranks(state)
    step["draft_picks"] = {s: [list(x) for x in v] for s, v in programs.draft_picks(state).items()}
    if year == 2028:                             # first only a few programs, then the rest: the same year twice moves nothing
        only = rng.sample(names, 30)
        step["only"] = only
        programs.update(state, results, ranks, only=set(only))
        step["after_only"] = copy.deepcopy({s: t["program"] for s, t in lgd["teams"].items()})
    if year == 2030:
        programs.update(state, results, ranks, year)      # the year given
    else:
        programs.update(state, results, ranks)
    step["after_update"] = copy.deepcopy({s: t["program"] for s, t in lgd["teams"].items()})
    programs.update(state, results, ranks)
    step["again_same"] = step["after_update"] == {s: t["program"] for s, t in lgd["teams"].items()}
    step["conference_start"] = copy.deepcopy(lgd["conference_start"])
    moves = {}
    for s in names:
        if rng.random() < 0.85:
            moves[s] = [rng.random() < 0.4, rng.random() < 0.3, rng.random() < 0.1]
            programs.nil_move(lgd["teams"][s], *moves[s])
    step["nil"] = moves
    step["after_nil"] = copy.deepcopy({s: t["program"] for s, t in lgd["teams"].items()})
    step["rows"] = programs.rows(state)
    step["reads"] = {s: [programs.z(state, s), programs.attract(state, s), programs.coach_level(state, s), programs.coach_ceiling(state, s),
                         programs.grades_now(state, s)] for s in names}
    years.append(step)
    lgd["year"] = year + 1
write("years.json", years)
print("written", sorted(p.name for p in out.iterdir()))
