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

# ----- injuries -----
INJURIES = True

# In-game momentum (off unless the season setting turns it on per game): big plays swing a
# team's momentum between -1 and 1, which nudges its ratings by up to MOMENTUM_EFFECT.
MOMENTUM = False
MOMENTUM_EFFECT = 0.05
MOMENTUM_DECAY = 0.93          # per snap, so a swing fades over a drive or two
MOMENTUM_HALF = 0.5            # what is left at the start of the second half
INJURY_PER_SNAP = 0.00085       # per player on the field per snap: about 1.3 injuries a game per team
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
OFF_PENALTY_CHANCE = 0.050
DEF_PENALTY_CHANCE = 0.035

# ----- Passing -----
THROWAWAY_CHANCE = 0.03
SACK_BASE = 0.050               # per dropback with equal lines
SACK_PER_LINE_POINT = 0.0015    # per point of (pass rush - pass protection)
SACK_PER_QB_POINT = 0.0004      # per point of QB decision making above neutral (fewer sacks)
SACK_GUESSED_BONUS = 0.035      # defense called a pass defense
SACK_YARDS = (7.5, 2.0)         # gauss mean, sd (loss)
SACK_FUMBLE_CHANCE = 0.13
COMPLETION_BASE = 0.645         # equal QB, receiver and coverage
COMPLETION_PER_QB_POINT = 0.0030
COMPLETION_PER_RECV_POINT = 0.0015
COMPLETION_PER_COV_POINT = 0.0025
COMPLETION_GUESSED = -0.055
COMPLETION_NOT_GUESSED = 0.015
COMPLETION_LONG_3RD = -0.05     # 3rd/4th and 7+
COMPLETION_CHECKDOWN_BONUS = 0.12
COMPLETION_MIN, COMPLETION_MAX = 0.25, 0.86
RB_TARGET_SHARE = 0.16          # share of targets that go to running backs
TE_TARGET_WEIGHT = 0.75         # tight ends targeted a bit less than their ratings imply
INT_BASE = 0.065                # per incompletion (not throwaways)
INT_PER_COV_POINT = 0.0013
INT_PER_QB_POINT = 0.0013       # per point of decision making above neutral (fewer picks)
INT_GUESSED_BONUS = 0.02
INT_MIN, INT_MAX = 0.02, 0.22
PICK_SIX_CHANCE = 0.09          # of interceptions
PASS_YARDS_WR = (12.6, 5.5)     # gauss mean, sd for WR completions
PASS_YARDS_TE = (9.5, 4.5)
PASS_YARDS_RB = (5.0, 4.0)
PASS_SPEED_EFFECT = 0.007       # yards multiplier per point of receiver speed minus DB speed
PASS_BIG_PLAY_CHANCE = 0.08    # of WR/TE completions
PASS_BIG_PLAY_YARDS = (22, 65)
PASS_MIN_YARDS = -2
SCRAMBLE_CHANCE = 0.13          # of plays with no completion and no pick
RECEPTION_FUMBLE_CHANCE = 0.010

# ----- Rushing -----
RUSH_BASE_YARDS = (3.4, 2.7)    # gauss mean, sd
RUSH_PER_LINE_POINT = 0.040     # yards per point of (run blocking - run defense)
RUSH_PER_CARRIER_POINT = 0.035  # yards per point of carrier rating above neutral
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
FG_LONG_ATTEMPT_CHANCE = 0.45   # chance to attempt (rather than punt) from 50+ yards
FG_MAKE = [(30, 0.95), (39, 0.86), (46, 0.74), (52, 0.58), (999, 0.40)]   # average kicker, by distance
FG_PER_ACCURACY_POINT = 0.004   # make chance per point of kick accuracy above neutral
TRAILING_LATE_SECONDS = 420     # trailing in the 2nd half with this much left: go for it
PUNT_DISTANCE = (43.0, 5.0)

# ----- Venue and coaching -----
# Any given Saturday: each team plays a little above or below itself on the day. Drawn once
# per game per team (gaussian, in rating points, on the same attributes as home field), it
# widens the spread of outcomes so a 28-point favourite still loses a few times in a hundred.
GAME_FORM_SD = 3.6
HFA_BASE_POINTS = 2.0           # rating points moved from the away team to the home team
HFA_STADIUM_POINTS = 0.8        # extra at a 99 stadium rating, less at a 0 (data: 30-90)
HFA_ATTRS = ("speed", "strength", "intelligence", "passing", "decision_making", "elusiveness",
             "vision", "hands", "route_running", "run_blocking", "pass_blocking", "rushing",
             "tackling", "coverage", "kick_accuracy", "punt_accuracy")
PASS_RATE_EFFECT = 0.6          # run chance shift at a 0 or 100 pass-rate tendency
TEMPO_EFFECT = 0.40             # clock multiplier range for tempo 0..100
FOURTH_DOWN_TENDENCY_EFFECT = 0.8   # go-for-it odds scale for the fourth_down_go_rate tendency
PLAY_CALLING_EFFECT = 0.5       # chance the better play caller wins the guessing game
RUN_CHANCE_MIN, RUN_CHANCE_MAX = 0.08, 0.92

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
TARGET_WEIGHT_POWER = 5.0       # receiver target weight = rating ** power (steeper = more concentrated)
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
RB_LEAD_RETURN_CHANCE = (0.07, 1.0)   # committee .. workhorse, per snap once rested
RB_LEAD_GAP_RANGE = (-4.0, 24.0)      # lead-minus-next-back carrier rating: committee .. workhorse
RB_LEAD_CURVE = 4                     # return chance rises as feature ** this
RB_BENCH_RECOVERY = 2.0               # bench recovery multiplier for running backs
RB_SECOND_BACK_CARRY_WEIGHT = 0.45    # a second halfback on the field, next to the lead back's 0.80

# ----- Garbage time (teams take their foot off the gas) -----
GARBAGE_LEAD = 28           # second-half lead at which the leader goes conservative
GARBAGE_LEAD_ANY = 38       # lead at which that happens at any point in the game
BENCH_LEAD = 35             # lead at which starters sit (second half, or 3rd quarter on)
GARBAGE_CLOCK = 1.30        # plays take this much longer when the leader is milking the clock
GARBAGE_RUN_SHIFT = 0.35    # added to the leader's run chance
GARBAGE_BIG_PLAY = 0.5      # big-play chance multiplier for a conservative offense
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
HURRY_SECONDS_TRAILING = 240    # trailing or tied in the 2nd half inside 4:00: two-minute offense
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
