"""Your coach: the head coach a player creates (the Your coach page), saved in data/coaches/,
and how he changes the team he takes over in a season.

A coach has an identity and a background (story only), ratings from an archetype, a
coaching style (schemes and tendencies on the league scale, 50 = the FBS average), whether he
calls his own offense and defense, and a look for his sprite. `apply_coach` puts him on a
team: he replaces the head coach, and where he calls his own plays his schemes and
tendencies replace the coordinator's, which the engine reads (docs/HOW_IT_WORKS.md, "Coach
styles").
"""
from __future__ import annotations

import json
import re
import time
import uuid
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parents[1]   # the project root
COACHES_DIR = ROOT / "data" / "coaches"

OFFENSE_SCHEMES = {
    "Air Raid": "Spreads the field and throws: more deep shots and quick throws, little play-action.",
    "West Coast": "Short, timed passes that move the chains: few deep shots, high completion rate.",
    "Spread RPO": "Run-pass options from the spread: quick throws, more outside runs, plenty of play-action.",
    "Power Spread": "Spread formations with a downhill run game: more inside runs and play-action shots.",
    "Spread Option": "Option runs from the spread: more outside runs and quarterback carries.",
    "Pro Style": "Under-center, balanced: inside runs and the most play-action.",
    "Flexbone Triple Option": "The academies' option: the fullback dive, almost no passing, rare deep shots off it.",
    "Multiple": "No fixed identity: the league-average mix.",
}
DEFENSE_SCHEMES = {
    "4-3": "Four linemen and three linebackers: sound against the run.",
    "3-4": "Three linemen and four linebackers: rushers can come from anywhere.",
    "4-2-5": "Four linemen, two linebackers and a nickel back: built for spread offenses.",
    "Multiple 4-2-5": "The 4-2-5 with more disguises.",
    "3-3-5": "Three linemen, three linebackers and three safeties: speed over size.",
    "Tite Front 3-4": "A 3-4 with the tackles pinched inside: stops the inside run.",
}
# rating presets for the archetypes (the sliders start here)
ARCHETYPES = {
    "Offensive Guru": {"about": "Built the offense from the ground up. Elite play-caller on offense, less hands-on with the defense.",
                       "ratings": {"offense": 90, "defense": 60, "recruiting": 65, "player_development": 75, "game_management": 70, "motivation": 70, "discipline": 65}},
    "Defensive Mastermind": {"about": "Came up as a defensive coordinator. The defenses are disciplined and hard to read.",
                             "ratings": {"offense": 60, "defense": 90, "recruiting": 65, "player_development": 75, "game_management": 70, "motivation": 70, "discipline": 80}},
    "Recruiting Ace": {"about": "Wins in living rooms. Brings in talent; leans on coordinators for the X's and O's.",
                       "ratings": {"offense": 68, "defense": 68, "recruiting": 92, "player_development": 70, "game_management": 65, "motivation": 78, "discipline": 62}},
    "Program Builder": {"about": "Turns programs around: develops players, runs a tight ship.",
                        "ratings": {"offense": 70, "defense": 70, "recruiting": 70, "player_development": 88, "game_management": 72, "motivation": 72, "discipline": 82}},
    "Players' Coach": {"about": "Players run through walls for this coach. Loose on the details.",
                       "ratings": {"offense": 70, "defense": 70, "recruiting": 78, "player_development": 75, "game_management": 62, "motivation": 92, "discipline": 55}},
    "Game-Day CEO": {"about": "Manages the clock, the fourth downs and the headset better than anyone.",
                     "ratings": {"offense": 72, "defense": 72, "recruiting": 70, "player_development": 70, "game_management": 92, "motivation": 70, "discipline": 75}},
}
RATING_KEYS = ("offense", "defense", "recruiting", "player_development", "game_management", "motivation", "discipline")
RATING_LABELS = {"offense": "Offense", "defense": "Defense", "recruiting": "Recruiting", "player_development": "Player Development",
                 "game_management": "Game Management", "motivation": "Motivation", "discipline": "Discipline"}
