import { random, round, int, sum, sorted, get, getattr, isNumber, truthy } from "./pyrt.js";
import { cfg } from "./game_config.js";
import { game_functions } from "./game_functions.js";
import { personnel } from "./personnel.js";
import { roster } from "./roster.js";

// The namespace (PORTING.md, "Modules"): the module's variables and constants live here and are always
// read and written through it. Filled in at the end of the file.
export const play_functions = {};

// Every touchdown's scorer(s), in order; game.js reads the newest to describe the score.
play_functions.debug_td_stats = [];

// Who was involved in the most recent snap (names only; read by the drive log, never by
// the simulation itself, so it changes no result).
// It is one object for the whole run, emptied in place, never replaced; `clear` is there,
// hidden from Object.keys / Object.assign / JSON, for a caller that writes `last_play.clear()`.
play_functions.last_play = {};
Object.defineProperty(play_functions.last_play, "clear", {
  value() { for (const k of Object.keys(this)) delete this[k]; },
  enumerable: false,
});


export function _note(kw = {}) {
  const last_play = play_functions.last_play;
  for (const k of Object.keys(last_play)) delete last_play[k];
  Object.assign(last_play, kw);
}


export function assign_forced_fumble(defense, base_yards, verbose = false) {
  // Map yardage to positional group
  let valid_positions;
  if (base_yards <= 2) {
    valid_positions = ["rolb", "olb", "mlb"];  // front seven - assume close to line
  } else if (base_yards <= 7) {
    valid_positions = ["rolb", "olb", "mlb", "s"];  // LBs and safeties
  } else {
    valid_positions = ["cb", "s"];  // defensive backs
  }

  // Filter defense players matching valid positions
  let candidates = [];
  for (const p of defense) if (valid_positions.includes(p.position.toLowerCase())) candidates.push(p);
  if (!candidates.length) {
    candidates = defense;  // fallback to anyone on defense
  }

  // Weight by tackling and strength (or just tackling if you want it simpler)
  const weights = [];
  for (const p of candidates) weights.push(_rel((p.tackling + p.strength) / 2));

  // Choose one
  const forced_by = random.choices(candidates, { weights: weights, k: 1 })[0];
  _stat(forced_by, "forced_fumbles");

  if (verbose) {
    console.log(`Fumble forced by ${forced_by.name} (${forced_by.position})`);
  }

  return forced_by;
}


// Who makes the tackle, by how far the play went: per player on the field, by position
// group (the middle linebacker is "lb", the outside linebackers "olb"). Calibrated so the
// defensive line makes about a fifth of a team's tackles, linebackers about two fifths and
// the secondary the rest, with the middle linebacker usually the team's leader.
play_functions.TACKLE_GROUP = { DL: "dl", MLB: "lb", ROLB: "olb", LOLB: "olb", OLB: "olb", CB: "cb", S: "s" };
play_functions.TACKLE_WEIGHT_GROUPS = ["dl", "lb", "olb", "s", "cb"];    // the order of cfg.TACKLE_WEIGHTS_*


export function _tackle_pool(defense, weight_table) {
  const weight_profile = {};
  const groups = play_functions.TACKLE_WEIGHT_GROUPS;
  for (let i = 0; i < Math.min(groups.length, weight_table.length); i++) weight_profile[groups[i]] = weight_table[i];

  // Build weighted candidate list
  let candidates = [];
  let weights = [];
  let cb_count = 0;

  for (const p of defense) {
    const pos_group = get(play_functions.TACKLE_GROUP, p.position, p.position.toLowerCase());

    if (pos_group === "cb") {
      if (cb_count >= 3) {
        continue;  // cap CB participation
      }
      cb_count += 1;
    }

    if (Object.prototype.hasOwnProperty.call(weight_profile, pos_group)) {
      // the better tackler at a spot gets clearly more of them (real leaders stand out)
      const skill_weight = Math.pow(_rel((p.tackling + p.intelligence) / 2), cfg.TACKLE_SKILL_POWER);
      const position_weight = weight_profile[pos_group];
      candidates.push(p);
      weights.push(position_weight * skill_weight);
    }
  }

  // Fallback if candidate pool is empty
  if (!candidates.length) {
    candidates = defense;
    weights = [];
    for (const p of defense) weights.push(_rel((p.tackling + p.intelligence) / 2));
  }
  return [candidates, weights];
}


// The tackle pool is keyed by its weight table, the object itself: the same table gives the same number here.
const _table_ids = new WeakMap();
let _table_next_id = 0;

function _id(obj) {
  let n = _table_ids.get(obj);
  if (n === undefined) {
    n = ++_table_next_id;
    _table_ids.set(obj, n);
  }
  return n;
}


export function assign_tackles(defense, base_yards, verbose = false) {
  // per-player weights by position group (a group's share also grows with how many are on the field)
  let weight_table;
  if (base_yards <= 2) {
    weight_table = cfg.TACKLE_WEIGHTS_SHORT;
  } else if (base_yards <= 7) {
    weight_table = cfg.TACKLE_WEIGHTS_MID;
  } else {
    weight_table = cfg.TACKLE_WEIGHTS_LONG;
  }
  // the candidates and their weights read `tackling`, so they hold for one ratings version
  const [candidates, weights] = _dyn(defense, "tackle|" + _id(weight_table), (d) => _tackle_pool(d, weight_table));

  // Solo vs assisted: about 30% of tackles are shared (real leaders split theirs near half solo, half assisted)
  const is_assisted = random.random() < cfg.TACKLE_ASSIST_CHANCE;

  let tacklers;
  if (is_assisted && candidates.length >= 2) {
    // Weighted sampling without replacement: the first two different players of five draws
    const drawn = random.choices(candidates, { weights: weights, k: 5 });
    tacklers = [];
    for (const p of drawn) {
      if (!tacklers.includes(p)) tacklers.push(p);
      if (tacklers.length === 2) break;
    }
  } else {
    tacklers = random.choices(candidates, { weights: weights, k: 1 });
  }

  if (verbose) {
    if (is_assisted && tacklers.length === 2) {
      console.log(`Tackle by ${tacklers[0].name} (solo) and ${tacklers[1].name} (assist)`);
    } else {
      console.log(`Tackle by ${tacklers[0].name} (solo)`);
    }
  }

  return [tacklers, is_assisted && tacklers.length === 2];
}


export function assign_sack(defense, guessed_play = false, rushers = null, blitz_rate = 50) {
  // Sack candidates: the pass rushers (linemen, plus linebackers in a three-man front), and any
  // linebacker when the defense guessed the play
  let candidates;
  if (rushers && rushers.length) {
    candidates = Array.from(rushers);
  } else {
    candidates = [];
    for (const p of defense) if (p.position === "DL") candidates.push(p);
  }
  if (guessed_play) {
    const more = [];
    for (const p of defense) if (p.position.includes("LB") && !candidates.includes(p)) more.push(p);
    for (const p of more) candidates.push(p);
  }
  if (!candidates.length) {
    return [[], false];
  }

  // 25% chance to split sack
  const is_half = random.random() < 0.25;

  // Pick 1 or 2 players based on is_half
  const sack_weights = [];
  for (const p of candidates) sack_weights.push(Math.pow(_rel(p.rushing), cfg.SACK_SKILL_POWER));
  const selected = random.choices(candidates, { weights: sack_weights, k: is_half ? 2 : 1 });

  // A blitzing corner or safety gets the credit now and then, more for a team that blitzes
  // a lot (the defense's blitz_rate tendency). Drawn from stat_rng: the game is unchanged.
  const dbs = [];
  for (const p of defense) if (p.position === "CB" || p.position === "S") dbs.push(p);
  if (dbs.length && cfg.stat_rng.random() < cfg.DB_SACK_SHARE * blitz_rate / 50) {
    const db_weights = [];
    for (const p of dbs) db_weights.push(_rel(p.rushing));
    selected[0] = cfg.stat_rng.choices(dbs, { weights: db_weights, k: 1 })[0];
  }

  return [selected, is_half];
}


