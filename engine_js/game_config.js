/*
Game Configuration - Slider System
Similar to EA Sports College Football sliders
All values range from 0-100, where 50 = default/normal
Adjusting above 50 increases that attribute, below 50 decreases it

The TUNING block below holds every calibration constant the engine uses. They were
calibrated against FBS averages. The engine reads each player's card numbers as card points
over the average FBS starter at his position, so a league of better or worse teams still
plays like football; only the gap between the two teams decides the game.
*/

import { Random } from "./pyrt.js";

// The module's namespace: every constant and variable below is a property of it, read and written through it.
export const cfg = {};

// Random source for stat attribution only (which lineman allowed a pressure, which defender
// broke up a pass). It never touches the game's own stream, so results are unchanged by it.
cfg.stat_rng = new Random(0);
// Injuries roll on their own stream too, so a sim with injuries off reproduces the same game.
cfg.injury_rng = new Random(1);

// ----- personnel (engine_js/personnel.js) -----
cfg.HEAVY_JUMBO_SHARE = 0.25;         // short yardage / goal line: share of snaps with a sixth lineman
cfg.HEAVY_13_SHARE = 0.30;            // ... with three tight ends
cfg.PASSING_DOWN_10_SHARE = 0.35;     // third-and-long: share of snaps in four-wide (Air Raid 1.6x)
cfg.CONSERVATIVE_HEAVY_SHARE = 0.5;   // a leader milking the clock: share of snaps in 12 or 21
cfg.NICKEL_VS_11 = 0.55;              // a 4-3 or 3-4 answers three receivers with a nickel back this often
cfg.DIME_ON_PASSING_DOWN = 0.35;      // third-and-long against three receivers: dime this often, else nickel
cfg.DEF_SUB_FATIGUE = {"DL": 30, "MLB": 50, "ROLB": 50, "LOLB": 50, "CB": 58, "S": 58};    // rotation points by position (linemen rotate most)
cfg.TE_BLOCK_CREDIT_SHARE = 0.45;     // a tight end's or fullback's share of a blocking credit, relative to a lineman
cfg.FB_CARRY_WEIGHT = 0.10;           // a fullback's carry weight next to a halfback's 0.80
cfg.FLEXBONE_FB_CARRY_WEIGHT = 1.5;   // ... in a Flexbone Triple Option, where the dive fullback carries 30-44% (Air Force, Army, Navy)

// ----- injuries -----
cfg.INJURIES = true;
cfg.INJURY_PER_SNAP = 0.00085;        // per player on the field per snap: about 1.3 injuries a game per team
// Quarterbacks and backs take the most hits: real teams start more than one passer and lead back
// over a season (tools/realism.mjs: the 100th passer's yards, the 1,000-yard rushers).
cfg.INJURY_POSITION_MULT = {"QB": 2.2, "RB": 1.7};
// cumulative probability, weeks out (0 = rest of this game only)
cfg.INJURY_SEVERITY = [[0.55, 0], [0.72, 1], [0.84, 2], [0.91, 3], [0.95, 5], [0.98, 8], [1.0, 20]];
cfg.INJURY_TYPES = ["ankle sprain", "hamstring strain", "knee sprain", "shoulder injury", "concussion", "groin strain",
                "wrist injury", "hip pointer", "calf strain", "high ankle sprain", "foot injury", "back spasms"];

// ----- momentum -----
// In-game momentum (off unless the season setting turns it on per game): big plays swing a
// team's momentum between -1 and 1, which nudges its ratings by up to MOMENTUM_EFFECT.
cfg.MOMENTUM = false;
cfg.MOMENTUM_EFFECT = 0.05;
cfg.MOMENTUM_DECAY = 0.93;           // per snap, so a swing fades over a drive or two
cfg.MOMENTUM_HALF = 0.5;             // what is left at the start of the second half
export class GameSliders {
    /** Centralized slider configuration for game parameters */

    constructor() {
        // ========== OFFENSE SLIDERS ==========
        this.qb_accuracy = 50;          // QB passing accuracy (affects completion %)
        this.wr_catching = 50;          // WR/TE catching ability
        this.pass_blocking = 50;        // Offensive line pass protection
        this.run_blocking = 50;         // Offensive line run blocking
        this.running_ability = 50;      // RB rushing effectiveness
        this.fumble_frequency = 50;     // Offensive fumble rate (lower = fewer fumbles)
        this.offensive_penalties = 50;  // Offensive penalty frequency (lower = fewer penalties)

        // ========== DEFENSE SLIDERS ==========
        this.pass_defense = 50;         // Pass coverage effectiveness
        this.interceptions = 50;        // Interception frequency
        this.pass_rush = 50;            // Defensive pass rush / sack rate
        this.run_defense = 50;          // Run defense effectiveness
        this.tackling = 50;             // Tackling ability
        this.defensive_penalties = 50;  // Defensive penalty frequency (lower = fewer penalties)
        this.forced_fumbles = 50;       // Forced fumble frequency

        // ========== SPECIAL TEAMS SLIDERS ==========
        this.kicking_power = 50;        // Kicker/punter power
        this.kicking_accuracy = 50;     // Kicker accuracy (PATs, FGs)
        this.punt_accuracy = 50;        // Punter accuracy (pinning, distance)
        this.kickoff_power = 50;        // Kickoff distance
        this.kickoff_return = 50;       // Kickoff return effectiveness

        // ========== GAME PLAY SLIDERS ==========
        this.game_speed = 50;           // Overall game tempo (affects time per play)
        this.injury_frequency = 50;     // Injury frequency (not yet implemented)
        this.home_field_advantage = 50; // Home field advantage (scales the home team's rating edge, engine_js/game.js)
    }

