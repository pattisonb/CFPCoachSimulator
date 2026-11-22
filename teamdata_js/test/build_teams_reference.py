"""Python's answers for teamdata_js/build_teams.js (the port is held to them exactly):
    python3 teamdata_js/test/build_teams_reference.py OUTDIR && node teamdata_js/test/build_teams_compare.mjs OUTDIR

Writes into OUTDIR:
  cases.json          {"cases": [[function, [arguments], answer], ...]}: the small functions on real players
  build_<name>.json   {"settings", "sources" (or null: the source files as they are), "real", "observed", "styles",
                       "out", "printed"}: whole builds (the real 2026 build, with and without each switch; a career's
                       league as league.build makes it, with a new coach's style and a team's observed style dropped)
  steps.json          the build's steps one at a time on the real teams, each step's answer and the teams after it"""
import contextlib
import copy
import io
import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from coach_career import league                      # noqa: E402
from teamdata import build_teams as bt, game_scale   # noqa: E402

OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)


def sources():
    return [json.loads(p.read_text(encoding="utf-8")) for p in sorted((bt.SRC / "teams").glob("*.json"))]


def mixed_sums(srcs):
    """How many avg() calls would sum a Python int after a float (PORTING.md: the one sum the two cannot agree on)."""
    n = 0
    for t in srcs:
        for p in t["roster"]:
            seen_float = False
            for v in (p.get("ratings") or {}).values():
                if isinstance(v, float):
                    seen_float = True
                elif seen_float and isinstance(v, int):
                    n += 1
                    break
    return n


# ---- the small functions ------------------------------------------------------------------------------------------
cases = []


def case(fn, *args):
    given = copy.deepcopy(args)
    out = getattr(bt, fn)(*given)
    if isinstance(out, set):
        out = sorted(out)
    cases.append([fn, list(args), out])
    return out


SRCS = sources()
rng = random.Random("build-teams-reference")
POSITIONS = [None] + sorted(set(bt.POSITION_MAP.values()))
for t in SRCS:
    case("display_school", t["school_name"])
    case("starter_slugs", {"starters": t["starters"]})
for t in rng.sample(SRCS, 24):
    for p in t["roster"]:
        slim = {k: p.get(k) for k in ("name", "slug", "position", "overall", "class", "height", "weight_lbs", "jersey", "dev_trait", "ratings")}
        for pos in POSITIONS:
            case("map_player", slim, pos)
r = SRCS[0]["roster"][0]["ratings"]
case("avg", r, "agility", "juke_move", "break_sack")
case("avg", r, "no_such", "nor_this")
case("avg", {"a": 1, "b": 2.5, "c": None, "d": "x", "e": True}, "a", "b", "c", "d", "e")
for x in [-5, 0, 0.5, 1.5, 2.5, 49.5, 50.5, 98.5, 99.4, 99.5, 120, 54.99999, 55.5]:
    case("clamp_rating", x)
    case("clamp_tendency", x)
    case("to_engine", x, 47.3)
for p in [{"depth": 2}, {"depth": None}, {}, {"depth": 0}]:
    case("depth_key", p)
# avg takes its keys as an array in JavaScript: the compare script calls it so
for c in cases:
    if c[0] == "avg":
        c[1] = [c[1][0], c[1][1:]]

# a made-up team for the hand edits, and the real data's own hand edits through a given dict
fake = [{"slug": "x", "players": [{"slug": "a", "passing": 50, "decision_making": 3, "speed": 98.6}, {"slug": "b", "passing": None}]}]
manual = {"ratings": {"x": {"a": {"passing": 10, "decision_making": -5, "nope": 3, "speed": 4}, "zzz": {"passing": 1}, "b": {"passing": 2}}}}
got = copy.deepcopy(fake)
cases.append(["apply_manual_ratings", [fake, manual], [bt.apply_manual_ratings(got, manual), got]])

(OUT / "cases.json").write_text(json.dumps({"cases": cases, "mixed_sums": mixed_sums(SRCS)}), encoding="utf-8")
print(f"cases.json: {len(cases)} cases; rosters whose ratings mix a float then an int: {mixed_sums(SRCS)}")