// ===================== award-stat helpers =====================

/** Add to a stat the roster template may not carry. */
export function _stat(player, key, n = 1) {
  player.stats[key] = get(player.stats, key, 0) + n;
}


export function _stat_max(player, key, value) {
  if (value > get(player.stats, key, 0)) {
    player.stats[key] = value;
  }
}


/**
 * Credit one blocker on the field: the weakest blocker is likeliest to allow a
 * pressure or a stuff, the best to spring a long run. Tight ends and fullbacks count on
 * runs (at a lower share) and tight ends in pass protection when two are in. Uses the
 * stat RNG only.
 */
export function _credit_lineman(offense, key, attr, worse = false, run = false) {
  const line = [];
  for (const p of offense) if (p.position === "OL") line.push(p);
  let extra = [];
  for (const p of offense) {
    if (p.position === "TE" || (p.position === "RB" && getattr(p, "role", null) === "FB")) extra.push(p);
  }
  if (!run) {
    let te_count = 0;
    for (const p of offense) if (p.position === "TE") te_count += 1;
    if (te_count >= 2) {
      const tes = [];
      for (const p of extra) if (p.position === "TE") tes.push(p);
      extra = tes;
    } else {
      extra = [];
    }
  }
  if (!line.length && !extra.length) {
    return;
  }
  const w = (p) => {
    const r = getattr(p, attr, null) || 0;          // card points over the average starter
    const base = Math.max(0.4, worse ? cfg.BLAME_REF - r : cfg.REF_POINTS + r);
    return base * (p.position === "OL" ? 1.0 : cfg.TE_BLOCK_CREDIT_SHARE);
  };
  const pool = [...line, ...extra];
  const weights = [];
  for (const p of pool) weights.push(w(p));
  _stat(cfg.stat_rng.choices(pool, { weights: weights, k: 1 })[0], key);
}


// ===================== rating helpers =====================

/** Average of the given attributes that the player actually has (card points over the average starter; 0 is average). */
export function _rating(player, keys, default_ = 0) {
  // a Player's ratings are plain instance attributes
  const vals = [];
  for (const k of keys) {
    const v = player[k];
    if (isNumber(v)) vals.push(v);
  }
  return vals.length ? sum(vals) / vals.length : default_;
}


/** A ratings v2 attribute (card points over the average FBS starter in his card group); 0 when he has none. */
export function _attr(player, key, default_ = 0) {
  const a = player.attrs;
  return a ? get(a, key, default_) : default_;
}


/** A rating read against the average starter (`v`: his card points over him): 1 for the average, more above. */
export function _rel(v) {
  return Math.max(0.05, (cfg.REF_POINTS + (v || 0)) / cfg.REF_POINTS);
}


export function _attr_mean(player, keys, weights = null) {
  let w = weights;
  if (!w || !w.length) {
    w = [];
    for (let i = 0; i < keys.length; i++) w.push(1.0);
  }
  let acc = 0;
  const n = Math.min(keys.length, w.length);
  for (let i = 0; i < n; i++) acc += _attr(player, keys[i]) * w[i];
  return acc / sum(w);
}


play_functions.DEPTHS = ["short", "mid", "deep"];
play_functions.QB_ACC = ["short_accuracy", "mid_accuracy", "deep_accuracy"];
play_functions.QB_ACC_WEIGHTS = [0.3, 0.35, 0.2];          // the composite's own weights (build_teams.map_player)


/** A receiver's route skill at each depth (a tight end's deep is his intermediate). */
export function _routes(player) {
  const short = _attr(player, "short_routes"), mid = _attr(player, "mid_routes");
  const deep = _attr(player, "deep_routes", mid);
  return { short: short, mid: mid, deep: deep };
}


/**
 * short, mid or deep for a throw to this target (backs catch short). The offensive
 * scheme, the OC's deep-shot rate and a play-action fake move the shares.
 */
export function _throw_depth(target, tendencies, play_action = false) {
  const shares = get(cfg.PASS_DEPTH_SHARE, target.position);
  if (!truthy(shares)) {
    return "short";
  }
  const style = get(cfg.SCHEME_STYLE, get(tendencies, "offense_scheme"), {});
  const r = _routes(target);
  let tilt = Math.pow(_rel(target.speed), cfg.PASS_DEEP_SPEED_TILT)
    * Math.max(0.3, 1 + cfg.PASS_DEEP_ROUTE_TILT * (r["deep"] - sum([r.short, r.mid, r.deep]) / 3));
  if (truthy(get(tendencies, "conservative"))) {
    tilt *= cfg.GARBAGE_BIG_PLAY;
  }
  if (truthy(get(tendencies, "prevent"))) {
    tilt *= cfg.PREVENT_BIG_PLAY;
  }
  tilt *= get(tendencies, "big_play_mult", 1.0);
  tilt *= get(style, "deep", 1.0) * Math.max(0.4, 1 + (get(tendencies, "deep_shot_rate", 50) - 50) * cfg.DEEP_SHOT_EFFECT);
  if (play_action) {
    tilt *= cfg.PLAY_ACTION_DEEP;
  }
  let [short, mid, deep] = shares;
  short *= get(style, "short", 1.0);
  deep *= tilt;
  const rest = (1 - deep) / (short + mid);
  return random.choices(play_functions.DEPTHS, { weights: [short * rest, mid * rest, deep], k: 1 })[0];
}


play_functions.CLUTCH_NOW = [false];   // this drive is in clutch time (set by the game loop each drive; game_config CLUTCH_*)


// The memo dicts (a Lineup's `static` and `dyn`, a Player's `_tr_cache`) are plain objects with
// text keys (a Map is read and written as one, should the owner have made a Map of it). A
// compound key is its parts joined: ("trp", keys) is "trp|a,b,c".
const _MISSING = Symbol("missing");

function _cget(cache, tag) {
  if (cache instanceof Map) return cache.has(tag) ? cache.get(tag) : _MISSING;
  return Object.prototype.hasOwnProperty.call(cache, tag) ? cache[tag] : _MISSING;
}

function _cset(cache, tag, v) {
  if (cache instanceof Map) cache.set(tag, v);
  else cache[tag] = v;
  return v;
}


/**
 * The player's tier (0-4) summed over the given traits (traits never change in a game:
 * each key tuple is summed once per player).
 */
export function _tr(player, ...keys) {
  const cache = player._tr_cache;
  const tag = keys.join(",");
  let v = _cget(cache, tag);
  if (v === _MISSING || v === null) {
    const t = player.traits;
    if (truthy(t)) {
      v = 0;
      for (const k of keys) v += get(t, k, 0);
    } else {
      v = 0;
    }
    _cset(cache, tag, v);
  }
  return v;
}


export function _tr_points(players, keys) {
  return _static(players, "trp|" + keys.join(","), (ps) => {
    let acc = 0;
    for (const p of ps) acc += _tr(p, ...keys);
    return acc;
  });
}


/** Ball Security against the tacklers' Hit Power (ratings v2): about 1 on average. */
export function _fumble_mult(carrier, tacklers) {
  let hit;
  if (tacklers && tacklers.length) {
    let acc = 0;
    for (const p of tacklers) acc += _attr(p, "hit_power");
    hit = acc / tacklers.length;
  } else {
    hit = 0.0;
  }
  return Math.max(0.3, 1 - _attr(carrier, "ball_security") * cfg.FUMBLE_SECURITY_EFFECT)
    * Math.max(0.5, 1 + hit * cfg.FUMBLE_HIT_EFFECT)
    * Math.max(0.2, 1 - _tr(carrier, "ball_protector") * cfg.TRAIT_FX["ball_protector"])
    * (1 + _tr_points(tacklers, cfg.HIT_TRAITS) * cfg.TRAIT_FX["hitter"]);
}


