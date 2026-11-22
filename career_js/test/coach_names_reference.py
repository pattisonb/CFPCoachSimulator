"""coach_career/coach_names.py's answers on the real data, for coach_names_compare.mjs to hold career_js/coach_names.js to:
python3 career_js/test/coach_names_reference.py OUT   (then: node career_js/test/coach_names_compare.mjs OUT)

The real coaches' names (from the teams file alone, then from the loaded teams), every program's own coordinators'
names, middle initials, a coordinator's day-one name, and `distinct` on many careers made from the real 2026 league
(league.from_base, its rosters left out: nothing here reads them): your coach created or taken over, a job taken in
the offseason, names shared on purpose between real coaches, generated ones, the market and your staff, repeated ids.
carousel._age is not part of this port: the ages it gave are recorded for the compare to replay."""
import copy, json, os, random, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("CFP_CLEAR", "0")
out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)

from coach_career import carousel, coach_names, league
from sim import season


def write(name, data):
    (out / name).write_text(json.dumps(data), encoding="utf-8")


ages = {}
_age = carousel._age


def age(c, year):
    a = _age(c, year)
    ages[f"{c.get('name')}|{year}"] = list(c["age_at"])
    return a


carousel._age = age

assert not season._teams_cache
from_file = sorted(coach_names.base_names())
teams = season.load_teams()
from_teams = sorted(coach_names.base_names())
write("base_names.json", {"from_file": from_file, "from_teams": from_teams})

rng = random.Random("coach-names-reference")
lgd = league.from_base(2027)
lgd = {"year": lgd["year"], "teams": {s: {"coaches": t["coaches"]} for s, t in lgd["teams"].items()}}
slugs = sorted(lgd["teams"])
real = [c["name"] for t in lgd["teams"].values() for c in t["coaches"].values() if c and c.get("name")]
doubles = [s for s in slugs if any((lgd["teams"][s]["coaches"].get(r) or {}).get("name") == (lgd["teams"][s]["coaches"].get("head_coach") or {}).get("name")
                                   for r in coach_names.ROLES[1:])]

small = {"doubles": doubles,
         "own_name": [[s, r, res, coach_names.own_name(s, r, set(res))] for s in slugs + ["new-team-0", None] for r in coach_names.ROLES[1:]
                      for res in ([], ["Some One"], rng.sample(real, 3))]}
small["own_name_default"] = [[s, coach_names.own_name(s, "offensive_coordinator")] for s in slugs[:10]]
wi = []
for name in rng.sample(real, 150) + ["Cher", "Mary Jo Van Der Berg III", "", " Lead Space", "José Ángel Núñez", "O'Neil  Two"]:
    first, _, rest = name.partition(" ")
    every = {(f"{first} {l}. {rest}" if rest else f"{first} {l}.").lower() for l in coach_names.INITIALS}
    for taken in (set(), set(rng.sample(sorted(every), 6)), set(rng.sample(sorted(every), 17)), every):
        where = rng.choice(("ohio-state-head_coach", "None-m12", "texas-defensive_coordinator"))
        wi.append([name, sorted(taken), where, coach_names.with_initial(name, set(taken), where)])
small["with_initial"] = wi
cn = []
for s in rng.sample(slugs, 40) + doubles[:10]:
    cs = lgd["teams"][s]["coaches"]
    hc = (cs.get("head_coach") or {}).get("name")
    for role in coach_names.ROLES[1:]:
        name = (cs.get(role) or {}).get("name")
        for a, b in ((name, hc), (name, name), (name, (name or "").upper()), (None, hc), (name, None), ("", ""), (hc, hc)):
            for created in (False, True):
                cn.append([s, role, a, b, created, coach_names.coordinator_name(s, role, a, b, created)])
small["coordinator_name"] = cn
write("small.json", small)


def staff_of(lg, team, r):
    """A staff as recruiting.make_staff leaves one: the two coordinators by the data's names, then recruiters."""
    cs = lg["teams"][team]["coaches"]
    staff = [{"id": f"{team}-oc", "role": "OC", "name": (cs.get("offensive_coordinator") or {}).get("name") or "Vacant Oc"},
             {"id": f"{team}-dc", "role": "DC", "name": (cs.get("defensive_coordinator") or {}).get("name") or "Vacant Dc"}]
    for i in range(r.randint(2, 6)):
        staff.append({"id": r.choice((f"rec-{i}", "rec-0", f"{team}-oc")), "role": r.choice(("WR", "DL", "Recruiter", "ST")),
                      "name": r.choice((f"Recruiter {i} Of {team}", r.choice(real), staff[r.randrange(len(staff))]["name"], "Pat Same"))})
    return staff


