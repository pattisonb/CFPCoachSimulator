"""Player attributes (ratings v2, docs/RATINGS_V2.md): what each one is called, what it does,
which source ratings it is built from, and which ones each position carries. Also the
play-style archetypes and the traits, renamed from the source data's.

Everything here is data: build_teams.py builds the attributes from it, season.py and the
web page show them, and later phases of the engine read them. Values are on the house
scale (50 = an average Power 4 starter at the position, about 15 a standard deviation
above that and 9 below).
"""
from __future__ import annotations

from typing import Callable, Optional


def _avg(*keys: str) -> Callable[[dict], Optional[float]]:
    """A source formula: the mean of the source ratings present."""
    def f(r: dict) -> Optional[float]:
        vals = [r[k] for k in keys if isinstance(r.get(k), (int, float))]
        return sum(vals) / len(vals) if vals else None
    return f


def _mix(**weights: float) -> Callable[[dict], Optional[float]]:
    """A source formula: a weighted mean of the source ratings present."""
    def f(r: dict) -> Optional[float]:
        got = [(r[k], w) for k, w in weights.items() if isinstance(r.get(k), (int, float))]
        tot = sum(w for _, w in got)
        return sum(v * w for v, w in got) / tot if tot else None
    return f


# key: (label, group, what it does, source formula)
ATTRIBUTES: dict[str, tuple[str, str, str, Callable[[dict], Optional[float]]]] = {
    # physical and mental: every position
    "top_speed": ("Top Speed", "Physical", "Long runs, deep routes and pursuit: separation over distance", _avg("speed")),
    "burst": ("Burst", "Physical", "The first steps: hitting the hole, getting off the line, closing on the ball", _avg("acceleration")),
    "agility": ("Agility", "Physical", "Cutting and changing direction: jukes, route breaks, staying with a cut", _avg("agility", "change_of_direction")),
    "strength": ("Strength", "Physical", "Winning at the point of contact: blocks, sheds, tackles, broken tackles", _avg("strength")),
    "leaping": ("Leaping", "Physical", "Contested catches, high-point throws, batted passes, blocked kicks", _avg("jumping")),
    "stamina": ("Stamina", "Physical", "How fast he tires and how fast he recovers on the sideline", _avg("stamina")),
    "durability": ("Durability", "Physical", "How often he gets hurt and how long injuries last", _avg("injury", "toughness")),
    "football_iq": ("Football IQ", "Physical", "Penalties, fumbles, busted assignments, reading the play", _avg("awareness")),
    # passing
    "arm_strength": ("Arm Strength", "Passing", "Distance and velocity: deep and outside throws, tight windows", _avg("throw_power")),
    "short_accuracy": ("Short Accuracy", "Passing", "Completion on throws under 10 yards", _avg("throw_accuracy_short")),
    "mid_accuracy": ("Intermediate Accuracy", "Passing", "Completion on throws of 10-20 yards", _avg("throw_accuracy_mid")),
    "deep_accuracy": ("Deep Accuracy", "Passing", "Completion on throws of 20 yards and more", _avg("throw_accuracy_deep")),
    "throw_on_move": ("Throwing on the Move", "Passing", "Accuracy on rollouts, scrambles and with a rusher closing", _avg("throw_on_the_run")),
    "pocket_poise": ("Pocket Poise", "Passing", "Accuracy and decisions when pressured", _avg("throw_under_pressure")),
    "play_action": ("Play-Action", "Passing", "How well a fake holds the linebackers", _avg("play_action")),
    "sack_escape": ("Sack Escape", "Passing", "Slipping a sack that is about to land", _avg("break_sack")),
    "decision_making": ("Decision Making", "Passing", "Interceptions and throwaways against forced throws; reading coverage",
                        _mix(awareness=0.6, throw_under_pressure=0.4)),
    # ball carrying
    "run_vision": ("Running Vision", "Ball carrying", "Finding the hole and the cutback lane: yards before contact", _avg("bc_vision")),
    "ball_security": ("Ball Security", "Ball carrying", "Fumbles, above all against hard hitters", _avg("carrying")),
    "elusiveness": ("Elusiveness", "Ball carrying", "Making the first tackler miss in space", _avg("juke_move", "spin_move")),
    "power_running": ("Power Running", "Ball carrying", "Yards after contact and short-yardage pushes", _avg("trucking")),
    "stiff_arm": ("Stiff Arm", "Ball carrying", "Shedding arm tackles on the edge", _avg("stiff_arm")),
    "tackle_breaking": ("Tackle Breaking", "Ball carrying", "Broken tackles of any kind", _avg("break_tackle")),
    # receiving
    "hands": ("Hands", "Receiving", "Drops on catchable balls", _avg("catching")),
    "contested_catch": ("Contested Catches", "Receiving", "Catching with a defender on him", _avg("catch_in_traffic")),
    "highlight_catch": ("Highlight Catches", "Receiving", "Catching a bad or off-target throw", _avg("spectacular_catch")),
    "short_routes": ("Short Routes", "Receiving", "Separation on slants, outs and hitches", _avg("short_route_running")),
    "mid_routes": ("Intermediate Routes", "Receiving", "Separation at 10-20 yards", _avg("medium_route_running")),
    "deep_routes": ("Deep Routes", "Receiving", "Separation on go, post and corner routes", _avg("deep_route_running")),
    "release": ("Release", "Receiving", "Getting off press coverage at the line", _avg("release")),
    # blocking
    "drive_block": ("Drive Blocking", "Blocking", "Moving a defender on inside and power runs", _avg("run_block_power")),
    "reach_block": ("Reach Blocking", "Blocking", "Sealing the edge and climbing to the second level on outside runs", _avg("run_block_finesse")),
    "pass_anchor": ("Pass Pro: Anchor", "Blocking", "Holding up against bull rushes and power moves", _avg("pass_block_power")),
    "pass_footwork": ("Pass Pro: Footwork", "Blocking", "Mirroring speed and finesse rushers", _avg("pass_block_finesse")),
    "lead_block": ("Lead Blocking", "Blocking", "Blocking in space: fullbacks, pullers and screens", _avg("lead_block")),
    "finish_block": ("Finishing Blocks", "Blocking", "Pancakes and knockdowns that spring longer runs", _avg("impact_blocking")),
    # defense
    "tackling": ("Tackling", "Defense", "Wrapping up: missed tackles and yards after contact allowed", _avg("tackle")),
    "hit_power": ("Hit Power", "Defense", "Forced fumbles and jarred catches; more misses when it fails", _avg("hit_power")),
    "pursuit": ("Pursuit", "Defense", "Closing from the backside: limits long runs and yards after the catch", _avg("pursuit")),
    "diagnosis": ("Diagnosis", "Defense", "Reading run against pass and play-action: the first step", _avg("play_recognition")),
    "block_shedding": ("Block Shedding", "Defense", "Getting off blocks against the run", _avg("block_shedding")),
    "power_rush": ("Power Rush", "Defense", "Bull rush and power moves, against Pass Pro: Anchor", _avg("power_moves")),
    "speed_rush": ("Speed Rush", "Defense", "Edge and finesse moves, against Pass Pro: Footwork", _avg("finesse_moves")),
    "man_coverage": ("Man Coverage", "Defense", "Staying with a receiver in man coverage", _avg("man_coverage")),
    "zone_coverage": ("Zone Coverage", "Defense", "Breaking on the ball in zone coverage", _avg("zone_coverage")),
    "press": ("Press", "Defense", "Disrupting releases at the line, against Release", _avg("press")),
    "ball_skills": ("Ball Skills", "Defense", "Interceptions and pass breakups when he is in position", _avg("catching")),
    # special teams
    "kick_power": ("Kick Power", "Special teams", "Field goal range and kickoff distance", _avg("kick_power")),
    "kick_accuracy": ("Kick Accuracy", "Special teams", "Field goal and extra point make chance", _avg("kick_accuracy")),
    "punt_power": ("Punt Power", "Special teams", "Punt distance", _avg("kick_power")),
    "punt_accuracy": ("Punt Accuracy", "Special teams", "Directional punts and pinning it inside the 20", _avg("kick_accuracy")),
    "return_skill": ("Return Skill", "Special teams", "Kick and punt return yards", _avg("kick_return")),
}

