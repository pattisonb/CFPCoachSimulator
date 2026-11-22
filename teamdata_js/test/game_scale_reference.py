"""Python's answers for teamdata_js/game_scale.js, career_js/prospects.js and career_js/recruits.js (the port is held
to them exactly):  python3 teamdata_js/test/game_scale_reference.py out.json && node teamdata_js/test/game_scale_compare.mjs out.json

Writes {"cases": [[function, [arguments], answer], ...], "upgrades": [...]}: every player of the base league (his
overall now and at his potential, his card), the scale's conversions on a grid, a generated class of recruits, and
old saves for the two upgrades."""
import copy
import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from coach_career import league, prospects, recruiting, recruits   # noqa: E402
from teamdata import build_teams, game_scale as gs                 # noqa: E402

cases = []


def case(fn, *args):
    mod, name = fn.split(".")
    given = copy.deepcopy(args)
    if fn == "prospects._card":                # Python's takes his skills as a tuple of pairs (it keeps its answers)
        given = (given[0], given[1], tuple(tuple(kv) for kv in given[2]))
    out = getattr({"game_scale": gs, "prospects": prospects, "recruits": recruits}[mod], name)(*given)
    if isinstance(out, set):
        out = sorted(out)
    cases.append([fn, list(args), out])
    return out


KEYS = gs.keys()
GROUPS = list(gs.data()["skills"])
EA_POSITIONS = list(gs.GROUP_OF)
ENGINE_POSITIONS = ["QB", "RB", "WR", "TE", "OL", "DL", "MLB", "ROLB", "LOLB", "CB", "S", "K", "P"]
POSITIONS = EA_POSITIONS + [p for p in ENGINE_POSITIONS if p not in EA_POSITIONS]
rng = random.Random("game-scale-reference")

# ----- the small ones -----
case("game_scale.keys")
case("game_scale.has_overall")
case("game_scale.overall_version")
case("game_scale.engine_means")
case("game_scale.card_scale")
case("recruits.model")
for pos in POSITIONS + ["LS", "ATH", "XX"]:
    case("game_scale.group", pos)
    case("game_scale.card_formula", pos)
    case("game_scale.position_skills", pos)
for p in ({"source_position": "LT", "role": "LG", "position": "OL"}, {"role": "MIKE", "position": "MLB"}, {"position": "S"},
          {"source_position": None, "role": "", "position": "QB"}):
    case("game_scale.card_position", p)
for x in [i / 4 for i in range(-20, 480)] + [rng.uniform(0, 110) for _ in range(500)]:
    case("recruits.curve", x)
for pos in POSITIONS:
    for ea in EA_POSITIONS + [None]:
        p = {"ea_position": ea, "position": pos}
        case("prospects.engine_position", p)

# ----- the conversions: every group and skill on a grid -----
base_grid = [v / 2 for v in range(-10, 241)] + [round(rng.uniform(0, 110), 2) for _ in range(40)] + [rng.uniform(0, 110) for _ in range(40)]
ours_grid = list(range(1, 100)) + [v + 0.5 for v in range(1, 99)] + [rng.uniform(1, 99) for _ in range(40)]
for g in GROUPS:
    for k in KEYS:
        for v in base_grid:
            case("game_scale.to_ours", v, g, k)
        for v in ours_grid:
            case("game_scale.to_base", v, g, k)
            case("game_scale._base_tenth", v, g, k)
for pos in POSITIONS:
    for _ in range(40):
        some = rng.sample(KEYS, rng.randint(1, len(KEYS)))            # a dict's own order, and not every skill
        case("game_scale.ours_from_base", {k: round(rng.uniform(5, 105), 1) for k in some}, pos)
        case("game_scale.base_from_ours", {k: rng.randint(1, 99) for k in some}, pos)
        case("game_scale.base_from_ours", {k: rng.choice([rng.randint(1, 99) + 0.5, rng.uniform(1, 99)]) for k in some}, pos)

