// The Player, Lineup and Team classes.
import { cfg } from "./game_config.js";
import { random, round, cmp, sorted, maxBy, minBy, get, getattr, isNumber, truthy, sum } from "./pyrt.js";

export function return_skill(player) {
  // 0-1 return ability: the return rating when the roster has one, else speed and elusiveness.
  const rating = getattr(player, "return_rating", null);
  if (isNumber(rating)) {
    return rating / 100;
  }
  return ((player.speed || 50) + (getattr(player, "elusiveness", null) || 50)) / 200;
}


// The scrimmage stats that break ties between bench players at the same depth. Return,
// kicking and punting stats are left out (a designated returner would otherwise jump the
// depth chart), and so are the award stats (snaps, pressures, long plays...).
const PRODUCTION_STATS = new Set([
  "pass_attempts", "completions", "pass_yards", "interceptions_thrown", "sacks_taken", "carries", "rush_yards", "fumbles",
  "receptions", "receiving_yards", "targets", "passing_touchdowns", "receiving_touchdowns", "rushing_touchdowns",
  "solo_tackles", "assisted_tackles", "sacks", "interceptions", "forced_fumbles", "fumble_recoveries", "fumble_return_yards",
  "interception_return_yards", "defensive_touchdowns",
]);


export function lead_feature_for_share(share) {
  // The lead back's feature score (0 committee .. 1 workhorse) that gives a team its observed
  // split: `share` is the top back's share of running back carries in an average game, in
  // percent, read off cfg.RB_LEAD_SHARE_CURVE between the measured points and clamped at its ends.
  const curve = cfg.RB_LEAD_SHARE_CURVE;
  if (share <= curve[0][1]) {
    return curve[0][0];
  }
  for (let i = 0; i + 1 < curve.length; i++) {
    const [f0, s0] = curve[i], [f1, s1] = curve[i + 1];
    if (share <= s1) {
      return f0 + (f1 - f0) * (share - s0) / Math.max(1e-9, s1 - s0);
    }
  }
  return curve[curve.length - 1][0];
}


export function production(player) {
  let acc = 0;
  for (const k of Object.keys(player.stats)) {
    if (roster.PRODUCTION_STATS.has(k)) acc += player.stats[k];
  }
  return acc;
}


