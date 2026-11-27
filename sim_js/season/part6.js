// The season, part 6: player profiles, settings and god
// mode (editing a player), morale (form carried from game to game), the faces, team edits and team_data, the stat
// ranks, honors and game log on a player's page, and his card's Ratings tab (every rating he has).
// Everything of the season is reached through `season.` (engine_js/PORTING.md, "Big Files in Parts").
import { Random, round, int, sum, cmp, sorted, get, isNumber, truthy, json_dumps, mod, pyfloat, fmt } from "../../engine_js/pyrt.js";
import { modules } from "../../engine_js/modules.js";
import { read_json, list_dir } from "../../engine_js/files.js";
import { season } from "../season_ns.js";
import * as game_job from "../game_job.js";
import { awards } from "../awards.js";
import { coaches } from "../coaches.js";
import { ratings as ratings_v2 } from "../../teamdata_js/ratings.js";
import { cfg } from "../../engine_js/game_config.js";
import { game_scale } from "../../teamdata_js/game_scale.js";
import { recruits } from "../../career_js/recruits.js";
import { prospects } from "../../career_js/prospects.js";

// ---- small helpers, for what the page sends ----
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const is_dict = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
/** A value the page sent that cannot be used (the one class, from sim_js/coaches.js). */
const ValueError = coaches.ValueError;
/** float() or int() could not make a number of it (Python's TypeError or ValueError). */
class NotANumber extends Error {}
const _FLOAT_TEXT = /^\s*[+-]?(?:(?:\d+(?:_\d+)*)(?:\.(?:\d+(?:_\d+)*)?)?(?:[eE][+-]?\d+(?:_\d+)*)?|\.\d+(?:_\d+)*(?:[eE][+-]?\d+(?:_\d+)*)?|inf(?:inity)?|nan)\s*$/i;
const _INT_TEXT = /^\s*[+-]?\d+(?:_\d+)*\s*$/;

/** float(v): a number as it is, True and False as 1 and 0, text read as Python reads a float. */
function py_float(v) {
  if (v === true) return 1.0;
  if (v === false) return 0.0;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    if (!_FLOAT_TEXT.test(v)) throw new NotANumber(`could not convert string to float: '${v}'`);
    const t = v.trim().replace(/_/g, "").toLowerCase();
    if (/nan$/.test(t)) return NaN;
    if (/inf(inity)?$/.test(t)) return t[0] === "-" ? -Infinity : Infinity;
    return Number(t);
  }
  throw new NotANumber("float() argument must be a string or a real number");
}

/** int(round(x)) for a float Python may refuse: NaN is a ValueError, an infinity an OverflowError (which nothing catches). */
function py_round_int(x) {
  if (Number.isNaN(x)) throw new NotANumber("cannot convert float NaN to integer");
  if (!Number.isFinite(x)) throw new Error("OverflowError: cannot convert float infinity to integer");
  return int(round(x));
}

/** int(v): a whole number as it is, a float cut toward zero, True and False as 1 and 0, text read as a whole number. */
function py_int(v) {
  if (v === true) return 1;
  if (v === false) return 0;
  if (typeof v === "number") {
    if (Number.isNaN(v)) throw new NotANumber("cannot convert float NaN to integer");
    if (!Number.isFinite(v)) throw new Error("OverflowError: cannot convert float infinity to integer");
    return Math.trunc(v);
  }
  if (typeof v === "string") {
    if (!_INT_TEXT.test(v)) throw new NotANumber(`invalid literal for int() with base 10: '${v}'`);
    return Number(v.trim().replace(/_/g, ""));
  }
  throw new NotANumber("int() argument must be a string, a bytes-like object or a real number");
}

/** str(v) for what a form sends: None, True and False by Python's names, a number as Python prints it. */
function py_str(v) {
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : Number.isNaN(v) ? "nan" : v === Infinity ? "inf" : v === -Infinity ? "-inf" : pyfloat(v);
  if (typeof v === "string") return v;
  return json_dumps(v);          // (a list or a dict: Python's repr uses single quotes; no form sends one here)
}

/** Python's == of two JSON values (a dict against a dict by its keys and values, whatever their order). */
function py_eq(a, b) {
  if (a === b) return true;
  if (typeof a === "boolean") a = a ? 1 : 0;
  if (typeof b === "boolean") b = b ? 1 : 0;
  if (a === null || b === null || a === undefined || b === undefined) return (a ?? null) === (b ?? null);
  if (typeof a !== "object" || typeof b !== "object") return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => py_eq(x, b[i]));
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => own(b, k) && py_eq(a[k], b[k]));
}

// ----- player profiles --------------------------------------------------------------------
// Everything about one player: bio and ratings from the roster, season totals, league and
// conference ranks, the game log (your own team's games keep full box scores), honors.

season.CLASS_NAMES = { FR: "Freshman", FRRS: "Redshirt Freshman", SO: "Sophomore", SORS: "Redshirt Sophomore", JR: "Junior",
  JRRS: "Redshirt Junior", SR: "Senior", SRRS: "Redshirt Senior" };

// ----- settings and god mode -----------------------------------------------------------

season.DEFAULT_SETTINGS = { god_mode: false, morale: false };   // new seasons turn morale on (see new_season)
season.DEV_TRAITS = ["Normal", "Impact", "Star", "Elite"];
season.EDITABLE_FIELDS = ["ratings", "jersey", "class", "height", "weight", "dev_trait"];   // ratings: {name his card prints: card number}

function settings(state) {
  return { ...season.DEFAULT_SETTINGS, ...(get(state, "settings") || {}) };
}

function update_settings(state, changes) {
  const cur = season.settings(state);
  for (const [k, v] of Object.entries(changes)) {
    if (own(season.DEFAULT_SETTINGS, k) && v !== null && v !== undefined) {
      cur[k] = typeof season.DEFAULT_SETTINGS[k] === "boolean" ? truthy(v) : v;
    }
  }
  state["settings"] = cur;
  return cur;
}

// ----- morale: form carried from game to game -------------------------------------------
// Each team and each player carries a value between -1 and 1. A team's moves with results
// (wins, losses, upsets, blowouts); a player's with how his game compared with his season
// so far. Both fade week by week. Entering a game, ratings scale by a few percent either
// way; inside the game, momentum takes over play by play (engine/game_config.MOMENTUM).

season.MORALE_PLAYER_EFFECT = game_job.MORALE_PLAYER_EFFECT;      // a hot player is up to 6% better, a cold one 6% worse
season.MORALE_TEAM_EFFECT = game_job.MORALE_TEAM_EFFECT;          // a team riding high adds up to 3% to everyone
season.MORALE_WEEKLY_DECAY = 0.85;
season.MORALE_HOT = 0.35;                // form above this is a hot streak, below minus this a cold one
season.MORALE_RESULT = 0.5;              // a team's mood moves by this x (result - pre-game win chance): an expected win adds little
season.MORALE_BLOWOUT = 0.05;            // a 21-point result on top
season.MORALE_Z_TRACK = 0.02;            // the league's running mean player z is subtracted (each game nudges it by this share)

function morale_on(state) {
  return truthy(get(season.settings(state), "morale"));
}

function _morale_store(state) {
  if (state["morale"] === undefined) state["morale"] = { teams: {}, players: {} };
  return state["morale"];
}

function team_morale(state, slug) {
  return get(get(get(state, "morale") || {}, "teams", {}), slug, 0.0);
}

function player_form(state, slug, name, position) {
  return get(get(get(get(state, "morale") || {}, "players", {}), slug) || {}, `${name}|${position}`, 0.0);
}

function morale_factor(state, slug, name, position) {
  // How a player's ratings scale entering the next game.
  if (!season.morale_on(state)) return 1.0;
  const f = 1.0 + season.MORALE_PLAYER_EFFECT * season.player_form(state, slug, name, position) + season.MORALE_TEAM_EFFECT * season.team_morale(state, slug);
  return Math.max(0.9, Math.min(1.1, f));
}

function morale_payload(state, slug) {
  // What a game needs for one team: the team value and every player's form.
  if (!season.morale_on(state)) return null;
  return { team: season.team_morale(state, slug), players: { ...(get(get(get(state, "morale") || {}, "players", {}), slug) || {}) } };
}

// with_morale: a copy of the team with every player's ratings scaled by his form and the team's mood (game_job.js has it)
season.with_morale = game_job.with_morale;