    /**
     * Convert slider value (0-100) to multiplier
     * 50 = 1.0 (normal)
     * 0 = 0.5 (50% of normal)
     * 100 = 1.5 (150% of normal)
     */
    get_multiplier(slider_value) {
        return 0.5 + (slider_value / 100);
    }

    /**
     * Adjust a percentage based on slider
     * 50 = base percentage
     * 0 = base * 0.5
     * 100 = base * 1.5
     */
    get_percentage_adjustment(slider_value, base_percentage) {
        return base_percentage * this.get_multiplier(slider_value);
    }

    /**
     * For sliders where lower = better (like fumbles, penalties)
     * 50 = base percentage
     * 0 = base * 1.5 (more frequent)
     * 100 = base * 0.5 (less frequent)
     */
    get_inverse_percentage_adjustment(slider_value, base_percentage) {
        return base_percentage * (1.5 - (slider_value / 100));
    }
}
cfg.GameSliders = GameSliders;


// Global slider instance - can be modified before running simulation
cfg.sliders = new GameSliders();

// ===================== CALIBRATION CONSTANTS =====================

// Clock. Two 30-minute halves; the quarter mark splits each half for the box score.
cfg.HALF_SECONDS = 1800;
cfg.QUARTER_SECONDS = 900;
// The seconds a play takes are set in the "Situational football" block below.
cfg.LATE_GAME_DRAG = 0.10;            // plays take up to this much longer at the end of a half

// What the engine reads of a player is card points over the average FBS starter at his position (0 is an average
// starter: teamdata_js/build_teams.js). A formula that weighs a player against the average does it against REF_POINTS:
// (REF_POINTS + his points) / REF_POINTS is 1 for the average starter. *tune*
cfg.REF_POINTS = 22;
cfg.FATIGUE_STEP = 0.4;                // a tired player's attributes move in steps of this many card points
cfg.BLAME_REF = 18.4;                  // a blocker's weight for a sack or a stuffed run he is blamed for: this less his points
// A return rating as return_skill reads it (0-1): the league's average returner's, and how much a card point over him adds
cfg.RETURN_SKILL_AVG = 0.55;
cfg.RETURN_SKILL_PER_POINT = 0.025;

// Penalties per snap (before the sliders).
cfg.OFF_PENALTY_CHANCE = 0.050;
cfg.DEF_PENALTY_CHANCE = 0.035;
// ----- Turnovers, injuries and penalties (ratings v2, phase 5) -----
// Multipliers around 1 that average out over the league, per card point of an attribute over the average FBS starter
// in his card group.
cfg.FUMBLE_SECURITY_EFFECT = 0.0144;    // fumble chance x (1 - this per point of the carrier's Ball Security)
cfg.FUMBLE_HIT_EFFECT = 0.0096;         // ... x (1 + this per point of the tacklers' Hit Power)
cfg.INT_DEPTH_MULT = {"short": 0.75, "mid": 1.05, "deep": 1.65};    // deep throws are picked off more (averages about 1)
cfg.INT_PRESSURE_MULT = 1.3;           // a hurried throw ...
cfg.INT_POISE_EFFECT = 0.012;          // ... less so for a poised quarterback (per point of Pocket Poise)
cfg.INT_BALL_SKILLS_EFFECT = 0.008;    // x (1 + this per point of the coverage players' Ball Skills)
cfg.INJURY_DURABILITY_EFFECT = 0.024;  // injury chance x (1 - this per point of Durability)
cfg.PENALTY_IQ_EFFECT = 0.012;         // penalty chance x (1 - this per point of the unit's Football IQ)
// ----- Traits (ratings v2, phase 6) -----
// Each trait (ratings.TRAITS) has a tier, 1 bronze to 4 platinum; the effects below are per
// tier. A unit's traits add up ("points" = the sum of the tiers on the field).
cfg.TRAIT_FX = {
    "pinpoint": 0.003,           // completion, clean pocket
    "timing_passer": 0.0024,      // completion, short throws
    "unflappable": 0.0036,        // completion when pressured
    "on_the_move": 0.0018,        // completion when pressured: accurate_on_the_run, poised_on_the_run, off_platform
    "sack_avoid": 0.009,          // sack rate x (1 - this): steps_up, escape_artist, play_extender
    "glue_hands": 0.0018,         // completion on throws to him
    "jump_ball": 0.006,          // completion on contested throws to him
    "double_move": 0.0045,        // completion on deep throws to him
    "sharp_cutter": 0.0024,       // completion on short and intermediate throws to him
    "press_beater": 0.003,       // completion against man coverage
    "target_pull": 0.03,         // target weight x (1 + this): qbs_favorite, checkdown_target
    "breakaway": 0.036,           // long-gain chance x (1 + this): breakaway_speed
    "open_field": 0.045,          // yards on outside runs: quick_feet, slippery, spin_artist, stiff_arm_specialist
    "power_run": 0.036,           // yards on inside runs: tough_runner, downhill_runner, bulldozer, balance
    "extra_effort": 0.03,        // yards on every carry
    "bulldozer_push": 0.009,      // short-yardage conversion
    "ball_protector": 0.045,      // fumble x (1 - this)
    "line_run": 0.009,            // run yards per point of the line's run-blocking traits
    "line_pass": 0.0036,          // sack rate x (1 - this per point) of the line's pass-protection traits
    "rush": 0.0036,               // sack rate x (1 + this per point) of the rushers' traits
    "cover": 0.0012,              // completion - this per point of coverage traits in the right call
    "ballhawk": 0.006,            // interception x (1 + this per point)
    "tackle": 0.009,              // run yards - this per point of the front's tackling and shedding traits
    "hitter": 0.012,              // fumble x (1 + this per point) of the hitters on the field
    "iron_horse": 0.36,            // endurance, card points a tier
    "quick_recovery": 0.045,      // sideline recovery x (1 + this)
    "long_range": 0.6,             // field-goal range, yards
    "automatic": 0.006,           // make chance on kicks under 40 yards
    "crowd": 0.15,                // rating points at home: crowd_favorite
    "road_warrior": 0.075,        // share of the road penalty he shrugs off
};
cfg.LINE_RUN_TRAITS = ["road_grader", "edge_sealer", "second_level_blocker", "vise_grip", "option_blocker"];
cfg.LINE_PASS_TRAITS = ["pocket_protector", "quick_set", "quick_pass_set", "interior_wall", "play_action_protector"];
cfg.RUSH_TRAITS = ["pocket_collapser", "edge_bender", "gap_penetrator", "pressure_player", "finisher", "jump_the_snap"];
cfg.TACKLE_TRAITS = ["sure_tackler", "pack_tackler", "block_buster", "hand_fighter", "edge_setter"];
cfg.HIT_TRAITS = ["heavy_hitter", "jarring_hits", "ball_jarrer"];