// ----- per-lineup memo: the same eleven give the same numbers until someone's ratings move -----
// A Lineup (roster.Lineup) carries two dicts: `static` for values that depend only on who is in
// it, `dyn` for values that read fatigue-penalised ratings, cleared when the team's ratings
// version moves. A plain list (candidates, a returner) is computed every time, as before.
// Every memoised value is built by the same expression on the same players in the same order,
// so it is the number the direct computation would give.

export function _static(players, tag, fn) {
  const st = getattr(players, "static", null);
  if (st === null) {
    return fn(players);
  }
  let v = _cget(st, tag);
  if (v === _MISSING) {
    v = _cset(st, tag, fn(players));
  }
  return v;
}


export function _dyn(players, tag, fn) {
  let dyn = getattr(players, "dyn", null);
  if (dyn === null) {
    return fn(players);
  }
  const rv = players.team._ratings_version;
  if (players.dyn_v !== rv) {
    dyn = {};
    players.dyn = dyn;
    players.dyn_v = rv;
  }
  let v = _cget(dyn, tag);
  if (v === _MISSING) {
    v = _cset(dyn, tag, fn(players));
  }
  return v;
}


/** The lineup's players at these positions, in lineup order (memoised per lineup). */
export function _members(players, positions) {
  const st = getattr(players, "static", null);
  if (st === null) {
    const out = [];
    for (const p of players) if (positions.includes(p.position)) out.push(p);
    return out;
  }
  const tag = "members|" + positions.join(",");
  let sub = _cget(st, tag);
  if (sub === _MISSING) {
    const found = [];
    for (const p of players) if (positions.includes(p.position)) found.push(p);
    sub = _cset(st, tag, new roster.Lineup(found, players.team));
  }
  return sub;
}


/** personnel.pass_rushers, memoised per lineup and ratings version (it sorts by `rushing`). */
export function pass_rushers(defense) {
  return _dyn(defense, "rushers", _rushers);
}


export function _rushers(defense) {
  const r = personnel.pass_rushers(defense);
  if (getattr(defense, "team", null) === null) {
    return r;
  }
  return new roster.Lineup(r, defense.team);
}


/** Average rating of the players at the given positions (on-field players only; card points over the average starter). */
export function _group_rating(players, positions, keys, default_ = 0) {
  const group = _members(players, positions);
  if (!group.length) {
    return default_;
  }
  return _dyn(group, "gr|" + keys.join(","), (g) => {
    let acc = 0;
    for (const p of g) acc += _rating(p, keys);
    return acc / g.length;
  });
}


/** Turn a 0-100 slider into card points: 50 = 0, 100 = +scale, 0 = -scale. */
export function _slider_points(slider_value, scale = 8.0) {
  return (cfg.sliders.get_multiplier(slider_value) - 1.0) * 2 * scale;
}


export function _credit_tackle(defense, yards) {
  if (yards > 3 && random.random() < cfg.NO_TACKLE_CHANCE) {
    return;                      // pushed out of bounds: no tackle in the box score
  }
  const [tacklers, is_assisted] = assign_tackles(defense, yards);
  const tackle_mult = cfg.sliders.get_multiplier(cfg.sliders.tackling);
  if (is_assisted && tacklers.length === 2 && random.random() < tackle_mult) {
    tacklers[0].stats["assisted_tackles"] += 1;      // a shared tackle: an assist each (NCAA)
    tacklers[1].stats["assisted_tackles"] += 1;
  } else if (tacklers.length) {
    tacklers[0].stats["solo_tackles"] += 1;
  }
  if (yards < 0 && tacklers.length) {
    _stat(tacklers[0], "tackles_for_loss");
  }
}


play_functions.COVERAGE_POSITIONS = { MLB: 1.0, ROLB: 1.0, LOLB: 1.0, OLB: 1.0, S: 1.0, CB: 0.8, DL: 0.25 };


/**
 * A returned kickoff or punt ends in a tackle by the kicking team's coverage unit:
 * mostly backup linebackers and defensive backs (real box scores count these with the
 * defense's tackles, about 3-4 a team-game, and they spread the totals off the starters).
 */
export function credit_coverage_tackle(team) {
  const COVERAGE_POSITIONS = play_functions.COVERAGE_POSITIONS;
  const groups = {};            // by position, in the order each position is first seen (as Python's dict)
  for (const p of team.defense) {
    if (Object.prototype.hasOwnProperty.call(COVERAGE_POSITIONS, p.position) && !p.injured) {
      if (!Object.prototype.hasOwnProperty.call(groups, p.position)) groups[p.position] = [];
      groups[p.position].push(p);
    }
  }
  const cands = [], weights = [];
  for (const pos of Object.keys(groups)) {
    const ps = sorted(groups[pos], (q) => q.order);
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      cands.push(p);
      weights.push(COVERAGE_POSITIONS[pos] * cfg.COVERAGE_TACKLE_WEIGHTS[Math.min(i, cfg.COVERAGE_TACKLE_WEIGHTS.length - 1)]);
    }
  }
  if (!cands.length) {
    return;
  }
  if (cands.length >= 2 && random.random() < cfg.TACKLE_ASSIST_CHANCE) {
    const a = random.choices(cands, { weights: weights, k: 1 })[0];
    const rest_c = [], rest_w = [];
    for (let i = 0; i < cands.length; i++) {
      if (cands[i] !== a) {
        rest_c.push(cands[i]);
        rest_w.push(weights[i]);
      }
    }
    const b = random.choices(rest_c, { weights: rest_w, k: 1 })[0];
    a.stats["assisted_tackles"] += 1;
    b.stats["assisted_tackles"] += 1;
  } else {
    random.choices(cands, { weights: weights, k: 1 })[0].stats["solo_tackles"] += 1;
  }
}


/**
 * A fumble by `fumbler` at `spot`. Returns (result, yardline) for the drive logic
 * and records the stats. The offense recovers half of them.
 */
export function _lose_fumble(offense, defense, fumbler, spot, forcer_positions, yards_for_forcer) {
  const last_play = play_functions.last_play;
  fumbler.stats["fumbles"] += 1;
  if (random.random() < cfg.sliders.get_percentage_adjustment(cfg.sliders.forced_fumbles, cfg.FORCED_FUMBLE_SHARE)) {
    assign_forced_fumble(defense, yards_for_forcer);   // increments forced_fumbles itself
  }
  last_play["fumble"] = fumbler.name;
  if (random.random() < cfg.FUMBLE_OFFENSE_RECOVERY) {
    last_play["fumble_kept"] = true;
    return [null, spot];                                  // offense keeps it, play stands
  }
  let candidates = [];
  for (const p of defense) if (forcer_positions.includes(p.position)) candidates.push(p);
  if (!candidates.length) candidates = defense;
  const weights = [];
  for (const p of candidates) weights.push(_rel((p.speed + p.intelligence) / 2));
  const recoverer = random.choices(candidates, { weights: weights, k: 1 })[0];
  _stat(recoverer, "fumble_recoveries");
  last_play["recovered_by"] = recoverer.name;
  if (spot < 60 && random.random() < cfg.FUMBLE_RETURN_TD_CHANCE) {
    _stat(recoverer, "defensive_touchdowns");
    _stat(recoverer, "fumble_return_yards", spot);    // the spot is the yards the defense must return it
    play_functions.debug_td_stats.push({ type: "defensive_fumble", player: recoverer.name, position: recoverer.position });
    return ["defensive_touchdown", 100];
  }
  const return_yards = random.randint(0, 8);
  _stat(recoverer, "fumble_return_yards", return_yards);
  // The defense runs toward the offense's goal line (yardline 0 in the offense's direction).
  return ["fumble", Math.max(1, Math.min(99, spot - return_yards))];
}