PHYSICAL = ["top_speed", "burst", "agility", "strength", "leaping", "stamina", "durability", "football_iq"]

# What each position carries and shows on its card (height and weight come with every player).
POSITION_ATTRIBUTES: dict[str, list[str]] = {
    "QB": PHYSICAL + ["arm_strength", "short_accuracy", "mid_accuracy", "deep_accuracy", "throw_on_move", "pocket_poise",
                      "play_action", "sack_escape", "decision_making", "run_vision", "ball_security", "elusiveness"],
    "RB": PHYSICAL + ["run_vision", "ball_security", "elusiveness", "power_running", "stiff_arm", "tackle_breaking",
                      "hands", "short_routes", "pass_footwork", "return_skill"],
    "FB": PHYSICAL + ["run_vision", "ball_security", "power_running", "tackle_breaking", "hands", "short_routes",
                      "lead_block", "drive_block", "pass_anchor"],
    "WR": PHYSICAL + ["hands", "contested_catch", "highlight_catch", "short_routes", "mid_routes", "deep_routes", "release",
                      "elusiveness", "tackle_breaking", "reach_block", "return_skill"],
    "TE": PHYSICAL + ["hands", "contested_catch", "short_routes", "mid_routes", "release", "drive_block", "reach_block",
                      "pass_anchor", "tackle_breaking"],
    "OL": PHYSICAL + ["drive_block", "reach_block", "pass_anchor", "pass_footwork", "lead_block", "finish_block"],
    "DL": PHYSICAL + ["power_rush", "speed_rush", "block_shedding", "tackling", "hit_power", "pursuit", "diagnosis"],
    "LB": PHYSICAL + ["tackling", "hit_power", "pursuit", "diagnosis", "block_shedding", "power_rush", "speed_rush",
                      "man_coverage", "zone_coverage", "ball_skills"],
    "CB": PHYSICAL + ["man_coverage", "zone_coverage", "press", "ball_skills", "diagnosis", "tackling", "pursuit", "hit_power",
                      "return_skill"],
    "S": PHYSICAL + ["zone_coverage", "man_coverage", "diagnosis", "tackling", "hit_power", "pursuit", "ball_skills",
                     "block_shedding", "return_skill"],
    "K": ["kick_power", "kick_accuracy", "football_iq", "stamina"],
    "P": ["punt_power", "punt_accuracy", "football_iq", "stamina"],
}


