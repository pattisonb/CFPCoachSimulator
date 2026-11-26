// One game, start to finish: both teams as this week has them (the stand-in's strength, the season's edits and your
// coach, morale, the depth chart, the injured, the abilities earned), the game itself, and its result boiled down to
// what the season keeps. It holds the season's _sim_one and the helpers under it, the form shift (sim_js/form.js
// re-exports it) and apply_coach (sim_js/coaches.js re-exports it), so a helper worker can play a game with this
// file and the engine alone.
import { round, int, sum, sorted, get, isNumber, truthy } from "../engine_js/pyrt.js";
import { drive_functions } from "../engine_js/drive_functions.js";
import { simulate_game } from "../engine_js/game.js";
import { position_fit } from "../career_js/position_fit.js";
import { cfg } from "../engine_js/game_config.js";

// the ratings a whole-team shift moves (sim_js/form.js ATTRS)
export const FORM_ATTRS = ["speed", "strength", "intelligence", "passing", "decision_making", "elusiveness", "vision", "hands",
  "route_running", "run_blocking", "pass_blocking", "rushing", "tackling", "coverage", "kick_power",
  "kick_accuracy", "punt_power", "punt_accuracy", "return_rating"];
// the ratings morale scales (season.RATING_LABELS' keys)
export const RATING_KEYS = ["speed", "strength", "intelligence", "endurance", "passing", "decision_making", "elusiveness", "vision", "hands",
  "route_running", "run_blocking", "pass_blocking", "rushing", "tackling", "coverage", "kick_power", "kick_accuracy",
  "punt_power", "punt_accuracy", "return_rating"];
export const MORALE_PLAYER_EFFECT = 0.06;   // *tune* a player's form at its fullest moves his ratings by this share
export const MORALE_TEAM_EFFECT = 0.03;     // *tune* ... and the team's mood by this much
export const ROLE_POSITION = { QB: "QB", HB: "RB", FB: "RB", WR: "WR", TE: "TE", LT: "OL", LG: "OL", C: "OL", RG: "OL", RT: "OL",
  LEDG: "DL", REDG: "DL", DT: "DL", MIKE: "MLB", WILL: "ROLB", SAM: "LOLB", CB: "CB", FS: "S", SS: "S", K: "K", P: "P" };
export const OFFENSE_POSITIONS = new Set(["QB", "RB", "WR", "TE", "OL", "K", "P"]);

/** A job this file does not play: one whose data files this host cannot read (a browser helper has the league's teams
 * and nothing else, and this season's position changes need the scale and the card's formulas). */
export class NotHere extends Error {}

// ---- the form shift (sim_js/form.js) ----
function _moved(p, keys, shift) {
  // A copy of the player with the ratings in `keys` moved by `shift` card points.
  const q = { ...p };
  for (const k of keys) {
    const v = get(p, k);
    if (isNumber(v)) q[k] = round(v + shift, 1);
  }
  return q;
}

export function with_form(team, shift) {
  // A copy of the team with every player's ratings moved by `shift` card points (nothing when it is under a tenth).
  if (Math.abs(shift) < 0.1) return team;
  const out = { ...team };
  for (const unit of ["offense", "defense"]) out[unit] = team[unit].map((p) => _moved(p, FORM_ATTRS, shift));
  return out;
}

