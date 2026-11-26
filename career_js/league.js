// A Coach Career's own league, from its second season on
// (docs/superpowers/specs/2026-10-23-career-offseason-design.md, section 2), or from its first when
// the career started from a league file (docs/superpowers/specs/2026-11-05-league-file-design.md).
//
// The first season of a career plays the real 2026 rosters (data/engine_teams.json), unless it was
// started from a league file: then `state["league"]` holds the merged, filled league from the start
// (league_fill.to_league; is_imported), built the way later seasons are (real=False, so its unchanged
// teams play without the real-2026-only adjustments), with a team's own identity in "meta"
// (team_meta), the file's depth chart as "depth" for season one only (offseason.start drops it), and
// new or moved teams' recruiting models in "recruiting_models" (recruiting.use_league_models).
// Otherwise at its first offseason the career takes a copy of every FBS roster into `state["league"]`, read straight
// from the roster file (from_base: every player's ratings as the file has them), and from then on players leave,
// transfer, sign and develop there. Each season the league is turned into the source format the team builder reads
// and built (build_teams.build), cached per career and year in data/leagues/ and rebuilt from the state
// whenever the cache is missing (a save loaded on another machine).
//
//     state["league"] = {"year": 2027, "attrs": [the game's 54 skills], "scale": "card",
//                        "teams": {slug: {"roster": [player], "coaches": {...}, "formation": {...}, "style": slug,
//                                         "meta": {...} (a league file's team), "depth": {role: [player id]} (season one)}},
//                        "source": {...}, "recruiting_models": {slug: {...}}}     (the last two: a league file's)
//
// A player, compact, his ratings the card numbers (1-99, as the roster file and his card have them; his overall is
// game_scale.overall on them):
//     {"id": slug, "n": name, "pos": position (LT, MIKE, ...), "cls": FR..SRRS, "ht": inches, "wt": lbs, "j": jersey,
//      "a": archetype, "dev": trait, "ab": ["name|tier"], "r": [ratings], "g": [room to potential], "c": coachability,
//      "s": stars, "o": his overall (kept in step with the ratings), "home": state, "yrs": seasons in the program,
//      "tm": target share (real receivers),
//      "dmv", "dmg": a quarterback's Decision Making and its room, a rating of its own}
// The real 2026 players are taken from the roster file once, when the career takes its league.
// The FCS stand-ins (fictional teams) always play the roster file's rosters.
//
// Every constant, variable and function is on the `league` namespace and is reached through it, here too. Paths are
// text from the project's root (files.js); a function that keeps its answers is wrapped in `cached` below (each has
// a `cache_clear`).
import { Random, round, int, sum, floordiv, mod, sorted, get, isNumber, truthy } from "../engine_js/pyrt.js";
import { mean } from "../engine_js/pystat.js";
import { read_text, write_text, exists, remove, list_dir } from "../engine_js/files.js";
import { modules } from "../engine_js/modules.js";
import { game_scale } from "../teamdata_js/game_scale.js";
import { ratings as rv2 } from "../teamdata_js/ratings.js";
import { shown } from "../teamdata_js/shown.js";
import { recruits } from "./recruits.js";

export const league = {};

/** functools.lru_cache for a function of no argument or one text argument: the answer is kept (the same object). */
function cached(fn) {
  const kept = new Map();
  const f = (...args) => {
    const at = args.length ? args[0] : "";
    if (!kept.has(at)) kept.set(at, fn(...args));
    return kept.get(at);
  };
  f.cache_clear = () => kept.clear();
  return f;
}

/** str(v) inside an f-string, for what JSON holds: None, True and False are Python's words. */
const pystr = (v) => (v === null || v === undefined ? "None" : v === true ? "True" : v === false ? "False" : String(v));

league.ROOT = ".";   // the project root: files.js reads paths from it
league.CACHE_DIR = "data/leagues";
// every team's identity (names, place, conference, colors, program, stadium...): a committed file, the teams as they
// are known. The rosters are the roster file (ROSTER_FILE): a career's first league is read straight from it.
league.BASE_META_FILE = "data/base_meta.json";
league.ROSTER_FILE = "data/engine_teams.json";
league.FIRST_YEAR = 2026;
// The coaches' own judgment in a depth chart, in overall points (one draw per player a year): real
// 2026 usage starts players well below the top overall at most positions (rotations, fits, what
// the ratings miss) but the best linemen up front. Set so that the real 2026 rosters' starters
// picked this way sit as far below the best available as the real starters did, group by group
// (fit on a later season's league, with the experience below).
league.DEPTH_EYE = { QB: 4.2, RB: 8.0, WR: 7.8, TE: 9.6, OL: 0.0, DL: 10.4, LB: 11.0, DB: 9.9, K: 1.7, P: 1.7 };
league.DEPTH_EXPERIENCE = 2.75;    // overall points a year in college is worth in a depth chart (real coaches start the veteran:
                                  // with it a later season's starters are 30% freshmen and sophomores, 2026's real ones 28%)
