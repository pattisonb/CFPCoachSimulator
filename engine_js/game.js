// engine/game.py in JavaScript (see PORTING.md).
//
// Run one full game and return a JSON-ready result.
//
// This replaces the original `start_game.py`, which kept the teams as module globals and
// printed everything. The half, overtime, kickoff and scoring logic here follow the
// original; the differences are listed in docs/HOW_IT_WORKS.md.
import { random, round, get, isNumber, truthy, int, floordiv, mod } from "./pyrt.js";
import { drive_functions } from "./drive_functions.js";
import { play_functions } from "./play_functions.js";
import { sit } from "./situation.js";
import { cfg } from "./game_config.js";
import { game_functions } from "./game_functions.js";
import { roster } from "./roster.js";

// HALF_SECONDS, QUARTER_MARK, OT_START_YARDLINE (75: the opponent 25-yard line) and SLIDER_NAMES
// live on the namespace object at the foot of this file (game.HALF_SECONDS ...).

/** `a or b` for values whose Python truth is not JavaScript's (an empty dict or list is false). */
const _or = (a, b) => (truthy(a) ? a : b);

/** A plain dict (isinstance(t, dict)). */
const _is_dict = (t) => t !== null && typeof t === "object" && !Array.isArray(t);

/** str(v) inside an f-string, for the few values that can be None there. */
function _str(v) {
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  return String(v);
}

/** dict.clear() on a plain object: the same object, emptied in place. */
function _clear_dict(d) {
  for (const k of Object.keys(d)) delete d[k];
}

/**
 * float(value) as apply_sliders uses it: the number, or undefined where Python raises TypeError or
 * ValueError (None, a list, a dict, text that is not a number).
 */
function _float(value) {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1.0 : 0.0;
  if (typeof value === "string") {
    const s = value.trim();
    if (/^[+-]?(inf|infinity)$/i.test(s)) return s[0] === "-" ? -Infinity : Infinity;
    if (/^[+-]?nan$/i.test(s)) return NaN;
    if (/^[+-]?(\d+(_\d+)*\.?(\d+(_\d+)*)?|\.\d+(_\d+)*)([eE][+-]?\d+(_\d+)*)?$/.test(s)) return Number(s.replace(/_/g, ""));
  }
  return undefined;
}

/** Every slider at its default value. */
export function default_sliders() {
  const fresh = new cfg.GameSliders();
  const out = {};
  for (const name of game.SLIDER_NAMES) out[name] = fresh[name];
  return out;
}

/**
 * Set the engine's global sliders from `overrides` (unknown names ignored).
 *
 * Returns the full slider set that is now active.
 */
export function apply_sliders(overrides) {
  const defaults = default_sliders();
  const active = { ...defaults };
  for (const [name, value] of Object.entries(_or(overrides, {}))) {
    if (Object.prototype.hasOwnProperty.call(defaults, name)) {
      const f = _float(value);
      if (f !== undefined && !Number.isNaN(f)) {
        // int(max(0, min(100, f))), with Python's min and max (the first argument wins a tie)
        const low = f < 100 ? f : 100;
        active[name] = int(low > 0 ? low : 0);
      } else if (f !== undefined) {
        active[name] = 100;      // float("nan"): min(100, nan) is 100
      }
    }
  }
  for (const [name, value] of Object.entries(active)) {
    cfg.sliders[name] = value;
  }
  return active;
}

