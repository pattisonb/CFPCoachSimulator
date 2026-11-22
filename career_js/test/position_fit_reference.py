"""Python's answers for career_js/position_fit.js and sim_js/game_job.js's with_positions, written as JSON for
position_fit_compare.mjs to hold the JavaScript to:

    python3 career_js/test/position_fit_reference.py out.json && node career_js/test/position_fit_compare.mjs out.json
"""
import copy
import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from coach_career import league, offseason, position_fit    # noqa: E402
from sim import season                                      # noqa: E402
from teamdata import game_scale                             # noqa: E402

ROLES = list(position_fit.SKILL_GROUP)
ENGINE_POSITIONS = ["QB", "RB", "WR", "TE", "OL", "DL", "MLB", "ROLB", "LOLB", "CB", "S", "K", "P"]
N_PLAYERS = 2400      # players of data/engine_teams.json moved to every role
N_ROWS = 400          # league rows for move_row / settle
N_TEAMS = 48          # teams for with_positions


def main(out_path: str) -> None:
    teams = json.loads((ROOT / "data" / "engine_teams.json").read_text(encoding="utf-8"))["teams"]
    keys = game_scale.keys()
    out: dict = {"roles": ROLES, "engine_positions": ENGINE_POSITIONS}
    out["sizes"] = position_fit.sizes()

    # size_penalty: a grid of builds at every position (and one the table does not have)
    builds = [(h, w) for h in (None, 0, 64, 68, 70.5, 72, 74, 77, 80) for w in (None, 0, 150, 175, 190.5, 205, 230, 260, 300, 345)]
    out["size_penalty"] = [[h, w, pos, position_fit.size_penalty(h, w, pos)] for h, w in builds for pos in ROLES + ["ATH"]]

    # the players: every one with skills and a role, in the file's order, every step-th of them
    everyone = [(slug, unit, i) for slug, t in teams.items() for unit in ("offense", "defense") for i, p in enumerate(t[unit])
                if p.get("skills") and p.get("role") in position_fit.SKILL_GROUP]
    step = max(1, len(everyone) // N_PLAYERS)
    picked = everyone[::step]
    rows = []
    for n, (slug, unit, i) in enumerate(picked):
        p = teams[slug][unit][i]
        attrs = dict(zip(keys, p["skills"]))
        h, w, role = p.get("height_in"), p.get("weight"), p["role"]
        row = {"at": [slug, unit, i], "role": role,
               "season_move": [position_fit.season_move(p, role, to) for to in ROLES],
               "project": [position_fit.project(attrs, h, w, role, to) for to in ROLES]}
        if n % 4 == 0:      # transfer on its own (season_move's skills are transfer's, in keys() order), key order and all
            row["transfer"] = [list(position_fit.transfer(attrs, role, to).items()) for to in ROLES]
        if n % 6 == 0:      # from and to engine positions (ENGINE_TO_EA)
            row["engine"] = [[position_fit.project(attrs, h, w, p["position"], to), list(position_fit.transfer(attrs, p["position"], to).values())]
                             for to in ENGINE_POSITIONS]
        if n % 3 == 0:      # the position_options rows, where he is and somewhere he is not
            cur = ROLES[(n // 3) % len(ROLES)]
            row["options"] = [[c, position_fit.options(attrs, h, w, role, c, offseason.GROUP)] for c in (role, cur)]
        rows.append(row)
    out["players"] = rows

    # move_row and settle on league rows: there, somewhere else, back home, away again, then the season ends
    lgd = league.from_base()
    attrs = lgd["attrs"]
    rng = random.Random("position-fit-reference")
    roster = [c for slug in sorted(lgd["teams"]) for c in lgd["teams"][slug]["roster"]]
    cases = []
    for c in rng.sample(roster, N_ROWS):
        c = copy.deepcopy(c)
        home = c["pos"]
        a, b = rng.sample([r for r in ROLES if r != home], 2)
        steps = [a, b, home, home, b, a, b] if rng.random() < 0.5 else [a, home, b, b, home]
        case = {"row": copy.deepcopy(c), "steps": steps, "after": []}
        for to in steps:
            position_fit.move_row(c, to, attrs)
            case["after"].append(list(copy.deepcopy(c).items()))
        position_fit.settle([c])
        case["settled"] = list(c.items())
        cases.append(case)
    out["attrs"] = attrs
    out["move_row"] = cases

    # with_positions (and with_edits through "__positions__") on real teams
    offense = [r for r in ROLES if position_fit.UNIT[r] != "defense"]
    defense = [r for r in ROLES if position_fit.UNIT[r] == "defense"]
    moves_cases = []
    for n, slug in enumerate(sorted(teams)[::max(1, len(teams) // N_TEAMS)]):
        team = teams[slug]
        players = [p for p in team["offense"] + team["defense"] if p.get("role")]
        count: dict = {}
        for p in players:
            count[p["role"]] = count.get(p["role"], 0) + 1
        crowded = [r for r in ROLES if count.get(r, 0) >= 3]
        moves: dict = {}
        chosen = rng.sample(players, 1 + n % 4)
        for j, p in enumerate(chosen):
            role = p["role"]
            if j == 0:        # across the ball
                to = rng.choice(defense if role in offense else offense)
            elif j == 1:      # where the team already has several
                to = rng.choice([r for r in crowded if r != role] or ROLES)
            elif j == 2:      # where he already is
                to = role
            else:
                to = rng.choice([r for r in ROLES if r != role])
            moves[p["slug"]] = {"from": role, "to": to, "week": 2}
        if n % 5 == 0:        # two of them to one role (the order they arrive in), a slug nobody has, a role there is not, no move
            a, b = rng.sample([p for p in players if p["slug"] not in moves], 2)
            to = rng.choice([r for r in crowded if r not in (a["role"], b["role"])])
            moves[a["slug"]] = {"from": a["role"], "to": to, "week": 3}
            moves[b["slug"]] = {"from": b["role"], "to": to, "week": 3}
            moves["nobody-at-all"] = {"from": "QB", "to": "WR", "week": 1}
            c = rng.choice([p for p in players if p["slug"] not in moves])
            moves[c["slug"]] = {"from": c["role"], "to": "ATH", "week": 1}
            d = rng.choice([p for p in players if p["slug"] not in moves])
            moves[d["slug"]] = None
        if n % 7 == 3:        # nobody moves: the team comes back as it is
            p = chosen[0]
            moves = {p["slug"]: {"from": p["role"], "to": p["role"], "week": 2}}
        got = season.with_positions(team, moves)
        case = {"slug": slug, "moves": moves, "same": got is team, "keys": list(got), "offense": got["offense"], "defense": got["defense"]}
        if n % 3 == 0:        # the whole of with_edits: your coach is not here, an edit to one of the moved and one who stayed
            edits = {"__positions__": moves, chosen[0]["slug"]: {"speed": 77, "attributes": {"speed": 81}},
                     players[0]["slug"]: {"jersey": "0"}}
            e = season.with_edits(team, edits)
            case["edits"] = edits
            case["edited"] = {"offense": e["offense"], "defense": e["defense"]}
        moves_cases.append(case)
    out["with_positions"] = moves_cases

    Path(out_path).write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(f"{len(out['size_penalty'])} size penalties, {len(rows)} players x {len(ROLES)} roles, {len(cases)} league rows, "
          f"{len(moves_cases)} teams' position changes -> {out_path}")


if __name__ == "__main__":
    main(sys.argv[1])