league._EYE_GROUP = { QB: "QB", HB: "RB", FB: "RB", WR: "WR", TE: "TE", LT: "OL", LG: "OL", C: "OL", RG: "OL", RT: "OL",
  LEDG: "DL", REDG: "DL", DT: "DL", SAM: "LB", MIKE: "LB", WILL: "LB", CB: "DB", FS: "DB", SS: "DB", K: "K", P: "P" };
league.REAL_ROOM = 1.2;           // real 2026 underclassmen's room to potential, against a generated player's at the same class
league.REAL_ROOM_CLASSES = ["FR", "FRRS", "SO", "SORS", "JR"];
league.TARGET_EYE = 0.32;         // log target weight per standard deviation of the coaches' eye (real 2026 target weights: sd 0.32)
league.TARGET_SPREAD = 0.85;      // log target weight off per 10 overall points above the team's receivers (the ratings' pull on targets is steep)
league.EXPERIENCE = { FR: 0, FRRS: 1, SO: 1, SORS: 2, JR: 2, JRRS: 3, SR: 3, SRRS: 4 };

league.CLASSES = ["FR", "FRRS", "SO", "SORS", "JR", "JRRS", "SR", "SRRS"];
league.CLASS_YEAR = { FR: "Freshman", FRRS: "Freshman (RS)", SO: "Sophomore", SORS: "Sophomore (RS)",
  JR: "Junior", JRRS: "Junior (RS)", SR: "Senior", SRRS: "Senior (RS)" };
// EA position groups a depth-chart role borrows from when its own position runs short
league.FALLBACK = { LT: ["RT", "LG", "RG", "C"], RT: ["LT", "RG", "LG", "C"], LG: ["RG", "C", "LT", "RT"],
  RG: ["LG", "C", "RT", "LT"], C: ["LG", "RG", "LT", "RT"], LEDG: ["REDG", "DT"], REDG: ["LEDG", "DT"],
  DT: ["LEDG", "REDG"], LB: ["MIKE", "WILL", "SAM"], CB: ["FS", "SS"], FS: ["SS", "CB"], SS: ["FS", "CB"],
  HB: ["FB", "WR"], FB: ["HB", "TE"], WR: ["TE", "HB"], TE: ["WR", "FB"], QB: [], K: ["P"], P: ["K"] };
league.LB_ROLES = ["SAM", "MIKE", "WILL"];
league.OFFENSE_ROLES = new Set(["QB", "HB", "FB", "WR", "TE", "LT", "LG", "C", "RG", "RT"]);
league.GROUP_OF = { QB: "QB", HB: "RB", FB: "RB", WR: "WR", TE: "TE", LT: "OL", LG: "OL", C: "OL", RG: "OL",
  RT: "OL", LEDG: "DL", REDG: "DL", DT: "DL", SAM: "LB", MIKE: "LB", WILL: "LB", CB: "DB",
  FS: "DB", SS: "DB", K: "K", P: "P" };


league.BULK = ["roster", "starters", "depth_chart", "coaches", "team_ratings", "verification"];   // the parts of a source file the league replaces


export const base_meta = cached((slug) => {
  // A team's identity (slug, names, state, conference, colors, program, ...): BASE_META_FILE's, cached since every
  // name lookup and every league team starts from it.
  const meta = league._meta_file(String(league.BASE_META_FILE))[slug];
  if (meta === undefined) throw new Error(`KeyError: '${slug}'`);
  return meta;
});


export function team_meta(lgd, slug) {
  // A league team's identity: its own "meta" when the league carries one (a team from a league
  // file the game does not know), otherwise the base team's (base_meta).
  let meta = get(get(get(lgd || {}, "teams") || {}, slug, {}), "meta");
  meta = meta !== null ? meta : league.base_meta(slug);
  const moved = get(get(lgd || {}, "conference_moves") || {}, slug);      // the offseason's Change Conferences step
  return truthy(moved) && moved !== get(meta, "conference") ? { ...meta, conference: moved } : meta;
}


export const base_slugs = cached(() => sorted(Object.keys(league._meta_file(String(league.BASE_META_FILE)))));


export function league_slugs(lgd) {
  // Every team a league plays: its own teams and the FCS stand-ins (fictional base teams, which
  // always play their base rosters). For the built-in league exactly base_slugs().
  const all = new Set(Object.keys(lgd["teams"]));
  for (const s of league.base_slugs()) if (truthy(league.base_meta(s)["fictional"])) all.add(s);
  return sorted(all);
}


export function is_imported(lgd) {
  // A career league made from a league file (league_fill.to_league sets its "source").
  return truthy(get(lgd || {}, "source"));
}


export const _meta_file = cached((path) => {
  // BASE_META_FILE's slug -> identity, read once per path.
  return JSON.parse(read_text(path));
});