function _perf_score(position, st) {
  // One number for a game (or a per-game average) at a position, on a points-like scale.
  const n = (k) => get(st, k, 0) || 0;

  if (position === "QB") {
    return n("pass_yards") * 0.04 + n("passing_touchdowns") * 4 - n("interceptions_thrown") * 4 + n("rush_yards") * 0.1 + n("rushing_touchdowns") * 6 - n("fumbles") * 3;
  }
  if (position === "RB" || position === "WR" || position === "TE") {
    return n("rush_yards") * 0.1 + n("receiving_yards") * 0.1 + (n("rushing_touchdowns") + n("receiving_touchdowns")) * 6 - n("fumbles") * 4;
  }
  if (position === "OL") {
    return n("key_blocks") * 2 - n("sacks_allowed") * 3 - n("pressures_allowed") * 0.5 - n("stuffs_allowed") * 0.5 + n("snaps") * 0.05;
  }
  if (["DL", "MLB", "ROLB", "LOLB", "CB", "S"].includes(position)) {
    return n("solo_tackles") + n("assisted_tackles") * 0.5 + n("tackles_for_loss") * 2 + n("sacks") * 4 + n("interceptions") * 6 + n("passes_defended") * 1.5 + n("forced_fumbles") * 4 + n("fumble_recoveries") * 2;
  }
  if (position === "K") {
    return n("fg_made") * 3 - (n("fg_attempted") - n("fg_made")) * 4 + n("pat_made") * 0.5 - (n("pat_attempts") - n("pat_made")) * 2;
  }
  return 0.0;
}

function _decay_morale(state) {
  // A week passes: every team's mood and every player's form fade toward neutral.
  if (!season.morale_on(state)) return;
  const m = season._morale_store(state);
  const faded = (rows) => {
    const kept = {};
    for (const [k, v] of Object.entries(rows)) {
      if (Math.abs(v * season.MORALE_WEEKLY_DECAY) >= 0.02) kept[k] = round(v * season.MORALE_WEEKLY_DECAY, 4);
    }
    return kept;
  };
  m["teams"] = faded(m["teams"]);
  for (const [slug, rows] of Object.entries(m["players"])) {
    const kept = faded(rows);
    if (Object.keys(kept).length) m["players"][slug] = kept;
    else delete m["players"][slug];
  }
}

function _update_morale(state, g, lines, before) {
  // After a game: the result moves both teams' moods; each player's game against his
  // season so far moves his form. `before` is the ranking entering the week.
  if (!season.morale_on(state) || truthy(get(g, "real"))) return;
  const m = season._morale_store(state);
  const teams = m["teams"];
  const all_teams = season.load_teams();
  const margin = g["home_score"] - g["away_score"];
  const edge = (all_teams[g["home"]]["team_ratings"]["overall"] - all_teams[g["away"]]["team_ratings"]["overall"]) / 36
    + (truthy(g["neutral"]) ? 0.0 : 0.04);
  const p_home = Math.max(0.05, Math.min(0.95, 0.5 + edge));     // the same pre-game chance the bracket projection uses
  for (const [side, opp] of [["home", "away"], ["away", "home"]]) {
    const slug = g[side], other = g[opp];
    const won = side === "home" ? margin > 0 : margin < 0;
    const own_margin = side === "home" ? margin : -margin;
    const expected = side === "home" ? p_home : 1.0 - p_home;
    // the result against what was expected: a heavy favorite's win (or an FCS win) adds
    // little, an upset moves both teams a lot (this replaced flat +-0.25 steps, which
    // left good teams pinned at +1 by midseason)
    let delta = season.MORALE_RESULT * ((won ? 1.0 : 0.0) - expected);
    if (Math.abs(own_margin) >= 21) delta += won ? season.MORALE_BLOWOUT : -season.MORALE_BLOWOUT;
    teams[slug] = round(Math.max(-1.0, Math.min(1.0, get(teams, slug, 0.0) + delta)), 4);
    // players: this game against the per-game average of the games before it. Games
    // against FCS teams are left out of both (an FCS opener inflated the average, so
    // most later games read as below par), and the league's running mean z is taken
    // off so a typical game reads as typical (the clamp cuts big games more than
    // quiet ones, which tilted form negative).
    const fcs_game = truthy(all_teams[other]["fictional"]);
    if (m["fcs_lines"] === undefined) m["fcs_lines"] = {};
    if (m["fcs_lines"][slug] === undefined) m["fcs_lines"][slug] = {};
    const fcs = m["fcs_lines"][slug];
    const ss = get(get(state, "season_stats") || {}, slug, {});
    if (m["players"][slug] === undefined) m["players"][slug] = {};
    const rows = m["players"][slug];
    for (const p of get(lines[side], "players", [])) {
      const key = `${p["name"]}|${p["position"]}`;
      if (fcs_game) {
        if (fcs[key] === undefined) fcs[key] = { games: 0, stats: {} };
        const f_ = fcs[key];
        f_["games"] += 1;
        for (const [k, v] of Object.entries(p["stats"])) {
          if (isNumber(v)) f_["stats"][k] = get(f_["stats"], k, 0) + v;
        }
        continue;
      }
      const game = season._perf_score(p["position"], p["stats"]);
      const line = get(get(ss, "players") || {}, key);
      const skip = get(fcs, key, { games: 0, stats: {} });
      const games = truthy(line) ? line["games"] - skip["games"] : 1;
      let z;
      if (games > 1) {
        const prior = {};
        for (const [k, v] of Object.entries(line["stats"])) {
          if (isNumber(v)) prior[k] = v - get(p["stats"], k, 0) - get(skip["stats"], k, 0);
        }
        const avg = season._perf_score(p["position"], prior) / (games - 1);
        z = Math.max(-1.0, Math.min(1.0, (game - avg) / Math.max(Math.abs(avg) * 0.6, 4.0)));
        const bias = get(m, "z_mean", 0.0);
        m["z_mean"] = round(bias + season.MORALE_Z_TRACK * (z - bias), 5);
        z -= bias;
      } else {
        z = 0.0;
      }
      z += won ? 0.1 : -0.1;
      const form = round(Math.max(-1.0, Math.min(1.0, 0.7 * get(rows, key, 0.0) + 0.3 * z)), 4);
      if (Math.abs(form) >= 0.02) rows[key] = form;
      else delete rows[key];
    }
    if (!Object.keys(rows).length) delete m["players"][slug];
  }
}

function morale_view(state, slug, name, position) {
  // The player card's morale block: form, the team's mood and the boost each gives.
  const on = season.morale_on(state);
  const form = on ? season.player_form(state, slug, name, position) : 0.0;
  const tm = on ? season.team_morale(state, slug) : 0.0;
  let label, team_label;
  if (form >= season.MORALE_HOT) label = "Hot Streak";
  else if (form <= -season.MORALE_HOT) label = "Cold Streak";
  else label = "Steady";
  if (tm >= season.MORALE_HOT) team_label = "Team Riding High";
  else if (tm <= -season.MORALE_HOT) team_label = "Team in a Slump";
  else team_label = "";
  const factor = season.morale_factor(state, slug, name, position);
  return { enabled: on, form: round(form, 2), team: round(tm, 2), factor: round(factor, 3),
    label, team_label,
    // what each does to his play next game, in percent (the page shows these)
    form_pct: round(100 * season.MORALE_PLAYER_EFFECT * form), team_pct: round(100 * season.MORALE_TEAM_EFFECT * tm),
    total_pct: round(100 * (factor - 1)) };
}

function player_edits(state, slug) {
  // God-mode edits for one team: player slug -> {field: value}.
  const e = get(get(state, "player_edits") || {}, slug);
  return truthy(e) ? e : {};
}

// *tune* The largest face (as JSON) a player may be given; a pocket-faces face is well under 1 KB.
season.MAX_FACE_BYTES = 4000;

// The faces a real player or coach always wears (cfb_sim_data/faces/<team>.json: {"players": {slug: face},
// "coaches": {name: face}, "rolled": {...}}): made by hand from his roster photo, or, with no photo, rolled once and
// saved. A team with no file rolls its faces on the page as before.
season.FACES_DIR = "cfb_sim_data/faces";
season._preset_faces = {};

