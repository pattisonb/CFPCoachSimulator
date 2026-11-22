/*
Game situation: the college clock rules and what teams do late in a half or a game.

Clock rules (NCAA, 2023 onward): the game clock stops on an incomplete pass, when the ball
carrier goes out of bounds, on a penalty, a score, a change of possession and a timeout.
After a first down or an out-of-bounds play it restarts on the referee's ready-for-play
signal, except inside the last two minutes of either half, where it stays stopped until
the snap. Each team has three timeouts per half. The play clock is 40 seconds.

Behavior by situation:
  hurry      trailing inside 4:00 (tied: inside 1:40) and short on time: snap fast, throw more, get out of bounds,
             use timeouts after in-bounds plays, spike with no timeouts, kick a field goal
             as soon as the clock demands it, throw a Hail Mary with seconds left
  play_for_kick  tied or down 1-3, inside easy field-goal range in the last minute: run the
             ball, avoid sacks and turnovers, kick at the end
  milk       leading in the second half with the game close: run more, stay in bounds,
             snap late in the play clock, kneel when the clock allows it
  run_out    deep in own territory at the end of the first half: run it out
  prevent    the defense of a team leading late: keep the ball in front, keep the carrier
             in bounds, call timeouts to stop the clock when it trails or is tied
  garbage    big lead or deficit: conservative play, starters rest (drive_functions)
*/

import { random, get, getattr, int } from "./pyrt.js";

import { cfg } from "./game_config.js";

// The module's namespace: its constants live here and are read through it.
export const sit = {};

sit.TWO_MINUTES = 120;
// Run it out: run the ball, stay in bounds, snap late (end of the half, or tied deep in own territory).
sit.RUN_OUT = {"mode": "run_out", "run_out": true, "pass_shift": 0.6, "oob_want": 0.02, "snap_late": true};


export function lead_of(team) {
    return getattr(team, "lead", 0);
}
sit.lead_of = lead_of;


/** What the offense (and the defense) are trying to do on this snap. */
export function assess(offense, defense, seconds, down, distance, yardline, clock_stopped) {
    const lead = sit.lead_of(offense);
    const half = getattr(offense, "half", 1);
    const overtime = getattr(offense, "in_overtime", false);
    const off_timeouts = getattr(offense, "timeouts", 3);
    const def_timeouts = getattr(defense, "timeouts", 3);
    const s = {"mode": "normal", "pass_shift": 0.0, "oob_want": cfg.OOB_BASE, "big_play_mult": 1.0, "prevent": false,
               "kneel": false, "fg_now": false, "hail_mary": false, "spike": false, "use_timeout": false,
               "def_timeout": false, "run_out": false, "snap_fast": false, "snap_late": false};
    if (overtime) {
        return s;
    }

    // --- End of the first half -------------------------------------------------
    if (half === 1) {
        if (seconds <= cfg.H1_RUN_OUT_SECONDS && yardline < cfg.H1_RUN_OUT_YARDLINE && lead >= -cfg.H1_RUN_OUT_MAX_DEFICIT) {
            Object.assign(s, sit.RUN_OUT);
            return s;
        }
        if (seconds <= cfg.H1_HURRY_SECONDS && yardline >= cfg.H1_RUN_OUT_YARDLINE) {
            Object.assign(s, {mode: "hurry", snap_fast: true, pass_shift: -cfg.HURRY_PASS_SHIFT, oob_want: cfg.OOB_HURRY});
        }
        sit._end_of_half_kicks(s, seconds, yardline, down, clock_stopped, off_timeouts, lead, half);
        return s;
    }

    // --- Second half --------------------------------------------------------------
    const fourth_quarter = seconds <= cfg.QUARTER_SECONDS;
    if (lead > 0 && fourth_quarter) {
        // How hard the leader runs clock grows with the lead and as time runs down.
        if (seconds <= cfg.MILK_SECONDS || lead >= 17 || (lead >= 9 && seconds <= cfg.MILK_LIGHT_SECONDS)) {
            Object.assign(s, {mode: "milk", snap_late: true, pass_shift: cfg.MILK_RUN_SHIFT, oob_want: cfg.OOB_STAY_IN, big_play_mult: cfg.MILK_BIG_PLAY});
            // victory formation once kneeling can burn the rest of the clock
            if (seconds <= sit.kneel_window(down, def_timeouts)) {
                s["kneel"] = true;
            }
            return s;
        }
        if (lead >= 9) {
            Object.assign(s, {mode: "milk", snap_late: true, pass_shift: cfg.MILK_RUN_SHIFT * 0.5, oob_want: cfg.OOB_STAY_IN});
            return s;
        }
    }
    if (lead === 0 && seconds <= cfg.TIED_RUN_OUT_SECONDS && yardline < cfg.TIED_RUN_OUT_YARDLINE) {
        // tied, deep in own territory with seconds left: run it out and take overtime
        Object.assign(s, sit.RUN_OUT);
        return s;
    }
    const hurry_window = lead === 0 ? cfg.TIED_HURRY_SECONDS : cfg.HURRY_SECONDS_TRAILING;
    if (lead <= 0 && (seconds <= hurry_window || (lead < 0 && -lead >= cfg.COMEBACK_LEAD && seconds <= cfg.QUARTER_SECONDS))) {
        const deficit = -lead;
        Object.assign(s, {mode: "hurry", snap_fast: true, pass_shift: -cfg.HURRY_PASS_SHIFT, oob_want: cfg.OOB_HURRY});
        if (deficit > cfg.CLOSE_GAME) {
            s["mode"] = "desperate";
        } else if (deficit <= 3 && seconds <= cfg.PLAY_FOR_KICK_SECONDS && (100 - yardline) + 17 <= cfg.PLAY_FOR_KICK_DISTANCE) {
            // tied or down 1-3 in easy range with a minute left: protect the ball and set up the kick
            Object.assign(s, {mode: "play_for_kick", snap_fast: false, pass_shift: cfg.PLAY_FOR_KICK_RUN_SHIFT,
                              oob_want: cfg.OOB_BASE, big_play_mult: cfg.PLAY_FOR_KICK_BIG_PLAY});
        }
        sit._end_of_half_kicks(s, seconds, yardline, down, clock_stopped, off_timeouts, lead, half);
    }
    return s;
}
sit.assess = assess;