export const _potentials = cached(() => {
  return exists(recruits.POTENTIAL_FILE) ? JSON.parse(read_text(recruits.POTENTIAL_FILE)) : {};
});


export function _development_of(lgd) {
  // slug -> [coachability, projected overall at his potential] for every player of a base league.
  const attrs = lgd["attrs"];
  const out = {};
  for (const t of Object.values(lgd["teams"])) {
    for (const c of t["roster"]) {
      out[c["id"]] = [get(c, "c") || "Steady Grinder", modules.rosters.overall(c["r"].map((v, i) => v + c["g"][i]), c["pos"], league.decision_top(c))];
    }
  }
  return out;
}


export const base_development = cached(() => {
  // slug -> (coachability, projected overall at his potential) for every real 2026 player, worked out once from the
  // first league (the first season has no league of its own yet).
  const out = {};
  for (const [s, v] of Object.entries(league._development_of(league.from_base()))) out[s] = [v[0], v[1]];
  return out;
});


// int("6") for the text of a height: Python's whole-number text (a sign, digits, single underscores between them,
// white space around), else null where Python raises ValueError
function _int_text(s) {
  const t = s.trim();
  return /^[+-]?\d+(_\d+)*$/.test(t) ? Number(t.replaceAll("_", "")) : null;
}

export function height_in(h) {
  // (JSON's 72.0 is the number 72 in JavaScript, so it is returned as 72.)
  if (typeof h === "boolean" || Number.isInteger(h)) return h;
  if (typeof h !== "string") return null;      // str(h) of anything else has no ' in it (or does not read as numbers)
  const parts = h.replaceAll('"', "").split("'");
  if (parts.length !== 2) return null;
  const ft = _int_text(parts[0]);
  const inch = parts[1] ? _int_text(parts[1]) : 0;
  if (ft === null || inch === null) return null;
  return ft * 12 + inch;
}


export function compact(p, attrs, home = null, rated = null) {
  // A player in the league's form. `p` is a real 2026 source player (his ratings as the roster file has them; his
  // seeded potential likewise), or carries his card numbers already as "card" and "potential_card" (signees,
  // walk-ons, transfers from lower levels).
  const pos = p["position"];
  let card, pot;
  if (get(p, "card") !== null) {
    card = p["card"];
    pot = truthy(get(p, "potential_card")) ? p["potential_card"] : p["card"];
  } else {
    // his ratings as the roster file has them (`rated`: in `attrs` order), else his card numbers by skill
    card = Array.isArray(rated) && rated.length === attrs.length
      ? Object.fromEntries(attrs.map((k, i) => [k, rated[i]])) : { ...get(p, "ratings_ea") };
    const seeded = get(get(league._potentials(), p["slug"], {}), "potential_ea") || {};
    pot = truthy(seeded) ? game_scale.potential_from_ea({ ...p["ratings_ea"], ...seeded }, card, pos) : card;
    if (league.REAL_ROOM_CLASSES.includes(get(p, "class") || "FR")) {   // seeded room runs short of a generated player's at the same stage
      const more = {};
      for (const [k, v] of Object.entries(pot)) more[k] = int(round(Math.min(99, get(card, k, v) + league.REAL_ROOM * (v - get(card, k, v)))));
      pot = more;
    }
  }
  const seeded = get(league._potentials(), p["slug"], {});
  const out = {
    id: p["slug"], n: p["name"], pos: pos, cls: get(p, "class") || "FR", ht: league.height_in(get(p, "height")),
    wt: get(p, "weight_lbs"), j: get(p, "jersey"), a: get(p, "archetype"), dev: get(p, "dev_trait") || "Normal",
    r: attrs.map((k) => int(get(card, k, game_scale.MISSING))),
    g: attrs.map((k) => int(Math.max(0, get(pot, k, game_scale.MISSING) - get(card, k, game_scale.MISSING)))),
    c: get(p, "coachability") || get(seeded, "coachability") || "Steady Grinder",
    s: get(p, "stars") || get(seeded, "stars"), o: modules.rosters.overall(attrs.map((k) => int(get(card, k, game_scale.MISSING))), pos),
    home: get(get(p, "hometown") || {}, "state") || home,
    yrs: get(p, "yrs") !== null ? int(Number(p["yrs"])) : get(league.EXPERIENCE, get(p, "class") || "FR", 0),
  };
  if (truthy(get(p, "abilities"))) out["ab"] = p["abilities"].map((a) => `${pystr(get(a, "name"))}|${pystr(get(a, "tier"))}`);
  if (truthy(get(p, "target_mult"))) out["tm"] = p["target_mult"];
  league.own_decision(out, attrs, get(p, "dmv"));
  if (isNumber(get(out, "dmv"))) out["o"] = modules.rosters.overall(out["r"], pos, out["dmv"]);     // his overall reads the one he has
  return out;
}