function preset_faces(slug) {
  // One team's preset faces: {"players": {...}, "coaches": {...}}, both empty when the team has no file.
  if (!own(season._preset_faces, slug)) {
    const path = `${season.FACES_DIR}/${slug}.json`;
    let data;
    try {
      // (a host without the file throws, as does a file that is not JSON: no faces either way)
      data = /^[\p{L}\p{N}]+$/u.test(String(slug).replace(/-/g, "")) ? read_json(path) : {};
    } catch (err) {
      data = {};
    }
    if (!is_dict(data)) data = {};
    const got = {};
    for (const k of ["players", "coaches", "rolled"]) got[k] = is_dict(get(data, k)) ? data[k] : {};
    // "rolled": the faces saved for people with no photo; a coach's key is "coach:<name>"
    const rolled = got["rolled"];
    delete got["rolled"];
    got["players"] = { ...Object.fromEntries(Object.entries(rolled).filter(([k]) => !k.startsWith("coach:"))), ...got["players"] };
    got["coaches"] = { ...Object.fromEntries(Object.entries(rolled).filter(([k]) => k.startsWith("coach:")).map(([k, v]) => [k.slice(6), v])), ...got["coaches"] };
    season._preset_faces[slug] = got;
  }
  return season._preset_faces[slug];
}

function all_preset_faces() {
  // Every preset face for the page, read once when it starts: {"players": {slug: face}, "coaches": {name: face}}.
  // A player's slug is his alone in the league, and a coach keeps his face when he changes jobs.
  const out = { players: {}, coaches: {} };
  // (list_dir gives no names when the folder is not there)
  const names = sorted(list_dir(season.FACES_DIR).filter((n) => n.endsWith(".json")));
  for (const n of names) {
    for (const k of Object.keys(out)) Object.assign(out[k], season.preset_faces(n.slice(0, -5))[k]);
  }
  return out;
}

function player_faces(state, slug) {
  // One team's player faces: player slug -> the pocket-faces face. His preset face (preset_faces), under the one
  // drawn for him this season (the new UI's Edit Player Look), as the page sent it. A look only: no game, sim or
  // digest reads it.
  return { ...season.preset_faces(slug)["players"], ...(get(get(state, "player_faces") || {}, slug) || {}) };
}

function set_player_face(state, slug, player_slug, face) {
  // Give one player a face for the rest of the season, or (None) back to his preset or the one drawn from his id. Any team's
  // player. Returns the face stored.
  const team = get(season.load_teams(), slug);
  if (team === null) throw new ValueError("unknown team");
  if (![...team["offense"], ...team["defense"]].some((p) => get(p, "slug") === player_slug)) throw new ValueError("unknown player");
  if (state["player_faces"] === undefined) state["player_faces"] = {};
  if (state["player_faces"][slug] === undefined) state["player_faces"][slug] = {};
  const faces = state["player_faces"][slug];
  if (face === null || face === undefined) {
    delete faces[player_slug];
    return null;
  }
  if (!is_dict(face) || json_dumps(face).length > season.MAX_FACE_BYTES) throw new ValueError("a face is a pocket-faces face object");
  faces[player_slug] = face;
  return face;
}

// with_edits: a copy of the team with god-mode edits merged into its players (edited attributes merge into the
// player's own; the engine composites they move are stored with them), and your coach on your team (game_job.js has it)
season.with_edits = game_job.with_edits;

function _edit_ratings(team, base, cur, changes) {
  // God mode: change his ratings (card numbers, by the names his card prints or a rating's own key; "Decision Making"
  // is a quarterback's own). Stored with the edit: his ratings as they now are ("skills", "dmv"), his overall, and what
  // the engine reads for them (card points over his position's average starters, build_teams), so a game plays the edit
  // wherever it runs. Ratings put back as they were drop the edit.
  if (!is_dict(changes)) throw new ValueError("ratings must be a mapping");
  const keys = game_scale.keys(), rosters = modules.rosters;
  const named = season.card_of({ skills: get(cur, "skills") || get(base, "skills") || [] });
  let dmv = isNumber(get(cur, "dmv")) ? cur["dmv"] : get(base, "dmv");
  const by_name = {};
  for (const [name, skills] of rosters.names_for(base["position"], get(base, "role"))) by_name[name] = skills;
  for (const [name, raw] of Object.entries(changes)) {
    let v;
    try {
      v = Math.max(1, Math.min(99, py_round_int(py_float(raw))));
    } catch (err) {
      if (err instanceof NotANumber) throw new ValueError(`${name} must be a number`);
      throw err;
    }
    if (name === "Decision Making" || name === "decision_making") {
      if (!isNumber(dmv)) throw new ValueError(`${base["name"]} has no Decision Making`);
      dmv = v;
      continue;
    }
    const ks = own(by_name, name) ? by_name[name] : keys.includes(name) ? [name] : null;
    if (!truthy(ks)) throw new ValueError(`${base["name"]} has no ${name} rating`);
    for (const k of ks) named[k] = v;
  }
  for (const k of ["skills", "ovr", "dmv", "attributes", ...game_job.RATING_KEYS]) delete cur[k];
  const skills = keys.map((k) => get(named, k, game_scale.MISSING));
  if (JSON.stringify(skills) === JSON.stringify(get(base, "skills") || []) && dmv === get(base, "dmv")) return;
  const src = { name: base["name"], slug: base["slug"], source_position: get(base, "source_position") || base["position"],
    position: base["position"], role: get(base, "role"), "class": get(base, "class"), height: get(base, "height"),
    weight: get(base, "weight"), jersey: get(base, "jersey"), dev_trait: get(base, "dev_trait"),
    ratings: isNumber(dmv) ? { "Decision Making": dmv } : {} };
  const m = rosters.engine_attributes(src, named, get(team, "level_shift") || 0, game_scale.starter_means());
  for (const k of game_job.RATING_KEYS) if (isNumber(get(m, k))) cur[k] = m[k];
  const raw = {};
  for (const k of Object.keys(get(base, "attributes") || {})) raw[k] = game_scale.card_value(named, k, dmv);
  cur["attributes"] = modules.build_teams.attributes_of({ position: base["position"], role: get(base, "role"), _attr_raw: raw });
  cur["skills"] = skills;
  cur["ovr"] = game_scale.overall(named, src["source_position"], dmv);
  if (isNumber(dmv)) cur["dmv"] = dmv;
}

function team_edits(state, slug) {
  // What this season changes on a team before a game: god-mode edits to its players, and
  // your coach (state["coach"]) on your team.
  let edits = season.player_edits(state, slug);
  const moves = season.position_changes(state, slug);
  if (truthy(moves)) edits = { ...edits, __positions__: moves };
  if (truthy(get(state, "coach")) && slug === get(state, "team")) edits = { ...edits, __coach__: state["coach"] };
  return edits;
}

function team_data(state, slug) {
  // The team as this season sees it: the base data plus god-mode edits and your coach.
  return season.with_edits(season.load_teams()[slug], season.team_edits(state, slug));
}

function attribute_ceilings(state, slug) {
  // Your own roster: player slug -> {card attribute: how many points he can still grow there}, his card at
  // his potential (skills + the room each has left, league.potential) against his card now. The coach knows his players;
  // anyone else's stays hidden. {} without a career league.
  if (!(truthy(slug) && slug === get(state, "team"))) return {};
  const key = [get(state, "id"), season.season_year(state), get(state, "current_week"), get(get(state, "offseason") || {}, "stage"), slug,
    Object.keys(get(state, "player_edits") || {}).length];
  const had = get(season._CEILINGS, "key");
  if (had !== null && had.length === key.length && had.every((x, i) => x === key[i])) {     // his ratings move only with a week, an offseason stage or an edit
    return season._CEILINGS["out"];
  }
  const out = season._attribute_ceilings(state, slug);
  Object.assign(season._CEILINGS, { key, out });
  return out;
}

season._CEILINGS = {};

function _attribute_ceilings(state, slug) {
  const lg = modules.league, pr = prospects;
  let lgd = get(state, "league") || {};
  let roster = get(get(get(lgd, "teams") || {}, slug) || {}, "roster");
  if (!truthy(roster)) {                                    // the first season: the built-in league's players (league.from_base)
    lgd = lg.from_base();
    roster = get(get(get(lgd, "teams") || {}, slug) || {}, "roster");
  }
  if (!truthy(roster)) return {};
  const attrs = truthy(get(lgd, "attrs")) ? lgd["attrs"] : game_scale.keys();
  const out = {};
  for (const c of roster) {
    const who = { ea_position: c["pos"], position: c["pos"] };
    const zipped = {};
    for (let i = 0; i < Math.min(attrs.length, c["r"].length); i++) zipped[attrs[i]] = c["r"][i];
    const now = pr.card_attributes(zipped, who);
    const top = pr.card_attributes(lg.potential(c, attrs), who);
    const row = {};
    for (const k of Object.keys(top)) row[k] = Math.max(0, top[k] - get(now, k, top[k]));
    if (isNumber(get(c, "dmv")) && row["decision_making"] !== undefined) {      // a quarterback's Decision Making: its own number and its own room
      row["decision_making"] = Math.max(0, Math.min(99, c["dmv"] + (get(c, "dmg") || 0)) - c["dmv"]);
    }
    out[c["id"]] = row;
  }
  return out;
}

