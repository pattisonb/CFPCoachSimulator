"""The Python answers teamdata_js/ratings.js and teamdata_js/shown.js are held to: every public function of
teamdata/ratings.py and teamdata/shown.py on the real rosters (cfb_sim_data/teams/*.json, data/engine_teams.json) and
on grids of numbers, written with their inputs as JSON.

    python3 teamdata_js/test/ratings_reference.py out.json && node teamdata_js/test/ratings_compare.mjs out.json
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from teamdata import game_scale, ratings, shown   # noqa: E402

GROUPS = ["QB", "RB", "FB", "WR", "TE", "OL", "DL", "LB", "CB", "S", "K", "P"]
POSITIONS = GROUPS + ["MLB", "ROLB", "LOLB", "LS", "ATH", ""]
ROLES = [None, "FB", "HB", "MIKE"]
ROLE_POSITION = {"QB": "QB", "HB": "RB", "FB": "RB", "WR": "WR", "TE": "TE", "LT": "OL", "LG": "OL", "C": "OL", "RG": "OL", "RT": "OL",
                 "LEDG": "DL", "REDG": "DL", "DT": "DL", "MIKE": "MLB", "WILL": "ROLB", "SAM": "LOLB", "CB": "CB", "FS": "S", "SS": "S",
                 "K": "K", "P": "P"}


def pairs(d):
    """A dict as its items in order (JSON objects lose the order of number-like keys in JavaScript)."""
    return [[k, pairs(v) if isinstance(v, dict) else v] for k, v in d.items()]


def main(out_path):
    cases = []          # [function, [arguments], answer]

    def add(fn, args, answer):
        cases.append([fn, args, answer])

    engine = json.loads((ROOT / "data" / "engine_teams.json").read_text(encoding="utf-8"))["teams"]
    source = {}
    for f in sorted((ROOT / "cfb_sim_data" / "teams").glob("*.json")):
        source[f.stem] = json.loads(f.read_text(encoding="utf-8"))

    # ----- ratings: the tables -----
    tables = {
        "ratings.ATTRIBUTES": [[k, list(v[:3])] for k, v in ratings.ATTRIBUTES.items()],
        "ratings.PHYSICAL": ratings.PHYSICAL,
        "ratings.POSITION_ATTRIBUTES": pairs(ratings.POSITION_ATTRIBUTES),
        "ratings._CARD_GROUP": pairs(ratings._CARD_GROUP),
        "ratings.ARCHETYPES": pairs(ratings.ARCHETYPES),
        "ratings.TRAITS": [[k, list(v)] for k, v in ratings.TRAITS.items()],
        "ratings.TRAIT_TIERS": pairs(ratings.TRAIT_TIERS),
        "ratings.TIER_NAMES": [[str(k), v] for k, v in ratings.TIER_NAMES.items()],
        "ratings.TRAIT_INFO": [[k, list(v)] for k, v in ratings.TRAIT_INFO.items()],
        "ratings.TRAIT_KEYS": pairs(ratings.TRAIT_KEYS),
        "ratings.COMPOSITES": pairs(ratings.COMPOSITES),
        "shown.OVERALL_KNOTS": shown.OVERALL_KNOTS, "shown.LOW": shown.LOW, "shown.HIGH": shown.HIGH,
        "shown.TEAM_KNOTS": pairs(shown.TEAM_KNOTS), "shown.COACH_KNOTS": shown.COACH_KNOTS,
        "shown._curve": shown._curve(),
    }

    # ----- ratings: the players of the source rosters -----
    players = []        # the source rosters' players: what the formulas read
    n = 0
    for slug, t in source.items():
        for p in t.get("roster") or []:
            src = p.get("ratings") or {}
            pos = ROLE_POSITION.get(p.get("position"), p.get("position"))
            role = p.get("position")
            i = len(players)
            players.append({"ratings": src, "position": pos, "role": role, "height": p.get("height"), "abilities": p.get("abilities")})
            add("ratings.formulas", [i], [f[3](src) for f in ratings.ATTRIBUTES.values()])
            add("ratings.raw_attributes", [i, pos, role], pairs(ratings.raw_attributes(src, pos, role)))
            add("ratings.raw_attributes", [i, pos], pairs(ratings.raw_attributes(src, pos)))
            other = POSITIONS[n % len(POSITIONS)]
            add("ratings.raw_attributes", [i, other, ROLES[n % len(ROLES)]], pairs(ratings.raw_attributes(src, other, ROLES[n % len(ROLES)])))
            add("ratings.height_inches", [p.get("height")], ratings.height_inches(p.get("height")))
            add("ratings.traits_of", [p.get("abilities")], ratings.traits_of(p.get("abilities")))
            n += 1
    # source ratings with holes in them, and values that are not numbers
    for i in range(0, len(players), 7):
        src = dict(players[i]["ratings"])
        for j, k in enumerate(list(src)):
            if (i + j) % 5 == 0:
                del src[k]
            elif (i + j) % 5 == 1:
                src[k] = None
            elif (i + j) % 11 == 2:
                src[k] = src[k] + 0.35
            elif (i + j) % 13 == 3:
                src[k] = "80"
            elif (i + j) % 17 == 4:
                src[k] = True
        add("ratings.formulas_of", [src], [f[3](src) for f in ratings.ATTRIBUTES.values()])
        pos = players[i]["position"]
        add("ratings.raw_attributes_of", [src, pos, None], pairs(ratings.raw_attributes(src, pos, None)))
    add("ratings.formulas_of", [{}], [f[3]({}) for f in ratings.ATTRIBUTES.values()])
    for pos in POSITIONS:
        for role in ROLES:
            add("ratings.card_group", [pos, role], ratings.card_group(pos, role))
            add("ratings.composite_weights", [pos, role], pairs(ratings.composite_weights(pos, role)))
            add("ratings.raw_attributes_of", [{}, pos, role], pairs(ratings.raw_attributes({}, pos, role)))
        add("ratings.card_group", [pos], ratings.card_group(pos))
        add("ratings.composite_weights", [pos], pairs(ratings.composite_weights(pos)))
    for h in [74, 74.9, -3.7, True, False, None, "", "6'", "'5", "6'2\"", "6'2", " 6 ' 2 ", "6'2'1", "abc", "6'x", "x'2", "6'-1", "+6'1_0",
              "6' ", "6.5'2", "06'02\"", "5'11\"\"", "\"6'4\"", "6", [1], {}, ["6'2"], "6'1__0", "_6'1", "6'1_"]:
        add("ratings.height_inches", [h], ratings.height_inches(h))
    for t in engine.values():
        for unit in ("offense", "defense"):
            for p in t[unit]:
                add("ratings.height_inches", [p.get("height")], ratings.height_inches(p.get("height")))
    for ab in [None, [], [{}], [{"name": "Workhorse"}], [{"tier": "Gold"}], [{"name": "Workhorse", "tier": "Locked"}],
               [{"name": "Takeoff", "tier": "Bronze"}, {"name": "Take Off", "tier": "Gold"}, {"name": "360", "tier": "Gold"},
                {"name": "50/50", "tier": "Platinum"}, {"name": "Workhorse", "tier": "Gold"}, {"name": "Nobody's", "tier": "Gold"}],
               [{"name": "Take Off", "tier": "Gold"}, {"name": "Takeoff", "tier": "Bronze"}],
               [{"name": "constructor", "tier": "Gold"}, {"name": "Dot!", "tier": "toString"}, {"name": None, "tier": None}],
               [{"name": k, "tier": ["Bronze", "Silver", "Gold", "Platinum"][j % 4]} for j, k in enumerate(ratings.TRAITS)],
               [{"name": k, "tier": "Silver"} for k in ratings.TRAITS]]:
        add("ratings.traits_of", [ab], ratings.traits_of(ab))

    # ----- shown: the lines -----
    grid = [i / 10 for i in range(-50, 1101)] + [i / 7 for i in range(0, 700, 3)]
    odd = [None, True, False, "x", [50]]
    for x in grid:
        add("shown.overall_exact", [x], shown.overall_exact(x))
        add("shown.overall", [x], shown.overall(x))
        add("shown.overall_back", [x], shown.overall_back(x))
        add("shown.coach", [x], shown.coach(x))
        add("shown.from_base", [x], shown.from_base(x))
        add("shown.to_base", [x], shown.to_base(x))
        for kind in ("overall", "offense", "defense", "special_teams", "unit", "nope", "", None):
            add("shown.team", [x, kind], shown.team(x, kind))
        add("shown.team", [x], shown.team(x))
        add("shown.gain", [x, x + 3.3], shown.gain(x, x + 3.3))
        add("shown.gain", [x, 100 - x], shown.gain(x, 100 - x))
        for name, knots in (("OVERALL_KNOTS", shown.OVERALL_KNOTS), ("COACH_KNOTS", shown.COACH_KNOTS), ("unit", shown.TEAM_KNOTS["unit"])):
            add("shown._line", [name, x], shown._line(knots, x))
    for x in range(-5, 106):
        for f in ("overall_exact", "overall", "overall_back", "coach", "from_base", "to_base", "team"):
            add("shown." + f, [x], getattr(shown, f)(x))
    for x in odd:
        add("shown.overall", [x], shown.overall(x))
        add("shown.team", [x], shown.team(x))
        add("shown.team", [x, "offense"], shown.team(x, "offense"))
        add("shown.coach", [x], shown.coach(x))
        add("shown.skill", [x, "QB", "speed"], shown.skill(x, "QB", "speed"))
        for g in ("QB", "FB"):
            add("shown.attribute", [x, g, "top_speed"], shown.attribute(x, g, "top_speed"))
            add("shown.attribute", [x, g, "no_such"], shown.attribute(x, g, "no_such"))
    for x in ("70", " 55.5 "):
        add("shown.overall_exact", [x], shown.overall_exact(x))
        add("shown.overall_back", [x], shown.overall_back(x))
        add("shown.to_base", [x], shown.to_base(x))

    # ----- shown: the real teams, coaches and players -----
    def numbers(o, out):
        if isinstance(o, dict):
            for v in o.values():
                numbers(v, out)
        elif isinstance(o, list):
            for v in o:
                numbers(v, out)
        elif isinstance(o, (int, float)):
            out.append(o)
        return out

    for slug, t in engine.items():
        r = t.get("team_ratings")
        add("shown.team_ratings", [r], pairs(shown.team_ratings(r)))
        r2 = dict(r or {})
        r2["roster_avg"] = 40 + len(slug) * 1.7
        r2["position_groups"] = {g: 30 + (len(slug) * 7 + j * 5) % 60 + 0.5 for j, g in enumerate(GROUPS)}
        r2["position_groups"]["none"] = None
        add("shown.team_ratings", [r2], pairs(shown.team_ratings(r2)))
        for x in numbers(t.get("coaches"), []):
            add("shown.coach", [x], shown.coach(x))
        keys = game_scale.keys()
        for unit in ("offense", "defense"):
            for p in t[unit]:
                g = game_scale.group(p["position"])
                cg = ratings.card_group(p["position"], p.get("role"))
                add("shown.overall", [p.get("ovr")], shown.overall(p.get("ovr")))
                for x in (p.get("ratings_at") or {}).values():
                    add("shown.overall", [x], shown.overall(x))
                sk = p.get("skills")
                if sk:
                    add("shown.skills", [sk, g], [shown.skill(v, g, k) for k, v in zip(keys, sk)])
                at = p.get("attributes")
                if at:
                    add("shown.attributes", [pairs(at), cg], [shown.attribute(v, cg, k) for k, v in at.items()])
    for slug, t in source.items():
        r = t.get("team_ratings")
        add("shown.team_ratings", [r], pairs(shown.team_ratings(r)))
        for x in numbers(t.get("coaches"), []):
            add("shown.coach", [x], shown.coach(x))
    for r in (None, {}, {"overall": None, "offense": True, "defense": "x", "special_teams": 51.25, "roster_avg": None,
                         "position_groups": [1, 2], "other": {"a": 1}},
              {"position_groups": {}, "roster_avg": True}, {"position_groups": None, "special_teams": 20}):
        add("shown.team_ratings", [r], pairs(shown.team_ratings(r)))

    # ----- shown: every skill and card attribute, at every stored and shown value -----
    values = list(range(1, 100)) + [0.5, 49.5, 50.0, 50.5, 63.25, 99.5, 0, 100, -4, 120]
    for g in game_scale.data()["skills"]:
        for k in game_scale.keys():
            add("shown.skill_grid", [g, k, values], [shown.skill(v, g, k) for v in values])
            add("shown.skill_back_grid", [g, k, values], [shown.skill_back(v, g, k) for v in values])
    card_keys = sorted({c.split("|")[1] for c in game_scale.card_scale()}) + ["no_such"]
    for g in GROUPS + ["MLB"]:
        for k in card_keys:
            add("shown.attribute_grid", [g, k, values], [shown.attribute(v, g, k) for v in values])
            add("shown.attribute_back_grid", [g, k, values], [shown.attribute_back(v, g, k) for v in values])
            add("shown._card", [g, k], shown._card(g, k))

    Path(out_path).write_text(json.dumps({"tables": tables, "players": players, "cases": cases}), encoding="utf-8")
    counts = {}
    for c in cases:
        counts[c[0]] = counts.get(c[0], 0) + 1
    print(f"{len(cases)} cases, {len(players)} source players, {len(tables)} tables -> {out_path}")
    for k in sorted(counts):
        print(f"  {k}: {counts[k]}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "out.json")
