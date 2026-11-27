// Swap every real name in a staged copy of the project for a lookalike, so the published site carries none.
//
//     scrub.run(root)      // `root`: a copy made by tools/build_site.mjs (never the repository itself)
//
// What changes (tables.mjs holds the hand-written names):
//   - schools: full name, mascot, stadium, colors where the shade or its name is a school's own; and the short name,
//     abbreviation and the slug the address bar shows, except that a school named for its state or city keeps that
//     place name (tables.PLACES)
//   - players and coaches: a drawn name with the same initials ("Julian Sayin" may become "Jalen Shaw"), the same
//     for every build (seeded by the real name), and their slugs with it
//   - bowls, conferences, rivalry games and trophies, FCS opponents, awards, leagues and networks
//   - fields that only cite the real world (source links, notes) are dropped
//
// How: the name-bearing data files are edited by field first, then every string in every staged file (JSON keys and
// values, the game's source and the app's) goes through one swap: a whole-string lookup, then a whole-word phrase
// pattern, longest phrase first. `terms(root)` lists the real names a build must not contain
// (tests/test_generic_names.mjs).
//
// A dict is an object without a prototype, its keys in the order they were added (pyio.mjs); a set is a Set.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { Random } from "../../engine_js/pyrt.js";
import {
  PY_SPACE, any_upper, cmp_text, dict, first, get, is_dict, is_file, isalpha, len, longest_first, parts_of, read_json,
  read_text, re_escape, rglob, sorted_text, split, stem, strip, suffix, truthy, write_json, write_text,
} from "./pyio.mjs";
import { tables } from "./tables.mjs";

export const SUFFIXES = new Set(["Jr.", "Jr", "Sr.", "Sr", "II", "III", "IV", "V"]);
export const DONE = "\x00";     // marks a string a field edit already wrote: the swap passes it through (and takes the mark off)
export const GENERIC_STADIUMS = new Set(["Memorial Stadium", "Alumni Stadium", "University Stadium", "Tiger Stadium", "Rose Bowl",
  "Veterans Memorial Stadium", "War Memorial Stadium", "Williams Stadium", "Delaware Stadium"]);
export const DROP_KEYS = new Set(["verification", "url", "sources", "article", "notes"]);     // fields that only cite the real world

/** A table's entry (tables.mjs holds plain objects): its value, or `fallback` when the key is not one of its own. */
const table = (t, k, fallback = null) => (typeof k === "string" && Object.hasOwn(t, k) ? t[k] : fallback);