function development_reads(state, slug) {
  // player slug -> {"coachability": his level (recruits.COACHABILITY's words), "coach_level": 1
  // (Coach's Dream) to 6 (Set in His Ways), "potential_word": the letter grade of his projected overall at
  // his potential (grades.js, as the scouting report's Potential)} for your own roster only: the coach knows his
  // players; anyone else's (a future portal entrant among them) stays hidden. From the career's league
  // once it has one, else the real 2026 players' seeded values (league.base_development).
  if (!truthy(slug) || slug !== get(state, "team")) return {};
  const lg = modules.league;
  const levels = recruits.COACHABILITY.map(([name]) => name);
  const sharp = true;                                 // your own players: you coach them every day, so a plus or minus always shows
  const lgd = get(state, "league") || {};
  const roster = get(get(get(lgd, "teams") || {}, slug) || {}, "roster");
  let pairs;
  if (truthy(roster)) {
    const attrs = truthy(get(lgd, "attrs")) ? lgd["attrs"] : game_scale.keys();
    pairs = {};
    for (const c of roster) pairs[c["id"]] = [get(c, "c"), game_scale.overall(lg.potential(c, attrs), c["pos"], lg.decision_top(c)), get(c, "cm")];
  } else {
    pairs = lg.base_development();
  }
  const out = {};
  for (const p of [...season.load_teams()[slug]["offense"], ...season.load_teams()[slug]["defense"]]) {
    const [c, pot, moved] = get(pairs, get(p, "slug"), [null, 0, null]);
    if (levels.includes(c)) {
      out[p["slug"]] = { coachability: c, coach_level: levels.indexOf(c) + 1,
        ...(truthy(pot) ? { potential_word: modules.grades.letter(pot, sharp) } : {}),      // a letter grade (grades.js)
        // his last coachability move (offseason.note_coach_move), while he is still at the level it left him
        ...(truthy(moved) && moved["to"] === c ? { coachability_change: { from: moved["from"], year: moved["year"], why: moved["why"],
          up: levels.indexOf(c) < levels.indexOf(moved["from"]) } } : {}) };
    }
  }
  return out;
}

function edit_player(state, slug, player_slug, changes) {
  // Store god-mode changes to one player. Ratings are whole numbers 1-99 (card numbers); the class, the
  // development trait and the size must be real values. Names and positions stay as they
  // are (the season's stats are keyed on them). Returns the stored edits for the player.
  season.check_fbs(slug);
  const team = get(season.load_teams(), slug);
  if (team === null) throw new ValueError("unknown team");
  const base = [...team["offense"], ...team["defense"]].find((p) => get(p, "slug") === player_slug) ?? null;
  if (base === null) throw new ValueError("unknown player");
  const cur = { ...(get(season.player_edits(state, slug), player_slug) || {}) };
  for (let [k, v] of Object.entries(changes)) {
    if (!season.EDITABLE_FIELDS.includes(k)) throw new ValueError(`${k} cannot be edited`);
    if (k === "ratings") {
      season._edit_ratings(team, base, cur, v);
      continue;
    }
    if (k === "class") {
      if (typeof v !== "string" || !own(season.CLASS_NAMES, v)) throw new ValueError("class must be one of " + Object.keys(season.CLASS_NAMES).join(", "));
    } else if (k === "dev_trait") {
      if (!season.DEV_TRAITS.includes(v)) throw new ValueError("development trait must be one of " + season.DEV_TRAITS.join(", "));
    } else if (k === "weight") {
      try {
        v = Math.max(150, Math.min(400, py_int(v)));
      } catch (err) {
        if (err instanceof NotANumber) throw new ValueError("weight must be a number");
        throw err;
      }
    } else {
      v = Array.from(py_str(v).trim()).slice(0, 12).join("");
    }
    if (get(base, k) === v) delete cur[k];
    else cur[k] = v;
  }
  if (state["player_edits"] === undefined) state["player_edits"] = {};
  if (state["player_edits"][slug] === undefined) state["player_edits"][slug] = {};
  const edits = state["player_edits"][slug];
  if (Object.keys(cur).length) edits[player_slug] = cur;
  else delete edits[player_slug];
  return cur;
}

// the stats a position is ranked on: (stat key or derived name, label, higher is better, minimum qualifier)
season.RANK_STATS = {
  QB: [["pass_yards", "Passing Yards"], ["passing_touchdowns", "Passing TDs"], ["rating", "Passer Rating"], ["completion_pct", "Completion %"],
    ["rush_yards", "Rushing Yards"], ["total_touchdowns", "Total TDs"]],
  RB: [["rush_yards", "Rushing Yards"], ["rushing_touchdowns", "Rushing TDs"], ["yards_per_carry", "Yards per Carry"], ["receiving_yards", "Receiving Yards"],
    ["scrimmage_yards", "Scrimmage Yards"], ["explosive_runs", "Runs of 20+"]],
  WR: [["receiving_yards", "Receiving Yards"], ["receptions", "Receptions"], ["receiving_touchdowns", "Receiving TDs"], ["yards_per_catch", "Yards per Catch"],
    ["explosive_catches", "Catches of 25+"]],
  TE: [["receiving_yards", "Receiving Yards"], ["receptions", "Receptions"], ["receiving_touchdowns", "Receiving TDs"]],
  OL: [["snaps", "Snaps"], ["key_blocks", "Key Blocks"], ["sacks_allowed", "Sacks Allowed"]],
  DEF: [["tackles", "Tackles"], ["tackles_for_loss", "Tackles for Loss"], ["sacks", "Sacks"], ["interceptions", "Interceptions"],
    ["passes_defended", "Passes Defended"], ["forced_fumbles", "Forced Fumbles"]],
  K: [["fg_made", "Field Goals"], ["points", "Points"], ["fg_pct", "Field Goal %"], ["long_fg", "Long Field Goal"]],
  P: [["punt_avg", "Punt Average"], ["net_avg", "Net Average"], ["punts_inside_20", "Inside the 20"]],
};
season.RANK_MINIMUM = { rating: ["pass_attempts", 100], completion_pct: ["pass_attempts", 100], yards_per_carry: ["carries", 60],
  yards_per_catch: ["receptions", 20], fg_pct: ["fg_attempted", 8], punt_avg: ["punts", 15], net_avg: ["punts", 15] };
season.LOWER_IS_BETTER = new Set(["sacks_allowed"]);

function derived_stat(st, key) {
  const g = (k, d = null) => get(st, k, d);
  if (key === "rating") return truthy(g("pass_attempts")) ? awards.passer_rating(st) : null;
  if (key === "completion_pct") return truthy(g("pass_attempts")) ? 100 * g("completions", 0) / g("pass_attempts") : null;
  if (key === "total_touchdowns") return g("passing_touchdowns", 0) + g("rushing_touchdowns", 0) + g("receiving_touchdowns", 0);
  if (key === "yards_per_carry") return truthy(g("carries")) ? g("rush_yards", 0) / g("carries") : null;
  if (key === "scrimmage_yards") return g("rush_yards", 0) + g("receiving_yards", 0);
  if (key === "yards_per_catch") return truthy(g("receptions")) ? g("receiving_yards", 0) / g("receptions") : null;
  if (key === "tackles") return g("solo_tackles", 0) + g("assisted_tackles", 0);
  if (key === "points") return 3 * g("fg_made", 0) + g("pat_made", 0);
  if (key === "fg_pct") return truthy(g("fg_attempted")) ? 100 * g("fg_made", 0) / g("fg_attempted") : null;
  if (key === "punt_avg") return truthy(g("punts")) ? g("punt_yards", 0) / g("punts") : null;
  if (key === "net_avg") return truthy(g("punts")) ? g("punt_net_yards", 0) / g("punts") : null;
  const v = g(key);
  return isNumber(v) ? Number(v) : null;
}

function season_rows(position, stats) {
  // A finished season's main numbers at his position, as the page's This Season card lists a past year (the player's
  // ask): [{key, label, value}], the same stats his ranks are on (RANK_STATS), without the ranks (a past season keeps
  // his own line, not the league's).
  const out = [];
  for (const [key, label] of get(season.RANK_STATS, season._rank_group(position), [])) {
    const v = season.derived_stat(stats || {}, key);
    if (v === null) continue;
    out.push({ key, label, value: Number.isInteger(v) ? v : round(v, 1) });
  }
  return out;
}