/** One game between two teams built from raw roster dicts. */
export class GameSim {
  constructor(home_data, away_data, venue = "home") {
    home_data = GameSim._copy_roster(home_data);
    away_data = GameSim._copy_roster(away_data);
    this.venue = venue === "home" || venue === "neutral" ? venue : "home";
    this.home_advantage = 0.0;
    if (this.venue === "home") {
      const stadium = get(home_data, "home_field_advantage", 50);
      this.home_advantage = (cfg.HFA_BASE_POINTS + (stadium - 50) / 50 * cfg.HFA_STADIUM_POINTS);
      this.home_advantage *= cfg.sliders.get_multiplier(cfg.sliders.home_field_advantage);
      GameSim._shift_ratings(home_data, this.home_advantage / 2);
      GameSim._shift_ratings(away_data, -this.home_advantage / 2);
      // traits: a Crowd Favorite lifts at home; a Road Warrior shrugs off part of the road penalty
      GameSim._trait_shift(home_data, "crowd_favorite", (t) => cfg.TRAIT_FX["crowd"] * t);
      GameSim._trait_shift(away_data, "road_warrior", (t) => this.home_advantage / 2 * cfg.TRAIT_FX["road_warrior"] * t);
    }
    // the day's form: each side a little above or below itself (see cfg.GAME_FORM_SD)
    this.form = { home: 0.0, away: 0.0 };
    if (truthy(cfg.GAME_FORM_SD)) {
      const form_home = random.gauss(0, cfg.GAME_FORM_SD);
      const form_away = random.gauss(0, cfg.GAME_FORM_SD);
      this.form = { home: form_home, away: form_away };
      GameSim._shift_ratings(home_data, this.form["home"]);
      GameSim._shift_ratings(away_data, this.form["away"]);
    }
    this.home = GameSim._make_team(home_data);
    this.away = GameSim._make_team(away_data);
    this.key = new Map([[this.home, "home"], [this.away, "away"]]);     // Python keys this by id(team)
    this.score = { home: 0, away: 0 };
    this.quarter_scores = { home: [0, 0, 0, 0], away: [0, 0, 0, 0] };
    this.ot_periods = [];
    this.scoring_plays = [];
    this.drives = [];
    this.half = 1;
    this.seconds = game.HALF_SECONDS;
    this.in_overtime = false;
    this.ot_number = 0;
    this._td_stats_seen = 0;
    this._log_mark = null;     // where the next drive's play log starts, when a kickoff came first
  }

  /**
   * A private copy of what the game mutates: the player dicts (ratings are shifted
   * for home field) and, inside Player, each stats dict. Everything else is read-only.
   */
  static _copy_roster(data) {
    return { ...data, offense: data["offense"].map((p) => ({ ...p })), defense: data["defense"].map((p) => ({ ...p })) };
  }

  /** Move every rating by `delta` (home crowd, travel). Applied before the teams are built. */
  static _shift_ratings(data, delta) {
    for (const p of [...data["offense"], ...data["defense"]]) {
      for (const attr of cfg.HFA_ATTRS) {
        if (isNumber(get(p, attr))) {
          p[attr] = Math.max(1, Math.min(99, p[attr] + delta));
        }
      }
    }
  }

  /** Move the ratings of the players holding `trait` by amount(tier). */
  static _trait_shift(data, trait, amount) {
    for (const p of [...data["offense"], ...data["defense"]]) {
      let tier = 0;
      for (const t of _or(get(p, "traits"), [])) {
        if (_is_dict(t) && get(t, "key") === trait) { tier = t["tier"]; break; }
      }
      if (truthy(tier)) {
        for (const attr of cfg.HFA_ATTRS) {
          if (isNumber(get(p, attr))) {
            p[attr] = Math.max(1, Math.min(99, p[attr] + amount(tier)));
          }
        }
      }
    }
  }

  static _make_team(data) {
    const team = new roster.Team(_or(get(data, "team_name"), get(data, "name")), data["offense"], data["defense"],
      get(data, "kick_returner"), get(data, "punt_returner"));
    team.tendencies = { ...get(data, "tendencies", {}) };
    team.home_field_advantage = get(data, "home_field_advantage", 50);
    const coaches = _or(get(data, "coaches"), {});
    team.offense_scheme = _or(_or(
      get(_or(get(_or(get(coaches, "offensive_coordinator"), {}), "scheme"), {}), "offensive_scheme"),
      get(_or(get(_or(get(coaches, "head_coach"), {}), "scheme"), {}), "offensive_philosophy")), "Multiple");
    team.defense_scheme = _or(_or(
      get(_or(get(_or(get(coaches, "defensive_coordinator"), {}), "scheme"), {}), "defensive_scheme"),
      get(_or(get(_or(get(coaches, "head_coach"), {}), "scheme"), {}), "defensive_philosophy")), "4-2-5");
    // coach styles read the schemes from the tendencies the plays get
    Object.assign(team.tendencies, { offense_scheme: team.offense_scheme, defense_scheme: team.defense_scheme });
    if (team.offense_scheme === "Flexbone Triple Option") {
      team.tendencies = { ...team.tendencies, fb_carry_weight: cfg.FLEXBONE_FB_CARRY_WEIGHT };
    }
    return team;
  }

