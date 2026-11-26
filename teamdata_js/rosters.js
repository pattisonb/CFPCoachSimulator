// The roster file as the game reads it (data/engine_teams.json): the one place a real player's ratings live.
//
// Each player in the file has one set of ratings, by the names his card prints ("Top Speed": 88, "Arm Strength": 92,
// "Pocket Poise": 82: `names_for`), card numbers (the average player about a 70, the best in the 90s). The name in the file is the name on his card and the number in the file is the
// number on his card (the player's rule: find the player, find the rating as the card says it, change it, and the
// card shows it). Nothing else about how good he is is stored. Everything the game plays
// and keeps is worked out from that one set when the file is read: the numbers the play engine reads (speed, passing,
// hands...), his card's attributes, his overall, what he would be at every other position, and his ratings as a
// career's league keeps them. So a rating changed in the file by hand is his rating everywhere (the player's rule),
// in the first season as in every later one.
//
// It is worked out with the build's own formulas (teamdata_js/build_teams.js, as a career's later seasons work their
// teams out): the engine reads card points over the average starter at his position (frozen card numbers), with the
// team's stored `level_shift` (card points). A team's depth chart, its starters (`in_game`), its tendencies and its
// coaches are stored as they are and read as they are.
//
// A teams file whose players already carry those numbers (a career's later season, data/leagues/) has no "format"
// and is read as it is.
import { round, int, sum, get, isNumber, truthy } from "../engine_js/pyrt.js";
import { read_text, read_json } from "../engine_js/files.js";
import { modules } from "../engine_js/modules.js";
import { game_scale } from "./game_scale.js";
import { ratings as rv2 } from "./ratings.js";
import { build_teams } from "./build_teams.js";
import { prospects } from "../career_js/prospects.js";

const FILE = "data/engine_teams.json";
const FORMAT = 3;            // the roster file's format: one set of ratings a player, by the names his card prints, and nothing worked out
const MISSING = 60;          // a rating the file leaves out (on the shown scale)

// ----- the names: a rating in the file is called what the player's card calls it ---------------------------------------
//
// The game keeps 54 skills (game_scale.keys()). A card attribute that is one skill gives the skill its name in the
// file ("Top Speed" is speed, "Pocket Poise" is throw_under_pressure); where two cards name one skill differently the
// player's own card decides (a corner's catching is "Ball Skills", a receiver's "Hands"; a punter's leg is "Punt
// Power"). Every skill is a rating of its own, on its own name: none is two together, in the file or on a card (the
// player's rule: 54 skills, 54 ratings). A skill no card shows goes by its own name ("Run Block").
// A quarterback's Decision Making is a rating of the file too (OWN: no skill is it; the card and the sim once worked
// it out from two others, and the player's rule is that every rating a card prints is one that is stored and played).

const BLENDS = {};                       // none: a card attribute is one skill (it once held three that were two skills together)
const OWN = ["decision_making"];         // card attributes stored under their own name with no skill behind them
const _names = new Map();                // card group -> [[name in the file, [the skills it is]], ...], the card's own ratings first

const _title = (key) => key.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

export function names_for(position, role = null) {
  // Every rating of a player at engine position `position` (depth-chart role `role`), as the file names it and the
  // skills each is: [[name, [skill, ...]], ...]. His card's ratings first, in the card's order, then the rest by name.
  const group = rv2.card_group(position, role);
  let out = _names.get(group);
  if (out !== undefined) return out;
  const card = Object.hasOwn(rv2.POSITION_ATTRIBUTES, group) ? rv2.POSITION_ATTRIBUTES[group] : rv2.PHYSICAL;
  const blended = {};
  for (const [attr, skills] of Object.entries(BLENDS)) for (const s of skills) blended[s] = attr;
  const of_skill = {};                   // skill -> the card attribute that names it for this player
  for (const attr of [...card, ...Object.keys(rv2.ATTRIBUTES)]) {
    const src = rv2.ATTRIBUTES[attr][3].sources;
    if (Object.hasOwn(BLENDS, attr)) { for (const s of BLENDS[attr]) if (!(s in of_skill)) of_skill[s] = attr; continue; }
    if (src.length === 1 && !(src[0] in of_skill) && !(src[0] in blended)) of_skill[src[0]] = attr;
  }
  const by_name = new Map();
  for (const k of game_scale.keys()) {
    const name = k in of_skill ? rv2.ATTRIBUTES[of_skill[k]][0] : _title(k);
    if (!by_name.has(name)) by_name.set(name, []);
    by_name.get(name).push(k);
  }
  for (const attr of OWN) if (card.includes(attr)) by_name.set(rv2.ATTRIBUTES[attr][0], []);
  const first = card.map((a) => rv2.ATTRIBUTES[a][0]).filter((n) => by_name.has(n));
  const rest = [...by_name.keys()].filter((n) => !first.includes(n)).sort();
  out = [...new Set([...first, ...rest])].map((n) => [n, by_name.get(n)]);
  _names.set(group, out);
  return out;
}

