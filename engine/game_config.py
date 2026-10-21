"""
Game Configuration - Slider System
Similar to EA Sports College Football sliders
All values range from 0-100, where 50 = default/normal
Adjusting above 50 increases that attribute, below 50 decreases it

The TUNING block below holds every calibration constant the engine uses. They were set
by running `calibrate.py` against FBS averages (see docs/HOW_IT_WORKS.md). Ratings are 0-100 and the
formulas are written as differences from NEUTRAL, so a league of better or worse teams
still plays like football; only the gap between the two teams decides the game.
"""

import random as _random
# Random source for stat attribution only (which lineman allowed a pressure, which defender
# broke up a pass). It never touches the game's own stream, so results are unchanged by it.
stat_rng = _random.Random(0)
# Injuries roll on their own stream too, so a sim with injuries off reproduces the same game.
injury_rng = _random.Random(1)

# ----- personnel (engine/personnel.py) -----
HEAVY_JUMBO_SHARE = 0.25        # short yardage / goal line: share of snaps with a sixth lineman
HEAVY_13_SHARE = 0.30           # ... with three tight ends
PASSING_DOWN_10_SHARE = 0.35    # third-and-long: share of snaps in four-wide (Air Raid 1.6x)
CONSERVATIVE_HEAVY_SHARE = 0.5  # a leader milking the clock: share of snaps in 12 or 21
NICKEL_VS_11 = 0.55             # a 4-3 or 3-4 answers three receivers with a nickel back this often
DIME_ON_PASSING_DOWN = 0.35     # third-and-long against three receivers: dime this often, else nickel
DEF_SUB_FATIGUE = {"DL": 30, "MLB": 50, "ROLB": 50, "LOLB": 50, "CB": 58, "S": 58}   # rotation points by position (linemen rotate most)
TE_BLOCK_CREDIT_SHARE = 0.45    # a tight end's or fullback's share of a blocking credit, relative to a lineman
FB_CARRY_WEIGHT = 0.10          # a fullback's carry weight next to a halfback's 0.80
FLEXBONE_FB_CARRY_WEIGHT = 1.5  # ... in a Flexbone Triple Option, where the dive fullback carries 30-44% (Air Force, Army, Navy)

# ----- injuries -----
INJURIES = True

# In-game momentum (off unless the season setting turns it on per game): big plays swing a
# team's momentum between -1 and 1, which nudges its ratings by up to MOMENTUM_EFFECT.
MOMENTUM = False
MOMENTUM_EFFECT = 0.05
MOMENTUM_DECAY = 0.93          # per snap, so a swing fades over a drive or two
MOMENTUM_HALF = 0.5            # what is left at the start of the second half
INJURY_PER_SNAP = 0.00085       # per player on the field per snap: about 1.3 injuries a game per team
# Quarterbacks and backs take the most hits: real teams start more than one passer and lead back
# over a season (tools/realism.py: the 100th passer's yards, the 1,000-yard rushers).
INJURY_POSITION_MULT = {"QB": 2.2, "RB": 1.7}
# cumulative probability, weeks out (0 = rest of this game only)
INJURY_SEVERITY = [(0.55, 0), (0.72, 1), (0.84, 2), (0.91, 3), (0.95, 5), (0.98, 8), (1.0, 20)]
INJURY_TYPES = ["ankle sprain", "hamstring strain", "knee sprain", "shoulder injury", "concussion", "groin strain",
                "wrist injury", "hip pointer", "calf strain", "high ankle sprain", "foot injury", "back spasms"]