  // ----- helpers -------------------------------------------------------

  side(team) {
    return this.key.get(team);
  }

  other(team) {
    return team === this.home ? this.away : this.home;
  }

  quarter() {
    if (this.in_overtime) {
      return 4 + this.ot_number;
    }
    return this._quarter_at(this.seconds);
  }

  clock() {
    if (this.in_overtime) {
      return `OT${this.ot_number}`;
    }
    return GameSim._clock_at(this.seconds);
  }

  /** The quarter of this half with `seconds_left` on the half's clock. */
  _quarter_at(seconds_left) {
    return (this.half - 1) * 2 + (seconds_left > game.QUARTER_MARK ? 1 : 2);
  }

  /** The quarter's game clock (m:ss) with `seconds_left` on the half's clock. */
  static _clock_at(seconds_left) {
    const secs = Math.max(0, seconds_left > game.QUARTER_MARK ? seconds_left - game.QUARTER_MARK : seconds_left);
    return `${floordiv(secs, 60)}:${String(mod(secs, 60)).padStart(2, "0")}`;
  }

  static _returner_label(returner) {
    return returner ? `${returner.name} (${returner.position})` : "Unknown";
  }

  _add_points(team, points) {
    const side = this.side(team);
    this.score[side] += points;
    if (this.in_overtime) {
      this.ot_periods[this.ot_periods.length - 1][side] += points;
    } else {
      this.quarter_scores[side][this.quarter() - 1] += points;
    }
  }

  _record(team, kind, points, description) {
    const entry = {
      quarter: this.quarter(),
      clock: this.clock(),
      team: this.side(team),
      team_name: team.name,
      kind: kind,
      points: points,
      description: description,
      home_score: 0,
      away_score: 0,
    };
    this.scoring_plays.push(entry);
    return entry;
  }

  _finish_record(entry) {
    entry["home_score"] = this.score["home"];
    entry["away_score"] = this.score["away"];
  }

  /** Describe the player(s) credited with the most recent touchdown. */
  _td_scorer() {
    const entries = play_functions.debug_td_stats.slice(this._td_stats_seen);
    this._td_stats_seen = play_functions.debug_td_stats.length;
    if (!entries.length) {
      return "";
    }
    const td = entries[entries.length - 1];
    const kind = get(td, "type", "");
    if (kind.startsWith("passing")) {
      return `${_str(get(td, "qb"))} pass to ${_str(get(td, "receiver"))} (${_str(get(td, "receiver_position"))})`;
    }
    if (kind === "rushing_scramble") {
      return `${_str(get(td, "player"))} (${_str(get(td, "position"))}) scramble`;
    }
    if (kind === "rushing") {
      return `${_str(get(td, "player"))} (${_str(get(td, "position"))}) run`;
    }
    if (kind === "defensive_interception") {
      return `${_str(get(td, "player"))} (${_str(get(td, "position"))}) interception return`;
    }
    if (kind === "defensive_fumble") {
      return `${_str(get(td, "player"))} (${_str(get(td, "position"))}) fumble return`;
    }
    return `${_str(get(td, "player", ""))} (${_str(get(td, "position", ""))})`;
  }

  // ----- scoring -------------------------------------------------------