function _rank_group(position) {
  return ["DL", "MLB", "ROLB", "LOLB", "OLB", "CB", "S"].includes(position) ? "DEF" : position;
}

function player_ranks(state, teams, team, name, position) {
  // Where the player's main numbers rank among FBS players at his position group, and
  // within his conference.
  const ss = get(state, "season_stats", {});
  const group = season._rank_group(position);
  const specs = get(season.RANK_STATS, group, []);
  if (!specs.length) return [];
  const conf = teams[team]["conference"];
  const rows = [];
  for (const [slug, ts] of Object.entries(ss)) {
    const info = get(teams, slug);
    if (!truthy(info) || truthy(info["fictional"])) continue;
    for (const p of Object.values(ts["players"])) {
      if (season._rank_group(p["position"]) !== group) continue;
      rows.push([slug, info["conference"], p["name"], p["position"], p["stats"]]);
    }
  }
  const out = [];
  for (const [key, label] of specs) {
    const qual = get(season.RANK_MINIMUM, key);
    const vals = [];
    let mine = null;
    for (const [slug, c, n, pos, st] of rows) {
      if (qual && get(st, qual[0], 0) < qual[1]) continue;
      const v = season.derived_stat(st, key);
      if (v === null || (!qual && v === 0)) continue;
      vals.push([v, slug, c]);
      if (slug === team && n === name && pos === position) mine = v;
    }
    if (mine === null) continue;
    const better = season.LOWER_IS_BETTER.has(key) ? (a, b) => a < b : (a, b) => a > b;
    const fbs_rank = 1 + vals.filter(([v]) => better(v, mine)).length;
    const conf_rank = 1 + vals.filter(([v, , c]) => c === conf && better(v, mine)).length;
    const conf_n = vals.filter(([, , c]) => c === conf).length;
    // (one decimal for a number that is not whole, else the whole number)
    out.push({ key, label, value: Number.isInteger(mine) ? mine : round(mine, 1),
      fbs_rank, fbs_n: vals.length, conf_rank, conf_n });
  }
  return out;
}

function player_honors(state, team, name) {
  // Awards, finalist spots, All-America and all-conference selections, Heisman finish.
  const aw = get(state, "awards") || {};
  const out = [];

  const hit = (c) => truthy(c) && get(c, "team") === team && get(c, "name") === name;

  const ordinal = (n) => {
    // 1st, 2nd, 3rd, 4th ... 11th ... 21st.
    const suffix = 4 <= n && n <= 20 ? "th" : get({ 1: "st", 2: "nd", 3: "rd" }, mod(n, 10), "th");
    return `${n}${suffix}`;
  };
  const capital = (a) => {
    const h = get(a, "honors") || "";
    return truthy(h) ? h.slice(0, 1).toUpperCase() + h.slice(1) + "." : "";   // a sentence, as the Awards page writes it
  };

  const nat = get(aw, "national") || {};
  const h = get(nat, "heisman") || {};
  get(h, "candidates", []).forEach((c, i) => {
    if (hit(c)) {
      const place = i === 0 ? "Heisman Trophy Winner" : `${ordinal(i + 1)} in the Heisman Vote`;
      out.push({ stage: "Heisman", award: "Heisman Trophy", place: place + (i && get(h, "finalists", []).some((x) => py_eq(x, c)) ? " (Finalist)" : ""), detail: `${c["points"]} Points` });
    }
  });
  for (const a of [...get(nat, "awards", []), ...get(get(aw, "postseason") || {}, "awards", [])]) {
    if (hit(get(a, "winner"))) {
      out.push({ stage: "National awards", award: a["name"], place: "Winner", detail: capital(a) });
    } else {
      for (const c of get(a, "finalists", []).slice(1)) {
        if (hit(c)) out.push({ stage: "National awards", award: a["name"], place: "Finalist", detail: capital(a) });
      }
    }
  }
  const aa = get(nat, "all_america") || {};
  for (const c of get(aa, "consensus", [])) {
    if (hit(c)) {
      out.push({ stage: "All-America", award: "Consensus All-American" + (truthy(get(c, "unanimous")) ? " (Unanimous)" : ""), place: c["slot"], detail: `First Team on ${c["selectors"]} of 5 Selectors` });
    }
  }
  for (const [sel, picks] of Object.entries(get(aa, "selectors") || {})) {
    for (const c of picks) {
      if (hit(c)) out.push({ stage: "All-America", award: `${sel} All-America`, place: `${c["level"] === 1 ? "First" : "Second"} Team (${c["slot"]})`, detail: "" });
    }
  }
  for (const [conf, entry] of Object.entries(get(aw, "conference") || {})) {
    for (const a of get(entry, "awards", [])) {
      if (hit(get(a, "winner"))) {
        out.push({ stage: `${conf} awards`, award: a["name"], place: "Winner", detail: "" });
      } else {
        for (const c of get(a, "finalists", []).slice(1)) {
          if (hit(c)) out.push({ stage: `${conf} awards`, award: a["name"], place: "Finalist", detail: "" });
        }
      }
    }
    for (const [sel, picks] of Object.entries(get(get(entry, "teams") || {}, "selectors", {}))) {
      for (const c of picks) {
        if (hit(c)) out.push({ stage: `All-${conf}`, award: `${sel} ${["First", "Second", "Third"].at(c["level"] - 1)} Team`, place: c["slot"], detail: "" });
      }
    }
  }
  return out;
}

function player_game_log(state, team, name, position) {
  // Per-game lines from the box scores the season keeps: your own team's games.
  if (team !== state["team"]) return null;
  const out = [];
  const boxes = Object.entries(state["my_boxes"]);
  for (const [eid, box] of boxes) {
    const g = get(state["games"], eid);
    if (!truthy(g) || !truthy(box)) continue;
    const side = g["home"] === team ? "home" : "away";
    const p = box[side]["players"].find((x) => x["name"] === name && x["position"] === position) ?? null;
    if (!truthy(p)) continue;
    const home = side === "home";
    const opp = home ? g["away"] : g["home"];
    const [pf, pa] = season._scores_for(g, home);
    out.push({ event_id: eid, week: g["week"], title: get(g, "title"), opponent: opp,
      opponent_name: home ? g["away_display"] : g["home_display"],
      venue: season._venue(g, home),
      won: pf > pa, points_for: pf, points_against: pa, stats: p["stats"], started: truthy(get(p, "starter")),
      ...season.game_line(position, p["stats"]) });
  }
  out.sort((a, b) => cmp(a["week"], b["week"]));
  return season.mark_best(out);
}

function mark_best(rows) {
  // His best game of a season's rows gets `best: true`: the one that leads on game_line's `value` (his whole day
  // as the award races score it for his position, then the numbers of his line). Only with three games to compare, a number above zero, and one
  // game alone on top; `value` is the game's own and does not go to the page.
  const scored = rows.filter((r) => Array.isArray(get(r, "value")));
  let top = null, tied = false;
  for (const r of scored) {
    const c = top === null ? 1 : cmp(r["value"], top["value"]);
    if (c > 0) { top = r; tied = false; } else if (c === 0) tied = true;
  }
  const best = scored.length >= season.BEST_GAME_MIN && top !== null && !tied && top["value"][0] > 0 ? top : null;
  return rows.map((r) => {
    const { value: _value, ...rest } = r;
    return r === best ? { ...rest, best: true } : rest;
  });
}

season.BEST_GAME_MIN = 3;                 // *tune* games with a line before one of them is marked his best