/** Prevent defense and defensive timeouts (second half, close game). */
export function defense_posture(offense, defense, seconds) {
    const lead = sit.lead_of(defense);     // the defense's own lead
    const half = getattr(defense, "half", 1);
    const overtime = getattr(defense, "in_overtime", false);
    const out = {"prevent": false, "def_timeout": false, "keep_in_bounds": false};
    if (overtime || half !== 2) {
        if (half === 1 && lead <= 0 && seconds <= cfg.H1_DEF_TIMEOUT_SECONDS) {
            out["def_timeout"] = true;
        }
        return out;
    }
    if (0 < lead && lead <= cfg.CLOSE_GAME && seconds <= cfg.PREVENT_SECONDS) {
        Object.assign(out, {prevent: true, keep_in_bounds: true});
    }
    if ((lead < 0 && seconds <= cfg.DEF_TIMEOUT_SECONDS) || (lead === 0 && seconds <= cfg.TIED_HURRY_SECONDS)) {
        out["def_timeout"] = true;
    }
    return out;
}
sit.defense_posture = defense_posture;


/** Seconds the leader can burn by kneeling from this down, given the defense's timeouts. */
export function kneel_window(down, def_timeouts) {
    const kneels = Math.max(0, 4 - down);     // downs left that end the game before 4th-down trouble
    const runoffs = Math.max(0, kneels - def_timeouts);
    return kneels * cfg.KNEEL_PLAY_SECONDS + runoffs * cfg.KNEEL_RUNOFF;
}
sit.kneel_window = kneel_window;


/** Field goal now, spike, or Hail Mary when the clock leaves no other choice. */
export function _end_of_half_kicks(s, seconds, yardline, down, clock_stopped, timeouts, lead, half) {
    const fg_distance = (100 - yardline) + 17;
    const in_range = fg_distance <= cfg.FG_CLUTCH_MAX_DISTANCE;
    const needs_points = half === 1 || lead <= 0;
    const time_for_one_play = clock_stopped ? seconds <= cfg.FG_NOW_SECONDS : seconds <= cfg.FG_NOW_SECONDS + cfg.PLAY_SECONDS_SNAP;
    if (in_range && needs_points && time_for_one_play && (half === 1 || lead >= -3)) {
        s["fg_now"] = true;
        return;
    }
    if (needs_points && !in_range && seconds <= cfg.HAIL_MARY_SECONDS && yardline >= cfg.HAIL_MARY_MIN_YARDLINE) {
        s["hail_mary"] = true;
        return;
    }
    if (!clock_stopped && seconds <= cfg.SPIKE_SECONDS && timeouts === 0 && down < 4) {
        s["spike"] = true;
    } else if (!clock_stopped && seconds <= sit.TWO_MINUTES && timeouts > 0) {
        s["use_timeout"] = true;
    }
}
sit._end_of_half_kicks = _end_of_half_kicks;