# ----- every player of the base league -----
lg = league.from_base()
attrs = lg["attrs"]
assert attrs == KEYS
stored = same = 0
for slug, t in lg["teams"].items():
    for c in t["roster"]:
        ours = dict(zip(attrs, c["r"]))
        pot = {k: v + d for k, v, d in zip(attrs, c["r"], c["g"])}
        o = case("game_scale.overall", ours, c["pos"])
        stored += 1
        same += o == c["o"]
        case("game_scale.overall", pot, c["pos"])
        case("game_scale.legacy_overall", ours, c["pos"])
        case("game_scale.card_attributes", ours, c["pos"])
        engine = build_teams.POSITION_MAP.get(c["pos"], c["pos"])
        case("prospects.card_attributes", pot, {"ea_position": c["pos"], "position": engine})
        case("game_scale.overall", ours, engine)                     # his engine position: the group's first formula
print(f"base league: {stored} players, {same} stored overalls equal overall() in Python")

# off his position, skills missing, halves and a scale file's missing card entry
players = [c for t in lg["teams"].values() for c in t["roster"]]
for c in rng.sample(players, 1500):
    pos = rng.choice(POSITIONS)
    ours = dict(zip(attrs, c["r"]))
    case("game_scale.overall", ours, pos)
    case("game_scale.card_attributes", ours, pos)
    case("prospects.card_attributes", ours, {"ea_position": rng.choice(EA_POSITIONS + [None]), "position": rng.choice(ENGINE_POSITIONS)})
    part = {k: v + rng.choice([0, 0.5, 0.25]) for k, v in ours.items() if rng.random() < 0.8}
    case("game_scale.overall", part, pos)
    case("game_scale.legacy_overall", part, pos)
    items = list(part.items())
    rng.shuffle(items)
    case("prospects.card_attributes", dict(items), {"ea_position": c["pos"], "position": c["pos"]})
    case("prospects._card", build_teams.POSITION_MAP.get(c["pos"], c["pos"]), c["pos"], [list(kv) for kv in items])

# ----- a generated class: EA's numbers to ours -----
klass = recruits.generate_class(2027, 3)
for q in klass:
    ours = case("game_scale.from_ea", q["ratings_ea"], q["ea_position"])
    case("game_scale.potential_from_ea", q["potential_ea"], ours, q["ea_position"])
    case("prospects.engine_position", {"ea_position": q["ea_position"], "position": q["position"]})
for q in rng.sample(klass, 600):
    pos = rng.choice(POSITIONS)
    ea = {k: v + rng.choice([0, 0.5, rng.uniform(-3, 3)]) for k, v in q["ratings_ea"].items() if rng.random() < 0.9}
    ours = case("game_scale.from_ea", ea, pos)
    part = {k: v for k, v in ours.items() if rng.random() < 0.7}
    case("game_scale.potential_from_ea", q["potential_ea"], part, pos)
    r = [q["ratings_ea"][k] for k in KEYS]
    g = [q["potential_ea"][k] - q["ratings_ea"][k] for k in KEYS]
    case("game_scale._convert", r, g, KEYS, q["ea_position"])

# ----- old saves: the two upgrades (league.forget is recorded, recruiting._truths is Python's own) -----
upgrades = []
forgot = []
league.forget = lambda career_id: forgot.append(career_id)


def run_upgrade(name, state):
    before = copy.deepcopy(state)
    del forgot[:]
    answer = getattr(gs, name)(state)
    upgrades.append({"fn": name, "before": before, "answer": answer, "after": state, "forgot": list(forgot)})


def old_overalls(n_teams, wrong, seed):
    r2 = random.Random(f"old-overalls-{seed}")
    slugs = r2.sample(sorted(lg["teams"]), n_teams)
    teams = {s: {"roster": copy.deepcopy(lg["teams"][s]["roster"])} for s in slugs}
    portal = {c["id"]: {"player": c, "from": slugs[0]} for c in copy.deepcopy(r2.sample(players, 30))}
    everyone = [c for t in teams.values() for c in t["roster"]] + [e["player"] for e in portal.values()]
    for c in everyone:
        if r2.random() < wrong:
            c["o"] = max(1, c["o"] + r2.choice([-3, -1, 1, 2]))
    pros = {}
    for q in r2.sample(klass, 200):
        ours = gs.from_ea(q["ratings_ea"], q["ea_position"])
        pot = gs.potential_from_ea(q["potential_ea"], ours, q["ea_position"])
        p = {"id": q["id"], "ea_position": q["ea_position"], "position": q["position"], "ratings": [ours.get(k, 50) for k in KEYS],
             "potential": [pot.get(k, 50) for k in KEYS], "ovr": 40, "pot_ovr": 41}
        if r2.random() < 0.1:
            del p["potential"]
        if r2.random() < 0.05:
            p["ratings"] = None
        pros[q["id"]] = p
    return {"id": f"old-{seed}", "league": {"scale": "ours", "attrs": list(KEYS), "teams": teams},
            "offseason": {"portal": {"players": portal}},
            "recruiting": {"scale": "ours", "attrs": list(KEYS), "prospects": pros}}