// ---- apply_coach (sim_js/coaches.js) ----
export function apply_coach(team, coach) {
  // The team with `coach` as its head coach: his schemes and tendencies on the sides he calls, his fourth downs and
  // discipline always.
  if (!truthy(coach)) return team;
  const coaches = {};
  for (const [k, v] of Object.entries(get(team, "coaches") || {})) coaches[k] = { ...v };
  const t = { ...team, coaches, tendencies: { ...(get(team, "tendencies") || {}) } };
  const r = coach["ratings"], s = coach["style"];
  const name = `${coach["first_name"]} ${coach["last_name"]}`;
  const values = Object.values(r);
  t["coaches"]["head_coach"] = {
    name, custom: true,
    ratings: { ...r, overall: round(sum(values) / values.length) },
    tendencies: { fourth_down_go_rate: s["fourth_down_go_rate"], aggressiveness: s["fourth_down_go_rate"] },
    scheme: { offensive_philosophy: coach["offense_scheme"], defensive_philosophy: coach["defense_scheme"] },
  };
  const tend = t["tendencies"];
  // discipline on the team is relative to its talent: move it by how much more or less disciplined he is than the
  // coach he replaces
  const old_disc = get(get(get(get(team, "coaches") || {}, "head_coach") || {}, "ratings") || {}, "discipline", 70);
  const disc = Math.max(0, Math.min(100, get(tend, "discipline", 50) + r["discipline"] - old_disc));
  Object.assign(tend, { fourth_down_go_rate: s["fourth_down_go_rate"], discipline: disc, observed: false });
  // his play calling likewise: the team's moved by how much better or worse he calls plays than the coordinator he
  // replaces
  const called = (side, rating) => {
    const was = get(get(get(get(team, "coaches") || {}, side) || {}, "ratings") || {}, "play_calling", 70);
    return Math.max(0, Math.min(100, get(tend, side === "offensive_coordinator" ? "oc_play_calling" : "dc_play_calling", 50) + rating - was));
  };
  if (truthy(get(coach, "calls_offense"))) {
    const oc = get(t["coaches"], "offensive_coordinator") || {};
    t["coaches"]["offensive_coordinator"] = { ...oc, scheme: { ...(get(oc, "scheme") || {}), offensive_scheme: coach["offense_scheme"] } };
    Object.assign(tend, { pass_rate: s["pass_rate"], tempo: s["tempo"], deep_shot_rate: s["deep_shot_rate"],
      play_action_rate: s["play_action_rate"], oc_play_calling: called("offensive_coordinator", r["offense"]) });
    if (coach["offense_scheme"] !== "Spread Option") delete tend["qb_run_share"];
  }
  if (truthy(get(coach, "calls_defense"))) {
    const dc = get(t["coaches"], "defensive_coordinator") || {};
    t["coaches"]["defensive_coordinator"] = { ...dc, scheme: { ...(get(dc, "scheme") || {}), defensive_scheme: coach["defense_scheme"] } };
    Object.assign(tend, { blitz_rate: s["blitz_rate"], man_coverage_rate: s["man_coverage_rate"], press_rate: s["press_rate"],
      dc_play_calling: called("defensive_coordinator", r["defense"]) });
  }
  return t;
}

// ---- the game job (sim_js/season.js) ----
export function with_positions(team, moves) {
  // A copy of the team with this season's position changes applied (change_position): each
  // moved player at his new position and depth-chart role, placed in that role's order by his
  // projected overall there (position_fit.season_move: his skills as they transfer, his size
  // against the spot's; behind everyone rated at least as high; a depth-chart override still pins
  // whoever you moved); his old role closes up behind him. The engine reads his attributes as they are,
  // as it does for a player moved into another role on the depth chart.
  const players = [...team["offense"], ...team["defense"]].map((p) => ({ ...p }));
  const by_slug = new Map();
  for (const p of players) by_slug.set(get(p, "slug"), p);
  const starters = {};
  for (const p of players) {
    if (truthy(get(p, "role")) && truthy(get(p, "in_game"))) starters[p["role"]] = get(starters, p["role"], 0) + 1;
  }
  const keys = new Set();
  for (const p of players) for (const k of Object.keys(get(p, "stats") || {})) keys.add(k);
  const stat_keys = sorted(keys);
  const touched = new Set(), arriving = new Set();
  for (const [pslug, m] of Object.entries(moves)) {
    const p = by_slug.has(pslug) ? by_slug.get(pslug) : null, role = get(truthy(m) ? m : {}, "to");
    if (p === null || typeof role !== "string" || !Object.prototype.hasOwnProperty.call(ROLE_POSITION, role)) continue;
    const pos = ROLE_POSITION[role];
    if (get(p, "role") === role && p["position"] === pos) continue;      // the league file has him there already
    for (const r of [get(p, "role"), role]) if (truthy(r)) touched.add(r);
    arriving.add(pslug);
    const crossing = OFFENSE_POSITIONS.has(p["position"]) !== OFFENSE_POSITIONS.has(pos);
    if (truthy(get(p, "skills"))) {
      const moved = position_fit.season_move(p, get(p, "role") || p["position"], role);
      p["ovr"] = moved[0];
      p["skills"] = moved[1];
    }
    p["position"] = pos;
    p["role"] = role;
    p["depth"] = null;
    p["in_game"] = false;
    p["source_position"] = role;                   // his card is scored where he plays now (game_scale.card_position)
    if (crossing) p["stats"] = Object.fromEntries(stat_keys.map((k) => [k, 0]));      // a player crossing units needs every box-score key
  }
  if (!touched.size) return team;
  for (const role of touched) {          // (each role's players are its own: the order the roles come in does not matter)
    const group = sorted(players.filter((p) => get(p, "role") === role && !arriving.has(p["slug"])), (p) => [get(p, "depth") || 99, p["name"]]);
    for (const p of sorted(players.filter((q) => get(q, "role") === role && arriving.has(q["slug"])), (q) => [-(get(q, "ovr") || 0), q["name"]])) {
      let at = group.length;
      for (let i = 0; i < group.length; i++) {
        if ((get(group[i], "ovr") || 0) < (get(p, "ovr") || 0)) { at = i; break; }
      }
      group.splice(at, 0, p);
    }
    const n = get(starters, role, Object.prototype.hasOwnProperty.call(ROLE_POSITION, role) ? 1 : 0);
    group.forEach((p, i) => {
      p["depth"] = i + 1;
      p["in_game"] = i < n;
    });
  }
  const out = { ...team };
  out["offense"] = players.filter((p) => OFFENSE_POSITIONS.has(p["position"]));
  out["defense"] = players.filter((p) => !OFFENSE_POSITIONS.has(p["position"]));
  return out;
}

