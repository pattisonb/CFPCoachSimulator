// The roster file as the game reads it (data/engine_teams.json): the one place a real player's ratings live.
//
// Each player in the file has one set of ratings, by name ("speed": 88, "throw_power": 92: game_scale.keys()), on the
// scale every rating is shown on (teamdata_js/shown.js: the average player about a 70, the best in the 90s). The
// number in the file is the number on his card. Nothing else about how good he is is stored. Everything the game plays
// and keeps is worked out from that one set when the file is read: the numbers the play engine reads (speed, passing,
// hands...), his card's attributes, his overall, what he would be at every other position, and his ratings as a
// career's league keeps them. So a rating changed in the file by hand is his rating everywhere (the player's rule),
// in the first season as in every later one.
//
// It is worked out with the build's own formulas (teamdata_js/build_teams.js, as a career's later seasons work their
// teams out): each rating off the shown scale (shown.to_base), the engine's attributes centred on the frozen starter
// means, the team's stored `level_shift`. A team's depth chart, its starters (`in_game`), its tendencies and its
// coaches are stored as they are and read as they are.
//
// A teams file whose players already carry those numbers (a career's later season, data/leagues/) has no "format"
// and is read as it is.
import { round, int, sum, get, isNumber, truthy } from "../engine_js/pyrt.js";
import { read_text, read_json } from "../engine_js/files.js";
import { modules } from "../engine_js/modules.js";
import { game_scale } from "./game_scale.js";
import { shown } from "./shown.js";
import { ratings as rv2 } from "./ratings.js";
import { build_teams } from "./build_teams.js";
import { prospects } from "../career_js/prospects.js";

const FILE = "data/engine_teams.json";
const FORMAT = 2;            // the roster file's format: 2 has one labeled set of ratings a player and nothing worked out
const MISSING = 60;          // a rating the file leaves out (on the shown scale)
const NEAR = 3;              // how far a kept number may be moved so the page shows the file's own number

// ----- the tables: a rating in the file is a whole number 1-99, so each step is worked out once a number ---------------

let _bases = null;                       // the file's number -> the source scale (shown.to_base)
const _ours = new Map();                 // scale group -> for each rating in game_scale.keys() order: the file's number -> the stored skill
const _tenths = new Map();               // scale group -> for each rating: the stored skill -> the source scale (game_scale._base_tenth)

function _base_of() {
  if (_bases === null) {
    _bases = new Array(100).fill(0);
    for (let v = 1; v <= 99; v++) _bases[v] = shown.to_base(v);
  }
  return _bases;
}

function _stored(v, grp, key) {
  // The stored skill (game_scale: 50 the middle Power 4 starter of group `grp`) for the file's number `v`: the one
  // the page shows as `v` again (shown.skill), the nearest such when the plain conversion is a point off.
  const at = game_scale.to_ours(shown.to_base(v), grp, key);
  for (let d = 0; d <= rosters.NEAR; d++) {
    for (const o of d ? [at + d, at - d] : [at]) {
      if (o >= 1 && o <= 99 && shown.skill(o, grp, key) === v) return o;
    }
  }
  return at;
}

function _ours_rows(grp, ks) {
  let rows = _ours.get(grp);
  if (rows === undefined) {
    rows = ks.map((k) => {
      const row = new Array(100).fill(0);
      for (let v = 1; v <= 99; v++) row[v] = _stored(v, grp, k);
      return row;
    });
    _ours.set(grp, rows);
  }
  return rows;
}

function _tenth_rows(grp, ks) {
  let rows = _tenths.get(grp);
  if (rows === undefined) {
    rows = ks.map((k) => {
      const row = new Array(100).fill(0);
      for (let v = 1; v <= 99; v++) row[v] = game_scale._base_tenth(v, grp, k);
      return row;
    });
    _tenths.set(grp, rows);
  }
  return rows;
}

export function stored(named, source_position) {
  // A player's ratings from the file as a career's league keeps them: the stored skills, a list in
  // game_scale.keys() order, for the position his ratings are for.
  const ks = game_scale.keys(), rows = _ours_rows(game_scale.group(source_position), ks);
  const whole = _whole(named, ks);
  return ks.map((k, i) => rows[i][whole[k]]);
}