# the engine's three linebacker positions share one attribute set
_CARD_GROUP = {"MLB": "LB", "ROLB": "LB", "LOLB": "LB"}


def card_group(position: str, role: Optional[str] = None) -> str:
    """The POSITION_ATTRIBUTES key for an engine position (fullbacks have their own set)."""
    if role == "FB":
        return "FB"
    return _CARD_GROUP.get(position, position)


def raw_attributes(src: dict, position: str, role: Optional[str] = None) -> dict[str, float]:
    """A player's attributes on the source scale: his position's set (POSITION_ATTRIBUTES).
    Another position's skills are not carried: measured against that position's players
    they mean little (a back's arm strength), and the depth chart's "rated at every
    position" already covers a move."""
    out = {}
    for key in POSITION_ATTRIBUTES.get(card_group(position, role), PHYSICAL):
        v = ATTRIBUTES[key][3](src)
        if v is not None:
            out[key] = round(v, 1)
    return out


def height_inches(h) -> Optional[int]:
    """6'2\" -> 74."""
    if isinstance(h, (int, float)):
        return int(h)
    try:
        ft, inch = str(h).replace('"', "").split("'")
        return int(ft) * 12 + int(inch or 0)
    except (ValueError, AttributeError):
        return None


# ----- play styles and traits --------------------------------------------------------------