// ===================== rushing =====================

/**
 * The lead back (the halfback highest on the depth chart) is the main carrier; a second
 * halfback on the field with him carries less, a fullback rarely, a receiver almost never.
 */
export function _carry_weight(player, lead_depth, fb_weight) {
  if (player.position === "RB") {
    if (getattr(player, "role", null) === "FB") {
      return fb_weight;
    }
    if (player.depth === lead_depth) {
      return 0.80;
    }
    return cfg.RB_SECOND_BACK_CARRY_WEIGHT;
  }
  if (player.position === "WR") {
    return 0.012;
  }
  return 0.02;
}


/**
 * One running play. Returns (result, yards) where result is 'run', 'fumble' or
 * 'defensive_touchdown'. On a fumble the second value is the new yardline.
 */
export function get_run_yards(offense, defense, down, first_down, guessed_play, yardline, verbose = false, tendencies = null) {
  const last_play = play_functions.last_play;
  tendencies = tendencies || {};
  let qb = null;
  for (const p of offense) if (p.position === "QB") { qb = p; break; }
  const qb_share = get(tendencies, "qb_run_share", cfg.QB_DESIGNED_RUN_SHARE * 100) / 100;
  let carrier;
  if (qb !== null && random.random() < qb_share) {
    carrier = qb;                                     // designed quarterback run
  } else {
    let candidates = [];
    for (const p of offense) if (p.position === "RB" || p.position === "WR") candidates.push(p);
    if (!candidates.length) {
      candidates = [];
      for (const p of offense) if (["RB", "WR", "QB", "TE"].includes(p.position)) candidates.push(p);
    }
    let lead_depth = null;
    for (const p of candidates) {
      if (p.position === "RB" && getattr(p, "role", null) !== "FB") {
        if (lead_depth === null || p.depth < lead_depth) lead_depth = p.depth;
      }
    }
    const fb_weight = get(tendencies, "fb_carry_weight", cfg.FB_CARRY_WEIGHT);
    const weights = [];
    for (const p of candidates) weights.push(_carry_weight(p, lead_depth, fb_weight));
    carrier = random.choices(candidates, { weights: weights, k: 1 })[0];
  }

  _note({ who: carrier.name, pos: carrier.position });

  // Line battle: blockers vs. the front seven (plus whoever the defense committed).
  let blockers = _group_rating(offense, ["OL", "TE"], ["strength", "run_blocking"]);
  blockers += _slider_points(cfg.sliders.run_blocking);
  const front_positions = ["DL", "MLB", "ROLB", "LOLB", "OLB"];
  let front = _group_rating(defense, front_positions, ["strength", "tackling"]);
  front += _slider_points(cfg.sliders.run_defense);

  let carrier_rating;
  if (carrier.position === "RB" || carrier.position === "QB") {
    // a designed QB run reads the runner the way a back's carry does (it used speed and
    // strength only, so elusive, patient runners such as Kansas State's QB gained too little)
    carrier_rating = _rating(carrier, ["speed", "strength", "elusiveness", "vision"]);
  } else {
    carrier_rating = _rating(carrier, ["speed", "strength"]);
  }
  carrier_rating += _slider_points(cfg.sliders.running_ability);

  // ratings v2: inside or outside, and the attributes that read differently in each
  const power_style = (_attr(carrier, "power_running") + _attr(carrier, "tackle_breaking") + _attr(carrier, "strength")
    + _attr(carrier, "stiff_arm", _attr(carrier, "tackle_breaking"))) / 4;      // a stiff arm is a power back's (his tackle breaking, for a carrier without one)
  const speed_style = (_attr(carrier, "burst") + _attr(carrier, "agility") + _attr(carrier, "elusiveness")) / 3;
  const outside_share = Math.max(0.15, Math.min(0.75, cfg.RUN_OUTSIDE_SHARE + (speed_style - power_style) * cfg.RUN_STYLE_TILT
    + get(get(cfg.SCHEME_STYLE, get(tendencies, "offense_scheme"), {}), "outside", 0.0)));
  const outside = random.random() < outside_share;
  last_play["direction"] = outside ? "outside" : "inside";
  const line = _members(offense, ["OL", "TE"]);
  const front_players = _members(defense, front_positions);
  const line_lean = _static(line, "line_lean", (ps) => {
    if (!ps.length) return 0.0;
    let acc = 0;
    for (const p of ps) acc += (_attr(p, "drive_block") - _attr(p, "reach_block")) / 2;
    return acc / ps.length;
  });
  const front_lean = _static(front_players, "front_lean", (ps) => {
    if (!ps.length) return 0.0;
    let acc = 0;
    for (const p of ps) acc += (_attr(p, "block_shedding") - _attr(p, "pursuit")) / 2;
    return acc / ps.length;
  });
  const style = (power_style - speed_style) / 2;               // + a power runner, - a speed runner
  const sign = outside ? -1 : 1;                           // inside rewards drive, shedding and power; outside the opposite
  let yards_style = sign * line_lean * cfg.RUN_LINE_STYLE_EFFECT - sign * front_lean * cfg.RUN_FRONT_STYLE_EFFECT
    + sign * style * cfg.RUN_CARRIER_STYLE_EFFECT;
  const mean_weight = (ps) => {
    let acc = 0;
    for (const p of ps) acc += p.weight;
    return acc / ps.length;
  };
  if (!outside && line.length && front_players.length) {
    const line_w = _static(line, "weight", mean_weight);
    const front_w = _static(front_players, "weight", mean_weight);
    yards_style += (line_w - front_w - cfg.LINE_WEIGHT_GAP) * cfg.RUN_WEIGHT_EFFECT;
  }
  const fx = cfg.TRAIT_FX;
  if (outside) {
    yards_style += _tr(carrier, "quick_feet", "slippery", "spin_artist", "stiff_arm_specialist") * fx["open_field"];
  } else {
    yards_style += _tr(carrier, "tough_runner", "downhill_runner", "bulldozer", "balance") * fx["power_run"];
  }
  yards_style += _tr(carrier, "extra_effort") * fx["extra_effort"];
  yards_style += _tr_points(line, cfg.LINE_RUN_TRAITS) * fx["line_run"] - _tr_points(front_players, cfg.TACKLE_TRAITS) * fx["tackle"];
  const carry_keys = ["run_vision", "elusiveness", "power_running", "tackle_breaking", "ball_security"];
  yards_style += (_attr(carrier, "run_vision") - _attr_mean(carrier, carry_keys)) * cfg.RUN_VISION_EFFECT;
  // blocks finished (every run) and blockers out in front (an outside run): the linemen, and a fullback leading
  if (line.length) {
    yards_style += (_static(line, "finish_block", (ps) => {
      let acc = 0;
      for (const p of ps) acc += _attr(p, "finish_block");
      return acc / ps.length;
    })) * cfg.FINISH_BLOCK_EFFECT;
  }
  if (outside) {
    const leads = [];
    for (const p of _members(offense, ["OL", "FB", "RB"])) {
      if (p !== carrier && truthy(p.attrs) && Object.prototype.hasOwnProperty.call(p.attrs, "lead_block")) leads.push(p);
    }
    if (leads.length) {
      let acc = 0;
      for (const p of leads) acc += _attr(p, "lead_block");
      yards_style += acc / leads.length * cfg.LEAD_BLOCK_EFFECT;
    }
  }

  let yards = random.gauss(cfg.RUSH_BASE_YARDS[0], cfg.RUSH_BASE_YARDS[1]);
  yards += yards_style;
  yards += (blockers - front) * cfg.RUSH_PER_LINE_POINT;
  // the carrier against the defenders who chase him, not against an average defense
  const pursuit = _group_rating(defense, front_positions, ["speed", "tackling"]);
  yards += (carrier_rating - pursuit) * cfg.RUSH_PER_CARRIER_POINT;
  yards += guessed_play ? cfg.RUSH_GUESSED : cfg.RUSH_NOT_GUESSED;
  // a lead-blocking back, and a closer late in a close game
  yards += _tr_points(_members(offense, ["FB", "RB", "TE"]), ["lead_back"]) * cfg.TRAIT_FX["lead_back"];
  if (play_functions.CLUTCH_NOW[0]) {
    yards += _tr(carrier, "closer") * cfg.TRAIT_FX["closer"] * 40;
  }

  let big_play_chance = cfg.RUSH_BIG_PLAY_CHANCE * Math.pow(_rel(carrier.speed), cfg.RUSH_BIG_PLAY_SPEED_POWER) * (1 + _tr(carrier, "breakaway_speed") * cfg.TRAIT_FX["breakaway"]);
  if (!guessed_play) {
    big_play_chance *= 1.3;
  }
  if (truthy(get(tendencies, "conservative"))) {
    big_play_chance *= cfg.GARBAGE_BIG_PLAY;
  }
  big_play_chance *= get(tendencies, "big_play_mult", 1.0);
  if (yards > 0 && random.random() < big_play_chance) {
    yards += random.randint(cfg.RUSH_BIG_PLAY_YARDS[0], cfg.RUSH_BIG_PLAY_YARDS[1]);
  }

  // Short yardage: a push for the line often gets there.
  const push = (_attr(carrier, "power_running") + line_lean - front_lean) * cfg.SHORT_YARDAGE_STYLE_EFFECT
    + _tr(carrier, "bulldozer") * cfg.TRAIT_FX["bulldozer_push"];
  if (first_down <= 2 && down >= 3 && yards < first_down && random.random() < cfg.RUSH_SHORT_YARDAGE_CONVERT + push) {
    yards = first_down + random.uniform(0, 1.5);
  }

  yards = Math.max(cfg.RUSH_MIN_YARDS, round(yards));
  const is_touchdown = yardline + yards >= 100;
  if (is_touchdown) {
    yards = 100 - yardline;
  }

  // Fumble (checked before the touchdown is awarded)
  let fumble_chance = cfg.sliders.get_inverse_percentage_adjustment(cfg.sliders.fumble_frequency, cfg.RUSH_FUMBLE_CHANCE);
  fumble_chance *= 1 - ((carrier.strength || 0) + (carrier.intelligence || 0)) / 60;
  fumble_chance *= _fumble_mult(carrier, front_players);
  if (random.random() < Math.max(0.002, fumble_chance)) {
    const spot = Math.max(1, Math.min(99, yardline + Math.max(0, yards)));
    carrier.stats["carries"] += 1;
    carrier.stats["rush_yards"] += Math.max(0, Math.min(yards, 99 - yardline));
    game_functions.apply_run_fatigue(offense, defense, carrier, yards);
    const [result, new_spot] = _lose_fumble(offense, defense, carrier, spot, ["DL", "MLB", "ROLB", "LOLB", "S", "CB"], yards);
    if (result !== null) {
      return [result, new_spot];
    }
    // Offense recovered: the play stands where the ball was fumbled, no touchdown.
    return ["run", Math.max(0, Math.min(yards, 99 - yardline))];
  }

  if (is_touchdown) {
    carrier.stats["rushing_touchdowns"] += 1;
    play_functions.debug_td_stats.push({ type: "rushing", player: carrier.name, position: carrier.position });
  }
  if (verbose) {
    console.log("Rush for", yards, "yards by", carrier.name);
  }
  carrier.stats["carries"] += 1;
  carrier.stats["rush_yards"] += yards;
  _stat_max(carrier, "long_rush", yards);
  if (yards >= 20) {
    _stat(carrier, "explosive_runs");
    _credit_lineman(offense, "key_blocks", "run_blocking", false, true);
  } else if (yards <= 0) {
    _credit_lineman(offense, "stuffs_allowed", "run_blocking", true, true);
  }
  if (yards >= first_down) {
    _stat(carrier, "rushing_first_downs");
    if (down >= 3) {
      _stat(carrier, "rushing_conversions");
    }
  }
  game_functions.apply_run_fatigue(offense, defense, carrier, yards);
  if (!is_touchdown) {
    _credit_tackle(defense, yards);
  }
  return ["run", yards];
}