export function labeled(skills, source_position) {
  // The other way: stored skills (a list in game_scale.keys() order) as the file names them, on the shown scale.
  const ks = game_scale.keys(), grp = game_scale.group(source_position), out = {};
  for (let i = 0; i < ks.length; i++) out[ks[i]] = i < skills.length ? shown.skill(skills[i], grp, ks[i]) : rosters.MISSING;
  return out;
}

// ----- one card attribute, kept: most are one rating through one line, asked for thousands of times -----------------

const _attr_cache = new Map();          // "card scale group|whose numbers" -> card attribute -> the answers, by the ratings it reads
const _NONE = -1;                        // (an attribute with nothing to read: kept as this, never as a hole)

function _attribute(kept, scale_group, key, base, named, exact) {
  // Card attribute `key` on the house scale (build_teams.house_attributes_of's line, ratings.js raw_attributes's
  // rounding). `kept`: the answers so far. `exact`: an attribute that is one rating is the house value the page shows
  // as that rating's own number in the file (shown.attribute), the nearest such when rounding leaves it a point off.
  const f = rv2.ATTRIBUTES[key][3];
  const src = f.sources;
  let at = 0;                            // the ratings it reads, as one number (each is 1-99)
  for (let i = 0; i < src.length; i++) at = at * 100 + named[src[i]];
  let row = kept[key];
  if (row === undefined) row = kept[key] = new Map();
  let out = row.get(at);
  if (out !== undefined) return out;
  let v = f(base);
  out = _NONE;
  if (v !== null) {
    v = round(v, 1);
    const [m, hi, lo] = get(build_teams.ATTR_SCALE, `${scale_group}|${key}`, [v, 1.5, 0.9]);
    out = build_teams.clamp_rating(50 + (v - m) * (v >= m ? hi : lo));
    if (exact && src.length === 1) {
      const want = named[src[0]];
      search: for (let d = 0; d <= rosters.NEAR; d++) {
        for (const o of d ? [out + d, out - d] : [out]) {
          if (o >= 1 && o <= 99 && shown.attribute(o, scale_group, key) === want) { out = o; break search; }
        }
      }
    }
  }
  row.set(at, out);
  return out;
}

function _card(position, role, whose, base, named, exact) {
  // His card's attributes: his position's set (ratings.js POSITION_ATTRIBUTES), each on the house scale. `whose`:
  // which numbers `named` holds (the answers are kept by them).
  const group = rv2.card_group(position, role);
  const scale_group = group === "FB" ? "RB" : group;
  const at = `${scale_group}|${whose}`;
  let kept = _attr_cache.get(at);
  if (kept === undefined) _attr_cache.set(at, kept = {});
  const out = {};
  for (const key of (Object.hasOwn(rv2.POSITION_ATTRIBUTES, group) ? rv2.POSITION_ATTRIBUTES[group] : rv2.PHYSICAL)) {
    const v = _attribute(kept, scale_group, key, base, named, exact);
    if (v !== _NONE) out[key] = v;
  }
  return out;
}

function _overall(source_position, grp, skills, ks) {
  // Our overall at the position his ratings are for: game_scale.overall's own sum on his stored skills, on the card
  // it reads (prospects._card), without working that card out again from nothing.
  const ours = {}, base = {}, rows = _tenth_rows(grp, ks);
  for (let i = 0; i < ks.length; i++) {
    ours[ks[i]] = skills[i];
    base[ks[i]] = rows[i][skills[i]];
  }
  const f = game_scale.card_formula(source_position);
  if (!f) return game_scale.legacy_overall(ours, source_position) || 1;
  const pos = prospects.engine_position({ ea_position: f["pos"], position: f["pos"] });
  const card = _card(pos, pos, `stored ${grp}`, base, ours, false);
  return int(round(Math.max(1, Math.min(99, f["const"] + sum(Object.entries(f["w"]).map(([k, w]) => w * get(card, k, 50)))))));
}

export function shown_attribute(p, key, value) {
  // What the page shows for card attribute `key` of a player read from the roster file, while the card still holds
  // the value the file gave it: the file's own number for an attribute that is one rating (the kept card scale cannot
  // say every number: a receiver's Speed of 50 is below the lowest his card's scale reaches). null otherwise (the
  // caller shows the kept value as ever): a blend of ratings, a value changed since, a player not from the file.
  const filed = get(p, "filed");
  if (!truthy(filed) || !Object.hasOwn(rv2.ATTRIBUTES, key)) return null;
  const src = rv2.ATTRIBUTES[key][3].sources;
  if (src.length !== 1 || !isNumber(filed[src[0]])) return null;
  const group = rv2.card_group(p["position"], get(p, "role"));
  const scale_group = group === "FB" ? "RB" : group;
  const at = `${scale_group}|file`;
  let kept = _attr_cache.get(at);
  if (kept === undefined) _attr_cache.set(at, kept = {});
  if (!Object.keys(build_teams.ATTR_SCALE).length) Object.assign(build_teams.ATTR_SCALE, game_scale.card_scale());
  const base = { [src[0]]: _base_of()[filed[src[0]]] };
  return _attribute(kept, scale_group, key, base, filed, true) === value ? filed[src[0]] : null;
}