  /** Six points plus the try (PAT, or a two-point attempt from the 2nd OT on). */
  _touchdown(team, kind, description) {
    const entry = this._record(team, kind, 6, description);
    this._add_points(team, 6);
    const lead_after_six = this.score[this.side(team)] - this.score[this.side(this.other(team))];
    const chart = sit.go_for_two(lead_after_six, this.seconds, this.half, this.in_overtime);
    if ((this.in_overtime && this.ot_number >= 2) || truthy(chart)) {
      const offense_list = team.get_offense();
      const defense_list = this.other(team).get_defense();
      const good = game_functions.sim_two_point_conversion(offense_list, defense_list, false, team.name);
      if (truthy(good)) {
        this._add_points(team, 2);
        entry["points"] = 8;
      }
      entry["try"] = truthy(good) ? "two-point good" : "two-point failed";
    } else {
      const good = game_functions.sim_pat(team.get_kicker());
      if (truthy(good)) {
        this._add_points(team, 1);
        entry["points"] = 7;
      }
      entry["try"] = truthy(good) ? "PAT good" : "PAT missed";
    }
    this._finish_record(entry);
  }

  _field_goal(team, yardline) {
    const distance = (100 - yardline) + 17;
    const entry = this._record(team, "field_goal", 3, `${distance} yard field goal`);
    this._add_points(team, 3);
    this._finish_record(entry);
  }

  _safety(team) {
    team.team_stats["safeties"] = get(team.team_stats, "safeties", 0) + 1;
    const entry = this._record(team, "safety", 2, "Safety");
    this._add_points(team, 2);
    this._finish_record(entry);
  }

  /**
   * Kick off; keep kicking while returns go for touchdowns.
   *
   * Returns [team now on offense, its starting yardline].
   */
  _kickoff(kicking) {
    let receiving = this.other(kicking);
    this._log_mark = drive_functions.play_log.length;
    const kicking_lead = this.score[this.side(kicking)] - this.score[this.side(receiving)];
    if (truthy(sit.wants_onside(kicking_lead, this.seconds, this.half, this.in_overtime))) {
      this.seconds -= random.randint(3, 6);
      kicking.team_stats["onside_kicks"] = get(kicking.team_stats, "onside_kicks", 0) + 1;
      if (random.random() < cfg.ONSIDE_RECOVERY) {
        kicking.team_stats["onside_recoveries"] = get(kicking.team_stats, "onside_recoveries", 0) + 1;
        const spot = random.randint(44, 49);
        _clear_dict(play_functions.last_play);
        drive_functions._log({ type: "kickoff", result: "onside_recovered", kicking: kicking.name, to: spot, left: this.seconds });
        return [kicking, spot];      // the kicking team keeps it near midfield
      }
      const spot = random.randint(50, 56);
      _clear_dict(play_functions.last_play);
      drive_functions._log({ type: "kickoff", result: "onside_failed", kicking: kicking.name, to: spot, left: this.seconds });
      return [receiving, spot];        // the receiving team takes over in plus territory
    }
    for (;;) {
      const [yardline, returner, return_yards, is_td] = game_functions.sim_kickoff(kicking.get_kicker(), receiving);
      this.seconds -= random.randint(4, 12);
      _clear_dict(play_functions.last_play);
      drive_functions._log({
        type: "kickoff", result: truthy(is_td) ? "return_td" : "kickoff", kicking: kicking.name, to: yardline,
        returner: returner ? returner.name : null, return_yards: return_yards, left: this.seconds,
      });
      if (!truthy(is_td)) {
        if (returner !== null && returner !== undefined) {
          play_functions.credit_coverage_tackle(kicking);
        }
        return [receiving, yardline];
      }
      receiving.team_stats["kickoff_return_touchdowns"] += 1;
      receiving.swing(0.4);
      kicking.swing(-0.3);
      this._touchdown(receiving, "kickoff_return", `${GameSim._returner_label(returner)} kickoff return`);
      [kicking, receiving] = [receiving, kicking];
    }
  }

  // ----- drives --------------------------------------------------------

  _play_count(team) {
    let total = 0;
    for (const p of team.offense) {
      total += get(p.stats, "pass_attempts", 0) + get(p.stats, "carries", 0) + get(p.stats, "sacks_taken", 0);
    }
    return total;
  }

  /** Quarter and clock for a log entry, from the seconds left in the half. */
  _stamp(entry) {
    const left = get(entry, "left");
    if (this.in_overtime || left === null) {
      entry["quarter"] = this.quarter();
      entry["clock"] = this.clock();
    } else {
      entry["quarter"] = this._quarter_at(left);
      entry["clock"] = GameSim._clock_at(left);
    }
    return entry;
  }