RATING_ABOUT = {
    "offense": "Play-calling on offense, when the coach calls it: wins more of the guessing game.",
    "defense": "Play-calling on defense, when the coach calls it.",
    "recruiting": "Recruiting classes (coming with recruiting).",
    "player_development": "How fast players improve (coming with the offseason).",
    "game_management": "Clock and timeout decisions late in halves (coming with coach mode).",
    "motivation": "How much a hot streak or a big win lifts the team (coming with coach mode).",
    "discipline": "Fewer penalties.",
}
RATING_BUDGET = 525          # the seven ratings may add up to at most this
RATING_LIVE = ("offense", "defense", "discipline")   # the ratings games use today; the rest come with later features
# style sliders: key -> (label, side, what it does in the sim); 50 = the FBS average
STYLE = {
    "pass_rate": ("Pass rate", "offense", "How often the offense calls a pass instead of a run."),
    "tempo": ("Tempo", "offense", "How fast the offense snaps the ball: more plays a game."),
    "deep_shot_rate": ("Deep shots", "offense", "How often throws go 20+ yards downfield."),
    "play_action_rate": ("Play-action", "offense", "How often first- and second-down passes start with a run fake."),
    "fourth_down_go_rate": ("Fourth-down aggressiveness", "head", "How often the team goes for it instead of punting or kicking."),
    "blitz_rate": ("Blitz", "defense", "How often the defense sends extra rushers: more sacks, more big plays allowed."),
    "man_coverage_rate": ("Man coverage", "defense", "How often the defense plays man instead of zone."),
    "press_rate": ("Press", "defense", "How often corners press receivers at the line in man coverage."),
}
# Coordinators to hire after the season (the offseason, coming with coach mode). During a
# season the team's own coordinators stay. Fictional names; each has a scheme, a play-calling
# rating and a style on the league scale.
OC_POOL = {
    "kessler": {"name": "Dale Kessler", "scheme": "Air Raid", "play_calling": 82,
                "about": "Four wide on every snap. Throws it 50 times and takes its shots.",
                "style": {"pass_rate": 78, "tempo": 80, "deep_shot_rate": 72, "play_action_rate": 22}},
    "whitfield": {"name": "Ron Whitfield", "scheme": "West Coast", "play_calling": 79,
                  "about": "Timing routes, ball out quick, chains moving. Rarely throws deep.",
                  "style": {"pass_rate": 62, "tempo": 45, "deep_shot_rate": 25, "play_action_rate": 45}},
    "bell": {"name": "Marcus Bell", "scheme": "Spread RPO", "play_calling": 80,
             "about": "Reads the box on every play and makes the defense wrong.",
             "style": {"pass_rate": 55, "tempo": 72, "deep_shot_rate": 50, "play_action_rate": 72}},
    "price": {"name": "Jalen Price", "scheme": "Power Spread", "play_calling": 78,
              "about": "Spread looks, downhill runs, then play-action over the top.",
              "style": {"pass_rate": 46, "tempo": 60, "deep_shot_rate": 58, "play_action_rate": 66}},
    "brannigan": {"name": "Tom Brannigan", "scheme": "Pro Style", "play_calling": 77,
                  "about": "Under center, two tight ends, run it until they stop it.",
                  "style": {"pass_rate": 40, "tempo": 32, "deep_shot_rate": 45, "play_action_rate": 82}},
    "odom": {"name": "Curtis Odom", "scheme": "Spread Option", "play_calling": 75,
             "about": "The quarterback is a runner first. Outside zone and the read option.",
             "style": {"pass_rate": 36, "tempo": 66, "deep_shot_rate": 40, "play_action_rate": 55}},
    "dorsey": {"name": "Hank Dorsey", "scheme": "Flexbone Triple Option", "play_calling": 74,
               "about": "Dive, keep, pitch. Throws ten times a game and makes them count.",
               "style": {"pass_rate": 10, "tempo": 40, "deep_shot_rate": 30, "play_action_rate": 60}},
    "navarro": {"name": "Eli Navarro", "scheme": "Multiple", "play_calling": 84,
                "about": "No fixed system. Builds the game plan around the players on hand.",
                "style": {"pass_rate": 52, "tempo": 50, "deep_shot_rate": 50, "play_action_rate": 50}},
}
DC_POOL = {
    "lindholm": {"name": "Gary Lindholm", "scheme": "4-3", "play_calling": 80,
                 "about": "Four down linemen, gap sound, zone behind it. Makes you earn it.",
                 "style": {"blitz_rate": 38, "man_coverage_rate": 40, "press_rate": 40}},
    "cole": {"name": "Reggie Cole", "scheme": "3-4", "play_calling": 79,
             "about": "Pressure from every angle. Sacks, and the odd big play allowed.",
             "style": {"blitz_rate": 74, "man_coverage_rate": 58, "press_rate": 55}},
    "okafor": {"name": "Sam Okafor", "scheme": "4-2-5", "play_calling": 82,
               "about": "Built to stop the spread: a nickel on the field and corners up in your face.",
               "style": {"blitz_rate": 50, "man_coverage_rate": 64, "press_rate": 68}},
    "simms": {"name": "Andre Simms", "scheme": "Multiple 4-2-5", "play_calling": 78,
              "about": "Disguises everything. Man coverage, press corners, blitzes off the edge.",
              "style": {"blitz_rate": 62, "man_coverage_rate": 72, "press_rate": 75}},
    "hollis": {"name": "Dwayne Hollis", "scheme": "3-3-5", "play_calling": 76,
               "about": "Speed over size. Three safeties and a lot of zone pressure.",
               "style": {"blitz_rate": 70, "man_coverage_rate": 35, "press_rate": 32}},
    "varga": {"name": "Pete Varga", "scheme": "Tite Front 3-4", "play_calling": 81,
              "about": "Squeezes the inside run, sits in zone, never gives up the deep ball.",
              "style": {"blitz_rate": 32, "man_coverage_rate": 45, "press_rate": 45}},
}
POSITIONS_PLAYED = ("QB", "RB", "WR", "TE", "OL", "DL", "LB", "DB", "K/P", "Did not play")
PLAYING_LEVELS = ("Walk-on", "College starter", "All-conference", "All-American", "NFL")
# the sprite: option lists the page offers (coach.js draws them)
LOOK = {
    "skin": ["#f1d3b8", "#e0b48f", "#c68b5e", "#9c6640", "#734a2c", "#4b2f1d"],
    "hair": ["short", "buzz", "side part", "curly", "bald", "long"],
    "hair_color": ["#1f1a17", "#4a3020", "#8b5a2b", "#c8a165", "#9a9a9a", "#e6e6e6"],
    "facial_hair": ["none", "stubble", "mustache", "goatee", "beard"],
    "glasses": ["none", "round", "square", "sunglasses"],
    "headwear": ["none", "cap", "visor", "headset"],
    "outfit": ["polo", "quarter-zip", "hoodie", "suit"],
}