export function slugify(name) {
  const s = name.toLowerCase().replaceAll("'", "").replaceAll(".", "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || "x";
}

export function _seed(...parts) {
  return new Random(createHash("sha256").update(parts.join("|"), "utf8").digest("hex"));
}

export function _read(file) {
  return read_json(file);
}

export function _write(file, data) {
  write_json(file, data);
}

// ---- people ---------------------------------------------------------------------------------------------------

/** Draws a lookalike for a real person's name: same initials, seeded by the real name, never a real name. */
export class Names {
  constructor(root, real, blocked) {
    const pools = _read(path.join(root, "data", "recruiting_model.json"))["players"]["names"];
    this.pool = { first: dict(), last: dict() };
    for (const kind of ["first", "last"]) {
      for (const [name, count] of pools[kind]) {
        if (truthy(name) && isalpha(name) && count >= 3 && !blocked.has(name)) {
          const letter = first(name).toUpperCase();
          (this.pool[kind][letter] ??= []).push(name);
        }
      }
      for (const [letter, spare] of Object.entries(tables.SPARE_NAMES[kind])) {
        (this.pool[kind][letter] ??= []).push(...spare);
      }
    }
    this.real = new Set(Array.from(real, (n) => Names._base(n)));       // without "Jr." and the like: "Duke Watson II" is Duke Watson
    this.made = dict();
    this.taken = new Set();
  }

  static _base(name) {
    const [first_name, last] = Names._parts(name);
    return strip(`${first_name} ${last}`);
  }

  static _parts(name) {
    const words = split(name.replaceAll(",", " "));
    let suffix_word = "";
    while (words.length > 1 && SUFFIXES.has(words[words.length - 1])) suffix_word = words.pop();
    return [words[0], words.length > 1 ? words[words.length - 1] : "", suffix_word];
  }

  _pick(kind, word, rng) {
    let letter = "A";
    for (const ch of word) {
      if (isalpha(ch)) { letter = ch.toUpperCase(); break; }
    }
    const listed = this.pool[kind][letter];
    const pool = listed !== undefined && listed.length ? listed : this.pool[kind]["A"];
    const low = word.toLowerCase();
    const others = pool.filter((n) => n.toLowerCase() !== low);
    return rng.choice(others.length ? others : pool);
  }

  of(name) {
    if (name in this.made) return this.made[name];
    const [first_name, last, suffix_word] = Names._parts(name);
    let made;
    for (let attempt = 0; attempt < 200; attempt++) {
      const rng = _seed("person", name, String(attempt));
      made = this._pick("first", first_name, rng);
      if (last) made += " " + this._pick("last", last, rng);
      const base = made;
      if (suffix_word) made += " " + suffix_word;
      if (!this.real.has(base) && !this.taken.has(made)) break;
    }
    this.taken.add(made);
    this.made[name] = made;
    return made;
  }
}

// ---- the maps -------------------------------------------------------------------------------------------------

const _STATE_VALUE = new RegExp(`[A-Z]{2}["']?:[${PY_SPACE}]*$`, "u");      // what stands before a state's name in a list of states
const _QUOTED = /(["'`])((?:(?!\1)[^\\\n]){1,80})\1/gu;

/** Every swap a build makes, read from the staged project before anything is changed. */
export class Maps {
  constructor(root) {
    this.root = root;
    // every team as it is known (data/base_meta.json: its identity) with its people from the roster file (its
    // coaches, and its players as {slug, name}): `meta` is the identity file itself, edited in place by _fields
    this.meta = _read(path.join(root, "data", "base_meta.json"));
    const filed = get(_read(path.join(root, "data", "engine_teams.json")), "teams") || {};
    this.teams = dict(sorted_text(Object.keys(this.meta)).map((slug) => {
      const f = get(filed, slug) || {};
      return [slug, { ...this.meta[slug], coaches: get(f, "coaches") || {},
        roster: [...(get(f, "offense") || []), ...(get(f, "defense") || [])].map((p) => ({ slug: p["slug"], name: p["name"] })) }];
    }));
    this.real_teams = dict(Object.entries(this.teams).filter(([, t]) => !truthy(get(t, "fictional"))));
    const real_teams = Object.values(this.real_teams);
    const missing = sorted_text(Object.keys(this.real_teams).filter((s) => !Object.hasOwn(tables.TEAMS, s)));
    if (missing.length) throw new Error(`tools/generic/tables.mjs TEAMS has no lookalike for: ${missing.join(", ")}`);
    const sched = _read(path.join(root, "data", "schedules.json"));
    this.espn_names = dict(Object.entries(sched["teams"]).map(([s, v]) => [s, get(v, "espn_name") || ""]));

    this.team = dict();      // slug -> the lookalike identity
    for (const [slug, t] of Object.entries(this.real_teams)) {
      const [new_short, abbr, mascot] = tables.TEAMS[slug];
      this.team[slug] = {
        slug: table(tables.SLUGS, slug) || slugify(new_short), short: new_short, abbr,
        school: this._school(new_short), mascot,
        stadium: this._stadium(slug, t, mascot),
      };
    }
    const new_slugs = Object.values(this.team).map((v) => v.slug);
    if (new Set(new_slugs).size !== new_slugs.length) throw new Error("two schools share a lookalike slug");
    this.slug = dict(Object.entries(this.team).filter(([s, v]) => v.slug !== s).map(([s, v]) => [s, v.slug]));

    // people
    const players = dict();         // real slug -> real name
    let coaches = new Set();
    for (const t of real_teams) {
      for (const p of get(t, "roster", [])) players[p["slug"]] = p["name"];
      for (const c of Object.values(get(t, "coaches") || {})) {
        if (truthy(c) && truthy(get(c, "name"))) coaches.add(c["name"]);
        if (truthy(c) && truthy(get(c, "co_coordinator"))) coaches.add(c["co_coordinator"]);
      }
    }
    // the players the roster file has that no source roster does (real players added to it from real usage, their ids
    // "real-" and the name): each is a person. They were in no map, so their real names reached a generic build
    // untouched
    const roster_file = path.join(root, "data", "engine_teams.json");
    if (is_file(roster_file)) {
      for (const t of Object.values(get(_read(roster_file), "teams") || {})) {
        for (const p of [...(get(t, "offense") || []), ...(get(t, "defense") || [])]) {
          if (truthy(get(p, "slug")) && truthy(get(p, "name")) && !(p["slug"] in players)) players[p["slug"]] = p["name"];
        }
        for (const c of Object.values(get(t, "coaches") || {})) if (truthy(get(c, "name"))) coaches.add(c["name"]);   // its staff
      }
    }
    for (const c of Object.keys(get(_read(path.join(root, "data", "coach_birth_years.json")), "birth_years", {}))) coaches.add(c);
    const model = _read(path.join(root, "data", "recruiting_model.json"));
    for (const v of Object.values(get(get(model, "coaches", {}), "current", {}))) {
      if (truthy(get(v, "coach"))) coaches.add(v["coach"]);
    }
    coaches = new Set([...coaches].filter((c) => truthy(c) && c.includes(" ")));
    this.real_people = new Set([...Object.values(players), ...coaches]);
    const blocked = new Set([...Object.keys(tables.MARKS), ...tables.DISTINCT_MASCOTS, ...real_teams.map((t) => t["short_name"])]);
    const names = new Names(root, this.real_people, blocked);
    this.person = dict();
    for (const n of sorted_text(this.real_people)) this.person[n] = names.of(n);
    this.coaches = coaches;
    this.player_slug = dict();
    const used = new Set();
    for (const slug of sorted_text(Object.keys(players))) {
      const base = slugify(this.person[players[slug]]);
      let made = base, n = 2;
      while (used.has(made) || made in players) {
        made = `${base}-${n}`;
        n += 1;
      }
      used.add(made);
      this.player_slug[slug] = made;
    }

    this.fcs = this._fcs(sched);

    // whole strings, swapped only when a string is exactly this
    this.exact = dict();
    Object.assign(this.exact, this.person, this.player_slug, this.slug, tables.CONFERENCES_EXACT);
    this.team_exact = dict(Object.entries(this.real_teams).map(([s, t]) => [t["short_name"], this.team[s].short]));
    for (const [old, made] of Object.entries(this.team_exact)) {
      if (tables.LOOSE.has(old)) this.exact[old] = made;
    }
    // phrases, swapped wherever they stand as whole words
    const ph = dict();
    Object.assign(ph, tables.MARKS, tables.CONFERENCES, tables.BOWLS);
    const plain_rivalries = ["The Game", "Big Game", "Border War", "Holy War"];
    for (const [k, v] of Object.entries(tables.RIVALRIES)) {
      if (split(k).length > 1 && !plain_rivalries.includes(k)) ph[k] = v;
    }
    const plain_trophies = ["The Belt", "Victory Bell", "Milk Can", "Wagon Wheel", "Golden Egg", "Golden Boot", "Golden Hat"];
    for (const [k, v] of Object.entries(tables.TROPHIES)) {
      if (!plain_trophies.includes(k)) ph[k] = v;
    }
    const stadium_count = dict();
    for (const t of real_teams) stadium_count[t["stadium"]["name"]] = get(stadium_count, t["stadium"]["name"], 0) + 1;
    for (const [slug, t] of Object.entries(this.real_teams)) {
      const made = this.team[slug];
      const full = `${made.short} ${made.mascot}`;
      ph[t["school_name"]] = made.school;
      if (t["school_name"].startsWith("The ")) ph[t["school_name"].slice(4)] = made.school;
      ph[`${t["short_name"]} ${t["mascot"]}`] = full;
      if (get(this.espn_names, slug)) ph[this.espn_names[slug]] = full;
      const stadium = t["stadium"]["name"];
      if (stadium_count[stadium] === 1 && !GENERIC_STADIUMS.has(stadium)) {
        ph[stadium] = made.stadium;
        ph[stadium.replaceAll("-", "–")] = made.stadium;
      }
      if (tables.DISTINCT_MASCOTS.has(t["mascot"])) ph[t["mascot"]] = made.mascot;
      if (tables.LOOSE.has(t["short_name"])) ph[t["short_name"]] = made.short;
    }
    for (const [old, made] of Object.entries(this.fcs_names)) ph[old] = made;
    // the FCS schools the game's own code lists by their bare name ("Duquesne"), unless that name opens a real
    // team's ("North Dakota" and North Dakota State)
    const real_names = [...real_teams.map((t) => t["short_name"]), ...real_teams.map((t) => t["school_name"])];
    const places = dict(Object.entries(this.fcs_locations).filter(([old]) => !(old in ph) && len(old) > 4
      && !real_names.some((n) => n === old || n.startsWith(old + " "))));
    // one that goes by its state alone ("Montana"): swapped only as a quoted school in the code (source()), so
    // the state keeps its name in a list of states and in a sentence
    this.fcs_places = dict(Object.entries(places).filter(([old]) => !tables.STATES.has(old)));
    this.fcs_state_places = dict(Object.entries(places).filter(([old]) => tables.STATES.has(old)));
    for (const [k, v] of Object.entries(this.fcs_places)) {
      if (k.includes(" ")) ph[k] = v;
    }
    for (const c of coaches) ph[c] = this.person[c];
    delete ph[""];
    this.phrases = ph;
    const src = dict();
    Object.assign(src, ph, this.fcs_places);
    delete src[""];
    this.source_phrases = src;
    const whole = (keys) => new RegExp(`(?<![A-Za-z0-9_])(?:${keys.map(re_escape).join("|")})(?![A-Za-z0-9_])`, "gu");
    this._source_re = whole(longest_first(Object.keys(src)));
    this._phrase_re = whole(longest_first(Object.keys(ph)));
    const slugs = longest_first(Object.keys(this.slug));
    this._slug_re = new RegExp(`(?<![a-z0-9-])(${slugs.map(re_escape).join("|")})(?=:)`, "gu");
    this._cache = new Map();
  }

  /** The full name: "<short> University", unless a real school has it (a school that goes by its place name:
   * Syracuse, Ohio); then "University of <short>", then "<short> College" (Miami, where both are real). */
  _school(short) {
    const real = Object.values(this.real_teams).map((t) => (t["school_name"].startsWith("The ") ? t["school_name"].slice(4) : t["school_name"]));
    const forms = [`${short} University`, `University of ${short}`, `${short} College`];
    const found = forms.find((f) => !real.some((r) => r.startsWith(f)));
    if (found === undefined) throw new Error(`no full name is free for ${short}`);
    return found;
  }

  _stadium(slug, t, mascot) {
    const kinds = ["{m} Stadium", "{m} Field", "{m} Memorial Stadium", "{m} Bowl"];
    const m = !mascot.endsWith("s") || mascot.endsWith("ss") ? mascot : mascot.slice(0, -1);
    const real = new Set(Object.values(this.real_teams).map((x) => x["stadium"]["name"]));
    const order = kinds.slice(0, 3);
    _seed("stadium", slug).shuffle(order);
    for (const k of order) {
      const name = k.replace("{m}", () => m);
      if (!real.has(name)) return name;
    }
    return `${m} Grounds`;
  }

  /** espn id -> {"name", "location"} for the FCS schools, drawn from the cities of each school's state. */
  _fcs(sched) {
    const fmap = _read(path.join(this.root, "data", "fcs_map.json"));
    const cities = _read(path.join(this.root, "data", "major_cities.json"));
    const real_teams = Object.values(this.real_teams);
    const sched_fcs = get(sched, "fcs", {});
    const out = dict();
    this.fcs_names = dict();
    const taken = new Set();
    const ids = sorted_text(new Set([...Object.keys(sched_fcs), ...Object.keys(fmap)]));
    this.fcs_locations = dict();
    for (const v of Object.values(sched_fcs)) {
      if (truthy(get(v, "location"))) this.fcs_locations[v["location"]] = "";
    }
    const real_places = new Set([...real_teams.map((t) => t["short_name"]), ...real_teams.map((t) => get(t, "city") || "")]);
    for (const v of Object.keys(this.fcs_locations)) for (const x of split(v)) real_places.add(x);
    const real_names = new Set([...real_teams.map((t) => t["short_name"]), ...Object.keys(this.fcs_locations)]);
    for (const i of ids) {
      const old = get(get(sched_fcs, i) || {}, "name") || get(get(fmap, i) || {}, "name") || "";
      if (old === "TBD") continue;                       // a placeholder for a game not yet announced, not a school: the word stays as it is everywhere
      const state = get(get(fmap, i) || {}, "state") || "";
      const avoid = new Set([...real_places, ...Object.keys(this.fcs_locations)]);
      const listed = get(cities, state, []);
      let places = (Array.isArray(listed) ? listed : []).filter((c) => Array.isArray(c) && !avoid.has(c[0])).map((c) => c[0]);
      if (!places.length) places = ["Riverside", "Fairview", "Lakewood"];
      let rng, location;
      for (let attempt = 0; attempt < 100; attempt++) {
        rng = _seed("fcs", String(i), old, String(attempt));
        location = rng.choice(places);
        location += rng.choice(tables.FCS_SUFFIXES);
        if (!taken.has(location) && !real_names.has(location)) break;
      }
      taken.add(location);
      const name = `${location} ${rng.choice(tables.FCS_MASCOTS)}`;
      out[i] = dict([["name", name], ["location", location]]);
      if (old) this.fcs_names[old] = name;
      const old_loc = get(get(sched_fcs, i) || {}, "location");
      if (truthy(old_loc)) this.fcs_locations[old_loc] = location;
    }
    return out;
  }

  // ---- the swap ----
  /** One string, swapped: a whole-string match first, then slugs before a colon, then phrases. */
  text(s) {
    if (s.charCodeAt(0) === 0) return s.slice(1);
    const hit = this.exact[s];
    if (hit !== undefined) return hit;
    if (s.length < 3 || (s.length < 6 && len(s) < 3)) return s;
    let out = this._cache.get(s);
    if (out === undefined) {
      out = s.replace(this._slug_re, (whole, slug) => this.slug[slug]);
      if (any_upper(out)) out = out.replace(this._phrase_re, (whole) => this.phrases[whole]);
      if (this._cache.size < 500_000) this._cache.set(s, out);
    }
    return out;
  }

  walk(node, drop = new Set(), key = null) {
    if (is_dict(node)) {
      const pairs = [];
      for (const k of Object.keys(node)) {
        if (!drop.has(k)) pairs.push([this.text(k), this.walk(node[k], drop, k)]);
      }
      return dict(pairs);
    }
    if (Array.isArray(node)) return node.map((v) => this.walk(v, drop, key));
    if (typeof node === "string") {
      if (tables.TEAM_KEYS.has(key) && node in this.team_exact) return this.team_exact[node];
      return this.text(node);
    }
    return node;
  }

  /** The game's source or the app's: quoted strings by the whole-string lookup, then phrases across the text.
   * `sample`: the app's stand-in data, where a quoted place name is a team. */
  source(code, sample = false) {
    const swapped = code.replace(_QUOTED, (whole, quote, inner, at) => {
      let hit = this.exact[inner];
      if (!hit) hit = sample ? get(this.team_exact, inner) : null;
      if (hit === null && inner in this.fcs_state_places) {
        const before = Array.from(code.slice(Math.max(0, at - 16), at)).slice(-8).join("");     // the 8 characters before
        if (!_STATE_VALUE.test(before)) hit = this.fcs_state_places[inner];      // "Montana": "MT" names the school; "MT": "Montana" the state
      }
      if (hit === null || hit.includes(quote)) return whole.replace(this._slug_re, (s, slug) => this.slug[slug]);
      return `${quote}${hit}${quote}`;
    });
    return swapped.replace(this._source_re, (whole, at, text) => (this._in_a_name(whole, at, text) ? whole : this.source_phrases[whole]));
  }

  /** An FCS school that goes by one word ("Bryant", "Howard") inside a longer name, joined to a capitalized word by a
   * space or a hyphen ("Bear Bryant", "Richter-Howard Receiver of the Year"): a person's name, kept. The school
   * itself, standing alone ("Bryant": "RI", a list of opponents), is swapped. */
  _in_a_name(whole, at, text) {
    if (whole.includes(" ") || !(whole in this.fcs_places)) return false;
    const before = text.slice(Math.max(0, at - 24), at);
    const after = text.slice(at + whole.length, at + whole.length + 24);
    return /[A-Z][A-Za-z.'"\\]*[ \-\u2013]$/u.test(before) || /^[ \-\u2013][A-Z]/u.test(after);
  }
}
Maps._STATE_VALUE = _STATE_VALUE;
Maps._QUOTED = _QUOTED;

// ---- by field -------------------------------------------------------------------------------------------------

/** A protected shade moved a hair: every channel COLOR_NUDGE toward the middle (black and white stay). */
export function _nudge(hex_color, slug) {
  const h = hex_color.replace(/^#+/, "");
  if (len(h) !== 6 || ["000000", "ffffff"].includes(h.toLowerCase())) return hex_color;
  const out = [];
  for (const i of [0, 2, 4]) {
    const v = parseInt(h.slice(i, i + 2), 16);
    out.push(Math.max(0, Math.min(255, v + (v < 128 ? tables.COLOR_NUDGE : -tables.COLOR_NUDGE))));
  }
  return "#" + out.map((v) => v.toString(16).toUpperCase().padStart(2, "0")).join("");
}

/** A coach's last job: kept when it names a school of this league, else said without the employer. */
export function _previous_job(text, m, shorts) {
  if (!truthy(text) || text === "Unverified") return text;
  text = m.text(text);
  if (shorts.some((s) => text.startsWith(s))) return text;
  const low = text.toLowerCase();
  if (low.includes("head coach")) return "Head coach elsewhere";
  if (low.includes("coordinator")) return "Coordinator elsewhere";
  return "Assistant coach elsewhere";
}

export function _coach(c, m, shorts, old_shorts) {
  if ("previous_job" in c) {
    const job = _previous_job(get(c, "previous_job"), m, shorts);
    c["previous_job"] = truthy(job) ? DONE + job : job;
  }
  if (truthy(get(c, "alma_mater"))) {
    const school = get(old_shorts, c["alma_mater"]);               // a school outside the league: left blank
    c["alma_mater"] = school ? DONE + school : null;
  }
}

/** The two short names of a rivalry's teams (the lookalike's, or the slug itself for a team outside the league). */
function _pair(m, teams) {
  const names = teams.map((s) => (s in m.team ? m.team[s].short : s));
  if (names.length !== 2) throw new Error(`a rivalry needs two teams, not ${names.length}`);
  return names;
}

/** The edits a lookup cannot make: identities, colors, stadiums, coaches' histories, bowl sites, FCS names. */
export function _fields(root, m) {
  const old_shorts = dict(Object.entries(m.team_exact));
  const shorts = longest_first(new Set(Object.values(old_shorts)));
  for (const slug of Object.keys(m.real_teams)) {
    const made = m.team[slug];
    const t = m.meta[slug];               // the team's identity, in the identity file (its coaches are in the roster file: below)
    t["short_name"] = DONE + made.short;
    t["school_name"] = DONE + made.school;
    t["mascot"] = DONE + made.mascot;
    t["stadium"]["name"] = DONE + made.stadium;
    t["abbreviation"] = DONE + made.abbr;
    if (Object.hasOwn(tables.CITIES, slug)) t["city"] = DONE + tables.CITIES[slug];
    for (const c of Object.values(t["colors"])) {
      c["name"] = table(tables.COLOR_NAMES, c["name"], c["name"]);
      if (tables.NUDGE_COLORS.has(slug)) c["hex"] = _nudge(c["hex"], slug);
    }
    // the team's preset faces follow it to its lookalike name (the keys inside, player ids and coach names, are
    // swapped with every other JSON file in run())
    const faces = path.join(root, "cfb_sim_data", "faces", `${slug}.json`);
    if (is_file(faces) && made.slug !== slug) fs.renameSync(faces, path.join(root, "cfb_sim_data", "faces", `${made.slug}.json`));
  }
  _write(path.join(root, "data", "base_meta.json"), m.meta);
  // the rosters as the game reads them (data/engine_teams.json), when the staged project carries them: each team's
  // identity there is the builder's own shape of the same fields (name, school, mascot, abbreviation, city, the
  // stadium's name, the colors as plain hex), so they take the same edits. The players' and coaches' names are
  // swapped with every other JSON file in run()
  const engine = path.join(root, "data", "engine_teams.json");
  if (is_file(engine)) {
    const doc = _read(engine);
    for (const [slug, t] of Object.entries(get(doc, "teams") || {})) {
      const made = get(m.team, slug);
      if (!truthy(made) || !(slug in m.real_teams)) continue;
      for (const c of Object.values(get(t, "coaches") || {})) {
        if (truthy(c)) _coach(c, m, shorts, old_shorts);
      }
      t["name"] = DONE + made.short;
      t["mascot"] = DONE + made.mascot;
      t["abbreviation"] = DONE + made.abbr;
      if (is_dict(get(t, "stadium"))) t["stadium"]["name"] = DONE + made.stadium;
      if (Object.hasOwn(tables.CITIES, slug)) t["city"] = DONE + tables.CITIES[slug];
      if (tables.NUDGE_COLORS.has(slug) && is_dict(get(t, "colors"))) {
        for (const [k, hex] of Object.entries(t["colors"])) {
          if (typeof hex === "string" && hex.startsWith("#")) t["colors"][k] = _nudge(hex, slug);
        }
      }
    }
    _write(engine, doc);
  }

  let file = path.join(root, "data", "rivalries.json");
  const riv = _read(file);
  const named = dict();
  for (const r of riv["rivalries"]) {
    const [a, b] = _pair(m, r["teams"]);
    const made = table(tables.RIVALRIES, r["name"]) || sorted_text([a, b]).join("-");
    named[r["name"]] = made;
    r["name"] = DONE + made;
    r["trophy"] = DONE + table(tables.TROPHIES, r["trophy"], "");
  }
  _write(file, riv);
  file = path.join(root, "data", "series.json");
  const series = _read(file);
  for (const g of get(series, "annual", [])) {
    if (truthy(get(g, "name"))) {
      const [a, b] = _pair(m, g["teams"]);
      g["name"] = DONE + (get(named, g["name"]) || table(tables.RIVALRIES, g["name"]) || sorted_text([a, b]).join("-"));
    }
  }
  _write(file, series);

  file = path.join(root, "data", "bowls.json");
  const bowls = _read(file);
  for (const g of [...get(bowls, "playoff", []), ...get(bowls, "bowls", [])]) {
    const city = strip((get(g, "location") || "").split(",")[0]) || "Neutral Site";
    const capacity = /\(([\p{Nd},]+)\)/u.exec(get(g, "stadium") || "");
    g["stadium"] = `${city} Stadium` + (capacity ? ` (${capacity[1]})` : "");
    g["site"] = strip(`${city} Stadium ${get(g, "location") || ""}`);
  }
  _write(file, bowls);

  file = path.join(root, "data", "fcs_map.json");
  const fmap = _read(file);
  for (const [i, v] of Object.entries(fmap)) {
    if (i in m.fcs) v["name"] = DONE + m.fcs[i]["name"];
  }
  _write(file, fmap);
  file = path.join(root, "data", "schedules.json");
  const sched = _read(file);
  for (const [i, v] of Object.entries(get(sched, "fcs", {}))) {
    if (i in m.fcs) {
      v["name"] = DONE + m.fcs[i]["name"];
      v["location"] = DONE + m.fcs[i]["location"];
    }
    if ("conference" in v) v["conference"] = "FCS";
  }
  for (const [slug, v] of Object.entries(sched["teams"])) {
    if (slug in m.team && "espn_name" in v) v["espn_name"] = DONE + `${m.team[slug].short} ${m.team[slug].mascot}`;
  }
  _write(file, sched);

  file = path.join(root, "data", "program_profile.json");
  const prof = _read(file);
  for (const [slug, v] of Object.entries(get(prof, "teams", {}))) {
    delete v["sources"];
    if (slug in m.team && is_dict(get(v, "facts")) && "stadium_name" in v["facts"]) {
      v["facts"]["stadium_name"] = DONE + m.team[slug].stadium;
    }
  }
  _write(file, prof);
}

export const TEXT_SUFFIXES = new Set([".py", ".ts", ".tsx", ".js", ".mjs", ".html", ".css", ".md"]);

/** Swap the names in the staged project at `root`. Returns the maps (for the build's report and the tests). */
export function run(root) {
  root = String(root);
  if (fs.existsSync(path.join(root, ".git"))) {
    throw new Error("scrub.run works on a staged copy (tools/build_site.mjs), never on the repository");
  }
  const m = new Maps(root);
  _fields(root, m);
  const root_parts = parts_of(root);
  const skipped = (f) => root_parts.includes("node_modules") || root_parts.includes("pocket-faces")
    || f.parts.includes("node_modules") || f.parts.includes("pocket-faces");
  for (const f of rglob(root)) {
    if (!f.name.endsWith(".json")) continue;
    if (skipped(f) || f.parts[0] === "ui") continue;       // the app's own files (package.json, tsconfig)
    const n = f.parts.length;
    if (n >= 3 && f.parts[n - 2] === "faces" && f.parts[n - 3] === "cfb_sim_data") {
      // a team's preset faces: only who each face belongs to is a name (a player's id, a coach's name; "coach:"
      // before a rolled coach's). The face itself is parts from the face library, and one of its hair colors
      // is spelled like a school, so the parts are never run through the swap
      const doc = _read(f.path);
      const who = (k) => (k.startsWith("coach:") ? "coach:" + m.text(k.slice(6)) : m.text(k));
      _write(f.path, dict(Object.entries(doc).map(([group, faces]) => [group,
        is_dict(faces) ? dict(Object.entries(faces).map(([k, v]) => [who(k), v])) : faces])));
      continue;
    }
    _write(f.path, m.walk(_read(f.path), DROP_KEYS));
  }
  for (const f of rglob(root)) {
    if (TEXT_SUFFIXES.has(suffix(f.name)) && !skipped(f)) {
      const old = read_text(f.path);
      const swapped = m.source(old, ["sample", "samples"].includes(stem(f.name)));
      if (swapped !== old) write_text(f.path, swapped);
    }
  }
  return m;
}

/** The real names a generic build must not contain, read from the real project at `root`:
 * {"people": full names, "phrases": schools, mascots, stadiums, bowls, conferences, marks, "slugs": ...}. */
export function terms(root) {
  const m = new Maps(String(root));
  const phrases = new Set(Object.entries(m.phrases).filter(([k, v]) => k !== v && !m.coaches.has(k)).map(([k]) => k));
  for (const [s, t] of Object.entries(m.real_teams)) {
    if (Object.hasOwn(tables.CITIES, s)) phrases.add(t["city"]);
  }
  for (const t of Object.values(m.real_teams)) phrases.add(t["school_name"]);
  for (const k of Object.keys(m.fcs_places)) {
    if (k.includes(" ")) phrases.add(k);
  }
  for (const k of ["AP", "MAC", "SEC", "ACC", "CFP", "NFL", "ESPN", "NCAA", "CUSA", "Nielsen"]) phrases.delete(k);      // checked as whole words below
  const drawn = new Set(Object.values(m.person));
  const new_slugs = new Set(Object.values(m.player_slug));
  return {
    people: new Set([...m.real_people].filter((n) => !drawn.has(n))),
    phrases,
    words: new Set(["AP", "MAC", "SEC", "ACC", "CFP", "NFL", "ESPN", "NCAA", "Heisman"]),
    slugs: new Set(Object.keys(m.slug)),
    player_slugs: new Set(Object.keys(m.player_slug).filter((s) => !new_slugs.has(s) && s.includes("-"))),
  };
}

/** The module as one object (`scrub.run`). */
export const scrub = {
  SUFFIXES, DONE, GENERIC_STADIUMS, DROP_KEYS, TEXT_SUFFIXES, slugify, _seed, _read, _write, Names, Maps,
  _nudge, _previous_job, _coach, _fields, run, terms,
};