  _run_drive(offense, start_yardline, hurrying, seconds) {
    const defense = this.other(offense);
    const plays_before = this._play_count(offense);
    const log_from = this._log_mark !== null ? this._log_mark : drive_functions.play_log.length;
    this._log_mark = null;
    const trailing_late = (
      !this.in_overtime && this.half === 2 && seconds <= cfg.TRAILING_LATE_SECONDS
      && this.score[this.side(offense)] < this.score[this.side(defense)]
    );
    const lead = this.score[this.side(offense)] - this.score[this.side(defense)];
    // (0 - lead: Python's -0 is 0, never a negative zero)
    for (const [team, team_lead] of [[offense, lead], [defense, 0 - lead]]) {
      [team.lead, team.half, team.in_overtime] = [team_lead, this.half, this.in_overtime];
    }
    // Clear Mode: clutch time for the abilities that answer it (the fourth quarter or overtime, within one score)
    play_functions.CLUTCH_NOW[0] = Boolean(truthy(cfg.EXTRA_TRAITS) && Math.abs(lead) <= cfg.CLUTCH_MARGIN
      && (this.in_overtime || (this.half === 2 && seconds <= cfg.CLUTCH_SECONDS)));
    const [play_ran, result, yardline, seconds_left] = drive_functions.sim_drive(
      offense, defense, 1, 10, start_yardline, seconds, hurrying, false,
      undefined, trailing_late,
    );
    const drive = {
      quarter: this.quarter(),
      offense: this.side(offense),
      offense_name: offense.name,
      start_yardline: start_yardline,
      end_yardline: Math.min(100, Math.max(0, yardline)),
      result: result,
      plays: this._play_count(offense) - plays_before,
      seconds: Math.max(0, seconds - seconds_left),
      log: drive_functions.play_log.slice(log_from).map((e) => this._stamp(e)),
    };
    return [play_ran, result, yardline, seconds_left, drive];
  }

  _play_half(receiving) {
    this.seconds = game.HALF_SECONDS;
    for (const team of [this.home, this.away]) {
      team.timeouts = 3;
      team.momentum *= cfg.MOMENTUM_HALF;
      [team.lead, team.half, team.in_overtime] = [this.score[this.side(team)] - this.score[this.side(this.other(team))], this.half, false];
    }
    let [driving, start_yardline] = this._kickoff(this.other(receiving));

    while (this.seconds > 0) {
      const [offense, defense] = [driving, this.other(driving)];
      // no hurry flag: pace is decided per snap by engine/situation.py
      const [play_ran, result, yardline, seconds_left, drive] = this._run_drive(
        offense, start_yardline, false, this.seconds,
      );
      this.seconds = seconds_left;
      drive["quarter"] = this.quarter();
      this.drives.push(drive);

      if (result === "defensive_touchdown") {
        this._touchdown(defense, "defensive", this._td_scorer());
        [driving, start_yardline] = this._kickoff(defense);
      } else if (result === "safety") {
        this._safety(defense);
        // The team that gave up the safety free-kicks; the defense takes over at its 20.
        [driving, start_yardline] = [defense, 20];
      } else if (result === "punt_return_td") {
        this._punt_return_touchdown(defense);
        [driving, start_yardline] = this._kickoff(defense);
      } else if (result === "touchdown") {
        this._touchdown(offense, play_ran || "run", this._td_scorer());
        [driving, start_yardline] = this._kickoff(offense);
      } else if (result === "field goal") {
        this._field_goal(offense, yardline);
        [driving, start_yardline] = this._kickoff(offense);
      } else {
        // punt, missed kick, turnover, first_down fallback: other team takes over
        [driving, start_yardline] = [defense, Math.max(1, Math.min(99, 100 - yardline))];
      }
    }
  }

  // ----- overtime ------------------------------------------------------