// ----- The 17 situational abilities (clutch time, the scramble, lead blocking, the kicking game) -----
// Each is per tier and small, a fixed nudge with no draw of its own, so it moves no other draw in a game.
cfg.CLUTCH_SECONDS = 900;               // "clutch time": the fourth quarter (and overtime) ...
cfg.CLUTCH_MARGIN = 8;                  // ... within one score
cfg.COVER_TRAITS_MAN = ["shadow", "jam_artist"];
cfg.COVER_TRAITS_ZONE = ["route_jumper"];
Object.assign(cfg.TRAIT_FX, {
    "closer": 0.004,             // completion, and rush yards x 40, in clutch time: closer
    "ice_water": 0.015,          // field-goal make chance in clutch time: ice_water, clutch_leg
    "ball_handler": 0.004,       // completion on play-action throws
    "scramble": 0.06,            // scramble chance x (1 + this), and +10x this yards: option_maestro, tuck_and_run
    "coach_field": 0.0015,       // completion on every throw: coach_on_the_field
    "lead_back": 0.12,           // run yards per point of lead-blocking backs on the field
    "option_killer": 0.06,       // scramble chance x (1 - this per point) of the defenders who read it
    "pin_artist": 0.05,          // pin chance on a punt that would carry inside the 10
    "cannon_leg": 1.5,           // punt yards, and field-goal range in yards
    "natural_talent": 0.06,      // offseason growth x (1 + this): develop in career_js/offseason
});
cfg.LINE_RUN_TRAITS = cfg.LINE_RUN_TRAITS.concat(["line_leader", "grinder", "screen_blocker"]);
cfg.LINE_PASS_TRAITS = cfg.LINE_PASS_TRAITS.concat(["line_leader"]);
cfg.TACKLE_TRAITS = cfg.TACKLE_TRAITS.concat(["defensive_leader"]);
cfg.COVER_TRAITS_MAN = cfg.COVER_TRAITS_MAN.concat(["diving_breakup", "defensive_leader"]);
cfg.COVER_TRAITS_ZONE = cfg.COVER_TRAITS_ZONE.concat(["diving_breakup", "defensive_leader"]);
// ----- Coach styles -----
// What the offensive scheme leans toward: deep and short shares of throws (x), the share of
// runs that go outside (+), how often it uses play-action (x). Multiple is neutral.
cfg.SCHEME_STYLE = {
    "Air Raid": {"deep": 1.25, "short": 1.10, "outside": 0.05, "pa": 0.6},
    "West Coast": {"deep": 0.80, "short": 1.20, "outside": 0.00, "pa": 1.1},
    "Spread RPO": {"deep": 0.95, "short": 1.10, "outside": 0.08, "pa": 1.3},
    "Power Spread": {"deep": 1.05, "short": 0.95, "outside": -0.10, "pa": 1.2},
    "Spread Option": {"deep": 1.00, "short": 1.00, "outside": 0.12, "pa": 1.0},
    "Pro Style": {"deep": 1.05, "short": 0.95, "outside": -0.08, "pa": 1.4},
    "Flexbone Triple Option": {"deep": 1.30, "short": 0.80, "outside": 0.05, "pa": 1.5},
};
cfg.DEEP_SHOT_EFFECT = 0.012;          // deep share x (1 + this per point of the OC's deep-shot rate over 50)
cfg.PLAY_ACTION_BASE = 0.20;           // share of first- and second-down dropbacks with a play-action fake
cfg.PLAY_ACTION_RATE_EFFECT = 0.015;   // ... x (1 + this per point of the OC's play-action rate over 50)
cfg.PLAY_ACTION_COMPLETION = 0.05;     // intermediate and deep throws off a fake that holds
cfg.PLAY_ACTION_SKILL = 0.003;        // ... per point of the QB's Play-Action over the front's Diagnosis
cfg.PLAY_ACTION_DEEP = 1.3;            // deep share x this off a fake
cfg.PLAY_ACTION_SACK = 1.15;           // sack rate x this (the longer dropback)
cfg.MAN_RATE_EFFECT = 0.008;           // man share + this per point of the DC's man-coverage rate over 50
cfg.PRESS_RATE = 0.5;                  // share of man calls with press at a press rate of 50 (x rate / 50)
cfg.PRESS_EFFECT = 0.0025;            // short and intermediate completion per point of Release over the coverage's Press
cfg.BLITZ_BASE = 0.25;                 // share of dropbacks blitzed at a blitz rate of 50 (x rate / 50)
cfg.BLITZ_SACK = [1.35, 0.883];        // sack rate x (blitz, no blitz): about 1 on average (1.6/0.8 magnified talent edges)
cfg.BLITZ_BIG_PLAY = [1.35, 0.883];    // long-gain chance x (blitz, no blitz): fewer men in coverage
cfg.DISCIPLINE_EFFECT = 0.01;          // penalty chance x (1 - this per point of discipline over 50; discipline is the
// head coach's rating beyond what the team's talent predicts, build_teams.decouple_discipline)