function game_line(position, stats) {
  // One game's line for a Game Log row, in the words the game already uses (awards.headline, awards.stat_line).
  // {played, line_kind, line, line_sub, line_full, value}:
  //   "own"      his position's line ("383 Yds · 4 TD"; a defender's leads with his tackles, a kicker's is his makes
  //              and attempts, a punter's his punts and average, a lineman's the sacks he allowed); under it
  //              (`line_sub`) the rest of his day: a lineman's snaps, key blocks and pressures, a defender's other
  //              plays, anyone's returns
  //   "returns"  he only returned kicks or punts: that is the line
  //   "none"     he got in the game and nothing was recorded for him
  //   "dnp"      he was on the roster for it and did not play (the box has him with no stats at all)
  // `line_full` is the whole box-score line where there is one; `value` ranks the game among his (mark_best).
  // {} with no stats on file (a save that kept only who played).
  if (stats === null || stats === undefined) return {};
  if (!Object.keys(stats).length) return { played: false, line_kind: "dnp" };
  const st = (k) => get(stats, k, 0) || 0;
  const n = awards._n;
  const group = awards.Pool._group(position, null, stats) || position;
  const kr = st("kickoff_returns"), pr = st("punt_returns");
  let returns = null;
  if (kr || pr) {
    const td = st("kickoff_return_touchdowns") + st("punt_return_touchdowns");
    returns = `${kr + pr} ${kr && pr ? "Ret" : kr ? "KR" : "PR"} · ${st("kickoff_return_yards") + st("punt_return_yards")} Yds` + (td ? ` · ${td} TD` : "");
  }
  let line = null, value = null, extra = [];             // `extra`: what goes under the line, before his returns
  if (group === "QB" && (st("pass_attempts") || st("carries"))) {
    [line, value] = [awards.headline({ stats }, group), [st("pass_yards"), st("passing_touchdowns") + st("rushing_touchdowns")]];
  } else if (group === "RB" && (st("carries") || st("targets") || st("receptions"))) {
    [line, value] = [awards.headline({ stats }, group), [st("rush_yards"), st("rushing_touchdowns") + st("receiving_touchdowns")]];
  } else if ((group === "WR" || group === "TE") && (st("targets") || st("receptions") || st("carries"))) {
    [line, value] = [awards.headline({ stats }, group), [st("receiving_yards"), st("receiving_touchdowns")]];
  } else if (["EDGE", "DT", "LB", "DB"].includes(group)) {
    const tk = st("solo_tackles") + st("assisted_tackles");
    const more = [];                                    // what else he did, the loudest first: one beside his tackles, the rest under
    if (st("sacks")) more.push(n(st("sacks"), "Sack"));
    if (st("interceptions")) more.push(`${st("interceptions")} INT`);
    if (st("tackles_for_loss") && !st("sacks")) more.push(`${st("tackles_for_loss")} TFL`);
    if (st("passes_defended")) more.push(`${st("passes_defended")} PBU`);
    if (st("forced_fumbles")) more.push(`${st("forced_fumbles")} FF`);
    if (st("fumble_recoveries")) more.push(`${st("fumble_recoveries")} FR`);
    if (tk || more.length) {
      line = [`${tk} Tkl`, ...more.slice(0, 1)].join(" · ");
      if (more.length > 1) extra = more.slice(1, 3);
      value = [tk + 2 * st("sacks") + 3 * st("interceptions") + st("tackles_for_loss") + st("passes_defended") + 2 * st("forced_fumbles"), tk];
    }
  } else if (group === "K" && (st("fg_attempted") || st("pat_attempts"))) {
    line = [st("fg_attempted") ? `${st("fg_made")}/${st("fg_attempted")} FG` : null,
      st("pat_attempts") ? `${st("pat_made")}/${st("pat_attempts")} PAT` : null].filter((x) => x !== null).join(" · ");
    value = [3 * st("fg_made") + st("pat_made"), st("long_fg")];
  } else if (group === "P" && st("punts")) {
    line = `${n(st("punts"), "Punt")} · ${fmt(st("punt_yards") / st("punts"), 1)} Avg`;
    value = [round(st("punt_yards") / st("punts"), 1), st("punts")];
  }
  if (group === "OL" && st("snaps")) {                  // his card's own line (a clean day reads as one), his day's work under it
    line = awards.headline({ stats }, group);
    value = [st("key_blocks") - 3 * st("sacks_allowed") - st("pressures_allowed"), st("snaps")];
    extra = [n(st("snaps"), "Snap"), st("key_blocks") ? n(st("key_blocks"), "Key Block") : null,
      st("pressures_allowed") ? n(st("pressures_allowed"), "Pressure") : null].filter((x) => x !== null);
  }
  if (value !== null && group !== "P") {         // (a punter's day is his average: the races' score is built for a season of punts)
    // his best game is judged on the whole day, not one number: the production score the award races use (yards,
    // touchdowns, turnovers and the rest, weighed for his position), with the line's own numbers to break a tie
    const blended = get(awards.Pool.prototype._raw_scores({ stats, group, ratings: {} }), group);
    if (isNumber(blended)) value = [round(blended, 3), ...value];
  }
  const under = [...extra, ...(returns !== null ? [returns] : [])].join(" · ") || null;
  if (line !== null) {
    return { played: true, line_kind: "own", line, line_full: awards.stat_line({ stats }, group), value,
      ...(under !== null ? { line_sub: under } : {}) };
  }
  if (returns !== null) return { played: true, line_kind: "returns", line: returns, line_full: awards.stat_line({ stats }, "RS") };
  return { played: true, line_kind: "none" };
}

function team_game_logs(state, team) {
  // The season's games your team has box scores for, once, and every player's part in each: what a career keeps of a
  // season when it ends (offseason.keep_game_logs). {games: [a game_log row without the player's own parts],
  // stat_keys: [every stat's name, once], players: {"Name|POS": {pos, m, s}}}: `m` a character a game ("2" started,
  // "1" played, "0" did not) and `s` his stat line for each game he played, in order, as [index into stat_keys,
  // value, ...] (his box-score `stats`, whole).
  const games = [], players = {}, stat_keys = [], key_at = {};
  const boxes = [];
  for (const [eid, box] of Object.entries(get(state, "my_boxes") || {})) {
    const g = get(state["games"], eid);
    if (truthy(g) && truthy(box)) boxes.push([g, box]);
  }
  boxes.sort((a, b) => cmp(a[0]["week"], b[0]["week"]));
  boxes.forEach(([g, box], i) => {
    const home = g["home"] === team;
    const [pf, pa] = season._scores_for(g, home);
    games.push({ week: g["week"], opponent_name: home ? g["away_display"] : g["home_display"], venue: season._venue(g, home),
      won: pf > pa, points_for: pf, points_against: pa });
    for (const p of box[home ? "home" : "away"]["players"]) {
      const key = `${p["name"]}|${p["position"]}`;
      if (!own(players, key)) players[key] = { pos: p["position"], m: "0".repeat(boxes.length).split(""), s: [] };
      if (players[key]["m"][i] !== "0") continue;                    // (a name twice in one box: the first is his)
      players[key]["m"][i] = truthy(get(p, "starter")) ? "2" : "1";
      const line = [];
      for (const [k, v] of Object.entries(get(p, "stats") || {})) {
        if (!own(key_at, k)) { key_at[k] = stat_keys.length; stat_keys.push(k); }
        line.push(key_at[k], v);
      }
      players[key]["s"].push(line);
    }
  });
  for (const e of Object.values(players)) e["m"] = e["m"].join("");
  return { games, stat_keys, players };
}

function player_game_logs(state, team, slug, now) {
  // His game log season by season, newest first: [{year, rows}]. `now` is this season's log (player_game_log, null
  // for a team whose box scores the season does not keep); the seasons before it are the ones the career kept
  // (offseason.keep_game_logs), each only if he has a game in it. They follow him: a season is kept wherever he plays
  // now, and one he played for another team than he is on carries that team's name (`team_name`).
  // On your team this season leads when he has played, and also, with no rows yet, when there is a kept season after
  // it (the page then opens on the newest season with games). A season that is not a career: this season's at most.
  const past = [];
  if (truthy(slug)) {
    const teams = season.load_teams();
    const kept = get(get(state, "career") || {}, "game_logs") || [];
    for (const s of sorted(kept.filter((x) => x["year"] !== get(state, "year")), (x) => x["year"], true)) {
      let e = get(get(s, "players") || {}, slug);
      if (typeof e === "string") e = { m: e };                      // a save from when only who played was kept: no lines
      const marks = get(e || {}, "m") || "", lines = get(e || {}, "s") || [], keys = get(s, "stat_keys") || [];
      const rows = [];
      let n = 0;
      (get(s, "games") || []).forEach((g, i) => {
        if (marks[i] !== "1" && marks[i] !== "2") return;
        const flat = lines[n++] || [];
        const stats = {};
        for (let j = 0; j + 1 < flat.length; j += 2) stats[keys[flat[j]]] = flat[j + 1];
        rows.push({ ...g, started: marks[i] === "2",
          ...(truthy(lines.length) ? { stats, ...season.game_line(get(e, "pos"), stats) } : {}) });
      });
      if (rows.length && rows.some((r) => get(r, "played") !== false)) {      // (a season he never got in is not one of his)
        past.push({ year: s["year"], rows: season.mark_best(rows),
          ...(get(s, "team") !== team ? { team_name: get(get(teams, s["team"]) || {}, "name") || s["team"] } : {}) });
      }
    }
  }
  const mine = truthy(now) ? now : [];
  if (team !== get(state, "team")) return past;                    // his seasons with you; this one is another team's
  return mine.length || past.length ? [{ year: get(state, "year"), rows: mine }, ...past] : [];
}