class GameSliders:
    """Centralized slider configuration for game parameters"""

    def __init__(self):
        # ========== OFFENSE SLIDERS ==========
        self.qb_accuracy = 50          # QB passing accuracy (affects completion %)
        self.wr_catching = 50          # WR/TE catching ability
        self.pass_blocking = 50        # Offensive line pass protection
        self.run_blocking = 50         # Offensive line run blocking
        self.running_ability = 50      # RB rushing effectiveness
        self.fumble_frequency = 50     # Offensive fumble rate (lower = fewer fumbles)
        self.offensive_penalties = 50  # Offensive penalty frequency (lower = fewer penalties)

        # ========== DEFENSE SLIDERS ==========
        self.pass_defense = 50         # Pass coverage effectiveness
        self.interceptions = 50        # Interception frequency
        self.pass_rush = 50            # Defensive pass rush / sack rate
        self.run_defense = 50          # Run defense effectiveness
        self.tackling = 50             # Tackling ability
        self.defensive_penalties = 50  # Defensive penalty frequency (lower = fewer penalties)
        self.forced_fumbles = 50       # Forced fumble frequency

        # ========== SPECIAL TEAMS SLIDERS ==========
        self.kicking_power = 50        # Kicker/punter power
        self.kicking_accuracy = 50     # Kicker accuracy (PATs, FGs)
        self.punt_accuracy = 50        # Punter accuracy (pinning, distance)
        self.kickoff_power = 50        # Kickoff distance
        self.kickoff_return = 50       # Kickoff return effectiveness

        # ========== GAME PLAY SLIDERS ==========
        self.game_speed = 50           # Overall game tempo (affects time per play)
        self.injury_frequency = 50     # Injury frequency (not yet implemented)
        self.home_field_advantage = 50 # Home field advantage (not yet implemented)

    def get_multiplier(self, slider_value):
        """
        Convert slider value (0-100) to multiplier
        50 = 1.0 (normal)
        0 = 0.5 (50% of normal)
        100 = 1.5 (150% of normal)
        """
        return 0.5 + (slider_value / 100)

    def get_percentage_adjustment(self, slider_value, base_percentage):
        """
        Adjust a percentage based on slider
        50 = base percentage
        0 = base * 0.5
        100 = base * 1.5
        """
        multiplier = self.get_multiplier(slider_value)
        return base_percentage * multiplier

    def get_inverse_percentage_adjustment(self, slider_value, base_percentage):
        """
        For sliders where lower = better (like fumbles, penalties)
        50 = base percentage
        0 = base * 1.5 (more frequent)
        100 = base * 0.5 (less frequent)
        """
        multiplier = 1.5 - (slider_value / 100)
        return base_percentage * multiplier


# Global slider instance - can be modified before running simulation
sliders = GameSliders()


# ===================== CALIBRATION CONSTANTS =====================

# Clock. Two 30-minute halves; the quarter mark splits each half for the box score.
HALF_SECONDS = 1800
QUARTER_SECONDS = 900
HURRY_UP_SECONDS = 120          # offense hurries when the half has this much left
# Seconds a play takes off the clock, before the game-speed slider and late-game drag.
PLAY_SECONDS_RUN = (23, 36)     # runs and completed passes (clock keeps running)
PLAY_SECONDS_STOP = (8, 16)     # incompletions, penalties, plays out of bounds
PLAY_SECONDS_HURRY = (8, 16)
PLAY_SECONDS_STOP_HURRY = (4, 8)
LATE_GAME_DRAG = 0.10           # plays take up to this much longer at the end of a half

# The rating that formulas treat as "average FBS starter".
NEUTRAL = 55