/**
 * Seconds the play takes off the clock and whether the clock is stopped until the next snap.
 *
 * pace_mult scales the between-play runoff (tempo, game speed, garbage time).
 * Returns [seconds, stopped].
 */
export function play_clock(result, oob, first_down, seconds, situation, posture, offense, defense, pace_mult) {
    let stops_until_snap = ["incomplete", "offensive penalty", "defensive penalty", "fumble", "interception",
                            "defensive_touchdown", "spike"].includes(result);
    const last_two = seconds <= sit.TWO_MINUTES;
    if ((oob || first_down) && last_two) {
        stops_until_snap = true;
    }
    let play_seconds = random.randint(...cfg.PLAY_SECONDS_SNAP_RANGE);
    if (["incomplete", "spike"].includes(result)) {
        play_seconds = random.randint(...cfg.INCOMPLETE_SECONDS);
    }
    if (stops_until_snap) {
        return [play_seconds, true];
    }
    // Clock keeps running (or restarts on the ready-for-play signal): who controls the runoff?
    let lo, hi;
    if (get(situation, "snap_fast")) {
        [lo, hi] = cfg.RUNOFF_HURRY;
    } else if (get(situation, "snap_late")) {
        [lo, hi] = cfg.RUNOFF_MILK;
    } else {
        [lo, hi] = cfg.RUNOFF_NORMAL;
    }
    let runoff = random.randint(lo, hi) * pace_mult;
    if (oob || first_down) {
        runoff *= cfg.READY_FOR_PLAY_FRACTION;   // restarted on the signal, so part of the gap passes stopped
    }
    // Timeouts: the offense saves clock in a hurry, the trailing defense saves clock against a milking offense.
    if (get(situation, "use_timeout") && getattr(offense, "timeouts", 0) > 0 && seconds - play_seconds > 0) {
        offense.timeouts -= 1;
        offense.team_stats["timeouts_used"] = get(offense.team_stats, "timeouts_used", 0) + 1;
        return [play_seconds, true];
    }
    if (get(posture, "def_timeout") && getattr(defense, "timeouts", 0) > 0 && seconds - play_seconds > 0 && seconds - play_seconds <= cfg.DEF_TIMEOUT_SECONDS) {
        defense.timeouts -= 1;
        defense.team_stats["timeouts_used"] = get(defense.team_stats, "timeouts_used", 0) + 1;
        return [play_seconds, true];
    }
    runoff = Math.min(runoff, Math.max(0, seconds - play_seconds));
    return [play_seconds + int(runoff), false];
}
sit.play_clock = play_clock;


/** Did the ball carrier end the play out of bounds? */
export function out_of_bounds(result, situation, posture) {
    if (!["run", "successful_pass", "checkdown_pass"].includes(result)) {
        return false;
    }
    let p = get(situation, "oob_want", cfg.OOB_BASE);
    if (get(posture, "keep_in_bounds")) {
        p *= cfg.OOB_DEFENSE_KEEPS_IN;
    }
    return random.random() < p;
}
sit.out_of_bounds = out_of_bounds;


export function wants_onside(kicking_lead, seconds, half, overtime) {
    if (overtime || half !== 2 || kicking_lead >= 0) {
        return false;
    }
    const deficit = -kicking_lead;
    if (deficit <= 8) {
        return seconds <= cfg.ONSIDE_ONE_SCORE_SECONDS;
    }
    if (deficit <= 16) {
        return seconds <= cfg.ONSIDE_TWO_SCORE_SECONDS;
    }
    return seconds <= cfg.ONSIDE_TWO_SCORE_SECONDS && deficit <= 24;
}
sit.wants_onside = wants_onside;


/** The standard chart, used in the fourth quarter (and late third). */
export function go_for_two(lead_after_six, seconds, half, overtime) {
    if (overtime || half !== 2 || seconds > cfg.TWO_POINT_CHART_SECONDS) {
        return false;
    }
    if (lead_after_six < 0) {
        return cfg.TWO_POINT_TRAILING.has(-lead_after_six);
    }
    return cfg.TWO_POINT_LEADING.has(lead_after_six);
}
sit.go_for_two = go_for_two;