season._STAR_CUTS = null;

function recruit_stars(p) {
  // Recruiting stars estimated from the player's rating against the whole FBS player
  // pool (the rosters carry no recruiting rankings): the top 1% are five stars, the next
  // 12% four, the next 60% three, the rest two.
  if (season._STAR_CUTS === null || season._STAR_CUTS === undefined) {
    const all = [];
    for (const t of Object.values(season.load_teams())) {
      if (truthy(t["fictional"])) continue;
      for (const x of [...t["offense"], ...t["defense"]]) all.push(season.shown_overall(x));
    }
    const vals = sorted(all, (x) => x, true);
    const n = Math.max(1, vals.length);
    season._STAR_CUTS = [0.01, 0.13, 0.73].map((q) => vals[Math.min(n - 1, int(n * q))]);
  }
  const o = season.shown_overall(p);
  const [five, four, three] = season._STAR_CUTS;
  if (o >= five) return 5;
  if (o >= four) return 4;
  if (o >= three) return 3;
  return 2;
}

// ----- every rating a player has, for his card's Ratings tab (the player's ask) ----------------------------------------
// a player's ratings by the groups his card shows them in, each with its name. Every player carries all of them,
// whatever he plays.
season.SKILL_GROUPS = [
  ["General", [["speed", "Speed"], ["acceleration", "Acceleration"], ["strength", "Strength"], ["agility", "Agility"],
    ["awareness", "Awareness"], ["jumping", "Jumping"], ["injury", "Injury"], ["stamina", "Stamina"], ["toughness", "Toughness"],
    ["durability", "Durability"], ["balance", "Balance"]]],
  ["Ballcarrier", [["carrying", "Carrying"], ["break_tackle", "Break Tackle"], ["trucking", "Trucking"],
    ["change_of_direction", "Change of Direction"], ["bc_vision", "BC Vision"], ["stiff_arm", "Stiff Arm"],
    ["spin_move", "Spin Move"], ["juke_move", "Juke Move"], ["break_sack", "Break Sack"],
    ["elusiveness", "Elusiveness"], ["yards_after_contact", "Yards After Contact"]]],
  ["Receiving", [["catching", "Catching"], ["spectacular_catch", "Spectacular Catch"], ["catch_in_traffic", "Catch in Traffic"],
    ["short_route_running", "Short Route Running"], ["medium_route_running", "Medium Route Running"],
    ["deep_route_running", "Deep Route Running"], ["release", "Release"], ["separation", "Separation"],
    ["yards_after_catch", "Yards After Catch"], ["catch_radius", "Catch Radius"], ["body_control", "Body Control"]]],
  ["Blocking", [["run_block", "Run Block"], ["pass_block", "Pass Block"], ["impact_blocking", "Impact Blocking"],
    ["run_block_power", "Run Block Power"], ["run_block_finesse", "Run Block Finesse"],
    ["pass_block_power", "Pass Block Power"], ["pass_block_finesse", "Pass Block Finesse"], ["lead_block", "Lead Block"],
    ["second_level", "Second-Level Blocking"], ["blitz_pickup", "Blitz Pickup"], ["hand_technique", "Hand Technique"]]],
  ["Passing", [["throw_power", "Throw Power"], ["throw_under_pressure", "Throw Under Pressure"],
    ["throw_accuracy_short", "Throw Accuracy Short"], ["throw_accuracy_mid", "Throw Accuracy Mid"],
    ["throw_accuracy_deep", "Throw Accuracy Deep"], ["throw_on_the_run", "Throw on the Run"],
    ["play_action", "Play Action"], ["release_speed", "Release Speed"], ["pocket_poise", "Pocket Poise"],
    ["decision_making", "Decision Making"], ["touch", "Touch"]]],
  ["Defense", [["tackle", "Tackle"], ["power_moves", "Power Moves"], ["finesse_moves", "Finesse Moves"],
    ["block_shedding", "Block Shedding"], ["pursuit", "Pursuit"], ["play_recognition", "Play Recognition"],
    ["man_coverage", "Man Coverage"], ["zone_coverage", "Zone Coverage"], ["hit_power", "Hit Power"], ["press", "Press"],
    ["ball_skills", "Ball Skills"]]],
  // the kicking game: three groups of their own, each as long as it is
  ["Kicking", [["kick_power", "Kick Power"], ["kick_accuracy", "Kick Accuracy"], ["long_snap", "Long Snap"]]],
  ["Punting", [["punt_power", "Punt Power"], ["punt_accuracy", "Punt Accuracy"]]],
  ["Returning", [["kick_return", "Kick Return"], ["punt_return", "Punt Return"]]],
];
season.EVEN_GROUPS = ["General", "Ballcarrier", "Receiving", "Blocking", "Passing", "Defense"];   // these carry the same number of ratings (the player's ask)
if (new Set(season.SKILL_GROUPS.filter(([g]) => season.EVEN_GROUPS.includes(g)).map(([, rows]) => rows.length)).size !== 1) {
  throw new Error("AssertionError: the six position groups must be one length");
}
function all_skills(p) {
  // Every rating he has, by group: [{"group", "rows": [{key, label, value}]}] in SKILL_GROUPS' order ([] for a
  // player with no skills on file).
  const names = game_scale.keys(), values = get(p, "skills") || [];
  let skills = {};
  for (let i = 0; i < Math.min(names.length, values.length); i++) skills[names[i]] = values[i];
  if (!Object.keys(skills).length) return [];
  // Only what he has: his skills, each under the name his card and the roster file give it (rosters.names_for), and a
  // quarterback's Decision Making, a rating of its own. Nothing here is worked out from other ratings (the player's
  // rule: the list once carried twenty that were, Balance and Separation and Touch among them).
  const called = {};
  for (const [name, of] of modules.rosters.names_for(p["position"], get(p, "role"))) for (const k of of) called[k] = name;
  const dm = get(get(p, "attributes") || {}, "decision_making");
  if (isNumber(dm)) skills["decision_making"] = season.page_attribute(p, "decision_making", dm);
  return season.SKILL_GROUPS.map(([g, rows]) => ({ group: g,
    rows: rows.filter(([k]) => own(skills, k)).map(([k, label]) => ({ key: k, label: get(called, k) || label, value: int(round(skills[k])) })) }))
    .filter((g) => g["rows"].length);
}