# Penalties per snap (before the sliders).
# ----- Turnovers, injuries and penalties (ratings v2, phase 5) -----
# Multipliers around 1 that average out over the league, per house-scale point over the FBS
# starter average (ATTR_LEAGUE_AVG; 50 is the Power 4 starter average, FBS starters sit at 45-48).
ATTR_LEAGUE_AVG = 46
FUMBLE_SECURITY_EFFECT = 0.0072   # fumble chance x (1 - this per point of the carrier's Ball Security)
FUMBLE_HIT_EFFECT = 0.0048        # ... x (1 + this per point of the tacklers' Hit Power)
INT_DEPTH_MULT = {"short": 0.75, "mid": 1.05, "deep": 1.65}   # deep throws are picked off more (averages about 1)
INT_PRESSURE_MULT = 1.3          # a hurried throw ...
INT_POISE_EFFECT = 0.006         # ... less so for a poised quarterback (per point of Pocket Poise)
INT_BALL_SKILLS_EFFECT = 0.004   # x (1 + this per point of the coverage players' Ball Skills)
INJURY_DURABILITY_EFFECT = 0.012 # injury chance x (1 - this per point of Durability)
PENALTY_IQ_EFFECT = 0.006        # penalty chance x (1 - this per point of the unit's Football IQ)
# ----- Traits (ratings v2, phase 6) -----
# Each trait (ratings.TRAITS) has a tier, 1 bronze to 4 platinum; the effects below are per
# tier. A unit's traits add up ("points" = the sum of the tiers on the field).
TRAIT_FX = {
    "pinpoint": 0.003,          # completion, clean pocket
    "timing_passer": 0.0024,     # completion, short throws
    "unflappable": 0.0036,       # completion when pressured
    "on_the_move": 0.0018,       # completion when pressured: accurate_on_the_run, poised_on_the_run, off_platform
    "sack_avoid": 0.009,         # sack rate x (1 - this): steps_up, escape_artist, play_extender
    "glue_hands": 0.0018,        # completion on throws to him
    "jump_ball": 0.006,         # completion on contested throws to him
    "double_move": 0.0045,       # completion on deep throws to him
    "sharp_cutter": 0.0024,      # completion on short and intermediate throws to him
    "press_beater": 0.003,      # completion against man coverage
    "target_pull": 0.03,        # target weight x (1 + this): qbs_favorite, checkdown_target
    "breakaway": 0.036,          # long-gain chance x (1 + this): breakaway_speed
    "open_field": 0.045,         # yards on outside runs: quick_feet, slippery, spin_artist, stiff_arm_specialist
    "power_run": 0.036,          # yards on inside runs: tough_runner, downhill_runner, bulldozer, balance
    "extra_effort": 0.03,       # yards on every carry
    "bulldozer_push": 0.009,     # short-yardage conversion
    "ball_protector": 0.045,     # fumble x (1 - this)
    "line_run": 0.009,           # run yards per point of the line's run-blocking traits
    "line_pass": 0.0036,         # sack rate x (1 - this per point) of the line's pass-protection traits
    "rush": 0.0036,              # sack rate x (1 + this per point) of the rushers' traits
    "cover": 0.0012,             # completion - this per point of coverage traits in the right call
    "ballhawk": 0.006,           # interception x (1 + this per point)
    "tackle": 0.009,             # run yards - this per point of the front's tackling and shedding traits
    "hitter": 0.012,             # fumble x (1 + this per point) of the hitters on the field
    "iron_horse": 0.9,            # stamina (endurance) points
    "quick_recovery": 0.045,     # sideline recovery x (1 + this)
    "long_range": 0.6,            # field-goal range, yards
    "automatic": 0.006,          # make chance on kicks under 40 yards
    "crowd": 0.15,               # rating points at home: crowd_favorite
    "road_warrior": 0.075,       # share of the road penalty he shrugs off
}
LINE_RUN_TRAITS = ("road_grader", "edge_sealer", "second_level_blocker", "vise_grip", "option_blocker")
LINE_PASS_TRAITS = ("pocket_protector", "quick_set", "quick_pass_set", "interior_wall", "play_action_protector")
RUSH_TRAITS = ("pocket_collapser", "edge_bender", "gap_penetrator", "pressure_player", "finisher", "jump_the_snap")
TACKLE_TRAITS = ("sure_tackler", "pack_tackler", "block_buster", "hand_fighter", "edge_setter")
HIT_TRAITS = ("heavy_hitter", "jarring_hits", "ball_jarrer")
# ----- Coach styles -----
# What the offensive scheme leans toward: deep and short shares of throws (x), the share of
# runs that go outside (+), how often it uses play-action (x). Multiple is neutral.
SCHEME_STYLE = {
    "Air Raid": {"deep": 1.25, "short": 1.10, "outside": 0.05, "pa": 0.6},
    "West Coast": {"deep": 0.80, "short": 1.20, "outside": 0.00, "pa": 1.1},
    "Spread RPO": {"deep": 0.95, "short": 1.10, "outside": 0.08, "pa": 1.3},
    "Power Spread": {"deep": 1.05, "short": 0.95, "outside": -0.10, "pa": 1.2},
    "Spread Option": {"deep": 1.00, "short": 1.00, "outside": 0.12, "pa": 1.0},
    "Pro Style": {"deep": 1.05, "short": 0.95, "outside": -0.08, "pa": 1.4},
    "Flexbone Triple Option": {"deep": 1.30, "short": 0.80, "outside": 0.05, "pa": 1.5},
}
DEEP_SHOT_EFFECT = 0.012         # deep share x (1 + this per point of the OC's deep-shot rate over 50)
PLAY_ACTION_BASE = 0.20          # share of first- and second-down dropbacks with a play-action fake
PLAY_ACTION_RATE_EFFECT = 0.015  # ... x (1 + this per point of the OC's play-action rate over 50)
PLAY_ACTION_COMPLETION = 0.05    # intermediate and deep throws off a fake that holds
PLAY_ACTION_SKILL = 0.0015       # ... per point of the QB's Play-Action over the front's Diagnosis
PLAY_ACTION_DEEP = 1.3           # deep share x this off a fake
PLAY_ACTION_SACK = 1.15          # sack rate x this (the longer dropback)
MAN_RATE_EFFECT = 0.008          # man share + this per point of the DC's man-coverage rate over 50
PRESS_RATE = 0.5                 # share of man calls with press at a press rate of 50 (x rate / 50)
PRESS_EFFECT = 0.00125           # short and intermediate completion per point of Release over the coverage's Press
BLITZ_BASE = 0.25                # share of dropbacks blitzed at a blitz rate of 50 (x rate / 50)
BLITZ_SACK = (1.35, 0.883)       # sack rate x (blitz, no blitz): about 1 on average (1.6/0.8 magnified talent edges)
BLITZ_BIG_PLAY = (1.35, 0.883)   # long-gain chance x (blitz, no blitz): fewer men in coverage
DISCIPLINE_EFFECT = 0.006        # penalty chance x (1 - this per point of discipline over 50; discipline is the
                                 # head coach's rating beyond what the team's talent predicts, build_teams.decouple_discipline)