export class Player {
  constructor(data) {
    this.name = data["name"];
    this.slug = get(data, "slug", data["name"]);
    this.position = data["position"];
    this.speed = get(data, "speed", 50);
    this.strength = get(data, "strength", 50);
    this.intelligence = get(data, "intelligence", 50);
    this.endurance = get(data, "endurance", 50);
    this.fatigue = get(data, "fatigue", 0);
    this.in_game = get(data, "in_game", false);
    this.role = get(data, "role");          // depth-chart role: LT, LG, C, RG, RT, LEDG, REDG, DT, SAM, MIKE, WILL, CB, FS, SS, HB, FB...
    this.depth = truthy(get(data, "depth")) ? get(data, "depth") : 99;
    // place in the position group's playing order: the depth, except for linebackers,
    // who are ordered across SAM, MIKE and WILL by real usage (build_teams.pool_linebackers)
    this.order = truthy(get(data, "order")) ? get(data, "order") : this.depth;
    this.cls = get(data, "class");
    this.injured = truthy(get(data, "injured"));
    this.injury = null;
    this.stats = { ...(get(data, "stats") || {}) };   // own copy: the source roster is shared between games
    this.target_mult = Math.min(cfg.TARGET_MULT_MAX, get(data, "target_mult", 1.0));  // real 2026 share of his team's catches against his ratings' share
    // ratings v2 (teamdata_js/ratings.js): the position's attributes on the house scale (50 = an average
    // Power 4 starter) and the measurables. The engine reads them where a part of the game
    // has moved onto them (docs/RATINGS_V2.md); elsewhere it reads the composites above.
    this.attrs = { ...(get(data, "attributes") || {}) };
    // traits (phase 6): key -> tier 1-4; an Iron Horse tires slower, a Quick Recovery rests faster
    this.traits = {};
    for (const t of (get(data, "traits") || [])) {
      if (t !== null && typeof t === "object" && !Array.isArray(t)) this.traits[t["key"]] = t["tier"];
    }
    if (truthy(get(this.traits, "iron_horse"))) {
      this.endurance = Math.min(99, this.endurance + cfg.TRAIT_FX["iron_horse"] * this.traits["iron_horse"]);
    }
    this.recovery_mult = 1 + cfg.TRAIT_FX["quick_recovery"] * get(this.traits, "quick_recovery", 0);
    this.height_in = truthy(get(data, "height_in")) ? get(data, "height_in") : 74;
    this.weight = truthy(get(data, "weight")) ? get(data, "weight") : 220;

    // Skill-specific
    this.passing = get(data, "passing");
    this.decision_making = get(data, "decision_making");
    this.elusiveness = get(data, "elusiveness");
    this.vision = get(data, "vision");
    this.hands = get(data, "hands");
    this.route_running = get(data, "route_running");
    this.run_blocking = get(data, "run_blocking");
    this.pass_blocking = get(data, "pass_blocking");
    this.rushing = get(data, "rushing");
    this.tackling = get(data, "tackling");
    this.coverage = get(data, "coverage");
    this.kick_power = get(data, "kick_power");
    this.kick_accuracy = get(data, "kick_accuracy");
    this.punt_power = get(data, "punt_power");
    this.punt_accuracy = get(data, "punt_accuracy");
    this.return_rating = get(data, "return_rating");

    this._original_attrs = {
      "speed": this.speed,
      "strength": this.strength,
      "elusiveness": this.elusiveness,
      "vision": this.vision,
      "hands": this.hands,
      "route_running": this.route_running,
      "run_blocking": this.run_blocking,
      "pass_blocking": this.pass_blocking,
      "rushing": this.rushing,
      "tackling": this.tackling,
      "coverage": this.coverage,
    };
    // (attribute, original value, floor) for the fatigue penalty, and the fatigue it was last applied at
    this._penalty_attrs = [];
    for (const attr of Object.keys(this._original_attrs)) {
      const v = this._original_attrs[attr];
      if (v !== null && v !== undefined) this._penalty_attrs.push([attr, v, round(v * (2 / 3))]);
    }
    this._penalty_fatigue = [1e9, -1e9];    // the scale interval the current values hold over: empty until the first refresh
    // what never changes inside a game, read once: trait sums by key tuple (play_functions._tr),
    // the injury durability factor (drive_functions.roll_injuries) and Football IQ (_unit_iq)
    this._tr_cache = {};
    this._durable = Math.max(0.4, 1 - (get(this.attrs, "durability", 50) - cfg.ATTR_LEAGUE_AVG) * cfg.INJURY_DURABILITY_EFFECT);
    this._iq = get(this.attrs, "football_iq", 50);
  }
}


export class Lineup extends Array {
  // The eleven on the field for a snap, kept from snap to snap while nothing changes, with
  // room for what the play functions derive from it: `static` holds values that depend only on
  // who is in it (traits, ratings v2 attributes, weights), `dyn` the ones that read fatigue-
  // penalised ratings, valid for one `team._ratings_version`.

  // slices, filters, maps and concats of a Lineup are plain arrays, not Lineups
  static get [Symbol.species]() { return Array; }

  constructor(players, team) {
    super();
    for (const p of players) this.push(p);
    this.team = team;
    this.static = {};
    this.dyn = {};
    this.dyn_v = -1;
  }
}


// Two keys are the same by value: the same items in the same places.
function _same_key(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}