def blank() -> dict:
    """A new coach with the page's defaults."""
    return {"id": None, "first_name": "", "last_name": "", "age": 42, "hometown": "", "alma_mater": None,
            "archetype": "Program Builder", "ratings": dict(ARCHETYPES["Program Builder"]["ratings"]),
            "played": "Did not play", "playing_level": "Walk-on", "background": "",
            "offense_scheme": "Multiple", "defense_scheme": "4-2-5", "calls_offense": True, "calls_defense": False,
            "style": {k: 50 for k in STYLE},
            "look": {"skin": LOOK["skin"][1], "hair": "short", "hair_color": LOOK["hair_color"][1], "facial_hair": "none",
                     "glasses": "none", "headwear": "cap", "outfit": "polo"}}


def clean(data: dict) -> dict:
    """Validate a coach from the page; raises ValueError with a readable message."""
    c = blank()
    first = str(data.get("first_name") or "").strip()[:30]
    last = str(data.get("last_name") or "").strip()[:30]
    if not first or not last:
        raise ValueError("give your coach a first and last name")
    c.update(first_name=first, last_name=last, id=data.get("id") or None)
    try:
        c["age"] = max(28, min(75, int(data.get("age") or 42)))
    except (TypeError, ValueError):
        raise ValueError("age must be a number")
    c["hometown"] = str(data.get("hometown") or "").strip()[:60]
    c["alma_mater"] = str(data["alma_mater"])[:60] if data.get("alma_mater") else None
    c["background"] = str(data.get("background") or "").strip()[:1500]
    if data.get("archetype") not in ARCHETYPES:
        raise ValueError("pick an archetype")
    c["archetype"] = data["archetype"]
    given_ratings = data.get("ratings") or {}
    preset = ARCHETYPES[c["archetype"]]["ratings"]
    ratings = {}
    for k in RATING_KEYS:
        try:
            ratings[k] = max(40, min(99, int(given_ratings.get(k, preset[k]))))
        except (TypeError, ValueError):
            raise ValueError(f"{RATING_LABELS[k]} must be a number")
    total = sum(ratings.values())
    if total > RATING_BUDGET:
        raise ValueError(f"the ratings add up to {total}; the most is {RATING_BUDGET}")
    c["ratings"] = ratings
    c["played"] = data.get("played") if data.get("played") in POSITIONS_PLAYED else "Did not play"
    c["playing_level"] = data.get("playing_level") if data.get("playing_level") in PLAYING_LEVELS else "Walk-on"
    if data.get("offense_scheme") not in OFFENSE_SCHEMES or data.get("defense_scheme") not in DEFENSE_SCHEMES:
        raise ValueError("pick an offensive and a defensive scheme")
    c["offense_scheme"], c["defense_scheme"] = data["offense_scheme"], data["defense_scheme"]
    c["calls_offense"], c["calls_defense"] = bool(data.get("calls_offense")), bool(data.get("calls_defense"))
    given_style = data.get("style") or {}
    style = {}
    for k in STYLE:
        try:
            style[k] = max(0, min(100, int(given_style.get(k, 50))))
        except (TypeError, ValueError):
            raise ValueError(f"{STYLE[k][0]} must be a number")
    c["style"] = style
    given_look = data.get("look") or {}
    look = {}
    for k, opts in LOOK.items():
        v = given_look.get(k)
        look[k] = v if v in opts else c["look"][k]
    c["look"] = look
    return c