// ----- Passing -----
cfg.THROWAWAY_CHANCE = 0.03;
cfg.SACK_BASE = 0.050;                // per dropback with equal lines
cfg.SACK_PER_LINE_POINT = 0.00375;     // per point of (pass rush - pass protection)
cfg.SACK_PER_QB_POINT = 0.001;       // per point of QB decision making above neutral (fewer sacks)
cfg.SACK_GUESSED_BONUS = 0.035;       // defense called a pass defense
// ----- Pass rush and protection (ratings v2, phase 4) -----
// Each dropback the rush is a power rush or a speed rush (the rushers' style tilts it). Power
// Rush meets Pass Pro: Anchor and Speed Rush meets Footwork, each as the side's lean over its
// own average of the two (the composites still set the level). Rates per house-scale point.
cfg.RUSH_POWER_SHARE = 0.5;
cfg.RUSH_STYLE_TILT = 0.02;            // power share + this per point of the rushers' power over speed
cfg.RUSH_MATCHUP_EFFECT = 0.0024;      // sack rate per point of (the rushers' lean in this rush - the line's lean against it)
cfg.SACK_ESCAPE_EFFECT = 0.0048;        // sack rate x (1 - this per point of Sack Escape over the average quarterback)
// Pressure that does not become a sack now hurries the throw: completion falls, less for a
// poised quarterback, and the stat credit follows the same pressure.
cfg.PRESSURE_PER_SACK_RATE = 2.5;      // pressure chance = this x the sack rate (at most 0.6)
cfg.PRESSURE_COMPLETION = -0.08;       // completion change when pressured
cfg.POISE_EFFECT = 0.003;             // ... back by this per point of Pocket Poise over the average quarterback
cfg.THROW_ON_MOVE_EFFECT = 0.002;     // *tune* ... and by this per point of Throwing on the Move over the league average (a pressured throw is off platform)
cfg.SACK_YARDS = [7.5, 2.0];          // gauss mean, sd (loss)
cfg.SACK_FUMBLE_CHANCE = 0.13;
cfg.COMPLETION_BASE = 0.695;          // equal QB, receiver and coverage (0.641 before pressure cost completions)
cfg.COMPLETION_PER_QB_POINT = 0.00325;    // per card point of the starting QB over the average (fit so the QB's pull on team
// completion % and margin matched the real 2026 seasons through week 8)
cfg.COMPLETION_PER_RECV_POINT = 0.00375;
cfg.COMPLETION_PER_COV_POINT = 0.008;    // per card point of the coverage over the average (fit to points allowed by defense rating)
cfg.COMPLETION_GUESSED = -0.055;
cfg.COMPLETION_NOT_GUESSED = 0.015;
cfg.COMPLETION_LONG_3RD = -0.05;      // 3rd/4th and 7+
cfg.COMPLETION_CHECKDOWN_BONUS = 0.12;
cfg.REDZONE_COMPLETION = [[10, -0.10], [20, -0.06]];    // (yards to goal or fewer, completion change): a short field squeezes coverage
cfg.COMPLETION_MIN = 0.25; cfg.COMPLETION_MAX = 0.86;
cfg.RB_TARGET_SHARE = 0.14;           // share of targets that go to running backs
cfg.TE_TARGET_WEIGHT = 0.68;          // tight ends targeted a bit less than their ratings imply
cfg.INT_BASE = 0.05;                  // per incompletion (not throwaways); 0.055 gave 2.8 picks per 100 attempts (real 2.24)
cfg.INT_PER_COV_POINT = 0.001;        // was 0.0013: interception rate per point of the secondary moved +0.067 in the sim, -0.007 real
cfg.INT_PER_QB_POINT = 0.001;         // per point of decision making above neutral (fewer picks); was 0.0013: interception
// rate per QB point moved -0.055 in the sim, -0.004 real
cfg.INT_GUESSED_BONUS = 0.02;
cfg.INT_MIN = 0.02; cfg.INT_MAX = 0.22;
cfg.PICK_SIX_CHANCE = 0.09;           // of interceptions
// ----- Passing by depth (ratings v2, phase 2) -----
// Each throw to a receiver or tight end has a depth: short (under 10 yards), intermediate
// (10-20) or deep (20+). The share of each, before the receiver's speed and Deep Routes tilt it:
cfg.PASS_DEPTH_SHARE = {"WR": [0.50, 0.32, 0.18], "TE": [0.58, 0.35, 0.07]};
cfg.PASS_DEEP_SPEED_TILT = 1.0;        // deep share x (receiver speed / neutral) ** this
cfg.PASS_DEEP_ROUTE_TILT = 0.012;      // deep share x (1 + this per point of Deep Routes over his route average)
cfg.DEPTH_COMPLETION = {"short": 0.08, "mid": -0.05, "deep": -0.24};    // added to the completion chance
cfg.PASS_YARDS_SHORT = [7.0, 3.0];     // gauss mean, sd of the catch point plus run, before yards after the catch
cfg.PASS_YARDS_MID = [15.5, 3.5];
cfg.PASS_YARDS_DEEP = [22, 56];        // uniform
cfg.PASS_BREAKAWAY_CHANCE = 0.05;      // a short or intermediate catch broken for a long gain (x speed / neutral)
// The attributes add how a player differs from his own average at each depth (the composites
// above already set his level), in completion chance per house-scale point:
cfg.DEPTH_ACCURACY_EFFECT = 0.005;    // QB accuracy at the throw's depth over his accuracy average
cfg.ARM_DEEP_EFFECT = 0.0024;          // deep throws: arm strength over his accuracy average
cfg.ROUTE_DEPTH_EFFECT = 0.004;       // receiver's route skill at the depth over his route average
// Man or zone, called each pass play; the coverage players' Man or Zone over their average of the two
cfg.MAN_COVERAGE_SHARE = 0.45;
cfg.COVERAGE_TYPE_EFFECT = 0.005;
// Contested catches: a defender on the receiver at the catch point, more often deeper
cfg.CONTESTED_SHARE = {"short": 0.10, "mid": 0.25, "deep": 0.45};
cfg.CONTESTED_EFFECT = 0.007;         // per point of (Contested Catches - defender's Ball Skills) / 2 + leaping and height edge
cfg.CONTESTED_HEIGHT_POINTS = 1;     // an inch of height is worth this many rating points at the catch point
cfg.PASS_YARDS_RB = [5.0, 4.0];       // gauss mean, sd for completions to running backs (receivers and tight ends: by depth above)
cfg.PASS_SPEED_EFFECT = 0.00875;       // *tune* yards multiplier per point of receiver speed minus DB speed (0.007 ran the top
// receivers' yards a catch over the real leaders': tools/realism.mjs)
cfg.PASS_TACKLE_EFFECT = 0.015;       // yards multiplier per point of the coverage players' tackling below their average (yards after the catch)
cfg.PASS_BIG_PLAY_YARDS = [22, 65];   // a short or intermediate catch broken for a long gain (PASS_BREAKAWAY_CHANCE)
cfg.PASS_MIN_YARDS = -2;
cfg.SCRAMBLE_CHANCE = 0.13;           // of plays with no completion and no pick
cfg.RECEPTION_FUMBLE_CHANCE = 0.010;