export class Team {
  constructor(name, offense, defense, kick_returner = null, punt_returner = null) {
    this.name = name;
    this.offense = offense.map((p) => new Player(p));
    this.defense = defense.map((p) => new Player(p));
    // Designated returners (player slugs). Roles, not roster slots: starters can return.
    this.kick_returner = kick_returner;
    this.punt_returner = punt_returner;
    this.tendencies = {};
    this.home_field_advantage = 50;
    this.timeouts = 3;
    this.offense_scheme = "Multiple";
    this.defense_scheme = "4-2-5";
    this.grouping = null;          // offensive grouping on this snap ("11", "12", ...)
    this.front = null;             // defensive package counts on this snap
    this._lineup = { "offense": null, "defense": null };
    this.momentum = 0.0;           // -1 (reeling) to 1 (rolling); only used when cfg.MOMENTUM is on
    this._active = new Set();      // players who have gained fatigue (the bench recovery visits only these)
    this._groups = {};             // position groups in depth order, built once (depth never changes in a game)
    this._lineup_version = 0;      // bumped whenever someone's in_game or injured flag changes (see _take)
    this._take_cache = {};         // group key -> (version, the group sorted for _take)
    this._lineup_key = {};         // unit -> (what was asked for, _lineup_version) the current Lineup answers
    this._ratings_version = 0;     // bumped whenever refresh_ratings rewrites someone's ratings
    this.grouping_snaps = {};      // snaps per grouping / front, for the box score
    this.injuries = [];            // injuries suffered in this game
    this.lead = 0;
    this.half = 1;
    this.in_overtime = false;
    this._resting = {};            // unit -> True while its starters sit in a blowout (rest_starters)
    this._starter_snapshot = {};   // unit -> who was in the game before the starters sat
    this._rb_lead = null;          // (lead back, his rotation profile), cached by _lead_profile
    this._defense_positions = sorted(new Set(this.defense.map((p) => p.position)));
    // Team-level stats for special teams events
    this.team_stats = {
      "kickoff_return_touchdowns": 0,
      "blocked_kicks": 0,
      "blocked_punts": 0,
      "safeties": 0,
      "fumbles_lost": 0,
      "penalties": 0,
      "penalty_yards": 0,
      "third_downs": 0,
      "third_down_conversions": 0,
      "red_zone_trips": 0,
      "red_zone_scores": 0,
      "red_zone_touchdowns": 0,
      "first_downs": 0,
      "fourth_down_attempts": 0,
      "fourth_down_conversions": 0,
    };
  }

  get_offense() {
    return this._on_field("offense");
  }

  get_defense() {
    return this._on_field("defense");
  }

  _on_field(unit) {
    // The unit's eleven for this snap, or (before a lineup is set) every healthy player
    // the fatigue rotation has in the game.
    if (this._lineup[unit] !== null) {
      return this._lineup[unit];
    }
    const players = this[unit].filter((p) => p.in_game && !p.injured);
    for (const p of players) this._active.add(p);      // they are about to gain fatigue
    return players;
  }

  // ----- personnel: build the eleven for a snap from the depth chart -----

  _take(players, n, key = null) {
    // The first n available players: the fatigue rotation's in-game players first, then
    // the bench, each by playing order (ties in roster order, which is depth order); injured players never.
    // With `key` (a stable group, here the string "unit|pos") the sorted pool is kept until a flag changes (_lineup_version).
    if (key !== null) {
      const hit = get(this._take_cache, key);
      if (hit !== null && hit[0] === this._lineup_version) {
        return hit[1].slice(0, n);
      }
    }
    const pool = players.filter((p) => !p.injured);
    pool.sort((a, b) => cmp([a.in_game ? 0 : 1, a.order], [b.in_game ? 0 : 1, b.order]));
    if (key !== null) {
      this._take_cache[key] = [this._lineup_version, pool];
    }
    return pool.slice(0, n);
  }

  _group_exact(unit, pos) {
    // The unit's players at exactly this position, in roster order (built once per game).
    const key = unit + "|" + pos + "|exact";
    let g = get(this._groups, key);
    if (g === null) {
      g = this._groups[key] = this[unit].filter((p) => p.position === pos);
    }
    return g;
  }

  _group(unit, pos) {
    // One position group of a unit, in roster order (built once per game).
    const key = unit + "|" + pos;
    let g = get(this._groups, key);
    if (g === null) {
      const players = this[unit];
      if (pos === "LB") {
        g = players.filter((p) => p.position.includes("LB"));
      } else if (pos === "EDGE") {
        g = players.filter((p) => p.position === "DL" && (p.role === "LEDG" || p.role === "REDG"));
      } else if (pos === "DT") {
        g = players.filter((p) => p.position === "DL" && !(p.role === "LEDG" || p.role === "REDG"));
      } else if (pos === "KP") {
        g = players.filter((p) => p.position === "K" || p.position === "P");
      } else {
        g = players.filter((p) => p.position === pos);
      }
      this._groups[key] = g;
    }
    return g;
  }