# the source's archetype -> ours
ARCHETYPES = {
    "Pocket Passer": "Pocket Passer", "Dual Threat": "Dual Threat", "Pure Runner": "Running Quarterback",
    "Backfield Creator": "Playmaker Quarterback",
    "East/West Playmaker": "Slasher", "Contact Seeker": "Power Back", "Backfield Threat": "Receiving Back",
    "Elusive Bruiser": "Elusive Power Back", "Utility": "Utility Back", "Blocking": "Blocking Back",
    "Elusive Route Runner": "Separator", "Gadget": "Gadget Player", "Speedster": "Deep Threat",
    "Contested Specialist": "Jump-Ball Receiver", "Route Artist": "Route Technician", "Gritty Possession": "Possession Receiver",
    "Physical Route Runner": "Physical Receiver", "Vertical Threat": "Seam Stretcher", "Pure Blocker": "Blocking Tight End",
    "Possession": "Possession Receiver",
    "Agile": "Athletic Lineman", "Raw Strength": "Mauler", "Pass Protector": "Pass Protector", "Well Rounded": "Complete Lineman",
    "Pure Power": "Run Stuffer", "Power Rusher": "Power Rusher", "Speed Rusher": "Speed Rusher", "Gap Specialist": "Gap Shooter",
    "Run Stopper": "Run Stopper",
    "Thumper": "Thumper", "Lurker": "Coverage Linebacker", "Signal Caller": "Signal Caller",
    "Field": "Field Corner", "Bump and Run": "Press Corner", "Boundary": "Boundary Corner", "Zone": "Zone Corner",
    "Box Specialist": "Box Safety", "Hybrid": "Hybrid Safety", "Coverage Specialist": "Coverage Safety",
    "Power": "Big Leg", "Accurate": "Accurate Leg",
}