export function decision_top(c) {
  // Where a quarterback's Decision Making could reach (null for a player who has none): his potential overall reads it.
  return isNumber(get(c, "dmv")) ? Math.min(99, c["dmv"] + (get(c, "dmg") || 0)) : null;
}


export function own_decision(c, attrs, value = null) {
  // A quarterback's Decision Making is a rating of its own (the player's rule: none is worked out from others): "dmv",
  // on the scale the game shows, and "dmg", its room to grow, kept with him like his other ratings and grown on their
  // own (offseason.develop). `value`: the number he has (the roster file's). A quarterback who has none yet (a signee,
  // a generated player, a save from before) is given one once, from where his Football IQ and Pocket Poise stand that
  // day, and it is its own from then on. Its room is set once the same way, from where those two could reach. Returns
  // whether he was given one now.
  if (c["pos"] !== "QB" || isNumber(get(c, "dmv"))) return false;
  const mix = (card) => game_scale.card_value(card, "decision_making");
  const whole = (v) => Math.max(1, Math.min(99, int(round(v))));
  const had = isNumber(value) ? whole(value) : whole(mix(league.ratings(c, attrs)));
  const top = whole(mix(league.potential(c, attrs)));
  c["dmv"] = had;
  c["dmg"] = Math.max(0, top - had);
  delete c["dm"];
  return true;
}


export function ratings(c, attrs) {
  const out = {};
  const r = c["r"];
  for (let i = 0; i < attrs.length && i < r.length; i++) out[attrs[i]] = r[i];
  return out;
}


export function potential(c, attrs) {
  const out = {};
  const r = c["r"], g = c["g"];
  for (let i = 0; i < attrs.length && i < r.length && i < g.length; i++) out[attrs[i]] = r[i] + g[i];
  return out;
}


export function overall(c, attrs) {
  // His overall from his ratings (game_scale.overall).
  return game_scale.overall(league.ratings(c, attrs), c["pos"], get(c, "dmv"));
}


export function expand(c, attrs, team) {
  // A league player in the source roster format build_teams reads: his card numbers, what the engine's formulas read
  // for them (game_scale.base_from_card), and his overall.
  const card = league.ratings(c, attrs);
  const h = get(c, "ht") || 72;
  const ovr = game_scale.overall(card, c["pos"], get(c, "dmv"));
  return {
    slug: c["id"], name: c["n"], position: c["pos"], class: c["cls"], class_year: get(league.CLASS_YEAR, c["cls"], "Freshman"),
    team_slug: team["slug"], team: get(team, "short_name"), jersey: get(c, "j"),
    height: `${floordiv(h, 12)}'${mod(h, 12)}"`, weight_lbs: get(c, "wt"), archetype: get(c, "a"), dev_trait: get(c, "dev") || "Normal",
    ovr: ovr, overall: ovr, ratings: game_scale.base_from_card(card), skills: [...c["r"]],
    abilities: (get(c, "ab") || []).map((a) => {
      const parts = a.split("|"), one = {};
      if (parts.length > 0) one["name"] = parts[0];
      if (parts.length > 1) one["tier"] = parts[1];
      return one;
    }),
    coachability: get(c, "c"), stars: get(c, "s"),
    ...(truthy(get(c, "tm")) ? { target_mult: c["tm"] } : {}),
    ...(isNumber(get(c, "dmv")) ? { dmv: c["dmv"] } : {}),         // his own Decision Making: what the sim plays (build_teams.own_decision)
  };
}


export function formation(t) {
  // How many starters each role has in a source team's lineup (its scheme), e.g. WR 3, LB 2, CB 3.
  const out = {};
  for (const [unit, roles] of Object.entries(t["starters"])) {
    out[unit] = {};
    for (const [role, slugs] of Object.entries(roles)) out[unit][role] = (slugs || []).length;
  }
  return out;
}


const _base_text = cached(() => JSON.stringify(league._compute_base(league.FIRST_YEAR + 1)));

export function from_base(year = league.FIRST_YEAR + 1) {
  // Every FBS team's real 2026 roster, coaches and lineup shape as a league (before the first offseason's
  // departures), read straight from the roster file: worked out once and kept, a fresh copy each call.
  const lgd = JSON.parse(_base_text());
  lgd["year"] = year;
  for (const t of Object.values(lgd["teams"])) {   // as programs.init sets it for this year
    t["program"]["year"] = year - 1;
  }
  return lgd;
}


export function _filed() {
  // The roster file as it is written (nothing worked out): parsed for the caller, not kept (it is 16 MB of text, read
  // when a career's first league is made and for the eight stand-ins).
  return JSON.parse(read_text(league.ROSTER_FILE));
}

export function _roster_ratings() {
  // team slug -> player slug -> his stored skills, in game_scale.keys() order, from the roster file's ratings.
  if (!exists(league.ROSTER_FILE)) return {};
  return modules.rosters.stored_ratings(league.ROSTER_FILE);
}