// ----- Rushing -----
cfg.RUSH_BASE_YARDS = [3.9, 2.7];     // *tune* gauss mean, sd (official YPC counts sacks as runs; 3.75 before the carrier's share below came down)
cfg.RUSH_PER_LINE_POINT = 0.1;      // yards per point of (run blocking - run defense)
cfg.RUSH_PER_CARRIER_POINT = 0.05;   // *tune* yards per point of carrier rating above the front seven's pursuit (speed and tackling);
// 0.035 put the 5th and 10th rushers 10-16% over real seasons with the 50th under
// ----- Running by direction (ratings v2, phase 3) -----
// Each carry goes inside or outside. Blocking, the front and the carrier's style read
// differently in each; like the pass game, the attributes add how a player differs from his
// own average (the composites above still set his level), in yards per house-scale point.
cfg.RUN_OUTSIDE_SHARE = 0.40;          // of carries, before the carrier's style tilts it
cfg.RUN_STYLE_TILT = 0.012;            // outside share + this per point of his speed style over his power style
cfg.RUN_LINE_STYLE_EFFECT = 0.05;     // yards per point: the line's drive (inside) or reach (outside) over its average of the two
cfg.RUN_FRONT_STYLE_EFFECT = 0.04;    // yards per point: the front's shedding (inside) or pursuit (outside) over its average
cfg.RUN_WEIGHT_EFFECT = 0.015;         // inside runs: yards per pound of line weight over the front's, against the usual gap
cfg.LINE_WEIGHT_GAP = 52;              // the usual gap: FBS starting linemen 312 lb, starting fronts 260
cfg.RUN_CARRIER_STYLE_EFFECT = 0.04;  // yards per point: power style inside, speed style outside, over his own average
cfg.RUN_VISION_EFFECT = 0.03;         // yards per point of Running Vision over his ball-carrying average
cfg.FINISH_BLOCK_EFFECT = 0.02;       // *tune* yards per point of the line's Finishing Blocks over the league average, every run
cfg.LEAD_BLOCK_EFFECT = 0.02;         // *tune* yards per point of the lead blockers' Lead Blocking (linemen and a fullback) over the league average, outside runs
cfg.HIGHLIGHT_CATCH_SHARE = 0.3;       // *tune* how much of a contested catch is Highlight Catches (the rest Contested Catches)
cfg.SHORT_YARDAGE_STYLE_EFFECT = 0.0048;    // conversion chance per point of power running and drive blocking over shedding
cfg.RUSH_GUESSED = -0.9;
cfg.RUSH_NOT_GUESSED = 0.5;
cfg.RUSH_BIG_PLAY_CHANCE = 0.045;     // per carry (scaled by carrier speed)
cfg.RUSH_BIG_PLAY_SPEED_POWER = 0.5;  // *tune* ... as (speed / neutral) ** this; at 1 a fast back's long runs put the top ten rushers
// about 10% over real seasons' (tools/realism.mjs)
cfg.RUSH_BIG_PLAY_YARDS = [15, 45];
cfg.RUSH_SHORT_YARDAGE_CONVERT = 0.62;    // on 3rd/4th and 1-2, chance the carry reaches the line
cfg.RUSH_MIN_YARDS = -6;
cfg.RUSH_FUMBLE_CHANCE = 0.017;
cfg.FUMBLE_OFFENSE_RECOVERY = 0.50;
cfg.FUMBLE_RETURN_TD_CHANCE = 0.05;   // of fumbles lost beyond midfield