export function with_edits(team, edits) {
  // A copy of the team with god-mode edits merged into its players, and your coach on your team.
  if (!truthy(edits)) return team;
  if ("__coach__" in edits) {
    team = apply_coach(team, edits["__coach__"]);
    edits = Object.fromEntries(Object.entries(edits).filter(([k]) => k !== "__coach__"));
  }
  if ("__positions__" in edits) {
    // this season's position changes (change_position): he plays and shows at his new spot
    try {
      team = with_positions(team, edits["__positions__"]);
    } catch (err) {
      // (position_fit.season_move reads the scale's files: a host without them leaves the job to one that has them)
      throw new NotHere(`this season's position changes: ${(err && err.message) || err}`, { cause: err });
    }
    edits = Object.fromEntries(Object.entries(edits).filter(([k]) => k !== "__positions__"));
  }
  if (!truthy(edits)) return team;
  const out = { ...team };
  const merged = (p) => {
    const e = edits[p["slug"]];
    const q = { ...p, ...e };
    if ("attributes" in e) q["attributes"] = { ...(get(p, "attributes") || {}), ...e["attributes"] };
    return q;
  };
  for (const unit of ["offense", "defense"]) out[unit] = team[unit].map((p) => (get(p, "slug") !== null && get(p, "slug") in edits ? merged(p) : p));
  return out;
}

export function with_morale(team, morale) {
  // A copy of the team with every player's ratings scaled by his form and the team's mood.
  if (!truthy(morale)) return team;
  const tm = get(morale, "team", 0.0);
  const players = get(morale, "players") || {};
  if (!truthy(tm) && !truthy(players)) return team;
  const out = { ...team };
  for (const unit of ["offense", "defense"]) {
    const rows = [];
    for (const p of team[unit]) {
      const form = get(players, `${p["name"]}|${p["position"]}`, 0.0);
      const f = Math.max(0.9, Math.min(1.1, 1.0 + MORALE_PLAYER_EFFECT * form + MORALE_TEAM_EFFECT * tm));
      if (Math.abs(f - 1.0) < 0.004) { rows.push(p); continue; }
      const q = { ...p };
      for (const k of RATING_KEYS) {               // (his card points over the average, scaled from REF_POINTS under it)
        const v = get(p, k);
        if (isNumber(v)) q[k] = round(v * f + cfg.REF_POINTS * (f - 1), 1);
      }
      rows.push(q);
    }
    out[unit] = rows;
  }
  return out;
}