# the source's ability -> (trait key, our name, what it does)
TRAITS = {
    "Workhorse": ("iron_horse", "Iron Horse", "Tires more slowly and comes off the field less"),
    "Recoup": ("quick_recovery", "Quick Recovery", "Recovers from fatigue faster on the sideline"),
    "Fan Favorite": ("crowd_favorite", "Crowd Favorite", "Lifts his play in front of the home crowd"),
    "Winning Time": ("closer", "Closer", "Plays better in the fourth quarter of a close game"),
    "The Natural": ("natural_talent", "Natural Talent", "Develops faster than his ratings suggest"),
    "Road Dog": ("road_warrior", "Road Warrior", "Shrugs off the road crowd"),
    "Clear Headed": ("ice_water", "Ice Water", "Unbothered by pressure moments and swings in momentum"),
    # quarterbacks
    "Step Up": ("steps_up", "Steps Up", "Climbs the pocket away from edge pressure"),
    "On Time": ("timing_passer", "Timing Passer", "Extra accuracy on short timing throws"),
    "Resistance": ("unflappable", "Unflappable", "Keeps his accuracy when hit as he throws"),
    "Dot!": ("pinpoint", "Pinpoint", "Extra accuracy from a clean pocket"),
    "Sleight Of Hand": ("ball_handler", "Ball Handler", "Play-action and option fakes hold the defense longer"),
    "Extender": ("play_extender", "Play Extender", "Buys time outside the pocket"),
    "Option King": ("option_maestro", "Option Maestro", "Reads the option keys well"),
    "Magician": ("escape_artist", "Escape Artist", "Escapes sacks that look certain"),
    "Mobile Deadeye": ("accurate_on_the_run", "Accurate on the Run", "Keeps his accuracy on the move"),
    "Pull Down": ("tuck_and_run", "Tuck and Run", "Knows when to pull it down and run"),
    "Off Platform": ("off_platform", "Off-Platform Thrower", "Accurate from odd arm angles and off-balance"),
    "Field General": ("coach_on_the_field", "Coach on the Field", "Gets the offense into the right play"),
    "Mobile Resistance": ("poised_on_the_run", "Poised on the Run", "Keeps his accuracy when hit on the move"),
    # ball carriers
    "Side Step": ("quick_feet", "Quick Feet", "Makes the first tackler miss laterally"),
    "360": ("spin_artist", "Spin Artist", "Breaks tackles with spin moves"),
    "Shifty": ("slippery", "Slippery", "Hard to square up in the open field"),
    "Arm Bar": ("stiff_arm_specialist", "Stiff-Arm Specialist", "Wins with the stiff arm on the edge"),
    "Headstrong": ("tough_runner", "Tough Runner", "Runs through arm tackles"),
    "Downhill": ("downhill_runner", "Downhill Runner", "Gains after contact between the tackles"),
    "Balanced": ("balance", "Balance", "Stays on his feet through contact"),
    "Safety Valve": ("checkdown_target", "Checkdown Target", "A reliable outlet when the play breaks down"),
    "Takeoff": ("breakaway_speed", "Breakaway Speed", "Turns a crease into a long run"),
    "Take Off": ("breakaway_speed", "Breakaway Speed", "Turns a crease into a long run"),
    "Battering Ram": ("bulldozer", "Bulldozer", "Short-yardage power"),
    "Ball Security": ("ball_protector", "Ball Protector", "Rarely fumbles"),
    "Headfirst": ("extra_effort", "Extra Effort", "Falls forward for extra yards"),
    "Sidekick": ("lead_back", "Lead Back", "Clears the way as a lead blocker"),
    # receivers
    "50/50": ("jump_ball_winner", "Jump-Ball Winner", "Wins contested throws"),
    "Double Dip": ("double_move", "Double Move", "Beats defenders deep with double moves"),
    "Cutter": ("sharp_cutter", "Sharp Cutter", "Sharp breaks that create separation"),
    "Sure Hands": ("glue_hands", "Glue Hands", "Rarely drops a pass"),
    "Best Friend": ("qbs_favorite", "QB's Favorite", "Gets extra targets"),
    "Press Pro": ("press_beater", "Press Beater", "Wins against press coverage"),
    # blockers
    "Quick Step": ("quick_set", "Quick Set", "Gets to his spot against speed rushers"),
    "Second Level": ("second_level_blocker", "Second-Level Blocker", "Climbs to linebackers on runs"),
    "Pocket Shield": ("pocket_protector", "Pocket Protector", "Holds his pass block longer"),
    "Quick Drop": ("quick_pass_set", "Quick Pass Set", "Sets fast against quick rushes"),
    "Outside Shield": ("edge_sealer", "Edge Sealer", "Seals the edge on outside runs"),
    "Ground N Pound": ("road_grader", "Road Grader", "Drives defenders off the ball in short yardage"),
    "Inside Shield": ("interior_wall", "Interior Wall", "Stops inside pressure"),
    "Screen Enforcer": ("screen_blocker", "Screen Blocker", "Clears the way on screens"),
    "PA Shield": ("play_action_protector", "Play-Action Protector", "Holds up on play-action"),
    "Strong Grip": ("vise_grip", "Vise Grip", "Sustains blocks"),
    "Wear Down": ("grinder", "Grinder", "Wears defenders down over a game"),
    "Offensive Rally": ("line_leader", "Line Leader", "Lifts the line around him"),
    "Option Shield": ("option_blocker", "Option Blocker", "Blocks well on option plays"),
    # defenders
    "Blow Up": ("block_buster", "Block Buster", "Blows up lead blockers at the point of attack"),
    "Hammer": ("heavy_hitter", "Heavy Hitter", "Forces fumbles with big hits"),
    "Aftershock": ("jarring_hits", "Jarring Hits", "Big hits that knock the ball loose on catches"),
    "House Call": ("pick_six", "Pick Six", "Takes interceptions back"),
    "Robber": ("route_jumper", "Route Jumper", "Breaks on short and intermediate throws"),
    "Quick Jump": ("jump_the_snap", "Jump the Snap", "Gets off the line fast"),
    "Wrap Up": ("sure_tackler", "Sure Tackler", "Rarely misses a tackle"),
    "Pocket Disruptor": ("pocket_collapser", "Pocket Collapser", "Collapses the pocket from inside"),
    "Ball Hawk": ("turnover_magnet", "Turnover Magnet", "Makes plays on the ball in coverage"),
    "Take Down": ("finisher", "Finisher", "Finishes sacks"),
    "Grip Breaker": ("hand_fighter", "Hand Fighter", "Sheds blocks"),
    "Jammer": ("jam_artist", "Jam Artist", "Disrupts receivers at the line"),
    "Knockout": ("ball_jarrer", "Ball Jarrer", "Breaks up passes with the hit"),
    "Blanket Coverage": ("shadow", "Shadow", "Sticks to receivers in man coverage"),
    "Inside Disruptor": ("gap_penetrator", "Gap Penetrator", "Wins quickly through the gap"),
    "Bouncer": ("edge_setter", "Edge Setter", "Turns runs back inside"),
    "Lay Out": ("diving_breakup", "Diving Breakup", "Makes diving pass breakups"),
    "Legion": ("pack_tackler", "Pack Tackler", "Gang tackles"),
    "Option Disruptor": ("option_killer", "Option Killer", "Blows up option plays"),
    "Defensive Rally": ("defensive_leader", "Defensive Leader", "Lifts the defense around him"),
    "Duress": ("pressure_player", "Pressure Player", "Hurries throws even without the sack"),
    "Outside Disruptor": ("edge_bender", "Edge Bender", "Bends around the edge"),
    # specialists
    "Coffin Corner": ("pin_artist", "Pin Artist", "Pins punts inside the 10"),
    "Deep Range": ("long_range", "Long Range", "Extra field-goal range"),
    "Chip Shot": ("automatic", "Automatic", "Rarely misses short kicks"),
    "Mega Leg": ("cannon_leg", "Cannon Leg", "Big leg on kickoffs and long kicks"),
    "Clutch Kicker": ("clutch_leg", "Clutch Leg", "Makes the big kick"),
}
TRAIT_TIERS = {"Bronze": 1, "Silver": 2, "Gold": 3, "Platinum": 4}
TIER_NAMES = {n: name for name, n in TRAIT_TIERS.items()}