OFF_PENALTY_CHANCE = 0.050
DEF_PENALTY_CHANCE = 0.035

# ----- Passing -----
THROWAWAY_CHANCE = 0.03
SACK_BASE = 0.050               # per dropback with equal lines
SACK_PER_LINE_POINT = 0.0015    # per point of (pass rush - pass protection)
SACK_PER_QB_POINT = 0.0004      # per point of QB decision making above neutral (fewer sacks)
SACK_GUESSED_BONUS = 0.035      # defense called a pass defense
# ----- Pass rush and protection (ratings v2, phase 4) -----
# Each dropback the rush is a power rush or a speed rush (the rushers' style tilts it). Power
# Rush meets Pass Pro: Anchor and Speed Rush meets Footwork, each as the side's lean over its
# own average of the two (the composites still set the level). Rates per house-scale point.
RUSH_POWER_SHARE = 0.5
RUSH_STYLE_TILT = 0.01           # power share + this per point of the rushers' power over speed
RUSH_MATCHUP_EFFECT = 0.0012     # sack rate per point of (the rushers' lean in this rush - the line's lean against it)
SACK_ESCAPE_EFFECT = 0.0024       # sack rate x (1 - this per point of Sack Escape over 50)
# Pressure that does not become a sack now hurries the throw: completion falls, less for a
# poised quarterback, and the stat credit follows the same pressure.
PRESSURE_PER_SACK_RATE = 2.5     # pressure chance = this x the sack rate (at most 0.6)
PRESSURE_COMPLETION = -0.08      # completion change when pressured
POISE_EFFECT = 0.0015            # ... back by this per point of Pocket Poise over 50
SACK_YARDS = (7.5, 2.0)         # gauss mean, sd (loss)
SACK_FUMBLE_CHANCE = 0.13
COMPLETION_BASE = 0.652         # equal QB, receiver and coverage (0.641 before pressure cost completions)
COMPLETION_PER_QB_POINT = 0.0026
COMPLETION_PER_RECV_POINT = 0.0015
COMPLETION_PER_COV_POINT = 0.0032   # was 0.0025: points allowed per defense-rating point -0.28 in the sim vs -0.50 real
COMPLETION_GUESSED = -0.055
COMPLETION_NOT_GUESSED = 0.015
COMPLETION_LONG_3RD = -0.05     # 3rd/4th and 7+
COMPLETION_CHECKDOWN_BONUS = 0.12
REDZONE_COMPLETION = ((10, -0.10), (20, -0.06))   # (yards to goal or fewer, completion change): a short field squeezes coverage
COMPLETION_MIN, COMPLETION_MAX = 0.25, 0.86
RB_TARGET_SHARE = 0.16          # share of targets that go to running backs
TE_TARGET_WEIGHT = 0.75         # tight ends targeted a bit less than their ratings imply
INT_BASE = 0.045                # per incompletion (not throwaways); 0.055 gave 2.8 picks per 100 attempts (real 2.24)
INT_PER_COV_POINT = 0.0013
INT_PER_QB_POINT = 0.0013       # per point of decision making above neutral (fewer picks)
INT_GUESSED_BONUS = 0.02
INT_MIN, INT_MAX = 0.02, 0.22
PICK_SIX_CHANCE = 0.09          # of interceptions
# ----- Passing by depth (ratings v2, phase 2) -----
# Each throw to a receiver or tight end has a depth: short (under 10 yards), intermediate
# (10-20) or deep (20+). The share of each, before the receiver's speed and Deep Routes tilt it:
PASS_DEPTH_SHARE = {"WR": (0.50, 0.32, 0.18), "TE": (0.58, 0.35, 0.07)}
PASS_DEEP_SPEED_TILT = 1.0       # deep share x (receiver speed / neutral) ** this
PASS_DEEP_ROUTE_TILT = 0.006     # deep share x (1 + this per point of Deep Routes over his route average)
DEPTH_COMPLETION = {"short": 0.08, "mid": -0.05, "deep": -0.24}   # added to the completion chance
PASS_YARDS_SHORT = (7.0, 3.0)    # gauss mean, sd of the catch point plus run, before yards after the catch
PASS_YARDS_MID = (15.5, 3.5)
PASS_YARDS_DEEP = (22, 56)       # uniform
PASS_BREAKAWAY_CHANCE = 0.05     # a short or intermediate catch broken for a long gain (x speed / neutral)
# The attributes add how a player differs from his own average at each depth (the composites
# above already set his level), in completion chance per house-scale point:
DEPTH_ACCURACY_EFFECT = 0.0025   # QB accuracy at the throw's depth over his accuracy average
ARM_DEEP_EFFECT = 0.0012         # deep throws: arm strength over his accuracy average
ROUTE_DEPTH_EFFECT = 0.0020      # receiver's route skill at the depth over his route average
# Man or zone, called each pass play; the coverage players' Man or Zone over their average of the two
MAN_COVERAGE_SHARE = 0.45
COVERAGE_TYPE_EFFECT = 0.0025
# Contested catches: a defender on the receiver at the catch point, more often deeper
CONTESTED_SHARE = {"short": 0.10, "mid": 0.25, "deep": 0.45}
CONTESTED_EFFECT = 0.0035        # per point of (Contested Catches - defender's Ball Skills) / 2 + leaping and height edge
CONTESTED_HEIGHT_POINTS = 2.0    # an inch of height is worth this many rating points at the catch point
PASS_YARDS_WR = (12.3, 5.5)     # gauss mean, sd for WR completions (12.6 before the defense terms grew)
PASS_YARDS_TE = (9.5, 4.5)
PASS_YARDS_RB = (5.0, 4.0)
PASS_SPEED_EFFECT = 0.007       # yards multiplier per point of receiver speed minus DB speed
PASS_TACKLE_EFFECT = 0.006      # yards multiplier per point of the coverage players' tackling below neutral (yards after the catch)
PASS_BIG_PLAY_CHANCE = 0.08    # of WR/TE completions
PASS_BIG_PLAY_YARDS = (22, 65)
PASS_MIN_YARDS = -2
SCRAMBLE_CHANCE = 0.13          # of plays with no completion and no pick
RECEPTION_FUMBLE_CHANCE = 0.010