  set_grouping(name, counts) {
    // Offensive grouping for this snap: counts of RB, TE, WR, OL (plus the quarterback).
    this.grouping = name;
    this.grouping_snaps[name] = get(this.grouping_snaps, name, 0) + 1;
    const key = [name, this._lineup_version];
    if (this._lineup["offense"] !== null && _same_key(get(this._lineup_key, "offense"), key)) {
      this.refresh_ratings(this._lineup["offense"]);      // the same eleven: only their fatigue moved
      return;
    }
    let lineup = this._take(this._group("offense", "QB"), 1, "offense|QB");
    for (const pos of ["RB", "TE", "WR", "OL"]) {
      lineup.push(...this._take(this._group("offense", pos), counts[pos], "offense|" + pos));
    }
    // the specialists ride along so the drive code can find the kicker and punter
    lineup.push(...this._group("offense", "KP").filter((p) => p.in_game && !p.injured));
    lineup = this._lineup["offense"] = new Lineup(lineup, this);
    this._lineup_key["offense"] = key;
    for (const p of lineup) this._active.add(p);
    this.refresh_ratings(lineup);
  }

  set_front(counts) {
    // Defensive package for this snap: counts of EDGE, DT, LB, CB, S.
    this.front = counts;
    const key = `${counts["EDGE"] + counts["DT"]}-${counts["LB"]}-${counts["CB"] + counts["S"]}`;
    this.grouping_snaps[key] = get(this.grouping_snaps, key, 0) + 1;
    const want = [counts["EDGE"], counts["DT"], counts["LB"], counts["CB"], counts["S"], this._lineup_version];
    if (this._lineup["defense"] !== null && _same_key(get(this._lineup_key, "defense"), want)) {
      this.refresh_ratings(this._lineup["defense"]);
      return;
    }
    let edges = this._group("defense", "EDGE"), tackles = this._group("defense", "DT");
    let edge_key = "defense|EDGE";
    if (!edges.length || !tackles.length) {          // rosters without roles: split the line by depth
      if (!Object.prototype.hasOwnProperty.call(this._groups, "defense|EDGE_F")) {
        const line = sorted(this._group("defense", "DL"), (p) => p.depth);
        this._groups["defense|EDGE_F"] = line.filter((_, i) => i % 2 === 0);
        this._groups["defense|DT_F"] = line.filter((_, i) => i % 2 === 1);
      }
      edges = this._groups["defense|EDGE_F"];
      tackles = this._groups["defense|DT_F"];
      edge_key = "defense|EDGE_F";
    }
    let lineup = this._take(edges, counts["EDGE"], edge_key);
    const more = this._take(tackles.concat(edges.filter((e) => !lineup.includes(e))), counts["DT"]).filter((p) => !lineup.includes(p));
    lineup.push(...more);
    lineup.push(...this._take(this._group("defense", "LB"), counts["LB"], "defense|LB"));
    lineup.push(...this._take(this._group("defense", "CB"), counts["CB"], "defense|CB"));
    lineup.push(...this._take(this._group("defense", "S"), counts["S"], "defense|S"));
    lineup = this._lineup["defense"] = new Lineup(lineup, this);
    this._lineup_key["defense"] = want;
    for (const p of lineup) this._active.add(p);
    this.refresh_ratings(lineup);
  }

  clear_lineups() {
    this._lineup = { "offense": null, "defense": null };
  }

  injure(player, weeks, kind) {
    // A player leaves the game (and misses `weeks` more weeks).
    player.injured = true;
    player.in_game = false;
    this._lineup_version += 1;
    player.injury = { "weeks": weeks, "type": kind };
    this.injuries.push({ "name": player.name, "position": player.position, "weeks": weeks, "type": kind });
    this.clear_lineups();
  }

  recover_bench_players() {
    // every player with fatigue is in _active (the penalty pass keeps it current)
    for (const p of this._active) {
      if (!p.in_game && p.fatigue) {
        let rate = p.endurance / 10 * getattr(p, "recovery_mult", 1.0);
        if (p.position === "RB") {
          rate *= cfg.RB_BENCH_RECOVERY;
        }
        p.fatigue = Math.max(0, p.fatigue - rate);
      }
    }
  }