# ---- whole builds ---------------------------------------------------------------------------------------------------
def whole(name, srcs=None, real=True, observed=None, styles=None, quiet=True, **settings):
    """One build with the module's switches set to `settings`, written with what it printed."""
    before = {k: getattr(bt, k) for k in settings}
    for k, v in settings.items():
        setattr(bt, k, v)
    given = copy.deepcopy(srcs) if srcs is not None else sources()
    printed = io.StringIO()
    try:
        with contextlib.redirect_stdout(printed):
            out = bt.build(given, real=real, observed=None if observed is None else set(observed), quiet=quiet, styles=styles)
    finally:
        for k, v in before.items():
            setattr(bt, k, v)
    (OUT / f"build_{name}.json").write_text(json.dumps({
        "settings": settings, "sources": srcs, "real": real, "observed": observed, "styles": styles, "quiet": quiet,
        "out": out, "printed": printed.getvalue(), "sources_after": given if srcs is not None else None}), encoding="utf-8")
    print(f"build_{name}.json: {len(out['teams'])} teams")
    return out


whole("real", quiet=False)                                  # the command's build, and what it prints
whole("real_unfrozen", USE_FROZEN=False)                    # the card scale measured, not read (game_scale.fit's build)
whole("real_top_scale_1", TEAM_LEVEL_TOP_SCALE=1.0, quiet=False)
whole("real_no_clamp", CLAMP_EXTREMES=False)
whole("real_spread", SPREAD_SCALE=1.3)

# a career's league, as league.build hands it over (real=False): the built-in league a year on, your team's depth by
# overall; then the same with new head coaches (their teams' observed styles dropped, another team's style played)
lgd = league.from_base(league.FIRST_YEAR + 1)
slugs = sorted(lgd["teams"])
me = "smu" if "smu" in lgd["teams"] else slugs[0]
srcs = league.source_teams(lgd, me)
print("league sources: rosters whose ratings mix a float then an int:", mixed_sums(srcs))
styles = {s: t.get("style", s) for s, t in lgd["teams"].items()}
whole("league", srcs, real=False, styles=styles)
moved = rng.sample(slugs, 30)
styles2 = dict(styles)
for s in moved[:15]:
    styles2[s] = rng.choice(slugs)
whole("league_moved", srcs, real=False, observed=[s for s in slugs if s not in moved], styles=styles2)
whole("league_printed", srcs[:40], real=False, quiet=False)
whole("league_as_real", srcs, real=True)                     # the real adjustments over a league's teams (players with no "_src" change)

# ---- the steps, one at a time ---------------------------------------------------------------------------------------
def strip(teams):
    """The teams without the players' source cards (as big as the source files, and compared in the builds)."""
    out = copy.deepcopy(teams)
    for t in out:
        for p in t["players"]:
            if "_src" in p:
                p["_src"] = True
    return out


steps = []
teams = [bt.team_from_source(t) for t in sources()]
steps.append(["team_from_source", None, strip(teams)])
means = bt.normalize(teams)
steps.append(["normalize", means, strip(teams)])
shifts = bt.team_level(teams)
steps.append(["team_level", shifts, strip(teams)])
bt.house_attributes(teams)
steps.append(["house_attributes", dict(bt.ATTR_SCALE), strip(teams)])
ans = bt.apply_real_adjustments(teams, means)
steps.append(["apply_real_adjustments", list(ans), strip(teams)])
ans = bt.apply_manual_ratings(teams)
steps.append(["apply_manual_ratings", ans, strip(teams)])
for t in teams:
    bt.depth_sort(t)
steps.append(["depth_sort", None, strip(teams)])
bt.house_attributes(teams)
steps.append(["house_attributes", dict(bt.ATTR_SCALE), strip(teams)])
bt.ratings_at_every_position(teams, means)
steps.append(["ratings_at_every_position", None, strip(teams)])
ans = bt.normalize_tendencies(teams)
steps.append(["normalize_tendencies", ans, strip(teams)])
ans = bt.decouple_discipline(teams)
steps.append(["decouple_discipline", ans, strip(teams)])
ans = bt.apply_observed_tendencies(teams)
steps.append(["apply_observed_tendencies", ans, strip(teams)])
ans = bt.measured_recruiting(teams)
steps.append(["measured_recruiting", ans, strip(teams)])
steps.append(["engine_roster", [list(bt.engine_roster(t)) for t in teams[:12]], None])
(OUT / "steps.json").write_text(json.dumps({"steps": steps}), encoding="utf-8")
print(f"steps.json: {len(steps)} steps")

# league.py's own call of measured_recruiting (teams of {"slug", "coaches"} only)
few = [{"slug": s, "coaches": copy.deepcopy(v["coaches"])} for s, v in lgd["teams"].items()]
for t in few[::3]:
    t["coaches"]["head_coach"]["ratings"]["recruiting"] = 1
before = copy.deepcopy(few)
n = bt.measured_recruiting(few)
(OUT / "measured.json").write_text(json.dumps({"before": before, "n": n, "after": few}), encoding="utf-8")
print("measured.json:", n, "coaches")