# ----- Rushing -----
RUSH_BASE_YARDS = (3.75, 2.7)   # gauss mean, sd (3.75: official YPC counts sacks as runs; see tools/calibrate.py)
RUSH_PER_LINE_POINT = 0.040     # yards per point of (run blocking - run defense)
RUSH_PER_CARRIER_POINT = 0.035  # yards per point of carrier rating above the front seven's pursuit (speed and tackling)
# ----- Running by direction (ratings v2, phase 3) -----
# Each carry goes inside or outside. Blocking, the front and the carrier's style read
# differently in each; like the pass game, the attributes add how a player differs from his
# own average (the composites above still set his level), in yards per house-scale point.
RUN_OUTSIDE_SHARE = 0.40         # of carries, before the carrier's style tilts it
RUN_STYLE_TILT = 0.006           # outside share + this per point of his speed style over his power style
RUN_LINE_STYLE_EFFECT = 0.025    # yards per point: the line's drive (inside) or reach (outside) over its average of the two
RUN_FRONT_STYLE_EFFECT = 0.020   # yards per point: the front's shedding (inside) or pursuit (outside) over its average
RUN_WEIGHT_EFFECT = 0.015        # inside runs: yards per pound of line weight over the front's, against the usual gap
LINE_WEIGHT_GAP = 52             # the usual gap: FBS starting linemen 312 lb, starting fronts 260
RUN_CARRIER_STYLE_EFFECT = 0.020 # yards per point: power style inside, speed style outside, over his own average
RUN_VISION_EFFECT = 0.015        # yards per point of Running Vision over his ball-carrying average
SHORT_YARDAGE_STYLE_EFFECT = 0.0024   # conversion chance per point of power running and drive blocking over shedding
RUSH_GUESSED = -0.9
RUSH_NOT_GUESSED = 0.5
RUSH_BIG_PLAY_CHANCE = 0.045    # per carry (scaled by carrier speed)
RUSH_BIG_PLAY_YARDS = (15, 45)
RUSH_SHORT_YARDAGE_CONVERT = 0.62   # on 3rd/4th and 1-2, chance the carry reaches the line
RUSH_MIN_YARDS = -6
RUSH_FUMBLE_CHANCE = 0.017
FUMBLE_OFFENSE_RECOVERY = 0.50
FUMBLE_RETURN_TD_CHANCE = 0.05  # of fumbles lost beyond midfield