  lead_back() {
    // The feature back: the healthy halfback highest on the depth chart (the roster lists
    // are in depth order, so list order breaks ties); any back when there is no halfback.
    const backs = this.offense.filter((p) => p.position === "RB" && !p.injured);
    let halfbacks = backs.filter((p) => p.role !== "FB");
    if (!halfbacks.length) halfbacks = backs;
    return halfbacks.length ? minBy(halfbacks, (p) => p.depth) : null;
  }

  _lead_profile(lead, backs) {
    // (per-snap out chance, per-snap return chance) for the lead back, from the committee
    // values to the workhorse values (cfg.RB_LEAD_*) by how much better he is than the next
    // back. Uses the unpenalized ratings the run game uses; cached for the game.
    if (this._rb_lead !== null && this._rb_lead[0] === lead) {
      return this._rb_lead[1];
    }

    const rating = (p) => {
      const o = p._original_attrs;
      return sum(["speed", "strength", "elusiveness", "vision"].map((k) => o[k] || 50)) / 4;
    };

    let others = backs.filter((p) => p !== lead && p.role !== "FB");
    if (!others.length) others = backs.filter((p) => p !== lead);
    const gap = rating(lead) - maxBy(others.map((p) => rating(p)));
    const [lo, hi] = cfg.RB_LEAD_GAP_RANGE;
    let feature = Math.min(1.0, Math.max(0.0, (gap - lo) / (hi - lo)));
    const td = truthy(this.tendencies) ? this.tendencies : {};
    if (lead.depth === 1) {         // the team's real 2026 split, when its real lead back leads
      if (get(td, "rb1_share") !== null && get(td, "rb1_share") !== undefined) {
        feature = lead_feature_for_share(td["rb1_share"]);    // observed share (data/observed_tendencies.json)
      } else if (get(td, "rb_lead_feature") !== null && get(td, "rb_lead_feature") !== undefined) {
        feature = td["rb_lead_feature"];                       // data/real_adjustments.json, when there is no observed share
      }
    }
    const [ret_lo, ret_hi] = cfg.RB_LEAD_RETURN_CHANCE;
    const profile = [cfg.RB_LEAD_OUT_CHANCE * Math.pow(1 - feature, cfg.RB_LEAD_OUT_CURVE),
                     ret_lo + (ret_hi - ret_lo) * Math.pow(feature, cfg.RB_LEAD_CURVE)];
    this._rb_lead = [lead, profile];
    return profile;
  }

  rotate_backs(fatigue_threshold = 50) {
    // Running back rotation (the RB_LEAD_* constants in game_config). The lead back comes
    // out when he tires or, on a committee team, by the coach's series rotation; he returns
    // once rested, at once for a feature back and after the backups' series on a committee.
    // The backups rotate among themselves at the skill-position threshold and call on the lead
    // back only when no other fresh back is left. In a blowout the starters sit
    // (rest_starters), so only the tired-for-fresh rotation runs.
    const backs = this.offense.filter((p) => p.position === "RB" && !p.injured);
    if (backs.length < 2) {
      return;
    }
    const lead = truthy(get(this._resting, "offense")) ? null : this.lead_back();
    let [out_chance, return_chance] = lead !== null ? this._lead_profile(lead, backs) : [0.0, 0.0];
    if (lead !== null && get(lead.stats, "carries", 0) >= cfg.RB_LEAD_GAME_CARRIES) {
      // a full day's work already: he shares the rest of it, whatever the team's usual split
      [out_chance, return_chance] = [Math.max(out_chance, cfg.RB_LEAD_WORKLOAD[0]), return_chance * cfg.RB_LEAD_WORKLOAD[1]];
    }
    if (lead !== null && !lead.in_game && lead.fatigue <= cfg.RB_LEAD_RETURN_FATIGUE
        && random.random() < return_chance) {
      const on_field = backs.filter((p) => p.in_game);
      if (on_field.length) {
        maxBy(on_field, (p) => p.fatigue).in_game = false;
      }
      lead.in_game = true;
      this._lineup_version += 1;
      return;
    }
    const lead_out = lead !== null && lead.in_game && (lead.fatigue > cfg.RB_LEAD_SUB_FATIGUE || random.random() < out_chance);
    const tired = backs.filter((p) => p.in_game && (p === lead ? lead_out : p.fatigue > fatigue_threshold));
    if (!tired.length) {
      return;
    }
    let bench = backs.filter((p) => !p.in_game && p !== lead && p.fatigue <= fatigue_threshold);
    if (!bench.length && lead !== null && !lead.in_game && lead.fatigue <= cfg.RB_LEAD_RETURN_FATIGUE) {
      bench = [lead];
    }
    if (!bench.length) {
      return;
    }
    // the next fresh halfback on the depth chart first (fullbacks last), the more productive
    // one on a tie; sometimes the next back down gets the series instead
    const k = (p) => [p.role === "FB", p.order, -production(p), p.fatigue];
    bench.sort((a, b) => cmp(k(a), k(b)));
    this._swap(tired, bench, true);
  }