run_upgrade("upgrade_overalls", old_overalls(4, 0.2, 1))
st = old_overalls(3, 0.0, 2)                                # nothing moved: the teams files stand
run_upgrade("upgrade_overalls", st)
run_upgrade("upgrade_overalls", st)                         # stamped now: left alone
st = old_overalls(2, 0.3, 3)
st["league"]["overall_v"] = gs.overall_version()            # the league is current, the class is not
del st["offseason"]
run_upgrade("upgrade_overalls", st)
run_upgrade("upgrade_overalls", {"id": "empty"})
run_upgrade("upgrade_overalls", {"id": "ea", "league": {"scale": "ea"}, "recruiting": {"scale": "ours", "prospects": {}}})


def old_ea(seed, with_league=True, with_class=True):
    r2 = random.Random(f"old-ea-{seed}")
    ea_attrs = sorted(klass[0]["ratings_ea"])

    def compact(q):
        r = [q["ratings_ea"][k] for k in ea_attrs]
        return {"id": q["id"], "pos": q["ea_position"], "r": r, "g": [q["potential_ea"][k] - q["ratings_ea"][k] for k in ea_attrs], "o": q["overall_ea"]}
    state = {"id": f"ea-{seed}"}
    if with_league:
        pool = r2.sample(klass, 260)
        state["league"] = {"attrs": list(ea_attrs), "teams": {f"team-{i}": {"roster": [compact(q) for q in pool[i * 80:(i + 1) * 80]]} for i in range(3)}}
        state["offseason"] = {"portal": {"players": {q["id"]: {"player": compact(q)} for q in pool[240:]}}}
    if with_class:
        rc = {"attrs": list(ea_attrs), "prospects": {}, "reads": {}}
        for q in copy.deepcopy(r2.sample(klass, 150)):
            q["ratings_ea"] = [q["ratings_ea"][k] for k in ea_attrs]
            q["potential_ea"] = [q["potential_ea"][k] for k in ea_attrs]
            q["truth"] = {g: round(r2.uniform(30, 90), 1) for g in recruiting.GROUPS}
            q["coachability"] = q.get("coachability") or "Steady Grinder"
            q.pop("ratings", None)
            rc["prospects"][q["id"]] = q
        for pid in r2.sample(sorted(rc["prospects"]), 60):
            rc["reads"][pid] = {"looks": 2, "by": {"60": 2}, "g": {g: [round(r2.uniform(30, 90), 3), 0.05] for g in recruiting.GROUPS}}
        rc["reads"]["r1999-0001"] = {"looks": 1, "g": {g: [50.0, 0.02] for g in recruiting.GROUPS}}      # a read of someone gone
        state["recruiting"] = rc
    return state


run_upgrade("upgrade", old_ea(1))
run_upgrade("upgrade", old_ea(2, with_class=False))
run_upgrade("upgrade", old_ea(3, with_league=False))
st = old_ea(4)
run_upgrade("upgrade", st)
run_upgrade("upgrade", st)                                  # ours now: nothing to do
run_upgrade("upgrade", {"id": "empty"})

out = Path(sys.argv[1] if len(sys.argv) > 1 else "game_scale_reference.json")
out.write_text(json.dumps({"cases": cases, "upgrades": upgrades}, separators=(",", ":")), encoding="utf-8")
print(f"{len(cases)} cases and {len(upgrades)} upgrades written to {out}")