  _ot_possession(offense) {
    const defense = this.other(offense);
    const [play_ran, result, yardline, _secs, drive] = this._run_drive(offense, game.OT_START_YARDLINE, false, 9999);
    this.drives.push(drive);
    if (result === "touchdown") {
      this._touchdown(offense, play_ran || "run", this._td_scorer());
    } else if (result === "field goal") {
      this._field_goal(offense, yardline);
    } else if (result === "defensive_touchdown") {
      this._touchdown(defense, "defensive", this._td_scorer());
    } else if (result === "safety") {
      this._safety(defense);
    } else if (result === "punt_return_td") {
      this._punt_return_touchdown(defense);
    }
  }

  /** The receiving team's punt returner took it back for six. */
  _punt_return_touchdown(team) {
    this._touchdown(team, "punt_return", `${GameSim._returner_label(team.get_punt_returner())} punt return`);
  }

  /**
   * College rules: alternating possessions from the 25; two-point tries from the
   * 2nd OT; from the 3rd OT on, alternating two-point attempts only.
   */
  _play_overtime() {
    this.in_overtime = true;
    while (this.score["home"] === this.score["away"]) {
      this.ot_number += 1;
      this.ot_periods.push({ period: this.ot_number, home: 0, away: 0 });
      if (this.ot_number >= 3) {
        for (const team of [this.home, this.away]) {
          const offense_list = team.get_offense();
          const defense_list = this.other(team).get_defense();
          const good = truthy(game_functions.sim_two_point_conversion(
            offense_list, defense_list, false, team.name,
          ));
          const entry = this._record(
            team, "two_point", good ? 2 : 0,
            good ? "Two-point attempt good" : "Two-point attempt failed",
          );
          if (good) {
            this._add_points(team, 2);
          }
          this._finish_record(entry);
        }
        continue;
      }
      this._ot_possession(this.home);
      this._ot_possession(this.away);
    }
  }

  // ----- result --------------------------------------------------------

  _players(team) {
    const out = [];
    for (const [unit, players] of [["offense", team.offense], ["defense", team.defense]]) {
      for (const p of players) {
        const stats = {};
        for (const [k, v] of Object.entries(p.stats)) {
          if (isNumber(v) && truthy(v)) stats[k] = v;
        }
        out.push({
          name: p.name,
          position: p.position,
          unit: unit,
          starter: truthy(p.in_game) || truthy(p.injury),
          fatigue: round(p.fatigue, 1),
          stats: stats,
          injury: p.injury,
        });
      }
    }
    return out;
  }

  /** Port of the original scoring check: points implied by stats vs. actual. */
  _verify(team) {
    const totals = {};
    for (const p of [...team.offense, ...team.defense]) {
      for (const [stat, value] of Object.entries(p.stats)) {
        if (isNumber(value)) {
          totals[stat] = get(totals, stat, 0) + value;
        }
      }
    }
    const tds = (
      Math.max(get(totals, "passing_touchdowns", 0), get(totals, "receiving_touchdowns", 0))
      + get(totals, "rushing_touchdowns", 0)
      + get(team.team_stats, "kickoff_return_touchdowns", 0)
      + get(totals, "punt_return_touchdowns", 0)
      + get(totals, "defensive_touchdowns", 0)
    );
    const side = this.side(team);
    let two_points = 0;
    for (const s of this.scoring_plays) {
      if (s["team"] === side && (
        get(s, "try") === "two-point good" || (s["kind"] === "two_point" && s["points"] === 2)
      )) {
        two_points += 1;
      }
    }
    const expected = (
      tds * 6
      + get(totals, "pat_made", 0)
      + get(totals, "fg_made", 0) * 3
      + get(team.team_stats, "safeties", 0) * 2
      + two_points * 2
    );
    const actual = this.score[side];
    return { expected: int(expected), actual: actual, ok: int(expected) === actual };
  }

  _team_result(team) {
    const side = this.side(team);
    const events = { ...team.team_stats };
    events["fumbles_lost"] = game_functions.summarize_stats(this.other(team))["Fumble Recoveries"];
    return {
      name: team.name,
      score: this.score[side],
      quarters: this.quarter_scores[side],
      overtime: this.ot_periods.map((p) => p[side]),
      team_stats: game_functions.summarize_stats(team),
      team_events: events,
      players: this._players(team),
      injuries: [...team.injuries],
      personnel: { ...team.grouping_snaps },
      schemes: { offense: team.offense_scheme, defense: team.defense_scheme },
      verification: this._verify(team),
    };
  }