  _swap(tired, bench, rotate = false) {
    // Sub the bench (best first) for the tired players one-for-one. With `rotate`, the
    // next player down sometimes gets the series instead (cfg.BACKUP_RB_ROTATION).
    for (const tired_player of tired) {
      if (!bench.length) {
        break;
      }
      const pick = rotate && bench.length > 1 && random.random() < cfg.BACKUP_RB_ROTATION ? 1 : 0;
      const sub = bench.splice(pick, 1)[0];
      tired_player.in_game = false;
      sub.in_game = true;
      this._lineup_version += 1;
    }
  }

  sub_skill_position_players(fatigue_threshold = 50) {
    this.rotate_backs(fatigue_threshold);

    for (const pos of ["WR", "TE"]) {
      // in-game players of this position who are too tired
      const group = this._group_exact("offense", pos);
      const starters = group.filter((p) => p.in_game && p.fatigue > fatigue_threshold);
      if (!starters.length) {
        continue;
      }

      // bench players of the same position who are fresh enough
      const bench = group.filter((p) => !p.in_game && !p.injured && p.fatigue <= fatigue_threshold);
      if (!bench.length) {
        continue;
      }

      // the next fresh player on the depth chart first, the more productive one on a tie
      const k = (p) => [p.order, -production(p), p.fatigue];
      bench.sort((a, b) => cmp(k(a), k(b)));
      this._swap(starters, bench, true);
    }
  }

  sub_defensive_players(fatigue_threshold = 50) {
    for (const pos of this._defense_positions) {
      const threshold = get(cfg.DEF_SUB_FATIGUE, pos, fatigue_threshold);
      // Players currently in the game and too tired
      const group = this._group_exact("defense", pos);
      const tired_players = group.filter((p) => p.in_game && p.fatigue > threshold);
      if (!tired_players.length) {
        continue;
      }

      // Bench players eligible to sub in
      const bench = group.filter((p) => !p.in_game && !p.injured && p.fatigue <= threshold * 0.6);
      if (!bench.length) {
        continue;
      }

      // the next fresh player on the depth chart first, then the freshest and most productive
      const k = (p) => [p.order, p.fatigue, -production(p)];
      bench.sort((a, b) => cmp(k(a), k(b)));
      this._swap(tired_players, bench);
    }
  }

  static REST_POSITIONS = { "offense": ["QB", "RB", "WR", "TE", "OL"], "defense": ["DL", "MLB", "ROLB", "LOLB", "CB", "S"] };

  rest_starters(unit = "offense") {
    // Blowout: sit the starters at the skill and front positions and play the next
    // players on the depth chart (the roster lists are in depth order). No-op if already resting.
    if (truthy(get(this._resting, unit))) {
      return;
    }
    const players = this[unit];
    this._starter_snapshot[unit] = players.map((p) => p.in_game);
    for (const pos of this.REST_POSITIONS[unit]) {
      const group = players.filter((p) => p.position === pos && !p.injured);
      const starters = group.filter((p) => p.in_game);
      const bench = sorted(group.filter((p) => !p.in_game), (p) => p.order);
      const n = Math.min(starters.length, bench.length);
      for (let i = 0; i < n; i++) {
        starters[i].in_game = false;
        bench[i].in_game = true;
      }
    }
    this._lineup_version += 1;
    this._resting[unit] = true;
  }

  restore_starters(unit = "offense") {
    if (!truthy(get(this._resting, unit))) {
      return;
    }
    const players = this[unit], snapshot = this._starter_snapshot[unit];
    const n = Math.min(players.length, snapshot.length);
    for (let i = 0; i < n; i++) {
      players[i].in_game = snapshot[i];
    }
    this._lineup_version += 1;
    this._resting[unit] = false;
  }