def career(i):
    r = random.Random(f"career-{i}")
    lg = copy.deepcopy(lgd)
    team = doubles[i % len(doubles)] if i % 3 == 0 and doubles else r.choice(slugs)
    state = {"id": f"c{i}", "team": team, "year": r.choice((2026, 2027, None)), "league": lg}
    kind = i % 6
    names = sorted(lg["teams"])
    if kind in (1, 2, 4):                       # a coach you created: a new name, a real coach's, or your own coordinator's
        cs = lg["teams"][team]["coaches"]
        name = ("Coach You %d" % i, r.choice(real), (cs.get("offensive_coordinator") or {}).get("name") or "Coach You")[i % 3]
        state["career"] = {"coach": {"name": name}}
        state["coach"] = {"age": r.choice((41, "38", 52.7, None, 0))}
    if kind in (2, 3):                          # the offseason: a job taken (or not), its year
        state["offseason"] = {"year": r.choice((2027, 2028, None)), "move_to": r.choice((None, r.choice(names)))}
    if kind == 3:                               # an older save healed: your record marked already, somewhere else
        lg["teams"][r.choice(names)]["coaches"]["head_coach"]["you"] = True
    if i % 4 == 1:                              # names shared on purpose: real with real, generated with generated, vacant slots
        for _ in range(12):
            a, b = r.sample(names, 2)
            ra, rb = r.choice(coach_names.ROLES), r.choice(coach_names.ROLES)
            ca, cb = lg["teams"][a]["coaches"].get(ra), lg["teams"][b]["coaches"].get(rb)
            if ca and cb and ca.get("name"):
                cb["name"] = ca["name"] if r.random() < 0.8 else ca["name"].upper()
                if r.random() < 0.5:
                    cb.pop("age_at", None)
        for j in range(8):
            a, b = r.sample(names, 2)
            for s in (a, b):
                c = lg["teams"][s]["coaches"].get(r.choice(coach_names.ROLES[1:]))
                if c:
                    c["name"] = f"Made Up {i} {j}"
                    c.pop("age_at", None)
        for s in r.sample(names, 5):
            lg["teams"][s]["coaches"][r.choice(coach_names.ROLES[1:])] = r.choice((None, {}, {"name": None, "vacant": True}, {"name": "", "coach_id": "x"}))
    if i % 4 in (1, 2):                         # the market: coaches for hire, some under names in use
        market = []
        for j in range(r.randint(5, 25)):
            name = r.choice((f"Free Agent {j}", f"Free Agent {j % 3}", r.choice(real), r.choice(real).lower(), "Pat Same"))
            e = {"id": r.choice((f"m{j}", j, f"m{j % 7}")), "name": name}
            if r.random() < 0.7:
                e["coach"] = {"name": name, "ratings": {"overall": 50}} if r.random() < 0.9 else "none"
            market.append(e)
        market = list({str(e["id"]): e for e in market}.values())           # one entry an id, ids all text or all numbers
        if any(isinstance(e["id"], int) for e in market):
            for e in market:
                e["id"] = str(e["id"])
        lg["market"] = {"coaches": market}
    if i % 5 == 2:                              # ids repeated across records
        for s in r.sample(names, 10):
            for role in coach_names.ROLES:
                c = lg["teams"][s]["coaches"].get(role)
                if c:
                    c["coach_id"] = r.choice(("dup:1", "dup:2", f"{s}:{role}", None, f"{names[0]}:head_coach"))
    if i % 2 == 0 or kind == 5:
        state["career"] = dict(state.get("career") or {}, staff=staff_of(lg, team, r))
    if kind == 5:                               # before the league exists: your staff alone (make_staff's day one)
        del state["league"]
        if i % 12 == 5:
            state["career"]["coach"] = {"name": state["career"]["staff"][i % 2]["name"]}
        if i % 24 == 11:
            state["league"] = None
    if i % 17 == 16:                            # a league alone (a league file's check): no one is you
        state = {"league": lg}
    return state


cases = []
for i in range(120):
    state = career(i)
    built = i % 7 == 3
    before = copy.deepcopy(state)
    reads = copy.deepcopy([coach_names._you_slug(state), coach_names.your_record(state), coach_names.player_name(state)])
    first = coach_names.distinct(state, built)
    after = copy.deepcopy(state)
    second = coach_names.distinct(state)
    cases.append({"state": before, "built": built, "reads": reads, "renames": first, "after": after, "renames_again": second, "after_again": state})
write("cases.json", cases)
write("ages.json", ages)
print("written", sorted(p.name for p in out.iterdir()), "careers", len(cases), "renames", sum(len(c["renames"]) for c in cases),
      "ages asked", len(ages), "second pass renames", sum(len(c["renames_again"]) for c in cases))