# ----- Kicking -----
FG_MAX_DISTANCE = 52            # yards, average kicker; + (kick_power - 50) / 8
FG_LONG_ATTEMPT_CHANCE = 0.6    # chance to attempt (rather than punt) from 50+ yards (was 0.45: 1.4 tries a game, real 1.6)
FG_MAKE = [(30, 0.95), (39, 0.86), (46, 0.74), (52, 0.58), (999, 0.40)]   # average kicker, by distance
FG_PER_ACCURACY_POINT = 0.004   # make chance per point of kick accuracy above neutral
TRAILING_LATE_SECONDS = 420     # trailing in the 2nd half with this much left: go for it
TYING_KICK_MAX_DISTANCE = 50    # down 1-3 late: kick from this distance or closer instead of going for it
TRAILING_DESPERATE_SECONDS = 240  # down one score: desperation fourth downs only inside 4:00
TRAILING_ONE_SCORE_BOLDNESS = 1.4  # down one score with more time: this much likelier to go than usual
# Punts, tuned so gross and net match real FBS (about 43 and 39.5 yards; tools/calibrate.py).
PUNT_DISTANCE = (44.2, 5.0)     # full kick in the air (mean, sd), + (punt_power - 50) / 5
PUNT_PIN_CHANCE = 0.75          # would carry inside the 10: chance to stop it short of the goal line
                                # (+ (punt_accuracy - NEUTRAL) / 100), else a touchback (real: about 7% of punts)
PUNT_RETURN_CHANCE = (0.54, 0.28)   # chance a punt is returned, landing outside / inside the receiving 20
PUNT_UNRETURNED = (0.55, 0.30, 0.15)   # the rest: fair catch, downed after a roll, out of bounds
PUNT_ROLL = (4.0, 4.0)          # yards a downed punt rolls on (mean, sd)
PUNT_RETURN_YARDS = (1.6, 5.4)  # an ordinary return: gamma (shape, scale) less 2 yards
PUNT_BREAKAWAY = (0.06, 30.0, 12.0)   # chance of a long return, its yards (mean, sd); real returns average 8-9
PUNT_RETURN_TD = 0.008          # per return, average returner
PUNT_RETURNER_TYPICAL = 0.53    # return_skill of a typical punt returner
PUNT_RETURN_SKILL = 1.5         # return yards and TD chance per point of return_skill above typical

# ----- Venue and coaching -----
# Any given Saturday: each team plays a little above or below itself on the day. Drawn once
# per game per team (gaussian, in rating points, on the same attributes as home field), it
# widens the spread of outcomes so a 28-point favourite still loses a few times in a hundred.
GAME_FORM_SD = 2.5              # was 4.4: the same matchup swung 17.5 points game to game (real football's whole residual is 15.9)
HFA_BASE_POINTS = 1.5           # rating points moved from the away team to the home team (2.0 before the defense terms grew)
HFA_STADIUM_POINTS = 0.8        # extra at a 99 stadium rating, less at a 0 (data: 30-90)
HFA_ATTRS = ("speed", "strength", "intelligence", "passing", "decision_making", "elusiveness",
             "vision", "hands", "route_running", "run_blocking", "pass_blocking", "rushing",
             "tackling", "coverage", "kick_accuracy", "punt_accuracy")
PASS_RATE_EFFECT = 0.6          # run chance shift at a 0 or 100 pass-rate tendency
PASS_LEAN = 0.004               # taken off every run chance (0.008 put passing volume 4-7% over 2026 through week 8 and
                                # fed the receiving leaders; 0 left 2026 passing 1.6 points short)
TEMPO_EFFECT = 0.80             # clock multiplier range for tempo 0..100 (was 0.60: plays per game varied 3.6 across teams, real
                                # about 4.4 once the 7-game sampling noise is taken out)
FOURTH_DOWN_TENDENCY_EFFECT = 0.8   # go-for-it odds scale for the fourth_down_go_rate tendency
FOURTH_DOWN_AGGRESSION = 1.8       # x the go-for-it odds short of the opponent 40 or on 4th and 1-2 (not trailing late):
                                   # the tables gave 1.5 tries a game, real 2.1
PLAY_CALLING_EFFECT = 0.5       # chance the better play caller wins the guessing game
RUN_CHANCE_MIN, RUN_CHANCE_MAX = 0.08, 0.92
RUN_CHANCE_MAX_OPTION = 0.96     # a team that almost never throws (pass_rate 5 or lower) runs up to this often

# ----- Kickoffs (college rules: kick from the 35, touchback to the 25) -----
KICKOFF_DISTANCE = 63.0             # yards from the 35 for an average leg (lands at the 2)
KICKOFF_DISTANCE_SD = 5.0
KICKOFF_PER_POWER_POINT = 0.25      # yards per point of kick power above neutral
KICKOFF_TOUCHBACK_FROM_END_ZONE = 0.75
KICKOFF_FAIR_CATCH_CHANCE = 0.55    # inside the 25: fair catch comes out to the 25
KICKOFF_OOB_CHANCE = 0.02
KICKOFF_RETURN_YARDS = 23.0         # average return
KICKOFF_RETURN_SD = 6.0
KICKOFF_BIG_RETURN_CHANCE = 0.06
KICKOFF_RETURN_TD_CHANCE = 0.004