// ===================== passing =====================

export function _pick_target(offense) {
  const [pool, weights] = _dyn(offense, "targets", _target_pool);
  if (pool === null) {
    return null;
  }
  return random.choices(pool, { weights: weights, k: 1 })[0];
}


/**
 * (the receivers and backs, their target weights) for this lineup; the weights read
 * route running and hands, so they hold for one ratings version.
 */
export function _target_pool(offense) {
  const receivers = [];
  for (const p of offense) if (p.position === "WR" || p.position === "TE") receivers.push(p);
  const backs = [];
  for (const p of offense) if (p.position === "RB") backs.push(p);
  if (!receivers.length && !backs.length) {
    return [null, null];
  }
  let weights = [];
  for (const p of receivers) {
    // Steep in rating so a real number-one receiver gets a number-one share of targets.
    // (0.825 for an average starting receiver, a fortieth more for each card point of routes and hands over his, half
    // that for speed)
    let w = Math.pow(Math.max(0.01, 0.825 + (_rating(p, ["route_running", "hands"]) + (p.speed || 0) / 2) / 40), cfg.TARGET_WEIGHT_POWER);
    if (p.position === "TE") {
      w *= cfg.TE_TARGET_WEIGHT;
    }
    w *= 1 + _tr(p, "qbs_favorite", "checkdown_target") * cfg.TRAIT_FX["target_pull"];
    weights.push(w * p.target_mult);
  }
  const total = sum(weights) || 1.0;
  if (backs.length && receivers.length) {
    const rb_each = total * cfg.RB_TARGET_SHARE / (1 - cfg.RB_TARGET_SHARE) / backs.length;
    for (let i = 0; i < backs.length; i++) weights.push(rb_each);
  } else if (backs.length) {
    weights = [];
    for (let i = 0; i < backs.length; i++) weights.push(1.0);
  }
  return [[...receivers, ...backs], weights];
}


export function _credit_completion(qb, target, yards) {
  qb.stats["completions"] += 1;
  qb.stats["pass_yards"] += yards;
  target.stats["receptions"] += 1;
  target.stats["receiving_yards"] += yards;
}


/**
 * One dropback. Returns (result, yards or new yardline):
 * 'successful_pass' / 'checkdown_pass' (yards), 'incomplete' (0), 'sack' (negative yards),
 * 'interception' / 'fumble' (new yardline), 'defensive_touchdown' (100), 'run' (scramble yards).
 */