def traits_of(abilities: list[dict]) -> list[dict]:
    """The traits a player has earned (the source's unlocked abilities), highest tier first."""
    out = {}
    for a in abilities or []:
        tier = TRAIT_TIERS.get(a.get("tier"))
        t = TRAITS.get(a.get("name"))
        if tier and t and tier > out.get(t[0], 0):
            out[t[0]] = tier
    return [{"key": k, "tier": v} for k, v in sorted(out.items(), key=lambda kv: (-kv[1], kv[0]))]


TRAIT_INFO = {key: (name, desc) for key, name, desc in TRAITS.values()}

# The attributes each trait rests on (shown on the badge with the player's values). The source
# data names a player's traits and tiers but not the rules that earned them; some follow one
# rating closely (kick power for Long Range, the spin and juke moves for Spin Artist), others
# barely follow any. An empty list is an intangible: no rating stands behind it.
TRAIT_KEYS: dict[str, list[str]] = {
    "iron_horse": ["stamina", "durability"], "quick_recovery": ["stamina"], "crowd_favorite": [], "closer": ["football_iq"],
    "natural_talent": [], "road_warrior": ["football_iq"], "ice_water": ["football_iq"],
    "steps_up": ["pocket_poise", "sack_escape"], "timing_passer": ["short_accuracy", "football_iq"], "unflappable": ["pocket_poise"],
    "pinpoint": ["short_accuracy", "mid_accuracy"], "ball_handler": ["play_action"], "play_extender": ["throw_on_move", "sack_escape"],
    "option_maestro": ["run_vision", "football_iq"], "escape_artist": ["sack_escape", "elusiveness"],
    "accurate_on_the_run": ["throw_on_move"], "tuck_and_run": ["run_vision", "top_speed"], "off_platform": ["throw_on_move", "arm_strength"],
    "coach_on_the_field": ["football_iq", "decision_making"], "poised_on_the_run": ["throw_on_move", "pocket_poise"],
    "quick_feet": ["elusiveness", "agility"], "spin_artist": ["elusiveness"], "slippery": ["agility", "burst"],
    "stiff_arm_specialist": ["stiff_arm"], "tough_runner": ["tackle_breaking", "power_running"], "downhill_runner": ["power_running", "burst"],
    "balance": ["tackle_breaking"], "checkdown_target": ["hands", "short_routes"], "breakaway_speed": ["top_speed", "burst"],
    "bulldozer": ["power_running", "strength"], "ball_protector": ["ball_security"], "extra_effort": ["power_running"],
    "lead_back": ["lead_block"],
    "jump_ball_winner": ["contested_catch", "leaping"], "double_move": ["deep_routes", "mid_routes"], "sharp_cutter": ["short_routes", "agility"],
    "glue_hands": ["hands"], "qbs_favorite": ["short_routes", "hands"], "press_beater": ["release"],
    "quick_set": ["pass_footwork", "burst"], "second_level_blocker": ["finish_block", "reach_block"],
    "pocket_protector": ["pass_anchor", "pass_footwork"], "quick_pass_set": ["pass_footwork"], "edge_sealer": ["reach_block"],
    "road_grader": ["drive_block"], "interior_wall": ["pass_anchor"], "screen_blocker": ["lead_block"],
    "play_action_protector": ["pass_anchor"], "vise_grip": ["strength", "drive_block"], "grinder": ["strength", "stamina"],
    "line_leader": ["football_iq"], "option_blocker": ["reach_block"],
    "block_buster": ["block_shedding", "hit_power"], "heavy_hitter": ["hit_power"], "jarring_hits": ["hit_power"],
    "pick_six": ["ball_skills", "top_speed"], "route_jumper": ["zone_coverage", "diagnosis"], "jump_the_snap": ["burst"],
    "sure_tackler": ["tackling"], "pocket_collapser": ["power_rush"], "turnover_magnet": ["ball_skills"], "finisher": ["tackling"],
    "hand_fighter": ["block_shedding"], "jam_artist": ["press"], "ball_jarrer": ["hit_power"], "shadow": ["man_coverage"],
    "gap_penetrator": ["speed_rush", "burst"], "edge_setter": ["block_shedding", "tackling"], "diving_breakup": ["ball_skills", "leaping"],
    "pack_tackler": ["pursuit", "tackling"], "option_killer": ["diagnosis"], "defensive_leader": ["football_iq"],
    "pressure_player": ["speed_rush", "power_rush"], "edge_bender": ["speed_rush", "agility"],
    "pin_artist": ["punt_accuracy", "punt_power", "kick_power"], "long_range": ["kick_power", "punt_power"],
    "automatic": ["kick_accuracy"], "cannon_leg": ["kick_power", "punt_power"], "clutch_leg": ["kick_accuracy"],
}