# ----- Usage shares (calibrated against 2026 box scores, see calibrate_players.py) -----
TARGET_WEIGHT_POWER = 3.5       # receiver target weight = rating ** power (steeper = more concentrated; 4.0 put the
                                # full-season receiving leaders 17% over 2023-2025)
TARGET_MULT_MAX = 2.0           # cap on a receiver's real-usage target weight (data/real_adjustments.json)

# ----- Who gets the defensive stats (tools/realism.py: season leaders against real seasons) -----
# Tackle weight per player on the field: (dl, lb, olb, s, cb) for runs of 2 yards or less,
# 3-7 yards, and longer plays, times (skill / neutral) ** TACKLE_SKILL_POWER.
TACKLE_WEIGHTS_SHORT = (0.18, 0.29, 0.30, 0.12, 0.05)   # DL was 0.22: linemen made 23% of tackles (real about 20%)
TACKLE_WEIGHTS_MID = (0.065, 0.28, 0.30, 0.20, 0.10)     # DL was 0.08
TACKLE_WEIGHTS_LONG = (0.02, 0.16, 0.12, 0.34, 0.30)
TACKLE_SKILL_POWER = 0.7
TACKLE_ASSIST_CHANCE = 0.33     # share of tackles made by two players; both get an assist (NCAA scoring),
                                # so assisted / solo is about 1.0 (real 2026 box scores 0.94)
NO_TACKLE_CHANCE = 0.16        # a gain of 4+ yards that ends out of bounds: nobody is credited
COVERAGE_TACKLE_WEIGHTS = (0.3, 1.0, 0.4)   # who makes the tackle on a returned kick: by depth at the
                                # position (starter, second, the rest); real coverage units are mostly backups
FORCED_FUMBLE_SHARE = 0.7       # share of fumbles credited as forced (real 0.67 forced a team-game on about 1.1 fumbles)
SACK_SKILL_POWER = 1.3          # sack credit among the rushers: (pass rush / neutral) ** power
DB_SACK_SHARE = 0.08            # share of sacks credited to a blitzing corner or safety at blitz_rate 50 (scales with it;
                                # real 2026 through week 8: 158 of about 1,900); credit only, drawn from stat_rng
INT_SKILL_POWER = 1.5           # interception credit among the defensive backs: (coverage / neutral) ** power
QB_DESIGNED_RUN_SHARE = 0.06    # default share of carries that are designed QB runs (observed per team overrides)
BACKUP_RB_ROTATION = 0.40       # chance the sub is the next back down rather than the best one on the bench
SKILL_SUB_FATIGUE = 62          # fatigue level at which WR/TE starters (and backup RBs) rotate out (was 50)

# ----- Running back usage (roster.Team.rotate_backs) -----
# Real backfields are not even rotations: the lead back takes about half of the non-QB carries
# on an average team, a third on a committee and 70-80% on a team with a feature back (2026 box
# scores, season level: lead back share mean 46%, p10 33%, p90 63%, max 83%). The lead back (the
# healthy halfback highest on the depth chart) comes out when he passes RB_LEAD_SUB_FATIGUE or,
# on a committee, by the coach's series rotation (RB_LEAD_OUT_CHANCE per snap); once rested to
# RB_LEAD_RETURN_FATIGUE he comes back with a per-snap chance between the committee and the
# workhorse values. Both chances follow the team's "feature" score: how much better the lead
# back's carrier rating is than the next back's, mapped onto 0..1 by RB_LEAD_GAP_RANGE; the
# return chance rises as feature ** RB_LEAD_CURVE and the series rotation fades as
# (1 - feature) ** RB_LEAD_OUT_CURVE, so only a clear star goes straight back in while a lead back
# who is a little better than the next man still loses the committee's series rotation quickly.
# Backs recover faster on the bench than receivers: a back's rest is a few plays, not a series.
RB_LEAD_SUB_FATIGUE = 78
RB_LEAD_RETURN_FATIGUE = 40
RB_LEAD_OUT_CHANCE = 0.14             # committee: per-snap chance the fresh lead back comes out for a series (workhorse 0)
RB_LEAD_OUT_CURVE = 2                 # series rotation fades as (1 - feature) ** this
RB_LEAD_RETURN_CHANCE = (0.07, 0.6)   # committee .. workhorse, per snap once rested (workhorse was 1.0: lead backs took 42% of carries, real 38%)
RB_LEAD_GAP_RANGE = (-4.0, 24.0)      # lead-minus-next-back carrier rating: committee .. workhorse
RB_LEAD_CURVE = 4                     # return chance rises as feature ** this
RB_BENCH_RECOVERY = 2.0               # bench recovery multiplier for running backs
RB_SECOND_BACK_CARRY_WEIGHT = 0.45    # a second halfback on the field, next to the lead back's 0.80