// ----- Kicking -----
cfg.FG_MAX_DISTANCE = 52;             // yards, average kicker; + (kick_power - 50) / 8
cfg.FG_LONG_ATTEMPT_CHANCE = 0.6;     // chance to attempt (rather than punt) from 50+ yards (was 0.45: 1.4 tries a game, real 1.6)
cfg.FG_MAKE = [[30, 0.95], [39, 0.86], [46, 0.74], [52, 0.58], [999, 0.40]];    // average kicker, by distance
cfg.FG_PER_ACCURACY_POINT = 0.01;     // make chance per point of kick accuracy over the average kicker
cfg.TRAILING_LATE_SECONDS = 420;      // trailing in the 2nd half with this much left: go for it
cfg.TYING_KICK_MAX_DISTANCE = 50;     // down 1-3 late: kick from this distance or closer instead of going for it
cfg.TRAILING_DESPERATE_SECONDS = 240;   // down one score: desperation fourth downs only inside 4:00
cfg.TRAILING_ONE_SCORE_BOLDNESS = 1.4;   // down one score with more time: this much likelier to go than usual
// Punts, tuned so gross and net match real FBS (about 43 and 39.5 yards).
cfg.PUNT_DISTANCE = [44.2, 5.0];      // full kick in the air (mean, sd), + half a yard a card point of punt power over the average punter
cfg.PUNT_PIN_CHANCE = 0.75;           // would carry inside the 10: chance to stop it short of the goal line ...
cfg.PUNT_PIN_PER_POINT = 0.025;       // ... and this more a point of punt accuracy over the average punter
// else a touchback (real: about 7% of punts)
cfg.PUNT_RETURN_CHANCE = [0.54, 0.28];    // chance a punt is returned, landing outside / inside the receiving 20
cfg.PUNT_UNRETURNED = [0.55, 0.30, 0.15];    // the rest: fair catch, downed after a roll, out of bounds
cfg.PUNT_ROLL = [4.0, 4.0];           // yards a downed punt rolls on (mean, sd)
cfg.PUNT_RETURN_YARDS = [1.6, 5.4];   // an ordinary return: gamma (shape, scale) less 2 yards
cfg.PUNT_BREAKAWAY = [0.06, 30.0, 12.0];    // chance of a long return, its yards (mean, sd); real returns average 8-9
cfg.PUNT_RETURN_TD = 0.008;           // per return, average returner
cfg.PUNT_RETURNER_TYPICAL = 0.53;     // return_skill of a typical punt returner
cfg.PUNT_RETURN_SKILL = 1.5;          // return yards and TD chance per point of return_skill above typical

// ----- Venue and coaching -----
// Any given Saturday: each team plays a little above or below itself on the day. Drawn once
// per game per team (gaussian, in rating points, on the same attributes as home field), it
// widens the spread of outcomes so a 28-point favourite still loses a few times in a hundred.
cfg.GAME_FORM_SD = 2.5;               // was 4.4: the same matchup swung 17.5 points game to game (real football's whole residual is 15.9)
cfg.HFA_BASE_POINTS = 1.5;            // rating points moved from the away team to the home team (2.0 before the defense terms grew)
cfg.HFA_STADIUM_POINTS = 0.8;         // extra at a 99 stadium rating, less at a 0 (data: 30-90)
cfg.HFA_ATTRS = ["speed", "strength", "intelligence", "passing", "decision_making", "elusiveness",
             "vision", "hands", "route_running", "run_blocking", "pass_blocking", "rushing",
             "tackling", "coverage", "kick_accuracy", "punt_accuracy"];
cfg.PASS_RATE_EFFECT = 0.6;           // run chance shift at a 0 or 100 pass-rate tendency
cfg.PASS_LEAN = 0.004;                // taken off every run chance (0.008 put passing volume 4-7% over 2026 through week 8 and
// fed the receiving leaders; 0 left 2026 passing 1.6 points short)
cfg.TEMPO_EFFECT = 0.80;              // clock multiplier range for tempo 0..100 (was 0.60: plays per game varied 3.6 across teams, real
// about 4.4 once the 7-game sampling noise is taken out)
cfg.FOURTH_DOWN_TENDENCY_EFFECT = 0.8;    // go-for-it odds scale for the fourth_down_go_rate tendency
cfg.FOURTH_DOWN_AGGRESSION = 1.8;        // x the go-for-it odds short of the opponent 40 or on 4th and 1-2 (not trailing late):
// the tables gave 1.5 tries a game, real 2.1
cfg.PLAY_CALLING_EFFECT = 0.83;       // chance the better play caller wins the guessing game (per 100 points of play calling between them)
cfg.RUN_CHANCE_MIN = 0.08; cfg.RUN_CHANCE_MAX = 0.92;
cfg.RUN_CHANCE_MAX_OPTION = 0.96;      // a team that almost never throws (pass_rate 5 or lower) runs up to this often

// ----- Kickoffs (college rules: kick from the 35, touchback to the 25) -----
cfg.KICKOFF_DISTANCE = 63.0;              // yards from the 35 for an average leg (lands at the 2)
cfg.KICKOFF_DISTANCE_SD = 5.0;
cfg.KICKOFF_PER_POWER_POINT = 0.625;      // yards per point of kick power over the average kicker
cfg.KICKOFF_TOUCHBACK_FROM_END_ZONE = 0.75;
cfg.KICKOFF_FAIR_CATCH_CHANCE = 0.55;     // inside the 25: fair catch comes out to the 25
cfg.KICKOFF_OOB_CHANCE = 0.02;
cfg.KICKOFF_RETURN_YARDS = 23.0;          // average return
cfg.KICKOFF_RETURN_SD = 6.0;
cfg.KICKOFF_BIG_RETURN_CHANCE = 0.06;
cfg.KICKOFF_RETURN_TD_CHANCE = 0.004;

// ----- Usage shares (calibrated against 2026 box scores) -----
cfg.TARGET_WEIGHT_POWER = 3.3;        // *tune* receiver target weight = rating ** power (steeper = more concentrated; 4.0 put the
// full-season receiving leaders 17% over 2023-2025, 3.5 15% over, 2.5 8% once pass-heavy
// teams threw as much as they really do: tools/realism.mjs)
cfg.TARGET_MULT_MAX = 1.3;            // *tune* cap on a receiver's real-usage target weight (his `target_mult` in the roster file); 2.0 fed the
// top receivers too much (the leader had 2,100 yards where real leaders have 1,500)

