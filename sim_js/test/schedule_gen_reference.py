"""Generated schedules by the Python (sim/schedule_gen.py), for schedule_gen_compare.mjs to hold sim_js/schedule_gen.js
to: the 2026 history, chains of seasons from it (each year from the last one's history, one generator all through),
single seasons from many seeds, seasons from an empty history, and league files' rules (new conferences, uneven
divisions, changed widths). Every case is written whole: the games in their order, the history, key order and all, and
the generator's next number (so the number of draws is checked too).
python3 sim_js/test/schedule_gen_reference.py OUTDIR"""
import json, os, random, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))
out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
os.environ["CFP_SEASONS_DIR"] = tempfile.mkdtemp()
os.environ["SIM_WORKERS"] = "1"

from sim import schedule_gen as sg, season
from coach_career import clear, league, league_file
import test_league_schedule as tls


def ordered(o):
    """A value with every dict as its [key, value] pairs in the dict's order, so the order survives JSON in JavaScript;
    a whole float as the whole number (JavaScript has one kind of number)."""
    if isinstance(o, float) and o.is_integer():
        return int(o)
    if isinstance(o, dict):
        return {"__d": [[k, ordered(v)] for k, v in o.items()]}
    if isinstance(o, (list, tuple)):
        return [ordered(v) for v in o]
    return o


def slim(teams):
    """What the generator reads of a team."""
    assert not any(s.isdigit() for s in teams), "a team slug that is a whole number"
    return {s: {"name": t["name"], "conference": t["conference"], "state": t.get("state"), "fictional": bool(t.get("fictional"))}
            for s, t in teams.items()}


teams = season.load_teams()
team_sets = {"builtin": slim(teams)}
rule_sets = {}
histories = {}
cases = []
n_files = 0


def run(name, year, teams_key, hist_key, rng, seed_text, rules_key=None, chain=None):
    """One generate: its answer (or its error) written to a file of its own; returns the history carried forward."""
    global n_files
    T = team_sets[teams_key]
    H = histories[hist_key] if hist_key is not None else chain
    case = {"name": name, "year": year, "teams": teams_key, "rules": rules_key, "history": hist_key, "seed": seed_text}
    try:
        games, hist = sg.generate(year, T, H, rng, rule_sets[rules_key] if rules_key else None)
        case["games"] = [[eid, ordered(g)] for eid, g in games.items()]
        case["hist"] = ordered(hist)
        assert all(eid == g["event_id"] for eid, g in games.items())
    except sg.ScheduleError as e:
        games, hist = None, None
        case["error"] = str(e)
    except (IndexError, ValueError, KeyError) as e:          # a slate so odd the generator itself trips: only that it does is compared
        games, hist = None, None
        case["error"] = "(not a ScheduleError)"
    case["next_random"] = rng.random()
    n_files += 1
    case["file"] = f"case_{n_files:04d}.json"
    (out / case["file"]).write_text(json.dumps(case))
    cases.append({k: case[k] for k in ("name", "file", "seed", "year", "teams", "rules", "history")} | {"chained": chain is not None})
    return hist


# the 2026 history: from the schedule file through the season's FCS map, and from the schedule alone
hist0 = sg.seed_history(teams)
histories["2026"] = hist0
schedules = json.loads(season.SCHEDULES_FILE.read_text(encoding="utf-8"))
seeded = {"default": ordered(hist0), "explicit": ordered(sg.seed_history(team_sets["builtin"], schedules)),
          "empty": ordered(sg.empty_history())}

# chains: 2027 on, each year from the last year's history, one generator all the way
for seed, last in ((7, 2034), (5, 2032), (1, 2032), (2, 2032), (3, 2030), (99, 2030), ("league-schedule-1", 2030), (2**40 + 17, 2029)):
    rng = random.Random(seed)
    h = None
    for year in range(2027, last + 1):
        h = run(f"chain {seed}", year, "builtin", "2026" if year == 2027 else None, rng, seed if year == 2027 else None, chain=h)
        if h is None:
            break
        if seed == 7 and year in (2027, 2029):
            histories[f"chain7-{year}"] = h

# single seasons: many seeds from the 2026 history, and from two later ones
for seed in range(100, 140):
    run("single 2027", 2027, "builtin", "2026", random.Random(seed), seed)
for seed in range(200, 215):
    run("single 2028", 2028, "builtin", "chain7-2027", random.Random(seed), seed)
for seed in range(300, 310):
    run("single 2030", 2030, "builtin", "chain7-2029", random.Random(seed), seed)
# a first season with nothing behind it
histories["empty"] = sg.empty_history()
for seed in range(400, 410):
    run("from nothing", 2026 + seed % 3, "builtin", "empty", random.Random(seed), seed)
# no history given at all: generate seeds it itself (sg.seed_history through the season)
run("history None", 2027, "builtin", None, random.Random(41), 41, chain=None)

# league files: their rules over the built-in ones (tests/test_league_schedule.py's files)
docs = [("big sky east", tls.TEN_TEAM_BIG_SKY_EAST), ("sun belt plus one", tls.file_adding_one_sun_belt_team),
        ("one team no games", tls.ONE_TEAM_NO_GAMES), ("renamed sun belt", tls.RENAMED_SUN_BELT)]
for n, g in ((9, 8), (8, 7), (9, 7), (11, 9), (12, 11), (6, 4), (5, 3), (2, 1), (3, 2)):
    docs.append((f"width {n} {g}", {"format": "cfp-league/1",
                 "conferences": [{"id": "big-sky-east", "name": "Big Sky East", "level": "FBS", "games": g}],
                 "teams": [tls._new_team(f"new-school-{i}", ["OR", "WA", "ID", "TX", "OH"][i % 5], "big-sky-east") for i in range(n)]}))
