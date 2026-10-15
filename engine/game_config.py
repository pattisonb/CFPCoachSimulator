"""
Game Configuration - Slider System
Similar to EA Sports College Football sliders
All values range from 0-100, where 50 = default/normal
Adjusting above 50 increases that attribute, below 50 decreases it

The TUNING block below holds every calibration constant the engine uses. They were set
by running `calibrate.py` against FBS averages (see README). Ratings are 0-100 and the
formulas are written as differences from NEUTRAL, so a league of better or worse teams
still plays like football; only the gap between the two teams decides the game.
"""

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
PASS_YARDS_WR = (12.3, 5.5)     # gauss mean, sd for WR completions
PASS_YARDS_TE = (9.5, 4.5)
PASS_YARDS_RB = (5.0, 4.0)
PASS_SPEED_EFFECT = 0.007       # yards multiplier per point of receiver speed minus DB speed
PASS_BIG_PLAY_CHANCE = 0.08    # of WR/TE completions
PASS_BIG_PLAY_YARDS = (22, 65)
PASS_MIN_YARDS = -2
SCRAMBLE_CHANCE = 0.13          # of plays with no completion and no pick
RECEPTION_FUMBLE_CHANCE = 0.010

# ----- Rushing -----
RUSH_BASE_YARDS = (3.3, 2.7)    # gauss mean, sd
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
BACKUP_RB_ROTATION = 0.15       # chance the sub is the next back down rather than the best one on the bench
SKILL_SUB_FATIGUE = 62          # fatigue level at which RB/WR/TE starters rotate out (was 50)