// a trait's key -> the ability name a league player carries it under (the first of ratings.js TRAITS that gives it)
let _ability_names = null;
function _ability_of(key) {
  if (_ability_names === null) {
    _ability_names = {};
    for (const [name, t] of rv2.TRAITS) if (!(t[0] in _ability_names)) _ability_names[t[0]] = name;
  }
  return get(_ability_names, key);
}

export function _as_source(p) {
  // A roster-file player as `compact` reads a source player: his position the one his ratings are for, the file's
  // ratings where the source had its EA-scale ones (the file's numbers are on that scale), his traits as abilities.
  const abilities = [];
  for (const tr of get(p, "traits") || []) {
    const name = _ability_of(tr["key"]);
    if (name !== null) abilities.push({ name: name, tier: get(rv2.TIER_NAMES, tr["tier"]) });
  }
  return { slug: p["slug"], name: p["name"], position: p["source_position"], "class": get(p, "class"),
    height: get(p, "height"), weight_lbs: get(p, "weight"), jersey: get(p, "jersey"), archetype: get(p, "archetype"),
    dev_trait: get(p, "dev_trait"), abilities: abilities, ratings_ea: modules.rosters.skills_of(p), target_mult: get(p, "target_mult"),
    dmv: modules.rosters.decision_of(p) };
}

export function _filed_player(p, attrs, home, o = null) {
  // One roster-file player in the league's form: what compact(_as_source(p), attrs, home, his stored skills) gives
  // (tests/test_roster_source.mjs holds the two together), worked out directly: a league is 12,000 of them, read the
  // first time a career needs it. `o`: his overall when it is already known.
  const pos = p["source_position"], cls = get(p, "class") || "FR";
  const filed = modules.rosters.skills_of(p);            // his ratings by skill, as the file's names give them
  const r = modules.rosters.stored(filed, pos);
  const seeded = get(league._potentials(), p["slug"], {});
  const seeded_ea = get(seeded, "potential_ea") || {};
  const g = new Array(attrs.length).fill(0);
  if (truthy(seeded_ea)) {
    const room = get(game_scale.ROOM, game_scale.group(pos), 1.0);
    const more = league.REAL_ROOM_CLASSES.includes(cls);          // seeded room runs short of a generated player's at the same stage
    for (let i = 0; i < attrs.length; i++) {
      const k = attrs[i], now = r[i];
      const ea = seeded_ea[k];
      if (ea === undefined) continue;                              // (no seeded potential for it: no room)
      const v = game_scale.whole(ea);
      let pot = int(round(Math.min(99, now + room * Math.max(0, v - now))));
      if (more) pot = int(round(Math.min(99, now + league.REAL_ROOM * (pot - now))));
      g[i] = int(Math.max(0, pot - now));
    }
  }
  const out = {
    id: p["slug"], n: p["name"], pos: pos, cls: cls, ht: league.height_in(get(p, "height")),
    wt: get(p, "weight"), j: get(p, "jersey"), a: get(p, "archetype"), dev: get(p, "dev_trait") || "Normal",
    r: r, g: g,
    c: get(seeded, "coachability") || "Steady Grinder",
    s: get(seeded, "stars"), o: o !== null ? o : modules.rosters.overall(r, pos),
    home: home,
    yrs: get(league.EXPERIENCE, cls, 0),
  };
  const ab = [];
  for (const tr of get(p, "traits") || []) {
    const name = _ability_of(tr["key"]);
    if (name !== null) ab.push(`${name}|${pystr(get(rv2.TIER_NAMES, tr["tier"]))}`);
  }
  if (ab.length) out["ab"] = ab;
  if (truthy(get(p, "target_mult"))) out["tm"] = p["target_mult"];
  league.own_decision(out, attrs, modules.rosters.decision_of(p));   // his own Decision Making, kept with him and grown on its own
  if (o === null && isNumber(get(out, "dmv"))) out["o"] = modules.rosters.overall(r, pos, out["dmv"]);
  return out;
}

export function _entry_of(t, slug) {
  // One team of the roster file (`t`) as a league keeps a team: {"roster": every player in the league's form
  // (compact), "coaches", "formation"}. His ratings are the file's (rosters.stored), his room to grow is measured
  // from them (the file's numbers are on the scale his seeded potential is on), his traits go as the abilities they
  // came from.
  const attrs = game_scale.keys();
  // his overall as the game reads the roster file, when it has (worked out once there: rosters.js)
  const read = get(get(modules.rosters.loaded(league.ROSTER_FILE) || {}, "teams") || {}, slug) || {};
  const overalls = {};
  for (const q of [...(get(read, "offense") || []), ...(get(read, "defense") || [])]) overalls[q["slug"]] = q["ovr"];
  const roster = [];
  for (const p of [...(get(t, "offense") || []), ...(get(t, "defense") || [])]) {
    if (!truthy(get(p, "ratings"))) continue;
    roster.push(league._filed_player(p, attrs, get(t, "state"), get(overalls, p["slug"])));
  }
  return { roster: roster, coaches: JSON.parse(JSON.stringify(t["coaches"])), formation: JSON.parse(JSON.stringify(t["formation"])) };
}