# ----- god mode: the engine composites each attribute feeds ------------------------------------
# A change to an attribute moves the engine's composite ratings (the ones the sim reads until
# its later phases read the attributes) by these weights, in source-rating units. They follow
# build_teams.map_player's composites; an edit there needs one here.
COMPOSITES: dict[str, dict[str, dict[str, float]]] = {
    "_all": {"speed": {"top_speed": 0.7, "burst": 0.3}, "strength": {"strength": 1.0}, "intelligence": {"football_iq": 1.0},
             "endurance": {"stamina": 1.0}},
    "QB": {"passing": {"short_accuracy": 0.3, "mid_accuracy": 0.35, "deep_accuracy": 0.2, "arm_strength": 0.15},
           "decision_making": {"decision_making": 1.0}, "elusiveness": {"agility": 0.33, "elusiveness": 0.33, "sack_escape": 0.34},
           "vision": {"run_vision": 1.0}, "hands": {"ball_security": 1.0}},
    "RB": {"strength": {"strength": 0.33, "power_running": 0.33, "stiff_arm": 0.34},
           "elusiveness": {"agility": 0.4, "elusiveness": 0.4, "tackle_breaking": 0.2}, "vision": {"run_vision": 1.0},
           "hands": {"hands": 1.0}, "route_running": {"short_routes": 0.5, "mid_routes": 0.5},
           "run_blocking": {"drive_block": 0.5, "reach_block": 0.5}, "pass_blocking": {"pass_anchor": 0.5, "pass_footwork": 0.5}},
    "WR": {"hands": {"hands": 0.34, "contested_catch": 0.33, "highlight_catch": 0.33},
           "route_running": {"short_routes": 0.25, "mid_routes": 0.25, "deep_routes": 0.25, "release": 0.25},
           "elusiveness": {"agility": 0.67, "elusiveness": 0.33}, "vision": {"run_vision": 1.0},
           "run_blocking": {"drive_block": 0.25, "reach_block": 0.25, "finish_block": 0.5},
           "pass_blocking": {"pass_anchor": 0.5, "pass_footwork": 0.5}},
    "OL": {"run_blocking": {"drive_block": 0.5, "reach_block": 0.5}, "pass_blocking": {"pass_anchor": 0.5, "pass_footwork": 0.5}},
    "DL": {"intelligence": {"football_iq": 0.5, "diagnosis": 0.5}, "rushing": {"power_rush": 0.33, "speed_rush": 0.33, "block_shedding": 0.34},
           "tackling": {"tackling": 0.5, "pursuit": 0.5}, "coverage": {"man_coverage": 0.5, "zone_coverage": 0.5}},
    "LB": {"intelligence": {"football_iq": 0.5, "diagnosis": 0.5}, "rushing": {"power_rush": 0.33, "speed_rush": 0.33, "block_shedding": 0.34},
           "tackling": {"tackling": 0.34, "pursuit": 0.33, "hit_power": 0.33}, "coverage": {"man_coverage": 0.5, "zone_coverage": 0.5}},
    "CB": {"intelligence": {"football_iq": 0.5, "diagnosis": 0.5}, "coverage": {"man_coverage": 0.5, "zone_coverage": 0.5},
           "tackling": {"tackling": 0.5, "pursuit": 0.5}, "hands": {"ball_skills": 1.0},
           "rushing": {"power_rush": 0.33, "speed_rush": 0.33, "block_shedding": 0.34}},
    "K": {"kick_power": {"kick_power": 1.0}, "kick_accuracy": {"kick_accuracy": 1.0}},
    "P": {"punt_power": {"punt_power": 1.0}, "punt_accuracy": {"punt_accuracy": 1.0}},
}
COMPOSITES["TE"] = COMPOSITES["WR"]
COMPOSITES["S"] = COMPOSITES["CB"]
COMPOSITES["FB"] = COMPOSITES["RB"]


def composite_weights(position: str, role: Optional[str] = None) -> dict[str, dict[str, float]]:
    """composite key -> {attribute: weight} for a player's engine position."""
    g = card_group(position, role)
    out = dict(COMPOSITES["_all"])
    out.update(COMPOSITES.get(g, {}))
    return out