export function skills_of(p) {
  // A file player's ratings by skill (game_scale.keys()), from the names his line carries: each a whole number 1-99
  // (one typed as 61.5 or 140 is put right; one left out is MISSING).
  const filed = get(p, "ratings") || {}, out = {};
  for (const [name, skills] of names_for(p["position"], get(p, "role"))) {
    const v = filed[name];
    const whole = Number.isInteger(v) && v >= 1 && v <= 99 ? v : isNumber(v) ? Math.max(1, Math.min(99, int(round(v)))) : rosters.MISSING;
    for (const s of skills) out[s] = whole;
  }
  return out;
}

export function file_ratings(by_skill, position, role = null, own = {}) {
  // The other way: ratings by skill as a player's line carries them, by the names his card prints (a rating that is
  // two skills together is their mean; one with no skill behind it is `own`'s, by its card name).
  const out = {};
  for (const [name, skills] of names_for(position, role)) {
    out[name] = skills.length ? int(round(sum(skills.map((s) => get(by_skill, s, rosters.MISSING))) / skills.length)) : get(own, name);
  }
  return out;
}

export function decision_of(p) {
  // A file quarterback's Decision Making as his line has it (a whole number 1-99), or null: a player with none on his
  // card, or a line that leaves it out. It is a rating of its own: the card shows it and the sim plays it, and
  // nothing of his Football IQ or his Pocket Poise is in it.
  const want = get(get(p, "ratings") || {}, rv2.ATTRIBUTES["decision_making"][0]);
  if (!isNumber(want) || rv2.card_group(p["position"], get(p, "role")) !== "QB") return null;
  return Math.max(1, Math.min(99, int(round(want))));
}

export function stored(named, source_position = null) {
  // A player's ratings (by skill: skills_of) as a career's league keeps them: a list in game_scale.keys() order, each
  // the file's own number.
  const ks = game_scale.keys(), whole = _whole(named, ks);
  return ks.map((k) => whole[k]);
}

export function labeled(skills, source_position = null) {
  // The other way: a league's list (game_scale.keys() order) by skill.
  const ks = game_scale.keys(), out = {};
  for (let i = 0; i < ks.length; i++) out[ks[i]] = i < skills.length ? skills[i] : rosters.MISSING;
  return out;
}

// ----- his card's attributes: each is one of his ratings (ratings.js), put against his card group's average starters --

function _card(position, role, named, own = null) {
  // His card's attributes in card numbers (his position's set, ratings.js POSITION_ATTRIBUTES), from his ratings
  // `named`; his own Decision Making when he has one.
  const group = rv2.card_group(position, role);
  const out = {};
  for (const key of (Object.hasOwn(rv2.POSITION_ATTRIBUTES, group) ? rv2.POSITION_ATTRIBUTES[group] : rv2.PHYSICAL)) {
    out[key] = game_scale.card_value(named, key, own);
  }
  return out;
}

function _overall(source_position, skills, ks, own = null) {
  // His overall at the position his ratings are for (game_scale.overall) from a league's list of them.
  const card = {};
  for (let i = 0; i < ks.length; i++) card[ks[i]] = skills[i];
  return game_scale.overall(card, source_position, own);
}

export function overall(skills, source_position, own = null) {
  // His overall from a league's list of his ratings (game_scale.keys() order) at the position they are for.
  const ks = game_scale.keys();
  return _overall(source_position, ks.map((k, i) => (Number.isInteger(skills[i]) && skills[i] >= 1 && skills[i] <= 99 ? skills[i] : rosters.MISSING)), ks, own);
}