docs += [
    ("mac less three", {"format": "cfp-league/1", "remove": ["kent-state", "akron", "ohio"]}),
    ("mac ten games", {"format": "cfp-league/1", "conferences": [{"id": "mac", "name": "MAC", "level": "FBS", "games": 10}]}),
    ("sun belt ten games", {"format": "cfp-league/1", "conferences": [{"id": "sun-belt", "name": "Sun Belt", "level": "FBS", "games": 10}],
                            "teams": [tls._new_team(f"bayou-{i}", "LA", "sun-belt") for i in range(3)]}),
    ("sun belt five games", {"format": "cfp-league/1", "conferences": [{"id": "sun-belt", "name": "Sun Belt", "level": "FBS", "games": 5}]}),
    ("moves", {"format": "cfp-league/1", "teams": [tls._new_team("owl-state", "OR", "pac-12"), tls._new_team("hawk-tech", "TX", "sec"),
                                                   {"slug": "toledo", "conference": "mountain-west"}]}),
]
for i, (name, doc) in enumerate(docs):
    merged = league_file.merge(doc)
    rule_sets[name] = league_file.schedule_rules(merged)
    team_sets[name] = slim(tls.quick_teams(merged))
    for seed in (1, 2):
        rng = random.Random(f"league-schedule-{seed}")
        h = run(f"league {name}", 2026, name, "empty", rng, f"league-schedule-{seed}", rules_key=name)
        if h is not None:
            h = run(f"league {name}", 2027, name, None, random.Random(i), i, rules_key=name, chain=h)
        if h is not None:
            run(f"league {name}", 2028, name, None, random.Random(i + 50), i + 50, rules_key=name, chain=h)

# slates that cannot be made, and leagues cut down to a conference or two: the generator's errors, word for word
pac = sg.rules()["conferences"]["Pac-12"]
rule_sets["pac-12 twelve games"] = {"conferences": {"Pac-12": {**pac, "games": 12}}, "annual": []}
rule_sets["sec fourteen games"] = {"conferences": {"SEC": {**sg.rules()["conferences"]["SEC"], "games": 14}}}
rule_sets["annual extra"] = {"annual": [{"teams": ["smu", "toledo"], "name": "The Extra Game", "finale": True},
                                        {"teams": ["ohio-state", "oregon-state"], "name": "Week Three", "week": 3, "first": 2028, "last": 2029},
                                        {"teams": ["texas", "nobody-at-all"], "name": "Not Here"},
                                        {"teams": ["army", "air-force"], "name": "Neutral Extra", "neutral": True, "week": 10}]}
for name in ("pac-12 twelve games", "sec fourteen games", "annual extra"):
    for seed in (1, 2, 3):
        rng = random.Random(seed)
        h = run(f"odd {name}", 2027, "builtin", "2026", rng, seed, rules_key=name)
        for year in (2028, 2029, 2030):
            if h is not None:
                h = run(f"odd {name}", year, "builtin", None, rng, None, rules_key=name, chain=h)
for name, keep in (("sec alone", {"SEC"}), ("mac alone", {"MAC"}), ("sec and mac", {"SEC", "MAC"}), ("big ten and acc", {"Big Ten", "ACC"}),
                   ("no fcs", None), ("power only", {"SEC", "Big Ten", "ACC", "Big 12", "FBS Independent"}),
                   ("group of five only", {"Pac-12", "American Athletic Conference", "Mountain West", "Sun Belt", "MAC", "Conference USA"})):
    full = team_sets["builtin"]
    team_sets[name] = {s: t for s, t in full.items() if (not t["fictional"] if keep is None else t["fictional"] or t["conference"] in keep)}
    for seed in (1, 2, 3):
        for hist_key, year in (("empty", 2026), ("2026", 2027)):
            rng = random.Random(seed)
            h = run(f"small {name}", year, name, hist_key, rng, seed)
            if h is not None:
                run(f"small {name}", year + 1, name, None, rng, None, chain=h)

(out / "setup.json").write_text(json.dumps({
    "clear": clear.on(), "OFFENSE_ROLES": sorted(league.OFFENSE_ROLES), "TEAM_FIT": league.TEAM_FIT, "GROUP_OF": league.GROUP_OF,
    "team_sets": {k: ordered(v) for k, v in team_sets.items()}, "rule_sets": rule_sets, "histories": histories, "seeded": seeded,
    "schedules": "data/schedules.json", "cases": cases,
    "constants": {k: getattr(sg, k) for k in ("GAMES", "LAST_WEEK", "FINALE_WEEK", "ARMY_NAVY_WEEK", "NONCONF_WEEKS", "WEEK0", "WEEK0_GAMES",
                                               "LATE_FCS_WEEKS", "HISTORY_KEEP", "SECOND_POWER_ROAD", "POWER_FCS_CHANCE", "RESTARTS", "REGION_OF_STATE")},
    "small": {"pair_key": [[a, b, sg.pair_key(a, b)] for a, b in (("texas", "alabama"), ("a", "B"), ("smu", "smu-2"), ("ohio", "ohio-state"))],
              "prefs": {k: sg._prefs({"kind": k}) for k in ("conf", "fcs", "nonconf", "fixed")},
              "league_games": [[c, y, sg._league_games(r, y)] for c, r in sg.rules()["conferences"].items() for y in (2026, 2027, 2028, 2031)]}}))
errors = sum(1 for c in cases if "error" in json.loads((out / c["file"]).read_text()))
print(len(cases), "cases,", errors, "of them an error (a ScheduleError, or the generator tripping)")