export function get_pass_yards(offense, defense, down, first_down, guessed_play, yardline, verbose = false, tendencies = null,
  blitz_rate = 50, def_tendencies = null) {
  const last_play = play_functions.last_play;
  const DEPTHS = play_functions.DEPTHS, QB_ACC = play_functions.QB_ACC;
  tendencies = tendencies || {};
  def_tendencies = def_tendencies || {};
  let qb = null;
  for (const p of offense) if (p.position === "QB") { qb = p; break; }
  if (qb === null) {
    _note();
    return ["incomplete", 0];
  }
  _note({ qb: qb.name });
  let qb_accuracy = 0.6 * (qb.passing || 0) + 0.25 * (qb.decision_making || 0) + 0.15 * (qb.intelligence || 0);
  qb_accuracy += _slider_points(cfg.sliders.qb_accuracy);
  const qb_decisions = qb.decision_making || 0;

  // --- Throwaway ---
  if (random.random() < cfg.THROWAWAY_CHANCE) {
    qb.stats["pass_attempts"] += 1;
    game_functions.apply_pass_fatigue(offense, defense);
    last_play["throwaway"] = true;
    return ["incomplete", 0];
  }

  // --- Pass rush vs. protection ---
  const protection = _group_rating(offense, ["OL"], ["strength", "pass_blocking"]) + _slider_points(cfg.sliders.pass_blocking);
  const rushers = pass_rushers(defense);
  let rush_mean;
  if (rushers.length) {
    let acc = 0;
    for (const p of rushers) acc += _rating(p, ["strength", "rushing"]);
    rush_mean = acc / rushers.length;
  } else {
    rush_mean = 0;
  }
  const rush = rush_mean + _slider_points(cfg.sliders.pass_rush);
  let sack_rate = cfg.SACK_BASE + (rush - protection) * cfg.SACK_PER_LINE_POINT;
  sack_rate -= qb_decisions * cfg.SACK_PER_QB_POINT;
  // ratings v2: power rush against anchor or speed rush against footwork, then sack escape
  const linemen = _members(offense, ["OL"]);
  if (rushers.length && linemen.length) {
    const rush_lean = _static(rushers, "rush_lean", (ps) => {
      let acc = 0;
      for (const p of ps) acc += (_attr(p, "power_rush") - _attr(p, "speed_rush")) / 2;
      return acc / ps.length;
    });
    const line_lean = _static(linemen, "pass_lean", (ps) => {
      let acc = 0;
      for (const p of ps) acc += (_attr(p, "pass_anchor") - _attr(p, "pass_footwork")) / 2;
      return acc / ps.length;
    });
    const power = random.random() < Math.max(0.15, Math.min(0.85, cfg.RUSH_POWER_SHARE + rush_lean * cfg.RUSH_STYLE_TILT));
    const sign = power ? 1 : -1;
    sack_rate += sign * (rush_lean - line_lean) * cfg.RUSH_MATCHUP_EFFECT;
    last_play["rush"] = power ? "power" : "speed";
  }
  sack_rate *= Math.max(0.5, 1 - _attr(qb, "sack_escape") * cfg.SACK_ESCAPE_EFFECT);
  sack_rate *= Math.max(0.4, 1 - _tr(qb, "steps_up", "escape_artist", "play_extender") * cfg.TRAIT_FX["sack_avoid"]);
  // coach styles: the DC's blitz (more sacks, more big plays behind it) and the OC's play-action
  const blitz = random.random() < Math.min(0.7, cfg.BLITZ_BASE * blitz_rate / 50);
  sack_rate *= blitz ? cfg.BLITZ_SACK[0] : cfg.BLITZ_SACK[1];
  last_play["blitz"] = blitz;
  const pa_share = cfg.PLAY_ACTION_BASE * get(get(cfg.SCHEME_STYLE, get(tendencies, "offense_scheme"), {}), "pa", 1.0)
    * Math.max(0.2, 1 + (get(tendencies, "play_action_rate", 50) - 50) * cfg.PLAY_ACTION_RATE_EFFECT);
  const play_action = down <= 2 && random.random() < Math.min(0.6, pa_share);
  if (play_action) {
    sack_rate *= cfg.PLAY_ACTION_SACK;
    last_play["play_action"] = true;
  }
  sack_rate *= Math.max(0.5, 1 - _tr_points(linemen, cfg.LINE_PASS_TRAITS) * cfg.TRAIT_FX["line_pass"]);
  sack_rate *= 1 + _tr_points(rushers, cfg.RUSH_TRAITS) * cfg.TRAIT_FX["rush"];
  if (guessed_play) {
    sack_rate += cfg.SACK_GUESSED_BONUS;
  }
  sack_rate = Math.max(0.01, Math.min(0.25, sack_rate));
  if (random.random() < sack_rate) {
    const sack_yards = -Math.max(1, int(round(random.gauss(cfg.SACK_YARDS[0], cfg.SACK_YARDS[1]))));
    const [sackers, is_half] = assign_sack(defense, guessed_play, rushers, blitz_rate);
    const sacker_names = [];
    for (const s of sackers) sacker_names.push(s.name);
    last_play["sacked_by"] = sacker_names.join(" and ");
    for (const sacker of sackers) {
      sacker.stats["sacks"] += is_half ? 0.5 : 1;
      sacker.stats["solo_tackles"] += 1;
      _stat(sacker, "tackles_for_loss", is_half ? 0.5 : 1);
    }
    _credit_lineman(offense, "sacks_allowed", "pass_blocking", true);
    qb.stats["sacks_taken"] += 1;
    game_functions.apply_pass_fatigue(offense, defense);
    let strip_chance = cfg.sliders.get_inverse_percentage_adjustment(cfg.sliders.fumble_frequency, cfg.SACK_FUMBLE_CHANCE);
    strip_chance *= 1 - (qb.strength || 0) / 60;
    if (random.random() < strip_chance) {
      const spot = Math.max(1, yardline + sack_yards);
      const [result, new_spot] = _lose_fumble(offense, defense, qb, spot, ["DL", "MLB", "ROLB", "LOLB"], 0);
      if (result !== null) {
        return [result, new_spot];
      }
    }
    return ["sack", sack_yards];
  }

  // A pressure that did not become a sack: the throw is hurried (completion falls, less for a
  // poised quarterback) and a rusher gets the hurry.
  const pressured = random.random() < Math.min(0.6, sack_rate * cfg.PRESSURE_PER_SACK_RATE);
  if (pressured) {
    last_play["pressured"] = true;
    if (rushers.length) {
      const hurry_weights = [];
      for (const p of rushers) hurry_weights.push(_rel(p.rushing));
      _stat(cfg.stat_rng.choices(rushers, { weights: hurry_weights, k: 1 })[0], "hurries");
      _credit_lineman(offense, "pressures_allowed", "pass_blocking", true);
    }
  }

  // --- Target and coverage ---
  const target = _pick_target(offense);
  if (target === null) {
    qb.stats["pass_attempts"] += 1;
    return ["incomplete", 0];
  }
  last_play["target"] = target.name;
  last_play["target_pos"] = target.position;
  const db_positions = target.position === "WR" ? ["CB", "S"] : ["CB", "S", "MLB", "ROLB", "LOLB", "OLB"];
  const coverage = _group_rating(defense, db_positions, ["coverage"]) + _slider_points(cfg.sliders.pass_defense);
  const db_speed = _group_rating(defense, ["CB", "S"], ["speed"]);

  let receiver_skill;
  if (target.position === "RB") {
    receiver_skill = _rating(target, ["hands", "elusiveness"]);
  } else {
    receiver_skill = _rating(target, ["route_running", "hands"]);
  }
  receiver_skill += _slider_points(cfg.sliders.wr_catching);

  // ratings v2: the throw's depth, the coverage call, and the attributes for both
  const depth = target.position !== "RB" ? _throw_depth(target, tendencies, play_action) : "short";
  last_play["depth"] = depth;
  const man_share = cfg.MAN_COVERAGE_SHARE + (get(def_tendencies, "man_coverage_rate", 50) - 50) * cfg.MAN_RATE_EFFECT;
  const man = random.random() < Math.max(0.1, Math.min(0.85, man_share));
  const covers = _members(defense, db_positions);

  let completion = cfg.COMPLETION_BASE;
  completion += cfg.DEPTH_COMPLETION[depth];
  const acc_mean = _attr_mean(qb, QB_ACC, play_functions.QB_ACC_WEIGHTS);
  completion += (_attr(qb, QB_ACC[DEPTHS.indexOf(depth)]) - acc_mean) * cfg.DEPTH_ACCURACY_EFFECT;
  if (depth === "deep") {
    completion += (_attr(qb, "arm_strength") - acc_mean) * cfg.ARM_DEEP_EFFECT;
  }
  if (target.position !== "RB") {
    const r = _routes(target);
    completion += (r[depth] - sum([r.short, r.mid, r.deep]) / 3) * cfg.ROUTE_DEPTH_EFFECT;
  }
  if (covers.length) {
    // the coverage players' strength in this call over their average of man and zone
    const lean = _static(covers, "cover_lean", (ps) => {
      let acc = 0;
      for (const p of ps) acc += (_attr(p, "man_coverage") - _attr(p, "zone_coverage")) / 2;
      return acc / ps.length;
    });
    completion -= (man ? lean : -lean) * cfg.COVERAGE_TYPE_EFFECT;
  }
  if (covers.length && random.random() < cfg.CONTESTED_SHARE[depth]) {
    // a defender on him at the catch point: hands in traffic, leaping and height against his
    const cover_weights = [];
    for (const p of covers) cover_weights.push(_rel(p.coverage));
    const defender = random.choices(covers, { weights: cover_weights, k: 1 })[0];
    let catch_ = _attr(target, "contested_catch");     // with his highlight catches in it, when his position has them
    catch_ += (_attr(target, "highlight_catch", catch_) - catch_) * cfg.HIGHLIGHT_CATCH_SHARE;
    const edge = (catch_ - _attr(defender, "ball_skills")) / 2
      + (_attr(target, "leaping") - _attr(defender, "leaping")) / 2
      + (target.height_in - defender.height_in) * cfg.CONTESTED_HEIGHT_POINTS;
    completion += edge * cfg.CONTESTED_EFFECT;
    last_play["contested"] = true;
  }
  if (pressured) {
    completion += cfg.PRESSURE_COMPLETION + _attr(qb, "pocket_poise") * cfg.POISE_EFFECT
      + _attr(qb, "throw_on_move") * cfg.THROW_ON_MOVE_EFFECT;
    completion += _tr(qb, "unflappable") * cfg.TRAIT_FX["unflappable"]
      + _tr(qb, "accurate_on_the_run", "poised_on_the_run", "off_platform") * cfg.TRAIT_FX["on_the_move"];
  } else {
    completion += _tr(qb, "pinpoint") * cfg.TRAIT_FX["pinpoint"];
  }
  const fx = cfg.TRAIT_FX;
  completion += _tr(target, "glue_hands") * fx["glue_hands"];
  if (depth === "short") {
    completion += _tr(qb, "timing_passer") * fx["timing_passer"];
  }
  if (depth !== "deep") {
    completion += _tr(target, "sharp_cutter") * fx["sharp_cutter"];
  } else {
    completion += _tr(target, "double_move") * fx["double_move"];
  }
  if (truthy(get(last_play, "contested"))) {
    completion += _tr(target, "jump_ball_winner") * fx["jump_ball"];
  }
  if (man && depth !== "deep" && covers.length && random.random() < cfg.PRESS_RATE * get(def_tendencies, "press_rate", 50) / 50) {
    const press = _static(covers, "press", (ps) => {
      let acc = 0;
      for (const p of ps) acc += _attr(p, "press");
      return acc / ps.length;
    });
    completion += (_attr(target, "release") - press) * cfg.PRESS_EFFECT;
    last_play["press"] = true;
  }
  if (play_action && depth !== "short") {
    const front_iq = _members(defense, ["MLB", "ROLB", "LOLB", "S"]);
    const diag = _static(front_iq, "diag", (ps) => {
      if (!ps.length) return 0;
      let acc = 0;
      for (const p of ps) acc += _attr(p, "diagnosis");
      return acc / ps.length;
    });
    completion += cfg.PLAY_ACTION_COMPLETION + (_attr(qb, "play_action") - diag) * cfg.PLAY_ACTION_SKILL;
  }
  if (man) {
    completion += _tr(target, "press_beater") * fx["press_beater"];
    completion -= _tr_points(covers, cfg.COVER_TRAITS_MAN) * fx["cover"];
  } else if (depth !== "deep") {
    completion -= _tr_points(covers, cfg.COVER_TRAITS_ZONE) * fx["cover"];
  }
  // the passer's own steadying abilities
  completion += _tr(qb, "coach_on_the_field") * fx["coach_field"];
  if (play_action) {
    completion += _tr(qb, "ball_handler") * fx["ball_handler"];
  }
  if (play_functions.CLUTCH_NOW[0]) {
    completion += _tr(qb, "closer") * fx["closer"];
  }
  completion += qb_accuracy * cfg.COMPLETION_PER_QB_POINT;
  completion += receiver_skill * cfg.COMPLETION_PER_RECV_POINT;
  completion -= coverage * cfg.COMPLETION_PER_COV_POINT;
  completion += guessed_play ? cfg.COMPLETION_GUESSED : cfg.COMPLETION_NOT_GUESSED;
  if (down >= 3 && first_down >= 7) {
    completion += cfg.COMPLETION_LONG_3RD;
  }
  if (target.position === "RB") {
    completion += cfg.COMPLETION_CHECKDOWN_BONUS;
  }
  if (truthy(get(tendencies, "prevent"))) {
    completion += cfg.PREVENT_COMPLETION;
  }
  completion += get(tendencies, "pass_form_completion", 0.0);    // the team's real passing game beyond its ratings
  // red zone: a short field squeezes the coverage
  const to_goal = 100 - yardline;
  let redzone_adj = 0.0;
  for (const [inside, adj] of cfg.REDZONE_COMPLETION) {
    if (to_goal <= inside) { redzone_adj = adj; break; }
  }
  completion += redzone_adj;
  completion = Math.max(cfg.COMPLETION_MIN, Math.min(cfg.COMPLETION_MAX, completion));

  qb.stats["pass_attempts"] += 1;
  target.stats["targets"] += 1;

  if (random.random() < completion) {
    let yards;
    if (target.position === "RB") {
      yards = random.gauss(cfg.PASS_YARDS_RB[0], cfg.PASS_YARDS_RB[1]);
    } else if (depth === "deep") {
      yards = random.randint(cfg.PASS_YARDS_DEEP[0], cfg.PASS_YARDS_DEEP[1]);
    } else {
      const spread = depth === "short" ? cfg.PASS_YARDS_SHORT : cfg.PASS_YARDS_MID;
      yards = random.gauss(spread[0], spread[1]);
    }
    yards *= get(tendencies, "pass_form_yards", 1.0);
    yards *= 1 + (target.speed - db_speed) * cfg.PASS_SPEED_EFFECT
      - _group_rating(defense, db_positions, ["tackling"]) * cfg.PASS_TACKLE_EFFECT;
    // a short or intermediate catch broken for a long gain (deep throws have their own yards)
    let big_play_chance = cfg.PASS_BREAKAWAY_CHANCE * _rel(target.speed)
      * (1 + _tr(target, "breakaway_speed") * cfg.TRAIT_FX["breakaway"])
      * (blitz ? cfg.BLITZ_BIG_PLAY[0] : cfg.BLITZ_BIG_PLAY[1]);
    if (truthy(get(tendencies, "conservative"))) {
      big_play_chance *= cfg.GARBAGE_BIG_PLAY;
    }
    big_play_chance *= get(tendencies, "big_play_mult", 1.0);
    if (truthy(get(tendencies, "prevent"))) {
      big_play_chance *= cfg.PREVENT_BIG_PLAY;
    }
    if (target.position !== "RB" && depth !== "deep" && random.random() < big_play_chance) {
      yards = random.randint(cfg.PASS_BIG_PLAY_YARDS[0], cfg.PASS_BIG_PLAY_YARDS[1]);
    }
    yards = Math.max(cfg.PASS_MIN_YARDS, round(yards));
    const is_touchdown = yardline + yards >= 100;
    if (is_touchdown) {
      yards = 100 - yardline;
    }

    // Fumble after the catch
    let fumble_chance = cfg.sliders.get_inverse_percentage_adjustment(cfg.sliders.fumble_frequency, cfg.RECEPTION_FUMBLE_CHANCE);
    fumble_chance *= _fumble_mult(target, covers);
    if (!is_touchdown && yards > 0 && random.random() < fumble_chance) {
      _credit_completion(qb, target, yards);
      game_functions.apply_pass_fatigue(offense, defense, target, yards);
      const [result, new_spot] = _lose_fumble(offense, defense, target, yardline + yards, ["CB", "S", "MLB", "ROLB", "LOLB"], yards);
      if (result !== null) {
        return [result, new_spot];
      }
      return ["successful_pass", yards];
    }

    if (is_touchdown) {
      qb.stats["passing_touchdowns"] += 1;
      target.stats["receiving_touchdowns"] += 1;
      play_functions.debug_td_stats.push({
        type: target.position !== "RB" ? "passing" : "passing_checkdown",
        qb: qb.name, receiver: target.name, receiver_position: target.position,
      });
    } else {
      _credit_tackle(defense, yards);
    }
    if (verbose) {
      console.log("Pass for", yards, "yards to", target.name);
    }
    _credit_completion(qb, target, yards);
    _stat_max(target, "long_reception", yards);
    _stat_max(qb, "long_pass", yards);
    if (yards >= 25) {
      _stat(target, "explosive_catches");
    }
    if (yards >= first_down) {
      _stat(target, "receiving_first_downs");
      _stat(qb, "passing_first_downs");
      if (down >= 3) {
        _stat(qb, "passing_conversions");
      }
    }
    game_functions.apply_pass_fatigue(offense, defense, target, yards);
    return [target.position === "RB" ? "checkdown_pass" : "successful_pass", yards];
  }

  // --- Incomplete: interception? ---
  const int_mult = cfg.sliders.get_multiplier(cfg.sliders.interceptions);
  let int_chance = cfg.INT_BASE + coverage * cfg.INT_PER_COV_POINT;
  int_chance -= qb_decisions * cfg.INT_PER_QB_POINT;
  if (guessed_play) {
    int_chance += cfg.INT_GUESSED_BONUS;
  }
  int_chance = Math.max(cfg.INT_MIN, Math.min(cfg.INT_MAX, int_chance)) * int_mult;
  // ratings v2: deep and hurried throws are picked off more, ball-hawking defenders pick more
  int_chance *= cfg.INT_DEPTH_MULT[depth];
  if (pressured) {
    int_chance *= Math.max(1.0, cfg.INT_PRESSURE_MULT - _attr(qb, "pocket_poise") * cfg.INT_POISE_EFFECT);
  }
  int_chance *= 1 + _tr_points(covers, ["turnover_magnet", "pick_six"]) * cfg.TRAIT_FX["ballhawk"];
  if (covers.length) {
    let acc = 0;
    for (const p of covers) acc += _attr(p, "ball_skills");
    const skills = acc / covers.length;
    int_chance *= Math.max(0.5, 1 + skills * cfg.INT_BALL_SKILLS_EFFECT);
  }
  if (covers.length && random.random() < int_chance) {
    const pick_weights = [];
    for (const p of covers) pick_weights.push(Math.pow(_rel(p.coverage), cfg.INT_SKILL_POWER));
    const picker = random.choices(covers, { weights: pick_weights, k: 1 })[0];
    last_play["picked_by"] = picker.name;
    qb.stats["interceptions_thrown"] += 1;
    picker.stats["interceptions"] += 1;
    _stat(picker, "passes_defended");
    game_functions.apply_pass_fatigue(offense, defense);
    const spot = Math.max(1, Math.min(99, yardline + random.randint(5, 25)));   // where the ball was caught
    if (spot < 60 && random.random() < cfg.PICK_SIX_CHANCE * _rel(picker.speed)) {
      _stat(picker, "defensive_touchdowns");
      _stat(picker, "interception_return_yards", spot);    // the spot is the yards the defense must return it
      play_functions.debug_td_stats.push({ type: "defensive_interception", player: picker.name, position: picker.position });
      return ["defensive_touchdown", 100];
    }
    const return_yards = random.randint(0, 15) + int(Math.max(0, cfg.REF_POINTS + (picker.speed || 0)) / 4);
    _stat(picker, "interception_return_yards", return_yards);
    if (verbose) {
      console.log("Intercepted by", picker.name);
    }
    // Spot in the old offense's direction; the drive loop flips it for the new offense.
    return ["interception", Math.max(1, Math.min(99, spot - return_yards))];
  }

  // --- Scramble instead of a throw ---
  // a running quarterback scrambles more; defenders who read it, less
  const scramble_mult = (1 + _tr(qb, "option_maestro", "tuck_and_run") * cfg.TRAIT_FX["scramble"])
    * Math.max(0.5, 1 - _tr_points(_members(defense, ["MLB", "ROLB", "LOLB", "S", "DE"]), ["option_killer"]) * cfg.TRAIT_FX["option_killer"]);
  if (random.random() < cfg.SCRAMBLE_CHANCE * _rel(qb.speed) * scramble_mult) {
    qb.stats["pass_attempts"] -= 1;
    target.stats["targets"] -= 1;
    last_play["scramble"] = true;
    let yards;
    if (random.random() < 0.55 + (qb.speed || 0) / 40) {
      yards = random.randint(1, 12);
    } else {
      yards = -random.randint(1, 5);
    }
    if (yards > 0) {
      yards += round(_tr(qb, "option_maestro", "tuck_and_run") * cfg.TRAIT_FX["scramble"] * 10);
    }
    if (yardline + yards >= 100) {
      yards = 100 - yardline;
      qb.stats["rushing_touchdowns"] += 1;
      play_functions.debug_td_stats.push({ type: "rushing_scramble", player: qb.name, position: qb.position });
    } else {
      _credit_tackle(defense, yards);
    }
    qb.stats["carries"] += 1;
    qb.stats["rush_yards"] += yards;
    game_functions.apply_run_fatigue(offense, defense, qb, yards);
    return ["run", yards];
  }

  game_functions.apply_pass_fatigue(offense, defense);
  // About a third of incompletions are a defender's play on the ball (stat only).
  if (covers.length && cfg.stat_rng.random() < 0.35) {
    const pd_weights = [];
    for (const p of covers) pd_weights.push(_rel(p.coverage));
    _stat(cfg.stat_rng.choices(covers, { weights: pd_weights, k: 1 })[0], "passes_defended");
  }
  return ["incomplete", 0];
}


Object.assign(play_functions, {
  _note,
  assign_forced_fumble,
  _tackle_pool,
  assign_tackles,
  assign_sack,
  _stat,
  _stat_max,
  _credit_lineman,
  _rating,
  _attr,
  _attr_mean,
  _rel,
  _routes,
  _throw_depth,
  _tr,
  _tr_points,
  _fumble_mult,
  _static,
  _dyn,
  _members,
  pass_rushers,
  _rushers,
  _group_rating,
  _slider_points,
  _credit_tackle,
  credit_coverage_tackle,
  _lose_fumble,
  _carry_weight,
  get_run_yards,
  _pick_target,
  _target_pool,
  _credit_completion,
  get_pass_yards,
});