function _means(data) {
  // The averages the engine reads a player against: a teams file's own, else the frozen ones (card numbers).
  const m = get(data, "starter_means");
  return truthy(m) ? m : game_scale.starter_means();
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
  // card numbers: [the mapped player, his ratings by skill].
  const skills = ks.map((k) => named[k]);
  const m = build_teams.map_player({ name: p["name"], slug: p["slug"], position: p["source_position"], ratings: named, ovr: 0,
    "class": get(p, "class"), height: get(p, "height"), weight_lbs: get(p, "weight"), jersey: get(p, "jersey"),
    dev_trait: get(p, "dev_trait"), dmv: decision_of(p) }, p["position"]);
  delete m["overall"];
  m["skills"] = skills;                                       // (the core-skill floor asks them: build_teams.established)
  return [m, named];
}

function _onto_engine(players, shift, means) {
  // Mapped players as the engine reads them, as the build does it: against their positions' average starters and held
  // inside sensible bounds (build_teams.normalize), then the team's level shift (build_teams.team_level's last step).
  build_teams.normalize([{ players: players }], means);
  if (!shift) return;
  for (const m of players) {
    for (const a of build_teams.ATTRS) if (isNumber(get(m, a))) m[a] = round(m[a] + shift, 1);
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
      const named = skills_of(p);
      const [m] = _mapped(p, named, ks);
      const skills = m["skills"];
      delete m["skills"];
      const want = decision_of(p);                           // his own Decision Making: the file's number, played and shown
      m["ovr"] = _overall(p["source_position"], skills, ks, want);
      m["role"] = get(p, "role");
      m["depth"] = get(p, "depth");
      m["skills"] = skills;
      // (a key the file leaves out stays out, as every reader that gives one a default expects)
      for (const k of ["height_in", "traits", "archetype"]) if (p[k] !== undefined) m[k] = p[k];
      m["_attr_raw"] = _card(m["position"], m["role"], named, want);
      m["attributes"] = build_teams.attributes_of(m);
      delete m["_attr_raw"];
      if (want !== null) m["dmv"] = want;
      for (const k of ["target_mult", "order", "added"]) if (p[k] !== undefined) m[k] = p[k];
      m["_stats"] = stats_keys;
      m["_in_game"] = truthy(get(p, "in_game"));
      made.push(m);
      return m;
    });
  }
  _onto_engine(made, shift, means);
  // his overall at every position (the build's own pass)
  build_teams.ratings_at_every_position([{ players: made, level_shift: shift }]);
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

const _one = { path: null, data: null };
const _is_roster = new Map();            // path -> whether the file there is the roster file (asked of the file once)
const _FORMAT_AT_START = /^\s*\{\s*"format"\s*:\s*(\d+)\b/;

export function shared(path = rosters.FILE) {
  // The same data for readers that only read it (the games: files.js read_json's place): one object, kept until
  // `forget`. A teams file that is not the roster file (a career's later season) is files.js's own parsed copy, as
  // before. The file itself is read once: a game asks this for every game it plays.
  if (_one.path === path) return _one.data;
  let roster = _is_roster.get(path);
  if (roster === undefined) {
    const m = _FORMAT_AT_START.exec(read_text(path).slice(0, 80));
    roster = m !== null && Number(m[1]) === rosters.FORMAT;
    _is_roster.set(path, roster);
  }
  if (!roster) return read_json(path);
  Object.assign(_one, { path: path, data: read(path) });
  return _one.data;
}

export function loaded(path = rosters.FILE) {
  // The kept copy when the game has already read the roster file (shared), else null: for a reader that can do
  // without it.
  return _one.path === path ? _one.data : null;
}

export function forget() {
  Object.assign(_kept, { path: null, raw: null, text: null });
  Object.assign(_one, { path: null, data: null });
  _is_roster.clear();
  _names.clear();
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
      if (truthy(get(p, "ratings")) && !Array.isArray(p["ratings"])) by[p["slug"]] = stored(skills_of(p), p["source_position"]);
      else if (Array.isArray(get(p, "skills"))) by[p["slug"]] = p["skills"];
    }
  }
  return out;
}

export const rosters = { FILE, FORMAT, MISSING, BLENDS, OWN, names_for, skills_of, file_ratings, decision_of, stored, labeled, overall, engine_attributes, derive_team, derive,
  read, shared, loaded, forget, stored_ratings };

modules.rosters = rosters;