function player_profile(state, team, name = null, position = null, slug = null) {
  // One player's page. `team` None with a `slug`, or a team he is not on: the first team in the teams file whose
  // roster has him (the offseason's links know a player's slug, not always the team he played for).
  if (team === undefined) team = null;
  const teams = season.load_teams();
  if (truthy(slug) && team !== null && ![...get(get(teams, team) || {}, "offense", []), ...get(get(teams, team) || {}, "defense", [])].some((x) => get(x, "slug") === slug)) {
    team = null;
  }
  if (team === null) {
    if (!truthy(slug)) return null;
    const found = Object.entries(teams).find(([, t_]) => [...t_["offense"], ...t_["defense"]].some((x) => get(x, "slug") === slug));
    team = found ? found[0] : null;
    if (team === null) return null;
  }
  season.check_fbs(team);
  let t = get(teams, team);
  if (!truthy(t)) return null;
  t = season.with_edits(t, season.team_edits(state, team));
  const roster = [...t["offense"], ...t["defense"]];
  const p = roster.find((x) => (truthy(slug) && get(x, "slug") === slug) || (truthy(name) && x["name"] === name && (!truthy(position) || x["position"] === position))) ?? null;
  if (!truthy(p)) return null;
  name = p["name"];
  position = p["position"];
  const ss = get(get(state, "season_stats", {}), team, {});
  const line = get(get(ss, "players") || {}, `${name}|${position}`);
  const stats = truthy(line) ? { ...line["stats"] } : {};
  const mf = season.morale_factor(state, team, name, position);
  const ceil = get(season.attribute_ceilings(state, team), get(p, "slug"), {});      // his room to grow per attribute
  const base_p = [...teams[team]["offense"], ...teams[team]["defense"]].find((x) => get(x, "slug") === get(p, "slug")) ?? p;
  const injuries = get(state, "injuries") || {};
  let injured = false;
  // (the season keeps a team's injured as a dict by "Name|POS": the loop then walks its keys, which are text,
  // so no name is read from them; a list of [name, ...] or of {"name"} entries is read as written)
  const hurt = is_dict(injuries) ? get(injuries, team) || [] : [];
  for (const entry_ of Array.isArray(hurt) ? hurt : Object.keys(hurt)) {
    const n = Array.isArray(entry_) ? entry_[0] : is_dict(entry_) ? get(entry_, "name") : null;
    if (n === name) injured = true;
  }
  const hc = get(get(t, "coaches") || {}, "head_coach") || {};
  const rec = season._records(state, undefined, true)[team];
  const history = [];
  const entry = get(get(get(get(state, "league") || {}, "teams") || {}, team) || {}, "roster", []).find((c) => get(c, "id") === get(p, "slug")) ?? null;
  for (const h of get(entry || {}, "hist") || []) {
    history.push({ ...h, team_name: get(get(teams, h["team"]) || {}, "name") || h["team"],
      rows: season.season_rows(get(h, "position"), get(h, "stats")) });
  }
  const promises = modules.promises, ability_goals = modules.ability_goals;
  const promise = truthy(get(state, "career")) && team === get(state, "team") ? get(promises.tags_now(state), get(p, "slug")) : null;
  // his story (offseason._recruit_stories, offseason.life): how he was recruited and what has happened since, with
  // every school named. Only your players carry the recruiting History and the life events' detail
  const name_of = (s_) => get(get(teams, s_) || {}, "name") || (s_ === "FCS" ? "a smaller school" : s_);
  let recruitment = null;
  if (truthy(get(entry || {}, "rec"))) {
    const r_ = entry["rec"];
    recruitment = { ...r_, school_name: name_of(get(r_, "school")), others: (get(r_, "others") || []).map((s_) => ({ slug: s_, name: name_of(s_) })) };
  }

  const told = (e) => {
    // the school names behind it (a cut: the school that let him go, and the one he walked on at)
    return { ...e, ...(e["kind"] === "transfer" || e["kind"] === "cut" ? { from_name: name_of(e["from"]), to_name: name_of(e["to"]) } : {}) };
  };
  const story = (get(entry || {}, "life") || []).map((e) => told(e));
  const trait_tiers = () => Object.fromEntries((get(p, "traits") || []).filter((x) => is_dict(x)).map((x) => [x["key"], x["tier"]]));
  const next_tiers = ability_goals.upgrades_view(state, team, `${name}|${position}`, trait_tiers());
  const built_on = get(game_scale.card_formula(game_scale.card_position(p)) || {}, "w") || {};
  const built_total = sum(Object.keys(get(p, "attributes") || {}).map((k) => get(built_on, k, 0.0))) || 1.0;
  const p_attrs = () => get(p, "attributes") || {};
  const game_log = season.player_game_log(state, team, name, position);
  const out = {
    history, redshirt: season.redshirt_status(state, team, p), promise,
    recruitment, story, hometown: get(entry || {}, "home"),
    skills: season.all_skills(p),                 // every rating he has, by group (the card's Ratings tab)
    face: get(season.player_faces(state, team), get(p, "slug")),
    name, slug: get(p, "slug"), position, role: get(p, "role"), depth: get(p, "depth"),
    class: get(p, "class"), class_name: get(season.CLASS_NAMES, get(p, "class") || "", get(p, "class")), height: get(p, "height"),
    weight: get(p, "weight"), jersey: get(p, "jersey"), dev_trait: get(p, "dev_trait"), starter: truthy(get(p, "in_game")),
    injured, overall: season.page_overall(p, base_p), stars: season.recruit_stars(base_p),
    edited: sorted(Object.keys(get(season.player_edits(state, team), get(p, "slug"), {}))), editable_classes: Object.keys(season.CLASS_NAMES),
    ...get(season.development_reads(state, team), get(p, "slug"), {}),
    // ratings v2: the position's attributes, the measurables, play style and traits
    attributes: Object.entries(p_attrs()).filter(([k]) => own(ratings_v2.ATTRIBUTES, k)).map(([k, v]) => ({
      key: k, label: ratings_v2.ATTRIBUTES[k][0], group: ratings_v2.ATTRIBUTES[k][1],
      about: ratings_v2.ATTRIBUTES[k][2], value: season.page_attribute(p, k, v),
      // what his form and the team's mood add today (card points, read from REF_POINTS under the average as the sim does)
      boost: mf !== 1.0 ? int(round((cfg.REF_POINTS + v) * (mf - 1))) : 0,
      // your own player: his ceiling there (the bar's unfilled part shows it)
      ...(own(ceil, k) ? { potential: Math.min(99, season.page_attribute(p, k, v) + ceil[k]) } : {}),
      // how much of his overall it is, in percent (game_scale.card_formula's weights)
      weight: round(100 * get(built_on, k, 0.0) / built_total, 1),
    })),
    height_in: get(p, "height_in"), archetype: get(p, "archetype"),
    traits: ability_goals.merged_traits(state, team, `${name}|${position}`, get(p, "traits") || []).map((tr) => ({
      key: tr["key"], name: get(ratings_v2.TRAIT_INFO, tr["key"], [tr["key"], ""])[0],
      about: get(ratings_v2.TRAIT_INFO, tr["key"], ["", ""])[1], tier: tr["tier"],
      tier_name: get(ratings_v2.TIER_NAMES, tr["tier"], ""),
      // the attributes it rests on, with his values (the ones his position carries)
      built_on: get(ratings_v2.TRAIT_KEYS, tr["key"], []).filter((k) => own(p_attrs(), k))
        .map((k) => ({ label: ratings_v2.ATTRIBUTES[k][0], value: season.page_attribute(p, k, p_attrs()[k]) })),
      intangible: !truthy(get(ratings_v2.TRAIT_KEYS, tr["key"])), earned: truthy(get(tr, "earned")),
      // what its next tier takes and how far along he is ({tier, tier_name, have, need, text})
      ...(own(next_tiers, tr["key"]) ? { next: next_tiers[tr["key"]] } : {}),
    })),
    // the ability he works toward and how far along he is
    ability_goal: ability_goals.goal_view(state, team, `${name}|${position}`, position, trait_tiers()),
    edited_attributes: (() => {                    // the card attributes his edited ratings changed
      const e = get(season.player_edits(state, team), get(p, "slug"), {});
      if (!truthy(get(e, "skills"))) return [];
      const was = season.card_of(base_p), now = season.card_of(e);
      return sorted(Object.keys(get(p, "attributes") || {}).filter((k) => game_scale.card_value(was, k, get(base_p, "dmv")) !== game_scale.card_value(now, k, get(e, "dmv") ?? get(base_p, "dmv"))));
    })(),
    morale: season.morale_view(state, team, name, position),
    // rated at every position; at his own position it is the card's overall
    ratings_at: Object.fromEntries([...modules.build_teams.ENGINE_POSITIONS, "KR"].map((k) => [k,
      k !== "KR" && season.same_group(get(season.RATING_KEY, k, k), position) ? season.shown_overall(p, base_p) : int(modules.build_teams.rated_at(p, k))])),
    team: { slug: team, name: t["name"], conference: t["conference"], coach: get(hc, "name"),
      record: `${rec["wins"]}-${rec["losses"]}`, rank: truthy(ss) ? new awards.Pool(state, teams, season._records(state)).rank_of(team) : null },
    games: truthy(line) ? line["games"] : 0, team_games: get(ss, "games", 0), stats,
    rating: truthy(get(stats, "pass_attempts")) ? awards.passer_rating(stats) : null,
    ranks: truthy(line) ? season.player_ranks(state, teams, team, name, position) : [],
    game_log,
    // the same season by season, newest first: this season's when he has played, then the ones a career kept
    game_logs: season.player_game_logs(state, team, get(p, "slug"), game_log),
    honors: season.player_honors(state, team, name),
  };
  return out;
}

Object.assign(season, {
  settings, update_settings, morale_on, _morale_store, team_morale, player_form, morale_factor, morale_payload,
  _perf_score, _decay_morale, _update_morale, morale_view, player_edits, preset_faces, all_preset_faces, player_faces,
  set_player_face, _edit_ratings, team_edits, team_data, attribute_ceilings, _attribute_ceilings,
  development_reads, edit_player, derived_stat, season_rows, _rank_group, player_ranks, player_honors, player_game_log, mark_best, game_line, team_game_logs, player_game_logs,
  recruit_stars, all_skills, player_profile,
});