export function shown_skill(p, key, value) {
  // The same for one of his ratings in the list of them all: the file's number while his kept skill is still the one
  // the file gave him. null otherwise.
  const filed = get(p, "filed");
  if (!truthy(filed) || !isNumber(filed[key])) return null;
  const ks = game_scale.keys(), i = ks.indexOf(key);
  if (i < 0) return null;
  return _ours_rows(game_scale.group(p["source_position"]), ks)[i][filed[key]] === value ? filed[key] : null;
}

function _means(data) {
  // The starter means the engine's numbers are centred on: the file's own (the real 2026 rosters'), else the frozen ones.
  const m = get(data, "starter_means_before_normalization");
  return truthy(m) ? m : game_scale.engine_means();
}

function _whole(named, ks) {
  // A player's ratings as the file has them, each a whole number 1-99 (one typed as 61.5 or 140, or left out, is
  // put right; the file's own object when there is nothing to put right).
  let ok = true;
  for (let i = 0; i < ks.length && ok; i++) {
    const v = named[ks[i]];
    ok = Number.isInteger(v) && v >= 1 && v <= 99;
  }
  if (ok) return named;
  const out = {};
  for (const k of ks) {
    const v = named[k];
    out[k] = isNumber(v) ? Math.max(1, Math.min(99, int(round(v)))) : rosters.MISSING;
  }
  return out;
}

function _mapped(p, named, ks) {
  // Player `p` with ratings `named` through the build's own map (build_teams.map_player), his engine attributes still
  // on the source scale: [the mapped player, his ratings on the source scale, the scale group they are for].
  const grp = game_scale.group(p["source_position"]);
  const base = {}, skills = new Array(ks.length), bases = _base_of(), rows = _ours_rows(grp, ks);
  for (let i = 0; i < ks.length; i++) {
    const v = named[ks[i]];
    base[ks[i]] = bases[v];
    skills[i] = rows[i][v];
  }
  const m = build_teams.map_player({ name: p["name"], slug: p["slug"], position: p["source_position"], ratings: base, ovr: 0,
    "class": get(p, "class"), height: get(p, "height"), weight_lbs: get(p, "weight"), jersey: get(p, "jersey"),
    dev_trait: get(p, "dev_trait") }, p["position"]);
  delete m["overall"];
  m["skills"] = skills;                                       // (the core-skill floor asks them: build_teams.established)
  return [m, base, grp];
}

function _onto_engine(players, shift, means) {
  // Mapped players onto the engine's scale, as the build does it: centred on the starter means and held inside
  // sensible bounds (build_teams.normalize), then the team's level shift (build_teams.team_level's last step).
  build_teams.normalize([{ players: players }], means);
  if (!shift) return;
  for (const m of players) {
    for (const a of build_teams.ATTRS) if (isNumber(get(m, a))) m[a] = build_teams.clamp_rating(m[a] + shift);
  }
}

export function engine_attributes(p, named, shift, means) {
  // What the play engine reads for one player `p` with ratings `named` (his team's level shift `shift`).
  const m = _mapped(p, _whole(named, game_scale.keys()), game_scale.keys())[0];
  _onto_engine([m], shift, means);
  return m;
}