// ----- Who gets the defensive stats (tools/realism.mjs: season leaders against real seasons) -----
// Tackle weight per player on the field: (dl, lb, olb, s, cb) for runs of 2 yards or less,
// 3-7 yards, and longer plays, times (skill / neutral) ** TACKLE_SKILL_POWER.
cfg.TACKLE_WEIGHTS_SHORT = [0.22, 0.29, 0.30, 0.11, 0.045];   // *tune* real 2026 (cfbstats, every FBS team): linemen and edge
cfg.TACKLE_WEIGHTS_MID = [0.085, 0.28, 0.30, 0.19, 0.09];     // rushers 25% of tackles, linebackers 32%, backs 41%; the sim gives 23 / 33 / 43
cfg.TACKLE_WEIGHTS_LONG = [0.02, 0.16, 0.12, 0.34, 0.30];
cfg.TACKLE_SKILL_POWER = 1.2;
cfg.TACKLE_ASSIST_CHANCE = 0.33;      // share of tackles made by two players; both get an assist (NCAA scoring),
// so assisted / solo is about 1.0 (real 2026 box scores 0.94)
cfg.NO_TACKLE_CHANCE = 0.16;         // a gain of 4+ yards that ends out of bounds: nobody is credited
cfg.COVERAGE_TACKLE_WEIGHTS = [0.3, 1.0, 0.4];    // who makes the tackle on a returned kick: by depth at the
// position (starter, second, the rest); real coverage units are mostly backups
cfg.FORCED_FUMBLE_SHARE = 0.7;        // share of fumbles credited as forced (real 0.67 forced a team-game on about 1.1 fumbles)
cfg.SACK_SKILL_POWER = 1.3;           // sack credit among the rushers: (pass rush / neutral) ** power
cfg.DB_SACK_SHARE = 0.08;             // share of sacks credited to a blitzing corner or safety at blitz_rate 50 (scales with it;
// real 2026 through week 8: 158 of about 1,900); credit only, drawn from stat_rng
cfg.INT_SKILL_POWER = 2.4;            // *tune* interception credit among the defensive backs: (coverage / neutral) ** power (1.5 spread
// them too evenly: 13 players a season with five or more, real 18-22; 2.4 gives about 20, 4.0 gave 36)
cfg.QB_DESIGNED_RUN_SHARE = 0.06;     // default share of carries that are designed QB runs (observed per team overrides)
cfg.BACKUP_RB_ROTATION = 0.40;        // chance the sub is the next back down rather than the best one on the bench
cfg.SKILL_SUB_FATIGUE = 62;           // fatigue level at which WR/TE starters (and backup RBs) rotate out (was 50)

// ----- Running back usage (roster.Team.rotate_backs) -----
// Real backfields are not even rotations: the lead back takes about half of the non-QB carries
// on an average team, a third on a committee and 70-80% on a team with a feature back (2026 box
// scores, season level: lead back share mean 46%, p10 33%, p90 63%, max 83%). The lead back (the
// healthy halfback highest on the depth chart) comes out when he passes RB_LEAD_SUB_FATIGUE or,
// on a committee, by the coach's series rotation (RB_LEAD_OUT_CHANCE per snap); once rested to
// RB_LEAD_RETURN_FATIGUE he comes back with a per-snap chance between the committee and the
// workhorse values. Both chances follow the team's "feature" score: how much better the lead
// back's carrier rating is than the next back's, mapped onto 0..1 by RB_LEAD_GAP_RANGE; the
// return chance rises as feature ** RB_LEAD_CURVE and the series rotation fades as
// (1 - feature) ** RB_LEAD_OUT_CURVE, so only a clear star goes straight back in while a lead back
// who is a little better than the next man still loses the committee's series rotation quickly.
// A real team's observed split (tendencies rb1_share, observed in the real box scores: the top back's
// share of running back carries in an average game) replaces the roster gap when its real lead
// back leads: RB_LEAD_SHARE_CURVE is the share each feature score produces in the sim, and the
// feature is read off it in reverse. Measured over 120 real games between FBS teams with the
// constants below (the feature curve the real adjustments were tuned on), the lead back's own share runs 38% at
// feature 0 to 73% at 1 and the top back's (he changes from game to game on a committee)
// 48% to 75%. The observed share counts games against FCS schools too, where real teams
// bench their backs harder than the sim does, so it sits about two points under the FBS
// share: the curve is the midpoint of the two measurements, which puts the per-game share
// (FBS games) a point low and the season-level share a point or two
// high. Re-measure both if the RB_LEAD_* constants change.
// Backs recover faster on the bench than receivers: a back's rest is a few plays, not a series.
cfg.RB_LEAD_SHARE_CURVE = [[0.0, 43.0], [0.125, 45.2], [0.25, 48.4], [0.375, 52.3], [0.5, 57.3],
                       [0.625, 64.1], [0.75, 68.5], [0.875, 72.8], [1.0, 74.0]];    // (feature, top back's share %)
cfg.RB_LEAD_SUB_FATIGUE = 78;
cfg.RB_LEAD_GAME_CARRIES = 24;              // *tune* carries in a game after which the lead back shares the rest (a run-heavy, fast team
// gave its back 450 carries a season; real leaders top out near 370)
cfg.RB_LEAD_WORKLOAD = [0.25, 0.25];        // *tune* ... per-snap chance he comes out, and his return chance x this
cfg.RB_LEAD_RETURN_FATIGUE = 40;
cfg.RB_LEAD_OUT_CHANCE = 0.14;              // committee: per-snap chance the fresh lead back comes out for a series (workhorse 0)
cfg.RB_LEAD_OUT_CURVE = 2;                  // series rotation fades as (1 - feature) ** this
cfg.RB_LEAD_RETURN_CHANCE = [0.07, 0.6];    // committee .. workhorse, per snap once rested (workhorse was 1.0: lead backs took 42% of carries, real 38%)
cfg.RB_LEAD_GAP_RANGE = [-1.6, 9.6];        // lead-minus-next-back carrier rating (card points): committee .. workhorse
cfg.RB_LEAD_CURVE = 4;                      // return chance rises as feature ** this
cfg.RB_BENCH_RECOVERY = 2.0;                // bench recovery multiplier for running backs
cfg.RB_SECOND_BACK_CARRY_WEIGHT = 0.45;     // a second halfback on the field, next to the lead back's 0.80