def _path(coach_id: str) -> Path:
    """A saved coach's file; raises ValueError for an id that is not 12 hex characters."""
    if not re.fullmatch(r"[a-f0-9]{12}", coach_id or ""):
        raise ValueError("unknown coach")
    return COACHES_DIR / f"{coach_id}.json"


def save(data: dict) -> dict:
    c = clean(data)
    if c["id"]:
        _path(c["id"])          # validates the id
    else:
        c["id"] = uuid.uuid4().hex[:12]
    c["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    COACHES_DIR.mkdir(parents=True, exist_ok=True)
    _path(c["id"]).write_text(json.dumps(c, indent=1), encoding="utf-8")
    return c


def load(coach_id: str) -> Optional[dict]:
    try:
        p = _path(coach_id)
    except ValueError:
        return None
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def list_all() -> list[dict]:
    if not COACHES_DIR.exists():
        return []
    out = [json.loads(p.read_text(encoding="utf-8")) for p in COACHES_DIR.glob("*.json")]
    return sorted(out, key=lambda c: c.get("updated_at", ""), reverse=True)


def delete(coach_id: str) -> bool:
    p = _path(coach_id)
    if p.exists():
        p.unlink()
        return True
    return False


def options() -> dict:
    """Everything the page needs to build its form."""
    return {"offense_schemes": OFFENSE_SCHEMES, "defense_schemes": DEFENSE_SCHEMES,
            "archetypes": ARCHETYPES, "rating_keys": RATING_KEYS, "rating_labels": RATING_LABELS, "rating_about": RATING_ABOUT,
            "rating_budget": RATING_BUDGET, "rating_live": RATING_LIVE, "style": {k: {"label": v[0], "side": v[1], "about": v[2]} for k, v in STYLE.items()},
            "positions_played": POSITIONS_PLAYED, "playing_levels": PLAYING_LEVELS, "look": LOOK, "blank": blank()}


def _coordinator(team: dict, side: str) -> str:
    """'OC Brian Hartline (Spread RPO)': the team's own coordinator on one side."""
    cs = team.get("coaches") or {}
    hc_scheme = (cs.get("head_coach") or {}).get("scheme") or {}
    if side == "offense":
        oc = cs.get("offensive_coordinator") or {}
        scheme = (oc.get("scheme") or {}).get("offensive_scheme") or hc_scheme.get("offensive_philosophy") or "Multiple"
        return f"OC {oc.get('name') or 'unnamed'} ({scheme})"
    dc = cs.get("defensive_coordinator") or {}
    scheme = (dc.get("scheme") or {}).get("defensive_scheme") or hc_scheme.get("defensive_philosophy") or "4-2-5"
    return f"DC {dc.get('name') or 'unnamed'} ({scheme})"


def staff(coach: Optional[dict], team: dict) -> dict:
    """Who runs each side of the ball this season: {"offense": text, "defense": text}. The
    team's coordinators stay for the season; a created coach who calls a side himself uses
    his own scheme and style on it."""
    out = {}
    for side, calls, scheme in (("offense", "calls_offense", "offense_scheme"), ("defense", "calls_defense", "defense_scheme")):
        if coach and coach.get(calls):
            out[side] = f"calls the {coach[scheme]} {side} as head coach"
        else:
            out[side] = _coordinator(team, side)
    return out


def apply_coach(team: dict, coach: Optional[dict]) -> dict:
    """The team with `coach` as its head coach. The team's coordinators stay for the season;
    where he calls his own offense or defense, his scheme and tendencies are used on that
    side instead of the coordinator's. His head-coach tendencies (fourth downs, discipline)
    always apply. Ratings: his offense or defense rating is the play-calling
    rating on the side he calls."""
    if not coach:
        return team
    t = {**team, "coaches": {k: dict(v) for k, v in (team.get("coaches") or {}).items()}, "tendencies": dict(team.get("tendencies") or {})}
    r, s = coach["ratings"], coach["style"]
    name = f"{coach['first_name']} {coach['last_name']}"
    t["coaches"]["head_coach"] = {
        "name": name, "custom": True,
        "ratings": {**r, "overall": round(sum(r.values()) / len(r))},
        "tendencies": {"fourth_down_go_rate": s["fourth_down_go_rate"], "aggressiveness": s["fourth_down_go_rate"]},
        "scheme": {"offensive_philosophy": coach["offense_scheme"], "defensive_philosophy": coach["defense_scheme"]},
    }
    tend = t["tendencies"]
    # discipline on the team is relative to its talent (build_teams.decouple_discipline): move it
    # by how much more or less disciplined he is than the coach he replaces
    old_disc = (((team.get("coaches") or {}).get("head_coach") or {}).get("ratings") or {}).get("discipline", 50)
    disc = max(0, min(100, tend.get("discipline", 50) + r["discipline"] - old_disc))
    tend.update(fourth_down_go_rate=s["fourth_down_go_rate"], discipline=disc, observed=False)
    if coach.get("calls_offense"):
        oc = t["coaches"].get("offensive_coordinator") or {}
        t["coaches"]["offensive_coordinator"] = {**oc, "scheme": {**(oc.get("scheme") or {}), "offensive_scheme": coach["offense_scheme"]}}
        tend.update(pass_rate=s["pass_rate"], tempo=s["tempo"], deep_shot_rate=s["deep_shot_rate"],
                    play_action_rate=s["play_action_rate"], oc_play_calling=r["offense"])
        if coach["offense_scheme"] != "Spread Option":
            tend.pop("qb_run_share", None)
    if coach.get("calls_defense"):
        dc = t["coaches"].get("defensive_coordinator") or {}
        t["coaches"]["defensive_coordinator"] = {**dc, "scheme": {**(dc.get("scheme") or {}), "defensive_scheme": coach["defense_scheme"]}}
        tend.update(blitz_rate=s["blitz_rate"], man_coverage_rate=s["man_coverage_rate"], press_rate=s["press_rate"],
                    dc_play_calling=r["defense"])
    return t