export function derive_team(t, means) {
  // Every player of one team from the file, as the game reads him (in place: `offense` and `defense` are replaced).
  const shift = get(t, "level_shift") || 0;
  const made = [], ks = game_scale.keys();
  for (const unit of ["offense", "defense"]) {
    const stats_keys = unit === "offense" ? build_teams.OFF_STATS.concat(build_teams.SHARED_STATS)
      : build_teams.DEF_STATS.concat(build_teams.SHARED_STATS);
    t[unit] = (get(t, unit) || []).map((p) => {
      if (!truthy(get(p, "ratings"))) return p;              // already worked out
      const named = _whole(p["ratings"], ks);
      const [m, base, grp] = _mapped(p, named, ks);
      const skills = m["skills"];
      delete m["skills"];
      m["ovr"] = _overall(p["source_position"], grp, skills, ks);
      m["role"] = get(p, "role");
      m["depth"] = get(p, "depth");
      m["skills"] = skills;
      // (a key the file leaves out stays out, as every reader that gives one a default expects)
      for (const k of ["height_in", "traits", "archetype"]) if (p[k] !== undefined) m[k] = p[k];
      m["attributes"] = _card(m["position"], m["role"], "file", base, named, true);
      for (const k of ["target_mult", "order", "added"]) if (p[k] !== undefined) m[k] = p[k];
      m["filed"] = named;                                    // his ratings as the file has them: what the page shows (shown_attribute, shown_skill)
      m["_src"] = { ratings: base };
      m["_stats"] = stats_keys;
      m["_in_game"] = truthy(get(p, "in_game"));
      made.push(m);
      return m;
    });
  }
  _onto_engine(made, shift, means);
  // what he would be at every position (the build's own pass: it reads each player's source-scale ratings)
  build_teams.ratings_at_every_position([{ players: made, level_shift: shift }], means);
  for (const m of made) {
    m["in_game"] = m["_in_game"];
    m["fatigue"] = 0;
    m["stats"] = {};
    for (const k of m["_stats"]) m["stats"][k] = 0;
    delete m["_in_game"];
    delete m["_stats"];
  }
  return t;
}

export function derive(data) {
  // A roster file's data as the game reads it (in place). A file of another format is returned as it is.
  if (get(data, "format") !== rosters.FORMAT) return data;
  if (!Object.keys(build_teams.ATTR_SCALE).length) Object.assign(build_teams.ATTR_SCALE, game_scale.card_scale());
  const means = _means(data);
  for (const t of Object.values(get(data, "teams") || {})) derive_team(t, means);
  return data;
}

// the file as last read and worked out, kept as text: every reader gets a copy of its own (each changes its teams)
const _kept = { path: null, raw: null, text: null };

export function read(path = rosters.FILE) {
  // A teams file's data, worked out when it is the roster file: a new object each time.
  const raw = read_text(path);
  if (_kept.path === path && _kept.raw === raw) return JSON.parse(_kept.text);
  const data = JSON.parse(raw);
  if (get(data, "format") !== rosters.FORMAT) return data;
  derive(data);
  Object.assign(_kept, { path: path, raw: raw, text: JSON.stringify(data) });
  return data;
}

const _one = { path: null, raw: null, data: null };

export function shared(path = rosters.FILE) {
  // The same data for readers that only read it (the games: files.js read_json's place): one object, kept. A teams
  // file that is not the roster file is files.js's own parsed copy, as before.
  const plain = read_json(path);
  if (get(plain, "format") !== rosters.FORMAT) return plain;
  const raw = read_text(path);
  if (_one.path !== path || _one.raw !== raw) Object.assign(_one, { path: path, raw: raw, data: read(path) });
  return _one.data;
}

export function forget() {
  Object.assign(_kept, { path: null, raw: null, text: null });
  Object.assign(_one, { path: null, raw: null, data: null });
  _attr_cache.clear();
  _ours.clear();
  _tenths.clear();
  _bases = null;
}

export function stored_ratings(path = rosters.FILE) {
  // team slug -> player slug -> his stored skills as a list in game_scale.keys() order, from the file's ratings
  // (nothing else worked out): what a career's league takes.
  const out = {};
  const data = JSON.parse(read_text(path));
  for (const [slug, t] of Object.entries(get(data, "teams") || {})) {
    const by = out[slug] = {};
    for (const p of [...(get(t, "offense") || []), ...(get(t, "defense") || [])]) {
      if (!truthy(get(p, "slug"))) continue;
      if (truthy(get(p, "ratings")) && !Array.isArray(p["ratings"])) by[p["slug"]] = stored(p["ratings"], p["source_position"]);
      else if (Array.isArray(get(p, "skills"))) by[p["slug"]] = p["skills"];
    }
  }
  return out;
}

export const rosters = { FILE, FORMAT, MISSING, NEAR, stored, labeled, shown_attribute, shown_skill, engine_attributes, derive_team, derive,
  read, shared, forget, stored_ratings };

modules.rosters = rosters;