  get_kicker() {
    // The kicker: the in-game one, else any healthy K, else the punter, else anyone.
    return this._specialist("K", "P");
  }

  get_punter() {
    return this._specialist("P", "K");
  }

  _specialist(pos, alt) {
    const pool = this.offense.filter((p) => p.position === pos);
    for (const cond of [(p) => p.in_game && !p.injured, (p) => !p.injured, (p) => true]) {
      for (const p of pool) {
        if (cond(p)) {
          return p;
        }
      }
    }
    for (const p of this.offense) {
      if (p.position === alt && !p.injured) {
        return p;
      }
    }
    return this.offense.length ? this.offense[0] : null;
  }

  _designated(slug) {
    if (!truthy(slug)) {
      return null;
    }
    for (const p of this.offense.concat(this.defense)) {
      if (p.slug === slug || p.name === slug) {
        return p;
      }
    }
    return null;
  }

  best_returner() {
    // Fallback returner: highest return rating among non-specialists, else fastest.
    const candidates = this.offense.concat(this.defense).filter((p) => !["K", "P", "OL", "DL", "QB"].includes(p.position));
    if (!candidates.length) {
      return null;
    }
    this.refresh_ratings(candidates);
    return maxBy(candidates, (p) => [return_skill(p), p.speed || 0]);
  }

  get_kick_returner() {
    // The designated kick returner, else the fastest skill position player.
    return this._designated(this.kick_returner) || this.best_returner();
  }

  get_punt_returner() {
    // The designated punt returner, else the fastest skill position player.
    return this._designated(this.punt_returner) || this.best_returner();
  }

  swing(amount) {
    // A momentum swing (positive is good for this team), clamped to [-1, 1].
    if (cfg.MOMENTUM) {
      this.momentum = Math.max(-1.0, Math.min(1.0, this.momentum + amount));
    }
  }

  momentum_factor() {
    return cfg.MOMENTUM ? 1.0 + cfg.MOMENTUM_EFFECT * this.momentum : 1.0;
  }

  refresh_ratings(players) {
    // Bring these players' ratings up to date with their fatigue (up to 15% down, floor
    // two thirds) and, when momentum is on, the team's momentum. Called for the players
    // about to be read: the snap's lineups, a returner. Anyone whose fatigue and the
    // factor are unchanged since his last refresh is skipped.
    const factor = this.momentum_factor();
    const eps = 1e-9;
    let changed = false;
    for (const player of players) {
      const scale = (1 - player.fatigue / 100 * 0.15) * factor;
      // Every penalised attribute is a rounded, clamped multiple of the scale, so each one
      // holds its value over an interval of scales. While the scale stays inside the
      // intersection of those intervals (shrunk by eps against floating-point edges and
      // round-half-even ties) nothing can change and the player is skipped: the values a
      // recompute would write are, by construction, the ones already there.
      let [lo, hi] = player._penalty_fatigue;
      if (lo <= scale && scale < hi) {
        continue;
      }
      changed = true;
      const values = player;      // the player's own properties
      lo = -1e9;
      hi = 1e9;
      for (const [attr, original_value, min_allowed] of player._penalty_attrs) {
        const r = round(original_value * scale);
        if (r >= 99) {
          values[attr] = 99;
          lo = Math.max(lo, 98.5 / original_value + eps);
        } else if (r <= min_allowed) {
          values[attr] = min_allowed;
          hi = Math.min(hi, (min_allowed + 0.5) / original_value - eps);
        } else {
          values[attr] = r;
          lo = Math.max(lo, (r - 0.5) / original_value + eps);
          hi = Math.min(hi, (r + 0.5) / original_value - eps);
        }
      }
      player._penalty_fatigue = [lo, hi];
    }
    if (changed) {
      this._ratings_version += 1;    // the lineups' derived numbers (play_functions) are stale
    }
  }
}

// REST_POSITIONS is read through an instance too (this.REST_POSITIONS)
Team.prototype.REST_POSITIONS = Team.REST_POSITIONS;

export const roster = {
  return_skill,
  PRODUCTION_STATS,
  lead_feature_for_share,
  production,
  Player,
  Lineup,
  Team,
};