  run() {
    play_functions.debug_td_stats.length = 0;
    drive_functions.play_log.length = 0;
    this._log_mark = null;
    this._td_stats_seen = 0;
    game_functions.apply_baseline_fatigue(this.home);
    game_functions.apply_baseline_fatigue(this.away);
    for (const team of [this.home, this.away]) {
      for (const p of [...team.offense, ...team.defense]) {   // they recover from kickoff
        if (truthy(p.fatigue)) team._active.add(p);
      }
      for (const p of [...team.offense, ...team.defense]) {
        if (truthy(p.in_game)) {
          p.stats["games_started"] = get(p.stats, "games_started", 0) + 1;
        }
      }
    }

    // The toss winner receives the opening kickoff 80% of the time.
    const toss_winner = random.choice(["home", "away"]);
    const toss_loser = toss_winner === "home" ? "away" : "home";
    const receives_first = random.random() < 0.8 ? toss_winner : toss_loser;
    const first = receives_first === "home" ? this.home : this.away;

    this.half = 1;
    this._play_half(first);
    this.half = 2;
    this._play_half(this.other(first));
    if (this.score["home"] === this.score["away"]) {
      this._play_overtime();
    }

    const winner = this.score["home"] > this.score["away"] ? "home" : "away";
    const form = {};
    for (const [k, v] of Object.entries(this.form)) form[k] = round(v, 1);
    return {
      home: this._team_result(this.home),
      away: this._team_result(this.away),
      winner: winner,
      venue: this.venue,
      home_advantage_points: round(this.home_advantage, 2),
      form: form,
      received_first: receives_first,
      overtime_periods: this.ot_periods.length,
      scoring_plays: this.scoring_plays,
      drives: this.drives,
    };
  }
}

/** Not part of the game: where Python has time.perf_counter() and uuid.uuid4().hex[:12]. */
const _now_ms = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());
let _id_count = 0;
function _game_id() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID().replace(/-/g, "").slice(0, 12);
  }
  _id_count += 1;
  return (Date.now().toString(16) + _id_count.toString(16).padStart(4, "0")).slice(-12).padStart(12, "0");
}

/**
 * Simulate one game and return the result dict (see GameSim.run).
 *
 * `venue` is "home" (the first team hosts) or "neutral". With `momentum`, big plays
 * swing each team's momentum and nudge its ratings play by play.
 */
export function simulate_game(home_data, away_data, slider_overrides = null, seed = null, venue = "home", momentum = false) {
  if (seed === undefined) seed = null;
  cfg.MOMENTUM = truthy(momentum);
  if (seed !== null) {
    random.seed(seed);
    cfg.stat_rng.seed(seed);
    cfg.injury_rng.seed(seed + 7919);
  } else {
    // Python seeds from the system here (and leaves `random` as the process found it): the clock stands in.
    const system = Date.now();
    random.seed(system);
    cfg.stat_rng.seed(system);
    cfg.injury_rng.seed(system + 7919);
  }
  const active = apply_sliders(slider_overrides);
  const defaults = default_sliders();
  const started = _now_ms();
  let result;
  try {
    result = new GameSim(home_data, away_data, venue).run();
  } finally {
    cfg.MOMENTUM = false;
  }
  const changed = {};
  for (const [k, v] of Object.entries(active)) {
    if (v !== defaults[k]) changed[k] = v;
  }
  Object.assign(result, {
    id: _game_id(),
    played_at: new Date().toISOString().slice(0, 19) + "+00:00",
    duration_ms: round(_now_ms() - started),
    seed: seed,
    sliders: changed,
  });
  return result;
}

export const game = {
  HALF_SECONDS: cfg.HALF_SECONDS,
  QUARTER_MARK: cfg.QUARTER_SECONDS,
  OT_START_YARDLINE: 75,  // the opponent 25-yard line
  SLIDER_NAMES: Object.keys(new cfg.GameSliders()).filter((name) => !name.startsWith("_")),
  default_sliders,
  apply_sliders,
  GameSim,
  simulate_game,
};