// ----- Garbage time (teams take their foot off the gas) -----
cfg.GARBAGE_LEAD = 35;            // second-half lead at which the leader goes conservative
cfg.GARBAGE_LEAD_ANY = 45;        // lead at which that happens at any point in the game
cfg.BENCH_LEAD = 42;              // lead at which starters sit (second half, or 3rd quarter on)
cfg.GARBAGE_CLOCK = 1.15;         // plays take this much longer when the leader is milking the clock
cfg.GARBAGE_RUN_SHIFT = 0.25;     // added to the leader's run chance
cfg.GARBAGE_BIG_PLAY = 0.75;       // big-play chance multiplier for a conservative offense
cfg.COMEBACK_LEAD = 14;           // trailing by this much in the 4th quarter: pass more, hurry

// ----- Situational football (engine_js/situation.js) -----
// Clock: a snap takes PLAY_SECONDS_SNAP_RANGE off the clock; when the clock keeps running the
// offense's pace decides the runoff before the next snap (40-second play clock).
cfg.PLAY_SECONDS_SNAP_RANGE = [5, 8];
cfg.PLAY_SECONDS_SNAP = 6;
cfg.INCOMPLETE_SECONDS = [3, 5];
cfg.RUNOFF_NORMAL = [22, 34];
cfg.RUNOFF_HURRY = [3, 8];
cfg.RUNOFF_MILK = [33, 38];
cfg.READY_FOR_PLAY_FRACTION = 0.85;   // after a first down or out of bounds outside 2:00, the clock restarts on the signal
cfg.OOB_BASE = 0.12;                  // ball carrier ends up out of bounds (normal play)
cfg.OOB_HURRY = 0.35;                 // when the offense wants to stop the clock
cfg.OOB_STAY_IN = 0.03;               // when the offense wants to keep it running
cfg.OOB_DEFENSE_KEEPS_IN = 0.6;       // a leading defense late keeps the carrier in bounds
cfg.CLOSE_GAME = 16;                  // two scores: the lead at which late-game behavior kicks in
cfg.MILK_SECONDS = 300;               // leading in the 2nd half inside 5:00: run clock
cfg.MILK_LIGHT_SECONDS = 600;         // leading by 9+ inside 10:00: run clock
cfg.MILK_RUN_SHIFT = 0.25;
cfg.MILK_BIG_PLAY = 0.7;
cfg.HURRY_SECONDS_TRAILING = 240;     // trailing in the 2nd half inside 4:00: two-minute offense
cfg.TIED_HURRY_SECONDS = 100;         // tied: two-minute offense only inside 1:40 (before that, normal football)
cfg.TIED_RUN_OUT_SECONDS = 40;        // tied, deep in own territory with this little left: run it out to overtime
cfg.TIED_RUN_OUT_YARDLINE = 30;
cfg.PLAY_FOR_KICK_SECONDS = 60;       // tied or down 1-3 in easy range with this little left: play for the kick
cfg.PLAY_FOR_KICK_DISTANCE = 40;      // field goal of this length or shorter
cfg.PLAY_FOR_KICK_RUN_SHIFT = 0.3;    // run more
cfg.PLAY_FOR_KICK_BIG_PLAY = 0.85;
cfg.HURRY_PASS_SHIFT = 0.35;
cfg.H1_HURRY_SECONDS = 100;           // end of the first half, in or near range: two-minute offense
cfg.H1_RUN_OUT_SECONDS = 30;          // end of the first half, deep in own territory: run it out
cfg.H1_RUN_OUT_YARDLINE = 35;
cfg.H1_RUN_OUT_MAX_DEFICIT = 99;
cfg.H1_DEF_TIMEOUT_SECONDS = 60;
cfg.PREVENT_SECONDS = 240;            // leading by two scores or less inside 4:00: prevent defense
cfg.PREVENT_COMPLETION = 0.06;        // completions allowed underneath
cfg.PREVENT_BIG_PLAY = 0.5;
cfg.DEF_TIMEOUT_SECONDS = 180;        // trailing defense uses timeouts inside 3:00
cfg.KNEEL_PLAY_SECONDS = 2;
cfg.KNEEL_RUNOFF = 38;
cfg.FG_CLUTCH_MAX_DISTANCE = 55;      // a kick the offense will take with no time left
cfg.FG_NOW_SECONDS = 10;
cfg.HAIL_MARY_SECONDS = 8;
cfg.HAIL_MARY_MIN_YARDLINE = 40;
cfg.HAIL_MARY_SUCCESS = 0.05;
cfg.HAIL_MARY_PER_POINT = 0.025;      // ... times 1 plus this a point of the passer's passing over the average starter
cfg.SPIKE_SECONDS = 40;
cfg.ONSIDE_ONE_SCORE_SECONDS = 120;
cfg.ONSIDE_TWO_SCORE_SECONDS = 300;
cfg.ONSIDE_RECOVERY = 0.11;
cfg.TWO_POINT_CHART_SECONDS = 900;    // fourth quarter
cfg.TWO_POINT_TRAILING = new Set([2, 5, 10, 13, 16, 18, 21]);
cfg.TWO_POINT_LEADING = new Set([1, 4, 5, 12]);