export const _stand_ins = cached(() => {
  // The FCS stand-ins' teams as a league keeps a team (they are in no league: each plays the roster file's roster
  // every year), kept: slug -> entry.
  const filed = league._filed()["teams"], out = {};
  for (const slug of league.base_slugs()) if (truthy(league.base_meta(slug)["fictional"])) out[slug] = league._entry_of(filed[slug], slug);
  return out;
});

export function _filed_entry(slug) {
  // One team of the roster file as a league keeps a team (a stand-in's is kept; any other is read from the file).
  if (truthy(league.base_meta(slug)["fictional"])) return league._stand_ins()[slug];
  const t = get(league._filed()["teams"], slug);
  if (t === null) throw new Error(`KeyError: '${slug}'`);
  return league._entry_of(t, slug);
}

export function _compute_base(year) {
  const build_teams = modules.build_teams;
  const attrs = game_scale.keys();
  const teams = {};
  const filed = league._filed()["teams"];
  for (const slug of league.base_slugs()) {
    if (truthy(league.base_meta(slug)["fictional"])) continue;
    teams[slug] = league._entry_of(filed[slug], slug);
  }
  build_teams.measured_recruiting(Object.entries(teams).map(([s, v]) => ({ slug: s, coaches: v["coaches"] })));
  const lgd = { year: year, attrs: attrs, scale: "card", overall_v: game_scale.overall_version(), teams: teams };
  modules.programs.init(lgd);
  return lgd;
}


const _lead_features = cached(() => {
  const out = {};
  for (const [slug, t] of Object.entries(league._filed()["teams"])) out[slug] = get(get(t, "tendencies") || {}, "rb_lead_feature");
  return out;
});

export function _lead_feature(slug) {
  // How much a real program's 2026 offense leaned on its lead back (the roster file's team tendencies), or null.
  return get(_lead_features(), slug);
}


export function _role_players(by_pos, role, taken, n) {
  // A role's starters: its own position's best first (linebackers: the best MIKE, WILL and SAM
  // in that order, then the best of the rest), then a neighboring position's.
  let picks;
  if (role === "LB") {
    picks = [];
    for (const r of ["MIKE", "WILL", "SAM"].slice(0, n)) {
      const best = get(by_pos, r, []).find((p) => !taken.has(p["slug"]) && !picks.includes(p)) ?? null;
      if (best !== null) picks.push(best);
    }
    const rest = [];
    for (const r of league.LB_ROLES) for (const p of get(by_pos, r, [])) if (!taken.has(p["slug"]) && !picks.includes(p)) rest.push(p);
    picks = picks.concat(sorted(rest, (p) => -p["_depth"]));
  } else {
    picks = get(by_pos, role, []).filter((p) => !taken.has(p["slug"]));
  }
  for (const r of get(league.FALLBACK, role, [])) {
    const more = get(by_pos, r, []).filter((p) => !taken.has(p["slug"]) && !picks.includes(p));
    picks = picks.concat(more);
  }
  return picks.slice(0, n);
}