export function apply_depth(team, overrides) {
  // A copy of the team with the season's depth-chart changes applied: players named in an overridden role take that
  // role (and its position), in the saved order; every role then starts its usual number of players. KR and PR
  // overrides pick the returner.
  if (!truthy(overrides)) return team;
  const out = { ...team };
  const players = [...team["offense"], ...team["defense"]].map((p) => ({ ...p }));
  const by_slug = {};
  for (const p of players) by_slug[p["slug"]] = p;
  const starters = {};
  for (const p of players) {
    if (truthy(get(p, "role")) && truthy(get(p, "in_game"))) starters[p["role"]] = get(starters, p["role"], 0) + 1;
  }
  const moved = new Set();
  for (const [role, order] of Object.entries(overrides)) {
    if (role === "KR" || role === "PR") {
      if (truthy(order) && order[0] in by_slug) out[role === "KR" ? "kick_returner" : "punt_returner"] = order[0];
      continue;
    }
    const chosen = order.filter((s) => s in by_slug).map((s) => by_slug[s]);
    chosen.forEach((p, i) => { p["role"] = role; p["depth"] = i + 1; moved.add(p["slug"]); });
    const rest = sorted(players.filter((p) => get(p, "role") === role && !moved.has(p["slug"])), (p) => get(p, "depth") || 99);
    rest.forEach((p, i) => { p["depth"] = chosen.length + i + 1; });
  }
  const keys = new Set();
  for (const p of players) for (const k of Object.keys(get(p, "stats") || {})) keys.add(k);
  const stat_keys = sorted(keys);
  const roles = new Set();
  for (const p of players) if (truthy(get(p, "role"))) roles.add(p["role"]);
  for (const role of roles) {            // (each role's players are its own: the order the roles come in does not matter)
    const group = sorted(players.filter((p) => get(p, "role") === role), (p) => [get(p, "depth") || 99, p["name"]]);
    group.forEach((p, i) => {
      p["depth"] = i + 1;
      p["in_game"] = i < get(starters, role, 0);     // a role the base formation leaves out stays out
      const new_pos = get(ROLE_POSITION, role, p["position"]);
      if (new_pos !== p["position"]) {
        p["position"] = new_pos;
        p["stats"] = Object.fromEntries(stat_keys.map((k) => [k, 0]));      // a player crossing units needs every box-score key
      }
    });
  }
  out["offense"] = players.filter((p) => OFFENSE_POSITIONS.has(p["position"]));
  out["defense"] = players.filter((p) => !OFFENSE_POSITIONS.has(p["position"]));
  return out;
}

export function _with_injuries(team, injured) {
  // The team data with the listed (name, position) players marked out.
  if (!truthy(injured)) return team;
  const out = new Set(injured.map((x) => `${x[0]}\u0000${x[1]}`));
  const t = { ...team };
  for (const unit of ["offense", "defense"]) {
    t[unit] = team[unit].map((p) => (out.has(`${p["name"]}\u0000${p["position"]}`) ? { ...p, injured: true, in_game: false } : p));
  }
  return t;
}

export function _game_team(teams, slug, shift, edits, morale, depth, injured) {
  // One side of a game as the engine plays it.
  let team = with_form(teams[slug], shift);
  team = with_morale(with_edits(team, edits), morale);
  return _with_injuries(apply_depth(team, depth), injured);
}

export function _with_earned(team, earned) {
  // The abilities his players have earned this career ({"Name|POS": {trait: tier}}) over the roster's own.
  if (!truthy(earned)) return team;
  team = { ...team };
  for (const unit of ["offense", "defense"]) {
    const players = [];
    for (let p of get(team, unit) || []) {
      const got = get(earned, `${get(p, "name")}|${get(p, "position")}`);
      if (truthy(got)) {
        const have = {};
        for (const t of get(p, "traits") || []) if (t !== null && typeof t === "object" && !Array.isArray(t)) have[t["key"]] = t["tier"];
        for (const [k, tier] of Object.entries(got)) have[k] = Math.max(get(have, k, 0), tier);
        p = { ...p, traits: sorted(Object.entries(have), (kv) => -kv[1]).map(([k, t]) => ({ key: k, tier: t })) };
      }
      players.push(p);
    }
    team[unit] = players;
  }
  return team;
}

export function _compact_side(side, drives, which) {
  const own = drives.filter((d) => d["offense"] === which && d["quarter"] <= 4);
  const players = [];
  for (const p of side["players"]) {
    if (!Object.values(p["stats"]).some((v) => truthy(v))) continue;
    players.push({ name: p["name"], position: p["position"], unit: p["unit"],
      stats: Object.fromEntries(Object.entries(p["stats"]).filter(([, v]) => truthy(v))) });
  }
  return { score: side["score"], team: side["team_stats"], events: get(side, "team_events") || {},
    personnel: get(side, "personnel") || {}, schemes: get(side, "schemes") || {},
    plays: sum(own.map((d) => d["plays"])), top: sum(own.map((d) => d["seconds"])), players };
}

const _WHOLE = /^\s*[+-]?\d+(?:_\d+)*\s*$/;      // what Python's int(text) takes