# ----- Garbage time (teams take their foot off the gas) -----
GARBAGE_LEAD = 35           # second-half lead at which the leader goes conservative
GARBAGE_LEAD_ANY = 45       # lead at which that happens at any point in the game
BENCH_LEAD = 42             # lead at which starters sit (second half, or 3rd quarter on)
GARBAGE_CLOCK = 1.15        # plays take this much longer when the leader is milking the clock
GARBAGE_RUN_SHIFT = 0.25    # added to the leader's run chance
GARBAGE_BIG_PLAY = 0.75      # big-play chance multiplier for a conservative offense
COMEBACK_LEAD = 14          # trailing by this much in the 4th quarter: pass more, hurry
KNEEL_SECONDS = 75          # leading inside this many seconds of the 2nd half: victory formation

# ----- Situational football (engine/situation.py) -----
# Clock: a snap takes PLAY_SECONDS_SNAP_RANGE off the clock; when the clock keeps running the
# offense's pace decides the runoff before the next snap (40-second play clock).
PLAY_SECONDS_SNAP_RANGE = (5, 8)
PLAY_SECONDS_SNAP = 6
INCOMPLETE_SECONDS = (3, 5)
RUNOFF_NORMAL = (22, 34)
RUNOFF_HURRY = (3, 8)
RUNOFF_MILK = (33, 38)
READY_FOR_PLAY_FRACTION = 0.85  # after a first down or out of bounds outside 2:00, the clock restarts on the signal
OOB_BASE = 0.12                 # ball carrier ends up out of bounds (normal play)
OOB_HURRY = 0.35                # when the offense wants to stop the clock
OOB_STAY_IN = 0.03              # when the offense wants to keep it running
OOB_DEFENSE_KEEPS_IN = 0.6      # a leading defense late keeps the carrier in bounds
CLOSE_GAME = 16                 # two scores: the lead at which late-game behavior kicks in
MILK_SECONDS = 300              # leading in the 2nd half inside 5:00: run clock
MILK_LIGHT_SECONDS = 600        # leading by 9+ inside 10:00: run clock
MILK_RUN_SHIFT = 0.25
MILK_BIG_PLAY = 0.7
HURRY_SECONDS_TRAILING = 240    # trailing in the 2nd half inside 4:00: two-minute offense
TIED_HURRY_SECONDS = 100        # tied: two-minute offense only inside 1:40 (before that, normal football)
TIED_RUN_OUT_SECONDS = 40       # tied, deep in own territory with this little left: run it out to overtime
TIED_RUN_OUT_YARDLINE = 30
PLAY_FOR_KICK_SECONDS = 60      # tied or down 1-3 in easy range with this little left: play for the kick
PLAY_FOR_KICK_DISTANCE = 40     # field goal of this length or shorter
PLAY_FOR_KICK_RUN_SHIFT = 0.3   # run more
PLAY_FOR_KICK_BIG_PLAY = 0.85
HURRY_PASS_SHIFT = 0.35
H1_HURRY_SECONDS = 100          # end of the first half, in or near range: two-minute offense
H1_RUN_OUT_SECONDS = 30         # end of the first half, deep in own territory: run it out
H1_RUN_OUT_YARDLINE = 35
H1_RUN_OUT_MAX_DEFICIT = 99
H1_DEF_TIMEOUT_SECONDS = 60
PREVENT_SECONDS = 240           # leading by two scores or less inside 4:00: prevent defense
PREVENT_COMPLETION = 0.06       # completions allowed underneath
PREVENT_BIG_PLAY = 0.5
DEF_TIMEOUT_SECONDS = 180       # trailing defense uses timeouts inside 3:00
KNEEL_PLAY_SECONDS = 2
KNEEL_RUNOFF = 38
FG_CLUTCH_MAX_DISTANCE = 55     # a kick the offense will take with no time left
FG_NOW_SECONDS = 10
HAIL_MARY_SECONDS = 8
HAIL_MARY_MIN_YARDLINE = 40
HAIL_MARY_SUCCESS = 0.05
SPIKE_SECONDS = 40
ONSIDE_ONE_SCORE_SECONDS = 120
ONSIDE_TWO_SCORE_SECONDS = 300
ONSIDE_RECOVERY = 0.11
TWO_POINT_CHART_SECONDS = 900   # fourth quarter
TWO_POINT_TRAILING = {2, 5, 10, 13, 16, 18, 21}
TWO_POINT_LEADING = {1, 4, 5, 12}