// -> [starters, depth chart]
export function lineup(roster, shape, year = league.FIRST_YEAR + 1, by_overall = false, preferred = null) {
  // (starters, depth chart) in the source format: each role's best (the linebacker spots
  // from SAM, MIKE and WILL together), borrowing a neighboring position when a role runs short;
  // kick and punt returners by return ability. A CPU staff picks by the coaches' eye (overall,
  // experience and a fixed draw of what the numbers miss); `by_overall` (your own team: you are
  // the eye, and move players on the Depth Chart) orders every role by overall, ties by name.
  // `preferred` ({role: [player slugs]}, a league file's depth chart): those players lead their
  // role, in that order, and the rest follow as before.
  let by_pos = {};
  for (const p of roster) {            // the coaches' eye: overall plus a little of what the numbers miss, fixed for the year
    p["_depth"] = by_overall ? p["ovr"] : (p["ovr"] + league.DEPTH_EXPERIENCE * get(league.EXPERIENCE, get(p, "class"), 0)
      + new Random(`depth-${p["slug"]}-${year}`).gauss(0, get(league.DEPTH_EYE, get(league._EYE_GROUP, p["position"], "K"), 1.7)));
  }
  for (const p of sorted(roster, (q) => [-q["_depth"], q["name"]])) {
    if (!(p["position"] in by_pos)) by_pos[p["position"]] = [];
    by_pos[p["position"]].push(p);
  }
  if (truthy(preferred)) {
    const by_slug = new Map(roster.map((p) => [p["slug"], p]));
    for (const [role, slugs] of Object.entries(preferred)) {
      const lead = [...new Set(slugs || [])].filter((s) => by_slug.has(s)).map((s) => by_slug.get(s));
      if (!lead.length) continue;
      const ids = new Set(lead);
      for (const pos of Object.keys(by_pos)) by_pos[pos] = by_pos[pos].filter((p) => !ids.has(p));
      by_pos[role] = lead.concat(get(by_pos, role, []));
    }
  }
  const depth = {};
  for (const role of ["QB", "HB", "FB", "WR", "TE", "LT", "LG", "C", "RG", "RT", "LEDG", "DT", "REDG", "SAM", "MIKE", "WILL", "CB", "FS", "SS", "K", "P"]) {
    depth[role] = get(by_pos, role, []).map((p) => p["slug"]);
  }
  const starters = {}, taken = new Set();
  for (const unit of ["offense", "defense"]) {
    starters[unit] = {};
    for (const [role, n] of Object.entries(get(shape, unit, {}))) {
      const picks = league._role_players(by_pos, role, taken, n);
      for (const p of picks) taken.add(p["slug"]);
      starters[unit][role] = picks.map((p) => p["slug"]);
    }
  }
  const special = {};
  const some = (xs) => (xs !== null && xs.length ? xs : null);
  for (const role of ["K", "P"]) {
    if (truthy(get(get(shape, "special_teams", {}), role))) {
      const pick = (some(get(by_pos, role)) || some(get(by_pos, role === "K" ? "P" : "K")) || [null])[0];
      special[role] = truthy(pick) ? [pick["slug"]] : [];
    }
  }
  const ret = sorted(roster.filter((p) => ["HB", "WR", "CB", "FS", "SS"].includes(p["position"])),
    (p) => -(0.5 * get(p["ratings"], "kick_return", 40) + 0.3 * get(p["ratings"], "speed", 60)
      + 0.2 * get(p["ratings"], "agility", 60)));
  special["KR"] = ret.length ? [ret[0]["slug"]] : [];
  special["PR"] = ret.length ? [ret.length > 1 ? ret[1]["slug"] : ret[0]["slug"]] : [];
  starters["special_teams"] = special;
  for (const p of roster) delete p["_depth"];
  return [starters, depth];
}


export function team_ratings(roster, starters, depth = {}) {
  // Team ratings as the game rates a team (season.game_ratings): its players' overalls weighted by position, the
  // starters in full and one backup a starting spot a little, with the roster's mean overall and the position groups'
  // starters' means.
  const season = modules.season;
  const value_of = (role) => get(get(season || {}, "PAGE_POS_VALUE") || {}, role, 1.0);
  const backup = get(season || {}, "PAGE_DEPTH_WEIGHT") || 0.15;
  const by = new Map(roster.map((p) => [p["slug"], p]));
  const units = { offense: [], defense: [], special_teams: [] };
  const groups = {};
  for (const unit of ["offense", "defense", "special_teams"]) {
    for (const [role, slugs] of Object.entries(starters[unit])) {
      if (role === "KR" || role === "PR") continue;
      const n = slugs.length;
      const order = [...slugs, ...(get(depth, role) || []).filter((s) => !slugs.includes(s))].filter((s) => by.has(s)).slice(0, 2 * n);
      order.forEach((s, i) => units[unit].push([by.get(s)["ovr"], i < n ? value_of(role) : value_of(role) * backup]));
      const g = role === "K" || role === "P" ? role : null;
      for (const s of slugs) if (by.has(s)) (groups[g || get(league.GROUP_OF, by.get(s)["position"], "DB")] ??= []).push(by.get(s)["ovr"]);
    }
  }
  const avg = (rows) => (rows.length ? round(sum(rows.map(([o, w]) => o * w)) / sum(rows.map(([, w]) => w)), 1) : 40.0);
  const out = { offense: avg(units["offense"]), defense: avg(units["defense"]), special_teams: avg(units["special_teams"]),
    overall: avg(units["offense"].concat(units["defense"], units["special_teams"])) };
  out["roster_avg"] = roster.length ? round(mean(roster.map((p) => p["ovr"])), 1) : 0.0;
  out["position_groups"] = {};
  for (const [g, v] of Object.entries(groups)) out["position_groups"][g] = round(mean(v), 1);
  return out;
}