export function _moments(r, home_team, away_team, play_log) {
  // The game's big moments by player: a go-ahead or tying score in the fourth quarter or overtime
  // (clutch_score: the scorer and his passer; clutch_kick: the kicker), and a sack or interception then while his
  // team led by one score (clutch_stop). From the scoring plays and the play log.
  const roster = new Map();
  for (const [side, t] of [["home", home_team], ["away", away_team]]) {
    for (const p of [...(get(t, "offense") || []), ...(get(t, "defense") || [])]) {
      if (!roster.has(get(p, "name"))) roster.set(get(p, "name"), [side, `${get(p, "name")}|${get(p, "position")}`]);
    }
  }
  const out = { home: {}, away: {} };
  const credit = (name, metric) => {
    const hit = roster.get(name);
    if (hit) {
      const d = (out[hit[0]][hit[1]] ??= {});
      d[metric] = get(d, metric, 0) + 1;
    }
  };
  const secs = (clock) => {
    // "10:44" -> 644 seconds left in the quarter; an overtime or missing clock reads 0
    const parts = (clock === null || clock === undefined ? "None" : String(clock)).split(":");
    if (parts.length !== 2 || !_WHOLE.test(parts[0]) || !_WHOLE.test(parts[1])) return 0;
    return Number(parts[0].replace(/_/g, "")) * 60 + Number(parts[1].replace(/_/g, ""));
  };
  const scores = get(r, "scoring_plays") || [];
  let prev = { home: 0, away: 0 };
  const marks = [];                                  // [quarter, seconds left, home lead after]
  for (const s of scores) {
    const side = s["team"];
    const before = prev[side] - prev[side === "home" ? "away" : "home"];
    const after = side === "home" ? s["home_score"] - s["away_score"] : s["away_score"] - s["home_score"];
    if (s["quarter"] >= 4 && before <= 0 && 0 <= after) {
      const desc = get(s, "description") || "";
      let names = Array.from(desc.matchAll(/([A-Z][\p{L}\p{N}_.'\- ]+?) \((?:[A-Z]{1,4})\)/gu), (m) => m[1]);
      const passer = /^(.+?) pass to /.exec(desc);                  // "A pass to B (WR)": the passer has no tag
      if (passer) names = [...names, passer[1].trim()];
      if (["field_goal", "fg"].includes(get(s, "kind"))) for (const n of names.slice(0, 1)) credit(n, "clutch_kick");
      else for (const n of names.slice(0, 2)) credit(n, "clutch_score");
    }
    prev = { home: s["home_score"], away: s["away_score"] };
    marks.push([s["quarter"], secs(get(s, "clock")), s["home_score"] - s["away_score"]]);
  }
  const home_lead = (q, left) => {
    let lead = 0;
    for (const [mq, mleft, hl] of marks) if (mq < q || (mq === q && mleft > left)) lead = hl;
    return lead;
  };
  for (const e of play_log) {
    const q = get(e, "quarter") || 0;
    if (q < 4) continue;
    const left = secs(get(e, "clock"));
    for (const who of [get(e, "sacked_by"), get(e, "picked_by")]) {
      if (!truthy(who) || !roster.has(who)) continue;
      const side = roster.get(who)[0];
      const lead = home_lead(q, left) * (side === "home" ? 1 : -1);
      if (1 <= lead && lead <= 8) credit(who, "clutch_stop");
    }
  }
  return out;
}

/** One game job (season._run_games builds them) played against `teams`, the league's teams by slug. */
export function _sim_one(teams, args) {
  const [event_id, home, away, neutral, seed, keep_full, depth, home_out, away_out, edits, morale, form, earned] = args;
  const home_team = _with_earned(_game_team(teams, home, form[0], edits[0], morale[0], depth[0], home_out), earned[0]);
  const away_team = _with_earned(_game_team(teams, away, form[1], edits[1], morale[1], depth[1], away_out), earned[1]);
  const r = simulate_game(home_team, away_team, null, seed, truthy(neutral) ? "neutral" : "home", morale[2]);
  const play_log = drive_functions.play_log.slice();             // the big moments are read from the play log
  const out = { event_id, home_score: r["home"]["score"], away_score: r["away"]["score"], overtime: r["overtime_periods"],
    stats: { home: _compact_side(r["home"], r["drives"], "home"), away: _compact_side(r["away"], r["drives"], "away") },
    injuries: { home: get(r["home"], "injuries", []), away: get(r["away"], "injuries", []) } };
  out["moments"] = _moments(r, home_team, away_team, play_log);
  if (truthy(keep_full)) {
    r["home_slug"] = home;
    r["away_slug"] = away;
    out["game"] = r;
  }
  return out;
}