export function source_team(lg, slug, by_overall = false) {
  // One league team in the source format: the base team's identity, the league's roster,
  // coaches and a lineup picked from the roster (`by_overall`: every role by overall, your team).
  const base = league.team_meta(lg, slug);
  const entry = lg["teams"][slug];
  const roster = entry["roster"].map((c) => league.expand(c, lg["attrs"], base));
  const [starters, depth] = league.lineup(roster, entry["formation"], lg["year"], by_overall, get(entry, "depth"));
  const on_field = new Set();
  for (const role of ["WR", "TE"]) for (const s of get(starters["offense"], role, [])) on_field.add(s);
  const seen = roster.filter((p) => on_field.has(p["slug"])).map((p) => p["ovr"]);
  const middle = mean(seen.length ? seen : [79]);
  for (const p of roster) {            // what the coaches see in a receiver they also throw him the ball for (real 2026 usage's spread),
    if ((p["position"] === "WR" || p["position"] === "TE") && !("target_mult" in p)) {     // and the ball spread around (TARGET_SPREAD)
      const z = new Random(`depth-${p["slug"]}-${lg["year"]}`).gauss(0, 1);
      p["target_mult"] = round(Math.min(2.0, Math.max(0.5, Math.exp(league.TARGET_EYE * z - league.TARGET_SPREAD * (p["ovr"] - middle) / 10))), 3);
    }
  }
  const out = { ...base };
  const style = get(entry, "style", slug);                                 // the real program whose 2026 style the staff plays
  const lead = league._lead_feature(style);
  if (lead !== null) out["rb_lead_feature"] = lead;
  Object.assign(out, { roster: roster, starters: starters, depth_chart: depth, coaches: entry["coaches"],
    team_ratings: league.team_ratings(roster, starters, depth), roster_size: roster.length });
  return out;
}


export function source_teams(lg, me = null) {
  // (an FCS stand-in is not a league team: it plays the roster file's own roster, every year)
  const stand_in = (s) => league.source_team({ attrs: lg["attrs"], year: lg["year"], teams: { [s]: league._filed_entry(s) } }, s);
  return league.league_slugs(lg).map((s) => (s in lg["teams"] ? league.source_team(lg, s, s === me) : stand_in(s)));
}


export function build(lg, me = null) {
  // The league as the engine's teams file (build_teams.build, without the real 2026 adjustments).
  // `me`: your team, whose default depth chart is by overall (lineup).
  const build_teams = modules.build_teams;
  const styles = {};
  for (const [s, t] of Object.entries(lg["teams"])) styles[s] = get(t, "style", s);
  // build(sources, real=False, observed (its default), quiet=True, styles=styles)
  return build_teams.build(league.source_teams(lg, me), false, undefined, true, styles);
}


export function path(career_id, year) {
  return `${league.CACHE_DIR}/${career_id}-${year}.json`;
}


// A career's cached teams files: [file name, the text between "<id>-" and ".json"] (every "<id>-*.json")
function _cached_files(career_id) {
  const head = `${career_id}-`;
  return list_dir(league.CACHE_DIR).filter((n) => n.startsWith(head) && n.endsWith(".json"))
    .map((n) => [n, n.slice(head.length, -5)]);
}

export function ensure_built(state) {
  // The teams file a career's current season plays (None: the real 2026 one), built if missing.
  // A career from a league file (is_imported) plays its own league from season one.
  // In the offseason the league already holds next year's rosters; a missing file for the season
  // just played is then rebuilt from them (only a save moved to another machine gets there).
  const lg = get(state, "league");
  const year = get(state, "year") || league.FIRST_YEAR;
  if (!truthy(lg) || (year <= league.FIRST_YEAR && !league.is_imported(lg))) return null;
  const out = league.path(state["id"], year);
  if (!exists(out)) {
    // an imported league's first season is the file app_js/api.js wrote at Start (league_file.check's
    // build, no team by overall); later seasons put your team's depth by overall (league.lineup)
    const me = year <= league.FIRST_YEAR ? null : get(state, "team");
    write_text(out, JSON.stringify(league.build(lg, me)));
    // the seasons before this one are played: their files go (each is some twenty megabytes, and the browser
    // keeps this folder in its store)
    for (const [name, rest] of _cached_files(state["id"])) {
      if (/^\d+$/.test(rest) && Number(rest) < year) {
        try { remove(`${league.CACHE_DIR}/${name}`); } catch { /* a file that cannot be removed stays */ }
      }
    }
  }
  return out;
}


export function forget(career_id) {
  // Remove a career's cached teams files (the career was deleted).
  for (const [name] of _cached_files(career_id)) {
    try { remove(`${league.CACHE_DIR}/${name}`); } catch { /* a file that cannot be removed stays */ }
  }
}

Object.assign(league, {
  base_meta, team_meta, base_slugs, league_slugs, is_imported, _meta_file,
  _potentials, _development_of, base_development, height_in, compact, own_decision, decision_top, ratings, potential, overall,
  expand, formation, from_base, _filed, _as_source, _filed_player, _entry_of, _stand_ins, _filed_entry, _roster_ratings, _compute_base, _lead_feature, _role_players, lineup, team_ratings, source_team,
  source_teams, build, path, ensure_built, forget,
});

game_scale.modules.league = league;   // the old-save upgrades in teamdata_js/game_scale.js call league.forget
modules.league = league;
